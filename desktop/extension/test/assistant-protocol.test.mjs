import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Overrides let this test run against a staged host without modifying the app.
// In the repository, both paths resolve automatically from extension/test/.
const root = process.env.FOUNDATION_PROTOCOL_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const requireFromProject = createRequire(join(root, 'package.json'));
const ts = requireFromProject('typescript');
const featureStoreModule = await import(join(root, 'desktop/extension/src/feature-store.mjs'));
const taskContextModule = await import(join(root, 'server/project/assistant.mjs'));
const { createConversationStore } = await import(join(root, 'desktop/extension/src/conversation-store.mjs'));
const { createProposalSession } = await import(join(root, 'desktop/extension/src/proposal-session.mjs'));
const hostPath = process.env.FOUNDATION_PROTOCOL_TEST_SOURCE || join(root, 'desktop/extension/src/extension.ts');
const source = readFileSync(hostPath, 'utf8');
const runtimeWorkspaceModule = await import(join(root, 'desktop/extension/src/runtime-workspace-store.mjs'));
const runtimeReplayModule = await import(join(root, 'desktop/extension/src/runtime-replay-store.mjs'));
const runtimeMatrixModule = await import(join(root, 'desktop/extension/src/runtime-matrix-store.mjs'));
const runtimeStateSuiteModule = await import(join(root, 'desktop/extension/src/runtime-state-suite-store.mjs'));
const compiled = ts.transpileModule(`${source}\nexport { FoundationHost };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(events) {
  let consumed = false;
  return {
    ok: true,
    body: { getReader: () => ({
      read: async () => {
        if (consumed) return { done: true };
        consumed = true;
        return { done: false, value: Buffer.from(`${events.map(event => JSON.stringify(event)).join('\n')}\n`) };
      },
    }) },
  };
}
const input = (requestId, prompt = 'question') => ({
  type: 'ask', requestId, prompt,
  context: [{ path: 'src/Button.tsx', revision: 'r1' }],
});

function harness(options = {}) {
  const persisted = options.persisted || new Map();
  const writes = [], warnings = [];
  let fetchHandler = async () => { throw new Error('Unexpected provider request in protocol test.'); };
  let bridgeCount = 0;
  const vscode = {
    workspace: { isTrusted: true, textDocuments: [] },
    ViewColumn: { One: 1, Two: 2 },
    Uri: { joinPath: (base, ...parts) => [base, ...parts].join('/') },
    window: { showWarningMessage: message => { warnings.push(message); return Promise.resolve(undefined); }, createWebviewPanel: () => ({
      webview: {
        asWebviewUri: path => path,
        cspSource: 'safe-resource:',
        postMessage() {},
        onDidReceiveMessage(callback) { this.receive = callback; },
      },
      onDidDispose() {},
      reveal() {},
    }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Buffer,
    AbortController, TextDecoder, setTimeout, clearTimeout,
    fetch: (...args) => fetchHandler(...args),
    require: name => {
      if (name === 'vscode') return vscode;
      if (name.includes('runtime-workspace-store')) return runtimeWorkspaceModule;
      if (name.includes('runtime-state-suite-store')) return runtimeStateSuiteModule;
      if (name.includes('runtime-matrix-store')) return runtimeMatrixModule;
      if (name.includes('runtime-replay-store')) return runtimeReplayModule;
      if (name.includes('feature-store')) return featureStoreModule;
      if (name.includes('assistant.mjs')) return taskContextModule;
      if (name.includes('assistant-bridge')) return {
        createAssistantBridge: async () => {
          bridgeCount++;
          return { url: 'http://127.0.0.1:1', token: 'fixture', close: async () => {} };
        },
      };
      if (name.includes('safety')) return { escapeHtml: String };
      if (name.includes('conversation-store')) return { createConversationStore };
      if (name.includes('proposal-session')) return { createProposalSession };
      if (name.startsWith('node:')) return requireFromProject(name);
      return {};
    },
  });
  // Exercise the real request/message methods without constructor side effects:
  // no native windows, secret storage, project writes, or network calls occur.
  const host = Object.create(module.exports.FoundationHost.prototype);
  const messages = [], proposals = [];
  Object.assign(host, {
    context: { extensionUri: 'extension', subscriptions: [], workspaceState: {
      get: key => persisted.get(key), update: async (key, value) => {
        if (options.write) await options.write(key, value);
        persisted.set(key, structuredClone(value)); writes.push({ key, value: structuredClone(value) });
      },
    } },
    nonce: 'fixture', askGeneration: 0,
    project: { id: 'orbit', root: '/fixtures/orbit' },
    conversationStores: new Map(), disposed: false,
    openFiles: [{ path: 'src/Button.tsx', revision: 'r1', source: 'export const Button = () => null;' }],
    service: { getFile: async (_id, path) => ({path,revision:'r1',source:'export const Button = () => null;'}) },
    assistant: { status: () => ({ configured: true, model: 'fixture-model' }) },
    status: {}, dirtyPaths: () => [], sendState() {},
    proposals: () => ({
      current: () => null,
      set: async (proposal, options) => {
        if (options.isCurrent()) proposals.push(proposal);
      },
    }),
    assistantView: { visible: true, webview: { postMessage: message => messages.push(structuredClone(message)) } },
  });
  return {
    host, messages, proposals, persisted, writes, warnings, vscode,
    setFetch(handler) { fetchHandler = handler; },
    get bridgeCount() { return bridgeCount; },
  };
}

test('cancel acknowledges revoked ownership; obsolete stops and responses cannot affect a newer request', async () => {
  const h = harness(), old = deferred(), next = deferred();
  h.setFetch((_url, options) => JSON.parse(options.body).prompt === 'old' ? old.promise : next.promise);
  const first = h.host.ask(input('request-old', 'old'));
  await tick();
  const oldAbort = h.host.asking.abort;
  h.host.assistantView.webview.postMessage = message => {
    if (message.event?.type === 'cancelled') {
      assert.equal(oldAbort.signal.aborted, true, 'abort must precede acknowledgement');
      assert.equal(h.host.asking, undefined, 'ownership must be revoked before acknowledgement');
    }
    h.messages.push(structuredClone(message));
  };
  h.host.cancelQuestion('request-old');
  assert.deepEqual(h.messages.map(({type,requestId,event})=>({type,requestId,event})), [{ type: 'ai', requestId: 'request-old', event: { type: 'cancelled' } }]);
  assert.equal(h.messages[0].conversations.conversations[0].turns[0].state, 'stopped');

  const second = h.host.ask({...input('request-new', 'new'), conversationId:h.host.conversations().snapshot().activeId});
  await tick();
  const newAbort = h.host.asking.abort;
  h.host.cancelQuestion('request-old');
  assert.equal(newAbort.signal.aborted, false, 'a delayed stop must not cancel the newer request');

  // Deliberately ignore abort in this transport stub: late provider data must
  // still be rejected by host ownership checks, including a source proposal.
  old.resolve(response([
    { type: 'proposal', proposal: { id: 'obsolete' } },
    { type: 'delta', text: 'obsolete' }, { type: 'done' },
  ]));
  await first;
  assert.equal(h.host.asking.requestId, 'request-new');
  assert.equal(h.proposals.length, 0);
  next.resolve(response([
    { type: 'start', model: 'fixture' },
    { type: 'delta', text: 'Answer' }, { type: 'done' },
  ]));
  await second;
  assert.equal(h.messages.filter(message => message.requestId === 'request-old').length, 1);
  assert.deepEqual(h.messages.filter(message => message.requestId === 'request-new').map(message => message.event.type), ['start', 'delta', 'done']);
  h.host.cancelQuestion('request-new');
  assert.equal(h.messages.at(-1).event.type, 'done', 'a completed request must not be relabelled cancelled');
});

test('duplicate delivery of an active request starts one provider call and does not terminate its turn', async () => {
  const h = harness(), waiting = deferred();
  h.setFetch(() => waiting.promise);
  const first = h.host.ask(input('request-duplicate'));
  await tick();
  await h.host.ask(input('request-duplicate'));
  assert.equal(h.bridgeCount, 1);
  waiting.resolve(response([{ type: 'done' }]));
  await first;
  assert.equal(h.messages.filter(message => message.event.type === 'error').length, 0);
});

test('persisted proposal provenance uses the host request ID and later terminal events are ignored', async () => {
  const h = harness();
  h.setFetch(async () => response([
    { type: 'proposal', proposal: { id: 'p1', requestId: 'model-injected', projectId:'orbit', path:'src/Button.tsx',baseRevision:'r1',before:'export const Button = () => null;',after:'export const Button = () => 1;',status:'proposed',origin:'ai',context:[],verification:[] } },
    { type: 'done' }, { type: 'error', error: 'late' },
  ]));
  await h.host.ask({...input('request-proposal'),intent:'build'});
  assert.equal(h.proposals[0].requestId, 'request-proposal');
  assert.equal(h.messages[0].event.proposal.requestId, 'request-proposal');
  assert.deepEqual(h.messages.map(message => message.event.type), ['proposal', 'done']);
  assert.ok(h.messages.every(message => message.requestId === 'request-proposal'));
});

test('EOF without completion preserves partial output and terminates with a correlated error', async () => {
  const h = harness();
  h.setFetch(async () => response([{ type: 'start' }, { type: 'delta', text: 'Partial' }]));
  await h.host.ask(input('request-truncated'));
  assert.deepEqual(h.messages.map(message => message.event.type), ['start', 'delta', 'error']);
  assert.equal(h.messages[1].event.text, 'Partial');
  assert.equal(h.messages.at(-1).requestId, 'request-truncated');
  assert.equal(h.host.asking, undefined);
});

test('preflight draft rejection stays attached to its turn and the artifact helper loads before the renderer', async () => {
  const h = harness();
  h.host.assistantView = undefined;
  const panel = { ...h.vscode.window.createWebviewPanel(), visible: true, onDidChangeVisibility() {} };
  h.host.resolveAssistantView(panel);
  panel.webview.postMessage = message => h.messages.push(structuredClone(message));
  h.host.dirtyPaths = () => ['src/Button.tsx'];
  panel.webview.receive(input('request-draft'));
  await tick();
  assert.equal(h.messages[0].requestId, 'request-draft');
  assert.equal(h.messages[0].type, 'ai');
  assert.equal(h.messages[0].event.type, 'error');
  assert.match(h.messages[0].event.error, /Save changes.*before sharing/);
  assert.equal(h.host.asking, undefined);
  assert.equal(h.bridgeCount, 0, 'draft rejection must happen before a provider call');
  const helper = panel.webview.html.indexOf('artifact-model.js');
  const renderer = panel.webview.html.indexOf('webview.js');
  assert.ok(helper >= 0 && renderer > helper);
  assert.match(panel.webview.html, /script-src 'nonce-fixture'/);
  assert.match(panel.webview.html, /<script nonce="fixture" src="extension\/media\/artifact-model.js"><\/script>/);
});


test('native history survives host recreation with immutable snapshots and no provider dispatch on restore', async () => {
  const h = harness();
  h.setFetch(async () => response([{type:'start',model:'fixture-model'}, {type:'delta',text:'Saved response'}, {type:'done',usage:{total_tokens:12}}]));
  await h.host.ask(input('request-durable'));
  const restored = harness({persisted:h.persisted});
  const history = restored.host.conversations().snapshot();
  assert.equal(history.conversations.length,1);
  const turn=history.conversations[0].turns[0];
  assert.equal(turn.answer,'Saved response');
  assert.equal(turn.state,'complete');
  assert.equal(turn.context[0].source,'export const Button = () => null;');
  assert.equal(turn.context[0].revision,'r1');
  assert.equal(restored.bridgeCount,0);
  assert.equal(restored.messages.length,0);
  assert.ok(h.messages.every(message=>message.conversationId===history.activeId));
  await assert.rejects(restored.host.ask({...input('request-durable'),conversationId:history.activeId}), /already|unique|used|request/i);
  assert.equal(restored.bridgeCount,0,'a replayed finished request cannot create another provider dispatch');
});

test('history actions are scoped to the trusted project and cannot reroute an in-flight response', async () => {
  const h=harness(), waiting=deferred();
  await h.host.conversationAction({action:'new',projectId:'orbit'});
  const original=h.host.conversations().snapshot().activeId;
  h.setFetch(()=>waiting.promise);
  const running=h.host.ask({...input('request-owner'),conversationId:original});
  await tick();
  await assert.rejects(h.host.conversationAction({action:'new',projectId:'orbit'}), /Stop/);
  await assert.rejects(h.host.conversationAction({action:'archive',projectId:'other',id:original}), /current trusted/);
  h.host.cancelQuestion();
  waiting.resolve(response([{type:'done'}]));await running;
  await h.host.conversationAction({action:'archive',projectId:'orbit',id:original});
  assert.equal(h.host.conversations().snapshot().conversations[0].archived,true);
  h.host.project={id:'other',root:'/fixtures/other'};
  assert.equal(h.host.conversations().snapshot().conversations.length,0);
  h.vscode.workspace.isTrusted=false;
  await assert.rejects(h.host.conversationAction({action:'new',projectId:'other'}), /trusted/);
  assert.equal(h.bridgeCount,1);
});

test('failed history persistence blocks dispatch and does not retain an orphan running request', async () => {
  const h=harness({write:async()=>{throw new Error('private-storage-detail');}});
  await h.host.ask(input('request-storage-failure'));
  assert.equal(h.bridgeCount,0);
  assert.equal(h.host.asking,undefined);
  const snapshot=h.host.conversations().snapshot();
  assert.equal(snapshot.storage.status,'error');
  assert.ok(snapshot.conversations.every(chat=>chat.turns.every(turn=>turn.state!=='running'&&turn.state!=='stopping')));
  assert.match(h.messages.at(-1).event.error,/could not be saved/);
  assert.ok(!JSON.stringify(snapshot).includes('private-storage-detail'));
});

test('persisted intent precedes provider dispatch and cancellation during that write never dispatches', async () => {
  const writing=deferred();let blocked=true;
  const h=harness({write:async()=>{if(blocked) await writing.promise;}});
  const asking=h.host.ask(input('request-persist-order'));
  await tick();
  assert.equal(h.bridgeCount,0);
  h.host.cancelQuestion('request-persist-order');
  blocked=false;writing.resolve();await asking;
  assert.equal(h.bridgeCount,0);
  const turn=h.host.conversations().snapshot().conversations.flatMap(chat=>chat.turns)[0];
  assert.ok(!turn || turn.state==='stopped');
});

test('preview history attaches only exact applied source revision and never upgrades interaction or visual checks', async () => {
  const h=harness();
  h.setFetch(async()=>response([{type:'done'}]));
  await h.host.ask({...input('request-verification'),intent:'build'});
  const proposal={id:'proposal-check',projectId:'orbit',requestId:'request-verification',path:'src/Button.tsx',baseRevision:'r1',appliedRevision:'r2',before:'export const Button = () => null;',after:'export const Button = () => 1;',status:'applied',origin:'ai',context:[],verification:[]};
  // Preserve proposal identity as though it arrived before the terminal event.
  const store=h.host.conversations();
  await store.updateProposal(proposal);
  h.host.proposals=()=>({current:()=>proposal});
  h.host.design={session:'preview-session',revision:'preview-revision',files:[{path:proposal.path,revision:'other'}],compilation:'passed',observed:true,stale:false};
  await h.host.recordConversationVerification();
  let turn=store.snapshot().conversations[0].turns[0];
  assert.equal(turn.verificationHistory.length,0);
  h.host.design.files[0].revision='r2';
  await h.host.recordConversationVerification();
  turn=store.snapshot().conversations[0].turns[0];
  assert.equal(turn.verificationHistory.length,1);
  assert.equal(turn.verificationHistory[0].revision,'r2');
  assert.equal(turn.verificationHistory[0].runtimeSession,'preview-session');
  assert.equal(turn.verificationHistory[0].interaction,'not-run');
  assert.equal(turn.verificationHistory[0].visual,'not-run');
  assert.equal(turn.verificationHistory[0].historical,true);
});

test('burst streaming coalesces full-history snapshots without losing final answer text', async () => {
  const h=harness();
  h.setFetch(async()=>response([{type:'start'}, ...Array.from({length:200},()=>({type:'delta',text:'x'})), {type:'done'}]));
  await h.host.ask(input('request-burst'));
  assert.deepEqual(h.messages.map(message=>message.event.type),['start','delta','done']);
  assert.equal(h.messages[1].event.text,'x','the first token is delivered immediately');
  assert.equal(h.messages.at(-1).conversations.conversations[0].turns[0].answer,'x'.repeat(200));
  const count=h.messages.length;
  await new Promise(resolve=>setTimeout(resolve,125));
  assert.equal(h.messages.length,count,'no delayed progress follows terminal completion');
});

test('cancel clears queued progress and history notifications cannot cross projects', async () => {
  const h=harness(), waiting=deferred();let reads=0;
  h.setFetch(async()=>({ok:true,body:{getReader:()=>({read:async()=>++reads===1
    ? {done:false,value:Buffer.from('{"type":"start"}\n{"type":"delta","text":"a"}\n{"type":"delta","text":"b"}\n')}
    : waiting.promise})}}));
  const running=h.host.ask(input('request-queued'));
  await tick();
  let stateNotifications=0;h.host.sendState=()=>{stateNotifications++;};
  h.host.cancelQuestion('request-queued');
  h.host.project={id:'other',root:'/fixtures/other'};
  const count=h.messages.length;
  await new Promise(resolve=>setTimeout(resolve,125));
  assert.equal(h.messages.length,count,'obsolete progress timer must not post into the new project');
  assert.equal(stateNotifications,0,'old history notifications must not post after project switch');
  assert.equal(h.messages.at(-1).event.type,'cancelled');
  assert.equal(h.messages.at(-1).conversations.conversations[0].turns[0].answer,'ab');
  waiting.resolve({done:true});await running;
});

test('a terminal persistence completion cannot send its old-project snapshot into a newer workspace', async () => {
  const terminalWrite=deferred();let writes=0;
  const h=harness({write:async()=>{if(++writes===2)await terminalWrite.promise;}});
  h.setFetch(async()=>response([{type:'start'},{type:'delta',text:'Saved in Orbit'},{type:'done'}]));
  const running=h.host.ask(input('request-final-write'));
  await tick();
  assert.equal(writes,2);
  h.host.cancelQuestion();h.host.project={id:'other',root:'/fixtures/other'};
  terminalWrite.resolve();await running;
  assert.deepEqual(h.messages.map(message=>message.event.type),['start','delta']);
  const stored=h.persisted.get('foundation.conversations.orbit');
  assert.equal(stored.conversations[0].turns[0].state,'complete');
  assert.equal(stored.conversations[0].turns[0].answer,'Saved in Orbit');
});


test('full verification history warns without changing the actual preview result or dropping earlier evidence', async () => {
  const h = harness();
  const store = h.host.conversations();
  const before = 'export const Button = () => null;';
  await store.startTurn({ requestId: 'request-full-verification', prompt: 'Improve the button', intent: 'build',
    context: [{ path: 'src/Button.tsx', revision: 'r1', source: before }] });
  store.event('request-full-verification', { type: 'done' });
  const proposal = { id: 'proposal-full-verification', projectId: 'orbit', requestId: 'request-full-verification',
    path: 'src/Button.tsx', baseRevision: 'r1', appliedRevision: 'r2', before, after: 'export const Button = () => 1;',
    status: 'applied', origin: 'ai', context: [], verification: [] };
  await store.updateProposal(proposal);
  for (let index = 0; index < 32; index++) {
    await store.recordVerification(proposal.id, { revision: 'r2', previewRevision: `preview-${index}`,
      runtimeSession: `session-${index}`, compilation: 'passed', observed: false });
  }
  const saved = structuredClone(h.persisted.get('foundation.conversations.orbit'));
  h.host.proposals = () => ({ current: () => proposal });
  h.host.design = { session: 'session-full', revision: 'preview-full', files: [{ path: proposal.path, revision: 'r2' }],
    compilation: 'passed', observed: true, stale: false };
  const actualPreview = structuredClone(h.host.design);
  await h.host.recordConversationVerification();
  assert.deepEqual(h.host.design, actualPreview, 'history capacity must not relabel a successful preview');
  assert.deepEqual(h.persisted.get('foundation.conversations.orbit'), saved, 'all earlier evidence remains intact');
  assert.equal(store.snapshot().storage.status, 'saved', 'capacity is not a disk-write failure');
  assert.equal(h.warnings.length, 1, 'a saved status cannot silently conceal missing new evidence');
  assert.match(h.warnings[0], /Conversation history is full/);
  assert.match(h.warnings[0], /preview result is still available/);
  assert.match(h.warnings[0], /could not be recorded/);
  await h.host.recordConversationVerification();
  assert.equal(h.warnings.length, 1, 'repeated capacity failure must not repeat the notification');
  h.host.design.session = 'session-0'; h.host.design.revision = 'preview-0';
  await h.host.recordConversationVerification();
  assert.equal(store.snapshot().conversations[0].turns[0].verificationHistory[0].observed, true, 'existing evidence can still be upgraded at capacity');
  h.host.design.session = 'session-after-recovery'; h.host.design.revision = 'preview-after-recovery';
  await h.host.recordConversationVerification();
  assert.equal(h.warnings.length, 2, 'a subsequent failure is visible after successful recording');
  await store.dispose();
});

test('history rejection warns while Apply and Undo still succeed through the saved authoritative checkpoint', async () => {
  const h = harness();
  delete h.host.proposals;
  h.host.proposalSessions = new Map();
  const before = 'export const Button = () => null;', after = 'export const Button = () => 1;';
  let file = { path: 'src/Button.tsx', revision: 'r1', source: before }, savedSources = [];
  h.host.service = {
    getFile: async () => structuredClone(file),
    save: async change => {
      assert.equal(change.baseRevision, file.revision);
      savedSources.push(change.source);
      file = { path: change.path, source: change.source, revision: `r${savedSources.length + 1}` };
      return structuredClone(file);
    },
  };
  h.host.conversationStores.set('orbit', { updateProposal: async () => {
    throw Object.assign(new Error('private-provider-url-and-key'), { code: 'history-capacity' });
  } });
  h.persisted.set('foundation.proposal.orbit', { id: 'proposal-full-checkpoint', projectId: 'orbit',
    path: file.path, baseRevision: 'r1', before, after, status: 'proposed', origin: 'ai', context: [], verification: [] });
  const session = h.host.proposals();
  const applied = await session.apply('proposal-full-checkpoint', 'orbit');
  assert.equal(applied.status, 'applied');
  assert.equal(file.source, after);
  assert.equal(h.persisted.get('foundation.proposal.orbit').status, 'applied');
  const undone = await session.undo('proposal-full-checkpoint', 'orbit');
  assert.equal(undone.status, 'undone');
  assert.equal(file.source, before);
  assert.equal(h.persisted.get('foundation.proposal.orbit').status, 'undone');
  assert.deepEqual(savedSources, [after, before]);
  assert.equal(h.warnings.length, 1, 'one persistent capacity issue should not warn again on Undo');
  assert.ok(h.warnings.every(message => /Conversation history is full/.test(message) && /review checkpoint was saved/.test(message)));
  assert.doesNotMatch(JSON.stringify(h.warnings), /private-provider-url-and-key/);
});
