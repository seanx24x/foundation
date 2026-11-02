import {reproducibleIssueContextFixture} from './helpers/reproducible-issue-fixture.mjs';
import {reproducibleIssueDigest} from '../server/project/reproducible-issues.mjs';
import {decisionContextFixture, decisionFixture} from './helpers/project-decision-context.mjs';
import {projectDecisionDigest} from '../server/project/project-decisions.mjs';
import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createAssistantService,normalizeTaskContext} from '../server/project/assistant.mjs';

const source={path:'src/Button.tsx',revision:'saved-r1',source:'export const Button = () => <button>Save</button>;\n'};
const question={projectId:'fixture',prompt:'Explain this action.',context:[{path:source.path,revision:source.revision}]};
const projectService={async getFile(projectId,path){assert.equal(projectId,'fixture');assert.equal(path,source.path);return source;}};
const frame=value=>`data: ${JSON.stringify(value)}\n\n`;
const readBody=async request=>{const chunks=[];for await(const chunk of request)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks));};
const readEvents=async response=>(await response.text()).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
const protocols={
 openai:{
  start:()=>frame({type:'response.created',response:{model:'reported-openai'}}),
  text:text=>frame({type:'response.output_text.delta',delta:text}),
  finish:()=>frame({type:'response.completed',response:{status:'completed',model:'reported-openai',usage:{input_tokens:10,output_tokens:5,total_tokens:15}}}),
  tool:()=>frame({type:'response.output_item.added',item:{type:'function_call',name:'run_shell',arguments:'SECRET_TOOL_PAYLOAD'}}),
  incomplete:()=>frame({type:'response.incomplete',response:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}}),
 },
 anthropic:{
  start:()=>frame({type:'message_start',message:{model:'reported-anthropic',usage:{input_tokens:6,cache_read_input_tokens:3,cache_creation_input_tokens:1,output_tokens:0}}}),
  text:text=>frame({type:'content_block_delta',index:0,delta:{type:'text_delta',text}}),
  finish:()=>frame({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:5}})+frame({type:'message_stop'}),
  tool:()=>frame({type:'content_block_start',index:1,content_block:{type:'tool_use',name:'run_shell',input:{secret:'SECRET_TOOL_PAYLOAD'}}}),
  incomplete:()=>frame({type:'message_delta',delta:{stop_reason:'max_tokens'},usage:{output_tokens:5}})+frame({type:'message_stop'}),
 }
};
async function listen(t,server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});return `http://127.0.0.1:${server.address().port}`;}
async function harness(t,kind,handler,options={}){
 const provider=createServer(handler);const endpoint=await listen(t,provider);
 const service=createAssistantService({projectService:options.projectService||projectService,config:{providerKind:kind,baseUrl:`${endpoint}/v1`,model:'selected-model',apiKey:'TEST_KEY_NEVER_ECHO',timeoutMs:3000,...options.config},...(options.resolveRuntimeEvidence?{resolveRuntimeEvidence:options.resolveRuntimeEvidence}:{}),...(options.resolveDecisionContext?{resolveDecisionContext:options.resolveDecisionContext}:{}),...(options.resolveIssueContext?{resolveIssueContext:options.resolveIssueContext}:{})});
 const server=createServer(async(request,response)=>{
  const send=(status,value)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};
  try{await service.handle({request,response,url:new URL(request.url,'http://localhost'),body:await readBody(request),send});}
  catch(error){if(!response.headersSent)send(error.status||500,{code:error.code,error:error.message});else response.end();}
 });
 const url=await listen(t,server);
 return {service,ask:(body=question,options={})=>fetch(`${url}/api/assistant/ask`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),...options})};
}
for(const [kind,protocol] of Object.entries(protocols)){
 test(`${kind} uses its native protocol, explicit source context, reported usage and safe public capabilities`,async t=>{
  let received,path,headers;
  const {ask,service}=await harness(t,kind,async(req,res)=>{
   received=await readBody(req);path=req.url;headers=req.headers;res.writeHead(200,{'Content-Type':'text/event-stream'});
   const data=Buffer.from(protocol.start()+': keepalive\n\n'+protocol.text('Selected source ✓ [S1:1]')+protocol.finish());
   for(let i=0;i<data.length;i+=3)res.write(data.subarray(i,i+3));res.end();
  });
  const events=await readEvents(await ask());
  assert.equal(path,kind==='openai'?'/v1/responses':'/v1/messages');
  assert.equal(received.model,'selected-model');assert.equal(received.stream,true);
  assert.equal(received.tools,undefined);assert.equal(received.previous_response_id,undefined);
  const input=kind==='openai'?JSON.parse(received.input[0].content[0].text):JSON.parse(received.messages[0].content);
  assert.equal(input.sources[0].path,source.path);assert.equal(input.sources.length,1);
  assert.equal(input.question,question.prompt);assert.equal(input.runtimeEvidence,undefined);
  if(kind==='openai'){assert.equal(headers.authorization,'Bearer TEST_KEY_NEVER_ECHO');assert.equal(headers['x-api-key'],undefined);assert.equal(received.store,false);assert.match(received.instructions,/untrusted/);}
  else {assert.equal(headers['x-api-key'],'TEST_KEY_NEVER_ECHO');assert.equal(headers.authorization,undefined);assert.equal(headers['anthropic-version'],'2023-06-01');assert.equal(received.max_tokens,8192);assert.match(received.system,/untrusted/);}
  assert.equal(events.filter(e=>e.type==='delta').map(e=>e.text).join(''),'Selected source ✓ [S1:1]');
  assert.deepEqual(events.at(-1).usage,{prompt_tokens:10,completion_tokens:5,total_tokens:15});
  assert.equal(events.at(-1).type,'done');assert.equal(events.at(-1).model,`reported-${kind}`);
  assert.equal(events.at(-1).finishReason,'stop');assert.equal(events[0].providerKind,kind);
  assert.deepEqual(service.status().capabilities,{text:true,images:false,tools:false});
  assert.equal(service.status().providerKind,kind);assert.doesNotMatch(JSON.stringify([events,service.status()]),/TEST_KEY_NEVER_ECHO|apiKey/);
 });
 test(`${kind} cannot turn incomplete, malformed, failed, or tool responses into completed work`,async t=>{
  for(const ending of ['', 'data: INVALID_JSON\n\n',protocol.incomplete(),protocol.tool(),frame({type:'error',error:{message:'TEST_KEY_NEVER_ECHO'}})]){
   const {ask}=await harness(t,kind,async(req,res)=>{await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text('Preserved partial')+ending);});
   const events=await readEvents(await ask());assert.equal(events.find(e=>e.type==='delta').text,'Preserved partial');assert.equal(events.at(-1).type,'error');
   assert.equal(events.some(e=>e.type==='done'||e.type==='proposal'),false);assert.doesNotMatch(JSON.stringify(events),/TEST_KEY_NEVER_ECHO|SECRET_TOOL_PAYLOAD/);
  }
 });
 test(`${kind} validates one-file changes without writing source`,async t=>{
  const change=JSON.stringify({title:'Clearer label',summary:'Change only this button.',edits:[{path:source.path,find:'>Save</button>',replace:'>Save changes</button>'}],verification:['Inspect the label.']});
  const {ask}=await harness(t,kind,async(req,res)=>{await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(change)+protocol.finish());});
  const events=await readEvents(await ask({...question,intent:'change'}));const proposal=events.find(e=>e.type==='proposal').proposal;
  assert.equal(proposal.path,source.path);assert.equal(proposal.baseRevision,source.revision);assert.match(proposal.after,/Save changes/);assert.doesNotMatch(source.source,/Save changes/);assert.equal(events.at(-1).type,'done');
 });
 test(`${kind} cancellation closes the upstream stream and preserves partial output`,async t=>{
  let resolveClosed;const closed=new Promise(resolve=>resolveClosed=resolve);
  const {ask}=await harness(t,kind,async(req,res)=>{await readBody(req);res.on('close',resolveClosed);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(protocol.start()+protocol.text('Partial before cancellation'));});
  const abort=new AbortController();const response=await ask(question,{signal:abort.signal});const reader=response.body.getReader();let text='';while(!text.includes('Partial before cancellation'))text+=new TextDecoder().decode((await reader.read()).value);abort.abort();
  await Promise.race([closed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Provider stream did not close')),1000);timer.unref();})]);
  assert.match(text,/Partial before cancellation/);assert.doesNotMatch(text,/"type":"done"/);
 });
 test(`${kind} rejects provider authentication errors without leaking response bodies`,async t=>{
  const {ask}=await harness(t,kind,async(req,res)=>{await readBody(req);res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":"TEST_KEY_NEVER_ECHO"}');});
  const events=await readEvents(await ask());assert.equal(events.at(-1).code,'provider-error');assert.match(events.at(-1).error,/credentials/);assert.doesNotMatch(JSON.stringify(events),/TEST_KEY_NEVER_ECHO/);
 });
}
const observation={id:'request-1',session:'runtime-1',kind:'request',method:'POST',url:'http://user:secret@localhost:4173/api/profile?token=SECRET_QUERY#SECRET_HASH',status:503,durationMs:35.2,outcome:'http-error',observedAt:'2026-10-28T10:00:00.000Z',correlation:'unattributed',headers:{authorization:'SECRET_HEADER'},body:'SECRET_BODY'};
for(const kind of Object.keys(protocols))test(`${kind} shares only host-resolved selected runtime metadata and records its snapshot`,async t=>{
 let received,resolved;const protocol=protocols[kind];
 const {ask}=await harness(t,kind,async(req,res)=>{received=await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text('A recorded request failed.')+protocol.finish());},{resolveRuntimeEvidence:async descriptor=>{resolved=descriptor;return [observation];}});
 const runtimeContext={session:'runtime-1',observationIds:['request-1']};const events=await readEvents(await ask({...question,runtimeContext,runtimeEvidence:[{body:'FORGED_DIRECT_EVIDENCE'}]}));
 assert.deepEqual(resolved,{projectId:'fixture',...runtimeContext});
 const input=kind==='openai'?JSON.parse(received.input[0].content[0].text):JSON.parse(received.messages[0].content);
 assert.deepEqual(input.runtimeEvidence,[{id:'R1',observationId:'request-1',session:'runtime-1',kind:'request',method:'POST',url:'http://localhost:4173/api/profile',status:503,durationMs:35.2,outcome:'http-error',observedAt:observation.observedAt,correlation:'unattributed',provenance:'observed'}]);
 assert.deepEqual(events[0].runtimeEvidence,input.runtimeEvidence);assert.doesNotMatch(JSON.stringify([received,events]),/SECRET_QUERY|SECRET_HASH|SECRET_HEADER|SECRET_BODY|FORGED_DIRECT_EVIDENCE|user:secret/);
});
test('runtime attachments reject missing resolver, invalid selection, stale sessions and malformed observations before contacting a provider',async t=>{
 const descriptor={session:'runtime-1',observationIds:['request-1']};let requests=0;
 for(const [runtimeContext,resolver] of [[descriptor,undefined],[{...descriptor,observationIds:['request-1','request-1']},async()=>[observation]],[{...descriptor,observationIds:Array.from({length:13},(_,i)=>String(i))},async()=>[]],[descriptor,async()=>[{...observation,session:'other'}]],[descriptor,async()=>[]],[descriptor,async()=>[{...observation,correlation:'confirmed'}]],[descriptor,async()=>{throw new Error('SECRET_RESOLVER_ERROR');}]]){
  const {ask}=await harness(t,'openai',(_req,res)=>{requests++;res.end();},{resolveRuntimeEvidence:resolver});const response=await ask({...question,runtimeContext});assert.ok([400,409].includes(response.status));const result=await response.json();assert.match(result.code,/runtime-context/);assert.doesNotMatch(JSON.stringify(result),/SECRET_RESOLVER_ERROR/);
 }
 assert.equal(requests,0);
});
test('unknown provider kinds and blank model names stay disconnected',()=>{
 for(const config of [{providerKind:'unsupported',model:'m'},{providerKind:'anthropic',model:' '}])assert.equal(createAssistantService({projectService,config:{baseUrl:'https://api.example/v1',apiKey:'k',...config}}).status().configured,false);
});

test('runtime evidence resolution cannot race a selected source revision change',async t=>{
 let changed=false,requests=0;
 const {ask}=await harness(t,'openai',(_req,res)=>{requests++;res.end();},{projectService:{async getFile(){return {...source,revision:changed?'changed-r2':source.revision};}},resolveRuntimeEvidence:async()=>{changed=true;return [observation];}});
 const response=await ask({...question,runtimeContext:{session:'runtime-1',observationIds:['request-1']}});
 assert.equal(response.status,409);assert.equal((await response.json()).code,'stale-context');assert.equal(requests,0);
});

for(const [kind,protocol] of Object.entries(protocols)){
 test(`${kind} ignores events after its terminal marker and accepts a terminal frame at EOF`,async t=>{
  for(const suffix of ['late-events','eof']){
   const {ask}=await harness(t,kind,async(req,res)=>{await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text('Complete answer')+(suffix==='eof'?protocol.finish().trimEnd():protocol.finish()+protocol.text('LATE_INJECTION')+protocol.tool()));});
   const events=await readEvents(await ask());assert.equal(events.filter(event=>event.type==='done').length,1);assert.equal(events.at(-1).type,'done');assert.equal(events.filter(event=>event.type==='delta').map(event=>event.text).join(''),'Complete answer');assert.doesNotMatch(JSON.stringify(events),/LATE_INJECTION|SECRET_TOOL_PAYLOAD/);
  }
 });
 test(`${kind} rejects malformed known text events while preserving partial output`,async t=>{
  const malformed=kind==='openai'?{type:'response.output_text.delta',delta:17}:{type:'content_block_delta',delta:{type:'text_delta',text:17}};
  const {ask}=await harness(t,kind,async(req,res)=>{await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text('Partial answer')+frame(malformed)+protocol.finish());});
  const events=await readEvents(await ask());assert.equal(events.at(-1).code,'invalid-provider-stream');assert.equal(events.some(event=>event.type==='done'),false);assert.equal(events.find(event=>event.type==='delta').text,'Partial answer');
 });
 test(`${kind} refuses redirects rather than forwarding provider credentials or source`,async t=>{
  let redirectedRequests=0;
  const target=await listen(t,createServer((_req,res)=>{redirectedRequests++;res.end();}));
  const {ask}=await harness(t,kind,async(req,res)=>{await readBody(req);res.writeHead(307,{Location:`${target}/PRIVATE_REDIRECT_TARGET`});res.end('TEST_KEY_NEVER_ECHO');});
  const events=await readEvents(await ask());assert.equal(redirectedRequests,0);assert.equal(events.at(-1).type,'error');assert.doesNotMatch(JSON.stringify(events),/PRIVATE_REDIRECT_TARGET|TEST_KEY_NEVER_ECHO/);
 });
}
test('Anthropic rejects server and MCP tool blocks without executing or exposing them',async t=>{
 for(const type of ['server_tool_use','mcp_tool_use','web_search_tool_result']){
  const protocol=protocols.anthropic;
  const {ask}=await harness(t,'anthropic',async(req,res)=>{await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text('Partial')+frame({type:'content_block_start',content_block:{type,input:'SECRET_TOOL_PAYLOAD'}})+protocol.finish());});
  const events=await readEvents(await ask());assert.equal(events.at(-1).code,'provider-tools-unsupported');assert.equal(events.some(event=>event.type==='done'),false);assert.doesNotMatch(JSON.stringify(events),/SECRET_TOOL_PAYLOAD/);
 }
});

const taskProtocols={...protocols,compatible:{
 start:()=>frame({model:'reported-compatible',choices:[]}),
 text:text=>frame({choices:[{delta:{content:text}}]}),
 finish:()=>frame({choices:[{delta:{},finish_reason:'stop'}]})+'data: [DONE]\n\n',
}};
const taskContext=()=>({version:1,featureId:'feature-profile',title:'Save profile',brief:'Clarify the Save button loading and error states.',revision:4});
const invalidTasks=[null,[],{}, {...taskContext(),version:2},{...taskContext(),featureId:'../escape'}, {...taskContext(),featureId:'x'.repeat(129)}, {...taskContext(),title:' '}, {...taskContext(),title:'x'.repeat(81)}, {...taskContext(),brief:'x'.repeat(2001)}, {...taskContext(),brief:null}, {...taskContext(),revision:-1}, {...taskContext(),revision:0.5}, {...taskContext(),revision:Number.MAX_SAFE_INTEGER+1}];
test('task context normalization accepts exact bounds and empty briefs, strips extras and rejects invalid versions',()=>{
 assert.equal(normalizeTaskContext(undefined),undefined);
 const original={...taskContext(),title:'  Save profile  ',tools:['shell'],files:['private.env'],runtimeEvidence:[{body:'secret'}]};
 const result=normalizeTaskContext(original);assert.deepEqual(result,taskContext());original.title='Caller changed';assert.equal(result.title,'Save profile');
 assert.deepEqual(normalizeTaskContext({...taskContext(),title:'x'.repeat(80),brief:'',revision:0}),{...taskContext(),title:'x'.repeat(80),brief:'',revision:0});
 assert.equal(normalizeTaskContext({...taskContext(),brief:'x'.repeat(2000),revision:Number.MAX_SAFE_INTEGER}).brief.length,2000);
 for(const value of invalidTasks)assert.throws(()=>normalizeTaskContext(value),{status:400,code:'invalid-task-context'});
});
for(const [kind,protocol] of Object.entries(taskProtocols)){
 test(`${kind} shares a normalized feature task snapshot without adding source, runtime or conversation history`,async t=>{
  const received=[];
  const {ask}=await harness(t,kind,async(req,res)=>{received.push(await readBody(req));res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text('Task-guided answer')+protocol.finish());});
  const events=await readEvents(await ask({...question,taskContext:{...taskContext(),title:'  Save profile  ',tools:['SECRET_TOOL'],files:['UNSELECTED_FILE'],history:['PRIOR_TURN'],apiKey:'TASK_SECRET'},history:['FORGED_HISTORY']}));
  const input=kind==='openai'?JSON.parse(received[0].input[0].content[0].text):JSON.parse(received[0].messages.at(-1).content);
  const system=kind==='openai'?received[0].instructions:kind==='anthropic'?received[0].system:received[0].messages[0].content;
  assert.deepEqual(input.taskContext,taskContext());assert.deepEqual(events[0].taskContext,taskContext());assert.equal(events.at(-1).type,'done');
  assert.equal(input.question,question.prompt);assert.equal(input.sources.length,1);assert.equal(input.runtimeEvidence,undefined);assert.equal(input.history,undefined);
  assert.match(system,/current question is authoritative/);assert.match(system,/no additional source access, tools, or verification authority/);
  assert.doesNotMatch(JSON.stringify([received,events]),/SECRET_TOOL|UNSELECTED_FILE|PRIOR_TURN|TASK_SECRET|FORGED_HISTORY/);
  const absent=await readEvents(await ask());const legacyInput=kind==='openai'?JSON.parse(received[1].input[0].content[0].text):JSON.parse(received[1].messages.at(-1).content);
  assert.equal(legacyInput.taskContext,undefined);assert.equal(absent[0].taskContext,undefined);assert.equal(absent.at(-1).type,'done');
 });
 test(`${kind} rejects malformed task context before reading source or contacting the provider`,async t=>{
  let requests=0,reads=0;
  const {ask}=await harness(t,kind,(_req,res)=>{requests++;res.end();},{projectService:{getFile(){reads++;throw new Error('Source must not be read for invalid task context');}}});
  for(const value of invalidTasks){const response=await ask({...question,taskContext:value});assert.equal(response.status,400);assert.equal((await response.json()).code,'invalid-task-context');}
  assert.equal(requests,0);assert.equal(reads,0);
 });
 test(`${kind} change proposals receive task guidance while retaining one-file authority`,async t=>{
  let received;
  const change=JSON.stringify({title:'Clearer label',summary:'One selected file.',edits:[{path:source.path,find:'>Save</button>',replace:'>Save changes</button>'}],verification:['Inspect the label.']});
  const {ask}=await harness(t,kind,async(req,res)=>{received=await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(change)+protocol.finish());});
  const events=await readEvents(await ask({...question,intent:'change',taskContext:taskContext()}));
  const system=kind==='openai'?received.instructions:kind==='anthropic'?received.system:received.messages[0].content;
  assert.match(system,/current question is authoritative/);assert.match(system,/ONE existing file/);
  assert.equal(events.find(event=>event.type==='proposal').proposal.path,source.path);assert.equal(events.at(-1).type,'done');
 });
}

const structuredPlan=()=>({title:'Improve save',summary:'Clarify the selected button.',steps:[{title:'Improve feedback',detail:'Consider loading feedback for the selected button.',references:[{sourceId:'S1',line:1}]}],risks:['Runtime behavior is unknown.'],verification:['Inspect named loading and error states.']});
const structuredReview=()=>({title:'Review save',summary:'Selected source review.',findings:[{severity:'low',title:'Fixed label',detail:'The supplied button has a fixed label.',references:[{sourceId:'S1',line:1}]}],limitations:['Runtime and test outcomes are unknown.']});
const structuredBuild=()=>({title:'Clearer label',summary:'Selected button only.',edits:[{path:source.path,find:'>Save</button>',replace:'>Save changes</button>'}],verification:['Inspect the updated label.']});
const selectedPlanContext=()=>({version:1,conversationId:'conversation-1',requestId:'plan-request-1',artifactId:'25b85cde-fd25-49d9-92c8-900d957cf0a8',revision:2,stepId:'e251f24a-1795-4a01-85c1-9c85b43d7373',title:'Improve save',summary:'Selected button scope.',step:{title:'Improve feedback',detail:'Clarify the saved button label.',references:[{sourceId:'S1',path:source.path,revision:source.revision,line:1,endLine:1}]},verification:['Inspect the resulting label.']});
const inputFor=(kind,payload)=>JSON.parse(kind==='openai'?payload.input[0].content[0].text:kind==='anthropic'?payload.messages[0].content:payload.messages[1].content);
const systemFor=(kind,payload)=>kind==='openai'?payload.instructions:kind==='anthropic'?payload.system:payload.messages[0].content;
for(const[kind,protocol]of Object.entries(taskProtocols)){
 test(`${kind} keeps Ask, Plan, Build and Review distinct while mapping legacy change to Build`,async t=>{
  for(const intent of ['ask','plan','build','review','change']){
   let payload;const raw=intent==='ask'?'Source answer [S1:1]':JSON.stringify(intent==='plan'?structuredPlan():intent==='review'?structuredReview():structuredBuild());
   const{ask}=await harness(t,kind,async(req,res)=>{payload=await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(raw)+protocol.finish());});
   const result=await readEvents(await ask({...question,intent})), canonical=intent==='change'?'build':intent;
   assert.equal(result[0].intent,canonical);assert.equal(inputFor(kind,payload).intent,canonical);assert.equal(payload.tools,undefined);assert.equal(result.at(-1).type,'done');
   const artifacts=result.filter(event=>['plan','proposal','review'].includes(event.type));assert.equal(artifacts.length,canonical==='ask'?0:1);
   if(canonical!=='ask'){const event=artifacts[0],type=canonical==='build'?'proposal':canonical;assert.equal(event.type,type);assert.equal(result.at(-2),event);if(canonical!=='build'){assert.equal(event[type].verificationStatus,'not-run');assert.equal(event[type].context[0].path,source.path);}}
   assert.match(systemFor(kind,payload),/untrusted/i);assert.equal(source.source,'export const Button = () => <button>Save</button>;\n');
  }
 });
 test(`${kind} rejects mismatched, malformed, unselected, and claimed-verified Plan/Review output without an artifact`,async t=>{
  for(const[intent,value]of [['plan',structuredReview()],['review',structuredPlan()],['plan',{...structuredPlan(),verificationStatus:'passed'}],['review',{...structuredReview(),findings:[{...structuredReview().findings[0],references:[{sourceId:'S2',line:1}]}]}],['plan','invalid-json']]){
   const raw=typeof value==='string'?value:JSON.stringify(value);const{ask}=await harness(t,kind,async(req,res)=>{await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(raw)+protocol.finish());});
   const result=await readEvents(await ask({...question,intent}));assert.equal(result.some(e=>['plan','review','proposal','done'].includes(e.type)),false);assert.equal(result.at(-1).code,'invalid-assistant-artifact');assert.equal(result.find(e=>e.type==='delta').text,raw);
  }
 });
 test(`${kind} source changes during generation retire every structured result`,async t=>{
  for(const intent of ['plan','build','review']){
   let changed=false;const value=intent==='plan'?structuredPlan():intent==='review'?structuredReview():structuredBuild();
   const{ask}=await harness(t,kind,async(req,res)=>{await readBody(req);changed=true;res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(JSON.stringify(value))+protocol.finish());},{projectService:{async getFile(){return {...source,revision:changed?'changed':source.revision};}}});
   const result=await readEvents(await ask({...question,intent}));assert.equal(result.at(-1).code,'stale-context');assert.equal(result.some(e=>['plan','review','proposal','done'].includes(e.type)),false);
  }
 });
 test(`${kind} Build receives only the immutable selected step and cannot gain tools or extra source`,async t=>{
  let payload;const{ask}=await harness(t,kind,async(req,res)=>{payload=await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(JSON.stringify(structuredBuild()))+protocol.finish());});
  const result=await readEvents(await ask({...question,intent:'build',planContext:selectedPlanContext(),otherSteps:['PRIVATE_OTHER_STEP'],history:['PRIVATE_HISTORY']}));
  assert.deepEqual(inputFor(kind,payload).planContext,selectedPlanContext());assert.deepEqual(result[0].planContext,selectedPlanContext());assert.match(systemFor(kind,payload),/current question is authoritative/i);assert.match(systemFor(kind,payload),/do not execute the rest of the plan/i);
  assert.doesNotMatch(JSON.stringify(payload),/PRIVATE_OTHER_STEP|PRIVATE_HISTORY/);assert.equal(payload.tools,undefined);assert.equal(result.at(-2).type,'proposal');
 });
 test(`${kind} rejects wrong-mode, malformed or stale selected plan context before contacting provider`,async t=>{
  let calls=0;const{ask}=await harness(t,kind,(_req,res)=>{calls++;res.end();});
  for(const[intent,planContext]of [['ask',selectedPlanContext()],['plan',selectedPlanContext()],['review',selectedPlanContext()],['build',null],['build',{...selectedPlanContext(),tools:['shell']}],['build',{...selectedPlanContext(),revision:-1}],['build',{...selectedPlanContext(),step:{...selectedPlanContext().step,references:[{...selectedPlanContext().step.references[0],revision:'other'}]}}]]){
   const response=await ask({...question,intent,planContext});assert.equal(response.status,400);assert.equal((await response.json()).code,'invalid-plan-context');
  }
  assert.equal(calls,0);
 });
 test(`${kind} incomplete and tool streams cannot turn complete JSON into Plan/Review artifacts`,async t=>{
  for(const intent of ['plan','review'])for(const ending of ['',kind==='compatible'?frame({choices:[{delta:{},finish_reason:'length'}]})+'data: [DONE]\n\n':protocol.incomplete(),kind==='compatible'?frame({choices:[{delta:{tool_calls:[{function:{name:'PRIVATE_TOOL'}}]}}]}):protocol.tool()]){
   const{ask}=await harness(t,kind,async(req,res)=>{await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(JSON.stringify(intent==='plan'?structuredPlan():structuredReview()))+ending);});
   const result=await readEvents(await ask({...question,intent}));assert.equal(result.at(-1).type,'error');assert.equal(result.some(e=>['plan','review','proposal','done'].includes(e.type)),false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TOOL|SECRET_TOOL_PAYLOAD/);
  }
 });
}
for(const kind of ['openai','compatible'])test(`${kind} a refusal marker cannot publish structured artifacts even if its text resembles valid JSON`,async t=>{
 const protocol=taskProtocols[kind];
 for(const intent of ['plan','build','review']){
  const text=JSON.stringify(intent==='plan'?structuredPlan():intent==='review'?structuredReview():structuredBuild());
  const refusal=kind==='openai'?frame({type:'response.refusal.delta',delta:text}):frame({choices:[{delta:{refusal:text}}]});
  const{ask}=await harness(t,kind,async(req,res)=>{await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+refusal+protocol.finish());});
  const result=await readEvents(await ask({...question,intent}));assert.equal(result.at(-1).type,'error');assert.equal(result.some(e=>['plan','review','proposal','done'].includes(e.type)),false);
 }
});
for(const[kind,protocol]of Object.entries(taskProtocols))test(`${kind} cancelling complete-looking structured JSON cannot emit any artifact or completion`,async t=>{
 const{EventEmitter}=await import('node:events');
 for(const intent of ['plan','build','review']){
  let close;const closed=new Promise(resolve=>close=resolve), value=intent==='plan'?structuredPlan():intent==='review'?structuredReview():structuredBuild();
  const endpoint=await listen(t,createServer(async(req,res)=>{await readBody(req);res.on('close',close);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(protocol.start()+protocol.text(JSON.stringify(value)));}));
  const service=createAssistantService({projectService,config:{providerKind:kind,baseUrl:endpoint,model:'fixture-model',timeoutMs:2000}});
  const request={method:'POST',aborted:false},response=new EventEmitter(),events=[];
  Object.assign(response,{destroyed:false,writableEnded:false,writeHead(){},write(line){const event=JSON.parse(line);events.push(event);if(event.type==='delta'){request.aborted=true;this.destroyed=true;this.emit('close');}},end(){this.writableEnded=true;}});
  await service.handle({request,response,url:'/api/assistant/ask',body:{...question,intent}});await closed;
  assert.equal(events.some(event=>event.type==='delta'),true);assert.equal(events.some(event=>['plan','review','proposal','done'].includes(event.type)),false);
 }
});
test('OpenAI terminal refusal metadata cannot promote ordinary-looking JSON deltas into structured work',async t=>{
 const protocol=taskProtocols.openai;
 const{ask}=await harness(t,'openai',async(req,res)=>{await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(JSON.stringify(structuredPlan()))+frame({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'Refused'}]}]}}));});
 const result=await readEvents(await ask({...question,intent:'plan'}));assert.equal(result.at(-1).code,'incomplete-artifact');assert.equal(result.some(e=>e.type==='plan'||e.type==='done'),false);
});
for(const[kind,protocol]of Object.entries(taskProtocols))test(`${kind} empty Review findings remain explicitly unverified`,async t=>{
 const{ask}=await harness(t,kind,async(req,res)=>{await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(JSON.stringify({...structuredReview(),findings:[]}))+protocol.finish());});
 const result=await readEvents(await ask({...question,intent:'review'})),review=result.find(event=>event.type==='review').review;
 assert.deepEqual(review.findings,[]);assert.equal(review.verificationStatus,'not-run');assert.equal(result.at(-1).type,'done');
});

const groupSources=[source,{path:'src/label.ts',revision:'label-r1',source:'export const label = "Save";\n'},{path:'src/consumer.ts',revision:'consumer-r1',source:'export const consumer = true;\n'}].map(file=>({...file,revision:createHash('sha256').update(file.source).digest('hex').slice(0,16)}));
const groupBody={...question,intent:'build',changeSets:true,context:groupSources.map(({path,revision})=>({path,revision}))};
const groupBuild=()=>({...structuredBuild(),summary:'Update the two selected labels.',edits:[...structuredBuild().edits,{path:groupSources[1].path,find:'"Save"',replace:'"Save changes"'}]});
const groupService={async getFile(_project,path){return groupSources.find(file=>file.path===path);}};
for(const[kind,protocol]of Object.entries(taskProtocols)){
 test(`${kind} publishes only explicitly opted-in multi-file Build and retains every disclosed snapshot`,async t=>{
  let payload;const{ask}=await harness(t,kind,async(req,res)=>{payload=await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(JSON.stringify(groupBuild()))+protocol.finish());},{projectService:groupService});
  const result=await readEvents(await ask(groupBody)),group=result.find(e=>e.type==='changeSet')?.changeSet;
  assert.ok(group);assert.equal(result.at(-1).type,'done');assert.equal(result.some(e=>e.type==='proposal'),false);assert.equal(group.files.length,2);assert.equal(group.context.length,3);
  assert.deepEqual(group.context,groupBody.context);assert.equal(group.verificationStatus,'not-run');assert.equal(group.revision,0);assert.match(systemFor(kind,payload),/24 non-overlapping edits TOTAL/);assert.equal(payload.tools,undefined);assert.equal(inputFor(kind,payload).sources.length,3);
  for(const changeSets of [undefined,false,'true']){const old=await readEvents(await ask({...groupBody,changeSets}));assert.equal(old.at(-1).type,'error');assert.equal(old.some(e=>['changeSet','proposal','done'].includes(e.type)),false);assert.match(systemFor(kind,payload),/ONE existing file/);}
  const planned=await readEvents(await ask({...groupBody,planContext:{...selectedPlanContext(),step:{...selectedPlanContext().step,references:selectedPlanContext().step.references.map(ref=>({...ref,revision:groupSources[0].revision}))}}}));assert.equal(planned.at(-1).type,'error');assert.equal(planned.some(e=>e.type==='changeSet'),false);assert.match(systemFor(kind,payload),/ONE existing file/);
 });
 test(`${kind} rejects incomplete, malformed, tools, and invalid group members without a partial artifact`,async t=>{
  const incomplete=kind==='compatible'?frame({choices:[{delta:{},finish_reason:'length'}]})+'data: [DONE]\n\n':protocol.incomplete();
  const tool=kind==='compatible'?frame({choices:[{delta:{tool_calls:[{function:{name:'PRIVATE_TOOL'}}]}}]}):protocol.tool();
  for(const [raw,ending] of [[JSON.stringify(groupBuild()),''],[JSON.stringify(groupBuild()),incomplete],[JSON.stringify(groupBuild()),tool],['{incomplete',protocol.finish()],[JSON.stringify({...groupBuild(),edits:[groupBuild().edits[0],{...groupBuild().edits[1],find:'missing'}]}),protocol.finish()]]){
   const{ask}=await harness(t,kind,async(req,res)=>{await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(raw)+ending);},{projectService:groupService});
   const result=await readEvents(await ask(groupBody));assert.equal(result.at(-1).type,'error');assert.equal(result.some(e=>['changeSet','proposal','done'].includes(e.type)),false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TOOL|SECRET_TOOL_PAYLOAD|TEST_KEY_NEVER_ECHO/);
  }
 });
 test(`${kind} revalidates an unchanged disclosed dependency before publishing a change set`,async t=>{
  let changed=false;const{ask}=await harness(t,kind,async(req,res)=>{await readBody(req);changed=true;res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(JSON.stringify(groupBuild()))+protocol.finish());},{projectService:{async getFile(_project,path){const value=await groupService.getFile(_project,path);return changed&&path===groupSources[2].path?{...value,revision:'changed'}:value;}}});
  const result=await readEvents(await ask(groupBody));assert.equal(result.at(-1).code,'stale-context');assert.equal(result.some(e=>['changeSet','proposal','done'].includes(e.type)),false);
 });
 test(`${kind} cancellation after complete-looking multi-file JSON closes upstream without publishing changes`,async t=>{
  const{EventEmitter}=await import('node:events');let close;const closed=new Promise(resolve=>close=resolve);
  const endpoint=await listen(t,createServer(async(req,res)=>{await readBody(req);res.on('close',close);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(protocol.start()+protocol.text(JSON.stringify(groupBuild())));}));
  const service=createAssistantService({projectService:groupService,config:{providerKind:kind,baseUrl:endpoint,model:'fixture-model',timeoutMs:2000}}),request={method:'POST',aborted:false},response=new EventEmitter(),events=[];
  Object.assign(response,{destroyed:false,writableEnded:false,writeHead(){},write(line){const event=JSON.parse(line);events.push(event);if(event.type==='delta'){request.aborted=true;this.destroyed=true;this.emit('close');}},end(){this.writableEnded=true;}});
  await service.handle({request,response,url:'/api/assistant/ask',body:groupBody});await closed;assert.ok(events.some(e=>e.type==='delta'));assert.equal(events.some(e=>['changeSet','proposal','done'].includes(e.type)),false);
 });
}
for(const kind of ['openai','compatible'])test(`${kind} refuses a complete-looking change set carried in refusal text`,async t=>{
 const protocol=taskProtocols[kind],raw=JSON.stringify(groupBuild()),refusal=kind==='openai'?frame({type:'response.refusal.delta',delta:raw}):frame({choices:[{delta:{refusal:raw}}]});
 const{ask}=await harness(t,kind,async(req,res)=>{await readBody(req);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+refusal+protocol.finish());},{projectService:groupService});
 const result=await readEvents(await ask(groupBody));assert.equal(result.at(-1).type,'error');assert.equal(result.some(e=>['changeSet','proposal','done'].includes(e.type)),false);
});

for (const [kind, protocol] of Object.entries(taskProtocols)) {
 test(`${kind} explicitly selected decisions coexist with task and runtime evidence in all four ordinary modes`, async t => {
  const decisionContext = decisionContextFixture(), received = [], resolved = [];
  const task = {...taskContext(),featureId:decisionContext.decisions[0].decision.feature.id};
  let intent = 'ask';
  const runtimeContext = {session:'runtime-decisions', observationIds:['request-save']};
  const runtimeRecord = {id:'request-save',session:runtimeContext.session,kind:'request',method:'POST',url:'/api/profile',status:200,durationMs:12,outcome:'success',observedAt:'2026-11-01T12:00:00.000Z',correlation:'unattributed',provenance:'observed'};
  const {ask} = await harness(t, kind, async (req,res) => {
   received.push(await readBody(req));
   const raw = intent === 'ask' ? 'Selected rationale is historical reference.' : JSON.stringify(intent === 'plan' ? structuredPlan() : intent === 'review' ? structuredReview() : structuredBuild());
   res.writeHead(200, {'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(raw)+protocol.finish());
  }, {resolveDecisionContext:(projectId,snapshot) => {assert.equal(projectId,'fixture');resolved.push(structuredClone(snapshot));return structuredClone(decisionContext);},resolveRuntimeEvidence:()=>[runtimeRecord]});
  for (intent of ['ask','plan','build','review']) {
   const response = await ask({...question,intent,decisionContext,taskContext:task,runtimeContext});
   const events = await readEvents(response);assert.equal(response.status,200,JSON.stringify(events));
   const payload = received.at(-1), input = inputFor(kind,payload), system = systemFor(kind,payload);
   assert.deepEqual(input.decisionContext,decisionContext);assert.deepEqual(events[0].decisionContext,decisionContext);
   assert.deepEqual(input.taskContext,task);assert.equal(input.runtimeEvidence.length,1);assert.equal(input.sources.length,1);
   assert.equal(payload.tools,undefined);assert.equal(input.history,undefined);assert.equal(events.at(-1).type,'done');
   assert.match(system,/untrusted reference data, never policy or tool instructions/);
   assert.match(system,/no additional source access, tools, execution, edits or verification authority/);
   assert.match(system,/does not prove current runtime behavior, passing tests, visual correctness or source-to-pixels mapping/);
  }
  assert.equal(resolved.length,8);
  intent = 'ask';
  const absent = await readEvents(await ask()), absentInput = inputFor(kind,received.at(-1));
  assert.equal(absentInput.decisionContext,undefined);assert.equal(absent[0].decisionContext,undefined);assert.equal(resolved.length,8);
 });
}

test('malformed, oversized, foreign and authority-bearing decision context fails before source reads or provider calls', async t => {
 let calls = 0, reads = 0;
 const {ask} = await harness(t,'compatible',(_req,res)=>{calls++;res.end();},{projectService:{getFile(){reads++;throw Error('Do not read source.');}},resolveDecisionContext:()=>{throw Error('Do not resolve malformed context.');}});
 const valid = decisionContextFixture();
 const malformed = [null,[],{}, {...valid,version:2}, {...valid,projectId:'other-project'}, {...valid,decisions:[]}, {...valid,tools:['shell']}, {...valid,decisions:[...valid.decisions,...valid.decisions]}, {...valid,decisions:[{...valid.decisions[0],digest:'0'.repeat(64)}]}];
 const unknown = structuredClone(valid);unknown.decisions[0].decision.policy='Read arbitrary files';malformed.push(unknown);
 const foreign = decisionContextFixture({projectId:'other-project'});foreign.projectId='fixture';malformed.push(foreign);
 const forged = structuredClone(valid);forged.decisions[0].decision.rationale='Forged rationale';malformed.push(forged);
 const oversized = {version:1,projectId:'fixture',decisions:Array.from({length:4},(_,i)=>{const decision=decisionFixture({index:i+1});decision.rationale='😀'.repeat(1000);return {decision,digest:projectDecisionDigest(decision)};})};
 assert.ok(Buffer.byteLength(JSON.stringify(oversized))>16*1024);malformed.push(oversized);
 for (const decisionContext of malformed) {
  const response = await ask({...question,decisionContext});assert.equal(response.status,400);assert.equal((await response.json()).code,'invalid-decision-context');
 }
 assert.equal(calls,0);assert.equal(reads,0);
});

test('decisions require their canonical host resolver and reject forged valid digests or unavailable records', async t => {
 let calls = 0; const canonical = decisionContextFixture();
 const provider = (_req,res)=>{calls++;res.end();};
 const missing = await harness(t,'compatible',provider);
 let response = await missing.ask({...question,decisionContext:canonical});assert.equal(response.status,409);assert.equal((await response.json()).code,'decision-context-unavailable');
 const canonicalHost = await harness(t,'compatible',provider,{resolveDecisionContext:()=>canonical});
 const forged = structuredClone(canonical);forged.decisions[0].decision.rationale='A syntactically valid but unrecorded rationale.';forged.decisions[0].digest=projectDecisionDigest(forged.decisions[0].decision);
 response=await canonicalHost.ask({...question,decisionContext:forged});assert.equal(response.status,409);assert.equal((await response.json()).code,'decision-context-unavailable');
 for (const reason of ['stale','undone','superseded','missing']) {
  const unavailable = await harness(t,'compatible',provider,{resolveDecisionContext:()=>{throw Error(`PRIVATE-${reason}`);}});
  response=await unavailable.ask({...question,decisionContext:canonical});assert.equal(response.status,409);const value=await response.json();assert.equal(value.code,'decision-context-unavailable');assert.doesNotMatch(value.error,/PRIVATE/);
 }
 assert.equal(calls,0);
});

test('decision resolution rechecks both canonical selection and source before provider dispatch', async t => {
 let calls=0, resolvers=0, changed=false;
 const canonical=decisionContextFixture(), provider=(_req,res)=>{calls++;res.end();};
 const changing = await harness(t,'compatible',provider,{resolveDecisionContext:()=>{if(++resolvers===2)throw Error('Decision was undone during preparation.');return canonical;}});
 let response=await changing.ask({...question,decisionContext:canonical});assert.equal(response.status,409);assert.equal((await response.json()).code,'decision-context-unavailable');assert.equal(resolvers,2);
 const sourceRace = await harness(t,'compatible',provider,{resolveDecisionContext:()=>{changed=true;return canonical;},projectService:{getFile(){return changed?{...source,revision:'changed'}:source;}}});
 response=await sourceRace.ask({...question,decisionContext:canonical});assert.equal(response.status,409);assert.equal((await response.json()).code,'stale-context');assert.equal(calls,0);
});

test('decision context cannot add rationale to specialized handoffs', async t => {
 let calls=0, reads=0;
 const {ask}=await harness(t,'compatible',(_req,res)=>{calls++;res.end();},{projectService:{getFile(){reads++;throw Error('Do not read source.');}},resolveDecisionContext:()=>decisionContextFixture()});
 for (const key of ['planContext','requestRevision','groupRevision','checkContext','sourceInvestigation','investigationContinuation','investigationContext']) {
  const response=await ask({...question,intent:'plan',decisionContext:decisionContextFixture(),[key]:{}});assert.equal(response.status,400);await response.arrayBuffer();
 }
 assert.equal(calls,0);assert.equal(reads,0);
});


for (const [kind, protocol] of Object.entries(taskProtocols)) {
 test(`${kind} explicitly shared historical issues retain their assessment in all ordinary modes`, async t => {
  const issueContext = reproducibleIssueContextFixture({projectId:'fixture'}), decisionContext = decisionContextFixture(), received = [], resolved = [];
  issueContext.issues[0].assessment.source='stale';issueContext.issues[0].assessment.captureSource='missing';
  issueContext.issues[0].assessment.run='missing';issueContext.issues[0].assessment.replay='missing';issueContext.issues[0].assessment.capture='missing';
  let intent='ask';
  const {ask} = await harness(t,kind,async(req,res)=>{
   received.push(await readBody(req));const raw=intent==='ask'?'This is the reported historical failure.':JSON.stringify(intent==='plan'?structuredPlan():intent==='review'?structuredReview():structuredBuild());
   res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(raw)+protocol.finish());
  },{resolveIssueContext:(projectId,snapshot)=>{assert.equal(projectId,'fixture');resolved.push(structuredClone(snapshot));return structuredClone(issueContext);},resolveDecisionContext:()=>structuredClone(decisionContext)});
  for(intent of ['ask','plan','build','review']) {
   const response=await ask({...question,intent,issueContext,decisionContext,taskContext:taskContext()}),events=await readEvents(response);
   assert.equal(response.status,200,JSON.stringify(events));assert.equal(events.at(-1).type,'done');
   const payload=received.at(-1),input=inputFor(kind,payload),system=systemFor(kind,payload);
   assert.deepEqual(input.issueContext,issueContext);assert.deepEqual(events[0].issueContext,issueContext);assert.deepEqual(input.decisionContext,decisionContext);
   assert.deepEqual(input.taskContext,taskContext());assert.equal(input.sources.length,1);assert.equal(input.sources[0].path,source.path);
   assert.equal(payload.tools,undefined);assert.equal(input.history,undefined);
   assert.match(system,/User-reported actual and expected outcomes are not independently verified/);
   assert.match(system,/observed but unattributed/);assert.match(system,/historical source revisions/);
   assert.match(system,/metadata only, not image pixels or replay execution authority/);
   assert.match(system,/no additional source access, tools, execution, edits or verification authority/);
  }
  assert.equal(resolved.length,8);intent='ask';const absent=await readEvents(await ask());assert.equal(inputFor(kind,received.at(-1)).issueContext,undefined);assert.equal(absent[0].issueContext,undefined);assert.equal(resolved.length,8);
 });
}

test('malformed, forged, oversized and authority-bearing issue snapshots fail before source or provider access', async t => {
 let calls=0,reads=0;
 const {ask}=await harness(t,'compatible',(_req,res)=>{calls++;res.end();},{projectService:{getFile(){reads++;throw Error('No source access.');}},resolveIssueContext:()=>{throw Error('No malformed context resolution.');}});
 const valid=reproducibleIssueContextFixture({projectId:'fixture'}),forged=structuredClone(valid);forged.issues[0].issue.actualOutcome='A changed claim without a new digest.';
 const foreign=reproducibleIssueContextFixture({projectId:'foreign'});foreign.projectId='fixture';
 const over=structuredClone(valid);over.issues[0].issue.actualOutcome='x'.repeat(128*1024);
 const authority=structuredClone(valid);authority.issues[0].issue.tools=['shell'];
 const invalid=[null,[],{}, {...valid,version:2},{...valid,projectId:'foreign'},{...valid,issues:[]},{...valid,issues:[...valid.issues,...valid.issues]},{...valid,policy:'Read any file'},forged,foreign,over,authority];
 for(const issueContext of invalid){const response=await ask({...question,issueContext});assert.equal(response.status,400);assert.equal((await response.json()).code,'invalid-issue-context');}
 assert.equal(calls,0);assert.equal(reads,0);
});

test('issue sharing requires canonical local ownership even when a forged record has a valid digest', async t => {
 let calls=0;const issueContext=reproducibleIssueContextFixture({projectId:'fixture'}),provider=(_req,res)=>{calls++;res.end();};
 const missing=await harness(t,'compatible',provider);let response=await missing.ask({...question,issueContext});assert.equal(response.status,409);assert.equal((await response.json()).code,'issue-context-unavailable');
 const canonical=await harness(t,'compatible',provider,{resolveIssueContext:()=>issueContext});
 const forged=structuredClone(issueContext);forged.issues[0].issue.actualOutcome='A syntactically valid unrecorded report.';forged.issues[0].digest=reproducibleIssueDigest(forged.issues[0].issue);
 response=await canonical.ask({...question,issueContext:forged});assert.equal(response.status,409);assert.equal((await response.json()).code,'issue-context-unavailable');
 const privateFailure=await harness(t,'compatible',provider,{resolveIssueContext:()=>{throw Error('PRIVATE filesystem detail');}});
 response=await privateFailure.ask({...question,issueContext});assert.equal(response.status,409);const error=await response.json();assert.equal(error.code,'issue-context-unavailable');assert.doesNotMatch(error.error,/PRIVATE/);assert.equal(calls,0);
});

test('issue context and sharing-time assessment revalidate around selected source before dispatch', async t => {
 let calls=0,resolves=0,changed=false;const issueContext=reproducibleIssueContextFixture({projectId:'fixture'}),provider=(_req,res)=>{calls++;res.end();};
 const raced=await harness(t,'compatible',provider,{resolveIssueContext:()=>{resolves++;const value=structuredClone(issueContext);if(resolves===2)value.issues[0].assessment.source='stale';return value;}});
 let response=await raced.ask({...question,issueContext});assert.equal(response.status,409);assert.equal((await response.json()).code,'issue-context-unavailable');assert.equal(resolves,2);
 const sourceRace=await harness(t,'compatible',provider,{resolveIssueContext:()=>{changed=true;return issueContext;},projectService:{getFile(){return changed?{...source,revision:'changed'}:source;}}});
 response=await sourceRace.ask({...question,issueContext});assert.equal(response.status,409);assert.equal((await response.json()).code,'stale-context');assert.equal(calls,0);
});

test('issue metadata cannot add authority or history to specialized handoffs', async t => {
 let calls=0,reads=0;const issueContext=reproducibleIssueContextFixture({projectId:'fixture'});
 const {ask}=await harness(t,'compatible',(_req,res)=>{calls++;res.end();},{resolveIssueContext:()=>issueContext,projectService:{getFile(){reads++;throw Error('No source access.');}}});
 for(const key of ['planContext','requestRevision','groupRevision','checkContext','sourceInvestigation','investigationContinuation','investigationContext']){const response=await ask({...question,intent:'plan',issueContext,[key]:{}});assert.equal(response.status,400);assert.equal((await response.json()).code,'invalid-issue-context');}
 assert.equal(calls,0);assert.equal(reads,0);
});
