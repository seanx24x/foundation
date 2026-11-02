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


function suggestionHarness(){
 const h=planHarness();let featureId=null,adoptHook;h.host.featureSnapshot=()=>({activeId:featureId,features:[],storage:{status:'saved'}});h.setFeature=value=>featureId=value;
 const create=h.planSession.create.bind(h.planSession);h.planSession.create=async(input,options)=>{if(adoptHook)return adoptHook(input,options);await create(input,options);h.setPlan({...h.planSession.snapshot().current,recommendation:plain(input.recommendation)});return h.planSession.snapshot();};h.setAdopt=hook=>adoptHook=hook;
 h.checkContext=()=>{const group=h.session.snapshot().current,record=h.executionSession.snapshot().current;return{version:1,conversationId:h.store.snapshot().activeId,requestId:group.requestId,groupId:group.id,groupRevision:group.revision,groupDigest:changeGroupDigest(group),snapshotRevision:record.snapshotRevision,tasks:record.tasks.map(({id,label})=>({id,label}))};};
 h.suggestion=(checks=[{taskId:'node:test',reason:'Exercise the advertised tests.'},{taskId:'typescript:check',reason:'Inspect TypeScript without emitting files.'}])=>artifactModule.createCheckSuggestion({projectId:project.id,checkContext:h.checkContext(),raw:JSON.stringify({title:'Check staged save',summary:'Use supported checks for the selected staged change.',checks,limitations:['Suggestions are not execution evidence.']})});
 h.sendSuggestion=extra=>h.ask('plan',{requestId:'suggestion-request',prompt:'Suggest supported checks for the staged group.',checkContext:h.checkContext(),...extra});
 h.prepare=extra=>h.suggestAction('prepare',{requestId:'new-request',prepareId:'prepare-checks-1',featureId,...extra});
 h.suggestAction=async(action,extra={},surface='assistant')=>{const group=h.session.snapshot().current,record=h.executionSession.snapshot().current,turn=h.turn('suggestion-request');await h.host.checkSuggestionAction({type:'checkSuggestionAction',action,projectId:project.id,conversationId:h.store.snapshot().activeId,requestId:turn?.requestId||'new-request',artifactId:turn?.checkSuggestion?.id,changeSetId:group?.id,expectedGroupRevision:group?.revision,executionId:record?.id,expectedExecutionRevision:record?.revision,taskIds:['node:test','typescript:check'],...extra},surface);};
 h.seedSuggestion=async()=>{await h.seed();const suggestion=h.suggestion();h.setFetch(()=>response([{type:'start',intent:'plan',model:'reported-fixture'},{type:'delta',text:'Untrusted raw recommendation response'},{type:'checkSuggestion',checkSuggestion:suggestion},{type:'done',model:'reported-fixture',usage:{total_tokens:15}}]));await h.sendSuggestion();assert.equal(h.turn('suggestion-request')?.state,'complete',JSON.stringify(h.messages));return h.turn('suggestion-request');};
 Object.defineProperty(h,'preparedSuggestion',{get:()=>h.messages.filter(message=>message.type==='checkSuggestionPrepared').at(-1)});Object.defineProperty(h,'suggestionResult',{get:()=>h.messages.filter(message=>message.type==='checkSuggestionResult').at(-1)});return h;
}
const noAdoption=h=>{assert.equal(h.planSession.snapshot().current,null);assert.equal(h.getLaunches(),0);assert.equal(h.planCalls.length,0);};

test('Prepare reveals staged source and canonical IDs/labels, without another provider request or execution',async()=>{
 const h=suggestionHarness(),group=await h.seed(),before=h.store.snapshot();const record=h.executionSession.snapshot().current;record.tasks[0].command='node --test PRIVATE_DISCOVERED_CHECK.test.mjs';h.setExecution(record);await h.prepare({command:'FORGED_COMMAND',sharedFiles:[{source:'FORGED_SOURCE'}]});const prepared=h.preparedSuggestion;assert.ok(prepared,JSON.stringify(h.messages));assert.deepEqual(prepared.checkContext,h.checkContext());assert.deepEqual(prepared.context,h.turn('new-request').context);assert.equal(prepared.sharedFiles[0].source,group.files[0].after);assert.equal(prepared.sharedFiles[1].source,group.files[1].after);assert.doesNotMatch(JSON.stringify(prepared),/PRIVATE_DISCOVERED|FORGED_COMMAND|FORGED_SOURCE|node --test/);assert.deepEqual(h.store.snapshot(),before);assert.equal(h.requests.length,1);noAdoption(h);
});

test('a normal complete recommendation is durable evidence only and retains original source/provenance',async()=>{
 const h=suggestionHarness(),turn=await h.seedSuggestion();assert.ok(turn.checkSuggestion);assert.equal(turn.plan,undefined);assert.equal(turn.model,'reported-fixture');assert.equal(turn.providerKind,'compatible');assert.equal(turn.usage.total_tokens,15);assert.equal(turn.checkSuggestion.verificationStatus,'not-run');assert.deepEqual(turn.context,h.turn('new-request').context);assert.deepEqual(turn.checkContext,h.checkContext());assert.equal(turn.runtimeEvidence,undefined);const body=h.requests.at(-1).body;assert.equal(body.intent,'plan');assert.deepEqual(plain(body.checkContext),h.checkContext());assert.equal(body.taskContext,undefined);assert.equal(body.runtimeContext,undefined);assert.equal(body.tools,undefined);assert.equal(body.executionOutput,undefined);noAdoption(h);assert.deepEqual([...h.sources.values()],originalFiles);
});

test('candidate followed by EOF, error, Stop, duplicate or another artifact cannot become actionable',async()=>{
 for(const ending of ['eof','error','stop','duplicate','plan']){const h=suggestionHarness();await h.seed();const artifact=h.suggestion(),gate=deferred();let read=0;
 if(ending==='stop')h.setFetch(()=>({ok:true,body:{getReader:()=>({read:async()=>++read===1?{done:false,value:Buffer.from(JSON.stringify({type:'checkSuggestion',checkSuggestion:artifact})+'\n')}:gate.promise})}}));else h.setFetch(()=>response([{type:'checkSuggestion',checkSuggestion:artifact},...(ending==='error'?[{type:'error',error:'fixture'}]:ending==='duplicate'?[{type:'checkSuggestion',checkSuggestion:artifact},{type:'done'}]:ending==='plan'?[{type:'plan',plan:{}},{type:'done'}]:[])]));
 const pending=h.sendSuggestion();if(ending==='stop'){await tick();await tick();h.host.cancelQuestion('suggestion-request');gate.resolve({done:true});}await pending;assert.equal(h.turn('suggestion-request').checkSuggestion,undefined,ending);assert.ok(['failed','stopped'].includes(h.turn('suggestion-request').state));noAdoption(h);}
});

test('Prepare and Send refuse untrusted, changed or undisclosed source and unavailable catalog ownership',async()=>{
 for(const kind of ['dirty','source','snapshot','catalog','busy','plan','storage','intent','runtime','task','revision','group-handoff','plan-handoff']){const h=suggestionHarness();await h.seed();let extra={};if(kind==='dirty')h.dirty.add('src/consumer.ts');if(kind==='source')h.sources.set('src/consumer.ts',file('src/consumer.ts','changed'));if(kind==='snapshot')extra.checkContext={...h.checkContext(),snapshotRevision:'f'.repeat(64)};if(kind==='catalog')extra.checkContext={...h.checkContext(),tasks:[{id:'shell',label:'Shell'}]};if(kind==='busy')h.setExecutionBusy(true);if(kind==='plan')h.setPlan({id:'other',status:'paused'});if(kind==='storage')h.setPlanStorage({status:'error'});if(kind==='intent')extra.intent='ask';if(kind==='runtime')extra.runtimeContext={};if(kind==='task')extra.taskContext={};if(kind==='revision')extra.requestRevision={};if(kind==='group-handoff')extra.groupRevision={};if(kind==='plan-handoff')extra.planContext={};await h.sendSuggestion(extra).catch(()=>{});assert.equal(h.requests.length,1,kind);assert.equal(h.getLaunches(),0);}
});

test('prepare exact identity and asynchronous view/feature/source changes retire disclosure',async()=>{
 for(const kind of ['project','group','revision','execution','execution-revision','chat','request','feature','view','epoch','dirty']){const h=suggestionHarness();await h.seed();let extra={};if(kind==='project')extra.projectId='other';if(kind==='group')extra.changeSetId='other';if(kind==='revision')extra.expectedGroupRevision=2;if(kind==='execution')extra.executionId='other';if(kind==='execution-revision')extra.expectedExecutionRevision=2;if(kind==='chat')extra.conversationId='other';if(kind==='request')extra.requestId='other';if(kind==='feature')extra.featureId='other';
 if(['view','epoch','dirty'].includes(kind)){const gate=deferred();h.setRead(async(_id,path)=>{await gate.promise;return structuredClone(h.sources.get(path));});const pending=h.prepare(extra);await tick();if(kind==='view')h.host.assistantView={webview:{}};if(kind==='epoch')h.host.featureSourceEpoch++;if(kind==='dirty')h.dirty.add('src/api.ts');gate.resolve();await pending;}else await h.prepare(extra);assert.equal(h.preparedSuggestion,undefined,kind);noAdoption(h);}
});

test('owned provider resolver rejects descriptor tampering, stale copies and inactive requests',async()=>{
 const h=suggestionHarness();await h.seed();const context=h.checkContext();await assert.rejects(h.host.resolveProviderCheckContext({projectId:project.id,...context}));const gate=deferred();h.setFetch(()=>gate.promise);const pending=h.sendSuggestion();await tick();await tick();const resolved=await h.host.resolveProviderCheckContext({projectId:project.id,...context});assert.deepEqual(plain(resolved.context),context);assert.deepEqual(plain(resolved.group),h.session.snapshot().current);await assert.rejects(h.host.resolveProviderCheckContext({projectId:project.id,...context,snapshotRevision:'f'.repeat(64)}));h.dirty.add('src/api.ts');await assert.rejects(h.host.resolveProviderCheckContext({projectId:project.id,...context}));h.host.cancelQuestion('suggestion-request');gate.resolve(response([{type:'done'}]));await pending;noAdoption(h);
});

test('source, group, copy, feature and conversation changes during streaming prevent completed recommendations',async()=>{
 for(const mutate of [h=>h.dirty.add('src/api.ts'),h=>h.sources.set('src/api.ts',file('src/api.ts','changed')),h=>h.setGroup({...h.session.snapshot().current,revision:1}),h=>h.setExecution({...h.executionSession.snapshot().current,snapshotRevision:'f'.repeat(64)}),h=>h.host.featureSourceEpoch++,h=>h.setFeature('other'),h=>{const snapshot=h.store.snapshot.bind(h.store);h.store.snapshot=()=>({...snapshot(),activeId:'other'});}]){const h=suggestionHarness();await h.seed();const suggestion=h.suggestion(),gate=deferred();h.setFetch(()=>gate.promise);const pending=h.sendSuggestion();await tick();await tick();await mutate(h);gate.resolve(response([{type:'checkSuggestion',checkSuggestion:suggestion},{type:'done'}]));await pending;assert.notEqual(h.turn('suggestion-request')?.state,'complete');noAdoption(h);}
});

test('terminal history storage failure never authorizes adoption',async()=>{
 const h=suggestionHarness();await h.seed();const suggestion=h.suggestion();h.setFetch(()=>response([{type:'checkSuggestion',checkSuggestion:suggestion},{type:'done'}]));h.setWrite((_key,value)=>{if(value.conversations?.some(chat=>chat.turns.some(turn=>turn.requestId==='suggestion-request'&&turn.state==='complete')))throw Error('fixture storage failure');});await h.sendSuggestion();assert.equal(h.store.snapshot().storage.status,'error');await h.suggestAction('save');assert.equal(h.suggestionResult.passed,false);noAdoption(h);
});

test('explicit Save accepts edited order and host-generated provenance without executing or changing the suggestion',async()=>{
 const h=suggestionHarness(),turn=await h.seedSuggestion(),before=structuredClone(turn);h.host.assistant={status:()=>({configured:false})};await h.suggestAction('save',{taskIds:['typescript:check','node:test'],recommendation:{artifactId:'forged'},command:'FORGED',args:['bad']});assert.equal(h.suggestionResult.passed,true,JSON.stringify(h.messages));const plan=h.planSession.snapshot().current;assert.deepEqual(plan.steps.map(step=>step.task.id),['typescript:check','node:test']);assert.deepEqual(plan.recommendation,{conversationId:h.store.snapshot().activeId,requestId:turn.requestId,artifactId:turn.checkSuggestion.id,artifactDigest:artifactModule.checkSuggestionDigest(turn.checkSuggestion)});assert.deepEqual(h.turn('suggestion-request'),before);assert.equal(h.getLaunches(),0);assert.equal(h.requests.length,2);assert.deepEqual([...h.sources.values()],originalFiles);
});

test('adoption guard accepts its own atomic busy/saving/current-origin phase and rejects another plan',async()=>{
 for(const kind of ['owned','foreign']){const h=suggestionHarness();await h.seedSuggestion();h.setAdopt(async(input,{guard})=>{await guard();const record=h.executionSession.snapshot().current;h.setPlan({id:'atomic-plan',projectId:project.id,groupId:record.groupId,groupRevision:record.groupRevision,groupDigest:record.groupDigest,snapshotRevision:record.snapshotRevision,revision:0,status:'paused',steps:input.taskIds.map(id=>({id,task:TASKS.find(task=>task.id===id),status:'pending',attempts:[]})),recommendation:kind==='owned'?plain(input.recommendation):{artifactId:'foreign'}});h.setPlanBusy(true);h.setPlanStorage({status:'saving'});try{await guard();}finally{h.setPlanBusy(false);h.setPlanStorage({status:'saved'});}return h.planSession.snapshot();});await h.suggestAction('save');assert.equal(h.suggestionResult.passed,kind==='owned',JSON.stringify(h.messages));assert.equal(h.getLaunches(),0);}
});

test('a fresh prepared copy with the same entire snapshot can adopt; changed snapshot/catalog cannot',async()=>{
 for(const kind of ['same','snapshot','catalog']){const h=suggestionHarness();await h.seedSuggestion();const record=h.executionSession.snapshot().current;record.id='d2b8a6c9-0934-4df6-83d5-02aa18d96091';record.revision=3;if(kind==='snapshot')record.snapshotRevision='f'.repeat(64);if(kind==='catalog')record.tasks.reverse();h.setExecution(record);await h.suggestAction('save');assert.equal(h.suggestionResult.passed,kind==='same',kind);assert.equal(h.getLaunches(),0);if(kind!=='same')assert.equal(h.planSession.snapshot().current,null);}
});

test('duplicate Save resolves the committed plan; changed selection cannot create another',async()=>{
 const h=suggestionHarness();await h.seedSuggestion();await h.suggestAction('save');const saved=h.planSession.snapshot().current,creates=h.planCalls.length;await h.suggestAction('save');assert.equal(h.suggestionResult.passed,true);assert.equal(h.suggestionResult.planId,saved.id);assert.equal(h.planCalls.length,creates);await h.suggestAction('save',{taskIds:['node:test']});assert.equal(h.suggestionResult.passed,false);assert.equal(h.planCalls.length,creates);assert.equal(h.getLaunches(),0);
});

test('committed adoption with a durability error cannot duplicate a plan or claim no result',async()=>{
 const h=suggestionHarness();await h.seedSuggestion();h.setAdopt(async(input,{guard})=>{await guard();h.setPlan({id:'committed-plan',status:'paused',groupId:h.session.snapshot().current.id,recommendation:plain(input.recommendation),steps:input.taskIds.map(id=>({task:TASKS.find(task=>task.id===id)}))});h.setPlanStorage({status:'error'});throw Error('Committed plan awaits durability');});await h.suggestAction('save');assert.equal(h.suggestionResult.passed,false);assert.equal(h.planSession.snapshot().current.id,'committed-plan');await h.suggestAction('save');assert.equal(h.suggestionResult.passed,false);assert.match(h.suggestionResult.error,/already created a plan|retry plan storage/);assert.equal(h.getLaunches(),0);
});

test('Save rechecks sources, feature/view and recommendation state at the plan commit boundary',async()=>{
 for(const mutate of [h=>h.dirty.add('src/api.ts'),h=>h.host.featureSourceEpoch++,h=>h.setFeature('other'),h=>h.host.assistantView={webview:{}},async h=>h.store.dismissCheckSuggestion({conversationId:h.store.snapshot().activeId,requestId:'suggestion-request',artifactId:h.turn('suggestion-request').checkSuggestion.id})]){const h=suggestionHarness();await h.seedSuggestion();h.setAdopt(async(_input,{guard})=>{await guard();await mutate(h);await guard();throw Error('Commit should not proceed');});await h.suggestAction('save');assert.equal(h.planSession.snapshot().current,null);assert.equal(h.getLaunches(),0);assert.notEqual(h.suggestionResult?.passed,true);}
});

test('Dismiss is durable and non-executing, refuses linked plans, and prevents later adoption',async()=>{
 const h=suggestionHarness();await h.seedSuggestion();h.setExecution({...h.executionSession.snapshot().current,status:'interrupted'});h.dirty.add('src/api.ts');h.host.assistant={status:()=>({configured:false})};await h.suggestAction('dismiss');assert.equal(h.suggestionResult.passed,true);assert.equal(h.turn('suggestion-request').checkDismissed,true);await h.suggestAction('save');assert.equal(h.suggestionResult.passed,false);noAdoption(h);
 const linked=suggestionHarness();await linked.seedSuggestion();await linked.suggestAction('save');await linked.suggestAction('dismiss');assert.equal(linked.suggestionResult.passed,false);assert.notEqual(linked.turn('suggestion-request').checkDismissed,true);assert.equal(linked.getLaunches(),0);
});

test('Open resolves only the exact saved recommendation origin and runs nothing',async()=>{
 const h=suggestionHarness();await h.seedSuggestion();await h.suggestAction('open');assert.equal(h.suggestionResult.passed,false);await h.suggestAction('save');const saved=h.planSession.snapshot().current;h.setExecution({...h.executionSession.snapshot().current,status:'interrupted'});await h.suggestAction('open');assert.equal(h.suggestionResult.passed,true);assert.equal(h.suggestionResult.planId,saved.id);assert.equal(h.getLaunches(),0);assert.equal(h.requests.length,2);
});

test('generic request revision cannot silently remove a saved check context',async()=>{
 const h=suggestionHarness();await h.seedSuggestion();assert.throws(()=>h.host.resolveRequestRevision({version:1,conversationId:h.store.snapshot().activeId,requestId:'suggestion-request'}),/check|suggestion/);noAdoption(h);
});


test('Dismiss supersedes a pending Save before its plan commit and preserves a durable negative decision',async()=>{
 const h=suggestionHarness();await h.seedSuggestion();const entered=deferred(),resume=deferred();
 h.setAdopt(async(_input,{guard})=>{await guard();entered.resolve();await resume.promise;await guard();throw Error('A superseded Save must not commit');});
 const saving=h.suggestAction('save');await entered.promise;await h.suggestAction('dismiss');
 assert.equal(h.suggestionResult.action,'dismiss');assert.equal(h.suggestionResult.passed,true);assert.equal(h.turn('suggestion-request').checkDismissed,true);
 resume.resolve();await saving;assert.equal(h.messages.some(message=>message.type==='checkSuggestionResult'&&message.action==='save'&&message.passed===true),false);noAdoption(h);assert.equal(h.requests.length,2);
});

test('Dismiss cannot contradict a linked adoption while its journal is saving or storage is uncertain',async()=>{
 for(const status of ['saving','error']){
  const h=suggestionHarness();await h.seedSuggestion();const entered=deferred(),resume=deferred();
  h.setAdopt(async(input,{guard})=>{await guard();h.setPlan({id:'linked-plan',status:'paused',groupId:h.session.snapshot().current.id,recommendation:plain(input.recommendation),steps:input.taskIds.map(id=>({task:TASKS.find(task=>task.id===id)}))});h.setPlanBusy(status==='saving');h.setPlanStorage({status});entered.resolve();await resume.promise;h.setPlanBusy(false);if(status==='saving')h.setPlanStorage({status:'saved'});return h.planSession.snapshot();});
  const saving=h.suggestAction('save');await entered.promise;await h.suggestAction('dismiss');
  assert.equal(h.suggestionResult.action,'dismiss');assert.equal(h.suggestionResult.passed,false);assert.match(h.suggestionResult.error,/already has a saved plan/);assert.notEqual(h.turn('suggestion-request').checkDismissed,true);assert.equal(h.planSession.snapshot().current.id,'linked-plan');
  resume.resolve();await saving;assert.notEqual(h.turn('suggestion-request').checkDismissed,true);assert.equal(h.planSession.snapshot().current.id,'linked-plan');assert.equal(h.getLaunches(),0);assert.equal(h.requests.length,2);
 }
});
