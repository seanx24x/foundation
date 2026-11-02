const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');

const members = ['src/App.tsx', 'src/Button.tsx', 'src/api.ts', 'src/styles.css', 'src/Button.test.ts'];
const title = 'Profile save behavior';
const brief = 'Make saving a profile clear across idle, loading, success, and error states. Preserve typed input after failure.';
const primary = 'src/App.tsx';
const wait = async (check, label, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
};
const hashes = async root => Object.fromEntries(await Promise.all([...members, 'src/Draft.ts'].map(async name =>
  [name, createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex')])));

async function run() {
  const stage = process.env.FOUNDATION_FEATURE_STAGE;
  const report = process.env.FOUNDATION_FEATURE_REPORT;
  const root = process.env.FOUNDATION_FEATURE_WORKSPACE;
  assert.ok(stage === 'write' || stage === 'restore');
  const settings = vscode.workspace.getConfiguration('foundation.ai');
  assert.equal(settings.get('baseUrl'), ''); assert.equal(settings.get('model'), '');
  for (const key of Object.keys(process.env)) assert.ok(!key.startsWith('FOUNDATION_AI_'), 'No provider environment configuration enters the native fixture');
  const extension = vscode.extensions.getExtension('foundation.foundation-workspace');
  assert.ok(extension);
  assert.equal(await fs.realpath(extension.extensionPath), process.env.FOUNDATION_FEATURE_EXTENSION);
  await extension.activate(); await vscode.commands.executeCommand('foundation.refresh');
  const initial = extension.exports.inspect();
  assert.ok(initial.features); assert.equal(initial.features.storage.status, 'saved');
  const beforeFiles = await hashes(root);
  let feature, originalDraft, draft;
  const checks = [];
  try {
    if (stage === 'write') {
      assert.equal(initial.features.features.length, 0); assert.equal(initial.features.activeId, null);
      draft = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'src/Draft.ts')));
      originalDraft = draft.getText();
      await vscode.window.showTextDocument(draft, { preview: false });
      const edit = new vscode.WorkspaceEdit(); edit.insert(draft.uri, new vscode.Position(0, 0), '// Unsaved harness draft; never part of feature context.\n');
      assert.equal(await vscode.workspace.applyEdit(edit), true); assert.equal(draft.isDirty, true);
      const draftText = draft.getText();
      const created = await vscode.commands.executeCommand('foundation.newFeature', { title, brief, paths: members, entryPath: primary });
      feature = created.features.find(item => item.id === created.activeId);
      assert.ok(feature); assert.equal(created.storage.status, 'saved');
      assert.equal(feature.title, title); assert.equal(feature.brief, brief); assert.deepEqual(feature.paths, members); assert.equal(feature.entryPath, primary);
      assert.equal(draft.getText(), draftText); assert.equal(draft.isDirty, true);
      checks.push('populated feature saved without changing the unrelated in-memory draft');
      await vscode.commands.executeCommand('foundation.selectFeature', null);
      assert.equal(extension.exports.inspect().features.activeId, null); assert.equal(extension.exports.inspect().featureFiles.length, 0);
      await vscode.commands.executeCommand('foundation.selectFeature', feature.id);
      assert.equal(extension.exports.inspect().features.activeId, feature.id);
      assert.equal(draft.getText(), draftText); assert.equal(draft.isDirty, true);
      checks.push('explicit deselect and reselect preserve feature identity and draft');
    } else {
      const previous = JSON.parse(await fs.readFile(report, 'utf8'));
      assert.notEqual(process.pid, previous.writeProcessId, 'Durability is checked in a second native extension host');
      feature = initial.features.features.find(item => item.id === initial.features.activeId);
      assert.deepEqual(feature, previous.feature); assert.equal(initial.features.activeId, previous.activeId);
      assert.equal(initial.features.features.length, 1); assert.equal(initial.features.revision, previous.revision);
      assert.deepEqual(beforeFiles, previous.sourceHashes);
      checks.push('second native process restores exact title, brief, members, primary file, active feature, and revision');
    }
    const loaded = extension.exports.inspect();
    assert.deepEqual(loaded.featureFiles.map(item => item.path), members);
    assert.deepEqual(loaded.featureUnavailable, []);
    assert.ok(loaded.featureFiles.every(item => typeof item.source === 'string' && item.revision === createHash('sha256').update(item.source).digest('hex').slice(0, 16)));
    assert.equal(loaded.runtime.status, 'idle'); assert.equal(loaded.proposal, null);
    checks.push('all five saved source files load with revisions and no runtime or proposal side effect');
    await vscode.commands.executeCommand('foundation.openFeatureEntry');
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, path.join(root, primary));
    checks.push('primary file opens in the native source editor');
    const prepared = await vscode.commands.executeCommand('foundation.prepareFeatureContext');
    assert.equal(prepared.activeId, feature.id); assert.equal(prepared.storage.status, 'saved');
    await wait(() => extension.exports.inspect().assistantSurface.visible, 'native Assistant visibility');
    assert.equal(extension.exports.inspect().conversations.conversations.length, 0, 'Preparing context must not create or dispatch an AI turn');
    checks.push('explicit context preparation opens native Assistant without a provider request or conversation');
    if (draft) {
      assert.equal(draft.isDirty, true); assert.ok(draft.getText().startsWith('// Unsaved harness draft;'));
      // Undo only the test's own buffer edit, leaving a clean disposable profile
      // for graceful shutdown. Feature commands never save or revert this draft.
      await vscode.window.showTextDocument(draft, { preview: false });
      await vscode.commands.executeCommand('undo');
      assert.equal(draft.getText(), originalDraft); assert.equal(draft.isDirty, false);
    }
    const afterFiles = await hashes(root); assert.deepEqual(afterFiles, beforeFiles);
    checks.push('every source file remains byte-for-byte unchanged');
    if (stage === 'write') {
      await fs.writeFile(report, JSON.stringify({ feature, activeId: feature.id, revision: extension.exports.inspect().features.revision,
        sourceHashes: afterFiles, extensionPath: extension.extensionPath, writeProcessId: process.pid, writeChecks: checks,
        storage: 'saved', providerRequests: 0, runtimeStarted: false }));
    } else {
      const previous = JSON.parse(await fs.readFile(report, 'utf8'));
      await fs.writeFile(report, JSON.stringify({ ...previous, restoreProcessId: process.pid, restoreChecks: checks,
        restoredInSecondProcess: true, assistantPreparedAfterRestart: true, sourceFilesLoadedAfterRestart: members.length,
        nativeVisualAcceptance: 'not performed by this automated check' }));
    }
  } finally {
    if (draft?.isDirty) {
      // Cleanup is confined to this harness-owned temporary document.
      await vscode.window.showTextDocument(draft, { preview: false });
      await vscode.commands.executeCommand('workbench.action.files.revert');
    }
  }
}

exports.activate = () => {
  const stage = process.env.FOUNDATION_FEATURE_STAGE;
  const outcome = process.env.FOUNDATION_FEATURE_OUTCOME;
  const workspace = process.env.FOUNDATION_FEATURE_WORKSPACE;
  const folders = vscode.workspace.workspaceFolders || [];
  assert.equal(folders.length, 1); assert.equal(folders[0].uri.fsPath, workspace);
  assert.ok(workspace.startsWith('/private/tmp/foundation-feature-smoke-'));
  assert.equal(path.dirname(outcome), path.dirname(workspace));
  setImmediate(async () => {
    let result;
    try { await run(); result = { stage, passed: true }; }
    catch (error) { result = { stage, passed: false, error: error?.stack || String(error) }; }
    try { await fs.writeFile(outcome, JSON.stringify(result, null, 2)); }
    finally { await vscode.commands.executeCommand('workbench.action.quit'); }
  });
};
