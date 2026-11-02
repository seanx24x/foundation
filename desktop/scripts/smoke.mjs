import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = process.env.FOUNDATION_APP_PATH || path.join(desktop, '.build', 'Foundation.app');
const executable = path.join(app, 'Contents', 'MacOS', 'Foundation');
const flags = process.argv.slice(2);
if (flags.some(flag => flag !== '--development')) throw new Error('Usage: npm run desktop:smoke -- [--development]');
const development = flags.includes('--development');
const expectedExtension = await realpath(development ? path.join(desktop, 'extension') : path.join(app, 'Contents/Resources/app/extensions/foundation-workspace'));
await access(executable);
// macOS Unix-domain socket paths are limited to 103 bytes; $TMPDIR is too long.
const temporary = await realpath(await mkdtemp('/private/tmp/foundation-smoke-'));
const workspace = path.join(temporary, 'workspace');
const userData = path.join(temporary, 'user-data');
const harness = path.join(temporary, 'harness');
const reportPath = path.join(temporary, 'report.json');
await Promise.all([mkdir(path.join(workspace, 'src'), { recursive: true }), mkdir(path.join(userData, 'User'), { recursive: true }), mkdir(harness)]);
await Promise.all([
  writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'foundation-native-smoke', private: true, version: '1.0.0' })),
  writeFile(path.join(workspace, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022' }, include: ['src'] })),
  writeFile(path.join(workspace, 'src', 'save.ts'), 'export interface Settings {\n  name: string;\n}\n\nexport function saveSettings(settings: Settings): string {\n  return settings.name.trim();\n}\n'),
  writeFile(path.join(workspace, 'src', 'App.tsx'), 'import "./tokens.css";\nexport default function App() { return <button data-foundation-source="src/App.tsx">Save changes</button>; }\n'),
  writeFile(path.join(workspace, 'src', 'tokens.css'), ':root { --smoke-radius: 8px; --smoke-color: #34674e; }\nbutton { border-radius: var(--smoke-radius); color: var(--smoke-color); }\n'),
  writeFile(path.join(userData, 'User', 'settings.json'), JSON.stringify({ 'foundation.openOnStartup': false, 'chat.disableAIFeatures': true, 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false })),
  writeFile(path.join(harness, 'package.json'), JSON.stringify({ name: 'foundation-native-smoke', publisher: 'foundation-test', version: '1.0.0', engines: { vscode: '^1.100.0' }, main: './index.cjs', activationEvents: ['onStartupFinished'] })),
  writeFile(path.join(harness, 'index.cjs'), 'exports.activate = () => {};\n'),
  // Keep the disposable test harness independent of protected project folders.
  writeFile(path.join(harness, 'native-smoke.cjs'), await readFile(path.join(desktop, 'tests', 'native-smoke.cjs'))),
]);
execFileSync('git', ['init', '--quiet', workspace]);

const providerRequests = [];
const provider = createServer((request, response) => {
  providerRequests.push({ method: request.method, url: request.url });
  request.resume();
  response.writeHead(500, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: 'Smoke test does not authorize provider requests' }));
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const environment = {
  ...process.env,
  FOUNDATION_AI_PROVIDER_KIND: 'compatible',
  FOUNDATION_AI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
  FOUNDATION_AI_MODEL: 'isolated-smoke-provider',
  FOUNDATION_AI_API_KEY: 'isolated-smoke-key',
  FOUNDATION_SMOKE_WORKSPACE: workspace,
  FOUNDATION_SMOKE_REPORT: reportPath,
  FOUNDATION_SMOKE_EXTENSION: expectedExtension,
  FOUNDATION_SMOKE_MODE: development ? 'development' : 'packaged',
};
delete environment.ELECTRON_RUN_AS_NODE;
let output = '';
let timedOut = false;
try {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(executable, [workspace, '--new-window', '--user-data-dir', userData, '--shared-data-dir', path.join(temporary, 'shared-data'), '--extensions-dir', path.join(temporary, 'extensions'), '--extensionDevelopmentPath', harness, ...(development ? ['--extensionDevelopmentPath', expectedExtension] : []), '--extensionTestsPath', path.join(harness, 'native-smoke.cjs'), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-crash-reporter'], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, 150000);
    const capture = data => { output = (output + data.toString()).slice(-120000); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); clearTimeout(killTimer); resolve(code); });
  });
  await writeFile(path.join(temporary, 'native.log'), output);
  let report;
  try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
  catch { throw new Error(`Native smoke did not produce a report (exit ${exitCode}, timeout ${timedOut}). See ${temporary}/native.log`); }
  report.tests.push({ name: 'Opening source and assistant surfaces never contacts the configured provider', status: providerRequests.length ? 'failed' : 'passed', requests: providerRequests });
  const authenticationActivations = [];
  const logs = path.join(userData, 'logs');
  for (const session of (await readdir(logs, { withFileTypes: true })).filter(entry => entry.isDirectory())) {
    const sessionPath = path.join(logs, session.name);
    for (const window of (await readdir(sessionPath)).filter(name => /^window\d+$/.test(name))) {
      let extensionLog = '';
      try { extensionLog = await readFile(path.join(sessionPath, window, 'exthost', 'exthost.log'), 'utf8'); } catch {}
      authenticationActivations.push(...extensionLog.split('\n').filter(line => /ExtensionService#_doActivateExtension vscode\.(github|microsoft)-authentication,/.test(line)));
    }
  }
  report.tests.push({ name: 'Ordinary startup leaves platform authentication providers dormant', status: authenticationActivations.length ? 'failed' : 'passed', activations: authenticationActivations });
  report.process = { exitCode, timedOut };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await mkdir(path.join(desktop, '.build'), { recursive: true });
  await writeFile(path.join(desktop, '.build', development ? 'development-smoke-report.json' : 'native-smoke-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Native smoke logs and isolated workspace: ${temporary}`);
  assert.equal(timedOut, false, 'Native smoke timed out');
  assert.equal(exitCode, 0, 'Extension host test process failed');
  assert.equal(report.tests.filter(test => test.status === 'failed').length, 0, 'Native smoke checks failed');
} finally {
  await new Promise(resolve => provider.close(resolve));
}
