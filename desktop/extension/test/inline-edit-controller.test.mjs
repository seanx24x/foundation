import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=process.env.FOUNDATION_INLINE_TEST_ROOT||resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(join(root,'package.json')),ts=require('typescript');
const compiled=ts.transpileModule(readFileSync(join(root,'desktop/extension/src/inline-edit-controller.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
class Emitter{listeners=new Set();event=listener=>{this.listeners.add(listener);return{dispose:()=>this.listeners.delete(listener)};};fire(value){for(const listener of [...this.listeners])listener(value);}}
class Position{constructor(line,character){this.line=line;this.character=character;}}
class Range{constructor(start,end){this.start=start;this.end=end;}get isEmpty(){return this.start.line===this.end.line&&this.start.character===this.end.character;}}
class Selection extends Range{}
const uri=({scheme='file',path,query=''})=>({scheme,path,fsPath:path,query,toString(){return `${scheme}:${path}${query?'?'+query:''}`;}});
function harness({text="// PRIVATE_BEFORE\nconst value = 1;\n// PRIVATE_AFTER\n",selected='const value = 1;',replacement='const value = 2;',eol=1}={}){
 const changes=new Emitter(),closes=new Emitter(),active=new Emitter(),tabsChanged=new Emitter(),cancel=new Emitter();
 const inputs=[],requests=[],commands=[],notices=[],warnings=[],edits=[],statusItems=[],closedTabs=[],shownDocuments=[],snapshots=new Map();
 let owner={key:'project-root-config1',path:'src/value.ts'},provider={configured:true,provider:'127.0.0.1:1',model:'fixture-inline',providerKind:'compatible'},generateHook,showHook,editHook,diffHook,choice;
 const document={uri:uri({path:'/fixture/src/value.ts'}),version:7,languageId:'typescript',eol,isClosed:false,isDirty:true,source:text,
  getText(range){return range?this.source.slice(this.offsetAt(range.start),this.offsetAt(range.end)):this.source;},
  offsetAt(position){const lines=this.source.split('\n');return lines.slice(0,position.line).reduce((n,line)=>n+line.length+1,0)+position.character;},
  positionAt(offset){const prefix=this.source.slice(0,offset),parts=prefix.split('\n');return new Position(parts.length-1,parts.at(-1).length);},
  save(){throw Error('Inline edits must not save');}};
 const start=Math.max(0,text.indexOf(selected)),selection=new Selection(document.positionAt(start),document.positionAt(start+selected.length));
 const editor={document,viewColumn:2,selection,selections:[selection],async edit(callback,options){const replacements=[];callback({replace:(range,replacement)=>replacements.push({range,replacement})});edits.push({replacements,options});if(editHook)return editHook({callback,options,replacements});const previous=document.source;for(const item of replacements)document.source=document.source.slice(0,document.offsetAt(item.range.start))+item.replacement+document.source.slice(document.offsetAt(item.range.end));document.version++;changes.fire({document});editor.undo=()=>{document.source=previous;document.version++;changes.fire({document});};return true;}};
 class TabInputTextDiff{constructor(original,modified){this.original=original;this.modified=modified;}}
 const group={tabs:[]};
 const vscode={Range,Selection,Position,Uri:{from:uri},TabInputTextDiff,EndOfLine:{LF:1,CRLF:2},StatusBarAlignment:{Left:1},ProgressLocation:{Notification:15},
  workspace:{isTrusted:true,onDidChangeTextDocument:changes.event,onDidCloseTextDocument:closes.event,registerTextDocumentContentProvider:(scheme,provider)=>{snapshots.set(scheme,provider);return{dispose:()=>snapshots.delete(scheme)};}},
  window:{activeTextEditor:editor,onDidChangeActiveTextEditor:active.event,
   createStatusBarItem:()=>{const item={visible:false,disposed:false,show(){this.visible=true;},hide(){this.visible=false;},dispose(){this.disposed=true;}};statusItems.push(item);return item;},
   createInputBox:()=>{const accepted=new Emitter(),hidden=new Emitter(),change=new Emitter();const input={value:'',visible:false,disposed:false,onDidAccept:accepted.event,onDidHide:hidden.event,onDidChangeValue:change.event,show(){this.visible=true;},hide(){this.visible=false;hidden.fire();},dispose(){this.disposed=true;},accept(value){if(value!==undefined)this.value=value;accepted.fire();},change(value){this.value=value;change.fire(value);}};inputs.push(input);return input;},
   showInformationMessage:async(...args)=>{notices.push(args);return choice;},showWarningMessage:async message=>{warnings.push(message);},
   withProgress:async(options,fn)=>fn({report:()=>{}},{onCancellationRequested:cancel.event}),
   showTextDocument:async(doc,options)=>{shownDocuments.push({document:doc,options});if(showHook)await showHook(doc,options);vscode.window.activeTextEditor=editor;active.fire(editor);return editor;},
   tabGroups:{all:[group],onDidChangeTabs:tabsChanged.event,close:async(tabs,preserveFocus)=>{closedTabs.push({tabs,preserveFocus});group.tabs=group.tabs.filter(tab=>!tabs.includes(tab));tabsChanged.fire({closed:tabs});return true;}}},
  commands:{executeCommand:async(...args)=>{commands.push(args);if(args[0]==='vscode.diff'){if(diffHook)await diffHook(args);const tab={input:new TabInputTextDiff(args[1],args[2])};group.tabs.push(tab);vscode.window.activeTextEditor={document:{uri:args[2]}};active.fire(vscode.window.activeTextEditor);}}}};
 const service={status:()=>provider,generate:async request=>{requests.push(request);return generateHook?generateHook(request):{replacement,summary:'Clarify selected code.',model:'fixture-inline',providerKind:'compatible'};}};
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,AbortController,Error,Promise,require:name=>name==='vscode'?vscode:require(name)});
 const controller=new module.exports.InlineEditController({getService:()=>service,owner:()=>owner});
 const begin=async(prompt='Change the selected value.')=>{const pending=controller.start();await tick();if(prompt!==undefined&&inputs.at(-1))inputs.at(-1).accept(prompt);await pending;return pending;};
 const change=(source=document.source+'// LATER\n',emit=true)=>{document.source=source;document.version++;if(emit)changes.fire({document});};
 const content=()=>{const command=commands.findLast(args=>args[0]==='vscode.diff');return command&&{before:snapshots.get('foundation-inline').provideTextDocumentContent(command[1]),after:snapshots.get('foundation-inline').provideTextDocumentContent(command[2]),command};};
 return{controller,document,editor,vscode,inputs,requests,commands,notices,warnings,edits,statusItems,closedTabs,shownDocuments,snapshots,group,tabsChanged,changes,closes,cancel,begin,change,content,setOwner:value=>owner=value,setProvider:value=>provider=value,setGenerate:fn=>generateHook=fn,setShow:fn=>showHook=fn,setEdit:fn=>editHook=fn,setDiff:fn=>diffHook=fn,setChoice:value=>choice=value};
}

test('selection request discloses only the exact selected buffer text, language and instruction',async()=>{
 const h=harness();const pending=h.controller.start();await tick();assert.equal(h.controller.inspect().state,'input');assert.equal(h.requests.length,0);assert.match(h.inputs[0].prompt,/Send only this selection/);assert.match(h.inputs[0].prompt,/Includes selected unsaved text/);assert.match(h.inputs[0].prompt,/fixture-inline/);h.inputs[0].accept('  Change only this value.  ');await pending;
 assert.equal(h.requests.length,1);const{signal,...body}=h.requests[0];assert.deepEqual(body,{selection:'const value = 1;',languageId:'typescript',prompt:'Change only this value.'});assert.equal(signal.aborted,false);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_|src\/|fixture\/|history/);assert.equal(h.controller.inspect().state,'ready');assert.equal(h.edits.length,0);assert.equal(h.document.source,h.content().before);assert.match(h.content().after,/PRIVATE_BEFORE\nconst value = 2;\n\/\/ PRIVATE_AFTER/);await h.controller.dismiss();
});

test('accept is one exact native buffer replacement with undo boundaries and no save',async()=>{
 const h=harness(),before=h.document.source;await h.begin();assert.equal(await h.controller.accept(),true);assert.equal(h.edits.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.edits[0].options)),{undoStopBefore:true,undoStopAfter:true});assert.equal(h.edits[0].replacements.length,1);assert.equal(h.document.source,before.replace('const value = 1;','const value = 2;'));assert.equal(h.document.isDirty,true);assert.equal(h.controller.inspect().state,'idle');h.editor.undo();assert.equal(h.document.source,before);assert.equal(h.closedTabs.length,1);
});

test('unsupported document, trust, absent selection and size limits block before any request',async()=>{
 for(const kind of ['no-editor','no-owner','untrusted','virtual','closed','empty','multiple','large-selection','large-buffer']){
  const h=kind==='large-selection'?harness({text:'x'.repeat(17000),selected:'x'.repeat(17000)}):kind==='large-buffer'?harness({text:'x'.repeat(270000)+'chosen',selected:'chosen'}):harness();
  if(kind==='no-editor')h.vscode.window.activeTextEditor=undefined;if(kind==='no-owner')h.setOwner(undefined);if(kind==='untrusted')h.vscode.workspace.isTrusted=false;if(kind==='virtual')h.document.uri.scheme='untitled';if(kind==='closed')h.document.isClosed=true;if(kind==='empty'){h.editor.selection=new Selection(new Position(0,0),new Position(0,0));h.editor.selections=[h.editor.selection];}if(kind==='multiple')h.editor.selections.push(h.editor.selection);
  await h.controller.start();assert.equal(h.requests.length,0,kind);assert.equal(h.inputs.length,0,kind);assert.equal(h.edits.length,0,kind);h.controller.dispose();
 }
});

test('canceling instruction and invalid instructions never dispatch',async()=>{
 const h=harness(),pending=h.controller.start();await tick();const input=h.inputs[0];input.accept('  ');await tick();assert.match(input.validationMessage,/Describe/);input.accept('x'.repeat(2001));assert.match(input.validationMessage,/2,000/);assert.equal(h.requests.length,0);input.hide();await pending;assert.equal(h.controller.inspect().state,'idle');assert.equal(h.requests.length,0);assert.equal(input.disposed,true);
});

test('unconfigured provider offers setup without sharing selected code',async()=>{
 const h=harness();h.setProvider({configured:false});await h.controller.start();assert.equal(h.requests.length,0);assert.equal(h.inputs.length,0);assert.equal(h.commands.some(args=>args[0]==='foundation.configureAI'),false);h.setChoice('Set up AI');await h.controller.start();assert.equal(h.commands.some(args=>args[0]==='foundation.configureAI'),true);assert.equal(h.requests.length,0);
});

test('dismiss closes only the owned preview and never changes the dirty target',async()=>{
 const h=harness(),before=h.document.source,foreign={input:new h.vscode.TabInputTextDiff(uri({scheme:'other',path:'/before'}),uri({scheme:'other',path:'/after'}))};h.group.tabs.push(foreign);await h.begin();const preview=h.content().command;await h.controller.dismiss();assert.equal(h.edits.length,0);assert.equal(h.document.source,before);assert.deepEqual(h.group.tabs,[foreign]);assert.equal(h.snapshots.get('foundation-inline').provideTextDocumentContent(preview[1]),'This selection edit has ended.');assert.equal(h.statusItems.some(item=>item.visible),false);
});

test('explicit cancellation aborts only its request and ignores late model output',async()=>{
 const h=harness(),gate=deferred();h.setGenerate(()=>gate.promise);const pending=h.controller.start();await tick();h.inputs[0].accept('Edit');await tick();assert.equal(h.controller.inspect().state,'generating');await h.controller.dismiss();assert.equal(h.requests[0].signal.aborted,true);gate.resolve({replacement:'late',summary:'Late',model:'fixture-inline'});await pending;assert.equal(h.controller.inspect().state,'idle');assert.equal(h.commands.some(args=>args[0]==='vscode.diff'),false);assert.equal(h.edits.length,0);assert.equal(h.warnings.length,0);
});

test('native progress cancellation retires the same request',async()=>{
 const h=harness(),gate=deferred();h.setGenerate(()=>gate.promise);const pending=h.controller.start();await tick();h.inputs[0].accept('Edit');await tick();h.cancel.fire();assert.equal(h.requests[0].signal.aborted,true);gate.resolve({replacement:'late',summary:'Late',model:'fixture-inline'});await pending;assert.equal(h.controller.inspect().state,'idle');assert.equal(h.edits.length,0);
});

test('document changes invalidate input, generation and preview without overwriting newer edits',async()=>{
 for(const phase of ['input','generating','ready']){
  const h=harness(),gate=deferred();if(phase==='generating')h.setGenerate(()=>gate.promise);const pending=h.controller.start();await tick();if(phase!=='input'){h.inputs[0].accept('Edit');await tick();}if(phase==='ready')await pending;
  h.change();const after=h.document.source;gate.resolve({replacement:'late',summary:'Late',model:'fixture-inline'});await pending;await tick();assert.equal(h.controller.inspect().state,'idle',phase);assert.equal(await h.controller.accept(),false);assert.equal(h.edits.length,0,phase);assert.equal(h.document.source,after);assert.equal(h.group.tabs.length,0,phase);
 }
});

test('unrelated document edits do not discard a valid suggestion',async()=>{
 const h=harness();await h.begin();h.changes.fire({document:{uri:uri({path:'/fixture/other.ts'})}});assert.equal(h.controller.inspect().state,'ready');assert.equal(await h.controller.accept(),true);
});

test('exact version and full buffer guard rejects edit-undo replay or changed unselected content',async()=>{
 for(const kind of ['same-bytes-new-version','unselected-source','same-version-source']){
  const h=harness();await h.begin();if(kind==='same-bytes-new-version')h.document.version++;if(kind==='unselected-source')h.change('// NEW\n'+h.document.source,false);if(kind==='same-version-source')h.document.source+='// NEW';assert.equal(await h.controller.accept(),false,kind);assert.equal(h.edits.length,0,kind);assert.equal(h.controller.inspect().state,'idle',kind);
 }
});

test('trust, ownership and document closure are rechecked before accept',async()=>{
 for(const kind of ['trust','owner','closed']){const h=harness();await h.begin();if(kind==='trust')h.vscode.workspace.isTrusted=false;if(kind==='owner')h.setOwner({key:'other-project',path:'src/value.ts'});if(kind==='closed')h.document.isClosed=true;assert.equal(await h.controller.accept(),false,kind);assert.equal(h.edits.length,0);assert.equal(h.controller.inspect().state,'idle');}
});

test('asynchronous editor reveal cannot bypass version, trust, ownership or cancellation guards',async()=>{
 for(const kind of ['source','trust','owner','dismiss']){const h=harness(),gate=deferred();await h.begin();h.setShow(()=>gate.promise);const accepting=h.controller.accept();await tick();if(kind==='source')h.change();if(kind==='trust')h.vscode.workspace.isTrusted=false;if(kind==='owner')h.setOwner({key:'other',path:'src/value.ts'});if(kind==='dismiss')await h.controller.dismiss();gate.resolve();assert.equal(await accepting,false,kind);assert.equal(h.edits.length,0,kind);assert.equal(h.controller.inspect().state,'idle');}
});

test('duplicate Accept while editor reveal waits cannot apply twice',async()=>{
 const h=harness(),gate=deferred();await h.begin();h.setShow(()=>gate.promise);const first=h.controller.accept();await tick();assert.equal(h.controller.inspect().state,'applying');assert.equal(await h.controller.accept(),false);gate.resolve();assert.equal(await first,true);assert.equal(h.edits.length,1);
});

test('native edit rejection and reveal failure produce no automatic retry or save',async()=>{
 for(const kind of ['rejected','reveal-error']){const h=harness(),before=h.document.source;await h.begin();if(kind==='rejected')h.setEdit(()=>false);else h.setShow(()=>{throw Error('secret details');});assert.equal(await h.controller.accept(),false);assert.equal(h.document.source,before);assert.equal(h.controller.inspect().state,'idle');assert.equal(h.warnings.length,1);assert.doesNotMatch(h.warnings[0],/secret details/);}
});

test('CRLF selection accepts normalized newlines while preserving its surroundings',async()=>{
 const h=harness({text:'// before\r\nconst value = 1;\r\n// after\r\n',replacement:'const value = 2;\nconst second = 3;',eol:2});await h.begin();assert.equal(await h.controller.accept(),true);assert.equal(h.document.source,'// before\r\nconst value = 2;\r\nconst second = 3;\r\n// after\r\n');
});

test('empty replacement deletes exactly the selection and remains undoable',async()=>{
 const h=harness({replacement:''}),before=h.document.source;await h.begin();assert.equal(await h.controller.accept(),true);assert.equal(h.document.source,before.replace('const value = 1;',''));h.editor.undo();assert.equal(h.document.source,before);
});

test('a suggestion identical after newline normalization is not actionable',async()=>{
 const h=harness({text:'const one = 1;\r\nconst two = 2;',selected:'const one = 1;\r\nconst two = 2;',replacement:'const one = 1;\nconst two = 2;',eol:2});await h.begin();assert.equal(h.controller.inspect().state,'idle');assert.equal(h.edits.length,0);assert.match(h.warnings[0],/does not change/);
});

test('provider failure is sanitized and exposes no partial actionable result',async()=>{
 const h=harness();h.setGenerate(()=>{throw Error('SECRET_URL=private');});await h.begin();assert.equal(h.controller.inspect().state,'idle');assert.equal(h.edits.length,0);assert.equal(h.commands.some(args=>args[0]==='vscode.diff'),false);assert.doesNotMatch(h.warnings[0],/SECRET/);
});

test('closing the owned preview dismisses it while unrelated tab closure does not',async()=>{
 const h=harness();await h.begin();h.tabsChanged.fire({closed:[{input:{}}]});assert.equal(h.controller.inspect().state,'ready');const tab=h.group.tabs[0];h.group.tabs=[];h.tabsChanged.fire({closed:[tab]});await tick();assert.equal(h.controller.inspect().state,'idle');assert.equal(h.edits.length,0);
});

test('starting another request never silently replaces an in-flight or ready edit',async()=>{
 const h=harness(),pending=h.controller.start();await tick();await h.controller.start();assert.equal(h.inputs.length,1);h.inputs[0].accept('Edit');await pending;await h.controller.start();assert.equal(h.requests.length,1);assert.equal(h.controller.inspect().state,'ready');await h.controller.dismiss();
});

test('disposal clears preview snapshots and cancels pending generation without subsequent source edits',async()=>{
 const h=harness(),gate=deferred();h.setGenerate(()=>gate.promise);const pending=h.controller.start();await tick();h.inputs[0].accept('Edit');await tick();h.controller.dispose();gate.resolve({replacement:'late',summary:'Late',model:'fixture-inline'});await pending;assert.equal(h.requests[0].signal.aborted,true);assert.equal(h.controller.inspect().state,'idle');assert.equal(h.snapshots.size,0);assert.equal(h.statusItems.every(item=>item.disposed),true);await h.controller.start();assert.equal(h.requests.length,1);assert.equal(h.edits.length,0);
});

test('a provider completion with changed ownership retires the now-stale generation',async()=>{
 for(const kind of ['owner','trust','closed']){
  const h=harness(),gate=deferred();h.setGenerate(()=>gate.promise);const pending=h.controller.start();await tick();h.inputs[0].accept('Edit');await tick();
  if(kind==='owner')h.setOwner({key:'other-project',path:'src/value.ts'});if(kind==='trust')h.vscode.workspace.isTrusted=false;if(kind==='closed')h.document.isClosed=true;
  gate.resolve({replacement:'late',summary:'Late',model:'fixture-inline'});await pending;assert.equal(h.controller.inspect().state,'idle',kind);assert.equal(h.commands.some(args=>args[0]==='vscode.diff'),false);assert.equal(h.edits.length,0);
 }
});

test('dismiss while a diff is opening closes a late owned preview without disturbing a new session',async()=>{
 const h=harness(),gate=deferred();h.setDiff(()=>gate.promise);const first=h.controller.start();await tick();h.inputs[0].accept('Edit');await tick();assert.equal(h.controller.inspect().state,'ready');await h.controller.dismiss();assert.equal(h.controller.inspect().state,'idle');const second=h.controller.start();await tick();assert.equal(h.controller.inspect().state,'input');gate.resolve();await first;assert.equal(h.group.tabs.length,0);assert.equal(h.edits.length,0);assert.equal(h.controller.inspect().state,'input');assert.equal(h.requests.length,1);h.inputs.at(-1).hide();await second;assert.equal(h.controller.inspect().state,'idle');
});

test('idle construction never generates or restores a suggestion, and review labels remain unverified',async()=>{
 const h=harness();assert.equal(h.controller.inspect().state,'idle');assert.equal(h.requests.length,0);assert.equal(h.inputs.length,0);assert.equal(h.edits.length,0);await h.begin();const state=h.controller.inspect();assert.equal(state.summary,'Clarify selected code.');assert.equal(state.model,'fixture-inline');assert.doesNotMatch(JSON.stringify(state),/PRIVATE_|const value/);const review=h.statusItems.find(item=>item.command==='foundation.reviewInlineEdit');assert.match(review.tooltip,/AI suggestion · Not checked/);assert.match(review.tooltip,/fixture-inline/);assert.equal(h.requests.length,1);await h.controller.review();assert.equal(h.requests.length,1);await h.controller.dismiss();
});

test('concurrent native tab-close failure cannot reactivate a retired suggestion or retain its source snapshots',async()=>{
 const h=harness();await h.begin();const preview=h.content().command;h.vscode.window.tabGroups.close=async()=>{throw Error('tab already closing');};await h.controller.dismiss();assert.equal(h.controller.inspect().state,'idle');assert.equal(h.snapshots.get('foundation-inline').provideTextDocumentContent(preview[1]),'This selection edit has ended.');assert.equal(h.snapshots.get('foundation-inline').provideTextDocumentContent(preview[2]),'This selection edit has ended.');assert.equal(await h.controller.accept(),false);assert.equal(h.edits.length,0);
});

test('explicit dismissal of the active owned preview returns to the captured source and selection before closing it',async()=>{
 const h=harness(),before=h.document.source,captured=h.editor.selection;await h.begin();const close=h.vscode.window.tabGroups.close;
 h.vscode.window.tabGroups.close=async(...args)=>{assert.equal(h.vscode.window.activeTextEditor.document,h.document,'Return to source before the diff tab closes.');return close(...args);};
 await h.controller.dismiss(true);assert.equal(h.shownDocuments.length,1);const shown=h.shownDocuments[0];assert.equal(shown.document,h.document);assert.equal(shown.options.viewColumn,2);assert.equal(shown.options.preserveFocus,false);assert.deepEqual(JSON.parse(JSON.stringify(shown.options.selection)),JSON.parse(JSON.stringify(captured)));assert.equal(h.vscode.window.activeTextEditor.document,h.document);assert.equal(h.document.source,before);assert.equal(h.edits.length,0);assert.equal(h.group.tabs.length,0);assert.equal(h.controller.inspect().state,'idle');
});

test('background dismissal, source invalidation and disposal never reveal or focus the captured source',async()=>{
 for(const kind of ['background-explicit','background-internal','source-invalidation','dispose']){
  const h=harness();await h.begin();const foreign={document:{uri:uri({path:'/fixture/other.ts'})}};h.vscode.window.activeTextEditor=foreign;
  if(kind==='background-explicit')await h.controller.dismiss(true);if(kind==='background-internal')await h.controller.dismiss();if(kind==='source-invalidation')h.change();if(kind==='dispose')h.controller.dispose();await tick();
  assert.equal(h.shownDocuments.length,0,kind);assert.equal(h.vscode.window.activeTextEditor,foreign,kind);assert.equal(h.edits.length,0,kind);assert.equal(h.controller.inspect().state,'idle',kind);
 }
});

test('explicit dismissal never returns to a closed, stale or differently owned document',async()=>{
 for(const kind of ['owner','trust','closed','version']){const h=harness();await h.begin();if(kind==='owner')h.setOwner({key:'other',path:'src/value.ts'});if(kind==='trust')h.vscode.workspace.isTrusted=false;if(kind==='closed')h.document.isClosed=true;if(kind==='version')h.document.version++;
  await h.controller.dismiss(true);assert.equal(h.shownDocuments.length,0,kind);assert.equal(h.edits.length,0);assert.equal(h.controller.inspect().state,'idle');}
});

test('nearby edit uses the guarded native diff and exact native Undo without a provider request',async()=>{
 const h=harness(),before=h.document.source,range=h.editor.selection;
 assert.equal(await h.controller.previewExternal({document:h.document,version:h.document.version,before,range,replacement:'const value = 3;',summary:'Use the updated value.',model:'fixture'}),true);
 assert.equal(h.requests.length,0);assert.equal(h.inputs.length,0);assert.equal(h.edits.length,0);assert.equal(h.content().before,before);assert.equal(h.content().after,before.replace('const value = 1;','const value = 3;'));
 assert.equal(await h.controller.accept(),true);h.editor.undo();assert.equal(h.document.source,before);
});

test('nearby edit rejects stale snapshots, invalid ranges, oversized results and conflicting selection edits',async()=>{
 for(const kind of ['version','source','owner','closed','trust','foreign-editor','empty','outside','replacement','summary','lines','busy']){
  const h=harness(),before=h.document.source,input={document:h.document,version:h.document.version,before,range:h.editor.selection,replacement:'const value = 3;',summary:'Use updated value.',model:'fixture'};
  if(kind==='version')h.document.version++;if(kind==='source')h.document.source+='// LOCAL';if(kind==='owner')h.setOwner(undefined);if(kind==='closed')h.document.isClosed=true;if(kind==='trust')h.vscode.workspace.isTrusted=false;if(kind==='foreign-editor')h.vscode.window.activeTextEditor={document:{}};
  if(kind==='empty')input.range=new Range(new Position(0,0),new Position(0,0));if(kind==='outside')input.range=new Range(new Position(100,0),new Position(101,0));if(kind==='replacement')input.replacement='x'.repeat(4097);if(kind==='summary')input.summary='';if(kind==='lines')input.replacement='x\n'.repeat(13);if(kind==='busy')await h.begin();
  assert.equal(await h.controller.previewExternal(input),false,kind);assert.equal(h.edits.length,0,kind);h.controller.dispose();
 }
});

test('nearby edit dismissed from diff returns to the initiating caret rather than the proposed target',async()=>{
 const h=harness(),before=h.document.source,range=h.editor.selection;
 const caret=new Selection(new Position(2,0),new Position(2,0));h.editor.selection=caret;h.editor.selections=[caret];
 await h.controller.previewExternal({document:h.document,version:h.document.version,before,range,replacement:'const value = 3;',summary:'Use updated value.',model:'fixture'});
 await h.controller.dismiss(true);assert.deepEqual(h.shownDocuments.at(-1).options.selection,new Range(caret.start,caret.end));assert.equal(h.document.source,before);
});

test('nearby edit opening races retire the exact snapshot and never accept later source',async()=>{
 const h=harness(),gate=deferred(),before=h.document.source;h.setDiff(()=>gate.promise);
 const reviewing=h.controller.previewExternal({document:h.document,version:h.document.version,before,range:h.editor.selection,replacement:'const value = 3;',summary:'Use updated value.',model:'fixture'});
 await tick();h.change();gate.resolve();assert.equal(await reviewing,false);assert.equal(await h.controller.accept(),false);assert.equal(h.edits.length,0);assert.equal(h.group.tabs.length,0);
});
