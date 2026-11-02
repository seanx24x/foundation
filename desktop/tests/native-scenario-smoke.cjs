const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, label, timeout = 20000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await check(); if (value) return value; await pause(100); } throw new Error(`Timed out: ${label}`); };
const digest = text => createHash('sha256').update(text).digest('hex');

async function run() {
  const stage = process.env.FOUNDATION_SCENARIO_STAGE, workspace = process.env.FOUNDATION_SCENARIO_WORKSPACE, reportPath = process.env.FOUNDATION_SCENARIO_REPORT;
  assert.ok(['write', 'restore'].includes(stage));
  const extension = vscode.extensions.getExtension('foundation.foundation-workspace'); assert.ok(extension);
  assert.equal(await fs.realpath(extension.extensionPath), process.env.FOUNDATION_SCENARIO_EXTENSION);
  await extension.activate(); await vscode.commands.executeCommand('foundation.refresh');
  assert.ok(process.versions.electron); assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('baseUrl'), '');
  assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('model'), '');
  assert.ok(Object.keys(process.env).every(key => !/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key)));
  const inspect = () => extension.exports.inspect();
  const state = () => inspect().runtimeWorkspace;
  assert.ok(state(), 'Native inspection exposes the runtime workspace');
  const action = async (name, fields = {}) => vscode.commands.executeCommand('foundation.runtimeWorkspace', { action: name, projectId: inspect().project.id, expectedRevision: state().revision, ...fields });
  const checks = []; let browserIndex = 0;
  const browser = async command => {
    const index = ++browserIndex, ipc = process.env.FOUNDATION_SCENARIO_IPC;
    await fs.writeFile(path.join(ipc, `command-${index}.json`), JSON.stringify(command));
    const result = await wait(async () => { try { return JSON.parse(await fs.readFile(path.join(ipc, `result-${index}.json`), 'utf8')); } catch {} }, 'fixture browser action');
    assert.equal(result.passed, true, result.error); return result;
  };
  const closeCanvas = async () => {
    // Only this isolated workspace's Foundation webview is disposed. Retaining
    // it hidden would leave a second instrumented document heartbeating.
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputWebview && tab.label === 'Foundation');
    for (const tab of tabs) assert.equal(await vscode.window.tabGroups.close(tab), true);
  };
  const filePath = 'src/components/SaveButton.tsx', filename = path.join(workspace, filePath), original = await fs.readFile(filename, 'utf8');
  try {
    if (stage === 'restore') {
      const previous = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      assert.notEqual(process.pid, previous.writeProcessId);
      assert.equal(inspect().runtime.status, 'idle');
      await wait(() => state().storage.status === 'saved', 'restored history recovery flush');
      const restored = state(); assert.equal(restored.storage.status, 'saved');
      assert.deepEqual(restored.screens, previous.screens); assert.deepEqual(restored.scenarios, previous.scenarios);
      const completed = restored.runs.find(item => item.id === previous.completedRun.id);
      assert.deepEqual(completed, previous.completedRun);
      const unfinished = restored.runs.find(item => item.id === previous.unfinishedRunId);
      assert.equal(unfinished.status, 'interrupted'); assert.equal(unfinished.assessment, 'not-assessed');
      assert.ok(restored.runs.every(item => item.status !== 'recording'));
      assert.equal(digest(original), previous.sourceHash); assert.equal(inspect().conversations.conversations.length, 0);
      checks.push('second native process restores exact definitions and completed historical evidence without reconnecting or resuming');
      await fs.writeFile(reportPath, JSON.stringify({ ...previous, restoreProcessId: process.pid, restoreChecks: checks, restoredInSecondProcess: true }));
      return;
    }
    assert.equal(state().screens.length + state().scenarios.length + state().runs.length, 0);
    const featureState = await vscode.commands.executeCommand('foundation.newFeature', { title: 'Profile save scenario', brief: 'Inspect actual save success and failure states.', paths: [filePath], entryPath: filePath });
    const featureId = featureState.activeId;
    await action('createScreen', { input: { title: 'Profile screen', targetId: 'vite:dev', route: '/profile' } });
    const screen = state().screens.find(item => item.featureId === featureId); assert.ok(screen);
    await action('createScenario', { input: { screenId: screen.id, title: 'Save success and failure', steps: ['Save a profile successfully.', 'Select the HTTP failure fixture and save again.'], expectedOutcome: 'Success is acknowledged; a failed request returns to an editable state.' } });
    const scenario = state().scenarios.find(item => item.screenId === screen.id); assert.ok(scenario);
    await action('select', { screenId: screen.id, scenarioId: scenario.id });
    assert.equal(inspect().runtime.status, 'idle'); assert.equal(inspect().conversations.conversations.length, 0);
    checks.push('named screen and manual scenario persist without starting a runtime or AI request');
    const open = async () => {
      await action('openScreen', { screenId: screen.id });
      const attached = inspect().runtime; assert.equal(attached.status, 'connected'); assert.equal(attached.owned, true);
      await closeCanvas(); const previousDocument = inspect().runtime.documentId;
      await browser({ type: 'attach', url: attached.url });
      return wait(() => { const current = inspect().runtime; return current.pageConnected && current.pagePath === '/profile' && current.documentId && current.documentId !== previousDocument && current; }, 'one newly attached instrumented document at the named route');
    };
    const ready = await open();
    assert.match(ready.viewId, /^[a-f0-9]{32}$/); assert.match(ready.documentId, /^[a-f0-9]{32}$/);
    assert.ok(Number.isSafeInteger(ready.pageVersion) && ready.pageVersion > 0);
    await browser({ type: 'interact', mode: 'success' });
    await wait(() => inspect().runtime.observations.some(item => item.status === 200), 'request before recording');
    const priorIds = new Set(inspect().runtime.observations.map(item => item.id));
    await action('beginRun', { scenarioId: scenario.id });
    const started = state().runs.find(item => item.status === 'recording'); assert.ok(started);
    assert.equal(started.assessment, 'not-assessed'); assert.equal(started.observations.length, 0);
    assert.equal(started.runtime.route, '/profile'); assert.equal(started.runtime.documentId, ready.documentId);
    assert.equal(started.runtime.pageVersion, ready.pageVersion);
    assert.deepEqual(started.sources, [{ path: filePath, revision: digest(original) }]);
    await browser({ type: 'interact', mode: 'success' }); await browser({ type: 'interact', mode: 'failure' });
    const captured = await wait(() => { const run = state().activeRun; return run?.id === started.id && run.observations.some(item => item.status === 200) && run.observations.some(item => item.status === 503) && run; }, 'new request metadata in recording');
    assert.equal(captured.status, 'recording'); assert.equal(captured.assessment, 'not-assessed');
    assert.ok(captured.observations.every(item => !priorIds.has(item.id) && item.correlation === 'unattributed' && !item.url.includes('?') && !item.url.includes('#') && !('headers' in item) && !('body' in item)));
    await action('finishRun', { id: started.id, assessment: 'matched', note: 'Fixture harness explicitly assessed both visible outcomes; HTTP status alone did not decide this result.' });
    const completedRun = state().runs.find(item => item.id === started.id); assert.equal(completedRun.status, 'completed'); assert.equal(completedRun.assessment, 'matched');
    checks.push('real success/failure requests are recorded only after Start; observed HTTP outcomes never fabricate a passed assessment');
    await action('beginRun', { scenarioId: scenario.id }); const roundTripRun = state().runs.find(item => item.status === 'recording');
    await browser({ type: 'routeRoundTrip' });
    const interruptedRoundTrip = await wait(() => { const run = state().runs.find(item => item.id === roundTripRun.id); return run.status === 'interrupted' && run; }, 'rapid route round trip interrupts recording');
    const afterRoundTrip = inspect().runtime;
    assert.equal(afterRoundTrip.pagePath, roundTripRun.runtime.route); assert.equal(afterRoundTrip.documentId, roundTripRun.runtime.documentId);
    assert.ok(afterRoundTrip.pageVersion > roundTripRun.runtime.pageVersion); assert.equal(interruptedRoundTrip.assessment, 'not-assessed');
    assert.deepEqual(interruptedRoundTrip.runtime, roundTripRun.runtime); assert.doesNotMatch(JSON.stringify(state()), /PRIVATE_ROUND_TRIP_VALUE/);
    checks.push('synchronous SPA route departure and return still interrupts recording through a monotonic page revision');
    await action('beginRun', { scenarioId: scenario.id }); const routeRun = state().runs.find(item => item.status === 'recording');
    await browser({ type: 'route', route: '/other?secret=PRIVATE_ROUTE_VALUE#private' });
    const interruptedRoute = await wait(() => { const run = state().runs.find(item => item.id === routeRun.id); return run.status === 'interrupted' && run; }, 'route change interrupts recording');
    assert.equal(interruptedRoute.assessment, 'not-assessed'); assert.doesNotMatch(JSON.stringify(state()), /PRIVATE_ROUTE_VALUE/);
    checks.push('SPA route change interrupts the original run without recording private query values');
    const reopened = await open(); assert.notEqual(reopened.viewId, ready.viewId);
    await action('beginRun', { scenarioId: scenario.id }); const sourceRun = state().runs.find(item => item.status === 'recording');
    await fs.writeFile(filename, `${original}\n// Disposable scenario smoke source revision.\n`);
    await vscode.commands.executeCommand('foundation.refresh');
    const interruptedSource = await wait(() => { const run = state().runs.find(item => item.id === sourceRun.id); return run.status === 'interrupted' && run; }, 'saved source change interrupts recording');
    assert.equal(interruptedSource.assessment, 'not-assessed'); assert.deepEqual(interruptedSource.sources, sourceRun.sources);
    await fs.writeFile(filename, original); await vscode.commands.executeCommand('foundation.refresh'); await open();
    checks.push('changed saved source interrupts recording; original source evidence remains immutable and fixture bytes are restored');
    await action('beginRun', { scenarioId: scenario.id }); const unfinished = state().runs.find(item => item.status === 'recording'); assert.ok(unfinished);
    assert.equal(inspect().conversations.conversations.length, 0); assert.equal(await fs.readFile(filename, 'utf8'), original);
    await fs.writeFile(reportPath, JSON.stringify({ writeProcessId: process.pid, screens: state().screens, scenarios: state().scenarios, completedRun,
      unfinishedRunId: unfinished.id, sourceHash: digest(original), checks, providerRequests: 0, assessmentOrigin: 'explicit fixture harness action',
      sourcePreserved: true, runtimeBeforeQuit: { owned: inspect().runtime.owned, session: inspect().runtime.session }, restoreChecks: [] }));
  } finally {
    if (await fs.readFile(filename, 'utf8') !== original) await fs.writeFile(filename, original);
  }
}

exports.activate = () => {
  const stage = process.env.FOUNDATION_SCENARIO_STAGE, workspace = process.env.FOUNDATION_SCENARIO_WORKSPACE, outcome = process.env.FOUNDATION_SCENARIO_OUTCOME;
  const folders = vscode.workspace.workspaceFolders || [];
  assert.equal(folders.length, 1); assert.equal(folders[0].uri.fsPath, workspace); assert.ok(workspace.startsWith('/private/tmp/foundation-scenario-smoke-')); assert.equal(path.dirname(outcome), path.dirname(workspace));
  setImmediate(async () => {
    let result;
    try { await run(); result = { stage, passed: true }; }
    catch (error) { result = { stage, passed: false, error: error.stack || String(error) }; try { await vscode.commands.executeCommand('foundation.stopRunningProject'); } catch {} }
    await fs.writeFile(outcome, JSON.stringify(result, null, 2));
    await vscode.commands.executeCommand('workbench.action.quit');
  });
};
