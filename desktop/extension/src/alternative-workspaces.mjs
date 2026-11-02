import {validAlternativeSourcePath,ALTERNATIVE_GROUP_LIMITS} from '../../../server/project/proposals.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {lstat,mkdir,open,opendir,readFile,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';

export const ALTERNATIVE_WORKSPACE_LIMITS=Object.freeze({entries:32768,bytes:512*1024*1024,fileBytes:16*1024*1024,nativeDependencyBytes:32*1024*1024,manifestBytes:16*1024*1024,sourceBytes:256*1024});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HEX=/^[a-f0-9]{64}$/;
const digest=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
const inside=(base,file)=>{const rel=relative(base,file);return !rel||rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel);};
const fail=(code,message)=>Object.assign(new Error(message),{name:'AlternativeWorkspaceError',code});
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const sourcePath=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&!isAbsolute(value)&&!/[\\\x00-\x1f\x7f]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const text=value=>typeof value==='string'&&!value.includes('\0')&&Buffer.from(value,'utf8').toString('utf8')===value;
// Native Vite dependencies need a narrow 32 MiB exception; aggregate capacity stays 512 MiB.
const fileLimit=path=>path.split('/').includes('node_modules')&&path.endsWith('.node')?ALTERNATIVE_WORKSPACE_LIMITS.nativeDependencyBytes:ALTERNATIVE_WORKSPACE_LIMITS.fileBytes;
const manifestDigest=files=>digest(JSON.stringify(files.map(({path,hash})=>({path,hash}))));
// Same saved-source exclusions as fixed checks, plus Vite's generated optimizer/config caches.
export function alternativePathExcluded(path,directory){
 const parts=path.split('/'),name=parts.at(-1),dependency=parts.includes('node_modules');
 if(['.git','.hg','.svn','.ssh','.aws','.gnupg'].includes(name))return true;
 if(/^\.env(?:\.|$)/i.test(name)||['.npmrc','.yarnrc','.yarnrc.yml','.pypirc','.netrc','.gitconfig'].includes(name)||/\.(?:pem|key|p12|pfx|keystore)$/i.test(name))return true;
 if(directory&&dependency&&['.bin','.cache','.vite','.vite-temp'].includes(name))return true;
 return directory&&!dependency&&['node_modules_cache','.cache','.next','.nuxt','.turbo','coverage','dist','build','.foundation','.foundation-execution-home','.foundation-execution-tmp','.foundation-runtime-home','.foundation-runtime-tmp','.vite-cache'].includes(name);
}

/** Source separation and a macOS write boundary. Local reads and loopback services remain available. */
export function createAlternativeWorkspaces({storageRoot,root:requestedRoot,projectId,nodePath=process.execPath,isCurrent=()=>true}={}){
 if(!isAbsolute(storageRoot||'')||!isAbsolute(requestedRoot||'')||!isAbsolute(nodePath||'')||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(projectId||'')||typeof isCurrent!=='function'||inside(resolve(requestedRoot),resolve(storageRoot)))throw fail('alternative-storage','Choose owned storage outside the original project.');
 let sourceRoot,ownedRoot,runtime,closed=false,active=false,probePromise;
 const known=new Map(),children=new Map();
 const own=()=>{if(closed||!isCurrent())throw fail('alternative-retired','The isolated alternatives no longer belong to the current trusted project.');};
 const checked=async guard=>{own();if(guard)await guard();own();};
 const dir=id=>{if(!UUID.test(id||''))throw fail('alternative-id','Choose an exact saved alternative comparison.');return join(ownedRoot,id);};
 async function regularDirectory(path){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw fail('alternative-storage','An owned directory is missing or has been replaced.');return info;}
 async function roots(guard){
  await checked(guard);const original=await realpath(requestedRoot);await checked(guard);const executable=await realpath(nodePath);await checked(guard);
  await regularDirectory(original);await checked(guard);const bin=await lstat(executable);await checked(guard);if(!bin.isFile()||bin.isSymbolicLink())throw fail('alternative-runtime','The bundled Node runtime is unavailable.');
  await mkdir(storageRoot,{recursive:true,mode:0o700});await checked(guard);await regularDirectory(storageRoot);await checked(guard);const storage=await realpath(storageRoot);await checked(guard);
  if(inside(original,storage)||inside(storage,original)||sourceRoot&&sourceRoot!==original||ownedRoot&&ownedRoot!==storage||runtime&&runtime!==executable)throw fail('alternative-storage','The original project or isolated storage changed identity.');
  sourceRoot=original;ownedRoot=storage;runtime=executable;
 }
 async function readRegular(base,path,guard,max=fileLimit(path)){
  if(!sourcePath(path))throw fail('alternative-source','A copied source path is unsupported.');
  let current=base;
  for(const part of path.split('/')){await checked(guard);current=join(current,part);const info=await lstat(current);await checked(guard);if(info.isSymbolicLink())throw fail('alternative-symlink','Symbolic links cannot enter isolated alternatives. Use regular local files and dependencies.');}
  const info=await lstat(current);await checked(guard);if(!info.isFile()||info.size>max)throw fail('alternative-file','A saved file is unsupported or exceeds the isolated-copy file limit.');
  const handle=await open(current,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes;
  try{await checked(guard);const held=await handle.stat();await checked(guard);if(held.dev!==info.dev||held.ino!==info.ino)throw fail('alternative-changed','A saved file changed while preparing its copy.');bytes=await handle.readFile();await checked(guard);}finally{await handle.close();}
  await checked(guard);if(bytes.length>max||bytes.length!==info.size)throw fail('alternative-changed','A saved file changed size while preparing its copy.');return {bytes,mode:info.mode&0o777,dev:info.dev,ino:info.ino};
 }
 async function inventory(base,guard,destination,originalWriteTemporary){
  const files=[];let bytes=0,entries=0;
  async function walk(folder=''){
   await checked(guard);await regularDirectory(join(base,folder));await checked(guard);const list=[],directory=await opendir(join(base,folder));
   for await(const entry of directory){if(++entries>ALTERNATIVE_WORKSPACE_LIMITS.entries)throw fail('alternative-capacity','The saved project exceeds the 32,768-entry alternative-copy limit.');list.push(entry);}await checked(guard);list.sort((a,b)=>a.name.localeCompare(b.name));
   for(const entry of list){const path=folder?`${folder}/${entry.name}`:entry.name;if(path===originalWriteTemporary?.path||originalWriteTemporary instanceof Set&&originalWriteTemporary.has(path))continue;if(alternativePathExcluded(path,entry.isDirectory()))continue;
    if(entry.isSymbolicLink())throw fail('alternative-symlink','Symbolic links cannot enter isolated alternatives. Use regular local dependencies.');
    if(entry.isDirectory()){if(destination){await mkdir(join(destination,path),{mode:0o700});await checked(guard);}await walk(path);continue;}
    if(!entry.isFile())throw fail('alternative-source','Special files cannot enter isolated alternatives.');
    const value=await readRegular(base,path,guard);bytes+=value.bytes.length;if(bytes>ALTERNATIVE_WORKSPACE_LIMITS.bytes)throw fail('alternative-capacity','The saved project exceeds the 512 MiB alternative-copy limit.');
    if(destination){await writeFile(join(destination,path),value.bytes,{flag:'wx',mode:value.mode});await checked(guard);}files.push({path,hash:digest(value.bytes),bytes:value.bytes.length});
   }
  }
  await walk();await checked(guard);return {files,bytes,digest:manifestDigest(files)};
 }
 const profile=(work,esbuild)=>`(version 1)\n(allow default)\n(deny file-write* (require-not (require-any (subpath ${JSON.stringify(work)}) (literal "/dev/null"))))\n(deny network-inbound (require-not (local ip "localhost:*")))\n(deny network-outbound (require-not (remote ip "localhost:*")))\n(deny network-bind (require-not (local ip "localhost:*")))\n(deny process-exec (require-not (require-any (literal ${JSON.stringify(runtime)})${esbuild?` (literal ${JSON.stringify(esbuild)})`:''})))\n(deny mach-lookup)\n(deny appleevent-send)\n(deny signal (require-not (target self)))\n`;
 const environment=(work,token)=>({PATH:'/usr/bin:/bin',HOME:join(work,'.foundation-runtime-home'),TMPDIR:join(work,'.foundation-runtime-tmp'),LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',CI:'1',NO_COLOR:'1',ELECTRON_RUN_AS_NODE:'1',FOUNDATION_RUNTIME_TOKEN:token});
 async function supported(guard){
  await roots(guard);if(process.platform!=='darwin')throw fail('alternative-runtime','Isolated alternative runtimes require the verified macOS process boundary.');
  if(!probePromise)probePromise=(async()=>{
   const sandbox=await lstat('/usr/bin/sandbox-exec');if(!sandbox.isFile()||sandbox.isSymbolicLink())throw fail('alternative-runtime','The macOS process boundary is unavailable. No unrestricted runtime is used.');
   const probe=join(ownedRoot,`.probe-${randomUUID()}`);await mkdir(probe,{mode:0o700});
   try{await new Promise((resolve,reject)=>{const child=spawn('/usr/bin/sandbox-exec',['-p',profile(probe),runtime,'-e','process.stdout.write("foundation-alternative-ready")'],{cwd:probe,env:environment(probe,'0'.repeat(64)),stdio:['ignore','pipe','pipe']});let output='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(fail('alternative-runtime','The macOS process boundary did not respond.'));},5000);child.stdout.on('data',data=>{if(output.length<128)output+=data;});child.stderr.on('data',()=>{});child.once('error',()=>{clearTimeout(timer);reject(fail('alternative-runtime','The macOS process boundary could not start.'));});child.once('close',code=>{clearTimeout(timer);code===0&&output==='foundation-alternative-ready'?resolve():reject(fail('alternative-runtime','The macOS process boundary is unavailable. No unrestricted runtime is used.'));});});}
   finally{await rm(probe,{recursive:true,force:true});}
  })();await probePromise;await checked(guard);
 }
 function legacyManifestValue(value,comparisonId){
  if(!exact(value,['schemaVersion','projectId','comparisonId','sourceRoot','path','beforeHash','afterHash','baselineDigest','variants'])||value.schemaVersion!==1||value.projectId!==projectId||value.comparisonId!==comparisonId||value.sourceRoot!==sourceRoot||!sourcePath(value.path)||!HEX.test(value.beforeHash)||!HEX.test(value.afterHash)||value.beforeHash===value.afterHash||!HEX.test(value.baselineDigest)||!Array.isArray(value.variants)||value.variants.length!==2)throw fail('alternative-manifest','Saved alternative source metadata is invalid. Its files were left untouched.');
  for(const [index,id] of ['baseline','alternative'].entries()){
   const variant=value.variants[index];if(!exact(variant,['id','manifestDigest','files','bytes'])||variant.id!==id||!HEX.test(variant.manifestDigest)||!Array.isArray(variant.files)||variant.files.length<1||variant.files.length>ALTERNATIVE_WORKSPACE_LIMITS.entries||!Number.isSafeInteger(variant.bytes)||variant.bytes<0||variant.bytes>ALTERNATIVE_WORKSPACE_LIMITS.bytes)throw fail('alternative-manifest','The saved alternative manifest is invalid.');
   const seen=new Set();let size=0;for(const file of variant.files){if(!exact(file,['path','hash','bytes'])||!sourcePath(file.path)||seen.has(file.path)||!HEX.test(file.hash)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>fileLimit(file.path))throw fail('alternative-manifest','The saved file inventory is invalid.');seen.add(file.path);size+=file.bytes;}
   if(size!==variant.bytes||manifestDigest(variant.files)!==variant.manifestDigest||variant.files.find(file=>file.path===value.path)?.hash!==value[id==='baseline'?'beforeHash':'afterHash'])throw fail('alternative-manifest','The saved source digest does not match its alternative.');
  }
  if(value.variants[0].manifestDigest!==value.baselineDigest)throw fail('alternative-manifest','The baseline source digest is inconsistent.');
  const a=value.variants[0].files,b=value.variants[1].files;if(a.length!==b.length||a.some((file,index)=>file.path!==b[index].path||file.path!==value.path&&(file.hash!==b[index].hash||file.bytes!==b[index].bytes)))throw fail('alternative-manifest','Alternatives must share every saved input apart from their one reviewed target.');return value;
 }
 function groupChanges(files){
  if(!Array.isArray(files)||files.length<2||files.length>ALTERNATIVE_GROUP_LIMITS.files)throw fail('alternative-group','Choose a complete reviewed group of two to eight existing application source files.');
  let beforeBytes=0,afterBytes=0;const seen=new Set();
  const values=files.map(file=>{if(!exact(file,['path','before','after'])||!validAlternativeSourcePath(file.path)||seen.has(file.path)||!text(file.before)||!text(file.after)||file.before===file.after)throw fail('alternative-group','Group alternatives support existing application source only. Configuration, generated files and runtime instrumentation are excluded.');seen.add(file.path);beforeBytes+=Buffer.byteLength(file.before);afterBytes+=Buffer.byteLength(file.after);return {...file,beforeHash:digest(file.before),afterHash:digest(file.after)};});
  if(beforeBytes>ALTERNATIVE_GROUP_LIMITS.sourceBytes||afterBytes>ALTERNATIVE_GROUP_LIMITS.sourceBytes)throw fail('alternative-group-capacity','The original and proposed group sources must each fit within 64 KiB.');
  return values.sort((a,b)=>a.path.localeCompare(b.path));
 }
 function manifestValue(value,comparisonId){
  if(value?.schemaVersion!==2)return legacyManifestValue(value,comparisonId);
  if(!exact(value,['schemaVersion','projectId','comparisonId','sourceRoot','changes','baselineDigest','variants'])||value.projectId!==projectId||value.comparisonId!==comparisonId||value.sourceRoot!==sourceRoot||!HEX.test(value.baselineDigest)||!Array.isArray(value.changes)||value.changes.length<2||value.changes.length>8||!Array.isArray(value.variants)||value.variants.length!==2)throw fail('alternative-manifest','Saved group alternative metadata is invalid.');
  const changes=new Map();let previous;
  for(const file of value.changes){if(!exact(file,['path','beforeHash','afterHash'])||!validAlternativeSourcePath(file.path)||!HEX.test(file.beforeHash)||!HEX.test(file.afterHash)||file.beforeHash===file.afterHash||previous!==undefined&&previous.localeCompare(file.path)>=0)throw fail('alternative-manifest','Saved group changes are invalid.');previous=file.path;changes.set(file.path,file);}
  for(const [index,id] of ['baseline','alternative'].entries()){
   const variant=value.variants[index];if(!exact(variant,['id','manifestDigest','files','bytes'])||variant.id!==id||!HEX.test(variant.manifestDigest)||!Array.isArray(variant.files)||!variant.files.length||variant.files.length>ALTERNATIVE_WORKSPACE_LIMITS.entries||!Number.isSafeInteger(variant.bytes)||variant.bytes<0||variant.bytes>ALTERNATIVE_WORKSPACE_LIMITS.bytes)throw fail('alternative-manifest','Saved group inventory is invalid.');
   const seen=new Set();let bytes=0,sourceBytes=0;for(const file of variant.files){if(!exact(file,['path','hash','bytes'])||!sourcePath(file.path)||seen.has(file.path)||!HEX.test(file.hash)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>fileLimit(file.path))throw fail('alternative-manifest','Saved group file inventory is invalid.');seen.add(file.path);bytes+=file.bytes;const change=changes.get(file.path);if(change){sourceBytes+=file.bytes;if(file.hash!==change[id==='baseline'?'beforeHash':'afterHash'])throw fail('alternative-manifest','Saved changed source does not match its variant.');}}
   if(bytes!==variant.bytes||sourceBytes>ALTERNATIVE_GROUP_LIMITS.sourceBytes||[...changes.keys()].some(path=>!seen.has(path))||manifestDigest(variant.files)!==variant.manifestDigest)throw fail('alternative-manifest','Saved group manifest digest is inconsistent.');
  }
  const [a,b]=value.variants;if(a.manifestDigest!==value.baselineDigest||a.files.length!==b.files.length||a.files.some((file,index)=>file.path!==b.files[index].path||!changes.has(file.path)&&(file.hash!==b.files[index].hash||file.bytes!==b.files[index].bytes)))throw fail('alternative-manifest','Only the exact reviewed group may differ between saved variants.');return value;
 }
 async function owner(comparisonId,guard){
  await roots(guard);const location=dir(comparisonId);await regularDirectory(location);await checked(guard);const marker=await readRegular(location,'owner.json',guard,8192);let value;try{value=JSON.parse(marker.bytes);}catch{throw fail('alternative-owner','The alternative ownership marker is invalid.');}
  if(!exact(value,['schemaVersion','projectId','comparisonId','sourceRoot'])||value.schemaVersion!==1||value.projectId!==projectId||value.comparisonId!==comparisonId||value.sourceRoot!==sourceRoot)throw fail('alternative-owner','The alternative ownership marker does not match this project.');return {location,marker:marker.bytes};
 }
 async function stored(comparisonId,guard){
  const owned=await owner(comparisonId,guard);const manifest=await readRegular(owned.location,'manifest.json',guard,ALTERNATIVE_WORKSPACE_LIMITS.manifestBytes);let value;try{value=manifestValue(JSON.parse(manifest.bytes),comparisonId);}catch(error){if(error.name==='AlternativeWorkspaceError')throw error;throw fail('alternative-manifest','Saved alternative metadata could not be read safely.');}return {...owned,value};
 }
 const presentation=(comparisonId,value,variant)=>({id:variant.id,root:join(dir(comparisonId),variant.id,'workspace'),manifestDigest:variant.manifestDigest,files:variant.files.length,bytes:variant.bytes});
 async function resolveVariant(comparisonId,variantId,{guard}={}){
  if(!['baseline','alternative'].includes(variantId))throw fail('alternative-variant','Choose baseline or alternative.');const saved=await stored(comparisonId,guard);const variant=saved.value.variants.find(item=>item.id===variantId),result=presentation(comparisonId,saved.value,variant);await regularDirectory(join(saved.location,variantId));await checked(guard);await regularDirectory(result.root);await checked(guard);const actual=await realpath(result.root);await checked(guard);if(actual!==result.root)throw fail('alternative-storage','An isolated workspace has been redirected.');known.set(actual,{comparisonId,variantId});return result;
 }
 async function validate(comparisonId,variantId,expectedManifestDigest,{guard}={}){
  const variant=await resolveVariant(comparisonId,variantId,{guard});if(expectedManifestDigest!==undefined&&variant.manifestDigest!==expectedManifestDigest)throw fail('alternative-changed','The saved alternative identity changed.');const actual=await inventory(variant.root,guard);if(actual.digest!==variant.manifestDigest)throw fail('alternative-copy-changed','The copied inputs changed. Their result cannot verify the saved alternative.');await checked(guard);return variant;
 }
 // This descriptor comes only from the host's atomic writer, never renderer input.
 async function validateWriteTemporary(value,saved,guard){
  if(value===undefined)return;
  const target=saved.path.split('/');target.pop();const parent=target.length?target.join('/')+'/':'';
  if(!exact(value,['path','dev','ino','hash'])||typeof value.path!=='string'||!value.path.startsWith(parent)||!/^\.foundation-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/.test(value.path.slice(parent.length))||!Number.isSafeInteger(value.dev)||!Number.isSafeInteger(value.ino)||value.dev<0||value.ino<0||value.hash!==saved.afterHash)throw fail('alternative-write-temporary','The pending source write does not belong to this retained alternative.');
  const file=await readRegular(sourceRoot,value.path,guard,ALTERNATIVE_WORKSPACE_LIMITS.sourceBytes);
  if(file.dev!==value.dev||file.ino!==value.ino||digest(file.bytes)!==value.hash)throw fail('alternative-write-temporary','The pending source write changed while validating its retained alternative.');
 }
 async function validateOriginal(comparisonId,{guard,originalWriteTemporary}={}){
  const saved=await stored(comparisonId,guard);await validateWriteTemporary(originalWriteTemporary,saved.value,guard);
  const actual=await inventory(sourceRoot,guard,undefined,originalWriteTemporary);await validateWriteTemporary(originalWriteTemporary,saved.value,guard);
  if(actual.digest!==saved.value.baselineDigest)throw fail('alternative-source-changed','Saved original inputs changed. Prepare a new comparison.');
  const latest=await stored(comparisonId,guard);if(!latest.marker.equals(saved.marker)||JSON.stringify(latest.value)!==JSON.stringify(saved.value))throw fail('alternative-changed','The saved alternative identity changed.');
  await checked(guard);return {manifestDigest:actual.digest,files:actual.files.length,bytes:actual.bytes};
 }
 function batchProgress(value,saved){
  if(value===undefined)return undefined;
  const required=['phase','writtenPaths','temporaries'];if(!value||typeof value!=='object'||Array.isArray(value)||!required.every(key=>Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,'targetPath'].includes(key))||!['preflight','before-write','complete'].includes(value.phase)||!Array.isArray(value.writtenPaths)||!Array.isArray(value.temporaries)||value.writtenPaths.length>saved.changes.length||value.temporaries.length>saved.changes.length)throw fail('alternative-batch-progress','The pending group write has invalid host ownership.');
  const paths=saved.changes.map(file=>file.path);if(value.writtenPaths.some((path,index)=>path!==paths[index]))throw fail('alternative-batch-progress','Written group progress differs from the reviewed file order.');
  const remaining=paths.slice(value.writtenPaths.length),targets=new Set(),temporaryPaths=new Set();
  for(const file of value.temporaries){const change=saved.changes.find(item=>item.path===file?.targetPath),parent=file?.targetPath?.split('/').slice(0,-1).join('/'),prefix=parent?parent+'/':'';
   if(!exact(file,['targetPath','path','dev','ino','hash'])||!change||!remaining.includes(file.targetPath)||targets.has(file.targetPath)||temporaryPaths.has(file.path)||typeof file.path!=='string'||!file.path.startsWith(prefix)||!/^\.foundation-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/.test(file.path.slice(prefix.length))||!Number.isSafeInteger(file.dev)||!Number.isSafeInteger(file.ino)||file.dev<0||file.ino<0||file.hash!==change.afterHash)throw fail('alternative-batch-progress','A pending group file does not belong to its exact reviewed target.');targets.add(file.targetPath);temporaryPaths.add(file.path);
  }
  if(value.phase==='before-write'&&(value.targetPath!==remaining[0]||!remaining.length||targets.size!==remaining.length)||value.phase==='complete'&&(remaining.length||targets.size||value.targetPath!==undefined)||value.phase==='preflight'&&value.targetPath!==undefined)throw fail('alternative-batch-progress','The group write phase is inconsistent with its exact progress.');
  return clone(value);
 }
 async function validateOriginalProgress(comparisonId,{guard,originalBatchWrite}={}){
  const saved=await stored(comparisonId,guard);if(saved.value.schemaVersion!==2)throw fail('alternative-kind','Choose a retained multi-file alternative.');const progress=batchProgress(originalBatchWrite,saved.value);
  const verifyTemps=async()=>{for(const file of progress?.temporaries||[]){const actual=await readRegular(sourceRoot,file.path,guard,ALTERNATIVE_GROUP_LIMITS.sourceBytes);if(actual.dev!==file.dev||actual.ino!==file.ino||digest(actual.bytes)!==file.hash)throw fail('alternative-batch-temporary','A pending group file changed while validating its baseline.');}};
  await verifyTemps();const actual=await inventory(sourceRoot,guard,undefined,new Set((progress?.temporaries||[]).map(file=>file.path)));await verifyTemps();
  const written=new Set(progress?.writtenPaths||[]),normalized=actual.files.map(file=>{if(!written.has(file.path))return file;const change=saved.value.changes.find(item=>item.path===file.path);if(file.hash!==change.afterHash)throw fail('alternative-source-changed','A written group target differs from its exact proposed source.');return {...file,hash:change.beforeHash};});
  if(manifestDigest(normalized)!==saved.value.baselineDigest)throw fail('alternative-source-changed','The full saved baseline changed during group adoption. Inspect the source and recovery state.');
  const latest=await stored(comparisonId,guard);if(!latest.marker.equals(saved.marker)||JSON.stringify(latest.value)!==JSON.stringify(saved.value))throw fail('alternative-changed','Retained group ownership changed.');await checked(guard);return {manifestDigest:saved.value.baselineDigest,files:actual.files.length,bytes:actual.bytes};
 }
 async function readGroup(comparisonId,{guard,originalBatchWrite}={}){
  if([...children.values()].includes(comparisonId))throw fail('alternative-running','Stop the owned runtime before reading retained group source.');
  const saved=await stored(comparisonId,guard),pinned=saved.value;if(pinned.schemaVersion!==2)throw fail('alternative-kind','Choose a retained multi-file alternative.');
  await validateOriginalProgress(comparisonId,{guard,originalBatchWrite});const sources={};
  for(const id of ['baseline','alternative']){const expected=pinned.variants.find(item=>item.id===id),variant=await validate(comparisonId,id,expected.manifestDigest,{guard});sources[id]=[];
   for(const changed of pinned.changes){const file=await readRegular(variant.root,changed.path,guard,ALTERNATIVE_GROUP_LIMITS.sourceBytes),source=file.bytes.toString('utf8');if(!text(source)||!Buffer.from(source,'utf8').equals(file.bytes)||digest(file.bytes)!==changed[id==='baseline'?'beforeHash':'afterHash'])throw fail('alternative-copy-changed','The exact retained group source changed.');sources[id].push(source);}}
  for(const variant of pinned.variants)await validate(comparisonId,variant.id,variant.manifestDigest,{guard});await validateOriginalProgress(comparisonId,{guard,originalBatchWrite});const latest=await stored(comparisonId,guard);
  if(!latest.marker.equals(saved.marker)||JSON.stringify(latest.value)!==JSON.stringify(pinned))throw fail('alternative-changed','Retained group ownership changed while reading its source.');await checked(guard);
  return {files:pinned.changes.map((file,index)=>({...file,before:sources.baseline[index],after:sources.alternative[index]})),baselineDigest:pinned.baselineDigest,manifestDigests:{baseline:pinned.variants[0].manifestDigest,alternative:pinned.variants[1].manifestDigest}};
 }
 async function readPair(comparisonId,{guard,originalWriteTemporary}={}){
  if([...children.values()].includes(comparisonId))throw fail('alternative-running','Stop the owned runtime before reading its retained source.');
  const saved=await stored(comparisonId,guard),pinned=saved.value,options={guard,originalWriteTemporary};
  await validateOriginal(comparisonId,options);const values={};
  for(const id of ['baseline','alternative']){const expected=pinned.variants.find(item=>item.id===id),variant=await validate(comparisonId,id,expected.manifestDigest,{guard});const file=await readRegular(variant.root,pinned.path,guard,ALTERNATIVE_WORKSPACE_LIMITS.sourceBytes);const source=file.bytes.toString('utf8');if(!text(source)||!Buffer.from(source,'utf8').equals(file.bytes)||digest(file.bytes)!==pinned[id==='baseline'?'beforeHash':'afterHash'])throw fail('alternative-copy-changed','Retained source does not match its exact saved alternative.');values[id]=source;}
  for(const variant of pinned.variants)await validate(comparisonId,variant.id,variant.manifestDigest,{guard});
  await validateOriginal(comparisonId,options);const latest=await stored(comparisonId,guard);if(!latest.marker.equals(saved.marker)||JSON.stringify(latest.value)!==JSON.stringify(pinned))throw fail('alternative-changed','The saved alternative identity changed while reading its source.');
  await checked(guard);return {path:pinned.path,before:values.baseline,after:values.alternative,beforeHash:pinned.beforeHash,afterHash:pinned.afterHash,baselineDigest:pinned.baselineDigest,manifestDigests:{baseline:pinned.variants[0].manifestDigest,alternative:pinned.variants[1].manifestDigest}};
 }
 async function readSources(comparisonId,variantId,paths,{guard}={}){
  if(!Array.isArray(paths)||paths.length<1||paths.length>32||new Set(paths).size!==paths.length||paths.some(path=>!sourcePath(path)))throw fail('alternative-source','Choose at most 32 distinct saved source paths.');
  const variant=await validate(comparisonId,variantId,undefined,{guard}),saved=await stored(comparisonId,guard),files=saved.value.variants.find(item=>item.id===variantId).files;
  const sources=paths.map(path=>{const entry=files.find(item=>item.path===path);if(!entry)throw fail('alternative-source','A requested source is absent from the saved alternative.');return {path,revision:entry.hash};});
  await validate(comparisonId,variantId,variant.manifestDigest,{guard});await checked(guard);return sources;
 }
 async function prepare({comparisonId,path,before,after,guard}={}){
  if(active)throw fail('alternative-busy','An alternative copy is already being prepared.');if(!UUID.test(comparisonId||'')||!sourcePath(path)||!path.endsWith('.css')||!text(before)||!text(after)||before===after||Buffer.byteLength(before)>ALTERNATIVE_WORKSPACE_LIMITS.sourceBytes||Buffer.byteLength(after)>ALTERNATIVE_WORKSPACE_LIMITS.sourceBytes||guard!==undefined&&typeof guard!=='function')throw fail('alternative-input','Choose one reviewed CSS token proposal and a fresh comparison identity.');
  active=true;let created=false;
  try{
   await supported(guard);const location=dir(comparisonId);await mkdir(location,{mode:0o700});created=true;await checked(guard);await writeFile(join(location,'owner.json'),JSON.stringify({schemaVersion:1,projectId,comparisonId,sourceRoot}),{flag:'wx',mode:0o600});await checked(guard);
   for(const id of ['baseline','alternative']){await mkdir(join(location,id,'workspace'),{recursive:true,mode:0o700});await checked(guard);}
   const a=join(location,'baseline/workspace'),b=join(location,'alternative/workspace');const original=await inventory(sourceRoot,guard,a);const target=await readRegular(a,path,guard,ALTERNATIVE_WORKSPACE_LIMITS.sourceBytes);if(target.bytes.toString('utf8')!==before)throw fail('alternative-source-changed','The reviewed baseline no longer matches saved source.');
   // The second alternative is derived from the same immutable baseline copy, never a later project scan.
   const second=await inventory(a,guard,b);if(second.digest!==original.digest)throw fail('alternative-copy-changed','The baseline copy changed while preparing the second alternative.');
   await writeFile(join(b,path),after,{flag:'w',mode:target.mode});await checked(guard);
   const changed=await inventory(b,guard),current=await inventory(sourceRoot,guard);if(current.digest!==original.digest)throw fail('alternative-source-changed','Saved original inputs changed while preparing alternatives.');
   const value=manifestValue({schemaVersion:1,projectId,comparisonId,sourceRoot,path,beforeHash:digest(before),afterHash:digest(after),baselineDigest:original.digest,variants:[{id:'baseline',manifestDigest:original.digest,files:original.files,bytes:original.bytes},{id:'alternative',manifestDigest:changed.digest,files:changed.files,bytes:changed.bytes}]},comparisonId);
   const body=JSON.stringify(value);if(Buffer.byteLength(body)>ALTERNATIVE_WORKSPACE_LIMITS.manifestBytes)throw fail('alternative-capacity','The saved alternative manifests exceed local capacity. No original source was changed.');
   for(const root of [a,b])for(const folder of ['.foundation-runtime-home','.foundation-runtime-tmp']){await mkdir(join(root,folder),{mode:0o700});await checked(guard);}
   const temporary=join(location,`.manifest-${randomUUID()}.tmp`);await writeFile(temporary,body,{flag:'wx',mode:0o600});await checked(guard);await rename(temporary,join(location,'manifest.json'));await checked(guard);
   const variants=await Promise.all(['baseline','alternative'].map(id=>resolveVariant(comparisonId,id,{guard})));return {comparisonId,path,beforeHash:value.beforeHash,afterHash:value.afterHash,baselineDigest:value.baselineDigest,variants};
  }catch(error){if(created){try{await cleanup(comparisonId,{allowRetired:true});}catch{/* A changed ownership marker is never deleted. */}}throw error;}
  finally{active=false;}
 }
 async function prepareGroup({comparisonId,files:input,guard}={}){
  if(active)throw fail('alternative-busy','An alternative copy is already being prepared.');if(!UUID.test(comparisonId||'')||guard!==undefined&&typeof guard!=='function')throw fail('alternative-input','Choose a fresh retained group identity.');const files=groupChanges(input);active=true;let created=false;
  try{await supported(guard);const location=dir(comparisonId);await mkdir(location,{mode:0o700});created=true;await checked(guard);await writeFile(join(location,'owner.json'),JSON.stringify({schemaVersion:1,projectId,comparisonId,sourceRoot}),{flag:'wx',mode:0o600});await checked(guard);
   for(const id of ['baseline','alternative']){await mkdir(join(location,id,'workspace'),{recursive:true,mode:0o700});await checked(guard);}
   const a=join(location,'baseline/workspace'),b=join(location,'alternative/workspace'),original=await inventory(sourceRoot,guard,a),modes=new Map();
   for(const file of files){const saved=await readRegular(a,file.path,guard,ALTERNATIVE_GROUP_LIMITS.sourceBytes);if(!saved.bytes.equals(Buffer.from(file.before)))throw fail('alternative-source-changed','A reviewed group original no longer matches saved source.');modes.set(file.path,saved.mode);}
   const second=await inventory(a,guard,b);if(second.digest!==original.digest)throw fail('alternative-copy-changed','The frozen group baseline changed while copying.');
   for(const file of files){await writeFile(join(b,file.path),file.after,{flag:'w',mode:modes.get(file.path)});await checked(guard);}
   const changed=await inventory(b,guard),current=await inventory(sourceRoot,guard);if(current.digest!==original.digest)throw fail('alternative-source-changed','The original project changed while copying the group.');
   const changes=files.map(({path,beforeHash,afterHash})=>({path,beforeHash,afterHash})),value=manifestValue({schemaVersion:2,projectId,comparisonId,sourceRoot,changes,baselineDigest:original.digest,variants:[{id:'baseline',manifestDigest:original.digest,files:original.files,bytes:original.bytes},{id:'alternative',manifestDigest:changed.digest,files:changed.files,bytes:changed.bytes}]},comparisonId),body=JSON.stringify(value);
   if(Buffer.byteLength(body)>ALTERNATIVE_WORKSPACE_LIMITS.manifestBytes)throw fail('alternative-capacity','The saved group manifests exceed local capacity.');
   for(const root of [a,b])for(const folder of ['.foundation-runtime-home','.foundation-runtime-tmp']){await mkdir(join(root,folder),{mode:0o700});await checked(guard);}
   const temporary=join(location,`.manifest-${randomUUID()}.tmp`);await writeFile(temporary,body,{flag:'wx',mode:0o600});await checked(guard);await rename(temporary,join(location,'manifest.json'));await checked(guard);
   const variants=await Promise.all(['baseline','alternative'].map(id=>resolveVariant(comparisonId,id,{guard})));return {comparisonId,files:changes,baselineDigest:original.digest,variants};
  }catch(error){if(created){try{await cleanup(comparisonId,{allowRetired:true});}catch{}}throw error;}finally{active=false;}
 }
 async function launcher({root,nodePath:requestedNode,args,token}={}){
  own();const binding=known.get(root);if(!binding||!Array.isArray(args)||args.length!==6||args[0]!==join(root,'node_modules/vite/bin/vite.js')||args[1]!=='--host'||args[2]!=='127.0.0.1'||args[3]!=='--port'||!/^\d{1,5}$/.test(args[4])||Number(args[4])<1024||Number(args[4])>65535||args[5]!=='--strictPort'||!HEX.test(token||''))throw fail('alternative-command','Only the fixed local Vite command can run in an owned alternative.');
  const requested=await realpath(requestedNode);own();if(requested!==runtime)throw fail('alternative-runtime','The runtime executable changed.');await supported();await validate(binding.comparisonId,binding.variantId);own();
  let esbuild;const candidate=join(root,'node_modules/@esbuild',`darwin-${process.arch}`,'bin/esbuild');try{const file=await lstat(candidate);own();if(file.isSymbolicLink()||!file.isFile()||await realpath(candidate)!==candidate)throw fail('alternative-runtime','The copied build helper is unsafe.');esbuild=candidate;}catch(error){if(error.code!=='ENOENT')throw error;}
  own();const child=spawn('/usr/bin/sandbox-exec',['-p',profile(root,esbuild),runtime,...args],{cwd:root,env:environment(root,token),stdio:['ignore','pipe','pipe'],detached:true});
  children.set(child,binding.comparisonId);child.once('close',()=>children.delete(child));return child;
 }
 async function cleanup(comparisonId,{allowRetired=false}={}){
  // Cleanup is allowed after cancellation, but only for this exact immutable filesystem owner.
  if(!allowRetired)own();if([...children.values()].includes(comparisonId))throw fail('alternative-running','Stop the owned runtime before removing its saved copy.');if(!ownedRoot||!sourceRoot)throw fail('alternative-owner','No owned comparison storage has been established.');const location=dir(comparisonId);await regularDirectory(ownedRoot);if(await realpath(storageRoot)!==ownedRoot)throw fail('alternative-owner','Storage identity changed; files were left untouched.');await regularDirectory(location);const marker=join(location,'owner.json'),info=await lstat(marker);if(!info.isFile()||info.isSymbolicLink()||info.size>8192)throw fail('alternative-owner','The ownership marker is unavailable.');const value=JSON.parse(await readFile(marker,'utf8'));if(!exact(value,['schemaVersion','projectId','comparisonId','sourceRoot'])||value.schemaVersion!==1||value.projectId!==projectId||value.comparisonId!==comparisonId||value.sourceRoot!==sourceRoot)throw fail('alternative-owner','Foreign comparison files were left untouched.');await rm(location,{recursive:true,force:false});for(const [path,binding] of known)if(binding.comparisonId===comparisonId)known.delete(path);
 }
 return {prepare,prepareGroup,resolveVariant,validate,validateOriginal,validateOriginalProgress,readSources,readPair,readGroup,launcher,cleanup,dispose(){closed=true;known.clear();}};
}
