import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer as createNetServer} from 'node:net';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,realpath,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.length>2)throw Error('Usage: node desktop/scripts/inline-edit-smoke.mjs (packaged app only)');
if(process.env.FOUNDATION_INLINE_VISUAL_FIXTURE!==undefined&&process.env.FOUNDATION_INLINE_VISUAL_FIXTURE!=='1')throw Error('FOUNDATION_INLINE_VISUAL_FIXTURE only supports 1');
const visualFixtureOnly=process.env.FOUNDATION_INLINE_VISUAL_FIXTURE==='1';
const app=await realpath(process.env.FOUNDATION_APP_PATH||path.join(desktop,'.build/Foundation.app'));
const extensionPath=await realpath(path.join(app,'Contents/Resources/app/extensions/foundation-workspace'));
const manifest=JSON.parse(await readFile(path.join(extensionPath,'package.json'),'utf8'));
const commandTitle=id=>{const item=manifest.contributes.commands.find(command=>command.command===id);assert.ok(item,`Missing contributed ${id}`);return `${item.category}: ${item.title}`;};
const temp=await realpath(await mkdtemp('/private/tmp/foundation-inline-edit-smoke-'));
const workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions'),harness=path.join(extensions,'foundation-test.inline-edit-native-check-1.0.0'),reportPath=path.join(temp,'report.json'),ipc=path.join(temp,'ipc'),outcome=path.join(temp,'outcome.json');
await Promise.all([mkdir(path.join(workspace,'src'),{recursive:true}),mkdir(path.join(userData,'User'),{recursive:true}),mkdir(harness,{recursive:true}),mkdir(ipc)]);
const fixture={
 'package.json':JSON.stringify({name:'foundation-inline-edit-fixture',private:true,type:'module'}),
 'src/save.ts':"// PRIVATE_SAVED_CONTEXT must remain local.\nexport function label() {\n  return 'Save';\n}\n",
 'src/unrelated.ts':"export const unrelated = 'PRIVATE_OTHER_FILE';\n",
};
await Promise.all(Object.entries(fixture).map(([name,value])=>writeFile(path.join(workspace,name),value)));
await Promise.all([
 writeFile(path.join(userData,'User/settings.json'),JSON.stringify({'foundation.openOnStartup':false,'foundation.ai.baseUrl':'','foundation.ai.model':'','foundation.ai.profiles':{},'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never','security.workspace.trust.enabled':false,'files.hotExit':'onExitAndWindowClose','files.autoSave':'off','workbench.editor.enablePreview':false,'workbench.colorTheme':'Foundation Dark'})),
 writeFile(path.join(harness,'package.json'),JSON.stringify({name:'inline-edit-native-check',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),
 writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-inline-edit-smoke.cjs'))),
]);
const providerRequests=[],closedProviderRequests=[],heldResponses=new Map();
const provider=createServer(async(req,res)=>{
 try{
  assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,undefined);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const payload=JSON.parse(Buffer.concat(chunks)),input=JSON.parse(payload.messages[1].content);
  assert.equal(payload.model,'foundation-local-inline-edit-fixture');assert.equal(payload.tools,undefined);
  assert.deepEqual(Object.keys(input).sort(),['languageId','prompt','selection']);assert.equal(input.selection,"return 'Save';");assert.equal(input.languageId,'typescript');
  assert.doesNotMatch(JSON.stringify(payload),/PRIVATE_SAVED_CONTEXT|PRIVATE_BUFFER_CONTEXT|PRIVATE_OTHER_FILE|PRIVATE_OTHER_DRAFT|foundation-inline-edit-smoke|src\/save\.ts|sourceRevision|documentVersion/);
  const index=providerRequests.length;providerRequests.push({selection:input.selection,languageId:input.languageId,prompt:input.prompt});
  res.once('close',()=>{closedProviderRequests.push(index);heldResponses.delete(index);});
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const complete=()=>{if(!res.destroyed)res.end(`data: ${JSON.stringify({model:payload.model,choices:[{delta:{content:JSON.stringify({replacement:"return 'Save changes';",summary:'Make the action label more explicit.'})},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:9,total_tokens:21}})}\n\ndata: [DONE]\n\n`);};
  if(input.prompt==='Hold this edit for cancellation.') {res.write(': waiting for explicit cancellation\n\n');heldResponses.set(index,complete);} else complete();
 }catch(error){if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Local inline-edit fixture rejected this request.'}));providerRequests.push({fixtureError:error.message});}
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
const providerURL=`http://127.0.0.1:${provider.address().port}/v1`;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const readJSON=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return undefined;}};
const wait=async(check,label,timeout=25000)=>{const deadline=Date.now()+timeout;let lastError;while(Date.now()<deadline){try{const value=await check();if(value)return value;}catch(error){lastError=error;}await pause(100);}throw Error(`Timed out: ${label}${lastError?` (${lastError.message})`:''}`);};
const portServer=createNetServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
const environment={...process.env,FOUNDATION_INLINE_EDIT_OUTCOME:outcome,FOUNDATION_INLINE_EDIT_REPORT:reportPath,FOUNDATION_INLINE_EDIT_IPC:ipc,FOUNDATION_INLINE_EDIT_EXTENSION:extensionPath,FOUNDATION_INLINE_EDIT_WORKSPACE:workspace};
for(const key of Object.keys(environment))if(key==='ELECTRON_RUN_AS_NODE'||/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key))delete environment[key];
Object.assign(environment,{FOUNDATION_AI_BASE_URL:providerURL,FOUNDATION_AI_MODEL:'foundation-local-inline-edit-fixture',FOUNDATION_AI_PROVIDER_KIND:'compatible'});
let browser,child,exited=false,exitCode,spawnError;const interactions=[];
const observe=async page=>page.evaluate(()=>({quickInput:[...document.querySelectorAll('.quick-input-widget')].find(element=>element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden')?.innerText??null,status:document.querySelector('.statusbar')?.innerText??null}));
// Public native command palette and QuickInput only. The driver does not call
// private handlers, inject extension messages, or manufacture proposal state.
const command=async(page,id)=>{
 const title=commandTitle(id);await page.keyboard.press('Meta+Shift+P');
 const input=page.locator('.quick-input-widget input').filter({visible:true});await input.waitFor({state:'visible'});
 await input.focus();await page.keyboard.press('Meta+A');await page.keyboard.insertText(`>${title}`);
 try { await wait(async()=>{const text=await page.locator('.quick-input-list').innerText();return text.includes(title);},`command palette offers ${title}`,4000); } catch(error) { const details={title,input:await input.inputValue(),palette:await page.locator('.quick-input-widget').innerText()}; interactions.push({type:'commandFailure',details}); throw Error(error.message+'; observed '+JSON.stringify(details)); }
 const before=await observe(page);await page.keyboard.press('Enter');interactions.push({type:'command',id,title,before});
};
const shortcut=async(page,id)=>{const keys={'foundation.editSelection':'Alt+Meta+e','foundation.acceptInlineEdit':'Alt+Meta+Enter','foundation.dismissInlineEdit':'Escape'};assert.ok(keys[id]);const before=await observe(page);await page.keyboard.press(keys[id]);interactions.push({type:'shortcut',id,keys:keys[id],before});};
const prompt=async(page,text,cancel=false)=>{
 const widget=page.locator('.quick-input-widget').filter({visible:true});await wait(async()=>{const content=await widget.innerText();return content.includes('Edit selection');},'native Edit selection input');
 const input=widget.locator('input').filter({visible:true});const disclosure=await widget.innerText();assert.match(disclosure,/selection/i);assert.match(disclosure,/foundation-local-inline-edit-fixture/);
 if(cancel)await page.keyboard.press('Escape');else{await input.focus();await page.keyboard.insertText(text);await page.keyboard.press('Enter');}
 interactions.push({type:'prompt',cancel,disclosure,prompt:cancel?undefined:text});
};
try{
 const log=await open(path.join(temp,'native.log'),'w');
 child=spawn(path.join(app,'Contents/MacOS/Foundation'),[workspace,'--new-window','--user-data-dir',userData,'--shared-data-dir',path.join(temp,'shared-data'),'--extensions-dir',extensions,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--disable-crash-reporter','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{env:environment,stdio:['ignore',log.fd,log.fd]});await log.close();
 child.once('exit',code=>{exited=true;exitCode=code;});child.once('error',error=>{exited=true;spawnError=error;});
 const deadline=Date.now()+180000;let commandIndex=1,result;
 while(!(result=await readJSON(outcome))){
  if(spawnError)throw spawnError;if(exited)throw Error(`App exited before reporting. See ${temp}`);if(Date.now()>deadline)throw Error(`Native inline check timed out. See ${temp}`);
  const request=await readJSON(path.join(ipc,`command-${commandIndex}.json`));if(!request){await pause(100);continue;}
  let answer;
  try{
   if(!browser)browser=await wait(()=>chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000}),'isolated native renderer endpoint');
   const page=await wait(()=>browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith('vscode-file:')),'native workbench page');
   if(request.type==='start'){await (request.shortcut?shortcut:command)(page,'foundation.editSelection');await prompt(page,request.prompt,request.cancel===true);}
   else if(request.type==='shortcut'){await shortcut(page,request.id);}
   else if(request.type==='command'){assert.ok(['foundation.acceptInlineEdit','foundation.dismissInlineEdit','foundation.reviewInlineEdit','foundation.cancelInlineEdit'].includes(request.id));await command(page,request.id);}
   else if(request.type==='capture'){assert.ok(['dark','light'].includes(request.theme));await page.getByText('Editing selected code',{exact:true}).first().waitFor({state:'hidden',timeout:5000});await page.screenshot({path:path.join(temp,`inline-edit-${request.theme}.png`)});}
   else if(request.type==='release'){for(const release of [...heldResponses.values()])release();}
   else assert.equal(request.type,'inspect');
   answer={passed:true,renderer:await observe(page),providerRequests:[...providerRequests],closedProviderRequests:[...closedProviderRequests]};
  }catch(error){answer={passed:false,error:error.stack||String(error)};}
  await writeFile(path.join(ipc,`result-${commandIndex}.json`),JSON.stringify(answer));commandIndex++;
 }
 assert.equal(result.passed,true,`${result.error||'Failed native check'}. See ${temp}`);
 if(!visualFixtureOnly){while(!exited&&Date.now()<deadline)await pause(100);assert.equal(exited,true);assert.equal(exitCode,0);}assert.equal(providerRequests.length,visualFixtureOnly?1:4);assert.ok(providerRequests.every(request=>!request.fixtureError));
 const report={...await readJSON(reportPath),...(visualFixtureOnly?{fixturePrepared:true,visualFixtureOnly:true}:{passed:true}),mode:'packaged',app,extensionPath,workspace,temp,provider:'loopback compatible protocol fixture; environment only, no credentials',providerRequests,closedProviderRequests,interactions,nativeVisualAcceptance:'Not performed by this automated check'};
 await writeFile(path.join(desktop,'.build',visualFixtureOnly?'native-inline-edit-visual-fixture-report.json':'native-inline-edit-smoke-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...(visualFixtureOnly?{fixturePrepared:true,visualFixtureOnly:true}:{passed:true}),temp,providerRequests:providerRequests.length,checks:report.checks},null,2));
 if(visualFixtureOnly){const reviewDeadline=Date.now()+600000;while(!exited&&Date.now()<reviewDeadline)await pause(1000);if(!exited)throw Error('Manual visual fixture timed out after ten minutes.');}
}finally{
 if(child&&!exited)child.kill('SIGTERM');await browser?.close().catch(()=>{});await writeFile(path.join(temp,'interactions.json'),JSON.stringify(interactions,null,2));await writeFile(path.join(temp,'mock-provider-requests.json'),JSON.stringify(providerRequests,null,2));provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));
}
