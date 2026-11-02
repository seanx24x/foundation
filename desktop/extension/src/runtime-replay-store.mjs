import {randomUUID} from 'node:crypto';

export const REPLAY_LIMITS=Object.freeze({records:40,steps:12,sources:32,manifestBytes:2*1024*1024});
export const REPLAY_REASONS=Object.freeze(['cancelled','timeout','runtime-changed','recipe-changed','step-failed','storage-failed','host-restarted','host-disposed','source-changed','context-changed','transport-failed','preview-changed']);
const copy=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,required,optional=[])=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value);
const token=value=>text(value,200)&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const title=value=>text(value,160);
const hex=(value,n)=>typeof value==='string'&&value.length===n&&/^[a-f0-9]+$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const sourcePath=value=>text(value,1024)&&!/[\\:]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const route=value=>typeof value==='string'&&value.length<=512&&/^\/[A-Za-z0-9/._~!$&'()*+,;=@-]*$/.test(value)&&!value.includes('//')&&!value.split('/').some(part=>part==='.'||part==='..')&&!/^\/__foundation(?:\/|$)/.test(value);
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const error=(code,message)=>Object.assign(new Error(message),{name:'RuntimeReplayError',code});
const invalid=()=>error('runtime-replay-invalid','The replay evidence could not be validated. Its saved history has been preserved.');
const requireValue=value=>{if(!value)throw invalid();};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const now=()=>new Date().toISOString();
const UNAVAILABLE='Saved replay evidence could not be read safely. Existing records have been left unchanged.';
const STORAGE_FAILED='Replay evidence could not be saved locally. Retry saving; application actions will not be repeated.';
const terminal=['completed','failed','cancelled','interrupted'];

function runtimeValue(value){
 requireValue(fields(value,['targetId','session','viewId','documentId','route','pageVersion'])&&token(value.targetId)&&hex(value.session,32)&&hex(value.viewId,32)&&hex(value.documentId,32)&&route(value.route)&&revision(value.pageVersion)&&value.pageVersion>=1);return copy(value);
}
function bindingValue(value){
 requireValue(fields(value,['startedAt','definitionRevision','runtime','sources','dirtyPaths'])&&timestamp(value.startedAt)&&revision(value.definitionRevision));
 const runtime=runtimeValue(value.runtime);
 requireValue(Array.isArray(value.sources)&&value.sources.length>=1&&value.sources.length<=REPLAY_LIMITS.sources&&Array.from(value.sources).every(item=>fields(item,['path','revision'])&&sourcePath(item.path)&&hex(item.revision,64))&&new Set(value.sources.map(item=>item.path)).size===value.sources.length);
 requireValue(Array.isArray(value.dirtyPaths)&&value.dirtyPaths.length<=REPLAY_LIMITS.sources&&Array.from(value.dirtyPaths).every(item=>sourcePath(item)&&value.sources.some(source=>source.path===item))&&new Set(value.dirtyPaths).size===value.dirtyPaths.length);
 return {startedAt:value.startedAt,definitionRevision:value.definitionRevision,runtime,sources:copy(value.sources),dirtyPaths:[...value.dirtyPaths]};
}
function contextValue(value,projectId){
 requireValue(fields(value,['projectId','runId','featureId','screenId','scenarioId','startedAt','definitionRevision','runtime','sources','dirtyPaths'])&&value.projectId===projectId&&['runId','featureId','screenId','scenarioId'].every(key=>token(value[key])));
 return {runId:value.runId,featureId:value.featureId,screenId:value.screenId,scenarioId:value.scenarioId,binding:bindingValue({startedAt:value.startedAt,definitionRevision:value.definitionRevision,runtime:value.runtime,sources:value.sources,dirtyPaths:value.dirtyPaths})};
}
function recipeValue(value){
 requireValue(fields(value,['id','title','route','fixture','registrationId','catalogDigest','steps'])&&token(value.id)&&title(value.title)&&route(value.route)&&fields(value.fixture,['id','label'])&&token(value.fixture.id)&&title(value.fixture.label)&&hex(value.registrationId,32)&&hex(value.catalogDigest,64));
 requireValue(Array.isArray(value.steps)&&value.steps.length<=REPLAY_LIMITS.steps&&Array.from(value.steps).every(item=>fields(item,['id','title'])&&token(item.id)&&title(item.title))&&new Set(value.steps.map(item=>item.id)).size===value.steps.length);
 return copy(value);
}
function requestedValue(value){
 requireValue(fields(value,['theme','motion','viewportWidthCss','viewportHeightCss'])&&['light','dark'].includes(value.theme)&&['system','reduce'].includes(value.motion)&&[390,768,960].includes(value.viewportWidthCss)&&value.viewportHeightCss===680);return copy(value);
}
function observedValue(value){
 requireValue(fields(value,['viewportWidthCss','viewportHeightCss','deviceScaleFactor','colorSchemePreference','reducedMotionPreference'])&&Number.isInteger(value.viewportWidthCss)&&finite(value.viewportWidthCss,1,16384)&&Number.isInteger(value.viewportHeightCss)&&finite(value.viewportHeightCss,1,16384)&&finite(value.deviceScaleFactor,0.1,8)&&['light','dark'].includes(value.colorSchemePreference)&&['reduce','no-preference'].includes(value.reducedMotionPreference));return copy(value);
}
function unitValue(value,id){
 requireValue(fields(value,['id','status','effects'],['startedAt','endedAt'])&&value.id===id&&['pending','running',...terminal].includes(value.status));
 if(value.status==='pending')requireValue(value.effects==='not-started'&&!Object.hasOwn(value,'startedAt')&&!Object.hasOwn(value,'endedAt'));
 else {requireValue(value.effects==='unknown'&&timestamp(value.startedAt));requireValue(value.status==='running'?!Object.hasOwn(value,'endedAt'):timestamp(value.endedAt));}
 return copy(value);
}
function recordValue(value){
 requireValue(fields(value,['id','executionId','runId','featureId','screenId','scenarioId','binding','recipe','requested','startedAt','status','prepare','steps','observed','sourceRelationship'],['endedAt','reason'])&&uuid(value.id)&&hex(value.executionId,32)&&['runId','featureId','screenId','scenarioId'].every(key=>token(value[key]))&&timestamp(value.startedAt)&&['running',...terminal].includes(value.status)&&value.sourceRelationship==='unverified');
 const binding=bindingValue(value.binding),recipe=recipeValue(value.recipe),requested=requestedValue(value.requested),prepare=unitValue(value.prepare,'prepare');
 requireValue(recipe.route===binding.runtime.route&&Array.isArray(value.steps)&&value.steps.length===recipe.steps.length);
 const steps=Array.from(value.steps).map((item,index)=>unitValue(item,recipe.steps[index].id));
 const observed=value.observed===null?null:observedValue(value.observed),units=[prepare,...steps];
 let stopped=false,active=0;for(const unit of units){if(unit.status==='completed'){requireValue(!stopped);continue;}if(unit.status==='pending'){stopped=true;continue;}requireValue(!stopped);stopped=true;active++;}
 requireValue(active<=1);
 if(value.status==='running')requireValue(!Object.hasOwn(value,'endedAt')&&!Object.hasOwn(value,'reason')&&units.every(unit=>['pending','running','completed'].includes(unit.status)));
 else {requireValue(timestamp(value.endedAt)&&!units.some(unit=>unit.status==='running'));if(value.status==='completed')requireValue(units.every(unit=>unit.status==='completed')&&!Object.hasOwn(value,'reason'));else requireValue(REPLAY_REASONS.includes(value.reason)&&units.every(unit=>['pending','completed',value.status].includes(unit.status)));}
 return {id:value.id,executionId:value.executionId,runId:value.runId,featureId:value.featureId,screenId:value.screenId,scenarioId:value.scenarioId,binding,recipe,requested,startedAt:value.startedAt,status:value.status,prepare,steps,observed,sourceRelationship:'unverified',...(value.endedAt?{endedAt:value.endedAt}:{}),...(value.reason?{reason:value.reason}:{})};
}
function manifestValue(value,projectId){
 requireValue(fields(value,['schemaVersion','projectId','revision','replays'])&&value.schemaVersion===1&&value.projectId===projectId&&revision(value.revision)&&Array.isArray(value.replays)&&value.replays.length<=REPLAY_LIMITS.records);
 const replays=Array.from(value.replays).map(recordValue);
 for(const key of ['id','executionId','runId'])requireValue(new Set(replays.map(item=>item[key])).size===replays.length);
 requireValue(replays.filter(item=>item.status==='running').length<=1);
 const result={schemaVersion:1,projectId,revision:value.revision,replays};requireValue(Buffer.byteLength(JSON.stringify(result),'utf8')<=REPLAY_LIMITS.manifestBytes);return result;
}
function stop(record,status,reason){
 const endedAt=now();record.status=status;record.endedAt=endedAt;if(reason)record.reason=reason;
 for(const unit of [record.prepare,...record.steps])if(unit.status==='running'){unit.status=status;unit.endedAt=endedAt;}
}

/** Durable execution evidence only. This store never invokes a runtime, changes an observation, or resumes application work. */
export function createRuntimeReplayStore({projectId,read,write,onChange=()=>{}}){
 if(!token(projectId)||typeof read!=='function'||typeof write!=='function'||typeof onChange!=='function')throw error('runtime-replay-configuration','A local project identity and storage adapters are required.');
 const empty=()=>({schemaVersion:1,projectId,revision:0,replays:[]});
 let data=empty(),committed=empty(),storage={status:'saved'},loaded=false,pending=false,inFlight,closing=false,disposal;
 const snapshot=()=>({...copy(data),storage:{...storage}});
 const notify=()=>{try{onChange();}catch{}};
 function readManifest(){const value=read();return value===undefined||value===null?empty():manifestValue(value,projectId);}
 function load(){
  let next=readManifest();const baseline=copy(next),active=next.replays.find(item=>item.status==='running');
  if(active){requireValue(next.revision<Number.MAX_SAFE_INTEGER-1);stop(active,'interrupted','host-restarted');next.revision++;next=manifestValue(next,projectId);}
  committed=baseline;data=next;loaded=true;pending=Boolean(active);storage={status:pending?'saving':'saved'};
 }
 function markUnavailable(){storage={status:'unavailable',message:UNAVAILABLE};notify();throw error('runtime-replay-unavailable',UNAVAILABLE);}
 async function persist(){
  storage={status:'saving'};notify();let disk;
  try{disk=readManifest();}catch{return markUnavailable();}
  if(equal(disk,data)){committed=copy(data);pending=false;storage={status:'saved'};notify();return;}
  if(!equal(disk,committed))return markUnavailable();
  try{await write(copy(data));}catch{storage={status:'error',message:STORAGE_FAILED};notify();throw error('runtime-replay-storage',STORAGE_FAILED);}
  try{disk=readManifest();}catch{return markUnavailable();}
  if(!equal(disk,data))return markUnavailable();
  committed=copy(data);pending=false;storage={status:'saved'};notify();
 }
 function operation(action,{internal=false}={}){
  if(closing&&!internal)return Promise.reject(error('runtime-replay-closed','This replay evidence store has closed.'));
  if(inFlight)return Promise.reject(error('runtime-replay-busy','Replay evidence is being saved. Wait for it to finish before continuing.'));
  const result=Promise.resolve().then(action);inFlight=result;result.finally(()=>{if(inFlight===result)inFlight=undefined;}).catch(()=>{});return result;
 }
 function available(expected){
  if(storage.status==='unavailable')throw error('runtime-replay-unavailable',UNAVAILABLE);
  if(storage.status==='error')throw error('runtime-replay-storage',STORAGE_FAILED);
  if(expected!==undefined&&(!revision(expected)||expected!==data.revision))throw error('runtime-replay-stale','Replay history changed. Review its latest saved state.');
 }
 const locate=(next,id)=>{const record=next.replays.find(item=>item.id===id);if(!record)throw error('runtime-replay-unknown','Choose replay evidence in the current project.');if(record.status!=='running')throw error('runtime-replay-finished','This replay has finished. Its original evidence has been preserved.');return record;};
 async function mutate(transform,expected){
  available(expected);const next=copy(data),id=transform(next);requireValue(next.revision<Number.MAX_SAFE_INTEGER-1);next.revision++;let validated;
  try{validated=manifestValue(next,projectId);}catch{if(Buffer.byteLength(JSON.stringify(next),'utf8')>REPLAY_LIMITS.manifestBytes)throw error('runtime-replay-capacity','Local replay history is full. Existing records have been preserved.');throw invalid();}
  data=validated;pending=true;await persist();return copy(data.replays.find(item=>item.id===id));
 }
 function captured(input,action){
  if(inFlight)return Promise.reject(error('runtime-replay-busy','Replay evidence is being saved. Wait for it to finish before continuing.'));
  let value;try{value=copy(input);}catch{return Promise.reject(invalid());}return operation(()=>action(value));
 }
 try{load();}catch{storage={status:'unavailable',message:UNAVAILABLE};}
 if(pending)operation(persist,{internal:true}).catch(()=>{});
 return Object.freeze({
  snapshot,
  // Constant-time ownership guard; never clones retained replay history.
  state:()=>({revision:data.revision,storageStatus:storage.status}),
  begin(input,expectedRevision){return captured(input,value=>mutate(next=>{
   if(!revision(expectedRevision))throw error('runtime-replay-stale','Use the current replay history revision.');
   requireValue(fields(value,['context','executionId','recipe','requested'])&&hex(value.executionId,32));
   const context=contextValue(value.context,projectId),recipe=recipeValue(value.recipe),requested=requestedValue(value.requested);requireValue(recipe.route===context.binding.runtime.route);
   if(next.replays.some(item=>item.runId===context.runId))throw error('runtime-replay-already-exists','This observation already has replay evidence. Begin another observation to replay again.');
   if(next.replays.some(item=>item.executionId===value.executionId))throw error('runtime-replay-already-exists','This replay execution already has evidence.');
   if(next.replays.some(item=>item.status==='running'))throw error('runtime-replay-running','Finish the current replay before starting another.');
   if(next.replays.length>=REPLAY_LIMITS.records)throw error('runtime-replay-capacity','This project has reached its 40-replay limit. Existing evidence has been preserved.');
   const unit=id=>({id,status:'pending',effects:'not-started'}),record={id:randomUUID(),executionId:value.executionId,...context,recipe,requested,startedAt:now(),status:'running',prepare:unit('prepare'),steps:recipe.steps.map(step=>unit(step.id)),observed:null,sourceRelationship:'unverified'};
   next.replays.push(record);return record.id;
  },expectedRevision));},
  update(id,progress){return captured(progress,value=>mutate(next=>{
   requireValue(fields(value,['phase','status'],['stepId','observed'])&&['prepare','step'].includes(value.phase)&&['running','completed'].includes(value.status));
   requireValue(value.phase==='prepare'?!Object.hasOwn(value,'stepId'):token(value.stepId));
   requireValue(!Object.hasOwn(value,'observed')||value.status==='completed');
   const observed=Object.hasOwn(value,'observed')?observedValue(value.observed):undefined,record=locate(next,id),units=[record.prepare,...record.steps],index=value.phase==='prepare'?0:record.steps.findIndex(unit=>unit.id===value.stepId)+1;
   requireValue(value.phase==='prepare'||index>0);const unit=units[index];requireValue(units.slice(0,index).every(item=>item.status==='completed')&&units.slice(index+1).every(item=>item.status==='pending'));
   if(value.status==='running'){requireValue(unit.status==='pending');unit.status='running';unit.startedAt=now();unit.effects='unknown';}
   else{requireValue(unit.status==='running');unit.status='completed';unit.endedAt=now();if(observed)record.observed=observed;}
   return record.id;
  }));},
  finish(id,result){return captured(result,value=>mutate(next=>{
   requireValue(fields(value,['status'],['reason'])&&terminal.includes(value.status));const record=locate(next,id);
   if(value.status==='completed'){requireValue(!Object.hasOwn(value,'reason')&&[record.prepare,...record.steps].every(unit=>unit.status==='completed'));stop(record,'completed');}
   else{const reason=value.reason??({failed:'step-failed',cancelled:'cancelled',interrupted:'runtime-changed'}[value.status]);requireValue(REPLAY_REASONS.includes(reason));stop(record,value.status,reason);}
   return record.id;
  }));},
  retry(){
   if(closing)return Promise.reject(error('runtime-replay-closed','This replay evidence store has closed.'));
   if(inFlight)return inFlight.then(()=>snapshot());
   return operation(async()=>{if(!loaded){try{load();notify();}catch{return markUnavailable();}}if(pending)await persist();else{let disk;try{disk=readManifest();}catch{return markUnavailable();}if(!equal(disk,committed))return markUnavailable();storage={status:'saved'};notify();}return snapshot();});
  },
  dispose(){
   if(!disposal){closing=true;disposal=(async()=>{try{await inFlight;}catch{}if(!loaded||pending||storage.status!=='saved')return;const active=data.replays.find(item=>item.status==='running');if(!active)return;await operation(()=>mutate(next=>{const record=locate(next,active.id);stop(record,'interrupted','host-disposed');return record.id;}),{internal:true});})();}return disposal;
  }
 });
}
