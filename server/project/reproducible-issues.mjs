import {createHash} from 'node:crypto';

export const REPRODUCIBLE_ISSUE_LIMITS=Object.freeze({records:32,journalBytes:4*1024*1024,recordBytes:60*1024,contextRecords:1,contextBytes:64*1024});
const clone=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const list=value=>Array.isArray(value)&&Object.keys(value).length===value.length&&Array.from(value).every((_item,index)=>Object.hasOwn(value,index));
const fields=(value,required,optional=[])=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const text=(value,max,{multiline=false,empty=false}={})=>typeof value==='string'&&(empty||value.trim().length>0)&&value.length<=max&&value.isWellFormed()&&!(multiline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/:/[\x00-\x1f\x7f]/).test(value);
const token=value=>text(value,200)&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hex=(value,length=64)=>typeof value==='string'&&value.length===length&&/^[a-f0-9]+$/.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const sourcePath=value=>text(value,1024)&&value.trim()===value&&!/[\\:]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const route=value=>text(value,512)&&/^\/[A-Za-z0-9/._~!$&'()*+,;=@-]*$/.test(value)&&!value.includes('//')&&value.split('/').every(part=>part!=='.'&&part!=='..')&&!/^\/__foundation(?:\/|$)/.test(value);
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const fail=(code='invalid-reproducible-issue',message='The saved issue could not be validated. Its original evidence has been left unchanged.')=>Object.assign(new Error(message),{name:'ReproducibleIssueError',status:400,code});
const requireValue=value=>{if(!value)throw fail();};
function canonical(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(list(value))return `[${value.map(canonical).join(',')}]`;
 if(object(value))return `{${Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
 throw fail();
}
/** A metadata identity only. It does not authenticate the source of runtime evidence. */
export const reproducibleIssueEvidenceDigest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const equal=(left,right)=>canonical(left)===canonical(right);
const steps=value=>list(value)&&value.length>=1&&value.length<=12&&value.every(item=>text(item,500,{multiline:true}));
function featureValue(value){
 requireValue(fields(value,['id','title','revision','paths'])&&uuid(value.id)&&text(value.title,80)&&revision(value.revision)&&list(value.paths)&&value.paths.length>=1&&value.paths.length<=32&&value.paths.every(sourcePath)&&new Set(value.paths).size===value.paths.length);return clone(value);
}
function runtimeValue(value){
 requireValue(fields(value,['targetId','session','viewId','documentId','route','pageVersion'])&&token(value.targetId)&&hex(value.session,32)&&hex(value.viewId,32)&&hex(value.documentId,32)&&route(value.route)&&revision(value.pageVersion)&&value.pageVersion>=1);return clone(value);
}
function sourceValues(sources,dirtyPaths){
 requireValue(list(sources)&&sources.length>=1&&sources.length<=32&&sources.every(item=>fields(item,['path','revision'])&&sourcePath(item.path)&&hex(item.revision))&&new Set(sources.map(item=>item.path)).size===sources.length);
 requireValue(list(dirtyPaths)&&dirtyPaths.length<=32&&dirtyPaths.every(path=>sourcePath(path)&&sources.some(item=>item.path===path))&&new Set(dirtyPaths).size===dirtyPaths.length);
}
function bindingValue(value){
 requireValue(fields(value,['startedAt','definitionRevision','runtime','sources','dirtyPaths'])&&timestamp(value.startedAt)&&revision(value.definitionRevision));runtimeValue(value.runtime);sourceValues(value.sources,value.dirtyPaths);return clone(value);
}
function runBinding(run){return {startedAt:run.startedAt,definitionRevision:run.definitionRevision,runtime:run.runtime,sources:run.sources,dirtyPaths:run.dirtyPaths};}
function observationsValue(value,run){
 requireValue(list(value)&&value.length<=100);const seen=new Set();
 for(const item of value){
  requireValue(fields(item,['id','session','documentId','kind','method','url','status','durationMs','outcome','observedAt','timing','correlation'])&&text(item.id,140)&&item.id.startsWith(`${run.runtime.session}:${run.runtime.viewId}:`)&&!seen.has(item.id)&&item.session===run.runtime.session&&item.documentId===run.runtime.documentId&&item.kind==='request'&&typeof item.method==='string'&&/^[A-Z]{1,16}$/.test(item.method)&&text(item.url,1024)&&(item.status===null||Number.isInteger(item.status)&&item.status>=100&&item.status<=599)&&finite(item.durationMs,0,3600000)&&['success','http-error','network-error','aborted'].includes(item.outcome)&&timestamp(item.observedAt)&&item.observedAt>=run.startedAt&&item.observedAt<=run.endedAt&&['response-headers','response-complete'].includes(item.timing)&&item.correlation==='unattributed');
  let url;try{url=new URL(item.url);}catch{throw fail();}
  requireValue(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.href===item.url);seen.add(item.id);
 }
 return clone(value);
}
function runValue(value){
 requireValue(fields(value,['id','feature','screen','scenario','definitionRevision','runtime','sources','dirtyPaths','startedAt','endedAt','status','assessment','note','observations','truncated'],['interruption'])&&uuid(value.id)&&revision(value.definitionRevision)&&timestamp(value.startedAt)&&timestamp(value.endedAt)&&['completed','cancelled','interrupted'].includes(value.status)&&['not-assessed','matched','not-matched'].includes(value.assessment)&&(value.status==='completed'||value.assessment==='not-assessed')&&text(value.note,2000,{multiline:true,empty:true})&&typeof value.truncated==='boolean');
 if(Object.hasOwn(value,'interruption'))requireValue(text(value.interruption,500,{multiline:true}));
 const feature=featureValue(value.feature),screen=value.screen,scenario=value.scenario,runtime=runtimeValue(value.runtime);
 requireValue(fields(screen,['id','featureId','title','targetId','route','archived','createdAt','updatedAt'])&&uuid(screen.id)&&screen.featureId===feature.id&&text(screen.title,80)&&token(screen.targetId)&&route(screen.route)&&screen.archived===false&&timestamp(screen.createdAt)&&timestamp(screen.updatedAt));
 requireValue(fields(scenario,['id','screenId','title','steps','expectedOutcome','archived','createdAt','updatedAt'])&&uuid(scenario.id)&&scenario.screenId===screen.id&&text(scenario.title,80)&&steps(scenario.steps)&&text(scenario.expectedOutcome,2000,{multiline:true})&&scenario.archived===false&&timestamp(scenario.createdAt)&&timestamp(scenario.updatedAt));
 requireValue(runtime.targetId===screen.targetId&&runtime.route===screen.route);sourceValues(value.sources,value.dirtyPaths);
 requireValue(value.sources.length===feature.paths.length&&value.sources.every(item=>feature.paths.includes(item.path)));
 observationsValue(value.observations,value);return clone(value);
}
const replayReasons=['cancelled','timeout','runtime-changed','recipe-changed','step-failed','storage-failed','host-restarted','host-disposed','source-changed','context-changed','transport-failed','preview-changed'];
function replayUnit(value,id){
 requireValue(fields(value,['id','status','effects'],['startedAt','endedAt'])&&value.id===id&&['pending','completed','failed','cancelled','interrupted'].includes(value.status));
 if(value.status==='pending')requireValue(value.effects==='not-started'&&!Object.hasOwn(value,'startedAt')&&!Object.hasOwn(value,'endedAt'));
 else requireValue(value.effects==='unknown'&&timestamp(value.startedAt)&&timestamp(value.endedAt));
}
function boundRecord(value,run){
 requireValue(value.runId===run.id&&value.featureId===run.feature.id&&value.screenId===run.screen.id&&value.scenarioId===run.scenario.id&&equal(bindingValue(value.binding),runBinding(run))&&value.sourceRelationship==='unverified');
}
function replayValue(value,run){
 requireValue(fields(value,['id','executionId','runId','featureId','screenId','scenarioId','binding','recipe','requested','startedAt','endedAt','status','prepare','steps','observed','sourceRelationship'],['reason'])&&uuid(value.id)&&hex(value.executionId,32)&&timestamp(value.startedAt)&&timestamp(value.endedAt)&&['completed','failed','cancelled','interrupted'].includes(value.status));
 boundRecord(value,run);const recipe=value.recipe,requested=value.requested;
 requireValue(fields(recipe,['id','title','route','fixture','registrationId','catalogDigest','steps'])&&token(recipe.id)&&text(recipe.title,160)&&recipe.route===run.runtime.route&&fields(recipe.fixture,['id','label'])&&token(recipe.fixture.id)&&text(recipe.fixture.label,160)&&hex(recipe.registrationId,32)&&hex(recipe.catalogDigest)&&list(recipe.steps)&&recipe.steps.length<=12&&recipe.steps.every(item=>fields(item,['id','title'])&&token(item.id)&&text(item.title,160))&&new Set(recipe.steps.map(item=>item.id)).size===recipe.steps.length);
 requireValue(fields(requested,['theme','motion','viewportWidthCss','viewportHeightCss'])&&['light','dark'].includes(requested.theme)&&['system','reduce'].includes(requested.motion)&&[390,768,960].includes(requested.viewportWidthCss)&&requested.viewportHeightCss===680);
 requireValue(list(value.steps)&&value.steps.length===recipe.steps.length);replayUnit(value.prepare,'prepare');value.steps.forEach((item,index)=>replayUnit(item,recipe.steps[index].id));
 const units=[value.prepare,...value.steps];let stopped=false,active=0;
 for(const unit of units){if(unit.status==='completed'){requireValue(!stopped);continue;}if(unit.status==='pending'){stopped=true;continue;}requireValue(!stopped);stopped=true;active++;}requireValue(active<=1);
 if(value.status==='completed')requireValue(units.every(unit=>unit.status==='completed')&&!Object.hasOwn(value,'reason'));
 else requireValue(replayReasons.includes(value.reason)&&units.every(unit=>['pending','completed',value.status].includes(unit.status)));
 const observed=value.observed;
 requireValue(observed===null||fields(observed,['viewportWidthCss','viewportHeightCss','deviceScaleFactor','colorSchemePreference','reducedMotionPreference'])&&Number.isInteger(observed.viewportWidthCss)&&finite(observed.viewportWidthCss,1,16384)&&Number.isInteger(observed.viewportHeightCss)&&finite(observed.viewportHeightCss,1,16384)&&finite(observed.deviceScaleFactor,0.1,8)&&['light','dark'].includes(observed.colorSchemePreference)&&['reduce','no-preference'].includes(observed.reducedMotionPreference));return clone(value);
}
function captureValue(value,run){
 requireValue(fields(value,['id','runId','featureId','screenId','scenarioId','capturedAt','binding','image','conditions','sourceRelationship'])&&uuid(value.id)&&timestamp(value.capturedAt));boundRecord(value,run);
 const image=value.image,conditions=value.conditions;
 requireValue(fields(image,['assetId','sha256','byteLength','widthPx','heightPx','mimeType'])&&image.assetId===value.id&&hex(image.sha256)&&Number.isInteger(image.byteLength)&&image.byteLength>=57&&image.byteLength<=16*1024*1024&&Number.isInteger(image.widthPx)&&finite(image.widthPx,1,8192)&&Number.isInteger(image.heightPx)&&finite(image.heightPx,1,8192)&&image.widthPx*image.heightPx<=16000000&&image.mimeType==='image/png');
 requireValue(fields(conditions,['viewportWidthCss','viewportHeightCss','deviceScaleFactor','scrollXCss','scrollYCss','canvasScale','colorSchemePreference','reducedMotionPreference','appTheme','dataState','animationState'])&&finite(conditions.viewportWidthCss,1,16384)&&finite(conditions.viewportHeightCss,1,16384)&&finite(conditions.deviceScaleFactor,0.1,8)&&finite(conditions.scrollXCss,-10000000,10000000)&&finite(conditions.scrollYCss,-10000000,10000000)&&finite(conditions.canvasScale,0.1,4)&&['light','dark','no-preference','unknown'].includes(conditions.colorSchemePreference)&&['reduce','no-preference','unknown'].includes(conditions.reducedMotionPreference)&&conditions.appTheme==='unknown'&&conditions.dataState==='unknown'&&conditions.animationState==='unknown');return clone(value);
}
/** Immutable user report plus exact, bounded observations. No source bodies, image bytes or inferred causes. */
export function normalizeReproducibleIssue(value,{projectId}={}){
 requireValue(fields(value,['id','projectId','createdAt','title','actualOutcome','reproduction','run','runDigest','contextFiles','replay','capture','sourceRelationship','compilation'])&&uuid(value.id)&&token(value.projectId)&&(projectId===undefined||value.projectId===projectId)&&timestamp(value.createdAt)&&text(value.title,120)&&value.title.trim()===value.title&&text(value.actualOutcome,2000,{multiline:true})&&value.actualOutcome.trim()===value.actualOutcome&&value.sourceRelationship==='unverified'&&value.compilation==='not-recorded');
 if(Buffer.byteLength(JSON.stringify(value),'utf8')>REPRODUCIBLE_ISSUE_LIMITS.recordBytes)throw fail('reproducible-issue-capacity','This observation exceeds the 60 KiB issue limit. Record a shorter observation; the original run and requests have been preserved.');
 const run=runValue(value.run);requireValue(hex(value.runDigest)&&value.runDigest===reproducibleIssueEvidenceDigest(run));
 requireValue(fields(value.reproduction,['steps','expectedOutcome','origin'])&&value.reproduction.origin==='scenario'&&equal(value.reproduction.steps,run.scenario.steps)&&value.reproduction.expectedOutcome===run.scenario.expectedOutcome);
 requireValue(list(value.contextFiles)&&value.contextFiles.length===run.sources.length&&value.contextFiles.every(item=>fields(item,['path','hash'])&&sourcePath(item.path)&&hex(item.hash)&&run.feature.paths.includes(item.path))&&new Set(value.contextFiles.map(item=>item.path)).size===value.contextFiles.length);
 if(value.replay!==null){requireValue(fields(value.replay,['replay','digest'])&&hex(value.replay.digest));const replay=replayValue(value.replay.replay,run);requireValue(value.replay.digest===reproducibleIssueEvidenceDigest(replay));}
 if(value.capture!==null){requireValue(fields(value.capture,['capture','digest'])&&hex(value.capture.digest));const capture=captureValue(value.capture.capture,run);requireValue(value.capture.digest===reproducibleIssueEvidenceDigest(capture));}
 return clone(value);
}
export const reproducibleIssueDigest=value=>reproducibleIssueEvidenceDigest(normalizeReproducibleIssue(value));
function assessmentValue(value,issue){
 requireValue(fields(value,['source','captureSource','run','replay','capture'])&&['source','captureSource'].every(key=>['current','stale','missing'].includes(value[key]))&&['available','changed','missing'].includes(value.run));
 for(const key of ['replay','capture'])requireValue(issue[key]===null?value[key]==='not-attached':['available','changed','missing'].includes(value[key]));return clone(value);
}
/** Disclosure is explicit, including freshness at sharing; historical evidence remains usable as historical evidence. */
export function normalizeReproducibleIssueContext(value,{projectId}={}){
 if(value===undefined)return undefined;
 try{
  requireValue(fields(value,['version','projectId','issues'])&&value.version===1&&token(value.projectId)&&(projectId===undefined||value.projectId===projectId)&&list(value.issues)&&value.issues.length===1&&Buffer.byteLength(JSON.stringify(value),'utf8')<=REPRODUCIBLE_ISSUE_LIMITS.contextBytes);
  const issues=value.issues.map(item=>{requireValue(fields(item,['issue','digest','assessment'])&&hex(item.digest));const issue=normalizeReproducibleIssue(item.issue,{projectId:value.projectId});requireValue(item.digest===reproducibleIssueDigest(issue));return {issue,digest:item.digest,assessment:assessmentValue(item.assessment,issue)};});return {version:1,projectId:value.projectId,issues};
 }catch{throw fail('invalid-issue-context','Select one saved issue within 64 KiB. Review its recorded source and evidence availability before sending.');}
}
export function assessReproducibleIssue(value,current){
 const issue=normalizeReproducibleIssue(value);
 requireValue(fields(current,['files'],['dirtyPaths','runDigest','replayDigest','captureDigest'])&&list(current.files)&&current.files.length<=32&&current.files.every(item=>fields(item,['path','hash'])&&sourcePath(item.path)&&(item.hash===null||hex(item.hash)))&&new Set(current.files.map(item=>item.path)).size===current.files.length);
 requireValue(current.dirtyPaths===undefined||list(current.dirtyPaths)&&current.dirtyPaths.length<=32&&current.dirtyPaths.every(sourcePath)&&new Set(current.dirtyPaths).size===current.dirtyPaths.length);
 for(const key of ['runDigest','replayDigest','captureDigest'])requireValue(current[key]===undefined||current[key]===null||hex(current[key]));
 const files=new Map(current.files.map(item=>[item.path,item.hash])),dirty=new Set(current.dirtyPaths||[]);
 const sourceStatus=(sources,originalDirty=[])=>sources.some(item=>!files.get(item.path))?'missing':sources.some(item=>files.get(item.path)!==item.hash||dirty.has(item.path)||originalDirty.includes(item.path))?'stale':'current';
 const evidence=(expected,actual)=>actual?expected===actual?'available':'changed':'missing';
 return {source:sourceStatus(issue.run.sources.map(item=>({path:item.path,hash:item.revision})),issue.run.dirtyPaths),captureSource:sourceStatus(issue.contextFiles),run:evidence(issue.runDigest,current.runDigest),replay:issue.replay===null?'not-attached':evidence(issue.replay.digest,current.replayDigest),capture:issue.capture===null?'not-attached':evidence(issue.capture.digest,current.captureDigest)};
}
