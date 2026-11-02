const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const{createHash}=require('node:crypto');
const vscode=require('vscode');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(check,label,timeout=60000)=>{const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await pause(100);}throw Error(`Timed out: ${label}`);};
const files=['package.json','src/label.mjs','src/api.mjs','src/Draft.ts'];
const canonicalHistory=history=>history.map(chat=>({...chat,turns:chat.turns.map(turn=>({...turn,completedWhileStopping:turn.completedWhileStopping===true}))}));
const initialPrompt='Explain the selected saved label and API.';
const revisedPrompt='Focus only on the saved API return value and cite its source.';
const unsentPrompt='Unsent revision: explain how a caller would use this result.';
async function run(){
 const stage=process.env.FOUNDATION_REVISION_STAGE,workspace=process.env.FOUNDATION_REVISION_WORKSPACE,reportPath=process.env.FOUNDATION_REVISION_REPORT;
 const extension=vscode.extensions.getExtension('foundation.foundation-workspace');assert.ok(extension);assert.equal(await fs.realpath(extension.extensionPath),process.env.FOUNDATION_REVISION_EXTENSION);await extension.activate();assert.ok(process.versions.electron);
 const inspect=()=>extension.exports.inspect();await wait(()=>inspect().project&&inspect().conversations,'Foundation project activation');
 const settings=vscode.workspace.getConfiguration('foundation.ai');assert.equal(settings.get('baseUrl'),'');assert.equal(settings.get('model'),'');assert.deepEqual(settings.get('profiles'),{});
 assert.match(process.env.FOUNDATION_AI_BASE_URL,/^http:\/\/127\.0\.0\.1:\d+\/v1$/);assert.equal(process.env.FOUNDATION_AI_MODEL,'foundation-local-revision-fixture');assert.equal(process.env.FOUNDATION_AI_API_KEY,undefined);assert.equal(process.env.OPENAI_API_KEY,undefined);assert.equal(process.env.ANTHROPIC_API_KEY,undefined);
 const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async name=>[name,createHash('sha256').update(await fs.readFile(path.join(workspace,name))).digest('hex')])));
 const turns=()=>inspect().conversations.conversations.find(chat=>chat.id===inspect().conversations.activeId)?.turns||[];
 let commandIndex=0;const ui=async command=>{const index=++commandIndex,ipc=process.env.FOUNDATION_REVISION_IPC;await fs.writeFile(path.join(ipc,`command-${index}.json`),JSON.stringify(command));const result=await wait(async()=>{try{return JSON.parse(await fs.readFile(path.join(ipc,`result-${index}.json`),'utf8'));}catch{}},'native request revision interaction',90000);assert.equal(result.passed,true,result.error);return result;};
 const noSideEffects=()=>{assert.equal(inspect().runtime.status,'idle');assert.equal(inspect().design.status,'idle');assert.equal(inspect().proposal??null,null);assert.equal(inspect().changeSetSession?.current??null,null);assert.equal(inspect().executionSession?.current??null,null);};
 if(stage==='write'){
  const originalHashes=await hashes();await vscode.commands.executeCommand('workbench.action.closeAllEditors');await vscode.commands.executeCommand('foundation.understand');await vscode.commands.executeCommand('vscode.setEditorLayout',{orientation:0,groups:[{size:.5},{size:.5}]});
  for(const name of ['src/label.mjs','src/api.mjs']){const source=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace,name)));await vscode.window.showTextDocument(source,{viewColumn:vscode.ViewColumn.Two,preview:false});}
  const draft=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace,'src/Draft.ts')));await vscode.window.showTextDocument(draft,{viewColumn:vscode.ViewColumn.Two,preview:false});const edit=new vscode.WorkspaceEdit();edit.insert(draft.uri,new vscode.Position(0,0),'// Unshared native draft stays unsaved during revision.\n');assert.equal(await vscode.workspace.applyEdit(edit),true);const draftText=draft.getText();
  await vscode.commands.executeCommand('foundation.refresh');await vscode.commands.executeCommand('foundation.askAI');
  await ui({type:'compose',question:initialPrompt,paths:['src/label.mjs','src/api.mjs']});
  const live=await wait(()=>{const turn=turns()[0];return turn?.state==='running'&&turn.answer.includes('FOUNDATION_ORIGINAL_PARTIAL')&&turn;},'live streamed partial answer');
  await ui({type:'revisionAction',requestId:live.requestId,label:'Stop and revise'});
  const parent=await wait(()=>{const turn=turns()[0];return turn?.state==='stopped'&&inspect().conversations.storage.status==='saved'&&turn;},'durably stopped parent');
  assert.equal(parent.question,initialPrompt);assert.match(parent.answer,/FOUNDATION_ORIGINAL_PARTIAL/);assert.equal(parent.requestRevision,undefined);
  const prepared=await wait(async()=>{const value=await ui({type:'inspect'});return value.renderer.prepared&&value.renderer.question===initialPrompt&&value;},'prepared stopped-request draft');
  assert.equal(prepared.providerRequests,1);assert.deepEqual(prepared.renderer.paths,['src/api.mjs','src/label.mjs']);assert.match(prepared.renderer.prepared,/Previous output is not included/);assert.deepEqual(await hashes(),originalHashes);noSideEffects();
  await ui({type:'compose',question:revisedPrompt});
  const revision=await wait(()=>{const turn=turns()[1];if(turn&&['failed','stopped','interrupted'].includes(turn.state))throw Error(`Revision failed: ${JSON.stringify(turn)}`);return turn?.state==='complete'&&inspect().conversations.storage.status==='saved'&&turn;},'explicit revised request');
  assert.notEqual(revision.requestId,parent.requestId);assert.equal(revision.question,revisedPrompt);assert.equal(revision.intent,parent.intent);assert.deepEqual(revision.context,parent.context);assert.deepEqual(revision.requestRevision,{version:1,conversationId:inspect().conversations.activeId,requestId:parent.requestId});assert.deepEqual(turns()[0],parent);assert.match(revision.answer,/FOUNDATION_REVISED_COMPLETE/);
  const completed=await ui({type:'inspect'});assert.equal(completed.providerRequests,2);assert.ok(completed.closedProviderRequests.includes(1),'The first local provider stream disconnected before completion');
  await ui({type:'revisionAction',requestId:revision.requestId,label:'Revise request'});
  await wait(async()=>{const value=await ui({type:'inspect'});return value.renderer.prepared&&value.renderer.question===revisedPrompt;},'completed-request draft');
  const rendered=await ui({type:'draft',question:unsentPrompt});assert.equal(rendered.providerRequests,2);assert.equal(rendered.renderer.question,unsentPrompt);assert.ok(rendered.renderer.prepared);assert.equal(turns().length,2);assert.deepEqual(await hashes(),originalHashes);assert.equal(draft.isDirty,true);assert.equal(draft.getText(),draftText);noSideEffects();
  await vscode.window.showTextDocument(draft,{viewColumn:vscode.ViewColumn.Two,preview:false});
  await fs.writeFile(reportPath,JSON.stringify({writeProcessId:process.pid,originalHashes,draftText,parent,revision,history:inspect().conversations.conversations,activeId:inspect().conversations.activeId,unsentPrompt,renderedBefore:rendered.renderer,checks:['Actual Ask streamed a partial response from a local mock provider.','Stop and revise cancelled the owned stream, preserved its exact partial response, and prepared the original prompt without a second provider call.','Explicit Send created a distinct request with local lineage and the identical ordered saved-source context.','The provider received only the revised prompt and chosen source; original output and lineage were not transmitted.','Revise request prepared another draft; editing it remained unsent while source, checkpoints, tools and an unrelated unsaved native draft stayed unchanged.']}));
 }else{
  const prior=JSON.parse(await fs.readFile(reportPath,'utf8'));assert.notEqual(process.pid,prior.writeProcessId);await wait(()=>turns().length===2&&inspect().conversations.storage.status==='saved','restored lineage history');assert.equal(inspect().conversations.activeId,prior.activeId);assert.deepEqual(canonicalHistory(inspect().conversations.conversations),canonicalHistory(prior.history));assert.deepEqual(await hashes(),prior.originalHashes);
  const draft=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace,'src/Draft.ts')));assert.equal(draft.isDirty,true);assert.equal(draft.getText(),prior.draftText);noSideEffects();await vscode.commands.executeCommand('foundation.askAI');
  const restored=await wait(async()=>{const value=await ui({type:'inspect'});return value.renderer.prepared&&value.renderer.question===prior.unsentPrompt&&value.renderer.paths.length===2&&value;},'restored unsent revision composer');
  assert.equal(restored.providerRequests,2);assert.deepEqual(restored.renderer.paths,['src/api.mjs','src/label.mjs']);assert.match(restored.renderer.prepared,/Previous output is not included/);assert.equal(turns().length,2);assert.equal(turns()[0].state,'stopped');assert.equal(turns()[1].state,'complete');
  await fs.writeFile(reportPath,JSON.stringify({...prior,restoreProcessId:process.pid,restoredInSecondProcess:true,renderedAfter:restored.renderer,restoreChecks:['A distinct normal native process restored exact parent/child history and local request lineage.','The latest prepared revision and edited unsent composer draft restored with the same source selection.','Restart sent no provider request, resumed no execution and preserved all saved bytes and the unrelated unsaved draft.']}));
 }
}
exports.activate=()=>{const stage=process.env.FOUNDATION_REVISION_STAGE,workspace=process.env.FOUNDATION_REVISION_WORKSPACE,outcome=process.env.FOUNDATION_REVISION_OUTCOME;assert.ok(['write','restore'].includes(stage));const folders=vscode.workspace.workspaceFolders||[];assert.equal(folders.length,1);assert.equal(folders[0].uri.fsPath,workspace);assert.ok(workspace.startsWith('/private/tmp/foundation-request-revision-smoke-'));assert.equal(path.dirname(outcome),path.dirname(workspace));setImmediate(async()=>{let result;try{await run();result={stage,passed:true};}catch(error){result={stage,passed:false,error:error.stack||String(error)};}await fs.writeFile(outcome,JSON.stringify(result,null,2));await vscode.commands.executeCommand('workbench.action.quit');});};
