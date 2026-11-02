import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer as createNetServer} from 'node:net';
import {createServer} from 'node:http';
import {readFile,writeFile,appendFile,mkdir,mkdtemp,realpath,open,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {chromium} from '@playwright/test';
import {prepareRealProjectFixture} from './real-project-fixture.mjs';

export function enduranceProfile(args){
 assert.equal(args.length,1,'Usage: node desktop/scripts/editor-endurance.mjs --minutes=10|120|--activation-probe');
 const base={cycleIntervalMs:60000,phaseKeys:600,cadenceMs:50,history:true,maxCycleGapMs:90000,warmupKeys:160,providerDelta:'x ',providerIntervalMs:50,observerCap:4096};
 if(args[0]==='--activation-probe')return Object.freeze({...base,name:'assistant-activation-probe',activationAttempts:120,minutes:0,durationMs:0,phaseKeys:0,warmupKeys:0,maxCycles:121});
 assert.match(args[0],/^--minutes=(10|120)$/);const minutes=Number(args[0].split('=')[1]);
 return Object.freeze({...base,name:'real-project-endurance',minutes,durationMs:minutes*60000,maxCycles:minutes+1});
}
async function main(){
const profile=enduranceProfile(process.argv.slice(2));
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.dirname(desktop);
const app=await realpath(process.env.FOUNDATION_APP_PATH||path.join(desktop,'.build/Foundation.app'));
const extensionPath=await realpath(path.join(app,'Contents/Resources/app/extensions/foundation-workspace'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const version=JSON.parse(await readFile(path.join(extensionPath,'package.json'),'utf8')).version;
const reportName=process.env.FOUNDATION_ENDURANCE_REPORT_NAME||`editor-endurance-${profile.minutes}m-v${version}-${new Date().toISOString().replace(/[^0-9TZ]/g,'')}.json`;assert.match(reportName,/^[a-zA-Z0-9.-]+\.json$/);try{await readFile(path.join(desktop,'.build',reportName));throw Error('Report already exists; choose a new FOUNDATION_ENDURANCE_REPORT_NAME');}catch(error){if(error.code!=='ENOENT')throw error;}
const harnessHashes=Object.fromEntries(await Promise.all(['scripts/editor-endurance.mjs','scripts/real-project-fixture.mjs','tests/native-editor-endurance.cjs'].map(async name=>[name,hash(await readFile(path.join(desktop,name)))])));
const payloads={};async function payloadScan(dir,into=payloads){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await payloadScan(file,into);else if(entry.isFile())into[path.relative(extensionPath,file)]=hash(await readFile(file));}}
for(const name of ['dist','media','themes'])await payloadScan(path.join(extensionPath,name));payloads['package.json']=hash(await readFile(path.join(extensionPath,'package.json')));
const temp=await realpath(await mkdtemp('/private/tmp/foundation-editor-endurance-'));
const workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions'),harness=path.join(extensions,'foundation-test.editor-endurance-1.0.0'),reportPath=path.join(temp,'native-report.json'),ipc=path.join(temp,'ipc'),outcome=path.join(temp,'outcome.json');
await Promise.all([mkdir(path.join(userData,'User'),{recursive:true}),mkdir(harness,{recursive:true}),mkdir(ipc),mkdir(path.join(temp,'cycles')),mkdir(path.join(temp,'activations'))]);
const fixture=await prepareRealProjectFixture({repo,extensionPath,temp,workspace,userData});
await promisify(execFile)('/bin/cp',['-cR',path.join(repo,'node_modules'),path.join(workspace,'node_modules')]);
await Promise.all([
 writeFile(path.join(userData,'User/settings.json'),JSON.stringify({'foundation.openOnStartup':false,'foundation.ai.baseUrl':'','foundation.ai.model':'','foundation.ai.profiles':{},'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never','window.dialogStyle':'custom','security.workspace.trust.enabled':false,'files.hotExit':'onExitAndWindowClose','files.autoSave':'off','workbench.editor.enablePreview':false,'workbench.colorTheme':'Foundation Dark','editor.inlineSuggest.enabled':true,'editor.quickSuggestions':false,'editor.suggestOnTriggerCharacters':false,'editor.autoClosingQuotes':'never','editor.autoClosingBrackets':'never','editor.acceptSuggestionOnEnter':'off','editor.accessibilitySupport':'off','editor.wordWrap':'off','editor.minimap.enabled':false,'window.zoomLevel':0})),
 writeFile(path.join(harness,'package.json'),JSON.stringify({name:'editor-endurance',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),
 writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-editor-endurance.cjs'))),
 writeFile(path.join(temp,'fixture.json'),JSON.stringify(fixture)),
]);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),readJSON=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return undefined;}};
let cancelled=false;const cancel=()=>{cancelled=true;writeFile(path.join(ipc,'cancel.json'),JSON.stringify({cancelled:true,at:Date.now()})).catch(()=>{});};process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
const wait=async(check,label,timeout=45000)=>{const deadline=performance.now()+timeout;let last;while(performance.now()<deadline){if(cancelled)throw Error('Endurance run cancelled');try{const result=await check();if(result)return result;}catch(e){last=e;}await pause(25);}throw Error(`Timed out ${label}${last?`: ${last.message}`:''}`);};
const settingsHash=hash(await readFile(path.join(userData,'User/settings.json'))),providerRequests=[];
const provider=createServer(async(req,res)=>{try{assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,undefined);const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;assert.ok(bytes<=128*1024);chunks.push(chunk);}const body=JSON.parse(Buffer.concat(chunks));assert.equal(body.model,'foundation-local-endurance-fixture');assert.equal(body.tools,undefined);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_UNRELATED|PRIVATE_UNSAVED/);assert.ok(providerRequests.length<profile.maxCycles+1,'Bounded provider windows');const record={index:providerRequests.length,startedAt:Date.now(),startedMono:performance.now(),chunks:0};providerRequests.push(record);res.writeHead(200,{'Content-Type':'text/event-stream'});const interval=setInterval(()=>{if(res.destroyed)return;record.chunks++;res.write(`data: ${JSON.stringify({model:body.model,choices:[{delta:{content:profile.providerDelta},finish_reason:null}]})}\n\n`);},profile.providerIntervalMs);res.on('close',()=>{clearInterval(interval);record.closedAt=Date.now();record.durationMs=performance.now()-record.startedMono;});}catch(error){providerRequests.push({fixtureError:error.message});res.writeHead(400).end();}});
let providerURL,port,apiPort,runtimePort,runtimeURL;
const freePort=async()=>{const s=createNetServer();await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));const p=s.address().port;await new Promise(resolve=>s.close(resolve));return p;};

const environment={...process.env,FOUNDATION_ENDURANCE_OUTCOME:outcome,FOUNDATION_ENDURANCE_REPORT:reportPath,FOUNDATION_ENDURANCE_IPC:ipc,FOUNDATION_ENDURANCE_EXTENSION:extensionPath,FOUNDATION_ENDURANCE_WORKSPACE:workspace,FOUNDATION_ENDURANCE_PROFILE:JSON.stringify(profile),FOUNDATION_ENDURANCE_FIXTURE:path.join(temp,'fixture.json')};
for(const key of Object.keys(environment))if(key==='ELECTRON_RUN_AS_NODE'||/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|AZURE_OPENAI_API_KEY)$/.test(key))delete environment[key];
Object.assign(environment,{FOUNDATION_AI_MODEL:'foundation-local-endurance-fixture',FOUNDATION_AI_PROVIDER_KIND:'compatible'});
const owned=[];const groupAlive=pid=>{if(!pid)return false;try{process.kill(-pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};const signalGroup=(pid,signal)=>{if(!pid)return;try{process.kill(-pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};async function spawnOwned(name,executable,args){const log=await open(path.join(temp,`${name}.log`),'w');const proc=spawn(executable,args,{cwd:workspace,env:environment,detached:true,stdio:['ignore',log.fd,log.fd]});const record={name,proc,pid:proc.pid,exited:false};proc.once('exit',(code,signal)=>Object.assign(record,{exited:true,code,signal}));proc.once('error',error=>Object.assign(record,{exited:true,error:error.message}));owned.push(record);await log.close();return record;}
let cancelWatch;let browser,child,runtimePage,exited=false,exitCode,spawnError;const phases=[],surfaces={},appStages=[];
const targetCommand = async (browser, targetId, method, params = {}) => {
  const rootSession = await browser.newBrowserCDPSession(); let sessionId, listener, detachedListener, timeout;const contexts=[];
  try {
    sessionId = (await rootSession.send('Target.attachToTarget', { targetId, flatten: false })).sessionId;
    const response = new Promise((resolve, reject) => {
      listener = event => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message);if(message.method==='Runtime.executionContextCreated')contexts.push(message.params.context); if (message.id !== 1) return;
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      };
      detachedListener = event => { if (event.sessionId === sessionId) reject(new Error(`Native renderer detached during ${method}`)); };
      rootSession.on('Target.receivedMessageFromTarget', listener); rootSession.on('Target.detachedFromTarget', detachedListener);
      timeout = setTimeout(() => reject(new Error(`Native renderer command timed out: ${method}`)), 10000);
    });
    const [, result] = await Promise.all([rootSession.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method, params }) }), response]);
    return method==='Runtime.enable'?{...result,contexts}:result;
  } finally {
    if (listener) rootSession.off('Target.receivedMessageFromTarget', listener);
    if (detachedListener) rootSession.off('Target.detachedFromTarget', detachedListener);
    clearTimeout(timeout);
    if (sessionId) await rootSession.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    await rootSession.detach();
  }
};
const evaluate = async (browser, frame, expression) => {
  const result = await targetCommand(browser, frame.targetId, 'Runtime.evaluate', { expression, contextId: frame.contextId, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const surfaceFrame = async (browser, surface) => wait(async () => {
  const session = await browser.newBrowserCDPSession(); let targets;
  try { targets = (await session.send('Target.getTargets')).targetInfos; } finally { await session.detach(); }
  const candidates = targets.filter(target => target.url.startsWith('vscode-webview://'));
  const matches = [];
  for (const target of candidates) {
    try {
      const { frameTree } = await targetCommand(browser, target.targetId, 'Page.getFrameTree');
      const visit = async node => {
        const { executionContextId } = await targetCommand(browser, target.targetId, 'Page.createIsolatedWorld', { frameId: node.frame.id, worldName: 'foundationModesSmoke' });
        const frame = { targetId: target.targetId, contextId: executionContextId };
        if (await evaluate(browser, frame, 'document.body?.dataset.foundationSurface') === surface) matches.push(frame);
        for (const child of node.childFrames || []) await visit(child);
      };
      await visit(frameTree);
    } catch {}
  }
  assert.ok(matches.length <= 1, `Only one live ${surface} surface may exist`);
  return matches[0];
}, `actual native ${surface} renderer`);
// Use the embedded preview's default world: its fetch wrapper owns real runtime evidence.
const embeddedRuntimeFrame=async(browser,url)=>wait(async()=>{
 const session=await browser.newBrowserCDPSession();let targets;try{targets=(await session.send('Target.getTargets')).targetInfos;}finally{await session.detach();}
 const matches=[];
 for(const target of targets.filter(t=>t.url.startsWith('vscode-webview://')||t.url===url))try{
  const {frameTree}=await targetCommand(browser,target.targetId,'Page.getFrameTree'),nodes=[];const visit=n=>{if(n.frame.url===url)nodes.push(n.frame);for(const child of n.childFrames||[])visit(child);};visit(frameTree);if(!nodes.length)continue;
  const {contexts}=await targetCommand(browser,target.targetId,'Runtime.enable');
  for(const frame of nodes){const context=contexts.find(c=>c.auxData?.isDefault&&c.auxData.frameId===frame.id);if(context)matches.push({targetId:target.targetId,contextId:context.id,frameId:frame.id});}
 }catch{}
 const unique=[...new Map(matches.map(m=>[m.frameId,m])).values()];assert.ok(unique.length<=1,'Only one embedded runtime document may own the benchmark');return unique[0];
},'embedded runtime default execution context');
let runtimeMonitor;
const monitorRuntime=async(browser,frame)=>{
 const root=await browser.newBrowserCDPSession(),sessionId=(await root.send('Target.attachToTarget',{targetId:frame.targetId,flatten:false})).sessionId;
 let events=[],pending=new Map(),statuses=new Map(),recording=false,overflow=0,highWater=0;const cap=2048;
 const listener=event=>{if(event.sessionId!==sessionId)return;const message=JSON.parse(event.message),data=message.params;
  if(message.method==='Network.requestWillBeSent'&&data.request.url.endsWith('/__foundation/events')&&data.request.postData&&recording){try{const body=JSON.parse(data.request.postData);const item={requestId:data.requestId,at:Date.now(),kind:body.type,session:body.session,viewId:body.viewId,documentId:body.documentId,url:body.url,method:body.method};if(statuses.has(data.requestId))Object.assign(item,statuses.get(data.requestId));if(events.length>=cap){overflow++;return;}events.push(item);pending.set(data.requestId,item);highWater=Math.max(highWater,events.length,pending.size,statuses.size);}catch{}}
  if(message.method==='Network.responseReceived'||message.method==='Network.responseReceivedExtraInfo'){const result={status:data.response?.status??data.statusCode,responseAt:Date.now(),statusEvent:message.method};if(pending.has(data.requestId)){Object.assign(pending.get(data.requestId),result);pending.delete(data.requestId);}}
  if(message.method==='Network.loadingFailed'&&pending.has(data.requestId)){pending.get(data.requestId).networkFailure=data.errorText;pending.delete(data.requestId);}
 };
 root.on('Target.receivedMessageFromTarget',listener);await root.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:1,method:'Network.enable'})});
 return{get events(){return events;},begin(){events=[];pending.clear();statuses.clear();recording=true;},end(){recording=false;const result={cap,events:events.length,pending:pending.size,statuses:statuses.size,overflow,highWater};assert.equal(overflow,0,'Instrumentation observer overflow');return result;},async close(){root.off('Target.receivedMessageFromTarget',listener);await root.send('Target.detachFromTarget',{sessionId}).catch(()=>{});await root.detach();}};
};
const control = (selector, code) => `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Native control is missing'); ${code} })()`;
// Diagnostic-only instrumentation around the original native Space gesture.
// These records belong only to this disposable fixture; never replay a send.
let activationSequence=0;
function installActivationDiagnostics(selector){
 window.__foundationActivationDiagnostics?.dispose();
 const cap=512,events=[],nodes=new WeakMap(),listeners=[];let serial=0,total=0,dropped=0,observer,lastDOMBasis;
 const identity=node=>{
  if(!(node instanceof Element))return null;
  if(!nodes.has(node))nodes.set(node,++serial);
  return{node:nodes.get(node),tag:node.tagName,id:node.id||null,className:String(node.className||'').slice(0,160),connected:node.isConnected,
   disabled:'disabled'in node?Boolean(node.disabled):null,ariaDisabled:node.getAttribute('aria-disabled'),role:node.getAttribute('role'),
   label:node.getAttribute('aria-label'),artifactFocus:node.dataset.artifactFocus||null,contextPath:node.dataset.contextPath||null,
   checked:'checked'in node?Boolean(node.checked):null};
 };
 const snapshot=()=>{
  const control=document.querySelector(selector),composer=document.querySelector('textarea[aria-label="Ask about your source"]');
  return{hasFocus:document.hasFocus(),visibility:document.visibilityState,control:identity(control),active:identity(document.activeElement),
   controlText:control?.textContent?.trim().slice(0,160)||null,composer:identity(composer),question:composer?.value??null,questionLength:composer?.value?.length??null,
   selectionStart:composer?.selectionStart??null,selectionEnd:composer?.selectionEnd??null,
   blocker:document.querySelector('.composer-guidance')?.textContent?.trim().slice(0,1000)||null,
   selectedSources:[...document.querySelectorAll('input[data-context-path]:checked')].slice(0,16).map(input=>({path:input.dataset.contextPath,
    revision:input.dataset.revision||input.dataset.contextRevision||input.closest('[data-revision]')?.dataset.revision||null,disabled:input.disabled})),
   disclosureOpen:document.querySelector('details.assistant-setup')?.open??null};
 };
 const retain=record=>{total++;if(events.length===cap){events.shift();dropped++;}events.push(record);};
 const capture=(type,event,detail)=>{
  const state=snapshot();retain({type,at:Date.now(),mono:performance.now(),...(event?{trusted:event.isTrusted,key:event.key||null,code:event.code||null,
   eventTimestamp:event.timeStamp,defaultPrevented:event.defaultPrevented,targetMatchesControl:Boolean(event.target===document.querySelector(selector)||(event.target instanceof Node&&document.querySelector(selector)?.contains(event.target))),target:identity(event.target),relatedTarget:identity(event.relatedTarget)}:{}),...(detail?{detail}:{}),...state});
 };
 const dispose=()=>{observer?.disconnect();for(const[type,listener,target]of listeners)target.removeEventListener(type,listener,true);if(window.__foundationActivationDiagnostics===api)delete window.__foundationActivationDiagnostics;};
 const api={capture,dispose,routing:()=>events.filter(event=>event.type==='keydown'&&event.trusted&&event.key===' ').map(event=>({targetMatchesControl:event.targetMatchesControl,target:event.target,control:event.control})),finish:()=>{try{capture('finished');return{cap,total,dropped,retained:events.length,events};}finally{dispose();}}};
 window.__foundationActivationDiagnostics=api;
 try{
  for(const type of ['focusin','focusout','keydown','keyup','click','input']){const listener=event=>capture(type,event);document.addEventListener(type,listener,true);listeners.push([type,listener,document]);}
  for(const type of ['focus','blur']){const listener=event=>capture('window-'+type,event);window.addEventListener(type,listener,true);listeners.push([type,listener,window]);}
  const visibility=event=>capture('visibilitychange',event);document.addEventListener('visibilitychange',visibility,true);listeners.push(['visibilitychange',visibility,document]);
  observer=new MutationObserver(()=>{const basis=JSON.stringify(snapshot());if(basis!==lastDOMBasis){lastDOMBasis=basis;capture('dom-change');}});
  observer.observe(document.getElementById('foundation-content')||document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','aria-disabled','class','open','data-revision']});
  capture('installed');return true;
 }catch(error){dispose();throw error;}
}
const pressControl = async (browser, frame, selector, settle) => {
 const sequence=++activationSequence,startedAt=Date.now(),providerRequestsBefore=providerRequests.length;let failure,diagnostic;
 const mark=label=>evaluate(browser,frame,`window.__foundationActivationDiagnostics?.capture(${JSON.stringify(label)});true`);
 try{
  await evaluate(browser,frame,`(${installActivationDiagnostics.toString()})(${JSON.stringify(selector)})`);
  await evaluate(browser, frame, control(selector, 'window.__foundationActivationDiagnostics?.capture("before-focus");element.focus();window.__foundationActivationDiagnostics?.capture("after-focus"); if (document.activeElement !== element) throw new Error("Native control did not receive focus: "+element.outerHTML+"; disclosure="+element.closest("details")?.open+"; rects="+element.getClientRects().length); return true;'));
  await mark('before-keydown-dispatch');
  await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ', unmodifiedText: ' ', windowsVirtualKeyCode: 32 });
  await mark('after-keydown-dispatch');
  await mark('before-keyup-dispatch');
  await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await mark('after-keyup-dispatch');
  const routing=await evaluate(browser,frame,'window.__foundationActivationDiagnostics?.routing()');
  assert.equal(routing?.length,1,'Exactly one trusted activation keydown must reach the intended document');
  assert.equal(routing[0].targetMatchesControl,true,'Activation keydown must reach its intended control; never replay misdirected input');
  if(settle)await settle();
  await mark('settled');
 }catch(error){failure=error;try{await evaluate(browser,frame,`window.__foundationActivationDiagnostics?.capture("failed",null,${JSON.stringify(String(error.message).slice(0,1000))});true`);}catch{}throw error;}
 finally{
  try{diagnostic=await evaluate(browser,frame,'window.__foundationActivationDiagnostics?.finish()||null');}catch(error){diagnostic={captureError:error.message,disposal:'Renderer unavailable; owned app cleanup remains responsible for context disposal'};}
  const record={schema:1,fixtureOnly:true,sequence,selector,startedAt,endedAt:Date.now(),providerRequestsBefore,providerRequestsAfter:providerRequests.length,
   passed:!failure,error:failure?.message,frame,diagnostic,limits:['Passive fixture diagnostics add CDP round trips around an unchanged Space gesture.','DOM source revisions are null when the product does not expose them; no revision is inferred.','A bounded ring retains the latest512 events and reports any overwritten records.']};
  try{await writeFile(path.join(temp,'activations',String(sequence).padStart(4,'0')+'.json'),JSON.stringify(record));}
  catch(error){if(!failure)throw error;console.error('Activation diagnostic write failed: '+error.message);}
 }
};

const summarize=values=>{const data=values.filter(Number.isFinite).sort((a,b)=>a-b),at=p=>data[Math.max(0,Math.ceil(data.length*p)-1)]??null;return{count:data.length,min:data[0]??null,p50:at(.5),p95:at(.95),p99:at(.99),max:data.at(-1)??null};};
const assistant=async(action)=>{
 let frame=surfaces.assistant;
 try{if(frame&&await evaluate(browser,frame,'document.body?.dataset.foundationSurface')!=='assistant')frame=undefined;}catch{frame=undefined;}
 if(!frame)frame=await surfaceFrame(browser,'assistant');surfaces.assistant=frame;
 if(action==='new'){
  await pressControl(browser,frame,'button[data-artifact-focus="conversation-new"]');return;
 }
 if(action==='start'){
  if(!await evaluate(browser,frame,'document.querySelector("details.assistant-setup").open'))await pressControl(browser,frame,'summary[aria-label="Request context and model"]');
  const available=await evaluate(browser,frame,'[...document.querySelectorAll("input[data-context-path]")].map(input=>({path:input.dataset.contextPath,checked:input.checked}))');assert.ok(available.some(item=>item.path===fixture.sourcePath));
  // Optional unchecked documents can close or leave the live source catalog.
  // Only the required source and currently selected rows need interaction.
  for(const item of available.filter(item=>item.checked||item.path===fixture.sourcePath)){
   if(!await evaluate(browser,frame,'document.querySelector("details.assistant-setup").open'))await pressControl(browser,frame,'summary[aria-label="Request context and model"]');
   const selector=`input[data-context-path=${JSON.stringify(item.path)}]`;
   await wait(()=>evaluate(browser,frame,control(selector,'return element.getClientRects().length>0&&!element.disabled;')),'visible source context');
   if(await evaluate(browser,frame,control(selector,'return element.checked;'))!==(item.path===fixture.sourcePath))await pressControl(browser,frame,selector);
  }
  assert.deepEqual(await evaluate(browser,frame,'[...document.querySelectorAll("input[data-context-path]")].filter(input=>input.checked).map(input=>input.dataset.contextPath).sort()'),[fixture.sourcePath],'Only the explicit saved fixture source may be shared');
  await evaluate(browser,frame,control('textarea[aria-label="Ask about your source"]','element.focus();element.select();return true;'));
  await targetCommand(browser,frame.targetId,'Input.insertText',{text:'Describe this saved Foundation source. Local endurance fixture; stop when requested.'});
  await wait(()=>evaluate(browser,frame,'document.querySelector("#ask-submit")?.disabled===false'),'sendable native Assistant');
  const count=providerRequests.length;await pressControl(browser,frame,'#ask-submit',()=>wait(()=>providerRequests.length>count&&providerRequests.at(-1).chunks>1,'real streaming response'));
 }else{
  assert.match(await evaluate(browser,frame,'document.querySelector("#ask-submit")?.textContent||""'),/Stop/);await pressControl(browser,frame,'#ask-submit',()=>wait(()=>providerRequests.at(-1).closedAt,'cancelled loopback stream'));
 }
};
const installProbe=async page=>page.evaluate(()=>{
 window.__foundationPerf?.dispose();
 const state={samples:[],measures:[],longTasks:[],frameGaps:[],overflow:0,highWater:{},active:null,phase:null,longTaskSupported:PerformanceObserver.supportedEntryTypes.includes('longtask')};let previousFrame,raf;const caps={samples:1024,measures:8192,longTasks:4096,frameGaps:16384};const retain=(key,value)=>{if(state[key].length>=caps[key]){state.overflow++;return;}state[key].push(value);state.highWater[key]=Math.max(state.highWater[key]||0,state[key].length);};state.caps=caps;
 const keydown=event=>{if(!state.phase||event.key!=='x'||event.ctrlKey||event.metaKey||event.altKey)return;if(state.active)state.active.overlapped=true;state.active={index:state.samples.length,key:'x',keydownAt:performance.now(),eventTimestamp:event.timeStamp,trusted:event.isTrusted,expectedCount:state.expectedCount};retain('samples',state.active);};
 const observer=new MutationObserver(()=>{const sample=state.active;if(!sample||sample.mutationAt!==undefined)return;const line=[...document.querySelectorAll('.monaco-editor .view-lines .view-line')].find(el=>el.textContent.replace(/\u00a0/g,' ').includes('// PERF_INPUT:'));if(!line)return;const text=line.textContent.replace(/\u00a0/g,' ');const count=(text.split('// PERF_INPUT:')[1]?.match(/^x*/)?.[0]||'').length;if(count!==sample.expectedCount)return;sample.mutationAt=performance.now();requestAnimationFrame(()=>{sample.frameAt=performance.now();if(state.active===sample)state.active=null;});});
 observer.observe(document.querySelector('.monaco-workbench')||document.body,{subtree:true,childList:true,characterData:true});document.addEventListener('keydown',keydown,true);
 const measures=new PerformanceObserver(list=>{if(state.phase)for(const item of list.getEntries().filter(item=>['inputlatency','keydown','input','render'].includes(item.name)))retain('measures',{name:item.name,startTime:item.startTime,duration:item.duration});});measures.observe({type:'measure'});
 let tasks;try{tasks=new PerformanceObserver(list=>{if(state.phase)for(const item of list.getEntries())retain('longTasks',{startTime:item.startTime,duration:item.duration});});tasks.observe({type:'longtask'});}catch{}
 const frame=timestamp=>{if(state.phase&&previousFrame!==undefined)retain('frameGaps',timestamp-previousFrame);previousFrame=timestamp;raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);
 state.dispose=()=>{observer.disconnect();measures.disconnect();tasks?.disconnect();document.removeEventListener('keydown',keydown,true);cancelAnimationFrame(raf);};window.__foundationPerf=state;
});
const attachSurface=async name=>{
 let frame=surfaces[name];try{if(frame&&await evaluate(browser,frame,'document.body?.dataset.foundationSurface')!==name)frame=undefined;}catch{frame=undefined;}
 if(!frame)frame=await surfaceFrame(browser,name);surfaces[name]=frame;
 const visibility=await evaluate(browser,frame,`(() => { if(!window.__foundationStateCounts){window.__foundationStateCounts=[];window.addEventListener('message',event=>{if(event.data?.type==='state'||event.data?.type==='ai'){if(window.__foundationCaptureStates){if(window.__foundationStateCounts.length>=4096)window.__foundationStateOverflow=true;else window.__foundationStateCounts.push({type:event.data.type,timestamp:Date.now()});}(window.__foundationLastStates||={})[event.data.type]=event.data;}});}return {width:innerWidth,height:innerHeight,bodyVisible:document.body.getClientRects().length>0,visibility:document.visibilityState};})()`);
 assert.ok(visibility.bodyVisible&&visibility.width>0&&visibility.height>0&&visibility.visibility==='visible',`${name} surface must be visible`);return visibility;
};
const samplePayloads=async()=>{const sizes={};for(const [name,frame] of Object.entries(surfaces))sizes[name]=await evaluate(browser,frame,`(() => {const states=window.__foundationLastStates||{};window.__foundationLastStates={};return Object.fromEntries(Object.entries(states).map(([type,state])=>[type,{estimatedSerializedBytes:new TextEncoder().encode(JSON.stringify(state)).byteLength}]));})()`);return sizes;};
const rendererResource=async page=>{const session=await page.context().newCDPSession(page);try{return {scope:'Workbench renderer V8 isolate only',at:Date.now(),heap:await session.send('Runtime.getHeapUsage')};}finally{await session.detach();}};
const rendererResources=async page=>{const result={workbench:await rendererResource(page)};for(const [name,frame] of Object.entries(surfaces))result[name]={scope:`${name} renderer process/isolate counters; may share an underlying process`,at:Date.now(),heap:await targetCommand(browser,frame.targetId,'Runtime.getHeapUsage'),dom:await targetCommand(browser,frame.targetId,'Memory.getDOMCounters')};return result;};
const measure=async(page,phase)=>{
 for(const name of ['workspace','assistant']){await attachSurface(name);await evaluate(browser,surfaces[name],'window.__foundationStateCounts=[];window.__foundationStateOverflow=false;window.__foundationCaptureStates=true;');}
 runtimeMonitor?.begin();if(runtimePage)await runtimePage.evaluate(()=>{window.__load.events=[];window.__load.capture=true;});
 const payloadBytesBefore=await samplePayloads(),resourcesBefore=await rendererResources(page);
 console.log(JSON.stringify({event:'phase-start',profile:profile.name,phase,keys:phase==='warmup'?profile.warmupKeys:profile.phaseKeys,temp}));
 await page.evaluate(name=>{const s=window.__foundationPerf;s.samples=[];s.measures=[];s.longTasks=[];s.frameGaps=[];s.overflow=0;s.highWater={};s.active=null;s.phase=name;},phase);
 const count=phase==='warmup'?profile.warmupKeys:profile.phaseKeys,cadenceMs=profile.cadenceMs,startAt=Date.now(),startedMono=performance.now(),driver=[];
 for(let i=0;i<count;i++){
  if(cancelled)throw Error('Endurance run cancelled');
  const started=performance.now(),wallStartedAt=Date.now();
  await page.evaluate(expected=>{window.__foundationPerf.expectedCount=expected;},i+1);
  await page.keyboard.press('x');
  await wait(()=>page.evaluate(()=>window.__foundationPerf.samples.at(-1)?.frameAt),'renderer typed frame',5000);
  driver.push({index:i,wallStartedAt,wallEndedAt:Date.now(),dispatchRoundtripMs:performance.now()-started,providerActive:providerRequests.some(r=>r.startedAt<=wallStartedAt&&!r.closedAt)});
  await pause(Math.max(0,cadenceMs-(performance.now()-started)));
 }
 await pause(40);
 const result=await page.evaluate(()=>{const s=window.__foundationPerf;const result={samples:s.samples,measures:s.measures,longTasks:s.longTasks,frameGaps:s.frameGaps,longTaskSupported:s.longTaskSupported,probeBuffers:{overflow:s.overflow,highWater:s.highWater,caps:s.caps}};s.phase=null;return result;});
 assert.equal(result.probeBuffers.overflow,0,'No input observer overflow');const samples=result.samples;assert.equal(samples.length,count);assert.ok(samples.every(s=>s.trusted&&!s.overlapped&&Number.isFinite(s.mutationAt)&&Number.isFinite(s.frameAt)));
 const native=result.measures.filter(m=>m.name==='inputlatency');
 const correlated=samples.map((sample,i)=>native.filter(m=>m.startTime>=sample.keydownAt&&m.startTime<(samples[i+1]?.keydownAt??sample.frameAt+50)));
 assert.equal(native.length,count,'Every synthetic key must have one upstream input-latency measure');assert.ok(correlated.every(matches=>matches.length===1),'Each upstream measure must match exactly one key window');
 const endedAt=Date.now(),elapsedMonoMs=performance.now()-startedMono;assert.ok(Math.abs((endedAt-startAt)-elapsedMonoMs)<1000,'Wall and monotonic typing duration agree');const resourcesAfter=await rendererResources(page),payloadBytesAfter=await samplePayloads();const stateMessages={};
 const observerBuffers={input:result.probeBuffers};for(const [name,frame] of Object.entries(surfaces)){const captured=await evaluate(browser,frame,`(() => {window.__foundationCaptureStates=false;const result={events:window.__foundationStateCounts.filter(item=>item.timestamp>=${startAt}&&item.timestamp<=${endedAt}),overflow:window.__foundationStateOverflow,retained:window.__foundationStateCounts.length};window.__foundationStateCounts=[];return result;})()`);assert.equal(captured.overflow,false,`${name}: bounded state observer`);stateMessages[name]=captured.events;observerBuffers[name]={retained:captured.retained,cap:4096};}
 const runtimeRequests=runtimePage?await runtimePage.evaluate(({start,end})=>{window.__load.capture=false;if(window.__load.overflow)throw Error('Runtime observer overflow');return window.__load.events.filter(item=>item.startedAt<=end&&(item.completedAt??Date.now())>=start);},{start:startAt,end:endedAt}):[];

 const phaseEvents=runtimeMonitor?runtimeMonitor.events.filter(item=>item.at>=startAt&&item.at<=endedAt):[],settlementStartedAt=Date.now();if(phaseEvents.length)await wait(()=>phaseEvents.every(item=>item.status!==undefined),'settled phase instrumentation responses',1000).catch(()=>{});
 const settledAt=Date.now(),runtimeEvidence=structuredClone(phaseEvents);
 const instrumentationResponseCoverage={settledAt,settlementWaitMs:settledAt-settlementStartedAt,accepted:runtimeEvidence.filter(e=>e.status===202).length,rejected:runtimeEvidence.filter(e=>Number.isFinite(e.status)&&e.status!==202).length,unknown:runtimeEvidence.filter(e=>e.status===undefined).length,networkFailures:runtimeEvidence.filter(e=>e.networkFailure).length};
 observerBuffers.runtime=runtimeMonitor?.end();
 const phaseResult={phase,elapsedMonoMs,observerBuffers,runtimeEvidence,instrumentationResponseCoverage,startedAt:startAt,endedAt,resources:{before:resourcesBefore,after:resourcesAfter},payloadSizes:{before:payloadBytesBefore,after:payloadBytesAfter},stateMessages,runtimeRequests,count,cadenceMs,driver,...result,summary:{eventToDOM:summarize(samples.map(s=>s.mutationAt-s.keydownAt)),eventToNextFrame:summarize(samples.map(s=>s.frameAt-s.keydownAt)),upstreamRendererInput:summarize(native.map(m=>m.duration)),driverDispatchToObservedFrame:summarize(driver.map(s=>s.dispatchRoundtripMs)),frameGaps:summarize(result.frameGaps),longTasks:result.longTaskSupported?result.longTasks.length:null},nativeMeasureCount:native.length,nativeMeasureCoverage:{matched:correlated.length,unmatched:0,missing:0}};
 assert.ok(phaseResult.summary.upstreamRendererInput.p95<50,`${phase}: synthetic renderer p95 below50ms`);
 await writeFile(path.join(temp,'cycles',phase+'.json'),JSON.stringify(phaseResult));const brief={phase,startedAt:startAt,endedAt,count,summary:phaseResult.summary,resources:phaseResult.resources,observerBuffers};phases.push(brief);assert.ok(phases.length<=profile.maxCycles+1);await appendFile(path.join(temp,'cycles.jsonl'),JSON.stringify(brief)+'\n');console.log(JSON.stringify({event:'phase-end',profile:profile.name,phase,keys:count,durationMs:endedAt-startAt,upstream:phaseResult.summary.upstreamRendererInput}));return phaseResult;
};
let currentStage,runFailure,nativeReport;
const runStage=async stage=>{
 currentStage=stage;if((await readJSON(path.join(ipc,'cancel.json')))?.cancelled===true)cancelled=true;if(cancelled)throw Error('Endurance run cancelled before stage launch');await rm(outcome,{force:true});for(const name of await readdir(ipc))if(name!=='cancel.json')await rm(path.join(ipc,name));
 exited=false;exitCode=undefined;spawnError=undefined;environment.FOUNDATION_ENDURANCE_STAGE=stage;
 const log=await open(path.join(temp,`native-${stage}.log`),'w');child=spawn(path.join(app,'Contents/MacOS/Foundation'),[workspace,'--new-window','--user-data-dir',userData,'--shared-data-dir',path.join(temp,'shared-data'),'--extensions-dir',extensions,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--disable-crash-reporter','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{env:environment,detached:true,stdio:['ignore',log.fd,log.fd]});const stageProcess={stage,pid:child.pid,exited:false};appStages.push(stageProcess);child.once('exit',(code,signal)=>{exited=true;exitCode=code;Object.assign(stageProcess,{exited:true,code,signal});});child.once('error',error=>{exited=true;spawnError=error;Object.assign(stageProcess,{exited:true,error:error.message});});await log.close();
 const deadline=performance.now()+(stage==='restart'?120000:profile.activationAttempts?600000:profile.durationMs+300000);let index=1,result;
 while(!(result=await readJSON(outcome))){
  if(cancelled)throw Error('Endurance run cancelled');if(spawnError)throw spawnError;if(exited)throw Error('Disposable app exited early');if(performance.now()>deadline)throw Error('Endurance native stage deadline exceeded');if(owned.some(item=>item.exited))throw Error('Owned real-project server exited');
  const request=await readJSON(path.join(ipc,`command-${index}.json`));if(!request){await pause(25);continue;}
  let answer;try{
   if(!browser)browser=await wait(()=>chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000}),'native renderer');
   const page=await wait(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('vscode-file:')),'workbench');
   if(request.type==='setup'){await installProbe(page);const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,devicePixelRatio}));assert.deepEqual(viewport,{width:1440,height:900,devicePixelRatio:2});const visibility={};for(const name of ['workspace','assistant'])visibility[name]=await attachSurface(name);answer={viewport,visibility};}
   else if(request.type==='ai')await assistant(request.action);
   else if(request.type==='runtime-start'){
    const frame=await embeddedRuntimeFrame(browser,request.url);runtimeMonitor=await monitorRuntime(browser,frame);runtimeMonitor.begin();runtimePage={evaluate:async(fn,arg)=>evaluate(browser,frame,`(${fn.toString()})(${JSON.stringify(arg)??'undefined'})`)};
    const frontendReady=await wait(()=>runtimePage.evaluate(()=>{const app=document.querySelector('[data-testid="project-workbench"]'),heading=[...document.querySelectorAll('h1,h2,h3')].find(item=>item.textContent.trim()==='SaveButton');return window.__foundationRuntimeInstalled===true&&app?.getClientRects().length&&heading?.getClientRects().length&&!document.body.innerText.includes('Opening Foundation…')?{projectWorkbenchVisible:true,heading:heading.textContent.trim(),instrumented:true,loadingShell:false}:null;}),'loaded real Foundation project workbench and source heading');
    await runtimePage.evaluate(({pingPath,pingMethod})=>{window.__load={started:0,completed:0,errors:0,events:[],capture:false,overflow:0,lastCompletedAt:null,maxCompletionGapMs:0};window.__load.timer=setInterval(()=>{if(window.__load.started-window.__load.completed-window.__load.errors>=128){window.__load.overflow++;clearInterval(window.__load.timer);return;}const event={startedAt:Date.now()};if(window.__load.capture){if(window.__load.events.length>=2048)window.__load.overflow++;else window.__load.events.push(event);}window.__load.started++;fetch(pingPath,{method:pingMethod}).then(async r=>{event.status=r.status;await r.arrayBuffer();event.completedAt=Date.now();if(window.__load.lastCompletedAt!==null)window.__load.maxCompletionGapMs=Math.max(window.__load.maxCompletionGapMs,event.completedAt-window.__load.lastCompletedAt);window.__load.lastCompletedAt=event.completedAt;if(r.status===200)window.__load.completed++;else window.__load.errors++;}).catch(()=>{event.error=true;event.completedAt=Date.now();window.__load.errors++;});},140);},{pingPath:fixture.runtime.pingPath,pingMethod:fixture.runtime.pingMethod});
    await wait(()=>runtimeMonitor.events.some(item=>item.kind==='request'&&item.status===202&&item.method===fixture.runtime.pingMethod&&new URL(item.url).pathname===fixture.runtime.pingPath),'accepted embedded real runtime evidence');
    answer={runtimeOwner:runtimeMonitor.events.find(item=>item.kind==='request'&&item.status===202&&item.method===fixture.runtime.pingMethod&&new URL(item.url).pathname===fixture.runtime.pingPath),previewViewId:new URL(request.url).searchParams.get('__foundation_view'),frameId:frame.frameId,frontendReady};runtimeMonitor.end();
   }else if(request.type==='runtime-inspect')answer=await runtimePage.evaluate(()=>({started:window.__load.started,completed:window.__load.completed,errors:window.__load.errors,lastCompletedAt:window.__load.lastCompletedAt,maxCompletionGapMs:window.__load.maxCompletionGapMs,overflow:window.__load.overflow}));
   else if(request.type==='runtime-stop'){await runtimePage.evaluate(()=>clearInterval(window.__load.timer));await wait(()=>runtimePage.evaluate(()=>window.__load.started===window.__load.completed+window.__load.errors),'settled requests',5000);answer=await runtimePage.evaluate(()=>({started:window.__load.started,completed:window.__load.completed,errors:window.__load.errors,maxCompletionGapMs:window.__load.maxCompletionGapMs,pending:window.__load.started-window.__load.completed-window.__load.errors}));await runtimeMonitor.close();runtimeMonitor=null;runtimePage=null;}
   else if(request.type==='measure'){assert.match(request.phase,/^(warmup|cycle-\d{3})$/);answer=await measure(page,request.phase);}
   else if(request.type==='capture'){await page.screenshot({path:path.join(temp,'workspace.png')});answer={};}
   else assert.equal(request.type,'inspect');
   answer={...answer,passed:true,providerRequests:providerRequests.length};
  }catch(error){answer={passed:false,error:error.stack||String(error)};}
  await writeFile(path.join(ipc,`result-${index}.json`),JSON.stringify(answer));index++;
 }
 assert.equal(result.passed,true,result.error);while(!exited&&performance.now()<deadline)await pause(100);assert.equal(exited,true);assert.equal(exitCode,0);await browser?.close().catch(()=>{});browser=null;
};
try{
 if(cancelled)throw Error('Endurance run cancelled');await new Promise((resolve,reject)=>{provider.once('error',reject);provider.listen(0,'127.0.0.1',resolve);});providerURL=`http://127.0.0.1:${provider.address().port}/v1`;port=await freePort();apiPort=await freePort();runtimePort=await freePort();runtimeURL=`http://127.0.0.1:${runtimePort}`;Object.assign(environment,{FOUNDATION_AI_BASE_URL:providerURL,FOUNDATION_ENDURANCE_API_PORT:String(apiPort),FOUNDATION_ENDURANCE_FRONTEND_PORT:String(runtimePort),FOUNDATION_ENDURANCE_RUNTIME:runtimeURL});
 cancelWatch=setInterval(async()=>{if((await readJSON(path.join(ipc,'cancel.json')))?.cancelled===true)cancelled=true;},500);cancelWatch.unref();
 await spawnOwned('real-api',process.execPath,[fixture.runtime.apiModulePath]);
 await wait(async()=>{try{return(await fetch(`http://127.0.0.1:${apiPort}/api/workspace`,{signal:AbortSignal.timeout(1000)})).status===200;}catch{return false;}},'real API ready');
 await spawnOwned('real-vite',process.execPath,[path.join(workspace,'node_modules/vite/bin/vite.js'),'--config',fixture.runtime.configPath,'--host','127.0.0.1','--port',String(runtimePort),'--strictPort']);
 await wait(async()=>{try{return(await fetch(runtimeURL,{signal:AbortSignal.timeout(1000)})).status===200;}catch{return false;}},'real Vite ready');
 console.log(JSON.stringify({event:'fixture-ready',profile,version,temp,driverPID:process.pid,cancelPath:path.join(ipc,'cancel.json'),sourceFiles:fixture.manifest.files.length,expectedInventory:fixture.expectedInventory}));
 await runStage('measure');const count=providerRequests.length;await runStage('restart');assert.equal(providerRequests.length,count,'Restart must not contact provider');nativeReport=await readJSON(reportPath);
 assert.ok(nativeReport.passed&&nativeReport.restart.passed);assert.equal(providerRequests.length,nativeReport.session.cycles);assert.ok(providerRequests.every(item=>item.closedAt&&!item.fixtureError&&item.chunks>1&&item.durationMs<60000));
}catch(error){runFailure=error;console.error(error.stack||String(error));}
finally{
 clearInterval(cancelWatch);if((await readJSON(path.join(ipc,'cancel.json')))?.cancelled===true)cancelled=true;for(const item of [...appStages].reverse()){if(groupAlive(item.pid)){signalGroup(item.pid,'SIGTERM');const until=performance.now()+5000;while(groupAlive(item.pid)&&performance.now()<until)await pause(50);if(groupAlive(item.pid)){signalGroup(item.pid,'SIGKILL');const untilKill=performance.now()+5000;while(groupAlive(item.pid)&&performance.now()<untilKill)await pause(50);}}item.groupExited=!groupAlive(item.pid);}
 await browser?.close().catch(()=>{});await runtimeMonitor?.close().catch(()=>{});provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));
 for(const item of [...owned].reverse()){signalGroup(item.pid,'SIGTERM');const until=performance.now()+5000;while(groupAlive(item.pid)&&performance.now()<until)await pause(50);if(groupAlive(item.pid)){signalGroup(item.pid,'SIGKILL');const untilKill=performance.now()+5000;while(groupAlive(item.pid)&&performance.now()<untilKill)await pause(50);}item.groupExited=!groupAlive(item.pid);}
 process.off('SIGINT',cancel);process.off('SIGTERM',cancel);
}
const shutdown=[];for(const [name,url]of [['api',`http://127.0.0.1:${apiPort}/api/workspace`],['vite',runtimeURL]]){let stopped=false;try{await fetch(url,{signal:AbortSignal.timeout(1000)});}catch{stopped=true;}shutdown.push({name,stopped});}
const sourceUnchanged=await Promise.all(fixture.manifest.files.map(async file=>{const result={path:file.path,original:false,snapshot:false};for(const [key,root]of [['original',repo],['snapshot',workspace]])try{result[key]=hash(await readFile(path.join(root,file.path)))===file.sha256;}catch(error){result[key+'Error']=error.code||error.message;}return result;}));
const endPayloads={};let packageUnchanged=false,harnessUnchanged=false,sidecarsUnchanged=false,provenanceError;
try{for(const name of ['dist','media','themes'])await payloadScan(path.join(extensionPath,name),endPayloads);endPayloads['package.json']=hash(await readFile(path.join(extensionPath,'package.json')));assert.deepEqual(endPayloads,payloads);packageUnchanged=true;
 for(const [name,digest]of Object.entries(harnessHashes))assert.equal(hash(await readFile(path.join(desktop,name))),digest,name);harnessUnchanged=true;
 for(const file of fixture.manifest.sidecars)assert.equal(hash(await readFile(file.path)),file.sha256,file.path);sidecarsUnchanged=true;
}catch(error){provenanceError=error.message;}

const cleanup={appExited:exited,appGroupExited:appStages.every(item=>item.groupExited),appStages,exitCode,ownedProcesses:owned.map(({name,pid,exited,groupExited,code,signal,error})=>({name,pid,exited,groupExited,code,signal,error})),servers:shutdown};
const passed=!runFailure&&!cancelled&&packageUnchanged&&harnessUnchanged&&sidecarsUnchanged&&exited&&exitCode===0&&owned.every(item=>item.exited&&item.groupExited)&&cleanup.appGroupExited&&shutdown.every(item=>item.stopped)&&sourceUnchanged.every(item=>item.original&&item.snapshot);
const report={...(nativeReport||await readJSON(reportPath)),acceptance:profile.activationAttempts?'diagnostic activation only; no typing latency or duration acceptance':'maintained-source endurance',passed,cancelled,error:runFailure?.stack,version,profile,app,extensionPath,payloads,harnessHashes,settingsHash,temp,workspace,fixture,sourceUnchanged,loadSummary:{providerWindows:providerRequests.filter(item=>item.closedAt).length,providerOpenMs:providerRequests.reduce((sum,item)=>sum+(item.durationMs||0),0),measuredTypingMs:phases.filter(item=>item.phase!=='warmup').reduce((sum,item)=>sum+item.endedAt-item.startedAt,0),warmupKeys:profile.warmupKeys},provenance:{packageUnchanged,harnessUnchanged,sidecarsUnchanged,error:provenanceError,endPayloads},providerRequests,phases,cleanup,hardware:{platform:process.platform,release:os.release(),arch:process.arch,cpu:os.cpus()[0]?.model,logicalCores:os.cpus().length,memoryBytes:os.totalmem()},limits:['One actual maintained Foundation source snapshot on this workstation; runtime is the Foundation web application with its real local API.','Synthetic local model output; no external model acceptance.',profile.activationAttempts?'Short activation diagnostic with runtime/index overlap; no endurance duration acceptance.':'Continuous process/runtime/index session with measured typing/AI windows and recorded gaps, not continuous AI or typing.',profile.activationAttempts?'No typing or latency measurements in activation diagnostic.':'Synthetic renderer proxy below50ms per window; physical keyboard,OS input queue,compositor and display not measured.','Process-scoped memory trends with retained history growth; passing does not establish absence of leaks.','Normal Orbit source/profile is never opened by this harness.']};
await writeFile(path.join(temp,'final-report.json'),JSON.stringify(report,null,2));await writeFile(path.join(desktop,'.build',reportName),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({event:'endurance-result',passed,cancelled,version,temp,report:reportName,cycles:nativeReport?.session?.cycles,session:nativeReport?.session,cleanup},null,2));if(!passed)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
