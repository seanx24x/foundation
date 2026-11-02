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
const safety=await import(join(root,'desktop/extension/src/safety.mjs'));
const compiled=ts.transpileModule(`${readFileSync(join(root,'desktop/extension/src/extension.ts'),'utf8')}\nexport { FoundationHost };`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const file=(path,source)=>({path,source,revision:createHash('sha256').update(source).digest('hex').slice(0,16)});
const originalFiles=[file('src/Button.tsx','export function Button() {\n  return <button>Save</button>;\n}\n'),file('src/api.ts','export function save() {\n  return Promise.resolve(true);\n}\n')];
const project={id:'modes-project',root:'/fixtures/modes',files:originalFiles.map(({path})=>({path}))};
const uri=fsPath=>({fsPath,scheme:'file',toString:()=>`file://${fsPath}`});
function response(events){let consumed=false;return{ok:true,body:{getReader:()=>({read:async()=>consumed?{done:true}:(consumed=true,{done:false,value:Buffer.from(events.map(e=>JSON.stringify(e)).join('\n')+'\n')})})}};}
const rawPlan=()=>({title:'Improve save',summary:'Review the selected save feature.',steps:[{title:'Clarify button',detail:'Clarify the button label.',references:[{sourceId:'S1',line:2}]},{title:'Inspect service',detail:'Check saved service source.',references:[{sourceId:'S2',line:1}]},{title:'Coordinate scope',detail:'Review both files together.',references:[{sourceId:'S1',line:1},{sourceId:'S2',line:1}]},{title:'Collect evidence',detail:'Gather missing runtime evidence.',references:[]}],risks:['No runtime was exercised.'],verification:['Inspect named loading and error states.']});
function harness(){
 const persisted=new Map(),messages=[],writes=[],reads=[],requests=[],proposals=[],documents=[],editors=[],commands=[],sources=new Map(originalFiles.map(f=>[f.path,structuredClone(f)])),dirty=new Set();
 let readHook,fetchHook,bridgeHook,writeHook,openHook;
 const vscode={ViewColumn:{Active:-1,One:1,Two:2},Range:class{constructor(...values){this.values=values;}},Uri:{file:uri},
  workspace:{isTrusted:true,textDocuments:[],openTextDocument:async value=>{documents.push(value.fsPath);return openHook?openHook(value):document(value);}},
  window:{visibleTextEditors:[],activeTextEditor:{document:{uri:uri(project.root+'/src/Unrelated.ts'),isDirty:true}},tabGroups:{all:[{viewColumn:1},{viewColumn:2}]},showTextDocument:async(doc,options)=>{editors.push({doc,options});const editor={document:doc};vscode.window.activeTextEditor=editor;host.focusGeneration++;return editor;}},
  commands:{executeCommand:async(...args)=>{commands.push(args);throw Error('No runtime/editor command is allowed in this host fixture');}}};
 const document=value=>{const source=sources.get(relative(project.root,value.fsPath));return{uri:value,lineCount:source.source.split('\n').length,isDirty:dirty.has(source.path),getText:()=>source.source};};
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,URL,AbortController,TextDecoder,setTimeout,clearTimeout,fetch:async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return fetchHook?fetchHook(url,options):response([{type:'done'}]);},require:name=>{
  if(name==='vscode')return vscode;if(name.includes('assistant-artifacts'))return artifactModule;if(name.includes('assistant.mjs'))return assistantModule;if(name.includes('conversation-store'))return storeModule;if(name.includes('safety'))return safety;
  if(name.includes('assistant-bridge'))return{createAssistantBridge:async()=>bridgeHook?bridgeHook():{url:'http://127.0.0.1:1',token:'fixture-only',close:async()=>{}}};
  if(name.startsWith('node:'))return requireProject(name);return{};
 }});
 const host=Object.create(module.exports.FoundationHost.prototype);
 Object.assign(host,{project:structuredClone(project),disposed:false,context:{workspaceState:{get:key=>structuredClone(persisted.get(key)),update:async(key,value)=>{if(writeHook)await writeHook(key,value);persisted.set(key,structuredClone(value));writes.push({key,value:structuredClone(value)});}}},
  conversationStores:new Map(),queueConversationState(){},sendState(){},askGeneration:0,focusGeneration:0,featureSourceEpoch:0,planActionGeneration:0,artifactSourceFiles:[],artifactSourceUnavailable:[],openFiles:structuredClone(originalFiles),featureFiles:[],activeFile:structuredClone(originalFiles[0]),panel:{viewColumn:1},dirtyPaths:()=>[...dirty],assistant:{status:()=>({configured:true,model:'fixture-model',providerKind:'compatible'})},
  assistantView:{visible:true,webview:{postMessage:message=>messages.push(structuredClone(message))}},proposals:()=>({current:()=>null,set:async(value,{isCurrent})=>{if(isCurrent())proposals.push(structuredClone(value));}}),service:{getFile:async(id,path)=>{reads.push({id,path});return readHook?readHook(id,path):structuredClone(sources.get(path));}}});
 const store=host.conversations();
 const context=()=>originalFiles.map((f,index)=>({...f,id:`S${index+1}`,lines:f.source.split('\n').length}));
 const h={host,store,vscode,sources,dirty,persisted,messages,writes,reads,requests,proposals,documents,editors,commands,document,context,
  setRead:hook=>readHook=hook,setFetch:hook=>fetchHook=hook,setBridge:hook=>bridgeHook=hook,setWrite:hook=>writeHook=hook,setOpen:hook=>openHook=hook,
  turn:id=>store.snapshot().conversations.flatMap(chat=>chat.turns).find(turn=>turn.requestId===id),
  async seed(kind='plan',stopping=false){const artifact=kind==='plan'?artifactModule.createPlanArtifact({raw:JSON.stringify(rawPlan()),files:context(),projectId:project.id}):artifactModule.createReviewArtifact({raw:JSON.stringify({title:'Review save',summary:'Selected source only.',findings:[{severity:'low',title:'Fixed label',detail:'The source uses a fixed label.',references:[{sourceId:'S1',line:2}]}],limitations:['Not verified at runtime.']}),files:context(),projectId:project.id});
   await store.startTurn({requestId:`${kind}-request`,prompt:`${kind} source`,intent:kind,context:context()});store.event(`${kind}-request`,{type:kind,[kind]:artifact});if(stopping)store.event(`${kind}-request`,{type:'stopping'});store.event(`${kind}-request`,{type:'done'});await store.flush();return artifact;},
  action(action,extra={}){const turn=h.turn('plan-request')||h.turn('review-request'),artifact=turn.plan||turn.review;return host.planAction({type:'planAction',action,projectId:project.id,conversationId:store.snapshot().activeId,requestId:turn.requestId,artifactId:artifact.id,expectedRevision:turn.planRevisions?.at(-1)?.revision,...extra});},
  descriptor(extra={}){const turn=h.turn('plan-request');return{version:1,conversationId:store.snapshot().activeId,requestId:turn.requestId,artifactId:turn.plan.id,revision:turn.planRevisions.at(-1).revision,stepId:turn.plan.steps[0].id,...extra};},
  ask(intent='ask',extra={}){return host.ask({type:'ask',requestId:'new-request',prompt:'Clarify this saved source.',projectId:project.id,conversationId:store.snapshot().activeId,intent,context:[{path:originalFiles[0].path,revision:originalFiles[0].revision}],...extra});},
  get result(){return messages.filter(m=>m.type==='planActionResult').at(-1);},
 };
 return h;
}

test('four modes and legacy Build bind provider artifacts before any proposal side effect',async()=>{
 for(const mode of ['ask','plan','build','review','change'])for(const type of ['proposal','plan','review']){
  const h=harness(),canonical=mode==='change'?'build':mode;h.setFetch(()=>response([{type,[type]:{id:'untrusted'}},{type:'done'}]));await h.ask(mode);
  assert.equal(h.requests[0].body.intent,canonical);
  if((type==='proposal'?'build':type)!==canonical){assert.equal(h.proposals.length,0);assert.equal(h.messages.find(m=>m.event)?.event.type,'error');assert.equal(h.turn('new-request').state,'failed');}
 }
});

test('artifact actions are Assistant-only and reject foreign ownership, stale revisions, active requests and unavailable storage',async()=>{
 const mutations=[h=>({projectId:'foreign'}),h=>({conversationId:'foreign'}),h=>({requestId:'foreign'}),h=>({artifactId:'foreign'}),h=>({expectedRevision:99}),h=>{h.vscode.workspace.isTrusted=false;return{};},h=>{h.host.disposed=true;return{};},h=>{h.host.asking={};return{};}];
 for(const mutate of mutations){const h=harness();await h.seed();await h.action('checkSources',mutate(h));assert.equal(h.reads.length,0);assert.equal(h.requests.length,0);assert.equal(h.host.currentArtifactSourceFiles().length,0);}
 const h=harness(),artifact=await h.seed();await h.host.message({type:'planAction',action:'checkSources',projectId:project.id,conversationId:h.store.snapshot().activeId,requestId:'plan-request',artifactId:artifact.id,expectedRevision:0},'workspace');assert.equal(h.reads.length,0);
});

test('Check sources reads original plan basis locally into a separate cache and preserves AI selections and focus',async()=>{
 const h=harness();await h.seed();const open=structuredClone(h.host.openFiles),editor=h.vscode.window.activeTextEditor;h.setRead((_id,path)=>{if(path==='src/api.ts')throw Error('PRIVATE_OS_ERROR');return{...h.sources.get(path),revision:'newer'};});
 await h.action('checkSources');assert.equal(h.result.passed,true);assert.deepEqual(structuredClone(h.host.currentArtifactSourceFiles().map(f=>f.path)),['src/Button.tsx']);assert.deepEqual(structuredClone(h.host.artifactSourceUnavailable),['src/api.ts']);
 assert.deepEqual(h.host.openFiles,open);assert.equal(h.vscode.window.activeTextEditor,editor);assert.equal(h.requests.length+h.documents.length+h.editors.length+h.commands.length,0);assert.doesNotMatch(JSON.stringify(h.messages),/PRIVATE_OS_ERROR/);
 h.host.featureSourceEpoch++;assert.equal(h.host.currentArtifactSourceFiles().length,0);
});

test('Prepare Build emits one referenced file only, retains host-owned plan identity, and rejects skipped/multifile/empty steps',async()=>{
 const h=harness(),artifact=await h.seed();await h.action('prepareBuild',{prepareId:'prepare-1',stepId:artifact.steps[0].id,title:'FORGED_TITLE',file:{path:'private.env'}});
 const prepared=h.messages.find(m=>m.type==='preparePlanBuild');assert.equal(h.result.passed,true);assert.equal(prepared.file.path,'src/Button.tsx');assert.equal(prepared.planContext.stepId,artifact.steps[0].id);assert.equal(prepared.planContext.title,undefined);assert.equal(h.requests.length,0);assert.equal(h.reads.length,2);
 for(const step of artifact.steps.slice(2)){h.messages.length=0;await h.action('prepareBuild',{prepareId:'prepare-2',stepId:step.id});assert.equal(h.result.passed,false);assert.equal(h.messages.some(m=>m.type==='preparePlanBuild'),false);}
});

test('Prepare Build rejects missing, changed, dirty or oversized source anywhere in the original plan basis',async()=>{
 for(const variant of ['changed','missing','dirty','oversized']){const h=harness(),artifact=await h.seed();if(variant==='dirty')h.dirty.add('src/api.ts');else h.setRead((_id,path)=>{const source=h.sources.get(path);if(path!=='src/api.ts')return source;if(variant==='missing')throw Error('PRIVATE_MISSING');return{...source,...(variant==='changed'?{revision:'changed'}:{source:'x'.repeat(65536)})};});
  await h.action('prepareBuild',{prepareId:'prepare-1',stepId:artifact.steps[0].id});assert.equal(h.result.passed,false);assert.equal(h.messages.some(m=>m.type==='preparePlanBuild'),false);assert.equal(h.requests.length,0);
 }
});

test('project, root, view, trust, source epoch, conversation or newer action retires pending artifact reads',async()=>{
 for(const mutation of [h=>{h.host.project={...project,id:'other'};},h=>{h.host.project={...project,root:'/another'};},h=>{h.host.assistantView={webview:{postMessage(){throw Error('obsolete view');}}};},h=>{h.vscode.workspace.isTrusted=false;},h=>{h.host.featureSourceEpoch++;},h=>{h.host.disposed=true;},async h=>{await h.store.newConversation();},h=>{h.host.planActionGeneration++;}]){
  const h=harness(),artifact=await h.seed(),gate=deferred();h.setRead(()=>gate.promise);const action=h.action('prepareBuild',{prepareId:'late',stepId:artifact.steps[0].id});await tick();await mutation(h);gate.resolve(originalFiles[0]);await action;
  assert.equal(h.messages.some(m=>m.type==='preparePlanBuild'),false);assert.equal(h.host.currentArtifactSourceFiles().length,0);assert.equal(h.requests.length,0);
 }
});

test('plan and review reference navigation uses immutable host coordinates and never renderer-supplied locations',async()=>{
 for(const kind of ['plan','review']){const h=harness(),artifact=await h.seed(kind);await h.action('navigate',{...(kind==='plan'?{stepId:artifact.steps[0].id}:{findingId:artifact.findings[0].id}),referenceIndex:0,path:'../FORGED',line:999});
  assert.equal(h.result.passed,true,h.result.error);assert.equal(h.editors.length,1);assert.equal(h.editors[0].doc.uri.fsPath,project.root+'/src/Button.tsx');assert.deepEqual(h.editors[0].options.selection.values,[1,0,1,0]);assert.equal(h.requests.length,0);
 }
});

test('native focus changes during initial source reads or document loading prevent late evidence navigation',async()=>{
 for(const phase of ['source','document']){const h=harness(),artifact=await h.seed(),gate=deferred();if(phase==='source')h.setRead(()=>gate.promise);else h.setOpen(()=>gate.promise);
  const action=h.action('navigate',{stepId:artifact.steps[0].id,referenceIndex:0});await tick();h.host.focusGeneration++;gate.resolve(phase==='source'?originalFiles[0]:h.document(uri(project.root+'/src/Button.tsx')));await action;assert.equal(h.editors.length,0);
 }
});

test('Build resolves only the host-owned selected step, sends one file, and rejects forged additional source',async()=>{
 const h=harness(),artifact=await h.seed();const descriptor=h.descriptor({title:'FORGED_TITLE',summary:'FORGED_SUMMARY',step:{detail:'FORGED_STEP'}});await h.ask('build',{planContext:descriptor});
 assert.equal(h.requests.length,1);const sent=h.requests[0].body;assert.equal(sent.context.length,1);assert.equal(sent.planContext.step.title,artifact.steps[0].title);assert.equal(sent.planContext.title,artifact.title);assert.doesNotMatch(JSON.stringify(sent),/FORGED/);assert.deepEqual(h.turn('new-request').planContext,sent.planContext);
 for(const extra of [{intent:'ask'}, {context:originalFiles.map(({path,revision})=>({path,revision}))}, {planContext:h.descriptor({stepId:artifact.steps[2].id})}]){const next=harness();await next.seed();await assert.rejects(next.ask('build',{planContext:next.descriptor(),...extra}));assert.equal(next.requests.length,0);}
});
const revisionInput=h=>{const{revision,createdAt,...input}=h.turn('plan-request').planRevisions.at(-1);return structuredClone(input);};
test('plan revision edits use compare-and-swap, retain original artifact and never dispatch AI or source writes',async()=>{
 const h=harness(),artifact=await h.seed(),input=revisionInput(h);input.title='User-owned refined plan';input.steps.reverse();input.steps[1].included=false;
 await h.action('revise',{input});assert.equal(h.result.passed,true);assert.equal(h.turn('plan-request').planRevisions.at(-1).revision,1);assert.deepEqual(h.turn('plan-request').plan,artifact);assert.equal(h.requests.length+h.reads.length+h.editors.length,0);
 await h.action('revise',{expectedRevision:0,input:{...input,title:'Stale overwrite'}});assert.equal(h.result.passed,false);assert.equal(h.turn('plan-request').planRevisions.length,2);
 await h.action('revise',{input:{...input,steps:[{...input.steps[0],id:'invented'}]}});assert.equal(h.result.passed,false);assert.equal(h.turn('plan-request').planRevisions.length,2);
 const skipped=artifact.steps[0].id;input.steps.find(step=>step.id===skipped).included=false;await h.action('revise',{input});await h.action('prepareBuild',{prepareId:'skipped',stepId:skipped});assert.equal(h.result.passed,false);assert.equal(h.messages.some(m=>m.type==='preparePlanBuild'),false);
});

test('archived or unsaved plan history cannot be edited or prepared, while archived source checks remain local',async()=>{
 const h=harness(),artifact=await h.seed(),conversationId=h.store.snapshot().activeId;
 await h.store.archive(conversationId);await h.store.select(conversationId);
 for(const action of ['revise','prepareBuild']){await h.action(action,{input:revisionInput(h),prepareId:'archived',stepId:artifact.steps[0].id});assert.equal(h.result.passed,false);}
 await h.action('checkSources');assert.equal(h.result.passed,true);assert.equal(h.requests.length,0);
 const failed=harness(),plan=await failed.seed();failed.setWrite(()=>{throw Error('PRIVATE_WRITE_ERROR');});const input=revisionInput(failed);input.title='Unpersisted edit';await failed.action('revise',{input});assert.equal(failed.result.passed,false);assert.notEqual(failed.store.snapshot().storage.status,'saved');
 await failed.action('prepareBuild',{prepareId:'unsaved',stepId:plan.steps[0].id});assert.equal(failed.result.passed,false);assert.equal(failed.reads.length,0);assert.doesNotMatch(JSON.stringify(failed.messages),/PRIVATE_WRITE_ERROR/);
});

test('a plan edit or archive during pending source preparation cannot publish a stale Build preparation',async()=>{
 for(const change of ['revise','archive']){const h=harness(),artifact=await h.seed(),gate=deferred();h.setRead(()=>gate.promise);const action=h.action('prepareBuild',{prepareId:'stale',stepId:artifact.steps[0].id});await tick();
  if(change==='revise'){const input=revisionInput(h);input.title='A newer user revision';await h.store.revisePlan({conversationId:h.store.snapshot().activeId,requestId:'plan-request',expectedRevision:0,input});}
  else await h.store.archive(h.store.snapshot().activeId);
  gate.resolve(originalFiles[0]);await action;assert.equal(h.messages.some(m=>m.type==='preparePlanBuild'),false);assert.equal(h.requests.length,0);
 }
});

test('new local plan edits during Build preflight retire the old selected step before provider dispatch',async()=>{
 for(const pauseAt of [1,2]){const h=harness();await h.seed();const gate=deferred();let reads=0;h.setRead((_id,path)=>++reads===pauseAt?gate.promise:h.sources.get(path));const pending=h.ask('build',{planContext:h.descriptor()});await tick();
  const input=revisionInput(h);input.steps[0].detail='New user instructions';await h.store.revisePlan({conversationId:h.store.snapshot().activeId,requestId:'plan-request',expectedRevision:0,input});gate.resolve(originalFiles[0]);await pending;
  assert.equal(h.requests.length,0);assert.equal(h.proposals.length,0);
 }
});

test('Build revalidates every original basis source after durable start and bridge preparation',async()=>{
 for(const phase of ['write','bridge']){const h=harness();await h.seed();const gate=deferred();if(phase==='write')h.setWrite((_key,value)=>value.conversations.some(chat=>chat.turns.some(turn=>turn.requestId==='new-request'))?gate.promise:undefined);else h.setBridge(()=>gate.promise);
  const pending=h.ask('build',{planContext:h.descriptor()});await tick();h.sources.set('src/api.ts',{...originalFiles[1],revision:'saved-while-preparing'});if(phase==='write'){h.setWrite(undefined);gate.resolve();}else gate.resolve({url:'http://127.0.0.1:1',token:'fixture',close:async()=>{}});await pending;
  assert.equal(h.requests.length,0);assert.equal(h.proposals.length,0);
 }
});

test('evidence navigation refuses changed/dirty native buffers and invented reference identity after saved reads',async()=>{
 for(const variant of ['native-dirty','native-changed','supporting-dirty','reference']){const h=harness(),artifact=await h.seed();if(variant==='native-dirty')h.setOpen(value=>({...h.document(value),isDirty:true,getText(){throw Error('DRAFT_MUST_NOT_BE_READ');}}));if(variant==='native-changed')h.setOpen(value=>({...h.document(value),getText:()=> 'Unrelated newly edited content'}));if(variant==='supporting-dirty')h.setOpen(value=>{h.dirty.add('src/api.ts');return h.document(value);});
  await h.action('navigate',{stepId:variant==='reference'?'invented':artifact.steps[0].id,referenceIndex:0});assert.equal(h.result.passed,false);assert.equal(h.editors.length,0);assert.equal(h.requests.length,0);assert.doesNotMatch(JSON.stringify(h.messages),/DRAFT_MUST_NOT_BE_READ/);
 }
});

test('a plan completed while stopping remains readable but cannot be revised or prepared for Build',async()=>{
 const h=harness(),artifact=await h.seed('plan',true);assert.equal(h.turn('plan-request').completedWhileStopping,true);
 for(const action of ['revise','prepareBuild']){await h.action(action,{input:{...revisionInput(h),title:'Unwanted revision'},stepId:artifact.steps[0].id,prepareId:'stopped'});assert.equal(h.result.passed,false);}
 assert.equal(h.messages.some(message=>message.type==='preparePlanBuild'),false);assert.equal(h.requests.length,0);
 await h.action('checkSources');assert.equal(h.result.passed,true);
});

test('a plan-backed Build cannot publish a proposal after unselected original-basis source changes during generation',async()=>{
 const h=harness();await h.seed();const pending=deferred();h.setFetch(()=>pending.promise);const asking=h.ask('build',{planContext:h.descriptor()});await tick();assert.equal(h.requests.length,1);
 h.sources.set('src/api.ts',{...originalFiles[1],revision:'changed-during-generation'});h.host.featureSourceEpoch++;
 const proposal={id:'fixture-proposal',projectId:project.id,path:originalFiles[0].path,before:originalFiles[0].source,after:originalFiles[0].source.replace('>Save<','>Save changes<'),baseRevision:originalFiles[0].revision,status:'proposed',origin:'ai',context:[{path:originalFiles[0].path,revision:originalFiles[0].revision}],verification:[]};
 pending.resolve(response([{type:'proposal',proposal},{type:'done'}]));await asking;assert.equal(h.proposals.length,0);assert.notEqual(h.turn('new-request').state,'complete');
});

test('an explicitly prepared closed source file can be sent from the host checked-source cache',async()=>{
 const h=harness(),artifact=await h.seed();h.host.openFiles=[];h.host.activeFile=null;await h.action('prepareBuild',{prepareId:'closed-source',stepId:artifact.steps[0].id});assert.equal(h.result.passed,true);
 await h.ask('build',{planContext:h.descriptor()});assert.equal(h.requests.length,1);assert.deepEqual(h.requests[0].body.context,[{path:originalFiles[0].path,revision:originalFiles[0].revision}]);assert.equal(h.host.openFiles.length,0);
});

test('a previously read plan basis file becoming dirty during a later read blocks preparation and direct Build',async()=>{
 for(const action of ['prepareBuild','send']){const h=harness(),artifact=await h.seed();h.setRead((_id,path)=>{if(path==='src/api.ts')h.dirty.add('src/Button.tsx');return h.sources.get(path);});
  if(action==='prepareBuild'){await h.action('prepareBuild',{prepareId:'dirty-race',stepId:artifact.steps[0].id});assert.equal(h.result.passed,false);assert.equal(h.messages.some(message=>message.type==='preparePlanBuild'),false);}
  else await h.ask('build',{planContext:h.descriptor()});assert.equal(h.requests.length,0);
 }
});

test('saved source changes during a later basis read are fenced even when Build was not prepared first',async()=>{
 const h=harness();await h.seed();h.setRead((_id,path)=>{if(path==='src/api.ts'){h.sources.set('src/Button.tsx',{...originalFiles[0],revision:'changed'});h.host.featureSourceEpoch++;}return h.sources.get(path);});
 await h.ask('build',{planContext:h.descriptor()});assert.equal(h.requests.length,0);assert.equal(h.proposals.length,0);
});
const buildProposal=()=>({id:'fixture-build-proposal',projectId:project.id,title:'Clearer label',summary:'Only the button label changes.',path:originalFiles[0].path,before:originalFiles[0].source,after:originalFiles[0].source.replace('>Save<','>Save changes<'),baseRevision:originalFiles[0].revision,status:'proposed',origin:'ai',context:[{path:originalFiles[0].path,revision:originalFiles[0].revision}],verification:['Inspect the label.']});
test('a successful plan-backed Build receives the exact full original plan basis from the host, independent of provider fields',async()=>{
 const h=harness();await h.seed();h.setFetch(()=>response([{type:'proposal',proposal:{...buildProposal(),planBasis:[{path:'private/forged.ts',revision:'invented'}]}},{type:'done'}]));
 await h.ask('build',{planContext:h.descriptor()});assert.equal(h.proposals.length,1);const expected=originalFiles.map(({path,revision})=>({path,revision}));assert.deepEqual(h.proposals[0].planBasis,expected);assert.equal(h.proposals[0].requestId,'new-request');assert.equal(h.turn('new-request').state,'complete');assert.deepEqual(h.turn('new-request').proposal.planBasis,expected);assert.equal(h.requests[0].body.context.length,1);assert.equal(h.requests[0].body.context[0].path,'src/Button.tsx');
});
test('late unshared plan-basis saved and draft changes block proposal publication even before a source watcher fires',async()=>{
 for(const kind of ['saved','draft']){const h=harness();await h.seed();const gate=deferred();h.setFetch(()=>gate.promise);const pending=h.ask('build',{planContext:h.descriptor()});await tick();assert.equal(h.requests.length,1);
  if(kind==='saved')h.sources.set('src/api.ts',{...originalFiles[1],revision:'changed-without-watcher'});else h.dirty.add('src/api.ts');
  gate.resolve(response([{type:'proposal',proposal:buildProposal()},{type:'done'}]));await pending;assert.equal(h.proposals.length,0);assert.equal(h.turn('new-request').state,'failed');assert.equal(h.turn('new-request').proposal,undefined);
 }
});

test('normal streamed Build text followed immediately by proposal and done survives durable-history saving state',async()=>{
 const h=harness();await h.seed();h.setFetch(()=>response([{type:'start',intent:'build'},{type:'delta',text:'Complete structured proposal text'},{type:'proposal',proposal:buildProposal()},{type:'done'}]));
 await h.ask('build',{planContext:h.descriptor()});assert.equal(h.proposals.length,1);assert.equal(h.turn('new-request').state,'complete');assert.equal(h.turn('new-request').answer,'Complete structured proposal text');assert.deepEqual(h.turn('new-request').proposal.planBasis,originalFiles.map(({path,revision})=>({path,revision})));assert.equal(h.store.snapshot().storage.status,'saved');assert.equal(h.messages.filter(message=>message.event?.type==='error').length,0);
});
