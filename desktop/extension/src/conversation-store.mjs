import {normalizeAlternativeGeneration,validateAlternativeGenerationFiles,normalizeAIAlternatives,aiAlternativesDigest} from '../../../server/project/ai-alternatives.mjs';
import {normalizeReproducibleIssueContext} from '../../../server/project/reproducible-issues.mjs';
import {normalizeProjectDecisionContext} from '../../../server/project/project-decisions.mjs';
import {deriveInvestigationContext,deriveInvestigationChain,validateInvestigationContext,validateInvestigationDecision} from '../../../server/project/investigation-continuation.mjs';
import {validateSourceInvestigation} from '../../../server/project/source-investigation.mjs';
import { randomUUID } from 'node:crypto';
import { validateChangeSet, groupRevisionDescriptor, changeGroupDigest } from '../../../server/project/proposals.mjs';
import { validatePlanArtifact, validateReviewArtifact, normalizePlanContext, normalizeCheckContext, validateCheckSuggestion } from '../../../server/project/assistant-artifacts.mjs';

const MAX_BYTES = 8 * 1024 * 1024;
const MUTATION_BYTES = MAX_BYTES - 2048; // Leave room for an explicit terminal capacity failure.
const MAX_ANSWER = 256 * 1024;
const STATES = new Set(['running', 'stopping', 'complete', 'stopped', 'failed', 'interrupted']);
const LIVE = new Set(['running', 'stopping']);
const TERMINAL = new Set(['complete', 'stopped', 'failed', 'interrupted']);
const INTENTS = new Set(['ask', 'plan', 'build', 'review']);
const MAX_PLAN_REVISIONS = 17; // Provider revision zero and sixteen explicit local saves.
const PROPOSAL_STATES = new Set(['proposed', 'applied', 'undone', 'discarded', 'stale']);
const INTERRUPTED = 'Foundation closed before this response finished. Partial output is preserved; no request was resumed.';
const FAILED = 'The response could not complete. Partial output is preserved.';
const CAPACITY = 'Local conversation history reached its size limit. The partial response is preserved; no further output was retained.';
const STORAGE_FAILED = 'Conversation history could not be saved locally. Retry saving before starting another request.';
const UNAVAILABLE = 'Saved conversation history could not be read safely. It has been left unchanged.';
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
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) => typeof value === 'string' && !value.includes('\0') && bytes(value) <= limit;
const token = value => text(value, 200) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const sourcePath = value => text(value, 1000) && !!value && !/^[\/\\]/.test(value) && !/[\\\r\n]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
const timestamp = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
function requireValue(condition) { if (!condition) throw new Error('Invalid conversation data'); }
function failure(code, message) { return Object.assign(new Error(message), { name: 'ConversationStoreError', code }); }

function exactKeys(value,required,optional=[]){return object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));}
function investigationAttemptsValue(value,turn,projectId){
  requireValue(Array.isArray(value)&&value.length<=2&&turn.investigationContext&&turn.investigationDecision?.decision.kind==='investigate'&&turn.state==='complete'&&!turn.completedWhileStopping);
  const ids=new Set(),basis=turn.investigationContext.result,target=turn.investigationDecision.decision.target;let previous;
  return value.map(item=>{
    requireValue(exactKeys(item,['id','status','startedAt'],['finishedAt','result','reason'])&&token(item.id)&&!ids.has(item.id)&&['running','complete','failed','stopped','interrupted'].includes(item.status)&&timestamp(item.startedAt)&&(!previous||['failed','stopped','interrupted'].includes(previous.status)));
    ids.add(item.id);const result={id:item.id,status:item.status,startedAt:item.startedAt};
    if(item.status==='running')requireValue(item.finishedAt===undefined&&item.result===undefined&&item.reason===undefined);
    else{requireValue(timestamp(item.finishedAt)&&Date.parse(item.finishedAt)>=Date.parse(item.startedAt));result.finishedAt=item.finishedAt;
      if(item.status==='complete'){result.result=validateSourceInvestigation(item.result,projectId);requireValue(item.reason===undefined&&result.result.anchor.path===target.path&&result.result.anchor.revision===target.revision&&result.result.featureId===basis.featureId&&result.result.featureRevision===basis.featureRevision&&result.result.basisDigest===basis.basisDigest&&result.result.id!==basis.id);}
      else{requireValue(item.result===undefined&&text(item.reason,1000));result.reason=item.reason;}}
    previous=result;return result;
  });
}

function contextValue(value) {
  requireValue(Array.isArray(value) && value.length > 0 && value.length <= 8);
  const paths = new Set();
  let total = 0;
  return value.map((item, index) => {
    requireValue(object(item) && sourcePath(item.path) && token(item.revision) && text(item.source, 65536) && !paths.has(item.path));
    paths.add(item.path); total += bytes(item.source); requireValue(total <= 65536);
    return { id: `S${index + 1}`, path: item.path, revision: item.revision, source: item.source, lines: item.source.split('\n').length };
  });
}
function requestRevisionValue(value) {
  requireValue(object(value) && Object.keys(value).length === 3 &&
    Object.keys(value).every(key => ['version', 'conversationId', 'requestId'].includes(key)) &&
    value.version === 1 && token(value.conversationId) && token(value.requestId));
  return {version:1,conversationId:value.conversationId,requestId:value.requestId};
}
function requestRevisionMatches(parent, child) {
  return !!parent && TERMINAL.has(parent.state) && !parent.alternativeGeneration && !child.alternativeGeneration && !parent.planContext && !parent.groupRevision && !parent.checkContext && !parent.sourceInvestigation && !parent.investigationContext && !child.investigationContext && !child.sourceInvestigation && !child.checkContext && !child.planContext && !child.groupRevision && parent.intent === child.intent &&
    parent.context.length === child.context.length && parent.context.every((source, index) =>
      source.path === child.context[index].path && source.revision === child.context[index].revision && source.source === child.context[index].source);
}
function groupRevisionMatches(binding, parent, child) {
  return !!parent && parent.state === 'complete' && !parent.completedWhileStopping && parent.intent === 'build' && !parent.planContext &&
    !!parent.changeSet && parent.changeSet.id === binding.groupId && binding.groupRevision <= parent.changeSet.revision &&
    changeGroupDigest(parent.changeSet) === binding.groupDigest && child.intent === 'build' && !child.planContext && !child.requestRevision && !child.checkContext &&
    parent.context.length === child.context.length && parent.context.every((source,index) => source.path === child.context[index].path &&
      source.revision === child.context[index].revision && source.source === child.context[index].source);
}
function checkContextMatches(binding,parent,child) {
  return !!parent && parent.state === 'complete' && !parent.completedWhileStopping && parent.intent === 'build' && !parent.planContext &&
    !!parent.changeSet && parent.changeSet.id === binding.groupId && binding.groupRevision <= parent.changeSet.revision &&
    changeGroupDigest(parent.changeSet) === binding.groupDigest && child.intent === 'plan' && !child.planContext && !child.requestRevision && !child.groupRevision &&
    child.taskContext === undefined && child.decisionContext === undefined && child.issueContext === undefined && child.runtimeEvidence === undefined && child.runtimeEvidenceVersion === undefined &&
    parent.context.length === child.context.length && parent.context.every((source,index)=>source.path===child.context[index].path&&source.revision===child.context[index].revision&&source.source===child.context[index].source);
}
function runtimeEvidenceValue(value) {
  requireValue(Array.isArray(value) && value.length <= 12);
  const ids = new Set(); let session;
  return value.map((item, index) => {
    requireValue(object(item) && item.id === `R${index + 1}` && token(item.observationId) && !ids.has(item.observationId)
      && token(item.session) && (session === undefined || session === item.session) && item.kind === 'request'
      && text(item.method, 16) && /^[A-Z]{1,16}$/.test(item.method) && text(item.url, 2048) && item.url
      && (item.status === null || Number.isInteger(item.status) && item.status >= 100 && item.status <= 599)
      && Number.isFinite(item.durationMs) && item.durationMs >= 0 && item.durationMs <= 86400000
      && ['success', 'http-error', 'network-error', 'aborted'].includes(item.outcome)
      && timestamp(item.observedAt) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(item.observedAt)
      && item.correlation === 'unattributed' && item.provenance === 'observed');
    const relative = item.url.startsWith('/') && !item.url.startsWith('//');
    const url = new URL(item.url, 'http://foundation.invalid');
    requireValue((relative || /^https?:\/\//.test(item.url)) && ['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password && !url.search && !url.hash);
    ids.add(item.observationId); session = item.session;
    return {id:item.id, observationId:item.observationId, session:item.session, kind:'request', method:item.method,
      url:relative ? url.pathname : url.href, status:item.status, durationMs:item.durationMs, outcome:item.outcome,
      observedAt:item.observedAt, correlation:'unattributed', provenance:'observed'};
  });
}
const providerKindValue = value => { requireValue(['openai', 'anthropic', 'compatible'].includes(value)); return value; };
function taskContextValue(value) {
  requireValue(object(value) && value.version === 1
    && typeof value.featureId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.featureId)
    && typeof value.title === 'string' && value.title.trim() && value.title.trim().length <= 80
    && typeof value.brief === 'string' && value.brief.length <= 2000
    && Number.isSafeInteger(value.revision) && value.revision >= 0);
  return {version:1, featureId:value.featureId, title:value.title.trim(), brief:value.brief, revision:value.revision};
}
function usageValue(value) {
  if (!object(value)) return undefined;
  const result = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'input_tokens', 'output_tokens']) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key];
  }
  return Object.keys(result).length ? result : undefined;
}
function proposalValue(item, projectId) {
  requireValue(object(item) && token(item.id) && item.projectId === projectId && sourcePath(item.path)
    && text(item.before, MAX_ANSWER) && text(item.after, MAX_ANSWER) && token(item.baseRevision) && PROPOSAL_STATES.has(item.status));
  const result = {
    id: item.id, projectId, path: item.path, before: item.before, after: item.after,
    baseRevision: item.baseRevision, status: item.status,
    origin: item.origin === 'design' ? 'design' : 'ai',
    title: text(item.title, 160) ? item.title : 'Source change',
    summary: text(item.summary, 2000) ? item.summary : '',
    context: [], verification: [],
  };
  if (item.context !== undefined) {
    requireValue(Array.isArray(item.context) && item.context.length <= 8);
    result.context = item.context.map(source => {
      requireValue(object(source) && sourcePath(source.path) && token(source.revision));
      return { path: source.path, revision: source.revision };
    });
  }
  if (item.planBasis !== undefined) {
    requireValue(Array.isArray(item.planBasis) && item.planBasis.length >= 1 && item.planBasis.length <= 8);
    const paths = new Set();
    result.planBasis = item.planBasis.map(source => {
      requireValue(object(source) && Object.keys(source).every(key => ['path','revision'].includes(key)) && sourcePath(source.path) &&
        !/^[A-Za-z]:|[\u0000-\u001f\u007f]/.test(source.path) && token(source.revision) && !paths.has(source.path));
      paths.add(source.path); return {path:source.path,revision:source.revision};
    });
    requireValue(result.planBasis.some(source => source.path === item.path && source.revision === item.baseRevision));
    requireValue(result.context.every(source => result.planBasis.some(basis => basis.path === source.path && basis.revision === source.revision)));
  }
  if (item.verification !== undefined) {
    requireValue(Array.isArray(item.verification) && item.verification.length <= 12 && item.verification.every(check => text(check, 500)));
    result.verification = [...item.verification];
  }
  for (const key of ['requestId', 'appliedRevision']) if (item[key] !== undefined) { requireValue(token(item[key])); result[key] = item[key]; }
  for (const key of ['createdAt', 'appliedAt']) if (timestamp(item[key])) result[key] = item[key];
  if (item.conflict === true) result.conflict = true;
  if (typeof item.reason === 'string' && item.reason) result.reason = 'This proposal requires a fresh source check before it can be changed.';
  return result;
}
function proposalBasisMatches(proposal, turn, conversations) {
  if (!turn.planContext) return proposal.planBasis === undefined;
  const binding = turn.planContext;
  const parent = conversations.find(chat => chat.id === binding.conversationId)?.turns.find(item => item.requestId === binding.requestId);
  const basis = parent?.context;
  const revision = parent?.planRevisions?.find(item => item.revision === binding.revision), step = revision?.steps.find(item => item.id === binding.stepId), original = parent?.plan?.steps.find(item => item.id === binding.stepId);
  return turn.intent === 'build' && parent?.state === 'complete' && !parent.completedWhileStopping && parent.plan?.id === binding.artifactId && step?.included && original &&
    binding.title === revision.title && binding.summary === revision.summary && binding.step.title === step.title && binding.step.detail === step.detail &&
    JSON.stringify(binding.step.references) === JSON.stringify(original.references) && JSON.stringify(binding.verification) === JSON.stringify(revision.verification) &&
    Array.isArray(proposal.planBasis) && proposal.planBasis.length === basis?.length && basis.every(source => proposal.planBasis.some(item => item.path === source.path && item.revision === source.revision));
}
function changeSetMatches(changeSet, turn) {
  return turn.intent === 'build' && !turn.alternativeGeneration && !turn.planContext && !turn.proposal &&
    changeSet.context.length === turn.context.length && changeSet.context.every((source,index) => source.path === turn.context[index].path && source.revision === turn.context[index].revision) &&
    changeSet.files.every(file => turn.context.some(source => source.path === file.path && source.revision === file.baseRevision && source.source === file.before));
}
function turnArtifactIds(turn) {
  return [turn.plan?.id,turn.review?.id,turn.changeSet?.id,turn.checkSuggestion?.id,turn.investigationDecision?.id,
    turn.alternatives?.id,...(turn.alternatives?.candidates||[]).flatMap(candidate=>[candidate.id,candidate.changeSet.id,...candidate.changeSet.files.map(file=>file.id)])].filter(Boolean);
}
function hasArtifactIdentity(data,id) {return data.conversations.some(chat=>chat.turns.some(turn=>turnArtifactIds(turn).includes(id)));}
function immutableChangeSet(value) {
  const {status,revision,updatedAt,createdAt,requestId,...content} = value;
  return {...content,files:value.files.map(({appliedRevision,...file}) => file)};
}
function sameChangeSetContent(a,b) { return JSON.stringify(immutableChangeSet(a)) === JSON.stringify(immutableChangeSet(b)); }
function changeSetUpdateAllowed(prior,next) {
  return sameChangeSetContent(prior,next) && prior.requestId === next.requestId &&
    (prior.createdAt === undefined || prior.createdAt === next.createdAt) &&
    (prior.updatedAt === undefined || next.updatedAt !== undefined && next.updatedAt >= prior.updatedAt) &&
    (JSON.stringify(prior) === JSON.stringify(next) || next.revision > prior.revision);
}
function verificationValue(item, proposalId) {
  requireValue(object(item) && token(item.id) && item.proposalId === proposalId && token(item.revision)
    && token(item.runtimeSession) && token(item.previewRevision) && timestamp(item.recordedAt)
    && ['passed', 'failed'].includes(item.compilation) && item.interaction === 'not-run' && item.visual === 'not-run');
  return { id: item.id, proposalId, revision: item.revision, previewRevision: item.previewRevision,
    runtimeSession: item.runtimeSession, recordedAt: item.recordedAt, compilation: item.compilation,
    interaction: 'not-run', visual: 'not-run', observed: item.observed === true, historical: true };
}
function planContentValue(value, plan) {
  requireValue(object(value) && Object.keys(value).every(key => ['title', 'summary', 'steps', 'risks', 'verification'].includes(key)));
  const nonempty = (value, limit) => { requireValue(text(value, limit) && value.trim() && Buffer.from(value, 'utf8').toString('utf8') === value); return value.trim(); };
  const strings = value => { requireValue(Array.isArray(value) && value.length <= 12); return value.map(item => nonempty(item, 500)); };
  requireValue(Array.isArray(value.steps) && value.steps.length === plan.steps.length);
  const ids = new Set();
  const steps = value.steps.map(step => {
    requireValue(object(step) && Object.keys(step).every(key => ['id', 'title', 'detail', 'included'].includes(key)) &&
      plan.steps.some(original => original.id === step.id) && !ids.has(step.id) && typeof step.included === 'boolean');
    ids.add(step.id);
    return {id:step.id,title:nonempty(step.title,160),detail:nonempty(step.detail,2000),included:step.included};
  });
  return {title:nonempty(value.title,160),summary:nonempty(value.summary,2000),steps,risks:strings(value.risks),verification:strings(value.verification)};
}
function originalPlanContent(plan) {
  return {title:plan.title,summary:plan.summary,steps:plan.steps.map(({id,title,detail}) => ({id,title,detail,included:true})),risks:[...plan.risks],verification:[...plan.verification]};
}
function planRevisionsValue(value, plan) {
  requireValue(Array.isArray(value) && value.length >= 1 && value.length <= MAX_PLAN_REVISIONS);
  return value.map((item, index) => {
    requireValue(object(item) && item.revision === index && timestamp(item.createdAt) && Object.keys(item).every(key => ['revision', 'createdAt', 'title', 'summary', 'steps', 'risks', 'verification'].includes(key)));
    const {revision,createdAt,...input} = item, content = planContentValue(input,plan);
    if (index === 0) requireValue(JSON.stringify(content) === JSON.stringify(originalPlanContent(plan)));
    return {revision,createdAt,...content};
  });
}
function turnValue(item, projectId, schemaVersion = 11) {
  const legacy = schemaVersion === 1;
  requireValue(schemaVersion >= 11 || !object(item) || !['alternativeGeneration','alternatives'].some(key=>Object.hasOwn(item,key)));
  requireValue(schemaVersion >= 10 || !object(item) || !Object.hasOwn(item, 'issueContext'));
  requireValue(schemaVersion >= 9 || !object(item) || !Object.hasOwn(item, 'decisionContext'));
  requireValue(schemaVersion >= 8 || !object(item) || !['investigationContext','investigationDecision','investigationAttempts','investigationEnded'].some(key=>Object.hasOwn(item,key)));
  requireValue(schemaVersion >= 7 || !object(item) || !Object.hasOwn(item, 'sourceInvestigation'));
  requireValue(schemaVersion >= 6 || !object(item) || !['checkContext','checkSuggestion','checkDismissed'].some(key=>Object.hasOwn(item,key)));
  requireValue(schemaVersion >= 3 || item?.changeSet === undefined);
  requireValue(schemaVersion >= 4 || !object(item) || !Object.hasOwn(item, 'requestRevision'));
  requireValue(schemaVersion >= 5 || !object(item) || !Object.hasOwn(item, 'groupRevision'));
  requireValue(object(item) && token(item.requestId) && item.id === item.requestId && text(item.question, 24000)
    && item.question.trim() && item.question.length <= 6000 && (legacy ? ['ask','change'].includes(item.intent) : INTENTS.has(item.intent))
    && text(item.answer, MAX_ANSWER) && STATES.has(item.state) && timestamp(item.createdAt) && timestamp(item.updatedAt));
  const result = { id: item.requestId, requestId: item.requestId, question: item.question, intent: item.intent === 'change' ? 'build' : item.intent,
    context: contextValue(item.context), answer: item.answer, state: item.state, model: text(item.model, 200) ? item.model : '',
    started: item.started === true, createdAt: item.createdAt, updatedAt: item.updatedAt, verificationHistory: [] };
  if (item.requestRevision !== undefined) result.requestRevision = requestRevisionValue(item.requestRevision);
  if (item.alternativeGeneration !== undefined) {
    requireValue(result.intent==='build'&&['planContext','requestRevision','groupRevision','checkContext','sourceInvestigation','investigationContext','taskContext','decisionContext','issueContext','runtimeEvidence','runtimeEvidenceVersion','proposal','changeSet','plan','review','checkSuggestion','investigationDecision'].every(key=>item[key]===undefined));
    result.alternativeGeneration=validateAlternativeGenerationFiles(item.alternativeGeneration,result.context);
  }
  if (item.alternatives !== undefined) {
    requireValue(result.alternativeGeneration);
    result.alternatives=normalizeAIAlternatives(item.alternatives,projectId,result.context);
    requireValue(JSON.stringify(result.alternatives.generation)===JSON.stringify(result.alternativeGeneration)&&result.alternatives.candidates.every(candidate=>candidate.changeSet.requestId===item.requestId));
  }
  if (item.groupRevision !== undefined) {
    result.groupRevision = groupRevisionDescriptor(item.groupRevision);
    requireValue(result.intent === 'build' && !result.requestRevision && item.planContext === undefined);
  }
  if(item.checkContext!==undefined){result.checkContext=normalizeCheckContext(item.checkContext);requireValue(result.intent==='plan'&&!result.requestRevision&&!result.groupRevision&&item.planContext===undefined&&item.taskContext===undefined&&item.decisionContext===undefined&&item.issueContext===undefined&&item.runtimeEvidence===undefined&&item.runtimeEvidenceVersion===undefined);}
  if (item.sourceInvestigation !== undefined) {
    requireValue(result.intent === 'ask' && ['requestRevision','groupRevision','checkContext','planContext','taskContext','decisionContext','issueContext','runtimeEvidence','runtimeEvidenceVersion','proposal','changeSet','plan','review','checkSuggestion','investigationContext','investigationDecision','investigationAttempts'].every(key=>item[key]===undefined));
    result.sourceInvestigation = validateSourceInvestigation(item.sourceInvestigation,projectId,result.context);
  }
  if (item.investigationContext !== undefined) {
    requireValue(result.intent === 'plan' && ['requestRevision','groupRevision','checkContext','planContext','taskContext','decisionContext','issueContext','runtimeEvidence','runtimeEvidenceVersion','sourceInvestigation','proposal','changeSet','plan','review','checkSuggestion'].every(key=>item[key]===undefined));
    result.investigationContext = validateInvestigationContext(item.investigationContext,projectId,result.context);
  }
  if (item.investigationEnded !== undefined) {
    requireValue(result.sourceInvestigation && result.state==='complete' && exactKeys(item.investigationEnded,['at']) && timestamp(item.investigationEnded.at));
    result.investigationEnded = {at:item.investigationEnded.at};
  }
  if (item.providerKind !== undefined) result.providerKind = providerKindValue(item.providerKind);
  if (item.taskContext !== undefined) result.taskContext = taskContextValue(item.taskContext);
  if (item.issueContext !== undefined) {
    requireValue(['planContext','requestRevision','groupRevision','checkContext','sourceInvestigation','investigationContext'].every(key => item[key] === undefined));
    result.issueContext = normalizeReproducibleIssueContext(item.issueContext, {projectId});
  }
  if (item.decisionContext !== undefined) {
    requireValue(['planContext','requestRevision','groupRevision','checkContext','sourceInvestigation','investigationContext'].every(key => item[key] === undefined));
    result.decisionContext = normalizeProjectDecisionContext(item.decisionContext, {projectId});
  }
  if (!legacy && item.planContext !== undefined) {
    requireValue(result.intent === 'build'); result.planContext = normalizePlanContext(item.planContext,result.context);
  }
  if (item.runtimeEvidence !== undefined || item.runtimeEvidenceVersion !== undefined) {
    requireValue(item.runtimeEvidenceVersion === 1);
    result.runtimeEvidenceVersion = 1; result.runtimeEvidence = runtimeEvidenceValue(item.runtimeEvidence);
  }
  const usage = usageValue(item.usage); if (usage) result.usage = usage;
  if (item.completedWhileStopping === true) result.completedWhileStopping = true;
  if (item.state === 'interrupted') result.error = INTERRUPTED;
  else if (item.state === 'failed') result.error = [CAPACITY, STORAGE_FAILED].includes(item.error) ? item.error : FAILED;
  if (item.proposal !== undefined) {
    requireValue(!result.groupRevision && !result.checkContext && !result.alternativeGeneration);
    result.proposal = proposalValue(item.proposal, projectId);
    requireValue(result.proposal.requestId === item.requestId);
  }
  if (item.changeSet !== undefined) {
    result.changeSet = validateChangeSet(item.changeSet,projectId);
    requireValue(result.changeSet.requestId === item.requestId && changeSetMatches(result.changeSet,result) && !item.plan && !item.review);
  }
  if (item.verificationHistory !== undefined) {
    requireValue(Array.isArray(item.verificationHistory) && item.verificationHistory.length <= 32);
    requireValue(!result.changeSet || item.verificationHistory.length === 0);
    result.verificationHistory = item.verificationHistory.map(entry => verificationValue(entry, result.proposal?.id));
  }
  if (!legacy && item.plan !== undefined) {
    requireValue(result.intent === 'plan' && !result.proposal && !result.checkContext); result.plan = validatePlanArtifact(item.plan,result.context,projectId);
    result.planRevisions = planRevisionsValue(item.planRevisions,result.plan);
    requireValue(result.state === 'complete' || result.planRevisions.length === 1);
  } else requireValue(legacy || item.planRevisions === undefined);
  if (!legacy && item.review !== undefined) {
    requireValue(result.intent === 'review' && !result.proposal && !result.checkContext); result.review = validateReviewArtifact(item.review,result.context,projectId);
  }
  if(item.checkSuggestion!==undefined){requireValue(result.checkContext&&!result.plan&&!result.review&&!result.proposal&&!result.changeSet);result.checkSuggestion=validateCheckSuggestion(item.checkSuggestion,result.checkContext,projectId);}
  if(Object.hasOwn(item,'checkDismissed')){requireValue(item.checkDismissed===true&&result.checkSuggestion&&result.state==='complete'&&!result.completedWhileStopping);result.checkDismissed=true;}
  if(item.investigationDecision!==undefined){requireValue(result.investigationContext);result.investigationDecision=validateInvestigationDecision(item.investigationDecision,result.investigationContext,projectId);}
  if(item.investigationAttempts!==undefined)result.investigationAttempts=investigationAttemptsValue(item.investigationAttempts,result,projectId);
  if(result.checkContext || result.sourceInvestigation || result.investigationContext || result.alternativeGeneration)requireValue(result.verificationHistory.length===0);
  if (result.state === 'complete' && result.intent === 'plan') requireValue(result.investigationContext?result.investigationDecision:result.checkContext?result.checkSuggestion:result.plan);
  if (result.state === 'complete' && result.intent === 'review') requireValue(result.review);
  if (result.groupRevision && result.state === 'complete') requireValue(result.changeSet);
  if (result.alternativeGeneration && result.state === 'complete') requireValue(result.alternatives);
  return result;
}
function dataValue(value, projectId) {
  requireValue(object(value) && [1,2,3,4,5,6,7,8,9,10,11].includes(value.schemaVersion) && value.projectId === projectId
    && Number.isSafeInteger(value.revision) && value.revision >= 0 && Array.isArray(value.conversations) && value.conversations.length <= 20 && bytes(value) <= MAX_BYTES);
  const conversationIds = new Set(), requestIds = new Set(), artifactIds = new Set();
  const conversations = value.conversations.map(item => {
    requireValue(object(item) && token(item.id) && !conversationIds.has(item.id) && text(item.title, 320)
      && timestamp(item.createdAt) && timestamp(item.updatedAt) && typeof item.archived === 'boolean'
      && Array.isArray(item.turns) && item.turns.length <= 40);
    conversationIds.add(item.id);
    const turns = item.turns.map(turn => {
      const result = turnValue(turn, projectId, value.schemaVersion);
      for(const artifactId of turnArtifactIds(result)) {requireValue(!artifactIds.has(artifactId));artifactIds.add(artifactId);}
      requireValue(!requestIds.has(result.requestId)); requestIds.add(result.requestId); return result;
    });
    const earlier = new Map();
    for (const turn of turns) {
      if (turn.requestRevision) {
        requireValue(turn.requestRevision.conversationId === item.id && requestRevisionMatches(earlier.get(turn.requestRevision.requestId), turn));
      }
      if (turn.groupRevision) {
        requireValue(turn.groupRevision.conversationId === item.id && groupRevisionMatches(turn.groupRevision, earlier.get(turn.groupRevision.requestId), turn));
      }
      if(turn.checkContext)requireValue(turn.checkContext.conversationId===item.id&&checkContextMatches(turn.checkContext,earlier.get(turn.checkContext.requestId),turn));
      if (turn.investigationContext) {
        const prefix={...item,archived:false,turns:[...earlier.values()].map(previous=>{const entry=copy(previous);delete entry.investigationEnded;return entry;})};
        const expected=deriveInvestigationContext(prefix,turn.investigationContext.parentRequestId);
        requireValue(JSON.stringify(expected)===JSON.stringify(turn.investigationContext));
      }
      earlier.set(turn.requestId, turn);
    }
    const attemptIds=new Set();
    for(const turn of turns){for(const attempt of turn.investigationAttempts||[]){requireValue(!attemptIds.has(attempt.id));attemptIds.add(attempt.id);}
      if(turn.sourceInvestigation&&(turn.investigationEnded||turns.some(child=>child.investigationContext?.rootRequestId===turn.requestId))){const chain=deriveInvestigationChain({...item,turns},turn.requestId);requireValue(chain.modelUsed<=3&&chain.toolUsed<=2);
        if(turn.investigationEnded)requireValue(!turns.some(child=>child.investigationContext?.rootRequestId===turn.requestId&&(LIVE.has(child.state)||(child.investigationAttempts||[]).some(attempt=>attempt.status==='running'))));}}
    return { id: item.id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, archived: item.archived, turns };
  });
  requireValue(value.activeId === null || conversationIds.has(value.activeId));
  for (const conversation of conversations) for (const turn of conversation.turns) if (turn.proposal)
    requireValue(proposalBasisMatches(turn.proposal,turn,conversations));
  return { schemaVersion: 11, projectId, revision: value.revision, activeId: value.activeId, conversations };
}

/** Project-local durable records. No credential, provider destination or executable payload is accepted. */
export function createConversationStore({ projectId, read, write, onChange = () => {} }) {
  if (!token(projectId)) throw failure('invalid-project', 'A stable local project identity is required.');
  let data = { schemaVersion: 11, projectId, revision: 0, activeId: null, conversations: [] };
  let storage = { status: 'saved' };
  let persistedRevision = 0, writing = null, timer = null, disposed = false;
  let recovered = false, presentationEpoch = 0, presentationVersions = Object.freeze({});
  function load() {
    const previous = read();
    const loaded = previous === undefined || previous === null
      ? { schemaVersion: 11, projectId, revision: 0, activeId: null, conversations: [] }
      : dataValue(previous, projectId);
    const loadedRevision = loaded.revision;
    let interrupted = false;
    for (const conversation of loaded.conversations) for (const turn of conversation.turns) {
      for(const attempt of turn.investigationAttempts||[]) if(attempt.status==='running'){
        attempt.status='interrupted';attempt.finishedAt=new Date().toISOString();attempt.reason='Foundation closed before this local investigation finished. No analysis was resumed.';turn.updatedAt=attempt.finishedAt;conversation.updatedAt=attempt.finishedAt;interrupted=true;
      }
      if (LIVE.has(turn.state)) {
        turn.state = 'interrupted'; turn.error = INTERRUPTED; turn.updatedAt = new Date().toISOString();
        conversation.updatedAt = turn.updatedAt; interrupted = true;
      }
    }
    if (interrupted) loaded.revision++;
    data = loaded; persistedRevision = loadedRevision; recovered = interrupted;
    presentationEpoch++; presentationVersions = Object.freeze(Object.fromEntries(data.conversations.flatMap(chat => chat.turns.map(turn => [turn.requestId, data.revision]))));
    storage = { status: interrupted ? 'saving' : 'saved' };
  }
  try { load(); } catch { storage = { status: 'unavailable', message: UNAVAILABLE }; }
  const notify = () => { try { onChange(); } catch { /* A renderer callback cannot invalidate durable history. */ } };
  const available = () => {
    if (storage.status === 'unavailable') throw failure('history-unavailable', UNAVAILABLE);
    if (disposed) throw failure('history-closed', 'This conversation store has closed.');
  };
  const canStart = () => {
    available();
    if (storage.status === 'error') throw failure('history-storage', STORAGE_FAILED);
    if (data.conversations.some(chat => chat.turns.some(turn => LIVE.has(turn.state)||(turn.investigationAttempts||[]).some(attempt=>attempt.status==='running'))))
      throw failure('request-active', 'Stop the current response before switching conversations or starting another.');
  };
  const cancelTimer = () => { if (timer) clearTimeout(timer); timer = null; };
  function schedule() {
    if (timer || storage.status === 'error' || storage.status === 'unavailable' || disposed) return;
    timer = setTimeout(() => { timer = null; void flush().catch(() => {}); }, 200);
    timer.unref?.();
  }
  function mutate(next, limit = MUTATION_BYTES, changedRequests) {
    next.revision = data.revision + 1;
    if (bytes(next) > limit) throw failure('history-capacity', 'Local conversation history is full. Existing conversations have been preserved.');
    const changed = changedRequests && new Set(changedRequests);
    presentationVersions = Object.freeze(Object.fromEntries(next.conversations.flatMap(chat => chat.turns.map(turn => [turn.requestId,
      changed && !changed.has(turn.requestId) && Object.hasOwn(presentationVersions, turn.requestId) ? presentationVersions[turn.requestId] : next.revision]))));
    data = next;
    if (storage.status !== 'error') storage = { status: 'saving' };
    notify(); schedule();
  }
  async function flush() {
    available(); cancelTimer();
    while (persistedRevision < data.revision) {
      if (writing) { await writing; continue; }
      const snapshot = copy(data), revision = snapshot.revision;
      storage = { status: 'saving' }; notify();
      const pending = (async () => {
        try { await write(snapshot); persistedRevision = revision; }
        catch { storage = { status: 'error', message: STORAGE_FAILED }; notify(); throw failure('history-storage', STORAGE_FAILED); }
      })();
      writing = pending;
      try { await pending; } finally { if (writing === pending) writing = null; }
    }
    if (storage.status !== 'unavailable') { storage = { status: 'saved' }; notify(); }
  }
  const locate = (state, requestId) => {
    for (const conversation of state.conversations) {
      const turn = conversation.turns.find(item => item.requestId === requestId);
      if (turn) return { conversation, turn };
    }
    return null;
  };
  // Stream events can only change their owning turn. Keep immutable completed
  // records shared instead of cloning every retained source and answer.
  function copyRequest(requestId) {
    const owner = locate(data, requestId);
    return { ...data, conversations: data.conversations.map(chat => chat === owner.conversation
      ? { ...chat, turns: chat.turns.map(turn => turn === owner.turn ? copy(turn) : turn) } : chat) };
  }
  function createConversation(state) {
    if (state.conversations.length >= 20) throw failure('history-capacity', 'This project has reached its 20-conversation limit. Existing history is preserved.');
    const now = new Date().toISOString();
    const conversation = { id: randomUUID(), title: 'New conversation', createdAt: now, updatedAt: now, archived: false, turns: [] };
    state.conversations.push(conversation); state.activeId = conversation.id; return conversation;
  }
  const api = {
    snapshot() { return { ...copy(data), storage: { ...storage } }; },
    presentation() { return { snapshot: { ...freezePresentation(data), storage: { ...storage } }, epoch: presentationEpoch, versions: presentationVersions }; },
    async newConversation() {
      canStart(); const next = copy(data); const conversation = createConversation(next); mutate(next); await flush(); return copy(conversation);
    },
    async select(id) {
      canStart();
      if (!data.conversations.some(item => item.id === id)) throw failure('unknown-conversation', 'This conversation is not available in the current project.');
      if (data.activeId !== id) { const next = copy(data); next.activeId = id; mutate(next); }
      await flush(); return api.snapshot();
    },
    async archive(id, archived = true) {
      canStart();
      if (typeof archived !== 'boolean') throw failure('invalid-conversation', 'Choose whether to archive or restore this conversation.');
      const next = copy(data), conversation = next.conversations.find(item => item.id === id);
      if (!conversation) throw failure('unknown-conversation', 'This conversation is not available in the current project.');
      conversation.archived = archived; conversation.updatedAt = new Date().toISOString();
      if (archived && next.activeId === id) next.activeId = [...next.conversations].reverse().find(item => !item.archived)?.id ?? null;
      mutate(next); await flush(); return api.snapshot();
    },
    async startTurn(input) {
      canStart();
      if (!object(input) || !token(input.requestId) || locate(data, input.requestId))
        throw failure('duplicate-request', 'Each request needs a new identity; a saved request is never sent again.');
      if (!text(input.prompt, 24000) || !input.prompt.trim() || input.prompt.length > 6000 || !INTENTS.has(input.intent ?? 'ask'))
        throw failure('invalid-question', 'Enter a question of up to 6,000 characters.');
      let context;
      try { context = contextValue(input.context); }
      catch { throw failure('invalid-context', 'Select up to eight saved source snapshots totalling at most 64 KiB.'); }
      let alternativeGeneration;
      try {
        if(input.alternativeGeneration!==undefined){
          requireValue(input.intent==='build'&&['planContext','requestRevision','groupRevision','checkContext','sourceInvestigation','investigationContext','investigationContinuation','taskContext','decisionContext','issueContext','runtimeEvidence','runtimeEvidenceVersion'].every(key=>input[key]===undefined));
          alternativeGeneration=validateAlternativeGenerationFiles(input.alternativeGeneration,context);
        }
      } catch {throw failure('invalid-alternative-generation','Generate alternatives from one saved scenario and two to eight selected application sources, without another context handoff.');}
      let runtimeEvidence, providerKind;
      try {
        if (input.runtimeEvidenceVersion !== undefined) requireValue(input.runtimeEvidenceVersion === 1);
        if (input.runtimeEvidence !== undefined || input.runtimeEvidenceVersion !== undefined) runtimeEvidence = runtimeEvidenceValue(input.runtimeEvidence);
        if (input.providerKind !== undefined) providerKind = providerKindValue(input.providerKind);
      } catch { throw failure('invalid-runtime-context', 'The provider or runtime evidence could not be saved safely. Review the request context.'); }
      let taskContext;
      try { if (input.taskContext !== undefined) taskContext = taskContextValue(input.taskContext); }
      catch { throw failure('invalid-task-context', 'The selected task context could not be saved safely. Review its title and brief.'); }
      let issueContext;
      try {
        if (input.issueContext !== undefined) {
          requireValue(['planContext','requestRevision','groupRevision','checkContext','sourceInvestigation','investigationContext','investigationContinuation'].every(key => input[key] === undefined));
          issueContext = normalizeReproducibleIssueContext(input.issueContext, {projectId});
        }
      } catch { throw failure('invalid-issue-context', 'The selected issue could not be saved safely. Review its disclosed record and assessment before sending an ordinary request.'); }
      let decisionContext;
      try {
        if (input.decisionContext !== undefined) {
          requireValue(['planContext','requestRevision','groupRevision','checkContext','sourceInvestigation','investigationContext'].every(key => input[key] === undefined));
          decisionContext = normalizeProjectDecisionContext(input.decisionContext, {projectId});
        }
      } catch { throw failure('invalid-decision-context', 'Selected project decisions could not be saved safely. Review their disclosed context before sending an ordinary request.'); }
      let planContext;
      try {
        if (input.planContext !== undefined) {
          requireValue(input.intent === 'build');
          planContext = normalizePlanContext(input.planContext,context);
          const source = locate(data,planContext.requestId), plan = source?.turn.plan, revision = source?.turn.planRevisions?.at(-1);
          requireValue(source && source.conversation.id === data.activeId && source.conversation.id === planContext.conversationId &&
            !source.conversation.archived && source.turn.state === 'complete' && !source.turn.completedWhileStopping && plan?.id === planContext.artifactId && revision?.revision === planContext.revision);
          const step = revision.steps.find(item => item.id === planContext.stepId), original = plan.steps.find(item => item.id === planContext.stepId);
          requireValue(step?.included && original);
          const expected = {version:1,conversationId:source.conversation.id,requestId:source.turn.requestId,artifactId:plan.id,
            revision:revision.revision,stepId:step.id,title:revision.title,summary:revision.summary,
            step:{title:step.title,detail:step.detail,references:original.references},verification:revision.verification};
          requireValue(JSON.stringify(planContext) === JSON.stringify(expected));
        }
      } catch { throw failure('invalid-plan-context', 'The selected plan step changed or is unavailable. Review its saved revision before building.'); }
      let requestRevision;
      try {
        if (input.requestRevision !== undefined) {
          requestRevision = requestRevisionValue(input.requestRevision);
          const source = locate(data,requestRevision.requestId);
          requireValue(source && source.conversation.id === data.activeId && source.conversation.id === requestRevision.conversationId &&
            !source.conversation.archived && requestRevisionMatches(source.turn,{intent:input.intent ?? 'ask',context,planContext,groupRevision:input.groupRevision,checkContext:input.checkContext}));
        }
      } catch { throw failure('invalid-request-revision', 'Choose an earlier finished request in the active conversation with the same mode and exact saved source. Plan-step requests cannot be revised.'); }
      let groupRevision;
      try {
        if (input.groupRevision !== undefined) {
          groupRevision = groupRevisionDescriptor(input.groupRevision);
          const source = locate(data,groupRevision.requestId);
          requireValue(source && source.conversation.id === data.activeId && source.conversation.id === groupRevision.conversationId &&
            !source.conversation.archived && source.turn.changeSet?.status === 'proposed' && groupRevision.groupRevision === source.turn.changeSet.revision &&
            groupRevisionMatches(groupRevision,source.turn,{intent:input.intent ?? 'ask',context,planContext,requestRevision,checkContext:input.checkContext}));
        }
      } catch { throw failure('invalid-group-revision', 'Choose a completed staged group in the active conversation with its exact original saved source before refining.'); }
      let checkContext;
      try {
        if(input.checkContext!==undefined){
          checkContext=normalizeCheckContext(input.checkContext);const source=locate(data,checkContext.requestId);
          requireValue(source&&source.conversation.id===data.activeId&&source.conversation.id===checkContext.conversationId&&!source.conversation.archived&&
            source.turn.changeSet?.status==='proposed'&&source.turn.changeSet.revision===checkContext.groupRevision&&
            checkContextMatches(checkContext,source.turn,{intent:input.intent??'ask',context,planContext,requestRevision,groupRevision,taskContext,decisionContext,issueContext,runtimeEvidence,runtimeEvidenceVersion:input.runtimeEvidenceVersion}));
        }
      }catch{throw failure('invalid-check-context','Choose a completed staged group in the active conversation with its original source and advertised checks.');}
      let sourceInvestigation;
      try {
        if (input.sourceInvestigation !== undefined) {
          requireValue((input.intent ?? 'ask') === 'ask' && ['requestRevision','groupRevision','checkContext','planContext','taskContext','decisionContext','issueContext','runtimeEvidence','runtimeEvidenceVersion'].every(key=>input[key]===undefined));
          sourceInvestigation = validateSourceInvestigation(input.sourceInvestigation,projectId,context);
        }
      } catch { throw failure('invalid-source-investigation','Refresh and review the saved-source investigation in its owning feature before sending.'); }
      let investigationContext;
      try {
        if(input.investigationContext!==undefined){
          requireValue(input.intent==='plan'&&['requestRevision','groupRevision','checkContext','planContext','taskContext','decisionContext','issueContext','runtimeEvidence','runtimeEvidenceVersion','sourceInvestigation'].every(key=>input[key]===undefined));
          investigationContext=validateInvestigationContext(input.investigationContext,projectId,context);
          const conversation=data.conversations.find(chat=>chat.id===data.activeId);
          requireValue(conversation&&!conversation.archived&&investigationContext.conversationId===conversation.id&&JSON.stringify(deriveInvestigationContext(conversation,investigationContext.parentRequestId))===JSON.stringify(investigationContext));
        }
      }catch{throw failure('investigation-continuation-unavailable','Review the latest saved investigation checkpoint and its exact selected source before continuing.');}
      if (input.conversationId !== undefined && input.conversationId !== data.activeId)
        throw failure('conversation-changed', 'The active conversation changed. Review the context and try again.');
      const next = copy(data);
      const conversation = next.conversations.find(item => item.id === next.activeId) || createConversation(next);
      if (conversation.archived) throw failure('conversation-archived', 'Restore this archived conversation before adding a request.');
      if (conversation.turns.length >= 40) throw failure('history-capacity', 'This conversation has reached 40 requests. Start a new conversation; existing requests are preserved.');
      const now = new Date().toISOString();
      const turn = { id: input.requestId, requestId: input.requestId, question: input.prompt.trim(), intent: input.intent || 'ask', context,
        answer: '', state: 'running', model: text(input.model, 200) ? input.model : '', started: false,
        createdAt: now, updatedAt: now, verificationHistory: [] };
      if (providerKind !== undefined) turn.providerKind = providerKind;
      if (alternativeGeneration !== undefined) turn.alternativeGeneration = alternativeGeneration;
      if (taskContext !== undefined) turn.taskContext = taskContext;
      if (decisionContext !== undefined) turn.decisionContext = decisionContext;
      if (issueContext !== undefined) turn.issueContext = issueContext;
      if (planContext !== undefined) turn.planContext = planContext;
      if (requestRevision !== undefined) turn.requestRevision = requestRevision;
      if (groupRevision !== undefined) turn.groupRevision = groupRevision;
      if (checkContext !== undefined) turn.checkContext = checkContext;
      if (sourceInvestigation !== undefined) turn.sourceInvestigation = sourceInvestigation;
      if (investigationContext !== undefined) turn.investigationContext = investigationContext;
      if (runtimeEvidence !== undefined) { turn.runtimeEvidenceVersion = 1; turn.runtimeEvidence = runtimeEvidence; }
      conversation.turns.push(turn); conversation.updatedAt = now;
      if (conversation.turns.length === 1) conversation.title = turn.question.replace(/\s+/g, ' ').slice(0, 80);
      mutate(next);
      try { await flush(); }
      catch (error) {
        const failed = copy(data), owner = locate(failed, turn.requestId);
        if (owner && LIVE.has(owner.turn.state)) {
          owner.turn.state = 'failed'; owner.turn.error = STORAGE_FAILED; owner.turn.updatedAt = new Date().toISOString();
          mutate(failed, MAX_BYTES);
        }
        throw error;
      }
      return copy(locate(data, turn.requestId).turn);
    },
    event(requestId, event) {
      if (disposed || storage.status === 'unavailable' || !object(event)) return null;
      const original = locate(data, requestId);
      if (!original || !LIVE.has(original.turn.state)) return null;
      const next = copyRequest(requestId), { conversation, turn } = locate(next, requestId);
      if (turn.state === 'stopping' && !['cancelled', 'done', 'error'].includes(event.type)) return null;
      let changed = true;
      try {
        if (event.type === 'start') { requireValue(event.intent === undefined || event.intent === turn.intent); turn.started = true; if (text(event.model, 200)) turn.model = event.model; }
        else if (event.type === 'delta' && typeof event.text === 'string') {
          if (!text(turn.answer + event.text, MAX_ANSWER)) throw failure('history-capacity', CAPACITY);
          turn.answer += event.text;
        } else if (event.type === 'stopping') turn.state = 'stopping';
        else if (event.type === 'cancelled') turn.state = 'stopped';
        else if (event.type === 'done') {
          requireValue(turn.intent === 'ask' || turn.intent === 'plan' && (turn.investigationContext?turn.investigationDecision:turn.checkContext?turn.checkSuggestion:turn.plan) || turn.intent === 'review' && turn.review || turn.intent === 'build' && (turn.alternativeGeneration ? !!turn.alternatives : (!!turn.proposal !== !!turn.changeSet)));
          turn.completedWhileStopping = turn.state === 'stopping'; turn.state = 'complete';
          if (text(event.model, 200)) turn.model = event.model;
          const usage = usageValue(event.usage); if (usage) turn.usage = usage;
        } else if (event.type === 'error') { turn.state = 'failed'; turn.error = FAILED; }
        else if (event.type === 'proposal') {
          requireValue(turn.intent === 'build' && !turn.changeSet && !turn.groupRevision && !turn.alternativeGeneration);
          const proposal = proposalValue({ ...event.proposal, requestId }, projectId);
          requireValue(turn.context.some(source => source.path === proposal.path && source.revision === proposal.baseRevision && source.source === proposal.before));
          requireValue(proposal.context.every(source => turn.context.some(item => item.path === source.path && item.revision === source.revision)));
          requireValue(proposalBasisMatches(proposal,turn,next.conversations));
          if (turn.proposal) requireValue(turn.proposal.id === proposal.id && turn.proposal.path === proposal.path && turn.proposal.baseRevision === proposal.baseRevision && turn.proposal.before === proposal.before && turn.proposal.after === proposal.after && JSON.stringify(turn.proposal.planBasis) === JSON.stringify(proposal.planBasis));
          else turn.proposal = proposal;
        } else if (event.type === 'alternatives') {
          requireValue(turn.intent==='build'&&turn.alternativeGeneration&&!turn.changeSet&&!turn.proposal);
          requireValue(Array.isArray(event.alternatives?.candidates)&&event.alternatives.candidates.every(candidate=>candidate.changeSet?.requestId===undefined||candidate.changeSet.requestId===requestId));
          const input={...event.alternatives,candidates:event.alternatives.candidates.map(candidate=>({...candidate,changeSet:{...candidate.changeSet,requestId}}))};
          const artifact=normalizeAIAlternatives(input,projectId,turn.context);
          requireValue(JSON.stringify(artifact.generation)===JSON.stringify(turn.alternativeGeneration));
          if(turn.alternatives)requireValue(aiAlternativesDigest(turn.alternatives)===aiAlternativesDigest(artifact));
          else {requireValue(turnArtifactIds({alternatives:artifact}).every(id=>!hasArtifactIdentity(next,id)));turn.alternatives=artifact;}
        } else if (event.type === 'changeSet') {
          requireValue(event.changeSet?.requestId === undefined || event.changeSet.requestId === requestId);
          const changeSet = validateChangeSet({...event.changeSet,requestId},projectId);
          requireValue(changeSetMatches(changeSet,turn));
          if (turn.changeSet) requireValue(JSON.stringify(turn.changeSet) === JSON.stringify(changeSet));
          else {
            requireValue(changeSet.status === 'proposed' && changeSet.revision === 0 && changeSet.files.every(file => file.appliedRevision === undefined));
            requireValue(!hasArtifactIdentity(next,changeSet.id));
            turn.changeSet = changeSet;
          }
        } else if(event.type==='checkSuggestion'){
          requireValue(turn.intent==='plan'&&turn.checkContext&&!turn.plan&&!turn.review&&!turn.proposal&&!turn.changeSet);
          const artifact=validateCheckSuggestion(event.checkSuggestion,turn.checkContext,projectId);
          if(turn.checkSuggestion)requireValue(JSON.stringify(turn.checkSuggestion)===JSON.stringify(artifact));
          else {requireValue(!hasArtifactIdentity(next,artifact.id));turn.checkSuggestion=artifact;}
        } else if(event.type==='investigationDecision'){
          requireValue(turn.intent==='plan'&&turn.investigationContext&&!turn.plan&&!turn.review&&!turn.proposal&&!turn.changeSet&&!turn.checkSuggestion);
          const artifact=validateInvestigationDecision(event.investigationDecision,turn.investigationContext,projectId);
          if(turn.investigationDecision)requireValue(JSON.stringify(turn.investigationDecision)===JSON.stringify(artifact));
          else{requireValue(!hasArtifactIdentity(next,artifact.id));turn.investigationDecision=artifact;}
        } else if (event.type === 'plan' || event.type === 'review') {
          requireValue(turn.intent === event.type && !turn.plan && !turn.review && !turn.checkContext && !turn.investigationContext);
          const artifact = event.type === 'plan' ? validatePlanArtifact(event.plan,turn.context,projectId) : validateReviewArtifact(event.review,turn.context,projectId);
          requireValue(!hasArtifactIdentity(next,artifact.id));
          turn[event.type] = artifact;
          if (event.type === 'plan') turn.planRevisions = [{revision:0,createdAt:new Date().toISOString(),...originalPlanContent(artifact)}];
        } else changed = false;
        if (!changed) return null;
        turn.updatedAt = new Date().toISOString(); conversation.updatedAt = turn.updatedAt;
        mutate(next, MUTATION_BYTES, [requestId]);
      } catch (error) {
        const failed = copyRequest(requestId), owner = locate(failed, requestId);
        owner.turn.state = 'failed'; owner.turn.error = error?.code === 'history-capacity' ? CAPACITY : FAILED;
        owner.turn.updatedAt = new Date().toISOString(); owner.conversation.updatedAt = owner.turn.updatedAt;
        mutate(failed, MAX_BYTES, [requestId]);
      }
      return copy(locate(data, requestId).turn);
    },
    async startInvestigationAttempt(input={}) {
      canStart();await flush();canStart();
      requireValue(exactKeys(input,['conversationId','requestId','decisionId','attemptId'])&&token(input.attemptId));
      const owner=locate(data,input.requestId),conversation=owner?.conversation,turn=owner?.turn;
      requireValue(conversation&&conversation.id===input.conversationId&&data.activeId===conversation.id&&!conversation.archived&&turn.investigationContext&&turn.investigationDecision?.id===input.decisionId);
      const chain=deriveInvestigationChain(conversation,turn.investigationContext.rootRequestId);
      requireValue(chain.latestRequestId===turn.requestId&&(chain.canRun||chain.canRetryTool)&&!data.conversations.some(chat=>chat.turns.some(item=>(item.investigationAttempts||[]).some(attempt=>attempt.id===input.attemptId))));
      const next=copy(data),target=locate(next,input.requestId),now=new Date().toISOString();
      (target.turn.investigationAttempts ||= []).push({id:input.attemptId,status:'running',startedAt:now});target.turn.updatedAt=now;target.conversation.updatedAt=now;mutate(next);
      try{await flush();}catch(error){const failed=copy(data),entry=locate(failed,input.requestId)?.turn.investigationAttempts?.find(attempt=>attempt.id===input.attemptId);if(entry?.status==='running'){entry.status='failed';entry.finishedAt=new Date().toISOString();entry.reason='The local attempt could not be saved. No analysis was started.';mutate(failed,MAX_BYTES);}throw error;}
      return api.snapshot();
    },
    async finishInvestigationAttempt(input={}) {
      available();requireValue(exactKeys(input,['conversationId','requestId','attemptId','status'],['result','reason'])&&['complete','failed','stopped'].includes(input.status));
      const owner=locate(data,input.requestId),turn=owner?.turn;
      requireValue(owner?.conversation.id===input.conversationId&&turn.investigationContext&&turn.state==='complete'&&!turn.completedWhileStopping);
      const root=owner.conversation.turns.find(item=>item.requestId===turn.investigationContext.rootRequestId),latest=owner.conversation.turns.filter(item=>item.investigationContext?.rootRequestId===root?.requestId).at(-1);
      requireValue(root&&!root.investigationEnded&&latest===turn);
      const next=copy(data),target=locate(next,input.requestId),attempt=target.turn.investigationAttempts?.find(item=>item.id===input.attemptId);requireValue(attempt?.status==='running'&&attempt===target.turn.investigationAttempts.at(-1));
      attempt.status=input.status;attempt.finishedAt=new Date().toISOString();
      if(input.status==='complete'){requireValue(input.result!==undefined&&data.activeId===owner.conversation.id&&!owner.conversation.archived);attempt.result=validateSourceInvestigation(input.result,projectId);}
      else{requireValue(input.result===undefined);attempt.reason=input.status==='stopped'?'The local investigation was stopped. No result was shared.':'The local investigation did not finish. No result was shared.';}
      investigationAttemptsValue(target.turn.investigationAttempts,target.turn,projectId);
      target.turn.updatedAt=attempt.finishedAt;target.conversation.updatedAt=attempt.finishedAt;mutate(next);await flush();return api.snapshot();
    },
    async endInvestigationChain(input={}) {
      canStart();await flush();canStart();requireValue(exactKeys(input,['conversationId','rootRequestId','expectedLatestRequestId']));
      const owner=locate(data,input.rootRequestId);requireValue(owner&&owner.conversation.id===input.conversationId&&data.activeId===owner.conversation.id&&!owner.conversation.archived);
      const chain=deriveInvestigationChain(owner.conversation,input.rootRequestId);requireValue(chain.latestRequestId===input.expectedLatestRequestId&&(chain.canEnd||owner.turn.investigationEnded));
      if(!owner.turn.investigationEnded){const next=copy(data),target=locate(next,input.rootRequestId),now=new Date().toISOString();target.turn.investigationEnded={at:now};target.turn.updatedAt=now;target.conversation.updatedAt=now;mutate(next);await flush();}
      return api.snapshot();
    },
    async dismissCheckSuggestion(input = {}) {
      canStart();
      if(!object(input)||!Object.keys(input).every(key=>['conversationId','requestId','artifactId'].includes(key)))throw failure('check-suggestion-unavailable','Choose a completed recommendation in its active conversation.');
      const {conversationId,requestId,artifactId}=input,owner=locate(data,requestId);
      if(!owner||owner.conversation.id!==conversationId||data.activeId!==conversationId||owner.conversation.archived||owner.turn.state!=='complete'||owner.turn.completedWhileStopping||!owner.turn.checkContext||owner.turn.checkSuggestion?.id!==artifactId)
        throw failure('check-suggestion-unavailable','Choose a completed recommendation in its active conversation.');
      if(owner.turn.checkDismissed){await flush();return api.snapshot();}
      const next=copy(data),saved=locate(next,requestId);saved.turn.checkDismissed=true;saved.turn.updatedAt=new Date().toISOString();saved.conversation.updatedAt=saved.turn.updatedAt;mutate(next);await flush();return api.snapshot();
    },
    async revisePlan({conversationId,requestId,expectedRevision,input} = {}) {
      canStart();
      const owner = locate(data,requestId);
      if (!owner || owner.conversation.id !== conversationId || data.activeId !== conversationId || owner.conversation.archived || owner.turn.state !== 'complete' || owner.turn.completedWhileStopping || !owner.turn.plan)
        throw failure('plan-unavailable', 'Choose a completed plan in the active, unarchived conversation.');
      const latest = owner.turn.planRevisions.at(-1);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== latest.revision)
        throw failure('plan-changed', 'This plan has a newer saved revision. Keep your draft and review that version before saving.');
      let content;
      try { content = planContentValue(input,owner.turn.plan); }
      catch { throw failure('invalid-plan-revision', 'Edit the existing plan steps without adding identities or execution states. Keep all text within the displayed limits.'); }
      const {revision:_revision,createdAt:_createdAt,...priorContent} = latest;
      if (JSON.stringify(content) === JSON.stringify(priorContent)) { await flush(); return api.snapshot(); }
      if (owner.turn.planRevisions.length >= MAX_PLAN_REVISIONS)
        throw failure('history-capacity', 'This plan has reached its sixteen-edit history limit. Earlier revisions are preserved.');
      const next = copy(data), saved = locate(next,requestId), now = new Date().toISOString();
      saved.turn.planRevisions.push({revision:latest.revision+1,createdAt:now,...content});
      saved.turn.updatedAt = now; saved.conversation.updatedAt = now;
      mutate(next); await flush(); return api.snapshot();
    },
    async updateProposal(input) {
      available();
      const next = copy(data);
      const owner = next.conversations.flatMap(chat => chat.turns).find(turn => turn.proposal?.id === input?.id || (!turn.proposal && turn.requestId === input?.requestId));
      if (!owner) return null;
      if (owner.intent !== 'build' || owner.changeSet || owner.groupRevision || owner.alternativeGeneration) throw failure('proposal-intent', 'Only a Build request can retain a source proposal.');
      const proposal = proposalValue(input, projectId), prior = owner.proposal;
      if (!proposalBasisMatches(proposal,owner,next.conversations)) throw failure('proposal-basis', 'The source proposal must retain the original plan basis. Prepare it again from its saved plan.');
      if (prior && (proposal.path !== prior.path || proposal.baseRevision !== prior.baseRevision || proposal.before !== prior.before || proposal.after !== prior.after || JSON.stringify(proposal.planBasis) !== JSON.stringify(prior.planBasis)))
        throw failure('proposal-changed', 'A historical proposal cannot be replaced with different source.');
      if (!prior && (!owner.context.some(source => source.path === proposal.path && source.revision === proposal.baseRevision && source.source === proposal.before)
        || !proposal.context.every(source => owner.context.some(item => item.path === source.path && item.revision === source.revision))))
        throw failure('proposal-context', 'The proposal does not match this request’s original source snapshots.');
      proposal.requestId = owner.requestId;
      if (JSON.stringify(proposal) === JSON.stringify(prior)) return copy(prior);
      owner.proposal = proposal; owner.updatedAt = new Date().toISOString();
      mutate(next); await flush(); return copy(proposal);
    },
    async updateChangeSet(input) {
      available();
      if (input === null || input === undefined) return null;
      const next = copy(data), owner = next.conversations.flatMap(chat => chat.turns).find(turn => turn.changeSet?.id === input?.id || (!turn.changeSet && turn.requestId === input?.requestId));
      if (!owner) return null;
      if (input.requestId !== undefined && input.requestId !== owner.requestId)
        throw failure('change-set-context', 'The change set belongs to a different request.');
      const changeSet = validateChangeSet({...input,requestId:owner.requestId},projectId), prior = owner.changeSet;
      if (!changeSetMatches(changeSet,owner))
        throw failure('change-set-context', 'The change set must retain every source snapshot disclosed to its Build request.');
      if (prior && !changeSetUpdateAllowed(prior,changeSet))
        throw failure('change-set-changed', 'A historical change set cannot acquire different content or overwrite a newer revision.');
      if (!prior && hasArtifactIdentity(next,changeSet.id))
        throw failure('change-set-changed', 'This artifact identity already belongs to another request.');
      if (JSON.stringify(prior) === JSON.stringify(changeSet)) { await flush(); return copy(prior); }
      owner.changeSet = changeSet; owner.updatedAt = new Date().toISOString();
      mutate(next); await flush(); return copy(changeSet);
    },
    async recordVerification(proposalId, input) {
      available();
      const next = copy(data), owner = next.conversations.flatMap(chat => chat.turns).find(turn => turn.proposal?.id === proposalId);
      if (!owner || owner.proposal.status !== 'applied') return null;
      const runtimeSession = input?.runtimeSession ?? input?.session;
      if (!object(input) || input.revision !== owner.proposal.appliedRevision || !token(input.revision) || !token(input.previewRevision)
        || !token(runtimeSession) || !['passed', 'failed'].includes(input.compilation)) return null;
      const prior = owner.verificationHistory.find(item => item.runtimeSession === runtimeSession && item.previewRevision === input.previewRevision
        && item.revision === input.revision && item.compilation === input.compilation);
      if (prior) {
        if (!input.observed || prior.observed) return copy(prior);
        prior.observed = true; prior.recordedAt = timestamp(input.recordedAt) ? input.recordedAt : new Date().toISOString();
      } else {
        if (owner.verificationHistory.length >= 32) throw failure('history-capacity', 'This artifact has reached its 32-run verification history limit. Earlier evidence is preserved.');
        owner.verificationHistory.push({ id: randomUUID(), proposalId, revision: input.revision, previewRevision: input.previewRevision, runtimeSession,
          recordedAt: timestamp(input.recordedAt) ? input.recordedAt : new Date().toISOString(), compilation: input.compilation,
          interaction: 'not-run', visual: 'not-run', observed: input.observed === true, historical: true });
      }
      mutate(next); await flush(); return copy(prior || owner.verificationHistory.at(-1));
    },
    flush,
    async retry() {
      if (disposed) throw failure('history-closed', 'This conversation store has closed.');
      if (storage.status === 'unavailable') {
        try { load(); }
        catch { storage = { status: 'unavailable', message: UNAVAILABLE }; notify(); throw failure('history-unavailable', UNAVAILABLE); }
        notify();
      }
      await flush(); return api.snapshot();
    },
    async dispose() { cancelTimer(); try { if (storage.status !== 'unavailable') await flush(); } finally { disposed = true; } },
  };
  if (recovered) schedule();
  return api;
}
