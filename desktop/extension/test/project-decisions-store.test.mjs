import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createProjectDecisionsStore,PROJECT_DECISION_LIMITS} from '../src/project-decisions-store.mjs';
import {projectDecisionInputFixture} from '../../../tests/helpers/project-decision-fixture.mjs';
const clone=value=>structuredClone(value),projectId='project-decisions-test';
function fixture(previous){let disk=previous,fail=false,commitThenFail=false,readError=false,writeHook;const writes=[];const store=createProjectDecisionsStore({projectId,read:()=>{if(readError)throw Error('PRIVATE_READ_PATH');return disk;},write:async value=>{writes.push(clone(value));if(writeHook)await writeHook(value);if(fail)throw Error('PRIVATE_STORAGE_PATH');disk=clone(value);if(commitThenFail)throw Error('PRIVATE_ACK');}});return {store,writes,get disk(){return disk;},set disk(v){disk=v;},set fail(v){fail=v;},set commitThenFail(v){commitThenFail=v;},set readError(v){readError=v;},set writeHook(v){writeHook=v;}};}
const save=(f,input=projectDecisionInputFixture(),options)=>f.store.create(input,f.store.snapshot().revision,options);
const defer=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

test('decisions persist unchanged through restart, load and disposal without automatic writes',async()=>{
 for(const kind of ['token','change-set']){const f=fixture(),input=projectDecisionInputFixture({kind}),saved=await save(f,input);assert.equal(f.store.snapshot().revision,1);assert.equal(f.disk.decisions[0].id,saved.id);assert.equal('storage' in f.disk,false);input.rationale='Caller';saved.rationale='Returned';assert.notEqual(f.disk.decisions[0].rationale,'Caller');assert.notEqual(f.store.snapshot().decisions[0].rationale,'Returned');await f.store.dispose();const restored=fixture(f.disk);assert.deepEqual(restored.store.snapshot(),f.store.snapshot());await restored.store.load();await restored.store.retry();await restored.store.dispose();assert.equal(restored.writes.length,0);}
});

test('failed storage never publishes uncommitted decisions and retry keeps the same immutable identity',async()=>{
 const f=fixture();await save(f);const previous=clone(f.disk);f.fail=true;await assert.rejects(save(f),{code:'project-decision-storage'});assert.deepEqual(f.disk,previous);assert.equal(f.store.snapshot().decisions.length,1);assert.equal(f.store.snapshot().revision,1);assert.equal(f.store.snapshot().storage.status,'error');assert.doesNotMatch(JSON.stringify(f.store.snapshot()),/PRIVATE/);const pendingId=f.writes.at(-1).decisions.at(-1).id;const writes=f.writes.length;await f.store.load();assert.equal(f.writes.length,writes);await assert.rejects(save(f),{code:'project-decision-storage'});f.fail=false;await f.store.retry();assert.equal(f.disk.decisions.at(-1).id,pendingId);assert.equal(f.disk.decisions.length,2);await f.store.dispose();
});

test('lost acknowledgement retries publish the already committed journal without duplicate writes',async()=>{
 const f=fixture();f.commitThenFail=true;await assert.rejects(save(f),{code:'project-decision-storage'});assert.equal(f.store.snapshot().decisions.length,0);assert.equal(f.disk.decisions.length,1);const id=f.disk.decisions[0].id,writes=f.writes.length;await f.store.retry();assert.equal(f.writes.length,writes);assert.equal(f.store.snapshot().decisions[0].id,id);await f.store.dispose();
});

test('ownership expiring during persistence restores prior metadata without keeping an unaccepted rationale',async()=>{
 const f=fixture();await save(f);const previous=clone(f.disk);let active=true;f.writeHook=()=>{active=false;};await assert.rejects(save(f,projectDecisionInputFixture(),{isCurrent:()=>active}),{name:'AbortError',code:'project-decision-cancelled'});assert.deepEqual(f.disk,previous);assert.equal(f.store.snapshot().decisions.length,1);assert.equal(f.store.snapshot().storage.status,'saved');await f.store.dispose();
});

test('retry after scope expiry discards pending intent and rolls back only its own acknowledged-or-not metadata',async()=>{
 for(const committed of [false,true]){const f=fixture();await save(f);const previous=clone(f.disk);let active=true;f.fail=!committed;f.commitThenFail=committed;await assert.rejects(save(f,projectDecisionInputFixture(),{isCurrent:()=>active}),{code:'project-decision-storage'});active=false;f.fail=false;f.commitThenFail=false;await f.store.retry();assert.deepEqual(f.disk,previous);assert.equal(f.store.snapshot().revision,1);assert.equal(f.store.snapshot().storage.status,'saved');await f.store.dispose();}
});

test('foreign journal replacement is never overwritten on create, retry or read-only load',async()=>{
 const f=fixture();await save(f);const own=clone(f.disk),foreign=clone(own);foreign.decisions[0].rationale='External saved choice';f.disk=foreign;await assert.rejects(save(f),{code:'project-decision-unavailable'});assert.deepEqual(f.disk,foreign);assert.equal(f.writes.length,1);await assert.rejects(f.store.retry(),{code:'project-decision-unavailable'});await f.store.load();assert.deepEqual(f.disk,foreign);assert.equal(f.writes.length,1);f.disk=own;await f.store.retry();assert.equal(f.disk.decisions.length,2);await f.store.dispose();
});

test('unknown, oversized, malformed and cross-project storage remain unavailable without reset',async()=>{
 const seed=fixture();await save(seed);const mutations=[v=>v.schemaVersion=9,v=>v.projectId='foreign',v=>v.decisions[0].choice.rawSource='PRIVATE',v=>v.decisions[0].rationale='x'.repeat(PROJECT_DECISION_LIMITS.journalBytes),v=>v.decisions.push(clone(v.decisions[0])),v=>v.decisions[0].supersedes=randomUUID()];
 for(const mutate of mutations){const disk=clone(seed.disk);mutate(disk);const f=fixture(disk);assert.equal(f.store.snapshot().storage.status,'unavailable');await assert.rejects(save(f),{code:'project-decision-unavailable'});await assert.rejects(f.store.retry(),{code:'project-decision-unavailable'});assert.deepEqual(f.disk,disk);assert.equal(f.writes.length,0);await f.store.dispose();}await seed.store.dispose();
});

test('unavailable initial read can recover explicitly without writing a replacement journal',async()=>{
 const f=fixture(Promise.resolve({}));assert.equal(f.store.snapshot().storage.status,'unavailable');f.disk=undefined;await f.store.load();assert.equal(f.store.snapshot().storage.status,'saved');assert.equal(f.writes.length,0);await f.store.dispose();
});

test('revision, concurrent operation, disposed and ownership guards reject stale intent',async()=>{
 const f=fixture(),gate=defer();f.writeHook=()=>gate.promise;const pending=f.store.create(projectDecisionInputFixture(),0);await assert.rejects(f.store.create(projectDecisionInputFixture(),0),{code:'project-decision-busy'});gate.resolve();await pending;await assert.rejects(f.store.create(projectDecisionInputFixture(),0),{code:'project-decision-stale'});await assert.rejects(save(f,projectDecisionInputFixture(),{isCurrent:()=>false}),{code:'project-decision-cancelled'});await f.store.dispose();await assert.rejects(save(f),{code:'project-decision-closed'});
});

test('caller input is captured before storage begins and cannot replace the accepted rationale',async()=>{
 const f=fixture(),input=projectDecisionInputFixture(),expected=clone(input);const pending=save(f,input);input.rationale='Raced caller';input.choice.files[0].path='private.txt';const result=await pending;assert.equal(result.rationale,expected.rationale);assert.equal(result.choice.files[0].path,expected.choice.files[0].path);await f.store.dispose();
});

test('explicit supersession is append-only, same feature, nonbranching and restart-safe',async()=>{
 const f=fixture(),input=projectDecisionInputFixture(),first=await save(f,input);await assert.rejects(save(f,input),{code:'project-decision-duplicate'});const second=await save(f,{...clone(input),rationale:'A more precise rationale.',supersedes:first.id});const third=await save(f,{...clone(input),rationale:'The final accepted rationale.',supersedes:second.id});assert.equal(third.supersedes,second.id);assert.equal(f.disk.decisions[0].rationale,input.rationale);assert.equal(f.disk.decisions[1].rationale,'A more precise rationale.');await assert.rejects(save(f,{...clone(input),supersedes:first.id}),{code:'project-decision-supersedes'});await assert.rejects(save(f,{...projectDecisionInputFixture(),supersedes:third.id}),{code:'project-decision-supersedes'});const restored=fixture(f.disk);assert.deepEqual(restored.store.snapshot().decisions,f.store.snapshot().decisions);assert.equal(restored.writes.length,0);await restored.store.dispose();await f.store.dispose();
});

test('journal rejects cycles, future supersedes links and multiple replacements',async()=>{
 const f=fixture(),input=projectDecisionInputFixture(),first=await save(f,input);await save(f,{...clone(input),supersedes:first.id});
 for(const mutate of [v=>v.decisions[0].supersedes=v.decisions[1].id,v=>v.decisions[1].supersedes=v.decisions[1].id,v=>{const third=clone(v.decisions[1]);third.id=randomUUID();v.decisions.push(third);}]){const disk=clone(f.disk);mutate(disk);const broken=fixture(disk);assert.equal(broken.store.snapshot().storage.status,'unavailable');assert.equal(broken.writes.length,0);await broken.store.dispose();}await f.store.dispose();
});

test('history capacity rejects new decisions without deleting any original choices',async()=>{
 const f=fixture();for(let i=0;i<PROJECT_DECISION_LIMITS.records;i++)await save(f);const before=clone(f.disk),writes=f.writes.length;await assert.rejects(save(f),{code:'project-decision-capacity'});assert.deepEqual(f.disk,before);assert.equal(f.writes.length,writes);assert.equal(f.store.snapshot().decisions.length,32);await f.store.dispose();
});

test('store has no source, runtime or provider capability and ignores observer failures',async()=>{
 let disk;const store=createProjectDecisionsStore({projectId,read:()=>disk,write:value=>{disk=clone(value);},onChange:()=>{throw Error('PRIVATE_OBSERVER');}});assert.deepEqual(Object.keys(store).sort(),['create','dispose','load','presentation','retry','snapshot']);await store.create(projectDecisionInputFixture(),0);await store.retry();await store.dispose();assert.equal(disk.decisions.length,1);
});

test('UTF-8 journal capacity is enforced before writing even with individually valid long metadata',async()=>{
 const f=fixture();let stopped=false;
 for(let i=0;i<32;i++){
  const input=projectDecisionInputFixture();input.feature.paths.push(...Array.from({length:30},(_,index)=>`src/${index}-${'x'.repeat(980)}.tsx`));input.choice.scope.feature=clone(input.feature);input.contextFiles.push(...input.feature.paths.slice(2).map(path=>({path,hash:'a'.repeat(64)})));
  const previous=clone(f.disk),writes=f.writes.length;
  try{await save(f,input);}catch(error){assert.equal(error.code,'project-decision-capacity');assert.deepEqual(f.disk,previous);assert.equal(f.writes.length,writes);stopped=true;break;}
 }
 assert.equal(stopped,true);assert.ok(f.store.snapshot().decisions.length<32);assert.ok(Buffer.byteLength(JSON.stringify(f.disk),'utf8')<=PROJECT_DECISION_LIMITS.journalBytes);await f.store.dispose();
});

test('read-only presentation caches full history across cheap guards and changes with committed state or storage',async()=>{
 const f=fixture();await save(f);const first=f.store.presentation();assert.equal(f.store.presentation(),first);assert.equal(f.store.presentation().snapshot,first.snapshot);assert.equal(Object.isFrozen(first.snapshot.decisions[0].choice.files),true);assert.throws(()=>{first.snapshot.decisions[0].rationale='Caller';});for(let i=0;i<1000;i++)assert.equal(f.store.presentation(),first);f.fail=true;await assert.rejects(save(f),{code:'project-decision-storage'});const failed=f.store.presentation();assert.notEqual(failed,first);assert.ok(failed.epoch>first.epoch);assert.equal(failed.snapshot.decisions.length,1);assert.equal(failed.snapshot.storage.status,'error');f.fail=false;await f.store.retry();const saved=f.store.presentation();assert.ok(saved.epoch>failed.epoch);assert.equal(saved.snapshot.decisions.length,2);assert.equal(f.store.presentation(),saved);await f.store.dispose();
});
