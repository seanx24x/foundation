import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const development = process.argv.includes('--development');
if (process.argv.slice(2).some(flag => flag !== '--development')) {
  throw new Error('Usage: node desktop/scripts/feature-smoke.mjs [--development]');
}
const app = process.env.FOUNDATION_APP_PATH || path.join(desktop, '.build/Foundation.app');
const expected = await realpath(development
  ? path.join(desktop, 'extension')
  : path.join(app, 'Contents/Resources/app/extensions/foundation-workspace'));
const temp = await realpath(await mkdtemp('/private/tmp/foundation-feature-smoke-'));
const workspace = path.join(temp, 'workspace');
const userData = path.join(temp, 'user-data');
const harness = path.join(temp, 'harness');
const report = path.join(temp, 'report.json');
await Promise.all([
  mkdir(path.join(workspace, 'src'), { recursive: true }),
  mkdir(path.join(userData, 'User'), { recursive: true }),
  mkdir(harness),
]);
await Promise.all([
  writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'feature-restart-fixture', private: true })),
  writeFile(path.join(workspace, 'src/App.tsx'), "import { Button } from './Button';\nimport { saveProfile } from './api';\nimport './styles.css';\nexport default function App() { return <Button onSave={saveProfile} />; }\n"),
  writeFile(path.join(workspace, 'src/Button.tsx'), "export function Button({ onSave }: { onSave: () => Promise<void> }) { return <button onClick={onSave}>Save profile</button>; }\n"),
  writeFile(path.join(workspace, 'src/api.ts'), "export async function saveProfile() { await fetch('/api/profile', { method: 'POST' }); }\n"),
  writeFile(path.join(workspace, 'src/styles.css'), ":root { --control-radius: 8px; }\nbutton { border-radius: var(--control-radius); }\n"),
  writeFile(path.join(workspace, 'src/Button.test.ts'), "import { Button } from './Button';\nexport const subject = Button;\n"),
  writeFile(path.join(workspace, 'src/Draft.ts'), "export const unrelatedDraft = 'original saved value';\n"),
  writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({
    'foundation.openOnStartup': false,
    'foundation.ai.baseUrl': '',
    'foundation.ai.model': '',
    'chat.disableAIFeatures': true,
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'workbench.startupEditor': 'none',
    'window.confirmBeforeClose': 'never',
    'security.workspace.trust.enabled': false,
  })),
  writeFile(path.join(harness, 'package.json'), JSON.stringify({
    name: 'feature-native-check', publisher: 'foundation-test', version: '1.0.0',
    engines: { vscode: '^1.100.0' }, main: 'index.cjs', activationEvents: ['onStartupFinished'],
  })),
  writeFile(path.join(harness, 'index.cjs'), await readFile(path.join(desktop, 'tests/native-feature-smoke.cjs'))),
]);

for (const stage of ['write', 'restore']) {
  const outcome = path.join(temp, `${stage}-outcome.json`);
  const environment = {
    ...process.env,
    FOUNDATION_FEATURE_STAGE: stage,
    FOUNDATION_FEATURE_REPORT: report,
    FOUNDATION_FEATURE_OUTCOME: outcome,
    FOUNDATION_FEATURE_EXTENSION: expected,
    FOUNDATION_FEATURE_WORKSPACE: workspace,
  };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', ...Object.keys(environment).filter(key => key.startsWith('FOUNDATION_AI_'))]) {
    delete environment[key];
  }
  let output = '';
  let timedOut = false;
  const exitCode = await new Promise((resolve, reject) => {
    // Code OSS deliberately uses in-memory storage with --extensionTestsPath.
    // Activate a disposable extension in a normal isolated profile instead, then
    // quit gracefully so the native workspace storage service flushes its DB.
    const child = spawn(path.join(app, 'Contents/MacOS/Foundation'), [
      workspace, '--new-window', '--user-data-dir', userData,
      '--extensions-dir', path.join(temp, 'extensions'),
      '--extensionDevelopmentPath', harness,
      ...(development ? ['--extensionDevelopmentPath', expected] : []),
      '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
      '--disable-updates', '--disable-telemetry', '--disable-crash-reporter',
    ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let force;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      force = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, 60000);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', data => { output = (output + data).slice(-100000); });
    }
    child.once('error', error => { clearTimeout(timer); clearTimeout(force); reject(error); });
    child.once('exit', code => { clearTimeout(timer); clearTimeout(force); resolve(code); });
  });
  await writeFile(path.join(temp, `${stage}.log`), output);
  assert.equal(timedOut, false, `${stage} timed out. See ${temp}`);
  assert.equal(exitCode, 0, `${stage} failed. See ${temp}`);
  const result = JSON.parse(await readFile(outcome, 'utf8'));
  assert.equal(result.stage, stage);
  assert.equal(result.passed, true, `${stage}: ${result.error || 'missing success result'}. See ${temp}`);
}

const result = {
  ...JSON.parse(await readFile(report, 'utf8')),
  mode: development ? 'development' : 'packaged',
  workspace, temp, ai: 'disconnected', app,
  restart: 'graceful native quit and relaunch',
  passed: true,
};
assert.equal(result.restoredInSecondProcess, true);
await writeFile(path.join(desktop, '.build', development ? 'development-feature-smoke-report.json' : 'native-feature-smoke-report.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
