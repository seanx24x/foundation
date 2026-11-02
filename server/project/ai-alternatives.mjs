import {createHash,randomUUID} from 'node:crypto';
import {createBuildArtifact,validateChangeSet,validAlternativeSourcePath} from './proposals.mjs';

export const AI_ALTERNATIVE_LIMITS=Object.freeze({candidates:2,files:8,sourceBytes:64*1024,rawBytes:64*1024,nameBytes:80,reasonBytes:2000});
export class AIAlternativesError extends Error {
 constructor(code='invalid-ai-alternatives',message='The alternatives do not match their saved source and scope. No candidate is available to apply.') {super(message);Object.assign(this,{name:'AIAlternativesError',status:400,code});}
}
const requireValue=value=>{if(!value)throw new AIAlternativesError();};
const clone=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const list=value=>Array.isArray(value)&&Object.keys(value).length===value.length&&Array.from(value).every((_item,index)=>Object.hasOwn(value,index));
const fields=(value,required,optional=[])=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const text=(value,max,{multiline=false}={})=>typeof value==='string'&&value.trim().length>0&&value.trim()===value&&Buffer.byteLength(value)<=max&&value.isWellFormed()&&!(multiline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/:/[\x00-\x1f\x7f]/).test(value);
const source=value=>typeof value==='string'&&value.isWellFormed()&&!value.includes('\0')&&Buffer.byteLength(value)<=AI_ALTERNATIVE_LIMITS.sourceBytes;
const token=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const sourcePath=value=>text(value,1024)&&!/[\\:]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const route=value=>text(value,512)&&/^\/[A-Za-z0-9/._~!$&'()*+,;=@-]*$/.test(value)&&!value.includes('//')&&value.split('/').every(part=>part!=='.'&&part!=='..')&&!/^\/__foundation(?:\/|$)/.test(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const equal=(a,b)=>canonical(a)===canonical(b);

/** Frozen scope is reference data; it never grants provider tools or source-write authority. */
export function normalizeAlternativeGeneration(value) {
 if(value===undefined)return undefined;
 try {
  requireValue(fields(value,['version','count','scope'])&&value.version===1&&value.count===2);
  const scope=value.scope;
  requireValue(fields(scope,['feature','screen','scenario','definitionRevision'])&&revision(scope.definitionRevision));
  const feature=scope.feature,screen=scope.screen,scenario=scope.scenario;
  requireValue(fields(feature,['id','title','revision','paths'])&&uuid(feature.id)&&text(feature.title,80)&&revision(feature.revision)&&list(feature.paths)&&feature.paths.length>0&&feature.paths.length<=32&&feature.paths.every(sourcePath)&&new Set(feature.paths).size===feature.paths.length);
  requireValue(fields(screen,['id','featureId','title','targetId','route','archived','createdAt','updatedAt'])&&uuid(screen.id)&&screen.featureId===feature.id&&text(screen.title,80)&&screen.targetId==='vite:dev'&&route(screen.route)&&screen.archived===false&&timestamp(screen.createdAt)&&timestamp(screen.updatedAt)&&screen.updatedAt>=screen.createdAt);
  requireValue(fields(scenario,['id','screenId','title','steps','expectedOutcome','archived','createdAt','updatedAt'])&&uuid(scenario.id)&&scenario.screenId===screen.id&&text(scenario.title,80)&&list(scenario.steps)&&scenario.steps.length>=1&&scenario.steps.length<=12&&scenario.steps.every(item=>text(item,500,{multiline:true}))&&text(scenario.expectedOutcome,2000,{multiline:true})&&scenario.archived===false&&timestamp(scenario.createdAt)&&timestamp(scenario.updatedAt)&&scenario.updatedAt>=scenario.createdAt);
  return {version:1,count:2,scope:clone(scope)};
 } catch {throw new AIAlternativesError('invalid-alternative-generation','Choose one saved web scenario and two to eight saved application sources before generating alternatives.');}
}

export function validateAlternativeGenerationFiles(input,files) {
 const generation=normalizeAlternativeGeneration(input);
 requireValue(generation&&list(files)&&files.length>=2&&files.length<=8&&new Set(files.map(file=>file?.path)).size===files.length);
 let bytes=0;
 for(const file of files){requireValue(object(file)&&validAlternativeSourcePath(file.path)&&generation.scope.feature.paths.includes(file.path)&&source(file.source)&&file.revision===hash(file.source).slice(0,16));bytes+=Buffer.byteLength(file.source);}
 requireValue(bytes<=AI_ALTERNATIVE_LIMITS.sourceBytes);
 return generation;
}

/** Canonical immutable model candidates. No journal status or executable result is accepted. */
export function normalizeAIAlternatives(value,projectId=value?.projectId,files) {
 requireValue(fields(value,['schemaVersion','id','projectId','title','summary','generation','context','candidates','verificationStatus'])&&value.schemaVersion===1&&uuid(value.id)&&token(projectId)&&value.projectId===projectId&&text(value.title,160)&&text(value.summary,2000,{multiline:true})&&value.verificationStatus==='not-run');
 const generation=normalizeAlternativeGeneration(value.generation);
 requireValue(generation&&list(value.context)&&value.context.length>=2&&value.context.length<=8&&new Set(value.context.map(file=>file?.path)).size===value.context.length);
 const context=value.context.map(file=>{requireValue(fields(file,['path','revision','hash'])&&validAlternativeSourcePath(file.path)&&generation.scope.feature.paths.includes(file.path)&&hex(file.hash)&&file.revision===file.hash.slice(0,16));return clone(file);});
 if(files!==undefined){validateAlternativeGenerationFiles(generation,files);requireValue(equal(context,files.map(file=>({path:file.path,revision:file.revision,hash:hash(file.source)}))));}
 requireValue(list(value.candidates)&&value.candidates.length===2);
 const ids=new Set([value.id]),names=new Set(),variants=new Set();let requestId;
 const candidates=value.candidates.map((candidate,index)=>{
  requireValue(fields(candidate,['id','name','reason','changeSet'])&&uuid(candidate.id)&&!ids.has(candidate.id)&&text(candidate.name,80)&&text(candidate.reason,2000,{multiline:true})&&!names.has(candidate.name.toLocaleLowerCase('en-US')));
  ids.add(candidate.id);names.add(candidate.name.toLocaleLowerCase('en-US'));
  const changeSet=validateChangeSet(candidate.changeSet,projectId);
  requireValue(!ids.has(changeSet.id)&&changeSet.origin==='ai'&&changeSet.status==='proposed'&&changeSet.revision===0&&changeSet.createdAt===undefined&&changeSet.updatedAt===undefined&&equal(changeSet.context,context.map(({path,revision})=>({path,revision}))));
  ids.add(changeSet.id);
  if(index===0)requestId=changeSet.requestId;else requireValue(changeSet.requestId===requestId);
  let beforeBytes=0,afterBytes=0;
  for(const file of changeSet.files){
   requireValue(!ids.has(file.id)&&file.appliedRevision===undefined&&validAlternativeSourcePath(file.path)&&source(file.before)&&source(file.after)&&context.some(item=>item.path===file.path&&item.hash===hash(file.before)));
   ids.add(file.id);beforeBytes+=Buffer.byteLength(file.before);afterBytes+=Buffer.byteLength(file.after);
   if(files!==undefined)requireValue(files.some(item=>item.path===file.path&&item.source===file.before));
  }
  requireValue(beforeBytes<=AI_ALTERNATIVE_LIMITS.sourceBytes&&afterBytes<=AI_ALTERNATIVE_LIMITS.sourceBytes);
  const variant=canonical(context.map(file=>({path:file.path,hash:changeSet.files.some(item=>item.path===file.path)?hash(changeSet.files.find(item=>item.path===file.path).after):file.hash})).sort((a,b)=>a.path.localeCompare(b.path)));
  requireValue(!variants.has(variant));variants.add(variant);
  return {id:candidate.id,name:candidate.name,reason:candidate.reason,changeSet};
 });
 return {schemaVersion:1,id:value.id,projectId,title:value.title,summary:value.summary,generation,context,candidates,verificationStatus:'not-run'};
}

/** Digest establishes content identity; the host must resolve ownership separately. */
export const aiAlternativesDigest=value=>hash(canonical(normalizeAIAlternatives(value)));

export function createAIAlternatives({raw,files,projectId,generation:input}={}) {
 const generation=validateAlternativeGenerationFiles(input,files);
 requireValue(typeof raw==='string'&&raw.isWellFormed()&&!raw.includes('\0')&&Buffer.byteLength(raw)<=AI_ALTERNATIVE_LIMITS.rawBytes);
 let value;try{value=JSON.parse(raw);}catch{throw new AIAlternativesError('invalid-ai-alternatives','The model did not return complete alternative proposals. Try a narrower design brief.');}
 requireValue(fields(value,['title','summary','candidates'])&&text(value.title,160)&&text(value.summary,2000,{multiline:true})&&list(value.candidates)&&value.candidates.length===2);
 const candidates=value.candidates.map(candidate=>{
  requireValue(fields(candidate,['name','reason','title','summary','edits','verification'])&&text(candidate.name,80)&&text(candidate.reason,2000,{multiline:true}));
  const {name,reason,...proposal}=candidate;
  const artifact=createBuildArtifact({raw:JSON.stringify(proposal),files,projectId});
  requireValue(artifact.type==='changeSet');
  return {id:randomUUID(),name,reason,changeSet:artifact.changeSet};
 });
 return normalizeAIAlternatives({schemaVersion:1,id:randomUUID(),projectId,title:value.title,summary:value.summary,generation,
  context:files.map(file=>({path:file.path,revision:file.revision,hash:hash(file.source)})),candidates,verificationStatus:'not-run'},projectId,files);
}
