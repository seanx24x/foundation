import {randomUUID} from 'node:crypto';
import {normalizeReproducibleIssue,reproducibleIssueDigest,reproducibleIssueEvidenceDigest,REPRODUCIBLE_ISSUE_LIMITS} from '../../../server/project/reproducible-issues.mjs';
const copy=value=>structuredClone(value);
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const list=value=>Array.isArray(value)&&Object.keys(value).length===value.length&&Array.from(value).every((_item,index)=>Object.hasOwn(value,index));
const fields=(value,required)=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key));
const token=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
const equal=(left,right)=>reproducibleIssueEvidenceDigest(left)===reproducibleIssueEvidenceDigest(right);
const error=(code,message)=>Object.assign(new Error(message),{name:'ReproducibleIssueStoreError',code});
const invalid=()=>error('reproducible-issue-invalid','The issue could not be validated. Existing reports and evidence are unchanged.');
const requireValue=value=>{if(!value)throw invalid();};
const UNAVAILABLE='Saved issues changed outside this session or could not be read safely. Their original evidence has been left unchanged.';
const STORAGE_FAILED='The issue could not be saved locally. Retry saving; no source, runtime, capture or Assistant action will be repeated.';
const abort=()=>Object.assign(error('reproducible-issue-cancelled','The source or issue context changed before the issue was saved.'),{name:'AbortError'});
const reportKey=item=>reproducibleIssueEvidenceDigest({runDigest:item.runDigest,title:item.title,actualOutcome:item.actualOutcome,reproduction:item.reproduction,replay:item.replay,capture:item.capture,contextFiles:item.contextFiles});
function manifestValue(value,projectId){
 requireValue(fields(value,['schemaVersion','projectId','revision','issues'])&&value.schemaVersion===1&&value.projectId===projectId&&revision(value.revision)&&list(value.issues)&&value.issues.length<=REPRODUCIBLE_ISSUE_LIMITS.records&&Buffer.byteLength(JSON.stringify(value),'utf8')<=REPRODUCIBLE_ISSUE_LIMITS.journalBytes);
 const issues=value.issues.map(item=>normalizeReproducibleIssue(item,{projectId}));requireValue(new Set(issues.map(item=>item.id)).size===issues.length&&new Set(issues.map(reportKey)).size===issues.length);return {schemaVersion:1,projectId,revision:value.revision,issues};
}
/** Append-only local metadata. Loading, assessing and retrying never repeat application or provider work. */
export function createReproducibleIssuesStore({projectId,read,write,onChange=()=>{}}){
 if(!token(projectId)||![read,write,onChange].every(item=>typeof item==='function'))throw error('reproducible-issue-configuration','A stable project identity and local storage adapters are required.');
 const empty=()=>({schemaVersion:1,projectId,revision:0,issues:[]});
 let data=empty(),pending,pendingGuard,storage={status:'saved'},loaded=false,inFlight,closing=false,disposal;
 let projection,projectionData,projectionStorage,epoch=0;
 const snapshot=()=>({...copy(data),storage:{...storage}});
 const presentation=()=>{if(!projection||projectionData!==data||projectionStorage!==storage){projectionData=data;projectionStorage=storage;projection=Object.freeze({snapshot:freeze(snapshot()),epoch:++epoch});}return projection;};
 const notify=()=>{try{onChange();}catch{/* Observers do not own durability. */}};
 const readManifest=()=>{const value=read();return value===undefined||value===null?empty():manifestValue(value,projectId);};
 const unavailable=()=>{storage={status:'unavailable',message:UNAVAILABLE};notify();return error('reproducible-issue-unavailable',UNAVAILABLE);};
 try{data=readManifest();loaded=true;}catch{storage={status:'unavailable',message:UNAVAILABLE};}
 const current=check=>{try{return !closing&&(!check||check()===true);}catch{return false;}};
 async function rollback(next){
  let disk;try{disk=readManifest();}catch{throw unavailable();}
  if(!equal(disk,data)){
   if(!equal(disk,next))throw unavailable();
   try{await write(copy(data));}catch{/* A lost acknowledgement may still have restored the original journal. */}
   try{if(!equal(readManifest(),data))throw unavailable();}catch{throw unavailable();}
  }
  pending=undefined;pendingGuard=undefined;storage={status:'saved'};notify();
 }
 async function persist(check){
  const next=pending;let disk;try{disk=readManifest();}catch{throw unavailable();}
  if(!equal(disk,data)&&!equal(disk,next))throw unavailable();
  if(!current(check)){await rollback(next);throw abort();}
  storage={status:'saving'};notify();let failure;
  if(!equal(disk,next)){try{await write(copy(next));}catch(cause){failure=cause;}}
  if(!current(check)){await rollback(next);throw abort();}
  if(failure){storage={status:'error',message:STORAGE_FAILED};notify();throw error('reproducible-issue-storage',STORAGE_FAILED);}
  try{if(!equal(readManifest(),next))throw unavailable();}catch{throw unavailable();}
  if(!current(check)){await rollback(next);throw abort();}
  data=next;pending=undefined;pendingGuard=undefined;storage={status:'saved'};notify();
 }
 function execute(operation){
  if(closing)return Promise.reject(error('reproducible-issue-closed','This issue journal has closed.'));
  if(inFlight)return Promise.reject(error('reproducible-issue-busy','An issue is already being saved.'));
  const work=Promise.resolve().then(operation);inFlight=work;return work.finally(()=>{if(inFlight===work)inFlight=undefined;});
 }
 function refresh(){let disk;try{disk=readManifest();}catch{throw unavailable();}if(loaded&&!equal(disk,data))throw unavailable();data=disk;loaded=true;storage={status:'saved'};notify();return snapshot();}
 return {snapshot,presentation,
  load(){return execute(()=>pending?snapshot():refresh());},
  create(input,expectedRevision,{isCurrent}={}){
   let issue;try{requireValue(fields(input,['projectId','title','actualOutcome','reproduction','run','runDigest','contextFiles','replay','capture','sourceRelationship','compilation'])&&(isCurrent===undefined||typeof isCurrent==='function'));issue=normalizeReproducibleIssue({...copy(input),id:randomUUID(),createdAt:new Date().toISOString()},{projectId});}catch(cause){return Promise.reject(cause);}
   return execute(async()=>{
    if(!current(isCurrent))throw abort();
    if(storage.status==='unavailable')throw error('reproducible-issue-unavailable',UNAVAILABLE);
    if(storage.status==='error'||pending)throw error('reproducible-issue-storage',STORAGE_FAILED);
    if(!revision(expectedRevision)||expectedRevision!==data.revision)throw error('reproducible-issue-stale','Issue history changed. Review its latest saved state before recording another report.');
    if(data.issues.length>=REPRODUCIBLE_ISSUE_LIMITS.records||data.revision>=Number.MAX_SAFE_INTEGER-1)throw error('reproducible-issue-capacity','This project has reached its issue history limit. Existing reports have been preserved.');
    const key=reportKey(issue);if(data.issues.some(item=>reportKey(item)===key))throw error('reproducible-issue-duplicate','This report and its exact evidence are already saved. Review the existing issue.');
    const next={...data,revision:data.revision+1,issues:[...data.issues,issue]};
    if(Buffer.byteLength(JSON.stringify(next),'utf8')>REPRODUCIBLE_ISSUE_LIMITS.journalBytes)throw error('reproducible-issue-capacity','The issue journal is full. Existing reports have been preserved.');
    pending=manifestValue(next,projectId);pendingGuard=isCurrent;await persist(isCurrent);return copy(issue);
   });
  },
  retry(){return execute(async()=>{if(pending){if(!current(pendingGuard)){await rollback(pending);return snapshot();}await persist(pendingGuard);return snapshot();}return refresh();});},
  dispose(){if(!disposal){closing=true;disposal=Promise.resolve(inFlight).catch(()=>{});}return disposal;}
 };
}
export {REPRODUCIBLE_ISSUE_LIMITS,normalizeReproducibleIssue,reproducibleIssueDigest};
