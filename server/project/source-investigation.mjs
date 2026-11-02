import {createHash, randomUUID} from 'node:crypto';

const MAX_BYTES = 32768;
const LIMITS = {edges:24, requests:8, boundaries:12};
const EDGE_KINDS = new Set(['import','re-export','stylesheet','call','render','type-reference','test-reference']);
const BOUNDARY_KINDS = new Set(['unsupported','limit','unavailable','parse-error','unresolved']);
const SAVED_BOUNDARY = 'Static saved-source relationships do not establish runtime order, backend behavior, test execution, or coverage. Unsaved edits are excluded. Dynamic dispatch, configured aliases, packages, and CommonJS bindings are not resolved.';
const copy = value => structuredClone(value);
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value),'utf8');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value,limit) => typeof value === 'string' && bytes(value)<=limit && !/[\u0000-\u001f\u007f]/.test(value) && Buffer.from(value,'utf8').toString('utf8')===value;
const token = value => text(value,200) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const uuid = value => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const revision = value => typeof value==='string' && /^[a-f0-9]{16}$/.test(value);
const pathValue = value => text(value,1000) && !!value && !/^[\/\\]/.test(value) && !value.includes('\\') && value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const integer = (value,max=Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value)&&value>=0&&value<=max;
const timestamp = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const exact = (value,required,optional=[]) => object(value) && required.every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
export class SourceInvestigationError extends Error { constructor(){super('The saved-source investigation is invalid. Refresh its relationships before sharing.');this.name='SourceInvestigationError';this.status=400;this.code='invalid-source-investigation';} }
function check(condition){if(!condition)throw new SourceInvestigationError();}
function reference(value){
 check(exact(value,['path','revision','line','column'],['label'])&&pathValue(value.path)&&revision(value.revision)&&integer(value.line,1000000)&&value.line>0&&integer(value.column,1000000)&&value.column>0&&(!Object.hasOwn(value,'label')||text(value.label,720)));
 return {path:value.path,revision:value.revision,line:value.line,column:value.column,...(value.label!==undefined?{label:value.label}:{})};
}
function edge(value){
 check(exact(value,['id','kind','from','to','provenance'],['detail'])&&/^relationship-[a-f0-9]{16}$/.test(value.id)&&EDGE_KINDS.has(value.kind)&&value.provenance==='source'&&(!Object.hasOwn(value,'detail')||text(value.detail,2048)));
 return {id:value.id,kind:value.kind,from:reference(value.from),to:reference(value.to),provenance:'source',...(value.detail!==undefined?{detail:value.detail}:{})};
}
function request(value){
 check(exact(value,['id','source','method','url','urlKind','provenance'])&&/^request-[a-f0-9]{16}$/.test(value.id)&&value.provenance==='source'&&['dynamic','literal'].includes(value.urlKind)&&(value.method===null||typeof value.method==='string'&&/^[A-Z]{1,16}$/.test(value.method))&&(value.url===null||text(value.url,4096)));
 if(value.url!==null){let url;try{url=new URL(value.url,'http://foundation.invalid/');}catch{check(false);}check(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&!/[\\?#]/.test(value.url));}
 check(value.urlKind!=='dynamic'||value.url===null);
 return {id:value.id,source:reference(value.source),method:value.method,url:value.url,urlKind:value.urlKind,provenance:'source'};
}
function boundary(value){check(exact(value,['kind','detail'])&&BOUNDARY_KINDS.has(value.kind)&&text(value.detail,2048)&&value.detail.trim());return {kind:value.kind,detail:value.detail};}
function canonical(value){
 check(exact(value,['version','id','projectId','featureId','featureRevision','anchor','basisDigest','createdAt','digest','edges','requests','boundaries','counts','truncated'])&&value.version===1&&uuid(value.id)&&token(value.projectId)&&token(value.featureId)&&integer(value.featureRevision)&&exact(value.anchor,['path','revision'])&&pathValue(value.anchor.path)&&revision(value.anchor.revision)&&digest(value.basisDigest)&&timestamp(value.createdAt)&&digest(value.digest)&&typeof value.truncated==='boolean');
 for(const key of ['edges','requests','boundaries'])check(Array.isArray(value[key])&&value[key].length<=LIMITS[key]);
 check(exact(value.counts,['edges','requests'])&&integer(value.counts.edges,200)&&integer(value.counts.requests,100)&&value.counts.edges>=value.edges.length&&value.counts.requests>=value.requests.length);
 check(value.truncated||value.counts.edges===value.edges.length&&value.counts.requests===value.requests.length);
 const edges=value.edges.map(edge),requests=value.requests.map(request),boundaries=value.boundaries.map(boundary);
 check(new Set([...edges,...requests].map(item=>item.id)).size===edges.length+requests.length);
 check(boundaries.some(item=>item.kind==='unsupported'&&item.detail===SAVED_BOUNDARY));
 const revisions=new Map([[value.anchor.path,value.anchor.revision]]);
 for(const ref of [...edges.flatMap(item=>[item.from,item.to]),...requests.map(item=>item.source)]){check(!revisions.has(ref.path)||revisions.get(ref.path)===ref.revision);revisions.set(ref.path,ref.revision);}
 check(edges.every(item=>item.from.path===value.anchor.path||item.to.path===value.anchor.path)&&requests.every(item=>item.source.path===value.anchor.path));
 return {version:1,id:value.id,projectId:value.projectId,featureId:value.featureId,featureRevision:value.featureRevision,anchor:{path:value.anchor.path,revision:value.anchor.revision},basisDigest:value.basisDigest,createdAt:value.createdAt,edges,requests,boundaries,counts:{edges:value.counts.edges,requests:value.counts.requests},truncated:value.truncated};
}
/** Digest includes immutable identity, saved-source basis, exact disclosure and omissions. */
export function sourceInvestigationDigest(value){return hash(canonical(value));}
export function validateSourceInvestigation(value,projectId,context){
 const result=canonical(value);check(value.digest===hash(result)&&bytes(value)<=MAX_BYTES&&(!projectId||result.projectId===projectId));
 if(context!==undefined)check(Array.isArray(context)&&context.length===1&&context[0].path===result.anchor.path&&context[0].revision===result.anchor.revision&&typeof context[0].source==='string'&&createHash('sha256').update(context[0].source).digest('hex').slice(0,16)===result.anchor.revision);
 return {...result,digest:value.digest};
}
export function normalizeSourceInvestigationDescriptor(value){
 if(value===undefined)return undefined;
 check(exact(value,['version','id','digest'])&&value.version===1&&uuid(value.id)&&digest(value.digest));return {version:1,id:value.id,digest:value.digest};
}
export function sourceInvestigationDescriptor(value){const result=validateSourceInvestigation(value);return {version:1,id:result.id,digest:result.digest};}
export function createSourceInvestigation({projectId,featureId,featureRevision,graph}){
 check(object(graph)&&graph.schemaVersion===1&&graph.projectId===projectId&&Array.isArray(graph.manifest)&&graph.manifest.length>0&&graph.manifest.length<=1500&&Array.isArray(graph.edges)&&graph.edges.length<=200&&Array.isArray(graph.requests)&&graph.requests.length<=100&&Array.isArray(graph.boundaries)&&graph.boundaries.length<=100);
 const manifest=graph.manifest.map(item=>{check(exact(item,['path','revision'])&&pathValue(item.path)&&revision(item.revision));return {path:item.path,revision:item.revision};}).sort((a,b)=>a.path.localeCompare(b.path));
 check(new Set(manifest.map(item=>item.path)).size===manifest.length&&graph.anchor&&manifest.some(item=>item.path===graph.anchor.path&&item.revision===graph.anchor.revision));
 // The analyzer labels expressions with their source spelling; normalize line
 // breaks for a single-line disclosure without changing any source location.
 const displayRef = value => ({...value,...(typeof value?.label==='string'?{label:value.label.replace(/\s+/g,' ').trim()}:{})});
 const edges=graph.edges.slice(0,LIMITS.edges).map(value=>edge({...value,from:displayRef(value.from),to:displayRef(value.to)})),
   requests=graph.requests.slice(0,LIMITS.requests).map(value=>request({...value,source:displayRef(value.source)}));
 const paths=new Set([graph.anchor.path,...edges.flatMap(item=>[item.from.path,item.to.path]),...requests.map(item=>item.source.path)]);
 for(const ref of [...edges.flatMap(item=>[item.from,item.to]),...requests.map(item=>item.source)])check(manifest.some(item=>item.path===ref.path&&item.revision===ref.revision));
 // Drop unrelated parse/unavailable filenames; a fixed boundary retains the analysis limits.
 const boundaries=[{kind:'unsupported',detail:SAVED_BOUNDARY}];let omittedBoundary=false;
 for(const item of graph.boundaries){if(item.path&&!paths.has(item.path)){omittedBoundary=true;continue;}const normalized=boundary({kind:item.kind,detail:item.detail});if(!boundaries.some(prior=>JSON.stringify(prior)===JSON.stringify(normalized)))boundaries.push(normalized);}
 if(omittedBoundary)boundaries.splice(1,0,{kind:'unavailable',detail:'Some indexed saved files could not contribute to this analysis. Their paths and contents are not shared; additional relationships may be missing.'});
 const value={version:1,id:randomUUID(),projectId,featureId,featureRevision,anchor:{path:graph.anchor.path,revision:graph.anchor.revision},basisDigest:hash(manifest),createdAt:new Date().toISOString(),digest:'0'.repeat(64),edges,requests,boundaries:boundaries.slice(0,LIMITS.boundaries),counts:{edges:graph.edges.length,requests:graph.requests.length},truncated:Boolean(graph.truncated||omittedBoundary||graph.edges.length>edges.length||graph.requests.length>requests.length||boundaries.length>LIMITS.boundaries)};
 while(bytes(value)>MAX_BYTES){value.truncated=true;if(value.edges.length)value.edges.pop();else if(value.requests.length)value.requests.pop();else if(value.boundaries.length>1)value.boundaries.pop();else check(false);}
 value.digest=sourceInvestigationDigest(value);return validateSourceInvestigation(value,projectId);
}
/** This is the entire evidence disclosure. Identity/basis manifests remain local. */
export function sourceInvestigationForProvider(value){
 const result=validateSourceInvestigation(value),ref=({revision:_revision,...item})=>copy(item);let index=0;
 return {anchorPath:result.anchor.path,edges:result.edges.map(({id:_id,...item})=>({...item,id:`I${++index}`,from:ref(item.from),to:ref(item.to)})),requests:result.requests.map(({id:_id,...item})=>({...item,id:`I${++index}`,source:ref(item.source)})),boundaries:copy(result.boundaries),counts:copy(result.counts),truncated:result.truncated};
}
