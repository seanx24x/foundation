import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createNativeTheme } from '../scripts/generate-native-themes.mjs';

const root = process.env.FOUNDATION_THEME_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const themesPath = process.env.FOUNDATION_THEME_OUTPUT ?? path.join(root, 'desktop/extension/themes');
const tokens = JSON.parse(readFileSync(path.join(root, 'design/foundation.tokens.json'), 'utf8'));
const rgb = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
const composite = (color, base) => {
  const alpha = color.length === 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1;
  const under = rgb(base);
  return '#' + rgb(color).map((v, i) => Math.round(255 * (v * alpha + under[i] * (1 - alpha)))
    .toString(16).padStart(2, '0')).join('');
};
const luminance = color => rgb(color).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const expectContrast = (fg, bg, minimum, label) => assert.ok(contrast(fg, bg) >= minimum,
  `${label}: ${fg} / ${bg} = ${contrast(fg, bg).toFixed(2)}; requires ${minimum}`);
const themes = Object.fromEntries(['light', 'dark'].map(mode => [mode, createNativeTheme(tokens, mode)]));

test('native theme files match the canonical generator and have full light/dark key parity', () => {
  for (const [mode, theme] of Object.entries(themes)) {
    assert.deepEqual(JSON.parse(readFileSync(path.join(themesPath, `foundation-${mode}.json`), 'utf8')), theme);
    for (const value of Object.values(theme.colors)) assert.match(value, /^#[\da-f]{6}([\da-f]{2})?$/i);
  }
  assert.deepEqual(Object.keys(themes.light.colors), Object.keys(themes.dark.colors));
  assert.deepEqual(Object.keys(themes.light.semanticTokenColors), Object.keys(themes.dark.semanticTokenColors));
});

for (const [mode, theme] of Object.entries(themes)) {
  const c = theme.colors;
  test(`${mode}: reading surfaces, widgets, selection, status and controls preserve contrast`, () => {
    const pairs = [
      ['foreground', 'titleBar.activeBackground'], ['descriptionForeground', 'sideBar.background'],
      ['sideBar.foreground', 'sideBar.background'], ['sideBarSectionHeader.foreground', 'sideBarSectionHeader.background'],
      ['activityBar.inactiveForeground', 'activityBar.background'], ['titleBar.inactiveForeground', 'titleBar.inactiveBackground'],
      ['tab.activeForeground', 'tab.activeBackground'], ['tab.inactiveForeground', 'tab.inactiveBackground'],
      ['panelTitle.inactiveForeground', 'panel.background'], ['statusBar.foreground', 'statusBar.background'],
      ['statusBar.debuggingForeground', 'statusBar.debuggingBackground'],
      ['statusBarItem.remoteForeground', 'statusBarItem.remoteBackground'],
      ['statusBarItem.errorForeground', 'statusBarItem.errorBackground'],
      ['statusBarItem.warningForeground', 'statusBarItem.warningBackground'],
      ['input.foreground', 'input.background'], ['input.placeholderForeground', 'input.background'],
      ['inputValidation.errorForeground', 'inputValidation.errorBackground'],
      ['inputValidation.infoForeground', 'inputValidation.infoBackground'],
      ['inputValidation.warningForeground', 'inputValidation.warningBackground'],
      ['list.activeSelectionForeground', 'list.activeSelectionBackground'],
      ['list.inactiveSelectionForeground', 'list.inactiveSelectionBackground'],
      ['list.hoverForeground', 'list.hoverBackground'], ['list.highlightForeground', 'list.hoverBackground'],
      ['button.foreground', 'button.background'], ['button.foreground', 'button.hoverBackground'],
      ['button.secondaryForeground', 'button.secondaryBackground'], ['button.secondaryForeground', 'button.secondaryHoverBackground'],
      ['activityBarBadge.foreground', 'activityBarBadge.background'], ['badge.foreground', 'badge.background'],
      ['menu.foreground', 'menu.background'], ['menu.selectionForeground', 'menu.selectionBackground'],
      ['editorSuggestWidget.foreground', 'editorSuggestWidget.background'],
      ['editorSuggestWidget.selectedForeground', 'editorSuggestWidget.selectedBackground'],
      ['editorSuggestWidget.focusHighlightForeground', 'editorSuggestWidget.selectedBackground'],
      ['editorHoverWidget.foreground', 'editorHoverWidget.background'], ['notifications.foreground', 'notifications.background'],
      ['quickInput.foreground', 'quickInput.background'], ['quickInputList.focusForeground', 'quickInputList.focusBackground'],
      ['editor.selectionForeground', 'editor.selectionBackground'], ['editor.findMatchForeground', 'editor.findMatchBackground'],
      ['peekViewResult.selectionForeground', 'peekViewResult.selectionBackground'],
    ];
    for (const [fg, bg] of pairs) expectContrast(c[fg], c[bg], 4.5, `${fg} on ${bg}`);
    for (const [fg, bg] of [['input.border', 'input.background'], ['checkbox.border', 'checkbox.background'],
      ['focusBorder', 'editor.background'], ['focusBorder', 'sideBar.background'], ['focusBorder', 'panel.background'],
      ['editorError.foreground', 'editor.background'], ['editorWarning.foreground', 'editor.background']]) {
      expectContrast(c[fg], c[bg], 3, `${fg} on ${bg}`);
    }
  });

  test(`${mode}: all ANSI slots and semantic/TextMate syntax remain readable on editor and terminal`, () => {
    const ansi = Object.entries(c).filter(([key]) => key.startsWith('terminal.ansi'));
    assert.equal(ansi.length, 16);
    for (const [name, value] of ansi) {
      expectContrast(value, c['terminal.background'], 4.5, name);
      expectContrast(value, composite(c['terminal.selectionBackground'], c['terminal.background']), 4.5, `${name} selected`);
    }
    for (const [name, value] of Object.entries(theme.semanticTokenColors)) expectContrast(value, c['editor.background'], 4.5, `semantic ${name}`);
    for (const token of theme.tokenColors) expectContrast(token.settings.foreground, c['editor.background'], 4.5, token.name);
  });

  test(`${mode}: composited overlays and nested diff emphasis retain syntax readability`, () => {
    const backgrounds = ['editor.lineHighlightBackground', 'editor.inactiveSelectionBackground',
      'editor.selectionHighlightBackground', 'editor.wordHighlightBackground', 'editor.wordHighlightStrongBackground',
      'editor.findMatchHighlightBackground', 'editor.findRangeHighlightBackground', 'editorBracketMatch.background',
      'diffEditor.insertedLineBackground', 'diffEditor.removedLineBackground'];
    const syntax = Object.entries(tokens.color[mode]).filter(([key]) => key.startsWith('syntax.'));
    for (const key of backgrounds) {
      const bg = composite(c[key], c['editor.background']);
      for (const [name, value] of syntax) expectContrast(value, bg, 4.5, `${name} on ${key}`);
    }
    for (const type of ['inserted', 'removed']) {
      const line = composite(c[`diffEditor.${type}LineBackground`], c['editor.background']);
      const bg = composite(c[`diffEditor.${type}TextBackground`], line);
      for (const [name, value] of syntax) expectContrast(value, bg, 4.5, `${name} on ${type} word over line`);
    }
  });
}

test('every mapped color is registered by the pinned host or its bundled Git extension', { skip: !existsSync(path.join(root, 'desktop/.upstream/vscode/src')) }, () => {
  const registrations = new Set();
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.ts')) {
        for (const match of readFileSync(file, 'utf8').matchAll(/registerColor\(\s*['"`]([^'"`]+)['"`]/g)) registrations.add(match[1]);
      }
    }
  };
  walk(path.join(root, 'desktop/.upstream/vscode/src/vs'));
  const git = JSON.parse(readFileSync(path.join(root, 'desktop/.upstream/vscode/extensions/git/package.json'), 'utf8'));
  for (const color of git.contributes.colors) registrations.add(color.id);
  // The host registers ANSI identifiers in a loop over this fixed palette.
  for (const name of ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White']) {
    registrations.add(`terminal.ansi${name}`); registrations.add(`terminal.ansiBright${name}`);
  }
  const unknown = Object.keys(themes.dark.colors).filter(key => !registrations.has(key));
  assert.deepEqual(unknown, [], 'Unregistered colors silently fail to style the workbench.');
});
