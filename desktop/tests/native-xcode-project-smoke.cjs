const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, label, timeout = 60000) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await check(); if (value) return value; await pause(80); } throw Error(`Timed out: ${label}`); };
let inspect;
async function run() {
  const stage = process.env.FOUNDATION_XCODE_STAGE, workspace = process.env.FOUNDATION_XCODE_WORKSPACE;
  const reportPath = process.env.FOUNDATION_XCODE_REPORT, destinationId = process.env.FOUNDATION_XCODE_DESTINATION_ID;
  assert.ok(['write', 'restore'].includes(stage));
  const extension = vscode.extensions.getExtension('foundation.foundation-workspace'); assert.ok(extension);
  assert.equal(await fs.realpath(extension.extensionPath), process.env.FOUNDATION_XCODE_EXTENSION);
  await extension.activate(); inspect = () => extension.exports.inspect();
  assert.ok(process.versions.electron); assert.ok((await fs.realpath(process.execPath)).startsWith(process.env.FOUNDATION_XCODE_APP + '/Contents/'));
  assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('baseUrl'), ''); assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('model'), '');
  for (const key of Object.keys(process.env)) assert.ok(!/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key), 'No AI configuration enters Xcode acceptance');
  let index = 0;
  const ui = async command => { const id = ++index, ipc = process.env.FOUNDATION_XCODE_IPC; await fs.writeFile(path.join(ipc, `command-${id}.json`), JSON.stringify(command)); const result = await wait(async () => { try { return JSON.parse(await fs.readFile(path.join(ipc, `result-${id}.json`), 'utf8')); } catch { return undefined; } }, `native action ${command.type}`, 180000); assert.equal(result.passed, true, result.error); return result.renderer; };
  const state = () => inspect().xcodeProject;
  const noEffects = () => { assert.equal(inspect().runtime.status, 'idle'); assert.equal(inspect().conversations.conversations.length, 0); };
  const draftPath = path.join(path.dirname(workspace), 'unrelated-draft.txt');
  const originalDraft = await fs.readFile(draftPath, 'utf8'), draft = await vscode.workspace.openTextDocument(vscode.Uri.file(draftPath));
  const previous = stage === 'restore' ? JSON.parse(await fs.readFile(reportPath, 'utf8')) : undefined;
  if (stage === 'write') {
    await vscode.window.showTextDocument(draft, { preview: false }); const edit = new vscode.WorkspaceEdit(); edit.insert(draft.uri, new vscode.Position(0, 0), 'Unsaved Xcode acceptance draft.\n'); assert.equal(await vscode.workspace.applyEdit(edit), true);
  } else {
    assert.notEqual(process.pid, previous.writeProcessId); await wait(() => draft.isDirty, 'native unsaved draft restoration'); assert.equal(draft.getText(), previous.draftText); assert.equal(originalDraft, previous.originalDraft);
  }
  const draftText = draft.getText();
  const preserved = async () => { assert.equal(draft.isDirty, true); assert.equal(draft.getText(), draftText); assert.equal(await fs.readFile(draftPath, 'utf8'), originalDraft); noEffects(); };
  await vscode.commands.executeCommand('foundation.xcodeProject');
  const initialUI = await ui({ type: 'inspect', text: 'Discover a project to choose what to build.' });
  assert.equal(state().phase, 'idle'); assert.equal(state().catalog, undefined); assert.equal(state().busy, false); assert.equal(state().project.root, workspace); assert.deepEqual(state().results, {}); assert.equal(state().trusted, true); assert.equal(state().dirty, false);
  for (const action of ['build', 'test']) assert.equal(initialUI.buttons.find(button => button.action === action).disabled, true);
  assert.equal(initialUI.buttons.find(button => button.action === 'discover').disabled, false); await preserved();
  const discover = async () => {
    await ui({ type: 'discover' });
    await wait(() => state().phase === 'ready' && !state().busy, 'explicit native discovery');
    const catalog = state().catalog;
    assert.equal(catalog.status, 'complete'); assert.equal(catalog.root, workspace); assert.equal(catalog.projectPath, 'FoundationOrbit.xcodeproj'); assert.equal(catalog.selectedScheme, 'FoundationOrbit');
    assert.equal(state().destinationId, destinationId);
    const destination = catalog.destinations.find(item => item.id === destinationId); assert.ok(destination); assert.equal(destination.platform, 'iOS Simulator'); assert.equal(destination.kind, 'simulator'); assert.equal(destination.testEligible, true);
    assert.match(catalog.languageTooling.detail, /not integrated or verified/i, 'Toolchain detection does not claim editor integration');
    assert.deepEqual(state().results, {}, 'Discovery does not automatically build or test');
    return catalog;
  };
  const firstCatalog = await discover();
  if (stage === 'restore') {
    assert.equal(firstCatalog.inputFingerprint, previous.firstCatalog.inputFingerprint);
    await preserved(); const restoredUI = await ui({ type: 'screenshot', name: 'xcode-restored', theme: 'Foundation Dark' });
    await fs.writeFile(reportPath, JSON.stringify({ ...previous, restoreProcessId: process.pid, restoredInSecondProcess: true, restoredDraftPreserved: true, restartNoAutomaticChecks: true, restartNoAutomaticOperations: true, restartInitialUI: initialUI, restoredUI, restoredCatalog: firstCatalog, checks: [...previous.checks, 'second native process preserves the unrelated draft and starts without discovery, build or tests', 'explicit rediscovery returns the original saved source fingerprint without executing build or tests'] }, null, 2));
    return;
  }
  const runOperation = async action => {
    const previousId = state().results[action]?.id;
    await ui({ type: 'activate', action, key: action === 'test' ? ' ' : 'Enter' });
    await wait(() => !state().busy && state().results[action]?.id && state().results[action].id !== previousId, `completed native ${action}`, 300000);
    const result = state().results[action];
    assert.equal(result.status, 'passed', JSON.stringify(result)); assert.equal(result.action, action); assert.equal(result.root, workspace); assert.equal(result.destination.id, destinationId); assert.equal(result.scheme, 'FoundationOrbit'); assert.equal(result.sourceCurrent, true); assert.equal(result.exitCode, 0); assert.equal(result.inputFingerprint, result.endFingerprint);
    assert.ok(result.artifacts); assert.equal(path.relative(workspace, result.artifacts.directory).startsWith('..'), true, 'Outputs are outside the selected source tree');
    assert.match(path.basename(result.artifacts.directory), /^foundation-xcode-[A-Za-z0-9]+$/); assert.equal(result.artifacts.derivedData, path.join(result.artifacts.directory, 'DerivedData')); assert.equal(result.artifacts.resultBundle, path.join(result.artifacts.directory, `${action}.xcresult`));
    assert.equal((await fs.stat(result.artifacts.derivedData)).isDirectory(), true); assert.equal((await fs.stat(result.artifacts.resultBundle)).isDirectory(), true);
    assert.match(result.stdout + result.stderr, action === 'build' ? /\*\* BUILD SUCCEEDED \*\*/ : /\*\* TEST SUCCEEDED \*\*/);
    if (action === 'test') assert.match(result.stdout + result.stderr, /Executed 7 tests, with 0 failures/);
    await preserved(); return result;
  };
  const build = await runOperation('build');
  assert.equal(state().results.test, undefined, 'A successful build does not manufacture a test outcome');
  const test = await runOperation('test');
  assert.equal(state().results.build.id, build.id); assert.notEqual(build.id, test.id); assert.notEqual(build.artifacts.directory, test.artifacts.directory); assert.equal(test.inputFingerprint, build.inputFingerprint);
  const darkUI = await ui({ type: 'screenshot', name: 'xcode-dark', theme: 'Foundation Dark' });
  assert.match(darkUI.text, /Compilation and tests have separate outcomes/);
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Foundation Light', vscode.ConfigurationTarget.Global);
  const lightUI = await ui({ type: 'screenshot', name: 'xcode-light', theme: 'Foundation Light' });
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Foundation Dark', vscode.ConfigurationTarget.Global);
  await ui({ type: 'inspect' });

  // Only this disposable fixture's editor is changed. The unrelated draft stays dirty.
  const sourcePath = path.join(workspace, 'FoundationOrbit/ProfileView.swift');
  const originalSource = await fs.readFile(sourcePath, 'utf8'), source = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
  await vscode.window.showTextDocument(source, { preview: false });
  const edit = new vscode.WorkspaceEdit(); edit.insert(source.uri, new vscode.Position(0, 0), '// Owned native acceptance draft.\n'); assert.equal(await vscode.workspace.applyEdit(edit), true);
  await wait(() => state().phase === 'stale' && state().dirty, 'dirty Swift source invalidates evidence');
  await vscode.commands.executeCommand('foundation.xcodeProject');
  const dirtyUI = await ui({ type: 'inspect', text: 'Save your changes' });
  for (const action of ['discover', 'build', 'test']) assert.equal(dirtyUI.buttons.find(button => button.action === action).disabled, true);
  assert.match(dirtyUI.text, /Historical result — source has changed/); assert.equal(state().results.build.id, build.id); assert.equal(state().results.test.id, test.id); assert.equal(await fs.readFile(sourcePath, 'utf8'), originalSource); await preserved();
  await vscode.window.showTextDocument(source, { preview: false }); await vscode.commands.executeCommand('undo'); assert.equal(source.isDirty, false); assert.equal(source.getText(), originalSource);
  await vscode.commands.executeCommand('foundation.xcodeProject'); await wait(() => !state().dirty, 'owned Swift draft undone');

  // Wait for the actual new invalidation owner, never an already-stale phase.
  const ownerBeforeSavedEdit = state().ownerKey;
  await fs.writeFile(sourcePath, originalSource + '\n// Native acceptance saved source mutation.\n');
  await wait(() => state().phase === 'stale' && state().ownerKey !== ownerBeforeSavedEdit, 'new saved source invalidates earlier evidence');
  const savedStaleUI = await ui({ type: 'inspect', text: 'Historical result — source has changed.' });
  const changedCatalog = await discover(); assert.notEqual(changedCatalog.inputFingerprint, firstCatalog.inputFingerprint); await preserved();
  const ownerBeforeRestoration = state().ownerKey; await fs.writeFile(sourcePath, originalSource);
  await wait(() => state().phase === 'stale' && state().ownerKey !== ownerBeforeRestoration, 'restored source invalidates changed catalog');
  const restoredSourceCatalog = await discover(); assert.equal(restoredSourceCatalog.inputFingerprint, firstCatalog.inputFingerprint);

  const cancelledUI = await ui({ type: 'cancelBuild' });
  await wait(() => !state().busy && state().results.build?.status === 'cancelled', 'actual Xcode process cancellation and cleanup');
  const cancelled = state().results.build; assert.equal(cancelled.action, 'build'); assert.equal(cancelled.sourceCurrent, true); assert.equal(cancelled.inputFingerprint, firstCatalog.inputFingerprint); assert.ok(cancelled.artifacts);
  assert.ok(cancelledUI.ownedXcodeBeforeCancel.includes(workspace));
  const cancelledPid = Number(cancelledUI.ownedXcodeBeforeCancel.match(/^\d+/)?.[0]); assert.ok(Number.isInteger(cancelledPid) && cancelledPid > 1);
  await wait(() => { try { process.kill(cancelledPid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } }, 'owned xcodebuild exits before retry');
  await preserved();
  const retryBuild = await runOperation('build'); assert.notEqual(retryBuild.id, cancelled.id); assert.equal(retryBuild.inputFingerprint, firstCatalog.inputFingerprint);
  const recoveredUI = await ui({ type: 'screenshot', name: 'xcode-recovered', theme: 'Foundation Dark' });
  await preserved(); assert.equal(await fs.readFile(sourcePath, 'utf8'), originalSource);
  await fs.writeFile(reportPath, JSON.stringify({ writeProcessId: process.pid, originalDraft, draftText, sourceHash: hash(originalSource), sourcePath, initialUI, firstCatalog, build, test, darkUI, lightUI, dirtyUI, savedStaleUI, changedCatalog, restoredSourceCatalog, cancelledUI, cancelled, cancelledPid, ownedBuildProcessExited: true, retryBuild, recoveredUI, providerRequests: 0, foundationWebRuntimeStarted: false, swiftEditorIntegrationVerified: false, checks: ['native project, scheme and owned iOS Simulator selection through QuickPicks', 'actual app compilation has its own source-bound successful outcome', 'actual 7-test XCTest run has an independent successful outcome and result bundle', 'dark and light packaged Xcode Project surfaces inspected', 'dirty Swift source blocks discovery, build and tests without saving drafts', 'saved source mutation makes evidence historical and changes the next catalog fingerprint', 'exact source restoration recovers the original fingerprint', 'Cancel stops an observed owned xcodebuild and awaits process exit', 'fresh explicit Build succeeds after cancellation', 'unrelated unsaved editor draft and saved fixture contents remain intact'] }, null, 2));
}
exports.activate = () => {
  const workspace = process.env.FOUNDATION_XCODE_WORKSPACE, outcome = process.env.FOUNDATION_XCODE_OUTCOME;
  assert.equal(vscode.workspace.workspaceFolders?.length, 1); assert.equal(vscode.workspace.workspaceFolders[0].uri.fsPath, workspace); assert.match(workspace, /^\/private\/tmp\/foundation-xcode-project-smoke-[A-Za-z0-9]+\/workspace$/); assert.equal(path.dirname(outcome), path.dirname(workspace));
  setImmediate(async () => { let result; try { await run(); result = { passed: true, stage: process.env.FOUNDATION_XCODE_STAGE }; } catch (error) { result = { passed: false, error: error.stack || String(error), stage: process.env.FOUNDATION_XCODE_STAGE }; if (inspect) await fs.writeFile(outcome.replace('.json', '-state.json'), JSON.stringify(inspect(), null, 2)); } await fs.writeFile(outcome, JSON.stringify(result, null, 2)); await vscode.commands.executeCommand('workbench.action.quit'); });
};
