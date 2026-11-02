import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createServer as createHTTPServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,realpath,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.length>2)throw Error('Usage: node desktop/scripts/group-revision-smoke.mjs (packaged app only)');
const app=await realpath(process.env.FOUNDATION_APP_PATH||path.join(desktop,'.build/Foundation.app'));
const extensionPath=await realpath(path.join(app,'Contents/Resources/app/extensions/foundation-workspace'));
const temp=await realpath(await mkdtemp('/private/tmp/foundation-group-revision-smoke-'));
const workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions'),harness=path.join(extensions,'foundation-test.group-revision-native-check-1.0.0'),reportPath=path.join(temp,'report.json');
await Promise.all([mkdir(path.join(workspace,'src'),{recursive:true}),mkdir(path.join(userData,'User'),{recursive:true}),mkdir(harness,{recursive:true})]);
const fixture={
 'package.json':JSON.stringify({name:'foundation-group-revision-fixture',private:true,type:'module'}),
 'src/label.mjs':"export const label = 'Save profile';\n",
 'src/api.mjs':"export function saveProfile() { return false; }\n",
 'src/consumer.mjs':"export const consumer = 'unchanged';\n",
 'src/Draft.ts':"export const unfinished = 'original saved draft';\n",
 'src/parent.test.mjs':"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {label} from './label.mjs';\nimport {saveProfile} from './api.mjs';\ntest('parent staged behavior', () => { assert.equal(label, 'Save changes'); assert.equal(saveProfile(), true); console.log('FOUNDATION_PARENT_CHECK'); });\n",
};
await Promise.all(Object.entries(fixture).map(([name,value])=>writeFile(path.join(workspace,name),value)));
await Promise.all([
 writeFile(path.join(userData,'User/settings.json'),JSON.stringify({'foundation.openOnStartup':true,'foundation.ai.baseUrl':'','foundation.ai.model':'','foundation.ai.profiles':{},'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never','security.workspace.trust.enabled':false,'files.hotExit':'onExitAndWindowClose','files.autoSave':'off','workbench.editor.enablePreview':false})),
 writeFile(path.join(harness,'package.json'),JSON.stringify({name:'group-revision-native-check',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),
 writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-group-revision-smoke.cjs'))),
]);
// A loopback protocol fixture, never a commercial model. Environment-only setup
// leaves all credential profiles empty and never reads or stores a Keychain key.
const providerRequests=[],closedProviderRequests=[];
const provider=createHTTPServer(async(req,res)=>{
 try{
  assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,undefined);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const payload=JSON.parse(Buffer.concat(chunks)),input=JSON.parse(payload.messages[1].content);
  assert.equal(payload.model,'foundation-local-group-revision-fixture');assert.equal(payload.tools,undefined);assert.equal(input.intent,'build');assert.equal(input.planContext,undefined);assert.equal(input.requestRevision,undefined);assert.equal(input.groupRevision,undefined);
  assert.deepEqual(input.sources.map(file=>file.path).sort(),['src/api.mjs','src/consumer.mjs','src/label.mjs']);
  assert.equal(JSON.stringify(payload).includes('PRIVATE_PARENT_RAW_OUTPUT'),false);assert.equal(JSON.stringify(payload).includes('FOUNDATION_PARENT_CHECK'),false,'Prior tool output is never inherited');
  const requestNumber=providerRequests.length+1;assert.ok(requestNumber<=4,'Preparation, version changes and restart cannot call the provider');
  if(requestNumber===1){assert.equal(input.context,undefined);assert.match(input.sources.find(file=>file.path==='src/label.mjs').content,/'Save profile'/);assert.match(input.sources.find(file=>file.path==='src/api.mjs').content,/return false/);}
  else{assert.deepEqual(input.context,{kind:'staged-group',title:'Coordinate staged save behavior'});assert.match(input.sources.find(file=>file.path==='src/label.mjs').content,/'Save changes'/);assert.match(input.sources.find(file=>file.path==='src/api.mjs').content,/return true/);}
  providerRequests.push({intent:input.intent,sources:input.sources,question:input.question,context:input.context});res.once('close',()=>closedProviderRequests.push(requestNumber));
  const change=requestNumber===1?{title:'Coordinate staged save behavior',summary:'PRIVATE_PARENT_RAW_OUTPUT: update label and service.',edits:[{path:'src/label.mjs',find:"'Save profile'",replace:"'Save changes'"},{path:'src/api.mjs',find:'return false;',replace:'return true;'}],verification:['Run the parent Node test.']}:{title:requestNumber===2?'Cancelled revision':requestNumber===3?'Invalid revision':'Refined save wording',summary:'Refine one staged label and retain the service change.',edits:[{path:'src/label.mjs',find:requestNumber===3?"'Missing staged anchor'":"'Save changes'",replace:"'Save securely'"}],verification:['Inspect the refined save behavior.']};
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(`data: ${JSON.stringify({model:payload.model,choices:[{delta:{content:JSON.stringify(change)},finish_reason:null}]})}\n\n`);
  if(requestNumber!==2)res.end(`data: ${JSON.stringify({model:payload.model,choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})}\n\ndata: [DONE]\n\n`);
 }catch(error){if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Local group-revision fixture rejected this request.'}));providerRequests.push({fixtureError:error.message});}
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
        const { executionContextId } = await targetCommand(browser, target.targetId, 'Page.createIsolatedWorld', { frameId: node.frame.id, worldName: 'foundationGroupRevisionSmoke' });
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
const nativeActivations=[];
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
const pressOtherControl = async (browser, frame, selector) => {
  await evaluate(browser, frame, control(selector, 'element.focus(); if (document.activeElement !== element) throw new Error("Native control did not receive focus: "+element.outerHTML+"; disclosure="+element.closest("details")?.open+"; rects="+element.getClientRects().length); return true;'));
  await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ', unmodifiedText: ' ', windowsVirtualKeyCode: 32 });
  await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
};
const pressControl=async(browser,frame,selector)=>{
 const tag=await evaluate(browser,frame,control(selector,'return element.tagName;'));
 return tag==='BUTTON'?activateButton(browser,frame,selector):pressOtherControl(browser,frame,selector);
};
// Native webviews can replace a focused button while their first host snapshot
// settles. Verify actual activation rather than submitting in the previous mode.
const selectAssistantMode = async (browser, frame, intent) => {
  assert.ok(['ask', 'plan', 'build', 'review'].includes(intent));
  const label = intent[0].toUpperCase() + intent.slice(1),selector=`button[aria-label="${label} mode"]`;
  if(await evaluate(browser,frame,control(selector,'return element.getAttribute("aria-pressed") === "true";')))return selector;
  await pressControl(browser,frame,selector);
  await wait(async()=>await evaluate(browser,frame,control(selector,'return element.getAttribute("aria-pressed") === "true";')),`${label} mode selected after one native activation`,2000);
  return selector;
};
const setChecked = async (browser, frame, selector, checked) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!await evaluate(browser, frame, 'document.querySelector("details.assistant-setup").open'))
        await pressControl(browser, frame, 'summary[aria-label="Request context and model"]');
      await wait(async () => await evaluate(browser, frame, control(selector,
        'return document.querySelector("details.assistant-setup").open && element.getClientRects().length > 0 && !element.disabled;')),
      'source context is expanded and interactive', 2000);
      if (await evaluate(browser, frame, control(selector, 'return element.checked;')) !== checked)
        await pressControl(browser, frame, selector);
      await wait(async () => await evaluate(browser, frame, control(selector, 'return element.checked;')) === checked,
        'source selection matches the explicit fixture scope', 2000);
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
};
const fill=async(browser,frame,selector,text)=>{await evaluate(browser,frame,control(selector,'element.focus();element.select();return true;'));await targetCommand(browser,frame.targetId,'Input.insertText',{text});};
const inspectUI=async(browser,frame)=>evaluate(browser,frame,`({mode:[...document.querySelectorAll('button[aria-label$=" mode"]')].find(button=>button.getAttribute('aria-pressed')==='true')?.getAttribute('aria-label'),question:document.querySelector('textarea[aria-label="Ask about your source"]')?.value,prepared:document.querySelector('[aria-label="Refining a staged group"]')?.innerText||null,paths:[...document.querySelectorAll('input[data-context-path]:checked')].map(input=>input.dataset.contextPath).sort(),selectedFile:document.querySelector('dialog[open] select[aria-label="Changed file"]')?.value||null,executionRegion:document.querySelector('dialog[open] [aria-label="Check in isolation"]')?.innerText||null,artifacts:[...document.querySelectorAll('[data-artifact-id]')].map(card=>({id:card.dataset.artifactId,text:card.textContent})),text:document.body.innerText})`);
let browser;
try{
 for(const stage of ['write','restore']){
  const port=await debugPort(),ipc=path.join(temp,`${stage}-ipc`),outcome=path.join(temp,`${stage}-outcome.json`);await mkdir(ipc);
  const environment={...process.env,FOUNDATION_GROUP_REVISION_STAGE:stage,FOUNDATION_GROUP_REVISION_OUTCOME:outcome,FOUNDATION_GROUP_REVISION_REPORT:reportPath,FOUNDATION_GROUP_REVISION_IPC:ipc,FOUNDATION_GROUP_REVISION_EXTENSION:extensionPath,FOUNDATION_GROUP_REVISION_WORKSPACE:workspace};
  for(const key of Object.keys(environment))if(key==='ELECTRON_RUN_AS_NODE'||/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key))delete environment[key];
  Object.assign(environment,{FOUNDATION_AI_BASE_URL:providerURL,FOUNDATION_AI_MODEL:'foundation-local-group-revision-fixture',FOUNDATION_AI_PROVIDER_KIND:'compatible'});
  const log=await open(path.join(temp,`${stage}.log`),'w');
  const child=spawn(path.join(app,'Contents/MacOS/Foundation'),[workspace,'--new-window','--user-data-dir',userData,'--shared-data-dir',path.join(temp,'shared-data'),'--extensions-dir',extensions,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--disable-crash-reporter','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{env:environment,stdio:['ignore',log.fd,log.fd]});await log.close();
  let exited=false,exitCode,spawnError;child.once('exit',code=>{exited=true;exitCode=code;});child.once('error',error=>{exited=true;spawnError=error;});
  const deadline=Date.now()+240000;let commandIndex=1,result;
  try{
   while(!(result=await readJSON(outcome))){
    if(spawnError)throw spawnError;if(exited)throw Error(`${stage} exited before reporting. See ${temp}`);if(Date.now()>deadline)throw Error(`${stage} timed out. See ${temp}`);
    const command=await readJSON(path.join(ipc,`command-${commandIndex}.json`));if(!command){await pause(100);continue;}
    let answer;
    try{
     if(!browser)browser=await wait(()=>chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000}),'isolated native renderer endpoint');
     const frame=await surfaceFrame(browser,'assistant');
     if(command.type==='compose'){
      assert.equal(stage,'write');assert.equal(command.intent,'build');assert.equal(typeof command.question,'string');assert.ok(command.question.length<6000);
      const modeSelector=command.paths?await selectAssistantMode(browser,frame,command.intent):'button[aria-label="Build mode"]';
      if(command.paths){assert.ok(command.paths.every(value=>['src/label.mjs','src/api.mjs','src/consumer.mjs'].includes(value)));if(!await evaluate(browser,frame,'document.querySelector("details.assistant-setup").open'))await pressControl(browser,frame,'summary[aria-label="Request context and model"]');
       const available=await evaluate(browser,frame,'[...document.querySelectorAll("input[data-context-path]")].map(input=>input.dataset.contextPath)');assert.ok(command.paths.every(value=>available.includes(value)));
       for(const sourcePath of available)await setChecked(browser,frame,`input[data-context-path=${JSON.stringify(sourcePath)}]`,command.paths.includes(sourcePath));
      }
      await fill(browser,frame,'textarea[aria-label="Ask about your source"]',command.question);
      await wait(async()=>await evaluate(browser,frame,'document.querySelector("#ask-submit")?.disabled===false'),'explicit request becomes sendable');
      await activateButton(browser,frame,'#ask-submit',{mode:command.intent[0].toUpperCase()+command.intent.slice(1)+' mode',question:command.question,paths:[...(command.paths||['src/label.mjs','src/api.mjs','src/consumer.mjs'])].sort()});
     }else if(command.type==='openGroup'){
      assert.match(command.artifactId,/^[\da-f-]{36}$/);assert.ok(['src/label.mjs','src/api.mjs'].includes(command.path));
      const selector=`[data-artifact-id=${JSON.stringify('change-set/'+command.artifactId)}] button[aria-label=${JSON.stringify('Review '+command.path)}]`;
      await wait(async()=>await evaluate(browser,frame,control(selector,'return element.getClientRects().length>0 && !element.disabled;')),'review file visible');await pressControl(browser,frame,selector);
     }else if(command.type==='groupAction'){
      assert.ok(['Open native diff','Apply all','Undo all','Refine group','Restore version','Prepare workspace','Run check'].includes(command.label));
      const selector=await wait(async()=>await evaluate(browser,frame,`(() => {const button=[...document.querySelectorAll('dialog[open] button')].find(button=>button.textContent===${JSON.stringify(command.label)} && !button.disabled); return button?.dataset.artifactFocus;})()`),'explicit group action enabled');
      await pressControl(browser,frame,`dialog[open] button[data-artifact-focus=${JSON.stringify(selector)}]`);
     }else if(command.type==='stop'){
      assert.equal(await evaluate(browser,frame,'document.querySelector("#ask-submit").textContent'),'Stop');await pressControl(browser,frame,'#ask-submit');
     }else if(command.type==='closeDialog'){
      if(await evaluate(browser,frame,'Boolean(document.querySelector("dialog[open]"))'))await pressControl(browser,frame,'dialog[open] .artifact-close');
     }else assert.equal(command.type,'inspect');
     const renderer=await inspectUI(browser,frame);answer={passed:true,renderer,providerRequests:providerRequests.length,closedProviderRequests:[...closedProviderRequests]};
    }catch(error){answer={passed:false,error:error.stack||String(error)};}
    await writeFile(path.join(ipc,`result-${commandIndex}.json`),JSON.stringify(answer));commandIndex++;
   }
   assert.equal(result.passed,true,`${stage}: ${result.error||'Failed native check'}. See ${temp}`);while(!exited&&Date.now()<deadline)await pause(100);assert.equal(exited,true);assert.equal(exitCode,0);
   assert.equal(providerRequests.length,4);assert.ok(providerRequests.every(request=>!request.fixtureError));
  }catch(error){if(!exited){try{child.kill('SIGTERM');}catch{}}throw error;}
  finally{await browser?.close().catch(()=>{});browser=undefined;}
 }
 const report={...await readJSON(reportPath),passed:true,mode:'packaged',app,extensionPath,workspace,temp,provider:'loopback mock protocol fixture; environment-only, no credentials',providerRequests,closedProviderRequests,nativeActivations,nativeVisualAcceptance:'Not performed by this automated check'};
 assert.equal(report.restoredInSecondProcess,true);await writeFile(path.join(desktop,'.build','native-group-revision-smoke-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await writeFile(path.join(temp,'native-activations.json'),JSON.stringify(nativeActivations,null,2));await writeFile(path.join(temp,'mock-provider-requests.json'),JSON.stringify(providerRequests,null,2));await browser?.close().catch(()=>{});provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));}
