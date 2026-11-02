import { mockDisplaySources } from './helpers/display-source-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.FOUNDATION_SCENARIO_HOST_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const projectRequire = createRequire(join(root, 'package.json')), ts = projectRequire('typescript');
const featureStoreModule = await import(join(root, 'desktop/extension/src/feature-store.mjs'));
const runtimeWorkspaceModule = await import(join(root, 'desktop/extension/src/runtime-workspace-store.mjs'));
const replayStoreModule = await import(join(root, 'desktop/extension/src/runtime-replay-store.mjs'));
const runtimeMatrixModule = await import(join(root, 'desktop/extension/src/runtime-matrix-store.mjs'));
const runtimeStateSuiteModule = await import(join(root, 'desktop/extension/src/runtime-state-suite-store.mjs'));
const safety = await import(join(root, 'desktop/extension/src/safety.mjs'));
const compiled = ts.transpileModule(`${readFileSync(join(root, 'desktop/extension/src/extension.ts'), 'utf8')}\nexport { FoundationHost };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const hash = value => createHash('sha256').update(value).digest('hex');
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const project = { id: 'scenario-project', root: '/fixtures/scenario', files: [{ path: 'src/Button.tsx' }, { path: 'src/App.tsx' }] };
const file = (path, source = 'export const example = true;\n') => ({ path, source, revision: hash(source).slice(0, 16), analysis: { imports: [], consumers: [], symbols: [], requests: [] } });
function harness(t, previous) {
  const persisted = previous || new Map(), writes = [], reads = [], calls = [], messages = [], states = [];
  const sources = new Map(project.files.map(item => [item.path, file(item.path)]));
  let readHook, writeHook, discoverHook, navigateHook, startHook, replayHook, viewCounter = 2;
  const runtimeState = { status: 'connected', root: project.root, target: { id: 'vite:dev', root: project.root }, targets: [], owned: true,
    session: '1'.repeat(32), viewId: '2'.repeat(32), documentId: '3'.repeat(32), pageConnected: true, pagePath: '/profile', pageVersion: 1,
    url: 'http://127.0.0.1:4173/profile', targetUrl: 'http://127.0.0.1:4173', selection: null, selectionVersion: 0,
    observations: [], files: [], capabilities: { sourceMapping: 'instrumented', requests: true, screenshots: false, routeTracking: true, scenarioReplay:true }, replayCatalog: {schemaVersion:1,registrationId:'4'.repeat(32),digest:'5'.repeat(64),recipes:[{id:'save-success',title:'Save fixture',route:'/profile',fixture:{id:'profile-v1',label:'Local fixture'},steps:[{id:'save',title:'Save profile'},{id:'settle',title:'Observe settled state'}]}]} };
  const runtime = {
    snapshot: () => structuredClone(runtimeState),
    readCurrent: async () => structuredClone(runtimeState),
    replay: async (input, options) => {
      calls.push(['replay',structuredClone(input)]);
      if (replayHook) return replayHook(input, options);
      for(const unit of [{phase:'prepare'}, ...runtimeState.replayCatalog.recipes[0].steps.map(step=>({phase:'step',stepId:step.id}))]) {
        if(options.signal.aborted)return {status:'cancelled',reason:'cancelled'};
        await options.onProgress({...unit,status:'running'});
        if(options.signal.aborted)return {status:'cancelled',reason:'cancelled'};
        calls.push(['dispatch',unit.phase,...(unit.stepId?[unit.stepId]:[])]);
        await options.onProgress({...unit,status:'completed',observed:{viewportWidthCss:960,viewportHeightCss:680,deviceScaleFactor:2,colorSchemePreference:'light',reducedMotionPreference:'no-preference'}});
      }
      return {status:'completed'};
    },
    discover: async () => { calls.push(['discover']); if (discoverHook) await discoverHook(); return [{ id: 'vite:dev', root: project.root, available: true, instrumented: true }]; },
    start: async id => { calls.push(['start', id]); if (startHook) await startHook(); runtimeState.status = 'connected'; runtimeState.target = { id, root: project.root }; return structuredClone(runtimeState); },
    navigate: async route => { calls.push(['navigate', route]); if (navigateHook) await navigateHook(); runtimeState.viewId = String(++viewCounter).padStart(32, '0'); runtimeState.pageConnected = false; runtimeState.documentId = null; runtimeState.pagePath = null; runtimeState.url = `http://127.0.0.1:4173${route}`; runtimeState.observations = []; return structuredClone(runtimeState); },
    dispose: async () => { calls.push(['dispose']); },
  };
  const vscode = { workspace: { isTrusted: true, textDocuments: [] }, Uri: { file: fsPath => ({ fsPath, scheme: 'file', toString: () => `file://${fsPath}` }) } };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Buffer, URL, AbortController, TextDecoder, setTimeout, clearTimeout,
    fetch() { throw new Error('A scenario must never send an AI or remote-provider request'); },
    require: name => name === 'vscode' ? vscode : name.includes('runtime-state-suite-store') ? runtimeStateSuiteModule : name.includes('runtime-matrix-store') ? runtimeMatrixModule : name.includes('runtime-replay-store') ? replayStoreModule : name.includes('runtime-workspace-store') ? runtimeWorkspaceModule : name.includes('feature-store') ? featureStoreModule : name.includes('safety') ? safety : name.startsWith('node:') ? projectRequire(name) : {},
  });
  const host = Object.create(module.exports.FoundationHost.prototype);
  Object.assign(host, {
    context: { workspaceState: { get: key => persisted.get(key), update: async (key, value) => { if (writeHook) await writeHook(key, value); persisted.set(key, structuredClone(value)); writes.push({ key, value: structuredClone(value) }); } } },
    project: structuredClone(project), openFiles: [], featureFiles: [], featureUnavailable: [], featureStores: new Map(), runtimeWorkspaceStores: new Map(),
    service: { getFiles: mockDisplaySources, getFile: async (id, path) => { reads.push({ id, path }); if (readHook) return readHook(id, path); if (!sources.has(path)) throw new Error('Missing source'); return structuredClone(sources.get(path)); } },
    runtime, runtimeRoot: project.root, runtimeGeneration: 1, runtimeFrameOrigin: 'http://127.0.0.1:4173', runtimeSelectionKey: '',
    featureLoadGeneration: 0, featureSourceEpoch: 0, featureCacheKey: '', featureLoadKey: '', disposed: false,
    mode:'Refine', panel:{visible:true,webview:{postMessage: async value=>{messages.push(value);return true;}}},
    generation: 0, focusGeneration: 0, askGeneration: 0,
    dirtyPaths: () => [], queueConversationState() {}, updateTree() {},
    show: mode => { host.mode=mode;calls.push(['show', mode]); }, sendState() { states.push({ projectId: this.project?.id }); },
  });
  const h = { host, runtimeState, runtime, vscode, persisted, writes, reads, calls, messages, states, sources,
    setReplay: hook => {replayHook=hook;},
    replayState: () => host.runtimeReplaySnapshot(),
    replayAction: (action, fields={}) => host.runtimeReplayAction({action,projectId:host.project.id,expectedRevision:host.runtimeReplayStore().snapshot().revision, ...fields}),
    setRead: hook => { readHook = hook; }, setWrite: hook => { writeHook = hook; }, setDiscover: hook => { discoverHook = hook; }, setNavigate: hook => { navigateHook = hook; }, setStart: hook => { startHook = hook; },
    state: () => structuredClone(host.runtimeWorkspaceSnapshot()), raw: () => host.runtimeWorkspaceStore().snapshot(),
    action: (action, fields = {}) => host.runtimeWorkspaceAction({ action, projectId: host.project?.id, expectedRevision: host.runtimeWorkspaceStore().snapshot().revision, ...fields }),
  };
  t.after(async () => { writeHook = undefined; await host.endScenarioRun('cancelled').catch(() => {}); host.disposed = true; await Promise.all([...host.featureStores.values(), ...host.runtimeWorkspaceStores.values(), ...(host.runtimeReplayStores?.values()||[])].map(store => store.dispose())); });
  return h;
}
async function setup(t) {
  const h = harness(t);
  await h.host.featureAction({ action: 'create', projectId: project.id, expectedRevision: 0, input: { title: 'Save profile', brief: 'Inspect saved behavior.', paths: ['src/Button.tsx'], entryPath: 'src/Button.tsx' } });
  await h.action('createScreen', { input: { title: 'Profile', targetId: 'vite:dev', route: '/profile' } });
  const screen = h.raw().screens[0];
  await h.action('createScenario', { input: { screenId: screen.id, title: 'Save', steps: ['Press Save.'], expectedOutcome: 'Saving returns to an editable state.' } });
  return Object.assign(h, { screen, scenario: h.raw().scenarios[0] });
}
const begin = h => h.action('beginRun', { scenarioId: h.scenario.id });
const active = h => h.state().activeRun;
const record = (h, index, extra = {}) => ({ id: `${h.runtimeState.session}:${h.runtimeState.viewId}:${index}`, session: h.runtimeState.session, documentId: h.runtimeState.documentId,
  kind: 'request', method: 'POST', url: 'http://127.0.0.1:4173/api/profile', status: 200, durationMs: 12.5, outcome: 'success', observedAt: new Date().toISOString(), timing: 'response-headers', correlation: 'unattributed', ...extra });


const startReplay = h => h.replayAction('start',{runId:active(h)?.id,recipeId:'save-success',catalogDigest:'5'.repeat(64),registrationId:'4'.repeat(32),requested:{theme:'dark',motion:'reduce',viewportWidthCss:960,viewportHeightCss:680}});
async function ready(t){const h=await setup(t);await begin(h);return h;}

test('explicit replay persists every unit and retains separate manual assessment', async t=>{
 const h=await ready(t), observed=[];
 h.setWrite(async(key,value)=>{if(key.includes('runtime-replays'))observed.push(structuredClone(value));});
 await startReplay(h);
 const r=h.replayState().replays[0];
 assert.equal(r.status,'completed');assert.equal(r.prepare.status,'completed');assert.ok(r.steps.every(s=>s.status==='completed'));
 assert.equal(h.raw().runs[0].status,'recording');assert.equal(h.raw().runs[0].assessment,'not-assessed');
 assert.equal(r.sourceRelationship,'unverified');assert.deepEqual(r.binding.sources,h.raw().runs[0].sources);
 assert.equal(r.requested.theme,'dark');assert.equal(r.observed.colorSchemePreference,'light');
 assert.equal(h.calls.filter(c=>c[0]==='dispatch').length,3);assert.equal(observed[0].replays[0].prepare.status,'pending');
 for(const id of ['prepare','save','settle'])assert.ok(observed.some(v=>{const x=v.replays[0];return [x.prepare,...x.steps].some(u=>u.id===id&&u.status==='running');}));
 await assert.rejects(startReplay(h),/already has a replay/);
 assert.equal(h.calls.filter(c=>c[0]==='replay').length,1);
});

test('unselected, foreign, changed, invisible and unsupported replay scopes never dispatch', async t=>{
 const h=await ready(t);
 await assert.rejects(h.replayAction('start',{runId:'foreign'}),/Begin an observation/);
 h.host.panel.visible=false;await assert.rejects(startReplay(h),/visible running preview/);h.host.panel.visible=true;
 h.runtimeState.replayCatalog.digest='6'.repeat(64);await startReplay(h);
 assert.equal(h.replayState().replays.length,0);assert.match(h.replayState().error,/recipe/);
 h.runtimeState.replayCatalog.digest='5'.repeat(64);h.runtimeState.capabilities.scenarioReplay=false;await startReplay(h);
 assert.equal(h.calls.filter(c=>c[0]==='replay').length,0);
});

test('saved source changed before preparation refuses all execution', async t=>{
 const h=await ready(t);h.sources.set('src/Button.tsx',file('src/Button.tsx','export const changed=true;'));
 await startReplay(h);assert.equal(h.replayState().replays.length,0);assert.match(h.replayState().error,/source changed/);
 assert.equal(h.calls.filter(c=>c[0]==='replay').length,0);
});

test('changed source between acknowledged steps interrupts without automatic completion', async t=>{
 const h=await ready(t);
 h.setReplay(async(input,{onProgress})=>{
  await onProgress({phase:'prepare',status:'running'});h.calls.push(['dispatch','prepare']);
  await onProgress({phase:'prepare',status:'completed'});
  h.sources.set('src/Button.tsx',file('src/Button.tsx','export const changed=true;'));
  await onProgress({phase:'step',stepId:'save',status:'running'});h.calls.push(['dispatch','save']);return {status:'completed'};
 });
 await startReplay(h);const r=h.replayState().replays[0];assert.equal(r.status,'interrupted');assert.equal(r.reason,'source-changed');
 assert.equal(r.steps[0].status,'pending');assert.deepEqual(h.calls.filter(c=>c[0]==='dispatch'),[['dispatch','prepare']]);
 assert.equal(h.raw().runs[0].assessment,'not-assessed');
});

test('Stop is available during an awaited callback and does not undo earlier work', async t=>{
 const h=await ready(t),started=deferred();
 h.setReplay(async(input,{onProgress,signal})=>{await onProgress({phase:'prepare',status:'running'});started.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {status:'cancelled',reason:'cancelled'};});
 const work=startReplay(h);await started.promise;const r=h.replayState().replays[0];
 await assert.rejects(h.action('finishRun',{id:active(h).id,assessment:'matched',note:''}),/Stop the active replay/);
 await h.replayAction('cancel',{id:r.id,executionId:r.executionId});await work;
 const final=h.replayState().replays[0];assert.equal(final.status,'cancelled');assert.equal(final.prepare.effects,'unknown');assert.equal(final.steps[0].effects,'not-started');
 assert.equal(h.raw().runs[0].status,'recording');assert.equal(h.raw().runs[0].assessment,'not-assessed');
});

test('initial reservation write failure prevents dispatch and Retry never executes', async t=>{
 const h=await ready(t);let fail=true;
 h.setWrite(async(key)=>{if(fail&&key.includes('runtime-replays'))throw Error('disk');});
 await startReplay(h);assert.equal(h.calls.filter(c=>c[0]==='replay').length,0);assert.equal(h.replayState().storage.status,'error');
 fail=false;await h.replayAction('retry');assert.equal(h.replayState().replays[0].status,'interrupted');assert.equal(h.calls.filter(c=>c[0]==='replay').length,0);
});

test('step reservation write failure prevents its dispatch and preserves unknown history', async t=>{
 const h=await ready(t);let fail=true;
 h.setWrite(async(key,value)=>{if(fail&&key.includes('runtime-replays')&&value.replays[0].steps[0].status==='running')throw Error('disk');});
 await startReplay(h);assert.deepEqual(h.calls.filter(c=>c[0]==='dispatch'),[['dispatch','prepare']]);assert.equal(h.replayState().storage.status,'error');
 fail=false;await h.replayAction('retry');assert.equal(h.replayState().replays[0].status,'interrupted');assert.equal(h.calls.filter(c=>c[0]==='replay').length,1);
});

test('cancelling the containing observation stops replay before finalizing it', async t=>{
 const h=await ready(t),started=deferred();
 h.setReplay(async(input,{onProgress,signal})=>{await onProgress({phase:'prepare',status:'running'});started.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {status:'cancelled',reason:'cancelled'};});
 const work=startReplay(h);await started.promise;await h.action('cancelRun',{id:active(h).id});await work;
 assert.equal(h.replayState().replays[0].status,'cancelled');assert.equal(h.raw().runs[0].status,'cancelled');
});

test('terminal restoration only reads local evidence and never dispatches a recipe',async t=>{
 const h=await ready(t);await startReplay(h);await h.action('finishRun',{id:active(h).id,assessment:'not-assessed',note:''});
 const next=harness(t,h.persisted);assert.equal(next.replayState().replays[0].status,'completed');assert.deepEqual(next.calls,[]);
 assert.deepEqual(next.replayState().replays,h.replayState().replays);
});

test('Stop during initial persistence prevents the runtime reservation entirely',async t=>{
 const h=await ready(t),writing=deferred(),release=deferred();let held=false;
 h.setWrite(async(key)=>{if(!held&&key.includes('runtime-replays')){held=true;writing.resolve();await release.promise;}});
 const work=startReplay(h);await writing.promise;const r=h.replayState().replays[0];
 await h.replayAction('cancel',{id:r.id,executionId:r.executionId});release.resolve();await work;
 assert.equal(h.replayState().replays[0].status,'cancelled');assert.equal(h.replayState().replays[0].prepare.effects,'not-started');
 assert.equal(h.calls.filter(c=>c[0]==='replay').length,0);
});

test('an old execution identifier cannot cancel current work',async t=>{
 const h=await ready(t),started=deferred();
 h.setReplay(async(input,{onProgress,signal})=>{await onProgress({phase:'prepare',status:'running'});started.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {status:'cancelled',reason:'cancelled'};});
 const work=startReplay(h);await started.promise;const r=h.replayState().replays[0];
 await assert.rejects(h.replayAction('cancel',{id:r.id,executionId:'9'.repeat(32)}),/active replay/);
 assert.equal(h.host.runtimeReplayTask.controller.signal.aborted,false);
 await h.replayAction('cancel',{id:r.id,executionId:r.executionId});await work;
});

test('new unsaved draft membership stops later dispatch without saving the draft',async t=>{
 const h=await ready(t);
 h.setReplay(async(input,{onProgress})=>{await onProgress({phase:'prepare',status:'running'});await onProgress({phase:'prepare',status:'completed'});
  h.host.dirtyPaths=()=>['src/Button.tsx'];await onProgress({phase:'step',stepId:'save',status:'running'});return {status:'completed'};
 });
 await startReplay(h);const r=h.replayState().replays[0];assert.equal(r.status,'interrupted');assert.equal(r.reason,'source-changed');assert.equal(r.steps[0].effects,'not-started');
 assert.deepEqual(h.host.dirtyPaths(),['src/Button.tsx']);assert.equal(h.sources.get('src/Button.tsx').source,'export const example = true;\n');
});

test('replay storage remains recoverable after the containing observation is cancelled',async t=>{
 const h=await ready(t);let fail=true;
 h.setWrite(async(key)=>{if(fail&&key.includes('runtime-replays'))throw Error('disk');});await startReplay(h);
 await h.action('cancelRun',{id:active(h).id});assert.equal(h.raw().runs[0].status,'cancelled');assert.equal(h.replayState().storage.status,'error');
 fail=false;await h.replayAction('retry');assert.equal(h.replayState().replays[0].status,'interrupted');assert.equal(h.calls.filter(c=>c[0]==='replay').length,0);
});

test('saved context is checked after a completed runtime response before sealing success',async t=>{
 const h=await ready(t);h.setReplay(async(input,{onProgress})=>{
  for(const unit of [{phase:'prepare'},{phase:'step',stepId:'save'},{phase:'step',stepId:'settle'}]){await onProgress({...unit,status:'running'});await onProgress({...unit,status:'completed'});}
  h.host.featureSourceEpoch++;return {status:'completed'};
 });await startReplay(h);const r=h.replayState().replays[0];assert.equal(r.status,'interrupted');assert.equal(r.reason,'source-changed');assert.ok(r.steps.every(s=>s.status==='completed'));
 assert.equal(h.raw().runs[0].assessment,'not-assessed');
});


test('bounded adapter failure reasons retain their specific cause in local history',async t=>{
 for(const [reason,expected] of [['callback-failed','step-failed'],['unit-timeout','timeout'],['registration-changed','recipe-changed'],['conditions-changed','preview-changed']]){
  const h=await ready(t);h.setReplay(async(input,{onProgress})=>{await onProgress({phase:'prepare',status:'running'});return {status:reason==='callback-failed'?'failed':'interrupted',reason};});
  await startReplay(h);assert.equal(h.replayState().replays[0].reason,expected);assert.equal(h.raw().runs[0].assessment,'not-assessed');
 }
});
