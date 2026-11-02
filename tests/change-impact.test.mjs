import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {syncBuiltinESMExports,createRequire} from 'node:module';
import {join} from 'node:path';
import {analyzeChangeImpact,validateChangeImpact,validateDesignImpactCheckpoint} from '../server/project/change-impact.mjs';
import {createProjectService,projectRevision} from '../server/project/workspace.mjs';

const BASIC = {
  'src/Button.tsx':'export function Button(){ return <button/>; }',
  'src/index.ts':"export {Button as Action} from './Button';",
  'src/Form.tsx':"import {Action} from './index';\nexport function Form(){return <Action/>;}",
  'src/App.tsx':"import {Form} from './Form'; export const App=()=> <Form/>;",
  'src/styles.css':':root { --tone: red; }\n.dark { --tone: blue; }\n.button { color: var(--tone); }',
};
const target = (sources,path,extra = {}) => ({kind:'component',path,revision:projectRevision(sources[path]),...extra});
const analyze = (sources,selected,options = {}) => analyzeChangeImpact({projectId:'fixture',target:selected,files:Object.entries(sources).map(([path,source]) => ({path,source,revision:projectRevision(source)})),...options});
async function fixture(t,sources = BASIC) { const root = await mkdtemp('/private/tmp/foundation-change-impact-'); t.after(()=>rm(root,{recursive:true,force:true})); const write = async (path,source) => {await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),source);}; for (const [path,source] of Object.entries(sources)) await write(path,source); const service = createProjectService({root}), project = await service.open(root); return {root,write,service,id:project.id}; }
const clone = value => structuredClone(value);

test('component impact reuses resolved direct source evidence and does not invent transitive consumers',async()=>{
  const result = await analyze(BASIC,target(BASIC,'src/Button.tsx'));
  assert.equal(result.scope.kind,'source-file');
  const render = result.consumers.find(edge=>edge.kind==='render');
  assert.equal(render.from.path,'src/Form.tsx');assert.equal(render.from.line,2);assert.equal(render.from.column,32);
  assert.equal(render.to.path,'src/Button.tsx');assert.equal(render.to.label,'Button');
  assert.ok(result.consumers.some(edge=>edge.kind==='re-export'));
  assert.ok(result.consumers.every(edge=>edge.from.path!=='src/App.tsx'));
  assert.ok(result.limits.some(item=>/Transitive/.test(item.detail)));
  assert.deepEqual(validateChangeImpact(result,'fixture'),result);
  assert.equal(JSON.stringify(result).includes('<button/>'),false);
  const second = await analyze(BASIC,target(BASIC,'src/Button.tsx'));
  assert.deepEqual(second.consumers.map(item=>item.id),result.consumers.map(item=>item.id));
});

test('CSS evidence keeps exact declarations, overrides and nested name references distinct from cascade consumers',async()=>{
  const source = `:root { --tone: red; }\n@media (width > 10px) { .dark { --tone: blue; color: var( /*name*/ --tone, var(--tone)); } }\n.strings { content: "var(--tone)"; /* var(--tone) */ color: var(--other); }\n`;
  const sources = {...BASIC,'src/styles.css':source,'src/theme.css':'.elsewhere { --tone: green; outline: var(--tone); }','src/Other.tsx':"import './styles.css';"};
  const result = await analyze(sources,target(sources,'src/styles.css',{kind:'token',name:'--tone',occurrence:1}));
  assert.equal(result.scope.kind,'css-declaration');assert.equal(result.scope.label,'@media (width > 10px) / .dark');
  assert.equal(result.declarations.length,3);assert.equal(result.declarations.filter(item=>item.selected).length,1);
  assert.equal(result.tokenReferences.length,3);
  assert.equal(result.tokenReferences.filter(item=>item.source.path==='src/styles.css').length,2);
  for (const item of result.tokenReferences) { const lines = sources[item.source.path].split('\n'); assert.equal(lines[item.source.line-1].slice(item.source.column-1,item.source.endColumn-1),'--tone'); }
  assert.ok(result.consumers.some(item=>item.kind==='stylesheet'&&item.from.path==='src/Other.tsx'));
  assert.ok(result.limits.some(item=>/cascade/i.test(item.detail)&&/unknown/.test(item.detail)));
});

test('nested CSS declarations retain token occurrence identity and invalid CSS cannot authorize a selected declaration',async()=>{
  const sources = {'style.css':'.a { --tone: red; @media (min-width:1px) { --tone: blue; color: var(--tone); } }'};
  const result = await analyze(sources,target(sources,'style.css',{kind:'token',name:'--tone',occurrence:1}));
  assert.equal(result.declarations.length,2);assert.equal(result.declarations[1].selected,true);
  const invalid = {'style.css':':root {--tone:red;'};
  await assert.rejects(analyze(invalid,target(invalid,'style.css',{kind:'token',name:'--tone',occurrence:0})),{code:'impact-token-unavailable'});
  await assert.rejects(analyze(sources,target(sources,'style.css',{kind:'token',name:'--tone',occurrence:8})),{code:'impact-token-unavailable'});
  await assert.rejects(analyze(sources,{...target(sources,'style.css'),revision:'a'.repeat(16)}),{code:'impact-stale'});
});

test('bounded CSS evidence retains a late selected occurrence and reports omitted name references',async()=>{
  const sources = {'style.css':Array.from({length:220},(_,i)=>`.a${i}{--tone:red;color:var(--tone)}`).join('\n')};
  const result = await analyze(sources,target(sources,'style.css',{kind:'token',name:'--tone',occurrence:219}));
  assert.equal(result.declarations.length,200);assert.equal(result.tokenReferences.length,200);assert.equal(result.truncated,true);
  assert.equal(result.declarations.filter(item=>item.selected).length,1);assert.equal(result.scope.source.line,220);
  assert.ok(result.limits.some(item=>/empty list is not proof/.test(item.detail)));
});

test('strict result/checkpoint validation rejects forged identities, foreign revisions, extra fields and oversized scenario associations',async()=>{
  const result = await analyze(BASIC,target(BASIC,'src/Button.tsx'));
  const mutations = [v=>v.extra=true,v=>v.projectId='other',v=>v.target.path='../outside',v=>v.manifest.push(v.manifest[0]),v=>v.basisDigest='a'.repeat(64),v=>v.consumers[0].from.revision='a'.repeat(16),v=>v.consumers[0].from.column=0,v=>v.consumers[0].id='relationship-'+ '0'.repeat(16),v=>v.counts.consumers++,v=>v.scope.source.path='src/Form.tsx'];
  for (const mutate of mutations) { const changed = clone(result);mutate(changed);assert.throws(()=>validateChangeImpact(changed,'fixture'),{code:'invalid-change-impact'}); }
  const row = {featureId:'save',featureTitle:'Save',screenId:'profile',screenTitle:'Profile',scenarioId:'success',scenarioTitle:'Success',paths:['src/Button.tsx'],suiteNames:['Themes']};
  const checkpoint = {version:1,result,relatedScenarios:[row]};assert.deepEqual(validateDesignImpactCheckpoint(checkpoint,'fixture'),checkpoint);
  for (const patch of [{relatedScenarios:[row,row]},{relatedScenarios:[{...row,paths:['not-analyzed.ts']}]},{relatedScenarios:[{...row,suiteNames:Array.from({length:21},(_,i)=>String(i))}]},{extra:true}]) assert.throws(()=>validateDesignImpactCheckpoint({...checkpoint,...patch},'fixture'),{code:'invalid-change-impact'});
});

test('safe impact service reads each inventory source once and invalidates changed or newly added consumers',async t=>{
  const h = await fixture(t), original = fs.open, opened = [];
  fs.open = async(...args)=>{opened.push(args[0]);return original(...args);};syncBuiltinESMExports();
  let result;
  try { result = await h.service.changeImpact(h.id,target(BASIC,'src/Button.tsx'));assert.equal(opened.length,Object.keys(BASIC).length);assert.equal(new Set(opened).size,opened.length); }
  finally {fs.open=original;syncBuiltinESMExports();}
  assert.equal(await h.service.validateChangeImpact(h.id,result),true);
  await h.write('src/New.tsx',"import {Button} from './Button'; export const New=()=> <Button/>;");
  assert.equal(await h.service.validateChangeImpact(h.id,result),false);
  result = await h.service.changeImpact(h.id,target(BASIC,'src/Button.tsx'));
  await h.write('src/index.ts',"export {Button as Different} from './Button';");assert.equal(await h.service.validateChangeImpact(h.id,result),false);
  assert.equal(await h.service.validateChangeImpact(h.id,{...result,basisDigest:'0'.repeat(64)}),false);
});

test('impact and validation honor cancellation, including before source reads',async t=>{
  const h = await fixture(t), selected = target(BASIC,'src/Button.tsx');
  await assert.rejects(h.service.changeImpact(h.id,selected,{isCurrent:()=>false}),{code:'relationships-cancelled'});
  const result = await h.service.changeImpact(h.id,selected);
  await assert.rejects(h.service.validateChangeImpact(h.id,result,{isCurrent:()=>false}),{code:'relationships-cancelled'});
});

test('private save guard runs before work and before replacement, preserves edits and removes temporary files',async t=>{
  const h = await fixture(t), path = 'src/Button.tsx', before = BASIC[path], input = {projectId:h.id,path,source:before+'\n// change',baseRevision:projectRevision(before)};
  let calls = 0;
  await assert.rejects(h.service.save(input,{guard:()=>{calls++;return false;}}),{code:'save-cancelled'});assert.equal(calls,1);assert.equal(await readFile(join(h.root,path),'utf8'),before);
  calls = 0;
  await assert.rejects(h.service.save(input,{guard:()=>++calls<3}),{code:'save-cancelled'});assert.equal(calls,3);assert.equal(await readFile(join(h.root,path),'utf8'),before);
  calls = 0;
  await assert.rejects(h.service.save(input,{guard:async()=>{if(++calls===3)await h.write(path,before+'\n// external');return true;}}),{code:'source-conflict'});assert.equal(await readFile(join(h.root,path),'utf8'),before+'\n// external');
  assert.equal((await fs.readdir(join(h.root,'src'))).some(name=>name.startsWith('.foundation-')),false);
});

test('save does not accept an executable guard from request input and a successful guard preserves normal undo',async t=>{
  const h = await fixture(t), path = 'src/Button.tsx', before = BASIC[path], after = before+'\n// change';let calls=0;
  await h.service.save({projectId:h.id,path,source:after,baseRevision:projectRevision(before),guard:()=>{throw new Error('HTTP_INPUT_GUARD_EXECUTED');}},{guard:()=>{calls++;return true;}});
  assert.equal(calls,3);assert.equal(await readFile(join(h.root,path),'utf8'),after);
  await h.service.revert({projectId:h.id,path,revision:projectRevision(after)});assert.equal(await readFile(join(h.root,path),'utf8'),before);
});

test('save rechecks supporting context after an asynchronous final guard',async t=>{
  const h = await fixture(t), path = 'src/Button.tsx', before = BASIC[path], supporting = 'src/Form.tsx';let calls=0;
  await assert.rejects(h.service.save({projectId:h.id,path,source:before+'\n// change',baseRevision:projectRevision(before),expectedContext:[{path:supporting,revision:projectRevision(BASIC[supporting])}]},{guard:async()=>{if(++calls===3)await h.write(supporting,BASIC[supporting]+'\n// external context');return true;}}),{code:'context-conflict'});
  assert.equal(await readFile(join(h.root,path),'utf8'),before);assert.match(await readFile(join(h.root,supporting),'utf8'),/external context/);
  assert.equal((await fs.readdir(join(h.root,'src'))).some(name=>name.startsWith('.foundation-')),false);
});

test('truncated inventory can be inspected but cannot pass complete impact validation',async t=>{
  const h = await fixture(t);
  await h.write('deep/'+Array(18).fill('nested').join('/')+'/Hidden.tsx','export const Hidden=1;');
  const result = await h.service.changeImpact(h.id,target(BASIC,'src/Button.tsx'));
  assert.equal(result.truncated,true);assert.equal(await h.service.validateChangeImpact(h.id,result),false);
});

test('CSS var syntax excludes identifier suffixes and strings while accepting name-adjacent comments',async()=>{
  const sources = {'style.css':':root{--tone:red}.a{a:var(--tone/*ok*/);b:var(--toneX);c:évar(--tone);d:"var(--tone)";e:var(--tone, var(--tone));}'};
  const result = await analyze(sources,target(sources,'style.css',{kind:'token',name:'--tone',occurrence:0}));
  assert.deepEqual(result.tokenReferences.map(item=>item.property),['a','e','e']);
});


test('CSS analysis never follows external or inline source maps outside the safe source basis',async()=>{
  const require = createRequire(import.meta.url), PreviousMap = require(join(require.resolve('postcss/package.json'),'../lib/previous-map.js'));
  const original = PreviousMap.prototype.loadMap;let calls=0;
  PreviousMap.prototype.loadMap = function(){calls++;throw new Error('SOURCE_MAP_LOADING_MUST_NOT_RUN');};
  try {
    for(const annotation of ['../../private.map','data:application/json;base64,invalid']) {
      const sources = {'style.css':`:root{--tone:red}.a{color:var(--tone)}/*# sourceMappingURL=${annotation} */`};
      const result = await analyze(sources,target(sources,'style.css',{kind:'token',name:'--tone',occurrence:0}));
      assert.equal(result.tokenReferences.length,1);
    }
    assert.equal(calls,0);
  } finally {PreviousMap.prototype.loadMap=original;}
});

test('CSS declaration and name reference coordinates preserve a leading source BOM',async()=>{
  const sources = {'style.css':'\uFEFF:root{--tone:red}.a{color:var(--tone)}'};
  const result = await analyze(sources,target(sources,'style.css',{kind:'token',name:'--tone',occurrence:0}));
  for(const source of [result.scope.source,result.tokenReferences[0].source]) assert.equal(sources['style.css'].slice(source.column-1,source.endColumn-1),'--tone');
});


test('save guards receive only service-owned temporary identity and verify its replacement bytes',async t=>{
 const h=await fixture(t),path='src/Button.tsx',before=BASIC[path],after=before+'\n// changed',contexts=[];
 await h.service.save({projectId:h.id,path,source:after,baseRevision:projectRevision(before),originalWriteTemporary:{path:'forged'},guardContext:{originalWriteTemporary:{path:'forged'}}},{guard:async context=>{
  contexts.push(context);assert.ok(Object.isFrozen(context));if(!context.originalWriteTemporary)return;
  const temp=context.originalWriteTemporary;assert.ok(Object.isFrozen(temp));assert.match(temp.path,/^src\/\.foundation-[a-f0-9-]+\.tmp$/);assert.deepEqual(Object.keys(temp).sort(),['dev','hash','ino','path']);const info=await fs.lstat(join(h.root,temp.path));assert.equal(info.dev,temp.dev);assert.equal(info.ino,temp.ino);assert.equal(temp.hash,createHash('sha256').update(after).digest('hex'));assert.equal(await readFile(join(h.root,temp.path),'utf8'),after);
 }});assert.equal(contexts.length,3);assert.deepEqual(contexts.slice(0,2),[{},{}]);assert.equal(await readFile(join(h.root,path),'utf8'),after);
});

test('changed atomic-write content is refused after the final asynchronous guard',async t=>{
 const h=await fixture(t),path='src/Button.tsx',before=BASIC[path];
 await assert.rejects(h.service.save({projectId:h.id,path,source:before+'\n// change',baseRevision:projectRevision(before)},{guard:async context=>{if(context.originalWriteTemporary)await writeFile(join(h.root,context.originalWriteTemporary.path),'foreign bytes');}}),{code:'save-temporary-changed'});
 assert.equal(await readFile(join(h.root,path),'utf8'),before);assert.equal((await fs.readdir(join(h.root,'src'))).some(name=>name.startsWith('.foundation-')),false);
});

test('a substituted pending-write inode is refused and foreign data is preserved',async t=>{
 const h=await fixture(t),path='src/Button.tsx',before=BASIC[path];let foreign;
 await assert.rejects(h.service.save({projectId:h.id,path,source:before+'\n// change',baseRevision:projectRevision(before)},{guard:async context=>{if(context.originalWriteTemporary){foreign=join(h.root,context.originalWriteTemporary.path);await fs.rename(foreign,foreign+'.old');await writeFile(foreign,'unrelated replacement');}}}),{code:'save-temporary-changed'});
 assert.equal(await readFile(join(h.root,path),'utf8'),before);assert.equal(await readFile(foreign,'utf8'),'unrelated replacement');
});
