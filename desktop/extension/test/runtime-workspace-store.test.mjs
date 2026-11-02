import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRuntimeWorkspaceStore, safeScreenRoute } from '../src/runtime-workspace-store.mjs';
const FEATURE=randomUUID(), SESSION='a'.repeat(32), VIEW='b'.repeat(32), DOCUMENT='c'.repeat(32);
function fixture(previous){let disk=previous,fail=false;const writes=[];const store=createRuntimeWorkspaceStore({projectId:'project-one',read:()=>disk,write:async value=>{writes.push(structuredClone(value));if(fail)throw new Error('PRIVATE_STORAGE_PATH');disk=structuredClone(value);}});return {store,writes,get disk(){return disk;},set disk(value){disk=value;},set fail(value){fail=value;}};}
const rev=store=>store.snapshot().revision;
async function setup(f=fixture()){
 await f.store.createScreen({featureId:FEATURE,title:'Profile',targetId:'vite:dev',route:'/profile'},rev(f.store));
 const screen=f.store.snapshot().screens[0];
 await f.store.createScenario({screenId:screen.id,title:'Save succeeds',steps:['Edit the display name.','Choose Save.'],expectedOutcome:'The saved message appears.'},rev(f.store));return f;
}
function metadata(store){const state=store.snapshot();return {feature:{id:FEATURE,title:'Profile saving',revision:3,paths:['src/App.tsx','src/api.ts']},screen:structuredClone(state.screens.find(item=>item.id===state.activeScreenId)),scenario:structuredClone(state.scenarios.find(item=>item.id===state.activeScenarioId)),definitionRevision:state.revision,runtime:{targetId:'vite:dev',session:SESSION,viewId:VIEW,documentId:DOCUMENT,route:'/profile',pageVersion:1},sources:[{path:'src/App.tsx',revision:'d'.repeat(64)},{path:'src/api.ts',revision:'e'.repeat(64)}],dirtyPaths:['src/api.ts']};}
const record=()=>({id:`${SESSION}:${VIEW}:1`,session:SESSION,documentId:DOCUMENT,kind:'request',method:'POST',url:'http://127.0.0.1:5173/api/profile',status:200,durationMs:18,outcome:'success',observedAt:new Date().toISOString(),timing:'response-headers',correlation:'unattributed'});
async function begin(store){await store.beginRun(metadata(store),rev(store));return store.snapshot().runs.at(-1);}
const finish=(store,id,patch={})=>store.finishRun(id,{status:'completed',assessment:'not-assessed',note:'',observations:[],truncated:false,...patch});

test('screen routes are canonical local pathnames without hidden URL or traversal state',()=>{
 for(const route of ['/','/profile','/settings/profile/','/profiles/user-2'])assert.equal(safeScreenRoute(route),route);
 for(const route of ['',undefined,'profile','https://example.com','//example.com','/a//b','/a/../b','/./b','/a/%2e%2e/b','/%252e%252e','/a%2fb','/a?token=secret','/a#state','/a\\b','/a\nb','/a b','/__foundation/handshake','/é','/'.padEnd(513,'a')])assert.throws(()=>safeScreenRoute(route),{code:'runtime-route-invalid'});
});
test('screen/scenario metadata persists independently and changes never run a target',async()=>{
 const f=await setup();const before=f.store.snapshot();assert.equal(before.activeScenarioId,before.scenarios[0].id);assert.equal(before.runs.length,0);assert.equal('storage'in f.disk,false);
 await f.store.dispose();const restored=fixture(f.disk);assert.deepEqual(restored.store.snapshot(),before);assert.equal(restored.writes.length,0);await restored.store.dispose();
});
test('selection ownership and reversible archive preserve definitions and history',async()=>{
 const f=await setup(),screen=f.store.snapshot().screens[0],scenario=f.store.snapshot().scenarios[0];
 await f.store.archiveScenario(scenario.id,true,rev(f.store));assert.equal(f.store.snapshot().activeScreenId,screen.id);assert.equal(f.store.snapshot().activeScenarioId,null);
 await assert.rejects(f.store.select(screen.id,scenario.id,rev(f.store)),{code:'runtime-workspace-archived'});
 await f.store.archiveScenario(scenario.id,false,rev(f.store));await f.store.select(screen.id,scenario.id,rev(f.store));
 await f.store.archiveScreen(screen.id,true,rev(f.store));assert.equal(f.store.snapshot().activeScreenId,null);assert.equal(f.store.snapshot().activeScenarioId,null);
 await assert.rejects(f.store.select(screen.id,null,rev(f.store)),{code:'runtime-workspace-archived'});
 await f.store.archiveScreen(screen.id,false,rev(f.store));await f.store.select(null,null,rev(f.store));assert.equal(f.store.snapshot().scenarios.length,1);
 await assert.rejects(f.store.select(null,scenario.id,rev(f.store)),{code:'runtime-workspace-invalid'});await f.store.dispose();
});
test('stale serialized mutations reject without losing the first edit',async()=>{
 const f=await setup(),id=f.store.snapshot().screens[0].id,revision=rev(f.store);
 const first=f.store.updateScreen(id,{title:'First'},revision),second=f.store.updateScreen(id,{title:'Stale'},revision);
 await first;await assert.rejects(second,{code:'runtime-workspace-stale'});assert.equal(f.store.snapshot().screens[0].title,'First');
 await assert.rejects(f.store.select(null,null,undefined),{code:'runtime-workspace-stale'});await f.store.dispose();
});
test('invalid definitions and unknown fields reject before persistence',async()=>{
 const f=fixture();
 for(const input of [{featureId:FEATURE,title:'',targetId:'vite:dev',route:'/'},{featureId:'foreign',title:'Profile',targetId:'vite:dev',route:'/'},{featureId:FEATURE,title:'Profile',targetId:'http://secret',route:'/'},{featureId:FEATURE,title:'Profile',targetId:'vite:dev',route:'/',script:'execute'}])await assert.rejects(f.store.createScreen(input,0));
 assert.equal(f.writes.length,0);await setup(f);const screen=f.store.snapshot().screens[0];
 for(const extra of [{steps:[]},{steps:Array(13).fill('Step')},{steps:[' '.repeat(4)]},{steps:['x'.repeat(501)]},{expectedOutcome:''},{title:'x'.repeat(81)}])await assert.rejects(f.store.createScenario({screenId:screen.id,title:'Scenario',steps:['Save'],expectedOutcome:'Saved',...extra},rev(f.store)),{code:'runtime-workspace-invalid'});
 await assert.rejects(f.store.updateScreen(screen.id,{featureId:randomUUID()},rev(f.store)));await f.store.dispose();
});
test('run snapshots capture immutable definitions, exact runtime ownership and full saved source hashes',async()=>{
 const f=await setup();const input=metadata(f.store);await f.store.beginRun(input,rev(f.store));const run=f.store.snapshot().runs[0];
 input.feature.title='Mutated';input.scenario.steps[0]='Mutated';input.sources[0].revision='e'.repeat(64);
 assert.equal(run.status,'recording');assert.equal(run.assessment,'not-assessed');assert.equal(run.feature.title,'Profile saving');assert.equal(run.scenario.steps[0],'Edit the display name.');
 await finish(f.store,run.id,{assessment:'matched',note:'The expected message appeared.',observations:[record()]});
 const finished=f.store.snapshot().runs[0];assert.equal(finished.status,'completed');assert.equal(finished.assessment,'matched');assert.equal(finished.observations[0].correlation,'unattributed');
 await f.store.updateScenario(run.scenario.id,{expectedOutcome:'A later expectation'},rev(f.store));assert.equal(f.store.snapshot().runs[0].scenario.expectedOutcome,'The saved message appears.');
 await f.store.dispose();const restored=fixture(f.disk);assert.deepEqual(restored.store.snapshot().runs[0],f.store.snapshot().runs[0]);await restored.store.dispose();
});
test('HTTP success never assigns a successful manual assessment',async()=>{
 const f=await setup(),run=await begin(f.store);await finish(f.store,run.id,{observations:[record()]});assert.equal(f.store.snapshot().runs[0].assessment,'not-assessed');await f.store.dispose();
});
test('one active run blocks definition changes, switching and another run',async()=>{
 const f=await setup(),run=await begin(f.store),state=f.store.snapshot();
 for(const action of [()=>f.store.select(null,null,state.revision),()=>f.store.updateScreen(run.screen.id,{title:'Other'},state.revision),()=>f.store.archiveScenario(run.scenario.id,true,state.revision),()=>f.store.beginRun(metadata(f.store),state.revision)])await assert.rejects(action(),{code:'runtime-workspace-recording'});
 await finish(f.store,run.id,{status:'cancelled'});await assert.rejects(finish(f.store,run.id),{code:'runtime-workspace-finished'});await f.store.dispose();
});
test('begin refuses mismatched definitions, feature ownership, route, source scope and revision formats',async()=>{
 const f=await setup();const variants=[input=>input.feature.id=randomUUID(),input=>input.screen.title='Changed',input=>input.definitionRevision++,input=>input.runtime.route='/other',input=>input.runtime.documentId='missing',input=>input.runtime.pageVersion=undefined,input=>input.runtime.pageVersion=0,input=>input.sources[0].revision='d'.repeat(16),input=>input.sources[0].path='../outside',input=>input.sources=input.sources.slice(0,1),input=>input.dirtyPaths=['src/not-member.ts'],input=>{input.feature.paths=[];input.sources=[];input.dirtyPaths=[];}];
 for(const change of variants){const input=metadata(f.store);change(input);await assert.rejects(f.store.beginRun(input,rev(f.store)),{code:'runtime-workspace-invalid'});}
 assert.equal(f.store.snapshot().runs.length,0);await f.store.dispose();
});
test('observations reject foreign document/view, unsafe fields, old timestamps and fabricated verification',async()=>{
 const f=await setup(),run=await begin(f.store);
 for(const extra of [{documentId:'e'.repeat(32)},{id:`${SESSION}:${'f'.repeat(32)}:1`},{session:'f'.repeat(32)},{url:'http://user:secret@localhost:5173/api'},{url:'http://localhost:5173/api?token=secret'},{headers:{authorization:'secret'}},{observedAt:'2000-01-01T00:00:00.000Z'},{observedAt:null},{correlation:'confirmed'}])await assert.rejects(finish(f.store,run.id,{observations:[{...record(),...extra}]}),{code:'runtime-workspace-invalid'});
 await assert.rejects(finish(f.store,run.id,{status:'interrupted',assessment:'matched'}),{code:'runtime-workspace-invalid'});
 await assert.rejects(finish(f.store,run.id,{visual:'passed'}),{code:'runtime-workspace-invalid'});
 assert.equal(f.store.snapshot().runs[0].status,'recording');await finish(f.store,run.id,{status:'interrupted',interruption:'The runtime document changed.'});await f.store.dispose();
});
test('failed writes reject, block later work, and retry the same pending identity',async()=>{
 const f=await setup();f.fail=true;await assert.rejects(f.store.beginRun(metadata(f.store),rev(f.store)),{code:'runtime-workspace-storage'});
 const pending=f.store.snapshot();assert.equal(pending.storage.status,'error');assert.equal(f.disk.runs.length,0);assert.doesNotMatch(JSON.stringify(pending),/PRIVATE_STORAGE_PATH/);
 await assert.rejects(finish(f.store,pending.runs[0].id),{code:'runtime-workspace-storage'});f.fail=false;await f.store.retry();assert.equal(f.disk.runs[0].id,pending.runs[0].id);
 f.fail=true;await assert.rejects(finish(f.store,pending.runs[0].id),{code:'runtime-workspace-storage'});f.fail=false;await f.store.retry();assert.equal(f.disk.runs.length,1);assert.equal(f.disk.runs[0].status,'completed');await f.store.dispose();
});
test('restart interrupts in-flight observations, persists recovery, and never resumes runtime work',async()=>{
 const f=await setup();const run=await begin(f.store);await f.store.dispose();
 const restored=fixture(f.disk);assert.equal(restored.store.snapshot().runs[0].status,'interrupted');assert.equal(restored.store.snapshot().storage.status,'saving');
 await restored.store.retry();assert.equal(restored.disk.runs[0].id,run.id);assert.equal(restored.disk.runs[0].interruption,'Foundation restarted before this observation finished.');assert.equal(restored.disk.runs[0].assessment,'not-assessed');assert.ok(restored.disk.runs[0].endedAt);assert.equal(restored.writes.length,1);await restored.store.dispose();
});
test('recovery write failures remain retryable without restarting an observation',async()=>{
 const f=await setup();await begin(f.store);await f.store.dispose();const restored=fixture(f.disk);restored.fail=true;
 await assert.rejects(restored.store.retry(),{code:'runtime-workspace-storage'});assert.equal(restored.store.snapshot().runs[0].status,'interrupted');restored.fail=false;await restored.store.retry();assert.equal(restored.disk.runs[0].status,'interrupted');await restored.store.dispose();
});
test('malformed, foreign, or unknown-version storage is preserved until externally repaired',async()=>{
 const source=await setup();const run=await begin(source.store);await finish(source.store,run.id,{observations:[record()]});await source.store.dispose();
 const invalids=[{...source.disk,schemaVersion:2},{...source.disk,projectId:'foreign'},{...source.disk,activeScreenId:randomUUID()},{...source.disk,runs:[{...source.disk.runs[0],sources:[{path:'src/App.tsx',revision:'d'.repeat(16)}]}]},{...source.disk,scenarios:[]}];
 for(const bad of invalids){const f=fixture(bad);assert.equal(f.store.snapshot().storage.status,'unavailable');await assert.rejects(f.store.retry(),{code:'runtime-workspace-unavailable'});await assert.rejects(f.store.select(null,null,0),{code:'runtime-workspace-unavailable'});assert.equal(f.writes.length,0);assert.equal(f.disk,bad);f.disk=source.disk;await f.store.retry();assert.equal(f.store.snapshot().storage.status,'saved');assert.equal(f.writes.length,0);await f.store.dispose();}
});
test('run capacity is explicit and does not evict old evidence',async()=>{
 const f=await setup();for(let index=0;index<40;index++){const run=await begin(f.store);await finish(f.store,run.id);}
 const before=structuredClone(f.disk);await assert.rejects(f.store.beginRun(metadata(f.store),rev(f.store)),{code:'runtime-workspace-capacity'});assert.deepEqual(f.disk,before);assert.equal(f.store.snapshot().runs.length,40);await f.store.dispose();
});
test('screen and scenario capacity preserve archived entries',async()=>{
 const f=await setup(),screen=f.store.snapshot().screens[0];
 for(let index=1;index<20;index++)await f.store.createScreen({featureId:FEATURE,title:`Screen ${index}`,targetId:'vite:dev',route:`/screen-${index}`},rev(f.store));
 await f.store.archiveScreen(f.store.snapshot().screens.at(-1).id,true,rev(f.store));await assert.rejects(f.store.createScreen({featureId:FEATURE,title:'Overflow',targetId:'vite:dev',route:'/overflow'},rev(f.store)),{code:'runtime-workspace-capacity'});
 for(let index=1;index<40;index++)await f.store.createScenario({screenId:screen.id,title:`Scenario ${index}`,steps:['Observe'],expectedOutcome:'Expected'},rev(f.store));
 await assert.rejects(f.store.createScenario({screenId:screen.id,title:'Overflow',steps:['Observe'],expectedOutcome:'Expected'},rev(f.store)),{code:'runtime-workspace-capacity'});await f.store.dispose();
});
test('queued writes serialize and caller mutation cannot change a pending definition',async()=>{
 let disk,finish;let concurrent=0,max=0;const store=createRuntimeWorkspaceStore({projectId:'serial',read:()=>disk,write:value=>new Promise(resolve=>{concurrent++;max=Math.max(max,concurrent);finish=()=>{disk=structuredClone(value);concurrent--;resolve();};})});
 const first=store.createScreen({featureId:FEATURE,title:'First',targetId:'vite:dev',route:'/'},0);await new Promise(resolve=>setImmediate(resolve));
 const input={featureId:FEATURE,title:'Second',targetId:'vite:dev',route:'/second'};const second=store.createScreen(input,1);input.route='//outside';finish();await first;await new Promise(resolve=>setImmediate(resolve));finish();await second;
 assert.equal(max,1);assert.equal(disk.screens[1].route,'/second');await store.dispose();await assert.rejects(store.retry(),{code:'runtime-workspace-closed'});
});

test('host-reserved observation UUID persists unchanged while the saved run schema stays canonical',async()=>{
 const f=await setup(),id=randomUUID(),options={id},pending=f.store.beginRun(metadata(f.store),rev(f.store),options);options.id=randomUUID();await pending;assert.equal(f.disk.runs[0].id,id);assert.equal(f.disk.runs[0].status,'recording');assert.equal(f.disk.runs[0].assessment,'not-assessed');assert.equal('options'in f.disk.runs[0],false);await finish(f.store,id);const before=structuredClone(f.disk);await assert.rejects(f.store.beginRun(metadata(f.store),rev(f.store),{id}),{code:'runtime-workspace-invalid'});assert.deepEqual(f.disk,before);await f.store.dispose();
});
test('host reservation rejects invalid identities and unknown options without writing',async()=>{
 const f=await setup(),before=structuredClone(f.disk);for(const options of [null,{},'id',{id:'observation-id'},{id:randomUUID(),other:'PRIVATE'},{id:'00000000-0000-0000-0000-000000000000'}])await assert.rejects(f.store.beginRun(metadata(f.store),rev(f.store),options),{code:'runtime-workspace-invalid'});assert.deepEqual(f.disk,before);await f.store.dispose();
});
test('a failed reserved run write retries the exact preallocated identity without a duplicate observation',async()=>{
 const f=await setup(),id=randomUUID();f.fail=true;await assert.rejects(f.store.beginRun(metadata(f.store),rev(f.store),{id}),{code:'runtime-workspace-storage'});assert.equal(f.store.snapshot().runs[0].id,id);assert.equal(f.disk.runs.length,0);f.fail=false;await f.store.retry();assert.equal(f.disk.runs.length,1);assert.equal(f.disk.runs[0].id,id);await f.store.dispose();
});
