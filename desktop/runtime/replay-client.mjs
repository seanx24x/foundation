/** Serialized into the instrumented development page. Callback code is app-authored and never sent over the protocol. */
export function runtimeReplayClient(settings,hooks,makeProtocol){
  const p=makeProtocol();let registration=null,catalog=null,timer,polling=false,retired=false,blocked=false,stopReason='runtime-changed',active=null,execution=null;
  const completed=new Map();
  const observed=()=>p.observed({viewportWidthCss:innerWidth,viewportHeightCss:innerHeight,deviceScaleFactor:devicePixelRatio,colorSchemePreference:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light',reducedMotionPreference:matchMedia('(prefers-reduced-motion: reduce)').matches?'reduce':'no-preference'});
  const scope=()=>{const v=hooks.identity();return {session:settings.session,viewId:v.viewId,documentId:v.documentId,pageSequence:v.pageSequence};};
  const send=async(path,body)=>{
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),2000);
    try{const response=await hooks.fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Foundation-Token':settings.token},body:JSON.stringify({...scope(),...body}),signal:controller.signal});
      const text=await response.text();if(text.length>32768||!response.ok)throw new Error('replay-transport');return JSON.parse(text);
    }finally{clearTimeout(timeout);}
  };
  const stop=(reason='runtime-changed')=>{blocked=true;stopReason=reason;active?.controller.abort();if(execution)execution.controller.abort();};
  const matches=command=>{const i=hooks.identity();return !retired&&!blocked&&i.ready&&i.session===command.identity.session&&i.viewId===command.identity.viewId&&i.documentId===command.identity.documentId&&i.route===command.identity.route&&i.pageSequence===command.pageSequence&&registration?.id===command.registrationId&&catalog?.digest===command.catalogDigest;};
  const ack=receipt=>send('/__foundation/replay-events',{type:'ack',...receipt}).catch(()=>null);
  async function run(command){
    if(!command.command||!matches(command))return;
    const {commandId,unit}=command.command;
    if(completed.has(commandId)){await ack(completed.get(commandId));return;}
    if(active)return;
    if(!execution||execution.id!==command.executionId){
      if(execution?.controller&&!execution.finished){stop();return;}
      execution={id:command.executionId,controller:new AbortController(),finished:false};
    }
    const recipe=registration.recipes.find(r=>r.id===command.recipeId),callback=unit.phase==='prepare'?recipe?.prepare:recipe?.steps.find(s=>s.id===unit.stepId)?.run;
    if(typeof callback!=='function'){stop();return;}
    const controller=execution.controller,attempt={commandId,controller};active=attempt;
    let status='completed',reason=null;
    const timeout=setTimeout(()=>{stop('unit-timeout');},10000);
    try{
      if(!matches(command)||Math.abs(innerWidth-command.requested.viewportWidthCss)>1||Math.abs(innerHeight-command.requested.viewportHeightCss)>1){stop('conditions-changed');throw new Error('replay-conditions');}
      hooks.controls(command.requested.theme);
      await callback(Object.freeze({signal:controller.signal,conditions:Object.freeze({...command.requested})}));
      if(Math.abs(innerWidth-command.requested.viewportWidthCss)>1||Math.abs(innerHeight-command.requested.viewportHeightCss)>1)stop('conditions-changed');
      if(controller.signal.aborted||!matches(command)){status='interrupted';reason=stopReason;}
    }catch{status=controller.signal.aborted||!matches(command)?'interrupted':'failed';reason=status==='failed'?'callback-failed':stopReason;}
    finally{clearTimeout(timeout);if(active===attempt)active=null;}
    let conditions;try{conditions=observed();}catch{stop();return;}
    const receipt={executionId:command.executionId,commandId,status,reason,observed:conditions};completed.set(commandId,receipt);
    if(status!=='completed'||unit.phase==='prepare'&&recipe.steps.length===0||unit.phase==='step'&&unit.stepId===recipe.steps.at(-1)?.id)execution.finished=true;
    // A late callback cannot publish success after cancellation or a replaced registry.
    await ack(receipt);
  }
  async function poll(){
    if(retired||polling||!registration)return;polling=true;
    try{
      if(!hooks.identity().ready)return;
      if(!catalog){const value=await send('/__foundation/replay-events',{type:'register',registrationId:registration.id,recipes:registration.metadata});const next=p.catalog(value.catalog);if(next.registrationId!==registration.id)return;catalog=next;}
      const i=scope(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),2000);
      let result;
      try{const response=await hooks.fetch('/__foundation/replay-command',{headers:{'X-Foundation-Token':settings.token,'X-Foundation-View':i.viewId,'X-Foundation-Document':i.documentId,'X-Foundation-Page':String(i.pageSequence)},signal:controller.signal});const text=await response.text();if(!response.ok||text.length>32768)throw new Error('replay-transport');result=JSON.parse(text);}finally{clearTimeout(timeout);}
      if(result.blocked)stop();
      if(result.registrationId!==registration.id){catalog=null;if(execution&&!execution.finished)stop();return;}
      if(result.status==='running'){
        if(!matches(result)){stop();return;}
        if(execution?.id===result.executionId){clearTimeout(execution.lease);execution.lease=setTimeout(()=>stop('lease-expired'),Math.min(4000,Math.max(0,result.leaseMs)));}
        void run(result);
      }else if(execution?.id===result.executionId){execution.finished=true;clearTimeout(execution.lease);if(result.status!=='completed')execution.controller.abort();}
    }catch{if(execution&&!execution.finished&&!execution.lease)execution.lease=setTimeout(()=>stop('lease-expired'),4000);}
    finally{polling=false;if(!retired&&registration){timer=setTimeout(poll,150);}}
  }
  const register=input=>{
    if(retired||!p.exact(input,['version','recipes'])||input.version!==1||!Array.isArray(input.recipes))throw new Error('Invalid Foundation scenario registration.');
    const recipes=input.recipes.map(r=>{
      if(!p.exact(r,['id','title','route','fixture','prepare','steps'])||typeof r.prepare!=='function'||!Array.isArray(r.steps))throw new Error('Invalid Foundation scenario registration.');
      return {...r,steps:r.steps.map(s=>{if(!p.exact(s,['id','title','run'])||typeof s.run!=='function')throw new Error('Invalid Foundation scenario registration.');return {...s};})};
    });
    const metadata=p.recipes(recipes.map(r=>({id:r.id,title:r.title,route:r.route,fixture:r.fixture,steps:r.steps.map(s=>({id:s.id,title:s.title}))})));
    if(execution&&!execution.finished)stop();
    const id=crypto.randomUUID().replace(/-/g,'');registration={id,recipes,metadata};catalog=null;clearTimeout(timer);void poll();
    return ()=>{if(registration?.id!==id)return;if(execution&&!execution.finished)stop();registration=null;catalog=null;clearTimeout(timer);void send('/__foundation/replay-events',{type:'unregister',registrationId:id}).catch(()=>{});};
  };
  Object.defineProperty(window,'__foundationRegisterScenarios',{configurable:false,writable:false,value:register});
  window.addEventListener('pagehide',()=>{retired=true;stop();clearTimeout(timer);},{once:true});
  return {invalidate(){if(execution&&!execution.finished)stop();catalog=null;}};
}
