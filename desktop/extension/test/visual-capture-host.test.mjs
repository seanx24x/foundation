import {mockDisplaySources} from './helpers/display-source-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=process.env.FOUNDATION_VISUAL_CAPTURE_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const projectRequire=createRequire(join(root,'package.json')),ts=projectRequire('typescript');
const featureStore=await import(join(root,'desktop/extension/src/feature-store.mjs'));
const workspaceStore=await import(join(root,'desktop/extension/src/runtime-workspace-store.mjs'));
const captureStore=await import(join(root,'desktop/extension/src/runtime-capture-store.mjs'));
const safety=await import(join(root,'desktop/extension/src/safety.mjs'));
const compiled=ts.transpileModule(`${readFileSync(join(root,'desktop/extension/src/extension.ts'),'utf8')}\nexport {FoundationHost};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const hash=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>structuredClone(value);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const project={id:'capture-project',root:'/fixtures/capture',files:[{path:'src/Button.tsx'}]};
const file=(source='export const Save = true;\n')=>({path:'src/Button.tsx',source,revision:hash(source).slice(0,16),analysis:{imports:[],consumers:[],symbols:[],requests:[]}});
// Synthetic native protocol fixture. This is never presented as an actual runtime capture.
function png(){const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;}return(value^0xffffffff)>>>0;};const chunk=(type,body=Buffer.alloc(0))=>{const data=Buffer.concat([Buffer.from(type),body]),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(body.length);tail.writeUInt32BE(crc(data));return Buffer.concat([head,data,tail]);};const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(18))),chunk('IEND')]);}
const image=png();
function harness(t){
 const persisted=new Map(),sources=new Map([['src/Button.tsx',file()]]),captureManifests=new Map(),assets=new Map(),assetReads=[],assetWrites=[],nativeCalls=[],sourceReads=[],states=[],messages=[];
 let nativeHook,sourceHook,freshHook,assetReadHook,captureWriteHook,dirty=[];
 const runtimeState={status:'connected',root:project.root,target:{id:'vite:dev',root:project.root},targets:[],owned:true,session:'1'.repeat(32),viewId:'2'.repeat(32),documentId:'3'.repeat(32),pageConnected:true,pagePath:'/profile',pageVersion:1,url:'http://127.0.0.1:4173/profile',targetUrl:'http://127.0.0.1:4173',selection:null,selectionVersion:0,observations:[],files:[],capabilities:{sourceMapping:'instrumented',requests:true,screenshots:false,routeTracking:true}};
 const runtime={snapshot:()=>plain(runtimeState),readCurrent:async()=>{if(freshHook)await freshHook();return plain(runtimeState);},discover:async()=>[{id:'vite:dev',root:project.root,available:true,instrumented:true}],dispose:async()=>{}};
 const nativeResult=identity=>({identity:plain(identity),pngBase64:image.toString('base64'),capturedAt:new Date().toISOString(),conditions:{viewportWidth:2,viewportHeight:2,devicePixelRatio:1,scrollX:0,scrollY:0,canvasScale:1,observedColorScheme:'dark',reducedMotion:false,pixelWidth:2,pixelHeight:2}});
 const uri=fsPath=>({fsPath,scheme:'file',toString:()=>`file://${fsPath}`});
 const vscode={workspace:{isTrusted:true,textDocuments:[]},Uri:{file:uri,joinPath:(base,...parts)=>uri(join(base.fsPath,...parts))},commands:{executeCommand:async(name,identity)=>{assert.equal(name,'_foundation.captureActiveCanvas');nativeCalls.push(plain(identity));return nativeHook?nativeHook(identity):nativeResult(identity);}}};
 const fileStorage={createCaptureFileStorage:({projectId:id})=>({assetRoot:`/fixtures/capture-storage/${id}/assets`,assetPath:assetId=>`/fixtures/capture-storage/${id}/assets/${assetId}.png`,read:()=>plain(captureManifests.get(id)),write:async value=>{if(captureWriteHook)await captureWriteHook(value);captureManifests.set(id,plain(value));},writeAsset:async(assetId,bytes)=>{assetWrites.push({projectId:id,assetId});assets.set(`${id}/${assetId}`,Buffer.from(bytes));},readAsset:async assetId=>{assetReads.push({projectId:id,assetId});if(assetReadHook)await assetReadHook(assetId);const bytes=assets.get(`${id}/${assetId}`);if(!bytes)throw new Error('Private missing image');return Buffer.from(bytes);}})};
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,URL,AbortController,TextDecoder,setTimeout,clearTimeout,fetch(){throw new Error('Visual captures must never contact an AI provider');},require:name=>name==='vscode'?vscode:name.includes('runtime-capture-store')?captureStore:name.includes('runtime-capture-files')?fileStorage:name.includes('runtime-workspace-store')?workspaceStore:name.includes('feature-store')?featureStore:name.includes('safety')?safety:name.startsWith('node:')?projectRequire(name):{}});
 const host=Object.create(module.exports.FoundationHost.prototype);
 const panel={visible:true,webview:{options:{},postMessage:message=>messages.push(plain(message)),asWebviewUri:value=>({toString:()=>`webview:${value.fsPath}`})}};
 Object.assign(host,{context:{extensionUri:uri('/fixtures/extension'),globalStorageUri:uri('/fixtures/capture-storage'),workspaceState:{get:key=>persisted.get(key),update:async(key,value)=>persisted.set(key,plain(value))}},project:plain(project),panel,mode:'Refine',nativeCaptureAvailable:true,openFiles:[],featureFiles:[],featureUnavailable:[],featureStores:new Map(),runtimeWorkspaceStores:new Map(),runtimeCaptureStores:new Map(),service:{getFiles:mockDisplaySources,getFile:async(id,path)=>{sourceReads.push({id,path});if(sourceHook)return sourceHook(id,path);return plain(sources.get(path));}},runtime,runtimeRoot:project.root,runtimeGeneration:1,runtimeFrameOrigin:'http://127.0.0.1:4173',runtimeSelectionKey:'',featureLoadGeneration:0,featureSourceEpoch:0,featureCacheKey:'',featureLoadKey:'',disposed:false,generation:0,focusGeneration:0,askGeneration:0,dirtyPaths:()=>[...dirty],queueConversationState(){},updateTree(){},show(){},sendState(){states.push({projectId:this.project?.id});}});
 const h={host,vscode,panel,runtime,runtimeState,sources,captureManifests,assets,assetReads,assetWrites,nativeCalls,sourceReads,states,messages,nativeResult,setNative:hook=>nativeHook=hook,setSource:hook=>sourceHook=hook,setFresh:hook=>freshHook=hook,setAssetRead:hook=>assetReadHook=hook,setCaptureWrite:hook=>captureWriteHook=hook,setDirty:value=>dirty=value,raw:()=>host.runtimeWorkspaceStore().snapshot(),captureSnapshot:()=>host.runtimeCaptureStorage().store.snapshot(),action:(action,fields={})=>host.runtimeWorkspaceAction({action,projectId:host.project?.id,expectedRevision:host.runtimeWorkspaceStore().snapshot().revision,...fields})};
 t.after(async()=>{nativeHook=sourceHook=freshHook=assetReadHook=captureWriteHook=undefined;await host.endScenarioRun('cancelled').catch(()=>{});host.disposed=true;await Promise.all([...host.featureStores.values(),...host.runtimeWorkspaceStores.values()].map(store=>store.dispose()));});return h;
}
async function setup(t){const h=harness(t);await h.host.featureAction({action:'create',projectId:project.id,expectedRevision:0,input:{title:'Save profile',brief:'Observe saving.',paths:['src/Button.tsx'],entryPath:'src/Button.tsx'}});await h.action('createScreen',{input:{title:'Profile',targetId:'vite:dev',route:'/profile'}});const screen=h.raw().screens[0];await h.action('createScenario',{input:{screenId:screen.id,title:'Save',steps:['Press Save.'],expectedOutcome:'The saved message appears.'}});h.scenario=h.raw().scenarios[0];await h.action('beginRun',{scenarioId:h.scenario.id});h.run=plain(h.host.scenarioCapture.run);return h;}
const finish=(h,extra={})=>h.action('captureAndFinishRun',{id:h.run.id,assessment:'not-assessed',note:'Manual observation',...extra});
const noNewImage=h=>{assert.equal(h.captureSnapshot().captures.length,0);assert.equal(h.assetWrites.length,0);};

test('explicit capture stores exact run/source association and only the supplied manual assessment',async t=>{
 const h=await setup(t);await finish(h,{assessment:'matched'});const saved=h.captureSnapshot().captures[0],run=h.raw().runs[0];
 assert.equal(saved.runId,h.run.id);assert.equal(saved.featureId,h.run.feature.id);assert.equal(saved.screenId,h.run.screen.id);assert.equal(saved.scenarioId,h.run.scenario.id);assert.deepEqual(saved.binding.runtime,h.run.runtime);assert.deepEqual(saved.binding.sources,h.run.sources);assert.deepEqual(saved.binding.dirtyPaths,[]);assert.equal(saved.sourceRelationship,'unverified');assert.equal(saved.conditions.appTheme,'unknown');assert.equal(saved.conditions.dataState,'unknown');assert.equal(saved.conditions.animationState,'unknown');assert.equal(saved.conditions.colorSchemePreference,'dark');assert.equal(saved.conditions.reducedMotionPreference,'no-preference');assert.equal(run.status,'completed');assert.equal(run.assessment,'matched');assert.equal(h.nativeCalls.length,1);assert.deepEqual(Object.keys(h.nativeCalls[0]).sort(),['documentId','nonce','pageVersion','route','session','viewId']);assert.doesNotMatch(JSON.stringify(h.nativeCalls),/source|src\/|provider|assistant/i);
});

test('only the exact active trusted observation in a visible Refine canvas can capture',async t=>{
 for(const mutate of [h=>h.vscode.workspace.isTrusted=false,h=>h.host.mode='Understand',h=>h.panel.visible=false,h=>h.host.panel=undefined,h=>h.host.nativeCaptureAvailable=false,h=>h.host.scenarioCapture=undefined,h=>h.host.disposed=true]){const h=await setup(t),capture=h.host.scenarioCapture;mutate(h);await assert.rejects(h.host.captureScenarioImage(capture));assert.equal(h.nativeCalls.length,0);assert.equal(h.assetWrites.length,0);}
 const h=await setup(t);await assert.rejects(finish(h,{id:'foreign-run'}),/current manual observation/);noNewImage(h);assert.equal(h.raw().runs[0].status,'recording');
});

test('native nonce identity, PNG data, condition and size failures keep the run open',async t=>{
 for(const mutate of [value=>value.identity.nonce='wrong',value=>value.identity.documentId='foreign',value=>value.identity.extra=true,value=>value.pngBase64='not base64!',value=>value.pngBase64=Buffer.from('invalid PNG').toString('base64'),value=>value.conditions.pixelWidth=3,value=>value.conditions.observedColorScheme='unknown',value=>value.conditions.reducedMotion='false',value=>value.conditions.canvasScale=0,value=>value.capturedAt='invalid']){const h=await setup(t);h.setNative(identity=>{const value=h.nativeResult(identity);mutate(value);return value;});await assert.rejects(finish(h));noNewImage(h);assert.equal(h.raw().runs[0].status,'recording');assert.equal(h.raw().runs[0].assessment,'not-assessed');}
});

test('source, dirty, navigation and ownership changes during native capture reject late pixels',async t=>{
 const mutations=[h=>h.sources.set('src/Button.tsx',file('changed saved bytes')),h=>h.setDirty(['src/Button.tsx']),h=>h.runtimeState.pageVersion++,h=>h.runtimeState.documentId='9'.repeat(32),h=>h.runtimeState.session='8'.repeat(32),h=>h.runtimeState.viewId='7'.repeat(32),h=>h.runtimeState.pagePath='/other',h=>h.runtimeState.target.id='other',h=>h.runtimeState.pageConnected=false,h=>h.vscode.workspace.isTrusted=false,h=>h.host.project={...project,id:'other-project'},h=>h.host.featureSnapshot=()=>({activeId:'other',revision:99,features:[]}),h=>h.host.panel={...h.panel},h=>h.host.runtime={...h.runtime},h=>h.host.scenarioCapture=undefined];
 for(const mutate of mutations){const h=await setup(t),store=h.host.runtimeCaptureStorage().store;h.setNative(identity=>{mutate(h);return h.nativeResult(identity);});await assert.rejects(finish(h));assert.equal(store.snapshot().captures.length,0);assert.equal(h.assetWrites.length,0);assert.notEqual(h.host.runtimeWorkspaceStores.get(project.id).snapshot().runs[0].status,'completed');}
});

test('fresh runtime validation catches changed documents even when the cached heartbeat remains unchanged',async t=>{
 const h=await setup(t);h.runtime.readCurrent=async()=>({...plain(h.runtimeState),documentId:'9'.repeat(32)});await assert.rejects(finish(h),/running document changed/);assert.equal(h.nativeCalls.length,0);noNewImage(h);assert.equal(h.raw().runs[0].status,'recording');
});

test('the second fresh runtime witness and final source read must still match after actual pixels return',async t=>{
 for(const changed of ['fresh-runtime','source-read']){const h=await setup(t);let reads=0;if(changed==='fresh-runtime')h.runtime.readCurrent=async()=>({...plain(h.runtimeState),pageVersion:++reads===1?1:2});else h.setNative(identity=>{h.setSource(async()=>{h.runtimeState.documentId='9'.repeat(32);return file();});return h.nativeResult(identity);});await assert.rejects(finish(h));noNewImage(h);assert.equal(h.nativeCalls.length,1);assert.notEqual(h.raw().runs[0].status,'completed');}
});

test('native capture or local persistence failure never finishes or assesses the observation',async t=>{
 for(const phase of ['native','storage']){const h=await setup(t);if(phase==='native')h.setNative(()=>{throw new Error('Native capture unavailable');});else h.setCaptureWrite(()=>{throw new Error('PRIVATE_STORAGE_PATH');});await assert.rejects(finish(h,{assessment:'matched'}));assert.equal(h.raw().runs[0].status,'recording');assert.equal(h.raw().runs[0].assessment,'not-assessed');assert.equal(h.captureSnapshot().captures.length,0);assert.doesNotMatch(h.host.runtimeWorkspaceError||'',/PRIVATE_STORAGE_PATH/);}
});

test('an immutable image survives rejected finish and retry finishes without taking another image',async t=>{
 const h=await setup(t);await assert.rejects(finish(h,{assessment:'matched',note:'invalid\0note'}));const saved=plain(h.captureSnapshot().captures[0]);assert.ok(saved);assert.equal(h.raw().runs[0].status,'recording');assert.equal(h.nativeCalls.length,1);await finish(h,{assessment:'not-matched',note:'Corrected manual note'});assert.equal(h.nativeCalls.length,1);assert.equal(h.assetWrites.length,1);assert.deepEqual(h.captureSnapshot().captures,[saved]);assert.equal(h.raw().runs[0].assessment,'not-matched');
});

test('lazy image delivery is trusted, workspace-only and absent from ordinary metadata state',async t=>{
 const h=await setup(t);await finish(h);const capture=h.captureSnapshot().captures[0];h.assetReads.length=0;h.messages.length=0;
 for(let n=0;n<3;n++){const metadata=h.host.runtimeCapturesSnapshot();const ui=h.host.runtimeCapturesSnapshot(h.panel.webview);assert.equal(metadata.captures[0].imageUri,undefined);assert.equal(ui.captures[0].imageStatus,'not-loaded');assert.doesNotMatch(JSON.stringify(ui),/pngBase64|webview:|file:\/\//);}assert.equal(h.assetReads.length,0);
 await h.host.message({type:'runtimeCaptureImage',projectId:project.id,id:capture.id},'assistant');assert.equal(h.assetReads.length,0);assert.equal(h.messages.length,0);
 await h.host.message({type:'runtimeCaptureImage',projectId:'foreign',id:capture.id},'workspace');assert.equal(h.assetReads.length,0);
 h.vscode.workspace.isTrusted=false;await h.host.readRuntimeCaptureImage({projectId:project.id,id:capture.id});assert.equal(h.assetReads.length,0);assert.equal(h.host.runtimeCapturesSnapshot(),null);h.vscode.workspace.isTrusted=true;
 await h.host.message({type:'runtimeCaptureImage',projectId:project.id,id:capture.id},'workspace');assert.equal(h.assetReads.length,1);assert.deepEqual(h.messages,[{type:'runtimeCaptureImage',projectId:project.id,id:capture.id,imageSha256:capture.image.sha256,pngBase64:image.toString('base64')}]);
 assert.equal(h.host.runtimeCapturesSnapshot().captures[0].imageStatus,'not-loaded');assert.equal(h.panel.webview.options.localResourceRoots,undefined,'capture delivery never expands filesystem resource roots');
});

test('missing and corrupt images send safe errors while retaining immutable metadata',async t=>{
 for(const missing of [true,false]){const h=await setup(t);await finish(h);const capture=h.captureSnapshot().captures[0];h.messages.length=0;if(missing)h.assets.delete(`${project.id}/${capture.id}`);else h.assets.set(`${project.id}/${capture.id}`,Buffer.from('PRIVATE_CORRUPTED_PNG'));await h.host.readRuntimeCaptureImage({projectId:project.id,id:capture.id});const metadata=h.host.runtimeCapturesSnapshot();assert.equal(metadata.captures.length,1);assert.equal(metadata.captures[0].imageStatus,'not-loaded');assert.equal(h.messages.length,1);assert.match(h.messages[0].error,/could not be verified/);assert.equal(h.messages[0].pngBase64,undefined);assert.doesNotMatch(JSON.stringify(h.messages),/PRIVATE_|file:\/\//);}
});

test('later requests reverify tampered assets and deliver only the exact bytes already checked',async t=>{
 const h=await setup(t);await finish(h);const capture=h.captureSnapshot().captures[0],original=h.panel.webview.postMessage;h.assetReads.length=0;h.messages.length=0;
 h.panel.webview.postMessage=message=>{if(message.type==='runtimeCaptureImage' && message.pngBase64)h.assets.set(`${project.id}/${capture.id}`,Buffer.from('tampered after verification'));return original(message);};
 await h.host.readRuntimeCaptureImage({projectId:project.id,id:capture.id});assert.equal(h.messages[0].pngBase64,image.toString('base64'));assert.equal(h.messages[0].imageSha256,hash(image));
 await h.host.readRuntimeCaptureImage({projectId:project.id,id:capture.id});assert.equal(h.assetReads.length,2,'a prior successful read never bypasses integrity');assert.equal(h.messages.length,2);assert.match(h.messages[1].error,/could not be verified/);assert.equal(h.messages[1].pngBase64,undefined);
});

test('late delivery sends no pixels after trust revocation, project change, panel replacement or disposal',async t=>{
 for(const change of ['trust','project','panel','disposed']){const h=await setup(t);await finish(h);const capture=h.captureSnapshot().captures[0],entry=h.host.runtimeCaptureStorage(),gate=deferred();h.messages.length=0;h.setAssetRead(()=>gate.promise);const pending=h.host.readRuntimeCaptureImage({projectId:project.id,id:capture.id});await tick();assert.equal(entry.images.size,1);if(change==='trust')h.vscode.workspace.isTrusted=false;else if(change==='project')h.host.project={...project,id:'other-project'};else if(change==='panel')h.host.panel={...h.panel};else h.host.disposed=true;gate.resolve();await pending;assert.deepEqual(h.messages,[]);assert.equal(entry.images.size,0);}
});

test('image delivery bounds concurrent reads at two and deduplicates the same capture',async t=>{
 const h=await setup(t);await finish(h);for(let index=0;index<2;index++){await h.action('beginRun',{scenarioId:h.scenario.id});h.run=plain(h.host.scenarioCapture.run);await finish(h);}
 const captures=h.captureSnapshot().captures,entry=h.host.runtimeCaptureStorage(),gate=deferred();h.assetReads.length=0;h.messages.length=0;h.setAssetRead(()=>gate.promise);
 const request=id=>h.host.readRuntimeCaptureImage({projectId:project.id,id});const first=request(captures[0].id),second=request(captures[1].id);await request(captures[0].id);await request(captures[2].id);assert.equal(h.assetReads.length,2);assert.equal(entry.images.size,2);assert.deepEqual(plain(h.host.runtimeCapturesSnapshot().captures.map(item=>item.imageStatus)),['loading','loading','not-loaded']);
 assert.equal(h.messages.length,1);assert.equal(h.messages[0].id,captures[2].id);assert.match(h.messages[0].error,/still loading/);assert.equal(h.messages[0].pngBase64,undefined);gate.resolve();await Promise.all([first,second]);assert.equal(entry.images.size,0);assert.equal(h.messages.filter(item=>item.pngBase64).length,2);await request(captures[2].id);assert.equal(h.assetReads.length,3);assert.equal(h.messages.filter(item=>item.pngBase64).length,3);
});

test('source or dirty changes while image persistence awaits cannot finish the observation as current',async t=>{
 for(const change of ['source','dirty']){const h=await setup(t);h.setCaptureWrite(()=>{if(change==='source')h.sources.set('src/Button.tsx',file('saved during capture persistence'));else h.setDirty(['src/Button.tsx']);});await assert.rejects(finish(h,{assessment:'matched'}));assert.notEqual(h.raw().runs[0].status,'completed');assert.equal(h.captureSnapshot().captures.length,1,'already persisted historical pixels stay immutable for recovery');}
});


test('explicit cancellation while the native command awaits refuses its late result',async t=>{
 const h=await setup(t),gate=deferred();h.setNative(async identity=>{await gate.promise;return h.nativeResult(identity);});
 const pending=finish(h);await tick();await h.host.endScenarioRun('cancelled');gate.resolve();await assert.rejects(pending);noNewImage(h);assert.equal(h.raw().runs[0].status,'cancelled');assert.equal(h.raw().runs[0].assessment,'not-assessed');
});

test('retrying an existing image must recheck sources and dirty context after its awaited verification',async t=>{
 for(const change of ['source','dirty']){const h=await setup(t);await assert.rejects(finish(h,{note:'invalid\0note'}));const saved=plain(h.captureSnapshot().captures[0]);
  h.setAssetRead(()=>{if(change==='source')h.sources.set('src/Button.tsx',file('saved during retry verification'));else h.setDirty(['src/Button.tsx']);});
  await assert.rejects(finish(h,{assessment:'matched'}));assert.notEqual(h.raw().runs[0].status,'completed');assert.equal(h.nativeCalls.length,1);assert.deepEqual(h.captureSnapshot().captures,[saved]);
 }
});


test('source epoch changes invalidate delayed source reads before or after image persistence',async t=>{
 for(const phase of ['before-persistence','after-persistence']){const h=await setup(t),entered=deferred(),gate=deferred();let reads=0;
  h.setNative(identity=>{h.setSource(async()=>{reads++;if(reads===(phase==='before-persistence'?1:2)){entered.resolve();await gate.promise;}return file();});return h.nativeResult(identity);});
  const pending=finish(h,{assessment:'matched'});await entered.promise;h.host.featureSourceEpoch++;gate.resolve();await assert.rejects(pending,/changed during capture/);assert.notEqual(h.raw().runs[0].status,'completed');assert.equal(h.captureSnapshot().captures.length,phase==='before-persistence'?0:1);
 }
});


test('a committed capture manifest with a failed acknowledgement is reconciled before native recapture',async t=>{
 const h=await setup(t);h.setCaptureWrite(value=>{h.captureManifests.set(project.id,plain(value));throw new Error('PRIVATE_WRITE_ACK_FAILURE');});
 await assert.rejects(finish(h,{assessment:'matched'}));const durable=plain(h.captureManifests.get(project.id).captures[0]);assert.ok(durable);assert.equal(h.captureSnapshot().captures.length,0);assert.equal(h.captureSnapshot().storage.status,'error');assert.equal(h.raw().runs[0].status,'recording');assert.equal(h.raw().runs[0].assessment,'not-assessed');assert.equal(h.nativeCalls.length,1);assert.equal(h.assetWrites.length,1);
 h.setCaptureWrite(undefined);await finish(h,{assessment:'not-matched',note:'Explicit assessment after storage recovery'});
 assert.equal(h.nativeCalls.length,1,'durable point-in-time pixels must never be replaced by a retry capture');assert.equal(h.assetWrites.length,1);assert.deepEqual(h.captureSnapshot().captures,[durable]);assert.equal(h.captureSnapshot().storage.status,'saved');assert.equal(h.raw().runs[0].status,'completed');assert.equal(h.raw().runs[0].assessment,'not-matched');assert.equal(h.raw().runs[0].note,'Explicit assessment after storage recovery');
});
