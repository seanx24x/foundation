import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { historyHost, populatedHistory, populatedConversationStore } from '../extension/test/helpers/history-performance-fixture.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = dirname(desktop);
const usage = 'Usage: node desktop/scripts/history-performance.mjs --baseline-app=/absolute/path/Foundation.app [--output=/absolute/path/report.json]';
const options = new Map();
for (const argument of process.argv.slice(2)) {
  const match = /^(--baseline-app|--output)=(.+)$/.exec(argument);
  if (!match || options.has(match[1]) || !isAbsolute(match[2])) throw new Error(usage);
  options.set(match[1], match[2]);
}
if (!options.has('--baseline-app')) throw new Error(usage);

// The baseline must be selected deliberately. Rebuilding the default app must
// never silently turn a before/after comparison into two copies of the candidate.
const baselineApp = realpathSync(options.get('--baseline-app'));
const baselinePackage = join(baselineApp, 'Contents/Resources/app/extensions/foundation-workspace');
const baselineVersion = JSON.parse(readFileSync(join(baselinePackage, 'package.json'), 'utf8')).version;
const currentVersion = JSON.parse(readFileSync(join(desktop, 'extension/package.json'), 'utf8')).version;
if (typeof baselineVersion !== 'string' || typeof currentVersion !== 'string') throw new Error('Both extension packages must declare a version.');
const map = JSON.parse(readFileSync(join(baselinePackage, 'dist/extension.cjs.map'), 'utf8'));
const sourceIndex = map.sources?.findIndex(path => path.endsWith('/src/extension.ts'));
const oldSource = map.sourcesContent?.[sourceIndex];
if (typeof oldSource !== 'string' || !oldSource.includes('class FoundationHost')) throw new Error('The selected baseline must include its FoundationHost TypeScript source map.');
const newSource = readFileSync(join(desktop, 'extension/src/extension.ts'), 'utf8');
const output = options.get('--output') || join(desktop, '.build/history-performance-report.json');
const hash = value => createHash('sha256').update(value).digest('hex');
const fixture = populatedHistory();
const before = historyHost({ source: oldSource, fixture });
const after = historyHost({ source: newSource, fixture });
const conversations = populatedConversationStore(fixture.project.id);
const operations = [
  ['runtime_store_clone_only', 'Current runtime store snapshot clone', () => fixture.store.snapshot()],
  ['conversation_store_snapshot', 'Current conversation store snapshot', () => conversations.store.snapshot()],
  ['runtime_snapshot_baseline', `Foundation ${baselineVersion} runtime snapshot`, () => before.host.runtimeWorkspaceSnapshot()],
  ['runtime_snapshot_current', `Foundation ${currentVersion} runtime snapshot`, () => after.host.runtimeWorkspaceSnapshot()],
];
const first = {};
for (const [name, host] of [['before', before], ['after', after]]) {
  host.resetCounts(); const value = host.host.runtimeWorkspaceSnapshot();
  first[name] = { ...host.calls, statuses: [...new Set(value.runFreshness.map(item => item.status))] };
}
const warmupRounds = 8, measuredRounds = 80;
for (let round = 0; round < warmupRounds; round++) for (const [, , operation] of operations) operation();
before.resetCounts(); after.resetCounts();
const samples = Object.fromEntries(operations.map(([name]) => [name, []]));
for (let round = 0; round < measuredRounds; round++) {
  // Rotate the ordering to avoid assigning one operation a consistent GC position.
  for (let offset = 0; offset < operations.length; offset++) {
    const [name, , operation] = operations[(round + offset) % operations.length];
    const started = performance.now(); operation(); samples[name].push(performance.now() - started);
  }
}
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], minMs: sorted[0], maxMs: sorted.at(-1), samplesMs: values };
};
const result = {
  label: 'Synthetic bounded history microbenchmark; host/store only, not native UI acceptance',
  boundaries: 'Both host versions use the same validated current-store fixtures. Timings include production store cloning, but exclude webview transfer and rendering. No provider or runtime is started.',
  createdAt: new Date().toISOString(), node: process.version, baselineApp, baselineVersion, currentVersion,
  sourceHashes: { before: hash(oldSource), after: hash(newSource) },
  harnessHashes: Object.fromEntries(['desktop/scripts/history-performance.mjs', 'desktop/extension/test/helpers/history-performance-fixture.mjs'].map(file => [file, hash(readFileSync(join(root, file)))])),
  warmupRounds, measuredRounds,
  fixture: { runs: 40, observations: 4000, sources: fixture.files.length, sourceBytes: fixture.files.reduce((sum, file) => sum + Buffer.byteLength(file.source), 0), runtimeSnapshotBytes: Buffer.byteLength(JSON.stringify(fixture.store.snapshot())), conversations: 10, turns: 100, conversationSnapshotBytes: Buffer.byteLength(JSON.stringify(conversations.store.snapshot())) },
  firstSnapshot: first,
  measuredHashWork: { before: { ...before.calls }, after: { ...after.calls } },
  operations: Object.fromEntries(operations.map(([name, label]) => [name, { label, ...summarize(samples[name]) }])),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, ...result, operations: Object.fromEntries(Object.entries(result.operations).map(([name, { samplesMs, ...summary }]) => [name, summary])) }, null, 2));
