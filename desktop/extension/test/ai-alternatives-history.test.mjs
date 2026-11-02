import assert from 'node:assert/strict';
import test from 'node:test';
import {createConversationStore} from '../src/conversation-store.mjs';
import {aiAlternativesDigest} from '../../../server/project/ai-alternatives.mjs';
import {alternativeSources,alternativeGenerationFixture,aiAlternativesFixture} from '../../../tests/helpers/ai-alternatives-fixture.mjs';
const input=(requestId,extra={})=>({requestId,prompt:'Explore two save directions.',intent:'build',context:alternativeSources(),alternativeGeneration:alternativeGenerationFixture(),...extra});
const turnOf=(store,id)=>store.snapshot().conversations.flatMap(chat=>chat.turns).find(turn=>turn.requestId===id);
function fixture(previous){let disk=previous,fail=false;const writes=[];const store=createConversationStore({projectId:'fixture',read:()=>disk,write:async value=>{if(fail)throw Error('PRIVATE storage error');disk=structuredClone(value);writes.push(disk);}});return{store,writes,get disk(){return disk;},set fail(value){fail=value;}};}
async function complete(f,id='alternatives'){await f.store.startTurn(input(id));f.store.event(id,{type:'start'});f.store.event(id,{type:'alternatives',alternatives:aiAlternativesFixture()});f.store.event(id,{type:'done'});await f.store.flush();return turnOf(f.store,id);}

test('scope persists before dispatch and both candidates remain immutable across response, snapshots and restart',async()=>{
 const f=fixture(),value=input('alternatives'),original=structuredClone(value.alternativeGeneration);await f.store.startTurn(value);assert.equal(f.disk.schemaVersion,11);assert.deepEqual(f.disk.conversations[0].turns[0].alternativeGeneration,original);
 value.alternativeGeneration.scope.feature.title='Caller mutation';f.store.event('alternatives',{type:'start',alternativeGeneration:value.alternativeGeneration});
 const artifact=aiAlternativesFixture();f.store.event('alternatives',{type:'alternatives',alternatives:artifact});artifact.candidates[0].name='Caller mutation';f.store.event('alternatives',{type:'done'});await f.store.flush();
 const turn=turnOf(f.store,'alternatives');assert.equal(turn.state,'complete');assert.equal(turn.changeSet,undefined);assert.deepEqual(turn.alternativeGeneration,original);assert.equal(turn.alternatives.candidates[0].name,'Explicit');assert.ok(turn.alternatives.candidates.every(candidate=>candidate.changeSet.requestId==='alternatives'));
 const saved=structuredClone(turn.alternatives),restarted=fixture(f.disk);assert.equal(turnOf(restarted.store,'alternatives').state,'complete');assert.equal(aiAlternativesDigest(turnOf(restarted.store,'alternatives').alternatives),aiAlternativesDigest(saved));assert.equal(restarted.writes.length,0);assert.equal(Object.isFrozen(restarted.store.presentation().snapshot.conversations[0].turns[0].alternatives.candidates[0].changeSet.files),true);
 turn.alternatives.candidates[0].name='Snapshot mutation';assert.deepEqual(turnOf(f.store,'alternatives').alternatives,saved);await Promise.all([f.store.dispose(),restarted.store.dispose()]);
});

test('generation rejects combined contexts, unsupported source and ordinary request revision before saving',async()=>{
 const f=fixture();for(const key of ['planContext','requestRevision','groupRevision','checkContext','sourceInvestigation','investigationContext','investigationContinuation','taskContext','decisionContext','issueContext','runtimeEvidence','runtimeEvidenceVersion'])await assert.rejects(f.store.startTurn(input(`mixed-${key}`,{[key]:{}})),{code:'invalid-alternative-generation'});
 for(const intent of ['ask','plan','review'])await assert.rejects(f.store.startTurn(input(intent,{intent})),{code:'invalid-alternative-generation'});
 const bad=input('source');bad.context[0].source+='drift';await assert.rejects(f.store.startTurn(bad),{code:'invalid-alternative-generation'});assert.equal(f.writes.length,0);
 const parent=await complete(f);await assert.rejects(f.store.startTurn({requestId:'revision',prompt:'Try again',intent:'build',context:alternativeSources(),requestRevision:{version:1,conversationId:f.store.snapshot().activeId,requestId:parent.requestId}}),{code:'invalid-request-revision'});await f.store.dispose();
});

test('candidate source updates and replacement artifacts cannot mutate immutable generation history',async()=>{
 const f=fixture(),turn=await complete(f),before=structuredClone(turn.alternatives),group=turn.alternatives.candidates[0].changeSet;
 await assert.rejects(f.store.updateChangeSet({...group,status:'discarded',revision:1}),{code:'change-set-context'});
 assert.equal(f.store.event(turn.requestId,{type:'alternatives',alternatives:aiAlternativesFixture()}),null);assert.deepEqual(turnOf(f.store,turn.requestId).alternatives,before);
 await f.store.startTurn(input('replace'));const candidate=aiAlternativesFixture();f.store.event('replace',{type:'alternatives',alternatives:candidate});candidate.candidates[0].name='Different';f.store.event('replace',{type:'alternatives',alternatives:candidate});assert.equal(turnOf(f.store,'replace').state,'failed');assert.equal(turnOf(f.store,'replace').alternatives.candidates[0].name,'Explicit');await f.store.dispose();
});

test('malformed artifacts, missing candidates and cross-request ownership never complete a generation',async()=>{
 for(const kind of ['missing','foreign-request','wrong-generation','ordinary-group','ordinary-proposal','malformed']){const f=fixture();await f.store.startTurn(input(kind));const artifact=aiAlternativesFixture();if(kind==='foreign-request')artifact.candidates[0].changeSet.requestId='other';if(kind==='wrong-generation')artifact.generation.scope.feature.revision++;if(kind==='malformed')artifact.candidates[0].changeSet.files[0].before='forged';if(['foreign-request','wrong-generation','malformed'].includes(kind))f.store.event(kind,{type:'alternatives',alternatives:artifact});if(kind==='ordinary-group')f.store.event(kind,{type:'changeSet',changeSet:artifact.candidates[0].changeSet});if(kind==='ordinary-proposal')f.store.event(kind,{type:'proposal',proposal:{}});f.store.event(kind,{type:'done'});const turn=turnOf(f.store,kind);assert.equal(turn.state,'failed');assert.equal(turn.alternatives,undefined);assert.equal(turn.changeSet,undefined);await f.store.dispose();}
});

test('duplicate candidate identities are reserved against all other conversation artifacts',async()=>{
 const f=fixture(),first=await complete(f);await f.store.startTurn(input('duplicate'));const duplicate=aiAlternativesFixture();duplicate.candidates[0].changeSet.id=first.alternatives.candidates[1].changeSet.id;f.store.event('duplicate',{type:'alternatives',alternatives:duplicate});assert.equal(turnOf(f.store,'duplicate').state,'failed');assert.equal(turnOf(f.store,'duplicate').alternatives,undefined);
 await f.store.startTurn({requestId:'ordinary',prompt:'Build this',intent:'build',context:alternativeSources()});const group=aiAlternativesFixture().candidates[0].changeSet;group.id=first.alternatives.candidates[0].changeSet.id;f.store.event('ordinary',{type:'changeSet',changeSet:group});assert.equal(turnOf(f.store,'ordinary').state,'failed');assert.equal(turnOf(f.store,'ordinary').changeSet,undefined);await f.store.dispose();
});

test('schema1–10 remains unchanged on read, while retroactive generation injection is unavailable',async()=>{
 const seed=fixture();await seed.store.startTurn({requestId:'old',prompt:'Explain source',intent:'ask',context:alternativeSources()});seed.store.event('old',{type:'done'});await seed.store.dispose();
 for(const schemaVersion of [1,2,3,4,5,6,7,8,9,10]){const old={...structuredClone(seed.disk),schemaVersion},f=fixture(old);assert.equal(f.store.snapshot().schemaVersion,11);assert.equal(f.store.snapshot().storage.status,'saved');await f.store.flush();assert.equal(f.writes.length,0);assert.deepEqual(f.disk,old);await f.store.newConversation();assert.equal(f.disk.schemaVersion,11);await f.store.dispose();}
 const generated=fixture();await complete(generated);await generated.store.dispose();for(const schemaVersion of [1,2,3,4,5,6,7,8,9,10]){const old={...structuredClone(generated.disk),schemaVersion},f=fixture(old);assert.equal(f.store.snapshot().storage.status,'unavailable');assert.equal(f.writes.length,0);assert.deepEqual(f.disk,old);await f.store.dispose();}
});

test('interruption and storage recovery retain disclosure without resuming a provider request or selecting a candidate',async()=>{
 const f=fixture();await f.store.startTurn(input('running'));f.store.event('running',{type:'delta',text:'{"candidates":['});await f.store.flush();const restarted=fixture(f.disk);assert.equal(turnOf(restarted.store,'running').state,'interrupted');assert.equal(turnOf(restarted.store,'running').alternatives,undefined);assert.deepEqual(turnOf(restarted.store,'running').alternativeGeneration,alternativeGenerationFixture());assert.equal(restarted.store.event('running',{type:'done'}),null);
 const failed=fixture();failed.fail=true;await assert.rejects(failed.store.startTurn(input('save-failure')),{code:'history-storage'});assert.equal(turnOf(failed.store,'save-failure').state,'failed');failed.fail=false;await failed.store.retry();assert.deepEqual(failed.disk.conversations[0].turns[0].alternativeGeneration,alternativeGenerationFixture());assert.equal(failed.disk.conversations[0].turns[0].alternatives,undefined);await Promise.all([f.store.dispose(),restarted.store.dispose(),failed.store.dispose()]);
});

test('ordinary later turns and new conversations do not carry generation context or candidates',async()=>{
 const f=fixture();await complete(f);await f.store.startTurn({requestId:'next',prompt:'Explain source',intent:'ask',context:alternativeSources()});f.store.event('next',{type:'start',alternativeGeneration:alternativeGenerationFixture()});f.store.event('next',{type:'done'});assert.equal(turnOf(f.store,'next').alternativeGeneration,undefined);assert.equal(turnOf(f.store,'next').alternatives,undefined);await f.store.newConversation();await f.store.startTurn({requestId:'new',prompt:'Explain source',intent:'ask',context:alternativeSources()});assert.equal(turnOf(f.store,'new').alternativeGeneration,undefined);await f.store.dispose();
});
