import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, realpath, cp, open, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repo=path.dirname(desktop),keepOpen=process.argv.includes('--keep-open'),development=process.argv.includes('--development');
if(process.argv.slice(2).some(flag=>!['--keep-open','--development'].includes(flag)))throw new Error('Usage: node desktop/scripts/connected-runtime-smoke.mjs [--development] [--keep-open]');
const app=await realpath(process.env.FOUNDATION_APP_PATH||path.join(desktop,'.build/Foundation.app'));
const expected=await realpath(development?path.join(desktop,'extension'):path.join(app,'Contents/Resources/app/extensions/foundation-workspace'));
const plugin=path.join(expected,'dist/connected-vite-plugin.mjs');await access(plugin);
const temp=await realpath(await mkdtemp('/private/tmp/foundation-connected-native-'));
const workspace=path.join(temp,'workspace'),userData=path.join(temp,'user-data'),harness=path.join(temp,'harness');
const ready=path.join(temp,'ready.json'),outcome=path.join(temp,'outcome.json'),browserDone=path.join(temp,'browser-done.json');
await cp(path.join(repo,'fixtures/connected-web'),workspace,{recursive:true});
// A clone keeps the native fixture entirely outside Documents, avoiding a new
// macOS folder permission for the disposable app's development process.
await promisify(execFile)('/bin/cp',['-cR',path.join(repo,'node_modules'),path.join(workspace,'node_modules')]);
const config=path.join(workspace,'vite.config.mjs');
await writeFile(config,(await readFile(config,'utf8')).replace('../../desktop/runtime/vite-plugin.mjs',plugin));
await mkdir(path.join(userData,'User'),{recursive:true});await mkdir(harness);
await Promise.all([
 writeFile(path.join(userData,'User/settings.json'),JSON.stringify({
  'foundation.openOnStartup':false,'foundation.ai.baseUrl':'','foundation.ai.model':'','chat.disableAIFeatures':true,
  'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','window.confirmBeforeClose':'never',
  'security.workspace.trust.enabled':false,
 })),
 writeFile(path.join(harness,'package.json'),JSON.stringify({name:'connected-native-check',publisher:'foundation-test',version:'1.0.0',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:['onStartupFinished']})),
 writeFile(path.join(harness,'index.cjs'),await readFile(path.join(desktop,'tests/native-connected-runtime-smoke.cjs'))),
]);
const environment={...process.env,FOUNDATION_CONNECTED_READY:ready,FOUNDATION_CONNECTED_OUTCOME:outcome,FOUNDATION_CONNECTED_BROWSER_DONE:browserDone,
 FOUNDATION_CONNECTED_EXTENSION:expected,FOUNDATION_CONNECTED_WORKSPACE:workspace,FOUNDATION_CONNECTED_KEEP_OPEN:keepOpen?'1':'0'};
for(const key of Object.keys(environment))if(key==='ELECTRON_RUN_AS_NODE'||/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key))delete environment[key];
const log=await open(path.join(temp,'native.log'),'w');
const child=spawn(path.join(app,'Contents/MacOS/Foundation'),[workspace,'--new-window','--user-data-dir',userData,'--extensions-dir',path.join(temp,'extensions'),
 '--extensionDevelopmentPath',harness,...(development?['--extensionDevelopmentPath',expected]:[]),'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--disable-crash-reporter'],
 {env:environment,stdio:['ignore',log.fd,log.fd],detached:true});
child.unref();await log.close();let browser;
const wait=async(file,timeout=45000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){try{return JSON.parse(await readFile(file,'utf8'));}catch{}await new Promise(resolve=>setTimeout(resolve,150));}throw new Error(`Timed out waiting for ${file}`);};
try {
 const state=await wait(ready);assert.equal(state.passed,true,state.error);assert.equal(state.runtime.status,'connected');assert.ok(state.electronVersion);
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1080,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(state.runtime.url);await expect(page.getByRole('button',{name:'Save changes',exact:true})).toBeVisible();
 await page.evaluate(session=>window.postMessage({type:'foundation-runtime-control',session,inspect:true},location.origin),state.runtime.session);
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.evaluate(session=>window.postMessage({type:'foundation-runtime-control',session,inspect:false},location.origin),state.runtime.session);
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('button',{name:'Changes saved',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Request scenario'}).selectOption('failure');await page.getByRole('button',{name:'Changes saved',exact:true}).click();
 await expect(page.getByRole('button',{name:'Save changes',exact:true})).toBeVisible();
 assert.deepEqual(errors,[]);await writeFile(browserDone,JSON.stringify({passed:true,browser:'Chromium',pageErrors:errors}));
 const result=await wait(outcome,45000);assert.equal(result.passed,true,result.error);
 if(!keepOpen)await assert.rejects(()=>fetch(state.runtime.targetUrl),'Owned Vite target must stop before report completion');
 const report={...result,mode:development?'development':'packaged',app,extensionPath:expected,plugin,workspace,temp,keptOpen:keepOpen,
  browserVerification:'Real Chromium interaction with the installed native host-owned Vite target; native webview visual acceptance remains separate.'};
 await mkdir(path.join(desktop,'.build'),{recursive:true});
 await writeFile(path.join(desktop,'.build',development?'development-connected-runtime-smoke-report.json':'native-connected-runtime-smoke-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
} catch(error) {
 await writeFile(browserDone,JSON.stringify({passed:false,error:error.stack||String(error)}));
 // Only this disposable profile's process is stopped; no normal Foundation
 // profile or project process is selected by name.
 await new Promise(resolve=>setTimeout(resolve,1500));try{child.kill('SIGTERM');}catch{}
 throw new Error(`${error.stack||error}\nNative fixture logs: ${temp}`);
} finally {await browser?.close();}
