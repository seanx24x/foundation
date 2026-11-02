import { mockDisplaySources } from './helpers/display-source-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.FOUNDATION_RELATIONSHIPS_HOST_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const projectRequire = createRequire(join(root, 'package.json')), ts = projectRequire('typescript');
const safety = await import(join(root, 'desktop/extension/src/safety.mjs'));
const compiled = ts.transpileModule(`${readFileSync(join(root, 'desktop/extension/src/extension.ts'), 'utf8')}\nexport { FoundationHost };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const uri = fsPath => ({ fsPath, scheme: 'file', toString: () => `file://${fsPath}` });
const sourceFile = (path, source = `export const saved = '${path}';\nexport function behavior() {\n  return saved;\n}\n`) => ({ path, source, revision: createHash('sha256').update(source).digest('hex').slice(0, 16), analysis: { imports: [], consumers: [], symbols: [], requests: [] } });
const project = { id: 'relationships-project', root: '/fixtures/relationships', files: ['src/Button.tsx', 'src/App.tsx', 'src/api.ts', 'src/Draft.ts', 'src/Other.ts'].map(path => ({ path })) };

function harness(storage = new Map()) {
  const sources = new Map(project.files.map(item => [item.path, sourceFile(item.path)]));
  const queries = [], reads = [], validations = [], openedDocuments = [], shownEditors = [], states = [], commands = [], requests = [], dirty = new Set();
  let queryHook, readHook, validateHook, openHook, writeHook, queued = 0;
  const locationWrites = [];
  const features = { projectId: project.id, revision: 1, activeId: 'feature-1', storage: { status: 'saved' }, features: [{ id: 'feature-1', title: 'Save', paths: ['src/Button.tsx'], entryPath: 'src/Button.tsx', archived: false }] };
  const ref = (path, line = 1, column = 1) => ({ path, line, column, revision: sources.get(path).revision });
  const graph = (anchor = 'src/Button.tsx') => {
    const edges = [
      { id: 'incoming-app', kind: 'render', from: { ...ref('src/App.tsx', 2, 3), label: 'App' }, to: { ...ref('src/Button.tsx', 1, 8), label: 'Button' }, provenance: 'source' },
      { id: 'outgoing-api', kind: 'call', from: { ...ref('src/Button.tsx', 3, 3), label: 'Button' }, to: { ...ref('src/api.ts', 2, 8), label: 'saveProfile' }, provenance: 'source' },
    ].filter(edge => edge.from.path === anchor || edge.to.path === anchor);
    return { schemaVersion: 1, projectId: project.id, anchor: ref(anchor), analyzedAt: new Date().toISOString(),
      manifest: [...sources.values()].map(({ path, revision }) => ({ path, revision })), edges,
      requests: anchor === 'src/Button.tsx' ? [{ id: 'request-source', source: ref(anchor, 3, 3), method: 'POST', url: '/api/profile', urlKind: 'literal', provenance: 'source' }] : [],
      candidates: [], boundaries: [], truncated: false, counts: { indexed: sources.size, analyzed: sources.size } };
  };
  const documentFor = value => {
    const path = relative(project.root, value.fsPath), file = sources.get(path); if (!file) throw new Error('PRIVATE_MISSING_SOURCE');
    return { uri: value, lineCount: file.source.split('\n').length, isDirty: dirty.has(path), getText: () => file.source };
  };
  const vscode = { ViewColumn: { Active: -1, One: 1, Two: 2 }, TextEditorRevealType: { InCenter: 0 }, Uri: { file: uri },
    Range: class { constructor(...values) { this.values = values; } },
    workspace: { isTrusted: true, textDocuments: [], openTextDocument: async value => { openedDocuments.push(value.fsPath); return openHook ? openHook(value) : documentFor(value); } },
    window: { activeTextEditor: { document: { uri: uri(`${project.root}/src/Draft.ts`), isDirty: true }, selection: { start: { line: 1, character: 2 }, end: { line: 2, character: 4 } } },
      visibleTextEditors: [], tabGroups: { all: [{ viewColumn: 1 }, { viewColumn: 2 }] },
      showTextDocument: async (document, options) => { const item = { path: relative(project.root, document.uri.fsPath), options }; shownEditors.push(item); const editor = { document, revealRange(range) { item.revealed = range; } }; vscode.window.activeTextEditor = editor; host.focusGeneration++; return editor; } },
    commands: { executeCommand(...args) { commands.push(args); throw new Error('Relationship discovery must not dispatch native commands'); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Buffer, URL, AbortController, TextDecoder, setTimeout, clearTimeout,
    fetch(...args) { requests.push(args); throw new Error('Relationships must not send AI or runtime requests'); },
    require: name => name === 'vscode' ? vscode : name.includes('safety') ? safety : name.startsWith('node:') ? projectRequire(name) : {},
  });
  const host = Object.create(module.exports.FoundationHost.prototype);
  Object.assign(host, { context: { workspaceState: { get: key => structuredClone(storage.get(key)), update: (key, value) => { locationWrites.push({ key, value: structuredClone(value) }); if (writeHook) return writeHook(key, value); storage.set(key, structuredClone(value)); return Promise.resolve(); } } }, project: structuredClone(project), disposed: false, featureSnapshot: () => features, focusGeneration: 0, generation: 0,
    activeFile: sourceFile('src/Draft.ts'), openFiles: [sourceFile('src/Draft.ts')], focus: { path: 'src/Draft.ts', line: 2, origin: 'source' },
    panel: { viewColumn: 1 }, relationshipSnapshot: null, relationshipOwner: undefined, relationshipTrail: [], relationshipStatus: 'idle', relationshipSnapshotId: null, relationshipNavigationGeneration: 0,
    relationshipMessage: '', relationshipEpoch: 0, relationshipGeneration: 0, relationshipTask: undefined, relationshipLoadKey: '',
    dirtyPaths: () => [...dirty], queueRefresh: () => { queued++; },
    sendState() { states.push(structuredClone(this.relationshipState())); },
    service: { getFiles: mockDisplaySources,
      relationships: async (id, anchor, options) => { queries.push({ id, anchor, options }); return queryHook ? queryHook(id, anchor, options) : graph(anchor); },
      validateRelationships: async (id, value, options) => { validations.push({ id, value, options }); return validateHook ? validateHook(id, value, options) : true; },
      getFile: async (id, path) => { reads.push({ id, path }); return readHook ? readHook(id, path) : structuredClone(sources.get(path)); },
    },
  });
  const h = { host, vscode, storage, locationWrites, setWrite: hook => { writeHook = hook; }, sources, features, graph, queries, reads, validations, openedDocuments, shownEditors, states, commands, requests, dirty, documentFor,
    state: () => structuredClone(host.relationshipState()),
    setQuery: hook => { queryHook = hook; }, setRead: hook => { readHook = hook; }, setValidate: hook => { validateHook = hook; }, setOpen: hook => { openHook = hook; },
    action: (action, extra = {}) => host.relationshipAction({ type: 'featureRelationships', action, projectId: host.project?.id, featureId: features.activeId, featureRevision: features.revision, ...extra }),
    navigate: (extra = {}) => h.action('navigate', { snapshotId: h.state()?.snapshotId, evidenceId: 'outgoing-api', target: 'definition', ...extra }),
    get queued() { return queued; },
  };
  return h;
}

test('relationship loading is bounded to feature ownership, deduplicated, and passive toward editors, drafts, AI and runtime', async () => {
  const h = harness(), gate = deferred(), originalEditor = h.vscode.window.activeTextEditor, originalFocus = structuredClone(h.host.focus);
  h.setQuery(() => gate.promise); const first = h.host.loadRelationships(), second = h.host.loadRelationships();
  assert.equal(h.queries.length, 1); assert.equal(h.state().status, 'loading'); assert.equal(h.state().snapshotId, null); assert.deepEqual(h.state().trail, ['src/Button.tsx']);
  gate.resolve(h.graph()); await Promise.all([first, second]);
  assert.equal(h.state().status, 'ready'); assert.match(h.state().snapshotId, /^[a-f0-9]{24}$/); await h.host.loadRelationships(); assert.equal(h.queries.length, 1);
  assert.equal(h.vscode.window.activeTextEditor, originalEditor); assert.deepEqual(h.host.focus, originalFocus);
  assert.equal(h.openedDocuments.length + h.shownEditors.length + h.commands.length + h.requests.length, 0);
});

test('missing feature, trust, project or usable storage clears relationship state without invoking analysis', async () => {
  for (const mutate of [h => { h.features.activeId = null; }, h => { h.vscode.workspace.isTrusted = false; }, h => { h.host.project = null; }, h => { h.features.storage.status = 'unavailable'; }, h => { h.host.disposed = true; }]) {
    const h = harness(); mutate(h); await h.host.loadRelationships(); assert.equal(h.queries.length, 0); assert.equal(h.state(), null);
  }
  const h = harness(); h.features.features[0].paths = []; delete h.features.features[0].entryPath; await h.host.loadRelationships();
  assert.equal(h.state().status, 'idle'); assert.equal(h.state().snapshotId, null); assert.equal(h.queries.length, 0);
});

test('newer anchor exploration supersedes a pending graph and late service errors cannot replace its result', async () => {
  for (const failOld of [false, true]) {
    const h = harness(), gate = deferred(); h.setQuery((_id, anchor) => anchor === 'src/Button.tsx' ? gate.promise : h.graph(anchor));
    const old = h.host.loadRelationships(); await h.action('focus', { path: 'src/api.ts' }); const fresh = h.state();
    if (failOld) gate.reject(new Error('PRIVATE_STALE_ERROR')); else gate.resolve(h.graph()); await old;
    assert.deepEqual(h.state(), fresh); assert.equal(h.queries[0].options.isCurrent(), false); assert.equal(h.shownEditors.length, 0);
  }
});

test('project/root, feature/revision, source epoch, trust and disposal fence every pending analysis result', async () => {
  for (const mutate of [h => { h.host.project = { ...project, id: 'other' }; }, h => { h.host.project = { ...project, root: '/another-root' }; },
    h => { h.features.activeId = 'other'; }, h => { h.features.revision++; }, h => { h.host.invalidateRelationships(); },
    h => { h.vscode.workspace.isTrusted = false; }, h => { h.host.disposed = true; }, h => { h.host.clearRelationships(); }]) {
    const h = harness(), gate = deferred(); h.setQuery(() => gate.promise); const pending = h.host.loadRelationships();
    mutate(h); assert.equal(h.queries[0].options.isCurrent(), false); gate.resolve(h.graph()); await pending;
    assert.notEqual(h.state()?.status, 'ready'); assert.equal(h.state()?.snapshotId ?? null, null); assert.equal(h.shownEditors.length, 0);
  }
});

test('wrong service ownership and failures become sanitized recoverable states', async () => {
  for (const value of [new Error('PRIVATE_ANALYSIS_PATH'), { ...harness().graph(), projectId: 'other-project' }, { ...harness().graph(), anchor: { path: 'src/Other.ts' } }]) {
    const h = harness(); h.setQuery(() => { if (value instanceof Error) throw value; return value; }); await h.host.loadRelationships();
    assert.equal(h.state().status, 'error'); assert.equal(h.state().snapshot, null); assert.doesNotMatch(JSON.stringify(h.states), /PRIVATE_ANALYSIS_PATH|other-project/);
    h.setQuery(undefined); await h.action('refresh'); assert.equal(h.state().status, 'ready');
  }
});

test('exploration changes only the focused graph trail and never expands feature membership or opens an editor', async () => {
  const h = harness(), original = structuredClone(h.features); await h.host.loadRelationships();
  await h.action('focus', { path: 'src/api.ts' }); await h.action('focus', { path: 'src/Other.ts' });
  assert.deepEqual(h.state().trail, ['src/Button.tsx', 'src/api.ts', 'src/Other.ts']);
  await h.action('back'); assert.equal(h.state().anchorPath, 'src/api.ts'); await h.action('reset'); assert.deepEqual(h.state().trail, ['src/Button.tsx']);
  for (const path of ['../outside.ts', '/absolute.ts', 'src/Unknown.ts']) await assert.rejects(h.action('focus', { path }), /indexed source/);
  assert.deepEqual(h.features, original); assert.equal(h.shownEditors.length + h.openedDocuments.length, 0);
});

test('only workspace messages dispatch relationship actions and foreign identity cannot load or navigate', async () => {
  const h = harness(), message = { type: 'featureRelationships', action: 'focus', projectId: project.id, featureId: 'feature-1', featureRevision: 1, path: 'src/Button.tsx' };
  await h.host.message(message, 'assistant'); assert.equal(h.queries.length, 0); await h.host.message(message, 'workspace'); assert.equal(h.queries.length, 1);
  for (const extra of [{ projectId: 'foreign' }, { featureId: 'other' }, { featureRevision: 0 }]) await assert.rejects(h.action('refresh', extra), /feature changed/);
  assert.equal(h.queries.length, 1);
});

test('explicit source, definition and request evidence open only their host-owned revision-checked coordinates', async () => {
  for (const [extra, path, coordinates] of [
    [{ evidenceId: 'incoming-app', target: 'source' }, 'src/App.tsx', [1, 2, 1, 2]],
    [{ evidenceId: 'outgoing-api', target: 'definition' }, 'src/api.ts', [1, 7, 1, 7]],
    [{ evidenceId: 'request-source', target: 'source' }, 'src/Button.tsx', [2, 2, 2, 2]],
  ]) {
    const h = harness(); await h.host.loadRelationships(); h.dirty.add('src/Draft.ts'); await h.navigate({ ...extra, path: '../FORGED.ts', line: 999, column: 999 });
    assert.equal(h.validations.length, 1); assert.equal(h.shownEditors.length, 1); assert.equal(h.shownEditors[0].path, path);
    assert.deepEqual(h.shownEditors[0].options.selection.values, coordinates); assert.equal(h.shownEditors[0].options.viewColumn, 2);
    assert.equal(h.commands.length + h.requests.length, 0); assert.equal(h.queued, 1);
  }
});

test('forged evidence IDs and obsolete snapshots cannot perform reads or navigation', async () => {
  const h = harness(); await h.host.loadRelationships();
  for (const extra of [{ evidenceId: 'unknown' }, { snapshotId: 'old-snapshot' }, { target: 'unknown' }, { evidenceId: 'request-source', target: 'definition' }])
    await assert.rejects(h.navigate(extra), /evidence|relationships/);
  assert.equal(h.validations.length + h.reads.length + h.openedDocuments.length + h.shownEditors.length, 0);
  const old = h.state().snapshotId; h.host.invalidateRelationships(); await assert.rejects(h.navigate({ snapshotId: old }), /Refresh relationships/);
});

test('manifest or supporting endpoint revision changes retire stale evidence before opening any editor', async () => {
  for (const phase of ['manifest', 'anchor', 'source', 'definition', 'document']) {
    const h = harness(); await h.host.loadRelationships();
    if (phase === 'manifest') h.setValidate(() => false);
    else if (phase === 'document') h.setOpen(value => ({ ...h.documentFor(value), getText: () => 'changed native source buffer' }));
    else h.setRead((_id, path) => ({ ...h.sources.get(path), revision: path === (phase === 'source' ? 'src/App.tsx' : phase === 'definition' ? 'src/api.ts' : 'src/Button.tsx') ? 'changed' : h.sources.get(path).revision }));
    await assert.rejects(h.navigate({ evidenceId: phase === 'source' ? 'incoming-app' : 'outgoing-api' }), /Source evidence changed/);
    assert.equal(h.shownEditors.length, 0); assert.equal(h.state().status, 'stale'); assert.equal(h.state().snapshotId, null);
  }
});

test('dirty supporting or destination source is refused before and after awaited saved reads and native document loading', async () => {
  for (const phase of ['anchor-before', 'source-before', 'definition-before', 'validate', 'read', 'open']) {
    const h = harness(); await h.host.loadRelationships(); const evidenceId = phase === 'source-before' ? 'incoming-app' : 'outgoing-api';
    if (phase.endsWith('-before')) h.dirty.add(phase === 'anchor-before' ? 'src/Button.tsx' : phase === 'source-before' ? 'src/App.tsx' : 'src/api.ts');
    else if (phase === 'validate') h.setValidate(() => { h.dirty.add('src/Button.tsx'); return true; });
    else if (phase === 'read') h.setRead((_id, path) => { h.dirty.add('src/api.ts'); return h.sources.get(path); });
    else h.setOpen(value => ({ ...h.documentFor(value), isDirty: true, getText() { throw new Error('Do not read an unsaved draft'); } }));
    await assert.rejects(h.navigate({ evidenceId }), /saved source/); assert.equal(h.shownEditors.length, 0);
  }
});

test('navigation rechecks project, root, feature, source epoch, trust and disposal after asynchronous validation/read/open', async () => {
  const mutations = [h => { h.host.project = { ...project, id: 'other' }; }, h => { h.host.project = { ...project, root: '/other' }; },
    h => { h.features.activeId = 'other'; }, h => { h.features.revision++; }, h => { h.host.invalidateRelationships(); },
    h => { h.vscode.workspace.isTrusted = false; }, h => { h.host.disposed = true; }];
  for (const phase of ['validate', 'read', 'open']) for (const mutate of mutations) {
    const h = harness(); await h.host.loadRelationships();
    if (phase === 'validate') h.setValidate(() => { mutate(h); return true; });
    else if (phase === 'read') h.setRead((_id, path) => { mutate(h); return h.sources.get(path); });
    else h.setOpen(value => { const document = h.documentFor(value); mutate(h); return document; });
    await assert.rejects(h.navigate(), /relationships changed/); assert.equal(h.shownEditors.length, 0);
  }
});

test('new/deleted consumers, indexed neighbors and ignore rules invalidate graphs, while generated or foreign paths do not', async () => {
  const h = harness(); await h.host.loadRelationships(); const snapshotId = h.state().snapshotId;
  for (const path of ['src/NewConsumer.tsx', 'src/deleted.ts', 'src/Other.ts', '.gitignore', 'src/new.scss', 'src/icon.svg', 'src/schema.json']) {
    const before = h.host.relationshipEpoch; assert.equal(h.host.relationshipSourceChanged(uri(`${project.root}/${path}`)), true);
    assert.equal(h.host.relationshipEpoch, before + 1); assert.equal(h.state().status, 'stale'); assert.equal(h.state().snapshotId, null);
  }
  for (const filename of [`${project.root}/dist/Generated.ts`, `${project.root}/node_modules/package/index.ts`, `${project.root}/.cache/Hidden.ts`, `${project.root}/.private.json`, '/other/src/App.tsx', `${project.root}/unknown.bin`]) {
    const before = h.host.relationshipEpoch; assert.equal(h.host.relationshipSourceChanged(uri(filename)), false); assert.equal(h.host.relationshipEpoch, before);
  }
  await h.action('refresh'); assert.equal(h.state().status, 'ready'); assert.notEqual(h.state().snapshotId, snapshotId);
});

test('newer explicit navigation supersedes an older pending location without late focus theft', async () => {
  const h = harness(), gate = deferred(); await h.host.loadRelationships(); let reads = 0;
  h.setRead((_id, path) => ++reads === 1 ? gate.promise : h.sources.get(path));
  const old = h.navigate().catch(error => error); await tick();
  await h.navigate({ evidenceId: 'incoming-app', target: 'source' }); gate.resolve(h.sources.get('src/Button.tsx')); await old;
  assert.deepEqual(h.shownEditors.map(item => item.path), ['src/App.tsx']);
});

test('native source focus changes while explicit evidence is being read prevent a late editor jump', async () => {
  const h = harness(), gate = deferred(); await h.host.loadRelationships(); let reads = 0; h.setRead((_id, path) => ++reads === 1 ? gate.promise : h.sources.get(path));
  const pending = h.navigate().catch(error => error); await tick(); h.host.focusGeneration++; gate.resolve(h.sources.get('src/Button.tsx')); await pending;
  assert.equal(h.shownEditors.length, 0);
});

test('cold restoration saves only explicit exploration location and rebuilds fresh evidence without changing feature or AI membership', async () => {
  const storage = new Map(), h = harness(storage), originalFeature = structuredClone(h.features);
  await h.host.loadRelationships(); assert.equal(h.locationWrites.length, 0);
  await h.action('focus', { path: 'src/api.ts' }); await tick();
  const key = `foundation.relationshipLocation.${project.id}`;
  assert.deepEqual(storage.get(key), { version: 1, featureId: 'feature-1', anchorPath: 'src/api.ts', trail: ['src/Button.tsx', 'src/api.ts'] });
  assert.equal(h.locationWrites.length, 1); const priorSnapshotId = h.state().snapshotId;
  await h.action('refresh'); await tick(); assert.equal(h.locationWrites.length, 1);
  const restored = harness(storage); restored.sources.set('src/api.ts', sourceFile('src/api.ts', 'export const changedWhileClosed = true;\n'));
  await restored.host.loadRelationships();
  assert.equal(restored.state().anchorPath, 'src/api.ts'); assert.deepEqual(restored.state().trail, ['src/Button.tsx', 'src/api.ts']);
  assert.notEqual(restored.state().snapshotId, priorSnapshotId); assert.equal(restored.state().snapshot.anchor.revision, restored.sources.get('src/api.ts').revision);
  assert.equal(restored.locationWrites.length, 0); assert.deepEqual(h.features, originalFeature); assert.deepEqual(restored.features, originalFeature);
  assert.equal(restored.commands.length + restored.requests.length + restored.openedDocuments.length + restored.shownEditors.length, 0);
  await restored.action('back'); await tick(); assert.deepEqual(storage.get(key).trail, ['src/Button.tsx']);
  await restored.action('focus', { path: 'src/Other.ts' }); await restored.action('reset'); await tick();
  assert.deepEqual(storage.get(key), { version: 1, featureId: 'feature-1', anchorPath: 'src/Button.tsx', trail: ['src/Button.tsx'] });
});

test('foreign feature, project and malformed cold locations fall back to the primary source without reviving evidence', async () => {
  const valid = { version: 1, featureId: 'feature-1', anchorPath: 'src/api.ts', trail: ['src/Button.tsx', 'src/api.ts'] };
  for (const invalid of [
    { ...valid, version: 2 }, { ...valid, featureId: 'foreign-feature' }, { ...valid, anchorPath: '../escape.ts', trail: ['../escape.ts'] },
    { ...valid, anchorPath: '/absolute.ts', trail: ['/absolute.ts'] }, { ...valid, anchorPath: 'src/Deleted.ts', trail: ['src/Deleted.ts'] },
    { ...valid, trail: [] }, { ...valid, trail: ['src/Button.tsx'] }, { ...valid, trail: ['src/Missing.ts', 'src/api.ts'] },
    { ...valid, trail: Array(13).fill('src/api.ts') }, { ...valid, trail: [null, 'src/api.ts'] }, { ...valid, trail: 'src/api.ts' },
  ]) {
    const storage = new Map([[`foundation.relationshipLocation.${project.id}`, invalid]]), h = harness(storage);
    await h.host.loadRelationships(); assert.equal(h.state().anchorPath, 'src/Button.tsx'); assert.deepEqual(h.state().trail, ['src/Button.tsx']);
    assert.equal(h.queries.length, 1); assert.equal(h.locationWrites.length, 0); assert.deepEqual(storage.get(`foundation.relationshipLocation.${project.id}`), invalid);
  }
  const foreign = harness(new Map([['foundation.relationshipLocation.other-project', valid]]));
  await foreign.host.loadRelationships(); assert.equal(foreign.state().anchorPath, 'src/Button.tsx');
});

test('obsolete queued location writes are ignored and storage failures do not disable current source evidence', async () => {
  const h = harness(); await h.host.loadRelationships();
  const first = h.action('focus', { path: 'src/api.ts' }), second = h.action('focus', { path: 'src/Other.ts' });
  await Promise.all([first, second]); await tick();
  assert.equal(h.locationWrites.length, 1); assert.equal(h.locationWrites[0].value.anchorPath, 'src/Other.ts');
  const failure = harness(); failure.setWrite(() => { throw new Error('PRIVATE_STORAGE_DETAIL'); });
  await failure.action('focus', { path: 'src/api.ts' }); await tick();
  assert.equal(failure.state().status, 'ready'); assert.ok(failure.state().snapshotId);
  assert.match(failure.state().message, /could not be saved for restart/); assert.doesNotMatch(JSON.stringify(failure.states), /PRIVATE_STORAGE_DETAIL/);
  const pending = harness(), gate = deferred(); pending.setWrite(() => gate.promise);
  await pending.action('focus', { path: 'src/api.ts' });
  pending.features.activeId = 'feature-2'; pending.features.features.push({ id: 'feature-2', title: 'Other', paths: ['src/Other.ts'], entryPath: 'src/Other.ts', archived: false }); pending.features.revision++;
  await pending.host.loadRelationships(); const fresh = pending.state(); gate.reject(new Error('OLD_OWNER_STORAGE_ERROR')); await tick();
  assert.deepEqual(pending.state(), fresh); assert.doesNotMatch(JSON.stringify(pending.states), /OLD_OWNER_STORAGE_ERROR|could not be saved for restart/);
});
