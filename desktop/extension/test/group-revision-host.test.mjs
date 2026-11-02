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
const {changeGroupDigest}=proposalModule;
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


function groupRevisionHarness(){
 const h=harness();let featureId=null,versions=[],refineHook,activationHook;const refineCalls=[],activationCalls=[];
 h.host.featureSnapshot=()=>({projectId:project.id,activeId:featureId,features:[],revision:0,storage:{status:'saved'}});h.setFeature=value=>featureId=value;
 const priorSnapshot=h.session.snapshot.bind(h.session);h.session.snapshot=()=>({...priorSnapshot(),versions:structuredClone(versions)});
 h.session.refine=async(input,options)=>{refineCalls.push({input:structuredClone(input),options});const old=h.session.snapshot().current;
  assert.equal(options.parentId,old.id);assert.equal(options.expectedParentRevision,old.revision);assert.equal(options.parentDigest,changeGroupDigest(old));if(!options.isCurrent())throw Error('retired');if(refineHook)await refineHook(input,options);if(!options.isCurrent())throw Error('retired');
  const now=new Date().toISOString(),next={...structuredClone(input),createdAt:now,updatedAt:now};versions.push({group:structuredClone(old),checkpoints:[{id:'retained-checkpoint',kind:'staged'}]});h.setGroup(next);await h.store.updateChangeSet(next);return h.session.snapshot();};
 h.session.activateVersion=async(id,options)=>{activationCalls.push({id,options});assert.ok(options.isCurrent());if(activationHook)await activationHook();assert.ok(options.isCurrent());const old=h.session.snapshot().current,index=versions.findIndex(version=>version.group.id===id);assert.ok(index>=0);const next=versions[index].group;versions.splice(index,1,{group:old,checkpoints:[]});h.setGroup(next);return h.session.snapshot();};
 h.refineCalls=refineCalls;h.activationCalls=activationCalls;h.setRefine=hook=>refineHook=hook;h.setActivation=hook=>activationHook=hook;h.setVersions=value=>versions=structuredClone(value);
 h.descriptor=()=>{const group=h.session.snapshot().current;return{version:1,conversationId:h.store.snapshot().activeId,requestId:group.requestId,groupId:group.id,groupRevision:group.revision,groupDigest:changeGroupDigest(group)};};
 h.prepare=async(extra={},surface='assistant')=>{const group=h.session.snapshot().current;await h.host.groupRevisionAction({type:'groupRevisionAction',action:'prepare',projectId:project.id,featureId,conversationId:h.store.snapshot().activeId,requestId:group?.requestId,groupId:group?.id,expectedGroupRevision:group?.revision,prepareId:'prepare-group-1',...extra},surface);};
 h.refined=()=>proposalModule.createRefinedChangeSet({group:h.session.snapshot().current,files:originalFiles,projectId:project.id,raw:JSON.stringify({title:'Refine save wording',summary:'Refine the staged label while retaining service behavior.',edits:[{path:'src/Button.tsx',find:'>Save changes</button>',replace:'>Save profile now</button>'}],verification:['Check label and service together.']})});
 h.send=(extra={})=>h.ask('build',{requestId:'refined-request',prompt:'Refine only the staged label.',groupRevision:h.descriptor(),...extra});
 Object.defineProperty(h,'prepared',{get:()=>h.messages.filter(message=>message.type==='groupRevisionPrepared').at(-1)});return h;
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('prepare discloses exact staged after sources without provider calls or replacing the current group',async()=>{
 const h=groupRevisionHarness(),parent=await seedGroup(h),before=h.store.snapshot();await h.prepare({sharedFiles:[{source:'FORGED'}]});assert.ok(h.prepared,JSON.stringify(h.messages));assert.deepEqual(plain(h.prepared.groupRevision),h.descriptor());assert.deepEqual(h.prepared.files,originalFiles.map(({path,revision})=>({path,revision})));assert.equal(h.prepared.sharedFiles[0].source,parent.files[0].after);assert.equal(h.prepared.sharedFiles[1].source,parent.files[1].after);assert.equal(h.prepared.sharedFiles[2].source,originalFiles[2].source);assert.deepEqual(h.prepared.sharedFiles.map(file=>file.origin),['staged','staged','saved']);assert.equal(h.requests.length,1);assert.deepEqual(h.session.snapshot().current,parent);assert.deepEqual(h.store.snapshot(),before);assert.equal(h.refineCalls.length,0);
});

test('only normal completion promotes a composed group and retains original provider and source provenance',async()=>{
 const h=groupRevisionHarness(),parent=await seedGroup(h),next=h.refined();h.setFetch(()=>response([{type:'start',intent:'build',model:'reported-refinement'},{type:'delta',text:'Raw refinement output'},{type:'changeSet',changeSet:next},{type:'done',model:'reported-refinement',usage:{prompt_tokens:10,total_tokens:15}}]));await h.send();
 assert.equal(h.refineCalls.length,1,JSON.stringify(h.messages));assert.equal(h.session.snapshot().current.id,next.id);assert.deepEqual(h.session.snapshot().versions[0].group,parent);assert.equal(h.turn('refined-request').state,'complete');assert.equal(h.turn('refined-request').model,'reported-refinement');assert.equal(h.turn('refined-request').groupRevision.groupId,parent.id);assert.deepEqual(h.turn('refined-request').context,h.turn('new-request').context);assert.equal(h.turn('refined-request').changeSet.files[0].before,originalFiles[0].source);assert.equal(h.turn('refined-request').changeSet.files[1].after,parent.files[1].after);assert.deepEqual(h.turn('new-request').changeSet,parent);assert.equal(h.requests.at(-1).body.groupRevision.groupId,parent.id);assert.equal(h.requests.at(-1).body.sharedFiles,undefined);assert.deepEqual([...h.sources.values()],originalFiles);
});

test('candidate followed by error, EOF, duplicate artifact or Stop cannot replace the parent',async()=>{
 for(const end of ['error','eof','duplicate','stop']){
  const h=groupRevisionHarness(),parent=await seedGroup(h),next=h.refined(),gate=deferred();let read=0;
  if(end==='stop')h.setFetch(()=>({ok:true,body:{getReader:()=>({read:async()=>++read===1?{done:false,value:Buffer.from(JSON.stringify({type:'changeSet',changeSet:next})+'\n')}:gate.promise})}}));
  else h.setFetch(()=>response([{type:'changeSet',changeSet:next},...(end==='error'?[{type:'error',error:'fixture failure'}]:end==='duplicate'?[{type:'changeSet',changeSet:next},{type:'done'}]:[])]));
  const action=h.send();if(end==='stop'){await tick();await tick();h.host.cancelQuestion('refined-request');gate.resolve({done:true});}await action;
  assert.equal(h.refineCalls.length,0,end);assert.deepEqual(h.session.snapshot().current,parent,end);assert.equal(h.turn('refined-request').changeSet,undefined,end);assert.ok(['failed','stopped'].includes(h.turn('refined-request').state));
 }
});

test('child history write failure and checkpoint promotion failure leave the parent current',async()=>{
 for(const failure of ['history','checkpoint']){
  const h=groupRevisionHarness(),parent=await seedGroup(h),next=h.refined();h.setFetch(()=>response([{type:'changeSet',changeSet:next},{type:'done'}]));
  if(failure==='history')h.setWrite((_key,value)=>{if(value.conversations?.some(chat=>chat.turns.some(turn=>turn.requestId==='refined-request'&&turn.state==='complete')))throw Error('fixture storage failure');});else h.setRefine(()=>{throw Error('fixture checkpoint failure');});
  await h.send();assert.deepEqual(h.session.snapshot().current,parent);assert.equal(h.refineCalls.length,failure==='history'?0:1);assert.equal(h.messages.some(message=>message.requestId==='refined-request'&&message.event?.type==='done'),false);assert.deepEqual([...h.sources.values()],originalFiles);
 }
});

test('promotion cancellation while terminal history saves preserves the previous checkpoint',async()=>{
 const h=groupRevisionHarness(),parent=await seedGroup(h),next=h.refined(),gate=deferred();h.setFetch(()=>response([{type:'changeSet',changeSet:next},{type:'done'}]));let waiting=false;
 h.setWrite((_key,value)=>{if(value.conversations?.some(chat=>chat.turns.some(turn=>turn.requestId==='refined-request'&&turn.state==='complete'))){waiting=true;return gate.promise;}});const pending=h.send();for(let i=0;i<10&&!waiting;i++)await tick();assert.equal(waiting,true);h.host.cancelQuestion('refined-request');gate.resolve();await pending;assert.equal(h.refineCalls.length,0);assert.deepEqual(h.session.snapshot().current,parent);
});

test('wrong source basis, staged-before diffs, wrong group identity and single-file artifacts are refused before promotion',async()=>{
 for(const kind of ['context-order','before','current-id','single']){
  const h=groupRevisionHarness(),parent=await seedGroup(h),next=h.refined();let event={type:'changeSet',changeSet:next};if(kind==='context-order')next.context.reverse();if(kind==='before'){next.files[0].before=parent.files[0].after;next.files[0].baseRevision=createHash('sha256').update(next.files[0].before).digest('hex').slice(0,16);}if(kind==='current-id')next.id=parent.id;if(kind==='single')event={type:'proposal',proposal:{id:'single'}};
  h.setFetch(()=>response([event,{type:'done'}]));await h.send();assert.equal(h.refineCalls.length,0,kind);assert.deepEqual(h.session.snapshot().current,parent,kind);
 }
});

test('prepare and Send reject stale descriptor, selected drafts, changed saved context and incompatible handoffs',async()=>{
 for(const kind of ['dirty','source','descriptor','intent','subset','plan','revision','busy']){
  const h=groupRevisionHarness(),parent=await seedGroup(h);let extra={};if(kind==='dirty')h.dirty.add('src/consumer.ts');if(kind==='source')h.sources.set('src/consumer.ts',file('src/consumer.ts','changed source'));if(kind==='descriptor')extra.groupRevision={...h.descriptor(),groupDigest:'a'.repeat(64)};if(kind==='intent')extra.intent='ask';if(kind==='subset')extra.context=originalFiles.slice(0,2).map(({path,revision})=>({path,revision}));if(kind==='plan')extra.planContext={version:1};if(kind==='revision')extra.requestRevision={version:1};if(kind==='busy')h.setBusy(true);
  await h.send(extra).catch(()=>{});assert.equal(h.requests.length,1,kind);assert.equal(h.refineCalls.length,0);assert.deepEqual(h.session.snapshot().current,parent);
 }
});

test('async source, draft, feature, epoch, project, trust and conversation changes retire candidate ownership',async()=>{
 for(const mutate of [h=>h.dirty.add('src/consumer.ts'),h=>h.sources.set('src/consumer.ts',file('src/consumer.ts','changed')),h=>h.setFeature('other'),h=>h.host.featureSourceEpoch++,h=>h.host.project={...project,id:'other'},h=>h.host.project={...project,root:'/other'},h=>h.vscode.workspace.isTrusted=false,h=>h.host.disposed=true,h=>{const snapshot=h.store.snapshot.bind(h.store);h.store.snapshot=()=>({...snapshot(),activeId:'other'});}]){
  const h=groupRevisionHarness(),parent=await seedGroup(h),next=h.refined(),gate=deferred();h.setFetch(()=>gate.promise);const pending=h.send();await tick();await tick();await mutate(h);gate.resolve(response([{type:'changeSet',changeSet:next},{type:'done'}]));await pending;assert.equal(h.refineCalls.length,0);assert.deepEqual(h.session.snapshot().current,parent);
 }
});

test('provider resolver requires the owned live group request and rechecks every original source',async()=>{
 const h=groupRevisionHarness(),parent=await seedGroup(h),descriptor=h.descriptor();await assert.rejects(h.host.resolveProviderGroupRevision({projectId:project.id,...descriptor}));const gate=deferred();h.setFetch(()=>gate.promise);const pending=h.send();await tick();await tick();assert.deepEqual(await h.host.resolveProviderGroupRevision({projectId:project.id,...descriptor}),parent);await assert.rejects(h.host.resolveProviderGroupRevision({projectId:project.id,...descriptor,groupRevision:99}));h.dirty.add('src/consumer.ts');await assert.rejects(h.host.resolveProviderGroupRevision({projectId:project.id,...descriptor}));h.host.cancelQuestion('refined-request');gate.resolve(response([{type:'done'}]));await pending;assert.deepEqual(h.session.snapshot().current,parent);
});

test('historical diff and explicit version activation resolve exact saved checkpoints without source writes',async()=>{
 const h=groupRevisionHarness(),parent=await seedGroup(h),next=h.refined();h.setFetch(()=>response([{type:'changeSet',changeSet:next},{type:'done'}]));await h.send();const current=h.session.snapshot().current;
 await h.groupAction('diff',{changeSetId:parent.id,expectedRevision:parent.revision,fileId:parent.files[0].id,before:'FORGED',after:'FORGED'});assert.deepEqual([...h.host.snapshots.values()],[parent.files[0].before,parent.files[0].after]);
 await h.groupAction('activateVersion',{changeSetId:parent.id,expectedRevision:parent.revision,expectedCurrentId:current.id,expectedCurrentRevision:current.revision});assert.equal(h.activationCalls.length,1);assert.equal(h.session.snapshot().current.id,parent.id);assert.deepEqual([...h.sources.values()],originalFiles);assert.equal(h.requests.length,2);
});


test('composed artifact provenance is assigned by the host request rather than incoming request text',async()=>{
 const h=groupRevisionHarness();await seedGroup(h);const next={...h.refined(),requestId:'forged-provider-owner'};h.setFetch(()=>response([{type:'changeSet',changeSet:next},{type:'done'}]));await h.send();assert.equal(h.refineCalls.length,1);assert.equal(h.session.snapshot().current.requestId,'refined-request');assert.equal(h.turn('refined-request').changeSet.requestId,'refined-request');
});

test('old descriptor and asynchronous view ownership cannot prepare staged source',async()=>{
 for(const kind of ['revision','request','chat','feature','surface','dirty','view']){
  const h=groupRevisionHarness();await seedGroup(h);let extra={},surface='assistant';if(kind==='revision')extra.expectedGroupRevision=9;if(kind==='request')extra.requestId='foreign';if(kind==='chat')extra.conversationId='foreign';if(kind==='feature')extra.featureId='foreign';if(kind==='surface')surface='workspace';if(kind==='dirty')h.dirty.add('src/consumer.ts');
  if(kind==='view'){const gate=deferred();h.setRead(async(_id,path)=>{await gate.promise;return structuredClone(h.sources.get(path));});const pending=h.prepare();await tick();h.host.assistantView={webview:{postMessage(){}}};gate.resolve();await pending;}else await h.prepare(extra,surface);
  assert.equal(h.prepared,undefined,kind);assert.equal(h.requests.length,1);assert.equal(h.refineCalls.length,0);
 }
});

test('version activation rejects stale current identity, historical tampering and active execution',async()=>{
 for(const kind of ['current-id','current-revision','content','execution']){
  const h=groupRevisionHarness(),parent=await seedGroup(h),next=h.refined();h.setFetch(()=>response([{type:'changeSet',changeSet:next},{type:'done'}]));await h.send();const current=h.session.snapshot().current;let extra={changeSetId:parent.id,expectedRevision:parent.revision,expectedCurrentId:current.id,expectedCurrentRevision:current.revision};if(kind==='current-id')extra.expectedCurrentId='foreign';if(kind==='current-revision')extra.expectedCurrentRevision=99;if(kind==='content')h.setVersions([{group:{...parent,title:'Changed historical scope'}}]);if(kind==='execution')h.host.executionSnapshot=()=>({busy:true});
  await assert.rejects(h.groupAction('activateVersion',extra));assert.equal(h.activationCalls.length,0);assert.equal(h.session.snapshot().current.id,current.id);
 }
});

test('a checkpoint rename committed before durability failure reports the selected new version honestly',async()=>{
 const h=groupRevisionHarness(),parent=await seedGroup(h),next=h.refined();h.setFetch(()=>response([{type:'changeSet',changeSet:next},{type:'done'}]));
 h.session.refine=async(input,options)=>{assert.ok(options.isCurrent());h.setVersions([{parentId:null,group:parent,checkpoints:[]}]);h.setGroup({...input,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});h.setStorage({status:'error',error:'fixture directory sync failure after rename'});throw Error('fixture durability failure');};
 await h.send();assert.equal(h.session.snapshot().current.id,next.id);assert.equal(h.session.snapshot().storage.status,'error');assert.equal(h.turn('refined-request').changeSet.id,next.id);assert.deepEqual(h.turn('new-request').changeSet,parent);assert.deepEqual([...h.sources.values()],originalFiles);
 const failure=h.messages.filter(message=>message.requestId==='refined-request'&&message.event?.type==='error').at(-1);assert.ok(failure);assert.match(failure.event.error,/new version was selected.*durability/);assert.doesNotMatch(failure.event.error,/earlier group remains active/);
});
