import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {foundationRuntime} from '../../runtime/vite-plugin.mjs';
import {createConnectedRuntime} from '../src/connected-runtime.mjs';
import {replayProtocol as p,replayCatalogDigest,normalizeReplayCatalog} from '../../runtime/replay-protocol.mjs';
import {createReplayMailbox} from '../../runtime/replay-mailbox.mjs';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const hex=n=>String(n).repeat(32);
const recipes=[{id:'save',title:'Save profile',route:'/',fixture:{id:'local-profile',label:'Local profile fixture'},steps:[{id:'save',title:'Save changes'},{id:'verify',title:'Read resulting state'}]}];
const requested={theme:'light',motion:'system',viewportWidthCss:960,viewportHeightCss:680};
const observed={viewportWidthCss:960,viewportHeightCss:680,deviceScaleFactor:1,colorSchemePreference:'light',reducedMotionPreference:'no-preference'};
const wait=async(check,label,timeout=6000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await check();if(v)return v;await new Promise(r=>setTimeout(r,30));}throw new Error(`Timed out ${label}`);};
function mailbox(){let now=10000;const session=hex(1),viewId=hex(2),documentId=hex(3);const view={documentId,pagePath:'/',pageVersion:4,pageSequence:1,lastPageSeen:now};const box=createReplayMailbox({session,now:()=>now});
 const event={session,viewId,documentId,pageSequence:1};const catalog=box.register(view,{...event,type:'register',registrationId:hex(4),recipes});
 const request={executionId:hex(5),recipeId:'save',catalogDigest:catalog.digest,registrationId:catalog.registrationId,identity:{session,viewId,documentId,route:'/',pageVersion:4},requested};
 return {box,view,viewId,event,catalog,request,advance:ms=>{now+=ms;}};
}
test('replay metadata has strict keys, finite catalog limits and stable source-independent digest',()=>{
 const catalog={schemaVersion:1,registrationId:hex(4),digest:replayCatalogDigest(recipes),recipes};assert.deepEqual(normalizeReplayCatalog(catalog),catalog);
 for(const value of [{...catalog,token:'private'},{...catalog,digest:'f'.repeat(64)},{...catalog,recipes:[]},{...catalog,recipes:[...recipes,...recipes]}])assert.throws(()=>normalizeReplayCatalog(value));
 for(const value of [{...requested,script:'bad'},{...requested,viewportWidthCss:1200},{...requested,motion:'emulated'}])assert.throws(()=>p.requested(value));
 assert.throws(()=>p.recipes([{...recipes[0],steps:Array.from({length:13},(_,i)=>({id:`s${i}`,title:'Step'}))}]));
 assert.throws(()=>p.recipes([{...recipes[0],title:'秘密'.repeat(61)}]));
 assert.equal(replayCatalogDigest(recipes),replayCatalogDigest(structuredClone(recipes)));
});
test('mailbox reserves without execution, accepts only ordered explicit units and deduplicates transport',()=>{
 const h=mailbox(),{box,view,viewId,request}=h;box.host(view,viewId,{action:'reserve',request});assert.equal(box.command(view,h.event.documentId,1).command,null);
 assert.throws(()=>box.host(view,viewId,{action:'dispatch',executionId:request.executionId,unit:{phase:'step',stepId:'save'}}));
 const dispatch={action:'dispatch',executionId:request.executionId,unit:{phase:'prepare'}};box.host(view,viewId,dispatch);const command=box.command(view,h.event.documentId,1);box.host(view,viewId,dispatch);assert.equal(box.command(view,h.event.documentId,1).command.commandId,command.command.commandId);
 const ack={...h.event,type:'ack',executionId:request.executionId,commandId:command.command.commandId,status:'completed',reason:null,observed};box.ack(view,ack);box.ack(view,ack);assert.equal(box.snapshot(view).replayExecution.next,1);
 assert.throws(()=>box.host(view,viewId,{action:'dispatch',executionId:request.executionId,unit:{phase:'step',stepId:'verify'}}));
 box.host(view,viewId,{action:'cancel',executionId:request.executionId});assert.equal(box.snapshot(view).replayBlocked,'reload-required');assert.throws(()=>box.host(view,viewId,{action:'reserve',request:{...request,executionId:hex(6)}}));
});
test('mailbox expires abandoned execution and rejects late success across document or registry changes',()=>{
 for(const change of [h=>h.advance(4001),h=>h.box.sourceChanged(h.view),h=>{h.view.pageVersion+=2;},h=>h.box.register(h.view,{...h.event,type:'register',registrationId:hex(8),recipes})]){
  const h=mailbox();h.box.host(h.view,h.viewId,{action:'reserve',request:h.request});h.box.host(h.view,h.viewId,{action:'dispatch',executionId:h.request.executionId,unit:{phase:'prepare'}});change(h);
  const result=h.box.host(h.view,h.viewId,{action:'read',executionId:h.request.executionId});assert.equal(result.status,'interrupted');
  assert.throws(()=>h.box.ack(h.view,{...h.event,type:'ack',executionId:h.request.executionId,commandId:`${h.request.executionId}:0`,status:'completed',reason:null,observed}));
 }
});
async function fixture(t){
 const plugin=foundationRuntime();plugin.configResolved({root:repo,server:{host:'127.0.0.1'}});let middleware;plugin.configureServer({middlewares:{use:handler=>middleware=handler}});
 const client=plugin.transformIndexHtml()[0].children;const registration=`window.effects=[];window.mode='normal';window.register=()=>globalThis.__foundationRegisterScenarios({version:1,recipes:[{id:'save',title:'Save profile',route:'/',fixture:{id:'local-profile',label:'Local profile fixture'},prepare:async({signal,conditions})=>{window.effects.push('prepare');window.conditions=conditions;window.counter=0;},steps:[{id:'save',title:'Save changes',run:async({signal})=>{window.effects.push('save');if(window.mode==='fail')throw Error('PRIVATE_CALLBACK_SECRET');if(window.mode==='slow')await new Promise(resolve=>setTimeout(resolve,700));if(window.mode==='hang')await new Promise(()=>{});window.counter++;return 'PRIVATE_RESULT';}},{id:'verify',title:'Read resulting state',run:async()=>{window.effects.push('verify');if(window.counter!==1)throw Error('PRIVATE_STATE');}}]}]});window.register();`;
 const server=createServer((req,res)=>void middleware(req,res,()=>res.writeHead(200,{'Content-Type':'text/html'}).end(`<!doctype html><html><body><main>Replay fixture</main><script>${client}</script><script>${registration}</script></body></html>`)));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const runtime=createConnectedRuntime({root:repo,pollMs:30});let browser;
 t.after(async()=>{await runtime.dispose();await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 await runtime.connect(`http://127.0.0.1:${server.address().port}`);browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:960,height:680}});await page.goto(runtime.snapshot().url);
 await wait(()=>runtime.snapshot().replayCatalog,'catalog');
 const input=id=>{const s=runtime.snapshot(),c=s.replayCatalog;return {executionId:id,recipeId:'save',catalogDigest:c.digest,registrationId:c.registrationId,identity:{session:s.session,viewId:s.viewId,documentId:s.documentId,route:s.pagePath,pageVersion:s.pageVersion},requested};};
 return {runtime,page,input,plugin,server};
}
test('real page replay resets then executes only after each persisted host acknowledgment; repeat is fresh',async t=>{
 const h=await fixture(t),progress=[];const result=await h.runtime.replay(h.input(hex(6)),{onProgress:async event=>{const effects=await h.page.evaluate(()=>window.effects);progress.push(event);if(event.status==='running')assert.equal(effects.length,event.phase==='prepare'?0:event.stepId==='save'?1:2);}});
 assert.equal(result.status,'completed');assert.deepEqual(await h.page.evaluate(()=>window.effects),['prepare','save','verify']);assert.deepEqual(progress.map(e=>`${e.phase}:${e.status}`),['prepare:running','prepare:completed','step:running','step:completed','step:running','step:completed']);assert.equal(result.observed.viewportWidthCss,960);
 assert.doesNotMatch(JSON.stringify([result,progress,h.runtime.snapshot()]),/PRIVATE_CALLBACK_SECRET|PRIVATE_RESULT/);
 const again=await h.runtime.replay(h.input(hex(7)));assert.equal(again.status,'completed');assert.equal(await h.page.evaluate(()=>window.counter),1,'prepare reset before the second run');
});
test('callback failure is app execution evidence, suppresses raw errors, and never runs later units',async t=>{
 const h=await fixture(t);await h.page.evaluate(()=>{window.mode='fail';});const result=await h.runtime.replay(h.input(hex(6)));
 assert.equal(result.status,'failed');assert.equal(result.reason,'callback-failed');assert.deepEqual(await h.page.evaluate(()=>window.effects),['prepare','save']);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});
test('Stop suppresses future steps and late callback success, requiring a fresh document',async t=>{
 const h=await fixture(t);await h.page.evaluate(()=>{window.mode='slow';});const controller=new AbortController();
 const running=h.runtime.replay(h.input(hex(6)),{signal:controller.signal});await wait(()=>h.page.evaluate(()=>window.effects.includes('save')),'save dispatched');controller.abort();
 const result=await running;assert.equal(result.status,'cancelled');await new Promise(r=>setTimeout(r,850));assert.deepEqual(await h.page.evaluate(()=>window.effects),['prepare','save']);await wait(()=>h.runtime.snapshot().replayBlocked==='reload-required','cancel latch');
 await h.page.reload();await wait(()=>h.runtime.snapshot().replayCatalog&&!h.runtime.snapshot().replayBlocked,'fresh catalog');assert.equal((await h.runtime.replay(h.input(hex(7)))).status,'completed');
});
test('failed progress persistence prevents the next app callback and late navigation invalidates execution',async t=>{
 const h=await fixture(t);const result=await h.runtime.replay(h.input(hex(6)),{onProgress:async e=>{if(e.phase==='prepare'&&e.status==='completed')throw Error('PRIVATE_DISK_ERROR');}});
 assert.equal(result.status,'interrupted');assert.equal(result.reason,'progress-unavailable');assert.deepEqual(await h.page.evaluate(()=>window.effects),['prepare']);
 const previousDocument=h.runtime.snapshot().documentId;await h.page.reload();await wait(()=>h.runtime.snapshot().documentId!==previousDocument&&h.runtime.snapshot().replayCatalog&&!h.runtime.snapshot().replayBlocked,'new document');await h.page.evaluate(()=>window.mode='slow');
 const pending=h.runtime.replay(h.input(hex(7)));await wait(()=>h.page.evaluate(()=>window.effects.includes('save')),'slow step');await h.page.evaluate(()=>{history.pushState({},'','/away');history.replaceState({},'','/');});
 assert.equal((await pending).status,'interrupted');await new Promise(r=>setTimeout(r,750));assert.deepEqual(await h.page.evaluate(()=>window.effects),['prepare','save']);
});

test('prepare-only recipes repeat immediately and changed viewport cannot become completed evidence',async t=>{
 const h=await fixture(t);const oldRegistration=h.runtime.snapshot().replayCatalog.registrationId;
 await h.page.evaluate(()=>globalThis.__foundationRegisterScenarios({version:1,recipes:[{id:'state',title:'Idle state',route:'/',fixture:{id:'local-profile',label:'Local profile fixture'},prepare:async()=>{window.effects.push('state');},steps:[]}]}));
 await wait(()=>h.runtime.snapshot().replayCatalog?.registrationId!==oldRegistration,'prepare-only registration');
 const first={...h.input(hex(6)),recipeId:'state'};assert.equal((await h.runtime.replay(first)).status,'completed');assert.equal((await h.runtime.replay({...h.input(hex(7)),recipeId:'state'})).status,'completed');
 assert.deepEqual(await h.page.evaluate(()=>window.effects),['state','state']);
 const before=h.runtime.snapshot().documentId;await h.page.reload();await wait(()=>h.runtime.snapshot().documentId!==before&&h.runtime.snapshot().replayCatalog,'fresh document');
 await h.page.evaluate(()=>window.mode='slow');const pending=h.runtime.replay(h.input(hex(8)));await wait(()=>h.page.evaluate(()=>window.effects.includes('save')),'slow callback');await h.page.setViewportSize({width:768,height:680});
 const result=await pending;assert.equal(result.status,'interrupted');assert.equal(result.reason,'conditions-changed');assert.deepEqual(await h.page.evaluate(()=>window.effects),['prepare','save']);
});

test('source changes retire the old registration even when no replay is active',()=>{
 const h=mailbox();h.box.sourceChanged(h.view);assert.equal(h.box.snapshot(h.view).replayBlocked,'reload-required');
 h.box.register(h.view,{...h.event,type:'register',registrationId:h.catalog.registrationId,recipes});
 assert.throws(()=>h.box.host(h.view,h.viewId,{action:'reserve',request:h.request}));
});
test('host-only commands reject browser Origin and stale identity without invoking app callbacks',async t=>{
 const h=await fixture(t),s=h.runtime.snapshot(),headers={'Content-Type':'application/json','X-Foundation-View':s.viewId};
 const handshake=await (await fetch(new URL('/__foundation/handshake',s.targetUrl),{headers:{'X-Foundation-View':s.viewId}})).json();headers['X-Foundation-Token']=handshake.token;
 const reserve={action:'reserve',request:h.input(hex(6))};
 const forbidden=await fetch(new URL('/__foundation/replay',s.targetUrl),{method:'POST',headers:{...headers,Origin:new URL(s.targetUrl).origin},body:JSON.stringify(reserve)});assert.equal(forbidden.status,403);
 const stale=structuredClone(reserve);stale.request.identity.pageVersion++;
 assert.equal((await fetch(new URL('/__foundation/replay',s.targetUrl),{method:'POST',headers,body:JSON.stringify(stale)})).status,409);
 assert.deepEqual(await h.page.evaluate(()=>window.effects),[]);
});
test('an uncooperative callback times out without running later units or preserving a false completion', {timeout:16000},async t=>{
 const h=await fixture(t);await h.page.evaluate(()=>window.mode='hang');const start=Date.now();
 const result=await h.runtime.replay(h.input(hex(6)));assert.equal(result.status,'interrupted');assert.equal(result.reason,'unit-timeout');assert.ok(Date.now()-start>=9900);assert.ok(Date.now()-start<14000);
 assert.deepEqual(await h.page.evaluate(()=>window.effects),['prepare','save']);await wait(()=>h.runtime.snapshot().replayBlocked==='reload-required','timeout latch');
});
test('cancel during running persistence and a late registration replacement dispatch no callback',async t=>{
 const h=await fixture(t),controller=new AbortController();const result=await h.runtime.replay(h.input(hex(6)),{signal:controller.signal,onProgress:async event=>{if(event.status==='running')controller.abort();}});
 assert.equal(result.status,'cancelled');assert.deepEqual(await h.page.evaluate(()=>window.effects),[]);
 const old=h.runtime.snapshot().documentId;await h.page.reload();await wait(()=>h.runtime.snapshot().documentId!==old&&h.runtime.snapshot().replayCatalog,'new registration');
 const changed=await h.runtime.replay(h.input(hex(7)),{onProgress:async event=>{if(event.phase==='prepare'&&event.status==='running'){await h.page.evaluate(()=>window.register());await new Promise(r=>setTimeout(r,200));}}});
 assert.equal(changed.status,'interrupted');assert.deepEqual(await h.page.evaluate(()=>window.effects),[]);
});

test('replay preparation retires an existing Inspect overlay as well as the witness flag',async t=>{
 const h=await fixture(t),session=h.runtime.snapshot().session;
 await h.page.evaluate(session=>window.postMessage({type:'foundation-runtime-control',session,inspect:true},location.origin),session);
 await h.page.locator('main').click();await wait(()=>h.page.locator('[data-foundation-overlay]').evaluate(e=>getComputedStyle(e).display!=='none'),'painted Inspect overlay');
 assert.equal((await h.runtime.replay(h.input(hex(6)))).status,'completed');
 assert.equal(await h.page.locator('[data-foundation-overlay]').evaluate(e=>getComputedStyle(e).display),'none');
 assert.equal(await h.page.evaluate(()=>globalThis.__foundationCaptureWitness('f'.repeat(32)).inspect),false);
});
