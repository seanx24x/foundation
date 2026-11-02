import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeProjectDecision,projectDecisionDigest,projectDecisionEvidenceDigest,normalizeProjectDecisionContext,assessProjectDecision,PROJECT_DECISION_LIMITS} from '../server/project/project-decisions.mjs';
import {projectDecisionFixture,decisionHash} from './helpers/project-decision-fixture.mjs';
const clone=value=>structuredClone(value);
const context=decision=>({version:1,projectId:decision.projectId,decisions:[{decision,digest:projectDecisionDigest(decision)}]});
const current=decision=>({files:clone(decision.contextFiles),adoptionStatus:'applied',comparisonDigest:decision.choice.comparisonDigest});

test('token and whole-group decisions normalize to detached metadata without copied source or evidence bodies',()=>{
 for(const kind of ['token','change-set']){const input=projectDecisionFixture({kind}),result=normalizeProjectDecision(input,{projectId:input.projectId});assert.deepEqual(result,input);input.rationale='Caller mutation';input.choice.files[0].afterHash=decisionHash('caller');assert.notEqual(result.rationale,input.rationale);assert.notEqual(result.choice.files[0].afterHash,input.choice.files[0].afterHash);assert.doesNotMatch(JSON.stringify(result),/"before":|"after":|"source":|"observations":|data:image/);}
});

test('nested unknown data, forged statuses and incompatible source/adoption identities fail closed',()=>{
 const changes=[v=>v.source='PRIVATE',v=>v.choice.body='PRIVATE',v=>v.choice.scope.feature.raw='PRIVATE',v=>v.adoption.kind='change-set',v=>v.choice.files[0].afterHash='a'.repeat(16),v=>v.contextFiles[0].hash=decisionHash('wrong'),v=>v.contextFiles.pop(),v=>v.feature.title='Different',v=>v.choice.evidence[0].run.status='running',v=>v.choice.evidence[0].replay.status='failed',v=>v.choice.evidence[1].run.id=v.choice.evidence[0].run.id,v=>v.choice.evidence[0].run.requestCount=4,v=>v.choice.evidence[0].run.unattributedRequestCount=2,v=>v.choice.sourceRelationship='verified',v=>v.choice.assessment='matched',v=>v.choice.compilation='passed',v=>v.choice.requested.viewportWidthCss=800,v=>v.choice.scope.screen.route='https://remote.example',v=>v.choice.recipe.route='/other',v=>v.feature.paths.push('../secret'),v=>v.adoption.appliedAt='2026-11-01T00:00:00.000Z',v=>v.supersedes=v.id];
 for(const change of changes){const input=projectDecisionFixture();change(input);assert.throws(()=>normalizeProjectDecision(input));}
 assert.throws(()=>normalizeProjectDecision(projectDecisionFixture(),{projectId:'other'}));
});

test('group provenance and whole scope remain strict',()=>{
 for(const change of [v=>delete v.choice.sourceRevision,v=>delete v.choice.sourceDigest,v=>delete v.adoption.checkpointId,v=>v.choice.files.pop(),v=>v.choice.sourceRevision=-1,v=>v.adoption.revision='3',v=>v.contextFiles.push(clone(v.contextFiles[0]))]){const value=projectDecisionFixture({kind:'change-set'});change(value);assert.throws(()=>normalizeProjectDecision(value));}
});

test('decision fingerprints ignore object insertion order and change with exact rationale or evidence',()=>{
 const value=projectDecisionFixture(),reordered=JSON.parse(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).reverse()):item));assert.equal(projectDecisionDigest(value),projectDecisionDigest(reordered));assert.equal(projectDecisionEvidenceDigest({a:1,b:undefined}),projectDecisionEvidenceDigest({a:1}));
 for(const mutate of [v=>v.rationale+=' A second reason.',v=>v.choice.evidence[0].run.digest=decisionHash('new evidence'),v=>v.adoption.id=randomUUID()]){const changed=clone(value);mutate(changed);assert.notEqual(projectDecisionDigest(value),projectDecisionDigest(changed));}
});

test('explicit context snapshots are cloned, project-bound, exact, and digest checked',()=>{
 const decision=projectDecisionFixture(),input=context(clone(decision)),result=normalizeProjectDecisionContext(input,{projectId:decision.projectId});assert.deepEqual(result,input);input.decisions[0].decision.rationale='Changed';assert.notEqual(result.decisions[0].decision.rationale,input.decisions[0].decision.rationale);assert.equal(normalizeProjectDecisionContext(undefined),undefined);
 for(const mutate of [v=>v.projectId='foreign',v=>v.extra='PRIVATE',v=>v.decisions[0].raw='PRIVATE',v=>v.decisions[0].digest=decisionHash('forged'),v=>v.decisions[0].decision.rationale='Changed',v=>v.decisions.push(clone(v.decisions[0])),v=>v.decisions=[]]){const value=context(decision);mutate(value);assert.throws(()=>normalizeProjectDecisionContext(value,{projectId:decision.projectId}),{status:400,code:'invalid-decision-context'});}
});

test('context count and UTF-8 byte limits reject oversized disclosure without modifying the record',()=>{
 const decisions=Array.from({length:5},()=>projectDecisionFixture());assert.throws(()=>normalizeProjectDecisionContext({version:1,projectId:decisions[0].projectId,decisions:decisions.map(decision=>({decision,digest:projectDecisionDigest(decision)}))}),{code:'invalid-decision-context'});
 const large=projectDecisionFixture();large.feature.paths.push(...Array.from({length:30},(_,index)=>`src/${index}-${'x'.repeat(500)}.tsx`));large.choice.scope.feature=clone(large.feature);large.contextFiles=large.feature.paths.map(path=>({path,hash:large.choice.files.find(file=>file.path===path)?.afterHash??decisionHash(path)}));assert.doesNotThrow(()=>normalizeProjectDecision(large));assert.ok(Buffer.byteLength(JSON.stringify(context(large)))>PROJECT_DECISION_LIMITS.contextBytes);assert.throws(()=>normalizeProjectDecisionContext(context(large)),{code:'invalid-decision-context'});assert.equal(large.feature.paths.length,32);
});

test('freshness tracks every supporting source and drafts, separately from Undo and supersession',()=>{
 const decision=projectDecisionFixture(),state=current(decision);assert.deepEqual(assessProjectDecision(decision,state),{source:'current',adoption:'applied',evidence:'available'});state.files[1].hash=decisionHash('supporting edit');state.adoptionStatus='undone';state.supersededBy=randomUUID();assert.deepEqual(assessProjectDecision(decision,state),{source:'stale',adoption:'undone',evidence:'available',supersededBy:state.supersededBy});const fresh=current(decision);fresh.dirtyPaths=[fresh.files[0].path];assert.equal(assessProjectDecision(decision,fresh).source,'stale');assert.equal(decision.rationale,'The explicit saving state makes the request easier to follow.');
});

test('missing source, missing adoption, changed evidence, and pruned evidence stay distinguishable',()=>{
 const decision=projectDecisionFixture(),state=current(decision);state.files[0].hash=null;state.adoptionStatus='missing';state.comparisonDigest=decisionHash('different comparison');assert.deepEqual(assessProjectDecision(decision,state),{source:'missing',adoption:'missing',evidence:'changed'});delete state.comparisonDigest;assert.equal(assessProjectDecision(decision,state).evidence,'missing');state.files=[];assert.equal(assessProjectDecision(decision,state).source,'missing');assert.throws(()=>assessProjectDecision(decision,{...state,source:'current'}));
});

test('historical explicit snapshots remain valid after current source is stale or undone',()=>{
 const decision=projectDecisionFixture(),shared=context(decision),state=current(decision);state.adoptionStatus='undone';state.files[0].hash=decision.choice.files[0].beforeHash;assert.equal(assessProjectDecision(decision,state).source,'stale');assert.deepEqual(normalizeProjectDecisionContext(shared),shared);
});

test('sparse or annotated arrays cannot smuggle fields or omit required metadata',()=>{
 const decision=projectDecisionFixture();for(const mutate of [v=>delete v.feature.paths[0],v=>v.feature.paths.raw='PRIVATE',v=>delete v.contextFiles[0],v=>v.choice.evidence.raw='PRIVATE']){const item=clone(decision);mutate(item);assert.throws(()=>normalizeProjectDecision(item));}
 const sparse=context(decision);delete sparse.decisions[0];assert.throws(()=>normalizeProjectDecisionContext(sparse),{code:'invalid-decision-context'});
});
