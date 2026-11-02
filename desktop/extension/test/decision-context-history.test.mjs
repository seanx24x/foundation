import {projectDecisionFixture} from '../../../tests/helpers/project-decision-fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createConversationStore} from '../src/conversation-store.mjs';
import {normalizeProjectDecisionContext, projectDecisionDigest} from '../../../server/project/project-decisions.mjs';
import {decisionContextFixture, decisionFixture} from '../../../tests/helpers/project-decision-context.mjs';

const projectId = 'project-orbit';
const context = [{path:'src/Button.tsx',revision:'r1',source:'export const Button = () => <button>Save</button>;\n'}];
const selected = () => decisionContextFixture({projectId, ...context[0]});
const input = (requestId, extra = {}) => ({requestId,prompt:'Explain the selected save behavior.',intent:'ask',context:structuredClone(context),...extra});
const turnOf = (store, requestId) => store.snapshot().conversations.flatMap(chat => chat.turns).find(turn => turn.requestId === requestId);
function fixture(previous) {
 let disk = previous, fail = false;
 const writes = [];
 const store = createConversationStore({projectId, read:() => disk, write:async value => {
  if (fail) throw Error('PRIVATE storage failure');
  disk = structuredClone(value);writes.push(disk);
 }});
 return {store,writes,get disk(){return disk;},set fail(value){fail=value;}};
}
const runtimeEvidence = [{id:'R1',observationId:'observed-save',session:'session-save',kind:'request',method:'POST',url:'/api/profile',status:200,durationMs:12,outcome:'success',observedAt:'2026-11-01T12:00:00.000Z',correlation:'unattributed',provenance:'observed'}];

test('a decision disclosure persists before dispatch and retains immutable provenance through completion and restart', async () => {
 const f = fixture(), decisionContext = selected(), original = structuredClone(decisionContext);
 const result = await f.store.startTurn(input('decision-turn',{decisionContext}));
 assert.equal(f.disk.schemaVersion,11);assert.deepEqual(f.disk.conversations[0].turns[0].decisionContext,original);
 decisionContext.decisions[0].decision.rationale = 'Caller mutated';result.decisionContext.decisions.length=0;
 f.store.event('decision-turn',{type:'start',decisionContext});
 f.store.event('decision-turn',{type:'delta',text:'The saved decision is reference rationale.'});
 f.store.event('decision-turn',{type:'done',decisionContext:{...decisionContext,projectId:'foreign'}});
 await f.store.flush();
 const restored = fixture(f.disk), turn = turnOf(restored.store,'decision-turn');
 assert.equal(turn.state,'complete');assert.deepEqual(turn.decisionContext,original);
 assert.equal(turn.decisionContext.decisions[0].decision.choice.compilation,'not-recorded');
 assert.equal(turn.decisionContext.decisions[0].decision.choice.assessment,'not-assessed');
 assert.equal(turn.decisionContext.decisions[0].decision.choice.sourceRelationship,'unverified');
 turn.decisionContext.decisions[0].decision.choice.evidence[0].run.assessment='matched';
 assert.deepEqual(turnOf(restored.store,'decision-turn').decisionContext,original);
 const presented = restored.store.presentation().snapshot.conversations[0].turns[0].decisionContext;
 assert.equal(Object.isFrozen(presented.decisions[0].decision.choice.evidence),true);
 assert.equal(restored.writes.length,0);
 await Promise.all([f.store.dispose(),restored.store.dispose()]);
});

test('all ordinary modes retain explicitly selected decisions alongside independent task and runtime evidence', async () => {
 const f=fixture(), decisionContext=selected();
 const taskContext={version:1,featureId:decisionContext.decisions[0].decision.feature.id,title:'Save profile',brief:'Clarify the action.',revision:4};
 for (const intent of ['ask','plan','build','review']) {
  const turn=await f.store.startTurn(input(intent,{intent,decisionContext,taskContext,runtimeEvidenceVersion:1,runtimeEvidence}));
  assert.deepEqual(turn.decisionContext,decisionContext);assert.deepEqual(turn.taskContext,taskContext);assert.deepEqual(turn.runtimeEvidence,runtimeEvidence);
  assert.equal(turn.context.length,1);assert.equal(turn.context[0].source,context[0].source);
  f.store.event(intent,{type:'cancelled'});
 }
 await f.store.dispose();
 const restored=fixture(f.disk);
 for (const intent of ['ask','plan','build','review']) assert.deepEqual(turnOf(restored.store,intent).decisionContext,decisionContext);
 await restored.store.dispose();
});

test('saved rationale is never automatically included by a later turn, request revision, event or new conversation', async () => {
 const f=fixture(), decisionContext=selected();
 await f.store.startTurn(input('parent',{decisionContext}));f.store.event('parent',{type:'done'});
 const lineage={version:1,conversationId:f.store.snapshot().activeId,requestId:'parent'};
 for (const [requestId,extra] of [['later',{}],['revision',{requestRevision:lineage}]]) {
  await f.store.startTurn(input(requestId,extra));f.store.event(requestId,{type:'start',decisionContext});f.store.event(requestId,{type:'done',decisionContext});
  assert.equal(turnOf(f.store,requestId).decisionContext,undefined);
 }
 await f.store.newConversation();await f.store.startTurn(input('new-conversation'));f.store.event('new-conversation',{type:'done'});
 assert.equal(turnOf(f.store,'new-conversation').decisionContext,undefined);assert.deepEqual(turnOf(f.store,'parent').decisionContext,decisionContext);
 await f.store.dispose();
});

test('decision context rejects malformed, oversized, foreign, forged and specialized input before persistence', async () => {
 const f=fixture(), valid=selected(), forged=structuredClone(valid);forged.decisions[0].decision.rationale='Forged without the corresponding digest';
 const oversized={version:1,projectId,decisions:Array.from({length:4},(_,i)=>{const decision=decisionFixture({projectId,...context[0],index:i+1});decision.rationale='😀'.repeat(1000);return {decision,digest:projectDecisionDigest(decision)};})};
 const values=[null,[],{}, {...valid,version:2}, {...valid,projectId:'foreign'}, {...valid,decisions:[]}, {...valid,decisions:[...valid.decisions,...valid.decisions]}, {...valid,policy:'Use all project files'},forged,oversized,decisionContextFixture({projectId:'foreign'})];
 for (const [index,decisionContext] of values.entries()) await assert.rejects(f.store.startTurn(input(`invalid-${index}`,{decisionContext})),{code:'invalid-decision-context'});
 for (const key of ['planContext','requestRevision','groupRevision','checkContext','sourceInvestigation','investigationContext'])
  await assert.rejects(f.store.startTurn(input(`special-${key}`,{decisionContext:valid,[key]:{}})),{code:'invalid-decision-context'});
 assert.equal(f.writes.length,0);assert.equal(f.store.snapshot().conversations.length,0);await f.store.dispose();
});

test('historical schema 1–8 remains unchanged on read and moves to schema 10 only on explicit mutation', async () => {
 const source=fixture();await source.store.startTurn(input('old-turn'));source.store.event('old-turn',{type:'done'});await source.store.dispose();
 for (const schemaVersion of [1,2,3,4,5,6,7,8]) {
  const old={...structuredClone(source.disk),schemaVersion}, f=fixture(old);
  assert.equal(f.store.snapshot().storage.status,'saved');assert.equal(f.store.snapshot().schemaVersion,11);assert.equal(turnOf(f.store,'old-turn').decisionContext,undefined);
  await f.store.flush();assert.equal(f.writes.length,0);assert.deepEqual(f.disk,old);
  const expectedTurn=structuredClone(old.conversations[0].turns[0]);delete expectedTurn.completedWhileStopping;
  await f.store.newConversation();assert.equal(f.disk.schemaVersion,11);assert.deepEqual(f.disk.conversations[0].turns[0],expectedTurn);
  await f.store.dispose();
 }
});

test('corrupt or retroactively injected decision history is left untouched', async () => {
 const source=fixture();await source.store.startTurn(input('decision-turn',{decisionContext:selected()}));source.store.event('decision-turn',{type:'done'});await source.store.dispose();
 const changes=[...Array.from({length:8},(_,i)=>disk=>disk.schemaVersion=i+1),
  disk=>disk.conversations[0].turns[0].decisionContext.projectId='foreign',
  disk=>disk.conversations[0].turns[0].decisionContext.decisions[0].decision.rationale='Changed rationale',
  disk=>disk.conversations[0].turns[0].decisionContext.decisions[0].decision.choice.sourceRelationship='confirmed',
  disk=>disk.conversations[0].turns[0].decisionContext.decisions[0].policy='Extra authority'];
 for (const change of changes) {
  const corrupt=structuredClone(source.disk);change(corrupt);const f=fixture(corrupt);
  assert.equal(f.store.snapshot().storage.status,'unavailable');await assert.rejects(f.store.startTurn(input('never-sent')));
  assert.equal(f.writes.length,0);assert.deepEqual(f.disk,corrupt);await f.store.dispose();
 }
});

test('interruption and storage failure preserve the disclosed rationale without resending', async () => {
 const f=fixture(), original=selected();await f.store.startTurn(input('running',{decisionContext:original}));f.store.event('running',{type:'delta',text:'Partial'});await f.store.flush();
 const restarted=fixture(f.disk);assert.equal(turnOf(restarted.store,'running').state,'interrupted');assert.deepEqual(turnOf(restarted.store,'running').decisionContext,original);assert.equal(restarted.store.event('running',{type:'done'}),null);
 const failed=fixture();failed.fail=true;await assert.rejects(failed.store.startTurn(input('failed',{decisionContext:original})),{code:'history-storage'});
 assert.equal(turnOf(failed.store,'failed').state,'failed');assert.deepEqual(turnOf(failed.store,'failed').decisionContext,original);assert.equal(failed.disk,undefined);
 failed.fail=false;await failed.store.retry();assert.deepEqual(failed.disk.conversations[0].turns[0].decisionContext,original);
 await Promise.all([f.store.dispose(),restarted.store.dispose(),failed.store.dispose()]);
});

test('whole-group decision rationale retains its accepted checkpoint and separate evidence references without sharing source bodies', async () => {
 const f=fixture(), decision=projectDecisionFixture({kind:'change-set',projectId});
 const decisionContext=normalizeProjectDecisionContext({version:1,projectId,decisions:[{decision,digest:projectDecisionDigest(decision)}]},{projectId});
 await f.store.startTurn(input('group-rationale',{decisionContext}));f.store.event('group-rationale',{type:'done'});await f.store.dispose();
 const restored=fixture(f.disk), turn=turnOf(restored.store,'group-rationale'), retained=turn.decisionContext.decisions[0].decision;
 assert.deepEqual(retained.adoption,decision.adoption);assert.equal(retained.choice.sourceDigest,decision.choice.sourceDigest);
 assert.deepEqual(retained.choice.evidence,decision.choice.evidence);assert.equal(retained.choice.files.length,2);
 assert.equal(turn.context.length,1);assert.equal(turn.changeSet,undefined);assert.equal(turn.proposal,undefined);
 assert.equal(retained.choice.files.every(file=>file.source===undefined&&file.before===undefined&&file.after===undefined),true);
 assert.equal(retained.choice.evidence.every(evidence=>evidence.capture.image===undefined&&evidence.replay.output===undefined),true);
 await restored.store.dispose();
});
