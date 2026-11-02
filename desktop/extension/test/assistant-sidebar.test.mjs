import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const requireFromProject = createRequire(join(root, 'package.json'));
const ts = requireFromProject('typescript');
const projectDecisionsStoreModule = await import(join(root, 'desktop/extension/src/project-decisions-store.mjs'));
const projectDecisionsModule = await import(join(root, 'server/project/project-decisions.mjs'));
const featureStoreModule = await import(join(root, 'desktop/extension/src/feature-store.mjs'));
const taskContextModule = await import(join(root, 'server/project/assistant.mjs'));
const { createConversationStore } = await import(join(root, 'desktop/extension/src/conversation-store.mjs'));
const safety = await import(join(root, 'desktop/extension/src/safety.mjs'));
const visualVerificationModule = await import(join(root, 'desktop/extension/src/visual-verification-store.mjs'));
const runtimeWorkspaceModule = await import(join(root, 'desktop/extension/src/runtime-workspace-store.mjs'));
const runtimeReplayModule = await import(join(root, 'desktop/extension/src/runtime-replay-store.mjs'));
const runtimeMatrixModule = await import(join(root, 'desktop/extension/src/runtime-matrix-store.mjs'));
const runtimeStateSuiteModule = await import(join(root, 'desktop/extension/src/runtime-state-suite-store.mjs'));
const compiled = ts.transpileModule(`${readFileSync(join(root, 'desktop/extension/src/extension.ts'), 'utf8')}\nexport { FoundationHost };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const file = { path: 'src/Button.tsx', revision: 'r1', source: 'export const Button = () => null;' };

function harness(t) {
  const commands = new Map(), calls = [], workspaceMessages = [], assistantMessages = [], persisted = new Map();
  let provider, registration, focusGate, deferredNativeReveal = false;
  const createWebview = messages => ({
    options: {}, html: '', cspSource: 'safe-resource:',
    asWebviewUri: uri => uri,
    postMessage(message) { messages.push(structuredClone(message)); return Promise.resolve(true); },
    onDidReceiveMessage(callback) { this.receive = callback; return { dispose() {} }; },
  });
  const newView = () => {
    const visibility = [], disposal = [];
    return {
      visible: true, webview: createWebview(assistantMessages),
      onDidChangeVisibility(callback) { visibility.push(callback); return { dispose() {} }; },
      onDidDispose(callback) { disposal.push(callback); return { dispose() {} }; },
      setVisible(visible) { this.visible = visible; visibility.forEach(callback => callback()); },
      dispose() { disposal.forEach(callback => callback()); },
    };
  };
  const vscode = {
    ViewColumn: { Active: -1, One: 1 },
    Uri: { joinPath: (base, ...parts) => [base, ...parts].join('/') },
    workspace: { isTrusted: true, textDocuments: [] },
    commands: {
      registerCommand(id, callback) { commands.set(id, callback); return { dispose() {} }; },
      async executeCommand(id, ...args) {
        calls.push({ id, args });
        if (commands.has(id)) return commands.get(id)(...args);
        if (id === 'foundation.assistant.focus') {
          if (deferredNativeReveal) return;
          if (focusGate) await focusGate;
          if (!host.assistantView) provider.resolveWebviewView(newView());
          host.assistantView.setVisible(true);
        } else if (id === 'workbench.action.closeAuxiliaryBar') host.assistantView?.setVisible(false);
        else throw new Error(`Unexpected native command: ${id}`);
      },
    },
    window: {
      registerWebviewViewProvider(id, value, options) { provider = value; registration = { id, options }; return { dispose() {} }; },
      createWebviewPanel() {
        let dispose;
        return { viewColumn: 1, webview: createWebview(workspaceMessages), reveal() {},
          onDidDispose(callback) { dispose = callback; return { dispose() {} }; }, dispose() { dispose?.(); } };
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Buffer, AbortController, structuredClone, setTimeout, clearTimeout, TextDecoder,
    require(name) {
      if (name === 'vscode') return vscode;
      if (name.includes('project-decisions-store')) return projectDecisionsStoreModule;
      if (name.includes('project-decisions.mjs')) return projectDecisionsModule;
      if (name.includes('visual-verification-store')) return visualVerificationModule;
      if (name.includes('runtime-workspace-store')) return runtimeWorkspaceModule;
      if (name.includes('runtime-state-suite-store')) return runtimeStateSuiteModule;
      if (name.includes('runtime-matrix-store')) return runtimeMatrixModule;
      if (name.includes('runtime-replay-store')) return runtimeReplayModule;
      if (name.includes('feature-store')) return featureStoreModule;
      if (name.includes('assistant.mjs')) return taskContextModule;
      if (name.includes('conversation-store')) return { createConversationStore };
      if (name.includes('safety')) return safety;
      if (name.startsWith('node:')) return requireFromProject(name);
      return {};
    },
    fetch() { throw new Error('Sidebar visibility must never send a provider request'); },
  });
  const host = Object.create(module.exports.FoundationHost.prototype);
  Object.assign(host, {
    // These fixtures exercise native focus/runtime ownership without an issue journal.
    reproducibleIssuesSnapshot: () => null, refreshReproducibleIssues: async () => {},
    context: { extensionUri: 'extension', subscriptions: [], workspaceState: {
      get: key => persisted.get(key), update: async (key, value) => persisted.set(key, structuredClone(value)),
    } },
    mode: 'Refine', nonce: 'fixture', disposed: false, askGeneration: 0,
    assistantOpen: false, assistantReady: false, assistantVisibilityGeneration: 0,
    project: { id: 'orbit', root: '/fixture/orbit', files: [file] },
    activeFile: file, openFiles: [file], focus: { path: file.path, line: 1, revision: file.revision, origin: 'source' },
    status: {}, savedChanges: new Map(), conversationStores: new Map(), snapshots: new Map(),
    design: { session: 'preview1', html: '<html>preview</html>', files: [file] },
    assistant: { status: () => ({ configured: false }) },
    proposals: () => ({ current: () => null }),
  });
  host.registerCommands();
  host.registerAssistantView();
  t.after(async () => host.dispose());
  return { host, vscode, commands, calls, workspaceMessages, assistantMessages, persisted, newView,
    get registration() { return registration; },
    setFocusGate(promise) { focusGate = promise; },
    deferNativeReveal() { deferredNativeReveal = true; },
    resolve(view) { provider.resolveWebviewView(view); },
    async ready() { host.assistantView.webview.receive({ type: 'ready' }); await tick(); },
  };
}

test('Assistant is a retained native secondary-sidebar webview with dedicated toggle and collapse commands', t => {
  const h = harness(t);
  const manifest = JSON.parse(readFileSync(join(root, 'desktop/extension/package.json')));
  assert.deepEqual(structuredClone(h.registration), { id: 'foundation.assistant', options: { webviewOptions: { retainContextWhenHidden: true } } });
  const container = manifest.contributes.viewsContainers.secondarySidebar.find(item => item.id === 'foundation-assistant');
  assert.ok(container);
  assert.match(container.id, /^[a-zA-Z0-9_-]+$/);
  assert.deepEqual(manifest.contributes.views[container.id], [{ id: 'foundation.assistant', name: 'Assistant', type: 'webview' }]);
  assert.equal(manifest.contributes.configurationDefaults['workbench.sideBar.location'], 'left');
  assert.equal(manifest.contributes.keybindings.find(item => item.mac === 'cmd+alt+a').command, 'foundation.toggleAssistant');
  assert.equal(manifest.contributes.menus['view/title'].some(item => item.when === 'view == foundation.assistant'), false, 'Native Hide/Maximize own container controls; the webview owns New/History');
  assert.ok(manifest.contributes.commands.some(item => item.command === 'foundation.collapseAssistant'), 'Hide remains available in the command palette');
});

test('Source context presents relationships and empty results without duplicating workspace navigation', t => {
  const h = harness(t);
  h.host.tree = { nodes: [], refresh() {} };
  h.host.project.name = 'Orbit';
  h.host.activeFile = { ...file, analysis: {
    symbols: [{ name: 'Button', kind: 'function', line: 1 }], imports: [], consumers: [],
  } };
  h.host.updateTree();
  const nodes = structuredClone(h.host.tree.nodes);
  assert.deepEqual(nodes.map(node => node.label), ['Orbit', 'Project Setup', 'Xcode Project', 'Button.tsx', 'Outline', 'Imports', 'Used by']);
  assert.equal(nodes.find(node => node.label === 'Project Setup').command, 'foundation.projectSetup');
  assert.equal(nodes.find(node => node.label === 'Outline').description, '1 symbol');
  assert.equal(nodes.find(node => node.label === 'Imports').description, 'No imports');
  assert.equal(nodes.find(node => node.label === 'Used by').description, 'No indexed references');
  assert.equal(nodes.some(node => ['foundation.build', 'foundation.understand', 'foundation.refine', 'foundation.review', 'foundation.askAI'].includes(node.command)), false);
  h.host.activeFile.analysis.unsupported = true;
  h.host.updateTree();
  assert.deepEqual(structuredClone(h.host.tree.nodes.map(node => node.label)), ['Orbit', 'Project Setup', 'Xcode Project', 'Button.tsx', 'Source analysis unavailable']);
  assert.match(h.host.tree.nodes.at(-1).tooltip, /still edit this file/);
  h.host.activeFile = null;
  h.host.updateTree();
  assert.equal(h.host.tree.nodes.at(-1).label, 'Select a source file');
  h.vscode.workspace.isTrusted = false;
  h.host.updateTree();
  assert.equal(h.host.tree.nodes.length, 1);
  assert.equal(h.host.tree.nodes[0].command, 'foundation.manageTrust');
  assert.equal(h.host.tree.nodes.some(node => node.path), false, 'Untrusted tree does not show source relationships');
});

test('showing or hydrating Assistant preserves central mode, source selection and native editor focus intent', async t => {
  const h = harness(t);
  h.host.show('Refine');
  const panel = h.host.panel, focus = structuredClone(h.host.focus);
  await h.host.show('Assistant', true);
  await h.ready();
  assert.equal(h.host.panel, panel);
  assert.equal(h.host.mode, 'Refine');
  assert.deepEqual(structuredClone(h.host.focus), focus);
  assert.deepEqual(structuredClone(h.calls.find(call => call.id === 'foundation.assistant.focus').args), [{ preserveFocus: true }]);
  assert.equal(h.assistantMessages.some(message => message.type === 'focusAssistant'), false);
  assert.equal(h.workspaceMessages.some(message => message.type === 'mode' && message.mode === 'Assistant'), false);
  assert.equal(h.assistantMessages.at(-1).mode, 'Assistant');
  assert.match(panel.webview.html, /data-foundation-surface="workspace" data-foundation-assistant="external"/);
  assert.match(h.host.assistantView.webview.html, /data-foundation-surface="assistant"/);
  assert.match(h.host.assistantView.webview.html, /script-src 'nonce-fixture'/);
  assert.deepEqual(structuredClone(h.host.inspect().assistantSurface), { resolved: true, visible: true, open: true });
  assert.equal(h.host.inspect().workspaceMode, 'Refine');
  await h.commands.get('foundation.askAI')();
  assert.equal(h.assistantMessages.filter(message => message.type === 'focusAssistant').length, 1, 'Explicit focus gets a distinct composer-focus request');
});

test('collapse and central workspace disposal leave an active request and its partial history intact', async t => {
  const h = harness(t);
  h.host.show('Refine');
  await h.host.show('Assistant');
  await h.ready();
  const store = h.host.conversations();
  await store.startTurn({ requestId: 'request-sidebar', prompt: 'Explain', intent: 'ask', context: [file], model: 'fixture' });
  store.event('request-sidebar', { type: 'delta', text: 'Partial' });
  const request = { requestId: 'request-sidebar', abort: new AbortController(), terminal: false,
    projectId: 'orbit', conversationId: store.snapshot().activeId, durable: true, store };
  h.host.asking = request;
  await h.commands.get('foundation.toggleAssistant')();
  assert.equal(h.host.assistantView.visible, false);
  assert.equal(request.abort.signal.aborted, false);
  h.host.panel.dispose();
  assert.equal(h.host.panel, undefined);
  assert.equal(h.host.asking, request);
  store.event(request.requestId, { type: 'delta', text: ' answer' });
  h.host.postAI(request.requestId, { type: 'progress' }, request);
  assert.equal(h.workspaceMessages.some(message => message.type === 'ai'), false);
  await h.commands.get('foundation.toggleAssistant')();
  const hydrated = h.assistantMessages.filter(message => message.type === 'state').at(-1);
  assert.equal(hydrated.conversations.conversations[0].turns[0].answer, 'Partial answer');
  assert.equal(hydrated.design.html, undefined, 'Sidebar cannot mount another runtime preview');
  assert.equal(request.abort.signal.aborted, false);
  assert.equal(h.host.panel, undefined, 'Reopening Assistant does not recreate the central editor');
  h.host.show('Refine');
  const reopened = h.workspaceMessages.filter(message => message.type === 'state').at(-1);
  assert.equal(reopened.design.session, 'preview1');
  assert.equal(reopened.design.html, '<html>preview</html>', 'Recreated central workspace receives its existing preview document again');
  assert.equal(h.host.asking, request);
});

test('explicit current view disposal stops safely while stale view callbacks cannot touch a replacement', async t => {
  const h = harness(t);
  await h.host.show('Assistant');
  const old = h.host.assistantView;
  const replacement = h.newView();
  h.resolve(replacement);
  const store = h.host.conversations();
  await store.startTurn({ requestId: 'request-remove', prompt: 'Explain', intent: 'ask', context: [file], model: 'fixture' });
  store.event('request-remove', { type: 'delta', text: 'Retained partial' });
  const request = { requestId: 'request-remove', abort: new AbortController(), terminal: false,
    projectId: 'orbit', conversationId: store.snapshot().activeId, durable: true, store };
  h.host.asking = request;
  old.dispose();
  old.setVisible(false);
  old.webview.receive({ type: 'cancel', requestId: request.requestId });
  assert.equal(h.host.assistantView, replacement);
  assert.equal(request.abort.signal.aborted, false);
  replacement.webview.postMessage = () => { throw new Error('A disposed webview cannot receive messages'); };
  replacement.dispose();
  await store.flush();
  assert.equal(request.abort.signal.aborted, true);
  assert.equal(h.host.assistantView, undefined);
  const turn = store.snapshot().conversations[0].turns[0];
  assert.equal(turn.answer, 'Retained partial');
  assert.equal(turn.state, 'stopped');
});

test('only the current sidebar accepts conversation and ask traffic; workspace and stale panes cannot reroute it', async t => {
  const h = harness(t);
  h.host.show('Refine');
  await h.host.show('Assistant');
  const seen = [];
  h.host.ask = async message => { seen.push(message.requestId); };
  h.host.panel.webview.receive({ type: 'ask', requestId: 'stale-workspace' });
  h.host.panel.webview.receive({ type: 'conversation', projectId: 'orbit', action: 'new' });
  await tick();
  assert.deepEqual(seen, []);
  assert.equal(h.host.conversations().snapshot().conversations.length, 0);
  assert.equal(h.assistantMessages.some(message => message.type === 'ai'), false, 'A stale workspace error cannot fail a sidebar turn');
  h.host.assistantView.webview.receive({ type: 'ask', requestId: 'sidebar' });
  await tick();
  assert.deepEqual(seen, ['sidebar']);
  h.host.assistantView.webview.receive({ type: 'conversation', projectId: 'other', action: 'new' });
  await tick();
  assert.equal(h.host.conversations().snapshot().conversations.length, 0);
  h.vscode.workspace.isTrusted = false;
  h.host.assistantView.webview.receive({ type: 'conversation', projectId: 'orbit', action: 'new' });
  await tick();
  assert.equal(h.host.conversations().snapshot().conversations.length, 0);
});

test('explicit source preparation waits for ready, stays project-bound and never sends to a provider', async t => {
  const h = harness(t);
  h.host.show('Refine');
  await h.host.message({ type: 'action', id: 'foundation.askAI', projectId: 'orbit', contextPath: file.path, intent: 'change', prompt: 'Refine spacing' }, 'workspace');
  assert.equal(h.assistantMessages.some(message => message.type === 'prepareAssistant'), false);
  await h.ready();
  assert.deepEqual(h.assistantMessages.find(message => message.type === 'prepareAssistant'), {
    type: 'prepareAssistant', projectId: 'orbit', contextPath: file.path, intent: 'build', prompt: 'Refine spacing',
  });
  assert.equal(h.host.asking, undefined);
  assert.equal(h.host.conversations().snapshot().conversations.length, 0);
  await assert.rejects(h.host.message({ type: 'action', id: 'foundation.askAI', projectId: 'old-project', contextPath: file.path, intent: 'ask' }, 'workspace'), /context changed/);
  assert.equal(h.host.mode, 'Refine');
});

test('a close during cold native view resolution wins without cancelling history', async t => {
  const h = harness(t);
  let release;
  h.setFocusGate(new Promise(resolve => { release = resolve; }));
  const open = h.host.show('Assistant');
  await tick();
  const close = h.commands.get('foundation.toggleAssistant')();
  release();
  await Promise.all([open, close]);
  assert.equal(h.host.assistantView.visible, false);
  assert.equal(h.host.assistantOpen, false);
  assert.deepEqual(h.calls.map(call => call.id), ['foundation.assistant.focus', 'workbench.action.closeAuxiliaryBar']);
  assert.equal(h.assistantMessages.some(message => message.type === 'focusAssistant'), false);
});

test('void native focus completion cannot reopen or focus a late-resolving view after collapse', async t => {
  const h = harness(t);
  h.deferNativeReveal();
  const prepare = h.host.message({ type: 'action', id: 'foundation.askAI', projectId: 'orbit', contextPath: file.path, intent: 'change', prompt: 'Cancelled preparation' }, 'workspace');
  await tick();
  assert.equal(h.host.assistantView, undefined, 'The generated native focus command returned before resolving the view');
  assert.equal(h.host.assistantOpen, true, 'Pending reveal remains open until actual visibility is known');
  const close = h.commands.get('foundation.toggleAssistant')();
  const lateView = h.newView();
  h.resolve(lateView);
  await Promise.all([prepare, close]);
  await h.ready();
  assert.equal(lateView.visible, false);
  assert.equal(h.host.assistantOpen, false);
  assert.equal(h.assistantMessages.some(message => message.type === 'focusAssistant' || message.type === 'prepareAssistant'), false);
  assert.equal(h.host.assistantPreparation, undefined);
});

test('removing a resolving view releases its pending reveal without touching a later binding', async t => {
  const h = harness(t);
  h.deferNativeReveal();
  const open = h.host.show('Assistant');
  await tick();
  const hidden = h.newView();
  hidden.visible = false;
  h.resolve(hidden);
  hidden.dispose();
  await open;
  assert.equal(h.host.assistantVisibilityTask, undefined);
  assert.equal(h.host.assistantOpen, false);
  const replacement = h.newView();
  h.resolve(replacement);
  await h.host.show('Assistant', true);
  hidden.dispose();
  assert.equal(h.host.assistantView, replacement);
  assert.equal(h.host.assistantOpen, true);
});
