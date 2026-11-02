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
 return Object.assign(h,{executionSession,executionCalls:calls,setExecution:value=>execution=structuredClone(value),setExecutionBusy:value=>executionBusy=value,setExecutionStorage:value=>executionStorage=value,setExecutionLoad:hook=>loadHook=hook,setPrepare:hook=>prepareHook=hook,setRun:hook=>runHook=hook,
  execute(action,extra={},surface='assistant'){const group=h.session.snapshot().current,current=executionSession.snapshot().current;return h.host.executionAction({type:'executionAction',action,projectId:project.id,changeSetId:group?.id,expectedGroupRevision:group?.revision,executionId:current?.id,expectedRevision:current?.revision,...extra},surface);},
 });
}
const mutations=calls=>calls.filter(call=>call.action!=='load');


const plain=value=>JSON.parse(JSON.stringify(value));
const TASKS=[{id:'node:test',label:'Node tests',command:'node --test test/check.test.mjs'},{id:'typescript:check',label:'TypeScript check',command:'node node_modules/typescript/lib/tsc.js --noEmit --pretty false'}];
function planHarness(){
 const h=executionHarness();let plan=null,busy=false,storage={status:'saved'},loadHook,createHook,beforeHook,runHook;let launches=0;const calls=[];
 const session={snapshot:()=>({current:structuredClone(plan),history:[],busy,storage:{...storage},assessment:{canCreate:!plan||['completed','ended'].includes(plan.status),canRunNext:plan?.status==='paused',canSkipStep:plan?.status==='paused',canEnd:plan?.status==='paused',canStop:busy}}),
  async load(){if(loadHook)await loadHook();return this.snapshot();},
  async create(input,{guard}){await guard();if(createHook)await createHook();await guard();const record=h.executionSession.snapshot().current;assert.equal(input.executionId,record.id);assert.equal(input.expectedExecutionRevision,record.revision);assert.ok(Array.isArray(input.taskIds)&&input.taskIds.length>=1&&input.taskIds.length<=2);assert.equal(new Set(input.taskIds).size,input.taskIds.length);assert.ok(input.taskIds.every(id=>TASKS.some(task=>task.id===id)));calls.push({action:'create',input:plain(input)});plan={id:'4c70eacd-c7bd-4436-a39f-e7eb252482ee',projectId:project.id,groupId:record.groupId,groupRevision:record.groupRevision,groupDigest:record.groupDigest,snapshotRevision:record.snapshotRevision,revision:0,status:'paused',steps:input.taskIds.map((id,index)=>({id:`step-${index}`,task:TASKS.find(task=>task.id===id),status:'pending',attempts:[]}))};return this.snapshot();},
  async runNext(id,revision,options){return execute('runNext',id,revision,undefined,options);},
  async retryStep(id,revision,stepId,options){return execute('retryStep',id,revision,stepId,options);},
  async skipStep(id,revision,stepId,{guard}){await guard();assert.equal(storage.status,'saved');assert.equal(plan.id,id);assert.equal(plan.revision,revision);assert.equal(plan.steps.find(step=>step.status==='pending').id,stepId);calls.push({action:'skipStep',id,revision,stepId});plan.steps.find(step=>step.id===stepId).status='skipped';plan.revision++;if(plan.steps.every(step=>step.status!=='pending'))plan.status='completed';return this.snapshot();},
  async stop(id,revision,attemptId){assert.equal(id,plan.id);assert.equal(attemptId,plan.activeAttemptId);calls.push({action:'stop',id,revision,attemptId});busy=false;plan.status='paused';delete plan.activeAttemptId;plan.revision++;return this.snapshot();},
  async end(id,revision,{guard}){await guard();calls.push({action:'end',id,revision});assert.equal(id,plan.id);assert.equal(revision,plan.revision);plan.status='ended';plan.revision++;return this.snapshot();},
  async retryStorage(){calls.push({action:'retryStorage'});return this.snapshot();},
 };
 async function execute(action,id,revision,stepId,options){await options.guard();assert.equal(storage.status,'saved');assert.equal(id,plan.id);assert.equal(revision,plan.revision);const step=plan.steps.find(step=>step.status==='pending');if(stepId!==undefined)assert.equal(step.id,stepId);calls.push({action,id,revision,stepId,group:plain(options.group)});if(beforeHook)await beforeHook(options);await options.guard();options.beforeRun?.();launches++;if(runHook)await runHook(options);await options.guard();step.status='passed';step.attempts.push({id:`attempt-${launches}`,status:'passed'});plan.revision++;plan.status=plan.steps.every(step=>step.status!=='pending')?'completed':'paused';return session.snapshot();}
 h.host.checkPlanSessions=new Map([[project.id,session]]);h.host.checkPlans=()=>session;
 return Object.assign(h,{planSession:session,planCalls:calls,setPlan:value=>plan=structuredClone(value),setPlanBusy:value=>busy=value,setPlanStorage:value=>storage=value,setPlanLoad:hook=>loadHook=hook,setCreatePlan:hook=>createHook=hook,setBeforeRun:hook=>beforeHook=hook,setPlanRun:hook=>runHook=hook,getLaunches:()=>launches,
  decide(action,extra={},surface='assistant'){const current=plan,group=h.session.snapshot().current,execution=h.executionSession.snapshot().current;return h.host.checkPlanAction({type:'checkPlanAction',action,projectId:project.id,changeSetId:current?.groupId||group?.id,expectedGroupRevision:current?.groupRevision??group?.revision,planId:current?.id,expectedRevision:current?.revision,executionId:execution?.id,expectedExecutionRevision:execution?.revision,taskIds:['node:test','typescript:check'],stepId:current?.steps.find(step=>step.status==='pending')?.id,attemptId:current?.activeAttemptId,...extra},surface);},
  async seed(){const group=await seedGroup(h);await h.execute('prepare');h.setExecution({...h.executionSession.snapshot().current,tasks:structuredClone(TASKS),snapshotRevision:'a'.repeat(64)});h.executionCalls.length=0;return group;},
 });
}

test('saving ordered fixed tasks delegates only canonical execution identity and never starts commands or AI',async()=>{
 const h=planHarness();await h.seed();const before=structuredClone([...h.sources]);await h.decide('create',{taskIds:['typescript:check','node:test'],command:'forged shell',args:['--secret'],cwd:'/private/forged'});assert.deepEqual(h.planCalls,[{action:'create',input:{executionId:h.executionSession.snapshot().current.id,expectedExecutionRevision:1,taskIds:['typescript:check','node:test']}}]);assert.deepEqual(h.planSession.snapshot().current.steps.map(step=>step.task.id),['typescript:check','node:test']);assert.equal(h.getLaunches(),0);assert.equal(h.requests.length,1);assert.deepEqual([...h.sources],before);
});

test('create requires exact prepared execution and supported unique task IDs',async()=>{
 for(const extra of [{executionId:'other'},{expectedExecutionRevision:8},{taskIds:[]},{taskIds:['shell']},{taskIds:['node:test','node:test']},{taskIds:['node:test','typescript:check','shell']}]){const h=planHarness();await h.seed();await assert.rejects(h.decide('create',extra));assert.equal(h.planCalls.length,0);assert.equal(h.getLaunches(),0);}
 for(const mutate of [record=>record.groupDigest='f'.repeat(64),record=>record.groupRevision++,record=>record.status='passed']){const h=planHarness();await h.seed();const record=h.executionSession.snapshot().current;mutate(record);h.setExecution(record);await assert.rejects(h.decide('create'));assert.equal(h.planCalls.length,0);}
});

test('Run next launches one explicit step, preserves a paused frontier, and rejects replayed decisions',async()=>{
 const h=planHarness(),group=await h.seed();await h.decide('create');const before=h.planSession.snapshot().current;await h.decide('runNext');assert.equal(h.getLaunches(),1);assert.equal(h.planSession.snapshot().current.status,'paused');assert.equal(h.planSession.snapshot().current.steps[1].status,'pending');assert.deepEqual(h.planCalls.at(-1).group,group);await assert.rejects(h.decide('runNext',{expectedRevision:before.revision}));assert.equal(h.getLaunches(),1);assert.equal(h.requests.length,1);
});

test('positive decisions reject wrong project, group, source, conversation, trust and active responses',async()=>{
 for(const kind of ['project','trust','disposed','group','group-revision','group-digest','history','archive','chat','dirty','source','checkpoint','busy','response']){const h=planHarness();await h.seed();await h.decide('create');let extra={};if(kind==='project')extra.projectId='other';if(kind==='trust')h.vscode.workspace.isTrusted=false;if(kind==='disposed')h.host.disposed=true;if(kind==='group')extra.changeSetId='other';if(kind==='group-revision')extra.expectedGroupRevision=99;if(kind==='group-digest')h.setGroup({...h.session.snapshot().current,title:'changed immutable title'});if(kind==='history'){const snapshot=h.store.snapshot.bind(h.store);h.store.snapshot=()=>({...snapshot(),storage:{status:'error'}});}if(kind==='archive')await h.store.archive(h.store.snapshot().activeId);if(kind==='chat')await h.store.newConversation();if(kind==='dirty')h.dirty.add('src/api.ts');if(kind==='source')h.sources.set('src/consumer.ts',file('src/consumer.ts','changed'));if(kind==='checkpoint')h.setStorage({status:'error'});if(kind==='busy')h.setBusy(true);if(kind==='response')h.host.asking={};await assert.rejects(h.decide('runNext',extra),kind);assert.equal(h.getLaunches(),0,kind);}
});

test('all positive decision identities are exact and renderer action strings never add new authority',async()=>{
 for(const extra of [{planId:'other'},{expectedRevision:-1},{expectedRevision:88},{action:'shell'},{stepId:'other',action:'retryStep'}]){const h=planHarness();await h.seed();await h.decide('create');await assert.rejects(h.decide('runNext',extra));assert.equal(h.getLaunches(),0);}
});

test('changed sources, native drafts, view, epoch, project or active chat before dispatch prevent launch',async()=>{
 for(const mutate of [h=>h.dirty.add('src/api.ts'),h=>h.sources.set('src/consumer.ts',file('src/consumer.ts','changed')),h=>h.host.assistantView={webview:{}},h=>h.host.featureSourceEpoch++,h=>h.host.project={...project,id:'other'},h=>h.host.project={...project,root:'/other'},h=>h.vscode.workspace.isTrusted=false,h=>h.setGroup({...h.session.snapshot().current,revision:1}),async h=>h.store.newConversation()]){const h=planHarness();await h.seed();await h.decide('create');h.setBeforeRun(async()=>mutate(h));await assert.rejects(h.decide('runNext'));assert.equal(h.getLaunches(),0);}
});

test('synchronous final dispatch guard closes active-chat, source-epoch and dirty-buffer gaps',async()=>{
 for(const mutate of [h=>h.host.featureSourceEpoch++,h=>h.dirty.add('src/api.ts'),h=>{const snapshot=h.store.snapshot.bind(h.store);h.store.snapshot=()=>({...snapshot(),activeId:'other'});}]){const h=planHarness();await h.seed();await h.decide('create');h.setBeforeRun(async options=>{const original=options.beforeRun;options.beforeRun=()=>{mutate(h);return original();};});await assert.rejects(h.decide('runNext'));assert.equal(h.getLaunches(),0);}
});

test('after dispatch ordinary chat browsing preserves the owned command but archiving it does not',async()=>{
 const h=planHarness();await h.seed();await h.decide('create');h.setPlanRun(async()=>h.store.newConversation());await h.decide('runNext');assert.equal(h.getLaunches(),1);assert.equal(h.planSession.snapshot().current.steps[0].status,'passed');
 const retired=planHarness();await retired.seed();await retired.decide('create');retired.setPlanRun(async()=>retired.store.archive(retired.store.snapshot().activeId));await assert.rejects(retired.decide('runNext'));assert.equal(retired.getLaunches(),1);assert.equal(retired.planSession.snapshot().current.steps[0].status,'pending');
});

test('transient read-only assessment and conversation saving do not cancel an already dispatched check',async()=>{
 for(const kind of ['assessment','history-saving']){const h=planHarness();await h.seed();await h.decide('create');h.setPlanRun(async()=>{if(kind==='assessment')h.setBusy(true);else{const snapshot=h.store.snapshot.bind(h.store);h.store.snapshot=()=>({...snapshot(),storage:{status:'saving'}});}});await h.decide('runNext');assert.equal(h.getLaunches(),1);assert.equal(h.planSession.snapshot().current.steps[0].status,'passed',kind);}
});

test('Skip is an explicit non-executing decision even when source is dirty or a response is running',async()=>{
 const h=planHarness();await h.seed();await h.decide('create');h.dirty.add('src/api.ts');h.host.asking={};const records=h.executionSession.snapshot();await h.decide('skipStep');assert.equal(h.planSession.snapshot().current.steps[0].status,'skipped');assert.equal(h.getLaunches(),0);assert.deepEqual(h.executionSession.snapshot(),records);assert.equal(h.requests.length,1);
});

test('End remains possible for exact stale group ownership without source reads or process execution',async()=>{
 const h=planHarness();await h.seed();await h.decide('create');h.setGroup({...h.session.snapshot().current,id:'foreign',revision:19});await h.store.archive(h.store.snapshot().activeId);h.dirty.add('src/api.ts');h.setRead(async()=>{throw Error('End must not read project sources');});await h.decide('end');assert.equal(h.planSession.snapshot().current.status,'ended');assert.equal(h.getLaunches(),0);assert.equal(h.planCalls.at(-1).action,'end');
});

test('Stop is bound to the exact active attempt while allowing its own older displayed revision',async()=>{
 const h=planHarness();await h.seed();await h.decide('create');h.setPlan({...h.planSession.snapshot().current,status:'running',revision:7,activeAttemptId:'second-attempt'});h.setPlanBusy(true);h.dirty.add('src/api.ts');await h.store.archive(h.store.snapshot().activeId);for(const extra of [{attemptId:'first-attempt'},{attemptId:undefined},{expectedRevision:-1},{expectedRevision:8},{planId:'foreign'}])await assert.rejects(h.decide('stop',extra));assert.equal(h.planCalls.filter(call=>call.action==='stop').length,0);await h.decide('stop',{expectedRevision:2});assert.deepEqual(h.planCalls.at(-1),{action:'stop',id:h.planSession.snapshot().current.id,revision:2,attemptId:'second-attempt'});assert.equal(h.getLaunches(),0);
});

test('load and Retry storage never execute work, and project change while loading retires a decision',async()=>{
 const h=planHarness();await h.seed();await h.decide('create');await h.decide('retryStorage');assert.equal(h.getLaunches(),0);assert.equal(h.planCalls.at(-1).action,'retryStorage');const before=h.planCalls.length;h.setPlanLoad(async()=>{h.host.project={...project,id:'other'};});await h.decide('runNext');assert.equal(h.planCalls.length,before);assert.equal(h.getLaunches(),0);
});

test('standalone execution cannot bypass a paused plan and source mutations are fenced while plan work is busy',async()=>{
 const h=planHarness();await h.seed();await h.decide('create');for(const action of ['prepare','run'])await assert.rejects(h.execute(action,{taskId:'node:test'}));assert.equal(mutations(h.executionCalls).length,0);h.setPlanBusy(true);await assert.rejects(h.groupAction('apply'));assert.equal(h.actionCalls.filter(call=>call.action==='apply').length,0);assert.equal(h.getLaunches(),0);
});

test('Retry check passes the exact retry step to a fresh guarded attempt without changing the earlier result',async()=>{
 const h=planHarness();await h.seed();await h.decide('create');const value=h.planSession.snapshot().current;value.steps[0].attempts=[{id:'stopped-attempt',status:'cancelled'}];h.setPlan(value);await h.decide('retryStep');assert.equal(h.getLaunches(),1);assert.equal(h.planCalls.at(-1).action,'retryStep');assert.equal(h.planCalls.at(-1).stepId,value.steps[0].id);assert.deepEqual(h.planSession.snapshot().current.steps[0].attempts[0],value.steps[0].attempts[0]);
});

test('after dispatch unrelated source epochs do not cancel, while real group or selected source transitions do',async()=>{
 const stable=planHarness();await stable.seed();await stable.decide('create');stable.setPlanRun(async()=>{stable.host.featureSourceEpoch++;});await stable.decide('runNext');assert.equal(stable.getLaunches(),1);assert.equal(stable.planSession.snapshot().current.steps[0].status,'passed');
 for(const mutate of [h=>h.setGroup({...h.session.snapshot().current,status:'applying',revision:1}),h=>h.sources.set('src/consumer.ts',file('src/consumer.ts','changed after dispatch')),h=>h.dirty.add('src/api.ts')]){const h=planHarness();await h.seed();await h.decide('create');h.setPlanRun(async()=>mutate(h));await assert.rejects(h.decide('runNext'));assert.equal(h.getLaunches(),1);assert.equal(h.planSession.snapshot().current.steps[0].status,'pending');}
});

test('durability errors and asynchronous creation ownership loss cannot authorize a command',async()=>{
 const h=planHarness();await h.seed();await h.decide('create');h.setPlanStorage({status:'error'});await assert.rejects(h.decide('runNext'));assert.equal(h.getLaunches(),0);
 const retired=planHarness();await retired.seed();retired.setCreatePlan(async()=>{retired.dirty.add('src/api.ts');});await assert.rejects(retired.decide('create'));assert.equal(retired.planSession.snapshot().current,null);assert.equal(retired.getLaunches(),0);
});

test('a legacy check waiting in source preflight cannot bypass a newly saved plan',async()=>{
 for(const action of ['prepare','run']){const h=planHarness();await h.seed();await h.decide('create');const saved=h.planSession.snapshot().current;h.setPlan(null);const gate=deferred();let entered=false;h.setRead(async(_id,path)=>{entered=true;await gate.promise;return structuredClone(h.sources.get(path));});const pending=h.execute(action,{taskId:'node:test'});for(let i=0;i<10&&!entered;i++)await tick();assert.equal(entered,true);h.setPlan(saved);gate.resolve();await assert.rejects(pending);assert.equal(mutations(h.executionCalls).length,0,action);}
});

test('standalone preflight waits for saved plan restoration and cannot overlook a paused startup checkpoint',async()=>{
 const h=planHarness();await h.seed();await h.decide('create');const saved=h.planSession.snapshot().current;h.setPlan(null);h.setPlanStorage({status:'unavailable'});const gate=deferred();let loading=false;h.setPlanLoad(async()=>{loading=true;await gate.promise;h.setPlan(saved);h.setPlanStorage({status:'saved'});});const pending=h.execute('prepare');for(let i=0;i<10&&!loading;i++)await tick();assert.equal(loading,true);assert.equal(mutations(h.executionCalls).length,0);gate.resolve();await assert.rejects(pending);assert.equal(mutations(h.executionCalls).length,0);
});

test('unavailable plan storage blocks standalone preparation but never prevents Stop or execution storage Retry',async()=>{
 const h=planHarness();await h.seed();h.setPlanStorage({status:'unavailable'});await assert.rejects(h.execute('prepare'));assert.equal(mutations(h.executionCalls).length,0);h.setPlanLoad(async()=>{throw Error('Negative control must not depend on loading plans');});await h.execute('retry');assert.deepEqual(mutations(h.executionCalls),[{action:'retry'}]);h.setExecution({...h.executionSession.snapshot().current,status:'running'});h.setExecutionBusy(true);await h.execute('stop');assert.equal(mutations(h.executionCalls).at(-1).action,'stop');
});

test('paused plan exposes executor capacity guidance without replacing plan-storage, group or source guidance',async()=>{
 const make=async()=>{const h=planHarness();await h.seed();await h.decide('create');const snapshot=h.executionSession.snapshot.bind(h.executionSession);h.executionSession.snapshot=()=>{const value=snapshot();return{...value,assessment:{...value.assessment,canPrepare:false,reason:'Local execution history is full. Existing records are preserved.'}};};return h;};
 const h=await make();assert.equal(h.host.executionSnapshot().planSession.assessment.reason,'Local execution history is full. Existing records are preserved.');
 const storage=await make();storage.setPlanStorage({status:'error',message:'Retry plan storage.'});const snapshot=storage.planSession.snapshot.bind(storage.planSession);storage.planSession.snapshot=()=>{const value=snapshot();return{...value,assessment:{...value.assessment,reason:'Retry plan storage.'}};};assert.equal(storage.host.executionSnapshot().planSession.assessment.reason,'Retry plan storage.');
 const stale=await make();stale.setGroup({...stale.session.snapshot().current,revision:1});assert.match(stale.host.executionSnapshot().planSession.assessment.reason,/earlier group/);assert.doesNotMatch(stale.host.executionSnapshot().planSession.assessment.reason,/history is full/);
 const dirty=await make();dirty.dirty.add('src/api.ts');assert.match(dirty.host.executionSnapshot().planSession.assessment.reason,/current group and saved source/);assert.doesNotMatch(dirty.host.executionSnapshot().planSession.assessment.reason,/history is full/);
});
