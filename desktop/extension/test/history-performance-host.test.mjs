import test from 'node:test';
import assert from 'node:assert/strict';
import { historyHost, populatedHistory } from './helpers/history-performance-fixture.mjs';

function small() { return historyHost({ fixture: populatedHistory({ sourceCount: 3, sourceBytes: 1024, runCount: 4, observationsPerRun: 2 }) }); }
const statuses = h => h.snapshot().runFreshness.map(item => item.status);

test('populated runtime history hashes each exact loaded source once and reuses it across snapshots', () => {
  const h = historyHost();
  assert.equal(statuses(h).every(value => value === 'current'), true);
  assert.equal(h.calls.hashes, 32, '40 historical runs share 32 saved source digests');
  assert.equal(h.calls.bytes, 256 * 1024, 'the actual loaded feature context cap');
  h.resetCounts();
  for (let i = 0; i < 5; i++) assert.equal(statuses(h).every(value => value === 'current'), true);
  assert.deepEqual(h.calls, { hashes: 0, bytes: 0 });
  assert.equal(h.host.runtimeSourceHashCache.entries.size, 32);
});

test('exact source content controls reuse even when saved revision tokens or file objects are misleading', () => {
  const h = small(); statuses(h); h.resetCounts();
  h.host.featureFiles = h.host.featureFiles.map(file => ({ ...file, revision: 'different-token' }));
  assert.ok(statuses(h).every(value => value === 'current'));
  assert.equal(h.calls.hashes, 0);
  const original = h.host.featureFiles[0].source;
  h.host.featureFiles[0].source = '// changed saved source';
  assert.ok(statuses(h).every(value => value === 'stale'));
  assert.equal(h.calls.hashes, 1, 'same token does not disguise changed bytes');
  h.resetCounts(); h.host.featureFiles[0].source = original;
  assert.ok(statuses(h).every(value => value === 'current'));
  assert.equal(h.calls.hashes, 3, 'unvisited entries were pruned when stale runs stopped at their first source');
});

test('feature source precedence is preserved and removal exposes an open-file snapshot or unknown state', () => {
  const h = small(); const first = h.host.featureFiles[0];
  h.host.openFiles = [{ ...first, source: '// Different open saved snapshot' }];
  assert.ok(statuses(h).every(value => value === 'current'));
  h.resetCounts(); h.host.featureFiles = h.host.featureFiles.slice(1);
  assert.ok(statuses(h).every(value => value === 'stale'));
  assert.equal(h.calls.hashes, 1);
  h.host.openFiles = [];
  assert.ok(statuses(h).every(value => value === 'unknown'));
  assert.equal(h.host.runtimeSourceHashCache.entries.has(first.path), false);
  h.host.featureFiles = [];
  assert.ok(statuses(h).every(value => value === 'unknown'));
  assert.equal(h.host.runtimeSourceHashCache.entries.size, 0);
});

test('definitions and source-unavailable precedence stay live rather than cached with source digests', () => {
  const h = small(); statuses(h); h.resetCounts();
  const snapshot = h.fixture.store.snapshot();
  h.host.runtimeWorkspaceStore = () => ({ snapshot: () => structuredClone(snapshot) });
  snapshot.screens[0].updatedAt = '2026-10-30T13:00:00.000Z';
  assert.ok(statuses(h).every(value => value === 'stale'));
  assert.equal(h.calls.hashes, 0);
  snapshot.screens[0] = structuredClone(h.fixture.screen);
  snapshot.scenarios[0].archived = true;
  assert.ok(statuses(h).every(value => value === 'stale'));
  snapshot.scenarios[0] = structuredClone(h.fixture.scenario);
  h.features.features[0].paths.reverse();
  assert.ok(statuses(h).every(value => value === 'stale'));
  h.features.features[0].paths.reverse();
  h.host.featureFiles[0].source = 'changed';
  h.host.featureUnavailable = [{ path: h.host.featureFiles[1].path, kind: 'source-unavailable' }];
  assert.ok(statuses(h).every(value => value === 'unknown'));
  assert.equal(h.calls.hashes, 0, 'unavailable still takes precedence over changed saved source');
  h.host.featureUnavailable = [];
  assert.ok(statuses(h).every(value => value === 'stale'));
});

test('historical freshness uses saved text only and retains unknown context-limit behavior', () => {
  const h = small();
  h.host.dirtyPaths = () => { throw Error('Historical freshness must not inspect unsaved bytes or dirty state'); };
  h.vscode.workspace.textDocuments = [{ getText() { throw Error('Never read an unsaved buffer'); } }];
  h.host.featureUnavailable = [{ path: h.host.featureFiles[0].path, kind: 'context-limit' }];
  assert.ok(statuses(h).every(value => value === 'current'));
  h.host.featureFiles = h.host.featureFiles.slice(1);
  assert.ok(statuses(h).every(value => value === 'unknown'));
});

test('project identity, root, trust and feature clearing discard retained source digests', () => {
  const h = small(); statuses(h); h.resetCounts();
  h.host.project.root = '/fixtures/different-root'; statuses(h); assert.equal(h.calls.hashes, 3);
  h.resetCounts(); h.host.project.id = 'different-project'; statuses(h); assert.equal(h.calls.hashes, 3);
  h.vscode.workspace.isTrusted = false; assert.equal(h.snapshot(), null); assert.equal(h.host.runtimeSourceHashCache, undefined);
  h.resetCounts(); h.vscode.workspace.isTrusted = true; statuses(h); assert.equal(h.calls.hashes, 3);
  h.host.project = null; assert.equal(h.snapshot(), null); assert.equal(h.host.runtimeSourceHashCache, undefined);
  h.host.project = { ...h.fixture.project }; statuses(h); h.host.clearFeatureView(); assert.equal(h.host.runtimeSourceHashCache, undefined);
});

test('storage errors, active observation overlays and returned history remain independent of cached hashes', () => {
  const h = small(); const snapshot = h.fixture.store.snapshot(); snapshot.runs[0].status = 'recording';
  h.host.runtimeWorkspaceStore = () => ({ snapshot: () => structuredClone(snapshot) });
  h.host.scenarioCapture = { run: { id: snapshot.runs[0].id }, observations: [{ id: 'live-1' }], truncated: false };
  const first = h.snapshot(); h.resetCounts();
  snapshot.storage = { status: 'error', message: 'Synthetic local storage error' };
  h.host.runtimeWorkspaceBusy = 'finish'; h.host.runtimeWorkspaceError = 'Save failed';
  h.host.scenarioCapture.observations.push({ id: 'live-2' }); h.host.scenarioCapture.truncated = true;
  const next = h.snapshot();
  assert.equal(next.storage.status, 'error'); assert.equal(next.busy, 'finish'); assert.equal(next.error, 'Save failed');
  assert.equal(next.activeRun.observations.length, 2); assert.equal(next.activeRun.truncated, true);
  assert.equal(first.activeRun.observations.length, 1);
  const raw = h.host.runtimeWorkspaceSnapshot();
  raw.runs[1].note = 'Consumer mutation'; raw.runFreshness[0].status = 'forged';
  assert.notEqual(h.snapshot().runs[1].note, 'Consumer mutation'); assert.equal(h.snapshot().runFreshness[0].status, 'current');
  assert.equal(h.calls.hashes, 0);
});

test('disposal releases saved source digests and preserves normal host cleanup', async () => {
  const h = small(); statuses(h);
  Object.assign(h.host, { clearRelationships() {}, settleAssistantReveal() {}, cancelQuestion() {}, resetRuntime: async () => {},
    conversationStores: new Map(), snapshots: new Map(), focusPersistence: Promise.resolve() });
  await h.host.dispose();
  assert.equal(h.host.runtimeSourceHashCache, undefined);
  assert.equal(h.host.disposed, true);
});
