import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdtemp, open, opendir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const LIMITS = Object.freeze({ entries: 4096, depth: 16, bytes: 64 * 1024 * 1024, fileBytes: 8 * 1024 * 1024, projects: 32 });
const SKIP = new Set(['.git', '.build', '.next', '.expo', '.DS_Store', 'node_modules', 'Pods', 'build', 'dist', 'artifacts', 'DerivedData', '.upstream', 'xcuserdata']);
const FLAGS = ['-disableAutomaticPackageResolution', '-onlyUsePackageVersionsFromResolvedFile', '-skipPackageUpdates', '-hideShellScriptEnvironment'];
const catalogs = new WeakMap();
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`);
const validText = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const isCancelled = signal => Boolean(signal?.aborted);
const limits = ['Source identity covers saved files in the selected folder, excluding build products, caches, user-specific Xcode state and internal project workspaces. External SDKs, compiler state and external files are not source-verified.', 'Xcode discovery may evaluate project settings. Build and Test run trusted project code only after an explicit action.', 'This integration supports local projects without Swift package references. Native previews, source mapping and runtime inspection remain separate capabilities.'];

export function isXcodeSourceInput(path) {
  if (typeof path !== 'string' || !path || path.length > 4096 || isAbsolute(path) || path.includes('\\')) return false;
  const parts = path.split('/');
  if (parts.length > LIMITS.depth + 1 || parts.some(p => !p || p === '.' || p === '..' || SKIP.has(p))) return false;
  return !parts.some((part, i) => part === 'project.xcworkspace' && i > 0 && parts[i - 1].endsWith('.xcodeproj'));
}

async function readFile(root, path, signal, remaining) {
  const full = resolve(root, path);
  if (!inside(root, full) || full === root || isCancelled(signal)) throw new Error(isCancelled(signal) ? 'cancelled' : 'invalid-path');
  let cursor = root;
  for (const [i, part] of relative(root, full).split(sep).entries()) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink() || (cursor === full ? !stat.isFile() : !stat.isDirectory())) throw new Error('linked-or-special-input');
  }
  if (await realpath(full) !== full) throw new Error('linked-or-special-input');
  const fd = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat();
    if (!before.isFile()) throw new Error('linked-or-special-input');
    if (before.size > LIMITS.fileBytes || before.size > remaining) throw new Error('source-limit');
    const data = Buffer.alloc(before.size + 1);
    let bytes = 0;
    while (bytes < data.length) {
      const result = await fd.read(data, bytes, data.length - bytes, bytes);
      bytes += result.bytesRead;
      if (!result.bytesRead) break;
      if (isCancelled(signal)) throw new Error('cancelled');
    }
    const after = await fd.stat();
    if (bytes !== before.size || after.size !== before.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || await realpath(full) !== full) throw new Error('source-changed');
    return data.subarray(0, bytes);
  } finally { await fd.close(); }
}

async function snapshot(rootInput, signal) {
  const root = typeof rootInput === 'string' && isAbsolute(rootInput) ? resolve(rootInput) : '';
  const result = { root, canonicalRoot: '', fingerprint: null, projects: [], error: undefined, packageReferences: false, unsupportedReferences: false };
  try {
    if (!root) throw new Error('invalid-root');
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('invalid-root');
    result.canonicalRoot = await realpath(root);
    const records = [];
    let entries = 0;
    let bytes = 0;
    async function visit(path, depth) {
      if (isCancelled(signal)) throw new Error('cancelled');
      const full = path ? join(result.canonicalRoot, path) : result.canonicalRoot;
      if (await realpath(full) !== full) throw new Error('linked-or-special-input');
      const directory = await opendir(full);
      const children = [];
      try {
        for await (const item of directory) {
          if (++entries > LIMITS.entries) throw new Error('source-limit');
          children.push(item);
        }
      } finally { await directory.close().catch(() => {}); }
      children.sort((a,b) => a.name.localeCompare(b.name, 'en'));
      for (const item of children) {
        if (isCancelled(signal)) throw new Error('cancelled');
        const child = path ? `${path}/${item.name}` : item.name;
        if (SKIP.has(item.name) || (item.name === 'project.xcworkspace' && path.endsWith('.xcodeproj'))) continue;
        if (item.isSymbolicLink() || (!item.isDirectory() && !item.isFile())) throw new Error('linked-or-special-input');
        if (item.isDirectory()) {
          if (depth >= LIMITS.depth) throw new Error('source-limit');
          records.push([`${child}/`, 'directory']);
          if (/\.(?:xcodeproj|xcworkspace)$/.test(item.name)) {
            if (result.projects.length >= LIMITS.projects) throw new Error('source-limit');
            result.projects.push({ path: child, name: item.name.replace(/\.(?:xcodeproj|xcworkspace)$/, ''), kind: item.name.endsWith('.xcodeproj') ? 'project' : 'workspace' });
          }
          await visit(child, depth + 1);
        } else {
          const data = await readFile(result.canonicalRoot, child, signal, LIMITS.bytes - bytes);
          bytes += data.length;
          records.push([child, hash(data)]);
          if (item.name === 'project.pbxproj') {
            const text = data.toString('utf8');
            if (/XC(?:Remote|Local)SwiftPackageReference/.test(text)) result.packageReferences = true;
            // Cross-project references can introduce dependencies outside this source snapshot.
            if (/projectReferences\s*=/.test(text)) result.unsupportedReferences = true;
          }
          if (item.name === 'contents.xcworkspacedata' && path.endsWith('.xcworkspace')) {
            const text = data.toString('utf8');
            if (/<Group\b/.test(text)) result.unsupportedReferences = true;
            const refs = [...text.matchAll(/<FileRef\b[^>]*\blocation\s*=\s*["']([^"']*)["']/g)];
            if ((text.match(/<FileRef\b/g) || []).length !== refs.length) result.unsupportedReferences = true;
            for (const match of refs) {
              const location = match[1];
              const ref = /^(?:group|container):([^&<>]+\.xcodeproj)$/.exec(location);
              const resolved = ref && resolve(result.canonicalRoot, dirname(path), ref[1]);
              if (!resolved || !inside(result.canonicalRoot, resolved)) result.unsupportedReferences = true;
              else {
                const target = relative(result.canonicalRoot, resolved).split(sep).join('/');
                // Metadata presence is checked after the complete bounded scan below.
                records.push([`workspace-ref:${child}:${target}`, 'project-reference']);
              }
            }
          }
        }
      }
    }
    await visit('', 0);
    for (const project of result.projects) {
      const marker = `${project.path}/${project.kind === 'project' ? 'project.pbxproj' : 'contents.xcworkspacedata'}`;
      if (!records.some(([path]) => path === marker)) throw new Error('missing-project-data');
    }
    for (const [path] of records) {
      if (path.startsWith('workspace-ref:')) {
        const target = path.slice(path.indexOf(':', 'workspace-ref:'.length) + 1);
        if (!result.projects.some(project => project.kind === 'project' && project.path === target)) result.unsupportedReferences = true;
      }
    }
    result.fingerprint = hash(JSON.stringify(records.sort(([a],[b]) => a.localeCompare(b,'en'))));
    result.projects.sort((a,b) => a.path.localeCompare(b.path,'en'));
  } catch (error) { result.error = error?.message || 'unavailable'; result.fingerprint = null; result.projects = []; }
  return result;
}

function snapshotReason(error) {
  if (error === 'cancelled') return 'Xcode inspection was cancelled.';
  if (error === 'source-limit') return 'Source inspection exceeded 4,096 entries, 16 directory levels, 8 MiB per file or 64 MiB total. Open a smaller project folder.';
  if (error === 'linked-or-special-input') return 'The selected folder contains linked or special inputs. Open a self-contained folder with regular source files.';
  if (error === 'source-changed') return 'Source changed during inspection. Save the project and discover it again.';
  if (error === 'missing-project-data') return 'An Xcode project or workspace is missing its required metadata. Repair it in Xcode and retry.';
  return 'The selected local project folder could not be read. Reopen an accessible folder and retry.';
}

export async function readXcodeSourceFingerprint(root, options = {}) {
  return (await snapshot(root, options.signal)).fingerprint;
}

export async function discoverXcodeProjects({ root, trusted, signal }) {
  const base = { schemaVersion: 1, root: typeof root === 'string' ? root : '', checkedAt: now(), status: 'unavailable', inputFingerprint: null, projects: [], limitations: [...limits] };
  if (!trusted) return { ...base, reason: 'Trust this workspace before inspecting Xcode projects.' };
  const current = await snapshot(root, signal);
  if (current.error) return { ...base, status: current.error === 'cancelled' ? 'cancelled' : current.error === 'source-changed' ? 'stale' : 'unavailable', reason: snapshotReason(current.error) };
  if (!current.projects.length) return { ...base, inputFingerprint: current.fingerprint, reason: 'No Xcode project or workspace was found in this folder.' };
  return { ...base, status: 'complete', inputFingerprint: current.fingerprint, projects: current.projects };
}

function processRequest(args, cwd, timeoutMs = 30_000, maxOutputBytes = 1024 * 1024) {
  return { tool: 'xcodebuild', args, cwd, timeoutMs, maxOutputBytes };
}
function projectArgs(project, root) { return [project.kind === 'workspace' ? '-workspace' : '-project', join(root, project.path)]; }
function parseJSON(text) {
  try { return JSON.parse(text); } catch {
    const start = text.indexOf('{'); const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
    return null;
  }
}
function parseDestinations(text) {
  const available = text.split(/(?:Available destinations for|Destinations compatible with) (?:the )?[^\n]*:/i)[1]?.split(/(?:Ineligible destinations|Destinations incompatible with)/i)[0] || '';
  const destinations = new Map();
  for (const line of available.split('\n').slice(0, 512)) {
    const fields = Object.fromEntries([...line.matchAll(/(?:\{|,)\s*(platform|id|OS|name|error):\s*([^,}]+)/g)].map(match => [match[1], match[2].trim()]));
    if (fields.platform !== 'iOS Simulator' || fields.error || !validText(fields.name)) continue;
    if (/placeholder/i.test(fields.id || '') && fields.name === 'Any iOS Simulator Device') {
      destinations.set('generic-ios-simulator', { id: 'generic-ios-simulator', label: 'Any iOS Simulator Device · build only', platform: 'iOS Simulator', kind: 'generic', testEligible: false });
    } else if (/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(fields.id || '')) {
      destinations.set(fields.id, { id: fields.id, label: `${fields.name}${validText(fields.OS) ? ` · iOS ${fields.OS}` : ''}`, platform: 'iOS Simulator', kind: 'simulator', testEligible: true });
    }
    if (destinations.size >= 128) break;
  }
  return [...destinations.values()];
}
function failureReason(result, verb) {
  return result.status === 'cancelled' ? `${verb} was cancelled.` : result.status === 'timeout' ? `${verb} did not finish within its time limit.` : result.status === 'output-limit' ? `${verb} exceeded its output limit.` : `${verb} failed. Open the diagnostic output, resolve the Xcode error and retry.`;
}
function catalogIdentity(catalog) { return JSON.stringify({root:catalog.root,projectPath:catalog.projectPath,inputFingerprint:catalog.inputFingerprint,selectedScheme:catalog.selectedScheme,schemes:catalog.schemes,destinations:catalog.destinations,status:catalog.status}); }

export async function inspectXcodeProject({ root, trusted, projectPath, scheme, signal, runner = runXcodeProcess }) {
  const discovery = await discoverXcodeProjects({root,trusted,signal});
  const base = { ...discovery, projectPath: typeof projectPath === 'string' ? projectPath : '', schemes: [], destinations: [], languageTooling: { status: 'unavailable', detail: 'Swift language tooling has not been checked. Editor language-server integration is not verified.' } };
  if (discovery.status !== 'complete') return base;
  const project = discovery.projects.find(p => p.path === projectPath);
  if (!project) return { ...base, status: 'unavailable', reason: 'Choose a project from the current discovery result.' };
  const before = await snapshot(root,signal);
  if (before.error || before.fingerprint !== discovery.inputFingerprint) return { ...base, status: 'stale', reason: 'Source changed before Xcode discovery. Discover again.' };
  if (before.unsupportedReferences) return { ...base, status:'unavailable', reason:'This workspace contains external, grouped or cross-project references that are not supported by the bounded local workflow. Open its self-contained Xcode project folder instead.' };
  if (before.packageReferences) return { ...base, status: 'unavailable', reason: 'Swift package projects require offline dependency support that is not available yet. This check does not resolve or download dependencies.' };
  let list;
  try { list = await runner(processRequest([...projectArgs(project, before.canonicalRoot), '-list', '-json', ...FLAGS], before.canonicalRoot), {signal}); }
  catch { list = {status:'failed',stdout:'',stderr:'',exitCode:null}; }
  base.diagnostic = list;
  if (list.status !== 'passed') return { ...base, status: list.status === 'cancelled' ? 'cancelled' : 'unavailable', reason: failureReason(list,'Project discovery') };
  const json = parseJSON(list.stdout);
  const rawSchemes = (project.kind === 'workspace' ? json?.workspace : json?.project)?.schemes;
  if (!Array.isArray(rawSchemes) || rawSchemes.length > 64 || rawSchemes.some(s => !validText(s))) return { ...base, status: 'unavailable', reason: 'Xcode returned missing or invalid scheme data. Share a scheme in Xcode and retry.' };
  base.schemes = [...new Set(rawSchemes)].sort();
  if (scheme !== undefined && !base.schemes.includes(scheme)) return { ...base, status:'unavailable',reason:'Choose a scheme from the current Xcode result.' };
  let sourcekit;
  try { sourcekit = await runner({tool:'sourcekit-lsp',args:[],cwd:'/',timeoutMs:10_000,maxOutputBytes:16 * 1024},{signal}); }
  catch { sourcekit = {status:'failed',stdout:'',stderr:'',exitCode:null}; }
  if (isCancelled(signal) || sourcekit.status === 'cancelled') return { ...base, status:'cancelled',reason:'Xcode discovery was cancelled.' };
  base.languageTooling = sourcekit.status === 'passed' && /^\/[^\n\r]+\/sourcekit-lsp\s*$/.test(sourcekit.stdout) ? {status:'available',detail:'The selected Xcode toolchain contains SourceKit-LSP. Editor completion, navigation and diagnostics are not integrated or verified by this check.'} : {status:sourcekit.status === 'failed' ? 'failed':'unavailable',detail:'SourceKit-LSP could not be located in the selected Xcode toolchain. Select a full Xcode installation and retry.'};
  if (scheme !== undefined) {
    base.selectedScheme = scheme;
    let destinations;
    try { destinations = await runner(processRequest([...projectArgs(project,before.canonicalRoot),'-scheme',scheme,'-showdestinations',...FLAGS],before.canonicalRoot,45_000),{signal}); }
    catch { destinations = {status:'failed',stdout:'',stderr:'',exitCode:null}; }
    base.diagnostic = destinations;
    if (destinations.status !== 'passed') return { ...base, status:destinations.status === 'cancelled'?'cancelled':'unavailable',reason:failureReason(destinations,'Destination discovery') };
    base.destinations = parseDestinations(destinations.stdout);
    if (base.destinations.length === 128) base.limitations.push('Destination discovery is capped at 128 eligible iOS Simulators. Additional destinations are omitted.');
    base.diagnostic = { ...destinations, stdout: base.destinations.map(item => `${item.label} · ${item.id}`).join('\n') };
    if (!base.destinations.length) base.reason = 'Xcode reported no eligible iOS Simulator destinations. Install a compatible iOS runtime in Xcode and discover again.';
  }
  const after = await snapshot(root,signal);
  base.endFingerprint = after.fingerprint;
  if (isCancelled(signal)) return { ...base,status:'cancelled',reason:'Xcode discovery was cancelled.' };
  if (after.error || after.fingerprint !== before.fingerprint) return { ...base,status:'stale',reason:'Source changed during Xcode discovery. Save the project and discover again.' };
  base.status = 'complete';
  catalogs.set(base,catalogIdentity(base));
  return base;
}

export async function runXcodeOperation({ root, trusted, catalog, destinationId, action, signal, runner = runXcodeProcess, timeoutMs }) {
  const result = {schemaVersion:1,id:randomUUID(),root:typeof root==='string'?root:'',projectPath:catalog?.projectPath || '',scheme:catalog?.selectedScheme || '',destination:null,action:action==='test'?'test':'build',status:'unavailable',startedAt:now(),finishedAt:now(),inputFingerprint:catalog?.inputFingerprint || null,endFingerprint:null,sourceCurrent:false,stdout:'',stderr:'',exitCode:null,artifacts:null};
  const finish = (updates={}) => ({...result,...updates,finishedAt:now()});
  if (!trusted) return finish({reason:'Trust this workspace before running Xcode.'});
  if (isCancelled(signal)) return finish({status:'cancelled',reason:'Xcode action was cancelled.'});
  if (!['build','test'].includes(action) || !catalog || catalogs.get(catalog)!==catalogIdentity(catalog) || catalog.status !== 'complete' || catalog.root!==root || !catalog.selectedScheme || !catalog.schemes.includes(catalog.selectedScheme)) return finish({reason:'Discover the project and select a current scheme and destination before running Xcode.'});
  const destination = catalog.destinations.find(d=>d.id===destinationId);
  if (!destination || (action==='test' && !destination.testEligible)) return finish({reason:action==='test'?'Tests require a specific eligible iOS Simulator. Choose one and retry.':'Choose a destination from the current Xcode result.'});
  result.destination={...destination};
  const before=await snapshot(root,signal);
  result.endFingerprint=before.fingerprint;
  if (isCancelled(signal)) return finish({status:'cancelled',reason:'Xcode action was cancelled.'});
  if (before.error || before.fingerprint!==catalog.inputFingerprint) return finish({status:'stale',reason:'Source changed after discovery. Save the project and discover again.'});
  if (before.unsupportedReferences) return finish({reason:'External, grouped or cross-project references require a self-contained project folder.'});
  if (before.packageReferences) return finish({reason:'Swift package dependencies are unsupported by this local build workflow.'});
  const project=before.projects.find(p=>p.path===catalog.projectPath);
  if (!project) return finish({status:'stale',reason:'The selected Xcode project is no longer available. Discover again.'});
  let directory;
  try { directory=await mkdtemp(join(tmpdir(),'foundation-xcode-'));await chmod(directory,0o700); }
  catch { return finish({reason:'A private build-output directory could not be created. Free local storage and retry.'}); }
  result.artifacts={directory,derivedData:join(directory,'DerivedData'),resultBundle:join(directory,`${action}.xcresult`)};
  const args=[...projectArgs(project,before.canonicalRoot),'-scheme',catalog.selectedScheme,'-configuration','Debug','-destination',destination.kind==='generic'?'generic/platform=iOS Simulator':`platform=iOS Simulator,id=${destination.id}`,'-destination-timeout','30','-derivedDataPath',result.artifacts.derivedData,'-resultBundlePath',result.artifacts.resultBundle,...FLAGS,'CODE_SIGNING_ALLOWED=NO','CODE_SIGNING_REQUIRED=NO','COMPILER_INDEX_STORE_ENABLE=NO',...(action==='test'?['-parallel-testing-enabled','NO']:[]),action];
  let executed;
  try { executed=await runner(processRequest(args,before.canonicalRoot,Math.min(action==='test'?240_000:180_000,Math.max(10,timeoutMs || (action==='test'?240_000:180_000))),2 * 1024 * 1024),{signal}); }
  catch { executed={status:'failed',stdout:'',stderr:'',exitCode:null,reason:'Xcode could not be started.'}; }
  const after=await snapshot(root,signal?.aborted?undefined:signal);
  result.endFingerprint=after.fingerprint;
  result.sourceCurrent=Boolean(after.fingerprint && after.fingerprint===before.fingerprint);
  const status=isCancelled(signal)?'cancelled':executed.status;
  const updates={status,stdout:executed.stdout || '',stderr:executed.stderr || '',exitCode:Number.isInteger(executed.exitCode)?executed.exitCode:null};
  if (!result.sourceCurrent && status!=='cancelled') return finish({...updates,status:'stale',reason:`Source changed during ${action}. The recorded process exit code belongs to the earlier saved source; discover and run again.`,recovery:'Save the project, discover again, then repeat the action.'});
  if (status!=='passed') return finish({...updates,reason:failureReason(executed,action==='test'?'Tests':'Build'),recovery:status==='cancelled'?'Choose Build or Test when ready.':'Review the output, fix the reported Xcode or Simulator problem, then retry.'});
  return finish(updates);
}

function validRequest(request) {
  if (!request || !isAbsolute(request.cwd || '') || !Array.isArray(request.args) || request.args.some(arg=>typeof arg!=='string'||arg.length>8192||/[\u0000-\u001f\u007f]/.test(arg))) return false;
  if (request.tool==='sourcekit-lsp') return request.args.length===0 && request.cwd==='/';
  if (request.tool!=='xcodebuild') return false;
  const args=request.args;
  if (!['-project','-workspace'].includes(args[0]) || !isAbsolute(args[1]||'') || !inside(resolve(request.cwd),resolve(args[1]))) return false;
  const equal=expected=>JSON.stringify(args)===JSON.stringify(expected);
  const prefix=args.slice(0,2);
  if(equal([...prefix,'-list','-json',...FLAGS]))return true;
  if(args[2]!=='-scheme'||!validText(args[3]))return false;
  if(equal([...prefix,'-scheme',args[3],'-showdestinations',...FLAGS]))return true;
  const action=args.at(-1),destination=args[7],derivedData=args[11],resultBundle=args[13];
  if(!['build','test'].includes(action)||!(destination==='generic/platform=iOS Simulator'||/^platform=iOS Simulator,id=[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(destination||'')))return false;
  if(action==='test'&&destination==='generic/platform=iOS Simulator')return false;
  if(!isAbsolute(derivedData||'')||!isAbsolute(resultBundle||'')||dirname(derivedData)!==dirname(resultBundle)||!basenameSafe(dirname(derivedData))||!inside(resolve(tmpdir()),resolve(derivedData)))return false;
  if(derivedData!==join(dirname(derivedData),'DerivedData')||resultBundle!==join(dirname(derivedData),`${action}.xcresult`))return false;
  return equal([...prefix,'-scheme',args[3],'-configuration','Debug','-destination',destination,'-destination-timeout','30','-derivedDataPath',derivedData,'-resultBundlePath',resultBundle,...FLAGS,'CODE_SIGNING_ALLOWED=NO','CODE_SIGNING_REQUIRED=NO','COMPILER_INDEX_STORE_ENABLE=NO',...(action==='test'?['-parallel-testing-enabled','NO']:[]),action]);
}
function basenameSafe(path) { return /^foundation-xcode-[A-Za-z0-9]+$/.test(path.split(sep).at(-1)||''); }

/** Fixed Xcode tools, clean environment, no shell; cancellation owns only this detached process group. */
export function runXcodeProcess(request, options={}) {
  const empty=status=>({status,stdout:'',stderr:'',exitCode:null});
  if(!validRequest(request))return Promise.resolve({...empty('unavailable'),reason:'Unsupported Xcode command.'});
  if(isCancelled(options.signal))return Promise.resolve(empty('cancelled'));
  if(process.platform!=='darwin'&&!options.spawnProcess)return Promise.resolve({...empty('unavailable'),reason:'Xcode requires macOS.'});
  return new Promise(resolveResult=>{
    let child,timer,killTimer,terminalTimer,stopReason,finished=false,settling=false,bytes=0;
    const stdout=[],stderr=[];
    const signal=options.signal;
    const stopGroup=type=>{try{if(child?.pid>0)process.kill(-child.pid,type);else child?.kill(type);}catch{try{child?.kill(type);}catch{}}};
    const cleanup=()=>{clearTimeout(timer);clearTimeout(killTimer);clearTimeout(terminalTimer);signal?.removeEventListener('abort',abort);};
    const finish=result=>{if(finished)return;finished=true;cleanup();resolveResult(result);};
    const output=()=>({stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')});
    const settle=result=>{if(finished||settling)return;settling=true;clearTimeout(timer);clearTimeout(killTimer);clearTimeout(terminalTimer);signal?.removeEventListener('abort',abort);let alive=false;if(child?.pid>0){try{process.kill(-child.pid,0);alive=true;}catch{}}if(!alive)return finish(result);stopGroup('SIGTERM');killTimer=setTimeout(()=>{stopGroup('SIGKILL');finish(result);},250);};
    const stop=reason=>{if(finished||stopReason)return;stopReason=reason;stopGroup('SIGTERM');killTimer=setTimeout(()=>stopGroup('SIGKILL'),250);terminalTimer=setTimeout(()=>settle({...empty(stopReason),...output()}),1500);};
    const abort=()=>stop('cancelled');
    try{
      const tool=request.tool==='sourcekit-lsp'?'/usr/bin/xcrun':'/usr/bin/xcodebuild';
      const args=request.tool==='sourcekit-lsp'?['--find','sourcekit-lsp']:[...request.args];
      child=(options.spawnProcess||spawn)(tool,args,{cwd:request.cwd,shell:false,detached:true,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C',LC_ALL:'C',...(process.env.HOME?{HOME:process.env.HOME}:{}),...(process.env.TMPDIR?{TMPDIR:process.env.TMPDIR}:{})}});
      const receive=target=>chunk=>{if(finished||stopReason)return;const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);const max=Math.min(2*1024*1024,Math.max(1024,request.maxOutputBytes||1024*1024));bytes+=data.length;if(bytes>max){stop('output-limit');return;}target.push(data);};
      child.stdout?.on('data',receive(stdout));child.stderr?.on('data',receive(stderr));
      child.once('error',()=>settle({...empty(stopReason||'failed'),...output(),reason:'Xcode could not be started.'}));
      child.once('close',(code)=>settle({...empty(stopReason||(code===0?'passed':'failed')),...output(),exitCode:Number.isInteger(code)?code:null}));
      timer=setTimeout(()=>stop('timeout'),Math.min(240_000,Math.max(10,request.timeoutMs||30_000)));
      signal?.addEventListener('abort',abort,{once:true});if(isCancelled(signal))abort();
    }catch{finish({...empty('failed'),reason:'Xcode could not be started.'});}
  });
}
