import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
const safety = await import('../src/safety.mjs');
const compiled = ts.transpileModule(`${readFileSync(new URL('../src/extension.ts', import.meta.url),'utf8')}\nexport {FoundationHost};`, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const uri = path => ({scheme:'file',fsPath:path,toString:()=>`file://${path}`});
const file = path => ({path,source:`export const value = 1; // ${path}\n`,revision:'saved-1',analysis:{imports:[],consumers:[],symbols:[],requests:[]}});
const deferred = () => {let resolve; const promise = new Promise(done=>resolve=done); return {promise,resolve};};
function harness({wide=false}={}) {
 const paths = (prefix,n) => Array.from({length:n},(_,i)=>`src/${prefix}${i}.tsx`);
 const open=paths('Open',wide?8:2), feature=paths('Feature',wide?32:2), context=paths('Context',wide?32:2), design=paths('Design',wide?100:2);
 const sources=new Map([...open,...feature,...context,...design].map(path=>[path,file(path)]));
 const project={id:'project',root:'/fixtures/refresh',files:[...sources.keys()].map(path=>({path})),indexedAt:'one'};
 const features={activeId:'feature',revision:1,storage:{status:'saved'},features:[{id:'feature',paths:feature,archived:false}]};
 const vscode={Uri:{file:uri},window:{},workspace:{isTrusted:true,textDocuments:open.map(path=>({uri:uri(`${project.root}/${path}`),isClosed:false,getText(){throw Error('No draft reads');}})),workspaceFolders:[{uri:uri(project.root)}],getWorkspaceFolder:()=>({uri:uri(project.root)})}};
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,URL,setTimeout,clearTimeout,AbortController,require:name=>name==='vscode'?vscode:name.includes('safety')?safety:name.startsWith('node:')?require(name):{}});
 const host=Object.create(module.exports.FoundationHost.prototype), calls=[],states=[],messages=[];let readHook;
 // Source refresh fixtures have no saved issues or runtime issue history.
 Object.assign(host,{reproducibleIssuesSnapshot:()=>null,refreshReproducibleIssues:async()=>{},project,activeFile:file(open[0]),openFiles:[],lastDocument:uri(`${project.root}/${open[0]}`),focus:{path:open[0],origin:'source',line:1},generation:0,focusGeneration:0,featureSourceEpoch:0,featureLoadGeneration:0,featureCacheKey:'',featureFiles:[],featureUnavailable:[],status:{},design:{files:design.map(path=>({path,revision:'saved-1'}))},
 diagnostics:{runAsync:(_name,run)=>run()},featureSnapshot:()=>features,features:()=>({snapshot:()=>features}),conversations:()=>({snapshot:()=>({activeId:null})}),
 assistantContextRestore:{requestId:'restore-1',projectId:project.id,featureId:'feature',conversationId:null,paths:context},assistantContextFiles:[],assistantContextEpoch:-1,assistantView:{webview:{postMessage:message=>messages.push(structuredClone(message))}},
 service:{snapshot:async()=>project,getFile(){throw Error('No repeated single-file reads during display refresh');},getFiles:async(id,paths,options)=>{calls.push({id,paths:[...paths]});if(readHook)return readHook(id,paths,options);return {files:paths.flatMap(path=>sources.has(path)?[structuredClone(sources.get(path))]:[]),unavailable:paths.filter(path=>!sources.has(path)).map(path=>({path,code:'missing',message:'Saved file missing.'}))};}},
 projectDecisionStore:()=>({snapshot:()=>({decisions:[]})}),proposals:()=>({assess:async()=>{}}),loadRelationships(){},reconcileScenarioRun:async()=>{},loadChangeSets:async()=>{},loadExecutions:async()=>{},persistFocus(){},updateTree(){},sendState(){states.push({active:this.activeFile?.path,features:this.featureFiles.map(file=>file.path)});}});
 return {host,sources,project,features,vscode,calls,states,messages,open,feature,context,design,setRead:hook=>readHook=hook};
}

test('one refresh batches all 172 possible display paths once and reuses sources across surfaces',async()=>{
 const h=harness({wide:true});await h.host.refresh();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].paths.length,172);assert.equal(h.host.error,undefined);
 assert.equal(h.host.openFiles.length,8);assert.equal(h.host.featureFiles.length,32);assert.equal(h.host.assistantContextFiles.length,32);
 assert.equal(h.host.design.stale,undefined);assert.equal(h.host.activeFile.path,h.open[0]);assert.equal(h.messages[0].unavailable.length,0);
});

test('each refresh reads current saved source again even with unchanged feature and revision tokens',async()=>{
 const h=harness();await h.host.refresh();h.sources.get(h.feature[0]).source='// same token, new saved text';h.sources.get(h.context[0]).source='// changed context';h.sources.delete(h.context[1]);await h.host.refresh();
 assert.equal(h.calls.length,2);assert.equal(h.host.featureFiles[0].source,'// same token, new saved text');assert.equal(h.host.assistantContextFiles.length,1);assert.equal(h.host.assistantContextFiles[0].source,'// changed context');assert.equal(h.messages.at(-1).unavailable[0].path,h.context[1]);
});

test('per-file unavailability preserves other source contexts and makes design stale',async()=>{
 const h=harness();for(const path of [h.open[0],h.feature[0],h.context[0],h.design[0]])h.sources.delete(path);
 await h.host.refresh();assert.equal(h.host.activeFile,null);assert.equal(h.host.error,'Saved file missing.');assert.equal(h.host.openFiles.length,1);
 assert.equal(h.host.featureFiles.length,1);assert.equal(h.host.featureUnavailable[0].kind,'source-unavailable');assert.equal(h.host.design.stale,true);
 assert.equal(h.host.assistantContextFiles.length,1);assert.equal(h.messages[0].unavailable[0].path,h.context[0]);
});

for(const transition of ['save','project','trust','new-refresh','dispose'])test(`${transition} during display analysis cannot publish its old source`,async()=>{
 const h=harness(),gate=deferred();h.setRead(async()=>{await gate.promise;return {files:[...h.sources.values()],unavailable:[]};});
 const before=h.host.activeFile,pending=h.host.refresh();await new Promise(setImmediate);
 if(transition==='save')h.host.featureSourceEpoch++;else if(transition==='project')h.host.project={...h.project,id:'other'};else if(transition==='trust')h.vscode.workspace.isTrusted=false;else if(transition==='dispose')h.host.disposed=true;else h.host.generation++;
 gate.resolve();await pending;assert.equal(h.host.activeFile,before);assert.equal(h.host.featureFiles.length,0);assert.equal(h.host.assistantContextFiles.length,0);assert.equal(h.states.length,0);
});

test('a save during standalone feature loading invalidates its captured epoch',async()=>{
 const h=harness(),gate=deferred();h.setRead(async()=>{await gate.promise;return {files:h.feature.map(path=>h.sources.get(path)),unavailable:[]};});
 const pending=h.host.loadFeatureFiles();h.host.featureSourceEpoch++;gate.resolve();await pending;assert.equal(h.host.featureFiles.length,0);assert.equal(h.host.featureCacheKey,'');
});

test('feature change during a refresh loads the new membership without accepting the old union as complete',async()=>{
 const h=harness();let first=true;h.setRead(async(_id,paths)=>{if(first){first=false;h.features.revision++;h.features.features[0].paths=['src/New.tsx'];h.sources.set('src/New.tsx',file('src/New.tsx'));}return {files:paths.map(path=>structuredClone(h.sources.get(path))),unavailable:[]};});
 await h.host.refresh();assert.equal(h.calls.length,2);assert.deepEqual(h.calls[1].paths,['src/New.tsx']);assert.equal(h.host.featureFiles[0].path,'src/New.tsx');assert.equal(h.host.assistantContextFiles.length,2);
});

test('shared analysis retains independent 256KiB feature and Assistant source budgets',async()=>{
 const h=harness();for(const path of [...h.feature,...h.context])h.sources.get(path).source='x'.repeat(140000);
 await h.host.refresh();assert.equal(h.calls.length,1);assert.equal(h.host.featureFiles.length,1);assert.equal(h.host.featureUnavailable[0].kind,'context-limit');assert.equal(h.host.assistantContextFiles.length,1);assert.match(h.messages[0].unavailable[0].reason,/256 KiB/);
});

for(const changed of ['consumer','ignore','design'])test(`${changed} saved-source events invalidate an in-flight display basis before the next refresh`,()=>{
 const h=harness();h.host.relationshipSourceChanged=()=>changed==='consumer';h.host.proposals=()=>({current:()=>null});h.host.changeSetSnapshot=()=>null;
 const path=changed==='ignore'?'.gitignore':changed==='consumer'?'src/NewConsumer.tsx':h.design[0];
 assert.equal(h.host.relevantSource(uri(`${h.project.root}/${path}`)),true);assert.equal(h.host.featureSourceEpoch,1);assert.equal(h.host.featureCacheKey,'');
});

test('a newly prepared design preview does not inherit stale assessment from an older refresh basis',async()=>{
 const h=harness();h.setRead(async(_id,paths)=>{h.host.design={files:[{path:'src/NewDesign.tsx',revision:'new'}]};return {files:paths.map(path=>structuredClone(h.sources.get(path))),unavailable:[]};});
 await h.host.refresh();assert.equal(h.host.design.stale,undefined);
});
