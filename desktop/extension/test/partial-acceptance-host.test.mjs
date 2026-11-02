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


const plain=value=>JSON.parse(JSON.stringify(value));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function acceptanceHarness(){
 const h=harness();await seedGroup(h);let acceptance=null,operationHook,executionBusy=false,sourceWrites=0;
 const initial=h.session.snapshot.bind(h.session),operations=[];
 h.host.executionSnapshot=()=>({busy:executionBusy});
 h.session.snapshot=()=>({...initial(),acceptance:structuredClone(acceptance),assessment:{canApply:!acceptance||acceptance.selectedUnitIds.length>0,canUndo:false,canPrepareAcceptance:!acceptance,canSelectUnits:!!acceptance}});
 const persist=async(group)=>{h.setGroup(group);await h.store.updateChangeSet(group);};
 const operation=async(action,id,revision,options)=>{
  const group=initial().current;assert.equal(id,group.id);assert.equal(revision,group.revision);operations.push({action,id,revision,options:options&&structuredClone(options)});
  const guard=()=>h.host.changeSetOperationGuards.get(project.id)?.();guard();if(operationHook)await operationHook(action);guard();
  if(action==='prepareAcceptance'){
   assert.equal(acceptance,null);const plan={version:1,groupId:group.id,groupDigest:proposalModule.changeGroupDigest(group),mode:'partitioned',units:group.files.map((f,index)=>({id:`unit-${String(index+1).padStart(16,'0')}`,label:f.path,paths:[f.path]})),boundaries:[],digest:''};plan.digest=digest({...plan,digest:undefined});acceptance={plan,selectedUnitIds:plan.units.map(unit=>unit.id),appliedUnitIds:[]};
  }else if(action==='selectUnits'){
   assert.equal(options.planDigest,acceptance.plan.digest);assert.ok(Array.isArray(options.unitIds));assert.equal(new Set(options.unitIds).size,options.unitIds.length);for(const id of options.unitIds)assert.ok(acceptance.plan.units.some(unit=>unit.id===id)&&!acceptance.appliedUnitIds.includes(id));acceptance.selectedUnitIds=[...options.unitIds];
  }else if(action==='clearAcceptance'){
   assert.equal(group.status,'proposed');assert.equal(acceptance.appliedUnitIds.length,0);acceptance=null;
  }else if(action==='apply'){
   assert.ok(!acceptance||acceptance.selectedUnitIds.length);sourceWrites++;
  }
  if(['prepareAcceptance','selectUnits','clearAcceptance'].includes(action))await persist({...group,revision:group.revision+1,updatedAt:new Date().toISOString()});
  return h.session.snapshot();
 };
 for(const action of ['prepareAcceptance','selectUnits','clearAcceptance','apply','undo'])h.session[action]=(id,revision,options)=>operation(action,id,revision,options);
 return Object.assign(h,{operations,setOperation:hook=>operationHook=hook,setExecutionBusy:value=>executionBusy=value,acceptance:()=>acceptance,setAcceptance:value=>acceptance=structuredClone(value),sourceWrites:()=>sourceWrites,
  prepare:()=>h.groupAction('prepareAcceptance'),
  select:(unitIds,extra={})=>h.groupAction('selectUnits',{planDigest:acceptance?.plan.digest,unitIds,...extra}),
  apply:(extra={})=>h.groupAction('apply',{...(acceptance?{planDigest:acceptance.plan.digest}:{}),...extra}),
 });
}

test('preparing dependency units keeps original artifact provenance and starts no provider, process or source write',async()=>{
 const h=await acceptanceHarness(),original=h.session.snapshot().current,calls=h.requests.length;await h.prepare();const current=h.session.snapshot().current;
 assert.equal(current.id,original.id);assert.equal(current.requestId,original.requestId);assert.deepEqual(current.files,original.files);assert.equal(current.revision,original.revision+1);assert.equal(h.operations.at(-1).action,'prepareAcceptance');assert.equal(h.requests.length,calls);assert.equal(h.sourceWrites(),0);assert.equal(h.commands.length,0);assert.deepEqual(h.turn('new-request').changeSet,current);
});

test('selection passes only explicit host unit identities and supports clearing the selection without applying',async()=>{
 const h=await acceptanceHarness();await h.prepare();const unit=h.acceptance().plan.units[0],before=h.session.snapshot().current;await h.select([unit.id],{paths:['private/forged'],after:'FORGED'});
 assert.deepEqual(h.operations.at(-1).options,{planDigest:h.acceptance().plan.digest,unitIds:[unit.id]});assert.deepEqual(h.acceptance().selectedUnitIds,[unit.id]);assert.equal(h.session.snapshot().current.revision,before.revision+1);assert.equal(h.sourceWrites(),0);
 await h.select([]);assert.deepEqual(h.acceptance().selectedUnitIds,[]);assert.equal(h.session.snapshot().assessment.canApply,false);await assert.rejects(h.apply());assert.equal(h.sourceWrites(),0);
});

test('stale group revisions and forged plan digests cannot apply a different selection',async()=>{
 const h=await acceptanceHarness();await h.prepare();const revision=h.session.snapshot().current.revision,planDigest=h.acceptance().plan.digest;await h.select([h.acceptance().plan.units[0].id]);
 for(const extra of [{expectedRevision:revision},{planDigest:'f'.repeat(64)},{planDigest:undefined}])await assert.rejects(h.apply(extra));assert.equal(h.sourceWrites(),0);await h.apply({planDigest});assert.equal(h.sourceWrites(),1);
});

test('Use whole proposal removes only an unapplied acceptance plan with no source writes or provider calls',async()=>{
 const h=await acceptanceHarness();await h.prepare();const before=h.session.snapshot().current,calls=h.requests.length;await h.groupAction('clearAcceptance');assert.equal(h.acceptance(),null);assert.equal(h.session.snapshot().current.id,before.id);assert.equal(h.session.snapshot().current.revision,before.revision+1);assert.equal(h.requests.length,calls);assert.equal(h.sourceWrites(),0);
});

test('acceptance decisions require trusted exact current group and a completed saved active conversation',async()=>{
 for(const action of ['prepareAcceptance','selectUnits','clearAcceptance'])for(const kind of ['project','revision','id','trust','request','archive','inactive','partial','storage']){
  const h=await acceptanceHarness();if(action!=='prepareAcceptance')await h.prepare();h.operations.length=0;let extra={};
  if(kind==='project')extra.projectId='foreign';if(kind==='revision')extra.expectedRevision=999;if(kind==='id')extra.changeSetId='foreign';if(kind==='trust')h.vscode.workspace.isTrusted=false;if(kind==='request')h.host.asking={};if(kind==='archive')await h.store.archive(h.store.snapshot().activeId);if(kind==='inactive')await h.store.newConversation();
  if(kind==='partial'||kind==='storage'){const old=h.store.snapshot.bind(h.store);h.store.snapshot=()=>{const value=old();if(kind==='partial')value.conversations[0].turns[0].completedWhileStopping=true;else value.storage.status='error';return value;};}
  await assert.rejects(h.groupAction(action,{planDigest:h.acceptance()?.plan.digest,unitIds:[],...extra}));assert.equal(h.operations.length,0);assert.equal(h.sourceWrites(),0);
 }
});

test('active isolated execution or check-plan preparation fences every acceptance mutation before dispatch and during awaits',async()=>{
 for(const action of ['prepareAcceptance','selectUnits','clearAcceptance']){
  const h=await acceptanceHarness();if(action!=='prepareAcceptance')await h.prepare();h.setExecutionBusy(true);const before=h.operations.length;await assert.rejects(h.groupAction(action,{planDigest:h.acceptance()?.plan.digest,unitIds:[]}));assert.equal(h.operations.length,before);
  h.setExecutionBusy(false);h.setOperation(()=>h.setExecutionBusy(true));await assert.rejects(h.groupAction(action,{planDigest:h.acceptance()?.plan.digest,unitIds:[]}));assert.equal(h.sourceWrites(),0);assert.equal(h.host.changeSetOperationGuards.size,0);
 }
});

test('async ownership changes preserve acceptance and source rather than committing an outdated decision',async()=>{
 for(const action of ['prepareAcceptance','selectUnits','clearAcceptance'])for(const mutate of [h=>h.host.project={...project,id:'foreign'},h=>h.host.project={...project,root:'/other'},h=>h.host.assistantView={webview:{}},h=>h.vscode.workspace.isTrusted=false,h=>h.host.changeSetActionGeneration++,h=>h.store.archive(h.store.snapshot().activeId),h=>h.store.newConversation()]){
  const h=await acceptanceHarness();if(action!=='prepareAcceptance')await h.prepare();const before=h.session.snapshot(),gate=deferred();h.setOperation(()=>gate.promise);const pending=h.groupAction(action,{planDigest:h.acceptance()?.plan.digest,unitIds:[]});await tick();await mutate(h);gate.resolve();await assert.rejects(pending);assert.deepEqual(h.session.snapshot().acceptance,before.acceptance);assert.equal(h.session.snapshot().current.revision,before.current.revision);assert.equal(h.sourceWrites(),0);assert.equal(h.host.changeSetOperationGuards.size,0);
 }
});

test('final history durability and immutable-content checks cannot be bypassed while a selection operation awaits',async()=>{
 for(const kind of ['storage','content','partial']){
  const h=await acceptanceHarness();await h.prepare();const before=h.session.snapshot(),gate=deferred();h.setOperation(()=>gate.promise);const pending=h.select([]);await tick();const old=h.store.snapshot.bind(h.store);h.store.snapshot=()=>{const value=old();if(kind==='storage')value.storage.status='error';if(kind==='content')value.conversations[0].turns[0].changeSet.files[0].after+='FORGED';if(kind==='partial')value.conversations[0].turns[0].completedWhileStopping=true;return value;};gate.resolve();await assert.rejects(pending);assert.equal(h.session.snapshot().current.revision,before.current.revision);assert.deepEqual(h.acceptance().selectedUnitIds,before.acceptance.selectedUnitIds);assert.equal(h.sourceWrites(),0);
 }
});

test('late loading cannot route a new acceptance decision into another view or project',async()=>{
 for(const mutate of [h=>h.host.assistantView={webview:{}},h=>h.host.project={...project,id:'foreign'},h=>h.host.changeSetActionGeneration++]){const h=await acceptanceHarness(),gate=deferred();h.setLoad(()=>gate.promise);const pending=h.prepare();await tick();mutate(h);gate.resolve();await pending;assert.equal(h.operations.length,0);assert.equal(h.sourceWrites(),0);}
});

test('partial acceptance lifecycle reload retains immutable full proposal and never marks skipped files applied',async()=>{
 const h=await acceptanceHarness(),original=h.session.snapshot().current;let current=structuredClone(original),revision=current.revision;
 for(const status of ['partially-applied','undoing','undone']){
  current={...current,status,revision:++revision,updatedAt:new Date().toISOString(),files:current.files.map((file,index)=>index===0?{...file,appliedRevision:createHash('sha256').update(file.after).digest('hex').slice(0,16)}:file)};
  await h.store.updateChangeSet(current);const snapshot=h.store.snapshot(),reloaded=storeModule.createConversationStore({projectId:project.id,read:()=>structuredClone(snapshot),write:async()=>{}});const turn=reloaded.snapshot().conversations.flatMap(chat=>chat.turns).find(turn=>turn.requestId===original.requestId);assert.ok(turn,JSON.stringify(reloaded.snapshot()));assert.deepEqual(turn.changeSet,current);assert.equal(turn.changeSet.files[1].appliedRevision,undefined);assert.deepEqual(turn.context,h.turn(original.requestId).context);assert.equal(turn.requestId,original.requestId);
 }
 const changed=structuredClone(current);changed.revision++;changed.files[1].after+='FORGED';await assert.rejects(h.store.updateChangeSet(changed),/different content|historical/i);
});

test('changing acceptance scope preserves old execution evidence and pauses old check plans without inheriting their results',async()=>{
 const h=await acceptanceHarness(),group=h.session.snapshot().current;
 const record={id:'old-execution',groupId:group.id,groupRevision:group.revision,groupDigest:proposalModule.changeGroupDigest(group),status:'passed',revision:4,output:'Old full-group result',snapshotRevision:'a'.repeat(64)};
 const plan={id:'old-plan',groupId:group.id,groupRevision:group.revision,groupDigest:record.groupDigest,status:'paused',revision:2,steps:[]};
 h.host.executionSessions=new Map([[project.id,{snapshot:()=>({current:structuredClone(record),history:[],busy:false,storage:{status:'saved'},assessment:{canPrepare:true,canRun:false}})}]]);
 h.host.checkPlanSessions=new Map([[project.id,{snapshot:()=>({current:structuredClone(plan),history:[],busy:false,storage:{status:'saved'},assessment:{canCreate:false,canRunNext:true,canRetryStep:false,canSkipStep:true,canEnd:true}})}]]);
 const actualSnapshot=()=>Object.getPrototypeOf(h.host).executionSnapshot.call(h.host);
 assert.equal(actualSnapshot().planSession.assessment.canRunNext,true);await h.prepare();await h.select([h.acceptance().plan.units[0].id]);
 const current=actualSnapshot();assert.deepEqual(plain(current.current),record);assert.deepEqual(plain(current.planSession.current),plan);assert.equal(current.assessment.canPrepare,false);assert.equal(current.assessment.canRun,false);assert.equal(current.planSession.assessment.canRunNext,false);assert.equal(current.planSession.assessment.canEnd,true);assert.match(current.planSession.assessment.reason,/earlier group/);assert.equal(h.sourceWrites(),0);
 await h.select(h.acceptance().plan.units.map(unit=>unit.id));assert.equal(h.host.wholeChangeSetScope(),true);assert.equal(actualSnapshot().assessment.canRun,false);assert.deepEqual(plain(actualSnapshot().current),record);
});

test('partial selected scope blocks new standalone checks and check-plan creation without starting a process',async()=>{
 const h=await acceptanceHarness();await h.prepare();await h.select([h.acceptance().plan.units[0].id]);let started=0;
 const exec={snapshot:()=>({current:null,busy:false,storage:{status:'saved'},assessment:{canPrepare:true}}),load:async()=>{},prepare:async()=>{started++;}};
 const plans={snapshot:()=>({current:null,history:[],busy:false,storage:{status:'saved'},assessment:{canCreate:true}}),load:async()=>{},create:async()=>{started++;}};
 h.host.executions=()=>exec;h.host.checkPlans=()=>plans;h.host.executionSessions=new Map([[project.id,exec]]);h.host.checkPlanSessions=new Map([[project.id,plans]]);const group=h.session.snapshot().current;
 await assert.rejects(h.host.executionAction({type:'executionAction',action:'prepare',projectId:project.id,changeSetId:group.id,expectedGroupRevision:group.revision},'assistant'),/whole proposal|every unit/);
 await assert.rejects(h.host.checkPlanAction({type:'checkPlanAction',action:'create',projectId:project.id,changeSetId:group.id,expectedGroupRevision:group.revision},'assistant'),/whole proposal|every unit/);assert.equal(started,0);assert.equal(h.sourceWrites(),0);
});
