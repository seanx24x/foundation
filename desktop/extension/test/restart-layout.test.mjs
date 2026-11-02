import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.FOUNDATION_RESTART_LAYOUT_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const projectRequire = createRequire(join(root, 'package.json'));
const ts = projectRequire('typescript');
const safety = await import(join(root, 'desktop/extension/src/safety.mjs'));
const source = readFileSync(join(root, 'desktop/extension/src/extension.ts'), 'utf8');
const compiled = ts.transpileModule(`${source}\nexport { FoundationHost };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function emitter() {
  const listeners = new Set();
  return { event(callback, _this, subscriptions) { listeners.add(callback); const disposable = { dispose: () => listeners.delete(callback) }; subscriptions?.push(disposable); return disposable; }, fire(value) { for (const callback of [...listeners]) callback(value); }, dispose() { listeners.clear(); } };
}
const uri = path => ({ scheme: 'file', fsPath: path, toString: () => path });

function harness({ persisted = new Map(), openOnStartup = true, groups, activeColumn = 1 } = {}) {
  const serializations = new Map(), creates = [], commands = [], writes = [], states = [], follows = [], phases = [];
  const tabChanges = emitter(), groupChanges = emitter();
  const disposable = () => ({ dispose() {} });
  class TabInputWebview { constructor(viewType) { this.viewType = viewType; } }
  const all = groups || [makeGroup(1)];
  const textEditor = { viewColumn: activeColumn, document: { uri: uri('/fixture/src/App.tsx'), isDirty: true } };
  const ordinal = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
  let onCommand;
  const vscode = {
    EventEmitter: class { constructor() { Object.assign(this, emitter()); } },
    Uri: { file: uri, joinPath: (base, ...parts) => uri(join(typeof base === 'string' ? base : base.fsPath, ...parts)) },
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 },
    StatusBarAlignment: { Left: 1 }, TabInputWebview,
    commands: {
      getCommands: async () => [],
      registerCommand: disposable,
      async executeCommand(id, ...args) {
        commands.push([id, ...args]);
        if (onCommand) await onCommand(id, ...args);
        const index = ordinal.findIndex(name => id === `workbench.action.focus${name}EditorGroup`);
        if (index >= 0 && all[index]) vscode.window.tabGroups.activeTabGroup = all[index];
        if (id === 'workbench.action.focusLastEditorGroup') vscode.window.tabGroups.activeTabGroup = all.at(-1);
      },
    },
    window: {
      activeTextEditor: textEditor, visibleTextEditors: [textEditor],
      tabGroups: { all, activeTabGroup: all.find(group => group.viewColumn === activeColumn) || all[0], onDidChangeTabs: tabChanges.event, onDidChangeTabGroups: groupChanges.event },
      createOutputChannel: () => ({ ...disposable(), appendLine() {} }), createStatusBarItem: () => ({ ...disposable(), show() {} }),
      registerTreeDataProvider: disposable, registerWebviewViewProvider: disposable,
      registerWebviewPanelSerializer: (type, serializer) => { phases.push('serializer'); serializations.set(type, serializer); return disposable(); },
      onDidChangeActiveTextEditor: disposable, onDidChangeTextEditorSelection: disposable,
      createWebviewPanel(type, title, showOptions, options) {
        creates.push({ type, title, showOptions: structuredClone(showOptions), options });
        const column = typeof showOptions === 'number' ? showOptions : showOptions.viewColumn;
        const panel = makePanel(column < 1 ? vscode.window.tabGroups.activeTabGroup.viewColumn : column);
        let group = all.find(item => item.viewColumn === panel.viewColumn);
        if (!group) { group = makeGroup(panel.viewColumn); all.push(group); }
        const tab = addTab(group); panel.closed.event(() => removeTab(tab));
        return panel;
      },
    },
    workspace: {
      isTrusted: true, textDocuments: [textEditor.document], workspaceFolders: [{ uri: uri('/fixture') }],
      getConfiguration: () => ({ inspect: () => ({ globalValue: openOnStartup }), get: () => openOnStartup }),
      registerTextDocumentContentProvider: disposable, onDidChangeTextDocument: disposable,
      onWillSaveTextDocument: disposable, onDidSaveTextDocument: disposable, onDidChangeWorkspaceFolders: disposable,
      onDidGrantWorkspaceTrust: disposable, onDidChangeConfiguration: disposable,
      createFileSystemWatcher: () => ({ ...disposable(), onDidChange: disposable, onDidDelete: disposable }),
    },
  };
  function makeGroup(viewColumn) { return { viewColumn, tabs: [], isActive: viewColumn === activeColumn, activeTab: undefined }; }
  function addTab(group, viewType = 'mainThreadWebview-foundation.workspace') {
    const tab = { group, input: new TabInputWebview(viewType), label: 'Foundation', isActive: false };
    group.tabs.push(tab); return tab;
  }
  function removeTab(tab) {
    const index = tab.group.tabs.indexOf(tab); if (index < 0) return;
    tab.group.tabs.splice(index, 1); tabChanges.fire({ opened: [], changed: [], closed: [tab] });
  }
  function makePanel(viewColumn, active = false) {
    const closed = emitter(), changed = emitter(), received = emitter(), messages = [], reveals = [];
    return { viewColumn, active, visible: true, viewType: 'foundation.workspace', closed, changed, messages, reveals, disposed: false,
      webview: { options: {}, cspSource: 'fixture:', asWebviewUri: value => value, html: '', onDidReceiveMessage: received.event, postMessage: async message => { messages.push(structuredClone(message)); return true; } },
      onDidDispose: closed.event, onDidChangeViewState: changed.event,
      reveal(column, preserveFocus) { reveals.push({ column, preserveFocus }); },
      dispose() { if (!this.disposed) { this.disposed = true; closed.fire(); } },
    };
  }
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Buffer, URL, AbortController, TextDecoder, setTimeout, clearTimeout,
    fetch() { throw new Error('Layout restoration must not call a provider.'); },
    require: name => {
      if (name === 'vscode') return vscode;
      if (name.includes('code-suggestion-controller')) return { CodeSuggestionController: class { stop() {} interrupt() {} dispose() {} } };
      if (name.includes('inline-edit-controller')) return { InlineEditController: class { dismiss() {} dispose() {} } };
      if (name.includes('swift-language-controller')) return { SwiftLanguageController: class { onDidChangeState() { return { dispose() {} }; } stop() {} inspect() { return { phase: 'disconnected' }; } dispose() {} } };
      if (name.includes('xcode-project-controller')) return { XcodeProjectController: class { open() {} inspect() { return { phase: 'idle' }; } dispose() {} } };
      if (name.includes('platform-setup-controller')) return { PlatformSetupController: class { open() {} inspect() { return { phase: 'idle' }; } dispose() {} } };
      if (name.includes('safety')) return safety;
      if (name.includes('startup-diagnostics')) return { createStartupDiagnostics: () => ({}) };
      if (name.includes('workspace.mjs')) return { createProjectService: () => ({}) };
      if (name.startsWith('node:')) return projectRequire(name);
      return {};
    },
  });
  const context = { extensionPath: '/fixture-extension', extensionUri: uri('/fixture-extension'), subscriptions: [],
    workspaceState: { get: key => persisted.get(key), update: async (key, value) => { persisted.set(key, structuredClone(value)); writes.push({ key, value: structuredClone(value) }); } } };
  const host = new module.exports.FoundationHost(context);
  host.configureService = async () => { phases.push('configure'); };
  host.refresh = async () => { phases.push('refresh'); };
  host.followEditor = (editor, refresh) => follows.push({ editor, refresh });
  host.sendState = () => states.push({ mode: host.mode });
  host.webviewHtml = () => '<html>Foundation fixture</html>';
  return { host, vscode, serializations, creates, commands, writes, states, follows, phases, context, persisted, textEditor, makePanel, makeGroup, addTab, removeTab, setCommand: callback => { onCommand = callback; }, restore: (panel, state) => serializations.get('foundation.workspace').deserializeWebviewPanel(panel, state) };
}

test('workspace serializer registers synchronously before asynchronous startup work', () => {
  const h = harness();
  assert.ok(h.serializations.has('foundation.workspace'));
  assert.deepEqual(h.phases, ['serializer']); assert.equal(h.creates.length, 0);
});

test('deserialization adopts the existing panel, mode and column without revealing or editing source', async () => {
  const h = harness(), panel = h.makePanel(3, false);
  await h.restore(panel, { mode: 'Refine', question: 'retained locally' });
  assert.equal(h.host.panel, panel); assert.equal(h.host.mode, 'Refine');
  assert.equal(panel.viewColumn, 3); assert.equal(panel.active, false);
  assert.match(panel.webview.html, /Foundation fixture/);
  assert.equal(h.creates.length + panel.reveals.length + h.commands.length, 0);
  assert.equal(h.vscode.window.activeTextEditor, h.textEditor); assert.equal(h.textEditor.document.isDirty, true);
  await h.host.start();
  assert.equal(h.host.mode, 'Refine'); assert.equal(h.creates.length + panel.reveals.length, 0);
});

test('lazy restored workspace tabs suppress startup creation before deserialization', async () => {
  for (const viewType of ['mainThreadWebview-foundation.workspace', 'foundation.workspace']) {
    const h = harness(); h.addTab(h.vscode.window.tabGroups.all[0], viewType);
    await h.host.start();
    assert.equal(h.creates.length + h.commands.length, 0, viewType);
    const panel = h.makePanel(1); await h.restore(panel, { mode: 'Review' });
    assert.equal(h.host.mode, 'Review'); assert.equal(panel.reveals.length, 0);
  }
});

test('disabled automatic startup still restores an existing workspace', async () => {
  const h = harness({ openOnStartup: false });
  await h.host.start(); assert.equal(h.creates.length, 0);
  const panel = h.makePanel(2); await h.restore(panel, { mode: 'Review' });
  assert.equal(h.host.panel, panel); assert.equal(h.host.mode, 'Review'); assert.equal(panel.reveals.length, 0);
});

test('fresh startup creates in the first group with preserveFocus from its initial create call', async () => {
  const h = harness({ activeColumn: 2 });
  h.vscode.window.tabGroups.all.push(h.makeGroup(2));
  h.vscode.window.tabGroups.activeTabGroup = h.vscode.window.tabGroups.all[1];
  await h.host.start();
  assert.equal(h.creates.length, 1);
  assert.deepEqual(h.creates[0].showOptions, { viewColumn: 1, preserveFocus: true });
  assert.equal(h.vscode.window.activeTextEditor, h.textEditor);
});

test('unknown persisted mode falls back to Understand without opening Assistant', async () => {
  for (const state of [undefined, null, { mode: 'Assistant' }, { mode: 'Build' }, { mode: 'unknown' }]) {
    const h = harness(), panel = h.makePanel(1); await h.restore(panel, state);
    assert.equal(h.host.mode, 'Understand'); assert.equal(h.commands.length + h.creates.length, 0);
  }
});

test('explicit lazy show targets the existing group and current tab index; requested mode wins restoration', async () => {
  const h = harness(), group = h.makeGroup(2); h.vscode.window.tabGroups.all.push(group);
  group.tabs.push({ group, input: {}, label: 'App.tsx' }); h.addTab(group);
  await h.host.show('Review'); await tick();
  assert.equal(h.creates.length, 0);
  assert.deepEqual(h.commands, [['workbench.action.focusSecondEditorGroup'], ['workbench.action.openEditorAtIndex', 1]]);
  const panel = h.makePanel(2, true); await h.restore(panel, { mode: 'Refine' });
  assert.equal(h.host.mode, 'Review'); assert.equal(h.host.panel, panel);
});

test('closing a lazy tab during the group-focus await cancels reveal without recreating it', async () => {
  const h = harness(), group = h.makeGroup(2); h.vscode.window.tabGroups.all.push(group);
  const tab = h.addTab(group), entered = deferred(), blocked = deferred();
  h.setCommand(async id => { if (id === 'workbench.action.focusSecondEditorGroup') { entered.resolve(); await blocked.promise; } });
  const work = h.host.show('Refine'); await entered.promise;
  h.removeTab(tab); blocked.resolve(); await work; await tick();
  assert.equal(h.creates.length, 0);
  assert.equal(h.commands.some(([id]) => id === 'workbench.action.openEditorAtIndex'), false);
});

test('the latest explicit mode wins while an existing lazy panel is being opened', async () => {
  const h = harness(), group = h.makeGroup(2); h.vscode.window.tabGroups.all.push(group); h.addTab(group);
  const entered = deferred(), blocked = deferred();
  h.setCommand(async id => { if (id === 'workbench.action.focusSecondEditorGroup') { entered.resolve(); await blocked.promise; } });
  const first = h.host.show('Refine'); await entered.promise;
  const second = h.host.show('Review'); blocked.resolve(); await Promise.all([first, second]); await tick();
  const panel = h.makePanel(2); await h.restore(panel, { mode: 'Understand' });
  assert.equal(h.host.mode, 'Review'); assert.equal(h.creates.length, 0);
});

test('a restored panel arriving during startup is adopted without an automatic reveal or mode reset', async () => {
  const h = harness(), entered = deferred(), configure = deferred();
  h.host.configureService = async () => { entered.resolve(); await configure.promise; };
  const work = h.host.start(); await entered.promise;
  const panel = h.makePanel(2); await h.restore(panel, { mode: 'Review' });
  configure.resolve(); await work;
  assert.equal(h.host.mode, 'Review'); assert.equal(h.host.panel, panel);
  assert.equal(h.creates.length + panel.reveals.length, 0);
});

test('explicit Close remains closed on the next start, while a new explicit request may create a workspace', async () => {
  const persisted = new Map(), initial = harness({ persisted }); await initial.host.start();
  assert.equal(persisted.get('foundation.workspaceOpened'), true);
  initial.host.panel.dispose(); await tick();
  const restarted = harness({ persisted }); await restarted.host.start();
  assert.equal(restarted.creates.length, 0, 'a previously opened workspace is not automatically recreated');
  await restarted.host.show('Review');
  assert.equal(restarted.creates.length, 1); assert.equal(restarted.host.mode, 'Review');
});

test('adopting a restored workspace records the first-visit marker without creating one', async () => {
  const h = harness({ openOnStartup: false }), panel = h.makePanel(3);
  await h.restore(panel, { mode: 'Refine' }); await tick();
  assert.equal(h.persisted.get('foundation.workspaceOpened'), true);
  assert.equal(h.creates.length, 0);
});

test('host shutdown does not write a user-closed preference or recreate a panel', async () => {
  const h = harness(); await h.host.start(); await tick();
  const before = structuredClone([...h.persisted]), count = h.writes.length;
  await h.host.dispose();
  assert.deepEqual([...h.persisted], before); assert.equal(h.writes.length, count);
  assert.equal(h.creates.length, 1); assert.equal(h.host.disposed, true);
});

test('a previously opened workspace waits for lazy native tab restoration even before the tab model arrives', async () => {
  const h = harness({ persisted: new Map([['foundation.workspaceOpened', true]]) });
  await h.host.start(); assert.equal(h.creates.length, 0);
  h.addTab(h.vscode.window.tabGroups.all[0]); const panel = h.makePanel(1);
  await h.restore(panel, { mode: 'Refine' });
  assert.equal(h.host.mode, 'Refine'); assert.equal(h.creates.length + panel.reveals.length, 0);
});


test('lazy reveal rechecks the exact tab index after awaiting native group focus', async () => {
  const h = harness(), group = h.makeGroup(2); h.vscode.window.tabGroups.all.push(group);
  group.tabs.push({ group, input: {}, label: 'App.tsx' }); h.addTab(group);
  const entered = deferred(), blocked = deferred();
  h.setCommand(async id => { if (id === 'workbench.action.focusSecondEditorGroup') { entered.resolve(); await blocked.promise; } });
  const work = h.host.show('Review'); await entered.promise;
  group.tabs.unshift({ group, input: {}, label: 'newly-opened.ts' });
  blocked.resolve(); await work; await tick();
  assert.deepEqual(h.commands.at(-1), ['workbench.action.openEditorAtIndex', 2]);
  assert.equal(h.creates.length, 0);
});

test('disposal during a lazy reveal prevents further native editor commands', async () => {
  const h = harness(), group = h.makeGroup(2); h.vscode.window.tabGroups.all.push(group); h.addTab(group);
  const entered = deferred(), blocked = deferred();
  h.setCommand(async id => { if (id === 'workbench.action.focusSecondEditorGroup') { entered.resolve(); await blocked.promise; } });
  const work = h.host.show('Refine'); await entered.promise;
  await h.host.dispose(); blocked.resolve(); await work; await tick();
  assert.equal(h.creates.length, 0);
  assert.equal(h.commands.some(([id]) => id === 'workbench.action.openEditorAtIndex'), false);
});


test('closing a requested lazy tab after its reveal command cannot leak its mode into a new panel', async () => {
  const h = harness(), group = h.makeGroup(2); h.vscode.window.tabGroups.all.push(group);
  const tab = h.addTab(group); await h.host.show('Refine'); await tick();
  h.removeTab(tab);
  await h.host.show('Review');
  assert.equal(h.creates.length, 1); assert.equal(h.host.mode, 'Review');
});

test('shutdown during asynchronous startup cannot create a new editor panel afterward', async () => {
  const h = harness(), entered = deferred(), configure = deferred();
  h.host.configureService = async () => { entered.resolve(); await configure.promise; };
  const work = h.host.start(); await entered.promise; await h.host.dispose();
  configure.resolve(); await work;
  assert.equal(h.creates.length, 0); assert.equal(h.host.panel, undefined);
});
