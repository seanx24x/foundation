import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {deflateSync} from 'node:zlib';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import * as verification from '../src/visual-verification-store.mjs';
import * as captureStore from '../src/runtime-capture-store.mjs';
import * as safety from '../src/safety.mjs';
import * as sourceProposals from '../../../server/project/proposals.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),require=createRequire(join(root,'package.json')),ts=require('typescript');
const compiled=ts.transpileModule(`${readFileSync(join(root,'desktop/extension/src/extension.ts'),'utf8')}\nexport {FoundationHost};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const hash=value=>createHash('sha256').update(value).digest('hex'),plain=value=>structuredClone(value);
const before=':root { --radius: 8px; }\n',after=':root { --radius: 12px; }\n';
const requested={theme:'dark',motion:'reduce',viewportWidthCss:960,viewportHeightCss:680};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Structural PNG protocol fixture, never runtime evidence.
function png(){const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;}return(value^0xffffffff)>>>0;};const chunk=(type,body=Buffer.alloc(0))=>{const data=Buffer.concat([Buffer.from(type),body]),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(body.length);tail.writeUInt32BE(crc(data));return Buffer.concat([head,data,tail]);};const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(18))),chunk('IEND')]);}
const image=png();
function fixture(){
 const project={id:'alternative-host',root:'/fixtures/alternative-host',files:[]},feature={id:'feature-1',title:'Save profile',paths:['tokens.css'],archived:false},screen={id:'screen-1',featureId:feature.id,title:'Profile',targetId:'vite:dev',route:'/profile',archived:false},scenario={id:'scenario-1',screenId:screen.id,title:'Save changes',steps:['Save'],expectedOutcome:'Saved',archived:false};
 const features={revision:1,storage:{status:'saved'},features:[feature]},workspace={revision:2,storage:{status:'saved'},screens:[screen],scenarios:[scenario]};
 const recipe={id:'save-profile',title:'Save profile',route:'/profile',fixture:{id:'local',label:'Local'},steps:[{id:'save',title:'Save'}]},runtime={status:'connected',pageConnected:true,target:{id:'vite:dev'},replayCatalog:{digest:'d'.repeat(64),recipes:[recipe]}};
 let proposal={id:randomUUID(),projectId:project.id,origin:'design',status:'proposed',title:'Radius',path:'tokens.css',before,after,baseRevision:hash(before).slice(0,16),designImpact:{version:1,relatedScenarios:[{featureId:feature.id,screenId:screen.id,scenarioId:scenario.id,scenarioTitle:scenario.title,screenTitle:screen.title}]}},source={path:'tokens.css',source:before,revision:hash(before).slice(0,16)},readHook,impactHook,sessionHook,captureHook,imageHook;
 const calls=[],messages=[],dirty=new Set(),state={schemaVersion:1,projectId:project.id,revision:3,busy:false,storage:{status:'saved'},records:[]};
 const session={snapshot:()=>plain(state),prepare:async(input,{guard})=>{calls.push({method:'prepare',input:plain(input)});if(sessionHook)await sessionHook();await guard();return {id:'prepared'};},run:async(id,revision,{guard})=>{calls.push({method:'run',id,revision});if(sessionHook)await sessionHook();await guard();return plain(state.records.find(item=>item.id===id));},stop:async()=>{calls.push({method:'stop'});state.busy=false;return plain(state);},retry:async()=>{calls.push({method:'retry'});return plain(state);},readCapture:async(id,captureId)=>{calls.push({method:'readCapture',id,captureId});if(imageHook)await imageHook();if(id!=='owned-comparison'||captureId!=='owned-capture')throw new Error('Private foreign capture');return {png:image};}};
 const nativeResult=identity=>({identity:plain(identity),pngBase64:image.toString('base64'),capturedAt:new Date().toISOString(),conditions:{viewportWidth:960,viewportHeight:680,devicePixelRatio:1,scrollX:0,scrollY:0,canvasScale:1,observedColorScheme:'dark',reducedMotion:true,pixelWidth:2,pixelHeight:2}});
 const vscode={Uri:{joinPath:(base,...parts)=>({toString:()=>`vscode-resource:${join(base.path,...parts)}`})},workspace:{isTrusted:true},commands:{executeCommand:async(name,identity)=>{calls.push({method:'capture',name,identity:plain(identity)});return captureHook?captureHook(identity):nativeResult(identity);}}};
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,URL,AbortController,TextDecoder,structuredClone,setTimeout,clearTimeout,require:name=>name==='vscode'?vscode:name.includes('visual-verification-store')?verification:name.includes('runtime-capture-store')?captureStore:name.includes('safety')?safety:name.endsWith('/proposals.mjs')?sourceProposals:name.startsWith('node:')?require(name):{},fetch(){throw new Error('No provider or network expected');}});
 const host=Object.create(module.exports.FoundationHost.prototype),panel={visible:true,webview:{cspSource:'vscode-webview://test',asWebviewUri:value=>value,postMessage:async message=>{messages.push(plain(message));return true;}}};
 Object.assign(host,{context:{extensionUri:{path:'/extension'}},nonce:'host-script-nonce',runtimeFrameOrigin:'http://127.0.0.1:4173',alternativeFrameOrigin:'',flushAssistantPreparation(){},project:plain(project),disposed:false,panel,mode:'Review',nativeCaptureAvailable:true,featureSourceEpoch:0,proposalMutationGeneration:0,visualAlternativesSessions:new Map([[`${project.id}\0${project.root}`,session]]),features:()=>({snapshot:()=>plain(features)}),runtimeWorkspaceStore:()=>({snapshot:()=>plain(workspace),presentation:()=>({snapshot:workspace})}),runtime:{snapshot:()=>plain(runtime)},proposals:()=>({current:()=>plain(proposal),set:async(value,{isCurrent})=>{assert.equal(isCurrent(),true);calls.push({method:'setProposal',value:plain(value)});proposal=plain(value);return plain(proposal);}}),dirtyPaths:()=>[...dirty],loadChangeSets:async()=>{},changeSetSnapshot:()=>null,executionSnapshot:()=>null,validateDesignImpactForProposal:async()=>{if(impactHook)await impactHook();return true;},service:{getFile:async()=>{if(readHook)await readHook();return plain(source);}},sendState(){},queueConversationState(){}});
 const h={host,panel,project,vscode,feature,features,screen,scenario,workspace,runtime,recipe,session,state,calls,messages,dirty,nativeResult,get proposal(){return proposal;},set proposal(value){proposal=value;},get source(){return source;},set source(value){source=value;},setRead:hook=>readHook=hook,setImpact:hook=>impactHook=hook,setSession:hook=>sessionHook=hook,setCapture:hook=>captureHook=hook,setImage:hook=>imageHook=hook,
 action:(action,fields={})=>host.visualAlternativesAction({projectId:project.id,action,expectedRevision:state.revision,proposalId:proposal?.id,proposalBasis:verification.visualVerificationDigest(proposal),scenarioId:scenario.id,recipeId:recipe.id,requested:plain(requested),...fields})};
 h.record=()=>{const record={id:randomUUID(),path:'tokens.css',status:'ready',proposalId:proposal.id,beforeHash:hash(before),afterHash:hash(after),scope:{feature:{id:feature.id,title:feature.title,paths:plain(feature.paths),revision:features.revision},screen:plain(screen),scenario:plain(scenario),definitionRevision:workspace.revision}};state.records=[record];return record;};return h;
}

test('prepare takes source, feature scope and recipe from host-owned records',async()=>{
 const h=fixture();await h.action('prepare',{proposal:{after:'forged'},scope:{feature:{paths:['private']}},recipe:{id:'forged'}});const prepared=h.calls.find(item=>item.method==='prepare');assert.equal(prepared.input.proposal.after,after);assert.deepEqual(prepared.input.scope.feature.paths,['tokens.css']);assert.equal(prepared.input.recipe.id,h.recipe.id);assert.equal(h.host.visualAlternativesOperation,undefined);assert.equal(h.messages.length,0);
});

test('renderer forgeries, unknown relationships, stale source and wrong history revision cannot prepare',async()=>{
 for(const extra of [{proposalId:'foreign'},{proposalBasis:'forged'},{expectedRevision:99},{scenarioId:'foreign'},{recipeId:'foreign'},{projectId:'foreign'}]){const h=fixture();await assert.rejects(h.action('prepare',extra));assert.equal(h.calls.length,0);}
 for(const mutate of [h=>h.source.source='changed',h=>h.source.revision='stale',h=>h.proposal.status='applied',h=>h.dirty.add('tokens.css'),h=>h.runtime.status='disconnected',h=>h.runtime.target.id='foreign',h=>h.scenario.archived=true,h=>h.host.panel.visible=false,h=>h.host.mode='Build',h=>h.host.nativeCaptureAvailable=false]){const h=fixture();mutate(h);await assert.rejects(h.action('prepare',{captureEach:true}));assert.equal(h.calls.length,0);}
});

test('host guards recheck project, trust, selection, proposal, source epoch and busy state after each await',async()=>{
 const mutations=[h=>h.host.project.root='/other',h=>h.vscode.workspace.isTrusted=false,h=>h.host.disposed=true,h=>h.host.panel={visible:true},h=>h.panel.visible=false,h=>h.host.mode='Build',h=>h.host.featureSourceEpoch++,h=>h.host.proposalMutationGeneration++,h=>h.proposal.after='changed',h=>h.dirty.add('tokens.css'),h=>h.features.revision++,h=>h.workspace.revision++,h=>h.host.asking={}];
 for(const phase of ['impact','read','session'])for(const mutate of mutations){const h=fixture();h[phase==='impact'?'setImpact':phase==='read'?'setRead':'setSession'](()=>mutate(h));await assert.rejects(h.action('prepare'));assert.equal(h.host.visualAlternativesOperation,undefined);assert.equal(h.calls.filter(item=>item.method==='prepare').length,phase==='session'?1:0);}
});

test('run is bound to the current proposal and exact frozen feature, screen and scenario',async()=>{
 const h=fixture(),record=h.record();await h.action('run',{id:record.id});assert.deepEqual(h.calls,[{method:'run',id:record.id,revision:3}]);
 for(const mutate of [h=>h.state.records[0].proposalId='other',h=>h.state.records[0].beforeHash='a'.repeat(64),h=>h.state.records[0].afterHash='a'.repeat(64),h=>h.feature.paths.push('other.ts'),h=>h.features.revision++,h=>h.workspace.revision++,h=>h.screen.route='/other',h=>h.scenario.steps.push('Changed'),h=>h.feature.archived=true]){const h=fixture(),record=h.record();mutate(h);await assert.rejects(h.action('run',{id:record.id}));assert.equal(h.calls.length,0);}
});

test('Apply and other runtime work cannot overlap an active alternatives operation',async()=>{
 const h=fixture();let release;h.setSession(()=>new Promise(resolve=>release=resolve));const pending=h.action('prepare');await tick();assert.equal(h.host.alternativesBusy(),true);await assert.rejects(h.host.changeProposal('apply',h.proposal.id),/Stop the comparison/);await assert.rejects(h.host.runtimeReplayAction({}),/Stop the comparison/);for(const action of ['link','viewScenario','compare','retry'])await assert.rejects(h.host.visualVerificationAction({action,projectId:h.project.id}),/Finish the current/);await assert.rejects(h.action('prepare'),/Finish the current/);release();await pending;assert.equal(h.host.alternativesBusy(),false);
});

test('ready acknowledgement requires current visible owner, nonce, runtime identity, requested conditions and page identity',async()=>{
 const h=fixture(),input={comparisonId:'comparison',variantId:'baseline',nonce:'n'.repeat(32),phase:'ready',requested:plain(requested),runtime:{url:'http://127.0.0.1:52111/profile?__foundation_view=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',owned:true,session:'a'.repeat(32),viewId:'b'.repeat(32),documentId:'c'.repeat(32),pageVersion:1,pagePath:'/profile'}};
 const pending=h.host.requestAlternativePreview(h.project,input);assert.equal(h.messages.length,0);assert.equal(h.panel.webview.html.match(/frame-src ([^;]+);/)[1],"'self' http://127.0.0.1:4173 http://127.0.0.1:52111");await h.host.message({type:'ready',historyProtocol:1},'workspace');assert.equal(h.messages.find(item=>item.type==='visualAlternativesPreview').nonce,input.nonce);const valid={projectId:h.project.id,comparisonId:input.comparisonId,variantId:input.variantId,nonce:input.nonce,phase:input.phase,requested:plain(requested),session:input.runtime.session,viewId:input.runtime.viewId,documentId:input.runtime.documentId,pageVersion:1,route:'/profile'};
 for(const patch of [{projectId:'other'},{comparisonId:'other'},{variantId:'alternative'},{nonce:'wrong'},{phase:'capture'},{session:'d'.repeat(32)},{viewId:'d'.repeat(32)},{documentId:'d'.repeat(32)},{pageVersion:2},{route:'/other'},{requested:{...requested,theme:'light'}}]){h.host.alternativePreviewReady({...valid,...patch});assert.ok(h.host.visualAlternativesPreviewWait);}
 h.host.alternativePreviewReady(valid);await pending;assert.equal(h.host.visualAlternativesPreviewWait,undefined);
 const second=h.host.requestAlternativePreview(h.project,input);h.panel.visible=false;h.host.alternativePreviewReady(valid);assert.ok(h.host.visualAlternativesPreviewWait);h.host.interruptAlternatives();await assert.rejects(second,/visible comparison changed/);
});

test('native captures bind exact fresh nonce and identity to validated bytes and reject changed ownership',async()=>{
 const identity={session:'a'.repeat(32),viewId:'b'.repeat(32),documentId:'c'.repeat(32),route:'/profile',pageVersion:1};
 const h=fixture();const result=await h.host.captureAlternative(h.project,{identity,guard:async()=>{}});assert.deepEqual(result.png,image);const call=h.calls[0];assert.equal(call.name,'_foundation.captureActiveCanvas');assert.match(call.identity.nonce,/^[a-f0-9]{32}$/);assert.notEqual(call.identity.nonce,identity.nonce);
 for(const mutate of [value=>value.identity.nonce='foreign',value=>value.identity.documentId='foreign',value=>value.identity.extra=true,value=>value.pngBase64='invalid!',value=>value.pngBase64=Buffer.from('not PNG').toString('base64'),value=>value.conditions.pixelWidth=3,value=>value.conditions.observedColorScheme='unknown',value=>value.conditions.reducedMotion='true']){const h=fixture();h.setCapture(id=>{const result=h.nativeResult(id);mutate(result);return result;});await assert.rejects(h.host.captureAlternative(h.project,{identity,guard:async()=>{}}));}
 for(const mutate of [h=>h.host.project.root='/other',h=>h.vscode.workspace.isTrusted=false,h=>h.host.disposed=true,h=>h.panel.visible=false,h=>h.host.mode='Build',h=>h.host.nativeCaptureAvailable=false]){const h=fixture();h.setCapture(id=>{mutate(h);return h.nativeResult(id);});await assert.rejects(h.host.captureAlternative(h.project,{identity,guard:async()=>{}}));}
});

test('capture reads forward only verified owner bytes and suppress images after context changes',async()=>{
 const h=fixture();await h.action('image',{id:'owned-comparison',captureId:'owned-capture',pngBase64:'forged'});assert.equal(h.messages[0].pngBase64,image.toString('base64'));assert.equal(h.messages[0].imageSha256,hash(image));
 const foreign=fixture();await foreign.action('image',{id:'foreign',captureId:'owned-capture'});assert.equal(foreign.messages[0].pngBase64,undefined);assert.doesNotMatch(JSON.stringify(foreign.messages),/Private foreign/);
 for(const mutate of [h=>h.host.project.root='/other',h=>h.host.disposed=true,h=>h.vscode.workspace.isTrusted=false,h=>h.host.panel={}]){const h=fixture();h.setImage(()=>mutate(h));await h.action('image',{id:'owned-comparison',captureId:'owned-capture'});assert.equal(h.messages.length,0);}
});

test('stop requires the active comparison and assistant messages cannot dispatch alternatives',async()=>{
 const h=fixture();await h.host.message({type:'visualAlternatives',projectId:h.project.id,action:'prepare'},'assistant');assert.equal(h.calls.length,0);await assert.rejects(h.action('stop',{id:'foreign'}));const record=h.record();record.status='running';h.state.busy=true;await h.action('stop',{id:record.id});assert.ok(h.calls.some(item=>item.method==='stop'));
});

test('a hidden original page may supply its authenticated retained recipe catalog without accepting renderer recipes',async()=>{
 const h=fixture();h.runtime.pageConnected=false;await h.action('prepare',{recipe:{id:'forged',route:'/private',catalogDigest:'fake'},runtime:{replayCatalog:{recipes:[{id:'forged'}]}}});const prepared=h.calls.find(item=>item.method==='prepare');assert.equal(prepared.input.recipe.id,h.recipe.id);assert.equal(prepared.input.recipe.catalogDigest,h.runtime.replayCatalog.digest);
 const missing=fixture();missing.runtime.pageConnected=false;missing.runtime.replayCatalog=null;await assert.rejects(missing.action('prepare'));assert.equal(missing.calls.length,0);
});

const previewInput=()=>({comparisonId:'comparison',variantId:'baseline',nonce:'n'.repeat(32),phase:'connect',requested:plain(requested),runtime:{url:'http://127.0.0.1:52111/profile?__foundation_view=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',owned:true,session:'a'.repeat(32),viewId:'b'.repeat(32),documentId:'c'.repeat(32),pageVersion:1,pagePath:'/profile'}});
test('preview CSP grants only the owned loopback side and keeps assistant frames closed',async()=>{
 const h=fixture(),input=previewInput();const pending=h.host.requestAlternativePreview(h.project,input);assert.equal(h.panel.webview.html.match(/frame-src ([^;]+);/)[1],"'self' http://127.0.0.1:4173 http://127.0.0.1:52111");assert.equal(h.host.webviewHtml(h.panel.webview,'assistant').match(/frame-src ([^;]*);/)[1],"'self' ");assert.doesNotMatch(h.panel.webview.html,/frame-src[^;]*(?:https:|\*|localhost)/);await h.host.message({type:'ready',historyProtocol:1},'workspace');const sent=h.messages.filter(item=>item.type==='visualAlternativesPreview');assert.deepEqual(sent,[{type:'visualAlternativesPreview',projectId:h.project.id,...input}]);assert.equal(h.host.visualAlternativesPreviewWait.input,input);h.host.interruptAlternatives();await assert.rejects(pending);
 for(const patch of [{url:'https://external.example:443/profile'},{url:'http://0.0.0.0:52111/'},{url:'http://127.0.0.1/'},{url:'http://user:secret@127.0.0.1:52111/'},{owned:false},{session:undefined}]){const h=fixture(),input=previewInput();Object.assign(input.runtime,patch);await assert.rejects(h.host.requestAlternativePreview(h.project,input));assert.equal(h.host.alternativeFrameOrigin,'');assert.equal(h.panel.webview.html,undefined);assert.equal(h.host.visualAlternativesPreviewWait,undefined);}
});
test('preview handoff and ready resend remain bound to the visible trusted native project',async()=>{
 for(const mutate of [h=>h.host.project.root='/other',h=>h.vscode.workspace.isTrusted=false,h=>h.host.disposed=true,h=>h.panel.visible=false,h=>h.host.mode='Build',h=>h.host.panel={visible:true,webview:h.panel.webview}]){const h=fixture(),input=previewInput(),pending=h.host.requestAlternativePreview(h.project,input);mutate(h);await h.host.message({type:'ready'},'workspace');assert.equal(h.messages.some(item=>item.type==='visualAlternativesPreview'),false);h.host.interruptAlternatives();await assert.rejects(pending);}
 const h=fixture();await assert.rejects(h.host.requestAlternativePreview({...h.project,root:'/foreign'},previewInput()));assert.equal(h.host.alternativeFrameOrigin,'');assert.equal(h.panel.webview.html,undefined);
});


function retained(h){
 const record=h.record();record.status='completed';record.baselineDigest='b'.repeat(64);record.candidate={name:'Soft corners',token:{name:'--radius',occurrence:0},metadataDigest:'c'.repeat(64)};
 const value={name:record.candidate.name,path:record.path,before,after,beforeHash:hash(before),afterHash:hash(after),baselineDigest:record.baselineDigest,token:plain(record.candidate.token),designImpact:plain(h.proposal.designImpact),alternativeBasis:{version:1,comparisonId:record.id,beforeHash:hash(before),afterHash:hash(after),baselineDigest:record.baselineDigest}};
 h.session.readCandidate=async(id,revision,{guard})=>{assert.equal(id,record.id);assert.equal(revision,h.state.revision);h.calls.push({method:'readCandidate'});await guard();return plain(value);};
 h.session.validateCandidate=async(basis,options)=>{assert.deepEqual(basis,value.alternativeBasis);h.calls.push({method:'validateCandidate',temporary:plain(options.originalWriteTemporary)});await options.guard();return plain(value);};
 h.host.proposalDiff=async id=>{h.calls.push({method:'diff',id});};
 return {record,value};
}

test('named candidate review resolves private source and stages a normal proposal before native diff without Apply',async()=>{
 const h=fixture(),{record,value}=retained(h);
 const reviewed=await h.action('review',{id:record.id,metadataDigest:record.candidate.metadataDigest,before:'forged',after:'forged',alternativeBasis:{comparisonId:'foreign'}});
 assert.equal(reviewed.before,before);assert.equal(reviewed.after,after);assert.equal(reviewed.title,'Soft corners');assert.deepEqual(reviewed.alternativeBasis,value.alternativeBasis);assert.equal(reviewed.status,'proposed');assert.equal(h.source.source,before);
 assert.deepEqual(h.calls.map(v=>v.method),['readCandidate','setProposal','diff']);assert.equal(h.calls.at(-1).id,reviewed.id);
 const response=h.messages.find(v=>v.type==='visualAlternativesReview');assert.equal(response.proposalId,reviewed.id);assert.equal(response.metadataDigest,record.candidate.metadataDigest);assert.equal(h.host.visualAlternativesOperation,undefined);
});

test('review rejects legacy, incomplete, stale scope, dirty target and conflicting proposal without replacing it',async()=>{
 for(const change of [({record})=>delete record.candidate,({record})=>record.status='failed',({record})=>record.candidate.metadataDigest='d'.repeat(64),({h})=>h.dirty.add('tokens.css'),({h})=>h.proposal.status='applied',({h})=>h.proposal.after='other',({h})=>h.features.revision++,({h})=>h.workspace.revision++,({h})=>h.scenario.steps.push('Changed')]){
  const h=fixture(),r=retained(h),metadataDigest=r.record.candidate.metadataDigest;change({h,...r});const prior=plain(h.proposal);
  await assert.rejects(h.action('review',{id:r.record.id,metadataDigest}));assert.deepEqual(h.proposal,prior);assert.equal(h.calls.some(v=>v.method==='setProposal'),false);assert.equal(h.messages.at(-1).type,'visualAlternativesReview');assert.ok(h.messages.at(-1).error);
 }
});

test('review retains no stage after asynchronous source or owner changes and supports explicit cancellation',async()=>{
 for(const change of [h=>h.host.project.root='/other',h=>h.vscode.workspace.isTrusted=false,h=>h.host.panel.visible=false,h=>h.host.mode='Build',h=>h.host.featureSourceEpoch++,h=>h.host.proposalMutationGeneration++,h=>h.dirty.add('tokens.css'),h=>h.proposal.after='other']){
  const h=fixture(),{record}=retained(h);h.session.readCandidate=async(_id,_revision,{guard})=>{change(h);await guard();};
  await assert.rejects(h.action('review',{id:record.id,metadataDigest:record.candidate.metadataDigest}));assert.equal(h.calls.some(v=>v.method==='setProposal'),false);
 }
 const h=fixture(),{record,value}=retained(h);let release;h.session.readCandidate=async(_id,_revision,{guard})=>{await new Promise(resolve=>release=resolve);await guard();return value;};
 const pending=h.action('review',{id:record.id,metadataDigest:record.candidate.metadataDigest});await tick();assert.equal(h.host.visualAlternativesOperation.action,'review');
 await h.action('stop',{id:record.id});release();await assert.rejects(pending);assert.equal(h.calls.some(v=>v.method==='setProposal'),false);
});

test('historical comparison uses exact IDs and revisions without a live proposal or source change',async()=>{
 const h=fixture();h.proposal=null;const pair={leftId:randomUUID(),rightId:randomUUID(),compatible:true,reasons:[],observedDifferences:['Browser preference differs.']};
 h.session.compareCandidates=async(leftId,rightId,revision,{guard})=>{assert.equal(leftId,pair.leftId);assert.equal(rightId,pair.rightId);assert.equal(revision,h.state.revision);await guard();return plain(pair);};
 const result=await h.action('compare',{...pair,comparison:{compatible:false},records:[{after:'forged'}]});assert.deepEqual(result,pair);assert.deepEqual(h.messages[0].comparison,pair);assert.equal(h.calls.length,0);assert.equal(h.source.source,before);
 h.session.compareCandidates=async(_left,_right,_revision,{guard})=>{h.host.project.root='/other';await guard();};await assert.rejects(h.action('compare',pair));assert.equal(h.messages.length,1);
});

test('Apply provenance revalidates exact candidate and forwards only writer-owned temporary context',async()=>{
 const h=fixture(),{value}=retained(h);h.proposal.alternativeBasis=plain(value.alternativeBasis);
 const temporary={path:'.foundation-12345678-1234-4234-8234-123456789abc.tmp',dev:1,ino:9,hash:hash(after)};
 assert.equal(await h.host.validateAlternativeForProposal(h.proposal,h.project,temporary),true);assert.deepEqual(h.calls[0].temporary,temporary);
 for(const change of [v=>v.before='other',v=>v.after='other',v=>v.path='other.css',v=>v.beforeHash='a'.repeat(64),v=>v.designImpact={version:2}]){
  const h=fixture(),{value}=retained(h);h.proposal.alternativeBasis=plain(value.alternativeBasis);change(value);h.session.validateCandidate=async()=>value;await assert.rejects(h.host.validateAlternativeForProposal(h.proposal,h.project));
 }
});

// The empty checkpoint is an ownership state too; Review must not replace work
// installed while its private retained-source read was in flight.
test('review pins an initially empty proposal session through asynchronous candidate reads',async()=>{
 const h=fixture(),{record,value}=retained(h),other=plain(h.proposal);other.after='new unrelated proposal';h.proposal=null;
 h.session.readCandidate=async(_id,_revision,{guard})=>{await tick();h.proposal=other;await guard();return value;};
 await assert.rejects(h.action('review',{id:record.id,metadataDigest:record.candidate.metadataDigest}));
 assert.deepEqual(h.proposal,other);assert.equal(h.calls.some(v=>v.method==='setProposal'),false);
});

test('retained Review refuses active and unreadable change groups, including changes during its source read',async()=>{
 for(const snapshot of [{storage:{status:'error'}},{storage:{status:'unavailable'}},{storage:{status:'saved'},current:{status:'proposed'}},{storage:{status:'saved'},current:{status:'conflicted'}}]){
  const h=fixture(),{record}=retained(h);h.host.changeSetSnapshot=()=>snapshot;
  assert.equal(h.host.alternativeReviewChoices(h.state,h.project)[0].canReview,false);
  await assert.rejects(h.action('review',{id:record.id,metadataDigest:record.candidate.metadataDigest}));
  assert.equal(h.calls.some(v=>v.method==='setProposal'),false);
 }
 const h=fixture(),{record,value}=retained(h);h.session.readCandidate=async(_id,_revision,{guard})=>{h.host.changeSetSnapshot=()=>({storage:{status:'saved'},current:{status:'proposed'}});await guard();return value;};
 await assert.rejects(h.action('review',{id:record.id,metadataDigest:record.candidate.metadataDigest}));
 assert.equal(h.calls.some(v=>v.method==='setProposal'),false);
});

test('review never acknowledges a stale context after its staged checkpoint resolves',async()=>{
 for(const change of [h=>h.host.featureSourceEpoch++,h=>h.host.proposalMutationGeneration++,h=>h.dirty.add('tokens.css'),h=>h.features.revision++,h=>h.workspace.revision++,h=>{h.proposal.id=randomUUID();}]){
  const h=fixture(),{record}=retained(h),original=h.host.proposals();
  h.host.proposals=()=>({...original,set:async(value,options)=>{const saved=await original.set(value,options);change(h);return saved;}});
  await assert.rejects(h.action('review',{id:record.id,metadataDigest:record.candidate.metadataDigest}));
  assert.equal(h.calls.some(v=>v.method==='diff'),false);
  assert.equal(h.messages.some(v=>v.type==='visualAlternativesReview'&&!v.error),false);
  assert.equal(h.source.source,before);
 }
});
