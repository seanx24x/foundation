import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep host semantics tied to the approved palette. Theme JSON cannot change
// workbench dimensions, typography, user layouts, or extension-owned surfaces.
export function createNativeTheme(tokens, mode) {
  const palette = tokens.color[mode];
  if (!palette) throw new Error(`Unknown Foundation theme: ${mode}`);
  const colors = {};
  const put = (token, keys, alpha = '') => {
    if (!palette[token]) throw new Error(`Missing Foundation token: ${token}`);
    for (const key of keys.trim().split(/\s+/)) {
      if (key in colors) throw new Error(`Duplicate host mapping: ${key}`);
      colors[key] = palette[token] + alpha;
    }
  };
  put('surface.workspace', `titleBar.activeBackground titleBar.inactiveBackground
    editorGroup.emptyBackground welcomePage.background`);
  put('surface.navigation', `activityBar.background activityBarTop.background
    sideBar.background sideBarSectionHeader.background editorGroupHeader.tabsBackground
    tab.inactiveBackground tab.unfocusedInactiveBackground statusBar.background
    statusBar.noFolderBackground breadcrumb.background`);
  put('surface.panel', `panel.background panelSectionHeader.background
    editorGroupHeader.noTabsBackground editorHoverWidget.statusBarBackground
    notificationCenterHeader.background quickInputTitle.background
    textCodeBlock.background textPreformat.background settings.focusedRowBackground`);
  put('surface.editor', `editor.background editorGutter.background tab.activeBackground
    tab.unfocusedActiveBackground terminal.background input.background dropdown.background
    settings.textInputBackground settings.numberInputBackground settings.dropdownBackground
    settings.checkboxBackground checkbox.background`);
  put('surface.raised', `editorWidget.background editorSuggestWidget.background
    editorHoverWidget.background menu.background notifications.background quickInput.background
    debugToolBar.background breadcrumbPicker.background peekViewResult.background peekViewEditor.background
    peekViewEditorGutter.background peekViewTitle.background`);
  put('surface.hover', `list.hoverBackground toolbar.hoverBackground
    button.secondaryBackground inputOption.hoverBackground tab.hoverBackground
    tab.unfocusedHoverBackground statusBarItem.hoverBackground menu.selectionBackground`);
  put('surface.pressed', `button.secondaryHoverBackground toolbar.activeBackground
    statusBarItem.activeBackground badge.background`);
  put('border.subtle', `activityBar.border titleBar.border window.activeBorder window.inactiveBorder
    sideBar.border sideBarSectionHeader.border editorGroup.border editorGroupHeader.tabsBorder
    tab.border tab.lastPinnedBorder panel.border panelSection.border panelSectionHeader.border
    statusBar.border statusBar.noFolderBorder statusBar.debuggingBorder tree.indentGuidesStroke
    editorIndentGuide.background1 editorWhitespace.foreground tree.inactiveIndentGuidesStroke
    menu.separatorBackground pickerGroup.border terminal.border`);
  put('border.control', `input.border dropdown.border checkbox.border editorWidget.border
    editorSuggestWidget.border editorHoverWidget.border notifications.border menu.border
    debugToolBar.border settings.textInputBorder settings.numberInputBorder
    settings.dropdownBorder settings.checkboxBorder
    editorIndentGuide.activeBackground1`);
  put('text.primary', `foreground activityBar.foreground activityBarTop.foreground sideBarTitle.foreground
    titleBar.activeForeground editor.foreground editorLineNumber.activeForeground
    tab.activeForeground tab.unfocusedActiveForeground tab.hoverForeground
    tab.unfocusedHoverForeground list.activeSelectionForeground list.focusForeground
    list.inactiveSelectionForeground list.hoverForeground panelTitle.activeForeground
    input.foreground dropdown.foreground checkbox.foreground badge.foreground
    button.secondaryForeground editorWidget.foreground editorSuggestWidget.foreground
    editorSuggestWidget.selectedForeground editorHoverWidget.foreground
    menu.foreground menu.selectionForeground notifications.foreground quickInput.foreground
    quickInputList.focusForeground terminal.foreground terminal.selectionForeground
    settings.headerForeground settings.textInputForeground settings.numberInputForeground
    settings.dropdownForeground settings.checkboxForeground inputOption.activeForeground
    breadcrumb.focusForeground breadcrumb.activeSelectionForeground
    peekViewTitleLabel.foreground peekViewResult.fileForeground peekViewResult.selectionForeground
    editor.selectionForeground editor.findMatchForeground editor.findMatchHighlightForeground`);
  put('text.secondary', `descriptionForeground icon.foreground sideBar.foreground sideBarSectionHeader.foreground
    tab.inactiveForeground tab.unfocusedInactiveForeground statusBar.foreground
    statusBar.noFolderForeground panelTitle.inactiveForeground terminal.initialHintForeground
    peekViewResult.lineForeground peekViewTitleDescription.foreground breadcrumb.foreground
    textPreformat.foreground`);
  put('text.muted', `activityBar.inactiveForeground activityBarTop.inactiveForeground titleBar.inactiveForeground
    input.placeholderForeground editorLineNumber.foreground gitDecoration.ignoredResourceForeground
    editorCodeLens.foreground editorInlayHint.foreground`);
  put('text.disabled', `disabledForeground list.deemphasizedForeground`);
  put('text.primary', `activityBar.activeBorder activityBarTop.activeBorder
    tab.activeBorderTop panelTitle.activeBorder`);
  put('text.muted', `tab.unfocusedActiveBorderTop`);
  put('focus.ring', `focusBorder list.focusOutline list.focusAndSelectionOutline
    list.inactiveFocusOutline inputOption.activeBorder editorBracketMatch.border
    editor.compositionBorder sash.hoverBorder menu.selectionBorder`);
  put('action.fill', `button.background activityBarBadge.background`);
  put('action.hover', `button.hoverBackground`);
  put('action.onFill', `button.foreground activityBarBadge.foreground`);
  put('accent.text', `textLink.foreground textLink.activeForeground list.highlightForeground
    list.focusHighlightForeground editorSuggestWidget.highlightForeground
    editorSuggestWidget.focusHighlightForeground pickerGroup.foreground settings.modifiedItemIndicator
    editorCursor.foreground tab.activeModifiedBorder tab.inactiveModifiedBorder
    tab.unfocusedActiveModifiedBorder tab.unfocusedInactiveModifiedBorder`);
  put('accent.surface', `list.activeSelectionBackground list.inactiveSelectionBackground
    list.focusBackground editorSuggestWidget.selectedBackground quickInputList.focusBackground
    inputOption.activeBackground editor.selectionBackground peekViewResult.selectionBackground
    statusBarItem.remoteBackground`);
  put('accent.text', `statusBarItem.remoteForeground`);
  put('accent.fill', `progressBar.background terminalCursor.foreground`);
  put('accent.onFill', `terminalCursor.background`);
  put('surface.hover', `editorInlayHint.background`);
  put('status.success.text', `testing.iconPassed editorHint.foreground editorGutter.addedBackground
    gitDecoration.addedResourceForeground gitDecoration.untrackedResourceForeground
    terminalCommandDecoration.successBackground`);
  put('status.warning.text', `editorWarning.foreground problemsWarningIcon.foreground
    notificationsWarningIcon.foreground list.warningForeground testing.iconQueued
    gitDecoration.conflictingResourceForeground inputValidation.warningForeground
    inputValidation.warningBorder statusBarItem.warningForeground`);
  put('status.warning.surface', `inputValidation.warningBackground statusBarItem.warningBackground
    editor.findMatchBackground terminal.findMatchBackground`);
  put('status.error.text', `errorForeground editorError.foreground problemsErrorIcon.foreground
    notificationsErrorIcon.foreground list.errorForeground testing.iconFailed testing.iconErrored
    gitDecoration.deletedResourceForeground editorGutter.deletedBackground
    inputValidation.errorForeground inputValidation.errorBorder statusBarItem.errorForeground
    terminalCommandDecoration.errorBackground`);
  put('status.error.surface', `inputValidation.errorBackground statusBarItem.errorBackground`);
  put('status.info.text', `editorInfo.foreground problemsInfoIcon.foreground notificationsInfoIcon.foreground
    inputValidation.infoForeground inputValidation.infoBorder editorGutter.modifiedBackground
    gitDecoration.modifiedResourceForeground gitDecoration.stageModifiedResourceForeground
    testing.iconUnset peekView.border statusBar.debuggingForeground`);
  put('status.info.surface', `inputValidation.infoBackground statusBar.debuggingBackground`);
  put('syntax.comment', `testing.iconSkipped terminalCommandDecoration.defaultBackground`);
  put('border.control', `editor.findMatchBorder terminal.findMatchBorder
    editor.findMatchHighlightBorder terminal.findMatchHighlightBorder
    editor.selectionHighlightBorder editor.wordHighlightBorder editor.wordHighlightStrongBorder`);
  // These host roles require transparency so underlying diagnostics/decorations
  // remain visible. Tests composite each overlay over the editor before checking
  // syntax contrast. Alpha is intentional, not a replacement for muted text.
  put('accent.fill', `editor.inactiveSelectionBackground`, '1A');
  put('accent.fill', `editor.selectionHighlightBackground editor.wordHighlightBackground
    editor.wordHighlightStrongBackground editor.findMatchHighlightBackground
    editor.findRangeHighlightBackground terminal.findMatchHighlightBackground
    terminal.hoverHighlightBackground editor.hoverHighlightBackground`, '0D');
  put('accent.fill', `editorGroup.dropBackground terminal.dropBackground`, '26');
  put('accent.surface', `terminal.selectionBackground terminal.inactiveSelectionBackground`, 'B3');
  put('surface.hover', `editorBracketMatch.background editor.lineHighlightBackground`, '80');
  put('diff.add.surface', `diffEditor.insertedLineBackground diffEditorGutter.insertedLineBackground`, 'CC');
  put('diff.remove.surface', `diffEditor.removedLineBackground diffEditorGutter.removedLineBackground`, 'CC');
  put('status.success.text', `diffEditor.insertedTextBackground`, '08');
  put('status.error.text', `diffEditor.removedTextBackground`, '08');
  put('status.success.text', `diffEditorOverview.insertedForeground`);
  put('status.error.text', `diffEditorOverview.removedForeground`);
  put('border.control', `scrollbarSlider.background`, '66');
  put('border.control', `scrollbarSlider.hoverBackground`, '99');
  put('border.control', `scrollbarSlider.activeBackground`, 'CC');
  colors['scrollbar.shadow'] = '#00000000';
  colors['editor.lineHighlightBorder'] = '#00000000';
  colors['editorOverviewRuler.border'] = '#00000000';
  colors['widget.shadow'] = mode === 'dark' ? '#0000003D' : '#0000001F';
  put('border.subtle', `textBlockQuote.border`);

  // ANSI labels are terminal slots, not literal output colors. Achromatic slots
  // remain legible in both modes. Bright slots reuse the approved readable hues;
  // the program's separate bold attributes remain intact.
  const ansi = { Black: 'text.muted', Red: 'status.error.text', Green: 'status.success.text',
    Yellow: 'status.warning.text', Blue: 'syntax.function', Magenta: 'syntax.keyword',
    White: 'text.primary' };
  for (const [name, token] of Object.entries(ansi)) {
    put(token, `terminal.ansi${name} terminal.ansiBright${name}`);
  }
  // The canonical palette has no cyan token. This deterministic midpoint retains
  // the palette's saturation and is checked at 4.5:1 on the terminal surface.
  const mix = (a, b) => '#' + [1, 3, 5].map(i => Math.round((parseInt(a.slice(i, i + 2), 16)
    + parseInt(b.slice(i, i + 2), 16)) / 2).toString(16).padStart(2, '0')).join('').toUpperCase();
  colors['terminal.ansiCyan'] = mix(palette['syntax.string'], palette['syntax.function']);
  colors['terminal.ansiBrightCyan'] = colors['terminal.ansiCyan'];

  const syntax = (name, token, scope, fontStyle) => ({ name, scope,
    settings: { foreground: palette[token], ...(fontStyle === undefined ? {} : { fontStyle }) } });
  const tokenColors = [
    syntax('Comments', 'syntax.comment', ['comment', 'punctuation.definition.comment'], ''),
    syntax('Keywords', 'syntax.keyword', ['keyword', 'storage.type', 'storage.modifier']),
    syntax('Strings', 'syntax.string', ['string', 'constant.other.symbol']),
    syntax('Numbers and constants', 'syntax.number', ['constant.numeric', 'constant.language', 'support.constant']),
    syntax('Types', 'syntax.keyword', ['entity.name.type', 'entity.name.class', 'support.type', 'support.class']),
    syntax('Functions', 'syntax.function', ['entity.name.function', 'support.function']),
    syntax('Variables', 'text.primary', ['variable', 'meta.definition.variable.name']),
    syntax('Tags', 'syntax.function', ['entity.name.tag']),
    syntax('Attributes', 'syntax.keyword', ['entity.other.attribute-name']),
    syntax('Punctuation', 'text.secondary', ['punctuation', 'meta.brace', 'meta.delimiter']),
    syntax('Markdown headings', 'text.primary', ['markup.heading', 'entity.name.section'], 'bold'),
    syntax('Inserted', 'status.success.text', ['markup.inserted']),
    syntax('Deleted', 'status.error.text', ['markup.deleted']),
    syntax('Invalid', 'status.error.text', ['invalid']),
    syntax('Escapes', 'syntax.number', ['constant.character.escape']),
  ];
  const semantic = {
    namespace: 'text.secondary', type: 'syntax.keyword', class: 'syntax.keyword',
    enum: 'syntax.keyword', interface: 'syntax.keyword', struct: 'syntax.keyword',
    typeParameter: 'syntax.keyword', parameter: 'text.primary', variable: 'text.primary',
    property: 'text.primary', enumMember: 'syntax.number', event: 'syntax.function',
    function: 'syntax.function', method: 'syntax.function', macro: 'syntax.function',
    keyword: 'syntax.keyword', modifier: 'syntax.keyword', comment: 'syntax.comment',
    string: 'syntax.string', number: 'syntax.number', regexp: 'syntax.string',
    operator: 'text.secondary', decorator: 'syntax.function',
    'variable.readonly': 'syntax.number', 'property.readonly': 'syntax.number',
  };
  return {
    $schema: 'vscode://schemas/color-theme',
    name: `Foundation ${mode === 'dark' ? 'Dark' : 'Light'}`,
    type: mode, semanticHighlighting: true,
    colors: Object.fromEntries(Object.entries(colors).sort(([a], [b]) => a.localeCompare(b))),
    tokenColors,
    semanticTokenColors: Object.fromEntries(Object.entries(semantic).map(([key, token]) => [key, palette[token]])),
  };
}

const ownPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === ownPath) {
  const args = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const root = path.resolve(option('--root') ?? path.join(path.dirname(ownPath), '../..'));
  const output = path.resolve(option('--out') ?? path.join(root, 'desktop/extension/themes'));
  const tokens = JSON.parse(await readFile(path.join(root, 'design/foundation.tokens.json'), 'utf8'));
  for (const mode of ['dark', 'light']) {
    const file = path.join(output, `foundation-${mode}.json`);
    const source = JSON.stringify(createNativeTheme(tokens, mode), null, 2) + '\n';
    if (args.includes('--write')) {
      await mkdir(output, { recursive: true });
      await writeFile(file, source);
    } else if (await readFile(file, 'utf8') !== source) {
      throw new Error(`${file} has drifted; regenerate with --write.`);
    }
  }
  console.log(`Foundation ${tokens.version} host themes ${args.includes('--write') ? 'generated' : 'match canonical tokens'}.`);
}
