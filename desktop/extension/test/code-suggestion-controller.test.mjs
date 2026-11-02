import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(join(root,'package.json')),ts=require('typescript');
const compiled=ts.transpileModule(readFileSync(join(root,'desktop/extension/src/code-suggestion-controller.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const tick=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
class Emitter{listeners=new Set();event=listener=>{this.listeners.add(listener);return{dispose:()=>this.listeners.delete(listener)};};fire(value){for(const listener of [...this.listeners])listener(value);}}
class Position{constructor(line,character){this.line=line;this.character=character;}}
class Range{constructor(start,end){this.start=start;this.end=end;}get isEmpty(){return this.start.line===this.end.line&&this.start.character===this.end.character;}}
class Selection extends Range{constructor(start,end){super(start,end);this.active=end;this.anchor=start;}}
class InlineCompletionItem{constructor(insertText,range,command){Object.assign(this,{insertText,range,command});}}
function harness({text='const answer = ',offset=text.length,eol=1}={}){
 const changes=new Emitter(),closes=new Emitter(),active=new Emitter(),selectionChanges=new Emitter();
 const requests=[],commands=[],notices=[],reviews=[],statuses=[],timers=new Map();
 let now=0,timerId=0,owner={key:'project-config-1',path:'src/value.ts'},busy=false,choice='Start suggestions',configured=true,generateHook,reviewHook,provider;
 const document={uri:{scheme:'file',fsPath:'/fixture/src/value.ts',toString(){return 'file:'+this.fsPath;}},version:1,isClosed:false,isDirty:true,languageId:'typescript',eol,source:text,
  getText(range){return range?this.source.slice(this.offsetAt(range.start),this.offsetAt(range.end)):this.source;},
  offsetAt(p){return this.source.split('\n').slice(0,p.line).reduce((n,line)=>n+line.length+1,0)+p.character;},
  positionAt(n){const parts=this.source.slice(0,n).split('\n');return new Position(parts.length-1,parts.at(-1).length);},save(){throw Error('Suggestions must never save');}};
 const caret=document.positionAt(offset),editor={document,selection:new Selection(caret,caret),selections:[],edit(){throw Error('Controller must never edit');}};editor.selections=[editor.selection];
 const service={status:()=>({configured,provider:'127.0.0.1:1234',model:'fixture-suggestions'}),generate:async input=>{requests.push(input);return generateHook?generateHook(input):{kind:'completion',text:'42;',model:'fixture-suggestions',providerKind:'compatible'};}};
 const vscode={Position,Range,Selection,InlineCompletionItem,InlineCompletionTriggerKind:{Invoke:0,Automatic:1},StatusBarAlignment:{Left:1},EndOfLine:{LF:1,CRLF:2},
  languages:{registerInlineCompletionItemProvider:(selector,value)=>{assert.deepEqual(JSON.parse(JSON.stringify(selector)),{scheme:'file'});provider=value;return{dispose(){provider=undefined;}};}},
  workspace:{isTrusted:true,onDidChangeTextDocument:changes.event,onDidCloseTextDocument:closes.event},
  window:{activeTextEditor:editor,onDidChangeActiveTextEditor:active.event,onDidChangeTextEditorSelection:selectionChanges.event,
   showInformationMessage:async(...args)=>{notices.push(args);return typeof choice==='function'?choice(args):choice;},
   createStatusBarItem:()=>{const item={visible:false,show(){this.visible=true;},hide(){this.visible=false;},dispose(){this.disposed=true;}};statuses.push(item);return item;}},
  commands:{executeCommand:async(...args)=>{commands.push(args);}}};
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,AbortController,Promise,Error,
  setTimeout:(callback,ms)=>{const id=++timerId;timers.set(id,{callback,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),
  require:name=>name==='vscode'?vscode:name==='node:perf_hooks'?{performance:{now:()=>now}}:require(name)});
 const controller=new module.exports.CodeSuggestionController({getService:()=>service,owner:()=>owner,isBusy:()=>busy,reviewEdit:async input=>{reviews.push(input);return reviewHook?reviewHook(input):true;}});
 const move=(n,emit=true)=>{const p=document.positionAt(n);editor.selection=new Selection(p,p);editor.selections=[editor.selection];if(emit)selectionChanges.fire({textEditor:editor});};
 const change=(insert='x',start=document.offsetAt(editor.selection.active),length=0)=>{document.source=document.source.slice(0,start)+insert+document.source.slice(start+length);document.version++;changes.fire({document,contentChanges:[{rangeOffset:start,rangeLength:length,text:insert}]});move(start+insert.length);};
 const provide=async({automatic=false,selected=false,token}={})=>Array.from(await provider.provideInlineCompletionItems(document,editor.selection.active,{triggerKind:automatic?1:0,selectedCompletionInfo:selected?{}:undefined},token||{isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})}));
 const advance=async(ms=250)=>{now+=ms;for(const[id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}await tick();};
 return{controller,vscode,document,editor,requests,commands,notices,reviews,statuses,timers,changes,closes,active,selectionChanges,provide,change,move,advance,
  setOwner:value=>owner=value,setBusy:value=>busy=value,setChoice:value=>choice=value,setConfigured:value=>configured=value,setGenerate:value=>generateHook=value,setReview:value=>reviewHook=value};
}

test('suggestions start off; opt-in discloses local context and starts no request',async()=>{
 const h=harness();assert.equal(h.controller.inspect().state,'off');assert.deepEqual(await h.provide(),[]);assert.equal(await h.controller.request(),false);assert.equal(h.requests.length,0);
 assert.equal(await h.controller.start(),true);assert.equal(h.controller.inspect().enabled,true);assert.match(h.notices[0][1].detail,/12 KiB/);assert.match(h.notices[0][1].detail,/including unsaved text/);assert.match(h.notices[0][1].detail,/127\.0\.0\.1:1234/);assert.match(h.notices[0][1].detail,/File paths, other files and Assistant history stay local/);assert.equal(h.requests.length,0);
 assert.equal(await h.controller.request(),true);assert.equal(h.commands.at(-1)[0],'editor.action.inlineSuggest.trigger');h.controller.dispose();
});

test('cancelled or outdated disclosure cannot enable automatic sharing',async()=>{
 for(const kind of ['cancel','stop','owner','trust','editor','dispose']){
  const h=harness(),gate=deferred();h.setChoice(()=>gate.promise);const start=h.controller.start();await tick();
  if(kind==='cancel')gate.resolve(undefined);if(kind==='stop')h.controller.stop();if(kind==='owner')h.setOwner({key:'other',path:'value.ts'});if(kind==='trust')h.vscode.workspace.isTrusted=false;if(kind==='editor')h.vscode.window.activeTextEditor=undefined;if(kind==='dispose')h.controller.dispose();gate.resolve('Start suggestions');assert.equal(await start,false,kind);assert.equal(h.controller.inspect().enabled,false,kind);assert.equal(h.requests.length,0);
 }
});

test('provider absence, unsupported owner and trust prevent start',async()=>{
 for(const kind of ['provider','owner','trust','virtual','no-editor']){
  const h=harness();if(kind==='provider')h.setConfigured(false);if(kind==='owner')h.setOwner(undefined);if(kind==='trust')h.vscode.workspace.isTrusted=false;if(kind==='virtual')h.document.uri.scheme='untitled';if(kind==='no-editor')h.vscode.window.activeTextEditor=undefined;
  assert.equal(await h.controller.start(),false,kind);assert.equal(h.requests.length,0);assert.equal(h.controller.inspect().enabled,false);
 }
 const h=harness();h.setConfigured(false);h.setChoice('Set up AI');await h.controller.start();assert.equal(h.commands.at(-1)[0],'foundation.configureAI');
});

test('only bounded caret context and language reach generation; insert-only range is native-owned',async()=>{
 const before='PRIVATE_OUTSIDE\n'+Array.from({length:25},(_,i)=>`const before${i} = ${i};`).join('\n')+'\nconst answer = ',after='\n'+Array.from({length:15},(_,i)=>`const after${i} = ${i};`).join('\n')+'\nPRIVATE_AFTER';
 const h=harness({text:before+after,offset:before.length});await h.controller.start();const items=await h.provide();assert.equal(items.length,1);const{signal,...request}=h.requests[0];assert.deepEqual(Object.keys(request).sort(),['languageId','prefix','suffix']);assert.doesNotMatch(JSON.stringify(request),/PRIVATE_|\/fixture|src\/value|history/);assert.equal(request.languageId,'typescript');assert.equal(request.prefix.split('\n').length,20);assert.equal(request.suffix.split('\n').length,10);assert.equal(items[0].range.isEmpty,true);assert.equal(items[0].insertText,'42;');assert.equal(items[0].command.command,'foundation.codeSuggestionAccepted');assert.equal(h.document.getText(),before+after);assert.equal(h.controller.inspect().metrics.published,1);assert.doesNotMatch(JSON.stringify(h.controller.inspect()),/const answer|before20/);
});

test('context caps preserve Unicode and avoid splitting astral code points',async()=>{
 const left='🚀'.repeat(4000),right='🚀'.repeat(4000),h=harness({text:left+right,offset:left.length});await h.controller.start();await h.provide();const request=h.requests[0];assert.equal(request.prefix.isWellFormed(),true);assert.equal(request.suffix.isWellFormed(),true);assert.ok(Buffer.byteLength(request.prefix+request.suffix)<=12288);assert.equal(request.prefix.length%2,0);assert.equal(request.suffix.length%2,0);
});

test('automatic requests need a fresh single content edit at its resulting caret and wait 250ms',async()=>{
 const h=harness();await h.controller.start();assert.deepEqual(await h.provide({automatic:true}),[]);h.change('4');const pending=h.provide({automatic:true});await tick();assert.equal(h.requests.length,0);await h.advance(249);assert.equal(h.requests.length,0);await h.advance(1);assert.equal((await pending).length,1);assert.equal(h.requests.length,1);assert.deepEqual(await h.provide({automatic:true}),[]);h.move(0);assert.deepEqual(await h.provide({automatic:true}),[]);assert.equal(h.requests.length,1);
});

test('superseding typing cancels debounce and sends only the final context',async()=>{
 const h=harness();await h.controller.start();h.change('4');const first=h.provide({automatic:true});await h.advance(100);h.change('2');const second=h.provide({automatic:true});await h.advance(250);assert.deepEqual(await first,[]);assert.equal((await second).length,1);assert.equal(h.requests.length,1);assert.match(h.requests[0].prefix,/42$/);
});

test('selection, multicursor, selected native completion, oversized and closed buffers never dispatch',async()=>{
 for(const kind of ['selection','multicursor','selected-widget','large','closed','busy','owner','trust']){
  const h=harness();await h.controller.start();if(kind==='selection'){h.editor.selection=new Selection(new Position(0,0),new Position(0,3));h.editor.selections=[h.editor.selection];}if(kind==='multicursor')h.editor.selections.push(h.editor.selection);if(kind==='large'){h.document.source='x'.repeat(262145);h.move(h.document.source.length);}if(kind==='closed')h.document.isClosed=true;if(kind==='busy')h.setBusy(true);if(kind==='owner')h.setOwner({key:'other',path:'value.ts'});if(kind==='trust')h.vscode.workspace.isTrusted=false;
  assert.deepEqual(await h.provide({selected:kind==='selected-widget'}),[],kind);assert.equal(h.requests.length,0,kind);
 }
});

test('cancellation token and stop abort requests and discard late results',async()=>{
 for(const kind of ['token','stop','interrupt']){
  const h=harness(),gate=deferred(),cancel=new Emitter();await h.controller.start();h.setGenerate(()=>gate.promise);const pending=h.provide({token:{isCancellationRequested:false,onCancellationRequested:cancel.event}});await tick();
  if(kind==='token')cancel.fire();else if(kind==='stop')h.controller.stop();else h.controller.interrupt();assert.equal(h.requests[0].signal.aborted,true);gate.resolve({kind:'completion',text:'LATE',model:'fixture'});assert.deepEqual(await pending,[]);assert.equal(h.controller.inspect().metrics.published,0);assert.equal(h.controller.inspect().enabled,kind!=='stop');assert.equal(h.controller.inspect().metrics.cancelled,1);
 }
});

test('explicit replacement waits for cancelled predecessor before dispatching latest context',async()=>{
 const h=harness(),gate=deferred();await h.controller.start();h.setGenerate(()=>h.requests.length===1?gate.promise:{kind:'completion',text:'LATEST',model:'fixture'});
 const first=h.provide();await tick();h.change('4');const second=h.provide();await tick();assert.equal(h.requests.length,1);assert.equal(h.requests[0].signal.aborted,true);gate.resolve({kind:'completion',text:'OLD',model:'fixture'});assert.deepEqual(await first,[]);assert.equal((await second)[0].insertText,'LATEST');assert.equal(h.requests.length,2);assert.match(h.requests[1].prefix,/4$/);
});

test('cancelled successor never dispatches while predecessor cancellation settles',async()=>{
 const h=harness(),gate=deferred();await h.controller.start();h.setGenerate(()=>gate.promise);const first=h.provide();await tick();const second=h.provide();await tick();h.controller.stop();assert.deepEqual(await second,[]);assert.equal(h.requests.length,1);gate.resolve({kind:'none',model:'fixture'});assert.deepEqual(await first,[]);
});

test('document, caret, active editor, version, ownership and trust changes reject late results',async()=>{
 for(const kind of ['source','caret','editor','version','same-version-bytes','owner','trust','closed','busy']){
  const h=harness(),gate=deferred();await h.controller.start();h.setGenerate(()=>gate.promise);const pending=h.provide();await tick();
  if(kind==='source')h.change('new');if(kind==='caret')h.move(0);if(kind==='editor'){h.vscode.window.activeTextEditor=undefined;h.active.fire();}if(kind==='version')h.document.version++;if(kind==='same-version-bytes')h.document.source+='x';if(kind==='owner')h.setOwner({key:'changed',path:'value.ts'});if(kind==='trust')h.vscode.workspace.isTrusted=false;if(kind==='closed')h.document.isClosed=true;if(kind==='busy')h.setBusy(true);
  gate.resolve({kind:'completion',text:'LATE',model:'fixture'});assert.deepEqual(await pending,[],kind);assert.equal(h.controller.inspect().metrics.published,0,kind);
 }
});

test('native completion publication is cleared without focus change on interruption',async()=>{
 const h=harness();await h.controller.start();await h.provide();const editor=h.vscode.window.activeTextEditor;h.controller.interrupt();assert.equal(h.controller.inspect().enabled,true);assert.equal(h.commands.some(args=>args[0]==='editor.action.inlineSuggest.hide'),true);assert.equal(h.vscode.window.activeTextEditor,editor);assert.equal(h.reviews.length,0);
});

test('same-position selection events retain a live suggestion',async()=>{
 const h=harness();await h.controller.start();await h.provide();const count=h.commands.filter(args=>args[0]==='editor.action.inlineSuggest.hide').length;h.selectionChanges.fire({textEditor:h.editor});assert.equal(h.commands.filter(args=>args[0]==='editor.action.inlineSuggest.hide').length,count);
});

test('matching native word and line acceptance retain the remaining ghost without another request',async()=>{
 const h=harness();await h.controller.start();h.setGenerate(()=>({kind:'completion',text:'calculate(value);\nreturn value;',model:'fixture'}));await h.provide();
 const hideCount=()=>h.commands.filter(args=>args[0]==='editor.action.inlineSuggest.hide').length;
 const count=hideCount();h.change('calculate');assert.equal(hideCount(),count);assert.deepEqual(await h.provide({automatic:true}),[]);h.change('(value);\n');assert.equal(hideCount(),count);assert.deepEqual(await h.provide({automatic:true}),[]);assert.equal(h.requests.length,1);h.selectionChanges.fire({textEditor:h.editor});assert.equal(hideCount(),count);
});

test('nonmatching or overlapping local edits dismiss a published ghost',async()=>{
 for(const kind of ['different','overlap','elsewhere']){
  const h=harness();await h.controller.start();await h.provide();const before=h.commands.filter(args=>args[0]==='editor.action.inlineSuggest.hide').length;
  if(kind==='different')h.change('wrong');if(kind==='overlap')h.change('4',h.document.source.length-1,1);if(kind==='elsewhere')h.change('4',0);
  assert.equal(h.commands.filter(args=>args[0]==='editor.action.inlineSuggest.hide').length,before+1,kind);
 }
});

test('save and dirty-state lifecycle events preserve an unchanged pending request or ghost',async()=>{
 const h=harness(),gate=deferred();await h.controller.start();h.setGenerate(()=>gate.promise);const pending=h.provide();await tick();h.changes.fire({document:h.document,contentChanges:[]});assert.equal(h.requests[0].signal.aborted,false);gate.resolve({kind:'completion',text:'42;',model:'fixture'});assert.equal((await pending).length,1);const count=h.commands.filter(args=>args[0]==='editor.action.inlineSuggest.hide').length;h.changes.fire({document:h.document,contentChanges:[]});assert.equal(h.commands.filter(args=>args[0]==='editor.action.inlineSuggest.hide').length,count);
});

test('acceptance command records once after native insertion and suppresses immediate chaining',async()=>{
 const h=harness();await h.controller.start();const [item]=await h.provide();h.change(item.insertText);const id=item.command.arguments[0];h.controller.accepted(id);h.controller.accepted(id);h.controller.accepted('forged');assert.equal(h.controller.inspect().metrics.accepted,1);assert.deepEqual(await h.provide({automatic:true}),[]);assert.equal(h.document.source,'const answer = 42;');
});

test('next edit stays local until reviewed and maps the exact context anchor',async()=>{
 const h=harness({text:'const oldLabel = "Save";\nconst value = ',offset:36});h.move(h.document.source.length);await h.controller.start();h.setGenerate(()=>({kind:'edit',oldText:'oldLabel',newText:'label',summary:'Clarify this name.',model:'fixture'}));assert.deepEqual(await h.provide(),[]);assert.equal(h.controller.inspect().state,'next-edit');assert.equal(h.reviews.length,0);assert.equal(h.statuses[0].text,'$(arrow-right) Next edit');assert.match(h.statuses[0].tooltip,/Not checked/);const before=h.document.source;assert.equal(await h.controller.reviewNextEdit(),true);assert.equal(h.reviews.length,1);const preview=h.reviews[0];assert.equal(preview.document,h.document);assert.equal(preview.version,h.document.version);assert.equal(preview.before,before);assert.equal(h.document.getText(preview.range),'oldLabel');assert.equal(preview.replacement,'label');assert.equal(h.document.source,before);assert.equal(h.controller.inspect().state,'enabled');
});

test('next edit dismissal and edit-undo replay cannot reopen or apply stale proposals',async()=>{
 for(const kind of ['dismiss','version','bytes','caret','owner']){
  const h=harness({text:'const oldLabel = "Save";'});await h.controller.start();h.setGenerate(()=>({kind:'edit',oldText:'oldLabel',newText:'label',summary:'Clarify.',model:'fixture'}));await h.provide();
  if(kind==='dismiss')h.controller.dismissNextEdit();if(kind==='version')h.document.version+=2;if(kind==='bytes')h.document.source+='x';if(kind==='caret')h.move(0);if(kind==='owner')h.setOwner({key:'different',path:'value.ts'});
  assert.equal(await h.controller.reviewNextEdit(),false,kind);assert.equal(h.reviews.length,0,kind);assert.equal(h.controller.inspect().state,'enabled');
 }
});

test('invalid, repeated, absent, caret-crossing and oversized next-edit anchors cannot review',async()=>{
 for(const kind of ['duplicate','absent','crossing','unchanged','large','lines','bad-summary']){
  const h=harness({text:'aaaa\nconst answer = ',offset:2});await h.controller.start();let result={kind:'edit',oldText:'aa',newText:'b',summary:'Short.',model:'fixture'};
  if(kind==='absent')result.oldText='missing';if(kind==='crossing')result.oldText='aaaa';if(kind==='unchanged'){result.oldText='const answer';result.newText=result.oldText;}if(kind==='large'){result.oldText='const answer';result.newText='x'.repeat(4097);}if(kind==='lines'){result.oldText='const answer';result.newText='x\n'.repeat(13);}if(kind==='bad-summary'){result.oldText='const answer';result.summary='';}
  h.setGenerate(()=>result);assert.deepEqual(await h.provide(),[],kind);assert.equal(await h.controller.reviewNextEdit(),false,kind);assert.equal(h.controller.inspect().metrics.errors,1,kind);
 }
});

test('CRLF normalization applies to returned insertion and reviewed next edit only',async()=>{
 const h=harness({text:'const old = 1;\r\nconst next = ',eol:2});await h.controller.start();h.setGenerate(()=>({kind:'completion',text:'2;\n',model:'fixture'}));assert.equal((await h.provide())[0].insertText,'2;\r\n');h.setGenerate(()=>({kind:'edit',oldText:'const old = 1;',newText:'const old = 2;\n',summary:'Update.',model:'fixture'}));await h.provide();await h.controller.reviewNextEdit();assert.equal(h.reviews[0].replacement,'const old = 2;\r\n');
});

test('none and provider failure are quiet, sanitized outcomes with no source change',async()=>{
 const h=harness(),before=h.document.source;await h.controller.start();h.setGenerate(()=>({kind:'none',model:'fixture'}));assert.deepEqual(await h.provide(),[]);assert.equal(h.controller.inspect().metrics.none,1);h.setGenerate(()=>{throw Error('SECRET PROVIDER DETAIL');});assert.deepEqual(await h.provide(),[]);assert.equal(h.controller.inspect().metrics.errors,1);assert.doesNotMatch(JSON.stringify(h.controller.inspect()),/SECRET/);assert.equal(h.notices.length,1);assert.equal(h.document.source,before);
});

test('request rate limit pauses visibly and cannot be bypassed by pause/resume',async()=>{
 const h=harness();await h.controller.start();h.setGenerate(()=>({kind:'none',model:'fixture'}));for(let i=0;i<20;i++)await h.provide();assert.equal(h.requests.length,20);await h.provide();assert.equal(h.controller.inspect().state,'paused');assert.equal(h.controller.inspect().enabled,false);assert.match(h.statuses[0].tooltip,/Request limit/);await h.controller.start();await h.provide();assert.equal(h.requests.length,20);await h.advance(60000);await h.controller.start();await h.provide();assert.equal(h.requests.length,21);
});

test('timings and retention stay bounded and describe provider/return rather than paint',async()=>{
 const h=harness();await h.controller.start();for(let i=0;i<105;i++){await h.advance(4000);await h.provide();}const metrics=h.controller.inspect().metrics;assert.equal(metrics.samples.length,100);assert.equal(metrics.requested,105);assert.equal(metrics.published,105);assert.match(metrics.timingScope,/excludes native presentation/);assert.ok(metrics.samples.every(s=>s.providerMs>=0&&s.totalMs>=s.providerMs));
});

test('recreated controller never restores sharing, pending requests or suggestions',async()=>{
 const old=harness();await old.controller.start();await old.provide();old.controller.dispose();const fresh=harness();assert.equal(fresh.controller.inspect().state,'off');assert.equal(fresh.requests.length,0);assert.deepEqual(await fresh.provide(),[]);
});
