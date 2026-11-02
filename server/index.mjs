import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createProjectService, ProjectError } from './project/workspace.mjs';
import { createAssistantService, AssistantError } from './project/assistant.mjs';
import { BASELINE_SOURCE, IMPROVED_SOURCE, SOURCE_PATH } from './fixture-template.mjs';

const MAX_BODY_BYTES = 96 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export const sourceRevision = (source) => createHash('sha256').update(source).digest('hex').slice(0, 16);

class HttpError extends Error {
  constructor(status, code, message, revision) {
    super(message);
    Object.assign(this, { status, code, revision });
  }
}

function isLocalUrl(value, protocols) {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) && LOOPBACK_HOSTS.has(url.hostname)
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}

async function readJson(request, limit = MAX_BODY_BYTES) {
  if (!request.headers['content-type'] && !request.headers['transfer-encoding'] && !Number(request.headers['content-length'])) return {};
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'json-required', 'Send an application/json request body.');
  }
  if (Number(request.headers['content-length']) > limit) {
    request.resume();
    throw new HttpError(413, 'body-too-large', 'The request body is too large.');
  }
  let size = 0;
  const parts = [];
  for await (const part of request) {
    size += part.length;
    if (size > limit) throw new HttpError(413, 'body-too-large', 'The request body is too large.');
    parts.push(part);
  }
  try {
    const value = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Object required');
    return value;
  } catch {
    throw new HttpError(400, 'invalid-json', 'The request body must be a JSON object.');
  }
}

function managedVariant(source) {
  const styleLine = /^        style=\{\{ borderRadius: (\d+), paddingInline: (\d+) \}\}\n/gm;
  const matches = [...source.matchAll(styleLine)];
  if (matches.length > 1) return null;
  const plain = source.replace(styleLine, '');
  if (plain !== BASELINE_SOURCE && plain !== IMPROVED_SOURCE) return null;
  return { enhanced: plain === IMPROVED_SOURCE, style: matches[0]?.[0] ?? '' };
}

function withStyle(source, style) {
  return source.replace('        className="fixture-save"\n', `        className="fixture-save"\n${style}`);
}

function typecheck(root) {
  return new Promise((resolveCheck) => {
    const child = spawn(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], {
      cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    const capture = (chunk) => { output = (output + chunk.toString()).slice(0, 16000); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 20000);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolveCheck({ name: 'TypeScript', status: 'failed', detail: `Unable to start TypeScript: ${error.message}` });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolveCheck({
        name: 'TypeScript', status: code === 0 && !timedOut ? 'passed' : 'failed',
        detail: timedOut ? 'TypeScript exceeded the 20 second verification limit.' : output.trim() || (code === 0 ? 'Local TypeScript compiler completed with no errors.' : `TypeScript exited with code ${code}.`),
      });
    });
  });
}

/** The caller controls root; requests can never choose a filesystem path or command. */
export function createFoundationServer({ root, port = 4174, frontendPort = Number(process.env.FOUNDATION_PORT || 4173) }) {
  const workspaceRoot = resolve(root);
  const sourceFile = join(workspaceRoot, SOURCE_PATH);
  const projectService = createProjectService({root: workspaceRoot});
  const assistantService = createAssistantService({projectService});
  let proposal = null;
  let lastApplied = null;
  let verification = null;
  const requests = [];
  let mutationQueue = Promise.resolve();

  async function readSource() {
    // Refuse symlinked fixture paths: this API only owns the managed fixture.
    for (const path of [join(workspaceRoot, 'fixtures'), join(workspaceRoot, 'fixtures/web'), join(workspaceRoot, 'fixtures/web/src'), sourceFile]) {
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new HttpError(409, 'unsafe-fixture-path', 'The managed fixture cannot contain symbolic links.');
    }
    const info = await lstat(sourceFile);
    if (!info.isFile()) throw new HttpError(409, 'invalid-fixture', 'The managed source must be a regular file.');
    if (info.size > MAX_SOURCE_BYTES) throw new HttpError(413, 'source-too-large', 'The managed fixture exceeds 64 KiB.');
    return readFile(sourceFile, 'utf8');
  }

  async function snapshot() {
    const source = await readSource();
    return { project: 'Orbit', revision: sourceRevision(source), source, sourcePath: SOURCE_PATH,
      changed: source !== BASELINE_SOURCE, mappingSupported: managedVariant(source) !== null,
      proposal, undoAvailable: Boolean(lastApplied && source === lastApplied.after), requests: [...requests], verification };
  }

  function serialize(work) {
    const operation = mutationQueue.then(work);
    mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  async function writeGuarded(expected, replacement) {
    const current = await readSource();
    if (current !== expected) throw new HttpError(409, 'source-conflict', 'The source changed. Refresh and review the current version before continuing.', sourceRevision(current));
    await writeFile(sourceFile, replacement, 'utf8');
  }

  const server = createServer(async (request, response) => {
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    try {
      const remote = request.socket.remoteAddress;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
          || !isLocalUrl(`http://${request.headers.host ?? ''}`, ['http:'])) {
        throw new HttpError(403, 'local-only', 'Foundation accepts local requests only.');
      }
      const origin = request.headers.origin;
      const originPort = origin && isLocalUrl(origin, ['http:', 'https:']) ? Number(new URL(origin).port || (new URL(origin).protocol === 'https:' ? 443 : 80)) : null;
      if (origin && (originPort === null || ![frontendPort, server.address()?.port].includes(originPort))) {
        throw new HttpError(403, 'origin-rejected', 'This origin is not allowed to access the local workspace.');
      }
      if (origin) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      }
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      const url = new URL(request.url, 'http://127.0.0.1');
      const path = url.pathname;
      if (path.startsWith('/api/project') || path.startsWith('/api/assistant')) {
        const body = request.method === 'POST' ? await readJson(request, 1024 * 1024) : undefined;
        const route = {request, response, url, body, send};
        if (await projectService.handle(route) || await assistantService.handle(route)) return;
        throw new HttpError(404, 'not-found', 'This local endpoint does not exist.');
      }
      if (request.method === 'GET' && path === '/api/workspace') { send(200, await snapshot()); return; }
      if (request.method === 'GET' && path === '/api/requests') { send(200, [...requests]); return; }
      if (request.method !== 'POST') throw new HttpError(404, 'not-found', 'This local endpoint does not exist.');
      const body = await readJson(request);

      if (path === '/api/orbit/profile') {
        const valid = typeof body.name === 'string' && body.name.trim().length > 0 && body.name.length <= 160
          && typeof body.email === 'string' && body.email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
          && (body.simulateError === undefined || typeof body.simulateError === 'boolean');
        if (!valid) { send(400, {ok: false, error: 'Enter a name and valid email address.'}); return; }
        await new Promise(done => setTimeout(done, 650));
        send(body.simulateError ? 503 : 200, body.simulateError
          ? {ok: false, error: 'Simulated service unavailable. Please try again.'}
          : {ok: true, message: 'Profile saved locally.', updatedAt: new Date().toISOString()});
        return;
      }

      if (path === '/api/profile') {
        const started = performance.now();
        const revision = sourceRevision(await readSource());
        const valid = typeof body.name === 'string' && body.name.trim().length > 0 && body.name.length <= 160
          && typeof body.email === 'string' && body.email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
          && (body.simulateError === undefined || typeof body.simulateError === 'boolean');
        let status = 400;
        let result = { ok: false, error: 'Enter a name and valid email address.' };
        if (valid) {
          await new Promise((done) => setTimeout(done, 500));
          status = body.simulateError ? 503 : 200;
          result = body.simulateError ? { ok: false, error: 'Simulated service unavailable. Please try again.' }
            : { ok: true, message: 'Profile saved.', updatedAt: new Date().toISOString() };
        }
        requests.unshift({ id: randomUUID(), method: 'POST', path, status, durationMs: Math.round(performance.now() - started),
          timestamp: new Date().toISOString(), revision, response: result });
        requests.splice(100);
        send(status, result);
        return;
      }

      if (path === '/api/proposal') {
        send(200, await serialize(async () => {
          const source = await readSource();
          const variant = managedVariant(source);
          if (!variant) throw new HttpError(409, 'unsupported-source', 'This scripted fixture proposal requires a recognized SaveButton version. Your source edits are preserved.', sourceRevision(source));
          if (body.kind !== undefined && body.kind !== 'visual' && body.kind !== 'behavior') throw new HttpError(400, 'invalid-proposal-kind', 'Choose a behavior or visual proposal.');
          const visual = body.kind === 'visual';
          if (visual && (!Number.isInteger(body.radius) || body.radius < 0 || body.radius > 20
              || !Number.isInteger(body.padding) || body.padding < 8 || body.padding > 32)) {
            throw new HttpError(400, 'invalid-visual-values', 'Radius must be an integer from 0–20 and padding an integer from 8–32.');
          }
          const after = visual
            ? withStyle(variant.enhanced ? IMPROVED_SOURCE : BASELINE_SOURCE, `        style={{ borderRadius: ${body.radius}, paddingInline: ${body.padding} }}\n`)
            : withStyle(IMPROVED_SOURCE, variant.style);
          if (after === source) throw new HttpError(409, 'no-change', 'The requested change is already present in the source.', sourceRevision(source));
          proposal = { id: randomUUID(), title: visual ? 'Refine the Save button' : 'Make saving feel dependable',
            summary: visual
              ? `Scripted fixture proposal — no AI model was called. Sets this SaveButton to a ${body.radius}px radius and ${body.padding}px horizontal padding. No shared tokens are changed.`
              : 'Scripted fixture proposal — no AI model was called. Adds pending, success, and recoverable error states to this SaveButton only.',
            before: source, after, baseRevision: sourceRevision(source), status: 'proposed' };
          return snapshot();
        }));
        return;
      }

      if (path === '/api/apply') {
        send(200, await serialize(async () => {
          const source = await readSource();
          if (!proposal || proposal.status !== 'proposed') throw new HttpError(409, 'proposal-required', 'Create and review a proposal before applying it.');
          if (body.proposalId !== proposal.id) throw new HttpError(409, 'proposal-conflict', 'The proposal changed since you reviewed it. Refresh and review the current proposal before applying.', sourceRevision(source));
          if (body.baseRevision !== proposal.baseRevision || sourceRevision(source) !== proposal.baseRevision || source !== proposal.before) {
            throw new HttpError(409, 'stale-proposal', 'The proposal is stale. Your current source has been preserved.', sourceRevision(source));
          }
          await writeGuarded(proposal.before, proposal.after);
          proposal = { ...proposal, status: 'applied' };
          lastApplied = proposal;
          return snapshot();
        }));
        return;
      }

      if (path === '/api/undo') {
        send(200, await serialize(async () => {
          if (!lastApplied) throw new HttpError(409, 'nothing-to-undo', 'There is no applied Foundation change to undo.');
          await writeGuarded(lastApplied.after, lastApplied.before);
          if (proposal?.id === lastApplied.id) proposal = { ...proposal, status: 'proposed' };
          lastApplied = null;
          return snapshot();
        }));
        return;
      }

      if (path === '/api/source') {
        send(200, await serialize(async () => {
          if (typeof body.source !== 'string' || !body.source.trim()) throw new HttpError(400, 'invalid-source', 'Source must be a non-empty string.');
          if (Buffer.byteLength(body.source, 'utf8') > MAX_SOURCE_BYTES) throw new HttpError(413, 'source-too-large', 'Source is limited to 64 KiB.');
          const source = await readSource();
          if (body.baseRevision !== sourceRevision(source)) throw new HttpError(409, 'source-conflict', 'The source changed since you opened it. Refresh before saving.', sourceRevision(source));
          await writeGuarded(source, body.source);
          return snapshot();
        }));
        return;
      }

      if (path === '/api/verify') {
        send(200, await serialize(async () => {
          const revision = sourceRevision(await readSource());
          const check = await typecheck(workspaceRoot);
          const currentRevision = sourceRevision(await readSource());
          verification = { revision, timestamp: new Date().toISOString(), checks: [
            currentRevision === revision ? check : { name: 'TypeScript', status: 'not-run', detail: 'Source changed during verification. Run again against the current revision.' },
            { name: 'Interaction', status: 'not-run', detail: 'Run the Save scenario in the preview. A successful build does not verify behavior.' },
            { name: 'Visual', status: 'not-run', detail: 'Inspect named states, themes, and viewport sizes. TypeScript does not verify appearance.' },
          ] };
          return verification;
        }));
        return;
      }
      throw new HttpError(404, 'not-found', 'This local endpoint does not exist.');
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      const known = error instanceof HttpError || error instanceof ProjectError || error instanceof AssistantError;
      send(known ? error.status : 500, {
        error: known ? error.message : 'The local runtime could not complete the request.',
        code: known ? error.code : 'runtime-error',
        ...(error.revision ? { revision: error.revision } : {}),
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.foundationPort = port;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const server = createFoundationServer({ root, port: Number(process.env.FOUNDATION_API_PORT || 4174) });
  server.listen(server.foundationPort, '127.0.0.1', () => {
    console.log(`Foundation local runtime: http://127.0.0.1:${server.address().port}`);
  });
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
}
