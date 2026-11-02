import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { launchDevelopment } from '../scripts/develop.mjs';
import { refreshExtension } from '../scripts/install-extension.mjs';
import { stableProvenance } from '../scripts/extension-workflow.mjs';

const markers = '[Foundation] Default account discovery deferred until provider activation\n[Foundation] Speech account discovery deferred until provider activation\n_foundation.captureActiveCanvas';
async function fixture(t) {
  const root = await mkdtemp('/private/tmp/foundation-workflow-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'desktop');
  const app = path.join(desktop, '.build/Foundation.app');
  const extension = path.join(desktop, 'extension');
  const destination = path.join(app, 'Contents/Resources/app/extensions/foundation-workspace');
  const provenancePath = path.join(app, 'Contents/Resources/foundation-build.json');
  const pin = { commit: 'a'.repeat(40), tag: '1.143.1', architecture: 'arm64' };
  async function write(file, data) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof data === 'string' ? data : JSON.stringify(data));
  }
  const version = '0.6.0';
  await write(path.join(root, 'package.json'), { version });
  await mkdir(path.join(root, 'projects/orbit'), { recursive: true });
  await write(path.join(app, 'Contents/Resources/app/product.json'), { nameLong: 'Foundation', darwinBundleIdentifier: 'design.foundation.ide', commit: pin.commit });
  await write(path.join(app, 'Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js'), markers);
  await write(path.join(app, 'Contents/Resources/app/out/mainImpl.js'), 'foundation-canvas-capture-unavailable');
  await write(path.join(app, 'Contents/Resources/app/extensions/npm/dist/npmMain.js'), 'foundation.npm.async-yarn-workspace-root.v1');
  // The fixture is data only. No synthetic executable is ever launched.
  await mkdir(path.join(app, 'Contents/MacOS'), { recursive: true });
  await writeFile(path.join(app, 'Contents/MacOS/Foundation'), 'fixture', { mode: 0o755 });
  await write(path.join(extension, 'package.json'), { publisher: 'foundation', name: 'foundation-workspace', main: './dist/extension.cjs', version });
  await write(path.join(extension, 'LICENSE.txt'), 'Foundation fixture source terms v1\n');
  await write(path.join(extension, 'dist/extension.cjs'), 'bundle-v1');
  await write(path.join(extension, 'media/webview.js'), 'renderer-v1');
  await write(path.join(extension, 'themes/dark.json'), '{}');
  await cp(extension, destination, { recursive: true });
  await write(provenancePath, { ...stableProvenance(version, pin), builtAt: '2026-10-28T00:00:00.000Z' });
  const commands = [];
  let bundles = 0;
  const options = { root, desktop, app, pin, assertAppStopped() {}, bundle: async () => { bundles++; }, run: async (command, args) => { commands.push({ command, args }); } };
  return { ...options, options, write, extension, destination, provenancePath, commands, get bundles() { return bundles; } };
}

test('identical refresh preserves installed bytes and timestamps and only verifies the signature', async t => {
  const f = await fixture(t);
  const before = await readFile(f.provenancePath, 'utf8');
  const beforeStat = await stat(f.provenancePath);
  const beforeBundleStat = await stat(path.join(f.destination, 'dist/extension.cjs'));
  assert.deepEqual(await refreshExtension(f.options), { changed: false });
  assert.equal(await readFile(f.provenancePath, 'utf8'), before);
  assert.equal((await stat(f.provenancePath)).mtimeMs, beforeStat.mtimeMs);
  assert.equal((await stat(path.join(f.destination, 'dist/extension.cjs'))).mtimeMs, beforeBundleStat.mtimeMs);
  assert.deepEqual(f.commands, [{ command: 'codesign', args: ['--verify', '--deep', '--strict', f.app] }]);
});

test('changed extension bytes are installed and then signed and verified', async t => {
  const f = await fixture(t);
  await f.write(path.join(f.extension, 'dist/extension.cjs'), 'bundle-v2');
  assert.deepEqual(await refreshExtension(f.options), { changed: true });
  assert.equal(await readFile(path.join(f.destination, 'dist/extension.cjs'), 'utf8'), 'bundle-v2');
  assert.notEqual(JSON.parse(await readFile(f.provenancePath, 'utf8')).builtAt, '2026-10-28T00:00:00.000Z');
  assert.deepEqual(f.commands.map(call => call.args.slice(0, 3)), [['--force', '--deep', '--sign'], ['--verify', '--deep', '--strict']]);
});

test('a license-only change refreshes the exact terms without changing executable bytes', async t => {
  const f = await fixture(t);
  const beforeBundle = await readFile(path.join(f.destination, 'dist/extension.cjs'));
  const terms = 'Foundation fixture source terms v2\r\nThird-party rights remain separate.\r\n';
  await f.write(path.join(f.extension, 'LICENSE.txt'), terms);
  assert.deepEqual(await refreshExtension(f.options), { changed: true });
  assert.equal(await readFile(path.join(f.destination, 'LICENSE.txt'), 'utf8'), terms);
  assert.deepEqual(await readFile(path.join(f.destination, 'dist/extension.cjs')), beforeBundle);
  assert.notEqual(JSON.parse(await readFile(f.provenancePath, 'utf8')).builtAt, '2026-10-28T00:00:00.000Z');
  assert.deepEqual(f.commands.map(call => call.args.slice(0, 3)), [['--force', '--deep', '--sign'], ['--verify', '--deep', '--strict']]);
});

test('a missing source license refuses refresh before replacing the installed extension or provenance', async t => {
  const f = await fixture(t);
  const beforeProvenance = await readFile(f.provenancePath);
  const beforeLicense = await readFile(path.join(f.destination, 'LICENSE.txt'));
  const beforeBundle = await readFile(path.join(f.destination, 'dist/extension.cjs'));
  await rm(path.join(f.extension, 'LICENSE.txt'));
  await f.write(path.join(f.extension, 'dist/extension.cjs'), 'must-not-be-installed');
  await assert.rejects(refreshExtension(f.options), error => error.code === 'ENOENT' && error.message.includes('LICENSE.txt'));
  assert.deepEqual(await readFile(f.provenancePath), beforeProvenance);
  assert.deepEqual(await readFile(path.join(f.destination, 'LICENSE.txt')), beforeLicense);
  assert.deepEqual(await readFile(path.join(f.destination, 'dist/extension.cjs')), beforeBundle);
  assert.deepEqual(f.commands, []);
});

test('extra installed assets and changed stable provenance cannot be treated as a no-op', async t => {
  const f = await fixture(t);
  await f.write(path.join(f.destination, 'unexpected.js'), 'extra');
  assert.equal((await refreshExtension(f.options)).changed, true);
  await assert.rejects(readFile(path.join(f.destination, 'unexpected.js')), { code: 'ENOENT' });
  const provenance = JSON.parse(await readFile(f.provenancePath, 'utf8'));
  await f.write(f.provenancePath, { ...provenance, foundationVersion: 'old' });
  assert.equal((await refreshExtension(f.options)).changed, true);
  assert.equal(JSON.parse(await readFile(f.provenancePath, 'utf8')).foundationVersion, '0.6.0');
});

test('failed signature verification never claims a no-op success or mutates the bundle', async t => {
  const f = await fixture(t);
  const before = await readFile(f.provenancePath, 'utf8');
  f.options.run = async () => { throw new Error('signature invalid'); };
  await assert.rejects(refreshExtension(f.options), /signature invalid/);
  assert.equal(await readFile(f.provenancePath, 'utf8'), before);
});

test('refresh refuses unpatched or wrongly identified hosts before bundling', async t => {
  const f = await fixture(t);
  await f.write(path.join(f.app, 'Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js'), 'unpatched');
  await assert.rejects(refreshExtension(f.options), /on-demand account and speech/);
  await f.write(path.join(f.app, 'Contents/Resources/app/product.json'), { nameLong: 'Other', darwinBundleIdentifier: 'other', commit: f.pin.commit });
  await assert.rejects(refreshExtension(f.options), /pinned host/);
  assert.equal(f.bundles, 0);
  assert.deepEqual(f.commands, []);
});

test('development launch warns about separate ephemeral drafts and does not override normal storage', async t => {
  const f = await fixture(t);
  const before = await readFile(f.provenancePath, 'utf8');
  const warnings = [];
  f.options.warn = message => warnings.push(message);
  const normalBackup = path.join(f.root, 'normal-user-data/Backups/orbit/file/draft');
  await f.write(normalBackup, 'original unsaved draft');
  const run = f.options.run;
  f.options.run = async (...args) => {
    assert.equal(warnings.length, 2, 'draft limitations must be visible before opening the development window');
    await run(...args);
  };
  assert.deepEqual(await launchDevelopment(f.options), { extension: f.extension, project: path.join(f.root, 'projects/orbit') });
  assert.deepEqual(f.commands, [{ command: 'open', args: ['-a', f.app, '--args', `--extensionDevelopmentPath=${f.extension}`, path.join(f.root, 'projects/orbit')] }]);
  assert.match(warnings[0], /do not restore ordinary unsaved drafts/);
  assert.match(warnings[0], /memory-only backups/);
  assert.match(warnings[1], /quit.*normally.*desktop:launch/);
  assert.equal(await readFile(normalBackup, 'utf8'), 'original unsaved draft');
  assert.equal(await readFile(f.provenancePath, 'utf8'), before);
  assert.equal(f.bundles, 1);
});

test('development launch refuses a running app before bundling and rechecks before launch', async t => {
  const f = await fixture(t);
  f.options.assertAppStopped = () => { throw new Error('Quit Foundation'); };
  await assert.rejects(launchDevelopment(f.options), /Quit Foundation/);
  assert.equal(f.bundles, 0);
  let checks = 0;
  f.options.assertAppStopped = () => { if (++checks === 2) throw new Error('Quit Foundation'); };
  await assert.rejects(launchDevelopment(f.options), /Quit Foundation/);
  assert.equal(f.bundles, 1);
  assert.deepEqual(f.commands, []);
});

test('development launch rejects arbitrary flags, missing projects, and a foreign extension', async t => {
  const f = await fixture(t);
  await assert.rejects(launchDevelopment({ ...f.options, args: ['--disable-workspace-trust'] }), /Usage/);
  await assert.rejects(launchDevelopment({ ...f.options, args: ['one', 'two'] }), /Usage/);
  await assert.rejects(launchDevelopment({ ...f.options, args: [path.join(f.root, 'missing')] }), { code: 'ENOENT' });
  await f.write(path.join(f.extension, 'package.json'), { publisher: 'foreign', name: 'foundation-workspace', main: './dist/extension.cjs', version: '0.6.0' });
  await assert.rejects(launchDevelopment(f.options), /canonical Foundation Workspace/);
  assert.equal(f.bundles, 0);
  assert.deepEqual(f.commands, []);
});


test('refresh refuses synchronous npm workspace discovery before bundling', async t => {
  const f = await fixture(t);
  await f.write(path.join(f.app, 'Contents/Resources/app/extensions/npm/dist/npmMain.js'), 'unpatched npm bundle');
  await assert.rejects(refreshExtension(f.options), /asynchronous npm workspace detection/);
  assert.equal(f.bundles, 0);
  assert.deepEqual(f.commands, []);
});


test('refresh refuses a host missing either side of the scoped capture bridge without claiming new provenance', async t => {
  for (const target of ['workbench', 'main']) {
    const f = await fixture(t), before = await readFile(f.provenancePath, 'utf8');
    if (target === 'workbench') await f.write(path.join(f.app, 'Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js'), markers.replace('_foundation.captureActiveCanvas', ''));
    else await f.write(path.join(f.app, 'Contents/Resources/app/out/mainImpl.js'), 'older main process');
    await assert.rejects(refreshExtension(f.options), /scoped native canvas capture bridge/);
    assert.equal(f.bundles, 0);assert.deepEqual(f.commands, []);
    assert.equal(await readFile(f.provenancePath, 'utf8'), before);
  }
});
