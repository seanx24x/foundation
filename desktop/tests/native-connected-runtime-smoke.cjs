const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(check,label,timeout=30000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await check();if(value)return value;await delay(100);}throw new Error(`Timed out: ${label}`);};
exports.activate=()=>{
 const workspace=process.env.FOUNDATION_CONNECTED_WORKSPACE,ready=process.env.FOUNDATION_CONNECTED_READY,outcome=process.env.FOUNDATION_CONNECTED_OUTCOME;
 const folders=vscode.workspace.workspaceFolders||[];
 assert.equal(folders.length,1);assert.equal(folders[0].uri.fsPath,workspace);
 assert.ok(workspace.startsWith('/private/tmp/foundation-connected-native-'));
 assert.equal(path.dirname(outcome),path.dirname(workspace));
 setImmediate(async()=>{
  let result;const checks=[];const keepOpen=process.env.FOUNDATION_CONNECTED_KEEP_OPEN==='1';
  try {
   const extension=vscode.extensions.getExtension('foundation.foundation-workspace');assert.ok(extension);
   assert.equal(await fs.realpath(extension.extensionPath),process.env.FOUNDATION_CONNECTED_EXTENSION);await extension.activate();
   assert.ok(process.versions.electron,'Uses an actual Electron extension host');
   assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('baseUrl'),'');
   checks.push('installed extension identity and disconnected AI');
   await vscode.commands.executeCommand('foundation.refresh');
   await vscode.commands.executeCommand('foundation.openSource','src/App.tsx');
   await vscode.commands.executeCommand('foundation.refresh');
   const initialFocus=extension.exports.inspect();
   assert.equal(initialFocus.focus?.path,'src/App.tsx');
   assert.equal(initialFocus.activeFile?.path,'src/App.tsx');
   assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath,path.join(workspace,'src/App.tsx'));
   checks.push('source focus begins on App.tsx before runtime selection');
   const started=await vscode.commands.executeCommand('foundation.startRunningProject','vite:dev');
   assert.equal(started.status,'connected');assert.equal(started.owned,true);assert.match(started.viewId,/^[a-f0-9]{32}$/);
   checks.push('Electron executable starts instrumented Vite in owned process');
   await wait(()=>extension.exports.inspect().runtime.pageConnected,'native webview iframe heartbeat before external Chromium');
   checks.push('native webview loads the running iframe before external browser interaction');
   await fs.writeFile(ready,JSON.stringify({passed:true,runtime:started,electronVersion:process.versions.electron,executable:process.execPath}));
   const browser=await wait(async()=>{try{return JSON.parse(await fs.readFile(process.env.FOUNDATION_CONNECTED_BROWSER_DONE,'utf8'));}catch{}},'real browser interactions');
   assert.equal(browser.passed,true,browser.error);
   const observed=await wait(()=>{const current=extension.exports.inspect().runtime;return current.selection?.path==='src/components/SaveButton.tsx'&&current.observations.some(item=>item.status===200)&&current.observations.some(item=>item.status===503)&&current;},'native host source and request evidence');
   assert.equal(observed.selection.mapping,'resolved');assert.equal(observed.selection.stale,false);assert.equal(observed.selectionVersion,1);
   assert.ok(observed.observations.every(item=>item.correlation==='unattributed'&&!item.url.includes('?')&&!('headers'in item)&&!('body'in item)));
   checks.push('native host receives exact source mapping and sanitized success/failure evidence');
   const followed=await wait(()=>{const state=extension.exports.inspect();return state.focus?.path==='src/components/SaveButton.tsx'&&state.focus.origin==='runtime'&&state.activeFile?.path==='src/components/SaveButton.tsx'&&state;},'runtime selection changes host focus from App to SaveButton');
   assert.equal(followed.focus.session,started.session);assert.equal(followed.focus.viewId,started.viewId);
   assert.equal(followed.focus.revision,followed.activeFile.revision);
   assert.equal(observed.selection.revision.slice(0,16),followed.activeFile.revision,'Full runtime hash matches the saved source revision prefix');
   checks.push('runtime selection changes host focus from App.tsx to SaveButton.tsx before native navigation');
   await vscode.commands.executeCommand('foundation.build');
   assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath,path.join(workspace,'src/components/SaveButton.tsx'));
   checks.push('runtime selection follows into the native source editor');
   await vscode.commands.executeCommand('foundation.startDesignPreview','src/App.tsx');
   const design=extension.exports.inspect().design;assert.equal(design.compilation,'passed');
   const token=design.tokens.find(item=>item.name==='--orbit-radius');assert.ok(token);
   const filename=path.join(workspace,token.path),before=await fs.readFile(filename,'utf8');
   const impact = await vscode.commands.executeCommand('foundation.designImpact', {action:'analyze',target:{kind:'token',path:token.path,revision:token.revision,name:token.name,occurrence:token.occurrence}});
   assert.equal(impact.status, 'ready', impact.message);
   const proposal = await vscode.commands.executeCommand('foundation.proposeTokenChange', { ...token, value: '12px', impactId: impact.id });
   await vscode.commands.executeCommand('foundation.applyProposal',proposal.id);
   assert.notEqual(await fs.readFile(filename,'utf8'),before);
   await assert.rejects(vscode.commands.executeCommand('foundation.applyProposal',proposal.id));
   await vscode.commands.executeCommand('foundation.undoProposal',proposal.id);
   assert.equal(await fs.readFile(filename,'utf8'),before);
   checks.push('guarded source token Apply and exact Undo in connected fixture');
   if(keepOpen){await vscode.commands.executeCommand('foundation.refine');}
   else {await vscode.commands.executeCommand('foundation.stopRunningProject');assert.equal(extension.exports.inspect().runtime.status,'idle');checks.push('explicit Stop detaches and terminates owned development process');}
   result={passed:true,checks,electronVersion:process.versions.electron,executable:process.execPath,requests:observed.observations.map(({method,url,status,durationMs,outcome})=>({method,url,status,durationMs,outcome})),source:observed.selection.path,revision:observed.selection.revision,focusTransition:{from:initialFocus.focus.path,to:followed.focus.path,origin:followed.focus.origin,sourceRevision:followed.activeFile.revision},ai:'disconnected',runtime:keepOpen?extension.exports.inspect().runtime:undefined};
  }catch(error){
   result={passed:false,checks,error:error.stack||String(error)};try{await vscode.commands.executeCommand('foundation.stopRunningProject');}catch{}
   try{await fs.access(ready);}catch{await fs.writeFile(ready,JSON.stringify(result));}
  }
  await fs.writeFile(outcome,JSON.stringify(result,null,2));
  if(!keepOpen||!result.passed)await vscode.commands.executeCommand('workbench.action.quit');
 });
};
