import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, realpath, cp, open, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(desktop), development = process.argv.includes('--development');
if (process.argv.slice(2).some(flag => flag !== '--development')) throw new Error('Usage: node desktop/scripts/scenario-smoke.mjs [--development]');
const app = await realpath(process.env.FOUNDATION_APP_PATH || path.join(desktop, '.build/Foundation.app'));
const expected = await realpath(development ? path.join(desktop, 'extension') : path.join(app, 'Contents/Resources/app/extensions/foundation-workspace'));
const plugin = path.join(expected, 'dist/connected-vite-plugin.mjs'); await access(plugin);
const temp = await realpath(await mkdtemp('/private/tmp/foundation-scenario-smoke-'));
const workspace = path.join(temp, 'workspace'), userData = path.join(temp, 'user-data'), harness = path.join(temp, 'harness'), reportPath = path.join(temp, 'report.json');
await cp(path.join(repo, 'fixtures/connected-web'), workspace, { recursive: true });
await promisify(execFile)('/bin/cp', ['-cR', path.join(repo, 'node_modules'), path.join(workspace, 'node_modules')]);
const viteConfig = path.join(workspace, 'vite.config.mjs');
await writeFile(viteConfig, (await readFile(viteConfig, 'utf8')).replace('../../desktop/runtime/vite-plugin.mjs', plugin));
await mkdir(path.join(userData, 'User'), { recursive: true }); await mkdir(harness);
await Promise.all([
  writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({
    'foundation.openOnStartup': false, 'foundation.ai.baseUrl': '', 'foundation.ai.model': '', 'foundation.ai.profiles': {},
    'chat.disableAIFeatures': true, 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'workbench.startupEditor': 'none',
    'window.confirmBeforeClose': 'never', 'security.workspace.trust.enabled': false,
  })),
  writeFile(path.join(harness, 'package.json'), JSON.stringify({ name: 'scenario-native-check', publisher: 'foundation-test', version: '1.0.0', engines: { vscode: '^1.100.0' }, main: 'index.cjs', activationEvents: ['onStartupFinished'] })),
  writeFile(path.join(harness, 'index.cjs'), await readFile(path.join(desktop, 'tests/native-scenario-smoke.cjs'))),
]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJSON = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; } };
let browser, page;
try {
  for (const stage of ['write', 'restore']) {
    const outcome = path.join(temp, `${stage}-outcome.json`), ipc = path.join(temp, `${stage}-ipc`); await mkdir(ipc);
    const environment = { ...process.env, FOUNDATION_SCENARIO_STAGE: stage, FOUNDATION_SCENARIO_OUTCOME: outcome, FOUNDATION_SCENARIO_REPORT: reportPath,
      FOUNDATION_SCENARIO_IPC: ipc, FOUNDATION_SCENARIO_EXTENSION: expected, FOUNDATION_SCENARIO_WORKSPACE: workspace };
    for (const key of Object.keys(environment)) if (key === 'ELECTRON_RUN_AS_NODE' || /^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key)) delete environment[key];
    const log = await open(path.join(temp, `${stage}.log`), 'w');
    const child = spawn(path.join(app, 'Contents/MacOS/Foundation'), [workspace, '--new-window', '--user-data-dir', userData,
      '--extensions-dir', path.join(temp, 'extensions'), '--extensionDevelopmentPath', harness,
      ...(development ? ['--extensionDevelopmentPath', expected] : []), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
      '--disable-updates', '--disable-telemetry', '--disable-crash-reporter'], { env: environment, stdio: ['ignore', log.fd, log.fd] });
    await log.close();
    let exited = false, exitCode, spawnError;
    child.once('exit', code => { exited = true; exitCode = code; }); child.once('error', error => { spawnError = error; exited = true; });
    const deadline = Date.now() + 120000;
    let commandIndex = 1, result;
    try {
      while (!(result = await readJSON(outcome))) {
        if (spawnError) throw spawnError;
        if (exited) throw new Error(`${stage} exited before reporting (${exitCode}). See ${temp}`);
        if (Date.now() > deadline) throw new Error(`${stage} timed out. See ${temp}`);
        const command = await readJSON(path.join(ipc, `command-${commandIndex}.json`));
        if (command) {
          let answer;
          try {
            if (!browser) { browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1080, height: 900 } }); }
            if (command.type === 'attach') {
              const url = new URL(command.url); assert.equal(url.protocol, 'http:'); assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
              await page.goto(command.url); await expect(page.getByRole('combobox', { name: 'Request scenario' })).toBeVisible();
            } else if (command.type === 'interact') {
              await page.getByRole('combobox', { name: 'Request scenario' }).selectOption(command.mode);
              await page.getByRole('button', { name: /^(Save changes|Changes saved)$/ }).click();
              await expect(page.getByRole('button', { name: command.mode === 'failure' ? 'Save changes' : 'Changes saved', exact: true })).toBeVisible();
            } else if (command.type === 'route') {
              await page.evaluate(route => history.pushState({}, '', route), command.route);
            } else if (command.type === 'routeRoundTrip') {
              await page.evaluate(() => {
                const original = location.href;
                history.pushState({}, '', '/other?secret=PRIVATE_ROUND_TRIP_VALUE');
                history.pushState({}, '', original);
              });
            } else throw new Error('Unsupported fixture browser action');
            answer = { passed: true, action: command.type, pathname: new URL(page.url()).pathname };
          } catch (error) { answer = { passed: false, error: error.stack || String(error) }; }
          await writeFile(path.join(ipc, `result-${commandIndex}.json`), JSON.stringify(answer)); commandIndex++;
        } else await pause(100);
      }
      assert.equal(result.passed, true, `${stage}: ${result.error || 'No successful result'}. See ${temp}`);
      while (!exited && Date.now() < deadline) await pause(100);
      assert.equal(exited, true, `${stage} did not quit gracefully. See ${temp}`); assert.equal(exitCode, 0, `${stage} exit code. See ${temp}`);
    } catch (error) {
      // This child belongs only to the disposable profile. Never select a user's
      // running Foundation process or project server by name.
      try { child.kill('SIGTERM'); } catch {}
      throw error;
    }
    await browser?.close(); browser = undefined; page = undefined;
  }
  const report = { ...await readJSON(reportPath), passed: true, mode: development ? 'development' : 'packaged', app, extensionPath: expected, workspace, temp,
    interactionVerification: 'Real Chromium interaction with the isolated native host-owned Vite target. Manual assessments are supplied explicitly by this test harness.',
    nativeVisualAcceptance: 'Not performed by this check', ai: 'disconnected' };
  assert.equal(report.restoredInSecondProcess, true);
  await writeFile(path.join(desktop, '.build', development ? 'development-scenario-smoke-report.json' : 'native-scenario-smoke-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser?.close(); }
