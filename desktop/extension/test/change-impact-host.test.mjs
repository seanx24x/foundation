import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=process.env.FOUNDATION_IMPACT_HOST_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(join(root,'package.json')),ts=require('typescript');
const safety=await import(join(root,'desktop/extension/src/safety.mjs'));
const impact=await import(join(root,'server/project/change-impact.mjs'));
const proposals=await import(join(root,'server/project/proposals.mjs'));
const proposalSession=await import(join(root,'desktop/extension/src/proposal-session.mjs'));
const compiled=ts.transpileModule(`${readFileSync(join(root,'desktop/extension/src/extension.ts'),'utf8')}\nexport {FoundationHost};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const file=(path,source)=>({path,source,revision:createHash('sha256').update(source).digest('hex').slice(0,16),analysis:{imports:[],consumers:[],symbols:[],requests:[]}});
const uri=fsPath=>({fsPath,scheme:'file',toString:()=>`file://${fsPath}`});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const project={id:'impact-project',root:'/fixtures/impact',files:['src/App.tsx','src/Button.tsx','src/theme.css','src/consumer.css','src/Draft.ts'].map(path=>({path}))};
 const sources=new Map([
  file('src/App.tsx',"import {Button} from './Button';\nimport './theme.css';\nexport const App=()=> <Button/>;\n"),
  file('src/Button.tsx','export const Button=()=> <button>Save</button>;\n'),
  file('src/theme.css',':root { --radius: 8px; }\nbutton { border-radius: var(--radius); }\n'),
  file('src/consumer.css','.card { border-radius: var(--radius); }\n'),
  file('src/Draft.ts','export const draft = true;\n'),
 ].map(item=>[item.path,item]));
 const dirty=new Set(),queries=[],validations=[],reads=[],opened=[],shown=[],saved=[],states=[],commands=[],requests=[],storage=new Map();
 let queryHook,validateHook,readHook,openHook,saveHook,persistHook,changesHook;
 const features={revision:1,activeId:'save-feature',storage:{status:'saved'},features:[{id:'save-feature',title:'Save profile',paths:['src/Button.tsx','src/theme.css'],archived:false},{id:'other-feature',title:'Unrelated',paths:['src/Draft.ts'],archived:false}]};
 const workspace={revision:2,storage:{status:'saved'},screens:[{id:'profile',title:'Profile',featureId:'save-feature',archived:false},{id:'other',title:'Other',featureId:'other-feature',archived:false}],scenarios:[{id:'save',title:'Save successfully',screenId:'profile',archived:false},{id:'archived',title:'Old',screenId:'profile',archived:true},{id:'unrelated',title:'Other',screenId:'other',archived:false}]};
 const suites={revision:3,storage:{status:'saved'},suites:[{title:'Save states',featureId:'save-feature',screenId:'profile',scenarioId:'save'}]};
 const token=proposals.listDesignTokens([...sources.values()]).find(item=>item.name==='--radius');
 const target={kind:'token',path:token.path,revision:token.revision,name:token.name,occurrence:token.occurrence};
 const component={kind:'component',path:'src/Button.tsx',revision:sources.get('src/Button.tsx').revision};
 const documentFor=value=>{const item=sources.get(relative(project.root,value.fsPath));return {uri:value,isDirty:dirty.has(item.path),lineCount:item.source.split('\n').length,getText:()=>item.source};};
 const vscode={ViewColumn:{Active:-1,One:1,Two:2},TextEditorRevealType:{InCenter:0},Uri:{file:uri},Range:class{constructor(...values){this.values=values;}},
  workspace:{isTrusted:true,textDocuments:[],openTextDocument:async value=>{opened.push(value);return openHook?openHook(value):documentFor(value);}},
  window:{activeTextEditor:{document:{uri:uri(`${project.root}/src/Draft.ts`),isDirty:true}},visibleTextEditors:[],tabGroups:{all:[{viewColumn:1},{viewColumn:2}]},showWarningMessage:()=>{},
   showTextDocument:async(document,options)=>{const item={path:relative(project.root,document.uri.fsPath),options};shown.push(item);const editor={document,revealRange:range=>{item.range=range;}};vscode.window.activeTextEditor=editor;host.focusGeneration++;return editor;}},
  commands:{executeCommand(...args){commands.push(args);throw new Error('Impact inspection must not execute commands');}}};
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,Buffer,URL,AbortController,TextDecoder,structuredClone,setTimeout,clearTimeout,
  fetch(...args){requests.push(args);throw new Error('Impact inspection must not send requests');},
  require:name=>name==='vscode'?vscode:name.includes('safety')?safety:name.endsWith('/change-impact.mjs')?impact:name.endsWith('/proposals.mjs')?proposals:name.endsWith('/proposal-session.mjs')?proposalSession:name.startsWith('node:')?require(name):{}});
 const host=Object.create(module.exports.FoundationHost.prototype);
 Object.assign(host,{project:structuredClone(project),disposed:false,focusGeneration:0,featureSourceEpoch:0,designImpactGeneration:0,designImpactNavigation:0,
  design:{status:'ready',session:'preview-1',stale:false,tokens:[token],files:[...sources.values()].map(({path,revision})=>({path,revision})),selection:{path:component.path,label:'Save',tag:'button'}},
  activeFile:sources.get('src/Draft.ts'),openFiles:[sources.get('src/Draft.ts')],focus:{path:'src/Draft.ts',line:1,origin:'source'},panel:{viewColumn:1},
  featureSnapshot:()=>features,runtimeWorkspaceSnapshot:()=>workspace,runtimeWorkspaceStore:()=>({presentation:()=>({snapshot:workspace})}),runtimeStateSuiteSnapshot:()=>suites,
  dirtyPaths:()=>[...dirty],sendState(){states.push(structuredClone(this.designImpactState()));},queueRefresh:()=>{},show:()=>{},loadChangeSets:async()=>{if(changesHook)await changesHook();},requireNoActiveChangeSet:()=>{},
  proposalSessions:new Map(),conversations:()=>({updateProposal:async()=>true}),context:{workspaceState:{get:key=>storage.get(key),update:async(key,value)=>{if(persistHook)await persistHook(key,value);storage.set(key,structuredClone(value));}}},
  service:{
   changeImpact:async(id,value,options)=>{queries.push({id,target:value,options});return queryHook?queryHook(id,value,options):impact.analyzeChangeImpact({projectId:id,target:value,files:[...sources.values()],isCurrent:options.isCurrent});},
   validateChangeImpact:async(id,result,options)=>{validations.push({id,result,options});return validateHook?validateHook(id,result,options):result.manifest.length===sources.size && result.manifest.every(ref=>sources.get(ref.path)?.revision===ref.revision);},
   getFile:async(id,path)=>{reads.push({id,path});return readHook?readHook(id,path):structuredClone(sources.get(path));},
   save:async(change,options)=>{if(saveHook)await saveHook(change,options);if(options?.guard)await options.guard();const next=file(change.path,change.source);sources.set(change.path,next);saved.push(structuredClone(change));return next;},
  }});
 const h={host,vscode,project,sources,dirty,queries,validations,reads,opened,shown,saved,states,commands,requests,storage,features,workspace,suites,token,target,component,documentFor,
  state:()=>structuredClone(host.designImpactState()),analyze:(value=target)=>host.designImpactAction({action:'analyze',target:value}),
  propose:extra=>host.proposeTokenChange({...token,value:'12px',impactId:h.state()?.id,...extra}),
  navigate:extra=>host.designImpactAction({action:'navigate',id:h.state()?.id,evidenceId:'scope',target:'source',...extra}),
  setQuery:hook=>{queryHook=hook;},setValidate:hook=>{validateHook=hook;},setRead:hook=>{readHook=hook;},setOpen:hook=>{openHook=hook;},setSave:hook=>{saveHook=hook;},setPersist:hook=>{persistHook=hook;},setChanges:hook=>{changesHook=hook;},
  result:(value=target)=>impact.analyzeChangeImpact({projectId:project.id,target:value,files:[...sources.values()]}),
 };
 return h;
}

test('explicit impact inspection is passive and relates named scenarios only through saved feature membership',async()=>{
 const h=harness(),editor=h.vscode.window.activeTextEditor,focus=structuredClone(h.host.focus);h.dirty.add('src/Draft.ts');h.dirty.add('src/consumer.css');
 await h.analyze();const state=h.state();assert.equal(state.status,'ready',state.message);assert.match(state.id,/^[a-f0-9]{24}$/);assert.equal(state.result.scope.kind,'css-declaration');assert.equal(state.result.tokenReferences.length,2);
 assert.deepEqual(state.relatedScenarios,[{featureId:'save-feature',featureTitle:'Save profile',screenId:'profile',screenTitle:'Profile',scenarioId:'save',scenarioTitle:'Save successfully',paths:['src/theme.css'],suiteNames:['Save states']}]);
 assert.deepEqual(state.dirtyPaths,['src/Draft.ts','src/consumer.css']);assert.equal(h.vscode.window.activeTextEditor,editor);assert.deepEqual(h.host.focus,focus);
 assert.equal(h.reads.length+h.opened.length+h.shown.length+h.saved.length+h.commands.length+h.requests.length,0);assert.equal(h.storage.size,0);
});

test('component inspection binds the mapped source file and never claims a selected instance',async()=>{
 const h=harness();await h.analyze(h.component);assert.equal(h.state().status,'ready');assert.equal(h.state().result.scope.kind,'source-file');assert.equal(h.state().result.consumers.length,2);
 assert.match(h.state().result.scope.label,/individual rendered instances are not resolved/);assert.equal(h.state().relatedScenarios.length,1);
});

test('only workspace messages may request impact; unknown, stale, dirty and unmapped targets are refused',async()=>{
 const h=harness();await h.host.message({type:'designImpact',action:'analyze',target:h.target},'assistant');assert.equal(h.queries.length,0);
 await h.host.message({type:'designImpact',action:'analyze',target:h.target},'workspace');assert.equal(h.state().status,'ready');
 for(const target of [{...h.target,path:'../secret.css'},{...h.target,revision:'1234567890123456'},{...h.target,occurrence:99},{...h.component,path:'src/App.tsx'}])await assert.rejects(h.analyze(target),/Select current/);
 h.dirty.add(h.target.path);await assert.rejects(h.analyze(),/unsaved draft/);h.dirty.clear();h.host.design.stale=true;await assert.rejects(h.analyze(),/Select current/);
 assert.equal(h.queries.length,1);
});

test('pending impact discovery is fenced by project, root, trust, focus, source, preview and saved metadata',async()=>{
 const mutations=[h=>{h.host.project.id='other';},h=>{h.host.project.root='/other';},h=>{h.vscode.workspace.isTrusted=false;},h=>{h.host.disposed=true;},h=>{h.host.focusGeneration++;},h=>{h.host.featureSourceEpoch++;},h=>{h.host.design.session='other';},h=>{h.host.design.stale=true;},h=>{h.features.revision++;},h=>{h.features.activeId=null;},h=>{h.workspace.revision++;},h=>{h.suites.revision++;},h=>h.dirty.add(h.target.path),h=>h.host.invalidateDesignImpact(true)];
 for(const mutate of mutations){const h=harness(),gate=deferred(),result=await h.result();h.setQuery(()=>gate.promise);const pending=h.analyze();mutate(h);assert.equal(h.queries[0].options.isCurrent(),false);gate.resolve(result);await pending;assert.notEqual(h.state()?.status,'ready');assert.equal(h.state()?.id??null,null);}
});

test('latest analysis wins and stale failures cannot erase the newer result',async()=>{
 for(const fail of [false,true]){const h=harness(),gate=deferred(),old=await h.result();h.setQuery((_id,target)=>target.kind==='token'?gate.promise:h.result(target));const pending=h.analyze();await h.analyze(h.component);const fresh=h.state();if(fail)gate.reject(new Error('PRIVATE_ERROR'));else gate.resolve(old);await pending;assert.deepEqual(h.state(),fresh);}
});

test('service failures and invalid foreign evidence become sanitized recoverable errors',async()=>{
 const h=harness(),result=await h.result();for(const value of [new Error('PRIVATE_PATH'),{...result,projectId:'foreign'},{...result,scope:{...result.scope,source:{...result.scope.source,path:'../hidden'}}}]){
 h.setQuery(()=>{if(value instanceof Error)throw value;return value;});await h.analyze();assert.equal(h.state().status,'error');assert.equal(h.state().result,null);assert.doesNotMatch(JSON.stringify(h.states),/PRIVATE_PATH|hidden|foreign/);}
 h.setQuery(undefined);await h.analyze();assert.equal(h.state().status,'ready');
});

test('mapped runtime source requires exact selected revision and runtime identity remains owned',async()=>{
 const h=harness();h.host.design.selection=null;const runtime={status:'connected',session:'runtime-1',viewId:'view-1',documentId:'doc-1',pagePath:'/',pageVersion:1,selectionVersion:1,selection:{mapping:'resolved',path:h.component.path,revision:createHash('sha256').update(h.sources.get(h.component.path).source).digest('hex'),stale:false}};h.host.runtime={snapshot:()=>structuredClone(runtime)};
 await h.analyze(h.component);assert.equal(h.state().status,'ready');runtime.selectionVersion++;assert.equal(h.state().status,'stale');
 runtime.selection.mapping='ambiguous';await assert.rejects(h.analyze(h.component),/Select current/);assert.equal(h.queries.length,1);
});

test('Review requires the host issued impact ID and exact token identity before any source read or persistence',async()=>{
 const h=harness();await assert.rejects(h.propose(),/Inspect this token/);await h.analyze();
 for(const extra of [{impactId:'forged'},{name:'--other'},{path:'src/consumer.css'},{occurrence:99},{revision:'1234567890123456'}])await assert.rejects(h.propose(extra),/Inspect this token/);
 assert.equal(h.reads.length+h.saved.length,0);assert.equal(h.validations.length,1);assert.equal(h.storage.size,0);
});

test('Review stages historical impact and allows unrelated drafts without writing source',async()=>{
 const h=harness();await h.analyze();h.dirty.add('src/consumer.css');h.dirty.add('src/Draft.ts');const proposal=await h.propose();
 assert.equal(proposal.designImpact.version,1);assert.equal(proposal.designImpact.relatedScenarios[0].scenarioTitle,'Save successfully');assert.equal(h.saved.length,0);assert.equal(h.host.proposals().current().id,proposal.id);assert.equal(h.validations.length,2);
 h.workspace.scenarios[0].title='Renamed later';assert.equal(h.host.proposals().current().designImpact.relatedScenarios[0].scenarioTitle,'Save successfully');
});

test('Review rechecks every awaited phase and preserves its earlier checkpoint when persistence is cancelled',async()=>{
 for(const phase of ['changes','validate','read','persist'])for(const mutate of [h=>{h.host.focusGeneration++;},h=>{h.host.project.root='/other';},h=>h.dirty.add(h.target.path)]){
  const h=harness();await h.analyze();const action=()=>mutate(h);
  if(phase==='changes')h.setChanges(action);if(phase==='validate')h.setValidate(()=>{action();return true;});if(phase==='read')h.setRead((_id,path)=>{const source=structuredClone(h.sources.get(path));action();return source;});
  if(phase==='persist'){let once=true;h.setPersist(()=>{if(once){once=false;action();}});}
  await assert.rejects(h.propose(),/changed|draft|cancelled/);assert.equal(h.saved.length,0);assert.equal([...h.host.proposalSessions.values()].some(session=>session.current()),false);
 }
});

test('staging detects changed saved inventory and does not create a checkpoint',async()=>{
 const h=harness();await h.analyze();h.sources.set('src/NewConsumer.tsx',file('src/NewConsumer.tsx','export const other=true;'));
 await assert.rejects(h.propose(),/Saved source changed/);assert.equal(h.state().status,'stale');assert.equal(h.storage.size,0);
});

test('source evidence uses only host-owned coordinates and exact saved buffers',async()=>{
 const h=harness();await h.analyze();const reference=h.state().result.tokenReferences.find(item=>item.source.path==='src/consumer.css');h.dirty.add('src/Draft.ts');
 await h.navigate({evidenceId:reference.id,path:'../forged',line:999,column:999});assert.equal(h.shown.length,1);assert.equal(h.shown[0].path,'src/consumer.css');assert.deepEqual(h.shown[0].options.selection.values,[0,27,0,27]);assert.equal(h.shown[0].options.viewColumn,2);assert.equal(h.commands.length+h.requests.length,0);
});

test('forged or obsolete navigation is rejected before reads, and dirty exact evidence never opens drafts',async()=>{
 const h=harness();await h.analyze();for(const extra of [{id:'old'},{evidenceId:'forged'},{target:'definition'}])await assert.rejects(h.navigate(extra),/impact|evidence/);
 assert.equal(h.reads.length+h.opened.length,0);assert.equal(h.validations.length,1);h.dirty.add(h.target.path);await assert.rejects(h.navigate(),/impact/);assert.equal(h.opened.length,0);
 const other=harness();await other.analyze();const ref=other.state().result.tokenReferences.find(item=>item.source.path==='src/consumer.css');other.dirty.add(ref.source.path);await assert.rejects(other.navigate({evidenceId:ref.id}),/saved source/);assert.equal(other.opened.length,0);
});

test('navigation does not steal focus after validation, source read or native document await',async()=>{
 for(const phase of ['validate','read','open']){
  const h=harness();await h.analyze();const mutate=()=>{h.host.focusGeneration++;};
  if(phase==='validate')h.setValidate(()=>{mutate();return true;});if(phase==='read')h.setRead((_id,path)=>{mutate();return h.sources.get(path);});if(phase==='open')h.setOpen(value=>{const document=h.documentFor(value);mutate();return document;});
  await assert.rejects(h.navigate(),/changed/);assert.equal(h.shown.length,0);
 }
});

test('changed source or native buffer invalidates exact navigation while retaining recoverable evidence',async()=>{
 for(const phase of ['manifest','saved','document']){
  const h=harness();await h.analyze();if(phase==='manifest')h.setValidate(()=>false);if(phase==='saved')h.setRead((_id,path)=>({...h.sources.get(path),revision:'1234567890123456'}));if(phase==='document')h.setOpen(value=>({...h.documentFor(value),getText:()=> 'new buffer'}));
  await assert.rejects(h.navigate(),/Source evidence changed/);assert.equal(h.state().status,'stale');assert.ok(h.state().result);assert.equal(h.shown.length,0);
 }
});

test('new consumers and ignore rules invalidate impact even without an active feature; generated paths are excluded',async()=>{
 const h=harness();h.features.activeId=null;await h.analyze();
 for(const path of ['src/New.tsx','src/new.css','.gitignore']){const before=h.host.designImpactGeneration;assert.equal(h.host.designImpactSourceChanged(uri(`${h.project.root}/${path}`)),true);assert.equal(h.host.designImpactGeneration,before+1);}
 for(const path of ['node_modules/p/a.ts','dist/result.js','.git/index'])assert.equal(h.host.designImpactSourceChanged(uri(`${h.project.root}/${path}`)),false);
 assert.equal(h.state().status,'stale');
});

test('Apply always revalidates full impact at its final save boundary; Undo preserves unrelated changed source',async()=>{
 const h=harness();await h.analyze();const proposal=await h.propose();h.dirty.add('src/consumer.css');h.workspace.revision++;h.workspace.scenarios[0].title='Historical name is retained';
 const before=h.validations.length;await h.host.proposals().apply(proposal.id,h.project.id);assert.ok(h.validations.length>=before+2);assert.ok(h.saved[0].designImpact);assert.match(h.sources.get(h.target.path).source,/12px/);
 h.sources.set('src/consumer.css',file('src/consumer.css','/* unrelated saved edit */\n'));const checks=h.validations.length;await h.host.proposals().undo(proposal.id,h.project.id);assert.equal(h.validations.length,checks);assert.equal(h.saved.at(-1).designImpact,undefined);assert.match(h.sources.get(h.target.path).source,/8px/);assert.equal(h.sources.get('src/consumer.css').source,'/* unrelated saved edit */\n');
});

test('atomic Apply guard catches late inventory and target draft changes before any write',async()=>{
 for(const mutate of [h=>h.sources.set('src/new.ts',file('src/new.ts','export const newConsumer=true;')),h=>h.dirty.add(h.target.path),h=>{h.host.project.root='/foreign';}]){
  const h=harness();await h.analyze();const proposal=await h.propose();h.setSave(()=>mutate(h));await assert.rejects(h.host.proposals().apply(proposal.id,h.project.id),/changed|draft|unsaved/);assert.equal(h.saved.length,0);assert.match(h.sources.get(h.target.path).source,/8px/);
 }
});

test('assessment caches stable saved inventory but never a dirty target or explicit Apply',async()=>{
 const h=harness();await h.analyze();const proposal=await h.propose();const checkpoint=proposal.designImpact;
 assert.equal(await h.host.validateDesignImpactForProposal(checkpoint,'assess',h.project),true);const count=h.validations.length;
 assert.equal(await h.host.validateDesignImpactForProposal(checkpoint,'assess',h.project),true);assert.equal(h.validations.length,count);
 h.dirty.add(h.target.path);assert.equal(await h.host.validateDesignImpactForProposal(checkpoint,'assess',h.project),false);h.dirty.clear();
 await h.host.validateDesignImpactForProposal(checkpoint,'apply',h.project);assert.equal(h.validations.length,count+1);
 h.host.designImpactSourceChanged(uri(`${h.project.root}/src/new.ts`));await h.host.validateDesignImpactForProposal(checkpoint,'assess',h.project);assert.equal(h.validations.length,count+2);
});


test('incomplete saved inventory remains visible but cannot authorize a proposal or exact navigation',async()=>{
 const h=harness();h.setValidate(()=>false);await h.analyze();assert.equal(h.state().status,'incomplete');assert.equal(h.state().id,null);assert.ok(h.state().result);assert.match(h.state().message,/incomplete/);assert.equal(h.state().relatedScenarios.length,1);
 await assert.rejects(h.propose(),/Inspect this token/);await assert.rejects(h.navigate(),/Inspect current/);assert.equal(h.saved.length+h.opened.length,0);
 h.setValidate(undefined);await h.analyze();assert.equal(h.state().status,'ready');
});

test('a focus change during final analysis validation cannot issue a ready impact ID',async()=>{
 const h=harness(),gate=deferred();h.setValidate(()=>gate.promise);const pending=h.analyze();while(!h.validations.length)await tick();h.host.focusGeneration++;gate.resolve(true);await pending;
 assert.equal(h.state().status,'stale');assert.equal(h.state().id,null);assert.equal(h.saved.length+h.opened.length,0);
});
