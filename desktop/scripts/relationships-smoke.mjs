import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, writeFile, mkdir, mkdtemp, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length > 2) throw new Error('Usage: node desktop/scripts/relationships-smoke.mjs (packaged app only)');
const app = await realpath(process.env.FOUNDATION_APP_PATH || path.join(desktop, '.build/Foundation.app'));
const extensionPath = await realpath(path.join(app, 'Contents/Resources/app/extensions/foundation-workspace'));
const temp = await realpath(await mkdtemp('/private/tmp/foundation-relationships-smoke-'));
const workspace = path.join(temp, 'workspace'), userData = path.join(temp, 'user-data'), extensions = path.join(temp, 'extensions');
const harness = path.join(extensions, 'foundation-test.relationships-native-check-1.0.0'), ipc = path.join(temp, 'ipc');
const reportPath = path.join(temp, 'report.json'), outcome = path.join(temp, 'outcome.json');
await Promise.all([mkdir(path.join(workspace, 'src'), { recursive: true }), mkdir(path.join(userData, 'User'), { recursive: true }), mkdir(harness, { recursive: true }), mkdir(ipc)]);
const fixture = {
  'package.json': JSON.stringify({ name: 'foundation-relationships-fixture', private: true }),
  'src/App.tsx': "import { SaveButton } from './SaveButton';\nexport function App() { return <SaveButton state='idle' />; }\n",
  'src/SaveButton.tsx': "import { saveProfile } from './api';\nimport type { SaveState } from './types';\nimport './styles.css';\nexport function SaveButton({ state }: { state: SaveState }) {\n  const save = async () => { await saveProfile(); };\n  return <button onClick={save}>{state}</button>;\n}\n",
  'src/api.ts': "export async function saveProfile() {\n  return fetch('/api/profile?token=PRIVATE_QUERY_VALUE#state', { method: 'POST' });\n}\n",
  'src/types.ts': "export type SaveState = 'idle' | 'loading' | 'error';\n",
  'src/styles.css': ':root { --button-radius: 8px; }\nbutton { border-radius: var(--button-radius); }\n',
  'src/SaveButton.test.ts': "import { SaveButton } from './SaveButton';\nexport const subject = SaveButton;\n",
  'src/SaveButton.spec.tsx': "export const filenameCandidateOnly = true;\n",
  'src/Draft.ts': "export const unfinished = 'original saved draft';\n",
};
await Promise.all(Object.entries(fixture).map(([name, text]) => writeFile(path.join(workspace, name), text)));
await Promise.all([
  writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({
    'foundation.openOnStartup': true, 'foundation.ai.baseUrl': '', 'foundation.ai.model': '', 'foundation.ai.profiles': {},
    'chat.disableAIFeatures': true, 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'workbench.startupEditor': 'none',
    'window.confirmBeforeClose': 'never', 'security.workspace.trust.enabled': false, 'files.hotExit': 'onExitAndWindowClose', 'files.autoSave': 'off',
  })),
  writeFile(path.join(harness, 'package.json'), JSON.stringify({ name: 'relationships-native-check', publisher: 'foundation-test', version: '1.0.0', engines: { vscode: '^1.100.0' }, main: 'index.cjs', activationEvents: ['onStartupFinished'] })),
  writeFile(path.join(harness, 'index.cjs'), await readFile(path.join(desktop, 'tests/native-relationships-smoke.cjs'))),
]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJSON = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; } };
const debugPort = async () => {
  const server = createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
};
const wait = async (check, label, timeout = 25000) => {
  const deadline = Date.now() + timeout; let lastError;
  while (Date.now() < deadline) { try { const value = await check(); if (value) return value; } catch (error) { lastError = error; } await pause(100); }
  throw new Error(`Timed out: ${label}${lastError ? ` (${lastError.message})` : ''}`);
};
// Code OSS's own automation driver attaches webview targets explicitly: their
// nested OOPIFs are not reliably present in Playwright's page.frames inventory.
// Keep this test transport outside the product; it never calls acquireVsCodeApi
// or injects host messages, application state, or persisted context.
const targetCommand = async (browser, targetId, method, params = {}) => {
  const rootSession = await browser.newBrowserCDPSession(); let sessionId, listener, detachedListener, timeout;
  try {
    sessionId = (await rootSession.send('Target.attachToTarget', { targetId, flatten: false })).sessionId;
    const response = new Promise((resolve, reject) => {
      listener = event => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message); if (message.id !== 1) return;
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      };
      detachedListener = event => { if (event.sessionId === sessionId) reject(new Error(`Native renderer detached during ${method}`)); };
      rootSession.on('Target.receivedMessageFromTarget', listener); rootSession.on('Target.detachedFromTarget', detachedListener);
      timeout = setTimeout(() => reject(new Error(`Native renderer command timed out: ${method}`)), 10000);
    });
    const [, result] = await Promise.all([rootSession.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method, params }) }), response]);
    return result;
  } finally {
    if (listener) rootSession.off('Target.receivedMessageFromTarget', listener);
    if (detachedListener) rootSession.off('Target.detachedFromTarget', detachedListener);
    clearTimeout(timeout);
    if (sessionId) await rootSession.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    await rootSession.detach();
  }
};
const evaluate = async (browser, frame, expression) => {
  const result = await targetCommand(browser, frame.targetId, 'Runtime.evaluate', { expression, contextId: frame.contextId, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const surfaceFrame = async (browser, surface) => wait(async () => {
  const session = await browser.newBrowserCDPSession(); let targets;
  try { targets = (await session.send('Target.getTargets')).targetInfos; } finally { await session.detach(); }
  const candidates = targets.filter(target => target.url.startsWith('vscode-webview://'));
  const matches = [];
  for (const target of candidates) {
    try {
      const { frameTree } = await targetCommand(browser, target.targetId, 'Page.getFrameTree');
      const visit = async node => {
        const { executionContextId } = await targetCommand(browser, target.targetId, 'Page.createIsolatedWorld', { frameId: node.frame.id, worldName: 'foundationRelationshipsSmoke' });
        const frame = { targetId: target.targetId, contextId: executionContextId };
        if (await evaluate(browser, frame, 'document.body?.dataset.foundationSurface') === surface) matches.push(frame);
        for (const child of node.childFrames || []) await visit(child);
      };
      await visit(frameTree);
    } catch {}
  }
  assert.ok(matches.length <= 1, `Only one live ${surface} surface may exist`);
  return matches[0];
}, `actual native ${surface} renderer`);
const control = (selector, code) => `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Native control is missing'); ${code} })()`;
const pressControl = async (browser, frame, selector) => {
  await evaluate(browser, frame, control(selector, 'element.focus(); if (document.activeElement !== element) throw new Error("Native control did not receive focus"); return true;'));
  await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ', unmodifiedText: ' ', windowsVirtualKeyCode: 32 });
  await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
};
const inspectRelationships = async (browser, frame) => evaluate(browser, frame, `(() => {
  const region = document.querySelector('[aria-label="Feature relationships"]');
  if (!region) return null;
  return { source: region.querySelector('select[aria-label="Relationship source"]')?.value,
    busy: region.getAttribute('aria-busy') === 'true', text: region.textContent,
    rows: [...region.querySelectorAll('[data-evidence-id]')].map(row => ({ id: row.dataset.evidenceId,
      sourceDisabled: row.querySelector('.relationship-evidence-link')?.disabled,
      definitionDisabled: row.querySelector('[data-design-focus$="/definition"]')?.disabled,
      sourceLabel: row.querySelector('.relationship-evidence-link')?.getAttribute('aria-label') })),
  };
})()`);
const port = await debugPort();
const environment = { ...process.env, FOUNDATION_RELATIONSHIPS_OUTCOME: outcome, FOUNDATION_RELATIONSHIPS_REPORT: reportPath,
  FOUNDATION_RELATIONSHIPS_IPC: ipc, FOUNDATION_RELATIONSHIPS_EXTENSION: extensionPath, FOUNDATION_RELATIONSHIPS_WORKSPACE: workspace };
for (const key of Object.keys(environment)) if (key === 'ELECTRON_RUN_AS_NODE' || /^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key)) delete environment[key];
const log = await open(path.join(temp, 'native.log'), 'w');
// A normally installed fixture extension keeps production lifecycle behavior.
// Every writable directory, including Code OSS shared storage, is disposable.
const child = spawn(path.join(app, 'Contents/MacOS/Foundation'), [workspace, '--new-window', '--user-data-dir', userData,
  '--shared-data-dir', path.join(temp, 'shared-data'), '--extensions-dir', extensions,
  '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-crash-reporter',
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { env: environment, stdio: ['ignore', log.fd, log.fd] });
await log.close();
let browser, exited = false, exitCode, spawnError;
child.once('exit', code => { exited = true; exitCode = code; }); child.once('error', error => { exited = true; spawnError = error; });
const deadline = Date.now() + 180000; let commandIndex = 1, result;
try {
  while (!(result = await readJSON(outcome))) {
    if (spawnError) throw spawnError;
    if (exited) throw new Error(`Native app exited before reporting (${exitCode}). See ${temp}`);
    if (Date.now() > deadline) throw new Error(`Native relationship check timed out. See ${temp}`);
    const command = await readJSON(path.join(ipc, `command-${commandIndex}.json`));
    if (!command) { await pause(100); continue; }
    let answer;
    try {
      if (!browser) browser = await wait(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }), 'isolated native renderer debugging endpoint');
      const frame = await surfaceFrame(browser, 'workspace');
      let selector;
      if (['source', 'definition'].includes(command.type)) {
        assert.equal(typeof command.evidenceId, 'string');
        selector = `[aria-label="Feature relationships"] [data-evidence-id=${JSON.stringify(command.evidenceId)}] [data-design-focus=${JSON.stringify(`relationship/${command.evidenceId}/${command.type}`)}]`;
      } else if (command.type === 'explore') {
        assert.equal(typeof command.path, 'string');
        selector = `[aria-label="Feature relationships"] button[aria-label=${JSON.stringify(`Explore ${command.path}`)}]`;
      } else if (['back', 'reset', 'refresh'].includes(command.type)) {
        const labels = { back: 'Back in relationships', reset: 'Reset relationships', refresh: 'Refresh relationships' };
        selector = `[aria-label="Feature relationships"] button[aria-label=${JSON.stringify(labels[command.type])}]`;
      } else assert.equal(command.type, 'inspect', 'Only actual relationship controls and read-only inspection are allowed');
      if (selector) {
        assert.equal(await evaluate(browser, frame, control(selector, 'return element.disabled;')), false, 'Only enabled native relationship controls may be activated');
        await pressControl(browser, frame, selector);
      }
      const renderer = await wait(async () => {
        const state = await inspectRelationships(browser, frame);
        return state && (!command.expectedSource || state.source === command.expectedSource && !state.busy) && state;
      }, 'native relationship region');
      answer = { passed: true, renderer };
    } catch (error) { answer = { passed: false, error: error.stack || String(error) }; }
    await writeFile(path.join(ipc, `result-${commandIndex}.json`), JSON.stringify(answer)); commandIndex++;
  }
  assert.equal(result.passed, true, `${result.error || 'No successful result'}. See ${temp}`);
  while (!exited && Date.now() < deadline) await pause(100);
  assert.equal(exited, true); assert.equal(exitCode, 0);
  const report = { ...await readJSON(reportPath), passed: true, mode: 'packaged', app, extensionPath, workspace, temp,
    interactionVerification: 'Actual packaged Foundation relationship controls operated through native CDP keyboard input; native source editor locations and disposable file bytes checked through VS Code APIs.',
    nativeVisualAcceptance: 'Not performed by this automated check', ai: 'disconnected' };
  await writeFile(path.join(desktop, '.build', 'native-relationships-smoke-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (!exited) { try { child.kill('SIGTERM'); } catch {} }
  throw error;
} finally { await browser?.close().catch(() => {}); }
