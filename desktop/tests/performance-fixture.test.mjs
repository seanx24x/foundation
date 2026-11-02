import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformanceHistory,performanceProfiles,seedPerformanceHistory} from '../scripts/performance-fixture.mjs';
const sources=()=>Array.from({length:32},(_,i)=>({path:i?`src/fixture-${i}.ts`:'src/App.tsx',source:'/*'+String(i).padEnd(7800,'x')+'*/'}));
test('scale seed is deterministic, bounded, supported by production stores, and explicitly synthetic',async()=>{
 const input=sources(),prior=structuredClone(input),first=await createPerformanceHistory('project-fixture',input),second=await createPerformanceHistory('project-fixture',input);
 assert.deepEqual(first,second);assert.deepEqual(input,prior);
 assert.equal(first.summary.turns,100);assert.equal(first.summary.runtimeObservations,4000);assert.equal(first.summary.runtimeRuns,40);assert.ok(first.summary.featureSourceBytes<=256*1024);
 assert.ok(first.summary.conversationBytes>3*1024*1024&&first.summary.conversationBytes<8*1024*1024);assert.ok(first.summary.runtimeBytes>1024*1024&&first.summary.runtimeBytes<8*1024*1024);
 const runtime=first.state['foundation.runtime-workspaces.project-fixture'];assert.ok(runtime.runs.every(run=>run.note.includes('SYNTHETIC OFFLINE TEST FIXTURE')&&run.assessment==='not-assessed'));
 assert.equal(performanceProfiles.standard.corpusFiles,400);assert.equal(performanceProfiles.standard.corpusLines,128);assert.equal(performanceProfiles.standard.history,false);assert.deepEqual(Object.values(performanceProfiles.standard.phaseKeys),[160,160,160,160,160]);
 assert.equal(Object.entries(performanceProfiles.scale.phaseKeys).filter(([name])=>name.startsWith('combined')).reduce((sum,[,count])=>sum+count*50,0),120000);
});
test('seed rejects sources that cannot all be loaded by the native feature context',async()=>{
 await assert.rejects(createPerformanceHistory('project-fixture',sources().slice(1)));
 const oversized=sources();oversized[1].source='x'.repeat(256*1024);await assert.rejects(createPerformanceHistory('project-fixture',oversized),/loaded-context cap/);
});

test('offline seed refuses any non-sibling profile before reading files',async()=>{
 await assert.rejects(seedPerformanceHistory('/private/tmp/foundation-editor-performance-test/workspace','/private/tmp/other-profile'),/sibling disposable/);
});
