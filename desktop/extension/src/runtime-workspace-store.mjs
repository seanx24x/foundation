import { randomUUID } from 'node:crypto';

const copy = value => structuredClone(value);
// Presentation readers share a frozen committed value. The public snapshot()
// remains a detached mutable copy; storage status is always read afresh.
const freezePresentation = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezePresentation(child);
    Object.freeze(value);
  }
  return value;
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const text = (value, max) => typeof value === 'string' && value.length <= max && !value.includes('\0');
const title = value => text(value, 80) && value.trim() === value && value.length > 0 && !/[\x00-\x1f\x7f]/.test(value);
const token = value => text(value, 200) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hex32 = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
const sourcePath = value => text(value, 1024) && value.length > 0 && value.trim() === value && !/[\\:\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const error = (code, message) => Object.assign(new Error(message), { name: 'RuntimeWorkspaceError', code });
const invalid = () => error('runtime-workspace-invalid', 'The screen, scenario, or observation data is invalid. Review its fields before saving.');
const requireValue = condition => { if (!condition) throw invalid(); };
const UNAVAILABLE = 'Saved screens and observations could not be read safely. They have been left unchanged.';
const STORAGE_FAILED = 'Screens and observations could not be saved locally. Retry saving before continuing.';
const RESTARTED = 'Foundation restarted before this observation finished.';

/** Canonical local pathname only. Query/hash state and encoded paths are unsupported. */
export function safeScreenRoute(value) {
  if (!text(value, 512) || !/^\/[A-Za-z0-9/._~!$&'()*+,;=@-]*$/.test(value) || value.includes('//')
    || value.split('/').some(part => part === '.' || part === '..') || /^\/__foundation(?:\/|$)/.test(value)) {
    throw error('runtime-route-invalid', 'Use a root-relative pathname such as /settings/profile, without queries, fragments, encoded characters, or traversal segments.');
  }
  return value;
}
function paths(value) {
  requireValue(Array.isArray(value) && value.length <= 32 && value.every(sourcePath) && new Set(value).size === value.length);
  return [...value];
}
function screenValue(input) {
  requireValue(exact(input, ['id','featureId','title','targetId','route','archived','createdAt','updatedAt']) && uuid(input.id) && uuid(input.featureId)
    && title(input.title) && token(input.targetId) && typeof input.archived === 'boolean' && timestamp(input.createdAt) && timestamp(input.updatedAt));
  return { id:input.id, featureId:input.featureId, title:input.title, targetId:input.targetId, route:safeScreenRoute(input.route), archived:input.archived, createdAt:input.createdAt, updatedAt:input.updatedAt };
}
function steps(value) {
  requireValue(Array.isArray(value) && value.length >= 1 && value.length <= 12 && value.every(item => text(item,500) && item.trim().length > 0));
  return [...value];
}
function scenarioValue(input) {
  requireValue(exact(input, ['id','screenId','title','steps','expectedOutcome','archived','createdAt','updatedAt']) && uuid(input.id) && uuid(input.screenId)
    && title(input.title) && text(input.expectedOutcome,2000) && input.expectedOutcome.trim().length > 0 && typeof input.archived === 'boolean' && timestamp(input.createdAt) && timestamp(input.updatedAt));
  return { id:input.id, screenId:input.screenId, title:input.title, steps:steps(input.steps), expectedOutcome:input.expectedOutcome, archived:input.archived, createdAt:input.createdAt, updatedAt:input.updatedAt };
}
function runMetadata(input) {
  requireValue(object(input) && exact(input.feature, ['id','title','revision','paths']) && uuid(input.feature.id) && title(input.feature.title) && revision(input.feature.revision));
  const feature = { id:input.feature.id, title:input.feature.title, revision:input.feature.revision, paths:paths(input.feature.paths) };
  requireValue(feature.paths.length > 0);
  const screen = screenValue(input.screen), scenario = scenarioValue(input.scenario);
  requireValue(screen.featureId === feature.id && scenario.screenId === screen.id && !screen.archived && !scenario.archived && revision(input.definitionRevision));
  const runtime = input.runtime;
  requireValue(exact(runtime, ['targetId','session','viewId','documentId','route','pageVersion']) && runtime.targetId === screen.targetId && hex32(runtime.session) && hex32(runtime.viewId) && hex32(runtime.documentId) && revision(runtime.pageVersion) && runtime.pageVersion >= 1);
  requireValue(safeScreenRoute(runtime.route) === screen.route);
  requireValue(Array.isArray(input.sources) && input.sources.length <= 32);
  const seen = new Set();
  const sources = input.sources.map(item => {
    requireValue(exact(item, ['path','revision']) && feature.paths.includes(item.path) && !seen.has(item.path) && /^[a-f0-9]{64}$/.test(item.revision));
    seen.add(item.path); return { path:item.path, revision:item.revision };
  });
  requireValue(sources.length === feature.paths.length && feature.paths.every(item=>seen.has(item)));
  const dirtyPaths = paths(input.dirtyPaths);
  requireValue(dirtyPaths.every(item => feature.paths.includes(item)));
  return { feature, screen, scenario, definitionRevision:input.definitionRevision, runtime:{targetId:runtime.targetId,session:runtime.session,viewId:runtime.viewId,documentId:runtime.documentId,route:runtime.route,pageVersion:runtime.pageVersion}, sources, dirtyPaths };
}
function observationsValue(value, runtime) {
  requireValue(Array.isArray(value) && value.length <= 100);
  const seen = new Set();
  return value.map(item => {
    requireValue(exact(item, ['id','session','documentId','kind','method','url','status','durationMs','outcome','observedAt','timing','correlation'])
      && text(item.id,140) && item.id.startsWith(`${runtime.session}:${runtime.viewId}:`) && !seen.has(item.id)
      && item.session === runtime.session && item.documentId === runtime.documentId && item.kind === 'request'
      && /^[A-Z]{1,16}$/.test(item.method) && text(item.url,1024)
      && (item.status === null || Number.isInteger(item.status) && item.status >= 100 && item.status <= 599)
      && Number.isFinite(item.durationMs) && item.durationMs >= 0 && item.durationMs <= 3600000
      && ['success','http-error','network-error','aborted'].includes(item.outcome)
      && (item.observedAt === null || timestamp(item.observedAt)) && ['response-headers','response-complete'].includes(item.timing)
      && item.correlation === 'unattributed');
    let url; try { url = new URL(item.url); } catch { throw invalid(); }
    requireValue(['http:','https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash);
    seen.add(item.id);
    return { id:item.id,session:item.session,documentId:item.documentId,kind:'request',method:item.method,url:url.href,status:item.status,durationMs:item.durationMs,outcome:item.outcome,observedAt:item.observedAt,timing:item.timing,correlation:'unattributed' };
  });
}
function runValue(input) {
  requireValue(exact(input, ['id','feature','screen','scenario','definitionRevision','runtime','sources','dirtyPaths','startedAt','endedAt','status','assessment','note','interruption','observations','truncated'])
    && uuid(input.id) && timestamp(input.startedAt) && ['recording','completed','cancelled','interrupted'].includes(input.status)
    && ['not-assessed','matched','not-matched'].includes(input.assessment) && text(input.note,2000) && typeof input.truncated === 'boolean');
  requireValue(input.status === 'recording' ? input.endedAt === undefined && input.assessment === 'not-assessed' : timestamp(input.endedAt));
  requireValue(input.status === 'completed' || input.assessment === 'not-assessed');
  requireValue(input.interruption === undefined || text(input.interruption,500) && input.interruption.trim().length > 0);
  const metadata = runMetadata(input);
  const observations = observationsValue(input.observations,metadata.runtime);
  requireValue(observations.every(item=>timestamp(item.observedAt)&&Date.parse(item.observedAt)>=Date.parse(input.startedAt)&&(!input.endedAt||Date.parse(item.observedAt)<=Date.parse(input.endedAt))));
  return { id:input.id,...metadata,startedAt:input.startedAt,...(input.endedAt ? {endedAt:input.endedAt} : {}),status:input.status,assessment:input.assessment,note:input.note,
    ...(input.interruption ? {interruption:input.interruption} : {}),observations,truncated:input.truncated };
}
function dataValue(input, projectId) {
  requireValue(exact(input, ['schemaVersion','projectId','revision','activeScreenId','activeScenarioId','screens','scenarios','runs']) && input.schemaVersion === 1 && input.projectId === projectId && revision(input.revision)
    && Array.isArray(input.screens) && input.screens.length <= 20 && Array.isArray(input.scenarios) && input.scenarios.length <= 40 && Array.isArray(input.runs) && input.runs.length <= 40
    && Buffer.byteLength(JSON.stringify(input),'utf8') <= 8*1024*1024);
  const screens=input.screens.map(screenValue), scenarios=input.scenarios.map(scenarioValue), runs=input.runs.map(runValue);
  for(const list of [screens,scenarios,runs]) requireValue(new Set(list.map(item=>item.id)).size===list.length);
  requireValue(scenarios.every(item=>screens.some(screen=>screen.id===item.screenId)) && runs.filter(item=>item.status==='recording').length<=1);
  requireValue(runs.every(run=>screens.some(item=>item.id===run.screen.id&&item.featureId===run.feature.id)&&scenarios.some(item=>item.id===run.scenario.id&&item.screenId===run.screen.id)));
  requireValue(input.activeScreenId===null || screens.some(item=>item.id===input.activeScreenId&&!item.archived));
  requireValue(input.activeScenarioId===null || scenarios.some(item=>item.id===input.activeScenarioId&&item.screenId===input.activeScreenId&&!item.archived));
  return {schemaVersion:1,projectId,revision:input.revision,activeScreenId:input.activeScreenId,activeScenarioId:input.activeScenarioId,screens,scenarios,runs};
}

/** Project-local manual definitions and immutable observed-run snapshots. No replay or provider execution. */
export function createRuntimeWorkspaceStore({projectId,read,write,onChange=()=>{}}) {
  if(!token(projectId)||typeof read!=='function'||typeof write!=='function')throw error('runtime-workspace-project','A local project identity and storage adapter are required.');
  const empty=()=>({schemaVersion:1,projectId,revision:0,activeScreenId:null,activeScenarioId:null,screens:[],scenarios:[],runs:[]});
  let data=empty(), storage={status:'saved'}, tail=Promise.resolve(), closing=false, disposal, recovered=false;
  let presentationEpoch = 0;
  const snapshot=()=>({...copy(data),storage:{...storage}});
  const presentation=()=>({snapshot:{...freezePresentation(data),storage:{...storage}},epoch:presentationEpoch});
  const notify=()=>{try{onChange();}catch{}};
  function load(){
    const previous=read();const loaded=previous===undefined||previous===null?empty():dataValue(previous,projectId);recovered=false;
    for(const run of loaded.runs)if(run.status==='recording'){run.status='interrupted';run.endedAt=new Date().toISOString();run.interruption=RESTARTED;run.assessment='not-assessed';recovered=true;}
    if(recovered){requireValue(loaded.revision<Number.MAX_SAFE_INTEGER-1);loaded.revision++;}
    presentationEpoch++;data=loaded;storage={status:recovered?'saving':'saved'};
  }
  try{load();}catch{storage={status:'unavailable',message:UNAVAILABLE};}
  async function persist(){storage={status:'saving'};notify();try{await write(copy(data));}catch{storage={status:'error',message:STORAGE_FAILED};notify();throw error('runtime-workspace-storage',STORAGE_FAILED);}storage={status:'saved'};notify();return snapshot();}
  if(recovered)tail=Promise.resolve().then(persist).catch(()=>{});
  function enqueue(operation){if(closing)return Promise.reject(error('runtime-workspace-closed','This runtime workspace has closed.'));const result=tail.then(operation);tail=result.catch(()=>{});return result;}
  function available(expected){if(storage.status==='unavailable')throw error('runtime-workspace-unavailable',UNAVAILABLE);if(storage.status==='error')throw error('runtime-workspace-storage',STORAGE_FAILED);if(expected!==undefined&&(!revision(expected)||expected!==data.revision))throw error('runtime-workspace-stale','The runtime workspace changed. Review the latest saved state.');}
  const locate=(list,id)=>{const item=list.find(item=>item.id===id);if(!item)throw error('runtime-workspace-unknown','Choose an item in the current runtime workspace.');return item;};
  async function mutate(expected,transform,{duringRun=false}={}){
    available(expected);if(!duringRun&&data.runs.some(item=>item.status==='recording'))throw error('runtime-workspace-recording','Finish or cancel the current observation before changing its screen or scenario.');
    const next=copy(data);if(!transform(next))return snapshot();requireValue(next.revision<Number.MAX_SAFE_INTEGER-1);next.revision++;
    if(Buffer.byteLength(JSON.stringify(next),'utf8')>8*1024*1024)throw error('runtime-workspace-capacity','Local observation history is full. Existing records have been preserved.');
    data=next;return persist();
  }
  function capture(input,operation){let value;try{value=copy(input);}catch{return Promise.reject(invalid());}return enqueue(()=>operation(value));}
  const requireRevision=value=>{if(!revision(value))throw error('runtime-workspace-stale','Use the current runtime workspace revision.');return value;};
  return {
    snapshot, presentation,
    createScreen(input,expected){return capture(input,value=>mutate(requireRevision(expected),next=>{
      requireValue(exact(value,['featureId','title','targetId','route']));if(next.screens.length>=20)throw error('runtime-workspace-capacity','This project has reached its 20-screen limit. Archived screens are preserved.');
      const now=new Date().toISOString(),item=screenValue({...value,title:typeof value.title==='string'?value.title.trim():value.title,id:randomUUID(),archived:false,createdAt:now,updatedAt:now});
      next.screens.push(item);next.activeScreenId=item.id;next.activeScenarioId=null;return true;
    }));},
    updateScreen(id,patch,expected){return capture(patch,value=>mutate(requireRevision(expected),next=>{
      requireValue(exact(value,['title','targetId','route']));const item=locate(next.screens,id),updated=screenValue({...item,...value,...(own(value,'title')&&typeof value.title==='string'?{title:value.title.trim()}:{}),updatedAt:new Date().toISOString()});Object.assign(item,updated);return true;
    }));},
    archiveScreen(id,archived,expected){return enqueue(()=>mutate(requireRevision(expected),next=>{requireValue(typeof archived==='boolean');const item=locate(next.screens,id);if(item.archived===archived)return false;item.archived=archived;item.updatedAt=new Date().toISOString();if(archived&&next.activeScreenId===id){next.activeScreenId=null;next.activeScenarioId=null;}return true;}));},
    createScenario(input,expected){return capture(input,value=>mutate(requireRevision(expected),next=>{
      requireValue(exact(value,['screenId','title','steps','expectedOutcome']));if(next.scenarios.length>=40)throw error('runtime-workspace-capacity','This project has reached its 40-scenario limit. Archived scenarios are preserved.');
      const screen=locate(next.screens,value.screenId);if(screen.archived)throw error('runtime-workspace-archived','Restore this screen before adding a scenario.');
      const now=new Date().toISOString(),item=scenarioValue({...value,title:typeof value.title==='string'?value.title.trim():value.title,id:randomUUID(),archived:false,createdAt:now,updatedAt:now});
      next.scenarios.push(item);next.activeScreenId=screen.id;next.activeScenarioId=item.id;return true;
    }));},
    updateScenario(id,patch,expected){return capture(patch,value=>mutate(requireRevision(expected),next=>{requireValue(exact(value,['title','steps','expectedOutcome']));const item=locate(next.scenarios,id);Object.assign(item,scenarioValue({...item,...value,...(own(value,'title')&&typeof value.title==='string'?{title:value.title.trim()}:{}),updatedAt:new Date().toISOString()}));return true;}));},
    archiveScenario(id,archived,expected){return enqueue(()=>mutate(requireRevision(expected),next=>{requireValue(typeof archived==='boolean');const item=locate(next.scenarios,id);if(item.archived===archived)return false;item.archived=archived;item.updatedAt=new Date().toISOString();if(archived&&next.activeScenarioId===id)next.activeScenarioId=null;return true;}));},
    select(screenId,scenarioId,expected){return enqueue(()=>mutate(requireRevision(expected),next=>{
      requireValue(screenId===null||uuid(screenId));requireValue(scenarioId===null||uuid(scenarioId));
      if(screenId===null)requireValue(scenarioId===null);else{const screen=locate(next.screens,screenId);if(screen.archived)throw error('runtime-workspace-archived','Restore this screen before selecting it.');}
      if(scenarioId!==null){const scenario=locate(next.scenarios,scenarioId);requireValue(scenario.screenId===screenId);if(scenario.archived)throw error('runtime-workspace-archived','Restore this scenario before selecting it.');}
      if(next.activeScreenId===screenId&&next.activeScenarioId===scenarioId)return false;next.activeScreenId=screenId;next.activeScenarioId=scenarioId;return true;
    }));},
    beginRun(input,expected,options){return capture({input,options},captured=>mutate(requireRevision(expected),next=>{
      const {input:value,options}=captured;requireValue(options===undefined||exact(options,['id'])&&uuid(options.id));
      const id=options?.id??randomUUID();requireValue(!next.runs.some(run=>run.id===id));
      requireValue(exact(value,['feature','screen','scenario','definitionRevision','runtime','sources','dirtyPaths']));
      if(next.runs.length>=40)throw error('runtime-workspace-capacity','This project has reached its 40-observation limit. Existing history is preserved; screens can still be opened.');
      const metadata=runMetadata(value);requireValue(metadata.definitionRevision===next.revision && next.activeScreenId===metadata.screen.id && next.activeScenarioId===metadata.scenario.id);
      requireValue(JSON.stringify(locate(next.screens,metadata.screen.id))===JSON.stringify(metadata.screen)&&JSON.stringify(locate(next.scenarios,metadata.scenario.id))===JSON.stringify(metadata.scenario));
      next.runs.push({id,...metadata,startedAt:new Date().toISOString(),status:'recording',assessment:'not-assessed',note:'',observations:[],truncated:false});return true;
    }));},
    finishRun(id,patch){return capture(patch,value=>mutate(undefined,next=>{
      requireValue(exact(value,['status','assessment','note','interruption','observations','truncated']) && ['completed','cancelled','interrupted'].includes(value.status) && Array.isArray(value.observations) && typeof value.truncated === 'boolean');
      const run=locate(next.runs,id);if(run.status!=='recording')throw error('runtime-workspace-finished','This observation is already finished. Its original record has been preserved.');
      const finished=runValue({...run,...value,assessment:value.assessment??'not-assessed',note:value.note??'',endedAt:new Date().toISOString()});Object.assign(run,finished);return true;
    },{duringRun:true}));},
    retry(){return enqueue(async()=>{if(storage.status==='unavailable'){try{load();notify();if(recovered)return persist();return snapshot();}catch(caught){if(caught.code==='runtime-workspace-storage')throw caught;storage={status:'unavailable',message:UNAVAILABLE};notify();throw error('runtime-workspace-unavailable',UNAVAILABLE);}}return storage.status==='error'?persist():snapshot();});},
    dispose(){if(!disposal){closing=true;disposal=tail.then(()=>{});}return disposal;},
  };
}
