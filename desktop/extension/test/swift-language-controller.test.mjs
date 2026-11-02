import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import vm from 'node:vm';
import { isXcodeSourceInput } from '../src/xcode-project.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)), require=createRequire(join(root,'package.json')), ts=require('typescript');
const compiled=ts.transpileModule(readFileSync(join(root,'desktop/extension/src/swift-language-controller.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const event=()=>{const callbacks=new Set();return {on:callback=>{callbacks.add(callback);return {dispose:()=>callbacks.delete(callback)};},fire:value=>{for(const callback of callbacks)callback(value);}};};
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(t,{trusted=true,dirty=false}={}){
 const events={folders:event(),open:event(),change:event(),close:event(),save:event()},watchers=[],calls=[],clients=[],providers={},diagnosticSets=new Map(),controls={};
 const uri=path=>{const value=pathToFileURL(path);return {scheme:'file',fsPath:path,toString:()=>value.href};};
 class Position{constructor(line,character){this.line=line;this.character=character;}isBefore(other){return this.line<other.line||this.line===other.line&&this.character<other.character;}}
 class Range{constructor(start,end){this.start=start;this.end=end;}isEqual(other){return this.start.line===other.start.line&&this.start.character===other.start.character&&this.end.line===other.end.line&&this.end.character===other.end.character;}}
 const document=(path,text='struct Profile {\n    func save() {}\n}\n',options={})=>({uri:uri(path),languageId:'swift',version:1,isDirty:false,text,getText(){return this.text;},validateRange(range){const lines=this.text.split('\n');const clamp=p=>{const line=Math.min(Math.max(0,p.line),lines.length-1);return new Position(line,Math.min(Math.max(0,p.character),lines[line].length));};return new Range(clamp(range.start),clamp(range.end));},...options});
 const selected=document('/fixture/project/Profile.swift',undefined,{isDirty:dirty}),other=document('/fixture/project/Other.swift');
 const collection={disposed:false,set:(key,value)=>diagnosticSets.set(key.toString(),value),delete:key=>diagnosticSets.delete(key.toString()),clear:()=>diagnosticSets.clear(),dispose(){this.disposed=true;diagnosticSets.clear();}};
 const register=(kind,provider)=>{providers[kind]=provider;return {dispose:()=>delete providers[kind]};};
 const vscode={Position,Range,Uri:{file:uri},StatusBarAlignment:{Left:1},DiagnosticSeverity:{Error:0,Warning:1,Information:2,Hint:3},CompletionItemKind:{Text:0},
  RelativePattern:class{constructor(base,pattern){this.base=base;this.pattern=pattern;}},
  EventEmitter:class{constructor(){this.e=event();this.event=this.e.on;}fire(value){this.e.fire(value);}dispose(){}},
  CancellationTokenSource:class{constructor(){this.e=event();this.token={isCancellationRequested:false,onCancellationRequested:this.e.on};}cancel(){this.token.isCancellationRequested=true;this.e.fire();}dispose(){}},
  CompletionItem:class{constructor(label,kind){this.label=label;this.kind=kind;}},CompletionList:class{constructor(items,isIncomplete){this.items=items;this.isIncomplete=isIncomplete;}},
  SnippetString:class{constructor(value){this.value=value;}},Location:class{constructor(uri,range){this.uri=uri;this.range=range;}},Diagnostic:class{constructor(range,message,severity){this.range=range;this.message=message;this.severity=severity;}},
  MarkdownString:class{constructor(){this.value='';this.parts=[];}appendText(text){this.parts.push({kind:'text',text});this.value+=text;return this;}appendMarkdown(text){this.parts.push({kind:'markdown',text});this.value+=text;return this;}appendCodeblock(text,language){this.parts.push({kind:'code',text,language});this.value+=text;return this;}},Hover:class{constructor(contents,range){this.contents=contents;this.range=range;}},
  languages:{createDiagnosticCollection:()=>collection,registerCompletionItemProvider:(_selector,provider)=>register('completion',provider),registerDefinitionProvider:(_selector,provider)=>register('definition',provider),registerHoverProvider:(_selector,provider)=>register('hover',provider)},
  workspace:{isTrusted:trusted,workspaceFolders:[{uri:uri('/fixture/project')}],textDocuments:[selected],onDidChangeWorkspaceFolders:events.folders.on,onDidOpenTextDocument:events.open.on,onDidChangeTextDocument:events.change.on,onDidCloseTextDocument:events.close.on,onDidSaveTextDocument:events.save.on,
   createFileSystemWatcher:pattern=>{const change=event(),create=event(),del=event(),watcher={pattern,change,create,del,disposed:false,onDidChange:change.on,onDidCreate:create.on,onDidDelete:del.on,dispose(){this.disposed=true;}};watchers.push(watcher);return watcher;}},
  window:{createStatusBarItem:()=>({show(){},hide(){},dispose(){}}),showQuickPick:async(items,options,token)=>{calls.push({kind:'pick',items,token});return controls.pick?controls.pick(items,options,token):items[0];}},
 };
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,URL,AbortController,process,setTimeout,clearTimeout,require:name=>name==='vscode'?vscode:name.startsWith('node:')?require(name):{isXcodeSourceInput}});
 const target={id:'target-1',name:'Orbit',architecture:'arm64',moduleName:'Orbit',sourcekitPath:'/toolchain/sourcekit-lsp'},configuration={root:'/fixture/project',workspaceRoot:'/private/tmp/context',compilationDatabasePath:'/private/tmp/context/compile_commands.json',sourcePaths:[selected.uri.fsPath,'/fixture/project/Store.swift'],target,settingsFingerprint:'settings-1',configurationFingerprint:'configuration-1'};
 const context={root:configuration.root,catalog:{selectedScheme:'Orbit'},destinationId:'simulator-1'};
 const prepared={status:'ready',targets:[target],build:{status:'passed',id:'build-1'}};
 const controller=new module.exports.SwiftLanguageController({
  prepare:async options=>{calls.push({kind:'prepare',options});return controls.prepare?controls.prepare(options):prepared;},
  createConfiguration:async options=>{calls.push({kind:'create',options});return controls.create?controls.create(options):{status:'ready',configuration};},
  validateConfiguration:async(...args)=>{calls.push({kind:'validate',args});return controls.validate?controls.validate(...args):{status:'ready'};},
  readConfigurationFingerprint:async()=>controls.fingerprint??configuration.configurationFingerprint,
  disposeConfiguration:async value=>{calls.push({kind:'dispose',value});},
  createClient:callbacks=>{const state={state:'idle',contextVersion:0,sessionId:`session-${clients.length}`,documents:[],pendingRequests:0},requests=[],client={callbacks,state,requests,
   connect:async options=>{calls.push({kind:'connect',options});if(controls.connect)await controls.connect(options);state.state='connected';},
   openDocument:doc=>{state.contextVersion++;state.documents.push({uri:doc.uri,version:doc.version});calls.push({kind:'open',...doc});},
   changeDocument:doc=>{state.contextVersion++;const old=state.documents.find(d=>d.uri===doc.uri);old.version=doc.version;calls.push({kind:'change',...doc});},
   closeDocument:uri=>{controls.close?.(uri);state.contextVersion++;state.documents=state.documents.filter(d=>d.uri!==uri);calls.push({kind:'close',uri});},
   invalidateContext:()=>{state.contextVersion++;calls.push({kind:'invalidateContext'});},
   request:(method,params,options)=>{const request={method,params,options};requests.push(request);return controls.request?controls.request(request,client):Promise.resolve(method==='textDocument/diagnostic'?{kind:'full',items:[]}:null);},
   stop:async()=>{calls.push({kind:'stop'});state.state='stopped';if(controls.stop)await controls.stop();},snapshot:()=>({...state}),
  };clients.push(client);return client;},
 });
 const token=()=>{const e=event();return {isCancellationRequested:false,onCancellationRequested:e.on,cancel(){this.isCancellationRequested=true;e.fire();}};};
 const diagnostic=(version=selected.version,extra={})=>({uri:selected.uri.toString(),version,contextVersion:clients.at(-1)?.state.contextVersion,sessionId:clients.at(-1)?.state.sessionId,diagnostics:[{range:{start:{line:0,character:0},end:{line:0,character:6}},message:'Cannot find missing value',severity:1}],...extra});
 const edit=(text,document=selected)=>{document.text=text;document.version++;document.isDirty=true;events.change.fire({document});};
 t.after(async()=>{await controller.stop();controller.dispose();});
 return {controller,vscode,providers,events,watchers,calls,clients,controls,selected,other,document,configuration,context,prepared,uri,token,diagnostic,edit,diagnosticSets,collection,Position,Range};
}

test('controller registration, document opens and restart are inert until explicit target connection',async t=>{
 const f=fixture(t);assert.equal(f.calls.length,0);f.events.open.fire(f.selected);assert.equal(f.calls.length,0);assert.equal(f.controller.inspect().phase,'disconnected');
 await f.controller.connect(f.context);assert.equal(f.controller.inspect().phase,'connected');assert.deepEqual(f.calls.map(c=>c.kind),['prepare','pick','create','validate','connect','open']);
 assert.equal(f.calls.find(c=>c.kind==='prepare').options.trusted,true);assert.equal(f.calls.find(c=>c.kind==='connect').options.executable,f.configuration.target.sourcekitPath);assert.equal(f.controller.inspect().documents[0].version,1);
 await f.controller.stop();assert.equal(f.controller.inspect().phase,'disconnected');f.events.open.fire(f.selected);assert.equal(f.clients.length,1);
});
test('untrusted, dirty and absent project cannot start a build or save a draft',async t=>{
 for(const options of [{trusted:false},{dirty:true},{missing:true}]){const f=fixture(t,options);if(options.missing)f.vscode.workspace.workspaceFolders=[];await f.controller.connect(f.context);assert.equal(f.calls.length,0);assert.equal(f.controller.inspect().phase,'stale');assert.equal(f.selected.getText(),'struct Profile {\n    func save() {}\n}\n');}
});
test('wrong-member, non-Swift and remote buffers never reach the language client',async t=>{
 const f=fixture(t);await f.controller.connect(f.context);const before=f.calls.length;
 const remote=f.document('/fixture/project/Profile.swift');remote.uri={scheme:'vscode-remote',fsPath:'/fixture/project/Profile.swift',toString:()=> 'vscode-remote://host/Profile.swift'};
 const plain=f.document('/fixture/project/Profile.swift',undefined,{languageId:'plaintext'});
 for(const document of [f.other,remote,plain]){f.events.open.fire(document);assert.equal(await f.providers.completion.provideCompletionItems(document,new f.Position(0,0),f.token()),undefined);}
 assert.equal(f.calls.length,before);assert.equal(f.clients[0].requests.length,0);
});
test('target cancellation, stale validation and failed build stop before launching SourceKit',async t=>{
 for(const kind of ['pick','validate','prepare']){const f=fixture(t);if(kind==='pick')f.controls.pick=()=>undefined;if(kind==='validate')f.controls.validate=()=>({status:'stale',reason:'Changed project'});if(kind==='prepare')f.controls.prepare=()=>({status:'unavailable',targets:[],reason:'Build failed'});await f.controller.connect(f.context);assert.equal(f.clients.length,0,kind);assert.ok(!f.calls.some(c=>c.kind==='connect'));if(kind==='validate')assert.ok(f.calls.some(c=>c.kind==='dispose'));}
});
test('completion converts real LSP snippets and edit ranges but discards invalid edits and server commands',async t=>{
 const f=fixture(t);await f.controller.connect(f.context);f.controls.request=()=>Promise.resolve({isIncomplete:true,items:[
  {label:'save(using:)',kind:2,insertTextFormat:2,textEdit:{range:{start:{line:0,character:0},end:{line:0,character:6}},newText:'save(${1:service})'},detail:'A Swift member',documentation:{kind:'markdown',value:'Saves profile'},command:{command:'danger'},additionalTextEdits:[{}]},
  {label:'invalid',textEdit:{range:{start:{line:-1,character:0},end:{line:0,character:2}},newText:'invalid'}},
  {label:'outside',textEdit:{range:{start:{line:1000,character:0},end:{line:1000,character:2}},newText:'outside'}},
 ]});
 const result=await f.providers.completion.provideCompletionItems(f.selected,new f.Position(0,4),f.token());assert.equal(result.items.length,1);assert.equal(result.isIncomplete,true);assert.equal(result.items[0].insertText.value,'save(${1:service})');assert.equal(result.items[0].range.end.character,6);assert.equal(result.items[0].kind,1);assert.equal(result.items[0].command,undefined);assert.equal(result.items[0].additionalTextEdits,undefined);
});
test('definitions navigate only selected local target files and reject remote, query and malformed locations',async t=>{
 const f=fixture(t);await f.controller.connect(f.context);const range={start:{line:2,character:1},end:{line:2,character:5}};
 f.controls.request=()=>Promise.resolve([{uri:'file:///fixture/project/Store.swift',range},{targetUri:'file:///fixture/project/Profile.swift',targetSelectionRange:range},{uri:'file:///fixture/project/Other.swift',range},{uri:'https://example.test/Store.swift',range},{uri:'file:///fixture/project/Store.swift?ignored',range},{uri:'file:///fixture/project/Store.swift#ignored',range},{uri:'file:///fixture/project/Store.swift',range:{start:{line:-1,character:0},end:{line:0,character:0}}}]);
 const result=await f.providers.definition.provideDefinition(f.selected,new f.Position(0,3),f.token());assert.equal(result.length,2);assert.deepEqual(plain(result.map(v=>v.uri.fsPath)),['/fixture/project/Store.swift','/fixture/project/Profile.swift']);
});
test('Swift hover keeps explicit markdown readable with command trust and HTML disabled',async t=>{
 const f=fixture(t);await f.controller.connect(f.context);f.controls.request=()=>Promise.resolve({contents:{kind:'markdown',value:'## Swift\n```swift\nstruct View\n```'}});
 const result=await f.providers.hover.provideHover(f.selected,new f.Position(0,3),f.token());assert.equal(result.contents.isTrusted,false);assert.equal(result.contents.supportHtml,false);assert.equal(result.contents.parts[0].kind,'markdown');
});
test('diagnostics belong to the current document and session; edits immediately remove old Problems',async t=>{
 const f=fixture(t);await f.controller.connect(f.context);const callback=f.clients[0].callbacks.onDiagnostics;
 callback(f.diagnostic());assert.equal(f.diagnosticSets.get(f.selected.uri.toString()).length,1);assert.equal(f.controller.inspect().documents[0].diagnosticVersion,1);
 f.edit('struct Changed {\n}\n');assert.equal(f.diagnosticSets.has(f.selected.uri.toString()),false);assert.equal(f.controller.inspect().documents[0].diagnosticVersion,undefined);
 callback(f.diagnostic(1));callback(f.diagnostic(2,{sessionId:'other-session'}));callback(f.diagnostic(2,{uri:'file:///outside/Other.swift'}));assert.equal(f.diagnosticSets.size,0);
 callback(f.diagnostic(2,{diagnostics:[]}));assert.equal(f.diagnosticSets.get(f.selected.uri.toString()).length,0);assert.equal(f.controller.inspect().documents[0].diagnosticVersion,2);assert.equal(f.controller.inspect().counters.discardedResults,3);
});
test('invalid diagnostic ranges are rejected and severity/source remain native',async t=>{
 const f=fixture(t);await f.controller.connect(f.context);const valid=f.diagnostic().diagnostics[0];f.clients[0].callbacks.onDiagnostics(f.diagnostic(1,{diagnostics:[{...valid,severity:2,code:'swift.warning'},{...valid,range:{start:{line:400,character:0},end:{line:400,character:4}}}]}));
 const diagnostics=f.diagnosticSets.get(f.selected.uri.toString());assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].severity,1);assert.equal(diagnostics[0].source,'Foundation Swift');assert.equal(diagnostics[0].code,'swift.warning');
});
test('diagnostics debounce sends only newest document version and closing a document keeps session alive',async t=>{
 const f=fixture(t);await f.controller.connect(f.context);f.edit('struct B {}');f.edit('struct C {}');await new Promise(resolve=>setTimeout(resolve,220));
 assert.equal(f.clients[0].requests.filter(r=>r.method==='textDocument/diagnostic').length,1);assert.equal(f.controller.inspect().documents[0].version,3);
 f.events.close.fire(f.selected);assert.equal(f.controller.inspect().phase,'connected');assert.equal(f.controller.inspect().documents.length,0);assert.equal(f.clients[0].state.state,'connected');assert.ok(!f.calls.some(c=>c.kind==='stop'));
 f.events.open.fire(f.selected);assert.equal(f.controller.inspect().documents.length,1);
});
test('late completion after edit, cancellation, stop or revoked trust cannot publish',async t=>{
 for(const kind of ['edit','cancel','stop','trust']){const f=fixture(t);await f.controller.connect(f.context);let resolveResult;f.controls.request=()=>new Promise(resolve=>resolveResult=resolve);const token=f.token();const pending=f.providers.completion.provideCompletionItems(f.selected,new f.Position(0,3),token);
  if(kind==='edit')f.edit('struct New {}');if(kind==='cancel')token.cancel();if(kind==='stop')await f.controller.stop();if(kind==='trust')f.vscode.workspace.isTrusted=false;
  resolveResult({items:[{label:'late'}]});assert.equal(await pending,undefined,kind);assert.equal(f.controller.inspect().counters.completions,0,kind);if(kind==='cancel')assert.equal(f.clients[0].requests[0].options.signal.aborted,true);
 }
});
test('configuration membership and settings changes stop the session, saved Swift text changes do not',async t=>{
 const f=fixture(t);await f.controller.connect(f.context);f.watchers[0].change.fire(f.selected.uri);await tick();assert.equal(f.controller.inspect().phase,'connected');
 f.controls.fingerprint='new-membership';f.watchers[0].create.fire(f.other.uri);await tick();assert.equal(f.controller.inspect().phase,'stale');assert.equal(f.clients[0].state.state,'stopped');assert.ok(f.watchers.every(w=>w.disposed));
});
test('configuration draft or workspace removal disconnects without saving user source',async t=>{
 for(const kind of ['settings','folders']){const f=fixture(t);await f.controller.connect(f.context);if(kind==='settings'){const config=f.document('/fixture/project/Orbit.xcodeproj/project.pbxproj','draft',{languageId:'plaintext',isDirty:true});f.events.change.fire({document:config});assert.equal(config.text,'draft');}else{f.vscode.workspace.workspaceFolders=[];f.events.folders.fire();}await tick();assert.equal(f.controller.inspect().phase,'stale');assert.equal(f.clients[0].state.state,'stopped');}
});
test('cancel during preparation, picker or connect retires late success and disposes owned context',async t=>{
 for(const phase of ['prepare','pick','connect']){const f=fixture(t);let release;
  if(phase==='prepare')f.controls.prepare=()=>new Promise(resolve=>release=()=>resolve(f.prepared));
  if(phase==='pick')f.controls.pick=(items,_options,token)=>new Promise(resolve=>{release=()=>resolve(items[0]);token.onCancellationRequested(()=>resolve(undefined));});
  if(phase==='connect')f.controls.connect=()=>new Promise(resolve=>release=resolve);
  const connecting=f.controller.connect(f.context);await tick();const stopping=f.controller.stop();release();await Promise.all([connecting,stopping]);
  assert.equal(f.controller.inspect().phase,'disconnected',phase);assert.equal(f.controller.inspect().client,undefined,phase);assert.equal(f.controller.inspect().busy,false,phase);if(phase==='connect'){assert.ok(f.calls.some(c=>c.kind==='stop'));assert.ok(f.calls.some(c=>c.kind==='dispose'));}
 }
});
test('unexpected server exit clears diagnostics and connection while disposal unregisters providers',async t=>{
 const f=fixture(t);await f.controller.connect(f.context);f.clients[0].callbacks.onDiagnostics(f.diagnostic());f.clients[0].callbacks.onExit({code:1,expected:false});await tick();assert.equal(f.controller.inspect().phase,'failed');assert.equal(f.diagnosticSets.size,0);assert.equal(f.controller.inspect().client,undefined);f.controller.dispose();assert.deepEqual(Object.keys(f.providers),[]);assert.equal(f.collection.disposed,true);
});

test('cross-file edits and external saved changes retire results and clear all target diagnostics',async t=>{
 const f=fixture(t);const store=f.document('/fixture/project/Store.swift');f.vscode.workspace.textDocuments.push(store);await f.controller.connect(f.context);
 const client=f.clients[0];client.callbacks.onDiagnostics(f.diagnostic());const previousContext=client.state.contextVersion;const previousEpoch=f.controller.inspect().contextVersion;const savedConsumerVersion=f.selected.version,savedConsumerText=f.selected.getText();const beforeEdit=f.calls.length;
 let release;f.controls.request=()=>new Promise(resolve=>release=resolve);const result=f.providers.completion.provideCompletionItems(f.selected,new f.Position(0,3),f.token());
 f.edit('struct Store { var name = "draft" }',store);assert.equal(f.diagnosticSets.size,0);
 const refresh=f.calls.slice(beforeEdit);assert.ok(refresh.some(call=>call.kind==='close'&&call.uri===f.selected.uri.toString()));
 const reopened=refresh.find(call=>call.kind==='open'&&call.uri===f.selected.uri.toString());assert.equal(reopened.version,savedConsumerVersion);assert.equal(reopened.text,savedConsumerText);assert.equal(f.selected.version,savedConsumerVersion);assert.equal(f.selected.getText(),savedConsumerText);assert.ok(f.controller.inspect().contextVersion>previousEpoch);
 client.callbacks.onDiagnostics(f.diagnostic(1,{contextVersion:previousContext}));assert.equal(f.diagnosticSets.size,0);
 release({items:[{label:'stale dependency'}]});assert.equal(await result,undefined);
 f.controls.request=()=>Promise.resolve({kind:'full',items:[]});await new Promise(resolve=>setTimeout(resolve,220));
 assert.equal(client.requests.filter(r=>r.method==='textDocument/diagnostic').length,2);
 const before=client.state.contextVersion,beforeWatch=f.calls.length;f.watchers[0].change.fire(store.uri);await tick();assert.ok(client.state.contextVersion>before);assert.equal(f.controller.inspect().phase,'connected');
 assert.equal(f.calls.slice(beforeWatch).filter(call=>call.kind==='open').length,2);
});
test('failed pull diagnostics are unavailable rather than a current clean result',async t=>{
 const f=fixture(t);await f.controller.connect(f.context);f.controls.request=()=>Promise.reject(new Error('language timeout'));
 await new Promise(resolve=>setTimeout(resolve,220));const entry=f.controller.inspect().documents[0];
 assert.equal(entry.diagnosticState,'unavailable');assert.equal(entry.diagnosticVersion,undefined);assert.equal(f.diagnosticSets.size,0);
});

test('dependent protocol refresh failure stops instead of publishing unverified consumer results',async t=>{
 const f=fixture(t);const store=f.document('/fixture/project/Store.swift');f.vscode.workspace.textDocuments.push(store);await f.controller.connect(f.context);
 const before=f.selected.getText(),version=f.selected.version;f.controls.close=()=>{throw new Error('transport ended');};
 f.edit('struct Store { var changed = true }',store);await tick();
 assert.equal(f.controller.inspect().phase,'failed');assert.equal(f.controller.inspect().client,undefined);assert.equal(f.diagnosticSets.size,0);
 assert.equal(f.selected.getText(),before);assert.equal(f.selected.version,version);
});
