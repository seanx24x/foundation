import { mockDisplaySources } from './helpers/display-source-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.FOUNDATION_RESTORATION_HOST_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const projectRequire = createRequire(join(root, 'package.json')), ts = projectRequire('typescript');
const safety = await import(join(root, 'desktop/extension/src/safety.mjs'));
const compiled = ts.transpileModule(`${readFileSync(join(root, 'desktop/extension/src/extension.ts'), 'utf8')}\nexport { FoundationHost };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const project = { id: 'restore-project', root: '/fixtures/restore-project', files: ['src/Open.ts', 'src/Saved.tsx', 'src/Other.ts'].map(path => ({ path })) };
const sourceFile = (path, source = `export const value = 'saved ${path}';\n`) => ({ path, source, revision: createHash('sha256').update(source).digest('hex').slice(0, 16), analysis: { imports: [], consumers: [], symbols: [], requests: [] } });

function harness() {
  const reads = [], events = [], commands = [], requests = [], sources = new Map(project.files.map(item => [item.path, sourceFile(item.path)]));
  let readHook;
  const feature = { activeId: null, revision: 0, features: [], storage: { status: 'saved' } };
  const conversation = { activeId: null, revision: 0, conversations: [], storage: { status: 'saved' } };
  const vscode = {
    workspace: { isTrusted: true, textDocuments: [], openTextDocument() { throw new Error('Restoration cannot open source editors'); } },
    window: { showTextDocument() { throw new Error('Restoration cannot change editor focus'); } },
    commands: { executeCommand(...args) { commands.push(args); throw new Error('Restoration cannot dispatch native commands'); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Buffer, URL, AbortController, TextDecoder, setTimeout, clearTimeout,
    fetch(...args) { requests.push(args); throw new Error('Restoration cannot send provider requests'); },
    require: name => name === 'vscode' ? vscode : name.includes('safety') ? safety : name.startsWith('node:') ? projectRequire(name) : {},
  });
  const host = Object.create(module.exports.FoundationHost.prototype);
  const view = { visible: true, webview: { postMessage(message) { events.push({ type: 'message', value: structuredClone(message) }); return Promise.resolve(true); } } };
  Object.assign(host, {
    context: { subscriptions: [], workspaceState: { get() {}, update() { throw new Error('Restoring selected context cannot write project or conversation history'); } } },
    project: structuredClone(project), activeFile: sourceFile('src/Open.ts'), openFiles: [sourceFile('src/Open.ts')],
    featureFiles: [], featureUnavailable: [], featureSourceEpoch: 0, disposed: false,
    assistantView: view, assistantOpen: true, assistantReady: true, assistantRestoreGeneration: 0, assistantContextFiles: [], assistantContextEpoch: -1,
    design: { status: 'idle' }, proposals: () => ({ current: () => null }),
    featureSnapshot: () => feature, conversations: () => ({ snapshot: () => conversation }),
    service: { getFiles: mockDisplaySources, getFile: async (id, path) => { reads.push({ id, path }); if (readHook) return readHook(id, path); if (!sources.has(path)) throw new Error('PRIVATE_SOURCE_FAILURE'); return structuredClone(sources.get(path)); } },
    sendState() { events.push({ type: 'state', files: structuredClone(this.currentAssistantContextFiles()) }); },
  });
  return { host, vscode, reads, events, commands, requests, sources, feature, conversation, view,
    setRead(hook) { readHook = hook; },
    restore(paths = ['src/Saved.tsx'], extra = {}) { return host.restoreAssistantContext({ type: 'assistantRestoreContext', requestId: 'restore-1', projectId: host.project?.id, featureId: feature.activeId, conversationId: conversation.activeId, paths, ...extra }); },
    current: () => structuredClone(host.currentAssistantContextFiles()),
    results: () => events.filter(item => item.type === 'message' && item.value.type === 'assistantRestoreContextResult').map(item => item.value),
  };
}

test('restoration loads explicitly selected saved source without draft reads, editor operations, history writes or provider requests', async () => {
  const h = harness(), originalFocus = structuredClone(h.host.activeFile), originalOpen = structuredClone(h.host.openFiles);
  h.vscode.workspace.textDocuments = [{ uri: { scheme: 'file', fsPath: `${project.root}/src/Saved.tsx` }, isDirty: true, getText() { throw new Error('Unsaved buffers must never enter restored context'); } }];
  await h.restore();
  assert.deepEqual(h.reads, [{ id: project.id, path: 'src/Saved.tsx' }]); assert.deepEqual(h.current(), [h.sources.get('src/Saved.tsx')]);
  assert.deepEqual(h.host.activeFile, originalFocus); assert.deepEqual(h.host.openFiles, originalOpen);
  assert.equal(h.commands.length + h.requests.length, 0); assert.equal(h.results().length, 1);
  assert.equal(h.results()[0].requestId, 'restore-1'); assert.equal(h.results()[0].projectId, project.id); assert.deepEqual(h.results()[0].unavailable, []);
  const state = h.events.findIndex(item => item.type === 'state' && item.files.length === 1), result = h.events.findIndex(item => item.type === 'message');
  assert.ok(state >= 0 && result > state, 'loaded state is sent before the restoration completion result');
});

test('only Assistant messages may restore source choices', async () => {
  const h = harness(), message = { type: 'assistantRestoreContext', requestId: 'restore-message', projectId: project.id, featureId: null, conversationId: null, paths: ['src/Saved.tsx'] };
  await h.host.message(message, 'workspace'); assert.equal(h.reads.length, 0); assert.deepEqual(h.current(), []);
  await h.host.message(message, 'assistant'); assert.equal(h.reads.length, 1); assert.equal(h.current()[0].path, 'src/Saved.tsx');
});

test('malformed or foreign restoration descriptors cannot read files or populate context', async () => {
  for (const extra of [{ requestId: '' }, { requestId: 'x'.repeat(300) }, { projectId: 'different-project' }, { featureId: 'other-feature' }, { conversationId: 'other-chat' },
    { paths: ['../outside.ts'] }, { paths: ['/absolute/private.ts'] }, { paths: ['src\\private.ts'] }, { paths: ['src/Saved.tsx', 'src/Saved.tsx'] },
    { paths: Array.from({ length: 33 }, (_, index) => `src/${index}.ts`) }, { paths: [`src/${'a'.repeat(1025)}.ts`] }, { paths: [null] }, { paths: 'src/Saved.tsx' }]) {
    const h = harness(); await h.restore(undefined, extra).catch(() => {}); assert.equal(h.reads.length, 0, JSON.stringify(extra)); assert.deepEqual(h.current(), []); assert.equal(h.results().length, 0);
  }
});

test('restoration requires a current Assistant view and trusted active project before the first read', async () => {
  for (const mutate of [h => { h.vscode.workspace.isTrusted = false; }, h => { h.host.assistantView = undefined; },
    h => { h.host.project = undefined; }, h => { h.host.disposed = true; }]) {
    const h = harness(); mutate(h); await h.restore().catch(() => {});
    assert.equal(h.reads.length, 0); assert.equal(h.results().length, 0); assert.deepEqual(h.current(), []);
  }
});

test('unknown paths are unavailable without reads and missing source errors do not expose private diagnostics', async () => {
  const h = harness(); h.sources.delete('src/Other.ts');
  await h.restore(['src/Invented.ts', 'src/Other.ts', 'src/Saved.tsx']);
  assert.deepEqual(h.reads.map(item => item.path), ['src/Other.ts', 'src/Saved.tsx']);
  assert.deepEqual(h.current().map(item => item.path), ['src/Saved.tsx']);
  assert.deepEqual(h.results()[0].unavailable.map(item => item.path), ['src/Invented.ts', 'src/Other.ts']);
  assert.ok(h.results()[0].unavailable.every(item => typeof item.reason === 'string' && item.reason.length > 0));
  assert.doesNotMatch(JSON.stringify(h.events), /PRIVATE_SOURCE_FAILURE/);
});

test('restored saved source has a 256 KiB UTF-8 budget and over-budget choices remain unavailable', async () => {
  const h = harness(); h.sources.set('src/Saved.tsx', sourceFile('src/Saved.tsx', 'é'.repeat(70000))); h.sources.set('src/Other.ts', sourceFile('src/Other.ts', 'é'.repeat(70000)));
  await h.restore(['src/Saved.tsx', 'src/Other.ts']);
  assert.ok(h.current().reduce((total, file) => total + Buffer.byteLength(file.source, 'utf8'), 0) <= 256 * 1024);
  assert.deepEqual(h.current().map(item => item.path), ['src/Saved.tsx']); assert.deepEqual(h.results()[0].unavailable.map(item => item.path), ['src/Other.ts']);
});

test('a newer restoration request supersedes an older source read without accepting its late cache or result', async () => {
  const h = harness(), gate = deferred();
  h.setRead((_id, path) => path === 'src/Saved.tsx' ? gate.promise : structuredClone(h.sources.get(path)));
  const old = h.restore(['src/Saved.tsx'], { requestId: 'old-request' }); await tick();
  await h.restore(['src/Other.ts'], { requestId: 'new-request' }); gate.resolve(h.sources.get('src/Saved.tsx')); await old;
  assert.deepEqual(h.current().map(item => item.path), ['src/Other.ts']); assert.deepEqual(h.results().map(item => item.requestId), ['new-request']);
});

test('an explicit empty selection invalidates pending reads and clears cached restored context', async () => {
  const h = harness(); await h.restore(); h.events.length = 0;
  const gate = deferred(); h.setRead(() => gate.promise);
  const old = h.restore(['src/Other.ts'], { requestId: 'pending' }); await tick();
  await h.restore([], { requestId: 'empty' }); assert.deepEqual(h.current(), []);
  gate.resolve(h.sources.get('src/Other.ts')); await old;
  assert.deepEqual(h.current(), []); assert.deepEqual(h.results().map(item => item.requestId), ['empty']);
});

test('project, feature, conversation, trust, view, source epoch and disposal changes fence every awaited source read', async () => {
  for (const [name, mutate] of [
    ['project', h => { h.host.project = { ...project, id: 'other-project', root: '/other' }; }],
    ['feature', h => { h.feature.activeId = 'new-feature'; }],
    ['conversation', h => { h.conversation.activeId = 'new-conversation'; }],
    ['trust', h => { h.vscode.workspace.isTrusted = false; }],
    ['view', h => { h.host.assistantView = { ...h.view, webview: { postMessage() { throw new Error('Late source cannot message replacement view'); } } }; }],
    ['source epoch', h => { h.host.featureSourceEpoch++; }],
    ['disposal', h => { h.host.disposed = true; }],
  ]) {
    const h = harness(), gate = deferred(); h.setRead(() => gate.promise);
    const pending = h.restore(['src/Saved.tsx', 'src/Other.ts']); await tick(); assert.equal(h.reads.length, 1, name);
    mutate(h); gate.resolve(h.sources.get('src/Saved.tsx')); await pending;
    assert.equal(h.reads.length, 1, name); assert.deepEqual(h.current(), [], name); assert.equal(h.results().length, 0, name);
  }
});

test('the exposed restored-source cache remains bound to its trusted project, feature, conversation and saved-source epoch', async () => {
  for (const mutate of [h => { h.host.project = { ...project, id: 'other-project' }; }, h => { h.feature.activeId = 'other-feature'; },
    h => { h.conversation.activeId = 'other-chat'; }, h => { h.vscode.workspace.isTrusted = false; }, h => { h.host.featureSourceEpoch++; }, h => { h.host.disposed = true; }]) {
    const h = harness(); await h.restore(); assert.equal(h.current().length, 1); mutate(h); assert.deepEqual(h.current(), []);
    assert.equal(h.reads.length, 1, 'reading cache eligibility cannot initiate another file read');
  }
});

test('relevant saved-source changes reload only the accepted descriptor and missing files retire stale cached bytes', async () => {
  const h = harness(); await h.restore(); const originalRevision = h.current()[0].revision;
  await h.host.refreshAssistantContext(); assert.equal(h.reads.length, 1, 'an unchanged epoch does not repeat saved-source reads');
  const selectedURI = { fsPath: `${project.root}/src/Saved.tsx`, toString: () => `file://${project.root}/src/Saved.tsx` };
  const otherURI = { fsPath: `${project.root}/src/Other.ts`, toString: () => `file://${project.root}/src/Other.ts` };
  assert.equal(Boolean(h.host.relevantSource(otherURI)), false); assert.equal(h.host.featureSourceEpoch, 0);
  h.sources.set('src/Saved.tsx', sourceFile('src/Saved.tsx', 'new saved bytes'));
  assert.equal(h.host.relevantSource(selectedURI), true); assert.deepEqual(h.current(), []);
  await h.host.refreshAssistantContext(); assert.equal(h.current()[0].revision, h.sources.get('src/Saved.tsx').revision); assert.notEqual(h.current()[0].revision, originalRevision);
  assert.deepEqual(h.reads.map(item => item.path), ['src/Saved.tsx', 'src/Saved.tsx']);
  h.sources.delete('src/Saved.tsx'); h.host.relevantSource(selectedURI); await h.host.refreshAssistantContext();
  assert.deepEqual(h.current(), []); assert.deepEqual(h.results().at(-1).unavailable.map(item => item.path), ['src/Saved.tsx']);
  assert.equal(h.requests.length + h.commands.length, 0);
});

test('clearing restored context revokes an outstanding read and future refresh cannot silently restore its old choices', async () => {
  const h = harness(), gate = deferred(); h.setRead(() => gate.promise);
  const pending = h.restore(); await tick(); h.host.clearAssistantContext(); gate.resolve(h.sources.get('src/Saved.tsx')); await pending;
  assert.deepEqual(h.current(), []); assert.equal(h.results().length, 0);
  h.host.featureSourceEpoch++; await h.host.refreshAssistantContext(); assert.equal(h.reads.length, 1); assert.equal(h.host.assistantContextRestore, undefined);
});
