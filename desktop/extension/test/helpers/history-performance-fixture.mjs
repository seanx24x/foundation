import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Populated, validated local history. The observation values are synthetic test
// records, never runtime evidence from the user's projects.
const root = process.env.FOUNDATION_HISTORY_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const { createRuntimeWorkspaceStore } = await import(join(root, 'desktop/extension/src/runtime-workspace-store.mjs'));
const { createConversationStore } = await import(join(root, 'desktop/extension/src/conversation-store.mjs'));
const hash = text => createHash('sha256').update(text).digest('hex');
const timestamp = '2026-10-30T12:00:00.000Z';

export function populatedHistory({ sourceCount = 32, sourceBytes = 8192, runCount = 40, observationsPerRun = 100 } = {}) {
  const files = Array.from({ length: sourceCount }, (_, i) => {
    const path = `src/member-${i}.ts`, source = `// Synthetic saved source ${i}\n`.padEnd(sourceBytes, ' ');
    return { path, source, revision: hash(source).slice(0, 16) };
  });
  const project = { id: 'history-load-fixture', root: '/fixtures/history-load', files: files.map(({ path }) => ({ path })) };
  const feature = { id: randomUUID(), title: 'Synthetic profile history', revision: 3, paths: files.map(file => file.path) };
  const screen = { id: randomUUID(), featureId: feature.id, title: 'Profile', targetId: 'vite:dev', route: '/profile', archived: false, createdAt: timestamp, updatedAt: timestamp };
  const scenario = { id: randomUUID(), screenId: screen.id, title: 'Save profile', steps: ['Press Save.'], expectedOutcome: 'Show the saved state.', archived: false, createdAt: timestamp, updatedAt: timestamp };
  const runtime = { targetId: screen.targetId, session: '1'.repeat(32), viewId: '2'.repeat(32), documentId: '3'.repeat(32), route: screen.route, pageVersion: 1 };
  const runs = Array.from({ length: runCount }, (_, i) => ({
    id: randomUUID(), feature, screen, scenario, definitionRevision: 2, runtime,
    sources: files.map(file => ({ path: file.path, revision: hash(file.source) })), dirtyPaths: [],
    startedAt: timestamp, endedAt: timestamp, status: 'completed', assessment: 'not-assessed', note: 'Synthetic load fixture.', truncated: false,
    observations: Array.from({ length: observationsPerRun }, (_, j) => ({
      id: `${runtime.session}:${runtime.viewId}:${i}-${j}`, session: runtime.session, documentId: runtime.documentId,
      kind: 'request', method: 'POST', url: `http://127.0.0.1:4173/api/${'synthetic-'.repeat(75)}${j}`,
      status: 200, durationMs: 20, outcome: 'success', observedAt: timestamp, timing: 'response-headers', correlation: 'unattributed',
    })),
  }));
  const data = { schemaVersion: 1, projectId: project.id, revision: 82, activeScreenId: screen.id, activeScenarioId: scenario.id, screens: [screen], scenarios: [scenario], runs };
  const store = createRuntimeWorkspaceStore({ projectId: project.id, read: () => data, write: async () => {} });
  assert.equal(store.snapshot().storage.status, 'saved');
  assert.equal(store.snapshot().runs.length, runCount);
  return { project, files, feature, screen, scenario, runtime, data, store };
}

export function populatedConversationStore(projectId) {
  const conversations = Array.from({ length: 10 }, (_, i) => ({
    id: `conversation-${i}`, title: `Synthetic conversation ${i}`, createdAt: timestamp, updatedAt: timestamp, archived: false,
    turns: Array.from({ length: 10 }, (_, j) => ({
      id: `request-${i}-${j}`, requestId: `request-${i}-${j}`, question: 'Describe the saved source.', intent: 'ask',
      context: [{ path: 'src/App.tsx', revision: 'recorded-revision', source: 'export const fixture = true;' }],
      answer: 'Synthetic saved answer. '.repeat(1400), state: 'complete', model: 'synthetic-history-fixture', started: true,
      createdAt: timestamp, updatedAt: timestamp, verificationHistory: [],
    })),
  }));
  const data = { schemaVersion: 8, projectId, revision: 100, activeId: conversations[0].id, conversations };
  const store = createConversationStore({ projectId, read: () => data, write: async () => {} });
  assert.equal(store.snapshot().storage.status, 'saved');
  assert.equal(store.snapshot().conversations.length, 10);
  return { store, bytes: Buffer.byteLength(JSON.stringify(data)) };
}

let compiledCache = new Map();
export function historyHost({ source, fixture = populatedHistory() } = {}) {
  source ||= readFileSync(join(root, 'desktop/extension/src/extension.ts'), 'utf8');
  let compiled = compiledCache.get(source);
  if (!compiled) { compiled = ts.transpileModule(`${source}\nexport { FoundationHost };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; compiledCache.set(source, compiled); }
  const calls = { hashes: 0, bytes: 0 }, vscode = { workspace: { isTrusted: true } }, module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Buffer, URL, AbortController, TextDecoder, setTimeout, clearTimeout,
    require: name => name === 'vscode' ? vscode : name === 'node:crypto' ? { ...require(name), createHash: algorithm => {
      calls.hashes++; const real = createHash(algorithm); return { update(text) { calls.bytes += Buffer.byteLength(text); real.update(text); return this; }, digest: encoding => real.digest(encoding) };
    } } : name.startsWith('node:') ? require(name) : {},
  });
  const host = Object.create(module.exports.FoundationHost.prototype);
  const features = { features: [{ ...fixture.feature, archived: false }], activeId: fixture.feature.id, revision: 3 };
  Object.assign(host, { project: { ...fixture.project }, featureFiles: fixture.files, openFiles: [], featureUnavailable: [],
    runtimeWorkspaceStore: () => fixture.store, featureSnapshot: () => features,
    disposed: false, runtimeWorkspaceBusy: undefined, runtimeWorkspaceError: undefined });
  return { host, fixture, features, vscode, calls,
    // Match the webview message clone; use the raw host method for ownership assertions.
    snapshot: () => structuredClone(host.runtimeWorkspaceSnapshot()),
    resetCounts() { calls.hashes = 0; calls.bytes = 0; },
  };
}
