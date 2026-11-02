import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createRuntimeWorkspaceStore} from '../extension/src/runtime-workspace-store.mjs';
const source = await readFile(new URL('../extension/media/workspace-model.js', import.meta.url), 'utf8');
const context = {module:{exports:{}}, URL};
vm.runInNewContext(source, context);
const {observationChoices, compareObservations} = context.module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const ids = {feature:'11000000-0000-4000-8000-000000000001',screen:'22000000-0000-4000-8000-000000000001',scenario:'33000000-0000-4000-8000-000000000001'};
const date = '2026-10-31T10:00:00.000Z';
const options = {projectId:'project-one',featureId:ids.feature};
function run(index = 1) {
 const session = String(index).repeat(32).slice(0,32), viewId = 'a'.repeat(32), documentId = 'b'.repeat(32);
 return {
  id:`44000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
  feature:{id:ids.feature,title:'Profile saving',revision:3,paths:['src/App.tsx','src/api.ts']},
  screen:{id:ids.screen,featureId:ids.feature,title:'Profile',targetId:'vite:dev',route:'/profile',archived:false,createdAt:date,updatedAt:date},
  scenario:{id:ids.scenario,screenId:ids.screen,title:'Save succeeds',steps:['Edit the display name.','Choose Save.'],expectedOutcome:'The saved message appears.',archived:false,createdAt:date,updatedAt:date},
  definitionRevision:2,
  runtime:{targetId:'vite:dev',session,viewId,documentId,route:'/profile',pageVersion:1},
  sources:[{path:'src/App.tsx',revision:'c'.repeat(64)},{path:'src/api.ts',revision:'d'.repeat(64)}],
  dirtyPaths:[],startedAt:date,endedAt:`2026-10-31T10:00:${String(index).padStart(2,'0')}.000Z`,status:'completed',assessment:'not-assessed',note:'',truncated:false,
  observations:[{id:`${session}:${viewId}:1`,session,documentId,kind:'request',method:'POST',url:'http://127.0.0.1:5173/api/profile',status:200,durationMs:18,outcome:'success',observedAt:'2026-10-31T10:00:00.500Z',timing:'response-headers',correlation:'unattributed'}],
 };
}
function fixture(runs = [run(1),run(2)]) {
 return {schemaVersion:1,projectId:options.projectId,revision:4,runs,runFreshness:runs.map(item=>({id:item.id,status:'current',reason:'Saved source and definitions match.'})),storage:{status:'saved'}};
}
const compare = (state, extra={}) => compareObservations(state,{...options,beforeId:state.runs?.[0]?.id,afterId:state.runs?.[1]?.id,...extra});
const assertUnavailable = state => {assert.equal(compare(state).status,'unavailable');assert.deepEqual(plain(observationChoices(state,options)),[]);};

test('observation comparison preserves existing geometry exports and the browser UMD contract',()=>{
 const api=context.module.exports;assert.equal(api.snapWidth(319),320);assert.equal(api.keyboardWidth(320,'ArrowLeft',false,480),324);assert.equal(Object.isFrozen(api),true);
 const browser={window:{},URL};vm.runInNewContext(source,browser);assert.equal(typeof browser.window.FoundationWorkspace.compareObservations,'function');
 assert.equal(browser.window.FoundationWorkspace.compareObservations(fixture(),{...options}).status,'empty');
});

test('choices include only finished observations for the exact project and feature, newest first',()=>{
 const active={...run(3),status:'recording'};delete active.endedAt;
 const foreign=run(4);foreign.feature.id='other-feature';foreign.screen.featureId='other-feature';
 const state=fixture([run(1),run(2),active,foreign]);
 assert.deepEqual(observationChoices(state,options).map(item=>item.id),[state.runs[1].id,state.runs[0].id]);
 assert.equal(observationChoices(state,options)[0],state.runs[1]);
 assert.deepEqual(plain(observationChoices(state,{...options,projectId:'other-project'})),[]);
 assert.deepEqual(plain(observationChoices(state,{...options,featureId:'missing-feature'})),[]);
 assert.equal(compare(state,{beforeId:foreign.id}).status,'unavailable');assert.equal(compare(state,{beforeId:active.id}).status,'unavailable');
});

test('empty and incomplete selections remain distinct from missing, active and duplicate selected identities',()=>{
 const state=fixture();assert.equal(compareObservations(fixture([]),options).status,'empty');
 assert.equal(compareObservations(state,options).status,'empty');
 const incomplete=compare(state,{afterId:null});assert.equal(incomplete.status,'incomplete');assert.equal(incomplete.before.run,state.runs[0]);assert.equal(incomplete.after,undefined);
 const onlyAfter=compare(state,{beforeId:''});assert.equal(onlyAfter.status,'incomplete');assert.equal(onlyAfter.before,undefined);assert.equal(onlyAfter.after.run,state.runs[1]);
 for(const extra of [{afterId:state.runs[0].id},{beforeId:'missing'},{afterId:42},{beforeId:'../invalid'}])assert.equal(compare(state,extra).status,'unavailable');
});

test('different screens are unavailable even when titles and routes match',()=>{
 const state=fixture();state.runs[1].screen.id='different-screen';state.runs[1].scenario.screenId='different-screen';
 assert.equal(observationChoices(state,options).length,2);assert.equal(compare(state).status,'unavailable');assert.match(compare(state).reason,/same screen/);
});

test('full source hashes, added and removed membership, and actual definition conditions stay explicit',()=>{
 const state=fixture(),after=state.runs[1];
 after.sources=[{path:'src/App.tsx',revision:'e'.repeat(64)},{path:'src/theme.ts',revision:'f'.repeat(64)}];after.feature.paths=after.sources.map(item=>item.path);
 after.scenario={...after.scenario,id:'different-scenario',title:'Save fails',steps:['Disconnect the API.','Choose Save.'],expectedOutcome:'An error appears.'};
 after.screen={...after.screen,title:'Profile settings',targetId:'vite:preview',route:'/settings/profile'};after.runtime={...after.runtime,targetId:'vite:preview',route:'/settings/profile'};
 const result=compare(state);assert.equal(result.status,'ready');
 assert.deepEqual(plain(result.sources),[
  {path:'src/App.tsx',beforeRevision:'c'.repeat(64),afterRevision:'e'.repeat(64),status:'changed'},
  {path:'src/api.ts',beforeRevision:'d'.repeat(64),afterRevision:null,status:'removed'},
  {path:'src/theme.ts',beforeRevision:null,afterRevision:'f'.repeat(64),status:'added'},
 ]);
 const conditions=Object.fromEntries(result.conditions.map(item=>[item.label,item]));
 for(const label of ['Screen','Scenario','Steps','Expected result','Runtime target','Route','Feature files'])assert.equal(conditions[label].changed,true,label);
 assert.equal(conditions.Feature.changed,false);assert.equal(conditions.Steps.after,'1. Disconnect the API.\n2. Choose Save.');
 assert.match(result.warnings.join('\n'),/scenario differs/);assert.match(result.warnings.join('\n'),/runtime target differs/);assert.match(result.warnings.join('\n'),/route differs/);
 assert.match(result.warnings.join('\n'),/do not establish equivalent behavior/);
});

test('definition counters, timestamps and membership order do not create a false condition difference',()=>{
 const state=fixture(),after=state.runs[1];after.feature.revision=17;after.definitionRevision=99;after.feature.paths.reverse();after.sources.reverse();
 after.screen.updatedAt='2026-10-31T10:00:00.100Z';after.scenario.updatedAt='2026-10-31T10:00:00.100Z';
 const result=compare(state);assert.equal(result.status,'ready');assert.equal(result.conditions.some(item=>item.changed),false);assert.ok(result.sources.every(item=>item.status==='same'));
 assert.match(result.warnings.join('\n'),/Viewport, theme, application data, and motion settings were not recorded/);
 assert.equal(result.before.freshness.status,'current');assert.doesNotMatch(result.reason,/passed|winner|faster|equivalent rerun/i);
});

test('changed ordered scenario steps remain visible even when the same instructions are present',()=>{
 const state=fixture();state.runs[1].scenario.steps.reverse();const result=compare(state);
 assert.equal(result.status,'ready');assert.equal(result.conditions.find(item=>item.label==='Steps').changed,true);assert.match(result.warnings.join('\n'),/scenario differs/);
});

test('stale and missing freshness remain historical evidence and do not disappear into a passing comparison',()=>{
 const state=fixture();state.runFreshness=[{id:state.runs[0].id,status:'stale',reason:'Changed saved code.'}];const result=compare(state);
 assert.equal(result.status,'ready');assert.deepEqual(plain(result.before.freshness),{status:'stale',reason:'Changed saved code.'});assert.equal(result.after.freshness.status,'unknown');
 assert.match(result.warnings.join('\n'),/Baseline evidence is stale/);assert.match(result.warnings.join('\n'),/Comparison evidence freshness is unknown/);
 const both=fixture();both.runFreshness.forEach(item=>item.status='stale');assert.equal(compare(both).status,'ready');
 delete both.runFreshness;assert.equal(compare(both).before.freshness.status,'unknown');assert.equal(compare(both).after.freshness.status,'unknown');
});

test('cancelled interrupted truncated and dirty observations are inspectable with explicit limitations',()=>{
 const before={...run(1),status:'cancelled',truncated:true,dirtyPaths:['src/App.tsx']},after={...run(2),status:'interrupted',interruption:'Runtime disconnected.',dirtyPaths:['src/App.tsx','src/api.ts']};
 const state=fixture([before,after]),result=compare(state);assert.equal(result.status,'ready');assert.equal(observationChoices(state,options).length,2);
 const warnings=result.warnings.join('\n');assert.match(warnings,/Baseline observation was cancelled/);assert.match(warnings,/Comparison observation was interrupted/);assert.match(warnings,/request capture limit/);assert.match(warnings,/Baseline excludes 1 unsaved draft/);assert.match(warnings,/Comparison excludes 2 unsaved drafts/);
 assert.equal(result.before.run.assessment,'not-assessed');assert.equal(result.after.run.interruption,'Runtime disconnected.');
});

test('manual assessments and request timings are preserved without computing deltas, causal links or outcomes',()=>{
 const state=fixture();state.runs[0].assessment='matched';state.runs[1].assessment='not-matched';state.runs[1].observations[0].durationMs=2;state.runs[1].observations[0].timing='response-complete';
 const result=compare(state);assert.equal(result.status,'ready');assert.equal(result.before.run.assessment,'matched');assert.equal(result.after.run.assessment,'not-matched');
 assert.equal(result.before.run.observations[0].durationMs,18);assert.equal(result.after.run.observations[0].durationMs,2);assert.equal(result.after.run.observations[0].timing,'response-complete');
 assert.deepEqual(Object.keys(result).sort(),['after','before','conditions','reason','sources','status','warnings']);assert.match(result.warnings.join('\n'),/causality is unconfirmed/);
});

test('malformed source and run metadata is unavailable instead of fabricated empty evidence',()=>{
 const mutations=[
  state=>state.runs[0].sources=[],state=>state.runs[0].sources[0].revision='short',state=>state.runs[0].sources.push({...state.runs[0].sources[0]}),
  state=>delete state.runs[0].dirtyPaths,state=>state.runs[0].dirtyPaths=['private/unselected.ts'],state=>state.runs[0].feature.paths.push('src/missing.ts'),
  state=>state.runs[0].feature.paths[0]='../escape',state=>state.runs[0].feature.revision=NaN,state=>state.runs[0].screen.featureId='other',
  state=>state.runs[0].scenario.screenId='other',state=>state.runs[0].scenario.steps=[],state=>state.runs[0].scenario.expectedOutcome='',
  state=>state.runs[0].runtime.targetId='other',state=>state.runs[0].runtime.route='/other',state=>state.runs[0].screen.route='/profile?token=secret',
  state=>state.runs[0].runtime.session='invalid',state=>state.runs[0].runtime.pageVersion=0,state=>state.runs[0].endedAt='invalid',
  state=>state.runs[0].endedAt='2026-10-31T09:59:59.000Z',state=>state.runs[0].status='passed',state=>state.runs[0].truncated='no',
  state=>state.runs[0].scenario.archived=true,state=>state.runs[0].winner=true,state=>state.runs[0].assessment='passed',
  state=>{state.runs[0].status='cancelled';state.runs[0].assessment='matched';},
 ];
 for(const mutate of mutations){const state=fixture();mutate(state);assertUnavailable(state);}
});

test('malformed request records fail closed rather than becoming zero requests',()=>{
 const mutations=[
  run=>delete run.observations,run=>run.observations=null,run=>run.observations.push({...run.observations[0]}),run=>run.observations[0].status=999,
  run=>run.observations[0].durationMs=-1,run=>run.observations[0].durationMs=Infinity,run=>run.observations[0].correlation='confirmed',run=>run.observations[0].headers={authorization:'private'},
  run=>run.observations[0].url='http://user:secret@example.com/api',run=>run.observations[0].url='https://example.com/api?secret=x',run=>run.observations[0].url='/api',
  run=>run.observations[0].documentId='c'.repeat(32),run=>run.observations[0].id='foreign',run=>run.observations[0].timing='assumed',run=>run.observations[0].method='GET\nPOST',
  run=>run.observations[0].observedAt=null,run=>run.observations[0].observedAt='2026-10-31T10:00:03.000Z',run=>run.observations[0].outcome='passed',
 ];
 for(const mutate of mutations){const state=fixture();mutate(state.runs[0]);assertUnavailable(state);}
 const empty=fixture();empty.runs.forEach(run=>run.observations=[]);assert.equal(compare(empty).status,'ready');assert.equal(compare(empty).before.run.observations.length,0);
});

test('project mismatch duplicate IDs and malformed freshness cannot promote records',()=>{
 for(const change of [state=>state.projectId='other',state=>state.schemaVersion=2,state=>state.revision=-1,state=>state.runs.push(state.runs[0]),state=>state.runs=null,state=>state.runFreshness.push(state.runFreshness[0]),state=>state.runFreshness[0].id='foreign',state=>state.runFreshness[0].status='verified',state=>state.runFreshness[0].reason=42,state=>state.runFreshness=null,state=>state.storage.status='unavailable']){
  const state=fixture();change(state);assertUnavailable(state);
 }
 assert.equal(compareObservations(null,options).status,'unavailable');assert.equal(compareObservations(fixture(),null).status,'unavailable');
});

test('bounded history source and request capacities accept their limits and reject overflow',()=>{
 const history=fixture(Array.from({length:40},(_,index)=>{const item=run(index+1);item.runtime.session='a'.repeat(32);item.observations=[];return item;}));
 // Session identities use hexadecimal values in real observations; empty request lists retain that identity.
 assert.equal(observationChoices(history,options).length,40);history.runs.push({...history.runs[0],id:'run-overflow'});assertUnavailable(history);
 const state=fixture();for(const item of state.runs){item.feature.paths=Array.from({length:32},(_,index)=>`src/module${index}.ts`);item.sources=item.feature.paths.map(path=>({path,revision:'c'.repeat(64)}));item.observations=Array.from({length:100},(_,index)=>({...item.observations[0],id:`${item.runtime.session}:${item.runtime.viewId}:${index+1}`}));}
 assert.equal(compare(state).status,'ready');state.runs[0].observations.push({...state.runs[0].observations[0],id:`${state.runs[0].runtime.session}:${state.runs[0].runtime.viewId}:101`});assertUnavailable(state);
 const sources=fixture();sources.runs[0].feature.paths=Array.from({length:33},(_,index)=>`src/module${index}.ts`);sources.runs[0].sources=sources.runs[0].feature.paths.map(path=>({path,revision:'c'.repeat(64)}));assertUnavailable(sources);
});

test('storage errors stay visible while valid retained history remains read-only',()=>{
 const state=fixture();state.storage={status:'error',message:'Saving failed.'};const result=compare(state);assert.equal(result.status,'ready');assert.match(result.warnings.join('\n'),/storage reports an error/);
});

test('comparison is deterministic and cannot mutate frozen input, selected references or source ordering',()=>{
 const state=fixture(),before=structuredClone(state);
 const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};freeze(state);
 const first=compare(state),second=compare(state);assert.deepEqual(plain(first),plain(second));assert.deepEqual(state,before);
 first.before.freshness.status='unknown';first.sources[0].beforeRevision='mutated';first.conditions[0].before='mutated';first.warnings.push('local presentation change');
 assert.deepEqual(state,before);assert.equal(first.before.run,state.runs[0]);assert.equal(second.before.freshness.status,'current');assert.equal(Object.isFrozen(first.before.run),true);
});


test('sparse arrays cannot masquerade as empty or complete observation evidence',()=>{
 for(const mutate of [state=>state.runs=Array(1),state=>state.runs[0].feature.paths=Array(2),state=>state.runs[0].sources=Array(2),state=>state.runs[0].scenario.steps=Array(1),state=>state.runs[0].dirtyPaths=Array(1),state=>state.runs[0].observations=Array(1),state=>state.runFreshness=Array(1)]){const state=fixture();mutate(state);assertUnavailable(state);}
});


test('canonical empty observations with non-monotonic timestamps remain readable with timing uncertainty',()=>{
 const state=fixture();state.runs[0].observations=[];state.runs[0].endedAt='2026-10-31T09:59:59.000Z';
 const {storage,runFreshness,...data}=state;
 const persisted={...data,activeScreenId:null,activeScenarioId:null,screens:[state.runs[0].screen],scenarios:[state.runs[0].scenario]};
 const store=createRuntimeWorkspaceStore({projectId:options.projectId,read:()=>persisted,write:async()=>assert.fail('Comparison must not persist data.')});
 const saved=store.snapshot();assert.equal(saved.storage.status,'saved');assert.equal(saved.runs.length,2);
 const result=compare(saved);assert.equal(result.status,'ready');assert.equal(observationChoices(saved,options).length,2);
 assert.equal(result.before.run.startedAt,date);assert.equal(result.before.run.endedAt,'2026-10-31T09:59:59.000Z');assert.equal(result.before.run.observations.length,0);
 assert.match(result.warnings.join('\n'),/Baseline observation has a recorded finish timestamp before its start timestamp; interval timing cannot be interpreted/);
 // The canonical store and model both reject requests outside the recorded interval.
 persisted.runs[0].observations=run(1).observations;
 const invalidStore=createRuntimeWorkspaceStore({projectId:options.projectId,read:()=>persisted,write:async()=>assert.fail('Validation must not persist data.')});
 assert.equal(invalidStore.snapshot().storage.status,'unavailable');assertUnavailable({...persisted,storage:{status:'saved'}});
});

test('pending storage remains inspectable without implying records have been persisted',()=>{
 const state=fixture();state.storage={status:'saving'};const result=compare(state);
 assert.equal(result.status,'ready');assert.equal(observationChoices(state,options).length,2);
 assert.match(result.warnings.join('\n'),/storage is still saving; these records may not yet be persisted/);
 assert.doesNotMatch(result.warnings.join('\n'),/storage reports an error/);
 state.storage={status:'saved'};assert.doesNotMatch(compare(state).warnings.join('\n'),/storage is still saving/);
});
