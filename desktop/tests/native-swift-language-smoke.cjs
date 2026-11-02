const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = text => createHash('sha256').update(text).digest('hex');
const wait = async (check, label, timeout = 60000, interval = 50) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await check(); if (value) return value; await pause(interval); } throw Error(`Timed out: ${label}`); };
let inspect;
async function run() {
  const stage = process.env.FOUNDATION_SWIFT_STAGE, workspace = process.env.FOUNDATION_SWIFT_WORKSPACE, reportPath = process.env.FOUNDATION_SWIFT_REPORT;
  assert.ok(['write', 'restore'].includes(stage));
  const extension = vscode.extensions.getExtension('foundation.foundation-workspace'); assert.ok(extension);
  assert.equal(await fs.realpath(extension.extensionPath), process.env.FOUNDATION_SWIFT_EXTENSION);
  await extension.activate(); inspect = () => extension.exports.inspect();
  assert.ok(process.versions.electron); assert.ok((await fs.realpath(process.execPath)).startsWith(process.env.FOUNDATION_SWIFT_APP + '/Contents/'));
  assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('baseUrl'), ''); assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('model'), '');
  for (const key of Object.keys(process.env)) assert.ok(!/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key));
  let index = 0;
  const ui = async command => { const id = ++index, ipc = process.env.FOUNDATION_SWIFT_IPC; await fs.writeFile(path.join(ipc, `command-${id}.json`), JSON.stringify(command)); const result = await wait(async () => { try { return JSON.parse(await fs.readFile(path.join(ipc, `result-${id}.json`), 'utf8')); } catch { return undefined; } }, `native Swift action ${command.type}`, 240000); assert.equal(result.passed, true, result.error); return result.renderer; };
  const state = () => inspect().swiftLanguage, xcode = () => inspect().xcodeProject;
  const snapshot = () => JSON.parse(JSON.stringify(state()));
  const noEffects = () => { assert.equal(inspect().runtime.status, 'idle'); assert.equal(inspect().conversations.conversations.length, 0); };
  const draftPath = path.join(path.dirname(workspace), 'unrelated-draft.txt');
  const originalDraft = await fs.readFile(draftPath, 'utf8'), draft = await vscode.workspace.openTextDocument(vscode.Uri.file(draftPath));
  const previous = stage === 'restore' ? JSON.parse(await fs.readFile(reportPath, 'utf8')) : undefined;
  if (stage === 'write') {
    await vscode.window.showTextDocument(draft, { preview: false }); const edit = new vscode.WorkspaceEdit(); edit.insert(draft.uri, new vscode.Position(0, 0), 'Unsaved Swift language acceptance draft.\n'); assert.equal(await vscode.workspace.applyEdit(edit), true);
  } else {
    assert.notEqual(process.pid, previous.writeProcessId); await wait(() => draft.isDirty, 'unrelated dirty draft restored'); assert.equal(draft.getText(), previous.draftText); assert.equal(originalDraft, previous.originalDraft);
  }
  const draftText = draft.getText();
  const sourcePath = path.join(workspace, 'FoundationOrbit/ProfileView.swift'), storePath = path.join(workspace, 'FoundationOrbit/ProfileStore.swift');
  const originalStore = await fs.readFile(storePath, 'utf8');
  const originalSource = await fs.readFile(sourcePath, 'utf8'), source = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
  assert.equal(source.languageId, 'swift');
  const preserved = async () => { assert.equal(draft.isDirty, true); assert.equal(draft.getText(), draftText); assert.equal(await fs.readFile(draftPath, 'utf8'), originalDraft); assert.equal(await fs.readFile(sourcePath, 'utf8'), originalSource); assert.equal(await fs.readFile(storePath, 'utf8'), originalStore); noEffects(); };
  const editorAt = async (text, offset = 0, length = 0) => {
    const editor = await vscode.window.showTextDocument(source, { preview: false, viewColumn: vscode.ViewColumn.One });
    const start = source.getText().indexOf(text); assert.ok(start >= 0, `Fixture location ${text}`);
    const a = source.positionAt(start + offset), b = source.positionAt(start + offset + length);
    editor.selection = new vscode.Selection(a, b); editor.revealRange(new vscode.Range(a, b), vscode.TextEditorRevealType.InCenter); return { editor, position: a };
  };
  const replaceSource = async text => {
    const editor = await vscode.window.showTextDocument(source, { preview: false, viewColumn: vscode.ViewColumn.One });
    assert.equal(await editor.edit(edit => edit.replace(new vscode.Range(source.positionAt(0), source.positionAt(source.getText().length)), text)), true);
    assert.equal(source.getText(), text); await preserved();
    // Only a byte-identical, test-owned fixture buffer is reverted to reset the native dirty baseline.
    if (text === originalSource && source.isDirty) { await vscode.commands.executeCommand('workbench.action.files.revert'); assert.equal(source.getText(), originalSource); assert.equal(source.isDirty, false); }
  };
  const entry = () => state().documents.find(item => item.uri === source.uri.toString());
  const diagnostics = () => vscode.languages.getDiagnostics(source.uri).filter(item => item.source === 'Foundation Swift');
  const currentDiagnostics = async (test, label) => {
    await wait(() => state().phase === 'connected' && entry()?.version === source.version && entry()?.diagnosticVersion === source.version && entry()?.diagnosticState === 'current' && test(diagnostics()), label);
    assert.equal(entry().diagnosticCount, diagnostics().length);
    return { version: source.version, document: { ...entry() }, diagnostics: diagnostics().map(item => ({ message: item.message, source: item.source, severity: item.severity, range: { start: item.range.start, end: item.range.end } })), state: snapshot() };
  };
  const showPanel = async () => { await vscode.commands.executeCommand('foundation.xcodeProject'); return await ui({ type: 'inspectPanel' }); };
  await showPanel();
  const initial = snapshot(); assert.equal(initial.phase, 'disconnected'); assert.equal(initial.client, undefined); assert.equal(initial.build, undefined); assert.equal(initial.busy, false); assert.deepEqual(initial.documents, []);
  assert.equal(xcode().phase, 'idle'); assert.equal(xcode().catalog, undefined); assert.deepEqual(xcode().results, {}); await preserved();
  const discover = async () => {
    await ui({ type: 'discover' }); await wait(() => xcode().phase === 'ready' && !xcode().busy, 'native Xcode discovery');
    assert.equal(xcode().catalog.selectedScheme, 'FoundationOrbit'); assert.equal(xcode().destinationId, 'generic-ios-simulator'); assert.deepEqual(xcode().results, {});
  };
  await discover();
  assert.equal(state().phase, 'disconnected'); assert.equal(state().client, undefined, 'Discovery does not start a language process');
  if (stage === 'restore') {
    assert.equal(xcode().catalog.inputFingerprint, previous.firstConnection.build.inputFingerprint);
    const restoredUI = await ui({ type: 'screenshotPanel', name: 'swift-restored', theme: 'Foundation Dark' });
    await preserved();
    await fs.writeFile(reportPath, JSON.stringify({ ...previous, restoreProcessId: process.pid, restoredInSecondProcess: true, restoredDraftPreserved: true, restartNoAutomaticLanguageStart: true, restartNoAutomaticBuild: true, restartInitial: initial, restoredUI, checks: [...previous.checks, 'second native process restores the unrelated draft with Swift disconnected', 'opening source and explicitly discovering Xcode does not automatically build or connect Swift'] }, null, 2));
    return;
  }
  const connect = async () => {
    await ui({ type: 'connect' }); await wait(() => state().phase === 'connected' && !state().busy, 'native Swift connection', 240000);
    const connected = snapshot();
    assert.equal(connected.root, workspace); assert.equal(connected.target.name, 'FoundationOrbit'); assert.equal(connected.target.architecture, 'arm64'); assert.equal(connected.target.moduleName, 'FoundationOrbit');
    assert.match(connected.settingsFingerprint, /^[a-f0-9]{64}$/); assert.match(connected.configurationFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(connected.build.status, 'passed'); assert.equal(connected.build.action, 'build'); assert.equal(connected.build.destination.id, 'generic-ios-simulator'); assert.equal(connected.build.sourceCurrent, true); assert.equal(connected.build.exitCode, 0);
    assert.equal(connected.build.inputFingerprint, connected.build.endFingerprint); assert.match(connected.build.stdout + connected.build.stderr, /\*\* BUILD SUCCEEDED \*\*/);
    assert.equal(connected.client.state, 'connected'); assert.ok(Number.isInteger(connected.client.pid) && connected.client.pid > 1); assert.ok(connected.client.sessionId);
    await ui({ type: 'trackSourcekit', pid: connected.client.pid });
    await currentDiagnostics(items => items.length === 0, 'clean current-version Swift diagnostics'); await preserved(); return connected;
  };
  const firstConnection = await connect();
  const connectedUI = await ui({ type: 'screenshotPanel', name: 'swift-connected', theme: 'Foundation Dark' });
  const originalDiagnostics = await currentDiagnostics(items => items.length === 0, 'original source clean');

  const hoversBefore = state().counters.hovers;
  await editorAt('NavigationStack', 4);
  await vscode.commands.executeCommand('editor.action.showHover');
  const hoverUI = await ui({ type: 'hover', text: 'NavigationStack' });
  assert.ok(state().counters.hovers > hoversBefore); assert.match(hoverUI.hoverText, /root view|struct NavigationStack/);
  const hover = { interaction: 'VS Code public editor.action.showHover command with rendered native widget', renderer: hoverUI, state: snapshot() };
  await ui({ type: 'screenshotEditor', name: 'swift-hover' });
  await ui({ type: 'key', key: 'Escape' });

  // Invoke the registered provider through the native editor, then inspect its actual destination.
  const definitionsBefore = state().counters.definitions;
  await editorAt('ProfileStore()', 4); await ui({ type: 'key', key: 'F12' });
  await wait(() => vscode.window.activeTextEditor?.document.uri.fsPath === storePath && state().counters.definitions > definitionsBefore, 'native cross-file go-to-definition');
  const definitionEditor = vscode.window.activeTextEditor;
  assert.match(definitionEditor.document.lineAt(definitionEditor.selection.active.line).text, /final class ProfileStore/);
  const definition = { path: definitionEditor.document.uri.fsPath, selection: definitionEditor.selection, state: snapshot() };
  await ui({ type: 'screenshotEditor', name: 'swift-definition' });

  // Only the disposable buffer changes. Completion acceptance must insert its real range.
  const call = 'save(using: DemoProfileService(shouldFail: simulateFailure))';
  assert.ok(originalSource.includes('store.' + call));
  const completionDraft = originalSource.replace('store.' + call, 'store.ca');
  await replaceSource(completionDraft); await editorAt('store.ca', 'store.ca'.length);
  const completionsBefore = state().counters.completions;
  await ui({ type: 'key', key: 'Control+Space' });
  const completionUI = await ui({ type: 'completion', text: 'cancel()' });
  assert.ok(state().counters.completions > completionsBefore); assert.match(completionUI.suggestText, /cancel\(\)/);
  assert.equal(vscode.window.activeColorTheme.kind, vscode.ColorThemeKind.Dark);
  const darkUI = { ...await ui({ type: 'screenshotEditor', name: 'swift-completion-dark' }), theme: vscode.workspace.getConfiguration('workbench').get('colorTheme'), themeKind: vscode.window.activeColorTheme.kind };
  assert.equal(darkUI.theme, 'Foundation Dark'); assert.match(darkUI.workbenchClasses, /(?:^|\s)vs-dark(?:\s|$)/);
  await ui({ type: 'key', key: 'Escape' });
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Foundation Light', vscode.ConfigurationTarget.Global);
  await wait(() => vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light, 'native light editor theme');
  await editorAt('store.ca', 'store.ca'.length); await ui({ type: 'key', key: 'Control+Space' }); await ui({ type: 'completion', text: 'cancel()' });
  const lightUI = { ...await ui({ type: 'screenshotEditor', name: 'swift-completion-light' }), theme: vscode.workspace.getConfiguration('workbench').get('colorTheme'), themeKind: vscode.window.activeColorTheme.kind };
  assert.equal(lightUI.theme, 'Foundation Light'); assert.match(lightUI.workbenchClasses, /(?:^|\s)vs(?:\s|$)/);
  await ui({ type: 'key', key: 'Tab' });
  const acceptedSource = originalSource.replace('store.' + call, 'store.cancel()');
  await wait(() => source.getText() === acceptedSource, 'Tab accepts the SourceKit completion edit'); assert.equal(source.isDirty, true); await preserved();
  await ui({ type: 'key', key: 'Meta+Z' }); await wait(() => source.getText() === completionDraft, 'one native Undo restores only accepted completion');
  await replaceSource(originalSource); assert.equal(source.isDirty, false); await currentDiagnostics(items => items.length === 0, 'completion draft fully restored');
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Foundation Dark', vscode.ConfigurationTarget.Global);
  await wait(() => vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark, 'native dark editor theme');

  // Trusted typing creates an unsaved error, and native Problems shows that exact version.
  await editorAt('ProfileStore()', 0, 'ProfileStore'.length); await ui({ type: 'type', text: 'FoundationMissingType' });
  assert.equal(source.isDirty, true); assert.ok(source.getText().includes('FoundationMissingType()')); assert.equal(state().phase, 'connected');
  const errorDiagnostics = await currentDiagnostics(items => items.some(item => /Cannot find 'FoundationMissingType' in scope/.test(item.message)), 'unsaved Swift diagnostic');
  await ui({ type: 'key', key: 'Meta+Shift+M' });
  const problemsUI = await ui({ type: 'inspectEditor', text: 'FoundationMissingType' });
  await ui({ type: 'screenshotEditor', name: 'swift-diagnostics-dark' });
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Foundation Light', vscode.ConfigurationTarget.Global);
  await wait(() => vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light, 'light diagnostic theme');
  await ui({ type: 'screenshotEditor', name: 'swift-diagnostics-light' });
  await vscode.commands.executeCommand('workbench.action.closePanel');
  await replaceSource(originalSource);
  const fixedDiagnostics = await currentDiagnostics(items => items.length === 0, 'fixed unsaved source clears old diagnostics');
  assert.ok(fixedDiagnostics.version > errorDiagnostics.version); await preserved();

  // An unsaved edit in a dependency must refresh the unchanged consumer document.
  const viewVersionBeforeDependencyEdit = source.version;
  const storeDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(storePath));
  let storeEditor = await vscode.window.showTextDocument(storeDocument, { preview: false });
  const renamedStore = originalStore.replace('final class ProfileStore', 'final class FoundationRenamedProfileStore');
  assert.notEqual(renamedStore, originalStore);
  assert.equal(await storeEditor.edit(edit => edit.replace(new vscode.Range(storeDocument.positionAt(0), storeDocument.positionAt(storeDocument.getText().length)), renamedStore)), true);
  assert.equal(storeDocument.isDirty, true);
  const dependencyDiagnostics = await currentDiagnostics(items => items.some(item => /Cannot find 'ProfileStore' in scope/.test(item.message)), 'unchanged consumer receives diagnostics after dependency edit');
  assert.equal(source.version, viewVersionBeforeDependencyEdit, 'The dependent source buffer was not edited');
  assert.ok(dependencyDiagnostics.state.contextVersion > fixedDiagnostics.state.contextVersion);
  await editorAt('ProfileStore()', 4); await ui({ type: 'key', key: 'Meta+Shift+M' });
  const dependencyUI = await ui({ type: 'inspectEditor', text: "Cannot find 'ProfileStore'" });
  await ui({ type: 'screenshotEditor', name: 'swift-dependency-diagnostics' });
  await vscode.commands.executeCommand('workbench.action.closePanel');
  storeEditor = await vscode.window.showTextDocument(storeDocument, { preview: false });
  assert.equal(await storeEditor.edit(edit => edit.replace(new vscode.Range(storeDocument.positionAt(0), storeDocument.positionAt(storeDocument.getText().length)), originalStore)), true);
  assert.equal(storeDocument.getText(), originalStore); assert.equal(await fs.readFile(storePath, 'utf8'), originalStore);
  await vscode.commands.executeCommand('workbench.action.files.revert'); assert.equal(storeDocument.getText(), originalStore); assert.equal(storeDocument.isDirty, false);
  const dependencyFixed = await currentDiagnostics(items => items.length === 0, 'restored dependency clears consumer diagnostics');
  assert.equal(source.version, viewVersionBeforeDependencyEdit); assert.ok(dependencyFixed.state.contextVersion > dependencyDiagnostics.state.contextVersion); await preserved();

  // A public VS Code provider request deliberately races real buffer edits. This
  // is separately labeled API evidence; the popup above was real keyboard input.
  await replaceSource(completionDraft);
  await currentDiagnostics(() => true, 'race setup diagnostics match the current draft');
  await wait(() => state().client.pendingRequests === 0, 'race starts without older language requests');
  const { position: completionPosition, editor: raceEditor } = await editorAt('store.ca', 'store.ca'.length);
  const raceBefore = snapshot(); let settled = false, responseDocumentVersion;
  const request = vscode.commands.executeCommand('vscode.executeCompletionItemProvider', source.uri, completionPosition).then(result => { settled = true; responseDocumentVersion = source.version; return result; }, error => { settled = true; responseDocumentVersion = source.version; return { error: String(error) }; });
  const raceDeadline = Date.now() + 3000; let observedPending = false;
  while (Date.now() < raceDeadline && !settled) { if (state().client.pendingRequests > 0) { observedPending = true; break; } await pause(1); }
  const beforeRapidVersion = source.version;
  assert.equal(await raceEditor.edit(edit => edit.replace(new vscode.Range(source.positionAt(0), source.positionAt(source.getText().length)), originalSource.replace('ProfileStore()', 'FoundationRapidMissingType()'))), true);
  assert.equal(await raceEditor.edit(edit => edit.replace(new vscode.Range(source.positionAt(0), source.positionAt(source.getText().length)), originalSource)), true);
  const result = await request;
  const rapidFixed = await currentDiagnostics(items => items.length === 0, 'rapid latest-version diagnostics');
  const raceAfter = snapshot();
  assert.ok(source.version >= beforeRapidVersion + 2); assert.equal(rapidFixed.document.diagnosticVersion, source.version);
  const cancelled = raceAfter.client.cancelledRequests > raceBefore.client.cancelledRequests;
  const discarded = raceAfter.counters.discardedResults > raceBefore.counters.discardedResults;
  const responseAfterEdit = responseDocumentVersion > beforeRapidVersion;
  const foundationCompletionPublished = raceAfter.counters.completions > raceBefore.counters.completions;
  const resultItems = (result?.items || []).map(item => ({ label: typeof item.label === 'string' ? item.label : item.label?.label, detail: item.detail, kind: item.kind, sortText: item.sortText }));
  const sourceKitMembers = resultItems.filter(item => /^(?:cancel\(\)|objectWillChange|displayName|lastSavedName|state|save\(using:)/.test(item.label || ''));
  const nativeCancellationVerified = observedPending && responseAfterEdit && cancelled && !foundationCompletionPublished && sourceKitMembers.length === 0;
  const requestRace = { interaction: 'VS Code public executeCompletionItemProvider API plus native editor buffer edits', observedPending, responseDocumentVersion, responseAfterEdit, cancellationObserved: cancelled, staleResultDiscardObserved: discarded, foundationCompletionPublished, nativeCancellationVerified, resultItems, sourceKitMembers, before: raceBefore, after: raceAfter, latestVersion: source.version, resultItemCount: resultItems.length, rapidFixed, limitation: nativeCancellationVerified ? undefined : 'The aggregate API result cannot certify a pending Foundation completion cancellation: the service may have published before the edit or another request owned the cancellation counter. Latest-version diagnostics were verified separately.' };
  await fs.writeFile(path.join(path.dirname(workspace), 'request-race-evidence.json'), JSON.stringify(requestRace, null, 2));
  if (!foundationCompletionPublished) assert.equal(sourceKitMembers.length, 0, 'No SourceKit members may escape when the Foundation provider did not publish a completion');


  await replaceSource(originalSource); await currentDiagnostics(items => items.length === 0, 'test-owned fixture clean before reconnect');

  // Stop is an actual control; it clears diagnostics and waits for the owned process.
  await showPanel(); await ui({ type: 'stop' }); await wait(() => state().phase === 'disconnected' && !state().busy, 'explicit Stop Swift completes');
  assert.equal(state().client, undefined); assert.deepEqual(state().documents, []); assert.equal(diagnostics().length, 0);
  await wait(() => { try { process.kill(firstConnection.client.pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } }, 'first owned SourceKit process exits');
  const stopped = snapshot(); await preserved();
  const stoppedCompletions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', source.uri, source.positionAt(originalSource.indexOf('ProfileStore()') + 4));
  assert.equal(stoppedCompletions?.items?.length || 0, 0, 'Stopped Swift provides no stale completion');
  // Rediscovery is explicit because native unsaved edits made Xcode's old build evidence stale.
  await discover();
  const secondConnection = await connect();
  assert.notEqual(secondConnection.client.sessionId, firstConnection.client.sessionId); assert.notEqual(secondConnection.client.pid, firstConnection.client.pid); assert.notEqual(secondConnection.generation, firstConnection.generation); assert.notEqual(secondConnection.build.id, firstConnection.build.id);
  assert.equal(secondConnection.build.inputFingerprint, firstConnection.build.inputFingerprint);
  const reconnectedDiagnostics = await currentDiagnostics(items => items.length === 0, 'reconnected service sees the current clean source');
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Foundation Dark', vscode.ConfigurationTarget.Global);
  const reconnectedUI = await ui({ type: 'screenshotPanel', name: 'swift-reconnected', theme: 'Foundation Dark' });
  await preserved(); assert.equal(source.getText(), originalSource); assert.equal(source.isDirty, false);
  await fs.writeFile(reportPath, JSON.stringify({ writeProcessId: process.pid, originalDraft, draftText, sourcePath, sourceHash: hash(originalSource), initial, firstConnection, connectedUI, originalDiagnostics, hover, definition, completionUI, darkUI, lightUI, completionAcceptedAndUndone: true, errorDiagnostics, problemsUI, fixedDiagnostics, dependencyDiagnostics, dependencyUI, dependencyFixed, requestRace, stopped, firstSourcekitExited: true, secondConnection, reconnectedDiagnostics, reconnectedUI, connectedBeforeRestart: true, providerRequests: 0, foundationWebRuntimeStarted: false, simulatorStarted: false, checks: ['explicit generic Simulator build prepares the selected arm64 Swift target', 'the selected Xcode SourceKit process belongs to the isolated native app', 'native hover renders real NavigationStack SDK documentation', 'F12 navigates from ProfileView to the real ProfileStore declaration', 'Ctrl+Space shows real member completion in both native themes', 'Tab accepts completion and one native Undo restores the prior draft', 'trusted typing produces current-version unsaved diagnostics visible in Problems', 'fixing and rapidly replacing source clears older diagnostics', 'unsaved dependency rename refreshes diagnostics in the unchanged consumer and restoration clears them', 'API-driven completion race is recorded separately from native keyboard evidence', 'Stop Swift clears diagnostics and waits for the owned process to exit', 'explicit reconnect creates a new SourceKit session and preparation build', 'unrelated editor draft and all saved fixture bytes remain intact'] }, null, 2));
}
exports.activate = () => {
  const workspace = process.env.FOUNDATION_SWIFT_WORKSPACE, outcome = process.env.FOUNDATION_SWIFT_OUTCOME;
  assert.equal(vscode.workspace.workspaceFolders?.length, 1); assert.equal(vscode.workspace.workspaceFolders[0].uri.fsPath, workspace); assert.match(workspace, /^\/private\/tmp\/foundation-swift-language-smoke-[A-Za-z0-9]+\/workspace$/); assert.equal(path.dirname(outcome), path.dirname(workspace));
  setImmediate(async () => { let result; try { await run(); result = { passed: true, stage: process.env.FOUNDATION_SWIFT_STAGE }; } catch (error) { result = { passed: false, error: error.stack || String(error), stage: process.env.FOUNDATION_SWIFT_STAGE }; if (inspect) await fs.writeFile(outcome.replace('.json', '-state.json'), JSON.stringify(inspect(), null, 2)); } await fs.writeFile(outcome, JSON.stringify(result, null, 2)); await vscode.commands.executeCommand('workbench.action.quit'); });
};
