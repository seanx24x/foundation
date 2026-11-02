import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, mkdir, writeFile, chmod, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSwiftLanguageClient, encodeLspMessage, LspFrameDecoder } from '../src/swift-language-client.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, { handler, callbacks = {}, initialize = true, graceful = true } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'foundation-swift-language-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, 'project'), workspaceRoot = join(root, 'private'), executable = join(root, 'sourcekit-lsp');
  await Promise.all([mkdir(projectRoot), mkdir(workspaceRoot)]);
  const source = join(projectRoot, 'Profile.swift');
  await writeFile(source, 'struct Profile {}'); await writeFile(executable, ''); await chmod(executable, 0o700);
  const compilationDatabasePath = join(workspaceRoot, 'compile_commands.json'); await writeFile(compilationDatabasePath, '[]');
  const calls = [], messages = [], kills = [], diagnostics = [], errors = [], exits = []; let child;
  const spawnProcess = (file, args, options) => {
    calls.push({ file, args, options }); child = new EventEmitter(); child.pid = 432101; child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = signal => { kills.push(signal); child.emit('close', null, signal); };
    const decoder = new LspFrameDecoder();
    child.stdin = new Writable({ write(chunk, _encoding, done) { try { for (const message of decoder.push(chunk)) {
      messages.push(message);
      queueMicrotask(() => {
        if (message.method === 'initialize' && initialize) respond(message.id, { capabilities: {} });
        else if (message.method === 'shutdown' && graceful) respond(message.id, null);
        else if (message.method === 'exit' && graceful) child.emit('close', 0, null);
        else handler?.(message, { respond, send, child });
      });
    } done(); } catch (error) { done(error); } } });
    return child;
  };
  const send = message => child.stdout.write(encodeLspMessage(message));
  const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
  const client = createSwiftLanguageClient({ onDiagnostics: e => diagnostics.push(e), onError: e => errors.push(e), onExit: e => exits.push(e), ...callbacks }, {
    spawnProcess, killProcessGroup: (_pid, signal) => child.kill(signal), shutdownTimeoutMs: 10, exitTimeoutMs: 10, terminateTimeoutMs: 10,
  });
  t.after(() => client.stop());
  return { client, calls, messages, kills, diagnostics, errors, exits, send, respond, source, uri: pathToFileURL(source).href,
    config: { workspaceRoot, projectRoot, compilationDatabasePath, sourcePaths: [source], executable }, get child() { return child; } };
}
async function connected(t, options) { const f = await fixture(t, options); await f.client.connect(f.config); f.client.openDocument({ uri: f.uri, version: 1, text: 'struct Profile {}' }); return f; }

test('framing handles UTF-8 split at every byte and coalesced messages', () => {
  const messages = [{ jsonrpc: '2.0', id: 1, result: 'Saving… 👋' }, { jsonrpc: '2.0', method: 'initialized', params: {} }];
  const data = Buffer.concat(messages.map(m => encodeLspMessage(m))); const decoder = new LspFrameDecoder(); const actual = [];
  for (const byte of data) actual.push(...decoder.push(Buffer.from([byte])));
  assert.deepEqual(actual, messages); assert.deepEqual(new LspFrameDecoder().push(data), messages);
});
test('framing rejects malformed headers, duplicate lengths, oversized payloads and non-RPC JSON', () => {
  for (const text of ['Content-Length: -1\r\n\r\n', 'Content-Length: 4\r\nContent-Length: 4\r\n\r\nnull', 'Content-Length: 99\r\n\r\n', 'Content-Length: 2\r\n\r\n{}', 'Content-Length: 2\r\n\r\nxx']) assert.throws(() => new LspFrameDecoder({ maximum: 32 }).push(text));
  assert.throws(() => new LspFrameDecoder().push('A'.repeat(8193)), /header/);
  assert.throws(() => encodeLspMessage({ value: 'large' }, 3), /limit/);
});
test('construction is inert and explicit connect isolates configuration and process environment', async t => {
  const f = await fixture(t); assert.equal(f.calls.length, 0); assert.equal(f.client.snapshot().state, 'idle');
  await f.client.connect(f.config); assert.equal(f.calls.length, 1); const call = f.calls[0];
  assert.equal(call.options.shell, false); assert.equal(call.options.detached, true); assert.equal(call.options.cwd, f.config.workspaceRoot);
  assert.equal(call.options.env.HOME, join(f.config.workspaceRoot, 'language-home')); assert.equal(call.options.env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
  assert.ok(call.args.includes('compilationDatabase')); assert.ok(call.args.includes('--bypass-workspace-trust'));
  const init = f.messages.find(m => m.method === 'initialize'); assert.equal(init.params.rootUri, pathToFileURL(f.config.workspaceRoot).href);
  assert.equal(init.params.initializationOptions.backgroundIndexing, false); assert.deepEqual(init.params.capabilities.general.positionEncodings, ['utf-16']);
  assert.equal(f.client.snapshot().state, 'connected');
});
test('outside-project Swift files and in-project configuration cannot launch a server', async t => {
  const f = await fixture(t); await assert.rejects(f.client.connect({ ...f.config, sourcePaths: [f.config.executable] }), /Swift/); assert.equal(f.calls.length, 0);
  await assert.rejects(f.client.connect({ ...f.config, workspaceRoot: f.config.projectRoot }), /private/); assert.equal(f.calls.length, 0);
});
test('only selected local Swift buffers can be opened, with increasing versions and bounded text', async t => {
  const f = await connected(t); assert.throws(() => f.client.openDocument({ uri: 'https://example.test/a.swift', version: 1, text: '' }), /local/);
  assert.throws(() => f.client.openDocument({ uri: pathToFileURL(join(f.config.projectRoot, 'Other.swift')).href, version: 1, text: '' }), /target/);
  assert.throws(() => f.client.changeDocument({ uri: f.uri, version: 1, text: '' }), /increase/);
  assert.throws(() => f.client.changeDocument({ uri: f.uri, version: 2, text: 'x'.repeat(8 * 1024 * 1024 + 1) }), /limit/);
  f.client.changeDocument({ uri: f.uri, version: 2, text: 'struct Draft {}' });
  assert.deepEqual(f.client.snapshot().documents, [{ uri: f.uri, version: 2 }]);
  assert.equal(f.messages.find(m => m.method === 'textDocument/didChange').params.contentChanges[0].text, 'struct Draft {}');
  assert.ok(!JSON.stringify(f.client.snapshot()).includes('struct Draft'));
});
test('pull diagnostics are tied to requested version and stale result after edit is rejected', async t => {
  const f = await connected(t); const p = f.client.request('textDocument/diagnostic', { textDocument: { uri: f.uri } });
  const request = f.messages.at(-1); const stale = assert.rejects(p, e => e.code === 'STALE_CONTEXT');
  f.client.changeDocument({ uri: f.uri, version: 2, text: 'new draft' }); await stale;
  f.respond(request.id, { kind: 'full', items: [{ message: 'old error' }] }); assert.equal(f.diagnostics.length, 0);
  const current = f.client.request('textDocument/diagnostic', { textDocument: { uri: f.uri } });
  f.respond(f.messages.at(-1).id, { kind: 'full', items: [] }); await current;
  assert.equal(f.diagnostics.length, 1); assert.equal(f.diagnostics[0].version, 2); assert.equal(f.diagnostics[0].source, 'pull');
  assert.equal(f.client.snapshot().cancelledRequests, 1);
});
test('all push diagnostics lack target-context freshness and are discarded', async t => {
  const f = await connected(t); const push = params => f.send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params });
  push({ uri: f.uri, diagnostics: [] }); push({ uri: f.uri, version: 0, diagnostics: [] }); push({ uri: 'file:///etc/unselected.swift', version: 1, diagnostics: [] });
  push({ uri: f.uri, version: 1, diagnostics: [{ message: 'current' }] }); assert.equal(f.diagnostics.length, 0);
  f.client.closeDocument(f.uri); push({ uri: f.uri, version: 1, diagnostics: [] }); assert.equal(f.client.snapshot().droppedDiagnostics, 5);
});
test('cancellation, timeout and document close cancel only owned pending requests', async t => {
  const f = await connected(t); const abort = new AbortController();
  const p = f.client.request('textDocument/completion', { textDocument: { uri: f.uri }, position: { line: 0, character: 0 } }, { signal: abort.signal });
  const cancelled = assert.rejects(p, e => e.code === 'CANCELLED'); abort.abort(); await cancelled;
  await assert.rejects(f.client.request('textDocument/hover', { textDocument: { uri: f.uri } }, { timeoutMs: 5 }), e => e.code === 'TIMEOUT');
  const closing = f.client.request('textDocument/definition', { textDocument: { uri: f.uri } }); const closed = assert.rejects(closing, e => e.code === 'STALE_CONTEXT'); f.client.closeDocument(f.uri); await closed;
  assert.equal(f.client.snapshot().pendingRequests, 0); assert.equal(f.client.snapshot().cancelledRequests, 3);
  assert.equal(f.messages.filter(m => m.method === '$/cancelRequest').length, 3);
});
test('completion and definition preserve actual server results, refusing command execution', async t => {
  const f = await connected(t, { handler: (message, { respond }) => { if (message.method === 'textDocument/completion') respond(message.id, { items: [{ label: 'save()' }] }); if (message.method === 'textDocument/definition') respond(message.id, [{ uri: 'file:///outside.swift', range: {} }]); } });
  assert.deepEqual(await f.client.request('textDocument/completion', { textDocument: { uri: f.uri } }), { items: [{ label: 'save()' }] });
  assert.deepEqual(await f.client.request('textDocument/definition', { textDocument: { uri: f.uri } }), [{ uri: 'file:///outside.swift', range: {} }]); // Host must validate target locations before navigation.
  await assert.rejects(f.client.request('workspace/executeCommand', {}), e => e.code === 'UNSUPPORTED_METHOD');
});
test('server requests cannot edit files or expand workspace scope', async t => {
  const f = await connected(t); f.send({ jsonrpc: '2.0', id: 'edit', method: 'workspace/applyEdit', params: { edit: {} } });
  assert.equal(f.messages.at(-1).result.applied, false);
  f.send({ jsonrpc: '2.0', id: 'folders', method: 'workspace/workspaceFolders' }); assert.deepEqual(f.messages.at(-1).result.map(item => item.uri), [pathToFileURL(f.config.workspaceRoot).href]);
  f.send({ jsonrpc: '2.0', id: 'unknown', method: 'window/showMessageRequest' }); assert.equal(f.messages.at(-1).error.code, -32601);
});
test('stop is idempotent and graceful, reconnect gets a new session without old documents', async t => {
  const f = await connected(t); const first = f.client.snapshot().sessionId;
  await Promise.all([f.client.stop(), f.client.stop()]); assert.equal(f.client.snapshot().state, 'stopped'); assert.equal(f.exits.length, 1); assert.equal(f.exits[0].expected, true); assert.deepEqual(f.kills, []);
  await f.client.connect(f.config); assert.notEqual(f.client.snapshot().sessionId, first); assert.deepEqual(f.client.snapshot().documents, []);
  await assert.rejects(f.client.request('textDocument/hover', { textDocument: { uri: f.uri } }), e => e.code === 'DOCUMENT_CLOSED');
});
test('unresponsive server is terminated through its owned process group', async t => {
  const f = await connected(t, { graceful: false }); await f.client.stop(); assert.deepEqual(f.kills, ['SIGTERM']); assert.equal(f.client.snapshot().state, 'stopped');
});
test('aborting during initialize cleans the child and rejects connection', async t => {
  const f = await fixture(t, { initialize: false }); const abort = new AbortController(); const connection = f.client.connect({ ...f.config, signal: abort.signal });
  const rejection = assert.rejects(connection); while (!f.child) await delay(1); abort.abort(); await rejection;
  assert.equal(f.client.snapshot().state, 'stopped'); assert.equal(f.client.snapshot().pid, null);
});
test('malformed protocol and unexpected process exit reject pending work and clean up', async t => {
  const f = await connected(t); const pending = f.client.request('textDocument/hover', { textDocument: { uri: f.uri } }); const rejection = assert.rejects(pending);
  f.child.stdout.write('Content-Length: 2\r\n\r\nxx'); await rejection; await f.client.stop(); assert.ok(f.errors.length > 0);
  await f.client.connect(f.config); f.client.openDocument({ uri: f.uri, version: 4, text: 'draft' });
  const next = f.client.request('textDocument/hover', { textDocument: { uri: f.uri } }); const exited = assert.rejects(next, e => e.code === 'SERVER_EXITED'); f.child.emit('close', 3, null); await exited;
  assert.equal(f.client.snapshot().state, 'failed'); assert.equal(f.exits.at(-1).expected, false); assert.equal(f.client.snapshot().documents.length, 0);
});
test('already-aborted connect and request never send their corresponding protocol work', async t => {
  const f = await fixture(t); const abort = new AbortController(); abort.abort(); await assert.rejects(f.client.connect({ ...f.config, signal: abort.signal }), e => e.code === 'CANCELLED'); assert.equal(f.calls.length, 0);
  await f.client.connect(f.config); f.client.openDocument({ uri: f.uri, version: 1, text: '' }); const before = f.messages.length;
  await assert.rejects(f.client.request('textDocument/hover', { textDocument: { uri: f.uri } }, { signal: abort.signal }), e => e.code === 'CANCELLED'); assert.equal(f.messages.length, before);
});

test('database lexical URI is preserved while canonical aliases resolve to the same selected buffer', async t => {
  const f = await fixture(t); const aliasRoot = join(f.config.workspaceRoot, 'source-alias');
  await symlink(f.config.projectRoot, aliasRoot); const aliasSource = join(aliasRoot, 'Profile.swift');
  await f.client.connect({ ...f.config, sourcePaths: [aliasSource] });
  f.client.openDocument({ uri: f.uri, version: 1, text: 'struct Profile {}' });
  const selectedUri = pathToFileURL(aliasSource).href;
  assert.equal(f.messages.find(m => m.method === 'textDocument/didOpen').params.textDocument.uri, selectedUri);
  const p = f.client.request('textDocument/diagnostic', { textDocument: { uri: f.uri } });
  assert.equal(f.messages.at(-1).params.textDocument.uri, selectedUri);
  f.respond(f.messages.at(-1).id, { kind: 'full', items: [] }); await p;
  assert.equal(f.diagnostics[0].uri, selectedUri);
});

test('opening, editing and closing another selected Swift buffer retire pending dependency results', async t => {
  const f = await fixture(t); const second = join(f.config.projectRoot, 'Store.swift'); await writeFile(second, 'struct Store {}');
  await f.client.connect({ ...f.config, sourcePaths: [...f.config.sourcePaths, second] });
  f.client.openDocument({ uri: f.uri, version: 1, text: 'struct Profile {}' }); const secondUri = pathToFileURL(second).href;
  for (const action of ['open', 'edit', 'close', 'external']) {
    const request = f.client.request('textDocument/diagnostic', { textDocument: { uri: f.uri } }); const id = f.messages.at(-1).id;
    const stale = assert.rejects(request, error => error.code === 'STALE_CONTEXT'); const version = f.client.snapshot().contextVersion;
    if (action === 'open') f.client.openDocument({ uri: secondUri, version: 1, text: 'struct Store {}' });
    if (action === 'edit') f.client.changeDocument({ uri: secondUri, version: 2, text: 'struct Store { var name = "draft" }' });
    if (action === 'close') f.client.closeDocument(secondUri);
    if (action === 'external') f.client.invalidateContext();
    await stale; assert.equal(f.client.snapshot().contextVersion, version + 1);
    f.respond(id, { kind: 'full', items: [{ message: 'old dependency result' }] });
  }
  assert.equal(f.diagnostics.length, 0); assert.equal(f.client.snapshot().cancelledRequests, 4);
  const fresh = f.client.request('textDocument/diagnostic', { textDocument: { uri: f.uri } });
  f.respond(f.messages.at(-1).id, { kind: 'full', items: [] }); await fresh;
  assert.equal(f.diagnostics[0].contextVersion, f.client.snapshot().contextVersion); assert.equal(f.diagnostics[0].version, 1);
});

test('saved selected dependency notification is scoped, normalized and ordered after cancellation', async t => {
  const f = await connected(t); const result = f.client.request('textDocument/hover', { textDocument: { uri: f.uri } });
  const rejected = assert.rejects(result, error => error.code === 'STALE_CONTEXT'); f.client.invalidateContext(f.uri); await rejected;
  assert.equal(f.messages.at(-2).method, '$/cancelRequest'); assert.equal(f.messages.at(-1).method, 'workspace/didChangeWatchedFiles');
  assert.deepEqual(f.messages.at(-1).params.changes, [{ uri: f.uri, type: 2 }]);
  const version = f.client.snapshot().contextVersion, count = f.messages.length;
  assert.throws(() => f.client.invalidateContext('file:///outside.swift'), error => error.code === 'FOREIGN_DOCUMENT');
  assert.equal(f.client.snapshot().contextVersion, version); assert.equal(f.messages.length, count);
});
test('incomplete diagnostic reports fail instead of implying clean or leaving checking unresolved', async t => {
  const f = await connected(t);
  for (const value of [null, { kind: 'unchanged', resultId: 'old' }, { kind: 'full', items: null }]) {
    const response = f.client.request('textDocument/diagnostic', { textDocument: { uri: f.uri } });
    const rejected = assert.rejects(response, error => error.code === 'INVALID_DIAGNOSTICS'); f.respond(f.messages.at(-1).id, value); await rejected;
  }
  assert.equal(f.diagnostics.length, 0);
});
