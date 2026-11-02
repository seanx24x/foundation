import { mockDisplaySources } from './helpers/display-source-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.FOUNDATION_RUNTIME_HOST_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const projectRequire = createRequire(join(root, 'package.json'));
const ts = projectRequire('typescript');
const projectDecisionsStoreModule = await import(join(root, 'desktop/extension/src/project-decisions-store.mjs'));
const projectDecisionsModule = await import(join(root, 'server/project/project-decisions.mjs'));
const featureStoreModule = await import(join(root, 'desktop/extension/src/feature-store.mjs'));
const taskContextModule = await import(join(root, 'server/project/assistant.mjs'));
const safety = await import(join(root, 'desktop/extension/src/safety.mjs'));
const source = readFileSync(join(root, 'desktop/extension/src/extension.ts'), 'utf8');
const runtimeWorkspaceModule = await import(join(root, 'desktop/extension/src/runtime-workspace-store.mjs'));
const runtimeReplayModule = await import(join(root, 'desktop/extension/src/runtime-replay-store.mjs'));
const runtimeMatrixModule = await import(join(root, 'desktop/extension/src/runtime-matrix-store.mjs'));
const runtimeStateSuiteModule = await import(join(root, 'desktop/extension/src/runtime-state-suite-store.mjs'));
const compiled = ts.transpileModule(`${source}\nexport { FoundationHost };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const uri = path => ({ scheme: 'file', fsPath: path, toString: () => `file://${path}` });
const project = { id: 'fixture', root: '/fixtures/app', files: [{ path: 'src/App.tsx' }, { path: 'src/Button.tsx' }] };
const savedSource = 'export const example = true;\n';
const runtimeRevision = createHash('sha256').update(savedSource).digest('hex');
const sourceRevision = runtimeRevision.slice(0, 16);
const file = (path, revision = sourceRevision) => ({ path, revision, source: savedSource, analysis: { imports: [], consumers: [], symbols: [], requests: [] } });
const selection = { mapping: 'resolved', path: 'src/Button.tsx', revision: runtimeRevision, line: 1, label: 'Save', stale: false };
const observation = (id = 'request-1', session = 'runtime-1') => ({ id, session, kind: 'request', method: 'POST', url: '/api/profile', status: 503, durationMs: 12.5, outcome: 'http-error', observedAt: '2026-10-28T10:00:00.000Z', correlation: 'unattributed' });
const sourceEditor = () => ({ document: { uri: uri(`${project.root}/src/App.tsx`), lineCount: 2, isDirty: true }, selection: { start: { line: 0 }, end: { line: 0 } } });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function harness() {
  const reads = [], states = [], writes = [], commands = [], runtimeCalls = [];
  const snapshot = { status: 'connected', root: project.root, session: 'runtime-1', url: 'http://127.0.0.1:4173/', selectionVersion: 1, selection: { ...selection }, observations: [observation(), observation('request-2')], targets: [], files: [], owned: false, capabilities: { sourceMapping: 'available', requests: true, screenshots: false } };
  const vscode = {
    Uri: { file: uri },
    commands: { executeCommand: async (...args) => { commands.push(args); } },
    window: { activeTextEditor: undefined },
    workspace: { isTrusted: true, textDocuments: [], workspaceFolders: [{ uri: uri(project.root) }], getWorkspaceFolder: value => value.fsPath.startsWith(`${project.root}/`) ? { uri: uri(project.root) } : undefined },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Buffer, URL, AbortController, TextDecoder, setTimeout, clearTimeout,
    fetch() { throw new Error('A runtime selection must not send provider requests.'); },
    require: name => name === 'vscode' ? vscode : name.includes('project-decisions-store') ? projectDecisionsStoreModule : name.includes('project-decisions.mjs') ? projectDecisionsModule : name.includes('runtime-workspace-store') ? runtimeWorkspaceModule : name.includes('runtime-state-suite-store') ? runtimeStateSuiteModule : name.includes('runtime-matrix-store') ? runtimeMatrixModule : name.includes('runtime-replay-store') ? runtimeReplayModule : name.includes('feature-store') ? featureStoreModule : name.includes('assistant.mjs') ? taskContextModule : name.includes('safety') ? safety : name.startsWith('node:') ? projectRequire(name) : {},
  });
  const runtime = {
    snapshot: () => structuredClone(snapshot), dispose: async () => { runtimeCalls.push(['dispose']); },
    discover: async () => { runtimeCalls.push(['discover']); },
    start: async id => { runtimeCalls.push(['start', id]); },
    connect: async url => { runtimeCalls.push(['connect', url]); },
    stop: async () => { runtimeCalls.push(['stop']); },
  };
  const host = Object.create(module.exports.FoundationHost.prototype);
  Object.assign(host, {
    // These fixtures exercise native focus/runtime ownership without an issue journal.
    reproducibleIssuesSnapshot: () => null, refreshReproducibleIssues: async () => {},
    context: { workspaceState: { get: () => undefined, update: async (key, value) => { writes.push({ key, value: structuredClone(value) }); } } },
    project: structuredClone(project), activeFile: file('src/App.tsx'), openFiles: [file('src/App.tsx')],
    lastDocument: uri(`${project.root}/src/App.tsx`), focus: { path: 'src/App.tsx', line: 1, origin: 'source', revision: sourceRevision },
    runtime, runtimeRoot: project.root, runtimeGeneration: 1, runtimeSelectionKey: '', runtimeFrameOrigin: 'http://127.0.0.1:4173',
    focusGeneration: 0, generation: 0, designGeneration: 0, askGeneration: 0, disposed: false,
    status: {}, design: { status: 'idle' }, diagnostics: { runAsync: (_name, task) => task() },
    service: { getFiles: mockDisplaySources, getFile: async (_id, path) => { reads.push(path); return file(path); }, snapshot: async () => structuredClone(project) },
    proposals: () => ({ assess: async () => {} }), queueRefresh() {}, cancelQuestion() {}, updateTree() {},
    sendState() { states.push({ focus: structuredClone(this.focus), activeFile: structuredClone(this.activeFile) }); },
  });
  return { host, vscode, snapshot, runtime, reads, states, writes, commands, runtimeCalls };
}

test('explicit runtime source selection supersedes a pending source refresh without opening or editing a document', async () => {
  const h = harness(), pending = deferred();
  h.host.service.getFile = async (_id, path) => path === 'src/App.tsx' ? pending.promise : file(path);
  const refresh = h.host.refresh(); await tick();
  await h.host.runtimeChanged(1);
  pending.resolve(file('src/App.tsx')); await refresh;
  assert.equal(h.host.activeFile.path, 'src/Button.tsx'); assert.equal(h.host.focus.origin, 'runtime');
  assert.equal(h.host.focus.session, 'runtime-1'); assert.equal(h.host.focus.revision, sourceRevision);
  assert.equal(h.host.openFiles[0].path, 'src/Button.tsx'); assert.equal(h.commands.length, 0);
  assert.deepEqual(h.writes.at(-1).value, { version: 1, path: 'src/Button.tsx', line: 1, endLine: undefined, revision: sourceRevision });
  assert.equal(h.writes.at(-1).value.session, undefined, 'runtime freshness is not persisted as restored source focus');
});

test('polling the same selection version cannot steal focus back from a native editor', async () => {
  const h = harness(); await h.host.runtimeChanged(1);
  const editor = sourceEditor(); h.vscode.window.activeTextEditor = editor; h.host.followEditor(editor); await h.host.refresh();
  const reads = h.reads.length;
  await h.host.runtimeChanged(1); await h.host.runtimeChanged(1);
  assert.equal(h.host.activeFile.path, 'src/App.tsx'); assert.equal(h.host.focus.origin, 'source'); assert.equal(h.reads.length, reads);
  h.snapshot.selectionVersion++;
  await h.host.runtimeChanged(1);
  assert.equal(h.host.activeFile.path, 'src/Button.tsx'); assert.equal(h.host.focus.origin, 'runtime', 'a new explicit runtime selection may move focus');
});

test('ambiguous, unavailable, stale and mismatched mappings cannot establish source focus', async () => {
  for (const patch of [{ mapping: 'ambiguous' }, { mapping: 'unavailable' }, { stale: true }, { path: '../outside.tsx' }, { revision: 'outdated' }]) {
    const h = harness(); Object.assign(h.snapshot.selection, patch); await h.host.runtimeChanged(1);
    assert.equal(h.host.activeFile.path, 'src/App.tsx'); assert.equal(h.host.focus.origin, 'source'); assert.equal(h.writes.length, 0);
  }
  for (const state of ['disconnected', 'connecting', 'failed']) {
    const h = harness(); h.snapshot.status = state; await h.host.runtimeChanged(1);
    assert.equal(h.host.focus.origin, 'source'); assert.equal(h.reads.length, 0);
  }
});

test('a delayed runtime source read cannot override native focus, another project, replacement runtime, revoked trust or disposal', async () => {
  const mutations = [
    h => h.host.followEditor(sourceEditor()),
    h => { h.host.project = { ...project, id: 'other', root: '/other' }; },
    h => { h.host.runtime = { snapshot: () => h.snapshot }; },
    h => { h.vscode.workspace.isTrusted = false; },
    h => { h.host.disposed = true; },
    h => { h.host.runtimeGeneration++; },
  ];
  for (const mutate of mutations) {
    const h = harness(), pending = deferred(); h.host.service.getFile = () => pending.promise;
    const selection = h.host.runtimeChanged(1); mutate(h); pending.resolve(file('src/Button.tsx')); await selection;
    assert.equal(h.host.activeFile.path, 'src/App.tsx'); assert.equal(h.host.focus.origin, 'source'); assert.ok(h.writes.every(write => write.value.path === 'src/App.tsx'));
  }
});

const selectionOwnershipMutations = [
  ['session', h => { h.snapshot.session = 'replacement-session'; }],
  ['view', h => { h.snapshot.viewId = 'replacement-view'; }],
  ['document', h => { h.snapshot.documentId = 'replacement-document'; }],
  ['route', h => { h.snapshot.pagePath = '/other'; }],
  ['round-trip route version', h => { h.snapshot.pageVersion += 2; }],
  ['selection version', h => { h.snapshot.selectionVersion++; }],
  ['cleared selection', h => { h.snapshot.selection = null; }],
  ['stale selection', h => { h.snapshot.selection.stale = true; }],
];
function routeIdentity(h) { Object.assign(h.snapshot, { viewId: 'first-view', documentId: 'first-document', pagePath: '/profile', pageVersion: 1 }); }

test('runtime ownership changes during the actual source read cannot move focus or persist a selection', async () => {
  for (const [label, mutate] of [...selectionOwnershipMutations, ['disconnected', h => { h.snapshot.status = 'disconnected'; }]]) {
    const h = harness(), entered = deferred(), pending = deferred(); routeIdentity(h);
    h.host.service.getFile = async (_id, path) => { h.reads.push(path); entered.resolve(); return pending.promise; };
    const work = h.host.runtimeChanged(1); await entered.promise;
    assert.deepEqual(h.reads, ['src/Button.tsx']); mutate(h);
    pending.resolve(file('src/Button.tsx')); await work;
    assert.equal(h.host.activeFile.path, 'src/App.tsx', label); assert.equal(h.host.focus.origin, 'source', label);
    assert.equal(h.writes.length, 0, label);
  }
});

test('runtime ownership changes during scenario reconciliation retire the selection before reading its source', async () => {
  for (const [label, mutate] of selectionOwnershipMutations) {
    const h = harness(), entered = deferred(), pending = deferred(); routeIdentity(h);
    h.host.reconcileScenarioRun = async () => { entered.resolve(); await pending.promise; };
    const work = h.host.runtimeChanged(1); await entered.promise; mutate(h); pending.resolve(); await work;
    assert.equal(h.reads.length, 0, label); assert.equal(h.host.activeFile.path, 'src/App.tsx', label);
    assert.equal(h.host.focus.origin, 'source', label); assert.equal(h.writes.length, 0, label);
  }
});

test('unchanged ownership across reconciliation and source reads still follows an explicit runtime selection', async () => {
  const h = harness(), reconciliationEntered = deferred(), reconciliation = deferred(), readEntered = deferred(), read = deferred(); routeIdentity(h);
  h.host.reconcileScenarioRun = async () => { reconciliationEntered.resolve(); await reconciliation.promise; };
  h.host.service.getFile = async () => { readEntered.resolve(); return read.promise; };
  const work = h.host.runtimeChanged(1); await reconciliationEntered.promise; reconciliation.resolve();
  await readEntered.promise; read.resolve(file('src/Button.tsx')); await work;
  assert.equal(h.host.activeFile.path, 'src/Button.tsx'); assert.equal(h.host.focus.origin, 'runtime');
  assert.equal(h.host.focus.viewId, 'first-view'); assert.equal(h.writes.length, 1);
});

test('runtime evidence resolves only selected IDs from the current session and returns independent records', () => {
  const h = harness();
  const result = h.host.resolveRuntimeEvidence({ projectId: project.id, session: 'runtime-1', observationIds: ['request-2', 'request-1'] });
  assert.deepEqual(structuredClone(result), [observation('request-2'), observation()]);
  result[0].status = 200; assert.equal(h.snapshot.observations[1].status, 503);
  assert.equal(h.commands.length + h.runtimeCalls.length + h.reads.length, 0);
});

test('runtime evidence rejects unknown, foreign, duplicate, excessive and stale selection descriptors', () => {
  const h = harness(), valid = { projectId: project.id, session: 'runtime-1', observationIds: ['request-1'] };
  for (const patch of [{ projectId: 'other' }, { session: 'old-session' }, { observationIds: [] }, { observationIds: ['unknown'] }, { observationIds: ['request-1', 'request-1'] }, { observationIds: [1] }, { observationIds: Array.from({ length: 13 }, (_, i) => `request-${i}`) }])
    assert.throws(() => h.host.resolveRuntimeEvidence({ ...valid, ...patch }), /runtime|request|Reconnect|Select/i);
  h.snapshot.observations[0].session = 'other-session';
  assert.throws(() => h.host.resolveRuntimeEvidence(valid), /no longer available/);
});

test('runtime evidence requires a trusted active project and its own connected runtime root', () => {
  for (const mutate of [h => { h.vscode.workspace.isTrusted = false; }, h => { h.host.project = null; }, h => { h.host.runtimeRoot = '/different/project'; }, h => { h.snapshot.status = 'disconnected'; }, h => { h.host.runtime = undefined; }]) {
    const h = harness(); mutate(h);
    assert.throws(() => h.host.resolveRuntimeEvidence({ projectId: project.id, session: 'runtime-1', observationIds: ['request-1'] }), /runtime context changed/);
  }
});

test('only workspace messages dispatch runtime actions; the Assistant surface cannot start or connect a project', async () => {
  const h = harness();
  for (const action of ['discover', 'start', 'connect', 'stop', 'setup'])
    await h.host.message({ type: 'runtime', action, targetId: 'vite', url: 'http://127.0.0.1:4173/' }, 'assistant');
  assert.equal(h.runtimeCalls.length + h.commands.length, 0);
  await h.host.message({ type: 'runtime', action: 'start', targetId: 'vite' }, 'workspace');
  await h.host.message({ type: 'runtime', action: 'connect', url: 'http://127.0.0.1:4173/' }, 'workspace');
  assert.deepEqual(h.runtimeCalls, [['start', 'vite'], ['connect', 'http://127.0.0.1:4173/']]);
  h.vscode.workspace.isTrusted = false;
  await assert.rejects(h.host.message({ type: 'runtime', action: 'start', targetId: 'vite' }, 'workspace'), /trust/);
  assert.equal(h.runtimeCalls.length, 2);
});


test('a reconnected view on the same runtime can select the same numbered element afresh', async () => {
  const h = harness(); h.snapshot.viewId = 'first-view';
  await h.host.runtimeChanged(1);
  assert.equal(h.host.focus.viewId, 'first-view');
  h.host.followEditor(sourceEditor()); await h.host.refresh();
  h.snapshot.viewId = 'second-view';
  await h.host.runtimeChanged(1);
  assert.equal(h.host.activeFile.path, 'src/Button.tsx');
  assert.equal(h.host.focus.viewId, 'second-view');
  assert.equal(h.snapshot.selectionVersion, 1);
});
