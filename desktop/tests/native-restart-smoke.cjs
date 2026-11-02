const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, label, timeout = 30000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await check(); if (value) return value; await pause(100); } throw new Error(`Timed out: ${label}`); };
const files = ['src/Saved.tsx', 'src/Other.ts', 'src/Draft.ts'];
const question = 'Improve the loading and error states.\nKeep this unsent thought after restart — do not submit it.';
const expectedRenderer = { mode: 'Refine', question, intent: 'build', sourcePaths: ['src/Saved.tsx'], includeTaskBrief: true, contextOpen: true };
const selectionState = editor => ({ anchor: { line: editor.selection.anchor.line, character: editor.selection.anchor.character }, active: { line: editor.selection.active.line, character: editor.selection.active.character } });
const compareGeometry = (actual, expected) => {
  assert.equal(actual.orientation, expected.orientation);
  assert.equal(actual.groups?.length, expected.groups?.length);
  const actualTotal = actual.groups?.reduce((sum, group) => sum + group.size, 0), expectedTotal = expected.groups?.reduce((sum, group) => sum + group.size, 0);
  for (let index = 0; index < (expected.groups?.length || 0); index++) {
    const actualShare = actual.groups[index].size / actualTotal, expectedShare = expected.groups[index].size / expectedTotal;
    assert.ok(Math.abs(actualShare - expectedShare) <= 0.005, `Group share changed: ${expectedShare} → ${actualShare}`);
    compareGeometry(actual.groups[index], expected.groups[index]);
  }
};

async function run() {
  const stage = process.env.FOUNDATION_RESTART_STAGE, workspace = process.env.FOUNDATION_RESTART_WORKSPACE, reportPath = process.env.FOUNDATION_RESTART_REPORT;
  assert.ok(['write', 'restore'].includes(stage));
  const extension = vscode.extensions.getExtension('foundation.foundation-workspace'); assert.ok(extension);
  assert.equal(await fs.realpath(extension.extensionPath), process.env.FOUNDATION_RESTART_EXTENSION);
  await extension.activate(); assert.ok(process.versions.electron);
  const inspect = () => extension.exports.inspect();
  await wait(() => inspect().project && inspect().features, 'Foundation project activation');
  const settings = vscode.workspace.getConfiguration('foundation.ai');
  assert.equal(settings.get('baseUrl'), ''); assert.equal(settings.get('model'), ''); assert.deepEqual(settings.get('profiles'), {});
  assert.ok(Object.keys(process.env).every(key => !/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key)));
  const hashes = async () => Object.fromEntries(await Promise.all(files.map(async name => [name, createHash('sha256').update(await fs.readFile(path.join(workspace, name))).digest('hex')])));
  const layout = () => vscode.window.tabGroups.all.map(group => ({ viewColumn: group.viewColumn, active: group.isActive,
    tabs: group.tabs.map(tab => ({ label: tab.label, active: tab.isActive, dirty: tab.isDirty,
      kind: tab.input instanceof vscode.TabInputWebview ? 'webview' : tab.input instanceof vscode.TabInputText ? 'source' : 'other',
      ...(tab.input instanceof vscode.TabInputText ? { path: path.relative(workspace, tab.input.uri.fsPath) } : {}),
    })) }));
  const foundationTabs = () => layout().flatMap(group => group.tabs.filter(tab => tab.kind === 'webview' && tab.label === 'Foundation').map(tab => ({ ...tab, viewColumn: group.viewColumn })));
  const assertPassive = () => {
    assert.equal(inspect().runtime.status, 'idle'); assert.equal(inspect().design.status, 'idle'); assert.equal(inspect().proposal, null);
    assert.equal(inspect().conversations.conversations.length, 0, 'An unsent draft must not create an AI conversation');
  };
  let commandIndex = 0;
  const renderer = async command => {
    const index = ++commandIndex, ipc = process.env.FOUNDATION_RESTART_IPC;
    await fs.writeFile(path.join(ipc, `command-${index}.json`), JSON.stringify(command));
    const result = await wait(async () => { try { return JSON.parse(await fs.readFile(path.join(ipc, `result-${index}.json`), 'utf8')); } catch {} }, 'actual renderer input or inspection', 60000);
    assert.equal(result.passed, true, result.error); return result.renderer;
  };
  const checks = [], initialHashes = await hashes();
  if (stage === 'write') {
    // Arrange only this harness-owned workspace; preserve its dirty buffer on quit.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('foundation.understand');
    await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.4 }, { size: 0.6 }] });
    const saved = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace, 'src/Saved.tsx')));
    await vscode.window.showTextDocument(saved, { viewColumn: vscode.ViewColumn.Two, preview: false });
    const draft = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace, 'src/Draft.ts')));
    await vscode.window.showTextDocument(draft, { viewColumn: vscode.ViewColumn.Two, preview: false });
    const edit = new vscode.WorkspaceEdit(); edit.insert(draft.uri, new vscode.Position(0, 0), '// Unfinished native draft — preserved across restart.\n');
    assert.equal(await vscode.workspace.applyEdit(edit), true); assert.equal(draft.isDirty, true);
    const featureState = await vscode.commands.executeCommand('foundation.newFeature', { title: 'Continue profile refinement', brief: 'Preserve source, context, and intent between sessions.', paths: ['src/Saved.tsx', 'src/Other.ts'], entryPath: 'src/Saved.tsx' });
    await wait(() => inspect().featureFiles.length === 2, 'saved feature source context');
    await vscode.commands.executeCommand('foundation.askAI');
    await wait(() => inspect().assistantSurface.visible, 'native Assistant visibility');
    const rendererBefore = await renderer({ type: 'compose', mode: 'Refine', sourcePath: 'src/Saved.tsx', question });
    assert.deepEqual(rendererBefore, expectedRenderer);
    const draftEditor = await vscode.window.showTextDocument(draft, { viewColumn: vscode.ViewColumn.Two, preview: false });
    draftEditor.selection = new vscode.Selection(1, 16, 0, 11);
    await wait(() => vscode.window.tabGroups.activeTabGroup.viewColumn === 2 && vscode.window.activeTextEditor?.document.uri.fsPath === draft.uri.fsPath, 'source group retains keyboard focus');
    assert.equal(inspect().workspaceMode, 'Refine'); assert.equal(foundationTabs().length, 1); assert.equal(foundationTabs()[0].viewColumn, 1);
    assert.equal(draft.isDirty, true); assert.deepEqual(await hashes(), initialHashes); assertPassive();
    const layoutBefore = layout(); assert.equal(layoutBefore.length, 2);
    const geometryBefore = await vscode.commands.executeCommand('vscode.getEditorLayout');
    assert.equal(geometryBefore.orientation, 0); assert.equal(geometryBefore.groups.length, 2);
    const selectionBefore = selectionState(vscode.window.activeTextEditor); assert.deepEqual(selectionBefore, { anchor: { line: 1, character: 16 }, active: { line: 0, character: 11 } });
    assert.deepEqual(layoutBefore.find(group => group.viewColumn === 2).tabs.filter(tab => tab.kind === 'source').map(tab => tab.path).sort(), ['src/Draft.ts', 'src/Saved.tsx']);
    checks.push('actual Assistant controls retain an unsent question, Build intent, one selected saved source, and included task brief');
    checks.push('one Foundation Refine tab remains in group 1 while two source tabs and a dirty active draft with a reversed multiline selection remain in group 2');
    await fs.writeFile(reportPath, JSON.stringify({ writeProcessId: process.pid, rendererBefore, layoutBefore, geometryBefore, selectionBefore, draftText: draft.getText(), sourceHashes: initialHashes,
      featureId: featureState.activeId, writeChecks: checks, providerRequests: 0, runtimeStarted: false, sourceSaved: false }));
  } else {
    // No show, refresh, focus, prepare-context, or editor-opening command may
    // manufacture restoration before these assertions observe the native state.
    const previous = JSON.parse(await fs.readFile(reportPath, 'utf8')); assert.notEqual(process.pid, previous.writeProcessId);
    try {
      await wait(() => foundationTabs().length === 1 && inspect().assistantSurface.visible && vscode.workspace.textDocuments.some(document => document.uri.fsPath === path.join(workspace, 'src/Draft.ts') && document.isDirty), 'restored native surfaces and hot-exit draft');
    } catch (error) {
      throw new Error(`${error.message}; native state: ${JSON.stringify({ layout: layout(), assistant: inspect().assistantSurface, workspaceMode: inspect().workspaceMode,
        documents: vscode.workspace.textDocuments.map(document => ({ path: path.relative(workspace, document.uri.fsPath), dirty: document.isDirty })),
        activeSource: vscode.window.activeTextEditor?.document.uri.fsPath, activeGroup: vscode.window.tabGroups.activeTabGroup.viewColumn })}`);
    }
    const restoredLayout = layout(); assert.deepEqual(restoredLayout, previous.layoutBefore);
    assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, 2); assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, path.join(workspace, 'src/Draft.ts'));
    const geometryAfter = await vscode.commands.executeCommand('vscode.getEditorLayout'); compareGeometry(geometryAfter, previous.geometryBefore);
    const selectionAfter = selectionState(vscode.window.activeTextEditor); assert.deepEqual(selectionAfter, previous.selectionBefore);
    assert.equal(foundationTabs()[0].viewColumn, 1); assert.equal(inspect().workspaceMode, 'Refine');
    const draft = vscode.workspace.textDocuments.find(document => document.uri.fsPath === path.join(workspace, 'src/Draft.ts'));
    assert.equal(draft.isDirty, true); assert.equal(draft.getText(), previous.draftText);
    assert.equal(inspect().features.activeId, previous.featureId);
    const rendererAfter = await renderer({ type: 'inspect', expected: expectedRenderer }); assert.deepEqual(rendererAfter, expectedRenderer); assert.deepEqual(rendererAfter, previous.rendererBefore);
    assert.deepEqual(layout(), previous.layoutBefore, 'read-only renderer inspection cannot steal focus');
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, draft.uri.fsPath);
    assert.deepEqual(selectionState(vscode.window.activeTextEditor), previous.selectionBefore);
    assert.deepEqual(await hashes(), previous.sourceHashes); assertPassive();
    checks.push('a distinct native process restores exactly one Foundation tab, source tab order, active source editor, reversed multiline selection, and unsaved draft bytes');
    checks.push('native group orientation and proportions restore within a 0.5 percentage-point tolerance for pixel rounding');
    checks.push('actual restored Assistant DOM matches the unsent prompt, intent, source picks, task brief inclusion, and disclosure state without submission');
    checks.push('Refine mode resumes without starting a sandbox or runtime; saved source bytes remain unchanged');
    await fs.writeFile(reportPath, JSON.stringify({ ...previous, restoreProcessId: process.pid, rendererAfter, layoutAfter: layout(), geometryAfter, selectionAfter, restoreChecks: checks, restoredInSecondProcess: true }));
  }
}

exports.activate = () => {
  const stage = process.env.FOUNDATION_RESTART_STAGE, workspace = process.env.FOUNDATION_RESTART_WORKSPACE, outcome = process.env.FOUNDATION_RESTART_OUTCOME;
  const folders = vscode.workspace.workspaceFolders || [];
  assert.equal(folders.length, 1); assert.equal(folders[0].uri.fsPath, workspace); assert.ok(workspace.startsWith('/private/tmp/foundation-restart-smoke-')); assert.equal(path.dirname(outcome), path.dirname(workspace));
  setImmediate(async () => {
    let result;
    try { await run(); result = { stage, passed: true }; }
    catch (error) { result = { stage, passed: false, error: error.stack || String(error) }; }
    await fs.writeFile(outcome, JSON.stringify(result, null, 2));
    await vscode.commands.executeCommand('workbench.action.quit');
  });
};
