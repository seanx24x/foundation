import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, symlink, realpath, rm, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { foundationRuntime } from '../../runtime/vite-plugin.mjs';
import { createConnectedRuntime, loopbackRuntimeURL } from '../src/connected-runtime.mjs';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const wait=async(check,label,timeout=8000)=>{const end=Date.now()+timeout;while(Date.now()<end){const result=await check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,60));}throw new Error(`Timed out: ${label}`);};
async function fixture(name) {
 const root=await realpath(await mkdtemp('/private/tmp/foundation-connected-'));
 await cp(path.join(repo,'fixtures',name),root,{recursive:true});
 const config=path.join(root,'vite.config.mjs');
 const configSource=(await readFile(config,'utf8')).replace('../../desktop/runtime/vite-plugin.mjs',path.join(repo,'desktop/runtime/vite-plugin.mjs'));
 // Dependencies are shared through a symlink; optimizer output belongs to this fixture.
 assert.match(configSource,/defineConfig\(\{/);
 await writeFile(config,configSource.replace('defineConfig({',`defineConfig({ cacheDir:${JSON.stringify(path.join(root,'.vite-cache'))},`));
 await symlink(path.join(repo,'node_modules'),path.join(root,'node_modules'),'dir');
 return root;
}

test('connected runtime accepts only explicit local target addresses',()=>{
 assert.equal(loopbackRuntimeURL('http://localhost:5173/path').href,'http://127.0.0.1:5173/path');
 for(const url of ['https://example.com:443','http://0.0.0.0:5173','http://example.com:5173','http://127.0.0.1','http://user:secret@127.0.0.1:5173','http://127.0.0.1:5173/?token=secret','file:///etc/passwd'])assert.throws(()=>loopbackRuntimeURL(url));
});

test('connected Vite runtime maps JSX, observes real requests, and preserves external process ownership',async t=>{
 const root=await fixture('connected-web'),states=[];
 const runtime=createConnectedRuntime({root,onChange:state=>states.push(state),pollMs:80});
 let detached,wrong,browser;
 t.after(async()=>{await wrong?.dispose();await detached?.dispose();await runtime.dispose();await browser?.close();await rm(root,{recursive:true,force:true});});
 const targets=await runtime.discover();assert.equal(targets.length,1);assert.equal(targets[0].instrumented,true);assert.equal(targets[0].available,true);
 const started=await runtime.start();assert.equal(started.status,'connected');assert.equal(started.owned,true);assert.match(started.session,/^[a-f0-9]{32}$/);
 const handshake=await (await fetch(new URL('/__foundation/handshake',started.url))).json();
 assert.equal(handshake.root,root);assert.equal('token' in runtime.snapshot(),false);
 const endpoint=new URL('/__foundation/events',started.url);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:started.session,type:'ready'})})).status,403);
 assert.equal((await fetch(new URL('/__foundation/handshake',started.url),{headers:{Origin:'https://unrelated.example'}})).status,403);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Foundation-Token':handshake.token},body:JSON.stringify({session:'old-session',type:'ready'})})).status,409);
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1080,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(started.url);await expect(page.getByRole('button',{name:'Save changes',exact:true})).toBeVisible();
 await wait(()=>runtime.snapshot().pageConnected,'page connected');
 await page.evaluate(session=>window.postMessage({type:'foundation-runtime-control',session,inspect:true},location.origin),started.session);
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 const selected=await wait(()=>runtime.snapshot().selection?.path==='src/components/SaveButton.tsx'&&runtime.snapshot(),'mapped SaveButton');
 assert.equal(selected.selection.mapping,'resolved');assert.equal(selected.selectionVersion,1);assert.ok(selected.selection.rect.width>0);
 assert.equal(selected.selection.revision,createHash('sha256').update(await readFile(path.join(root,selected.selection.path))).digest('hex'));
 assert.equal(selected.observations.length,0,'Inspect selects without submitting');
 await page.setViewportSize({width:800,height:900});await wait(()=>runtime.snapshot().selection?.rect.width>0,'measure after resize');
 assert.equal(runtime.snapshot().selectionVersion,1,'measurement does not become explicit source selection');
 await page.evaluate(session=>window.postMessage({type:'foundation-runtime-control',session,inspect:false},location.origin),started.session);
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await wait(()=>runtime.snapshot().observations.some(item=>item.status===200),'successful observed request');
 await page.getByRole('combobox',{name:'Request scenario'}).selectOption('failure');
 await page.getByRole('button',{name:/Save changes|Changes saved/}).click();
 await wait(()=>runtime.snapshot().observations.some(item=>item.status===503),'observed HTTP failure');
 await page.getByRole('combobox',{name:'Request scenario'}).selectOption('slow');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await wait(()=>runtime.snapshot().observations.some(item=>item.durationMs>=1200),'observed latency');
 await page.getByRole('combobox',{name:'Request scenario'}).selectOption('offline');
 await page.getByRole('button',{name:/Save changes|Changes saved/}).click();
 await wait(()=>runtime.snapshot().observations.some(item=>item.outcome==='network-error'),'observed network failure');
 const observations=runtime.snapshot().observations;
 assert.ok(observations.every(item=>item.correlation==='unattributed'&&!item.url.includes('?')&&!('headers' in item)&&!('body' in item)));
 assert.ok(observations.every(item=>item.session===started.session));
 await page.evaluate(()=>new Promise(resolve=>{const request=new XMLHttpRequest();request.open('POST','/api/ping?secret=excluded');request.addEventListener('loadend',resolve);request.send('{}');}));
 await wait(()=>runtime.snapshot().observations.some(item=>item.url.endsWith('/api/ping')&&item.timing==='response-complete'),'XHR capture');
 const otherPage=await browser.newPage();await otherPage.goto(started.targetUrl);
 await otherPage.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(otherPage.getByRole('button',{name:'Changes saved',exact:true})).toBeVisible();
 assert.equal(runtime.snapshot().observations.length,observations.length+1,'other browser views cannot add editor observations');
 await otherPage.close();
 const savePath=path.join(root,'src/components/SaveButton.tsx'),before=await readFile(savePath,'utf8');
 await writeFile(savePath,before.replace('Save changes','Save profile'));
 await expect(page.getByRole('button',{name:'Save profile',exact:true})).toBeVisible();
 await page.setViewportSize({width:900,height:900});
 await wait(()=>runtime.snapshot().selection?.stale===true||runtime.snapshot().selection===null,'stale mapping on HMR');
 await new Promise(resolve=>setTimeout(resolve,250));
 assert.ok(runtime.snapshot().selection===null||runtime.snapshot().selection.stale,'post-HMR measurements cannot silently refresh source evidence');
 assert.equal(runtime.snapshot().selectionVersion,1,'HMR does not steal source focus');
 await expect(page.getByRole('button',{name:'Save profile',exact:true})).toBeVisible();
 await page.evaluate(session=>window.postMessage({type:'foundation-runtime-control',session,inspect:true},location.origin),started.session);
 await page.getByRole('button',{name:'Save profile',exact:true}).click();
 await wait(()=>runtime.snapshot().selectionVersion===2&&!runtime.snapshot().selection.stale,'explicit remapping after HMR');
 wrong=createConnectedRuntime({root:repo});await assert.rejects(()=>wrong.connect(started.targetUrl),/different project/);
 detached=createConnectedRuntime({root,pollMs:80});await detached.connect(started.targetUrl);assert.equal(detached.snapshot().owned,false);
 assert.notEqual(detached.snapshot().viewId,started.viewId);assert.equal(detached.snapshot().session,started.session);assert.equal(detached.snapshot().observations.length,0);
 const otherView=await browser.newPage();await otherView.goto(detached.snapshot().url);
 await otherView.getByRole('button',{name:'Save profile',exact:true}).click();
 await wait(()=>detached.snapshot().observations.length===1,'separate attached view');
 assert.ok(!runtime.snapshot().observations.some(item=>item.id===detached.snapshot().observations[0].id),'observation IDs are unique across views');
 await otherView.close();await detached.stop();
 assert.equal((await fetch(started.url)).status,200,'detaching does not stop externally owned target');
 assert.equal(errors.length,0,errors.join('\n'));
 await runtime.stop();assert.equal(runtime.snapshot().status,'idle');await assert.rejects(()=>fetch(started.url));
 assert.ok(states.some(state=>state.status==='starting'));
});

test('a second fixture establishes adapter behavior without Orbit assumptions',async t=>{
 const root=await fixture('connected-secondary');const runtime=createConnectedRuntime({root,pollMs:80});let browser;
 t.after(async()=>{await runtime.dispose();await browser?.close();await rm(root,{recursive:true,force:true});});
 const state=await runtime.start();browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(state.url);
 await page.getByRole('button',{name:'Send ping'}).click();await expect(page.getByRole('status')).toHaveText('Connected');
 await wait(()=>runtime.snapshot().observations.length===1,'second fixture request');
 assert.equal(runtime.snapshot().observations[0].url,new URL('/api/ping',state.url).href);
 await page.evaluate(session=>window.postMessage({type:'foundation-runtime-control',session,inspect:true},location.origin),state.session);
 await page.getByRole('button',{name:'Send ping'}).click();await wait(()=>runtime.snapshot().selection?.path==='src/App.tsx','second fixture selection');
});

test('discovery is read-only and missing instrumentation is an explicit setup state',async t=>{
 const root=await fixture('connected-secondary');t.after(()=>rm(root,{recursive:true,force:true}));
 const config=path.join(root,'vite.config.mjs');await writeFile(config,"export default {server:{host:'127.0.0.1'}};\n");
 const before=await readFile(config,'utf8'),runtime=createConnectedRuntime({root});t.after(()=>runtime.dispose());
 const targets=await runtime.discover();assert.equal(targets[0].instrumented,false);await assert.rejects(()=>runtime.start(),/development plugin/);assert.equal(await readFile(config,'utf8'),before);
});

test('stop wins over a target start that has not launched its process yet',async t=>{
 const root=await fixture('connected-secondary');let runtime;
 runtime=createConnectedRuntime({root,onChange:state=>{if(state.status==='starting')void runtime.stop();}});
 t.after(async()=>{await runtime.dispose();await rm(root,{recursive:true,force:true});});
 await runtime.start();assert.equal(runtime.snapshot().status,'idle');assert.equal(runtime.snapshot().owned,false);assert.equal(runtime.snapshot().url,undefined);
});

test('runtime attachment refuses redirects and does not follow them to another origin',async t=>{
 let reached=0;const destination=createServer((_request,response)=>{reached++;response.end('{}');});
 await new Promise(resolve=>destination.listen(0,'127.0.0.1',resolve));
 const redirect=createServer((_request,response)=>{response.writeHead(302,{Location:`http://127.0.0.1:${destination.address().port}/`}).end();});
 await new Promise(resolve=>redirect.listen(0,'127.0.0.1',resolve));
 const runtime=createConnectedRuntime({root:repo});
 t.after(async()=>{await runtime.dispose();await new Promise(resolve=>redirect.close(resolve));await new Promise(resolve=>destination.close(resolve));});
 await assert.rejects(()=>runtime.connect(`http://127.0.0.1:${redirect.address().port}`));assert.equal(reached,0);assert.equal(runtime.snapshot().status,'error');
});

test('production builds contain neither instrumentation nor a runtime session token',async t=>{
 const root=await fixture('connected-secondary');t.after(()=>rm(root,{recursive:true,force:true}));
 const token='f'.repeat(64);
 await promisify(execFile)(process.execPath,[path.join(repo,'node_modules/vite/bin/vite.js'),'build'],{cwd:root,env:{...process.env,FOUNDATION_RUNTIME_TOKEN:token},timeout:20000});
 const index=await readFile(path.join(root,'dist/index.html'),'utf8');assert.doesNotMatch(index,/__foundation|data-foundation-node/);
 for(const name of await readdir(path.join(root,'dist/assets'))){const asset=await readFile(path.join(root,'dist/assets',name),'utf8');assert.equal(asset.includes(token),false);assert.equal(asset.includes('__foundationRuntimeInstalled'),false);assert.equal(asset.includes('data-foundation-node'),false);}
});

// Decode mappings independently from the transform's encoder. This checks that
// breakpoints after inserted JSX attributes still reach the original source.
test('development instrumentation preserves exact source-map positions',async t=>{
 const root=await fixture('connected-secondary');t.after(()=>rm(root,{recursive:true,force:true}));
 const file=path.join(root,'src/App.tsx');
 const source='export const A = () => (\n  <button title="é" onClick={() => 42}>Save</button>\n);\n';
 await writeFile(file,source);const plugin=foundationRuntime();plugin.configResolved({root,server:{host:'127.0.0.1'}});
 const transformed=plugin.transform(source,file);assert.equal(transformed.map.sourcesContent[0],source);
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let originalLine=0,originalColumn=0;
 const decoded=transformed.map.mappings.split(';').map(line=>{let generated=0;return line.split(',').filter(Boolean).map(segment=>{
   const values=[];let value=0,shift=0;for(const character of segment){const digit=alphabet.indexOf(character);value+=(digit&31)*2**shift;if(digit&32){shift+=5;}else{values.push(value&1?-(value>>1):value>>1);value=0;shift=0;}}
   generated+=values[0];originalLine+=values[2];originalColumn+=values[3];return {generated,line:originalLine,column:originalColumn};
 });});
 for(const token of ['title','onClick','42','Save','</button>']){const generatedColumn=transformed.code.split('\n')[1].indexOf(token),original=source.split('\n')[1].indexOf(token);
   assert.deepEqual(decoded[1].find(item=>item.generated===generatedColumn),{generated:generatedColumn,line:1,column:original});}
});

test('screen navigation rotates view without replacing the owned server and tracks actual SPA/reload identity',async t=>{
 const root=await fixture('connected-secondary'),runtime=createConnectedRuntime({root,pollMs:60});let browser;
 t.after(async()=>{await runtime.dispose();await browser?.close();await rm(root,{recursive:true,force:true});});
 const started=await runtime.start();browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(started.url);
 await wait(()=>runtime.snapshot().pageConnected&&runtime.snapshot().documentId,'initial actual document');
 const initial=runtime.snapshot();assert.equal(initial.capabilities.routeTracking,true);assert.equal(initial.pagePath,'/');assert.match(initial.documentId,/^[a-f0-9]{32}$/);assert.equal(initial.pageVersion,1);
 await page.getByRole('button',{name:'Send ping'}).click();await wait(()=>runtime.snapshot().observations.length===1,'initial request');assert.equal(runtime.snapshot().observations[0].documentId,initial.documentId);
 const navigated=await runtime.navigate('/settings/profile');assert.equal(navigated.owned,true);assert.equal(navigated.session,started.session);assert.notEqual(navigated.viewId,started.viewId);
 assert.equal(new URL(navigated.url).origin,new URL(started.url).origin);assert.equal(new URL(navigated.url).pathname,'/settings/profile');assert.equal(navigated.pageConnected,false);assert.equal(navigated.documentId,null);assert.deepEqual(navigated.observations,[]);
 await page.goto(navigated.url);await wait(()=>runtime.snapshot().pageConnected&&runtime.snapshot().pagePath==='/settings/profile','requested route is actually observed');
 const initialPageVersion=runtime.snapshot().pageVersion;
 const firstDocument=runtime.snapshot().documentId;assert.notEqual(firstDocument,initial.documentId);
 await page.getByRole('button',{name:'Send ping'}).click();await wait(()=>runtime.snapshot().observations.length===1,'request on screen');
 await page.evaluate(()=>history.pushState({},'', '/settings/security'));
 await wait(()=>runtime.snapshot().pagePath==='/settings/security','SPA path change');assert.equal(runtime.snapshot().documentId,firstDocument);assert.deepEqual(runtime.snapshot().observations,[],'a different pathname cannot retain prior-route requests');
 await page.evaluate(()=>history.replaceState({},'', '/settings/profile'));
 await wait(()=>runtime.snapshot().pagePath==='/settings/profile','SPA replacement');
 assert.ok(runtime.snapshot().pageVersion>=initialPageVersion+2);
 const beforeRoundTrip=runtime.snapshot().pageVersion;
 await page.evaluate(()=>{history.pushState({},'', '/settings/other');history.replaceState({},'', '/settings/profile');});
 await wait(()=>runtime.snapshot().pageVersion>=beforeRoundTrip+2&&runtime.snapshot().pagePath==='/settings/profile','rapid round-trip navigation remains observable');
 assert.equal(runtime.snapshot().documentId,firstDocument);
 const beforeReload=runtime.snapshot().pageVersion;
 await page.reload();await wait(()=>runtime.snapshot().documentId&&runtime.snapshot().documentId!==firstDocument&&runtime.snapshot().pageConnected,'reload document identity');
 const reloaded=runtime.snapshot();assert.equal(reloaded.viewId,navigated.viewId);assert.equal(reloaded.pagePath,'/settings/profile');assert.ok(reloaded.pageVersion>beforeReload);
 const handshake=await(await fetch(new URL('/__foundation/handshake',reloaded.url),{headers:{'X-Foundation-View':reloaded.viewId}})).json();
 const stale=await fetch(new URL('/__foundation/events',reloaded.url),{method:'POST',headers:{'Content-Type':'application/json','X-Foundation-Token':handshake.token},body:JSON.stringify({session:reloaded.session,viewId:reloaded.viewId,documentId:firstDocument,type:'ready',pagePath:'/late-old-page',pageSequence:1})});
 assert.equal(stale.status,409);assert.equal(runtime.snapshot().documentId,reloaded.documentId);
 const event=(pageSequence,pagePath)=>fetch(new URL('/__foundation/events',reloaded.url),{method:'POST',headers:{'Content-Type':'application/json','X-Foundation-Token':handshake.token},body:JSON.stringify({session:reloaded.session,viewId:reloaded.viewId,documentId:reloaded.documentId,type:'ready',pagePath,pageSequence})});
 assert.equal((await event(3,'/settings/profile')).status,202);
 await wait(()=>runtime.snapshot().pageVersion===reloaded.pageVersion+2,'a later same-path update preserves missed transitions');
 assert.equal((await event(2,'/late-out-of-order')).status,409);
 assert.equal((await event(3,'/same-sequence-wrong-path')).status,409);
 assert.equal(runtime.snapshot().pagePath,'/settings/profile');
 const delayedEvent=(type,pageSequence)=>fetch(new URL('/__foundation/events',reloaded.url),{method:'POST',headers:{'Content-Type':'application/json','X-Foundation-Token':handshake.token},body:JSON.stringify({session:reloaded.session,viewId:reloaded.viewId,documentId:reloaded.documentId,type,pageSequence,explicit:true,selection:null})});
 const selectionVersion=runtime.snapshot().selectionVersion;
 assert.equal((await delayedEvent('selection',2)).status,409,'a delayed selection cannot acquire focus on the new route');
 assert.equal((await delayedEvent('pagehide',2)).status,409,'a delayed pagehide cannot disconnect the new route');
 assert.equal(runtime.snapshot().selectionVersion,selectionVersion);assert.equal(runtime.snapshot().pageConnected,true);
 assert.equal((await delayedEvent('selection',3)).status,202);
 await wait(()=>runtime.snapshot().selectionVersion===selectionVersion+1,'the current route accepts an explicit selection');
 for(const route of ['//outside.example','/../other','/path?secret=1','/%2foutside'])await assert.rejects(runtime.navigate(route),{code:'runtime-route-invalid'});
 assert.equal(runtime.snapshot().status,'connected');assert.equal(runtime.snapshot().viewId,reloaded.viewId);
 await runtime.stop();await assert.rejects(()=>fetch(reloaded.targetUrl));
});

test('a newer document owns its view and stale pages cannot overwrite its route or request evidence',async t=>{
 const root=await fixture('connected-secondary'),runtime=createConnectedRuntime({root,pollMs:60});let browser;
 t.after(async()=>{await runtime.dispose();await browser?.close();await rm(root,{recursive:true,force:true});});
 const state=await runtime.start();browser=await chromium.launch({headless:true});const older=await browser.newPage(),newer=await browser.newPage();
 await older.goto(state.url);await wait(()=>runtime.snapshot().pageConnected,'older document');const oldId=runtime.snapshot().documentId;
 await newer.goto(state.url);await wait(()=>runtime.snapshot().documentId!==oldId&&runtime.snapshot().pageConnected,'newer document');const newId=runtime.snapshot().documentId;
 await older.evaluate(()=>history.pushState({},'', '/older-route'));
 await older.getByRole('button',{name:'Send ping'}).click();await expect(older.getByRole('status')).toHaveText('Connected');
 await newer.getByRole('button',{name:'Send ping'}).click();await wait(()=>runtime.snapshot().observations.length===1,'only current document request');
 assert.equal(runtime.snapshot().pagePath,'/');assert.equal(runtime.snapshot().documentId,newId);assert.equal(runtime.snapshot().observations[0].documentId,newId);
 // Hard browser teardown may drop keepalive events. Exercise the actual client
 // handler while its response remains observable; lease expiry has a separate test.
 const pagehide=async(page,status)=>{
  const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/__foundation/events'&&response.request().postDataJSON()?.type==='pagehide');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal((await response).status(),status);
 };
 await pagehide(older,409);await older.close();assert.equal(runtime.snapshot().pageConnected,true,'acknowledged old-page shutdown cannot disconnect the current document');
 await pagehide(newer,202);await wait(()=>runtime.snapshot().pageConnected===false,'acknowledged current document shutdown');await newer.close();
});


test('the production page lease expires at eight seconds when pagehide is lost',async t=>{
 const root=await realpath(await mkdtemp('/private/tmp/foundation-runtime-lease-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 let time=Date.now();t.mock.method(Date,'now',()=>time);
 const plugin=foundationRuntime();plugin.configResolved({root,server:{host:'127.0.0.1'}});
 let middleware;plugin.configureServer({middlewares:{use:handler=>{middleware=handler;}}});
 const server=createServer((request,response)=>{void middleware(request,response,()=>response.writeHead(404).end());});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const base=`http://127.0.0.1:${server.address().port}`,viewId='a'.repeat(32),documentId='b'.repeat(32);
 const handshake=await(await fetch(base+'/__foundation/handshake',{headers:{'X-Foundation-View':viewId}})).json();
 const headers={'X-Foundation-View':viewId,'X-Foundation-Token':handshake.token};
 const snapshot=async()=>{const response=await fetch(base+'/__foundation/snapshot',{headers});assert.equal(response.status,200);return response.json();};
 const ready=()=>fetch(base+'/__foundation/events',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({session:handshake.session,viewId,documentId,type:'ready',pagePath:'/',pageSequence:1})});
 assert.equal((await ready()).status,202);const initial=await snapshot();assert.equal(initial.pageConnected,true);
 time+=7999;assert.equal((await snapshot()).pageConnected,true);
 time+=1;const expired=await snapshot();assert.equal(expired.pageConnected,false);assert.equal(expired.documentId,documentId);assert.equal(expired.version,initial.version,'lease expiry is observed even when source/event version does not change');
 assert.equal((await ready()).status,202);assert.equal((await snapshot()).pageConnected,true,'a fresh heartbeat renews an expired lease');
 time+=8000;assert.equal((await snapshot()).pageConnected,false);
});

test('older instrumentation remains connected with screen tracking explicitly unavailable',async t=>{
 const root=await fixture('connected-secondary'),session='a'.repeat(32),token='b'.repeat(64);
 const server=createServer((request,response)=>{response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({protocol:1,root,session,token,viewId:request.headers['x-foundation-view'],version:0,selectionVersion:0,selection:null,observations:[],files:[],pageConnected:true,capabilities:{sourceMapping:'instrumented',requests:true,screenshots:false}}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const runtime=createConnectedRuntime({root});
 t.after(async()=>{await runtime.dispose();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
 await runtime.connect(`http://127.0.0.1:${server.address().port}/`);assert.equal(runtime.snapshot().status,'connected');assert.equal(runtime.snapshot().capabilities.routeTracking,false);assert.equal(runtime.snapshot().pagePath,null);assert.equal(runtime.snapshot().documentId,null);
 await assert.rejects(runtime.navigate('/profile'),/Update the Foundation development plugin/);assert.equal(runtime.snapshot().status,'connected');
});

test('Stop supersedes an in-flight route navigation without starting or leaking a process',async t=>{
 const root=await fixture('connected-secondary');let stopOnNavigate=false,runtime;
 runtime=createConnectedRuntime({root,onChange:state=>{if(stopOnNavigate&&state.status==='connecting')void runtime.stop();}});
 t.after(async()=>{await runtime.dispose();await rm(root,{recursive:true,force:true});});
 const started=await runtime.start();stopOnNavigate=true;await runtime.navigate('/profile');await wait(()=>runtime.snapshot().status==='idle','navigation cancelled by Stop');
 assert.equal(runtime.snapshot().owned,false);assert.equal(runtime.snapshot().url,undefined);await assert.rejects(()=>fetch(started.targetUrl));
});
