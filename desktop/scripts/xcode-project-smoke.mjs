import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { readFile, writeFile, mkdir, mkdtemp, realpath, readdir, open, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.argv.length, 2, 'Usage: FOUNDATION_APP_PATH=/candidate/Foundation.app node desktop/scripts/xcode-project-smoke.mjs');
assert.ok(process.env.FOUNDATION_APP_PATH, 'Select the exact isolated signed candidate');
const app = await realpath(process.env.FOUNDATION_APP_PATH);
const extensionPath = await realpath(path.join(app, 'Contents/Resources/app/extensions/foundation-workspace'));
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
const temp = await realpath(await mkdtemp('/private/tmp/foundation-xcode-project-smoke-'));
const workspace = path.join(temp, 'workspace'), userData = path.join(temp, 'user-data');
const extensions = path.join(temp, 'extensions'), harness = path.join(extensions, 'foundation-test.xcode-project-native-check-1.0.0');
const reportPath = path.join(temp, 'report.json');
const hash = value => createHash('sha256').update(value).digest('hex');
const hashTree = async root => {
  const files = [];
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      assert.equal(item.isSymbolicLink(), false, 'Acceptance inputs are ordinary files');
      if (item.isDirectory()) await visit(file);
      else if (item.isFile()) { const bytes = await readFile(file); files.push({ path: path.relative(root, file).split(path.sep).join('/'), bytes: bytes.length, sha256: hash(bytes) }); }
    }
  }
  await visit(root); return files.sort((a, b) => a.path.localeCompare(b.path));
};
const payload = await hashTree(extensionPath);
const binarySha256 = hash(await readFile(path.join(app, 'Contents/MacOS/Foundation')));
const fixture = path.join(path.dirname(desktop), 'fixtures/swiftui');
const fixtureManifest = await hashTree(fixture);
const destinationId = process.env.FOUNDATION_XCODE_DESTINATION_ID;
const destinationName = process.env.FOUNDATION_XCODE_DESTINATION_NAME || 'Foundation-M5-02-Fixture';
assert.match(destinationId || '', /^[A-Fa-f0-9-]{36}$/, 'Supply the exact owned simulator UUID from fixture feasibility');
assert.ok(destinationName.startsWith('Foundation-'), 'Acceptance selects an explicitly owned Foundation simulator');
await Promise.all([mkdir(path.join(userData, 'User'), { recursive: true }), mkdir(harness, { recursive: true })]);
await cp(fixture, workspace, { recursive: true });
await Promise.all([
  writeFile(path.join(temp, 'unrelated-draft.txt'), 'Preserve this unrelated native editor draft.\n'),
  writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({ 'foundation.openOnStartup': false, 'foundation.ai.baseUrl': '', 'foundation.ai.model': '', 'foundation.ai.profiles': {}, 'chat.disableAIFeatures': true, 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'workbench.startupEditor': 'none', 'window.confirmBeforeClose': 'never', 'security.workspace.trust.enabled': false, 'files.hotExit': 'onExitAndWindowClose', 'files.autoSave': 'off', 'window.zoomLevel': -2, 'workbench.colorTheme': 'Foundation Dark' })),
  writeFile(path.join(harness, 'package.json'), JSON.stringify({ name: 'xcode-project-native-check', publisher: 'foundation-test', version: '1.0.0', engines: { vscode: '^1.100.0' }, main: 'index.cjs', activationEvents: ['onStartupFinished'] })),
  writeFile(path.join(harness, 'index.cjs'), await readFile(path.join(desktop, 'tests/native-xcode-project-smoke.cjs'))),
]);
const initialFixture = await hashTree(workspace);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJSON = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; } };
const wait = async (check, label, timeout = 30000) => { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { const value = await check(); if (value) return value; } catch (error) { last = error; } await pause(80); } throw Error(`${label}: ${last?.message || 'timed out'}`); };
const debugPort = async () => { const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; };
const withTarget = async (browser, targetId, callback) => {
  const root = await browser.newBrowserCDPSession(); let sessionId, serial = 0; const pending = new Map();
  const listener = event => { if (event.sessionId !== sessionId) return; const value = JSON.parse(event.message), item = pending.get(value.id); if (!item) return; pending.delete(value.id); clearTimeout(item.timer); value.error ? item.reject(Error(value.error.message)) : item.resolve(value.result); };
  const detached = event => { if (event.sessionId === sessionId) for (const item of pending.values()) item.reject(Error('Native Xcode renderer detached')); };
  try {
    sessionId = (await root.send('Target.attachToTarget', { targetId, flatten: false })).sessionId;
    root.on('Target.receivedMessageFromTarget', listener); root.on('Target.detachedFromTarget', detached);
    const send = async (method, params = {}) => { const id = ++serial, result = new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(`Native renderer timeout: ${method}`)); }, 10000); pending.set(id, { resolve, reject, timer }); }); await root.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }); return result; };
    return await callback(send);
  } finally { root.off('Target.receivedMessageFromTarget', listener); root.off('Target.detachedFromTarget', detached); for (const item of pending.values()) clearTimeout(item.timer); if (sessionId) await root.send('Target.detachFromTarget', { sessionId }).catch(() => {}); await root.detach(); }
};
const readOn = async (send, frame, expression) => { const result = await send('Runtime.evaluate', { expression, contextId: frame.contextId, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
const evaluate = (browser, frame, expression) => withTarget(browser, frame.targetId, send => readOn(send, frame, expression));
const nativeWorkbench = async browser => {
  const session = await browser.newBrowserCDPSession(); let targets;
  try { targets = (await session.send('Target.getTargets')).targetInfos; } finally { await session.detach(); }
  const matches = targets.filter(target => target.type === 'page' && target.url.includes('/workbench/workbench.html')); assert.equal(matches.length, 1, 'One isolated native workbench');
  return withTarget(browser, matches[0].targetId, async send => { const { frameTree } = await send('Page.getFrameTree'); const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'foundationXcodeProjectWorkbench' }); return { targetId: matches[0].targetId, contextId: executionContextId }; });
};
const xcodeFrame = browser => wait(async () => {
  const session = await browser.newBrowserCDPSession(); let targets; try { targets = (await session.send('Target.getTargets')).targetInfos; } finally { await session.detach(); }
  const matches = [];
  for (const target of targets.filter(item => item.url.startsWith('vscode-webview://'))) {
    try { await withTarget(browser, target.targetId, async send => { const { frameTree } = await send('Page.getFrameTree'); const visit = async node => {
      const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: node.frame.id, worldName: 'foundationXcodeProjectSmoke' }); const frame = { targetId: target.targetId, frameId: node.frame.id, contextId: executionContextId };
      if (await readOn(send, frame, 'Boolean(document.querySelector("#xcode-project-root"))')) matches.push(frame);
      for (const child of node.childFrames || []) await visit(child);
    }; await visit(frameTree); }); } catch {}
  }
  assert.ok(matches.length <= 1, 'One Xcode Project renderer'); return matches[0];
}, 'Xcode Project renderer');
const activations = [];
const keyboard = async (browser, frame, selector, key = 'Enter') => withTarget(browser, frame.targetId, async send => {
  await wait(() => readOn(send, frame, `Boolean(document.querySelector(${JSON.stringify(selector)})?.getClientRects().length&&!document.querySelector(${JSON.stringify(selector)}).disabled)`), 'Native Xcode control ready');
  const entry = { selector, key, physicalKeyboard: false }; activations.push(entry);
  entry.before = await readOn(send, frame, `(async()=>{for(let attempt=0;attempt<5;attempt++){const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||!e.getClientRects().length)continue;e.scrollIntoView({block:'nearest'});e.focus();await new Promise(r=>setTimeout(r,120));if(document.activeElement!==e||!document.hasFocus())continue;const observed={element:e,events:[]};observed.listener=event=>observed.events.push({type:event.type,key:event.key,trusted:event.isTrusted,same:event.target===e});globalThis.__xcodeKeys=observed;for(const type of ['keydown','keyup','click'])window.addEventListener(type,observed.listener,true);return {focused:true,documentFocused:true};}return {focused:document.activeElement===document.querySelector(${JSON.stringify(selector)}),documentFocused:document.hasFocus()};})()`);
  assert.equal(entry.before.focused, true); assert.equal(entry.before.documentFocused, true);
  const code = key === ' ' ? 'Space' : 'Enter', windowsVirtualKeyCode = key === ' ' ? 32 : 13;
  try { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, text: key === ' ' ? ' ' : '\r' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode }); }
  finally { entry.events = await readOn(send, frame, `(()=>{const observed=globalThis.__xcodeKeys;for(const type of ['keydown','keyup','click'])window.removeEventListener(type,observed.listener,true);delete globalThis.__xcodeKeys;return observed.events;})()`); }
  assert.ok(entry.events.some(event => event.type === 'keydown' && event.trusted && event.same));
  assert.equal(entry.events.filter(event => event.type === 'click' && event.trusted && event.same).length, 1, 'Exactly one native control activation');
});
const pick = async (browser, main, title, preferred) => withTarget(browser, main.targetId, async send => {
  const read = expression => readOn(send, main, expression);
  const widget = "[...document.querySelectorAll('.quick-input-widget')].find(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden')";
  const initial = await wait(() => read(`(()=>{const w=${widget};if(!w||!w.textContent.includes(${JSON.stringify(title)}))return null;return {text:w.innerText,labels:[...w.querySelectorAll('.monaco-list-row .label-name')].map(e=>e.textContent.trim())};})()`), 'Native picker: ' + title, 60000);
  const labels = initial.labels.filter(label => label === preferred || label.includes(preferred));
  assert.equal(labels.length, 1, 'Exactly one intended native picker choice: ' + JSON.stringify(initial));
  const label = labels[0], entry = { type: 'quick-pick', title, selectedLabel: label, physicalKeyboard: false, availableLabels: initial.labels };
  activations.push(entry);
  await read(`(()=>{const w=${widget},input=w.querySelector('input');if(!input)throw Error('Missing native picker input');input.focus();input.select();})()`);
  await send('Input.insertText', { text: label });
  await wait(() => read(`(()=>{const w=${widget};if(!w)return false;const labels=[...w.querySelectorAll('.monaco-list-row .label-name')].map(e=>e.textContent.trim());return labels.length===1&&labels[0]===${JSON.stringify(label)};})()`), 'Exact filtered native picker choice');
  entry.before = await read(`(()=>{const w=${widget},input=w.querySelector('input');const observed={element:input,events:[]};observed.listener=e=>observed.events.push({type:e.type,key:e.key,trusted:e.isTrusted,same:e.target===input});globalThis.__xcodePickerKeys=observed;for(const type of ['keydown','keyup'])window.addEventListener(type,observed.listener,true);return {focused:document.activeElement===input,documentFocused:document.hasFocus()};})()`);
  assert.equal(entry.before.focused, true); assert.equal(entry.before.documentFocused, true);
  try { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); }
  finally { entry.events = await read(`(()=>{const o=globalThis.__xcodePickerKeys;for(const type of ['keydown','keyup'])window.removeEventListener(type,o.listener,true);delete globalThis.__xcodePickerKeys;return o.events;})()`); }
  assert.equal(entry.events.filter(e => e.type === 'keydown' && e.key === 'Enter' && e.trusted && e.same).length, 1, 'Exactly one native picker acceptance');
});
const readUI = (browser, frame) => evaluate(browser, frame, `(()=>({phase:document.querySelector('#xcode-project-root')?.dataset.phase,text:document.body.textContent,theme:document.body.dataset.vscodeThemeName,buttons:[...document.querySelectorAll('button')].map(e=>({id:e.id,action:e.dataset.action,text:e.textContent.trim(),disabled:e.disabled})),overflow:document.documentElement.scrollWidth>innerWidth+1,width:innerWidth,height:innerHeight}))()`);
const activeGroups = new Set();
const groupAlive = pid => { try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
const stopGroup = async pid => { if (!activeGroups.has(pid)) return; for (const signal of ['SIGTERM', 'SIGKILL']) { if (!groupAlive(pid)) break; try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } const end = Date.now() + 3000; while (groupAlive(pid) && Date.now() < end) await pause(100); } assert.equal(groupAlive(pid), false, `Owned native process ${pid} did not exit`); activeGroups.delete(pid); };
// A failed native check still owns any build launched from this exact copied fixture.
// Xcode operations use detached process groups, separate from the app's group.
const stopOwnedBuilds = async () => {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,command='], { encoding: 'utf8' }).split('\n');
  for (const row of rows) {
    const match = row.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match || !match[3].includes('xcodebuild') || !match[3].includes(path.join(workspace, 'FoundationOrbit.xcodeproj')) || !match[3].includes('-derivedDataPath')) continue;
    const pid = Number(match[1]), group = Number(match[2]);
    assert.equal(pid, group, 'Only the exact owned detached Xcode process group may be stopped');
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      if (!groupAlive(group)) break;
      try { process.kill(-group, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      const end = Date.now() + 3000; while (groupAlive(group) && Date.now() < end) await pause(80);
    }
    assert.equal(groupAlive(group), false, 'Owned Xcode process group stopped');
  }
};
let stopping = false;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(signal, async () => { if (stopping) return; stopping = true; await Promise.all([...activeGroups].map(stopGroup)); await stopOwnedBuilds(); process.exit(code); });
let browser;
try {
  for (const stage of ['write', 'restore']) {
    assert.equal(stopping, false); const port = await debugPort(), ipc = path.join(temp, `${stage}-ipc`), outcome = path.join(temp, `${stage}-outcome.json`); await mkdir(ipc);
    const env = { ...process.env, FOUNDATION_XCODE_STAGE: stage, FOUNDATION_XCODE_APP: app, FOUNDATION_XCODE_OUTCOME: outcome, FOUNDATION_XCODE_REPORT: reportPath, FOUNDATION_XCODE_IPC: ipc, FOUNDATION_XCODE_EXTENSION: extensionPath, FOUNDATION_XCODE_WORKSPACE: workspace, FOUNDATION_XCODE_DESTINATION_ID: destinationId, FOUNDATION_XCODE_DESTINATION_NAME: destinationName };
    for (const key of Object.keys(env)) if (key === 'ELECTRON_RUN_AS_NODE' || /^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key)) delete env[key];
    const log = await open(path.join(temp, `${stage}.log`), 'w');
    const child = spawn(path.join(app, 'Contents/MacOS/Foundation'), [workspace, '--new-window', '--user-data-dir', userData, '--shared-data-dir', path.join(temp, 'shared-data'), '--extensions-dir', extensions, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-crash-reporter', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { env, detached: true, stdio: ['ignore', log.fd, log.fd] });
    if (child.pid) activeGroups.add(child.pid); await log.close(); let exited = false, exitCode, spawnError; child.once('exit', code => { exited = true; exitCode = code; }); child.once('error', error => { spawnError = error; exited = true; });
    let index = 1, result; const deadline = Date.now() + 900000;
    try {
      while (!(result = await readJSON(outcome))) {
        if (spawnError) throw spawnError; if (exited) throw Error(`${stage} exited ${exitCode} before outcome: ${temp}`); if (Date.now() > deadline) throw Error(`${stage} timed out: ${temp}`);
        const command = await readJSON(path.join(ipc, `command-${index}.json`)); if (!command) { await pause(80); continue; }
        let response;
        try {
          browser ||= await wait(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }), 'Isolated native endpoint');
          const main = await nativeWorkbench(browser); await withTarget(browser, main.targetId, send => send('Page.bringToFront'));
          const frame = await xcodeFrame(browser);
          if (command.type === 'discover') {
            await keyboard(browser, frame, '[data-action="discover"]');
            await pick(browser, main, 'Choose Xcode project', 'FoundationOrbit');
            await pick(browser, main, 'Choose scheme', 'FoundationOrbit');
            await pick(browser, main, 'Choose Simulator destination', destinationName);
          } else if (command.type === 'destination') {
            await keyboard(browser, frame, '[data-action="destination"]');
            await pick(browser, main, 'Choose Simulator destination', command.name || destinationName);
          } else if (command.type === 'activate') {
            assert.ok(['build', 'test', 'cancel'].includes(command.action)); await keyboard(browser, frame, `[data-action="${command.action}"]`, command.key || 'Enter');
          } else if (command.type === 'inspect') {
            if (command.text) await wait(async () => (await readUI(browser, frame)).text.includes(command.text), 'Expected Xcode copy');
          } else if (command.type === 'cancelBuild') {
            await keyboard(browser, frame, '[data-action="build"]');
            const observed = await wait(() => {
              const rows = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
              const matches = rows.map(row => row.trim()).filter(row => row.includes('xcodebuild') && row.includes(workspace) && row.includes('-derivedDataPath')); return matches.length ? matches : false;
            }, 'Actual owned xcodebuild before cancellation');
            assert.equal(observed.length, 1, 'One owned Xcode build command');
            command.ownedXcodeBeforeCancel = observed[0];
            await keyboard(browser, frame, '[data-action="cancel"]');
          } else if (command.type === 'screenshot') {
            assert.ok(/^[a-z-]+$/.test(command.name)); if (command.theme) await wait(async () => (await readUI(browser, frame)).theme === command.theme, 'Xcode native theme');
            await evaluate(browser, frame, 'window.scrollTo(0,0)');
            const screenshot = await withTarget(browser, main.targetId, send => send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }));
            await writeFile(path.join(temp, `${stage}-${command.name}.png`), Buffer.from(screenshot.data, 'base64'));
          } else throw Error(`Unknown Xcode action ${command.type}`);
          const renderer = await readUI(browser, frame); assert.equal(renderer.overflow, false, 'Xcode Project has no horizontal overflow'); response = { passed: true, renderer: { ...renderer, ...(command.ownedXcodeBeforeCancel ? { ownedXcodeBeforeCancel: command.ownedXcodeBeforeCancel } : {}) } };
        } catch (error) { response = { passed: false, error: error.stack || String(error) }; }
        await writeFile(path.join(ipc, `result-${index}.json`), JSON.stringify(response)); index++;
      }
      assert.equal(result.passed, true, `${stage}: ${result.error || 'Missing passing result'}. See ${temp}`);
      await wait(() => exited, 'Graceful native shutdown', 20000); assert.equal(exitCode, 0);
    } finally { await browser?.close().catch(() => {}); browser = undefined; await stopGroup(child.pid); }
  }
  assert.deepEqual(await hashTree(extensionPath), payload, 'Candidate payload is unchanged during acceptance');
  const finalFixture = await hashTree(workspace);
  assert.deepEqual(finalFixture, initialFixture, 'All maintained fixture sources remain exact after guarded recovery');
  assert.deepEqual(await hashTree(fixture), fixtureManifest, 'The maintained SwiftUI fixture remains unchanged');
  const report = { ...await readJSON(reportPath), passed: true, mode: 'packaged', app, extensionPath, workspace, temp, userData, destinationId, destinationName, nativeActivations: activations, provenance: { signature: 'codesign --verify --deep --strict passed', binarySha256, payload, fixtureManifest, initialFixture, finalFixture }, verificationBoundary: 'Actual packaged Xcode Project workflow against a copied maintained SwiftUI fixture and explicitly owned iOS Simulator. Scheme and destination are chosen through native QuickPicks. Build, XCTest, cancellation, source freshness and restored editor draft have independent evidence. This does not certify Swift language-editor integration, interactive preview, source mapping, networking, pixels or physical keyboard/display latency. No provider or dependency installation.' };
  assert.equal(report.restoredInSecondProcess, true); await mkdir(path.join(desktop, '.build'), { recursive: true }); const output = path.join(desktop, '.build/native-xcode-project-smoke-report.json'); const previous = await readJSON(output); if (previous) await writeFile(path.join(temp, 'previous-report.json'), JSON.stringify(previous, null, 2)); await writeFile(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: true, temp, app, checks: report.checks, restoredInSecondProcess: report.restoredInSecondProcess, nativeActivations: activations.length }, null, 2));
} catch (error) { await writeFile(path.join(temp, 'failure.json'), JSON.stringify({ passed: false, error: error.stack || String(error), temp, app, workspace }, null, 2)); throw error; }
finally { await writeFile(path.join(temp, 'native-activations.json'), JSON.stringify(activations, null, 2)); await browser?.close().catch(() => {}); await Promise.all([...activeGroups].map(stopGroup)); await stopOwnedBuilds(); }
