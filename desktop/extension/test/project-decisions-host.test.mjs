import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import vm from 'node:vm';
import * as decisions from '../../../server/project/project-decisions.mjs';
import * as stores from '../src/project-decisions-store.mjs';
import {decisionFixture} from '../../../tests/helpers/project-decision-context.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),require=createRequire(join(root,'package.json')),ts=require('typescript');
const compiled=ts.transpileModule(`${readFileSync(join(root,'desktop/extension/src/extension.ts'),'utf8')}\nexport {FoundationHost};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const hash=value=>createHash('sha256').update(value).digest('hex'),copy=value=>structuredClone(value);
function fixture({group=false}={}) {
 const project={id:'decisions-host',root:'/fixture/decisions',files:[]},before=':root{--radius:8px}\n',after=':root{--radius:12px}\n';
 const d=decisionFixture({projectId:project.id,path:'src/style.css',source:after});
 const files=[{path:'src/style.css',beforeHash:hash(before),afterHash:hash(after)}];
 const record={id:d.choice.comparisonId,status:'completed',logicalProjectId:'comparison',title:'Round save',createdAt:d.createdAt,endedAt:d.createdAt,proposalId:d.choice.sourceId,path:files[0].path,beforeHash:files[0].beforeHash,afterHash:files[0].afterHash,baselineDigest:d.choice.baselineDigest,scope:copy(d.choice.scope),recipe:{...d.choice.recipe,steps:[{id:'save',title:'Save'}]},requested:d.choice.requested,captureEach:false,candidate:{name:'Round save',metadataDigest:'a'.repeat(64),token:{name:'--radius',occurrence:0}},variants:['baseline','alternative'].map((id,index)=>({id,status:'completed',manifestDigest:String(index+1).repeat(64),outcome:{compilation:'not-recorded',assessment:'not-assessed',sourceRelationship:'unverified',observation:{id:d.choice.evidence[index].run.id,status:'completed',assessment:'not-assessed',sources:[{path:files[0].path,revision:files[0][index?'afterHash':'beforeHash']}],observations:[],truncated:false}}}))};
 let proposal={id:d.adoption.id,projectId:project.id,status:'applied',origin:'design',path:files[0].path,before,after,baseRevision:hash(before).slice(0,16),appliedRevision:hash(after).slice(0,16),appliedAt:d.adoption.appliedAt,alternativeBasis:{version:1,comparisonId:record.id,baselineDigest:record.baselineDigest,beforeHash:hash(before),afterHash:hash(after)}},groupState={current:null,versions:[],checkpoints:[],busy:false,storage:{status:'saved'}},readHook,writeHook,evidenceHook;
 const sources=new Map([[files[0].path,after]]),dirty=new Set(),messages=[],disk=new Map(),calls=[];
 if(group){const path='src/App.tsx',first='export const label="Save";',second='export const label="Save profile";';files.push({path,beforeHash:hash(first),afterHash:hash(second)});sources.set(path,second);record.scope.feature.paths.push(path);record.source={kind:'change-set',groupId:d.choice.sourceId,groupRevision:2,groupDigest:'b'.repeat(64),files};delete record.path;delete record.proposalId;delete record.beforeHash;delete record.afterHash;delete record.candidate.token;
  record.variants.forEach((variant,index)=>variant.outcome.observation.sources.push({path,revision:files[1][index?'afterHash':'beforeHash']}));
  proposal=null;groupState={current:{id:d.adoption.id,projectId:project.id,status:'applied',origin:'alternative',revision:3,files:[{path:files[0].path,before,after,baseRevision:hash(before).slice(0,16),appliedRevision:hash(after).slice(0,16)},{path,before:first,after:second,baseRevision:hash(first).slice(0,16),appliedRevision:hash(second).slice(0,16)}],alternativeBasis:{version:2,kind:'change-set',comparisonId:record.id,baselineDigest:record.baselineDigest,sourceGroupId:record.source.groupId,sourceGroupRevision:2,sourceGroupDigest:record.source.groupDigest,files}},versions:[],checkpoints:[{id:'00000000-0000-4000-8000-000000000999',kind:'applied',createdAt:d.adoption.appliedAt}],busy:false,storage:{status:'saved'}};
 }
 const alternativeState={revision:7,storage:{status:'saved'},records:[record],busy:false};
 const alternatives={snapshot:()=>copy(alternativeState),readDecisionEvidence:async(id,revision)=>{calls.push('evidence');assert.equal(id,record.id);assert.equal(revision,7);if(evidenceHook)await evidenceHook();return copy(record);}};
 const vscode={workspace:{isTrusted:true}};const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,URL,AbortController,TextDecoder,structuredClone,setTimeout,clearTimeout,require:name=>name==='vscode'?vscode:name.endsWith('/project-decisions.mjs')?decisions:name.includes('project-decisions-store')?stores:name.startsWith('node:')?require(name):{}});
 const host=Object.create(module.exports.FoundationHost.prototype),key=`${project.id}\0${project.root}`;
 Object.assign(host,{project,disposed:false,featureSourceEpoch:0,context:{workspaceState:{get:key=>copy(disk.get(key)),update:async(key,value)=>{disk.set(key,copy(value));if(writeHook)await writeHook();}}},projectDecisionSources:{projectId:project.id,root:project.root,epoch:0,hashes:new Map([...sources].map(([path,source])=>[path,hash(source)]))},visualAlternativesSessions:new Map([[key,alternatives]]),proposals:()=>({current:()=>copy(proposal)}),changeSetSnapshot:()=>copy(groupState),executionSnapshot:()=>null,featureSnapshot:()=>({activeId:record.scope.feature.id}),features:()=>({snapshot:()=>({features:[record.scope.feature]})}),runtimeWorkspaceStore:()=>({presentation:()=>({snapshot:{}})}),alternativeScopeCurrent:()=>true,decisionScopeCurrent:()=>true,dirtyPaths:()=>[...dirty],service:{getFile:async(_id,path)=>{if(readHook)await readHook(path);const source=sources.get(path);if(source===undefined)throw Error('Missing source');return {path,source,revision:hash(source).slice(0,16)};},getFiles:async(_id,paths)=>({files:paths.flatMap(path=>sources.has(path)?[{path,source:sources.get(path)}]:[]),unavailable:[]})},sendState(){},queueConversationState(){},navigate:async(path,line)=>calls.push({path,line})});
 const action=(extra={})=>{const candidate=host.decisionCandidate();return host.projectDecisionAction({type:'projectDecision',projectId:project.id,action:'record',revision:host.projectDecisionStore().snapshot().revision,candidateId:candidate?.id,candidateDigest:candidate?.digest,title:'Keep clear Save feedback',rationale:'The measured state preserves a clear action.',...extra});};
 return {host,project,record,sources,dirty,calls,disk,vscode,alternatives,alternativeState,groupState,action,get proposal(){return proposal;},set proposal(value){proposal=value;},setRead:value=>readHook=value,setWrite:value=>writeHook=value,setEvidence:value=>evidenceHook=value};
}
for(const group of [false,true])test(`${group?'group':'token'} decision uses applied host evidence; explicit context and Undo keep immutable rationale`,async()=>{
 const h=fixture({group});await h.action({choice:{forged:true},adoption:{forged:true}});const saved=h.host.projectDecisionStore().snapshot(),decision=saved.decisions[0];assert.equal(saved.revision,1);assert.equal(decision.choice.kind,group?'change-set':'token');assert.equal(decision.choice.comparisonDigest,decisions.projectDecisionEvidenceDigest(h.record));assert.equal(decision.contextFiles.length,group?2:1);assert.equal(h.host.projectDecisionsSnapshot().records[0].canShare,true);
 const descriptor=[{id:decision.id,digest:decisions.projectDecisionDigest(decision)}];const context=await h.host.resolveDecisionContext(descriptor);assert.deepEqual(context.decisions[0].decision,decision);assert.deepEqual(await h.host.resolveDecisionContext(context,h.project.id),context);assert.equal(await h.host.resolveDecisionContext(undefined),undefined);
 if(group)h.groupState.current.status='undone';else h.proposal={...h.proposal,status:'undone'};
 assert.equal(h.host.projectDecisionsSnapshot().records[0].status.adoption,'undone');await assert.rejects(h.host.resolveDecisionContext(descriptor));assert.deepEqual(h.host.projectDecisionStore().snapshot().decisions[0],decision);
});
test('record fails closed on stale candidate, history, project, scope, draft and adopted source',async()=>{
 for(const fields of [{projectId:'foreign'},{revision:999},{candidateId:'foreign'},{candidateDigest:'a'.repeat(64)}]){const h=fixture();await assert.rejects(h.action(fields));assert.equal(h.host.projectDecisionStore().snapshot().decisions.length,0);}
 for(const mutate of [h=>h.dirty.add('src/style.css'),h=>h.host.alternativeScopeCurrent=()=>false,h=>h.proposal={...h.proposal,status:'undone'},h=>h.alternativeState.storage.status='unavailable',h=>h.host.asking={},h=>h.sources.set('src/style.css','changed')]){const h=fixture();mutate(h);await assert.rejects(h.action());assert.equal(h.host.projectDecisionStore().snapshot().decisions.length,0);}
});
test('record guards project, trust, epoch, evidence and checkpoint across reads and persistence',async()=>{
 for(const phase of ['read','write','evidence'])for(const mutate of [h=>h.host.featureSourceEpoch++,h=>h.vscode.workspace.isTrusted=false,h=>h.host.project={...h.project,root:'/other'},h=>h.proposal={...h.proposal,status:'undone'}]){const h=fixture();h[phase==='read'?'setRead':phase==='write'?'setWrite':'setEvidence'](()=>mutate(h));await assert.rejects(h.action());assert.equal(h.host.projectDecisionStore(h.project).snapshot().decisions.length,0);}
 const h=fixture();h.setEvidence(()=>h.record.title='Changed metadata');await assert.rejects(h.action());assert.equal(h.host.projectDecisionStore().snapshot().decisions.length,0);
});
test('canonical decision sharing rejects stale, dirty, forged, foreign, superseded and lost evidence',async()=>{
 for(const mutate of [h=>h.sources.set('src/style.css','stale'),h=>h.dirty.add('src/style.css'),h=>h.host.featureSnapshot=()=>({activeId:'other'}),h=>h.host.decisionScopeCurrent=()=>false,h=>h.setEvidence(()=>h.record.title='tampered')]){const h=fixture();await h.action();const decision=h.host.projectDecisionStore().snapshot().decisions[0];mutate(h);await assert.rejects(h.host.resolveDecisionContext([{id:decision.id,digest:decisions.projectDecisionDigest(decision)}]));}
 const h=fixture();await h.action();const original=h.host.projectDecisionStore().snapshot().decisions[0];await assert.rejects(h.host.resolveDecisionContext([{id:original.id,digest:'0'.repeat(64)}]));await assert.rejects(h.host.resolveDecisionContext([{id:original.id,digest:decisions.projectDecisionDigest(original)}],'foreign'));
 const context=await h.host.resolveDecisionContext([{id:original.id,digest:decisions.projectDecisionDigest(original)}]);context.decisions[0].decision.rationale='forged';await assert.rejects(h.host.resolveDecisionContext(context));await h.action({supersedesId:original.id,rationale:'A clearer reason for retaining the same choice.'});assert.equal(h.host.projectDecisionsSnapshot().records[0].canShare,false);assert.ok(h.host.projectDecisionsSnapshot().records[0].status.supersededBy);assert.equal(h.host.projectDecisionStore().snapshot().decisions[0].rationale,original.rationale);
});
test('source projection distinguishes missing and changed; navigation only opens linked paths',async()=>{
 const h=fixture();await h.action();const decision=h.host.projectDecisionStore().snapshot().decisions[0];h.sources.set('src/style.css','changed');await h.host.refreshProjectDecisions();assert.equal(h.host.projectDecisionsSnapshot().records[0].status.source,'stale');h.sources.clear();await h.host.refreshProjectDecisions();assert.equal(h.host.projectDecisionsSnapshot().records[0].status.source,'missing');
 await h.action({action:'navigate',decisionId:decision.id,path:'src/style.css'});assert.deepEqual(h.calls.at(-1),{path:'src/style.css',line:1});await assert.rejects(h.action({action:'navigate',decisionId:decision.id,path:'private.env'}));
});

test('many unrelated drafts do not break the decision projection',async()=>{const h=fixture();await h.action();for(let n=0;n<80;n++)h.dirty.add(`src/Other${n}.tsx`);assert.equal(h.host.projectDecisionsSnapshot().records[0].canShare,true);});

test('view comparison resolves exact historical evidence without source or runtime effects',async()=>{const h=fixture();await h.action();const decision=h.host.projectDecisionStore().snapshot().decisions[0],messages=[];h.host.show=async mode=>messages.push(mode);h.host.panel={webview:{postMessage:async message=>messages.push(copy(message))}};await h.action({action:'viewComparison',decisionId:decision.id});assert.equal(messages[0],'Review');assert.equal(messages[1].comparisonId,decision.choice.comparisonId);h.setEvidence(()=>h.record.title='tampered');await assert.rejects(h.action({action:'viewComparison',decisionId:decision.id}));assert.equal(messages.length,2);});

test('token adoption rejects changed provenance or bytes behind matching historical IDs',async()=>{
 const mutations=[
  proposal=>proposal.projectId='foreign',proposal=>proposal.origin='ai',proposal=>proposal.path='src/other.css',
  proposal=>proposal.before+=' changed',proposal=>proposal.after+=' changed',proposal=>proposal.baseRevision='0'.repeat(16),proposal=>proposal.appliedRevision='0'.repeat(16),
  proposal=>proposal.appliedAt='2026-11-01T12:00:01.000Z',proposal=>proposal.alternativeBasis.version=2,
  proposal=>proposal.alternativeBasis.baselineDigest='0'.repeat(64),proposal=>proposal.alternativeBasis.beforeHash='0'.repeat(64),proposal=>proposal.alternativeBasis.afterHash='0'.repeat(64),
 ];
 for(const mutate of mutations){const h=fixture();await h.action();const decision=h.host.projectDecisionStore().snapshot().decisions[0],proposal=copy(h.proposal);mutate(proposal);h.proposal=proposal;assert.equal(h.host.decisionAdoptionStatus(decision),'missing');assert.equal(h.host.projectDecisionsSnapshot().records[0].canShare,false);await assert.rejects(h.host.resolveDecisionContext([{id:decision.id,digest:decisions.projectDecisionDigest(decision)}]));assert.deepEqual(h.host.projectDecisionStore().snapshot().decisions[0],decision);}
});

test('group adoption rejects changed checkpoint, source group, membership or bytes behind matching IDs',async()=>{
 const mutations=[
  state=>state.storage.status='error',state=>state.current.projectId='foreign',state=>state.current.origin='ai',state=>state.current.revision--,
  state=>state.checkpoints[0].createdAt='2026-11-01T12:00:01.000Z',state=>state.checkpoints[0].kind='recovered',
  state=>state.current.alternativeBasis.version=1,state=>state.current.alternativeBasis.kind='token',
  state=>state.current.alternativeBasis.baselineDigest='0'.repeat(64),state=>state.current.alternativeBasis.sourceGroupId='00000000-0000-4000-8000-000000000998',
  state=>state.current.alternativeBasis.sourceGroupRevision++,state=>state.current.alternativeBasis.sourceGroupDigest='0'.repeat(64),
  state=>state.current.alternativeBasis.files[0].beforeHash='0'.repeat(64),state=>state.current.alternativeBasis.files[0].afterHash='0'.repeat(64),
  state=>state.current.files.pop(),state=>state.current.files[1]=copy(state.current.files[0]),state=>state.current.files[0].before+=' changed',state=>state.current.files[0].after+=' changed',
  state=>state.current.files[0].baseRevision='0'.repeat(16),state=>state.current.files[0].appliedRevision='0'.repeat(16),
 ];
 for(const mutate of mutations){const h=fixture({group:true});await h.action();const decision=h.host.projectDecisionStore().snapshot().decisions[0];mutate(h.groupState);assert.equal(h.host.decisionAdoptionStatus(decision),'missing');assert.equal(h.host.projectDecisionsSnapshot().records[0].canShare,false);await assert.rejects(h.host.resolveDecisionContext([{id:decision.id,digest:decisions.projectDecisionDigest(decision)}]));assert.deepEqual(h.host.projectDecisionStore().snapshot().decisions[0],decision);}
});

test('historical whole-group Undo retains its exact adoption when another group is active',async()=>{
 const h=fixture({group:true});await h.action();const decision=h.host.projectDecisionStore().snapshot().decisions[0],old=copy(h.groupState.current),checkpoints=copy(h.groupState.checkpoints);
 old.status='undone';old.revision+=2;checkpoints.push({id:'00000000-0000-4000-8000-000000000997',kind:'undone',createdAt:'2026-11-01T12:00:01.000Z'});
 h.groupState.versions=[{group:old,checkpoints,acceptance:null}];h.groupState.current={id:'00000000-0000-4000-8000-000000000996',status:'proposed'};h.groupState.checkpoints=[];
 assert.equal(h.host.decisionAdoptionStatus(decision),'undone');assert.equal(h.host.projectDecisionsSnapshot().records[0].status.adoption,'undone');assert.equal(h.host.projectDecisionsSnapshot().records[0].canShare,false);assert.deepEqual(h.host.projectDecisionStore().snapshot().decisions[0],decision);
 h.groupState.versions[0].checkpoints[0].createdAt='2026-11-01T12:00:02.000Z';assert.equal(h.host.decisionAdoptionStatus(decision),'missing');
});

test('project-wide decision discovery preserves freshness but blocks sharing outside the active feature',async()=>{
 const h=fixture();await h.action();const decision=h.host.projectDecisionStore().snapshot().decisions[0];
 const original=h.host.featureSnapshot;h.host.featureSnapshot=()=>({activeId:'another-feature'});
 const view=h.host.projectDecisionsSnapshot(),item=view.records.find(item=>item.record.id===decision.id);
 assert.equal(item.status.source,'current');assert.equal(item.status.scope,'current');assert.equal(item.status.adoption,'applied');
 assert.equal(item.canShare,false);assert.match(item.reason,/feature/i);
 await assert.rejects(h.host.resolveDecisionContext([{id:decision.id,digest:decisions.projectDecisionDigest(decision)}]));
 assert.deepEqual(h.host.projectDecisionStore().snapshot().decisions[0],decision);
 h.host.featureSnapshot=original;assert.equal(h.host.projectDecisionsSnapshot().records[0].canShare,true);
});
