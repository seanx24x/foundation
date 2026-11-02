import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBuildArtifact,createRefinedChangeSet,stagedGroupSources,groupRevisionDescriptor,changeGroupDigest} from '../server/project/proposals.mjs';
import {changeGroupDigest as executionDigest} from '../desktop/extension/src/execution-session.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,16);
const files=['a','b','c'].map((name,index)=>{const source=`export const ${name} = ${index+1};\n`;return{path:`src/${name}.ts`,source,revision:hash(source)};});
const raw=(edits,extra={})=>JSON.stringify({title:'Refine staged values',summary:'Refine the selected staged code.',edits,verification:['Check the resulting values.'],...extra});
const edit=(index,before,after)=>({path:files[index].path,find:`= ${before};`,replace:`= ${after};`});
const parent=()=>({...createBuildArtifact({raw:raw([edit(0,1,10),edit(1,2,20)]),files,projectId:'fixture'}).changeSet,requestId:'parent-request'});
const descriptor=group=>({version:1,conversationId:'chat-1',requestId:group.requestId,groupId:group.id,groupRevision:group.revision,groupDigest:changeGroupDigest(group)});

test('staged overlay uses exact host snapshots and carries staged hashes in original selection order',()=>{
 const group=parent(),before=structuredClone(group),effective=stagedGroupSources({group,files,projectId:'fixture'});
 assert.deepEqual(effective.map(file=>file.path),files.map(file=>file.path));assert.deepEqual(effective.map(file=>file.id),['S1','S2','S3']);assert.equal(effective[0].source,group.files[0].after);assert.equal(effective[1].source,group.files[1].after);assert.equal(effective[2].source,files[2].source);for(const file of effective)assert.equal(file.revision,hash(file.source));effective[0].source='external mutation';assert.deepEqual(group,before);assert.equal(files[0].source,'export const a = 1;\n');
});

test('one-file incremental refinement retains untouched staged members and uses original disk before/baseRevision',()=>{
 const group=parent(),before=structuredClone(group),result=createRefinedChangeSet({raw:raw([edit(0,10,100)]),files,group,projectId:'fixture'});
 assert.equal(result.files.length,2);assert.equal(result.files[0].before,files[0].source);assert.equal(result.files[0].baseRevision,files[0].revision);assert.equal(result.files[0].after,'export const a = 100;\n');assert.equal(result.files[1].after,group.files[1].after);assert.deepEqual(result.context,group.context);assert.notEqual(result.id,group.id);assert.ok(result.files.every(file=>!group.files.some(old=>old.id===file.id)));assert.equal(result.origin,'ai');assert.equal(result.verificationStatus,'not-run');assert.equal(result.status,'proposed');assert.equal(result.revision,0);assert.equal(result.requestId,undefined);assert.deepEqual(group,before);
});

test('refinement may change another explicitly selected context file and may revert a member when two changes remain',()=>{
 const group=parent(),expanded=createRefinedChangeSet({raw:raw([edit(2,3,30)]),files,group,projectId:'fixture'});assert.equal(expanded.files.length,3);assert.equal(expanded.files[0].after,group.files[0].after);assert.equal(expanded.files[2].before,files[2].source);
 const reverted=createRefinedChangeSet({raw:raw([edit(0,10,1)]),files,group:expanded,projectId:'fixture'});assert.deepEqual(reverted.files.map(file=>file.path),['src/b.ts','src/c.ts']);assert.deepEqual(reverted.context,group.context);
});

test('invalid anchors, outside scope, no-op, complete reversion and one-member remainder cannot replace a group',()=>{
 const group=parent(),before=structuredClone(group);
 for(const edits of [[edit(0,1,100)],[edit(0,10,10)],[{...edit(0,10,100),path:'src/unselected.ts'}],[{...edit(0,10,100),path:'../secret'}],[edit(0,10,100),edit(0,10,200)]])assert.throws(()=>createRefinedChangeSet({raw:raw(edits),files,group,projectId:'fixture'}));
 assert.throws(()=>createRefinedChangeSet({raw:raw([edit(0,10,1)]),files,group,projectId:'fixture'}),{code:'refinement-too-small'});
 assert.throws(()=>createRefinedChangeSet({raw:raw([edit(0,10,1),edit(1,20,2)]),files,group,projectId:'fixture'}),{code:'refinement-no-change'});
 assert.throws(()=>createRefinedChangeSet({raw:raw([edit(0,10,100)],{verificationStatus:'passed'}),files,group,projectId:'fixture'}));assert.deepEqual(group,before);
});

test('staged inputs require every original source, exact order and hashes, proposed status and independent 64 KiB budgets',()=>{
 const group=parent();
 for(const chosen of [files.slice(0,2),[...files].reverse(),[files[0],files[1],{...files[2],source:'changed source'}],[files[0],files[0],files[2]]])assert.throws(()=>stagedGroupSources({group,files:chosen,projectId:'fixture'}));
 assert.throws(()=>stagedGroupSources({group:{...group,status:'discarded'},files,projectId:'fixture'}));
 assert.throws(()=>stagedGroupSources({group:{...group,files:group.files.map(file=>({...file,appliedRevision:hash(file.after)}))},files,projectId:'fixture'}));
 const oversized=structuredClone(group);oversized.files[0].after='x'.repeat(65536);assert.throws(()=>stagedGroupSources({group:oversized,files,projectId:'fixture'}),{code:'group-context-too-large'});
});

test('group descriptor strictly binds immutable metadata and shares the execution digest contract',()=>{
 const group=parent(),input=descriptor(group);assert.deepEqual(groupRevisionDescriptor(input),input);assert.equal(groupRevisionDescriptor(undefined),undefined);assert.equal(changeGroupDigest(group),executionDigest(group));
 for(const mutate of [value=>value.version=2,value=>value.groupId='foreign',value=>value.groupRevision=-1,value=>value.groupRevision=1.1,value=>value.groupDigest='a'.repeat(63),value=>value.groupDigest='A'.repeat(64),value=>value.files=[],value=>delete value.requestId,value=>value.conversationId='bad/path']){const changed=structuredClone(input);mutate(changed);assert.throws(()=>groupRevisionDescriptor(changed),{code:'invalid-group-revision'});}
 for(const mutate of [value=>value.title+='!',value=>value.summary+='!',value=>value.files[0].after+='\n',value=>value.verification.push('Another check'),value=>value.requestId='another-request']){const changed=structuredClone(group);mutate(changed);assert.notEqual(changeGroupDigest(changed),input.groupDigest);}
 assert.equal(changeGroupDigest({...group,revision:3,status:'discarded'}),input.groupDigest,'mutable lifecycle revision/status are bound separately');
});
