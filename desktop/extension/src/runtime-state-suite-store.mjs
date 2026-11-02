import {randomUUID} from 'node:crypto';

export const STATE_SUITE_STATES=Object.freeze(['idle','loading','success','error','offline']);
export const STATE_SUITE_LIMITS=Object.freeze({records:20,states:5,cells:12,steps:12,manifestBytes:512*1024});
const copy=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,required,optional=[])=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value);
const token=value=>text(value,200)&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hex=(value,n)=>typeof value==='string'&&value.length===n&&/^[a-f0-9]+$/.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const route=value=>typeof value==='string'&&value.length<=512&&/^\/[A-Za-z0-9/._~!$&'()*+,;=@-]*$/.test(value)&&!value.includes('//')&&!value.split('/').some(part=>part==='.'||part==='..')&&!/^\/__foundation(?:\/|$)/.test(value);
const unique=values=>new Set(values).size===values.length;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const error=(code,message)=>Object.assign(new Error(message),{name:'RuntimeStateSuiteError',code});
const invalid=()=>error('runtime-state-suite-invalid','The state suite could not be validated. Its saved definitions have been preserved.');
const requireValue=value=>{if(!value)throw invalid();};
const UNAVAILABLE='Saved state suites could not be read safely. Existing definitions have been left unchanged.';
const STORAGE_FAILED='The state suite could not be saved locally. Retry saving; no application action will run.';
function recipeValue(value){
 requireValue(fields(value,['id','title','route','fixture','catalogDigest','steps'])&&token(value.id)&&text(value.title,160)&&route(value.route)&&fields(value.fixture,['id','label'])&&token(value.fixture.id)&&text(value.fixture.label,160)&&hex(value.catalogDigest,64));
 requireValue(Array.isArray(value.steps)&&value.steps.length<=STATE_SUITE_LIMITS.steps&&Array.from(value.steps).every(item=>fields(item,['id','title'])&&token(item.id)&&text(item.title,160))&&unique(value.steps.map(item=>item.id)));return copy(value);
}
function requestedValue(value){requireValue(fields(value,['theme','motion','viewportWidthCss','viewportHeightCss'])&&['light','dark'].includes(value.theme)&&['system','reduce'].includes(value.motion)&&[390,768,960].includes(value.viewportWidthCss)&&value.viewportHeightCss===680);return {theme:value.theme,motion:value.motion,viewportWidthCss:value.viewportWidthCss,viewportHeightCss:680};}
function definitionFields(value){
 requireValue(text(value.title,80)&&uuid(value.featureId)&&uuid(value.screenId)&&uuid(value.scenarioId)&&typeof value.captureEach==='boolean');
 requireValue(Array.isArray(value.states)&&value.states.length>=1&&value.states.length<=STATE_SUITE_LIMITS.states);
 const states=Array.from(value.states).map(item=>{requireValue(fields(item,['state','recipe'])&&STATE_SUITE_STATES.includes(item.state));return {state:item.state,recipe:recipeValue(item.recipe)};});
 requireValue(unique(states.map(item=>item.state))&&unique(states.map(item=>item.recipe.id))&&new Set(states.map(item=>item.recipe.route)).size===1&&new Set(states.map(item=>item.recipe.catalogDigest)).size===1);
 requireValue(Array.isArray(value.requested)&&value.requested.length>=1&&value.requested.length*states.length<=STATE_SUITE_LIMITS.cells);
 const requested=Array.from(value.requested).map(requestedValue);
 requireValue(unique(requested.map(item=>JSON.stringify(item)))&&new Set(requested.map(item=>item.theme)).size*new Set(requested.map(item=>item.motion)).size*new Set(requested.map(item=>item.viewportWidthCss)).size===requested.length);
 return {title:value.title,featureId:value.featureId,screenId:value.screenId,scenarioId:value.scenarioId,states,requested,captureEach:value.captureEach};
}
function definitionValue(value){requireValue(fields(value,['id','title','revision','featureId','screenId','scenarioId','states','requested','captureEach','createdAt','updatedAt'])&&uuid(value.id)&&revision(value.revision)&&value.revision>=1&&timestamp(value.createdAt)&&timestamp(value.updatedAt));return {id:value.id,...definitionFields(value),revision:value.revision,createdAt:value.createdAt,updatedAt:value.updatedAt};}
function manifestValue(value,projectId){
 requireValue(fields(value,['schemaVersion','projectId','revision','suites'])&&value.schemaVersion===1&&value.projectId===projectId&&revision(value.revision)&&Array.isArray(value.suites)&&value.suites.length<=STATE_SUITE_LIMITS.records);
 const suites=Array.from(value.suites).map(definitionValue);requireValue(unique(suites.map(item=>item.id)));const result={schemaVersion:1,projectId,revision:value.revision,suites};requireValue(Buffer.byteLength(JSON.stringify(result),'utf8')<=STATE_SUITE_LIMITS.manifestBytes);return result;
}
/** Local reusable definitions only. Saving and recovery never connect, navigate, replay, capture, or assess an app. */
export function createRuntimeStateSuiteStore({projectId,read,write,onChange=()=>{}}){
 if(!token(projectId)||typeof read!=='function'||typeof write!=='function'||typeof onChange!=='function')throw error('runtime-state-suite-configuration','A local project identity and storage adapters are required.');
 const empty=()=>({schemaVersion:1,projectId,revision:0,suites:[]});let data=empty(),committed=empty(),storage={status:'saved'},loaded=false,pending=false,inFlight,closing=false,disposal;
 const snapshot=()=>({...copy(data),storage:{...storage}}),notify=()=>{try{onChange();}catch{}};
 const readManifest=()=>{const value=read();return value===undefined||value===null?empty():manifestValue(value,projectId);};
 function load(){data=readManifest();committed=copy(data);loaded=true;pending=false;storage={status:'saved'};}
 function unavailable(){storage={status:'unavailable',message:UNAVAILABLE};notify();throw error('runtime-state-suite-unavailable',UNAVAILABLE);}
 async function persist(){
  storage={status:'saving'};notify();let disk;try{disk=readManifest();}catch{return unavailable();}
  if(equal(disk,data)){committed=copy(data);pending=false;storage={status:'saved'};notify();return;}
  if(!equal(disk,committed))return unavailable();
  try{await write(copy(data));}catch{storage={status:'error',message:STORAGE_FAILED};notify();throw error('runtime-state-suite-storage',STORAGE_FAILED);}
  try{disk=readManifest();}catch{return unavailable();}if(!equal(disk,data))return unavailable();committed=copy(data);pending=false;storage={status:'saved'};notify();
 }
 function operation(action){if(closing)return Promise.reject(error('runtime-state-suite-closed','This state suite store has closed.'));if(inFlight)return Promise.reject(error('runtime-state-suite-busy','A state suite is being saved. Wait for it to finish.'));const result=Promise.resolve().then(action);inFlight=result;result.finally(()=>{if(inFlight===result)inFlight=undefined;}).catch(()=>{});return result;}
 function available(expected){if(storage.status==='unavailable')throw error('runtime-state-suite-unavailable',UNAVAILABLE);if(storage.status==='error')throw error('runtime-state-suite-storage',STORAGE_FAILED);if(!revision(expected)||expected!==data.revision)throw error('runtime-state-suite-stale','Review the latest saved state suites before saving.');}
 try{load();}catch{storage={status:'unavailable',message:UNAVAILABLE};}
 return Object.freeze({
  snapshot,
  save(input,expectedRevision){let value;try{value=copy(input);}catch{return Promise.reject(invalid());}return operation(async()=>{
   available(expectedRevision);requireValue(fields(value,['title','featureId','screenId','scenarioId','states','requested','captureEach'],['id']));const definition=definitionFields(value),next=copy(data);let prior;
   if(Object.hasOwn(value,'id')){requireValue(uuid(value.id));prior=next.suites.find(item=>item.id===value.id);if(!prior)throw error('runtime-state-suite-unknown','Choose a saved state suite in this project.');requireValue(prior.featureId===definition.featureId&&prior.screenId===definition.screenId&&prior.scenarioId===definition.scenarioId);}
   else if(next.suites.length>=STATE_SUITE_LIMITS.records)throw error('runtime-state-suite-capacity','This project has reached its 20-suite limit. Existing definitions have been preserved.');
   requireValue(next.revision<Number.MAX_SAFE_INTEGER-1&&(!prior||prior.revision<Number.MAX_SAFE_INTEGER-1));const stamp=new Date().toISOString(),saved={id:prior?.id||randomUUID(),...definition,revision:prior?prior.revision+1:1,createdAt:prior?.createdAt||stamp,updatedAt:stamp};
   if(prior)next.suites[next.suites.indexOf(prior)]=saved;else next.suites.push(saved);next.revision++;
   if(Buffer.byteLength(JSON.stringify(next),'utf8')>STATE_SUITE_LIMITS.manifestBytes)throw error('runtime-state-suite-capacity','Local state suite storage is full. Existing definitions have been preserved.');
   data=manifestValue(next,projectId);pending=true;await persist();return copy(data.suites.find(item=>item.id===saved.id));
  });},
  retry(){const recover=async()=>{if(!loaded){try{load();}catch{return unavailable();}}if(pending)await persist();else {let disk;try{disk=readManifest();}catch{return unavailable();}if(!equal(disk,committed))return unavailable();storage={status:'saved'};notify();}return snapshot();};if(inFlight){const waiting=inFlight;return waiting.then(()=>operation(recover));}return operation(recover);},
  dispose(){if(!disposal){closing=true;disposal=(async()=>{try{await inFlight;}catch{}})();}return disposal;}
 });
}
