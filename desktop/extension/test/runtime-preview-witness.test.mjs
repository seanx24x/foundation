import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium,expect} from '@playwright/test';
import {runtimeClient} from '../../runtime/client.mjs';

const session='1'.repeat(32),viewId='2'.repeat(32),nonce='3'.repeat(32);
async function fixture(t){
 const client=`(${runtimeClient.toString()})(${JSON.stringify({session,token:'PRIVATE_RUNTIME_TOKEN'})});`;
 const runtime=createServer((req,res)=>{req.resume();if(req.url.startsWith('/__foundation/'))res.writeHead(202).end('{}');else res.writeHead(200,{'Content-Type':'text/html'}).end(`<!doctype html><html><body>PRIVATE_APP_CONTENT<script>${client}</script></body></html>`);});await new Promise(resolve=>runtime.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+runtime.address().port+'/profile?__foundation_view='+viewId+'&secret=PRIVATE_QUERY#PRIVATE_HASH';
 const parent=createServer((req,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end(`<!doctype html><html><body><script>window.replies=[];addEventListener('message',event=>{if(event.source===document.querySelector('iframe').contentWindow&&event.data?.type==='foundation-runtime-preview-witness')replies.push(event.data);});</script><iframe style="width:390px;height:680px;border:0" src="${url}"></iframe></body></html>`));await new Promise(resolve=>parent.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(async()=>{await browser.close();for(const server of [runtime,parent]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}assert.deepEqual(errors,[]);});await page.goto('http://127.0.0.1:'+parent.address().port);const frame=page.frames().find(value=>value.url().startsWith(url));await frame.waitForFunction(()=>typeof __foundationCaptureWitness==='function');
 const send=message=>page.evaluate(({message,origin})=>document.querySelector('iframe').contentWindow.postMessage(message,origin),{message,origin:new URL(url).origin});
 return {page,frame,send};
}
test('preview witness is parent-only, requires exact session/view/nonce, and exposes no credentials or app data',async t=>{
 const f=await fixture(t),challenge={type:'foundation-runtime-preview-witness',session,viewId,nonce};
 for(const patch of [{session:'f'.repeat(32)},{viewId:'f'.repeat(32)},{nonce:'not-valid'},{nonce:'f'.repeat(33)}])await f.send({...challenge,...patch});
 await f.frame.evaluate(message=>postMessage(message,location.origin),challenge);await f.page.waitForTimeout(60);assert.deepEqual(await f.page.evaluate(()=>replies),[]);
 await f.send({type:'foundation-runtime-control',session,inspect:false,theme:'dark'});await f.send(challenge);await expect.poll(()=>f.page.evaluate(()=>replies.length)).toBe(1);
 const value=await f.page.evaluate(()=>replies[0]);assert.deepEqual(Object.keys(value).sort(),['type','nonce','session','viewId','documentId','pageVersion','route','ready','inspect','viewportWidth','viewportHeight','requestedTheme'].sort());assert.equal(value.session,session);assert.equal(value.viewId,viewId);assert.equal(value.nonce,nonce);assert.match(value.documentId,/^[a-f0-9]{32}$/);assert.equal(value.pageVersion,1);assert.equal(value.route,'/profile');assert.equal(value.ready,true);assert.equal(value.inspect,false);assert.equal(value.requestedTheme,'dark');assert.equal(value.viewportWidth,390);assert.equal(value.viewportHeight,680);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_|token|query|hash|headers|source/i);
 await f.frame.evaluate(()=>history.pushState({},'', '/other?secret=PRIVATE_OTHER'));await f.send({...challenge,nonce:'4'.repeat(32)});await expect.poll(()=>f.page.evaluate(()=>replies.length)).toBe(2);const next=await f.page.evaluate(()=>replies[1]);assert.equal(next.route,'/other');assert.equal(next.pageVersion,2);assert.equal(next.documentId,value.documentId);assert.doesNotMatch(JSON.stringify(next),/PRIVATE_/);
});
