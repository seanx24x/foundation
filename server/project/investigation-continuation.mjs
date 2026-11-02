import {createHash,randomUUID} from 'node:crypto';
import {validateSourceInvestigation,sourceInvestigationForProvider} from './source-investigation.mjs';
const copy=value=>structuredClone(value),object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value),'utf8');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(value,max)=>typeof value==='string'&&!value.includes('\0')&&bytes(value)<=max&&Buffer.from(value,'utf8').toString('utf8')===value;
const token=value=>text(value,200)&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,required,optional=[])=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const integer=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const live=turn=>['running','stopping'].includes(turn?.state);
const failed=turn=>['failed','stopped','interrupted'].includes(turn?.state);
const successful=turn=>turn?.investigationAttempts?.find(attempt=>attempt.status==='complete');
export class InvestigationContinuationError extends Error {constructor(message='This investigation checkpoint changed or is unavailable. Review its saved decision before continuing.'){super(message);this.name='InvestigationContinuationError';this.status=409;this.code='investigation-continuation-unavailable';}}
const check=(condition,message)=>{if(!condition)throw new InvestigationContinuationError(message);};
function targetValue(value,index){check(exact(value,['id','path','revision','evidenceIds'])&&value.id===`T${index+1}`&&text(value.path,1000)&&value.path&&!/^[\/\\]/.test(value.path)&&!value.path.includes('\\')&&value.path.split('/').every(part=>part&&part!=='.'&&part!=='..')&&/^[a-f0-9]{16}$/.test(value.revision)&&Array.isArray(value.evidenceIds)&&value.evidenceIds.length>0&&value.evidenceIds.length<=24&&new Set(value.evidenceIds).size===value.evidenceIds.length&&value.evidenceIds.every(id=>/^I(?:[1-9]|[12]\d|3[0-2])$/.test(id)));return {id:value.id,path:value.path,revision:value.revision,evidenceIds:[...value.evidenceIds]};}
function contextValue(value){
 check(exact(value,['version','conversationId','rootRequestId','parentRequestId','result','goal','previousExplanation','targets','budget','digest'])&&value.version===1&&[value.conversationId,value.rootRequestId,value.parentRequestId].every(token)&&text(value.goal,24000)&&value.goal.trim()&&digest(value.digest));
 const result=validateSourceInvestigation(value.result),previous=value.previousExplanation,budget=value.budget;
 check(exact(previous,['requestId','kind','text'])&&token(previous.requestId)&&['answer','decision'].includes(previous.kind)&&text(previous.text,65536)&&previous.text.trim());
 check(exact(budget,['modelStep','modelLimit','toolsUsed','toolLimit'])&&integer(budget.modelStep,3)&&budget.modelStep>0&&budget.modelLimit===3&&integer(budget.toolsUsed,2)&&budget.toolLimit===2);
 check(Array.isArray(value.targets)&&value.targets.length<=24);const targets=value.targets.map(targetValue);check(new Set(targets.map(item=>item.path)).size===targets.length);check(budget.modelStep<3&&budget.toolsUsed<2||targets.length===0);
 const projection=sourceInvestigationForProvider(result);
 for(const target of targets){check(target.path!==result.anchor.path&&/\.(?:tsx?|jsx?|mjs|cjs)$/i.test(target.path));for(const id of target.evidenceIds){const edge=projection.edges.find(item=>item.id===id);check(edge&&[edge.from,edge.to].some(ref=>ref.path===target.path));}check(result.edges.some(edge=>[edge.from,edge.to].some(ref=>ref.path===target.path&&ref.revision===target.revision)));}
 return {version:1,conversationId:value.conversationId,rootRequestId:value.rootRequestId,parentRequestId:value.parentRequestId,result,goal:value.goal,previousExplanation:{requestId:previous.requestId,kind:previous.kind,text:previous.text},targets,budget:{modelStep:budget.modelStep,modelLimit:3,toolsUsed:budget.toolsUsed,toolLimit:2}};
}
export function validateInvestigationContext(value,projectId,files){const result=contextValue(value);check(value.digest===hash(result)&&bytes(value)<=131072&&(!projectId||result.result.projectId===projectId));if(files!==undefined)validateSourceInvestigation(result.result,projectId,files);return {...result,digest:value.digest};}
export function normalizeInvestigationContextDescriptor(value){if(value===undefined)return undefined;check(exact(value,['version','conversationId','rootRequestId','parentRequestId','digest'])&&value.version===1&&[value.conversationId,value.rootRequestId,value.parentRequestId].every(token)&&digest(value.digest));return {version:1,conversationId:value.conversationId,rootRequestId:value.rootRequestId,parentRequestId:value.parentRequestId,digest:value.digest};}
export function investigationContextDescriptor(value){const v=validateInvestigationContext(value);return {version:1,conversationId:v.conversationId,rootRequestId:v.rootRequestId,parentRequestId:v.parentRequestId,digest:v.digest};}
function chainData(conversation,rootRequestId){
 check(object(conversation)&&token(conversation.id)&&Array.isArray(conversation.turns));const root=conversation.turns.find(turn=>turn.requestId===rootRequestId);check(root?.intent==='ask'&&root.state==='complete'&&!root.completedWhileStopping&&root.sourceInvestigation&&!root.investigationContext);validateSourceInvestigation(root.sourceInvestigation);
 const turns=conversation.turns.filter(turn=>turn.investigationContext?.rootRequestId===rootRequestId);check(turns.length<=3);let prior=root.requestId,position=conversation.turns.indexOf(root),toolUsed=0;
 for(const turn of turns){check(conversation.turns.indexOf(turn)>position&&turn.investigationContext.conversationId===conversation.id&&turn.investigationContext.parentRequestId===prior);position=conversation.turns.indexOf(turn);prior=turn.requestId;check(Array.isArray(turn.investigationAttempts||[])&&(turn.investigationAttempts||[]).length<=2);toolUsed+=(turn.investigationAttempts||[]).length;}
 check(toolUsed<=2);return {root,turns,latest:turns.at(-1)||root,toolUsed};
}
export function deriveInvestigationChain(conversation,rootRequestId){
 const {root,turns,latest,toolUsed}=chainData(conversation,rootRequestId),modelUsed=turns.length,busy=turns.some(turn=>live(turn)||(turn.investigationAttempts||[]).some(attempt=>attempt.status==='running'));
 const finished=latest.state==='complete'&&!latest.completedWhileStopping&&latest.investigationDecision?.decision.kind==='finish',ended=Boolean(root.investigationEnded||finished||modelUsed===3&&!busy);
 const permitted=!conversation.archived&&!ended&&!busy,decision=latest.state==='complete'&&!latest.completedWhileStopping&&latest.investigationDecision?.decision.kind==='investigate';
 const attempts=latest.investigationAttempts||[],last=attempts.at(-1),canRun=permitted&&decision&&!attempts.length&&toolUsed<2,canRetryTool=permitted&&decision&&!!last&&['failed','stopped','interrupted'].includes(last.status)&&toolUsed<2;
 const canContinue=permitted&&modelUsed<3&&(latest===root||failed(latest)||decision&&!!successful(latest));
 const reason=conversation.archived?'Restore this conversation first.':root.investigationEnded?'This investigation was ended.':finished?'The model finished this investigation.':busy?'Wait for or stop the current owned step.':modelUsed>=3?'The three model-decision budget is exhausted.':decision&&!successful(latest)?toolUsed>=2?'The two local-attempt budget is exhausted. End this investigation.':'Run the proposed local investigation before sharing its result.':undefined;
 return {rootRequestId,latestRequestId:latest.requestId,modelUsed,toolUsed,ended,...(reason?{reason}:{}),canContinue:Boolean(canContinue),canRun:Boolean(canRun),canRetryTool:Boolean(canRetryTool),canEnd:!conversation.archived&&!ended&&!busy};
}
function decisionExplanation(value){const {title,summary,decision,limitations}=value;const action=decision.kind==='investigate'?{kind:'investigate',path:decision.target.path,reason:decision.reason}:{kind:'finish',conclusion:decision.conclusion};return JSON.stringify({title,summary,decision:action,limitations});}
export function deriveInvestigationContext(conversation,parentRequestId){
 const parent=conversation?.turns?.find(turn=>turn.requestId===parentRequestId);check(parent);const rootRequestId=parent.investigationContext?.rootRequestId||parent.requestId,{root,turns,latest,toolUsed}=chainData(conversation,rootRequestId),chain=deriveInvestigationChain(conversation,rootRequestId);check(chain.canContinue&&latest===parent,chain.reason||'Continue only the latest checkpoint.');
 const result=parent===root?root.sourceInvestigation:failed(parent)?parent.investigationContext.result:successful(parent)?.result;
 check(result);validateSourceInvestigation(result);check(result.projectId===root.sourceInvestigation.projectId&&result.featureId===root.sourceInvestigation.featureId&&result.featureRevision===root.sourceInvestigation.featureRevision&&result.basisDigest===root.sourceInvestigation.basisDigest);
 const previousExplanation=parent===root?{requestId:root.requestId,kind:'answer',text:root.answer}:failed(parent)?copy(parent.investigationContext.previousExplanation):{requestId:parent.requestId,kind:'decision',text:decisionExplanation(parent.investigationDecision)};
 const visited=new Set([root.sourceInvestigation.anchor.path,...turns.flatMap(turn=>(turn.investigationAttempts||[]).filter(attempt=>attempt.status==='complete').map(attempt=>attempt.result.anchor.path))]),targets=[];
 if(turns.length+1<3&&toolUsed<2){const byPath=new Map();for(const [index,edge] of result.edges.entries())for(const ref of [edge.from,edge.to]){if(visited.has(ref.path)||ref.path===result.anchor.path||!/\.(?:tsx?|jsx?|mjs|cjs)$/i.test(ref.path))continue;let target=byPath.get(ref.path);if(!target){if(byPath.size>=24)continue;target={id:`T${byPath.size+1}`,path:ref.path,revision:ref.revision,evidenceIds:[]};byPath.set(ref.path,target);}check(target.revision===ref.revision);if(!target.evidenceIds.includes(`I${index+1}`))target.evidenceIds.push(`I${index+1}`);}targets.push(...byPath.values());}
 const value={version:1,conversationId:conversation.id,rootRequestId,parentRequestId,result:copy(result),goal:root.question,previousExplanation,targets,budget:{modelStep:turns.length+1,modelLimit:3,toolsUsed:toolUsed,toolLimit:2},digest:'0'.repeat(64)};value.digest=hash(contextValue(value));return validateInvestigationContext(value);
}
export function investigationContextForProvider(value){const v=validateInvestigationContext(value);return {goal:v.goal,previousExplanation:{kind:v.previousExplanation.kind,text:v.previousExplanation.text},sourceInvestigation:sourceInvestigationForProvider(v.result),availableTargets:v.targets.map(({revision:_revision,...target})=>copy(target)),budget:copy(v.budget)};}
function decisionValue(value,context,projectId,canonical){
 const c=validateInvestigationContext(context,projectId);check(exact(value,canonical?['schemaVersion','id','projectId','verificationStatus','title','summary','decision','limitations']:['title','summary','decision','limitations'])&&text(value.title,160)&&value.title.trim()&&text(value.summary,2000)&&value.summary.trim()&&Array.isArray(value.limitations)&&value.limitations.length<=12&&value.limitations.every(item=>text(item,500)&&item.trim()));
 if(canonical)check(value.schemaVersion===1&&uuid(value.id)&&value.projectId===projectId&&value.verificationStatus==='not-run');
 let decision;
 if(value.decision?.kind==='investigate'){
  check(exact(value.decision,canonical?['kind','target','reason']:['kind','targetId','reason'])&&text(value.decision.reason,2000)&&value.decision.reason.trim());const target=c.targets.find(item=>item.id===(canonical?value.decision.target?.id:value.decision.targetId));check(target&&(!canonical||JSON.stringify(target)===JSON.stringify(value.decision.target)));decision={kind:'investigate',target:copy(target),reason:value.decision.reason};
 }else{check(exact(value.decision,['kind','conclusion'])&&value.decision.kind==='finish'&&text(value.decision.conclusion,4000)&&value.decision.conclusion.trim());decision={kind:'finish',conclusion:value.decision.conclusion};}
 return {schemaVersion:1,id:canonical?value.id:randomUUID(),projectId,verificationStatus:'not-run',title:value.title,summary:value.summary,decision,limitations:[...value.limitations]};
}
export function createInvestigationDecision({raw,context,projectId}){let value;try{check(typeof raw==='string'&&bytes(raw)<=65536);value=JSON.parse(raw);}catch{throw new InvestigationContinuationError('The model returned an invalid investigation decision. No action is available.');}return decisionValue(value,context,projectId,false);}
export function validateInvestigationDecision(value,context,projectId){return decisionValue(value,context,projectId,true);}
