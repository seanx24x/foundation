import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartupDiagnostics } from '../src/startup-diagnostics.mjs';

function harness() {
  const lines = [];
  let time = 100;
  const diagnostics = createStartupDiagnostics(line => lines.push(JSON.parse(line)), {
    timestamp: () => '2026-10-28T00:00:00.000Z', clock: () => time,
  });
  return { diagnostics, lines, advance: duration => { time += duration; } };
}

test('overlapping phases have paired ids, ordered boundaries and independent durations', async () => {
  const h = harness();
  let resolveRead;
  const source = { source: 'private source must never enter output' };
  const read = h.diagnostics.runAsync('selected-source-read', () => new Promise(resolve => { resolveRead = resolve; }));
  h.advance(12);
  assert.equal(h.diagnostics.runSync('preview-compilation', () => { h.advance(8); return source; }), source);
  h.advance(4);
  resolveRead(source);
  assert.equal(await read, source);
  assert.deepEqual(h.lines.map(({ id, phase, event, durationMs, outcome }) => ({ id, phase, event, durationMs, outcome })), [
    { id: 1, phase: 'selected-source-read', event: 'started', durationMs: undefined, outcome: undefined },
    { id: 2, phase: 'preview-compilation', event: 'started', durationMs: undefined, outcome: undefined },
    { id: 2, phase: 'preview-compilation', event: 'finished', durationMs: 8, outcome: 'succeeded' },
    { id: 1, phase: 'selected-source-read', event: 'finished', durationMs: 24, outcome: 'succeeded' },
  ]);
  assert.ok(h.lines.every(line => line.timestamp === '2026-10-28T00:00:00.000Z'));
  assert.ok(!JSON.stringify(h.lines).includes(source.source));
});

test('errors retain identity without reading message, stack, credentials or untrusted phase text', async () => {
  const h = harness();
  const secret = '/Users/example/private https://provider.example?key=secret';
  const failure = new Error(secret);
  for (const property of ['message', 'stack']) Object.defineProperty(failure, property, { get() { throw new Error('Diagnostic read private error data'); } });
  assert.throws(() => h.diagnostics.runSync(secret, () => { throw failure; }), error => error === failure);
  await assert.rejects(h.diagnostics.runAsync('project-open', () => Promise.reject(failure)), error => error === failure);
  const output = JSON.stringify(h.lines);
  assert.ok(!output.includes(secret));
  assert.equal(h.lines[0].phase, 'operation');
  assert.deepEqual(h.lines.filter(line => line.event === 'finished').map(line => line.outcome), ['failed', 'failed']);
});

test('broken output or clocks cannot affect operation behavior', async () => {
  const diagnostics = createStartupDiagnostics(() => { throw new Error('Output unavailable'); }, {
    clock: () => { throw new Error('Clock unavailable'); }, timestamp: () => { throw new Error('Timestamp unavailable'); },
  });
  const value = {};
  assert.equal(diagnostics.runSync('preview-compilation', () => value), value);
  assert.equal(await diagnostics.runAsync('project-open', () => value), value);
  const failure = {};
  assert.throws(() => diagnostics.runSync('preview-compilation', () => { throw failure; }), error => error === failure);
  await assert.rejects(diagnostics.runAsync('project-open', () => { throw failure; }), error => error === failure);
});
