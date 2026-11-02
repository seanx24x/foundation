import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renameSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat,symlink,rename,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createChangeSetSession} from '../src/change-set-session.mjs';
import {changeGroupDigest} from '../../../server/project/proposals.mjs';
import {createProjectService} from '../../../server/project/workspace.mjs';

const original=['export const a = 1;\n','export const b = 2;\n','export const c = 3;\n'];
const paths=['src/a.ts','src/b.ts','src/c.ts'];
async function fixture(t,{stage=true}={}){
 const root=await mkdtemp('/private/tmp/foundation-change-session-'),projectRoot=join(root,'projects/orbit'),storageRoot=join(root,'storage');
 await mkdir(join(projectRoot,'src'),{recursive:true});for(let i=0;i<3;i++)await writeFile(join(projectRoot,paths[i]),original[i]);
 t.after(()=>rm(root,{recursive:true,force:true}));const service=createProjectService({root}),project=await service.snapshot();
 const files=await Promise.all(paths.map(path=>service.getFile(project.id,path))),dirty=new Set(),history=[];
 const group={schemaVersion:1,id:randomUUID(),projectId:project.id,title:'Adjust related values',summary:'Two existing files change together.',origin:'ai',status:'proposed',revision:0,files:files.slice(0,2).map(f=>({id:randomUUID(),path:f.path,before:f.source,after:f.source.replace(' = ',' = 10 + '),baseRevision:f.revision})),context:files.map(({path,revision})=>({path,revision})),verification:['Inspect both consumers.'],verificationStatus:'not-run'};
 const bindings={storageRoot,projectId:project.id,getFile:(id,path)=>service.getFile(id,path),isDirty:path=>dirty.has(path),applyBatch:(...args)=>service.applyBatch(...args),onCheckpoint:group=>history.push(group)};
 const session=createChangeSetSession(bindings);await session.load();if(stage)await session.stage(group);
 return {root,projectRoot,storageRoot,service,project,group,bindings,session,dirty,history};
}
const source=(f,index)=>readFile(join(f.projectRoot,paths[index]),'utf8');
const checkpoint=f=>readFile(join(f.storageRoot,'checkpoint.json'),'utf8');
const diskCurrent=saved=>saved.versions.find(item=>item.group.id===saved.activeId).group;
const diskCheckpoints=saved=>saved.versions.find(item=>item.group.id===saved.activeId).checkpoints;
const act=(f,kind)=>{const group=f.session.snapshot().current;return f.session[kind](group.id,group.revision);};
const restart=async f=>{f.session=createChangeSetSession(f.bindings);return f.session.load();};
const failAfterFirst=f=>{let once=true;f.bindings.applyBatch=(input,options)=>f.service.applyBatch(input,{...options,journal:async event=>{await options.journal(event);if(once&&event.type==='after-write'){once=false;throw Error('Simulated interruption after first rename');}}});};

test('assessing loaded empty storage never publishes busy, reads source, or changes its snapshot',async t=>{
 const f=await fixture(t,{stage:false}),events=[];let reads=0,writes=0;
 f.session.dispose();f.session=createChangeSetSession({...f.bindings,onChange:value=>events.push(value),getFile:async()=>{reads++;throw Error('Empty assessment must not read source');},applyBatch:async()=>{writes++;throw Error('Empty assessment must not write source');}});
 await f.session.load();const before=f.session.snapshot();events.length=0;
 const results=await Promise.all(Array.from({length:50},()=>{const pending=f.session.assess();assert.equal(f.session.snapshot().busy,false,'Empty assessment is immediately idle');return pending;}));
 for(const result of results)assert.deepEqual(result,before);
 assert.deepEqual(f.session.snapshot(),before);assert.deepEqual(events,[]);assert.equal(reads,0);assert.equal(writes,0);await assert.rejects(checkpoint(f),{code:'ENOENT'});
});

test('empty assessment still requires a loaded, current, undisposed session',async t=>{
 const f=await fixture(t,{stage:false});let current=true;const events=[];
 f.session.dispose();f.session=createChangeSetSession({...f.bindings,isCurrent:()=>current,onChange:value=>events.push(value)});
 await assert.rejects(f.session.assess(),{code:'storage-unavailable'});assert.equal(f.session.snapshot().storage.status,'unavailable');
 events.length=0;const loading=f.session.load();assert.equal(f.session.snapshot().busy,true,'Initial storage read remains an operation');await loading;assert.ok(events.some(value=>value.busy));assert.equal(events.at(-1).busy,false);
 current=false;await assert.rejects(f.session.assess(),{code:'operation-retired'});assert.equal(f.session.snapshot().busy,false);
 current=true;await f.session.assess();f.session.dispose();await assert.rejects(f.session.assess(),{code:'operation-retired'});
});

test('empty assessment does not hide unavailable storage or skip existing error handling',async t=>{
 const f=await fixture(t,{stage:false}),events=[];f.session.dispose();f.session=createChangeSetSession({...f.bindings,onChange:value=>events.push(value)});await f.session.load();
 await assert.rejects(f.session.stage({}));assert.ok(f.session.snapshot().error);events.length=0;
 await f.session.assess();assert.equal(f.session.snapshot().error,undefined);assert.deepEqual(events.map(value=>value.busy),[true,false],'Clearing a prior operation error retains its publication');
 await writeFile(f.storageRoot,'blocked storage');await assert.rejects(f.session.retry(),{code:'storage-error'});const before=f.session.snapshot();await assert.rejects(f.session.assess(),{code:'storage-error'});assert.equal(f.session.snapshot().storage.status,'error');assert.equal(f.session.snapshot().error,before.error);assert.equal(f.session.snapshot().current,null);
 await rm(f.storageRoot);await mkdir(f.storageRoot);await writeFile(join(f.storageRoot,'checkpoint.json'),'invalid saved storage');f.session.dispose();f.session=createChangeSetSession(f.bindings);await assert.rejects(f.session.load(),{code:'storage-unavailable'});await assert.rejects(f.session.assess(),{code:'storage-unavailable'});assert.equal(await checkpoint(f),'invalid saved storage');
});

test('assessing a real group stays busy and blocks concurrent mutation until its source read settles',async t=>{
 const f=await fixture(t),events=[];let armed=false,release,entered;const gate=new Promise(resolve=>{release=resolve;}),reading=new Promise(resolve=>{entered=resolve;});
 f.bindings.getFile=async(id,path)=>{if(armed){armed=false;entered();await gate;}return f.service.getFile(id,path);};f.bindings.onChange=value=>events.push(value);await restart(f);events.length=0;armed=true;
 const pending=f.session.assess();await reading;
 try{assert.equal(f.session.snapshot().busy,true);assert.equal((await f.session.assess()).busy,true);await assert.rejects(act(f,'apply'),{code:'operation-active'});await assert.rejects(f.session.stage({...f.group,id:randomUUID()}),{code:'operation-active'});assert.equal(await source(f,0),original[0]);}
 finally{release();}
 const result=await pending;assert.equal(result.busy,false);assert.equal(result.assessment.canApply,true);assert.equal(events[0].busy,true);assert.equal(events.at(-1).busy,false);assert.equal(result.current.id,f.group.id);
});

test('staging into empty storage retains its busy lock and does not let assessment bypass it',async t=>{
 const f=await fixture(t,{stage:false}),events=[];let release,entered;const gate=new Promise(resolve=>{release=resolve;}),reading=new Promise(resolve=>{entered=resolve;});let blocked=false;
 f.session.dispose();f.session=createChangeSetSession({...f.bindings,onChange:value=>events.push(value),getFile:async(id,path)=>{if(!blocked){blocked=true;entered();await gate;}return f.service.getFile(id,path);}});await f.session.load();events.length=0;
 const pending=f.session.stage(f.group);assert.equal(f.session.snapshot().busy,true);await reading;
 try{assert.equal((await f.session.assess()).busy,true);await assert.rejects(f.session.stage({...f.group,id:randomUUID()}),{code:'operation-active'});await assert.rejects(act(f,'apply'),{code:'operation-active'});assert.equal(await source(f,0),original[0]);assert.equal(events[0].current,null);assert.ok(events.every(value=>value.busy));}
 finally{release();}
 const staged=await pending;assert.equal(staged.busy,false);assert.equal(staged.current.id,f.group.id);assert.equal(staged.assessment.canApply,true);assert.equal(events.at(-1).busy,false);
});

test('stages source outside project, clones snapshots, and persists a durable applied/undone restart',async t=>{
 const f=await fixture(t);assert.equal(await source(f,0),original[0]);assert.equal(await source(f,1),original[1]);assert.equal((await stat(join(f.storageRoot,'checkpoint.json'))).mode&0o777,0o600);
 assert.deepEqual(await readdir(join(f.projectRoot,'src')),['a.ts','b.ts','c.ts']);assert.equal(f.session.snapshot().assessment.canApply,true);
 const view=f.session.snapshot();view.current.files[0].after='changed caller';assert.notEqual(f.session.snapshot().current.files[0].after,'changed caller');
 const applied=await act(f,'apply');assert.equal(applied.busy,false);assert.equal(applied.current.status,'applied');assert.equal(applied.assessment.canUndo,true);assert.equal(await source(f,0),f.group.files[0].after);assert.equal(await source(f,1),f.group.files[1].after);
 await writeFile(join(f.projectRoot,paths[2]),'// unrelated human edit\n');await restart(f);assert.equal(f.session.snapshot().assessment.canUndo,true);
 const undone=await act(f,'undo');assert.equal(undone.current.status,'undone');assert.equal(await source(f,0),original[0]);assert.equal(await source(f,1),original[1]);assert.equal(await source(f,2),'// unrelated human edit\n');assert.deepEqual(undone.checkpoints.map(x=>x.kind),['staged','applied','undone']);
 await restart(f);assert.equal(f.session.snapshot().current.status,'undone');
});

test('saved context changes and native drafts block the entire Apply',async t=>{
 for(const mode of ['target','context','target-draft','context-draft']){const f=await fixture(t);const index=mode.startsWith('target')?0:2;if(mode.endsWith('draft'))f.dirty.add(paths[index]);else await writeFile(join(f.projectRoot,paths[index]),'// newer saved source\n');
 await assert.rejects(act(f,'apply'),{code:'source-conflict'});assert.equal(await source(f,1),original[1]);assert.equal(f.session.snapshot().current.status,'proposed');}
});

test('Undo all refuses one changed target before writing any file',async t=>{
 const f=await fixture(t);await act(f,'apply');await writeFile(join(f.projectRoot,paths[1]),'// human changes\n');await assert.rejects(act(f,'undo'),{code:'source-conflict'});assert.equal(await source(f,0),f.group.files[0].after);assert.equal(await source(f,1),'// human changes\n');
});

test('a failed second write leaves explicit recovery and restart performs no source mutations',async t=>{
 const f=await fixture(t);failAfterFirst(f);await restart(f);await assert.rejects(act(f,'apply'),{code:'change-set-incomplete'});
 assert.equal(await source(f,0),f.group.files[0].after);assert.equal(await source(f,1),original[1]);assert.equal(f.session.snapshot().current.status,'recovery-required');assert.equal(f.session.snapshot().assessment.canRecover,true);
 const bytes=[await source(f,0),await source(f,1)];await restart(f);assert.deepEqual([await source(f,0),await source(f,1)],bytes);assert.equal(f.session.snapshot().assessment.canRecover,true);
 const recovered=await act(f,'recover');assert.equal(recovered.current.status,'proposed');assert.equal(await source(f,0),original[0]);assert.equal(await source(f,1),original[1]);assert.equal(recovered.assessment.canApply,true);assert.deepEqual(recovered.checkpoints.map(x=>x.kind),['staged','recovered']);
});

test('partial Undo recovers to applied bytes, preserving unrelated edits',async t=>{
 const f=await fixture(t);await act(f,'apply');failAfterFirst(f);await restart(f);await assert.rejects(act(f,'undo'));assert.equal(await source(f,0),original[0]);assert.equal(await source(f,1),f.group.files[1].after);
 await writeFile(join(f.projectRoot,paths[2]),'// unrelated\n');await restart(f);const result=await act(f,'recover');assert.equal(result.current.status,'applied');assert.equal(await source(f,0),f.group.files[0].after);assert.equal(await source(f,1),f.group.files[1].after);assert.equal(await source(f,2),'// unrelated\n');assert.equal(result.assessment.canUndo,true);
});

test('unknown source or native draft blocks recovery without overwriting it',async t=>{
 const f=await fixture(t);failAfterFirst(f);await restart(f);await assert.rejects(act(f,'apply'));f.dirty.add(paths[0]);await assert.rejects(act(f,'recover'));f.dirty.clear();await writeFile(join(f.projectRoot,paths[1]),'// user owns this\n');await assert.rejects(act(f,'recover'));assert.equal(await source(f,0),f.group.files[0].after);assert.equal(await source(f,1),'// user owns this\n');
});

test('storage failure before Apply does not write source and Retry preserves the pending recovery journal',async t=>{
 const f=await fixture(t);await rename(f.storageRoot,`${f.storageRoot}-held`);await writeFile(f.storageRoot,'blocked');
 await assert.rejects(act(f,'apply'),{code:'storage-error'});assert.equal(await source(f,0),original[0]);assert.equal(f.session.snapshot().current.status,'recovery-required');assert.equal(f.session.snapshot().assessment.canRecover,false);
 const before=f.session.snapshot();await f.session.load();assert.deepEqual(f.session.snapshot(),before);
 await rm(f.storageRoot);await rename(`${f.storageRoot}-held`,f.storageRoot);await f.session.retry();assert.equal(f.session.snapshot().assessment.canRecover,true);await act(f,'recover');assert.equal(f.session.snapshot().current.status,'proposed');
});

test('failed journal after a rename keeps actual source visible and requires Retry then recovery',async t=>{
 const f=await fixture(t);let once=true;f.bindings.applyBatch=(input,options)=>f.service.applyBatch(input,{...options,journal:async event=>{if(once&&event.type==='after-write'){once=false;await rename(f.storageRoot,`${f.storageRoot}-held`);await writeFile(f.storageRoot,'blocked');}await options.journal(event);}});await restart(f);
 await assert.rejects(act(f,'apply'),{code:'storage-error'});assert.equal(await source(f,0),f.group.files[0].after);assert.equal(await source(f,1),original[1]);assert.equal(f.session.snapshot().storage.status,'error');assert.equal(f.session.snapshot().current.status,'recovery-required');
 await rm(f.storageRoot);await rename(`${f.storageRoot}-held`,f.storageRoot);await f.session.retry();await act(f,'recover');assert.equal(await source(f,0),original[0]);assert.equal(await source(f,1),original[1]);
});

test('the prewrite journal is conservative across restart even when no file was renamed',async t=>{
 const f=await fixture(t),saved=JSON.parse(await checkpoint(f));saved.operation={groupId:saved.activeId,id:randomUUID(),kind:'apply',startedAt:new Date().toISOString(),recoveryTarget:'before',writtenPaths:[]};diskCurrent(saved).status='applying';diskCurrent(saved).revision++;await writeFile(join(f.storageRoot,'checkpoint.json'),JSON.stringify(saved));
 const result=await restart(f);assert.equal(result.current.status,'recovery-required');assert.equal(result.assessment.canRecover,true);assert.equal(await source(f,0),original[0]);await act(f,'recover');assert.equal(f.session.snapshot().current.status,'proposed');
});

test('malformed, foreign, invalid-hash, and incomplete applied journals are preserved untouched',async t=>{
 const f=await fixture(t),originalEnvelope=JSON.parse(await checkpoint(f));for(const mutate of [v=>v.schemaVersion=99,v=>v.projectId='foreign',v=>diskCurrent(v).files[0].baseRevision='bad',v=>diskCurrent(v).status='applied',v=>v.operation={id:randomUUID(),kind:'apply'},v=>diskCurrent(v).status='undone',v=>diskCheckpoints(v).push(diskCheckpoints(v)[0])]){
 const value=structuredClone(originalEnvelope);mutate(value);const bytes=JSON.stringify(value);await writeFile(join(f.storageRoot,'checkpoint.json'),bytes);await assert.rejects(restart(f),{code:'storage-unavailable'});assert.equal(await checkpoint(f),bytes);assert.equal(f.session.snapshot().storage.status,'unavailable');assert.equal(await source(f,0),original[0]);}
});

test('symlink checkpoint and symlink storage directory are never followed',async t=>{
 const f=await fixture(t),saved=await checkpoint(f),other=join(f.root,'other.json');await writeFile(other,saved);await rm(join(f.storageRoot,'checkpoint.json'));await symlink(other,join(f.storageRoot,'checkpoint.json'));await assert.rejects(restart(f));assert.equal(await readFile(other,'utf8'),saved);
 await rm(f.storageRoot,{recursive:true});const otherdir=join(f.root,'other-dir');await mkdir(otherdir);await writeFile(join(otherdir,'checkpoint.json'),saved);await symlink(otherdir,f.storageRoot);await assert.rejects(restart(f));assert.equal(await readFile(join(otherdir,'checkpoint.json'),'utf8'),saved);
});

test('stale revisions and concurrent operations never apply twice',async t=>{
 const f=await fixture(t);await assert.rejects(f.session.apply(f.group.id,1),{code:'change-set-changed'});const result=await Promise.allSettled([act(f,'apply'),act(f,'apply')]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(result.filter(x=>x.status==='rejected').length,1);assert.equal(f.history.filter(x=>x.status==='applied').length,1);
});

test('cancelled staging restores the preceding external checkpoint',async t=>{
 const f=await fixture(t);await act(f,'discard');const previous=f.session.snapshot();let count=0;await assert.rejects(f.session.stage({...f.group,id:randomUUID()},{isCurrent:()=>++count<2}),{code:'operation-retired'});assert.equal(f.session.snapshot().current.id,previous.current.id);await restart(f);assert.equal(f.session.snapshot().current.id,previous.current.id);assert.equal(await source(f,0),original[0]);
});

test('discard preserves applied source but cannot discard an interrupted journal',async t=>{
 const f=await fixture(t);await act(f,'apply');await act(f,'discard');assert.equal(await source(f,0),f.group.files[0].after);assert.equal(f.session.snapshot().current.status,'discarded');
 const second=await fixture(t);failAfterFirst(second);await restart(second);await assert.rejects(act(second,'apply'));await assert.rejects(act(second,'discard'),{code:'recovery-required'});
});

test('checkpoint capacity preserves old records and reserves an explicit recovery slot',async t=>{
 const f=await fixture(t),saved=JSON.parse(await checkpoint(f));saved.versions.find(item=>item.group.id===saved.activeId).checkpoints=Array.from({length:31},()=>({id:randomUUID(),kind:'staged',createdAt:new Date().toISOString()}));await writeFile(join(f.storageRoot,'checkpoint.json'),JSON.stringify(saved));await restart(f);await assert.rejects(act(f,'apply'),{code:'checkpoint-capacity'});assert.equal(f.session.snapshot().checkpoints.length,31);assert.equal(await source(f,0),original[0]);
});

test('lost final commit keeps no success checkpoint and recovers only after local storage retry',async t=>{
 const f=await fixture(t);let once=true;f.bindings.applyBatch=async(input,options)=>{const result=await f.service.applyBatch(input,options);if(once){once=false;await rename(f.storageRoot,`${f.storageRoot}-held`);await writeFile(f.storageRoot,'blocked');}return result;};await restart(f);await assert.rejects(act(f,'apply'),{code:'storage-error'});
 assert.equal(await source(f,0),f.group.files[0].after);assert.equal(await source(f,1),f.group.files[1].after);assert.deepEqual(f.session.snapshot().checkpoints.map(x=>x.kind),['staged']);assert.equal(f.session.snapshot().current.status,'recovery-required');
 await rm(f.storageRoot);await rename(`${f.storageRoot}-held`,f.storageRoot);await f.session.retry();await act(f,'recover');assert.equal(await source(f,0),original[0]);assert.equal(await source(f,1),original[1]);
});

test('restart restores a durable checkpoint into history even if the original history callback failed',async t=>{
 const f=await fixture(t);f.bindings.onCheckpoint=()=>{throw Error('history offline');};await restart(f);const applied=await act(f,'apply');assert.equal(applied.current.status,'applied');assert.equal(applied.storage.status,'saved');assert.match(applied.error,/conversation history/);let restored;f.bindings.onCheckpoint=group=>{restored=group;};await restart(f);assert.equal(restored.status,'applied');assert.equal(restored.revision,f.session.snapshot().current.revision);
});

test('large valid escaped UTF-8 source snapshots remain bounded and round-trip',async t=>{
 const f=await fixture(t);const control='\u0001'.repeat(120000);for(let i=0;i<2;i++){await writeFile(join(f.projectRoot,paths[i]),control+'\n');const file=await f.service.getFile(f.project.id,paths[i]);f.group.files[i]={...f.group.files[i],before:file.source,after:control+'// changed\n',baseRevision:file.revision};f.group.context[i].revision=file.revision;}
 await act(f,'discard');f.group.id=randomUUID();await f.session.stage(f.group);assert.equal(f.session.snapshot().storage.status,'saved');await restart(f);assert.equal(f.session.snapshot().current.files[0].before,control+'\n');assert.equal(f.session.snapshot().assessment.canApply,true);
});

test('one proposed or stale group must be explicitly dismissed before staging another',async t=>{
 const f=await fixture(t);await assert.rejects(f.session.stage({...f.group,id:randomUUID()}),{code:'checkpoint-active'});const saved=JSON.parse(await checkpoint(f));diskCurrent(saved).status='stale';diskCurrent(saved).revision++;await writeFile(join(f.storageRoot,'checkpoint.json'),JSON.stringify(saved));await restart(f);await assert.rejects(f.session.stage({...f.group,id:randomUUID()}),{code:'checkpoint-active'});await act(f,'discard');await f.session.stage({...f.group,id:randomUUID()});assert.equal(f.session.snapshot().current.status,'proposed');
});

test('cancellation during source assessment restores the previous checkpoint and never attaches the response',async t=>{
 const f=await fixture(t);await act(f,'discard');let requestCurrent=true,armed=false,calls=0;f.bindings.getFile=async(id,path)=>{const file=await f.service.getFile(id,path);if(armed)requestCurrent=false;return file;};f.bindings.onCheckpoint=()=>calls++;await restart(f);calls=0;armed=true;const previous=await checkpoint(f);await assert.rejects(f.session.stage({...f.group,id:randomUUID()},{isCurrent:()=>requestCurrent}),{code:'operation-retired'});assert.equal(calls,0);assert.equal(await checkpoint(f),previous);assert.equal(f.session.snapshot().current.status,'discarded');
});

test('cancellation during history persistence retires the staged response after the callback settles',async t=>{
 const f=await fixture(t);await act(f,'discard');let requestCurrent=true,armed=false;f.bindings.onCheckpoint=async()=>{if(armed)requestCurrent=false;};await restart(f);armed=true;const previous=await checkpoint(f);await assert.rejects(f.session.stage({...f.group,id:randomUUID()},{isCurrent:()=>requestCurrent}),{code:'operation-retired'});assert.equal(await checkpoint(f),previous);assert.equal(f.session.snapshot().current.status,'discarded');assert.equal(await source(f,0),original[0]);
});

test('new staging timestamps are host-owned even when input supplies a future createdAt',async t=>{
 const f=await fixture(t);await act(f,'discard');await f.session.stage({...f.group,id:randomUUID(),createdAt:'2099-01-01T00:00:00.000Z'});const current=f.session.snapshot().current;assert.equal(current.createdAt,current.updatedAt);assert.ok(current.createdAt<'2099');await restart(f);assert.equal(f.session.snapshot().storage.status,'saved');
});

async function refinementFixture(t){
 const f=await fixture(t),saved=JSON.parse(await checkpoint(f));diskCurrent(saved).requestId='request-parent';
 await writeFile(join(f.storageRoot,'checkpoint.json'),JSON.stringify(saved));await restart(f);return f;
}
const nextVersion=(f,extra={})=>{const prior=f.session.snapshot().current;return {...structuredClone(prior),id:randomUUID(),requestId:randomUUID(),revision:0,status:'proposed',title:'Refined source version',files:prior.files.map(file=>({...file,id:randomUUID(),after:file.after+'// refined\n'})),...extra};};
const refine=(f,child=nextVersion(f),extra={})=>{const parent=f.session.snapshot().current;return f.session.refine(child,{parentId:parent.id,expectedParentRevision:parent.revision,parentDigest:changeGroupDigest(parent),...extra});};
const activate=(f,id,extra={})=>{const current=f.session.snapshot().current;return f.session.activateVersion(id,{expectedCurrentId:current.id,expectedCurrentRevision:current.revision,...extra});};

test('legacy session schema1 loads as one retained version without writing a migration',async t=>{
 const f=await fixture(t),snapshot=f.session.snapshot(),legacy={schemaVersion:1,projectId:f.project.id,current:snapshot.current,operation:null,checkpoints:snapshot.checkpoints};
 const bytes=JSON.stringify(legacy);await writeFile(join(f.storageRoot,'checkpoint.json'),bytes);await restart(f);
 assert.equal(await checkpoint(f),bytes);assert.deepEqual(f.session.snapshot().versions,[{parentId:null,group:legacy.current,checkpoints:legacy.checkpoints,acceptance:null}]);
 await act(f,'discard');assert.equal(JSON.parse(await checkpoint(f)).schemaVersion,3);assert.equal(f.session.snapshot().versions.length,1);
});

test('refinement retains complete independent versions and per-version checkpoints without writing project source',async t=>{
 const f=await refinementFixture(t),parent=f.session.snapshot().current,priorCheckpoints=f.session.snapshot().checkpoints,child=nextVersion(f);
 const next=await refine(f,child);assert.equal(next.current.id,child.id);assert.equal(next.current.revision,0);assert.equal(next.current.status,'proposed');assert.equal(next.versions.length,2);
 assert.deepEqual(next.versions[0],{parentId:null,group:parent,checkpoints:priorCheckpoints,acceptance:null});assert.equal(next.versions[1].parentId,parent.id);assert.equal(next.versions[1].checkpoints[0].kind,'staged');
 child.files[0].after='caller mutation';next.versions[0].group.files[0].before='caller mutation';assert.equal(f.session.snapshot().versions[0].group.files[0].before,original[0]);
 assert.equal(await source(f,0),original[0]);assert.equal(await source(f,1),original[1]);await restart(f);assert.equal(f.session.snapshot().current.id,child.id);assert.equal(f.session.snapshot().versions.length,2);
 await act(f,'apply');assert.equal(await source(f,0),f.session.snapshot().current.files[0].after);await restart(f);assert.equal(f.session.snapshot().versions[0].checkpoints.length,1);assert.deepEqual(f.session.snapshot().checkpoints.map(item=>item.kind),['staged','applied']);
 await act(f,'undo');assert.equal(await source(f,0),original[0]);assert.equal(await source(f,1),original[1]);assert.deepEqual(f.session.snapshot().versions[0].group,parent);
});

test('activating an earlier version advances only its lifecycle counter and invalidates stale ownership',async t=>{
 const f=await refinementFixture(t),parent=f.session.snapshot().current,parentDigest=changeGroupDigest(parent);await refine(f);const child=f.session.snapshot().current;
 const restored=await activate(f,parent.id);assert.equal(restored.current.id,parent.id);assert.equal(restored.current.revision,parent.revision+1);assert.equal(changeGroupDigest(restored.current),parentDigest);
 assert.deepEqual(restored.versions[1].group,child);assert.equal(await source(f,0),original[0]);await assert.rejects(f.session.apply(parent.id,parent.revision),{code:'change-set-changed'});
 await restart(f);assert.equal(f.session.snapshot().current.id,parent.id);await activate(f,child.id);assert.equal(f.session.snapshot().current.revision,child.revision+1);assert.equal(changeGroupDigest(f.session.snapshot().current),changeGroupDigest(child));
});

test('refinement rejects forged parents, reused identities and a different original basis before mutation',async t=>{
 const f=await refinementFixture(t),parent=f.session.snapshot().current,baseline=await checkpoint(f);
 for(const options of [{parentId:randomUUID()},{expectedParentRevision:99},{parentDigest:'a'.repeat(64)}])await assert.rejects(refine(f,undefined,options),{code:'change-set-changed'});
 for(const child of [nextVersion(f,{id:parent.id}),nextVersion(f,{requestId:parent.requestId}),nextVersion(f,{revision:1}),nextVersion(f,{context:[...parent.context].reverse()}),nextVersion(f,{context:parent.context.slice(0,2)})])await assert.rejects(refine(f,child));
 assert.equal(await checkpoint(f),baseline);assert.equal(f.session.snapshot().current.id,parent.id);assert.equal(f.session.snapshot().versions.length,1);
});

test('fresh complete source and clean native drafts gate both refinement and activation',async t=>{
 for(const mode of ['context-draft','context-source','target-source','missing']){
  const f=await refinementFixture(t),parent=f.session.snapshot().current;await refine(f);const active=f.session.snapshot().current,baseline=await checkpoint(f);
  if(mode==='context-draft')f.dirty.add(paths[2]);else if(mode==='missing')await rm(join(f.projectRoot,paths[2]));else await writeFile(join(f.projectRoot,paths[mode==='target-source'?0:2]),'// human edit\n');
  await assert.rejects(refine(f),{code:'source-conflict'});await assert.rejects(activate(f,parent.id),{code:'source-conflict'});assert.equal(f.session.snapshot().current.id,active.id);assert.equal(await checkpoint(f),baseline);
 }
});

test('applied and interrupted source operations cannot refine or activate another version',async t=>{
 const f=await refinementFixture(t),parent=f.session.snapshot().current;await refine(f);await act(f,'apply');
 await assert.rejects(refine(f),{code:'change-set-changed'});await assert.rejects(activate(f,parent.id),{code:'version-unavailable'});assert.equal(f.session.snapshot().current.status,'applied');
 const interrupted=await refinementFixture(t),first=interrupted.session.snapshot().current;await refine(interrupted);failAfterFirst(interrupted);await restart(interrupted);await assert.rejects(act(interrupted,'apply'));
 await assert.rejects(refine(interrupted),{code:'change-set-changed'});await assert.rejects(activate(interrupted,first.id),{code:'version-unavailable'});assert.equal(interrupted.session.snapshot().current.status,'recovery-required');
});

test('failed refinement storage keeps prior current and Retry never promotes the attempted child',async t=>{
 const f=await refinementFixture(t),parent=f.session.snapshot().current,baseline=await checkpoint(f),child=nextVersion(f);
 await rename(f.storageRoot,`${f.storageRoot}-held`);await writeFile(f.storageRoot,'blocked');await assert.rejects(refine(f,child),{code:'storage-error'});
 assert.equal(f.session.snapshot().current.id,parent.id);assert.equal(f.session.snapshot().versions.length,1);assert.equal(f.session.snapshot().storage.status,'error');
 await rm(f.storageRoot);await rename(`${f.storageRoot}-held`,f.storageRoot);assert.equal(await checkpoint(f),baseline);await f.session.retry();await restart(f);
 assert.equal(f.session.snapshot().current.id,parent.id);assert.equal(f.session.snapshot().versions.length,1);assert.equal(await source(f,0),original[0]);
});

test('cancellation after temporary file sync but before rename never publishes or persists a selection',async t=>{
 const f=await refinementFixture(t),parent=f.session.snapshot().current,baseline=await checkpoint(f),observed=[];let current=true,armed=false;
 f.bindings.onChange=snapshot=>observed.push(snapshot.current?.id);f.bindings.getFile=async(id,path)=>{const file=await f.service.getFile(id,path);if(armed&&(await readdir(f.storageRoot)).some(name=>name.startsWith('.checkpoint-')))current=false;return file;};await restart(f);observed.length=0;armed=true;
 await assert.rejects(refine(f,undefined,{isCurrent:()=>current}),{code:'operation-retired'});assert.equal(f.session.snapshot().current.id,parent.id);assert.equal(await checkpoint(f),baseline);assert.ok(observed.every(id=>id===parent.id));assert.deepEqual(await readdir(f.storageRoot),['checkpoint.json']);
 await restart(f);assert.equal(f.session.snapshot().current.id,parent.id);assert.equal(await source(f,0),original[0]);
});

test('a contributing source changed during the final precommit read preserves the parent and the human edit',async t=>{
 const f=await refinementFixture(t),parent=f.session.snapshot().current,baseline=await checkpoint(f);let armed=false,changed=false;
 f.bindings.getFile=async(id,path)=>{if(armed&&!changed&&(await readdir(f.storageRoot)).some(name=>name.startsWith('.checkpoint-'))){changed=true;await writeFile(join(f.projectRoot,paths[2]),'// late human change\n');}return f.service.getFile(id,path);};await restart(f);armed=true;
 await assert.rejects(refine(f),{code:'source-conflict'});assert.equal(await checkpoint(f),baseline);assert.equal(f.session.snapshot().current.id,parent.id);assert.equal(await source(f,2),'// late human change\n');
});

test('eight versions bound one refinement chain while independent groups retain separate history',async t=>{
 const f=await refinementFixture(t),root=f.session.snapshot().current;
 for(let i=1;i<8;i++)await refine(f);assert.equal(f.session.snapshot().versions.length,8);const baseline=await checkpoint(f);
 await assert.rejects(refine(f),{code:'checkpoint-capacity'});assert.equal(await checkpoint(f),baseline);
 await activate(f,root.id);await assert.rejects(refine(f),{code:'checkpoint-capacity'});await act(f,'discard');
 const independent=nextVersion(f);await f.session.stage(independent);assert.equal(f.session.snapshot().versions.length,9);assert.equal(f.session.snapshot().versions.at(-1).parentId,null);
 await assert.rejects(activate(f,root.id),{code:'version-unavailable'});await restart(f);assert.equal(f.session.snapshot().versions.length,9);assert.equal(f.session.snapshot().current.id,independent.id);
});

test('malformed version ancestry and cross-version journals preserve backing bytes unchanged',async t=>{
 const f=await refinementFixture(t);await refine(f);const baseline=JSON.parse(await checkpoint(f));
 const variants=[v=>v.versions[1].parentId=v.versions[1].group.id,v=>v.versions[0].parentId=v.versions[1].group.id,v=>v.versions[1].parentId=randomUUID(),v=>v.versions[1].group.context.reverse(),v=>v.activeId=randomUUID(),v=>v.versions.push(structuredClone(v.versions[0])),v=>v.versions[0].group.status='recovery-required',v=>v.operation={groupId:v.versions[0].group.id,id:randomUUID(),kind:'apply',startedAt:new Date().toISOString(),recoveryTarget:'before',writtenPaths:[]}];
 for(const mutate of variants){const bad=structuredClone(baseline);mutate(bad);const bytes=JSON.stringify(bad);await writeFile(join(f.storageRoot,'checkpoint.json'),bytes);await assert.rejects(restart(f),{code:'storage-unavailable'});assert.equal(await checkpoint(f),bytes);assert.equal(await source(f,0),original[0]);}
});

test('a directory-sync failure after atomic rename exposes the committed selection and blocks writes until Retry',async t=>{
 const f=await refinementFixture(t),child=nextVersion(f);let armed=false,blocked=false;
 f.bindings.onChange=snapshot=>{if(armed&&!blocked&&snapshot.current?.id===child.id&&snapshot.storage.status==='saving'){blocked=true;renameSync(f.storageRoot,`${f.storageRoot}-held`);writeFileSync(f.storageRoot,'block directory sync');}};
 await restart(f);armed=true;await assert.rejects(refine(f,child),error=>error.code==='storage-error'&&error.committed===true);
 assert.equal(f.session.snapshot().current.id,child.id);assert.equal(f.session.snapshot().versions.length,2);assert.equal(f.session.snapshot().storage.status,'error');assert.match(f.session.snapshot().storage.message,/selection was committed/);
 await assert.rejects(act(f,'apply'),{code:'storage-error'});assert.equal(await source(f,0),original[0]);await rm(f.storageRoot);await rename(`${f.storageRoot}-held`,f.storageRoot);
 assert.equal(JSON.parse(await checkpoint(f)).activeId,child.id);await f.session.retry();await restart(f);assert.equal(f.session.snapshot().current.id,child.id);assert.equal(f.session.snapshot().storage.status,'saved');
});

test('process exit before rename restores the prior version while exit after rename restores the committed version',async t=>{
 for(const mode of ['before','after']){
  const f=await refinementFixture(t),parent=f.session.snapshot().current,child=nextVersion(f),moduleUrl=new URL('../src/change-set-session.mjs',import.meta.url).href;
  const script=`import {createChangeSetSession} from ${JSON.stringify(moduleUrl)};import {readFile,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';import {join} from 'node:path';
   const root=${JSON.stringify(f.projectRoot)},storageRoot=${JSON.stringify(f.storageRoot)},projectId=${JSON.stringify(f.project.id)},child=${JSON.stringify(child)},parent=${JSON.stringify(parent)},mode=${JSON.stringify(mode)};let armed=false;
   const session=createChangeSetSession({storageRoot,projectId,getFile:async(_id,path)=>{if(armed&&mode==='before'&&(await readdir(storageRoot)).some(name=>name.startsWith('.checkpoint-')))process.exit(43);const source=await readFile(join(root,path),'utf8');return {source,revision:createHash('sha256').update(source).digest('hex').slice(0,16)};},applyBatch:async()=>{throw Error('Source writes forbidden');},onChange:value=>{if(armed&&mode==='after'&&value.current?.id===child.id)process.exit(44);}});
   await session.load();armed=true;await session.refine(child,{parentId:parent.id,expectedParentRevision:parent.revision,parentDigest:${JSON.stringify(changeGroupDigest(parent))}});process.exit(99);`;
  const status=await new Promise((resolve,reject)=>{const processChild=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});let output='';processChild.stderr.on('data',chunk=>{output+=chunk;});processChild.on('error',reject);processChild.on('exit',(code,signal)=>resolve({code,signal,output}));});
  assert.equal(status.code,mode==='before'?43:44,status.output);await restart(f);assert.equal(f.session.snapshot().current.id,mode==='before'?parent.id:child.id);assert.equal(f.session.snapshot().versions.length,mode==='before'?1:2);
  assert.equal(await source(f,0),original[0]);assert.equal(await source(f,1),original[1]);
 }
});

test('the absolute 64-version capacity preserves all independent roots without eviction',async t=>{
 const f=await refinementFixture(t),saved=JSON.parse(await checkpoint(f)),template=saved.versions[0];
 saved.versions=Array.from({length:64},()=>({parentId:null,group:{...structuredClone(template.group),id:randomUUID(),requestId:randomUUID(),status:'discarded'},checkpoints:structuredClone(template.checkpoints)}));saved.activeId=saved.versions.at(-1).group.id;
 await writeFile(join(f.storageRoot,'checkpoint.json'),JSON.stringify(saved));await restart(f);const baseline=await checkpoint(f);
 await assert.rejects(f.session.stage(nextVersion(f)),{code:'checkpoint-capacity'});assert.equal(f.session.snapshot().versions.length,64);assert.equal(await checkpoint(f),baseline);
});


test('isBusy reads the change-set operation lock without cloning source or publishing snapshots',async t=>{
 const f=await fixture(t);let armed=false,release,entered;const gate=new Promise(resolve=>{release=resolve;}),reading=new Promise(resolve=>{entered=resolve;});const events=[];
 f.bindings.getFile=async(id,path)=>{if(armed){armed=false;entered();await gate;}return f.service.getFile(id,path);};f.bindings.onChange=value=>events.push(value);await restart(f);
 const check=expected=>{assert.equal(f.session.snapshot().busy,expected);const clone=globalThis.structuredClone,publications=events.length;globalThis.structuredClone=()=>{throw Error('isBusy must not project or clone source');};try{for(let index=0;index<10000;index++)assert.equal(f.session.isBusy(),expected);}finally{globalThis.structuredClone=clone;}assert.equal(events.length,publications);};
 check(false);armed=true;const pending=f.session.assess();await reading;
 try{check(true);}finally{release();}
 await pending;check(false);f.session.dispose();check(false);
});
