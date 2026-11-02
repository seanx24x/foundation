import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createServer as createHTTPServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,realpath,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.length>2)throw Error('Usage: node desktop/scripts/change-sets-smoke.mjs (packaged app only)');
const app=await realpath(process.env.FOUNDATION_APP_PATH||path.join(desktop,'.build/Foundation.app'));
const extensionPath=await realpath(path.join(app,'Contents/Resources/app/extensions/foundation-workspace'));
const temp=await realpath(await mkdtemp('/private/tmp/foundation-change-sets-smoke-'));
const workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions'),harness=path.join(extensions,'foundation-test.change-sets-native-check-1.0.0'),reportPath=path.join(temp,'report.json');
await Promise.all([mkdir(path.join(workspace,'src'),{recursive:true}),mkdir(path.join(userData,'User'),{recursive:true}),mkdir(harness,{recursive:true})]);
const fixture={
 'package.json':JSON.stringify({name:'foundation-change-sets-fixture',private:true}),
 'src/Button.tsx':"export function Button() {\n  return <button>Save profile</button>;\n}\n",
 'src/api.ts':"export async function saveProfile() {\n  return true;\n}\n",
 'src/consumer.ts':"export const useSavedProfile = true;\n",
 'src/Draft.ts':"export const unfinished = 'original saved draft';\n",
};
await Promise.all(Object.entries(fixture).map(([name,value])=>writeFile(path.join(workspace,name),value)));
await Promise.all([
 writeFile(path.join(userData,'User/settings.json'),JSON.stringify({'foundation.openOnStartup':true,'foundation.ai.baseUrl':'','foundation.ai.model':'','foundation.ai.profiles':{},'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never','security.workspace.trust.enabled':false,'files.hotExit':'onExitAndWindowClose','files.autoSave':'off','workbench.editor.enablePreview':false})),
 writeFile(path.join(harness,'package.json'),JSON.stringify({name:'change-sets-native-check',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),
 writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-change-sets-smoke.cjs'))),
]);
// A loopback protocol fixture, never a commercial model. Environment-only setup
// leaves all credential profiles empty and never reads or stores a Keychain key.
const providerRequests=[];
const provider=createHTTPServer(async(req,res)=>{
 try{
  assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,undefined);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const payload=JSON.parse(Buffer.concat(chunks)),input=JSON.parse(payload.messages[1].content);
  assert.equal(payload.model,'foundation-local-group-fixture');assert.equal(payload.tools,undefined);assert.equal(input.intent,'build');assert.equal(input.planContext,undefined);
  assert.deepEqual(input.sources.map(file=>file.path).sort(),['src/Button.tsx','src/api.ts','src/consumer.ts']);
  providerRequests.push({intent:input.intent,sources:input.sources.map(({content,...file})=>file),question:input.question});
  const output=JSON.stringify({title:'Coordinate save labels',summary:'Update the selected button and saved service result together.',edits:[{path:'src/Button.tsx',find:'>Save profile</button>',replace:'>Save changes</button>'},{path:'src/api.ts',find:'return true;',replace:'return false;'}],verification:['Inspect the save scenario.']});
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({model:'foundation-local-group-fixture',choices:[{delta:{content:output},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})}\n\ndata: [DONE]\n\n`);
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Local group fixture rejected this request.'}));providerRequests.push({fixtureError:error.message});}
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
        const { executionContextId } = await targetCommand(browser, target.targetId, 'Page.createIsolatedWorld', { frameId: node.frame.id, worldName: 'foundationGroupsSmoke' });
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
// Native webviews can replace a focused button while their first host snapshot
// settles. Verify actual activation rather than submitting in the previous mode.
const selectAssistantMode = async (browser, frame, intent) => {
  assert.ok(['ask', 'plan', 'build', 'review'].includes(intent));
  const label = intent[0].toUpperCase() + intent.slice(1);
  const selector = `button[aria-label="${label} mode"]`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await pressControl(browser, frame, selector);
      await wait(async () => await evaluate(browser, frame,
        control(selector, 'return element.getAttribute("aria-pressed") === "true";')),
      `${label} mode selected after native keyboard activation`, 2000);
      return selector;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
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
const inspectUI=async(browser,frame)=>evaluate(browser,frame,`({mode:[...document.querySelectorAll('button[aria-label$=" mode"]')].find(button=>button.getAttribute('aria-pressed')==='true')?.getAttribute('aria-label'),question:document.querySelector('textarea[aria-label="Ask about your source"]')?.value,paths:[...document.querySelectorAll('input[data-context-path]:checked')].map(input=>input.dataset.contextPath).sort(),selectedFile:document.querySelector('dialog[open] select[aria-label="Changed file"]')?.value||null,artifacts:[...document.querySelectorAll('[data-artifact-id]')].map(card=>({id:card.dataset.artifactId,text:card.textContent})),text:document.body.innerText})`);
let browser;
try{
 for(const stage of ['write','restore']){
  const port=await debugPort(),ipc=path.join(temp,`${stage}-ipc`),outcome=path.join(temp,`${stage}-outcome.json`);await mkdir(ipc);
  const environment={...process.env,FOUNDATION_GROUPS_STAGE:stage,FOUNDATION_GROUPS_OUTCOME:outcome,FOUNDATION_GROUPS_REPORT:reportPath,FOUNDATION_GROUPS_IPC:ipc,FOUNDATION_GROUPS_EXTENSION:extensionPath,FOUNDATION_GROUPS_WORKSPACE:workspace};
  for(const key of Object.keys(environment))if(key==='ELECTRON_RUN_AS_NODE'||/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key))delete environment[key];
  Object.assign(environment,{FOUNDATION_AI_BASE_URL:providerURL,FOUNDATION_AI_MODEL:'foundation-local-group-fixture',FOUNDATION_AI_PROVIDER_KIND:'compatible'});
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
      const modeSelector=await selectAssistantMode(browser,frame,command.intent);
      if(command.paths){assert.ok(command.paths.every(value=>['src/Button.tsx','src/api.ts','src/consumer.ts'].includes(value)));if(!await evaluate(browser,frame,'document.querySelector("details.assistant-setup").open'))await pressControl(browser,frame,'summary[aria-label="Request context and model"]');
       const available=await evaluate(browser,frame,'[...document.querySelectorAll("input[data-context-path]")].map(input=>input.dataset.contextPath)');assert.ok(command.paths.every(value=>available.includes(value)));
       for(const sourcePath of available)await setChecked(browser,frame,`input[data-context-path=${JSON.stringify(sourcePath)}]`,command.paths.includes(sourcePath));
      }
      await fill(browser,frame,'textarea[aria-label="Ask about your source"]',command.question);
      // A source refresh may disable Send between the readiness read and focus.
      // Retry only a proven focus refusal before any keyboard event is sent.
      for(let attempt=0;attempt<3;attempt++){
       await wait(async()=>await evaluate(browser,frame,'document.querySelector("#ask-submit")?.disabled===false'),'explicit request becomes sendable');
       assert.equal(await evaluate(browser,frame,control(modeSelector,'return element.getAttribute("aria-pressed");')),'true','The selected mode must remain active through context selection and typing');
       assert.equal(await evaluate(browser,frame,`document.querySelector('textarea[aria-label="Ask about your source"]').value`),command.question);
       assert.deepEqual(await evaluate(browser,frame,'[...document.querySelectorAll("input[data-context-path]:checked")].map(input=>input.dataset.contextPath).sort()'),[...(command.paths||['src/Button.tsx','src/api.ts','src/consumer.ts'])].sort(),'The explicitly selected source context must remain unchanged');
       try{await pressControl(browser,frame,'#ask-submit');break;}catch(error){if(attempt===2||!error.message.includes('Native control did not receive focus:')||!error.message.includes('id="ask-submit" disabled=""'))throw error;}
      }
     }else if(command.type==='openGroup'){
      assert.match(command.artifactId,/^[\da-f-]{36}$/);assert.ok(['src/Button.tsx','src/api.ts'].includes(command.path));
      const selector=`[data-artifact-id=${JSON.stringify('change-set/'+command.artifactId)}] button[aria-label=${JSON.stringify('Review '+command.path)}]`;
      await wait(async()=>await evaluate(browser,frame,control(selector,'return element.getClientRects().length>0 && !element.disabled;')),'review file visible');await pressControl(browser,frame,selector);
     }else if(command.type==='groupAction'){
      assert.ok(['Open native diff','Apply all','Undo all'].includes(command.label));
      const selector=await wait(async()=>await evaluate(browser,frame,`(() => {const button=[...document.querySelectorAll('dialog[open] button')].find(button=>button.textContent===${JSON.stringify(command.label)} && !button.disabled); return button?.dataset.artifactFocus;})()`),'explicit group action enabled');
      await pressControl(browser,frame,`dialog[open] button[data-artifact-focus=${JSON.stringify(selector)}]`);
     }else if(command.type==='closeDialog'){
      if(await evaluate(browser,frame,'Boolean(document.querySelector("dialog[open]"))'))await pressControl(browser,frame,'dialog[open] .artifact-close');
     }else assert.equal(command.type,'inspect');
     const renderer=await inspectUI(browser,frame);answer={passed:true,renderer,providerRequests:providerRequests.length};
    }catch(error){answer={passed:false,error:error.stack||String(error)};}
    await writeFile(path.join(ipc,`result-${commandIndex}.json`),JSON.stringify(answer));commandIndex++;
   }
   assert.equal(result.passed,true,`${stage}: ${result.error||'Failed native check'}. See ${temp}`);while(!exited&&Date.now()<deadline)await pause(100);assert.equal(exited,true);assert.equal(exitCode,0);
   assert.equal(providerRequests.length,1);assert.ok(providerRequests.every(request=>!request.fixtureError));
  }catch(error){if(!exited){try{child.kill('SIGTERM');}catch{}}throw error;}
  finally{await browser?.close().catch(()=>{});browser=undefined;}
 }
 const report={...await readJSON(reportPath),passed:true,mode:'packaged',app,extensionPath,workspace,temp,provider:'loopback mock protocol fixture; environment-only, no credentials',providerRequests,nativeVisualAcceptance:'Not performed by this automated check'};
 assert.equal(report.restoredInSecondProcess,true);await writeFile(path.join(desktop,'.build','native-change-sets-smoke-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await writeFile(path.join(temp,'mock-provider-requests.json'),JSON.stringify(providerRequests,null,2));await browser?.close().catch(()=>{});provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));}
