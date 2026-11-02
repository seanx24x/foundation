import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, realpath, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { normalizeReplayCatalog, replayProtocol, REPLAY_LIMITS } from '../../runtime/replay-protocol.mjs';
import { safeScreenRoute } from './runtime-workspace-store.mjs';

const MAX_RESPONSE = 256 * 1024;
const EMPTY_CAPABILITIES = { sourceMapping:'unavailable', requests:false, screenshots:false, routeTracking:false, scenarioReplay:false };
const safePath = value => typeof value === 'string' && value.length <= 1024 && !path.isAbsolute(value) && !value.split('/').includes('..') && !value.includes('\\') && !value.includes('\0');
export function loopbackRuntimeURL(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Enter a loopback development URL, such as http://127.0.0.1:5173.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !url.port) throw new Error('Use an HTTP loopback URL with an explicit port and no credentials, query, or fragment.');
  // Exact local addresses keep DNS names and redirects out of target attachment.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url;
}
const sanitizeURL = value => {
  try { const url = new URL(value); if (!['http:','https:'].includes(url.protocol)) return null;
    url.username='';url.password='';url.search='';url.hash='';return url.href.slice(0,1024); } catch { return null; }
};
async function jsonRequest(url, token, signal, viewId, body) {
  const response = await fetch(url, { redirect:'error', signal, ...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}), headers: {...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{'X-Foundation-Token':token}:{}),...(viewId?{'X-Foundation-View':viewId}:{})} });
  if (!response.ok) throw new Error(response.status === 404 ? 'This target has no Foundation instrumentation. Add the development plugin before connecting.' : 'The development target could not authorize this runtime session. Reconnect it.');
  if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error('The target did not return Foundation runtime metadata.');
  let bytes = 0; const chunks = [];
  for await (const chunk of response.body) { bytes+=chunk.length; if(bytes>MAX_RESPONSE) throw new Error('The runtime metadata is too large.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('The runtime metadata is invalid.'); }
}
async function freePort() {
  const server = createServer();
  return new Promise((resolve,reject)=>{ server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));}); });
}
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));

/** Owns a single local target connection. It never edits workspace files. */
export function createConnectedRuntime({ root: requestedRoot, onChange = () => {}, nodePath = process.execPath, pollMs = 400, startupTimeoutMs = 12000, launchProcess } = {}) {
  let canonicalRoot, generation = 0, disposed = false, timer, child, pollingAbort;
  let token = null, address = null, lastVersion = -1, viewId = null, replayOperation = null;
  let state = { status:'idle', root:requestedRoot, targets:[], owned:false, capabilities:{...EMPTY_CAPABILITIES},selection:null,selectionVersion:0,observations:[],files:[],pagePath:null,documentId:null,pageVersion:null };
  const emit = patch => { if(patch.capabilities&&!patch.capabilities.scenarioReplay)patch={...patch,replayCatalog:null,replayBlocked:null}; state={...state,...patch};try {onChange(structuredClone(state));} catch {} };
  const snapshot = () => structuredClone(state);
  const getRoot = async () => canonicalRoot ||= await realpath(requestedRoot);
  async function discover() {
    const root=await getRoot(); let manifest;
    try {manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));} catch {emit({root,targets:[]});return [];}
    const script=manifest.scripts?.dev;
    const recognized=typeof script==='string' && /^vite(?:\s+(?:--host(?:\s+(?:127\.0\.0\.1|localhost))?|--port\s+\d+|--strictPort|--open))*\s*$/.test(script);
    let vitePath;
    try {vitePath=path.join(path.dirname(createRequire(path.join(root,'package.json')).resolve('vite/package.json')),'bin/vite.js');await access(vitePath);}catch{}
    let instrumented=false;
    for(const name of ['vite.config.mjs','vite.config.ts','vite.config.js','vite.config.mts'])try{instrumented ||= /foundationRuntime/.test(await readFile(path.join(root,name),'utf8'));}catch{}
    const target=recognized?{id:'vite:dev',label:manifest.name||path.basename(root),root,commandLabel:'npm run dev',available:Boolean(vitePath),instrumented,reason:!vitePath?'Install this project’s dependencies before starting it.':!instrumented?'Add the Foundation development plugin before starting this target.':undefined}:null;
    const targets=target?[target]:[];emit({root,targets});return targets;
  }
  async function validate(payload, expectedSession, expectedView) {
    if (!payload || payload.protocol!==1 || !/^[a-f0-9]{32}$/.test(payload.session) || expectedSession && payload.session!==expectedSession) throw new Error('The runtime session changed. Reconnect the target.');
    if(expectedView&&payload.viewId!==expectedView)throw new Error('The runtime view changed. Reconnect the target.');
    if (typeof payload.root!=='string' || await realpath(payload.root)!==await getRoot()) throw new Error('This runtime belongs to a different project. Open its folder before connecting.');
    if (!Number.isSafeInteger(payload.version)||payload.version<0||!Number.isSafeInteger(payload.selectionVersion)||payload.selectionVersion<0) throw new Error('The runtime metadata is invalid.');
    const files=[];
    for (const item of (Array.isArray(payload.files)?payload.files:[]).slice(0,512)) {
      if (!safePath(item?.path)||!/^[a-f0-9]{64}$/.test(item.revision)) continue;
      // Reject source claims which leave the active project through symlinks.
      try {const full=await realpath(path.join(canonicalRoot,item.path));const rel=path.relative(canonicalRoot,full);if(rel.startsWith('..')||path.isAbsolute(rel))continue;files.push({path:item.path,revision:item.revision});}catch{}
    }
    let selection=null;
    const input=payload.selection;
    if(input&&typeof input.id==='string'&&input.id.length<=80&&input.rect&&['x','y','width','height'].every(key=>Number.isFinite(input.rect[key])&&Math.abs(input.rect[key])<100000)){
      const source=files.find(file=>file.path===input.path&&file.revision===input.revision);
      let stale=input.stale===true;
      if(source)try{stale ||= createHash('sha256').update(await readFile(path.join(canonicalRoot,source.path))).digest('hex')!==source.revision;}catch{stale=true;}
      const styles={};for(const key of ['color','backgroundColor','fontSize','fontWeight','lineHeight','padding','gap','borderRadius','display','width','height'])if(typeof input.styles?.[key]==='string')styles[key]=input.styles[key].slice(0,200);
      selection={id:input.id,mapping:source&&input.mapping==='resolved'?'resolved':input.mapping==='ambiguous'?'ambiguous':'unavailable',...(source?{...source,line:Number.isInteger(input.line)&&input.line>0?input.line:1}:{}),stale,
        tag:String(input.tag||'element').slice(0,30),label:String(input.label||'Selected element').slice(0,160),rect:Object.fromEntries(['x','y','width','height'].map(key=>[key,input.rect[key]])),styles};
    }
    const routeTracking=payload.capabilities?.routeTracking===true&&Number.isSafeInteger(payload.pageVersion)&&payload.pageVersion>=0;
    const pageVersion=routeTracking?payload.pageVersion:null;
    const documentId=routeTracking&&/^[a-f0-9]{32}$/.test(payload.documentId)?payload.documentId:null;
    let pagePath=null;if(routeTracking&&documentId)try{pagePath=safeScreenRoute(payload.pagePath);}catch{}
    const observations=[];
    for(const item of (Array.isArray(payload.observations)?payload.observations:[]).slice(-100)){
      const url=sanitizeURL(item?.url);
      if(!url||item.session!==payload.session||typeof item.id!=='string'||item.id.length>140||item.kind!=='request'||!/^[A-Z]{1,16}$/.test(item.method)||!(item.status===null||Number.isInteger(item.status)&&item.status>=100&&item.status<=599)||!Number.isFinite(item.durationMs)||item.durationMs<0||item.durationMs>3600000||!['success','http-error','network-error','aborted'].includes(item.outcome))continue;
      if(routeTracking&&item.documentId!==documentId)continue;
      observations.push({id:item.id,session:item.session,...(routeTracking?{documentId:item.documentId}:{}),kind:'request',method:item.method,url,status:item.status,durationMs:item.durationMs,outcome:item.outcome,observedAt:typeof item.observedAt==='string'&&!Number.isNaN(Date.parse(item.observedAt))?new Date(item.observedAt).toISOString():null,
        timing:item.timing==='response-complete'?'response-complete':'response-headers',correlation:'unattributed'});
    }
    let replayCatalog=null,replayBlocked=null,scenarioReplay=payload.capabilities?.scenarioReplay===true;
    if(scenarioReplay){try{if(payload.replayCatalog!==null&&payload.replayCatalog!==undefined)replayCatalog=normalizeReplayCatalog(payload.replayCatalog);if(payload.replayBlocked!==null&&payload.replayBlocked!==undefined){if(payload.replayBlocked!=='reload-required')throw new Error();replayBlocked='reload-required';}}catch{scenarioReplay=false;replayBlocked='invalid-catalog';}}
    return {session:payload.session,viewId:payload.viewId,pagePath,documentId,pageVersion,version:payload.version,pageConnected:payload.pageConnected===true,selectionVersion:payload.selectionVersion,selection,observations,files,replayCatalog,replayBlocked,capabilities:{sourceMapping:'instrumented',requests:true,screenshots:false,routeTracking,scenarioReplay}};
  }
  function clearPoll() {clearTimeout(timer);timer=undefined;pollingAbort?.abort();pollingAbort=null;}
  function schedule(current) {if(!disposed&&current===generation) {timer=setTimeout(()=>void poll(current),pollMs);timer.unref?.();}}
  async function poll(current) {
    if(disposed||current!==generation||!address||!token)return;
    const controller=new AbortController();pollingAbort=controller;
    const timeout=setTimeout(()=>controller.abort(),2500);timeout.unref?.();
    try {
      const raw=await jsonRequest(new URL('/__foundation/snapshot',address),token,controller.signal,viewId);
      const clean=await validate(raw,state.session,viewId);
      if(current!==generation||disposed)return;
      if(clean.version!==lastVersion||state.status!=='connected'||clean.pageConnected!==state.pageConnected||JSON.stringify(clean.selection)!==JSON.stringify(state.selection)) {lastVersion=clean.version;emit({...clean,status:'connected',error:undefined});}
    } catch(error) {
      const message=error.name==='AbortError'?'The target stopped responding. Reconnect or restart it.':error.message;
      if(current===generation&&!disposed&&(state.status!=='disconnected'||state.error!==message))emit({status:'disconnected',error:message});
    }
    finally {clearTimeout(timeout);if(pollingAbort===controller)pollingAbort=null;schedule(current);}
  }
  async function attach(url,current,owned,target,expectedSession) {
    const parsed=loopbackRuntimeURL(url);const nextView=randomBytes(16).toString('hex');const controller=new AbortController();pollingAbort=controller;
    const timeout=setTimeout(()=>controller.abort(),2500);timeout.unref?.();
    try {
      const raw=await jsonRequest(new URL('/__foundation/handshake',parsed),null,controller.signal,nextView);
      if(!/^[a-f0-9]{64}$/.test(raw.token))throw new Error('The target has no valid Foundation runtime session.');
      const clean=await validate(raw,expectedSession,nextView);
      if(disposed||current!==generation)return;
      token=raw.token;address=parsed;viewId=nextView;lastVersion=clean.version;
      const frame=new URL(parsed);frame.searchParams.set('__foundation_view',nextView);
      emit({...clean,status:'connected',targetUrl:parsed.href,url:frame.href,owned,target,error:undefined});schedule(current);
    } finally {clearTimeout(timeout);if(pollingAbort===controller)pollingAbort=null;}
  }
  async function terminateChild(owned) {
    if(!owned||owned.exitCode!==null||owned.signalCode!==null)return;
    const finished=new Promise(resolve=>owned.once('exit',resolve));
    try {if(process.platform!=='win32')process.kill(-owned.pid,'SIGTERM');else owned.kill('SIGTERM');}catch{}
    await Promise.race([finished,pause(2000)]);
    if(owned.exitCode===null&&owned.signalCode===null)try{if(process.platform!=='win32')process.kill(-owned.pid,'SIGKILL');else owned.kill('SIGKILL');}catch{}
  }
  async function stopChild() {const owned=child;child=null;if(!owned)return;await terminateChild(owned);}
  async function stop() {
    replayOperation?.controller.abort();generation++;clearPoll();token=null;address=null;lastVersion=-1;await stopChild();
    emit({status:'idle',owned:false,target:undefined,url:undefined,targetUrl:undefined,viewId:undefined,session:undefined,error:undefined,selection:null,selectionVersion:0,observations:[],files:[],capabilities:{...EMPTY_CAPABILITIES},pageConnected:false,pagePath:null,documentId:null,pageVersion:null});
  }
  async function connect(url) {
    loopbackRuntimeURL(url);replayOperation?.controller.abort();const current=++generation;clearPoll();token=null;address=null;lastVersion=-1;await stopChild();if(current!==generation||disposed)return snapshot();emit({status:'connecting',owned:false,target:undefined,url:undefined,targetUrl:undefined,viewId:undefined,session:undefined,error:undefined,selection:null,selectionVersion:0,observations:[],files:[],capabilities:{...EMPTY_CAPABILITIES},pageConnected:false,pagePath:null,documentId:null,pageVersion:null});
    try {await attach(url,current,false,{id:'external',label:'Connected development server',root:await getRoot(),commandLabel:'Started outside Foundation'});}
    catch(error){if(current===generation&&!disposed)emit({status:'error',error:error.name==='AbortError'?'The target did not respond. Check its URL and try again.':error.message});throw error;}
    return snapshot();
  }
  async function start(targetId='vite:dev') {
    replayOperation?.controller.abort();const current=++generation;clearPoll();token=null;address=null;lastVersion=-1;await stopChild();if(current!==generation||disposed)return snapshot();
    const targets=await discover();if(current!==generation||disposed)return snapshot();const target=targets.find(item=>item.id===targetId);
    if(!target?.available||!target.instrumented){const error=target?.reason||'No supported Vite development target was found.';emit({status:'error',owned:false,target:undefined,url:undefined,targetUrl:undefined,viewId:undefined,session:undefined,error,selection:null,selectionVersion:0,observations:[],files:[],capabilities:{...EMPTY_CAPABILITIES},pageConnected:false,pagePath:null,documentId:null,pageVersion:null});throw new Error(error);}
    const port=await freePort();const root=await getRoot();if(current!==generation||disposed)return snapshot();
    const vite=path.join(path.dirname(createRequire(path.join(root,'package.json')).resolve('vite/package.json')),'bin/vite.js');
    emit({status:'starting',owned:true,target,error:undefined,url:undefined,targetUrl:undefined,viewId:undefined,session:undefined,selection:null,selectionVersion:0,observations:[],files:[],capabilities:{...EMPTY_CAPABILITIES},pageConnected:false,pagePath:null,documentId:null,pageVersion:null});
    if(current!==generation||disposed)return snapshot();
    const environment={...process.env,ELECTRON_RUN_AS_NODE:'1',FOUNDATION_RUNTIME_TOKEN:randomBytes(32).toString('hex')};
    // Provider secrets never enter the project development process.
    for(const key of Object.keys(environment))if(/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key))delete environment[key];
    let exited=false,spawnError=null;
    const args=[vite,'--host','127.0.0.1','--port',String(port),'--strictPort'];
    // This hook is host-owned; renderer messages cannot select an executable or environment.
    let processHandle;
    try {processHandle=launchProcess?await launchProcess({root,nodePath,args,token:environment.FOUNDATION_RUNTIME_TOKEN}):spawn(nodePath,args,{cwd:root,env:environment,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});}
    catch(error){if(current===generation&&!disposed)emit({status:'error',owned:false,error:error.message||'The isolated development process could not start.'});throw error;}
    if(current!==generation||disposed){await terminateChild(processHandle);return snapshot();}
    child=processHandle;
    // Drain project logs without retaining potentially sensitive output in product state.
    processHandle.stdout?.on('data',()=>{});processHandle.stderr?.on('data',()=>{});
    processHandle.once('error',error=>{spawnError=error;exited=true;});
    processHandle.once('exit',()=>{exited=true;if(child===processHandle&&!disposed) {clearPoll();emit({status:'disconnected',owned:false,error:'The development process stopped. Start it again to reconnect.'});}});
    const deadline=Date.now()+startupTimeoutMs;let lastError;
    while(Date.now()<deadline&&!exited&&current===generation&&!disposed){
      try {await attach(`http://127.0.0.1:${port}/`,current,true,target);return snapshot();}
      catch(error){lastError=error;if(/different project|no Foundation instrumentation/.test(error.message))break;await pause(150);}
    }
    if(current!==generation||disposed)return snapshot();
    await stopChild();
    const message=spawnError?'The development process could not start. Check the Node runtime and project dependencies.':lastError?.message.includes('no Foundation instrumentation')?lastError.message:'The development server could not start. Check its Vite configuration and dependencies.';
    emit({status:'error',owned:false,error:message});throw new Error(message);
  }
  async function navigate(route) {
    const pathname=safeScreenRoute(route);
    if(disposed||state.status!=='connected'||!address||!state.session)throw new Error('Connect a development target before opening a screen.');
    if(!state.capabilities.routeTracking)throw new Error('Update the Foundation development plugin and restart this target to track screens.');
    const destination=new URL(pathname,address),session=state.session,owned=state.owned,target=state.target;
    replayOperation?.controller.abort();const current=++generation;clearPoll();token=null;address=null;lastVersion=-1;
    emit({status:'connecting',error:undefined,selection:null,selectionVersion:0,observations:[],files:[],viewId:undefined,url:undefined,targetUrl:destination.href,pageConnected:false,pagePath:null,documentId:null,pageVersion:null});
    if(current!==generation||disposed)return snapshot();
    try {await attach(destination.href,current,owned,target,session);}
    catch(error){if(current!==generation||disposed)return snapshot();emit({status:'disconnected',error:error.name==='AbortError'?'The screen could not connect. Reconnect the target.':error.message});throw error;}
    return snapshot();
  }
  // Explicit fresh evidence for capture guards. It never publishes an older
  // concurrent response into the normal polling stream or changes its timer.
  async function readCurrent() {
    if(disposed || state.status!=='connected' || !address || !token)throw new Error('Connect a runtime before capturing its preview.');
    const current=generation, expectedView=viewId, expectedSession=state.session, endpoint=new URL('/__foundation/snapshot',address);
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),2500);timeout.unref?.();
    try {
      const raw=await jsonRequest(endpoint,token,controller.signal,expectedView),clean=await validate(raw,expectedSession,expectedView);
      if(disposed || current!==generation || viewId!==expectedView || state.session!==expectedSession)throw new Error('The runtime changed during capture validation.');
      return {...snapshot(),...clean};
    } finally {clearTimeout(timeout);}
  }
  const replayReason = reason => ['cancelled','runtime-changed','callback-failed','unit-timeout','lease-expired','registration-changed','source-changed','document-hidden','conditions-changed'].includes(reason)?reason:'replay-unavailable';
  async function replay(input,{signal,onProgress=async()=>{}}={}) {
    let request;try{request=replayProtocol.request(input);}catch{return {status:'interrupted',reason:'replay-unavailable'};}
    if(signal?.aborted)return {status:'cancelled',reason:'cancelled'};
    if(replayOperation||disposed||state.status!=='connected'||!address||!token)return {status:'interrupted',reason:'replay-unavailable'};
    const current=generation,expectedView=viewId,expectedSession=state.session,endpoint=new URL('/__foundation/replay',address),secret=token,controller=new AbortController();
    const operation={controller,executionId:request.executionId};replayOperation=operation;
    let reserved=false,observed,progressFailure=false,transportFailure=false,cancelPromise;
    const cancelRemote=()=>cancelPromise||=(async()=>{const cancel=new AbortController(),timer=setTimeout(()=>cancel.abort(),2000);try{await jsonRequest(endpoint,secret,cancel.signal,expectedView,{action:'cancel',executionId:request.executionId});}catch{}finally{clearTimeout(timer);}})();
    controller.signal.addEventListener('abort',()=>{if(reserved)void cancelRemote();},{once:true});
    const abort=()=>{controller.abort();};signal?.addEventListener('abort',abort,{once:true});
    const owner=clean=>{
      const live=clean||state,i=request.identity,c=live.replayCatalog;
      return !disposed&&!controller.signal.aborted&&current===generation&&viewId===expectedView&&state.session===expectedSession&&live.status==='connected'&&live.pageConnected&&live.session===i.session&&live.viewId===i.viewId&&live.documentId===i.documentId&&live.pagePath===i.route&&live.pageVersion===i.pageVersion&&live.capabilities.scenarioReplay&&!live.replayBlocked&&c?.registrationId===request.registrationId&&c?.digest===request.catalogDigest;
    };
    const check=()=>{if(!owner())throw new Error('replay-invalidated');};
    const post=async body=>{check();const timeout=setTimeout(()=>controller.abort(),2500);try{return await jsonRequest(endpoint,secret,controller.signal,expectedView,body);}catch{transportFailure=true;throw new Error('replay-transport');}finally{clearTimeout(timeout);}};
    const checked=async()=>{check();const fresh=await readCurrent();if(!owner(fresh))throw new Error('replay-invalidated');return fresh;};
    const cleanResult=value=>{
      if(!value||value.executionId!==request.executionId||!['running','completed','failed','cancelled','interrupted'].includes(value.status)||!Number.isInteger(value.next)||value.next<0||value.next>13||!Array.isArray(value.receipts)||value.receipts.length>13)throw new Error('replay-invalid-response');
      const receipts=value.receipts.map((item,index)=>{const phase=index===0?{phase:'prepare'}:{phase:'step',stepId:recipe.steps[index-1]?.id};
        if(!item||item.commandId!==`${request.executionId}:${index}`||!['completed','failed','cancelled','interrupted'].includes(item.status)||item.phase!==phase.phase||item.stepId!==phase.stepId)throw new Error('replay-invalid-response');
        return {...phase,commandId:item.commandId,status:item.status,observed:replayProtocol.observed(item.observed)};
      });
      if(receipts.length&&receipts.slice(0,-1).some(item=>item.status!=='completed')||value.next!==receipts.filter(item=>item.status==='completed').length||value.status==='completed'&&(value.next!==recipe.steps.length+1||receipts.some(item=>item.status!=='completed')))throw new Error('replay-invalid-response');
      return {status:value.status,reason:replayReason(value.reason),receipts};
    };
    const terminal=value=>{observed=value.receipts.at(-1)?.observed||observed;return {status:value.status,...(value.status==='completed'?{}:{reason:value.reason}),...(observed?{observed}:{} )};};
    let recipe;
    try{
      const fresh=await checked();recipe=fresh.replayCatalog.recipes.find(r=>r.id===request.recipeId&&r.route===request.identity.route);if(!recipe)throw new Error('replay-invalidated');
      // Reservation never invokes app callbacks. The host persists each running unit before dispatch.
      reserved=true;let result=cleanResult(await post({action:'reserve',request}));if(result.status!=='running')return terminal(result);
      const units=[{phase:'prepare'},...recipe.steps.map(s=>({phase:'step',stepId:s.id}))];
      for(let index=0;index<units.length;index++){
        await checked();try{await onProgress({...units[index],status:'running'});}catch{progressFailure=true;throw new Error('replay-progress');}
        await checked();result=cleanResult(await post({action:'dispatch',executionId:request.executionId,unit:units[index]}));
        const deadline=Date.now()+REPLAY_LIMITS.unitMs+3000;
        while(result.status==='running'&&!result.receipts[index]){check();if(Date.now()>deadline)throw new Error('replay-timeout');await pause(100);result=cleanResult(await post({action:'read',executionId:request.executionId}));}
        if(result.status!=='running')return terminal(result);
        const receipt=result.receipts[index];if(!receipt||receipt.status!=='completed')throw new Error('replay-invalid-response');observed=receipt.observed;
        await checked();try{await onProgress({...units[index],status:'completed',observed});}catch{progressFailure=true;throw new Error('replay-progress');}
        await checked();
      }
      result=cleanResult(await post({action:'finish',executionId:request.executionId}));if(result.status!=='completed')return terminal(result);
      await checked();return {status:'completed',...(observed?{observed}:{})};
    }catch{
      // Polling may observe a terminal reload latch before this request reads its
      // receipt. Recover only a terminal failure for this exact execution, never dispatch.
      if(reserved&&recipe&&!signal?.aborted&&!progressFailure){
        const recovery=new AbortController(),timeout=setTimeout(()=>recovery.abort(),1000);
        try{const settled=cleanResult(await jsonRequest(endpoint,secret,recovery.signal,expectedView,{action:'read',executionId:request.executionId}));if(['failed','cancelled','interrupted'].includes(settled.status))return terminal(settled);}catch{}finally{clearTimeout(timeout);}
      }
      if(reserved)await cancelRemote();
      return {status:signal?.aborted?'cancelled':'interrupted',reason:signal?.aborted?'cancelled':progressFailure?'progress-unavailable':transportFailure?'transport-unavailable':'runtime-changed',...(observed?{observed}:{})};
    }finally{signal?.removeEventListener('abort',abort);if(replayOperation===operation)replayOperation=null;}
  }
  async function cancelReplay(executionId){if(replayOperation&&(!executionId||replayOperation.executionId===executionId))replayOperation.controller.abort();}
  async function dispose(){if(disposed)return;disposed=true;await stop();}
  return {discover,start,connect,navigate,stop,snapshot,readCurrent,replay,cancelReplay,dispose};
}
