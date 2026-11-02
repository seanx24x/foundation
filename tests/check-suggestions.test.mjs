import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {normalizeCheckContext,createCheckSuggestion,validateCheckSuggestion,checkSuggestionDigest} from '../server/project/assistant-artifacts.mjs';
import {createAssistantService} from '../server/project/assistant.mjs';
import {createBuildArtifact,changeGroupDigest} from '../server/project/proposals.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const catalog=[{id:'node:test',label:'Node tests'},{id:'typescript:check',label:'TypeScript check'}];
const files=['src/a.mjs','src/b.mjs'].map(path=>({path,source:'export const value = 1;\n',revision:hash('export const value = 1;\n').slice(0,16)}));
function groupValue(){return {...createBuildArtifact({projectId:'fixture',files,raw:JSON.stringify({title:'Coordinated values',summary:'Change both values.',edits:files.map(file=>({path:file.path,find:'= 1;',replace:'= 2;'})),verification:['Check the values.']})}).changeSet,requestId:'parent-build'};}
const binding=group=>({version:1,conversationId:'conversation-1',requestId:'parent-build',groupId:group.id,groupRevision:group.revision,groupDigest:changeGroupDigest(group),snapshotRevision:hash('whole copied snapshot'),tasks:structuredClone(catalog)});
const raw=()=>({title:'Check staged values',summary:'Use the advertised local checks.',checks:[{taskId:'typescript:check',reason:'Find type errors; this does not prove runtime behavior.'},{taskId:'node:test',reason:'Run the discovered tests; coverage is unknown.'}],limitations:['No command has run.']});
const create=(value=raw(),context=binding(groupValue()))=>createCheckSuggestion({raw:JSON.stringify(value),checkContext:context,projectId:'fixture'});

test('check context is exact detached metadata with canonical labels and no executable payload',()=>{
 const source=binding(groupValue()),copy=normalizeCheckContext(source);assert.deepEqual(copy,source);source.tasks[0].label='changed';assert.equal(copy.tasks[0].label,'Node tests');assert.equal(normalizeCheckContext(undefined),undefined);
 const mutations=[v=>v.version=2,v=>v.groupRevision=-1,v=>v.groupId='bad',v=>v.snapshotRevision='bad',v=>v.command='npm test',v=>v.tasks[0].command='node secret.test.js',v=>v.tasks[0].label='custom label',v=>v.tasks[0].id='shell',v=>v.tasks.push(v.tasks[0]),v=>v.tasks=[],v=>v.tasks[0].effects=['read']];for(const mutate of mutations){const value=binding(groupValue());mutate(value);assert.throws(()=>normalizeCheckContext(value),{code:'invalid-check-context'});}
});
test('recommendations contain only advertised unique checks, and zero checks is an honest valid outcome',()=>{
 const context=binding(groupValue()),artifact=create(raw(),context);assert.equal(artifact.verificationStatus,'not-run');assert.deepEqual(artifact.checks,raw().checks);assert.deepEqual(validateCheckSuggestion(artifact,context,'fixture'),artifact);assert.match(checkSuggestionDigest(artifact),/^[a-f0-9]{64}$/);assert.equal(create({...raw(),checks:[]},context).checks.length,0);
 const mutations=[v=>v.command='npm test',v=>v.id=randomUUID(),v=>v.verificationStatus='passed',v=>v.checks[0].status='passed',v=>v.checks[0].taskId='shell',v=>v.checks[0].reason='x'.repeat(1001),v=>v.checks[0].reason='\ud800',v=>v.checks[0].path='.env',v=>v.checks.push(v.checks[0]),v=>v.title=' ',v=>v.limitations=Array(13).fill('limit')];for(const mutate of mutations){const value=raw();mutate(value);assert.throws(()=>create(value,context));}
 assert.throws(()=>create(raw(),{...context,tasks:[catalog[0]]}));const changed={...artifact,summary:'Changed rationale'};assert.notEqual(checkSuggestionDigest(changed),checkSuggestionDigest(artifact));assert.throws(()=>validateCheckSuggestion({...artifact,verificationStatus:'passed'},context,'fixture'));
});
async function serve(t,server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return `http://127.0.0.1:${server.address().port}`;}
const delta=text=>`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})}\n\n`;
async function harness(t,{respond,resolve,read,providerKind='compatible'}={}){
 const group=groupValue(),context=binding(group),captured=[],downstream=[],calls={resolve:0};
 const providerUrl=await serve(t,createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));captured.push(body);res.writeHead(200,{'Content-Type':'text/event-stream'});if(respond){await respond({res,body,group,context});return;}res.end(delta(JSON.stringify(raw()))+`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);}));
 const service=createAssistantService({projectService:{getFile:async(id,path)=>{assert.equal(id,'fixture');return read?read(path,files):structuredClone(files.find(file=>file.path===path));}},config:{providerKind,baseUrl:providerUrl,model:'fixture-model'},resolveCheckContext:async descriptor=>{calls.resolve++;return resolve?resolve({descriptor,group,context,calls}):{context,group};}});
 const url=await serve(t,createServer(async(req,res)=>{res.once('close',()=>{calls.closed=(calls.closed||0)+1;});const write=res.write.bind(res);res.write=(chunk,...args)=>{downstream.push(String(chunk));return write(chunk,...args);};const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};try{const chunks=[];for await(const chunk of req)chunks.push(chunk);await service.handle({request:req,response:res,url:new URL(req.url,'http://fixture'),body:JSON.parse(Buffer.concat(chunks)),send});}catch(error){if(!res.headersSent)send(error.status||500,{code:error.code,error:error.message});else res.end();}}));
 const body={projectId:'fixture',intent:'plan',prompt:'Recommend the supported checks for this staged group.',context:files.map(({path,revision})=>({path,revision})),checkContext:context};
 const ask=async(input=body,options={})=>{const response=await fetch(url+'/api/assistant/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),...options});const text=await response.text();return {status:response.status,events:text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))};};return {group,context,body,ask,captured,downstream,calls,service};
}

test('provider receives staged selected source and IDs/labels only; durable artifact has no execution claim',async t=>{
 const h=await harness(t),result=await h.ask();assert.equal(result.status,200);const suggestion=result.events.find(event=>event.type==='checkSuggestion').checkSuggestion;assert.equal(result.events.at(-1).type,'done');assert.equal(suggestion.verificationStatus,'not-run');assert.equal(h.calls.resolve,4);const input=JSON.parse(h.captured[0].messages[1].content);assert.deepEqual(input.availableChecks,catalog);assert.ok(input.sources.every(source=>source.content.includes('= 2;')));for(const forbidden of [h.context.groupId,h.context.groupDigest,h.context.snapshotRevision,'parent-build','conversation-1','PRIVATE_TOOL_OUTPUT','command','environment'])assert.equal(JSON.stringify(input).includes(forbidden),false);assert.equal(h.service.status().capabilities.tools,false);
});
test('mixed handoffs, extra catalog payload and unavailable tasks are rejected before any provider request',async t=>{
 const h=await harness(t);for(const extra of [{intent:'ask'},{taskContext:{}},{runtimeContext:{}},{groupRevision:{}},{requestRevision:{}},{planContext:{}},{changeSets:true},{checkContext:{...h.context,tasks:[{...catalog[0],command:'npm test'}]}}]){const result=await h.ask({...h.body,...extra});assert.equal(result.status,400);}assert.equal(h.captured.length,0);
});
test('changed host catalog before dispatch rejects recommendation without sending source',async t=>{
 const h=await harness(t,{resolve:({group,context,calls})=>({group,context:calls.resolve===2?{...context,snapshotRevision:hash('changed')}:context})});const result=await h.ask();assert.equal(result.status,409);assert.equal(h.captured.length,0);
});
test('a group or copied snapshot that changes during streaming cannot publish an actionable suggestion',async t=>{
 const h=await harness(t,{resolve:({group,context,calls})=>({group,context:calls.resolve>=3?{...context,snapshotRevision:hash('changed')}:context})});const result=await h.ask();assert.equal(result.events.at(-1).type,'error');assert.equal(result.events.some(event=>event.type==='checkSuggestion'),false);
});
test('unadvertised output, incomplete output and native tool calls never become check artifacts',async t=>{
 for(const mode of ['unknown','incomplete','tools']){
  const h=await harness(t,{respond:({res})=>{if(mode==='tools')return res.end(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{id:'call',function:{name:'shell',arguments:'{}'}}]}}]})}\n\n`);const value=raw();if(mode==='unknown')value.checks=[{taskId:'npm:test',reason:'invented'}];res.end(delta(JSON.stringify(value))+(mode==='incomplete'?'':`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`));}});const result=await h.ask();assert.equal(result.events.at(-1).type,'error');assert.equal(result.events.some(event=>event.type==='checkSuggestion'),false);
 }
});
test('zero recommended checks remains complete without inventing a tool action',async t=>{
 const h=await harness(t,{respond:({res})=>res.end(delta(JSON.stringify({...raw(),checks:[]}))+`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`)});const result=await h.ask();assert.deepEqual(result.events.find(event=>event.type==='checkSuggestion').checkSuggestion.checks,[]);assert.equal(result.events.at(-1).type,'done');
});

test('OpenAI and Anthropic text adapters carry recommendations without enabling provider tools',async t=>{
 for(const providerKind of ['openai','anthropic']){
  const h=await harness(t,{providerKind,respond:({res})=>{
   const message=JSON.stringify(raw());
   if(providerKind==='openai')res.end(`data: ${JSON.stringify({type:'response.output_text.delta',delta:message})}\n\ndata: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[]}})}\n\n`);
   else res.end(`data: ${JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:message}})}\n\ndata: ${JSON.stringify({type:'message_delta',delta:{stop_reason:'end_turn'}})}\n\ndata: ${JSON.stringify({type:'message_stop'})}\n\n`);
  }});const result=await h.ask();assert.equal(result.events.at(-1).type,'done');assert.equal(result.events.filter(event=>event.type==='checkSuggestion').length,1);assert.equal(Object.hasOwn(h.captured[0],'tools'),false);const payload=JSON.parse(providerKind==='openai'?h.captured[0].input[0].content[0].text:h.captured[0].messages[0].content);assert.deepEqual(payload.availableChecks,catalog);
 }
});


test('cancellation during final host revalidation cannot publish a late recommendation',async t=>{
 let release;const hold=new Promise(resolve=>release=resolve);const h=await harness(t,{resolve:async({group,context,calls})=>{if(calls.resolve>=3)await hold;return {group,context};}}),controller=new AbortController();const request=h.ask(h.body,{signal:controller.signal});
 for(let i=0;i<200&&h.calls.resolve<3;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(h.calls.resolve>=3);controller.abort();await assert.rejects(request);for(let i=0;i<200&&!h.calls.closed;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(h.calls.closed,'transport cancellation reaches the server before releasing final validation');release();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(h.downstream.some(line=>line.includes('"type":"checkSuggestion"')),false);
});
