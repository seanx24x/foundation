import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer as createNetServer} from 'node:net';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,realpath,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {chromium} from '@playwright/test';

const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.length>2)throw Error('Usage: node desktop/scripts/code-suggestions-smoke.mjs (packaged app only)');
if(process.env.FOUNDATION_SUGGESTIONS_VISUAL_FIXTURE!==undefined&&process.env.FOUNDATION_SUGGESTIONS_VISUAL_FIXTURE!=='1')throw Error('FOUNDATION_SUGGESTIONS_VISUAL_FIXTURE only supports 1');
const visualFixtureOnly=process.env.FOUNDATION_SUGGESTIONS_VISUAL_FIXTURE==='1';
const app=await realpath(process.env.FOUNDATION_APP_PATH||path.join(desktop,'.build/Foundation.app'));
const extensionPath=await realpath(path.join(app,'Contents/Resources/app/extensions/foundation-workspace'));
const manifest=JSON.parse(await readFile(path.join(extensionPath,'package.json'),'utf8'));
const commandTitle=id=>{const item=manifest.contributes.commands.find(command=>command.command===id);assert.ok(item,`Missing contributed ${id}`);return `${item.category}: ${item.title}`;};
const temp=await realpath(await mkdtemp('/private/tmp/foundation-code-suggestions-smoke-'));
const workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions'),harness=path.join(extensions,'foundation-test.code-suggestions-native-check-1.0.0'),reportPath=path.join(temp,'report.json'),ipc=path.join(temp,'ipc'),outcome=path.join(temp,'outcome.json');
await Promise.all([mkdir(path.join(workspace,'src'),{recursive:true}),mkdir(path.join(userData,'User'),{recursive:true}),mkdir(harness,{recursive:true}),mkdir(ipc)]);
const padding=Array.from({length:220},(_,i)=>`// Context boundary filler ${String(i).padStart(3,'0')} ${'abcdefghijklmnopqrstuvwxyz '.repeat(3)}\n`).join('');
const fixture={
 'package.json':JSON.stringify({name:'foundation-code-suggestions-fixture',private:true,type:'module'}),
 'src/save.ts':`// PRIVATE_FAR_SAVED_HEAD must remain local.\n${padding}// Bounded completion fixture.\nexport function label() {\n  const message = 'Save';\n  return \n}\n${padding}// PRIVATE_FAR_SAVED_TAIL must remain local.\n`,
 'src/unrelated.ts':"export const unrelated = 'PRIVATE_OTHER_FILE';\n",
};
await Promise.all(Object.entries(fixture).map(([name,value])=>writeFile(path.join(workspace,name),value)));
await Promise.all([
 writeFile(path.join(userData,'User/settings.json'),JSON.stringify({'foundation.openOnStartup':false,'foundation.ai.baseUrl':'','foundation.ai.model':'','foundation.ai.profiles':{},'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never','window.dialogStyle':'custom','security.workspace.trust.enabled':false,'files.hotExit':'onExitAndWindowClose','files.autoSave':'off','workbench.editor.enablePreview':false,'workbench.colorTheme':'Foundation Dark','editor.inlineSuggest.enabled':true,'editor.quickSuggestions':false,'editor.suggestOnTriggerCharacters':false,'editor.autoClosingQuotes':'never','editor.autoClosingBrackets':'never','editor.acceptSuggestionOnEnter':'off','editor.accessibilitySupport':'off'})),
 writeFile(path.join(harness,'package.json'),JSON.stringify({name:'code-suggestions-native-check',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),
 writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-code-suggestions-smoke.cjs'))),
]);

let providerMode='none';
const providerRequests=[],closedProviderRequests=[],heldResponses=new Map(),measurements=[];
const provider=createServer(async(req,res)=>{
 try{
  assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,undefined);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const payload=JSON.parse(Buffer.concat(chunks)),input=JSON.parse(payload.messages[1].content);
  assert.equal(payload.model,'foundation-local-code-suggestions-fixture');assert.equal(payload.tools,undefined);
  assert.deepEqual(Object.keys(input).sort(),['languageId','prefix','suffix']);assert.equal(input.languageId,'typescript');
  assert.equal(typeof input.prefix,'string');assert.equal(typeof input.suffix,'string');
  assert.ok(Buffer.byteLength(input.prefix)+Buffer.byteLength(input.suffix)<=12*1024);
  assert.doesNotMatch(JSON.stringify(payload),/PRIVATE_FAR_|PRIVATE_OTHER_|foundation-code-suggestions-smoke|src\/save\.ts|sourceRevision|documentVersion/);
  const matching=input.prefix.endsWith("  return '");
  const mode=matching?providerMode:'none',index=providerRequests.length;
  const record={index,mode,prefix:input.prefix,suffix:input.suffix,languageId:input.languageId,receivedAtMs:performance.now(),contextBytes:Buffer.byteLength(input.prefix)+Buffer.byteLength(input.suffix)};
  providerRequests.push(record);
  res.once('close',()=>{closedProviderRequests.push(index);heldResponses.delete(index);});
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const result=mode==='completion'?{kind:'completion',text:"Save changes';"}:mode==='line'?{kind:'completion',text:"Save';\n  // The next line remains a suggestion."}:mode==='held'?{kind:'completion',text:"LATE_SUGGESTION_MUST_NOT_APPEAR';"}:mode==='edit'?{kind:'edit',oldText:"const message = 'Save';",newText:"const message = 'Save changes';",summary:'Make the nearby action label explicit.'}:{kind:'none'};
  const complete=()=>{if(!res.destroyed){record.respondedAtMs=performance.now();res.end(`data: ${JSON.stringify({model:payload.model,choices:[{delta:{content:JSON.stringify(result)},finish_reason:'stop'}],usage:{prompt_tokens:40,completion_tokens:12,total_tokens:52}})}\n\ndata: [DONE]\n\n`);}};
  if(mode==='held'){res.write(': waiting for cancellation\n\n');heldResponses.set(index,complete);}else complete();
 }catch(error){if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Local code-suggestion fixture rejected this request.'}));providerRequests.push({fixtureError:error.message});}
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
const providerURL=`http://127.0.0.1:${provider.address().port}/v1`;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const readJSON=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return undefined;}};
const wait=async(check,label,timeout=25000)=>{const deadline=Date.now()+timeout;let lastError;while(Date.now()<deadline){try{const value=await check();if(value)return value;}catch(error){lastError=error;}await pause(50);}throw Error(`Timed out: ${label}${lastError?` (${lastError.message})`:''}`);};
const portServer=createNetServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
const environment={...process.env,FOUNDATION_SUGGESTIONS_OUTCOME:outcome,FOUNDATION_SUGGESTIONS_REPORT:reportPath,FOUNDATION_SUGGESTIONS_IPC:ipc,FOUNDATION_SUGGESTIONS_EXTENSION:extensionPath,FOUNDATION_SUGGESTIONS_WORKSPACE:workspace};
for(const key of Object.keys(environment))if(key==='ELECTRON_RUN_AS_NODE'||/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key))delete environment[key];
Object.assign(environment,{FOUNDATION_AI_BASE_URL:providerURL,FOUNDATION_AI_MODEL:'foundation-local-code-suggestions-fixture',FOUNDATION_AI_PROVIDER_KIND:'compatible'});
let browser,child,exited=false,exitCode,spawnError;
const interactions=[];
const observe=async page=>page.evaluate(()=>{
 const visible=element=>element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden';
 return {quickInput:[...document.querySelectorAll('.quick-input-widget')].find(visible)?.innerText??null,status:document.querySelector('.statusbar')?.innerText??null,dialog:[...document.querySelectorAll('.monaco-dialog-box')].filter(visible).map(element=>element.innerText).join('\n'),ghost:[...document.querySelectorAll('.ghost-text-decoration,.ghost-text-decoration-preview,.ghost-text')].filter(visible).map(element=>element.textContent).join('').replace(/\u00a0/g,' ')};
});
// Only native public commands and normal keyboard input are used to accept or
// dismiss suggestions. No private handlers or extension messages are injected.
const command=async(page,id)=>{
 const title=commandTitle(id);await page.keyboard.press('Meta+Shift+P');
 const input=page.locator('.quick-input-widget input').filter({visible:true});await input.waitFor({state:'visible'});
 await input.focus();await page.keyboard.press('Meta+A');await page.keyboard.insertText(`>${title}`);
 await wait(async()=>{const text=await page.locator('.quick-input-list').innerText();return text.includes(title);},`command palette offers ${title}`,5000);
 const before=await observe(page);await page.keyboard.press('Enter');interactions.push({type:'command',id,title,before});
};
const enable=async(page,cancel)=>{
 await command(page,'foundation.startCodeSuggestions');
 const dialog=page.locator('.monaco-dialog-box').filter({visible:true});await dialog.waitFor({state:'visible',timeout:5000});
 const disclosure=await dialog.innerText();assert.match(disclosure,/suggestions/i);assert.match(disclosure,/foundation-local-code-suggestions-fixture/);assert.match(disclosure,/unsaved/i);
 if(cancel)await page.keyboard.press('Escape');else await dialog.getByRole('button',{name:'Start suggestions',exact:true}).click();
 await dialog.waitFor({state:'hidden',timeout:5000});interactions.push({type:'enable-disclosure',cancel,disclosure});
};
const waitGhost=async(page,text)=>{
 const found=await wait(async()=>{const view=await observe(page);return view.ghost.includes(text)&&view;},`visible native ghost text ${text}`);
 const observedAtMs=performance.now(),request=[...providerRequests].reverse().find(record=>record.mode==='completion'||record.mode==='line');
 if(request&&!measurements.some(sample=>sample.requestIndex===request.index)){measurements.push({name:'loopback request arrival to renderer-observed ghost',unit:'ms',requestIndex:request.index,value:observedAtMs-request.receivedAtMs,providerDurationMs:request.respondedAtMs-request.receivedAtMs,limitations:'Same driver monotonic clock, 50 ms renderer polling, warm isolated fixture and loopback provider. Includes extension/renderer scheduling; excludes physical input dispatch, compositor paint and production-provider latency.'});}
 return found;
};
try{
 const log=await open(path.join(temp,'native.log'),'w');
 child=spawn(path.join(app,'Contents/MacOS/Foundation'),[workspace,'--new-window','--user-data-dir',userData,'--shared-data-dir',path.join(temp,'shared-data'),'--extensions-dir',extensions,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--disable-crash-reporter','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{env:environment,stdio:['ignore',log.fd,log.fd]});await log.close();
 child.once('exit',code=>{exited=true;exitCode=code;});child.once('error',error=>{exited=true;spawnError=error;});
 const deadline=Date.now()+240000;let commandIndex=1,result;
 while(!(result=await readJSON(outcome))){
  if(spawnError)throw spawnError;if(exited)throw Error(`App exited before reporting. See ${temp}`);if(Date.now()>deadline)throw Error(`Native suggestions check timed out. See ${temp}`);
  const request=await readJSON(path.join(ipc,`command-${commandIndex}.json`));if(!request){await pause(50);continue;}
  let answer;
  try{
   if(!browser)browser=await wait(()=>chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000}),'isolated native renderer endpoint');
   const page=await wait(()=>browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith('vscode-file:')),'native workbench page');
   if(request.type==='enable')await enable(page,request.cancel===true);
   else if(request.type==='command'){assert.ok(['foundation.stopCodeSuggestions','foundation.requestCodeSuggestion','foundation.reviewNextEdit','foundation.dismissNextEdit','foundation.acceptInlineEdit','foundation.dismissInlineEdit'].includes(request.id));await command(page,request.id);}
   else if(request.type==='type'){const startedAtMs=performance.now();await page.keyboard.insertText(request.text);if(request.waitGhost)await waitGhost(page,request.waitGhost);interactions.push({type:'typing',text:request.text,startedAtMs,finishedAtMs:performance.now()});}
   else if(request.type==='key'){assert.ok(['Tab','Escape','Meta+ArrowRight','ArrowLeft','ArrowRight','Alt+Meta+Enter'].includes(request.key));await page.keyboard.press(request.key);interactions.push({type:'key',key:request.key});}
   else if(request.type==='ghost')await waitGhost(page,request.text);
   else if(request.type==='status')await wait(async()=>new RegExp(request.pattern,'i').test((await observe(page)).status),'native suggestion status');
   else if(request.type==='arm'){assert.ok(['none','completion','line','held','edit'].includes(request.mode));providerMode=request.mode;}
   else if(request.type==='capture'){assert.ok(['ghost-dark','ghost-light','edit-dark','edit-light'].includes(request.name));await page.screenshot({path:path.join(temp,`code-suggestions-${request.name}.png`)});}
   else if(request.type==='release'){for(const release of [...heldResponses.values()])release();}
   else assert.equal(request.type,'inspect');
   answer={passed:true,renderer:await observe(page),providerRequests:[...providerRequests],closedProviderRequests:[...closedProviderRequests],measurements:[...measurements]};
  }catch(error){let diagnostic;try{const page=browser?.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith('vscode-file:'));if(page){diagnostic=await observe(page);await page.screenshot({path:path.join(temp,'failure.png')});}}catch{}answer={passed:false,error:error.stack||String(error),diagnostic};}
  await writeFile(path.join(ipc,`result-${commandIndex}.json`),JSON.stringify(answer));commandIndex++;
 }
 assert.equal(result.passed,true,`${result.error||'Failed native check'}. See ${temp}`);
 if(!visualFixtureOnly){while(!exited&&Date.now()<deadline)await pause(100);assert.equal(exited,true);assert.equal(exitCode,0);}
 assert.ok(providerRequests.length>0);assert.ok(providerRequests.every(request=>!request.fixtureError));
 const report={...await readJSON(reportPath),...(visualFixtureOnly?{fixturePrepared:true,visualFixtureOnly:true}:{passed:true}),mode:'packaged',app,extensionPath,workspace,temp,provider:'loopback compatible protocol fixture; environment only, no credentials',providerRequests,closedProviderRequests,interactions,measurements,nativeVisualAcceptance:'Not performed by this automated check'};
 await writeFile(path.join(desktop,'.build',visualFixtureOnly?'native-code-suggestions-visual-fixture-report.json':'native-code-suggestions-smoke-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({...(visualFixtureOnly?{fixturePrepared:true,visualFixtureOnly:true}:{passed:true}),temp,providerRequests:providerRequests.length,checks:report.checks,measurements},null,2));
 if(visualFixtureOnly){const reviewDeadline=Date.now()+600000;while(!exited&&Date.now()<reviewDeadline)await pause(1000);if(!exited)throw Error('Manual visual fixture timed out after ten minutes.');}
}finally{
 if(child&&!exited)child.kill('SIGTERM');await browser?.close().catch(()=>{});
 await writeFile(path.join(temp,'interactions.json'),JSON.stringify(interactions,null,2));await writeFile(path.join(temp,'mock-provider-requests.json'),JSON.stringify(providerRequests,null,2));
 provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));
}
