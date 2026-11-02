import test from 'node:test';
import {createHash} from 'node:crypto';
const hash=source=>createHash('sha256').update(source).digest('hex').slice(0,16);
import assert from 'node:assert/strict';
import {createBuildArtifact,createChangeProposal,validateChangeSet} from '../server/project/proposals.mjs';
const files=[{path:'src/a.ts',revision:'r1',source:'export const a = 1;\n'},{path:'src/b.ts',revision:'r2',source:'export const b = 2;\n'},{path:'src/c.ts',revision:'r3',source:'export const c = 3;\n'}].map(file=>({...file,revision:hash(file.source)}));
const edits=[{path:files[1].path,find:'2',replace:'20'},{path:files[0].path,find:'1',replace:'10'}];
const raw=(changes=edits,extra={})=>JSON.stringify({title:'Coordinate values',summary:'Adjust two selected values.',edits:changes,verification:['Inspect consumers.'],...extra});
const create=(value=raw(),selected=files)=>createBuildArtifact({raw:value,files:selected,projectId:'fixture'});

test('Build dispatch preserves the legacy one-file artifact and emits a coherent selected-order group for two files',()=>{
 const single=create(raw([edits[0]]));assert.equal(single.type,'proposal');assert.equal(single.proposal.path,files[1].path);assert.equal(single.proposal.schemaVersion,undefined);
 assert.throws(()=>createChangeProposal({raw:raw(),files,projectId:'fixture'}),{code:'proposal-multiple-files'});
 const {type,changeSet}=create();assert.equal(type,'changeSet');assert.deepEqual(changeSet.files.map(f=>f.path),files.slice(0,2).map(f=>f.path));
 assert.deepEqual(changeSet.context,files.map(({path,revision})=>({path,revision})));assert.equal(changeSet.files[0].before,files[0].source);assert.equal(changeSet.files[1].after,files[1].source.replace('2','20'));
 assert.equal(changeSet.revision,0);assert.equal(changeSet.status,'proposed');assert.equal(changeSet.verificationStatus,'not-run');assert.equal(new Set([changeSet.id,...changeSet.files.map(f=>f.id)]).size,3);
 const clone=validateChangeSet(changeSet,'fixture');clone.files[0].after='caller mutation';assert.notEqual(clone.files[0].after,changeSet.files[0].after);assert.equal(files[0].source,'export const a = 1;\n');
});

test('all selected paths and each original anchor must be valid before any group is returned',()=>{
 const invalid=[[{...edits[0],path:'src/missing.ts'},edits[1]],[{...edits[0],find:'missing'},edits[1]],[edits[0],{...edits[1],replace:'1'}],[edits[0],{...edits[1],find:'',replace:'x'}],[edits[0],{...edits[1],find:' '}],[edits[0],edits[1],{...edits[1],find:'= 1',replace:'= 3'}],[edits[0],{...edits[1],command:'shell'}]];
 for(const value of invalid)assert.throws(()=>create(raw(value)));
 for(const path of ['../private','/etc/passwd','C:/private','src/\u0007.ts','src\\private'])assert.throws(()=>create(raw([{...edits[0],path},edits[1]]),[files[0],{...files[1],path}]));
 assert.throws(()=>create(raw(),[...files,files[0]]));assert.throws(()=>create(raw(),[...files,{path:'src/d.ts',source:'x'.repeat(65536),revision:'r4'}]));
});

test('global edit count, raw size, UTF-8 validity, and eight-file maximum remain bounded',()=>{
 const selected=Array.from({length:8},(_,i)=>({path:`src/${i}.ts`,revision:`r${i}`,source:`a${i} b${i} c${i}`})).map(file=>({...file,revision:hash(file.source)}));
 const changes=selected.flatMap((f,i)=>['a','b','c'].map(k=>({path:f.path,find:`${k}${i}`,replace:`${k}${i}x`})));
 assert.equal(create(raw(changes),selected).changeSet.files.length,8);assert.throws(()=>create(raw([...changes,{...changes[0]}]),selected));
 const nine=[...selected,{path:'src/8.ts',revision:'r8',source:'a8'}];assert.throws(()=>create(raw(nine.map((f,i)=>({path:f.path,find:`a${i}`,replace:`a${i}x`}))),nine));
 for(const value of ['x'.repeat(65537),'\ud800',raw(edits,{tools:['run']}),raw(edits,{verificationStatus:'passed'}),raw(edits,{summary:''}),raw(edits,{verification:['x'.repeat(501)]})])assert.throws(()=>create(value));
});

test('canonical change sets reject forged paths, identities, source, bounds, verification, and transaction journal fields',()=>{
 const original=create().changeSet;
 const variants=[v=>v.schemaVersion=2,v=>v.projectId='other',v=>v.id='not-uuid',v=>v.revision=-1,v=>v.revision=0.5,v=>v.status='complete',v=>v.origin='design',v=>v.verificationStatus='passed',v=>v.files[1].id=v.files[0].id,v=>v.files[0].id=v.id,v=>v.files[1].path=v.files[0].path,v=>v.files[0].before=v.files[0].after,v=>v.files[0].before='\ud800',v=>v.files[0].path='../escape',v=>v.files[0].baseRevision='different',v=>v.files[0].before+='x',v=>v.status='applied',v=>v.files[0].appliedRevision='',v=>v.context.push(v.context[0]),v=>v.context[0].revision='different',v=>v.files[0].after='x'.repeat(256*1024),v=>v.files[1].after='\0',v=>v.files[0].created=true,v=>v.operation={kind:'apply'},v=>v.planBasis=[],v=>v.createdAt='yesterday',v=>v.createdAt='2026-02-31T00:00:00.000Z',v=>v.requestId='bad/key'];
 for(const mutate of variants){const value=structuredClone(original);mutate(value);assert.throws(()=>validateChangeSet(value,'fixture'),{code:'invalid-change-set'});}
 for(const status of ['proposed','applying','applied','undoing','undone','recovery-required','discarded','stale']){
  const value={...original,status,revision:3,requestId:'request-1',createdAt:'2026-10-29T00:00:00.000Z',updatedAt:'2026-10-29T00:00:01.000Z',files:original.files.map(f=>({...f,appliedRevision:hash(f.after)}))};assert.deepEqual(validateChangeSet(value,'fixture'),value);
 }
});
