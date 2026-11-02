import { mockDisplaySources } from './helpers/display-source-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.FOUNDATION_SCENARIO_HOST_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const projectRequire = createRequire(join(root, 'package.json')), ts = projectRequire('typescript');
const featureStoreModule = await import(join(root, 'desktop/extension/src/feature-store.mjs'));
const runtimeWorkspaceModule = await import(join(root, 'desktop/extension/src/runtime-workspace-store.mjs'));
const captureStoreModule = await import(join(root, 'desktop/extension/src/runtime-capture-store.mjs'));
const matrixStoreModule = await import(join(root, 'desktop/extension/src/runtime-matrix-store.mjs'));
const runtimeStateSuiteModule = await import(join(root, 'desktop/extension/src/runtime-state-suite-store.mjs'));
const replayStoreModule = await import(join(root, 'desktop/extension/src/runtime-replay-store.mjs'));
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
  let readHook, writeHook, discoverHook, navigateHook, startHook, replayHook, captureHook, previewHook, viewCounter = 3;
  const captureRecords = []; let requestedConditions = {theme:'light',motion:'system',viewportWidthCss:960,viewportHeightCss:680};
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
      for(const unit of [{phase:'prepare'}, ...runtimeState.replayCatalog.recipes.find(recipe=>recipe.id===input.recipeId).steps.map(step=>({phase:'step',stepId:step.id}))]) {
        if(options.signal.aborted)return {status:'cancelled',reason:'cancelled'};
        await options.onProgress({...unit,status:'running'});
        if(options.signal.aborted)return {status:'cancelled',reason:'cancelled'};
        calls.push(['dispatch',unit.phase,...(unit.stepId?[unit.stepId]:[])]);
        await options.onProgress({...unit,status:'completed',observed:{viewportWidthCss:960,viewportHeightCss:680,deviceScaleFactor:2,colorSchemePreference:'light',reducedMotionPreference:'no-preference',viewportWidthCss:input.requested.viewportWidthCss}});
      }
      return {status:'completed'};
    },
    discover: async () => { calls.push(['discover']); if (discoverHook) await discoverHook(); return [{ id: 'vite:dev', root: project.root, available: true, instrumented: true }]; },
    start: async id => { calls.push(['start', id]); if (startHook) await startHook(); runtimeState.status = 'connected'; runtimeState.target = { id, root: project.root }; return structuredClone(runtimeState); },
    navigate: async route => { calls.push(['navigate', route]); if (navigateHook) await navigateHook(); runtimeState.viewId = String(++viewCounter).padStart(32, '0'); runtimeState.pageConnected = true; runtimeState.documentId = String(viewCounter+100).padStart(32,'0'); runtimeState.pagePath = route; runtimeState.replayCatalog.registrationId = String(viewCounter+200).padStart(32,'0'); runtimeState.url = `http://127.0.0.1:4173${route}`; runtimeState.observations = []; return structuredClone(runtimeState); },
    dispose: async () => { calls.push(['dispose']); },
  };
  const vscode = { workspace: { isTrusted: true, textDocuments: [] }, Uri: { file: fsPath => ({ fsPath, scheme: 'file', toString: () => `file://${fsPath}` }) } };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Buffer, URL, AbortController, TextDecoder, setTimeout, clearTimeout, structuredClone,
    fetch() { throw new Error('A scenario must never send an AI or remote-provider request'); },
    require: name => name === 'vscode' ? vscode : name.includes('runtime-capture-store') ? captureStoreModule : name.includes('runtime-state-suite-store') ? runtimeStateSuiteModule : name.includes('runtime-matrix-store') ? matrixStoreModule : name.includes('runtime-replay-store') ? replayStoreModule : name.includes('runtime-workspace-store') ? runtimeWorkspaceModule : name.includes('feature-store') ? featureStoreModule : name.includes('safety') ? safety : name.startsWith('node:') ? projectRequire(name) : {},
  });
  const host = Object.create(module.exports.FoundationHost.prototype);
  Object.assign(host, {
    context: { workspaceState: { get: key => persisted.get(key), update: async (key, value) => { if (writeHook) await writeHook(key, value); persisted.set(key, structuredClone(value)); writes.push({ key, value: structuredClone(value) }); } } },
    project: structuredClone(project), openFiles: [], featureFiles: [], featureUnavailable: [], featureStores: new Map(), runtimeWorkspaceStores: new Map(),
    service: { getFiles: mockDisplaySources, getFile: async (id, path) => { reads.push({ id, path }); if (readHook) return readHook(id, path); if (!sources.has(path)) throw new Error('Missing source'); return structuredClone(sources.get(path)); } },
    runtime, runtimeRoot: project.root, runtimeGeneration: 1, runtimeFrameOrigin: 'http://127.0.0.1:4173', runtimeSelectionKey: '',
    featureLoadGeneration: 0, featureSourceEpoch: 0, featureCacheKey: '', featureLoadKey: '', disposed: false,
    mode:'Refine', nativeCaptureAvailable:true, panel:{visible:true,webview:{postMessage: async value=>{
      messages.push(structuredClone(value));
      if(value.type==='runtimeMatrixPreview') {
        requestedConditions={...value.requested};
        if(previewHook)await previewHook(value);
        else setImmediate(()=>void host.runtimeMatrixAction({...value,action:'previewReady',id:value.id||value.matrixId}));
      }
      return true;
    }}},
    generation: 0, focusGeneration: 0, askGeneration: 0,
    dirtyPaths: () => [], queueConversationState() {}, updateTree() {},
    show: mode => { host.mode=mode;calls.push(['show', mode]); }, sendState() { states.push({ projectId: this.project?.id }); },
  });
  host.runtimeCaptureStorage = () => ({ files:{availableBytes:()=>128*1024*1024}, store:{
    snapshot:()=>({schemaVersion:1,projectId:project.id,revision:captureRecords.length,captures:structuredClone(captureRecords),storage:{status:'saved'}}),
    reconcile:()=>({schemaVersion:1,projectId:project.id,revision:captureRecords.length,captures:structuredClone(captureRecords),storage:{status:'saved'}}),
  }});
  host.captureScenarioImage=async capture=>{
    calls.push(['capture',capture.run.id]);if(captureHook)return captureHook(capture);
    const run=capture.run, value={id:randomUUID(),runId:run.id,featureId:run.feature.id,screenId:run.screen.id,scenarioId:run.scenario.id,
      binding:{startedAt:run.startedAt,definitionRevision:run.definitionRevision,runtime:run.runtime,sources:run.sources,dirtyPaths:run.dirtyPaths},sourceRelationship:'unverified',conditions:{...requestedConditions}};
    captureRecords.push(value);return value;
  };
  const h = { host, captureRecords, get requested(){return requestedConditions;},
    matrixState:()=>host.runtimeMatrixSnapshot(),
    matrixAction:(action,fields={})=>host.runtimeMatrixAction({action,projectId:host.project?.id,expectedRevision:host.runtimeMatrixStore().snapshot().revision,...fields}),
    setPreview:hook=>{previewHook=hook;}, setCapture:hook=>{captureHook=hook;}, runtimeState, runtime, vscode, persisted, writes, reads, calls, messages, states, sources,
    setReplay: hook => {replayHook=hook;},
    replayState: () => host.runtimeReplaySnapshot(),
    replayAction: (action, fields={}) => host.runtimeReplayAction({action,projectId:host.project.id,expectedRevision:host.runtimeReplayStore().snapshot().revision, ...fields}),
    setRead: hook => { readHook = hook; }, setWrite: hook => { writeHook = hook; }, setDiscover: hook => { discoverHook = hook; }, setNavigate: hook => { navigateHook = hook; }, setStart: hook => { startHook = hook; },
    state: () => structuredClone(host.runtimeWorkspaceSnapshot()), raw: () => host.runtimeWorkspaceStore().snapshot(),
    action: (action, fields = {}) => host.runtimeWorkspaceAction({ action, projectId: host.project?.id, expectedRevision: host.runtimeWorkspaceStore().snapshot().revision, ...fields }),
  };
  t.after(async () => { writeHook = undefined; host.interruptRuntimeMatrix?.('cancelled'); await host.runtimeMatrixTask?.done?.catch(()=>{}); await host.endScenarioRun('cancelled').catch(() => {}); host.disposed = true; await Promise.all([...host.featureStores.values(), ...host.runtimeWorkspaceStores.values(), ...(host.runtimeReplayStores?.values()||[]),...(host.runtimeMatrixStores?.values()||[]),...(host.runtimeStateSuiteStores?.values()||[])].map(store => store.dispose())); });
  return h;
}
async function setup(t) {
  const h = harness(t);
  await h.host.featureAction({ action: 'create', projectId: project.id, expectedRevision: 0, input: { title: 'Save profile', brief: 'Inspect saved behavior.', paths: ['src/Button.tsx'], entryPath: 'src/Button.tsx' } });
  await h.action('createScreen', { input: { title: 'Profile', targetId: 'vite:dev', route: '/profile' } });
  const screen = h.raw().screens[0];
  await h.action('createScenario', { input: { screenId: screen.id, title: 'Save', steps: ['Press Save.'], expectedOutcome: 'Saving returns to an editable state.' } });
  return Object.assign(h, { screen, scenario: h.raw().scenarios[0], feature: h.host.featureSnapshot() });
}

const requested=(width=960,theme='light',motion='system')=>({theme,motion,viewportWidthCss:width,viewportHeightCss:680});
const matrix=h=>h.matrixState().matrices.at(-1);
const startMatrix=(h,conditions=[requested(),requested(390)],extra={})=>h.matrixAction('start',{
 featureId:h.feature.activeId,featureRevision:h.feature.revision,
 screenId:h.screen.id,scenarioId:h.scenario.id,workspaceRevision:h.raw().revision,
 recipeId:'save-success',catalogDigest:h.runtimeState.replayCatalog.digest,registrationId:h.runtimeState.replayCatalog.registrationId,
 requested:conditions,captureEach:false,...extra,
});
const stopMatrix=h=>h.matrixAction('cancel',{id:matrix(h).id,executionId:matrix(h).executionId});
const observations=h=>h.raw().runs;
const waitFor=async(check,label)=>{for(let i=0;i<250;i++){const value=check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,4));}throw Error('Timed out '+label);};

test('matrix explicitly records independent cells in fresh documents with no automatic assessment',async t=>{
 const h=await setup(t);let navigations=0;
 h.setNavigate(()=>{const record=matrix(h);assert.ok(record);assert.ok(record.cells[navigations].runId);assert.ok(record.cells[navigations].replayExecutionId);assert.equal(record.cells[navigations].status,'running');navigations++;});
 await startMatrix(h);const record=matrix(h);assert.equal(record.status,'completed');assert.equal(record.cells.length,2);
 assert.ok(record.cells.every(cell=>cell.status==='completed'&&cell.observationLinked&&cell.replayId&&!cell.captureId));
 assert.equal(navigations,2);assert.equal(observations(h).length,2);assert.equal(h.replayState().replays.length,2);
 assert.equal(new Set(observations(h).map(run=>run.runtime.documentId)).size,2);assert.equal(new Set(observations(h).map(run=>run.runtime.viewId)).size,2);
 assert.ok(observations(h).every(run=>run.assessment==='not-assessed'&&run.status==='completed'));
 assert.equal(h.calls.filter(call=>call[0]==='capture').length,0);assert.equal(h.matrixState().busy,false);assert.ok(!h.matrixState().preview);
 for(const cell of record.cells){const run=observations(h).find(run=>run.id===cell.runId),replay=h.replayState().replays.find(replay=>replay.id===cell.replayId);assert.ok(run);assert.equal(replay.executionId,cell.replayExecutionId);assert.deepEqual(replay.requested,cell.requested);assert.equal(replay.sourceRelationship,'unverified');}
});

test('opted-in captures bind each cell to its own observation and replay',async t=>{
 const h=await setup(t);await startMatrix(h,[requested(),requested(390)],{captureEach:true});
 assert.equal(matrix(h).status,'completed');assert.equal(h.captureRecords.length,2);
 for(const cell of matrix(h).cells){const image=h.captureRecords.find(value=>value.id===cell.captureId);assert.equal(image.runId,cell.runId);assert.deepEqual(image.binding.runtime,observations(h).find(run=>run.id===cell.runId).runtime);}
});

test('Stop during preview preparation dispatches no callback and leaves later cells unrun',async t=>{
 const h=await setup(t),gate=deferred();h.setPreview(()=>gate.resolve());const running=startMatrix(h);await gate.promise;await stopMatrix(h);await running;
 assert.equal(matrix(h).status,'cancelled');assert.equal(matrix(h).cells[1].status,'not-run');assert.equal(h.calls.filter(c=>c[0]==='replay').length,0);assert.equal(h.matrixState().busy,false);
});

test('Stop during a callback cancels the exact execution and does not start another cell',async t=>{
 const h=await setup(t),gate=deferred();h.setReplay(async(input,{onProgress,signal})=>{await onProgress({phase:'prepare',status:'running'});gate.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {status:'cancelled',reason:'cancelled'};});
 const running=startMatrix(h);await gate.promise;await stopMatrix(h);await running;
 assert.equal(matrix(h).status,'cancelled');assert.equal(matrix(h).cells[1].status,'not-run');assert.equal(h.calls.filter(c=>c[0]==='replay').length,1);assert.equal(h.replayState().replays[0].status,'cancelled');assert.equal(observations(h)[0].assessment,'not-assessed');
});

test('a failed native capture stops the matrix without classifying it as a completed visual result',async t=>{
 const h=await setup(t);h.setCapture(()=>{throw Error('Capture refused');});await startMatrix(h,undefined,{captureEach:true});
 assert.notEqual(matrix(h).status,'completed');assert.equal(matrix(h).cells[1].status,'not-run');assert.equal(h.captureRecords.length,0);assert.equal(h.replayState().replays[0].status,'completed');assert.ok(!matrix(h).cells[0].captureId);
});

test('changing source between conditions invalidates the whole matrix',async t=>{
 const h=await setup(t);let calls=0;h.setNavigate(()=>{if(++calls===2)h.sources.set('src/Button.tsx',file('src/Button.tsx','export const changed=true;'));});await startMatrix(h);
 assert.notEqual(matrix(h).status,'completed');assert.equal(h.calls.filter(c=>c[0]==='replay').length,1);assert.equal(matrix(h).cells[0].status,'completed');
});

test('changed catalog after reload refuses execution despite stable recipe id',async t=>{
 const h=await setup(t);h.setNavigate(()=>{h.runtimeState.replayCatalog.digest='f'.repeat(64);});await startMatrix(h);
 assert.notEqual(matrix(h).status,'completed');assert.equal(h.calls.filter(c=>c[0]==='replay').length,0);assert.equal(matrix(h).cells[1].status,'not-run');
});

test('public commands and forged matrix ownership cannot compete with the active runner',async t=>{
 const h=await setup(t),gate=deferred();h.setPreview(()=>gate.resolve());const running=startMatrix(h);await gate.promise;
 await assert.rejects(h.action('beginRun',{scenarioId:h.scenario.id}),/matrix/i);
 await assert.rejects(h.replayAction('start',{matrixId:matrix(h).id}),/matrix/i);
 await assert.rejects(h.matrixAction('cancel',{id:matrix(h).id,executionId:'f'.repeat(32)}),/active|matrix/i);
 await stopMatrix(h);await running;assert.equal(h.calls.filter(c=>c[0]==='replay').length,0);
});

test('foreign or stale preview acknowledgments never authorize callbacks',async t=>{
 const h=await setup(t),gate=deferred();let message;h.setPreview(value=>{message=value;gate.resolve();});const running=startMatrix(h);await gate.promise;
 for(const patch of [{nonce:'f'.repeat(32)},{projectId:'foreign'},{cellId:'foreign'},{requested:requested(768,'dark')},{identity:{...message.identity,viewId:'f'.repeat(32)}}])await h.host.runtimeMatrixAction({...message,action:'previewReady',id:message.id||message.matrixId,...patch}).catch(()=>{});
 await tick();assert.equal(h.calls.filter(c=>c[0]==='replay').length,0);await stopMatrix(h);await running;
});

test('failed initial matrix persistence prevents navigation and recipe execution; Retry never runs work',async t=>{
 const h=await setup(t);h.setWrite((key)=>{if(key.includes('runtime-matr'))throw Error('Disk unavailable');});
 await startMatrix(h).catch(()=>{});assert.equal(h.calls.filter(c=>c[0]==='navigate'||c[0]==='replay').length,0);
 h.setWrite(undefined);await h.matrixAction('retry');assert.equal(h.calls.filter(c=>c[0]==='navigate'||c[0]==='replay').length,0);assert.equal(h.matrixState().storage.status,'saved');assert.ok(h.matrixState().matrices.every(m=>m.status!=='running'));
});

test('invalid or duplicate condition choices never create or dispatch a matrix',async t=>{
 const h=await setup(t);for(const values of [[],[requested(500)],[requested(),requested()],Array.from({length:13},()=>requested())])await startMatrix(h,values).catch(()=>{});
 assert.equal(h.calls.filter(c=>c[0]==='navigate'||c[0]==='replay').length,0);assert.equal(h.matrixState().matrices.length,0);
});

test('a current manual observation cannot be silently consumed by a matrix',async t=>{
 const h=await setup(t);await h.action('beginRun',{scenarioId:h.scenario.id});const run=structuredClone(h.raw().runs[0]);await startMatrix(h).catch(()=>{});
 assert.deepEqual(h.raw().runs[0],run);assert.equal(h.calls.filter(c=>c[0]==='navigate'||c[0]==='replay').length,0);
});

test('untrusted, hidden and stale selected scopes cannot start work',async t=>{
 const h=await setup(t);h.vscode.workspace.isTrusted=false;await startMatrix(h).catch(()=>{});h.vscode.workspace.isTrusted=true;
 h.host.panel.visible=false;await startMatrix(h).catch(()=>{});h.host.panel.visible=true;
 await startMatrix(h,undefined,{featureRevision:999}).catch(()=>{});await startMatrix(h,undefined,{workspaceRevision:999}).catch(()=>{});await startMatrix(h,undefined,{registrationId:'f'.repeat(32)}).catch(()=>{});
 assert.equal(h.calls.filter(c=>c[0]==='navigate'||c[0]==='replay').length,0);
});

test('no matrix begins when its complete observation budget cannot fit',async t=>{
 const h=await setup(t),store=h.host.runtimeWorkspaceStore(),original=store.snapshot.bind(store);
 h.host.runtimeWorkspaceStore=()=>({...store,snapshot:()=>{const value=original();return {...value,runs:Array.from({length:39},(_,n)=>({id:`prior-${n}`,status:'completed'}))};}});
 await startMatrix(h).catch(()=>{});assert.equal(h.calls.filter(c=>c[0]==='navigate'||c[0]==='replay').length,0);
});

test('capture quota is checked before any cell begins and includes actual file usage',async t=>{
 const h=await setup(t),previous=h.host.runtimeCaptureStorage;h.host.runtimeCaptureStorage=()=>({...previous(),files:{availableBytes:()=>1}});
 await startMatrix(h,undefined,{captureEach:true}).catch(()=>{});assert.equal(h.calls.filter(c=>c[0]==='navigate'||c[0]==='replay'||c[0]==='capture').length,0);
});

test('a callback failure seals its own evidence and leaves later requested conditions unrun',async t=>{
 const h=await setup(t);h.setReplay(async(input,{onProgress})=>{await onProgress({phase:'prepare',status:'running'});return {status:'failed',reason:'callback-failed'};});
 await startMatrix(h);assert.notEqual(matrix(h).status,'completed');assert.equal(matrix(h).cells[1].status,'not-run');assert.equal(h.replayState().replays[0].status,'failed');assert.equal(h.calls.filter(c=>c[0]==='replay').length,1);assert.equal(observations(h)[0].assessment,'not-assessed');
});

test('Stop while capture is in flight cannot dispatch the next condition',async t=>{
 const h=await setup(t),entered=deferred(),release=deferred();h.setCapture(async()=>{entered.resolve();await release.promise;throw Error('Capture no longer current');});
 const work=startMatrix(h,undefined,{captureEach:true});await entered.promise;await stopMatrix(h);release.resolve();await work;
 assert.equal(matrix(h).status,'cancelled');assert.equal(matrix(h).cells[1].status,'not-run');assert.equal(h.calls.filter(c=>c[0]==='replay').length,1);
});

test('a new host restores terminal matrix metadata without navigation, callbacks, or recapture',async t=>{
 const h=await setup(t);await startMatrix(h);const saved=structuredClone(matrix(h));const restored=harness(t,h.persisted);
 assert.deepEqual(restored.matrixState().matrices[0],saved);assert.equal(restored.calls.length,0);assert.equal(restored.matrixState().busy,false);
});

test('an external project change during preview preparation interrupts without starting callbacks',async t=>{
 const h=await setup(t),entered=deferred();h.setPreview(value=>{entered.resolve(value);});const work=startMatrix(h);await entered.promise;
 h.host.project={...project,id:'different-project'};h.host.interruptRuntimeMatrix('context-changed');await work;
 const old=h.host.runtimeMatrixStores.get(project.id).snapshot().matrices[0];assert.equal(old.status,'interrupted');assert.equal(old.cells[1].status,'not-run');assert.equal(h.calls.filter(c=>c[0]==='replay').length,0);
});

test('each matrix observation consumes the fresh authenticated request response before finishing',async t=>{
 const h=await setup(t);h.runtime.readCurrent=async()=>{const live=structuredClone(h.runtimeState);if(h.host.scenarioCapture){live.observations=[{id:`${live.session}:${live.viewId}:1`,session:live.session,documentId:live.documentId,kind:'request',method:'POST',url:'http://127.0.0.1:4173/api/profile',status:200,durationMs:12.5,outcome:'success',observedAt:new Date().toISOString(),timing:'response-headers',correlation:'unattributed'}];}return live;};
 await startMatrix(h);assert.equal(matrix(h).status,'completed');assert.equal(h.runtimeState.observations.length,0);
 for(const run of observations(h)){assert.equal(run.observations.length,1);assert.equal(run.observations[0].documentId,run.runtime.documentId);assert.equal(run.observations[0].correlation,'unattributed');assert.equal(run.assessment,'not-assessed');}
});

test('a lost observation-write acknowledgment recovers its reserved identity without executing a recipe',async t=>{
 const h=await setup(t);let failed=false;h.setWrite((key,value)=>{if(!failed&&key.includes('runtime-workspace')&&value.runs?.some(run=>run.status==='recording')){failed=true;h.persisted.set(key,structuredClone(value));throw Error('Acknowledgment lost');}});
 await startMatrix(h);assert.equal(failed,true);assert.equal(h.calls.filter(c=>c[0]==='replay').length,0);h.setWrite(undefined);await h.matrixAction('retry');
 const cell=matrix(h).cells[0];assert.equal(cell.observationLinked,true);assert.equal(observations(h)[0].id,cell.runId);assert.equal(observations(h)[0].status,'interrupted');assert.equal(matrix(h).status,'interrupted');assert.equal(matrix(h).cells[1].status,'not-run');assert.equal(h.calls.filter(c=>c[0]==='replay').length,0);
});

test('a lost replay-link acknowledgment retries only storage and preserves the interrupted outcome',async t=>{
 const h=await setup(t);let failed=false;h.setWrite((key,value)=>{if(!failed&&key.includes('runtime-matrices')&&value.matrices?.[0]?.cells[0].replayId){failed=true;h.persisted.set(key,structuredClone(value));throw Error('Acknowledgment lost');}});
 await startMatrix(h);assert.equal(failed,true);assert.equal(h.calls.filter(c=>c[0]==='replay').length,1);h.setWrite(undefined);await h.matrixAction('retry');
 const cell=matrix(h).cells[0];assert.equal(cell.replayId,h.replayState().replays[0].id);assert.equal(matrix(h).status,'interrupted');assert.equal(cell.status,'interrupted');assert.equal(matrix(h).cells[1].status,'not-run');assert.equal(h.calls.filter(c=>c[0]==='replay').length,1);
});

test('storage recovery owns the host until it settles and cannot race a new Start',async t=>{
 const h=await setup(t);h.setWrite(key=>{if(key.includes('runtime-matrices'))throw Error('Disk unavailable');});await startMatrix(h);
 const entered=deferred(),release=deferred();h.setWrite(async key=>{if(key.includes('runtime-matrices')){entered.resolve();await release.promise;}});
 const recovery=h.matrixAction('retry');await entered.promise;
 try {
  assert.equal(h.matrixState().busy,true);assert.equal(h.matrixState().preview,undefined);
  await assert.rejects(startMatrix(h),/active matrix action/i);await assert.rejects(h.matrixAction('retry'),/active matrix action/i);
  assert.equal(h.calls.filter(c=>c[0]==='navigate'||c[0]==='replay').length,0);
 } finally {release.resolve();await recovery;}
 assert.equal(h.matrixState().busy,false);assert.equal(matrix(h).status,'interrupted');
});

test('cold recovery opens exact capture storage and rejects a different viewport before linking',async t=>{
 const h=await setup(t);let failed=false;
 h.setWrite((key,value)=>{if(!failed&&key.includes('runtime-matrices')&&value.matrices?.[0]?.cells[0].captureId){failed=true;throw Error('Capture link not saved');}});
 await startMatrix(h,undefined,{captureEach:true});assert.equal(failed,true);h.setWrite(undefined);
 const restored=harness(t,h.persisted);restored.matrixState();restored.raw();await tick();
 const image=structuredClone(h.captureRecords[0]),width=image.conditions.viewportWidthCss;let opens=0,reads=0;
 image.conditions.viewportWidthCss=width===960?390:960;
 restored.host.runtimeCaptureStorage=()=>{opens++;return {store:{reconcile:()=>({captures:[structuredClone(image)]}),readCapture:async id=>{assert.equal(id,image.id);reads++;return {capture:structuredClone(image)};}}};};
 await restored.matrixAction('retry');let saved=matrix(restored);assert.equal(saved.cells[0].captureId,undefined);assert.equal(reads,0);assert.ok(opens>0);
 image.conditions.viewportWidthCss=width;await restored.matrixAction('retry');saved=matrix(restored);
 assert.equal(saved.cells[0].captureId,image.id);assert.equal(saved.status,'interrupted');assert.equal(saved.cells[0].status,'interrupted');assert.equal(saved.cells[1].status,'not-run');assert.equal(reads,1);assert.equal(restored.calls.length,0);
});


test('Stop owns the visible initial write-ahead matrix before its save acknowledgment',async t=>{
 const h=await setup(t),entered=deferred(),release=deferred();
 h.setWrite(async (key,value)=>{if(key.includes('runtime-matrices')&&value.matrices[0]?.status==='running'&&value.matrices[0].cells.every(cell=>cell.status==='not-run')){entered.resolve();await release.promise;}});
 const work=startMatrix(h);await entered.promise;
 try {
  assert.equal(matrix(h).status,'running');assert.equal(h.matrixState().storage.status,'saving');
  await assert.rejects(h.matrixAction('cancel',{id:matrix(h).id,executionId:'f'.repeat(32)}),/active matrix/i);
  await stopMatrix(h);assert.equal(h.host.runtimeMatrixTask.controller.signal.aborted,true);
 } finally {release.resolve();await work;}
 assert.equal(matrix(h).status,'cancelled');assert.equal(matrix(h).cells.every(cell=>cell.status==='not-run'),true);
 assert.equal(h.calls.filter(c=>['navigate','replay','capture'].includes(c[0])).length,0);
});


test('Cancel requires exact identities while source preflight has no reserved matrix yet',async t=>{
 const h=await setup(t),entered=deferred(),release=deferred();let held=false;
 h.setRead(async (_id,path)=>{if(!held){held=true;entered.resolve();await release.promise;}return structuredClone(h.sources.get(path));});
 const work=startMatrix(h,[requested()]);await entered.promise;
 try {
  assert.equal(matrix(h),undefined);await assert.rejects(h.matrixAction('cancel'),/active matrix/i);
  assert.equal(h.host.runtimeMatrixTask.controller.signal.aborted,false);
 } finally {release.resolve();await work;}
 assert.equal(matrix(h).status,'completed');
});


const suiteStates=['idle','loading','success','error','offline'];
function addSuiteRecipes(h) {
 h.runtimeState.replayCatalog.recipes.push(...suiteStates.map(state=>({id:'state-'+state,title:state+' fixture',route:'/profile',
  fixture:{id:state+'-fixture-v1',label:'Explicit '+state+' fixture'},steps:[{id:'show-'+state,title:'Show '+state}]})));
}
const saveSuite=(h,extra={})=>h.host.runtimeStateSuiteAction({action:'save',projectId:project.id,
 expectedRevision:h.host.runtimeStateSuiteStore().snapshot().revision,title:'Save states',featureId:h.feature.activeId,featureRevision:h.feature.revision,
 screenId:h.screen.id,scenarioId:h.scenario.id,workspaceRevision:h.raw().revision,
 states:[{state:'idle',recipeId:'state-idle'},{state:'error',recipeId:'state-error'}],
 requested:[requested(),requested(390)],captureEach:false,
 catalogDigest:h.runtimeState.replayCatalog.digest,registrationId:h.runtimeState.replayCatalog.registrationId,...extra});
const startSuite=(h,suite,extra={})=>h.matrixAction('start',{featureId:h.feature.activeId,featureRevision:h.feature.revision,
 screenId:h.screen.id,scenarioId:h.scenario.id,workspaceRevision:h.raw().revision,
 suiteId:suite.id,suiteRevision:suite.revision,suiteStoreRevision:h.host.runtimeStateSuiteStore().snapshot().revision,
 catalogDigest:h.runtimeState.replayCatalog.digest,registrationId:h.runtimeState.replayCatalog.registrationId,...extra});
async function setupSuite(t) {const h=await setup(t);addSuiteRecipes(h);const suite=await saveSuite(h);return {...h,suite};}

test('named state suites save explicit app recipes without executing or assessing them',async t=>{
 const h=await setupSuite(t),saved=h.host.runtimeStateSuiteSnapshot();
 assert.equal(saved.suites.length,1);assert.equal(h.suite.revision,1);assert.deepEqual(h.suite.states.map(row=>row.state),['idle','error']);
 assert.ok(h.suite.states.every(row=>!Object.hasOwn(row.recipe,'registrationId')&&row.recipe.catalogDigest===h.runtimeState.replayCatalog.digest));
 assert.equal(h.calls.filter(call=>['navigate','replay','capture'].includes(call[0])).length,0);assert.equal(h.matrixState().matrices.length,0);assert.equal(observations(h).length,0);
 assert.equal(h.suite.states[1].recipe.fixture.id,'error-fixture-v1');
});

test('suite execution records each explicit state and common condition with exact independent evidence',async t=>{
 const h=await setupSuite(t);await startSuite(h,h.suite,{requested:[requested(768)],captureEach:true,recipeId:'save-success'});
 const record=matrix(h);assert.equal(record.status,'completed');assert.equal(record.basis.suite.id,h.suite.id);assert.equal(record.captureEach,false);
 assert.deepEqual(record.cells.map(cell=>cell.state),['idle','idle','error','error']);
 assert.deepEqual(h.calls.filter(call=>call[0]==='replay').map(call=>call[1].recipeId),['state-idle','state-idle','state-error','state-error']);
 assert.equal(new Set(observations(h).map(run=>run.runtime.documentId)).size,4);
 for(const cell of record.cells){const run=observations(h).find(run=>run.id===cell.runId),replay=h.replayState().replays.find(item=>item.id===cell.replayId),row=record.basis.suite.states.find(item=>item.state===cell.state);
  assert.equal(run.assessment,'not-assessed');assert.deepEqual(run.sources,record.basis.sources);assert.deepEqual(replay.recipe,{...row.recipe,registrationId:replay.recipe.registrationId});assert.deepEqual(replay.requested,cell.requested);}
 assert.equal(h.captureRecords.length,0);
});

test('suite admission refuses stale definitions, future recipe metadata, or oversized total conditions before any work',async t=>{
 const h=await setupSuite(t);
 for(const extra of [{suiteRevision:0},{suiteStoreRevision:0},{screenId:randomUUID()},{catalogDigest:'a'.repeat(64)}])await assert.rejects(startSuite(h,h.suite,extra));
 h.runtimeState.replayCatalog.recipes.find(recipe=>recipe.id==='state-error').fixture.label='Changed fixture';
 await assert.rejects(startSuite(h,h.suite),/recipe/i);
 await assert.rejects(saveSuite(h,{states:suiteStates.map(state=>({state,recipeId:'state-'+state})),requested:[requested(),requested(390),requested(768)]}),/twelve/i);
 assert.equal(h.matrixState().matrices.length,0);assert.equal(h.calls.filter(call=>['navigate','replay','capture'].includes(call[0])).length,0);
});

test('every fresh suite document verifies later recipes before dispatching the first state',async t=>{
 const h=await setupSuite(t);h.setNavigate(()=>{h.runtimeState.replayCatalog.recipes.find(recipe=>recipe.id==='state-error').steps[0].title='Changed later state';});
 await startSuite(h,h.suite);assert.equal(matrix(h).status,'interrupted');assert.equal(matrix(h).reason,'recipe-changed');
 assert.equal(h.calls.filter(call=>call[0]==='replay').length,0);assert.ok(matrix(h).cells.slice(1).every(cell=>cell.status==='not-run'));
});

test('suite edits keep prior evidence frozen and require the exact saved definition revision',async t=>{
 const h=await setupSuite(t);await startSuite(h,h.suite);const frozen=structuredClone(matrix(h));
 const updated=await saveSuite(h,{id:h.suite.id,suiteRevision:h.suite.revision,title:'Renamed states',requested:[requested()]});
 assert.equal(updated.revision,2);assert.deepEqual(matrix(h),frozen);assert.equal(frozen.basis.suite.title,'Save states');
 await assert.rejects(saveSuite(h,{id:h.suite.id,suiteRevision:1}),/changed/i);
 await assert.rejects(startSuite(h,h.suite),/saved state suite/i);
});

test('Stop in a later state preserves earlier evidence and leaves all following cells unrun',async t=>{
 const h=await setupSuite(t),gate=deferred();h.setReplay(async(input,{onProgress,signal})=>{
  await onProgress({phase:'prepare',status:'running'});await onProgress({phase:'prepare',status:'completed'});
  if(input.recipeId==='state-error'){gate.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {status:'cancelled',reason:'cancelled'};}
  await onProgress({phase:'step',stepId:'show-idle',status:'running'});await onProgress({phase:'step',stepId:'show-idle',status:'completed'});return {status:'completed'};
 });
 const running=startSuite(h,h.suite);await gate.promise;
 await assert.rejects(saveSuite(h,{id:h.suite.id,suiteRevision:1}),/active suite|matrix/i);
 await stopMatrix(h);await running;
 assert.deepEqual(matrix(h).cells.map(cell=>cell.status),['completed','completed','cancelled','not-run']);
 assert.equal(h.calls.filter(call=>call[0]==='replay').length,3);assert.ok(observations(h).every(run=>run.assessment==='not-assessed'));
});

test('suite capacity preflight reserves evidence for all states before opening any document',async t=>{
 const h=await setupSuite(t),workspace=h.host.runtimeWorkspaceStore(),snapshot=workspace.snapshot.bind(workspace);
 h.host.runtimeWorkspaceStore=()=>({...workspace,snapshot:()=>({...snapshot(),runs:Array.from({length:37},(_,i)=>({id:'existing-'+i,status:'completed'}))})});
 await startSuite(h,h.suite);assert.equal(h.matrixState().matrices.length,0);assert.equal(h.calls.filter(call=>['navigate','replay','capture'].includes(call[0])).length,0);assert.match(h.matrixState().error,/capacity/i);
});

test('suite save owns its busy interval and persistence retry never executes app actions',async t=>{
 const h=await setup(t);addSuiteRecipes(h);const gate=deferred(),release=deferred();
 h.setWrite(async key=>{if(key.includes('runtime-state-suites')){gate.resolve();await release.promise;}});
 const saving=saveSuite(h);await gate.promise;assert.equal(h.host.runtimeStateSuiteSnapshot().busy,true);
 await assert.rejects(saveSuite(h),/active suite|matrix/i);assert.equal(h.host.runtimeStateSuiteSnapshot().busy,true);
 await assert.rejects(startMatrix(h),/suite save/i);release.resolve();const suite=await saving;h.setWrite(undefined);
 assert.equal(h.host.runtimeStateSuiteSnapshot().busy,false);await h.host.runtimeStateSuiteAction({action:'retry',projectId:project.id});
 assert.equal(h.calls.filter(call=>['navigate','replay','capture'].includes(call[0])).length,0);assert.equal(h.host.runtimeStateSuiteSnapshot().suites[0].id,suite.id);
});

test('suite storage failures expose recoverable definitions without running any recipe',async t=>{
 const h=await setup(t);addSuiteRecipes(h);h.setWrite(key=>{if(key.includes('runtime-state-suites'))throw Error('Disk unavailable');});
 await assert.rejects(saveSuite(h));assert.equal(h.host.runtimeStateSuiteSnapshot().storage.status,'error');
 h.setWrite(undefined);await h.host.runtimeStateSuiteAction({action:'retry',projectId:project.id});assert.equal(h.host.runtimeStateSuiteSnapshot().storage.status,'saved');
 assert.equal(h.calls.filter(call=>['navigate','replay','capture'].includes(call[0])).length,0);assert.equal(h.host.runtimeStateSuiteSnapshot().suites.length,1);
});

test('suite terminal history and definitions restore in a new host with no application work',async t=>{
 const h=await setupSuite(t);await startSuite(h,h.suite);const evidence=structuredClone(matrix(h)),saved=structuredClone(h.host.runtimeStateSuiteSnapshot().suites);
 const restored=harness(t,h.persisted);assert.deepEqual(restored.matrixState().matrices.at(-1),evidence);assert.deepEqual(restored.host.runtimeStateSuiteSnapshot().suites,saved);
 assert.equal(restored.calls.length,0);assert.equal(restored.writes.length,0);assert.equal(restored.matrixState().busy,false);
});


test('cold suite recovery links only the reserved later-state recipe and never repeats application work',async t=>{
 const h=await setupSuite(t);let failed=false;
 h.setWrite((key,value)=>{if(!failed&&key.includes('runtime-matrices')&&value.matrices?.[0]?.cells[2]?.replayId){failed=true;throw Error('Later state link not saved');}});
 await startSuite(h,h.suite);assert.equal(failed,true);h.setWrite(undefined);
 const restored=harness(t,h.persisted);restored.matrixState();restored.raw();await tick();
 const cell=matrix(restored).cells[2],replayStore=restored.host.runtimeReplayStore(),snapshot=replayStore.snapshot.bind(replayStore);
 const original=restored.host.runtimeReplayStore.bind(restored.host),idle=matrix(restored).basis.suite.states[0].recipe;
 restored.host.runtimeReplayStore=()=>({...replayStore,snapshot:()=>{const state=snapshot();return {...state,replays:state.replays.map(item=>item.executionId===cell.replayExecutionId?{...item,recipe:{...idle,registrationId:item.recipe.registrationId}}:item)};}});
 await restored.matrixAction('retry');assert.equal(matrix(restored).cells[2].replayId,undefined);
 restored.host.runtimeReplayStore=original;await restored.matrixAction('retry');
 const saved=matrix(restored);assert.equal(saved.cells[2].replayId,snapshot().replays.find(item=>item.executionId===cell.replayExecutionId).id);
 assert.equal(saved.cells[2].status,'interrupted');assert.equal(saved.cells[3].status,'not-run');assert.equal(saved.status,'interrupted');assert.equal(restored.calls.length,0);
});

test('legacy matrix history remains byte-for-byte unchanged while new writes use the v2 key',async t=>{
 const h=await setup(t);await startMatrix(h,[requested()]);
 const key='foundation.runtime-matrices.v2.'+project.id,legacyKey='foundation.runtime-matrices.'+project.id;
 const legacy={...structuredClone(h.persisted.get(key)),schemaVersion:1};h.persisted.delete(key);h.persisted.set(legacyKey,legacy);
 const restored=Object.assign(harness(t,h.persisted),{screen:h.screen,scenario:h.scenario,feature:h.feature});
 assert.deepEqual(matrix(restored),matrix(h));assert.equal(restored.writes.length,0);
 await startMatrix(restored,[requested()]);assert.equal(matrix(restored).status,'completed');assert.deepEqual(h.persisted.get(legacyKey),legacy);
 assert.equal(h.persisted.get(key).schemaVersion,2);assert.ok(restored.writes.every(write=>write.key!==legacyKey));
 for(const corrupt of [null,{schemaVersion:99}]){const values=new Map(h.persisted);values.set(key,corrupt);const blocked=harness(t,values);assert.equal(blocked.matrixState().storage.status,'unavailable');assert.equal(blocked.writes.length,0);}
});
