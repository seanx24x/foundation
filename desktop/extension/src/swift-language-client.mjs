import { spawn } from 'node:child_process';
import { access, mkdir, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// Supported compilation-database integration and initialization options:
// https://github.com/swiftlang/sourcekit-lsp/blob/main/README.md
// https://github.com/swiftlang/sourcekit-lsp/blob/main/Documentation/Configuration%20File.md
// No fallback flags or undocumented compiler-argument notifications are injected.
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_HEADER_BYTES = 8192;
const METHODS = new Set(['textDocument/completion', 'textDocument/definition', 'textDocument/hover', 'textDocument/documentSymbol', 'textDocument/diagnostic']);
const inside = (root, path) => { const r = relative(root, path); return r !== '' && !r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r); };
const fault = (code, message) => Object.assign(new Error(message), { name: 'SwiftLanguageError', code });
const cancelled = () => fault('CANCELLED', 'Swift language request cancelled.');
const invoke = (callback, value) => { try { callback?.(value); } catch { /* Observers cannot interrupt transport cleanup. */ } };

/** JSON-RPC Content-Length is a byte count, including non-ASCII Swift text. */
export function encodeLspMessage(message, maximum = MAX_MESSAGE_BYTES) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > maximum) throw fault('MESSAGE_LIMIT', 'Swift language message exceeds the byte limit.');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

export class LspFrameDecoder {
  constructor({ maximum = MAX_MESSAGE_BYTES } = {}) { this.maximum = maximum; this.buffer = Buffer.alloc(0); this.expected = null; }
  push(chunk) {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
    if (this.buffer.length + chunk.length > this.maximum + MAX_HEADER_BYTES) throw fault('MESSAGE_LIMIT', 'Swift language receive buffer exceeds the byte limit.');
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages = [];
    while (true) {
      if (this.expected === null) {
        const end = this.buffer.indexOf('\r\n\r\n');
        if (end < 0) { if (this.buffer.length > MAX_HEADER_BYTES) throw fault('INVALID_FRAME', 'Swift language header exceeds the byte limit.'); break; }
        if (end > MAX_HEADER_BYTES) throw fault('INVALID_FRAME', 'Swift language header exceeds the byte limit.');
        const lengths = this.buffer.subarray(0, end).toString('ascii').split('\r\n').filter(line => /^content-length\s*:/i.test(line));
        if (lengths.length !== 1 || !/^content-length:\s*[0-9]+\s*$/i.test(lengths[0])) throw fault('INVALID_FRAME', 'Swift language message has an invalid Content-Length.');
        this.expected = Number(lengths[0].split(':')[1].trim());
        if (!Number.isSafeInteger(this.expected) || this.expected < 2 || this.expected > this.maximum) throw fault('MESSAGE_LIMIT', 'Swift language message exceeds the byte limit.');
        this.buffer = this.buffer.subarray(end + 4);
      }
      if (this.buffer.length < this.expected) break;
      let message;
      try { message = JSON.parse(this.buffer.subarray(0, this.expected).toString('utf8')); } catch { throw fault('INVALID_MESSAGE', 'Swift language server sent invalid JSON.'); }
      this.buffer = this.buffer.subarray(this.expected); this.expected = null;
      if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') throw fault('INVALID_MESSAGE', 'Swift language server sent an invalid JSON-RPC message.');
      messages.push(message);
    }
    return messages;
  }
}

/** Importing or constructing a client never launches a tool. Connect is explicitly owned by the trusted-workspace controller. */
export function createSwiftLanguageClient(callbacks = {}, dependencies = {}) { return new SwiftLanguageClient(callbacks, dependencies); }

class SwiftLanguageClient {
  constructor(callbacks, dependencies) {
    this.callbacks = callbacks; this.dependencies = dependencies; this.state = 'idle'; this.child = null; this.sessionId = null;
    this.documents = new Map(); this.allowed = new Map(); this.pending = new Map(); this.nextId = 0; this.lastError = null;
    this.requestCount = 0; this.completedRequests = 0; this.cancelledRequests = 0; this.droppedDiagnostics = 0; this.stderrBytes = 0;
    this.stopPromise = null; this.closed = true; this.contextVersion = 0;
  }
  snapshot() {
    return { state: this.state, contextVersion: this.contextVersion, pid: this.child?.pid ?? null, sessionId: this.sessionId,
      documents: [...this.documents.values()].map(({ uri, version }) => ({ uri, version })), pendingRequests: this.pending.size,
      requestCount: this.requestCount, completedRequests: this.completedRequests, cancelledRequests: this.cancelledRequests,
      droppedDiagnostics: this.droppedDiagnostics, lastError: this.lastError };
  }
  publish() { invoke(this.callbacks.onState, this.snapshot()); }
  async connect(configuration) {
    if (!['idle', 'stopped', 'failed'].includes(this.state) || this.child) throw fault('ALREADY_CONNECTED', 'Stop the current Swift connection before connecting again.');
    if (configuration.signal?.aborted) throw cancelled();
    this.state = 'connecting'; this.lastError = null; this.sessionId = randomUUID(); this.stopPromise = null; this.allowed.clear(); this.documents.clear();
    this.requestCount = 0; this.completedRequests = 0; this.cancelledRequests = 0; this.droppedDiagnostics = 0; this.stderrBytes = 0; this.contextVersion = 0; this.publish();
    const sessionId = this.sessionId;
    let removeAbort = () => {};
    try {
      const { workspaceRoot, projectRoot, compilationDatabasePath, sourcePaths, executable } = configuration;
      if (![workspaceRoot, projectRoot, compilationDatabasePath, executable].every(p => typeof p === 'string' && isAbsolute(p))) throw fault('INVALID_CONFIGURATION', 'Swift connection paths must be absolute.');
      const [workspace, project, database, server] = await Promise.all([workspaceRoot, projectRoot, compilationDatabasePath, executable].map(p => realpath(p)));
      if (workspace === project || inside(project, workspace) || dirname(database) !== workspace || basename(database) !== 'compile_commands.json') throw fault('INVALID_CONFIGURATION', 'Swift compilation settings must live in a private workspace outside the project.');
      if (basename(executable) !== 'sourcekit-lsp' || !(await stat(server)).isFile()) throw fault('INVALID_CONFIGURATION', 'A selected Xcode SourceKit-LSP executable is required.');
      await access(server, constants.X_OK);
      const databaseStat = await stat(database);
      if (!databaseStat.isFile() || databaseStat.size > MAX_MESSAGE_BYTES) throw fault('INVALID_CONFIGURATION', 'Swift compilation settings exceed the supported limit.');
      if (!Array.isArray(sourcePaths) || !sourcePaths.length || sourcePaths.length > 4096) throw fault('INVALID_CONFIGURATION', 'Select a bounded Swift target before connecting.');
      for (const source of sourcePaths) {
        if (typeof source !== 'string' || !isAbsolute(source) || !source.endsWith('.swift')) throw fault('INVALID_CONFIGURATION', 'Only selected local Swift files may connect.');
        const canonical = await realpath(source);
        if (!inside(project, canonical) || !(await stat(canonical)).isFile()) throw fault('INVALID_CONFIGURATION', 'Selected Swift sources must stay inside the project.');
        // SourceKit matches the database lexical path; canonicalizing only the URI can silently select fallback settings.
        const uri = pathToFileURL(resolve(source)).href;
        this.allowed.set(resolve(source), uri); this.allowed.set(canonical, uri);
      }
      const privateHome = join(workspace, 'language-home'); const privateTmp = join(workspace, 'language-tmp');
      await Promise.all([mkdir(privateHome, { recursive: true, mode: 0o700 }), mkdir(privateTmp, { recursive: true, mode: 0o700 })]);
      if (configuration.signal?.aborted || this.state !== 'connecting' || this.sessionId !== sessionId) throw cancelled();
      this.workspaceUri = pathToFileURL(workspace).href;
      const spawnProcess = this.dependencies.spawnProcess ?? spawn;
      const child = spawnProcess(server, ['--default-workspace-type', 'compilationDatabase', '--scratch-path', join(workspace, 'language-scratch'), '--generated-files-path', join(workspace, 'language-generated'), '--bypass-workspace-trust'], {
        cwd: workspace, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', HOME: privateHome, XDG_CONFIG_HOME: join(privateHome, 'config'), TMPDIR: privateTmp },
      });
      this.child = child; this.closed = false; this.decoder = new LspFrameDecoder();
      this.closedPromise = new Promise(resolveClosed => { this.resolveClosed = resolveClosed; });
      child.stdout.on('data', chunk => {
        if (this.child !== child || this.closed) return;
        try { for (const message of this.decoder.push(chunk)) this.receive(message); } catch (error) { this.fail(error); }
      });
      child.stderr.on('data', chunk => { this.stderrBytes = Math.min(65536, this.stderrBytes + Buffer.byteLength(chunk)); });
      child.stdin.on('error', error => { if (this.state !== 'stopping') this.fail(error); });
      child.on('error', error => this.fail(error));
      child.on('close', (code, signal) => {
        if (this.child !== child) return;
        const expected = this.state === 'stopping'; this.closed = true; this.child = null; this.resolveClosed?.();
        this.rejectPending(fault('SERVER_EXITED', 'Swift language server stopped.'));
        this.documents.clear(); this.state = expected ? 'stopped' : 'failed';
        if (!expected) { this.lastError = `Swift language server exited${code === null ? '' : ` (${code})`}.`; invoke(this.callbacks.onError, fault('SERVER_EXITED', this.lastError)); }
        this.publish(); invoke(this.callbacks.onExit, { code, signal, expected, sessionId });
      });
      const onAbort = () => { void this.stop(); };
      configuration.signal?.addEventListener('abort', onAbort, { once: true });
      removeAbort = () => configuration.signal?.removeEventListener('abort', onAbort);
      if (configuration.signal?.aborted) { onAbort(); throw cancelled(); }
      const result = await this.sendRequest('initialize', {
        processId: process.pid, clientInfo: { name: 'Foundation', version: '0.47' }, rootUri: this.workspaceUri,
        workspaceFolders: [{ uri: this.workspaceUri, name: 'Foundation selected Swift target' }],
        initializationOptions: { defaultWorkspaceType: 'compilationDatabase', backgroundIndexing: false, cancelTextDocumentRequestsOnEditAndClose: true },
        capabilities: { general: { positionEncodings: ['utf-16'] }, workspace: { workspaceFolders: true, configuration: true, didChangeWatchedFiles: { dynamicRegistration: false } },
          textDocument: { synchronization: { dynamicRegistration: false }, completion: { completionItem: { snippetSupport: true } }, hover: { contentFormat: ['markdown', 'plaintext'] },
            diagnostic: { dynamicRegistration: false }, publishDiagnostics: { versionSupport: true } } },
      }, { signal: configuration.signal, timeoutMs: 60000 });
      if (this.state !== 'connecting' || this.sessionId !== sessionId) throw cancelled();
      this.sendNotification('initialized', {}); this.state = 'connected'; this.publish(); return result;
    } catch (error) {
      if (this.state !== 'stopping' && this.state !== 'stopped') { this.lastError = error.message; invoke(this.callbacks.onError, error); }
      await this.stop(); throw error;
    } finally { removeAbort(); }
  }
  canonicalUri(uri) {
    let url, path;
    try { url = new URL(uri); if (url.protocol !== 'file:' || url.hostname || url.search || url.hash) throw new Error(); path = resolve(fileURLToPath(url)); } catch { throw fault('FOREIGN_DOCUMENT', 'Swift language requests require a selected local file.'); }
    const canonical = this.allowed.get(path);
    if (!canonical) throw fault('FOREIGN_DOCUMENT', 'This Swift file is not part of the selected target.');
    return canonical;
  }
  assertConnected() { if (this.state !== 'connected' || !this.child || this.closed) throw fault('NOT_CONNECTED', 'Connect the selected Swift target first.'); }
  validateDocument(document) {
    if (!Number.isSafeInteger(document.version) || document.version < 0 || typeof document.text !== 'string' || Buffer.byteLength(document.text) > MAX_DOCUMENT_BYTES) throw fault('INVALID_DOCUMENT', 'Swift document version or text exceeds the supported limit.');
    return this.canonicalUri(document.uri);
  }
  openDocument(document) {
    this.assertConnected(); const uri = this.validateDocument(document);
    if (this.documents.has(uri)) throw fault('DOCUMENT_OPEN', 'The Swift document is already open.');
    this.invalidateContext(); this.documents.set(uri, { uri, version: document.version });
    try { this.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'swift', version: document.version, text: document.text } }); }
    catch (error) { this.documents.delete(uri); throw error; }
    this.publish();
  }
  changeDocument(document) {
    this.assertConnected(); const uri = this.validateDocument(document); const previous = this.documents.get(uri);
    if (!previous || document.version <= previous.version) throw fault('STALE_DOCUMENT', 'Swift document versions must increase after an edit.');
    this.invalidateContext(); this.documents.set(uri, { uri, version: document.version });
    try { this.sendNotification('textDocument/didChange', { textDocument: { uri, version: document.version }, contentChanges: [{ text: document.text }] }); }
    catch (error) { this.documents.delete(uri); this.fail(error); throw error; }
    this.publish();
  }
  closeDocument(uri) {
    this.assertConnected(); uri = this.canonicalUri(uri);
    if (!this.documents.has(uri)) return;
    this.invalidateContext(); this.documents.delete(uri); this.sendNotification('textDocument/didClose', { textDocument: { uri } }); this.publish();
  }
  request(method, params, options = {}) {
    try {
      this.assertConnected(); if (!METHODS.has(method)) throw fault('UNSUPPORTED_METHOD', 'This Swift language request is not supported.');
      const uri = this.canonicalUri(params?.textDocument?.uri); const document = this.documents.get(uri);
      if (!document) throw fault('DOCUMENT_CLOSED', 'Open the Swift document before requesting language support.');
      return this.sendRequest(method, { ...params, textDocument: { ...params.textDocument, uri } }, { ...options, document: { ...document }, contextVersion: this.contextVersion });
    } catch (error) { return Promise.reject(error); }
  }
  write(message) {
    if (!this.child || this.closed || !this.child.stdin.writable) throw fault('NOT_CONNECTED', 'Swift language server is not available.');
    // Reject a stalled server before unbounded stream buffering can accumulate.
    const data = encodeLspMessage(message);
    if (this.child.stdin.writableLength + data.length > 2 * MAX_MESSAGE_BYTES) throw fault('MESSAGE_LIMIT', 'Swift language output is backpressured.');
    this.child.stdin.write(data);
  }
  sendNotification(method, params) { this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }); }
  sendRequest(method, params, options = {}) {
    if (options.signal?.aborted) return Promise.reject(cancelled());
    if (this.pending.size >= 64) return Promise.reject(fault('REQUEST_LIMIT', 'Too many Swift language requests are pending.'));
    const id = ++this.nextId; const sessionId = this.sessionId;
    return new Promise((resolveResult, rejectResult) => {
      const timeoutMs = Math.max(1, Math.min(60000, Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000));
      const finish = (error, result) => {
        const pending = this.pending.get(id); if (!pending) return;
        this.pending.delete(id); clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort);
        if (error) rejectResult(error); else { this.completedRequests++; resolveResult(result); } this.publish();
      };
      const cancel = error => { if (!this.pending.has(id)) return; this.cancelledRequests++; try { this.sendNotification('$/cancelRequest', { id }); } catch {} finish(error); };
      const onAbort = () => cancel(cancelled());
      const timer = setTimeout(() => cancel(fault('TIMEOUT', 'Swift language request timed out.')), timeoutMs);
      this.pending.set(id, { method, document: options.document, contextVersion: options.contextVersion, sessionId, finish, cancel }); this.requestCount++;
      options.signal?.addEventListener('abort', onAbort, { once: true });
      try { this.write({ jsonrpc: '2.0', id, method, params }); } catch (error) { finish(error); }
      if (options.signal?.aborted) onAbort(); this.publish();
    });
  }
  receive(message) {
    if (typeof message.method === 'string') {
      if (message.id !== undefined) { this.serverRequest(message); return; }
      if (message.method === 'textDocument/publishDiagnostics') {
        // Even versioned pushes lack the selected target's dependency-context version.
        // Only a pull response captured in the current target context may update Problems.
        this.droppedDiagnostics++;
      }
      return;
    }
    const pending = this.pending.get(message.id); if (!pending) return;
    const current = pending.document && this.documents.get(pending.document.uri);
    if (pending.document && pending.contextVersion !== this.contextVersion) { pending.cancel(fault('STALE_CONTEXT', 'Swift target context changed.')); return; }
    if (pending.sessionId !== this.sessionId || (pending.document && current?.version !== pending.document.version)) { pending.cancel(fault('STALE_DOCUMENT', 'Swift language result belongs to an older document.')); return; }
    if (message.error) { pending.finish(fault(typeof message.error.code === 'number' ? String(message.error.code) : 'SERVER_ERROR', typeof message.error.message === 'string' ? message.error.message.slice(0, 2048) : 'Swift language request failed.')); return; }
    if (!Object.hasOwn(message, 'result')) { pending.finish(fault('INVALID_MESSAGE', 'Swift language response has no result.')); return; }
    if (pending.method === 'textDocument/diagnostic' && pending.document) {
      if (message.result?.kind !== 'full' || !Array.isArray(message.result.items)) { pending.finish(fault('INVALID_DIAGNOSTICS', 'Swift language server did not return a complete diagnostic report.')); return; }
      invoke(this.callbacks.onDiagnostics, { uri: pending.document.uri, version: pending.document.version, diagnostics: message.result.items, source: 'pull', sessionId: this.sessionId, contextVersion: this.contextVersion });
    }
    pending.finish(null, message.result);
  }
  serverRequest(message) {
    let result;
    switch (message.method) {
      case 'workspace/workspaceFolders': result = [{ uri: this.workspaceUri, name: 'Foundation selected Swift target' }]; break;
      case 'workspace/configuration': result = Array.isArray(message.params?.items) ? message.params.items.map(() => null) : []; break;
      case 'client/registerCapability': case 'client/unregisterCapability': case 'window/workDoneProgress/create': result = null; break;
      case 'workspace/diagnostic/refresh': result = null; invoke(this.callbacks.onDiagnosticRefresh); break;
      case 'workspace/applyEdit': result = { applied: false, failureReason: 'Foundation does not apply server-initiated edits.' }; break;
      default: this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Client method is not supported.' } }); return;
    }
    this.write({ jsonrpc: '2.0', id: message.id, result });
  }
  invalidateContext(changedUri) {
    this.assertConnected();
    const uri = changedUri === undefined ? undefined : this.canonicalUri(changedUri);
    this.contextVersion++;
    for (const pending of [...this.pending.values()]) if (pending.document) pending.cancel(fault('STALE_CONTEXT', 'Swift target source context changed.'));
    if (uri) this.sendNotification('workspace/didChangeWatchedFiles', { changes: [{ uri, type: 2 }] });
    this.publish();
  }
  rejectPending(error) { for (const pending of [...this.pending.values()]) pending.finish(error); }
  fail(error) {
    if (this.state === 'stopping' || this.closed) return;
    this.lastError = error?.message ?? 'Swift language connection failed.'; invoke(this.callbacks.onError, error); this.rejectPending(error); void this.stop();
  }
  async waitClosed(milliseconds) {
    if (this.closed) return true;
    let timer; await Promise.race([this.closedPromise, new Promise(resolveWait => { timer = setTimeout(resolveWait, milliseconds); })]); clearTimeout(timer); return this.closed;
  }
  terminate(child, signal) {
    if (this.closed || this.child !== child) return;
    try { if (this.dependencies.killProcessGroup) this.dependencies.killProcessGroup(child.pid, signal); else process.kill(-child.pid, signal); }
    catch { try { child.kill(signal); } catch {} }
  }
  stop() {
    if (this.stopPromise) return this.stopPromise;
    if (!this.child) { this.state = 'stopped'; this.documents.clear(); this.allowed.clear(); this.publish(); return Promise.resolve(); }
    const child = this.child; this.state = 'stopping';
    for (const pending of [...this.pending.values()]) pending.cancel(cancelled());
    this.documents.clear(); this.publish();
    this.stopPromise = (async () => {
      try { await this.sendRequest('shutdown', null, { timeoutMs: this.dependencies.shutdownTimeoutMs ?? 1000 }); } catch {}
      if (!this.closed) { try { this.sendNotification('exit'); } catch {} }
      if (!await this.waitClosed(this.dependencies.exitTimeoutMs ?? 1000)) {
        this.terminate(child, 'SIGTERM');
        if (!await this.waitClosed(this.dependencies.terminateTimeoutMs ?? 500)) { this.terminate(child, 'SIGKILL'); await this.waitClosed(this.dependencies.terminateTimeoutMs ?? 500); }
      }
      this.allowed.clear(); this.rejectPending(cancelled());
      if (!this.closed) { this.state = 'failed'; this.lastError = 'Swift language process did not confirm exit.'; } else this.state = 'stopped';
      this.publish();
    })();
    return this.stopPromise;
  }
}
