import { mockDisplaySources } from './helpers/display-source-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.FOUNDATION_SCENARIO_HOST_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const projectRequire = createRequire(join(root, 'package.json')), ts = projectRequire('typescript');
const featureStoreModule = await import(join(root, 'desktop/extension/src/feature-store.mjs'));
const runtimeWorkspaceModule = await import(join(root, 'desktop/extension/src/runtime-workspace-store.mjs'));
const safety = await import(join(root, 'desktop/extension/src/safety.mjs'));
const compiled = ts.transpileModule(`${readFileSync(join(root, 'desktop/extension/src/extension.ts'), 'utf8')}\nexport { FoundationHost };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const hash = value => createHash('sha256').update(value).digest('hex');
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const project = { id: 'scenario-project', root: '/fixtures/scenario', files: [{ path: 'src/Button.tsx' }, { path: 'src/App.tsx' }] };
const file = (path, source = 'export const example = true;\n') => ({ path, source, revision: hash(source).slice(0, 16), analysis: { imports: [], consumers: [], symbols: [], requests: [] } });
function harness(t, previous) {
  const persisted = previous || new Map(), writes = [], reads = [], calls = [], messages = [], states = [];
  const sources = new Map(project.files.map(item => [item.path, file(item.path)]));
  let readHook, writeHook, discoverHook, navigateHook, startHook, viewCounter = 2;
  const runtimeState = { status: 'connected', root: project.root, target: { id: 'vite:dev', root: project.root }, targets: [], owned: true,
    session: '1'.repeat(32), viewId: '2'.repeat(32), documentId: '3'.repeat(32), pageConnected: true, pagePath: '/profile', pageVersion: 1,
    url: 'http://127.0.0.1:4173/profile', targetUrl: 'http://127.0.0.1:4173', selection: null, selectionVersion: 0,
    observations: [], files: [], capabilities: { sourceMapping: 'instrumented', requests: true, screenshots: false, routeTracking: true } };
  const runtime = {
    snapshot: () => structuredClone(runtimeState),
    discover: async () => { calls.push(['discover']); if (discoverHook) await discoverHook(); return [{ id: 'vite:dev', root: project.root, available: true, instrumented: true }]; },
    start: async id => { calls.push(['start', id]); if (startHook) await startHook(); runtimeState.status = 'connected'; runtimeState.target = { id, root: project.root }; return structuredClone(runtimeState); },
    navigate: async route => { calls.push(['navigate', route]); if (navigateHook) await navigateHook(); runtimeState.viewId = String(++viewCounter).padStart(32, '0'); runtimeState.pageConnected = false; runtimeState.documentId = null; runtimeState.pagePath = null; runtimeState.url = `http://127.0.0.1:4173${route}`; runtimeState.observations = []; return structuredClone(runtimeState); },
    dispose: async () => { calls.push(['dispose']); },
  };
  const vscode = { workspace: { isTrusted: true, textDocuments: [] }, Uri: { file: fsPath => ({ fsPath, scheme: 'file', toString: () => `file://${fsPath}` }) } };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Buffer, URL, AbortController, TextDecoder, setTimeout, clearTimeout,
    fetch() { throw new Error('A scenario must never send an AI or remote-provider request'); },
    require: name => name === 'vscode' ? vscode : name.includes('runtime-workspace-store') ? runtimeWorkspaceModule : name.includes('feature-store') ? featureStoreModule : name.includes('safety') ? safety : name.startsWith('node:') ? projectRequire(name) : {},
  });
  const host = Object.create(module.exports.FoundationHost.prototype);
  Object.assign(host, {
    context: { workspaceState: { get: key => persisted.get(key), update: async (key, value) => { if (writeHook) await writeHook(key, value); persisted.set(key, structuredClone(value)); writes.push({ key, value: structuredClone(value) }); } } },
    project: structuredClone(project), openFiles: [], featureFiles: [], featureUnavailable: [], featureStores: new Map(), runtimeWorkspaceStores: new Map(),
    service: { getFiles: mockDisplaySources, getFile: async (id, path) => { reads.push({ id, path }); if (readHook) return readHook(id, path); if (!sources.has(path)) throw new Error('Missing source'); return structuredClone(sources.get(path)); } },
    runtime, runtimeRoot: project.root, runtimeGeneration: 1, runtimeFrameOrigin: 'http://127.0.0.1:4173', runtimeSelectionKey: '',
    featureLoadGeneration: 0, featureSourceEpoch: 0, featureCacheKey: '', featureLoadKey: '', disposed: false,
    generation: 0, focusGeneration: 0, askGeneration: 0,
    dirtyPaths: () => [], queueConversationState() {}, updateTree() {},
    show: mode => calls.push(['show', mode]), sendState() { states.push({ projectId: this.project?.id }); },
  });
  const h = { host, runtimeState, runtime, vscode, persisted, writes, reads, calls, messages, states, sources,
    setRead: hook => { readHook = hook; }, setWrite: hook => { writeHook = hook; }, setDiscover: hook => { discoverHook = hook; }, setNavigate: hook => { navigateHook = hook; }, setStart: hook => { startHook = hook; },
    state: () => structuredClone(host.runtimeWorkspaceSnapshot()), raw: () => host.runtimeWorkspaceStore().snapshot(),
    action: (action, fields = {}) => host.runtimeWorkspaceAction({ action, projectId: host.project?.id, expectedRevision: host.runtimeWorkspaceStore().snapshot().revision, ...fields }),
  };
  t.after(async () => { writeHook = undefined; await host.endScenarioRun('cancelled').catch(() => {}); host.disposed = true; await Promise.all([...host.featureStores.values(), ...host.runtimeWorkspaceStores.values()].map(store => store.dispose())); });
  return h;
}
async function setup(t) {
  const h = harness(t);
  await h.host.featureAction({ action: 'create', projectId: project.id, expectedRevision: 0, input: { title: 'Save profile', brief: 'Inspect saved behavior.', paths: ['src/Button.tsx'], entryPath: 'src/Button.tsx' } });
  await h.action('createScreen', { input: { title: 'Profile', targetId: 'vite:dev', route: '/profile' } });
  const screen = h.raw().screens[0];
  await h.action('createScenario', { input: { screenId: screen.id, title: 'Save', steps: ['Press Save.'], expectedOutcome: 'Saving returns to an editable state.' } });
  return Object.assign(h, { screen, scenario: h.raw().scenarios[0] });
}
const begin = h => h.action('beginRun', { scenarioId: h.scenario.id });
const active = h => h.state().activeRun;
const record = (h, index, extra = {}) => ({ id: `${h.runtimeState.session}:${h.runtimeState.viewId}:${index}`, session: h.runtimeState.session, documentId: h.runtimeState.documentId,
  kind: 'request', method: 'POST', url: 'http://127.0.0.1:4173/api/profile', status: 200, durationMs: 12.5, outcome: 'success', observedAt: new Date().toISOString(), timing: 'response-headers', correlation: 'unattributed', ...extra });

test('screen and scenario metadata do not start a target; explicit Open navigates and rotates the view', async t => {
  const h = await setup(t); assert.deepEqual(h.calls, [['discover']]);
  const oldView = h.runtimeState.viewId;
  await h.action('openScreen', { screenId: h.screen.id });
  assert.equal(h.calls.some(call => call[0] === 'start'), false); assert.ok(h.calls.some(call => call[0] === 'navigate' && call[1] === '/profile'));
  assert.notEqual(h.runtimeState.viewId, oldView); assert.equal(h.runtimeState.owned, true); assert.equal(h.runtimeState.pageConnected, false);
  await assert.rejects(begin(h), /wait for its observed route/);
});

test('screen routes, discovered targets and feature ownership are validated before definitions are stored', async t => {
  const h = await setup(t), baseline = h.raw().screens.length;
  for (const route of ['https://user:secret@evil.invalid/path', '/profile?key=SECRET', '/profile#secret', '/../outside', '/__foundation/snapshot'])
    await assert.rejects(h.action('createScreen', { input: { title: 'Invalid', targetId: 'vite:dev', route } }));
  await assert.rejects(h.action('createScreen', { input: { title: 'Unknown', targetId: 'shell:evil', route: '/' } }), /discovered target/);
  await assert.rejects(h.action('createScreen', { input: { title: 'Foreign', targetId: 'vite:dev', route: '/', featureId: 'foreign' } }), /another feature/);
  assert.equal(h.raw().screens.length, baseline); assert.doesNotMatch(JSON.stringify([...h.persisted.values()]), /SECRET|user:secret|evil\.invalid/);
  assert.equal(h.calls.some(call => call[0] === 'start'), false);
});

test('begin captures saved source and dirty-path labels without reading drafts or opening a second canvas', async t => {
  const h = await setup(t); h.host.dirtyPaths = () => ['src/Button.tsx', 'src/App.tsx'];
  await begin(h); const run = active(h);
  assert.equal(run.status, 'recording'); assert.equal(run.assessment, 'not-assessed'); assert.deepEqual(run.observations, []);
  assert.deepEqual(run.sources, [{ path: 'src/Button.tsx', revision: hash(h.sources.get('src/Button.tsx').source) }]);
  assert.deepEqual(run.dirtyPaths, ['src/Button.tsx']); assert.equal(run.runtime.documentId, h.runtimeState.documentId);
  assert.equal(run.runtime.pageVersion, 1);
  assert.equal(h.calls.some(call => call[0] === 'show'), false, 'an external document remains the only view when canvas is closed');
});

test('only fresh records from the exact run session, view and document are captured, without inferring success', async t => {
  const h = await setup(t); h.runtimeState.observations = [record(h, 'before')]; await begin(h);
  const started = active(h), valid = record(h, 'after');
  h.runtimeState.observations.push(valid, { ...valid }, record(h, 'old', { observedAt: '2020-01-01T00:00:00.000Z' }), record(h, 'unknown-time', { observedAt: null }),
    record(h, 'invalid-time', { observedAt: 'not-a-time' }), record(h, 'future-time', { observedAt: new Date(Date.now() + 86400000).toISOString() }),
    record(h, 'foreign-session', { session: '9'.repeat(32) }), record(h, 'foreign-view', { id: `${h.runtimeState.session}:${'8'.repeat(32)}:foreign` }), record(h, 'foreign-document', { documentId: '7'.repeat(32) }));
  await h.host.reconcileScenarioRun(); await h.host.reconcileScenarioRun();
  assert.deepEqual(active(h).observations, [valid]); assert.equal(active(h).assessment, 'not-assessed'); assert.equal(active(h).status, 'recording');
  await h.action('finishRun', { id: started.id, assessment: 'not-assessed', note: 'Observed only', observations: [record(h, 'FORGED_RENDERER')] });
  const ended = h.raw().runs[0]; assert.equal(ended.status, 'completed'); assert.equal(ended.assessment, 'not-assessed'); assert.deepEqual(ended.observations, [valid]);
  assert.doesNotMatch(JSON.stringify(h.raw()), /FORGED_RENDERER/);
});

test('explicit matched and not-matched assessments remain user supplied and are never inferred from HTTP status', async t => {
  for (const assessment of ['matched', 'not-matched']) {
    const h = await setup(t); await begin(h); const id = active(h).id;
    h.runtimeState.observations.push(record(h, 1, { status: assessment === 'matched' ? 503 : 200, outcome: assessment === 'matched' ? 'http-error' : 'success' }));
    await h.host.reconcileScenarioRun(); assert.equal(active(h).assessment, 'not-assessed');
    await h.action('finishRun', { id, assessment, note: 'Explicit fixture assessment' }); assert.equal(h.raw().runs[0].assessment, assessment);
  }
});

test('session, view, document, route, target, connection, trust and project changes interrupt instead of passing', async t => {
  for (const mutate of [h => { h.runtimeState.session = '4'.repeat(32); }, h => { h.runtimeState.viewId = '5'.repeat(32); }, h => { h.runtimeState.documentId = '6'.repeat(32); },
    h => { h.runtimeState.pagePath = '/other'; }, h => { h.runtimeState.target.id = 'other'; }, h => { h.runtimeState.status = 'disconnected'; },
    h => { h.runtimeState.pageConnected = false; }, h => { h.vscode.workspace.isTrusted = false; }, h => { h.host.project = { ...project, id: 'other' }; }]) {
    const h = await setup(t); await begin(h); const store = h.host.runtimeWorkspaceStore(), valid = record(h, 1);
    h.runtimeState.observations.push(valid); await h.host.reconcileScenarioRun(); mutate(h); await h.host.reconcileScenarioRun();
    const run = store.snapshot().runs[0]; assert.equal(run.status, 'interrupted'); assert.equal(run.assessment, 'not-assessed'); assert.deepEqual(run.observations, [valid]); assert.equal(h.host.scenarioCapture, undefined);
  }
});

test('definition edits are blocked during capture; changing the feature explicitly interrupts its run', async t => {
  const h = await setup(t); await begin(h);
  await assert.rejects(h.action('updateScenario', { id: h.scenario.id, input: { title: 'Changed' } }), /Finish or cancel/);
  await assert.rejects(h.action('openScreen', { screenId: h.screen.id }), /Finish or cancel/);
  const feature = h.host.features().snapshot();
  await h.host.featureAction({ action: 'update', projectId: project.id, expectedRevision: feature.revision, id: feature.activeId, input: { brief: 'New task' } });
  assert.equal(h.raw().runs[0].status, 'interrupted'); assert.equal(h.raw().runs[0].assessment, 'not-assessed');
});

test('a route round trip between polls interrupts the original run even when its path and document match again', async t => {
  const h = await setup(t); await begin(h); const original = structuredClone(active(h));
  h.runtimeState.pageVersion += 2;
  assert.equal(h.runtimeState.pagePath, original.runtime.route);
  assert.equal(h.runtimeState.documentId, original.runtime.documentId);
  await h.host.reconcileScenarioRun();
  const run = h.raw().runs[0];
  assert.equal(run.status, 'interrupted'); assert.equal(run.assessment, 'not-assessed');
  assert.deepEqual(run.runtime, original.runtime); assert.equal(h.host.scenarioCapture, undefined);
});

test('known unavailable source interrupts a run even while its earlier saved bytes remain cached', async t => {
  const h = await setup(t); await begin(h); const valid = record(h, 'before-missing');
  h.runtimeState.observations.push(valid); await h.host.reconcileScenarioRun();
  h.host.featureFiles = [structuredClone(h.sources.get('src/Button.tsx'))];
  h.host.featureUnavailable = [{ path: 'src/Button.tsx', kind: 'source-unavailable', reason: 'Saved source is missing.' }];
  await h.host.reconcileScenarioRun();
  const run = h.raw().runs[0];
  assert.equal(run.status, 'interrupted'); assert.equal(run.assessment, 'not-assessed');
  assert.match(run.interruption, /source is no longer available/); assert.deepEqual(run.observations, [valid]);
  assert.equal(h.host.scenarioCapture, undefined);
});

test('unloaded source or a context limit cannot be treated as evidence that source became unavailable', async t => {
  for (const kind of ['unloaded', 'context-limit']) {
    const h = await setup(t); await begin(h); const id = active(h).id;
    h.host.featureFiles = []; h.host.openFiles = [];
    h.host.featureUnavailable = kind === 'context-limit' ? [{ path: 'src/Button.tsx', kind, reason: 'Source exceeds the context budget.' }] : [];
    await h.host.reconcileScenarioRun();
    assert.equal(active(h).id, id); assert.equal(active(h).status, 'recording'); assert.equal(active(h).assessment, 'not-assessed');
    assert.equal(h.state().runFreshness[0].status, 'unknown');
    await h.action('cancelRun', { id });
  }
});

test('late requests after cancellation or a newer run cannot modify the prior historical record', async t => {
  const h = await setup(t); await begin(h); const id = active(h).id; await h.action('cancelRun', { id }); const original = structuredClone(h.raw().runs[0]);
  h.runtimeState.observations.push(record(h, 'late')); await h.host.reconcileScenarioRun(); assert.deepEqual(h.raw().runs[0], original);
  await begin(h); assert.deepEqual(active(h).observations, []); await assert.rejects(h.action('finishRun', { id, assessment: 'matched', note: '' }), /current manual observation/);
  assert.deepEqual(h.raw().runs[0], original);
});

test('source mutation during either preflight pass prevents starting an observation', async t => {
  for (const phase of ['second-read', 'ownership']) {
    const h = await setup(t); let count = 0;
    h.setRead(async (_id, path) => {
      count++;
      if (phase === 'ownership' && count === 1) h.runtimeState.documentId = '9'.repeat(32);
      return phase === 'second-read' && count === 2 ? file(path, 'changed saved bytes') : structuredClone(h.sources.get(path));
    });
    await assert.rejects(begin(h), /changed/); assert.equal(h.raw().runs.length, 0);
  }
});

test('saved source changes during initial persistence create an interrupted record rather than a live obsolete baseline', async t => {
  const h = await setup(t), gate = deferred();
  h.setWrite((key, value) => key.startsWith('foundation.runtime-workspaces.') && value.runs.some(run => run.status === 'recording') ? gate.promise : undefined);
  const pending = begin(h); await tick(); h.sources.set('src/Button.tsx', file('src/Button.tsx', 'changed while writing')); gate.resolve(); await pending;
  assert.equal(h.raw().runs[0].status, 'interrupted'); assert.equal(h.raw().runs[0].assessment, 'not-assessed'); assert.match(h.raw().runs[0].interruption, /source changed/); assert.equal(h.host.scenarioCapture, undefined);
});

test('ownership changes during initial persistence prevent further source reads and interrupt the saved run', async t => {
  const h = await setup(t), gate = deferred(); h.reads.length = 0;
  h.setWrite((key, value) => key.startsWith('foundation.runtime-workspaces.') && value.runs.some(run => run.status === 'recording') ? gate.promise : undefined);
  const pending = begin(h); await tick(); const reads = h.reads.length; h.vscode.workspace.isTrusted = false; gate.resolve(); await pending;
  assert.equal(h.reads.length, reads); assert.equal(h.host.runtimeWorkspaceStore().snapshot().runs[0].status, 'interrupted'); assert.equal(h.host.scenarioCapture, undefined);
});

test('final assessment rereads saved bytes and rechecks runtime ownership after an awaited source read', async t => {
  for (const phase of ['source', 'runtime']) {
    const h = await setup(t); await begin(h); const id = active(h).id;
    if (phase === 'source') h.sources.set('src/Button.tsx', file('src/Button.tsx', 'new saved bytes'));
    else h.setRead(async (_id, path) => { h.runtimeState.documentId = '9'.repeat(32); return structuredClone(h.sources.get(path)); });
    await h.action('finishRun', { id, assessment: 'matched', note: 'Must not be accepted' });
    assert.equal(h.raw().runs[0].status, 'interrupted'); assert.equal(h.raw().runs[0].assessment, 'not-assessed'); assert.notEqual(h.raw().runs[0].note, 'Must not be accepted');
  }
});

test('failed finish persistence reports storage failure and retains the original durable record until retry', async t => {
  const h = await setup(t); await begin(h); const id = active(h).id;
  h.setWrite(() => { throw new Error('PRIVATE_STORAGE_ERROR'); });
  await assert.rejects(h.action('finishRun', { id, assessment: 'matched', note: '' }));
  assert.equal(h.raw().storage.status, 'error'); assert.ok(h.host.runtimeWorkspaceError); assert.doesNotMatch(h.host.runtimeWorkspaceError, /PRIVATE_STORAGE_ERROR/);
  const disk = h.persisted.get(`foundation.runtime-workspaces.${project.id}`); assert.equal(disk.runs[0].status, 'recording');
  h.setWrite(undefined); await h.action('retry'); assert.equal(h.raw().storage.status, 'saved');
});

test('failed initial run persistence recovers as interrupted without an orphan capture or automatic recording', async t => {
  const h = await setup(t), initial = structuredClone(h.raw());
  h.setWrite(() => { throw new Error('PRIVATE_BEGIN_WRITE_ERROR'); });
  await assert.rejects(begin(h));
  assert.equal(h.raw().storage.status, 'error'); assert.equal(h.raw().runs.length, 1); assert.equal(h.raw().runs[0].status, 'recording');
  assert.equal(h.host.scenarioCapture, undefined); assert.equal(h.persisted.get(`foundation.runtime-workspaces.${project.id}`).runs.length, initial.runs.length);
  assert.doesNotMatch(h.host.runtimeWorkspaceError, /PRIVATE_BEGIN_WRITE_ERROR/);
  h.runtimeState.observations = [record(h, 'while-unsaved')]; await h.host.reconcileScenarioRun();
  h.setWrite(undefined); await h.action('retry');
  const recovered = h.raw().runs[0]; assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.assessment, 'not-assessed'); assert.deepEqual(recovered.observations, []);
  assert.equal(h.raw().storage.status, 'saved'); assert.equal(h.host.scenarioCapture, undefined);
  assert.equal(h.persisted.get(`foundation.runtime-workspaces.${project.id}`).runs[0].status, 'interrupted');
  await h.action('retry'); assert.equal(h.raw().runs.length, 1, 'recovery cannot duplicate a run');
  await begin(h); assert.notEqual(active(h).id, recovered.id); assert.deepEqual(active(h).observations, []);
});

test('a rejected finish retains capture so a corrected explicit assessment can be saved', async t => {
  const h = await setup(t); await begin(h); const run = active(h);
  await assert.rejects(h.action('finishRun', { id: run.id, assessment: 'matched', note: 'invalid\0note' }));
  assert.equal(h.host.scenarioCapture.run.id, run.id); assert.equal(h.host.scenarioCapture.ending, undefined);
  assert.equal(h.raw().runs[0].status, 'recording'); assert.equal(h.raw().storage.status, 'saved');
  await h.action('finishRun', { id: run.id, assessment: 'not-matched', note: 'Corrected manual assessment' });
  assert.equal(h.raw().runs[0].status, 'completed'); assert.equal(h.raw().runs[0].assessment, 'not-matched'); assert.equal(h.host.scenarioCapture, undefined);
});

test('history snapshots survive restart and report current, stale or unknown source without restoring a connection', async t => {
  const h = await setup(t); await begin(h); const id = active(h).id; await h.action('finishRun', { id, assessment: 'matched', note: 'Manual' });
  const original = structuredClone(h.raw().runs[0]); assert.equal(h.state().runFreshness[0].status, 'current');
  h.host.featureFiles = [file('src/Button.tsx', 'different current source')]; assert.equal(h.state().runFreshness[0].status, 'stale');
  h.host.featureFiles = []; assert.equal(h.state().runFreshness[0].status, 'unknown'); assert.deepEqual(h.raw().runs[0], original);
  const restored = harness(t, h.persisted); restored.runtimeState.status = 'idle'; assert.deepEqual(restored.raw().runs[0], original); assert.equal(restored.host.scenarioCapture, undefined); assert.deepEqual(restored.calls, []);
});

test('known unavailable source makes historical freshness unknown instead of trusting cached current or stale bytes', async t => {
  const h = await setup(t); await begin(h); const id = active(h).id;
  await h.action('finishRun', { id, assessment: 'matched', note: 'Explicit historical assessment.' });
  const original = structuredClone(h.raw().runs[0]);
  for (const cached of [h.sources.get('src/Button.tsx'), file('src/Button.tsx', 'obsolete cached source')]) {
    h.host.featureFiles = [structuredClone(cached)]; h.host.openFiles = [structuredClone(cached)];
    h.host.featureUnavailable = [{ path: 'src/Button.tsx', kind: 'source-unavailable', reason: 'Source cannot be loaded.' }];
    assert.equal(h.state().runFreshness[0].status, 'unknown'); assert.match(h.state().runFreshness[0].reason, /cannot be verified/);
    assert.deepEqual(h.raw().runs[0], original, 'freshness never rewrites the saved observation or its explicit assessment');
  }
});

test('request capture is bounded and overflow is explicitly recorded rather than fabricated as full evidence', async t => {
  const h = await setup(t); await begin(h); const id = active(h).id;
  h.runtimeState.observations = Array.from({ length: 100 }, (_, index) => record(h, index)); await h.host.reconcileScenarioRun();
  h.runtimeState.observations = [record(h, 'overflow')]; await h.host.reconcileScenarioRun();
  assert.equal(active(h).observations.length, 100); assert.equal(active(h).truncated, true); assert.equal(active(h).assessment, 'not-assessed');
  await h.action('finishRun', { id, assessment: 'not-assessed', note: 'Partial request history' }); assert.equal(h.raw().runs[0].truncated, true);
});
