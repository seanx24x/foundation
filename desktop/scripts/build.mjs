import { access, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { desktop, upstream, pin, app, run, nodeHome, assertAppStopped } from './common.mjs';
import { brand } from './brand.mjs';
import { patchUpstream } from './patch-upstream.mjs';

assertAppStopped();
await access(path.join(nodeHome, 'bin/node'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim();
if (commit !== pin.commit) throw new Error('Code OSS revision differs from desktop/upstream.json.');
await run('node', [path.join(desktop, 'scripts/bundle-extension.mjs')]);
// Cache licensed release assets before assigning the runtime extension gallery.
const original = execFileSync('git', ['show', 'HEAD:product.json'], { cwd: upstream });
await writeFile(path.join(upstream, 'product.json'), original);
await run('npm', ['run', 'download-builtin-extensions'], { cwd: upstream });
await brand(upstream, path.join(desktop, 'product.json'));
await patchUpstream(upstream);
await run('swift', [path.join(desktop, 'scripts/icon.swift'), path.join(desktop, '.build')]);
await cp(path.join(desktop, '.build/Foundation.icns'), path.join(upstream, 'resources/darwin/code.icns'));
await run('npm', ['run', 'gulp', `vscode-darwin-${pin.architecture}`], { cwd: upstream });
const packaged = path.join(desktop, '.upstream', `VSCode-darwin-${pin.architecture}`, 'Foundation.app');
await mkdir(path.dirname(app), { recursive: true });
assertAppStopped();
await rm(app, { recursive: true, force: true });
await cp(packaged, app, { recursive: true, verbatimSymlinks: true });
await run('node', [path.join(desktop, 'scripts/install-extension.mjs')]);
console.log(`Built ${app}`);
