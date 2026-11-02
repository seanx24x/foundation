import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { foundationRuntime } from '../../runtime/vite-plugin.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const wait = async (check, label, timeout = 6000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out: ${label}`);
};

async function fixture(t) {
  // Use the real authenticated middleware and client, without a project build or
  // native UI. Synthetic app payloads below must never enter runtime evidence.
  const plugin = foundationRuntime();
  plugin.configResolved({ root: repo, server: { host: '127.0.0.1' } });
  let middleware;
  plugin.configureServer({ middlewares: { use: handler => { middleware = handler; } } });
  const client = plugin.transformIndexHtml()[0].children;
  const accepted = [], rejected = [];
  let appRequests = 0, browser;
  const server = createServer((request, response) => {
    if (request.url.startsWith('/__foundation/events')) {
      const chunks = []; request.on('data', chunk => chunks.push(chunk));
      response.on('finish', () => {
        const body = Buffer.concat(chunks);
        (response.statusCode === 202 ? accepted : rejected).push({ bytes: body.length, status: response.statusCode, event: JSON.parse(body) });
      });
    }
    void middleware(request, response, () => {
      if (request.url.startsWith('/api/ping')) {
        appRequests++; request.resume();
        response.writeHead(200, { 'Content-Type': 'text/plain' }).end('PRIVATE_APP_RESPONSE');
      } else {
        response.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><html><body><button>Local fixture</button><script>${client}</script></body></html>`);
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const handshake = await (await fetch(base + '/__foundation/handshake')).json();
  const snapshot = async () => (await fetch(base + '/__foundation/snapshot', { headers: { 'X-Foundation-Token': handshake.token } })).json();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // Native diagnostics also enable Network. Do not read instrumentation response
  // bodies from the test: that would hide the unread-acknowledgment regression.
  const cdp = await page.context().newCDPSession(page); await cdp.send('Network.enable');
  await page.goto(base);
  await wait(async () => (await snapshot()).pageConnected, 'initial runtime connection');
  return { page, accepted, rejected, snapshot, appRequests: () => appRequests };
}

test('runtime request evidence continues beyond 64 KiB without consuming application responses or private payloads', { timeout: 25000 }, async t => {
  const h = await fixture(t), initial = await h.snapshot();
  const result = await h.page.evaluate(async () => {
    const statuses = [], bodies = [];
    for (let i = 0; i < 500; i++) {
      const response = await fetch('/api/ping?token=PRIVATE_QUERY#PRIVATE_HASH', {
        method: 'POST', headers: { 'X-Private-App-Header': 'PRIVATE_HEADER' }, body: 'PRIVATE_APP_BODY',
      });
      statuses.push(response.status); bodies.push(await response.text());
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return { statuses, bodies };
  });
  assert.equal(h.appRequests(), 500);
  assert.ok(result.statuses.every(status => status === 200));
  assert.ok(result.bodies.every(body => body === 'PRIVATE_APP_RESPONSE'), 'the app retains its own response body');
  const requests = () => h.accepted.filter(item => item.event.type === 'request');
  await wait(() => requests().length === 500, 'all 500 requests reach runtime evidence beyond the browser keepalive budget');
  assert.ok(requests().reduce((sum, item) => sum + item.bytes, 0) > 128 * 1024, 'accepted event bodies exceed twice the 64 KiB budget');
  assert.deepEqual(h.rejected, []);
  assert.doesNotMatch(JSON.stringify(h.accepted), /PRIVATE_QUERY|PRIVATE_HASH|PRIVATE_HEADER|PRIVATE_APP_BODY|PRIVATE_APP_RESPONSE/);
  const observed = await h.snapshot();
  assert.equal(observed.documentId, initial.documentId); assert.equal(observed.session, initial.session);
  assert.equal(observed.observations.length, 100, 'the production evidence retention limit is unchanged');
  assert.ok(observed.observations.at(-1).id.endsWith(':500'));
  assert.ok(observed.observations.every(item => item.status === 200 && item.correlation === 'unattributed' && !item.url.includes('?')));

  const readyBefore = h.accepted.filter(item => item.event.type === 'ready').length;
  await wait(() => h.accepted.filter(item => item.event.type === 'ready').length > readyBefore, 'heartbeats continue after sustained request traffic', 3500);
  const xhr = await h.page.evaluate(() => new Promise(resolve => {
    const request = new XMLHttpRequest(); request.open('POST', '/api/ping?secret=PRIVATE_XHR_QUERY');
    request.addEventListener('loadend', () => resolve({ status: request.status, body: request.responseText }));
    request.send('PRIVATE_XHR_BODY');
  }));
  assert.deepEqual(xhr, { status: 200, body: 'PRIVATE_APP_RESPONSE' });
  await wait(() => requests().length === 501, 'later XHR observation reaches the same runtime document');
  const after = await h.snapshot();
  assert.equal(after.pageConnected, true); assert.equal(after.documentId, initial.documentId);
  assert.ok(after.observations.at(-1).id.endsWith(':501'));
  assert.equal(after.observations.at(-1).timing, 'response-complete');
  assert.doesNotMatch(JSON.stringify(h.accepted), /PRIVATE_XHR_QUERY|PRIVATE_XHR_BODY/);
});

test('transport acknowledgments preserve route sequence and current-document pagehide behavior', { timeout: 10000 }, async t => {
  const h = await fixture(t), initial = await h.snapshot();
  await h.page.evaluate(() => {
    history.pushState({}, '', '/other?private=PRIVATE_ROUTE_QUERY');
    history.replaceState({}, '', '/');
  });
  await wait(async () => (await h.snapshot()).pageVersion === initial.pageVersion + 2, 'round-trip route ordering');
  const current = await h.snapshot();
  assert.equal(current.pagePath, '/'); assert.equal(current.documentId, initial.documentId);
  assert.doesNotMatch(JSON.stringify(h.accepted), /PRIVATE_ROUTE_QUERY/);
  await h.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await wait(() => h.accepted.some(item => item.event.type === 'pagehide'), 'unload notification accepted');
  const event = h.accepted.find(item => item.event.type === 'pagehide').event;
  assert.equal(event.documentId, initial.documentId); assert.equal(event.pageSequence, 3);
  await wait(async () => !(await h.snapshot()).pageConnected, 'pagehide disconnects the current document');
});
