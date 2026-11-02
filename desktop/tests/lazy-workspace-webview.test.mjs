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

test('closed workspace history stays unmaterialized and native disclosures preserve exact evidence',async t=>{
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/theme.css'){
   const theme=JSON.parse(await readFile(join(root,`desktop/extension/themes/foundation-${url.searchParams.get('theme')==='light'?'light':'dark'}.json`),'utf8'));
   res.setHeader('Content-Type','text/css');res.end(`:root{${Object.entries(theme.colors).map(([key,value])=>`--vscode-${key.replaceAll('.','-')}:${value};`).join('')}}`);
  }else if(['/webview.js','/artifact-model.js','/workspace-model.js','/history-model.js','/webview.css'].includes(url.pathname)||/^\/fonts\/[a-z-]+\.woff2$/.test(url.pathname)){
   res.setHeader('Content-Type',url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'font/woff2');res.end(await readFile(join(root,'desktop/extension/media',url.pathname.slice(1))));
  }else if(url.pathname==='/'){
   res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/theme.css?theme=${url.searchParams.get('theme')}"><link rel="stylesheet" href="/webview.css"></head><body data-foundation-surface="workspace" data-foundation-assistant="external"><div id="foundation-root"></div><script src="/workspace-model.js"></script><script src="/artifact-model.js"></script><script src="/history-model.js"></script><script src="/webview.js"></script></body></html>`);
  }else res.writeHead(404).end();
 }catch(error){res.writeHead(500).end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 for(const theme of ['dark','light'])await t.test(theme,async t=>{
  const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>page.close());
  await page.addInitScript(()=>{
   window.outbound=[];window.createdElements=0;window.formattedDates=0;const create=document.createElement.bind(document),format=Date.prototype.toLocaleString;
   document.createElement=(...args)=>{window.createdElements++;return create(...args);};Date.prototype.toLocaleString=function(...args){window.formattedDates++;return format.apply(this,args);};
   window.acquireVsCodeApi=()=>({getState:()=>null,setState(){},postMessage:message=>window.outbound.push(message)});
  });
  const fixture=populatedHistory({sourceCount:32,sourceBytes:256}),h=historyHost({fixture}),store=createConversationStore({projectId:fixture.project.id,read:()=>null,write:async()=>{}});t.after(async()=>{await fixture.store.dispose();await store.dispose();});
  const feature={...fixture.feature,brief:'Synthetic feature brief.',entryPath:fixture.files[0].path,archived:false};
  const features={schemaVersion:1,projectId:fixture.project.id,revision:3,activeId:feature.id,features:[feature],storage:{status:'saved'}};
  const project={...fixture.project,name:'Lazy workspace fixture',files:Array.from({length:1400},(_,i)=>({path:fixture.files[i]?.path || `src/extra-${i}.ts`}))};
  const file={...fixture.files[0],language:'typescript',analysis:{symbols:[],imports:[],consumers:[],requests:[]}};
  const messages=[],webview={postMessage:message=>{messages.push(structuredClone(message));return Promise.resolve(true);}};h.host.historyDeliveries=new WeakMap([[webview,{channels:new Map()}]]);
  const state=(overrides={})=>{const presentation=store.presentation();h.host.postHistoryMessage(webview,{type:'state',project,activeFile:file,openFiles:[file],dirtyPaths:[],changes:[],trusted:true,features,featureFiles:fixture.files,featureCandidates:[],featureUnavailable:[],provider:{configured:false},conversations:presentation.snapshot,runtimeWorkspace:h.host.runtimeWorkspaceSnapshot(true),runtime:{status:'idle',targets:[],observations:[]},...overrides},presentation);return messages.at(-1);};
  const send=message=>page.evaluate(value=>new Promise(resolve=>{const done=event=>{if(event.source!==window||event.data?.type!==value.type)return;window.removeEventListener('message',done);resolve();};window.addEventListener('message',done);window.postMessage(value,location.origin);}),message);
  const counts=()=>page.evaluate(()=>({elements:window.createdElements,dateFormats:window.formattedDates,connected:document.querySelectorAll('*').length,requests:document.querySelectorAll('.saved-scenario-run .runtime-request').length,options:document.querySelectorAll('[aria-label="File to add to feature"] option').length}));
  await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}`);await send(state());
  const initial=await counts();t.diagnostic(`closed fixture counts ${JSON.stringify(initial)}`);
  assert.equal(initial.requests,0,'closed history must not build any of its 4,000 request disclosures');assert.equal(initial.options,0,'closed Edit feature must not build the 1,400-file picker');assert.equal(initial.dateFormats,0);
  for(let i=0;i<12;i++)await send(state());const closed=await counts();assert.equal(closed.requests,0);assert.equal(closed.options,0);assert.equal(closed.dateFormats,0);assert.ok(closed.connected<1000);t.diagnostic(`after twelve closed publications ${JSON.stringify(closed)}`);
  // Page navigation uses the browser's trusted key activation, including when
  // a host publication arrives between keydown and keyup.
  const refine=page.getByRole('button',{name:'Refine',exact:true});await refine.focus();await page.evaluate(()=>{window.heldMode=document.activeElement;window.nativeModeClicks=0;heldMode.addEventListener('click',event=>{if(event.isTrusted)window.nativeModeClicks++;});});
  await page.keyboard.down('Space');await send(state());await page.waitForTimeout(150);const modeConnected=await page.evaluate(()=>heldMode.isConnected);await page.keyboard.up('Space');
  const modeActivation=await page.evaluate(()=>({connected:heldMode.isConnected,nativeClicks:nativeModeClicks,mode:document.getElementById('foundation-content').dataset.mode,navigation:outbound.filter(message=>message.type==='workspaceMode'&&message.mode==='Refine').length}));t.diagnostic(`held workspace mode ${JSON.stringify({beforeReleaseConnected:modeConnected,...modeActivation})}`);
  assert.equal(modeConnected,true,'background state preserves the native workspace activity target');assert.equal(modeActivation.nativeClicks,1);await expect(refine).toHaveAttribute('aria-pressed','true');assert.equal(modeActivation.navigation,1);await page.getByRole('button',{name:'Understand',exact:true}).click();await expect(page.getByRole('button',{name:'Understand',exact:true})).toHaveAttribute('aria-pressed','true');
  for(const ownerChange of ['feature','project','trust','mode']) {
   await send(state());await refine.focus();const beforeNavigation=await page.evaluate(()=>outbound.filter(message=>message.type==='workspaceMode'&&message.mode==='Refine').length);await page.evaluate(()=>{window.heldMode=document.activeElement;window.nativeModeClicks=0;heldMode.addEventListener('click',event=>{if(event.isTrusted)window.nativeModeClicks++;});});await page.keyboard.down('Space');
   if(ownerChange==='mode')await send({type:'mode',mode:'Review'});
   else await send(state(ownerChange==='trust'?{trusted:false}:ownerChange==='project'?{project:{...project,id:'navigation-project'},features:{...features,projectId:'navigation-project'},runtimeWorkspace:null,conversations:null}:{features:{...features,revision:5,activeId:'navigation-feature',features:[{...feature,id:'navigation-feature'}]}}));
   await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>heldMode.isConnected),false,`${ownerChange} invalidates held navigation`);await page.keyboard.up('Space');assert.equal(await page.evaluate(()=>nativeModeClicks),0);assert.equal(await page.evaluate(()=>outbound.filter(message=>message.type==='workspaceMode'&&message.mode==='Refine').length),beforeNavigation);
   await send(state());await page.getByRole('button',{name:'Understand',exact:true}).click();
  }
  // Hold a trusted Space across host state updates: the native summary itself
  // must survive, then activate once on release, without a synthesized click.
  const runtime=page.locator('.feature-runtime-details');await runtime.locator(':scope > summary').focus();await page.evaluate(()=>{window.heldSummary=document.activeElement;window.nativeSummaryClicks=0;heldSummary.addEventListener('click',event=>{if(event.isTrusted)window.nativeSummaryClicks++;});});
  await page.keyboard.down('Space');await send(state());await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>heldSummary.isConnected),true);await page.keyboard.up('Space');await expect(runtime).toHaveJSProperty('open',true);assert.equal(await page.evaluate(()=>nativeSummaryClicks),1);await expect(runtime.locator(':scope > summary')).toBeFocused();
  const history=runtime.locator('details').filter({has:page.locator(':scope > summary', {hasText:'Observation history · 40'})});
  await history.locator(':scope > summary').press('Enter');await expect(page.locator('.saved-scenario-run')).toHaveCount(40);await expect(page.locator('.scenario-run-record')).toHaveCount(0);assert.equal((await counts()).dateFormats,0);
  const run=page.locator('.saved-scenario-run').first(),savedRun=fixture.data.runs.at(-1);await run.locator(':scope > summary').focus();await page.keyboard.down('Space');
  const heldSnapshot=h.host.runtimeWorkspaceSnapshot(true);await send(state({runtimeWorkspace:{...heldSnapshot,runFreshness:heldSnapshot.runFreshness.map(item=>item.id===savedRun.id?{...item,status:'stale',reason:'Saved source changed while opening this observation.'}:item)}}));await page.waitForTimeout(150);await page.keyboard.up('Space');
  await expect(page.locator('.scenario-run-record')).toHaveCount(1);await expect(run.getByText('Saved evidence is stale · Saved source changed while opening this observation.',{exact:true})).toBeVisible();
  await run.getByText('Recorded scenario',{exact:true}).press('Enter');await expect(run.getByText(savedRun.scenario.expectedOutcome,{exact:true})).toBeVisible();await run.getByText('Recorded provenance',{exact:true}).press('Enter');await expect(run.locator('.run-provenance').getByText(savedRun.runtime.documentId,{exact:true})).toBeVisible();await expect(run.locator('.run-provenance').getByText(savedRun.runtime.route,{exact:true})).toBeVisible();
  await send(state());await expect(run.getByText('Sources match saved snapshot',{exact:false})).toBeVisible();
  const requests=run.locator('details').filter({has:page.locator(':scope > summary',{hasText:'Observed requests · 100'})});await requests.locator(':scope > summary').press('Enter');await expect(run.locator('.runtime-request')).toHaveCount(100);await expect(run.locator('.request-facts')).toHaveCount(0);
  const request=run.locator('.runtime-request').first();await request.locator(':scope > summary').press('Enter');await expect(request.locator('.request-facts')).toHaveCount(1);await expect(request.getByText('20 ms',{exact:true})).toBeVisible();await send(state());await expect(request).toHaveJSProperty('open',true);await expect(request.locator(':scope > summary')).toBeFocused();await expect(run.locator('.request-facts')).toHaveCount(1);await expect(page.locator('.scenario-run-record')).toHaveCount(1);
  h.host.featureFiles=fixture.files.map((item,i)=>i===0?{...item,source:item.source+'\n// changed'}:item);await send(state());await expect(run.getByText('Saved evidence is stale',{exact:false})).toBeVisible();
  const edit=page.locator('.feature-edit-details');await edit.locator(':scope > summary').press('Enter');const brief=page.getByRole('textbox',{name:'Feature brief',exact:true});await brief.fill('Preserve this unsaved feature draft.');await brief.press('ArrowLeft');const caret=await brief.evaluate(element=>element.selectionStart);assert.equal(caret,35);await send(state());await expect(brief).toBeFocused();assert.equal(await brief.evaluate(element=>element.selectionStart),caret);await expect(brief).toHaveValue('Preserve this unsaved feature draft.');
  await edit.locator(':scope > summary').press('Enter');await send(state());assert.equal((await counts()).options,0);await edit.locator(':scope > summary').press('Enter');await expect(brief).toHaveValue('Preserve this unsaved feature draft.');
  const changedFeatures={...features,revision:4,features:[{...feature,brief:'A newer saved brief.'}]};await send(state({features:changedFeatures}));await expect(brief).toHaveValue('Preserve this unsaved feature draft.');await expect(page.getByRole('button',{name:'Reload saved feature',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Save feature',exact:true})).toBeDisabled();
  for(const ownerChange of ['feature','project','trust']) {
   await send(state());await runtime.locator(':scope > summary').focus();await page.evaluate(()=>{window.heldSummary=document.activeElement;window.nativeSummaryClicks=0;heldSummary.addEventListener('click',event=>{if(event.isTrusted)window.nativeSummaryClicks++;});});
   await page.keyboard.down('Space');
   const overrides=ownerChange==='trust'?{trusted:false}:ownerChange==='project'?{project:{...project,id:'replacement-project'},features:{...features,projectId:'replacement-project'},runtimeWorkspace:null,conversations:null}:{features:{...features,revision:5,activeId:'replacement-feature',features:[{...feature,id:'replacement-feature'}]}};
   await send(state(overrides));await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>heldSummary.isConnected),false,`${ownerChange} invalidates the old disclosure target`);await page.keyboard.up('Space');assert.equal(await page.evaluate(()=>nativeSummaryClicks),0,`${ownerChange} cannot activate a replacement disclosure`);
   for(const details of await page.locator('.feature-runtime-details').all())await expect(details).toHaveJSProperty('open',false);
  }
  await send(state());await page.setViewportSize({width:390,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await send(state({trusted:false}));await expect(page.locator('.saved-scenario-run')).toHaveCount(0);await expect(page.locator('.feature-edit-form')).toHaveCount(0);await send(state({project:{...project,id:'other-project'},features:{...features,projectId:'other-project'},runtimeWorkspace:null,conversations:null}));await expect(page.locator('.saved-scenario-run')).toHaveCount(0);await expect(edit).toHaveJSProperty('open',false);assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>outbound.filter(message=>['ask','feature','runtimeWorkspace'].includes(message.type)).length),0,'viewing evidence and drafting do not dispatch actions');
 });
});
