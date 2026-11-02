import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { historyHost, populatedHistory, populatedConversationStore } from '../extension/test/helpers/history-performance-fixture.mjs';

// JSON envelope sizes measured outside native typing. This is a deterministic
// generated host specimen, not a measurement of Electron IPC bytes or latency.
const h=historyHost({fixture:populatedHistory()}),{store}=populatedConversationStore(h.fixture.project.id);
const messages={workspace:[],assistant:[]};
const view=surface=>({postMessage:message=>{messages[surface].push(structuredClone(message));return Promise.resolve(true);}});
const panel=view('workspace'),assistant=view('assistant');
Object.assign(h.host,{conversations:()=>store,flushEditorFocus(){},dirtyPaths:()=>[],savedChanges:new Map(),activeFile:null,focus:null,design:{},mode:'Understand',
  assistantSurface:()=>({resolved:true,visible:true,open:true}),workspaceLayout:()=>({inspectorWidth:320}),runtimeSnapshot:()=>({status:'disconnected',observations:[]}),
  proposals:()=>({current:()=>null}),changeSetSnapshot:()=>null,executionSnapshot:()=>null,currentAssistantContextFiles:()=>[],currentArtifactSourceFiles:()=>[],currentArtifactSourceOwner:()=>undefined,
  featureCandidates:()=>[],relationshipState:()=>null,sourceInvestigationState:()=>null,investigationContinuationState:()=>null,panel:{webview:panel},assistantView:{webview:assistant},
  historyDeliveries:new WeakMap([[panel,{channels:new Map()}],[assistant,{channels:new Map()}]])});
const sizes=()=>Object.fromEntries(Object.entries(messages).map(([surface,list])=>[surface,Buffer.byteLength(JSON.stringify(list.at(-1)))]));
h.host.sendState();const firstStateBytes=sizes();
h.host.sendState();const unchangedStateBytes=sizes();
for(const list of Object.values(messages)){assert.equal(list.at(-1).history.conversations.records.length,0);assert.equal(list.at(-1).history.runtimeWorkspace.records.length,0);}
await store.startTurn({requestId:'measurement-stream',prompt:'Explain the saved source.',context:[{path:'src/App.tsx',revision:'measured-source',source:'export const fixture = true;'}],model:'synthetic-local'});
h.host.sendState();store.event('measurement-stream',{type:'delta',text:'A synthetic streamed answer.'});
h.host.postAI('measurement-stream',{type:'delta',text:'A synthetic streamed answer.'},{conversationId:store.presentation().snapshot.activeId,store,durable:true});
const streamingMessage=messages.assistant.at(-1);
assert.equal(streamingMessage.type,'ai');assert.equal(streamingMessage.history.conversations.records.length,1);
const report={schemaVersion:1,generatedAt:new Date().toISOString(),scope:'Exact JSON.stringify byte sizes from production sendState/postAI with generated histories. Not Electron wire bytes or native timing.',
  fixture:{conversations:10,retainedTurns:100,retainedRuns:40,retainedObservations:4000,loadedSources:32,loadedSourceBytes:262144},
  firstStateBytes,unchangedStateBytes,streamingAIBytes:Buffer.byteLength(JSON.stringify(streamingMessage)),
  unchangedRecords:{conversations:0,runs:0},streamingChangedTurns:1,
  preservedChecks:{fullRecordsInitially:true,noRecordsForUnchangedHistory:true,onlyChangedTurnDuringStream:true},
  remainingCosts:['Current source payload remains included in state updates.','Durable conversation capacity validation and persistence still serialize complete history.']};
store.event('measurement-stream',{type:'cancelled'});await store.dispose();
const destination=process.env.FOUNDATION_HISTORY_DELIVERY_REPORT || '/private/tmp/foundation-history-delivery-v0.29.json';
await writeFile(destination,`${JSON.stringify(report,null,2)}\n`);process.stdout.write(`${JSON.stringify({destination,...report},null,2)}\n`);
