import { createRequire } from 'node:module';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { desktop, upstream, root } from './common.mjs';

const require = createRequire(path.join(upstream, 'build/package.json'));
const { build } = require('esbuild');
const extension = path.join(desktop, 'extension');
await mkdir(path.join(extension, 'dist'), { recursive: true });
// The sandbox receives only this browser runtime; it never loads a project's
// bundler, native dependency, executable configuration, or Node environment.
await build({
  entryPoints: [path.join(extension, 'media/preview-runtime-entry.js')],
  outfile: path.join(extension, 'media/preview-runtime.js'),
  bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
  minify: true, legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [path.join(root, 'node_modules')], logLevel: 'info',
});
await build({
  entryPoints: [path.join(extension, 'src/extension.ts')],
  outfile: path.join(extension, 'dist/extension.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node24',
  external: ['vscode'], sourcemap: true, logLevel: 'info',
  nodePaths: [path.join(root, 'node_modules'), path.join(upstream, 'node_modules')],
});
// Reusable development-only instrumentation; project Vite remains external.
await build({
  entryPoints: [path.join(desktop, 'runtime/vite-plugin.mjs')],
  outfile: path.join(extension, 'dist/connected-vite-plugin.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  external: ['vite'], nodePaths: [path.join(root, 'node_modules')], logLevel: 'info',
});
// Retain attribution for the bundled TypeScript parser.
const tsLicense = require.resolve('typescript/LICENSE.txt');
await cp(tsLicense, path.join(extension, 'dist/TypeScript-LICENSE.txt'));
const projectRequire = createRequire(path.join(root, 'package.json'));
await cp(path.join(path.dirname(projectRequire.resolve('react/package.json')), 'LICENSE'), path.join(extension, 'dist/React-LICENSE.txt'));
await cp(path.join(path.dirname(projectRequire.resolve('react-dom/package.json')), 'LICENSE'), path.join(extension, 'dist/ReactDOM-LICENSE.txt'));
// PostCSS is bundled in the host with its parser dependencies. Preserve their
// complete distributed notices alongside the bundle, including ISC/BSD terms.
for (const [name,notice] of [['postcss','PostCSS'],['nanoid','NanoID'],['picocolors','Picocolors'],['source-map-js','SourceMapJS']]) {
  const directory = path.dirname(projectRequire.resolve(`${name}/package.json`));
  await cp(path.join(directory,'LICENSE'),path.join(extension,'dist',`${notice}-LICENSE.txt`));
}
const p = JSON.parse(await readFile(path.join(extension, 'package.json'), 'utf8'));
if (p.main !== './dist/extension.cjs') {
  p.main = './dist/extension.cjs';
  await writeFile(path.join(extension, 'package.json'), `${JSON.stringify(p, null, 2)}\n`);
}
