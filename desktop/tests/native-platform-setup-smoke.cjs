const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, label, timeout = 45000) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await check(); if (value) return value; await pause(80); } throw Error(`Timed out: ${label}`); };
let inspect;
async function run() {
  const stage = process.env.FOUNDATION_SETUP_STAGE, workspace = process.env.FOUNDATION_SETUP_WORKSPACE, reportPath = process.env.FOUNDATION_SETUP_REPORT;
  assert.ok(['write', 'restore'].includes(stage));
  const extension = vscode.extensions.getExtension('foundation.foundation-workspace'); assert.ok(extension);
  assert.equal(await fs.realpath(extension.extensionPath), process.env.FOUNDATION_SETUP_EXTENSION);
  await extension.activate(); inspect = () => extension.exports.inspect();
  assert.ok(process.versions.electron); assert.ok((await fs.realpath(process.execPath)).startsWith(process.env.FOUNDATION_SETUP_APP + '/Contents/'));
  assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('baseUrl'), ''); assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('model'), '');
  for (const key of Object.keys(process.env)) assert.ok(!/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key), 'No AI configuration enters setup acceptance');
  let index = 0;
  const ui = async command => { const id = ++index, ipc = process.env.FOUNDATION_SETUP_IPC; await fs.writeFile(path.join(ipc, `command-${id}.json`), JSON.stringify(command)); const result = await wait(async () => { try { return JSON.parse(await fs.readFile(path.join(ipc, `result-${id}.json`), 'utf8')); } catch { return undefined; } }, `native action ${command.type}`, 60000); assert.equal(result.passed, true, result.error); return result.renderer; };
  const setup = () => inspect().platformSetup;
  const recheckRecoveries = [];
  const check = async (allowSourceEvent = false) => {
    await ui({ type: 'activate', action: 'check' });
    await wait(() => ['complete', 'stale'].includes(setup().phase) && !setup().busy, 'completed or invalidated explicit setup check');
    if (setup().phase === 'stale') {
      assert.equal(allowSourceEvent, true, 'Only the explicit metadata repair may receive a late filesystem invalidation');
      const stale = { phase: setup().phase, reason: setup().reason, ownerKey: setup().ownerKey };
      const renderer = await ui({ type: 'inspect', text: 'Project setup files changed.' });
      recheckRecoveries.push({ stale, renderer });
      // This is a second explicit trusted UI action, after observing the stale
      // outcome. The application never retries or grants stale evidence itself.
      await ui({ type: 'activate', action: 'check' });
      await wait(() => setup().phase === 'complete' && !setup().busy, 'explicit recheck after metadata watcher invalidation');
    }
    return setup().report;
  };
  const noEffects = async () => { assert.equal(inspect().runtime.status, 'idle'); assert.equal(inspect().conversations.conversations.length, 0); await assert.rejects(fs.access(path.join(workspace, 'CONFIG_WAS_EXECUTED')), error => error.code === 'ENOENT'); };
  const originalDraft = await fs.readFile(path.join(workspace, 'src/Draft.ts'), 'utf8');
  const draft = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace, 'src/Draft.ts')));
  const previous = stage === 'restore' ? JSON.parse(await fs.readFile(reportPath, 'utf8')) : undefined;
  if (stage === 'write') {
    await vscode.window.showTextDocument(draft, { preview: false }); const edit = new vscode.WorkspaceEdit(); edit.insert(draft.uri, new vscode.Position(0, 0), '// Unsaved native setup acceptance draft.\n'); assert.equal(await vscode.workspace.applyEdit(edit), true);
  } else {
    assert.notEqual(process.pid, previous.writeProcessId); await wait(() => draft.isDirty, 'native unsaved draft restoration'); assert.equal(draft.getText(), previous.draftText); assert.equal(originalDraft, previous.originalDraft);
  }
  const draftText = draft.getText();
  const preserved = async () => { assert.equal(draft.isDirty, true); assert.equal(draft.getText(), draftText); assert.equal(await fs.readFile(draft.uri.fsPath, 'utf8'), originalDraft); await noEffects(); };
  await vscode.commands.executeCommand('foundation.projectSetup');
  const initial = await ui({ type: 'inspect', text: 'Ready when you are.' });
  assert.equal(setup().phase, 'idle'); assert.equal(setup().report, undefined); assert.equal(setup().busy, false); assert.equal(setup().project.root, workspace);
  assert.equal(initial.buttons.find(button => button.action === 'check').disabled, false); await preserved();
  const first = await check();
  assert.equal(first.schemaVersion, 1); assert.equal(first.status, 'complete'); assert.equal(first.root, workspace);
  for (const kind of ['expo', 'react-native', 'xcode']) assert.ok(first.project.kinds.includes(kind));
  assert.equal(first.project.kinds.includes('swiftui'), false, 'An Xcode marker alone does not prove SwiftUI source');
  for (const id of ['swiftui-runtime', 'expo-runtime']) assert.equal(first.capabilities.find(item => item.id === id).status, 'unavailable');
  for (const id of ['project-build', 'web-runtime']) assert.equal(first.capabilities.find(item => item.id === id).status, 'unverified');
  assert.ok(first.checks.some(item => item.id === 'xcode-version')); assert.ok(first.checks.some(item => item.id === 'simulators'));
  assert.ok(first.project.markers.some(item => item.path === 'app.config.js' && /not evaluated/i.test(item.kind)));
  if (stage === 'restore') {
    assert.equal(first.checks.find(item => item.id === 'package:package.json:expo').status, 'available');
    assert.equal(first.inputFingerprint, previous.finalReport.inputFingerprint);
    await preserved();
    const restored = await ui({ type: 'inspect', text: 'Foundation capabilities' });
    await ui({ type: 'screenshot', name: 'setup-restored', theme: 'Foundation Dark' });
    await fs.writeFile(reportPath, JSON.stringify({ ...previous, restoreProcessId: process.pid, restoredInSecondProcess: true, restoredDraftPreserved: true, restartNoAutomaticChecks: true, restartInitialUI: initial, restoredUI: restored, restoredReport: first, checks: [...previous.checks, 'second native process starts setup idle and preserves unrelated dirty buffer', 'fresh explicit check restores current tooling and metadata without project execution'] }, null, 2));
    return;
  }
  for (const dependency of ['expo', 'react-native']) assert.equal(first.checks.find(item => item.id === 'package:package.json:' + dependency).status, 'missing');
  const missing = await ui({ type: 'inspect', text: 'Next step:' }); await preserved();
  await ui({ type: 'screenshot', name: 'setup-dark', theme: 'Foundation Dark' });
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Foundation Light', vscode.ConfigurationTarget.Global);
  const light = await ui({ type: 'screenshot', name: 'setup-light', theme: 'Foundation Light' });
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Foundation Dark', vscode.ConfigurationTarget.Global);
  await ui({ type: 'inspect' });

  // The native editor owns drafts; setup must expose stale results while a setup
  // input is dirty and must never save it to make a diagnostic easier.
  const packagePath = path.join(workspace, 'package.json'), packageBefore = await fs.readFile(packagePath, 'utf8');
  const manifest = await vscode.workspace.openTextDocument(vscode.Uri.file(packagePath)); await vscode.window.showTextDocument(manifest, { preview: false });
  const edit = new vscode.WorkspaceEdit(); edit.insert(manifest.uri, new vscode.Position(0, 0), ' '); assert.equal(await vscode.workspace.applyEdit(edit), true);
  await wait(() => setup().phase === 'stale' && setup().dirty, 'dirty setup input invalidates report');
  await vscode.commands.executeCommand('foundation.projectSetup'); const dirtyUI = await ui({ type: 'inspect', text: 'Save your changes' });
  assert.equal(dirtyUI.buttons.find(button => button.action === 'check').disabled, true); assert.equal(await fs.readFile(packagePath, 'utf8'), packageBefore); await preserved();
  await vscode.window.showTextDocument(manifest, { preview: false }); await vscode.commands.executeCommand('undo'); assert.equal(manifest.isDirty, false); assert.equal(manifest.getText(), packageBefore);
  await vscode.commands.executeCommand('foundation.projectSetup'); await wait(() => !setup().dirty, 'owned test manifest draft undone');

  // Metadata-only fixture recovery proves local detection, never dependency
  // installation, package compatibility, a real Expo build or native execution.
  for (const [name, version] of [['expo', '55.0.0'], ['react-native', '0.83.0']]) { await fs.mkdir(path.join(workspace, 'node_modules', name), { recursive: true }); await fs.writeFile(path.join(workspace, 'node_modules', name, 'package.json'), JSON.stringify({ name, version })); }
  const appPath = path.join(workspace, 'app.json'), configuration = JSON.parse(await fs.readFile(appPath, 'utf8')); configuration.expo.name = 'Updated readiness metadata'; const ownerBeforeSavedEdit = setup().ownerKey; await fs.writeFile(appPath, JSON.stringify(configuration, null, 2));
  await wait(() => setup().phase === 'stale' && setup().ownerKey !== ownerBeforeSavedEdit, 'new saved input event invalidates prior setup result');
  const recovered = await check(true); assert.notEqual(recovered.inputFingerprint, first.inputFingerprint);
  for (const dependency of ['expo', 'react-native']) assert.equal(recovered.checks.find(item => item.id === 'package:package.json:' + dependency).status, 'available');
  assert.ok(recovered.checks.filter(item => item.id.startsWith('package:')).every(item => /not been verified/i.test(item.detail)));
  const recoveredUI = await ui({ type: 'inspect', text: 'Compatibility and project execution have not been verified.' }); await preserved();
  // Exercise the actual Cancel control during a real local check. The probe
  // runner and controller separately test late completion and cleanup races.
  const cancelledUI = await ui({ type: 'checkCancel' });
  await wait(() => setup().phase === 'cancelled' && !setup().busy, 'owned local check cancellation');
  assert.equal(setup().report, undefined); await preserved();
  const finalReport = await check();
  assert.equal(finalReport.inputFingerprint, recovered.inputFingerprint);
  await ui({ type: 'screenshot', name: 'setup-recovered', theme: 'Foundation Dark' });
  await preserved();
  const sourceHashes = Object.fromEntries(await Promise.all(['src/Draft.ts', 'src/App.tsx', 'app.config.js', 'ios/Orbit.xcodeproj/project.pbxproj'].map(async name => [name, hash(await fs.readFile(path.join(workspace, name)))])));
  await fs.writeFile(reportPath, JSON.stringify({ writeProcessId: process.pid, originalDraft, draftText, sourceHashes, initialReport: first, recoveredReport: recovered, finalReport, missingUI: missing, lightUI: light, dirtyUI, recoveredUI, cancelledUI, recheckRecoveries, providerRequests: 0, projectConfigurationExecuted: false, runtimeStarted: false, checks: ['explicit check observes actual local tools and static Expo/Xcode markers', 'installed tools do not enable unimplemented native adapters', 'missing dependency metadata has recovery guidance', 'light/dark packaged setup inspected', 'dirty setup inputs block checking without source writes', 'saved input changes invalidate prior evidence', 'metadata-only repair is detected by explicit recheck', 'Cancel stops the owned local check and preserves drafts', 'setup never evaluates executable project configuration or invokes a provider'] }, null, 2));
}
exports.activate = () => {
  const workspace = process.env.FOUNDATION_SETUP_WORKSPACE, outcome = process.env.FOUNDATION_SETUP_OUTCOME;
  assert.equal(vscode.workspace.workspaceFolders?.length, 1); assert.equal(vscode.workspace.workspaceFolders[0].uri.fsPath, workspace); assert.match(workspace, /^\/private\/tmp\/foundation-platform-setup-smoke-[A-Za-z0-9]+\/workspace$/); assert.equal(path.dirname(outcome), path.dirname(workspace));
  setImmediate(async () => { let result; try { await run(); result = { passed: true, stage: process.env.FOUNDATION_SETUP_STAGE }; } catch (error) { result = { passed: false, error: error.stack || String(error), stage: process.env.FOUNDATION_SETUP_STAGE }; if (inspect) await fs.writeFile(outcome.replace('.json', '-state.json'), JSON.stringify(inspect(), null, 2)); } await fs.writeFile(outcome, JSON.stringify(result, null, 2)); await vscode.commands.executeCommand('workbench.action.quit'); });
};
