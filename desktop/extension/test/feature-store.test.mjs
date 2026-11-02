import assert from 'node:assert/strict';
import test from 'node:test';
import { createFeatureStore, suggestFeatureFiles } from '../src/feature-store.mjs';

function fixture(previous) {
  let disk = previous, fail = false;
  const writes = [], notifications = [];
  const store = createFeatureStore({ projectId: 'project-one', read: () => disk, write: async value => {
    writes.push(structuredClone(value));
    if (fail) throw new Error('private adapter details /Users/private/key');
    disk = structuredClone(value);
  }, onChange: () => notifications.push(store.snapshot()) });
  return { store, writes, notifications, get disk() { return disk; }, set disk(value) { disk = value; }, set fail(value) { fail = value; } };
}
const current = store => store.snapshot().revision;
const create = (store, extra = {}) => store.create({ title: 'Save profile', ...extra }, current(store));
const active = store => store.snapshot().features.find(item => item.id === store.snapshot().activeId);

 test('features persist across restart with isolated snapshots and caller input', async () => {
  const f = fixture();
  const input = { title: '  Save profile  ', brief: 'Improve loading and error states.', paths: ['src/Save.tsx'], entryPath: 'src/Save.tsx' };
  const saved = await f.store.create(input, 0);
  assert.equal(saved.revision, 1); assert.equal(saved.features[0].title, 'Save profile');
  assert.equal(saved.activeId, saved.features[0].id); assert.equal(saved.storage.status, 'saved');
  assert.match(saved.features[0].id, /^[0-9a-f-]{36}$/);
  input.paths.push('caller.ts'); saved.features[0].paths.push('caller-2.ts');
  assert.deepEqual(active(f.store).paths, ['src/Save.tsx']);
  assert.equal('storage' in f.disk, false);
  await f.store.dispose();
  const restored = fixture(f.disk); assert.deepEqual(restored.store.snapshot(), f.store.snapshot());
  assert.equal(restored.writes.length, 0); await restored.store.dispose();
});

test('edits, explicit selection and reversible archive never discard feature records', async () => {
  const f = fixture(); await create(f.store); const first = active(f.store).id;
  await create(f.store, { title: 'Payment' }); const second = active(f.store).id;
  await f.store.select(first, current(f.store));
  await f.store.update(first, { brief: 'A new brief', paths: ['src/Save.tsx'], entryPath: 'src/Save.tsx' }, current(f.store));
  assert.equal(active(f.store).entryPath, 'src/Save.tsx');
  await f.store.update(first, { paths: [], entryPath: null }, current(f.store));
  assert.equal('entryPath' in active(f.store), false);
  await f.store.archive(first, true, current(f.store)); assert.equal(f.store.snapshot().activeId, null);
  await assert.rejects(f.store.select(first, current(f.store)), { code: 'feature-archived' });
  await f.store.archive(first, false, current(f.store)); assert.equal(f.store.snapshot().activeId, null);
  await f.store.select(second, current(f.store)); await f.store.select(null, current(f.store));
  assert.equal(f.store.snapshot().features.length, 2); assert.equal(f.store.snapshot().features[0].brief, 'A new brief');
  await f.store.dispose();
});

test('stale renderer mutations reject, including competing queued updates', async () => {
  const f = fixture(); await create(f.store); const id = active(f.store).id, revision = current(f.store);
  const one = f.store.update(id, { title: 'First edit' }, revision);
  const two = f.store.update(id, { title: 'Older competing edit' }, revision);
  await one; await assert.rejects(two, { code: 'feature-stale-revision' });
  for (const action of [() => f.store.create({ title: 'Stale' }, revision), () => f.store.select(null, revision), () => f.store.archive(id, true, revision), () => f.store.update(id, {}, undefined)]) {
    await assert.rejects(action(), { code: 'feature-stale-revision' });
  }
  assert.equal(active(f.store).title, 'First edit'); assert.equal(f.writes.length, 2); await f.store.dispose();
});

test('writes serialize and capture mutable inputs before they wait', async () => {
  let disk, inFlight = 0, highWater = 0; const pending = [];
  const store = createFeatureStore({ projectId: 'queue', read: () => disk, write: value => new Promise(resolve => {
    inFlight++; highWater = Math.max(highWater, inFlight);
    pending.push(() => { disk = structuredClone(value); inFlight--; resolve(); });
  }) });
  const first = store.create({ title: 'First' }, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.snapshot().storage.status, 'saving');
  const input = { title: 'Second', paths: ['src/Second.ts'] };
  const second = store.create(input, 1); input.title = 'Mutated'; input.paths.push('../outside');
  assert.equal(pending.length, 1); pending.shift()(); await first;
  await new Promise(resolve => setImmediate(resolve)); assert.equal(pending.length, 1);
  pending.shift()(); await second;
  assert.equal(highWater, 1); assert.equal(disk.features[1].title, 'Second'); assert.deepEqual(disk.features[1].paths, ['src/Second.ts']);
  await store.dispose();
});

test('failed persistence rejects the action and safely retries the same pending revision', async () => {
  const f = fixture(); f.fail = true;
  await assert.rejects(create(f.store), { code: 'feature-storage' });
  const pending = f.store.snapshot(); assert.equal(pending.storage.status, 'error'); assert.equal(f.disk, undefined);
  assert.equal(pending.features.length, 1); assert.doesNotMatch(JSON.stringify(pending), /private adapter|\/Users\/private/);
  await assert.rejects(f.store.update(pending.activeId, { title: 'Cannot overwrite pending edit' }, pending.revision), { code: 'feature-storage' });
  await assert.rejects(f.store.retry(), { code: 'feature-storage' });
  f.fail = false; const saved = await f.store.retry();
  assert.equal(saved.revision, pending.revision); assert.equal(saved.activeId, pending.activeId); assert.equal(saved.storage.status, 'saved');
  assert.equal(saved.features.length, 1); assert.deepEqual(f.writes[0], f.writes.at(-1));
  assert.ok(f.notifications.some(item => item.storage.status === 'saving'));
  await f.store.dispose();
});

test('unsupported, corrupt and foreign project data is never overwritten', async () => {
  const seed = fixture(); await create(seed.store); await seed.store.dispose();
  const badValues = [
    { ...seed.disk, schemaVersion: 2 }, { ...seed.disk, projectId: 'another-project' },
    { ...seed.disk, activeId: 'missing' }, { ...seed.disk, unknownFutureField: {} },
    { ...seed.disk, features: [seed.disk.features[0], seed.disk.features[0]] },
    { ...seed.disk, features: [{ ...seed.disk.features[0], paths: ['../outside'] }] },
    { ...seed.disk, features: [{ ...seed.disk.features[0], title: ' Untrimmed ' }] },
    { ...seed.disk, features: [{ ...seed.disk.features[0], createdAt: '2026-02-30T12:00:00.000Z' }] },
    { ...seed.disk, features: [{ ...seed.disk.features[0], archived: true }] },
    { schemaVersion: 1 }, 'invalid data', Promise.resolve(seed.disk),
  ];
  for (const bad of badValues) {
    const f = fixture(bad); assert.equal(f.store.snapshot().storage.status, 'unavailable');
    await assert.rejects(create(f.store), { code: 'feature-unavailable' });
    await assert.rejects(f.store.retry(), { code: 'feature-unavailable' });
    await f.store.dispose(); assert.equal(f.disk, bad); assert.equal(f.writes.length, 0);
  }
});

test('retry can reread externally repaired storage without writing it', async () => {
  const seed = fixture(); await create(seed.store); await seed.store.dispose();
  const f = fixture({ schemaVersion: 20 });
  f.disk = seed.disk; const result = await f.store.retry();
  assert.equal(result.storage.status, 'saved'); assert.equal(result.activeId, seed.disk.activeId); assert.equal(f.writes.length, 0);
  await f.store.dispose();
});

test('read failures are unavailable and error details stay private', async () => {
  let writes = 0;
  const store = createFeatureStore({ projectId: 'read-error', read() { throw new Error('PRIVATE_STORAGE_PATH'); }, write() { writes++; } });
  assert.equal(store.snapshot().storage.status, 'unavailable');
  await assert.rejects(store.retry(), { code: 'feature-unavailable' });
  assert.doesNotMatch(JSON.stringify(store.snapshot()), /PRIVATE_STORAGE_PATH/);
  await store.dispose(); assert.equal(writes, 0);
});

test('path traversal, duplicate paths, invalid fields and entry mismatches reject before mutation', async () => {
  const f = fixture();
  for (const path of ['../secret', 'src/../secret', '/absolute', 'C:/secret', 'https://example.com', 'src\\file.ts', './file.ts', 'src//file.ts', 'src/', 'src/\0x', 'src/\nx', ' path.ts']) {
    await assert.rejects(create(f.store, { paths: [path] }), { code: 'feature-invalid-input' });
  }
  for (const extra of [{ title: '' }, { title: 'x'.repeat(81) }, { title: 'Line\nbreak' }, { brief: 'x'.repeat(2001) }, { paths: ['a.ts', 'a.ts'] },
    { paths: ['a.ts'], entryPath: 'b.ts' }, { entryPath: null }, { id: 'injected-id' }, { archived: true }, { paths: 'a.ts' }]) {
    await assert.rejects(create(f.store, extra), { code: 'feature-invalid-input' });
  }
  assert.equal(f.writes.length, 0); assert.equal(current(f.store), 0);
  await create(f.store, { paths: ['src/Existing.ts'], entryPath: 'src/Existing.ts' });
  await assert.rejects(f.store.update(active(f.store).id, { paths: [] }, current(f.store)), { code: 'feature-invalid-input' });
  assert.equal(current(f.store), 1); await f.store.dispose();
});

test('feature and path capacity are explicit and never evict archived records', async () => {
  const f = fixture();
  const paths = Array.from({ length: 32 }, (_, index) => `src/File${index}.ts`);
  await create(f.store, { title: 'x'.repeat(80), brief: 'x'.repeat(2000), paths });
  await assert.rejects(f.store.update(active(f.store).id, { paths: [...paths, 'src/Overflow.ts'] }, current(f.store)), { code: 'feature-invalid-input' });
  await f.store.archive(active(f.store).id, true, current(f.store));
  for (let index = 1; index < 20; index++) await create(f.store, { title: `Feature ${index}` });
  const before = structuredClone(f.disk);
  await assert.rejects(create(f.store), { code: 'feature-capacity' });
  assert.deepEqual(f.disk, before); assert.equal(f.store.snapshot().features[0].archived, true); await f.store.dispose();
});

test('missing source paths remain explicit membership after restart and metadata edits', async () => {
  const f = fixture(); await create(f.store, { paths: ['src/renamed-or-missing.ts'], entryPath: 'src/renamed-or-missing.ts' });
  await f.store.dispose(); const restored = fixture(f.disk);
  await restored.store.update(active(restored.store).id, { brief: 'Keep the missing reference visible until the user removes it.' }, current(restored.store));
  assert.deepEqual(active(restored.store).paths, ['src/renamed-or-missing.ts']); assert.equal(active(restored.store).entryPath, 'src/renamed-or-missing.ts');
  await restored.store.dispose();
});

test('unknown IDs reject and no-op operations do not increment revisions or write', async () => {
  const f = fixture(); await create(f.store); const id = active(f.store).id;
  await f.store.update(id, {}, 1); await f.store.select(id, 1); await f.store.archive(id, false, 1); await f.store.retry();
  assert.equal(current(f.store), 1); assert.equal(f.writes.length, 1);
  for (const action of [() => f.store.select('foreign-feature', 1), () => f.store.update('foreign-feature', {}, 1), () => f.store.archive('foreign-feature', true, 1)]) {
    await assert.rejects(action(), { code: 'feature-unknown' });
  }
  await f.store.dispose(); await assert.rejects(f.store.retry(), { code: 'feature-closed' });
});

test('dispose awaits queued persistence and prevents new mutations without retrying failed saves', async () => {
  let finish, writes = 0;
  const store = createFeatureStore({ projectId: 'dispose', read: () => undefined, write: () => { writes++; return new Promise(resolve => { finish = resolve; }); } });
  const creation = store.create({ title: 'Retained' }, 0); await new Promise(resolve => setImmediate(resolve));
  let closed = false; const disposal = store.dispose().then(() => { closed = true; });
  await assert.rejects(store.create({ title: 'Too late' }, 1), { code: 'feature-closed' }); assert.equal(closed, false);
  finish(); await creation; await disposal; assert.equal(closed, true); assert.equal(writes, 1);
  const f = fixture(); f.fail = true; await assert.rejects(create(f.store)); await f.store.dispose(); assert.equal(f.writes.length, 1);
});

const anchor = () => ({ path: 'src/SaveButton.tsx', analysis: { imports: [{ resolvedPath: 'src/api.ts', line: 3 }, { resolvedPath: null, line: 4 }, { resolvedPath: '../outside.ts', line: 5 }],
  consumers: [{ path: 'src/Profile.tsx', line: 8 }], unsupported: false } });
const inventory = paths => paths.map(path => ({ path, size: 1 }));

test('file suggestions distinguish resolved source relations from test filename candidates', () => {
  const files = inventory(['src/SaveButton.tsx', 'src/api.ts', 'src/Profile.tsx', 'tests/SaveButton.test.tsx', 'src/__tests__/SaveButton.tsx', 'tests/SaveButton.spec.tsx', 'tests/OtherSaveButton.test.tsx']);
  assert.deepEqual(suggestFeatureFiles({ anchorFile: anchor(), inventory: files }), [
    { path: 'src/api.ts', reason: 'import', provenance: 'source' },
    { path: 'src/Profile.tsx', reason: 'consumer', provenance: 'source', line: 8 },
    { path: 'tests/SaveButton.test.tsx', reason: 'test-name', provenance: 'filename' },
    { path: 'src/__tests__/SaveButton.tsx', reason: 'test-name', provenance: 'filename' },
    { path: 'tests/SaveButton.spec.tsx', reason: 'test-name', provenance: 'filename' },
  ]);
});

test('suggestions require known inventory, exclude existing paths, deduplicate, and never add automatically', () => {
  const source = anchor(); source.analysis.consumers.push({ path: 'src/api.ts', line: 99 });
  const files = inventory(['src/SaveButton.tsx', 'src/api.ts', 'tests/SaveButton.test.tsx']);
  const existing = ['tests/SaveButton.test.tsx']; const before = structuredClone({ source, files, existing });
  assert.deepEqual(suggestFeatureFiles({ anchorFile: source, inventory: files, existingPaths: existing }), [{ path: 'src/api.ts', reason: 'import', provenance: 'source' }]);
  assert.deepEqual({ source, files, existing }, before);
  assert.deepEqual(suggestFeatureFiles({ anchorFile: source, inventory: inventory(['src/api.ts']) }), []);
  source.analysis.unsupported = true;
  assert.deepEqual(suggestFeatureFiles({ anchorFile: source, inventory: files }), [{ path: 'tests/SaveButton.test.tsx', reason: 'test-name', provenance: 'filename' }]);
});

test('suggestions prioritize direct source relationships and cap the list at 24', () => {
  const source = anchor(); source.analysis.imports = Array.from({ length: 30 }, (_, index) => ({ resolvedPath: `src/File${index}.ts`, line: index + 1 }));
  const files = inventory(['src/SaveButton.tsx', ...source.analysis.imports.map(item => item.resolvedPath), 'tests/SaveButton.test.tsx']);
  const result = suggestFeatureFiles({ anchorFile: source, inventory: files });
  assert.equal(result.length, 24); assert.ok(result.every(item => item.provenance === 'source')); assert.equal(result.at(-1).path, 'src/File23.ts');
});
