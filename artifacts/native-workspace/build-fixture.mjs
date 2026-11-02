import { readFile, writeFile, cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Read the saved bundled sample and production compiler; never load editor
// backups, run project commands, call save(), or contact a provider.
const output = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || path.join(output, '../..'));
const { createProjectService, projectRevision } = await import(pathToFileURL(path.join(root, 'server/project/workspace.mjs')));
const { listDesignTokens } = await import(pathToFileURL(path.join(root, 'server/project/proposals.mjs')));
const { buildDesignPreview } = await import(pathToFileURL(path.join(root, 'desktop/extension/src/design-preview.mjs')));
const service = createProjectService({ root });
const project = await service.snapshot();
const files = await Promise.all(project.files.map(item => service.getFile(project.id, item.path)));
const runtimeSource = await readFile(path.join(root, 'desktop/extension/media/preview-runtime.js'), 'utf8');
const variants = { saved: files, changed: structuredClone(files) };
const changed = variants.changed.find(file => file.path === 'src/components/SaveButton.tsx');
changed.source += '\n// Fixture-only revision for the source-changed scenario.\n';
changed.revision = projectRevision(changed.source);
const previews = {};
const entries = files.filter(file => /\.[jt]sx$/.test(file.path)).map(file => file.path);
for (const [variant, snapshots] of Object.entries(variants)) {
  previews[variant] = {};
  for (const [index, entry] of entries.entries()) {
    const session = `fixture-orbit-${variant}-${index}`;
    try {
      const compiled = buildDesignPreview({ files: snapshots, entry, nonce: 'foundationfixturepreview', runtimeSource, session });
      const consumed = snapshots.filter(file => compiled.files.some(item => item.path === file.path));
      previews[variant][entry] = { ...compiled, session, status: 'ready', compilation: 'passed',
        observed: false, stale: false, entries, tokens: listDesignTokens(consumed), selection: null };
    } catch (error) {
      previews[variant][entry] = { session, entry, status: 'error', compilation: 'failed',
        observed: false, entries, tokens: [], error: error.message };
    }
  }
}
const themes = {};
for (const mode of ['dark', 'light']) themes[mode] = JSON.parse(await readFile(path.join(root, `desktop/extension/themes/foundation-${mode}.json`), 'utf8')).colors;
const fixture = { generatedAt: new Date().toISOString(), boundary: 'Saved sample compiled locally. Fixture host only; no provider or source writes.',
  project: { ...project, id: 'fixture-orbit', root: 'Bundled Orbit sample · browser fixture', preview: null },
  variants, previews, themes };
const json = JSON.stringify(fixture, null, 2) + '\n';
if (json.includes(root)) throw new Error('The fixture contains an absolute source root.');
await writeFile(path.join(output, 'fixture.json'), json);
await mkdir(path.join(output, 'media'), { recursive: true });
for (const name of ['webview.js', 'webview.css', 'artifact-model.js', 'workspace-model.js'])
  await cp(path.join(root, 'desktop/extension/media', name), path.join(output, 'media', name));
await cp(path.join(root, 'desktop/extension/media/fonts'), path.join(output, 'media/fonts'), { recursive: true });
for (const license of ['React-LICENSE.txt', 'ReactDOM-LICENSE.txt'])
  await cp(path.join(root, 'desktop/extension/dist', license), path.join(output, 'media', license));
console.log(`Built isolated workspace fixture: ${files.length} saved snapshots, ${entries.length} entries, two explicit variants.`);
