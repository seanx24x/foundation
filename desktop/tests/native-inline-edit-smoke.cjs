const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const vscode=require('vscode');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(check,label,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){const result=await check();if(result)return result;await pause(100);}throw Error(`Timed out: ${label}`);};

async function run(){
 const workspace=process.env.FOUNDATION_INLINE_EDIT_WORKSPACE,reportPath=process.env.FOUNDATION_INLINE_EDIT_REPORT;
 const extension=vscode.extensions.getExtension('foundation.foundation-workspace');assert.ok(extension);assert.equal(await fs.realpath(extension.extensionPath),process.env.FOUNDATION_INLINE_EDIT_EXTENSION);await extension.activate();assert.ok(process.versions.electron);
 const inspect=()=>extension.exports.inspect();await wait(()=>inspect().project,'Foundation project activation');
 const settings=vscode.workspace.getConfiguration('foundation.ai');assert.equal(settings.get('baseUrl'),'');assert.equal(settings.get('model'),'');assert.deepEqual(settings.get('profiles'),{});assert.match(process.env.FOUNDATION_AI_BASE_URL,/^http:\/\/127\.0\.0\.1:\d+\/v1$/);assert.equal(process.env.FOUNDATION_AI_MODEL,'foundation-local-inline-edit-fixture');for(const key of ['FOUNDATION_AI_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY'])assert.equal(process.env[key],undefined);
 const files=['package.json','src/save.ts','src/unrelated.ts'];const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async name=>[name,createHash('sha256').update(await fs.readFile(path.join(workspace,name))).digest('hex')])));
 let index=0;const ui=async command=>{const id=++index,ipc=process.env.FOUNDATION_INLINE_EDIT_IPC;await fs.writeFile(path.join(ipc,`command-${id}.json`),JSON.stringify(command));const result=await wait(async()=>{try{return JSON.parse(await fs.readFile(path.join(ipc,`result-${id}.json`),'utf8'));}catch{}},'native inline-edit UI');assert.equal(result.passed,true,result.error);return result;};
 const state=()=>inspect().inlineEdit;const ready=async()=>wait(()=>{const current=state();return current?.state==='ready'&&vscode.window.activeTextEditor?.document.uri.scheme==='foundation-inline'&&current;},'reviewable inline edit');
 const initialHashes=await hashes();await vscode.commands.executeCommand('workbench.action.closeAllEditors');
 const document=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace,'src/save.ts')));let editor=await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preview:false});
 assert.equal(await editor.edit(edit=>edit.insert(new vscode.Position(0,0),'// PRIVATE_BUFFER_CONTEXT is an unsaved local draft.\n')),true);
 const originalDraft=document.getText();assert.equal(document.isDirty,true);
 const unrelated=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace,'src/unrelated.ts')));const unrelatedEdit=new vscode.WorkspaceEdit();unrelatedEdit.insert(unrelated.uri,new vscode.Position(0,0),'// PRIVATE_OTHER_DRAFT remains local.\n');assert.equal(await vscode.workspace.applyEdit(unrelatedEdit),true);const unrelatedDraft=unrelated.getText();
 const select=async()=>{editor=await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preview:false});const offset=document.getText().indexOf("return 'Save';");assert.ok(offset>=0);editor.selection=new vscode.Selection(document.positionAt(offset),document.positionAt(offset+"return 'Save';".length));return editor.selection;};
 const preserve=async(expected=originalDraft)=>{assert.equal(document.getText(),expected);assert.equal(document.isDirty,true);assert.equal(unrelated.isDirty,true);assert.equal(unrelated.getText(),unrelatedDraft);assert.deepEqual(await hashes(),initialHashes);assert.equal(inspect().proposal,null);assert.equal(inspect().runtime.status,'idle');assert.equal(inspect().design.status,'idle');};
 const checks=[];
 await select();await ui({type:'start',cancel:true});await preserve();assert.equal((await ui({type:'inspect'})).providerRequests.length,0);checks.push('Cancelling the native prompt sends no provider request and preserves both native drafts.');

 const selection=await select();await ui({type:'start',prompt:'Make the save label explicit.',shortcut:true});const first=await ready();
 const diff=await wait(()=>vscode.window.tabGroups.all.flatMap(group=>group.tabs).map(tab=>tab.input).find(input=>input instanceof vscode.TabInputTextDiff&&input.original.scheme==='foundation-inline'&&input.modified.scheme==='foundation-inline'),'read-only native suggested diff');
 const before=await vscode.workspace.openTextDocument(diff.original),after=await vscode.workspace.openTextDocument(diff.modified);assert.equal(before.getText(),originalDraft);const expected=originalDraft.replace("return 'Save';","return 'Save changes';");assert.equal(after.getText(),expected);await preserve();
 await ui({type:'capture',theme:'dark'});await vscode.workspace.getConfiguration('workbench').update('colorTheme','Foundation Light',vscode.ConfigurationTarget.Global);await wait(()=>vscode.window.activeColorTheme.kind===vscode.ColorThemeKind.Light,'Light native theme');await ui({type:'capture',theme:'light'});await vscode.workspace.getConfiguration('workbench').update('colorTheme','Foundation Dark',vscode.ConfigurationTarget.Global);await wait(()=>vscode.window.activeColorTheme.kind===vscode.ColorThemeKind.Dark,'Dark native theme');
 const disclosed=(await ui({type:'inspect'})).providerRequests;assert.equal(disclosed.length,1);assert.equal(disclosed[0].selection,"return 'Save';");assert.doesNotMatch(JSON.stringify(disclosed),/PRIVATE_/);checks.push('The published Alt+Cmd+E shortcut opens an explicit Generate prompt sharing only selected unsaved text, language and instruction; native read-only diff changes only the selected range.');
 if(process.env.FOUNDATION_INLINE_VISUAL_FIXTURE==='1'){await fs.writeFile(reportPath,JSON.stringify({processId:process.pid,initialHashes,originalDraft,unrelatedDraft,firstSuggestion:first,fixturePrepared:true,visualFixtureOnly:true,checks},null,2));return;}
 await ui({type:'shortcut',id:'foundation.acceptInlineEdit'});await wait(()=>document.getText()===expected,'accepted native buffer edit');await preserve(expected);assert.equal(vscode.window.activeTextEditor.document.uri.toString(),document.uri.toString());
 await vscode.commands.executeCommand('undo');await wait(()=>document.getText()===originalDraft,'one native Undo restores the prior unsaved buffer');await preserve();checks.push('Alt+Cmd+Enter accepts into the native unsaved buffer without saving; one native Undo restores the entire prior draft and leaves unrelated drafts intact.');

 await select();await ui({type:'start',prompt:'Make the save label explicit for dismissal.'});await ready();await ui({type:'shortcut',id:'foundation.dismissInlineEdit'});await wait(()=>vscode.window.activeTextEditor?.document===document,'Escape restores focus to the original source editor');await preserve();assert.equal((await ui({type:'inspect'})).providerRequests.length,2);checks.push('Escape dismisses the preview, restores focus to its original source editor, and leaves both native drafts unchanged.');

 await select();await ui({type:'start',prompt:'Hold this edit for cancellation.'});await wait(async()=>(await ui({type:'inspect'})).providerRequests.length===3,'in-flight delayed selection request');await ui({type:'command',id:'foundation.cancelInlineEdit'});await pause(200);await ui({type:'release'});await pause(200);await preserve();assert.notEqual(state()?.state,'ready');checks.push('Explicit cancellation retires the delayed request; no late suggestion or source write appears.');

 await select();await ui({type:'start',prompt:'Make the save label explicit before a local edit.'});await ready();editor=await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preview:false});assert.equal(await editor.edit(edit=>edit.insert(new vscode.Position(0,0),'// A later local edit invalidates the suggestion.\n')),true);const newerDraft=document.getText();
 // Directly invoke the public command after invalidation as an additional guard
 // check; hidden command-palette state must not be the only protection.
 await vscode.commands.executeCommand('foundation.acceptInlineEdit');await preserve(newerDraft);assert.notEqual(state()?.state,'ready');await vscode.commands.executeCommand('undo');await wait(()=>document.getText()===originalDraft,'Undo only the newer local edit');await preserve();checks.push('A later native edit invalidates the proposal; even a direct public Accept command cannot overwrite it.');
 const finalUI=await ui({type:'inspect'});assert.equal(finalUI.providerRequests.length,4);assert.equal(inspect().conversations.conversations.length,0,'Inline source is ephemeral, outside saved Assistant history');
 await fs.writeFile(reportPath,JSON.stringify({processId:process.pid,initialHashes,originalDraft,unrelatedDraft,selection:{start:selection.start,end:selection.end},firstSuggestion:first,finalInlineState:state(),checks,diskUnchanged:true,nativeDraftsPreserved:true,providerRequests:finalUI.providerRequests},null,2));
}

exports.activate=()=>{
 const workspace=process.env.FOUNDATION_INLINE_EDIT_WORKSPACE,outcome=process.env.FOUNDATION_INLINE_EDIT_OUTCOME,folders=vscode.workspace.workspaceFolders||[];
 assert.equal(folders.length,1);assert.equal(folders[0].uri.fsPath,workspace);assert.ok(workspace.startsWith('/private/tmp/foundation-inline-edit-smoke-'));assert.equal(path.dirname(outcome),path.dirname(workspace));
 setImmediate(async()=>{let result;try{await run();result={passed:true};}catch(error){result={passed:false,error:error.stack||String(error)};}await fs.writeFile(outcome,JSON.stringify(result,null,2));if(process.env.FOUNDATION_INLINE_VISUAL_FIXTURE!=='1'||!result.passed)await vscode.commands.executeCommand('workbench.action.quit');});
};
