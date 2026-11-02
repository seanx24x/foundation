import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverXcodeProjects, inspectXcodeProject, runXcodeOperation, readXcodeSourceFingerprint, isXcodeSourceInput, runXcodeProcess } from '../src/xcode-project.mjs';

const UUID='00000000-1111-2222-3333-444444444444';
const success=(stdout='')=>({status:'passed',stdout,stderr:'',exitCode:0});
const destinations=`Available destinations for the "Orbit" scheme:\n { platform:iOS Simulator, id:dvtdevice-DVTiOSDeviceSimulatorPlaceholder-iphonesimulator:placeholder, name:Any iOS Simulator Device }\n { platform:iOS Simulator, arch:arm64, id:${UUID}, OS:27.0, name:iPhone 17 }\n { platform:iOS Simulator, arch:x86_64, id:${UUID}, OS:27.0, name:iPhone 17 }\nIneligible destinations for the "Orbit" scheme:\n { platform:iOS Simulator, id:99999999-1111-2222-3333-444444444444, name:Unavailable, error:Missing runtime }`;
async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'foundation-xcode-core-test-'));
 await mkdir(join(root,'Orbit.xcodeproj','project.xcworkspace'),{recursive:true});
 await mkdir(join(root,'Sources'));
 await writeFile(join(root,'Orbit.xcodeproj','project.pbxproj'),'// local project');
 await writeFile(join(root,'Orbit.xcodeproj','project.xcworkspace','contents.xcworkspacedata'),'<Workspace/>');
 await writeFile(join(root,'Sources','App.swift'),'import SwiftUI\n');
 t.after(()=>rm(root,{recursive:true,force:true}));return root;
}
function runnerWith(calls=[],overrides={}) { return async request=>{
 calls.push(request);
 if (overrides.run) return overrides.run(request);
 if(request.tool==='sourcekit-lsp')return success('/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/sourcekit-lsp\n');
 if(request.args.includes('-list'))return success(JSON.stringify({project:{schemes:['Orbit','Second']}}));
 if(request.args.includes('-showdestinations'))return success(destinations);
 return success('BUILD SUCCEEDED\n');
};}
const inspect=(root,runner=runnerWith(),more={})=>inspectXcodeProject({root,trusted:true,projectPath:'Orbit.xcodeproj',scheme:'Orbit',runner,...more});
const command=(root,more={})=>({tool:'xcodebuild',args:['-project',join(root,'Orbit.xcodeproj'),'-list','-json','-disableAutomaticPackageResolution','-onlyUsePackageVersionsFromResolvedFile','-skipPackageUpdates','-hideShellScriptEnvironment'],cwd:root,timeoutMs:1000,maxOutputBytes:1024,...more});
function fakeProcess(spawned,scenario) {return (file,args,options)=>{
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=type=>{spawned.push({kill:type});setImmediate(()=>child.emit('close',null));return true;};
 spawned.push({file,args,options,child});setImmediate(()=>scenario(child));return child;
};}

test('discovers actual projects and standalone workspaces, omitting generated internal workspace',async t=>{
 const root=await fixture(t);await mkdir(join(root,'Workspace.xcworkspace'));await writeFile(join(root,'Workspace.xcworkspace','contents.xcworkspacedata'),'<Workspace/>');
 const report=await discoverXcodeProjects({root,trusted:true});assert.equal(report.status,'complete');assert.deepEqual(report.projects.map(p=>p.path),['Orbit.xcodeproj','Workspace.xcworkspace']);assert.match(report.inputFingerprint,/^[a-f0-9]{64}$/);
});
test('trust and cancellation stop discovery before running commands',async t=>{
 const root=await fixture(t);assert.equal((await discoverXcodeProjects({root,trusted:false})).status,'unavailable');const abort=new AbortController();abort.abort();assert.equal((await discoverXcodeProjects({root,trusted:true,signal:abort.signal})).status,'cancelled');
});
test('source fingerprint includes changed, added and removed saved files but excludes generated state',async t=>{
 const root=await fixture(t);const first=await readXcodeSourceFingerprint(root);await mkdir(join(root,'build'));await writeFile(join(root,'build','noise'),'1');assert.equal(await readXcodeSourceFingerprint(root),first);await writeFile(join(root,'Orbit.xcodeproj','project.xcworkspace','contents.xcworkspacedata'),'generated');assert.equal(await readXcodeSourceFingerprint(root),first);await writeFile(join(root,'Sources','App.swift'),'changed');assert.notEqual(await readXcodeSourceFingerprint(root),first);
 assert.equal(isXcodeSourceInput('../escape.swift'),false);assert.equal(isXcodeSourceInput('Sources/App.swift'),true);assert.equal(isXcodeSourceInput('Orbit.xcodeproj/project.xcworkspace/x'),false);assert.equal(isXcodeSourceInput('Orbit.xcodeproj/xcshareddata/xcschemes/Orbit.xcscheme'),true);
});
test('linked selected root and linked source inputs fail closed',async t=>{
 const root=await fixture(t);const link=`${root}-link`;await symlink(root,link);t.after(()=>rm(link,{force:true}));assert.equal((await discoverXcodeProjects({root:link,trusted:true})).status,'unavailable');await symlink('/etc/hosts',join(root,'Sources','outside.swift'));assert.equal(await readXcodeSourceFingerprint(root),null);assert.match((await discoverXcodeProjects({root,trusted:true})).reason,/linked/);
});
test('bounded file/depth inputs fail with recovery instead of partial identity',async t=>{
 const root=await fixture(t);await writeFile(join(root,'oversized.bin'),Buffer.alloc(8*1024*1024+1));const report=await discoverXcodeProjects({root,trusted:true});assert.equal(report.inputFingerprint,null);assert.match(report.reason,/8 MiB/);
});
test('missing Xcode metadata is unavailable, empty folder is explicit',async t=>{
 const root=await fixture(t);await rm(join(root,'Orbit.xcodeproj','project.pbxproj'));assert.match((await discoverXcodeProjects({root,trusted:true})).reason,/missing/);await rm(join(root,'Orbit.xcodeproj'),{recursive:true});assert.match((await discoverXcodeProjects({root,trusted:true})).reason,/No Xcode/);
});
test('explicit catalog lists schemes and only eligible reported simulator destinations',async t=>{
 const root=await fixture(t),calls=[];const catalog=await inspect(root,runnerWith(calls));assert.equal(catalog.status,'complete');assert.deepEqual(catalog.schemes,['Orbit','Second']);assert.equal(catalog.destinations.length,2);assert.equal(catalog.destinations[0].testEligible,false);assert.equal(catalog.destinations[1].id,UUID);assert.equal(catalog.languageTooling.status,'available');assert.match(catalog.languageTooling.detail,/not integrated/);assert.equal(calls.length,3);assert.ok(calls.every(c=>c.tool==='sourcekit-lsp'||c.args.includes('-skipPackageUpdates')));
});
test('scheme discovery alone never chooses a scheme or runs destination discovery',async t=>{
 const root=await fixture(t),calls=[];const catalog=await inspect(root,runnerWith(calls),{scheme:undefined});assert.equal(catalog.selectedScheme,undefined);assert.deepEqual(catalog.destinations,[]);assert.equal(calls.length,2);
});
test('invalid project or scheme cannot produce a runnable catalog',async t=>{
 const root=await fixture(t),calls=[];assert.equal((await inspect(root,runnerWith(calls),{projectPath:'../Elsewhere.xcodeproj'})).status,'unavailable');assert.equal(calls.length,0);assert.equal((await inspect(root,runnerWith(calls),{scheme:'Unknown'})).status,'unavailable');assert.equal(calls.length,1);
});
test('Swift package project is stopped before xcodebuild could fetch missing dependencies',async t=>{
 const root=await fixture(t),calls=[];await writeFile(join(root,'Orbit.xcodeproj','project.pbxproj'),'isa = XCRemoteSwiftPackageReference;');const catalog=await inspect(root,runnerWith(calls));assert.equal(catalog.status,'unavailable');assert.match(catalog.reason,/does not resolve or download/);assert.equal(calls.length,0);
});
test('failed discovery preserves bounded diagnostic output and no eligible targets',async t=>{
 const root=await fixture(t);const catalog=await inspect(root,async()=>({status:'failed',stdout:'diagnostic',stderr:'bad project',exitCode:65}));assert.equal(catalog.status,'unavailable');assert.equal(catalog.diagnostic.stderr,'bad project');assert.equal(catalog.diagnostic.exitCode,65);assert.deepEqual(catalog.destinations,[]);
});
test('changed source during discovery invalidates catalog',async t=>{
 const root=await fixture(t),normal=runnerWith();const catalog=await inspect(root,async request=>{const result=await normal(request);if(request.args.includes('-showdestinations'))await writeFile(join(root,'Sources','App.swift'),'changed during discovery');return result;});assert.equal(catalog.status,'stale');assert.notEqual(catalog.inputFingerprint,catalog.endFingerprint);
});
test('build uses selected identity and private outputs, no shell/signing/provisioning action',async t=>{
 const root=await fixture(t),calls=[];const catalog=await inspect(root);const before=await readXcodeSourceFingerprint(root);const result=await runXcodeOperation({root,trusted:true,catalog,destinationId:'generic-ios-simulator',action:'build',runner:runnerWith(calls)});t.after(()=>rm(result.artifacts.directory,{recursive:true,force:true}));assert.equal(result.status,'passed');assert.equal(result.sourceCurrent,true);assert.equal(result.inputFingerprint,before);assert.equal(await readXcodeSourceFingerprint(root),before);assert.equal((await stat(result.artifacts.directory)).mode&0o777,0o700);assert.ok(!result.artifacts.directory.startsWith(root));const args=calls[0].args;assert.equal(args.at(-1),'build');assert.ok(args.includes('generic/platform=iOS Simulator'));assert.ok(args.includes('CODE_SIGNING_ALLOWED=NO'));assert.ok(!args.includes('-allowProvisioningUpdates'));
});
test('test requires concrete simulator and reports build/test as separate actions',async t=>{
 const root=await fixture(t),catalog=await inspect(root),calls=[];const invalid=await runXcodeOperation({root,trusted:true,catalog,destinationId:'generic-ios-simulator',action:'test',runner:runnerWith(calls)});assert.equal(invalid.status,'unavailable');assert.equal(calls.length,0);const tested=await runXcodeOperation({root,trusted:true,catalog,destinationId:UUID,action:'test',runner:runnerWith(calls)});t.after(()=>rm(tested.artifacts.directory,{recursive:true,force:true}));assert.equal(tested.action,'test');assert.equal(tested.status,'passed');assert.ok(calls[0].args.includes(`platform=iOS Simulator,id=${UUID}`));assert.ok(calls[0].args.includes('-parallel-testing-enabled'));
});
test('forged, mutated, foreign-root and stale catalogs cannot launch builds',async t=>{
 const root=await fixture(t),catalog=await inspect(root),calls=[],run=extra=>runXcodeOperation({root,trusted:true,catalog,destinationId:UUID,action:'build',runner:runnerWith(calls),...extra});assert.equal((await run({catalog:structuredClone(catalog)})).status,'unavailable');assert.equal((await run({root:`${root}/Sources`})).status,'unavailable');catalog.destinations[0].id='forged';assert.equal((await run()).status,'unavailable');catalog.destinations[0].id='generic-ios-simulator';await writeFile(join(root,'Sources','App.swift'),'changed');assert.equal((await run()).status,'stale');assert.equal(calls.length,0);
});
test('cancelled operation retains selected destination and unchanged source for retry',async t=>{
 const root=await fixture(t),catalog=await inspect(root),abort=new AbortController();const result=await runXcodeOperation({root,trusted:true,catalog,destinationId:UUID,action:'build',signal:abort.signal,runner:async()=>{abort.abort();return {status:'cancelled',stdout:'partial',stderr:'',exitCode:null};}});t.after(()=>rm(result.artifacts.directory,{recursive:true,force:true}));assert.equal(result.status,'cancelled');assert.equal(result.sourceCurrent,true);assert.equal(result.destination.id,UUID);assert.equal(result.stdout,'partial');
});
test('source mutation during successful process is stale evidence, retaining real exit code',async t=>{
 const root=await fixture(t),catalog=await inspect(root);const result=await runXcodeOperation({root,trusted:true,catalog,destinationId:UUID,action:'build',runner:async()=>{await writeFile(join(root,'Sources','App.swift'),'changed by build');return success('compiled');}});t.after(()=>rm(result.artifacts.directory,{recursive:true,force:true}));assert.equal(result.status,'stale');assert.equal(result.exitCode,0);assert.equal(result.sourceCurrent,false);assert.notEqual(result.endFingerprint,result.inputFingerprint);
});
test('fixed process runner rejects arbitrary command injection',async t=>{
 const root=await fixture(t),spawned=[];const spawnProcess=fakeProcess(spawned,c=>c.emit('close',0));for(const request of [{...command(root),tool:'sh'},command(root,{args:['-exportArchive']}),command(root,{args:[...command(root).args,'-allowProvisioningUpdates']}),command(root,{args:[...command(root).args,'BAD=YES']}),command(root,{args:[...command(root).args,'test']})])assert.equal((await runXcodeProcess(request,{spawnProcess})).status,'unavailable');assert.equal(spawned.length,0);
});
test('fixed runner uses clean environment and preserves stdout/stderr and exit failure',async t=>{
 const root=await fixture(t),spawned=[];const result=await runXcodeProcess(command(root),{spawnProcess:fakeProcess(spawned,child=>{child.stdout.write('out');child.stderr.write('err');child.emit('close',65);})});assert.equal(result.status,'failed');assert.equal(result.exitCode,65);assert.equal(result.stdout,'out');assert.equal(result.stderr,'err');assert.equal(spawned[0].file,'/usr/bin/xcodebuild');assert.equal(spawned[0].options.shell,false);assert.equal(spawned[0].options.detached,true);assert.deepEqual(Object.keys(spawned[0].options.env).sort(),['HOME','LANG','LC_ALL','PATH',...(process.env.TMPDIR?['TMPDIR']:[])].sort());
});
test('runner cancellation, timeout and output cap terminate owned child',async t=>{
 const root=await fixture(t);
 for(const kind of ['cancelled','timeout','output-limit']){
  const spawned=[],abort=new AbortController();const request=command(root,{timeoutMs:kind==='timeout'?10:1000});const result=await runXcodeProcess(request,{signal:abort.signal,spawnProcess:fakeProcess(spawned,child=>{if(kind==='cancelled')abort.abort();if(kind==='output-limit')child.stdout.write(Buffer.alloc(2048));})});assert.equal(result.status,kind);assert.ok(spawned.some(value=>value.kill==='SIGTERM'));
 }
});


test('Xcode 27 compatible/incompatible destination headings parse without physical-device leakage',async t=>{
 const root=await fixture(t),normal=runnerWith();const catalog=await inspect(root,async request=>{const result=await normal(request);if(request.args.includes('-showdestinations'))result.stdout=result.stdout.replace('Available destinations for','Destinations compatible with').replace('Ineligible destinations for','Destinations incompatible with')+'\n{ platform:iOS, id:physical-secret, name:Personal phone }';return result;});assert.equal(catalog.destinations.length,2);assert.equal(catalog.diagnostic.stdout.includes('physical-secret'),false);assert.equal(catalog.diagnostic.stdout.includes('99999999'),false);
});
test('external and grouped workspace references stop before running Xcode',async t=>{
 const root=await fixture(t);await mkdir(join(root,'Orbit.xcworkspace'));const calls=[];for(const content of ['<Workspace><FileRef location="absolute:/tmp/Foreign.xcodeproj"/></Workspace>','<Workspace><Group location="group:../outside"><FileRef location="group:Foreign.xcodeproj"/></Group></Workspace>','<Workspace><FileRef location="group:Missing.xcodeproj"/></Workspace>']){await writeFile(join(root,'Orbit.xcworkspace','contents.xcworkspacedata'),content);const catalog=await inspect(root,runnerWith(calls),{projectPath:'Orbit.xcworkspace'});assert.equal(catalog.status,'unavailable');assert.match(catalog.reason,/references/);}assert.equal(calls.length,0);
});
test('self-contained workspace project references are accepted',async t=>{
 const root=await fixture(t);await mkdir(join(root,'Orbit.xcworkspace'));await writeFile(join(root,'Orbit.xcworkspace','contents.xcworkspacedata'),'<Workspace><FileRef location="group:Orbit.xcodeproj"/></Workspace>');const normal=runnerWith();const catalog=await inspect(root,async request=>request.args.includes('-list')?success(JSON.stringify({workspace:{schemes:['Orbit']}})):normal(request),{projectPath:'Orbit.xcworkspace'});assert.equal(catalog.status,'complete');
});
test('actual detached helper is terminated after its launcher exits',async t=>{
 const root=await fixture(t),pulse=join(root,'pulse');const childSource=`const fs=require('fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(pulse)},'ready');setInterval(()=>fs.appendFileSync(${JSON.stringify(pulse)},'.'),20);`;const launcher=`const {spawn}=require('child_process');const fs=require('fs');spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{stdio:'ignore'});const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(pulse)})){clearInterval(timer);console.log('ready');process.exit(0)}},10);`;const result=await runXcodeProcess(command(root),{spawnProcess:(_file,_args,options)=>spawn(process.execPath,['-e',launcher],options)});assert.equal(result.status,'passed');const last=await readFile(pulse,'utf8');await new Promise(resolve=>setTimeout(resolve,100));assert.equal(await readFile(pulse,'utf8'),last);
});
