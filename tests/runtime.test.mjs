import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createFoundationServer, sourceRevision } from '../server/index.mjs';
import { BASELINE_SOURCE, IMPROVED_SOURCE, SOURCE_PATH } from '../server/fixture-template.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'foundation-runtime-test-'));
  await mkdir(join(root, 'fixtures/web/src'), { recursive: true });
  await writeFile(join(root, SOURCE_PATH), BASELINE_SOURCE);
  const server = createFoundationServer({ root, port: 0 });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const get = async (path) => {
    const response = await fetch(url + path);
    return { status: response.status, data: await response.json() };
  };
  const post = async (path, body = {}, headers = {}) => {
    const response = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { root, url, server, get, post };
}

test('workspace is backed by actual source and reports the baseline revision', async (t) => {
  const { get } = await fixture(t);
  const { status, data } = await get('/api/workspace');
  assert.equal(status, 200);
  assert.equal(data.project, 'Orbit');
  assert.equal(data.sourcePath, SOURCE_PATH);
  assert.equal(data.source, BASELINE_SOURCE);
  assert.equal(data.revision, sourceRevision(BASELINE_SOURCE));
  assert.equal(data.changed, false);
  assert.equal(data.mappingSupported, true);
  assert.deepEqual(data.requests, []);
  assert.equal(data.verification, null);
});

test('actual profile success, simulated failure and invalid input produce revision-bound evidence without personal payloads', async (t) => {
  const { get, post } = await fixture(t);
  const profile = { name: 'Private Person', email: 'private@example.test', password: 'never-store-this' };
  const success = await post('/api/profile', profile);
  assert.equal(success.status, 200);
  assert.equal(success.data.ok, true);
  const failure = await post('/api/profile', { ...profile, simulateError: true });
  assert.equal(failure.status, 503);
  assert.equal(failure.data.ok, false);
  const invalid = await post('/api/profile', { name: '', email: 'invalid' });
  assert.equal(invalid.status, 400);
  const { data: requests } = await get('/api/requests');
  assert.deepEqual(requests.map((request) => request.status), [400, 503, 200]);
  assert.equal(requests[1].revision, sourceRevision(BASELINE_SOURCE));
  assert.ok(requests[1].durationMs >= 450);
  assert.equal(requests[1].response.error, failure.data.error);
  assert.equal(new Set(requests.map((request) => request.id)).size, 3);
  assert.doesNotMatch(JSON.stringify(requests), /Private Person|private@example|never-store-this/);
});

test('a reviewed proposal applies real source and undo restores its exact before version', async (t) => {
  const { root, get, post } = await fixture(t);
  const draft = await post('/api/proposal');
  assert.equal(draft.status, 200);
  assert.match(draft.data.proposal.summary, /Scripted fixture proposal/);
  assert.equal(await readFile(join(root, SOURCE_PATH), 'utf8'), BASELINE_SOURCE);
  const applied = await post('/api/apply', { baseRevision: draft.data.revision, proposalId: draft.data.proposal.id });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.proposal.status, 'applied');
  assert.equal(applied.data.changed, true);
  assert.equal(applied.data.mappingSupported, true);
  assert.equal(applied.data.undoAvailable, true);
  assert.equal(await readFile(join(root, SOURCE_PATH), 'utf8'), IMPROVED_SOURCE);
  const undo = await post('/api/undo');
  assert.equal(undo.status, 200);
  assert.equal(undo.data.changed, false);
  assert.equal(undo.data.undoAvailable, false);
  assert.equal(undo.data.proposal.status, 'proposed');
  assert.equal((await get('/api/workspace')).data.source, BASELINE_SOURCE);
});

test('stale apply and editor writes preserve newer source; proposal remains visibly tied to old revision', async (t) => {
  const { root, get, post } = await fixture(t);
  const draft = (await post('/api/proposal')).data;
  const edited = `${BASELINE_SOURCE}\n// User-owned edit\n`;
  const saved = await post('/api/source', { source: edited, baseRevision: draft.revision });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.mappingSupported, false);
  assert.equal(saved.data.proposal.id, draft.proposal.id);
  assert.notEqual(saved.data.revision, saved.data.proposal.baseRevision);
  assert.equal((await post('/api/apply', { baseRevision: draft.revision, proposalId: draft.proposal.id })).status, 409);
  assert.equal((await post('/api/source', { source: BASELINE_SOURCE, baseRevision: draft.revision })).status, 409);
  assert.equal(await readFile(join(root, SOURCE_PATH), 'utf8'), edited);
  assert.equal((await get('/api/workspace')).data.source, edited);
  assert.equal((await post('/api/proposal')).data.code, 'unsupported-source');
});

test('undo refuses to overwrite edits made after applying the managed proposal', async (t) => {
  const { root, post } = await fixture(t);
  const draft = (await post('/api/proposal')).data;
  const applied = (await post('/api/apply', { baseRevision: draft.revision, proposalId: draft.proposal.id })).data;
  const edited = `${applied.source}\n// Preserve this edit\n`;
  await writeFile(join(root, SOURCE_PATH), edited);
  const undone = await post('/api/undo');
  assert.equal(undone.status, 409);
  assert.equal(undone.data.code, 'source-conflict');
  assert.equal(await readFile(join(root, SOURCE_PATH), 'utf8'), edited);
});

test('visual proposals update only managed styles and behavior upgrades preserve those styles', async (t) => {
  const { post } = await fixture(t);
  const visual = (await post('/api/proposal', { kind: 'visual', radius: 12, padding: 24 })).data;
  assert.match(visual.proposal.after, /style=\{\{ borderRadius: 12, paddingInline: 24 \}\}/);
  assert.equal(visual.proposal.after.replace('        style={{ borderRadius: 12, paddingInline: 24 }}\n', ''), BASELINE_SOURCE);
  await post('/api/apply', { baseRevision: visual.revision, proposalId: visual.proposal.id });
  const behavior = (await post('/api/proposal', { kind: 'behavior' })).data;
  assert.equal(behavior.mappingSupported, true);
  assert.match(behavior.proposal.after, /borderRadius: 12, paddingInline: 24/);
  assert.match(behavior.proposal.after, /setStatus\('pending'\)/);
  await post('/api/apply', { baseRevision: behavior.revision, proposalId: behavior.proposal.id });
  const secondVisual = (await post('/api/proposal', { kind: 'visual', radius: 4, padding: 16 })).data;
  assert.match(secondVisual.proposal.after, /borderRadius: 4, paddingInline: 16/);
  assert.equal((secondVisual.proposal.after.match(/style=/g) ?? []).length, 1);
  assert.match(secondVisual.proposal.after, /aria-live="polite"/);
  const invalid = await post('/api/proposal', { kind: 'visual', radius: 100, padding: 12 });
  assert.equal(invalid.status, 400);
});

test('applying requires the reviewed proposal id even when two proposals share the same source revision', async (t) => {
  const { post, get } = await fixture(t);
  const first = (await post('/api/proposal', { kind: 'visual', radius: 12, padding: 24 })).data;
  const second = (await post('/api/proposal', { kind: 'behavior' })).data;
  assert.equal(first.revision, second.revision);
  assert.notEqual(first.proposal.id, second.proposal.id);
  const mismatched = await post('/api/apply', { baseRevision: first.revision, proposalId: first.proposal.id });
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.data.code, 'proposal-conflict');
  assert.equal((await post('/api/apply', { baseRevision: second.revision })).status, 409);
  assert.equal((await get('/api/workspace')).data.source, BASELINE_SOURCE);
  const applied = await post('/api/apply', { baseRevision: second.revision, proposalId: second.proposal.id });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.source, IMPROVED_SOURCE);
});

test('drafting another proposal preserves the last applied undo checkpoint and leaves the new draft stale after undo', async (t) => {
  const { post } = await fixture(t);
  const behavior = (await post('/api/proposal')).data;
  await post('/api/apply', { baseRevision: behavior.revision, proposalId: behavior.proposal.id });
  const visual = (await post('/api/proposal', { kind: 'visual', radius: 12, padding: 24 })).data;
  assert.equal(visual.undoAvailable, true);
  assert.equal(visual.changed, true);
  const undone = await post('/api/undo');
  assert.equal(undone.status, 200);
  assert.equal(undone.data.source, BASELINE_SOURCE);
  assert.equal(undone.data.changed, false);
  assert.equal(undone.data.undoAvailable, false);
  assert.equal(undone.data.proposal.id, visual.proposal.id);
  assert.notEqual(undone.data.proposal.baseRevision, undone.data.revision);
  const stale = await post('/api/apply', { baseRevision: visual.revision, proposalId: visual.proposal.id });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'stale-proposal');
});

test('simultaneous guarded writes cannot both overwrite the same revision', async (t) => {
  const { get, post } = await fixture(t);
  const revision = sourceRevision(BASELINE_SOURCE);
  const results = await Promise.all([
    post('/api/source', { source: `${BASELINE_SOURCE}// A\n`, baseRevision: revision }),
    post('/api/source', { source: `${BASELINE_SOURCE}// B\n`, baseRevision: revision }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = results.find((result) => result.status === 200).data.source;
  assert.equal((await get('/api/workspace')).data.source, winner);
});

test('verification reports an unavailable compiler honestly, never fabricates interaction or visual outcomes', async (t) => {
  const { post, get } = await fixture(t);
  const result = await post('/api/verify');
  assert.equal(result.status, 200);
  assert.equal(result.data.revision, sourceRevision(BASELINE_SOURCE));
  assert.deepEqual(result.data.checks.map((check) => check.status), ['failed', 'not-run', 'not-run']);
  assert.match(result.data.checks[0].detail, /Cannot find module/);
  assert.deepEqual((await get('/api/workspace')).data.verification, result.data);
});

test('verification executes the installed TypeScript compiler and reflects real success and failure', async (t) => {
  const { root, post } = await fixture(t);
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'));
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true, types: [] }, files: ['check.ts'] }));
  await writeFile(join(root, 'check.ts'), 'const value: number = 1;\n');
  const passing = await post('/api/verify');
  assert.equal(passing.data.checks[0].status, 'passed');
  assert.deepEqual(passing.data.checks.slice(1).map((check) => check.status), ['not-run', 'not-run']);
  await writeFile(join(root, 'check.ts'), 'const value: number = "wrong";\n');
  const failing = await post('/api/verify');
  assert.equal(failing.data.checks[0].status, 'failed');
  assert.match(failing.data.checks[0].detail, /TS2322/);
});

test('local origin, host, source and body boundaries reject unsafe requests', async (t) => {
  const { url, post } = await fixture(t);
  assert.equal((await post('/api/proposal', {}, { Origin: 'https://attacker.example' })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(url + '/api/workspace', { headers: { Host: 'attacker.example' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.once('error', reject);
    request.end();
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await post('/api/proposal', {}, { Origin: 'null' })).status, 403);
  assert.equal((await post('/api/proposal', {}, { Origin: 'http://localhost:8000' })).status, 403);
  assert.equal((await post('/api/proposal', {}, { Origin: 'http://127.0.0.1:4173' })).status, 200);
  assert.equal((await post('/api/source', { source: 'x'.repeat(65 * 1024), baseRevision: sourceRevision(BASELINE_SOURCE) })).status, 413);
  assert.equal((await post('/api/source', { source: 'x'.repeat(100 * 1024) })).status, 413);
  const form = await fetch(url + '/api/proposal', { method: 'POST', body: 'anything=1' });
  assert.equal(form.status, 415);
  const invalid = await fetch(url + '/api/proposal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
});

test('symlinked managed source is refused and its target stays untouched', async (t) => {
  const { root, get, post } = await fixture(t);
  const target = join(root, 'unrelated.tsx');
  await writeFile(target, BASELINE_SOURCE);
  await rm(join(root, SOURCE_PATH));
  await symlink(target, join(root, SOURCE_PATH));
  assert.equal((await get('/api/workspace')).status, 409);
  assert.equal((await post('/api/source', { source: IMPROVED_SOURCE, baseRevision: sourceRevision(BASELINE_SOURCE) })).status, 409);
  assert.equal(await readFile(target, 'utf8'), BASELINE_SOURCE);
});

test('project preview requests remain distinct from walkthrough fixture evidence', async (t) => {
  const { get, post } = await fixture(t);
  const profile = { name: 'Orbit tester', email: 'orbit@example.test' };
  assert.equal((await post('/api/orbit/profile', profile)).status, 200);
  assert.equal((await post('/api/orbit/profile', { ...profile, simulateError: true })).status, 503);
  assert.equal((await post('/api/orbit/profile', { name: '', email: '' })).status, 400);
  assert.deepEqual((await get('/api/requests')).data, []);
});
