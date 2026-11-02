import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import vm from 'node:vm';
import * as issues from '../../../server/project/reproducible-issues.mjs';
import * as stores from '../src/reproducible-issues-store.mjs';
import {reproducibleIssueFixture} from '../../../tests/helpers/reproducible-issue-fixture.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),require=createRequire(join(root,'package.json')),ts=require('typescript');
const compiled=ts.transpileModule(`${readFileSync(join(root,'desktop/extension/src/extension.ts'),'utf8')}\nexport {FoundationHost};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const hash=value=>createHash('sha256').update(value).digest('hex'),copy=value=>structuredClone(value);
function fixture(){
 const project={id:'issues-host',root:'/fixture/issues'},issue=reproducibleIssueFixture({projectId:project.id});
 const workspace={revision:7,storage:{status:'saved'},runs:[copy(issue.run)]},replay={revision:3,storage:{status:'saved'},replays:[copy(issue.replay.replay)]},capture={revision:1,storage:{status:'saved'},captures:[copy(issue.capture.capture)]};
 const sources=new Map(issue.contextFiles.map(file=>[file.path,file.path])),dirty=new Set(),disk=new Map(),calls=[];
 let readHook,writeHook;
 const vscode={workspace:{isTrusted:true}},module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,URL,AbortController,TextDecoder,structuredClone,setTimeout,clearTimeout,require:name=>name==='vscode'?vscode:name.endsWith('/reproducible-issues.mjs')?issues:name.includes('reproducible-issues-store')?stores:name.startsWith('node:')?require(name):{}});
 const host=Object.create(module.exports.FoundationHost.prototype);
 const tiny=value=>({revision:value.revision,storageStatus:value.storage.status});
 Object.assign(host,{project,disposed:false,featureSourceEpoch:0,context:{workspaceState:{get:key=>copy(disk.get(key)),update:async(key,value)=>{disk.set(key,copy(value));if(writeHook)await writeHook();}}},
  reproducibleIssueSources:{projectId:project.id,root:project.root,epoch:0,hashes:new Map([...sources].map(([path,source])=>[path,hash(source)]))},
  runtimeWorkspaceStore:()=>({presentation:()=>({snapshot:copy(workspace),epoch:workspace.revision})}),runtimeReplayStore:()=>({snapshot:()=>copy(replay),state:()=>tiny(replay)}),runtimeCaptureStorage:()=>({store:{snapshot:()=>copy(capture),state:()=>tiny(capture)}}),
  featureSnapshot:()=>({activeId:issue.run.feature.id}),dirtyPaths:()=>[...dirty],alternativeWorkBusy:()=>false,alternativesBusy:()=>false,
  service:{getFiles:async(_id,paths,options)=>{calls.push('sources');options?.isCurrent?.();if(readHook)await readHook();return {files:paths.flatMap(path=>sources.has(path)?[{path,source:sources.get(path)}]:[]),unavailable:paths.filter(path=>!sources.has(path))};}},
  sendState(){},queueConversationState(){},navigate:async(path,line)=>calls.push({path,line}),show:async mode=>calls.push(mode),panel:{webview:{postMessage:async message=>calls.push(copy(message))}}});
 const action=(extra={})=>host.reproducibleIssueAction({projectId:project.id,action:'record',revision:host.reproducibleIssuesStore().snapshot().revision,runId:issue.run.id,runDigest:issues.reproducibleIssueEvidenceDigest(workspace.runs[0]),title:issue.title,actualOutcome:issue.actualOutcome,...extra});
 const descriptor=()=>{const record=host.reproducibleIssuesStore().snapshot().issues[0];return [{id:record.id,digest:issues.reproducibleIssueDigest(record),assessment:host.issueAssessment(record,host.issueEvidence())}];};
 return {host,project,issue,workspace,replay,capture,sources,dirty,disk,calls,vscode,action,descriptor,setRead:fn=>readHook=fn,setWrite:fn=>writeHook=fn};
}
test('capture freezes exact host evidence and explicit context; author cannot replace source, requests or screenshot',async()=>{
 const h=fixture();await h.action({run:{forged:true},contextFiles:[{path:'private.env',hash:'0'.repeat(64)}]});
 const record=h.host.reproducibleIssuesStore().snapshot().issues[0];assert.deepEqual(record.run,h.issue.run);assert.deepEqual(record.reproduction,h.issue.reproduction);assert.deepEqual(record.capture,h.issue.capture);assert.deepEqual(record.replay,h.issue.replay);assert.deepEqual(record.contextFiles,h.issue.contextFiles);
 const context=await h.host.resolveIssueContext(h.descriptor());assert.deepEqual(context.issues[0].issue,record);assert.equal(context.issues[0].assessment.source,'current');assert.deepEqual(await h.host.resolveIssueContext(context,h.project.id),context);assert.equal(await h.host.resolveIssueContext(undefined),undefined);
 assert.deepEqual(h.calls,['sources','sources','sources','sources']);
});
test('historical failure stays immutable and shareable with changed, dirty, missing source and absent original metadata',async()=>{
 const h=fixture();await h.action();const record=h.host.reproducibleIssuesStore().snapshot().issues[0];
 h.sources.set('src/App.tsx','changed');h.dirty.add('src/style.css');await h.host.refreshReproducibleIssues();let context=await h.host.resolveIssueContext(h.descriptor());assert.equal(context.issues[0].assessment.source,'stale');assert.equal(context.issues[0].assessment.captureSource,'stale');
 h.sources.clear();h.workspace.runs=[];h.workspace.revision++;h.replay.replays=[];h.replay.revision++;h.capture.captures=[];h.capture.revision++;await h.host.refreshReproducibleIssues();context=await h.host.resolveIssueContext(h.descriptor());assert.equal(context.issues[0].assessment.source,'missing');assert.equal(context.issues[0].assessment.run,'missing');assert.equal(context.issues[0].assessment.capture,'missing');assert.equal(context.issues[0].assessment.replay,'missing');assert.deepEqual(h.host.reproducibleIssuesStore().snapshot().issues[0],record);
});
test('historical run capture retains distinct original and capture-time hashes',async()=>{const h=fixture();h.sources.set('src/App.tsx','changed since run');await h.action();const record=h.host.reproducibleIssuesStore().snapshot().issues[0];assert.equal(record.run.sources[0].revision,hash('src/App.tsx'));assert.equal(record.contextFiles[0].hash,hash('changed since run'));const context=await h.host.resolveIssueContext(h.descriptor());assert.equal(context.issues[0].assessment.source,'stale');assert.equal(context.issues[0].assessment.captureSource,'current');});
test('capture rejects active, stale, foreign, dirty, missing or changed ownership without touching saved history',async()=>{
 for(const extra of [{projectId:'foreign'},{revision:9},{runId:'foreign'},{runDigest:'0'.repeat(64)}]){const h=fixture();await assert.rejects(h.action(extra));assert.equal(h.host.reproducibleIssuesStore().snapshot().issues.length,0);}
 for(const mutate of [h=>h.workspace.runs[0].status='recording',h=>h.dirty.add('src/App.tsx'),h=>h.sources.clear(),h=>h.workspace.storage.status='error',h=>h.replay.storage.status='unavailable',h=>h.capture.storage.status='error',h=>h.replay.replays[0].status='running']){const h=fixture();mutate(h);await assert.rejects(h.action());assert.equal(h.host.reproducibleIssuesStore().snapshot().issues.length,0);}
 for(const phase of ['setRead','setWrite'])for(const mutate of [h=>h.host.featureSourceEpoch++,h=>h.vscode.workspace.isTrusted=false,h=>h.host.project={...h.project,root:'/other'},h=>h.workspace.revision++,h=>h.replay.revision++,h=>h.capture.revision++,h=>h.dirty.add('src/App.tsx')]){const h=fixture();h[phase](()=>mutate(h));await assert.rejects(h.action());assert.equal(h.host.reproducibleIssuesStore(h.project).snapshot().issues.length,0);}
});
test('context revalidation rejects changed assessment, forged record, trust and feature races',async()=>{
 const h=fixture();await h.action();const selected=h.descriptor(),context=await h.host.resolveIssueContext(selected);h.sources.set('src/App.tsx','changed');await assert.rejects(h.host.resolveIssueContext(context));await assert.rejects(h.host.resolveIssueContext(selected));
 await h.host.refreshReproducibleIssues();const historical=await h.host.resolveIssueContext(h.descriptor());historical.issues[0].issue.actualOutcome='Forged';await assert.rejects(h.host.resolveIssueContext(historical));
 await assert.rejects(h.host.resolveIssueContext([{...h.descriptor()[0],digest:'0'.repeat(64)}]));await assert.rejects(h.host.resolveIssueContext(h.descriptor(),'foreign'));
 h.setRead(()=>h.vscode.workspace.isTrusted=false);await assert.rejects(h.host.resolveIssueContext(h.descriptor()));
});
test('navigation opens only linked source; original evidence lookup does not run, capture or contact a provider',async()=>{
 const h=fixture();await h.action();const record=h.host.reproducibleIssuesStore().snapshot().issues[0];await h.action({action:'navigate',issueId:record.id,path:'src/App.tsx'});assert.deepEqual(h.calls.at(-1),{path:'src/App.tsx',line:1});await assert.rejects(h.action({action:'navigate',issueId:record.id,path:'private.env'}));
 await h.action({action:'viewEvidence',issueId:record.id});assert.equal(h.calls.at(-2),'Understand');assert.equal(h.calls.at(-1).runId,record.run.id);assert.equal(h.calls.at(-1).captureId,record.capture.capture.id);h.workspace.runs[0].note='Changed';await assert.rejects(h.action({action:'viewEvidence',issueId:record.id}));
});
test('projection is reused with stable evidence and invalidated by source, storage and history changes',async()=>{
 const h=fixture();await h.action();const one=h.host.reproducibleIssuesSnapshot();assert.equal(h.host.reproducibleIssuesSnapshot(),one);h.sources.set('src/App.tsx','changed');await h.host.refreshReproducibleIssues();const two=h.host.reproducibleIssuesSnapshot();assert.notEqual(two,one);assert.equal(two.records[0].status.source,'stale');h.capture.storage.status='unavailable';const three=h.host.reproducibleIssuesSnapshot();assert.notEqual(three,two);assert.equal(three.records[0].status.capture,'missing');
});
test('display-cache capacity cannot block explicit capture; canonical batch remains authoritative',async()=>{const h=fixture();h.host.reproducibleIssueSources.hashes.clear();assert.equal(h.host.reproducibleIssuesSnapshot().candidates[0].canRecord,true);await h.action();assert.equal(h.host.reproducibleIssuesStore().snapshot().issues.length,1);});

test('another feature cannot advertise an issue as ready to share',async()=>{const h=fixture();await h.action();h.host.featureSnapshot=()=>({activeId:'another-feature'});const view=h.host.reproducibleIssuesSnapshot();assert.equal(view.records[0].canShare,false);assert.match(view.records[0].reason,/feature/);await assert.rejects(h.host.resolveIssueContext(h.descriptor()));});
test('source-scan ownership guards never clone replay or capture histories per file',async()=>{const h=fixture();let clones=0;for(const name of ['runtimeReplayStore','runtimeCaptureStorage']){const original=h.host[name];h.host[name]=(...args)=>{const entry=original(...args),store=entry.store||entry,snapshot=store.snapshot;store.snapshot=()=>{clones++;return snapshot();};return entry;};}const getFiles=h.host.service.getFiles;h.host.service.getFiles=async(id,paths,options)=>{for(let n=0;n<2000;n++)assert.equal(options.isCurrent(),true);return getFiles(id,paths,options);};await h.action();assert.ok(clones<20,`Only boundary snapshots are allowed, got ${clones}`);});

test('successful issue-storage retry clears the recovered error without recapturing',async()=>{const h=fixture();await assert.rejects(h.action({runDigest:'0'.repeat(64)}));assert.ok(h.host.reproducibleIssueError);await h.action({action:'retry'});assert.equal(h.host.reproducibleIssueError,undefined);assert.equal(h.host.reproducibleIssuesStore().snapshot().issues.length,0);});
test('explicit context refresh prioritizes the selected issue beyond the bounded display cache',async()=>{const h=fixture();await h.action();const store=h.host.reproducibleIssuesStore(),saved=store.presentation().snapshot,record=saved.issues[0],historical=Array.from({length:7},(_,n)=>({id:`prior-${n}`,run:{feature:{id:record.run.feature.id}},contextFiles:Array.from({length:32},(_,i)=>({path:`src/prior-${n}-${i}.tsx`,hash:hash('old')}))}));h.host.reproducibleIssuesStore=()=>({...store,presentation:()=>({snapshot:{...saved,issues:[...historical,record]},epoch:12})});h.host.reproducibleIssueSources.hashes.clear();let batch;const original=h.host.service.getFiles;h.host.service.getFiles=async(id,paths,options)=>{batch=paths;return original(id,paths,options);};await h.action({action:'refreshContext',issueId:record.id,digest:issues.reproducibleIssueDigest(record)});assert.deepEqual([...batch.slice(0,2)],record.contextFiles.map(file=>file.path));assert.equal(batch.length,192);assert.equal(h.host.issueSourceHash('src/App.tsx'),hash('src/App.tsx'));assert.equal(h.host.reproducibleIssueBusy,undefined);});

test('original evidence reveal rejects feature changes while opening the workspace',async()=>{const h=fixture();await h.action();const record=h.host.reproducibleIssuesStore().snapshot().issues[0];h.host.show=async()=>{h.host.featureSnapshot=()=>({activeId:'another-feature'});};const before=h.calls.length;await assert.rejects(h.action({action:'viewEvidence',issueId:record.id}));assert.equal(h.calls.length,before);});


test('original evidence reveal refuses replaced or unavailable attached replay and capture metadata',async()=>{
 for(const phase of ['before-open','during-open'])for(const kind of ['capture-changed','capture-missing','capture-storage','replay-changed','replay-missing','replay-storage']){
  const h=fixture();await h.action();const record=h.host.reproducibleIssuesStore().snapshot().issues[0],before=h.calls.length;
  const mutate=()=>{
   if(kind==='capture-changed')h.capture.captures[0].image.sha256='a'.repeat(64);
   if(kind==='capture-missing')h.capture.captures=[];
   if(kind==='capture-storage')h.capture.storage.status='unavailable';
   if(kind==='replay-changed')h.replay.replays[0].reason='A different replay result';
   if(kind==='replay-missing')h.replay.replays=[];
   if(kind==='replay-storage')h.replay.storage.status='error';
  };
  if(phase==='before-open')mutate();else h.host.show=async()=>mutate();
  await assert.rejects(h.action({action:'viewEvidence',issueId:record.id}),/original.*(evidence|observation)|attached/i,`${phase}: ${kind}`);
  assert.equal(h.calls.slice(before).some(item=>item?.type==='revealIssueEvidence'),false,`${phase}: ${kind}`);
  assert.deepEqual(h.host.reproducibleIssuesStore().snapshot().issues[0],record);
 }
});
