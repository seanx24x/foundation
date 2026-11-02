import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createInlineEditService, InlineEditError} from '../server/project/inline-edit.mjs';

const frame = value => `data: ${JSON.stringify(value)}\n\n`;
const input = {selection:'  const label = "Save";\r\n',languageId:'typescript',prompt:'Clarify the label.'};
const result = {replacement:'  const label = "Save changes";\r\n',summary:'Clarifies the selected label.'};
const protocols = {
 compatible:{endpoint:'chat/completions',start:()=>frame({model:'reported-compatible',choices:[]}),text:text=>frame({choices:[{delta:{content:text}}]}),finish:()=>frame({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})+'data: [DONE]\n\n',incomplete:()=>frame({choices:[{delta:{},finish_reason:'length'}]})+'data: [DONE]\n\n',tool:()=>frame({choices:[{delta:{tool_calls:[{function:{name:'execute',arguments:'PRIVATE_TOOL'}}]}}]}),refusal:()=>frame({choices:[{delta:{refusal:'REFUSED_PRIVATE'}}]})},
 openai:{endpoint:'responses',start:()=>frame({type:'response.created',response:{model:'reported-openai'}}),text:text=>frame({type:'response.output_text.delta',delta:text}),finish:()=>frame({type:'response.completed',response:{status:'completed',model:'reported-openai',usage:{input_tokens:10,output_tokens:5,total_tokens:15}}}),incomplete:()=>frame({type:'response.incomplete',response:{status:'incomplete'}}),tool:()=>frame({type:'response.output_item.added',item:{type:'function_call',name:'execute',arguments:'PRIVATE_TOOL'}}),refusal:()=>frame({type:'response.refusal.delta',delta:'REFUSED_PRIVATE'})},
 anthropic:{endpoint:'messages',start:()=>frame({type:'message_start',message:{model:'reported-anthropic',usage:{input_tokens:6,cache_read_input_tokens:3,cache_creation_input_tokens:1,output_tokens:0}}}),text:text=>frame({type:'content_block_delta',delta:{type:'text_delta',text}}),finish:()=>frame({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:5}})+frame({type:'message_stop'}),incomplete:()=>frame({type:'message_delta',delta:{stop_reason:'max_tokens'}})+frame({type:'message_stop'}),tool:()=>frame({type:'content_block_start',content_block:{type:'tool_use',name:'execute',input:'PRIVATE_TOOL'}})},
};
async function readBody(request) {const chunks=[];for await(const chunk of request)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks));}
async function listen(t,server) {
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 return `http://127.0.0.1:${server.address().port}`;
}
async function harness(t,kind,handler,config={}) {
 const requests=[];
 const endpoint=await listen(t,createServer(async(req,res)=>{
  try {const record={path:req.url,headers:req.headers,body:await readBody(req)};requests.push(record);await handler(req,res,record);}
  catch {if(!res.headersSent)res.writeHead(500);res.end();}
 }));
 const service=createInlineEditService({config:{providerKind:kind,baseUrl:`${endpoint}/v1`,model:'selected-model',apiKey:'PRIVATE_KEY',timeoutMs:3000,...config}});
 return {service,requests};
}
const inputFor=(kind,payload)=>JSON.parse(kind==='openai'?payload.input[0].content[0].text:kind==='anthropic'?payload.messages[0].content:payload.messages[1].content);
const systemFor=(kind,payload)=>kind==='openai'?payload.instructions:kind==='anthropic'?payload.system:payload.messages[0].content;
const textHandler=(protocol,raw=JSON.stringify(result),ending=protocol.finish())=>async(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8'});res.end(protocol.start()+protocol.text(raw)+ending);};
const errorCheck=(code)=>error=>{assert.ok(error instanceof InlineEditError);if(code)assert.equal(error.code,code);assert.doesNotMatch(error.message,/PRIVATE|REFUSED_PRIVATE|partial answer is preserved/i);return true;};

for(const[kind,protocol]of Object.entries(protocols)) {
 test(`${kind} selection editing shares only exact selection, language and instruction with no file or history context`,async t=>{
  const {service,requests}=await harness(t,kind,async(_req,res)=>{
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   const bytes=Buffer.from(protocol.start()+': keepalive\r\n\r\n'+protocol.text(JSON.stringify({...result,summary:'Clarity ✓'}))+protocol.finish());
   for(let i=0;i<bytes.length;i+=3)res.write(bytes.subarray(i,i+3));res.end();
  });
  const actual=await service.generate({...input,prompt:`  ${input.prompt}  `,path:'/PRIVATE_PATH',buffer:'PRIVATE_BUFFER',history:['PRIVATE_HISTORY'],apiKey:'PRIVATE_INJECTED_KEY'});
  assert.deepEqual(actual,{...result,summary:'Clarity ✓',model:`reported-${kind}`,providerKind:kind,usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});
  assert.equal(requests.length,1);const {path,headers,body}=requests[0];assert.equal(path,`/v1/${protocol.endpoint}`);
  assert.deepEqual(inputFor(kind,body),{selection:input.selection,languageId:input.languageId,prompt:input.prompt});
  assert.match(systemFor(kind,body),/untrusted/);assert.match(systemFor(kind,body),/cannot inspect additional source/i);
  assert.equal(body.model,'selected-model');assert.equal(body.stream,true);assert.equal(body.tools,undefined);assert.equal(body.previous_response_id,undefined);
  assert.doesNotMatch(JSON.stringify(body),/PRIVATE_PATH|PRIVATE_BUFFER|PRIVATE_HISTORY|PRIVATE_INJECTED_KEY/);
  if(kind==='anthropic'){assert.equal(headers['x-api-key'],'PRIVATE_KEY');assert.equal(headers.authorization,undefined);assert.equal(headers['anthropic-version'],'2023-06-01');}
  else {assert.equal(headers.authorization,'Bearer PRIVATE_KEY');assert.equal(headers['x-api-key'],undefined);}
  if(kind==='openai')assert.equal(body.store,false);
  assert.deepEqual(service.status().capabilities,{text:true,images:false,tools:false});assert.equal(service.status().providerKind,kind);
  assert.doesNotMatch(JSON.stringify([service.status(),actual]),/PRIVATE_KEY|apiKey|endpoint/);
 });
 test(`${kind} incomplete, refusal, malformed and tool streams never produce an edit`,async t=>{
  const endings=['',protocol.incomplete(),protocol.tool(),'data: INVALID PRIVATE_STREAM\n\n',frame({type:'error',error:{message:'PRIVATE_PROVIDER_ERROR'}})];
  if(protocol.refusal)endings.push(protocol.refusal()+protocol.finish());
  for(const ending of endings) {
   const {service}=await harness(t,kind,textHandler(protocol,JSON.stringify(result),ending));
   await assert.rejects(service.generate(input),errorCheck());
  }
 });
 test(`${kind} cancellation aborts the upstream and cannot expose a partial replacement`,async t=>{
  let receive,close;const received=new Promise(resolve=>receive=resolve),closed=new Promise(resolve=>close=resolve);
  const {service}=await harness(t,kind,async(_req,res)=>{res.on('close',close);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(protocol.start()+protocol.text(JSON.stringify(result)));receive();});
  const abort=new AbortController();const pending=service.generate({...input,signal:abort.signal});await received;abort.abort();
  await assert.rejects(pending,error=>error.name==='AbortError'&&error.code==='inline-edit-cancelled');
  await Promise.race([closed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('upstream not closed')),1000);timer.unref();})]);
 });
 test(`${kind} rejects redirects without forwarding context or credentials`,async t=>{
  let forwarded=0;const target=await listen(t,createServer((_req,res)=>{forwarded++;res.end();}));
  const {service}=await harness(t,kind,async(_req,res)=>{res.writeHead(307,{Location:`${target}/PRIVATE_REDIRECT`});res.end('PRIVATE_KEY');});
  await assert.rejects(service.generate(input),errorCheck('inline-provider-unavailable'));assert.equal(forwarded,0);
 });
 test(`${kind} requires exact result keys, bounded strings and an actual change`,async t=>{
  const malformed=[{},[],null,{...result,applied:true},{...result,path:'PRIVATE_PATH'},{replacement:7,summary:'s'},{replacement:'x',summary:''},{replacement:'x',summary:'x'.repeat(501)},{replacement:'x'.repeat(32769),summary:'s'},'{"replacement":"x","summary":"s","replacement":"y"}',{replacement:'\ud800',summary:'s'},{replacement:'x\0',summary:'s'}];
  for(const value of malformed){const raw=typeof value==='string'?value:JSON.stringify(value);const {service}=await harness(t,kind,textHandler(protocol,raw));await assert.rejects(service.generate(input),errorCheck('invalid-inline-edit'));}
  const {service}=await harness(t,kind,textHandler(protocol,JSON.stringify({replacement:input.selection,summary:'Unchanged.'})));await assert.rejects(service.generate(input),errorCheck('inline-edit-unchanged'));
 });
 test(`${kind} accepts deletion and exact whitespace while ignoring events after a complete terminal frame`,async t=>{
  for(const replacement of ['', '  \r\n\t', 'a"b:{c}']){
   const {service}=await harness(t,kind,textHandler(protocol,JSON.stringify({replacement,summary:'Proposed edit.'}),protocol.finish().trimEnd()));
   assert.equal((await service.generate(input)).replacement,replacement);
  }
  const {service}=await harness(t,kind,textHandler(protocol,JSON.stringify(result),protocol.finish()+protocol.tool()+protocol.text('PRIVATE_LATE')));
  assert.equal((await service.generate(input)).replacement,result.replacement);
 });
}

test('invalid inline inputs fail before any provider request, and pre-aborted signals remain cancelled',async t=>{
 const {service,requests}=await harness(t,'compatible',textHandler(protocols.compatible));
 const invalid=[null,[],{}, {...input,selection:''},{...input,selection:'x'.repeat(16385)},{...input,selection:'é'.repeat(8193)}, {...input,selection:'x\0'}, {...input,selection:'\ud800'}, {...input,prompt:''},{...input,prompt:' '},{...input,prompt:'x'.repeat(2001)},{...input,prompt:'\ud800'},{...input,languageId:''},{...input,languageId:'x'.repeat(81)},{...input,languageId:'../PRIVATE'},{...input,signal:{}}];
 for(const value of invalid)await assert.rejects(service.generate(value),error=>error instanceof InlineEditError&&error.status===400);
 const abort=new AbortController();abort.abort();await assert.rejects(service.generate({...input,signal:abort.signal}),error=>error.name==='AbortError');assert.equal(requests.length,0);
});

test('inline limits measure UTF-8 selection and replacement bytes, not character count',async t=>{
 const boundarySelection='é'.repeat(8192),replacement='é'.repeat(16384);
 const {service}=await harness(t,'compatible',textHandler(protocols.compatible,JSON.stringify({replacement,summary:'s'.repeat(500)})));
 assert.equal((await service.generate({...input,selection:boundarySelection,prompt:'x'.repeat(2000)})).replacement,replacement);
 const h=await harness(t,'compatible',textHandler(protocols.compatible,JSON.stringify({replacement:replacement+'é',summary:'s'})));
 await assert.rejects(h.service.generate(input),errorCheck('invalid-inline-edit'));
});

test('JSON escape expansion remains valid up to the replacement byte bound',async t=>{
 const replacement='\u0001'.repeat(32768);
 const {service}=await harness(t,'compatible',textHandler(protocols.compatible,JSON.stringify({replacement,summary:'Escaped output.'})));
 assert.equal((await service.generate(input)).replacement,replacement);
});

test('provider configuration rejects unsafe endpoints and exposes no credentials',async()=>{
 for(const config of [{providerKind:'unknown',baseUrl:'https://example.com/v1',model:'m',apiKey:'PRIVATE_KEY'}, {providerKind:'openai',baseUrl:'http://example.com/v1',model:'m',apiKey:'PRIVATE_KEY'}, {providerKind:'openai',baseUrl:'https://PRIVATE:PRIVATE@example.com/v1',model:'m'}, {providerKind:'anthropic',baseUrl:'https://example.com/v1?key=PRIVATE',model:'m'}, {providerKind:'compatible',baseUrl:'https://example.com/v1',model:'m'}, {providerKind:'compatible',baseUrl:'http://127.0.0.1:1234/v1',model:' '}]){
  const service=createInlineEditService({config});assert.equal(service.status().configured,false);assert.doesNotMatch(JSON.stringify(service.status()),/PRIVATE/);await assert.rejects(service.generate(input),errorCheck('provider-not-configured'));
 }
});

test('provider HTTP and non-stream failures never echo their bodies',async t=>{
 for(const status of [401,403,429,500]) {
  const {service}=await harness(t,'compatible',async(_req,res)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end('{"error":"PRIVATE_KEY"}');});
  await assert.rejects(service.generate(input),errorCheck('inline-provider-error'));
 }
 const {service}=await harness(t,'compatible',async(_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('PRIVATE_BODY');});
 await assert.rejects(service.generate(input),errorCheck('invalid-inline-stream'));
});

test('timeout retires an incomplete provider request and permits a later generation',async t=>{
 let count=0;const {service}=await harness(t,'compatible',async(_req,res)=>{count++;if(count===1){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': waiting\n\n');}else await textHandler(protocols.compatible)(_req,res);},{timeoutMs:50});
 await assert.rejects(service.generate(input),errorCheck('inline-edit-timeout'));
 assert.equal((await service.generate(input)).replacement,result.replacement);
});

test('one running selection request owns the service until cancellation or completion',async t=>{
 let receive;const received=new Promise(resolve=>receive=resolve);
 const {service,requests}=await harness(t,'compatible',async(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': waiting\n\n');receive();});
 const abort=new AbortController(),pending=service.generate({...input,signal:abort.signal});await received;
 await assert.rejects(service.generate(input),errorCheck('inline-edit-busy'));assert.equal(requests.length,1);abort.abort();await assert.rejects(pending,errorCheck('inline-edit-cancelled'));
});

test('bounded raw stream and structured output cannot grow indefinitely',async t=>{
 for(const [wire,code]of [[`: ${'x'.repeat(1024*1024)}\n\n`,'inline-stream-too-large'],[protocols.compatible.text('x'.repeat(220000)),'inline-output-too-large']]){
  const {service}=await harness(t,'compatible',async(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(wire+protocols.compatible.finish());});
  await assert.rejects(service.generate(input),errorCheck(code));
 }
});

test('invalid UTF-8 never becomes an applicable replacement',async t=>{
 const {service}=await harness(t,'compatible',async(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(Buffer.from([0xff,0xfe,0x0a]));});
 await assert.rejects(service.generate(input),errorCheck('inline-provider-unavailable'));
});

test('cancellation settles even when fetch ignores its signal and retires the late response body',async t=>{
 let resolveResponse,lateCancelled=false;
 const pendingResponse=new Promise(resolve=>resolveResponse=resolve);
 t.mock.method(globalThis,'fetch',()=>pendingResponse);
 const service=createInlineEditService({config:{providerKind:'compatible',baseUrl:'http://127.0.0.1:1234/v1',model:'fixture',timeoutMs:1000}});
 const abort=new AbortController(),pending=service.generate({...input,signal:abort.signal});abort.abort();
 await assert.rejects(pending,errorCheck('inline-edit-cancelled'));
 resolveResponse({body:{cancel:async()=>{lateCancelled=true;}}});await new Promise(resolve=>setImmediate(resolve));assert.equal(lateCancelled,true);
});

test('cancellation during completed stream cleanup still withholds the candidate',async t=>{
 let cleanupStarted,finishCleanup;const started=new Promise(resolve=>cleanupStarted=resolve),cleanup=new Promise(resolve=>finishCleanup=resolve);
 const bytes=Buffer.from(protocols.compatible.text(JSON.stringify(result))+protocols.compatible.finish());
 t.mock.method(globalThis,'fetch',async()=>({ok:true,headers:{get:()=> 'text/event-stream'},body:{getReader:()=>({read:async()=>({done:false,value:bytes}),cancel:async()=>{cleanupStarted();await cleanup;}})}}));
 const service=createInlineEditService({config:{baseUrl:'http://127.0.0.1:1234/v1',model:'fixture'}});
 const abort=new AbortController(),pending=service.generate({...input,signal:abort.signal});await started;abort.abort();finishCleanup();
 await assert.rejects(pending,errorCheck('inline-edit-cancelled'));
});

test('timeout also bounds a transport that never resolves or observes AbortSignal',async t=>{
 t.mock.method(globalThis,'fetch',()=>new Promise(()=>{}));
 // This keepalive belongs only to the disposable test. Production timers are unref'd.
 const keepalive=setInterval(()=>{},1000);t.after(()=>clearInterval(keepalive));
 const service=createInlineEditService({config:{baseUrl:'http://127.0.0.1:1234/v1',model:'fixture',timeoutMs:50}});
 await assert.rejects(service.generate(input),errorCheck('inline-edit-timeout'));
});
