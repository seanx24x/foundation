import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { inspectPlatformReadiness, isPlatformReadinessInput, readPlatformInputFingerprint, runPlatformProbe } from '../src/platform-readiness.mjs';

async function fixture(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'foundation-platform-readiness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, value] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return root;
}
const inspect = (root, options = {}) => inspectPlatformReadiness({ root, trusted: true, platform: 'linux', ...options });
const find = (report, id) => report.checks.find(check => check.id === id);
const goodApple = async id => ({ status: 'passed', stdout: id === 'xcode-select' ? '/Applications/Xcode.app/Contents/Developer\n' : id === 'xcode-version' ? 'Xcode 27.2\nBuild version 18C500\n' : JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ name: 'Private device label', udid: 'private-udid', isAvailable: true }], 'com.apple.CoreSimulator.SimRuntime.watchOS-27-0': [{ isAvailable: true }] } }) });

function fakeProcess() {
  const process = new EventEmitter();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.kills = [];
  process.kill = signal => { process.kills.push(signal); queueMicrotask(() => process.emit('close', null, signal)); return true; };
  return process;
}

test('trust is required before local reads or tool probes, and no project is a useful unavailable result', async t => {
  let probes = 0;
  const blocked = await inspectPlatformReadiness({ root: '/a/private/unavailable/path', trusted: false, platform: 'darwin', probe: async () => { probes++; throw new Error('must not run'); } });
  assert.equal(blocked.status, 'unavailable');
  assert.match(blocked.reason, /trust/);
  assert.equal(blocked.inputFingerprint, null);
  assert.equal(probes, 0);
  const missing = await inspect('relative/path');
  assert.equal(missing.status, 'unavailable');
  assert.match(missing.reason, /Choose a local/);
  const root = await fixture(t);
  const empty = await inspect(root);
  assert.equal(empty.status, 'complete');
  assert.deepEqual(empty.project.kinds, []);
  assert.match(empty.reason, /No supported project markers/);
});

test('React and Vite are discovered from data without executing package scripts', async t => {
  const root = await fixture(t, {
    'package.json': { name: 'web-sample', dependencies: { react: '19', vite: '8' }, scripts: { postinstall: 'touch SENTINEL' } },
    'node_modules/vite/package.json': { name: 'vite', version: '8.0.13' },
  });
  const report = await inspect(root);
  assert.equal(report.status, 'complete');
  assert.equal(report.project.name, 'web-sample');
  assert.deepEqual(report.project.kinds, ['web']);
  assert.equal(find(report, 'package:package.json:vite').version, '8.0.13');
  assert.equal(report.capabilities.find(item => item.id === 'web-runtime').status, 'unverified');
  assert.match(find(report, 'node').detail, /does not verify the project/);
  assert.match(find(report, 'apple-host').detail, /require macOS/);
  await assert.rejects(readFile(join(root, 'SENTINEL')), { code: 'ENOENT' });
});

test('Expo and React Native metadata become available only after explicit data-only recheck', async t => {
  const root = await fixture(t, {
    'package.json': { name: 'expo-sample', dependencies: { expo: '^55', 'react-native': '^0.83' } },
    'app.json': { expo: { name: 'Example' } },
    'app.config.js': "throw new Error('must never execute configuration')",
  });
  const before = await inspect(root);
  assert.deepEqual(before.project.kinds, ['expo', 'react-native']);
  assert.equal(find(before, 'package:package.json:expo').status, 'missing');
  assert.equal(find(before, 'package:package.json:react-native').status, 'missing');
  assert.ok(before.project.markers.some(marker => marker.path === 'app.config.js' && marker.kind.includes('not evaluated')));
  for (const [name, version] of [['expo', '55.0.0'], ['react-native', '0.83.0']]) {
    await mkdir(join(root, 'node_modules', name), { recursive: true });
    await writeFile(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
  }
  const after = await inspect(root);
  assert.notEqual(before.inputFingerprint, after.inputFingerprint);
  assert.equal(find(after, 'package:package.json:expo').status, 'available');
  assert.equal(after.capabilities.find(item => item.id === 'expo-runtime').status, 'unavailable');
  assert.equal(await readPlatformInputFingerprint(root), after.inputFingerprint);
});

test('nested project targets are detected independently and Xcode does not imply SwiftUI', async t => {
  const root = await fixture(t, {
    'apps/site/package.json': { dependencies: { react: '19' } },
    'apps/phone/package.json': { dependencies: { expo: '55' } },
    'ios/Orbit.xcodeproj/project.pbxproj': '// Xcode project data',
    'ios/Orbit.xcworkspace/contents.xcworkspacedata': '<Workspace/>',
  });
  const report = await inspect(root);
  assert.deepEqual(report.project.kinds, ['expo', 'web', 'xcode']);
  assert.ok(!report.project.kinds.includes('swiftui'));
  assert.equal(report.project.markers.filter(item => item.kind.startsWith('Xcode')).length, 2);
  assert.equal(find(report, 'package:apps/phone/package.json:expo').status, 'missing');
});

test('SwiftUI import evidence excludes comments and string content and stays distinct from target membership', async t => {
  const root = await fixture(t, {
    'App.swift': '// import SwiftUI\n/* outer\n /* import SwiftUI */\nimport SwiftUI\n*/\nlet sample = """\nimport SwiftUI\n"""\nlet raw = #"import SwiftUI"#',
    'Package.swift': 'import PackageDescription\n',
  });
  const before = await inspect(root);
  assert.deepEqual(before.project.kinds, ['swift']);
  await writeFile(join(root, 'App.swift'), 'import SwiftUI\nstruct Example: View {}');
  const after = await inspect(root);
  assert.deepEqual(after.project.kinds, ['swift', 'swiftui']);
  assert.ok(after.project.markers.some(item => item.kind === 'SwiftUI import'));
  assert.equal(after.capabilities.find(item => item.id === 'swiftui-runtime').status, 'unavailable');
});

test('malformed and oversized metadata produce recovery without exposing source bytes', async t => {
  const root = await fixture(t, { 'package.json': '{ secret.invalid', 'app.json': '[]' });
  const invalid = await inspect(root);
  assert.equal(find(invalid, 'manifest:package.json').status, 'failed');
  assert.ok(!JSON.stringify(invalid).includes('secret.invalid'));
  await writeFile(join(root, 'package.json'), 'x'.repeat(262145));
  const large = await inspect(root);
  assert.equal(find(large, 'input:package.json').status, 'unknown');
  assert.match(find(large, 'input:package.json').detail, /256 KiB/);
});

test('linked project metadata and installed packages are not followed outside the root', async t => {
  const root = await fixture(t, { 'package.json': { dependencies: { expo: '55' } } });
  const outside = await fixture(t, { 'package.json': { name: 'expo', version: '55.0.0' }, 'Private.swift': 'import SwiftUI\n' });
  await mkdir(join(root, 'node_modules'));
  await symlink(outside, join(root, 'node_modules/expo'));
  await symlink(join(outside, 'Private.swift'), join(root, 'Private.swift'));
  const result = await inspect(root);
  assert.equal(find(result, 'package:package.json:expo').status, 'unknown');
  assert.ok(!result.project.kinds.includes('swiftui'));
  assert.ok(!JSON.stringify(result).includes(outside));
  const linkRoot = join(root, 'linked-root');
  await symlink(outside, linkRoot);
  assert.equal((await inspect(linkRoot)).status, 'unavailable');
});

test('installed package identity and semver must match rather than trusting arbitrary text', async t => {
  const root = await fixture(t, { 'package.json': { dependencies: { expo: '55' } }, 'node_modules/expo/package.json': { name: 'another-package', version: '55.0.0' } });
  assert.equal(find(await inspect(root), 'package:package.json:expo').status, 'unknown');
  await writeFile(join(root, 'node_modules/expo/package.json'), JSON.stringify({ name: 'expo', version: 'secret-url-or-script' }));
  const report = await inspect(root);
  assert.equal(find(report, 'package:package.json:expo').status, 'unknown');
  assert.ok(!JSON.stringify(report).includes('secret-url-or-script'));
});

test('Apple tooling result records versions and counts but no private device identities or runtime claims', async t => {
  const root = await fixture(t, { 'App.swift': 'import SwiftUI' });
  const ids = [];
  const report = await inspect(root, { platform: 'darwin', probe: async (id, options) => { ids.push(id); assert.ok('signal' in options); return goodApple(id); } });
  assert.deepEqual(ids, ['xcode-select', 'xcode-version', 'simulators']);
  assert.equal(find(report, 'xcode-select').status, 'available');
  assert.equal(find(report, 'xcode-version').version, '27.2');
  assert.match(find(report, 'simulators').detail, /^1 available iOS simulator/);
  assert.ok(!JSON.stringify(report).includes('private-udid'));
  assert.ok(!JSON.stringify(report).includes('Private device label'));
  assert.ok(!JSON.stringify(report).includes('/Applications/Xcode.app'));
  assert.equal(report.capabilities.find(item => item.id === 'project-build').status, 'unverified');
});

test('command-line tools, malformed simulator inventory and unavailable tools have concrete recovery', async t => {
  const root = await fixture(t);
  const report = await inspect(root, { platform: 'darwin', probe: async id => id === 'xcode-select' ? { status: 'passed', stdout: '/Library/Developer/CommandLineTools' } : id === 'xcode-version' ? { status: 'failed', stderr: 'private machine diagnostic' } : { status: 'passed', stdout: '{broken' } });
  assert.equal(find(report, 'xcode-select').status, 'missing');
  assert.match(find(report, 'xcode-select').recovery, /Locations/);
  assert.equal(find(report, 'xcode-version').status, 'failed');
  assert.equal(find(report, 'simulators').status, 'unknown');
  assert.ok(!JSON.stringify(report).includes('private machine diagnostic'));
  const noDevices = await inspect(root, { platform: 'darwin', probe: async id => id === 'simulators' ? { status: 'passed', stdout: '{"devices":{}}' } : goodApple(id) });
  assert.equal(find(noDevices, 'simulators').status, 'missing');
});

test('a source change during probes makes the report stale rather than granting current readiness', async t => {
  const root = await fixture(t, { 'package.json': { dependencies: { react: '19' } } });
  const report = await inspect(root, { platform: 'darwin', probe: async id => {
    if (id === 'xcode-version') await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { expo: '55' } }));
    return goodApple(id);
  } });
  assert.equal(report.status, 'stale');
  assert.match(report.reason, /changed during/);
  assert.notEqual(report.inputFingerprint, await readPlatformInputFingerprint(root));
});

test('cancelled inspection stops remaining probes and cannot finish as current', async t => {
  const root = await fixture(t, { 'package.json': { dependencies: { react: '19' } } });
  const signal = new AbortController();
  const calls = [];
  const report = await inspect(root, { platform: 'darwin', signal: signal.signal, probe: async id => { calls.push(id); signal.abort(); return { status: 'cancelled' }; } });
  assert.equal(report.status, 'cancelled');
  assert.deepEqual(calls, ['xcode-select']);
  const pre = new AbortController(); pre.abort();
  assert.equal((await inspect(root, { signal: pre.signal })).status, 'cancelled');
  assert.equal(await readPlatformInputFingerprint(root, { signal: pre.signal }), null);
});

test('freshness includes missing installed manifests, new markers and relevant source bytes only', async t => {
  const root = await fixture(t, { 'package.json': { dependencies: { expo: '55' } }, 'readme.txt': 'one' });
  const first = await readPlatformInputFingerprint(root);
  assert.equal(first, await readPlatformInputFingerprint(root));
  await writeFile(join(root, 'readme.txt'), 'two');
  assert.equal(first, await readPlatformInputFingerprint(root));
  await writeFile(join(root, 'App.swift'), 'import SwiftUI');
  assert.notEqual(first, await readPlatformInputFingerprint(root));
  assert.equal(isPlatformReadinessInput('../package.json'), false);
  assert.equal(isPlatformReadinessInput('/package.json'), false);
  assert.equal(isPlatformReadinessInput('ios/App.xcodeproj'), true);
  assert.equal(isPlatformReadinessInput('ios/App.xcodeproj/project.pbxproj'), true);
  assert.equal(isPlatformReadinessInput('node_modules/expo/package.json'), true);
  assert.equal(isPlatformReadinessInput('node_modules/arbitrary/package.json'), false);
  assert.equal(isPlatformReadinessInput('artifacts/secret/package.json'), false);
});

test('discovery bounds depth and inventory and reports omitted targets explicitly', async t => {
  const root = await fixture(t, { 'a/b/c/d/e/deep.swift': 'import SwiftUI' });
  const deep = await inspect(root);
  assert.ok(!deep.project.kinds.includes('swiftui'));
  assert.ok(deep.project.limitations.some(value => value.includes('four directory levels')));
  await Promise.all(Array.from({ length: 520 }, (_, index) => writeFile(join(root, `file-${index}.txt`), '')));
  const wide = await inspect(root);
  assert.ok(wide.project.limitations.some(value => value.includes('512 entries')));
});

test('fixed probe runner discloses only a fixed command and bounded environment without shell or project cwd', async () => {
  let request;
  const child = fakeProcess();
  const pending = runPlatformProbe('xcode-select', { spawnProcess: (...args) => { request = args; return child; } });
  child.stdout.write('/Applications/Xcode.app/Contents/Developer\n');
  child.emit('close', 0, null);
  const result = await pending;
  assert.equal(result.status, 'passed');
  assert.equal(request[0], '/usr/bin/xcode-select');
  assert.deepEqual(request[1], ['-p']);
  assert.equal(request[2].shell, false);
  assert.equal(request[2].cwd, '/');
  assert.equal(request[2].env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
  assert.equal(request[2].env.DEVELOPER_DIR, undefined);
  assert.equal(request[2].detached, true);
  let spawned = false;
  const unsupported = await runPlatformProbe('anything', { spawnProcess: () => { spawned = true; } });
  assert.equal(unsupported.status, 'unavailable');
  assert.equal(spawned, false);
});

test('probe cancellation terminates owned work and returns no buffered output', async () => {
  const child = fakeProcess();
  const controller = new AbortController();
  const pending = runPlatformProbe('simulators', { signal: controller.signal, spawnProcess: () => child });
  child.stdout.write('private partial output');
  controller.abort();
  const result = await pending;
  assert.deepEqual(child.kills, ['SIGTERM']);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.stdout, undefined);
});

test('probe timeout and output limit terminate work and cannot be mistaken for success', async () => {
  const timedChild = fakeProcess();
  const timed = await runPlatformProbe('xcode-version', { timeoutMs: 10, spawnProcess: () => timedChild });
  assert.equal(timed.status, 'timeout');
  assert.deepEqual(timedChild.kills, ['SIGTERM']);
  const outputChild = fakeProcess();
  const pending = runPlatformProbe('simulators', { spawnProcess: () => outputChild });
  outputChild.stdout.write(Buffer.alloc(65537));
  const output = await pending;
  assert.equal(output.status, 'output-limit');
  assert.equal(output.stdout, undefined);
  assert.deepEqual(outputChild.kills, ['SIGTERM']);
});

test('probe failures are bounded and invalid output never certifies tools', async () => {
  const child = fakeProcess();
  const failed = runPlatformProbe('xcode-version', { spawnProcess: () => child });
  child.emit('error', new Error('private failure'));
  assert.deepEqual(await failed, { status: 'failed', reason: 'Tool could not be started.' });
  assert.deepEqual(await runPlatformProbe('xcode-version', { spawnProcess: () => { throw new Error('private'); } }), { status: 'failed', reason: 'Tool could not be started.' });
});


test('special installed-package files never block inspection', async t => {
  if (process.platform === 'win32') return t.skip('POSIX FIFO test');
  const root = await fixture(t, { 'package.json': { dependencies: { expo: '55' } } });
  await mkdir(join(root, 'node_modules/expo'), { recursive: true });
  execFileSync('/usr/bin/mkfifo', [join(root, 'node_modules/expo/package.json')]);
  const result = await inspect(root);
  assert.equal(find(result, 'package:package.json:expo').status, 'unknown');
});

test('aggregate bytes and inspected-file totals have explicit bounds', async t => {
  const files = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`View${index}.swift`, '// ' + 'a'.repeat(230_000)]));
  const root = await fixture(t, files);
  const bytes = await inspect(root);
  assert.ok(bytes.project.limitations.some(value => value.includes('64 files or 4 MiB')));
  assert.ok(bytes.checks.some(check => check.status === 'unknown'));
  for (const path of Object.keys(files)) await writeFile(join(root, path), '// small');
  for (let i = 20; i < 70; i++) await writeFile(join(root, `View${i}.swift`), '// small');
  const count = await inspect(root);
  assert.ok(count.project.limitations.some(value => value.includes('64 files or 4 MiB')));
});

test('probe cleanup terminates a remaining owned helper after its launcher exits', async t => {
  if (process.platform === 'win32') return t.skip('POSIX process-group test');
  let owned;
  const script = `const {spawn}=require('node:child_process'); const helper=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(helper.pid); setTimeout(()=>process.exit(0),100);`;
  const result = await runPlatformProbe('xcode-version', { spawnProcess: (_file, _args, options) => {
    owned = spawn(process.execPath, ['-e', script], options);
    return owned;
  } });
  const helperPid = Number(result.stdout.trim());
  assert.ok(helperPid > 0);
  t.after(() => { try { process.kill(helperPid, 'SIGKILL'); } catch {} });
  assert.equal(result.status, 'passed');
  // The OS reaps the killed helper asynchronously; allow only that bounded delay.
  let alive = true;
  for (let i = 0; i < 20 && alive; i++) {
    try { process.kill(helperPid, 0); } catch { alive = false; break; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(alive, false);
});


test('app configuration rejects invalid object shapes and does not infer Expo from generic JSON', async t => {
  const root = await fixture(t);
  for (const value of [null, [], 'text', 0, false, { expo: null }, { expo: [] }, { expo: 'text' }, { expo: 0 }, { expo: false }]) {
    await writeFile(join(root, 'app.json'), JSON.stringify(value));
    const report = await inspect(root);
    const check = find(report, 'manifest:app.json');
    assert.equal(check?.status, 'failed', JSON.stringify(value));
    assert.match(check.recovery, /Correct the app configuration shape/);
    assert.ok(!report.project.markers.some(marker => marker.kind === 'Expo app configuration'));
    assert.ok(!report.project.kinds.includes('expo'));
  }
  await writeFile(join(root, 'app.json'), JSON.stringify({ name: 'Ordinary React Native app', displayName: 'Example' }));
  const generic = await inspect(root);
  assert.equal(find(generic, 'manifest:app.json'), undefined);
  assert.ok(!generic.project.markers.some(marker => marker.kind === 'Expo app configuration'));
  assert.ok(!generic.project.kinds.includes('expo'));
  await writeFile(join(root, 'app.json'), JSON.stringify({ expo: {} }));
  const expo = await inspect(root);
  assert.equal(find(expo, 'manifest:app.json'), undefined);
  assert.ok(expo.project.markers.some(marker => marker.kind === 'Expo app configuration'));
});
