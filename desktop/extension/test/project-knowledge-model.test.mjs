import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {projectDecisionFixture} from '../../../tests/helpers/project-decision-fixture.mjs';
import {reproducibleIssueFixture} from '../../../tests/helpers/reproducible-issue-fixture.mjs';
const source=readFileSync(new URL('../media/project-knowledge.js',import.meta.url),'utf8'),sandbox={module:{exports:{}}};
vm.runInNewContext(source,sandbox);const model=sandbox.module.exports,copy=value=>JSON.parse(JSON.stringify(value));
const projectId='knowledge-project',digest='a'.repeat(64);
function fixture(){
 const decision=projectDecisionFixture({projectId,kind:'change-set'}),issue=reproducibleIssueFixture({projectId});
 decision.id='decision-1';issue.id='issue-1';decision.createdAt='2026-10-31T20:00:00.000Z';issue.createdAt='2026-11-01T20:00:00.000Z';
 const d={record:decision,digest,status:{source:'current',adoption:'applied',evidence:'available',scope:'current'},canShare:true};
 const i={record:issue,digest,status:{source:'current',captureSource:'current',run:'available',replay:'available',capture:'available'},canShare:true};
 const view=entry=>({schemaVersion:1,projectId,revision:2,storage:{status:'saved'},records:[entry]});
 return {projectId,decision,issue,d,i,decisions:view(d),issues:view(i)};
}
const project=h=>model.project({projectId:h.projectId,decisions:h.decisions,issues:h.issues});
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

test('projection exposes bounded metadata and keeps source, request bodies and raw evidence out of the search model',()=>{
 const h=fixture(),before=copy(h);freeze(h);const items=project(h);
 assert.deepEqual(copy(items.map(item=>item.key)),['issue:issue-1','decision:decision-1']);assert.equal(items[0].summary,h.issue.actualOutcome);assert.equal(items[1].summary,h.decision.rationale);
 assert.deepEqual(copy(items[1].paths),[...h.decision.feature.paths].sort());assert.equal(items[0].evidence.length,3);assert.equal(items[1].evidence.length,6);
 for(const item of items){assert.equal(item.canShare,true);assert.equal(item.statusGroup,'current');assert.equal(Object.hasOwn(item,'record'),false);assert.equal(Object.hasOwn(item,'run'),false);assert.equal(Object.hasOwn(item,'contextFiles'),false);assert.equal(Object.hasOwn(item,'reproduction'),false);}
 assert.deepEqual(h,before);assert.equal(JSON.stringify(items).includes('http://127.0.0.1'),false);
});

test('only a matching valid project journal can contribute records',()=>{
 for(const change of [h=>h.projectId='bad owner',h=>h.decisions.projectId='foreign',h=>h.decisions.schemaVersion=2,h=>h.decisions.revision=-1,h=>h.decisions.storage.status='unknown',h=>h.decisions.records=null,h=>h.d.record.projectId='foreign']){
  const h=fixture();h.issues=null;change(h);assert.equal(project(h).length,0);
 }
 assert.equal(model.project(null).length,0);
});

test('storage recovery retains readable records but never offers sharing before saved',()=>{
 for(const status of ['saving','error','unavailable']){const h=fixture();h.decisions.storage.status=status;h.issues.storage.status=status;const items=project(h);assert.equal(items.length,2);assert.ok(items.every(item=>!item.canShare));assert.ok(items.every(item=>/storage/.test(item.reason)));}
});

test('invalid record references and ambiguous duplicate identities are omitted',()=>{
 for(const change of [h=>h.d.digest='forged',h=>h.decision.createdAt='2026-02-30T20:00:00.000Z',h=>h.decision.title='x\u0000',h=>h.decision.contextFiles[0].path='../secrets',h=>h.decision.contextFiles[0].path='/secrets',h=>h.decision.contextFiles[0].path='src\\secret',h=>h.decision.contextFiles[0].path='src//file',h=>h.decision.contextFiles[0].hash='0',h=>h.decision.feature.id='bad id',h=>h.decision.choice.scope.scenario.title='',h=>h.d.status.scope='unknown']){
  const h=fixture();h.issues=null;change(h);assert.equal(project(h).length,0);
 }
 const h=fixture();h.decisions.records.push(copy(h.d));assert.deepEqual(copy(project(h).map(item=>item.kind)),['issue']);
});

test('status filters distinguish historical records, missing evidence, undone and superseded decisions',()=>{
 for(const [status,label,group] of [[{source:'stale'},'Stale','historical'],[{adoption:'undone'},'Not applied','historical'],[{supersededBy:'decision-2'},'Superseded','historical'],[{source:'missing'},'Unavailable','unavailable'],[{evidence:'missing'},'Unavailable','unavailable']]){
  const h=fixture();Object.assign(h.d.status,status);const items=project(h),item=items.find(item=>item.kind==='decision');assert.equal(item.status,label);assert.equal(item.statusGroup,group);assert.equal(item.canShare,false);assert.equal(model.search(items,{status:group,kind:'decision'}).length,1);assert.equal(model.search(items,{status:'current',kind:'decision'}).length,0);
 }
 const h=fixture();h.i.status.source='stale';let items=project(h);assert.equal(items[0].status,'Historical');assert.equal(items[0].canShare,true,'Historical issues remain shareable with their explicit historical context');h.i.status.capture='missing';items=project(h);assert.equal(items[0].status,'Evidence unavailable');assert.equal(items[0].canShare,true,'Missing evidence is labeled, not silently rewritten or removed');
});

test('search ANDs literal normalized Unicode tokens across title, rationale, feature, screen, scenario and source',()=>{
 const h=fixture();h.decision.title='Café profile [saving]';h.decision.rationale='Clear feedback for Unicode ＳＡＶＥ behavior.';h.decision.feature.title='Account settings';h.decision.choice.scope.screen.title='Profile editor';h.decision.choice.scope.scenario.title='Slow save';const items=project(h);
 for(const query of ['cafe\u0301 SAVE','[saving] feedback','account editor slow','src/SaveButton.tsx cafe\u0301'])assert.deepEqual(copy(model.search(items,{query}).map(item=>item.id)),['decision-1'],query);
 assert.equal(model.search(items,{query:'.*'}).length,0);assert.equal(model.search(items,{query:'café absent'}).length,0);
 assert.equal(model.search(items,{query:'\u0000café\nSAVE'}).length,1);assert.equal(model.search(items,{query:' '.repeat(256)+'absent'}).length,2,'The query is bounded before evaluation');
});

test('kind and feature filters combine with search and maintain deterministic newest-first key ties',()=>{
 const h=fixture();h.issue.createdAt=h.decision.createdAt;const items=project(h);assert.deepEqual(copy(items.map(item=>item.key)),['decision:decision-1','issue:issue-1']);assert.equal(model.search(items,{kind:'issue'}).length,1);assert.equal(model.search(items,{featureId:h.decision.feature.id}).length,1);assert.equal(model.search(items,{kind:'issue',featureId:h.decision.feature.id}).length,0);
 const before=copy(items);freeze(items);model.search(items,{query:'save'});assert.deepEqual(copy(items),before);
});

test('related records show factual shared source or feature, never inferred causation',()=>{
 const h=fixture();h.issue.contextFiles[0].path=h.decision.contextFiles[0].path;let items=project(h),relations=model.related(items,'decision:decision-1');assert.equal(relations.length,1);assert.equal(relations[0].sameFeature,false);assert.deepEqual(copy(relations[0].sharedPaths),[h.decision.contextFiles[0].path]);assert.equal(relations[0].reason,'Shared source file');
 h.issue.run.feature.id=h.decision.feature.id;items=project(h);relations=model.related(items,'decision:decision-1');assert.equal(relations[0].sameFeature,true);assert.match(relations[0].reason,/Same feature/);assert.equal(relations[0].reason.includes('cause'),false);
});

test('exact retained evidence relationships require both kind and digest as well as identity',()=>{
 const h=fixture();h.issue.run.id=h.decision.choice.evidence[0].run.id;h.issue.runDigest=h.decision.choice.evidence[0].run.digest;
 let items=project(h),relations=model.related(items,'decision:decision-1');assert.equal(relations.length,1);assert.equal(relations[0].evidence[0].kind,'run');assert.equal(relations[0].reason,'Same retained evidence');
 h.issue.runDigest='b'.repeat(64);assert.equal(model.related(project(h),'decision:decision-1').length,0);
 h.issue.run.id=h.decision.choice.evidence[0].capture.id;h.issue.runDigest=h.decision.choice.evidence[0].capture.digest;assert.equal(model.related(project(h),'decision:decision-1').length,0);
 items=project(h);items[0].projectId='foreign';items[0].feature.id=items[1].feature.id;assert.equal(model.related(items,'decision:decision-1').length,0);
});

test('relationships and searches cannot expand beyond the bounded journal capacity',()=>{
 const h=fixture();h.decisions.records=Array.from({length:32},(_,n)=>({...copy(h.d),record:{...copy(h.decision),id:'decision-'+n}}));h.issues.records=Array.from({length:32},(_,n)=>({...copy(h.i),record:{...copy(h.issue),id:'issue-'+n}}));let items=project(h);assert.equal(items.length,64);assert.equal(model.search(items).length,64);assert.equal(model.related(items,'decision:decision-0').length,31);
 h.decisions.records.push(copy(h.d));assert.equal(project(h).length,32,'An oversized journal is not silently truncated');items.push({...items[0],id:'overflow',key:'issue:overflow'});assert.equal(model.search(items).length,0);assert.equal(model.related(items,items[0].key).length,0);
});

test('view normalization restores only matching project state and excludes unknown persisted fields',()=>{
 const input={projectId,query:' Café ',kind:'issue',featureId:'feature-1',status:'historical',selectedKey:'issue:issue-1',source:'secret',requestContext:{unselected:true}};
 assert.deepEqual(copy(model.normalize(input,projectId)),{projectId,query:' Café ',kind:'issue',featureId:'feature-1',status:'historical',selectedKey:'issue:issue-1'});
 assert.deepEqual(copy(model.normalize(input,'other-project')),{projectId:'other-project',query:'',kind:'all',featureId:'all',status:'all',selectedKey:null});assert.equal(model.normalize(input,'invalid owner'),null);
 assert.deepEqual(copy(model.normalize({...input,query:'x'.repeat(300),kind:'other',status:'unknown',featureId:'bad/id',selectedKey:'issue:../secret'},projectId)),{projectId,query:'x'.repeat(256),kind:'all',featureId:'all',status:'all',selectedKey:null});assert.equal(model.normalizeViewState,model.normalize);
});

test('browser export is available without CommonJS and malformed search inputs are harmless',()=>{
 const browser={window:{}};vm.runInNewContext(source,browser);assert.equal(typeof browser.window.FoundationKnowledge.project,'function');assert.equal(Object.isFrozen(browser.window.FoundationKnowledge),true);
 for(const input of [null,{},[null],[{}],[{key:'issue:1'}]]){assert.equal(model.search(input).length,0);assert.equal(model.related(input,'issue:1').length,0);}
});
