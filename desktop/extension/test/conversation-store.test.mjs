import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sourceHash=source=>createHash('sha256').update(source).digest('hex').slice(0,16);
import test from 'node:test';
import { createBuildArtifact, changeGroupDigest } from '../../../server/project/proposals.mjs';
import { createConversationStore } from '../src/conversation-store.mjs';
import { createPlanArtifact, createReviewArtifact, createCheckSuggestion } from '../../../server/project/assistant-artifacts.mjs';

const context = [{ path: 'src/Button.tsx', revision: 'r1', source: 'export const Button = () => <button>Save</button>;' }];
const input = (requestId, extra = {}) => ({ requestId, prompt: 'Explain this button', intent: 'ask', context: structuredClone(context), model: 'fixture-model', ...extra });
function fixture(previous) {
  let disk = previous, fail = false;
  const writes = [], notifications = [];
  const store = createConversationStore({ projectId: 'project-orbit', read: () => disk, write: async value => {
    writes.push(structuredClone(value)); if (fail) throw new Error('secret storage failure /Users/private/key'); disk = structuredClone(value);
  }, onChange: () => notifications.push(true) });
  return { store, writes, notifications, get disk() { return disk; }, set fail(value) { fail = value; } };
}
const turnOf = (store, requestId) => store.snapshot().conversations.flatMap(chat => chat.turns).find(turn => turn.requestId === requestId);
const proposal = (requestId, extra = {}) => ({ id: `proposal-${requestId}`, requestId, projectId: 'project-orbit',
  path: context[0].path, baseRevision: 'r1', before: context[0].source, after: context[0].source.replace('Save', 'Save changes'),
  status: 'proposed', origin: 'ai', title: 'Clarify Save', summary: 'Improve the label', context: [{ path: context[0].path, revision: 'r1' }],
  verification: ['Check the label'], ...extra });

test('request records persist before dispatch and survive recreation with immutable original context', async () => {
  const f = fixture();
  const request = input('request-one');
  const result = await f.store.startTurn(request);
  assert.equal(f.disk.conversations[0].turns[0].requestId, result.requestId);
  request.context[0] = { ...context[0], source: 'changed caller value' };
  f.store.event(result.requestId, { type: 'start', model: 'reported-model', endpoint: 'secret-provider' });
  f.store.event(result.requestId, { type: 'delta', text: 'This renders a Save button.' });
  f.store.event(result.requestId, { type: 'done', usage: { total_tokens: 42, secret: 'hidden' } });
  await f.store.flush();
  const restored = fixture(f.disk);
  const turn = turnOf(restored.store, result.requestId);
  assert.equal(turn.state, 'complete'); assert.equal(turn.context[0].source, context[0].source);
  assert.equal(turn.answer, 'This renders a Save button.'); assert.deepEqual(turn.usage, { total_tokens: 42 });
  assert.equal(turn.model, 'reported-model'); assert.equal(restored.store.snapshot().storage.status, 'saved');
  turn.context[0].source = 'caller changed snapshot';
  assert.equal(turnOf(restored.store, result.requestId).context[0].source, context[0].source);
  await Promise.all([f.store.dispose(), restored.store.dispose()]);
});

test('reopening an in-flight request preserves partial output and marks it interrupted without resuming', async () => {
  const f = fixture(); await f.store.startTurn(input('request-interrupted'));
  f.store.event('request-interrupted', { type: 'start' }); f.store.event('request-interrupted', { type: 'delta', text: 'Partial evidence' });
  f.store.event('request-interrupted', { type: 'stopping' }); await f.store.flush();
  const restored = fixture(f.disk), turn = turnOf(restored.store, 'request-interrupted');
  assert.equal(turn.state, 'interrupted'); assert.equal(turn.answer, 'Partial evidence'); assert.match(turn.error, /no request was resumed/);
  assert.equal(restored.store.event('request-interrupted', { type: 'done' }), null);
  await restored.store.flush(); assert.equal(restored.disk.conversations[0].turns[0].state, 'interrupted');
  await assert.rejects(restored.store.startTurn(input('request-interrupted')), /new identity/);
  await Promise.all([f.store.dispose(), restored.store.dispose()]);
});

test('storage failures prevent dispatch, expose retry state and never retain adapter error details', async () => {
  const f = fixture(); f.fail = true;
  await assert.rejects(f.store.startTurn(input('request-storage')), { code: 'history-storage' });
  assert.equal(f.disk, undefined); assert.equal(f.store.snapshot().storage.status, 'error');
  assert.equal(turnOf(f.store, 'request-storage').state, 'failed');
  assert.doesNotMatch(JSON.stringify(f.store.snapshot()), /secret storage|\/Users\/private/);
  await assert.rejects(f.store.startTurn(input('request-next')), { code: 'history-storage' });
  f.fail = false; await f.store.retry();
  assert.equal(f.disk.conversations[0].turns[0].state, 'failed'); assert.equal(f.store.snapshot().storage.status, 'saved');
  await f.store.startTurn(input('request-next')); f.store.event('request-next', { type: 'cancelled' }); await f.store.dispose();
});

test('writes serialize and a late older write cannot replace a newer terminal snapshot', async () => {
  let disk, inFlight = 0, highWater = 0; const pending = [];
  const store = createConversationStore({ projectId: 'project-orbit', read: () => disk, write: value => new Promise(resolve => {
    inFlight++; highWater = Math.max(highWater, inFlight);
    pending.push(() => { disk = structuredClone(value); inFlight--; resolve(); });
  }) });
  const first = store.startTurn(input('request-queue')); assert.equal(pending.length, 1);
  store.event('request-queue', { type: 'delta', text: 'First ' });
  store.event('request-queue', { type: 'delta', text: 'second' });
  store.event('request-queue', { type: 'done' });
  pending.shift()(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 1); const final = store.flush(); pending.shift()(); await Promise.all([first, final]);
  assert.equal(highWater, 1); assert.equal(disk.conversations[0].turns[0].answer, 'First second');
  assert.equal(disk.conversations[0].turns[0].state, 'complete'); assert.equal(disk.revision, store.snapshot().revision);
  await store.dispose();
});

test('archive is reversible, project boundaries hold, and active requests block switching', async () => {
  const f = fixture(); const one = await f.store.newConversation();
  await f.store.startTurn(input('request-active', { conversationId: one.id }));
  await assert.rejects(f.store.newConversation(), { code: 'request-active' });
  await assert.rejects(f.store.archive(one.id), { code: 'request-active' });
  await assert.rejects(f.store.select('foreign-project-chat'), { code: 'request-active' });
  f.store.event('request-active', { type: 'cancelled' });
  const two = await f.store.newConversation(); await f.store.archive(one.id); await f.store.select(one.id);
  await assert.rejects(f.store.startTurn(input('request-archived')), { code: 'conversation-archived' });
  await f.store.archive(one.id, false); await f.store.startTurn(input('request-restored')); f.store.event('request-restored', { type: 'done' });
  assert.equal(f.store.snapshot().conversations.length, 2); assert.equal(f.store.snapshot().activeId, one.id);
  await assert.rejects(f.store.select('foreign-project-chat'), { code: 'unknown-conversation' });
  await f.store.select(two.id); await f.store.dispose();
});

test('corrupt, unsupported and foreign-project stores remain preserved and cannot be overwritten', async () => {
  const original = fixture(); await original.store.newConversation(); await original.store.dispose();
  for (const bad of [{ ...original.disk, schemaVersion: 12 }, { ...original.disk, projectId: 'different-project' }, { ...original.disk, activeId: 'missing' }, { schemaVersion: 1 }]) {
    const f = fixture(bad); assert.equal(f.store.snapshot().storage.status, 'unavailable');
    await assert.rejects(f.store.newConversation(), { code: 'history-unavailable' });
    await assert.rejects(f.store.retry(), { code: 'history-unavailable' });
    assert.equal(f.store.event('request-unknown', { type: 'delta', text: 'ignored' }), null);
    await f.store.dispose(); assert.deepEqual(f.disk, bad); assert.equal(f.writes.length, 0);
  }
});

test('metadata allowlisting preserves user text but excludes credentials, arbitrary errors and runtime markup', async () => {
  const f = fixture(); const userText = 'The chosen source may include sensitive user text';
  await f.store.startTurn(input('request-private', { prompt: userText, apiKey: 'configuration-secret', endpoint: 'https://private-provider' }));
  f.store.event('request-private', { type: 'delta', text: '<script>response remains text</script>' });
  f.store.event('request-private', { type: 'error', error: 'provider-key-secret', stack: 'internal stack' }); await f.store.flush();
  const serialized = JSON.stringify(f.disk);
  assert.match(serialized, /sensitive user text/); assert.match(serialized, /<script>/);
  assert.doesNotMatch(serialized, /configuration-secret|private-provider|provider-key-secret|internal stack/);
  assert.equal(turnOf(f.store, 'request-private').error, 'The response could not complete. Partial output is preserved.');
  await f.store.dispose();
});

test('oversized deltas terminate explicitly, retain the prior answer and ignore late events', async () => {
  const f = fixture(); await f.store.startTurn(input('request-capacity'));
  f.store.event('request-capacity', { type: 'delta', text: 'Retained answer' });
  const failed = f.store.event('request-capacity', { type: 'delta', text: 'x'.repeat(256 * 1024) });
  assert.equal(failed.state, 'failed'); assert.equal(failed.answer, 'Retained answer'); assert.match(failed.error, /size limit/);
  assert.equal(f.store.event('request-capacity', { type: 'done' }), null);
  await f.store.flush(); assert.equal(f.disk.conversations[0].turns[0].answer, 'Retained answer');
  await f.store.dispose();
});

test('request/source limits reject before mutation and conversation capacity never evicts history', async () => {
  const f = fixture();
  for (const bad of [input('bad-path', { context: [{ ...context[0], path: '../secret' }] }), input('too-much-source', { context: [{ ...context[0], source: 'x'.repeat(65537) }] }), input('empty-context', { context: [] })])
    await assert.rejects(f.store.startTurn(bad), { code: 'invalid-context' });
  assert.equal(f.writes.length, 0); assert.equal(f.store.snapshot().conversations.length, 0);
  for (let i = 0; i < 20; i++) await f.store.newConversation();
  const before = f.disk; await assert.rejects(f.store.newConversation(), { code: 'history-capacity' });
  assert.deepEqual(f.disk, before); assert.equal(f.store.snapshot().conversations.length, 20);
  await f.store.dispose();
});

test('proposal and revision-specific verification history persist as historical evidence without live connectivity', async () => {
  const f = fixture(); await f.store.startTurn(input('request-proposal', { intent: 'build' }));
  // Host checkpoint can arrive before its streamed event.
  await f.store.updateProposal(proposal('request-proposal'));
  f.store.event('request-proposal', { type: 'proposal', proposal: proposal('request-proposal') });
  f.store.event('request-proposal', { type: 'done' });
  await f.store.updateProposal(proposal('request-proposal', { status: 'applied', appliedRevision: 'r2' }));
  const evidence = { revision: 'r2', previewRevision: 'preview-r2', runtimeSession: 'runtime-one', compilation: 'passed', observed: false,
    interaction: 'passed', visual: 'passed', html: 'never store runtime HTML', endpoint: 'secret' };
  assert.equal(await f.store.recordVerification('proposal-request-proposal', { ...evidence, revision: 'wrong' }), null);
  const record = await f.store.recordVerification('proposal-request-proposal', evidence);
  assert.equal(record.interaction, 'not-run'); assert.equal(record.visual, 'not-run'); assert.equal(record.historical, true);
  await f.store.recordVerification('proposal-request-proposal', { ...evidence, observed: true });
  assert.equal(turnOf(f.store, 'request-proposal').verificationHistory.length, 1);
  await f.store.updateProposal(proposal('request-proposal', { status: 'undone', appliedRevision: 'r2' }));
  await f.store.dispose(); const restored = fixture(f.disk), turn = turnOf(restored.store, 'request-proposal');
  assert.equal(turn.proposal.status, 'undone'); assert.equal(turn.verificationHistory[0].observed, true);
  assert.equal(turn.verificationHistory[0].revision, 'r2'); assert.equal(turn.verificationHistory[0].historical, true);
  assert.equal(turn.verificationHistory[0].connected, undefined); assert.doesNotMatch(JSON.stringify(turn), /never store runtime HTML|endpoint/);
  await assert.rejects(restored.store.updateProposal(proposal('request-proposal', { after: 'different proposal' })), { code: 'proposal-changed' });
  await restored.store.dispose();
});

 test('retry loading rereads externally repaired history without overwriting unreadable data', async () => {
  const source = fixture(); await source.store.startTurn(input('request-repaired')); source.store.event('request-repaired', { type: 'done' }); await source.store.flush();
  let raw = { schemaVersion: 200 }, writes = 0;
  const store = createConversationStore({ projectId: 'project-orbit', read: () => raw, write: async value => { writes++; raw = value; } });
  await assert.rejects(store.retry(), { code: 'history-unavailable' }); assert.equal(writes, 0);
  raw = source.disk; await store.retry();
  assert.equal(store.snapshot().storage.status, 'saved'); assert.equal(turnOf(store, 'request-repaired').state, 'complete'); assert.equal(writes, 0);
  await Promise.all([store.dispose(), source.store.dispose()]);
});

test('attaching a historical checkpoint requires the original source identity and never replaces another proposal', async () => {
  const f = fixture(); await f.store.startTurn(input('request-attach', {intent:'build'}));
  await assert.rejects(f.store.updateProposal(proposal('request-attach', { before: 'foreign source' })), { code: 'proposal-context' });
  assert.equal(turnOf(f.store, 'request-attach').proposal, undefined);
  await f.store.updateProposal(proposal('request-attach'));
  f.store.event('request-attach', {type:'done'});
  assert.equal(await f.store.updateProposal(proposal('request-attach', { id: 'different-checkpoint' })), null);
  assert.equal(turnOf(f.store, 'request-attach').proposal.id, 'proposal-request-attach'); await f.store.dispose();
});

test('the total storage bound preserves earlier turns and explicitly stops a response that would exceed it', async () => {
  const seed = fixture(); await seed.store.startTurn(input('seed')); seed.store.event('seed', { type: 'done' }); await seed.store.flush();
  const disk = structuredClone(seed.disk), template = disk.conversations[0].turns[0];
  disk.conversations[0].turns = Array.from({ length: 31 }, (_, index) => ({ ...structuredClone(template), id: `prior-${index}`, requestId: `prior-${index}`, answer: 'R'.repeat(256 * 1024) }));
  assert.ok(Buffer.byteLength(JSON.stringify(disk)) < 8 * 1024 * 1024);
  const f = fixture(disk); assert.equal(f.store.snapshot().storage.status, 'saved');
  await f.store.startTurn(input('exceeds-total'));
  const stopped = f.store.event('exceeds-total', { type: 'delta', text: 'N'.repeat(256 * 1024) });
  assert.equal(stopped.state, 'failed'); assert.equal(stopped.answer, ''); assert.match(stopped.error, /size limit/);
  await f.store.flush();
  assert.equal(f.disk.conversations[0].turns.length, 32);
  for (const turn of f.disk.conversations[0].turns.slice(0, 31)) assert.equal(turn.answer.length, 256 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(f.disk)) <= 8 * 1024 * 1024);
  await Promise.all([f.store.dispose(), seed.store.dispose()]);
});

const runtimeRecord = () => ({id:'R1',observationId:'request-observed-1',session:'runtime-one',kind:'request',method:'POST',url:'http://localhost:4173/api/profile',status:503,durationMs:18.4,outcome:'http-error',observedAt:'2026-10-28T10:00:00.000Z',correlation:'unattributed',provenance:'observed'});
test('original provider and runtime evidence persist before dispatch and remain immutable across events and restart', async () => {
  const f=fixture(); const original=runtimeRecord();
  const request=input('request-evidence',{providerKind:'anthropic',runtimeEvidence:[original]});
  await f.store.startTurn(request);
  const saved=structuredClone(f.disk.conversations[0].turns[0].runtimeEvidence);
  assert.equal(f.disk.conversations[0].turns[0].runtimeEvidenceVersion,1);
  original.url='http://localhost:4173/changed';request.runtimeEvidence.push({...runtimeRecord(),id:'R2'});
  f.store.event('request-evidence',{type:'start',providerKind:'openai',runtimeEvidence:[{...runtimeRecord(),url:'http://localhost:4173/forged'}]});
  f.store.event('request-evidence',{type:'done',providerKind:'compatible',runtimeEvidence:[]});
  await f.store.flush();await f.store.dispose();
  const restored=fixture(f.disk);const turn=turnOf(restored.store,'request-evidence');
  assert.equal(turn.providerKind,'anthropic');assert.equal(turn.runtimeEvidenceVersion,1);assert.deepEqual(turn.runtimeEvidence,saved);
  turn.runtimeEvidence[0].url='http://caller-mutated.invalid';
  assert.deepEqual(turnOf(restored.store,'request-evidence').runtimeEvidence,saved);
  await restored.store.dispose();
});
test('runtime evidence whitelist excludes headers, bodies, and executable metadata', async()=>{
 const f=fixture();await f.store.startTurn(input('request-evidence-private',{providerKind:'openai',runtimeEvidence:[{...runtimeRecord(),headers:{authorization:'SECRET_HEADER'},body:'SECRET_BODY',html:'SCRIPT_PAYLOAD',providerKey:'SECRET_KEY'}]}));
 f.store.event('request-evidence-private',{type:'done'});await f.store.flush();
 assert.deepEqual(turnOf(f.store,'request-evidence-private').runtimeEvidence,[runtimeRecord()]);
 assert.doesNotMatch(JSON.stringify(f.disk),/SECRET_HEADER|SECRET_BODY|SCRIPT_PAYLOAD|SECRET_KEY/);await f.store.dispose();
});
test('invalid runtime evidence rejects before saving a request',async()=>{
 const f=fixture();
 const cases=[
  {runtimeEvidenceVersion:2,runtimeEvidence:[runtimeRecord()]},
  {runtimeEvidenceVersion:1},
  {runtimeEvidence:[{...runtimeRecord(),url:'http://user:secret@localhost/api'}]},
  {runtimeEvidence:[{...runtimeRecord(),url:'http://localhost/api?key=SECRET'}]},
  {runtimeEvidence:[{...runtimeRecord(),url:'http://localhost/api#SECRET'}]},
  {runtimeEvidence:[{...runtimeRecord(),url:'javascript:alert(1)'}]},
  {runtimeEvidence:[{...runtimeRecord(),status:999}]},
  {runtimeEvidence:[{...runtimeRecord(),durationMs:-1}]},
  {runtimeEvidence:[{...runtimeRecord(),observedAt:'yesterday'}]},
  {runtimeEvidence:[{...runtimeRecord(),correlation:'confirmed'}]},
  {runtimeEvidence:[{...runtimeRecord(),provenance:'ai-interpretation'}]},
  {runtimeEvidence:[runtimeRecord(),{...runtimeRecord(),id:'R2',observationId:'other-id',session:'other-session'}]},
  {runtimeEvidence:Array.from({length:13},(_,i)=>({...runtimeRecord(),id:`R${i+1}`,observationId:`request-${i}`}))},
  {providerKind:'unknown-provider'},
 ];
 for(const [i,extra] of cases.entries())await assert.rejects(f.store.startTurn(input(`bad-runtime-${i}`,extra)),{code:'invalid-runtime-context'});
 assert.equal(f.writes.length,0);assert.equal(f.store.snapshot().conversations.length,0);await f.store.dispose();
});
test('unknown or malformed persisted runtime evidence leaves the entire store intact and unavailable',async()=>{
 const original=fixture();await original.store.startTurn(input('evidence-version',{providerKind:'anthropic',runtimeEvidence:[runtimeRecord()]}));original.store.event('evidence-version',{type:'done'});await original.store.dispose();
 for(const change of [turn=>turn.runtimeEvidenceVersion=2,turn=>delete turn.runtimeEvidenceVersion,turn=>turn.runtimeEvidence[0].url+='?secret=private',turn=>turn.providerKind='future-provider']){
  const raw=structuredClone(original.disk);change(raw.conversations[0].turns[0]);const f=fixture(raw);
  assert.equal(f.store.snapshot().storage.status,'unavailable');await assert.rejects(f.store.newConversation(),{code:'history-unavailable'});await assert.rejects(f.store.retry(),{code:'history-unavailable'});await f.store.dispose();assert.deepEqual(f.disk,raw);assert.equal(f.writes.length,0);
 }
});
test('legacy source-only conversations retain absent provider and evidence fields',async()=>{
 const f=fixture();await f.store.startTurn(input('legacy-request'));f.store.event('legacy-request',{type:'done'});await f.store.dispose();const before=structuredClone(f.disk);const restored=fixture(f.disk);
 const turn=turnOf(restored.store,'legacy-request');assert.equal(turn.providerKind,undefined);assert.equal(turn.runtimeEvidence,undefined);assert.equal(turn.runtimeEvidenceVersion,undefined);await restored.store.dispose();assert.deepEqual(restored.disk,before);assert.equal(restored.writes.length,0);
});

const featureTask=()=>({version:1,featureId:'feature-profile',title:'Save profile',brief:'Clarify loading and error states.',revision:3});
test('the original feature task snapshot persists before dispatch and stays immutable through events and restart',async()=>{
 const f=fixture(),task=featureTask();
 await f.store.startTurn(input('feature-task',{taskContext:task}));
 assert.deepEqual(f.disk.conversations[0].turns[0].taskContext,featureTask());
 task.title='New title';task.brief='Changed brief';task.revision++;
 f.store.event('feature-task',{type:'start',taskContext:task});f.store.event('feature-task',{type:'done',taskContext:{...task,featureId:'other-feature'}});
 await f.store.dispose();const restored=fixture(f.disk);const turn=turnOf(restored.store,'feature-task');
 assert.deepEqual(turn.taskContext,featureTask());turn.taskContext.brief='Caller mutation';assert.deepEqual(turnOf(restored.store,'feature-task').taskContext,featureTask());
 await restored.store.dispose();
});
test('task context stores only its normalized title, brief and identity with no implied source or runtime attachments',async()=>{
 const f=fixture();await f.store.startTurn(input('feature-task-whitelist',{taskContext:{...featureTask(),title:'  Save profile  ',brief:'',files:['SECRET_FILE'],tools:['SECRET_TOOL'],providerKey:'SECRET_KEY',runtimeEvidence:[{body:'SECRET_BODY'}]}}));
 const turn=turnOf(f.store,'feature-task-whitelist');assert.deepEqual(turn.taskContext,{...featureTask(),brief:''});assert.equal(turn.context.length,1);assert.equal(turn.runtimeEvidence,undefined);
 assert.doesNotMatch(JSON.stringify(f.disk),/SECRET_FILE|SECRET_TOOL|SECRET_KEY|SECRET_BODY/);await f.store.dispose();
});
test('invalid feature task metadata rejects before any history mutation',async()=>{
 const f=fixture();const cases=[null,[],{}, {...featureTask(),version:2}, {...featureTask(),featureId:'../escape'}, {...featureTask(),featureId:'x'.repeat(129)}, {...featureTask(),title:''}, {...featureTask(),title:'x'.repeat(81)}, {...featureTask(),brief:'x'.repeat(2001)}, {...featureTask(),brief:null}, {...featureTask(),revision:-1}, {...featureTask(),revision:0.1}, {...featureTask(),revision:Number.MAX_SAFE_INTEGER+1}];
 for(const [index,value] of cases.entries())await assert.rejects(f.store.startTurn(input(`bad-feature-${index}`,{taskContext:value})),{code:'invalid-task-context'});
 assert.equal(f.writes.length,0);assert.equal(f.store.snapshot().conversations.length,0);await f.store.dispose();
});
test('unknown or malformed persisted task context preserves the backing store and blocks overwrite',async()=>{
 const source=fixture();await source.store.startTurn(input('feature-history',{taskContext:featureTask()}));source.store.event('feature-history',{type:'done'});await source.store.dispose();
 for(const value of [{...featureTask(),version:2},{...featureTask(),featureId:'bad/id'},{...featureTask(),title:' '},{...featureTask(),brief:[]},{...featureTask(),revision:-1},null]){
  const raw=structuredClone(source.disk);raw.conversations[0].turns[0].taskContext=value;const f=fixture(raw);
  assert.equal(f.store.snapshot().storage.status,'unavailable');await assert.rejects(f.store.retry(),{code:'history-unavailable'});await assert.rejects(f.store.newConversation(),{code:'history-unavailable'});await f.store.dispose();assert.deepEqual(f.disk,raw);assert.equal(f.writes.length,0);
 }
});
test('legacy conversations remain unchanged without a task context field',async()=>{
 const source=fixture();await source.store.startTurn(input('before-features'));source.store.event('before-features',{type:'done'});await source.store.dispose();const before=structuredClone(source.disk);
 const restored=fixture(source.disk);assert.equal(turnOf(restored.store,'before-features').taskContext,undefined);await restored.store.dispose();assert.deepEqual(restored.disk,before);assert.equal(restored.writes.length,0);
});

const planArtifact = () => createPlanArtifact({projectId:'project-orbit',files:context,raw:JSON.stringify({
  title:'Improve saving',summary:'Clarify the existing saved button.',steps:[
    {title:'Clarify the label',detail:'Make the label more specific.',references:[{sourceId:'S1',line:1}]},
    {title:'Check keyboard use',detail:'Inspect the saved button semantics.',references:[{sourceId:'S1',line:1}]},
  ],risks:['Shared consumers may be affected.'],verification:['Check the visible label.']})});
const reviewArtifact = () => createReviewArtifact({projectId:'project-orbit',files:context,raw:JSON.stringify({
  title:'Review the button',summary:'One issue may affect clarity.',findings:[{severity:'low',title:'Generic label',detail:'The label does not name what is saved.',references:[{sourceId:'S1',line:1}],suggestion:'Consider a more specific label.'}],limitations:['The running product was not inspected.']})});
const revisionInput = revision => { const {revision:_revision,createdAt:_createdAt,...input} = structuredClone(revision); return input; };
async function completePlan(f, requestId='plan-request') {
  await f.store.startTurn(input(requestId,{intent:'plan'}));
  const artifact=planArtifact(); f.store.event(requestId,{type:'delta',text:'Original provider plan JSON'});
  f.store.event(requestId,{type:'plan',plan:artifact}); f.store.event(requestId,{type:'done'}); await f.store.flush();
  return artifact;
}
const editPlan = (f,requestId,input,expectedRevision=turnOf(f.store,requestId).planRevisions.at(-1).revision) => f.store.revisePlan({
  conversationId:f.store.snapshot().activeId,requestId,expectedRevision,input,
});
function selectedPlanContext(f,requestId='plan-request',stepIndex=0) {
  const turn=turnOf(f.store,requestId),revision=turn.planRevisions.at(-1),step=revision.steps[stepIndex];
  return {version:1,conversationId:f.store.snapshot().activeId,requestId,artifactId:turn.plan.id,revision:revision.revision,stepId:step.id,
    title:revision.title,summary:revision.summary,step:{title:step.title,detail:step.detail,references:turn.plan.steps.find(item=>item.id===step.id).references},verification:revision.verification};
}

test('schema1 history migrates validated legacy change intent in memory and writes schema5 only on a later mutation',async()=>{
  const source=fixture(); await source.store.startTurn(input('old-ask'));source.store.event('old-ask',{type:'done'});
  await source.store.startTurn(input('old-change',{intent:'build'}));source.store.event('old-change',{type:'proposal',proposal:proposal('old-change')});source.store.event('old-change',{type:'done'});await source.store.dispose();
  const old=structuredClone(source.disk);old.schemaVersion=1;old.conversations[0].turns[1].intent='change';
  const migrated=fixture(old);assert.equal(migrated.store.snapshot().schemaVersion,11);assert.equal(turnOf(migrated.store,'old-change').intent,'build');
  assert.equal(turnOf(migrated.store,'old-ask').intent,'ask');assert.deepEqual(turnOf(migrated.store,'old-change').context,old.conversations[0].turns[1].context);
  await migrated.store.flush();assert.deepEqual(migrated.disk,old);assert.equal(migrated.writes.length,0);
  await migrated.store.newConversation();assert.equal(migrated.disk.schemaVersion,11);assert.equal(turnOf(migrated.store,'old-change').proposal.id,'proposal-old-change');await migrated.store.dispose();
  const invalid=structuredClone(old);invalid.conversations[0].turns[1].intent='plan';const rejected=fixture(invalid);
  assert.equal(rejected.store.snapshot().storage.status,'unavailable');await rejected.store.dispose();assert.deepEqual(rejected.disk,invalid);
});

test('completed plans and reviews preserve immutable provider artifacts and original source across restart',async()=>{
  const f=fixture(),plan=await completePlan(f);const original=structuredClone(plan);plan.title='Caller changed the provider result';
  let turn=turnOf(f.store,'plan-request');assert.deepEqual(turn.plan,original);assert.equal(turn.planRevisions[0].revision,0);
  assert.ok(turn.planRevisions[0].steps.every(step=>step.included));assert.equal(turn.plan.verificationStatus,'not-run');
  await f.store.startTurn(input('review-request',{intent:'review'}));const review=reviewArtifact();f.store.event('review-request',{type:'review',review});f.store.event('review-request',{type:'done'});
  await f.store.dispose();const restored=fixture(f.disk);turn=turnOf(restored.store,'plan-request');
  assert.equal(turn.answer,'Original provider plan JSON');assert.deepEqual(turn.plan,original);assert.equal(turn.planRevisions.length,1);
  assert.deepEqual(turnOf(restored.store,'review-request').review,review);assert.equal(turnOf(restored.store,'review-request').review.verificationStatus,'not-run');
  assert.equal(turnOf(restored.store,'review-request').verificationHistory.length,0);await restored.store.dispose();
});

test('only the requested mode can attach its artifact and completion requires its validated output',async()=>{
  for(const intent of ['plan','build','review']) {
    const f=fixture();await f.store.startTurn(input(`missing-${intent}`,{intent}));const turn=f.store.event(`missing-${intent}`,{type:'done'});
    assert.equal(turn.state,'failed');await f.store.dispose();
  }
  for(const [intent,event] of [['ask',{type:'plan',plan:planArtifact()}],['review',{type:'proposal',proposal:proposal('wrong')}],['build',{type:'review',review:reviewArtifact()}]]) {
    const f=fixture();await f.store.startTurn(input('wrong',{intent}));const turn=f.store.event('wrong',event);assert.equal(turn.state,'failed');
    assert.equal(turn.plan,undefined);assert.equal(turn.review,undefined);assert.equal(turn.proposal,undefined);await f.store.dispose();
  }
  const f=fixture();await assert.rejects(f.store.startTurn(input('legacy-new',{intent:'change'})),{code:'invalid-question'});
  await f.store.startTurn(input('ask-checkpoint'));await assert.rejects(f.store.updateProposal(proposal('ask-checkpoint')),{code:'proposal-intent'});
  f.store.event('ask-checkpoint',{type:'cancelled'});await f.store.dispose();
});

test('partial, stopped and interrupted plans remain readable but cannot be revised or used as complete artifacts',async()=>{
  const f=fixture();await f.store.startTurn(input('partial-plan',{intent:'plan'}));f.store.event('partial-plan',{type:'delta',text:'Partial plan'});
  const plan=planArtifact();f.store.event('partial-plan',{type:'plan',plan});await f.store.flush();
  const restarted=fixture(f.disk);assert.equal(turnOf(restarted.store,'partial-plan').state,'interrupted');
  await assert.rejects(editPlan(restarted,'partial-plan',revisionInput(turnOf(restarted.store,'partial-plan').planRevisions[0])),{code:'plan-unavailable'});
  f.store.event('partial-plan',{type:'stopping'});assert.equal(f.store.event('partial-plan',{type:'review',review:reviewArtifact()}),null);
  f.store.event('partial-plan',{type:'cancelled'});assert.equal(f.store.event('partial-plan',{type:'done'}),null);
  await assert.rejects(editPlan(f,'partial-plan',revisionInput(turnOf(f.store,'partial-plan').planRevisions[0])),{code:'plan-unavailable'});
  assert.equal(turnOf(f.store,'partial-plan').answer,'Partial plan');await Promise.all([f.store.dispose(),restarted.store.dispose()]);
});

test('editing, reordering and excluding steps appends revisions while retaining original evidence and provider text',async()=>{
  const f=fixture(),original=await completePlan(f),first=turnOf(f.store,'plan-request').planRevisions[0];
  const edited=revisionInput(first);edited.title='A locally edited plan';edited.steps.reverse();edited.steps[0].included=false;edited.steps[1].detail='User-owned revised instruction';edited.risks=[];
  const result=await editPlan(f,'plan-request',edited);assert.equal(result.storage.status,'saved');
  let turn=turnOf(f.store,'plan-request');assert.deepEqual(turn.plan,original);assert.deepEqual(turn.planRevisions[0],first);assert.equal(turn.planRevisions[1].revision,1);
  assert.deepEqual(revisionInput(turn.planRevisions[1]),edited);assert.equal(turn.planRevisions[1].steps[0].references,undefined);assert.equal(turn.planRevisions[1].steps[0].status,undefined);
  edited.steps[0].title='Later caller mutation';await f.store.dispose();const restored=fixture(f.disk);turn=turnOf(restored.store,'plan-request');
  assert.equal(turn.planRevisions[1].title,'A locally edited plan');assert.notEqual(turn.planRevisions[1].steps[0].title,'Later caller mutation');assert.deepEqual(turn.plan,original);await restored.store.dispose();
});

test('plan edits reject stale revisions, foreign ownership, archived or inactive chats and concurrent requests',async()=>{
  const f=fixture();await completePlan(f);const conversationId=f.store.snapshot().activeId,edited=revisionInput(turnOf(f.store,'plan-request').planRevisions[0]);edited.title='Updated';await editPlan(f,'plan-request',edited,0);
  await assert.rejects(editPlan(f,'plan-request',edited,0),{code:'plan-changed'});
  await assert.rejects(f.store.revisePlan({conversationId:'foreign-chat',requestId:'plan-request',expectedRevision:1,input:edited}),{code:'plan-unavailable'});
  await f.store.startTurn(input('busy'));await assert.rejects(editPlan(f,'plan-request',edited),{code:'request-active'});f.store.event('busy',{type:'done'});
  await f.store.newConversation();await assert.rejects(f.store.revisePlan({conversationId,requestId:'plan-request',expectedRevision:1,input:edited}),{code:'plan-unavailable'});
  await f.store.select(conversationId);await f.store.archive(conversationId);await f.store.select(conversationId);
  await assert.rejects(editPlan(f,'plan-request',edited),{code:'plan-unavailable'});await f.store.dispose();
});

test('plan revision validation rejects forged step identities, source references and execution claims without writing',async()=>{
  const f=fixture();await completePlan(f);const baseline=revisionInput(turnOf(f.store,'plan-request').planRevisions[0]),before=structuredClone(f.disk),writes=f.writes.length;
  const variants=[value=>value.steps.pop(),value=>value.steps.push({...value.steps[0]}),value=>value.steps[0].id='unknown',value=>value.steps[0].included='yes',
    value=>value.steps[0].status='complete',value=>value.steps[0].references=[],value=>value.title='',value=>value.summary='x'.repeat(2001),value=>value.risks=[''],value=>value.verification=Array(13).fill('check')];
  for(const mutate of variants){const bad=structuredClone(baseline);mutate(bad);await assert.rejects(editPlan(f,'plan-request',bad),{code:'invalid-plan-revision'});}
  assert.deepEqual(f.disk,before);assert.equal(f.writes.length,writes);await f.store.dispose();
});

test('failed plan saves do not acknowledge success, retain the pending revision, and retry safely',async()=>{
  const f=fixture();await completePlan(f);const before=structuredClone(f.disk),edit=revisionInput(turnOf(f.store,'plan-request').planRevisions[0]);edit.title='Pending local revision';f.fail=true;
  await assert.rejects(editPlan(f,'plan-request',edit),{code:'history-storage'});assert.deepEqual(f.disk,before);assert.equal(f.store.snapshot().storage.status,'error');
  assert.equal(turnOf(f.store,'plan-request').planRevisions.at(-1).revision,1);await assert.rejects(editPlan(f,'plan-request',edit),{code:'history-storage'});
  f.fail=false;await f.store.retry();assert.equal(f.store.snapshot().storage.status,'saved');await f.store.dispose();const restored=fixture(f.disk);
  assert.equal(turnOf(restored.store,'plan-request').planRevisions.at(-1).title,'Pending local revision');assert.equal(turnOf(restored.store,'plan-request').planRevisions.length,2);await restored.store.dispose();
});

test('plan revision capacity preserves all prior versions without silently evicting them',async()=>{
  const f=fixture();await completePlan(f);for(let i=1;i<=16;i++){const edit=revisionInput(turnOf(f.store,'plan-request').planRevisions.at(-1));edit.title=`Revision ${i}`;await editPlan(f,'plan-request',edit);}
  const before=structuredClone(f.disk),edit=revisionInput(turnOf(f.store,'plan-request').planRevisions.at(-1));edit.title='One beyond capacity';
  await assert.rejects(editPlan(f,'plan-request',edit),{code:'history-capacity'});assert.deepEqual(f.disk,before);assert.equal(turnOf(f.store,'plan-request').planRevisions.length,17);await f.store.dispose();
});

test('Build stores one host-resolved selected plan step immutably before dispatch and preserves it after later plan edits',async()=>{
  const f=fixture();await completePlan(f);const planContext=selectedPlanContext(f),original=structuredClone(planContext);
  await f.store.startTurn(input('planned-build',{intent:'build',planContext}));assert.deepEqual(turnOf(f.store,'planned-build').planContext,original);
  planContext.step.detail='Caller mutation';f.store.event('planned-build',{type:'start',planContext});f.store.event('planned-build',{type:'proposal',proposal:proposal('planned-build',{planBasis:context.map(({path,revision})=>({path,revision}))})});f.store.event('planned-build',{type:'done'});
  const edit=revisionInput(turnOf(f.store,'plan-request').planRevisions[0]);edit.steps[0].detail='A later instruction';await editPlan(f,'plan-request',edit);await f.store.dispose();const restored=fixture(f.disk);
  assert.deepEqual(turnOf(restored.store,'planned-build').planContext,original);assert.equal(turnOf(restored.store,'planned-build').planContext.revision,0);await restored.store.dispose();
});

test('Build rejects stale, omitted, forged, foreign and mismatched plan context before any durable request',async()=>{
  const f=fixture();await completePlan(f);const baseline=selectedPlanContext(f),writes=f.writes.length;
  const variants=[value=>value.revision=1,value=>value.requestId='foreign',value=>value.conversationId='foreign',value=>value.title='Invented title',value=>value.step.detail='Invented instruction',value=>value.step.references[0].revision='stale',value=>value.verification=['Invented verification']];
  for(const [index,mutate] of variants.entries()){const bad=structuredClone(baseline);mutate(bad);await assert.rejects(f.store.startTurn(input(`spoof-${index}`,{intent:'build',planContext:bad})),{code:'invalid-plan-context'});}
  await assert.rejects(f.store.startTurn(input('ask-with-plan',{intent:'ask',planContext:baseline})),{code:'invalid-plan-context'});assert.equal(f.writes.length,writes);
  const edit=revisionInput(turnOf(f.store,'plan-request').planRevisions[0]);edit.steps[0].included=false;await editPlan(f,'plan-request',edit);
  await assert.rejects(f.store.startTurn(input('excluded-step',{intent:'build',planContext:selectedPlanContext(f)})),{code:'invalid-plan-context'});
  await assert.rejects(f.store.startTurn(input('stale-step',{intent:'build',planContext:baseline})),{code:'invalid-plan-context'});await f.store.dispose();
});

test('malformed persisted artifacts and local revisions leave original storage unavailable and untouched',async()=>{
  const source=fixture();await completePlan(source);await source.store.dispose();
  const variants=[turn=>turn.plan.schemaVersion=2,turn=>turn.plan.projectId='foreign',turn=>turn.plan.steps[0].references[0].line=99,
    turn=>turn.plan.verificationStatus='passed',turn=>turn.intent='review',turn=>delete turn.planRevisions,
    turn=>turn.planRevisions[0].revision=1,turn=>turn.planRevisions[0].title='Forged original',turn=>turn.planRevisions[0].steps[0].status='complete'];
  for(const mutate of variants){const raw=structuredClone(source.disk);mutate(raw.conversations[0].turns[0]);const f=fixture(raw);assert.equal(f.store.snapshot().storage.status,'unavailable');
    await assert.rejects(f.store.retry(),{code:'history-unavailable'});await f.store.dispose();assert.deepEqual(f.disk,raw);assert.equal(f.writes.length,0);}
});

test('concurrent explicit plan saves serialize durable writes and old revisions cannot overwrite a newer draft',async()=>{
  const seed=fixture();await completePlan(seed);await seed.store.dispose();let disk=structuredClone(seed.disk),inFlight=0,highWater=0;const pending=[];
  const store=createConversationStore({projectId:'project-orbit',read:()=>disk,write:value=>new Promise(resolve=>{
    highWater=Math.max(highWater,++inFlight);pending.push(()=>{disk=structuredClone(value);inFlight--;resolve();});
  })});
  const conversationId=store.snapshot().activeId,edit=revisionInput(turnOf(store,'plan-request').planRevisions[0]);edit.title='First local edit';
  const first=store.revisePlan({conversationId,requestId:'plan-request',expectedRevision:0,input:edit});assert.equal(pending.length,1);
  await assert.rejects(store.revisePlan({conversationId,requestId:'plan-request',expectedRevision:0,input:edit}),{code:'plan-changed'});
  const latest=revisionInput(turnOf(store,'plan-request').planRevisions[1]);latest.title='Second local edit';
  const second=store.revisePlan({conversationId,requestId:'plan-request',expectedRevision:1,input:latest});assert.equal(pending.length,1);
  pending.shift()();await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.length,1);pending.shift()();await Promise.all([first,second]);
  assert.equal(highWater,1);assert.equal(disk.conversations[0].turns[0].planRevisions.length,3);assert.equal(disk.conversations[0].turns[0].planRevisions.at(-1).title,'Second local edit');await store.dispose();
});

test('a plan completed during Stop stays historical and cannot prepare or edit work',async()=>{
  const f=fixture();await f.store.startTurn(input('plan-request',{intent:'plan'}));f.store.event('plan-request',{type:'plan',plan:planArtifact()});
  f.store.event('plan-request',{type:'stopping'});f.store.event('plan-request',{type:'done'});await f.store.flush();
  const turn=turnOf(f.store,'plan-request');assert.equal(turn.state,'complete');assert.equal(turn.completedWhileStopping,true);assert.ok(turn.plan);
  await assert.rejects(editPlan(f,'plan-request',revisionInput(turn.planRevisions[0])),{code:'plan-unavailable'});
  await assert.rejects(f.store.startTurn(input('partial-build',{intent:'build',planContext:selectedPlanContext(f)})),{code:'invalid-plan-context'});await f.store.dispose();
});

test('provider artifacts cannot replace originals, reuse identities, or forge the request source context',async()=>{
  const f=fixture();const original=await completePlan(f);assert.equal(f.store.event('plan-request',{type:'plan',plan:planArtifact()}),null);assert.deepEqual(turnOf(f.store,'plan-request').plan,original);
  await f.store.startTurn(input('duplicate-plan',{intent:'plan'}));assert.equal(f.store.event('duplicate-plan',{type:'plan',plan:original}).state,'failed');
  await f.store.startTurn(input('foreign-reference',{intent:'plan'}));const altered=planArtifact();altered.steps[0].references[0].path='src/Elsewhere.ts';
  assert.equal(f.store.event('foreign-reference',{type:'plan',plan:altered}).state,'failed');assert.equal(turnOf(f.store,'foreign-reference').plan,undefined);
  await f.store.startTurn(input('wrong-mode-start',{intent:'plan'}));assert.equal(f.store.event('wrong-mode-start',{type:'start',intent:'build'}).state,'failed');await f.store.dispose();
});

test('zero-finding reviews remain unverified and malformed persisted reviews block history overwrite',async()=>{
  const f=fixture();await f.store.startTurn(input('empty-review',{intent:'review'}));const empty=createReviewArtifact({projectId:'project-orbit',files:context,raw:JSON.stringify({title:'Review selected source',summary:'No findings in the supplied source.',findings:[],limitations:['Only one file was inspected.']})});
  f.store.event('empty-review',{type:'review',review:empty});f.store.event('empty-review',{type:'done'});await f.store.dispose();
  assert.equal(turnOf(f.store,'empty-review').review.verificationStatus,'not-run');
  for(const mutate of [turn=>turn.review.verificationStatus='passed',turn=>delete turn.review,turn=>turn.review.context[0].revision='foreign']) {
    const raw=structuredClone(f.disk);mutate(raw.conversations[0].turns[0]);const restored=fixture(raw);assert.equal(restored.store.snapshot().storage.status,'unavailable');await restored.store.dispose();assert.deepEqual(restored.disk,raw);assert.equal(restored.writes.length,0);
  }
});

async function planWithUnsharedBasis(f) {
  const files=[...structuredClone(context),{path:'src/consumer.ts',revision:'consumer-r1',source:'export const sharedConsumer=true;'}];
  await f.store.startTurn(input('plan-request',{intent:'plan',context:files}));
  const plan=createPlanArtifact({projectId:'project-orbit',files,raw:JSON.stringify({title:'Plan one button edit',summary:'Use both saved files as the planning basis.',steps:[{title:'Clarify the label',detail:'Change the selected button.',references:[{sourceId:'S1',line:1}]}],risks:[],verification:['Inspect the label.']})});
  f.store.event('plan-request',{type:'plan',plan});f.store.event('plan-request',{type:'done'});await f.store.flush();
  return files.map(({path,revision})=>({path,revision}));
}

test('plan-linked proposal history retains its full original basis beyond the one file shared for Build',async()=>{
  const f=fixture(),planBasis=await planWithUnsharedBasis(f);await f.store.startTurn(input('basis-build',{intent:'build',planContext:selectedPlanContext(f)}));
  const change=proposal('basis-build',{planBasis});await f.store.updateProposal(change);f.store.event('basis-build',{type:'proposal',proposal:change});f.store.event('basis-build',{type:'done'});await f.store.flush();
  assert.equal(turnOf(f.store,'basis-build').context.length,1);assert.equal(turnOf(f.store,'basis-build').proposal.planBasis.length,2);
  await f.store.updateProposal({...change,status:'applied',appliedRevision:'r2'});await f.store.dispose();const restored=fixture(f.disk);
  assert.equal(restored.store.snapshot().storage.status,'saved');assert.deepEqual(turnOf(restored.store,'basis-build').proposal.planBasis,planBasis);
  await assert.rejects(restored.store.updateProposal(proposal('basis-build',{status:'undone'})),{code:'proposal-basis'});
  assert.deepEqual(turnOf(restored.store,'basis-build').proposal.planBasis,planBasis);await restored.store.dispose();
});

test('missing or forged plan proposal basis cannot attach, restore, or fall back to selected-file guards',async()=>{
  const variants=[change=>delete change.planBasis,change=>change.planBasis.pop(),change=>change.planBasis.push({...change.planBasis[0]}),change=>change.planBasis[1].revision='forged',change=>change.planBasis[1].path='../outside.ts',change=>change.planBasis[1].executed=true];
  for(const mutate of variants){const f=fixture(),planBasis=await planWithUnsharedBasis(f);await f.store.startTurn(input('basis-build',{intent:'build',planContext:selectedPlanContext(f)}));
    const change=proposal('basis-build',{planBasis});mutate(change);const turn=f.store.event('basis-build',{type:'proposal',proposal:change});assert.equal(turn.state,'failed');assert.equal(turn.proposal,undefined);await f.store.dispose();}
  const source=fixture(),planBasis=await planWithUnsharedBasis(source);await source.store.startTurn(input('basis-build',{intent:'build',planContext:selectedPlanContext(source)}));
  source.store.event('basis-build',{type:'proposal',proposal:proposal('basis-build',{planBasis})});source.store.event('basis-build',{type:'done'});await source.store.dispose();
  for(const mutate of variants){const raw=structuredClone(source.disk);mutate(raw.conversations[0].turns[1].proposal);const restored=fixture(raw);assert.equal(restored.store.snapshot().storage.status,'unavailable');await restored.store.dispose();assert.deepEqual(restored.disk,raw);assert.equal(restored.writes.length,0);}
  const raw=structuredClone(source.disk);delete raw.conversations[0].turns[1].planContext;const unlinked=fixture(raw);assert.equal(unlinked.store.snapshot().storage.status,'unavailable');await unlinked.store.dispose();assert.deepEqual(unlinked.disk,raw);
});

const groupContext=[...context,{path:'src/label.ts',revision:'label-r1',source:'export const label = "Save";\n'},{path:'src/consumer.ts',revision:'consumer-r1',source:'export const consumer = true;\n'}].map(file=>({...file,revision:sourceHash(file.source)}));
const changeSet=()=>createBuildArtifact({projectId:'project-orbit',files:groupContext,raw:JSON.stringify({title:'Clarify labels',summary:'Change two selected labels.',edits:[{path:context[0].path,find:'>Save</button>',replace:'>Save changes</button>'},{path:groupContext[1].path,find:'"Save"',replace:'"Save changes"'}],verification:['Inspect consumers.']})}).changeSet;
const groupInput=(id,extra={})=>input(id,{intent:'build',context:groupContext,...extra});
async function completeGroup(f,id='group-request') {
 await f.store.startTurn(groupInput(id));const group=changeSet();f.store.event(id,{type:'changeSet',changeSet:group});f.store.event(id,{type:'done'});await f.store.flush();return turnOf(f.store,id).changeSet;
}

test('current schema retains a multi-file artifact, every disclosed source, and unrun checks through restart',async()=>{
 const f=fixture(),group=await completeGroup(f);assert.equal(f.disk.schemaVersion,11);assert.equal(group.files.length,2);assert.equal(group.context.length,3);assert.equal(group.requestId,'group-request');
 assert.equal(turnOf(f.store,'group-request').proposal,undefined);assert.equal(turnOf(f.store,'group-request').state,'complete');assert.equal(group.verificationStatus,'not-run');
 group.files[0].before='Caller mutation';await f.store.dispose();const restored=fixture(f.disk);
 assert.deepEqual(turnOf(restored.store,'group-request').changeSet,f.disk.conversations[0].turns[0].changeSet);assert.deepEqual(turnOf(restored.store,'group-request').context.map(({path,source})=>({path,source})),groupContext.map(({path,source})=>({path,source})));
 assert.equal(await restored.store.recordVerification(group.id,{compilation:'passed'}),null);assert.deepEqual(turnOf(restored.store,'group-request').verificationHistory,[]);await restored.store.dispose();
});

test('change-set events reject wrong modes, omitted dependencies, stale bytes, mixed artifacts, and forged verification',async()=>{
 const mutations=[v=>v.context.pop(),v=>v.files[0].before='different',v=>v.files[0].baseRevision='old',v=>v.verificationStatus='passed',v=>v.requestId='other',v=>v.status='applied',v=>v.revision=1,v=>v.files[0].appliedRevision='r2'];
 for(const mutate of mutations){const f=fixture();await f.store.startTurn(groupInput('invalid'));const group=changeSet();mutate(group);assert.equal(f.store.event('invalid',{type:'changeSet',changeSet:group}).state,'failed');assert.equal(turnOf(f.store,'invalid').changeSet,undefined);await f.store.dispose();}
 for(const intent of ['ask','plan','review']){const f=fixture();await f.store.startTurn(groupInput('wrong',{intent}));assert.equal(f.store.event('wrong',{type:'changeSet',changeSet:changeSet()}).state,'failed');await f.store.dispose();}
 for(const first of ['proposal','changeSet']){const f=fixture();await f.store.startTurn(groupInput('mixed'));f.store.event('mixed',first==='proposal'?{type:'proposal',proposal:proposal('mixed',{baseRevision:groupContext[0].revision,context:groupContext.map(({path,revision})=>({path,revision}))})}:{type:'changeSet',changeSet:changeSet()});assert.equal(f.store.event('mixed',first==='proposal'?{type:'changeSet',changeSet:changeSet()}:{type:'proposal',proposal:proposal('mixed',{baseRevision:groupContext[0].revision,context:groupContext.map(({path,revision})=>({path,revision}))})}).state,'failed');await f.store.dispose();}
 const f=fixture();await f.store.startTurn(groupInput('stopping'));f.store.event('stopping',{type:'stopping'});assert.equal(f.store.event('stopping',{type:'changeSet',changeSet:changeSet()}),null);assert.equal(f.store.event('stopping',{type:'done'}).state,'failed');await f.store.dispose();
});

test('change-set updates advance host state while all content, membership, identities, and verification remain immutable',async()=>{
 const f=fixture(),original=await completeGroup(f);const createdAt=new Date().toISOString();
 const applied={...original,status:'applied',revision:1,createdAt,updatedAt:createdAt,files:original.files.map(file=>({...file,appliedRevision:sourceHash(file.after)}))};
 await f.store.updateChangeSet(applied);assert.equal(turnOf(f.store,'group-request').changeSet.status,'applied');
 const baseline=structuredClone(f.disk),variants=[v=>v.files[0].after+='x',v=>v.files[0].before+='x',v=>v.files.reverse(),v=>v.title='Changed meaning',v=>v.summary='Changed scope',v=>v.verification=['Already verified'],v=>v.context.reverse(),v=>v.context.pop(),v=>v.files[0].id=v.id,v=>v.createdAt='2026-01-01T00:00:00.000Z',v=>v.requestId='other'];
 for(const mutate of variants){const bad={...structuredClone(applied),revision:2};mutate(bad);await assert.rejects(f.store.updateChangeSet(bad));assert.deepEqual(f.disk,baseline);}
 await assert.rejects(f.store.updateChangeSet({...original,status:'stale'}),{code:'change-set-changed'});await assert.rejects(f.store.updateChangeSet({...applied,status:'undone'}),{code:'change-set-changed'});
 assert.deepEqual(await f.store.updateChangeSet(applied),applied);await f.store.updateChangeSet({...applied,status:'undone',revision:2});await f.store.dispose();
 const restored=fixture(f.disk),saved=turnOf(restored.store,'group-request').changeSet;assert.equal(saved.status,'undone');assert.deepEqual(saved.files,applied.files);assert.equal(saved.verificationStatus,'not-run');await restored.store.dispose();
});

test('failed change-set history writes keep the canonical update and require retry without altering original source',async()=>{
 const f=fixture(),group=await completeGroup(f);f.fail=true;const next={...group,status:'recovery-required',revision:1};
 await assert.rejects(f.store.updateChangeSet(next),{code:'history-storage'});assert.equal(f.store.snapshot().storage.status,'error');assert.equal(turnOf(f.store,'group-request').changeSet.status,'recovery-required');assert.equal(f.disk.conversations[0].turns[0].changeSet.status,'proposed');
 f.fail=false;await f.store.retry();assert.deepEqual(f.disk.conversations[0].turns[0].changeSet,next);await f.store.dispose();
});

test('schema2 plans and legacy proposals migrate to schema5 without changing saved data until mutation',async()=>{
 const source=fixture();await completePlan(source);await source.store.dispose();const old={...structuredClone(source.disk),schemaVersion:2},f=fixture(old);
 assert.equal(f.store.snapshot().schemaVersion,11);assert.equal(f.store.snapshot().storage.status,'saved');await f.store.flush();assert.deepEqual(f.disk,old);assert.equal(f.writes.length,0);
 await f.store.newConversation();assert.equal(f.disk.schemaVersion,11);const expected=structuredClone(old.conversations[0].turns);for(const turn of expected)if(turn.completedWhileStopping===false)delete turn.completedWhileStopping;assert.deepEqual(f.disk.conversations[0].turns,expected);await f.store.dispose();
});

test('malformed, mixed, or wrong-version persisted change sets leave backing data intact and unavailable',async()=>{
 const source=fixture();await completeGroup(source);await source.store.dispose();
 const mutations=[v=>v.schemaVersion=2,v=>v.schemaVersion=1,v=>v.schemaVersion=12,v=>v.conversations[0].turns[0].changeSet.context.pop(),v=>v.conversations[0].turns[0].changeSet.files[0].before='bad',v=>v.conversations[0].turns[0].changeSet.verificationStatus='passed',v=>v.conversations[0].turns[0].intent='ask',v=>v.conversations[0].turns[0].proposal=proposal('group-request'),v=>v.conversations[0].turns[0].changeSet.requestId='other'];
 for(const mutate of mutations){const bad=structuredClone(source.disk);mutate(bad);const f=fixture(bad);assert.equal(f.store.snapshot().storage.status,'unavailable');await f.store.dispose();assert.deepEqual(f.disk,bad);assert.equal(f.writes.length,0);}
});

test('plan-backed Build cannot attach a multi-file group through event or host update',async()=>{
 const f=fixture();await completePlan(f);const planContext=selectedPlanContext(f);await f.store.startTurn(groupInput('planned-group',{planContext,context:[context[0],...groupContext.slice(1)]}));
 await assert.rejects(f.store.updateChangeSet({...changeSet(),requestId:'planned-group'}),{code:'change-set-context'});
 assert.equal(f.store.event('planned-group',{type:'changeSet',changeSet:changeSet()}).state,'failed');assert.equal(turnOf(f.store,'planned-group').changeSet,undefined);await f.store.dispose();
});

test('group identities cannot be reused across requests or replaced with a late provider event',async()=>{
 const f=fixture(),group=await completeGroup(f);await f.store.startTurn(groupInput('second-group'));
 assert.equal(f.store.event('second-group',{type:'changeSet',changeSet:{...group,requestId:'second-group'}}).state,'failed');assert.equal(turnOf(f.store,'second-group').changeSet,undefined);
 await assert.rejects(f.store.updateChangeSet({...group,requestId:'second-group'}),{code:'change-set-context'});assert.equal(f.store.event('group-request',{type:'changeSet',changeSet:changeSet()}),null);await f.store.dispose();
});


test('an empty recovered checkpoint never matches or mutates an unrelated conversation turn',async()=>{
 const f=fixture();await f.store.startTurn(input('plain-ask'));f.store.event('plain-ask',{type:'done'});await f.store.flush();const baseline=structuredClone(f.disk),writes=f.writes.length;
 assert.equal(await f.store.updateChangeSet(null),null);assert.equal(await f.store.updateChangeSet(undefined),null);assert.deepEqual(f.disk,baseline);assert.equal(f.writes.length,writes);await f.store.dispose();
});

const requestRevision = (f, requestId) => ({version:1,conversationId:f.store.snapshot().activeId,requestId});
async function completeAsk(f, requestId='revision-parent', extra={}) {
  await f.store.startTurn(input(requestId,extra));
  f.store.event(requestId,{type:'delta',text:'Original answer is historical, never an input to the revised request.'});
  f.store.event(requestId,{type:'done'});await f.store.flush();
  return turnOf(f.store,requestId);
}

test('request revisions save an exact parent checkpoint before dispatch without copying prior output or optional context',async()=>{
  const f=fixture();const parent=await completeAsk(f,'revision-parent',{providerKind:'anthropic',runtimeEvidence:[runtimeRecord()],taskContext:{version:1,featureId:'old-task',title:'Original task',brief:'Original brief',revision:1}});
  const lineage=requestRevision(f,parent.requestId),original=structuredClone(parent);
  const child=await f.store.startTurn(input('revision-child',{prompt:'Explain only the loading behavior.',requestRevision:lineage,providerKind:'compatible',runtimeEvidence:[],taskContext:{version:1,featureId:'new-task',title:'New task',brief:'An explicit new brief',revision:2}}));
  assert.equal(f.disk.schemaVersion,11);assert.deepEqual(f.disk.conversations[0].turns[1].requestRevision,lineage);
  assert.deepEqual(turnOf(f.store,parent.requestId),original);assert.equal(child.answer,'');assert.equal(child.question,'Explain only the loading behavior.');
  assert.equal(child.providerKind,'compatible');assert.equal(child.taskContext.featureId,'new-task');assert.deepEqual(child.runtimeEvidence,[]);assert.equal(child.usage,undefined);
  lineage.requestId='caller-mutated';child.requestRevision.conversationId='caller-mutated';
  f.store.event('revision-child',{type:'start',requestRevision:{version:1,conversationId:'forged',requestId:'forged'}});
  f.store.event('revision-child',{type:'delta',text:'Revised answer'});f.store.event('revision-child',{type:'done'});await f.store.flush();
  assert.equal(turnOf(f.store,'revision-child').requestRevision.requestId,parent.requestId);assert.deepEqual(turnOf(f.store,parent.requestId),original);
  await f.store.dispose();const restored=fixture(f.disk);
  assert.equal(restored.store.snapshot().storage.status,'saved');assert.deepEqual(turnOf(restored.store,'revision-child').requestRevision,requestRevision(restored,parent.requestId));
  assert.equal(turnOf(restored.store,parent.requestId).answer,original.answer);assert.deepEqual(turnOf(restored.store,parent.requestId).context,original.context);
  await restored.store.dispose();
});

test('complete, stopped, failed, interrupted and completed-during-stop requests can be revised without resuming them',async()=>{
  for(const state of ['complete','stopped','failed','interrupted','completedWhileStopping']){
    const seed=fixture();await seed.store.startTurn(input('parent'));
    seed.store.event('parent',{type:'delta',text:'Retained partial or complete output'});
    if(state==='completedWhileStopping'){seed.store.event('parent',{type:'stopping'});seed.store.event('parent',{type:'done'});}
    else if(state!=='interrupted')seed.store.event('parent',{type:state==='complete'?'done':state==='stopped'?'cancelled':'error'});
    await seed.store.flush();const f=fixture(seed.disk),before=turnOf(f.store,'parent');
    assert.equal(before.state,state==='completedWhileStopping'?'complete':state);
    await f.store.startTurn(input('child',{requestRevision:requestRevision(f,'parent')}));
    assert.deepEqual(turnOf(f.store,'parent'),before);assert.equal(turnOf(f.store,'child').answer,'');assert.equal(turnOf(f.store,'child').state,'running');
    f.store.event('child',{type:'cancelled'});await Promise.all([f.store.dispose(),seed.store.dispose()]);
  }
});

test('request revision chains survive restart as checkpoints while an unfinished child becomes interrupted',async()=>{
  const f=fixture();await completeAsk(f,'first');await f.store.startTurn(input('second',{requestRevision:requestRevision(f,'first')}));f.store.event('second',{type:'cancelled'});
  await f.store.startTurn(input('third',{requestRevision:requestRevision(f,'second')}));f.store.event('third',{type:'delta',text:'Partial third answer'});await f.store.flush();
  const restored=fixture(f.disk);assert.equal(turnOf(restored.store,'third').state,'interrupted');assert.equal(turnOf(restored.store,'third').answer,'Partial third answer');
  assert.deepEqual(turnOf(restored.store,'third').requestRevision,requestRevision(restored,'second'));assert.equal(restored.store.event('third',{type:'done'}),null);
  await restored.store.flush();const again=fixture(restored.disk);assert.equal(again.store.snapshot().storage.status,'saved');assert.equal(turnOf(again.store,'third').state,'interrupted');
  await Promise.all([f.store.dispose(),restored.store.dispose(),again.store.dispose()]);
});

test('request revisions reject malformed lineage, stale identity, different intent, reordered or changed saved source before mutation',async()=>{
  const f=fixture(),twoSources=[...context,{path:'src/state.ts',revision:'state-r1',source:'export const saving = false;\n'}];await completeAsk(f,'parent',{context:twoSources});
  const baseline=f.store.snapshot(),disk=structuredClone(f.disk),writes=f.writes.length,lineage=requestRevision(f,'parent');
  const variants=[
    {requestRevision:null},{requestRevision:{}},{requestRevision:{...lineage,version:2}},
    {requestRevision:{...lineage,unexpected:'prior output'}},{requestRevision:{...lineage,requestId:'missing'}},
    {requestRevision:{...lineage,requestId:'child'}},{requestRevision:{...lineage,conversationId:'other-chat'}},
    {requestRevision:{...lineage,requestId:'bad/id'}},{requestRevision:lineage,intent:'build'},
    {requestRevision:lineage,context:[...twoSources].reverse()},
    {requestRevision:lineage,context:[{...twoSources[0],revision:'new-revision'},twoSources[1]]},
    {requestRevision:lineage,context:[{...twoSources[0],source:twoSources[0].source+'\n'},twoSources[1]]},
    {requestRevision:lineage,context:twoSources.slice(0,1)},
  ];
  for(const variant of variants)await assert.rejects(f.store.startTurn(input('child',{context:twoSources,...variant})),{code:'invalid-request-revision'});
  await assert.rejects(f.store.startTurn(input('child',{context:twoSources,requestRevision:lineage,conversationId:'stale-active-chat'})),{code:'conversation-changed'});
  assert.deepEqual(f.store.snapshot(),baseline);assert.deepEqual(f.disk,disk);assert.equal(f.writes.length,writes);await f.store.dispose();
});

test('request revisions require the active unarchived parent conversation and no response in flight',async()=>{
  const f=fixture();await completeAsk(f,'parent');const lineage=requestRevision(f,'parent'),originalChat=f.store.snapshot().activeId;
  await f.store.newConversation();await assert.rejects(f.store.startTurn(input('foreign-child',{requestRevision:lineage})),{code:'invalid-request-revision'});
  await f.store.select(originalChat);await f.store.archive(originalChat);await f.store.select(originalChat);
  await assert.rejects(f.store.startTurn(input('archived-child',{requestRevision:lineage})),{code:'invalid-request-revision'});
  await f.store.archive(originalChat,false);await f.store.startTurn(input('running-parent'));
  await assert.rejects(f.store.startTurn(input('running-child',{requestRevision:requestRevision(f,'running-parent')})),{code:'request-active'});
  f.store.event('running-parent',{type:'stopping'});await assert.rejects(f.store.startTurn(input('stopping-child',{requestRevision:requestRevision(f,'running-parent')})),{code:'request-active'});
  f.store.event('running-parent',{type:'cancelled'});await f.store.startTurn(input('valid-child',{requestRevision:lineage}));f.store.event('valid-child',{type:'cancelled'});
  await f.store.archive(originalChat);await f.store.dispose();const restored=fixture(f.disk);assert.equal(restored.store.snapshot().storage.status,'saved');assert.equal(turnOf(restored.store,'valid-child').requestRevision.conversationId,originalChat);await restored.store.dispose();
});

test('plan-step requests cannot be request revision parents or children while ordinary Plan requests remain revisable',async()=>{
  const f=fixture();await completePlan(f);const planContext=selectedPlanContext(f);
  await f.store.startTurn(input('plain-build',{intent:'build'}));f.store.event('plain-build',{type:'cancelled'});
  await assert.rejects(f.store.startTurn(input('revision-with-step',{intent:'build',planContext,requestRevision:requestRevision(f,'plain-build')})),{code:'invalid-request-revision'});
  await f.store.startTurn(input('step-build',{intent:'build',planContext}));f.store.event('step-build',{type:'cancelled'});
  await assert.rejects(f.store.startTurn(input('revision-of-step',{intent:'build',requestRevision:requestRevision(f,'step-build')})),{code:'invalid-request-revision'});
  await f.store.startTurn(input('revised-plan',{intent:'plan',requestRevision:requestRevision(f,'plan-request')}));f.store.event('revised-plan',{type:'cancelled'});await f.store.dispose();
  const invalid=structuredClone(f.disk);invalid.conversations[0].turns.find(turn=>turn.requestId==='step-build').requestRevision={version:1,conversationId:invalid.activeId,requestId:'plain-build'};
  const rejected=fixture(invalid);assert.equal(rejected.store.snapshot().storage.status,'unavailable');await rejected.store.dispose();assert.deepEqual(rejected.disk,invalid);
});

test('schema4 rejects malformed, dangling, cross-chat, forward, cyclic and nonterminal persisted request lineage without writes',async()=>{
  const source=fixture();await completeAsk(source,'parent');await source.store.startTurn(input('child',{requestRevision:requestRevision(source,'parent')}));source.store.event('child',{type:'cancelled'});await source.store.dispose();
  const mutations=[
    v=>v.conversations[0].turns[1].requestRevision.version=2,
    v=>v.conversations[0].turns[1].requestRevision.extra='output',
    v=>delete v.conversations[0].turns[1].requestRevision.conversationId,
    v=>v.conversations[0].turns[1].requestRevision=null,
    v=>v.conversations[0].turns[1].requestRevision.requestId='missing',
    v=>v.conversations[0].turns[1].requestRevision.requestId='child',
    v=>v.conversations[0].turns[1].requestRevision.conversationId='foreign',
    v=>v.conversations[0].turns[0].requestRevision={version:1,conversationId:v.activeId,requestId:'child'},
    v=>v.conversations[0].turns.reverse(),
    v=>v.conversations[0].turns[0].state='running',
    v=>v.conversations[0].turns[0].state='stopping',
    v=>v.conversations[0].turns[1].intent='build',
    v=>v.conversations[0].turns[1].context[0].revision='different',
    v=>v.conversations[0].turns[1].context[0].source+='\n',
    v=>{const child=v.conversations[0].turns.pop();v.conversations.push({...structuredClone(v.conversations[0]),id:'other-chat',turns:[child]});},
    ...[1,2,3].map(version=>v=>v.schemaVersion=version),
  ];
  for(const mutate of mutations){const bad=structuredClone(source.disk);mutate(bad);const f=fixture(bad);assert.equal(f.store.snapshot().storage.status,'unavailable');await assert.rejects(f.store.newConversation(),{code:'history-unavailable'});await f.store.dispose();assert.deepEqual(f.disk,bad);assert.equal(f.writes.length,0);}
});

test('schema3 multi-file checkpoints migrate to schema5 only on mutation and keep all original source and artifacts',async()=>{
  const source=fixture();await completeGroup(source);await source.store.dispose();const old={...structuredClone(source.disk),schemaVersion:3},f=fixture(old);
  assert.equal(f.store.snapshot().schemaVersion,11);assert.equal(f.store.snapshot().storage.status,'saved');await f.store.flush();assert.deepEqual(f.disk,old);assert.equal(f.writes.length,0);
  const parent=turnOf(f.store,'group-request');await f.store.startTurn(groupInput('revised-group',{requestRevision:requestRevision(f,'group-request')}));
  assert.equal(f.disk.schemaVersion,11);assert.deepEqual(turnOf(f.store,'group-request'),parent);assert.equal(turnOf(f.store,'revised-group').changeSet,undefined);assert.equal(turnOf(f.store,'revised-group').proposal,undefined);
  f.store.event('revised-group',{type:'cancelled'});await f.store.dispose();const restored=fixture(f.disk);assert.equal(restored.store.snapshot().storage.status,'saved');assert.deepEqual(turnOf(restored.store,'group-request').changeSet,parent.changeSet);await restored.store.dispose();
});

test('revision storage failures and request capacity preserve the parent and never evict checkpoints',async()=>{
  const f=fixture();await completeAsk(f,'parent');const parent=turnOf(f.store,'parent'),before=structuredClone(f.disk);f.fail=true;
  await assert.rejects(f.store.startTurn(input('failed-child',{requestRevision:requestRevision(f,'parent')})),{code:'history-storage'});
  assert.deepEqual(f.disk,before);assert.deepEqual(turnOf(f.store,'parent'),parent);assert.equal(turnOf(f.store,'failed-child').state,'failed');assert.equal(f.store.snapshot().storage.status,'error');
  f.fail=false;await f.store.retry();assert.equal(f.disk.conversations[0].turns[1].requestRevision.requestId,'parent');await f.store.dispose();
  const restored=fixture(f.disk);assert.equal(restored.store.snapshot().storage.status,'saved');assert.equal(turnOf(restored.store,'failed-child').state,'failed');await restored.store.dispose();
  const full=structuredClone(before),template=full.conversations[0].turns[0];
  full.conversations[0].turns=Array.from({length:40},(_,index)=>({...structuredClone(template),id:`prior-${index}`,requestId:`prior-${index}`}));
  const capacity=fixture(full);await assert.rejects(capacity.store.startTurn(input('over-capacity',{requestRevision:requestRevision(capacity,'prior-0')})),{code:'history-capacity'});
  assert.deepEqual(capacity.disk,full);assert.equal(capacity.writes.length,0);assert.equal(capacity.store.snapshot().conversations[0].turns.length,40);await capacity.store.dispose();
});

const groupRevision=(f,id='group-request')=>{const group=turnOf(f.store,id).changeSet;return {version:1,conversationId:f.store.snapshot().activeId,requestId:id,groupId:group.id,groupRevision:group.revision,groupDigest:changeGroupDigest(group)};};
async function completeRefinement(f,id='refined-group',parentId='group-request'){
 const descriptor=groupRevision(f,parentId);await f.store.startTurn(groupInput(id,{groupRevision:descriptor}));const group=changeSet();group.files[0].after+='\n// refined';
 f.store.event(id,{type:'changeSet',changeSet:group});f.store.event(id,{type:'done'});await f.store.flush();return turnOf(f.store,id);
}

test('current schema saves immutable original-basis group lineage and composed snapshots before restart',async()=>{
 const f=fixture();await completeGroup(f);const parent=turnOf(f.store,'group-request'),descriptor=groupRevision(f);const child=await completeRefinement(f);
 assert.equal(f.disk.schemaVersion,11);assert.deepEqual(child.groupRevision,descriptor);assert.deepEqual(child.context,parent.context);assert.deepEqual(child.changeSet.context,parent.changeSet.context);assert.deepEqual(turnOf(f.store,'group-request'),parent);
 assert.notEqual(child.changeSet.id,parent.changeSet.id);assert.notEqual(child.changeSet.files[0].after,parent.changeSet.files[0].after);assert.equal(child.changeSet.files[0].before,parent.changeSet.files[0].before);
 await f.store.dispose();const restored=fixture(f.disk);assert.equal(restored.store.snapshot().storage.status,'saved');assert.deepEqual(turnOf(restored.store,'refined-group').groupRevision,descriptor);await restored.store.dispose();
});

test('group lineage remains valid after a parent lifecycle counter advances while new requests need its current counter',async()=>{
 const f=fixture();const parent=await completeGroup(f),descriptor=groupRevision(f);await completeRefinement(f);await f.store.updateChangeSet({...parent,revision:1,updatedAt:new Date().toISOString()});
 await assert.rejects(f.store.startTurn(groupInput('stale-refinement',{groupRevision:descriptor})),{code:'invalid-group-revision'});
 await f.store.startTurn(groupInput('current-refinement',{groupRevision:groupRevision(f)}));f.store.event('current-refinement',{type:'cancelled'});await f.store.dispose();
 const restored=fixture(f.disk);assert.equal(restored.store.snapshot().storage.status,'saved');assert.equal(turnOf(restored.store,'refined-group').groupRevision.groupRevision,0);assert.equal(turnOf(restored.store,'group-request').changeSet.revision,1);await restored.store.dispose();
});

test('group refinement rejects forged metadata, mixed contexts and changed original source without mutation',async()=>{
 const f=fixture();await completeGroup(f);const descriptor=groupRevision(f),baseline=structuredClone(f.disk),writes=f.writes.length;
 const variants=[{groupRevision:null},{groupRevision:{...descriptor,extra:true}},{groupRevision:{...descriptor,version:2}},{groupRevision:{...descriptor,groupId:'bad'}},{groupRevision:{...descriptor,groupDigest:'0'.repeat(64)}},{groupRevision:{...descriptor,groupRevision:1}},{groupRevision:{...descriptor,requestId:'missing'}},{groupRevision:{...descriptor,conversationId:'foreign'}},{groupRevision:descriptor,intent:'ask'},{groupRevision:descriptor,context:[...groupContext].reverse()},{groupRevision:descriptor,context:groupContext.slice(0,2)},{groupRevision:descriptor,context:[{...groupContext[0],source:'changed under old identity'},...groupContext.slice(1)]},{groupRevision:descriptor,requestRevision:requestRevision(f,'group-request')}];
 for(const variant of variants)await assert.rejects(f.store.startTurn(groupInput('invalid-refinement',variant)));
 assert.deepEqual(f.disk,baseline);assert.equal(f.writes.length,writes);await f.store.dispose();
});

test('only completed unarchived Build parents grant group refinement and generic revision cannot reuse overlay-dependent instructions',async()=>{
 for(const kind of ['stopped','failed','completedWhileStopping','archived','inactive']){
  const f=fixture();await completeGroup(f);const descriptor=groupRevision(f);
  if(kind==='archived')await f.store.archive(f.store.snapshot().activeId);else if(kind==='inactive')await f.store.newConversation();
  else {await f.store.dispose();const raw=structuredClone(f.disk),parent=raw.conversations[0].turns[0];if(kind==='completedWhileStopping')parent.completedWhileStopping=true;else parent.state=kind;const rejected=fixture(raw);await assert.rejects(rejected.store.startTurn(groupInput('bad-parent',{groupRevision:descriptor})),{code:'invalid-group-revision'});await rejected.store.dispose();continue;}
  await assert.rejects(f.store.startTurn(groupInput('bad-parent',{groupRevision:descriptor})),{code:'invalid-group-revision'});await f.store.dispose();
 }
 const f=fixture();await completeGroup(f);await completeRefinement(f);await assert.rejects(f.store.startTurn(groupInput('generic-revision',{requestRevision:requestRevision(f,'refined-group')})),{code:'invalid-request-revision'});
 await completeRefinement(f,'refined-again','refined-group');await f.store.dispose();const restored=fixture(f.disk);assert.equal(restored.store.snapshot().storage.status,'saved');assert.equal(turnOf(restored.store,'refined-again').groupRevision.requestId,'refined-group');await restored.store.dispose();
});

test('group refinement never accepts a single-file proposal through event, host update or persisted history',async()=>{
 const f=fixture();await completeGroup(f);await f.store.startTurn(groupInput('wrong-artifact',{groupRevision:groupRevision(f)}));
 const single=proposal('wrong-artifact',{baseRevision:groupContext[0].revision,context:groupContext.map(({path,revision})=>({path,revision}))});
 await assert.rejects(f.store.updateProposal(single),{code:'proposal-intent'});assert.equal(f.store.event('wrong-artifact',{type:'proposal',proposal:single}).state,'failed');assert.equal(turnOf(f.store,'wrong-artifact').proposal,undefined);
 await f.store.dispose();const forged=structuredClone(f.disk);forged.conversations[0].turns[1].proposal=single;const rejected=fixture(forged);assert.equal(rejected.store.snapshot().storage.status,'unavailable');await rejected.store.dispose();assert.deepEqual(rejected.disk,forged);
});

test('malformed or impossible persisted group ancestry remains untouched and cannot be legitimized by recovery',async()=>{
 const source=fixture();await completeGroup(source);await completeRefinement(source);await source.store.dispose();
 const variants=[v=>v.conversations[0].turns[1].groupRevision.extra=true,v=>v.conversations[0].turns[1].groupRevision.requestId='refined-group',v=>v.conversations[0].turns[1].groupRevision.groupRevision=999,v=>v.conversations[0].turns[1].groupRevision.groupDigest='0'.repeat(64),v=>v.conversations[0].turns[1].groupRevision.conversationId='foreign',v=>v.conversations[0].turns[0].state='running',v=>v.conversations[0].turns[0].completedWhileStopping=true,v=>v.conversations[0].turns[1].context.reverse(),v=>v.conversations[0].turns[1].context[0].source+='\n',v=>delete v.conversations[0].turns[1].changeSet,v=>v.conversations[0].turns[1].requestRevision={version:1,conversationId:v.activeId,requestId:'group-request'},...[1,2,3,4].map(version=>v=>v.schemaVersion=version)];
 for(const mutate of variants){const bad=structuredClone(source.disk);mutate(bad);const f=fixture(bad);assert.equal(f.store.snapshot().storage.status,'unavailable');await f.store.dispose();assert.deepEqual(f.disk,bad);assert.equal(f.writes.length,0);}
});

test('schema4 request revisions migrate without a write and failed refinement storage never mutates parent evidence',async()=>{
 const source=fixture();await completeAsk(source,'first');await source.store.startTurn(input('second',{requestRevision:requestRevision(source,'first')}));source.store.event('second',{type:'cancelled'});await source.store.dispose();
 const legacy={...structuredClone(source.disk),schemaVersion:4},migrated=fixture(legacy);assert.equal(migrated.store.snapshot().schemaVersion,11);await migrated.store.flush();assert.deepEqual(migrated.disk,legacy);assert.equal(migrated.writes.length,0);await migrated.store.newConversation();assert.equal(migrated.disk.schemaVersion,11);await migrated.store.dispose();
 const f=fixture();await completeGroup(f);const parent=turnOf(f.store,'group-request'),baseline=structuredClone(f.disk);f.fail=true;
 await assert.rejects(f.store.startTurn(groupInput('failed-refinement',{groupRevision:groupRevision(f)})),{code:'history-storage'});assert.deepEqual(f.disk,baseline);assert.deepEqual(turnOf(f.store,'group-request'),parent);assert.equal(turnOf(f.store,'failed-refinement').state,'failed');
 f.fail=false;await f.store.retry();await f.store.dispose();const restored=fixture(f.disk);assert.equal(restored.store.snapshot().storage.status,'saved');assert.equal(turnOf(restored.store,'failed-refinement').groupRevision.requestId,'group-request');await restored.store.dispose();
});


const checkContextFor=f=>({...groupRevision(f),snapshotRevision:'a'.repeat(64),tasks:[{id:'node:test',label:'Node tests'},{id:'typescript:check',label:'TypeScript check'}]});
const suggestionFor=f=>createCheckSuggestion({projectId:'project-orbit',checkContext:checkContextFor(f),raw:JSON.stringify({title:'Verify staged change',summary:'Use the advertised checks.',checks:[{taskId:'node:test',reason:'Exercise discovered tests.'}],limitations:['No runtime behavior was checked.']})});
async function completeSuggestion(f,id='suggestion'){
 const checkContext=checkContextFor(f);await f.store.startTurn(groupInput(id,{intent:'plan',checkContext}));f.store.event(id,{type:'checkSuggestion',checkSuggestion:suggestionFor(f)});f.store.event(id,{type:'done'});await f.store.flush();return turnOf(f.store,id);
}
test('schema6 saves check recommendations with immutable original source ancestry and durable dismissal',async()=>{
 const f=fixture();await completeGroup(f);const parent=turnOf(f.store,'group-request'),turn=await completeSuggestion(f);assert.equal(f.disk.schemaVersion,11);assert.deepEqual(turn.context,parent.context);assert.deepEqual(turnOf(f.store,'group-request'),parent);assert.equal(turn.plan,undefined);const artifact=structuredClone(turn.checkSuggestion);
 await f.store.dismissCheckSuggestion({conversationId:f.store.snapshot().activeId,requestId:turn.requestId,artifactId:artifact.id});assert.equal(turnOf(f.store,'suggestion').checkDismissed,true);assert.deepEqual(turnOf(f.store,'suggestion').checkSuggestion,artifact);await f.store.dispose();const restored=fixture(f.disk);assert.equal(restored.store.snapshot().storage.status,'saved');assert.equal(turnOf(restored.store,'suggestion').checkDismissed,true);await restored.store.dispose();
});
test('check recommendations reject wrong source, stale identity and every mixed handoff before storing',async()=>{
 const f=fixture();await completeGroup(f);const binding=checkContextFor(f),baseline=structuredClone(f.disk),variants=[{intent:'ask'},{context:[...groupContext].reverse()},{context:groupContext.slice(1)},{context:[{...groupContext[0],source:'forged'},...groupContext.slice(1)]},{checkContext:{...binding,groupRevision:1}},{checkContext:{...binding,groupDigest:'0'.repeat(64)}},{checkContext:{...binding,requestId:'missing'}},{checkContext:{...binding,conversationId:'foreign'}},{taskContext:{version:1,featureId:'feature',title:'task',brief:'',revision:0}},{runtimeEvidenceVersion:1,runtimeEvidence:[]},{requestRevision:{version:1,conversationId:f.store.snapshot().activeId,requestId:'group-request'}},{groupRevision:groupRevision(f)},{checkContext:{...binding,tasks:[{id:'shell',label:'Shell'}]}}];
 for(const extra of variants){await assert.rejects(f.store.startTurn(groupInput('invalid-check',{intent:'plan',checkContext:binding,...extra})));assert.deepEqual(f.disk,baseline);}await f.store.dispose();
});
test('check turns cannot complete without their artifact or substitute a planning/source artifact',async()=>{
 for(const kind of ['missing','plan','proposal','changeSet']){const f=fixture();await completeGroup(f);await f.store.startTurn(groupInput('checks',{intent:'plan',checkContext:checkContextFor(f)}));let event={type:'done'};if(kind==='plan')event={type:'plan',plan:createPlanArtifact({raw:JSON.stringify({title:'Plan',summary:'Scope',steps:[{title:'Step',detail:'detail',references:[]}],risks:[],verification:[]}),files:groupContext,projectId:'project-orbit'})};if(kind==='proposal')event={type:'proposal',proposal:proposal('checks')};if(kind==='changeSet')event={type:'changeSet',changeSet:changeSet()};assert.equal(f.store.event('checks',event).state,'failed');assert.equal(turnOf(f.store,'checks').checkSuggestion,undefined);await f.store.dispose();}
});
test('legacy schemas reject recommendation fields and schema5 migration remains read-only',async()=>{
 const parent=fixture();await completeGroup(parent);await parent.store.dispose();const legacy={...structuredClone(parent.disk),schemaVersion:5},migrated=fixture(legacy);assert.equal(migrated.store.snapshot().schemaVersion,11);await migrated.store.flush();assert.deepEqual(migrated.disk,legacy);assert.equal(migrated.writes.length,0);await migrated.store.dispose();
 const f=fixture(parent.disk);await completeSuggestion(f);await f.store.dispose();for(const version of [1,2,3,4,5]){const raw={...structuredClone(f.disk),schemaVersion:version},rejected=fixture(raw);assert.equal(rejected.store.snapshot().storage.status,'unavailable');await rejected.store.dispose();assert.deepEqual(rejected.disk,raw);}
});
test('forged check ancestry, completed state, artifact and dismissal load fail closed',async()=>{
 const f=fixture();await completeGroup(f);await completeSuggestion(f);await f.store.dispose();const mutations=[v=>v.conversations[0].turns[1].checkContext.requestId='suggestion',v=>v.conversations[0].turns[1].checkContext.groupDigest='0'.repeat(64),v=>v.conversations[0].turns[1].checkContext.groupRevision=99,v=>v.conversations[0].turns[1].context.reverse(),v=>v.conversations[0].turns[0].completedWhileStopping=true,v=>delete v.conversations[0].turns[1].checkSuggestion,v=>v.conversations[0].turns[1].checkSuggestion.verificationStatus='passed',v=>v.conversations[0].turns[1].checkSuggestion.checks[0].taskId='shell',v=>v.conversations[0].turns[1].checkDismissed=false,v=>{v.conversations[0].turns[1].state='stopped';v.conversations[0].turns[1].checkDismissed=true;}];for(const mutate of mutations){const raw=structuredClone(f.disk);mutate(raw);const rejected=fixture(raw);assert.equal(rejected.store.snapshot().storage.status,'unavailable');await rejected.store.dispose();assert.deepEqual(rejected.disk,raw);}
});
test('stopped and interrupted recommendations preserve partial output without dismissal or generic revision authority',async()=>{
 const f=fixture();await completeGroup(f);await f.store.startTurn(groupInput('partial-check',{intent:'plan',checkContext:checkContextFor(f)}));f.store.event('partial-check',{type:'delta',text:'partial'});await f.store.flush();const resumed=fixture(f.disk);assert.equal(turnOf(resumed.store,'partial-check').state,'interrupted');assert.equal(resumed.store.event('partial-check',{type:'checkSuggestion',checkSuggestion:suggestionFor(f)}),null);await assert.rejects(resumed.store.dismissCheckSuggestion({conversationId:resumed.store.snapshot().activeId,requestId:'partial-check',artifactId:'missing'}));await assert.rejects(resumed.store.startTurn(groupInput('generic-revision',{intent:'plan',requestRevision:{version:1,conversationId:resumed.store.snapshot().activeId,requestId:'partial-check'}})),{code:'invalid-request-revision'});f.store.event('partial-check',{type:'cancelled'});await Promise.all([f.store.dispose(),resumed.store.dispose()]);
});
test('dismissal storage failure preserves immutable recommendation and retries only its disposition',async()=>{
 const f=fixture();await completeGroup(f);const turn=await completeSuggestion(f),before=structuredClone(f.disk);f.fail=true;await assert.rejects(f.store.dismissCheckSuggestion({conversationId:f.store.snapshot().activeId,requestId:turn.requestId,artifactId:turn.checkSuggestion.id}),{code:'history-storage'});assert.deepEqual(f.disk,before);assert.deepEqual(turnOf(f.store,'suggestion').checkSuggestion,turn.checkSuggestion);f.fail=false;await f.store.retry();assert.equal(f.disk.conversations[0].turns[1].checkDismissed,true);await f.store.dispose();
});


test('check recommendation start failure and capacity limits preserve the Build parent and do not evict history',async()=>{
 const f=fixture();await completeGroup(f);const binding=checkContextFor(f),parent=turnOf(f.store,'group-request'),baseline=structuredClone(f.disk);f.fail=true;await assert.rejects(f.store.startTurn(groupInput('failed-check',{intent:'plan',checkContext:binding})),{code:'history-storage'});assert.deepEqual(f.disk,baseline);assert.deepEqual(turnOf(f.store,'group-request'),parent);assert.equal(turnOf(f.store,'failed-check').state,'failed');f.fail=false;await f.store.retry();await f.store.dispose();const restored=fixture(f.disk);assert.equal(restored.store.snapshot().storage.status,'saved');await restored.store.dispose();
 const full=structuredClone(baseline),template={...structuredClone(parent),intent:'ask'};delete template.changeSet;full.conversations[0].turns.push(...Array.from({length:39},(_,index)=>({...structuredClone(template),id:`ask-${index}`,requestId:`ask-${index}`})));const capped=fixture(full);await assert.rejects(capped.store.startTurn(groupInput('over-cap',{intent:'plan',checkContext:checkContextFor(capped)})),{code:'history-capacity'});assert.deepEqual(capped.disk,full);assert.equal(capped.writes.length,0);await capped.store.dispose();
});

// Source investigation is explicitly shared input; its local captured evidence is
// immutable history, never a restored live graph or a provider tool instruction.
const investigationModule = await import('../../../server/project/source-investigation.mjs');
function investigationInput(requestId='investigated-ask') {
 const source='export const Button = () => null;\n',anchor={path:'src/Button.tsx',revision:sourceHash(source)},other={path:'src/Consumer.tsx',revision:sourceHash('saved consumer')};
 const graph={schemaVersion:1,projectId:'project-orbit',anchor,manifest:[anchor,other,{path:'src/private-unshared.ts',revision:sourceHash('not shared')}],edges:[{id:'relationship-aaaaaaaaaaaaaaaa',kind:'render',from:{...other,line:2,column:1,label:'Consumer'},to:{...anchor,line:1,column:1,label:'Button'},provenance:'source'}],requests:[],boundaries:[],truncated:false};
 const sourceInvestigation=investigationModule.createSourceInvestigation({projectId:'project-orbit',featureId:'feature-profile',featureRevision:3,graph});
 return input(requestId,{context:[{...anchor,source}],sourceInvestigation});
}
async function completedInvestigation(f,id='investigated-ask'){
 const value=investigationInput(id);await f.store.startTurn(value);f.store.event(id,{type:'delta',text:'I1 records a saved-source reference. Its runtime behavior is unknown.'});f.store.event(id,{type:'done'});await f.store.flush();return turnOf(f.store,id);
}
test('schema7 records exact source investigation before dispatch and restores immutable completed evidence',async()=>{
 const f=fixture(),value=investigationInput();const turn=await f.store.startTurn(value);assert.equal(f.disk.schemaVersion,11);assert.deepEqual(f.disk.conversations[0].turns[0].sourceInvestigation,value.sourceInvestigation);
 value.sourceInvestigation.edges[0].from.label='caller mutation';assert.notEqual(turnOf(f.store,turn.requestId).sourceInvestigation.edges[0].from.label,'caller mutation');
 f.store.event(turn.requestId,{type:'start'});f.store.event(turn.requestId,{type:'delta',text:'Saved reference evidence.'});f.store.event(turn.requestId,{type:'done'});await f.store.flush();const old=structuredClone(f.disk),restored=fixture(old);const expected=turnOf(f.store,turn.requestId);if(expected.completedWhileStopping===false)delete expected.completedWhileStopping;assert.deepEqual(turnOf(restored.store,turn.requestId),expected);assert.equal(restored.store.snapshot().schemaVersion,11);assert.equal(restored.writes.length,0);await restored.store.flush();assert.deepEqual(restored.disk,old);assert.equal(restored.writes.length,0);await Promise.all([f.store.dispose(),restored.store.dispose()]);
});
test('investigated Ask rejects mixed contexts, mismatched anchor, source bytes and forged evidence before persistence',async()=>{
 const f=fixture();for(const change of [v=>v.intent='plan',v=>v.intent='build',v=>v.intent='review',v=>v.context.push({...context[0]}),v=>v.context[0].source='changed',v=>v.context[0].path='src/Other.ts',v=>v.sourceInvestigation.projectId='other',v=>v.sourceInvestigation.command='shell',v=>v.taskContext={version:1,featureId:'feature-profile',title:'Profile',brief:'brief',revision:3},v=>v.runtimeEvidence=[],v=>v.planContext={},v=>v.checkContext={},v=>v.requestRevision={},v=>v.groupRevision={}]){const value=investigationInput();change(value);await assert.rejects(f.store.startTurn(value));assert.equal(f.writes.length,0);}
 await completedInvestigation(f);const previous=structuredClone(f.disk),chat=f.store.snapshot().activeId;await assert.rejects(f.store.startTurn({...investigationInput('generic-revision'),sourceInvestigation:undefined,requestRevision:{version:1,conversationId:chat,requestId:'investigated-ask'}}),{code:'invalid-request-revision'});assert.deepEqual(f.disk,previous);await f.store.dispose();
});
test('schema1 through6 reject investigation fields; legacy Ask migration remains non-writing',async()=>{
 const original=fixture();await completedInvestigation(original);await original.store.dispose();
 for(let schemaVersion=1;schemaVersion<=6;schemaVersion++){
  const bad={...structuredClone(original.disk),schemaVersion},rejected=fixture(bad);assert.equal(rejected.store.snapshot().storage.status,'unavailable');await rejected.store.dispose();assert.deepEqual(rejected.disk,bad);assert.equal(rejected.writes.length,0);
  const legacy=structuredClone(bad);delete legacy.conversations[0].turns[0].sourceInvestigation;const migrated=fixture(legacy);assert.equal(migrated.store.snapshot().storage.status,'saved');assert.equal(migrated.store.snapshot().schemaVersion,11);await migrated.store.flush();assert.deepEqual(migrated.disk,legacy);assert.equal(migrated.writes.length,0);await migrated.store.newConversation();assert.equal(migrated.disk.schemaVersion,11);await migrated.store.dispose();
 }
});
test('malformed persisted investigation cannot gain source, artifact or completed verification authority',async()=>{
 const source=fixture();await completedInvestigation(source);await source.store.dispose();
 const mutations=[v=>v.intent='build',v=>v.sourceInvestigation.digest='0'.repeat(64),v=>v.sourceInvestigation.edges[0].provenance='observed',v=>v.context[0].source='changed',v=>v.context.push(context[0]),v=>v.taskContext={version:1,featureId:'feature-profile',title:'Profile',brief:'brief',revision:3},v=>v.runtimeEvidence=[],v=>v.requestRevision={version:1,conversationId:source.disk.activeId,requestId:v.requestId},v=>v.proposal=proposal(v.requestId),v=>v.sourceInvestigation.secret='hidden'];
 for(const change of mutations){const bad=structuredClone(source.disk);change(bad.conversations[0].turns[0]);const f=fixture(bad);assert.equal(f.store.snapshot().storage.status,'unavailable');await f.store.dispose();assert.deepEqual(f.disk,bad);assert.equal(f.writes.length,0);}
});
test('interrupted and stopped investigations preserve captured source and partial answer without continuation',async()=>{
 const f=fixture(),value=investigationInput();await f.store.startTurn(value);f.store.event(value.requestId,{type:'delta',text:'Partial interpretation'});await f.store.flush();const interrupted=fixture(f.disk);assert.equal(turnOf(interrupted.store,value.requestId).state,'interrupted');assert.deepEqual(turnOf(interrupted.store,value.requestId).sourceInvestigation,value.sourceInvestigation);assert.equal(interrupted.store.event(value.requestId,{type:'done'}),null);await interrupted.store.flush();assert.equal(interrupted.disk.conversations[0].turns[0].state,'interrupted');
 f.store.event(value.requestId,{type:'stopping'});f.store.event(value.requestId,{type:'cancelled'});assert.equal(f.store.event(value.requestId,{type:'done'}),null);assert.equal(turnOf(f.store,value.requestId).state,'stopped');await Promise.all([f.store.dispose(),interrupted.store.dispose()]);
});
test('failed local storage prevents investigated request dispatch and retries metadata only',async()=>{
 const f=fixture(),value=investigationInput();f.fail=true;await assert.rejects(f.store.startTurn(value),{code:'history-storage'});assert.equal(f.disk,undefined);assert.equal(turnOf(f.store,value.requestId).state,'failed');assert.deepEqual(turnOf(f.store,value.requestId).sourceInvestigation,value.sourceInvestigation);f.fail=false;await f.store.retry();assert.equal(f.disk.conversations[0].turns[0].state,'failed');assert.equal(f.store.event(value.requestId,{type:'done'}),null);await f.store.dispose();
});
test('existing conversation capacity does not evict investigated history or invent a continuation',async()=>{
 const f=fixture();for(let index=0;index<40;index++)await completedInvestigation(f,`investigation-${index}`);const before=structuredClone(f.disk);await assert.rejects(f.store.startTurn(investigationInput('overflow')),{code:'history-capacity'});assert.deepEqual(f.disk,before);assert.equal(f.disk.conversations[0].turns.length,40);await f.store.dispose();
});
