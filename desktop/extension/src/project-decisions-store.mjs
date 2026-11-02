import {randomUUID} from 'node:crypto';
import {normalizeProjectDecision,projectDecisionDigest,projectDecisionEvidenceDigest,PROJECT_DECISION_LIMITS} from '../../../server/project/project-decisions.mjs';

const copy=value=>structuredClone(value);
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,required,optional=[])=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const token=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
const equal=(left,right)=>projectDecisionEvidenceDigest(left)===projectDecisionEvidenceDigest(right);
const error=(code,message)=>Object.assign(new Error(message),{name:'ProjectDecisionStoreError',code});
const invalid=()=>error('project-decision-invalid','The decision could not be validated. Existing choices and rationales are unchanged.');
const requireValue=value=>{if(!value)throw invalid();};
const UNAVAILABLE='Saved project decisions changed outside this session or could not be read safely. Their history has been left unchanged.';
const STORAGE_FAILED='The decision could not be saved locally. Retry saving; no source, runtime or Assistant action will be repeated.';
const abort=()=>Object.assign(error('project-decision-cancelled','The applied source or decision context changed before the decision was saved.'),{name:'AbortError'});
const adoptionKey=item=>projectDecisionEvidenceDigest(item.adoption);
function manifestValue(value,projectId){
 requireValue(fields(value,['schemaVersion','projectId','revision','decisions'])&&value.schemaVersion===1&&value.projectId===projectId&&revision(value.revision)&&Array.isArray(value.decisions)&&value.decisions.length<=PROJECT_DECISION_LIMITS.records&&Buffer.byteLength(JSON.stringify(value),'utf8')<=PROJECT_DECISION_LIMITS.journalBytes);
 const decisions=value.decisions.map(item=>normalizeProjectDecision(item,{projectId})),previous=new Map(),superseded=new Set();
 for(const item of decisions){
  requireValue(!previous.has(item.id));
  if(item.supersedes){const target=previous.get(item.supersedes);requireValue(target&&target.feature.id===item.feature.id&&!superseded.has(target.id));superseded.add(target.id);}
  const duplicate=[...previous.values()].findLast(other=>other.choice.comparisonId===item.choice.comparisonId&&adoptionKey(other)===adoptionKey(item));
  requireValue(!duplicate||item.supersedes===duplicate.id);
  previous.set(item.id,item);
 }
 return {schemaVersion:1,projectId,revision:value.revision,decisions};
}

/** Append-only local metadata. Loading, assessing, retrying and disposal never invoke source or provider actions. */
export function createProjectDecisionsStore({projectId,read,write,onChange=()=>{}}){
 if(!token(projectId)||![read,write,onChange].every(item=>typeof item==='function'))throw error('project-decision-configuration','A stable project identity and local storage adapters are required.');
 const empty=()=>({schemaVersion:1,projectId,revision:0,decisions:[]});
 let data=empty(),pending,pendingGuard,storage={status:'saved'},loaded=false,inFlight,closing=false,disposal;
 let projection,projectionData,projectionStorage,epoch=0;
 const snapshot=()=>({...copy(data),storage:{...storage}});
 const presentation=()=>{
  if(!projection||projectionData!==data||projectionStorage!==storage){projectionData=data;projectionStorage=storage;projection=Object.freeze({snapshot:freeze(snapshot()),epoch:++epoch});}
  return projection;
 };
 const notify=()=>{try{onChange();}catch{/* Observers do not own journal durability. */}};
 const readManifest=()=>{const value=read();return value===undefined||value===null?empty():manifestValue(value,projectId);};
 const unavailable=()=>{storage={status:'unavailable',message:UNAVAILABLE};notify();return error('project-decision-unavailable',UNAVAILABLE);};
 try{data=readManifest();loaded=true;}catch{storage={status:'unavailable',message:UNAVAILABLE};}
 const current=check=>{try{return !closing&&(!check||check()===true);}catch{return false;}};
 async function rollback(next){
  let disk;try{disk=readManifest();}catch{throw unavailable();}
  if(!equal(disk,data)){
   if(!equal(disk,next))throw unavailable();
   try{await write(copy(data));}catch{/* Read back below: a lost acknowledgement can still have restored the journal. */}
   try{if(!equal(readManifest(),data))throw unavailable();}catch{throw unavailable();}
  }
  pending=undefined;pendingGuard=undefined;storage={status:'saved'};notify();
 }
 async function persist(check){
  const next=pending;let disk;
  try{disk=readManifest();}catch{throw unavailable();}
  if(!equal(disk,data)&&!equal(disk,next))throw unavailable();
  if(!current(check)){await rollback(next);throw abort();}
  storage={status:'saving'};notify();
  let failure;
  if(!equal(disk,next)){try{await write(copy(next));}catch(cause){failure=cause;}}
  if(!current(check)){await rollback(next);throw abort();}
  if(failure){storage={status:'error',message:STORAGE_FAILED};notify();throw error('project-decision-storage',STORAGE_FAILED);}
  try{if(!equal(readManifest(),next))throw unavailable();}catch{throw unavailable();}
  if(!current(check)){await rollback(next);throw abort();}
  data=next;pending=undefined;pendingGuard=undefined;storage={status:'saved'};notify();
 }
 function execute(operation){
  if(closing)return Promise.reject(error('project-decision-closed','This project decision journal has closed.'));
  if(inFlight)return Promise.reject(error('project-decision-busy','A project decision is already being saved.'));
  const work=Promise.resolve().then(operation);inFlight=work;
  return work.finally(()=>{if(inFlight===work)inFlight=undefined;});
 }
 function refresh(){
  let disk;try{disk=readManifest();}catch{throw unavailable();}
  if(loaded&&!equal(disk,data))throw unavailable();
  data=disk;loaded=true;storage={status:'saved'};notify();return snapshot();
 }
 return {snapshot,presentation,
  load(){return execute(()=>pending?snapshot():refresh());},
  create(input,expectedRevision,{isCurrent}={}){
   let decision;
   try{
    requireValue(fields(input,['projectId','title','rationale','feature','choice','adoption','contextFiles'],['supersedes'])&&(isCurrent===undefined||typeof isCurrent==='function'));
    decision=normalizeProjectDecision({...copy(input),id:randomUUID(),createdAt:new Date().toISOString()},{projectId});
   }catch(cause){return Promise.reject(cause);}
   return execute(async()=>{
    if(!current(isCurrent))throw abort();
    if(storage.status==='unavailable')throw error('project-decision-unavailable',UNAVAILABLE);
    if(storage.status==='error'||pending)throw error('project-decision-storage',STORAGE_FAILED);
    if(!revision(expectedRevision)||expectedRevision!==data.revision)throw error('project-decision-stale','Project decisions changed. Review the latest saved history before recording another choice.');
    if(data.decisions.length>=PROJECT_DECISION_LIMITS.records||data.revision>=Number.MAX_SAFE_INTEGER-1)throw error('project-decision-capacity','This project has reached its decision history limit. Existing choices and rationales have been preserved.');
    if(decision.supersedes){
     const target=data.decisions.find(item=>item.id===decision.supersedes);
     if(!target||target.feature.id!==decision.feature.id||data.decisions.some(item=>item.supersedes===target.id))throw error('project-decision-supersedes','Choose a current decision from the same feature to supersede. Its original rationale will remain in history.');
    }
    const duplicate=data.decisions.findLast(item=>item.choice.comparisonId===decision.choice.comparisonId&&adoptionKey(item)===adoptionKey(decision));
    if(duplicate&&decision.supersedes!==duplicate.id)throw error('project-decision-duplicate','This applied choice already has a saved decision. Explicitly supersede it to record a new rationale.');
    const next={...data,revision:data.revision+1,decisions:[...data.decisions,decision]};
    if(Buffer.byteLength(JSON.stringify(next),'utf8')>PROJECT_DECISION_LIMITS.journalBytes)throw error('project-decision-capacity','The decision journal is full. Existing choices and rationales have been preserved.');
    pending=manifestValue(next,projectId);pendingGuard=isCurrent;
    await persist(isCurrent);return copy(decision);
   });
  },
  retry(){return execute(async()=>{
   if(pending){if(!current(pendingGuard)){await rollback(pending);return snapshot();}await persist(pendingGuard);return snapshot();}
   return refresh();
  });},
  dispose(){if(!disposal){closing=true;disposal=Promise.resolve(inFlight).catch(()=>{});}return disposal;}
 };
}
export {PROJECT_DECISION_LIMITS,normalizeProjectDecision,projectDecisionDigest};
