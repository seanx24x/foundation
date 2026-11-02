import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdtemp, open, opendir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { isXcodeSourceInput, readXcodeSourceFingerprint, runXcodeOperation } from './xcode-project.mjs';

const preparations = new WeakMap();
const configurations = new WeakMap();
const binaryHashes = new Map();
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`);
const cancelled = signal => { if (signal?.aborted) throw new Error('cancelled'); };
const LIMITS = { entries:4096, depth:16, fileBytes:8*1024*1024, totalBytes:64*1024*1024, arguments:4096, targets:128 };
function identity(value) { return JSON.stringify(value); }
function failure(error) {
  const code = error?.message;
  if (code === 'cancelled') return {status:'cancelled',reason:'Swift connection was cancelled.'};
  if (code === 'stale') return {status:'stale',reason:'Project settings, source membership or toolchain changed. Build and connect Swift again.'};
  if (code === 'no-swift-settings') return {status:'unavailable',reason:'This successful build did not report a supported Swift compiler invocation. Choose a scheme that compiles Swift sources and retry.'};
  if (code === 'source-outside-root') return {status:'unavailable',reason:'This Swift target includes generated or external sources outside the selected folder. Their editor settings are not supported yet.'};
  if (code === 'unsupported-plugin') return {status:'unavailable',reason:'This target loads a compiler plugin explicitly. Plugin-aware Swift editor settings are not supported yet.'};
  if (code === 'external-settings') return {status:'unavailable',reason:'This compiler invocation depends on paths outside the selected project, build output or Xcode installation. External settings are not supported yet.'};
  if (code === 'source-limit') return {status:'unavailable',reason:'Swift settings exceeded the bounded local project or compiler-output limits. Open a smaller self-contained project.'};
  return {status:'unavailable',reason:'Accurate Swift settings could not be read from this build. Open its diagnostic output and choose a supported local Swift target.'};
}

async function regularFile(root, path, signal, maxBytes=LIMITS.fileBytes) {
  cancelled(signal);
  if (!isAbsolute(path) || !inside(root,path) || path === root) throw new Error('external-settings');
  let cursor=root;
  for (const part of relative(root,path).split(sep)) {
    cursor=join(cursor,part);
    const stat=await lstat(cursor);
    if (stat.isSymbolicLink() || (cursor===path ? !stat.isFile() : !stat.isDirectory())) throw new Error('linked-input');
  }
  if (await realpath(path)!==path) throw new Error('linked-input');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await fd.stat();
    if (!before.isFile() || before.size>maxBytes) throw new Error('source-limit');
    const data=Buffer.alloc(before.size+1);let bytes=0;
    while(bytes<data.length) { cancelled(signal);const read=await fd.read(data,bytes,data.length-bytes,bytes);bytes+=read.bytesRead;if(!read.bytesRead)break; }
    const after=await fd.stat();
    if(bytes!==before.size || after.size!==before.size || after.ino!==before.ino || after.mtimeMs!==before.mtimeMs || await realpath(path)!==path)throw new Error('stale');
    return data.subarray(0,bytes);
  } finally { await fd.close(); }
}

// Keep saved Swift text out of settings identity. Add/remove/rename and all non-Swift
// inputs still invalidate the connection; unsaved Swift is sent through didChange.
export async function readXcodeLanguageConfigurationFingerprint(rootInput, options={}) {
  try {
    cancelled(options.signal);
    if(typeof rootInput!=='string'||!isAbsolute(rootInput))return null;
    const stat=await lstat(rootInput);if(!stat.isDirectory()||stat.isSymbolicLink())return null;
    const root=await realpath(rootInput),records=[];let entries=0,bytes=0;
    async function visit(path,depth) {
      cancelled(options.signal);
      const full=path?join(root,path):root;
      if(await realpath(full)!==full)throw new Error('linked-input');
      const dir=await opendir(full),children=[];
      try { for await(const item of dir) { if(++entries>LIMITS.entries)throw new Error('source-limit');children.push(item); } }
      finally { await dir.close().catch(()=>{}); }
      children.sort((a,b)=>a.name.localeCompare(b.name,'en'));
      for(const child of children) {
        cancelled(options.signal);const name=path?`${path}/${child.name}`:child.name;
        if(!isXcodeSourceInput(name))continue;
        if(child.isSymbolicLink()||(!child.isDirectory()&&!child.isFile()))throw new Error('linked-input');
        if(child.isDirectory()) { if(depth>=LIMITS.depth)throw new Error('source-limit');records.push([`${name}/`,'directory']);await visit(name,depth+1); }
        else if(child.name.endsWith('.swift')) {
          const actual=await lstat(join(root,name));
          if(!actual.isFile()||actual.isSymbolicLink()||await realpath(join(root,name))!==join(root,name))throw new Error('linked-input');
          records.push([name,'swift-source']);
        } else { const data=await regularFile(root,join(root,name),options.signal,Math.min(LIMITS.fileBytes,LIMITS.totalBytes-bytes));bytes+=data.length;records.push([name,hash(data)]); }
      }
    }
    await visit('',0);return hash(identity(records));
  } catch { return null; }
}

// xcodebuild prints an escaped argv, not JSON. Decode that bounded representation
// without a shell, evaluation, substitutions or command execution.
function splitArguments(text) {
  if(typeof text!=='string'||text.length>512*1024||/[\u0000\r]/.test(text))throw new Error('invalid-arguments');
  const result=[];let word='',quote='',started=false;
  const end=()=>{if(started){result.push(word);word='';started=false;if(result.length>LIMITS.arguments)throw new Error('source-limit');}};
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(ch==='\\'&&quote!=="'") { if(i+1>=text.length)throw new Error('invalid-arguments');word+=text[++i];started=true;continue; }
    if(quote) { if(ch===quote){quote='';continue;}if(quote==='"'&&/[`$]/.test(ch))throw new Error('invalid-arguments');word+=ch;started=true;continue; }
    if(ch==='"'||ch==="'"){quote=ch;started=true;continue;}
    if(/\s/.test(ch)){end();continue;}
    if(/[;&|<>`$()]/.test(ch))throw new Error('invalid-arguments');
    word+=ch;started=true;
  }
  if(quote)throw new Error('invalid-arguments');end();return result;
}
function flag(args,name) {
  const indexes=args.flatMap((arg,index)=>arg===name?[index]:[]);
  if(indexes.length!==1||!args[indexes[0]+1]||args[indexes[0]+1].startsWith('-'))throw new Error('invalid-arguments');
  return args[indexes[0]+1];
}
function statKey(path,stat) { return identity([path,stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs,stat.mode]); }
async function binaryIdentity(path,developerRoot,signal) {
  cancelled(signal);const canonical=await realpath(path);
  if(!inside(developerRoot,canonical))throw new Error('external-settings');
  const stat=await lstat(canonical);
  if(!stat.isFile()||!(stat.mode&0o111)||stat.size>1024*1024*1024)throw new Error('invalid-toolchain');
  const key=statKey(canonical,stat);let digest=binaryHashes.get(key);
  if(!digest) {
    const fd=await open(canonical,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),hasher=createHash('sha256'),buffer=Buffer.alloc(1024*1024);
    try { if(statKey(canonical,await fd.stat())!==key)throw new Error('stale');let position=0;while(true){cancelled(signal);const {bytesRead}=await fd.read(buffer,0,buffer.length,position);if(!bytesRead)break;hasher.update(buffer.subarray(0,bytesRead));position+=bytesRead;if(position>stat.size)throw new Error('stale');}if(statKey(canonical,await fd.stat())!==key)throw new Error('stale');digest=hasher.digest('hex'); }
    finally { await fd.close(); }
    if(binaryHashes.size>16)binaryHashes.clear();binaryHashes.set(key,digest);
  }
  return {path:canonical,signature:key,digest};
}
async function toolchainIdentity(target,signal) {
  const match=/^(.*\/Contents\/Developer)\/Toolchains\/[^/]+\.xctoolchain\/usr\/bin\/swiftc$/.exec(target.compilerPath);
  if(!match)throw new Error('invalid-toolchain');
  const developerRoot=await realpath(match[1]);
  const compiler=await binaryIdentity(target.compilerPath,developerRoot,signal);
  const server=await binaryIdentity(target.sourcekitPath,developerRoot,signal);
  const sdk=await realpath(target.sdkPath);
  if(!inside(developerRoot,sdk))throw new Error('external-settings');
  const settings=await regularFile(sdk,join(sdk,'SDKSettings.json'),signal);
  return {fingerprint:hash(identity({developerRoot,compiler,server,sdk,settings:hash(settings)})),developerRoot};
}

async function extractTargets(build,root,signal) {
  if(!build.artifacts||build.stdout.length>2*1024*1024)throw new Error('source-limit');
  if(!build.stdout.includes('builtin-SwiftDriver -- '))throw new Error('no-swift-settings');
  const derivedData=await realpath(build.artifacts.derivedData),derivedAlias=resolve(build.artifacts.derivedData);
  const artifactRoot=await realpath(build.artifacts.directory);
  if(!inside(artifactRoot,derivedData)||inside(root,artifactRoot))throw new Error('external-settings');
  const lines=build.stdout.split('\n'),targets=[];let header;
  for(const line of lines) {
    cancelled(signal);
    if(line.startsWith('SwiftDriver ')) {
      const m=/^SwiftDriver (.+?) normal ([\w-]+) com\.apple\.xcode\.tools\.swift\.compiler \(in target '([^']+)' from project '([^']+)'\)$/.exec(line);
      header=m?{architecture:m[2],name:m[3],projectName:m[4]}:undefined;continue;
    }
    const command=line.trim().startsWith('builtin-SwiftDriver -- ')?line.trim().slice('builtin-SwiftDriver -- '.length):null;
    if(!command)continue;
    if(!header)throw new Error('invalid-arguments');
    const raw=splitArguments(command),compilerPath=raw[0],args=[];
    for(const arg of raw) {
      if(arg.startsWith('@')) {
        const path=arg.slice(1);if(!path.endsWith('.SwiftFileList')||!isAbsolute(path)||![derivedData,derivedAlias].some(base=>inside(base,path)))throw new Error('external-settings');
        const base=inside(derivedData,path)?derivedData:derivedAlias;
        const canonical=join(derivedData,relative(base,path));
        const file=await regularFile(derivedData,canonical,signal,1024*1024),sources=splitArguments(file.toString('utf8'));
        if(!sources.length||sources.some(path=>!path.endsWith('.swift')))throw new Error('invalid-arguments');
        args.push(...sources);
      } else args.push(arg);
      if(args.length>LIMITS.arguments)throw new Error('source-limit');
    }
    if(args.some(arg=>/^-?(?:load-plugin|external-plugin|plugin-path|load-pass-plugin|fplugin|load$)/.test(arg)))throw new Error('unsupported-plugin');
    const moduleName=flag(args,'-module-name'),sdkPath=flag(args,'-sdk'),targetTriple=flag(args,'-target'),workingDirectory=flag(args,'-working-directory');
    if(!targetTriple.startsWith(`${header.architecture}-`)||!targetTriple.endsWith('-simulator')||await realpath(workingDirectory)!==root)throw new Error('invalid-arguments');
    const observedSources=[...new Set(args.filter(arg=>!arg.startsWith('-')&&arg.endsWith('.swift')))];
    if(!observedSources.length)throw new Error('no-swift-settings');
    const sourcePathAliases=[];
    for(const path of observedSources) {
      if(!isAbsolute(path))throw new Error('source-outside-root');
      const canonical=await realpath(path);
      if(!inside(root,canonical)||!isXcodeSourceInput(relative(root,canonical).split(sep).join('/')))throw new Error('source-outside-root');
      await regularFile(root,canonical,signal);
      sourcePathAliases.push({observed:path,canonical});
    }
    // Xcode emits /tmp source paths even when invoked with /private/tmp. The
    // database file, source argv and LSP document URI must share one identity.
    const aliases=new Map(sourcePathAliases.map(item=>[item.observed,item.canonical]));
    for(let index=0;index<args.length;index++)if(aliases.has(args[index]))args[index]=aliases.get(args[index]);
    args[args.indexOf('-working-directory')+1]=root;
    const sourcePaths=[...new Set(sourcePathAliases.map(item=>item.canonical))];
    const target={...header,moduleName,compilerPath,sourcekitPath:join(dirname(compilerPath),'sourcekit-lsp'),sdkPath,targetTriple,workingDirectory:root,sourcePaths,sourcePathAliases,compilerArguments:args};
    const toolchain=await toolchainIdentity(target,signal);
    const pathFlags=new Set(['-I','-F','-Fsystem','-iquote','-isystem','-iframework','-resource-dir','-vfsoverlay','-ivfsoverlay','-ivfsstatcache','-import-objc-header','-sdk','-working-directory','-module-cache-path','-fmodules-cache-path','-fmodule-map-file','-fmodule-file','-swift-module-file','-explicit-swift-module-map-file']);
    const flattened=args.filter(argument=>!['-Xcc','-Xfrontend','-Xllvm'].includes(argument));
    for(const [index,argument] of flattened.entries()) {
      const equals=argument.indexOf('='),joinedFlag=equals>0?argument.slice(0,equals):'';
      let path=pathFlags.has(flattened[index-1])?argument:pathFlags.has(joinedFlag)?argument.slice(equals+1):argument.startsWith('/')?argument:!pathFlags.has(argument)?/^-(?:iquote|isystem|I|F)(.+)$/.exec(argument)?.[1]:null;
      if(path&&['-fmodule-file','-swift-module-file'].includes(pathFlags.has(joinedFlag)?joinedFlag:flattened[index-1]))path=path.replace(/^[A-Za-z_][\w.]*=/,'');
      if(path) {
        const permitted=[root,derivedData,derivedAlias,toolchain.developerRoot],absolute=resolve(root,path);
        if(!permitted.some(base=>inside(base,absolute))) {
          const canonical=await realpath(absolute).catch(()=>null);
          if(!canonical||!permitted.some(base=>inside(base,canonical)))throw new Error('external-settings');
        }
      }
    }
    target.toolchainFingerprint=toolchain.fingerprint;
    target.id=hash(identity([target.projectName,target.name,target.moduleName,target.architecture,target.targetTriple,target.compilerArguments]));
    if(targets.some(item=>item.name===target.name&&item.projectName===target.projectName&&item.architecture===target.architecture))throw new Error('ambiguous-settings');
    targets.push(target);if(targets.length>LIMITS.targets)throw new Error('source-limit');header=undefined;
  }
  if(!targets.length)throw new Error('no-swift-settings');
  return targets.sort((a,b)=>`${a.projectName}/${a.name}/${a.architecture}`.localeCompare(`${b.projectName}/${b.name}/${b.architecture}`,'en'));
}

export async function prepareXcodeLanguageSettings({root,trusted,catalog,destinationId,signal,runner}) {
  const result={status:'unavailable',root:typeof root==='string'?root:'',projectPath:catalog?.projectPath||'',scheme:catalog?.selectedScheme||'',destination:null,build:null,sourceFingerprint:null,configurationFingerprint:null,targets:[]};
  if(!trusted)return {...result,reason:'Trust this workspace before building Swift editor settings.'};
  try {
    cancelled(signal);const before=await readXcodeLanguageConfigurationFingerprint(root,{signal});
    if(!before)throw new Error(signal?.aborted?'cancelled':'invalid-root');
    const build=await runXcodeOperation({root,trusted,catalog,destinationId,action:'build',signal,...(runner?{runner}:{})});
    result.build=build;result.destination=build.destination;result.sourceFingerprint=build.endFingerprint;
    if(build.status!=='passed'||!build.sourceCurrent)return {...result,status:build.status==='stale'?'stale':build.status==='cancelled'?'cancelled':'unavailable',reason:build.reason||'Swift settings require a successful, source-current build. Open its build output and retry.'};
    result.root=await realpath(root);
    result.targets=await extractTargets(build,result.root,signal);
    const after=await readXcodeLanguageConfigurationFingerprint(result.root,{signal});
    cancelled(signal);
    if(!after||before!==after||await readXcodeSourceFingerprint(result.root,{signal})!==build.inputFingerprint)throw new Error('stale');
    result.configurationFingerprint=after;result.status='ready';
    preparations.set(result,identity(result));return result;
  } catch(error) { return {...result,...failure(error),targets:[]}; }
}

async function requireCurrentConfiguration(root,expected,signal) {
  const current=await readXcodeLanguageConfigurationFingerprint(root,{signal});cancelled(signal);
  if(current!==expected)throw new Error('stale');
}

export async function createXcodeCompilationDatabase({preparation,targetId,signal}) {
  let directory;
  try {
    cancelled(signal);
    if(!preparation||preparations.get(preparation)!==identity(preparation)||preparation.status!=='ready')throw new Error('invalid-preparation');
    const target=preparation.targets.find(item=>item.id===targetId);
    if(!target)throw new Error('invalid-target');
    await requireCurrentConfiguration(preparation.root,preparation.configurationFingerprint,signal);
    const sourceFingerprint=await readXcodeSourceFingerprint(preparation.root,{signal});cancelled(signal);
    if(sourceFingerprint!==preparation.sourceFingerprint)throw new Error('stale');
    if((await toolchainIdentity(target,signal)).fingerprint!==target.toolchainFingerprint)throw new Error('stale');
    directory=await realpath(await mkdtemp(join(tmpdir(),'foundation-swift-language-')));await chmod(directory,0o700);
    const rowBytes=Buffer.byteLength(JSON.stringify({directory:target.workingDirectory,file:'',arguments:target.compilerArguments}));
    if(target.sourcePaths.reduce((total,file)=>total+rowBytes+Buffer.byteLength(JSON.stringify(file))+1,3)>LIMITS.fileBytes)throw new Error('source-limit');
    const entries=target.sourcePaths.map(file=>({directory:target.workingDirectory,file,arguments:[...target.compilerArguments]}));
    const content=JSON.stringify(entries)+'\n',compilationDatabasePath=join(directory,'compile_commands.json');
    await writeFile(compilationDatabasePath,content,{flag:'wx',mode:0o600});cancelled(signal);
    await requireCurrentConfiguration(preparation.root,preparation.configurationFingerprint,signal);
    const configuration={workspaceRoot:directory,compilationDatabasePath,root:preparation.root,sourcePaths:[...target.sourcePaths],target:structuredClone(target),destination:structuredClone(preparation.destination),projectPath:preparation.projectPath,scheme:preparation.scheme,sourceFingerprint:preparation.sourceFingerprint,configurationFingerprint:preparation.configurationFingerprint,settingsFingerprint:hash(identity([target,preparation.configurationFingerprint])),buildId:preparation.build.id};
    configurations.set(configuration,{identity:identity(configuration),directory,contentHash:hash(content)});
    return {status:'ready',configuration};
  } catch(error) { if(directory)await rm(directory,{recursive:true,force:true}).catch(()=>{});return failure(error); }
}

export function isXcodeLanguageConfiguration(configuration) {
  try { return Boolean(configuration&&configurations.get(configuration)?.identity===identity(configuration)); } catch { return false; }
}
export async function validateXcodeLanguageConfiguration(configuration,options={}) {
  try {
    cancelled(options.signal);
    if(!isXcodeLanguageConfiguration(configuration))throw new Error('invalid-configuration');
    await requireCurrentConfiguration(configuration.root,configuration.configurationFingerprint,options.signal);
    if((await toolchainIdentity(configuration.target,options.signal)).fingerprint!==configuration.target.toolchainFingerprint)throw new Error('stale');
    const data=await regularFile(configuration.workspaceRoot,configuration.compilationDatabasePath,options.signal);
    if(hash(data)!==configurations.get(configuration).contentHash)throw new Error('stale');
    cancelled(options.signal);return {status:'ready'};
  } catch(error) { return failure(error); }
}
export async function disposeXcodeCompilationDatabase(configuration) {
  const owned=configurations.get(configuration);if(!owned)return;
  configurations.delete(configuration);await rm(owned.directory,{recursive:true,force:true});
}
