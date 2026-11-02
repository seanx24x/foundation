import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {readFile,writeFile,mkdir,mkdtemp,realpath,open,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert.equal(process.argv.length,2,'Usage: FOUNDATION_APP_PATH=/candidate/Foundation.app node desktop/scripts/change-impact-smoke.mjs');
assert.ok(process.env.FOUNDATION_APP_PATH,'Choose the exact isolated signed candidate');
const app=await realpath(process.env.FOUNDATION_APP_PATH),extensionPath=await realpath(path.join(app,'Contents/Resources/app/extensions/foundation-workspace'));
const temp=await realpath(await mkdtemp('/private/tmp/foundation-change-impact-smoke-')),workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions'),harness=path.join(extensions,'foundation-test.change-impact-native-check-1.0.0'),reportPath=path.join(temp,'report.json');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashTree=async root=>{const values=[];async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){if(item.name==='node_modules')continue;const file=path.join(dir,item.name);assert.equal(item.isSymbolicLink(),false,'Fixture and package inputs must be ordinary files');if(item.isDirectory())await walk(file);else if(item.isFile()){const bytes=await readFile(file);values.push({path:path.relative(root,file).split(path.sep).join('/'),bytes:bytes.length,sha256:digest(bytes)});}}}await walk(root);return values.sort((a,b)=>a.path.localeCompare(b.path));};
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
const binarySha256=digest(await readFile(path.join(app,'Contents/MacOS/Foundation'))),payload=await hashTree(extensionPath);
await Promise.all([mkdir(path.join(workspace,'src'),{recursive:true}),mkdir(path.join(userData,'User'),{recursive:true}),mkdir(harness,{recursive:true})]);
const fixture={
 'package.json':JSON.stringify({name:'foundation-change-impact-fixture',private:true,type:'module',scripts:{dev:'vite --host 127.0.0.1'},devDependencies:{vite:'8.0.13'},dependencies:{react:'19.2.4'}}),
 'src/App.tsx':"import { SaveButton } from './SaveButton';\nexport default function App() { return <main><h1>Profile</h1><SaveButton /></main>; }\n",
 'src/SaveButton.tsx':"import './styles.css';\nexport function SaveButton() { return <button data-impact-save='true' data-foundation-source='src/SaveButton.tsx'>Save profile</button>; }\n",
 'src/styles.css':":root { --button-radius: 8px; --brand: #34674e; }\nmain { max-width: 480px; margin: 80px auto; padding: 32px; font-family: system-ui; }\nbutton { border-radius: var(--button-radius); background: var(--brand); color: white; border: 0; padding: 12px 24px; }\n",
};
await Promise.all(Object.entries(fixture).map(([file,value])=>writeFile(path.join(workspace,file),value)));
const initialFixture=await hashTree(workspace);
await Promise.all([writeFile(path.join(userData,'User/settings.json'),JSON.stringify({'foundation.openOnStartup':false,'foundation.ai.baseUrl':'','foundation.ai.model':'','foundation.ai.profiles':{},'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never','security.workspace.trust.enabled':false,'files.hotExit':'onExitAndWindowClose','files.autoSave':'off','window.zoomLevel':0})),writeFile(path.join(harness,'package.json'),JSON.stringify({name:'change-impact-native-check',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-change-impact-smoke.cjs')))]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJSON = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; } };
const wait = async (check, label, timeout = 25000) => {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { const value = await check(); if (value) return value; } catch (error) { last = error; } await pause(100); }
  throw Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
};
const debugPort = async () => {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
};
// Read and operate the actual native webview through its renderer target. Only
// buttons/disclosures use trusted keyboard input. Selects use a standard
// selectOption-equivalent DOM operation on the visible native control, explicitly
// recorded as synthetic. No host messages, acquireVsCodeApi, renderer closures,
// or application handlers are injected.
const withTarget = async (browser, targetId, callback) => {
  const root = await browser.newBrowserCDPSession(); let sessionId, serial = 0; const pending = new Map();
  const listener = event => {
    if (event.sessionId !== sessionId) return;
    const value = JSON.parse(event.message), item = pending.get(value.id); if (!item) return;
    pending.delete(value.id); clearTimeout(item.timer); value.error ? item.reject(Error(value.error.message)) : item.resolve(value.result);
  };
  const detached = event => { if (event.sessionId === sessionId) for (const item of pending.values()) item.reject(Error('Native comparison renderer detached')); };
  try {
    sessionId = (await root.send('Target.attachToTarget', { targetId, flatten: false })).sessionId;
    root.on('Target.receivedMessageFromTarget', listener); root.on('Target.detachedFromTarget', detached);
    const send = async (method, params = {}) => {
      const id = ++serial, result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`Native renderer timeout: ${method}`)); }, 10000);
        pending.set(id, { resolve, reject, timer });
      });
      await root.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }); return result;
    };
    return await callback(send);
  } finally {
    root.off('Target.receivedMessageFromTarget', listener); root.off('Target.detachedFromTarget', detached);
    for (const item of pending.values()) clearTimeout(item.timer);
    if (sessionId) await root.send('Target.detachFromTarget', { sessionId }).catch(() => {}); await root.detach();
  }
};
const readOn = async (send, frame, expression) => {
  const value = await send('Runtime.evaluate', { expression, contextId: frame.contextId, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text); return value.result.value;
};
const evaluate = (browser, frame, expression) => withTarget(browser, frame.targetId, send => readOn(send, frame, expression));
const surfaceFrame = browser => wait(async () => {
  const session = await browser.newBrowserCDPSession(); let targets;
  try { targets = (await session.send('Target.getTargets')).targetInfos; } finally { await session.detach(); }
  const matches = [];
  for (const target of targets.filter(item => item.url.startsWith('vscode-webview://'))) {
    try {
      await withTarget(browser, target.targetId, async send => {
        const { frameTree } = await send('Page.getFrameTree');
        const visit = async node => {
          const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: node.frame.id, worldName: 'foundationChangeImpactSmoke' });
          const frame = { targetId: target.targetId, contextId: executionContextId, webviewId:new URL(target.url).searchParams.get('id') };
          if (await readOn(send, frame, 'document.body?.dataset.foundationSurface') === 'workspace') matches.push(frame);
          for (const child of node.childFrames || []) await visit(child);
        }; await visit(frameTree);
      });
    } catch {}
  }
  assert.ok(matches.length <= 1, 'Only one native Foundation workspace may be live'); return matches[0];
}, 'native Foundation workspace renderer');
const activations = [];
const keyboard = async (browser, frame, selector, key, expectClick = false, beforeDispatch) => withTarget(browser, frame.targetId, async send => {
  await wait(()=>readOn(send,frame,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return Boolean(e&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&e.getClientRects().length);})()`),'native control ready: '+selector);
  const entry = { selector, key, dispatched: false }; activations.push(entry);
  entry.before = await readOn(send, frame, `(async()=>{const selector=${JSON.stringify(selector)};for(let n=0;n<3;n++){const element=document.querySelector(selector);if(!element||element.disabled||!element.getClientRects().length)continue;element.scrollIntoView({block:'nearest'});element.focus();await new Promise(r=>setTimeout(r,120));if(element===document.querySelector(selector)&&document.activeElement===element&&!element.disabled&&document.hasFocus()){const observed={element,events:[]};observed.listener=event=>observed.events.push({type:event.type,key:event.key,trusted:event.isTrusted,same:event.target===element,current:event.target===document.querySelector(selector),targetLabel:event.target.getAttribute?.("aria-label"),targetFocus:event.target.dataset?.designFocus,value:event.target.value});globalThis.__comparisonKeys=observed;for(const type of ['keydown','keyup','click','change'])window.addEventListener(type,observed.listener,true);return {ready:true,tag:element.tagName,value:element.value};}}return {ready:false,hasFocus:document.hasFocus(),active:document.activeElement?.tagName};})()`);
  assert.equal(entry.before.ready, true, `Native focus readiness: ${JSON.stringify(entry.before)}`);
  const keys = { Enter: ['Enter', 13, '\r'], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38], ' ': ['Space', 32, ' '] };
  assert.ok(keys[key]); const [code, windowsVirtualKeyCode, text] = keys[key];
  try {
    if (beforeDispatch) await beforeDispatch();
    entry.dispatched = true;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(text ? { text, unmodifiedText: text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  } finally {
    entry.events = await readOn(send, frame, `(()=>{const observed=globalThis.__comparisonKeys;for(const type of ['keydown','keyup','click','change'])window.removeEventListener(type,observed.listener,true);delete globalThis.__comparisonKeys;return observed.events;})()`);
  }
  assert.ok(entry.events.some(event => event.type === 'keydown' && event.key === key && event.trusted && (event.same || event.current)), 'Trusted keyboard input must reach the exact native control');
  if (expectClick) assert.equal(entry.events.filter(event => event.type === 'click' && event.trusted && (event.same || event.current)).length, 1, 'One trusted activation; never retry after dispatch');
});
const disclosure = async (browser, frame, selector) => {
  await wait(() => evaluate(browser, frame, `Boolean(document.querySelector(${JSON.stringify(selector)}))`), 'native disclosure exists');
  if (!await evaluate(browser, frame, `document.querySelector(${JSON.stringify(selector)}).parentElement.open`)) {
    await keyboard(browser, frame, selector, 'Enter', true);
    await wait(() => evaluate(browser, frame, `document.querySelector(${JSON.stringify(selector)}).parentElement.open`), 'native disclosure expands');
  }
};
const nativeWorkbench=async browser=>{const session=await browser.newBrowserCDPSession();let targets;try{targets=(await session.send('Target.getTargets')).targetInfos;}finally{await session.detach();}const matches=targets.filter(target=>target.type==='page'&&target.url.includes('/workbench/workbench.html'));assert.equal(matches.length,1,'One isolated native workbench target');return withTarget(browser,matches[0].targetId,async send=>{const {frameTree}=await send('Page.getFrameTree'),{executionContextId}=await send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'foundationChangeImpactWorkbench'});return {targetId:matches[0].targetId,contextId:executionContextId};});};
const nativeWindowScreenshot=async(browser,main,viewport,file)=>withTarget(browser,main.targetId,async send=>{const result=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),bytes=Buffer.from(result.data,'base64');await writeFile(file,bytes);return bytes;});
const openNamedDetails=async(browser,frame,label,scope='')=>{const keys=await wait(async()=>{const values=await evaluate(browser,frame,`[...document.querySelectorAll(${JSON.stringify((scope?scope+' ':'')+'summary')})].filter(e=>e.textContent.trim()===${JSON.stringify(label)}).map(e=>e.dataset.artifactFocus||e.dataset.designFocus)`);return values.length?values:false;},'rendered disclosure '+label);for(const key of keys)await disclosure(browser,frame,`summary[data-artifact-focus=${JSON.stringify(key)}],summary[data-design-focus=${JSON.stringify(key)}]`);return keys.length;};

const fillText=async(browser,frame,label,value)=>{
 const selector=`input[aria-label=${JSON.stringify(label)}]`;await wait(()=>evaluate(browser,frame,`Boolean(document.querySelector(${JSON.stringify(selector)})?.getClientRects().length)`),'visible suite text field');
 const entry={selector,value,method:'native-renderer fill-equivalent',trustedKeyboard:false};activations.push(entry);
 await evaluate(browser,frame,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Suite field unavailable');e.scrollIntoView({block:'nearest'});e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
};


const impactUI=(browser,frame)=>evaluate(browser,frame,`(()=>{const input=document.querySelector('.token-value-input'),review=document.querySelector('[data-design-focus="impact/token/review"]');return {tokenText:document.querySelector('[aria-label="Token change impact"]')?.textContent||'',sourceText:document.querySelector('[aria-label="Source change impact"]')?.textContent||'',reviewText:document.querySelector('[aria-label="Reviewed change impact"]')?.textContent||'',input:input?{value:input.value,start:input.selectionStart,end:input.selectionEnd}:null,inputFocused:input===document.activeElement,sameInput:input===globalThis.__impactInput,reviewDisabled:review?.disabled,applyVisible:[...document.querySelectorAll('button')].some(node=>node.textContent.trim()==='Apply to source'),theme:document.body.dataset.vscodeThemeName};})()`);
const componentFrame=browser=>wait(async()=>{
 const session=await browser.newBrowserCDPSession();let targets;try{targets=(await session.send('Target.getTargets')).targetInfos;}finally{await session.detach();}const matches=[];
 for(const target of targets.filter(item=>item.url.startsWith('vscode-webview://') || item.type==='iframe' && item.url==='about:srcdoc')){try{await withTarget(browser,target.targetId,async send=>{const {frameTree}=await send('Page.getFrameTree');const visit=async node=>{const {executionContextId}=await send('Page.createIsolatedWorld',{frameId:node.frame.id,worldName:'foundationChangeImpactCanvas'});const frame={targetId:target.targetId,contextId:executionContextId,frameId:node.frame.id};if(await readOn(send,frame,'Boolean(parent!==window && document.querySelector("[data-impact-save]"))') && !matches.some(item=>item.frameId===frame.frameId))matches.push(frame);for(const child of node.childFrames||[])await visit(child);};await visit(frameTree);});}catch{}}
 assert.ok(matches.length<=1,'One saved-source fixture canvas');return matches[0];
},'mapped native preview element');
const ensureInspector=async(browser,frame)=>{
 const visible=await evaluate(browser,frame,`Boolean(document.querySelector('.design-inspector')?.getClientRects().length && getComputedStyle(document.querySelector('.design-inspector')).visibility!=='hidden')`);
 if(!visible)await keyboard(browser,frame,'button.inspector-toggle','Enter',true);
};
const details=async(browser,frame,kind)=>{
 const scope=kind==='review'?'[aria-label="Reviewed change impact"]':kind==='component'?'[aria-label="Source change impact"]':'[aria-label="Token change impact"]';
 const labels=await wait(async()=>{const labels=await evaluate(browser,frame,`[...document.querySelectorAll(${JSON.stringify(scope+' summary')})].map(e=>e.textContent.trim()).filter(text=>text.startsWith('Source uses')||text.startsWith('Scenarios to check'))`);return labels.some(text=>text.startsWith('Scenarios to check'))?labels:false;},'rendered impact evidence details');
 for(const label of labels)await openNamedDetails(browser,frame,label,scope);
 return impactUI(browser,frame);
};
const editToken=async(browser,frame,name,value,selection)=>{
 const selector=`input[aria-label=${JSON.stringify('Experiment value for '+name)}]`;
 await withTarget(browser,frame.targetId,async send=>{
  await readOn(send,frame,`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input||input.disabled)throw Error('Token experiment is unavailable');input.scrollIntoView({block:'nearest'});input.focus();input.select();globalThis.__impactInput=input;})()`);
  const entry={selector,method:'CDP Input.insertText',value,physicalKeyboard:false};activations.push(entry);await send('Input.insertText',{text:value});
  entry.result=await readOn(send,frame,`(()=>{const input=document.querySelector(${JSON.stringify(selector)});${selection?`input.setSelectionRange(${selection[0]},${selection[1]});`:''}return {value:input.value,focused:document.activeElement===input,start:input.selectionStart,end:input.selectionEnd};})()`);assert.equal(entry.result.value,value);assert.equal(entry.result.focused,true);
 });
};
const nativeFocusGates=[],activeGroups=new Set();
const groupAlive=pid=>{try{process.kill(-pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
const stopGroup=async pid=>{
 if(!activeGroups.has(pid))return;
 for(const signal of ['SIGTERM','SIGKILL']){
  if(!groupAlive(pid))break;
  try{process.kill(-pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}
  const end=Date.now()+3000;while(groupAlive(pid)&&Date.now()<end)await pause(100);
 }
 assert.equal(groupAlive(pid),false,`Isolated native process group ${pid} did not exit after TERM and KILL`);
 activeGroups.delete(pid);
};
let stopping=false;
for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]])process.on(signal,async()=>{if(stopping)return;stopping=true;await Promise.all([...activeGroups].map(stopGroup));process.exit(code);});
let browser;
try{
 for(const stage of ['write','restore']){
  assert.equal(stopping,false,'Native verification was cancelled before the next process');
  const port=await debugPort(),ipc=path.join(temp,`${stage}-ipc`),outcome=path.join(temp,`${stage}-outcome.json`);await mkdir(ipc);
  const env={...process.env,FOUNDATION_IMPACT_APP:app,FOUNDATION_IMPACT_STAGE:stage,FOUNDATION_IMPACT_OUTCOME:outcome,FOUNDATION_IMPACT_REPORT:reportPath,FOUNDATION_IMPACT_IPC:ipc,FOUNDATION_IMPACT_EXTENSION:extensionPath,FOUNDATION_IMPACT_WORKSPACE:workspace,FOUNDATION_IMPACT_USER_DATA:userData};for(const key of Object.keys(env))if(key==='ELECTRON_RUN_AS_NODE'||/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key))delete env[key];
  assert.equal(stopping,false,'Native verification was cancelled before launch');
  const log=await open(path.join(temp,`${stage}.log`),'w'),child=spawn(path.join(app,'Contents/MacOS/Foundation'),[workspace,'--new-window','--user-data-dir',userData,'--shared-data-dir',path.join(temp,'shared-data'),'--extensions-dir',extensions,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--disable-crash-reporter','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{env,detached:true,stdio:['ignore',log.fd,log.fd]});if(child.pid)activeGroups.add(child.pid);await log.close();let exited=false,exitCode,spawnError;child.once('exit',code=>{exited=true;exitCode=code;});child.once('error',error=>{spawnError=error;exited=true;});let index=1,result;const deadline=Date.now()+480000;
  try{
   while(!(result=await readJSON(outcome))){
    if(spawnError)throw spawnError;if(exited)throw Error(`${stage} exited ${exitCode} before outcome: ${temp}`);if(Date.now()>deadline)throw Error(`${stage} timed out: ${temp}`);
    const command=await readJSON(path.join(ipc,`command-${index}.json`));if(!command){await pause(100);continue;}
    if(index===1&&process.env.FOUNDATION_IMPACT_FOCUS_GATE==='1'){const gate={app,temp,stage,pid:child.pid,port,release:path.join(temp,`native-focus-${stage}-release.json`)};await writeFile(path.join(temp,`native-focus-${stage}.json`),JSON.stringify(gate,null,2));console.error(`Native foreground confirmation required: ${path.join(temp,`native-focus-${stage}.json`)}`);const confirmed=await wait(()=>readJSON(gate.release),'actual native window foreground confirmation',180000);assert.equal(confirmed.focused,true);nativeFocusGates.push({...gate,confirmed:true});}
    let response;
    try{
     browser ||= await wait(()=>chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000}),'isolated candidate endpoint');const main=await nativeWorkbench(browser);await withTarget(browser,main.targetId,send=>send('Page.bringToFront'));const frame=await surfaceFrame(browser);
     if(command.type==='selectComponent'){
      const canvas=await componentFrame(browser);await keyboard(browser,canvas,'[data-impact-save]','Enter',true);await wait(()=>evaluate(browser,frame,`Boolean(document.querySelector('[data-design-focus="impact/component/inspect"]'))`),'mapped source inspector');
     }else if(command.type==='selectToken'){
      await ensureInspector(browser,frame);const selector=`[data-design-focus=${JSON.stringify('token-'+command.id)}]`;await keyboard(browser,frame,selector,'Enter',true);
     }else if(command.type==='analyze'){
      assert.ok(['token','component'].includes(command.kind));await ensureInspector(browser,frame);await keyboard(browser,frame,`button[data-design-focus=${JSON.stringify('impact/'+command.kind+'/inspect')}]`,'Enter',true);
     }else if(command.type==='editToken')await editToken(browser,frame,command.name,command.value,command.selection);
     else if(command.type==='details')await details(browser,frame,command.kind);
     else if(command.type==='source')await keyboard(browser,frame,`button[data-design-focus=${JSON.stringify('impact/'+command.evidenceId+'/source')}]`,'Enter',true);
     else if(command.type==='propose')await keyboard(browser,frame,'button[data-design-focus="impact/token/review"]','Enter',true);
     else if(command.type==='proposalAction'){
      assert.ok(['Apply to source','Undo Foundation change','Discard'].includes(command.label));await keyboard(browser,frame,`button[data-artifact-focus=${JSON.stringify('proposal/'+command.id+':'+command.label)}]`,'Enter',true);
     }else if(command.type==='reviewDetails'){
      if(command.proposalId)await wait(()=>evaluate(browser,frame,`Boolean(document.querySelector('button[data-artifact-focus^='+${JSON.stringify(JSON.stringify('proposal/'+command.proposalId+':'))}+']'))`),'expected proposal renderer');
      if(command.expectedStatus)await wait(async()=>{const view=await impactUI(browser,frame);return command.expectedStatus==='stale'?view.reviewText.includes('Historical preflight')&&!view.applyVisible:view.reviewText.includes('Saved with this proposal');},'rendered proposal freshness');
      await details(browser,frame,'review');
     }
     else if(command.type==='screenshot'){
      assert.ok(/^[a-z-]+$/.test(command.name));if(command.theme)await wait(async()=>(await impactUI(browser,frame)).theme===command.theme,'native theme');const viewport=await evaluate(browser,main,'({innerWidth,innerHeight})');await nativeWindowScreenshot(browser,main,viewport,path.join(temp,`${stage}-${command.name}.png`));
     }else if(command.type==='inspect'){
      if(typeof command.expectedReviewDisabled==='boolean')await wait(async()=>(await impactUI(browser,frame)).reviewDisabled===command.expectedReviewDisabled,'rendered token preparation state');
     }else throw Error(`Unsupported native impact action ${command.type}`);
     response={passed:true,renderer:await impactUI(browser,frame)};
    }catch(error){response={passed:false,error:error.stack||String(error)};}
    await writeFile(path.join(ipc,`result-${index}.json`),JSON.stringify(response));index++;
   }
   if(!result.passed&&process.env.FOUNDATION_IMPACT_KEEP_FAILURE==='1'){await writeFile(path.join(temp,'native-debug.json'),JSON.stringify({temp,port,pid:child.pid,stage,error:result.error,release:path.join(temp,'release-debug.json')},null,2));console.error(`Native impact failure held for inspection: ${temp}`);await wait(()=>readJSON(path.join(temp,'release-debug.json')),'release isolated impact fixture',180000);}
   assert.equal(result.passed,true,`${stage}: ${result.error||'No passing result'}. See ${temp}`);while(!exited&&Date.now()<deadline)await pause(100);assert.equal(exited,true);assert.equal(exitCode,0);
  }catch(error){await stopGroup(child.pid);throw error;}finally{await browser?.close().catch(()=>{});browser=undefined;await stopGroup(child.pid);}
 }
 assert.deepEqual(await hashTree(workspace),initialFixture,'Token Apply and Undo restore saved fixture source');assert.deepEqual(await hashTree(extensionPath),payload,'Tested package payload remains exact');
 const report={...await readJSON(reportPath),passed:true,mode:'packaged',app,extensionPath,workspace,temp,userData,nativeActivations:activations,nativeFocusGates,provenance:{disposableInstrumentation:'The fixture Save button declares data-foundation-source for the existing validated sandbox mapping adapter.',candidateSignature:'codesign --verify --deep --strict passed',binarySha256,disposableFixture:initialFixture,payload},verificationBoundary:'Real saved-source sandbox selection, explicit native change-impact controls, review, Apply and Undo; changed-consumer stale guards; exact frozen proposal and unrelated dirty draft restoration in a second process. Button/disclosure activations use trusted CDP keys and token text uses CDP insertText with recorded programmatic focus/selection. No provider, runtime scenario, physical hardware or human usability acceptance.'};assert.equal(report.restoredInSecondProcess,true);const output=path.join(desktop,'.build/native-change-impact-smoke-report.json'),previous=await readJSON(output);if(previous)await writeFile(path.join(temp,'previous-native-change-impact-report.json'),JSON.stringify(previous,null,2));await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(path.join(temp,'failure.json'),JSON.stringify({passed:false,error:error.stack||String(error),temp,app,workspace},null,2));throw error;}finally{await writeFile(path.join(temp,'native-activations.json'),JSON.stringify(activations,null,2));await browser?.close().catch(()=>{});await Promise.all([...activeGroups].map(stopGroup));}
