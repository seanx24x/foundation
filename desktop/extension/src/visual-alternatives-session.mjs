import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {createAlternativeWorkspaces} from './alternative-workspaces.mjs';
import {createConnectedRuntime} from './connected-runtime.mjs';
import {createRuntimeWorkspaceStore,safeScreenRoute} from './runtime-workspace-store.mjs';
import {createRuntimeReplayStore,REPLAY_REASONS} from './runtime-replay-store.mjs';
import {createRuntimeCaptureStore,inspectCapturePng} from './runtime-capture-store.mjs';
import {createCaptureFileStorage} from './runtime-capture-files.mjs';
import {validateDesignImpactCheckpoint} from '../../../server/project/change-impact.mjs';
import {createTokenProposal,listDesignTokens,validateChangeSet,changeGroupDigest,validAlternativeSourcePath,validateAlternativeGroupBasis} from '../../../server/project/proposals.mjs';

const copy=value=>structuredClone(value);
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const equal=(a,b)=>canonical(a)===canonical(b);
const hash=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hex=(value,length)=>typeof value==='string'&&new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const token=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,required,optional=[])=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const now=()=>new Date().toISOString();
const fail=(code,message)=>Object.assign(new Error(message),{name:'VisualAlternativesError',code});
const invalid=()=>fail('alternatives-invalid','Choose a current token proposal or whole source group, one saved scenario, one recipe, and supported preview conditions.');
const check=value=>{if(!value)throw invalid();};
const terminal=['completed','failed','cancelled','interrupted'];
const errorMessage='The comparison stopped. Its saved evidence is preserved; prepare a new comparison to run again.';
const storageMessage='Comparison evidence could not be saved. Retry saving; application actions will not be repeated.';
const candidateToken=value=>fields(value,['name','occurrence'])&&typeof value.name==='string'&&/^--[a-zA-Z_][a-zA-Z0-9_-]*$/.test(value.name)&&value.name.length<=200&&Number.isSafeInteger(value.occurrence)&&value.occurrence>=0;
const basisValue=value=>fields(value,['version','comparisonId','beforeHash','afterHash','baselineDigest'])&&value.version===1&&uuid(value.comparisonId)&&hex(value.beforeHash,64)&&hex(value.afterHash,64)&&hex(value.baselineDigest,64);
const isGroup=record=>record?.source?.kind==='change-set';
const fileHashes=files=>files.map(({path,before,after})=>({path,beforeHash:hash(before),afterHash:hash(after)})).sort((a,b)=>a.path.localeCompare(b.path));
const changedFiles=record=>isGroup(record)?record.source.files:[{path:record.path,beforeHash:record.beforeHash,afterHash:record.afterHash}];
const outcome=()=>({compilation:'not-recorded',assessment:'not-assessed',sourceRelationship:'unverified'});
const reasonFor=error=>error?.reason&&REPLAY_REASONS.includes(error.reason)?error.reason:error?.code==='alternatives-cancelled'?'cancelled':error?.code==='alternatives-context'?'context-changed':String(error?.code||'').includes('storage')?'storage-failed':/source|copy-changed/.test(error?.code||'')?'source-changed':error?.code==='alternatives-recipe'?'recipe-changed':'runtime-changed';
const replayReason=value=>REPLAY_REASONS.includes(value)?value:({'callback-failed':'step-failed','unit-timeout':'timeout','lease-expired':'timeout','registration-changed':'recipe-changed','progress-unavailable':'storage-failed','transport-unavailable':'transport-failed','document-hidden':'preview-changed','conditions-changed':'preview-changed','replay-unavailable':'runtime-changed'}[value]||'runtime-changed');
const normalizeIdentity=s=>({targetId:s.target?.id||'vite:dev',session:s.session,viewId:s.viewId,documentId:s.documentId,route:s.pagePath,pageVersion:s.pageVersion});
const nativeIdentity=s=>({session:s.session,viewId:s.viewId,documentId:s.documentId,route:s.pagePath,pageVersion:s.pageVersion});

// Small private JSON files use no-follow reads, pinned directory identities,
// atomic rename and revision comparison. Adapters are injectable only by the host.
function fileStorage(root,projectId,name){
 check(path.isAbsolute(root)&&token(projectId)&&/^[a-z-]+$/.test(name));
 const directory=path.join(root,'visual-alternatives',hash(projectId)),ancestors=[];
 let current=path.parse(directory).root;
 for(const part of directory.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);try{fs.mkdirSync(current,{mode:0o700});}catch(error){if(error?.code!=='EEXIST')throw error;}
  const stat=fs.lstatSync(current);check(stat.isDirectory()&&!stat.isSymbolicLink());ancestors.push([current,stat]);
 }
 const target=path.join(directory,`${name}.json`);let writing=false;
 const guard=()=>{for(const [file,original] of ancestors){const stat=fs.lstatSync(file);check(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.dev===original.dev&&stat.ino===original.ino);}const stat=fs.lstatSync(directory);check((stat.mode&0o077)===0&&(typeof process.getuid!=='function'||stat.uid===process.getuid()));};
 const read=()=>{guard();let fd;try{fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const before=fs.fstatSync(fd);check(before.isFile()&&before.nlink===1&&(before.mode&0o077)===0&&before.size<=8*1024*1024&&(typeof process.getuid!=='function'||before.uid===process.getuid()));const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd),named=fs.lstatSync(target);guard();check(before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&named.ino===after.ino&&named.dev===after.dev&&bytes.length===before.size);return JSON.parse(bytes.toString('utf8'));}catch(error){if(error?.code==='ENOENT')return undefined;throw error;}finally{if(fd!==undefined)fs.closeSync(fd);}};
 const write=async value=>{if(writing)throw fail('alternatives-storage-busy',storageMessage);writing=true;let temporary,lockHandle,lockStat;const lock=path.join(directory,`.${name}-write-lock`);try{guard();lockHandle=fs.openSync(lock,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);lockStat=fs.fstatSync(lockHandle);const previous=read();if(equal(previous,value))return;check(Number.isSafeInteger(value.revision)&&value.revision===(previous?.revision??0)+1);const bytes=Buffer.from(JSON.stringify(value));check(bytes.length<=8*1024*1024);temporary=path.join(directory,`.${name}-${randomUUID()}.tmp`);const handle=await fsp.open(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}guard();check(equal(read(),previous));await fsp.rename(temporary,target);temporary=undefined;const handleDir=await fsp.open(directory,'r');try{await handleDir.sync();}finally{await handleDir.close();}}finally{if(temporary)await fsp.unlink(temporary).catch(()=>{});if(lockHandle!==undefined){fs.closeSync(lockHandle);try{guard();const named=fs.lstatSync(lock);if(named.isFile()&&!named.isSymbolicLink()&&named.ino===lockStat.ino&&named.dev===lockStat.dev)fs.unlinkSync(lock);}catch{}}writing=false;}};
 return {read,write};
}
function validateScope(scope,projectId){
 check(fields(scope,['feature','screen','scenario','definitionRevision'])&&fields(scope.feature,['id','title','revision','paths'])&&uuid(scope.feature.id)&&text(scope.feature.title,80)&&Number.isSafeInteger(scope.feature.revision)&&scope.feature.revision>=0&&Array.isArray(scope.feature.paths)&&scope.feature.paths.length>0&&scope.feature.paths.length<=32&&new Set(scope.feature.paths).size===scope.feature.paths.length&&scope.feature.paths.every(value=>text(value,1024)&&!/[\\:]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'))&&Number.isSafeInteger(scope.definitionRevision)&&scope.definitionRevision>=0);
 const validator=createRuntimeWorkspaceStore({projectId,read:()=>({schemaVersion:1,projectId,revision:scope.definitionRevision,activeScreenId:scope.screen?.id,activeScenarioId:scope.scenario?.id,screens:[scope.screen],scenarios:[scope.scenario],runs:[]}),write:()=>{}});
 check(validator.snapshot().storage.status==='saved'&&scope.screen.featureId===scope.feature.id&&scope.scenario.screenId===scope.screen.id&&!scope.screen.archived&&!scope.scenario.archived&&scope.screen.targetId==='vite:dev');void validator.dispose();return copy(scope);
}
function validateRecipe(recipe,scope){
 check(fields(recipe,['id','title','route','fixture','steps','catalogDigest'])&&token(recipe.id)&&text(recipe.title,160)&&safeScreenRoute(recipe.route)===scope.screen.route&&fields(recipe.fixture,['id','label'])&&token(recipe.fixture.id)&&text(recipe.fixture.label,160)&&hex(recipe.catalogDigest,64)&&Array.isArray(recipe.steps)&&recipe.steps.length>=1&&recipe.steps.length<=12&&new Set(recipe.steps.map(step=>step.id)).size===recipe.steps.length&&recipe.steps.every(step=>fields(step,['id','title'])&&token(step.id)&&text(step.title,160)));
 return {id:recipe.id,title:recipe.title,route:recipe.route,fixture:copy(recipe.fixture),steps:copy(recipe.steps),catalogDigest:recipe.catalogDigest};
}
function validateRequested(value){check(object(value)&&['light','dark'].includes(value.theme)&&['system','reduce'].includes(value.motion)&&[390,768,960].includes(value.viewportWidthCss)&&value.viewportHeightCss===680&&Object.keys(value).length===4);return copy(value);}
function prepareValue(input,projectId){
 check(object(input)&&object(input.proposal));const p=input.proposal;
 check(p.projectId===projectId&&uuid(p.id)&&text(p.title,160)&&p.origin==='design'&&p.status==='proposed'&&typeof p.before==='string'&&typeof p.after==='string'&&p.before!==p.after&&Buffer.byteLength(p.before)<=256*1024&&Buffer.byteLength(p.after)<=256*1024&&!p.before.includes('\0')&&!p.after.includes('\0'));
 const impact=validateDesignImpactCheckpoint(p.designImpact,projectId),target=impact.result.target;
 check(target.kind==='token'&&target.path===p.path&&target.revision===p.baseRevision&&hash(p.before).slice(0,16)===p.baseRevision);
 const changed=listDesignTokens([{path:p.path,source:p.after,revision:hash(p.after).slice(0,16)}]).find(item=>item.name===target.name&&item.occurrence===target.occurrence);
 check(changed&&createTokenProposal({file:{path:p.path,source:p.before,revision:p.baseRevision},name:target.name,occurrence:target.occurrence,value:changed.value,projectId}).after===p.after);
 const scope=validateScope(input.scope,projectId);check(scope.feature.paths.includes(p.path)&&impact.relatedScenarios.some(row=>row.featureId===scope.feature.id&&row.screenId===scope.screen.id&&row.scenarioId===scope.scenario.id));
 check(input.captureEach===undefined||typeof input.captureEach==='boolean');
 const candidateName=input.candidateName===undefined?target.name.slice(0,80):input.candidateName;check(text(candidateName,80)&&candidateName.trim()===candidateName&&candidateToken({name:target.name,occurrence:target.occurrence}));
 return {proposal:copy(p),scope,recipe:validateRecipe(input.recipe,scope),requested:validateRequested(input.requested),captureEach:input.captureEach===true,candidateName,token:{name:target.name,occurrence:target.occurrence},designImpact:impact};
}
function groupValue(input,projectId){
 check(object(input)&&object(input.changeSet));const group=validateChangeSet(input.changeSet,projectId),scope=validateScope(input.scope,projectId);
 check(group.origin==='ai'&&group.status==='proposed'&&group.files.every(file=>file.appliedRevision===undefined&&validAlternativeSourcePath(file.path)&&scope.feature.paths.includes(file.path)&&[file.before,file.after].every(source=>!source.includes('\0')&&Buffer.from(source,'utf8').toString('utf8')===source))&&group.context.every(ref=>validAlternativeSourcePath(ref.path)&&scope.feature.paths.includes(ref.path)));
 check(group.files.reduce((n,file)=>n+Buffer.byteLength(file.before),0)<=64*1024&&group.files.reduce((n,file)=>n+Buffer.byteLength(file.after),0)<=64*1024);
 check(input.captureEach===undefined||typeof input.captureEach==='boolean');const candidateName=input.candidateName===undefined?group.title.slice(0,80).trim():input.candidateName;check(text(candidateName,80)&&candidateName.trim()===candidateName);
 return {group,scope,recipe:validateRecipe(input.recipe,scope),requested:validateRequested(input.requested),captureEach:input.captureEach===true,candidateName,source:{kind:'change-set',groupId:group.id,groupRevision:group.revision,groupDigest:changeGroupDigest(group),files:fileHashes(group.files)}};
}
function groupSourceValue(value){
 check(fields(value,['kind','groupId','groupRevision','groupDigest','files'])&&value.kind==='change-set'&&uuid(value.groupId)&&Number.isSafeInteger(value.groupRevision)&&value.groupRevision>=0&&hex(value.groupDigest,64)&&Array.isArray(value.files)&&value.files.length>=2&&value.files.length<=8&&new Set(value.files.map(file=>file.path)).size===value.files.length);
 check(value.files.every(file=>fields(file,['path','beforeHash','afterHash'])&&validAlternativeSourcePath(file.path)&&hex(file.beforeHash,64)&&hex(file.afterHash,64)&&file.beforeHash!==file.afterHash)&&equal(value.files,[...value.files].sort((a,b)=>a.path.localeCompare(b.path))));return value;
}
function manifestValue(value,projectId){
 check(fields(value,['schemaVersion','projectId','revision','records'])&&value.schemaVersion===1&&value.projectId===projectId&&Number.isSafeInteger(value.revision)&&value.revision>=0&&Array.isArray(value.records)&&value.records.length<=4&&new Set(value.records.map(record=>record.id)).size===value.records.length&&Buffer.byteLength(JSON.stringify(value))<=8*1024*1024);
 for(const record of value.records){
  const grouped=isGroup(record),sourceFields=grouped?['source']:['path','proposalId','beforeHash','afterHash'];
  check(fields(record,['id','logicalProjectId','createdAt','title',...sourceFields,'scope','recipe','requested','captureEach','status','variants'],['endedAt','reason','baselineDigest','candidate'])&&uuid(record.id)&&record.logicalProjectId===`alternative-${record.id}`&&text(record.title,160)&&Number.isFinite(Date.parse(record.createdAt))&&['preparing','ready','running',...terminal].includes(record.status)&&typeof record.captureEach==='boolean'&&Array.isArray(record.variants)&&record.variants.length===2&&record.variants[0].id==='baseline'&&record.variants[1].id==='alternative');
  validateScope(record.scope,projectId);validateRecipe(record.recipe,record.scope);validateRequested(record.requested);if(record.baselineDigest!==undefined)check(hex(record.baselineDigest,64));
  if(grouped){groupSourceValue(record.source);check(record.source.files.every(file=>record.scope.feature.paths.includes(file.path))&&record.candidate!==undefined);}
  else check(uuid(record.proposalId)&&hex(record.beforeHash,64)&&hex(record.afterHash,64)&&text(record.path,1024));
  if(record.candidate!==undefined)check(fields(record.candidate,['name',...(grouped?[]:['token']),'metadataDigest'])&&text(record.candidate.name,80)&&record.candidate.name.trim()===record.candidate.name&&(grouped||candidateToken(record.candidate.token))&&hex(record.candidate.metadataDigest,64));
  for(const variant of record.variants)check(fields(variant,['id','label','status','outcome'],['manifestDigest','runId','replayId','captureId','reason'])&&fields(variant.outcome,['compilation','assessment','sourceRelationship'],['observation','replay','capture'])&&['not-run','running',...terminal].includes(variant.status)&&variant.outcome?.compilation==='not-recorded'&&variant.outcome?.assessment==='not-assessed'&&variant.outcome?.sourceRelationship==='unverified'&&(!variant.runId||uuid(variant.runId))&&(!variant.replayId||uuid(variant.replayId))&&(!variant.captureId||uuid(variant.captureId))&&(!variant.manifestDigest||hex(variant.manifestDigest,64)));
 }
 return copy(value);
}

function comparisonDescriptor(left,right){
 const reasons=[],observedDifferences=[],leftId=left?.id||'',rightId=right?.id||'';
 if(!left||!right||leftId===rightId)return {leftId,rightId,compatible:false,reasons:['Choose two different retained candidates.'],observedDifferences};
 const side=record=>record.variants.find(item=>item.id==='alternative'),a=side(left),b=side(right);
 for(const [label,record,variant] of [['First',left,a],['Second',right,b]])if(record.status!=='completed'||variant?.status!=='completed'||variant.outcome.observation?.status!=='completed'||variant.outcome.replay?.status!=='completed')reasons.push(`${label} candidate does not have completed observation and callback evidence.`);
 if(!hex(left.baselineDigest,64)||!hex(right.baselineDigest,64)||left.baselineDigest!==right.baselineDigest)reasons.push('Saved source baselines differ.');
 if(!equal(left.scope,right.scope))reasons.push('Frozen feature, screen, or scenario definitions differ.');
 if(!equal(left.recipe,right.recipe))reasons.push('Registered recipes or catalog digests differ.');
 if(!equal(left.requested,right.requested))reasons.push('Requested viewport, app theme, or motion conditions differ.');
 const ao=a?.outcome.replay?.observed,bo=b?.outcome.replay?.observed;
 if(!ao||!bo)observedDifferences.push('Measured browser conditions are missing for one or both candidates.');
 else {
  if(ao.viewportWidthCss!==bo.viewportWidthCss||ao.viewportHeightCss!==bo.viewportHeightCss)observedDifferences.push(`Observed viewports differ: ${ao.viewportWidthCss} × ${ao.viewportHeightCss} and ${bo.viewportWidthCss} × ${bo.viewportHeightCss} CSS px.`);
  if(ao.deviceScaleFactor!==bo.deviceScaleFactor)observedDifferences.push('Observed device scale factors differ.');
  if(ao.colorSchemePreference!==bo.colorSchemePreference)observedDifferences.push('Observed browser color preferences differ.');
  if(ao.reducedMotionPreference!==bo.reducedMotionPreference)observedDifferences.push('Observed browser motion preferences differ.');
 }
 const ac=a?.outcome.capture,bc=b?.outcome.capture;
 if(!ac||!bc)observedDifferences.push('A saved image is missing for one or both candidates; request and callback evidence remain available.');
 else {
  if(ac.conditions.scrollXCss!==bc.conditions.scrollXCss||ac.conditions.scrollYCss!==bc.conditions.scrollYCss)observedDifferences.push('Captured scroll positions differ.');
  if(ac.conditions.canvasScale!==bc.conditions.canvasScale)observedDifferences.push('Captured canvas scales differ.');
 }
 return {leftId,rightId,compatible:reasons.length===0,reasons,observedDifferences};
}

/** One explicitly selected condition, two immutable source copies, sequential runtimes.
 * Neither preparation, restore nor storage retry dispatches application callbacks. */
export function createVisualAlternativesSession({storageRoot,root,projectId,nodePath=process.execPath,isCurrent=()=>true,onChange=()=>{},preview,capture,workspaces,runtimeFactory=createConnectedRuntime,storageFactory=fileStorage,captureStorageFactory=createCaptureFileStorage,connectTimeoutMs=15000}){
 check(path.isAbsolute(storageRoot)&&path.isAbsolute(root)&&token(projectId)&&typeof preview==='function');
 const copies=workspaces||createAlternativeWorkspaces({storageRoot:path.join(storageRoot,'alternative-workspaces'),root,projectId,nodePath,isCurrent});
 let cancellationEpoch=0;
 let journal,loaded=false,closing=false,inFlight,controller,liveRuntime,active,error,storage={status:'saved'},data={schemaVersion:1,projectId,revision:0,records:[]},pending=false;
 const children=new Map(),notify=()=>{try{onChange();}catch{}};
 const snapshot=()=>({...copy(data),comparisonPairs:data.records.flatMap(left=>data.records.filter(right=>right.id!==left.id).map(right=>comparisonDescriptor(left,right))),storage:{...storage},busy:!!inFlight,...(error?{error}:{}),...(active?{active:copy(active)}:{})});
 const assertOpen=()=>{if(closing)throw fail('alternatives-closed','This project has closed.');if(!loaded||storage.status!=='saved'||pending)throw fail('alternatives-storage',storageMessage);};
 async function current(guard){if(controller?.signal.aborted)throw fail('alternatives-cancelled','The comparison was stopped.');if(closing||!isCurrent())throw fail('alternatives-context','The project or source context changed.');try{if(guard&&await guard()===false)throw fail('alternatives-context','The project or source context changed.');}catch{throw fail('alternatives-context','The project or source context changed.');}if(controller?.signal.aborted)throw fail('alternatives-cancelled','The comparison was stopped.');if(closing||!isCurrent())throw fail('alternatives-context','The project or source context changed.');}
 async function persist(){pending=true;storage={status:'saving'};notify();try{await journal.write(copy(data));pending=false;storage={status:'saved'};notify();}catch{storage={status:'error',message:storageMessage};error=storageMessage;notify();throw fail('alternatives-storage',storageMessage);}}
 async function changed(){data.revision++;await persist();}
 function operate(fn){if(inFlight)return Promise.reject(fail('alternatives-busy','A comparison operation is already in progress.'));const promise=Promise.resolve().then(fn);inFlight=promise;notify();return promise.finally(()=>{if(inFlight===promise)inFlight=undefined;notify();});}
 function cancellableRead(fn){
  const epoch=cancellationEpoch;
  return operate(async()=>{controller=new AbortController();if(epoch!==cancellationEpoch)controller.abort();try{await current();return await fn();}finally{controller=undefined;}});
 }
 function child(record){
  if(children.has(record.id))return children.get(record.id);
  const wsStorage=storageFactory(storageRoot,record.logicalProjectId,'workspace'),replayStorage=storageFactory(storageRoot,record.logicalProjectId,'replays');
  const workspace=createRuntimeWorkspaceStore({projectId:record.logicalProjectId,...wsStorage,onChange:notify});
  const replays=createRuntimeReplayStore({projectId:record.logicalProjectId,...replayStorage,onChange:notify});
  const captureAdapters=captureStorageFactory({root:storageRoot,projectId:record.logicalProjectId});
  const captures=createRuntimeCaptureStore({projectId:record.logicalProjectId,...captureAdapters});
  const value={workspace,replays,captures,captureAdapters,wsStorage,replayStorage};children.set(record.id,value);return value;
 }
 function collect(record,variant){const owned=child(record);if(variant.runId)variant.outcome.observation=copy(owned.workspace.snapshot().runs.find(run=>run.id===variant.runId));if(variant.replayId)variant.outcome.replay=copy(owned.replays.snapshot().replays.find(replay=>replay.id===variant.replayId));if(variant.captureId)variant.outcome.capture=copy(owned.captures.snapshot().captures.find(image=>image.id===variant.captureId));}
 function verifyEvidence(record,variant){
  const owned=child(record),ws=owned.workspace.snapshot(),rs=owned.replays.snapshot(),cs=owned.captures.snapshot();check(ws.storage.status==='saved'&&rs.storage.status==='saved'&&cs.storage.status==='saved');
  const run=ws.runs.find(item=>item.id===variant.runId),replay=rs.replays.find(item=>item.id===variant.replayId),image=cs.captures.find(item=>item.id===variant.captureId);
  check(equal(run,variant.outcome.observation)&&equal(replay,variant.outcome.replay)&&equal(image,variant.outcome.capture));
  if(variant.status==='completed')check(run?.status==='completed'&&replay?.status==='completed'&&(!record.captureEach||image));
  if(!run)return;
  check(equal(run.feature,record.scope.feature)&&run.screen.title===record.scope.screen.title&&run.screen.route===record.scope.screen.route&&run.scenario.title===record.scope.scenario.title&&equal(run.scenario.steps,record.scope.scenario.steps)&&run.scenario.expectedOutcome===record.scope.scenario.expectedOutcome&&changedFiles(record).every(file=>run.sources.find(item=>item.path===file.path)?.revision===(variant.id==='baseline'?file.beforeHash:file.afterHash)));
  const binding={startedAt:run.startedAt,definitionRevision:run.definitionRevision,runtime:run.runtime,sources:run.sources,dirtyPaths:run.dirtyPaths};
  if(replay){const {registrationId,...recipe}=replay.recipe;check(equal(replay.binding,binding)&&replay.runId===run.id&&replay.featureId===run.feature.id&&replay.screenId===run.screen.id&&replay.scenarioId===run.scenario.id&&equal(replay.requested,record.requested)&&equal(validateRecipe(recipe,record.scope),record.recipe));}
  if(image)check(equal(image.binding,binding)&&image.runId===run.id&&image.featureId===run.feature.id&&image.screenId===run.screen.id&&image.scenarioId===run.scenario.id);
 }
 function verifyRetained(record){
  const owned=child(record),{storage:wsState,...workspace}=owned.workspace.snapshot(),{storage:replayState,...replays}=owned.replays.snapshot();
  check(wsState.status==='saved'&&replayState.status==='saved'&&equal(owned.wsStorage.read(),workspace)&&equal(owned.replayStorage.read(),replays));
  owned.captures.reconcile();for(const variant of record.variants)verifyEvidence(record,variant);
 }
 function checkedRecord(id,expectedRevision){
  assertOpen();check(uuid(id));if(expectedRevision!==undefined&&(!Number.isSafeInteger(expectedRevision)||expectedRevision!==data.revision))throw fail('alternatives-stale','The retained comparison changed. Review its latest state.');
  if(!equal(journal.read()??{schemaVersion:1,projectId,revision:0,records:[]},data))throw fail('alternatives-storage-stale',storageMessage);
  const record=data.records.find(item=>item.id===id);if(!record)throw fail('alternatives-unknown','Choose a retained comparison in this project.');return record;
 }
 const originFor=record=>({version:1,comparisonId:record.id,beforeHash:record.beforeHash,afterHash:record.afterHash,baselineDigest:record.baselineDigest});
 async function candidateSource(record,{guard,originalWriteTemporary}={}){
  if(isGroup(record)||record.status!=='completed'||!record.candidate||!hex(record.baselineDigest,64)||record.variants.some(item=>!hex(item.manifestDigest,64)))throw fail('alternatives-review-unavailable','This retained comparison has no completed, reviewable candidate metadata.');
  await current(guard);verifyRetained(record);
  const metadataStore=storageFactory(storageRoot,record.logicalProjectId,'candidate');let metadata;try{metadata=metadataStore.read();}catch{throw fail('alternatives-review-metadata','Retained candidate metadata could not be read safely.');}
  check(fields(metadata,['schemaVersion','projectId','revision','comparisonId','proposalId','name','token','designImpact'])&&metadata.schemaVersion===1&&metadata.projectId===record.logicalProjectId&&metadata.revision===1&&metadata.comparisonId===record.id&&metadata.proposalId===record.proposalId&&metadata.name===record.candidate.name&&equal(metadata.token,record.candidate.token)&&hash(canonical(metadata))===record.candidate.metadataDigest);
  const designImpact=validateDesignImpactCheckpoint(metadata.designImpact,projectId),target=designImpact.result.target;
  check(target.kind==='token'&&target.path===record.path&&target.name===record.candidate.token.name&&target.occurrence===record.candidate.token.occurrence&&target.revision===record.beforeHash.slice(0,16));
  if(typeof copies.readPair!=='function')throw fail('alternatives-review-unavailable','The retained candidate source cannot be read in this host.');
  const pair=await copies.readPair(record.id,{guard:()=>current(guard),...(originalWriteTemporary?{originalWriteTemporary}:{})});await current(guard);
  check(pair.path===record.path&&pair.beforeHash===record.beforeHash&&pair.afterHash===record.afterHash&&pair.baselineDigest===record.baselineDigest&&pair.manifestDigests?.baseline===record.variants[0].manifestDigest&&pair.manifestDigests?.alternative===record.variants[1].manifestDigest&&typeof pair.before==='string'&&typeof pair.after==='string'&&hash(pair.before)===record.beforeHash&&hash(pair.after)===record.afterHash);
  const token=listDesignTokens([{path:pair.path,source:pair.after,revision:record.afterHash.slice(0,16)}]).find(item=>item.name===target.name&&item.occurrence===target.occurrence);
  check(token&&createTokenProposal({file:{path:pair.path,source:pair.before,revision:record.beforeHash.slice(0,16)},name:target.name,occurrence:target.occurrence,value:token.value,projectId}).after===pair.after);
  checkedRecord(record.id);verifyRetained(record);let retainedMetadata;try{retainedMetadata=metadataStore.read();}catch{throw fail('alternatives-review-metadata','Retained candidate metadata changed while its source was being read.');}check(hash(canonical(retainedMetadata))===record.candidate.metadataDigest);await current(guard);
  return {name:record.candidate.name,path:record.path,before:pair.before,after:pair.after,beforeHash:record.beforeHash,afterHash:record.afterHash,baselineDigest:record.baselineDigest,token:copy(record.candidate.token),designImpact,alternativeBasis:originFor(record)};
 }
 const groupOriginFor=record=>({version:2,kind:'change-set',comparisonId:record.id,sourceGroupId:record.source.groupId,sourceGroupRevision:record.source.groupRevision,sourceGroupDigest:record.source.groupDigest,baselineDigest:record.baselineDigest,files:copy(record.source.files)});
 async function contextHashes(record,group,guard){
  check(typeof copies.readSources==='function');const sources=await copies.readSources(record.id,'baseline',group.context.map(ref=>ref.path),{guard:()=>current(guard)});await current(guard);
  check(Array.isArray(sources)&&sources.length===group.context.length&&group.context.every(ref=>sources.find(source=>source.path===ref.path)?.revision?.slice(0,16)===ref.revision));
 }
 async function groupCandidateSource(record,{guard,originalBatchWrite}={}){
  if(!isGroup(record)||record.status!=='completed'||!record.candidate||!hex(record.baselineDigest,64)||record.variants.some(item=>!hex(item.manifestDigest,64)))throw fail('alternatives-review-unavailable','This retained comparison has no completed, reviewable source group.');
  await current(guard);verifyRetained(record);const metadataStore=storageFactory(storageRoot,record.logicalProjectId,'candidate');let metadata;
  try{metadata=metadataStore.read();}catch{throw fail('alternatives-review-metadata','Retained group metadata could not be read safely.');}
  check(fields(metadata,['schemaVersion','projectId','revision','comparisonId','name','sourceGroup'])&&metadata.schemaVersion===2&&metadata.projectId===record.logicalProjectId&&metadata.revision===1&&metadata.comparisonId===record.id&&metadata.name===record.candidate.name&&hash(canonical(metadata))===record.candidate.metadataDigest);
  const value=groupValue({changeSet:metadata.sourceGroup,scope:record.scope,recipe:record.recipe,requested:record.requested,captureEach:record.captureEach,candidateName:metadata.name},projectId);
  check(equal(value.source,record.source));if(typeof copies.readGroup!=='function')throw fail('alternatives-review-unavailable','The retained group source cannot be read in this host.');
  const pair=await copies.readGroup(record.id,{guard:()=>current(guard),...(originalBatchWrite?{originalBatchWrite}:{})});await current(guard);
  check(pair.baselineDigest===record.baselineDigest&&pair.manifestDigests?.baseline===record.variants[0].manifestDigest&&pair.manifestDigests?.alternative===record.variants[1].manifestDigest&&Array.isArray(pair.files)&&equal(pair.files.map(({path,beforeHash,afterHash})=>({path,beforeHash,afterHash})),record.source.files));
  check(pair.files.every(file=>fields(file,['path','before','after','beforeHash','afterHash'])&&typeof file.before==='string'&&typeof file.after==='string'&&hash(file.before)===file.beforeHash&&hash(file.after)===file.afterHash));
  const sourceGroup=validateChangeSet({...value.group,files:value.group.files.map(file=>{const saved=pair.files.find(item=>item.path===file.path);check(saved&&saved.before===file.before&&saved.after===file.after);return {...file,before:saved.before,after:saved.after};})},projectId);
  check(changeGroupDigest(sourceGroup)===record.source.groupDigest&&sourceGroup.revision===record.source.groupRevision);await contextHashes(record,sourceGroup,guard);
  checkedRecord(record.id);verifyRetained(record);let retainedMetadata;try{retainedMetadata=metadataStore.read();}catch{throw fail('alternatives-review-metadata','Retained group metadata changed while its source was being read.');}check(hash(canonical(retainedMetadata))===record.candidate.metadataDigest);await current(guard);
  return {kind:'change-set',name:record.candidate.name,sourceGroup,files:copy(pair.files),baselineDigest:record.baselineDigest,alternativeBasis:validateAlternativeGroupBasis(groupOriginFor(record),sourceGroup.files)};
 }
 function recoverCaptureStorage(record){
  const owned=child(record);let saved=owned.captures.reconcile();
  if(saved.storage.status==='error'){
   // A failed uncommitted image is not retaken. Reopen only the verified,
   // immutable committed metadata; any orphan bytes remain quota-accounted.
   const recovered=createRuntimeCaptureStore({projectId:record.logicalProjectId,...owned.captureAdapters}),next=recovered.snapshot();
   check(next.storage.status==='saved'&&equal(saved.captures,next.captures));owned.captures=recovered;saved=next;
  }
  if(saved.storage.status!=='saved')throw fail('alternatives-storage',storageMessage);
 }
 async function sealChildren(record,reason){const owned=child(record);for(const variant of record.variants){const replay=owned.replays.snapshot().replays.find(item=>item.id===variant.replayId);if(replay?.status==='running'&&owned.replays.snapshot().storage.status==='saved')await owned.replays.finish(replay.id,{status:'interrupted',reason});const run=owned.workspace.snapshot().runs.find(item=>item.id===variant.runId);if(run?.status==='recording'&&owned.workspace.snapshot().storage.status==='saved')await owned.workspace.finishRun(run.id,{status:'interrupted',interruption:reason,observations:[],truncated:false});collect(record,variant);}}
 async function validateCopies(record,variant,guard){await current(guard);await copies.validateOriginal(record.id,{guard:()=>current(guard)});await current(guard);const result=await copies.validate(record.id,variant.id,variant.manifestDigest,{guard:()=>current(guard)});await current(guard);return result;}
 async function abortable(operation){const signal=controller?.signal;if(!signal)return operation;let rejectAbort;const cancelled=new Promise((_,reject)=>{rejectAbort=()=>reject(fail('alternatives-cancelled','The comparison was stopped.'));if(signal.aborted)rejectAbort();else signal.addEventListener('abort',rejectAbort,{once:true});});try{return await Promise.race([operation,cancelled]);}finally{signal.removeEventListener('abort',rejectAbort);}}
 async function publish(record,variant,runtime,phase,guard){await current(guard);active={comparisonId:record.id,variantId:variant.id,runtime:copy(runtime),requested:copy(record.requested),phase,nonce:randomBytes(16).toString('hex')};notify();await abortable(preview(copy(active)));await current(guard);}
 async function waitConnected(record,variant,runtime,guard){const until=Date.now()+connectTimeoutMs;while(Date.now()<until){await current(guard);const state=await runtime.readCurrent();await current(guard);if(state.status==='connected'&&state.pageConnected&&hex(state.documentId,32)&&Number.isSafeInteger(state.pageVersion)&&state.pageVersion>0)return state;await new Promise(resolve=>setTimeout(resolve,60));}throw fail('alternatives-runtime','The isolated preview did not connect.');}
 async function fresh(runtime,identity,guard){await current(guard);const state=await runtime.readCurrent();await current(guard);if(state.status!=='connected'||!state.pageConnected||!equal(normalizeIdentity(state),identity))throw fail('alternatives-runtime','The isolated runtime changed.');return state;}
 async function waitForRecipe(record,runtime,initial,guard){
  const identity=normalizeIdentity(initial),until=Date.now()+connectTimeoutMs;let state=initial;
  const {catalogDigest,...expectedRecipe}=record.recipe;
  while(true){
   await current(guard);
   if(state.pagePath!==record.scope.screen.route||state.capabilities.scenarioReplay!==true||state.replayBlocked)throw fail('alternatives-recipe','The copied app cannot replay the selected recipe.');
   const catalog=state.replayCatalog;
   if(catalog){
    const recipe=catalog.recipes.find(item=>item.id===record.recipe.id);
    if(catalog.digest!==catalogDigest||!equal(recipe,expectedRecipe))throw fail('alternatives-recipe','The copied recipe differs from the selected recipe.');
    return state;
   }
   // Page instrumentation can connect before the app's asynchronous recipe
   // registration. Only absence is transient; an actual mismatch fails closed.
   if(Date.now()>=until)throw Object.assign(fail('alternatives-recipe-unavailable','The copied app did not register its recipe before the preview timeout.'),{reason:'timeout'});
   await abortable(new Promise(resolve=>setTimeout(resolve,Math.min(60,Math.max(1,until-Date.now())))));
   state=await fresh(runtime,identity,guard);
  }
 }
 async function sourceHashes(record,variant,description,guard){if(copies.readSources)return copies.readSources(record.id,variant.id,record.scope.feature.paths,{guard:()=>current(guard)});const result=[];for(const relative of record.scope.feature.paths){await current(guard);const filename=path.join(description.root,relative),fd=await fsp.open(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=await fd.stat();check(stat.isFile()&&stat.size<=2*1024*1024);const source=await fd.readFile();await current(guard);result.push({path:relative,revision:hash(source)});}finally{await fd.close();}}return result;}
 async function executeSide(record,variant,guard){
  const description=await validateCopies(record,variant,guard),owned=child(record);
  variant.status='running';variant.runId=randomUUID();await changed();await current(guard);
  const runtime=runtimeFactory({root:description.root,nodePath,launchProcess:copies.launcher,onChange:notify});liveRuntime=runtime;
  try{
   let state=await runtime.start(record.scope.screen.targetId);await current(guard);await publish(record,variant,state,'connect',guard);state=await waitConnected(record,variant,runtime,guard);
   if(state.pagePath!==record.scope.screen.route){state=await runtime.navigate(record.scope.screen.route);await current(guard);await publish(record,variant,state,'connect',guard);state=await waitConnected(record,variant,runtime,guard);}
   state=await waitForRecipe(record,runtime,state,guard);
   const catalog=state.replayCatalog,recipe=catalog.recipes.find(item=>item.id===record.recipe.id),catalogDigest=record.recipe.catalogDigest;
   await publish(record,variant,state,'ready',guard);const identity=normalizeIdentity(state);state=await fresh(runtime,identity,guard);
   const sources=await sourceHashes(record,variant,description,guard);await current(guard);check(changedFiles(record).every(file=>sources.find(source=>source.path===file.path)?.revision===(variant.id==='baseline'?file.beforeHash:file.afterHash)));await validateCopies(record,variant,guard);
   let ws=owned.workspace.snapshot();if(ws.screens.length===0){await owned.workspace.createScreen({featureId:record.scope.feature.id,title:record.scope.screen.title,targetId:record.scope.screen.targetId,route:record.scope.screen.route},ws.revision);await current(guard);ws=owned.workspace.snapshot();await owned.workspace.createScenario({screenId:ws.activeScreenId,title:record.scope.scenario.title,steps:record.scope.scenario.steps,expectedOutcome:record.scope.scenario.expectedOutcome},ws.revision);await current(guard);}
   ws=owned.workspace.snapshot();const screen=ws.screens.find(item=>item.id===ws.activeScreenId),scenario=ws.scenarios.find(item=>item.id===ws.activeScenarioId);
   await owned.workspace.beginRun({feature:record.scope.feature,screen,scenario,definitionRevision:ws.revision,runtime:identity,sources,dirtyPaths:[]},ws.revision,{id:variant.runId});await current(guard);
   const run=owned.workspace.snapshot().runs.find(item=>item.id===variant.runId),context={projectId:record.logicalProjectId,runId:run.id,featureId:run.feature.id,screenId:run.screen.id,scenarioId:run.scenario.id,startedAt:run.startedAt,definitionRevision:run.definitionRevision,runtime:identity,sources,dirtyPaths:[]};
   const executionId=randomBytes(16).toString('hex');let replay=await owned.replays.begin({context,executionId,recipe:{...recipe,registrationId:catalog.registrationId,catalogDigest},requested:record.requested},owned.replays.snapshot().revision);variant.replayId=replay.id;collect(record,variant);await changed();await current(guard);
   const seen=new Set(state.observations.map(item=>item.id));
   const result=await runtime.replay({executionId,recipeId:recipe.id,catalogDigest,registrationId:catalog.registrationId,identity:nativeIdentity(state),requested:record.requested},{signal:controller.signal,onProgress:async progress=>{await current(guard);await owned.replays.update(replay.id,progress);await current(guard);}});
   await current(guard);state=await fresh(runtime,identity,guard);await validateCopies(record,variant,guard);
   replay=await owned.replays.finish(replay.id,result.status==='completed'?{status:'completed'}:{status:result.status,reason:replayReason(result.reason)});await current(guard);collect(record,variant);await changed();await current(guard);
   if(result.status!=='completed')throw Object.assign(fail('alternatives-replay',`The recipe did not complete (${replayReason(result.reason)}).`),{reason:replayReason(result.reason)});
   if(record.captureEach){
    check(typeof capture==='function');await publish(record,variant,state,'capture',guard);await fresh(runtime,identity,guard);const native=await capture({comparisonId:record.id,variantId:variant.id,identity:nativeIdentity(state),guard:()=>current(guard)});await current(guard);await fresh(runtime,identity,guard);await validateCopies(record,variant,guard);
    const image=inspectCapturePng(native.png),c=native.conditions;check(image.widthPx===c.pixelWidth&&image.heightPx===c.pixelHeight&&Math.abs(c.viewportWidth-record.requested.viewportWidthCss)<=1&&Math.abs(c.viewportHeight-record.requested.viewportHeightCss)<=1&&replay.observed&&c.observedColorScheme===replay.observed.colorSchemePreference&&c.reducedMotion===(replay.observed.reducedMotionPreference==='reduce')&&Number.isFinite(Date.parse(native.capturedAt))&&Date.parse(native.capturedAt)>=Date.parse(run.startedAt)&&Date.parse(native.capturedAt)<=Date.now());
    const saved=await owned.captures.saveCapture({context,png:native.png,capturedAt:native.capturedAt,conditions:{viewportWidthCss:c.viewportWidth,viewportHeightCss:c.viewportHeight,deviceScaleFactor:c.devicePixelRatio,scrollXCss:c.scrollX,scrollYCss:c.scrollY,canvasScale:c.canvasScale,colorSchemePreference:c.observedColorScheme,reducedMotionPreference:c.reducedMotion?'reduce':'no-preference',appTheme:'unknown',dataState:'unknown',animationState:'unknown'}});variant.captureId=saved.id;await current(guard);collect(record,variant);await changed();await current(guard);
   }
   state=await fresh(runtime,identity,guard);await validateCopies(record,variant,guard);
   const eligible=state.observations.filter(item=>!seen.has(item.id)&&item.session===identity.session&&item.documentId===identity.documentId&&item.observedAt&&Date.parse(item.observedAt)>=Date.parse(run.startedAt)&&Date.parse(item.observedAt)<=Date.now());
   await owned.workspace.finishRun(run.id,{status:'completed',observations:eligible.slice(-100),truncated:eligible.length>100});await current(guard);collect(record,variant);await changed();await current(guard);
  }finally{await runtime.stop().catch(()=>{});await runtime.dispose().catch(()=>{});if(liveRuntime===runtime)liveRuntime=undefined;active=undefined;notify();}
  await validateCopies(record,variant,guard);variant.status='completed';collect(record,variant);await changed();await current(guard);
 }
 const api={
  snapshot,
  load(){if(loaded)return Promise.resolve(snapshot());return operate(async()=>{try{journal=storageFactory(storageRoot,projectId,'journal');const saved=journal.read();data=saved===undefined?data:manifestValue(saved,projectId);loaded=true;let recovered=false;for(const record of data.records){if(['preparing','ready','running'].includes(record.status)){record.status='interrupted';record.reason='host-restarted';record.endedAt=now();for(const variant of record.variants)if(variant.status==='running'){variant.status='interrupted';variant.reason='host-restarted';}recovered=true;}if(record.variants.some(variant=>variant.runId)){const owned=child(record);await owned.workspace.retry();await owned.replays.retry();for(const variant of record.variants){if(record.status==='completed')verifyEvidence(record,variant);else{const before=copy(variant.outcome);collect(record,variant);if(!equal(before,variant.outcome))recovered=true;}}}}if(recovered)await changed();else storage={status:'saved'};notify();return snapshot();}catch{if(pending){storage={status:'error',message:storageMessage};error=storageMessage;}else{data={schemaVersion:1,projectId,revision:0,records:[]};storage={status:'unavailable',message:'Saved comparisons could not be read safely. Existing history has been preserved.'};}notify();return snapshot();}});},
  prepare(input,{guard}={}){if(inFlight)return Promise.reject(fail('alternatives-busy','A comparison operation is already in progress.'));let captured;try{captured=copy(input);}catch{return Promise.reject(invalid());}return operate(async()=>{assertOpen();const value=prepareValue(captured,projectId);await current(guard);if(data.records.length>=4)throw fail('alternatives-capacity','Four comparison pairs are already saved. Existing evidence has been preserved.');controller=new AbortController();error=undefined;const id=randomUUID(),metadata={schemaVersion:1,projectId:`alternative-${id}`,revision:1,comparisonId:id,proposalId:value.proposal.id,name:value.candidateName,token:value.token,designImpact:value.designImpact},record={id,logicalProjectId:`alternative-${id}`,candidate:{name:value.candidateName,token:value.token,metadataDigest:hash(canonical(metadata))},createdAt:now(),title:value.proposal.title,path:value.proposal.path,proposalId:value.proposal.id,beforeHash:hash(value.proposal.before),afterHash:hash(value.proposal.after),scope:value.scope,recipe:value.recipe,requested:value.requested,captureEach:value.captureEach,status:'preparing',variants:['baseline','alternative'].map(id=>({id,label:id==='baseline'?'Baseline':'Alternative',status:'not-run',outcome:outcome()}))};data.records.push(record);try{await changed();await current(guard);try{await storageFactory(storageRoot,record.logicalProjectId,'candidate').write(metadata);}catch{throw fail('alternatives-storage',storageMessage);}await current(guard);const prepared=await copies.prepare({comparisonId:id,path:record.path,before:value.proposal.before,after:value.proposal.after,guard:()=>current(guard)});await current(guard);check(prepared.beforeHash===record.beforeHash&&prepared.afterHash===record.afterHash);record.baselineDigest=prepared.baselineDigest;for(const variant of record.variants){const match=prepared.variants.find(item=>item.id===variant.id);check(match&&hex(match.manifestDigest,64));variant.manifestDigest=match.manifestDigest;}record.status='ready';await changed();await current(guard);return copy(record);}catch(cause){record.status=controller.signal.aborted?'cancelled':'failed';record.reason=reasonFor(cause);record.endedAt=now();error=errorMessage;if(storage.status==='saved')await changed().catch(()=>{});throw cause;}finally{controller=undefined;}});},
  prepareChangeSet(input,{guard}={}){
   if(inFlight)return Promise.reject(fail('alternatives-busy','A comparison operation is already in progress.'));let captured;try{captured=copy(input);}catch{return Promise.reject(invalid());}const epoch=cancellationEpoch;
   return operate(async()=>{assertOpen();const value=groupValue(captured,projectId);if(data.records.length>=4)throw fail('alternatives-capacity','Four comparison pairs are already saved. Existing evidence has been preserved.');controller=new AbortController();if(epoch!==cancellationEpoch)controller.abort();error=undefined;let record;
    try{await current(guard);const id=randomUUID(),metadata={schemaVersion:2,projectId:`alternative-${id}`,revision:1,comparisonId:id,name:value.candidateName,sourceGroup:value.group};
     record={id,logicalProjectId:`alternative-${id}`,candidate:{name:value.candidateName,metadataDigest:hash(canonical(metadata))},createdAt:now(),title:value.group.title,source:value.source,scope:value.scope,recipe:value.recipe,requested:value.requested,captureEach:value.captureEach,status:'preparing',variants:['baseline','alternative'].map(id=>({id,label:id==='baseline'?'Baseline':'Alternative',status:'not-run',outcome:outcome()}))};data.records.push(record);
     await changed();await current(guard);try{await storageFactory(storageRoot,record.logicalProjectId,'candidate').write(metadata);}catch{throw fail('alternatives-storage',storageMessage);}await current(guard);
     check(typeof copies.prepareGroup==='function');const prepared=await copies.prepareGroup({comparisonId:id,files:value.group.files.map(({path,before,after})=>({path,before,after})),guard:()=>current(guard)});await current(guard);check(equal(prepared.files,record.source.files)&&hex(prepared.baselineDigest,64));record.baselineDigest=prepared.baselineDigest;
     for(const variant of record.variants){const match=prepared.variants.find(item=>item.id===variant.id);check(match&&hex(match.manifestDigest,64));variant.manifestDigest=match.manifestDigest;}
     await contextHashes(record,value.group,guard);record.status='ready';await changed();await current(guard);return copy(record);
    }catch(cause){if(record){record.status=controller.signal.aborted?'cancelled':'failed';record.reason=reasonFor(cause);record.endedAt=now();error=errorMessage;if(storage.status==='saved')await changed().catch(()=>{});}throw cause;}finally{controller=undefined;}
   });
  },
  run(id,expectedRevision,{guard}={}){return operate(async()=>{assertOpen();check(uuid(id)&&Number.isSafeInteger(expectedRevision));if(data.revision!==expectedRevision)throw fail('alternatives-stale','The comparison changed. Review its latest state.');const record=data.records.find(item=>item.id===id);if(!record||record.status!=='ready')throw fail('alternatives-finished','This comparison cannot run again. Prepare a new pair.');controller=new AbortController();error=undefined;try{await current(guard);record.status='running';await changed();await current(guard);await validateCopies(record,record.variants[0],guard);for(const variant of record.variants)await executeSide(record,variant,guard);record.status='completed';record.endedAt=now();await changed();await current(guard);return copy(record);}catch(cause){const reason=reasonFor(cause);record.status=reason==='cancelled'?'cancelled':reason==='context-changed'?'interrupted':'failed';record.reason=reason;record.endedAt=now();for(const variant of record.variants)if(variant.status==='running'){variant.status=record.status;variant.reason=reason;}await sealChildren(record,reason).catch(()=>{});error=errorMessage;if(storage.status==='saved')await changed().catch(()=>{});else pending=true;if(reason==='storage-failed')storage={status:'error',message:storageMessage};throw cause;}finally{controller=undefined;active=undefined;notify();}});},
  compareCandidates(leftId,rightId,expectedRevision,{guard}={}){return operate(async()=>{const left=checkedRecord(leftId,expectedRevision),right=checkedRecord(rightId,expectedRevision);await current(guard);check(left.id!==right.id);for(const record of [left,right])if(record.status==='completed')verifyRetained(record);await current(guard);checkedRecord(left.id,expectedRevision);return comparisonDescriptor(left,right);});},
  readCandidate(id,expectedRevision,options={}){return cancellableRead(async()=>{const record=checkedRecord(id,expectedRevision);return candidateSource(record,options);});},
  validateCandidate(basis,options={}){let captured;try{captured=copy(basis);}catch{return Promise.reject(invalid());}return cancellableRead(async()=>{check(basisValue(captured));const record=checkedRecord(captured.comparisonId);check(equal(captured,originFor(record)));return candidateSource(record,options);});},
  // Decisions preserve retained metadata after Apply. This read deliberately has no
  // original-baseline precondition and grants no source-write authority.
  readDecisionEvidence(id,expectedRevision){return cancellableRead(async()=>{
   const record=checkedRecord(id,expectedRevision);check(record.status==='completed'&&record.candidate&&hex(record.baselineDigest,64));verifyRetained(record);
   const metadata=storageFactory(storageRoot,record.logicalProjectId,'candidate').read();check(metadata&&hash(canonical(metadata))===record.candidate.metadataDigest&&metadata.comparisonId===record.id&&metadata.name===record.candidate.name);
   if(isGroup(record)){check(metadata.schemaVersion===2);const value=groupValue({changeSet:metadata.sourceGroup,scope:record.scope,recipe:record.recipe,requested:record.requested,captureEach:record.captureEach,candidateName:metadata.name},projectId);check(equal(value.source,record.source));}
   else {check(metadata.schemaVersion===1&&metadata.proposalId===record.proposalId&&equal(metadata.token,record.candidate.token));validateDesignImpactCheckpoint(metadata.designImpact,projectId);}
   checkedRecord(id,expectedRevision);verifyRetained(record);return copy(record);
  });},
  readGroupCandidate(id,expectedRevision,options={}){return cancellableRead(async()=>{const record=checkedRecord(id,expectedRevision);return groupCandidateSource(record,options);});},
  validateGroupCandidate(basis,options={}){let captured;try{captured=copy(basis);}catch{return Promise.reject(invalid());}return cancellableRead(async()=>{const checked=validateAlternativeGroupBasis(captured),record=checkedRecord(checked.comparisonId);check(isGroup(record)&&equal(checked,groupOriginFor(record)));return groupCandidateSource(record,options);});},
  validateGroupProgress(basis,options={}){let captured;try{captured=copy(basis);}catch{return Promise.reject(invalid());}return cancellableRead(async()=>{
   const checked=validateAlternativeGroupBasis(captured),record=checkedRecord(checked.comparisonId);check(isGroup(record)&&record.status==='completed'&&equal(checked,groupOriginFor(record))&&typeof copies.validateOriginalProgress==='function');await current(options.guard);verifyRetained(record);
   const metadataStore=storageFactory(storageRoot,record.logicalProjectId,'candidate'),metadata=metadataStore.read();check(fields(metadata,['schemaVersion','projectId','revision','comparisonId','name','sourceGroup'])&&metadata.schemaVersion===2&&metadata.projectId===record.logicalProjectId&&metadata.revision===1&&metadata.comparisonId===record.id&&metadata.name===record.candidate.name&&hash(canonical(metadata))===record.candidate.metadataDigest);
   const value=groupValue({changeSet:metadata.sourceGroup,scope:record.scope,recipe:record.recipe,requested:record.requested,candidateName:metadata.name},projectId);check(equal(value.source,record.source));
   await copies.validateOriginalProgress(record.id,{guard:()=>current(options.guard),originalBatchWrite:options.originalBatchWrite});await current(options.guard);checkedRecord(record.id);verifyRetained(record);check(hash(canonical(metadataStore.read()))===record.candidate.metadataDigest);
  });},
  async stop(){cancellationEpoch++;controller?.abort();active=undefined;notify();await liveRuntime?.cancelReplay().catch(()=>{});await liveRuntime?.stop().catch(()=>{});try{await inFlight;}catch{}return snapshot();},
  retry(){return operate(async()=>{if(closing)throw fail('alternatives-closed','This project has closed.');if(!loaded||!journal)throw fail('alternatives-unavailable','Reopen the project to reload saved comparisons.');const before=copy(data);if(!pending&&!equal(journal.read()??{schemaVersion:1,projectId,revision:0,records:[]},before))throw fail('alternatives-storage-stale',storageMessage);for(const record of data.records){if(!record.variants.some(variant=>variant.runId))continue;if(record.status==='completed'){for(const variant of record.variants)verifyEvidence(record,variant);continue;}const owned=child(record);await owned.workspace.retry();await owned.replays.retry();recoverCaptureStorage(record);await sealChildren(record,record.reason==='cancelled'?'cancelled':'storage-failed');}if(pending){const disk=journal.read();if(disk?.revision===data.revision&&!equal(disk,data))data.revision++;await persist();}else if(!equal(before,data)){await changed();}else storage={status:'saved'};error=undefined;notify();return snapshot();});},
  async readCapture(comparisonId,captureId){assertOpen();check(uuid(comparisonId)&&uuid(captureId));const record=data.records.find(item=>item.id===comparisonId),variant=record?.variants.find(item=>item.captureId===captureId);check(record&&variant);verifyEvidence(record,variant);const result=await child(record).captures.readCapture(captureId);check(equal(result.capture,variant.outcome.capture));return result;},
  async dispose(){closing=true;await api.stop();for(const owned of children.values()){await owned.workspace.dispose().catch(()=>{});await owned.replays.dispose().catch(()=>{});}copies.dispose?.();active=undefined;notify();}
 };
 return Object.freeze(api);
}
