import { cp, readFile, writeFile, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, desktop, pin, root, run, assertAppStopped } from './common.mjs';
import { extensionEntries, isRefreshUnchanged, stableProvenance, validateHost } from './extension-workflow.mjs';

export async function refreshExtension(options) {
  const { app, desktop, pin, root, run, assertAppStopped, bundle } = options;
  assertAppStopped();
  await validateHost(app, pin);
  await bundle();
  const extension = path.join(desktop, 'extension');
  const destination = path.join(app, 'Contents/Resources/app/extensions/foundation-workspace');
  const provenancePath = path.join(app, 'Contents/Resources/foundation-build.json');
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const provenance = stableProvenance(version, pin);
  assertAppStopped();
  if (await isRefreshUnchanged(extension, destination, provenancePath, provenance)) {
    // Preserve the existing resource seal, code identity and build timestamp.
    // Verification is read-only; an invalid signature must not be reported unchanged.
    await run('codesign', ['--verify', '--deep', '--strict', app]);
    console.log('Foundation extension is unchanged. Existing app signature and build timestamp preserved.');
    return { changed: false };
  }
  const pending = path.join(desktop, '.build', 'foundation-extension-pending');
  await rm(pending, { recursive: true, force: true });
  for (const entry of extensionEntries) {
    await cp(path.join(extension, entry), path.join(pending, entry), { recursive: true });
  }
  assertAppStopped();
  await rm(destination, { recursive: true, force: true });
  await rename(pending, destination);
  await writeFile(provenancePath, JSON.stringify({ ...provenance, builtAt: new Date().toISOString() }, null, 2));
  await run('codesign', ['--force', '--deep', '--sign', '-', app]);
  await run('codesign', ['--verify', '--deep', '--strict', app]);
  console.log('Foundation extension installed. Launch Foundation to use this build.');
  return { changed: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await refreshExtension({ app, desktop, pin, root, run, assertAppStopped,
    bundle: () => run('node', [path.join(desktop, 'scripts/bundle-extension.mjs')]),
  });
}
