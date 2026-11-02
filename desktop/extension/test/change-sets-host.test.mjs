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
 vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,URL,AbortController,TextDecoder,setTimeout,clearTimeout,fetch:async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return fetchHook?fetchHook(url,options):response([{type:'done'}]);},require:name=>{
  if(name.includes('execution-session'))return{changeGroupDigest:proposalModule.changeGroupDigest};if(name==='vscode')return vscode;if(name.includes('assistant-artifacts'))return artifactModule;if(name.includes('assistant.mjs'))return assistantModule;if(name.includes('conversation-store'))return storeModule;if(name.includes('safety'))return safety;if(name.includes('proposals.mjs'))return proposalModule;
  if(name.includes('assistant-bridge'))return{createAssistantBridge:async()=>bridgeHook?bridgeHook():{url:'http://127.0.0.1:1',token:'fixture-only',close:async()=>{}}};
  if(name.startsWith('node:'))return requireProject(name);return{};
 }});
 const host=Object.create(module.exports.FoundationHost.prototype);
 Object.assign(host,{project:structuredClone(project),disposed:false,context:{workspaceState:{get:key=>structuredClone(persisted.get(key)),update:async(key,value)=>{if(writeHook)await writeHook(key,value);persisted.set(key,structuredClone(value));writes.push({key,value:structuredClone(value)});}}},
  changeSetSessions:new Map(),changeSetActionGeneration:0,changeSetOperationGuards:new Map(),snapshots:new Map(),design:{files:[],status:"idle"},refresh:async()=>{},conversationStores:new Map(),queueConversationState(){},sendState(){},askGeneration:0,focusGeneration:0,featureSourceEpoch:0,planActionGeneration:0,artifactSourceFiles:[],artifactSourceUnavailable:[],openFiles:structuredClone(originalFiles),featureFiles:[],activeFile:structuredClone(originalFiles[0]),panel:{viewColumn:1,webview:{postMessage:message=>messages.push(structuredClone(message))}},dirtyPaths:()=>[...dirty],assistant:{status:()=>({configured:true,model:'fixture-model',providerKind:'compatible'})},
  assistantView:{visible:true,webview:{postMessage:message=>messages.push(structuredClone(message))}},proposals:()=>({current:()=>null,set:async(value,{isCurrent})=>{if(isCurrent())proposals.push(structuredClone(value));}}),service:{getFile:async(id,path)=>{reads.push({id,path});return readHook?readHook(id,path):structuredClone(sources.get(path));}}});
 const store=host.conversations();
 const session={
  snapshot:()=>({schemaVersion:1,projectId:project.id,current:group?structuredClone(group):null,storage:{...storage},busy,checkpoints:[]}),
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

const buildGroup=()=>proposalModule.createBuildArtifact({projectId:project.id,files:originalFiles,raw:JSON.stringify({title:'Clarify coordinated save',summary:'Update two selected existing files.',edits:[{path:'src/Button.tsx',find:'>Save</button>',replace:'>Save changes</button>'},{path:'src/api.ts',find:'Promise.resolve(true)',replace:'Promise.resolve(false)'}],verification:['Inspect the save scenario.']})}).changeSet;
async function seedGroup(h){h.setFetch(()=>response([{type:'start',intent:'build'},{type:'delta',text:'Complete group JSON'},{type:'changeSet',changeSet:buildGroup()},{type:'done'}]));await h.ask();assert.equal(h.turn('new-request')?.state,'complete',JSON.stringify(h.messages));return h.session.snapshot().current;}

test('direct Build opts into groups and records one staged immutable artifact without applying files or starting runtime',async()=>{
 const h=harness(),group=await seedGroup(h);assert.equal(h.requests[0].body.changeSets,true);assert.equal(h.requests[0].body.context.length,3);assert.equal(h.stageCalls.length,1);assert.equal(h.actionCalls.filter(call=>call.action!=='assess').length,0);assert.equal(h.commands.length+h.documents.length,0);assert.equal(h.proposals.length,0);
 assert.equal(group.files.length,2);assert.equal(group.context.length,3);assert.deepEqual(h.turn('new-request').changeSet,group);assert.equal(h.turn('new-request').changeSet.verificationStatus,'not-run');assert.equal(h.store.snapshot().storage.status,'saved');
 for(const intent of ['ask','plan','review']){const other=harness();await other.ask(intent);assert.equal(other.requests[0].body.changeSets,undefined);}
 const planned=harness();await planned.seed();await planned.ask('build',{context:[{path:originalFiles[0].path,revision:originalFiles[0].revision}],planContext:planned.descriptor()});assert.equal(planned.requests[0].body.changeSets,undefined);assert.ok(planned.requests[0].body.planContext);
});

test('wrong mode and mismatched disclosed source are rejected before staging any group',async()=>{
 for(const intent of ['ask','plan','review']){const h=harness();h.setFetch(()=>response([{type:'changeSet',changeSet:buildGroup()},{type:'done'}]));await h.ask(intent);assert.equal(h.stageCalls.length,0);assert.equal(h.turn('new-request').state,'failed');}
 for(const mutate of [g=>g.context.pop(),g=>g.context.reverse(),g=>g.files[0].before='different',g=>g.files[0].baseRevision='old',g=>g.projectId='foreign',g=>g.revision=1,g=>g.status='applied',g=>g.files=[],g=>g.files[1].id=g.files[0].id]){
  const h=harness(),group=buildGroup();mutate(group);h.setFetch(()=>response([{type:'changeSet',changeSet:group},{type:'done'}]));await h.ask();assert.equal(h.stageCalls.length,0);assert.equal(h.turn('new-request').state,'failed');
 }
});

test('a mixed proposal and group stream cannot stage a second artifact for the same Build',async()=>{
 const h=harness(),source=originalFiles[0],proposal={id:'legacy-proposal',projectId:project.id,title:'One file',summary:'Label only',path:source.path,before:source.source,after:source.source.replace('Save','Save changes'),baseRevision:source.revision,status:'proposed',origin:'ai',context:originalFiles.map(({path,revision})=>({path,revision})),verification:[]};
 h.setFetch(()=>response([{type:'proposal',proposal},{type:'changeSet',changeSet:buildGroup()},{type:'done'}]));await h.ask();assert.equal(h.proposals.length,1);assert.equal(h.stageCalls.length,0);assert.equal(h.turn('new-request').state,'failed');
});

test('cancelled, superseded or foreign-project staging cannot publish a group completion',async()=>{
 for(const mutate of [h=>h.host.asking.abort.abort(),h=>h.host.askGeneration++,h=>h.host.project={...project,id:'other'},h=>h.host.project={...project,root:'/other'},h=>h.vscode.workspace.isTrusted=false,h=>h.host.disposed=true]){
  const h=harness(),gate=deferred();h.setStage(()=>gate.promise);h.setFetch(()=>response([{type:'changeSet',changeSet:buildGroup()},{type:'done'}]));const asking=h.ask();await tick();assert.equal(h.stageCalls.length,1);mutate(h);gate.resolve();await asking;assert.equal(h.session.snapshot().current,null);assert.equal(h.messages.some(message=>message.event?.type==='changeSet'||message.event?.type==='done'),false);
 }
});

test('group actions reject wrong identity, revision, trust, busy requests, and unavailable checkpoint ownership',async()=>{
 for(const mutate of [h=>({projectId:'foreign'}),h=>({changeSetId:'other'}),h=>({expectedRevision:99}),h=>({action:'execute'}),h=>{h.vscode.workspace.isTrusted=false;return{};},h=>{h.host.disposed=true;return{};},h=>{h.host.asking={};return{};},h=>{h.setBusy(true);return{};}]){
  const h=harness();await seedGroup(h);h.actionCalls.length=0;await assert.rejects(h.groupAction('apply',mutate(h)));assert.equal(h.actionCalls.length,0);
 }
});

test('archived, partial, unsaved and inactive Assistant history cannot apply or undo the current group',async()=>{
 for(const kind of ['archive','partial','storage','inactive'])for(const action of ['apply','undo']){
  const h=harness();await seedGroup(h);if(kind==='archive')await h.store.archive(h.store.snapshot().activeId);if(kind==='inactive')await h.store.newConversation();
  if(kind==='storage'||kind==='partial'){const snapshot=h.store.snapshot.bind(h.store);h.store.snapshot=()=>{const value=snapshot();if(kind==='storage')value.storage.status='error';else value.conversations[0].turns[0].completedWhileStopping=true;return value;};}
  h.actionCalls.length=0;await assert.rejects(h.groupAction(action));assert.equal(h.actionCalls.length,0);
 }
});

test('local checkpoint source or intent tampering is refused before Apply or Undo',async()=>{
 for(const mutate of [g=>g.files[0].after+='\n//tampered',g=>g.title='Changed scope',g=>g.context.pop(),g=>g.files.reverse()])for(const action of ['apply','undo']){
  const h=harness(),group=await seedGroup(h);mutate(group);h.setGroup(group);h.actionCalls.length=0;await assert.rejects(h.groupAction(action),/does not match/);assert.equal(h.actionCalls.length,0);
 }
});

test('native diff uses host-owned file IDs and exact snapshots without source reads or changes',async()=>{
 const h=harness(),group=await seedGroup(h);h.reads.length=0;await h.groupAction('diff',{fileId:group.files[1].id,path:'private/forged',before:'FORGED',after:'FORGED'});
 assert.equal(h.commands.length,1);assert.equal(h.commands[0][0],'vscode.diff');assert.match(h.commands[0][3],/^src\/api.ts/);assert.deepEqual([...h.host.snapshots.values()],[group.files[1].before,group.files[1].after]);assert.equal(h.reads.length+h.documents.length,0);
 await assert.rejects(h.groupAction('diff',{fileId:'invented'}),/Choose a file/);assert.equal(h.commands.length,1);
});

test('pending diff load cannot steal focus or survive view, project, trust or newer-action changes',async()=>{
 for(const mutate of [h=>h.host.focusGeneration++,h=>h.host.assistantView={webview:{}},h=>h.host.project={...project,id:'other'},h=>h.vscode.workspace.isTrusted=false,h=>h.host.changeSetActionGeneration++]){
  const h=harness(),group=await seedGroup(h),gate=deferred();h.setLoad(()=>gate.promise);const action=h.groupAction('diff',{fileId:group.files[0].id});await tick();mutate(h);gate.resolve();await action;assert.equal(h.commands.length,0);
 }
});

test('in-progress operations retain ownership guards across awaited work and preserve checkpoint on interruption',async()=>{
 for(const mutate of [h=>h.host.project={...project,id:'other'},h=>h.host.project={...project,root:'/other'},h=>h.host.assistantView={webview:{}},h=>h.vscode.workspace.isTrusted=false,h=>h.host.changeSetActionGeneration++,async h=>h.store.archive(h.store.snapshot().activeId),async h=>h.store.newConversation()]){
  const h=harness(),group=await seedGroup(h),gate=deferred();h.setAction(()=>gate.promise);const action=h.groupAction('apply');await tick();assert.equal(h.actionCalls.at(-1).action,'apply');await mutate(h);gate.resolve();await assert.rejects(action);assert.equal(h.host.changeSetOperationGuards.size,0);assert.equal(h.session.snapshot().current.id,group.id);
 }
});

test('active and unavailable groups block legacy proposal preparation, and busy operations block provider dispatch',async()=>{
 const h=harness(),group=await seedGroup(h);const initialRequests=h.requests.length;await h.ask('build',{requestId:'blocked-build'});assert.equal(h.requests.length,initialRequests);assert.equal(h.proposals.length,0);
 h.setBusy(true);await assert.rejects(h.ask('ask',{requestId:'busy-ask'}),/checkpoint operation/);assert.equal(h.requests.length,initialRequests);
 h.setBusy(false);h.setGroup({...group,status:'discarded',revision:1});h.setStorage({status:'unavailable'});await h.ask('build',{requestId:'unavailable-build'});assert.equal(h.requests.length,initialRequests);
});
