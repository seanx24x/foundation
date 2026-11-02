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
const investigationModule=await import(join(root,'server/project/source-investigation.mjs'));
const {analyzeRelationships}=await import(join(root,'server/project/relationships.mjs'));
const compiled=ts.transpileModule(`${readFileSync(join(root,'desktop/extension/src/extension.ts'),'utf8')}\nexport { FoundationHost };`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const {changeGroupDigest}=await import(join(root,'desktop/extension/src/execution-session.mjs'));
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
  if(name.includes('source-investigation'))return investigationModule;if(name.includes('execution-session'))return{changeGroupDigest};if(name==='vscode')return vscode;if(name.includes('assistant-artifacts'))return artifactModule;if(name.includes('assistant.mjs'))return assistantModule;if(name.includes('conversation-store'))return storeModule;if(name.includes('safety'))return safety;if(name.includes('proposals.mjs'))return proposalModule;
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


const plain=value=>JSON.parse(JSON.stringify(value));
const sourceFiles=[
 file('src/Button.tsx',"import {saveProfile} from './api';\nexport function Button() { return saveProfile(); }\n"),
 file('src/api.ts',"export function saveProfile() { return fetch('/api/profile?token=PRIVATE_RELATED_QUERY'); }\n"),
 file('src/consumer.ts',"import {Button} from './Button';\nexport const consumer = Button;\n"),
 file('src/PRIVATE_UNRELATED.ts',"export const privateValue = 'PRIVATE_UNSHARED_SOURCE';\n"),
 file('src/Button.spec.ts',"export const filenameCandidateOnly = 'PRIVATE_FILENAME_CANDIDATE';\n"),
];
async function investigationHarness(){
 const h=harness();h.sources.clear();for(const source of sourceFiles)h.sources.set(source.path,structuredClone(source));h.host.project.files=sourceFiles.map(({path})=>({path}));
 const features={projectId:project.id,revision:1,activeId:'feature-1',storage:{status:'saved'},features:[{id:'feature-1',title:'Profile save',paths:['src/Button.tsx'],entryPath:'src/Button.tsx',archived:false}]};
 const validations=[],queries=[];let graphHook,validateHook;
 Object.assign(h.host,{featureSnapshot:()=>structuredClone(features),relationshipSnapshot:null,relationshipOwner:undefined,relationshipTrail:[],relationshipStatus:'idle',relationshipSnapshotId:null,relationshipNavigationGeneration:0,relationshipMessage:'',relationshipEpoch:0,relationshipGeneration:0,relationshipTask:undefined,relationshipLoadKey:'',queueRefresh(){},assistantContextFiles:[],assistantContextEpoch:-1});
 h.host.service.relationships=async(id,anchor,options)=>{queries.push({id,anchor,options});return graphHook?graphHook(id,anchor,options):analyzeRelationships({projectId:id,anchorPath:anchor,files:[...h.sources.values()],isCurrent:options.isCurrent});};
 h.host.service.validateRelationships=async(id,graph,options)=>{validations.push({id,graph,options});return validateHook?validateHook(id,graph,options):true;};
 const api=Object.assign(h,{features,queries,validations,setGraph:hook=>graphHook=hook,setValidate:hook=>validateHook=hook,
  prepared:()=>h.messages.filter(message=>message.type==='sourceInvestigationPrepared').at(-1),
  investigationResult:()=>h.messages.filter(message=>message.type==='sourceInvestigationResult').at(-1),
  state:()=>h.host.sourceInvestigationState(),
  async prepare(extra={}){const relationships=h.host.relationshipState();return h.host.sourceInvestigationAction({type:'sourceInvestigationAction',action:'prepare',prepareId:'prepare-investigation-1',projectId:project.id,featureId:features.activeId,featureRevision:features.revision,conversationId:h.store.snapshot().activeId,anchorPath:relationships.anchorPath,snapshotId:relationships.snapshotId,...extra},'assistant');},
  async refresh(extra={}){return h.host.sourceInvestigationAction({type:'sourceInvestigationAction',action:'refresh',prepareId:'refresh-investigation-1',projectId:project.id,featureId:features.activeId,featureRevision:features.revision,conversationId:h.store.snapshot().activeId,anchorPath:'src/Button.tsx',...extra},'assistant');},
  descriptor(){const value=api.prepared().sourceInvestigation;return{version:1,id:value.id,digest:value.digest};},
  async send(extra={}){return h.host.ask({type:'ask',requestId:'investigation-request',projectId:project.id,conversationId:h.store.snapshot().activeId,intent:'ask',prompt:'Explain this saved source relationship.',context:api.prepared().context,sourceInvestigation:api.descriptor(),...extra});},
 });
 await h.host.loadRelationships();return api;
}

const successfulResponse=()=>response([{type:'start',intent:'ask',model:'fixture-model'},{type:'delta',text:'The saved source calls the service; backend behavior is unknown.'},{type:'done',model:'fixture-model'}]);
const noActions=h=>{assert.equal(h.requests.length,0);assert.equal(h.documents.length+h.editors.length+h.commands.length+h.proposals.length,0);assert.equal(h.store.snapshot().conversations.length,0);};

test('Prepare builds canonical bounded local evidence and only the anchor context without AI or source mutation',async()=>{
 const h=await investigationHarness(),before=structuredClone([...h.sources.values()]);h.dirty.add('src/PRIVATE_UNRELATED.ts');await h.prepare();const prepared=h.prepared();assert.ok(prepared,JSON.stringify(h.messages));assert.deepEqual(prepared.context,[{path:'src/Button.tsx',revision:h.sources.get('src/Button.tsx').revision}]);assert.deepEqual(plain(investigationModule.validateSourceInvestigation(prepared.sourceInvestigation,project.id,[h.sources.get('src/Button.tsx')])),prepared.sourceInvestigation);assert.equal(h.state().status,'ready');assert.ok(prepared.sourceInvestigation.edges.length);assert.equal(h.host.currentAssistantContextFiles().length,1);assert.doesNotMatch(JSON.stringify(prepared),/PRIVATE_UNSHARED_SOURCE|PRIVATE_RELATED_QUERY|PRIVATE_FILENAME_CANDIDATE|PRIVATE_UNRELATED|manifest|candidates/);noActions(h);assert.deepEqual([...h.sources.values()],before);
});

test('Dirty anchor and displayed supporting source block sharing while an unrelated unsaved draft remains usable',async()=>{
 for(const path of ['src/Button.tsx','src/api.ts','src/consumer.ts','src/PRIVATE_UNRELATED.ts','src/Button.spec.ts']){const h=await investigationHarness();await h.prepare();h.dirty.add(path);const affected=['src/Button.tsx','src/api.ts','src/consumer.ts'].includes(path);assert.equal(h.state().status,affected?'blocked':'ready');if(affected)assert.throws(()=>h.host.resolveSourceInvestigation(h.descriptor()),/unsaved/);else assert.ok(h.host.resolveSourceInvestigation(h.descriptor()));noActions(h);}
});

test('Prepare requires exact project, feature, conversation, anchor and graph identities',async()=>{
 for(const extra of [{projectId:'other'},{featureId:'other'},{featureRevision:2},{conversationId:'other'},{snapshotId:'stale'},{anchorPath:'src/api.ts'},{anchorPath:'../outside.ts'}]){const h=await investigationHarness();try{await h.prepare(extra);}catch{}assert.equal(h.prepared(),undefined,JSON.stringify(extra));noActions(h);}
});

test('Failed full-manifest validation withholds result and exposes no private source or paths',async()=>{
 const h=await investigationHarness();h.setValidate(()=>false);await h.prepare();assert.equal(h.prepared(),undefined);assert.equal(h.state(),null);assert.match(h.investigationResult().error,/saved source changed|fully verified/);assert.doesNotMatch(JSON.stringify(h.messages),/PRIVATE_UNSHARED|PRIVATE_RELATED|PRIVATE_UNRELATED/);noActions(h);
});

test('Pending prepare is retired by removal, owner changes, source epochs, trust and superseding work',async()=>{
 for(const mutate of [h=>h.features.activeId='other',h=>h.features.revision++,h=>h.host.project={...h.host.project,root:'/other'},h=>h.host.assistantView={webview:{postMessage(){}}},h=>h.host.relationshipEpoch++,h=>h.vscode.workspace.isTrusted=false,h=>h.host.disposed=true,async h=>h.host.sourceInvestigationAction({action:'remove',prepareId:'prepare-investigation-1',projectId:project.id,featureId:h.features.activeId,featureRevision:h.features.revision,conversationId:h.store.snapshot().activeId})]){const h=await investigationHarness(),gate=deferred(),entered=deferred();h.setValidate(async()=>{entered.resolve();await gate.promise;return true;});const preparing=h.prepare();await entered.promise;await mutate(h);gate.resolve();await preparing;assert.equal(h.prepared(),undefined,mutate.toString());noActions(h);}
});

test('Refresh computes a new canonical result after stale source and never silently reuses a descriptor',async()=>{
 const h=await investigationHarness();await h.prepare();const first=h.descriptor();h.host.invalidateRelationships();assert.equal(h.state().status,'stale');assert.throws(()=>h.host.resolveSourceInvestigation(first),/Refresh/);await h.refresh();assert.notEqual(h.descriptor().id,first.id);assert.notEqual(h.descriptor().digest,first.digest);assert.equal(h.state().status,'ready');assert.throws(()=>h.host.resolveSourceInvestigation(first),/Refresh/);noActions(h);
});

test('Explicit Ask stores exact shared evidence and sole anchor, including a newly created conversation',async()=>{
 const h=await investigationHarness();await h.prepare();const result=h.prepared().sourceInvestigation;assert.equal(h.store.snapshot().activeId,null);h.setFetch(successfulResponse);await h.send();const turn=h.turn('investigation-request');assert.equal(turn?.state,'complete',JSON.stringify(h.messages));assert.deepEqual(turn.sourceInvestigation,result);assert.equal(turn.intent,'ask');assert.equal(turn.context.length,1);assert.equal(turn.context[0].path,'src/Button.tsx');assert.equal(turn.runtimeEvidence,undefined);assert.equal(turn.taskContext,undefined);assert.equal(h.host.investigationBinding.conversationId,h.store.snapshot().activeId);assert.equal(h.requests.length,1);assert.deepEqual(plain(h.requests[0].body.sourceInvestigation),h.descriptor());assert.doesNotMatch(JSON.stringify(h.requests),/PRIVATE_UNSHARED_SOURCE|PRIVATE_RELATED_QUERY|PRIVATE_FILENAME_CANDIDATE|PRIVATE_UNRELATED|manifest/);assert.equal(h.documents.length+h.editors.length+h.commands.length+h.proposals.length,0);
});

test('Ask refuses injected full results, stale descriptors, alternate source context and mixed handoffs before dispatch',async()=>{
 for(const extra of [{intent:'plan'},{intent:'build'},{intent:'review'},{context:[{path:'src/api.ts',revision:'0'.repeat(16)}]},{taskContext:{}},{runtimeContext:{}},{requestRevision:{}},{planContext:{}},{groupRevision:{}},{checkContext:{}},{sourceInvestigation:{version:1,id:'00000000-0000-4000-8000-000000000001',digest:'f'.repeat(64)}},h=>({sourceInvestigation:h.prepared().sourceInvestigation})]){const h=await investigationHarness();await h.prepare();await assert.rejects(h.send(typeof extra==='function'?extra(h):extra));noActions(h);}
});

test('Source, feature, editor, conversation and trust races before dispatch prevent a provider call',async()=>{
 for(const mutate of [h=>h.dirty.add('src/api.ts'),h=>h.host.relationshipEpoch++,h=>h.features.revision++,h=>h.host.assistantView={webview:{postMessage(){}}},h=>h.host.project={...h.host.project,root:'/other'},h=>h.vscode.workspace.isTrusted=false]){const h=await investigationHarness();await h.prepare();h.setBridge(async()=>{mutate(h);return{url:'http://127.0.0.1:1',token:'fixture-only',close:async()=>{}};});await h.send();assert.equal(h.requests.length,0);assert.notEqual(h.turn('investigation-request')?.state,'complete');}
});

test('Provider resolution accepts only the exact active request and revalidates supporting saved source',async()=>{
 const h=await investigationHarness();await h.prepare();await assert.rejects(h.host.resolveProviderSourceInvestigation({projectId:project.id,...h.descriptor()}),/active/);const entered=deferred(),finish=deferred();h.setFetch(async()=>{entered.resolve();return finish.promise;});const pending=h.send();await entered.promise;assert.deepEqual(await h.host.resolveProviderSourceInvestigation({projectId:project.id,...h.descriptor()}),h.prepared().sourceInvestigation);await assert.rejects(h.host.resolveProviderSourceInvestigation({projectId:'other',...h.descriptor()}),/active/);h.setValidate(()=>false);await assert.rejects(h.host.resolveProviderSourceInvestigation({projectId:project.id,...h.descriptor()}),/changed|verified/);finish.resolve(successfulResponse());await pending;assert.notEqual(h.turn('investigation-request').state,'complete');
});

test('Changed evidence during streaming cannot be recorded as a completed investigation answer',async()=>{
 for(const mutate of [h=>h.dirty.add('src/api.ts'),h=>h.host.relationshipEpoch++,h=>h.features.revision++,h=>h.setValidate(()=>false)]){const h=await investigationHarness();await h.prepare();h.setFetch(()=>{let index=0;return{ok:true,body:{getReader:()=>({read:async()=>{if(index++===0)return{done:false,value:Buffer.from(JSON.stringify({type:'delta',text:'Partial source interpretation'})+'\n')};if(index===2){mutate(h);return{done:false,value:Buffer.from(JSON.stringify({type:'done'})+'\n')};}return{done:true};}})}};});await h.send();const turn=h.turn('investigation-request');assert.notEqual(turn?.state,'complete');assert.deepEqual(turn.sourceInvestigation,h.prepared().sourceInvestigation);assert.equal(h.requests.length,1);}
});

test('Stop retires investigation dispatch before a late bridge or response can complete it',async()=>{
 const h=await investigationHarness();await h.prepare();const entered=deferred(),finish=deferred();h.setBridge(async()=>{entered.resolve();await finish.promise;return{url:'http://127.0.0.1:1',token:'fixture-only',close:async()=>{}};});const pending=h.send();await entered.promise;h.host.cancelQuestion();finish.resolve();await pending;assert.equal(h.requests.length,0);assert.equal(h.turn('investigation-request')?.state,'stopped');await assert.rejects(h.host.resolveProviderSourceInvestigation({projectId:project.id,...h.descriptor()}),/active/);
});

test('A persisted result has no fresh-process authority until explicitly refreshed',async()=>{
 const old=await investigationHarness();await old.prepare();const descriptor=old.descriptor();const fresh=await investigationHarness();assert.equal(fresh.state(),null);assert.throws(()=>fresh.host.resolveSourceInvestigation(descriptor),/Refresh/);await fresh.refresh();assert.notEqual(fresh.descriptor().id,descriptor.id);noActions(fresh);
});

test('Generic request revision cannot drop investigation evidence from a saved answer',async()=>{
 const h=await investigationHarness();await h.prepare();h.setFetch(successfulResponse);await h.send();assert.throws(()=>h.host.resolveRequestRevision({version:1,conversationId:h.store.snapshot().activeId,requestId:'investigation-request'}),/source investigation/);assert.equal(h.requests.length,1);
});


test('Delayed Remove is bound to its exact result or pending preparation and cannot clear a newer result',async()=>{
 const h=await investigationHarness();await h.prepare();const previous=h.descriptor();await h.refresh();const current=h.descriptor();const owner={action:'remove',projectId:project.id,featureId:h.features.activeId,featureRevision:h.features.revision,conversationId:h.store.snapshot().activeId};await h.host.sourceInvestigationAction({...owner,sourceInvestigation:previous});assert.equal(h.state().id,current.id);await h.host.sourceInvestigationAction({...owner,prepareId:'prepare-investigation-1'});assert.equal(h.state().id,current.id);await h.host.sourceInvestigationAction({...owner,sourceInvestigation:current});assert.equal(h.state(),null);noActions(h);
});

test('Workspace investigation waits for a ready visible Assistant and then offers exact current ownership once',async()=>{
 const h=await investigationHarness();h.host.assistantReady=false;h.host.assistantOpen=false;let revealed=0;h.host.showAssistant=async()=>{revealed++;h.host.assistantOpen=true;};const state=h.host.relationshipState();await h.host.message({type:'featureRelationships',action:'investigate',projectId:project.id,featureId:h.features.activeId,featureRevision:h.features.revision,snapshotId:state.snapshotId},'workspace');assert.equal(revealed,1);assert.equal(h.messages.some(item=>item.type==='prepareSourceInvestigation'),false);assert.equal(h.state(),null);await h.host.message({type:'ready'},'assistant');const offers=h.messages.filter(item=>item.type==='prepareSourceInvestigation');assert.equal(offers.length,1);assert.deepEqual(offers[0],{type:'prepareSourceInvestigation',projectId:project.id,featureId:h.features.activeId,featureRevision:h.features.revision,conversationId:null,anchorPath:state.anchorPath,snapshotId:state.snapshotId});h.host.flushAssistantPreparation();assert.equal(h.messages.filter(item=>item.type==='prepareSourceInvestigation').length,1);noActions(h);
});

test('Late Assistant readiness cannot revive an offer after source, feature or project ownership changes',async()=>{
 for(const mutate of [h=>h.features.revision++,h=>h.features.activeId='other',h=>h.host.relationshipSnapshotId='new-snapshot',h=>h.host.project={...h.host.project,id:'other'},h=>h.vscode.workspace.isTrusted=false]){const h=await investigationHarness();h.host.assistantReady=false;h.host.assistantOpen=false;h.host.showAssistant=async()=>{h.host.assistantOpen=true;};await h.host.relationshipAction({type:'featureRelationships',action:'investigate',projectId:project.id,featureId:h.features.activeId,featureRevision:h.features.revision,snapshotId:h.host.relationshipState().snapshotId});mutate(h);h.host.assistantReady=true;h.host.flushAssistantPreparation();assert.equal(h.messages.some(item=>item.type==='prepareSourceInvestigation'),false,mutate.toString());assert.equal(h.requests.length,0);assert.equal(h.state(),null);}
});

test('Collapsing a cold Assistant discards its queued offer before a later reopen becomes ready',async()=>{
 const h=await investigationHarness();h.host.assistantReady=false;h.host.assistantOpen=false;h.host.showAssistant=async()=>{h.host.assistantOpen=true;};await h.host.relationshipAction({type:'featureRelationships',action:'investigate',projectId:project.id,featureId:h.features.activeId,featureRevision:h.features.revision,snapshotId:h.host.relationshipState().snapshotId});assert.ok(h.host.investigationOffer);h.vscode.commands.executeCommand=async name=>{assert.equal(name,'workbench.action.closeAuxiliaryBar');h.host.assistantView.visible=false;};await h.host.setAssistantVisible(false);assert.equal(h.host.investigationOffer,undefined);h.host.assistantView.visible=true;h.host.assistantOpen=true;h.host.assistantReady=true;h.host.flushAssistantPreparation();assert.equal(h.messages.some(item=>item.type==='prepareSourceInvestigation'),false);noActions(h);
});
