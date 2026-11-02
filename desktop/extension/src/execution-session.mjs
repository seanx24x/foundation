import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {lstat,mkdir,open,opendir,readFile,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve,dirname,sep} from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {validateChangeSet,changeGroupDigest as canonicalGroupDigest} from '../../../server/project/proposals.mjs';

const MAX_FILES=32768, MAX_BYTES=512*1024*1024, MAX_FILE=16*1024*1024, MAX_OUTPUT=64*1024, MAX_HISTORY=12, MAX_RECORD_BYTES=2*1024*1024;
const MAX_TESTS=64, TIMEOUT=60000;
const STATES=new Set(['preparing','ready','running','passed','failed','cancelled','interrupted','unavailable']);
const TERMINAL=new Set(['passed','failed','cancelled','interrupted','unavailable']);
const TASKS=new Set(['node:test','typescript:check']);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(x);
const text=(x,n)=>typeof x==='string'&&Buffer.byteLength(x,'utf8')<=n&&!x.includes('\0')&&Buffer.from(x,'utf8').toString('utf8')===x;
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const hash=x=>createHash('sha256').update(x).digest('hex');
const clone=x=>structuredClone(x);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).every(k=>keys.includes(k));
const inside=(base,p)=>{const rel=relative(base,p);return rel===''||!rel.startsWith(`..${sep}`)&&rel!=='..'&&!isAbsolute(rel);};
const failure=(code,message)=>Object.assign(new Error(message),{name:'ExecutionError',code});
const now=()=>new Date().toISOString();
const safeMessage=e=>e?.name==='ExecutionError'?e.message:'The isolated check could not finish. Its source project was not changed.';
const storageMessage='The isolated-check record could not be saved. Retry local storage before continuing.';
const unavailableMessage='The isolated-check history could not be read safely. Its files have been left untouched.';

export function changeGroupDigest(input){return canonicalGroupDigest(input);}

function planBinding(value){
 if(value===undefined)return undefined;
 if(!exact(value,['planId','stepId','attemptId'])||Object.keys(value).length!==3||!uuid(value.planId)||!uuid(value.stepId)||!uuid(value.attemptId))throw failure('execution-plan','Choose an exact saved check-plan attempt.');
 return {planId:value.planId,stepId:value.stepId,attemptId:value.attemptId};
}
function recordValue(v,projectId,schemaVersion=2){
 const keys=['id','projectId','groupId','groupRevision','groupDigest','revision','status','createdAt','updatedAt','files','bytes','snapshotRevision','tasks','taskId','startedAt','finishedAt','exitCode','signal','output','outputTruncated','reason','plan'];
 if(!exact(v,keys)||!uuid(v.id)||v.projectId!==projectId||!uuid(v.groupId)||!Number.isSafeInteger(v.groupRevision)||v.groupRevision<0||!/^([a-f0-9]{64})$/.test(v.groupDigest)||!Number.isSafeInteger(v.revision)||v.revision<0||!STATES.has(v.status)||!date(v.createdAt)||!date(v.updatedAt)||v.updatedAt<v.createdAt||!Array.isArray(v.tasks)||v.tasks.length>2||!text(v.output,MAX_OUTPUT)||typeof v.outputTruncated!=='boolean')throw Error('Invalid execution');
 if(schemaVersion===1&&Object.hasOwn(v,'plan'))throw Error('Unexpected plan binding');
 const out=clone(v),ids=new Set();if(v.plan!==undefined)out.plan=planBinding(v.plan);
 for(const t of out.tasks){if(!exact(t,['id','label','command'])||!TASKS.has(t.id)||ids.has(t.id)||!text(t.label,160)||!t.label||!text(t.command,32768)||!t.command)throw Error('Invalid task');ids.add(t.id);}
 for(const key of ['files','bytes'])if(v[key]!==undefined&&(!Number.isSafeInteger(v[key])||v[key]<0||v[key]>(key==='files'?MAX_FILES:MAX_BYTES)))throw Error('Invalid size');
 if(v.snapshotRevision!==undefined&&!/^[a-f0-9]{64}$/.test(v.snapshotRevision))throw Error('Invalid snapshot');
 if(v.taskId!==undefined&&!ids.has(v.taskId))throw Error('Invalid task identity');
 for(const key of ['startedAt','finishedAt'])if(v[key]!==undefined&&!date(v[key]))throw Error('Invalid timestamp');
 if(v.exitCode!==undefined&&v.exitCode!==null&&(!Number.isSafeInteger(v.exitCode)||v.exitCode<0||v.exitCode>255))throw Error('Invalid exit');
 if(v.signal!==undefined&&v.signal!==null&&!/^SIG[A-Z0-9]{1,16}$/.test(v.signal))throw Error('Invalid signal');
 if(v.reason!==undefined&&!text(v.reason,1200))throw Error('Invalid reason');
 if(v.startedAt&&v.startedAt<v.createdAt||v.finishedAt&&v.finishedAt<(v.startedAt||v.createdAt)||v.updatedAt<(v.finishedAt||v.startedAt||v.createdAt))throw Error('Unordered timestamps');
 const prepared=Number.isSafeInteger(v.files)&&v.files>=2&&Number.isSafeInteger(v.bytes)&&v.bytes>=0&&typeof v.snapshotRevision==='string'&&v.tasks.length>0;
 if(v.status==='ready'&&(!prepared||v.taskId!==undefined||v.startedAt!==undefined||v.finishedAt!==undefined||v.exitCode!==undefined||v.signal!==undefined))throw Error('Invalid ready lifecycle');
 if(v.status==='running'&&(!prepared||!v.taskId||!v.startedAt||v.finishedAt!==undefined||v.exitCode!==undefined||v.signal!==undefined))throw Error('Invalid running lifecycle');
 if(v.status==='passed'&&(!prepared||!v.taskId||!v.startedAt||!v.finishedAt||v.exitCode!==0||v.signal!==null))throw Error('Invalid passing evidence');
 if(TERMINAL.has(v.status)&&!v.finishedAt)throw Error('Missing completion time');
 if(v.exitCode!==undefined&&(!v.taskId||!v.startedAt||!v.finishedAt))throw Error('Missing execution evidence');
 return out;
}
const skipped=(path,directory)=>{
 const parts=path.split('/'),name=parts.at(-1),dependency=parts.includes('node_modules');
 if(['.git','.hg','.svn','.ssh','.aws','.gnupg'].includes(name))return true;
 if(/^\.env(?:\.|$)/i.test(name)||['.npmrc','.yarnrc','.yarnrc.yml','.pypirc','.netrc','.gitconfig'].includes(name)||/\.(?:pem|key|p12|pfx|keystore)$/i.test(name))return true;
 if(directory&&dependency&&['.bin','.cache'].includes(name))return true;
 if(directory&&!dependency&&['node_modules_cache','.cache','.next','.nuxt','.turbo','coverage','dist','build','.foundation','.foundation-execution-home','.foundation-execution-tmp'].includes(name))return true;
 return false;
};
const localPath=p=>typeof p==='string'&&p.length>0&&p.length<=2048&&!isAbsolute(p)&&!p.includes('\\')&&!/[\x00-\x1f\x7f]/.test(p)&&p.split('/').every(x=>x&&x!=='.'&&x!=='..');

/** Runs fixed local checks against a copied source snapshot. Reads are not a confidentiality sandbox. */
export function createExecutionSession({storageRoot,projectId,root:requestedRoot,nodePath=process.execPath,isCurrent=()=>true,onChange=()=>{}}={}){
 if(!isAbsolute(storageRoot||'')||!isAbsolute(requestedRoot||'')||!isAbsolute(nodePath||'')||!token(projectId)||inside(resolve(requestedRoot),resolve(storageRoot)))throw failure('invalid-execution-storage','Choose separate local storage outside the source project.');
 const filename=join(storageRoot,'execution.json'),runsRoot=join(storageRoot,'runs');
 let data={schemaVersion:2,projectId,current:null,history:[]},loaded=false,loadPromise,storage={status:'unavailable',message:'Load isolated-check history before continuing.'};
 let busy=false,error,disposed=false,generation=0,child=null,pending=null,prepared=null,root,runtime,capabilityPromise;
 let capabilities={supported:false,reason:'Checking the local macOS execution boundary.',network:'unavailable',filesystem:'isolated-copy'};
 const notify=()=>{try{onChange(snapshot());}catch{}};
 const assessment=()=>({canPrepare:loaded&&storage.status==='saved'&&capabilities.supported&&!busy&&data.history.length<MAX_HISTORY,canRun:storage.status==='saved'&&capabilities.supported&&!busy&&data.current?.status==='ready'&&Boolean(prepared),canStop:busy&&['preparing','running'].includes(data.current?.status),...(storage.status!=='saved'?{reason:storage.message}:!capabilities.supported?{reason:capabilities.reason}:data.history.length>=MAX_HISTORY&&!busy?{reason:'Local execution history is full. Existing records are preserved.'}:data.current?.reason?{reason:data.current.reason}:{})});
 function snapshot(){return {current:clone(data.current),history:clone(data.history),busy,storage:{...storage},capabilities:{...capabilities},assessment:assessment(),...(error?{error}:{})};}
 const own=()=>{if(disposed||!isCurrent())throw failure('execution-retired','This isolated check no longer belongs to the active project.');};
 const available=()=>{own();if(!loaded||storage.status==='unavailable')throw failure('execution-storage-unavailable',unavailableMessage);if(storage.status!=='saved')throw failure('execution-storage',storageMessage);};
 const runDir=id=>{if(!uuid(id))throw failure('invalid-execution-id','Choose a saved isolated check.');return join(runsRoot,id);};
 const transition=(status,reason)=>{data.current.status=status;data.current.revision++;data.current.updatedAt=now();if(reason)data.current.reason=reason;else delete data.current.reason;notify();};
 async function safeDirectory(path,create=false){
  if(create)await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw failure('unsafe-execution-storage','The isolated-check storage is not a regular directory.');
  return info;
 }
 async function persist(){
  if(data.current)recordValue(data.current,projectId);for(const record of data.history)recordValue(record,projectId);const body=JSON.stringify(data);if(Buffer.byteLength(body)>MAX_RECORD_BYTES)throw failure('execution-capacity','Local execution history is full. Existing records are preserved.');
  storage={status:'saving'};notify();const temporary=join(storageRoot,`.execution-${randomUUID()}.tmp`);
  try{
   await safeDirectory(storageRoot,true);const existing=await lstat(filename).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(existing&&(!existing.isFile()||existing.isSymbolicLink()))throw Error('Unsafe record');
   const h=await open(temporary,'wx',0o600);try{await h.writeFile(body,'utf8');await h.sync();}finally{await h.close();}await rename(temporary,filename);
   const d=await open(storageRoot,constants.O_RDONLY);try{await d.sync();}finally{await d.close();}storage={status:'saved'};notify();
  }catch{storage={status:'error',message:storageMessage};notify();throw failure('execution-storage',storageMessage);}finally{await rm(temporary,{force:true}).catch(()=>{});}
 }
 async function read(){
  try{
   const info=await lstat(storageRoot).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(info&&(!info.isDirectory()||info.isSymbolicLink()))throw Error('Unsafe root');
   const file=info?await lstat(filename).catch(e=>{if(e.code==='ENOENT')return null;throw e;}):null;
   if(file){
    if(!file.isFile()||file.isSymbolicLink()||file.size>MAX_RECORD_BYTES)throw Error('Unsafe file');
    const h=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);let body;try{body=await h.readFile();}finally{await h.close();}
    if(body.length>MAX_RECORD_BYTES)throw Error('Large record');const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
    if(!exact(value,['schemaVersion','projectId','current','history'])||![1,2].includes(value.schemaVersion)||value.projectId!==projectId||!Array.isArray(value.history)||value.history.length>MAX_HISTORY)throw Error('Invalid envelope');
    const current=value.current===null?null:recordValue(value.current,projectId,value.schemaVersion),history=value.history.map(v=>recordValue(v,projectId,value.schemaVersion));
    const ids=[...history.map(v=>v.id),...(current?[current.id]:[])];if(new Set(ids).size!==ids.length||history.some(v=>!TERMINAL.has(v.status)))throw Error('Invalid history');
    const bindings=[...history,...(current?[current]:[])].filter(record=>record.plan).map(record=>JSON.stringify(record.plan));if(new Set(bindings).size!==bindings.length)throw Error('Duplicate plan attempt');
    data={schemaVersion:2,projectId,current,history};
   }
   loaded=true;storage={status:'saved'};
   if(data.current&&['preparing','ready','running'].includes(data.current.status)){transition('interrupted','Foundation reopened. Prepare a fresh copy to run again; no process was resumed.');data.current.finishedAt=data.current.updatedAt;await persist();}
  }catch(e){if(e?.code==='execution-storage')throw e;loaded=false;storage={status:'unavailable',message:unavailableMessage};throw failure('execution-storage-unavailable',unavailableMessage);}
 }
 async function resolveRoots(){
  root=await realpath(requestedRoot);runtime=await realpath(nodePath);
  if(inside(root,await realpath(storageRoot).catch(()=>resolve(storageRoot))))throw failure('invalid-execution-storage','Execution storage must remain outside the source project.');
  const info=await lstat(root),exec=await lstat(runtime);if(!info.isDirectory()||!exec.isFile())throw failure('runtime-unavailable','The source folder or bundled Node runtime is unavailable.');
 }
 const profile=work=>`(version 1)\n(allow default)\n(deny network*)\n(deny file-write* (require-not (require-any (subpath ${JSON.stringify(work)}) (literal "/dev/null"))))\n(deny process-exec (require-not (literal ${JSON.stringify(runtime)})))\n(deny process-fork)\n(deny mach-lookup)\n(deny appleevent-send)\n(deny signal (require-not (target self)))\n`;
 const environment=work=>({PATH:'/usr/bin:/bin',HOME:join(work,'.foundation-execution-home'),TMPDIR:join(work,'.foundation-execution-tmp'),LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',CI:'1',NO_COLOR:'1',ELECTRON_RUN_AS_NODE:'1'});
 async function probe(){
  if(capabilityPromise)return capabilityPromise;
  capabilityPromise=(async()=>{
   if(process.platform!=='darwin'){capabilities={supported:false,reason:'Isolated checks currently require the verified macOS process boundary.',network:'unavailable',filesystem:'isolated-copy'};return;}
   let temporary;
   try{
    await resolveRoots();const binary=await lstat('/usr/bin/sandbox-exec');if(!binary.isFile())throw Error('Missing sandbox');
    await safeDirectory(storageRoot,true);temporary=join(storageRoot,`.probe-${randomUUID()}`);await mkdir(temporary,{mode:0o700});
    const code='process.stdout.write("foundation-isolation-ready")';
    await new Promise((resolve,reject)=>{
     const c=spawn('/usr/bin/sandbox-exec',['-p',profile(temporary),runtime,'--test-isolation=none','-e',code],{cwd:temporary,env:environment(temporary),stdio:['ignore','pipe','pipe']});let output='';
     const timer=setTimeout(()=>{c.kill('SIGKILL');reject(Error('Probe timeout'));},5000);
     c.stdout.on('data',chunk=>{if(output.length<128)output+=chunk.toString();});c.stderr.on('data',()=>{});
     c.once('error',e=>{clearTimeout(timer);reject(e);});c.once('close',status=>{clearTimeout(timer);status===0&&output==='foundation-isolation-ready'?resolve():reject(Error('Probe failed'));});
    });
    capabilities={supported:true,network:'blocked',filesystem:'isolated-copy'};
   }catch{capabilities={supported:false,reason:'The local macOS execution boundary or bundled Node runtime is unavailable. No unrestricted fallback is used.',network:'unavailable',filesystem:'isolated-copy'};}
   finally{if(temporary)await rm(temporary,{recursive:true,force:true}).catch(()=>{});notify();}
  })();return capabilityPromise;
 }
 async function checkedRead(base,path){
  if(!localPath(path))throw failure('unsafe-source','The copied project contains an unsupported source path.');
  let current=base;
  for(const part of path.split('/')){current=join(current,part);const info=await lstat(current);if(info.isSymbolicLink())throw failure('source-symlink','Symbolic links are not copied into isolated checks. Use regular local dependencies.');}
  const info=await lstat(current);if(!info.isFile()||info.size>MAX_FILE)throw failure('source-limit','Isolated checks support regular files up to 16 MiB each.');
  const h=await open(current,constants.O_RDONLY|constants.O_NOFOLLOW);let body;
  try{const held=await h.stat();if(held.dev!==info.dev||held.ino!==info.ino)throw failure('source-changed','A saved file changed while preparing its copy.');body=await h.readFile();}finally{await h.close();}
  if(body.length>MAX_FILE||!inside(base,await realpath(current)))throw failure('unsafe-source','A saved source changed while it was being copied.');return {body,mode:info.mode&0o777};
 }
 async function sourceManifest(base,guard,copyTo){
  const files=[];let bytes=0,entriesSeen=0;
  async function walk(relativeDir=''){
   await guard();const dir=join(base,relativeDir);const info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())throw failure('source-symlink','Symbolic links are not copied into isolated checks.');
   const entries=[],directory=await opendir(dir);for await(const entry of directory){if(++entriesSeen>MAX_FILES)throw failure('source-limit','This project exceeds the 32,768-entry isolated-check limit.');entries.push(entry);}entries.sort((a,b)=>a.name.localeCompare(b.name));
   for(const entry of entries){
    const path=relativeDir?`${relativeDir}/${entry.name}`:entry.name;
    if(skipped(path,entry.isDirectory()))continue;
    if(entry.isSymbolicLink())throw failure('source-symlink','Symbolic links are not copied into isolated checks. Use regular local dependencies.');
    if(entry.isDirectory()){if(copyTo)await mkdir(join(copyTo,path),{mode:0o700});await walk(path);continue;}
    if(!entry.isFile())throw failure('unsafe-source','A special file cannot enter the isolated copy.');
    if(files.length>=MAX_FILES)throw failure('source-limit','This project exceeds the 32,768-file isolated-check limit.');
    const {body,mode}=await checkedRead(base,path);bytes+=body.length;if(bytes>MAX_BYTES)throw failure('source-limit','This project exceeds the 512 MiB isolated-check limit.');
    if(copyTo)await writeFile(join(copyTo,path),body,{flag:'wx',mode});files.push({path,hash:hash(body),bytes:body.length});
    if(files.length%32===0)await guard();
   }
  }
  await walk();await guard();return {files,bytes,digest:hash(JSON.stringify(files.map(({path,hash})=>({path,hash}))))};
 }
 async function sameManifest(expected,guard){const next=await sourceManifest(root,guard);if(next.digest!==expected.digest)throw failure('source-changed','Saved project files changed after preparation. Prepare a fresh isolated copy.');}
 async function removeOwned(id){
  await safeDirectory(storageRoot);const runs=await lstat(runsRoot).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!runs)return;if(!runs.isDirectory()||runs.isSymbolicLink())throw failure('unsafe-execution-storage','The owned run directory is unsafe.');
  const dir=runDir(id),info=await lstat(dir).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!info)return;if(!info.isDirectory()||info.isSymbolicLink())throw failure('unsafe-execution-storage','The owned run directory is unsafe.');
  const marker=await lstat(join(dir,'owner.json'));if(!marker.isFile()||marker.isSymbolicLink()||marker.size>1000)throw failure('unsafe-execution-storage','The run ownership record is unavailable.');
  const owner=JSON.parse(await readFile(join(dir,'owner.json'),'utf8'));if(!exact(owner,['id','projectId'])||owner.id!==id||owner.projectId!==projectId)throw failure('unsafe-execution-storage','The run ownership record does not match this project.');
  await rm(dir,{recursive:true,force:false});
 }
 const recipes=manifest=>{
  const paths=manifest.files.map(f=>f.path),tests=paths.filter(p=>!p.split('/').includes('node_modules')&&/(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?js$/.test(p)),tasks=[];
  const selected=tests.map(p=>`./${p}`),command=`node --test --test-isolation=none --test-concurrency=1 ${selected.map(p=>JSON.stringify(p)).join(' ')}`;
  if(tests.length&&tests.length<=MAX_TESTS&&Buffer.byteLength(command)<=32768)tasks.push({id:'node:test',label:'Node tests',command,args:['--test','--test-isolation=none','--test-concurrency=1',...selected]});
  if(paths.includes('tsconfig.json')&&paths.includes('node_modules/typescript/lib/tsc.js'))tasks.push({id:'typescript:check',label:'TypeScript check',command:'node node_modules/typescript/lib/tsc.js --noEmit --pretty false',args:['node_modules/typescript/lib/tsc.js','--noEmit','--pretty','false']});
  return tasks;
 };
 async function perform(work){if(busy)throw failure('execution-active','Wait for the current isolated-check operation to finish.');busy=true;error=undefined;notify();
  const op=(async()=>{try{await work();}catch(e){error=safeMessage(e);throw e;}finally{busy=false;notify();}return snapshot();})();pending=op;try{return await op;}finally{if(pending===op)pending=null;}}
 async function prepare(input,{guard=async()=>{},plan:planInput}={}){
  available();if(!capabilities.supported)throw failure('execution-unavailable',capabilities.reason);if(data.history.length>=MAX_HISTORY)throw failure('execution-capacity','Local execution history is full. Existing records are preserved.');
  const plan=planBinding(planInput),group=validateChangeSet(input,projectId);if(plan&&[...data.history,...(data.current?[data.current]:[])].some(record=>JSON.stringify(record.plan)===JSON.stringify(plan)))throw failure('execution-plan','This check-plan attempt already has an execution record. Choose an explicit new retry.');if(group.origin!=='ai'||group.status!=='proposed')throw failure('group-not-runnable','Prepare a currently staged change group before Apply.');
  return perform(async()=>{
   const epoch=++generation;const checked=async()=>{own();if(epoch!==generation)throw failure('execution-cancelled','The isolated preparation was stopped.');await guard();own();if(epoch!==generation)throw failure('execution-cancelled','The isolated preparation was stopped.');};
   let created=false;
   try{
    await checked();await resolveRoots();
    if(data.current){if(!TERMINAL.has(data.current.status)&&data.current.status!=='ready')throw failure('execution-active','Finish the current isolated check.');if(data.current.status==='ready'){transition('cancelled','Replaced by a newly prepared copy.');data.current.finishedAt=data.current.updatedAt;}await removeOwned(data.current.id);data.history.push(clone(data.current));}
    const at=now();data.current={id:randomUUID(),projectId,groupId:group.id,groupRevision:group.revision,groupDigest:changeGroupDigest(group),revision:0,status:'preparing',createdAt:at,updatedAt:at,tasks:[],output:'',outputTruncated:false,...(plan?{plan}: {})};prepared=null;created=true;await persist();
    await safeDirectory(runsRoot,true);const dir=runDir(data.current.id),work=join(dir,'workspace');await mkdir(dir,{mode:0o700});await writeFile(join(dir,'owner.json'),JSON.stringify({id:data.current.id,projectId}),{flag:'wx',mode:0o600});await mkdir(work,{mode:0o700});
    const original=await sourceManifest(root,checked,work);
    for(const ref of group.context){const file=original.files.find(f=>f.path===ref.path);const expected=ref.revision;if(!file||file.hash.slice(0,16)!==expected)throw failure('group-source-changed','The change group no longer matches its disclosed saved source.');}
    for(const file of group.files){const source=await checkedRead(work,file.path);if(source.body.toString('utf8')!==file.before)throw failure('group-source-changed','A changed file no longer matches its staged snapshot.');await writeFile(join(work,file.path),file.after);}
    await sameManifest(original,checked);const staged=await sourceManifest(work,checked);const tools=recipes(staged);
    await mkdir(join(work,'.foundation-execution-home'),{mode:0o700});await mkdir(join(work,'.foundation-execution-tmp'),{mode:0o700});
    data.current.files=staged.files.length;data.current.bytes=staged.bytes;data.current.snapshotRevision=staged.digest;data.current.tasks=tools.map(({args,...task})=>task);
    prepared={id:data.current.id,work,original,staged,tasks:tools};await checked();transition(tools.length?'ready':'unavailable',tools.length?undefined:'No supported check was found. Use up to 64 .test/.spec JavaScript files or a root tsconfig with a local TypeScript installation.');if(!tools.length)data.current.finishedAt=data.current.updatedAt;await persist();await checked();
   }catch(e){if(created&&data.current&&['preparing','ready'].includes(data.current.status)){transition(epoch!==generation?'cancelled':'failed',safeMessage(e));data.current.finishedAt=data.current.updatedAt;prepared=null;if(storage.status!=='error')await persist().catch(()=>{});}throw e;}
  });
 }
 async function terminate(){
  const target=child;if(!target)return;
  try{process.kill(-target.pid,'SIGTERM');}catch{try{target.kill('SIGTERM');}catch{}}
  if(target.exitCode===null&&target.signalCode===null)await Promise.race([new Promise(resolve=>target.once('close',resolve)),new Promise(resolve=>setTimeout(resolve,500))]);
  if(target.exitCode===null&&target.signalCode===null){try{process.kill(-target.pid,'SIGKILL');}catch{try{target.kill('SIGKILL');}catch{}}}
 }
 async function run(id,revision,taskId,{guard=async()=>{},beforeRun}={}){
  available();if(!data.current||id!==data.current.id||revision!==data.current.revision||data.current.status!=='ready'||prepared?.id!==id)throw failure('execution-stale','Prepare and choose the current isolated check before running it.');
  const task=prepared.tasks.find(t=>t.id===taskId);if(!task)throw failure('execution-task','Choose an available fixed check.');
  return perform(async()=>{
   const epoch=++generation;let stopReason,timeout,interval,outputTimer,checking=false,lastOutputNotice=0;
   const checked=async()=>{own();if(epoch!==generation)throw failure('execution-cancelled','The isolated check was stopped.');await guard();own();if(epoch!==generation)throw failure('execution-cancelled','The isolated check was stopped.');};
   const cancel=async reason=>{if(stopReason)return;stopReason=reason;generation++;await terminate();};
   try{
    await checked();await sameManifest(prepared.original,checked);
    const copy=await sourceManifest(prepared.work,checked);if(copy.digest!==prepared.staged.digest)throw failure('copy-changed','The prepared copy changed. Prepare it again before running.');
    data.current.taskId=taskId;data.current.startedAt=now();data.current.output='';data.current.outputTruncated=false;transition('running');await persist();await checked();
    const output=chunk=>{let value=chunk.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');const remaining=MAX_OUTPUT-Buffer.byteLength(data.current.output);if(Buffer.byteLength(value)>remaining){value=Buffer.from(value).subarray(0,remaining).toString('utf8');while(Buffer.byteLength(value)>remaining)value=value.slice(0,-1);data.current.outputTruncated=true;}if(value){data.current.output+=value;data.current.updatedAt=now();if(Date.now()-lastOutputNotice>=100){lastOutputNotice=Date.now();notify();}else if(!outputTimer)outputTimer=setTimeout(()=>{outputTimer=null;lastOutputNotice=Date.now();notify();},100);}};
    const outcome=await new Promise((resolve,reject)=>{
     beforeRun?.();
     child=spawn('/usr/bin/sandbox-exec',['-p',profile(prepared.work),runtime,...task.args],{cwd:prepared.work,env:environment(prepared.work),stdio:['ignore','pipe','pipe'],detached:true});
     const target=child,stdout=new StringDecoder('utf8'),stderr=new StringDecoder('utf8');
     target.stdout.on('data',chunk=>output(stdout.write(chunk)));target.stderr.on('data',chunk=>output(stderr.write(chunk)));
     target.once('error',reject);target.once('close',(code,signal)=>{output(stdout.end());output(stderr.end());clearTimeout(outputTimer);outputTimer=null;notify();if(child===target)child=null;resolve({code,signal});});
     timeout=setTimeout(()=>{void cancel('The isolated check reached its 60-second time limit.');},TIMEOUT);
     interval=setInterval(()=>{if(checking||stopReason)return;checking=true;void checked().catch(()=>cancel('The project, source or request ownership changed. The isolated check was stopped.')).finally(()=>{checking=false;});},250);
    });
    clearTimeout(timeout);clearInterval(interval);data.current.exitCode=outcome.code;data.current.signal=outcome.signal;data.current.finishedAt=now();data.current.updatedAt=data.current.finishedAt;
    if(epoch!==generation||stopReason){if(data.current.status!=='cancelled')transition('cancelled',stopReason||'The isolated check was stopped.');}
    else{
     await checked();const copyAfter=await sourceManifest(prepared.work,checked);const after=new Map(copyAfter.files.map(f=>[f.path,f.hash]));
     if(prepared.staged.files.some(f=>after.get(f.path)!==f.hash))throw failure('check-mutated-source','The check modified or removed copied source. Its result cannot verify the staged snapshot.');
     await sameManifest(prepared.original,checked);transition(outcome.code===0?'passed':'failed',outcome.code===0?undefined:`The check exited with ${outcome.signal||`code ${outcome.code}`}.`);
    }
    await persist();
   }catch(e){await terminate();if(data.current&&['ready','running'].includes(data.current.status)){data.current.finishedAt=now();transition(epoch!==generation?'cancelled':'failed',safeMessage(e));if(storage.status!=='error')await persist().catch(()=>{});}throw e;}
   finally{clearTimeout(timeout);clearTimeout(outputTimer);clearInterval(interval);prepared=null;}
  });
 }
 async function stop(id,revision){
  if(!data.current||!busy||!['preparing','running'].includes(data.current.status))return snapshot();
  if(id!==undefined&&id!==data.current.id||revision!==undefined&&(!Number.isSafeInteger(revision)||revision<0||revision>data.current.revision))throw failure('execution-stale','Stop the current isolated check.');
  generation++;transition('cancelled','Stopped by you. No original source was changed.');data.current.finishedAt=data.current.updatedAt;await terminate();const operation=pending;if(operation)await operation.catch(()=>{});if(storage.status!=='error')await persist().catch(()=>{});return snapshot();
 }
 return {snapshot,isBusy:()=>busy,load:()=>loaded?Promise.resolve(snapshot()):loadPromise||(loadPromise=(async()=>{own();try{await read();await probe();notify();return snapshot();}finally{loadPromise=null;}})()),prepare,run,stop,
  retry:async()=>{own();if(busy)throw failure('execution-active','Wait for the isolated check to stop before retrying storage.');if(!loaded||storage.status==='unavailable')await read();else await persist();await probe();notify();return snapshot();},
  dispose:async()=>{disposed=true;generation++;await terminate();if(pending)await pending.catch(()=>{});},
 };
}
