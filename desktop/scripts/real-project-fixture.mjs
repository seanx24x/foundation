import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {lstat,open,readFile,writeFile,mkdir,readdir,realpath,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createProjectService} from '../../server/project/workspace.mjs';
import {createConversationStore} from '../extension/src/conversation-store.mjs';
import {createFeatureStore} from '../extension/src/feature-store.mjs';
import {createRuntimeWorkspaceStore} from '../extension/src/runtime-workspace-store.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const roots=['src','server','desktop/extension/src','desktop/extension/media','desktop/extension/themes','desktop/runtime','desktop/scripts','desktop/tests','desktop/extension/test','tests','fixtures','projects/orbit','docs'];
const rootFiles=['.gitignore','README.md','package.json','package-lock.json','tsconfig.json','vite.config.ts','playwright.config.ts','index.html','project-preview.html','desktop/extension/package.json','desktop/extension/tsconfig.json','desktop/upstream.json'];
const textExtensions=new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.mts','.css','.json','.md','.svg','.html','.txt']);
const sensitive=/^(?:credentials?|secrets?|passwords?|id_rsa|id_ed25519|access[-_]?token|auth[-_]?token|refresh[-_]?token)(?:[._-]|$)|^tokens?\.(?:json|ya?ml|txt|toml)$/i;
const excludedDirectories=new Set(['node_modules','artifacts','dist','build','out','coverage','test-results','playwright-report']);
export const realProjectPaths=Object.freeze({typingPath:'src/components/SourceEditor.tsx',unrelatedPath:'server/project/provider-adapters.mjs',sourcePath:'src/project/ProjectPreview.tsx',featurePaths:[
 'src/project/ProjectPreview.tsx','src/project/preview-entry.tsx','src/project/preview.css','src/project/types.ts','src/components/FixtureBoundary.tsx','src/components/DiffViewer.tsx','src/domain/contracts.ts',
 'server/project/workspace.mjs','server/project/relationships.mjs','server/project/source-investigation.mjs','desktop/extension/src/design-preview.mjs','desktop/extension/src/connected-runtime.mjs','desktop/extension/src/runtime-workspace-store.mjs','desktop/extension/src/feature-store.mjs','desktop/runtime/client.mjs','desktop/runtime/vite-plugin.mjs',
]});

async function safeBytes(root,relative){
 let full=root;
 for(const part of relative.split('/')){assert.ok(part&&part!=='.'&&part!=='..');full=path.join(full,part);const info=await lstat(full);assert.ok(!info.isSymbolicLink(),`Symbolic link rejected: ${relative}`);}
 const handle=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await handle.stat();assert.ok(before.isFile()&&before.size<=2*1024*1024,`Not a bounded source file: ${relative}`);const bytes=await handle.readFile();const after=await handle.stat();assert.equal(before.size,after.size,`Source changed while reading: ${relative}`);assert.equal(before.mtimeMs,after.mtimeMs,`Source changed while reading: ${relative}`);assert.equal(bytes.length,before.size);assert.ok(!bytes.includes(0),`Binary source rejected: ${relative}`);new TextDecoder('utf-8',{fatal:true}).decode(bytes);return bytes;}finally{await handle.close();}
}

/** Copies saved maintained source, never working buffers, arbitrary folders or project settings. */
export async function snapshotMaintainedSource({repo,workspace}){
 repo=await realpath(repo);assert.equal(path.resolve(workspace),workspace);assert.match(workspace,/^\/private\/tmp\/foundation-editor-endurance-[^/]+\/workspace$/);
 await mkdir(workspace,{recursive:false});const candidates=[],excluded=[];
 async function walk(relative){
  const full=path.join(repo,relative),info=await lstat(full).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!info)return;
  assert.ok(!info.isSymbolicLink(),`Symbolic link rejected: ${relative}`);
  const name=path.basename(relative);
  if(name.startsWith('.')||sensitive.test(name)||excludedDirectories.has(name)){excluded.push({path:relative,reason:'hidden, sensitive-name or generated boundary'});return;}
  if(info.isDirectory()){for(const entry of (await readdir(full)).sort())await walk(`${relative}/${entry}`);}
  else if(info.isFile()&&textExtensions.has(path.extname(name))){candidates.push(relative);}
  else excluded.push({path:relative,reason:'not an allowed UTF-8 source extension'});
 }
 for(const root of roots)await walk(root);
 for(const name of rootFiles){const info=await lstat(path.join(repo,name)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info){assert.ok(info.isFile()&&!info.isSymbolicLink(),`Non-regular explicit source rejected: ${name}`);candidates.push(name);}}
 const names=[...new Set(candidates)].sort();let ignored=[];
 // Include untracked maintained source. Git HEAD alone cannot identify this working tree.
 // execFile has no stdin option; use a bounded spawned process for the explicit path list.
 const {spawn}=await import('node:child_process');
 ignored=await new Promise((resolve,reject)=>{const child=spawn('git',['check-ignore','-z','--stdin'],{cwd:repo,stdio:['pipe','pipe','pipe']});let output='',error='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);child.once('error',reject);child.once('close',code=>code===0||code===1?resolve(output?output.split('\0').filter(Boolean):[]):reject(Error(`Cannot establish ignored-source boundary: ${error}`)));child.stdin.end(names.join('\0')+'\0');});
 const ignoredSet=new Set(ignored);for(const name of ignored)excluded.push({path:name,reason:'Git ignored'});
 const files=[];
 for(const name of names.filter(name=>!ignoredSet.has(name))){const bytes=await safeBytes(repo,name),destination=path.join(workspace,name);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes,{flag:'wx'});files.push({path:name,bytes:bytes.length,sha256:hash(bytes)});}
 assert.ok(files.length>0);assert.ok(files.reduce((sum,file)=>sum+file.bytes,0)<8*1024*1024,'Maintained snapshot exceeds the bounded project inventory budget');
 for(const file of files)assert.equal(hash(await safeBytes(repo,file.path)),file.sha256,`Source changed during snapshot: ${file.path}`);
 const project=await createProjectService({root:workspace}).open(workspace),indexed=new Set(project.files.map(file=>file.path));
 const omissions=files.filter(file=>file.path!=='.gitignore'&&!indexed.has(file.path)).map(file=>({...file,reason:file.bytes>256*1024?'exceeds current 256 KiB file limit':path.extname(file.path)==='.mts'?'current adapter does not index .mts files':'outside current adapter source extensions or ignore policy'}));
 assert.ok(omissions.every(file=>file.bytes>256*1024||path.extname(file.path)==='.mts'),'Unexpected maintained source omitted by the current adapter');
 const manifest={schema:1,kind:'maintained-source-snapshot',sourceRoot:repo,workspace,createdAt:new Date().toISOString(),files,excluded:excluded.sort((a,b)=>a.path.localeCompare(b.path)),fingerprint:hash(JSON.stringify(files)),copiedFiles:files.length,copiedBytes:files.reduce((sum,file)=>sum+file.bytes,0),omissions,coverage:{indexedPaths:project.files.map(file=>file.path),files:project.files.length,bytes:project.files.reduce((sum,file)=>sum+file.size,0),truncated:project.truncated},provenance:'Exact saved file bytes, including maintained untracked source. Git HEAD is not the source revision. No unsaved buffer, credential file, generated build, node_modules, .vscode settings or symlink is copied.',dependencies:'Existing local node_modules copied separately; canonical dependencies remain untouched and no install or network fetch occurs. Dependencies are not maintained-source provenance.',sidecars:[]};
 return manifest;
}

const at='2026-01-01T00:00:00.000Z',uuid=index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
export async function seedRealProjectHistory({workspace,userData,featurePaths=realProjectPaths.featurePaths}){
 assert.match(workspace,/^\/private\/tmp\/foundation-editor-endurance-[^/]+\/workspace$/);assert.equal(userData,path.join(path.dirname(workspace),'user-data'));
 const projectId=`project-${hash(workspace).slice(0,16)}`,sources=await Promise.all(featurePaths.map(async name=>({path:name,source:await readFile(path.join(workspace,name),'utf8')})));
 assert.equal(sources[0].path,realProjectPaths.sourcePath);assert.ok(sources.reduce((sum,file)=>sum+Buffer.byteLength(file.source),0)<=256*1024);
 const feature={id:uuid(1),title:'Foundation preview and source understanding',brief:'Maintained source snapshot for local acceptance. History below is synthetic fixture data, not previously observed interactions.',paths:featurePaths,entryPath:sources[0].path,archived:false,createdAt:at,updatedAt:at};
 const features={schemaVersion:1,projectId,revision:1,activeId:feature.id,features:[feature]};let template;
 const temporary=createConversationStore({projectId,read:()=>undefined,write:async value=>{template=value;}});
 await temporary.startTurn({requestId:'synthetic-template',prompt:'Synthetic acceptance history. No provider was called.',intent:'ask',model:'synthetic-offline-fixture',context:[{...sources[0],revision:hash(sources[0].source).slice(0,16)}]});temporary.event('synthetic-template',{type:'start'});temporary.event('synthetic-template',{type:'delta',text:'Synthetic historical answer. No provider or verification was run.\n'+'Fixture history text for rendering and storage measurement. '.repeat(580)});temporary.event('synthetic-template',{type:'done'});await temporary.flush();await temporary.dispose();
 const turn=JSON.parse(JSON.stringify(template.conversations[0].turns[0]).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g,at));
 const conversations={schemaVersion:8,projectId,revision:100,activeId:'synthetic-conversation-9',conversations:Array.from({length:10},(_,c)=>({id:`synthetic-conversation-${c}`,title:`Synthetic history ${c+1}`,createdAt:at,updatedAt:at,archived:false,turns:Array.from({length:c===9?28:8},(_,n)=>({...structuredClone(turn),id:`synthetic-${c}-${n}`,requestId:`synthetic-${c}-${n}`,createdAt:at,updatedAt:at}))}))};
 const screen={id:uuid(2),featureId:feature.id,title:'Synthetic historical Foundation screen',targetId:'external',route:'/',archived:false,createdAt:at,updatedAt:at},scenario={id:uuid(3),screenId:screen.id,title:'Synthetic historical scenario',steps:['Generated test data, not an observed historical interaction.'],expectedOutcome:'Exercise retained evidence without granting verification.',archived:false,createdAt:at,updatedAt:at};
 const runtime={targetId:'external',session:'a'.repeat(32),viewId:'b'.repeat(32),documentId:'c'.repeat(32),route:'/',pageVersion:1};
 const runtimeWorkspace={schemaVersion:1,projectId,revision:42,activeScreenId:screen.id,activeScenarioId:scenario.id,screens:[screen],scenarios:[scenario],runs:Array.from({length:40},(_,n)=>({id:uuid(100+n),feature:{id:feature.id,title:feature.title,revision:1,paths:feature.paths},screen,scenario,definitionRevision:2,runtime,sources:sources.map(file=>({path:file.path,revision:hash(file.source)})),dirtyPaths:[],startedAt:at,endedAt:at,status:'completed',assessment:'not-assessed',note:'SYNTHETIC OFFLINE HISTORY. No interaction or visual verification is implied.',observations:Array.from({length:100},(_,i)=>({id:`${runtime.session}:${runtime.viewId}:${n}-${i}`,session:runtime.session,documentId:runtime.documentId,kind:'request',method:'GET',url:'http://127.0.0.1:5173/api/workspace',status:200,durationMs:18,outcome:'success',observedAt:at,timing:'response-headers',correlation:'unattributed'})),truncated:false}))};
 for(const [factory,data]of [[createFeatureStore,features],[createConversationStore,conversations],[createRuntimeWorkspaceStore,runtimeWorkspace]]){const store=factory({projectId,read:()=>data,write:async()=>{throw Error('Valid seed must not require a recovery write');}});assert.equal(store.snapshot().storage.status,'saved');await store.dispose();}
 const state={['foundation.features.'+projectId]:features,['foundation.conversations.'+projectId]:conversations,['foundation.runtime-workspaces.'+projectId]:runtimeWorkspace};
 const summary={synthetic:true,conversations:10,turns:100,activeConversationTurns:28,conversationBytes:Buffer.byteLength(JSON.stringify(conversations)),runtimeRuns:40,runtimeObservations:4000,runtimeBytes:Buffer.byteLength(JSON.stringify(runtimeWorkspace)),featureSources:sources.length,featureSourceBytes:sources.reduce((sum,file)=>sum+Buffer.byteLength(file.source),0),projectId};assert.ok(summary.conversationBytes<8*1024*1024&&summary.runtimeBytes<8*1024*1024);
 const info=await stat(workspace),id=createHash('md5').update(workspace).update(String(info.birthtime.getTime())).digest('hex'),directory=path.join(userData,'User/workspaceStorage',id);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'workspace.json'),JSON.stringify({folder:pathToFileURL(workspace).href}),{flag:'wx'});const seedFile=path.join(path.dirname(workspace),'synthetic-history-seed.json');await writeFile(seedFile,JSON.stringify(state),{flag:'wx'});
 await promisify(execFile)('python3',['-c',`import json,sqlite3,sys,pathlib\np=pathlib.Path(sys.argv[1]);assert not p.exists();c=sqlite3.connect(p);c.execute('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');c.execute('INSERT INTO ItemTable (key,value) VALUES (?,?)',('foundation.foundation-workspace',pathlib.Path(sys.argv[2]).read_text()));c.commit();c.close()`,path.join(directory,'state.vscdb'),seedFile]);
 return {...summary,workspaceStorageId:id,normalizedFingerprint:hash(JSON.stringify(state).replaceAll(projectId,'PROJECT_ID'))};
}

export async function prepareRealProjectFixture({repo,extensionPath,temp,workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data')}){
 temp=await realpath(temp);assert.equal(workspace,path.join(temp,'workspace'));assert.equal(userData,path.join(temp,'user-data'));const manifest=await snapshotMaintainedSource({repo,workspace});
 for(const name of [...realProjectPaths.featurePaths,realProjectPaths.typingPath,realProjectPaths.unrelatedPath])assert.ok(manifest.files.some(file=>file.path===name),`Required maintained source missing: ${name}`);
 const historySummary=await seedRealProjectHistory({workspace,userData});
 const configPath=path.join(temp,'vite.endurance.config.mjs'),apiModulePath=path.join(temp,'foundation-endurance-api.mjs'),quote=value=>JSON.stringify(value);
 const config=`import {defineConfig} from ${quote(pathToFileURL(path.join(workspace,'node_modules/vite/dist/node/index.js')).href)};\nimport react from ${quote(pathToFileURL(path.join(workspace,'node_modules/@vitejs/plugin-react/dist/index.js')).href)};\nimport {foundationRuntime} from ${quote(pathToFileURL(path.join(extensionPath,'dist/connected-vite-plugin.mjs')).href)};\nexport default defineConfig({root:${quote(workspace)},cacheDir:${quote(path.join(temp,'vite-cache'))},plugins:[foundationRuntime(),react()],optimizeDeps:{include:['@monaco-editor/react','monaco-editor']},server:{host:'127.0.0.1',strictPort:true,port:Number(process.env.FOUNDATION_ENDURANCE_FRONTEND_PORT),hmr:{overlay:false},proxy:{'/api':'http://127.0.0.1:'+process.env.FOUNDATION_ENDURANCE_API_PORT}}});\n`;
 const api=`for(const key of Object.keys(process.env))if(/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|AZURE_OPENAI_API_KEY)$/.test(key))delete process.env[key];\nconst {createFoundationServer}=await import(${quote(pathToFileURL(path.join(workspace,'server/index.mjs')).href)});\nconst server=createFoundationServer({root:${quote(workspace)},port:Number(process.env.FOUNDATION_ENDURANCE_API_PORT),frontendPort:Number(process.env.FOUNDATION_ENDURANCE_FRONTEND_PORT)});\nserver.listen(server.foundationPort,'127.0.0.1',()=>console.log(JSON.stringify({event:'foundation-api-ready',port:server.address().port})));\nserver.on('error',error=>{console.error(error.message);process.exitCode=1;});\nfor(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));\n`;
 for(const [file,content] of [[configPath,config],[apiModulePath,api]]){await writeFile(file,content,{flag:'wx'});manifest.sidecars.push({path:file,bytes:Buffer.byteLength(content),sha256:hash(content),kind:'explicit test bootstrap outside maintained-source snapshot'});}
 const manifestPath=path.join(temp,'maintained-source-manifest.json');await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 return {manifest,manifestPath,...realProjectPaths,historySummary,expectedInventory:manifest.coverage,runtime:{configPath,apiModulePath,pingPath:'/api/workspace',pingMethod:'GET',readyText:'Foundation',connection:'external-harness-owned',generatedPing:false}};
}
