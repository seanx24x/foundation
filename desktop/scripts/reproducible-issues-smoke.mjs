import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {createServer as createHTTPServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,realpath,open,readdir,cp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert.equal(process.argv.length,2,'Usage: FOUNDATION_APP_PATH=/candidate/Foundation.app node desktop/scripts/reproducible-issues-smoke.mjs');
assert.ok(process.env.FOUNDATION_APP_PATH,'Choose the exact isolated signed candidate');
const app=await realpath(process.env.FOUNDATION_APP_PATH),extensionPath=await realpath(path.join(app,'Contents/Resources/app/extensions/foundation-workspace'));
const temp=await realpath(await mkdtemp('/private/tmp/foundation-reproducible-issues-smoke-')),workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions'),harness=path.join(extensions,'foundation-test.reproducible-issues-native-check-1.0.0'),reportPath=path.join(temp,'report.json');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashTree=async root=>{const values=[];async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){if(item.name==='node_modules')continue;const file=path.join(dir,item.name);assert.equal(item.isSymbolicLink(),false,'Fixture and package inputs must be ordinary files');if(item.isDirectory())await walk(file);else if(item.isFile()){const bytes=await readFile(file);values.push({path:path.relative(root,file).split(path.sep).join('/'),bytes:bytes.length,sha256:digest(bytes)});}}}await walk(root);return values.sort((a,b)=>a.path.localeCompare(b.path));};
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
const binarySha256=digest(await readFile(path.join(app,'Contents/MacOS/Foundation'))),payload=await hashTree(extensionPath);
await Promise.all([mkdir(path.join(workspace,'src'),{recursive:true}),mkdir(path.join(userData,'User'),{recursive:true}),mkdir(harness,{recursive:true})]);
await cp(path.join(path.dirname(desktop),'fixtures/replay-web'),workspace,{recursive:true});
execFileSync('/bin/cp',['-cR',path.join(path.dirname(desktop),'node_modules'),path.join(workspace,'node_modules')]);
const config=path.join(workspace,'vite.config.mjs');await writeFile(config,(await readFile(config,'utf8')).replace('../../desktop/runtime/vite-plugin.mjs',path.join(extensionPath,'dist/connected-vite-plugin.mjs')));
await writeFile(path.join(workspace,'src/UnrelatedDraft.ts'), 'export const unrelatedNote = \"Preserve this draft\";\n');
const initialFixture=await hashTree(workspace);
await Promise.all([writeFile(path.join(userData,'User/settings.json'),JSON.stringify({'foundation.openOnStartup':false,'foundation.ai.baseUrl':'','foundation.ai.model':'','foundation.ai.profiles':{},'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never','security.workspace.trust.enabled':false,'files.hotExit':'onExitAndWindowClose','files.autoSave':'off','window.zoomLevel':-2})),writeFile(path.join(harness,'package.json'),JSON.stringify({name:'reproducible-issues-native-check',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-reproducible-issues-smoke.cjs')))]);
// Deterministic loopback protocol fixture. No remote model, credential or Keychain.
const providerRequests=[];
const provider=createHTTPServer(async(req,res)=>{
 try{
  assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,undefined);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const payload=JSON.parse(Buffer.concat(chunks)),input=JSON.parse(payload.messages[1].content);
  assert.equal(payload.model,'foundation-local-issues-fixture');assert.equal(payload.tools,undefined);assert.equal(input.intent,'ask');
  assert.equal(input.planContext,undefined);assert.equal(input.context,undefined);assert.equal(input.groupRevision,undefined);assert.equal(input.requestRevision,undefined);assert.equal(input.decisionContext,undefined);
  assert.deepEqual(input.sources.map(file=>file.path).sort(),['src/App.tsx','src/style.css']);
  const sourceFacts=[];for(const file of input.sources){const saved=await readFile(path.join(workspace,file.path),'utf8'),numbered=saved.split('\n').map((line,index)=>`${index+1}: ${line}`).join('\n');assert.equal(file.content,numbered,'Shared source is the exact numbered saved baseline');const {content,...metadata}=file;sourceFacts.push({...metadata,sha256:digest(saved),sharedContentSha256:digest(content),sharedContentFormat:'numbered-lines'});}
  assert.ok(!JSON.stringify(input).includes('Unrelated unsaved issue'));assert.equal(providerRequests.length,0,'Only one explicit issue-context Ask is permitted');
  const expected=JSON.parse(await readFile(path.join(temp,'expected-issue-context.json'),'utf8'));assert.deepEqual(input.issueContext,expected);assert.equal(input.issueContext.issues[0].assessment.source,'current');
  providerRequests.push({intent:input.intent,question:input.question,sources:sourceFacts,issueContext:input.issueContext});
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({model:payload.model,choices:[{delta:{content:'The saved issue reports a failed save. One request returned HTTP 503 during the observation; its relationship to the scenario is unconfirmed. The error fixture is defined in the selected source [S1:1].'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})}\n\ndata: [DONE]\n\n`);
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Local issue fixture rejected this request.'}));providerRequests.push({fixtureError:error.message});}finally{await writeFile(path.join(temp,'mock-provider-requests.json'),JSON.stringify(providerRequests,null,2));}
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
const providerURL=`http://127.0.0.1:${provider.address().port}/v1`;
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
  const root = await browser.newBrowserCDPSession(); let sessionId, serial = 0; const pending = new Map(), defaultContexts = new Map();
  const listener = event => {
    if (event.sessionId !== sessionId) return;
    const value = JSON.parse(event.message); if(value.method==='Runtime.executionContextCreated' && value.params.context.auxData?.isDefault)defaultContexts.set(value.params.context.id,value.params.context); const item = pending.get(value.id); if (!item) return;
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
    send.defaultContexts=defaultContexts;
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
const surfaceFrame = (browser,surface='workspace') => wait(async () => {
  const session = await browser.newBrowserCDPSession(); let targets;
  try { targets = (await session.send('Target.getTargets')).targetInfos; } finally { await session.detach(); }
  const matches = [];
  for (const target of targets.filter(item => item.url.startsWith('vscode-webview://'))) {
    try {
      await withTarget(browser, target.targetId, async send => {
        const { frameTree } = await send('Page.getFrameTree');
        const visit = async node => {
          const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: node.frame.id, worldName: 'foundationScopedAlternativesSmoke' });
          const frame = { targetId: target.targetId, frameId: node.frame.id, contextId: executionContextId, webviewId:new URL(target.url).searchParams.get('id') };
          if (await readOn(send, frame, 'document.body?.dataset.foundationSurface') === surface) matches.push(frame);
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
const revealIssue=async(browser,frame,id)=>{
 const selector=`[data-issue-id=${JSON.stringify(id)}]`;
 const geometry=await evaluate(browser,frame,`(async()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element||!element.open)throw Error('The exact saved issue must be expanded');element.scrollIntoView({block:'start',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const clip=document.getElementById('foundation-content').getBoundingClientRect(),viewport={x:Math.max(0,clip.left),y:Math.max(0,clip.top),right:Math.min(innerWidth,clip.right),bottom:Math.min(innerHeight,clip.bottom)};viewport.width=viewport.right-viewport.x;viewport.height=viewport.bottom-viewport.y;const bounds=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,visibleWidth:Math.max(0,Math.min(r.right,viewport.right)-Math.max(r.left,viewport.x)),visibleHeight:Math.max(0,Math.min(r.bottom,viewport.bottom)-Math.max(r.top,viewport.y))};};return {id:element.dataset.issueId,status:element.dataset.issueStatus,viewport,record:bounds(element),title:bounds(element.querySelector('summary')),outcome:bounds(element.querySelector('.issue-outcome'))};})()`);
 assert.equal(geometry.id,id);assert.ok(geometry.record.visibleWidth>0&&geometry.record.visibleHeight>0,'The exact issue intersects the native workspace viewport');
 assert.ok(geometry.title.visibleWidth>0&&geometry.title.visibleHeight>=geometry.title.height-1,'The issue heading is visible before capture');
 assert.ok(geometry.outcome.visibleWidth>0&&geometry.outcome.visibleHeight>0,'The issue outcome is visible before capture');return geometry;
};
const nativeWorkbench=async browser=>{const session=await browser.newBrowserCDPSession();let targets;try{targets=(await session.send('Target.getTargets')).targetInfos;}finally{await session.detach();}const matches=targets.filter(target=>target.type==='page'&&target.url.includes('/workbench/workbench.html'));assert.equal(matches.length,1,'One isolated native workbench target');return withTarget(browser,matches[0].targetId,async send=>{const {frameTree}=await send('Page.getFrameTree'),{executionContextId}=await send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'foundationScopedAlternativesWorkbench'});return {targetId:matches[0].targetId,contextId:executionContextId};});};
const nativeWindowScreenshot=async(browser,main,viewport,file)=>withTarget(browser,main.targetId,async send=>{const result=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),bytes=Buffer.from(result.data,'base64');await writeFile(file,bytes);return bytes;});
const openNamedDetails=async(browser,frame,label,scope='')=>{const keys=await wait(async()=>{const values=await evaluate(browser,frame,`[...document.querySelectorAll(${JSON.stringify((scope?scope+' ':'')+'summary')})].filter(e=>e.textContent.trim()===${JSON.stringify(label)}).map(e=>e.dataset.artifactFocus||e.dataset.designFocus)`);return values.length?values:false;},'rendered disclosure '+label);for(const key of keys)await disclosure(browser,frame,`summary[data-artifact-focus=${JSON.stringify(key)}],summary[data-design-focus=${JSON.stringify(key)}]`);return keys.length;};

const fillText=async(browser,frame,label,value)=>{
 const selector=`input[aria-label=${JSON.stringify(label)}],textarea[aria-label=${JSON.stringify(label)}]`;
 await withTarget(browser,frame.targetId,async send=>{
  await wait(()=>readOn(send,frame,`Boolean(document.querySelector(${JSON.stringify(selector)})?.getClientRects().length)`),'visible native text field');
  await readOn(send,frame,`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(input.disabled)throw Error('Text field unavailable');input.scrollIntoView({block:'nearest'});input.focus();input.select();})()`);
  const entry={selector,value,method:'CDP Input.insertText',physicalKeyboard:false};activations.push(entry);
  await send('Input.insertText',{text:value});
  entry.result=await readOn(send,frame,`(()=>{const input=document.querySelector(${JSON.stringify(selector)});return {value:input.value,focused:input===document.activeElement};})()`);
  assert.equal(entry.result.value,value);assert.equal(entry.result.focused,true);
 });
};


const selectValue = async (browser, frame, label, value) => {
  const selector = `select[aria-label=${JSON.stringify(label)}]`;
  const entry = { selector, value, method: 'native-renderer selectOption-equivalent', trustedKeyboard: false };
  activations.push(entry);
  // macOS native select popups do not reliably process synthetic CDP arrow
  // input. This is the same control-level operation as Playwright selectOption;
  // it exercises the actual renderer's change listener without host injection.
  // Physical keyboard behavior remains a separate manual acceptance boundary.
  entry.before = await evaluate(browser, frame, `(()=>{const element=document.querySelector(${JSON.stringify(selector)}),value=${JSON.stringify(value)};if(!element||element.disabled||!element.getClientRects().length)throw Error('Observation select is not interactive');const option=[...element.options].find(item=>item.value===value&&!item.disabled);if(!option)throw Error('Requested saved observation is unavailable');const before={value:element.value,label:option.textContent,options:[...element.options].map(item=>item.value)};element.scrollIntoView({block:'nearest'});element.focus();element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));return before;})()`);
  await wait(async () => await evaluate(browser, frame, `document.querySelector(${JSON.stringify(selector)}).value`) === value, 'explicit observation selection takes effect');
};
const runtimeFrame=browser=>wait(async()=>{const session=await browser.newBrowserCDPSession();let targets;try{targets=(await session.send('Target.getTargets')).targetInfos;}finally{await session.detach();}const matches=[];for(const target of targets.filter(item=>item.url.startsWith('vscode-webview://')||/^http:\/\/127\.0\.0\.1:\d+/.test(item.url))){try{await withTarget(browser,target.targetId,async send=>{const {frameTree}=await send('Page.getFrameTree');const visit=async node=>{const {executionContextId}=await send('Page.createIsolatedWorld',{frameId:node.frame.id,worldName:'foundationVisualCaptureFixture'});const frame={targetId:target.targetId,contextId:executionContextId};if(await readOn(send,frame,'Boolean(parent!==window && document.querySelector("[data-fixture-state]"))'))if(!matches.some(item=>item.frameId===node.frame.id))matches.push({...frame,frameId:node.frame.id});for(const child of node.childFrames||[])await visit(child);};await visit(frameTree);});}catch{}}assert.ok(matches.length<=1,'Only one native fixture document may be active');return matches[0];},'actual native runtime iframe');
const issueUI=(browser,frame)=>withTarget(browser,frame.targetId,async send=>{
 const result=await readOn(send,frame,`(()=>({text:document.body.textContent,composer:document.querySelector('textarea[aria-label="Ask about your source"]')?.value??null,theme:document.body.dataset.vscodeThemeName,issues:[...document.querySelectorAll("[data-issue-id]")].map(e=>({id:e.dataset.issueId,status:e.dataset.issueStatus,text:e.textContent})),issuesSelected:[...document.querySelectorAll("input[data-context-issue]:checked")].map(e=>({id:e.dataset.contextIssue,disabled:e.disabled})),sendDisabled:document.querySelector("#ask-submit")?.disabled,images:[...document.querySelectorAll('.runtime-capture')].map(e=>{const image=e.querySelector('img');return {status:e.dataset.captureStatus,width:image?.naturalWidth||0,height:image?.naturalHeight||0,url:image?.currentSrc||null};})}))()`);
 if(result.images.some(image=>image.width>0))await send('Page.enable');for(const image of result.images){image.sha256=null;if(image.width>0){assert.ok(image.url?.startsWith('blob:'));const resource=await send('Page.getResourceContent',{frameId:frame.frameId,url:image.url});assert.equal(resource.base64Encoded,true);image.sha256=digest(Buffer.from(resource.content,'base64'));}delete image.url;}return result;
});
const runtimeEvidence=(browser,frame)=>evaluate(browser,frame,`(()=>({state:document.querySelector('[data-fixture-state]')?.dataset.fixtureState,status:document.querySelector('[role="status"]')?.textContent,theme:document.documentElement.dataset.theme,motion:document.documentElement.dataset.motion,viewportWidthCss:innerWidth,viewportHeightCss:innerHeight,embedded:parent!==window}))()`);
const ensureInspector=async(browser,frame)=>{if(!await evaluate(browser,frame,`Boolean(document.querySelector('.design-inspector')?.getClientRects().length&&getComputedStyle(document.querySelector('.design-inspector')).visibility!=='hidden')`))await keyboard(browser,frame,'button.inspector-toggle','Enter',true);};
const namedButton=async(browser,frame,label,scope='')=>{const selector=await wait(()=>evaluate(browser,frame,`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope?scope+' button':'button')})].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled&&e.getClientRects().length);return e?.dataset.artifactFocus?'button[data-artifact-focus='+JSON.stringify(e.dataset.artifactFocus)+']':e?.dataset.designFocus?'button[data-design-focus='+JSON.stringify(e.dataset.designFocus)+']':null;})()`),'enabled '+label);await keyboard(browser,frame,selector,'Enter',true);};
const openRun=async(browser,frame,featureId,runId)=>{await disclosure(browser,frame,'.feature-runtime-details > summary');await disclosure(browser,frame,`[data-artifact-focus=${JSON.stringify('runtime-workspace/'+featureId+'/history')}]`);await disclosure(browser,frame,`[data-artifact-focus=${JSON.stringify('run/'+runId)}]`);};
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
  const env={...process.env,FOUNDATION_VERIFICATION_APP:app,FOUNDATION_VERIFICATION_STAGE:stage,FOUNDATION_VERIFICATION_OUTCOME:outcome,FOUNDATION_VERIFICATION_REPORT:reportPath,FOUNDATION_VERIFICATION_IPC:ipc,FOUNDATION_VERIFICATION_EXTENSION:extensionPath,FOUNDATION_VERIFICATION_WORKSPACE:workspace,FOUNDATION_VERIFICATION_USER_DATA:userData};for(const key of Object.keys(env))if(key==='ELECTRON_RUN_AS_NODE'||/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key))delete env[key];
  Object.assign(env,{FOUNDATION_AI_BASE_URL:providerURL,FOUNDATION_AI_MODEL:'foundation-local-issues-fixture',FOUNDATION_AI_PROVIDER_KIND:'compatible'});
  assert.equal(stopping,false,'Native verification was cancelled before launch');
  const log=await open(path.join(temp,`${stage}.log`),'w'),child=spawn(path.join(app,'Contents/MacOS/Foundation'),[workspace,'--new-window','--user-data-dir',userData,'--shared-data-dir',path.join(temp,'shared-data'),'--extensions-dir',extensions,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--disable-crash-reporter','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{env,detached:true,stdio:['ignore',log.fd,log.fd]});if(child.pid)activeGroups.add(child.pid);await log.close();let exited=false,exitCode,spawnError;child.once('exit',code=>{exited=true;exitCode=code;});child.once('error',error=>{spawnError=error;exited=true;});let index=1,result;const deadline=Date.now()+900000;
  try{
   while(!(result=await readJSON(outcome))){
    if(spawnError)throw spawnError;if(exited)throw Error(`${stage} exited ${exitCode} before outcome: ${temp}`);if(Date.now()>deadline)throw Error(`${stage} timed out: ${temp}`);
    const command=await readJSON(path.join(ipc,`command-${index}.json`));if(!command){
     await pause(100);continue;}
    if(index===1&&process.env.FOUNDATION_VERIFICATION_FOCUS_GATE==='1'){const gate={app,temp,stage,pid:child.pid,port,release:path.join(temp,`native-focus-${stage}-release.json`)};await writeFile(path.join(temp,`native-focus-${stage}.json`),JSON.stringify(gate,null,2));console.error(`Native foreground confirmation required: ${path.join(temp,`native-focus-${stage}.json`)}`);const confirmed=await wait(()=>readJSON(gate.release),'actual native window foreground confirmation',180000);assert.equal(confirmed.focused,true);nativeFocusGates.push({...gate,confirmed:true});}
    let response;
    try{
     browser ||= await wait(()=>chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000}),'isolated candidate endpoint');const main=await nativeWorkbench(browser);await withTarget(browser,main.targetId,send=>send('Page.bringToFront'));const frame=await surfaceFrame(browser,['issueAsk','issueContext','issueDraftQuestion'].includes(command.type)?'assistant':'workspace');
     if(command.type==='configure'){
      await selectValue(browser,frame,'Preview source','runtime');await selectValue(browser,frame,'Preview viewport width','960');await selectValue(browser,frame,'Preview color theme','dark');
      if(await evaluate(browser,frame,`document.querySelector('[aria-label="Fit preview to canvas"]')?.getAttribute('aria-pressed')!=='true'`))await keyboard(browser,frame,'[aria-label="Fit preview to canvas"]','Enter',true);
      if(await evaluate(browser,frame,`document.querySelector('.inspect-toggle')?.getAttribute('aria-pressed')==='true'`))await keyboard(browser,frame,'.inspect-toggle','Enter',true);
      await ensureInspector(browser,frame);await evaluate(browser,frame,`document.querySelector('[data-foundation-runtime-canvas]')?.scrollIntoView({block:'center'});`);await wait(async()=>{const v=await runtimeEvidence(browser,await runtimeFrame(browser));return Math.abs(v.viewportWidthCss-960)<=1&&Math.abs(v.viewportHeightCss-680)<=1;},'actual requested fixture viewport');
     }else if(command.type==='startReplay'){
      await ensureInspector(browser,frame);await selectValue(browser,frame,'Replay recipe','profile-error');await selectValue(browser,frame,'Replay app motion','reduce');await keyboard(browser,frame,'button[aria-label="Replay recipe"]','Enter',true);
     }else if(command.type==='runtime'){
      command.verification={runtime:await runtimeEvidence(browser,await runtimeFrame(browser))};
     }else if(command.type==='captureFinish'){
      await selectValue(browser,frame,'Manual observation assessment','not-matched');await fillText(browser,frame,'Manual observation note','The save failed with an unavailable message.');
      await keyboard(browser,frame,'[data-design-focus="manual-run/capture-finish"]','Enter',true,async()=>{const geometry=await evaluate(browser,frame,`(()=>{const r=document.querySelector('[data-foundation-runtime-canvas]')?.getBoundingClientRect();if(!r)throw Error('Missing actual canvas');return {rect:r.toJSON(),innerWidth,innerHeight,devicePixelRatio};})()`);assert.ok(geometry.rect.x>=0&&geometry.rect.y>=0&&geometry.rect.right<=geometry.innerWidth+0.01&&geometry.rect.bottom<=geometry.innerHeight+0.01,'Native runtime canvas wholly visible before capture');await writeFile(path.join(temp,'capture-geometry.json'),JSON.stringify(geometry,null,2));await nativeWindowScreenshot(browser,main,{},path.join(temp,'write-before-capture.png'));command.verification={geometry};});
     }else if(command.type==='issueRecord'){
      await openRun(browser,frame,command.featureId,command.runId);await disclosure(browser,frame,'.issue-capture-form > summary');await fillText(browser,frame,'Issue title',command.title);await fillText(browser,frame,'Actual outcome',command.actualOutcome);await namedButton(browser,frame,'Save issue','form[aria-label="Capture reproducible issue"]');
     }else if(command.type==='issueRead'){
      await disclosure(browser,frame,`[data-issue-id=${JSON.stringify(command.id)}] > summary`);await disclosure(browser,frame,`[data-artifact-focus=${JSON.stringify('issues/review/'+command.id+'/evidence')}]`);command.verification={issueViewport:await revealIssue(browser,frame,command.id)};
     }else if(command.type==='issueViewEvidence'){
      await disclosure(browser,frame,`[data-issue-id=${JSON.stringify(command.id)}] > summary`);await disclosure(browser,frame,`[data-artifact-focus=${JSON.stringify('issues/review/'+command.id+'/evidence')}]`);await namedButton(browser,frame,'View original observation',`[data-issue-id=${JSON.stringify(command.id)}]`);await wait(()=>evaluate(browser,frame,`Boolean(document.querySelector('[data-lazy-disclosure='+${JSON.stringify(JSON.stringify('run/'+command.runId))}+']')?.open)`),'original observation revealed');
     }else if(command.type==='viewCapture'){
      await namedButton(browser,frame,'View capture',`[data-lazy-disclosure=${JSON.stringify('run/'+command.runId)}]`);await wait(async()=>{const v=await issueUI(browser,frame);return v.images.length===1&&v.images[0].status==='ready'&&v.images[0].width>0;},'explicit original PNG displayed');
     }else if(command.type==='issueAsk'){
      assert.equal(stage,'write');await keyboard(browser,frame,'button[aria-label="Ask mode"]','Enter',true);await disclosure(browser,frame,'summary[aria-label="Request context and model"]');const available=await evaluate(browser,frame,'[...document.querySelectorAll("input[data-context-path]")].map(e=>({path:e.dataset.contextPath,checked:e.checked}))');assert.ok(command.paths.every(file=>available.some(v=>v.path===file)));for(const item of available){if(item.checked!==command.paths.includes(item.path))await keyboard(browser,frame,`input[data-context-path=${JSON.stringify(item.path)}]`,' ',true);}
      const before=await evaluate(browser,frame,'[...document.querySelectorAll("input[data-context-issue]:checked")].map(e=>e.dataset.contextIssue)');assert.deepEqual(before,[]);await keyboard(browser,frame,`input[data-context-issue=${JSON.stringify(command.id)}]`,' ',true);await disclosure(browser,frame,'.context-inspect > summary');await disclosure(browser,frame,'.context-inspect .saved-issue-context > summary');const exact=await evaluate(browser,frame,'JSON.parse(document.querySelector(".context-inspect .saved-issue-context pre").textContent)');await fillText(browser,frame,'Ask about your source',command.question);await keyboard(browser,frame,'#ask-submit','Enter',true);command.verification={exactIssueContext:exact,issuesBeforeSelection:before};
     }else if(command.type==='issueContext'){
      await disclosure(browser,frame,'summary[aria-label="Request context and model"]');
     }else if(command.type==='issueDraftQuestion'){
      await disclosure(browser,frame,'summary[aria-label="Request context and model"]');await fillText(browser,frame,'Ask about your source',command.question);
     }else if(command.type==='screenshot'){
      assert.ok(/^[a-z-]+$/.test(command.name));if(command.theme)await wait(async()=>(await issueUI(browser,frame)).theme===command.theme,'native theme');if(command.issueId)command.verification={issueViewport:await revealIssue(browser,frame,command.issueId),screenshot:`${stage}-${command.name}.png`};await nativeWindowScreenshot(browser,main,{},path.join(temp,`${stage}-${command.name}.png`));
     }else if(command.type==='inspect'){}
     else throw Error(`Unsupported native issue action ${command.type}`);
     response={passed:true,renderer:{...await issueUI(browser,frame),providerRequests:providerRequests.length,...command.verification}};
    }catch(error){response={passed:false,error:error.stack||String(error)};}
    await writeFile(path.join(ipc,`result-${index}.json`),JSON.stringify(response));index++;
   }
   if(!result.passed&&process.env.FOUNDATION_VERIFICATION_KEEP_FAILURE==='1'){await writeFile(path.join(temp,'native-debug.json'),JSON.stringify({temp,port,pid:child.pid,stage,error:result.error,release:path.join(temp,'release-debug.json')},null,2));console.error(`Native reproducible-issues failure held for inspection: ${temp}`);await wait(()=>readJSON(path.join(temp,'release-debug.json')),'release isolated impact fixture',180000);}
   assert.equal(result.passed,true,`${stage}: ${result.error||'No passing result'}. See ${temp}`);while(!exited&&Date.now()<deadline)await pause(100);assert.equal(exited,true);assert.equal(exitCode,0);
  }catch(error){await stopGroup(child.pid);throw error;}finally{await browser?.close().catch(()=>{});browser=undefined;await stopGroup(child.pid);}
 }
 assert.deepEqual(await hashTree(extensionPath),payload,'Tested package payload remains exact');
 assert.equal(providerRequests.length,1);assert.ok(providerRequests.every(value=>!value.fixtureError));
 const report={...await readJSON(reportPath),providerRequests,passed:true,mode:'packaged',app,extensionPath,workspace,temp,userData,nativeActivations:activations,nativeFocusGates,provenance:{disposableInstrumentation:'Maintained replay-web fixture with one unrelated unsaved draft, copied dependencies and candidate plugin path. A saved CSS comment deliberately changes source freshness after capture.',candidateSignature:'codesign --verify --deep --strict passed',binarySha256,disposableFixture:initialFixture,finalFixture:await hashTree(workspace),payload},verificationBoundary:'Real native maintained error recipe produces HTTP503 request and PNG. Explicit issue capture freezes reported outcome, scenario, run, request metadata, source hashes, replay and capture references. Native record/source/provenance inspection in both themes and explicit image display. One explicit issue-context Ask to deterministic loopback fixture with exact selected metadata and separately selected saved source. Source mutation makes issue historical without erasing it. Second-process restoration preserves the issue, original evidence, selected issue context, immutable sent context and unrelated unsaved draft, without runtime or provider restart or automatic pixel loading. Compilation, causal diagnosis, remote model quality and physical hardware acceptance remain separate.'};assert.equal(report.restoredInSecondProcess,true);const output=path.join(desktop,'.build/native-reproducible-issues-smoke-report.json'),previous=await readJSON(output);if(previous)await writeFile(path.join(temp,'previous-native-reproducible-issues-report.json'),JSON.stringify(previous,null,2));await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

}catch(error){await writeFile(path.join(temp,'failure.json'),JSON.stringify({passed:false,error:error.stack||String(error),temp,app,workspace},null,2));throw error;}finally{await writeFile(path.join(temp,'mock-provider-requests.json'),JSON.stringify(providerRequests,null,2));await writeFile(path.join(temp,'native-activations.json'),JSON.stringify(activations,null,2));await browser?.close().catch(()=>{});await Promise.all([...activeGroups].map(stopGroup));await new Promise(resolve=>provider.close(resolve));}
