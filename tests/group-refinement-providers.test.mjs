import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {createAssistantService} from '../server/project/assistant.mjs';
import {createBuildArtifact,changeGroupDigest,stagedGroupSources} from '../server/project/proposals.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,16);
const originals=['a','b','c'].map((name,index)=>{const source=`export const ${name} = ${index+1};\n`;return{path:`src/${name}.ts`,source,revision:hash(source)};});
const edit=(index,before,after)=>({path:originals[index].path,find:`= ${before};`,replace:`= ${after};`});
const raw=edits=>JSON.stringify({title:'Refine staged values',summary:'Refine the explicitly selected staged sources.',edits,verification:['Check the updated values.']});
const parent=()=>({...createBuildArtifact({raw:raw([edit(0,1,10),edit(1,2,20)]),files:originals,projectId:'fixture'}).changeSet,requestId:'parent-request'});
const descriptor=group=>({version:1,conversationId:'chat-1',requestId:group.requestId,groupId:group.id,groupRevision:group.revision,groupDigest:changeGroupDigest(group)});
const body=group=>({projectId:'fixture',prompt:'Refine the staged first value.',intent:'build',changeSets:true,context:originals.map(({path,revision})=>({path,revision})),groupRevision:descriptor(group)});
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
 const group=options.group||parent(),sources=new Map(originals.map(file=>[file.path,structuredClone(file)])),resolutions=[],requests=[];
 const provider=createServer(async(req,res)=>{const payload=await readBody(req);requests.push(payload);await handler(req,res,payload);});const endpoint=await listen(t,provider);
 const projectService={async getFile(projectId,path){assert.equal(projectId,'fixture');if(options.read)await options.read(path,sources);return structuredClone(sources.get(path));}};
 const resolver=async value=>{resolutions.push(structuredClone(value));return options.resolve?options.resolve(value,group,sources):structuredClone(group);};
 const service=createAssistantService({projectService,config:{providerKind:kind,baseUrl:`${endpoint}/v1`,model:'selected-model',apiKey:'PRIVATE_KEY',timeoutMs:3000},...(options.noResolver?{}:{resolveGroupRevision:resolver})});
 const server=createServer(async(request,response)=>{const send=(status,value)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};try{await service.handle({request,response,url:'/api/assistant/ask',body:await readBody(request),send});}catch(error){if(!response.headersSent)send(error.status||500,{code:error.code,error:error.message});else response.end();}});
 const url=await listen(t,server);return{group,sources,resolutions,requests,service,ask:(input=body(group),options={})=>fetch(`${url}/api/assistant/ask`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),...options})};
}
for(const[kind,protocol]of Object.entries(protocols)){
 test(`${kind} refinement sends exact staged snapshots and composes incremental output against original disk`,async t=>{
  const h=await harness(t,kind,async(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(raw([edit(0,10,100)]))+protocol.finish());});
  const before=structuredClone(h.group),result=await events(await h.ask({...body(h.group),previousAnswer:'PRIVATE_ANSWER',tools:['PRIVATE_TOOL'],group:{files:[{after:'FORGED_RENDERER_SOURCE'}]}}));
  const effective=stagedGroupSources({group:h.group,files:originals,projectId:'fixture'}),input=inputFor(kind,h.requests[0]);assert.deepEqual(Object.keys(input).sort(),['context','intent','question','sources']);assert.deepEqual(input.context,{kind:'staged-group',title:h.group.title});
  assert.deepEqual(input.sources,effective.map(({source,...file})=>({...file,content:source.split('\n').map((line,index)=>`${index+1}: ${line}`).join('\n')})));assert.equal(input.groupRevision,undefined);assert.equal(h.requests[0].tools,undefined);assert.doesNotMatch(JSON.stringify(h.requests),/PRIVATE_ANSWER|PRIVATE_TOOL|FORGED_RENDERER_SOURCE|parent-request|chat-1/);assert.match(systemFor(kind,h.requests[0]),/staged sources/);
  const refined=result.find(event=>event.type==='changeSet')?.changeSet;assert.ok(refined,JSON.stringify(result));assert.equal(refined.files[0].after,'export const a = 100;\n');assert.equal(refined.files[1].after,h.group.files[1].after);assert.equal(refined.files[0].before,originals[0].source);assert.equal(refined.files[0].baseRevision,originals[0].revision);assert.deepEqual(refined.context,body(h.group).context);assert.notEqual(refined.id,h.group.id);assert.equal(refined.verificationStatus,'not-run');assert.equal(result.at(-1).type,'done');assert.equal(result.at(-1).providerKind,kind);assert.equal(result.at(-1).model,`reported-${kind}`);assert.deepEqual(result.at(-1).usage,{prompt_tokens:10,completion_tokens:5,total_tokens:15});
  assert.deepEqual(result[0].context,effective.map(({source,...file})=>file));assert.deepEqual(result[0].contextNote,input.context);assert.ok(h.resolutions.length>=4);assert.ok(h.resolutions.every(value=>JSON.stringify(value)===JSON.stringify({projectId:'fixture',...descriptor(h.group)})));assert.deepEqual(h.group,before);assert.deepEqual([...h.sources.values()],originals);
 });
 test(`${kind} incomplete, refused, malformed, tools and invalid anchors preserve the parent and emit no candidate`,async t=>{
  for(const[content,ending]of [[raw([edit(0,10,100)]),''],[raw([edit(0,10,100)]),protocol.incomplete()],[raw([edit(0,10,100)]),protocol.refusal()],[raw([edit(0,10,100)]),protocol.tool()],['{invalid',protocol.finish()],[raw([edit(0,1,100)]),protocol.finish()],[raw([{...edit(0,10,100),path:'src/unselected.ts'}]),protocol.finish()]]){
   const h=await harness(t,kind,async(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(content)+ending);}),before=structuredClone(h.group);const result=await events(await h.ask());assert.equal(result.at(-1).type,'error');assert.equal(result.some(event=>['changeSet','proposal','done'].includes(event.type)),false);assert.deepEqual(h.group,before);assert.deepEqual([...h.sources.values()],originals);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TOOL_PAYLOAD|PRIVATE_KEY/);
  }
 });
 test(`${kind} changed parent or original source during generation retires the entire refinement`,async t=>{
  for(const kindOfChange of ['group','source']){
   let returned=false;const h=await harness(t,kind,async(_req,res)=>{returned=true;res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(protocol.start()+protocol.text(raw([edit(0,10,100)]))+protocol.finish());},{resolve:(_descriptor,group)=>returned&&kindOfChange==='group'?{...group,title:'Different group intent'}:structuredClone(group),read:(path,sources)=>{if(returned&&kindOfChange==='source'&&path===originals[2].path)sources.set(path,{...originals[2],source:'later source',revision:hash('later source')});}});
   const result=await events(await h.ask());assert.equal(result.at(-1).type,'error');assert.equal(result.some(event=>['changeSet','proposal','done'].includes(event.type)),false);
  }
 });
 test(`${kind} Stop after complete-looking JSON disconnects upstream without emitting a refinement`,async t=>{
  let closed;const providerClosed=new Promise(resolve=>closed=resolve);
  const h=await harness(t,kind,async(_req,res)=>{res.once('close',closed);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(protocol.start()+protocol.text(raw([edit(0,10,100)])));});const before=structuredClone(h.group);
  const request={method:'POST',aborted:false},response=new EventEmitter(),captured=[];Object.assign(response,{destroyed:false,writableEnded:false,writeHead(){},write(line){const event=JSON.parse(line);captured.push(event);if(event.type==='delta'){request.aborted=true;this.destroyed=true;this.emit('close');}},end(){this.writableEnded=true;}});
  await h.service.handle({request,response,url:'/api/assistant/ask',body:body(h.group)});await providerClosed;assert.ok(captured.some(event=>event.type==='delta'));assert.equal(captured.some(event=>['changeSet','proposal','done'].includes(event.type)),false);assert.deepEqual(h.group,before);
 });
}

test('refinement refuses missing resolver, wrong modes, mixed handoffs, malformed identity and unselected basis before contacting a provider',async t=>{
 for(const kind of ['no-resolver','ask','plan','review','no-groups','request-revision','plan-context','descriptor-extra','wrong-id','wrong-digest','wrong-revision','wrong-request','missing-context','ordered-context','resolver-error']){
  const h=await harness(t,'compatible',async(_req,res)=>res.end(),{noResolver:kind==='no-resolver',...(kind==='resolver-error'?{resolve:()=>{throw Error('PRIVATE_RESOLVER_ERROR');}}:{})});const input=body(h.group);
  if(['ask','plan','review'].includes(kind))input.intent=kind;if(kind==='no-groups')delete input.changeSets;if(kind==='request-revision')input.requestRevision={version:1};if(kind==='plan-context')input.planContext={version:1};if(kind==='descriptor-extra')input.groupRevision.after='FORGED_SOURCE';if(kind==='wrong-id')input.groupRevision.groupId='b4d54772-2bd3-4d88-9e47-1db4ec39feb4';if(kind==='wrong-digest')input.groupRevision.groupDigest='a'.repeat(64);if(kind==='wrong-revision')input.groupRevision.groupRevision++;if(kind==='wrong-request')input.groupRevision.requestId='other';if(kind==='missing-context')input.context.pop();if(kind==='ordered-context')input.context.reverse();
  const response=await h.ask(input);assert.ok([400,409].includes(response.status),kind);const result=await response.json();assert.doesNotMatch(JSON.stringify(result),/PRIVATE_RESOLVER_ERROR|FORGED_SOURCE/);assert.equal(h.requests.length,0,kind);
 }
});

test('resolver revalidation catches group and source changes across awaited preparation boundaries',async t=>{
 for(const kind of ['group','source']){
  let calls=0;const h=await harness(t,'compatible',async(_req,res)=>res.end(),{resolve:(_descriptor,group,sources)=>{calls++;if(kind==='source'&&calls===1)sources.set(originals[2].path,{...originals[2],source:'changed but same reported hash'});return kind==='group'&&calls===2?{...group,summary:'Changed scope'}:structuredClone(group);}});
  const response=await h.ask();assert.equal(response.status,409);assert.equal(h.requests.length,0);
 }
});
