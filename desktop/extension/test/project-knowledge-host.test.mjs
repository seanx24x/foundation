import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import vm from 'node:vm';
const root=fileURLToPath(new URL('../../../',import.meta.url)),require=createRequire(join(root,'package.json')),ts=require('typescript');
const compiled=ts.transpileModule(`${readFileSync(join(root,'desktop/extension/src/extension.ts'),'utf8')}\nexport {FoundationHost};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const copy=value=>JSON.parse(JSON.stringify(value)),digest='a'.repeat(64),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({kind='decision',ready=true}={}){
 const project={id:'knowledge-host',root:'/fixture/knowledge'},vscode={workspace:{isTrusted:true}},module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,URL,AbortController,TextDecoder,structuredClone,setTimeout,clearTimeout,require:name=>name==='vscode'?vscode:name.startsWith('node:')?require(name):{}});
 const host=Object.create(module.exports.FoundationHost.prototype),calls=[],workspaceMessages=[],assistantMessages=[];
 const decisionContext={version:1,projectId:project.id,decisions:[{decision:{id:'record-1',rationale:'Keep the clear saving state.'},digest}]};
 const issueStatus={source:'stale',captureSource:'current',run:'available',replay:'available',capture:'available'};
 const issueContext={version:1,projectId:project.id,issues:[{issue:{id:'record-1',actualOutcome:'Save failed.'},digest,assessment:issueStatus}]};
 const issueItem={record:{id:'record-1'},digest,status:issueStatus,canShare:true};
 let featureId='feature-1',conversationId='conversation-1',resolveHook,showHook,refreshHook,postHook,postResult=true,resolveCount=0;
 const source={postMessage:async message=>{workspaceMessages.push(copy(message));return true;}};
 const target={postMessage:async message=>{assistantMessages.push(copy(message));if(postHook)await postHook(message);return postResult;}};
 async function resolve(context,owner,type){
  calls.push({resolve:type,input:copy(context),projectId:owner});resolveCount++;
  assert.equal(owner,project.id);const expected=type==='decision'?decisionContext:issueContext;
  if(Array.isArray(context))assert.deepEqual(copy(context),[{id:'record-1',digest,...(type==='issue'?{assessment:copy(issueStatus)}:{})}]);
  else assert.deepEqual(copy(context),copy(expected));
  if(resolveHook)await resolveHook(resolveCount,context,type);
  return copy(expected);
 }
 Object.assign(host,{project,disposed:false,featureSourceEpoch:0,asking:undefined,assistantReady:ready,assistantOpen:true,workspaceReady:true,mode:'Understand',panel:{webview:source,visible:true},assistantView:{webview:target,visible:true},
  featureSnapshot:()=>({activeId:featureId,revision:1}),conversationPresentation:()=>({snapshot:{activeId:conversationId}}),
  resolveDecisionContext:(context,owner)=>resolve(context,owner,'decision'),resolveIssueContext:(context,owner)=>resolve(context,owner,'issue'),
  refreshReproducibleIssues:async id=>{calls.push({refresh:id});if(refreshHook)await refreshHook();},reproducibleIssuesSnapshot:()=>({records:[issueItem]}),
  showAssistant:async()=>{calls.push('showAssistant');if(showHook)await showHook();},show:async mode=>{calls.push({show:mode});host.mode=mode;if(showHook)await showHook();},sendState:()=>calls.push('sendState')});
 const request={type:'knowledgeContext',action:'prepare',projectId:project.id,kind,id:'record-1',digest};
 const prepare=(extra={},surface='workspace')=>host.prepareKnowledgeContext({...request,...extra},surface);
 const prepared=()=>assistantMessages.filter(message=>message.type==='knowledgeContextPrepared');
 const result=()=>workspaceMessages.filter(message=>message.type==='knowledgeContextResult');
 const ack=(extra={})=>host.knowledgeContextApplied({...prepared().at(-1),type:'knowledgeContextApplied',...extra});
 return {host,project,vscode,calls,source,target,workspaceMessages,assistantMessages,request,issueItem,issueStatus,decisionContext,issueContext,prepare,prepared,result,ack,setFeature:value=>featureId=value,setConversation:value=>conversationId=value,setResolve:value=>resolveHook=value,setShow:value=>showHook=value,setRefresh:value=>refreshHook=value,setPost:value=>postHook=value,setPostResult:value=>postResult=value};
}

for(const kind of ['decision','issue'])test(`${kind} preparation resolves exact host context twice, sends only its identity, and never dispatches a provider request`,async()=>{
 const h=fixture({kind}),before=copy({decision:h.decisionContext,issue:h.issueContext});await h.prepare({context:{forged:true},assessment:{source:'current'}});
 assert.equal(h.prepared().length,1);assert.equal(h.result().length,0);assert.equal(h.calls.filter(call=>call.resolve===kind).length,2);
 assert.deepEqual(h.calls.filter(call=>call.resolve).map(call=>Array.isArray(call.input)),[true,false]);
 const message=h.prepared()[0];assert.match(message.prepareId,/^[a-f0-9-]{36}$/);assert.deepEqual(Object.keys(message).sort(),['conversationId','digest','featureId','id','kind','prepareId','projectId','type'].sort());assert.equal(message.kind,kind);assert.equal(Object.hasOwn(message,'context'),false);
 if(kind==='issue'){assert.equal(h.calls[0].refresh,'record-1');assert.equal(h.calls[1].input[0].assessment.source,'stale');}
 assert.deepEqual({decision:h.decisionContext,issue:h.issueContext},before);assert.ok(h.calls.every(call=>typeof call==='string'?['showAssistant','sendState'].includes(call):call.resolve||call.refresh));
 h.ack();assert.equal(h.host.knowledgeOffer,undefined);assert.equal(h.result().length,1);assert.equal(h.result()[0].error,undefined);
});

test('cold ready, refresh and reveal do not select or send knowledge without an explicit preparation',async()=>{
 const h=fixture({ready:false});await h.host.message({type:'ready'},'assistant');await tick();await h.host.flushKnowledgePreparation();assert.equal(h.prepared().length,0);assert.equal(h.calls.some(call=>call.resolve),false);
 h.host.knowledgeReveal={projectId:h.project.id,root:h.project.root};h.host.flushKnowledgeReveal();assert.equal(h.workspaceMessages.at(-1).type,'revealKnowledge');assert.equal(h.prepared().length,0);
});

test('an explicit cold preparation waits for Assistant readiness then delivers exactly once',async()=>{
 const h=fixture({ready:false});await h.prepare();assert.equal(h.prepared().length,0);assert.equal(h.calls.filter(call=>call.resolve).length,1);assert.ok(h.host.knowledgeOffer);
 await h.host.message({type:'ready'},'assistant');await tick();assert.equal(h.prepared().length,1);assert.equal(h.calls.filter(call=>call.resolve).length,2);
 await h.host.flushKnowledgePreparation();await h.host.message({type:'ready'},'assistant');await tick();assert.equal(h.prepared().length,1);h.ack();await h.host.flushKnowledgePreparation();assert.equal(h.prepared().length,1);
});

test('closed or invisible Assistant defers delivery without selecting context',async()=>{
 for(const mutate of [h=>h.host.assistantOpen=false,h=>h.host.assistantView.visible=false,h=>h.host.assistantView=undefined]){
  const h=fixture();mutate(h);await h.prepare();assert.equal(h.prepared().length,0);assert.ok(h.host.knowledgeOffer);assert.equal(h.calls.filter(call=>call.resolve).length,1);
 }
});

test('malformed, foreign, untrusted, disposed, busy and unsupported preparations fail without source reads',async()=>{
 for(const fields of [{action:'send'},{projectId:'foreign'},{kind:'other'},{id:'bad/id'},{id:'x'.repeat(129)},{digest:'0'},{digest:'A'.repeat(64)}]){const h=fixture();await h.prepare(fields);assert.equal(h.calls.length,0);assert.equal(h.prepared().length,0);assert.ok(h.result()[0].error);}
 for(const mutate of [h=>h.vscode.workspace.isTrusted=false,h=>h.host.disposed=true,h=>h.host.project=undefined,h=>h.host.asking={id:'active'}]){const h=fixture();mutate(h);await h.prepare();assert.equal(h.calls.length,0);assert.equal(h.prepared().length,0);assert.ok(h.result()[0].error);}
 const h=fixture({ready:false});await h.prepare();const offer=h.host.knowledgeOffer;await h.prepare({id:'record-2'});assert.equal(h.host.knowledgeOffer,offer);assert.equal(h.calls.filter(call=>call.resolve).length,1);assert.match(h.result()[0].error,/Finish/);
});

const ownershipChanges=[['project',h=>h.host.project={...h.project,id:'other'}],['root',h=>h.host.project={...h.project,root:'/other'}],['feature',h=>h.setFeature('other')],['conversation',h=>h.setConversation('other')],['source epoch',h=>h.host.featureSourceEpoch++],['trust',h=>h.vscode.workspace.isTrusted=false],['disposed',h=>h.host.disposed=true],['asking',h=>h.host.asking={}]];
for(const stage of ['initial read','show','final read'])test(`ownership changes during ${stage} retire the offer before context delivery`,async()=>{
 for(const [label,mutate] of ownershipChanges){
  const h=fixture();if(stage==='show')h.setShow(()=>mutate(h));else h.setResolve(count=>{if(count===(stage==='initial read'?1:2))mutate(h);});await h.prepare();assert.equal(h.prepared().length,0,label);assert.equal(h.host.knowledgeOffer,undefined,label);assert.ok(h.result().at(-1)?.error,label);
 }
});

test('source surface replacement and Assistant replacement during canonical reads cannot receive old context',async()=>{
 for(const stage of [1,2]){const h=fixture();h.setResolve(count=>{if(count===stage)h.host.panel={webview:{postMessage:async()=>true}};});await h.prepare();assert.equal(h.prepared().length,0);assert.equal(h.host.knowledgeOffer,undefined);assert.equal(h.result().length,0,'A retired source receives no acknowledgement');}
 for(const mutate of [h=>h.host.assistantView={...h.host.assistantView},h=>h.host.assistantView.visible=false,h=>h.host.assistantView=undefined]){const h=fixture();h.setResolve(count=>{if(count===2)mutate(h);});await h.prepare();assert.equal(h.prepared().length,0);assert.equal(h.host.knowledgeOffer,undefined);assert.ok(h.result()[0].error);}
});

test('issue refresh rechecks ownership before assessment and refuses unavailable or replaced issue identities',async()=>{
 for(const [,mutate] of ownershipChanges){const h=fixture({kind:'issue'});h.setRefresh(()=>mutate(h));await h.prepare();assert.equal(h.calls.filter(call=>call.resolve).length,0);assert.equal(h.prepared().length,0);assert.equal(h.host.knowledgeOffer,undefined);}
 for(const mutate of [h=>h.issueItem.canShare=false,h=>h.issueItem.digest='b'.repeat(64),h=>h.issueItem.record.id='other']){const h=fixture({kind:'issue'});mutate(h);await h.prepare();assert.equal(h.calls.filter(call=>call.resolve).length,0);assert.equal(h.prepared().length,0);assert.ok(h.result()[0].error);}
});

test('canonical snapshot rejection during delivery retires the proposal without a prepared message',async()=>{
 for(const kind of ['decision','issue']){const h=fixture({kind});h.setResolve(count=>{if(count===2)throw new Error('Source or disclosed assessment changed');});await h.prepare();assert.equal(h.prepared().length,0);assert.equal(h.host.knowledgeOffer,undefined);assert.ok(h.result()[0].error);}
});

test('concurrent flush attempts do not duplicate canonical reads or context delivery',async()=>{
 const h=fixture({ready:false});await h.prepare();h.host.assistantReady=true;let release;const wait=new Promise(resolve=>release=resolve);h.setResolve(async count=>{if(count===2)await wait;});const first=h.host.flushKnowledgePreparation();await h.host.flushKnowledgePreparation();assert.equal(h.calls.filter(call=>call.resolve).length,2);release();await first;await h.host.flushKnowledgePreparation();assert.equal(h.prepared().length,1);
});

test('failed and rejected target posts return an error and release the offer for retry',async()=>{
 for(const reject of [false,true]){const h=fixture();if(reject)h.setPost(()=>{throw new Error('Target unavailable');});else h.setPostResult(false);await h.prepare();assert.equal(h.prepared().length,1);assert.equal(h.host.knowledgeOffer,undefined);assert.ok(h.result()[0].error);}
});

test('acknowledgement requires the same target, nonce and complete record ownership',async()=>{
 const h=fixture();await h.prepare();const offer=h.host.knowledgeOffer;
 for(const fields of [{prepareId:'wrong'},{projectId:'other'},{featureId:'other'},{conversationId:'other'},{kind:'issue'},{id:'other'},{digest:'b'.repeat(64)}]){h.ack(fields);assert.equal(h.host.knowledgeOffer,offer);assert.equal(h.result().length,0);}
 await h.host.message({...h.prepared()[0],type:'knowledgeContextApplied'},'workspace');assert.equal(h.host.knowledgeOffer,offer);
 const original=h.host.assistantView;h.host.assistantView={webview:{}};h.ack();assert.equal(h.host.knowledgeOffer,offer);h.host.assistantView=original;h.ack();assert.equal(h.host.knowledgeOffer,undefined);assert.equal(h.result().length,1);h.ack();assert.equal(h.result().length,1);
});

test('late acknowledgement reports changed ownership and renderer errors stay bounded',async()=>{
 const h=fixture();await h.prepare();h.setConversation('other');h.ack();assert.equal(h.host.knowledgeOffer,undefined);assert.match(h.result()[0].error,/Context changed/);
 const other=fixture();await other.prepare();other.ack({error:'x'.repeat(900)});assert.equal(other.result()[0].error.length,400);
 const cold=fixture({ready:false});await cold.prepare();cold.host.knowledgeContextApplied({...cold.request,prepareId:cold.host.knowledgeOffer.prepareId});assert.ok(cold.host.knowledgeOffer);assert.equal(cold.result().length,0);
});

test('Assistant-origin preparation returns the result only to that same surface',async()=>{
 const h=fixture();await h.prepare({},'assistant');assert.equal(h.prepared().length,1);h.ack();assert.equal(h.workspaceMessages.length,0);assert.equal(h.assistantMessages.filter(message=>message.type==='knowledgeContextResult').length,1);
});

test('closing a preparation clears it once and cannot be revived by a late ready event',async()=>{
 const h=fixture({ready:false});await h.prepare();h.host.finishKnowledgeOffer('Assistant closed. Choose Use in Assistant again.');assert.equal(h.host.knowledgeOffer,undefined);assert.equal(h.result().length,1);await h.host.message({type:'ready'},'assistant');await tick();assert.equal(h.prepared().length,0);h.host.finishKnowledgeOffer('again');assert.equal(h.result().length,1);
});

test('Knowledge command waits for a cold workspace and reveals only the exact trusted project',async()=>{
 const h=fixture();h.host.workspaceReady=false;await h.host.showKnowledge();assert.deepEqual(h.calls,[{show:'Understand'}]);assert.equal(h.workspaceMessages.length,0);assert.ok(h.host.knowledgeReveal);
 await h.host.message({type:'ready'},'workspace');assert.equal(h.workspaceMessages.filter(message=>message.type==='revealKnowledge').length,1);assert.equal(h.host.knowledgeReveal,undefined);h.host.flushKnowledgeReveal();assert.equal(h.workspaceMessages.filter(message=>message.type==='revealKnowledge').length,1);
 for(const [,mutate] of ownershipChanges.filter(([label])=>['project','root','trust','disposed'].includes(label))){const x=fixture();x.host.workspaceReady=false;await x.host.showKnowledge();mutate(x);x.host.workspaceReady=true;x.host.flushKnowledgeReveal();assert.equal(x.workspaceMessages.length,0);assert.equal(x.host.knowledgeReveal,undefined);}
 const mode=fixture();mode.host.workspaceReady=false;await mode.host.showKnowledge();mode.host.mode='Review';mode.host.workspaceReady=true;mode.host.flushKnowledgeReveal();assert.equal(mode.workspaceMessages.length,0);
});

test('a new explicit preparation retires an unacknowledged offer from a previous conversation',async()=>{
 const h=fixture();await h.prepare();const previous=h.host.knowledgeOffer;assert.equal(previous.delivered,true);
 h.setConversation('conversation-2');await h.prepare();
 assert.notEqual(h.host.knowledgeOffer,previous,'The stale unacknowledged offer must not permanently block a new explicit selection');
 assert.equal(h.prepared().length,2);assert.equal(h.prepared()[1].conversationId,'conversation-2');
 assert.notEqual(h.prepared()[1].prepareId,h.prepared()[0].prepareId);assert.ok(h.result()[0].error);
 h.ack();assert.equal(h.host.knowledgeOffer,undefined);
});

test('publication flush retires a delivered unacknowledged offer after ownership changes',async()=>{
 for(const [label,mutate] of [...ownershipChanges,['source surface',h=>h.host.panel={webview:{postMessage:async()=>true}}]]){
  const h=fixture();await h.prepare();assert.equal(h.host.knowledgeOffer.delivered,true);mutate(h);await h.host.flushKnowledgePreparation();
  assert.equal(h.host.knowledgeOffer,undefined,label);assert.equal(h.prepared().length,1,label);
  assert.equal(h.result().length,label==='source surface'?0:1,label);if(label!=='source surface')assert.ok(h.result()[0].error,label);
 }
});

test('Assistant reload retires an unacknowledged delivered offer and permits a fresh explicit selection',async()=>{
 const h=fixture();await h.prepare();const before=h.prepared()[0];await h.host.message({type:'ready'},'assistant');await tick();
 assert.equal(h.host.knowledgeOffer,undefined);assert.equal(h.prepared().length,1,'Reload must not replay a context-selection action');assert.ok(h.result()[0].error);
 await h.prepare();assert.equal(h.prepared().length,2);assert.notEqual(h.prepared()[1].prepareId,before.prepareId);h.ack();assert.equal(h.host.knowledgeOffer,undefined);
});
