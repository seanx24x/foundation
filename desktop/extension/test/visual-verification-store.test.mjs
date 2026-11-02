import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createVisualVerificationStore,prepareVisualVerificationLink,visualVerificationView,visualVerificationDigest,VISUAL_VERIFICATION_LIMITS} from '../src/visual-verification-store.mjs';
import {analyzeChangeImpact} from '../../../server/project/change-impact.mjs';
import {createTokenProposal,listDesignTokens} from '../../../server/project/proposals.mjs';

const clone=value=>structuredClone(value),hash=value=>createHash('sha256').update(value).digest('hex');
const now='2026-10-31T20:00:00.000Z',later='2026-10-31T20:00:01.000Z',projectId='visual-fixture';
const featureId=randomUUID(),screenId=randomUUID(),scenarioId=randomUUID();
const beforeSource=':root { --radius: 8px; }\nbutton { border-radius: var(--radius); }\n';
const file={path:'src/theme.css',source:beforeSource,revision:hash(beforeSource).slice(0,16)};
const token=listDesignTokens([file])[0];
const proposal=createTokenProposal({file,name:token.name,occurrence:token.occurrence,value:'12px',projectId});
proposal.designImpact={version:1,result:await analyzeChangeImpact({projectId,target:{kind:'token',path:file.path,revision:file.revision,name:token.name,occurrence:token.occurrence},files:[file]}),relatedScenarios:[{featureId,featureTitle:'Profile',screenId,screenTitle:'Profile screen',scenarioId,scenarioTitle:'Save profile',paths:[file.path],suiteNames:[]}]};
proposal.status='applied';proposal.appliedRevision=hash(proposal.after).slice(0,16);
const screen={id:screenId,featureId,title:'Profile screen',targetId:'vite:dev',route:'/profile',archived:false,createdAt:now,updatedAt:now};
const scenario={id:scenarioId,screenId,title:'Save profile',steps:['Choose Save'],expectedOutcome:'Profile saved',archived:false,createdAt:now,updatedAt:now};
const runtime={targetId:'vite:dev',session:'a'.repeat(32),viewId:'b'.repeat(32),documentId:'c'.repeat(32),route:'/profile',pageVersion:1};
const run=source=>({id:randomUUID(),feature:{id:featureId,title:'Profile',revision:1,paths:[file.path,'src/api.ts']},screen:clone(screen),scenario:clone(scenario),definitionRevision:2,runtime:clone(runtime),sources:[{path:file.path,revision:hash(source)},{path:'src/api.ts',revision:'d'.repeat(64)}],dirtyPaths:[],startedAt:now,endedAt:later,status:'completed',assessment:'matched',note:'Observed manually',observations:[],truncated:false});
const runs=[run(proposal.before),run(proposal.after)];
const empty=key=>({schemaVersion:1,projectId,revision:0,[key]:[],storage:{status:'saved'}});
const inputs=()=>({projectId,proposal:clone(proposal),workspace:{schemaVersion:1,projectId,revision:3,activeScreenId:screenId,activeScenarioId:scenarioId,screens:[clone(screen)],scenarios:[clone(scenario)],runs:clone(runs),storage:{status:'saved'}},captures:empty('captures'),replays:empty('replays'),scenarioId,beforeId:runs[0].id,afterId:runs[1].id});
const prepared=()=>prepareVisualVerificationLink(inputs());
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(previous){let disk=previous,fail=false,commitThenFail=false,readError=false,writeHook;const writes=[];const store=createVisualVerificationStore({projectId,read:()=>{if(readError)throw Error('PRIVATE_READ');return disk;},write:async value=>{writes.push(clone(value));if(writeHook)await writeHook(value);if(fail)throw Error('PRIVATE_WRITE');disk=clone(value);if(commitThenFail)throw Error('PRIVATE_ACK');}});return {store,writes,get disk(){return disk;},set disk(value){disk=value;},set fail(value){fail=value;},set commitThenFail(value){commitThenFail=value;},set readError(value){readError=value;},set writeHook(value){writeHook=value;}};}
const link=(f,value=prepared(),options)=>f.store.link(value,f.store.snapshot().revision,options);
const view=(f,input=inputs())=>visualVerificationView({...input,verification:f.store.snapshot()});
const binding=run=>({startedAt:run.startedAt,definitionRevision:run.definitionRevision,runtime:clone(run.runtime),sources:clone(run.sources),dirtyPaths:clone(run.dirtyPaths)});
function capture(run){const id=randomUUID();return {id,runId:run.id,featureId,screenId,scenarioId,capturedAt:later,binding:binding(run),image:{assetId:id,sha256:'e'.repeat(64),byteLength:1234,widthPx:960,heightPx:680,mimeType:'image/png'},conditions:{viewportWidthCss:960,viewportHeightCss:680,deviceScaleFactor:1,scrollXCss:0,scrollYCss:0,canvasScale:1,colorSchemePreference:'light',reducedMotionPreference:'no-preference',appTheme:'unknown',dataState:'unknown',animationState:'unknown'},sourceRelationship:'unverified'};}
function replay(run){return {id:randomUUID(),executionId:randomUUID().replaceAll('-',''),runId:run.id,featureId,screenId,scenarioId,binding:binding(run),recipe:{id:'profile-save',title:'Save profile',route:'/profile',fixture:{id:'profile',label:'Local fixture'},registrationId:'f'.repeat(32),catalogDigest:'a'.repeat(64),steps:[]},requested:{theme:'light',motion:'system',viewportWidthCss:960,viewportHeightCss:680},startedAt:now,endedAt:later,status:'completed',prepare:{id:'prepare',status:'completed',effects:'unknown',startedAt:now,endedAt:later},steps:[],observed:null,sourceRelationship:'unverified'};}
function withEvidence(){const input=inputs();input.captures.captures=input.workspace.runs.map(capture);input.replays.replays=input.workspace.runs.map(replay);input.captures.revision=2;input.replays.revision=2;return input;}

test('link freezes exact full-hash proposal and explicit scenario evidence without storing source or image payloads',async()=>{
 const f=fixture(),input=withEvidence(),value=prepareVisualVerificationLink(input),entry=await link(f,value);assert.equal(entry.basis.beforeHash,hash(proposal.before));assert.equal(entry.basis.afterHash,hash(proposal.after));assert.equal(entry.basis.impactDigest,visualVerificationDigest(proposal.designImpact));assert.deepEqual(entry.scope,{featureId,featureTitle:'Profile',screenId,screenTitle:'Profile screen',scenarioId,scenarioTitle:'Save profile'});assert.equal(entry.before.runId,runs[0].id);assert.ok(entry.before.capture&&entry.after.replay);assert.equal(f.disk.revision,1);assert.doesNotMatch(JSON.stringify(f.disk),/Observed manually|:root|image\/png|viewportWidthCss|observations|requested/);
 value.scope.scenarioTitle='Mutated';entry.basis.title='Mutated';f.store.snapshot().entries[0].scope.scenarioTitle='Mutated';assert.equal(f.store.snapshot().entries[0].scope.scenarioTitle,'Save profile');assert.equal(f.writes.length,1);await f.store.dispose();
});

test('new links require an applied design checkpoint, exact hashes, clean target and explicit same scenario identity',()=>{
 const changes=[v=>v.proposal=null,v=>v.proposal.status='proposed',v=>v.proposal.status='undone',v=>v.proposal.origin='ai',v=>v.proposal.designImpact=undefined,v=>v.proposal.baseRevision='0'.repeat(16),v=>v.proposal.appliedRevision='0'.repeat(16),v=>v.proposal.designImpact.relatedScenarios=[],v=>v.scenarioId=randomUUID(),v=>v.beforeId=v.afterId,v=>v.beforeId=undefined,v=>v.workspace.runs[0].sources[0].revision=hash(proposal.before).slice(0,16)+'0'.repeat(48),v=>v.workspace.runs[0].dirtyPaths=[file.path],v=>v.workspace.runs[1].dirtyPaths=[file.path],v=>v.workspace.runs[1].scenario.id=randomUUID(),v=>v.workspace.runs[1].feature.id=randomUUID(),v=>v.workspace.runs[0].status='recording',v=>v.workspace.runs[0].sources[0].source='PRIVATE',v=>v.workspace.runs[0].sources[0].path='../outside',v=>v.workspace.runs[0].extra='PRIVATE',v=>v.workspace.storage.status='saving',v=>v.workspace.projectId='foreign'];
 for(const change of changes){const input=inputs();change(input);assert.throws(()=>prepareVisualVerificationLink(input));}
});

test('source-related proposed checkpoints expose baseline navigation while linking stays disabled',()=>{
 const f=fixture(),input=inputs();input.proposal.status='proposed';delete input.proposal.appliedRevision;const result=view(f,input);assert.equal(result.proposal.canLink,false);assert.match(result.proposal.reason,/baseline/);assert.match(result.proposal.proposalBasis,/^[a-f0-9]{64}$/);assert.equal(result.proposal.scenarios[0].canView,true);assert.equal(result.proposal.scenarios[0].beforeChoices.filter(item=>item.eligible).length,1);assert.equal(result.proposal.scenarios[0].afterChoices.filter(item=>item.eligible).length,1);assert.throws(()=>prepareVisualVerificationLink(input));
});

test('disabled choices explain wrong full hashes and dirty targets instead of silently omitting observations',()=>{
 const f=fixture(),input=inputs();const dirty=run(proposal.after);dirty.dirtyPaths=[file.path];input.workspace.runs.push(dirty);const result=view(f,input).proposal.scenarios[0];assert.equal(result.beforeChoices.length,3);assert.match(result.beforeChoices.find(item=>item.id===runs[1].id).reason,/before/);assert.match(result.afterChoices.find(item=>item.id===dirty.id).reason,/unsaved draft/);assert.equal(result.afterChoices.find(item=>item.id===dirty.id).eligible,false);
});

test('strict capture and replay bindings never attach evidence from another source, document or observation',()=>{
 for(const key of ['captures','replays'])for(const change of [item=>item.runId=randomUUID(),item=>item.binding.sources[0].revision='0'.repeat(64),item=>item.binding.runtime.documentId='0'.repeat(32),item=>item.featureId=randomUUID(),item=>item.binding.dirtyPaths=['src/api.ts'],item=>item.binding.extra='PRIVATE',item=>item.raw='PRIVATE']){
  const input=withEvidence();change(input[key][key][0]);if(input[key][key][0].runId!==input.beforeId&&!Object.hasOwn(input[key][key][0],'raw')){const result=prepareVisualVerificationLink(input);assert.equal(result.before[key==='captures'?'capture':'replay'],null);}else assert.throws(()=>prepareVisualVerificationLink(input));
 }
});

test('known presentation annotations are excluded from immutable metadata digests',()=>{
 const input=withEvidence(),a=prepareVisualVerificationLink(input);input.captures.available=false;for(const item of input.captures.captures)item.imageStatus='loading';const b=prepareVisualVerificationLink(input);assert.deepEqual(a,b);input.captures.raw='PRIVATE';assert.throws(()=>prepareVisualVerificationLink(input));
});

test('history keeps its selected evidence after Undo, replacement, source edits and restart',async()=>{
 const f=fixture(),input=withEvidence();await link(f,prepareVisualVerificationLink(input));const disk=clone(f.disk),first=view(f,input).records[0];assert.equal(first.canCompare,true);assert.equal(first.compilation,'not-recorded');assert.equal(first.visual,'not-assessed');assert.equal(first.sourceRelationship,'unverified');input.proposal.status='undone';assert.equal(view(f,input).records[0].currentRelevance,'historical');input.proposal=null;assert.equal(view(f,input).records[0].canCompare,true);assert.deepEqual(f.disk,disk);const restored=fixture(disk);assert.deepEqual(restored.store.snapshot().entries,f.store.snapshot().entries);assert.equal(restored.writes.length,0);
 const sourceInput=inputs();sourceInput.currentSources=[{path:file.path,revision:hash(proposal.after)}];assert.equal(view(f,sourceInput).records[0].currentRelevance,'applied-current');sourceInput.currentSources[0].revision='0'.repeat(64);assert.equal(view(f,sourceInput).records[0].currentRelevance,'source-changed');sourceInput.currentSources=undefined;assert.equal(view(f,sourceInput).records[0].currentRelevance,'unknown');sourceInput.dirtyPaths=[file.path];assert.equal(view(f,sourceInput).records[0].currentRelevance,'source-changed');await f.store.dispose();await restored.store.dispose();
});

test('missing or replaced observations, captures and replays remain unavailable and never acquire new matches',async()=>{
 const original=withEvidence(),f=fixture();await link(f,prepareVisualVerificationLink(original));
 for(const change of [v=>v.workspace.runs.shift(),v=>v.workspace.runs[0].note='changed',v=>v.captures.captures.shift(),v=>v.captures.captures[0].image.sha256='0'.repeat(64),v=>v.replays.replays.shift(),v=>v.replays.replays[0].requested.theme='dark']){const input=clone(original);change(input);const record=view(f,input).records[0];assert.equal(record.canCompare,false);assert.ok(record.warnings.some(item=>/missing or changed|unavailable/.test(item)));}
 const changed=clone(original);changed.captures.captures[0]=capture(changed.workspace.runs[0]);assert.equal(view(f,changed).records[0].before.capture,null);assert.equal(view(f,changed).records[0].canCompare,false);await f.store.dispose();
});

test('later captures and replay evidence are not retroactively attached to an immutable manual pair',async()=>{
 const f=fixture();await link(f);const result=view(f,withEvidence()).records[0];assert.equal(result.canCompare,true);assert.equal(result.before.capture,null);assert.equal(result.after.replay,null);assert.match(result.warnings.join(' '),/image pair is not recorded/);await f.store.dispose();
});

test('unavailable optional storage keeps valid manual observations readable but makes saved attachments unavailable',async()=>{
 const input=withEvidence(),f=fixture(),manual=fixture();await link(f,prepareVisualVerificationLink(input));await link(manual);input.captures.storage.status='unavailable';input.replays.storage.status='error';const record=view(f,input).records[0];assert.equal(record.canCompare,false);assert.equal(record.before.runId,runs[0].id);assert.equal(record.before.capture,null);assert.equal(view(manual,input).records[0].canCompare,true);const next=prepareVisualVerificationLink(input);assert.equal(next.before.capture,null);assert.equal(next.after.replay,null);await f.store.dispose();await manual.store.dispose();
});

test('definition, supporting source, excluded draft, condition, incomplete and truncated evidence are separate warnings',async()=>{
 const input=withEvidence(),after=input.workspace.runs[1];after.scenario.steps=['Wait then choose Save'];after.definitionRevision++;after.sources[1].revision='f'.repeat(64);after.dirtyPaths=['src/api.ts'];after.status='interrupted';after.assessment='not-assessed';after.truncated=true;input.captures.captures[1]=capture(after);input.captures.captures[1].conditions.colorSchemePreference='dark';input.replays.replays[1]=replay(after);input.replays.replays[1].requested.theme='dark';const f=fixture();await link(f,prepareVisualVerificationLink(input));const record=view(f,input).records[0],warnings=record.warnings.join(' ');for(const pattern of [/definitions differ/,/Supporting saved sources differ/,/Unsaved supporting drafts/,/cancelled or interrupted/,/truncated/,/conditions differ/,/equivalent data/])assert.match(warnings,pattern);assert.equal(record.after.status,'interrupted');assert.equal(record.after.assessment,'not-assessed');assert.equal(record.after.replay.status,'completed');assert.equal(record.canCompare,true);await f.store.dispose();
});

test('a forged but schema-valid journal cannot claim source or scenario matches merely through record digests',async()=>{
 const f=fixture();await link(f);const baseline=clone(f.disk);
 for(const change of [v=>v.entries[0].scope.scenarioId=randomUUID(),v=>{v.entries[0].basis.beforeHash='0'.repeat(64);v.entries[0].basis.baseRevision='0'.repeat(16);}]){const disk=clone(baseline);change(disk);const restored=fixture(disk);assert.equal(view(restored).records[0].canCompare,false);await restored.store.dispose();}await f.store.dispose();
});

test('failed writes retain prior committed links and retry persists the exact pending identity without rerunning work',async()=>{
 const f=fixture();await link(f);const previous=clone(f.disk),value=prepared();value.before.runId=randomUUID();f.fail=true;await assert.rejects(link(f,value),{code:'visual-verification-storage'});assert.deepEqual(f.disk,previous);assert.equal(f.store.snapshot().entries.length,1);assert.equal(f.store.snapshot().revision,1);assert.equal(f.store.snapshot().storage.status,'error');assert.doesNotMatch(JSON.stringify(f.store.snapshot()),/PRIVATE/);const pendingId=f.writes.at(-1).entries.at(-1).id;f.fail=false;await f.store.retry();assert.equal(f.disk.entries.length,2);assert.equal(f.disk.entries.at(-1).id,pendingId);await f.store.dispose();
});

test('a lost save acknowledgement is recovered without a duplicate write or new entry',async()=>{
 const f=fixture();f.commitThenFail=true;await assert.rejects(link(f),{code:'visual-verification-storage'});assert.equal(f.store.snapshot().entries.length,0);assert.equal(f.disk.entries.length,1);const attempts=f.writes.length,id=f.disk.entries[0].id;await f.store.retry();assert.equal(f.writes.length,attempts);assert.equal(f.store.snapshot().entries[0].id,id);await f.store.dispose();
});

test('expired ownership on retry restores the prior checkpoint instead of completing a stale link',async()=>{
 for(const committed of [false,true]){const f=fixture();let active=true;f.fail=!committed;f.commitThenFail=committed;await assert.rejects(link(f,prepared(),{isCurrent:()=>active}),{code:'visual-verification-storage'});active=false;f.fail=false;f.commitThenFail=false;await f.store.retry();assert.equal(f.store.snapshot().storage.status,'saved');assert.equal(f.store.snapshot().entries.length,0);assert.equal(f.disk?.entries?.length||0,0);await f.store.dispose();}
});

test('external journal replacement is never overwritten by link or retry, including an otherwise valid manifest',async()=>{
 const f=fixture();await link(f);const own=clone(f.disk),other=clone(own);other.entries[0].basis.title='Foreign';f.disk=other;const next=prepared();next.before.runId=randomUUID();await assert.rejects(link(f,next),{code:'visual-verification-unavailable'});assert.deepEqual(f.disk,other);assert.equal(f.writes.length,1);await assert.rejects(f.store.retry(),{code:'visual-verification-unavailable'});assert.deepEqual(f.disk,other);f.disk=own;await f.store.retry();assert.equal(f.disk.entries.length,2);await f.store.dispose();
});

test('invalid initial storage fails closed and retry can load a repaired manifest without modifying it',async()=>{
 const f=fixture({schemaVersion:2,projectId,revision:0,entries:[]});assert.equal(f.store.snapshot().storage.status,'unavailable');await assert.rejects(link(f));assert.equal(f.writes.length,0);f.disk=undefined;await f.store.retry();assert.equal(f.store.snapshot().storage.status,'saved');assert.equal(f.writes.length,0);await f.store.dispose();
});

test('ownership changes before dispatch and during an awaited write reject and restore durable prior links',async()=>{
 const before=fixture();let active=true;const operation=link(before,prepared(),{isCurrent:()=>active});active=false;await assert.rejects(operation,{name:'AbortError'});assert.equal(before.writes.length,0);await before.store.dispose();
 const f=fixture();await link(f);const old=clone(f.disk),gate=deferred();active=true;let once=true;f.writeHook=async()=>{if(once){once=false;await gate.promise;}};const value=prepared();value.before.runId=randomUUID();const pending=link(f,value,{isCurrent:()=>active});await new Promise(resolve=>setImmediate(resolve));active=false;gate.resolve();await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(f.disk,old);assert.equal(f.store.snapshot().entries.length,1);assert.equal(f.store.snapshot().storage.status,'saved');await f.store.dispose();
});

test('cancellation does not overwrite a foreign replacement while restoring a prior checkpoint',async()=>{
 const f=fixture(),gate=deferred();let active=true;f.writeHook=async()=>{await gate.promise;};const pending=link(f,prepared(),{isCurrent:()=>active});await new Promise(resolve=>setImmediate(resolve));active=false;gate.resolve();await assert.rejects(pending,{name:'AbortError'});assert.equal(f.store.snapshot().entries.length,0);
 // The write adapter below installs a different valid manifest after its owned write.
 const other=fixture();await link(other);const foreign=clone(other.disk);foreign.entries[0].basis.title='Foreign';const owned=fixture();let reads=0,disk;const store=createVisualVerificationStore({projectId,read:()=>{if(++reads===3)disk=foreign;return disk;},write:value=>{disk=clone(value);active=false;}});active=true;await assert.rejects(store.link(prepared(),0,{isCurrent:()=>active}),{code:'visual-verification-unavailable'});assert.deepEqual(disk,foreign);await store.dispose();await other.store.dispose();await owned.store.dispose();await f.store.dispose();
});

test('immutable history enforces eight pairs per proposal and forty per project without eviction',async()=>{
 const f=fixture();for(let p=0;p<5;p++){const id=randomUUID();for(let n=0;n<8;n++){const value=prepared();value.basis.proposalId=id;value.before.runId=randomUUID();await link(f,value);if(p===0&&n===7){const ninth=clone(value);ninth.before.runId=randomUUID();await assert.rejects(link(f,ninth),{code:'visual-verification-capacity'});}}}
 assert.equal(f.disk.entries.length,VISUAL_VERIFICATION_LIMITS.records);const old=clone(f.disk);await assert.rejects(link(f),{code:'visual-verification-capacity'});assert.deepEqual(f.disk,old);assert.equal(VISUAL_VERIFICATION_LIMITS.manifestBytes,1024*1024);await f.store.dispose();
});

test('strict journal metadata rejects extra keys, payloads, bad bounds, duplicate pairs and altered proposal basis',async()=>{
 for(const change of [v=>v.extra='PRIVATE',v=>v.basis.extra='PRIVATE',v=>v.basis.title='x'.repeat(513),v=>v.basis.path='../secret',v=>v.basis.beforeHash='a'.repeat(16),v=>v.basis.impactDigest='bad',v=>v.scope.scenarioId='bad',v=>v.scope.scenarioTitle='x'.repeat(513),v=>v.before.source='PRIVATE',v=>v.before.capture={id:randomUUID(),digest:'a'.repeat(64),png:'PRIVATE'},v=>v.before.runId=v.after.runId]){const f=fixture(),value=prepared();change(value);await assert.rejects(link(f,value),{code:'visual-verification-invalid'});assert.equal(f.writes.length,0);await f.store.dispose();}
 const f=fixture();await link(f);await assert.rejects(link(f),{code:'visual-verification-duplicate'});const changed=prepared();changed.basis.title='Changed';changed.before.runId=randomUUID();await assert.rejects(link(f,changed),{code:'visual-verification-stale'});await assert.rejects(f.store.link(prepared(),0),{code:'visual-verification-stale'});const oversized={...clone(f.disk),padding:'x'.repeat(VISUAL_VERIFICATION_LIMITS.manifestBytes)};assert.equal(fixture(oversized).store.snapshot().storage.status,'unavailable');await f.store.dispose();
});

test('busy journal writes cannot race and disposal cancels ownership then waits for rollback',async()=>{
 const f=fixture(),gate=deferred();f.writeHook=()=>gate.promise;const pending=link(f);await new Promise(resolve=>setImmediate(resolve));await assert.rejects(link(f),{code:'visual-verification-busy'});const closed=f.store.dispose();gate.resolve();await assert.rejects(pending,{name:'AbortError'});await closed;assert.equal(f.store.snapshot().entries.length,0);await assert.rejects(link(f),{code:'visual-verification-closed'});await assert.rejects(f.store.retry(),{code:'visual-verification-closed'});
});

test('canonical metadata digests ignore property order while retaining immutable evidence changes',()=>{
 assert.equal(visualVerificationDigest({b:1,a:{z:2,y:3}}),visualVerificationDigest({a:{y:3,z:2},b:1}));assert.equal(visualVerificationDigest({a:1,b:undefined}),visualVerificationDigest({a:1}));assert.notEqual(visualVerificationDigest({a:1}),visualVerificationDigest({a:2}));assert.throws(()=>visualVerificationDigest({a:Infinity}));assert.throws(()=>visualVerificationDigest({a:()=>{}}));
});


test('global history revisions and ephemeral replay registration do not invent changed definitions',async()=>{
 const input=withEvidence();input.workspace.runs[1].definitionRevision=999;input.workspace.runs[1].feature.revision=888;input.workspace.runs[1].screen.updatedAt=later;input.workspace.runs[1].scenario.updatedAt=later;input.captures.captures[1]=capture(input.workspace.runs[1]);input.replays.replays[1]=replay(input.workspace.runs[1]);input.replays.replays[1].recipe.registrationId='9'.repeat(32);const f=fixture();await link(f,prepareVisualVerificationLink(input));const warnings=view(f,input).records[0].warnings.join(' ');assert.doesNotMatch(warnings,/definitions differ|Feature membership|Replay recipes/);await f.store.dispose();
});

test('known applied source changes and target drafts disable linking before final host source checks',()=>{
 const f=fixture();for(const change of [v=>v.proposal.conflict=true,v=>v.dirtyPaths=[file.path],v=>v.currentSources=[{path:file.path,revision:'0'.repeat(64)}]]){const input=inputs();change(input);const result=view(f,input);assert.equal(result.proposal.canLink,false);assert.match(result.proposal.reason,/changed or has an unsaved draft/);}assert.equal(view(f,inputs()).proposal.canLink,true);
});
