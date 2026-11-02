import { mkdir, readFile, access, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { desktop, upstream, pin, nodeHome, run } from './common.mjs';

if (process.platform !== 'darwin' || process.arch !== pin.architecture) throw new Error('This milestone targets macOS Apple Silicon.');
await run('xcode-select', ['-p']);
await mkdir(path.join(desktop, '.toolchain'), { recursive: true });
try { await access(path.join(nodeHome, 'bin/node')); } catch {
  const name = `node-v${pin.nodeVersion}-darwin-${pin.architecture}.tar.gz`;
  const archive = path.join(desktop, '.toolchain', name);
  await run('curl', ['--fail', '--location', '--retry', '3', `https://nodejs.org/dist/v${pin.nodeVersion}/${name}`, '-o', archive]);
  const sha = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (sha !== pin.nodeSha256) throw new Error(`Node checksum mismatch: ${sha}`);
  await run('tar', ['-xzf', archive, '-C', path.dirname(nodeHome)]);
}
await mkdir(path.dirname(upstream), { recursive: true });
try { await access(path.join(upstream, '.git')); } catch {
  await run('git', ['clone', '--depth', '1', '--branch', pin.tag, pin.repository, upstream]);
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim();
if (commit !== pin.commit) throw new Error(`Unexpected Code OSS revision: ${commit}`);
// Extension acquisition must use the release's GitHub assets and their pinned checksums.
// The runtime receives Open VSX only after these built-in extensions are cached.
const original = execFileSync('git', ['show', 'HEAD:product.json'], { cwd: upstream });
await writeFile(path.join(upstream, 'product.json'), original);
await run('npm', ['ci'], { cwd: upstream });
await run('npm', ['run', 'download-builtin-extensions'], { cwd: upstream });
console.log(`Code OSS ${pin.tag} (${commit}) is ready.`);
