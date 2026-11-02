import {randomUUID,randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {REPLAY_REASONS} from './runtime-replay-store.mjs';
import {STATE_SUITE_STATES} from './runtime-state-suite-store.mjs';

export const MATRIX_LIMITS=Object.freeze({records:40,cells:12,sources:32,steps:12,manifestBytes:2*1024*1024});
export const MATRIX_REASONS=Object.freeze([...REPLAY_REASONS,'capture-failed','observation-failed','capacity']);
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
const error=(code,message)=>Object.assign(new Error(message),{name:'RuntimeMatrixError',code});
const invalid=()=>error('runtime-matrix-invalid','The matrix evidence could not be validated. Its saved history has been preserved.');
const requireValue=value=>{if(!value)throw invalid();};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const now=()=>new Date().toISOString();
const UNAVAILABLE='Saved matrix evidence could not be read safely. Existing records have been left unchanged.';
const STORAGE_FAILED='Matrix evidence could not be saved locally. Retry saving; this matrix will stop without repeating application actions.';
const terminal=['completed','failed','cancelled','interrupted'];


const plainText=(value,max)=>typeof value==='string'&&value.length<=max&&!value.includes('\0');
const shortTitle=value=>text(value,80);
const unique=values=>new Set(values).size===values.length;
function pathList(value){requireValue(Array.isArray(value)&&value.length<=MATRIX_LIMITS.sources&&Array.from(value).every(sourcePath)&&unique(value));return [...value];}
function screenValue(value){
 requireValue(fields(value,['id','featureId','title','targetId','route','archived','createdAt','updatedAt'])&&uuid(value.id)&&uuid(value.featureId)&&shortTitle(value.title)&&token(value.targetId)&&route(value.route)&&value.archived===false&&timestamp(value.createdAt)&&timestamp(value.updatedAt));return copy(value);
}
function scenarioValue(value){
 requireValue(fields(value,['id','screenId','title','steps','expectedOutcome','archived','createdAt','updatedAt'])&&uuid(value.id)&&uuid(value.screenId)&&shortTitle(value.title)&&Array.isArray(value.steps)&&value.steps.length>=1&&value.steps.length<=12&&Array.from(value.steps).every(item=>plainText(item,500)&&item.trim().length>0)&&plainText(value.expectedOutcome,2000)&&value.expectedOutcome.trim().length>0&&value.archived===false&&timestamp(value.createdAt)&&timestamp(value.updatedAt));return copy(value);
}
function recipeValue(value){
 requireValue(fields(value,['id','title','route','fixture','registrationId','catalogDigest','steps'])&&token(value.id)&&title(value.title)&&route(value.route)&&fields(value.fixture,['id','label'])&&token(value.fixture.id)&&title(value.fixture.label)&&hex(value.registrationId,32)&&hex(value.catalogDigest,64));
 requireValue(Array.isArray(value.steps)&&value.steps.length<=MATRIX_LIMITS.steps&&Array.from(value.steps).every(item=>fields(item,['id','title'])&&token(item.id)&&title(item.title))&&unique(value.steps.map(item=>item.id)));return copy(value);
}
function requestedValue(value){requireValue(fields(value,['theme','motion','viewportWidthCss','viewportHeightCss'])&&['light','dark'].includes(value.theme)&&['system','reduce'].includes(value.motion)&&[390,768,960].includes(value.viewportWidthCss)&&value.viewportHeightCss===680);return {theme:value.theme,motion:value.motion,viewportWidthCss:value.viewportWidthCss,viewportHeightCss:680};}
function basisValue(value,legacy=false){
 requireValue(fields(value,['feature','screen','scenario','definitionRevision','sources','dirtyPaths','recipe'],legacy?[]:['suite'])&&fields(value.feature,['id','title','revision','paths'])&&uuid(value.feature.id)&&shortTitle(value.feature.title)&&revision(value.feature.revision)&&revision(value.definitionRevision));
 const feature={id:value.feature.id,title:value.feature.title,revision:value.feature.revision,paths:pathList(value.feature.paths)},screen=screenValue(value.screen),scenario=scenarioValue(value.scenario),recipe=recipeValue(value.recipe);
 requireValue(feature.paths.length>0&&screen.featureId===feature.id&&scenario.screenId===screen.id&&screen.route===recipe.route);
 requireValue(Array.isArray(value.sources)&&value.sources.length===feature.paths.length&&Array.from(value.sources).every(item=>fields(item,['path','revision'])&&feature.paths.includes(item.path)&&hex(item.revision,64))&&unique(value.sources.map(item=>item.path)));
 const dirtyPaths=pathList(value.dirtyPaths);requireValue(dirtyPaths.every(path=>feature.paths.includes(path)));
 let suite;
 if(Object.hasOwn(value,'suite')){
  const input=value.suite;requireValue(fields(input,['id','title','revision','states'])&&uuid(input.id)&&shortTitle(input.title)&&revision(input.revision)&&input.revision>=1&&Array.isArray(input.states)&&input.states.length>=1&&input.states.length<=5);
  const states=Array.from(input.states).map(item=>{requireValue(fields(item,['state','recipe'])&&STATE_SUITE_STATES.includes(item.state));return {state:item.state,recipe:recipeValue(item.recipe)};});
  requireValue(unique(states.map(item=>item.state))&&unique(states.map(item=>item.recipe.id))&&isDeepStrictEqual(states[0].recipe,recipe)&&states.every(item=>item.recipe.route===screen.route&&item.recipe.catalogDigest===recipe.catalogDigest&&item.recipe.registrationId===recipe.registrationId));
  suite={id:input.id,title:input.title,revision:input.revision,states};
 }
 return {feature,screen,scenario,definitionRevision:value.definitionRevision,sources:copy(value.sources),dirtyPaths,recipe,...(suite?{suite}:{})};
}
function cellValue(value,captureEach,suite){
 requireValue(fields(value,['id','runId','replayExecutionId','requested','status','observationLinked',...(suite?['state']:[])],['startedAt','endedAt','replayId','captureId','reason'])&&uuid(value.id)&&uuid(value.runId)&&hex(value.replayExecutionId,32)&&['not-run','running',...terminal].includes(value.status)&&typeof value.observationLinked==='boolean');
 if(suite)requireValue(STATE_SUITE_STATES.includes(value.state));
 const requested=requestedValue(value.requested);
 if(Object.hasOwn(value,'replayId'))requireValue(uuid(value.replayId)&&value.observationLinked);
 if(Object.hasOwn(value,'captureId'))requireValue(uuid(value.captureId)&&Object.hasOwn(value,'replayId')&&captureEach);
 if(value.status==='not-run')requireValue(!value.observationLinked&&!Object.hasOwn(value,'startedAt')&&!Object.hasOwn(value,'endedAt')&&!Object.hasOwn(value,'reason')&&!Object.hasOwn(value,'replayId')&&!Object.hasOwn(value,'captureId'));
 else {requireValue(timestamp(value.startedAt));if(value.status==='running')requireValue(!Object.hasOwn(value,'endedAt')&&!Object.hasOwn(value,'reason'));else {requireValue(timestamp(value.endedAt));if(value.status==='completed')requireValue(!Object.hasOwn(value,'reason')&&value.observationLinked&&uuid(value.replayId)&&(!captureEach||uuid(value.captureId)));else requireValue(MATRIX_REASONS.includes(value.reason));}}
 return {...copy(value),requested};
}
function suiteCellOrder(cells,suite){
 if(!suite){requireValue(unique(cells.map(item=>JSON.stringify(item.requested))));return;}
 const count=cells.length/suite.states.length;requireValue(Number.isSafeInteger(count)&&count>=1);
 const requested=cells.slice(0,count).map(item=>item.requested);
 requireValue(unique(requested.map(item=>JSON.stringify(item)))&&new Set(requested.map(item=>item.theme)).size*new Set(requested.map(item=>item.motion)).size*new Set(requested.map(item=>item.viewportWidthCss)).size===count);
 for(let stateIndex=0;stateIndex<suite.states.length;stateIndex++)for(let index=0;index<count;index++){
  const cell=cells[stateIndex*count+index];requireValue(cell.state===suite.states[stateIndex].state&&equal(cell.requested,requested[index]));
 }
}
function recordValue(value,legacy=false){
 requireValue(fields(value,['id','executionId','basis','captureEach','startedAt','status','cells','sourceRelationship'],['endedAt','reason'])&&uuid(value.id)&&hex(value.executionId,32)&&typeof value.captureEach==='boolean'&&timestamp(value.startedAt)&&['running',...terminal].includes(value.status)&&value.sourceRelationship==='unverified');
 const basis=basisValue(value.basis,legacy);requireValue(Array.isArray(value.cells)&&value.cells.length>=1&&value.cells.length<=MATRIX_LIMITS.cells);
 const cells=Array.from(value.cells).map(item=>cellValue(item,value.captureEach,basis.suite));suiteCellOrder(cells,basis.suite);
 let stopped=false,active=0;for(const cell of cells){if(cell.status==='completed'){requireValue(!stopped);continue;}if(cell.status==='not-run'){stopped=true;continue;}requireValue(!stopped);stopped=true;active++;}requireValue(active<=1);
 if(value.status==='running')requireValue(!Object.hasOwn(value,'endedAt')&&!Object.hasOwn(value,'reason'));
 else {requireValue(timestamp(value.endedAt)&&!cells.some(cell=>cell.status==='running'));if(value.status==='completed')requireValue(cells.every(cell=>cell.status==='completed')&&!Object.hasOwn(value,'reason'));else requireValue(MATRIX_REASONS.includes(value.reason));}
 return {id:value.id,executionId:value.executionId,basis,captureEach:value.captureEach,startedAt:value.startedAt,status:value.status,cells,sourceRelationship:'unverified',...(value.endedAt?{endedAt:value.endedAt}:{}),...(value.reason?{reason:value.reason}:{})};
}
function manifestValue(value,projectId){
 requireValue(fields(value,['schemaVersion','projectId','revision','matrices'])&&[1,2].includes(value.schemaVersion)&&value.projectId===projectId&&revision(value.revision)&&Array.isArray(value.matrices)&&value.matrices.length<=MATRIX_LIMITS.records);
 const matrices=Array.from(value.matrices).map(item=>recordValue(item,value.schemaVersion===1)),cells=matrices.flatMap(item=>item.cells);
 requireValue(unique(matrices.map(item=>item.id))&&unique(matrices.map(item=>item.executionId))&&matrices.filter(item=>item.status==='running').length<=1);
 for(const key of ['id','runId','replayExecutionId','replayId','captureId'])requireValue(unique(cells.filter(item=>Object.hasOwn(item,key)).map(item=>item[key])));
 const result={schemaVersion:2,projectId,revision:value.revision,matrices};requireValue(Buffer.byteLength(JSON.stringify(result),'utf8')<=MATRIX_LIMITS.manifestBytes);return result;
}
function stop(record,status,reason){
 const endedAt=now();record.status=status;record.endedAt=endedAt;if(reason)record.reason=reason;
 for(const cell of record.cells)if(cell.status==='running'){cell.status=status;cell.endedAt=endedAt;if(reason)cell.reason=reason;}
}
function linkValue(record,cell,value){
 requireValue(fields(value,[],['runId','replayId','captureId'])&&Object.keys(value).length>0);
 if(Object.hasOwn(value,'runId')){requireValue(value.runId===cell.runId);cell.observationLinked=true;}
 if(Object.hasOwn(value,'replayId')){requireValue(cell.observationLinked&&uuid(value.replayId)&&(!cell.replayId||cell.replayId===value.replayId));cell.replayId=value.replayId;}
 if(Object.hasOwn(value,'captureId')){requireValue(record.captureEach&&cell.replayId&&uuid(value.captureId)&&(!cell.captureId||cell.captureId===value.captureId));cell.captureId=value.captureId;}
}
function resultValue(value){requireValue(fields(value,['status'],['reason'])&&terminal.includes(value.status));requireValue(value.status==='completed'?!Object.hasOwn(value,'reason'):MATRIX_REASONS.includes(value.reason));return value;}

/** A local write-ahead orchestration journal. No runtime, observation, replay, or image is executed or assessed here. */
export function createRuntimeMatrixStore({projectId,read,write,onChange=()=>{}}){
 if(!token(projectId)||typeof read!=='function'||typeof write!=='function'||typeof onChange!=='function')throw error('runtime-matrix-configuration','A local project identity and storage adapters are required.');
 const empty=()=>({schemaVersion:2,projectId,revision:0,matrices:[]});
 let data=empty(),committed=empty(),storage={status:'saved'},loaded=false,pending=false,inFlight,closing=false,disposal;
 const snapshot=()=>({...copy(data),storage:{...storage}});
 const notify=()=>{try{onChange();}catch{}};
 function readManifest(){const value=read();return value===undefined||value===null?empty():manifestValue(value,projectId);}
 function load(){
  let next=readManifest();const baseline=copy(next),active=next.matrices.find(item=>item.status==='running');
  if(active){requireValue(next.revision<Number.MAX_SAFE_INTEGER-1);stop(active,'interrupted','host-restarted');next.revision++;next=manifestValue(next,projectId);}
  committed=baseline;data=next;loaded=true;pending=Boolean(active);storage={status:pending?'saving':'saved'};
 }
 function markUnavailable(){storage={status:'unavailable',message:UNAVAILABLE};notify();throw error('runtime-matrix-unavailable',UNAVAILABLE);}
 async function persist(){
  storage={status:'saving'};notify();let disk;
  try{disk=readManifest();}catch{return markUnavailable();}
  if(equal(disk,data)){committed=copy(data);pending=false;storage={status:'saved'};notify();return;}
  if(!equal(disk,committed))return markUnavailable();
  try{await write(copy(data));}catch{storage={status:'error',message:STORAGE_FAILED};notify();throw error('runtime-matrix-storage',STORAGE_FAILED);}
  try{disk=readManifest();}catch{return markUnavailable();}
  if(!equal(disk,data))return markUnavailable();
  committed=copy(data);pending=false;storage={status:'saved'};notify();
 }
 function operation(action,{internal=false}={}){
  if(closing&&!internal)return Promise.reject(error('runtime-matrix-closed','This matrix evidence store has closed.'));
  if(inFlight)return Promise.reject(error('runtime-matrix-busy','Matrix evidence is being saved. Wait for it to finish before continuing.'));
  const result=Promise.resolve().then(action);inFlight=result;result.finally(()=>{if(inFlight===result)inFlight=undefined;}).catch(()=>{});return result;
 }
 function available(expected){
  if(storage.status==='unavailable')throw error('runtime-matrix-unavailable',UNAVAILABLE);
  if(storage.status==='error')throw error('runtime-matrix-storage',STORAGE_FAILED);
  if(expected!==undefined&&(!revision(expected)||expected!==data.revision))throw error('runtime-matrix-stale','Matrix history changed. Review its latest saved state.');
 }
 const locate=(next,id)=>{const record=next.matrices.find(item=>item.id===id);if(!record)throw error('runtime-matrix-unknown','Choose matrix evidence in the current project.');if(record.status!=='running')throw error('runtime-matrix-finished','This matrix has finished. Its original evidence has been preserved.');return record;};
 const locateCell=(record,id)=>{const cell=record.cells.find(item=>item.id===id);if(!cell)throw error('runtime-matrix-unknown','Choose a cell in this matrix.');return cell;};
 async function mutate(transform,expected){
  available(expected);const next=copy(data),id=transform(next);requireValue(next.revision<Number.MAX_SAFE_INTEGER-1);next.revision++;let validated;
  try{validated=manifestValue(next,projectId);}catch{if(Buffer.byteLength(JSON.stringify(next),'utf8')>MATRIX_LIMITS.manifestBytes)throw error('runtime-matrix-capacity','Local matrix history is full. Existing records have been preserved.');throw invalid();}
  data=validated;pending=true;await persist();return copy(data.matrices.find(item=>item.id===id));
 }
 function captured(input,action){if(inFlight)return Promise.reject(error('runtime-matrix-busy','Matrix evidence is being saved. Wait for it to finish before continuing.'));let value;try{value=copy(input);}catch{return Promise.reject(invalid());}return operation(()=>action(value));}
 try{load();}catch{storage={status:'unavailable',message:UNAVAILABLE};}
 if(pending)operation(persist,{internal:true}).catch(()=>{});
 async function recover(){
  if(!loaded){try{load();}catch{return markUnavailable();}}
  if(pending)await persist();else {let disk;try{disk=readManifest();}catch{return markUnavailable();}if(!equal(disk,committed))return markUnavailable();storage={status:'saved'};}
  const active=data.matrices.find(item=>item.status==='running');
  if(active)await mutate(next=>{stop(locate(next,active.id),'interrupted','storage-failed');return active.id;});
  return snapshot();
 }
 return Object.freeze({
  snapshot,
  begin(input,expectedRevision){return captured(input,value=>mutate(next=>{
   if(!revision(expectedRevision))throw error('runtime-matrix-stale','Use the current matrix history revision.');
   requireValue(fields(value,['basis','cells','captureEach'])&&typeof value.captureEach==='boolean');const basis=basisValue(value.basis);
   requireValue(Array.isArray(value.cells)&&value.cells.length>=1&&value.cells.length<=MATRIX_LIMITS.cells);const requested=Array.from(value.cells).map(item=>{
    if(basis.suite){requireValue(fields(item,['state','requested'])&&STATE_SUITE_STATES.includes(item.state));return {state:item.state,requested:requestedValue(item.requested)};}
    return {requested:requestedValue(item)};
   });suiteCellOrder(requested,basis.suite);
   if(next.matrices.some(item=>item.status==='running'))throw error('runtime-matrix-running','Stop the current matrix before starting another.');
   if(next.matrices.length>=MATRIX_LIMITS.records)throw error('runtime-matrix-capacity','This project has reached its 40-matrix limit. Existing evidence has been preserved.');
   const record={id:randomUUID(),executionId:randomBytes(16).toString('hex'),basis,captureEach:value.captureEach,startedAt:now(),status:'running',cells:requested.map(item=>({id:randomUUID(),runId:randomUUID(),replayExecutionId:randomBytes(16).toString('hex'),...item,status:'not-run',observationLinked:false})),sourceRelationship:'unverified'};
   next.matrices.push(record);return record.id;
  },expectedRevision));},
  beginCell(id,cellId){return operation(()=>mutate(next=>{
   const record=locate(next,id),cell=locateCell(record,cellId),index=record.cells.indexOf(cell);requireValue(cell.status==='not-run'&&record.cells.slice(0,index).every(item=>item.status==='completed')&&record.cells.slice(index+1).every(item=>item.status==='not-run'));
   cell.status='running';cell.startedAt=now();return record.id;
  }));},
  linkEvidence(id,cellId,evidence){return captured(evidence,value=>mutate(next=>{
   const record=locate(next,id),cell=locateCell(record,cellId);requireValue(cell.status==='running');linkValue(record,cell,value);
   return record.id;
  }));},
  recoverEvidence(id,cellId,evidence){return captured(evidence,value=>mutate(next=>{
   const record=next.matrices.find(item=>item.id===id);if(!record)throw error('runtime-matrix-unknown','Choose matrix evidence in the current project.');
   const cell=locateCell(record,cellId);requireValue(terminal.includes(record.status)&&terminal.includes(cell.status));linkValue(record,cell,value);return record.id;
  }));},
  finishCell(id,cellId,result){return captured(result,value=>mutate(next=>{
   resultValue(value);const record=locate(next,id),cell=locateCell(record,cellId);requireValue(cell.status==='running');
   if(value.status==='completed')requireValue(cell.observationLinked&&cell.replayId&&(!record.captureEach||cell.captureId));
   cell.status=value.status;cell.endedAt=now();if(value.reason)cell.reason=value.reason;return record.id;
  }));},
  finishMatrix(id,result){return captured(result,value=>mutate(next=>{
   resultValue(value);const record=locate(next,id);if(value.status==='completed')requireValue(record.cells.every(cell=>cell.status==='completed'));
   stop(record,value.status,value.reason);return record.id;
  }));},
  retry(){
   if(closing)return Promise.reject(error('runtime-matrix-closed','This matrix evidence store has closed.'));
   if(inFlight){const waiting=inFlight;return waiting.then(()=>operation(recover));}
   return operation(recover);
  },
  dispose(){
   if(!disposal){closing=true;disposal=(async()=>{try{await inFlight;}catch{}if(!loaded||pending||storage.status!=='saved')return;const active=data.matrices.find(item=>item.status==='running');if(!active)return;await operation(()=>mutate(next=>{stop(locate(next,active.id),'interrupted','host-disposed');return active.id;}),{internal:true});})();}return disposal;
  }
 });
}
