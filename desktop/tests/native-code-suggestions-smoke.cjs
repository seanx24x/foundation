const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const vscode=require('vscode');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(check,label,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){const result=await check();if(result)return result;await pause(100);}throw Error(`Timed out: ${label}`);};

async function run(){
 const workspace=process.env.FOUNDATION_SUGGESTIONS_WORKSPACE,reportPath=process.env.FOUNDATION_SUGGESTIONS_REPORT;
 const extension=vscode.extensions.getExtension('foundation.foundation-workspace');assert.ok(extension);assert.equal(await fs.realpath(extension.extensionPath),process.env.FOUNDATION_SUGGESTIONS_EXTENSION);await extension.activate();assert.ok(process.versions.electron);
 const inspect=()=>extension.exports.inspect();await wait(()=>inspect().project,'Foundation project activation');
 const state=()=>inspect().codeSuggestions;assert.equal(state().enabled,false);
 const settings=vscode.workspace.getConfiguration('foundation.ai');assert.equal(settings.get('baseUrl'),'');assert.equal(settings.get('model'),'');assert.deepEqual(settings.get('profiles'),{});assert.match(process.env.FOUNDATION_AI_BASE_URL,/^http:\/\/127\.0\.0\.1:\d+\/v1$/);assert.equal(process.env.FOUNDATION_AI_MODEL,'foundation-local-code-suggestions-fixture');for(const key of ['FOUNDATION_AI_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY'])assert.equal(process.env[key],undefined);
 const files=['package.json','src/save.ts','src/unrelated.ts'];const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async name=>[name,createHash('sha256').update(await fs.readFile(path.join(workspace,name))).digest('hex')])));
 let index=0;const ui=async command=>{const id=++index,ipc=process.env.FOUNDATION_SUGGESTIONS_IPC;await fs.writeFile(path.join(ipc,`command-${id}.json`),JSON.stringify(command));const result=await wait(async()=>{try{return JSON.parse(await fs.readFile(path.join(ipc,`result-${id}.json`),'utf8'));}catch{}},'native code-suggestion UI');assert.equal(result.passed,true,`${result.error}\n${JSON.stringify({renderer:result.diagnostic,state:state()})}`);return result;};
 const initialHashes=await hashes();await vscode.commands.executeCommand('workbench.action.closeAllEditors');
 const document=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace,'src/save.ts')));let editor=await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preview:false});
 assert.equal(await editor.edit(edit=>edit.insert(new vscode.Position(0,0),'// PRIVATE_FAR_UNSAVED_DRAFT must remain local.\n')),true);const originalDraft=document.getText();assert.equal(document.isDirty,true);
 const unrelated=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace,'src/unrelated.ts')));const unrelatedEdit=new vscode.WorkspaceEdit();unrelatedEdit.insert(unrelated.uri,new vscode.Position(0,0),'// PRIVATE_OTHER_DRAFT remains local.\n');assert.equal(await vscode.workspace.applyEdit(unrelatedEdit),true);const unrelatedDraft=unrelated.getText();
 const caret=async()=>{editor=await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preview:false});const offset=document.getText().indexOf('  return ')+9;assert.ok(offset>9);const position=document.positionAt(offset);editor.selection=new vscode.Selection(position,position);editor.revealRange(new vscode.Range(position,position),vscode.TextEditorRevealType.InCenter);return offset;};
 const preserve=async(expected)=>{assert.equal(document.getText(),expected);assert.equal(document.isDirty,true);assert.equal(unrelated.isDirty,true);assert.equal(unrelated.getText(),unrelatedDraft);assert.deepEqual(await hashes(),initialHashes);assert.equal(inspect().proposal,null);assert.equal(inspect().runtime.status,'idle');assert.equal(inspect().design.status,'idle');};
 const reset=async()=>{await ui({type:'arm',mode:'none'});await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');editor=await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preview:false});if(document.getText()!==originalDraft){assert.equal(await editor.edit(edit=>edit.replace(new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),originalDraft)),true);}await caret();await pause(400);await preserve(originalDraft);};
 const quoted=()=>originalDraft.replace('  return \n',"  return '\n");
 const beginCompletion=async(mode='completion',text="Save changes';")=>{await reset();await ui({type:'arm',mode});await ui({type:'type',text:"'",waitGhost:text});await preserve(quoted());};
 const noLateGhost=async()=>{await pause(350);const view=await ui({type:'inspect'});assert.doesNotMatch(view.renderer.ghost,/LATE_SUGGESTION/);return view;};
 const held=async()=>{await reset();await ui({type:'arm',mode:'held'});const before=(await ui({type:'inspect'})).providerRequests.length;await ui({type:'type',text:"'"});return await wait(async()=>{const snapshot=await ui({type:'inspect'});return snapshot.providerRequests.slice(before).find(request=>request.mode==='held')&&snapshot;},'in-flight held suggestion');};
 const checks=[];

 await caret();await ui({type:'type',text:"'"});await pause(600);assert.equal((await ui({type:'inspect'})).providerRequests.length,0);await preserve(quoted());await reset();
 await ui({type:'enable',cancel:true});assert.equal(state().enabled,false);assert.equal((await ui({type:'inspect'})).providerRequests.length,0);await preserve(originalDraft);
 checks.push('Opening source, typing while disabled and cancelling the native session disclosure send no provider request.');

 await ui({type:'enable'});await wait(()=>state().enabled,'explicitly enabled suggestion session');assert.equal((await ui({type:'inspect'})).providerRequests.length,0);
 await beginCompletion();const firstSuggestion=state();const firstUI=await ui({type:'inspect'});assert.ok(firstUI.providerRequests.some(request=>request.mode==='completion'));assert.match(firstUI.renderer.ghost,/Save changes/);
 await ui({type:'capture',name:'ghost-dark'});await vscode.workspace.getConfiguration('workbench').update('colorTheme','Foundation Light',vscode.ConfigurationTarget.Global);await wait(()=>vscode.window.activeColorTheme.kind===vscode.ColorThemeKind.Light,'Light native theme');await ui({type:'ghost',text:"Save changes';"});await ui({type:'capture',name:'ghost-light'});await vscode.workspace.getConfiguration('workbench').update('colorTheme','Foundation Dark',vscode.ConfigurationTarget.Global);await wait(()=>vscode.window.activeColorTheme.kind===vscode.ColorThemeKind.Dark,'Dark native theme');
 checks.push('Explicit session disclosure enables automatic requests; actual typing renders a bounded current-file ghost suggestion in both native themes.');
 if(process.env.FOUNDATION_SUGGESTIONS_VISUAL_FIXTURE==='1'){await fs.writeFile(reportPath,JSON.stringify({processId:process.pid,initialHashes,originalDraft,unrelatedDraft,firstSuggestion,fixturePrepared:true,visualFixtureOnly:true,checks},null,2));return;}

 const beforeAccept=quoted(),accepted=beforeAccept.replace("  return '\n","  return 'Save changes';\n");await ui({type:'key',key:'Tab'});await wait(()=>document.getText()===accepted,'native Tab acceptance');await preserve(accepted);
 await vscode.commands.executeCommand('undo');await wait(()=>document.getText()===beforeAccept,'one native Undo restores pre-completion draft');await preserve(beforeAccept);
 checks.push('Native Tab accepts the ghost into the unsaved buffer; one Undo restores the pre-completion draft and preserves unrelated drafts and disk.');

 await beginCompletion();await ui({type:'key',key:'Escape'});await pause(150);const dismissed=await ui({type:'inspect'});assert.equal(dismissed.renderer.ghost,'');await preserve(quoted());
 checks.push('Escape dismisses visible ghost text without applying or saving it.');

 await beginCompletion();await ui({type:'key',key:'Meta+ArrowRight'});await wait(()=>document.getText()!==quoted(),'native next-word acceptance');const partialWord=document.getText();assert.match(partialWord,/return 'Save/);assert.doesNotMatch(partialWord,/return 'Save changes';/);await preserve(partialWord);await ui({type:'ghost',text:'changes'});await vscode.commands.executeCommand('undo');await wait(()=>document.getText()===quoted(),'Undo only accepted next word');await preserve(quoted());
 await beginCompletion('line',"Save';");await vscode.commands.executeCommand('editor.action.inlineSuggest.acceptNextLine');const partialLine=quoted().replace("  return '\n","  return 'Save';\n\n");await wait(()=>document.getText()===partialLine,'native next-line acceptance');assert.doesNotMatch(document.getText(),/The next line remains a suggestion/);await preserve(partialLine);await ui({type:'ghost',text:'The next line remains a suggestion.'});await vscode.commands.executeCommand('undo');await wait(()=>document.getText()===quoted(),'Undo only accepted next line');await preserve(quoted());
 checks.push('Native next-word and next-line acceptance insert only their requested portion; each is undoable without consuming the remaining suggestion.');

 await held();await ui({type:'type',text:'x'});await ui({type:'release'});await noLateGhost();await preserve(quoted().replace("  return '\n","  return 'x\n"));
 await held();await ui({type:'key',key:'ArrowLeft'});await ui({type:'release'});await noLateGhost();await preserve(quoted());
 await held();await ui({type:'command',id:'foundation.stopCodeSuggestions'});await wait(()=>!state().enabled,'stopped suggestion session');const afterStop=(await ui({type:'inspect'})).providerRequests.length;await ui({type:'release'});await ui({type:'type',text:'x'});const stopped=await noLateGhost();assert.equal(stopped.providerRequests.length,afterStop);
 checks.push('Typing, caret movement and Stop retire held requests; late responses never render, and typing after Stop sends nothing.');

 await reset();await ui({type:'enable'});await wait(()=>state().enabled,'second explicit suggestion session');await ui({type:'arm',mode:'edit'});await ui({type:'type',text:"'"});await wait(()=>state().state==='next-edit','nearby edit ready');await preserve(quoted());await ui({type:'status',pattern:'next edit'});
 await ui({type:'command',id:'foundation.reviewNextEdit'});await wait(()=>inspect().inlineEdit?.state==='ready'&&vscode.window.activeTextEditor?.document.uri.scheme==='foundation-inline','next edit native review');
 const diff=await wait(()=>vscode.window.tabGroups.all.flatMap(group=>group.tabs).map(tab=>tab.input).find(input=>input instanceof vscode.TabInputTextDiff&&input.original.scheme==='foundation-inline'&&input.modified.scheme==='foundation-inline'),'read-only next-edit diff');
 const original=await vscode.workspace.openTextDocument(diff.original),proposed=await vscode.workspace.openTextDocument(diff.modified);const beforeNext=quoted(),nextExpected=beforeNext.replace("const message = 'Save';","const message = 'Save changes';");assert.equal(original.getText(),beforeNext);assert.equal(proposed.getText(),nextExpected);await preserve(beforeNext);
 await ui({type:'capture',name:'edit-dark'});await vscode.workspace.getConfiguration('workbench').update('colorTheme','Foundation Light',vscode.ConfigurationTarget.Global);await wait(()=>vscode.window.activeColorTheme.kind===vscode.ColorThemeKind.Light,'Light next-edit review');await ui({type:'capture',name:'edit-light'});await vscode.workspace.getConfiguration('workbench').update('colorTheme','Foundation Dark',vscode.ConfigurationTarget.Global);await wait(()=>vscode.window.activeColorTheme.kind===vscode.ColorThemeKind.Dark,'Dark next-edit review');
 await ui({type:'key',key:'Alt+Meta+Enter'});await wait(()=>document.getText()===nextExpected,'accepted next edit');await preserve(nextExpected);await vscode.commands.executeCommand('undo');await wait(()=>document.getText()===beforeNext,'one native Undo restores next-edit draft');await preserve(beforeNext);
 checks.push('A nearby edit remains a status suggestion until Review opens the exact native diff; explicit acceptance and one Undo preserve all prior and unrelated drafts.');

 await reset();await ui({type:'arm',mode:'edit'});await ui({type:'type',text:"'"});await wait(()=>state().state==='next-edit','next edit before local change');await ui({type:'arm',mode:'none'});await ui({type:'type',text:'x'});await pause(300);await vscode.commands.executeCommand('foundation.reviewNextEdit');assert.notEqual(inspect().inlineEdit?.state,'ready');await preserve(quoted().replace("  return '\n","  return 'x\n"));
 checks.push('A local edit invalidates a pending nearby edit; direct public Review cannot open its stale snapshot.');

 await ui({type:'command',id:'foundation.stopCodeSuggestions'});await wait(()=>!state().enabled,'final stopped session');await reset();await preserve(originalDraft);const finalUI=await ui({type:'inspect'});assert.ok(finalUI.providerRequests.every(request=>!request.fixtureError));assert.equal(inspect().conversations.conversations.length,0,'Suggestions remain outside saved Assistant history');assert.doesNotMatch(JSON.stringify(state()),/PRIVATE_|Save changes|Context boundary filler/);
 await fs.writeFile(reportPath,JSON.stringify({processId:process.pid,initialHashes,originalDraft,unrelatedDraft,firstSuggestion,finalSuggestionsState:state(),checks,diskUnchanged:true,nativeDraftsPreserved:true,providerRequests:finalUI.providerRequests,measurements:finalUI.measurements},null,2));
}

exports.activate=()=>{
 const workspace=process.env.FOUNDATION_SUGGESTIONS_WORKSPACE,outcome=process.env.FOUNDATION_SUGGESTIONS_OUTCOME,folders=vscode.workspace.workspaceFolders||[];
 assert.equal(folders.length,1);assert.equal(folders[0].uri.fsPath,workspace);assert.ok(workspace.startsWith('/private/tmp/foundation-code-suggestions-smoke-'));assert.equal(path.dirname(outcome),path.dirname(workspace));
 setImmediate(async()=>{let result;try{await run();result={passed:true};}catch(error){result={passed:false,error:error.stack||String(error)};}await fs.writeFile(outcome,JSON.stringify(result,null,2));if(process.env.FOUNDATION_SUGGESTIONS_VISUAL_FIXTURE!=='1'||!result.passed)await vscode.commands.executeCommand('workbench.action.quit');});
};
