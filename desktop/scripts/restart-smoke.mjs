import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, writeFile, mkdir, mkdtemp, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length > 2) throw new Error('Usage: node desktop/scripts/restart-smoke.mjs (packaged app only)');
const app = await realpath(process.env.FOUNDATION_APP_PATH || path.join(desktop, '.build/Foundation.app'));
const extensionPath = await realpath(path.join(app, 'Contents/Resources/app/extensions/foundation-workspace'));
const temp = await realpath(await mkdtemp('/private/tmp/foundation-restart-smoke-'));
const workspace = path.join(temp, 'workspace'), userData = path.join(temp, 'user-data'), extensions = path.join(temp, 'extensions'), harness = path.join(extensions, 'foundation-test.restart-native-check-1.0.0'), reportPath = path.join(temp, 'report.json');
await Promise.all([mkdir(path.join(workspace, 'src'), { recursive: true }), mkdir(path.join(userData, 'User'), { recursive: true }), mkdir(harness, { recursive: true })]);
await Promise.all([
  writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'foundation-restart-fixture', private: true })),
  writeFile(path.join(workspace, 'src/Saved.tsx'), "export function Saved() { return <button>Save profile</button>; }\n"),
  writeFile(path.join(workspace, 'src/Other.ts'), "export const expectedBehavior = 'Preserve an unfinished thought.';\n"),
  writeFile(path.join(workspace, 'src/Draft.ts'), "export const draft = 'original saved value';\n"),
  writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({
    'foundation.openOnStartup': true, 'foundation.ai.baseUrl': '', 'foundation.ai.model': '', 'foundation.ai.profiles': {},
    'chat.disableAIFeatures': true, 'telemetry.telemetryLevel': 'off', 'update.mode': 'none',
    'workbench.startupEditor': 'none', 'window.confirmBeforeClose': 'never', 'security.workspace.trust.enabled': false,
    'files.hotExit': 'onExitAndWindowClose', 'files.autoSave': 'off', 'workbench.editor.enablePreview': false,
  })),
  writeFile(path.join(harness, 'package.json'), JSON.stringify({ name: 'restart-native-check', publisher: 'foundation-test', version: '1.0.0', engines: { vscode: '^1.100.0' }, main: 'index.cjs', activationEvents: ['onStartupFinished'] })),
  writeFile(path.join(harness, 'index.cjs'), await readFile(path.join(desktop, 'tests/native-restart-smoke.cjs'))),
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
        const { executionContextId } = await targetCommand(browser, target.targetId, 'Page.createIsolatedWorld', { frameId: node.frame.id, worldName: 'foundationRestartSmoke' });
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
  await evaluate(browser, frame, control(selector, 'element.focus(); if (document.activeElement !== element) throw new Error("Native control did not receive focus: "+element.outerHTML+"; disclosure="+element.closest("details")?.open+"; rects="+element.getClientRects().length); return true;'));
  await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ', unmodifiedText: ' ', windowsVirtualKeyCode: 32 });
  await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
};
const setChecked = async (browser, frame, selector, checked) => {
  // A checkbox change rerenders the context disclosure. Wait for the native
  // control to be visible again before the next keyboard interaction.
  if (selector.startsWith('input[data-context-path=') || selector === 'input[aria-label="Include task brief"]') {
    if (!await evaluate(browser, frame, 'document.querySelector("details.assistant-setup").open'))
      await pressControl(browser, frame, 'summary[aria-label="Request context and model"]');
    await wait(async () => await evaluate(browser, frame, control(selector, 'return element.getClientRects().length > 0 && !element.disabled;')), 'source context is visible');
  }
  // Source hydration can replace a checkbox between visibility and keyboard input.
  // Observe its exact value and stable focus before one activation; never repeat a sent key.
  let dispatched = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await evaluate(browser, frame, control(selector, 'return element.checked;')) === checked) break;
    const ready = await evaluate(browser, frame, `(async () => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled || !element.getClientRects().length) return false;
      element.focus(); await new Promise(resolve => setTimeout(resolve, 120));
      return document.querySelector(${JSON.stringify(selector)}) === element && !element.disabled &&
        element.getClientRects().length > 0 && document.activeElement === element && element.checked !== ${JSON.stringify(checked)};
    })()`);
    if (!ready) continue;
    await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ', unmodifiedText: ' ', windowsVirtualKeyCode: 32 });
    await targetCommand(browser, frame.targetId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    dispatched = true; break;
  }
  assert.ok(dispatched || await evaluate(browser, frame, control(selector, 'return element.checked;')) === checked, 'Source selection must settle before keyboard activation');
  await wait(async () => await evaluate(browser, frame, control(selector, 'return element.checked;')) === checked, `native checkbox ${selector}`);
};
const inspectRenderer = async browser => {
  const assistant = await surfaceFrame(browser, 'assistant'), workspaceFrame = await surfaceFrame(browser, 'workspace');
  const values = await evaluate(browser, assistant, `({
    question: document.querySelector('textarea[aria-label="Ask about your source"]').value,
    intent: document.querySelector('button[aria-label="Build mode"]').getAttribute('aria-pressed') === 'true' ? 'build' : 'ask',
    sourcePaths: [...document.querySelectorAll('input[data-context-path]:checked')].map(element => element.dataset.contextPath).sort(),
    includeTaskBrief: document.querySelector('input[aria-label="Include task brief"]').checked,
    contextOpen: document.querySelector('details.assistant-setup').open,
  })`);
  return { mode: await evaluate(browser, workspaceFrame, 'document.querySelector("#foundation-content").dataset.mode'), ...values };
};
let browser;
try {
  for (const stage of ['write', 'restore']) {
    const port = await debugPort(), ipc = path.join(temp, `${stage}-ipc`), outcome = path.join(temp, `${stage}-outcome.json`); await mkdir(ipc);
    const environment = { ...process.env, FOUNDATION_RESTART_STAGE: stage, FOUNDATION_RESTART_OUTCOME: outcome, FOUNDATION_RESTART_REPORT: reportPath,
      FOUNDATION_RESTART_IPC: ipc, FOUNDATION_RESTART_EXTENSION: extensionPath, FOUNDATION_RESTART_WORKSPACE: workspace };
    for (const key of Object.keys(environment)) if (key === 'ELECTRON_RUN_AS_NODE' || /^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key)) delete environment[key];
    const log = await open(path.join(temp, `${stage}.log`), 'w');
    const child = spawn(path.join(app, 'Contents/MacOS/Foundation'), [workspace, '--new-window', '--user-data-dir', userData,
      '--shared-data-dir', path.join(temp, 'shared-data'),
      // Extension-development windows have no durable backupPath in Code OSS.
      // Load the fixture as a normal local extension in this disposable profile.
      '--extensions-dir', extensions,
      '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-crash-reporter',
      '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { env: environment, stdio: ['ignore', log.fd, log.fd] });
    await log.close();
    let exited = false, exitCode, spawnError; child.once('exit', code => { exited = true; exitCode = code; }); child.once('error', error => { exited = true; spawnError = error; });
    const deadline = Date.now() + 150000; let commandIndex = 1, result;
    try {
      while (!(result = await readJSON(outcome))) {
        if (spawnError) throw spawnError;
        if (exited) throw new Error(`${stage} exited before reporting (${exitCode}). See ${temp}`);
        if (Date.now() > deadline) throw new Error(`${stage} timed out. See ${temp}`);
        const command = await readJSON(path.join(ipc, `command-${commandIndex}.json`));
        if (!command) { await pause(100); continue; }
        let answer;
        try {
          if (!browser) browser = await wait(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }), 'isolated native renderer debugging endpoint');
          // Native key dispatch needs the actual isolated window in front;
          // focusing a DOM control does not activate a background macOS app.
          const nativePage = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('/workbench/workbench.html'));
          assert.ok(nativePage, 'The isolated workbench page must be present');
          console.log(JSON.stringify({event:'native-focus',stage,before:await nativePage.evaluate(() => document.hasFocus())}));
          await nativePage.bringToFront();
          await wait(() => nativePage.evaluate(() => document.hasFocus()), 'isolated native window keyboard focus');
          if (command.type === 'compose') {
            assert.equal(stage, 'write'); assert.equal(command.mode, 'Refine'); assert.equal(command.sourcePath, 'src/Saved.tsx');
            assert.equal(typeof command.question, 'string'); assert.ok(command.question.length > 0 && command.question.length < 6000);
            const workspaceFrame = await surfaceFrame(browser, 'workspace');
            console.log('Verified native Foundation DOM through its isolated webview frame.');
            await pressControl(browser, workspaceFrame, 'button[data-mode="Refine"]');
            await wait(async () => await evaluate(browser, workspaceFrame, 'document.querySelector("#foundation-content").dataset.mode') === 'Refine', 'native Refine mode selection');
            const assistant = await surfaceFrame(browser, 'assistant');
            if (!await evaluate(browser, assistant, 'document.querySelector("details.assistant-setup").open')) await pressControl(browser, assistant, 'summary[aria-label="Request context and model"]');
            const paths = await evaluate(browser, assistant, '[...document.querySelectorAll("input[data-context-path]")].map(element => element.dataset.contextPath)');
            assert.ok(paths.includes(command.sourcePath), 'The chosen saved source is available in the actual Assistant');
            for (const sourcePath of paths) await setChecked(browser, assistant, `input[data-context-path=${JSON.stringify(sourcePath)}]`, sourcePath === command.sourcePath);
            await setChecked(browser, assistant, 'input[aria-label="Include task brief"]', true);
            await pressControl(browser, assistant, 'button[aria-label="Build mode"]');
            await evaluate(browser, assistant, control('textarea[aria-label="Ask about your source"]', 'element.focus(); element.select(); return true;'));
            await targetCommand(browser, assistant.targetId, 'Input.insertText', { text: command.question });
          } else assert.equal(command.type, 'inspect', 'Only user-like input and read-only inspection are supported');
          let observed;
          try {
            observed = command.expected ? await wait(async () => {
              observed = await inspectRenderer(browser);
              return JSON.stringify(observed) === JSON.stringify(command.expected) && observed;
            }, 'restored Assistant controls finish scoped source hydration') : await inspectRenderer(browser);
          } catch (error) { throw new Error(`${error.message}; last renderer state: ${JSON.stringify(observed)}`); }
          answer = { passed: true, renderer: observed };
        } catch (error) { answer = { passed: false, error: error.stack || String(error) }; }
        await writeFile(path.join(ipc, `result-${commandIndex}.json`), JSON.stringify(answer)); commandIndex++;
      }
      assert.equal(result.passed, true, `${stage}: ${result.error || 'No successful result'}. See ${temp}`);
      while (!exited && Date.now() < deadline) await pause(100);
      assert.equal(exited, true, `${stage} did not quit gracefully. See ${temp}`); assert.equal(exitCode, 0);
    } catch (error) {
      // Only this runner's disposable-profile child may be stopped.
      if (!exited) { try { child.kill('SIGTERM'); } catch {} }
      throw error;
    } finally {
      await browser?.close().catch(() => {}); browser = undefined;
    }
  }
  const report = { ...await readJSON(reportPath), passed: true, mode: 'packaged', app, extensionPath, workspace, temp,
    interactionVerification: 'Actual native Foundation webview controls operated and read through a loopback-only CDP session; VS Code APIs inspect native editor tabs and unsaved buffers.',
    nativeVisualAcceptance: 'Not performed by this automated check', restart: 'graceful native quit and relaunch', ai: 'disconnected' };
  assert.equal(report.restoredInSecondProcess, true);
  await writeFile(path.join(desktop, '.build', 'native-restart-smoke-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser?.close().catch(() => {}); }
