import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {CAPTURE_LIMITS} from './runtime-capture-store.mjs';

const MANIFEST_BYTES=1024*1024;
const NOFOLLOW=fs.constants.O_NOFOLLOW;
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const token=value=>typeof value==='string' && value.length<=200 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const fail=(code,message)=>Object.assign(new Error(message),{name:'RuntimeCaptureFileError',code});
const unavailable=()=>fail('capture-files-unavailable','Local capture files could not be accessed safely. Existing files have been left unchanged.');
const busy=()=>fail('capture-files-busy','Local capture storage is busy or its interrupted write requires recovery.');
const capacity=()=>fail('capture-files-capacity','Local capture storage is full. No saved captures were removed.');
const same=(a,b)=>a.dev===b.dev && a.ino===b.ino;
const owned=stat=>typeof process.getuid!=='function' || stat.uid===process.getuid();
const privateRegular=stat=>stat.isFile() && !stat.isSymbolicLink() && stat.nlink===1 && owned(stat) && (stat.mode&0o077)===0;
const missing=error=>error?.code==='ENOENT';

/** root is host private storage, never repository source. No assets are evicted. */
export function createCaptureFileStorage({root,projectId}) {
  if(typeof root!=='string' || !path.isAbsolute(root) || root.includes('\0') || root.split(path.sep).some(part=>part==='.' || part==='..') || !token(projectId) || typeof NOFOLLOW!=='number')throw unavailable();
  const base=path.resolve(root),scope=createHash('sha256').update(projectId).digest('hex');
  const directory=path.join(base,'runtime-captures',scope),assets=path.join(directory,'assets'),manifest=path.join(directory,'captures.json'),lock=path.join(directory,'.capture-write-lock');
  const ancestors=[];
  try {
    let current=path.parse(base).root;
    for(const part of base.slice(current.length).split(path.sep).filter(Boolean)) {
      current=path.join(current,part);
      try{fs.mkdirSync(current,{mode:0o700});}catch(error){if(error?.code!=='EEXIST')throw error;}
      const stat=fs.lstatSync(current);if(!stat.isDirectory() || stat.isSymbolicLink())throw unavailable();ancestors.push([current,stat]);
    }
    for(const value of [path.join(base,'runtime-captures'),directory,assets]) {
      try{fs.mkdirSync(value,{mode:0o700});}catch(error){if(error?.code!=='EEXIST')throw error;}
      const stat=fs.lstatSync(value);if(!stat.isDirectory() || stat.isSymbolicLink() || !owned(stat) || (stat.mode&0o077)!==0)throw unavailable();ancestors.push([value,stat]);
    }
  } catch {throw unavailable();}
  function guard() {
    for(const [value,original] of ancestors){const current=fs.lstatSync(value);if(!current.isDirectory() || current.isSymbolicLink() || !same(current,original))throw unavailable();}
    for(const value of [path.join(base,'runtime-captures'),directory,assets]){const current=fs.lstatSync(value);if(!owned(current) || (current.mode&0o077)!==0)throw unavailable();}
  }
  function readBounded(value,limit,{optional=false}={}) {
    guard();let fd;
    try {
      fd=fs.openSync(value,fs.constants.O_RDONLY|NOFOLLOW);
      const before=fs.fstatSync(fd);if(!privateRegular(before) || before.size>limit)throw unavailable();
      const buffer=Buffer.alloc(before.size+1);let length=0;
      while(length<buffer.length){const count=fs.readSync(fd,buffer,length,buffer.length-length,null);if(!count)break;length+=count;}
      const after=fs.fstatSync(fd);if(length!==before.size || !same(before,after) || before.size!==after.size || before.mtimeMs!==after.mtimeMs || before.ctimeMs!==after.ctimeMs)throw unavailable();
      guard();const named=fs.lstatSync(value);if(!privateRegular(named) || !same(after,named))throw unavailable();return buffer.subarray(0,length);
    } catch(error) {if(optional && missing(error))return undefined;throw unavailable();}
    finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  function read() {
    try{const bytes=readBounded(manifest,MANIFEST_BYTES,{optional:true});return bytes===undefined ? undefined : JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{throw unavailable();}
  }
  function usage() {
    guard();let total=0,count=0;
    for(const folder of [directory,assets])for(const entry of fs.readdirSync(folder,{withFileTypes:true})) {
      if(folder===directory && entry.name==='assets')continue;
      if(++count>1024)throw capacity();const stat=fs.lstatSync(path.join(folder,entry.name));if(!privateRegular(stat))throw unavailable();total+=stat.size;if(total>CAPTURE_LIMITS.projectBytes)throw capacity();
    }
    return total;
  }
  function syncDirectory(value){const fd=fs.openSync(value,fs.constants.O_RDONLY|NOFOLLOW);try{if(!fs.fstatSync(fd).isDirectory())throw unavailable();fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  function acquire() {
    guard();let recovered=false;
    for(;;){
      let fd;
      try {
        fd=fs.openSync(lock,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|NOFOLLOW,0o600);
        const nonce=randomUUID(),record=Buffer.from(JSON.stringify({schemaVersion:1,pid:process.pid,nonce}));fs.writeFileSync(fd,record);fs.fsyncSync(fd);const stat=fs.fstatSync(fd);fs.closeSync(fd);fd=undefined;
        return ()=>{guard();const current=fs.lstatSync(lock);if(!privateRegular(current) || !same(stat,current))throw unavailable();fs.unlinkSync(lock);};
      } catch(error) {
        if(fd!==undefined)fs.closeSync(fd);
        if(error?.code!=='EEXIST' || recovered)throw busy();
        const stat=fs.lstatSync(lock),bytes=readBounded(lock,512),record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        if(!privateRegular(stat) || record?.schemaVersion!==1 || !Number.isInteger(record.pid) || record.pid<=0 || !uuid(record.nonce))throw busy();
        let dead=false;try{process.kill(record.pid,0);}catch(error){if(error?.code==='ESRCH')dead=true;}
        if(!dead)throw busy();guard();const current=fs.lstatSync(lock);if(!same(stat,current) || !privateRegular(current))throw busy();fs.unlinkSync(lock);recovered=true;
      }
    }
  }
  async function temporary(folder,bytes,prefix) {
    guard();const name=path.join(folder,`.${prefix}-${randomUUID()}.tmp`);let handle;
    try {
      handle=await fsp.open(name,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|NOFOLLOW,0o600);
      const stat=await handle.stat();if(!privateRegular(stat))throw unavailable();await handle.writeFile(bytes);await handle.sync();await handle.close();handle=undefined;
      guard();const current=fs.lstatSync(name);if(!privateRegular(current) || !same(stat,current) || current.size!==bytes.length)throw unavailable();return {name,stat:current};
    } catch(error){if(handle)await handle.close().catch(()=>{});throw error;}
  }
  function cleanupTemp(temp){if(!temp)return;guard();try{const current=fs.lstatSync(temp.name);if(current.isFile() && !current.isSymbolicLink() && owned(current) && (current.mode&0o077)===0 && same(current,temp.stat))fs.unlinkSync(temp.name);}catch(error){if(!missing(error))throw error;}}
  async function withLock(operation) {
    let release;
    try{release=acquire();return await operation();}
    catch(error){if(error?.name==='RuntimeCaptureFileError')throw error;throw unavailable();}
    finally{if(release)try{release();}catch{throw unavailable();}}
  }
  async function write(value) {
    let bytes,nextRevision;
    try{if(!value || value.schemaVersion!==1 || value.projectId!==projectId || !Number.isSafeInteger(value.revision) || value.revision<1 || !Array.isArray(value.captures))throw unavailable();nextRevision=value.revision;bytes=Buffer.from(JSON.stringify(value));if(bytes.length>MANIFEST_BYTES)throw unavailable();}
    catch{throw unavailable();}
    return withLock(async()=>{
      const previous=read();if(previous!==undefined && (previous?.projectId!==projectId || previous.schemaVersion!==1 || !Number.isSafeInteger(previous.revision) || previous.revision<0))throw unavailable();
      if(nextRevision!==(previous?.revision??0)+1)throw fail('capture-files-stale','Capture storage changed. Reload its saved state before retrying.');
      if(usage()+bytes.length>CAPTURE_LIMITS.projectBytes)throw capacity();let temp;
      try{temp=await temporary(directory,bytes,'manifest');guard();if(previous!==undefined)readBounded(manifest,MANIFEST_BYTES);else{try{fs.lstatSync(manifest);throw unavailable();}catch(error){if(!missing(error))throw error;}}
        fs.renameSync(temp.name,manifest);temp=undefined;syncDirectory(directory);
      }finally{cleanupTemp(temp);}
    });
  }
  async function writeAsset(assetId,input) {
    if(!uuid(assetId) || !(input instanceof Uint8Array) || input.byteLength<1 || input.byteLength>CAPTURE_LIMITS.imageBytes)throw unavailable();
    const bytes=Buffer.from(input),target=path.join(assets,`${assetId}.png`);
    return withLock(async()=>{
      if(usage()+bytes.length>CAPTURE_LIMITS.projectBytes)throw capacity();let temp;
      try{temp=await temporary(assets,bytes,'asset');guard();fs.linkSync(temp.name,target);cleanupTemp(temp);temp=undefined;syncDirectory(assets);}
      finally{cleanupTemp(temp);}
    });
  }
  async function readAsset(assetId) {
    if(!uuid(assetId))throw unavailable();try{return Buffer.from(readBounded(path.join(assets,`${assetId}.png`),CAPTURE_LIMITS.imageBytes));}catch{throw unavailable();}
  }
  function assetPath(assetId){if(!uuid(assetId))throw unavailable();try{guard();const target=path.join(assets,`${assetId}.png`),stat=fs.lstatSync(target);if(!privateRegular(stat) || stat.size>CAPTURE_LIMITS.imageBytes)throw unavailable();return target;}catch{throw unavailable();}}
  return Object.freeze({read,write,writeAsset,readAsset,assetRoot:assets,assetPath,availableBytes:()=>CAPTURE_LIMITS.projectBytes-usage()});
}
