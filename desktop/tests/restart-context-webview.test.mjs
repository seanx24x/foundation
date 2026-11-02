import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';

const root=fileURLToPath(new URL('../../',import.meta.url));
const source=(path,letter)=>({path,source:`export const ${letter} = "saved ${letter}";`,revision:letter.repeat(64),language:'typescript',analysis:{symbols:[],imports:[],consumers:[],requests:[]}});
const a=source('src/SaveButton.tsx','a'),b=source('src/api/profile.ts','b');
const project={id:'restart-context-project',name:'Context restoration',root:'/fixture',files:[a,b].map(({path})=>({path}))};
const feature={id:'save-profile',title:'Save profile',brief:'Make errors recoverable.',paths:[a.path],entryPath:a.path,archived:false,createdAt:'2026-10-28T18:00:00Z',updatedAt:'2026-10-28T18:00:00Z'};
const features={schemaVersion:1,projectId:project.id,revision:1,activeId:feature.id,features:[feature],storage:{status:'saved'}};
const conversation={id:'conversation-1',title:'Save interaction',turns:[],archived:false,createdAt:'2026-10-28T18:00:00Z',updatedAt:'2026-10-28T18:00:00Z'};
const conversations={schemaVersion:1,projectId:project.id,revision:1,activeId:conversation.id,conversations:[conversation],storage:{status:'saved'}};
const identity={projectId:project.id,featureId:feature.id,conversationId:conversation.id};
const selection={version:1,...identity,initialized:true,paths:[b.path],includeTaskBrief:true};
const seed=(context=selection)=>({mode:'Assistant',sidebarContextOpen:true,question:'Explain the failure path.',intent:'change',questionProjectId:project.id,questionConversationId:conversation.id,assistantContext:context});
const state={type:'state',project,activeFile:a,openFiles:[a],assistantContextFiles:[],dirtyPaths:[],trusted:true,provider:{configured:true,providerKind:'openai',provider:'OpenAI',model:'fixture-model',transport:'remote'},features,featureFiles:[a],featureLoading:false,featureCandidates:[],featureUnavailable:[],conversations,changes:[],runtime:{status:'connected',session:'session-current',viewId:'view-current',observations:[{id:'request-current',session:'session-current',kind:'request',method:'GET',url:'/api/profile',status:200,durationMs:10,outcome:'success',observedAt:'2026-10-28T18:01:00Z',correlation:'unattributed'}]}};

test('Assistant restores only explicit metadata for the same project, feature, and conversation',async t=>{
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/theme.css'){
   const theme=JSON.parse(await readFile(join(root,'desktop/extension/themes/foundation-dark.json'),'utf8'));res.setHeader('Content-Type','text/css');res.end(`:root{${Object.entries(theme.colors).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v};`).join('')}}`);
  }else if(['/webview.js','/webview.css','/workspace-model.js','/artifact-model.js'].includes(url.pathname)||/^\/fonts\/[a-z-]+\.woff2$/.test(url.pathname)){
   res.setHeader('Content-Type',url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'font/woff2');res.end(await readFile(join(root,'desktop/extension/media',url.pathname.slice(1))));
  }else{
   const attrs=url.pathname==='/workspace'?'data-foundation-surface="workspace" data-foundation-assistant="external"':'data-foundation-surface="assistant"';res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/webview.css"></head><body ${attrs}><div id="foundation-root"></div><script src="/workspace-model.js"></script><script src="/artifact-model.js"></script><script src="/webview.js"></script></body></html>`);
  }
 }catch(error){res.writeHead(500).end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});const errors=[];
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const base=`http://127.0.0.1:${server.address().port}`;
 async function renderer(initial={},path='/assistant') {
  const page=await browser.newPage({viewport:{width:384,height:900}});page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(initial=>{if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('saved',JSON.stringify(initial));sessionStorage.setItem('seeded','1');}window.outbound=[];window.acquireVsCodeApi=()=>({getState:()=>JSON.parse(sessionStorage.getItem('saved')||'null'),setState:value=>sessionStorage.setItem('saved',JSON.stringify(value)),postMessage:message=>outbound.push(message)});},initial);
  await page.goto(base+path);
  const send=message=>page.evaluate(data=>new Promise(resolve=>{const listener=event=>{if(event.source!==window||event.data?.type!==data.type)return;removeEventListener('message',listener);resolve();};addEventListener('message',listener);postMessage(data,location.origin);}),message);
  const snapshot=overrides=>send({...state,...overrides});
  const outbound=type=>page.evaluate(type=>window.outbound.filter(message=>message.type===type),type);
  const saved=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('saved')));
  const result=(request,unavailable=[])=>send({...request,type:'assistantRestoreContextResult',unavailable});
  const choice=path=>page.locator(`input[data-context-path="${path}"]`);
  const prompt=page.getByRole('textbox',{name:'Ask about your source'});
  return {page,send,snapshot,outbound,saved,result,choice,prompt};
 }
 await t.test('cold hydration preserves selected files outside the feature until the host loads them',async()=>{
  const r=await renderer(seed());
  await r.snapshot({features:null,conversations:null,activeFile:null,openFiles:[],featureFiles:[],featureLoading:true});
  assert.deepEqual((await r.saved()).assistantContext,selection,'early renderer writes preserve pending selection');assert.equal((await r.saved()).question,'Explain the failure path.');
  await r.snapshot({features,conversations:null,activeFile:null,openFiles:[],featureFiles:[],featureLoading:true});assert.equal((await r.outbound('assistantRestoreContext')).length,0);
  await r.snapshot({activeFile:null,openFiles:[],featureFiles:[],featureLoading:true});
  const request=(await r.outbound('assistantRestoreContext')).at(-1);assert.deepEqual({...request,requestId:undefined},{type:'assistantRestoreContext',requestId:undefined,...identity,paths:[b.path]});
  await expect(r.choice(b.path)).toBeChecked();await expect(r.prompt).toHaveValue('Explain the failure path.');await expect(r.page.getByRole('checkbox',{name:'Include task brief'})).toBeChecked();await expect(r.page.locator('.composer-guidance')).toHaveText('Loading your selected saved source…');
  for(let i=0;i<3;i++)await r.snapshot({featureLoading:true,featureFiles:[]});
  assert.equal((await r.outbound('assistantRestoreContext')).length,1,'ordinary loading snapshots do not repeat loads');assert.deepEqual((await r.saved()).assistantContext,selection);
  await r.snapshot({assistantContextFiles:[b]});await expect(r.page.getByRole('button',{name:'Propose change',exact:true})).toBeDisabled();await r.result(request);
  await expect(r.choice(b.path)).toBeChecked();await expect(r.choice(a.path)).not.toBeChecked();await expect(r.page.getByRole('button',{name:'Propose change',exact:true})).toBeEnabled();await expect(r.page.getByRole('checkbox',{name:'Include GET /api/profile'})).not.toBeChecked();
  assert.equal((await r.outbound('ask')).length,0,'restoration never dispatches AI');
  await r.page.reload();await r.snapshot({assistantContextFiles:[],featureLoading:true});const again=(await r.outbound('assistantRestoreContext')).at(-1);assert.notEqual(again.requestId,request.requestId);await r.snapshot({assistantContextFiles:[b]});await r.result(again);
  await r.page.getByRole('button',{name:'Propose change',exact:true}).click();const ask=(await r.outbound('ask')).at(-1);assert.deepEqual(ask.context,[{path:b.path,revision:b.revision}]);assert.deepEqual(ask.taskContext,{featureId:feature.id,revision:1});assert.equal(Object.hasOwn(ask,'runtimeContext'),false);
  await r.page.close();
 });
 await t.test('checkboxes persist immediately, including explicit zero, without persisting source or runtime IDs',async()=>{
  const r=await renderer({sidebarContextOpen:true});await r.snapshot({assistantContextFiles:[b]});await r.choice(a.path).check();await r.choice(b.path).check();await r.page.getByRole('checkbox',{name:'Include task brief'}).check();await r.prompt.fill('Keep this unsent draft.');await r.page.getByRole('checkbox',{name:'Include GET /api/profile'}).check();
  assert.deepEqual((await r.saved()).assistantContext,{...selection,paths:[a.path,b.path]});const serialized=JSON.stringify(await r.saved());for(const secret of [a.source,b.source,'request-current','session-current','view-current','fixture-model'])assert.equal(serialized.includes(secret),false,secret);
  await r.choice(a.path).uncheck();await r.choice(b.path).uncheck();await r.page.getByRole('checkbox',{name:'Include task brief'}).uncheck();assert.deepEqual((await r.saved()).assistantContext,{...selection,paths:[],includeTaskBrief:false});
  await r.page.reload();await r.snapshot({assistantContextFiles:[b]});await expect(r.choice(a.path)).not.toBeChecked();await expect(r.choice(b.path)).not.toBeChecked();await expect(r.prompt).toHaveValue('Keep this unsent draft.');await expect(r.page.getByRole('checkbox',{name:'Include task brief'})).not.toBeChecked();assert.deepEqual((await r.outbound('assistantRestoreContext')).at(-1).paths,[],'explicit zero invalidates same-host in-flight loading');await r.snapshot();await expect(r.choice(a.path)).not.toBeChecked();await r.page.close();
 });
 await t.test('explicit zero also survives when no feature or conversation is active',async()=>{
  const empty={...selection,featureId:null,conversationId:null,paths:[],includeTaskBrief:false};const r=await renderer(seed(empty));const overrides={features:{...features,activeId:null},conversations:{...conversations,activeId:null,conversations:[]}};await r.snapshot(overrides);await expect(r.choice(a.path)).not.toBeChecked();await expect(r.prompt).toHaveValue('Explain the failure path.');assert.deepEqual((await r.outbound('assistantRestoreContext')).at(-1).paths,[]);assert.deepEqual((await r.saved()).assistantContext,empty);await r.snapshot(overrides);await expect(r.choice(a.path)).not.toBeChecked();await r.page.close();
 });
 await t.test('missing files remain selected and source epoch updates cannot reuse a cached copy',async()=>{
  const r=await renderer(seed({...selection,paths:[a.path,b.path]}));await r.snapshot({assistantContextFiles:[b]});const request=(await r.outbound('assistantRestoreContext')).at(-1);await r.result(request);
  await expect(r.page.getByRole('button',{name:'Propose change',exact:true})).toBeEnabled();
  await r.result(request,[{path:b.path,reason:'File no longer exists.'}]);await expect(r.choice(b.path)).toBeChecked();await expect(r.page.getByText('File no longer exists.',{exact:true})).toBeVisible();await expect(r.page.locator('.composer-guidance')).toHaveText('Some selected source is unavailable. Retry or remove it from Context.');await expect(r.page.locator('.assistant-setup-copy strong')).toHaveText('2 files selected');await expect(r.page.getByRole('button',{name:'Propose change',exact:true})).toBeDisabled();
  await r.page.getByRole('button',{name:'Retry saved context'}).click();const retry=(await r.outbound('assistantRestoreContext')).at(-1);assert.notEqual(retry.requestId,request.requestId);await r.result(retry,[{path:b.path,reason:'File no longer exists.'}]);
  await r.choice(b.path).uncheck();const last=(await r.outbound('assistantRestoreContext')).at(-1);assert.deepEqual(last.paths,[a.path]);await r.result(last);await expect(r.choice(b.path)).not.toBeChecked();await expect(r.page.getByRole('button',{name:'Propose change',exact:true})).toBeEnabled();
  await r.page.close();
 });
 await t.test('dirty loaded sources stay selected and keep the existing save guard',async()=>{
  const r=await renderer(seed({...selection,paths:[a.path],includeTaskBrief:false}));await r.snapshot({dirtyPaths:[a.path]});await r.result((await r.outbound('assistantRestoreContext')).at(-1));await expect(r.choice(a.path)).toBeChecked();await expect(r.page.locator('.composer-guidance')).toHaveText('Save the selected files before sending.');await expect(r.page.getByRole('button',{name:'Propose change',exact:true})).toBeDisabled();await r.page.close();
 });
 await t.test('latest user choices defeat stale loads and empty selection invalidates older work',async()=>{
  const r=await renderer(seed({...selection,paths:[a.path]}));await r.snapshot({assistantContextFiles:[b]});const first=(await r.outbound('assistantRestoreContext')).at(-1);await r.choice(b.path).check();const second=(await r.outbound('assistantRestoreContext')).at(-1);assert.notEqual(first.requestId,second.requestId);
  await r.result(first);await expect(r.page.locator('.composer-guidance')).toHaveText('Loading your selected saved source…');await r.result(second);await r.choice(a.path).uncheck();await r.choice(b.path).uncheck();const empty=(await r.outbound('assistantRestoreContext')).at(-1);assert.deepEqual(empty.paths,[]);await r.result(second,[{path:a.path,reason:'Old result'}]);await r.result(empty);await r.page.getByRole('checkbox',{name:'Include task brief'}).uncheck();await r.snapshot({assistantContextFiles:[b]});await expect(r.choice(a.path)).not.toBeChecked();await expect(r.choice(b.path)).not.toBeChecked();assert.deepEqual((await r.saved()).assistantContext,{...selection,paths:[],includeTaskBrief:false});await r.page.close();
 });
 await t.test('edits made while metadata loads take precedence over cold persisted choices',async()=>{
  const r=await renderer(seed());await r.snapshot({features:null,conversations:null,featureFiles:[],featureLoading:true});await r.prompt.fill('A newer question while loading.');await r.choice(a.path).check();await r.snapshot();await expect(r.prompt).toHaveValue('A newer question while loading.');await expect(r.choice(a.path)).toBeChecked();await expect(r.page.getByRole('checkbox',{name:'Include task brief'})).not.toBeChecked();assert.equal((await r.outbound('assistantRestoreContext')).length,0);assert.deepEqual((await r.saved()).assistantContext.paths,[a.path]);await r.page.close();
 });
 await t.test('mismatched and malformed cold records fail closed without dispatching a load',async()=>{
  const bad=[{...selection,projectId:'other-project'},{...selection,featureId:'other-feature'},{...selection,conversationId:'other-conversation'},{...selection,version:2},{...selection,paths:[b.path,b.path]},{...selection,paths:['../secret']},{...selection,paths:['/absolute']},{...selection,paths:['C:\\secret']},{...selection,paths:['src//x']},{...selection,paths:['x'.repeat(1025)]},{...selection,paths:Array.from({length:33},(_,i)=>`src/${i}.ts`)},{...selection,initialized:false},{...selection,includeTaskBrief:'true'},{...selection,source:b.source},null];
  for(const context of bad){const r=await renderer(seed(context));await r.snapshot({assistantContextFiles:[b]});await expect(r.prompt).toHaveValue('');await expect(r.choice(a.path)).not.toBeChecked();await expect(r.choice(b.path)).not.toBeChecked();await expect(r.page.getByRole('checkbox',{name:'Include task brief'})).not.toBeChecked();assert.equal((await r.outbound('assistantRestoreContext')).length,0);await r.page.close();}
 });
 await t.test('real feature, conversation and project transitions clear selections without replaying cold metadata',async()=>{
  for(const kind of ['feature','conversation','project']){
   const r=await renderer(seed());await r.snapshot({assistantContextFiles:[b]});const request=(await r.outbound('assistantRestoreContext')).at(-1);await r.result(request);await r.prompt.fill('A typed follow-up.');
   const changes=kind==='feature'?{features:{...features,revision:2,activeId:'other',features:[feature,{...feature,id:'other',title:'Other'}]}}:kind==='conversation'?{conversations:{...conversations,revision:2,activeId:'other',conversations:[conversation,{...conversation,id:'other',title:'Other'}]}}:{project:{...project,id:'other'},features:{...features,projectId:'other'},conversations:{...conversations,projectId:'other'}};
   await r.snapshot({...changes,assistantContextFiles:[b]});await expect(r.choice(b.path)).not.toBeChecked();await expect(r.page.getByRole('checkbox',{name:'Include task brief'})).not.toBeChecked();await r.result(request,[{path:a.path,reason:'Old identity'}]);assert.equal((await r.outbound('assistantRestoreContext')).length,1);
   if(kind==='feature')await expect(r.prompt).toHaveValue('A typed follow-up.');else await expect(r.prompt).toHaveValue('');
   await r.snapshot({assistantContextFiles:[b],features:{...features,revision:3},conversations:{...conversations,revision:3}});await expect(r.choice(b.path)).not.toBeChecked();assert.equal((await r.outbound('assistantRestoreContext')).length,1);await r.page.close();
  }
 });
 await t.test('a new conversation created by the pending request rebinds live choices, without replaying saved state',async()=>{
  const r=await renderer(seed({...selection,conversationId:null,paths:[a.path]}));const emptyHistory={...conversations,activeId:null,conversations:[]};await r.snapshot({conversations:emptyHistory});await r.result((await r.outbound('assistantRestoreContext')).at(-1));await r.page.getByRole('button',{name:'Propose change',exact:true}).click();const ask=(await r.outbound('ask')).at(-1);assert.equal(ask.conversationId,null);
  await r.snapshot({conversations:{...conversations,revision:2}});await expect(r.choice(a.path)).toBeChecked();await expect(r.page.getByRole('checkbox',{name:'Include task brief'})).toBeChecked();assert.equal((await r.saved()).assistantContext.conversationId,conversation.id);assert.equal((await r.outbound('assistantRestoreContext')).at(-1).conversationId,conversation.id);await r.page.close();
 });
 await t.test('trust and incomplete identity cannot turn a versioned draft into an unbound legacy draft',async()=>{
  const r=await renderer(seed());await r.snapshot();await r.result((await r.outbound('assistantRestoreContext')).at(-1),[{path:b.path,reason:'Unavailable'}]);await r.snapshot({trusted:false});assert.equal((await r.saved()).assistantContext,null);await r.page.reload();await r.snapshot({assistantContextFiles:[b]});await expect(r.prompt).toHaveValue('');await expect(r.choice(b.path)).not.toBeChecked();assert.equal((await r.outbound('assistantRestoreContext')).length,0);await r.page.close();
 });
 await t.test('workspace navigation reports mode independently of Assistant selection metadata',async()=>{
  const r=await renderer({mode:'Understand'},'/workspace');await r.page.setViewportSize({width:1100,height:900});await r.snapshot({runtime:null});await r.page.getByRole('button',{name:'Review',exact:true}).click();assert.deepEqual((await r.outbound('workspaceMode')).at(-1),{type:'workspaceMode',mode:'Review'});assert.equal(Object.hasOwn(await r.saved(),'assistantContext'),false);await r.page.close();
 });
 assert.deepEqual(errors,[],'no renderer exceptions');
});
