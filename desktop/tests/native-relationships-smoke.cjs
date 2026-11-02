const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, label, timeout = 30000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await check(); if (value) return value; await pause(100); } throw new Error(`Timed out: ${label}`); };
const memberPaths = ['src/SaveButton.tsx', 'src/App.tsx'], primary = memberPaths[0];
const fixturePaths = ['package.json', 'src/App.tsx', 'src/SaveButton.tsx', 'src/api.ts', 'src/types.ts', 'src/styles.css', 'src/SaveButton.test.ts', 'src/SaveButton.spec.tsx', 'src/Draft.ts'];

async function run() {
  const workspace = process.env.FOUNDATION_RELATIONSHIPS_WORKSPACE, reportPath = process.env.FOUNDATION_RELATIONSHIPS_REPORT;
  const extension = vscode.extensions.getExtension('foundation.foundation-workspace'); assert.ok(extension);
  assert.equal(await fs.realpath(extension.extensionPath), process.env.FOUNDATION_RELATIONSHIPS_EXTENSION); await extension.activate();
  assert.ok(process.versions.electron); assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('baseUrl'), ''); assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('model'), '');
  assert.ok(Object.keys(process.env).every(key => !/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key)));
  const inspect = () => extension.exports.inspect(), state = () => inspect().featureRelationships;
  const ready = async (anchor = primary) => wait(() => { const value = state(); return value?.status === 'ready' && value.anchorPath === anchor && value.snapshotId && value; }, 'current source-backed relationships');
  const hashes = async () => Object.fromEntries(await Promise.all(fixturePaths.map(async name => [name, createHash('sha256').update(await fs.readFile(path.join(workspace, name))).digest('hex')])));
  const initialHashes = await hashes(), apiPath = path.join(workspace, 'src/api.ts'), originalAPI = await fs.readFile(apiPath, 'utf8');
  let commandIndex = 0;
  const ui = async command => {
    const index = ++commandIndex, ipc = process.env.FOUNDATION_RELATIONSHIPS_IPC;
    await fs.writeFile(path.join(ipc, `command-${index}.json`), JSON.stringify(command));
    const result = await wait(async () => { try { return JSON.parse(await fs.readFile(path.join(ipc, `result-${index}.json`), 'utf8')); } catch {} }, 'actual relationship renderer action', 60000);
    assert.equal(result.passed, true, result.error); return result.renderer;
  };
  const checks = [];
  await vscode.commands.executeCommand('workbench.action.closeAllEditors'); await vscode.commands.executeCommand('foundation.understand');
  await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] });
  const draft = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace, 'src/Draft.ts')));
  const draftEditor = await vscode.window.showTextDocument(draft, { viewColumn: vscode.ViewColumn.Two, preview: false });
  const edit = new vscode.WorkspaceEdit(); edit.insert(draft.uri, new vscode.Position(0, 0), '// Unrelated unsaved fixture draft.\n'); assert.equal(await vscode.workspace.applyEdit(edit), true);
  draftEditor.selection = new vscode.Selection(0, 3, 1, 9); const draftText = draft.getText();
  const created = await vscode.commands.executeCommand('foundation.newFeature', { title: 'Profile save relationships', brief: 'Understand source dependencies without running or changing the product.', paths: memberPaths, entryPath: primary });
  const originalFeature = structuredClone(created.features.find(item => item.id === created.activeId));
  // Creating a feature intentionally reveals Understand. Test passive analysis only after restoring the editor.
  await vscode.window.showTextDocument(draft, { viewColumn: vscode.ViewColumn.Two, preview: false });
  await vscode.commands.executeCommand('foundation.refresh');
  let current = await ready();
  assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, draft.uri.fsPath); assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, 2);
  assert.equal(draft.isDirty, true); assert.equal(draft.getText(), draftText); assert.equal(inspect().runtime.status, 'idle'); assert.equal(inspect().design.status, 'idle');
  assert.ok(current.snapshot.edges.some(edge => edge.kind === 'render' && edge.from.path === 'src/App.tsx'));
  assert.ok(current.snapshot.edges.some(edge => edge.kind === 'type-reference' && edge.to.path === 'src/types.ts'));
  assert.ok(current.snapshot.edges.some(edge => edge.kind === 'stylesheet' && edge.to.path === 'src/styles.css'));
  assert.ok(current.snapshot.edges.every(edge => edge.provenance === 'source'));
  let call = current.snapshot.edges.find(edge => edge.kind === 'call' && edge.to.path === 'src/api.ts'); assert.ok(call);
  const initialView = await ui({ type: 'inspect', expectedSource: primary }); assert.match(initialView.text, /From source/); assert.ok(initialView.rows.some(row => row.id === call.id));
  checks.push('real source analysis finds render, call, type, and stylesheet relationships without moving the active dirty source editor or starting AI/runtime');
  await ui({ type: 'definition', evidenceId: call.id });
  await wait(() => vscode.window.activeTextEditor?.document.uri.fsPath === apiPath, 'native source definition navigation');
  assert.equal(vscode.window.activeTextEditor.selection.active.line, call.to.line - 1); assert.equal(vscode.window.activeTextEditor.selection.active.character, call.to.column - 1);
  checks.push('actual definition control opens the verified native source coordinate');
  await vscode.window.showTextDocument(draft, { viewColumn: vscode.ViewColumn.Two, preview: false });
  await ui({ type: 'explore', path: 'src/api.ts', expectedSource: 'src/api.ts' }); current = await ready('src/api.ts');
  const request = current.snapshot.requests.find(item => item.url === '/api/profile' && item.method === 'POST'); assert.ok(request); assert.equal(request.provenance, 'source');
  const apiView = await ui({ type: 'inspect', expectedSource: 'src/api.ts' }); assert.match(apiView.text, /Runtime results are separate/); assert.doesNotMatch(apiView.text, /PRIVATE_QUERY_VALUE/);
  assert.deepEqual(inspect().features.features.find(item => item.id === originalFeature.id), originalFeature);
  await ui({ type: 'back', expectedSource: primary }); current = await ready();
  assert.deepEqual(current.trail, [primary]); call = current.snapshot.edges.find(edge => edge.kind === 'call' && edge.to.path === 'src/api.ts');
  checks.push('Explore and Back inspect sanitized request expressions while preserving feature membership and keeping runtime outcomes unverified');
  const apiDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(apiPath));
  const apiEdit = new vscode.WorkspaceEdit(); apiEdit.insert(apiDocument.uri, new vscode.Position(0, 0), '// Unsaved target fixture draft.\n'); assert.equal(await vscode.workspace.applyEdit(apiEdit), true);
  await wait(() => state()?.dirtyPaths.includes('src/api.ts'), 'dirty evidence source visibility');
  current = await ready(); call = current.snapshot.edges.find(edge => edge.kind === 'call' && edge.to.path === 'src/api.ts'); assert.ok(call);
  const dirtyView = await ui({ type: 'inspect', expectedSource: primary }), dirtyRow = dirtyView.rows.find(row => row.id === call.id);
  assert.ok(dirtyRow); assert.equal(dirtyRow.sourceDisabled, true); assert.equal(dirtyRow.definitionDisabled, true); assert.equal(draft.getText(), draftText);
  await vscode.window.showTextDocument(apiDocument, { viewColumn: vscode.ViewColumn.Two, preview: false });
  assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, apiPath); await vscode.commands.executeCommand('workbench.action.files.revert');
  await vscode.window.showTextDocument(draft, { viewColumn: vscode.ViewColumn.Two, preview: false });
  await wait(() => !state()?.dirtyPaths.includes('src/api.ts'), 'fixture-only target draft reversion');
  current = await ready(); call = current.snapshot.edges.find(edge => edge.kind === 'call' && edge.to.path === 'src/api.ts'); assert.ok(call);
  const recoveredView = await ui({ type: 'inspect', expectedSource: primary }); assert.equal(recoveredView.rows.find(row => row.id === call.id).definitionDisabled, false);
  checks.push('dirty supporting source disables exact evidence controls; reverting only the fixture target reenables them while the unrelated draft remains unsaved');
  const oldSnapshotId = state().snapshotId, oldCallId = call.id;
  try {
    await fs.writeFile(apiPath, originalAPI.replace('function saveProfile', 'function unavailableProfile'));
    await wait(() => state()?.status === 'ready' && state().snapshotId !== oldSnapshotId && !state().snapshot.edges.some(edge => edge.kind === 'call' && edge.to.path === 'src/api.ts'), 'changed source retires obsolete call evidence');
    const changedView = await ui({ type: 'inspect', expectedSource: primary }); assert.equal(changedView.rows.some(row => row.id === oldCallId), false);
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, draft.uri.fsPath); assert.equal(draft.getText(), draftText);
  } finally { await fs.writeFile(apiPath, originalAPI); }
  await wait(() => state()?.status === 'ready' && state().snapshot.edges.some(edge => edge.kind === 'call' && edge.to.path === 'src/api.ts'), 'restored saved source rebuilds usable evidence');
  const beforeRefreshId = state().snapshotId; await ui({ type: 'refresh', expectedSource: primary });
  await wait(() => state()?.status === 'ready' && state().snapshotId !== beforeRefreshId, 'explicit relationship refresh');
  call = state().snapshot.edges.find(edge => edge.kind === 'call' && edge.to.path === 'src/api.ts');
  await ui({ type: 'source', evidenceId: call.id });
  await wait(() => vscode.window.activeTextEditor?.document.uri.fsPath === path.join(workspace, call.from.path), 'fresh source evidence navigation');
  assert.equal(vscode.window.activeTextEditor.selection.active.line, call.from.line - 1); assert.equal(vscode.window.activeTextEditor.selection.active.character, call.from.column - 1);
  checks.push('saved source changes retire obsolete evidence controls; restored source and explicit Refresh produce newly validated source navigation');
  await ui({ type: 'explore', path: 'src/api.ts', expectedSource: 'src/api.ts' }); await ready('src/api.ts'); await ui({ type: 'reset', expectedSource: primary }); await ready();
  assert.deepEqual(inspect().features.features.find(item => item.id === originalFeature.id), originalFeature); assert.deepEqual(state().trail, [primary]);
  await vscode.window.showTextDocument(draft, { viewColumn: vscode.ViewColumn.Two, preview: false });
  assert.equal(draft.isDirty, true); assert.equal(draft.getText(), draftText); assert.deepEqual(await hashes(), initialHashes);
  assert.equal(inspect().conversations.conversations.length, 0); assert.equal(inspect().runtime.status, 'idle'); assert.equal(inspect().design.status, 'idle'); assert.equal(inspect().proposal, null);
  await fs.writeFile(reportPath, JSON.stringify({ processId: process.pid, checks, feature: originalFeature, finalAnchor: state().anchorPath, finalTrail: state().trail,
    initialEvidenceLabels: [...new Set(initialView.rows.map(row => row.sourceLabel))], sourceHashes: initialHashes, sourcePreserved: true,
    unrelatedDraftPreserved: true, providerRequests: 0, runtimeStarted: false, interpretation: 'Static source evidence only; no runtime behavior or test execution is inferred.' }));
}

exports.activate = () => {
  const workspace = process.env.FOUNDATION_RELATIONSHIPS_WORKSPACE, outcome = process.env.FOUNDATION_RELATIONSHIPS_OUTCOME;
  const folders = vscode.workspace.workspaceFolders || [];
  assert.equal(folders.length, 1); assert.equal(folders[0].uri.fsPath, workspace); assert.ok(workspace.startsWith('/private/tmp/foundation-relationships-smoke-')); assert.equal(path.dirname(outcome), path.dirname(workspace));
  setImmediate(async () => {
    let result; try { await run(); result = { passed: true }; } catch (error) { result = { passed: false, error: error.stack || String(error) }; }
    await fs.writeFile(outcome, JSON.stringify(result, null, 2)); await vscode.commands.executeCommand('workbench.action.quit');
  });
};
