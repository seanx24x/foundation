import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createServer as createHTTPServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,realpath,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.length>2)throw Error('Usage: node desktop/scripts/source-investigation-smoke.mjs (packaged app only)');
const app=await realpath(process.env.FOUNDATION_APP_PATH||path.join(desktop,'.build/Foundation.app'));
const extensionPath=await realpath(path.join(app,'Contents/Resources/app/extensions/foundation-workspace'));
const temp=await realpath(await mkdtemp('/private/tmp/foundation-source-investigation-smoke-'));
const workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions'),harness=path.join(extensions,'foundation-test.source-investigation-native-check-1.0.0'),reportPath=path.join(temp,'report.json');
await Promise.all([mkdir(path.join(workspace,'src'),{recursive:true}),mkdir(path.join(userData,'User'),{recursive:true}),mkdir(harness,{recursive:true})]);
const fixture={
 'package.json':JSON.stringify({name:'foundation-source-investigation-fixture',private:true}),
 'src/App.tsx':"import {SaveButton} from './SaveButton';\nexport function App() { return <SaveButton state='idle' />; }\n",
 'src/SaveButton.tsx':"import {saveProfile} from './api';\nimport type {SaveState} from './types';\nimport './styles.css';\nexport function SaveButton({state}: {state:SaveState}) {\n  const save = async () => { await saveProfile(); };\n  return <button onClick={save}>{state}</button>;\n}\n",
 'src/api.ts':"export async function saveProfile() {\n  return fetch('/api/profile?token=PRIVATE_RELATED_QUERY#PRIVATE_FRAGMENT', {method:'POST'});\n}\n",
 'src/types.ts':"export type SaveState = 'idle' | 'loading' | 'error';\n",
 'src/styles.css':':root { --button-radius: 8px; }\n',
 'src/SaveButton.spec.tsx':"export const filenameCandidateOnly = 'PRIVATE_FILENAME_CANDIDATE';\n",
 'src/PRIVATE_UNRELATED.ts':"export const privateValue = 'PRIVATE_UNSHARED_SOURCE';\n",
 'src/Draft.ts':"export const unfinished = 'original saved draft';\n",
};
await Promise.all(Object.entries(fixture).map(([name,value])=>writeFile(path.join(workspace,name),value)));
await Promise.all([
 writeFile(path.join(userData,'User/settings.json'),JSON.stringify({'foundation.openOnStartup':true,'foundation.ai.baseUrl':'','foundation.ai.model':'','foundation.ai.profiles':{},'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never','security.workspace.trust.enabled':false,'files.hotExit':'onExitAndWindowClose','files.autoSave':'off','workbench.editor.enablePreview':false})),
 writeFile(path.join(harness,'package.json'),JSON.stringify({name:'source-investigation-native-check',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),
 writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-source-investigation-smoke.cjs'))),
]);
const providerRequests=[];
const provider=createHTTPServer(async(req,res)=>{
 try{
  assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,undefined);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const payload=JSON.parse(Buffer.concat(chunks)),input=JSON.parse(payload.messages[1].content),number=providerRequests.length+1;
  assert.ok(number<=2,'Only two explicitly sent investigation questions may call the provider');
  assert.equal(payload.model,'foundation-local-investigation-fixture');assert.equal(payload.tools,undefined);assert.equal(input.intent,'ask');
  for(const key of ['taskContext','runtimeEvidence','planContext','requestRevision','groupRevision','checkContext'])assert.equal(input[key],undefined);
  assert.deepEqual(input.sources.map(file=>file.path),['src/SaveButton.tsx']);assert.match(input.sources[0].content,/saveProfile/);
  const evidence=input.sourceInvestigation;assert.ok(evidence);assert.deepEqual(Object.keys(evidence).sort(),['anchorPath','boundaries','counts','edges','requests','truncated']);assert.equal(evidence.anchorPath,'src/SaveButton.tsx');assert.ok(evidence.edges.length>0);assert.ok(evidence.edges.every((edge,index)=>edge.id===`I${index+1}`&&edge.provenance==='source'));
  assert.doesNotMatch(JSON.stringify(payload),/PRIVATE_RELATED_QUERY|PRIVATE_FRAGMENT|PRIVATE_FILENAME_CANDIDATE|PRIVATE_UNSHARED_SOURCE|PRIVATE_UNRELATED|PRIVATE_ENV_VALUE|PRIVATE_UNSAVED_DRAFT|INVESTIGATION_PREVIOUS_ANSWER|basisDigest|snapshotId|featureId|conversationId|manifest/);
  assert.equal(evidence.edges.some(edge=>edge.kind==='call'&&edge.to.path==='src/api.ts'),number===1,'The second explicit refresh must retire the changed saved API call');
  providerRequests.push({intent:input.intent,question:input.question,sources:input.sources.map(({content,...file})=>file),evidence});
  const text=number===1?'INVESTIGATION_PREVIOUS_ANSWER: the saved button calls saveProfile [S1:5]. I1 is source evidence; runtime order and backend effects remain unknown.':'The refreshed source investigation no longer resolves the earlier API call. This is static source evidence, not a runtime or test result.';
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({model:payload.model,choices:[{delta:{content:text},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})}\n\ndata: [DONE]\n\n`);
 }catch(error){if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Local investigation fixture rejected this request.'}));providerRequests.push({fixtureError:error.message});}
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
const pressControl = async (browser, frame, selector) => {
  await evaluate(browser, frame, control(selector, 'element.focus(); if (document.activeElement !== element) throw new Error("Native control did not receive focus: "+element.outerHTML+"; disclosure="+element.closest("details")?.open+"; rects="+element.getClientRects().length); return true;'));
  await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ', unmodifiedText: ' ', windowsVirtualKeyCode: 32 });
  await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
};
const setChecked=async(browser,frame,selector,checked)=>{if(selector.startsWith('input[data-context-path=')){if(!await evaluate(browser,frame,'document.querySelector("details.assistant-setup").open'))await pressControl(browser,frame,'summary[aria-label="Request context and model"]');await wait(async()=>await evaluate(browser,frame,control(selector,'return element.getClientRects().length>0 && !element.disabled;')),'source context is visible');}if(await evaluate(browser,frame,control(selector,'return element.checked;'))!==checked)await pressControl(browser,frame,selector);};
const fill=async(browser,frame,selector,text)=>{await evaluate(browser,frame,control(selector,'element.focus();element.select();return true;'));await targetCommand(browser,frame.targetId,'Input.insertText',{text});};

const inspectUI=async(browser,frame)=>evaluate(browser,frame,`(()=>{const region=document.querySelector('[aria-label="Source investigation"]');return {mode:[...document.querySelectorAll('button[aria-label$=" mode"]')].find(button=>button.getAttribute('aria-pressed')==='true')?.getAttribute('aria-label'),question:document.querySelector('textarea[aria-label="Ask about your source"]')?.value,paths:[...document.querySelectorAll('input[data-context-path]:checked')].map(input=>input.dataset.contextPath).sort(),submitDisabled:document.querySelector('#ask-submit')?.disabled,investigation:region?.innerText||null,evidenceJSON:region?.querySelector('.source-investigation-json')?.textContent||null,shared:[...document.querySelectorAll('[aria-label="Shared source investigation"]')].map(item=>item.innerText),text:document.body.innerText};})()`);
const sendOnce=async(browser,frame,question)=>{
 let ready=false;
 for(let attempt=0;attempt<3;attempt++){
  await wait(async()=>await evaluate(browser,frame,'document.querySelector("#ask-submit")?.disabled===false'),'explicit investigation becomes sendable');
  const observed=await inspectUI(browser,frame);assert.equal(observed.mode,'Ask mode');assert.equal(observed.question,question);assert.deepEqual(observed.paths,['src/SaveButton.tsx']);assert.ok(observed.investigation);
  ready=await evaluate(browser,frame,`(async()=>{const button=document.querySelector('#ask-submit');if(!button||button.disabled)return false;button.focus();await new Promise(resolve=>setTimeout(resolve,120));return button===document.querySelector('#ask-submit')&&!button.disabled&&document.activeElement===button&&document.querySelector('textarea[aria-label="Ask about your source"]').value===${JSON.stringify(question)};})()`);if(ready)break;
 }
 assert.equal(ready,true,'Exact disclosed investigation must retain native Send focus before activation');
 await targetCommand(browser,frame.targetId,'Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',unmodifiedText:' ',windowsVirtualKeyCode:32});
 await targetCommand(browser,frame.targetId,'Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
};
let browser;
try{
 for(const stage of ['write','restore']){
  const port=await debugPort(),ipc=path.join(temp,`${stage}-ipc`),outcome=path.join(temp,`${stage}-outcome.json`);await mkdir(ipc);
  const environment={...process.env,FOUNDATION_INVESTIGATION_STAGE:stage,FOUNDATION_INVESTIGATION_OUTCOME:outcome,FOUNDATION_INVESTIGATION_REPORT:reportPath,FOUNDATION_INVESTIGATION_IPC:ipc,FOUNDATION_INVESTIGATION_EXTENSION:extensionPath,FOUNDATION_INVESTIGATION_WORKSPACE:workspace};
  for(const key of Object.keys(environment))if(key==='ELECTRON_RUN_AS_NODE'||/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key))delete environment[key];
  Object.assign(environment,{FOUNDATION_AI_BASE_URL:providerURL,FOUNDATION_AI_MODEL:'foundation-local-investigation-fixture',FOUNDATION_AI_PROVIDER_KIND:'compatible',FOUNDATION_FIXTURE_PRIVATE:'PRIVATE_ENV_VALUE'});
  const log=await open(path.join(temp,`${stage}.log`),'w');
  const child=spawn(path.join(app,'Contents/MacOS/Foundation'),[workspace,'--new-window','--user-data-dir',userData,'--shared-data-dir',path.join(temp,'shared-data'),'--extensions-dir',extensions,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--disable-crash-reporter','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{env:environment,stdio:['ignore',log.fd,log.fd]});await log.close();
  let exited=false,exitCode,spawnError;child.once('exit',code=>{exited=true;exitCode=code;});child.once('error',error=>{exited=true;spawnError=error;});const deadline=Date.now()+240000;let commandIndex=1,result;
  try{
   while(!(result=await readJSON(outcome))){
    if(spawnError)throw spawnError;if(exited)throw Error(`${stage} exited before reporting. See ${temp}`);if(Date.now()>deadline)throw Error(`${stage} timed out. See ${temp}`);
    const command=await readJSON(path.join(ipc,`command-${commandIndex}.json`));if(!command){await pause(100);continue;}let answer;
    try{
     if(!browser)browser=await wait(()=>chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000}),'isolated native renderer endpoint');
     if(command.type==='investigate'){
      const workspaceFrame=await surfaceFrame(browser,'workspace');const selector='[aria-label="Feature relationships"] button[data-design-focus="relationship/investigate"]';await wait(async()=>await evaluate(browser,workspaceFrame,control(selector,'return !element.disabled;')),'fresh relationship sharing control');await pressControl(browser,workspaceFrame,selector);
     }else{
      const frame=await surfaceFrame(browser,'assistant');
      if(command.type==='draft'){assert.equal(typeof command.question,'string');assert.ok(command.question.length<6000);await fill(browser,frame,'textarea[aria-label="Ask about your source"]',command.question);}
      else if(command.type==='send'){assert.equal(typeof command.question,'string');await sendOnce(browser,frame,command.question);}
      else if(command.type==='refreshInvestigation'){const selector=await wait(async()=>await evaluate(browser,frame,`[...document.querySelectorAll('[aria-label="Source investigation"] button')].find(button=>button.textContent==='Refresh investigation'&&!button.disabled)?.dataset.artifactFocus`),'explicit investigation refresh');await pressControl(browser,frame,`button[data-artifact-focus=${JSON.stringify(selector)}]`);}
      else assert.equal(command.type,'inspect');
     }
     const frame=await surfaceFrame(browser,'assistant');answer={passed:true,renderer:await inspectUI(browser,frame),providerRequests:providerRequests.length};
    }catch(error){answer={passed:false,error:error.stack||String(error)};}
    await writeFile(path.join(ipc,`result-${commandIndex}.json`),JSON.stringify(answer));commandIndex++;
   }
   assert.equal(result.passed,true,`${stage}: ${result.error||'Failed native check'}. See ${temp}`);while(!exited&&Date.now()<deadline)await pause(100);assert.equal(exited,true);assert.equal(exitCode,0);assert.equal(providerRequests.length,stage==='write'?1:2);assert.ok(providerRequests.every(request=>!request.fixtureError));
  }catch(error){if(!exited){try{child.kill('SIGTERM');}catch{}}throw error;}finally{await browser?.close().catch(()=>{});browser=undefined;}
 }
 const report={...await readJSON(reportPath),passed:true,mode:'packaged',app,extensionPath,workspace,temp,provider:'loopback mock only; no credentials',providerRequests,nativeVisualAcceptance:'Not performed by this automated check'};assert.equal(report.restoredInSecondProcess,true);await writeFile(path.join(desktop,'.build','native-source-investigation-smoke-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await writeFile(path.join(temp,'mock-provider-requests.json'),JSON.stringify(providerRequests,null,2));await browser?.close().catch(()=>{});provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));}
