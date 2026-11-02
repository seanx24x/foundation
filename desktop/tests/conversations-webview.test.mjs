import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createServer}from'node:http';
import{fileURLToPath}from'node:url';
import{join}from'node:path';
import{createHash}from'node:crypto';
import{chromium,expect}from'@playwright/test';
import{createConversationStore}from'../extension/src/conversation-store.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source='export function SaveButton() { return <button>Save</button>; }';
const file={path:'src/SaveButton.tsx',source,revision:createHash('sha256').update(source).digest('hex'),language:'typescriptreact',analysis:{symbols:[],imports:[],consumers:[],requests:[]}};
const initial={type:'state',project:{id:'history-fixture',name:'History fixture',files:[{path:file.path}],root:'/fixture'},activeFile:file,openFiles:[file],dirtyPaths:[],trusted:true,provider:{configured:true,model:'scripted-fixture',provider:'Local fixture',transport:'local'},changes:[]};
test('durable conversation UI restores disk history, separates stale evidence, and never resends on navigation',async t=>{
 const temp=await mkdtemp('/private/tmp/foundation-conversation-ui-');const disk=join(temp,'history.json');let saved;
 const makeStore=()=>createConversationStore({projectId:initial.project.id,read:()=>saved,write:async value=>{await writeFile(disk,JSON.stringify(value));saved=structuredClone(value);},onChange:()=>{}});
 let store=makeStore();
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/theme.css'){
   const theme=JSON.parse(await readFile(join(root,`desktop/extension/themes/foundation-${url.searchParams.get('theme')==='light'?'light':'dark'}.json`),'utf8'));
   res.setHeader('Content-Type','text/css');res.end(`:root{${Object.entries(theme.colors).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v};`).join('')}}`);
  }else if(['/webview.js','/artifact-model.js','/workspace-model.js','/webview.css'].includes(url.pathname)||/^\/fonts\/[a-z-]+\.woff2$/.test(url.pathname)){
   res.setHeader('Content-Type',url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'font/woff2');res.end(await readFile(join(root,'desktop/extension/media',url.pathname.slice(1))));
  }else if(url.pathname==='/'){
   res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'nonce-test'; font-src 'self'; img-src 'self' data:; connect-src 'none'; frame-src 'self'"><link rel="stylesheet" href="/theme.css?theme=${url.searchParams.get('theme')==='light'?'light':'dark'}"><link rel="stylesheet" href="/webview.css"><title>Conversation persistence verification fixture</title></head><body><div id="foundation-root"></div><script nonce="test" src="/workspace-model.js"></script><script nonce="test" src="/artifact-model.js"></script><script nonce="test" src="/webview.js"></script></body></html>`);
  }else res.writeHead(404).end();
 }catch(error){res.writeHead(500).end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 t.after(async()=>{await store.dispose();await browser.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});});
 await page.addInitScript(()=>{window.outbound=[];window.acquireVsCodeApi=()=>({getState:()=>undefined,setState:()=>{},postMessage:message=>window.outbound.push(message)});});
 const send=message=>page.evaluate(data=>new Promise(resolve=>{const listener=e=>{if(e.source!==window||e.data?.type!==data.type)return;window.removeEventListener('message',listener);resolve();};window.addEventListener('message',listener);window.postMessage(data,location.origin);}),message);
 const state=overrides=>send({...initial,features:{schemaVersion:1,projectId:initial.project.id,revision:0,activeId:null,features:[],storage:{status:'saved'}},conversations:store.snapshot(),...overrides});
 const outbound=async type=>page.evaluate(kind=>window.outbound.filter(message=>message.type===kind),type);
 const mode=()=>page.getByRole('button',{name:'Assistant',exact:true}).click();
 const reload=async(theme='dark')=>{await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}`);await state();await mode();};
 await reload();
 await page.getByRole('button',{name:'New conversation',exact:true}).click();
 assert.deepEqual((await outbound('conversation')).at(-1),{type:'conversation',action:'new',projectId:initial.project.id});
 await store.newConversation();await state();
 const firstId=store.snapshot().activeId;
 await page.getByRole('textbox',{name:'Ask about your source'}).fill('Explain the Save button');
 await page.getByRole('button',{name:'Ask',exact:true}).click();
 const request=(await outbound('ask')).at(-1);assert.equal(request.conversationId,firstId);
 await store.startTurn({...request,context:[{id:'S1',...file,lines:1}],model:'scripted-fixture'});
 const emit=async(event)=>{store.event(request.requestId,event);await send({type:'ai',requestId:request.requestId,conversationId:firstId,event,conversations:store.snapshot()});};
 await emit({type:'start',model:'scripted-fixture'});
 await emit({type:'delta',text:'A saved-source explanation. [S1:1]'});
 await emit({type:'done',model:'scripted-fixture',usage:{total_tokens:24}});await store.flush();
 await expect(page.getByText('A saved-source explanation.',{exact:false})).toBeVisible();
 assert.equal(await page.getByText('A saved-source explanation.',{exact:false}).count(),1,'snapshot hydration must not duplicate streamed text');
 // A real disk read and store recreation model a host restart; renderer starts fresh too.
 await store.dispose();saved=JSON.parse(await readFile(disk,'utf8'));store=makeStore();await reload();
 await expect(page.getByText('A saved-source explanation.',{exact:false})).toBeVisible();assert.equal((await outbound('ask')).length,0);
 // New requests are explicit. Restoring an interrupted response only prepares its retry.
 await store.newConversation();const secondId=store.snapshot().activeId;
 await store.startTurn({requestId:'request-interrupted',conversationId:secondId,prompt:'Continue the analysis',intent:'ask',context:[{id:'S1',path:file.path,revision:file.revision,source,lines:1}],model:'scripted-fixture'});
 store.event('request-interrupted',{type:'start',model:'scripted-fixture'});store.event('request-interrupted',{type:'delta',text:'Partial answer retained.'});await store.flush();
 saved=JSON.parse(await readFile(disk,'utf8'));store=makeStore();await store.flush();await state();
 await expect(page.getByText(/Interrupted/).first()).toBeVisible();await expect(page.getByText('Partial answer retained.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Prepare another request',exact:true}).click();
 const preparation=(await outbound('requestRevisionAction')).at(-1);assert.equal(preparation.action,'prepare');assert.equal(preparation.requestId,'request-interrupted');assert.equal((await outbound('ask')).length,0);
 await send({...preparation,type:'requestRevisionPrepared',requestRevision:{version:1,conversationId:secondId,requestId:'request-interrupted'},prompt:'Continue the analysis',intent:'ask',files:[{path:file.path,revision:file.revision}]});
 const restored=(await outbound('assistantRestoreContext')).at(-1);await send({...restored,type:'assistantRestoreContextResult',unavailable:[]});
 await expect(page.getByRole('textbox',{name:'Ask about your source'})).toHaveValue('Continue the analysis');assert.equal((await outbound('ask')).length,0);
 // Historical source evidence changes its freshness without rewriting original snapshots.
 await state({openFiles:[{...file,revision:'b'.repeat(64)}],activeFile:{...file,revision:'b'.repeat(64)}});
 await expect(page.getByText('Stale',{exact:true}).first()).toBeVisible();
 await state({openFiles:[],activeFile:null});await expect(page.getByText('Freshness unknown',{exact:true})).toBeVisible();
 await state();
 const historyButton=page.getByRole('button',{name:'History',exact:true});
 await historyButton.focus();await historyButton.press('Enter');
 await expect(historyButton).toHaveAttribute('aria-expanded','true');
 await historyButton.press('Escape');await expect(historyButton).toHaveAttribute('aria-expanded','false');await expect(historyButton).toBeFocused();
 await historyButton.click();
 await page.getByRole('button',{name:/Explain the Save button · 1 request/}).click();
 assert.equal((await outbound('conversation')).at(-1).id,firstId);
 await store.select(firstId);await state();await expect(page.getByText('A saved-source explanation.',{exact:false})).toBeVisible();
 await expect(historyButton).toBeFocused();
 await page.getByRole('button',{name:'History',exact:true}).click();
 await page.getByRole('button',{name:'Archive conversation',exact:true}).click();
 assert.equal((await outbound('conversation')).at(-1).action,'archive');
 await store.archive(firstId);await state();
 await page.getByRole('button',{name:'History',exact:true}).click();
 await page.getByRole('button',{name:/Explain the Save button · 1 request · Archived/}).click();
 await store.select(firstId);await state();
 await expect(page.getByText('Archived · read-only',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Restore conversation',exact:true}).click();
 assert.equal((await outbound('conversation')).at(-1).action,'restore');
 await store.archive(firstId,false);await state();assert.equal((await outbound('ask')).length,0);
 // Completed source change + an actual host-supplied historical compilation record.
 const proposal={id:'proposal-history',projectId:initial.project.id,requestId:'request-proposal',path:file.path,before:source,after:source+'\n',baseRevision:file.revision,status:'proposed',origin:'ai',title:'Refine Save',summary:'Scripted verification fixture.',context:[{path:file.path,revision:file.revision}],verification:['Check keyboard focus.']};
 await store.startTurn({requestId:'request-proposal',conversationId:firstId,prompt:'Refine the Save button',intent:'build',context:[{id:'S1',path:file.path,revision:file.revision,source}],model:'scripted-fixture'});
 store.event('request-proposal',{type:'proposal',proposal});store.event('request-proposal',{type:'done'});
 await store.updateProposal({...proposal,status:'applied',appliedRevision:'c'.repeat(64)});
 await store.recordVerification(proposal.id,{revision:'c'.repeat(64),previewRevision:'preview-history',runtimeSession:'runtime-history',recordedAt:'2026-10-28T16:00:00Z',compilation:'passed',interaction:'not-run',visual:'not-run',observed:true});
 await store.flush();await state({proposal:null,design:null});
 await page.getByRole('button',{name:'Inspect previous proposal',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Artifact details'});await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:/^Apply/})).toHaveCount(0);
 await expect(dialog.getByText(/Saved verification history/)).toBeVisible();
 await dialog.locator('summary').filter({hasText:'Recorded identity'}).click();
 await expect(dialog.getByText(/runtime-history/)).toBeVisible();
 const identitySummary=dialog.locator('summary').filter({hasText:'Recorded identity'});await expect(identitySummary).toBeFocused();
 await state({proposal:null,design:null});await expect(dialog.getByText(/runtime-history/)).toBeVisible();await expect(identitySummary).toBeFocused();
 await expect(dialog.getByText(/Historical/).first()).toBeVisible();
 const dialogHistory=dialog.locator('.verification-history');const dialogHistorySummary=dialogHistory.locator(':scope > summary');
 await dialogHistorySummary.click();await expect(dialogHistory).toHaveJSProperty('open',false);
 await state({proposal:null,design:null});await expect(dialogHistory).toHaveJSProperty('open',false);await expect(dialogHistorySummary).toBeFocused();
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 const savedHistory=page.locator('.assistant-responses .verification-history').first();
 const savedHistorySummary=savedHistory.locator(':scope > summary');
 if(await savedHistory.evaluate(element=>element.open))await savedHistorySummary.click();
 await savedHistorySummary.focus();await savedHistorySummary.press('Enter');
 await expect(savedHistory).toHaveJSProperty('open',true);await expect(savedHistorySummary).toBeFocused();
 await state({proposal:null,design:null});await expect(savedHistory).toHaveJSProperty('open',true);await expect(savedHistorySummary).toBeFocused();

 // Render both themes at representative widths with the same restored evidence.
 const pictures=join(root,'desktop/tests/artifacts');await mkdir(pictures,{recursive:true});
 for(const theme of ['dark','light']){
  await reload(theme);
  for(const width of [1280,700,360]){
   await page.setViewportSize({width,height:900});
   const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth>innerWidth,main:document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1}));
   assert.deepEqual(overflow,{document:false,main:false},`${theme} ${width} history overflow`);
  }
  await page.setViewportSize({width:1280,height:900});await page.getByRole('button',{name:'History',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(pictures,`conversations-${theme}.png`)});
 }
 // Storage failures are visible; reading history never turns into a request.
 await state({conversations:{...store.snapshot(),revision:store.snapshot().revision+1,storage:{status:'error',message:'Conversation changes could not be saved locally.'}}});
 await expect(page.getByRole('button',{name:/Retry saving|Retry storage/})).toBeVisible();
 assert.equal((await outbound('ask')).length,0);assert.deepEqual(errors,[]);
});
