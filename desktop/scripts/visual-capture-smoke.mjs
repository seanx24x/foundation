import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {createServer} from 'node:net';
import {readFile,writeFile,mkdir,mkdtemp,realpath,cp,open,access,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.dirname(desktop);
assert.equal(process.argv.length,2,'Usage: FOUNDATION_APP_PATH=/candidate/Foundation.app node desktop/scripts/visual-capture-smoke.mjs');
assert.ok(process.env.FOUNDATION_APP_PATH,'Choose the exact isolated signed candidate');
const app=await realpath(process.env.FOUNDATION_APP_PATH),extensionPath=await realpath(path.join(app,'Contents/Resources/app/extensions/foundation-workspace')),plugin=path.join(extensionPath,'dist/connected-vite-plugin.mjs');await access(plugin);
const temp=await realpath(await mkdtemp('/private/tmp/foundation-visual-capture-smoke-')),workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions'),harness=path.join(extensions,'foundation-test.visual-capture-native-check-1.0.0'),reportPath=path.join(temp,'report.json');
await cp(path.join(repo,'fixtures/connected-web'),workspace,{recursive:true});await promisify(execFile)('/bin/cp',['-cR',path.join(repo,'node_modules'),path.join(workspace,'node_modules')]);const config=path.join(workspace,'vite.config.mjs');await writeFile(config,(await readFile(config,'utf8')).replace('../../desktop/runtime/vite-plugin.mjs',plugin));
// A disposable, instrumented React fixture renders distinctive actual states.
// Its PNGs are captured by Foundation; this script never creates comparison images.
await writeFile(path.join(workspace,'src/App.tsx'),`import { useState } from 'react';
export default function App(){const [color,setColor]=useState('blue');const [status,setStatus]=useState('Ready');async function save(next:string){setColor(next);setStatus('Saving');const response=await fetch('/api/ping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:next})});setStatus(response.ok?'Saved '+next:'Failed');}return <main data-native-capture-fixture style={{minHeight:'100vh',padding:32,boxSizing:'border-box',background:color==='blue'?'rgb(17,83,229)':'rgb(14,193,120)',fontFamily:'system-ui',color:'#fff'}}><h1>Native capture fixture</h1><p>Rendered by the project's real React runtime.</p><div style={{display:'flex',gap:16,flexWrap:'wrap'}}><button className="save-button" data-capture-state="blue" onClick={()=>save('blue')}>Save blue state</button><button className="save-button" data-capture-state="green" onClick={()=>save('green')}>Save green state</button></div><p role="status">{status}</p></main>}
`);
await mkdir(path.join(userData,'User'),{recursive:true});await mkdir(harness,{recursive:true});await Promise.all([writeFile(path.join(userData,'User/settings.json'),JSON.stringify({'foundation.openOnStartup':false,'foundation.ai.baseUrl':'','foundation.ai.model':'','foundation.ai.profiles':{},'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never','security.workspace.trust.enabled':false,'window.zoomLevel':-3})),writeFile(path.join(harness,'package.json'),JSON.stringify({name:'visual-capture-native-check',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-visual-capture-smoke.cjs')))]);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const beforeSource=digest(await readFile(path.join(workspace,'src/App.tsx')));
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
  entry.before = await readOn(send, frame, `(async()=>{const selector=${JSON.stringify(selector)};for(let n=0;n<3;n++){const element=document.querySelector(selector);if(!element||element.disabled||!element.getClientRects().length)continue;element.scrollIntoView({block:'nearest'});element.focus();await new Promise(r=>setTimeout(r,120));if(element===document.querySelector(selector)&&document.activeElement===element&&!element.disabled&&document.hasFocus()){const observed={element,events:[]};observed.listener=event=>observed.events.push({type:event.type,key:event.key,trusted:event.isTrusted,same:event.target===element,value:element.value});globalThis.__comparisonKeys=observed;for(const type of ['keydown','keyup','click','change'])document.addEventListener(type,observed.listener,true);return {ready:true,tag:element.tagName,value:element.value};}}return {ready:false,hasFocus:document.hasFocus(),active:document.activeElement?.tagName};})()`);
  assert.equal(entry.before.ready, true, `Native focus readiness: ${JSON.stringify(entry.before)}`);
  const keys = { Enter: ['Enter', 13, '\r'], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38] };
  assert.ok(keys[key]); const [code, windowsVirtualKeyCode, text] = keys[key];
  try {
    if (beforeDispatch) await beforeDispatch();
    entry.dispatched = true;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(text ? { text, unmodifiedText: text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  } finally {
    entry.events = await readOn(send, frame, `(()=>{const observed=globalThis.__comparisonKeys;for(const type of ['keydown','keyup','click','change'])document.removeEventListener(type,observed.listener,true);delete globalThis.__comparisonKeys;return observed.events;})()`);
  }
  assert.ok(entry.events.some(event => event.type === 'keydown' && event.key === key && event.trusted && event.same), 'Trusted keyboard input must reach the exact native control');
  if (expectClick) assert.equal(entry.events.filter(event => event.type === 'click' && event.trusted && event.same).length, 1, 'One trusted activation; never retry after dispatch');
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
  entry.before = await evaluate(browser, frame, `(()=>{const element=document.querySelector(${JSON.stringify(selector)}),value=${JSON.stringify(value)};if(!element||element.disabled||!element.getClientRects().length)throw Error('Observation select is not interactive');const option=[...element.options].find(item=>item.value===value&&!item.disabled);if(!option)throw Error('Requested saved observation is unavailable');const before={value:element.value,label:option.textContent,options:[...element.options].map(item=>item.value)};element.scrollIntoView({block:'nearest'});element.focus();element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));return before;})()`);
  await wait(async () => await evaluate(browser, frame, `document.querySelector(${JSON.stringify(selector)}).value`) === value, 'explicit observation selection takes effect');
};
const inspectUI=(browser,frame)=>evaluate(browser,frame,`(()=>{const region=document.querySelector('[aria-label="Observation comparison"]');return {baseline:document.querySelector('select[aria-label="Baseline observation"]')?.value,comparison:document.querySelector('select[aria-label="Comparison observation"]')?.value,regionText:region?.textContent||'',theme:document.body.dataset.vscodeThemeName,canvasCount:document.querySelectorAll('[data-foundation-runtime-canvas]').length,images:[...document.querySelectorAll('.runtime-capture')].map(node=>({label:node.getAttribute('aria-label'),status:node.dataset.captureStatus,width:node.querySelector('img')?.naturalWidth||0,height:node.querySelector('img')?.naturalHeight||0,srcKind:node.querySelector('img')?.src.split(':')[0]}))};})()`);
const runtimeFrame=browser=>wait(async()=>{const session=await browser.newBrowserCDPSession();let targets;try{targets=(await session.send('Target.getTargets')).targetInfos;}finally{await session.detach();}const matches=[];for(const target of targets.filter(item=>item.url.startsWith('vscode-webview://')||/^http:\/\/127\.0\.0\.1:\d+/.test(item.url))){try{await withTarget(browser,target.targetId,async send=>{const {frameTree}=await send('Page.getFrameTree');const visit=async node=>{const {executionContextId}=await send('Page.createIsolatedWorld',{frameId:node.frame.id,worldName:'foundationVisualCaptureFixture'});const frame={targetId:target.targetId,contextId:executionContextId};if(await readOn(send,frame,'Boolean(parent!==window && document.querySelector("[data-native-capture-fixture]"))'))matches.push(frame);for(const child of node.childFrames||[])await visit(child);};await visit(frameTree);});}catch{}}assert.ok(matches.length<=1,'Only one native fixture document may be active');return matches[0];},'actual native runtime iframe');
// Decode only actual PNG output from the candidate or its native screenshot.
function pixelCounts(bytes,regions={}){assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));let width,height,channels,offset=8;const compressed=[];while(offset<bytes.length){const length=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);if(kind==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);channels=data[9]===6?4:data[9]===2?3:0;assert.ok(channels);assert.equal(data[12],0);}if(kind==='IDAT')compressed.push(data);offset+=12+length;}const stride=width*channels,raw=inflateSync(Buffer.concat(compressed)),out=Buffer.alloc(stride*height);assert.equal(raw.length,(stride+1)*height);const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];assert.ok(filter<=4);for(let x=0;x<stride;x++){const a=x>=channels?out[y*stride+x-channels]:0,b=y?out[(y-1)*stride+x]:0,c=y&&x>=channels?out[(y-1)*stride+x-channels]:0,value=raw[y*(stride+1)+1+x]+(filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):0);out[y*stride+x]=value&255;}}const count={blue:0,green:0,outside:0},regionCounts=Object.fromEntries(Object.keys(regions).map(key=>[key,0]));for(let i=0;i<out.length;i+=channels){const r=out[i],g=out[i+1],b=out[i+2];if(b>150&&b>r*2&&b>g*1.5)count.blue++;if(g>120&&g>r*2&&g>b*1.2)count.green++;if(r>180&&b>180&&g<100){count.outside++;const pixel=i/channels,x=pixel%width,y=Math.floor(pixel/width);for(const [key,rect] of Object.entries(regions))if(x>=rect.x&&x<rect.x+rect.width&&y>=rect.y&&y<rect.y+rect.height)regionCounts[key]++;}}return {width,height,...count,...(Object.keys(regions).length?{regionCounts}:{})};}
const nativeWorkbench=async browser=>{const session=await browser.newBrowserCDPSession();let targets;try{targets=(await session.send('Target.getTargets')).targetInfos;}finally{await session.detach();}const matches=targets.filter(target=>target.type==='page'&&target.url.includes('/workbench/workbench.html'));assert.equal(matches.length,1,'One isolated native workbench target');return withTarget(browser,matches[0].targetId,async send=>{const {frameTree}=await send('Page.getFrameTree'),{executionContextId}=await send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'foundationNativeCaptureWorkbench'});return {targetId:matches[0].targetId,contextId:executionContextId};});};
const nativeWindowScreenshot=async(browser,main,viewport,file)=>withTarget(browser,main.targetId,async send=>{const result=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),bytes=Buffer.from(result.data,'base64');await writeFile(file,bytes);return bytes;});
const openComparison=async(browser,frame)=>{await evaluate(browser,frame,`document.getElementById('native-capture-outside-marker')?.remove();`);await disclosure(browser,frame,'details.feature-runtime-details > summary');const key=await wait(()=>evaluate(browser,frame,`(()=>{const summary=[...document.querySelectorAll('summary')].find(item=>item.textContent.trim()==='Compare observations');return summary?.dataset.artifactFocus||summary?.dataset.designFocus;})()`),'comparison disclosure');await disclosure(browser,frame,`summary[data-artifact-focus=${JSON.stringify(key)}],summary[data-design-focus=${JSON.stringify(key)}]`);};
let browser;
try{
 for(const stage of ['write','restore']){
  const port=await debugPort(),ipc=path.join(temp,`${stage}-ipc`),outcome=path.join(temp,`${stage}-outcome.json`);await mkdir(ipc);const env={...process.env,FOUNDATION_CAPTURE_STAGE:stage,FOUNDATION_CAPTURE_OUTCOME:outcome,FOUNDATION_CAPTURE_REPORT:reportPath,FOUNDATION_CAPTURE_IPC:ipc,FOUNDATION_CAPTURE_EXTENSION:extensionPath,FOUNDATION_CAPTURE_WORKSPACE:workspace,FOUNDATION_CAPTURE_USER_DATA:userData};for(const key of Object.keys(env))if(key==='ELECTRON_RUN_AS_NODE'||/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key))delete env[key];
  const log=await open(path.join(temp,`${stage}.log`),'w'),child=spawn(path.join(app,'Contents/MacOS/Foundation'),[workspace,'--new-window','--user-data-dir',userData,'--shared-data-dir',path.join(temp,'shared-data'),'--extensions-dir',extensions,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--disable-crash-reporter','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{env,stdio:['ignore',log.fd,log.fd]});await log.close();let exited=false,exitCode,spawnError;child.once('exit',code=>{exited=true;exitCode=code;});child.once('error',error=>{spawnError=error;exited=true;});let index=1,result;const deadline=Date.now()+180000;
  try{while(!(result=await readJSON(outcome))){if(spawnError)throw spawnError;if(exited)throw Error(`${stage} exited ${exitCode} before outcome: ${temp}`);if(Date.now()>deadline)throw Error(`${stage} timed out: ${temp}`);const command=await readJSON(path.join(ipc,`command-${index}.json`));if(!command){await pause(100);continue;}let response;
   try{browser ||= await wait(()=>chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000}),'isolated candidate debugging endpoint');const page=browser.contexts().flatMap(context=>context.pages()).find(item=>item.url().includes('/workbench/workbench.html'));assert.ok(page);await page.bringToFront();const frame=await surfaceFrame(browser);
    if(command.type==='prepareCanvas'){
     const width=command.width||960;assert.ok([960,768,390].includes(width));if(command.expectedDeviceScale){await wait(async()=>{const main=await nativeWorkbench(browser),dpr=await evaluate(browser,main,'devicePixelRatio');return Math.abs(dpr-command.expectedDeviceScale)<0.01;},'requested native window zoom');}await selectValue(browser,frame,'Preview viewport width',String(width));if(await evaluate(browser,frame,`document.querySelector('[aria-label="Fit preview to canvas"]')?.getAttribute('aria-pressed')!=='true'`))await keyboard(browser,frame,'[aria-label="Fit preview to canvas"]','Enter',true);if(await evaluate(browser,frame,`document.querySelector('.inspect-toggle')?.getAttribute('aria-pressed')==='true'`))await keyboard(browser,frame,'.inspect-toggle','Enter',true);
     await evaluate(browser,frame,`document.querySelector('[data-foundation-runtime-canvas]')?.scrollIntoView({block:'center',inline:'nearest'});`);let settled,stable=0;await wait(async()=>{const value=await evaluate(browser,frame,`(()=>{const e=document.querySelector('[data-foundation-runtime-canvas]'),r=e?.getBoundingClientRect();return r?JSON.stringify([innerWidth,innerHeight,devicePixelRatio,r.x,r.y,r.width,r.height,e.clientWidth,e.clientHeight]):null;})()`);stable=value&&value===settled?stable+1:0;settled=value;return stable>=3;},'native viewport and Fit geometry settle before observation');
     const geometry=await evaluate(browser,frame,`(()=>{const canvas=document.querySelector('[data-foundation-runtime-canvas]');if(!canvas)throw Error('Missing running iframe');const existing=document.getElementById('native-capture-outside-marker');existing?.remove();const marker=document.createElement('div');marker.id='native-capture-outside-marker';Object.assign(marker.style,{position:'fixed',top:'4px',left:'4px',width:'96px',height:'20px',background:'rgb(255,0,253)',zIndex:'2147483647',pointerEvents:'none'});document.body.append(marker);const a=canvas.getBoundingClientRect(),b=marker.getBoundingClientRect();return {viewport:{width:innerWidth,height:innerHeight},devicePixelRatio,fit:document.querySelector('[aria-label="Fit preview to canvas"]')?.getAttribute('aria-pressed')==='true',canvas:{x:a.x,y:a.y,width:a.width,height:a.height},outside:{x:b.x,y:b.y,width:b.width,height:b.height},overlap:a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y};})()`);assert.equal(geometry.overlap,false);assert.ok(geometry.canvas.x>=0&&geometry.canvas.y>=0&&geometry.canvas.x+geometry.canvas.width<=geometry.viewport.width+0.01&&geometry.canvas.y+geometry.canvas.height<=geometry.viewport.height+0.01,`Native canvas must be fully visible: ${JSON.stringify(geometry)}`);response={passed:true,geometry,renderer:await inspectUI(browser,frame)};
    }else if(command.type==='interact'){
     assert.ok(['blue','green'].includes(command.color));const childFrame=await runtimeFrame(browser);await keyboard(browser,childFrame,`button[data-capture-state="${command.color}"]`,'Enter',true);await wait(()=>evaluate(browser,childFrame,`document.querySelector('[role="status"]').textContent===${JSON.stringify('Saved '+command.color)}`),'actual native fixture response');response={passed:true,runtime:await evaluate(browser,childFrame,`({status:document.querySelector('[role="status"]').textContent,pathname:location.pathname,embedded:parent!==window})`)};
    }else if(command.type==='capture'){
     await wait(()=>evaluate(browser,frame,`Boolean(document.querySelector('[data-design-focus="manual-run/capture-finish"]')&&!document.querySelector('[data-design-focus="manual-run/capture-finish"]').disabled)`),'Capture and finish enabled');let perimeter;
     await keyboard(browser,frame,'[data-design-focus="manual-run/capture-finish"]','Enter',true,async()=>{
      // Fixture-only instrumentation in the trusted webview. Transparent inside;
      // all magenta paint is immediately outside the real runtime iframe.
      const geometry=await evaluate(browser,frame,`(()=>{const canvas=document.querySelector('[data-foundation-runtime-canvas]');if(!canvas)throw Error('Missing running iframe');const r=canvas.getBoundingClientRect(),viewport=canvas.parentElement,v=viewport.getBoundingClientRect();if(!viewport.matches('.design-viewport')||['x','y','width','height'].some(key=>Math.abs(r[key]-v[key])>0.01))throw Error('Outside outline must exactly surround the runtime viewport');Object.assign(viewport.style,{outline:'8px solid rgb(255,0,253)',outlineOffset:'0px'});return {x:r.x,y:r.y,width:r.width,height:r.height,innerWidth,innerHeight,outlineWidth:8};})()`);
      const main=await nativeWorkbench(browser),outer=await evaluate(browser,main,`(()=>{const webviewId=${JSON.stringify(frame.webviewId)},frames=[...document.querySelectorAll('iframe.webview')].filter(element=>element.name===webviewId&&element.getClientRects().length);if(frames.length!==1)throw Error('Expected the selected native workspace frame');const r=frames[0].getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,innerWidth,innerHeight};})()`);
      const screenshot=await nativeWindowScreenshot(browser,main,outer,path.join(temp,`${stage}-outside-marker-${index}.png`)),windowPixels=pixelCounts(screenshot),scaleX=windowPixels.width/outer.innerWidth,scaleY=windowPixels.height/outer.innerHeight,frameScaleX=outer.width/geometry.innerWidth,frameScaleY=outer.height/geometry.innerHeight;
      const region=(x,y,width,height)=>({x:(outer.x+x*frameScaleX)*scaleX,y:(outer.y+y*frameScaleY)*scaleY,width:width*frameScaleX*scaleX,height:height*frameScaleY*scaleY});
      const regions={top:region(geometry.x+16,geometry.y-9,geometry.width-32,10),bottom:region(geometry.x+16,geometry.y+geometry.height-1,geometry.width-32,10),left:region(geometry.x-9,geometry.y+16,10,geometry.height-32),right:region(geometry.x+geometry.width-1,geometry.y+16,10,geometry.height-32),header:region(4,4,96,20)};
      const pixels=pixelCounts(screenshot,regions);await writeFile(path.join(temp,`${stage}-perimeter-${index}.json`),JSON.stringify({geometry,outer,regions,pixels},null,2));for(const [edge,count] of Object.entries(pixels.regionCounts))assert.ok(count>100,`Outside-canvas ${edge} marker must be visible in actual native pixels: ${JSON.stringify(pixels.regionCounts)}`);perimeter={geometry,outer,regions,visibleMagentaPixels:pixels.regionCounts};
     });response={passed:true,perimeter,renderer:await inspectUI(browser,frame)};
    }else if(command.type==='verifyPixels'){
     const expected=path.join(userData,'User/globalStorage/foundation.foundation-workspace/runtime-captures');assert.ok(command.asset.startsWith(expected+path.sep));assert.equal(path.basename(command.asset),`${command.capture.id}.png`);const bytes=await readFile(command.asset);assert.equal(digest(bytes),command.capture.image.sha256);const pixels=pixelCounts(bytes);assert.equal(pixels.width,command.capture.image.widthPx);assert.equal(pixels.height,command.capture.image.heightPx);assert.ok(pixels[command.color]>5000,`Expected actual ${command.color} state pixels: ${JSON.stringify(pixels)}`);assert.equal(pixels.outside,0,'Cropped image must exclude the visible header and all four immediately adjacent perimeter markers');response={passed:true,pixels};console.error(`Verified native ${command.color} capture ${pixels.width}x${pixels.height}; outside header and perimeter excluded.`);
    }else if(command.type==='openComparison'){await openComparison(browser,frame);response={passed:true,renderer:await inspectUI(browser,frame)};
    }else if(command.type==='select'){assert.ok(['Baseline observation','Comparison observation'].includes(command.label));await selectValue(browser,frame,command.label,command.value);response={passed:true,renderer:await inspectUI(browser,frame)};
    }else if(command.type==='inspectImages'){await wait(async()=>{const value=await inspectUI(browser,frame);return value.images.length===2&&value.images.every(item=>item.status==='ready'&&item.width>0);},'paired native saved images decoded');for(const label of ['Capture conditions','Capture details']){const selectors=await evaluate(browser,frame,`[...document.querySelectorAll('[aria-label="Observation comparison"] summary')].filter(item=>item.textContent.trim()===${JSON.stringify(label)}).map(item=>item.dataset.artifactFocus||item.dataset.designFocus)`);for(const key of selectors)await disclosure(browser,frame,`summary[data-artifact-focus=${JSON.stringify(key)}],summary[data-design-focus=${JSON.stringify(key)}]`);}response={passed:true,renderer:await inspectUI(browser,frame)};
    }else if(command.type==='screenshot'){await wait(async()=>(await inspectUI(browser,frame)).theme===command.theme,'native theme');const main=await nativeWorkbench(browser),viewport=await evaluate(browser,main,'({innerWidth,innerHeight})');await nativeWindowScreenshot(browser,main,viewport,path.join(temp,`${stage}-${command.theme==='Foundation Dark'?'dark':'light'}.png`));response={passed:true,renderer:await inspectUI(browser,frame)};
    }else throw Error(`Unsupported native capture fixture action ${command.type}`);
   }catch(error){response={passed:false,error:error.stack||String(error)};}await writeFile(path.join(ipc,`result-${index}.json`),JSON.stringify(response));index++;
  }if(!result.passed && process.env.FOUNDATION_CAPTURE_KEEP_FAILURE==='1'){await writeFile(path.join(temp,'native-debug.json'),JSON.stringify({temp,port,pid:child.pid,stage,error:result.error,release:path.join(temp,'release-debug.json')},null,2));console.error(`Native capture failure held for inspection: ${temp}`);await wait(()=>readJSON(path.join(temp,'release-debug.json')),'release isolated native debug fixture',180000);}assert.equal(result.passed,true,`${stage}: ${result.error||'No passing result'}. See ${temp}`);while(!exited&&Date.now()<deadline)await pause(100);assert.equal(exited,true);assert.equal(exitCode,0);
  }catch(error){if(!exited)child.kill('SIGTERM');throw error;}finally{await browser?.close().catch(()=>{});browser=undefined;}
 }
 const report={...await readJSON(reportPath),passed:true,mode:'packaged',app,extensionPath,workspace,temp,userData,nativeActivations:activations,fixtureWindowZoomLevels:[-3,0],pixelClassification:'Disjoint broad RGB color ranges account for native display color conversion; expected state must exceed 5000 pixels and the outside magenta header and four immediately adjacent perimeter edges must be visible in the native window and absent from saved pixels. The perimeter is trusted-webview test instrumentation, not runtime source pixels.',verificationBoundary:'Actual native iframe interactions and cropped Electron PNG pixels. Comparison restoration is automated; human craft review and physical hardware acceptance remain separate.'};assert.equal(report.restoredInSecondProcess,true);assert.equal(digest(await readFile(path.join(workspace,'src/App.tsx'))),beforeSource);const output=path.join(desktop,'.build/native-visual-capture-smoke-report.json');const previous=await readJSON(output);if(previous)await writeFile(path.join(temp,'previous-native-visual-capture-report.json'),JSON.stringify(previous,null,2));await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(path.join(temp,'failure.json'),JSON.stringify({passed:false,error:error.stack||String(error),temp,app,workspace},null,2));throw error;}finally{await writeFile(path.join(temp,'native-activations.json'),JSON.stringify(activations,null,2));await browser?.close().catch(()=>{});}
