import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';

const root=fileURLToPath(new URL('../../',import.meta.url));
const stamp=minute=>`2026-10-29T00:${String(minute).padStart(2,'0')}:00.000Z`;
const file={path:'src/SaveButton.tsx',source:'export const SaveButton = () => <button>Save</button>;',revision:'a'.repeat(64),language:'typescriptreact',analysis:{symbols:[],imports:[],consumers:[],requests:[]}};
const api={...file,path:'src/api/profile.ts',source:'export const saveProfile = () => fetch("/api/profile");',revision:'b'.repeat(64)};
const project={id:'comparison-fixture',name:'Observation comparison fixture',root:'/fixture',files:[{path:file.path},{path:api.path}]};
const feature={id:'save',title:'Save profile',brief:'Make saving clear and recoverable.',paths:[file.path,api.path],entryPath:file.path,archived:false,createdAt:stamp(0),updatedAt:stamp(0)};
const features={schemaVersion:1,projectId:project.id,revision:1,activeId:feature.id,features:[feature],storage:{status:'saved'}};
const screen={id:'profile-screen',featureId:feature.id,title:'Profile',targetId:'vite:dev',route:'/profile',archived:false,createdAt:stamp(0),updatedAt:stamp(0)};
const scenario={id:'save-success',screenId:screen.id,title:'Save succeeds',steps:['Edit the display name.','Choose Save.'],expectedOutcome:'The saved message appears.',archived:false,createdAt:stamp(0),updatedAt:stamp(0)};
const runtimeEvidence={targetId:screen.targetId,route:screen.route,session:'1'.repeat(32),viewId:'2'.repeat(32),documentId:'3'.repeat(32),pageVersion:1};
const request={id:`${runtimeEvidence.session}:${runtimeEvidence.viewId}:1`,session:runtimeEvidence.session,documentId:runtimeEvidence.documentId,kind:'request',method:'POST',url:'http://127.0.0.1:5173/api/profile',status:200,durationMs:12.5,outcome:'success',observedAt:stamp(2),timing:'response-headers',correlation:'unattributed'};
const run={id:'run-baseline',feature:{id:feature.id,title:feature.title,revision:1,paths:feature.paths},screen,scenario,definitionRevision:2,runtime:runtimeEvidence,sources:[{path:file.path,revision:file.revision},{path:api.path,revision:api.revision}],dirtyPaths:[],startedAt:stamp(1),endedAt:stamp(3),status:'completed',assessment:'matched',note:'The confirmation appeared after saving.',observations:[request],truncated:false};
const after={...run,id:'run-comparison',scenario:{...scenario,id:'save-failure',title:'Recover from a failed save',steps:['Disconnect the network.','Choose Save.','Try again.'],expectedOutcome:'The error remains visible until a successful retry.'},sources:[{path:file.path,revision:'c'.repeat(64)},{path:api.path,revision:api.revision}],startedAt:stamp(4),endedAt:stamp(6),status:'interrupted',assessment:'not-assessed',note:'The runtime disconnected before retry.',interruption:'Runtime disconnected.',dirtyPaths:[api.path],observations:[{...request,id:`${runtimeEvidence.session}:${runtimeEvidence.viewId}:2`,status:null,outcome:'network-error',observedAt:stamp(5),timing:'response-complete',durationMs:41.25}],truncated:true};
const workspace={schemaVersion:1,projectId:project.id,revision:3,activeScreenId:screen.id,activeScenarioId:scenario.id,screens:[screen],scenarios:[scenario,after.scenario],runs:[run,after],storage:{status:'saved'},runFreshness:[{id:run.id,status:'current',reason:'Saved source matches.'},{id:after.id,status:'stale',reason:'Source changed after this observation.'}]};
const history={schemaVersion:1,projectId:project.id,revision:1,activeId:null,storage:{status:'saved'},conversations:[]};
const pair=(extra={})=>({version:1,projectId:project.id,featureId:feature.id,beforeId:run.id,afterId:after.id,...extra});

const conditions={viewportWidthCss:640,viewportHeightCss:360,deviceScaleFactor:1,scrollXCss:0,scrollYCss:0,canvasScale:1,colorSchemePreference:'light',reducedMotionPreference:'no-preference',appTheme:'unknown',dataState:'unknown',animationState:'unknown'};
const capture=(run,id,extra={})=>({id,runId:run.id,featureId:run.feature.id,screenId:run.screen.id,scenarioId:run.scenario.id,capturedAt:run.endedAt,binding:{startedAt:run.startedAt,definitionRevision:run.definitionRevision,runtime:run.runtime,sources:run.sources,dirtyPaths:run.dirtyPaths},image:{assetId:id,sha256:'e'.repeat(64),byteLength:4000,widthPx:640,heightPx:360,mimeType:'image/png'},conditions,sourceRelationship:'unverified',imageStatus:'not-loaded',...extra});
const firstCapture=capture(run,'11111111-1111-4111-8111-111111111111');
const secondCapture=capture(after,'22222222-2222-4222-8222-222222222222',{conditions:{...conditions,viewportWidthCss:390,viewportHeightCss:680,deviceScaleFactor:2,scrollYCss:120,canvasScale:.75,colorSchemePreference:'dark',reducedMotionPreference:'reduce'}});
const captures={schemaVersion:1,projectId:project.id,revision:2,captures:[firstCapture,secondCapture],storage:{status:'saved'},available:true};

async function fixture(t,{persisted={},theme='dark',width=1100,runtimeCaptures=captures,autoImages=true}={}){
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/theme.css'){const theme=JSON.parse(await readFile(join(root,`desktop/extension/themes/foundation-${url.searchParams.get('theme')==='light'?'light':'dark'}.json`),'utf8'));res.setHeader('Content-Type','text/css');res.end(`:root{${Object.entries(theme.colors).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v};`).join('')}}`);}
  else if(['/webview.js','/webview.css','/workspace-model.js','/artifact-model.js'].includes(url.pathname)||/^\/fonts\/[a-z-]+\.woff2$/.test(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'font/woff2');res.end(await readFile(join(root,'desktop/extension/media',url.pathname.slice(1))));}
  else if(url.pathname==='/project'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><button>Save</button><script>window.frameIdentity=Math.random();window.controls=[];addEventListener("message",event=>{if(event.data?.type==="foundation-runtime-control")controls.push(event.data)})</script>');}
  else {res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/theme.css?theme=${theme}"><link rel="stylesheet" href="/webview.css"></head><body data-foundation-surface="workspace" data-foundation-assistant="external"><div id="foundation-root"></div><script src="/workspace-model.js"></script><script src="/artifact-model.js"></script><script src="/webview.js"></script></body></html>`);}
 }catch(error){res.writeHead(500).end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width,height:1100}}),errors=[];
 const imagePage=await browser.newPage({viewport:{width:640,height:360}});
 await imagePage.setContent('<!doctype html><style>body{margin:0;background:#f8f8f9;font:16px Arial;color:#202025;padding:40px}h1{font-size:24px}input{font:inherit;padding:12px;border:1px solid #ddd;border-radius:6px;width:300px}button{font:inherit;background:#222;color:white;padding:12px 20px;border:0;border-radius:6px;margin-top:20px}</style><h1>Profile</h1><p>Display name</p><input value="Orbit sample"><br><button>Save changes</button>');
 const firstImage=await imagePage.screenshot();await imagePage.locator('button').evaluate(button=>button.textContent='Saved');const secondImage=await imagePage.screenshot();await imagePage.close();
 const images=new Map([[firstCapture.id,firstImage],[secondCapture.id,secondImage]]),imageRequests=[];let lastCaptures;
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const normalize=value=>value&&({...value,captures:Array.isArray(value.captures)?value.captures.map(capture=>{const bytes=images.get(capture?.id);return bytes&&capture.image.sha256==='e'.repeat(64)?{...capture,image:{...capture.image,sha256:hash(bytes),byteLength:bytes.length}}:capture;}):value.captures});
 await page.exposeFunction('__fixtureReadImage',async message=>{imageRequests.push(message);if(autoImages)await reply(message.id);});
 page.on('pageerror',error=>errors.push(error.message));
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[],'renderer has no exceptions');});
 await page.addInitScript(initial=>{window.outbound=[];if(!sessionStorage.getItem('comparison-view'))sessionStorage.setItem('comparison-view',JSON.stringify(initial));window.acquireVsCodeApi=()=>({getState:()=>JSON.parse(sessionStorage.getItem('comparison-view')),setState:value=>sessionStorage.setItem('comparison-view',JSON.stringify(value)),postMessage:value=>{outbound.push(value);if(value.type==='runtimeCaptureImage')void window.__fixtureReadImage(value);}});},persisted);
 const base=`http://127.0.0.1:${server.address().port}`;
 const send=message=>page.evaluate(data=>new Promise(resolve=>{const listener=event=>{if(event.source!==window||event.data?.type!==data.type)return;removeEventListener('message',listener);resolve();};addEventListener('message',listener);postMessage(data,location.origin);}),message);
 const state=overrides=>{lastCaptures=normalize(overrides&&Object.hasOwn(overrides,'runtimeCaptures')?overrides.runtimeCaptures:runtimeCaptures);return send({type:'state',project,activeFile:file,openFiles:[file],dirtyPaths:[],trusted:true,provider:{configured:false},conversations:history,features,featureFiles:[file,api],featureCandidates:[],featureUnavailable:[],changes:[],runtime:{status:'idle',targets:[],observations:[],owned:false},runtimeWorkspace:workspace,...overrides,runtimeCaptures:lastCaptures});};
 const reply=(id,extra={})=>send({type:'runtimeCaptureImage',projectId:project.id,id,imageSha256:lastCaptures?.captures?.find?.(capture=>capture.id===id)?.image.sha256,pngBase64:images.get(id)?.toString('base64'),...extra});
 const open=async()=>{const runtime=page.locator('.feature-runtime-details');if(!await runtime.evaluate(node=>node.open))await runtime.locator(':scope > summary').click();const details=page.locator('.observation-comparison-details');if(!await details.evaluate(node=>node.open))await details.locator(':scope > summary').click();await expect(page.getByRole('combobox',{name:'Baseline observation'})).toBeVisible();};
 const select=async()=>{await page.getByRole('combobox',{name:'Baseline observation'}).selectOption(run.id);await page.getByRole('combobox',{name:'Comparison observation'}).selectOption(after.id);await expect(page.locator('.observation-comparison')).toHaveAttribute('data-comparison-status','ready');};
 const saved=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('comparison-view')));
 const outbound=()=>page.evaluate(()=>structuredClone(window.outbound));
 await page.goto(base);await state();return {page,send,state,open,select,saved,outbound,base,imageRequests,reply,images,hash};
}


test('capture and finish is explicit, active-run bound, unavailable while busy, and preserves the ordinary finish action',async t=>{
 const f=await fixture(t,{runtimeCaptures:{...captures,captures:[]}}),{page}=f;
 const recording={...run,status:'recording',assessment:'not-assessed',note:'',observations:[]};delete recording.endedAt;
 const activeWorkspace={...workspace,runs:[recording],runFreshness:[],activeRun:recording};
 const runtime={status:'connected',session:runtimeEvidence.session,viewId:runtimeEvidence.viewId,documentId:runtimeEvidence.documentId,pageVersion:1,pageConnected:true,pagePath:'/profile',url:f.base+'/project',targetUrl:f.base+'/project',target:{id:screen.targetId,label:'Fixture',instrumented:true,available:true},targets:[],observations:[],owned:false};
 await f.state({runtime,runtimeWorkspace:activeWorkspace});await f.send({type:'scenarioStarted',runId:run.id});await expect(page.locator('iframe[data-foundation-runtime-canvas]')).toHaveCount(1);
 const button=page.getByRole('button',{name:'Capture and finish observation',exact:true});await expect(button).toBeEnabled();await expect(page.getByText('Capture saves only the visible preview locally. Images are not shared with AI.',{exact:true})).toBeVisible();
 const note=page.getByRole('textbox',{name:'Manual observation note'});await note.fill('Keep this exact assessment note.');await page.getByRole('combobox',{name:'Manual observation assessment'}).selectOption('matched');const before=await f.outbound();assert.equal(before.some(message=>message.action==='captureAndFinishRun'),false);
 await button.focus();await button.press('Space');assert.deepEqual((await f.outbound()).at(-1),{type:'runtimeWorkspace',action:'captureAndFinishRun',projectId:project.id,expectedRevision:workspace.revision,id:run.id,assessment:'matched',note:'Keep this exact assessment note.'});
 await f.state({runtime,runtimeWorkspace:{...activeWorkspace,busy:'captureAndFinishRun'}});await expect(button).toBeDisabled();await expect(button).toHaveAttribute('aria-busy','true');await expect(page.getByText('Capturing the visible preview…',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Finish observation',exact:true})).toBeDisabled();await expect(note).toHaveValue('Keep this exact assessment note.');
 await f.state({runtime,runtimeWorkspace:activeWorkspace,runtimeCaptures:{...captures,available:false}});await expect(button).toBeDisabled();await expect(page.getByRole('button',{name:'Finish observation',exact:true})).toBeEnabled();await expect(page.getByText('Visual capture is unavailable in this workspace. You can finish without an image.',{exact:true})).toBeVisible();
 await f.state({runtime,runtimeWorkspace:activeWorkspace});await page.getByRole('button',{name:'Inspect',exact:true}).click();await expect(button).toBeDisabled();await expect(page.getByText('Turn Inspect off before capturing.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Inspect',exact:true}).click();await expect(button).toBeEnabled();
 await f.state({runtime:{...runtime,status:'disconnected'},runtimeWorkspace:activeWorkspace});await expect(button).toBeDisabled();await expect(page.getByRole('button',{name:'Finish observation',exact:true})).toBeEnabled();await f.state({runtime});await expect(button).toHaveCount(0);
 assert.equal((await f.outbound()).filter(message=>message.action==='captureAndFinishRun').length,1,'only the explicit activation submitted a capture');
});


test('verified image bytes become local selected-pair blobs with exact conditions and no source or provider actions',async t=>{
 const f=await fixture(t,{persisted:{observationComparisons:[pair()],question:'Keep the draft',questionProjectId:project.id,questionConversationId:null}}),{page}=f;
 assert.equal(f.imageRequests.length,0);await f.open();const figure=label=>page.getByRole('figure',{name:`${label} visual capture`});await expect(figure('Baseline')).toHaveAttribute('data-capture-status','ready');await expect(figure('Comparison')).toHaveAttribute('data-capture-status','ready');
 const image=figure('Baseline').getByRole('img');await expect(image).toHaveAttribute('src',/^blob:/);await expect(image).toHaveAttribute('alt',`Baseline pixel capture of ${screen.title} — ${scenario.title}`);const oldURL=await image.getAttribute('src');
 await expect(page.getByText('Captures stay local and are not shared with AI. Their relationship to saved source is unverified. Application theme, data, and animation state are unknown.',{exact:true})).toBeVisible();await expect(page.getByText('Capture conditions differ. Inspect viewport, scale, scroll, and media preferences before comparing the images.',{exact:true})).toBeVisible();
 await figure('Baseline').getByText('Capture details',{exact:true}).click();await expect(figure('Baseline').locator('.runtime-capture-facts')).toContainText('640 × 360 CSS px');await expect(figure('Baseline').locator('.runtime-capture-facts')).toContainText('Unverified');
 const section=page.getByRole('region',{name:'Observation comparison'});await section.getByText('Capture conditions',{exact:true}).click();await expect(section.locator('[data-capture-condition="Viewport"]')).toContainText('Different');await expect(section.locator('[data-capture-condition="Viewport"]')).toContainText('390 × 680 CSS px');await expect(section.locator('[data-capture-condition="Scroll"]')).toContainText('0, 120 CSS px');await expect(section.locator('[data-capture-condition="Application theme"]')).toContainText('Unknown');
 await page.getByRole('button',{name:'Swap observations',exact:true}).click();await expect(figure('Baseline')).toHaveAttribute('data-capture-status','ready');assert.equal(await page.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},oldURL),true,'the old pair blob is revoked');
 const messages=await f.outbound();assert.ok(messages.every(message=>['ready','runtimeCaptureImage'].includes(message.type)));assert.equal(f.imageRequests.length,4,'each selected pair has only two image reads');const saved=JSON.stringify(await f.saved());assert.equal(saved.includes('blob:'),false);assert.equal(saved.includes('pngBase64'),false);assert.equal(saved.includes('imageUri'),false);assert.equal((await f.saved()).question,'Keep the draft');
 await page.reload();await f.state();await f.open();await expect(figure('Baseline')).toHaveAttribute('data-capture-status','ready');assert.equal(f.imageRequests.length,6,'reload asks for selected assets instead of persisting bytes');
});

test('pending responses bind project, selected capture and SHA, remain bounded and retire on Clear',async t=>{
 const f=await fixture(t,{autoImages:false,persisted:{observationComparisons:[pair()]}}),{page}=f;await f.open();const figure=()=>page.getByRole('figure',{name:'Baseline visual capture'});
 assert.deepEqual(f.imageRequests,[{type:'runtimeCaptureImage',projectId:project.id,id:firstCapture.id},{type:'runtimeCaptureImage',projectId:project.id,id:secondCapture.id}]);for(let n=0;n<3;n++)await f.state();assert.equal(f.imageRequests.length,2);
 await f.reply(firstCapture.id,{projectId:'foreign'});await f.reply(firstCapture.id,{id:'foreign-id'});await f.reply(firstCapture.id,{imageSha256:'f'.repeat(64)});await expect(figure()).toHaveAttribute('data-capture-status','loading');await expect(figure().getByRole('img')).toHaveCount(0);
 await page.evaluate(()=>{const original=crypto.subtle.digest.bind(crypto.subtle);window.captureDigestGates=[];window.restoreCaptureDigest=()=>{crypto.subtle.digest=original;};crypto.subtle.digest=(...args)=>new Promise((resolve,reject)=>window.captureDigestGates.push(()=>original(...args).then(resolve,reject)));});
 await Promise.all([f.reply(firstCapture.id),f.reply(firstCapture.id)]);assert.equal(await page.evaluate(()=>window.captureDigestGates.length),1,'duplicate replies cannot decode and allocate the same selected asset twice');await page.evaluate(()=>{for(const release of window.captureDigestGates)release();window.restoreCaptureDigest();});await expect(figure()).toHaveAttribute('data-capture-status','ready');const url=await figure().getByRole('img').getAttribute('src');await page.getByRole('button',{name:'Clear comparison',exact:true}).click();await f.reply(secondCapture.id);await expect(page.locator('.runtime-capture-image')).toHaveCount(0);assert.equal(await page.evaluate(async uri=>{try{await fetch(uri);return false;}catch{return true;}},url),true);
 await f.select();assert.equal(f.imageRequests.length,4);await f.reply(firstCapture.id,{error:'Saved image could not be verified.'});await expect(figure()).toHaveAttribute('data-capture-status','unavailable');await f.state();assert.equal(f.imageRequests.length,4,'ready and error responses never automatically re-request');
});

test('invalid base64, dimensions, digests and image decoding fail without another read or a replacement image',async t=>{
 const f=await fixture(t,{autoImages:false,persisted:{observationComparisons:[pair()]}}),{page}=f;await f.open();const figure=()=>page.getByRole('figure',{name:'Baseline visual capture'});let reads=2;
 for(const pngBase64 of ['not base64',Buffer.from('not a PNG').toString('base64'),f.images.get(firstCapture.id).toString('base64').slice(0,-4)+'AAAA']){
  await f.reply(firstCapture.id,{pngBase64});await expect(figure()).toHaveAttribute('data-capture-status','unavailable');await expect(figure().getByRole('img')).toHaveCount(0);await f.state();assert.equal(f.imageRequests.length,reads);await page.getByRole('button',{name:'Clear comparison',exact:true}).click();await f.select();reads+=2;
 }
 const corrupted=Buffer.from(f.images.get(firstCapture.id));corrupted[24]=0;const digest=f.hash(corrupted);await f.state({runtimeCaptures:{...captures,captures:[{...firstCapture,image:{...firstCapture.image,sha256:digest,byteLength:corrupted.length}},secondCapture]}});await f.reply(firstCapture.id,{imageSha256:digest,pngBase64:corrupted.toString('base64')});await expect(figure()).toHaveAttribute('data-capture-status','unavailable');await expect(figure().getByRole('img')).toHaveCount(0);
});

test('missing, foreign, duplicate and mismatched capture metadata cannot request image bytes',async t=>{
 const f=await fixture(t,{autoImages:false,persisted:{observationComparisons:[pair()]},runtimeCaptures:{...captures,captures:[]}}),{page}=f;await f.open();const figure=()=>page.getByRole('figure',{name:'Baseline visual capture'});await expect(figure().getByText('No image was saved with this observation.',{exact:true})).toBeVisible();
 for(const snapshot of [{...captures,projectId:'foreign'},{...captures,captures:{invalid:true}},{...captures,captures:[firstCapture,firstCapture]},...[
  {...firstCapture,featureId:'another-feature'},
  {...firstCapture,binding:{...firstCapture.binding,runtime:{...runtimeEvidence,documentId:'9'.repeat(32)}}},
  {...firstCapture,binding:{...firstCapture.binding,sources:[{...file,revision:'f'.repeat(64)},api]}},
  {...firstCapture,conditions:{...conditions,viewportWidthCss:NaN}}
 ].map(capture=>({...captures,captures:[capture]}))]){await f.state({runtimeCaptures:snapshot});await expect(figure()).toHaveAttribute('data-capture-status','unavailable');await expect(figure().getByRole('img')).toHaveCount(0);}
 assert.equal(f.imageRequests.length,0);await f.state({runtimeCaptures:{...captures,captures:[],storage:{status:'unavailable'}}});await expect(page.getByText('Capture storage is unavailable. Existing observations remain readable; some images may be missing.',{exact:true})).toBeVisible();
});

test('capture images fit both themes and narrow panels while conditions remain keyboard accessible',async t=>{
 for(const theme of ['light','dark']){
  const f=await fixture(t,{theme,persisted:{observationComparisons:[pair()]}}),{page}=f;await f.open();await expect(page.getByRole('figure',{name:'Baseline visual capture'})).toHaveAttribute('data-capture-status','ready');const section=page.getByRole('region',{name:'Observation comparison'});
  const details=section.getByText('Capture conditions',{exact:true});await details.focus();await details.press('Enter');await expect(section.locator('[data-capture-condition="Canvas scale"]')).toBeVisible();await f.state();await expect(details).toBeFocused();
  for(const width of [1100,700,390,296]){await page.setViewportSize({width,height:1000});const geometry=await section.evaluate(node=>({pageOverflow:document.documentElement.scrollWidth>innerWidth,overflow:node.scrollWidth>node.clientWidth+1,images:[...node.querySelectorAll('.runtime-capture-image')].every(img=>{const bounds=img.parentElement.getBoundingClientRect(),r=img.getBoundingClientRect();return r.width>0&&r.height>0&&r.right<=bounds.right+1&&r.left>=bounds.left-1&&r.height<=360;})}));assert.equal(geometry.pageOverflow,false,`${theme} ${width} page`);assert.equal(geometry.overflow,false,`${theme} ${width} comparison`);assert.equal(geometry.images,true,`${theme} ${width} images fit`);}
  const folder=join(root,'desktop/tests/artifacts');await mkdir(folder,{recursive:true});await details.click();await page.setViewportSize({width:1100,height:2400});await section.screenshot({path:join(folder,`visual-captures-${theme}.png`)});await page.setViewportSize({width:390,height:4000});await section.screenshot({path:join(folder,`visual-captures-${theme}-narrow.png`)});
 }
});
