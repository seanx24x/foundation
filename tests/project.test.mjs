import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtemp, mkdir, readFile, realpath, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectService, ProjectError, projectRevision } from '../server/project/workspace.mjs';

const BUTTON = `import { saveProfile } from '../api/profile';
export interface SaveButtonProps { label: string }
export function SaveButton({ label }: SaveButtonProps) {
  return <button onClick={() => saveProfile({ name: label })}>{label}</button>;
}
`;
const PROFILE = `export async function saveProfile(profile: { name: string }) {
  const response = await fetch('/api/profile', { method: 'POST', body: JSON.stringify(profile) });
  return response.json();
}
`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'foundation-project-test-'));
  const projectRoot = join(root, 'projects/orbit');
  await mkdir(join(projectRoot, 'src/components'), { recursive: true });
  await mkdir(join(projectRoot, 'src/api'), { recursive: true });
  await writeFile(join(projectRoot, 'package.json'), JSON.stringify({ name: 'orbit', scripts: { dev: 'vite', build: 'tsc && vite build', lint: 'eslint .', danger: 'rm -rf /' }, dependencies: { react: '19' }, devDependencies: { vite: '8' } }));
  await writeFile(join(projectRoot, 'src/components/SaveButton.tsx'), BUTTON);
  await writeFile(join(projectRoot, 'src/api/profile.ts'), PROFILE);
  await writeFile(join(projectRoot, 'src/App.tsx'), `import { SaveButton } from './components/SaveButton';\nexport function App() { return <SaveButton label="Save" />; }\n`);
  await writeFile(join(projectRoot, 'README.md'), '# Orbit\nA supported sample project.\n');
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = createProjectService({ root });
  const snapshot = await service.snapshot();
  return { root, projectRoot, service, snapshot, id: snapshot.id };
}

function rejectsCode(promise, code, status) {
  return assert.rejects(promise, (error) => error instanceof ProjectError && error.code === code && (status === undefined || error.status === status));
}

test('project inventory is real, sorted, excludes generated/private content, and reads actual package targets without executing scripts', async (t) => {
  const { service, projectRoot } = await fixture(t);
  for (const directory of ['node_modules', '.git', 'dist', 'coverage', 'ignored', 'src/generated']) await mkdir(join(projectRoot, directory), { recursive: true });
  for (const path of ['node_modules/leak.ts', '.git/config.json', 'dist/build.js', 'coverage/report.json', 'ignored/private.ts', 'src/generated/output.ts', '.env', '.env.local', 'credentials.json', 'secrets.json', 'token.json']) await writeFile(join(projectRoot, path), 'sensitive data');
  await mkdir(join(projectRoot, 'src/styles'), { recursive: true });
  await writeFile(join(projectRoot, 'src/styles/tokens.css'), ':root { --accent: blue; }');
  await writeFile(join(projectRoot, '.gitignore'), 'ignored/\n**/generated/\n!ignored/private.ts\n');
  const state = await service.snapshot();
  assert.deepEqual(state.files.map((file) => file.path), ['package.json', 'README.md', 'src/api/profile.ts', 'src/App.tsx', 'src/components/SaveButton.tsx', 'src/styles/tokens.css'].sort((a, b) => a.localeCompare(b)));
  assert.equal(state.name, 'orbit');
  assert.equal(state.root, await realpath(projectRoot));
  assert.equal(state.truncated, false);
  assert.equal(state.preview.url, '/project-preview.html');
  assert.deepEqual(state.targets, [
    { name: 'dev', command: 'npm run dev', framework: 'Vite' },
    { name: 'build', command: 'npm run build', framework: 'Vite' },
    { name: 'lint', command: 'npm run lint', framework: 'Vite' },
  ]);
  assert.doesNotMatch(JSON.stringify(state), /rm -rf/);
  await rejectsCode(service.getFile(state.id, 'ignored/private.ts'), 'excluded-path', 403);
});

test('source relationships and fetch contracts are derived from saved TypeScript with exact line links', async (t) => {
  const { service, id } = await fixture(t);
  const file = await service.getFile(id, 'src/components/SaveButton.tsx');
  assert.equal(file.source, BUTTON);
  assert.equal(file.revision, projectRevision(BUTTON));
  assert.equal(file.language, 'typescript');
  assert.equal(file.analysis.unsupported, false);
  assert.deepEqual(file.analysis.symbols.map(({ name, kind, line, exported }) => ({ name, kind, line, exported })), [
    { name: 'SaveButtonProps', kind: 'interface', line: 2, exported: true },
    { name: 'SaveButton', kind: 'function', line: 3, exported: true },
  ]);
  assert.deepEqual(file.analysis.imports, [{ specifier: '../api/profile', names: ['saveProfile'], line: 1, resolvedPath: 'src/api/profile.ts' }]);
  assert.deepEqual(file.analysis.consumers, [{ path: 'src/App.tsx', line: 1, specifier: './components/SaveButton' }]);
  const api = await service.getFile(id, 'src/api/profile.ts');
  assert.deepEqual(api.analysis.requests, [{ method: 'POST', url: '/api/profile', line: 2 }]);
  assert.equal(api.analysis.consumers[0].path, 'src/components/SaveButton.tsx');
});

test('unknown imports, dynamic requests, non-source formats and malformed source remain explicit', async (t) => {
  const { service, id, projectRoot } = await fixture(t);
  await writeFile(join(projectRoot, 'src/dynamic.ts'), `import { api } from '@app/api';\nexport const call = (url: string, method: string) => fetch(url, { method });\nfetch('/static');\n`);
  const file = await service.getFile(id, 'src/dynamic.ts');
  assert.equal(file.analysis.imports[0].resolvedPath, null);
  assert.deepEqual(file.analysis.requests, [
    { method: 'Unknown', url: 'Dynamic URL', line: 2 },
    { method: 'GET', url: '/static', line: 3 },
  ]);
  const markdown = await service.getFile(id, 'README.md');
  assert.equal(markdown.language, 'markdown');
  assert.equal(markdown.analysis.unsupported, true);
  assert.deepEqual(markdown.analysis.symbols, []);
  await writeFile(join(projectRoot, 'src/invalid.ts'), 'export function broken( {');
  assert.equal((await service.getFile(id, 'src/invalid.ts')).analysis.unsupported, true);
});

test('literal case-insensitive search links to source lines and does not treat a query as a regular expression', async (t) => {
  const { service, id, projectRoot } = await fixture(t);
  const result = await service.search(id, 'SAVEprofile');
  assert.deepEqual(result.matches.map((match) => [match.path, match.line]), [
    ['src/api/profile.ts', 1], ['src/components/SaveButton.tsx', 1], ['src/components/SaveButton.tsx', 4],
  ]);
  assert.equal(result.matches[0].column, 23);
  await writeFile(join(projectRoot, 'literal.txt'), 'hello .* literal\nHello more\n');
  const literal = await service.search(id, '.*');
  assert.deepEqual(literal.matches, [{ path: 'literal.txt', line: 1, column: 7, text: 'hello .* literal' }]);
  assert.deepEqual(await service.search(id, ''), { matches: [], truncated: false });
  await rejectsCode(service.search(id, 'x'.repeat(201)), 'invalid-query', 400);
});

test('search and inventory report truncation rather than imply exhaustive coverage', async (t) => {
  const { service, id, projectRoot } = await fixture(t);
  await writeFile(join(projectRoot, 'many.txt'), Array.from({ length: 250 }, (_, i) => `needle ${i}`).join('\n'));
  const results = await service.search(id, 'needle');
  assert.equal(results.matches.length, 200);
  assert.equal(results.truncated, true);
  await writeFile(join(projectRoot, 'large.ts'), 'x'.repeat(256 * 1024 + 1));
  const state = await service.snapshot();
  assert.equal(state.truncated, true);
  assert.equal(state.files.some((file) => file.path === 'large.ts'), false);
  await rejectsCode(service.getFile(id, 'large.ts'), 'file-too-large', 413);
});

test('saving a reviewed revision persists text and a per-file checkpoint; revert only touches the selected file', async (t) => {
  const { service, id, projectRoot } = await fixture(t);
  const first = await service.getFile(id, 'src/components/SaveButton.tsx');
  const second = await service.getFile(id, 'README.md');
  const changed = `${first.source}\n// Refined component.\n`;
  const saved = await service.save({ projectId: id, path: first.path, source: changed, baseRevision: first.revision });
  await service.save({ projectId: id, path: second.path, source: `${second.source}Independent edit.\n`, baseRevision: second.revision });
  assert.equal(await readFile(join(projectRoot, first.path), 'utf8'), changed);
  let state = await service.changes(id);
  assert.equal(state.changes.length, 2);
  assert.deepEqual(state.changes.find((change) => change.path === first.path), { path: first.path, before: BUTTON, after: changed, baseRevision: first.revision, revision: saved.revision, conflict: false });
  const reverted = await service.revert({ projectId: id, path: first.path, revision: saved.revision });
  assert.equal(reverted.source, BUTTON);
  assert.equal(await readFile(join(projectRoot, 'README.md'), 'utf8'), `${second.source}Independent edit.\n`);
  state = await service.changes(id);
  assert.deepEqual(state.changes.map((change) => change.path), ['README.md']);
});

test('stale saves and unsafe reverts preserve external edits, then explicit rebase retains the external baseline', async (t) => {
  const { service, id, projectRoot } = await fixture(t);
  const original = await service.getFile(id, 'README.md');
  const saved = await service.save({ projectId: id, path: original.path, source: `${original.source}Foundation edit.\n`, baseRevision: original.revision });
  const external = `${saved.source}User changed this outside Foundation.\n`;
  await writeFile(join(projectRoot, original.path), external);
  await rejectsCode(service.save({ projectId: id, path: original.path, source: 'wrong', baseRevision: saved.revision }), 'source-conflict', 409);
  await rejectsCode(service.revert({ projectId: id, path: original.path, revision: saved.revision }), 'source-conflict', 409);
  assert.equal((await service.changes(id)).changes[0].conflict, true);
  assert.equal(await readFile(join(projectRoot, original.path), 'utf8'), external);
  const refreshed = await service.getFile(id, original.path);
  const rebased = await service.save({ projectId: id, path: original.path, source: `${external}New reviewed Foundation edit.\n`, baseRevision: refreshed.revision });
  assert.equal((await service.changes(id)).changes[0].before, external);
  await service.revert({ projectId: id, path: original.path, revision: rebased.revision });
  assert.equal(await readFile(join(projectRoot, original.path), 'utf8'), external);
});

test('two concurrent writes with the same base revision cannot overwrite one another', async (t) => {
  const { service, id, projectRoot } = await fixture(t);
  const file = await service.getFile(id, 'README.md');
  const results = await Promise.allSettled([
    service.save({ projectId: id, path: file.path, source: `${file.source}First\n`, baseRevision: file.revision }),
    service.save({ projectId: id, path: file.path, source: `${file.source}Second\n`, baseRevision: file.revision }),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'source-conflict');
  assert.equal(await readFile(join(projectRoot, file.path), 'utf8'), `${file.source}First\n`);
});

test('a context update queued ahead of Apply invalidates the later target write', async t => {
  const { service, id, projectRoot } = await fixture(t);
  const target = await service.getFile(id, 'src/components/SaveButton.tsx');
  const dependency = await service.getFile(id, 'src/api/profile.ts');
  const changed = `${dependency.source}// New dependency.\n`;
  const results = await Promise.allSettled([
    service.save({ projectId: id, path: dependency.path, source: changed, baseRevision: dependency.revision }),
    service.save({ projectId: id, path: target.path, source: `${target.source}// Proposed.\n`, baseRevision: target.revision,
      expectedContext: [{ path: dependency.path, revision: dependency.revision }] }),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'context-conflict');
  assert.equal(await readFile(join(projectRoot, target.path), 'utf8'), target.source);
  assert.equal(await readFile(join(projectRoot, dependency.path), 'utf8'), changed);
});

for (const change of ['source edit', 'symlink replacement']) {
  test(`context ${change} after temporary-file creation blocks final replacement`, async t => {
    const { service, id, root, projectRoot } = await fixture(t);
    const target = await service.getFile(id, 'src/components/SaveButton.tsx');
    const dependency = await service.getFile(id, 'src/api/profile.ts');
    const originalWrite = fs.writeFile;
    const outside = join(root, 'outside.ts');
    await originalWrite(outside, dependency.source);
    let intercepted = false;
    const interceptedWrite = t.mock.method(fs, 'writeFile', async (path, ...args) => {
      const result = await originalWrite(path, ...args);
      if (!intercepted && (String(path).includes('/.foundation-') || typeof path?.fd === 'number')) {
        intercepted = true;
        if (change === 'source edit') await originalWrite(join(projectRoot, dependency.path), `${dependency.source}// Arrived before replacement.\n`);
        else {
          await rm(join(projectRoot, dependency.path));
          await symlink(outside, join(projectRoot, dependency.path));
        }
      }
      return result;
    });
    syncBuiltinESMExports();
    try {
      await rejectsCode(service.save({ projectId: id, path: target.path, source: `${target.source}// Proposed.\n`, baseRevision: target.revision,
        expectedContext: [{ path: target.path, revision: target.revision }, { path: dependency.path, revision: dependency.revision }] }),
      change === 'source edit' ? 'context-conflict' : 'symlink-rejected');
    } finally {
      interceptedWrite.mock.restore();
      syncBuiltinESMExports();
    }
    assert.equal(intercepted, true);
    assert.equal(await readFile(join(projectRoot, target.path), 'utf8'), target.source);
    assert.equal(await readFile(outside, 'utf8'), dependency.source);
    assert.equal((await readdir(join(projectRoot, 'src/components'))).some(name => name.startsWith('.foundation-')), false);
    assert.deepEqual((await service.changes(id)).changes, []);
  });
}

test('expected-context metadata rejects invalid paths, duplicate files and missing revisions', async t => {
  const { service, id, projectRoot } = await fixture(t);
  const target = await service.getFile(id, 'src/components/SaveButton.tsx');
  const save = expectedContext => service.save({ projectId: id, path: target.path, source: `${target.source}// Proposed.\n`, baseRevision: target.revision, expectedContext });
  await rejectsCode(save([{ path: '../outside.ts', revision: target.revision }]), 'invalid-path');
  await rejectsCode(save([{ path: target.path }]), 'invalid-context');
  await rejectsCode(save([{ path: target.path, revision: target.revision }, { path: target.path, revision: target.revision }]), 'invalid-context');
  assert.equal(await readFile(join(projectRoot, target.path), 'utf8'), target.source);
});

test('path traversal, symlinks, hidden secrets, unsupported encodings and binary source are rejected', async (t) => {
  const { service, id, projectRoot, root } = await fixture(t);
  await writeFile(join(root, 'outside.ts'), 'private outside source');
  await symlink(join(root, 'outside.ts'), join(projectRoot, 'linked.ts'));
  await symlink(root, join(projectRoot, 'linked-folder'));
  await writeFile(join(projectRoot, '.env'), 'SECRET=value');
  await writeFile(join(projectRoot, 'binary.ts'), Buffer.from([65, 0, 66]));
  await writeFile(join(projectRoot, 'invalid-utf8.ts'), Buffer.from([0xff, 0xfe]));
  for (const path of ['../outside.ts', '/outside.ts', 'src/../../outside.ts', 'src\\..\\outside.ts', 'src//file.ts']) await rejectsCode(service.getFile(id, path), 'invalid-path', 400);
  await rejectsCode(service.getFile(id, '.env'), 'excluded-path', 403);
  await rejectsCode(service.getFile(id, 'linked.ts'), 'symlink-rejected', 403);
  await rejectsCode(service.getFile(id, 'linked-folder/outside.ts'), 'symlink-rejected', 403);
  await rejectsCode(service.getFile(id, 'binary.ts'), 'binary-file', 415);
  await rejectsCode(service.getFile(id, 'invalid-utf8.ts'), 'unsupported-encoding', 415);
  const original = await service.getFile(id, 'README.md');
  await rejectsCode(service.save({ projectId: id, path: original.path, source: '\uD800', baseRevision: original.revision }), 'invalid-source', 400);
});

test('opening another folder switches project identity, rejects stale writes, and keeps independent checkpoints', async (t) => {
  const { service, id, root, projectRoot } = await fixture(t);
  const first = await service.getFile(id, 'README.md');
  const changed = await service.save({ projectId: id, path: first.path, source: `${first.source}Saved\n`, baseRevision: first.revision });
  const other = join(root, 'other');
  await mkdir(other);
  await writeFile(join(other, 'README.md'), '# Second\n');
  const state = await service.open(other);
  assert.notEqual(state.id, id);
  assert.equal(state.preview, null);
  await rejectsCode(service.getFile(id, first.path), 'project-conflict', 409);
  await rejectsCode(service.save({ projectId: id, path: first.path, source: 'stale', baseRevision: changed.revision }), 'project-conflict', 409);
  assert.deepEqual(await service.changes(state.id), { changes: [] });
  await rejectsCode(service.open(join(root, 'does-not-exist')), 'project-not-found', 404);
  assert.equal((await service.snapshot()).id, state.id);
  assert.equal((await service.open(projectRoot)).id, id);
  assert.equal((await service.changes(id)).changes.length, 1);
  assert.equal(await readFile(join(projectRoot, first.path), 'utf8'), changed.source);
});

test('a deleted or replaced changed file is a conflict, not permission to overwrite it', async (t) => {
  const { service, id, projectRoot, root } = await fixture(t);
  const file = await service.getFile(id, 'README.md');
  const saved = await service.save({ projectId: id, path: file.path, source: `${file.source}Saved\n`, baseRevision: file.revision });
  await rm(join(projectRoot, file.path));
  assert.equal((await service.changes(id)).changes[0].conflict, true);
  await rejectsCode(service.revert({ projectId: id, path: file.path, revision: saved.revision }), 'file-not-found', 404);
  await writeFile(join(root, 'outside.md'), 'Outside');
  await symlink(join(root, 'outside.md'), join(projectRoot, file.path));
  await rejectsCode(service.revert({ projectId: id, path: file.path, revision: saved.revision }), 'symlink-rejected', 403);
  assert.equal(await readFile(join(root, 'outside.md'), 'utf8'), 'Outside');
});

test('route dispatcher serves only its own explicit endpoints', async (t) => {
  const { service, id } = await fixture(t);
  const sent = [];
  const send = (status, value) => sent.push({ status, value });
  assert.equal(await service.handle({ request: { method: 'GET' }, url: new URL('http://localhost/api/workspace'), send }), false);
  assert.equal(await service.handle({ request: { method: 'GET' }, url: new URL(`http://localhost/api/project/file?projectId=${id}&path=README.md`), send }), true);
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].value.path, 'README.md');
  await rejectsCode(service.handle({ request: { method: 'DELETE' }, url: new URL('http://localhost/api/project'), send }), 'not-found', 404);
});

test('nested ignore rules handle anchored paths, globstars and character classes without exposing matches', async (t) => {
  const { service, id, projectRoot } = await fixture(t);
  await mkdir(join(projectRoot, 'nested/cache/deep'), { recursive: true });
  await mkdir(join(projectRoot, 'nested/child'), { recursive: true });
  await writeFile(join(projectRoot, 'nested/.gitignore'), '/local.ts\ncache/**/hidden?.ts\n[Bb]uild.ts\n!build.ts\n');
  for (const path of ['nested/local.ts', 'nested/child/local.ts', 'nested/cache/deep/hidden1.ts', 'nested/build.ts', 'nested/Build.ts', 'nested/visible.ts']) await writeFile(join(projectRoot, path), `export const secret = '${path}';`);
  const paths = (await service.snapshot()).files.map((file) => file.path);
  assert.equal(paths.includes('nested/child/local.ts'), true);
  assert.equal(paths.includes('nested/visible.ts'), true);
  for (const path of ['nested/local.ts', 'nested/cache/deep/hidden1.ts', 'nested/build.ts', 'nested/Build.ts']) {
    assert.equal(paths.includes(path), false);
    await rejectsCode(service.getFile(id, path), 'excluded-path', 403);
  }
});

test('oversized or unsupported ignore rules exclude their subtree and report partial inventory', async (t) => {
  const { service, id, projectRoot } = await fixture(t);
  await mkdir(join(projectRoot, 'private'));
  await writeFile(join(projectRoot, 'private/data.ts'), 'private data');
  for (const contents of ['x'.repeat(32 * 1024 + 1), 'unsupported\\escape.ts', 'broken[glob.ts']) {
    await writeFile(join(projectRoot, 'private/.gitignore'), contents);
    const state = await service.snapshot();
    assert.equal(state.truncated, true);
    assert.equal(state.files.some((file) => file.path === 'private/data.ts'), false);
    await rejectsCode(service.getFile(id, 'private/data.ts'), 'file-not-indexed', 403);
  }
});

test('repeated wildcard ignore patterns are bounded and do not block the source service', async (t) => {
  const { service, projectRoot } = await fixture(t);
  const name = `${'a'.repeat(180)}.ts`;
  await writeFile(join(projectRoot, name), 'export const value = 1;');
  await writeFile(join(projectRoot, '.gitignore'), `${'a*'.repeat(120)}b.ts\n`);
  const start = performance.now();
  const state = await service.snapshot();
  assert.equal(state.files.some((file) => file.path === name), true);
  assert.ok(performance.now() - start < 2000, 'A bounded wildcard check should finish without regex backtracking.');
});
