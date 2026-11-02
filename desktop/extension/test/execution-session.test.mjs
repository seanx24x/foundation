import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createExecutionSession,changeGroupDigest} from '../src/execution-session.mjs';
import {createBuildArtifact} from '../../../server/project/proposals.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(check,label)=>{const end=Date.now()+8000;while(Date.now()<end){if(await check())return;await pause(15);}throw Error('Timed out '+label);};
const native={skip:process.platform!=='darwin'};
const A='export const a = 1;\n',B='export const b = 1;\n';
async function fixture(t,{script,extra={},changed={}}={}){
 const base=await mkdtemp('/private/tmp/foundation-execution-test-'),root=join(base,'project'),storageRoot=join(base,'storage');await mkdir(root);
 const source={'a.mjs':A,'b.mjs':B,'check.test.mjs':script||"import test from 'node:test'; import assert from 'node:assert/strict'; import {a} from './a.mjs'; import {b} from './b.mjs'; test('staged values',()=>{assert.equal(a,2);assert.equal(b,2);});\n",...extra};
 for(const [name,value] of Object.entries(source)){await mkdir(join(root,name,'..'),{recursive:true});await writeFile(join(root,name),value);}
 const files=['a.mjs','b.mjs'].map(path=>({path,source:source[path],revision:hash(source[path]).slice(0,16)}));
 const group=createBuildArtifact({projectId:'p1',files,raw:JSON.stringify({title:'Update both values',summary:'One coordinated intent.',edits:files.map(f=>({path:f.path,find:'= 1;',replace:changed[f.path]||'= 2;'})),verification:['Run the selected check.']})}).changeSet;
 const session=createExecutionSession({storageRoot,root,projectId:'p1'});t.after(async()=>{await session.dispose();await rm(base,{recursive:true,force:true});});
 await session.load();return {base,root,storageRoot,source,files,group,session};
}
const prepare=async f=>{const result=await f.session.prepare(f.group);assert.equal(result.current.status,'ready');return result.current;};
const run=async(f,task='node:test')=>{const c=f.session.snapshot().current;return f.session.run(c.id,c.revision,task);};

test('change-group digest binds immutable generated source while excluding lifecycle metadata',async t=>{
 const f=await fixture(t);const g=structuredClone(f.group);g.revision=7;g.status='discarded';assert.equal(changeGroupDigest(g),changeGroupDigest(f.group));g.summary='Different intent';assert.notEqual(changeGroupDigest(g),changeGroupDigest(f.group));
});
test('capability probe and preparing copied staged source never modify the original project',native,async t=>{
 const f=await fixture(t,{extra:{'.env':'LOCAL_SECRET=excluded','.npmrc':'token=excluded','dist/old.js':'cached','node_modules/.bin/keep':'ignored'}});assert.equal(f.session.snapshot().capabilities.supported,true);const before=await readFile(join(f.root,'a.mjs'),'utf8');const c=await prepare(f);
 assert.equal(c.files,3);assert.equal(c.tasks.length,1);assert.equal(c.tasks[0].id,'node:test');assert.equal(await readFile(join(f.root,'a.mjs'),'utf8'),before);
 const work=join(f.storageRoot,'runs',c.id,'workspace');assert.equal(await readFile(join(work,'a.mjs'),'utf8'),'export const a = 2;\n');await assert.rejects(readFile(join(work,'.env')));assert.match(c.snapshotRevision,/^[a-f0-9]{64}$/);
});
test('Node test recipe executes staged values once, preserves original bytes and records an independent result',native,async t=>{
 const f=await fixture(t);await prepare(f);const result=await run(f);assert.equal(result.current.status,'passed');assert.equal(result.current.exitCode,0);assert.match(result.current.output,/staged values/);assert.equal(result.current.outputTruncated,false);assert.equal(await readFile(join(f.root,'a.mjs'),'utf8'),A);assert.equal(f.group.verificationStatus,'not-run');await assert.rejects(run(f),/Prepare and choose/);
});
test('failed checks retain output and never become passing source verification',native,async t=>{
 const f=await fixture(t,{script:"import test from 'node:test'; import assert from 'node:assert/strict'; test('real failure',()=>assert.equal(1,2));\n"});await prepare(f);const result=await run(f);assert.equal(result.current.status,'failed');assert.notEqual(result.current.exitCode,0);assert.match(result.current.output,/real failure/);assert.equal(await readFile(join(f.root,'b.mjs'),'utf8'),B);
});
test('OS boundary denies original writes, network and child processes while inside-copy output is allowed',native,async t=>{
 const f=await fixture(t);const script=`import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import cp from 'node:child_process';import net from 'node:net';test('boundary',async()=>{fs.writeFileSync('generated-output.txt','inside');assert.throws(()=>fs.writeFileSync(${JSON.stringify(join(f.root,'a.mjs'))},'overwritten'),e=>e.code==='EPERM');assert.throws(()=>cp.execFileSync(process.execPath,['-e','process.exit(0)']),e=>e.code==='EPERM');await new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port:49999});socket.once('error',e=>{try{assert.equal(e.code,'EPERM');resolve()}catch(e){reject(e)}});socket.once('connect',()=>{socket.destroy();reject(Error('Network unexpectedly connected'))})});});`;
 await writeFile(join(f.root,'check.test.mjs'),script);await prepare(f);const result=await run(f);assert.equal(result.current.status,'passed',result.current.output);assert.equal(await readFile(join(f.root,'a.mjs'),'utf8'),A);
});
test('read boundary is honest: local files can be read but credentials are not inherited in environment',native,async t=>{
 const f=await fixture(t);await writeFile(join(f.base,'sentinel'),'readable');await writeFile(join(f.root,'check.test.mjs'),`import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';test('read boundary',()=>{assert.equal(fs.readFileSync(${JSON.stringify(join(f.base,'sentinel'))},'utf8'),'readable');assert.equal(process.env.OPENAI_API_KEY,undefined);assert.equal(process.env.ANTHROPIC_API_KEY,undefined);assert.equal(process.env.FOUNDATION_AI_API_KEY,undefined);assert.equal(process.env.NODE_OPTIONS,undefined);});`);
 await prepare(f);assert.equal((await run(f)).current.status,'passed');
});
test('a check that mutates existing copied source cannot verify the staged snapshot',native,async t=>{
 const f=await fixture(t,{script:"import test from 'node:test';import fs from 'node:fs';test('mutate',()=>fs.writeFileSync('a.mjs','changed during check'));"});await prepare(f);await assert.rejects(run(f),/modified or removed copied source/);assert.equal(f.session.snapshot().current.status,'failed');assert.equal(await readFile(join(f.root,'a.mjs'),'utf8'),A);
});
test('all saved contributing and copied source is rechecked before Run',native,async t=>{
 const f=await fixture(t);await prepare(f);await writeFile(join(f.root,'check.test.mjs'),'changed');await assert.rejects(run(f),/Saved project files changed/);assert.equal(f.session.snapshot().current.status,'failed');assert.equal(await readFile(join(f.root,'check.test.mjs'),'utf8'),'changed');
});
test('tampering with a prepared copy blocks execution rather than running its new bytes',native,async t=>{
 const f=await fixture(t);const c=await prepare(f);await writeFile(join(f.storageRoot,'runs',c.id,'workspace','a.mjs'),'tampered');await assert.rejects(run(f),/prepared copy changed/);assert.equal(f.session.snapshot().current.status,'failed');
});
test('asynchronous preparation ownership guards reject changed or dirty source without starting a tool',native,async t=>{
 const f=await fixture(t);await assert.rejects(f.session.prepare(f.group,{guard:async()=>{throw Error('Native draft changed');}}));assert.equal(f.session.snapshot().current,null);assert.equal(await readFile(join(f.root,'a.mjs'),'utf8'),A);
});
test('Stop remains available while preparation is waiting and load is idempotent',native,async t=>{
 const f=await fixture(t);let release;const hold=new Promise(r=>release=r);let count=0;const preparing=f.session.prepare(f.group,{guard:async()=>{if(++count===2)await hold;}});await wait(()=>f.session.snapshot().current?.status==='preparing','preparation');assert.equal((await f.session.load()).busy,true);const c=f.session.snapshot().current;const stopped=f.session.stop(c.id,c.revision);release();await preparing.catch(()=>{});const result=await stopped;assert.equal(result.current.status,'cancelled');assert.equal(result.busy,false);
});
test('explicit Stop terminates a running recipe and preserves original files',native,async t=>{
 const f=await fixture(t,{script:"import test from 'node:test';test('waiting',async()=>{console.log('started');await new Promise(r=>setTimeout(r,10000));});"});await prepare(f);const pending=run(f);await wait(()=>f.session.snapshot().current?.status==='running'&&f.session.snapshot().current.output.includes('started'),'started check');const c=f.session.snapshot().current;await f.session.stop(c.id,c.revision-1);await pending.catch(()=>{});const stoppedRecord=JSON.parse(await readFile(join(f.storageRoot,'execution.json'),'utf8')).current;assert.equal(stoppedRecord.status,'cancelled');assert.equal(f.session.snapshot().current.status,'cancelled');assert.equal(f.session.snapshot().busy,false);assert.equal(await readFile(join(f.root,'a.mjs'),'utf8'),A);
});
test('owner loss during a running process stops it even when project trust was revoked',native,async t=>{
 const f=await fixture(t,{script:"import test from 'node:test';test('waiting',async()=>{console.log('started');await new Promise(r=>setTimeout(r,10000));});"});await prepare(f);let permitted=true;const c=f.session.snapshot().current;const pending=f.session.run(c.id,c.revision,'node:test',{guard:async()=>{if(!permitted)throw Error('Owner changed');}});await wait(()=>f.session.snapshot().current.output.includes('started'),'started');permitted=false;await pending.catch(()=>{});assert.equal(f.session.snapshot().current.status,'cancelled');assert.match(f.session.snapshot().current.reason,/ownership changed/);
});
test('bounded output is drained, marked truncated and stored within 64 KiB',native,async t=>{
 const f=await fixture(t,{script:"import test from 'node:test';test('output',()=>{process.stdout.write('x'.repeat(256*1024));});"});await prepare(f);const result=await run(f);assert.equal(result.current.status,'passed');assert.equal(result.current.outputTruncated,true);assert.ok(Buffer.byteLength(result.current.output)<=65536);const stored=JSON.parse(await readFile(join(f.storageRoot,'execution.json'),'utf8'));assert.ok(Buffer.byteLength(stored.current.output)<=65536);
});
test('restart changes ready to interrupted without executing project files or restoring PID ownership',native,async t=>{
 const f=await fixture(t);const c=await prepare(f);await f.session.dispose();const restored=createExecutionSession({storageRoot:f.storageRoot,root:f.root,projectId:'p1'});t.after(()=>restored.dispose());const result=await restored.load();assert.equal(result.current.id,c.id);assert.equal(result.current.status,'interrupted');assert.equal(result.assessment.canRun,false);assert.equal(result.assessment.canStop,false);assert.equal(result.current.output,'');assert.equal(await readFile(join(f.root,'a.mjs'),'utf8'),A);
});
test('completed results survive restart as history without rerunning',native,async t=>{
 const f=await fixture(t);await prepare(f);const result=await run(f);const restored=createExecutionSession({storageRoot:f.storageRoot,root:f.root,projectId:'p1'});t.after(()=>restored.dispose());assert.deepEqual((await restored.load()).current,result.current);assert.equal(restored.snapshot().assessment.canRun,false);
});
test('persisted running records become interrupted and cannot supply a command',native,async t=>{
 const f=await fixture(t);await prepare(f);await f.session.dispose();const file=join(f.storageRoot,'execution.json'),saved=JSON.parse(await readFile(file,'utf8'));saved.current.status='running';saved.current.taskId='node:test';saved.current.startedAt=saved.current.updatedAt;await writeFile(file,JSON.stringify(saved));const restored=createExecutionSession({storageRoot:f.storageRoot,root:f.root,projectId:'p1'});t.after(()=>restored.dispose());const result=await restored.load();assert.equal(result.current.status,'interrupted');assert.equal(result.assessment.canRun,false);
});
test('unknown storage fields are left untouched with unavailable history',native,async t=>{
 const f=await fixture(t);await prepare(f);await f.session.dispose();const file=join(f.storageRoot,'execution.json'),saved=JSON.parse(await readFile(file,'utf8'));saved.current.arbitraryPath='/tmp';const body=JSON.stringify(saved);await writeFile(file,body);const restored=createExecutionSession({storageRoot:f.storageRoot,root:f.root,projectId:'p1'});t.after(()=>restored.dispose());await assert.rejects(restored.load(),/could not be read safely/);assert.equal(restored.snapshot().storage.status,'unavailable');assert.equal(await readFile(file,'utf8'),body);
});
test('failed record persistence blocks execution and explicit retry preserves the failed checkpoint',native,async t=>{
 const f=await fixture(t);const record=join(f.storageRoot,'execution.json');await mkdir(record);await assert.rejects(f.session.prepare(f.group),/could not be saved/);assert.equal(f.session.snapshot().storage.status,'error');await assert.rejects(run(f),/Retry local storage/);await rm(record,{recursive:true});const result=await f.session.retry();assert.equal(result.storage.status,'saved');assert.equal(result.current.status,'failed');assert.equal(result.assessment.canRun,false);
});
test('source symlinks cannot import external files into the copied project',native,async t=>{
 const f=await fixture(t);await writeFile(join(f.base,'foreign'),'foreign source');await symlink(join(f.base,'foreign'),join(f.root,'linked.mjs'));await assert.rejects(f.session.prepare(f.group),/Symbolic links/);assert.equal(f.session.snapshot().current.status,'failed');assert.equal(await readFile(join(f.base,'foreign'),'utf8'),'foreign source');
});
test('a second prepare archives the first record in chronological order and removes only its owned copy',native,async t=>{
 const f=await fixture(t);const first=await prepare(f);await run(f);const next=await prepare(f);assert.notEqual(next.id,first.id);const result=f.session.snapshot();assert.equal(result.history.length,1);assert.equal(result.history[0].id,first.id);assert.equal(result.history[0].status,'passed');await assert.rejects(readFile(join(f.storageRoot,'runs',first.id,'owner.json')));assert.equal(await readFile(join(f.root,'a.mjs'),'utf8'),A);
});
test('history capacity blocks new work without deleting earlier results',native,async t=>{
 const f=await fixture(t);for(let i=0;i<13;i++)await prepare(f);const before=JSON.stringify(f.session.snapshot().history);await assert.rejects(f.session.prepare(f.group),/history is full/);assert.equal(f.session.snapshot().history.length,12);assert.equal(JSON.stringify(f.session.snapshot().history),before);
});
test('local TypeScript check runs the copied compiler with noEmit and reports actual diagnostics',native,async t=>{
 const f=await fixture(t,{extra:{'tsconfig.json':JSON.stringify({compilerOptions:{strict:true,skipLibCheck:true},files:['typed.ts']}),'typed.ts':'export const typed: number = 2;'}});await rm(join(f.root,'check.test.mjs'));await mkdir(join(f.root,'node_modules'));await cp(resolve('node_modules/typescript'),join(f.root,'node_modules/typescript'),{recursive:true});const c=await prepare(f);assert.deepEqual(c.tasks.map(t=>t.id),['typescript:check']);assert.equal((await run(f,'typescript:check')).current.status,'passed');assert.equal(await readFile(join(f.root,'typed.ts'),'utf8'),'export const typed: number = 2;');
 await writeFile(join(f.root,'typed.ts'),'export const typed: number = "wrong";');await prepare(f);const bad=await run(f,'typescript:check');assert.equal(bad.current.status,'failed');assert.match(bad.current.output,/TS2322/);await assert.rejects(readFile(join(f.root,'typed.js')));
});

test('option-like test filenames are passed as literal selected paths',native,async t=>{
 const f=await fixture(t,{extra:{'--test-name-pattern=excluded.test.js':"const test=require('node:test');test('option-like filename executes',()=>{throw Error('literal selected test ran')});"}});const c=await prepare(f);assert.match(c.tasks[0].command,/\.\/--test-name-pattern=/);const result=await run(f);assert.equal(result.current.status,'failed');assert.match(result.current.output,/literal selected test ran/);
});
test('malformed success evidence cannot become a passing historical result',native,async t=>{
 const f=await fixture(t);await prepare(f);await f.session.dispose();const file=join(f.storageRoot,'execution.json'),saved=JSON.parse(await readFile(file,'utf8'));saved.current.status='passed';saved.current.finishedAt=saved.current.updatedAt;const body=JSON.stringify(saved);await writeFile(file,body);const restored=createExecutionSession({storageRoot:f.storageRoot,root:f.root,projectId:'p1'});t.after(()=>restored.dispose());await assert.rejects(restored.load(),/could not be read safely/);assert.equal(await readFile(file,'utf8'),body);
});
test('final preparation persistence is followed by another asynchronous ownership guard',native,async t=>{
 const f=await fixture(t);await f.session.dispose();let fresh=true,count=0;const session=createExecutionSession({storageRoot:f.storageRoot,root:f.root,projectId:'p1',onChange:s=>{if(s.current?.status==='ready'&&s.storage.status==='saved'&&++count===2)fresh=false;}});t.after(()=>session.dispose());await session.load();await assert.rejects(session.prepare(f.group,{guard:async()=>{if(!fresh)throw Error('Owner retired during save');}}));assert.equal(session.snapshot().current.status,'failed');assert.equal(session.snapshot().assessment.canRun,false);
});
test('directory entries count toward the bounded copy and cannot evade limits with empty folders',native,async t=>{
 const f=await fixture(t);const dir=join(f.root,'empty-folders');await mkdir(dir);for(let start=0;start<32768;start+=128)await Promise.all(Array.from({length:Math.min(128,32768-start)},(_,i)=>mkdir(join(dir,String(start+i)))));await assert.rejects(f.session.prepare(f.group),/32,768-entry/);assert.equal(f.session.snapshot().current.status,'failed');
});
test('isolated checks cannot signal another process or hard-link an original inode for writing',native,async t=>{
 const f=await fixture(t);const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});t.after(()=>{try{sentinel.kill('SIGTERM')}catch{}});await writeFile(join(f.base,'outside-sentinel'),'original');
 await writeFile(join(f.root,'check.test.mjs'),`import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';test('nonlocal capabilities denied',()=>{assert.throws(()=>process.kill(${sentinel.pid},'SIGTERM'),e=>e.code==='EPERM');assert.throws(()=>fs.linkSync(${JSON.stringify(join(f.base,'outside-sentinel'))},'linked-sentinel'),e=>e.code==='EPERM');});`);await prepare(f);const result=await run(f);assert.equal(result.current.status,'passed',result.current.output);assert.equal(sentinel.exitCode,null);assert.equal(await readFile(join(f.base,'outside-sentinel'),'utf8'),'original');
});


test('strict plan bindings persist with schema two and each attempt has exactly one execution record',native,async t=>{
 const f=await fixture(t),plan={planId:randomUUID(),stepId:randomUUID(),attemptId:randomUUID()};
 for(const invalid of [{...plan,command:'npm test'},{...plan,attemptId:'invalid'},{planId:plan.planId}])await assert.rejects(f.session.prepare(f.group,{plan:invalid}),/exact saved check-plan attempt/);
 assert.equal(f.session.snapshot().current,null);await f.session.prepare(f.group,{plan});await run(f);const saved=JSON.parse(await readFile(join(f.storageRoot,'execution.json'),'utf8'));assert.equal(saved.schemaVersion,2);assert.deepEqual(saved.current.plan,plan);await assert.rejects(f.session.prepare(f.group,{plan}),/already has an execution/);
 const restored=createExecutionSession({storageRoot:f.storageRoot,root:f.root,projectId:'p1'});t.after(()=>restored.dispose());assert.deepEqual((await restored.load()).current.plan,plan);
});
test('completed schema one execution history loads without rewriting and rejects bindings reserved for schema two',native,async t=>{
 const f=await fixture(t);await prepare(f);await run(f);const path=join(f.storageRoot,'execution.json'),saved=JSON.parse(await readFile(path,'utf8'));saved.schemaVersion=1;const original=JSON.stringify(saved);await writeFile(path,original);const restored=createExecutionSession({storageRoot:f.storageRoot,root:f.root,projectId:'p1'});t.after(()=>restored.dispose());assert.equal((await restored.load()).current.status,'passed');assert.equal(await readFile(path,'utf8'),original);
 saved.current.plan={planId:randomUUID(),stepId:randomUUID(),attemptId:randomUUID()};const malformed=JSON.stringify(saved);await writeFile(path,malformed);const rejected=createExecutionSession({storageRoot:f.storageRoot,root:f.root,projectId:'p1'});t.after(()=>rejected.dispose());await assert.rejects(rejected.load(),/could not be read safely/);assert.equal(await readFile(path,'utf8'),malformed);
});
test('the final synchronous dispatch hook can cancel before any project code starts',native,async t=>{
 const f=await fixture(t,{script:"import test from 'node:test';import fs from 'node:fs';test('marker',()=>fs.writeFileSync('ran-marker','yes'));"});const prepared=await prepare(f);let called=false;
 await assert.rejects(f.session.run(prepared.id,prepared.revision,'node:test',{beforeRun:()=>{called=true;throw Error('Active chat changed at dispatch');}}),/Active chat changed/);assert.equal(called,true);assert.equal(f.session.snapshot().current.status,'failed');assert.equal(f.session.snapshot().current.output,'');await assert.rejects(readFile(join(f.storageRoot,'runs',prepared.id,'workspace','ran-marker')),{code:'ENOENT'});
});


test('isBusy reads the isolated execution lock without cloning records or projecting assessment',native,async t=>{
 const f=await fixture(t);let release,entered,first=true;const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{entered=resolve;});
 const check=expected=>{assert.equal(f.session.snapshot().busy,expected);const clone=globalThis.structuredClone;globalThis.structuredClone=()=>{throw Error('isBusy must not project or clone execution records');};try{for(let index=0;index<10000;index++)assert.equal(f.session.isBusy(),expected);}finally{globalThis.structuredClone=clone;}};
 check(false);const pending=f.session.prepare(f.group,{guard:async()=>{if(first){first=false;entered();await gate;}}});await waiting;
 try{check(true);}finally{release();}
 await pending;check(false);await f.session.dispose();check(false);
});
