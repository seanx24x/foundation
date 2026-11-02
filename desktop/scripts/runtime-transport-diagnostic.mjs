import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const match = /^(--repo|--baseline-app|--output)=(.+)$/.exec(argument);
  if (!match || !isAbsolute(match[2])) throw Error('Use absolute --repo, --baseline-app, and optional --output paths.');
  return [match[1], match[2]];
}));
const repo = options['--repo'], app = options['--baseline-app'];
if (!repo || !app) throw Error('Usage: node desktop/scripts/runtime-transport-diagnostic.mjs --repo=/absolute/foundation --baseline-app=/absolute/Foundation.app [--output=/absolute/report.json]');
const packageRoot = join(app, 'Contents/Resources/app/extensions/foundation-workspace');
const pluginPath = join(packageRoot, 'dist/connected-vite-plugin.mjs');
const baselineVersion = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version;
const baselineHash = createHash('sha256').update(await readFile(pluginPath)).digest('hex');
const { chromium } = createRequire(join(repo, 'package.json'))('@playwright/test');
const { foundationRuntime } = await import(pathToFileURL(pluginPath).href);

const results = [];
for (const variant of ['baseline', 'consume', 'no-keepalive', 'both']) {
  const plugin = foundationRuntime(); plugin.configResolved({ root: repo, server: { host: '127.0.0.1' } });
  let middleware; plugin.configureServer({ middlewares: { use: handler => { middleware = handler; } } });
  let script = plugin.transformIndexHtml()[0].children;
  if (!/keepalive: true/.test(script) || !/\}\)\.catch\(\(\) => \{\s*\}\);/.test(script)) throw Error('Baseline must contain the original keepalive/unread-ack client.');
  if (variant === 'consume' || variant === 'both') script = script.replace(/\}\)\.catch\(\(\) => \{\s*\}\);/, '}).then(response => response.arrayBuffer()).catch(() => {});');
  if (variant === 'no-keepalive' || variant === 'both') script = script.replace('keepalive: true', "keepalive: event.type === 'pagehide'");
  const accepted = [], rejected = []; let pings = 0;
  const server = createServer((req, res) => {
    if (req.url.startsWith('/__foundation/events')) {
      const chunks = []; req.on('data', chunk => chunks.push(chunk));
      res.on('finish', () => { const body = Buffer.concat(chunks); (res.statusCode === 202 ? accepted : rejected).push({ bytes: body.length, status: res.statusCode, event: JSON.parse(body) }); });
    }
    void middleware(req, res, () => {
      if (req.url.startsWith('/api/ping')) { pings++; req.resume(); res.writeHead(200).end('ok'); }
      else { res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><html><body><button>Fixture</button><script>${script}</script></body></html>`); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    const failures = []; page.on('requestfailed', request => { if (request.url().includes('/__foundation/events')) failures.push(request.failure()?.errorText); });
    await page.goto(base);
    const statuses = await page.evaluate(async () => {
      const result = [];
      for (let i = 0; i < 500; i++) {
        const response = await fetch('/api/ping?private=excluded', { method: 'POST', body: 'private body' });
        result.push(response.status); await response.text(); await new Promise(resolve => setTimeout(resolve, 5));
      }
      return result;
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    results.push({ variant, baselineVersion, baselineHash, chromium: browser.version(), pings, allPings200: statuses.every(status => status === 200), accepted: accepted.length, acceptedRequests: accepted.filter(value => value.event.type === 'request').length, bytes: accepted.reduce((sum, value) => sum + value.bytes, 0), rejected: rejected.length, failures: failures.length, failureKinds: [...new Set(failures)] });
    console.log(JSON.stringify(results.at(-1)));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
await writeFile(options['--output'] || '/private/tmp/foundation-runtime-transport-baseline-diagnostic.json', JSON.stringify(results, null, 2));
