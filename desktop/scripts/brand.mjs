import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function createProduct(upstream, overlay) {
  const product = { ...upstream, ...overlay };
  for (const key of ['updateUrl', 'downloadUrl', 'aiConfig', 'ariaKey', 'crashReporter', 'configurationSync', 'tasConfig', 'voiceWsUrl', 'reportIssueUrl']) delete product[key];
  return product;
}

export async function brand(checkout, overlayPath) {
  const original = JSON.parse(execFileSync('git', ['show', 'HEAD:product.json'], { cwd: checkout, encoding: 'utf8' }));
  const overlay = JSON.parse(await readFile(overlayPath, 'utf8'));
  const product = createProduct(original, overlay);
  await writeFile(path.join(checkout, 'product.json'), `${JSON.stringify(product, null, '\t')}\n`);
  return product;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { upstream, desktop } = await import('./common.mjs');
  await brand(upstream, path.join(desktop, 'product.json'));
}
