import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer as createNetServer} from 'node:net';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,realpath,open,cp,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {chromium} from '@playwright/test';
import {performanceProfiles,seedPerformanceHistory} from './performance-fixture.mjs';

const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.dirname(desktop);
const option=process.argv[2]||'--profile=standard';
if(process.argv.length>3||!/^--profile=(standard|scale)$/.test(option))throw Error('Usage: node desktop/scripts/editor-performance.mjs [--profile=standard|--profile=scale]');
const profile=performanceProfiles[option.slice(10)];
const reportName=process.env.FOUNDATION_PERFORMANCE_REPORT_NAME||(profile.history?'native-editor-performance-scale-report.json':'native-editor-performance-report.json');assert.match(reportName,/^[a-zA-Z0-9.-]+\.json$/);
const harnessHashes=Object.fromEntries(await Promise.all(['scripts/editor-performance.mjs','scripts/performance-fixture.mjs','tests/native-editor-performance.cjs'].map(async file=>[file,createHash('sha256').update(await readFile(path.join(desktop,file))).digest('hex')])));
const app=await realpath(process.env.FOUNDATION_APP_PATH||path.join(desktop,'.build/Foundation.app'));
const extensionPath=await realpath(path.join(app,'Contents/Resources/app/extensions/foundation-workspace'));
const payloadHash=createHash('sha256').update(await readFile(path.join(extensionPath,'dist/extension.cjs'))).digest('hex');
const version=JSON.parse(await readFile(path.join(extensionPath,'package.json'),'utf8')).version;
const temp=await realpath(await mkdtemp('/private/tmp/foundation-editor-performance-'));
const workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions'),harness=path.join(extensions,'foundation-test.editor-performance-1.0.0'),reportPath=path.join(temp,'report.json'),ipc=path.join(temp,'ipc'),outcome=path.join(temp,'outcome.json');
await cp(path.join(repo,'fixtures/connected-web'),workspace,{recursive:true});
await promisify(execFile)('/bin/cp',['-cR',path.join(repo,'node_modules'),path.join(workspace,'node_modules')]);
const config=path.join(workspace,'vite.config.mjs');await writeFile(config,(await readFile(config,'utf8')).replace('../../desktop/runtime/vite-plugin.mjs',path.join(extensionPath,'dist/connected-vite-plugin.mjs')));
await Promise.all([mkdir(path.join(workspace,'src/corpus'),{recursive:true}),mkdir(path.join(userData,'User'),{recursive:true}),mkdir(harness,{recursive:true}),mkdir(ipc)]);
const {corpusFiles,corpusLines}=profile;
await Promise.all(Array.from({length:corpusFiles},(_,i)=>writeFile(path.join(workspace,`src/corpus/file-${String(i).padStart(3,'0')}.ts`),`export const value${i} = ${i};\n`+Array.from({length:corpusLines},(_,n)=>`// Indexed saved fixture ${i}:${n} ${'abcdef '.repeat(10)}\n`).join(''))));
if(profile.heavyFiles){await mkdir(path.join(workspace,'src/heavy'));await Promise.all(Array.from({length:profile.heavyFiles},(_,i)=>{const prefix=`export const heavy${i} = ${i};\n/*`;return writeFile(path.join(workspace,`src/heavy/source-${i}.ts`),prefix+'h'.repeat(profile.heavyBytes-Buffer.byteLength(prefix)-3)+'*/\n');}));}
await writeFile(path.join(workspace,'src/typing.ts'),'// PERF_INPUT:\nexport const untouched = true;\n');
await writeFile(path.join(workspace,'src/unrelated.ts'),"export const unrelated = 'PRIVATE_UNRELATED_FILE';\n");
await Promise.all([
 writeFile(path.join(userData,'User/settings.json'),JSON.stringify({'foundation.openOnStartup':false,'foundation.ai.baseUrl':'','foundation.ai.model':'','foundation.ai.profiles':{},'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never','window.dialogStyle':'custom','security.workspace.trust.enabled':false,'files.hotExit':'onExitAndWindowClose','files.autoSave':'off','workbench.editor.enablePreview':false,'workbench.colorTheme':'Foundation Dark','editor.inlineSuggest.enabled':true,'editor.quickSuggestions':false,'editor.suggestOnTriggerCharacters':false,'editor.autoClosingQuotes':'never','editor.autoClosingBrackets':'never','editor.acceptSuggestionOnEnter':'off','editor.accessibilitySupport':'off','editor.wordWrap':'off','editor.minimap.enabled':false,'window.zoomLevel':0})),
 writeFile(path.join(harness,'package.json'),JSON.stringify({name:'editor-performance',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),
 writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-editor-performance.cjs'))),
]);
const seededHistory=profile.history?await seedPerformanceHistory(workspace,userData):null;
console.log(JSON.stringify({event:'fixture-ready',profile:profile.name,version,temp,seededHistory}));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const readJSON=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return undefined;}};
const wait=async(check,label,timeout=45000)=>{const deadline=Date.now()+timeout;let last;while(Date.now()<deadline){try{const result=await check();if(result)return result;}catch(e){last=e;}await pause(25);}throw Error(`Timed out ${label}${last?`: ${last.message}`:''}`);};
const settingsHash=createHash('sha256').update(await readFile(path.join(userData,'User/settings.json'))).digest('hex');
const providerRequests=[];
const provider=createServer(async(req,res)=>{
 try{
  assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,undefined);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));assert.equal(body.model,'foundation-local-performance-fixture');assert.equal(body.tools,undefined);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_UNRELATED|PRIVATE_UNSAVED/);
  const record={index:providerRequests.length,startedAt:Date.now(),chunks:0};providerRequests.push(record);res.writeHead(200,{'Content-Type':'text/event-stream'});
  const interval=setInterval(()=>{if(res.destroyed)return;record.chunks++;res.write(`data: ${JSON.stringify({model:body.model,choices:[{delta:{content:'Local streaming performance fixture. '},finish_reason:null}]})}\n\n`);},50);
  res.on('close',()=>{clearInterval(interval);record.closedAt=Date.now();});
 }catch(error){providerRequests.push({fixtureError:error.message});res.writeHead(400).end();}
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
const providerURL=`http://127.0.0.1:${provider.address().port}/v1`;
const portServer=createNetServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
const environment={...process.env,FOUNDATION_PERFORMANCE_OUTCOME:outcome,FOUNDATION_PERFORMANCE_REPORT:reportPath,FOUNDATION_PERFORMANCE_IPC:ipc,FOUNDATION_PERFORMANCE_EXTENSION:extensionPath,FOUNDATION_PERFORMANCE_WORKSPACE:workspace,FOUNDATION_PERFORMANCE_PROFILE:JSON.stringify(profile)};
for(const key of Object.keys(environment))if(key==='ELECTRON_RUN_AS_NODE'||/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key))delete environment[key];
Object.assign(environment,{FOUNDATION_AI_BASE_URL:providerURL,FOUNDATION_AI_MODEL:'foundation-local-performance-fixture',FOUNDATION_AI_PROVIDER_KIND:'compatible'});
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
 const root=await browser.newBrowserCDPSession(),sessionId=(await root.send('Target.attachToTarget',{targetId:frame.targetId,flatten:false})).sessionId,events=[],pending=new Map(),statuses=new Map();let sequence=1;
 const listener=event=>{if(event.sessionId!==sessionId)return;const message=JSON.parse(event.message),data=message.params;
  if(message.method==='Network.requestWillBeSent'&&data.request.url.endsWith('/__foundation/events')&&data.request.postData){try{const body=JSON.parse(data.request.postData);const item={requestId:data.requestId,at:Date.now(),kind:body.type,session:body.session,viewId:body.viewId,documentId:body.documentId,url:body.url,method:body.method};if(statuses.has(data.requestId))Object.assign(item,statuses.get(data.requestId));events.push(item);pending.set(data.requestId,item);}catch{}}
  if(message.method==='Network.responseReceived'||message.method==='Network.responseReceivedExtraInfo'){const result={status:data.response?.status??data.statusCode,responseAt:Date.now(),statusEvent:message.method};statuses.set(data.requestId,result);if(pending.has(data.requestId)){Object.assign(pending.get(data.requestId),result);pending.delete(data.requestId);}}
  if(message.method==='Network.loadingFailed'&&pending.has(data.requestId))pending.get(data.requestId).networkFailure=data.errorText;
 };
 root.on('Target.receivedMessageFromTarget',listener);await root.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:sequence++,method:'Network.enable'})});
 return{events,async close(){root.off('Target.receivedMessageFromTarget',listener);await root.send('Target.detachFromTarget',{sessionId}).catch(()=>{});await root.detach();}};
};
const control = (selector, code) => `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Native control is missing'); ${code} })()`;
const pressControl = async (browser, frame, selector) => {
  await evaluate(browser, frame, control(selector, 'element.focus(); if (document.activeElement !== element) throw new Error("Native control did not receive focus: "+element.outerHTML+"; disclosure="+element.closest("details")?.open+"; rects="+element.getClientRects().length); return true;'));
  await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ', unmodifiedText: ' ', windowsVirtualKeyCode: 32 });
  await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
};

let allRuntimeEvents=[];let browser,child,runtimePage,ownedRuntimeURL,exited=false,exitCode,spawnError;const phases=[],surfaces={};
const summarize=values=>{const data=values.filter(Number.isFinite).sort((a,b)=>a-b),at=p=>data[Math.max(0,Math.ceil(data.length*p)-1)]??null;return{count:data.length,min:data[0]??null,p50:at(.5),p95:at(.95),p99:at(.99),max:data.at(-1)??null};};
const assistant=async(action)=>{
 let frame=surfaces.assistant;
 try{if(frame&&await evaluate(browser,frame,'document.body?.dataset.foundationSurface')!=='assistant')frame=undefined;}catch{frame=undefined;}
 if(!frame)frame=await surfaceFrame(browser,'assistant');surfaces.assistant=frame;
 if(action==='start'){
  if(!await evaluate(browser,frame,'document.querySelector("details.assistant-setup").open'))await pressControl(browser,frame,'summary[aria-label="Request context and model"]');
  const available=await evaluate(browser,frame,'[...document.querySelectorAll("input[data-context-path]")].map(input=>({path:input.dataset.contextPath,checked:input.checked}))');assert.ok(available.some(item=>item.path==='src/App.tsx'));
  // Optional unchecked documents can close or leave the live source catalog.
  // Only the required source and currently selected rows need interaction.
  for(const item of available.filter(item=>item.checked||item.path==='src/App.tsx')){
   if(!await evaluate(browser,frame,'document.querySelector("details.assistant-setup").open'))await pressControl(browser,frame,'summary[aria-label="Request context and model"]');
   const selector=`input[data-context-path=${JSON.stringify(item.path)}]`;
   await wait(()=>evaluate(browser,frame,control(selector,'return element.getClientRects().length>0&&!element.disabled;')),'visible source context');
   if(await evaluate(browser,frame,control(selector,'return element.checked;'))!==(item.path==='src/App.tsx'))await pressControl(browser,frame,selector);
  }
  assert.deepEqual(await evaluate(browser,frame,'[...document.querySelectorAll("input[data-context-path]")].filter(input=>input.checked).map(input=>input.dataset.contextPath).sort()'),['src/App.tsx'],'Only the explicit saved fixture source may be shared');
  await evaluate(browser,frame,control('textarea[aria-label="Ask about your source"]','element.focus();element.select();return true;'));
  await targetCommand(browser,frame.targetId,'Input.insertText',{text:'Describe the selected saved fixture source. Keep the response streaming until I stop.'});
  await wait(()=>evaluate(browser,frame,'document.querySelector("#ask-submit")?.disabled===false'),'sendable native Assistant');
  const count=providerRequests.length;await pressControl(browser,frame,'#ask-submit');await wait(()=>providerRequests.length>count&&providerRequests.at(-1).chunks>1,'real streaming response');
 }else{
  assert.match(await evaluate(browser,frame,'document.querySelector("#ask-submit")?.textContent||""'),/Stop/);await pressControl(browser,frame,'#ask-submit');await wait(()=>providerRequests.at(-1).closedAt,'cancelled loopback stream');
 }
};
const installProbe=async page=>page.evaluate(()=>{
 window.__foundationPerf?.dispose();
 const state={samples:[],measures:[],longTasks:[],frameGaps:[],active:null,phase:null,longTaskSupported:PerformanceObserver.supportedEntryTypes.includes('longtask')};let previousFrame,raf;
 const keydown=event=>{if(!state.phase||event.key!=='x'||event.ctrlKey||event.metaKey||event.altKey)return;if(state.active)state.active.overlapped=true;state.active={index:state.samples.length,key:'x',keydownAt:performance.now(),eventTimestamp:event.timeStamp,trusted:event.isTrusted,expectedCount:state.expectedCount};state.samples.push(state.active);};
 const observer=new MutationObserver(()=>{const sample=state.active;if(!sample||sample.mutationAt!==undefined)return;const line=[...document.querySelectorAll('.monaco-editor .view-lines .view-line')].find(el=>el.textContent.replace(/\u00a0/g,' ').includes('// PERF_INPUT:'));if(!line)return;const text=line.textContent.replace(/\u00a0/g,' ');const count=(text.split('// PERF_INPUT:')[1]?.match(/^x*/)?.[0]||'').length;if(count!==sample.expectedCount)return;sample.mutationAt=performance.now();requestAnimationFrame(()=>{sample.frameAt=performance.now();if(state.active===sample)state.active=null;});});
 observer.observe(document.querySelector('.monaco-workbench')||document.body,{subtree:true,childList:true,characterData:true});document.addEventListener('keydown',keydown,true);
 const measures=new PerformanceObserver(list=>{if(state.phase)state.measures.push(...list.getEntries().filter(item=>['inputlatency','keydown','input','render'].includes(item.name)).map(item=>({name:item.name,startTime:item.startTime,duration:item.duration})));});measures.observe({type:'measure'});
 let tasks;try{tasks=new PerformanceObserver(list=>{if(state.phase)state.longTasks.push(...list.getEntries().map(item=>({startTime:item.startTime,duration:item.duration})));});tasks.observe({type:'longtask'});}catch{}
 const frame=timestamp=>{if(state.phase&&previousFrame!==undefined)state.frameGaps.push(timestamp-previousFrame);previousFrame=timestamp;raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);
 state.dispose=()=>{observer.disconnect();measures.disconnect();tasks?.disconnect();document.removeEventListener('keydown',keydown,true);cancelAnimationFrame(raf);};window.__foundationPerf=state;
});
const attachSurface=async name=>{
 let frame=surfaces[name];try{if(frame&&await evaluate(browser,frame,'document.body?.dataset.foundationSurface')!==name)frame=undefined;}catch{frame=undefined;}
 if(!frame)frame=await surfaceFrame(browser,name);surfaces[name]=frame;
 const visibility=await evaluate(browser,frame,`(() => { if(!window.__foundationStateCounts){window.__foundationStateCounts=[];window.addEventListener('message',event=>{if(event.data?.type==='state'||event.data?.type==='ai'){window.__foundationStateCounts.push({type:event.data.type,timestamp:Date.now()});(window.__foundationLastStates||={})[event.data.type]=event.data;}});}return {width:innerWidth,height:innerHeight,bodyVisible:document.body.getClientRects().length>0,visibility:document.visibilityState};})()`);
 assert.ok(visibility.bodyVisible&&visibility.width>0&&visibility.height>0&&visibility.visibility==='visible',`${name} surface must be visible`);return visibility;
};
const samplePayloads=async()=>{const sizes={};for(const [name,frame] of Object.entries(surfaces))sizes[name]=await evaluate(browser,frame,`(() => {const states=window.__foundationLastStates||{};window.__foundationLastStates={};return Object.fromEntries(Object.entries(states).map(([type,state])=>[type,{estimatedSerializedBytes:new TextEncoder().encode(JSON.stringify(state)).byteLength}]));})()`);return sizes;};
const rendererResource=async page=>{const session=await page.context().newCDPSession(page);try{return {scope:'Workbench renderer V8 isolate only',at:Date.now(),heap:await session.send('Runtime.getHeapUsage')};}finally{await session.detach();}};
const measure=async(page,phase)=>{
 for(const name of ['workspace','assistant'])await attachSurface(name);
 const payloadBytesBefore=await samplePayloads(),resourcesBefore=await rendererResource(page);
 console.log(JSON.stringify({event:'phase-start',profile:profile.name,phase,keys:profile.phaseKeys[phase],temp}));
 await page.evaluate(name=>{const s=window.__foundationPerf;s.samples=[];s.measures=[];s.longTasks=[];s.frameGaps=[];s.active=null;s.phase=name;},phase);
 const count=profile.phaseKeys[phase],cadenceMs=50,startAt=Date.now(),driver=[];
 for(let i=0;i<count;i++){
  const started=performance.now(),wallStartedAt=Date.now();
  await page.evaluate(expected=>{window.__foundationPerf.expectedCount=expected;},i+1);
  await page.keyboard.press('x');
  await wait(()=>page.evaluate(()=>window.__foundationPerf.samples.at(-1)?.frameAt),'renderer typed frame',5000);
  driver.push({index:i,wallStartedAt,wallEndedAt:Date.now(),dispatchRoundtripMs:performance.now()-started,providerActive:providerRequests.some(r=>r.startedAt<=wallStartedAt&&!r.closedAt)});
  await pause(Math.max(0,cadenceMs-(performance.now()-started)));
 }
 await pause(40);
 const result=await page.evaluate(()=>{const s=window.__foundationPerf;const result={samples:s.samples,measures:s.measures,longTasks:s.longTasks,frameGaps:s.frameGaps,longTaskSupported:s.longTaskSupported};s.phase=null;return result;});
 const samples=result.samples;assert.equal(samples.length,count);assert.ok(samples.every(s=>s.trusted&&!s.overlapped&&Number.isFinite(s.mutationAt)&&Number.isFinite(s.frameAt)));
 const native=result.measures.filter(m=>m.name==='inputlatency');
 const correlated=samples.map((sample,i)=>native.filter(m=>m.startTime>=sample.keydownAt&&m.startTime<(samples[i+1]?.keydownAt??sample.frameAt+50)));
 assert.equal(native.length,count,'Every synthetic key must have one upstream input-latency measure');assert.ok(correlated.every(matches=>matches.length===1),'Each upstream measure must match exactly one key window');
 const endedAt=Date.now(),resourcesAfter=await rendererResource(page),payloadBytesAfter=await samplePayloads();const stateMessages={};
 for(const [name,frame] of Object.entries(surfaces))stateMessages[name]=await evaluate(browser,frame,`window.__foundationStateCounts.filter(item=>item.timestamp>=${startAt}&&item.timestamp<=${endedAt})`);
 const runtimeRequests=runtimePage?await runtimePage.evaluate(({start,end})=>window.__load.events.filter(item=>item.startedAt<=end&&(item.completedAt??Date.now())>=start),{start:startAt,end:endedAt}):[];

 const phaseEvents=runtimeMonitor?runtimeMonitor.events.filter(item=>item.at>=startAt&&item.at<=endedAt):[],settlementStartedAt=Date.now();if(phaseEvents.length)await wait(()=>phaseEvents.every(item=>item.status!==undefined),'settled phase instrumentation responses',1000).catch(()=>{});
 const settledAt=Date.now(),runtimeEvidence=structuredClone(phaseEvents);
 const instrumentationResponseCoverage={settledAt,settlementWaitMs:settledAt-settlementStartedAt,accepted:runtimeEvidence.filter(e=>e.status===202).length,rejected:runtimeEvidence.filter(e=>Number.isFinite(e.status)&&e.status!==202).length,unknown:runtimeEvidence.filter(e=>e.status===undefined).length,networkFailures:runtimeEvidence.filter(e=>e.networkFailure).length};
 const phaseResult={phase,runtimeEvidence,instrumentationResponseCoverage,startedAt:startAt,endedAt,resources:{before:resourcesBefore,after:resourcesAfter},payloadSizes:{before:payloadBytesBefore,after:payloadBytesAfter},stateMessages,runtimeRequests,count,cadenceMs,driver,...result,summary:{eventToDOM:summarize(samples.map(s=>s.mutationAt-s.keydownAt)),eventToNextFrame:summarize(samples.map(s=>s.frameAt-s.keydownAt)),upstreamRendererInput:summarize(native.map(m=>m.duration)),driverDispatchToObservedFrame:summarize(driver.map(s=>s.dispatchRoundtripMs)),frameGaps:summarize(result.frameGaps),longTasks:result.longTaskSupported?result.longTasks.length:null},nativeMeasureCount:native.length,nativeMeasureCoverage:{matched:correlated.length,unmatched:0,missing:0}};
 phases.push(phaseResult);console.log(JSON.stringify({event:'phase-end',profile:profile.name,phase,keys:count,durationMs:endedAt-startAt,upstream:phaseResult.summary.upstreamRendererInput}));return phaseResult;
};
let currentStage;
const runStage=async stage=>{
 currentStage=stage;
 await rm(outcome,{force:true});for(const name of await readdir(ipc))await rm(path.join(ipc,name));
 exited=false;exitCode=undefined;spawnError=undefined;environment.FOUNDATION_PERFORMANCE_STAGE=stage;
 const log=await open(path.join(temp,`native-${stage}.log`),'w');child=spawn(path.join(app,'Contents/MacOS/Foundation'),[workspace,'--new-window','--user-data-dir',userData,'--shared-data-dir',path.join(temp,'shared-data'),'--extensions-dir',extensions,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--disable-crash-reporter','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{env:environment,stdio:['ignore',log.fd,log.fd]});await log.close();child.once('exit',code=>{exited=true;exitCode=code;});child.once('error',error=>{exited=true;spawnError=error;});
 const deadline=Date.now()+(profile.history?900000:300000);let index=1,result;
 while(!(result=await readJSON(outcome))){
  if(spawnError)throw spawnError;if(exited)throw Error(`App exited; ${temp}`);if(Date.now()>deadline)throw Error(`Native performance timed out; ${temp}`);
  const request=await readJSON(path.join(ipc,`command-${index}.json`));if(!request){await pause(25);continue;}
  let answer;try{
   if(!browser)browser=await wait(()=>chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000}),'native renderer');
   const page=await wait(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('vscode-file:')),'workbench');
   if(request.type==='setup'){
    await installProbe(page);const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,devicePixelRatio}));assert.deepEqual(viewport,{width:1440,height:900,devicePixelRatio:2},'Fixed native renderer viewport must match baseline/candidate');
    const visibility={};for(const name of ['workspace','assistant'])visibility[name]=await attachSurface(name);
    answer={viewport,visibility,eventTimingSupported:await page.evaluate(()=>PerformanceObserver.supportedEntryTypes.includes('event')),longTaskSupported:await page.evaluate(()=>PerformanceObserver.supportedEntryTypes.includes('longtask'))};
   }
   else if(request.type==='ai')await assistant(request.action);
   else if(request.type==='runtime-start'){
    ownedRuntimeURL=request.targetUrl;const frame=await embeddedRuntimeFrame(browser,request.url);runtimeMonitor=await monitorRuntime(browser,frame);allRuntimeEvents=runtimeMonitor.events;runtimePage={evaluate:async(fn,arg)=>evaluate(browser,frame,`(${fn.toString()})(${JSON.stringify(arg)??'undefined'})`)};await wait(()=>runtimePage.evaluate(()=>window.__foundationRuntimeInstalled===true&&Boolean(document.querySelector('button.save-button'))),'instrumented embedded fixture');
    await runtimePage.evaluate(()=>{window.__load={started:0,completed:0,errors:0,events:[]};window.__load.timer=setInterval(()=>{const event={startedAt:Date.now()};window.__load.events.push(event);window.__load.started++;fetch('/api/ping',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>{event.status=r.status;event.completedAt=Date.now();if(r.status===200)window.__load.completed++;else window.__load.errors++;}).catch(()=>{event.error=true;event.completedAt=Date.now();window.__load.errors++;});},140);});
    await wait(()=>runtimeMonitor.events.some(item=>item.kind==='request'&&item.status===202),'accepted embedded runtime request evidence');
    answer={runtimeOwner:runtimeMonitor.events.find(item=>item.kind==='request'&&item.status===202),previewViewId:new URL(request.url).searchParams.get('__foundation_view'),frameId:frame.frameId,viewport:await runtimePage.evaluate(()=>({width:innerWidth,height:innerHeight,devicePixelRatio}))};
   }else if(request.type==='runtime-inspect')answer=await runtimePage.evaluate(()=>({started:window.__load.started,completed:window.__load.completed,errors:window.__load.errors}));
   else if(request.type==='runtime-stop'){await runtimePage.evaluate(()=>clearInterval(window.__load.timer));await wait(()=>runtimePage.evaluate(()=>window.__load.started===window.__load.completed+window.__load.errors),'settled fixture requests after stopping load',5000);answer=await runtimePage.evaluate(()=>({started:window.__load.started,completed:window.__load.completed,errors:window.__load.errors,pending:window.__load.started-window.__load.completed-window.__load.errors}));await runtimeMonitor.close();runtimeMonitor=null;runtimePage=null;}
   else if(request.type==='measure'){assert.ok(Object.hasOwn(profile.phaseKeys,request.phase));answer=await measure(page,request.phase);}
   else if(request.type==='capture')await page.screenshot({path:path.join(temp,'workspace.png')});
   else assert.equal(request.type,'inspect');
   answer={...answer,passed:true,providerRequests:[...providerRequests]};
  }catch(error){await pageFailure();answer={passed:false,error:error.stack||String(error)};}
  await writeFile(path.join(ipc,`result-${index}.json`),JSON.stringify(answer));index++;
 }
 assert.equal(result.passed,true,`${result.error}; ${temp}`);while(!exited&&Date.now()<deadline)await pause(100);assert.equal(exited,true);assert.equal(exitCode,0);
 await browser?.close().catch(()=>{});browser=null;
};
let runFailure;
try{
 await runStage('measure');
 const requestsBeforeRestart=providerRequests.length;if(profile.history){console.log(JSON.stringify({event:'restart-check',temp}));await runStage('restart');assert.equal(providerRequests.length,requestsBeforeRestart,'Restart must not contact provider');}
 if(ownedRuntimeURL)await wait(async()=>{try{await fetch(ownedRuntimeURL,{signal:AbortSignal.timeout(1000)});return false;}catch{return true;}},'owned runtime stopped',10000);
 const diagnostics=[];async function readDiagnostics(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await readDiagnostics(file);else if(entry.name.endsWith('-Foundation.log'))for(const line of (await readFile(file,'utf8')).split('\n')){try{const row=JSON.parse(line);if(row.phase&&row.event)diagnostics.push(row);}catch{}}}}await readDiagnostics(path.join(userData,'logs'));
 for(const phase of phases)phase.diagnostics=diagnostics.filter(item=>Date.parse(item.timestamp)>=phase.startedAt&&Date.parse(item.timestamp)<=phase.endedAt);
 const measuredPhases=phases.filter(p=>p.phase!=='warmup'),combined=phases.filter(p=>p.phase.startsWith('combined'));
 const durationSummary={measuredTypingMs:measuredPhases.reduce((sum,p)=>sum+p.endedAt-p.startedAt,0),activeSessionSpanMs:phases.at(-1).endedAt-phases[0].startedAt,combinedTypingMs:combined.reduce((sum,p)=>sum+p.endedAt-p.startedAt,0),combinedSpanMs:combined.at(-1).endedAt-combined[0].startedAt,combinedGapsMs:combined.slice(1).map((phase,i)=>phase.startedAt-combined[i].endedAt)};
 const report={...await readJSON(reportPath),passed:true,version,payloadHash,settingsHash,harnessHashes,profile,seededHistory,durationSummary,cleanup:{appExited:exited,exitCode,ownedRuntimeStopped:!!ownedRuntimeURL},hardware:{platform:process.platform,release:os.release(),arch:process.arch,cpu:os.cpus()[0]?.model,logicalCores:os.cpus().length,memoryBytes:os.totalmem()},app,extensionPath,temp,workspace,corpus:{files:corpusFiles,linesPerFile:corpusLines,heavyFiles:profile.heavyFiles,heavyBytesEach:profile.heavyBytes},providerRequests,phases,measurementContract:{input:`CDP synthetic native keyboard events at minimum 50 ms cadence; profile ${profile.name} phase keys recorded separately; warmup separate`,loadWindows:profile.history?'Scale combined load has four explicitly restarted 600-key AI windows within a continuous indexing/runtime session, respecting the 60-second provider timeout. Gaps excluded from accumulated typing time.':'Standard profile uses one 160-key combined window and separate idle, AI, index/runtime and warmup windows.',indexing:'Overlap means an invoked foundation.refresh command was in flight during key dispatch, not per-key CPU activity. Completion, success and untruncated inventory are validated after indexing stops.',runtime:'Requests are generated inside the single embedded native preview default JavaScript context. Accepted instrumentation event identities are compared with native runtime ownership. Passive CDP response statuses may be unavailable: after a bounded 1-second post-phase wait they remain Unknown, never counted accepted; confirmed rejection fails.',payloads:'Pre/post estimates serialize latest received state once outside timed typing; UTF-8 JSON size, not IPC wire bytes. Message counts retain only type/time; no per-message serialization.',resources:'Before/after process-scoped snapshots only; changes do not establish a memory leak or multi-hour stability',eventToDOM:'renderer keydown capture to observed matching source-line DOM through MutationObserver',eventToNextFrame:'renderer keydown to next requestAnimationFrame after matching source DOM; not compositor presentation',upstreamRendererInput:'Pinned Code OSS inputlatency Performance API measure: renderer keydown through input and post-render task heuristic',driver:'driver dispatch through renderer frame observation includes automation transport/polling',notMeasured:['physical keyboard dispatch','OS input queue before renderer delivery','compositor/display presentation','production-model latency','multi-hour workloads'],gate:'p95 <50 ms applies only as a synthetic renderer proxy; physical product acceptance remains open'}};
 const name=reportName;await writeFile(path.join(desktop,'.build',name),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:true,profile:profile.name,version,temp,report:name,phases:phases.map(p=>({phase:p.phase,count:p.count,nativeMeasureCount:p.nativeMeasureCount,summary:p.summary}))},null,2));
}catch(error){runFailure=error;throw error;}finally{if(child&&!exited){child.kill('SIGTERM');const deadline=Date.now()+5000;while(!exited&&Date.now()<deadline)await pause(50);if(!exited){child.kill('SIGKILL');await wait(()=>exited,'disposable app exit',5000);}}await browser?.close().catch(()=>{});await runtimeMonitor?.close().catch(()=>{});provider.closeAllConnections();await new Promise(r=>provider.close(r));await writeFile(path.join(temp,'runtime-instrumentation-events.json'),JSON.stringify(allRuntimeEvents,null,2));await writeFile(path.join(temp,'driver-phases.json'),JSON.stringify(phases,null,2));await writeFile(path.join(temp,'provider-requests.json'),JSON.stringify(providerRequests,null,2));
 if(runFailure){
  const checkpoint=await readJSON(path.join(temp,'native-load-evidence.json')),fixture=await readJSON(path.join(temp,'native-fixture-context.json'));
  let ownedRuntimeStopped=false;if(ownedRuntimeURL)try{await fetch(ownedRuntimeURL,{signal:AbortSignal.timeout(1000)});}catch{ownedRuntimeStopped=true;}
  const failure={...fixture,passed:false,error:runFailure.stack||String(runFailure),nativeOutcome:await readJSON(outcome),version,payloadHash,settingsHash,harnessHashes,profile,seededHistory,hardware:{platform:process.platform,release:os.release(),arch:process.arch,cpu:os.cpus()[0]?.model,logicalCores:os.cpus().length,memoryBytes:os.totalmem()},app,extensionPath,temp,workspace,corpus:{files:corpusFiles,linesPerFile:corpusLines,heavyFiles:profile.heavyFiles,heavyBytesEach:profile.heavyBytes},providerRequests,phases,loadEvidence:checkpoint?.results||[],refreshes:checkpoint?.refreshes||[],cleanup:{appExited:exited,exitCode,ownedRuntimeStopped},restart:{passed:false,reason:currentStage==='restart'?'Restart verification failed.':'Full load validation did not complete; restart stage was not reached.'},measurementContract:{input:'Same frozen profile and native input probe as the candidate; completed phases retained, functional failure is not accepted.',runtime:'A failed native runtime overlap guard prevents claims of successful simultaneous load or complete observation continuity.',notMeasured:['physical keyboard dispatch','OS input queue before renderer delivery','compositor/display presentation','production-model latency','multi-hour workloads']}};
  await writeFile(path.join(desktop,'.build',reportName),JSON.stringify(failure,null,2));console.error(JSON.stringify({event:'failed-report-saved',profile:profile.name,version,temp,report:reportName}));
 }
}
async function pageFailure(){try{const page=browser?.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('vscode-file:'));if(page)await page.screenshot({path:path.join(temp,'failure.png')});}catch{}}
