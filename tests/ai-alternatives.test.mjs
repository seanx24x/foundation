import test from 'node:test';
import assert from 'node:assert/strict';
import {createAIAlternatives,normalizeAIAlternatives,normalizeAlternativeGeneration,validateAlternativeGenerationFiles,aiAlternativesDigest,AI_ALTERNATIVE_LIMITS} from '../server/project/ai-alternatives.mjs';
import {alternativeSources,alternativeGenerationFixture,alternativeRawFixture,aiAlternativesFixture,alternativeHash} from './helpers/ai-alternatives-fixture.mjs';
const create=(raw=alternativeRawFixture(),files=alternativeSources(),generation=alternativeGenerationFixture())=>createAIAlternatives({raw:JSON.stringify(raw),files,projectId:'fixture',generation});

test('two named alternatives retain one exact saved source basis and independent unverified groups',()=>{
 const files=alternativeSources(),before=structuredClone(files),generation=alternativeGenerationFixture(),artifact=create(undefined,files,generation);
 assert.equal(artifact.candidates.length,2);assert.equal(artifact.verificationStatus,'not-run');assert.deepEqual(artifact.generation,generation);
 for(const candidate of artifact.candidates){assert.equal(candidate.changeSet.origin,'ai');assert.equal(candidate.changeSet.status,'proposed');assert.equal(candidate.changeSet.revision,0);assert.equal(candidate.changeSet.verificationStatus,'not-run');assert.equal(candidate.changeSet.requestId,undefined);assert.equal(candidate.changeSet.files.length,2);assert.deepEqual(candidate.changeSet.context,files.map(({path,revision})=>({path,revision})));for(const file of candidate.changeSet.files)assert.equal(file.before,files.find(item=>item.path===file.path).source);}
 assert.notEqual(artifact.candidates[0].changeSet.files[0].after,artifact.candidates[1].changeSet.files[0].after);assert.deepEqual(files,before);
 assert.deepEqual(normalizeAIAlternatives(artifact,'fixture',files),artifact);assert.match(aiAlternativesDigest(artifact),/^[a-f0-9]{64}$/);
 const shuffled=Object.fromEntries(Object.entries(artifact).reverse());assert.equal(aiAlternativesDigest(shuffled),aiAlternativesDigest(artifact));
 const originalDigest=aiAlternativesDigest(artifact);artifact.candidates[0].name='Caller changed';assert.notEqual(aiAlternativesDigest(artifact),originalDigest);
});

test('malformed, duplicate, same-result and unsupported model alternatives are rejected as a whole',()=>{
 const cases=[v=>v.extra='forged',v=>v.candidates.pop(),v=>v.candidates.push(v.candidates[0]),v=>v.candidates[1].name='explicit',v=>v.candidates[1].edits=structuredClone(v.candidates[0].edits),v=>v.candidates[0].edits.pop(),v=>v.candidates[0].edits[0].path='src/unknown.ts',v=>v.candidates[0].edits[0].find='absent',v=>v.candidates[0].edits[0].replace='"Save"',v=>v.candidates[0].status='applied',v=>v.candidates[0].name='x'.repeat(81),v=>v.candidates[0].name=' Leading',v=>v.candidates[0].reason='x'.repeat(2001),v=>v.candidates[0].verification=['x'.repeat(501)],v=>v.candidates[0].edits.push(v.candidates[0].edits[0])];
 for(const change of cases){const raw=alternativeRawFixture();change(raw);assert.throws(()=>create(raw));}
 for(const raw of ['not JSON','{}','null','[]','x'.repeat(AI_ALTERNATIVE_LIMITS.rawBytes+1)])assert.throws(()=>createAIAlternatives({raw,files:alternativeSources(),projectId:'fixture',generation:alternativeGenerationFixture()}));
});

test('each generation scope is exact, local and linked to its feature, screen and scenario',()=>{
 assert.equal(normalizeAlternativeGeneration(undefined),undefined);
 const mutations=[v=>v.count=3,v=>v.version=2,v=>v.tools=['shell'],v=>v.scope.scenario.screenId=v.scope.feature.id,v=>v.scope.screen.featureId=v.scope.screen.id,v=>v.scope.screen.targetId='xcode:build',v=>v.scope.screen.archived=true,v=>v.scope.scenario.archived=true,v=>v.scope.screen.route='https://other.example',v=>v.scope.feature.paths.push('../secret.ts'),v=>v.scope.scenario.steps=[],v=>v.scope.definitionRevision=-1,v=>v.scope.feature.revision=NaN,v=>v.scope.scenario.expectedOutcome='x'.repeat(2001),v=>v.scope.scenario.steps[0]='\0',v=>v.scope.screen.updatedAt='bad'];
 for(const change of mutations){const value=alternativeGenerationFixture();change(value);assert.throws(()=>normalizeAlternativeGeneration(value),{code:'invalid-alternative-generation'});}
});

test('generation source budgets and application-path boundaries reject hidden, generated, config and runtime files',()=>{
 for(const path of ['src/.secret.ts','node_modules/pkg/a.ts','dist/a.ts','src/vite.config.ts','package.json','src/runtime-client.ts','src/foundation-runtime.ts','../a.ts']){const files=alternativeSources(),generation=alternativeGenerationFixture();files[0].path=path;generation.scope.feature.paths[0]=path;assert.throws(()=>validateAlternativeGenerationFiles(generation,files));}
 for(const modify of [files=>files.pop()&&files.pop(),files=>files.push(files[0]),files=>files[0].revision='forged',files=>files[0].source+='changed',files=>{files[0].source='x'.repeat(65536);files[0].revision=alternativeHash(files[0].source).slice(0,16);}]){const files=alternativeSources();modify(files);assert.throws(()=>validateAlternativeGenerationFiles(alternativeGenerationFixture(),files));}
 const generation=alternativeGenerationFixture();generation.scope.feature.paths.pop();assert.throws(()=>validateAlternativeGenerationFiles(generation,alternativeSources()));
});

test('restored artifact refuses substituted source, lifecycle, identity, provenance or scope',()=>{
 const artifact=aiAlternativesFixture({requestId:'request-1'});
 const mutations=[v=>v.projectId='other',v=>v.generation.scope.feature.paths.pop(),v=>v.context[0].hash='a'.repeat(64),v=>v.context.reverse(),v=>v.candidates[0].changeSet.files[0].before+='drift',v=>v.candidates[0].changeSet.origin='alternative',v=>v.candidates[0].changeSet.status='applied',v=>v.candidates[0].changeSet.revision=1,v=>v.candidates[0].changeSet.createdAt='2026-11-01T12:00:00.000Z',v=>v.candidates[0].changeSet.requestId='other-request',v=>v.candidates[0].id=v.id,v=>v.candidates[0].changeSet.files[0].id=v.candidates[1].changeSet.id,v=>v.verificationStatus='passed',v=>v.execution={command:'npm test'}];
 for(const change of mutations){const value=structuredClone(artifact);change(value);assert.throws(()=>normalizeAIAlternatives(value,'fixture',alternativeSources()));}
 const copy=normalizeAIAlternatives(artifact,'fixture',alternativeSources());copy.candidates[0].changeSet.files[0].after='mutated';assert.notEqual(artifact.candidates[0].changeSet.files[0].after,'mutated');
});

test('two candidates can change different selected files but cannot exceed the complete source budget',()=>{
 const raw=alternativeRawFixture();raw.candidates[1].edits[1]={path:'src/profile.ts',find:'"/api/profile"',replace:'"/api/profile?draft"'};assert.equal(create(raw).candidates[1].changeSet.files[1].path,'src/profile.ts');
 const huge=alternativeRawFixture();huge.candidates[0].edits[0].replace='x'.repeat(65536);assert.throws(()=>create(huge));
});
