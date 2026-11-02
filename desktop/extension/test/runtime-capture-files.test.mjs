import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createCaptureFileStorage} from '../src/runtime-capture-files.mjs';
import {CAPTURE_LIMITS} from '../src/runtime-capture-store.mjs';

const projectId='orbit:private';
function fixture(t){const root=fs.mkdtempSync('/private/tmp/foundation-capture-files-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const storage=createCaptureFileStorage({root,projectId});return {root,storage,directory:path.dirname(storage.assetRoot),manifest:path.join(path.dirname(storage.assetRoot),'captures.json')};}
const manifest=revision=>({schemaVersion:1,projectId,revision,captures:[]});
const safeFailure=error=>error.name==='RuntimeCaptureFileError' && !error.message.includes('/private/') && !error.message.includes('secret');
const privateWrite=(target,data)=>fs.writeFileSync(target,data,{mode:0o600});

test('private project-scoped storage commits create-only bytes and atomic revisioned manifests',async t=>{
 const {root,storage,directory,manifest:target}=fixture(t),id=randomUUID();assert.equal(storage.read(),undefined);
 assert.equal(fs.statSync(storage.assetRoot).mode&0o777,0o700);assert.equal(fs.statSync(directory).mode&0o777,0o700);assert.ok(storage.assetRoot.startsWith(path.join(root,'runtime-captures')));
 await storage.writeAsset(id,Buffer.from('opaque PNG bytes supplied by validated store'));assert.equal(fs.statSync(storage.assetPath(id)).mode&0o777,0o600);assert.deepEqual(await storage.readAsset(id),Buffer.from('opaque PNG bytes supplied by validated store'));
 await storage.write(manifest(1));assert.deepEqual(storage.read(),manifest(1));assert.equal(fs.statSync(target).mode&0o777,0o600);await storage.write(manifest(2));assert.equal(storage.read().revision,2);
 assert.deepEqual(fs.readdirSync(directory).sort(),['assets','captures.json']);assert.deepEqual(fs.readdirSync(storage.assetRoot),[`${id}.png`]);
 const another=createCaptureFileStorage({root,projectId:'other-project'});assert.notEqual(another.assetRoot,storage.assetRoot);assert.equal(another.read(),undefined);await assert.rejects(another.readAsset(id),safeFailure);
});

test('existing assets and newer manifests cannot be overwritten',async t=>{
 const {root,storage}=fixture(t),id=randomUUID();await storage.writeAsset(id,Buffer.from('original'));
 await assert.rejects(storage.writeAsset(id,Buffer.from('replacement')),safeFailure);assert.equal((await storage.readAsset(id)).toString(),'original');assert.deepEqual(fs.readdirSync(storage.assetRoot),[`${id}.png`]);
 const peer=createCaptureFileStorage({root,projectId});await storage.write(manifest(1));await assert.rejects(peer.write(manifest(1)),{code:'capture-files-stale'});assert.deepEqual(storage.read(),manifest(1));await assert.rejects(storage.write({...manifest(2),projectId:'foreign'}),safeFailure);
});

test('asset traversal and foreign identifiers fail before path access',async t=>{
 const {storage}=fixture(t);for(const id of ['../secret','/private/secret','capture.png','','a'.repeat(300)]){await assert.rejects(storage.writeAsset(id,Buffer.from('data')),safeFailure);await assert.rejects(storage.readAsset(id),safeFailure);assert.throws(()=>storage.assetPath(id),safeFailure);}
 assert.throws(()=>createCaptureFileStorage({root:'/private/tmp/../secret',projectId}),safeFailure);assert.throws(()=>createCaptureFileStorage({root:'relative',projectId}),safeFailure);
});

test('symlinked roots, manifests and assets cannot escape capture storage',async t=>{
 const {root,storage,manifest:target}=fixture(t),outside=path.join(root,'outside'),linkRoot=path.join(root,'link-root');fs.mkdirSync(outside,{mode:0o700});fs.symlinkSync(outside,linkRoot);
 assert.throws(()=>createCaptureFileStorage({root:linkRoot,projectId}),safeFailure);
 const secret=path.join(outside,'secret');privateWrite(secret,'secret remains unchanged');fs.symlinkSync(secret,target);assert.throws(()=>storage.read(),safeFailure);await assert.rejects(storage.write(manifest(1)),safeFailure);assert.equal(fs.readFileSync(secret,'utf8'),'secret remains unchanged');fs.unlinkSync(target);
 const id=randomUUID();fs.symlinkSync(secret,path.join(storage.assetRoot,`${id}.png`));await assert.rejects(storage.readAsset(id),safeFailure);assert.throws(()=>storage.assetPath(id),safeFailure);await assert.rejects(storage.writeAsset(randomUUID(),Buffer.from('new')),safeFailure);
});

test('replaced directory identities fail closed after initialization',async t=>{
 const {storage}=fixture(t),original=storage.assetRoot;fs.renameSync(original,`${original}-original`);fs.mkdirSync(original,{mode:0o700});
 assert.throws(()=>storage.read(),safeFailure);await assert.rejects(storage.writeAsset(randomUUID(),Buffer.from('new')),safeFailure);await assert.rejects(storage.write(manifest(1)),safeFailure);
});

test('hardlinks and public file permissions cannot become exposed assets',async t=>{
 const {root,storage}=fixture(t),id=randomUUID(),source=path.join(root,'source');privateWrite(source,'private');fs.linkSync(source,path.join(storage.assetRoot,`${id}.png`));await assert.rejects(storage.readAsset(id),safeFailure);assert.throws(()=>storage.assetPath(id),safeFailure);fs.unlinkSync(path.join(storage.assetRoot,`${id}.png`));
 const target=path.join(storage.assetRoot,`${id}.png`);privateWrite(target,'private');fs.chmodSync(target,0o644);await assert.rejects(storage.readAsset(id),safeFailure);assert.throws(()=>storage.assetPath(id),safeFailure);
});

test('manifest reads and writes stay bounded and reject unsafe text',async t=>{
 const {storage,manifest:target}=fixture(t);privateWrite(target,'{}');fs.truncateSync(target,1024*1024+1);assert.throws(()=>storage.read(),safeFailure);
 privateWrite(target,Buffer.from([0xff,0xfe]));assert.throws(()=>storage.read(),safeFailure);fs.unlinkSync(target);
 await assert.rejects(storage.write({...manifest(1),extra:'x'.repeat(1024*1024)}),safeFailure);assert.equal(fs.existsSync(target),false);
});

test('the physical quota counts unreferenced assets and abandoned temporary files without eviction',async t=>{
 const {storage}=fixture(t);const names=[];
 for(let n=0;n<8;n++){const name=path.join(storage.assetRoot,n===0 ? '.asset-abandoned.tmp' : `${randomUUID()}.png`);privateWrite(name,'');fs.truncateSync(name,CAPTURE_LIMITS.imageBytes);names.push(name);}
 await assert.rejects(storage.writeAsset(randomUUID(),Buffer.from('one more byte')),{code:'capture-files-capacity'});await assert.rejects(storage.write(manifest(1)),{code:'capture-files-capacity'});
 assert.equal(names.every(name=>fs.statSync(name).size===CAPTURE_LIMITS.imageBytes),true);assert.equal(fs.readdirSync(storage.assetRoot).length,8);
});

test('asset reads reject oversized files before allocating image contents',async t=>{
 const {storage}=fixture(t),id=randomUUID(),target=path.join(storage.assetRoot,`${id}.png`);privateWrite(target,'');fs.truncateSync(target,CAPTURE_LIMITS.imageBytes+1);
 await assert.rejects(storage.readAsset(id),safeFailure);assert.throws(()=>storage.assetPath(id),safeFailure);
});

test('concurrent adapters share a write lock and interrupted dead-process locks recover safely',async t=>{
 const {root,storage,directory}=fixture(t),peer=createCaptureFileStorage({root,projectId}),first=randomUUID(),second=randomUUID();
 const one=storage.writeAsset(first,Buffer.alloc(1024));await assert.rejects(peer.writeAsset(second,Buffer.alloc(1024)),{code:'capture-files-busy'});await one;await peer.writeAsset(second,Buffer.alloc(1024));
 const dead=spawnSync(process.execPath,['-e',''],{stdio:'ignore'});assert.equal(dead.status,0);const lock=path.join(directory,'.capture-write-lock');privateWrite(lock,JSON.stringify({schemaVersion:1,pid:dead.pid,nonce:randomUUID()}));
 await storage.write(manifest(1));assert.equal(fs.existsSync(lock),false);assert.equal(storage.read().revision,1);
 privateWrite(lock,JSON.stringify({schemaVersion:1,pid:process.pid,nonce:randomUUID()}));await assert.rejects(storage.write(manifest(2)),{code:'capture-files-busy'});assert.equal(storage.read().revision,1);
});


test('availableBytes is read-only and counts committed, orphan and temporary files',async t=>{
 const {storage,directory,manifest:target}=fixture(t);
 assert.equal(storage.availableBytes(),CAPTURE_LIMITS.projectBytes);
 await storage.write(manifest(1));
 privateWrite(path.join(storage.assetRoot,'.asset-abandoned.tmp'),Buffer.alloc(321));
 privateWrite(path.join(directory,'.manifest-abandoned.tmp'),Buffer.alloc(123));
 const id=randomUUID();await storage.writeAsset(id,Buffer.alloc(456));
 const before=[directory,storage.assetRoot].map(p=>({path:p,names:fs.readdirSync(p).sort(),mtime:fs.statSync(p).mtimeMs}));
 assert.equal(storage.availableBytes(),CAPTURE_LIMITS.projectBytes-fs.statSync(target).size-900);
 assert.deepEqual([directory,storage.assetRoot].map(p=>({path:p,names:fs.readdirSync(p).sort(),mtime:fs.statSync(p).mtimeMs})),before);
 fs.chmodSync(path.join(storage.assetRoot,`${id}.png`),0o644);assert.throws(()=>storage.availableBytes(),safeFailure);
});
