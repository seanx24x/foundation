import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { patchNpmWorkspaceDetection } from '../scripts/patch-upstream.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helper = await readFile(path.join(desktop, 'patches/npm-yarn-workspace-root.ts'), 'utf8');
const compiled = ts.transpileModule(helper, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const upstreamModule = path.join(desktop, '.upstream/vscode/extensions/npm/node_modules/find-yarn-workspace-root/index.js');
const hasUpstreamDependency = existsSync(upstreamModule);
const upstreamRequire = createRequire(upstreamModule);
const matcher = hasUpstreamDependency ? upstreamRequire('micromatch') : (files, patterns) => files.filter(file => patterns.includes(file));

function loadHelper(io, match = matcher, cwd = '/workspace') {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, process: { cwd: () => cwd },
    require(specifier) {
      if (specifier === 'fs') return {
        promises: io,
        existsSync() { throw new Error('Synchronous filesystem access is forbidden'); },
        readFileSync() { throw new Error('Synchronous filesystem access is forbidden'); },
      };
      if (specifier === 'path') return path;
      if (specifier === '../node_modules/micromatch') return match;
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
  });
  return exports.findWorkspaceRoot;
}

function fileSystem(manifests, failures = {}) {
  const reads = [];
  return {
    reads,
    async stat(file) { if (!Object.hasOwn(manifests, file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    async readFile(file) {
      reads.push(file);
      if (failures[file]) throw failures[file];
      return typeof manifests[file] === 'string' ? manifests[file] : JSON.stringify(manifests[file]);
    },
  };
}

test('a delayed ancestor read yields the event loop and performs no synchronous filesystem operations', async () => {
  let release;
  let began;
  const started = new Promise(resolve => { began = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const io = {
    async stat() {},
    async readFile() { began(); return blocked; },
  };
  let settled = false;
  const find = loadHelper(io);
  const pending = find('/workspace').then(result => { settled = true; return result; });
  await started;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'Unrelated extension-host callbacks run while a protected read waits');
  release('{"workspaces":[]}');
  assert.equal(await pending, '/workspace');
  assert.equal(find.foundationPatch, 'foundation.npm.async-yarn-workspace-root.v1');
});

test('missing ancestors are skipped but the nearest workspace mismatch stops the search', async () => {
  const io = fileSystem({
    '/workspace/package.json': { workspaces: ['packages/app'] },
    '/workspace/packages/app/package.json': {},
  });
  assert.equal(await loadHelper(io)('/workspace/packages/app'), '/workspace');
  const mismatch = fileSystem({
    '/workspace/package.json': { workspaces: ['packages/app'] },
    '/workspace/packages/package.json': { workspaces: ['other'] },
  });
  assert.equal(await loadHelper(mismatch)('/workspace/packages/app'), null);
  assert.deepEqual(mismatch.reads, ['/workspace/packages/package.json']);
});

test('malformed and unreadable manifests abort instead of accepting a higher workspace', async () => {
  for (const failure of ['invalid json', new Error('read denied')]) {
    const io = fileSystem({
      '/workspace/package.json': { workspaces: ['packages/app'] },
      '/workspace/packages/package.json': typeof failure === 'string' ? failure : {},
    }, typeof failure === 'string' ? {} : { '/workspace/packages/package.json': failure });
    await assert.rejects(loadHelper(io)('/workspace/packages/app'));
    assert.deepEqual(io.reads, ['/workspace/packages/package.json']);
  }
});

test('workspace objects, empty workspaces, normalized paths and default cwd retain their semantics', async () => {
  const io = fileSystem({ '/workspace/package.json': { workspaces: { packages: ['packages/app'] } } });
  assert.equal(await loadHelper(io)('/workspace/packages/other/../app'), '/workspace');
  const empty = fileSystem({ '/workspace/package.json': { workspaces: [] } });
  const find = loadHelper(empty);
  assert.equal(await find(''), '/workspace');
  assert.equal(await find('/workspace/child'), null);
  assert.equal(await loadHelper(fileSystem({}))('/workspace/child'), null);
});

test('pinned matcher and ancestor results match the original Yarn probe', { skip: !hasUpstreamDependency && 'Run desktop:bootstrap to install the pinned npm dependency' }, async () => {
  const original = await readFile(upstreamModule, 'utf8');
  const cases = [
    ['packages/a', ['packages/[[:alpha:]]']],
    ['packages/excluded', ['packages/*', '!packages/excluded']],
    ['packages/excluded', ['!packages/excluded', 'packages/*']],
    ['packages/app', ['packages/{app,other}']],
    ['packages/app', { packages: ['packages/*'] }],
    ['packages/app', []],
    ['', []],
  ];
  for (const [relative, workspaces] of cases) {
    const manifests = { '/workspace/package.json': { workspaces } };
    const io = fileSystem(manifests);
    const context = { module: { exports: {} }, process: { cwd: () => '/workspace' }, require(specifier) {
      if (specifier === 'fs') return { existsSync: file => Object.hasOwn(manifests, file), readFileSync: file => JSON.stringify(manifests[file]) };
      if (specifier === 'path') return path;
      if (specifier === 'micromatch') return matcher;
      throw new Error(specifier);
    } };
    vm.runInNewContext(original, context);
    const start = path.join('/workspace', relative);
    assert.equal(await loadHelper(io)(start), context.module.exports(start), JSON.stringify({ relative, workspaces }));
  }
});

test('the maintained caller awaits Yarn detection, preserves caught errors and rejects upstream drift', async () => {
  const fixture = `import findWorkspaceRoot = require('../node_modules/find-yarn-workspace-root');
export async function isYarnPreferred(pkgPath: string) {
  try {
    if (typeof findWorkspaceRoot(pkgPath) === 'string') { return { isPreferred: true, hasLockfile: false }; }
  } catch (err) { }
  return { isPreferred: false, hasLockfile: false };
}`;
  const patched = patchNpmWorkspaceDetection(fixture);
  const output = ts.transpileModule(patched, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const [found, expected] of [['/workspace', true], [null, false], [new Error('read denied'), false]]) {
    const exports = {};
    vm.runInNewContext(output, { exports, require: () => ({ findWorkspaceRoot: async () => { if (found instanceof Error) throw found; return found; } }) });
    assert.equal((await exports.isYarnPreferred('/workspace/app')).isPreferred, expected);
  }
  assert.throws(() => patchNpmWorkspaceDetection(fixture.replace('findWorkspaceRoot(pkgPath)', 'findWorkspaceRoot(path)')), /re-audit asynchronous package probing/);
  assert.throws(() => patchNpmWorkspaceDetection(`${fixture}\n${fixture}`), /re-audit asynchronous package probing/);
});
