import assert from 'node:assert/strict';
import test from 'node:test';
import {createConversationStore} from '../src/conversation-store.mjs';
import {reproducibleIssueContextFixture} from '../../../tests/helpers/reproducible-issue-fixture.mjs';
import {decisionContextFixture} from '../../../tests/helpers/project-decision-context.mjs';

const projectId='project-orbit';
const context=[{path:'src/Button.tsx',revision:'r1',source:'export const Button = () => <button>Save</button>;\n'}];
const selected=()=>reproducibleIssueContextFixture({projectId});
const input=(requestId,extra={})=>({requestId,prompt:'Explain the reported failure.',intent:'ask',context:structuredClone(context),...extra});
const turnOf=(store,id)=>store.snapshot().conversations.flatMap(chat=>chat.turns).find(turn=>turn.requestId===id);
function fixture(previous){let disk=previous,fail=false;const writes=[];const store=createConversationStore({projectId,read:()=>disk,write:async value=>{if(fail)throw Error('PRIVATE storage failure');disk=structuredClone(value);writes.push(disk);}});return {store,writes,get disk(){return disk;},set fail(value){fail=value;}};}

test('issue report and sharing assessment persist before dispatch and remain immutable through events and restart',async()=>{
 const f=fixture(),issueContext=selected(),original=structuredClone(issueContext);
 original.issues[0].assessment.source='stale';issueContext.issues[0].assessment.source='stale';
 const result=await f.store.startTurn(input('issue',{issueContext}));assert.equal(f.disk.schemaVersion,11);assert.deepEqual(f.disk.conversations[0].turns[0].issueContext,original);
 issueContext.issues[0].issue.actualOutcome='Caller mutation';result.issueContext.issues.length=0;
 f.store.event('issue',{type:'start',issueContext});f.store.event('issue',{type:'delta',text:'Historical reference.'});f.store.event('issue',{type:'done',issueContext:{...issueContext,projectId:'foreign'}});await f.store.flush();
 const restored=fixture(f.disk),turn=turnOf(restored.store,'issue');assert.equal(turn.state,'complete');assert.deepEqual(turn.issueContext,original);
 assert.equal(turn.issueContext.issues[0].assessment.source,'stale');assert.equal(turn.issueContext.issues[0].issue.compilation,'not-recorded');assert.equal(turn.issueContext.issues[0].issue.sourceRelationship,'unverified');
 turn.issueContext.issues[0].issue.actualOutcome='Another mutation';assert.deepEqual(turnOf(restored.store,'issue').issueContext,original);
 const frozen=restored.store.presentation().snapshot.conversations[0].turns[0].issueContext;assert.equal(Object.isFrozen(frozen.issues[0].issue.run.observations),true);assert.equal(Object.isFrozen(frozen.issues[0].assessment),true);assert.equal(restored.writes.length,0);
 await Promise.all([f.store.dispose(),restored.store.dispose()]);
});

test('all ordinary modes retain explicit issues with independent task, decision and runtime context',async()=>{
 const f=fixture(),issueContext=selected(),decisionContext=decisionContextFixture({projectId,...context[0]});
 const taskContext={version:1,featureId:'feature-save',title:'Save profile',brief:'Explain the failure.',revision:4};
 const runtimeEvidence=[{id:'R1',observationId:'observed-save',session:'session-save',kind:'request',method:'POST',url:'/api/profile',status:503,durationMs:12,outcome:'http-error',observedAt:'2026-11-01T12:00:00.000Z',correlation:'unattributed',provenance:'observed'}];
 for(const intent of ['ask','plan','build','review']){const turn=await f.store.startTurn(input(intent,{intent,issueContext,decisionContext,taskContext,runtimeEvidenceVersion:1,runtimeEvidence}));assert.deepEqual(turn.issueContext,issueContext);assert.deepEqual(turn.decisionContext,decisionContext);assert.deepEqual(turn.taskContext,taskContext);assert.deepEqual(turn.runtimeEvidence,runtimeEvidence);assert.equal(turn.context.length,1);f.store.event(intent,{type:'cancelled'});}
 await f.store.dispose();const restored=fixture(f.disk);for(const intent of ['ask','plan','build','review'])assert.deepEqual(turnOf(restored.store,intent).issueContext,issueContext);await restored.store.dispose();
});

test('a later turn, request revision, event or new conversation never implicitly shares an earlier issue',async()=>{
 const f=fixture(),issueContext=selected();await f.store.startTurn(input('parent',{issueContext}));f.store.event('parent',{type:'done'});
 const lineage={version:1,conversationId:f.store.snapshot().activeId,requestId:'parent'};
 for(const [requestId,extra] of [['later',{}],['revision',{requestRevision:lineage}]]){await f.store.startTurn(input(requestId,extra));f.store.event(requestId,{type:'start',issueContext});f.store.event(requestId,{type:'done',issueContext});assert.equal(turnOf(f.store,requestId).issueContext,undefined);}
 await f.store.newConversation();await f.store.startTurn(input('new'));f.store.event('new',{type:'done'});assert.equal(turnOf(f.store,'new').issueContext,undefined);assert.deepEqual(turnOf(f.store,'parent').issueContext,issueContext);await f.store.dispose();
});

test('malformed or specialized issue context is rejected before conversation persistence',async()=>{
 const f=fixture(),valid=selected(),forged=structuredClone(valid);forged.issues[0].issue.actualOutcome='Changed without digest';
 const over=structuredClone(valid);over.issues[0].issue.actualOutcome='x'.repeat(128*1024);
 const values=[null,[],{}, {...valid,version:2},{...valid,projectId:'foreign'},{...valid,issues:[]},{...valid,issues:[...valid.issues,...valid.issues]},{...valid,tools:['shell']},forged,over,reproducibleIssueContextFixture({projectId:'foreign'})];
 for(const [index,issueContext] of values.entries())await assert.rejects(f.store.startTurn(input(`invalid-${index}`,{issueContext})),{code:'invalid-issue-context'});
 for(const key of ['planContext','requestRevision','groupRevision','checkContext','sourceInvestigation','investigationContext','investigationContinuation'])await assert.rejects(f.store.startTurn(input(`special-${key}`,{issueContext:valid,[key]:{}})),{code:'invalid-issue-context'});
 assert.equal(f.writes.length,0);assert.equal(f.store.snapshot().conversations.length,0);await f.store.dispose();
});

test('schema 1–9 histories remain unchanged on read and migrate only after explicit mutation',async()=>{
 const seed=fixture();await seed.store.startTurn(input('old'));seed.store.event('old',{type:'done'});await seed.store.dispose();
 for(const schemaVersion of [1,2,3,4,5,6,7,8,9]){const old={...structuredClone(seed.disk),schemaVersion},f=fixture(old);assert.equal(f.store.snapshot().storage.status,'saved');assert.equal(f.store.snapshot().schemaVersion,11);assert.equal(turnOf(f.store,'old').issueContext,undefined);await f.store.flush();assert.equal(f.writes.length,0);assert.deepEqual(f.disk,old);await f.store.newConversation();assert.equal(f.disk.schemaVersion,11);await f.store.dispose();}
});

test('corrupt and retroactively injected issue history is preserved unchanged and unavailable',async()=>{
 const seed=fixture();await seed.store.startTurn(input('issue',{issueContext:selected()}));seed.store.event('issue',{type:'done'});await seed.store.dispose();
 const changes=[...Array.from({length:9},(_,i)=>disk=>disk.schemaVersion=i+1),disk=>disk.conversations[0].turns[0].issueContext.projectId='foreign',disk=>disk.conversations[0].turns[0].issueContext.issues[0].issue.actualOutcome='Forged',disk=>disk.conversations[0].turns[0].issueContext.issues[0].assessment.source='verified',disk=>disk.conversations[0].turns[0].issueContext.issues[0].issue.sourceRelationship='confirmed'];
 for(const mutate of changes){const corrupt=structuredClone(seed.disk);mutate(corrupt);const f=fixture(corrupt);assert.equal(f.store.snapshot().storage.status,'unavailable');await assert.rejects(f.store.startTurn(input('never-sent')));assert.equal(f.writes.length,0);assert.deepEqual(f.disk,corrupt);await f.store.dispose();}
});

test('interruption and save recovery retain the original issue disclosure without resending',async()=>{
 const f=fixture(),original=selected();await f.store.startTurn(input('running',{issueContext:original}));f.store.event('running',{type:'delta',text:'Partial'});await f.store.flush();
 const restarted=fixture(f.disk);assert.equal(turnOf(restarted.store,'running').state,'interrupted');assert.deepEqual(turnOf(restarted.store,'running').issueContext,original);assert.equal(restarted.store.event('running',{type:'done'}),null);
 const failed=fixture();failed.fail=true;await assert.rejects(failed.store.startTurn(input('failed',{issueContext:original})),{code:'history-storage'});assert.equal(turnOf(failed.store,'failed').state,'failed');assert.deepEqual(turnOf(failed.store,'failed').issueContext,original);assert.equal(failed.disk,undefined);failed.fail=false;await failed.store.retry();assert.deepEqual(failed.disk.conversations[0].turns[0].issueContext,original);
 await Promise.all([f.store.dispose(),restarted.store.dispose(),failed.store.dispose()]);
});
