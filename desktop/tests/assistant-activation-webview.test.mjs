import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {historyHost,populatedHistory} from '../extension/test/helpers/history-performance-fixture.mjs';
import {createConversationStore} from '../extension/src/conversation-store.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));

test('trusted Assistant activation survives background history updates',async t=>{
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(['/webview.js','/artifact-model.js','/workspace-model.js','/history-model.js','/webview.css'].includes(url.pathname)||/^\/fonts\/[a-z-]+\.woff2$/.test(url.pathname)){
   res.setHeader('Content-Type',url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'font/woff2');res.end(await readFile(join(root,'desktop/extension/media',url.pathname.slice(1))));
  }else if(url.pathname==='/'){
   res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/webview.css"></head><body data-foundation-surface="assistant"><div id="foundation-root"></div><script src="/workspace-model.js"></script><script src="/artifact-model.js"></script><script src="/history-model.js"></script><script src="/webview.js"></script></body></html>');
  }else res.writeHead(404).end();
 }catch(error){res.writeHead(500).end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 for(const gesture of ['Space','pointer','Enter','pointer-outside','pointer-cancel','blur-cancel-event','focus-loss','trust-loss','project-change','request-change','feature-change','send','send-source-change','send-feature-revision','send-dirty','send-provider-change','send-trust-loss','source-label','context-summary','mode-change','next-disclosure'])await t.test(`${gesture} preserves native intent and current ownership`,async t=>{
  const page=await browser.newPage({viewport:{width:384,height:800}}),errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>page.close());
  await page.addInitScript(()=>{window.outbound=[];window.acquireVsCodeApi=()=>({getState:()=>null,setState(){},postMessage:message=>window.outbound.push(message)});});
  const h=historyHost({fixture:populatedHistory({sourceCount:1,sourceBytes:256,runCount:1,observationsPerRun:1})});
  const store=createConversationStore({projectId:h.fixture.project.id,read:()=>null,write:async()=>{}});t.after(()=>store.dispose());
  const file={path:'src/App.tsx',revision:'saved-revision',source:'export const app = true;',language:'typescript',analysis:{symbols:[],imports:[],consumers:[],requests:[]}};
  await store.startTurn({requestId:'stream',prompt:'Explain this source.',context:[file]});store.event('stream',{type:'start',model:'local'});store.event('stream',{type:'delta',text:'First streamed text.'});
  const idle=gesture.startsWith('send') || ['source-label','context-summary','mode-change','next-disclosure'].includes(gesture);
  if(idle){store.event('stream',{type:'done'});await store.flush();}
  const messages=[],webview={postMessage:message=>{messages.push(structuredClone(message));return Promise.resolve(true);}};
  h.host.conversations=()=>store;h.host.assistantView={webview};h.host.historyDeliveries=new WeakMap([[webview,{channels:new Map()}]]);
  const state=(overrides={})=>{const presentation=store.presentation();h.host.postHistoryMessage(webview,{type:'state',project:{...h.fixture.project,name:'Activation fixture',files:[{path:file.path}]},activeFile:file,openFiles:[file],dirtyPaths:[],changes:[],trusted:true,features:{schemaVersion:1,projectId:h.fixture.project.id,revision:0,activeId:null,features:[],storage:{status:'saved'}},provider:{configured:true,model:'synthetic-local',provider:'Local fixture',transport:'local'},conversations:presentation.snapshot,runtimeWorkspace:h.host.runtimeWorkspaceSnapshot(true),assistantSurface:{resolved:true,visible:true,open:true},workspaceMode:'Understand',...overrides},presentation);return messages.at(-1);};
  const send=message=>page.evaluate(value=>new Promise(resolve=>{const done=event=>{if(event.source!==window||event.data?.type!==value.type)return;window.removeEventListener('message',done);resolve();};window.addEventListener('message',done);window.postMessage(value,location.origin);}),message);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await send(state());
  if(gesture==='next-disclosure'){
    await page.locator('.assistant-setup > summary').click();
    const privacy=page.locator('.assistant-context-rail .content-details');await privacy.locator('summary').focus();await privacy.locator('summary').press('Enter');
    await send(state());await expect(privacy).toHaveJSProperty('open',true);await expect(privacy.locator('summary')).toBeFocused();
    assert.equal((await page.evaluate(()=>window.outbound.filter(message=>message.type==='ask'))).length,0);return;
  }
  if(idle)await page.getByRole('textbox',{name:'Ask about your source'}).fill('A reviewed question.');
  let selector='#ask-submit',pressTarget=page.getByRole('button',{name:idle?'Ask':'Stop',exact:true});
  if(gesture==='source-label'){
    await page.locator('summary[aria-label="Request context and model"]').click();
    selector='input[data-context-path="src/App.tsx"]';pressTarget=page.locator('.context-choice strong');
  }else if(gesture==='context-summary'){selector='summary[aria-label="Request context and model"]';pressTarget=page.locator(selector);}
  else if(gesture==='mode-change'){selector='button[data-design-focus="intent-plan"]';pressTarget=page.locator(selector);}
  const control=page.locator(selector);await expect(control).toBeVisible();await control.focus();
  if(gesture.startsWith('send'))await expect(control).toBeEnabled();
  await page.evaluate(selector=>{window.controlSelector=selector;window.pressedButton=document.querySelector(selector);window.originalChecked=window.pressedButton.checked;window.nativeStopClicks=0;window.nativeContextChanges=0;document.addEventListener('click',event=>{if(event.isTrusted&&event.target.closest('#ask-submit'))window.nativeStopClicks++;},true);document.addEventListener('change',event=>{if(event.isTrusted&&event.target.matches('input[data-context-path]'))window.nativeContextChanges++;},true);},selector);
  const pointer=gesture.startsWith('pointer')||gesture==='source-label',key=gesture==='Enter'?'Enter':'Space';
  if(!pointer)await page.keyboard.down(key);else{const box=await pressTarget.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();}
  await send(state());store.event('stream',{type:'delta',text:' Second streamed text.'});h.host.postAI('stream',{type:'progress'},{conversationId:store.presentation().snapshot.activeId,store,durable:true});await send(messages.at(-1));
  if(gesture==='send-source-change'){const changed={...file,revision:'new-saved-revision',source:'export const app = false;'};await send(state({activeFile:changed,openFiles:[changed]}));}
  if(gesture==='send-feature-revision')await send(state({features:{schemaVersion:1,projectId:h.fixture.project.id,revision:1,activeId:null,features:[],storage:{status:'saved'}}}));
  if(gesture==='send-dirty')await send(state({dirtyPaths:[file.path]}));
  if(gesture==='send-provider-change')await send(state({provider:{configured:true,model:'new-model',provider:'Another provider',transport:'remote'}}));
  if(gesture==='send-trust-loss')await send(state({trusted:false,conversations:null,runtimeWorkspace:null}));
  if(gesture==='trust-loss')await send(state({trusted:false,conversations:null,runtimeWorkspace:null}));
  if(gesture==='project-change')await send(state({project:{...h.fixture.project,id:'other-project'},conversations:null,runtimeWorkspace:null}));
  if(gesture==='request-change'){store.event('stream',{type:'done'});await store.flush();await store.startTurn({requestId:'new-owner',prompt:'Another authorized request.',context:[file]});await send(state());}
  if(gesture==='feature-change')await send(state({features:{schemaVersion:1,projectId:h.fixture.project.id,revision:1,activeId:h.fixture.feature.id,features:[{...h.fixture.feature,brief:'',archived:false}],storage:{status:'saved'}}}));
  if(gesture==='focus-loss')await page.evaluate(()=>{const outside=document.createElement('input');outside.id='outside-focus';document.body.append(outside);outside.focus();});
  if(gesture==='pointer-cancel')await page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true})));
  // Cancellation event handlers are injected; the held key/pointer and clicks remain native.
  if(gesture==='blur-cancel-event')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  // A normal held key/pointer gesture, deliberately spanning background updates.
  await new Promise(resolve=>setTimeout(resolve,150));
  const retained=await page.evaluate(()=>({sameNode:window.pressedButton===document.querySelector(window.controlSelector),connected:window.pressedButton.isConnected}));
  if(!pointer)await page.keyboard.up(key);else {if(gesture==='pointer-outside')await page.mouse.move(1,1);await page.mouse.up();}
  const outcome=await page.evaluate(()=>({nativeClicks:window.nativeStopClicks,cancels:window.outbound.filter(message=>message.type==='cancel'),asks:window.outbound.filter(message=>message.type==='ask'),contextChanges:window.nativeContextChanges}));
  t.diagnostic(JSON.stringify({gesture,...retained,...outcome}));
  if(['Space','pointer','send','source-label','context-summary','mode-change'].includes(gesture)){assert.equal(retained.sameNode,true,'background publication must preserve the pressed native control');assert.equal(retained.connected,true);}
  const activating=['Space','pointer','Enter'].includes(gesture);
  assert.equal(outcome.cancels.length,activating?1:0,'only the original live request may receive an intentional Stop');
  if(activating){assert.equal(outcome.nativeClicks,1);assert.equal(outcome.cancels[0].requestId,'stream');}
  assert.equal(outcome.asks.length,gesture==='send'?1:0);assert.deepEqual(errors,[]);
  if(gesture==='send'){assert.equal(outcome.nativeClicks,1);assert.deepEqual(outcome.asks[0].context,[{path:file.path,revision:file.revision}]);}
  if(gesture==='source-label'){assert.equal(outcome.contextChanges,1);assert.equal(await control.isChecked(),!(await page.evaluate(()=>window.originalChecked)));}
  if(gesture==='context-summary')await expect(page.locator('details.assistant-setup')).toHaveJSProperty('open',true);
  if(gesture==='mode-change')await expect(page.getByRole('button',{name:'Plan mode',exact:true})).toHaveAttribute('aria-pressed','true');
  if(gesture==='pointer-outside' || gesture==='pointer-cancel' || gesture==='blur-cancel-event' || gesture==='focus-loss')await expect(page.getByText('First streamed text. Second streamed text.',{exact:true})).toBeVisible();
  if(gesture==='request-change'){assert.equal(store.snapshot().conversations[0].turns.at(-1).state,'running');store.event('new-owner',{type:'cancelled'});}
  if(gesture==='focus-loss')await expect(page.locator('#outside-focus')).toBeFocused();
  store.event('stream',{type:'cancelled'});
 });
});
