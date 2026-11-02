import {createHash} from 'node:crypto';

export const PROJECT_DECISION_LIMITS=Object.freeze({records:32,journalBytes:2*1024*1024,contextRecords:4,contextBytes:16*1024});
const clone=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const list=value=>Array.isArray(value)&&Object.keys(value).length===value.length&&Array.from(value).every((_item,index)=>Object.hasOwn(value,index));
const fields=(value,required,optional=[])=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const text=(value,max,{multiline=false,empty=false}={})=>typeof value==='string'&&(empty||value.trim().length>0)&&value.length<=max&&value.isWellFormed()&&!(multiline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/:/[\x00-\x1f\x7f]/).test(value);
const token=value=>text(value,200)&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const sourcePath=value=>text(value,1024)&&value.trim()===value&&!/[\\:]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const route=value=>text(value,512)&&/^\/[A-Za-z0-9/._~!$&'()*+,;=@-]*$/.test(value)&&!value.includes('//')&&value.split('/').every(part=>part!=='.'&&part!=='..')&&!/^\/__foundation(?:\/|$)/.test(value);
const fail=(code='invalid-project-decision',message='The saved decision could not be validated. Its history has been left unchanged.')=>Object.assign(new Error(message),{name:'ProjectDecisionError',status:400,code});
const requireValue=value=>{if(!value)throw fail();};
function canonical(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return `[${Array.from(value).map(canonical).join(',')}]`;
 if(object(value))return `{${Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
 throw fail();
}
/** A metadata identity only. Callers must separately resolve trusted local provenance. */
export const projectDecisionEvidenceDigest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const equal=(left,right)=>canonical(left)===canonical(right);
function featureValue(value){
 requireValue(fields(value,['id','title','revision','paths'])&&uuid(value.id)&&text(value.title,80)&&revision(value.revision)&&list(value.paths)&&value.paths.length>0&&value.paths.length<=32&&value.paths.every(sourcePath)&&new Set(value.paths).size===value.paths.length);
 return clone(value);
}
function scopeValue(value){
 requireValue(fields(value,['feature','screen','scenario','definitionRevision'])&&revision(value.definitionRevision));
 const feature=featureValue(value.feature),screen=value.screen,scenario=value.scenario;
 requireValue(fields(screen,['id','featureId','title','targetId','route','archived','createdAt','updatedAt'])&&uuid(screen.id)&&screen.featureId===feature.id&&text(screen.title,80)&&token(screen.targetId)&&route(screen.route)&&screen.archived===false&&timestamp(screen.createdAt)&&timestamp(screen.updatedAt)&&screen.updatedAt>=screen.createdAt);
 requireValue(fields(scenario,['id','screenId','title','steps','expectedOutcome','archived','createdAt','updatedAt'])&&uuid(scenario.id)&&scenario.screenId===screen.id&&text(scenario.title,80)&&list(scenario.steps)&&scenario.steps.length>=1&&scenario.steps.length<=12&&scenario.steps.every(item=>text(item,500,{multiline:true}))&&text(scenario.expectedOutcome,2000,{multiline:true})&&scenario.archived===false&&timestamp(scenario.createdAt)&&timestamp(scenario.updatedAt)&&scenario.updatedAt>=scenario.createdAt);
 return {feature,screen:clone(screen),scenario:clone(scenario),definitionRevision:value.definitionRevision};
}
function fileValues(value,kind){
 requireValue(list(value)&&(kind==='token'?value.length===1:value.length>=2&&value.length<=8));
 requireValue(value.every(item=>fields(item,['path','beforeHash','afterHash'])&&sourcePath(item.path)&&hex(item.beforeHash)&&hex(item.afterHash)&&item.beforeHash!==item.afterHash)&&new Set(value.map(item=>item.path)).size===value.length);
 return clone(value);
}
function evidenceValue(value){
 requireValue(fields(value,['variant','run','replay','capture'])&&['baseline','alternative'].includes(value.variant));
 const run=value.run;
 requireValue(fields(run,['id','digest','status','assessment','observationCount','requestCount','unattributedRequestCount','truncated'])&&uuid(run.id)&&hex(run.digest)&&run.status==='completed'&&['not-assessed','matched','not-matched'].includes(run.assessment)&&['observationCount','requestCount','unattributedRequestCount'].every(key=>Number.isSafeInteger(run[key])&&run[key]>=0&&run[key]<=100000)&&run.requestCount<=run.observationCount&&run.unattributedRequestCount<=run.requestCount&&typeof run.truncated==='boolean');
 requireValue(value.replay===null||fields(value.replay,['id','digest','status'])&&uuid(value.replay.id)&&hex(value.replay.digest)&&value.replay.status==='completed');
 requireValue(value.capture===null||fields(value.capture,['id','digest'])&&uuid(value.capture.id)&&hex(value.capture.digest));
 return clone(value);
}
function choiceValue(value){
 const required=['kind','comparisonId','candidateName','comparisonDigest','baselineDigest','sourceId','files','scope','recipe','requested','evidence','compilation','assessment','sourceRelationship'];
 requireValue(fields(value,required,value?.kind==='change-set'?['sourceRevision','sourceDigest']:[])&&['token','change-set'].includes(value.kind)&&uuid(value.comparisonId)&&text(value.candidateName,80)&&hex(value.comparisonDigest)&&hex(value.baselineDigest)&&uuid(value.sourceId)&&value.compilation==='not-recorded'&&value.assessment==='not-assessed'&&value.sourceRelationship==='unverified');
 if(value.kind==='change-set')requireValue(revision(value.sourceRevision)&&hex(value.sourceDigest));
 const scope=scopeValue(value.scope),files=fileValues(value.files,value.kind),recipe=value.recipe,requested=value.requested;
 requireValue(files.every(item=>scope.feature.paths.includes(item.path)));
 requireValue(fields(recipe,['id','title','route','fixture','catalogDigest'])&&token(recipe.id)&&text(recipe.title,160)&&route(recipe.route)&&recipe.route===scope.screen.route&&fields(recipe.fixture,['id','label'])&&token(recipe.fixture.id)&&text(recipe.fixture.label,160)&&hex(recipe.catalogDigest));
 requireValue(fields(requested,['theme','motion','viewportWidthCss','viewportHeightCss'])&&['light','dark'].includes(requested.theme)&&['system','reduce'].includes(requested.motion)&&[390,768,960].includes(requested.viewportWidthCss)&&requested.viewportHeightCss===680);
 requireValue(list(value.evidence)&&value.evidence.length===2);
 const evidence=value.evidence.map(evidenceValue);
 requireValue(evidence[0].variant==='baseline'&&evidence[1].variant==='alternative'&&evidence[0].run.id!==evidence[1].run.id);
 for(const key of ['replay','capture'])requireValue(!evidence[0][key]||!evidence[1][key]||evidence[0][key].id!==evidence[1][key].id);
 return {...clone(value),scope,files,evidence};
}
function adoptionValue(value,kind){
 requireValue(fields(value,['kind','id','appliedAt'],kind==='change-set'?['revision','checkpointId']:[])&&value.kind===kind&&uuid(value.id)&&timestamp(value.appliedAt));
 if(kind==='change-set')requireValue(revision(value.revision)&&uuid(value.checkpointId));
 return clone(value);
}
/** Strict immutable metadata. Source bodies, output, images and arbitrary fields are never retained. */
export function normalizeProjectDecision(value,{projectId}={}){
 requireValue(fields(value,['id','projectId','createdAt','title','rationale','feature','choice','adoption','contextFiles'],['supersedes'])&&uuid(value.id)&&token(value.projectId)&&(projectId===undefined||projectId===value.projectId)&&timestamp(value.createdAt)&&text(value.title,120)&&value.title.trim()===value.title&&text(value.rationale,2000,{multiline:true})&&value.rationale.trim()===value.rationale);
 const feature=featureValue(value.feature),choice=choiceValue(value.choice),adoption=adoptionValue(value.adoption,choice.kind);
 requireValue(equal(feature,choice.scope.feature)&&adoption.appliedAt<=value.createdAt);
 requireValue(list(value.contextFiles)&&value.contextFiles.length>=choice.files.length&&value.contextFiles.length<=32&&value.contextFiles.every(item=>fields(item,['path','hash'])&&sourcePath(item.path)&&hex(item.hash)&&feature.paths.includes(item.path))&&new Set(value.contextFiles.map(item=>item.path)).size===value.contextFiles.length);
 requireValue(feature.paths.every(path=>value.contextFiles.some(item=>item.path===path))&&choice.files.every(file=>value.contextFiles.some(item=>item.path===file.path&&item.hash===file.afterHash)));
 if(Object.hasOwn(value,'supersedes'))requireValue(uuid(value.supersedes)&&value.supersedes!==value.id);
 return {id:value.id,projectId:value.projectId,createdAt:value.createdAt,title:value.title,rationale:value.rationale,feature,choice,adoption,contextFiles:clone(value.contextFiles),...(value.supersedes?{supersedes:value.supersedes}:{})};
}
export const projectDecisionDigest=value=>projectDecisionEvidenceDigest(normalizeProjectDecision(value));

/** Explicit disclosure only; the host must resolve these identities against its own journal. */
export function normalizeProjectDecisionContext(value,{projectId}={}){
 if(value===undefined)return undefined;
 try{
  requireValue(fields(value,['version','projectId','decisions'])&&value.version===1&&token(value.projectId)&&(projectId===undefined||projectId===value.projectId)&&list(value.decisions)&&value.decisions.length>=1&&value.decisions.length<=PROJECT_DECISION_LIMITS.contextRecords);
  requireValue(Buffer.byteLength(JSON.stringify(value),'utf8')<=PROJECT_DECISION_LIMITS.contextBytes);
  const decisions=value.decisions.map(item=>{
   requireValue(fields(item,['decision','digest'])&&hex(item.digest));
   const decision=normalizeProjectDecision(item.decision,{projectId:value.projectId});
   requireValue(item.digest===projectDecisionDigest(decision));return {decision,digest:item.digest};
  });
  requireValue(new Set(decisions.map(item=>item.decision.id)).size===decisions.length);
  return {version:1,projectId:value.projectId,decisions};
 }catch{throw fail('invalid-decision-context','Select up to four saved project decisions within 16 KiB. Review changed or unavailable decisions before sending.');}
}

/** Read-only relevance. Undo, source freshness and evidence availability remain separate. */
export function assessProjectDecision(value,current){
 const decision=normalizeProjectDecision(value);
 requireValue(fields(current,['files','adoptionStatus'],['dirtyPaths','comparisonDigest','supersededBy'])&&list(current.files)&&current.files.length<=32&&current.files.every(item=>fields(item,['path','hash'])&&sourcePath(item.path)&&(item.hash===null||hex(item.hash)))&&new Set(current.files.map(item=>item.path)).size===current.files.length&&['applied','undone','missing'].includes(current.adoptionStatus));
 requireValue(current.dirtyPaths===undefined||list(current.dirtyPaths)&&current.dirtyPaths.length<=32&&current.dirtyPaths.every(sourcePath));
 requireValue(current.comparisonDigest===undefined||current.comparisonDigest===null||hex(current.comparisonDigest));
 requireValue(current.supersededBy===undefined||uuid(current.supersededBy)&&current.supersededBy!==decision.id);
 const sources=new Map(current.files.map(item=>[item.path,item.hash])),missing=decision.contextFiles.some(item=>!sources.get(item.path));
 const stale=decision.contextFiles.some(item=>sources.get(item.path)!==item.hash||(current.dirtyPaths||[]).includes(item.path));
 return {source:missing?'missing':stale?'stale':'current',adoption:current.adoptionStatus,evidence:!current.comparisonDigest?'missing':current.comparisonDigest===decision.choice.comparisonDigest?'available':'changed',...(current.supersededBy?{supersededBy:current.supersededBy}:{})};
}
