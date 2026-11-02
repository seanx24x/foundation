import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,rename,rm} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {changeGroupDigest,validateChangeSet} from '../../../server/project/proposals.mjs';

const MAX_PLANS=8,MAX_ATTEMPTS=13,MAX_BYTES=1024*1024;
const TASKS=new Set(['node:test','typescript:check']);
const TERMINAL=new Set(['passed','failed','cancelled','interrupted','unavailable']);
const LIVE=new Set(['preparing','ready','running']);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).every(key=>keys.includes(key));
const text=(x,limit)=>typeof x==='string'&&!x.includes('\0')&&Buffer.byteLength(x,'utf8')<=limit&&Buffer.from(x).toString('utf8')===x;
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const clone=x=>structuredClone(x),now=()=>new Date().toISOString();
const fail=(code,message)=>Object.assign(new Error(message),{name:'CheckPlanError',code});
const STORAGE='The check plan could not be saved. Retry local storage before continuing; no next check will start automatically.';
const UNAVAILABLE='The saved check plan could not be read safely. Its history has been left untouched.';
function valid(condition){if(!condition)throw Error('Invalid check plan');}
function taskValue(value){valid(exact(value,['id','label','command'])&&TASKS.has(value.id)&&text(value.label,160)&&value.label&&text(value.command,32768)&&value.command);return clone(value);}
function recommendationValue(value){
 if(value===undefined)return undefined;
 valid(exact(value,['conversationId','requestId','artifactId','artifactDigest'])&&token(value.conversationId)&&token(value.requestId)&&uuid(value.artifactId)&&digest(value.artifactDigest));
 return {conversationId:value.conversationId,requestId:value.requestId,artifactId:value.artifactId,artifactDigest:value.artifactDigest};
}
const recommendationKey=value=>value&&JSON.stringify([value.conversationId,value.requestId,value.artifactId]);
function planValue(value,projectId,schemaVersion=2){
 valid(schemaVersion>=2||!Object.hasOwn(value||{},'recommendation'));
 valid(exact(value,['id','projectId','groupId','groupRevision','groupDigest','snapshotRevision','revision','status','steps','activeAttemptId','createdAt','updatedAt','recommendation'])&&uuid(value.id)&&value.projectId===projectId&&uuid(value.groupId)&&Number.isSafeInteger(value.groupRevision)&&value.groupRevision>=0&&digest(value.groupDigest)&&digest(value.snapshotRevision)&&Number.isSafeInteger(value.revision)&&value.revision>=0&&['paused','running','completed','ended'].includes(value.status)&&date(value.createdAt)&&date(value.updatedAt)&&value.updatedAt>=value.createdAt&&Array.isArray(value.steps)&&value.steps.length>=1&&value.steps.length<=2);
 const result=clone(value),ids=new Set(),taskIds=new Set();if(value.recommendation!==undefined)result.recommendation=recommendationValue(value.recommendation);let attempts=0,live=[];
 for(const step of result.steps){
  valid(exact(step,['id','task','status','attempts'])&&uuid(step.id)&&!ids.has(step.id)&&['pending','passed','skipped'].includes(step.status)&&Array.isArray(step.attempts));ids.add(step.id);step.task=taskValue(step.task);valid(!taskIds.has(step.task.id));taskIds.add(step.task.id);
  let previous=value.createdAt;
  for(const attempt of step.attempts){
   valid(exact(attempt,['id','executionId','status','reason','createdAt','finishedAt'])&&uuid(attempt.id)&&!ids.has(attempt.id)&&(LIVE.has(attempt.status)||TERMINAL.has(attempt.status))&&date(attempt.createdAt)&&attempt.createdAt>=previous&&attempt.createdAt<=value.updatedAt);
   ids.add(attempt.id);valid(++attempts<=MAX_ATTEMPTS);if(attempt.executionId!==undefined)valid(uuid(attempt.executionId));if(attempt.reason!==undefined)valid(text(attempt.reason,1200));
   if(TERMINAL.has(attempt.status))valid(date(attempt.finishedAt)&&attempt.finishedAt>=attempt.createdAt&&attempt.finishedAt<=value.updatedAt);else {valid(attempt.finishedAt===undefined);live.push({step,attempt});}
   if(attempt.status==='passed')valid(attempt.executionId);previous=attempt.finishedAt||attempt.createdAt;
  }
  valid(step.attempts.slice(0,-1).every(attempt=>TERMINAL.has(attempt.status)&&attempt.status!=='passed'));
  if(step.status==='passed')valid(step.attempts.at(-1)?.status==='passed');else valid(!step.attempts.some(attempt=>attempt.status==='passed'));
 }
 const first=result.steps.find(step=>step.status==='pending');
 if(first)valid(result.steps.slice(result.steps.indexOf(first)+1).every(step=>step.status==='pending'&&step.attempts.length===0));
 if(value.status==='running')valid(uuid(value.activeAttemptId)&&live.length===1&&live[0].attempt.id===value.activeAttemptId&&live[0].step.id===first?.id&&live[0].attempt===live[0].step.attempts.at(-1));
 else valid(value.activeAttemptId===undefined&&live.length===0);
 valid(value.status==='completed'?result.steps.every(step=>step.status!=='pending'):value.status==='ended'||result.steps.some(step=>step.status==='pending'));
 return result;
}

/** Durable decisions around fixed isolated checks. This module never evaluates project commands. */
export function createCheckPlanSession({storageRoot,projectId,execution,isCurrent=()=>true,onChange=()=>{}}={}){
 if(!isAbsolute(storageRoot||'')||!token(projectId)||!execution?.snapshot||!execution?.prepare||!execution?.run||!execution?.stop)throw fail('invalid-plan-storage','Choose project-owned check-plan storage and its isolated executor.');
 const filename=join(storageRoot,'check-plans.json');let data={schemaVersion:2,projectId,current:null,history:[]},loaded=false,loading,storage={status:'unavailable',message:'Load saved check plans before continuing.'},busy=false,error,disposed=false,generation=0,pending,executionStopping;
 const notify=()=>{try{onChange(snapshot());}catch{}};
 const own=()=>{if(disposed||!isCurrent())throw fail('plan-retired','This check plan no longer belongs to the active project.');};
 const available=()=>{own();if(!loaded||storage.status==='unavailable')throw fail('plan-storage-unavailable',UNAVAILABLE);if(storage.status!=='saved')throw fail('plan-storage',STORAGE);};
 const totalAttempts=plan=>plan.steps.reduce((sum,step)=>sum+step.attempts.length,0);
 function assessment(){
  const current=data.current,next=current?.steps.find(step=>step.status==='pending'),retry=next?.attempts.length?next:undefined,executor=execution.snapshot();
  const saved=loaded&&storage.status==='saved',idle=saved&&!busy&&!executor.busy,active=idle&&current?.status==='paused',room=current&&totalAttempts(current)<MAX_ATTEMPTS;
  return {canCreate:Boolean(idle&&(!current||['completed','ended'].includes(current.status))&&data.history.length+(current?1:0)<MAX_PLANS&&executor.storage?.status==='saved'&&executor.current?.status==='ready'),
   canRunNext:Boolean(active&&next&&!retry&&room&&executor.assessment?.canPrepare),canRetryStep:Boolean(active&&retry&&room&&executor.assessment?.canPrepare),canSkipStep:Boolean(active&&next),canStop:Boolean(busy&&current?.activeAttemptId),canEnd:Boolean(idle&&current?.status==='paused'),
   ...(next?{nextStepId:next.id}:{}),...(retry?{retryStepId:retry.id}:{}),
   ...(!saved?{reason:storage.message||STORAGE}:executor.storage?.status!=='saved'?{reason:'Save isolated execution history before continuing.'}:busy||executor.busy?{reason:'One check-plan action is already in progress.'}:current&&totalAttempts(current)>=MAX_ATTEMPTS?{reason:'This plan has reached its thirteen-attempt limit. Earlier evidence is preserved.'}:{})};
 }
 function snapshot(){return {current:clone(data.current),history:clone(data.history),busy,storage:{...storage},assessment:assessment(),...(error?{error}:{})};}
 const records=()=>{const value=execution.snapshot();return [...value.history,...(value.current?[value.current]:[])];};
 const binding=(plan,step,attempt)=>({planId:plan.id,stepId:step.id,attemptId:attempt.id});
 const matches=(record,plan,step,attempt)=>record&&record.projectId===projectId&&record.groupId===plan.groupId&&record.groupRevision===plan.groupRevision&&record.groupDigest===plan.groupDigest&&record.plan?.planId===plan.id&&record.plan.stepId===step.id&&record.plan.attemptId===attempt.id;
 const recordFor=(plan,step,attempt)=>records().find(record=>attempt.executionId?record.id===attempt.executionId:matches(record,plan,step,attempt));
 function evidence(record,plan,step,attempt){
  valid(matches(record,plan,step,attempt)&&date(record.createdAt)&&record.createdAt>=attempt.createdAt);
  if(record.finishedAt!==undefined)valid(date(record.finishedAt)&&record.finishedAt>=attempt.createdAt);
  if(record.taskId!==undefined)valid(record.taskId===step.task.id);
  if(record.status==='passed')valid(record.snapshotRevision===plan.snapshotRevision&&record.taskId===step.task.id&&record.exitCode===0&&record.signal===null&&record.tasks.some(task=>JSON.stringify(task)===JSON.stringify(step.task)));
 }
 function validate(value){
  valid(exact(value,['schemaVersion','projectId','current','history'])&&[1,2].includes(value.schemaVersion)&&value.projectId===projectId&&Array.isArray(value.history)&&value.history.length+(value.current?1:0)<=MAX_PLANS);
  const current=value.current===null?null:planValue(value.current,projectId,value.schemaVersion),history=value.history.map(plan=>planValue(plan,projectId,value.schemaVersion));valid(history.every(plan=>['completed','ended'].includes(plan.status)));
  const ids=new Set(),executionIds=new Set(),recommendations=new Set();for(const plan of [...history,...(current?[current]:[])]){valid(!ids.has(plan.id));ids.add(plan.id);if(plan.recommendation){const key=recommendationKey(plan.recommendation);valid(!recommendations.has(key));recommendations.add(key);}for(const step of plan.steps){valid(!ids.has(step.id));ids.add(step.id);for(const attempt of step.attempts){valid(!ids.has(attempt.id));ids.add(attempt.id);if(attempt.executionId){valid(!executionIds.has(attempt.executionId));executionIds.add(attempt.executionId);}}}}
  return {schemaVersion:2,projectId,current,history};
 }
 function changed(plan=data.current){plan.revision++;plan.updatedAt=now();}
 async function persist({beforeCommit}={}){
  validate(data);const body=JSON.stringify(data);if(Buffer.byteLength(body)>MAX_BYTES)throw fail('plan-capacity','Local check-plan history is full. Earlier plans are preserved.');
  storage={status:'saving'};notify();const temporary=join(storageRoot,`.check-plans-${randomUUID()}.tmp`);let renamed=false;
  try{
   await mkdir(storageRoot,{recursive:true,mode:0o700});const root=await lstat(storageRoot);if(!root.isDirectory()||root.isSymbolicLink())throw Error('Unsafe storage');
   const existing=await lstat(filename).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(existing&&(!existing.isFile()||existing.isSymbolicLink()))throw Error('Unsafe record');
   const file=await open(temporary,'wx',0o600);try{await file.writeFile(body,'utf8');await file.sync();}finally{await file.close();}
   if(beforeCommit){try{await beforeCommit();}catch(error){throw Object.assign(error,{cancelledCommit:true});}}
   await rename(temporary,filename);renamed=true;const directory=await open(storageRoot,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await directory.stat();if(!info.isDirectory()||info.dev!==root.dev||info.ino!==root.ino)throw Error('Storage changed');await directory.sync();}finally{await directory.close();}
   storage={status:'saved'};notify();
  }catch(caught){if(caught.cancelledCommit){storage={status:'saved'};throw caught;}storage={status:'error',message:renamed?'The check-plan record was committed, but directory sync could not be confirmed. Retry saving before continuing.':STORAGE};notify();throw Object.assign(fail('plan-storage',storage.message),{committed:renamed});}
  finally{await rm(temporary,{force:true}).catch(()=>{});}
 }
 function reconcile(){
  let updated=false;const all=[...data.history,...(data.current?[data.current]:[])];
  for(const plan of all){let touched=false;
   for(const step of plan.steps)for(const attempt of step.attempts){
    const record=recordFor(plan,step,attempt);
    if(record){evidence(record,plan,step,attempt);if(attempt.executionId===undefined){attempt.executionId=record.id;touched=true;}}
    if(attempt.status==='passed'){valid(record?.status==='passed');continue;}
    if(!LIVE.has(attempt.status))continue;
    if(record&&TERMINAL.has(record.status)&&execution.snapshot().storage.status==='saved'){
     attempt.status=record.status;attempt.finishedAt=record.finishedAt||now();if(record.reason)attempt.reason=record.reason;
     if(record.status==='passed')step.status='passed';
    }else {attempt.status='interrupted';attempt.finishedAt=now();attempt.reason='Foundation reopened before this decision finished. Choose an explicit fresh retry; no check was resumed.';}
    touched=true;
   }
   if(plan.status==='running'){plan.status=plan.steps.every(step=>step.status!=='pending')?'completed':'paused';delete plan.activeAttemptId;touched=true;}
   if(touched){changed(plan);updated=true;}
  }
  return updated;
 }
 async function read(){
  own();try{
   await execution.load?.();own();
   const root=await lstat(storageRoot).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(root&&(!root.isDirectory()||root.isSymbolicLink()))throw Error('Unsafe root');
   const info=root?await lstat(filename).catch(error=>{if(error.code==='ENOENT')return null;throw error;}):null;
   if(info){if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_BYTES)throw Error('Unsafe history');const handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);let body;try{body=await handle.readFile();}finally{await handle.close();}if(body.length>MAX_BYTES)throw Error('Large history');own();data=validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)));}
   own();loaded=true;storage={status:'saved'};if(reconcile())await persist();notify();return snapshot();
  }catch(caught){if(caught?.code==='plan-storage')throw caught;loaded=false;storage={status:'unavailable',message:UNAVAILABLE};notify();throw fail('plan-storage-unavailable',UNAVAILABLE);}
 }
 async function action(work){
  if(busy)throw fail('plan-busy','Wait for the current check-plan action.');busy=true;error=undefined;notify();
  const operation=(async()=>{try{await work();}catch(caught){error=caught?.name==='CheckPlanError'?caught.message:'The check-plan action stopped. Its earlier evidence is preserved.';throw caught;}finally{busy=false;notify();}return snapshot();})();pending=operation;try{return await operation;}finally{if(pending===operation)pending=undefined;}
 }
 const select=(id,revision)=>{available();const plan=data.current;if(!plan||plan.id!==id||!Number.isSafeInteger(revision)||revision!==plan.revision)throw fail('plan-changed','The check plan changed. Review its latest decision.');return plan;};
 const guarded=async guard=>{own();await guard();own();};
 function groupMatches(group,plan){return group.status==='proposed'&&group.id===plan.groupId&&group.revision===plan.groupRevision&&changeGroupDigest(group)===plan.groupDigest;}
 // Await the executor's own Stop journal, never the encompassing plan action.
 // Its final save can occur after run() resolves, so a transient saving state is not a failed result.
 function stopExecution(record){
  if(executionStopping)return executionStopping;
  const operation=execution.stop(record.id,record.revision).catch(()=>{});executionStopping=operation;
  void operation.finally(()=>{if(executionStopping===operation)executionStopping=undefined;});return operation;
 }
 async function startStep(id,revision,stepId,retry,{group:input,guard=async()=>{},beforeRun}={}){
  const plan=select(id,revision),step=plan.steps.find(item=>item.status==='pending');
  if(plan.status!=='paused'||!step||stepId!==undefined&&step.id!==stepId||(retry?!step?.attempts.length:!!step?.attempts.length))throw fail('plan-decision','Choose Run next for a new step or Retry step for its retained unsuccessful attempt.');
  if(totalAttempts(plan)>=MAX_ATTEMPTS)throw fail('plan-capacity','This plan has reached its thirteen-attempt limit.');
  if(execution.snapshot().busy||execution.snapshot().storage.status!=='saved')throw fail('plan-execution-busy','Finish and save the isolated check before starting another.');
  const group=validateChangeSet(input,projectId);if(!groupMatches(group,plan))throw fail('plan-source-changed','The staged group changed. End this plan and create one for the current version.');
  return action(async()=>{
   const epoch=++generation,checked=async()=>{own();if(epoch!==generation)throw fail('plan-cancelled','This check-plan attempt was stopped.');await guard();own();if(epoch!==generation)throw fail('plan-cancelled','This check-plan attempt was stopped.');};
   await checked();const attempt={id:randomUUID(),status:'preparing',createdAt:now()};step.attempts.push(attempt);plan.activeAttemptId=attempt.id;plan.status='running';changed();
   try{
    await persist();await checked();await execution.prepare(group,{guard:checked,plan:binding(plan,step,attempt)});await checked();
    const prepared=recordFor(plan,step,attempt);if(!prepared)throw fail('plan-execution','The isolated attempt could not be linked to this decision.');attempt.executionId=prepared.id;
    if(prepared.status!=='ready')throw fail('plan-task-unavailable',prepared.reason||'The supported check could not be prepared.');
    if(prepared.snapshotRevision!==plan.snapshotRevision)throw fail('plan-source-changed','Saved project or dependency files changed. This plan cannot combine checks from different copied snapshots. Create a new plan.');
    if(!prepared.tasks.some(task=>JSON.stringify(task)===JSON.stringify(step.task)))throw fail('plan-task-unavailable','This exact supported check is no longer available. Create a new plan.');
    attempt.status='ready';changed();await persist();await checked();attempt.status='running';changed();await persist();await checked();
    await execution.run(prepared.id,prepared.revision,step.task.id,{guard:checked,beforeRun:()=>{own();if(epoch!==generation)throw fail('plan-cancelled','This attempt was stopped.');beforeRun?.();}});
    if(executionStopping)await executionStopping;
    const finished=recordFor(plan,step,attempt);if(execution.snapshot().storage.status!=='saved'||!finished||!TERMINAL.has(finished.status))throw fail('plan-evidence','Save the isolated execution result before continuing this plan.');
    evidence(finished,plan,step,attempt);attempt.status=finished.status;attempt.finishedAt=finished.finishedAt||now();if(finished.reason)attempt.reason=finished.reason;if(finished.status==='passed')step.status='passed';
    delete plan.activeAttemptId;plan.status=plan.steps.every(item=>item.status!=='pending')?'completed':'paused';changed();await persist();
   }catch(caught){
    if(executionStopping)await executionStopping;
    const record=recordFor(plan,step,attempt);if(record&&execution.snapshot().busy)await stopExecution(record);
    if(plan.activeAttemptId===attempt.id){
     const latest=recordFor(plan,step,attempt);if(latest)attempt.executionId=latest.id;
     if(latest&&execution.snapshot().storage.status!=='saved'){
      attempt.reason='The execution result is awaiting local storage. Retry storage to reconcile its recorded outcome; no check will restart.';changed();
      if(storage.status!=='error')await persist().catch(()=>{});
      storage={status:'error',message:attempt.reason};notify();throw caught;
     }
     attempt.status=epoch!==generation?'cancelled':'failed';attempt.reason=epoch!==generation?'Stopped by you. Choose an explicit fresh retry or skip this check.':caught?.name==='CheckPlanError'?caught.message:'The isolated check could not finish. Its earlier evidence is preserved.';attempt.finishedAt=now();
     if(latest&&TERMINAL.has(latest.status)&&execution.snapshot().storage.status==='saved'&&latest.snapshotRevision===plan.snapshotRevision){evidence(latest,plan,step,attempt);attempt.status=latest.status;if(latest.reason)attempt.reason=latest.reason;if(latest.status==='passed')step.status='passed';}
     delete plan.activeAttemptId;plan.status=plan.steps.every(item=>item.status!=='pending')?'completed':'paused';changed();if(storage.status!=='error')await persist().catch(()=>{});
    }
    throw caught;
   }
  });
 }
 async function stop(id,revision,attemptId){
  const plan=data.current;if(id!==undefined||revision!==undefined||attemptId!==undefined){if(!plan||id!==plan.id||!Number.isSafeInteger(revision)||revision<0||revision>plan.revision||!uuid(attemptId)||attemptId!==plan.activeAttemptId)throw fail('plan-changed','Stop only the current check-plan attempt.');}
  if(!busy||!plan?.activeAttemptId)return snapshot();generation++;
  const step=plan.steps.find(item=>item.attempts.some(attempt=>attempt.id===plan.activeAttemptId)),attempt=step.attempts.find(item=>item.id===plan.activeAttemptId),record=recordFor(plan,step,attempt);
  if(record&&execution.snapshot().busy)await stopExecution(record);const operation=pending;if(operation)await operation.catch(()=>{});return snapshot();
 }
 return {snapshot,load:()=>loaded?Promise.resolve(snapshot()):loading||(loading=read().finally(()=>{loading=undefined;})),
  create:async({executionId,expectedExecutionRevision,taskIds,recommendation:recommendationInput}={}, {guard=async()=>{}}={})=>{
   available();let recommendation;try{recommendation=recommendationValue(recommendationInput);}catch{throw fail('plan-recommendation','Choose an exact completed check recommendation.');}
   if(recommendation){const existing=[...data.history,...(data.current?[data.current]:[])].find(plan=>recommendationKey(plan.recommendation)===recommendationKey(recommendation));if(existing){if(JSON.stringify(existing.recommendation)!==JSON.stringify(recommendation)||JSON.stringify(existing.steps.map(step=>step.task.id))!==JSON.stringify(taskIds))throw fail('plan-recommendation-changed','This recommendation already has a saved plan with a different selection. Its earlier decision is preserved.');if(busy)throw fail('plan-busy','Wait for the current check-plan action.');await guarded(guard);return snapshot();}}
   if(execution.snapshot().busy||data.current&&!['completed','ended'].includes(data.current.status))throw fail('plan-active','End the paused plan before creating another.');
   if(data.history.length+(data.current?1:0)>=MAX_PLANS)throw fail('plan-capacity','Eight check plans are retained. Earlier plans are preserved.');
   const original=execution.snapshot(),record=original.current;if(original.storage.status!=='saved'||record?.status!=='ready'||record.id!==executionId||record.revision!==expectedExecutionRevision||!Array.isArray(taskIds)||taskIds.length<1||taskIds.length>2||new Set(taskIds).size!==taskIds.length||taskIds.some(id=>!record.tasks.some(task=>task.id===id)))throw fail('plan-create','Choose one or two advertised checks from the current prepared copy.');
   return action(async()=>{await guarded(guard);const latest=execution.snapshot();if(latest.busy||latest.storage.status!=='saved'||JSON.stringify(latest.current)!==JSON.stringify(record))throw fail('plan-changed','The prepared copy changed before its plan could be saved.');
    const at=now(),plan={id:randomUUID(),projectId,groupId:record.groupId,groupRevision:record.groupRevision,groupDigest:record.groupDigest,snapshotRevision:record.snapshotRevision,revision:0,status:'paused',...(recommendation?{recommendation}:{}),steps:taskIds.map(id=>({id:randomUUID(),task:clone(record.tasks.find(task=>task.id===id)),status:'pending',attempts:[]})),createdAt:at,updatedAt:at};
    const previous=data,next={...data,history:[...data.history,...(data.current?[data.current]:[])],current:plan};validate(next);data=next;try{await persist({beforeCommit:async()=>{await guarded(guard);const value=execution.snapshot();if(value.busy||value.storage.status!=='saved'||JSON.stringify(value.current)!==JSON.stringify(record))throw fail('plan-changed','The prepared copy changed before the plan was committed.');}});}catch(error){if(error.cancelledCommit)data=previous;throw error;}});
  },runNext:(id,revision,options)=>startStep(id,revision,undefined,false,options),retryStep:(id,revision,stepId,options)=>startStep(id,revision,stepId,true,options),
  skipStep:async(id,revision,stepId,{guard=async()=>{}}={})=>{const plan=select(id,revision),step=plan.steps.find(item=>item.status==='pending');if(plan.status!=='paused'||step?.id!==stepId||execution.snapshot().busy)throw fail('plan-decision','Skip only the next pending check while no check is running.');return action(async()=>{await guarded(guard);const previous=clone(data);step.status='skipped';plan.status=plan.steps.every(item=>item.status!=='pending')?'completed':'paused';changed();try{await persist({beforeCommit:()=>guarded(guard)});}catch(error){if(error.cancelledCommit)data=previous;throw error;}});},
  end:async(id,revision,{guard=async()=>{}}={})=>{const plan=select(id,revision);if(plan.status!=='paused'||execution.snapshot().busy)throw fail('plan-decision','Stop the active check before ending this plan.');return action(async()=>{await guarded(guard);const previous=clone(data);plan.status='ended';changed();try{await persist({beforeCommit:()=>guarded(guard)});}catch(error){if(error.cancelledCommit)data=previous;throw error;}});},stop,
  retryStorage:async()=>{own();if(busy)throw fail('plan-busy','Wait for the current plan action before retrying storage.');if(!loaded||storage.status==='unavailable')return read();return action(async()=>{await execution.load?.();own();if(execution.snapshot().storage.status==='error'){await execution.retry?.();own();}if(execution.snapshot().storage.status!=='saved')throw fail('plan-evidence','Save isolated execution history before retrying this plan.');reconcile();await persist();});},
  dispose:async()=>{disposed=true;await stop();},
 };
}
