import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,cp,realpath,stat,open} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAlternativeWorkspaces,ALTERNATIVE_WORKSPACE_LIMITS,alternativePathExcluded} from '../src/alternative-workspaces.mjs';
import {createConnectedRuntime} from '../src/connected-runtime.mjs';
import {createProjectService} from '../../../server/project/workspace.mjs';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const native={skip:process.platform!=='darwin'};
const before=':root { --radius: 8px; }\n',after=':root { --radius: 12px; }\n';
const hash=source=>createHash('sha256').update(source).digest('hex');
const shippedNode=join(repo,'desktop/.build/Foundation.app/Contents/MacOS/Foundation');
async function fixture(t,{nodePath=process.execPath,isCurrent}={}){
 const temp=await realpath(await mkdtemp('/private/tmp/foundation-alternative-test-')),root=join(temp,'original'),storageRoot=join(temp,'copies');await mkdir(root);
 await writeFile(join(root,'tokens.css'),before);await writeFile(join(root,'package.json'),JSON.stringify({name:'test-alternative',scripts:{dev:'vite'}}));
 const service=createAlternativeWorkspaces({root,storageRoot,projectId:'alternative-test',nodePath,isCurrent});
 t.after(async()=>{service.dispose();await rm(temp,{recursive:true,force:true});});
 const prepare=(extra={})=>service.prepare({comparisonId:randomUUID(),path:'tokens.css',before,after,...extra});
 return {temp,root,storageRoot,service,prepare};
}
const result=child=>new Promise((resolve,reject)=>{let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.once('error',reject);child.once('close',code=>code===0?resolve(stdout):reject(new Error(`Child failed ${code}: ${stderr}`)));});

test('copies the same saved baseline twice, overlays only the proposed target, and survives restart',native,async t=>{
 const {root,storageRoot,service,prepare}=await fixture(t);await writeFile(join(root,'untouched.ts'),'export const answer=42;');
 await writeFile(join(root,'.env'),'SECRET=excluded');await mkdir(join(root,'node_modules/.bin'),{recursive:true});await symlink('/bin/sh',join(root,'node_modules/.bin/vite'));
 const value=await prepare();assert.equal(value.variants.length,2);assert.equal(value.variants[0].files,3);assert.notEqual(value.variants[0].manifestDigest,value.variants[1].manifestDigest);
 assert.equal(await readFile(join(root,'tokens.css'),'utf8'),before);
 for(const variant of value.variants){assert.equal(await readFile(join(variant.root,'tokens.css'),'utf8'),variant.id==='baseline'?before:after);await assert.rejects(readFile(join(variant.root,'.env')),e=>e.code==='ENOENT');await service.validate(value.comparisonId,variant.id,variant.manifestDigest);}
 assert.deepEqual(await service.readSources(value.comparisonId,'alternative',['tokens.css','untouched.ts']),[{path:'tokens.css',revision:hash(after)},{path:'untouched.ts',revision:hash('export const answer=42;')}]);
 await service.validateOriginal(value.comparisonId);
 const reopened=createAlternativeWorkspaces({root,storageRoot,projectId:'alternative-test'});t.after(()=>reopened.dispose());assert.deepEqual(await reopened.resolveVariant(value.comparisonId,'baseline'),value.variants[0]);await reopened.cleanup(value.comparisonId);await assert.rejects(stat(join(storageRoot,value.comparisonId)),e=>e.code==='ENOENT');
});

test('refuses linked source and dependencies without touching the original or a foreign directory',native,async t=>{
 const {root,storageRoot,prepare}=await fixture(t);await symlink('/etc/hosts',join(root,'linked.ts'));const id=randomUUID();await assert.rejects(prepare({comparisonId:id}),e=>e.code==='alternative-symlink');await assert.rejects(stat(join(storageRoot,id)),e=>e.code==='ENOENT');assert.equal(await readFile(join(root,'tokens.css'),'utf8'),before);
});

test('rejects a stale source, file oversize, unsupported target, and a reused comparison id',native,async t=>{
 const {root,service,prepare}=await fixture(t);await assert.rejects(prepare({before:'stale'}),e=>e.code==='alternative-source-changed');await assert.rejects(prepare({path:'../tokens.css'}),e=>e.code==='alternative-input');await assert.rejects(prepare({path:'tokens.ts'}),e=>e.code==='alternative-input');await assert.rejects(prepare({after:'x'.repeat(ALTERNATIVE_WORKSPACE_LIMITS.sourceBytes+1)}),e=>e.code==='alternative-input');
 const handle=await open(join(root,'oversized.js'),'w');await handle.truncate(ALTERNATIVE_WORKSPACE_LIMITS.fileBytes+1);await handle.close();await assert.rejects(prepare(),e=>e.code==='alternative-file');await rm(join(root,'oversized.js'));
 const value=await prepare();await assert.rejects(prepare({comparisonId:value.comparisonId}),e=>e.code==='EEXIST');await service.validate(value.comparisonId,'baseline');
});

test('retirement and host guards abort across awaited copy operations',native,async t=>{
 let current=true;const {root,storageRoot,service,prepare}=await fixture(t,{isCurrent:()=>current});let hits=0;
 await assert.rejects(prepare({guard:async()=>{if(++hits===45)current=false;}}),e=>e.code==='alternative-retired');assert.equal(await readFile(join(root,'tokens.css'),'utf8'),before);assert.ok(hits>=45);
 current=true;const id=randomUUID();await assert.rejects(prepare({comparisonId:id,guard:async()=>{if(await stat(join(storageRoot,id,'baseline/workspace/tokens.css')).catch(()=>null))throw new Error('host revision changed');}}),/host revision changed/);await assert.rejects(stat(join(storageRoot,id)),e=>e.code==='ENOENT');service.dispose();await assert.rejects(prepare(),e=>e.code==='alternative-retired');
});

test('rechecks original after creating both copies, rejecting edits during preparation',native,async t=>{
 const {root,storageRoot,prepare}=await fixture(t);const id=randomUUID();let changed=false;
 await assert.rejects(prepare({comparisonId:id,guard:async()=>{if(!changed&&await stat(join(storageRoot,id,'alternative/workspace/tokens.css')).catch(()=>null)){changed=true;await writeFile(join(root,'package.json'),'{}');}}}),e=>e.code==='alternative-source-changed');assert.ok(changed);assert.equal(await readFile(join(root,'tokens.css'),'utf8'),before);
});

test('copy hashes, added source, source revision and ownership metadata cannot be silently reaccepted',native,async t=>{
 const {root,storageRoot,service,prepare}=await fixture(t);const value=await prepare(),variant=value.variants[1];await writeFile(join(variant.root,'tokens.css'),before);await assert.rejects(service.validate(value.comparisonId,'alternative'),e=>e.code==='alternative-copy-changed');await writeFile(join(variant.root,'tokens.css'),after);await writeFile(join(variant.root,'added.ts'),'new');await assert.rejects(service.readSources(value.comparisonId,'alternative',['tokens.css']),e=>e.code==='alternative-copy-changed');await rm(join(variant.root,'added.ts'));
 await writeFile(join(root,'tokens.css'),after);await assert.rejects(service.validateOriginal(value.comparisonId),e=>e.code==='alternative-source-changed');
 const marker=join(storageRoot,value.comparisonId,'owner.json');await writeFile(marker,JSON.stringify({schemaVersion:1,projectId:'foreign',comparisonId:value.comparisonId,sourceRoot:root}));await assert.rejects(service.cleanup(value.comparisonId),e=>e.code==='alternative-owner');assert.equal(await readFile(join(variant.root,'tokens.css'),'utf8'),after);
});

test('ignored runtime cache changes are excluded while manifest forgery and linked workspace are refused',native,async t=>{
 const {storageRoot,service,prepare}=await fixture(t);const value=await prepare(),variant=value.variants[0];await writeFile(join(variant.root,'.foundation-runtime-home/cache'),'owned cache');await service.validate(value.comparisonId,'baseline');
 const manifest=join(storageRoot,value.comparisonId,'manifest.json'),body=JSON.parse(await readFile(manifest,'utf8'));body.variants[0].files[0].hash='0'.repeat(64);await writeFile(manifest,JSON.stringify(body));await assert.rejects(service.resolveVariant(value.comparisonId,'baseline'),e=>e.code==='alternative-manifest');
 const other=await prepare();await rm(other.variants[0].root,{recursive:true});await symlink(other.variants[1].root,other.variants[0].root);await assert.rejects(service.validate(other.comparisonId,'baseline'),e=>e.code==='alternative-storage');
});

test('source selectors and launcher accept only bounded host-owned inputs',native,async t=>{
 const {service,prepare}=await fixture(t);const value=await prepare(),root=value.variants[0].root;
 for(const paths of [[],['../tokens.css'],Array.from({length:33},(_,i)=>`${i}.css`),['tokens.css','tokens.css'],['absent.css']])await assert.rejects(service.readSources(value.comparisonId,'baseline',paths),e=>e.code==='alternative-source');
 await assert.rejects(service.launcher({root,nodePath:process.execPath,args:['-e','evil'],token:'f'.repeat(64)}),e=>e.code==='alternative-command');await assert.rejects(service.launcher({root:'/private/tmp/unowned',nodePath:process.execPath,args:[],token:'f'.repeat(64)}),e=>e.code==='alternative-command');
});

test('shipped Foundation Node denies original writes, inherited child writes, foreign exec and external network',native,async t=>{
 const {root,service,prepare}=await fixture(t,{nodePath:shippedNode});await mkdir(join(root,'node_modules/vite/bin'),{recursive:true});
 await writeFile(join(root,'node_modules/vite/bin/vite.js'),`const fs=require('node:fs'),cp=require('node:child_process'),net=require('node:net');const original=${JSON.stringify(join(root,'tokens.css'))};const proof={};try{fs.writeFileSync(original,'modified');proof.originalWrite='allowed';}catch(e){proof.originalWrite=e.code;}try{fs.linkSync(original,'.foundation-runtime-home/original-hardlink');proof.hardlink='allowed';}catch(e){proof.hardlink=e.code;}try{fs.symlinkSync(original,'.foundation-runtime-home/original-symlink');fs.writeFileSync('.foundation-runtime-home/original-symlink','modified');proof.symlinkWrite='allowed';}catch(e){proof.symlinkWrite=e.code;}proof.child=cp.spawnSync(process.execPath,['-e',"try{require('node:fs').writeFileSync("+JSON.stringify(original)+",'modified');console.log('allowed')}catch(e){console.log(e.code)}"],{encoding:'utf8'}).stdout.trim();const foreign=cp.spawnSync('/bin/sh',['-c','echo forbidden'],{encoding:'utf8'});proof.foreignExec=foreign.error?.code||foreign.status;proof.secretPresent=Boolean(process.env.FOUNDATION_TEST_SECRET);fs.writeFileSync('.foundation-runtime-home/owned','allowed');proof.ownedWrite='allowed';const socket=net.connect({host:'192.0.2.1',port:443});socket.once('error',e=>{proof.externalNetwork=e.code;console.log(JSON.stringify(proof));});socket.once('connect',()=>{proof.externalNetwork='allowed';socket.destroy();console.log(JSON.stringify(proof));});setTimeout(()=>{socket.destroy();},3000).unref();`);
 const value=await prepare(),variant=value.variants[0];const previous=process.env.FOUNDATION_TEST_SECRET;process.env.FOUNDATION_TEST_SECRET='must-not-inherit';let child;
 try{child=await service.launcher({root:variant.root,nodePath:shippedNode,args:[join(variant.root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','52319','--strictPort'],token:'f'.repeat(64)});const finished=result(child);await assert.rejects(service.cleanup(value.comparisonId),e=>e.code==='alternative-running');const proof=JSON.parse(await finished);assert.deepEqual(proof,{originalWrite:'EPERM',hardlink:'EPERM',symlinkWrite:'EPERM',child:'EPERM',foreignExec:'EPERM',secretPresent:false,ownedWrite:'allowed',externalNetwork:'EPERM'});}
 finally{if(previous===undefined)delete process.env.FOUNDATION_TEST_SECRET;else process.env.FOUNDATION_TEST_SECRET=previous;try{process.kill(-child.pid,'SIGKILL');}catch{}}
 assert.equal(await readFile(join(root,'tokens.css'),'utf8'),before);await service.validate(value.comparisonId,'baseline');await service.cleanup(value.comparisonId);
});

test('real copied Vite runtime starts instrumented under the shipped Node boundary and leaves originals intact',native,async t=>{
 const {root,service,prepare}=await fixture(t,{nodePath:shippedNode});await cp(join(repo,'fixtures/connected-web'),root,{recursive:true});await cp(join(repo,'node_modules'),join(root,'node_modules'),{recursive:true,filter:async source=>{const relative=source.slice(join(repo,'node_modules').length).replace(/^\//,'');if(!relative)return true;return !alternativePathExcluded(`node_modules/${relative}`,(await stat(source)).isDirectory());}});
 await cp(join(repo,'desktop/extension/dist/connected-vite-plugin.mjs'),join(root,'foundation-vite-plugin.mjs'));const config=join(root,'vite.config.mjs');await writeFile(config,(await readFile(config,'utf8')).replace('../../desktop/runtime/vite-plugin.mjs','./foundation-vite-plugin.mjs'));
 const value=await prepare(),variant=value.variants[0],runtime=createConnectedRuntime({root:variant.root,nodePath:shippedNode,launchProcess:service.launcher,pollMs:100,startupTimeoutMs:15000});t.after(()=>runtime.dispose());
 const started=await runtime.start();assert.equal(started.status,'connected');assert.equal(started.owned,true);assert.equal(started.capabilities.sourceMapping,'instrumented');assert.equal(started.capabilities.scenarioReplay,true);const response=await fetch(new URL('/__foundation/handshake',started.url));assert.equal(response.status,200);assert.equal((await response.json()).root,variant.root);await runtime.stop();await service.validate(value.comparisonId,'baseline',variant.manifestDigest);await service.validateOriginal(value.comparisonId);assert.equal(await readFile(join(root,'tokens.css'),'utf8'),before);
});

test('host launch hook error is surfaced and a late owned child is terminated after cancellation',native,async t=>{
 const {root}=await fixture(t);await mkdir(join(root,'node_modules/vite/bin'),{recursive:true});await writeFile(join(root,'node_modules/vite/package.json'),'{"name":"vite"}');await writeFile(join(root,'node_modules/vite/bin/vite.js'),'');await writeFile(join(root,'vite.config.mjs'),'// foundationRuntime');
 const failed=createConnectedRuntime({root,launchProcess:async()=>{throw new Error('verified boundary unavailable');}});t.after(()=>failed.dispose());await assert.rejects(failed.start(),/verified boundary unavailable/);assert.equal(failed.snapshot().status,'error');assert.equal(failed.snapshot().owned,false);
 let release,called;const entered=new Promise(resolve=>called=resolve),gate=new Promise(resolve=>release=resolve);let child;
 const runtime=createConnectedRuntime({root,launchProcess:async input=>{assert.deepEqual(Object.keys(input).sort(),['args','nodePath','root','token']);called();await gate;child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore','pipe','pipe']});return child;}});t.after(()=>runtime.dispose());const starting=runtime.start();await entered;await runtime.stop();release();await starting;assert.equal(runtime.snapshot().status,'idle');assert.ok(child.exitCode!==null||child.signalCode!==null);assert.throws(()=>process.kill(child.pid,0),e=>e.code==='ESRCH');
});

// Vite 8's maintained native rolldown dependency is larger than 16 MiB.
test('native dependency exception is bounded to regular node_modules .node files at 32 MiB',native,async t=>{
 const {root,service,prepare}=await fixture(t);await mkdir(join(root,'node_modules/native'),{recursive:true});const path=join(root,'node_modules/native/binding.node'),handle=await open(path,'w');await handle.truncate(ALTERNATIVE_WORKSPACE_LIMITS.nativeDependencyBytes);await handle.close();const value=await prepare();assert.equal((await stat(join(value.variants[0].root,'node_modules/native/binding.node'))).size,32*1024*1024);await service.cleanup(value.comparisonId);const larger=await open(path,'a');await larger.truncate(ALTERNATIVE_WORKSPACE_LIMITS.nativeDependencyBytes+1);await larger.close();await assert.rejects(prepare(),e=>e.code==='alternative-file');
});


test('retained readPair returns exact bounded sources and immutable identities after restart',native,async t=>{
 const f=await fixture(t),prepared=await f.prepare();const reopened=createAlternativeWorkspaces({root:f.root,storageRoot:f.storageRoot,projectId:'alternative-test'});t.after(()=>reopened.dispose());
 assert.deepEqual(await reopened.readPair(prepared.comparisonId),{path:'tokens.css',before,after,beforeHash:hash(before),afterHash:hash(after),baselineDigest:prepared.baselineDigest,manifestDigests:{baseline:prepared.variants[0].manifestDigest,alternative:prepared.variants[1].manifestDigest}});
 assert.equal(await readFile(join(f.root,'tokens.css'),'utf8'),before);
});

test('retained readPair rejects changed original, either copied input, and foreign ownership',native,async t=>{
 for(const target of ['original','baseline','alternative','owner']){
  const f=await fixture(t),prepared=await f.prepare();
  if(target==='owner'){const path=join(f.storageRoot,prepared.comparisonId,'owner.json'),owner=JSON.parse(await readFile(path,'utf8'));owner.projectId='foreign';await writeFile(path,JSON.stringify(owner));}
  else await writeFile(join(target==='original'?f.root:prepared.variants.find(item=>item.id===target).root,'package.json'),'{}');
  await assert.rejects(f.service.readPair(prepared.comparisonId),error=>['alternative-source-changed','alternative-copy-changed','alternative-owner'].includes(error.code));
  assert.equal(await readFile(join(f.root,'tokens.css'),'utf8'),before);
 }
});

test('retained readPair rejects redirected targets and honors guards throughout its awaits',native,async t=>{
 const f=await fixture(t),prepared=await f.prepare(),target=join(prepared.variants[1].root,'tokens.css');
 let checks=0;await assert.rejects(f.service.readPair(prepared.comparisonId,{guard:async()=>{if(++checks===80)throw new Error('read retired');}}),/read retired/);assert.equal(checks,80);
 await rm(target);await symlink(join(f.root,'tokens.css'),target);await assert.rejects(f.service.readPair(prepared.comparisonId),error=>error.code==='alternative-symlink');
});

test('retained source decoding is strict UTF-8 and source limit stays 256 KiB',native,async t=>{
 for(const bytes of [Buffer.from([0xff,0xfe]),Buffer.alloc(ALTERNATIVE_WORKSPACE_LIMITS.sourceBytes+1,97)]){
  const f=await fixture(t),prepared=await f.prepare(),path=join(f.storageRoot,prepared.comparisonId,'manifest.json'),manifest=JSON.parse(await readFile(path,'utf8')),variant=manifest.variants[1];
  await writeFile(join(prepared.variants[1].root,'tokens.css'),bytes);const file=variant.files.find(item=>item.path==='tokens.css');variant.bytes+=bytes.length-file.bytes;file.bytes=bytes.length;file.hash=hash(bytes);manifest.afterHash=file.hash;variant.manifestDigest=hash(JSON.stringify(variant.files.map(({path,hash})=>({path,hash}))));await writeFile(path,JSON.stringify(manifest));
  await assert.rejects(f.service.readPair(prepared.comparisonId),error=>['alternative-copy-changed','alternative-file'].includes(error.code));
 }
});

test('only the exact host-owned pending write can be omitted from original validation',native,async t=>{
 const f=await fixture(t),prepared=await f.prepare(),path=`.foundation-${randomUUID()}.tmp`;await writeFile(join(f.root,path),after);const info=await stat(join(f.root,path)),temporary={path,dev:info.dev,ino:info.ino,hash:hash(after)};
 await assert.rejects(f.service.validateOriginal(prepared.comparisonId),error=>error.code==='alternative-source-changed');
 assert.equal((await f.service.readPair(prepared.comparisonId,{originalWriteTemporary:temporary})).after,after);
 for(const changed of [{...temporary,ino:temporary.ino+1},{...temporary,hash:hash(before)},{...temporary,path:'tokens.css'},{...temporary,path:`other/${path}`},{...temporary,extra:true}])await assert.rejects(f.service.readPair(prepared.comparisonId,{originalWriteTemporary:changed}));
 await writeFile(join(f.root,`.foundation-${randomUUID()}.tmp`),after);await assert.rejects(f.service.validateOriginal(prepared.comparisonId,{originalWriteTemporary:temporary}),error=>error.code==='alternative-source-changed');
});

test('pending write content, link replacement and drift during inventory remain guarded',native,async t=>{
 for(const mutation of ['content','link','during']){
  const f=await fixture(t),prepared=await f.prepare(),path=`.foundation-${randomUUID()}.tmp`,absolute=join(f.root,path);await writeFile(absolute,after);const info=await stat(absolute),temporary={path,dev:info.dev,ino:info.ino,hash:hash(after)};
  if(mutation==='content')await writeFile(absolute,'foreign');if(mutation==='link'){await rm(absolute);await symlink(join(f.root,'tokens.css'),absolute);}
  let changed=false;await assert.rejects(f.service.validateOriginal(prepared.comparisonId,{originalWriteTemporary:temporary,guard:async()=>{if(mutation==='during'&&!changed&&new Error().stack.includes('at inventory ')){changed=true;await writeFile(absolute,'foreign');}}}));if(mutation==='during')assert.equal(changed,true);
  assert.equal(await readFile(join(f.root,'tokens.css'),'utf8'),before);
 }
});

test('real atomic save validates the full retained baseline with its exact owned temporary present',native,async t=>{
 const f=await fixture(t),prepared=await f.prepare(),service=createProjectService({root:f.root}),project=await service.open(f.root),file=await service.getFile(project.id,'tokens.css');let final=0;
 await service.save({projectId:project.id,path:file.path,source:after,baseRevision:file.revision},{guard:async context=>{if(context.originalWriteTemporary)final++;assert.equal((await f.service.readPair(prepared.comparisonId,context)).after,after);}});
 assert.equal(final,1);assert.equal(await readFile(join(f.root,'tokens.css'),'utf8'),after);
});


test('readPair pins ownership metadata across its complete source read',native,async t=>{
 const f=await fixture(t),prepared=await f.prepare(),path=join(f.storageRoot,prepared.comparisonId,'owner.json'),initial=await readFile(path,'utf8');let replaced=false;
 await assert.rejects(f.service.readPair(prepared.comparisonId,{guard:async()=>{if(!replaced&&new Error().stack.includes('at validate ')){replaced=true;await writeFile(path,initial+' ');}}}),error=>error.code==='alternative-changed');assert.equal(replaced,true);assert.equal(await readFile(join(f.root,'tokens.css'),'utf8'),before);
});
