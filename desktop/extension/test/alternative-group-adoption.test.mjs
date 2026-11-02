import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createAlternativeWorkspaces} from '../src/alternative-workspaces.mjs';
import {createChangeSetSession} from '../src/change-set-session.mjs';
import {createProjectService} from '../../../server/project/workspace.mjs';
import {validateChangeSet,changeGroupDigest,validateAlternativeGroupBasis,validAlternativeSourcePath} from '../../../server/project/proposals.mjs';
import {createExecutionSession,changeGroupDigest as executionDigest} from '../src/execution-session.mjs';
import {createAcceptancePlan} from '../../../server/project/acceptance-units.mjs';
const native={skip:process.platform!=='darwin'},sha=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t,{stage=true,validate=true}={}){
 const temp=await mkdtemp('/private/tmp/foundation-group-adoption-'),root=join(temp,'original'),storageRoot=join(temp,'copies');await mkdir(join(root,'src'),{recursive:true});
 const original={'src/a.ts':'export const label="Save";\n','src/b.css':'button { border-radius:8px; }\n','src/other.ts':'export const user=1;\n'};for(const [path,body] of Object.entries(original))await writeFile(join(root,path),body);
 const service=createProjectService({root}),project=await service.open(root),files=await Promise.all(['src/a.ts','src/b.css'].map(path=>service.getFile(project.id,path)));
 const sourceGroup={schemaVersion:1,id:randomUUID(),projectId:project.id,title:'Clearer Save',summary:'Change label and corners together.',origin:'ai',status:'proposed',revision:0,files:files.map(file=>({id:randomUUID(),path:file.path,before:file.source,after:file.source.replace('Save','Save profile').replace('8px','12px'),baseRevision:file.revision})),context:files.map(({path,revision})=>({path,revision})),verification:['Inspect the selected scenario.'],verificationStatus:'not-run'};
 const copies=createAlternativeWorkspaces({root,storageRoot,projectId:project.id}),comparisonId=randomUUID(),prepared=await copies.prepareGroup({comparisonId,files:sourceGroup.files.map(({path,before,after})=>({path,before,after}))});
 const group={...structuredClone(sourceGroup),id:randomUUID(),origin:'alternative',files:sourceGroup.files.map(file=>({...file,id:randomUUID()})),alternativeBasis:{version:2,kind:'change-set',comparisonId,sourceGroupId:sourceGroup.id,sourceGroupRevision:sourceGroup.revision,sourceGroupDigest:changeGroupDigest(sourceGroup),baselineDigest:prepared.baselineDigest,files:prepared.files}};
 const calls=[],dirty=new Set(),bindings={storageRoot:join(temp,'groups'),projectId:project.id,getFile:(id,path)=>service.getFile(id,path),isDirty:path=>dirty.has(path),applyBatch:(...args)=>service.applyBatch(...args),...(validate?{validateAlternative:async(basis,context)=>{calls.push(structuredClone(context));if(context.phase==='apply'){const read=await copies.readGroup(basis.comparisonId);assert.equal(read.baselineDigest,basis.baselineDigest);assert.deepEqual(read.files.map(({path,beforeHash,afterHash})=>({path,beforeHash,afterHash})),basis.files);}else await copies.validateOriginalProgress(basis.comparisonId,{originalBatchWrite:context.originalBatchWrite});return true;}}:{})};
 const session=createChangeSetSession(bindings);await session.load();if(stage)await session.stage(group);t.after(async()=>{session.dispose();copies.dispose();await rm(temp,{recursive:true,force:true});});return {temp,root,storageRoot,original,service,project,sourceGroup,group,copies,prepared,session,bindings,calls,dirty};
}
const action=(f,kind)=>{const current=f.session.snapshot().current;return f.session[kind](current.id,current.revision);};
const read=(f,path)=>readFile(join(f.root,path),'utf8');

test('local alternative provenance is strict, immutable, source-bound and distinct from AI authority',native,async t=>{
 const f=await fixture(t),value=validateChangeSet(f.group,f.project.id);assert.equal(value.origin,'alternative');assert.equal(value.requestId,undefined);assert.deepEqual(validateAlternativeGroupBasis(value.alternativeBasis,value.files),value.alternativeBasis);assert.equal(changeGroupDigest(value),executionDigest(value));
 for(const mutate of [v=>v.origin='ai',v=>v.requestId='fake-ai-turn',v=>delete v.alternativeBasis,v=>v.alternativeBasis.sourceGroupRevision=-1,v=>v.alternativeBasis.extra=true,v=>v.alternativeBasis.files.reverse(),v=>v.alternativeBasis.files[0].beforeHash='0'.repeat(64),v=>v.files[0].after+='// tampered',v=>v.status='partially-applied']){const bad=structuredClone(value);mutate(bad);assert.throws(()=>validateChangeSet(bad,f.project.id));}
 const prior=changeGroupDigest(value);value.alternativeBasis.sourceGroupRevision++;assert.notEqual(changeGroupDigest(value),prior);assert.deepEqual(f.session.snapshot().current.alternativeBasis,f.group.alternativeBasis);
});

test('application source policy excludes configuration, credentials, dependencies and instrumentation',()=>{
 for(const path of ['src/App.tsx','components/Button.vue','src/theme.css','src/lib/action.mjs'])assert.equal(validAlternativeSourcePath(path),true,path);
 for(const path of ['package.json','vite.config.ts','src/setup.ts','src/bootstrap.js','src/foundation-runtime-entry.mjs','src/connected-vite-plugin.mjs','src/replay-client.mjs','.hidden/file.ts','node_modules/a.ts','dist/a.ts','../src/a.ts','src/a.json'])assert.equal(validAlternativeSourcePath(path),false,path);
});

test('group copies overlay every exact member, preserve originals, and retain full identities on reopen',native,async t=>{
 const f=await fixture(t),opened=createAlternativeWorkspaces({root:f.root,storageRoot:f.storageRoot,projectId:f.project.id});t.after(()=>opened.dispose());const pair=await opened.readGroup(f.prepared.comparisonId);assert.deepEqual(pair.files.map(({path,before,after})=>({path,before,after})),f.group.files.map(({path,before,after})=>({path,before,after})));assert.deepEqual(pair.manifestDigests,{baseline:f.prepared.variants[0].manifestDigest,alternative:f.prepared.variants[1].manifestDigest});for(const file of f.group.files)assert.equal(await read(f,file.path),file.before);
 await writeFile(join(f.prepared.variants[1].root,'src/other.ts'),'foreign');await assert.rejects(opened.readGroup(f.prepared.comparisonId),error=>error.code==='alternative-copy-changed');
});

test('group copy bounds reject extra files, unsupported sources, source links and over64KiB sides',native,async t=>{
 const f=await fixture(t),files=f.group.files.map(({path,before,after})=>({path,before,after}));
 for(const bad of [[files[0]],[...files,files[0]],[{...files[0],path:'vite.config.ts'},files[1]],[{...files[0],after:'x'.repeat(65536)},files[1]]])await assert.rejects(f.copies.prepareGroup({comparisonId:randomUUID(),files:bad}));
 await rm(join(f.root,'src/b.css'));await symlink(join(f.root,'src/a.ts'),join(f.root,'src/b.css'));await assert.rejects(f.copies.prepareGroup({comparisonId:randomUUID(),files}),error=>error.code==='alternative-symlink');
});

test('Apply validates complete copies once then exact full original progress before each rename and after completion',native,async t=>{
 const f=await fixture(t);assert.equal((await f.session.assess()).assessment.canApply,true);assert.equal(f.calls.length,0);await action(f,'apply');assert.equal(f.session.snapshot().current.status,'applied');assert.deepEqual(f.calls.map(value=>value.phase),['apply','progress','progress','progress']);
 const progress=f.calls.slice(1).map(value=>value.originalBatchWrite);assert.deepEqual(progress.map(value=>value.phase),['before-write','before-write','complete']);assert.deepEqual(progress.map(value=>value.writtenPaths),[[],['src/a.ts'],['src/a.ts','src/b.css']]);assert.deepEqual(progress.map(value=>value.temporaries.length),[2,1,0]);for(const file of f.group.files)assert.equal(await read(f,file.path),file.after);
 await assert.rejects(f.copies.validateOriginalProgress(f.prepared.comparisonId),error=>error.code==='alternative-source-changed');
 await writeFile(join(f.root,'src/other.ts'),'unrelated work after Apply');await rm(f.storageRoot,{recursive:true});const count=f.calls.length;await action(f,'undo');assert.equal(f.calls.length,count);assert.equal(f.session.snapshot().current.status,'undone');for(const file of f.group.files)assert.equal(await read(f,file.path),file.before);assert.equal(await read(f,'src/other.ts'),'unrelated work after Apply');
});

test('missing retained provenance validation blocks Apply before any write or operation journal',native,async t=>{
 const f=await fixture(t,{validate:false});await assert.rejects(action(f,'apply'),error=>error.code==='alternative-stale');assert.equal(f.session.snapshot().current.status,'proposed');for(const file of f.group.files)assert.equal(await read(f,file.path),file.before);assert.equal(f.session.snapshot().checkpoints.length,1);
});

test('unrelated full-baseline drift between renames halts and explicit recovery preserves that user edit',native,async t=>{
 const f=await fixture(t,{stage:false});let changed=false;
 const session=createChangeSetSession({...f.bindings,applyBatch:(input,options)=>f.service.applyBatch(input,{...options,journal:async event=>{await options.journal(event);if(!changed&&event.type==='after-write'){changed=true;await writeFile(join(f.root,'src/other.ts'),'user work during Apply');}}})});t.after(()=>session.dispose());await session.load();await session.stage(f.group);f.session=session;
 await assert.rejects(action(f,'apply'));assert.equal(session.snapshot().current.status,'recovery-required');assert.equal(await read(f,'src/a.ts'),f.group.files[0].after);assert.equal(await read(f,'src/b.css'),f.group.files[1].before);
 const count=f.calls.length;await action(f,'recover');assert.equal(f.calls.length,count);assert.equal(session.snapshot().current.status,'proposed');for(const file of f.group.files)assert.equal(await read(f,file.path),file.before);assert.equal(await read(f,'src/other.ts'),'user work during Apply');
});

test('retained local groups cannot acquire acceptance units, refinement or version ancestry',native,async t=>{
 const f=await fixture(t),current=f.session.snapshot().current;assert.equal(f.session.snapshot().assessment.canPrepareAcceptance,false);await assert.rejects(f.session.prepareAcceptance(current.id,current.revision));assert.throws(()=>createAcceptancePlan({group:current,files:current.files.map(file=>({path:file.path,source:file.before,revision:file.baseRevision}))}));await assert.rejects(f.session.refine(f.group,{parentId:current.id,expectedParentRevision:current.revision,parentDigest:changeGroupDigest(current)}));await assert.rejects(f.session.activateVersion(randomUUID(),{expectedCurrentId:current.id,expectedCurrentRevision:current.revision}));
});

test('group ownership token stays stable through assessment and retires on source lifecycle transitions',native,async t=>{
 const f=await fixture(t),token=f.session.ownershipToken();assert.ok(Object.isFrozen(token));f.session.snapshot();await f.session.load();await f.session.assess();assert.equal(f.session.ownershipToken(),token);await action(f,'apply');const applied=f.session.ownershipToken();assert.notEqual(applied,token);await action(f,'undo');assert.notEqual(f.session.ownershipToken(),applied);
});

test('mixed baseline guards reject forged progress and exact pending-file identity substitution',native,async t=>{
 const f=await fixture(t),path=`src/.foundation-${randomUUID()}.tmp`;await writeFile(join(f.root,path),f.group.files[0].after);const info=await stat(join(f.root,path)),temp={targetPath:'src/a.ts',path,dev:info.dev,ino:info.ino,hash:sha(f.group.files[0].after)};
 for(const progress of [{phase:'before-write',targetPath:'src/a.ts',writtenPaths:[],temporaries:[temp]},{phase:'complete',writtenPaths:[],temporaries:[]},{phase:'preflight',writtenPaths:['src/b.css'],temporaries:[]},{phase:'preflight',writtenPaths:[],temporaries:[{...temp,ino:temp.ino+1}]},{phase:'preflight',writtenPaths:[],temporaries:[{...temp,hash:'f'.repeat(64)}]}])await assert.rejects(f.copies.validateOriginalProgress(f.prepared.comparisonId,{originalBatchWrite:progress}));
});


test('retained group restart preserves local provenance and exact Undo without live comparison callbacks',native,async t=>{
 const f=await fixture(t);await action(f,'apply');f.session.dispose();await writeFile(join(f.root,'src/other.ts'),'saved after Apply');const restored=createChangeSetSession({...f.bindings,validateAlternative:async()=>{assert.fail('Undo must not validate the old original baseline');}});t.after(()=>restored.dispose());await restored.load();assert.equal(restored.snapshot().current.origin,'alternative');assert.deepEqual(restored.snapshot().current.alternativeBasis,f.group.alternativeBasis);f.session=restored;await action(f,'undo');for(const file of f.group.files)assert.equal(await read(f,file.path),file.before);assert.equal(await read(f,'src/other.ts'),'saved after Apply');
});

test('group preparation honors cancellation and rechecks original drift after copying',native,async t=>{
 for(const mode of ['cancel','drift']){const f=await fixture(t),id=randomUUID();let calls=0,changed=false;await assert.rejects(f.copies.prepareGroup({comparisonId:id,files:f.group.files.map(({path,before,after})=>({path,before,after})),guard:async()=>{if(mode==='cancel'&&++calls===45)throw Error('cancelled group');if(mode==='drift'&&!changed&&await stat(join(f.storageRoot,id,'alternative/workspace/src/b.css')).catch(()=>null)){changed=true;await writeFile(join(f.root,'src/other.ts'),'user changed during copy');}}}));await assert.rejects(stat(join(f.storageRoot,id)),error=>error.code==='ENOENT');for(const file of f.group.files)assert.equal(await read(f,file.path),file.before);if(mode==='drift')assert.equal(changed,true);}
});

test('local retained groups cannot enter the isolated check executor directly',native,async t=>{
 const f=await fixture(t),execution=createExecutionSession({storageRoot:join(f.temp,'execution'),root:f.root,projectId:f.project.id});t.after(()=>execution.dispose());await execution.load();await assert.rejects(execution.prepare(f.group),error=>error.code==='group-not-runnable');assert.equal(execution.snapshot().current,null);
});
