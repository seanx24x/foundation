import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createConversationStore } from '../src/conversation-store.mjs';
import { populatedHistory, populatedConversationStore, historyHost } from './helpers/history-performance-fixture.mjs';
const receiverModule = {exports:{}};
vm.runInNewContext(readFileSync(new URL('../media/history-model.js',import.meta.url),'utf8'),{module:receiverModule,exports:receiverModule.exports});
const receiver=()=>receiverModule.exports.createReceiver();
const plain=value=>structuredClone(value);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

function transport({small=true}={}) {
  const h=historyHost({fixture:populatedHistory(small?{sourceCount:3,sourceBytes:1024,runCount:4,observationsPerRun:2}:{})});
  const {store}=populatedConversationStore(h.fixture.project.id),messages=[];
  const webview={postMessage:message=>{messages.push(plain(message));return Promise.resolve(true);}};
  h.host.conversations=()=>store;h.host.historyDeliveries=new WeakMap([[webview,{channels:new Map()}]]);
  const publish=(type='state')=>{
    const presentation=store.presentation();
    h.host.postHistoryMessage(webview,{type,conversations:presentation.snapshot,...(type==='state'?{runtimeWorkspace:h.host.runtimeWorkspaceSnapshot(true)}:{requestId:'live',event:{type:'delta',text:'x'}})},presentation);
    return messages.at(-1);
  };
  return {...h,store,messages,webview,publish,receiver:receiver()};
}

test('shared store presentations avoid repeated cloning and cannot mutate retained evidence',async()=>{
  const h=transport(),first=h.store.presentation(),run=h.fixture.store.presentation();
  assert.equal(first.snapshot.conversations,h.store.presentation().snapshot.conversations);
  assert.equal(run.snapshot.runs,h.fixture.store.presentation().snapshot.runs);
  assert.throws(()=>first.snapshot.conversations[0].turns[0].context[0].source='corrupted',TypeError);
  assert.throws(()=>run.snapshot.runs[0].observations.push({}),TypeError);
  const cloned=h.store.snapshot();cloned.conversations[0].turns[0].answer='caller draft';
  const clonedRuns=h.fixture.store.snapshot();clonedRuns.runs.length=0;
  assert.notEqual(h.store.snapshot().conversations[0].turns[0].answer,'caller draft');
  assert.equal(h.fixture.store.snapshot().runs.length,4);
  const before=globalThis.structuredClone;let clones=0;
  try {globalThis.structuredClone=(...args)=>{clones++;return before(...args);};for(let i=0;i<100;i++){h.store.presentation();h.fixture.store.presentation();}assert.equal(clones,0);}
  finally{globalThis.structuredClone=before;}
  await h.store.dispose();
});

test('first publication is complete; unchanged histories omit records while retaining live freshness and storage',async()=>{
  const h=transport(),first=h.publish(),decoded=h.receiver.receive(first.history);
  assert.equal(decoded.ok,true);assert.equal(first.history.conversations.records.length,100);assert.equal(first.history.runtimeWorkspace.records.length,4);
  assert.deepEqual(plain(decoded.values.conversations),h.store.snapshot());
  assert.deepEqual(plain(decoded.values.runtimeWorkspace),plain(h.host.runtimeWorkspaceSnapshot()));
  h.host.featureUnavailable=[{path:h.fixture.files[0].path,kind:'source-unavailable'}];
  const next=h.publish(),updated=h.receiver.receive(next.history);
  assert.equal(next.history.conversations.records.length,0);assert.equal(next.history.runtimeWorkspace.records.length,0);
  assert.ok(updated.values.runtimeWorkspace.runFreshness.every(x=>x.status==='unknown'));
  assert.equal(updated.values.runtimeWorkspace.runs.length,4);
  assert.deepEqual(plain(updated.values.conversations),h.store.snapshot());await h.store.dispose();
});

test('state and AI share an ordered cursor and stream only the changed turn even with identical timestamps',async()=>{
  const h=transport();h.receiver.receive(h.publish().history);
  await h.store.startTurn({requestId:'live',prompt:'Question',context:[{path:'src/App.tsx',revision:'r1',source:'export const x = 1;'}],model:'local-test'});
  assert.equal(h.receiver.receive(h.publish().history).ok,true);
  h.store.event('live',{type:'delta',text:'First'});
  const ai=h.publish('ai'),result=h.receiver.receive(ai.history);
  assert.deepEqual(ai.history.conversations.records.map(x=>x.requestId),['live']);
  assert.equal(result.values.conversations.conversations[0].turns.at(-1).answer,'First');
  assert.equal(h.receiver.receive(h.publish().history).ok,true);
  h.store.event('live',{type:'delta',text:' second'});
  const ai2=h.publish('ai'),result2=h.receiver.receive(ai2.history);
  assert.deepEqual(ai2.history.conversations.records.map(x=>x.requestId),['live']);
  assert.deepEqual(plain(result2.values.conversations),h.store.snapshot());
  h.store.event('live',{type:'cancelled'});await h.store.dispose();
});

test('separate views and fresh ready/resync cursors never assume another receiver has records',async()=>{
  const h=transport();h.receiver.receive(h.publish().history);
  const otherMessages=[],other={postMessage:m=>otherMessages.push(plain(m))};
  h.host.historyDeliveries.set(other,{channels:new Map()});
  h.host.postHistoryMessage(other,{type:'state',conversations:h.store.presentation().snapshot},h.store.presentation());
  assert.equal(otherMessages[0].history.conversations.records.length,100);
  assert.equal(receiver().receive(otherMessages[0].history).ok,true);
  for(const channel of h.host.historyDeliveries.get(h.webview).channels.values())channel.reset=true;
  const fresh=h.publish();assert.equal(fresh.history.conversations.base,null);assert.equal(fresh.history.conversations.records.length,100);
  assert.equal(h.receiver.receive(fresh.history).ok,true);await h.store.dispose();
});

test('dropped, reordered and missing-base messages request one full recovery without inventing empty history',async()=>{
  const h=transport();const first=h.publish();assert.equal(h.receiver.receive(first.history).ok,true);
  const dropped=h.publish(),gap=h.publish();
  const failed=h.receiver.receive(gap.history);assert.equal(failed.ok,false);assert.equal(failed.requestResync,true);
  assert.equal(h.receiver.receive(h.publish().history).requestResync,false);
  for(const channel of h.host.historyDeliveries.get(h.webview).channels.values())channel.reset=true;
  const full=h.publish();const restored=h.receiver.receive(full.history);assert.equal(restored.ok,true);assert.equal(restored.values.conversations.conversations.length,10);
  assert.equal(h.receiver.receive(dropped.history).ignored,true);
  assert.equal(receiver().receive(gap.history).requestResync,true);await h.store.dispose();
});

test('rejected delivery resends a complete record set; null and project changes clear the owning cursor',async()=>{
  const h=transport();h.publish();h.webview.postMessage=message=>{h.messages.push(plain(message));return Promise.resolve(false);};h.publish();await tick();
  h.webview.postMessage=message=>{h.messages.push(plain(message));return Promise.resolve(true);};
  assert.equal(h.publish().history.conversations.base,null);
  h.host.postHistoryMessage(h.webview,{type:'state',conversations:null,runtimeWorkspace:null});
  assert.equal(h.receiver.receive(h.messages.at(-1).history).values.conversations,null);
  assert.equal(h.publish().history.conversations.records.length,100);
  const other=populatedConversationStore('other-project').store;
  h.host.postHistoryMessage(h.webview,{type:'state',conversations:other.presentation().snapshot},other.presentation());
  assert.equal(h.messages.at(-1).history.conversations.base,null);
  assert.equal(h.receiver.receive(h.messages.at(-1).history).values.conversations.projectId,'other-project');await other.dispose();await h.store.dispose();
});

test('storage transitions publish without inventing data revisions and frozen presentations survive concurrent persistence',async()=>{
  const writes=[],gates=[],store=createConversationStore({projectId:'storage-race',read:()=>null,write:value=>{writes.push(value);const gate=deferred();gates.push(gate);return gate.promise;}});
  const creation=store.newConversation();await tick();gates.shift().resolve();await creation;
  const start=store.startTurn({requestId:'live',prompt:'Question',context:[{path:'src/App.tsx',revision:'r1',source:'export const x = 1;'}]});await tick();gates.shift().resolve();await start;
  store.event('live',{type:'delta',text:'First'});const saving=store.presentation(),flush=store.flush();await tick();
  store.event('live',{type:'delta',text:' second'});const newer=store.presentation();assert.equal(saving.snapshot.conversations[0].turns[0].answer,'First');
  gates.shift().resolve();await tick();assert.equal(writes.at(-1).conversations[0].turns[0].answer,'First second');gates.shift().reject(Error('synthetic storage failure'));await assert.rejects(flush);
  assert.equal(store.presentation().snapshot.revision,newer.snapshot.revision);assert.equal(store.presentation().snapshot.storage.status,'error');
  const retry=store.retry();await tick();assert.equal(store.presentation().snapshot.storage.status,'saving');gates.shift().resolve();await retry;
  assert.equal(store.presentation().snapshot.storage.status,'saved');assert.equal(store.presentation().snapshot.revision,newer.snapshot.revision);
  store.event('live',{type:'cancelled'});const stop=store.flush();await tick();gates.shift().resolve();await stop;await store.dispose();
});

test('receiver rejects record loss, duplicate ownership and malformed protocol without partial application',async()=>{
  for(const corrupt of [p=>p.conversations.records.pop(),p=>p.conversations.header.conversations[0].turnIds.push(p.conversations.header.conversations[0].turnIds[0]),p=>p.version=2]){
    const h=transport(),packet=h.publish().history;corrupt(packet);assert.equal(h.receiver.receive(packet).requestResync,true);await h.store.dispose();
  }
});

test('populated unchanged history envelopes and streaming updates stay bounded by changed records',async t=>{
  const h=transport({small:false});const initial=h.publish(),unchanged=h.publish();
  await h.store.startTurn({requestId:'live',prompt:'Question',context:[{path:'src/App.tsx',revision:'r1',source:'export const x = 1;'}]});h.publish();h.store.event('live',{type:'delta',text:'Small local streamed answer.'});const streamed=h.publish('ai');
  const bytes=value=>Buffer.byteLength(JSON.stringify(value));
  const measurement={initialStateBytes:bytes(initial),unchangedStateBytes:bytes(unchanged),streamingAIBytes:bytes(streamed),retainedTurns:100,retainedRuns:40,retainedObservations:4000};
  assert.equal(unchanged.history.conversations.records.length,0);assert.equal(unchanged.history.runtimeWorkspace.records.length,0);assert.equal(streamed.history.conversations.records.length,1);
  assert.ok(measurement.unchangedStateBytes<measurement.initialStateBytes/50);assert.ok(measurement.streamingAIBytes<20000);t.diagnostic(JSON.stringify(measurement));
  h.store.event('live',{type:'cancelled'});await h.store.dispose();
});

test('a bad second channel cannot partially commit the first, and empty AI cannot end recovery',async()=>{
  const h=transport();const first=h.publish();h.receiver.receive(first.history);
  const packet=h.publish().history;packet.runtimeWorkspace.header.runIds.push('missing-run');
  assert.equal(h.receiver.receive(packet).requestResync,true);
  assert.equal(h.receiver.receive({version:1}).requestResync,false);
  assert.equal(h.receiver.receive(h.publish('ai').history).requestResync,false);
  for(const channel of h.host.historyDeliveries.get(h.webview).channels.values())channel.reset=true;
  const recovered=h.receiver.receive(h.publish().history);assert.equal(recovered.ok,true);assert.deepEqual(plain(recovered.values.conversations),h.store.snapshot());
  const messages=h.messages.length;h.host.postHistoryMessage(h.webview,{type:'ai',requestId:'ephemeral',event:{type:'error'}});
  assert.equal(h.messages.length,messages+1);assert.equal(h.messages.at(-1).history,undefined);await h.store.dispose();
});

test('retry after unavailable storage replaces equal revision identities with a new full snapshot',async()=>{
  let saved={invalid:true};const store=createConversationStore({projectId:'reload',read:()=>saved,write:async value=>{saved=value;}});
  const h=transport(),first=store.presentation();assert.equal(first.snapshot.revision,0);assert.equal(first.snapshot.storage.status,'unavailable');
  h.host.postHistoryMessage(h.webview,{type:'state',conversations:first.snapshot},first);
  const before=h.messages.at(-1).history.conversations;
  saved={schemaVersion:8,projectId:'reload',revision:0,activeId:'loaded',conversations:[{id:'loaded',title:'Loaded',createdAt:'2026-10-30T12:00:00.000Z',updatedAt:'2026-10-30T12:00:00.000Z',archived:false,turns:[]}]};
  await store.retry();const after=store.presentation();assert.equal(after.snapshot.revision,0);assert.notEqual(after.epoch,first.epoch);
  h.host.postHistoryMessage(h.webview,{type:'state',conversations:after.snapshot},after);
  const packet=h.messages.at(-1).history.conversations;assert.equal(packet.base,null);assert.ok(packet.generation>before.generation);assert.equal(packet.header.activeId,'loaded');await store.dispose();await h.store.dispose();
});

test('streaming copies only its owning turn and retains exact prior immutable records',async()=>{
  const h=transport();await h.store.startTurn({requestId:'live',prompt:'Question',context:[{path:'src/App.tsx',revision:'r1',source:'export const x = 1;'}]});
  const before=h.store.presentation();h.store.event('live',{type:'delta',text:'New content'});const after=h.store.presentation();
  assert.equal(before.snapshot.conversations[1],after.snapshot.conversations[1]);
  assert.equal(before.snapshot.conversations[0].turns[0],after.snapshot.conversations[0].turns[0]);
  assert.notEqual(before.snapshot.conversations[0].turns.at(-1),after.snapshot.conversations[0].turns.at(-1));
  assert.equal(before.snapshot.conversations[0].turns.at(-1).answer,'');assert.equal(after.snapshot.conversations[0].turns.at(-1).answer,'New content');
  const stable=before.snapshot.conversations[0].turns[0].requestId;assert.equal(before.versions[stable],after.versions[stable]);assert.notEqual(before.versions.live,after.versions.live);
  h.store.event('live',{type:'cancelled'});await h.store.dispose();
});

test('synchronous and asynchronous transport failures reset the next delivery without changing stored evidence',async()=>{
  for(const throws of [true,false]){
    const h=transport();h.publish();h.webview.postMessage=()=>{if(throws)throw Error('closed webview');return Promise.reject(Error('closed webview'));};
    h.publish();await tick();h.webview.postMessage=message=>{h.messages.push(plain(message));return Promise.resolve(true);};
    const packet=h.publish();assert.equal(packet.history.conversations.base,null);assert.equal(packet.history.conversations.records.length,100);assert.equal(h.store.snapshot().conversations.length,10);await h.store.dispose();
  }
});
