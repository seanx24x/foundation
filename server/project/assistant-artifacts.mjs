import { randomUUID, createHash } from 'node:crypto';

const MAX_BYTES = 64 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) => typeof value === 'string' && !value.includes('\0') && Buffer.byteLength(value, 'utf8') <= limit && Buffer.from(value, 'utf8').toString('utf8') === value;
const token = value => text(value, 200) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const uuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const path = value => text(value, 1000) && !!value && !/^[\/\\]/.test(value) && !/[\\\r\n]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
const sourceId = value => /^S[1-8]$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 1;

export class AssistantArtifactError extends Error {
  constructor(code, message) { super(message); this.name = 'AssistantArtifactError'; this.code = code; this.status = 400; }
}
function requireValue(condition, code = 'invalid-assistant-artifact') {
  if (!condition) throw new AssistantArtifactError(code, code === 'invalid-plan-context'
    ? 'The selected plan step could not be validated. Review its source context and try again.'
    : 'The assistant returned an unsupported or invalid structured artifact. No action is available from it.');
}
function keys(value, allowed) { requireValue(object(value) && Object.keys(value).every(key => allowed.includes(key))); }
function string(value, limit) { requireValue(text(value, limit) && !!value.trim()); return value.trim(); }
function strings(value) { requireValue(Array.isArray(value) && value.length <= 12); return value.map(item => string(item, 500)); }
function metadata(files) {
  requireValue(Array.isArray(files) && files.length >= 1 && files.length <= 8);
  const paths = new Set(); let bytes = 0;
  return files.map((file, index) => {
    requireValue(object(file) && path(file.path) && token(file.revision) && text(file.source, MAX_BYTES) && !paths.has(file.path) && (file.id === undefined || file.id === `S${index + 1}`));
    paths.add(file.path); bytes += Buffer.byteLength(file.source, 'utf8'); requireValue(bytes <= MAX_BYTES);
    return {id:`S${index + 1}`,path:file.path,revision:file.revision,lines:file.source.split('\n').length};
  });
}
function references(value, context, {canonical = false, minimum = 0, remap = false} = {}) {
  requireValue(Array.isArray(value) && value.length >= minimum && value.length <= 8);
  const seen = new Set();
  return value.map(item => {
    keys(item, canonical ? ['sourceId','path','revision','line','endLine'] : ['sourceId','line','endLine']);
    requireValue(typeof item.sourceId === 'string' && sourceId(item.sourceId) && integer(item.line));
    const endLine = item.endLine === undefined && !canonical ? item.line : item.endLine;
    requireValue(integer(endLine) && endLine >= item.line);
    let file = context?.find(file => remap ? file.path === item.path && file.revision === item.revision : file.id === item.sourceId);
    if (context) requireValue(file && endLine <= file.lines);
    if (canonical) requireValue(path(item.path) && token(item.revision) && (!file || file.path === item.path && file.revision === item.revision));
    const key = `${item.sourceId}:${item.line}:${endLine}`; requireValue(!seen.has(key)); seen.add(key);
    return {sourceId:item.sourceId,path:canonical ? item.path : file.path,revision:canonical ? item.revision : file.revision,line:item.line,endLine};
  });
}
function parse(raw) {
  requireValue(text(raw, MAX_BYTES));
  try { return JSON.parse(raw); } catch { requireValue(false); }
}
function core(value, files, projectId, kind, canonical) {
  requireValue(token(projectId));
  const context = metadata(files);
  const contentKeys = kind === 'plan' ? ['title','summary','steps','risks','verification'] : ['title','summary','findings','limitations'];
  keys(value, canonical ? [...contentKeys,'schemaVersion','id','projectId','context','verificationStatus'] : contentKeys);
  if (canonical) {
    requireValue(value.schemaVersion === 1 && uuid(value.id) && value.projectId === projectId && value.verificationStatus === 'not-run');
    requireValue(Array.isArray(value.context) && value.context.length === context.length);
    value.context.forEach((item, index) => {
      keys(item, ['id','path','revision','lines']);
      const expected = context[index]; requireValue(item.id === expected.id && item.path === expected.path && item.revision === expected.revision && item.lines === expected.lines);
    });
  }
  const result = {schemaVersion:1,id:canonical ? value.id : randomUUID(),projectId,title:string(value.title,160),summary:string(value.summary,2000),context,verificationStatus:'not-run'};
  const ids = new Set();
  if (kind === 'plan') {
    requireValue(Array.isArray(value.steps) && value.steps.length >= 1 && value.steps.length <= 16);
    result.steps = value.steps.map(item => {
      keys(item, canonical ? ['id','title','detail','references'] : ['title','detail','references']);
      if (canonical) { requireValue(uuid(item.id) && !ids.has(item.id) && item.id !== result.id); ids.add(item.id); }
      return {id:canonical ? item.id : randomUUID(),title:string(item.title,160),detail:string(item.detail,2000),references:references(item.references,context,{canonical})};
    });
    result.risks = strings(value.risks); result.verification = strings(value.verification);
  } else {
    requireValue(Array.isArray(value.findings) && value.findings.length <= 24);
    result.findings = value.findings.map(item => {
      keys(item, canonical ? ['id','severity','title','detail','references','suggestion'] : ['severity','title','detail','references','suggestion']);
      requireValue(['high','medium','low'].includes(item.severity));
      if (canonical) { requireValue(uuid(item.id) && !ids.has(item.id) && item.id !== result.id); ids.add(item.id); }
      return {id:canonical ? item.id : randomUUID(),severity:item.severity,title:string(item.title,160),detail:string(item.detail,2000),references:references(item.references,context,{canonical,minimum:1}),...(item.suggestion !== undefined ? {suggestion:string(item.suggestion,2000)} : {})};
    });
    result.limitations = strings(value.limitations);
  }
  requireValue(Buffer.byteLength(JSON.stringify(result),'utf8') <= MAX_BYTES);
  return result;
}

export function normalizeAssistantIntent(value) {
  if (value === undefined) return 'ask';
  if (value === 'change') return 'build';
  if (['ask','plan','build','review'].includes(value)) return value;
  throw new AssistantArtifactError('invalid-intent','Choose Ask, Plan, Build, or Review.');
}
export function createPlanArtifact({raw,files,projectId} = {}) { return core(parse(raw),files,projectId,'plan',false); }
export function createReviewArtifact({raw,files,projectId} = {}) { return core(parse(raw),files,projectId,'review',false); }
export function validatePlanArtifact(value,files,projectId) { return core(value,files,projectId,'plan',true); }
export function validateReviewArtifact(value,files,projectId) { return core(value,files,projectId,'review',true); }

/** A host-resolved selected step. It grants no tools, source access, or verification authority. */
export function normalizePlanContext(value, files) {
  if (value === undefined) return undefined;
  try {
    keys(value,['version','conversationId','requestId','artifactId','revision','stepId','title','summary','step','verification']);
    requireValue(value.version === 1 && token(value.conversationId) && token(value.requestId) && uuid(value.artifactId) && uuid(value.stepId) && Number.isSafeInteger(value.revision) && value.revision >= 0);
    keys(value.step,['title','detail','references']);
    return {version:1,conversationId:value.conversationId,requestId:value.requestId,artifactId:value.artifactId,revision:value.revision,stepId:value.stepId,
      title:string(value.title,160),summary:string(value.summary,2000),step:{title:string(value.step.title,160),detail:string(value.step.detail,2000),references:references(value.step.references,files === undefined ? undefined : metadata(files),{canonical:true,remap:true})},verification:strings(value.verification)};
  } catch { throw new AssistantArtifactError('invalid-plan-context','The selected plan step could not be validated. Review its source context and try again.'); }
}


const CHECK_LABELS = Object.freeze({'node:test':'Node tests','typescript:check':'TypeScript check'});
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/** Exact host-owned candidate metadata. This conveys no executable payload or tool authority. */
export function normalizeCheckContext(value) {
  if (value === undefined) return undefined;
  try {
    keys(value,['version','conversationId','requestId','groupId','groupRevision','groupDigest','snapshotRevision','tasks']);
    requireValue(value.version === 1 && token(value.conversationId) && token(value.requestId) && uuid(value.groupId) &&
      Number.isSafeInteger(value.groupRevision) && value.groupRevision >= 0 && sha256(value.groupDigest) && sha256(value.snapshotRevision));
    requireValue(Array.isArray(value.tasks) && value.tasks.length >= 1 && value.tasks.length <= 2);
    const seen = new Set(), tasks = value.tasks.map(task => {
      keys(task,['id','label']); requireValue(Object.hasOwn(CHECK_LABELS,task.id) && task.label === CHECK_LABELS[task.id] && !seen.has(task.id));
      seen.add(task.id); return {id:task.id,label:task.label};
    });
    return {version:1,conversationId:value.conversationId,requestId:value.requestId,groupId:value.groupId,groupRevision:value.groupRevision,
      groupDigest:value.groupDigest,snapshotRevision:value.snapshotRevision,tasks};
  } catch { throw new AssistantArtifactError('invalid-check-context','Choose the current staged group and its advertised isolated checks before asking for a recommendation.'); }
}
function checkSuggestionValue(value,context,projectId,canonical) {
  requireValue(token(projectId));
  keys(value,canonical?['schemaVersion','id','projectId','verificationStatus','title','summary','checks','limitations']:['title','summary','checks','limitations']);
  if(canonical)requireValue(value.schemaVersion===1&&uuid(value.id)&&value.projectId===projectId&&value.verificationStatus==='not-run');
  requireValue(Array.isArray(value.checks)&&value.checks.length<=2);
  const seen=new Set(),checks=value.checks.map(check=>{
    keys(check,['taskId','reason']);requireValue(Object.hasOwn(CHECK_LABELS,check.taskId)&&!seen.has(check.taskId)&&(!context||context.tasks.some(task=>task.id===check.taskId)));
    seen.add(check.taskId);return {taskId:check.taskId,reason:string(check.reason,1000)};
  });
  const result={schemaVersion:1,id:canonical?value.id:randomUUID(),projectId,verificationStatus:'not-run',title:string(value.title,160),summary:string(value.summary,2000),checks,limitations:strings(value.limitations)};
  requireValue(Buffer.byteLength(JSON.stringify(result),'utf8')<=MAX_BYTES);return result;
}
export function createCheckSuggestion({raw,checkContext,projectId}={}) {
  const context=normalizeCheckContext(checkContext);requireValue(context);return checkSuggestionValue(parse(raw),context,projectId,false);
}
export function validateCheckSuggestion(value,checkContext,projectId) {
  const context=normalizeCheckContext(checkContext);requireValue(context);return checkSuggestionValue(value,context,projectId,true);
}
export function checkSuggestionDigest(value) {
  const canonical=checkSuggestionValue(value,undefined,value?.projectId,true);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
