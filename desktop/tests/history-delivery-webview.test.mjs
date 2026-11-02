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

test('negotiated history renderer retains draft, streams updates and recovers a lost base across both themes',async t=>{
  const server=createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/theme.css'){
      const theme=JSON.parse(await readFile(join(root,`desktop/extension/themes/foundation-${url.searchParams.get('theme')==='light'?'light':'dark'}.json`),'utf8'));
      res.setHeader('Content-Type','text/css');res.end(`:root{${Object.entries(theme.colors).map(([key,value])=>`--vscode-${key.replaceAll('.','-')}:${value};`).join('')}}`);
    }else if(['/webview.js','/artifact-model.js','/workspace-model.js','/history-model.js','/webview.css'].includes(url.pathname)||/^\/fonts\/[a-z-]+\.woff2$/.test(url.pathname)){
      res.setHeader('Content-Type',url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'font/woff2');res.end(await readFile(join(root,'desktop/extension/media',url.pathname.slice(1))));
    }else if(url.pathname==='/'){
      res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/theme.css?theme=${url.searchParams.get('theme')}"><link rel="stylesheet" href="/webview.css"></head><body data-foundation-surface="assistant"><div id="foundation-root"></div><script src="/workspace-model.js"></script><script src="/artifact-model.js"></script><script src="/history-model.js"></script><script src="/webview.js"></script></body></html>`);
    }else res.writeHead(404).end();
  }catch(error){res.writeHead(500).end(error.message);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  for(const theme of ['dark','light']){
    const page=await browser.newPage({viewport:{width:384,height:800}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{window.outbound=[];window.acquireVsCodeApi=()=>({getState:()=>JSON.parse(sessionStorage.getItem('view')||'null'),setState:value=>sessionStorage.setItem('view',JSON.stringify(value)),postMessage:message=>window.outbound.push(message)});});
    const h=historyHost({fixture:populatedHistory({sourceCount:1,sourceBytes:256,runCount:1,observationsPerRun:1})});
    const store=createConversationStore({projectId:h.fixture.project.id,read:()=>null,write:async()=>{}});
    const file={path:'src/App.tsx',revision:'saved-revision',source:'export const app = true;',language:'typescript',analysis:{symbols:[],imports:[],consumers:[],requests:[]}};
    await store.startTurn({requestId:'first',prompt:'Explain this source.',context:[file]});store.event('first',{type:'delta',text:'Persisted response one.'});store.event('first',{type:'done'});await store.flush();
    const messages=[],webview={postMessage:message=>{messages.push(structuredClone(message));return Promise.resolve(true);}};
    h.host.conversations=()=>store;h.host.assistantView={webview};h.host.historyDeliveries=new WeakMap([[webview,{channels:new Map()}]]);
    const state=()=>{const presentation=store.presentation();h.host.postHistoryMessage(webview,{type:'state',project:{...h.fixture.project,name:'History fixture',files:[{path:file.path}]},activeFile:file,openFiles:[file],dirtyPaths:[],changes:[],trusted:true,features:{schemaVersion:1,projectId:h.fixture.project.id,revision:0,activeId:null,features:[],storage:{status:'saved'}},provider:{configured:true,model:'synthetic-local',provider:'Local fixture',transport:'local'},conversations:presentation.snapshot,runtimeWorkspace:h.host.runtimeWorkspaceSnapshot(true),assistantSurface:{resolved:true,visible:true,open:true},workspaceMode:'Understand'},presentation);return messages.at(-1);};
    const send=message=>page.evaluate(value=>new Promise(resolve=>{const done=event=>{if(event.source!==window||event.data?.type!==value.type)return;window.removeEventListener('message',done);resolve();};window.addEventListener('message',done);window.postMessage(value,location.origin);}),message);
    const outbound=type=>page.evaluate(value=>window.outbound.filter(message=>message.type===value),type);
    await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}`);
    await expect.poll(async()=>(await outbound('ready')).at(-1)?.historyProtocol).toBe(1);
    await page.evaluate(()=>{window.receivedEnvelopeKeys=[];window.addEventListener('message',event=>{if(event.data?.history)window.receivedEnvelopeKeys.push(Object.keys(event.data));});});
    await send(state());await expect(page.getByText('Persisted response one.',{exact:true})).toBeVisible();
    assert.equal((await page.evaluate(()=>window.receivedEnvelopeKeys.at(-1))).includes('conversations'),false,'decoding does not mutate the original host event envelope');
    assert.equal((await page.evaluate(()=>window.receivedEnvelopeKeys.at(-1))).includes('runtimeWorkspace'),false);
    const composer=page.getByRole('textbox',{name:'Ask about your source'});await composer.fill('Keep this typed draft.');await composer.press('Home');
    await send(state());await expect(composer).toBeFocused();await expect(composer).toHaveValue('Keep this typed draft.');assert.equal(await composer.evaluate(element=>element.selectionStart),0);
    await store.startTurn({requestId:'stream',prompt:'Next question.',context:[file]});await send(state());store.event('stream',{type:'delta',text:'Streamed answer.'});
    h.host.postAI('stream',{type:'delta',text:'Streamed answer.'},{conversationId:store.presentation().snapshot.activeId,store,durable:true});await send(messages.at(-1));
    await expect(page.getByText('Streamed answer.',{exact:true})).toBeVisible();await expect(composer).toHaveValue('Keep this typed draft.');
    store.event('stream',{type:'done'});h.host.postAI('stream',{type:'done'},{conversationId:store.presentation().snapshot.activeId,store,durable:true});await send(messages.at(-1));await store.flush();
    state();await send(state());await expect.poll(async()=>(await outbound('historyResync')).length).toBe(1);
    await send(state());assert.equal((await outbound('historyResync')).length,1);
    for(const channel of h.host.historyDeliveries.get(webview).channels.values())channel.reset=true;
    await send(state());await expect(page.getByText('Persisted response one.',{exact:true})).toBeVisible();await expect(page.getByText('Streamed answer.',{exact:true})).toBeVisible();await expect(composer).toHaveValue('Keep this typed draft.');
    await page.reload();for(const channel of h.host.historyDeliveries.get(webview).channels.values())channel.reset=true;await send(state());await expect(composer).toHaveValue('Keep this typed draft.');
    assert.equal((await outbound('ask')).length,0);assert.deepEqual(errors,[],theme);await store.dispose();await page.close();
  }
});
