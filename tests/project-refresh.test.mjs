import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtemp, mkdir, readFile, writeFile, rm, symlink, stat, utimes } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import ts from 'typescript';
import { createProjectService, projectRevision } from '../server/project/workspace.mjs';

async function fixture(t, sources = {
  'src/a.ts': 'export const a = 1;\n',
  'src/b.ts': "import { a } from './a'; export const b = () => fetch('/api/b');\n",
  'src/c.ts': "export { a } from './a'; import('./b');\n",
  'src/d.ts': "const a = require('./a');\n",
  'src/broken.ts': "import { a } from './a'; export function broken( {",
  'src/self.ts': "import './self'; export const self = 1;\n",
  'style.css': ':root { --accent: blue; }',
  'README.md': '# Fixture\n',
}) {
  const root = await mkdtemp('/private/tmp/foundation-source-refresh-'), projectRoot = join(root, 'projects/orbit');
  for (const [path, source] of Object.entries(sources)) {
    await mkdir(join(projectRoot, path, '..'), { recursive: true });
    await writeFile(join(projectRoot, path), source);
  }
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = createProjectService({root}), project = await service.snapshot();
  return {root, projectRoot, service, project, id: project.id};
}

async function intercept(t, name, callback, work) {
  const original = fs[name], mock = t.mock.method(fs, name, (...args) => callback(original, ...args));
  syncBuiltinESMExports();
  try { return await work(); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
}

test('a bounded source batch matches individual analyses, including malformed files, non-source files, self imports and consumers', async t => {
  const f = await fixture(t), paths = ['src/a.ts', 'style.css', 'src/b.ts', 'src/broken.ts', 'src/self.ts', 'README.md'];
  const expected = [];
  for (const path of paths) expected.push(await f.service.getFile(f.id, path));
  const result = await f.service.getFiles(f.id, [...paths, paths[0]]);
  assert.deepEqual(result.files, expected);
  assert.deepEqual(result.unavailable, []);
  assert.equal(result.truncated, false);
  assert.ok(Number.isFinite(Date.parse(result.indexedAt)));
  assert.equal(result.files[0].analysis.consumers.some(item => item.path === 'src/broken.ts'), false);
  assert.deepEqual(result.files.find(file => file.path === 'src/self.ts').analysis.consumers, []);
});

test('one refresh inventories once and parses each source once; final exact-target checks add only one read per target', async t => {
  const sources = Object.fromEntries(Array.from({length: 12}, (_, i) => [`src/file${i}.ts`, `export const value${i} = ${i};\n`]));
  const f = await fixture(t, sources), paths = Object.keys(sources).slice(0, 8);
  let opens = 0, directories = 0;
  ts.performance.enable();
  try {
    await intercept(t, 'open', async (original, ...args) => { opens++; return original(...args); }, () =>
      intercept(t, 'readdir', async (original, ...args) => { directories++; return original(...args); }, async () => {
        ts.performance.clearMarks();
        for (const path of paths) await f.service.getFile(f.id, path);
        assert.equal(opens, 12 * 8);
        assert.equal(directories, 2 * 8);
        assert.equal(ts.performance.getCount('beforeParse'), 12 * 8);
        opens = 0; directories = 0; ts.performance.clearMarks();
        const batch = await f.service.getFiles(f.id, paths);
        assert.equal(batch.files.length, 8);
        assert.equal(opens, 12 + 8);
        assert.equal(directories, 2);
        assert.equal(ts.performance.getCount('beforeParse'), 12);
      }));
  } finally { ts.performance.disable(); ts.performance.clearMarks(); ts.performance.clearMeasures(); }
});

test('each batch rebuilds exact source and consumer evidence after edits, deletions, new imports and ignore changes', async t => {
  const f = await fixture(t), target = 'src/a.ts';
  const before = await f.service.getFiles(f.id, [target]);
  const edited = 'export const a = 2;\n';
  await writeFile(join(f.projectRoot, target), edited);
  await rm(join(f.projectRoot, 'src/d.ts'));
  await writeFile(join(f.projectRoot, 'src/new.ts'), "import './a';\n");
  await writeFile(join(f.projectRoot, '.gitignore'), 'src/b.ts\n');
  const after = await f.service.getFiles(f.id, [target, 'src/b.ts']);
  assert.notEqual(after.files[0].revision, before.files[0].revision);
  assert.equal(after.files[0].revision, projectRevision(edited));
  assert.deepEqual(after.files[0], await f.service.getFile(f.id, target));
  assert.deepEqual(after.files[0].analysis.consumers.map(item => item.path), ['src/c.ts', 'src/new.ts']);
  assert.deepEqual(after.unavailable.map(item => [item.path, item.code]), [['src/b.ts', 'excluded-path']]);
});

test('per-path failures retain readable targets without exposing hidden, traversing, ignored, binary, oversized or symlinked sources', async t => {
  const f = await fixture(t);
  await writeFile(join(f.projectRoot, '.gitignore'), 'src/b.ts\n');
  await writeFile(join(f.projectRoot, 'src/binary.ts'), Buffer.from([0, 1]));
  await writeFile(join(f.projectRoot, 'src/large.ts'), '//'+ 'x'.repeat(256 * 1024));
  await writeFile(join(f.root, 'outside.ts'), 'PRIVATE_OUTSIDE_SENTINEL');
  await symlink(join(f.root, 'outside.ts'), join(f.projectRoot, 'src/link.ts'));
  const paths = ['src/a.ts', '../outside.ts', '.env', 'src/b.ts', 'src/missing.ts', 'src/binary.ts', 'src/large.ts', 'src/link.ts'];
  const result = await f.service.getFiles(f.id, paths);
  assert.deepEqual(result.files.map(file => file.path), ['src/a.ts']);
  assert.deepEqual(result.unavailable.map(item => item.code), ['invalid-path', 'excluded-path', 'excluded-path', 'file-not-found', 'binary-file', 'file-too-large', 'symlink-rejected']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_OUTSIDE_SENTINEL/);
  assert.equal(result.truncated, true);
  assert.equal(result.files[0].analysis.consumersTruncated, true);
});

test('source batch rejects oversized and malformed path arrays before performing file work', async t => {
  const f = await fixture(t);
  for (const value of [null, 'src/a.ts', [null], new Array(193).fill('src/a.ts')]) {
    await assert.rejects(f.service.getFiles(f.id, value), {code: 'invalid-source-batch'});
  }
  assert.deepEqual((await f.service.getFiles(f.id, [])).files, []);
  await assert.rejects(f.service.getFiles('another-project', ['src/a.ts']), {code: 'project-conflict'});
});

for (const stage of ['before', 'scan', 'read', 'last-check']) {
  test(`cancellation ${stage} rejects the whole batch without partial results`, async t => {
    const f = await fixture(t); let current = stage !== 'before', reads = 0;
    const operation = () => f.service.getFiles(f.id, ['src/a.ts'], {isCurrent: () => current});
    if (stage === 'scan') {
      await intercept(t, 'readdir', async (original, ...args) => { const result = await original(...args); current = false; return result; },
        () => assert.rejects(operation(), {code: 'source-batch-cancelled'}));
    } else if (stage === 'read' || stage === 'last-check') {
      await intercept(t, 'open', async (original, path, ...args) => {
        if (String(path).endsWith('/src/a.ts')) reads++;
        if ((stage === 'read' && reads === 1) || (stage === 'last-check' && reads === 2)) current = false;
        return original(path, ...args);
      }, () => assert.rejects(operation(), {code: 'source-batch-cancelled'}));
    } else await assert.rejects(operation(), {code: 'source-batch-cancelled'});
  });
}

test('switching the open project during a read rejects the old batch even without a supplied cancellation guard', async t => {
  const f = await fixture(t), other = join(f.root, 'other');
  await mkdir(other); await writeFile(join(other, 'other.ts'), 'export const other = 1;');
  let switched = false;
  await intercept(t, 'open', async (original, path, ...args) => {
    const handle = await original(path, ...args);
    if (!switched && String(path).endsWith('/src/a.ts')) { switched = true; await f.service.open(other); }
    return handle;
  }, () => assert.rejects(f.service.getFiles(f.id, ['src/a.ts']), {code: 'source-batch-cancelled'}));
  assert.equal((await f.service.snapshot()).root, other);
});

for (const replacement of ['same-size-and-mtime', 'deleted', 'symlink']) {
  test(`the final exact read rejects a target ${replacement} during consumer analysis`, async t => {
    const f = await fixture(t), path = join(f.projectRoot, 'src/a.ts'), before = await stat(path);
    await writeFile(join(f.root, 'outside.ts'), 'export const a = 1;\n');
    let changed = false;
    const result = await intercept(t, 'open', async (original, opened, ...args) => {
      if (!changed && String(opened).endsWith('/src/b.ts')) {
        changed = true;
        if (replacement === 'same-size-and-mtime') { await writeFile(path, 'export const a = 2;\n'); await utimes(path, before.atime, before.mtime); }
        else { await rm(path); if (replacement === 'symlink') await symlink(join(f.root, 'outside.ts'), path); }
      }
      return original(opened, ...args);
    }, () => f.service.getFiles(f.id, ['src/a.ts', 'style.css']));
    assert.equal(changed, true);
    assert.deepEqual(result.files.map(file => file.path), ['style.css']);
    assert.equal(result.unavailable[0].code, replacement === 'same-size-and-mtime' ? 'source-changed' : replacement === 'deleted' ? 'file-not-found' : 'symlink-rejected');
  });
}

test('actual source growth after inventory remains bounded to an 8 MiB basis with explicit truncation', async t => {
  const paths = Array.from({length: 33}, (_, i) => `src/file${String(i).padStart(2, '0')}.ts`);
  const f = await fixture(t, Object.fromEntries(paths.map(path => [path, '// small\n'])));
  let expanded = false;
  const result = await intercept(t, 'open', async (original, ...args) => {
    if (!expanded) {
      expanded = true;
      for (const path of paths) await writeFile(join(f.projectRoot, path), '//'+ 'x'.repeat(256 * 1024 - 2));
    }
    return original(...args);
  }, () => f.service.getFiles(f.id, paths));
  assert.equal(result.files.length, 32);
  assert.equal(result.unavailable.length, 1);
  assert.equal(result.unavailable[0].code, 'source-batch-too-large');
  assert.equal(result.truncated, true);
  assert.ok(result.files.every(file => file.analysis.consumersTruncated === true));
});

test('a later individual read and guarded save still revalidate source rather than reuse refresh data', async t => {
  const f = await fixture(t), path = 'src/a.ts', batch = await f.service.getFiles(f.id, [path]), old = batch.files[0];
  const edited = 'export const a = 9;\n'; await writeFile(join(f.projectRoot, path), edited);
  assert.equal((await f.service.getFile(f.id, path)).source, edited);
  await assert.rejects(f.service.save({projectId:f.id, path, source:old.source+'// proposal\n', baseRevision:old.revision}), {code:'source-conflict'});
  assert.equal(await readFile(join(f.projectRoot, path), 'utf8'), edited);
});

for (const replacement of ['changed', 'deleted', 'symlink']) {
  test(`a requested consumer ${replacement} during the scan cannot leave evidence on another returned target`, async t => {
    const f = await fixture(t), consumer = join(f.projectRoot, 'src/b.ts');
    await writeFile(join(f.root, 'outside.ts'), "import './a';\n");
    let changed = false;
    const result = await intercept(t, 'open', async (original, opened, ...args) => {
      if (!changed && String(opened).endsWith('/src/c.ts')) {
        changed = true;
        if (replacement === 'changed') await writeFile(consumer, 'export const independent = 1;\n');
        else { await rm(consumer); if (replacement === 'symlink') await symlink(join(f.root, 'outside.ts'), consumer); }
      }
      return original(opened, ...args);
    }, () => f.service.getFiles(f.id, ['src/a.ts', 'src/b.ts']));
    assert.equal(changed, true);
    assert.deepEqual(result.files.map(file => file.path), ['src/a.ts']);
    assert.equal(result.unavailable[0].path, 'src/b.ts');
    assert.equal(result.files[0].analysis.consumers.some(item => item.path === 'src/b.ts'), false);
    assert.deepEqual(result.files[0].analysis.consumers.map(item => item.path), ['src/c.ts', 'src/d.ts']);
  });
}
