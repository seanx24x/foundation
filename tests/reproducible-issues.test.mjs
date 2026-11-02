import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeReproducibleIssue,reproducibleIssueDigest,reproducibleIssueEvidenceDigest,normalizeReproducibleIssueContext,assessReproducibleIssue,REPRODUCIBLE_ISSUE_LIMITS} from '../server/project/reproducible-issues.mjs';
import {reproducibleIssueFixture,reproducibleIssueContextFixture,issueHash} from './helpers/reproducible-issue-fixture.mjs';
const clone=value=>structuredClone(value);
const reseal=value=>{value.runDigest=reproducibleIssueEvidenceDigest(value.run);if(value.replay)value.replay.digest=reproducibleIssueEvidenceDigest(value.replay.replay);if(value.capture)value.capture.digest=reproducibleIssueEvidenceDigest(value.capture.capture);return value;};
const current=issue=>({files:clone(issue.contextFiles),runDigest:issue.runDigest,replayDigest:issue.replay?.digest,captureDigest:issue.capture?.digest});

test('completed, cancelled and interrupted issues retain exact observed and authored metadata without source or image bodies',()=>{
 for(const status of ['completed','cancelled','interrupted']){const input=reproducibleIssueFixture({status}),result=normalizeReproducibleIssue(input,{projectId:input.projectId});assert.deepEqual(result,input);input.actualOutcome='Caller mutation';input.run.observations[0].status=200;assert.notEqual(result.actualOutcome,input.actualOutcome);assert.equal(result.run.observations[0].status,503);assert.equal(result.run.observations[0].correlation,'unattributed');assert.equal(result.sourceRelationship,'unverified');assert.equal(result.compilation,'not-recorded');assert.doesNotMatch(JSON.stringify(result),/"source":|"body":|"png":|data:image/);}
});

test('optional replay and capture are separately absent without inventing evidence',()=>{
 for(const capture of [false,true])for(const replay of [false,true]){const issue=reproducibleIssueFixture({capture,replay});assert.deepEqual(normalizeReproducibleIssue(issue),issue);const assessment=assessReproducibleIssue(issue,current(issue));assert.equal(assessment.capture,capture?'available':'not-attached');assert.equal(assessment.replay,replay?'available':'not-attached');}
});

test('full frozen run and exact hashes reject forged provenance, live runs, inferred causality and unknown data',()=>{
 const changes=[v=>v.rawSource='PRIVATE',v=>v.run.body='PRIVATE',v=>v.run.feature.raw='PRIVATE',v=>v.run.status='recording',v=>delete v.run.endedAt,v=>v.run.endedAt='2026-10-31T19:00:00.000Z',v=>v.run.status='cancelled',v=>v.run.observations[0].correlation='caused-by-button',v=>v.run.observations[0].body='PRIVATE',v=>v.run.sources[0].revision='a'.repeat(16),v=>v.run.sources.push(clone(v.run.sources[0])),v=>v.run.sources[0].path='../secret',v=>v.run.feature.paths.push('../secret'),v=>v.contextFiles.pop(),v=>v.contextFiles.push(clone(v.contextFiles[0])),v=>v.contextFiles[0].hash='a'.repeat(16),v=>v.sourceRelationship='verified',v=>v.compilation='passed',v=>v.run.runtime.documentId='forged',v=>v.run.runtime.route='/other',v=>v.run.scenario.screenId=randomUUID(),v=>v.run.screen.featureId=randomUUID(),v=>v.run.dirtyPaths=['not-in-feature.tsx'],v=>v.title=' x',v=>v.actualOutcome='',v=>v.actualOutcome='x'.repeat(2001),v=>v.runDigest=issueHash('forged')];
 for(const change of changes){const issue=reproducibleIssueFixture();change(issue);assert.throws(()=>normalizeReproducibleIssue(issue));}assert.throws(()=>normalizeReproducibleIssue(reproducibleIssueFixture(),{projectId:'foreign'}));
});

test('request metadata is bounded, sanitized and anchored to the recorded document and interval',()=>{
 const changes=[v=>v.run.observations[0].url='https://user:password@example.com/api',v=>v.run.observations[0].url='https://example.com/api?secret=x',v=>v.run.observations[0].url='https://example.com/api#secret',v=>v.run.observations[0].url='file:///private/secret',v=>v.run.observations[0].url='not a URL',v=>v.run.observations[0].session='e'.repeat(32),v=>v.run.observations[0].documentId='f'.repeat(32),v=>v.run.observations[0].id='wrong:1',v=>v.run.observations[0].status=999,v=>v.run.observations[0].durationMs=Infinity,v=>v.run.observations[0].method='POST\nSECRET',v=>v.run.observations[0].observedAt=null,v=>v.run.observations[0].observedAt='2026-10-31T19:59:59.000Z',v=>v.run.observations.push(clone(v.run.observations[0]))];
 for(const change of changes){const issue=reproducibleIssueFixture();change(issue);try{reseal(issue);}catch{}assert.throws(()=>normalizeReproducibleIssue(issue));}
});

test('reproduction steps and expected result preserve the exact recorded scenario rather than an unrecorded recipe',()=>{
 for(const mutate of [v=>v.reproduction.steps[0]='Changed',v=>v.reproduction.expectedOutcome='Different',v=>v.reproduction.origin='authored',v=>v.reproduction.raw='PRIVATE',v=>v.run.scenario.steps=[],v=>v.run.scenario.steps=Array(13).fill('Choose Save'),v=>v.run.scenario.steps[0]='x'.repeat(501)]){const issue=reproducibleIssueFixture();mutate(issue);reseal(issue);assert.throws(()=>normalizeReproducibleIssue(issue));}
});

test('capture and replay references cannot attach evidence from another run, source basis or session',()=>{
 for(const key of ['capture','replay'])for(const mutate of [v=>v.runId=randomUUID(),v=>v.featureId=randomUUID(),v=>v.screenId=randomUUID(),v=>v.scenarioId=randomUUID(),v=>v.binding.sources[0].revision=issueHash('other-source'),v=>v.binding.runtime.documentId='f'.repeat(32),v=>v.binding.startedAt='2026-10-31T19:59:54.000Z',v=>v.binding.definitionRevision++,v=>v.binding.dirtyPaths.push(v.binding.sources[0].path),v=>v.sourceRelationship='verified',v=>v.raw='PRIVATE']){const issue=reproducibleIssueFixture();mutate(issue[key][key]);reseal(issue);assert.throws(()=>normalizeReproducibleIssue(issue));}
 for(const key of ['capture','replay']){const issue=reproducibleIssueFixture();issue[key].digest=issueHash('forged');assert.throws(()=>normalizeReproducibleIssue(issue));}
});

test('capture retains only a valid bounded PNG identity and known browser conditions',()=>{
 for(const mutate of [v=>v.image.assetId=randomUUID(),v=>v.image.sha256='x',v=>v.image.byteLength=16*1024*1024+1,v=>v.image.widthPx=9000,v=>{v.image.widthPx=8192;v.image.heightPx=8192;},v=>v.image.mimeType='image/jpeg',v=>v.image.png='PRIVATE',v=>v.conditions.appTheme='dark',v=>v.conditions.dataState='user-account',v=>v.conditions.scrollYCss=Infinity]){const issue=reproducibleIssueFixture();mutate(issue.capture.capture);try{reseal(issue);}catch{}assert.throws(()=>normalizeReproducibleIssue(issue));}
});

test('terminal replay progress is ordered and cannot claim unfinished or failed steps completed',()=>{
 for(const mutate of [v=>v.status='running',v=>delete v.endedAt,v=>v.prepare.status='failed',v=>v.steps[0].status='running',v=>v.steps[0].effects='not-started',v=>v.steps[0].id='wrong-step',v=>v.recipe.route='/other',v=>v.recipe.registrationId='x',v=>v.recipe.steps.push(clone(v.recipe.steps[0])),v=>v.requested.viewportWidthCss=777,v=>v.observed.deviceScaleFactor=0,v=>v.reason='step-failed']){const issue=reproducibleIssueFixture();mutate(issue.replay.replay);reseal(issue);assert.throws(()=>normalizeReproducibleIssue(issue));}
 const issue=reproducibleIssueFixture();issue.replay.replay.status='failed';issue.replay.replay.reason='step-failed';issue.replay.replay.steps[0].status='failed';reseal(issue);assert.doesNotThrow(()=>normalizeReproducibleIssue(issue));
});

test('fingerprints are independent of key order and bind authored text, exact source and observed outcomes',()=>{
 const issue=reproducibleIssueFixture(),reordered=JSON.parse(JSON.stringify(issue,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).reverse()):item));assert.equal(reproducibleIssueDigest(issue),reproducibleIssueDigest(reordered));assert.equal(reproducibleIssueEvidenceDigest({a:1,b:undefined}),reproducibleIssueEvidenceDigest({a:1}));
 for(const mutate of [v=>v.actualOutcome+=' It happened twice.',v=>v.contextFiles[0].hash=issueHash('changed-source'),v=>v.run.observations[0].status=502]){const changed=clone(issue);mutate(changed);reseal(changed);assert.notEqual(reproducibleIssueDigest(issue),reproducibleIssueDigest(changed));}
});

test('freshness distinguishes original run source from saved source at issue capture',()=>{
 const issue=reproducibleIssueFixture();issue.contextFiles[0].hash=issueHash('changed since run');const state=current(issue);assert.deepEqual(assessReproducibleIssue(issue,state),{source:'stale',captureSource:'current',run:'available',replay:'available',capture:'available'});state.files[0].hash=issue.run.sources[0].revision;assert.deepEqual(assessReproducibleIssue(issue,state),{source:'current',captureSource:'stale',run:'available',replay:'available',capture:'available'});state.dirtyPaths=[state.files[0].path];assert.equal(assessReproducibleIssue(issue,state).source,'stale');assert.equal(assessReproducibleIssue(issue,state).captureSource,'stale');state.files[0].hash=null;assert.equal(assessReproducibleIssue(issue,state).source,'missing');assert.equal(assessReproducibleIssue(issue,state).captureSource,'missing');
});

test('original unsaved source remains unverified even if current saved hashes match',()=>{
 const issue=reproducibleIssueFixture({replay:false,capture:false});issue.run.dirtyPaths=[issue.run.sources[0].path];reseal(issue);const assessment=assessReproducibleIssue(issue,current(issue));assert.equal(assessment.source,'stale');assert.equal(assessment.captureSource,'current');assert.equal(issue.run.dirtyPaths.length,1);
});

test('retained run, replay and capture availability are assessed independently',()=>{
 const issue=reproducibleIssueFixture(),state=current(issue);delete state.runDigest;state.replayDigest=issueHash('changed replay');state.captureDigest=null;assert.deepEqual(assessReproducibleIssue(issue,state),{source:'current',captureSource:'current',run:'missing',replay:'changed',capture:'missing'});state.files=[];assert.equal(assessReproducibleIssue(issue,state).source,'missing');assert.throws(()=>assessReproducibleIssue(issue,{...state,backend:'known'}));
});

test('explicit context preserves frozen historical freshness while disclosing no source bodies or image bytes',()=>{
 const context=reproducibleIssueContextFixture();context.issues[0].assessment={source:'stale',captureSource:'missing',run:'missing',replay:'changed',capture:'missing'};const result=normalizeReproducibleIssueContext(context,{projectId:context.projectId});assert.deepEqual(result,context);context.issues[0].issue.actualOutcome='Caller';context.issues[0].assessment.source='current';assert.notEqual(result.issues[0].issue.actualOutcome,context.issues[0].issue.actualOutcome);assert.equal(result.issues[0].assessment.source,'stale');assert.equal(normalizeReproducibleIssueContext(undefined),undefined);
});

test('context is project-bound, exact, digest checked and requires a truthful-shaped assessment',()=>{
 for(const mutate of [v=>v.projectId='foreign',v=>v.raw='PRIVATE',v=>v.issues[0].raw='PRIVATE',v=>v.issues[0].digest=issueHash('forged'),v=>v.issues[0].issue.actualOutcome='Forged',v=>delete v.issues[0].assessment,v=>v.issues[0].assessment.source='verified',v=>v.issues[0].assessment.capture='not-attached',v=>v.issues[0].assessment.replay='not-attached',v=>v.issues.push(clone(v.issues[0])),v=>v.issues=[]]){const context=reproducibleIssueContextFixture();mutate(context);assert.throws(()=>normalizeReproducibleIssueContext(context,{projectId:'reproducible-issues-test'}),{code:'invalid-issue-context',status:400});}
 const absent=reproducibleIssueContextFixture({replay:false,capture:false});absent.issues[0].assessment.capture='available';assert.throws(()=>normalizeReproducibleIssueContext(absent),{code:'invalid-issue-context'});
});

test('sparse and annotated arrays are rejected at every retained and disclosed boundary',()=>{
 for(const mutate of [v=>delete v.run.sources[0],v=>v.run.feature.paths.raw='PRIVATE',v=>delete v.contextFiles[0],v=>v.run.observations.raw='PRIVATE',v=>delete v.reproduction.steps[0],v=>v.replay.replay.steps.raw='PRIVATE']){const issue=reproducibleIssueFixture();mutate(issue);assert.throws(()=>normalizeReproducibleIssue(issue));}const context=reproducibleIssueContextFixture();delete context.issues[0];assert.throws(()=>normalizeReproducibleIssueContext(context),{code:'invalid-issue-context'});
});

test('record and sharing size budgets fail closed without truncating request evidence',()=>{
 const issue=reproducibleIssueFixture({replay:false,capture:false}),first=issue.run.observations[0];issue.run.observations=Array.from({length:100},(_,index)=>({...clone(first),id:`${issue.run.runtime.session}:${issue.run.runtime.viewId}:${index}`,url:`https://example.com/${'x'.repeat(980)}`}));reseal(issue);assert.ok(Buffer.byteLength(JSON.stringify(issue))>REPRODUCIBLE_ISSUE_LIMITS.recordBytes);assert.throws(()=>normalizeReproducibleIssue(issue),{code:'reproducible-issue-capacity'});assert.equal(issue.run.observations.length,100);assert.equal(REPRODUCIBLE_ISSUE_LIMITS.contextBytes,64*1024);assert.equal(REPRODUCIBLE_ISSUE_LIMITS.contextRecords,1);
});

test('historical clock reversal preserves terminal evidence without fabricating chronology or a duration',()=>{
 const issue=reproducibleIssueFixture();issue.replay.replay.endedAt='2025-01-01T00:00:00.000Z';issue.replay.replay.steps[0].endedAt='2025-01-01T00:00:00.000Z';issue.capture.capture.capturedAt='2025-01-01T00:00:00.000Z';reseal(issue);assert.deepEqual(normalizeReproducibleIssue(issue),issue);assert.equal('durationMs'in issue.replay.replay,false);
});
