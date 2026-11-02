import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import * as alternatives from '../../../server/project/ai-alternatives.mjs';
import * as proposals from '../../../server/project/proposals.mjs';
import * as assistant from '../../../server/project/assistant.mjs';
import * as conversations from '../src/conversation-store.mjs';
import * as changes from '../src/change-set-session.mjs';
import * as verification from '../src/visual-verification-store.mjs';
import * as safety from '../src/safety.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),require=createRequire(join(root,'package.json')),ts=require('typescript');
const compiled=ts.transpileModule(`${readFileSync(join(root,'desktop/extension/src/extension.ts'),'utf8')}\nexport {FoundationHost};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const copy=value=>structuredClone(value),hash=value=>createHash('sha256').update(value).digest('hex'),tick=()=>new Promise(resolve=>setImmediate(resolve));
const file=(path,source)=>({path,source,revision:hash(source).slice(0,16)});
const original=[file('src/Button.tsx','export function Button() { return <button>Save</button>; }\n'),file('src/theme.css',':root { --radius: 8px; }\n'),file('src/context.ts','export const context = true;\n')];
const response=events=>{let read=false;return {ok:true,body:{getReader:()=>({read:async()=>read?{done:true}:(read=true,{done:false,value:Buffer.from(events.map(event=>JSON.stringify(event)).join('\n')+'\n')})})}};};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(t){
 const storageRoot=mkdtempSync(join(tmpdir(),'foundation-ai-alternatives-host-')),project={id:'ai-alternatives-host',root:'/fixture/ai-alternatives',files:original.map(({path})=>({path}))};
 const timestamp='2026-11-01T12:00:00.000Z',feature={id:randomUUID(),title:'Save profile',paths:original.map(item=>item.path),archived:false};
 const screen={id:randomUUID(),featureId:feature.id,title:'Profile',targetId:'vite:dev',route:'/profile',archived:false,createdAt:timestamp,updatedAt:timestamp};
 const scenario={id:randomUUID(),screenId:screen.id,title:'Save profile',steps:['Choose Save.'],expectedOutcome:'A saved state appears.',archived:false,createdAt:timestamp,updatedAt:timestamp};
 const features={revision:2,activeId:feature.id,storage:{status:'saved'},features:[feature]},workspace={revision:4,storage:{status:'saved'},screens:[screen],scenarios:[scenario],runs:[]};
 const sources=new Map(original.map(item=>[item.path,copy(item)])),dirty=new Set(),disk=new Map(),messages=[],requests=[],commands=[],writes=[],reads=[],stageCalls=[],sourceWrites=[];
 let readHook,fetchHook,writeHook,bridgeHook,showHook,stageHook,loadHook,checkpointError;let provider=true,digestCalls=0;
 const uri=fsPath=>({scheme:'file',fsPath,toString:()=>`file://${fsPath}`});
 const vscode={ViewColumn:{One:1,Two:2,Active:-1},Uri:{file:uri,from:value=>({...value,toString:()=>`${value.scheme}:${value.path}?${value.query}`})},
  workspace:{isTrusted:true,get textDocuments(){return [...dirty].map(path=>({isDirty:true,uri:uri(join(project.root,path))}));}},
  commands:{executeCommand:async(name,...args)=>commands.push({name,args})},window:{tabGroups:{all:[]},visibleTextEditors:[],activeTextEditor:undefined}};
 const instrumentedAlternatives={...alternatives,aiAlternativesDigest:value=>{digestCalls++;return alternatives.aiAlternativesDigest(value);}};
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,URL,AbortController,TextDecoder,structuredClone,setTimeout,clearTimeout,process,
  fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return fetchHook?fetchHook():response([{type:'done'}]);},
  require:name=>name==='vscode'?vscode:name.endsWith('/ai-alternatives.mjs')?instrumentedAlternatives:name.endsWith('/proposals.mjs')?proposals:name.includes('conversation-store')?conversations:name.includes('change-set-session')?changes:name.includes('visual-verification-store')?verification:name.includes('execution-session')?{changeGroupDigest:proposals.changeGroupDigest}:name.includes('assistant-bridge')?{createAssistantBridge:async()=>{if(bridgeHook)await bridgeHook();return {url:'http://127.0.0.1:1',token:'fixture-only',close:async()=>{}};}}:name.endsWith('/assistant.mjs')?assistant:name.includes('safety')?safety:name.startsWith('node:')?require(name):{}});
 const host=Object.create(module.exports.FoundationHost.prototype);
 Object.assign(host,{project:copy(project),disposed:false,context:{storageUri:{fsPath:storageRoot},workspaceState:{get:key=>copy(disk.get(key)),update:async(key,value)=>{if(writeHook)await writeHook(key,value);disk.set(key,copy(value));writes.push({key,value:copy(value)});}}},
  changeSetSessions:new Map(),changeSetOperationGuards:new Map(),changeSetActionGeneration:0,conversationStores:new Map(),snapshots:new Map(),design:{files:[],status:'idle'},askGeneration:0,featureSourceEpoch:0,focusGeneration:0,proposalMutationGeneration:0,proposalMutationCount:0,
  openFiles:copy(original),featureFiles:copy(original),artifactSourceFiles:[],artifactSourceUnavailable:[],activeFile:copy(original[0]),mode:'Review',
  panel:{visible:true,viewColumn:1,webview:{postMessage:async message=>{messages.push(copy(message));return true;}}},assistantView:{visible:true,webview:{postMessage:async message=>{messages.push(copy(message));return true;}}},
  dirtyPaths:()=>[...dirty],features:()=>({snapshot:()=>copy(features),presentation:()=>({snapshot:copy(features),epoch:features.revision})}),featureSnapshot:()=>copy(features),runtimeWorkspaceStore:()=>({snapshot:()=>copy(workspace),presentation:()=>({snapshot:copy(workspace),epoch:workspace.revision})}),
  assistant:{status:()=>({configured:provider,model:'fixture-model',providerKind:'compatible'})},proposals:()=>({current:()=>null,ownershipToken:()=>proposalToken}),executionSnapshot:()=>({busy:false}),visualVerificationWorkBusy:()=>false,loadExecutions:async()=>{},
  sendState(){},queueConversationState(){},refresh:async()=>{},sourceColumn:()=>1,warnConversationHistory:(_id,_kind,error)=>{checkpointError=error;},
  show:async mode=>{commands.push({name:'show',mode});host.mode=mode;if(showHook)await showHook();},
  service:{getFile:async(_id,path)=>{reads.push(path);if(readHook)await readHook(path);if(!sources.has(path))throw Error('Source unavailable');return copy(sources.get(path));},getFiles:async(_id,paths,options)=>{if(options?.isCurrent?.()===false)throw Error('retired');const files=[];for(const path of paths){if(readHook)await readHook(path);if(sources.has(path))files.push(copy(sources.get(path)));}if(options?.isCurrent?.()===false)throw Error('retired');return {files,unavailable:paths.filter(path=>!sources.has(path))};},applyBatch:async(...args)=>sourceWrites.push(args)}});
 const proposalToken={},store=host.conversations(),session=host.changeSets(),stage=session.stage,load=session.load;
 session.stage=async(value,options)=>{stageCalls.push(copy(value));if(stageHook)await stageHook(value,options);return stage(value,options);};
 session.load=async()=>{if(loadHook)await loadHook();return load();};
 host.changeSetSnapshot=()=>session.snapshot();
 const generation=()=>({version:1,count:2,scope:{feature:{id:feature.id,title:feature.title,revision:features.revision,paths:copy(feature.paths)},screen:copy(screen),scenario:copy(scenario),definitionRevision:workspace.revision}});
 const context=()=>original.map((item,index)=>({...item,id:`S${index+1}`,lines:item.source.split('\n').length}));
 const artifact=()=>alternatives.createAIAlternatives({projectId:project.id,files:context(),generation:generation(),raw:JSON.stringify({title:'Save alternatives',summary:'Two scoped visual directions.',candidates:[{name:'Compact',reason:'Keeps the action quiet.',title:'Compact Save',summary:'Short label and tighter shape.',edits:[{path:'src/Button.tsx',find:'>Save</button>',replace:'>Save profile</button>'},{path:'src/theme.css',find:'8px',replace:'4px'}],verification:['Replay the Save scenario.']},{name:'Prominent',reason:'Makes the action easier to notice.',title:'Prominent Save',summary:'Explicit label and larger shape.',edits:[{path:'src/Button.tsx',find:'>Save</button>',replace:'>Save changes</button>'},{path:'src/theme.css',find:'8px',replace:'12px'}],verification:['Replay the Save scenario.']} ]})});
 const h={host,Host:module.exports.FoundationHost,project,feature,screen,scenario,features,workspace,sources,dirty,disk,messages,requests,commands,writes,reads,stageCalls,sourceWrites,vscode,store,session,generation,context,artifact,
  setRead:value=>readHook=value,setFetch:value=>fetchHook=value,setWrite:value=>writeHook=value,setBridge:value=>bridgeHook=value,setShow:value=>showHook=value,setStage:value=>stageHook=value,setLoad:value=>loadHook=value,setProvider:value=>provider=value,
  turn:id=>store.snapshot().conversations.flatMap(chat=>chat.turns).find(turn=>turn.requestId===id),get checkpointError(){return checkpointError;},get digestCalls(){return digestCalls;},
  send:extra=>host.ask({type:'ask',requestId:'alternatives-request',projectId:project.id,conversationId:store.snapshot().activeId,intent:'build',prompt:'Explore two focused Save designs.',context:original.map(({path,revision})=>({path,revision})),alternativeGeneration:generation(),...extra}),
  review:extra=>{const turn=h.turn('alternatives-request'),value=turn.alternatives;return host.aiAlternativeAction({type:'aiAlternative',action:'review',projectId:project.id,conversationId:store.snapshot().activeId,requestId:turn.requestId,artifactId:value.id,candidateId:value.candidates[0].id,digest:alternatives.aiAlternativesDigest(value),...extra},'assistant');},
  seed:async()=>{const value=artifact();h.setFetch(()=>response([{type:'start',intent:'build'},{type:'delta',text:'Fixture structured alternatives'},{type:'alternatives',alternatives:value},{type:'done'}]));await h.send();assert.equal(h.turn('alternatives-request')?.state,'complete',JSON.stringify(messages));return h.turn('alternatives-request').alternatives;},
 };
 t.after(async()=>{host.cancelQuestion();session.dispose();await store.dispose().catch(()=>{});await rm(storageRoot,{recursive:true,force:true});});
 return h;
}

test('normal generation retains two canonical candidates without staging or changing project source',async t=>{
 const h=fixture(t),value=await h.seed();assert.equal(value.candidates.length,2);assert.equal(h.stageCalls.length,0);assert.equal(h.session.snapshot().current,null);assert.equal(h.sourceWrites.length,0);assert.deepEqual([...h.sources.values()],original);assert.deepEqual(value.generation,h.generation());assert.deepEqual(h.requests[0].body.alternativeGeneration,h.generation());assert.equal(value.verificationStatus,'not-run');assert.equal(h.turn('alternatives-request').changeSet,undefined);
 for(const candidate of value.candidates)assert.equal(candidate.changeSet.requestId,'alternatives-request');
});

test('explicit candidate review retains immutable generation and opens a native diff without applying',async t=>{
 const h=fixture(t),value=await h.seed(),history=copy(h.store.snapshot());await h.review({before:'FORGED',after:'FORGED'});const staged=h.session.snapshot().current;assert.equal(staged.id,value.candidates[0].changeSet.id);assert.equal(proposals.changeGroupDigest(staged),proposals.changeGroupDigest(value.candidates[0].changeSet));assert.equal(h.checkpointError,undefined);assert.deepEqual(h.store.snapshot(),history);assert.equal(h.sourceWrites.length,0);assert.deepEqual([...h.host.snapshots.values()],[staged.files[0].before,staged.files[0].after]);assert.equal(h.commands.filter(command=>command.name==='vscode.diff').length,1);assert.equal(h.host.alternativeGroupOwner(staged,h.project).turn.requestId,'alternatives-request');assert.equal(h.requests.length,1);
});

test('incomplete, cancelled, malformed, duplicate or wrong-kind response never exposes usable alternatives',async t=>{
 for(const end of ['error','eof','duplicate','wrong-kind','malformed','stop']){
  const h=fixture(t),value=h.artifact(),gate=deferred();let reads=0;
  if(end==='malformed')value.candidates[0].changeSet.files[0].before='forged';
  if(end==='stop')h.setFetch(()=>({ok:true,body:{getReader:()=>({read:async()=>++reads===1?{done:false,value:Buffer.from(JSON.stringify({type:'alternatives',alternatives:value})+'\n')}:gate.promise})}}));
  else h.setFetch(()=>response([{type:'alternatives',alternatives:value},...(end==='error'?[{type:'error',error:'fixture failed'}]:end==='eof'?[]:end==='duplicate'?[{type:'alternatives',alternatives:value},{type:'done'}]:end==='wrong-kind'?[{type:'changeSet',changeSet:value.candidates[0].changeSet},{type:'done'}]:[{type:'done'}])]));
  const pending=h.send();if(end==='stop'){for(let n=0;n<20&&reads===0;n++)await tick();assert.equal(reads>0,true);h.host.cancelQuestion('alternatives-request');gate.resolve({done:true});}await pending;
  assert.equal(h.stageCalls.length,0,end);assert.equal(h.sourceWrites.length,0,end);assert.equal(h.turn('alternatives-request').alternatives,undefined,end);assert.ok(['failed','stopped'].includes(h.turn('alternatives-request').state),end);
 }
});

test('scope resolver rejects forged, archived, foreign, missing and unsaved scenario ownership',async t=>{
 for(const mutate of [h=>h.feature.archived=true,h=>h.features.activeId='other',h=>h.features.storage.status='error',h=>h.workspace.storage.status='unavailable',h=>h.workspace.scenarios=[],h=>h.scenario.archived=true,h=>h.vscode.workspace.isTrusted=false,h=>h.host.project.id='another']){
  const h=fixture(t),generation=h.generation();mutate(h);await assert.rejects(Promise.resolve().then(()=>h.host.resolveAlternativeGeneration(generation,h.project.id)));assert.equal(h.requests.length,0);
 }
 const h=fixture(t),value=h.generation();value.scope.scenario.title='Forged';await assert.rejects(Promise.resolve().then(()=>h.host.resolveAlternativeGeneration(value,h.project.id)));await assert.rejects(Promise.resolve().then(()=>h.host.resolveAlternativeGeneration(h.generation(),'foreign')));
});

test('generation rejects contributing drafts, stale selected files and incompatible explicit context',async t=>{
 for(const kind of ['draft','source','feature-path','one-source','outside-path','ask-mode','task','runtime','issue','decision','plan','revision','group']){
  const h=fixture(t);const extra={};if(kind==='draft')h.dirty.add(original[2].path);if(kind==='source')h.sources.set(original[2].path,file(original[2].path,'changed'));if(kind==='feature-path')h.feature.paths.pop();if(kind==='one-source')extra.context=[{path:original[0].path,revision:original[0].revision}];if(kind==='outside-path')extra.context=[...original.slice(0,2).map(({path,revision})=>({path,revision})),{path:'package.json',revision:'0'.repeat(16)}];if(kind==='ask-mode')extra.intent='ask';if(kind==='task')extra.taskContext={};if(kind==='runtime')extra.runtimeContext={};if(kind==='issue')extra.issueContext=[];if(kind==='decision')extra.decisionContext=[];if(kind==='plan')extra.planContext={};if(kind==='revision')extra.requestRevision={};if(kind==='group')extra.groupRevision={};
  await h.send(extra).catch(()=>{});assert.equal(h.requests.length,0,kind);assert.equal(h.stageCalls.length,0,kind);assert.equal(h.sourceWrites.length,0,kind);
 }
});

test('source and ownership changes during generation retire the result without staging',async t=>{
 for(const mutate of [h=>h.dirty.add(original[2].path),h=>h.sources.set(original[2].path,file(original[2].path,'changed')),h=>h.features.revision++,h=>h.workspace.revision++,h=>h.features.activeId='other',h=>h.host.featureSourceEpoch++,h=>h.host.project={...h.project,root:'/other'},h=>h.vscode.workspace.isTrusted=false,h=>h.host.disposed=true]){
  const h=fixture(t),value=h.artifact(),gate=deferred();h.setFetch(()=>gate.promise);const pending=h.send();for(let n=0;n<30&&!h.requests.length;n++)await tick();assert.equal(h.requests.length,1);mutate(h);gate.resolve(response([{type:'alternatives',alternatives:value},{type:'done'}]));await pending;assert.equal(h.stageCalls.length,0);assert.equal(h.sourceWrites.length,0);assert.notEqual(h.turn('alternatives-request')?.state,'complete');assert.equal(h.turn('alternatives-request')?.alternatives,undefined);
 }
});

test('review resolves exact saved candidate and rejects stale identity, drafts and source drift',async t=>{
 for(const kind of ['digest','artifact','candidate','request','conversation','project','source','draft','scope','archived']){
  const h=fixture(t);await h.seed();const extra={};if(kind==='digest')extra.digest='0'.repeat(64);if(kind==='artifact')extra.artifactId=randomUUID();if(kind==='candidate')extra.candidateId=randomUUID();if(kind==='request')extra.requestId='foreign';if(kind==='conversation')extra.conversationId='foreign';if(kind==='project')extra.projectId='foreign';if(kind==='source')h.sources.set(original[2].path,file(original[2].path,'changed'));if(kind==='draft')h.dirty.add(original[2].path);if(kind==='scope')h.scenario.expectedOutcome='Different';if(kind==='archived')await h.store.archive(h.store.snapshot().activeId,true);
  await assert.rejects(h.review(extra),kind);assert.equal(h.stageCalls.length,0,kind);assert.equal(h.sourceWrites.length,0,kind);assert.equal(h.commands.some(command=>command.name==='vscode.diff'),false,kind);
 }
});

test('review preserves an unrelated draft and cannot stage the same retained candidate twice',async t=>{
 const h=fixture(t);await h.seed();h.dirty.add('src/Unrelated.tsx');await h.review();assert.ok(h.dirty.has('src/Unrelated.tsx'));await assert.rejects(h.review());assert.equal(h.stageCalls.length,1);assert.equal(h.sourceWrites.length,0);
});

test('review loses authority when the source or workspace changes during staging',async t=>{
 for(const mutate of [h=>h.dirty.add(original[1].path),h=>h.host.featureSourceEpoch++,h=>h.features.activeId='foreign',h=>h.workspace.revision++,h=>h.vscode.workspace.isTrusted=false,h=>h.host.project={...h.project,root:'/other'}]){
  const h=fixture(t);await h.seed();h.setStage(()=>mutate(h));await assert.rejects(h.review());assert.equal(h.session.snapshot().current,null);assert.equal(h.sourceWrites.length,0);assert.equal(h.commands.some(command=>command.name==='vscode.diff'),false);
 }
});

test('provider scope resolver accepts only the live owning request and exact canonical generation',async t=>{
 const h=fixture(t),generation=h.generation(),gate=deferred();assert.throws(()=>h.host.resolveProviderAlternativeGeneration(h.project.id,generation));h.setFetch(()=>gate.promise);const pending=h.send();for(let n=0;n<30&&!h.requests.length;n++)await tick();assert.equal(h.requests.length,1);assert.deepEqual(h.host.resolveProviderAlternativeGeneration(h.project.id,generation),generation);assert.throws(()=>h.host.resolveProviderAlternativeGeneration('foreign',generation));const changed=copy(generation);changed.scope.scenario.title='Other';assert.throws(()=>h.host.resolveProviderAlternativeGeneration(h.project.id,changed));h.host.cancelQuestion('alternatives-request');assert.throws(()=>h.host.resolveProviderAlternativeGeneration(h.project.id,generation));gate.resolve(response([{type:'done'}]));await pending;assert.equal(h.stageCalls.length,0);
});

test('source revalidation after durable start and bridge setup prevents undisclosed provider dispatch',async t=>{
 for(const boundary of ['write','bridge'])for(const mutate of [h=>h.dirty.add(original[2].path),h=>h.sources.set(original[2].path,file(original[2].path,'changed')),h=>h.features.revision++,h=>h.workspace.revision++]){
  const h=fixture(t);let changed=false;const hook=()=>{if(!changed){changed=true;mutate(h);}};if(boundary==='write')h.setWrite(hook);else h.setBridge(hook);await h.send();assert.equal(h.requests.length,0,boundary);assert.equal(h.stageCalls.length,0);assert.equal(h.sourceWrites.length,0);
 }
});

test('local storage failure blocks dispatch or review without source effects and retained alternatives restore without work',async t=>{
 const initial=fixture(t);initial.setWrite(()=>{throw Error('fixture unavailable');});await initial.send();assert.equal(initial.requests.length,0);assert.equal(initial.stageCalls.length,0);
 const terminal=fixture(t);terminal.setWrite((_key,value)=>{if(value.conversations?.some(chat=>chat.turns.some(turn=>turn.state==='complete')))throw Error('fixture terminal durability failure');});const artifact=terminal.artifact();terminal.setFetch(()=>response([{type:'alternatives',alternatives:artifact},{type:'done'}]));await terminal.send();assert.equal(terminal.store.snapshot().storage.status,'error');await assert.rejects(terminal.review());assert.equal(terminal.stageCalls.length,0);assert.equal(terminal.sourceWrites.length,0);
 const h=fixture(t),saved=await h.seed(),beforeRequests=h.requests.length;const restored=conversations.createConversationStore({projectId:h.project.id,read:()=>copy(h.disk.get(`foundation.conversations.${h.project.id}`)),write:()=>{throw Error('Restoration must not write');}});t.after(()=>restored.dispose());assert.deepEqual(restored.snapshot().conversations[0].turns[0].alternatives,saved);assert.equal(h.requests.length,beforeRequests);assert.equal(h.session.snapshot().current,null);
});

test('generated candidates cannot directly apply, partially accept, refine, activate or execute',async t=>{
 const h=fixture(t);await h.seed();await h.review();const group=h.session.snapshot().current,history=copy(h.store.snapshot());
 for(const action of ['apply','undo','recover','prepareAcceptance','selectUnits','clearAcceptance','activateVersion'])await assert.rejects(h.host.changeSetAction({projectId:h.project.id,action,changeSetId:group.id,expectedRevision:group.revision,expectedCurrentId:group.id,expectedCurrentRevision:group.revision},'assistant'));
 assert.throws(()=>h.host.resolveGroupRevision({version:1,conversationId:h.store.snapshot().activeId,requestId:group.requestId,groupId:group.id,groupRevision:group.revision,groupDigest:proposals.changeGroupDigest(group)}),/candidate/);
 let prepared=0;const execution={load:async()=>{},snapshot:()=>({busy:false,storage:{status:'saved'},current:null}),prepare:async()=>prepared++},checkPlans={load:async()=>{},snapshot:()=>({busy:false,storage:{status:'saved'},current:null})};h.host.executions=()=>execution;h.host.checkPlans=()=>checkPlans;h.host.checkPlanSessions=new Map([[h.project.id,checkPlans]]);
 await assert.rejects(h.host.executionAction({projectId:h.project.id,action:'prepare',changeSetId:group.id,expectedGroupRevision:group.revision},'assistant'));
 assert.equal(prepared,0);assert.equal(h.sourceWrites.length,0);assert.deepEqual(h.store.snapshot(),history);assert.equal(h.session.snapshot().current.id,group.id);
});

test('generated candidate hands its complete original group and frozen scope to retained comparison',async t=>{
 const h=fixture(t),artifact=await h.seed();await h.review();const group=h.session.snapshot().current,history=copy(h.store.snapshot()),recipe={id:'save-profile',title:'Save profile',route:h.screen.route,fixture:{id:'profile',label:'Profile'},steps:[{id:'save',title:'Save'}]},prepared=[];
 const state={revision:0,storage:{status:'saved'},busy:false,records:[]};h.host.runtime={snapshot:()=>({status:'connected',target:{id:'vite:dev'},replayCatalog:{digest:'d'.repeat(64),recipes:[recipe]}})};
 h.host.alternativesSession=()=>({snapshot:()=>copy(state),prepareChangeSet:async(input,{guard})=>{for(let i=0;i<200;i++)await guard();prepared.push(copy(input));return {id:randomUUID()};}});
 const view=h.host.visualAlternativesGroupProposal();assert.equal(view.canPrepare,true,view.reason);
 await h.host.visualAlternativesGroupAction({action:'prepare',expectedRevision:0,proposalId:group.id,proposalBasis:proposals.changeGroupDigest(group),scenarioId:h.scenario.id,recipeId:recipe.id,candidateName:artifact.candidates[0].name,captureEach:false,requested:{theme:'dark',motion:'reduce',viewportWidthCss:960,viewportHeightCss:680}},h.project);
 assert.equal(prepared.length,1);assert.deepEqual(prepared[0].changeSet,group);assert.deepEqual(prepared[0].scope,artifact.generation.scope);assert.equal(h.sourceWrites.length,0);assert.equal(h.requests.length,1);assert.deepEqual(h.store.snapshot(),history);
});

test('discard preserves the generated artifact and cannot silently recreate an earlier candidate checkpoint',async t=>{
 const h=fixture(t),artifact=await h.seed();await h.review();const group=h.session.snapshot().current;await h.host.changeSetAction({projectId:h.project.id,action:'discard',changeSetId:group.id,expectedRevision:group.revision},'assistant');assert.equal(h.session.snapshot().current.status,'discarded');await assert.rejects(h.review(),/retained review checkpoint/);assert.deepEqual(h.turn('alternatives-request').alternatives,artifact);await h.review({candidateId:artifact.candidates[1].id});assert.equal(h.session.snapshot().current.id,artifact.candidates[1].changeSet.id);assert.equal(h.session.snapshot().versions.length,2);assert.equal(h.sourceWrites.length,0);
});

test('an in-flight candidate review rejects overlapping review and source actions, and interruption preserves the empty checkpoint',async t=>{
 const h=fixture(t);await h.seed();const gate=deferred();let waiting=false;h.setRead(async()=>{waiting=true;await gate.promise;});const pending=h.review();for(let n=0;n<30&&!waiting;n++)await tick();assert.equal(waiting,true);assert.equal(h.host.alternativesBusy(),true);await assert.rejects(h.review(),/Finish the current/);await assert.rejects(h.host.changeSetAction({projectId:h.project.id,action:'refresh'},'assistant'),/Stop the comparison/);h.host.interruptAlternatives();gate.resolve();await assert.rejects(pending);assert.equal(h.stageCalls.length,0);assert.equal(h.session.snapshot().current,null);assert.equal(h.sourceWrites.length,0);assert.equal(h.host.aiAlternativeReview,undefined);
});

test('a cancelled native reveal leaves the saved candidate inspectable without opening a late diff or sending success',async t=>{
 const h=fixture(t),artifact=await h.seed();h.setShow(()=>h.host.interruptAlternatives());await assert.rejects(h.review(),/review context changed/);assert.equal(h.session.snapshot().current.id,artifact.candidates[0].changeSet.id);assert.equal(h.commands.some(command=>command.name==='vscode.diff'),false);assert.equal(h.messages.filter(message=>message.type==='aiAlternativeResult').at(-1).error!==undefined,true);assert.equal(h.sourceWrites.length,0);assert.deepEqual(h.turn('alternatives-request').alternatives,artifact);
});

test('generated comparison stays pinned to the original selected scenario even when another recipe-compatible scenario exists',async t=>{
 const h=fixture(t),other={...copy(h.scenario),id:randomUUID(),title:'Retry Save',steps:['Choose Save again.']};h.workspace.scenarios.push(other);await h.seed();await h.review();const group=h.session.snapshot().current,recipe={id:'save-profile',title:'Save profile',route:h.screen.route,fixture:{id:'profile',label:'Profile'},steps:[{id:'save',title:'Save'}]},prepared=[];
 h.host.runtime={snapshot:()=>({status:'connected',target:{id:'vite:dev'},replayCatalog:{digest:'d'.repeat(64),recipes:[recipe]}})};h.host.alternativesSession=()=>({snapshot:()=>({revision:0,storage:{status:'saved'},busy:false,records:[]}),prepareChangeSet:async input=>prepared.push(input)});
 const view=h.host.visualAlternativesGroupProposal();assert.deepEqual([...view.scenarios.map(item=>item.scenarioId)],[h.scenario.id]);await assert.rejects(h.host.visualAlternativesGroupAction({action:'prepare',expectedRevision:0,proposalId:group.id,proposalBasis:proposals.changeGroupDigest(group),scenarioId:other.id,recipeId:recipe.id,captureEach:false,requested:{theme:'dark',motion:'reduce',viewportWidthCss:960,viewportHeightCss:680}},h.project));assert.equal(prepared.length,0);assert.equal(h.sourceWrites.length,0);
});


test('streaming presentation changes reuse the digest of each unchanged frozen alternative artifact',async t=>{
 const h=fixture(t);await h.seed();await h.store.startTurn({requestId:'live-display-stream',prompt:'Inspect saved source.',intent:'ask',context:h.context(),conversationId:h.store.snapshot().activeId});
 const artifact=()=>h.store.presentation().snapshot.conversations.flatMap(chat=>chat.turns).find(turn=>turn.requestId==='alternatives-request').alternatives;
 const retained=artifact();assert.equal(Object.isFrozen(retained),true);const first=h.host.aiAlternativesSnapshot(),digest=first.reviewChoices[0].digest,calls=h.digestCalls;assert.ok(calls>0);
 for(let index=0;index<30;index++){h.store.event('live-display-stream',{type:'delta',text:'more '});assert.equal(artifact(),retained);const current=h.host.aiAlternativesSnapshot();assert.notEqual(current,first);assert.equal(current.reviewChoices[0].digest,digest);assert.equal(h.digestCalls,calls,'A new stream revision must not hash unchanged retained source again');}
 h.store.event('live-display-stream',{type:'done'});await h.store.flush();assert.equal(h.host.aiAlternativesSnapshot().reviewChoices[0].digest,digest);assert.equal(h.digestCalls,calls);
});

test('presentation digest cache follows artifact object identity and cannot authorize a forged review',async t=>{
 const h=fixture(t);await h.seed();const artifact=h.store.presentation().snapshot.conversations[0].turns[0].alternatives;
 const digest=h.host.aiAlternativesPresentationDigest(artifact),calls=h.digestCalls;assert.equal(h.host.aiAlternativesPresentationDigest(artifact),digest);assert.equal(h.digestCalls,calls);
 const replacement=copy(artifact);replacement.title='A different retained design brief';const changed=h.host.aiAlternativesPresentationDigest(replacement);assert.notEqual(changed,digest);assert.equal(h.digestCalls,calls+1);assert.equal(h.host.aiAlternativesPresentationDigest(replacement),changed);assert.equal(h.digestCalls,calls+1);
 const canonicalCalls=h.digestCalls;await assert.rejects(h.review({digest:changed}),/saved, active conversation/);assert.equal(h.digestCalls,canonicalCalls+1,'Review independently computes canonical identity instead of using a display cache');assert.equal(h.stageCalls.length,0);assert.equal(h.sourceWrites.length,0);assert.equal(h.host.aiAlternativesPresentationDigest(artifact),digest);
});
