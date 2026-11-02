import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createReproducibleIssuesStore,REPRODUCIBLE_ISSUE_LIMITS} from '../src/reproducible-issues-store.mjs';
import {reproducibleIssueInputFixture} from '../../../tests/helpers/reproducible-issue-fixture.mjs';
const clone=value=>structuredClone(value),projectId='reproducible-issues-test';
function fixture(previous){let disk=previous,fail=false,commitThenFail=false,readError=false,writeHook;const writes=[];const store=createReproducibleIssuesStore({projectId,read:()=>{if(readError)throw Error('PRIVATE_READ_PATH');return disk;},write:async value=>{writes.push(clone(value));if(writeHook)await writeHook(value);if(fail)throw Error('PRIVATE_STORAGE_PATH');disk=clone(value);if(commitThenFail)throw Error('PRIVATE_ACK');}});return {store,writes,get disk(){return disk;},set disk(v){disk=v;},set fail(v){fail=v;},set commitThenFail(v){commitThenFail=v;},set readError(v){readError=v;},set writeHook(v){writeHook=v;}};}
const save=(f,input=reproducibleIssueInputFixture(),options)=>f.store.create(input,f.store.snapshot().revision,options);
const defer=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

test('local issue snapshots survive restart without automatic replay, image loads or writes',async()=>{
 for(const status of ['completed','cancelled','interrupted']){const f=fixture(),input=reproducibleIssueInputFixture({status}),saved=await save(f,input);assert.equal(f.disk.issues[0].id,saved.id);assert.equal('storage' in f.disk,false);input.actualOutcome='Caller';saved.run.note='Returned';assert.notEqual(f.disk.issues[0].actualOutcome,'Caller');assert.notEqual(f.store.snapshot().issues[0].run.note,'Returned');await f.store.dispose();const restored=fixture(f.disk);assert.deepEqual(restored.store.snapshot(),f.store.snapshot());await restored.store.load();await restored.store.retry();await restored.store.dispose();assert.equal(restored.writes.length,0);}
});

test('storage failure never publishes uncommitted evidence and retry preserves the exact issue identity',async()=>{
 const f=fixture();await save(f);const previous=clone(f.disk);f.fail=true;await assert.rejects(save(f),{code:'reproducible-issue-storage'});assert.deepEqual(f.disk,previous);assert.equal(f.store.snapshot().issues.length,1);assert.equal(f.store.snapshot().revision,1);assert.equal(f.store.snapshot().storage.status,'error');assert.doesNotMatch(JSON.stringify(f.store.snapshot()),/PRIVATE/);const pending=clone(f.writes.at(-1).issues.at(-1)),writes=f.writes.length;await f.store.load();assert.equal(f.writes.length,writes);await assert.rejects(save(f),{code:'reproducible-issue-storage'});f.fail=false;await f.store.retry();assert.deepEqual(f.disk.issues.at(-1),pending);assert.equal(f.disk.issues.length,2);await f.store.dispose();
});

test('lost acknowledgement retry publishes the committed record without another write or duplicate capture',async()=>{
 const f=fixture();f.commitThenFail=true;await assert.rejects(save(f),{code:'reproducible-issue-storage'});assert.equal(f.store.snapshot().issues.length,0);assert.equal(f.disk.issues.length,1);const issue=clone(f.disk.issues[0]),writes=f.writes.length;await f.store.retry();assert.equal(f.writes.length,writes);assert.deepEqual(f.store.snapshot().issues[0],issue);await f.store.dispose();
});

test('ownership expiry during persistence rolls back only the new issue and preserves all prior reports',async()=>{
 const f=fixture();await save(f);const previous=clone(f.disk);let active=true;f.writeHook=()=>{active=false;};await assert.rejects(save(f,reproducibleIssueInputFixture(),{isCurrent:()=>active}),{name:'AbortError',code:'reproducible-issue-cancelled'});assert.deepEqual(f.disk,previous);assert.equal(f.store.snapshot().issues.length,1);assert.equal(f.store.snapshot().storage.status,'saved');await f.store.dispose();
});

test('retry after source ownership expiry discards pending intent without repeating its application work',async()=>{
 for(const committed of [false,true]){const f=fixture();await save(f);const previous=clone(f.disk);let active=true;f.fail=!committed;f.commitThenFail=committed;await assert.rejects(save(f,reproducibleIssueInputFixture(),{isCurrent:()=>active}),{code:'reproducible-issue-storage'});active=false;f.fail=false;f.commitThenFail=false;await f.store.retry();assert.deepEqual(f.disk,previous);assert.equal(f.store.snapshot().revision,1);assert.equal(f.store.snapshot().storage.status,'saved');await f.store.dispose();}
});

test('foreign journal replacement cannot be overwritten by create, retry or read-only load',async()=>{
 const f=fixture();await save(f);const own=clone(f.disk),foreign=clone(own);foreign.issues[0].actualOutcome='External report';f.disk=foreign;await assert.rejects(save(f),{code:'reproducible-issue-unavailable'});assert.deepEqual(f.disk,foreign);assert.equal(f.writes.length,1);await assert.rejects(f.store.retry(),{code:'reproducible-issue-unavailable'});await f.store.load();assert.deepEqual(f.disk,foreign);assert.equal(f.writes.length,1);f.disk=own;await f.store.retry();assert.equal(f.disk.issues.length,2);await f.store.dispose();
});

test('unknown, malformed, oversized, sparse and cross-project journals are preserved without reset',async()=>{
 const seed=fixture();await save(seed);const mutations=[v=>v.schemaVersion=9,v=>v.projectId='foreign',v=>v.issues[0].raw='PRIVATE',v=>v.issues[0].actualOutcome='x'.repeat(REPRODUCIBLE_ISSUE_LIMITS.recordBytes),v=>v.issues.push(clone(v.issues[0])),v=>{const duplicate=clone(v.issues[0]);duplicate.id=randomUUID();v.issues.push(duplicate);},v=>delete v.issues[0],v=>v.issues.extra='PRIVATE'];
 for(const mutate of mutations){const disk=clone(seed.disk);mutate(disk);const f=fixture(disk);assert.equal(f.store.snapshot().storage.status,'unavailable');await assert.rejects(save(f),{code:'reproducible-issue-unavailable'});await assert.rejects(f.store.retry(),{code:'reproducible-issue-unavailable'});assert.deepEqual(f.disk,disk);assert.equal(f.writes.length,0);await f.store.dispose();}await seed.store.dispose();
});

test('unavailable initial storage can recover explicitly without writing an empty replacement',async()=>{
 const f=fixture(Promise.resolve({}));assert.equal(f.store.snapshot().storage.status,'unavailable');f.disk=undefined;await f.store.load();assert.equal(f.store.snapshot().storage.status,'saved');assert.equal(f.writes.length,0);await f.store.dispose();
});

test('concurrent, stale, closed and source-expired create intent is rejected',async()=>{
 const f=fixture(),gate=defer();f.writeHook=()=>gate.promise;const pending=f.store.create(reproducibleIssueInputFixture(),0);await assert.rejects(f.store.create(reproducibleIssueInputFixture(),0),{code:'reproducible-issue-busy'});gate.resolve();await pending;await assert.rejects(f.store.create(reproducibleIssueInputFixture(),0),{code:'reproducible-issue-stale'});await assert.rejects(save(f,reproducibleIssueInputFixture(),{isCurrent:()=>false}),{code:'reproducible-issue-cancelled'});await assert.rejects(save(f,reproducibleIssueInputFixture(),{isCurrent:()=>{throw Error('PRIVATE');}}),{code:'reproducible-issue-cancelled'});await f.store.dispose();await assert.rejects(save(f),{code:'reproducible-issue-closed'});
});

test('the report is captured before the asynchronous write so caller mutations cannot replace accepted evidence',async()=>{
 const f=fixture(),input=reproducibleIssueInputFixture(),expected=clone(input);const pending=save(f,input);input.actualOutcome='Raced caller';input.run.observations[0].url='https://private.example/secret';const result=await pending;assert.equal(result.actualOutcome,expected.actualOutcome);assert.equal(result.run.observations[0].url,expected.run.observations[0].url);await f.store.dispose();
});

test('identical evidence and report are not duplicated; a new authored report remains a separate immutable record',async()=>{
 const f=fixture(),input=reproducibleIssueInputFixture(),first=await save(f,input);await assert.rejects(save(f,input),{code:'reproducible-issue-duplicate'});const second=await save(f,{...clone(input),actualOutcome:'A more precise description of the observed problem.'});assert.notEqual(second.id,first.id);assert.equal(f.disk.issues[0].actualOutcome,input.actualOutcome);assert.equal(f.disk.issues[0].runDigest,f.disk.issues[1].runDigest);const restored=fixture(f.disk);assert.deepEqual(restored.store.snapshot().issues,f.store.snapshot().issues);assert.equal(restored.writes.length,0);await restored.store.dispose();await f.store.dispose();
});

test('history capacity rejects new issues without evicting original reports or screenshots',async()=>{
 const f=fixture();for(let i=0;i<REPRODUCIBLE_ISSUE_LIMITS.records;i++)await save(f);const before=clone(f.disk),writes=f.writes.length;await assert.rejects(save(f),{code:'reproducible-issue-capacity'});assert.deepEqual(f.disk,before);assert.equal(f.writes.length,writes);assert.equal(f.store.snapshot().issues.length,32);await f.store.dispose();
});

test('readback mismatch cannot publish evidence that the storage adapter did not retain',async()=>{
 let disk;const store=createReproducibleIssuesStore({projectId,read:()=>disk,write:()=>{}});await assert.rejects(store.create(reproducibleIssueInputFixture(),0),{code:'reproducible-issue-unavailable'});assert.equal(store.snapshot().issues.length,0);assert.equal(disk,undefined);await store.dispose();
});

test('disposal while a write is in flight invalidates ownership and restores the previous journal',async()=>{
 const f=fixture();await save(f);const before=clone(f.disk),gate=defer();let entered;const began=new Promise(resolve=>{entered=resolve;});f.writeHook=()=>{entered();return gate.promise;};const pending=save(f);await began;const disposal=f.store.dispose();gate.resolve();await assert.rejects(pending,{code:'reproducible-issue-cancelled'});await disposal;assert.deepEqual(f.disk,before);
});

test('shared presentation remains frozen and cached across high-frequency read-only guards',async()=>{
 const f=fixture();await save(f);const first=f.store.presentation();assert.equal(Object.isFrozen(first.snapshot.issues[0].run.observations),true);assert.throws(()=>{first.snapshot.issues[0].actualOutcome='Caller';});for(let i=0;i<1000;i++)assert.equal(f.store.presentation(),first);f.fail=true;await assert.rejects(save(f),{code:'reproducible-issue-storage'});const failed=f.store.presentation();assert.notEqual(failed,first);assert.ok(failed.epoch>first.epoch);assert.equal(failed.snapshot.issues.length,1);assert.equal(failed.snapshot.storage.status,'error');f.fail=false;await f.store.retry();const saved=f.store.presentation();assert.ok(saved.epoch>failed.epoch);assert.equal(saved.snapshot.issues.length,2);assert.equal(f.store.presentation(),saved);await f.store.dispose();
});

test('journal exposes no runtime, provider, source writer or image reader and ignores observer failures',async()=>{
 let disk;const store=createReproducibleIssuesStore({projectId,read:()=>disk,write:value=>{disk=clone(value);},onChange:()=>{throw Error('PRIVATE_OBSERVER');}});assert.deepEqual(Object.keys(store).sort(),['create','dispose','load','presentation','retry','snapshot']);await store.create(reproducibleIssueInputFixture(),0);await store.retry();await store.dispose();assert.equal(disk.issues.length,1);
});
