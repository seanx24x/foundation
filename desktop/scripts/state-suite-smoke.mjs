import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {readFile,writeFile,mkdir,mkdtemp,realpath,cp,open,access,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.dirname(desktop);
assert.equal(process.argv.length,2,'Usage: FOUNDATION_APP_PATH=/candidate/Foundation.app node desktop/scripts/state-suite-smoke.mjs');
assert.ok(process.env.FOUNDATION_APP_PATH,'Choose the exact isolated signed candidate');
const app=await realpath(process.env.FOUNDATION_APP_PATH),extensionPath=await realpath(path.join(app,'Contents/Resources/app/extensions/foundation-workspace')),plugin=path.join(extensionPath,'dist/connected-vite-plugin.mjs');await access(plugin);
const temp=await realpath(await mkdtemp('/private/tmp/foundation-state-suite-smoke-')),workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions'),harness=path.join(extensions,'foundation-test.state-suite-native-check-1.0.0'),reportPath=path.join(temp,'report.json');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashTree=async root=>{const values=[];async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){if(item.name==='node_modules')continue;const file=path.join(dir,item.name);assert.equal(item.isSymbolicLink(),false,'Fixture/provenance inputs must be ordinary files');if(item.isDirectory())await walk(file);else if(item.isFile()){const bytes=await readFile(file);values.push({path:path.relative(root,file).split(path.sep).join('/'),bytes:bytes.length,sha256:digest(bytes)});}}}await walk(root);return values.sort((a,b)=>a.path.localeCompare(b.path));};
const maintainedFixture=await hashTree(path.join(repo,'fixtures/replay-web')),payload=await hashTree(extensionPath);
await cp(path.join(repo,'fixtures/replay-web'),workspace,{recursive:true});await promisify(execFile)('/bin/cp',['-cR',path.join(repo,'node_modules'),path.join(workspace,'node_modules')]);
const config=path.join(workspace,'vite.config.mjs'),originalConfig=await readFile(config,'utf8');assert.ok(originalConfig.includes('../../desktop/runtime/vite-plugin.mjs'));await writeFile(config,originalConfig.replace('../../desktop/runtime/vite-plugin.mjs',plugin));
// Add cancellation and failure recipes only to the disposable fixture. The
// five maintained recipes and their callbacks remain unchanged.
const source=path.join(workspace,'src/App.tsx'),original=await readFile(source,'utf8');
assert.ok(original.includes("recipes: (['idle','loading','success','error','offline'] as const).map"));
const cancellable=`})), {
        id:'profile-cancel', title:'Cancellation fixture', route:'/', fixture:{id:'cancel-fixture-v1',label:'Disposable cancellation fixture'},
        prepare:async ({signal,conditions}: any) => { if(signal.aborted)throw new Error('Stopped'); pending.current?.abort(); pending.current=null; document.documentElement.dataset.theme=conditions.theme; document.documentElement.dataset.motion=conditions.motion; flushSync(()=>{setName('Alex Morgan');setFixture('cancel');});publish('idle'); },
        steps:[{id:'wait-for-stop',title:'Wait for explicit Stop',run:async ({signal}: any)=>{publish('loading');document.documentElement.dataset.fixturePending='waiting';await new Promise<void>((resolve,reject)=>{const onAbort=()=>{clearTimeout(timer);document.documentElement.dataset.fixturePending='stopped';reject(new Error('Stopped'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);document.documentElement.dataset.fixturePending='timed-out';reject(new Error('Fixture timeout'));},30000);signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();});}}],
      }, {
        id:'profile-fail', title:'Failure fixture', route:'/', fixture:{id:'failure-fixture-v1',label:'Disposable callback failure fixture'},
        prepare:async ({signal,conditions}: any) => { if(signal.aborted)throw new Error('Stopped'); pending.current?.abort(); pending.current=null; document.documentElement.dataset.theme=conditions.theme; document.documentElement.dataset.motion=conditions.motion; flushSync(()=>{setName('Alex Morgan');setFixture('failure');});publish('idle'); },
        steps:[{id:'fail-explicitly',title:'Return fixture failure',run:async ()=>{publish('error');document.documentElement.dataset.fixturePending='failed';throw new Error('Disposable fixture failure');}}],
      }] });`;
const changed=original.replace("recipes: (['idle','loading','success','error','offline'] as const).map","recipes: [...(['idle','loading','success','error','offline'] as const).map").replace('})) });',cancellable);assert.notEqual(changed,original);assert.ok(changed.includes("id:'profile-cancel'"));await writeFile(source,changed);
const initialFixture=await hashTree(workspace);
await mkdir(path.join(userData,'User'),{recursive:true});await mkdir(harness,{recursive:true});await Promise.all([writeFile(path.join(userData,'User/settings.json'),JSON.stringify({'foundation.openOnStartup':false,'foundation.ai.baseUrl':'','foundation.ai.model':'','foundation.ai.profiles':{},'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never','security.workspace.trust.enabled':false,'window.zoomLevel':-3})),writeFile(path.join(harness,'package.json'),JSON.stringify({name:'state-suite-native-check',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-state-suite-smoke.cjs')))]);
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
          const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: node.frame.id, worldName: 'foundationObservationComparisonSmoke' });
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
  const entry = { selector, key, dispatched: false }; activations.push(entry);
  entry.before = await readOn(send, frame, `(async()=>{const selector=${JSON.stringify(selector)};for(let n=0;n<3;n++){const element=document.querySelector(selector);if(!element||element.disabled||!element.getClientRects().length)continue;element.scrollIntoView({block:'nearest'});element.focus();await new Promise(r=>setTimeout(r,120));if(element===document.querySelector(selector)&&document.activeElement===element&&!element.disabled&&document.hasFocus()){const observed={element,events:[]};observed.listener=event=>observed.events.push({type:event.type,key:event.key,trusted:event.isTrusted,same:event.target===element,current:event.target===document.querySelector(selector),targetLabel:event.target.getAttribute?.("aria-label"),targetFocus:event.target.dataset?.designFocus,value:event.target.value});globalThis.__comparisonKeys=observed;for(const type of ['keydown','keyup','click','change'])document.addEventListener(type,observed.listener,true);return {ready:true,tag:element.tagName,value:element.value};}}return {ready:false,hasFocus:document.hasFocus(),active:document.activeElement?.tagName};})()`);
  assert.equal(entry.before.ready, true, `Native focus readiness: ${JSON.stringify(entry.before)}`);
  const keys = { Enter: ['Enter', 13, '\r'], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38], ' ': ['Space', 32, ' '] };
  assert.ok(keys[key]); const [code, windowsVirtualKeyCode, text] = keys[key];
  try {
    if (beforeDispatch) await beforeDispatch();
    entry.dispatched = true;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(text ? { text, unmodifiedText: text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  } finally {
    entry.events = await readOn(send, frame, `(()=>{const observed=globalThis.__comparisonKeys;for(const type of ['keydown','keyup','click','change'])document.removeEventListener(type,observed.listener,true);delete globalThis.__comparisonKeys;return observed.events;})()`);
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
const selectValue = async (browser, frame, label, value) => {
  const selector = `select[aria-label=${JSON.stringify(label)}]`;
  const entry = { selector, value, method: 'native-renderer selectOption-equivalent', trustedKeyboard: false };
  activations.push(entry);
  // macOS native select popups do not reliably process synthetic CDP arrow
  // input. This is the same control-level operation as Playwright selectOption;
  // it exercises the actual renderer's change listener without host injection.
  // Physical keyboard behavior remains a separate manual acceptance boundary.
  entry.ready = await wait(() => evaluate(browser, frame, `(()=>{const element=document.querySelector(${JSON.stringify(selector)}),value=${JSON.stringify(value)};if(!element||element.matches(':disabled')||!element.getClientRects().length)return false;const style=getComputedStyle(element),rect=element.getBoundingClientRect(),option=[...element.options].find(item=>item.value===value&&!item.disabled&&!item.closest('optgroup[disabled]'));if(style.visibility!=='visible'||Number(style.opacity)<=0||rect.width<=0||rect.height<=0||!option)return false;return {width:rect.width,height:rect.height,value:element.value,requestedOption:option.value};})()`), 'native select is visibly laid out, enabled and contains the requested option');
  entry.before = await evaluate(browser, frame, `(()=>{const element=document.querySelector(${JSON.stringify(selector)}),value=${JSON.stringify(value)};if(!element||element.matches(':disabled')||!element.getClientRects().length||getComputedStyle(element).visibility!=='visible'||Number(getComputedStyle(element).opacity)<=0)throw Error('Observation select is not interactive');const option=[...element.options].find(item=>item.value===value&&!item.disabled);if(!option)throw Error('Requested saved observation is unavailable');const before={value:element.value,label:option.textContent,options:[...element.options].map(item=>item.value)};element.scrollIntoView({block:'nearest'});element.focus();element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));return before;})()`);
  await wait(async () => await evaluate(browser, frame, `document.querySelector(${JSON.stringify(selector)}).value`) === value, 'explicit observation selection takes effect');
};
const inspectUI=(browser,frame)=>evaluate(browser,frame,`(()=>{const region=document.querySelector('[aria-label="Observation comparison"]');return {baseline:document.querySelector('select[aria-label="Baseline observation"]')?.value,comparison:document.querySelector('select[aria-label="Comparison observation"]')?.value,regionText:region?.textContent||'',theme:document.body.dataset.vscodeThemeName,canvasCount:document.querySelectorAll('[data-foundation-runtime-canvas]').length,images:[...document.querySelectorAll('.runtime-capture')].map(node=>({label:node.getAttribute('aria-label'),status:node.dataset.captureStatus,width:node.querySelector('img')?.naturalWidth||0,height:node.querySelector('img')?.naturalHeight||0,srcKind:node.querySelector('img')?.src.split(':')[0]}))};})()`);
const runtimeFrame=browser=>wait(async()=>{const session=await browser.newBrowserCDPSession();let targets;try{targets=(await session.send('Target.getTargets')).targetInfos;}finally{await session.detach();}const matches=[];for(const target of targets.filter(item=>item.url.startsWith('vscode-webview://')||/^http:\/\/127\.0\.0\.1:\d+/.test(item.url))){try{await withTarget(browser,target.targetId,async send=>{const {frameTree}=await send('Page.getFrameTree');const visit=async node=>{const {executionContextId}=await send('Page.createIsolatedWorld',{frameId:node.frame.id,worldName:'foundationVisualCaptureFixture'});const frame={targetId:target.targetId,contextId:executionContextId};if(await readOn(send,frame,'Boolean(parent!==window && document.querySelector("[data-fixture-state]"))'))matches.push(frame);for(const child of node.childFrames||[])await visit(child);};await visit(frameTree);});}catch{}}assert.ok(matches.length<=1,'Only one native fixture document may be active');return matches[0];},'actual native runtime iframe');
const nativeWorkbench=async browser=>{const session=await browser.newBrowserCDPSession();let targets;try{targets=(await session.send('Target.getTargets')).targetInfos;}finally{await session.detach();}const matches=targets.filter(target=>target.type==='page'&&target.url.includes('/workbench/workbench.html'));assert.equal(matches.length,1,'One isolated native workbench target');return withTarget(browser,matches[0].targetId,async send=>{const {frameTree}=await send('Page.getFrameTree'),{executionContextId}=await send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'foundationNativeCaptureWorkbench'});return {targetId:matches[0].targetId,contextId:executionContextId};});};
const nativeWindowScreenshot=async(browser,main,viewport,file)=>withTarget(browser,main.targetId,async send=>{const result=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),bytes=Buffer.from(result.data,'base64');await writeFile(file,bytes);return bytes;});
const openComparison=async(browser,frame)=>{await evaluate(browser,frame,`document.getElementById('native-capture-outside-marker')?.remove();`);await disclosure(browser,frame,'details.feature-runtime-details > summary');const key=await wait(()=>evaluate(browser,frame,`(()=>{const summary=[...document.querySelectorAll('summary')].find(item=>item.textContent.trim()==='Compare observations');return summary?.dataset.artifactFocus||summary?.dataset.designFocus;})()`),'comparison disclosure');await disclosure(browser,frame,`summary[data-artifact-focus=${JSON.stringify(key)}],summary[data-design-focus=${JSON.stringify(key)}]`);};

const runtimeEvidence=(browser,frame)=>evaluate(browser,frame,`(()=>{const input=document.querySelector('#profile-name');return {state:document.querySelector('[data-fixture-state]')?.dataset.fixtureState,name:input?.value,status:document.querySelector('[role="status"]')?.textContent,fixture:document.querySelector('footer')?.textContent,theme:document.documentElement.dataset.theme,motion:document.documentElement.dataset.motion,pending:document.documentElement.dataset.fixturePending,viewportWidthCss:innerWidth,viewportHeightCss:innerHeight,deviceScaleFactor:devicePixelRatio,colorSchemePreference:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light',reducedMotionPreference:matchMedia('(prefers-reduced-motion: reduce)').matches?'reduce':'no-preference',embedded:parent!==window};})()`);
const matrixEvidence=(browser,frame)=>evaluate(browser,frame,`(()=>{const section=document.querySelector('[aria-label="State suite"]');return {text:section?.textContent||'',selected:section?.querySelector('select[aria-label="Matrix recipe"]')?.value,preview:{width:Number(document.querySelector('select[aria-label="Preview viewport width"]')?.value),theme:document.querySelector('select[aria-label="Preview color theme"]')?.value},rows:[...document.querySelectorAll('[data-matrix-cell-id]')].map(node=>({id:node.dataset.matrixCellId,status:node.dataset.cellStatus,text:node.textContent})),records:[...document.querySelectorAll('[data-matrix-id]')].map(node=>({id:node.dataset.matrixId,text:node.textContent})),replays:[...document.querySelectorAll('.runtime-replay-evidence')].map(node=>({id:node.dataset.replayId,status:node.dataset.replayStatus,text:node.textContent}))};})()`);
const setCheckbox=async(browser,frame,label,checked)=>{const selector=`input[type="checkbox"][aria-label=${JSON.stringify(label)}]`;const current=await evaluate(browser,frame,`document.querySelector(${JSON.stringify(selector)})?.checked`);assert.equal(typeof current,'boolean',`Visible checkbox ${label}`);if(current!==checked)await keyboard(browser,frame,selector,' ',true);await wait(()=>evaluate(browser,frame,`document.querySelector(${JSON.stringify(selector)})?.checked===${checked}`),'explicit checkbox selection');};
const openNamedDetails=async(browser,frame,label,scope='')=>{const keys=await wait(async()=>{const values=await evaluate(browser,frame,`[...document.querySelectorAll(${JSON.stringify((scope?scope+' ':'')+'summary')})].filter(e=>e.textContent.trim()===${JSON.stringify(label)}).map(e=>e.dataset.artifactFocus||e.dataset.designFocus)`);return values.length?values:false;},'rendered disclosure '+label);for(const key of keys)await disclosure(browser,frame,`summary[data-artifact-focus=${JSON.stringify(key)}],summary[data-design-focus=${JSON.stringify(key)}]`);return keys.length;};

const fillText=async(browser,frame,label,value)=>{
 const selector=`input[aria-label=${JSON.stringify(label)}]`;await wait(()=>evaluate(browser,frame,`Boolean(document.querySelector(${JSON.stringify(selector)})?.getClientRects().length)`),'visible suite text field');
 const entry={selector,value,method:'native-renderer fill-equivalent',trustedKeyboard:false};activations.push(entry);
 await evaluate(browser,frame,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Suite field unavailable');e.scrollIntoView({block:'nearest'});e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
};

const nativeFocusGates=[];
let browser;
try{
 for(const stage of ['write','restore']){
  const port=await debugPort(),ipc=path.join(temp,`${stage}-ipc`),outcome=path.join(temp,`${stage}-outcome.json`);await mkdir(ipc);
  const env={...process.env,FOUNDATION_SUITE_STAGE:stage,FOUNDATION_SUITE_OUTCOME:outcome,FOUNDATION_SUITE_REPORT:reportPath,FOUNDATION_SUITE_IPC:ipc,FOUNDATION_SUITE_EXTENSION:extensionPath,FOUNDATION_SUITE_WORKSPACE:workspace,FOUNDATION_SUITE_USER_DATA:userData};for(const key of Object.keys(env))if(key==='ELECTRON_RUN_AS_NODE'||/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key))delete env[key];
  const log=await open(path.join(temp,`${stage}.log`),'w'),child=spawn(path.join(app,'Contents/MacOS/Foundation'),[workspace,'--new-window','--user-data-dir',userData,'--shared-data-dir',path.join(temp,'shared-data'),'--extensions-dir',extensions,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--disable-crash-reporter','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{env,stdio:['ignore',log.fd,log.fd]});await log.close();let exited=false,exitCode,spawnError;child.once('exit',code=>{exited=true;exitCode=code;});child.once('error',error=>{spawnError=error;exited=true;});let index=1,result;const deadline=Date.now()+480000;
  try{while(!(result=await readJSON(outcome))){if(spawnError)throw spawnError;if(exited)throw Error(`${stage} exited ${exitCode} before outcome: ${temp}`);if(Date.now()>deadline)throw Error(`${stage} timed out: ${temp}`);const command=await readJSON(path.join(ipc,`command-${index}.json`));if(!command){await pause(100);continue;}if(index===1&&process.env.FOUNDATION_SUITE_FOCUS_GATE==='1'){const gate={app,temp,stage,pid:child.pid,port,release:path.join(temp,`native-focus-${stage}-release.json`)};await writeFile(path.join(temp,`native-focus-${stage}.json`),JSON.stringify(gate,null,2));console.error(`Native foreground confirmation required: ${path.join(temp,`native-focus-${stage}.json`)}`);const confirmed=await wait(()=>readJSON(gate.release),'actual native window foreground confirmation',180000);assert.equal(confirmed.focused,true);nativeFocusGates.push({...gate,confirmed:true});}let response;
   try{browser ||= await wait(()=>chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000}),'isolated candidate endpoint');const main=await nativeWorkbench(browser);await withTarget(browser,main.targetId,send=>send('Page.bringToFront'));const frame=await surfaceFrame(browser);
    if(command.type==='openScreen'){
     await wait(()=>evaluate(browser,frame,`(()=>{const button=document.querySelector('.runtime-open-screen');return !!button&&!button.disabled&&button.getClientRects().length>0;})()`),'explicit Open screen recovery control');await keyboard(browser,frame,'.runtime-open-screen','Enter',true);response={passed:true,renderer:await matrixEvidence(browser,frame)};
    }else if(command.type==='saveSuite'){
     await keyboard(browser,frame,'button[data-design-focus="suite/new"]','Enter',true);
     await fillText(browser,frame,'Suite name',command.name);
     for(const [i,row] of command.states.entries()){
      if(i>0)await keyboard(browser,frame,'button[data-design-focus="suite/add"]','Enter',true);
      await selectValue(browser,frame,`State ${i+1}`,row.state);await selectValue(browser,frame,`Recipe for state ${i+1}`,row.recipeId);
     }
     for(const width of [390,768,960])await setCheckbox(browser,frame,`Suite includes ${width} pixel width`,command.widths.includes(width));
     for(const [theme,label] of [['light','Light'],['dark','Dark']])await setCheckbox(browser,frame,`Suite includes ${label} app theme`,command.themes.includes(theme));
     for(const [motion,label] of [['system','Follow system'],['reduce','Reduced']])await setCheckbox(browser,frame,`Suite includes ${label} app motion`,command.motions.includes(motion));
     await setCheckbox(browser,frame,'Capture each suite result',command.captureEach);
     await wait(()=>evaluate(browser,frame,`Boolean(document.querySelector('button[data-design-focus="suite/save"]')&&!document.querySelector('button[data-design-focus="suite/save"]').disabled)`),'explicit suite Save enabled');
     await keyboard(browser,frame,'button[data-design-focus="suite/save"]','Enter',true);response={passed:true,renderer:await matrixEvidence(browser,frame)};
    }else if(command.type==='updateSuite'){
     await selectValue(browser,frame,'Saved suite',command.id);await keyboard(browser,frame,'button[data-design-focus="suite/edit"]','Enter',true);await fillText(browser,frame,'Suite name',command.name);await keyboard(browser,frame,'button[data-design-focus="suite/save"]','Enter',true);response={passed:true,renderer:await matrixEvidence(browser,frame)};
    }else if(command.type==='startSuite'){
     await selectValue(browser,frame,'Saved suite',command.id);
     if(await evaluate(browser,frame,`document.querySelector('.inspect-toggle')?.getAttribute('aria-pressed')==='true'`))await keyboard(browser,frame,'.inspect-toggle','Enter',true);
     if(await evaluate(browser,frame,`document.querySelector('[aria-label="Fit preview to canvas"]')?.getAttribute('aria-pressed')!=='true'`))await keyboard(browser,frame,'[aria-label="Fit preview to canvas"]','Enter',true);
     await wait(()=>evaluate(browser,frame,`(()=>{const e=document.querySelector('button[aria-label="Run suite"]');return !!e&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';})()`),'saved suite Run enabled');
     const ready=await matrixEvidence(browser,frame);await keyboard(browser,frame,'button[aria-label="Run suite"]','Enter',true);response={passed:true,ready,renderer:await matrixEvidence(browser,frame)};
    }else if(command.type==='stopSuite'){
     await wait(async()=>(await runtimeEvidence(browser,await runtimeFrame(browser))).pending==='waiting','suite callback executing');await keyboard(browser,frame,'button[aria-label="Stop suite"]','Enter',true);response={passed:true,renderer:await matrixEvidence(browser,frame)};
    }else if(command.type==='suiteHistory'){
     await disclosure(browser,frame,'details.feature-runtime-details > summary');await openNamedDetails(browser,frame,`State suites · ${command.count}`);
     const key=await wait(()=>evaluate(browser,frame,`(()=>{const summary=[...document.querySelectorAll('details.saved-suite > summary')].find(e=>(e.dataset.artifactFocus||e.dataset.designFocus||'').includes(${JSON.stringify(command.id)}));return summary?.dataset.artifactFocus||summary?.dataset.designFocus;})()`),'saved suite disclosure');await disclosure(browser,frame,`summary[data-artifact-focus=${JSON.stringify(key)}],summary[data-design-focus=${JSON.stringify(key)}]`);
     if(command.cellId)await disclosure(browser,frame,`details.saved-suite [data-matrix-id=${JSON.stringify(command.id)}] [data-matrix-cell-id=${JSON.stringify(command.cellId)}] details > summary`);
     response={passed:true,renderer:await matrixEvidence(browser,frame)};
    }else if(command.type==='startMatrix'){
     await openNamedDetails(browser,frame,'Choose conditions','[aria-label="Condition matrix"]');const initial=await matrixEvidence(browser,frame);await selectValue(browser,frame,'Matrix recipe',command.recipeId);
     for(const width of [390,768,960])await setCheckbox(browser,frame,`Include ${width} pixel width`,command.widths.includes(width));
     for(const [theme,label] of [['light','Light'],['dark','Dark']])await setCheckbox(browser,frame,`Include ${label} app theme`,command.themes.includes(theme));
     for(const [motion,label] of [['system','Follow system'],['reduce','Reduced']])await setCheckbox(browser,frame,`Include ${label} app motion`,command.motions.includes(motion));
     await setCheckbox(browser,frame,'Capture each result',command.captureEach);
     if(await evaluate(browser,frame,`document.querySelector('.inspect-toggle')?.getAttribute('aria-pressed')==='true'`))await keyboard(browser,frame,'.inspect-toggle','Enter',true);
     if(await evaluate(browser,frame,`document.querySelector('[aria-label="Fit preview to canvas"]')?.getAttribute('aria-pressed')!=='true'`))await keyboard(browser,frame,'[aria-label="Fit preview to canvas"]','Enter',true);
     await wait(()=>evaluate(browser,frame,`(()=>{const e=document.querySelector('button[aria-label="Run matrix"]');return !!e&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';})()`),'explicit matrix enabled');
     const ready=await matrixEvidence(browser,frame);await keyboard(browser,frame,'button[aria-label="Run matrix"]','Enter',true);response={passed:true,initial,ready,renderer:await matrixEvidence(browser,frame)};
    }else if(command.type==='stopMatrix'){
     await wait(async()=>(await runtimeEvidence(browser,await runtimeFrame(browser))).pending==='waiting','cancellable matrix callback actually executing');await keyboard(browser,frame,'button[aria-label="Stop matrix"]','Enter',true);response={passed:true,renderer:await matrixEvidence(browser,frame)};
    }else if(command.type==='inspectRuntime'){
     const runtime=await runtimeFrame(browser);if(command.preview)await wait(async()=>{const value=await runtimeEvidence(browser,runtime);return value.theme===command.preview.theme&&Math.abs(value.viewportWidthCss-command.preview.width)<=1;},'saved preview settings restored after matrix');response={passed:true,runtime:await runtimeEvidence(browser,runtime),renderer:await matrixEvidence(browser,frame)};
    }else if(command.type==='inspectMatrix'){
     await openNamedDetails(browser,frame,'Last matrix','[aria-label="Condition matrix"]');response={passed:true,renderer:await matrixEvidence(browser,frame)};
    }else if(command.type==='matrixHistory'){
     await disclosure(browser,frame,'details.feature-runtime-details > summary');await openNamedDetails(browser,frame,`Condition matrices · ${command.count}`);const historyKey=await wait(()=>evaluate(browser,frame,`(()=>{const summary=[...document.querySelectorAll('details.saved-matrix > summary')].find(e=>(e.dataset.artifactFocus||e.dataset.designFocus||'').includes(${JSON.stringify(command.id)}));return summary?.dataset.artifactFocus||summary?.dataset.designFocus;})()`),'saved matrix disclosure');await disclosure(browser,frame,`summary[data-artifact-focus=${JSON.stringify(historyKey)}],summary[data-design-focus=${JSON.stringify(historyKey)}]`);
     const selector=`[data-matrix-id=${JSON.stringify(command.id)}] [data-matrix-cell-id=${JSON.stringify(command.cellId)}] details > summary`;await disclosure(browser,frame,selector);response={passed:true,renderer:await matrixEvidence(browser,frame)};
    }else if(command.type==='useCell'){
     assert.ok(['beforeId','afterId'].includes(command.role));const selector=`details.saved-suite [data-matrix-id=${JSON.stringify(command.id)}] [data-matrix-cell-id=${JSON.stringify(command.cellId)}] button[data-design-focus$=${JSON.stringify('/'+command.role)}]`;await keyboard(browser,frame,selector,'Enter',true);response={passed:true,renderer:await inspectUI(browser,frame)};
    }else if(command.type==='openComparison'){await openComparison(browser,frame);response={passed:true,renderer:await inspectUI(browser,frame)};
    }else if(command.type==='select'){assert.ok(['Baseline observation','Comparison observation'].includes(command.label));await selectValue(browser,frame,command.label,command.value);response={passed:true,renderer:await inspectUI(browser,frame)};
    }else if(command.type==='inspectComparison'){
     await wait(async()=>{const value=await inspectUI(browser,frame);return value.images.length===2&&value.images.every(image=>image.status==='ready'&&image.width>0);},'paired matrix captures decoded');assert.equal(await openNamedDetails(browser,frame,'Recipe replay','[aria-label="Observation comparison"]'),2);await openNamedDetails(browser,frame,'Replay conditions','[aria-label="Observation comparison"]');response={passed:true,renderer:await inspectUI(browser,frame),matrices:await matrixEvidence(browser,frame)};
    }else if(command.type==='screenshot'){
     assert.ok(/^[a-z-]+$/.test(command.name));if(command.theme)await wait(async()=>(await inspectUI(browser,frame)).theme===command.theme,'native theme');const viewport=await evaluate(browser,main,'({innerWidth,innerHeight})');await nativeWindowScreenshot(browser,main,viewport,path.join(temp,`${stage}-${command.name}.png`));response={passed:true,renderer:await matrixEvidence(browser,frame)};
    }else throw Error(`Unsupported native matrix fixture action ${command.type}`);
   }catch(error){response={passed:false,error:error.stack||String(error)};}await writeFile(path.join(ipc,`result-${index}.json`),JSON.stringify(response));index++;
  }
  if(!result.passed&&process.env.FOUNDATION_SUITE_KEEP_FAILURE==='1'){await writeFile(path.join(temp,'native-debug.json'),JSON.stringify({temp,port,pid:child.pid,stage,error:result.error,release:path.join(temp,'release-debug.json')},null,2));console.error(`Native replay failure held for inspection: ${temp}`);await wait(()=>readJSON(path.join(temp,'release-debug.json')),'release isolated replay fixture',180000);}
  assert.equal(result.passed,true,`${stage}: ${result.error||'No passing result'}. See ${temp}`);while(!exited&&Date.now()<deadline)await pause(100);assert.equal(exited,true);assert.equal(exitCode,0);
  }catch(error){if(!exited)child.kill('SIGTERM');throw error;}finally{await browser?.close().catch(()=>{});browser=undefined;}
 }
 assert.deepEqual(await hashTree(workspace),initialFixture,'Matrix execution does not edit fixture source');assert.deepEqual(await hashTree(extensionPath),payload,'Tested package payload remains exact');assert.deepEqual(await hashTree(path.join(repo,'fixtures/replay-web')),maintainedFixture,'Maintained fixture remains unchanged');
 const report={...await readJSON(reportPath),passed:true,mode:'packaged',app,extensionPath,workspace,temp,userData,nativeActivations:activations,nativeFocusGates,provenance:{maintainedFixture,disposableFixture:initialFixture,payload,disposableInstrumentation:'Cooperative cancellation and explicit failure recipes added only to copied App.tsx; copied Vite plugin path points at the candidate. Maintained callbacks are unchanged.'},verificationBoundary:'Real saved state-suite definitions and sequential app-authored callbacks in fresh native iframe documents, trusted Save/Run/Stop activation, actual local requests, independent condition evidence, optional PNGs and exact restart history. Control-level select operations are recorded as synthetic. No physical hardware or human usability acceptance.'};assert.equal(report.restoredInSecondProcess,true);const output=path.join(desktop,'.build/native-state-suite-smoke-report.json'),previous=await readJSON(output);if(previous)await writeFile(path.join(temp,'previous-native-scenario-replay-report.json'),JSON.stringify(previous,null,2));await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(path.join(temp,'failure.json'),JSON.stringify({passed:false,error:error.stack||String(error),temp,app,workspace},null,2));throw error;}finally{await writeFile(path.join(temp,'native-activations.json'),JSON.stringify(activations,null,2));await browser?.close().catch(()=>{});}
