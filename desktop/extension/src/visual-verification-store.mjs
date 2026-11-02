import {createHash,randomUUID} from 'node:crypto';
import {validateDesignImpactCheckpoint} from '../../../server/project/change-impact.mjs';
import {createRuntimeWorkspaceStore} from './runtime-workspace-store.mjs';
import {createRuntimeCaptureStore} from './runtime-capture-store.mjs';
import {createRuntimeReplayStore} from './runtime-replay-store.mjs';

export const VISUAL_VERIFICATION_LIMITS=Object.freeze({records:40,perProposal:8,manifestBytes:1024*1024});
const clone=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,required,optional=[])=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value);
const token=value=>text(value,200)&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hex=(value,n)=>typeof value==='string'&&value.length===n&&/^[a-f0-9]+$/.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const sourcePath=value=>text(value,1024)&&!/[\\:]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const error=(code,message)=>Object.assign(new Error(message),{name:'VisualVerificationError',code});
const invalid=()=>error('visual-verification-invalid','The verification evidence could not be validated. Saved links have been preserved.');
const requireValue=value=>{if(!value)throw invalid();};
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>{
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return `[${Array.from(value).map(item=>canonical(item)).join(',')}]`;
 if(object(value))return `{${Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
 throw invalid();
};
/** A stable identity over validated metadata, not an assertion that source produced pixels. */
export const visualVerificationDigest=value=>hash(canonical(value));
const equal=(a,b)=>canonical(a)===canonical(b);
const UNAVAILABLE='Saved verification links changed outside this session or could not be read safely. Existing records have been left unchanged.';
const STORAGE_FAILED='The verification link could not be saved locally. Retry saving; no scenario or application action will be repeated.';
const abort=()=>Object.assign(new Error('The verification context changed before the link was saved.'),{name:'AbortError',code:'visual-verification-cancelled'});

function basisValue(value){
 requireValue(fields(value,['proposalId','title','path','beforeHash','afterHash','baseRevision','appliedRevision','impactDigest'])&&uuid(value.proposalId)&&text(value.title,512)&&sourcePath(value.path)&&hex(value.beforeHash,64)&&hex(value.afterHash,64)&&value.beforeHash!==value.afterHash&&hex(value.baseRevision,16)&&value.baseRevision===value.beforeHash.slice(0,16)&&hex(value.appliedRevision,16)&&value.appliedRevision===value.afterHash.slice(0,16)&&hex(value.impactDigest,64));return clone(value);
}
function scopeValue(value){
 requireValue(fields(value,['featureId','featureTitle','screenId','screenTitle','scenarioId','scenarioTitle'])&&['featureId','screenId','scenarioId'].every(key=>uuid(value[key]))&&['featureTitle','screenTitle','scenarioTitle'].every(key=>text(value[key],512)));return clone(value);
}
function evidenceValue(value){
 requireValue(fields(value,['runId','digest','capture','replay'])&&uuid(value.runId)&&hex(value.digest,64));
 for(const key of ['capture','replay'])requireValue(value[key]===null||fields(value[key],['id','digest'])&&uuid(value[key].id)&&hex(value[key].digest,64));return clone(value);
}
function preparedValue(value){
 requireValue(fields(value,['basis','scope','before','after']));const result={basis:basisValue(value.basis),scope:scopeValue(value.scope),before:evidenceValue(value.before),after:evidenceValue(value.after)};requireValue(result.before.runId!==result.after.runId);return result;
}
function entryValue(value){
 requireValue(fields(value,['id','createdAt','basis','scope','before','after'])&&uuid(value.id)&&timestamp(value.createdAt));return {id:value.id,createdAt:value.createdAt,...preparedValue({basis:value.basis,scope:value.scope,before:value.before,after:value.after})};
}
function manifestValue(value,projectId){
 requireValue(fields(value,['schemaVersion','projectId','revision','entries'])&&value.schemaVersion===1&&value.projectId===projectId&&revision(value.revision)&&Array.isArray(value.entries)&&value.entries.length<=VISUAL_VERIFICATION_LIMITS.records&&Buffer.byteLength(JSON.stringify(value),'utf8')<=VISUAL_VERIFICATION_LIMITS.manifestBytes);
 const entries=Array.from(value.entries).map(entryValue),byProposal=new Map(),pairs=new Set();
 requireValue(new Set(entries.map(item=>item.id)).size===entries.length);
 for(const item of entries){const previous=byProposal.get(item.basis.proposalId)||{count:0,basis:item.basis};requireValue(equal(previous.basis,item.basis)&&++previous.count<=VISUAL_VERIFICATION_LIMITS.perProposal);byProposal.set(item.basis.proposalId,previous);const pair=canonical([item.basis,item.scope.featureId,item.scope.screenId,item.scope.scenarioId,item.before.runId,item.after.runId]);requireValue(!pairs.has(pair));pairs.add(pair);}
 return {schemaVersion:1,projectId,revision:value.revision,entries};
}

/** Immutable metadata journal. Failed writes keep the last committed links visible. */
export function createVisualVerificationStore({projectId,read,write,onChange=()=>{}}){
 if(!token(projectId)||![read,write,onChange].every(item=>typeof item==='function'))throw error('visual-verification-configuration','A local project identity and storage adapters are required.');
 const empty=()=>({schemaVersion:1,projectId,revision:0,entries:[]});
 let data=empty(),pending,pendingGuard,storage={status:'saved'},loaded=false,inFlight,closing=false,disposal;
 const snapshot=()=>({...clone(data),storage:{...storage}});
 const notify=()=>{try{onChange();}catch{}};
 const readManifest=()=>{const value=read();return value===undefined||value===null?empty():manifestValue(value,projectId);};
 const unavailable=()=>{storage={status:'unavailable',message:UNAVAILABLE};notify();return error('visual-verification-unavailable',UNAVAILABLE);};
 try{data=readManifest();loaded=true;}catch{storage={status:'unavailable',message:UNAVAILABLE};}
 const current=check=>{try{return !closing&&(!check||check());}catch{return false;}};
 async function rollback(next){
  let disk;try{disk=readManifest();}catch{throw unavailable();}
  if(!equal(disk,data)){if(!equal(disk,next))throw unavailable();try{await write(clone(data));}catch{/* A failed acknowledgement may still have restored the checkpoint. */}
   try{if(!equal(readManifest(),data))throw unavailable();}catch{throw unavailable();}}
  pending=undefined;pendingGuard=undefined;storage={status:'saved'};notify();
 }
 async function persist(check){
  const next=pending;let disk;
  try{disk=readManifest();}catch{throw unavailable();}
  if(!equal(disk,data)&&!equal(disk,next))throw unavailable();
  if(!current(check)){await rollback(next);throw abort();}
  storage={status:'saving'};notify();
  let failure;
  if(!equal(disk,next)){try{await write(clone(next));}catch(cause){failure=cause;}}
  if(!current(check)){await rollback(next);throw abort();}
  if(failure){storage={status:'error',message:STORAGE_FAILED};notify();throw error('visual-verification-storage',STORAGE_FAILED);}
  try{if(!equal(readManifest(),next))throw unavailable();}catch{throw unavailable();}
  // The ownership guard runs before publishing the new journal revision.
  if(!current(check)){await rollback(next);throw abort();}
  data=next;pending=undefined;pendingGuard=undefined;storage={status:'saved'};notify();
 }
 function execute(operation){
  if(closing)return Promise.reject(error('visual-verification-closed','This verification journal has closed.'));
  if(inFlight)return Promise.reject(error('visual-verification-busy','A verification link is already being saved.'));
  const work=Promise.resolve().then(operation);inFlight=work;
  return work.finally(()=>{if(inFlight===work)inFlight=undefined;});
 }
 return {snapshot,
  link(input,expectedRevision,{isCurrent}={}){
   let prepared;try{prepared=preparedValue(input);if(isCurrent!==undefined&&typeof isCurrent!=='function')throw invalid();}catch(cause){return Promise.reject(cause);}
   return execute(async()=>{
    if(!current(isCurrent))throw abort();
    if(storage.status==='unavailable')throw error('visual-verification-unavailable',UNAVAILABLE);
    if(storage.status==='error'||pending)throw error('visual-verification-storage',STORAGE_FAILED);
    if(!revision(expectedRevision)||expectedRevision!==data.revision)throw error('visual-verification-stale','Verification links changed. Review the latest saved state.');
    if(data.entries.length>=VISUAL_VERIFICATION_LIMITS.records||data.entries.filter(item=>item.basis.proposalId===prepared.basis.proposalId).length>=VISUAL_VERIFICATION_LIMITS.perProposal||data.revision>=Number.MAX_SAFE_INTEGER-1)throw error('visual-verification-capacity','Verification history is full. Existing links were preserved; no records were removed.');
    if(data.entries.some(item=>item.basis.proposalId===prepared.basis.proposalId&&!equal(item.basis,prepared.basis)))throw error('visual-verification-stale','This proposal already has a different saved verification basis.');
    if(data.entries.some(item=>item.basis.proposalId===prepared.basis.proposalId&&item.before.runId===prepared.before.runId&&item.after.runId===prepared.after.runId))throw error('visual-verification-duplicate','These observations are already linked to this proposal.');
    const entry={id:randomUUID(),createdAt:new Date().toISOString(),...prepared};
    pending=manifestValue({...data,revision:data.revision+1,entries:[...data.entries,entry]},projectId);pendingGuard=isCurrent;
    await persist(isCurrent);return clone(entry);
   });
  },
  retry(){return execute(async()=>{
   if(pending){if(!current(pendingGuard)){await rollback(pending);return snapshot();}await persist(pendingGuard);return snapshot();}
   let disk;try{disk=readManifest();}catch{throw unavailable();}
   if(loaded&&!equal(disk,data))throw unavailable();
   data=disk;loaded=true;storage={status:'saved'};notify();return snapshot();
  });},
  dispose(){if(!disposal){closing=true;disposal=Promise.resolve(inFlight).catch(()=>{});}return disposal;}
 };
}

function proposalValue(proposal,projectId,{allowProposed=false}={}){
 requireValue(object(proposal)&&proposal.projectId===projectId&&proposal.origin==='design'&&(proposal.status==='applied'||allowProposed&&proposal.status==='proposed')&&typeof proposal.before==='string'&&typeof proposal.after==='string'&&Buffer.byteLength(proposal.before)<=256*1024&&Buffer.byteLength(proposal.after)<=256*1024&&!proposal.before.includes('\0')&&!proposal.after.includes('\0'));
 const impact=validateDesignImpactCheckpoint(proposal.designImpact,projectId),beforeHash=hash(proposal.before),afterHash=hash(proposal.after);
 requireValue(impact.result.target.path===proposal.path&&impact.result.target.revision===proposal.baseRevision&&impact.result.target.kind==='token');
 const basis=basisValue({proposalId:proposal.id,title:proposal.title,path:proposal.path,beforeHash,afterHash,baseRevision:proposal.baseRevision,appliedRevision:proposal.status==='proposed'?afterHash.slice(0,16):proposal.appliedRevision,impactDigest:visualVerificationDigest(impact)});
 return {basis,impact,status:proposal.status};
}
function storageValue(value){requireValue(fields(value,['status'],['message'])&&['saved','saving','error','unavailable'].includes(value.status)&&(value.message===undefined||typeof value.message==='string'&&value.message.length<=2000));return value;}
// Reuse the owning stores' strict schemas with isolated, memory-only adapters.
// Their restart conversion is deliberately discarded: this module never recovers,
// writes, replays, or resumes the project's source records.
function evidenceInputs({projectId,workspace,captures,replays}){
 requireValue(token(projectId)&&fields(workspace,['schemaVersion','projectId','revision','activeScreenId','activeScenarioId','screens','scenarios','runs','storage'])&&workspace.projectId===projectId&&storageValue(workspace.storage).status==='saved');
 const {storage:wsStorage,...workspaceManifest}=workspace;
 const workspaceValidator=createRuntimeWorkspaceStore({projectId,read:()=>clone(workspaceManifest),write:()=>{}});
 requireValue(workspaceValidator.snapshot().storage.status!=='unavailable');
 const runs=clone(workspace.runs),warnings=[];
 function optional(input,key,factory){
  requireValue(fields(input,['schemaVersion','projectId','revision',key,'storage'],key==='captures'?['available']:[])&&input.schemaVersion===1&&input.projectId===projectId&&revision(input.revision)&&Array.isArray(input[key])&&input[key].length<=40);storageValue(input.storage);requireValue(input.available===undefined||typeof input.available==='boolean');
  const clean=input[key].map(item=>{if(key==='captures'&&Object.hasOwn(item,'imageStatus')){const {imageStatus,...metadata}=item;return metadata;}return item;});
  const manifest={schemaVersion:1,projectId,revision:input.revision,[key]:clean};
  const validator=factory({projectId,read:()=>clone(manifest),write:()=>{},writeAsset:()=>{},readAsset:()=>{throw invalid();}});
  requireValue(validator.snapshot().storage.status!=='unavailable');
  if(input.storage.status!=='saved'){warnings.push(`${key==='captures'?'Capture':'Replay'} storage is unavailable; no ${key==='captures'?'image':'execution'} evidence is available.`);return [];}
  return clone(clean);
 }
 const capturesList=optional(captures,'captures',createRuntimeCaptureStore),replaysList=optional(replays,'replays',createRuntimeReplayStore);
 return {runs,captures:capturesList,replays:replaysList,warnings};
}
const identity=run=>[run.feature.id,run.screen.id,run.scenario.id];
const binding=run=>({startedAt:run.startedAt,definitionRevision:run.definitionRevision,runtime:run.runtime,sources:run.sources,dirtyPaths:run.dirtyPaths});
const matches=(item,run)=>item.runId===run.id&&item.featureId===run.feature.id&&item.screenId===run.screen.id&&item.scenarioId===run.scenario.id&&equal(item.binding,binding(run));
function attached(run,evidence){
 const capture=evidence.captures.find(item=>item.runId===run.id),replay=evidence.replays.find(item=>item.runId===run.id);
 requireValue((!capture||matches(capture,run))&&(!replay||matches(replay,run)&&replay.status!=='running'));
 return {capture:capture||null,replay:replay||null};
}
function ineligibleReason(run,basis,side){
 if(run.status==='recording')return 'Finish or cancel this observation before linking it.';
 if(run.dirtyPaths.includes(basis.path))return 'The target source had an unsaved draft during this observation.';
 const source=run.sources.find(item=>item.path===basis.path);
 if(!source)return 'This observation did not include the target source.';
 if(source.revision!==basis[side==='before'?'beforeHash':'afterHash'])return `The target source does not match the exact ${side==='before'?'before':'applied'} version.`;
 return '';
}
const eligible=(run,basis,side)=>!ineligibleReason(run,basis,side);
function scopeOf(run){return {featureId:run.feature.id,featureTitle:run.feature.title,screenId:run.screen.id,screenTitle:run.screen.title,scenarioId:run.scenario.id,scenarioTitle:run.scenario.title};}
function referenceOf(run,evidence){const values=attached(run,evidence);return {runId:run.id,digest:visualVerificationDigest(run),capture:values.capture?{id:values.capture.id,digest:visualVerificationDigest(values.capture)}:null,replay:values.replay?{id:values.replay.id,digest:visualVerificationDigest(values.replay)}:null};}
export function prepareVisualVerificationLink(input){
 const {basis,impact}=proposalValue(input.proposal,input.projectId),evidence=evidenceInputs(input);
 requireValue(uuid(input.scenarioId)&&uuid(input.beforeId)&&uuid(input.afterId)&&input.beforeId!==input.afterId);
 const before=evidence.runs.find(run=>run.id===input.beforeId),after=evidence.runs.find(run=>run.id===input.afterId);
 requireValue(before&&after&&equal(identity(before),identity(after))&&before.scenario.id===input.scenarioId&&eligible(before,basis,'before')&&eligible(after,basis,'after'));
 // The user selects a saved source-related scenario; filenames are not runtime coverage.
 const related=impact.relatedScenarios.find(item=>item.featureId===after.feature.id&&item.screenId===after.screen.id&&item.scenarioId===after.scenario.id);
 requireValue(related);
 return preparedValue({basis,scope:{featureId:related.featureId,featureTitle:related.featureTitle,screenId:related.screenId,screenTitle:related.screenTitle,scenarioId:related.scenarioId,scenarioTitle:related.scenarioTitle},before:referenceOf(before,evidence),after:referenceOf(after,evidence)});
}
function summary(run,values,path){return {runId:run.id,status:run.status,assessment:run.assessment,note:run.note,startedAt:run.startedAt,endedAt:run.endedAt,capture:values.capture?{id:values.capture.id,conditions:clone(values.capture.conditions),image:clone(values.capture.image)}:null,replay:values.replay?{id:values.replay.id,status:values.replay.status,...(values.replay.reason?{reason:values.replay.reason}:{}),requested:clone(values.replay.requested)}:null,sourceHash:run.sources.find(item=>item.path===path)?.revision||null,dirtyPaths:[...run.dirtyPaths]};}
function resolve(reference,evidence,path){
 const run=evidence.runs.find(item=>item.id===reference.runId),warnings=[];let complete=true;
 if(!run||visualVerificationDigest(run)!==reference.digest)return {summary:null,run:null,values:{capture:null,replay:null},complete:false,warnings:['A linked observation is missing or changed. It has not been replaced with another observation.']};
 const values={capture:null,replay:null};
 for(const key of ['capture','replay'])if(reference[key]){const item=evidence[key==='capture'?'captures':'replays'].find(item=>item.id===reference[key].id);if(item&&visualVerificationDigest(item)===reference[key].digest&&matches(item,run)){values[key]=item;}else{complete=false;warnings.push(`The linked ${key} is missing or changed. New evidence has not been substituted.`);}}
 return {summary:summary(run,values,path),run,values,complete,warnings};
}
function pairWarnings(before,after,path){
 const warnings=['Saved-source hashes identify these observations; the source-to-pixels relationship remains unverified.'];
 if(!before.run||!after.run)return warnings;
 const a=before.run,b=after.run;
 const definitions=run=>({screen:{id:run.screen.id,featureId:run.screen.featureId,title:run.screen.title,targetId:run.screen.targetId,route:run.screen.route},scenario:{id:run.scenario.id,screenId:run.scenario.screenId,title:run.scenario.title,steps:run.scenario.steps,expectedOutcome:run.scenario.expectedOutcome}});
 if(!equal(definitions(a),definitions(b)))warnings.push('Scenario or screen definitions differ. These observations do not establish equivalent conditions.');
 if(a.runtime.targetId!==b.runtime.targetId||a.runtime.route!==b.runtime.route)warnings.push('Runtime targets or routes differ.');
 const supporting=run=>run.sources.filter(item=>item.path!==path).sort((a,b)=>a.path.localeCompare(b.path));
 if(!equal(supporting(a),supporting(b)))warnings.push('Supporting saved sources differ; effects cannot be attributed only to this proposal.');
 if(!equal([...a.feature.paths].sort(),[...b.feature.paths].sort())||a.feature.title!==b.feature.title)warnings.push('Feature membership or its saved definition changed between observations.');
 if(a.dirtyPaths.length||b.dirtyPaths.length)warnings.push('Unsaved supporting drafts were excluded from saved-source evidence.');
 if(a.status!=='completed'||b.status!=='completed')warnings.push('A linked observation was cancelled or interrupted; its recorded outcome is preserved.');
 if(a.truncated||b.truncated)warnings.push('Request evidence was truncated.');
 if(Date.parse(a.startedAt)>Date.parse(b.startedAt))warnings.push('The selected before observation was recorded after the selected after observation.');
 const ac=before.values.capture,bc=after.values.capture,ar=before.values.replay,br=after.values.replay;
 if(ac&&bc&&!equal(ac.conditions,bc.conditions))warnings.push('Captured viewport, theme preference, motion preference, or other recorded conditions differ.');
 const recipeDefinition=recipe=>{const {registrationId,...definition}=recipe;return definition;};
 if(ar&&br&&(!equal(ar.requested,br.requested)||!equal(recipeDefinition(ar.recipe),recipeDefinition(br.recipe))))warnings.push('Replay recipes or requested conditions differ.');
 if(!ac||!bc)warnings.push('A before/after image pair is not recorded.');
 if(!ar||!br)warnings.push('A before/after replay pair is not recorded; manual observations do not prove recipe execution.');
 warnings.push('Matching recorded conditions do not establish equivalent data, animation state, or application behavior.');
 return warnings;
}
export function visualVerificationView(input){
 let journal;try{const {storage,...manifest}=input.verification;storageValue(storage);journal={...manifestValue(manifest,input.projectId),storage:clone(storage)};}catch{journal={schemaVersion:1,projectId:input.projectId,revision:0,entries:[],storage:{status:'unavailable',message:UNAVAILABLE}};}
 let proposal=null,evidence=null,evidenceReason='Saved observations are unavailable.';
 try{proposal=proposalValue(input.proposal,input.projectId,{allowProposed:true});}catch{}
 if(proposal||journal.entries.length)try{evidence=evidenceInputs(input);evidenceReason='';}catch{}
 const proposalView={proposalId:proposal?.basis.proposalId||null,proposalBasis:proposal?visualVerificationDigest(proposal.basis):null,canLink:false,reason:proposal?'Choose saved before and after observations.':'Apply a current design proposal before linking observations.',scenarios:[]};
 if(proposal&&evidence){
  for(const related of proposal.impact.relatedScenarios){
   const same=evidence.runs.filter(run=>run.feature.id===related.featureId&&run.screen.id===related.screenId&&run.scenario.id===related.scenarioId);
   const choices=side=>same.map(run=>{let values,reason=ineligibleReason(run,proposal.basis,side);try{values=attached(run,evidence);}catch{reason=reason||'Attached evidence is not bound to this exact observation.';}return {id:run.id,label:`${run.scenario.title} · ${run.endedAt||'Recording'}`,eligible:!reason,reason,status:run.status,assessment:run.assessment,endedAt:run.endedAt,capture:Boolean(values?.capture),replay:Boolean(values?.replay)};});
   const {paths:_paths,suiteNames:_suites,...scope}=related;proposalView.scenarios.push({...scope,canView:true,reason:'',beforeChoices:choices('before'),afterChoices:choices('after')});
  }
  const capacity=journal.entries.length>=VISUAL_VERIFICATION_LIMITS.records||journal.entries.filter(item=>item.basis.proposalId===proposal.basis.proposalId).length>=VISUAL_VERIFICATION_LIMITS.perProposal;
  const knownSource=Array.isArray(input.currentSources)?input.currentSources.find(item=>item.path===proposal.basis.path):null;
  const sourceChanged=input.proposal?.conflict===true||Array.isArray(input.dirtyPaths)&&input.dirtyPaths.includes(proposal.basis.path)||knownSource&&hex(knownSource.revision,64)&&knownSource.revision!==proposal.basis.afterHash;
  proposalView.canLink=proposal.status==='applied'&&!sourceChanged&&journal.storage.status==='saved'&&!capacity&&proposalView.scenarios.some(item=>item.beforeChoices.some(choice=>choice.eligible)&&item.afterChoices.some(choice=>choice.eligible));
  proposalView.reason=proposal.status!=='applied'?'Record a baseline before applying this proposal. Link the pair after Apply.':sourceChanged?'The applied target source changed or has an unsaved draft. Review it before linking.':journal.storage.status!=='saved'?'Verification history must be saved before linking.':capacity?'Verification history is full; existing links are preserved.':proposalView.canLink?'Choose an explicit before and after observation.':'Record the same related scenario against the exact saved before and applied source versions.';
 }else if(proposal)proposalView.reason=evidenceReason;
 const records=journal.entries.map(entry=>{
  const unavailable={summary:null,run:null,values:{capture:null,replay:null},complete:false,warnings:[evidenceReason]};
  const before=evidence?resolve(entry.before,evidence,entry.basis.path):unavailable,after=evidence?resolve(entry.after,evidence,entry.basis.path):unavailable;
  let currentRelevance='historical';
  if(proposal?.status==='applied'&&equal(proposal.basis,entry.basis)){
   const known=Array.isArray(input.currentSources)?input.currentSources.find(item=>item.path===entry.basis.path):null;
   currentRelevance=Array.isArray(input.dirtyPaths)&&input.dirtyPaths.includes(entry.basis.path)?'source-changed':known&&hex(known.revision,64)?known.revision===entry.basis.afterHash?'applied-current':'source-changed':'unknown';
  }
  const scope=[entry.scope.featureId,entry.scope.screenId,entry.scope.scenarioId];
  for(const [side,resolved] of [['before',before],['after',after]])if(resolved.run&&(!equal(identity(resolved.run),scope)||!eligible(resolved.run,entry.basis,side))){resolved.complete=false;resolved.warnings.push('The linked observation does not match the frozen proposal source and scenario identity.');}
  const canCompare=before.complete&&after.complete;
  return {id:entry.id,proposalId:entry.basis.proposalId,title:entry.basis.title,path:entry.basis.path,beforeId:entry.before.runId,afterId:entry.after.runId,...entry.scope,createdAt:entry.createdAt,currentRelevance,canCompare,reason:canCompare?'':'Linked evidence is unavailable or changed.',warnings:[...new Set([...before.warnings,...after.warnings,...(evidence?.warnings||[]),...pairWarnings(before,after,entry.basis.path)])],before:before.summary,after:after.summary,compilation:'not-recorded',visual:'not-assessed',sourceRelationship:'unverified'};
 });
 return {schemaVersion:1,projectId:input.projectId,revision:journal.revision,storage:journal.storage,proposal:proposalView,records};
}
