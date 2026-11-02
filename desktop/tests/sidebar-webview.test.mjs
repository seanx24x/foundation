import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';

const root=fileURLToPath(new URL('../../',import.meta.url));
const file={path:'src/components/SaveButton.tsx',source:'export function SaveButton() { return <button>Save</button>; }',revision:'a'.repeat(64),language:'typescriptreact',analysis:{symbols:[],imports:[],consumers:[],requests:[]}};
const initial={type:'state',project:{id:'sidebar-fixture',name:'Sidebar fixture',files:[{path:file.path}],root:'/fixture'},activeFile:file,openFiles:[file],dirtyPaths:[],trusted:true,provider:{configured:true,model:'scripted-local-fixture',provider:'Local fixture',transport:'local'},changes:[],assistantSurface:{resolved:true,visible:true,open:true},workspaceMode:'Understand'};
const conversation={id:'conversation-fixture',title:'Understand the Save button',createdAt:'2026-10-28T10:00:00Z',updatedAt:'2026-10-28T10:00:00Z',archived:false,turns:[]};
const history={schemaVersion:1,projectId:initial.project.id,revision:1,activeId:conversation.id,conversations:[conversation],storage:{status:'saved'}};

test('native Assistant sidebar preserves drafts and canvas while keeping narrow conversations usable',async t=>{
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/theme.css'){
   const theme=JSON.parse(await readFile(join(root,`desktop/extension/themes/foundation-${url.searchParams.get('theme')==='light'?'light':'dark'}.json`),'utf8'));
   res.setHeader('Content-Type','text/css');res.end(`:root{${Object.entries(theme.colors).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v};`).join('')}}`);
  }else if(['/webview.js','/artifact-model.js','/workspace-model.js','/webview.css'].includes(url.pathname)||/^\/fonts\/[a-z-]+\.woff2$/.test(url.pathname)){
   res.setHeader('Content-Type',url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'font/woff2');res.end(await readFile(join(root,'desktop/extension/media',url.pathname.slice(1))));
  }else if(url.pathname==='/focus-host'){
   res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><input aria-label="Native editor fixture"><iframe title="Assistant sidebar" src="/" width="384" height="800"></iframe></body></html>');
  }else if(['/','/workspace'].includes(url.pathname)){
   const surface=url.pathname==='/workspace'?'data-foundation-surface="workspace" data-foundation-assistant="external"':'data-foundation-surface="assistant"';
   res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'nonce-test'; font-src 'self'; img-src 'self' data:; connect-src 'none'; frame-src 'self'"><link rel="stylesheet" href="/theme.css?theme=${url.searchParams.get('theme')==='light'?'light':'dark'}"><link rel="stylesheet" href="/webview.css"><title>Native Assistant sidebar verification fixture</title></head><body ${surface}><div id="foundation-root"></div><script nonce="test" src="/workspace-model.js"></script><script nonce="test" src="/artifact-model.js"></script><script nonce="test" src="/webview.js"></script></body></html>`);
  }else res.writeHead(404).end();
 }catch(error){res.writeHead(500).end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:384,height:800}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 await page.addInitScript(()=>{window.outbound=[];window.acquireVsCodeApi=()=>({getState:()=>JSON.parse(sessionStorage.getItem('view')||'null'),setState:value=>sessionStorage.setItem('view',JSON.stringify(value)),postMessage:message=>window.outbound.push(message)});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const send=message=>page.evaluate(data=>new Promise(resolve=>{const listener=e=>{if(e.source!==window||e.data?.type!==data.type)return;window.removeEventListener('message',listener);resolve();};window.addEventListener('message',listener);window.postMessage(data,location.origin);}),message);
 let snapshot=structuredClone(history);
 const state=overrides=>send({...initial,conversations:snapshot,...overrides});
 const outbound=async type=>page.evaluate(kind=>window.outbound.filter(message=>message.type===kind),type);
 const composer=()=>page.getByRole('textbox',{name:'Ask about your source'});
 const geometry=async label=>{
  const metrics=await page.evaluate(()=>{
   const main=document.querySelector('main'),form=document.querySelector('.composer'),responses=document.querySelector('.assistant-responses');
   const f=form.getBoundingClientRect(),r=responses.getBoundingClientRect();
   return {document:document.documentElement.scrollWidth>innerWidth,main:main.scrollWidth>main.clientWidth+1,form:form.scrollWidth>form.clientWidth+1,pinned:Math.abs(innerHeight-f.bottom-12)<2,separate:r.bottom<=f.top+1};
  });
  assert.deepEqual(metrics,{document:false,main:false,form:false,pinned:true,separate:true},label);
 };
 await page.goto(base);await state();
 await expect(page.getByRole('main',{name:'Assistant workspace'})).toBeVisible();
 assert.equal(await page.locator('.workspace-header,.workspace-footer,.activity-tabs,.page-heading').count(),0,'native chrome is not duplicated');
 await expect(page.getByRole('button',{name:'Collapse Assistant'})).toHaveCount(0);
 await expect(page.locator('.assistant-setup')).toHaveJSProperty('open',false);
 const setup=page.locator('.assistant-setup > summary');await setup.focus();await setup.press('Enter');
 await expect(page.getByRole('checkbox')).toBeVisible();await state();await expect(setup).toBeFocused();
 await expect(page.locator('.assistant-setup')).toHaveJSProperty('open',true);
 await setup.press('Enter');
 await composer().fill('Keep this draft while I work in the canvas.');
 // The native title bar owns Hide. Its visibility updates preserve this webview.
 await state({assistantSurface:{resolved:true,visible:false,open:false}});
 await state();await send({type:'mode',mode:'Assistant'});await send({type:'focusAssistant'});
 await expect(composer()).toHaveValue('Keep this draft while I work in the canvas.');await expect(composer()).toBeFocused();
 assert.equal((await outbound('ask')).length,0,'collapse/reopen never dispatches a request');
 await send({type:'prepareAssistant',projectId:'another-project',contextPath:file.path,intent:'change',prompt:'Wrong project'});
 await expect(composer()).toHaveValue('Keep this draft while I work in the canvas.');
 await send({type:'prepareAssistant',projectId:initial.project.id,contextPath:file.path,intent:'change',prompt:'Refine the Save button.'});
 await expect(composer()).toHaveValue('Refine the Save button.');await expect(page.getByRole('button',{name:'Build mode'})).toHaveAttribute('aria-pressed','true');
 assert.equal((await outbound('ask')).length,0,'preparing source context does not send it');
 await page.getByRole('button',{name:'Ask mode',exact:true}).click();await composer().fill('Explain this component.');
 await page.getByRole('button',{name:'Ask',exact:true}).click();const request=(await outbound('ask')).at(-1);
 assert.equal(request.conversationId,conversation.id);
 const turn={id:request.requestId,requestId:request.requestId,question:request.prompt,intent:'ask',context:[{id:'S1',...file,lines:1}],answer:'A saved-source explanation.\n\n'.repeat(30),state:'running',model:'scripted-local-fixture',started:true,createdAt:'2026-10-28T10:01:00Z',verificationHistory:[]};
 snapshot={...snapshot,revision:2,conversations:[{...conversation,turns:[turn]}]};
 await send({type:'ai',requestId:request.requestId,conversationId:conversation.id,event:{type:'delta',text:turn.answer},conversations:snapshot});
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();await geometry('streaming composer stays pinned');
 await page.locator('.assistant-responses').evaluate(el=>el.scrollTop=0);
 await send({type:'ai',requestId:request.requestId,conversationId:conversation.id,event:{type:'delta',text:'More text'},conversations:{...snapshot,revision:3}});
 assert.equal(await page.locator('.assistant-responses').evaluate(el=>el.scrollTop),0,'reading position survives stream updates');
 await page.getByRole('button',{name:'Stop',exact:true}).click();
 assert.equal((await outbound('cancel')).at(-1).requestId,request.requestId);
 turn.state='stopped';snapshot={...snapshot,revision:4,conversations:[{...conversation,turns:[turn]}]};
 await send({type:'ai',requestId:request.requestId,conversationId:conversation.id,event:{type:'cancelled'},conversations:snapshot});
 await expect(page.getByRole('button',{name:'Ask',exact:true})).toBeVisible();
 const pictures=join(root,'desktop/tests/artifacts');await mkdir(pictures,{recursive:true});
 for(const theme of ['dark','light']){
  await page.goto(`${base}/?theme=${theme}`);await state();
  for(const width of [170,240,300,320,384,480]){
   await page.setViewportSize({width,height:800});await geometry(`${theme} ${width}`);
   await page.getByRole('button',{name:'History',exact:true}).click();await geometry(`${theme} ${width} history`);
   await page.getByRole('button',{name:'History',exact:true}).press('Escape');
   await page.locator('.assistant-responses').evaluate(el=>el.scrollTop=0);
   const expand=page.getByRole('button',{name:'Open Explanation details'});
   await expand.click();const dialog=page.getByRole('dialog',{name:'Artifact details'});await expect(dialog).toBeVisible();
   assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`${theme} ${width} artifact dialog overflow`);
   await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(expand).toBeFocused();
  }
  await page.setViewportSize({width:384,height:800});await page.screenshot({path:join(pictures,`assistant-sidebar-${theme}.png`)});
 }
 await page.setViewportSize({width:320,height:600});await geometry('short sidebar');
 await state({provider:{configured:false,reason:'No provider configured.'},conversations:{...snapshot,storage:{status:'error',message:'Conversation changes could not be saved locally.'}}});
 await expect(page.getByRole('button',{name:'Retry saving'})).toBeVisible();await geometry('storage failure');
 // Native workspace keeps its own mode and mounted canvas when the assistant is toggled.
 await page.setViewportSize({width:1280,height:900});await page.goto(`${base}/workspace`);
 const design={session:'sidebar-preview',entry:file.path,revision:file.revision,html:'<!doctype html><html><body><button>Save</button></body></html>',files:[file],tokens:[],stale:false};
 await state({design});await page.getByRole('button',{name:'Refine',exact:true}).click();
 const iframe=page.locator('iframe');await expect(iframe).toHaveCount(1);const frameIdentity=await iframe.evaluate(el=>(el.testIdentity='retained'));
 await page.getByRole('button',{name:'Assistant',exact:true}).click();
 assert.deepEqual((await outbound('action')).at(-1),{type:'action',id:'foundation.toggleAssistant'});
 await expect(page.getByRole('main',{name:'Refine workspace'})).toBeVisible();assert.equal(await iframe.evaluate(el=>el.testIdentity),frameIdentity);
 await state({design,assistantSurface:{resolved:true,visible:false,open:false}});
 await expect(page.getByRole('button',{name:'Assistant',exact:true})).toHaveAttribute('aria-pressed','false');
 await state({design});await expect(page.getByRole('button',{name:'Assistant',exact:true})).toHaveAttribute('aria-pressed','true');assert.equal(await iframe.evaluate(el=>el.testIdentity),frameIdentity);
 // The central surface is independently narrower when editor + Assistant are open.
 // Measured selection must remain a vertical inspector, not the old two-column stack.
 await page.frameLocator('iframe').locator('button').evaluate((button,path)=>{
  const rect=button.getBoundingClientRect(),style=getComputedStyle(button);
  parent.postMessage({channel:'foundation-design',session:'sidebar-preview',type:'selection',intent:'select',selection:{path,tag:'button',label:'Save changes',rect:{width:rect.width,height:rect.height},styles:{color:style.color,backgroundColor:style.backgroundColor,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight}}},'*');
 },file.path);
 await expect(page.locator('.computed-properties')).toBeVisible();
 for(const width of [900,1000,1100]){
  await page.setViewportSize({width,height:900});
  await expect(page.locator('.studio-layout')).not.toHaveClass(/is-compact/);
  const layout=await page.locator('.design-inspector').evaluate(inspector=>{
   const title=inspector.querySelector('.inspector-title'),sections=[...inspector.querySelectorAll(':scope > .inspector-section')];
   const first=sections[0].getBoundingClientRect(),last=sections[1].getBoundingClientRect(),head=title.getBoundingClientRect();
   const color=inspector.querySelector('.computed-properties dd').getBoundingClientRect();
   return{display:getComputedStyle(inspector).display,overflow:inspector.scrollWidth>inspector.clientWidth+1,fullWidth:Math.abs(first.width-inspector.clientWidth)<=1,titleAbove:head.bottom<=first.top+1,sectionsVertical:first.bottom<=last.top+1,propertyReadable:color.width>=100&&color.height<=24,verticalBorder:getComputedStyle(sections[1]).borderLeftWidth};
  });
  assert.deepEqual(layout,{display:'block',overflow:false,fullWidth:true,titleAbove:true,sectionsVertical:true,propertyReadable:true,verticalBorder:'0px'},`Refine inspector ${width}`);
 }
 await page.setViewportSize({width:700,height:900});await expect(page.locator('.studio-layout')).toHaveClass(/is-compact/);
 await page.getByRole('button',{name:'Inspector',exact:true}).click();await expect(page.locator('.design-inspector')).toBeVisible();
 assert.equal(await page.locator('.design-inspector').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'compact inspector overflow');
 await page.getByRole('button',{name:'Back to canvas',exact:true}).click();await expect(iframe).toBeVisible();
 await page.setViewportSize({width:1000,height:900});await page.screenshot({path:join(pictures,'refine-sidebar-split.png')});
 await page.getByRole('button',{name:'Understand',exact:true}).click();await page.getByRole('button',{name:'Ask about this source',exact:true}).click();
 assert.deepEqual((await outbound('action')).at(-1),{type:'action',id:'foundation.askAI',projectId:initial.project.id,contextPath:file.path,intent:'ask'});
 await expect(page.getByRole('main',{name:'Understand workspace'})).toBeVisible();assert.equal((await outbound('ask')).length,0);
 // Reviewable clarity states use the production renderer and explicitly scripted host data.
 let captureRevision=100;
 const capturedHistory=(turns=[],extra=[])=>({...history,revision:++captureRevision,conversations:[{...conversation,turns},...extra]});
 const capture=name=>page.screenshot({path:join(pictures,`${name}.png`)});
 const denseFile={...file,analysis:{symbols:[{name:'SaveButton',kind:'function',line:1,endLine:1,exported:true}],imports:[{specifier:'./states',resolvedPath:'src/states.ts',line:1},{specifier:'react',line:1}],consumers:[{path:'src/ProfileForm.tsx',line:4}],requests:[{method:'POST',url:'/api/profile',line:1}]}};
 const capturedProposal={id:'clarity-proposal',projectId:initial.project.id,path:file.path,before:file.source,after:file.source.replace('Save</button>','Save changes</button>'),baseRevision:file.revision,status:'proposed',origin:'ai',title:'Clarify the Save button label',summary:'Use a more explicit label while preserving the button’s behavior.',context:[{path:file.path,revision:file.revision}],verification:['Check that the label fits at narrow widths.']};
 for(const theme of ['dark','light']){
  await page.setViewportSize({width:900,height:900});await page.goto(`${base}/workspace?theme=${theme}`);
  await expect(page.getByRole('heading',{name:'Connecting to the editor'})).toBeVisible();await capture(`clarity-loading-${theme}`);
  await state({conversations:capturedHistory()});
  await expect(page.locator('.activity-tabs').getByRole('button',{name:'Assistant',exact:true})).toHaveCount(0);
  await expect(page.locator('.header-tools').getByRole('button',{name:'Assistant',exact:true})).toHaveCount(1);
  assert.equal(await page.locator('.source-heading .revision').count(),0,'revision is not repeated in the page heading');
  assert.equal(await page.locator('.footer-source,.selected-entity').count(),0,'selection chrome is not repeated in content or footer');
  await capture(`clarity-understand-empty-${theme}`);
  await state({activeFile:denseFile,openFiles:[denseFile],conversations:capturedHistory()});await capture(`clarity-understand-${theme}`);
  const sourceDetails=page.locator('.source-details');await sourceDetails.locator('summary').focus();await sourceDetails.locator('summary').press('Enter');
  await state({activeFile:denseFile,openFiles:[denseFile],conversations:capturedHistory()});await expect(sourceDetails).toHaveJSProperty('open',true);await expect(sourceDetails.locator('summary')).toBeFocused();
  const unsupported={...file,path:'README.md',language:'markdown',analysis:{symbols:[],imports:[],consumers:[],requests:[],unsupported:true}};
  await state({activeFile:unsupported,openFiles:[unsupported],conversations:capturedHistory()});
  await expect(page.getByText('Source relationships are unavailable for this file type.')).toBeVisible();
  await expect(page.getByText('No static imports found.')).toHaveCount(0);await capture(`clarity-understand-unsupported-${theme}`);
  await state({conversations:capturedHistory(),design:null});await page.getByRole('button',{name:'Refine',exact:true}).click();
  await expect(page.getByText('No preview yet',{exact:true})).toBeVisible();await capture(`clarity-refine-empty-${theme}`);
  await state({conversations:capturedHistory(),design:{entry:file.path,status:'failed',error:'Preview could not resolve example-package. Check the import and rebuild.'}});await capture(`clarity-refine-failed-${theme}`);
  await state({conversations:capturedHistory(),design:{...design,status:'ready'}});
  await page.frameLocator('iframe').locator('button').evaluate((button,path)=>{
   const rect=button.getBoundingClientRect(),styles=getComputedStyle(button);
   parent.postMessage({channel:'foundation-design',session:'sidebar-preview',type:'ready'},'*');
   parent.postMessage({channel:'foundation-design',session:'sidebar-preview',type:'selection',intent:'select',selection:{path,tag:'button',label:'Save',rect:{width:rect.width,height:rect.height},styles:{color:styles.color,backgroundColor:styles.backgroundColor,fontSize:styles.fontSize,lineHeight:styles.lineHeight}}},'*');
  },file.path);
  await expect(page.locator('.element-label')).toHaveText('Save');await capture(`clarity-refine-${theme}`);
  await page.getByRole('button',{name:'Review',exact:true}).click();await state({conversations:capturedHistory(),proposal:capturedProposal});await capture(`clarity-review-active-${theme}`);
  const previous={...capturedProposal,status:'discarded'};await state({conversations:capturedHistory(),proposal:previous});
  const previousDetails=page.locator('.previous-proposal');await expect(previousDetails).toHaveJSProperty('open',false);await expect(previousDetails.locator('.proposal-card')).not.toBeVisible();
  await expect(page.getByRole('heading',{name:'Checks',exact:true})).toBeVisible();await capture(`clarity-review-previous-${theme}`);
  await previousDetails.locator(':scope > summary').focus();await previousDetails.locator(':scope > summary').press('Enter');
  await state({conversations:capturedHistory(),proposal:previous});await expect(previousDetails).toHaveJSProperty('open',true);await expect(previousDetails.locator(':scope > summary')).toBeFocused();
  const checks=page.locator('.verification .content-details');await checks.locator('summary').focus();await checks.locator('summary').press('Enter');
  await state({conversations:capturedHistory(),proposal:previous});await expect(checks).toHaveJSProperty('open',true);await expect(checks.locator('summary')).toBeFocused();
  await state({trusted:false});await capture(`clarity-trust-${theme}`);
  await state({project:null,activeFile:null,openFiles:[]});await capture(`clarity-project-empty-${theme}`);

  await page.setViewportSize({width:384,height:800});await page.goto(`${base}/?theme=${theme}`);
  await state({provider:{configured:false,reason:'No provider selected.'},conversations:{...capturedHistory(),activeId:null,conversations:[]}});
  if(await page.locator('.assistant-setup').evaluate(el=>el.open)) await page.locator('.assistant-setup > summary').click();
  await expect(page.getByText('Local project history',{exact:true})).toBeVisible();await expect(page.locator('.suggestion')).toHaveCount(0);
  await expect(page.locator('.composer').getByRole('button',{name:'Set up AI',exact:true})).toBeVisible();await expect(page.locator('.assistant-setup')).toHaveJSProperty('open',false);
  await capture(`clarity-assistant-disconnected-${theme}`);
  await page.locator('.composer').getByRole('button',{name:'Set up AI',exact:true}).click();assert.deepEqual((await outbound('action')).at(-1),{type:'action',id:'foundation.configureAI'});
  await state({conversations:capturedHistory()});await capture(`clarity-assistant-ready-${theme}`);
  await composer().fill('Explain this source.');await state({conversations:capturedHistory(),dirtyPaths:[file.path]});
  await expect(page.locator('.composer-guidance')).toHaveText('Save the selected files before sending.');await expect(page.locator('.assistant-setup')).toHaveJSProperty('open',false);
  await expect(page.getByRole('button',{name:'Ask',exact:true})).toBeDisabled();await capture(`clarity-assistant-blocked-${theme}`);
  await state({conversations:capturedHistory(),openFiles:[],activeFile:null});await expect(page.locator('.composer-guidance')).toHaveText('Some selected source is unavailable. Retry or remove it from Context.');await expect(page.locator(`input[data-context-path="${file.path}"]`)).toBeChecked();
  const capturedTurn={...turn,id:'clarity-request',requestId:'clarity-request',question:'What does this component do?',answer:'SaveButton renders a button labelled Save. This saved revision has no click handler or loading state. [S1:1]',state:'running'};
  await state({conversations:capturedHistory([capturedTurn])});await capture(`clarity-assistant-streaming-${theme}`);
  capturedTurn.state='complete';await state({conversations:capturedHistory([capturedTurn])});
  const requestDetails=page.locator('.artifact-content .content-details');await requestDetails.locator('summary').focus();await requestDetails.locator('summary').press('Enter');
  await state({conversations:capturedHistory([capturedTurn])});await expect(requestDetails).toHaveJSProperty('open',true);await expect(requestDetails.locator('summary')).toBeFocused();
  await requestDetails.locator('summary').press('Enter');
  await page.getByRole('button',{name:'Open Explanation details'}).click();await capture(`clarity-assistant-artifact-${theme}`);await page.getByRole('button',{name:'Close',exact:true}).click();
  await state({conversations:capturedHistory([capturedTurn]),activeFile:{...file,revision:'b'.repeat(64)},openFiles:[{...file,revision:'b'.repeat(64)}]});await capture(`clarity-assistant-stale-${theme}`);
  await state({conversations:capturedHistory([capturedTurn],[{...conversation,id:'history-previous',title:'Review loading states',archived:true,turns:[{...capturedTurn,id:'previous-request',requestId:'previous-request'}]}])});
  await page.getByRole('button',{name:'History',exact:true}).click();await capture(`clarity-assistant-history-${theme}`);await page.getByRole('button',{name:'History',exact:true}).press('Escape');
  await page.locator('.assistant-setup > summary').click();
  const privacy=page.locator('.assistant-context-rail .content-details');await privacy.locator('summary').focus();await privacy.locator('summary').press('Enter');
  await state({conversations:capturedHistory([capturedTurn])});await expect(privacy).toHaveJSProperty('open',true);await expect(privacy.locator('summary')).toBeFocused();
  await page.locator('.assistant-setup > summary').click();await page.setViewportSize({width:240,height:700});await geometry(`${theme} narrow clarity`);
  assert.equal((await outbound('ask')).length,0,'clarity navigation and setup never dispatch requests');
 }

 // Retained sibling webviews retain activeElement even when the editor owns focus.
 // Stream/state hydration and generic mode messages must not steal it back.
 await page.setViewportSize({width:1280,height:900});await page.goto(`${base}/focus-host`);const handle=await page.waitForSelector('iframe');const frame=await handle.contentFrame();
 const frameSend=message=>frame.evaluate(data=>new Promise(resolve=>{const listener=e=>{if(e.data?.type!==data.type)return;window.removeEventListener('message',listener);resolve();};window.addEventListener('message',listener);window.postMessage(data,location.origin);}),message);
 await frameSend({...initial,conversations:snapshot});
 const frameComposer=frame.getByRole('textbox',{name:'Ask about your source'});
 await frameComposer.fill('Preserve my draft.');await frameComposer.focus();
 const editor=page.getByRole('textbox',{name:'Native editor fixture'});await editor.fill('Editor still owns the keyboard.');await editor.focus();
 assert.equal(await frame.evaluate(()=>document.hasFocus()),false);
 await frameSend({...initial,conversations:snapshot});await expect(editor).toBeFocused();
 await frameSend({type:'mode',mode:'Assistant'});await expect(editor).toBeFocused();
 await frameSend({type:'ai',requestId:request.requestId,conversationId:conversation.id,event:{type:'done'},conversations:snapshot});await expect(editor).toBeFocused();
 await frame.getByRole('button',{name:'Open Explanation details'}).click();
 await editor.focus();await frameSend({...initial,conversations:snapshot});await expect(editor).toBeFocused();
 await frame.getByRole('button',{name:'Close',exact:true}).click();
 await frame.getByRole('button',{name:'History',exact:true}).click();await editor.focus();
 await frameSend({...initial,conversations:snapshot});await expect(editor).toBeFocused();
 await frameSend({type:'focusAssistant'});await expect(frameComposer).toBeFocused();
 await expect(frameComposer).toHaveValue('Preserve my draft.');
 assert.deepEqual(errors,[]);
});
