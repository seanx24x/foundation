import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createServer as createHTTPServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,realpath,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.length>2)throw Error('Usage: node desktop/scripts/investigation-continuation-smoke.mjs (packaged app only)');
const app=await realpath(process.env.FOUNDATION_APP_PATH||path.join(desktop,'.build/Foundation.app'));
const extensionPath=await realpath(path.join(app,'Contents/Resources/app/extensions/foundation-workspace'));
const temp=await realpath(await mkdtemp('/private/tmp/foundation-investigation-continuation-smoke-'));
const workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions'),harness=path.join(extensions,'foundation-test.investigation-continuation-native-check-1.0.0'),reportPath=path.join(temp,'report.json');
await Promise.all([mkdir(path.join(workspace,'src'),{recursive:true}),mkdir(path.join(userData,'User'),{recursive:true}),mkdir(harness,{recursive:true})]);
const fixture={
 'package.json':JSON.stringify({name:'foundation-investigation-continuation-fixture',private:true}),
 'src/App.tsx':"import {SaveButton} from './SaveButton';\nexport function App() { return <SaveButton state='idle' />; }\n",
 'src/SaveButton.tsx':"import {saveProfile} from './api';\nimport type {SaveState} from './types';\nimport './styles.css';\nexport function SaveButton({state}: {state:SaveState}) {\n  const save = async () => { await saveProfile(); };\n  return <button onClick={save}>{state}</button>;\n}\n",
 'src/api.ts':"import {writeProfile} from './transport';\nexport async function saveProfile() { return writeProfile(); }\n",
 'src/transport.ts':"export async function writeProfile() { return fetch('/api/profile', {method:'POST'}); }\n",
 'src/types.ts':"export type SaveState = 'idle' | 'loading' | 'error';\n",
 'src/styles.css':':root { --button-radius: 8px; }\n',
 'src/SaveButton.spec.tsx':"export const filenameCandidateOnly = 'PRIVATE_FILENAME_CANDIDATE';\n",
 'src/PRIVATE_UNRELATED.ts':"export const privateValue = 'PRIVATE_UNSHARED_SOURCE';\n",
 'src/Draft.ts':"export const unfinished = 'original saved draft';\n",
};
await Promise.all(Object.entries(fixture).map(([name,value])=>writeFile(path.join(workspace,name),value)));
await Promise.all([
 writeFile(path.join(userData,'User/settings.json'),JSON.stringify({'foundation.openOnStartup':true,'foundation.ai.baseUrl':'','foundation.ai.model':'','foundation.ai.profiles':{},'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never','security.workspace.trust.enabled':false,'files.hotExit':'onExitAndWindowClose','files.autoSave':'off','workbench.editor.enablePreview':false})),
 writeFile(path.join(harness,'package.json'),JSON.stringify({name:'investigation-continuation-native-check',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),
 writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-investigation-continuation-smoke.cjs'))),
]);

const providerRequests=[],disclosedContinuations=[],nativeActivations=[];
const seedAnswer='SEED_DISCLOSED_EXPLANATION: the saved button calls saveProfile [S1:5]. Runtime order and backend effects remain unknown.';
const provider=createHTTPServer(async(req,res)=>{
 try{
  assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,undefined);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const payload=JSON.parse(Buffer.concat(chunks)),input=JSON.parse(payload.messages[1].content),number=providerRequests.length+1;
  assert.ok(number<=4,'Only the seed Ask and three explicitly sent decisions may call the provider');assert.equal(payload.model,'foundation-local-continuation-fixture');assert.equal(payload.tools,undefined);
  const anchor=['src/SaveButton.tsx','src/SaveButton.tsx','src/api.ts','src/transport.ts'][number-1];assert.deepEqual(input.sources.map(file=>file.path),[anchor]);
  for(const key of ['taskContext','runtimeEvidence','planContext','requestRevision','groupRevision','checkContext'])assert.equal(input[key],undefined);
  assert.doesNotMatch(JSON.stringify(payload),/PRIVATE_FILENAME_CANDIDATE|PRIVATE_UNSHARED_SOURCE|PRIVATE_UNRELATED|PRIVATE_ENV_VALUE|PRIVATE_UNSAVED_DRAFT|basisDigest|snapshotId|featureId|conversationId|rootRequestId|parentRequestId|manifest/);
  let output;
  if(number===1){assert.equal(input.intent,'ask');assert.ok(input.sourceInvestigation);assert.equal(input.investigationContinuation,undefined);output=seedAnswer;}
  else{
   assert.equal(input.intent,'plan');assert.equal(input.sourceInvestigation,undefined);const context=input.investigationContinuation;assert.ok(context);assert.deepEqual(context,disclosedContinuations[number-2],'The provider receives exactly the prepared disclosure');
   assert.deepEqual(context.budget,{modelStep:number-1,modelLimit:3,toolsUsed:number-2,toolLimit:2});assert.equal(context.sourceInvestigation.anchorPath,anchor);
   assert.equal(context.previousExplanation.kind,number===2?'answer':'decision');if(number===2)assert.equal(context.previousExplanation.text,seedAnswer);else{assert.equal(JSON.stringify(payload).includes(seedAnswer),false,'Earlier answers are not inherited beyond the disclosed immediate explanation');assert.equal(JSON.parse(context.previousExplanation.text).title,`Checkpoint ${number-2}`);}
   const decision=number===4?{kind:'finish',conclusion:'The two supported local investigations are complete. Runtime behavior remains unverified.'}:{kind:'investigate',targetId:context.availableTargets.find(target=>target.path===(number===2?'src/api.ts':'src/transport.ts'))?.id,reason:'Inspect this supported related source locally, then decide whether to share its result.'};
   if(number===4)assert.deepEqual(context.availableTargets,[]);else assert.match(decision.targetId,/^T\d+$/);
   output=JSON.stringify({title:`Checkpoint ${number-1}`,summary:'Continue only from the disclosed saved-source evidence.',decision,limitations:['Static relationships do not prove runtime behavior or test outcomes.']});
  }
  providerRequests.push({intent:input.intent,question:input.question,sources:input.sources.map(({content,...file})=>file),...(input.investigationContinuation?{continuation:input.investigationContinuation}:{evidence:input.sourceInvestigation})});
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({model:payload.model,choices:[{delta:{content:output},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})}\n\ndata: [DONE]\n\n`);
 }catch(error){if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Local continuation fixture rejected this request.'}));providerRequests.push({fixtureError:error.message});}
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
const providerURL=`http://127.0.0.1:${provider.address().port}/v1`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJSON = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; } };
const debugPort = async () => {
  const server = createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
};
const wait = async (check, label, timeout = 25000) => {
  const deadline = Date.now() + timeout; let lastError;
  while (Date.now() < deadline) { try { const value = await check(); if (value) return value; } catch (error) { lastError = error; } await pause(100); }
  throw new Error(`Timed out: ${label}${lastError ? ` (${lastError.message})` : ''}`);
};
// Code OSS's own automation driver attaches webview targets explicitly: their
// nested OOPIFs are not reliably present in Playwright's page.frames inventory.
// Keep this test transport outside the product; it never calls acquireVsCodeApi
// or injects host messages, application state, or persisted context.
const targetCommand = async (browser, targetId, method, params = {}) => {
  const rootSession = await browser.newBrowserCDPSession(); let sessionId, listener, detachedListener, timeout;
  try {
    sessionId = (await rootSession.send('Target.attachToTarget', { targetId, flatten: false })).sessionId;
    const response = new Promise((resolve, reject) => {
      listener = event => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message); if (message.id !== 1) return;
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      };
      detachedListener = event => { if (event.sessionId === sessionId) reject(new Error(`Native renderer detached during ${method}`)); };
      rootSession.on('Target.receivedMessageFromTarget', listener); rootSession.on('Target.detachedFromTarget', detachedListener);
      timeout = setTimeout(() => reject(new Error(`Native renderer command timed out: ${method}`)), 10000);
    });
    const [, result] = await Promise.all([rootSession.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method, params }) }), response]);
    return result;
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
        const { executionContextId } = await targetCommand(browser, target.targetId, 'Page.createIsolatedWorld', { frameId: node.frame.id, worldName: 'foundationRevisionSmoke' });
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
const control = (selector, code) => `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Native control is missing'); ${code} })()`;
// Native button activation stays on one CDP attachment from focus validation
// through Enter keydown and keyup. Observers only record trusted DOM events;
// they never invoke product handlers or modify product state.
const activateButton=async(browser,frame,selector,expected)=>{
 const rootSession=await browser.newBrowserCDPSession();let sessionId,serial=0;const pending=new Map();
 const listener=event=>{if(event.sessionId!==sessionId)return;const value=JSON.parse(event.message),item=pending.get(value.id);if(!item)return;pending.delete(value.id);clearTimeout(item.timer);value.error?item.reject(Error(value.error.message)):item.resolve(value.result);};
 const detached=event=>{if(event.sessionId!==sessionId)return;for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('Native target detached during activation'));}pending.clear();};
 const evidence={selector,events:[],dispatched:false};nativeActivations.push(evidence);
 try{
  sessionId=(await rootSession.send('Target.attachToTarget',{targetId:frame.targetId,flatten:false})).sessionId;rootSession.on('Target.receivedMessageFromTarget',listener);rootSession.on('Target.detachedFromTarget',detached);
  const send=async(method,params={})=>{const id=++serial,response=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Native activation timed out: ${method}`));},10000);pending.set(id,{resolve,reject,timer});});await rootSession.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})});return response;};
  const read=async expression=>{const value=await send('Runtime.evaluate',{expression,contextId:frame.contextId,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);return value.result.value;};
  evidence.before=await read(`(async()=>{const selector=${JSON.stringify(selector)},expected=${JSON.stringify(expected||null)};for(let attempt=0;attempt<3;attempt++){const button=document.querySelector(selector);if(!button||button.disabled||!button.getClientRects().length)continue;button.focus();await new Promise(resolve=>setTimeout(resolve,120));const mode=[...document.querySelectorAll('button[aria-label$=" mode"]')].find(element=>element.getAttribute('aria-pressed')==='true')?.getAttribute('aria-label'),question=document.querySelector('textarea[aria-label="Ask about your source"]')?.value,paths=[...document.querySelectorAll('input[data-context-path]:checked')].map(input=>input.dataset.contextPath).sort();if(button===document.querySelector(selector)&&document.activeElement===button&&!button.disabled&&document.hasFocus()&&(!expected||mode===expected.mode&&question===expected.question&&JSON.stringify(paths)===JSON.stringify(expected.paths))){globalThis.__foundationActivation={button,events:[]};const listener=event=>globalThis.__foundationActivation.events.push({type:event.type,key:event.key,trusted:event.isTrusted,targetId:event.target?.id,tag:event.target?.tagName,activeId:document.activeElement?.id,connected:button.isConnected,same:button===document.querySelector(selector),hasFocus:document.hasFocus()});globalThis.__foundationActivation.listener=listener;for(const type of ['keydown','keyup','click'])document.addEventListener(type,listener,true);return {ready:true,hasFocus:true,id:button.id,tag:button.tagName,mode,question,paths};}}return {ready:false,hasFocus:document.hasFocus(),activeId:document.activeElement?.id,activeTag:document.activeElement?.tagName};})()`);
  assert.equal(evidence.before.ready,true,`Native control must own focused document before Enter: ${JSON.stringify(evidence.before)}`);
  evidence.dispatched=true;
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  evidence.after=await read(`(()=>{const observation=globalThis.__foundationActivation;for(const type of ['keydown','keyup','click'])document.removeEventListener(type,observation.listener,true);const value={events:observation.events,connected:observation.button.isConnected,activeId:document.activeElement?.id,hasFocus:document.hasFocus()};delete globalThis.__foundationActivation;return value;})()`);evidence.events=evidence.after.events;
  assert.ok(evidence.events.some(event=>event.type==='keydown'&&event.key==='Enter'&&event.trusted),'Trusted native Enter must reach the observed document');
  assert.ok(evidence.events.some(event=>event.type==='click'&&event.trusted),'Enter must activate the native button exactly once');
  assert.equal(evidence.events.filter(event=>event.type==='click'&&event.trusted).length,1);
 }catch(error){evidence.error=error.message;throw error;}finally{rootSession.off('Target.receivedMessageFromTarget',listener);rootSession.off('Target.detachedFromTarget',detached);for(const item of pending.values())clearTimeout(item.timer);if(sessionId)await rootSession.send('Target.detachFromTarget',{sessionId}).catch(()=>{});await rootSession.detach();}
};
const pressControl=(browser,frame,selector)=>activateButton(browser,frame,selector);
const fill=async(browser,frame,selector,text)=>{await evaluate(browser,frame,control(selector,'element.focus();element.select();return true;'));await targetCommand(browser,frame.targetId,'Input.insertText',{text});};


const inspectUI=async(browser,frame)=>evaluate(browser,frame,`(()=>{const investigation=document.querySelector('[aria-label="Source investigation"]'),continuation=document.querySelector('[aria-label="Continuing investigation"]');return {mode:[...document.querySelectorAll('button[aria-label$=" mode"]')].find(button=>button.getAttribute('aria-pressed')==='true')?.getAttribute('aria-label'),question:document.querySelector('textarea[aria-label="Ask about your source"]')?.value,paths:[...document.querySelectorAll('input[data-context-path]:checked')].map(input=>input.dataset.contextPath).sort(),submitDisabled:document.querySelector('#ask-submit')?.disabled,investigation:investigation?.innerText||null,continuation:continuation?.innerText||null,continuationJSON:continuation?.querySelector('.continuation-context-json')?.textContent||null,cards:[...document.querySelectorAll('[data-artifact-id^="investigation-decision/"]')].map(card=>({id:card.dataset.artifactId,text:card.innerText,actions:[...card.querySelectorAll('button')].map(button=>({label:button.textContent,disabled:button.disabled}))})),text:document.body.innerText};})()`);
const sendOnce=async(browser,frame,command)=>{
 let ready=false;
 for(let attempt=0;attempt<3;attempt++){
  await wait(async()=>await evaluate(browser,frame,'document.querySelector("#ask-submit")?.disabled===false'),'explicit checkpoint becomes sendable');const observed=await inspectUI(browser,frame);
  assert.equal(observed.mode,command.kind==='seed'?'Ask mode':'Plan mode');assert.equal(observed.question,command.question);assert.deepEqual(observed.paths,[command.anchor]);assert.ok(command.kind==='seed'?observed.investigation:observed.continuation);
  ready=await evaluate(browser,frame,`(async()=>{const button=document.querySelector('#ask-submit');if(!button||button.disabled)return false;button.focus();await new Promise(resolve=>setTimeout(resolve,120));return button===document.querySelector('#ask-submit')&&!button.disabled&&document.activeElement===button&&document.querySelector('textarea[aria-label="Ask about your source"]').value===${JSON.stringify(command.question)};})()`);if(ready)break;
 }
 assert.equal(ready,true,'Exact disclosed request must retain native Send focus before activation');
 if(command.kind!=='seed'){const view=await inspectUI(browser,frame);const disclosure=JSON.parse(view.continuationJSON);assert.equal(disclosure.sourceInvestigation.anchorPath,command.anchor);disclosedContinuations.push(disclosure);}
 await activateButton(browser,frame,'#ask-submit',{mode:command.kind==='seed'?'Ask mode':'Plan mode',question:command.question,paths:[command.anchor]});
};
let browser;
try{
 for(const stage of ['write','restore','finish']){
  const port=await debugPort(),ipc=path.join(temp,`${stage}-ipc`),outcome=path.join(temp,`${stage}-outcome.json`);await mkdir(ipc);
  const environment={...process.env,FOUNDATION_CONTINUATION_STAGE:stage,FOUNDATION_CONTINUATION_OUTCOME:outcome,FOUNDATION_CONTINUATION_REPORT:reportPath,FOUNDATION_CONTINUATION_IPC:ipc,FOUNDATION_CONTINUATION_EXTENSION:extensionPath,FOUNDATION_CONTINUATION_WORKSPACE:workspace};
  for(const key of Object.keys(environment))if(key==='ELECTRON_RUN_AS_NODE'||/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key))delete environment[key];Object.assign(environment,{FOUNDATION_AI_BASE_URL:providerURL,FOUNDATION_AI_MODEL:'foundation-local-continuation-fixture',FOUNDATION_AI_PROVIDER_KIND:'compatible',FOUNDATION_FIXTURE_PRIVATE:'PRIVATE_ENV_VALUE'});
  const log=await open(path.join(temp,`${stage}.log`),'w');const child=spawn(path.join(app,'Contents/MacOS/Foundation'),[workspace,'--new-window','--user-data-dir',userData,'--shared-data-dir',path.join(temp,'shared-data'),'--extensions-dir',extensions,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--disable-crash-reporter','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{env:environment,stdio:['ignore',log.fd,log.fd]});await log.close();
  let exited=false,exitCode,spawnError;child.once('exit',code=>{exited=true;exitCode=code;});child.once('error',error=>{exited=true;spawnError=error;});const deadline=Date.now()+240000;let commandIndex=1,result;
  try{
   while(!(result=await readJSON(outcome))){
    if(spawnError)throw spawnError;if(exited)throw Error(`${stage} exited before reporting. See ${temp}`);if(Date.now()>deadline)throw Error(`${stage} timed out. See ${temp}`);const command=await readJSON(path.join(ipc,`command-${commandIndex}.json`));if(!command){await pause(100);continue;}let answer;
    try{
     if(!browser)browser=await wait(()=>chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000}),'isolated native renderer endpoint');
     if(command.type==='investigate'){const frame=await surfaceFrame(browser,'workspace'),selector='[aria-label="Feature relationships"] button[data-design-focus="relationship/investigate"]';await wait(async()=>await evaluate(browser,frame,control(selector,'return !element.disabled;')),'fresh relationship sharing control');await pressControl(browser,frame,selector);}
     else{
      const frame=await surfaceFrame(browser,'assistant');
      if(command.type==='draft'){assert.equal(typeof command.question,'string');assert.ok(command.question.length<6000);await fill(browser,frame,'textarea[aria-label="Ask about your source"]',command.question);}
      else if(command.type==='send'){assert.ok(['seed','checkpoint'].includes(command.kind));assert.ok(['src/SaveButton.tsx','src/api.ts','src/transport.ts'].includes(command.anchor));await sendOnce(browser,frame,command);}
      else if(command.type==='checkpointAction'){
       assert.match(command.requestId,/^request-[\da-f-]+$/);assert.ok(['Continue investigation','Run investigation','Share result','End investigation'].includes(command.label));const scope=`[data-turn-id=${JSON.stringify(command.requestId)}]`;
       const selector=await wait(async()=>await evaluate(browser,frame,`[...document.querySelectorAll(${JSON.stringify(scope+' button')})].find(button=>button.textContent===${JSON.stringify(command.label)}&&!button.disabled)?.dataset.artifactFocus`),'explicit checkpoint action enabled');await pressControl(browser,frame,`${scope} button[data-artifact-focus=${JSON.stringify(selector)}]`);
      }else assert.equal(command.type,'inspect');
     }
     const frame=await surfaceFrame(browser,'assistant');answer={passed:true,renderer:await inspectUI(browser,frame),providerRequests:providerRequests.length};
    }catch(error){answer={passed:false,error:error.stack||String(error)};}await writeFile(path.join(ipc,`result-${commandIndex}.json`),JSON.stringify(answer));commandIndex++;
   }
   assert.equal(result.passed,true,`${stage}: ${result.error||'Failed native check'}. See ${temp}`);while(!exited&&Date.now()<deadline)await pause(100);assert.equal(exited,true);assert.equal(exitCode,0);assert.equal(providerRequests.length,{write:2,restore:3,finish:4}[stage]);assert.ok(providerRequests.every(request=>!request.fixtureError));
  }catch(error){if(!exited){try{child.kill('SIGTERM');}catch{}}throw error;}finally{await browser?.close().catch(()=>{});browser=undefined;}
 }
 const report={...await readJSON(reportPath),passed:true,mode:'packaged',app,extensionPath,workspace,temp,provider:'loopback mock only; no credentials',providerRequests,disclosedContinuations,nativeActivations,nativeVisualAcceptance:'Not performed by this automated check'};assert.equal(report.restoredInSecondProcess,true);assert.equal(report.restoredInThirdProcess,true);await writeFile(path.join(desktop,'.build','native-investigation-continuation-smoke-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await writeFile(path.join(temp,'native-activations.json'),JSON.stringify(nativeActivations,null,2));await writeFile(path.join(temp,'mock-provider-requests.json'),JSON.stringify(providerRequests,null,2));await browser?.close().catch(()=>{});provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));}
