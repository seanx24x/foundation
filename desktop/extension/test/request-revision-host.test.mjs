import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=process.env.FOUNDATION_AI_MODES_TEST_ROOT||resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const requireProject=createRequire(join(root,'package.json')),ts=requireProject('typescript');
const storeModule=await import(join(root,'desktop/extension/src/conversation-store.mjs'));
const artifactModule=await import(join(root,'server/project/assistant-artifacts.mjs'));
const assistantModule=await import(join(root,'server/project/assistant.mjs'));
const proposalModule=await import(join(root,'server/project/proposals.mjs'));
const safety=await import(join(root,'desktop/extension/src/safety.mjs'));
const compiled=ts.transpileModule(`${readFileSync(join(root,'desktop/extension/src/extension.ts'),'utf8')}\nexport { FoundationHost };`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const {changeGroupDigest}=await import(join(root,'desktop/extension/src/execution-session.mjs'));
const featureStoreModule=await import(join(root,'desktop/extension/src/feature-store.mjs'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const file=(path,source)=>({path,source,revision:createHash('sha256').update(source).digest('hex').slice(0,16)});
const originalFiles=[file('src/Button.tsx','export function Button() {\n  return <button>Save</button>;\n}\n'),file('src/api.ts','export function save() {\n  return Promise.resolve(true);\n}\n'),file('src/consumer.ts','export const consumer = true;\n')];
const project={id:'modes-project',root:'/fixtures/modes',files:originalFiles.map(({path})=>({path}))};
const uri=fsPath=>({fsPath,scheme:'file',toString:()=>`file://${fsPath}`});
function response(events){let consumed=false;return{ok:true,body:{getReader:()=>({read:async()=>consumed?{done:true}:(consumed=true,{done:false,value:Buffer.from(events.map(e=>JSON.stringify(e)).join('\n')+'\n')})})}};}
const rawPlan=()=>({title:'Improve save',summary:'Review the selected save feature.',steps:[{title:'Clarify button',detail:'Clarify the button label.',references:[{sourceId:'S1',line:2}]},{title:'Inspect service',detail:'Check saved service source.',references:[{sourceId:'S2',line:1}]},{title:'Coordinate scope',detail:'Review both files together.',references:[{sourceId:'S1',line:1},{sourceId:'S2',line:1}]},{title:'Collect evidence',detail:'Gather missing runtime evidence.',references:[]}],risks:['No runtime was exercised.'],verification:['Inspect named loading and error states.']});
function harness(){
 const persisted=new Map(),messages=[],writes=[],reads=[],requests=[],proposals=[],documents=[],editors=[],commands=[],sources=new Map(originalFiles.map(f=>[f.path,structuredClone(f)])),dirty=new Set();
 let readHook,fetchHook,bridgeHook,writeHook,openHook,loadHook,stageHook,actionHook;
 const stageCalls=[],actionCalls=[];let group=null,busy=false,storage={status:"saved"};
 const vscode={ViewColumn:{Active:-1,One:1,Two:2},Range:class{constructor(...values){this.values=values;}},Uri:{file:uri,from:value=>({...value,toString:()=>`${value.scheme}:${value.path}?${value.query}`})},
  workspace:{isTrusted:true,textDocuments:[],openTextDocument:async value=>{documents.push(value.fsPath);return openHook?openHook(value):document(value);}},
  window:{visibleTextEditors:[],activeTextEditor:{document:{uri:uri(project.root+'/src/Unrelated.ts'),isDirty:true}},tabGroups:{all:[{viewColumn:1},{viewColumn:2}]},showTextDocument:async(doc,options)=>{editors.push({doc,options});const editor={document:doc};vscode.window.activeTextEditor=editor;host.focusGeneration++;return editor;}},
  commands:{executeCommand:async(...args)=>{commands.push(args);assert.equal(args[0],'vscode.diff');}}};
 const document=value=>{const source=sources.get(relative(project.root,value.fsPath));return{uri:value,lineCount:source.source.split('\n').length,isDirty:dirty.has(source.path),getText:()=>source.source};};
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,URL,AbortController,TextDecoder,setTimeout,clearTimeout,process,fetch:async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return fetchHook?fetchHook(url,options):response([{type:'done'}]);},require:name=>{
  if(name.includes('feature-store'))return featureStoreModule;if(name.includes('execution-session'))return{changeGroupDigest};if(name==='vscode')return vscode;if(name.includes('assistant-artifacts'))return artifactModule;if(name.includes('assistant.mjs'))return assistantModule;if(name.includes('conversation-store'))return storeModule;if(name.includes('safety'))return safety;if(name.includes('proposals.mjs'))return proposalModule;
  if(name.includes('assistant-bridge'))return{createAssistantBridge:async()=>bridgeHook?bridgeHook():{url:'http://127.0.0.1:1',token:'fixture-only',close:async()=>{}}};
  if(name.startsWith('node:'))return requireProject(name);return{};
 }});
 const host=Object.create(module.exports.FoundationHost.prototype);
 Object.assign(host,{project:structuredClone(project),disposed:false,context:{workspaceState:{get:key=>structuredClone(persisted.get(key)),update:async(key,value)=>{if(writeHook)await writeHook(key,value);persisted.set(key,structuredClone(value));writes.push({key,value:structuredClone(value)});}}},
  changeSetSessions:new Map(),changeSetActionGeneration:0,changeSetOperationGuards:new Map(),snapshots:new Map(),design:{files:[],status:"idle"},refresh:async()=>{},conversationStores:new Map(),queueConversationState(){},sendState(){},askGeneration:0,focusGeneration:0,featureSourceEpoch:0,planActionGeneration:0,artifactSourceFiles:[],artifactSourceUnavailable:[],openFiles:structuredClone(originalFiles),featureFiles:[],activeFile:structuredClone(originalFiles[0]),panel:{viewColumn:1,webview:{postMessage:message=>messages.push(structuredClone(message))}},dirtyPaths:()=>[...dirty],assistant:{status:()=>({configured:true,model:'fixture-model',providerKind:'compatible'})},
  assistantView:{visible:true,webview:{postMessage:message=>messages.push(structuredClone(message))}},proposals:()=>({current:()=>null,set:async(value,{isCurrent})=>{if(isCurrent())proposals.push(structuredClone(value));}}),service:{getFile:async(id,path)=>{reads.push({id,path});return readHook?readHook(id,path):structuredClone(sources.get(path));}}});
 const store=host.conversations();
 const session={
  snapshot:()=>({schemaVersion:1,projectId:project.id,current:group?structuredClone(group):null,storage:{...storage},busy,assessment:{canApply:true},checkpoints:[]}),
  async load(){if(loadHook)await loadHook();return this.snapshot();},async assess(){actionCalls.push({action:'assess'});return this.snapshot();},async retry(){actionCalls.push({action:'retry'});return this.snapshot();},
  async stage(value,options){stageCalls.push({value:structuredClone(value),isCurrent:options.isCurrent});if(stageHook)await stageHook(value,options);if(!options.isCurrent())return this.snapshot();
   group=proposalModule.validateChangeSet({...value,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},project.id);await store.updateChangeSet(group);return this.snapshot();},
 };
 for(const action of ['apply','undo','recover','discard'])session[action]=async(id,revision)=>{actionCalls.push({action,id,revision});host.changeSetOperationGuards.get(project.id)?.();if(actionHook)await actionHook(action);host.changeSetOperationGuards.get(project.id)?.();return session.snapshot();};
 host.changeSetSessions.set(project.id,session);host.changeSets=()=>session;host.loadChangeSets=async()=>{await session.load();return session.assess();};
 const context=()=>originalFiles.map((f,index)=>({...f,id:`S${index+1}`,lines:f.source.split('\n').length}));
 const h={host,store,session,stageCalls,actionCalls,setLoad:hook=>loadHook=hook,setStage:hook=>stageHook=hook,setAction:hook=>actionHook=hook,setGroup:value=>group=structuredClone(value),setBusy:value=>busy=value,setStorage:value=>storage=value,vscode,sources,dirty,persisted,messages,writes,reads,requests,proposals,documents,editors,commands,document,context,
  setRead:hook=>readHook=hook,setFetch:hook=>fetchHook=hook,setBridge:hook=>bridgeHook=hook,setWrite:hook=>writeHook=hook,setOpen:hook=>openHook=hook,
  turn:id=>store.snapshot().conversations.flatMap(chat=>chat.turns).find(turn=>turn.requestId===id),
  async seed(kind='plan',stopping=false){const artifact=kind==='plan'?artifactModule.createPlanArtifact({raw:JSON.stringify(rawPlan()),files:context(),projectId:project.id}):artifactModule.createReviewArtifact({raw:JSON.stringify({title:'Review save',summary:'Selected source only.',findings:[{severity:'low',title:'Fixed label',detail:'The source uses a fixed label.',references:[{sourceId:'S1',line:2}]}],limitations:['Not verified at runtime.']}),files:context(),projectId:project.id});
   await store.startTurn({requestId:`${kind}-request`,prompt:`${kind} source`,intent:kind,context:context()});store.event(`${kind}-request`,{type:kind,[kind]:artifact});if(stopping)store.event(`${kind}-request`,{type:'stopping'});store.event(`${kind}-request`,{type:'done'});await store.flush();return artifact;},
  action(action,extra={}){const turn=h.turn('plan-request')||h.turn('review-request'),artifact=turn.plan||turn.review;return host.planAction({type:'planAction',action,projectId:project.id,conversationId:store.snapshot().activeId,requestId:turn.requestId,artifactId:artifact.id,expectedRevision:turn.planRevisions?.at(-1)?.revision,...extra});},
  descriptor(extra={}){const turn=h.turn('plan-request');return{version:1,conversationId:store.snapshot().activeId,requestId:turn.requestId,artifactId:turn.plan.id,revision:turn.planRevisions.at(-1).revision,stepId:turn.plan.steps[0].id,...extra};},
  ask(intent='build',extra={}){return host.ask({type:'ask',requestId:'new-request',prompt:'Clarify this saved source.',projectId:project.id,conversationId:store.snapshot().activeId,intent,context:originalFiles.map(({path,revision})=>({path,revision})),...extra});},
  groupAction(action,extra={},surface='assistant'){const current=session.snapshot().current;return host.changeSetAction({type:'changeSetAction',action,projectId:project.id,changeSetId:current?.id,expectedRevision:current?.revision,...extra},surface);},
  get result(){return messages.filter(m=>m.type==='planActionResult').at(-1);},
 };
 return h;
}

function revisionHarness(){
 const h=harness();let featureId=null;
 h.host.featureSnapshot=()=>({projectId:project.id,activeId:featureId,features:[],revision:0,storage:{status:'saved'}});
 h.setFeature=value=>featureId=value;
 h.seedParent=async(state='complete')=>{
  await h.store.startTurn({requestId:'parent-request',prompt:'Explain these saved sources.',intent:'ask',context:h.context(),providerKind:'compatible',model:'fixture-model'});
  h.store.event('parent-request',{type:'start',intent:'ask'});h.store.event('parent-request',{type:'delta',text:'Original answer, retained exactly.'});
  h.store.event('parent-request',{type:state==='complete'?'done':state==='stopped'?'cancelled':'error'});await h.store.flush();return h.turn('parent-request');
 };
 h.revision=()=>({version:1,conversationId:h.store.snapshot().activeId,requestId:'parent-request'});
 h.prepare=async(action='prepare',extra={},surface='assistant')=>{
  try{await h.host.requestRevisionAction({type:'requestRevisionAction',action,projectId:project.id,featureId,conversationId:h.store.snapshot().activeId,requestId:'parent-request',prepareId:'prepare-1',...extra},surface);}catch(error){h.actionError=error;}
 };
 Object.defineProperty(h,'prepared',{get:()=>h.messages.filter(message=>message.type==='requestRevisionPrepared').at(-1)});
 Object.defineProperty(h,'revisionResult',{get:()=>h.messages.filter(message=>message.type==='requestRevisionResult').at(-1)});
 h.sendRevision=(extra={})=>h.ask('ask',{requestId:'revision-request',prompt:'Explain only the error behavior.',requestRevision:h.revision(),...extra});
 return h;
}
const copied=value=>JSON.parse(JSON.stringify(value));
const noPrepared=h=>assert.equal(h.prepared,undefined,JSON.stringify(h.messages));

test('prepare resolves a completed parent into composer context without a provider call or source writes',async()=>{
 const h=revisionHarness(),parent=await h.seedParent(),before=h.store.snapshot();await h.prepare();
 assert.ok(h.prepared,JSON.stringify(h.messages));assert.equal(h.prepared.prompt,parent.question);assert.equal(h.prepared.intent,parent.intent);assert.deepEqual(copied(h.prepared.requestRevision),h.revision());
 assert.deepEqual(h.prepared.files.map(({path,revision})=>({path,revision})),originalFiles.map(({path,revision})=>({path,revision})));
 assert.deepEqual(h.store.snapshot(),before);assert.equal(h.requests.length,0);assert.equal(h.proposals.length+h.stageCalls.length+h.actionCalls.length,0);assert.deepEqual([...h.sources.values()],originalFiles);
});

test('terminal stopped and failed responses can prepare a fresh draft while preserving partial output',async()=>{
 for(const state of ['stopped','failed']){const h=revisionHarness(),parent=await h.seedParent(state);await h.prepare();assert.ok(h.prepared);assert.deepEqual(h.turn('parent-request'),parent);assert.equal(h.requests.length,0);}
});

test('ordinary prepare never cancels a live request; stopAndPrepare stops only the identified stream and retains its partial answer',async()=>{
 const h=revisionHarness(),gate=deferred();let chunks=0;
 h.setFetch(()=>({ok:true,body:{getReader:()=>({read:async()=>++chunks===1?{done:false,value:Buffer.from(JSON.stringify({type:'delta',text:'Partial retained answer.'})+'\n')}:gate.promise})}}));
 const pending=h.ask('ask',{requestId:'parent-request',prompt:'Explain these saved sources.'});await tick();await tick();assert.equal(h.turn('parent-request').answer,'Partial retained answer.');
 const abort=h.host.asking.abort;await h.prepare('prepare');assert.equal(abort.signal.aborted,false);noPrepared(h);
 await h.prepare('stopAndPrepare');assert.equal(abort.signal.aborted,true);assert.equal(h.turn('parent-request').state,'stopped');assert.equal(h.turn('parent-request').answer,'Partial retained answer.');assert.equal(h.store.snapshot().storage.status,'saved');assert.ok(h.prepared,JSON.stringify(h.messages));assert.equal(h.requests.length,1);
 gate.resolve({done:false,value:Buffer.from(JSON.stringify({type:'delta',text:'MUST NOT ARRIVE'})+'\n'+JSON.stringify({type:'done'})+'\n')});
 // The transport deliberately ignores AbortSignal. Retiring ownership must still suppress every late event.
 chunks=-100;gate.promise=Promise.resolve({done:true});await pending;assert.equal(h.turn('parent-request').answer,'Partial retained answer.');assert.equal(h.turn('parent-request').state,'stopped');
});

test('explicit Send creates a new request with canonical parent lineage and never mutates the earlier turn',async()=>{
 const h=revisionHarness(),parent=await h.seedParent();await h.prepare();assert.ok(h.prepared);await h.sendRevision();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.prompt,'Explain only the error behavior.');const next=h.turn('revision-request');assert.equal(next.state,'complete',JSON.stringify(h.messages));assert.equal(next.requestRevision.requestId,parent.requestId);assert.equal(next.requestRevision.conversationId,h.store.snapshot().activeId);assert.deepEqual(next.context,parent.context);assert.deepEqual(h.turn('parent-request'),parent);assert.equal(h.proposals.length+h.stageCalls.length,0);
});

test('preparation refuses foreign identity, unavailable history, archived chats, wrong surface and malformed action',async()=>{
 for(const kind of ['project','conversation','request','feature','prepareId','action','trust','disposed','archived','storage','surface']){
  const h=revisionHarness();await h.seedParent();let extra={},surface='assistant';
  if(kind==='project')extra.projectId='foreign';if(kind==='conversation')extra.conversationId='foreign';if(kind==='request')extra.requestId='foreign';if(kind==='feature')extra.featureId='foreign';if(kind==='prepareId')extra.prepareId='';if(kind==='action')extra.action='execute';if(kind==='trust')h.vscode.workspace.isTrusted=false;if(kind==='disposed')h.host.disposed=true;if(kind==='archived')await h.store.archive(h.store.snapshot().activeId);
  if(kind==='storage'){const snapshot=h.store.snapshot.bind(h.store);h.store.snapshot=()=>({...snapshot(),storage:{status:'error'}});}if(kind==='surface')surface='workspace';
  await h.prepare('prepare',extra,surface);noPrepared(h);assert.equal(h.requests.length,0);
 }
});

test('source changes, unavailable files, corrupt revision hashes and selected native drafts block preparation',async()=>{
 for(const kind of ['saved','missing','dirty','forged-hash']){
  const h=revisionHarness();await h.seedParent();if(kind==='saved')h.sources.set(originalFiles[0].path,file(originalFiles[0].path,'later saved source'));if(kind==='missing')h.setRead(async()=>{throw Error('source unavailable');});if(kind==='dirty')h.dirty.add(originalFiles[2].path);if(kind==='forged-hash')h.sources.set(originalFiles[0].path,{...originalFiles[0],source:'different bytes under old revision'});
  await h.prepare();noPrepared(h);assert.equal(h.requests.length,0);
 }
});

test('asynchronous preparation cannot outlive project, feature, conversation, trust, view or source ownership',async()=>{
 for(const mutate of [h=>h.host.project={...project,id:'other'},h=>h.host.project={...project,root:'/other'},h=>h.setFeature('other'),h=>h.vscode.workspace.isTrusted=false,h=>h.host.disposed=true,h=>h.host.assistantView={visible:true,webview:{postMessage:()=>{}}},h=>h.dirty.add(originalFiles[0].path),async h=>h.store.newConversation()]){
  const h=revisionHarness();await h.seedParent();const gate=deferred();h.setRead(async(_id,path)=>{await gate.promise;return structuredClone(h.sources.get(path));});const pending=h.prepare();await tick();await mutate(h);gate.resolve();await pending;noPrepared(h);assert.equal(h.requests.length,0);
 }
});

test('a newer preparation retires a delayed older reply',async()=>{
 const h=revisionHarness();await h.seedParent();const gate=deferred();let calls=0;h.setRead(async(_id,path)=>{if(++calls===1)await gate.promise;return structuredClone(h.sources.get(path));});
 const older=h.prepare('prepare',{prepareId:'prepare-old'});await tick();await h.prepare('prepare',{prepareId:'prepare-new'});gate.resolve();await older;
 assert.deepEqual(h.messages.filter(message=>message.type==='requestRevisionPrepared').map(message=>message.prepareId),['prepare-new']);assert.equal(h.requests.length,0);
});

test('Send refuses spoofed lineage, a different mode, changed source order, omitted context and stale or dirty source',async()=>{
 for(const kind of ['foreign-parent','foreign-chat','version','mode','order','subset','saved','dirty','forged-hash']){
  const h=revisionHarness();await h.seedParent();await h.prepare();let extra={};
  if(kind==='foreign-parent')extra.requestRevision={...h.revision(),requestId:'missing'};if(kind==='foreign-chat')extra.requestRevision={...h.revision(),conversationId:'missing'};if(kind==='version')extra.requestRevision={...h.revision(),version:2};if(kind==='mode')extra.intent='review';if(kind==='order')extra.context=[...originalFiles].reverse().map(({path,revision})=>({path,revision}));if(kind==='subset')extra.context=[{path:originalFiles[0].path,revision:originalFiles[0].revision}];
  if(kind==='saved')h.sources.set(originalFiles[0].path,file(originalFiles[0].path,'later saved source'));if(kind==='dirty')h.dirty.add(originalFiles[2].path);if(kind==='forged-hash')h.sources.set(originalFiles[0].path,{...originalFiles[0],source:'different bytes under old revision'});
  await h.sendRevision(extra).catch(()=>{});assert.equal(h.requests.length,0,kind);assert.equal(h.turn('parent-request').state,'complete');
 }
});

test('final send guard sees a contributing draft that appears after earlier source reads',async()=>{
 const h=revisionHarness();await h.seedParent();await h.prepare();h.setBridge(async()=>{h.dirty.add(originalFiles[0].path);return{url:'http://127.0.0.1:1',token:'fixture-only',close:async()=>{}};});
 await h.sendRevision();assert.equal(h.requests.length,0);assert.equal(h.turn('parent-request').state,'complete');assert.ok(!h.turn('revision-request')||h.turn('revision-request').state==='failed');
});

test('steering cannot publish a draft until terminal history is durably saved',async()=>{
 const h=revisionHarness(),transport=deferred();h.setFetch(()=>transport.promise);const pending=h.ask('ask',{requestId:'parent-request'});await tick();await tick();
 const gate=deferred();h.setWrite(()=>gate.promise);const steering=h.prepare('stopAndPrepare');await tick();assert.equal(h.turn('parent-request').state,'stopped');noPrepared(h);gate.resolve();await steering;assert.ok(h.prepared);assert.equal(h.store.snapshot().storage.status,'saved');assert.equal(h.requests.length,1);transport.resolve(response([{type:'done'}]));await pending;
});

test('terminal history save failure keeps stopped output and prevents a prepared revision',async()=>{
 const h=revisionHarness(),transport=deferred();h.setFetch(()=>transport.promise);const pending=h.ask('ask',{requestId:'parent-request'});await tick();await tick();h.setWrite(()=>{throw Error('fixture storage failure');});await h.prepare('stopAndPrepare');noPrepared(h);assert.equal(h.store.snapshot().storage.status,'error');assert.equal(h.turn('parent-request').state,'stopped');assert.equal(h.requests.length,1);transport.resolve(response([{type:'done'}]));await pending;
});

test('Stop and revise before startTurn cancels the owned preflight but cannot invent an unsaved parent',async()=>{
 const h=revisionHarness();await h.store.newConversation();const gate=deferred();h.setRead(async(_id,path)=>{await gate.promise;return structuredClone(h.sources.get(path));});const pending=h.ask('ask',{requestId:'parent-request'});await tick();assert.equal(h.turn('parent-request'),undefined);const abort=h.host.asking.abort;
 await h.prepare('stopAndPrepare');assert.equal(abort.signal.aborted,true);noPrepared(h);assert.ok(h.revisionResult?.error);gate.resolve();await pending;assert.equal(h.requests.length,0);assert.equal(h.turn('parent-request'),undefined);
});

test('a stale Stop and revise action cannot interrupt a different request',async()=>{
 const h=revisionHarness();await h.seedParent();const transport=deferred();h.setFetch(()=>transport.promise);const pending=h.ask('ask',{requestId:'new-live-request'});await tick();await tick();const abort=h.host.asking.abort;
 await h.prepare('stopAndPrepare');assert.equal(abort.signal.aborted,false);assert.equal(h.host.asking.requestId,'new-live-request');noPrepared(h);assert.equal(h.turn('parent-request').state,'complete');h.host.cancelQuestion('new-live-request');transport.resolve(response([{type:'done'}]));await pending;
});

test('late old stream artifacts cannot alter a revised successor or create a source proposal',async()=>{
 const h=revisionHarness(),old=deferred();h.setFetch(()=>old.promise);const first=h.ask('ask',{requestId:'parent-request'});await tick();await tick();await h.prepare('stopAndPrepare');assert.ok(h.prepared);
 h.setFetch(()=>response([{type:'delta',text:'Current revised answer.'},{type:'done'}]));await h.sendRevision();const saved=h.turn('revision-request');assert.equal(saved.state,'complete');
 old.resolve(response([{type:'delta',text:'Obsolete text'},{type:'proposal',proposal:{id:'forged-late'}},{type:'done'}]));await first;assert.deepEqual(h.turn('revision-request'),saved);assert.equal(h.turn('parent-request').state,'stopped');assert.equal(h.turn('parent-request').answer,'');assert.equal(h.proposals.length,0);assert.equal(h.requests.length,2);
});

test('revised Send keeps parent lineage local and never inherits parent output into the provider transport',async()=>{
 const h=revisionHarness();await h.seedParent();await h.sendRevision();const body=h.requests[0].body;assert.equal(body.requestRevision,undefined);assert.equal(body.parent,undefined);assert.equal(body.history,undefined);assert.equal(JSON.stringify(body).includes('Original answer, retained exactly.'),false);assert.equal(h.turn('revision-request').requestRevision.requestId,'parent-request');
});

test('plan-step parents require their dedicated handoff instead of generic request revision',async()=>{
 const h=revisionHarness();await h.seedParent();const snapshot=h.store.snapshot.bind(h.store);h.store.snapshot=()=>{const value=snapshot();value.conversations[0].turns[0].planContext={version:1};return value;};await h.prepare();noPrepared(h);await h.sendRevision().catch(()=>{});assert.equal(h.requests.length,0);
});

test('source epoch change and a new explicit request retire a pending preparation',async()=>{
 for(const kind of ['epoch','request']){
  const h=revisionHarness();await h.seedParent();const gate=deferred();let reads=0;h.setRead(async(_id,path)=>{if(++reads===1)await gate.promise;return structuredClone(h.sources.get(path));});const pending=h.prepare();await tick();if(kind==='epoch')h.host.featureSourceEpoch++;else await h.ask('ask',{requestId:'independent-request'});gate.resolve();await pending;noPrepared(h);assert.equal(h.requests.length,kind==='request'?1:0);
 }
});
