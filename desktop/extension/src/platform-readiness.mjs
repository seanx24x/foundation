import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_ENTRIES = 512;
const MAX_DEPTH = 4;
const MAX_MARKERS = 64;
const MAX_INPUT_FILES = 64;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_CHECKS = 96;
const MAX_OUTPUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 10_000;
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.build', '.next', '.expo', 'Pods', 'build', 'dist', 'artifacts', 'DerivedData', '.upstream']);
const PROBES = Object.freeze({
  'xcode-select': Object.freeze({ file: '/usr/bin/xcode-select', args: Object.freeze(['-p']) }),
  'xcode-version': Object.freeze({ file: '/usr/bin/xcodebuild', args: Object.freeze(['-version']) }),
  'simulators': Object.freeze({ file: '/usr/bin/xcrun', args: Object.freeze(['simctl', 'list', 'devices', 'available', '--json']) }),
});
const digest = value => createHash('sha256').update(value).digest('hex');
const cancelled = signal => Boolean(signal?.aborted);
const within = (root, path) => path === root || path.startsWith(`${root}${sep}`);
const cleanText = (value, max = 120) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max) : '';
const cleanVersion = value => typeof value === 'string' && /^\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9.-]+)?$/.test(value) && value.length <= 64 ? value : undefined;
const checkedAt = () => new Date().toISOString();

/** This is a freshness predicate, not authority to read an arbitrary path. */
export function isPlatformReadinessInput(path) {
  if (typeof path !== 'string' || !path || path.length > 2048 || path.includes('\\') || isAbsolute(path)) return false;
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return false;
  const name = parts.at(-1);
  if (parts.includes('node_modules')) return /(?:^|\/)node_modules\/(?:expo|react-native|vite)\/package\.json$/.test(path);
  if (parts.some(part => SKIP_DIRECTORIES.has(part))) return false;
  return parts.length <= MAX_DEPTH + 2 && (name === 'package.json' || name === 'app.json' || /^app\.config\.(?:js|ts|mjs|cjs)$/.test(name) || name.endsWith('.swift') || name.endsWith('.xcodeproj') || name.endsWith('.xcworkspace') || /(?:^|\/)[^/]+\.xcodeproj\/project\.pbxproj$/.test(path) || /(?:^|\/)[^/]+\.xcworkspace\/contents\.xcworkspacedata$/.test(path));
}

async function safeRead(root, path, signal, remainingBytes) {
  if (cancelled(signal)) return { state: 'cancelled' };
  const full = resolve(root, path);
  if (!within(root, full) || full === root) return { state: 'unavailable' };
  // Refuse symlinked inputs (including package-manager links) rather than reading outside the selected root.
  const pieces = relative(root, full).split(sep);
  let cursor = root;
  try {
    for (let i = 0; i < pieces.length; i++) {
      cursor = join(cursor, pieces[i]);
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink() || (i < pieces.length - 1 ? !stat.isDirectory() : !stat.isFile())) return { state: 'unavailable' };
    }
    if (await realpath(full) !== full) return { state: 'unavailable' };
    const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      if (!before.isFile()) return { state: 'unavailable' };
      if (before.size > MAX_INPUT_BYTES) return { state: 'too-large' };
      if (before.size > remainingBytes) return { state: 'scan-limit' };
      const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const after = await file.stat();
      if (cancelled(signal)) return { state: 'cancelled' };
      if (bytesRead > MAX_INPUT_BYTES) return { state: 'too-large' };
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytesRead !== after.size || await realpath(full) !== full) return { state: 'changed' };
      return { state: 'read', bytes: bytesRead, text: buffer.subarray(0, bytesRead).toString('utf8'), hash: digest(buffer.subarray(0, bytesRead)) };
    } finally { await file.close(); }
  } catch (error) {
    return { state: error?.code === 'ENOENT' ? 'missing' : 'unavailable' };
  }
}

async function snapshotInputs(rootInput, signal) {
  let root = typeof rootInput === 'string' && isAbsolute(rootInput) ? resolve(rootInput) : null;
  if (!root) return { root: '', available: false, reason: 'Choose a local project folder.' };
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { root, available: false, reason: 'Choose a regular local project folder. Linked folders are not inspected.' };
    root = await realpath(root);
  } catch { return { root, available: false, reason: 'The project folder is unavailable. Reopen it and check again.' }; }
  const records = new Map();
  const files = new Map();
  const directories = [];
  const limitations = new Set();
  let entries = 0;
  let inputFiles = 0;
  let inputBytes = 0;
  async function read(path) {
    const value = inputFiles >= MAX_INPUT_FILES ? { state: 'scan-limit' } : await safeRead(root, path, signal, MAX_TOTAL_BYTES - inputBytes);
    inputFiles++;
    inputBytes += value.bytes || 0;
    if (value.state === 'scan-limit') limitations.add('Input inspection stopped at 64 files or 4 MiB. Open a more specific project folder for complete target metadata.');
    records.set(path, { state: value.state, ...(value.hash ? { hash: value.hash } : {}) });
    files.set(path, value);
  }
  async function visit(path, depth) {
    if (cancelled(signal)) return;
    let directory;
    try {
      const full = path ? join(root, path) : root;
      if (await realpath(full) !== full) { records.set(`${path}/`, { state: 'unavailable' }); return; }
      directory = await opendir(full);
      const children = [];
      try {
        for await (const entry of directory) {
          if (cancelled(signal)) break;
          if (++entries > MAX_ENTRIES) { limitations.add('Project discovery stopped at 512 entries. Open a more specific project folder to inspect omitted targets.'); break; }
          children.push(entry);
        }
      } finally { await directory.close().catch(() => {}); }
      children.sort((a, b) => a.name.localeCompare(b.name, 'en'));
      for (const entry of children) {
        if (cancelled(signal)) return;
        const child = path ? `${path}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) {
          if (isPlatformReadinessInput(child)) records.set(child, { state: 'unavailable' });
          continue;
        }
        if (entry.isDirectory()) {
          if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
          if (/\.(?:xcodeproj|xcworkspace)$/.test(entry.name)) {
            directories.push(child);
            records.set(`${child}/`, { state: 'directory' });
            await read(`${child}/${entry.name.endsWith('.xcodeproj') ? 'project.pbxproj' : 'contents.xcworkspacedata'}`);
          } else if (depth < MAX_DEPTH && entries <= MAX_ENTRIES) await visit(child, depth + 1);
          else limitations.add('Project discovery is bounded to four directory levels and 512 entries. Open a target folder to inspect deeper projects.');
        } else if (entry.isFile() && isPlatformReadinessInput(child)) {
          if (/^app\.config\.(?:js|ts|mjs|cjs)$/.test(entry.name)) {
            records.set(child, { state: 'not-evaluated' });
            limitations.add('Executable app configuration is not evaluated. Check it with the project’s own tooling when you are ready.');
          } else await read(child);
        }
      }
    } catch { records.set(`${path || '.'}/`, { state: 'unavailable' }); limitations.add('Some project folders could not be inspected. Reopen an accessible target folder and check again.'); }
  }
  await visit('', 0);
  // Resolve only the data manifests for explicitly declared supported packages.
  const packages = [];
  for (const [path, value] of files) {
    if (!path.endsWith('package.json') || value.state !== 'read') continue;
    let manifest;
    try { manifest = JSON.parse(value.text); } catch { continue; }
    if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') continue;
    packages.push({ path, manifest });
  }
  for (const { path, manifest } of packages) {
    const prefix = path.slice(0, -'package.json'.length);
    for (const name of ['expo', 'react-native', 'vite']) {
      if (Object.hasOwn(manifest.dependencies || {}, name) || Object.hasOwn(manifest.devDependencies || {}, name)) await read(`${prefix}node_modules/${name}/package.json`);
    }
  }
  const basis = [...records].sort(([a], [b]) => a.localeCompare(b, 'en'));
  return { root, available: true, files, records, directories: directories.sort(), packages, limitations: [...limitations], fingerprint: digest(JSON.stringify(basis)), cancelled: cancelled(signal) };
}

export async function readPlatformInputFingerprint(root, options = {}) {
  const snapshot = await snapshotInputs(root, options.signal);
  return snapshot.available && !snapshot.cancelled ? snapshot.fingerprint : null;
}

/** Fixed Apple tooling only. Never resolves binaries through a project PATH or starts project code. */
export function runPlatformProbe(id, options = {}) {
  const command = PROBES[id];
  if (!command) return Promise.resolve({ status: 'unavailable', reason: 'Unsupported diagnostic.' });
  if (cancelled(options.signal)) return Promise.resolve({ status: 'cancelled' });
  if (process.platform !== 'darwin' && !options.spawnProcess) return Promise.resolve({ status: 'unavailable', reason: 'Apple tooling requires macOS.' });
  return new Promise(resolveResult => {
    let child;
    let timer;
    let killTimer;
    let stopReason;
    let finished = false;
    let settling = false;
    let bytes = 0;
    const stdout = [];
    const stderr = [];
    const signal = options.signal;
    const stopGroup = type => {
      if (!child) return;
      try { if (child.pid > 0) process.kill(-child.pid, type); else child.kill(type); }
      catch { try { child.kill(type); } catch {} }
    };
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort); };
    const finish = result => { if (finished) return; finished = true; cleanup(); resolveResult(result); };
    const settle = result => {
      if (finished || settling) return;
      settling = true;
      cleanup();
      let ownedGroupAlive = false;
      if (child?.pid > 0) {
        try { process.kill(-child.pid, 0); ownedGroupAlive = true; } catch {}
      }
      if (!ownedGroupAlive) { finish(result); return; }
      // The launcher may exit before a helper. Keep escalation alive until all
      // processes in this diagnostic's private group have been terminated.
      stopGroup('SIGTERM');
      killTimer = setTimeout(() => { stopGroup('SIGKILL'); finish(result); }, 200);
    };
    const stop = reason => {
      if (finished || stopReason) return;
      stopReason = reason;
      stopGroup('SIGTERM');
      killTimer = setTimeout(() => stopGroup('SIGKILL'), 200);
    };
    const abort = () => stop('cancelled');
    try {
      child = (options.spawnProcess || spawn)(command.file, [...command.args], {
        cwd: '/', shell: false, detached: true, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C', ...(process.env.HOME ? { HOME: process.env.HOME } : {}), ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) },
      });
      const receive = target => chunk => {
        if (finished || stopReason) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > MAX_OUTPUT_BYTES) { stop('output-limit'); return; }
        target.push(buffer);
      };
      child.stdout?.on('data', receive(stdout));
      child.stderr?.on('data', receive(stderr));
      child.once('error', () => settle(stopReason ? { status: stopReason } : { status: 'failed', reason: 'Tool could not be started.' }));
      child.once('close', (code, exitSignal) => {
        if (stopReason) return settle({ status: stopReason });
        settle({ status: code === 0 ? 'passed' : 'failed', code: Number.isInteger(code) ? code : null, signal: exitSignal || null, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
      });
      timer = setTimeout(() => stop('timeout'), Math.min(PROBE_TIMEOUT_MS, Math.max(10, options.timeoutMs || PROBE_TIMEOUT_MS)));
      signal?.addEventListener('abort', abort, { once: true });
      if (cancelled(signal)) abort();
    } catch { finish({ status: 'failed', reason: 'Tool could not be started.' }); }
  });
}

function hasSwiftUIImport(source) {
  // Only recognize import tokens outside comments and string literals. A marker is
  // source evidence, not proof that an Xcode target includes or builds this file.
  let output = '';
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (source.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth) {
        if (source.startsWith('/*', index)) { depth++; index += 2; }
        else if (source.startsWith('*/', index)) { depth--; index += 2; }
        else { if (source[index] === '\n') output += '\n'; index++; }
      }
      output += ' ';
      continue;
    }
    const match = /^(#{0,16})("""|")/.exec(source.slice(index, index + 20));
    if (match) {
      const hashes = match[1];
      const quote = match[2];
      const close = quote + hashes;
      index += match[0].length;
      while (index < source.length) {
        if (source.startsWith(close, index)) { index += close.length; break; }
        if (!hashes && source.charCodeAt(index) === 92) { index += 2; continue; }
        if (source[index] === '\n') output += '\n';
        index++;
      }
      output += ' ';
      continue;
    }
    output += source[index++];
  }
  return /^\s*(?:@\w+(?:\([^\n]*\))?\s+)*import\s+SwiftUI\b/m.test(output);
}

function projectDescription(input) {
  const kinds = new Set();
  const markers = [];
  const checks = [];
  const limitations = new Set(input.limitations);
  const addMarker = (path, kind) => { if (markers.length < MAX_MARKERS) markers.push({ path, kind }); else limitations.add('Only the first 64 project markers are shown. Open a target folder to narrow discovery.'); };
  let name = basename(input.root);
  for (const path of input.directories) { kinds.add('xcode'); addMarker(path, path.endsWith('.xcodeproj') ? 'Xcode project' : 'Xcode workspace'); }
  for (const [path, value] of input.files) {
    if (value.state !== 'read') {
      if (!path.split('/').includes('node_modules')) checks.push({ id: `input:${path}`, platform: 'project', label: path, status: value.state === 'missing' ? 'missing' : 'unknown', detail: value.state === 'too-large' ? 'This input exceeds the 256 KiB inspection limit.' : 'This input could not be safely inspected.', recovery: 'Open the target folder and inspect the file locally, then check again.' });
      continue;
    }
    if (path.endsWith('.swift') && !path.split('/').includes('node_modules')) {
      kinds.add('swift');
      if (hasSwiftUIImport(value.text)) { kinds.add('swiftui'); addMarker(path, 'SwiftUI import'); }
      else if (path.endsWith('Package.swift')) addMarker(path, 'Swift package');
    }
    if (path.endsWith('package.json') && !path.split('/').includes('node_modules')) {
      let manifest;
      try { manifest = JSON.parse(value.text); } catch {
        checks.push({ id: `manifest:${path}`, platform: 'project', label: path, status: 'failed', detail: 'The package manifest is not valid JSON.', recovery: 'Correct the manifest in the editor, then check again.' }); continue;
      }
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        checks.push({ id: `manifest:${path}`, platform: 'project', label: path, status: 'failed', detail: 'The package manifest must be a JSON object.', recovery: 'Correct the manifest in the editor, then check again.' }); continue;
      }
      if (path === 'package.json') name = cleanText(manifest.name) || name;
      const declared = name => Object.hasOwn(manifest.dependencies || {}, name) || Object.hasOwn(manifest.devDependencies || {}, name);
      const expo = declared('expo');
      const native = declared('react-native');
      const web = declared('vite') || (declared('react') && !expo && !native);
      if (expo) { kinds.add('expo'); addMarker(path, 'Expo dependency'); }
      if (native) { kinds.add('react-native'); addMarker(path, 'React Native dependency'); }
      if (web) { kinds.add('web'); addMarker(path, declared('vite') ? 'Vite dependency' : 'React dependency'); }
      for (const dependency of ['expo', 'react-native', 'vite']) {
        if (!declared(dependency)) continue;
        const installedPath = `${path.slice(0, -'package.json'.length)}node_modules/${dependency}/package.json`;
        const installed = input.files.get(installedPath);
        let version;
        if (installed?.state === 'read') {
          try { const data = JSON.parse(installed.text); if (data.name === dependency) version = cleanVersion(data.version); } catch {}
        }
        checks.push({ id: `package:${path}:${dependency}`, platform: dependency === 'vite' ? 'web' : 'expo', label: `${dependency} · ${path}`, status: version ? 'available' : installed?.state === 'missing' ? 'missing' : 'unknown', detail: version ? `Installed package metadata reports ${version}. Compatibility and project execution have not been verified.` : installed?.state === 'missing' ? 'No installed package metadata was found beside this manifest.' : 'The installed version could not be verified. Linked, oversized or invalid package metadata is not followed.', ...(version ? { version } : {}), ...(version ? {} : { recovery: 'Use the project’s documented dependency setup, then check again. Foundation does not install packages during this check.' }) });
      }
    }
    if (path.endsWith('app.json') && !path.split('/').includes('node_modules')) {
      let data;
      try { data = JSON.parse(value.text); }
      catch { checks.push({ id: `manifest:${path}`, platform: 'project', label: path, status: 'failed', detail: 'The app configuration is not valid JSON.', recovery: 'Correct the JSON configuration, then check again.' }); continue; }
      const object = item => item !== null && typeof item === 'object' && !Array.isArray(item);
      if (!object(data) || (Object.hasOwn(data, 'expo') && !object(data.expo))) {
        checks.push({ id: `manifest:${path}`, platform: 'project', label: path, status: 'failed', detail: 'The app configuration must be a JSON object. If present, its expo entry must also be an object.', recovery: 'Correct the app configuration shape in the editor, then check again.' });
      } else if (Object.hasOwn(data, 'expo')) addMarker(path, 'Expo app configuration');
    }
  }
  // Symlinks and executable configuration remain explicit even when no bytes were read.
  for (const [path, value] of input.records) {
    if (value.state === 'not-evaluated') addMarker(path, 'Executable configuration · not evaluated');
    else if (value.state === 'unavailable' && !input.files.has(path)) limitations.add(`Linked or unavailable input was not followed: ${cleanText(path, 240)}`);
  }
  if (checks.length > MAX_CHECKS) limitations.add('Only the first 96 input checks are shown. Open a target folder to narrow discovery.');
  return { project: { name, kinds: [...kinds].sort(), markers: markers.sort((a, b) => a.path.localeCompare(b.path, 'en') || a.kind.localeCompare(b.kind, 'en')), limitations: [...limitations].slice(0, 32) }, checks: checks.slice(0, MAX_CHECKS) };
}

function appleCheck(id, label, result) {
  const base = { id, platform: 'apple', label };
  if (result.status === 'cancelled') return { ...base, status: 'unknown', detail: 'The check was cancelled.', recovery: 'Check again when ready.' };
  if (result.status !== 'passed') {
    const reason = result.status === 'timeout' ? 'The tool did not respond within 10 seconds.' : result.status === 'output-limit' ? 'The tool exceeded the diagnostic output limit.' : 'The tool is unavailable or returned an error.';
    return { ...base, status: result.status === 'unavailable' ? 'unavailable' : 'failed', detail: reason, recovery: 'Open Xcode to complete its setup and resolve any license or component prompts yourself, then check again.' };
  }
  if (id === 'xcode-select') {
    const value = result.stdout?.trim();
    if (typeof value !== 'string' || !isAbsolute(value) || value.length > 2048 || /[\r\n\u0000]/.test(value)) return { ...base, status: 'unknown', detail: 'The selected developer directory could not be interpreted.', recovery: 'Check Xcode’s Command Line Tools selection in Settings, then check again.' };
    const fullXcode = /\.app\/Contents\/Developer\/?$/.test(value);
    return { ...base, status: fullXcode ? 'available' : 'missing', detail: fullXcode ? 'A full Xcode developer directory is selected.' : 'Full Xcode is not selected; standalone command-line tools do not provide the iOS Simulator.', ...(fullXcode ? {} : { recovery: 'Install or open Xcode and select it under Xcode Settings → Locations → Command Line Tools, then check again.' }) };
  }
  if (id === 'xcode-version') {
    const version = /^Xcode ([0-9]+(?:\.[0-9]+){0,2}(?:[A-Za-z0-9 .-]{0,32})?)\s*$/m.exec(result.stdout || '')?.[1];
    return version ? { ...base, status: 'available', version, detail: `Xcode ${version} responds. Project builds and tests have not been run.` } : { ...base, status: 'unknown', detail: 'The Xcode version response could not be interpreted.', recovery: 'Open Xcode to verify its setup, then check again.' };
  }
  try {
    const data = JSON.parse(result.stdout);
    if (!data || typeof data.devices !== 'object' || Array.isArray(data.devices) || !data.devices) throw new Error('Invalid devices');
    let count = 0;
    for (const [runtime, devices] of Object.entries(data.devices)) {
      if (!Array.isArray(devices)) throw new Error('Invalid devices');
      if (!runtime.includes('.iOS-')) continue;
      count += devices.filter(device => device && typeof device === 'object' && device.isAvailable === true).length;
    }
    return { ...base, status: count ? 'available' : 'missing', detail: count ? `${count} available iOS simulator ${count === 1 ? 'device is' : 'devices are'} listed. No simulator was booted.` : 'No available iOS simulator devices were listed.', ...(count ? {} : { recovery: 'Add an iOS runtime and simulator device in Xcode, then check again.' }) };
  } catch { return { ...base, status: 'unknown', detail: 'The simulator inventory could not be interpreted.', recovery: 'Inspect Devices and Simulators in Xcode, then check again.' }; }
}

export async function inspectPlatformReadiness(options = {}) {
  const root = typeof options.root === 'string' && isAbsolute(options.root) ? resolve(options.root) : '';
  const base = { schemaVersion: 1, root, checkedAt: checkedAt(), inputFingerprint: null, status: 'unavailable', project: { name: root ? basename(root) : 'Project', kinds: [], markers: [], limitations: [] }, checks: [], capabilities: [] };
  if (options.trusted !== true) return { ...base, reason: 'Workspace trust is required before inspecting project files or local tools.' };
  if (cancelled(options.signal)) return { ...base, status: 'cancelled', reason: 'The check was cancelled.' };
  const input = await snapshotInputs(root, options.signal);
  if (input.cancelled || cancelled(options.signal)) return { ...base, status: 'cancelled', reason: 'The check was cancelled.' };
  if (!input.available) return { ...base, reason: input.reason };
  const described = projectDescription(input);
  const checks = [{ id: 'node', platform: 'host', label: 'Foundation JavaScript runtime', status: 'available', version: process.versions.node, detail: `Foundation’s bundled Node.js ${process.versions.node} is running. This does not verify the project’s shell Node version or its engine requirements.` }, ...described.checks];
  const platform = options.platform || process.platform;
  if (platform === 'darwin') {
    const probe = options.probe || runPlatformProbe;
    const labels = { 'xcode-select': 'Selected developer tools', 'xcode-version': 'Xcode', simulators: 'iOS Simulator devices' };
    for (const id of Object.keys(labels)) {
      if (cancelled(options.signal)) return { ...base, ...described, inputFingerprint: input.fingerprint, checks, status: 'cancelled', reason: 'The check was cancelled. Check again for a complete report.' };
      let result;
      try { result = await probe(id, { signal: options.signal }); } catch { result = { status: 'failed' }; }
      checks.push(appleCheck(id, labels[id], result || { status: 'failed' }));
    }
  } else {
    checks.push({ id: 'apple-host', platform: 'apple', label: 'Apple development tools', status: 'unavailable', detail: 'Xcode and iOS Simulator checks require macOS.', recovery: 'Open this project in Foundation on a Mac for Apple tooling checks.' });
  }
  const capabilities = [
    { id: 'project-build', label: 'Build and tests', status: 'unverified', detail: 'Setup inspection does not compile the project or run tests.' },
    { id: 'web-runtime', label: 'Connected web preview', status: 'unverified', detail: 'The existing React/Vite adapter requires a separate running-project connection and development instrumentation.' },
    { id: 'swiftui-runtime', label: 'SwiftUI runtime inspection', status: 'unavailable', detail: 'Foundation’s SwiftUI runtime adapter is not implemented. Xcode availability does not establish preview capture or element-to-source mapping.' },
    { id: 'expo-runtime', label: 'Expo / React Native runtime inspection', status: 'unavailable', detail: 'Foundation’s native runtime adapter is not implemented. Package detection does not establish a development build, request capture or source mapping.' },
  ];
  if (cancelled(options.signal)) return { ...base, ...described, inputFingerprint: input.fingerprint, checks, capabilities, status: 'cancelled', reason: 'The check was cancelled. Check again for a complete report.' };
  const current = await snapshotInputs(root, options.signal);
  const changed = !current.available || current.cancelled || current.fingerprint !== input.fingerprint;
  return { ...base, ...described, checkedAt: checkedAt(), inputFingerprint: input.fingerprint, checks, capabilities, status: cancelled(options.signal) ? 'cancelled' : changed ? 'stale' : 'complete', ...(cancelled(options.signal) ? { reason: 'The check was cancelled.' } : changed ? { reason: 'Project inputs changed during the check. Check again for current results.' } : described.project.kinds.length ? {} : { reason: 'No supported project markers were found within the bounded scan. Open the target project folder and check again.' }) };
}
