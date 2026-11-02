import { replayProtocol as p, replayCatalogDigest, REPLAY_LIMITS } from './replay-protocol.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=()=>{throw new Error('replay-unavailable');};
export function createReplayMailbox({session,now=Date.now,changed=()=>{}}){
  const fresh=()=>({catalog:null,blocked:null,execution:null,used:new Set()});
  const state=view=>view.replay||=(fresh());
  const invalidate=(view,reason='runtime-changed')=>{const s=state(view);if(s.execution?.status==='running'){s.execution.status='interrupted';s.execution.reason=reason;s.blocked='reload-required';changed();}};
  const expire=view=>{const s=state(view),e=s.execution;if(e?.status==='running'&&(now()>e.leaseUntil||now()-view.lastPageSeen>=8000)){invalidate(view,'lease-expired');}return s;};
  const publicExecution=e=>e?{executionId:e.request.executionId,status:e.status,...(e.reason?{reason:e.reason}:{}),receipts:e.receipts.map(x=>({...x})),next:e.next}:null;
  const snapshot=view=>{const s=expire(view);return {replayCatalog:s.catalog,replayBlocked:s.blocked,replayExecution:publicExecution(s.execution)};};
  const validPage=(view,documentId,pageSequence)=>view.documentId===documentId&&view.pageSequence===pageSequence&&now()-view.lastPageSeen<8000;
  const register=(view,input)=>{
    if(!p.exact(input,['type','session','viewId','documentId','pageSequence','registrationId','recipes'])||input.type!=='register'||input.session!==session||!p.hex(input.registrationId)||!validPage(view,input.documentId,input.pageSequence))fail();
    const recipes=p.recipes(input.recipes),s=expire(view);
    const catalog={schemaVersion:1,registrationId:input.registrationId,digest:replayCatalogDigest(recipes),recipes};
    if(s.catalog?.registrationId===catalog.registrationId){if(!same(s.catalog,catalog))fail();return s.catalog;}
    invalidate(view,'registration-changed');s.catalog=catalog;changed();return catalog;
  };
  const unregister=(view,input)=>{const s=state(view);if(!p.exact(input,['type','session','viewId','documentId','pageSequence','registrationId'])||input.type!=='unregister'||input.session!==session||!validPage(view,input.documentId,input.pageSequence)||s.catalog?.registrationId!==input.registrationId)fail();invalidate(view,'registration-changed');s.catalog=null;changed();return {};};
  const host=(view,viewId,input)=>{
    if(!input||!['reserve','dispatch','read','cancel','finish'].includes(input.action))fail();
    const s=expire(view);
    if(input.action==='reserve'){
      if(!p.exact(input,['action','request']))fail();const r=p.request(input.request),c=s.catalog;
      if(r.identity.session!==session||r.identity.viewId!==viewId||r.identity.documentId!==view.documentId||r.identity.route!==view.pagePath||r.identity.pageVersion!==view.pageVersion||now()-view.lastPageSeen>=8000||s.blocked||!c||r.registrationId!==c.registrationId||r.catalogDigest!==c.digest)fail();
      const recipe=c.recipes.find(x=>x.id===r.recipeId&&x.route===r.identity.route);if(!recipe)fail();
      if(s.execution?.request.executionId===r.executionId){if(!same(s.execution.request,r))fail();return publicExecution(s.execution);}
      if(s.execution?.status==='running'||s.used.has(r.executionId)||s.used.size>=REPLAY_LIMITS.executionsPerDocument)fail();
      s.used.add(r.executionId);s.execution={request:r,recipe,status:'running',next:0,command:null,receipts:[],leaseUntil:now()+REPLAY_LIMITS.leaseMs};changed();return publicExecution(s.execution);
    }
    if(!p.exact(input,input.action==='dispatch'?['action','executionId','unit']:['action','executionId'])||!p.hex(input.executionId))fail();
    const e=s.execution;if(!e||e.request.executionId!==input.executionId)fail();
    if(input.action==='cancel'){if(e.status==='running'){e.status='cancelled';e.reason='cancelled';s.blocked='reload-required';changed();}return publicExecution(e);}
    if(e.status!=='running')return publicExecution(e);
    const i=e.request.identity;if(i.documentId!==view.documentId||i.route!==view.pagePath||i.pageVersion!==view.pageVersion||s.catalog?.registrationId!==e.request.registrationId||s.catalog?.digest!==e.request.catalogDigest){invalidate(view);return publicExecution(e);}
    e.leaseUntil=now()+REPLAY_LIMITS.leaseMs;
    if(input.action==='dispatch'){
      const unit=p.unit(input.unit),expected=e.next===0?{phase:'prepare'}:e.recipe.steps[e.next-1]?{phase:'step',stepId:e.recipe.steps[e.next-1].id}:null;
      if(e.command){if(!same(e.command.unit,unit))fail();return publicExecution(e);}
      if(!expected||!same(unit,expected))fail();e.command={commandId:`${input.executionId}:${e.next}`,unit,deadline:now()+REPLAY_LIMITS.unitMs};changed();
    }else if(input.action==='finish'){
      if(e.command||e.next!==e.recipe.steps.length+1)fail();e.status='completed';changed();
    }
    return publicExecution(e);
  };
  const command=(view,documentId,pageSequence)=>{
    if(!validPage(view,documentId,pageSequence))fail();const s=expire(view),e=s.execution;
    if(e?.status==='running'&&e.command&&now()>e.command.deadline)invalidate(view,'unit-timeout');
    if(!e||e.status!=='running')return {status:e?.status||'idle',executionId:e?.request.executionId||null,registrationId:s.catalog?.registrationId||null,blocked:s.blocked};
    return {status:'running',executionId:e.request.executionId,registrationId:e.request.registrationId,catalogDigest:e.request.catalogDigest,recipeId:e.request.recipeId,requested:e.request.requested,identity:e.request.identity,pageSequence:view.pageSequence,
      command:e.command?{commandId:e.command.commandId,unit:e.command.unit}:null,leaseMs:Math.max(0,e.leaseUntil-now()),blocked:s.blocked};
  };
  const ack=(view,input)=>{
    if(!p.exact(input,['type','session','viewId','documentId','pageSequence','executionId','commandId','status','reason','observed'])||input.type!=='ack'||input.session!==session||!validPage(view,input.documentId,input.pageSequence)||!['completed','failed','cancelled','interrupted'].includes(input.status)||!([null,'callback-failed','cancelled','conditions-changed','runtime-changed','unit-timeout','lease-expired'].includes(input.reason))||input.status==='completed'&&input.reason!==null||input.status==='failed'&&input.reason!=='callback-failed')fail();
    const s=expire(view),e=s.execution;if(!e||e.request.executionId!==input.executionId)fail();
    if(e.receipts.some(x=>x.commandId===input.commandId))return publicExecution(e);
    if(e.status!=='running'||!e.command||e.command.commandId!==input.commandId)fail();
    const observed=p.observed(input.observed),receipt={commandId:input.commandId,...e.command.unit,status:input.status,observed};
    e.receipts.push(receipt);e.command=null;
    if(input.status==='completed')e.next++;else{e.status=input.status;e.reason=input.reason||'runtime-changed';if(input.status==='cancelled'||input.status==='interrupted')s.blocked='reload-required';}
    changed();return publicExecution(e);
  };
  return {fresh,state,snapshot,register,unregister,host,command,ack,invalidate,
    documentChanged(view){invalidate(view);view.replay=fresh();},
    sourceChanged(view){const s=state(view);if(s.catalog)s.blocked='reload-required';invalidate(view,'source-changed');s.catalog=null;changed();}};
}
