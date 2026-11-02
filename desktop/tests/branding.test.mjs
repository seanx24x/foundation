import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { createProduct } from '../scripts/brand.mjs';
import { patchAccountInitialization, patchSpeechAccountInitialization, patchNpmWorkspaceDetection, patchUpstream } from '../scripts/patch-upstream.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const overlay = readJson(path.join(desktop, 'product.json'));
const upstream = {
  nameShort: 'Code - OSS',
  nameLong: 'Code - OSS',
  applicationName: 'code-oss',
  dataFolderName: '.vscode-oss',
  sharedDataFolderName: '.vscode-oss-shared',
  serverDataFolderName: '.vscode-server-oss',
  darwinBundleIdentifier: 'com.visualstudio.code.oss',
  urlProtocol: 'code-oss',
  licenseName: 'MIT',
  licenseFileName: 'LICENSE.txt',
  licenseUrl: 'https://github.com/microsoft/vscode/blob/main/LICENSE.txt',
  enableTelemetry: true,
  updateUrl: 'https://update.code.visualstudio.com',
  builtInExtensions: [{ name: 'ms-vscode.js-debug', version: '1.140.0', sha256: 'a'.repeat(64), repo: 'https://github.com/microsoft/vscode-js-debug' }],
  defaultChatAgent: {
    extensionId: 'GitHub.copilot',
    chatExtensionId: 'GitHub.copilot-chat',
    provider: { default: { id: 'github', name: 'GitHub' }, enterprise: { id: 'github-enterprise', name: 'GitHub Enterprise' } },
    providerScopes: [['read:user']],
  },
};

test('Foundation owns its application, protocol, and local storage identity', () => {
  const product = createProduct(structuredClone(upstream), structuredClone(overlay));
  assert.deepEqual({
    short: product.nameShort,
    long: product.nameLong,
    application: product.applicationName,
    protocol: product.urlProtocol,
    data: product.dataFolderName,
  }, {
    short: 'Foundation',
    long: 'Foundation',
    application: 'foundation',
    protocol: 'foundation',
    data: '.foundation-ide',
  });
  assert.match(product.darwinBundleIdentifier, /foundation/i);
  assert.notEqual(product.darwinBundleIdentifier, upstream.darwinBundleIdentifier);
  assert.notEqual(product.sharedDataFolderName, upstream.sharedDataFolderName);
  assert.notEqual(product.serverDataFolderName, upstream.serverDataFolderName);
});

test('branding identifies Foundation source terms while preserving the Code OSS license file and pinned metadata', () => {
  const product = createProduct(structuredClone(upstream), structuredClone(overlay));
  assert.deepEqual({
    license: product.licenseName,
    licenseUrl: product.licenseUrl,
    licenseFile: product.licenseFileName,
    builtins: product.builtInExtensions,
    chat: product.defaultChatAgent,
  }, {
    license: 'Foundation source terms and third-party licenses',
    licenseUrl: 'https://github.com/seanx24x/foundation/blob/main/LICENSE.txt',
    licenseFile: 'LICENSE.txt',
    builtins: upstream.builtInExtensions,
    chat: upstream.defaultChatAgent,
  });
});

test('branding disables core telemetry and upstream updates', () => {
  const product = createProduct(structuredClone(upstream), structuredClone(overlay));
  assert.equal(product.enableTelemetry, false);
  assert.ok(!product.updateUrl, 'Foundation must not contact the upstream update service');
});

test('extension discovery and resources use the Open VSX adapter', () => {
  const { extensionsGallery } = createProduct(structuredClone(upstream), structuredClone(overlay));
  assert.equal(extensionsGallery.serviceUrl, 'https://open-vsx.org/vscode/gallery');
  assert.equal(extensionsGallery.resourceUrlTemplate, 'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}');
  assert.equal(extensionsGallery.extensionUrlTemplate, 'https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest');
});

test('branding is repeatable and leaves its input objects unchanged', () => {
  const input = structuredClone(upstream);
  const config = structuredClone(overlay);
  const result = createProduct(input, config);
  assert.deepEqual({ input, config }, { input: upstream, config: overlay });
  assert.deepEqual(createProduct(result, config), result);
});

test('upstream manifest pins a full official revision and runtime pair', () => {
  const manifest = readJson(path.join(desktop, 'upstream.json'));
  assert.deepEqual({
    repository: manifest.repository.replace(/\.git$/, ''),
    tag: manifest.tag,
    commit: manifest.commit,
    node: manifest.nodeVersion,
    electron: manifest.electronVersion,
    architecture: manifest.architecture,
  }, {
    repository: 'https://github.com/microsoft/vscode',
    tag: '1.143.1',
    commit: 'e646868227c3e3a9e3f24277c8c7220be42c0be7',
    node: '24.18.0',
    electron: '43.7.7',
    architecture: 'arm64',
  });
});

const accountFixture = `class DefaultAccountProvider {
  async init() {
\t\tawait this.whenDefaultAccountAuthenticationProviderAvailable();

\t\tthis.logService.debug('[DefaultAccount] Starting initialization');
\t\tawait this.doUpdateDefaultAccount();
\t\tthis.logService.debug('[DefaultAccount] Initialization complete');
    this.registerListeners();
  }
}`;

const speechFixture = `class Speech {
  initialize() {
\t\tthis._updateConfiguredContextKey();
\t\tvoid this._refreshGitHubSession();
\t\tthis._register(this._authenticationService.onDidChangeSessions(e => {
      if (e.providerId === 'github') void this._refreshGitHubSession();
    }));
    this._register(this._authenticationService.onDidRegisterAuthenticationProvider(e => {
      if (e.id === 'github') void this._refreshGitHubSession();
    }));
  }
}`;

test('Foundation speech setup leaves GitHub dormant and responds to later provider activation', () => {
  const Speech = vm.runInNewContext(`${patchSpeechAccountInitialization(speechFixture)}\nSpeech`);
  for (const [applicationName, registered, initialRefreshes] of [['foundation', false, 0], ['foundation', true, 1], ['code-oss', false, 1]]) {
    let refreshes = 0;
    let contexts = 0;
    const listeners = {};
    const logs = [];
    const service = new Speech();
    Object.assign(service, {
      _productService: { applicationName },
      _authenticationService: {
        isAuthenticationProviderRegistered: id => { assert.equal(id, 'github'); return registered; },
        onDidChangeSessions: listener => { listeners.sessions = listener; },
        onDidRegisterAuthenticationProvider: listener => { listeners.registration = listener; },
      },
      _logService: { debug: message => logs.push(message) },
      _register() {},
      _updateConfiguredContextKey: () => { contexts++; },
      _refreshGitHubSession: () => { refreshes++; },
    });
    service.initialize();
    assert.equal(contexts, 1);
    assert.equal(refreshes, initialRefreshes);
    assert.equal(logs.includes('[Foundation] Speech account discovery deferred until provider activation'), initialRefreshes === 0);
    listeners.registration({ id: 'github' });
    listeners.sessions({ providerId: 'github' });
    assert.equal(refreshes, initialRefreshes + 2, 'Explicit provider activation and session changes still refresh dictation availability');
  }
  assert.throws(() => patchSpeechAccountInitialization('upstream changed'), /re-audit startup authentication/);
});

test('Foundation defers only eager account discovery and retains registration listeners', async () => {
  const Provider = vm.runInNewContext(`${patchAccountInitialization(accountFixture)}\nDefaultAccountProvider`);
  for (const [applicationName, registered, expectedCalls] of [['foundation', false, 0], ['foundation', true, 1], ['code-oss', false, 1]]) {
    const calls = { wait: 0, update: 0, listeners: 0 };
    const logs = [];
    const provider = new Provider();
    Object.assign(provider, {
      productService: { applicationName },
      authenticationService: { isAuthenticationProviderRegistered: id => { assert.equal(id, 'github'); return registered; } },
      getDefaultAccountAuthenticationProvider: () => ({ id: 'github' }),
      logService: { debug(message) { logs.push(message); } },
      whenDefaultAccountAuthenticationProviderAvailable: async () => { calls.wait++; },
      doUpdateDefaultAccount: async () => { calls.update++; },
      registerListeners: () => { calls.listeners++; },
    });
    await provider.init();
    assert.deepEqual(calls, { wait: expectedCalls, update: expectedCalls, listeners: 1 });
    assert.equal(logs.includes('[Foundation] Default account discovery deferred until provider activation'), expectedCalls === 0);
  }
  assert.throws(() => patchAccountInitialization('upstream changed'), /re-audit startup authentication/);
});

test('the upstream task patch omits only the chosen integration and rejects drift', async t => {
  const checkout = await mkdtemp(path.join(os.tmpdir(), 'foundation-patch-test-'));
  t.after(() => rm(checkout, { recursive: true, force: true }));
  const file = path.join(checkout, 'build', 'gulpfile.vscode.ts');
  await mkdir(path.dirname(file));
  const accountFile = path.join(checkout, 'src/vs/workbench/services/accounts/browser/defaultAccount.ts');
  await mkdir(path.dirname(accountFile), { recursive: true });
  const speechFile = path.join(checkout, 'src/vs/workbench/contrib/chat/browser/speechToText/chatSpeechToTextService.ts');
  await mkdir(path.dirname(speechFile), { recursive: true });
  const npmFile = path.join(checkout, 'extensions/npm/src/preferred-pm.ts');
  await mkdir(path.dirname(npmFile), { recursive: true });
  const npmFixture = `import findWorkspaceRoot = require('../node_modules/find-yarn-workspace-root');
async function isYarnPreferred(pkgPath) {
  if (typeof findWorkspaceRoot(pkgPath) === 'string') { return true; }
  return false;
}`;
  const source = `function plan() {
  const compile = [
\t\t\tcompileCopilotExtensionBuildTask,
  ];
  const finish = [
\t\t\tprepareCopilotRipgrepShimTask(platform, arch, destinationFolderName)
  ];
  return { compile, finish };
}`;
  const captureOriginals = new Map([
    ['src/vs/platform/native/electron-main/nativeHostMainService.ts', "import * as fs from 'fs';\n\t//#region Screenshots"],
    ['src/vs/platform/native/common/native.ts', "import { VSBuffer } from '../../../base/common/buffer.js';\n\tgetScreenshot(rect?: IRectangle): Promise<VSBuffer | undefined>;"],
    ['src/vs/workbench/contrib/webview/electron-browser/webview.contribution.ts', "import { ElectronWebviewService } from './webviewService.js';"],
  ]);
  for (const [relative, original] of captureOriginals) {
    const target = path.join(checkout, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, original);
  }
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Foundation Test', '-c', 'user.email=foundation-test@example.invalid', ...args], { cwd: checkout, stdio: 'pipe' });
  git(['init', '--quiet']);
  await writeFile(file, source);
  await writeFile(accountFile, accountFixture);
  await writeFile(speechFile, speechFixture);
  await writeFile(npmFile, npmFixture);
  git(['add', 'build/gulpfile.vscode.ts', 'src/vs/workbench/services/accounts/browser/defaultAccount.ts', 'src/vs/workbench/contrib/chat/browser/speechToText/chatSpeechToTextService.ts', 'extensions/npm/src/preferred-pm.ts']);
  git(['add', ...captureOriginals.keys()]);
  git(['commit', '--quiet', '-m', 'Pin task fixture']);
  await patchUpstream(checkout);
  const patched = await readFile(file, 'utf8');
  assert.match(await readFile(path.join(checkout, 'src/vs/platform/native/electron-main/nativeHostMainService.ts'), 'utf8'), /captureFoundationCanvas/);
  assert.match(await readFile(path.join(checkout, 'src/vs/platform/native/common/foundationCanvasCapture.ts'), 'utf8'), /validFoundationCaptureIdentity/);
  assert.match(await readFile(path.join(checkout, 'src/vs/workbench/contrib/webview/electron-browser/foundationCanvasCapture.ts'), 'utf8'), /_foundation\.captureActiveCanvas/);
  assert.equal(await readFile(accountFile, 'utf8'), patchAccountInitialization(accountFixture));
  assert.equal(await readFile(speechFile, 'utf8'), patchSpeechAccountInitialization(speechFixture));
  assert.equal(await readFile(npmFile, 'utf8'), patchNpmWorkspaceDetection(npmFixture));
  assert.match(await readFile(path.join(checkout, 'extensions/npm/src/foundationYarnWorkspaceRoot.ts'), 'utf8'), /foundation\.npm\.async-yarn-workspace-root\.v1/);
  assert.match(await readFile(path.join(checkout, 'extensions/npm/FoundationThirdPartyNotices.txt'), 'utf8'), /Copyright 2017 Square, Inc\./);
  const inheritedYarnAttribution = 'https://github.com/yarnpkg/yarn/blob/ddf2f9ade211195372236c2f39a75b00fa18d4de/src/config.js#L612';
  assert.ok((await readFile(path.join(checkout, 'extensions/npm/src/foundationYarnWorkspaceRoot.ts'), 'utf8')).includes(inheritedYarnAttribution));
  assert.ok((await readFile(path.join(checkout, 'extensions/npm/FoundationThirdPartyNotices.txt'), 'utf8')).includes(inheritedYarnAttribution));
  const evaluate = enabled => JSON.parse(JSON.stringify(vm.runInNewContext(`${patched}\nplan()`, {
    process: { env: enabled ? { FOUNDATION_WITHOUT_COPILOT: '1' } : {} },
    compileCopilotExtensionBuildTask: 'compile-copilot',
    prepareCopilotRipgrepShimTask: (platform, arch, destination) => `${platform}/${arch}/${destination}`,
    platform: 'darwin', arch: 'arm64', destinationFolderName: 'output',
  })));
  assert.deepEqual(evaluate(false), { compile: ['compile-copilot'], finish: ['darwin/arm64/output'] });
  assert.deepEqual(evaluate(true), { compile: [], finish: [] });
  await patchUpstream(checkout);
  assert.equal(await readFile(file, 'utf8'), patched, 'Reapplying starts from the pinned original');
  const changedUpstream = source.replace('prepareCopilotRipgrepShimTask(platform, arch, destinationFolderName)', 'newUpstreamTask()');
  await writeFile(file, changedUpstream);
  git(['add', 'build/gulpfile.vscode.ts']);
  git(['commit', '--quiet', '-m', 'Simulate upstream task change']);
  await assert.rejects(patchUpstream(checkout), /Upstream task changed: re-audit/);
  assert.equal(await readFile(file, 'utf8'), changedUpstream, 'A rejected patch must not partially edit the source');
  await writeFile(file, source);
  await writeFile(accountFile, accountFixture);
  await writeFile(speechFile, 'class Speech { initialize() {} }');
  git(['add', 'build/gulpfile.vscode.ts', 'src/vs/workbench/services/accounts/browser/defaultAccount.ts', 'src/vs/workbench/contrib/chat/browser/speechToText/chatSpeechToTextService.ts']);
  git(['commit', '--quiet', '-m', 'Simulate late speech initialization drift']);
  await writeFile(file, '// Existing generated task overlay');
  await assert.rejects(patchUpstream(checkout), /Upstream speech account initialization changed/);
  assert.equal(await readFile(file, 'utf8'), '// Existing generated task overlay', 'Validation of the final file must finish before writing the first file');
  assert.equal(await readFile(accountFile, 'utf8'), accountFixture);
  await writeFile(speechFile, speechFixture);
  await writeFile(npmFile, '// upstream npm changed');
  git(['add', 'src/vs/workbench/contrib/chat/browser/speechToText/chatSpeechToTextService.ts', 'extensions/npm/src/preferred-pm.ts']);
  git(['commit', '--quiet', '-m', 'Simulate npm workspace detection drift']);
  await writeFile(accountFile, '// Existing account overlay');
  await assert.rejects(patchUpstream(checkout), /Upstream npm workspace detection changed/);
  assert.equal(await readFile(accountFile, 'utf8'), '// Existing account overlay', 'The npm patch validates before any generated overlay is written');
});

const appPath = process.env.FOUNDATION_APP_PATH || path.join(desktop, '.build', 'Foundation.app');
const appSkip = !process.env.FOUNDATION_APP_PATH && !existsSync(appPath)
  ? 'No packaged app at desktop/.build/Foundation.app; set FOUNDATION_APP_PATH to verify a built artifact'
  : false;

test('packaged app contains the source-built workbench and Foundation extension', { skip: appSkip }, () => {
  const app = path.join(appPath, 'Contents', 'Resources', 'app');
  const product = readJson(path.join(app, 'product.json'));
  const manifest = readJson(path.join(desktop, 'upstream.json'));
  assert.deepEqual({ name: product.nameLong, commit: product.commit, telemetry: product.enableTelemetry }, {
    name: 'Foundation', commit: manifest.commit, telemetry: false,
  });
  assert.ok(!product.updateUrl);
  for (const resource of [
    'out/main.js',
    'out/vs/workbench/workbench.desktop.main.js',
    'out/vs/workbench/api/node/extensionHostProcess.js',
    'LICENSE.txt',
    'ThirdPartyNotices.txt',
    'extensions/git/package.json',
    'extensions/typescript-language-features/package.json',
    'extensions/foundation-workspace/package.json',
    'extensions/foundation-workspace/dist/extension.cjs',
    'extensions/foundation-workspace/media/platform-setup.js',
    'extensions/foundation-workspace/media/platform-setup.css',
    'extensions/foundation-workspace/media/xcode-project.js',
    'extensions/foundation-workspace/media/xcode-project.css',
  ]) {
    assert.ok(existsSync(path.join(app, resource)), `Missing packaged resource: ${resource}`);
  }
  assert.ok(existsSync(path.join(appPath, 'Contents', 'MacOS', 'Foundation')));
  const extension = readJson(path.join(app, 'extensions', 'foundation-workspace', 'package.json'));
  assert.equal(`${extension.publisher}.${extension.name}`, 'foundation.foundation-workspace');
  assert.ok(extension.contributes.commands.some(command => command.command === 'foundation.projectSetup'), 'Project Setup is discoverable through the native command palette');
  assert.ok(extension.contributes.commands.some(command => command.command === 'foundation.xcodeProject'));
  assert.equal(extension.contributes.configurationDefaults['chat.disableAIFeatures'], true);
  assert.equal(existsSync(path.join(app, 'extensions', 'copilot', 'package.json')), false, 'Foundation deliberately omits the separate Copilot integration');
  assert.equal(product.extensionsGallery.serviceUrl, 'https://open-vsx.org/vscode/gallery');
  const workbench = readFileSync(path.join(app, 'out/vs/workbench/workbench.desktop.main.js'), 'utf8');
  assert.ok(workbench.includes('[Foundation] Default account discovery deferred until provider activation'), 'The compiled host must include on-demand account initialization');
  assert.ok(workbench.includes('[Foundation] Speech account discovery deferred until provider activation'), 'The compiled host must include on-demand speech account initialization');
  const npmBundle = readFileSync(path.join(app, 'extensions/npm/dist/npmMain.js'), 'utf8');
  assert.ok(npmBundle.includes('foundation.npm.async-yarn-workspace-root.v1'), 'The npm bundle must include asynchronous workspace detection');
  assert.match(readFileSync(path.join(app, 'extensions/npm/FoundationThirdPartyNotices.txt'), 'utf8'), /Copyright 2017 Square, Inc\./);
  assert.ok(readFileSync(path.join(app, 'extensions/npm/FoundationThirdPartyNotices.txt'), 'utf8').includes('https://github.com/yarnpkg/yarn/blob/ddf2f9ade211195372236c2f39a75b00fa18d4de/src/config.js#L612'));
  const provenance = readJson(path.join(appPath, 'Contents', 'Resources', 'foundation-build.json'));
  assert.deepEqual({
    version: provenance.foundationVersion,
    hostVersion: provenance.codeOSS,
    commit: provenance.commit,
    architecture: provenance.architecture,
    aiHost: provenance.aiHost,
    bundledCopilot: provenance.bundledCopilot,
  }, {
    version: readJson(path.join(desktop, '..', 'package.json')).version,
    hostVersion: manifest.tag,
    commit: manifest.commit,
    architecture: manifest.architecture,
    aiHost: 'foundation-workspace',
    bundledCopilot: false,
  });
  assert.ok(provenance.upstreamPatches.includes('optional-copilot-integration'));
  assert.ok(provenance.upstreamPatches.includes('on-demand-default-account'));
  assert.ok(provenance.upstreamPatches.includes('on-demand-speech-account'));
  assert.ok(provenance.upstreamPatches.includes('async-npm-workspace-detection'));
  assert.ok(provenance.upstreamPatches.includes('scoped-native-canvas-capture'));
});


test('packaged change-impact parser retains the complete dependency license notices', {skip:appSkip}, () => {
  const dist = path.join(appPath,'Contents/Resources/app/extensions/foundation-workspace/dist');
  for (const [name,notice] of [['postcss','PostCSS'],['nanoid','NanoID'],['picocolors','Picocolors'],['source-map-js','SourceMapJS']]) {
    const original = readFileSync(path.join(desktop,'../node_modules',name,'LICENSE'),'utf8');
    assert.equal(readFileSync(path.join(dist,`${notice}-LICENSE.txt`),'utf8'),original,`${name} retains its actual complete distributed license`);
  }
});
