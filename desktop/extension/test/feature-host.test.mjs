import { mockDisplaySources } from './helpers/display-source-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.FOUNDATION_FEATURE_HOST_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const projectRequire = createRequire(join(root, 'package.json'));
const ts = projectRequire('typescript');
const featureStoreModule = await import(join(root, 'desktop/extension/src/feature-store.mjs'));
const assistantModule = await import(join(root, 'server/project/assistant.mjs'));
const { createConversationStore } = await import(join(root, 'desktop/extension/src/conversation-store.mjs'));
const safety = await import(join(root, 'desktop/extension/src/safety.mjs'));
const runtimeWorkspaceModule = await import(join(root, 'desktop/extension/src/runtime-workspace-store.mjs'));
const runtimeReplayModule = await import(join(root, 'desktop/extension/src/runtime-replay-store.mjs'));
const runtimeMatrixModule = await import(join(root, 'desktop/extension/src/runtime-matrix-store.mjs'));
const runtimeStateSuiteModule = await import(join(root, 'desktop/extension/src/runtime-state-suite-store.mjs'));
const compiled = ts.transpileModule(`${readFileSync(join(root, 'desktop/extension/src/extension.ts'), 'utf8')}\nexport { FoundationHost };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const sourceFile = path => ({ path, revision: 'saved-r1', source: `export const ${path.split('/').at(-1).split('.')[0]} = () => null;\n`, analysis: { imports: [], consumers: [], symbols: [], requests: [] } });
const project = { id: 'feature-project', root: '/fixtures/feature-project', files: ['src/App.tsx', 'src/Button.tsx', 'src/Other.tsx'].map(path => ({ path })) };
function response(events = [{ type: 'start' }, { type: 'delta', text: 'Fixture answer' }, { type: 'done' }]) {
  let read = false;
  return { ok: true, body: { getReader: () => ({ read: async () => read ? { done: true } : (read = true, { done: false, value: Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + '\n') }) }) } };
}
function harness(t) {
  const persisted = new Map(), writes = [], reads = [], messages = [], requests = [], states = [], sources = new Map(project.files.map(item => [item.path, sourceFile(item.path)]));
  let getFile, write, bridgeGate, bridgeCount = 0, bridgeCloses = 0, showCount = 0;
  let fetchHandler = async () => response();
  const vscode = { workspace: { isTrusted: true, textDocuments: [] } };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Buffer, AbortController, TextDecoder, URL, setTimeout, clearTimeout,
    fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return fetchHandler(options); },
    require: name => {
      if (name === 'vscode') return vscode;
      if (name.includes('runtime-workspace-store')) return runtimeWorkspaceModule;
      if (name.includes('runtime-state-suite-store')) return runtimeStateSuiteModule;
      if (name.includes('runtime-matrix-store')) return runtimeMatrixModule;
      if (name.includes('runtime-replay-store')) return runtimeReplayModule;
      if (name.includes('feature-store')) return featureStoreModule;
      if (name.includes('conversation-store')) return { createConversationStore };
      if (name.includes('assistant.mjs')) return assistantModule;
      if (name.includes('assistant-bridge')) return { createAssistantBridge: async () => {
        bridgeCount++; if (bridgeGate) await bridgeGate;
        return { url: 'http://127.0.0.1:1', token: 'FIXTURE_ONLY', close: async () => { bridgeCloses++; } };
      } };
      if (name.includes('safety')) return safety;
      if (name.startsWith('node:')) return projectRequire(name);
      return {};
    },
  });
  const host = Object.create(module.exports.FoundationHost.prototype);
  Object.assign(host, {
    context: { subscriptions: [], workspaceState: {
      get: key => persisted.get(key), update: async (key, value) => {
        if (write) await write(key, value); persisted.set(key, structuredClone(value)); writes.push({ key, value: structuredClone(value) });
      },
    } },
    project: structuredClone(project), openFiles: [sourceFile('src/App.tsx')], activeFile: sourceFile('src/App.tsx'),
    service: { getFiles: mockDisplaySources, getFile: async (id, path) => { reads.push({ id, path }); if (getFile) return getFile(id, path); if (!sources.has(path)) throw new Error('Source unavailable'); return structuredClone(sources.get(path)); } },
    featureFiles: [], featureUnavailable: [], featureStores: new Map(), featureLoadGeneration: 0,
    featureSourceEpoch: 0, featureCacheKey: '', featureLoadKey: '', conversationStores: new Map(),
    askGeneration: 0, generation: 0, focusGeneration: 0, runtimeGeneration: 0, disposed: false,
    assistant: { status: () => ({ configured: true, providerKind: 'openai', model: 'fixture-model' }) },
    assistantReady: true, assistantOpen: true, assistantView: { visible: true, webview: { postMessage: message => messages.push(structuredClone(message)) } },
    proposals: () => ({ current: () => null }), dirtyPaths: () => [], queueConversationState() {}, updateTree() {},
    sendState() { states.push({ projectId: this.project?.id, paths: this.featureFiles.map(file => file.path) }); },
    showAssistant: async () => { showCount++; },
  });
  t.after(async () => { host.cancelQuestion(); host.disposed = true; await Promise.all([...host.conversationStores.values(), ...host.featureStores.values()].map(store => store.dispose())); });
  return { host, vscode, persisted, writes, reads, messages, requests, states, sources,
    setRead: handler => { getFile = handler; }, setWrite: handler => { write = handler; },
    setBridge: promise => { bridgeGate = promise; }, setFetch: handler => { fetchHandler = handler; },
    get bridgeCount() { return bridgeCount; }, get bridgeCloses() { return bridgeCloses; }, get showCount() { return showCount; },
  };
}
async function createFeature(h, extra = {}) {
  const snapshot = h.host.features().snapshot();
  return h.host.featureAction({ type: 'feature', action: 'create', projectId: h.host.project.id, expectedRevision: snapshot.revision,
    input: { title: 'Profile', brief: 'Clarify save behavior.', paths: ['src/Button.tsx'], entryPath: 'src/Button.tsx', ...extra } });
}
const descriptor = snapshot => ({ featureId: snapshot.activeId, revision: snapshot.revision });
const ask = (snapshot, extra = {}) => ({ requestId: 'feature-request', projectId: project.id, prompt: 'Explain the selected source.', context: [{ path: 'src/Button.tsx', revision: 'saved-r1' }], taskContext: descriptor(snapshot), ...extra });
const turns = h => h.host.conversations().snapshot().conversations.flatMap(item => item.turns);

test('feature metadata actions and preparation never send a provider request or automatically expand shared source', async t => {
  const h = harness(t), snapshot = await createFeature(h, { paths: ['src/Button.tsx', 'src/Other.tsx'] });
  assert.equal(h.host.featureFiles.length, 2); assert.equal(h.requests.length + h.bridgeCount, 0);
  h.host.dirtyPaths = () => ['src/Other.tsx'];
  await h.host.featureAction({ action: 'prepare', projectId: project.id, expectedRevision: snapshot.revision, id: snapshot.activeId });
  assert.equal(h.showCount, 1); assert.deepEqual(h.messages.at(-1).paths, ['src/Button.tsx']);
  assert.equal(h.requests.length + h.bridgeCount, 0); assert.equal(h.host.conversations().snapshot().conversations.length, 0);
});

test('the host resolves task text from its own feature store and accepts explicitly selected loaded feature files', async t => {
  const h = harness(t), snapshot = await createFeature(h, { title: '  Profile  ', paths: ['src/Button.tsx', 'src/Other.tsx'] });
  h.setFetch(async () => response([{ type: 'start', taskContext: { title: 'FORGED_RESPONSE' } }, { type: 'done' }]));
  await h.host.ask(ask(snapshot, { taskContext: { ...descriptor(snapshot), title: 'FORGED_TITLE', brief: 'FORGED_BRIEF', files: ['private.env'], tools: ['shell'] } }));
  assert.equal(h.requests.length, 1); assert.deepEqual(h.requests[0].context, [{ path: 'src/Button.tsx', revision: 'saved-r1' }]);
  const expected = { version: 1, featureId: snapshot.activeId, title: 'Profile', brief: 'Clarify save behavior.', revision: snapshot.revision };
  assert.deepEqual(h.requests[0].taskContext, expected); assert.deepEqual(turns(h)[0].taskContext, expected);
  assert.equal(turns(h)[0].context.length, 1); assert.equal(h.requests[0].runtimeContext, undefined);
  assert.doesNotMatch(JSON.stringify(h.requests), /FORGED_TITLE|FORGED_BRIEF|private.env|shell|src\/Other/);
});

test('stale, foreign-feature and cross-project requests cannot read source or send context', async t => {
  const h = harness(t), snapshot = await createFeature(h); h.reads.length = 0;
  for (const extra of [{ projectId: 'different-project' }, { taskContext: { ...descriptor(snapshot), featureId: 'other-feature' } }, { taskContext: { ...descriptor(snapshot), revision: 0 } }])
    await assert.rejects(h.host.ask(ask(snapshot, extra)), /project changed|task brief changed/);
  assert.equal(h.reads.length + h.requests.length, 0);
  h.host.project = { ...project, id: 'another-project', root: '/fixtures/another' };
  assert.throws(() => h.host.resolveTaskContext(descriptor(snapshot)), /task brief changed/);
});

test('unloaded, invented, duplicate and stale source selections cannot enter provider context', async t => {
  const h = harness(t), snapshot = await createFeature(h); h.reads.length = 0;
  for (const context of [[{ path: 'src/Other.tsx', revision: 'saved-r1' }], [{ path: 'src/Invented.tsx', revision: 'saved-r1' }], [{ path: '../outside.tsx', revision: 'saved-r1' }], [{ path: 'src/Button.tsx', revision: 'stale' }], Array(2).fill({ path: 'src/Button.tsx', revision: 'saved-r1' })])
    await assert.rejects(h.host.ask(ask(snapshot, { context })), /Source context changed/);
  assert.equal(h.reads.length + h.requests.length, 0);
});

test('feature mutations require current project, revision and idle request ownership', async t => {
  const h = harness(t), snapshot = await createFeature(h), baseline = h.writes.length;
  const change = { action: 'update', projectId: project.id, expectedRevision: snapshot.revision, id: snapshot.activeId, input: { brief: 'Updated' } };
  await assert.rejects(h.host.featureAction({ ...change, projectId: 'other' }), /trusted project/);
  await assert.rejects(h.host.featureAction({ ...change, expectedRevision: 0 }), /feature changed/);
  h.host.asking = { requestId: 'active' };
  await assert.rejects(h.host.featureAction(change), /Stop the current response/); h.host.asking = undefined;
  h.vscode.workspace.isTrusted = false; await assert.rejects(h.host.featureAction(change), /trusted project/);
  assert.equal(h.writes.length, baseline); assert.equal(h.requests.length, 0);
});

test('missing saved membership can be retained in an update but cannot be invented in a new feature', async t => {
  const h = harness(t), snapshot = await createFeature(h);
  h.host.project.files = h.host.project.files.filter(file => file.path !== 'src/Button.tsx'); h.sources.delete('src/Button.tsx');
  const updated = await h.host.featureAction({ action: 'update', projectId: project.id, expectedRevision: snapshot.revision, id: snapshot.activeId, input: { title: 'Retain missing member', paths: ['src/Button.tsx'] } });
  assert.deepEqual(updated.features[0].paths, ['src/Button.tsx']); assert.equal(h.host.featureFiles.length, 0); assert.equal(h.host.featureUnavailable[0].path, 'src/Button.tsx');
  await assert.rejects(h.host.featureAction({ action: 'create', projectId: project.id, expectedRevision: updated.revision, id: snapshot.activeId, input: { title: 'Forged reuse', paths: ['src/Button.tsx'] } }), /indexed source/);
});

test('a feature change during source preflight prevents history creation and provider dispatch', async t => {
  const h = harness(t), snapshot = await createFeature(h), gate = deferred(); h.setRead(() => gate.promise);
  const pending = h.host.ask(ask(snapshot)); await tick();
  await h.host.features().update(snapshot.activeId, { brief: 'New brief' }, snapshot.revision);
  gate.resolve(sourceFile('src/Button.tsx')); await pending;
  assert.equal(h.requests.length + h.bridgeCount, 0); assert.equal(turns(h).length, 0); assert.equal(h.messages.at(-1).event.type, 'error');
});

test('feature changes while saving history or opening the bridge preserve the original snapshot but prevent dispatch', async t => {
  for (const phase of ['history', 'bridge']) {
    const h = harness(t), snapshot = await createFeature(h), gate = deferred();
    if (phase === 'history') h.setWrite((key) => key.startsWith('foundation.conversations.') ? gate.promise : undefined);
    else h.setBridge(gate.promise);
    const pending = h.host.ask(ask(snapshot)); await tick();
    await h.host.features().select(null, snapshot.revision); gate.resolve(); await pending;
    assert.equal(h.requests.length, 0); assert.equal(turns(h)[0].state, 'failed');
    assert.equal(turns(h)[0].taskContext.featureId, snapshot.activeId); assert.equal(turns(h)[0].taskContext.revision, snapshot.revision);
    if (phase === 'bridge') assert.equal(h.bridgeCloses, 1);
  }
});

test('pending feature file reads cannot repopulate caches after selection, project or trust changes', async t => {
  for (const phase of ['selection', 'project', 'trust', 'disposed']) {
    const h = harness(t), snapshot = await createFeature(h), gate = deferred();
    h.host.featureCacheKey = ''; h.setRead(() => gate.promise);
    const pending = h.host.loadFeatureFiles(); await tick();
    if (phase === 'selection') await h.host.features().select(null, snapshot.revision);
    else if (phase === 'project') h.host.project = { ...project, id: 'other-project', root: '/other' };
    else if (phase === 'trust') h.vscode.workspace.isTrusted = false;
    else h.host.disposed = true;
    gate.resolve(sourceFile('src/Button.tsx')); await pending;
    assert.equal(h.host.featureFiles.length, 0); assert.equal(h.requests.length, 0);
  }
});

test('an in-flight feature save remains bound to its original project and cannot load source after project or trust changes', async t => {
  for (const phase of ['project', 'trust']) {
    const h = harness(t), gate = deferred(); h.setWrite(key => key.startsWith('foundation.features.') ? gate.promise : undefined);
    const pending = createFeature(h); await tick();
    if (phase === 'project') h.host.project = { ...project, id: 'another-project', root: '/another' };
    else h.vscode.workspace.isTrusted = false;
    gate.resolve(); await pending;
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].key, `foundation.features.${project.id}`); assert.equal(h.reads.length, 0); assert.equal(h.requests.length, 0);
  }
});

test('trust revocation during AI source preflight prevents task disclosure and clears cached feature source on refresh', async t => {
  const h = harness(t), snapshot = await createFeature(h), gate = deferred(); h.setRead(() => gate.promise);
  const pending = h.host.ask(ask(snapshot)); await tick(); h.vscode.workspace.isTrusted = false;
  gate.resolve(sourceFile('src/Button.tsx')); await pending;
  assert.equal(h.requests.length + h.bridgeCount, 0); assert.equal(turns(h).length, 0); assert.equal(h.host.featureSnapshot(), null);
  await h.host.refresh(); assert.equal(h.host.project, null); assert.equal(h.host.featureFiles.length, 0); assert.equal(h.host.featureUnavailable.length, 0);
});

test('relevant feature source changes invalidate cached file revisions before context can be reused', async t => {
  const h = harness(t); await createFeature(h);
  const before = h.host.featureSourceEpoch;
  assert.equal(h.host.relevantSource({ fsPath: `${project.root}/src/Button.tsx`, toString: () => 'file:///fixture/Button' }), true);
  assert.equal(h.host.featureSourceEpoch, before + 1); assert.equal(h.host.featureCacheKey, '');
  h.sources.set('src/Button.tsx', { ...sourceFile('src/Button.tsx'), revision: 'saved-r2' }); await h.host.loadFeatureFiles();
  assert.equal(h.host.featureFiles[0].revision, 'saved-r2'); assert.equal(h.requests.length, 0);
});
