import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createProjectService } from '../../server/project/workspace.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const options = { samples: 25, warmup: 3, output: `artifacts/baseline-v${manifest.version.split('.').slice(0, 2).join('.')}` };
for (let i = 2; i < process.argv.length; i += 2) {
  const option = process.argv[i];
  const value = process.argv[i + 1];
  if (!['--samples', '--warmup', '--output'].includes(option) || !value) {
    throw new Error('Usage: npm run desktop:benchmark -- [--samples 25] [--warmup 3] [--output artifacts/baseline-v0.10]');
  }
  options[option.slice(2)] = option === '--output' ? value : Number(value);
}
assert(Number.isInteger(options.samples) && options.samples >= 5 && options.samples <= 1000, 'Samples must be an integer from 5 to 1000.');
assert(Number.isInteger(options.warmup) && options.warmup >= 0 && options.warmup <= 100, 'Warmup must be an integer from 0 to 100.');
const hash = value => createHash('sha256').update(value).digest('hex');
const round = value => Number(value.toFixed(3));
const startedAt = new Date().toISOString();

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    sampleCount: samples.length,
    medianMs: round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2),
    p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    minMs: round(sorted[0]),
    maxMs: round(sorted.at(-1)),
    samplesMs: samples.map(round),
  };
}

async function measure(id, label, description, run, check) {
  for (let i = 0; i < options.warmup; i++) check(await run());
  const samples = [];
  let result;
  for (let i = 0; i < options.samples; i++) {
    const start = performance.now();
    result = await run();
    const elapsed = performance.now() - start;
    check(result); // Assertions and result summaries are outside the measured interval.
    samples.push(elapsed);
  }
  const metrics = summarize(samples);
  console.log(`${label}: median ${metrics.medianMs} ms · p95 ${metrics.p95Ms} ms`);
  return { id, label, description, ...metrics };
}

async function fingerprint(folder, files) {
  const digest = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const bytes = await readFile(join(folder, file.path));
    digest.update(file.path).update('\0').update(bytes).update('\0');
  }
  return digest.digest('hex');
}

async function makeFixture(folder) {
  const sources = join(folder, 'src');
  await mkdir(join(sources, 'components'), { recursive: true });
  await writeFile(join(folder, 'package.json'), JSON.stringify({ name: 'foundation-benchmark-100', private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '19.2.4' }, devDependencies: { vite: '8.0.13' } }, null, 2) + '\n');
  await writeFile(join(sources, 'saveProfile.ts'), `export type Profile = { name: string; email: string };
export async function saveProfile(profile: Profile) {
  const response = await fetch('/api/profile', { method: 'POST', body: JSON.stringify(profile) });
  if (!response.ok) throw new Error('Unable to save profile');
  return response.json();
}
`);
  await writeFile(join(sources, 'App.tsx'), `import { Control000 } from './components/Control000';
export function App() { return <main><h1>Benchmark project</h1><Control000 label="Save profile" onSave={async () => {}} /></main>; }
`);
  for (let i = 0; i < 97; i++) {
    const id = String(i).padStart(3, '0');
    const previous = String((i + 96) % 97).padStart(3, '0');
    await writeFile(join(sources, 'components', `Control${id}.tsx`), `import { useState } from 'react';
import type { Profile } from '../saveProfile';
import { saveProfile } from '../saveProfile';
import { controlId as previousId } from './Control${previous}';

export const controlId = 'control-${id}';
export type ControlProps = { label: string; onSave: (profile: Profile) => Promise<void> };
export function Control${id}({ label, onSave }: ControlProps) {
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  async function submit() {
    setState('saving');
    try {
      const profile = { name: 'Example', email: 'example@example.test' };
      await saveProfile(profile);
      await onSave(profile);
      setState('idle');
    } catch { setState('error'); }
  }
  return <section aria-label={label} data-previous={previousId}>
    <button disabled={state === 'saving'} onClick={submit}>{state === 'saving' ? 'Saving…' : label}</button>
    {state === 'error' && <p role="alert">Unable to save. Please try again.</p>}
  </section>;
}
`);
  }
}

async function benchmarkDataset({ id, label, folder, sourcePath, query, fixtureDescription }) {
  const service = createProjectService({ root });
  const initial = await service.open(folder);
  assert.equal(initial.truncated, false, `${label}: inventory must not be truncated.`);
  assert(initial.files.some(file => file.path === sourcePath), `${label}: selected source exists.`);
  const before = await fingerprint(folder, initial.files);
  const original = await service.getFile(initial.id, sourcePath);
  const matching = await service.search(initial.id, query);
  assert(matching.matches.length > 0 && !matching.truncated, `${label}: matching search must not hit the service result cap.`);
  const noMatchQuery = 'foundation_benchmark_absent_ee49bc82';
  const checkSnapshot = value => { assert.equal(value.truncated, false); assert.deepEqual(value.files, initial.files); };
  const operations = [];
  operations.push(await measure('open_index', 'Open and index', 'Construct a fresh service, open the folder, scan its supported inventory, and discover package targets. The OS filesystem cache remains warm.', () => createProjectService({ root }).open(folder), checkSnapshot));
  operations.push(await measure('snapshot', 'Snapshot / rescan', 'Call snapshot() on the active service. The current implementation rescans the supported inventory and package targets each time.', () => service.snapshot(), checkSnapshot));
  operations.push(await measure('get_file', 'Read source and analyze', 'Call getFile() for the selected source. Includes inventory, source read, AST analysis, and source-consumer discovery across the project.', () => service.getFile(initial.id, sourcePath), value => { assert.equal(value.revision, original.revision); assert.equal(value.source, original.source); }));
  operations.push(await measure('search_match', 'Literal search · matches', 'Call search() with a known matching literal; the complete inventory is searched and the result remains below the 200-match cap.', () => service.search(initial.id, query), value => { assert.equal(value.truncated, false); assert.deepEqual(value.matches, matching.matches); }));
  operations.push(await measure('search_no_match', 'Literal search · no match', 'Call search() with an absent literal, requiring a complete scan of all supported file contents.', () => service.search(initial.id, noMatchQuery), value => { assert.equal(value.truncated, false); assert.equal(value.matches.length, 0); }));
  const final = await service.snapshot();
  checkSnapshot(final);
  assert.equal(await fingerprint(folder, final.files), before, `${label}: saved files changed during the benchmark; discard timings.`);
  return { id, label, fixtureDescription, indexedFiles: initial.files.length, indexedBytes: initial.files.reduce((sum, file) => sum + file.size, 0), indexedSourceFiles: initial.files.filter(file => /\.(?:[cm]?js|jsx|ts|tsx)$/.test(file.path)).length, inventorySha256: before, truncated: false, sourcePath, sourceRevision: original.revision, sourceBytes: Buffer.byteLength(original.source), matchingQuery: query, matchingResults: matching.matches.length, noMatchQuery, unchangedAfterRun: true, operations };
}

const fixture = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'foundation-benchmark-'));
let report;
try {
  await makeFixture(fixture);
  const datasets = [];
  for (const dataset of [
    { id: 'orbit_saved', label: 'Bundled Orbit · saved files', folder: join(root, 'projects/orbit'), sourcePath: 'src/components/SaveButton.tsx', query: 'SaveButton', fixtureDescription: 'The bundled Orbit directory on disk. Read-only; unsaved editor buffers are excluded.' },
    { id: 'synthetic_100', label: 'Generated 100-file project', folder: fixture, sourcePath: 'src/components/Control000.tsx', query: 'control-', fixtureDescription: 'Deterministic owned temporary fixture: 97 TSX controls, App.tsx, saveProfile.ts, and package.json. Controls contain state, imports, an event handler, and an API call. No dependencies are installed and no code is executed.' },
  ]) {
    console.log(`\n${dataset.label}`);
    datasets.push(await benchmarkDataset(dataset));
  }
  assert.equal(datasets[1].indexedFiles, 100);
  const sourceFiles = ['server/project/workspace.mjs', 'desktop/scripts/benchmark.mjs'];
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* A checkout without commits is still benchmarkable. */ }
  report = {
    schemaVersion: 1, benchmark: 'Foundation M0 source-service baseline', foundationVersion: manifest.version,
    startedAt, completedAt: new Date().toISOString(),
    machine: { platform: process.platform, architecture: process.arch, osRelease: os.release(), cpu: os.cpus()[0]?.model || 'Unknown', logicalCpus: os.cpus().length, memoryGiB: round(os.totalmem() / (1024 ** 3)) },
    runtime: { node: process.version, v8: process.versions.v8, typescript: JSON.parse(await readFile(join(root, 'node_modules/typescript/package.json'), 'utf8')).version },
    implementation: { gitHead: commit, files: await Promise.all(sourceFiles.map(async path => ({ path, sha256: hash(await readFile(join(root, path))) }))) },
    methodology: { samplesPerOperation: options.samples, warmupsPerOperation: options.warmup, timer: 'performance.now()', scheduling: 'One operation at a time; all samples for one operation run consecutively. Dataset generation, result assertions, and fingerprints are outside timed intervals.', median: 'Middle sorted value; mean of the two central values for even sample counts.', p95: 'Nearest rank: sorted[ceil(0.95 * sampleCount) - 1].', sourcePolicy: 'Only saved filesystem content. No save/revert API, provider calls, builds, runtime server, or editor interaction.' },
    limitations: [
      'Warm filesystem and module caches: this is not cold launch, first install, or uncached disk performance.',
      'Measures the Node project service only. Does not measure keystroke/input-to-paint latency, native editor startup, extension-host transport, renderer updates, canvas frames, AI latency, or memory peaks.',
      'The generated fixture is larger than Orbit but remains a small synthetic project. It does not establish large-monorepo performance or performance at service inventory limits.',
      `Single-machine sequential samples with normal background activity. No forced garbage collection, thermal/power control, or confidence intervals. p95 from ${options.samples} samples is an initial reference, not a service-level guarantee.`,
      'There is no comparison with Cursor, Visual Studio Code, Claude Code, Codex, or another product. These numbers do not establish a market performance ranking.',
      'Snapshots and getFile currently rescan project inventory; getFile also reparses source consumers. These baseline numbers include that work, not a future incremental index.',
    ],
    datasets,
  };
} finally {
  await rm(fixture, { recursive: true, force: true });
}

const output = resolve(root, options.output);
await mkdir(dirname(output), { recursive: true });
await writeFile(`${output}.json`, JSON.stringify(report, null, 2) + '\n');
const markdown = [
  `# Foundation ${manifest.version} — source-service baseline`, '',
  `Measured ${report.completedAt}. Foundation ${report.foundationVersion}; Node ${report.runtime.node}; TypeScript ${report.runtime.typescript}.`, '',
  `${report.machine.cpu}; ${report.machine.logicalCpus} logical CPUs; ${report.machine.memoryGiB} GiB RAM; ${report.machine.platform} ${report.machine.osRelease} (${report.machine.architecture}).`, '',
  `Each operation has ${options.samples} sequential measured samples after ${options.warmup} warmups. Timings are milliseconds. Median and nearest-rank p95 come from raw samples retained in the adjacent JSON.`, '',
  '| Project | Operation | Samples | Median (ms) | p95 (ms) |', '| --- | --- | ---: | ---: | ---: |',
  ...report.datasets.flatMap(dataset => dataset.operations.map(operation => `| ${dataset.label} | ${operation.label} | ${operation.sampleCount} | ${operation.medianMs.toFixed(3)} | ${operation.p95Ms.toFixed(3)} |`)), '',
  '## Inputs and preservation', '',
  ...report.datasets.flatMap(dataset => [
    `- **${dataset.label}:** ${dataset.indexedFiles} files (${dataset.indexedSourceFiles} JavaScript/TypeScript source files), ${dataset.indexedBytes.toLocaleString('en-US')} bytes. ${dataset.fixtureDescription}`,
    `  Selected source: \`${dataset.sourcePath}\` (${dataset.sourceBytes} bytes); matching query \`${dataset.matchingQuery}\` returned ${dataset.matchingResults} results. Inventory SHA-256: \`${dataset.inventorySha256}\`.`,
  ]), '',
  'Both inventories were untruncated and their saved-file fingerprints matched before and after the run. The temporary fixture was removed. Orbit was only read; unsaved editor buffers were neither read nor changed.', '',
  '## What each timing includes', '',
  ...report.datasets[0].operations.map(operation => `- **${operation.label}:** ${operation.description}`), '',
  '## Limits', '',
  ...report.limitations.map(limitation => `- ${limitation}`), '',
  '## Repeat', '',
  '```sh', 'npm run desktop:benchmark', '# Preserve this baseline and collect more samples separately:', 'npm run desktop:benchmark -- --samples 100 --warmup 5 --output artifacts/baseline-comparison', '```', '',
  'Use the same runtime, sample counts, machine conditions, fixture digests, and implementation hashes when comparing runs. A change to the bundled source produces a different input and should be reported alongside any timing change.', '',
  'Native input-to-paint, startup, and renderer acceptance remain separate, unmeasured work. No industry comparison or performance target is claimed by this baseline.', '',
].join('\n');
await writeFile(`${output}.md`, markdown);
console.log(`\nSaved ${output}.json and ${output}.md`);
