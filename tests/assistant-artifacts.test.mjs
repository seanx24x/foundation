import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAssistantIntent,createPlanArtifact,createReviewArtifact,validatePlanArtifact,validateReviewArtifact,normalizePlanContext} from '../server/project/assistant-artifacts.mjs';
const files=[{id:'S1',path:'src/Button.tsx',revision:'button-r1',source:'export function Button() {\n  return <button>Save</button>;\n}\n'}];
const reference=()=>({sourceId:'S1',line:2});
const plan=()=>({title:'Improve save',summary:'Clarify states in selected source.',steps:[{title:'Review state',detail:'Check the selected button before proposing changes.',references:[reference()]}],risks:['Runtime behavior is unknown.'],verification:['Inspect loading and error states.']});
const review=()=>({title:'Review save',summary:'Selected source only.',findings:[{severity:'medium',title:'Missing state feedback',detail:'This source shows a fixed label.',references:[reference()],suggestion:'Consider explicit loading feedback.'}],limitations:['No runtime was exercised.']});
const createPlan=value=>createPlanArtifact({raw:typeof value==='string'?value:JSON.stringify(value),files,projectId:'fixture'});
const createReview=value=>createReviewArtifact({raw:typeof value==='string'?value:JSON.stringify(value),files,projectId:'fixture'});
const selection=()=>{const artifact=createPlan(plan());return {version:1,conversationId:'conversation-1',requestId:'request-1',artifactId:artifact.id,revision:0,stepId:artifact.steps[0].id,title:artifact.title,summary:artifact.summary,step:{title:artifact.steps[0].title,detail:artifact.steps[0].detail,references:artifact.steps[0].references},verification:artifact.verification};};

test('intent normalization preserves four modes and maps missing/legacy values without accepting invented authority',()=>{
  assert.equal(normalizeAssistantIntent(undefined),'ask');assert.equal(normalizeAssistantIntent('change'),'build');
  for(const intent of ['ask','plan','build','review'])assert.equal(normalizeAssistantIntent(intent),intent);
  for(const intent of [null,'execute','PLAN','',{},1])assert.throws(()=>normalizeAssistantIntent(intent),{code:'invalid-intent'});
});
test('plan and review constructors generate identities, map real source ranges, and never claim verification',()=>{
  for(const [input,create,validate,key]of [[plan(),createPlan,validatePlanArtifact,'steps'],[review(),createReview,validateReviewArtifact,'findings']]){
    const result=create(input);assert.match(result.id,/^[\da-f-]{36}$/);assert.notEqual(result.id,result[key][0].id);
    assert.deepEqual(result[key][0].references,[{sourceId:'S1',path:files[0].path,revision:'button-r1',line:2,endLine:2}]);
    assert.deepEqual(result.context,[{id:'S1',path:files[0].path,revision:'button-r1',lines:4}]);assert.equal(result.verificationStatus,'not-run');
    assert.deepEqual(validate(result,files,'fixture'),result);const clone=validate(result,files,'fixture');clone[key][0].title='Changed';assert.notEqual(result[key][0].title,clone[key][0].title);
  }
});
test('an empty review is valid unverified output and plans may explicitly have no source reference for a step',()=>{
  const value=review();value.findings=[];assert.equal(createReview(value).verificationStatus,'not-run');
  const p=plan();p.steps[0].references=[];assert.deepEqual(createPlan(p).steps[0].references,[]);
});
test('provider output cannot supply artifact IDs, paths, execution status, tools, source revisions or completed verification',()=>{
  for(const [create,value,key]of [[createPlan,plan(),'steps'],[createReview,review(),'findings']]){
    for(const extra of [{id:'forged'},{schemaVersion:1},{projectId:'foreign'},{verificationStatus:'passed'},{tools:['shell']},{context:[]}])assert.throws(()=>create({...value,...extra}),{code:'invalid-assistant-artifact'});
    for(const extra of [{id:'forged'},{status:'complete'},{command:'npm test'}]){const changed=structuredClone(value);Object.assign(changed[key][0],extra);assert.throws(()=>create(changed));}
    for(const extra of [{path:'src/private.env'},{revision:'invented'},{url:'https://foreign'}]){const changed=structuredClone(value);Object.assign(changed[key][0].references[0],extra);assert.throws(()=>create(changed));}
  }
});
test('references require selected source IDs, real inclusive line ranges, uniqueness and bounded counts',()=>{
  for(const references of [[{sourceId:'S2',line:1}],[{sourceId:'S1',line:0}],[{sourceId:'S1',line:5}],[{sourceId:'S1',line:1.5}],[{sourceId:'S1',line:2,endLine:1}],[{sourceId:'S1',line:1,endLine:5}],[reference(),reference()],Array.from({length:9},(_,i)=>({sourceId:'S1',line:i+1}))]){
    const value=plan();value.steps[0].references=references;assert.throws(()=>createPlan(value));
  }
  const value=review();value.findings[0].references=[];assert.throws(()=>createReview(value));
});
test('structured output requires complete raw JSON, valid UTF-8, bounded content and supported nested shapes',()=>{
  for(const raw of ['', 'not json', '```json\n{}\n```','null','[]','{"title":','x'.repeat(65537)])assert.throws(()=>createPlan(raw));
  for(const mutate of [v=>v.title=' ',v=>v.title='x'.repeat(161),v=>v.title='😀'.repeat(41),v=>v.summary='x'.repeat(2001),v=>v.summary='\ud800',v=>v.steps=[],v=>v.steps=Array.from({length:17},()=>plan().steps[0]),v=>v.steps[0].detail='\0',v=>v.risks=Array(13).fill('risk'),v=>v.verification=['x'.repeat(501)],v=>v.steps[0].references=null]){const value=plan();mutate(value);assert.throws(()=>createPlan(value));}
  for(const mutate of [v=>v.findings=Array.from({length:25},()=>review().findings[0]),v=>v.findings[0].severity='critical',v=>v.findings[0].suggestion='',v=>v.limitations=null]){const value=review();mutate(value);assert.throws(()=>createReview(value));}
});
test('canonical validation refuses project, schema, source, context, duplicate ID and verification tampering',()=>{
  for(const [create,validate,key]of [[()=>createPlan(plan()),validatePlanArtifact,'steps'],[()=>createReview(review()),validateReviewArtifact,'findings']]){
    for(const mutate of [v=>v.schemaVersion=2,v=>v.projectId='other',v=>v.id='not-uuid',v=>v.verificationStatus='passed',v=>v.context[0].lines=999,v=>v.context[0].path='src/Elsewhere.ts',v=>v[key][0].references[0].revision='changed',v=>v[key][0].references[0].endLine=999,v=>v[key][0].id=v.id,v=>v[key].push(structuredClone(v[key][0])),v=>v.authority='execute']){const value=create();mutate(value);assert.throws(()=>validate(value,files,'fixture'));}
    assert.throws(()=>validate(create(),[{...files[0],revision:'changed'}],'fixture'));
  }
});
test('plan context is an exact detached selected step, optionally verified against reordered selected sources',()=>{
  const value=selection(), result=normalizePlanContext(value,files);assert.deepEqual(result,value);value.step.detail='changed';assert.notEqual(result.step.detail,value.step.detail);
  const reordered=[{id:'S1',path:'src/Other.ts',revision:'other-r1',source:'export const other = true;\n'},{...files[0],id:'S2'}];
  assert.equal(normalizePlanContext(result,reordered).step.references[0].sourceId,'S1');assert.equal(normalizePlanContext(undefined),undefined);
});
test('invalid plan context or refs cannot invent source, runtime, tools, authority, verification or extra steps',()=>{
  for(const mutate of [v=>v.version=2,v=>v.revision=-1,v=>v.revision=0.5,v=>v.artifactId='forged',v=>v.stepId='forged',v=>v.title='',v=>v.step.detail='x'.repeat(2001),v=>v.steps=[],v=>v.tools=['shell'],v=>v.runtimeEvidence=[],v=>v.verificationStatus='passed',v=>v.step.references[0].revision='changed',v=>v.step.references[0].path='../outside',v=>v.step.references[0].endLine=999,v=>v.step.references[0].source='SECRET_SOURCE']){const value=selection();mutate(value);assert.throws(()=>normalizePlanContext(value,files),{code:'invalid-plan-context'});}
  for(const value of [null,[],{},'text'])assert.throws(()=>normalizePlanContext(value),{code:'invalid-plan-context'});
});
