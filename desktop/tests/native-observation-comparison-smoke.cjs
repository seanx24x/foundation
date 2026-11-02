const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, label, timeout = 25000) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await check(); if (value) return value; await pause(100); } throw Error(`Timed out: ${label}`); };
let inspect;
async function run() {
  const stage = process.env.FOUNDATION_OBSERVATION_STAGE, workspace = process.env.FOUNDATION_OBSERVATION_WORKSPACE;
  assert.ok(['write', 'restore'].includes(stage));
  const baseline = JSON.parse(await fs.readFile(process.env.FOUNDATION_OBSERVATION_BASELINE, 'utf8'));
  assert.equal(baseline.passed, true); assert.equal(baseline.workspace, workspace);
  const extension = vscode.extensions.getExtension('foundation.foundation-workspace'); assert.ok(extension);
  assert.equal(await fs.realpath(extension.extensionPath), process.env.FOUNDATION_OBSERVATION_EXTENSION);
  await extension.activate(); await vscode.commands.executeCommand('foundation.refresh');
  assert.ok(process.versions.electron); inspect = () => extension.exports.inspect();
  assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('baseUrl'), '');
  assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('model'), '');
  assert.deepEqual(vscode.workspace.getConfiguration('foundation.ai').get('profiles'), {});
  assert.ok(Object.keys(process.env).every(key => !/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key)));
  await wait(() => inspect().runtimeWorkspace?.storage.status === 'saved' && inspect().features?.storage.status === 'saved', 'saved real scenario fixture');
  const initial = inspect(), runtime = initial.runtimeWorkspace;
  assert.equal(initial.project.root, workspace); assert.equal(initial.runtime.status, 'idle');
  assert.equal(initial.features.activeId, baseline.completedRun.feature.id);
  assert.deepEqual(runtime.screens, baseline.screens); assert.deepEqual(runtime.scenarios, baseline.scenarios);
  const before = runtime.runs.find(run => run.id === baseline.completedRun.id), after = runtime.runs.find(run => run.id === baseline.unfinishedRunId);
  assert.deepEqual(before, baseline.completedRun); assert.equal(after.status, 'interrupted'); assert.equal(after.assessment, 'not-assessed');
  assert.ok(runtime.runs.every(run => run.status !== 'recording')); assert.equal(initial.conversations.conversations.length, 0);
  const pair = { beforeId: before.id, afterId: after.id };
  const invariant = value => ({ projectId: value.project.id, features: value.features, history: { schemaVersion: value.runtimeWorkspace.schemaVersion, projectId: value.runtimeWorkspace.projectId, revision: value.runtimeWorkspace.revision, screens: value.runtimeWorkspace.screens, scenarios: value.runtimeWorkspace.scenarios, runs: value.runtimeWorkspace.runs, activeScreenId: value.runtimeWorkspace.activeScreenId, activeScenarioId: value.runtimeWorkspace.activeScenarioId }, conversations: value.conversations });
  const unchanged = invariant(initial), initialDigest = digest(unchanged);
  const drafts = () => vscode.workspace.textDocuments.filter(document => document.isDirty).map(document => ({ uri: document.uri.toString(), hash: digest(document.getText()) })).sort((a, b) => a.uri.localeCompare(b.uri));
  const initialDrafts = drafts();
  const sourceHashes = async () => Promise.all([...new Set(runtime.runs.flatMap(run => run.sources.map(source => source.path)))].sort().map(async relative => {
    assert.ok(!relative.split('/').some(part => ['..', ''].includes(part))); const bytes = await fs.readFile(path.join(workspace, relative));
    return { path: relative, hash: createHash('sha256').update(bytes).digest('hex') };
  }));
  const originalSources = await sourceHashes(); assert.equal(originalSources.find(source => source.path === before.sources[0].path).hash, baseline.sourceHash);
  const assertReadOnly = async () => {
    const value = inspect(); assert.deepEqual(invariant(value), unchanged, 'Historical definitions, assessments, requests, features and conversations must not change');
    assert.equal(value.runtime.status, 'idle'); assert.ok(!value.runtime.pageConnected); assert.ok(!value.runtimeWorkspace.activeRun); assert.ok(!value.runtimeWorkspace.busy);
    assert.equal(value.runtimeWorkspace.storage.status, 'saved'); assert.deepEqual(drafts(), initialDrafts); assert.deepEqual(await sourceHashes(), originalSources);
  };
  let commandIndex = 0;
  const ui = async command => {
    const id = ++commandIndex, directory = process.env.FOUNDATION_OBSERVATION_IPC;
    await fs.writeFile(path.join(directory, `command-${id}.json`), JSON.stringify(command));
    const response = await wait(async () => { try { return JSON.parse(await fs.readFile(path.join(directory, `result-${id}.json`), 'utf8')); } catch {} }, `native ${command.type}`, 35000);
    assert.equal(response.passed, true, response.error); await assertReadOnly(); return response.renderer;
  };
  const assertPair = renderer => { assert.equal(renderer.baseline, pair.beforeId); assert.equal(renderer.comparison, pair.afterId); };
  const assertEvidence = renderer => {
    assertPair(renderer);
    for (const run of [before, after]) {
      assert.ok(renderer.regionText.includes(run.screen.title), 'Recorded screen definition is visible');
      assert.ok(renderer.regionText.includes(run.scenario.title), 'Recorded scenario definition is visible');
      assert.ok(renderer.regionText.includes(run.scenario.expectedOutcome), 'Recorded expected outcome is visible');
      for (const step of run.scenario.steps) assert.ok(renderer.regionText.includes(step), 'Recorded steps are visible');
      for (const source of run.sources) assert.ok(renderer.regionText.includes(source.revision), 'Both full saved-source hashes remain inspectable');
    }
    assert.match(renderer.regionText, /interrupted/i); assert.match(renderer.regionText, /incomplete/i);
    assert.match(renderer.regionText, /historical|historically/i); assert.match(renderer.regionText, /unknown/i);
    assert.match(renderer.regionText, /not assessed|not-assessed/i); assert.match(renderer.regionText, /manual assessment/i);
    assert.match(renderer.regionText, /200/); assert.match(renderer.regionText, /503/);
    assert.ok(!/all checks passed|behavior verified|performance improved/i.test(renderer.regionText), 'No invented verification verdict');
  };
  await vscode.commands.executeCommand('foundation.understand');
  let renderer = await ui({ type: 'open' });
  const checks = [];
  if (stage === 'write') {
    assert.ok(!renderer.baseline && !renderer.comparison, 'No saved observation pair is chosen automatically');
    await ui({ type: 'select', label: 'Baseline observation', value: pair.beforeId });
    await ui({ type: 'select', label: 'Comparison observation', value: pair.afterId });
    renderer = await ui({ type: 'expandEvidence' }); assertEvidence(renderer);
    checks.push('Native selectors compare real completed and interrupted observations without replay or evidence mutation');
    const swapped = await ui({ type: 'action', label: 'Swap observations' }); assert.equal(swapped.baseline, pair.afterId); assert.equal(swapped.comparison, pair.beforeId);
    const cleared = await ui({ type: 'action', label: 'Clear comparison' }); assert.ok(!cleared.baseline && !cleared.comparison);
    await ui({ type: 'select', label: 'Baseline observation', value: pair.beforeId }); await ui({ type: 'select', label: 'Comparison observation', value: pair.afterId });
    renderer = await ui({ type: 'expandEvidence' }); assertEvidence(renderer);
    checks.push('Swap and Clear change only the local comparison selection, then the exact pair is explicitly selected again');
    for (const theme of ['Foundation Dark', 'Foundation Light']) {
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Global);
      const themed = await ui({ type: 'capture', theme }); assertEvidence(themed);
    }
    await pause(500); await assertReadOnly();
    await fs.writeFile(process.env.FOUNDATION_OBSERVATION_REPORT, JSON.stringify({ writeProcessId: process.pid, pair, featureId: initial.features.activeId, projectId: initial.project.id, historyDigest: initialDigest, definitions: { screens: runtime.screens, scenarios: runtime.scenarios }, sources: originalSources, beforeRun: before, afterRun: after, freshness: runtime.runFreshness, checks, provider: 'disconnected; zero conversations', runtime: 'idle throughout', draftsPreserved: initialDrafts.length, sourcePreserved: true, renderer }));
  } else {
    const previous = JSON.parse(await fs.readFile(process.env.FOUNDATION_OBSERVATION_REPORT, 'utf8'));
    assert.notEqual(process.pid, previous.writeProcessId); assert.deepEqual(pair, previous.pair); assert.equal(initialDigest, previous.historyDigest);
    // No pair-selection action is sent in the second process. Opening a lazy
    // disclosure is presentation only and must reveal the exact persisted pair.
    assertPair(renderer); renderer = await ui({ type: 'expandEvidence' }); assertEvidence(renderer);
    await pause(500); await assertReadOnly();
    checks.push('A distinct native process restores the exact pair, warnings, definitions and hashes without starting AI or runtime');
    await fs.writeFile(process.env.FOUNDATION_OBSERVATION_REPORT, JSON.stringify({ ...previous, restoreProcessId: process.pid, restoredInSecondProcess: true, restoreChecks: checks, restoredRenderer: renderer }));
  }
}
exports.activate = () => {
  const workspace = process.env.FOUNDATION_OBSERVATION_WORKSPACE, outcome = process.env.FOUNDATION_OBSERVATION_OUTCOME;
  const folders = vscode.workspace.workspaceFolders || [];
  assert.equal(folders.length, 1); assert.equal(folders[0].uri.fsPath, workspace);
  assert.match(workspace, /^\/private\/tmp\/foundation-scenario-smoke-[A-Za-z0-9]+\/workspace$/);
  assert.match(path.dirname(outcome), /^\/private\/tmp\/foundation-observation-comparison-smoke-[A-Za-z0-9]+$/);
  setImmediate(async () => {
    let result;
    try { await run(); result = { passed: true, stage: process.env.FOUNDATION_OBSERVATION_STAGE }; }
    catch (error) { result = { passed: false, stage: process.env.FOUNDATION_OBSERVATION_STAGE, error: error.stack || String(error) }; if (inspect) await fs.writeFile(outcome.replace(/\.json$/, '-state.json'), JSON.stringify(inspect(), null, 2)); }
    await fs.writeFile(outcome, JSON.stringify(result, null, 2));
    await vscode.commands.executeCommand('workbench.action.quit');
  });
};
