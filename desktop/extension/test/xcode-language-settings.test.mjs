import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectXcodeProject } from '../src/xcode-project.mjs';
import { prepareXcodeLanguageSettings, createXcodeCompilationDatabase, disposeXcodeCompilationDatabase, isXcodeLanguageConfiguration, validateXcodeLanguageConfiguration, readXcodeLanguageConfigurationFingerprint } from '../src/xcode-language-settings.mjs';

const success=stdout=>({status:'passed',stdout,stderr:'',exitCode:0});
const escape=value=>value.replace(/([\\\s"'`$;&|<>()])/g,'\\$1');
async function fixture(t,overrides={}) {
  const base=await realpath(await mkdtemp(join(tmpdir(),'foundation-swift-settings-test-'))),root=join(base,'Project With Spaces');
  const developer=join(base,'Xcode.app','Contents','Developer'),bin=join(developer,'Toolchains','XcodeDefault.xctoolchain','usr','bin');
  const sdk=join(developer,'Platforms','iPhoneSimulator.platform','Developer','SDKs','iPhoneSimulator27.2.sdk');
  await mkdir(join(root,'Orbit.xcodeproj'),{recursive:true});await mkdir(join(root,'Sources'));
  await writeFile(join(root,'Orbit.xcodeproj','project.pbxproj'),'// local project');
  const sources=[join(root,'Sources','App.swift'),join(root,'Sources','Profile Store.swift')];
  for(let index=2;index<(overrides.sourceCount||2);index++)sources.push(join(root,'Sources',`Source${index}.swift`));
  await Promise.all(sources.map(path=>writeFile(path,'import SwiftUI\n')));
  await mkdir(bin,{recursive:true});await mkdir(sdk,{recursive:true});
  for(const file of ['swiftc','sourcekit-lsp']){await writeFile(join(bin,file),'fake executable for settings tests');await chmod(join(bin,file),0o700);}
  await writeFile(join(sdk,'SDKSettings.json'),'{}');
  const artifacts=[],calls=[],invocations=[];
  t.after(async()=>{await rm(base,{recursive:true,force:true});await Promise.all(artifacts.map(path=>rm(path,{recursive:true,force:true})));});
  const runner=async(request,{signal}={})=>{
    calls.push(request);
    if(request.tool==='sourcekit-lsp')return success(`${join(bin,'sourcekit-lsp')}\n`);
    if(request.args.includes('-list'))return success(JSON.stringify({project:{schemes:['Orbit']}}));
    if(request.args.includes('-showdestinations'))return success('Available destinations for the "Orbit" scheme:\n { platform:iOS Simulator, id:placeholder, name:Any iOS Simulator Device }');
    const derived=request.args[request.args.indexOf('-derivedDataPath')+1];artifacts.push(dirname(derived));
    if(overrides.build)return overrides.build(request,{signal});
    const logs=[];
    for(const [name,arch,files] of overrides.targets||[['Orbit','arm64',sources],['Orbit','x86_64',sources]]){
      const list=join(derived,'Build',name,arch,'Orbit.SwiftFileList');await mkdir(dirname(list),{recursive:true});
      await writeFile(list,files.map(escape).join('\n')+'\n');
      const args=[join(bin,'swiftc'),'-module-name',name,`@${list}`,'-Onone','-sdk',sdk,'-target',`${arch}-apple-ios18.0-simulator`,'-DDEBUG','-I',join(derived,'Build','Products'),'-c','-working-directory',root,...(overrides.extraArgs||[])];
      if(overrides.mutate)await overrides.mutate({args,list,derived,root,sources});
      invocations.push(args);
      logs.push(`SwiftDriver ${name} normal ${arch} com.apple.xcode.tools.swift.compiler (in target '${name}' from project 'Orbit')\n    cd ${escape(root)}\n    builtin-SwiftDriver -- ${args.map(escape).join(' ')}\n`);
    }
    const output=logs.join('\n')+'** BUILD SUCCEEDED **\n';
    return success(overrides.output?overrides.output(output):output);
  };
  const catalog=await inspectXcodeProject({root,trusted:true,projectPath:'Orbit.xcodeproj',scheme:'Orbit',runner});assert.equal(catalog.status,'complete');
  const prepare=more=>prepareXcodeLanguageSettings({root,trusted:true,catalog,destinationId:'generic-ios-simulator',runner,...more});
  return {base,root,sources,sdk,bin,runner,catalog,calls,invocations,prepare};
}
const database=async(t,preparation,targetId=preparation.targets[0]?.id)=>{
  const result=await createXcodeCompilationDatabase({preparation,targetId});
  if(result.configuration)t.after(()=>disposeXcodeCompilationDatabase(result.configuration));
  return result;
};

test('extracts separate explicit architecture choices from actual successful Swift invocations',async t=>{
  const f=await fixture(t),p=await f.prepare();assert.equal(p.status,'ready',p.reason);assert.equal(p.build.status,'passed');assert.equal(p.build.sourceCurrent,true);assert.equal(p.destination.id,'generic-ios-simulator');assert.deepEqual(p.targets.map(x=>[x.name,x.architecture]),[['Orbit','arm64'],['Orbit','x86_64']]);
  const target=p.targets[0];assert.deepEqual(target.sourcePaths,f.sources);assert.equal(target.sdkPath,f.sdk);assert.equal(target.sourcekitPath,join(f.bin,'sourcekit-lsp'));assert.equal(target.workingDirectory,f.root);assert.match(target.toolchainFingerprint,/^[a-f0-9]{64}$/);assert.notEqual(p.targets[0].id,p.targets[1].id);
  assert.deepEqual(target.compilerArguments,f.invocations[0].flatMap(arg=>arg.startsWith('@')?f.sources:[arg]));
});
test('compile database is private, source-faithful and usable without writing the project',async t=>{
  const f=await fixture(t),p=await f.prepare(),result=await database(t,p);assert.equal(result.status,'ready',result.reason);
  const c=result.configuration;assert.equal(isXcodeLanguageConfiguration(c),true);assert.equal((await stat(c.workspaceRoot)).mode&0o777,0o700);assert.equal((await stat(c.compilationDatabasePath)).mode&0o777,0o600);assert.ok(!c.workspaceRoot.startsWith(f.root));
  const rows=JSON.parse(await readFile(c.compilationDatabasePath,'utf8'));assert.deepEqual(rows.map(x=>x.file),f.sources);assert.ok(rows.every(x=>x.directory===f.root));assert.deepEqual(rows[0].arguments,p.targets[0].compilerArguments);assert.equal((await validateXcodeLanguageConfiguration(c)).status,'ready');
});
test('trust, aborted preparation and forged catalog cannot launch a build',async t=>{
  const f=await fixture(t),before=f.calls.length,abort=new AbortController();abort.abort();assert.equal((await f.prepare({trusted:false})).status,'unavailable');assert.equal((await f.prepare({signal:abort.signal})).status,'cancelled');assert.equal((await f.prepare({catalog:structuredClone(f.catalog)})).status,'unavailable');assert.equal(f.calls.length,before);
});
test('failed, timed-out and cancelled builds never expose fallback settings',async t=>{
  for(const status of ['failed','timeout','cancelled']){const f=await fixture(t,{build:async()=>({status,stdout:'partial build',stderr:'compiler error',exitCode:status==='failed'?65:null})});const p=await f.prepare();assert.equal(p.status,status==='cancelled'?'cancelled':'unavailable');assert.equal(p.build.status,status);assert.deepEqual(p.targets,[]);}
});
test('build success without Swift compiler evidence is explicitly unavailable',async t=>{
  const f=await fixture(t,{build:async()=>success('** BUILD SUCCEEDED **')});const p=await f.prepare();assert.equal(p.status,'unavailable');assert.match(p.reason,/did not report/);
});
test('target selection is exact, rejecting unknown and mutated preparation',async t=>{
  const f=await fixture(t),p=await f.prepare();assert.equal((await database(t,p,'not-a-target')).status,'unavailable');assert.equal((await database(t,structuredClone(p),p.targets[0].id)).status,'unavailable');p.targets[0].compilerArguments.push('-DInjected');assert.equal((await database(t,p)).status,'unavailable');
});
test('overlapping app and test sources remain separate target configurations',async t=>{
  const f=await fixture(t);const runner=async(request,opts)=>{const out=await f.runner(request,opts);if(request.args.at(-1)==='build'){out.stdout=out.stdout.replaceAll('SwiftDriver Orbit normal x86_64','SwiftDriver OrbitTests normal x86_64');const lines=out.stdout.split('\n');let other=false;out.stdout=lines.map(line=>{if(line.startsWith('SwiftDriver OrbitTests ')){other=true;return line.replace("target 'Orbit'","target 'OrbitTests'");}if(other&&line.includes('builtin-SwiftDriver'))return line.replace('-module-name Orbit ','-module-name OrbitTests ');return line;}).join('\n');}return out;};
  const p=await f.prepare({runner});assert.equal(p.status,'ready',p.reason);assert.deepEqual(p.targets.map(x=>x.name),['Orbit','OrbitTests']);assert.deepEqual(p.targets[0].sourcePaths,p.targets[1].sourcePaths);const db=await database(t,p,p.targets[1].id);assert.equal(db.configuration.target.name,'OrbitTests');assert.ok(JSON.parse(await readFile(db.configuration.compilationDatabasePath,'utf8')).every(x=>x.arguments.includes('OrbitTests')));
});
test('Swift text changes retain configuration while metadata, source additions and removals invalidate',async t=>{
  const f=await fixture(t),p=await f.prepare(),{configuration:c}=await database(t,p),fingerprint=await readXcodeLanguageConfigurationFingerprint(f.root);
  await writeFile(f.sources[0],'struct Edited {}\n');assert.equal(await readXcodeLanguageConfigurationFingerprint(f.root),fingerprint);assert.equal((await validateXcodeLanguageConfiguration(c)).status,'ready');
  await writeFile(join(f.root,'Sources','Added.swift'),'');assert.notEqual(await readXcodeLanguageConfigurationFingerprint(f.root),fingerprint);assert.equal((await validateXcodeLanguageConfiguration(c)).status,'stale');await rm(join(f.root,'Sources','Added.swift'));assert.equal((await validateXcodeLanguageConfiguration(c)).status,'ready');
  await writeFile(join(f.root,'Orbit.xcodeproj','project.pbxproj'),'changed settings');assert.equal((await validateXcodeLanguageConfiguration(c)).status,'stale');
});
test('source edits before selecting a target require a fresh preparation',async t=>{
  const f=await fixture(t),p=await f.prepare();await writeFile(f.sources[0],'saved after build');assert.equal((await database(t,p)).status,'stale');
});
test('changes to exact SDK and language-server binaries invalidate prepared settings',async t=>{
  for(const kind of ['sdk','server']){const f=await fixture(t),p=await f.prepare(),{configuration:c}=await database(t,p);await writeFile(kind==='sdk'?join(f.sdk,'SDKSettings.json'):join(f.bin,'sourcekit-lsp'),kind==='sdk'?'{"Version":"new"}':'updated binary');assert.equal((await validateXcodeLanguageConfiguration(c)).status,'stale');}
});
test('private database tampering, clones and mutation fail provenance checks',async t=>{
  const f=await fixture(t),p=await f.prepare(),{configuration:c}=await database(t,p);assert.equal(isXcodeLanguageConfiguration(structuredClone(c)),false);await writeFile(c.compilationDatabasePath,'[]');assert.equal((await validateXcodeLanguageConfiguration(c)).status,'stale');c.sourcePaths.push('/elsewhere.swift');assert.equal(isXcodeLanguageConfiguration(c),false);assert.equal((await validateXcodeLanguageConfiguration(c)).status,'unavailable');
});
test('disposal removes only the internally owned directory after caller mutation',async t=>{
  const f=await fixture(t),p=await f.prepare(),{configuration:c}=await database(t,p),owned=c.workspaceRoot;c.workspaceRoot=f.root;await disposeXcodeCompilationDatabase(c);assert.equal(isXcodeLanguageConfiguration(c),false);await assert.rejects(stat(owned),{code:'ENOENT'});assert.ok((await stat(f.root)).isDirectory());await disposeXcodeCompilationDatabase(c);
});
test('response files outside owned build output cannot supply settings',async t=>{
  const f=await fixture(t,{mutate:async({args})=>{args[3]='@/etc/Foreign.SwiftFileList';}});const p=await f.prepare();assert.equal(p.status,'unavailable');assert.match(p.reason,/outside/);
});
test('linked response and source inputs cannot escape the selected snapshot',async t=>{
  const f=await fixture(t,{mutate:async({list})=>{await rm(list);await symlink('/etc/hosts',list);}});assert.equal((await f.prepare()).status,'unavailable');
  const g=await fixture(t);await symlink('/etc/hosts',join(g.root,'Sources','Linked.swift'));assert.equal(await readXcodeLanguageConfigurationFingerprint(g.root),null);assert.equal((await g.prepare()).status,'unavailable');
});
test('generated target sources are explicitly unsupported',async t=>{
  const f=await fixture(t,{mutate:async({list,derived})=>{const file=join(derived,'Generated.swift');await writeFile(file,'struct Generated {}');await writeFile(list,escape(file));}});const p=await f.prepare();assert.equal(p.status,'unavailable');assert.match(p.reason,/generated or external/);
});
test('explicit plugins and external include directories are unsupported',async t=>{
  for(const [extraArgs,reason] of [[['-load-plugin-executable','/tmp/plugin#Macro'],/plugin/],[['-I','/tmp/foreign-imports'],/outside/]]){const f=await fixture(t,{extraArgs});const p=await f.prepare();assert.equal(p.status,'unavailable');assert.match(p.reason,reason);}
});
test('missing SDK and malformed response arguments cannot produce partial settings',async t=>{
  for(const mutate of [async({args})=>{args[args.indexOf('-sdk')]='-wrong';},async({list})=>{await writeFile(list,'"unterminated');},async({args})=>{args[args.indexOf('-target')+1]='macos-arm64';}]){const f=await fixture(t,{mutate});assert.equal((await f.prepare()).status,'unavailable');}
});
test('cancellation before database creation or validation never yields a usable connection',async t=>{
  const f=await fixture(t),p=await f.prepare(),{configuration:c}=await database(t,p),abort=new AbortController();abort.abort();assert.equal((await createXcodeCompilationDatabase({preparation:p,targetId:p.targets[0].id,signal:abort.signal})).status,'cancelled');assert.equal((await validateXcodeLanguageConfiguration(c,{signal:abort.signal})).status,'cancelled');
});
test('ignored build products do not invalidate configuration; bounded non-Swift files do',async t=>{
  const f=await fixture(t),before=await readXcodeLanguageConfigurationFingerprint(f.root);await mkdir(join(f.root,'build'));await writeFile(join(f.root,'build','noise'),'ignored');assert.equal(await readXcodeLanguageConfigurationFingerprint(f.root),before);await writeFile(join(f.root,'oversized.bin'),Buffer.alloc(8*1024*1024+1));assert.equal(await readXcodeLanguageConfigurationFingerprint(f.root),null);
});

test('duplicate target architecture requires explicit supported compiler settings instead of first-match guessing',async t=>{
  const f=await fixture(t,{output:output=>output.replaceAll('x86_64','arm64')});const p=await f.prepare();assert.equal(p.status,'unavailable');assert.deepEqual(p.targets,[]);
});
test('relative and forwarded external include paths are rejected',async t=>{
  for(const extraArgs of [['-I','../../outside'],['-Xcc','-I','-Xcc','../../outside'],['-I../../outside']]){const f=await fixture(t,{extraArgs});const p=await f.prepare();assert.equal(p.status,'unavailable');assert.match(p.reason,/outside/);}
});
test('a large duplicated compiler database stops at a bounded size with no usable configuration',async t=>{
  const f=await fixture(t,{sourceCount:80,extraArgs:['-D'+'A'.repeat(120000)]}),p=await f.prepare();assert.equal(p.status,'ready',p.reason);const result=await database(t,p);assert.equal(result.status,'unavailable');assert.match(result.reason,/limits/);assert.equal(result.configuration,undefined);
});

test('Xcode macOS path aliases normalize source argv, database paths and working directory together',async t=>{
 const alias=path=>path.replace(/^\/private(?=\/(?:tmp|var)\/)/,'');
 const f=await fixture(t,{mutate:async({args,list,sources,root})=>{await writeFile(list,sources.map(path=>escape(alias(path))).join('\n')+'\n');args[args.indexOf('-working-directory')+1]=alias(root);}});
 const p=await f.prepare();assert.equal(p.status,'ready',p.reason);const target=p.targets[0];assert.deepEqual(target.sourcePaths,f.sources);assert.ok(target.sourcePathAliases.every(item=>item.canonical.startsWith('/private/')&&item.observed===alias(item.canonical)));assert.equal(target.workingDirectory,f.root);assert.equal(target.compilerArguments[target.compilerArguments.indexOf('-working-directory')+1],f.root);for(const source of f.sources)assert.ok(target.compilerArguments.includes(source));const db=await database(t,p);assert.equal(db.status,'ready',db.reason);const rows=JSON.parse(await readFile(db.configuration.compilationDatabasePath,'utf8'));assert.deepEqual(rows.map(row=>row.file),f.sources);assert.ok(rows.every(row=>row.arguments.filter(arg=>arg.endsWith('.swift')).every(path=>f.sources.includes(path))));
});

test('joined and named compiler map paths cannot bypass self-contained settings',async t=>{
 for(const extraArgs of [['-Xcc','-fmodule-map-file=/outside/Module.modulemap'],['-vfsoverlay=/outside/map.yaml'],['-resource-dir=/outside'],['-fmodule-file=Foreign=/outside/Foreign.pcm'],['-Xcc','-fmodule-map-file','../../outside/Map'],['-Xfrontend','-explicit-swift-module-map-file=/outside/map.json']]){const f=await fixture(t,{extraArgs}),p=await f.prepare();assert.equal(p.status,'unavailable',extraArgs.join(' '));assert.match(p.reason,/outside/);}
});
