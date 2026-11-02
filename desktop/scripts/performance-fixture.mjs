import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createConversationStore} from '../extension/src/conversation-store.mjs';
import {createRuntimeWorkspaceStore} from '../extension/src/runtime-workspace-store.mjs';
import {createFeatureStore} from '../extension/src/feature-store.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const uuid=index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const at='2026-01-01T00:00:00.000Z';
export const performanceProfiles=Object.freeze({
 standard:{name:'standard',corpusFiles:400,corpusLines:128,heavyFiles:0,heavyBytes:0,history:false,phaseKeys:{warmup:160,idle:160,'ai-stream':160,'index-runtime':160,combined:160}},
 scale:{name:'scale',corpusFiles:1400,corpusLines:16,heavyFiles:8,heavyBytes:192*1024,history:true,phaseKeys:{warmup:160,idle:600,'ai-stream':600,'index-runtime':600,'combined-1':600,'combined-2':600,'combined-3':600,'combined-4':600}},
});

/** Synthetic, offline test history. Validation uses the production store readers. */
export async function createPerformanceHistory(projectId,sources){
 assert.equal(sources.length,32);assert.equal(sources[0].path,'src/App.tsx');
 const feature={id:uuid(1),title:'Synthetic performance history',brief:'Generated local test data. Historical requests and responses were not observed from a running product.',paths:sources.map(s=>s.path),entryPath:'src/App.tsx',archived:false,createdAt:at,updatedAt:at};
 const features={schemaVersion:1,projectId,revision:1,activeId:feature.id,features:[feature]};
 let template;
 const temporary=createConversationStore({projectId,read:()=>undefined,write:async value=>{template=value;}});
 await temporary.startTurn({requestId:'synthetic-template',prompt:'Synthetic performance fixture history. No provider was called.',intent:'ask',model:'synthetic-offline-fixture',context:[{path:sources[0].path,source:sources[0].source,revision:hash(sources[0].source).slice(0,16)}]});
 temporary.event('synthetic-template',{type:'start'});temporary.event('synthetic-template',{type:'delta',text:'Synthetic historical answer. No provider or verification was run.\n'+ 'Fixture history text for rendering and storage measurement. '.repeat(580)});temporary.event('synthetic-template',{type:'done'});await temporary.flush();await temporary.dispose();
 const turn=JSON.parse(JSON.stringify(template.conversations[0].turns[0]).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g,at));
 const conversations={schemaVersion:8,projectId,revision:100,activeId:'synthetic-conversation-9',conversations:Array.from({length:10},(_,c)=>({id:`synthetic-conversation-${c}`,title:`Synthetic history ${c+1}`,createdAt:at,updatedAt:at,archived:false,turns:Array.from({length:10},(_,n)=>({...structuredClone(turn),id:`synthetic-${c}-${n}`,requestId:`synthetic-${c}-${n}`,createdAt:at,updatedAt:at}))}))};
 const screen={id:uuid(2),featureId:feature.id,title:'Synthetic historical screen',targetId:'vite:dev',route:'/',archived:false,createdAt:at,updatedAt:at};
 const scenario={id:uuid(3),screenId:screen.id,title:'Synthetic historical scenario',steps:['Generated fixture only; no interaction was observed.'],expectedOutcome:'Measure retained-history cost without claiming real observations.',archived:false,createdAt:at,updatedAt:at};
 const runtime={targetId:'vite:dev',session:'a'.repeat(32),viewId:'b'.repeat(32),documentId:'c'.repeat(32),route:'/',pageVersion:1};
 const runtimeWorkspace={schemaVersion:1,projectId,revision:42,activeScreenId:screen.id,activeScenarioId:scenario.id,screens:[screen],scenarios:[scenario],runs:Array.from({length:40},(_,n)=>({id:uuid(100+n),feature:{id:feature.id,title:feature.title,revision:1,paths:feature.paths},screen,scenario,definitionRevision:2,runtime,sources:sources.map(s=>({path:s.path,revision:hash(s.source)})),dirtyPaths:[],startedAt:at,endedAt:at,status:'completed',assessment:'not-assessed',note:'SYNTHETIC OFFLINE TEST FIXTURE. These request records were generated, not observed. No interaction or visual verification performed.',observations:Array.from({length:100},(_,i)=>({id:`${runtime.session}:${runtime.viewId}:${n}-${i}`,session:runtime.session,documentId:runtime.documentId,kind:'request',method:'POST',url:'http://127.0.0.1:5173/synthetic-fixture',status:200,durationMs:18,outcome:'success',observedAt:at,timing:'response-headers',correlation:'unattributed'})),truncated:false}))};
 for(const [factory,data]of [[createFeatureStore,features],[createConversationStore,conversations],[createRuntimeWorkspaceStore,runtimeWorkspace]]){
  const store=factory({projectId,read:()=>data,write:async()=>{throw Error('Valid historical seeds require no recovery write');}});
  assert.equal(store.snapshot().storage.status,'saved');await store.dispose();
 }
 const state={['foundation.features.'+projectId]:features,['foundation.conversations.'+projectId]:conversations,['foundation.runtime-workspaces.'+projectId]:runtimeWorkspace};
 const summary={synthetic:true,conversations:10,turns:100,conversationBytes:Buffer.byteLength(JSON.stringify(conversations)),runtimeRuns:40,runtimeObservations:4000,runtimeBytes:Buffer.byteLength(JSON.stringify(runtimeWorkspace)),featureSources:32,featureSourceBytes:sources.reduce((n,s)=>n+Buffer.byteLength(s.source),0)};
 assert.ok(summary.featureSourceBytes<=256*1024,'All recorded feature sources must fit the native loaded-context cap');assert.ok(summary.conversationBytes<8*1024*1024);assert.ok(summary.runtimeBytes<8*1024*1024);
 return{state,summary};
}

export async function seedPerformanceHistory(workspace,userData){
 assert.ok(workspace.startsWith('/private/tmp/foundation-editor-performance-')&&path.resolve(workspace)===workspace&&path.basename(workspace)==='workspace');
 assert.equal(userData,path.join(path.dirname(workspace),'user-data'),'History may only seed the sibling disposable user-data directory');
 const projectId=`project-${hash(workspace).slice(0,16)}`;
 const names=['src/App.tsx','src/heavy/source-0.ts',...Array.from({length:30},(_,i)=>`src/corpus/file-${String(i).padStart(3,'0')}.ts`)];
 const sources=await Promise.all(names.map(async name=>({path:name,source:await readFile(path.join(workspace,name),'utf8')})));
 const {state,summary}=await createPerformanceHistory(projectId,sources);
 const folderStat=await stat(workspace),id=createHash('md5').update(workspace).update(String(folderStat.birthtime.getTime())).digest('hex');
 const directory=path.join(userData,'User/workspaceStorage',id);await mkdir(directory,{recursive:true});
 await writeFile(path.join(directory,'workspace.json'),JSON.stringify({folder:pathToFileURL(workspace).href}));
 const seedFile=path.join(path.dirname(workspace),'synthetic-history-seed.json');await writeFile(seedFile,JSON.stringify(state));
 // Test-only, offline database. Never open or modify a running/normal profile.
 await promisify(execFile)('python3',['-c',`import json,sqlite3,sys,pathlib\np=pathlib.Path(sys.argv[1]);assert not p.exists();c=sqlite3.connect(p);c.execute('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');c.execute('INSERT INTO ItemTable (key,value) VALUES (?,?)',('foundation.foundation-workspace',pathlib.Path(sys.argv[2]).read_text()));c.commit();c.close()`,path.join(directory,'state.vscdb'),seedFile]);
 return{...summary,projectId,workspaceStorageId:id,normalizedFingerprint:hash(JSON.stringify(state).replaceAll(projectId,'PROJECT_ID'))};
}
