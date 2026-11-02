import { mockDisplaySources } from './helpers/display-source-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.FOUNDATION_FOCUS_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const requireFromProject = createRequire(join(root, 'package.json'));
const ts = requireFromProject('typescript');
const projectDecisionsStoreModule = await import(join(root, 'desktop/extension/src/project-decisions-store.mjs'));
const projectDecisionsModule = await import(join(root, 'server/project/project-decisions.mjs'));
const featureStoreModule = await import(join(root, 'desktop/extension/src/feature-store.mjs'));
const taskContextModule = await import(join(root, 'server/project/assistant.mjs'));
const safety = await import(join(root, 'desktop/extension/src/safety.mjs'));
const { createStartupDiagnostics } = await import(join(root, 'desktop/extension/src/startup-diagnostics.mjs'));
const { createConversationStore } = await import(join(root, 'desktop/extension/src/conversation-store.mjs'));
const hostPath = process.env.FOUNDATION_FOCUS_TEST_SOURCE || join(root, 'desktop/extension/src/extension.ts');
const visualVerificationModule = await import(join(root, 'desktop/extension/src/visual-verification-store.mjs'));
const runtimeWorkspaceModule = await import(join(root, 'desktop/extension/src/runtime-workspace-store.mjs'));
const runtimeReplayModule = await import(join(root, 'desktop/extension/src/runtime-replay-store.mjs'));
const runtimeMatrixModule = await import(join(root, 'desktop/extension/src/runtime-matrix-store.mjs'));
const runtimeStateSuiteModule = await import(join(root, 'desktop/extension/src/runtime-state-suite-store.mjs'));
const compiled = ts.transpileModule(`${readFileSync(hostPath, 'utf8')}\nexport { FoundationHost };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const uri = path => ({ scheme: 'file', fsPath: path, toString: () => `file://${path}` });
const project = { id: 'orbit', root: '/fixtures/orbit', name: 'Orbit', files: [
  { path: 'src/App.tsx' }, { path: 'src/Button.tsx' },
] };
const file = (path, revision = 'r1') => ({ path, revision, source: 'line 1\nline 2\nline 3',
  analysis: { imports: [], consumers: [], symbols: [], requests: [] } });
const selection = { path: 'src/Button.tsx', label: 'Save', tag: 'button',
  rect: { x: 16, y: 20, width: 128.5, height: 32 }, styles: { color: 'black' } };
const event = (intent = 'select', overrides = {}) => ({ type: 'designObserved', event: 'selection',
  session: 'preview-1', intent, selection, ...overrides });
function editor(path = 'src/App.tsx', start = 1, end = 2, viewColumn = 2) {
  return { document: { uri: uri(`${project.root}/${path}`), lineCount: 3, isDirty: true },
    viewColumn, selection: { start: { line: start }, end: { line: end } }, revealRange() {} };
}
function harness({ controlledClock = false } = {}) {
  const timers = new Map(); let clock = 0, timerId = 0;
  const advance = milliseconds => { clock += milliseconds; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback(); } };
  const messages = [], updates = [], opens = [], persisted = new Map();
  const vscode = {
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
    TextEditorRevealType: { InCenter: 0 },
    Uri: { file: uri, joinPath: (base, ...parts) => [base, ...parts].join('/') },
    Range: class { constructor(...values) { this.values = values; } },
    commands: { executeCommand: async () => { throw new Error('No implicit command or provider dispatch permitted.'); } },
    workspace: {
      isTrusted: true, textDocuments: [], workspaceFolders: [{ uri: uri(project.root) }],
      getWorkspaceFolder: value => value.fsPath.startsWith(`${project.root}/`) ? { uri: uri(project.root) } : undefined,
      openTextDocument: async value => ({ uri: value, lineCount: 3, isDirty: true }),
    },
    window: {
      activeTextEditor: undefined, visibleTextEditors: [], tabGroups: { all: [{ viewColumn: 1 }] },
      showTextDocument: async (document, options) => { opens.push({ document, options }); return { document, revealRange() {} }; },
      createWebviewPanel: (_type, _label, options) => ({ viewColumn: (options.viewColumn ?? options) === -1 ? 1 : (options.viewColumn ?? options),
        webview: { asWebviewUri: path => path, cspSource: 'safe-resource:', postMessage: message => messages.push(structuredClone(message)), onDidReceiveMessage() {} },
        reveal(column) { this.revealed = column; }, onDidDispose() {},
      }),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Buffer, AbortController, structuredClone, TextDecoder,
    setTimeout: controlledClock ? (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; } : setTimeout,
    clearTimeout: controlledClock ? id => timers.delete(id) : clearTimeout,
    fetch() { throw new Error('No provider request during workspace selection.'); },
    require: name => name === 'vscode' ? vscode : name.includes('project-decisions-store') ? projectDecisionsStoreModule : name.includes('project-decisions.mjs') ? projectDecisionsModule : name.includes('visual-verification-store') ? visualVerificationModule : name.includes('runtime-workspace-store') ? runtimeWorkspaceModule : name.includes('runtime-state-suite-store') ? runtimeStateSuiteModule : name.includes('runtime-matrix-store') ? runtimeMatrixModule : name.includes('runtime-replay-store') ? runtimeReplayModule : name.includes('feature-store') ? featureStoreModule : name.includes('assistant.mjs') ? taskContextModule : name.includes('safety') ? safety : name.includes('conversation-store') ? {createConversationStore} : name.startsWith('node:') ? requireFromProject(name) : {},
  });
  const host = Object.create(module.exports.FoundationHost.prototype);
  Object.assign(host, {
    // These fixtures exercise native focus/runtime ownership without an issue journal.
    reproducibleIssuesSnapshot: () => null, refreshReproducibleIssues: async () => {},
    context: { extensionUri: 'extension', subscriptions: [], workspaceState: {
      get: key => persisted.get(key), update: async (key, value) => { persisted.set(key, structuredClone(value)); updates.push({ key, value }); },
    } },
    project: structuredClone(project), activeFile: file('src/App.tsx'), openFiles: [file('src/App.tsx')],
    focus: { path: 'src/App.tsx', line: 2, endLine: 3, origin: 'source', revision: 'r1' },
    diagnostics: createStartupDiagnostics(() => {}),
    focusGeneration: 0, generation: 0, designGeneration: 0, askGeneration: 0, disposed: false,
    nonce: 'fixture', status: {}, savedChanges: new Map(), lastDocument: uri(`${project.root}/src/App.tsx`),
    service: { getFiles: mockDisplaySources, getFile: async (_id, path) => file(path), snapshot: async () => structuredClone(project), open: async () => structuredClone(project) },
    assistant: { status: () => ({ configured: false }) },
    design: { session: 'preview-1', status: 'ready', mappings: ['src/Button.tsx'], files: [file('src/App.tsx'), file('src/Button.tsx')], selection: null },
    proposals: () => ({ current: () => null, assess: async () => {} }),
    dirtyPaths: () => [], queueRefresh() { this.refreshQueued = true; }, updateTree() {}, cancelQuestion() {},
    panel: { viewColumn: 1, webview: { postMessage: message => messages.push(structuredClone(message)) } },
  });
  return { host, vscode, messages, updates, opens, persisted, timers, advance };
}

test('explicit preview selection connects saved source without opening, editing, or sending context', async () => {
  const h = harness();
  await h.host.designObserved(event());
  assert.equal(h.host.activeFile.path, selection.path);
  assert.deepEqual(structuredClone(h.host.focus), { path: selection.path, label: 'Save', origin: 'preview', revision: 'r1', session: 'preview-1' });
  assert.equal(h.host.openFiles[0].path, selection.path);
  assert.equal(h.host.design.selection.rect.width, 128.5, 'measured geometry is not snapped to the workbench grid');
  assert.equal(h.opens.length, 0);
  assert.ok(h.messages.every(message => message.type === 'state'));
  assert.equal(h.messages.at(-1).focus.stale, false);
  const stored = h.updates.at(-1).value;
  assert.equal(stored.path, selection.path);
  assert.equal(stored.session, undefined);
  assert.equal(stored.origin, undefined);
  assert.equal(stored.rect, undefined);
});

test('measurement updates cannot take selection back from a native source editor', async () => {
  const h = harness();
  await h.host.designObserved(event());
  const sourceEditor = editor();
  h.vscode.window.activeTextEditor = sourceEditor;
  h.host.followEditor(sourceEditor);
  await h.host.refresh();
  assert.equal(h.host.activeFile.path, 'src/App.tsx');
  assert.equal(h.host.focus.origin, 'source');
  await h.host.designObserved(event('measure'));
  assert.equal(h.host.activeFile.path, 'src/App.tsx');
  assert.equal(h.host.focus.origin, 'source');
  h.vscode.window.activeTextEditor = undefined;
  h.host.sendState();
  assert.deepEqual(h.messages.at(-1).selection, { startLine: 2, endLine: 3 }, 'webview focus retains native caret');
});

test('obsolete sessions and unvalidated mappings cannot change workspace focus', async () => {
  const h = harness();
  await h.host.designObserved(event('select', { session: 'obsolete' }));
  await h.host.designObserved(event('select', { selection: { ...selection, path: '../escape.tsx' } }));
  await h.host.designObserved(event('select', { selection: { ...selection, path: 'src/Unknown.tsx' } }));
  assert.equal(h.host.focus.path, 'src/App.tsx');
  assert.equal(h.messages.length, 0);
  assert.equal(h.updates.length, 0);
});

test('a delayed preview source read cannot override a newer native selection or project', async () => {
  const h = harness();
  let finish;
  h.host.service.getFile = () => new Promise(resolve => { finish = resolve; });
  const pending = h.host.designObserved(event());
  const sourceEditor = editor();
  h.vscode.window.activeTextEditor = sourceEditor;
  h.host.followEditor(sourceEditor);
  finish(file(selection.path));
  await pending;
  assert.equal(h.host.focus.origin, 'source');
  assert.equal(h.host.activeFile.path, 'src/App.tsx');

  const other = h.host.designObserved(event());
  h.host.project = { ...project, id: 'another', root: '/another' };
  finish(file(selection.path));
  await other;
  assert.equal(h.host.activeFile.path, 'src/App.tsx');
});

test('stale preview identity retains its observed revision while current saved source stays available', async () => {
  const h = harness();
  h.host.service.getFile = async (_id, path) => file(path, 'r2');
  await h.host.designObserved(event());
  const state = h.messages.at(-1);
  assert.equal(state.activeFile.revision, 'r2');
  assert.equal(state.focus.revision, 'r1');
  assert.equal(state.focus.stale, true);
});

test('restore validates project membership and reopens only source identity; changed revisions reset saved line', async () => {
  const h = harness();
  h.persisted.set('foundation.focus.orbit', { version: 1, path: '../outside.tsx', line: 99, session: 'old' });
  assert.equal(h.host.restoredFocus(project), null);
  h.persisted.set('foundation.focus.orbit', { version: 1, path: 'src/Missing.tsx', line: 99 });
  assert.equal(h.host.restoredFocus(project), null);
  h.persisted.set('foundation.focus.orbit', { version: 1, path: 'src/Button.tsx', line: 3, endLine: 3, revision: 'old', session: 'old', origin: 'preview' });
  const restored = h.host.restoredFocus(project);
  assert.equal(restored.origin, 'source');
  assert.equal(restored.session, undefined);
  h.host.lastDocument = undefined;
  await h.host.refresh();
  assert.equal(h.host.activeFile.path, 'src/Button.tsx');
  assert.equal(h.host.focus.line, 1);
  assert.equal(h.host.focus.revision, 'r1');
  assert.equal(h.messages.at(-1).focus.stale, false);
});

test('source navigation reuses a neighboring group and preserves unsaved native documents', async () => {
  const h = harness();
  h.vscode.window.visibleTextEditors = [editor()];
  await h.host.navigate('src/Button.tsx', 2);
  assert.equal(h.opens[0].options.viewColumn, 2);
  assert.equal(h.opens[0].document.isDirty, true);
  h.vscode.window.visibleTextEditors = [];
  assert.equal(h.host.sourceColumn(), 2, 'one-group workspace opens source beside it');
  h.host.panel = undefined;
  h.host.show();
  assert.equal(h.host.panel.viewColumn, 1);
  assert.equal(h.host.panel.revealed, undefined, "Creation supplies its native group directly without a second focus-changing reveal");
  assert.ok(h.host.panel.webview.html.indexOf('workspace-model.js') < h.host.panel.webview.html.indexOf('webview.js'));
});


test('inspector geometry survives host recreation, stays per project, and accepts only bounded snapped numeric layout', async () => {
  const h = harness();
  h.host.sendState();
  assert.equal(h.messages.at(-1).workspaceLayout.inspectorWidth, 320);
  await h.host.message({ type: 'workspaceLayout', projectId: 'orbit', width: 357 });
  assert.equal(h.messages.at(-1).workspaceLayout.inspectorWidth, 356);
  assert.deepEqual(h.persisted.get('foundation.layout.orbit'), { version: 1, inspectorWidth: 356 });
  const restarted = harness();
  for (const [key, value] of h.persisted) restarted.persisted.set(key, value);
  restarted.host.sendState();
  assert.equal(restarted.messages.at(-1).workspaceLayout.inspectorWidth, 356, 'a fresh host reads durable workspace storage');
  restarted.host.project = { ...project, id: 'other' };
  restarted.host.sendState();
  assert.equal(restarted.messages.at(-1).workspaceLayout.inspectorWidth, 320);
  await restarted.host.message({ type: 'workspaceLayout', projectId: 'orbit', width: 400 });
  assert.equal(restarted.updates.length, 0, 'an old panel cannot write another project layout');
  for (const width of [NaN, Infinity, '400', null])
    await h.host.message({ type: 'workspaceLayout', projectId: 'orbit', width });
  assert.equal(h.updates.length, 1);
  await h.host.message({ type: 'workspaceLayout', projectId: 'orbit', width: 1000 });
  assert.equal(h.messages.at(-1).workspaceLayout.inspectorWidth, 480);
  await h.host.message({ type: 'workspaceLayout', projectId: 'orbit', width: 100 });
  assert.equal(h.messages.at(-1).workspaceLayout.inspectorWidth, 280);
  h.vscode.workspace.isTrusted = false;
  await h.host.message({ type: 'workspaceLayout', projectId: 'orbit', width: 320 });
  assert.equal(h.updates.length, 3, 'untrusted messages cannot alter stored geometry');
  h.persisted.set('foundation.layout.orbit', { version: 1, inspectorWidth: 'corrupt' });
  assert.equal(h.host.workspaceLayout().inspectorWidth, 320);
});


test('same-line native typing updates ownership without state, storage or saved-source refresh work', () => {
  const h = harness({ controlledClock: true });
  const sourceEditor = editor(); h.vscode.window.activeTextEditor = sourceEditor;
  for (let index = 0; index < 200; index++) h.host.followEditor(sourceEditor);
  assert.equal(h.host.focusGeneration, 200, 'native caret still retires pending runtime selection');
  assert.equal(h.host.generation, 0, 'unchanged source identity never invalidates saved-source work');
  assert.equal(h.host.refreshQueued, undefined);
  assert.equal(h.messages.length, 0); assert.equal(h.updates.length, 0); assert.equal(h.timers.size, 0);
});

test('line and range movement is immediate in host and publishes latest focus once per bounded window', () => {
  const h = harness({ controlledClock: true });
  for (let index = 0; index < 80; index++) {
    const sourceEditor = editor('src/App.tsx', index + 10, index + 11);
    h.vscode.window.activeTextEditor = sourceEditor; h.host.followEditor(sourceEditor);
    assert.equal(h.host.focus.line, index + 11);
  }
  assert.equal(h.host.focusGeneration, 80); assert.equal(h.host.generation, 0);
  assert.equal(h.messages.length, 0); assert.equal(h.updates.length, 0); assert.equal(h.timers.size, 1);
  h.advance(99); assert.equal(h.messages.length, 0); h.advance(1);
  assert.equal(h.messages.length, 1); assert.equal(h.updates.length, 1);
  assert.deepEqual(h.messages[0].selection, { startLine: 90, endLine: 91 });
  assert.equal(h.persisted.get('foundation.focus.orbit').line, 90);
  assert.equal(h.host.restoredFocus(project).line, 90);
  assert.equal(h.host.refreshQueued, undefined);
  h.host.followEditor(editor('src/App.tsx', 99, 99)); h.advance(100);
  assert.equal(h.messages.length, 2, 'continuous movement publishes periodically rather than waiting for idle');
});

test('dirty membership changes publish immediately, but repeated draft bytes and virtual documents do not', () => {
  const h = harness({ controlledClock: true }), dirty = new Set();
  h.host.dirtyPaths = () => [...dirty]; h.host.sendState(); h.messages.length = 0;
  const doc = { uri: uri(`${project.root}/src/App.tsx`), getText() { throw Error('Never read draft bytes to publish state'); } };
  dirty.add('src/App.tsx'); h.host.editorDocumentChanged(doc);
  assert.equal(h.messages.length, 1); assert.deepEqual(h.messages[0].dirtyPaths, ['src/App.tsx']);
  for (let index = 0; index < 200; index++) h.host.editorDocumentChanged(doc);
  assert.equal(h.messages.length, 1); assert.equal(h.timers.size, 0);
  dirty.add('src/Button.tsx'); h.host.editorDocumentChanged({ uri: uri(`${project.root}/src/Button.tsx`) });
  assert.equal(h.messages.length, 2, 'supporting dirty source also disables evidence immediately');
  dirty.clear(); h.host.editorDocumentChanged(doc);
  assert.equal(h.messages.length, 3); assert.deepEqual(h.messages.at(-1).dirtyPaths, []);
  h.host.editorDocumentChanged({ uri: { scheme: 'foundation-snapshot', fsPath: '/before.tsx' } });
  h.host.editorDocumentChanged({ uri: uri('/another/src/App.tsx') });
  assert.equal(h.messages.length, 3); assert.equal(h.host.refreshQueued, undefined);
});

test('same-file caret movement does not abandon active source refresh and refresh persists its latest caret', async () => {
  const h = harness({ controlledClock: true }); let finish;
  h.host.service.snapshot = () => new Promise(resolve => { finish = resolve; });
  const pending = h.host.refresh();
  const sourceEditor = editor('src/App.tsx', 2, 2); h.vscode.window.activeTextEditor = sourceEditor;
  h.host.followEditor(sourceEditor); assert.equal(h.host.generation, 1);
  finish(structuredClone(project)); await pending;
  assert.equal(h.host.focus.line, 3); assert.equal(h.messages.at(-1).selection.startLine, 3);
  assert.equal(h.persisted.get('foundation.focus.orbit').line, 3);
  assert.equal(h.timers.size, 0, 'direct refresh publication retires the presentation timer');
});

test('switching source identity still retires pending refresh and schedules the new saved source', async () => {
  const h = harness({ controlledClock: true }); let finish;
  h.host.service.snapshot = () => new Promise(resolve => { finish = resolve; });
  const pending = h.host.refresh();
  const next = editor('src/Button.tsx', 0, 0); h.vscode.window.activeTextEditor = next;
  h.host.followEditor(next); assert.equal(h.host.generation, 2); assert.equal(h.host.refreshQueued, true);
  finish(structuredClone(project)); await pending;
  assert.equal(h.host.focus.path, 'src/Button.tsx'); assert.equal(h.messages.length, 0);
});

test('direct state publication flushes latest source focus once and cancels redundant presentation', () => {
  const h = harness({ controlledClock: true }); h.host.followEditor(editor('src/App.tsx', 2, 2));
  assert.equal(h.timers.size, 1); h.host.sendState();
  assert.equal(h.updates.length, 1); assert.equal(h.messages.length, 1); assert.equal(h.timers.size, 0);
  h.advance(1000); assert.equal(h.messages.length, 1);
});

test('queued caret presentation cannot publish or persist an old location after project or root changes', () => {
  for (const change of [h => { h.host.project = { ...project, id: 'other' }; }, h => { h.host.project = { ...project, root: '/other' }; }]) {
    for (const direct of [false, true]) {
      const h = harness({ controlledClock: true }); h.host.followEditor(editor('src/App.tsx', 2, 2)); change(h);
      if (direct) h.host.sendState(); h.advance(100);
      assert.equal(h.updates.length, 0, 'old timer never persists focus into the new project');
      assert.equal(h.messages.length, direct ? 1 : 0);
    }
  }
});

test('disposal preserves queued final focus without a late state message or refresh', async () => {
  const h = harness({ controlledClock: true }); h.host.followEditor(editor('src/App.tsx', 2, 2));
  h.host.conversationStores = new Map(); h.host.snapshots = new Map();
  h.host.panel.dispose = () => {}; h.host.settleAssistantReveal = () => {};
  await h.host.dispose(); h.advance(1000);
  assert.equal(h.persisted.get('foundation.focus.orbit').line, 3);
  assert.equal(h.messages.length, 0); assert.equal(h.timers.size, 0);
  h.host.sendState(); h.host.followEditor(editor()); h.host.editorDocumentChanged(editor().document);
  assert.equal(h.messages.length, 0); assert.equal(h.host.refreshQueued, undefined);
});


test('shutdown waits for final coalesced focus persistence and storage failure never blocks cleanup', async () => {
  for (const fails of [false, true]) {
    const h = harness({ controlledClock: true }); let finish;
    h.host.context.workspaceState.update = () => new Promise((resolve, reject) => { finish = () => fails ? reject(Error('storage unavailable')) : resolve(); });
    h.host.followEditor(editor('src/App.tsx', 2, 2));
    h.host.conversationStores = new Map(); h.host.snapshots = new Map();
    h.host.panel.dispose = () => {}; h.host.settleAssistantReveal = () => {};
    let completed = false; const disposal = h.host.dispose().then(() => { completed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.host.disposed, true); assert.equal(h.timers.size, 0);
    assert.equal(completed, false, 'extension deactivation must retain the latest location write');
    finish(); await disposal; assert.equal(completed, true); assert.equal(h.messages.length, 0);
  }
});
