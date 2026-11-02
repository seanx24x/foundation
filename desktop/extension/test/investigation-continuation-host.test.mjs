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
const continuationModule=await import(join(root,'server/project/investigation-continuation.mjs'));
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
  if(name.includes('investigation-continuation'))return continuationModule;if(name.includes('source-investigation'))return investigationModule;if(name.includes('execution-session'))return{changeGroupDigest};if(name==='vscode')return vscode;if(name.includes('assistant-artifacts'))return artifactModule;if(name.includes('assistant.mjs'))return assistantModule;if(name.includes('conversation-store'))return storeModule;if(name.includes('safety'))return safety;if(name.includes('proposals.mjs'))return proposalModule;
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
 file('src/api.ts',"import {writeProfile} from './transport';\nexport function saveProfile() { return writeProfile(); }\n"),
 file('src/transport.ts',"export function writeProfile() { return fetch('/api/profile?token=PRIVATE_RELATED_QUERY'); }\n"),
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

async function continuationHarness(){
 const h=await investigationHarness();await h.prepare();h.setFetch(successfulResponse);await h.send();assert.equal(h.turn('investigation-request')?.state,'complete');
 let validationHook,preparations=0;const validations=[];h.host.service.validateInvestigation=async(id,result,options)=>{validations.push({id,result,options});return validationHook?validationHook(id,result,options):true;};
 const api=Object.assign(h,{continuationValidations:validations,setInvestigationValidation:hook=>validationHook=hook,
  chat:()=>h.store.snapshot().conversations.find(chat=>chat.id===h.store.snapshot().activeId),
  continuationPrepared:()=>h.messages.filter(message=>message.type==='investigationContinuationPrepared').at(-1),
  continuationResult:()=>h.messages.filter(message=>message.type==='investigationContinuationResult').at(-1),
  continuationState:()=>h.host.investigationContinuationState(),
  chain:()=>continuationModule.deriveInvestigationChain(api.chat(),'investigation-request'),
  continuationAction(action,requestId='investigation-request',extra={}){return h.host.investigationContinuationAction({type:'investigationContinuationAction',action,projectId:project.id,featureId:h.features.activeId,featureRevision:h.features.revision,conversationId:h.store.snapshot().activeId,requestId,rootRequestId:'investigation-request',decisionId:h.turn(requestId)?.investigationDecision?.id,prepareId:`checkpoint-prepare-${++preparations}`,...extra});},
  async prepareDecision(requestId='investigation-request',extra={}){return api.continuationAction('prepare',requestId,extra);},
  decisionContext:()=>api.continuationPrepared().investigationContext,
  decisionDescriptor:()=>continuationModule.investigationContextDescriptor(api.decisionContext()),
  decision(kind='investigate',targetPath='src/api.ts'){const context=api.decisionContext();return continuationModule.createInvestigationDecision({projectId:project.id,context,raw:JSON.stringify({title:kind==='finish'?'Finish investigation':'Inspect one related source',summary:'Use only disclosed saved evidence.',decision:kind==='finish'?{kind:'finish',conclusion:'This bounded investigation is complete; runtime remains unknown.'}:{kind:'investigate',targetId:context.targets.find(target=>target.path===targetPath)?.id,reason:'Read the supported related source locally before deciding whether to share.'},limitations:['No runtime behavior or tests were verified.']})});},
  sendCheckpoint(requestId='checkpoint-1',extra={}){return h.host.ask({type:'ask',requestId,projectId:project.id,conversationId:h.store.snapshot().activeId,intent:'plan',prompt:'Continue this bounded investigation.',context:api.continuationPrepared().context,investigationContinuation:api.decisionDescriptor(),...extra});},
  async completeDecision(requestId='checkpoint-1',kind='investigate',target='src/api.ts'){const decision=api.decision(kind,target);h.setFetch(()=>response([{type:'start',intent:'plan'},{type:'delta',text:'Raw structured proposal'},{type:'investigationDecision',investigationDecision:decision},{type:'done'}]));await api.sendCheckpoint(requestId);assert.equal(h.turn(requestId)?.state,'complete',JSON.stringify(h.messages));return h.turn(requestId);},
 });return api;
}
const noMutation=h=>{assert.equal(h.documents.length+h.editors.length+h.commands.length+h.proposals.length,0);assert.equal(h.stageCalls.length,0);};

test('Preparing a continuation discloses only canonical prior explanation, result, targets and budget without a call or analysis',async()=>{
 const h=await continuationHarness(),queries=h.queries.length,requests=h.requests.length;await h.prepareDecision();const prepared=h.continuationPrepared(),context=prepared.investigationContext;assert.equal(context.previousExplanation.text,h.turn('investigation-request').answer);assert.equal(context.previousExplanation.kind,'answer');assert.deepEqual(context.budget,{modelStep:1,modelLimit:3,toolsUsed:0,toolLimit:2});assert.deepEqual(prepared.context,[{path:'src/Button.tsx',revision:h.sources.get('src/Button.tsx').revision}]);assert.ok(context.targets.some(target=>target.path==='src/api.ts'));assert.doesNotMatch(JSON.stringify(context),/PRIVATE_UNRELATED|PRIVATE_UNSHARED_SOURCE|PRIVATE_FILENAME_CANDIDATE|PRIVATE_RELATED_QUERY|manifest/);assert.equal(h.continuationState().status,'ready');assert.equal(h.requests.length,requests);assert.equal(h.queries.length,queries);assert.equal(h.chain().modelUsed,0);noMutation(h);
});

test('Explicit Plan Send saves one durable canonical decision and consumes one model slot without running a local tool',async()=>{
 const h=await continuationHarness();await h.prepareDecision();const queries=h.queries.length,context=structuredClone(h.decisionContext());const turn=await h.completeDecision();assert.deepEqual(turn.investigationContext,context);assert.equal(turn.investigationDecision.decision.kind,'investigate');assert.equal(turn.investigationDecision.verificationStatus,'not-run');assert.equal(turn.plan,undefined);assert.equal(turn.runtimeEvidence,undefined);assert.equal(h.chain().modelUsed,1);assert.equal(h.chain().toolUsed,0);assert.equal(h.chain().canRun,true);assert.equal(h.queries.length,queries);assert.deepEqual(plain(h.requests.at(-1).body.investigationContinuation),continuationModule.investigationContextDescriptor(context));noMutation(h);
});

test('Partial candidate, EOF, provider error, duplicate decision and ordinary Plan never create runnable actions and consume their reserved model slot',async()=>{
 for(const kind of ['eof','error','duplicate','ordinary-plan']){const h=await continuationHarness();await h.prepareDecision();const decision=h.decision();h.setFetch(()=>response([{type:'delta',text:'Partial proposed checkpoint'},{type:'investigationDecision',investigationDecision:decision},...(kind==='error'?[{type:'error',error:'Failed fixture'}]:kind==='duplicate'?[{type:'investigationDecision',investigationDecision:decision},{type:'done'}]:kind==='ordinary-plan'?[{type:'plan',plan:{}},{type:'done'}]:[])]));await h.sendCheckpoint();const turn=h.turn('checkpoint-1');assert.notEqual(turn.state,'complete');assert.equal(turn.investigationDecision,undefined);assert.equal(h.chain().modelUsed,1);assert.equal(h.chain().toolUsed,0);assert.equal(h.chain().canRun,false);assert.equal(h.chain().canContinue,true);noMutation(h);}
});

test('Forged descriptors, unsupported modes, extra source and mixed handoffs are rejected before reservation',async()=>{
 for(const extra of [{intent:'ask'},{intent:'build'},{intent:'review'},{runtimeContext:{}},{taskContext:{}},{sourceInvestigation:{}},{planContext:{}},{requestRevision:{}},{groupRevision:{}},{checkContext:{}},{context:[{path:'src/api.ts',revision:'0'.repeat(16)}]},h=>({investigationContinuation:{...h.decisionDescriptor(),digest:'f'.repeat(64)}})]){const h=await continuationHarness();await h.prepareDecision();await assert.rejects(h.sendCheckpoint('checkpoint-1',typeof extra==='function'?extra(h):extra));assert.equal(h.requests.length,1);assert.equal(h.chain().modelUsed,0);assert.equal(h.chain().toolUsed,0);}
});

test('Stop while a model reservation is being saved prevents dispatch but does not refund the reserved slot',async()=>{
 const h=await continuationHarness();await h.prepareDecision();const entered=deferred(),release=deferred();let gated=false;h.setWrite(async(_key,value)=>{if(!gated&&value.conversations?.some(chat=>chat.turns.some(turn=>turn.requestId==='checkpoint-1'))){gated=true;entered.resolve();await release.promise;}});const pending=h.sendCheckpoint();await entered.promise;assert.equal(h.chain().modelUsed,1);h.host.cancelQuestion();release.resolve();await pending;assert.equal(h.requests.length,1);assert.equal(h.turn('checkpoint-1').state,'stopped');assert.equal(h.chain().modelUsed,1);assert.equal(h.chain().canContinue,true);noMutation(h);
});

test('Concurrent Send cannot reserve or dispatch twice and stale provider resolution cannot impersonate the active request',async()=>{
 const h=await continuationHarness();await h.prepareDecision();const entered=deferred(),release=deferred(),decision=h.decision();h.setFetch(async()=>{entered.resolve();return release.promise;});const pending=h.sendCheckpoint();await entered.promise;await assert.rejects(h.sendCheckpoint('checkpoint-duplicate'),/Stop|current/);assert.equal(h.chain().modelUsed,1);assert.deepEqual(await h.host.resolveProviderInvestigationContinuation({projectId:project.id,...h.decisionDescriptor()}),h.decisionContext());await assert.rejects(h.host.resolveProviderInvestigationContinuation({projectId:'other',...h.decisionDescriptor()}),/active/);release.resolve(response([{type:'investigationDecision',investigationDecision:decision},{type:'done'}]));await pending;assert.equal(h.requests.length,2);assert.equal(h.chain().modelUsed,1);
});

test('A local run is durably reserved before analysis; duplicate Run and delayed Stop cannot change the owned attempt',async()=>{
 const h=await continuationHarness();await h.prepareDecision();await h.completeDecision();const before=h.queries.length,entered=deferred(),release=deferred();let gated=false;h.setWrite(async(_key,value)=>{if(!gated&&value.conversations?.some(chat=>chat.turns.some(turn=>turn.investigationAttempts?.some(attempt=>attempt.status==='running')))){gated=true;entered.resolve();await release.promise;}});const pending=h.continuationAction('run','checkpoint-1');await entered.promise;assert.equal(h.chain().toolUsed,1);assert.equal(h.queries.length,before);const busy=h.continuationState().busy;await assert.rejects(h.continuationAction('run','checkpoint-1'),/current investigation/);await h.continuationAction('stop','checkpoint-1',{attemptId:'old-attempt'});assert.equal(h.host.continuationBusy.stopped,false);await h.continuationAction('stop','checkpoint-1',{attemptId:busy.attemptId});release.resolve();await pending;assert.equal(h.queries.length,before);assert.equal(h.turn('checkpoint-1').investigationAttempts[0].status,'stopped');assert.equal(h.chain().toolUsed,1);assert.equal(h.chain().canRetryTool,true);assert.equal(h.requests.length,2);
});

test('Successful local result remains unshared until explicit preparation and Send of the next decision',async()=>{
 const h=await continuationHarness();await h.prepareDecision();await h.completeDecision();const requests=h.requests.length,queries=h.queries.length;await h.continuationAction('run','checkpoint-1');const attempt=h.turn('checkpoint-1').investigationAttempts[0];assert.equal(attempt.status,'complete');assert.equal(attempt.result.anchor.path,'src/api.ts');assert.equal(h.requests.length,requests);assert.equal(h.queries.length,queries+1);assert.equal(h.chain().canContinue,true);await h.prepareDecision('checkpoint-1');const next=h.decisionContext();assert.equal(next.result.id,attempt.result.id);assert.equal(next.previousExplanation.kind,'decision');assert.equal(next.previousExplanation.requestId,'checkpoint-1');assert.doesNotMatch(next.previousExplanation.text,/The saved source calls the service/);assert.deepEqual(next.budget,{modelStep:2,modelLimit:3,toolsUsed:1,toolLimit:2});assert.equal(h.requests.length,requests);assert.equal(h.queries.length,queries+1);noMutation(h);
});

test('Late local analysis cannot become a result after Stop, and a fresh retry consumes the second local slot',async()=>{
 const h=await continuationHarness();await h.prepareDecision();await h.completeDecision();const graph=await analyzeRelationships({projectId:project.id,anchorPath:'src/api.ts',files:[...h.sources.values()]}),entered=deferred(),release=deferred();h.setGraph(async()=>{entered.resolve();return release.promise;});const pending=h.continuationAction('run','checkpoint-1');await entered.promise;const busy=h.continuationState().busy;await h.continuationAction('stop','checkpoint-1',{attemptId:busy.attemptId});release.resolve(graph);await pending;assert.equal(h.turn('checkpoint-1').investigationAttempts[0].status,'stopped');assert.equal(h.turn('checkpoint-1').investigationAttempts[0].result,undefined);h.setGraph(undefined);await h.continuationAction('run','checkpoint-1');assert.equal(h.chain().toolUsed,2);assert.equal(h.turn('checkpoint-1').investigationAttempts[1].status,'complete');await h.prepareDecision('checkpoint-1');assert.equal(h.decisionContext().targets.length,0);assert.equal(h.decisionContext().budget.toolsUsed,2);assert.throws(()=>h.decision());const queries=h.queries.length;await h.continuationAction('run','checkpoint-1');assert.equal(h.queries.length,queries);assert.equal(h.chain().toolUsed,2);
});

test('Three model reservations exhaust the chain across failed retries and cannot be bypassed by reusing the seed',async()=>{
 const h=await continuationHarness();let parent='investigation-request';for(let index=1;index<=3;index++){await h.prepareDecision(parent);h.setFetch(()=>response([{type:'delta',text:'Incomplete decision'}]));await h.sendCheckpoint(`checkpoint-${index}`);parent=`checkpoint-${index}`;assert.equal(h.chain().modelUsed,index);}assert.equal(h.chain().ended,true);assert.equal(h.chain().canContinue,false);const calls=h.requests.length;await h.prepareDecision(parent);assert.ok(h.continuationResult().error);await h.prepareDecision('investigation-request');assert.ok(h.continuationResult().error);assert.equal(h.requests.length,calls);assert.equal(calls,4);
});

test('Complete bounded chain uses three explicit model decisions and two local attempts, then Finish forbids further work',async()=>{
 const h=await continuationHarness();await h.prepareDecision();await h.completeDecision('checkpoint-1');await h.continuationAction('run','checkpoint-1');await h.prepareDecision('checkpoint-1');await h.completeDecision('checkpoint-2','investigate','src/transport.ts');await h.continuationAction('run','checkpoint-2');await h.prepareDecision('checkpoint-2');assert.deepEqual(h.decisionContext().budget,{modelStep:3,modelLimit:3,toolsUsed:2,toolLimit:2});assert.equal(h.decisionContext().targets.length,0);await h.completeDecision('checkpoint-3','finish');const chain=h.chain();assert.equal(chain.ended,true);assert.equal(chain.modelUsed,3);assert.equal(chain.toolUsed,2);assert.equal(h.requests.length,4);const queries=h.queries.length;await h.continuationAction('run','checkpoint-2');await h.prepareDecision('checkpoint-3');assert.equal(h.queries.length,queries);assert.equal(h.requests.length,4);noMutation(h);
});

test('A stale or dirty source at each local boundary consumes the reservation but cannot publish a result',async()=>{
 for(const mutate of [h=>h.dirty.add('src/api.ts'),h=>h.features.revision++,h=>h.host.relationshipEpoch++,h=>h.host.assistantView={webview:{postMessage(){}}}]){const h=await continuationHarness();await h.prepareDecision();await h.completeDecision();let changed=false;h.setInvestigationValidation(()=>{if(!changed){changed=true;mutate(h);}return true;});await h.continuationAction('run','checkpoint-1');const attempt=h.turn('checkpoint-1').investigationAttempts[0];assert.ok(['failed','stopped'].includes(attempt.status));assert.equal(attempt.result,undefined);assert.equal(h.chain().toolUsed,1);assert.equal(h.requests.length,2);}
});

test('End is durable, exact-latest and non-executing, and ordinary request revision cannot remove chain provenance',async()=>{
 const h=await continuationHarness();await h.prepareDecision();await h.completeDecision();assert.throws(()=>h.host.resolveRequestRevision({version:1,conversationId:h.store.snapshot().activeId,requestId:'checkpoint-1'}),/investigation|checkpoint/);await h.continuationAction('end','investigation-request');assert.equal(h.chain().ended,false);const queries=h.queries.length;await h.continuationAction('end','checkpoint-1');assert.equal(h.chain().ended,true);assert.match(h.turn('investigation-request').investigationEnded.at,/^\d{4}-/);assert.equal(h.queries.length,queries);assert.equal(h.requests.length,2);await h.prepareDecision('checkpoint-1');assert.ok(h.continuationResult().error);
});


test('Failed local reservation remains charged and Retry storage never starts analysis',async()=>{
 const h=await continuationHarness();await h.prepareDecision();await h.completeDecision();const queries=h.queries.length;let failed=false;h.setWrite(async(_key,value)=>{if(!failed&&value.conversations?.some(chat=>chat.turns.some(turn=>turn.investigationAttempts?.some(attempt=>attempt.status==='running')))){failed=true;throw Error('Fixture reservation write failure');}});await h.continuationAction('run','checkpoint-1');assert.equal(h.store.snapshot().storage.status,'error');assert.equal(h.chain().toolUsed,1);assert.equal(h.turn('checkpoint-1').investigationAttempts[0].status,'failed');assert.equal(h.queries.length,queries);await h.continuationAction('run','checkpoint-1');assert.equal(h.queries.length,queries);h.setWrite(undefined);await h.store.retry();assert.equal(h.store.snapshot().storage.status,'saved');assert.equal(h.queries.length,queries);assert.equal(h.chain().toolUsed,1);await h.continuationAction('run','checkpoint-1');assert.equal(h.chain().toolUsed,2);assert.equal(h.queries.length,queries+1);assert.equal(h.requests.length,2);
});

test('A completed local result awaiting storage cannot be duplicated by Run or storage recovery',async()=>{
 const h=await continuationHarness();await h.prepareDecision();await h.completeDecision();let failed=false;h.setWrite(async(_key,value)=>{if(!failed&&value.conversations?.some(chat=>chat.turns.some(turn=>turn.investigationAttempts?.some(attempt=>attempt.status==='complete')))){failed=true;throw Error('Fixture result write failure');}});await h.continuationAction('run','checkpoint-1');assert.equal(h.store.snapshot().storage.status,'error');const attempt=h.turn('checkpoint-1').investigationAttempts[0],queries=h.queries.length;assert.equal(attempt.status,'complete');assert.ok(attempt.result);assert.equal(h.chain().toolUsed,1);await h.continuationAction('run','checkpoint-1');assert.equal(h.queries.length,queries);h.setWrite(undefined);await h.store.retry();assert.deepEqual(h.turn('checkpoint-1').investigationAttempts[0],attempt);assert.equal(h.queries.length,queries);assert.equal(h.requests.length,2);assert.equal(h.chain().toolUsed,1);
});

test('Failed model reservation remains charged after storage recovery without provider dispatch',async()=>{
 const h=await continuationHarness();await h.prepareDecision();h.setWrite(async(_key,value)=>{if(value.conversations?.some(chat=>chat.turns.some(turn=>turn.requestId==='checkpoint-1')))throw Error('Fixture model reservation failure');});await h.sendCheckpoint();assert.equal(h.store.snapshot().storage.status,'error');assert.equal(h.chain().modelUsed,1);assert.equal(h.turn('checkpoint-1').state,'failed');assert.equal(h.requests.length,1);h.setWrite(undefined);await h.store.retry();assert.equal(h.requests.length,1);assert.equal(h.chain().modelUsed,1);await h.prepareDecision('checkpoint-1');assert.equal(h.decisionContext().budget.modelStep,2);assert.equal(h.requests.length,1);
});

test('Affected source becoming dirty during either awaited local validation consumes the slot without publishing a result',async()=>{
 for(const boundary of [1,2]){const h=await continuationHarness();await h.prepareDecision();await h.completeDecision();const entered=deferred(),release=deferred();let validations=0;const before=h.queries.length;
 h.setInvestigationValidation(async()=>{if(++validations===boundary){entered.resolve();await release.promise;}return true;});
 const pending=h.continuationAction('run','checkpoint-1');await entered.promise;h.dirty.add('src/api.ts');release.resolve();await pending;
 const attempt=h.turn('checkpoint-1').investigationAttempts[0];assert.equal(attempt.status,'failed');assert.equal(attempt.result,undefined);assert.equal(h.chain().toolUsed,1);assert.equal(h.queries.length,before+(boundary===2?1:0));assert.equal(h.requests.length,2);assert.equal(h.store.snapshot().storage.status,'saved');}
});
