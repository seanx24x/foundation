/** Native provider wire protocols. They normalize evidence; they never execute tools. */
export const PROVIDER_KINDS = Object.freeze(['openai', 'anthropic', 'compatible']);
export const PROVIDER_DEFAULTS = Object.freeze({openai:'https://api.openai.com/v1', anthropic:'https://api.anthropic.com/v1'});
export const PROVIDER_CAPABILITIES = Object.freeze({text:true, images:false, tools:false});

export class ProviderProtocolError extends Error {
  constructor(code, message) { super(message); this.code=code; this.status=502; }
}
const streamError = () => new ProviderProtocolError('provider-stream-error', 'The provider could not complete this answer. The partial answer is preserved.');
const unsupportedTools = () => new ProviderProtocolError('provider-tools-unsupported', 'This request returned a tool call. Foundation has not executed it. Use a text answer or a scoped change proposal.');
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const model = value => typeof value === 'string' && value.length <= 200 && !/[\r\n]/.test(value) ? value : undefined;

export function providerEndpoint(baseUrl, kind) {
  return `${baseUrl.replace(/\/+$/, '')}/${({openai:'responses',anthropic:'messages',compatible:'chat/completions'})[kind]}`;
}

export function providerRequest(settings, system, input) {
  const content=JSON.stringify(input);
  const common={model:settings.model,stream:true};
  const headers={'Content-Type':'application/json'};
  if(settings.providerKind==='anthropic') {
    headers['anthropic-version']='2023-06-01';
    if(settings.apiKey) headers['x-api-key']=settings.apiKey;
    return {headers,body:{...common,max_tokens:8192,system,messages:[{role:'user',content}]}};
  }
  if(settings.apiKey) headers.Authorization=`Bearer ${settings.apiKey}`;
  if(settings.providerKind==='openai') return {headers,body:{...common,store:false,max_output_tokens:8192,instructions:system,input:[{role:'user',content:[{type:'input_text',text:content}]}]}};
  return {headers,body:{...common,stream_options:{include_usage:true},messages:[{role:'system',content:system},{role:'user',content}]}};
}

/** Each SSE dispatch yields normalized partial events and an explicit terminal marker. */
export function createProviderDecoder(kind) {
  let finishReason=null, inputTokens, outputTokens, cacheRead=0, cacheCreation=0;
  const usage = value => {
    if(!value || typeof value!=='object') return undefined;
    if(kind==='compatible') {
      const result={};
      for(const key of ['prompt_tokens','completion_tokens','total_tokens']) if(count(value[key])!==undefined) result[key]=value[key];
      return Object.keys(result).length?result:undefined;
    }
    if(kind==='openai') {
      const result={};
      for(const [source,target] of [['input_tokens','prompt_tokens'],['output_tokens','completion_tokens'],['total_tokens','total_tokens']]) if(count(value[source])!==undefined) result[target]=value[source];
      if(result.total_tokens===undefined && result.prompt_tokens!==undefined && result.completion_tokens!==undefined) result.total_tokens=result.prompt_tokens+result.completion_tokens;
      return Object.keys(result).length?result:undefined;
    }
    inputTokens=count(value.input_tokens)??inputTokens;
    outputTokens=count(value.output_tokens)??outputTokens;
    cacheRead=count(value.cache_read_input_tokens)??cacheRead;
    cacheCreation=count(value.cache_creation_input_tokens)??cacheCreation;
    const result={};
    if(inputTokens!==undefined) result.prompt_tokens=inputTokens+cacheRead+cacheCreation;
    if(outputTokens!==undefined) result.completion_tokens=outputTokens;
    if(result.prompt_tokens!==undefined && result.completion_tokens!==undefined) result.total_tokens=result.prompt_tokens+result.completion_tokens;
    return Object.keys(result).length?result:undefined;
  };
  return data => {
    if(data==='[DONE]') {
      if(kind!=='compatible') throw streamError();
      return [{type:'complete',finishReason}];
    }
    let chunk;
    try {chunk=JSON.parse(data);} catch {throw new ProviderProtocolError('invalid-provider-stream','The provider returned an unreadable stream. The partial answer is preserved.');}
    if(!chunk || typeof chunk!=='object' || Array.isArray(chunk) || chunk.error || chunk.type==='error') throw streamError();
    if(kind!=='compatible' && typeof chunk.type!=='string') throw new ProviderProtocolError('invalid-provider-stream','The provider returned an unreadable event. The partial answer is preserved.');
    const events=[];
    const appendUsage=value=>{const result=usage(value);if(result)events.push({type:'usage',usage:result});};
    const appendModel=value=>{const result=model(value);if(result)events.push({type:'model',model:result});};
    const appendText=value=>{if(typeof value==='string' && value)events.push({type:'delta',text:value});};
    const appendNativeText=value=>{
      if(typeof value!=='string') throw new ProviderProtocolError('invalid-provider-stream','The provider returned unreadable text. The partial answer is preserved.');
      appendText(value);
    };
    if(kind==='compatible') {
      appendModel(chunk.model); appendUsage(chunk.usage);
      const choice=chunk.choices?.[0];
      if(choice?.delta?.tool_calls?.length || choice?.delta?.function_call || ['tool_calls','function_call'].includes(choice?.finish_reason)) throw unsupportedTools();
      if(typeof choice?.finish_reason==='string') finishReason=choice.finish_reason;
      if (typeof choice?.delta?.refusal === 'string' && choice.delta.refusal) events.push({type:'refusal'});
      appendText(choice?.delta?.content??choice?.delta?.refusal);
      return events;
    }
    if(kind==='openai') {
      if(chunk.type==='response.output_text.delta') appendNativeText(chunk.delta);
      else if(chunk.type==='response.refusal.delta') {events.push({type:'refusal'});appendNativeText(chunk.delta);}
      else if(chunk.type==='response.created' || chunk.type==='response.in_progress') appendModel(chunk.response?.model);
      else if(chunk.type==='response.output_item.added' || chunk.type==='response.output_item.done') {
        if(chunk.item?.type && /(?:call|tool)/.test(chunk.item.type)) throw unsupportedTools();
      } else if(chunk.type?.includes('function_call_arguments') || chunk.type?.includes('tool_call')) throw unsupportedTools();
      else if(chunk.type==='response.failed' || chunk.type==='response.incomplete') throw new ProviderProtocolError('incomplete-answer','The provider did not finish this answer. The partial answer is preserved; no change was applied.');
      else if(chunk.type==='response.completed') {
        if(chunk.response?.status!=='completed') throw streamError();
        if(chunk.response.output?.some(item=>item?.type && /(?:call|tool)/.test(item.type))) throw unsupportedTools();
        if(chunk.response.output?.some(item=>item?.content?.some(part=>part?.type==='refusal'))) events.push({type:'refusal'});
        appendModel(chunk.response.model); appendUsage(chunk.response.usage);
        events.push({type:'complete',finishReason:'stop'});
      }
      return events;
    }
    if(chunk.type==='message_start') {appendModel(chunk.message?.model);appendUsage(chunk.message?.usage);}
    else if(chunk.type==='content_block_start') {
      if(typeof chunk.content_block?.type==='string' && /(?:^|_)tool(?:_|$)/.test(chunk.content_block.type)) throw unsupportedTools();
      if(chunk.content_block?.type==='text') appendNativeText(chunk.content_block.text);
    } else if(chunk.type==='content_block_delta') {
      if(chunk.delta?.type==='input_json_delta') throw unsupportedTools();
      if(chunk.delta?.type==='text_delta') appendNativeText(chunk.delta.text);
    } else if(chunk.type==='message_delta') {
      if(chunk.delta?.stop_reason==='tool_use') throw unsupportedTools();
      if(typeof chunk.delta?.stop_reason==='string') finishReason=chunk.delta.stop_reason==='end_turn' || chunk.delta.stop_reason==='stop_sequence' ? 'stop' : chunk.delta.stop_reason;
      appendUsage(chunk.usage);
    } else if(chunk.type==='message_stop') {
      if(!finishReason) throw streamError();
      if(finishReason!=='stop') throw new ProviderProtocolError('incomplete-answer','The provider stopped before completing this answer. The partial answer is preserved; no change was applied.');
      events.push({type:'complete',finishReason});
    }
    return events;
  };
}
