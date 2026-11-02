import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { readFile, writeFile, mkdir, mkdtemp, realpath, cp, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// This check consumes real, already-finished native scenario evidence. It never
// fabricates observations, changes source, or launches the project's runtime.
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert.ok(args.length <= 1 && args.every(arg => arg.startsWith('--scenario-report=')), 'Usage: node desktop/scripts/observation-comparison-smoke.mjs [--scenario-report=/absolute/report.json]');
assert.ok(process.env.FOUNDATION_APP_PATH, 'Set FOUNDATION_APP_PATH to the exact signed candidate used by scenario-smoke');
const app = await realpath(process.env.FOUNDATION_APP_PATH);
const extensionPath = await realpath(path.join(app, 'Contents/Resources/app/extensions/foundation-workspace'));
const scenarioReportPath = await realpath(args[0]?.slice('--scenario-report='.length) || path.join(desktop, '.build/native-scenario-smoke-report.json'));
const scenarioBytes = await readFile(scenarioReportPath);
const scenario = JSON.parse(scenarioBytes);
assert.equal(scenario.passed, true); assert.equal(scenario.mode, 'packaged'); assert.equal(scenario.restoredInSecondProcess, true);
assert.equal(await realpath(scenario.app), app); assert.equal(await realpath(scenario.extensionPath), extensionPath);
assert.equal(scenario.ai, 'disconnected'); assert.equal(scenario.providerRequests, 0);
const scenarioTemp = await realpath(scenario.temp), workspace = await realpath(scenario.workspace);
assert.match(scenarioTemp, /^\/private\/tmp\/foundation-scenario-smoke-[A-Za-z0-9]+$/);
assert.equal(workspace, path.join(scenarioTemp, 'workspace'));
assert.equal(await realpath(path.join(scenarioTemp, 'user-data')), path.join(scenarioTemp, 'user-data'));
const ps = (await promisify(execFile)('/bin/ps', ['-axo', 'pid=,command='])).stdout;
assert.ok(!ps.split('\n').some(line => line.includes('--user-data-dir') && line.includes(path.join(scenarioTemp, 'user-data'))), 'The baseline scenario profile must have exited before copying its User data');
const temp = await realpath(await mkdtemp('/private/tmp/foundation-observation-comparison-smoke-'));
const userData = path.join(temp, 'user-data'), extensions = path.join(temp, 'extensions');
const harness = path.join(extensions, 'foundation-test.observation-comparison-native-check-1.0.0');
const reportPath = path.join(temp, 'report.json'), baselinePath = path.join(temp, 'scenario-report.json');
await mkdir(userData); await mkdir(harness, { recursive: true });
// Copy only the closed disposable profile's User directory. Root-level process
// locks and native sockets are excluded; the original scenario profile is intact.
await cp(path.join(scenarioTemp, 'user-data/User'), path.join(userData, 'User'), { recursive: true, errorOnExist: true, force: false });
await Promise.all([
  writeFile(baselinePath, scenarioBytes),
  writeFile(path.join(harness, 'package.json'), JSON.stringify({ name: 'observation-comparison-native-check', publisher: 'foundation-test', version: '1.0.0', engines: { vscode: '^1.100.0' }, main: 'index.cjs', activationEvents: ['onStartupFinished'] })),
  writeFile(path.join(harness, 'index.cjs'), await readFile(path.join(desktop, 'tests/native-observation-comparison-smoke.cjs'))),
]);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceManifest = async () => {
  const entries = [];
  const visit = async directory => {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git', 'dist', '.vite'].includes(item.name)) continue;
      const filename = path.join(directory, item.name), relative = path.relative(workspace, filename);
      assert.ok(!item.isSymbolicLink(), `Unexpected source symlink: ${relative}`);
      if (item.isDirectory()) await visit(filename);
      else if (item.isFile()) entries.push({ path: relative, sha256: digest(await readFile(filename)) });
    }
  };
  await visit(workspace); return entries;
};
const beforeSources = await sourceManifest();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJSON = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; } };
const wait = async (check, label, timeout = 25000) => {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { const value = await check(); if (value) return value; } catch (error) { last = error; } await pause(100); }
  throw Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
};
const debugPort = async () => {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
};
// Read and operate the actual native webview through its renderer target. Only
// buttons/disclosures use trusted keyboard input. Selects use a standard
// selectOption-equivalent DOM operation on the visible native control, explicitly
// recorded as synthetic. No host messages, acquireVsCodeApi, renderer closures,
// or application handlers are injected.
const withTarget = async (browser, targetId, callback) => {
  const root = await browser.newBrowserCDPSession(); let sessionId, serial = 0; const pending = new Map();
  const listener = event => {
    if (event.sessionId !== sessionId) return;
    const value = JSON.parse(event.message), item = pending.get(value.id); if (!item) return;
    pending.delete(value.id); clearTimeout(item.timer); value.error ? item.reject(Error(value.error.message)) : item.resolve(value.result);
  };
  const detached = event => { if (event.sessionId === sessionId) for (const item of pending.values()) item.reject(Error('Native comparison renderer detached')); };
  try {
    sessionId = (await root.send('Target.attachToTarget', { targetId, flatten: false })).sessionId;
    root.on('Target.receivedMessageFromTarget', listener); root.on('Target.detachedFromTarget', detached);
    const send = async (method, params = {}) => {
      const id = ++serial, result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`Native renderer timeout: ${method}`)); }, 10000);
        pending.set(id, { resolve, reject, timer });
      });
      await root.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }); return result;
    };
    return await callback(send);
  } finally {
    root.off('Target.receivedMessageFromTarget', listener); root.off('Target.detachedFromTarget', detached);
    for (const item of pending.values()) clearTimeout(item.timer);
    if (sessionId) await root.send('Target.detachFromTarget', { sessionId }).catch(() => {}); await root.detach();
  }
};
const readOn = async (send, frame, expression) => {
  const value = await send('Runtime.evaluate', { expression, contextId: frame.contextId, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text); return value.result.value;
};
const evaluate = (browser, frame, expression) => withTarget(browser, frame.targetId, send => readOn(send, frame, expression));
const surfaceFrame = browser => wait(async () => {
  const session = await browser.newBrowserCDPSession(); let targets;
  try { targets = (await session.send('Target.getTargets')).targetInfos; } finally { await session.detach(); }
  const matches = [];
  for (const target of targets.filter(item => item.url.startsWith('vscode-webview://'))) {
    try {
      await withTarget(browser, target.targetId, async send => {
        const { frameTree } = await send('Page.getFrameTree');
        const visit = async node => {
          const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: node.frame.id, worldName: 'foundationObservationComparisonSmoke' });
          const frame = { targetId: target.targetId, contextId: executionContextId };
          if (await readOn(send, frame, 'document.body?.dataset.foundationSurface') === 'workspace') matches.push(frame);
          for (const child of node.childFrames || []) await visit(child);
        }; await visit(frameTree);
      });
    } catch {}
  }
  assert.ok(matches.length <= 1, 'Only one native Foundation workspace may be live'); return matches[0];
}, 'native Foundation workspace renderer');
const activations = [];
const keyboard = async (browser, frame, selector, key, expectClick = false) => withTarget(browser, frame.targetId, async send => {
  const entry = { selector, key, dispatched: false }; activations.push(entry);
  entry.before = await readOn(send, frame, `(async()=>{const selector=${JSON.stringify(selector)};for(let n=0;n<3;n++){const element=document.querySelector(selector);if(!element||element.disabled||!element.getClientRects().length)continue;element.scrollIntoView({block:'nearest'});element.focus();await new Promise(r=>setTimeout(r,120));if(element===document.querySelector(selector)&&document.activeElement===element&&!element.disabled&&document.hasFocus()){const observed={element,events:[]};observed.listener=event=>observed.events.push({type:event.type,key:event.key,trusted:event.isTrusted,same:event.target===element,value:element.value});globalThis.__comparisonKeys=observed;for(const type of ['keydown','keyup','click','change'])document.addEventListener(type,observed.listener,true);return {ready:true,tag:element.tagName,value:element.value};}}return {ready:false,hasFocus:document.hasFocus(),active:document.activeElement?.tagName};})()`);
  assert.equal(entry.before.ready, true, `Native focus readiness: ${JSON.stringify(entry.before)}`);
  const keys = { Enter: ['Enter', 13, '\r'], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38] };
  assert.ok(keys[key]); const [code, windowsVirtualKeyCode, text] = keys[key]; entry.dispatched = true;
  try {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(text ? { text, unmodifiedText: text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  } finally {
    entry.events = await readOn(send, frame, `(()=>{const observed=globalThis.__comparisonKeys;for(const type of ['keydown','keyup','click','change'])document.removeEventListener(type,observed.listener,true);delete globalThis.__comparisonKeys;return observed.events;})()`);
  }
  assert.ok(entry.events.some(event => event.type === 'keydown' && event.key === key && event.trusted && event.same), 'Trusted keyboard input must reach the exact native control');
  if (expectClick) assert.equal(entry.events.filter(event => event.type === 'click' && event.trusted && event.same).length, 1, 'One trusted activation; never retry after dispatch');
});
const disclosure = async (browser, frame, selector) => {
  await wait(() => evaluate(browser, frame, `Boolean(document.querySelector(${JSON.stringify(selector)}))`), 'native disclosure exists');
  if (!await evaluate(browser, frame, `document.querySelector(${JSON.stringify(selector)}).parentElement.open`)) {
    await keyboard(browser, frame, selector, 'Enter', true);
    await wait(() => evaluate(browser, frame, `document.querySelector(${JSON.stringify(selector)}).parentElement.open`), 'native disclosure expands');
  }
};
const selectValue = async (browser, frame, label, value) => {
  const selector = `select[aria-label=${JSON.stringify(label)}]`;
  const entry = { selector, value, method: 'native-renderer selectOption-equivalent', trustedKeyboard: false };
  activations.push(entry);
  // macOS native select popups do not reliably process synthetic CDP arrow
  // input. This is the same control-level operation as Playwright selectOption;
  // it exercises the actual renderer's change listener without host injection.
  // Physical keyboard behavior remains a separate manual acceptance boundary.
  entry.before = await evaluate(browser, frame, `(()=>{const element=document.querySelector(${JSON.stringify(selector)}),value=${JSON.stringify(value)};if(!element||element.disabled||!element.getClientRects().length)throw Error('Observation select is not interactive');const option=[...element.options].find(item=>item.value===value&&!item.disabled);if(!option)throw Error('Requested saved observation is unavailable');const before={value:element.value,label:option.textContent,options:[...element.options].map(item=>item.value)};element.scrollIntoView({block:'nearest'});element.focus();element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));return before;})()`);
  await wait(async () => await evaluate(browser, frame, `document.querySelector(${JSON.stringify(selector)}).value`) === value, 'explicit observation selection takes effect');
};
const inspectUI = (browser, frame) => evaluate(browser, frame, `(()=>{const region=document.querySelector('[aria-label="Observation comparison"]');return {baseline:document.querySelector('select[aria-label="Baseline observation"]')?.value,comparison:document.querySelector('select[aria-label="Comparison observation"]')?.value,regionText:region?.textContent||'',visibleText:region?.innerText||'',theme:document.body.dataset.vscodeThemeName,themeKind:document.body.dataset.vscodeThemeKind,buttons:[...(region?.querySelectorAll('button')||[])].map(x=>({text:x.textContent,disabled:x.disabled})),text:document.body.innerText};})()`);
let browser;
try {
  for (const stage of ['write', 'restore']) {
    const port = await debugPort(), ipc = path.join(temp, `${stage}-ipc`), outcome = path.join(temp, `${stage}-outcome.json`); await mkdir(ipc);
    const env = { ...process.env, FOUNDATION_OBSERVATION_STAGE: stage, FOUNDATION_OBSERVATION_OUTCOME: outcome, FOUNDATION_OBSERVATION_REPORT: reportPath, FOUNDATION_OBSERVATION_BASELINE: baselinePath, FOUNDATION_OBSERVATION_IPC: ipc, FOUNDATION_OBSERVATION_EXTENSION: extensionPath, FOUNDATION_OBSERVATION_WORKSPACE: workspace };
    for (const key of Object.keys(env)) if (key === 'ELECTRON_RUN_AS_NODE' || /^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key)) delete env[key];
    const log = await open(path.join(temp, `${stage}.log`), 'w');
    const child = spawn(path.join(app, 'Contents/MacOS/Foundation'), [workspace, '--new-window', '--user-data-dir', userData, '--shared-data-dir', path.join(temp, 'shared-data'), '--extensions-dir', extensions, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-crash-reporter', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { env, stdio: ['ignore', log.fd, log.fd] }); await log.close();
    let exited = false, exitCode, spawnError; child.once('exit', code => { exited = true; exitCode = code; }); child.once('error', error => { exited = true; spawnError = error; });
    const end = Date.now() + 180000; let index = 1, outcomeValue;
    try {
      while (!(outcomeValue = await readJSON(outcome))) {
        if (spawnError) throw spawnError; if (exited) throw Error(`${stage} exited (${exitCode}) before reporting: ${temp}`); if (Date.now() > end) throw Error(`${stage} timed out: ${temp}`);
        const command = await readJSON(path.join(ipc, `command-${index}.json`)); if (!command) { await pause(100); continue; }
        let response;
        try {
          browser ||= await wait(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }), 'isolated native debugging endpoint');
          const page = browser.contexts().flatMap(context => context.pages()).find(item => item.url().includes('/workbench/workbench.html')); assert.ok(page); await page.bringToFront();
          const frame = await surfaceFrame(browser);
          if (command.type === 'open') {
            await disclosure(browser, frame, 'details.feature-runtime-details > summary');
            const selector = await wait(async () => evaluate(browser, frame, `(()=>{const summary=[...document.querySelectorAll('summary')].find(item=>item.textContent.trim()==='Compare observations');return summary?.dataset.artifactFocus||summary?.dataset.designFocus;})()`), 'Compare observations summary');
            await disclosure(browser, frame, `summary[data-artifact-focus=${JSON.stringify(selector)}],summary[data-design-focus=${JSON.stringify(selector)}]`);
          } else if (command.type === 'select') {
            assert.ok(['Baseline observation', 'Comparison observation'].includes(command.label)); assert.ok([scenario.completedRun.id, scenario.unfinishedRunId].includes(command.value));
            await selectValue(browser, frame, command.label, command.value);
          } else if (command.type === 'action') {
            assert.ok(['Swap observations', 'Clear comparison'].includes(command.label));
            const selector = await evaluate(browser, frame, `(()=>{const button=[...document.querySelectorAll('[aria-label="Observation comparison"] button')].find(item=>item.textContent.trim()===${JSON.stringify(command.label)});return button?.dataset.artifactFocus||button?.dataset.designFocus;})()`); assert.ok(selector);
            await keyboard(browser, frame, `[aria-label="Observation comparison"] button[data-artifact-focus=${JSON.stringify(selector)}],[aria-label="Observation comparison"] button[data-design-focus=${JSON.stringify(selector)}]`, 'Enter', true);
          } else if (command.type === 'expandEvidence') {
            for (let n = 0; n < 30; n++) {
              const selector = await evaluate(browser, frame, `(()=>{const summary=[...document.querySelectorAll('[aria-label="Observation comparison"] details:not([open]) > summary')].find(item=>item.getClientRects().length);return summary?.dataset.artifactFocus||summary?.dataset.designFocus;})()`);
              if (!selector) break;
              await disclosure(browser, frame, `summary[data-artifact-focus=${JSON.stringify(selector)}],summary[data-design-focus=${JSON.stringify(selector)}]`);
              assert.ok(n < 29, 'Bounded evidence disclosures');
            }
          } else if (command.type === 'capture') {
            assert.ok(['Foundation Dark', 'Foundation Light'].includes(command.theme));
            await wait(async () => (await inspectUI(browser, frame)).theme === command.theme, 'isolated theme applied');
            await evaluate(browser, frame, `document.querySelector('[aria-label="Observation comparison"]').scrollIntoView({block:'start'});`);
            await page.screenshot({ path: path.join(temp, `${stage}-${command.theme === 'Foundation Dark' ? 'dark' : 'light'}.png`) });
          } else assert.equal(command.type, 'inspect');
          response = { passed: true, renderer: await inspectUI(browser, frame) };
        } catch (error) { response = { passed: false, error: error.stack || String(error) }; }
        await writeFile(path.join(ipc, `result-${index}.json`), JSON.stringify(response)); index++;
      }
      assert.equal(outcomeValue.passed, true, `${stage}: ${outcomeValue.error || 'No successful result'}. See ${temp}`);
      while (!exited && Date.now() < end) await pause(100);
      assert.equal(exited, true, `Native fixture must quit gracefully: ${temp}`); assert.equal(exitCode, 0);
    } catch (error) { if (!exited) child.kill('SIGTERM'); throw error; }
    finally { await browser?.close().catch(() => {}); browser = undefined; }
  }
  assert.deepEqual(await sourceManifest(), beforeSources, 'Comparison does not mutate any fixture source/configuration bytes');
  assert.equal(digest(await readFile(scenarioReportPath)), digest(scenarioBytes), 'Original scenario report remains unchanged');
  const report = { ...await readJSON(reportPath), passed: true, mode: 'packaged', app, extensionPath, workspace, temp, userData, scenarioReportPath, scenarioReportSHA256: digest(scenarioBytes), sourceManifest: beforeSources, nativeActivations: activations, nativeVisualAcceptance: 'Automated native captures only; human review is separate', verificationBoundary: 'Read-only inspection, trusted native button/disclosure keys, and synthetic native-renderer selectOption-equivalent selections. Physical keyboard and human visual acceptance are separate. AI is disconnected; no conversation, runtime, source, or historical evidence mutation. This does not prove visual parity or runtime behavior.' };
  assert.equal(report.restoredInSecondProcess, true);
  const output = path.join(desktop, '.build/native-observation-comparison-smoke-report.json');
  const existing = await readJSON(output); if (existing) await writeFile(path.join(temp, 'previous-comparison-report.json'), JSON.stringify(existing, null, 2));
  await writeFile(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(path.join(temp, 'failure.json'), JSON.stringify({ passed: false, error: error.stack || String(error), app, workspace, temp }, null, 2)); throw error;
} finally { await writeFile(path.join(temp, 'native-activations.json'), JSON.stringify(activations, null, 2)); await browser?.close().catch(() => {}); }
