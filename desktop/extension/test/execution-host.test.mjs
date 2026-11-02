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
  if(name.includes('execution-session'))return{changeGroupDigest};if(name==='vscode')return vscode;if(name.includes('assistant-artifacts'))return artifactModule;if(name.includes('assistant.mjs'))return assistantModule;if(name.includes('conversation-store'))return storeModule;if(name.includes('safety'))return safety;if(name.includes('proposals.mjs'))return proposalModule;
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

const buildGroup=()=>proposalModule.createBuildArtifact({projectId:project.id,files:originalFiles,raw:JSON.stringify({title:'Clarify coordinated save',summary:'Update two selected existing files.',edits:[{path:'src/Button.tsx',find:'>Save</button>',replace:'>Save changes</button>'},{path:'src/api.ts',find:'Promise.resolve(true)',replace:'Promise.resolve(false)'}],verification:['Inspect the save scenario.']})}).changeSet;
async function seedGroup(h){h.setFetch(()=>response([{type:'start',intent:'build'},{type:'delta',text:'Complete group JSON'},{type:'changeSet',changeSet:buildGroup()},{type:'done'}]));await h.ask();assert.equal(h.turn('new-request')?.state,'complete',JSON.stringify(h.messages));return h.session.snapshot().current;}


function executionHarness(){
 const h=harness();let execution=null,executionBusy=false,executionStorage={status:'saved'},prepareHook,runHook,loadHook;
 const calls=[];
 const executionSession={
  snapshot:()=>({current:execution?structuredClone(execution):null,history:[],busy:executionBusy,storage:{...executionStorage},capabilities:{supported:true,network:'blocked',filesystem:'isolated-copy'},assessment:{canPrepare:!executionBusy,canRun:!executionBusy&&execution?.status==='ready',canStop:executionBusy}}),
  async load(){calls.push({action:'load'});if(loadHook)await loadHook();return this.snapshot();},
  async prepare(group,{guard}={}){calls.push({action:'prepare',group:structuredClone(group)});await guard?.();if(prepareHook)await prepareHook(group);await guard?.();execution={id:'c2b8a6c9-0934-4df6-83d5-02aa18d96091',projectId:project.id,groupId:group.id,groupRevision:group.revision,groupDigest:changeGroupDigest(group),revision:1,status:'ready',tasks:[{id:'node:test',label:'Node tests',command:'node --test test/check.test.mjs'}],output:'',outputTruncated:false};return this.snapshot();},
  async run(id,revision,taskId,{guard}={}){calls.push({action:'run',id,revision,taskId});await guard?.();if(runHook)await runHook();await guard?.();return this.snapshot();},
  async stop(id,revision){calls.push({action:'stop',id,revision});executionBusy=false;if(execution)execution={...execution,status:'cancelled',revision:execution.revision+1};return this.snapshot();},
  async retry(){calls.push({action:'retry'});return this.snapshot();},
  async dispose(){calls.push({action:'dispose'});},
 };
 h.host.executionSessions=new Map([[project.id,executionSession]]);h.host.executionActionGeneration=0;h.host.executions=()=>executionSession;
 const emptyPlanSession={snapshot:()=>({current:null,history:[],busy:false,storage:{status:'saved'},assessment:{canCreate:true}}),async load(){return this.snapshot();}};h.host.checkPlanSessions=new Map([[project.id,emptyPlanSession]]);h.host.checkPlans=()=>emptyPlanSession;
 return Object.assign(h,{executionSession,executionCalls:calls,setExecution:value=>execution=structuredClone(value),setExecutionBusy:value=>executionBusy=value,setExecutionStorage:value=>executionStorage=value,setExecutionLoad:hook=>loadHook=hook,setPrepare:hook=>prepareHook=hook,setRun:hook=>runHook=hook,
  execute(action,extra={},surface='assistant'){const group=h.session.snapshot().current,current=executionSession.snapshot().current;return h.host.executionAction({type:'executionAction',action,projectId:project.id,changeSetId:group?.id,expectedGroupRevision:group?.revision,executionId:current?.id,expectedRevision:current?.revision,...extra},surface);},
 });
}
const mutations=calls=>calls.filter(call=>call.action!=='load');

test('isolated preparation resolves exact host group; provider generation alone never prepares or runs tools',async()=>{
 const h=executionHarness(),group=await seedGroup(h);assert.equal(mutations(h.executionCalls).length,0);const filesBefore=structuredClone([...h.sources]);
 await h.execute('prepare',{group:{files:[{path:'forged',after:'untrusted'}]},root:'/private/forged',command:'rm -rf source'});
 assert.equal(mutations(h.executionCalls).length,1);assert.equal(mutations(h.executionCalls)[0].action,'prepare');assert.deepEqual(mutations(h.executionCalls)[0].group,group);assert.deepEqual([...h.sources],filesBefore);assert.equal(h.requests.length,1);assert.equal(h.commands.length+h.documents.length,0);
});

test('preparation rejects untrusted or foreign project, wrong group revision, active group writes and active provider request',async()=>{
 for(const mutate of [h=>({projectId:'foreign'}),h=>({changeSetId:'foreign'}),h=>({expectedGroupRevision:99}),h=>({action:'shell'}),h=>{h.vscode.workspace.isTrusted=false;return{};},h=>{h.host.disposed=true;return{};},h=>{h.host.asking={};return{};},h=>{h.setBusy(true);return{};}]){
  const h=executionHarness();await seedGroup(h);h.executionCalls.length=0;await assert.rejects(h.execute('prepare',mutate(h)));assert.equal(mutations(h.executionCalls).length,0);
 }
});

test('archived, incomplete, unsaved and inactive Assistant history cannot prepare execution',async()=>{
 for(const kind of ['archive','partial','storage','inactive']){
  const h=executionHarness();await seedGroup(h);if(kind==='archive')await h.store.archive(h.store.snapshot().activeId);if(kind==='inactive')await h.store.newConversation();
  if(kind==='partial'||kind==='storage'){const snapshot=h.store.snapshot.bind(h.store);h.store.snapshot=()=>{const value=snapshot();if(kind==='partial')value.conversations[0].turns[0].completedWhileStopping=true;else value.storage.status='error';return value;};}
  h.executionCalls.length=0;await assert.rejects(h.execute('prepare'));assert.equal(mutations(h.executionCalls).length,0);
 }
});

test('changed group content, applied groups, stale/missing disclosed source and native drafts cannot prepare',async()=>{
 for(const kind of ['content','title','summary','malformed','status','stale','missing','dirty']){
  const h=executionHarness(),group=await seedGroup(h);
  if(kind==='content'){group.files[0].after+='\n//different';h.setGroup(group);}if(kind==='title'){group.title='Different intent';h.setGroup(group);}if(kind==='summary'){group.summary='Different scope';h.setGroup(group);}if(kind==='malformed'){group.files[0].baseRevision='invalid';h.setGroup(group);}if(kind==='status')h.setGroup({...group,status:'applied'});
  if(kind==='stale')h.sources.set('src/consumer.ts',file('src/consumer.ts','changed saved dependency'));
  if(kind==='missing')h.setRead(async()=>{throw Error('unavailable');});if(kind==='dirty')h.dirty.add('src/consumer.ts');
  h.executionCalls.length=0;await assert.rejects(h.execute('prepare'));assert.equal(mutations(h.executionCalls).length,0);
 }
});

test('pending preparation is retired by changed project, trust, conversation or source before becoming runnable',async()=>{
 for(const mutate of [h=>h.host.project={...project,id:'other'},h=>h.host.project={...project,root:'/other'},h=>h.vscode.workspace.isTrusted=false,h=>h.host.disposed=true,h=>h.dirty.add('src/consumer.ts'),async h=>h.store.archive(h.store.snapshot().activeId)]){
  const h=executionHarness(),group=await seedGroup(h),gate=deferred();h.setPrepare(()=>gate.promise);const action=h.execute('prepare');await tick();assert.equal(mutations(h.executionCalls).at(-1)?.action,'prepare');await mutate(h);gate.resolve();await assert.rejects(action);assert.equal(h.executionSession.snapshot().current,null);assert.equal(h.session.snapshot().current.id,group.id);
 }
});

test('run accepts only exact execution revision and a host-advertised task; renderer command text has no authority',async()=>{
 const h=executionHarness();await seedGroup(h);await h.execute('prepare');
 for(const extra of [{executionId:'foreign'},{expectedRevision:99},{taskId:'shell'},{taskId:undefined}]){h.executionCalls.length=0;await assert.rejects(h.execute('run',extra));assert.equal(mutations(h.executionCalls).length,0);}
 h.executionCalls.length=0;await h.execute('run',{taskId:'node:test',command:'forged-shell',args:['secret'],cwd:'/private/forged'});assert.deepEqual(mutations(h.executionCalls),[{action:'run',id:h.executionSession.snapshot().current.id,revision:1,taskId:'node:test'}]);
});

test('run preflight rechecks saved source and drafts after the copy was prepared',async()=>{
 for(const kind of ['dirty','saved','missing']){
  const h=executionHarness();await seedGroup(h);await h.execute('prepare');if(kind==='dirty')h.dirty.add('src/consumer.ts');if(kind==='saved')h.sources.set('src/consumer.ts',file('src/consumer.ts','later source'));if(kind==='missing')h.setRead(async()=>{throw Error('unavailable');});
  h.executionCalls.length=0;await assert.rejects(h.execute('run',{taskId:'node:test'}));assert.equal(mutations(h.executionCalls).length,0);
 }
});

test('Stop remains explicit and usable after the owning conversation is archived; it never starts a replacement run',async()=>{
 const h=executionHarness();await seedGroup(h);await h.execute('prepare');h.setExecutionBusy(true);const current=h.executionSession.snapshot().current;h.setExecution({...current,status:'running'});await h.store.archive(h.store.snapshot().activeId);h.executionCalls.length=0;
 await h.execute('stop');assert.equal(mutations(h.executionCalls).length,1);assert.equal(mutations(h.executionCalls)[0].action,'stop');assert.equal(h.executionSession.snapshot().current.status,'cancelled');
});

test('a prepared workspace from a different group or digest cannot run, even when IDs look current',async()=>{
 for(const mutate of [record=>record.groupId='other',record=>record.groupRevision++,record=>record.groupDigest='different']){
  const h=executionHarness();await seedGroup(h);await h.execute('prepare');const record=h.executionSession.snapshot().current;mutate(record);h.setExecution(record);h.executionCalls.length=0;
  await assert.rejects(h.execute('run',{taskId:'node:test'}));assert.equal(mutations(h.executionCalls).length,0);
 }
});

test('the last asynchronous source read cannot hide a newly dirty contributing file',async()=>{
 const h=executionHarness();await seedGroup(h);h.setRead(async(id,path)=>{const source=structuredClone(h.sources.get(path));if(path==='src/consumer.ts')h.dirty.add('src/Button.tsx');return source;});h.executionCalls.length=0;
 await assert.rejects(h.execute('prepare'),/workspace changed|unsaved/);assert.equal(mutations(h.executionCalls).length,0);
});

test('pending run guards refuse project, source, draft, group and view changes before process launch',async()=>{
 for(const mutate of [h=>h.host.project={...project,id:'foreign'},h=>h.vscode.workspace.isTrusted=false,h=>h.host.assistantView={webview:{}},h=>h.dirty.add('src/api.ts'),h=>h.sources.set('src/consumer.ts',file('src/consumer.ts','changed before spawn')),h=>h.setGroup({...h.session.snapshot().current,revision:3})]){
  const h=executionHarness();await seedGroup(h);await h.execute('prepare');const gate=deferred();h.setRun(()=>gate.promise);const running=h.execute('run',{taskId:'node:test'});await tick();assert.equal(mutations(h.executionCalls).at(-1).action,'run');mutate(h);gate.resolve();await assert.rejects(running);
 }
});

test('Stop refuses forged identity and remains available when original source is now stale or a response is running',async()=>{
 const h=executionHarness();await seedGroup(h);await h.execute('prepare');const record=h.executionSession.snapshot().current;h.setExecution({...record,status:'running'});h.setExecutionBusy(true);h.executionCalls.length=0;
 for(const extra of [{executionId:'forged'},{expectedRevision:99},{changeSetId:'forged'}])await assert.rejects(h.execute('stop',extra));assert.equal(mutations(h.executionCalls).length,0);
 h.dirty.add('src/api.ts');h.host.asking={};await h.execute('stop');assert.equal(mutations(h.executionCalls).length,1);assert.equal(mutations(h.executionCalls)[0].action,'stop');
});

test('changing conversations preserves an owned preparation but cannot start Run from another Assistant chat',async()=>{
 const h=executionHarness();await seedGroup(h);const gate=deferred();h.setPrepare(()=>gate.promise);const preparing=h.execute('prepare');await tick();await h.store.newConversation();gate.resolve();await preparing;assert.equal(h.executionSession.snapshot().current.status,'ready');h.executionCalls.length=0;
 await assert.rejects(h.execute('run',{taskId:'node:test'}));assert.equal(mutations(h.executionCalls).length,0);
});

test('ordinary history saves do not cancel an owned preparation or execute another provider request',async()=>{
 const h=executionHarness();await seedGroup(h);const gate=deferred();h.setPrepare(()=>gate.promise);const preparing=h.execute('prepare');await tick();const snapshot=h.store.snapshot.bind(h.store);h.store.snapshot=()=>({...snapshot(),storage:{status:'saving'}});gate.resolve();await preparing;assert.equal(h.executionSession.snapshot().current.status,'ready');assert.equal(h.requests.length,1);
});

test('Stop accepts a stale displayed revision of the same running execution, without accepting future or negative revisions',async()=>{
 const h=executionHarness();await seedGroup(h);await h.execute('prepare');const record=h.executionSession.snapshot().current;h.setExecution({...record,status:'running',revision:4});h.setExecutionBusy(true);h.executionCalls.length=0;
 for(const expectedRevision of [-1,5,NaN])await assert.rejects(h.execute('stop',{expectedRevision}));assert.equal(mutations(h.executionCalls).length,0);
 await h.execute('stop',{expectedRevision:1});assert.equal(mutations(h.executionCalls).length,1);assert.equal(mutations(h.executionCalls)[0].revision,4);
});

test('checkpoint storage failure blocks starting and continuing preparation',async()=>{
 for(const status of ['error','unavailable']){
  const h=executionHarness();await seedGroup(h);h.setStorage({status});h.executionCalls.length=0;await assert.rejects(h.execute('prepare'));assert.equal(mutations(h.executionCalls).length,0);
 }
 const h=executionHarness();await seedGroup(h);const gate=deferred();h.setPrepare(()=>gate.promise);const preparing=h.execute('prepare');await tick();h.setStorage({status:'error'});gate.resolve();await assert.rejects(preparing);assert.equal(h.executionSession.snapshot().current,null);
});

test('read-only checkpoint assessment can be busy while an owned preparation continues',async()=>{
 const h=executionHarness();await seedGroup(h);const gate=deferred();h.setPrepare(()=>gate.promise);const preparing=h.execute('prepare');await tick();h.setBusy(true);gate.resolve();await preparing;assert.equal(h.executionSession.snapshot().current.status,'ready');
});

test('a real checkpoint state transition still retires an owned preparation',async()=>{
 const h=executionHarness();await seedGroup(h);const gate=deferred();h.setPrepare(()=>gate.promise);const preparing=h.execute('prepare');await tick();h.setGroup({...h.session.snapshot().current,status:'applying',revision:1});gate.resolve();await assert.rejects(preparing);assert.equal(h.executionSession.snapshot().current,null);
});

test('an Apply waiting at its guarded write boundary cannot race newly active isolated execution',async()=>{
 const h=executionHarness();await seedGroup(h);const gate=deferred();h.setAction(()=>gate.promise);const applying=h.groupAction('apply');await tick();assert.equal(h.actionCalls.at(-1)?.action,'apply');h.setExecutionBusy(true);gate.resolve();await assert.rejects(applying);assert.equal(h.host.changeSetOperationGuards.size,0);
});
