import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {foundationRuntime} from '../../runtime/vite-plugin.mjs';
import {createConnectedRuntime} from '../src/connected-runtime.mjs';

const repo=await realpath(fileURLToPath(new URL('../../../',import.meta.url)));
const nonce='e'.repeat(32),view='a'.repeat(32);
const wait=async(check,label,timeout=5000)=>{const end=Date.now()+timeout;while(Date.now()<end){const result=await check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,15));}assert.fail(`Timed out: ${label}`);};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
async function browserFixture(t){
 const plugin=foundationRuntime();plugin.configResolved({root:repo,server:{host:'127.0.0.1'}});let middleware,browser;
 plugin.configureServer({middlewares:{use:value=>middleware=value}});const client=plugin.transformIndexHtml()[0].children,events=[];
 const server=createServer((request,response)=>{if(request.url.startsWith('/__foundation/events')){const chunks=[];request.on('data',chunk=>chunks.push(chunk));response.on('finish',()=>{if(response.statusCode===202)events.push(JSON.parse(Buffer.concat(chunks)));});}void middleware(request,response,()=>response.writeHead(200,{'Content-Type':'text/html'}).end(`<!doctype html><html><body style="margin:0;min-width:2000px;height:3000px"><button>PRIVATE_APP_CONTENT</button><script>window.privateApplicationData='PRIVATE_APPLICATION_STATE';</script><script>${client}</script></body></html>`));});
 await listen(server);t.after(async()=>{await browser?.close();await close(server);});const base=`http://127.0.0.1:${server.address().port}`;
 const handshake=await(await fetch(`${base}/__foundation/handshake`,{headers:{'X-Foundation-View':view}})).json();
 const snapshot=async()=>(await fetch(`${base}/__foundation/snapshot`,{headers:{'X-Foundation-Token':handshake.token,'X-Foundation-View':view}})).json();
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:800,height:600},deviceScaleFactor:2,colorScheme:'light',reducedMotion:'no-preference'}),page=await context.newPage();
 await page.goto(`${base}/profile?__foundation_view=${view}&secret=PRIVATE_QUERY#PRIVATE_HASH`);await wait(async()=>(await snapshot()).pageConnected,'browser ready');
 const witness=(value=nonce)=>page.evaluate(value=>window.__foundationCaptureWitness(value),value);
 const control=data=>page.evaluate(data=>new Promise(resolve=>{const done=event=>{if(event.data?.marker===data.marker){window.removeEventListener('message',done);resolve();}};window.addEventListener('message',done);window.postMessage(data,location.origin);}),{type:'foundation-runtime-control',marker:Math.random().toString(16),...data});
 return {page,context,witness,control,handshake,snapshot,events,base};
}

test('capture witness is an immutable nonce-gated reader with a precise private-data boundary',{timeout:15000},async t=>{
 const h=await browserFixture(t),initial=await h.witness();
 assert.deepEqual(Object.keys(initial).sort(),['nonce','session','viewId','documentId','pageSequence','route','ready','inspect','viewportWidth','viewportHeight','devicePixelRatio','scrollX','scrollY','requestedTheme','observedColorScheme','reducedMotion'].sort());
 assert.equal(initial.nonce,nonce);assert.equal(initial.session,h.handshake.session);assert.equal(initial.viewId,view);assert.match(initial.documentId,/^[a-f0-9]{32}$/);assert.equal(initial.route,'/profile');assert.equal(initial.pageSequence,1);assert.equal(initial.ready,true);assert.equal(initial.inspect,false);
 assert.doesNotMatch(JSON.stringify(initial),/PRIVATE_|token|headers|body|source|privateApplicationData/i);assert.equal(JSON.stringify(initial).includes(h.handshake.token),false);
 for(const invalid of ['',null,42,{},'E'.repeat(32),'a'.repeat(31),'a'.repeat(33)])assert.equal(await h.witness(invalid),null);
 const ownership=await h.page.evaluate(nonce=>{const fn=window.__foundationCaptureWitness,descriptor=Object.getOwnPropertyDescriptor(window,'__foundationCaptureWitness');let replacementRejected=false;try{Object.defineProperty(window,'__foundationCaptureWitness',{value:()=>({forged:true})});}catch{replacementRejected=true;}const result=fn(nonce);result.session='forged';result.route='/forged';return {configurable:descriptor.configurable,writable:descriptor.writable,enumerable:descriptor.enumerable,replacementRejected,same:fn===window.__foundationCaptureWitness,fresh:fn(nonce)};},nonce);
 assert.equal(ownership.configurable,false);assert.equal(ownership.writable,false);assert.equal(ownership.enumerable,false);assert.equal(ownership.replacementRejected,true);assert.equal(ownership.same,true);assert.equal(ownership.fresh.session,initial.session);assert.equal(ownership.fresh.route,'/profile');
 assert.equal(h.events.some(event=>event.nonce===nonce),false,'reading a witness does not publish its nonce as runtime evidence');
});

test('witness measures viewport, scroll and media preferences while Inspect remains explicit',{timeout:15000},async t=>{
 const h=await browserFixture(t);await h.page.evaluate(()=>window.scrollTo(80,140));let current=await h.witness();
 assert.equal(current.viewportWidth,800);assert.equal(current.viewportHeight,600);assert.equal(current.devicePixelRatio,2);assert.equal(current.scrollX,80);assert.equal(current.scrollY,140);assert.equal(current.requestedTheme,'unknown');assert.equal(current.observedColorScheme,'light');assert.equal(current.reducedMotion,false);
 await h.control({session:'f'.repeat(32),inspect:true,theme:'dark'});current=await h.witness();assert.equal(current.inspect,false);assert.equal(current.requestedTheme,'unknown');
 await h.page.evaluate(session=>window.dispatchEvent(new MessageEvent('message',{source:null,data:{type:'foundation-runtime-control',session,inspect:true}})),h.handshake.session);assert.equal((await h.witness()).inspect,false);
 await h.control({session:h.handshake.session,inspect:true,theme:'dark'});current=await h.witness();assert.equal(current.inspect,true);assert.equal(current.requestedTheme,'dark');assert.equal(current.observedColorScheme,'light','requested application treatment is distinct from the media preference');
 await h.control({session:h.handshake.session,inspect:false});await h.page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await h.page.setViewportSize({width:720,height:480});current=await h.witness();assert.equal(current.inspect,false);assert.equal(current.viewportWidth,720);assert.equal(current.viewportHeight,480);assert.equal(current.observedColorScheme,'dark');assert.equal(current.reducedMotion,true);
});

test('route sequence records pathname round trips without exposing queries or conflating document reloads',{timeout:15000},async t=>{
 const h=await browserFixture(t),initial=await h.witness();
 await h.page.evaluate(()=>{history.replaceState({secret:'PRIVATE_HISTORY'},'','/profile?private=PRIVATE_SAME_ROUTE#PRIVATE_HASH');});assert.equal((await h.witness()).pageSequence,1);
 await h.page.evaluate(()=>{history.pushState({},'','/other?private=PRIVATE_OTHER');history.replaceState({},'','/profile#PRIVATE_RETURN');});const roundTrip=await h.witness();assert.equal(roundTrip.pageSequence,3);assert.equal(roundTrip.route,'/profile');assert.equal(roundTrip.documentId,initial.documentId);assert.doesNotMatch(JSON.stringify(roundTrip),/PRIVATE_/);
 await wait(async()=>(await h.snapshot()).pageVersion===3,'server accepts ordered route events');await h.page.reload();await wait(async()=>(await h.snapshot()).documentId!==initial.documentId,'reload document');const reloaded=await h.witness(),server=await h.snapshot();
 assert.equal(reloaded.viewId,view,'view survives removal of its URL query');assert.notEqual(reloaded.documentId,initial.documentId);assert.equal(reloaded.pageSequence,1);assert.ok(server.pageVersion>roundTrip.pageSequence,'server navigation revision is separate from per-document sequence');assert.doesNotMatch(JSON.stringify(h.events),/PRIVATE_SAME_ROUTE|PRIVATE_OTHER|PRIVATE_RETURN|PRIVATE_HISTORY/);
});

async function runtimeFixture(t,{pollMs=60000}={}){
 const states=[],requests=[];let hook;
 const source={session:'a'.repeat(32),documentId:'b'.repeat(32),version:1,pageVersion:1,pagePath:'/profile',pageConnected:true,observations:[]};
 const payload=request=>({protocol:1,root:repo,token:'c'.repeat(64),viewId:request.headers['x-foundation-view'],selectionVersion:0,selection:null,files:[],capabilities:{routeTracking:true},...structuredClone(source)});
 const server=createServer((request,response)=>{requests.push({url:request.url,token:request.headers['x-foundation-token'],viewId:request.headers['x-foundation-view']});const data=payload(request);void(async()=>{const result=request.url==='/__foundation/snapshot'&&hook?await hook(data):data;if(result?.httpStatus){response.writeHead(result.httpStatus).end();return;}response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));})().catch(()=>response.destroy());});
 await listen(server);const base=`http://127.0.0.1:${server.address().port}`,runtime=createConnectedRuntime({root:repo,pollMs,onChange:state=>states.push(state)});
 t.after(async()=>{await runtime.dispose();await close(server);});await runtime.connect(base);
 return {runtime,source,states,requests,base,setHook:value=>hook=value};
}

test('readCurrent fetches fresh sanitized evidence without publishing or mutating normal state',async t=>{
 const h=await runtimeFixture(t),before=h.runtime.snapshot(),published=h.states.length;h.source.version=2;h.source.pageVersion=2;h.source.pagePath='/settings';h.source.observations=[{id:`${h.source.session}:${before.viewId}:1`,session:h.source.session,documentId:h.source.documentId,kind:'request',method:'POST',url:'http://user:PRIVATE_PASSWORD@127.0.0.1:4173/api?token=PRIVATE_QUERY#PRIVATE_HASH',status:200,durationMs:8,outcome:'success',observedAt:new Date().toISOString(),timing:'response-headers',headers:{Authorization:'PRIVATE_HEADER'},body:'PRIVATE_BODY'}];
 const result=await h.runtime.readCurrent();assert.equal(result.version,2);assert.equal(result.pageVersion,2);assert.equal(result.pagePath,'/settings');assert.equal(result.observations.length,1);assert.equal(result.observations[0].url,'http://127.0.0.1:4173/api');assert.equal(result.observations[0].correlation,'unattributed');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|"token"|"headers"|"body"/);assert.deepEqual(h.runtime.snapshot(),before);assert.equal(h.states.length,published);
 result.observations[0].url='changed';assert.deepEqual(h.runtime.snapshot(),before);const request=h.requests.at(-1);assert.equal(request.url,'/__foundation/snapshot');assert.equal(request.token,'c'.repeat(64));assert.equal(request.viewId,before.viewId);
});

test('readCurrent rejects malformed identity or server failure without disconnecting the polling state',async t=>{
 const h=await runtimeFixture(t),before=h.runtime.snapshot(),published=h.states.length;
 for(const change of [data=>({...data,session:'d'.repeat(32)}),data=>({...data,viewId:'e'.repeat(32)}),data=>({...data,version:-1}),()=>({httpStatus:503})]){h.setHook(change);await assert.rejects(h.runtime.readCurrent());assert.deepEqual(h.runtime.snapshot(),before);assert.equal(h.states.length,published);}
});

test('stop reconnect navigation and disposal invalidate a fresh read already in flight',async t=>{
 for(const action of ['stop','reconnect','navigate','dispose'])await t.test(action,async t=>{
  const h=await runtimeFixture(t),entered=deferred(),gate=deferred();h.setHook(async data=>{entered.resolve();await gate.promise;return data;});const reading=h.runtime.readCurrent();const rejection=assert.rejects(reading,/changed during capture validation/);await entered.promise;
  if(action==='stop')await h.runtime.stop();else if(action==='dispose')await h.runtime.dispose();else if(action==='reconnect'){h.source.session='f'.repeat(32);await h.runtime.connect(h.base);}else await h.runtime.navigate('/settings');
  const latest=h.runtime.snapshot(),published=h.states.length;gate.resolve();await rejection;assert.deepEqual(h.runtime.snapshot(),latest);assert.equal(h.states.length,published);
  if(action==='stop'||action==='dispose'){assert.equal(latest.status,'idle');await assert.rejects(h.runtime.readCurrent(),/Connect a runtime/);}else assert.equal(latest.status,'connected');
 });
});

test('an older readCurrent response cannot replace a newer normal polling publication',async t=>{
 const h=await runtimeFixture(t,{pollMs:40}),entered=deferred(),gate=deferred();let first=true;
 h.source.version=2;h.setHook(async data=>{if(first){first=false;entered.resolve();await gate.promise;return data;}return data;});const reading=h.runtime.readCurrent();await entered.promise;h.source.version=3;h.source.pageVersion=3;
 await wait(()=>h.runtime.snapshot().version===3,'newer polling state');const published=h.states.length;gate.resolve();const fresh=await reading;
 assert.equal(fresh.version,2);assert.equal(h.runtime.snapshot().version,3);assert.equal(h.runtime.snapshot().pageVersion,3);assert.equal(h.states.length,published);assert.equal(h.states.some(state=>state.version===2),false);
});
