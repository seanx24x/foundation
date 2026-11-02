import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';

const root=fileURLToPath(new URL('../../',import.meta.url));
const stamp=minute=>'2026-10-31T12:'+String(minute).padStart(2,'0')+':00.000Z';
const file={path:'src/tokens.css',source:':root { --radius: 8px; }',revision:'a'.repeat(64),language:'css',analysis:{symbols:[],imports:[],consumers:[],requests:[]}};
const project={id:'verification-fixture',name:'Verification fixture',root:'/fixture',files:[{path:file.path}]};
const feature={id:'save',title:'Save profile',brief:'Make saving recoverable.',paths:[file.path],entryPath:file.path,archived:false,createdAt:stamp(0),updatedAt:stamp(0)};
const features={schemaVersion:1,projectId:project.id,revision:1,activeId:feature.id,features:[feature],storage:{status:'saved'}};
const screen={id:'profile',featureId:feature.id,title:'Profile',targetId:'vite:dev',route:'/profile',archived:false,createdAt:stamp(0),updatedAt:stamp(0)};
const scenario={id:'save-error',screenId:screen.id,title:'Recover after a failed save',steps:['Choose Save.','Retry the request.'],expectedOutcome:'The retry succeeds.',archived:false,createdAt:stamp(0),updatedAt:stamp(0)};
const runtime={targetId:screen.targetId,route:screen.route,session:'1'.repeat(32),viewId:'2'.repeat(32),documentId:'3'.repeat(32),pageVersion:1};
const before={id:'run-before',feature:{id:feature.id,title:feature.title,revision:1,paths:feature.paths},screen,scenario,definitionRevision:2,runtime,sources:[{path:file.path,revision:file.revision}],dirtyPaths:[],startedAt:stamp(1),endedAt:stamp(3),status:'completed',assessment:'matched',note:'Baseline noted.',observations:[],truncated:false};
const after={...before,id:'run-after',sources:[{path:file.path,revision:'b'.repeat(64)}],startedAt:stamp(4),endedAt:stamp(6),status:'interrupted',assessment:'not-matched',note:'Retry did not match the expected outcome.'};
const workspace={schemaVersion:1,projectId:project.id,revision:3,activeScreenId:screen.id,activeScenarioId:scenario.id,screens:[screen],scenarios:[scenario],runs:[before,after],storage:{status:'saved'},runFreshness:[{id:before.id,status:'stale',reason:'Source changed.'},{id:after.id,status:'current',reason:'Saved source matches.'}]};
const proposal={id:'proposal-radius',origin:'design',title:'Refine corner radius',path:file.path,status:'applied',before:file.source,after:':root { --radius: 16px; }',baseRevision:file.revision,appliedRevision:'b'.repeat(64)};
const basis='c'.repeat(64);
const choice=run=>({id:run.id,label:(run.id===before.id?'Before':'After')+' · '+stamp(3),eligible:true,reason:'',status:run.status,assessment:run.assessment,endedAt:run.endedAt,capture:true,replay:true});
const scope={featureId:feature.id,featureTitle:feature.title,screenId:screen.id,screenTitle:screen.title,scenarioId:scenario.id,scenarioTitle:scenario.title,canView:true,reason:'',beforeChoices:[choice(before)],afterChoices:[choice(after)]};
const summary=run=>({runId:run.id,status:run.status,assessment:run.assessment,note:run.note,startedAt:run.startedAt,endedAt:run.endedAt,sourceHash:run.sources[0].revision,dirtyPaths:[],capture:{id:'capture-'+run.id,conditions:{},image:{}},replay:{id:'replay-'+run.id,status:'completed',requested:{}}});
const entry={id:'linked-one',proposalId:proposal.id,title:proposal.title,path:file.path,beforeId:before.id,afterId:after.id,featureId:feature.id,screenId:screen.id,scenarioId:scenario.id,scenarioTitle:scenario.title,createdAt:stamp(7),currentRelevance:'applied-current',canCompare:true,reason:'',warnings:[],before:summary(before),after:summary(after),compilation:'not-recorded',visual:'not-assessed',sourceRelationship:'unverified'};
const view=(extra={})=>({schemaVersion:1,projectId:project.id,revision:0,storage:{status:'saved'},busy:null,error:null,proposal:{proposalId:proposal.id,proposalBasis:basis,canLink:true,reason:'',scenarios:[scope]},records:[],...extra});
const selection={version:1,projectId:project.id,proposalId:proposal.id,proposalBasis:basis,scenarioId:scenario.id,beforeId:before.id,afterId:after.id};

async function fixture(t,{persisted={},theme='dark',width=1100}={}){
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/theme.css'){const values=JSON.parse(await readFile(join(root,'desktop/extension/themes/foundation-'+theme+'.json'),'utf8'));res.setHeader('Content-Type','text/css');res.end(':root{'+Object.entries(values.colors).map(([key,value])=>'--vscode-'+key.replaceAll('.','-')+':'+value+';').join('')+'}');}
  else if(['/webview.js','/webview.css','/workspace-model.js','/artifact-model.js'].includes(url.pathname)||/^\/fonts\/[a-z-]+\.woff2$/.test(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'font/woff2');res.end(await readFile(join(root,'desktop/extension/media',url.pathname.slice(1))));}
  else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/webview.css"></head><body data-foundation-surface="workspace" data-foundation-assistant="external"><div id="foundation-root"></div><script src="/workspace-model.js"></script><script src="/artifact-model.js"></script><script src="/webview.js"></script></body></html>');}
 }catch(error){res.writeHead(500).end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);});
 await page.addInitScript(initial=>{window.outbound=[];if(!sessionStorage.getItem('verification-view'))sessionStorage.setItem('verification-view',JSON.stringify(initial));window.acquireVsCodeApi=()=>({getState:()=>JSON.parse(sessionStorage.getItem('verification-view')),setState:value=>sessionStorage.setItem('verification-view',JSON.stringify(value)),postMessage:value=>outbound.push(value)});},{mode:'Review',...persisted});
 let current={type:'state',project,activeFile:file,openFiles:[file],trusted:true,dirtyPaths:[],provider:{configured:false},changes:[],features,featureFiles:[file],featureCandidates:[],featureUnavailable:[],runtime:{status:'idle',targets:[],observations:[],owned:false},runtimeWorkspace:workspace,proposal,visualVerification:view()};
 const send=data=>page.evaluate(message=>new Promise(resolve=>{addEventListener('message',function receive(event){if(event.source!==window||event.data?.type!==message.type)return;removeEventListener('message',receive);resolve();});postMessage(message,location.origin);}),data);
 const state=updates=>{current={...current,...updates};return send(current);};
 const panel=()=>page.getByRole('region',{name:'Visual change verification',exact:true});
 const choose=async()=>{await panel().getByRole('combobox',{name:'Scenario',exact:true}).selectOption(scenario.id);await panel().getByRole('combobox',{name:'Before observation',exact:true}).selectOption(before.id);await panel().getByRole('combobox',{name:'After observation',exact:true}).selectOption(after.id);};
 const history=()=>page.getByRole('region',{name:'Linked verification history',exact:true});
 const open=async()=>{const details=page.locator('.visual-verification-record-details').first();if(!await details.evaluate(node=>node.open))await details.locator(':scope > summary').click();};
 const outbound=()=>page.evaluate(()=>structuredClone(window.outbound));
 const saved=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('verification-view')));
 await page.goto('http://127.0.0.1:'+server.address().port);await state();return {page,state,send,panel,history,open,choose,outbound,saved,current:()=>current};
}
test('linking requires explicit whole-pair choice and confirms only a saved journal acknowledgment',async t=>{
 const f=await fixture(t),{page}=f,link=f.panel().getByRole('button',{name:'Link evidence',exact:true});
 await expect(f.panel().getByRole('combobox',{name:'Scenario',exact:true})).toHaveValue('');await expect(link).toBeDisabled();await f.choose();await expect(link).toBeEnabled();await expect(f.panel().getByRole('combobox',{name:'Before observation'}).locator('option[value="run-before"]')).toContainText('Completed recording');assert.equal((await f.panel().getByRole('combobox',{name:'Before observation'}).textContent()).includes('T12:'),false);assert.equal((await f.outbound()).filter(value=>value.type==='visualVerification').length,0);
 await link.focus();await link.press('Enter');assert.deepEqual((await f.outbound()).filter(value=>value.type==='visualVerification'),[{type:'visualVerification',action:'link',projectId:project.id,expectedRevision:0,proposalBasis:basis,scenarioId:scenario.id,beforeId:before.id,afterId:after.id}]);await expect(f.panel()).toHaveAttribute('aria-busy','true');await expect(f.panel()).not.toContainText('Evidence linked.');
 await f.state({visualVerification:view({revision:1,storage:{status:'saving'},records:[entry],busy:'link'})});await expect(f.panel()).not.toContainText('Evidence linked.');
 await f.state({visualVerification:view({revision:1,records:[entry]})});await expect(f.panel()).toContainText('Evidence linked.');await expect(page.locator('[data-verification-record="linked-one"]')).toBeVisible();await expect(link).toBeFocused();
 const actual=await f.outbound();assert.equal(actual.some(value=>['runtimeReplay','runtimeMatrix','runtimeStateSuite','runtimeCaptureImage','ask'].includes(value.type)),false);
});
test('failed storage preserves all selections and history; retry uses current expected revision without running anything',async t=>{
 const f=await fixture(t);await f.choose();await f.panel().getByRole('button',{name:'Link evidence',exact:true}).click();
 await f.state({visualVerification:view({revision:3,storage:{status:'error',message:'Disk full. Evidence was not saved.'},error:'Disk full. Evidence was not saved.',records:[{...entry,id:'older',beforeId:'other-before'}]})});
 await expect(f.panel()).toContainText('Disk full.');await expect(f.panel()).not.toContainText('Evidence linked.');await expect(f.panel().getByRole('combobox',{name:'Before observation'})).toHaveValue(before.id);await expect(f.panel().getByRole('combobox',{name:'After observation'})).toHaveValue(after.id);await expect(f.history()).toContainText(scenario.title);
 await f.panel().getByRole('button',{name:'Retry evidence storage'}).click();assert.deepEqual((await f.outbound()).filter(value=>value.type==='visualVerification').at(-1),{type:'visualVerification',action:'retry',projectId:project.id,expectedRevision:3});
 await f.state({visualVerification:view({revision:3,records:[entry]})});await expect(f.panel()).not.toContainText('Evidence linked.');await expect(f.panel().getByRole('button',{name:'Link evidence',exact:true})).toBeEnabled();
});
test('drafts preserve focus, missing choices and full-basis isolation across publication and restart',async t=>{
 const f=await fixture(t);await f.choose();const afterSelect=f.panel().getByRole('combobox',{name:'After observation'});await afterSelect.focus();
 await f.state({visualVerification:view({proposal:{...view().proposal,scenarios:[{...scope,afterChoices:[choice(after),{...choice(after),id:'newer'}]}]}})});await expect(afterSelect).toHaveValue(after.id);await expect(afterSelect).toBeFocused();
 await f.state({visualVerification:view({proposal:{...view().proposal,scenarios:[{...scope,afterChoices:[]}]}})});await expect(afterSelect).toHaveValue(after.id);await expect(f.panel()).toContainText('The selected after observation is unavailable.');await expect(f.panel().getByRole('button',{name:'Link evidence',exact:true})).toBeDisabled();
 await f.page.reload();await f.state({visualVerification:view()});await expect(afterSelect).toHaveValue(after.id);assert.equal((await f.outbound()).some(value=>value.type==='visualVerification'),false);
 await f.state({visualVerification:view({proposal:{...view().proposal,proposalBasis:'d'.repeat(64)}})});await expect(f.panel().getByRole('combobox',{name:'Scenario',exact:true})).toHaveValue('');
 await f.state({visualVerification:view()});await expect(afterSelect).toHaveValue(after.id);await f.state({project:{...project,id:'other'},visualVerification:view({projectId:'other'})});await expect(f.panel().getByRole('combobox',{name:'Scenario',exact:true})).toHaveValue('');
});
test('before apply guides a baseline and View scenario waits for an exact passive navigation acknowledgment',async t=>{
 const f=await fixture(t);await f.state({proposal:{...proposal,status:'proposed'},visualVerification:view({proposal:{...view().proposal,canLink:false,reason:'Apply first.'}})});
 await expect(f.panel()).toContainText('Before applying, record a baseline');await expect(f.panel().getByRole('button',{name:'Link evidence'})).toHaveCount(0);await f.panel().getByRole('combobox',{name:'Scenario',exact:true}).selectOption(scenario.id);await f.panel().getByRole('button',{name:'View scenario'}).click();
 assert.deepEqual((await f.outbound()).filter(value=>value.type==='visualVerification').at(-1),{type:'visualVerification',action:'viewScenario',projectId:project.id,expectedRevision:0,proposalBasis:basis,featureId:feature.id,screenId:screen.id,scenarioId:scenario.id});await expect(f.panel()).toBeVisible();
 await f.send({type:'visualVerificationScenario',projectId:project.id,featureId:feature.id,screenId:screen.id,scenarioId:'wrong'});await expect(f.panel()).toBeVisible();
 await f.send({type:'visualVerificationScenario',projectId:project.id,featureId:feature.id,screenId:screen.id,scenarioId:scenario.id});assert.equal((await f.saved()).mode,'Refine');assert.equal((await f.saved()).previewMode,'runtime');
 assert.equal((await f.outbound()).some(value=>['runtimeScreen','scenarioStart','runtimeReplay','runtimeMatrix','runtimeCaptureImage','ask'].includes(value.type)),false);
});
test('loading, empty, dirty, stale and mismatched evidence explain why linking is unavailable',async t=>{
 const f=await fixture(t);await f.state({visualVerification:null});await expect(f.panel()).toContainText('Loading verification evidence');await f.state({visualVerification:view({proposal:{...view().proposal,scenarios:[]}})});await expect(f.panel()).toContainText('No scenarios are linked');
 await f.state({visualVerification:view()});await f.choose();
 for(const reason of ['Save the unsaved target before linking.','The applied source changed. Rebuild this proposal.']){
  await f.state({visualVerification:view({proposal:{...view().proposal,canLink:false,reason}})});await expect(f.panel()).toContainText(reason);await expect(f.panel().getByRole('button',{name:'Link evidence',exact:true})).toBeDisabled();
 }
 await f.state({visualVerification:view({proposal:{...view().proposal,scenarios:[{...scope,beforeChoices:[{...choice(before),eligible:false,reason:'Unsaved source was present.'}]}]}})});await expect(f.panel()).toContainText('Unsaved source was present.');await expect(f.panel().getByRole('button',{name:'Link evidence',exact:true})).toBeDisabled();
 await f.state({visualVerification:view({proposal:{...view().proposal,scenarios:[{...scope,canView:false,reason:'The saved scenario was removed.'}]}})});await expect(f.panel()).toContainText('The saved scenario was removed.');await expect(f.panel().getByRole('button',{name:'View scenario'})).toBeDisabled();
 await f.state({visualVerification:view({projectId:'wrong'})});await expect(f.panel().getByRole('combobox')).toHaveCount(0);
 await f.state({trusted:false,visualVerification:view()});await expect(f.panel()).toHaveCount(0);
});
test('saved history separates all outcomes and survives undo, changed source, missing evidence and replacement',async t=>{
 const f=await fixture(t);await f.state({visualVerification:view({revision:1,records:[entry]})});await expect(f.page.locator('[data-verification-record]')).toHaveCount(0);await f.open();const row=f.page.locator('[data-verification-record="linked-one"]');
 for(const copy of ['Baseline → applied revision','Matches applied source','Completed recording','Interrupted','Matched expectation · manual','Did not match · manual','Completed app callbacks','Recorded · load image in comparison','Unverified'])await expect(row).toContainText(copy);
 assert.equal((await row.textContent()).includes('Passed'),false);await expect(row.locator('dt').filter({hasText:/^Compilation$/}).locator('+ dd')).toHaveText('Not recorded');
 await f.state({proposal:{...proposal,status:'undone'},visualVerification:view({records:[{...entry,currentRelevance:'source-changed',warnings:['Capture conditions differ.']}]})});await expect(row).toContainText('Changed since this proposal');await expect(row).toContainText('Capture conditions differ.');
 await f.state({proposal:null,visualVerification:view({proposal:null,records:[{...entry,currentRelevance:'historical',canCompare:false,reason:'The before capture is unavailable.',before:{...entry.before,capture:null,status:'cancelled'},after:null}]})});await expect(row).toContainText('Historical proposal');await expect(row).toContainText('Stopped recording');await expect(row).toContainText('No available capture');await expect(row).toContainText('The linked observation is unavailable');await expect(row.getByRole('button',{name:'Compare observations'})).toBeDisabled();
 await f.page.reload();await f.state();await expect(f.history()).toContainText(scenario.title);await expect(f.page.locator('[data-verification-record]')).toHaveCount(0);
});
test('comparison opens canonical selected observations only after exact explicit host acknowledgment',async t=>{
 const f=await fixture(t);await f.state({visualVerification:view({records:[entry]})});await f.open();
 const ack={type:'visualVerificationComparison',projectId:project.id,featureId:feature.id,id:entry.id,beforeId:before.id,afterId:after.id};
 await f.send(ack);assert.deepEqual((await f.saved()).observationComparisons,[]);
 await f.page.getByRole('button',{name:'Compare observations',exact:true}).click();assert.deepEqual((await f.outbound()).filter(value=>value.type==='visualVerification').at(-1),{type:'visualVerification',action:'compare',projectId:project.id,expectedRevision:0,id:entry.id});
 await f.send({...ack,afterId:'wrong'});await expect(f.panel()).toBeVisible();await f.send(ack);
 await expect(f.page.getByRole('combobox',{name:'Baseline observation',exact:true})).toHaveValue(before.id);await expect(f.page.getByRole('combobox',{name:'Comparison observation',exact:true})).toHaveValue(after.id);await expect(f.page.getByRole('region',{name:'Observation comparison',exact:true})).toBeVisible();assert.equal((await f.saved()).mode,'Understand');
 assert.equal((await f.outbound()).some(value=>['runtimeReplay','runtimeMatrix','runtimeStateSuite','ask'].includes(value.type)),false);
});
test('host navigation and state publications cannot recollapse an explicitly requested comparison',async t=>{
 const f=await fixture(t);await f.state({visualVerification:view({records:[entry]})});await f.open();
 const ack={type:'visualVerificationComparison',projectId:project.id,featureId:feature.id,id:entry.id,beforeId:before.id,afterId:after.id};
 for(const closed of ['runtime','comparison']){
  await f.page.getByRole('button',{name:'Compare observations',exact:true}).click();
  // The native host opens Understand and republishes state before acknowledging.
  await f.send({type:'mode',mode:'Understand'});await f.state();
  const runtime=f.page.locator('.feature-runtime-details');
  if(closed==='runtime')await expect(runtime).toHaveJSProperty('open',false);
  else {await runtime.locator(':scope > summary').click();const comparison=f.page.locator('.observation-comparison-details');if(await comparison.evaluate(node=>node.open))await comparison.locator(':scope > summary').click();await expect(comparison).toHaveJSProperty('open',false);}
  await f.send(ack);
  await expect(f.page.getByRole('region',{name:'Observation comparison',exact:true})).toBeVisible();
  await expect(f.page.getByRole('combobox',{name:'Baseline observation',exact:true})).toHaveValue(before.id);
  await expect(f.page.getByRole('combobox',{name:'Comparison observation',exact:true})).toHaveValue(after.id);
  await expect(f.page.getByRole('combobox',{name:'Baseline observation',exact:true})).toBeFocused();
  await f.state();await expect(f.page.getByRole('region',{name:'Observation comparison',exact:true})).toBeVisible();
  await f.page.locator('.feature-runtime-details > summary').click();
  await f.send({type:'mode',mode:'Review'});await f.open();
 }
 assert.equal((await f.outbound()).some(value=>['runtimeReplay','runtimeMatrix','runtimeStateSuite','ask'].includes(value.type)),false);
});
test('light and dark verification supports keyboard focus and narrow layouts without overflow',async t=>{
 await mkdir(join(root,'desktop/tests/artifacts'),{recursive:true});
 for(const theme of ['light','dark']){
  const f=await fixture(t,{theme});await f.choose();await f.state({visualVerification:view({records:[entry]})});const summary=f.page.locator('.visual-verification-record-details > summary');await summary.focus();await summary.press('Enter');await f.state();await expect(summary).toBeFocused();
  for(const width of [1100,700,320]){
   await f.page.setViewportSize({width,height:1100});for(const region of [f.panel(),f.history()]){await region.scrollIntoViewIfNeeded();const geometry=await region.evaluate(node=>{const rect=node.getBoundingClientRect();return {overflow:node.scrollWidth>node.clientWidth+1,page:document.documentElement.scrollWidth>innerWidth,inside:[...node.querySelectorAll('select,button,summary')].every(item=>{const box=item.getBoundingClientRect();return box.width===0 || box.left>=rect.left-1&&box.right<=rect.right+1;})};});assert.equal(geometry.overflow,false,theme+' '+width+' region');assert.equal(geometry.page,false,theme+' '+width+' page');assert.equal(geometry.inside,true,theme+' '+width+' controls');}
  }
  await f.page.screenshot({path:join(root,'desktop/tests/artifacts/visual-verification-'+theme+'-narrow.png'),fullPage:true});await f.page.setViewportSize({width:1100,height:1700});await f.page.screenshot({path:join(root,'desktop/tests/artifacts/visual-verification-'+theme+'.png'),fullPage:true});
 }
});
