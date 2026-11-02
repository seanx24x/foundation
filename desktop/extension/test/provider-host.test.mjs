import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.FOUNDATION_PROVIDER_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const projectRequire = createRequire(join(root, 'package.json'));
const ts = projectRequire('typescript');
const { resolveProviderKey } = await import(join(root, 'desktop/extension/src/provider-credentials.mjs'));
const { createAssistantService } = await import(join(root, 'server/project/assistant.mjs'));
const { createCodeSuggestionService } = await import(join(root, 'server/project/code-suggestions.mjs'));
const { createInlineEditService } = await import(join(root, 'server/project/inline-edit.mjs'));
const source = readFileSync(join(root, 'desktop/extension/src/extension.ts'), 'utf8');
const runtimeWorkspaceModule = await import(join(root, 'desktop/extension/src/runtime-workspace-store.mjs'));
const runtimeReplayModule = await import(join(root, 'desktop/extension/src/runtime-replay-store.mjs'));
const runtimeMatrixModule = await import(join(root, 'desktop/extension/src/runtime-matrix-store.mjs'));
const runtimeStateSuiteModule = await import(join(root, 'desktop/extension/src/runtime-state-suite-store.mjs'));
const compiled = ts.transpileModule(`${source}\nexport { FoundationHost };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const keyName = (kind, url) => `foundation.ai.providerKey.${kind}.${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;
const legacyKeyName = 'foundation.ai.providerKey';
const tick = () => new Promise(resolve => setImmediate(resolve));
const clone = value => value === undefined ? undefined : structuredClone(value);

// Only fixture configuration and in-memory secrets exist inside this VM. Its
// fetch rejects every call; the real credential store is never loaded.
function harness({ globals = {}, workspace = {}, environment = {}, secrets = {}, choice, inputs = [], readSecret } = {}) {
  const settings = clone(globals), stored = new Map(Object.entries(secrets));
  const reads = [], secretWrites = [], updates = [], configurations = [], states = [], prompts = [], commands = new Map();
  let changeConfiguration, networkCalls = 0, nextInput = 0;
  const disposable = () => ({ dispose() {} });
  const configuration = {
    inspect: key => ({ globalValue: settings[key], workspaceValue: workspace[key] }),
    update: async (key, value, target) => {
      assert.equal(target, 1, 'provider configuration must be application global');
      settings[key] = clone(value); updates.push({ key, value: clone(value) });
      changeConfiguration?.({ affectsConfiguration: name => name === 'foundation.ai' });
    },
  };
  const vscode = {
    EventEmitter: class { event() {} fire() {} dispose() {} },
    ConfigurationTarget: { Global: 1 }, StatusBarAlignment: { Left: 1 },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return disposable(); } },
    window: {
      createOutputChannel: () => ({ ...disposable(), appendLine() {} }),
      createStatusBarItem: () => ({ ...disposable(), show() {} }),
      registerTreeDataProvider: disposable, registerWebviewViewProvider: disposable, registerWebviewPanelSerializer: disposable,
      onDidChangeActiveTextEditor: disposable, onDidChangeTextEditorSelection: disposable,
      showQuickPick: async items => items.find(item => item.providerKind === choice),
      showInputBox: async options => {
        prompts.push(options);
        const value = inputs[nextInput++];
        if (value !== undefined) assert.equal(await options.validateInput?.(value), undefined, 'fixture input must pass the native UI validator');
        return value;
      },
      showInformationMessage: async () => undefined,
    },
    workspace: {
      isTrusted: true, textDocuments: [], getConfiguration: () => configuration,
      registerTextDocumentContentProvider: disposable, onDidChangeTextDocument: disposable,
      onWillSaveTextDocument: disposable, onDidSaveTextDocument: disposable,
      onDidChangeWorkspaceFolders: disposable, onDidGrantWorkspaceTrust: disposable,
      onDidChangeConfiguration: callback => { changeConfiguration = callback; return disposable(); },
      createFileSystemWatcher: () => ({ ...disposable(), onDidChange: disposable, onDidDelete: disposable }),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, URL, AbortController, TextDecoder, Buffer, setTimeout, clearTimeout,
    process: { env: clone(environment) },
    fetch: () => { networkCalls++; throw new Error('Provider setup must never send a request.'); },
    require: name => {
      if (name === 'vscode') return vscode;
      if (name.includes('code-suggestions.mjs')) return { createCodeSuggestionService };
      if (name.includes('inline-edit.mjs')) return { createInlineEditService };
      if (name.includes('code-suggestion-controller')) return { CodeSuggestionController: class { stop() {} interrupt() {} dispose() {} } };
      if (name.includes('inline-edit-controller')) return { InlineEditController: class { dismiss() {} dispose() {} } };
      if (name.includes('swift-language-controller')) return { SwiftLanguageController: class { onDidChangeState() { return { dispose() {} }; } stop() {} inspect() { return { phase: 'disconnected' }; } dispose() {} } };
      if (name.includes('xcode-project-controller')) return { XcodeProjectController: class { open() {} inspect() { return { phase: 'idle' }; } dispose() {} } };
      if (name.includes('platform-setup-controller')) return { PlatformSetupController: class { open() {} inspect() { return { phase: 'idle' }; } dispose() {} } };
      if (name.includes('runtime-workspace-store')) return runtimeWorkspaceModule;
      if (name.includes('runtime-state-suite-store')) return runtimeStateSuiteModule;
      if (name.includes('runtime-matrix-store')) return runtimeMatrixModule;
      if (name.includes('runtime-replay-store')) return runtimeReplayModule;
      if (name.includes('provider-credentials')) return { resolveProviderKey };
      if (name.includes('startup-diagnostics')) return { createStartupDiagnostics: () => ({}) };
      if (name.includes('workspace.mjs')) return { createProjectService: () => ({}) };
      if (name.includes('assistant.mjs')) return { createAssistantService: options => {
        configurations.push(clone(options.config)); return createAssistantService(options);
      } };
      if (name.startsWith('node:')) return projectRequire(name);
      return {};
    },
  });
  const host = new module.exports.FoundationHost({
    extensionPath: '/fixture', subscriptions: [], secrets: {
      get: async key => { reads.push(key); return readSecret ? readSecret(key) : stored.get(key); },
      store: async (key, value) => { stored.set(key, value); secretWrites.push({ key, value }); },
      delete: async key => { stored.delete(key); secretWrites.push({ key, deleted: true }); },
    },
  });
  host.sendState = () => states.push(clone(host.assistant?.status()));
  host.cancelQuestion = () => {};
  return {
    host, vscode, settings, stored, reads, secretWrites, updates, configurations, states, prompts, commands,
    get networkCalls() { return networkCalls; },
    fireConfiguration: (name = 'foundation.ai') => changeConfiguration({ affectsConfiguration: expected => name === expected }),
  };
}

test('native profiles use distinct provider and destination credentials without a legacy fallback', async () => {
  const urls = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1' };
  for (const kind of ['openai', 'anthropic', 'compatible']) {
    const url = urls[kind] || 'https://compatible.fixture/v1';
    const h = harness({ globals: { providerKind: kind, profiles: { [kind]: { baseUrl: url, model: `${kind}-fixture` } } }, secrets: { [legacyKeyName]: 'LEGACY_FIXTURE', [keyName(kind, url)]: `${kind}-key` }, environment: { FOUNDATION_AI_API_KEY: 'ENVIRONMENT_FIXTURE' } });
    await h.host.configureService();
    assert.deepEqual(h.reads, [keyName(kind, url)]);
    assert.equal(h.configurations[0].apiKey, `${kind}-key`);
    assert.equal(h.host.assistant.status().providerKind, kind);
    assert.equal(h.host.codeSuggestionService.status().providerKind, kind);
    assert.doesNotMatch(JSON.stringify(h.host.codeSuggestionService.status()), /apiKey|FIXTURE|key/);
    assert.equal(h.host.inlineEditService.status().providerKind, kind);
    assert.doesNotMatch(JSON.stringify(h.host.inlineEditService.status()), /apiKey|FIXTURE|key/);
    assert.doesNotMatch(JSON.stringify(h.host.assistant.status()), /apiKey|FIXTURE|key/);
    const changed = 'https://another.fixture/v1';
    h.settings.profiles[kind].baseUrl = changed;
    await h.host.configureService();
    assert.equal(h.reads.at(-1), keyName(kind, changed));
    assert.equal(h.configurations.at(-1).apiKey, undefined);
    assert.equal(h.host.assistant.status().configured, false);
    assert.equal(h.networkCalls, 0);
  }
});

test('disconnected, invalid and workspace-only settings never access secure storage', async () => {
  for (const globals of [ {}, { providerKind: 'openai' }, { providerKind: 'anthropic', profiles: { anthropic: { model: ' ' } } }, { providerKind: 'unsupported', profiles: { unsupported: { baseUrl: 'https://example.test/v1', model: 'm' } } }, { providerKind: 'compatible', profiles: { compatible: { baseUrl: 'https://user:secret@example.test/v1', model: 'm' } } } ]) {
    const h = harness({ globals, workspace: { providerKind: 'openai', profiles: { openai: { baseUrl: 'https://untrusted.fixture/v1', model: 'injected' } } } });
    await h.host.configureService();
    assert.equal(h.reads.length, 0);
    assert.equal(h.host.assistant.status().configured, false);
    assert.equal(h.networkCalls, 0);
  }
});

test('legacy compatible settings and environment-only providers retain separate precedence', async () => {
  const legacy = harness({ globals: { baseUrl: 'https://legacy.fixture/v1', model: 'legacy-model' }, secrets: { [legacyKeyName]: 'LEGACY_FIXTURE' }, environment: { FOUNDATION_AI_BASE_URL: 'https://ignored.fixture/v1', FOUNDATION_AI_MODEL: 'ignored', FOUNDATION_AI_API_KEY: 'ENV_FIXTURE' } });
  await legacy.host.configureService();
  assert.deepEqual(legacy.reads, [legacyKeyName]);
  assert.equal(legacy.configurations[0].providerKind, 'compatible');
  assert.equal(legacy.configurations[0].apiKey, 'LEGACY_FIXTURE');
  assert.equal(legacy.configurations[0].baseUrl, 'https://legacy.fixture/v1');
  for (const kind of [undefined, 'openai', 'anthropic']) {
    const h = harness({ environment: { ...(kind ? { FOUNDATION_AI_PROVIDER_KIND: kind } : {}), FOUNDATION_AI_BASE_URL: 'https://environment.fixture/v1', FOUNDATION_AI_MODEL: 'environment-model', FOUNDATION_AI_API_KEY: 'ENV_FIXTURE' }, secrets: { [legacyKeyName]: 'LEGACY_FIXTURE' } });
    await h.host.configureService();
    assert.equal(h.reads.length, 0); assert.equal(h.configurations[0].apiKey, 'ENV_FIXTURE');
    assert.equal(h.configurations[0].providerKind, kind || 'compatible'); assert.equal(h.host.assistant.status().configured, true);
  }
});

test('an environment native provider cannot consume a legacy compatible destination or key', async () => {
  for (const kind of ['openai', 'anthropic']) {
    const h = harness({ globals: { baseUrl: 'https://legacy.fixture/v1', model: 'legacy-model' }, environment: { FOUNDATION_AI_PROVIDER_KIND: kind, FOUNDATION_AI_MODEL: 'native-model', FOUNDATION_AI_API_KEY: 'NATIVE_FIXTURE' }, secrets: { [legacyKeyName]: 'LEGACY_FIXTURE' } });
    await h.host.configureService();
    assert.equal(h.reads.includes(legacyKeyName), false);
    assert.notEqual(h.configurations[0].baseUrl, 'https://legacy.fixture/v1');
    assert.notEqual(h.configurations[0].apiKey, 'LEGACY_FIXTURE');
  }
});

test('cancelling any provider setup step leaves configuration and credentials untouched', async () => {
  for (const [choice, inputs] of [[undefined, []], ['openai', []], ['openai', ['model']], ['anthropic', []], ['anthropic', ['model']], ['compatible', []], ['compatible', ['http://127.0.0.1:1234/v1']], ['compatible', ['http://127.0.0.1:1234/v1', 'model']]]) {
    const globals = { providerKind: 'openai', profiles: { openai: { baseUrl: 'https://api.openai.com/v1', model: 'existing-model' } } };
    const secrets = { [keyName('openai', 'https://api.openai.com/v1')]: 'EXISTING_FIXTURE' };
    const h = harness({ choice, inputs, globals, secrets });
    await h.host.configureProvider();
    assert.deepEqual(h.settings, globals); assert.deepEqual(Object.fromEntries(h.stored), secrets);
    assert.equal(h.updates.length + h.secretWrites.length + h.reads.length + h.configurations.length, 0);
    assert.equal(h.networkCalls, 0);
  }
});

test('a completed provider setup preserves other profiles and performs no validation request', async () => {
  const openaiUrl = 'https://api.openai.com/v1', anthropicUrl = 'https://api.anthropic.com/v1';
  const other = { baseUrl: openaiUrl, model: 'existing-openai' };
  const h = harness({ globals: { providerKind: 'openai', profiles: { openai: other } }, secrets: { [keyName('openai', openaiUrl)]: 'OTHER_FIXTURE' }, choice: 'anthropic', inputs: ['  selected-model  ', ' NEW_FIXTURE '] });
  await h.host.configureProvider(); await tick();
  assert.deepEqual(h.settings.profiles.openai, other);
  assert.deepEqual(h.settings.profiles.anthropic, { baseUrl: anthropicUrl, model: 'selected-model' });
  assert.equal(h.settings.providerKind, 'anthropic');
  assert.equal(h.stored.get(keyName('openai', openaiUrl)), 'OTHER_FIXTURE');
  assert.equal(h.stored.get(keyName('anthropic', anthropicUrl)), 'NEW_FIXTURE');
  assert.equal(h.configurations.length, 1, 'intermediate configuration notifications must be suppressed');
  assert.equal(h.networkCalls, 0); assert.doesNotMatch(JSON.stringify([h.updates, h.states]), /NEW_FIXTURE|OTHER_FIXTURE|apiKey/);
});

test('blank local-provider credentials remove only that provider destination key', async () => {
  const local = 'http://127.0.0.1:1234/v1', other = keyName('openai', 'https://api.openai.com/v1');
  const h = harness({ choice: 'compatible', inputs: [local, 'local-model', ''], secrets: { [keyName('compatible', local)]: 'LOCAL_FIXTURE', [other]: 'OTHER_FIXTURE' } });
  await h.host.configureProvider();
  assert.equal(h.stored.has(keyName('compatible', local)), false); assert.equal(h.stored.get(other), 'OTHER_FIXTURE');
  assert.equal(h.host.assistant.status().configured, true); assert.equal(h.networkCalls, 0);
});

test('provider configuration events only rebuild local service state and ignore unrelated settings', async () => {
  const h = harness({ environment: { FOUNDATION_AI_BASE_URL: 'http://127.0.0.1:1234/v1', FOUNDATION_AI_MODEL: 'local-model' } });
  h.fireConfiguration('editor.fontSize'); await tick(); assert.equal(h.configurations.length, 0);
  h.fireConfiguration(); await tick(); assert.equal(h.configurations.length, 1); assert.equal(h.states.length, 1);
  assert.equal(h.reads.length, 0); assert.equal(h.networkCalls, 0);
});

test('a delayed credential read cannot replace the newly selected provider', async () => {
  let resolveOld;
  const old = new Promise(resolve => { resolveOld = resolve; });
  const openai = 'https://api.openai.com/v1', anthropic = 'https://api.anthropic.com/v1';
  const h = harness({ globals: { providerKind: 'openai', profiles: { openai: { baseUrl: openai, model: 'old-model' }, anthropic: { baseUrl: anthropic, model: 'new-model' } } }, readSecret: key => key === keyName('openai', openai) ? old : 'NEW_FIXTURE' });
  const previous = h.host.configureService(); await tick();
  h.settings.providerKind = 'anthropic'; await h.host.configureService();
  resolveOld('OLD_FIXTURE'); await previous;
  assert.equal(h.configurations.length, 1); assert.equal(h.configurations[0].providerKind, 'anthropic'); assert.equal(h.configurations[0].apiKey, 'NEW_FIXTURE');
});

for (const transition of ['untrusted', 'missing-folder', 'changing-project']) {
  test(`${transition} retires native AI suggestions before asynchronous execution shutdown`, async () => {
    const h = harness(), calls = [];
    const oldProject = { id: 'old-project', root: '/fixture-old', files: [] };
    const completionAbort = new AbortController(), editAbort = new AbortController();
    let finishShutdown;
    const shutdown = new Promise(resolve => { finishShutdown = resolve; });
    let settled = false;
    h.host.project = oldProject;
    h.host.codeSuggestions = { stop() { calls.push('stop-suggestions'); completionAbort.abort(); } };
    h.host.inlineEdit = { dismiss() {
      calls.push('dismiss-edit'); editAbort.abort();
      // Native tab cleanup may itself be slow. Ownership is retired synchronously.
      return new Promise(() => {});
    } };
    h.host.stopExecutions = () => {
      calls.push('stop-executions');
      assert.equal(completionAbort.signal.aborted, true, 'completion must already be cancelled');
      assert.equal(editAbort.signal.aborted, true, 'inline proposal must already be retired');
      return shutdown;
    };
    h.host.resetRuntime = async () => { calls.push('reset-runtime'); };
    for (const name of ['clearFeatureView', 'clearAssistantContext', 'clearRelationships', 'updateTree']) h.host[name] = () => {};
    h.host.diagnostics = { runAsync: async () => ({ id: 'new-project', root: '/fixture-new', files: [] }) };
    h.vscode.workspace.isTrusted = transition !== 'untrusted';
    h.vscode.workspace.workspaceFolders = transition === 'changing-project'
      ? [{ uri: { scheme: 'file', fsPath: '/fixture-new' } }] : [];
    const pending = h.host.refresh().then(() => { settled = true; });
    assert.deepEqual(calls, ['stop-suggestions', 'dismiss-edit', 'stop-executions']);
    assert.equal(h.host.project, oldProject, 'old owner is not replaced while shutdown is pending');
    await tick();
    assert.equal(settled, false);
    assert.equal(calls.includes('reset-runtime'), false, 'shutdown remains blocked in the fixture');
    assert.equal(h.networkCalls, 0);
    // Supersede the refresh before releasing the shutdown gate. This isolates the
    // transition under test without invoking unrelated project indexing services.
    h.host.generation++;
    finishShutdown();
    await pending;
    assert.equal(settled, true);
    assert.equal(h.host.project, null);
    assert.equal(calls.filter(call => call === 'stop-suggestions').length, 1);
    assert.equal(calls.filter(call => call === 'dismiss-edit').length, 1);
  });
}
