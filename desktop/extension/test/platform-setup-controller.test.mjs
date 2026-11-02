import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import vm from 'node:vm';
const root=fileURLToPath(new URL('../../../',import.meta.url)),require=createRequire(join(root,'package.json')),ts=require('typescript');
const compiled=ts.transpileModule(readFileSync(join(root,'desktop/extension/src/platform-setup-controller.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function event(){const callbacks=new Set();return {callbacks,on:fn=>{callbacks.add(fn);return {dispose:()=>callbacks.delete(fn)};},fire:data=>{for(const fn of callbacks)fn(data);}};}
function fixture({roots=['/fixture/one'],trusted=true}={}){
 const changes=event(),trust=event(),text=event(),close=event(),watchers=[],panels=[],calls=[],requests=[];
 const uri=path=>({scheme:'file',fsPath:path,toString:()=>`file://${path}`});
 const folders=roots.map((path,i)=>({name:'Project '+(i+1),uri:uri(path)}));
 const vscode={Uri:{joinPath:(base,...parts)=>uri(join(base.fsPath,...parts))},ViewColumn:{Active:1},RelativePattern:class{constructor(base,pattern){this.base=base;this.pattern=pattern;}},workspace:{workspaceFolders:folders,isTrusted:trusted,textDocuments:[],onDidChangeWorkspaceFolders:changes.on,onDidGrantWorkspaceTrust:trust.on,onDidChangeTextDocument:text.on,onDidCloseTextDocument:close.on,createFileSystemWatcher:pattern=>{const change=event(),create=event(),del=event();const watcher={pattern,change,create,del,disposed:false,onDidChange:change.on,onDidCreate:create.on,onDidDelete:del.on,dispose(){this.disposed=true;}};watchers.push(watcher);return watcher;}},window:{showQuickPick:async items=>{calls.push({pick:items.map(item=>item.folder.root)});return items[1];},createWebviewPanel:(type,title,column,options)=>{const receive=event(),dispose=event(),messages=[];const panel={type,title,column,options,messages,receive,disposeEvent:dispose,visible:true,webview:{html:'',cspSource:'vscode-webview:',asWebviewUri:value=>value.toString(),postMessage:async value=>{messages.push(structuredClone(value));return true;},onDidReceiveMessage:receive.on},onDidDispose:dispose.on,reveal:()=>calls.push('reveal'),dispose:()=>dispose.fire()};panels.push(panel);return panel;}}};
 const mod={exports:{}};vm.runInNewContext(compiled,{module:mod,exports:mod.exports,Buffer,AbortController,process,setTimeout,clearTimeout,require:name=>name==='vscode'?vscode:name.startsWith('node:')?require(name):{inspectPlatformReadiness:()=>{throw new Error('Unexpected default probe');},isPlatformReadinessInput:path=>/(^|\/)(package\.json|app\.json|app\.config\.[^/]+|project\.pbxproj|contents\.xcworkspacedata)$|\.swift$|\.(xcodeproj|xcworkspace)$/.test(path)}});
 const controller=new mod.exports.PlatformSetupController({extensionUri:uri('/extension'),inspect:options=>new Promise((resolve,reject)=>requests.push({options,resolve,reject}))});
 const panel=()=>panels.at(-1),ready=async(viewId='view-1')=>{await controller.message({type:'ready',viewId});},send=async(action,extra={})=>controller.message({type:'platformSetup',action,viewId:'view-1',ownerKey:controller.inspect().ownerKey,...extra});
 const report=(extra={})=>({schemaVersion:1,root:controller.inspect().project.root,checkedAt:'2026-11-01T12:00:00Z',inputFingerprint:'a'.repeat(64),status:'complete',project:{name:'Fixture',kinds:['expo'],markers:[{path:'package.json',kind:'expo'}],limitations:[]},checks:[{id:'node',label:'Node.js',status:'available',detail:'Runtime available.'}],capabilities:[{id:'mapping',label:'Source mapping',status:'unavailable',detail:'Native adapter not implemented.'}],...extra});
 return {controller,vscode,changes,trust,text,close,watchers,panels,calls,requests,uri,panel,ready,send,report,tick};
}

test('opening setup and webview readiness never execute checks; explicit check binds current folder',async()=>{
 const f=fixture();await f.controller.open();await f.ready();assert.equal(f.requests.length,0);assert.equal(f.panel().type,'foundation.projectSetup');assert.equal(f.controller.inspect().phase,'idle');assert.match(f.panel().webview.html,/default-src 'none'/);
 const run=f.send('check');assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.root,'/fixture/one');assert.equal(f.requests[0].options.trusted,true);assert.equal(f.controller.inspect().busy,true);f.requests[0].resolve(f.report());await run;assert.equal(f.controller.inspect().phase,'complete');assert.equal(f.controller.inspect().busy,false);assert.equal(f.panel().messages.at(-1).state.report.capabilities[0].status,'unavailable');f.controller.dispose();
});
test('multi-root setup requires an explicit native folder choice and preserves root binding',async()=>{
 const f=fixture({roots:['/fixture/one','/fixture/two']});await f.controller.open();await f.ready();assert.deepEqual(f.calls[0].pick,['/fixture/one','/fixture/two']);assert.equal(f.controller.inspect().project.root,'/fixture/two');assert.equal(f.requests.length,0);const run=f.send('check');assert.equal(f.requests[0].options.root,'/fixture/two');f.requests[0].resolve(f.report());await run;f.controller.dispose();
});
test('untrusted, missing folders, dirty setup input and forged messages cannot run probes',async()=>{
 for(const options of [{trusted:false},{roots:[]}]){const f=fixture(options);await f.controller.open();await f.ready();await f.send('check');assert.equal(f.requests.length,0);f.controller.dispose();}
 const f=fixture();await f.controller.open();await f.ready();await f.send('check',{ownerKey:'foreign'});await f.send('check',{viewId:'foreign'});await f.send('install');assert.equal(f.requests.length,0);f.vscode.workspace.textDocuments=[{uri:f.uri('/fixture/one/package.json'),isDirty:true}];await f.send('check');assert.equal(f.requests.length,0);assert.match(f.controller.inspect().reason,/Save or revert/);f.controller.dispose();
});
test('Cancel aborts only its run and late completion cannot publish success; recheck waits for cleanup',async()=>{
 const f=fixture();await f.controller.open();await f.ready();const run=f.send('check');await f.send('cancel');assert.equal(f.requests[0].options.signal.aborted,true);assert.equal(f.controller.inspect().phase,'cancelled');await f.send('check');assert.equal(f.requests.length,1);f.requests[0].resolve(f.report());await run;assert.equal(f.controller.inspect().report,undefined);assert.equal(f.controller.inspect().busy,false);const retry=f.send('check');assert.equal(f.requests.length,2);f.requests[1].resolve(f.report());await retry;assert.equal(f.controller.inspect().phase,'complete');f.controller.dispose();
});
test('saved setup changes stale displayed evidence and reject old ownership actions',async()=>{
 const f=fixture();await f.controller.open();await f.ready();const run=f.send('check');f.requests[0].resolve(f.report());await run;const owner=f.controller.inspect().ownerKey;f.watchers[0].change.fire(f.uri('/fixture/one/package.json'));assert.equal(f.controller.inspect().phase,'stale');assert.ok(f.controller.inspect().report);await f.send('check',{ownerKey:owner});assert.equal(f.requests.length,1);f.controller.dispose();
});
test('metadata edits during a run abort it and reject its late report, unrelated source drafts remain untouched',async()=>{
 const f=fixture();await f.controller.open();await f.ready();const document={uri:f.uri('/fixture/one/src/SaveButton.tsx'),isDirty:true,getText:()=> 'unsaved draft'};f.vscode.workspace.textDocuments=[document];const run=f.send('check');f.text.fire({document});assert.equal(f.requests[0].options.signal.aborted,false);f.watchers[0].change.fire(f.uri('/another/project/package.json'));assert.equal(f.requests[0].options.signal.aborted,false);f.watchers[0].change.fire(f.uri('/fixture/one/app.json'));assert.equal(f.requests[0].options.signal.aborted,true);f.requests[0].resolve(f.report());await run;assert.equal(f.controller.inspect().phase,'stale');assert.equal(f.controller.inspect().report,undefined);assert.equal(document.getText(),'unsaved draft');f.controller.dispose();
});
test('removed root, revoked trust, reload, panel close and disposal retire pending results without rerunning',async()=>{
 for(const change of ['root','trust','reload','close','dispose']){const f=fixture();await f.controller.open();await f.ready();const report=f.report(),run=f.send('check');if(change==='root'){f.vscode.workspace.workspaceFolders=[];f.changes.fire();}if(change==='trust')f.vscode.workspace.isTrusted=false;if(change==='reload')await f.ready('view-2');if(change==='close')f.panel().dispose();if(change==='dispose')f.controller.dispose();f.requests[0].resolve(report);await run;assert.equal(f.controller.inspect().report,undefined,change);assert.equal(f.requests.length,1,change);assert.notEqual(f.controller.inspect().phase,'complete',change);f.controller.dispose();}
});
test('errors are actionable and a report for a foreign folder is rejected',async()=>{
 for(const kind of ['error','foreign']){const f=fixture();await f.controller.open();await f.ready();const run=f.send('check');if(kind==='error')f.requests[0].reject(new Error('secret internal path'));else f.requests[0].resolve(f.report({root:'/other'}));await run;assert.equal(f.controller.inspect().phase,'failed');assert.equal(f.controller.inspect().report,undefined);assert.doesNotMatch(f.controller.inspect().reason,/secret/);f.controller.dispose();}
});
test('reopening a closed setup tab starts idle and never restores automatic probes',async()=>{
 const f=fixture();await f.controller.open();await f.ready();const run=f.send('check');f.requests[0].resolve(f.report());await run;f.panel().dispose();await f.controller.open();await f.ready('new-view');assert.equal(f.controller.inspect().phase,'idle');assert.equal(f.controller.inspect().report,undefined);assert.equal(f.requests.length,1);f.controller.dispose();
});

test('bounded watchers close with their panel and queued messages cannot own a replacement panel',async()=>{
 const f=fixture();await f.controller.open();await f.ready();assert.equal(f.watchers.length,10);assert.ok(f.watchers.every(watcher=>!watcher.pattern.pattern.includes('**')));const oldPanel=f.panel(),queued=[...oldPanel.receive.callbacks][0],oldKey=f.controller.inspect().ownerKey;oldPanel.dispose();assert.ok(f.watchers.every(watcher=>watcher.disposed));await f.controller.open();await f.ready('new-view');const newKey=f.controller.inspect().ownerKey;queued({type:'ready',viewId:'old-view'});queued({type:'platformSetup',action:'check',viewId:'old-view',ownerKey:oldKey});assert.equal(f.controller.inspect().ownerKey,newKey);assert.equal(f.requests.length,0);assert.equal(f.panel().messages.at(-1).viewId,'new-view');f.controller.dispose();
});
