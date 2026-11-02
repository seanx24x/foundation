import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';

const root=fileURLToPath(new URL('../../',import.meta.url));
const file={path:'src/SaveButton.tsx',source:'export function SaveButton(){return <button>Save</button>}',revision:'a'.repeat(64),language:'typescriptreact',analysis:{symbols:[],imports:[],consumers:[],requests:[]}};
const project={id:'connected-ui-fixture',name:'Connected preview fixture',root:'/fixture',files:[{path:file.path}]};
const request={id:'request-1',session:'runtime-1',kind:'request',method:'POST',url:'/api/profile',status:503,durationMs:245,outcome:'http-error',observedAt:'2026-10-28T18:00:00Z',correlation:'unattributed'};
const selected={id:'source-1',mapping:'resolved',path:file.path,line:1,revision:file.revision,tag:'button',label:'Save changes',rect:{x:40,y:40,width:128,height:40},styles:{color:'rgb(255, 255, 255)',backgroundColor:'rgb(52, 103, 78)',fontSize:'13px',padding:'8px 16px'},stale:false};
const idle={status:'idle',owned:false,capabilities:{sourceMapping:'instrumented',requests:true,screenshots:false},targets:[{id:'vite',label:'Connected fixture',root:'/fixture',commandLabel:'vite',instrumented:true}],observations:[],selection:null};
const history={schemaVersion:1,projectId:project.id,revision:1,activeId:'conversation',storage:{status:'saved'},conversations:[{id:'conversation',title:'Refine the Save button',createdAt:'2026-10-28T18:00:00Z',updatedAt:'2026-10-28T18:00:00Z',archived:false,turns:[]}]};

test('connected renderer retains the runtime frame and makes live observations explicit across themes and sidebar widths',async t=>{
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/theme.css'){
   const theme=JSON.parse(await readFile(join(root,`desktop/extension/themes/foundation-${url.searchParams.get('theme')==='light'?'light':'dark'}.json`),'utf8'));
   res.setHeader('Content-Type','text/css');res.end(`:root{${Object.entries(theme.colors).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v};`).join('')}}`);
  }else if(['/webview.js','/webview.css','/workspace-model.js','/artifact-model.js'].includes(url.pathname)||/^\/fonts\/[a-z-]+\.woff2$/.test(url.pathname)){
   res.setHeader('Content-Type',url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'font/woff2');res.end(await readFile(join(root,'desktop/extension/media',url.pathname.slice(1))));
  }else if(url.pathname==='/project'){
   res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><h1>Connected project fixture</h1><button>Save changes</button><script>window.runtimeControls=[];addEventListener("message",event=>{if(event.data?.type==="foundation-runtime-control")runtimeControls.push(event.data)});window.frameIdentity=Math.random();</script></body></html>');
  }else if(['/','/assistant'].includes(url.pathname)){
   const attrs=url.pathname==='/assistant'?'data-foundation-surface="assistant"':'data-foundation-surface="workspace" data-foundation-assistant="external"';
   res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/theme.css?theme=${url.searchParams.get('theme')==='light'?'light':'dark'}"><link rel="stylesheet" href="/webview.css"></head><body ${attrs}><div id="foundation-root"></div><script src="/workspace-model.js"></script><script src="/artifact-model.js"></script><script src="/webview.js"></script></body></html>`);
  }else res.writeHead(404).end();
 }catch(error){res.writeHead(500).end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 await page.addInitScript(()=>{window.outbound=[];window.acquireVsCodeApi=()=>({getState:()=>JSON.parse(sessionStorage.getItem('view')||'null'),setState:value=>sessionStorage.setItem('view',JSON.stringify(value)),postMessage:message=>outbound.push(message)});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const send=message=>page.evaluate(data=>new Promise(resolve=>{const listener=event=>{if(event.source!==window||event.data?.type!==data.type)return;removeEventListener('message',listener);resolve();};addEventListener('message',listener);postMessage(data,location.origin);}),message);
 let runtime=structuredClone(idle);
 const state=overrides=>send({type:'state',project,activeFile:file,openFiles:[file],dirtyPaths:[],trusted:true,provider:{configured:true,providerKind:'openai',provider:'OpenAI',model:'fixture-model',transport:'remote'},conversations:history,changes:[],assistantSurface:{resolved:true,visible:true,open:true},runtime,...overrides});
 const outbound=type=>page.evaluate(type=>window.outbound.filter(message=>message.type===type),type);
 const capture=async name=>{const folder=join(root,'desktop/tests/artifacts');await mkdir(folder,{recursive:true});await page.screenshot({path:join(folder,name+'.png'),fullPage:true});};
 for(const theme of ['dark','light']){
  await page.goto(`${base}/?theme=${theme}`);await state({activeFile:null,openFiles:[]});await send({type:'mode',mode:'Refine'});await expect(page.getByRole('combobox',{name:'Preview source',exact:true})).toBeVisible();await state();
  await page.getByRole('combobox',{name:'Preview source',exact:true}).selectOption('runtime');
  await expect(page.getByRole('heading',{name:'Connect your running app'})).toBeVisible();
  await state({runtime:{...idle,targets:[{...idle.targets[0],id:'unconfigured',label:'Needs instrumentation',instrumented:false},...idle.targets]}});
  await page.getByRole('combobox',{name:'Running project target'}).selectOption('unconfigured');await expect(page.getByRole('button',{name:'Start project',exact:true})).toBeDisabled();await expect(page.getByText('Add the Foundation development plugin before starting this target.')).toBeVisible();
  await page.getByRole('combobox',{name:'Running project target'}).selectOption('vite');await expect(page.getByRole('button',{name:'Start project',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Start project',exact:true}).click();assert.deepEqual((await outbound('runtime')).at(-1),{type:'runtime',action:'start',targetId:'vite'});
  await page.getByRole('combobox',{name:'Preview source',exact:true}).selectOption('sandbox');
  await state({runtime:{...idle,status:'starting'}});await expect(page.getByRole('combobox',{name:'Preview source',exact:true})).toHaveValue('runtime');assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('view')).previewMode),'runtime','palette-equivalent startup persists running preview mode');await expect(page.getByRole('button',{name:'Starting…',exact:true})).toBeDisabled();await expect(page.getByRole('heading',{name:'Starting project…',exact:true})).toBeVisible();await capture(`connected-starting-${theme}`);
  runtime={...idle,status:'connected',session:'runtime-1',viewId:'view-1',targetUrl:base+'/project',url:base+'/project',owned:true,target:idle.targets[0],selection:selected,observations:[request]};await state();
  await expect(page.getByRole('combobox',{name:'Preview source',exact:true})).toHaveValue('runtime');await page.getByRole('combobox',{name:'Preview source',exact:true}).selectOption('sandbox');await state();await expect(page.getByRole('combobox',{name:'Preview source',exact:true})).toHaveValue('sandbox');await page.getByRole('combobox',{name:'Preview source',exact:true}).selectOption('runtime');
  await expect(page.getByTitle('Running project preview')).toBeVisible();const frame=page.frameLocator('iframe[title="Running project preview"]');await expect(frame.getByRole('button',{name:'Save changes'})).toBeVisible();
  const identity=await page.locator('iframe[title="Running project preview"]').evaluate(el=>el.contentWindow.frameIdentity);
  await state({focus:{path:file.path,line:1,label:'Save changes',origin:'runtime',revision:file.revision,session:runtime.session}});await expect(page.getByText('From running app',{exact:true})).toBeVisible();await expect(page.getByText('Mapped source',{exact:true})).toBeVisible();await expect(page.getByText('Project connected',{exact:true})).toBeVisible();await expect(page.getByText('Bodies and sensitive headers are excluded.',{exact:false})).toBeVisible();
  const requestSummary=page.locator('.runtime-request > summary').first();await requestSummary.click();await expect(page.getByText('No confirmed link to the selected element')).toBeVisible();await state();await expect(requestSummary).toBeFocused();await expect(page.locator('.runtime-request').first()).toHaveJSProperty('open',true);
  await page.getByRole('button',{name:'Understand',exact:true}).click();await state();await page.getByRole('button',{name:'Refine',exact:true}).click();assert.equal(await page.locator('iframe[title="Running project preview"]').evaluate(el=>el.contentWindow.frameIdentity),identity,'activity change preserves running project frame');
  runtime={...runtime,viewId:'view-2'};await state();await expect.poll(()=>page.locator('iframe[title="Running project preview"]').evaluate(el=>el.contentWindow.frameIdentity)).not.toBe(identity);const newIdentity=await page.locator('iframe[title="Running project preview"]').evaluate(el=>el.contentWindow.frameIdentity);await state();assert.equal(await page.locator('iframe[title="Running project preview"]').evaluate(el=>el.contentWindow.frameIdentity),newIdentity,'same server view preserves running frame');
  await page.getByRole('combobox',{name:'Preview source',exact:true}).selectOption('sandbox');runtime={...runtime,viewId:'view-3'};await state();await expect(page.getByRole('combobox',{name:'Preview source',exact:true})).toHaveValue('runtime');
  await page.getByRole('button',{name:'Inspect',exact:true}).click();await expect.poll(()=>page.locator('iframe[title="Running project preview"]').evaluate(el=>el.contentWindow.runtimeControls.at(-1)?.inspect)).toBe(false);
  await page.getByRole('combobox',{name:'Preview color theme'}).selectOption('dark');await expect.poll(()=>page.locator('iframe[title="Running project preview"]').evaluate(el=>el.contentWindow.runtimeControls.at(-1)?.theme)).toBe('dark');
  await page.getByRole('combobox',{name:'Preview viewport width'}).selectOption('390');await expect(page.getByTitle('Running project preview')).toHaveAttribute('width','390');
  await capture(`connected-project-${theme}`);
  const messagesBefore=(await outbound('action')).length;await frame.locator('body').evaluate(()=>parent.postMessage({type:'action',id:'foundation.configureAI'},'*'));await frame.locator('body').evaluate(()=>parent.postMessage({type:'state',project:null},'*'));assert.equal((await outbound('action')).length,messagesBefore);await expect(page.getByText('Project connected',{exact:true})).toBeVisible();
  await page.locator('.runtime-connect > summary').click();const urlInput=page.getByRole('textbox',{name:'Running project URL'});await urlInput.fill(base+'/project');await urlInput.press('Home');await state();await expect(urlInput).toBeFocused();await expect(urlInput).toHaveValue(base+'/project');await page.getByRole('button',{name:'Connect',exact:true}).click();assert.deepEqual((await outbound('runtime')).at(-1),{type:'runtime',action:'connect',url:base+'/project'});
  await state({runtime:{...runtime,owned:false}});await page.getByRole('button',{name:'Disconnect',exact:true}).click();assert.equal((await outbound('runtime')).at(-1).action,'stop');
  await state({runtime:{...runtime,status:'disconnected',owned:false}});await expect(page.getByText('Project disconnected. Reconnect to refresh its measurements and requests.')).toBeVisible();await expect(page.getByTitle('Running project preview')).toHaveJSProperty('inert',true);await capture(`connected-disconnected-${theme}`);
  await state({runtime:{...runtime,selection:{...selected,mapping:'ambiguous',path:undefined}}});await expect(page.getByText(/More than one source location matches/)).toBeVisible();await expect(page.getByRole('button',{name:'Ask AI to refine this'})).toHaveCount(0);
  await state({runtime:{...runtime,selection:{...selected,stale:true}}});await expect(page.getByText('Source mapping is stale. Select the element again.')).toBeVisible();await expect(page.getByRole('button',{name:'Ask AI to refine this'})).toHaveCount(0);
  await page.setViewportSize({width:700,height:800});await state();await page.getByRole('button',{name:'Inspector',exact:true}).click();await expect(page.getByRole('button',{name:'Back to canvas'})).toBeVisible();await page.getByRole('button',{name:'Back to canvas'}).press('Escape');await expect(page.getByRole('button',{name:'Inspector',exact:true})).toBeFocused();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'compact runtime fits');await page.setViewportSize({width:1100,height:1000});
  await page.goto(`${base}/assistant?theme=${theme}`);runtime={...runtime,status:'connected',owned:false};await state();if(!await page.locator('.assistant-setup').evaluate(el=>el.open))await page.locator('.assistant-setup > summary').click();
  const checkbox=page.getByRole('checkbox',{name:'Include POST /api/profile'});await expect(checkbox).not.toBeChecked();await checkbox.check();await expect(checkbox).toBeFocused();await state();await expect(checkbox).toBeChecked();await expect(checkbox).toBeFocused();
  await state({runtime:{...runtime,status:'disconnected'}});await expect(checkbox).toBeEnabled();await checkbox.uncheck();await expect(checkbox).toBeDisabled();
  await state();await checkbox.check();await state({runtime:{...runtime,observations:[]}});await expect(page.getByText('Some selected observations are no longer available. Clear runtime context or reconnect before sending.')).toBeVisible();await page.getByRole('textbox',{name:'Ask about your source'}).fill('Explain this failed request.');await expect(page.getByRole('button',{name:'Ask',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Clear runtime context',exact:true}).click();await expect(page.getByRole('button',{name:'Ask',exact:true})).toBeEnabled();await state();await expect(checkbox).not.toBeChecked();await checkbox.check();
  await page.getByRole('textbox',{name:'Ask about your source'}).fill('Explain this failed request and the selected source.');await page.getByRole('button',{name:'Ask',exact:true}).click();const ask=(await outbound('ask')).at(-1);assert.deepEqual(ask.runtimeContext,{session:'runtime-1',observationIds:['request-1']});assert.deepEqual(ask.context,[{path:file.path,revision:file.revision}]);
  const turn={id:ask.requestId,requestId:ask.requestId,question:ask.prompt,intent:'ask',context:[{id:'S1',...file,lines:1}],answer:'The request returned HTTP 503 [R1]. Its relationship to this element is unconfirmed.',state:'complete',model:'fixture-model',started:true,createdAt:'2026-10-28T18:01:00Z',runtimeEvidence:[{...request,id:'R1',observationId:'request-1',provenance:'observed'}]};
  await send({type:'ai',requestId:ask.requestId,conversationId:history.activeId,event:{type:'done'},conversations:{...history,revision:2,conversations:[{...history.conversations[0],turns:[turn]}]}});
  await expect(page.getByText('Saved observations · 1',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Request 1',exact:true}).click();await expect(page.getByText(/Saved observations from this request/)).toBeVisible();await expect(page.locator('.saved-runtime-evidence .runtime-request > summary')).toBeFocused();
  for(const width of [170,300,384,480]){await page.setViewportSize({width,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${theme} evidence sidebar ${width}px`);}
  await page.setViewportSize({width:384,height:800});await capture(`connected-assistant-${theme}`);
  runtime={...runtime,viewId:'view-4'};await state();await expect(page.getByRole('checkbox',{name:'Include POST /api/profile'})).not.toBeChecked();await page.getByRole('checkbox',{name:'Include POST /api/profile'}).check();
  await state({runtime:{...runtime,session:'runtime-2',observations:[{...request,id:'request-2',session:'runtime-2'}]}});await expect(page.getByRole('checkbox',{name:'Include POST /api/profile'})).not.toBeChecked();
  await page.setViewportSize({width:1100,height:1000});runtime=structuredClone(idle);
 }
 assert.deepEqual(errors,[],'no renderer errors');
});
