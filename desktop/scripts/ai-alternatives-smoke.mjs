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
assert.equal(process.argv.length,2,'Usage: FOUNDATION_APP_PATH=/candidate/Foundation.app node desktop/scripts/ai-alternatives-smoke.mjs');
assert.ok(process.env.FOUNDATION_APP_PATH,'Choose the exact isolated signed candidate');
const app=await realpath(process.env.FOUNDATION_APP_PATH),extensionPath=await realpath(path.join(app,'Contents/Resources/app/extensions/foundation-workspace'));
const temp=await realpath(await mkdtemp('/private/tmp/foundation-ai-alternatives-smoke-')),workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions'),harness=path.join(extensions,'foundation-test.ai-alternatives-native-check-1.0.0'),reportPath=path.join(temp,'report.json');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashTree=async root=>{const values=[];async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){if(item.name==='node_modules')continue;const file=path.join(dir,item.name);assert.equal(item.isSymbolicLink(),false,'Fixture and package inputs must be ordinary files');if(item.isDirectory())await walk(file);else if(item.isFile()){const bytes=await readFile(file);values.push({path:path.relative(root,file).split(path.sep).join('/'),bytes:bytes.length,sha256:digest(bytes)});}}}await walk(root);return values.sort((a,b)=>a.path.localeCompare(b.path));};
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
const binarySha256=digest(await readFile(path.join(app,'Contents/MacOS/Foundation'))),payload=await hashTree(extensionPath);
await Promise.all([mkdir(path.join(workspace,'src'),{recursive:true}),mkdir(path.join(userData,'User'),{recursive:true}),mkdir(harness,{recursive:true})]);
await cp(path.join(path.dirname(desktop),'fixtures/replay-web'),workspace,{recursive:true});
execFileSync('/bin/cp',['-cR',path.join(path.dirname(desktop),'node_modules'),path.join(workspace,'node_modules')]);
const config=path.join(workspace,'vite.config.mjs');await writeFile(config,(await readFile(config,'utf8')).replace('../../desktop/runtime/vite-plugin.mjs',path.join(extensionPath,'dist/connected-vite-plugin.mjs')));
await writeFile(path.join(workspace,'src/style.css'),':root{--orbit-radius:8px}\n'+(await readFile(path.join(workspace,'src/style.css'),'utf8')).replaceAll('border-radius:8px','border-radius:var(--orbit-radius)'));
await writeFile(path.join(workspace,'src/UnrelatedDraft.ts'), 'export const unrelatedNote = \"Preserve this draft\";\n');
const initialFixture=await hashTree(workspace);
await Promise.all([writeFile(path.join(userData,'User/settings.json'),JSON.stringify({'foundation.openOnStartup':false,'foundation.ai.baseUrl':'','foundation.ai.model':'','foundation.ai.profiles':{},'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never','security.workspace.trust.enabled':false,'files.hotExit':'onExitAndWindowClose','files.autoSave':'off','window.zoomLevel':-2})),writeFile(path.join(harness,'package.json'),JSON.stringify({name:'ai-alternatives-native-check',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-ai-alternatives-smoke.cjs')))]);
// Deterministic loopback protocol fixture. No remote model, credential or Keychain.
const providerRequests=[];
const provider=createHTTPServer(async(req,res)=>{
 try{
  assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,undefined);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const payload=JSON.parse(Buffer.concat(chunks)),input=JSON.parse(payload.messages[1].content);
  assert.equal(payload.model,'foundation-local-ai-alternatives-fixture');assert.equal(payload.tools,undefined);assert.equal(input.intent,'build');
  assert.equal(input.planContext,undefined);assert.equal(input.context,undefined);assert.equal(input.groupRevision,undefined);assert.equal(input.requestRevision,undefined);
  assert.deepEqual(input.sources.map(file=>file.path).sort(),['src/App.tsx','src/style.css']);
  const sourceFacts=[];for(const file of input.sources){const saved=await readFile(path.join(workspace,file.path),'utf8'),numbered=saved.split('\n').map((line,index)=>`${index+1}: ${line}`).join('\n');assert.ok(file.content===numbered,'Shared context must be the exact numbered saved baseline');const {content,...metadata}=file;sourceFacts.push({...metadata,sha256:digest(saved),sharedContentSha256:digest(content),sharedContentFormat:'numbered-lines'});}
  assert.ok(!JSON.stringify(input).includes('Unrelated unsaved scoped'));assert.equal(providerRequests.length,0,'Only one explicit alternatives request is permitted');
  assert.equal(input.alternativeGeneration.version,1);assert.equal(input.alternativeGeneration.count,2);assert.equal(input.alternativeGeneration.scope.scenario.title,'Save profile successfully');
  for(const key of ['taskContext','runtimeContext','decisionContext','issueContext','checkContext'])assert.equal(input[key],undefined);
  const candidates=[['Soft save','12px','Save profile'],['Pill save','40px','Update profile']].map(([name,radius,label])=>({name,reason:name==='Soft save'?'Use a softer shared radius with a direct save label.':'Use a pill shape with a more explicit update label.',title:name,summary:'Coordinate the saved button label and shared corner radius.',edits:[{path:'src/App.tsx',find: ": 'Save changes'",replace: ": '"+label+"'"},{path:'src/style.css',find:'--orbit-radius:8px',replace:'--orbit-radius:'+radius}],verification:['Inspect the successful save scenario in both saved source copies.']}));
  providerRequests.push({intent:input.intent,question:input.question,sources:sourceFacts,generation:input.alternativeGeneration,candidates:candidates.map(({name,reason})=>({name,reason}))});
  const change={title:'Save interaction alternatives',summary:'Two distinct label and shape options from the same saved source.',candidates};
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({model:payload.model,choices:[{delta:{content:JSON.stringify(change)},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})}\n\ndata: [DONE]\n\n`);
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Local scoped alternative fixture rejected this request.'}));providerRequests.push({fixtureError:error.message});}finally{await writeFile(path.join(temp,'mock-provider-requests.json'),JSON.stringify(providerRequests,null,2));}
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
const runtimeFrame=browser=>wait(async()=>{const session=await browser.newBrowserCDPSession();let targets;try{targets=(await session.send('Target.getTargets')).targetInfos;}finally{await session.detach();}const matches=[];for(const target of targets.filter(item=>item.url.startsWith('vscode-webview://')||/^http:\/\/127\.0\.0\.1:\d+/.test(item.url))){try{await withTarget(browser,target.targetId,async send=>{const {frameTree}=await send('Page.getFrameTree');const visit=async node=>{const {executionContextId}=await send('Page.createIsolatedWorld',{frameId:node.frame.id,worldName:'foundationVisualCaptureFixture'});const frame={targetId:target.targetId,contextId:executionContextId};if(await readOn(send,frame,'Boolean(parent!==window && document.querySelector(".orbit-app"))'))if(!matches.some(item=>item.frameId===node.frame.id))matches.push({...frame,frameId:node.frame.id});for(const child of node.childFrames||[])await visit(child);};await visit(frameTree);});}catch{}}assert.ok(matches.length<=1,'Only one native fixture document may be active');return matches[0];},'actual native runtime iframe');
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
const alternativeUI=(browser,frame)=>withTarget(browser,frame.targetId,async send=>{
 const result=await readOn(send,frame,`(()=>{
  const pair=document.querySelector('[aria-label="Selected alternative comparison"]');
  const images=[...pair?.querySelectorAll('.alternative-capture')||[]].map(e=>{const image=e.querySelector('img');return {label:e.getAttribute('aria-label'),status:e.dataset.captureStatus,width:image?.naturalWidth||0,height:image?.naturalHeight||0,url:image?.currentSrc||null};});
  return {text:document.body.textContent,images,canvas:!!document.querySelector('[data-foundation-alternative-canvas]'),comparison:pair?{leftId:pair.dataset.comparisonLeft,rightId:pair.dataset.comparisonRight,text:pair.textContent}:null,firstResult:document.querySelector('select[aria-label="First result"]')?.value,secondResult:document.querySelector('select[aria-label="Second result"]')?.value,reviews:[...pair?.querySelectorAll('.alternative-review-controls')||[]].map(e=>({label:e.closest('section')?.getAttribute('aria-label'),disabled:e.querySelector('button')?.disabled,ariaDisabled:e.querySelector('button')?.getAttribute('aria-disabled'),text:e.textContent}))};
 })()`);
 if(result.images.some(image=>image.width>0))await send('Page.enable');
 for(const image of result.images){
  image.sha256=null;
  if(image.width>0){
   assert.ok(image.url?.startsWith('blob:'),'Saved comparison pixels use a local validated blob');
   // Read the already displayed image resource using DevTools. No fetch or CSP change.
   const resource=await send('Page.getResourceContent',{frameId:frame.frameId,url:image.url});
   assert.equal(resource.base64Encoded,true,'Native PNG resource is binary');
   image.sha256=digest(Buffer.from(resource.content,'base64'));
  }
  delete image.url;
 }
 return result;
});

const verificationUI=(browser,frame)=>evaluate(browser,frame,`(()=>{const region=document.querySelector('[aria-label="Visual change verification"]');return {text:region?.textContent||'',bodyText:document.body.textContent,theme:document.body.dataset.vscodeThemeName,selects:[...document.querySelectorAll('select')].map(e=>({label:e.getAttribute('aria-label'),value:e.value,options:[...e.options].map(o=>({value:o.value,text:o.textContent,disabled:o.disabled}))})),images:[...document.querySelectorAll('.runtime-capture')].map(e=>({status:e.dataset.captureStatus,width:e.querySelector('img')?.naturalWidth||0,height:e.querySelector('img')?.naturalHeight||0})),baseline:document.querySelector('select[aria-label="Baseline observation"]')?.value,comparison:document.querySelector('select[aria-label="Comparison observation"]')?.value};})()`);
const namedButton=async(browser,frame,label,scope='')=>{const selector=await wait(()=>evaluate(browser,frame,`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope?scope+' button':'button')})].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled&&e.getClientRects().length);return e?.dataset.artifactFocus?'button[data-artifact-focus='+JSON.stringify(e.dataset.artifactFocus)+']':e?.dataset.designFocus?'button[data-design-focus='+JSON.stringify(e.dataset.designFocus)+']':null;})()`),'enabled '+label);await keyboard(browser,frame,selector,'Enter',true);};
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
  Object.assign(env,{FOUNDATION_AI_BASE_URL:providerURL,FOUNDATION_AI_MODEL:'foundation-local-ai-alternatives-fixture',FOUNDATION_AI_PROVIDER_KIND:'compatible'});
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
     browser ||= await wait(()=>chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000}),'isolated candidate endpoint');const main=await nativeWorkbench(browser);await withTarget(browser,main.targetId,send=>send('Page.bringToFront'));const frame=await surfaceFrame(browser,['compose','aiCandidate','aiDraft','aiInspect','aiScreenshot'].includes(command.type)?'assistant':'workspace');
     if(command.type==='compose'){
      assert.equal(stage,'write');assert.equal(command.intent,'build');assert.deepEqual(command.paths.slice().sort(),['src/App.tsx','src/style.css']);
      await keyboard(browser,frame,'button[aria-label="Build mode"]','Enter',true);
      await wait(()=>evaluate(browser,frame,`document.querySelector('button[aria-label="Build mode"]')?.getAttribute('aria-pressed')==='true'`),'Build mode selected');
      await disclosure(browser,frame,'summary[aria-label="Request context and model"]');
      const available=await evaluate(browser,frame,'[...document.querySelectorAll("input[data-context-path]")].map(e=>({path:e.dataset.contextPath,checked:e.checked}))');
      assert.ok(command.paths.every(file=>available.some(value=>value.path===file)),'Both explicitly shared files are available');
      for(const item of available){const selector=`input[data-context-path=${JSON.stringify(item.path)}]`,checked=command.paths.includes(item.path);if(item.checked!==checked)await keyboard(browser,frame,selector,' ',true);}
      await keyboard(browser,frame,'input[aria-label="Explore alternatives"]',' ',true);
      await selectValue(browser,frame,'Alternative scenario',command.scenarioId);
      await fillText(browser,frame,'Ask about your source',command.question);
      assert.deepEqual(await evaluate(browser,frame,'[...document.querySelectorAll("input[data-context-path]:checked")].map(e=>e.dataset.contextPath).sort()'),command.paths.slice().sort());
      await keyboard(browser,frame,'#ask-submit','Enter',true);
     }else if(command.type==='aiCandidate'){
      assert.equal(stage,'write');await namedButton(browser,frame,'Review candidate',`[data-ai-candidate-id=${JSON.stringify(command.id)}]`);
     }else if(command.type==='aiDraft'){
      const enabled=await evaluate(browser,frame,`document.querySelector('input[aria-label="Explore alternatives"]')?.checked`);
      if(!enabled)await keyboard(browser,frame,'input[aria-label="Explore alternatives"]',' ',true);
      await selectValue(browser,frame,'Alternative scenario',command.scenarioId);await fillText(browser,frame,'Ask about your source',command.question);
     }else if(command.type==='aiInspect'){
      await wait(()=>evaluate(browser,frame,'document.querySelectorAll("[data-ai-candidate-id]").length===2'),'both generated candidates visible');
     }else if(command.type==='aiScreenshot'){
      if(command.theme)await wait(async()=>(await impactUI(browser,frame)).theme===command.theme,'native assistant theme');
      const selector=command.candidateId?`[data-ai-candidate-id=${JSON.stringify(command.candidateId)}]`:'[aria-label="AI alternatives"]';
      await evaluate(browser,frame,`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',behavior:'instant'})`);
      const bounds=await evaluate(browser,frame,`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,text:e.textContent}:null;})()`);assert.ok(bounds&&bounds.width>0&&bounds.height>0);assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=bounds.viewportWidth+1);assert.ok(bounds.y>=-1&&bounds.y+bounds.height<=bounds.viewportHeight+1,'Exact candidate is visible in native Assistant');
      await writeFile(path.join(temp,`${stage}-${command.name}-bounds.json`),JSON.stringify(bounds,null,2));const viewport=await evaluate(browser,main,'({innerWidth,innerHeight})');await nativeWindowScreenshot(browser,main,viewport,path.join(temp,`${stage}-${command.name}.png`));
     }else if(command.type==='groupAction'){
      assert.ok(['Open native diff','Apply all','Undo all','Discard group'].includes(command.label));
      await namedButton(browser,frame,command.label,`[data-artifact-id=${JSON.stringify('change-set/'+command.id)}]`);
     }else if(command.type==='select')await selectValue(browser,frame,command.label,command.value);
     else if(command.type==='fill')await fillText(browser,frame,command.label,command.value);
     else if(command.type==='comparison'){await wait(async()=>{const v=await alternativeUI(browser,frame);return v.comparison?.leftId===command.leftId&&v.comparison?.rightId===command.rightId;},'exact saved candidate pair');}
     else if(command.type==='namedButton')await namedButton(browser,frame,command.label,command.scope);
     else if(command.type==='alternatives'){
      await wait(()=>evaluate(browser,frame,`Boolean(document.querySelector('[aria-label=\"Compare before applying\"]')||document.querySelector('[aria-label=\"Visual alternatives\"]'))`),'comparison renderer');if(command.details)await openNamedDetails(browser,frame,command.details);
     }else if(command.type==='alternativeCapture')await keyboard(browser,frame,'[aria-label="Compare before applying"] input[type="checkbox"]',' ',true);
     else if(command.type==='alternativeImages')await wait(async()=>{const v=await alternativeUI(browser,frame);return v.images.length===2&&v.images.every(i=>i.status==='ready'&&i.width>0);},'exact alternative images');
     else if(command.type==='prepareCanvas'){
      await selectValue(browser,frame,'Preview source','runtime');await selectValue(browser,frame,'Preview viewport width','960');
      if(await evaluate(browser,frame,`document.querySelector('[aria-label="Fit preview to canvas"]')?.getAttribute('aria-pressed')!=='true'`))await keyboard(browser,frame,'[aria-label="Fit preview to canvas"]','Enter',true);
      if(await evaluate(browser,frame,`document.querySelector('.inspect-toggle')?.getAttribute('aria-pressed')==='true'`))await keyboard(browser,frame,'.inspect-toggle','Enter',true);
      await evaluate(browser,frame,`document.querySelector('[data-foundation-runtime-canvas]')?.scrollIntoView({block:'center'});`);
      let previous,stable=0;await wait(async()=>{const current=await evaluate(browser,frame,`(()=>{const e=document.querySelector('[data-foundation-runtime-canvas]'),r=e?.getBoundingClientRect();return r?JSON.stringify([r.x,r.y,r.width,r.height]):null;})()`);stable=current&&current===previous?stable+1:0;previous=current;return stable>=3;},'stable actual runtime canvas');
     }else if(command.type==='interact'){
      const runtime=await runtimeFrame(browser);await keyboard(browser,runtime,'button.save-button','Enter',true);await wait(()=>evaluate(browser,runtime,`document.querySelector('[role="status"]')?.textContent==='Your profile is up to date.'`),'real profile save');
      const radius=await evaluate(browser,runtime,`getComputedStyle(document.querySelector('form')).borderRadius`);assert.equal(radius,command.radius);
     }else if(command.type==='capture')await namedButton(browser,frame,'Capture and finish observation');
     else if(command.type==='verification'){
      await wait(async()=>{const view=await verificationUI(browser,frame);return command.text?view.bodyText.includes(command.text):true;},'verification rendered');
      if(command.details)await openNamedDetails(browser,frame,command.details);
     }else if(command.type==='inspectImages'){
      await wait(async()=>{const v=await verificationUI(browser,frame);return v.images.length===2&&v.images.every(i=>i.status==='ready'&&i.width>0)&&v.baseline===command.beforeId&&v.comparison===command.afterId;},'exact saved observation images');
     }else if(command.type==='selectComponent'){
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
      assert.ok(/^[a-z-]+$/.test(command.name));if(command.theme)await wait(async()=>(await impactUI(browser,frame)).theme===command.theme,'native theme');await evaluate(browser,frame,`document.querySelector('[aria-label="Selected alternative comparison"]')?.scrollIntoView({block:'start',behavior:'instant'})`);const viewport=await evaluate(browser,main,'({innerWidth,innerHeight})');await nativeWindowScreenshot(browser,main,viewport,path.join(temp,`${stage}-${command.name}.png`));
     }else if(command.type==='inspect'){
      if(typeof command.expectedReviewDisabled==='boolean')await wait(async()=>(await impactUI(browser,frame)).reviewDisabled===command.expectedReviewDisabled,'rendered token preparation state');
     }else throw Error(`Unsupported native verification action ${command.type}`);
     response={passed:true,renderer:{...await impactUI(browser,frame),...await verificationUI(browser,frame),...await alternativeUI(browser,frame),providerRequests:providerRequests.length,ai:await evaluate(browser,frame,`(()=>{return {composer:document.querySelector('textarea[aria-label="Ask about your source"]')?.value,explore:document.querySelector('input[aria-label="Explore alternatives"]')?.checked,scenario:document.querySelector('select[aria-label="Alternative scenario"]')?.value,candidates:[...document.querySelectorAll("[data-ai-candidate-id]")].map(e=>({id:e.dataset.aiCandidateId,text:e.textContent,buttons:[...e.querySelectorAll("button")].map(b=>({label:b.textContent.trim(),disabled:b.disabled}))}))};})()`)}};
    }catch(error){response={passed:false,error:error.stack||String(error)};}
    await writeFile(path.join(ipc,`result-${index}.json`),JSON.stringify(response));index++;
   }
   if(!result.passed&&process.env.FOUNDATION_VERIFICATION_KEEP_FAILURE==='1'){await writeFile(path.join(temp,'native-debug.json'),JSON.stringify({temp,port,pid:child.pid,stage,error:result.error,release:path.join(temp,'release-debug.json')},null,2));console.error(`Native visual-alternatives failure held for inspection: ${temp}`);await wait(()=>readJSON(path.join(temp,'release-debug.json')),'release isolated impact fixture',180000);}
   assert.equal(result.passed,true,`${stage}: ${result.error||'No passing result'}. See ${temp}`);while(!exited&&Date.now()<deadline)await pause(100);assert.equal(exited,true);assert.equal(exitCode,0);
  }catch(error){await stopGroup(child.pid);throw error;}finally{await browser?.close().catch(()=>{});browser=undefined;await stopGroup(child.pid);}
 }
 assert.deepEqual(await hashTree(workspace),initialFixture,'Explicit Undo restores every original saved fixture file');assert.deepEqual(await hashTree(extensionPath),payload,'Tested package payload remains exact');
 assert.equal(providerRequests.length,1);assert.ok(providerRequests.every(value=>!value.fixtureError));
 const report={...await readJSON(reportPath),providerRequests,passed:true,mode:'packaged',app,extensionPath,workspace,temp,userData,nativeActivations:activations,nativeFocusGates,provenance:{disposableInstrumentation:'Maintained replay-web fixture with a disposable CSS radius token; one dedicated alternatives request to a deterministic local protocol fixture change App.tsx and style.css; copied dependencies and candidate plugin path.',candidateSignature:'codesign --verify --deep --strict passed',binarySha256,disposableFixture:initialFixture,payload},verificationBoundary:'Real native AI generated two-candidate artifact explicitly staged into two-file groups, prepared and run under an exact shared saved baseline, scenario, recipe and requested conditions; four isolated runtime observations and PNGs; explicit retained-result comparison; blocked conflicting Review; native diffs for both files; explicit whole-group Apply and Undo; second-process names, selected pair, evidence, local retained group and unrelated draft restoration. Exactly one deterministic loopback protocol fixture request, no remote model or credential. Buttons use trusted CDP events, text uses Input.insertText and selects use recorded control-level selectOption equivalents. Compilation, visual assessment and physical hardware acceptance remain separate.'};assert.equal(report.restoredInSecondProcess,true);const output=path.join(desktop,'.build/native-ai-alternatives-smoke-report.json'),previous=await readJSON(output);if(previous)await writeFile(path.join(temp,'previous-native-ai-alternatives-report.json'),JSON.stringify(previous,null,2));await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(path.join(temp,'failure.json'),JSON.stringify({passed:false,error:error.stack||String(error),temp,app,workspace},null,2));throw error;}finally{await writeFile(path.join(temp,'mock-provider-requests.json'),JSON.stringify(providerRequests,null,2));await writeFile(path.join(temp,'native-activations.json'),JSON.stringify(activations,null,2));await browser?.close().catch(()=>{});await Promise.all([...activeGroups].map(stopGroup));await new Promise(resolve=>provider.close(resolve));}
