import { execFileSync, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const root = path.dirname(desktop);
export const upstream = path.join(desktop, '.upstream', 'vscode');
export const pin = JSON.parse(await readFile(path.join(desktop, 'upstream.json'), 'utf8'));
export const nodeHome = path.join(desktop, '.toolchain', `node-v${pin.nodeVersion}-darwin-${pin.architecture}`);
export const buildEnv = { ...process.env, PATH: `${nodeHome}/bin:${process.env.PATH}`, VSCODE_ARCH: pin.architecture, FOUNDATION_WITHOUT_COPILOT: '1' };
export const app = path.join(desktop, '.build', 'Foundation.app');

export function assertAppStopped() {
  const executable = path.join(app, 'Contents/MacOS/Foundation');
  const processes = execFileSync('ps', ['-axo', 'comm='], { encoding: 'utf8' });
  if (processes.split('\n').some(command => command.trim() === executable)) {
    throw new Error('Quit Foundation before replacing or signing its application bundle. Then rerun this command and launch Foundation again.');
  }
}

export function run(command, args, options = {}) {
  console.log(`→ ${command} ${args.join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: buildEnv, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? signal}`)));
  });
}
