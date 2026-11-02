import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import * as verification from '../src/visual-verification-store.mjs';
import {createFeatureStore} from '../src/feature-store.mjs';
import {createRuntimeWorkspaceStore} from '../src/runtime-workspace-store.mjs';
import * as safety from '../src/safety.mjs';
import {analyzeChangeImpact} from '../../../server/project/change-impact.mjs';
import {createTokenProposal,listDesignTokens} from '../../../server/project/proposals.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(join(root,'package.json')),ts=require('typescript');
const compiled=ts.transpileModule(`${readFileSync(join(root,'desktop/extension/src/extension.ts'),'utf8')}\nexport {FoundationHost};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const hash=source=>createHash('sha256').update(source).digest('hex');
const file=source=>({path:'src/theme.css',source,revision:hash(source).slice(0,16),analysis:{imports:[],consumers:[],symbols:[],requests:[]}});
const empty=(projectId,key)=>({schemaVersion:1,projectId,revision:0,[key]:[],storage:{status:'saved'}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(previous){
 const project={id:'visual-project',root:'/fixtures/visual',files:[{path:'src/theme.css'}]},before=file(':root { --radius: 8px; }\nbutton { border-radius: var(--radius); }\n');
 const disk=new Map(previous || []),writes=[],events=[],modes=[],calls=[],dirty=new Set();
 let persistHook,readHook,selectHook,loadHook,host,proposal,current,viewBuilds=0;
 const write=async(key,value)=>{writes.push({key,value:structuredClone(value)});if(persistHook)await persistHook(key,value);disk.set(key,structuredClone(value));};
 const features=createFeatureStore({projectId:project.id,read:()=>undefined,write:async()=>{if(selectHook)await selectHook();}});
 await features.create({title:'Save profile',paths:['src/theme.css']},0);
 const feature=features.snapshot().features[0];
 const workspace=createRuntimeWorkspaceStore({projectId:project.id,read:()=>undefined,write:async()=>{if(selectHook)await selectHook();}});
 await workspace.createScreen({featureId:feature.id,title:'Profile',targetId:'vite:dev',route:'/profile'},0);
 const screen=workspace.snapshot().screens[0];
 await workspace.createScenario({screenId:screen.id,title:'Save profile',steps:['Choose Save'],expectedOutcome:'Profile saved'},workspace.snapshot().revision);
 const scenario=workspace.snapshot().scenarios[0];
 const token=listDesignTokens([before])[0];
 proposal=createTokenProposal({file:before,name:token.name,occurrence:token.occurrence,value:'12px',projectId:project.id});
 proposal.designImpact={version:1,result:await analyzeChangeImpact({projectId:project.id,target:{kind:'token',path:before.path,revision:before.revision,name:token.name,occurrence:token.occurrence},files:[before]}),relatedScenarios:[{featureId:feature.id,featureTitle:feature.title,screenId:screen.id,screenTitle:screen.title,scenarioId:scenario.id,scenarioTitle:scenario.title,paths:[before.path],suiteNames:[]}]};
 current=file(proposal.after);proposal.status='applied';proposal.appliedRevision=current.revision;
 const run=async(source)=>{
  await workspace.beginRun({feature:{id:feature.id,title:feature.title,revision:features.snapshot().revision,paths:feature.paths},screen,scenario,definitionRevision:workspace.snapshot().revision,
   runtime:{targetId:'vite:dev',session:'a'.repeat(32),viewId:'b'.repeat(32),documentId:'c'.repeat(32),route:'/profile',pageVersion:1},sources:[{path:source.path,revision:hash(source.source)}],dirtyPaths:[]},workspace.snapshot().revision);
  const id=workspace.snapshot().runs.at(-1).id;
  await workspace.finishRun(id,{status:'completed',assessment:'matched',note:'Manually observed',observations:[],truncated:false});return id;
 };
 const beforeId=await run(before),afterId=await run(current),captures=empty(project.id,'captures'),replays=empty(project.id,'replays');
 const vscode={workspace:{isTrusted:true},commands:{executeCommand(){calls.push('command');throw new Error('No command expected');}}};
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,URL,AbortController,TextDecoder,structuredClone,setTimeout,clearTimeout,
  require:name=>name==='vscode'?vscode:name.includes('visual-verification-store')?{...verification,visualVerificationView:input=>{viewBuilds++;return verification.visualVerificationView(input);}}:name.includes('safety')?safety:name.startsWith('node:')?require(name):{},
  fetch(){calls.push('fetch');throw new Error('No network expected');}});
 host=Object.create(module.exports.FoundationHost.prototype);
 Object.assign(host,{project:structuredClone(project),disposed:false,featureSourceEpoch:0,proposalMutationCount:0,visualVerificationStores:new Map(),
  featureFiles:[],openFiles:[],features:()=>features,featureSnapshot:()=>features.snapshot(),runtimeWorkspaceStore:()=>workspace,
  runtimeReplayStore:()=>({snapshot:()=>structuredClone(replays)}),runtimeCapturesSnapshot:()=>({...structuredClone(captures),available:true}),runtimeCaptureStorage:()=>({store:{snapshot:()=>structuredClone(captures),reconcile:()=>structuredClone(captures)}}),
  proposals:()=>({current:()=>structuredClone(proposal)}),dirtyPaths:()=>[...dirty],changeSetSnapshot:()=>null,executionSnapshot:()=>null,
  context:{workspaceState:{get:key=>disk.get(key),update:write}},queueConversationState(){},sendState(){},
  panel:{webview:{postMessage:async value=>{events.push(structuredClone(value));}}},show:mode=>modes.push(mode),updateTree(){},
  loadFeatureFiles:async()=>{if(loadHook)await loadHook();},clearFeatureView(){host.featureFiles=[];},
  service:{getFile:async()=>{if(readHook)await readHook();return structuredClone(current);},save(){calls.push('save');throw new Error('No source write expected');}},
  runtimeAction(){calls.push('runtime');throw new Error('No runtime expected');},runtimeWorkspaceAction(){calls.push('observe');throw new Error('No observation expected');},
  assistant:{ask(){calls.push('provider');throw new Error('No provider expected');}}});
 const h={host,project,vscode,features,workspace,screen,scenario,feature,captures,replays,before,beforeId,afterId,events,modes,calls,dirty,disk,writes,
  get viewBuilds(){return viewBuilds;},get proposal(){return proposal;},set proposal(value){proposal=value;},get current(){return current;},set current(value){current=value;},
  state:()=>host.visualVerificationSnapshot(),
  action:(action,extra={})=>host.visualVerificationAction({projectId:host.project.id,expectedRevision:h.state().revision,proposalBasis:h.state().proposal?.proposalBasis,action,...extra}),
  link:extra=>h.action('link',{scenarioId:scenario.id,beforeId,afterId,...extra}),
  view:extra=>h.action('viewScenario',{featureId:feature.id,screenId:screen.id,scenarioId:scenario.id,...extra}),
  setRead:hook=>readHook=hook,setPersist:hook=>persistHook=hook,setSelect:hook=>selectHook=hook,setLoad:hook=>loadHook=hook,
 };
 writes.length=0;return h;
}

test('link freezes an explicit saved pair with separate evidence and no runtime, source or provider action',async()=>{
 const h=await fixture();await h.link();const state=h.state();assert.equal(state.records.length,1);assert.equal(state.records[0].beforeId,h.beforeId);assert.equal(state.records[0].afterId,h.afterId);
 assert.equal(state.records[0].compilation,'not-recorded');assert.equal(state.records[0].visual,'not-assessed');assert.equal(state.records[0].sourceRelationship,'unverified');assert.equal(state.records[0].canCompare,true);
 assert.deepEqual(h.calls,[]);assert.equal(h.writes.length,1);assert.deepEqual(h.events,[]);assert.deepEqual(h.modes,[]);
});

test('renderer supplied records cannot authorize a forged, swapped or stale pair',async()=>{
 for(const extra of [{beforeId:'forged'},{beforeId:'forged',proposal:{status:'applied'},workspace:{runs:[]}},{beforeId:undefined},{scenarioId:'foreign'},{proposalBasis:'forged'},{expectedRevision:99}]){
  const h=await fixture();await assert.rejects(h.link(extra));assert.equal(h.writes.length,0);
 }
 const h=await fixture();await assert.rejects(h.link({beforeId:h.afterId,afterId:h.beforeId}));assert.equal(h.writes.length,0);
});

test('new links require applied source and reject dirty target, saved-byte mismatch and source actions already in flight',async()=>{
 for(const mutate of [h=>h.proposal.status='ready',h=>h.proposal.status='undone',h=>h.dirty.add(h.current.path),h=>h.current=file('changed'),h=>h.host.proposalMutationCount=1,h=>h.host.runtimeWorkspaceBusy='beginRun',h=>h.host.asking={},h=>h.host.scenarioCapture={},h=>h.host.runtimeReplayTask={}]){
  const h=await fixture();mutate(h);await assert.rejects(h.link());assert.equal(h.writes.length,0);assert.deepEqual(h.calls,[]);
 }
});

test('project, proposal and committed evidence ownership are rechecked after source reads',async()=>{
 for(const mutate of [h=>h.host.project.id='other',h=>h.host.project.root='/other',h=>h.vscode.workspace.isTrusted=false,h=>h.host.disposed=true,h=>h.host.featureSourceEpoch++,h=>h.proposal.id='replacement',h=>h.proposal.status='undone',h=>h.host.proposalMutationCount=1,h=>h.host.proposalMutationGeneration=1,h=>h.dirty.add(h.current.path),h=>h.replays.revision++,h=>h.captures.revision++,h=>h.captures.storage.status='saving',async h=>h.features.select(null,h.features.snapshot().revision),async h=>h.workspace.select(null,null,h.workspace.snapshot().revision)]){
  const h=await fixture();h.setRead(()=>mutate(h));await assert.rejects(h.link());assert.equal(h.writes.length,0);assert.equal(h.host.visualVerificationBusy,undefined);
 }
});

test('journal write cancellation restores its previous durable checkpoint',async()=>{
 for(const mutate of [h=>h.host.project.root='/other',h=>h.vscode.workspace.isTrusted=false,h=>h.proposal.status='undone',h=>h.host.proposalMutationCount=1,h=>h.host.proposalMutationGeneration=1,h=>h.dirty.add(h.current.path),h=>h.replays.revision++]){
  const h=await fixture();let once=true;h.setPersist(()=>{if(once){once=false;mutate(h);}});await assert.rejects(h.link());
  const journal=h.host.visualVerificationStore(h.project).snapshot();assert.equal(journal.entries.length,0);assert.equal(journal.revision,0);
  const saved=h.disk.get(`foundation.visual-verification.${h.project.id}`);assert.equal(saved?.entries?.length ?? 0,0);
 }
});

test('history survives undo, proposal replacement and source changes without authorizing a new link',async()=>{
 const h=await fixture();await h.link();const record=h.state().records[0],saved=structuredClone(h.disk);
 h.proposal.status='undone';assert.equal(h.state().records[0].canCompare,true);await assert.rejects(h.link());
 h.proposal=null;assert.equal(h.state().records[0].id,record.id);assert.equal(h.state().records[0].canCompare,true);assert.deepEqual(h.disk,saved);
 h.host.visualVerificationStores=new Map();assert.equal(h.state().records[0].id,record.id);assert.equal(h.writes.length,1);
});

test('compare uses stored exact pair and metadata-only navigation; scenario selection never opens or observes runtime',async()=>{
 const h=await fixture();await h.link();const record=h.state().records[0];
 await h.features.create({title:'Other',paths:['src/theme.css']},h.features.snapshot().revision);
 await h.action('compare',{id:record.id,beforeId:'forged',afterId:'forged'});assert.equal(h.features.snapshot().activeId,h.feature.id);
 assert.deepEqual(h.events.at(-1),{type:'visualVerificationComparison',projectId:h.project.id,featureId:h.feature.id,id:record.id,beforeId:h.beforeId,afterId:h.afterId});assert.equal(h.modes.at(-1),'Understand');
 await h.workspace.select(null,null,h.workspace.snapshot().revision);await h.view();
 assert.equal(h.workspace.snapshot().activeScenarioId,h.scenario.id);assert.equal(h.modes.at(-1),'Refine');assert.deepEqual(h.events.at(-1),{type:'visualVerificationScenario',projectId:h.project.id,featureId:h.feature.id,screenId:h.screen.id,scenarioId:h.scenario.id});assert.deepEqual(h.calls,[]);assert.equal(h.writes.length,1);
});

test('lost ownership after metadata selection or source loading suppresses navigation acknowledgement',async()=>{
 for(const phase of ['select','load'])for(const mutate of [h=>h.host.project.root='/other',h=>h.vscode.workspace.isTrusted=false,h=>h.proposal.status='undone']){
  const h=await fixture();await h.features.create({title:'Other',paths:['src/theme.css']},h.features.snapshot().revision);
  if(phase==='select')h.setSelect(()=>mutate(h));else h.setLoad(()=>mutate(h));await assert.rejects(h.view());assert.deepEqual(h.events,[]);assert.deepEqual(h.modes,[]);assert.deepEqual(h.calls,[]);
 }
});

test('missing, altered or uncommitted attached records cannot navigate a comparison',async()=>{
 const h=await fixture();await h.link();const id=h.state().records[0].id;
 const original=h.host.runtimeWorkspaceStore;const baseline=h.workspace.snapshot();
 for(const mutate of [v=>v.runs.pop(),v=>v.runs[0].note='altered',v=>v.storage.status='saving']){
  const value=structuredClone(baseline);mutate(value);h.host.runtimeWorkspaceStore=()=>({presentation:()=>({snapshot:value})});await assert.rejects(h.action('compare',{id}));assert.deepEqual(h.events,[]);
 }
 h.host.runtimeWorkspaceStore=original;
});

test('read-only state uses bounded current saved buffers and never reads or executes source',async()=>{
 const h=await fixture();await h.link();let reads=0;h.setRead(()=>reads++);
 h.host.visualVerificationSources={projectId:h.project.id,root:h.project.root,epoch:0,files:new Map([[h.current.path,h.current]])};assert.equal(h.state().records[0].currentRelevance,'applied-current');
 h.host.visualVerificationSources.files.set(h.current.path,file('different'));assert.equal(h.state().records[0].currentRelevance,'source-changed');h.host.featureSourceEpoch++;
 assert.equal(h.state().records[0].currentRelevance,'unknown');for(let n=0;n<30;n++)h.state();assert.equal(reads,0);assert.deepEqual(h.calls,[]);
});

test('only workspace messages dispatch and retry never executes runtime or code',async()=>{
 const h=await fixture();await h.host.message({type:'visualVerification',projectId:h.project.id,action:'link'},'assistant');assert.equal(h.writes.length,0);
 await h.action('retry');assert.deepEqual(h.calls,[]);assert.equal(h.writes.length,0);
});


test('actual Apply waiting for its source guard blocks new links and always releases the busy counter',async()=>{
 const h=await fixture();let release;h.host.loadChangeSets=()=>new Promise((_resolve,reject)=>release=()=>reject(new Error('source guard blocked')));
 const pending=h.host.changeProposal('apply',h.proposal.id);await tick();assert.equal(h.host.proposalMutationCount,1);assert.equal(h.host.proposalMutationGeneration,1);
 await assert.rejects(h.link(),/Finish the current/);release();await assert.rejects(pending,/source guard blocked/);assert.equal(h.host.proposalMutationCount,0);assert.equal(h.writes.length,0);
});

test('host strips capture presentation fields by passing the raw committed manifest to evidence validation',async()=>{
 const h=await fixture();const input=h.host.visualVerificationInputs(h.project);assert.equal('available' in input.captures,false);await h.link();assert.equal(h.state().records[0].canCompare,true);
});


test('repeated publications reuse one projection, while evidence, sources, proposal and busy state remain current',async()=>{
 const h=await fixture();await h.link();h.state();const builds=h.viewBuilds;
 for(let n=0;n<40;n++)h.state();assert.equal(h.viewBuilds,builds);
 h.host.proposalMutationCount=1;assert.equal(h.state().proposal.canLink,false);assert.equal(h.viewBuilds,builds);h.host.proposalMutationCount=0;assert.equal(h.state().proposal.canLink,true);
 h.captures.storage.status='unavailable';h.state();assert.equal(h.viewBuilds,builds+1);
 h.replays.revision++;h.state();assert.equal(h.viewBuilds,builds+2);
 h.dirty.add(h.current.path);assert.equal(h.state().records[0].currentRelevance,'source-changed');assert.equal(h.viewBuilds,builds+3);
 h.proposal.status='undone';h.state();assert.equal(h.viewBuilds,builds+4);
 const exposed=h.state();exposed.records[0].beforeId='forged';assert.equal(h.state().records[0].beforeId,h.beforeId);
});

test('same-revision capture reconciliation failure invalidates the display cache instead of reusing an available pair',async()=>{
 const h=await fixture();await h.link();h.state();const count=h.viewBuilds;
 // Owning capture storage marks an unsafe same-revision external replacement unavailable.
 h.captures.storage={status:'unavailable',message:'Saved capture metadata changed outside this session.'};
 h.state();assert.equal(h.viewBuilds,count+1);
});


test('retry after a failed link restores only its committed checkpoint and requires explicit relinking',async()=>{
 const h=await fixture();h.setPersist(()=>{throw new Error('storage write failed');});await assert.rejects(h.link(),/could not be saved/);assert.equal(h.state().storage.status,'error');
 h.setPersist(undefined);h.proposal.status='undone';await h.action('retry');assert.equal(h.state().storage.status,'saved');assert.equal(h.state().records.length,0);assert.deepEqual(h.calls,[]);
 h.proposal.status='applied';await h.link();assert.equal(h.state().records.length,1);
});

test('a full 40-run history is validated once per committed version rather than during repeated publications',async t=>{
 const h=await fixture();await h.link();const initial=h.workspace.snapshot(),{storage,...manifest}=initial;
 for(let n=0;n<38;n++){const run=structuredClone(manifest.runs[1]);run.id=randomUUID();run.observations=Array.from({length:100},(_,i)=>({id:`${run.runtime.session}:${run.runtime.viewId}:${i}`,session:run.runtime.session,documentId:run.runtime.documentId,kind:'request',method:'GET',url:`http://127.0.0.1:5173/${'x'.repeat(970)}`,status:200,durationMs:12,outcome:'success',observedAt:run.startedAt,timing:'response-headers',correlation:'unattributed'}));manifest.runs.push(run);}
 manifest.revision++;const bytes=Buffer.byteLength(JSON.stringify(manifest));assert.ok(bytes>4*1024*1024);
 const heavy=createRuntimeWorkspaceStore({projectId:h.project.id,read:()=>manifest,write:()=>{throw new Error('Display must never write runtime');}});assert.equal(heavy.snapshot().storage.status,'saved');h.host.runtimeWorkspaceStore=()=>heavy;
 const start=performance.now();assert.equal(h.state().records[0].canCompare,true);const cold=performance.now()-start,count=h.viewBuilds;
 const repeat=performance.now();for(let n=0;n<50;n++)h.state();const warm=(performance.now()-repeat)/50;assert.equal(h.viewBuilds,count);assert.deepEqual(h.calls,[]);
 t.diagnostic(`${(bytes/1024/1024).toFixed(2)} MiB / 40 observations: first projection ${cold.toFixed(2)} ms; mean repeated publication ${warm.toFixed(3)} ms; one model rebuild.`);await heavy.dispose();
});
