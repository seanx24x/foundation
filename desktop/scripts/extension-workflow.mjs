import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export const extensionEntries = ['package.json', 'LICENSE.txt', 'dist', 'media', 'themes'];
export const upstreamPatches = ['optional-copilot-integration', 'on-demand-default-account', 'on-demand-speech-account', 'async-npm-workspace-detection', 'scoped-native-canvas-capture'];
const startupMarkers = [
  '[Foundation] Default account discovery deferred until provider activation',
  '[Foundation] Speech account discovery deferred until provider activation',
];

export async function validateHost(app, pin) {
  const resources = path.join(app, 'Contents/Resources');
  const product = JSON.parse(await readFile(path.join(resources, 'app/product.json'), 'utf8'));
  if (product.nameLong !== 'Foundation' || product.darwinBundleIdentifier !== 'design.foundation.ide' || product.commit !== pin.commit) {
    throw new Error('This application does not match Foundation’s pinned host. Run desktop:build first.');
  }
  await access(path.join(app, 'Contents/MacOS/Foundation'), constants.X_OK);
  const workbench = await readFile(path.join(resources, 'app/out/vs/workbench/workbench.desktop.main.js'), 'utf8');
  if (!startupMarkers.every(marker => workbench.includes(marker))) {
    throw new Error('This application does not contain Foundation’s on-demand account and speech initialization. Run npm run desktop:build first.');
  }
  const main = await readFile(path.join(resources, 'app/out/mainImpl.js'), 'utf8');
  if (!workbench.includes('_foundation.captureActiveCanvas') || !main.includes('foundation-canvas-capture-unavailable')) {
    throw new Error('This application does not contain Foundation’s scoped native canvas capture bridge. Run npm run desktop:build first.');
  }
  const npm = await readFile(path.join(resources, 'app/extensions/npm/dist/npmMain.js'), 'utf8');
  if (!npm.includes('foundation.npm.async-yarn-workspace-root.v1')) {
    throw new Error('This application does not contain Foundation’s asynchronous npm workspace detection. Run npm run desktop:build first.');
  }
}

export async function validateDevelopmentExtension(desktop, root) {
  const extension = path.join(desktop, 'extension');
  // Resolve the canonical folder, rather than accepting an arbitrary executable extension path.
  if (await realpath(extension) !== extension) throw new Error('Foundation’s development extension must be its canonical desktop/extension folder, not a symbolic link.');
  const manifest = JSON.parse(await readFile(path.join(extension, 'package.json'), 'utf8'));
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  if (manifest.name !== 'foundation-workspace' || manifest.publisher !== 'foundation' || manifest.main !== './dist/extension.cjs' || manifest.version !== version) {
    throw new Error('The development extension must be the current canonical Foundation Workspace extension.');
  }
  return extension;
}

export function stableProvenance(version, pin) {
  return {
    foundationVersion: version, codeOSS: pin.tag, commit: pin.commit, architecture: pin.architecture,
    signed: 'ad-hoc', aiHost: 'foundation-workspace', upstreamPatches, bundledCopilot: false,
  };
}

async function treeManifest(directory, entries) {
  const manifest = {};
  async function visit(relative) {
    const filename = path.join(directory, relative);
    const stat = await lstat(filename);
    if (stat.isDirectory()) {
      manifest[relative] = 'directory';
      for (const child of (await readdir(filename)).sort()) await visit(path.join(relative, child));
    } else if (stat.isFile()) {
      manifest[relative] = createHash('sha256').update(await readFile(filename)).digest('hex');
    } else {
      throw new Error(`Unexpected link or special file in Foundation extension: ${relative}`);
    }
  }
  for (const entry of [...(entries ?? await readdir(directory))].sort()) await visit(entry);
  return manifest;
}

export async function isRefreshUnchanged(extension, destination, provenancePath, expected) {
  try {
    const previous = JSON.parse(await readFile(provenancePath, 'utf8'));
    const { builtAt, ...stable } = previous;
    if (typeof builtAt !== 'string' || !Number.isFinite(Date.parse(builtAt))) return false;
    if (Object.keys(stable).length !== Object.keys(expected).length || !Object.entries(expected).every(([key, value]) => JSON.stringify(stable[key]) === JSON.stringify(value))) return false;
    const source = await treeManifest(extension, extensionEntries);
    const installed = await treeManifest(destination);
    return JSON.stringify(source) === JSON.stringify(installed);
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return false;
    throw error;
  }
}
