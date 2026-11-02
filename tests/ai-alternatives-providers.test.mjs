import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {createAssistantService} from '../server/project/assistant.mjs';
import {normalizeAIAlternatives} from '../server/project/ai-alternatives.mjs';
import {alternativeSources,alternativeGenerationFixture,alternativeRawFixture} from './helpers/ai-alternatives-fixture.mjs';
const body=()=>({projectId:'fixture',prompt:'Explore two clear save experiences.',intent:'build',changeSets:true,context:alternativeSources().map(({path,revision})=>({path,revision})),alternativeGeneration:alternativeGenerationFixture()});
const frame=value=>`data: ${JSON.stringify(value)}\n\n`;
const protocols={
 compatible:{start:()=>'',text:content=>frame({choices:[{delta:{content}}]}),finish:()=>frame({model:'reported-compatible',choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})+'data: [DONE]\n\n',incomplete:()=>frame({choices:[{delta:{},finish_reason:'length'}]})+'data: [DONE]\n\n',refusal:()=>frame({choices:[{delta:{refusal:'Refused'},finish_reason:'stop'}]})+'data: [DONE]\n\n',tool:()=>frame({choices:[{delta:{tool_calls:[{function:{name:'PRIVATE_TOOL'}}]}}]})},
 openai:{start:()=>frame({type:'response.created',response:{model:'reported-openai'}}),text:delta=>frame({type:'response.output_text.delta',delta}),finish:()=>frame({type:'response.completed',response:{status:'completed',model:'reported-openai',usage:{input_tokens:10,output_tokens:5,total_tokens:15}}}),incomplete:()=>frame({type:'response.incomplete',response:{status:'incomplete'}}),refusal:()=>frame({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'Refused'}]}]}}),tool:()=>frame({type:'response.output_item.added',item:{type:'function_call',name:'PRIVATE_TOOL',arguments:'PRIVATE_TOOL_PAYLOAD'}})},
 anthropic:{start:()=>frame({type:'message_start',message:{model:'reported-anthropic',usage:{input_tokens:10,output_tokens:0}}}),text:text=>frame({type:'content_block_delta',index:0,delta:{type:'text_delta',text}}),finish:()=>frame({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:5}})+frame({type:'message_stop'}),incomplete:()=>frame({type:'message_delta',delta:{stop_reason:'max_tokens'}})+frame({type:'message_stop'}),refusal:()=>frame({type:'message_delta',delta:{stop_reason:'refusal'}})+frame({type:'message_stop'}),tool:()=>frame({type:'content_block_start',index:1,content_block:{type:'tool_use',name:'PRIVATE_TOOL',input:{secret:'PRIVATE_TOOL_PAYLOAD'}}})},
};
const inputFor=(kind,payload)=>JSON.parse(kind==='openai'?payload.input[0].content[0].text:kind==='anthropic'?payload.messages[0].content:payload.messages[1].content);
const systemFor=(kind,payload)=>kind==='openai'?payload.instructions:kind==='anthropic'?payload.system:payload.messages[0].content;
const readBody=async request=>{const parts=[];for await(const part of request)parts.push(part);return JSON.parse(Buffer.concat(parts));};
const events=async response=>(await response.text()).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
async function listen(t,server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});return `http://127.0.0.1:${server.address().port}`;}
async function harness(t,kind,handler,options={}){
 const sources=new Map(alternativeSources().map(file=>[file.path,file])),resolutions=[],requests=[];
 const provider=createServer(async(req,res)=>{const payload=await readBody(req);requests.push(payload);await handler(req,res,payload);});const endpoint=await listen(t,provider);
 const projectService={async getFile(projectId,path){assert.equal(projectId,'fixture');if(options.read)await options.read(path,sources);return structuredClone(sources.get(path));}};
 const resolver=async(projectId,generation)=>{assert.equal(projectId,'fixture');resolutions.push(structuredClone(generation));return options.resolve?options.resolve(generation,sources):structuredClone(generation);};
 const service=createAssistantService({projectService,config:{providerKind:kind,baseUrl:`${endpoint}/v1`,model:'selected-model',apiKey:'PRIVATE_KEY',timeoutMs:3000},...(options.noResolver?{}:{resolveAlternativeGeneration:resolver})});
 const server=createServer(async(request,response)=>{const send=(status,value)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};try{await service.handle({request,response,url:'/api/assistant/ask',body:await readBody(request),send});}catch(error){if(!response.headersSent)send(error.status||500,{code:error.code,error:error.message});else response.end();}});
 const url=await listen(t,server);return{sources,resolutions,requests,service,ask:(input=body(),options={})=>fetch(`${url}/api/assistant/ask`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),...options})};
}
for(const[kind,protocol]of Object.entries(protocols)){
 test(`${kind} alternative generation shares only its explicit saved source, design brief and frozen scenario`,async t=>{
  const h=await harness(t,kind,async(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(JSON.stringify(alternativeRawFixture()))+protocol.finish());});
  const result=await events(await h.ask({...body(),previousAnswer:'PRIVATE_ANSWER',tools:['PRIVATE_TOOL'],files:[{source:'FORGED_RENDERER_SOURCE'}]})),input=inputFor(kind,h.requests[0]);
  assert.deepEqual(Object.keys(input).sort(),['alternativeGeneration','intent','question','sources']);assert.deepEqual(input.alternativeGeneration,alternativeGenerationFixture());assert.deepEqual(input.sources,alternativeSources().map((file,index)=>({id:`S${index+1}`,path:file.path,revision:file.revision,lines:file.source.split('\n').length,content:file.source.split('\n').map((line,i)=>`${i+1}: ${line}`).join('\n')})));
  assert.doesNotMatch(JSON.stringify(h.requests),/PRIVATE_ANSWER|PRIVATE_TOOL|FORGED_RENDERER_SOURCE/);assert.equal(h.requests[0].tools,undefined);assert.match(systemFor(kind,h.requests[0]),/SAME original saved sources/);assert.match(systemFor(kind,h.requests[0]),/No candidate is preferred or automatically accepted/);
  const artifact=result.find(event=>event.type==='alternatives')?.alternatives;assert.ok(artifact,JSON.stringify(result));assert.deepEqual(normalizeAIAlternatives(artifact,'fixture',alternativeSources()),artifact);assert.equal(artifact.candidates.length,2);assert.equal(result.some(event=>['proposal','changeSet'].includes(event.type)),false);assert.deepEqual(result[0].alternativeGeneration,alternativeGenerationFixture());assert.equal(result.at(-1).type,'done');assert.equal(result.at(-1).model,`reported-${kind}`);assert.deepEqual(result.at(-1).usage,{prompt_tokens:10,completion_tokens:5,total_tokens:15});assert.ok(h.resolutions.length>=4);assert.deepEqual([...h.sources.values()],alternativeSources());
 });
 test(`${kind} malformed, partial, refused and tool-bearing alternatives never emit actionable candidates`,async t=>{
  const malformed=alternativeRawFixture();malformed.candidates[1].edits[0].find='not in source';
  for(const[content,ending]of [[JSON.stringify(alternativeRawFixture()),''],[JSON.stringify(alternativeRawFixture()),protocol.incomplete()],[JSON.stringify(alternativeRawFixture()),protocol.refusal()],[JSON.stringify(alternativeRawFixture()),protocol.tool()],['{invalid',protocol.finish()],[JSON.stringify(malformed),protocol.finish()]]){
   const h=await harness(t,kind,async(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(content)+ending);});const result=await events(await h.ask());assert.equal(result.at(-1).type,'error');assert.equal(result.some(event=>['alternatives','changeSet','proposal','done'].includes(event.type)),false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_KEY|PRIVATE_TOOL_PAYLOAD/);assert.deepEqual([...h.sources.values()],alternativeSources());
  }
 });
 test(`${kind} source or scenario drift during generation rejects the complete candidate set`,async t=>{
  for(const change of ['source','scope']){let returned=false;const h=await harness(t,kind,async(_req,res)=>{returned=true;res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(JSON.stringify(alternativeRawFixture()))+protocol.finish());},{resolve:generation=>returned&&change==='scope'?{...generation,scope:{...generation.scope,feature:{...generation.scope.feature,revision:4}}}:generation,read:(path,sources)=>{if(returned&&change==='source')sources.get(path).source+='changed with unchanged claimed revision';}});const result=await events(await h.ask());assert.equal(result.at(-1).type,'error');assert.equal(result.some(event=>['alternatives','done'].includes(event.type)),false);}
 });
 test(`${kind} cancellation after complete-looking JSON aborts both alternatives without partial staging`,async t=>{
  let closed;const providerClosed=new Promise(resolve=>closed=resolve);const h=await harness(t,kind,async(_req,res)=>{res.once('close',closed);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(protocol.start()+protocol.text(JSON.stringify(alternativeRawFixture())));});
  const request={method:'POST',aborted:false},response=new EventEmitter(),captured=[];Object.assign(response,{destroyed:false,writableEnded:false,writeHead(){},write(line){const event=JSON.parse(line);captured.push(event);if(event.type==='delta'){request.aborted=true;this.destroyed=true;this.emit('close');}},end(){this.writableEnded=true;}});
  await h.service.handle({request,response,url:'/api/assistant/ask',body:body()});await providerClosed;assert.ok(captured.some(event=>event.type==='delta'));assert.equal(captured.some(event=>['alternatives','changeSet','proposal','done'].includes(event.type)),false);assert.deepEqual([...h.sources.values()],alternativeSources());
 });
}

test('alternative generation refuses mixed handoffs, invalid mode, missing host ownership and source outside scope before provider dispatch',async t=>{
 for(const option of ['no-resolver','ask','plan','review','invalid-count','groupRevision','requestRevision','planContext','checkContext','sourceInvestigation','investigationContinuation','taskContext','decisionContext','issueContext','runtimeContext','one-source','scope-source','config-source','resolver-error']){
  const h=await harness(t,'compatible',async(_req,res)=>res.end(),{noResolver:option==='no-resolver',...(option==='resolver-error'?{resolve:()=>{throw Error('PRIVATE_RESOLVER_ERROR');}}:{})}),input=body();
  if(['ask','plan','review'].includes(option))input.intent=option;else if(option==='invalid-count')input.alternativeGeneration.count=3;else if(option==='one-source')input.context=input.context.slice(0,1);else if(option==='scope-source')input.alternativeGeneration.scope.feature.paths.pop();else if(option==='config-source'){const file=h.sources.get('src/theme.css');h.sources.delete(file.path);file.path='vite.config.ts';h.sources.set(file.path,file);input.context[1].path=file.path;input.alternativeGeneration.scope.feature.paths[1]=file.path;}else if(!['no-resolver','resolver-error'].includes(option))input[option]={};
  const response=await h.ask(input);assert.ok([400,409].includes(response.status),option);assert.equal(h.requests.length,0);assert.doesNotMatch(await response.text(),/PRIVATE_RESOLVER_ERROR/);
 }
});

test('generation rechecks source and scope across awaited preparation boundaries',async t=>{
 for(const change of ['scope','source']){let count=0;const h=await harness(t,'compatible',async(_req,res)=>res.end(),{resolve:(generation,sources)=>{count++;if(change==='source'&&count===1)sources.get('src/profile.ts').source+='changed';return change==='scope'&&count===2?{...generation,scope:{...generation.scope,definitionRevision:8}}:generation;}});const response=await h.ask();assert.equal(response.status,409);assert.equal(h.requests.length,0);}
});
