import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { buildDesignPreview } from '../src/design-preview.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const file = (path, source) => ({ path, source, revision: createHash('sha256').update(source).digest('hex').slice(0, 12) });
const base = { nonce: 'preview-test-nonce', session: 'preview-test-session', runtimeSource: 'window.FoundationPreviewRuntime = { start() {}, packages: {} };' };
const make = (sources, options = {}) => buildDesignPreview({ ...base, files: sources.map(([path, source]) => file(path, source)), ...options });

test('React preview compiles only its reachable client modules and records exact source revisions', () => {
  const result = make([
    ['src/App.tsx', "import { Save } from './Save'; import './styles.css'; export default function App() { return <Save/>; }"],
    ['src/Save.tsx', "export function Save() { return <button data-foundation-source=\"src/Save.tsx\">Save</button>; }"],
    ['src/styles.css', ':root { --space: 24px; } button { padding: var(--space); }'],
    ['unused.ts', 'import fs from "node:fs";'],
  ]);
  assert.deepEqual(result.files.map(item => item.path), ['src/App.tsx', 'src/Save.tsx', 'src/styles.css']);
  assert.deepEqual(result.mappings, ['src/App.tsx', 'src/Save.tsx']);
  assert.equal(result.capabilities.network, false);
  assert.equal(result.capabilities.sourceMapping, 'explicit');
  assert.match(result.html, /connect-src 'none'/);
  assert.match(result.html, /form-action 'none'/);
  assert.match(result.html, /react\/jsx-runtime/);
  assert.doesNotMatch(result.html, /node:fs/);
  assert.doesNotMatch(result.html, /unsafe-eval|new Function\(/);
});

test('React sandbox rejects missing or executable build dependencies and malformed source', () => {
  for (const [source, pattern] of [
    ['import x from "node:fs"; export default x;', /supports React and local source/],
    ['import x from "./missing"; export default x;', /cannot resolve/],
    ['export default () => import("./Lazy");', /dynamic imports/],
    ['const key = "react"; export default require(key);', /dynamic require/],
    ['export default import.meta.env;', /import.meta/],
    ['export default () => <div>broken</span>;', /src\/App.tsx/],
  ]) assert.throws(() => make([['src/App.tsx', source]]), pattern);
  assert.throws(() => make([['src/App.tsx', 'import "./styles.css"; export default () => null;'], ['src/styles.css', '@import "https://example.test/styles.css";']]), /CSS @import/);
  assert.throws(() => make([['src/App.tsx', 'import "../../escape.ts"; export default () => null;']]), /outside this project/);
});

test('preview markup cannot escape script or style elements and rejects oversized input', () => {
  const result = make([
    ['src/App.tsx', 'import "./style.css"; export default () => <div>{"</script><script>window.injected=true</script>"}</div>;'],
    ['src/style.css', '/* </style><script>window.injected=true</script> */ body { color: black; }'],
  ]);
  assert.equal((result.html.match(/<script nonce=/g) || []).length, 2);
  assert.equal((result.html.split('</style>')[1].match(/<\/script>/g) || []).length, 2);
  assert.equal((result.html.match(/<\/style>/g) || []).length, 1);
  assert.throws(() => make([['../bad.tsx', 'export default () => null;']]), /saved UTF-8/);
  assert.throws(() => make([['src/App.tsx', 'x'.repeat(513 * 1024)]]), /512 KiB/);
  assert.throws(() => make([['src/App.tsx', 'export default () => null;']], { nonce: "bad'nonce" }), /nonce/);
});

test('sandbox runs real Orbit, measures explicit mappings, isolates origin and applies scoped token experiments', async t => {
  const runtimeSource = await readFile(new URL('../media/preview-runtime.js', import.meta.url), 'utf8');
  const paths = ['src/App.tsx', 'src/components/ProfileForm.tsx', 'src/components/SaveButton.tsx', 'src/api/profile.ts', 'src/styles/profile.css', 'src/styles/tokens.css'];
  const files = await Promise.all(paths.map(async path => file(path, await readFile(`${root}/projects/orbit/${path}`, 'utf8'))));
  const result = buildDesignPreview({ ...base, runtimeSource, files });
  const host = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${base.nonce}'; style-src 'nonce-${base.nonce}'; frame-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none';"><style nonce="${base.nonce}">body{margin:0}iframe{width:100%;height:900px;border:0}</style></head><body><iframe id="preview" title="React sandbox" sandbox="allow-scripts allow-forms"></iframe><script nonce="${base.nonce}">window.events=[];window.addEventListener('message',event=>{if(event.source===document.getElementById('preview').contentWindow)window.events.push(event.data)});document.getElementById('preview').srcdoc=${JSON.stringify(result.html).replaceAll('<', '\\u003c')};</script></body></html>`;
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(host); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  const externalRequests = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:')) externalRequests.push(request.url()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const frame = page.frameLocator('#preview');
  await frame.getByRole('heading', { name: 'Your profile' }).waitFor();
  await page.waitForFunction(() => window.events.some(event => event.type === 'ready'));
  assert.equal(await page.locator('#preview').evaluate(element => element.contentDocument), null, 'sandbox is an opaque origin');
  const settings = async data => page.evaluate(({ data, session }) => document.getElementById('preview').contentWindow.postMessage({ channel: 'foundation-design', session, type: 'settings', ...data }, '*'), { data, session: base.session });
  await settings({ theme: 'light', inspect: true, tokens: [] });
  await frame.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForFunction(() => window.events.some(event => event.type === 'selection'));
  let selected = await page.evaluate(() => window.events.filter(event => event.type === 'selection').at(-1));
  assert.equal(selected.selection.path, 'src/components/SaveButton.tsx');
  assert.ok(selected.selection.rect.width > 0 && selected.selection.rect.height > 0);
  assert.equal(selected.selection.styles.backgroundColor, 'rgb(52, 103, 78)');
  await settings({ theme: 'light', inspect: true, tokens: [{ name: '--orbit-green', value: '#113355', scope: ":root[data-theme='dark']" }] });
  await page.waitForFunction(() => window.events.filter(event => event.type === 'settingsApplied').length >= 2);
  assert.equal(await frame.getByRole('button', { name: 'Save changes' }).evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(52, 103, 78)', 'dark declaration leaves light canvas unchanged');
  await settings({ theme: 'dark', inspect: true, tokens: [{ name: '--orbit-green', value: '#113355', scope: ":root[data-theme='dark']" }] });
  await page.waitForFunction(() => window.events.some(event => event.type === 'settingsApplied' && event.theme === 'dark'));
  assert.equal(await frame.getByRole('button', { name: 'Save changes' }).evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(17, 51, 85)');
  await settings({ theme: 'light', inspect: false, tokens: [] });
  await page.waitForFunction(() => window.events.some(event => event.type === 'settingsApplied' && event.inspect === false));
  await page.setViewportSize({ width: 375, height: 950 });
  assert.equal(await frame.locator('html').evaluate(element => element.scrollWidth <= innerWidth), true);
  await frame.getByRole('button', { name: 'Save changes' }).click();
  await frame.getByRole('status').filter({ hasText: /failed|fetch|URL/i }).waitFor({ timeout: 3000 });
  const fetched = await frame.locator('html').evaluate(async () => {
    try { await fetch('https://foundation-network-must-stay-blocked.invalid/'); return true; }
    catch { return false; }
  });
  assert.equal(fetched, false);
  assert.deepEqual(externalRequests, [], 'network remains blocked; no simulated backend success');

  const renderFailure = buildDesignPreview({ ...base, runtimeSource, files: [file('src/App.tsx', 'export default function App() { throw new Error("Preview render failed"); }')] });
  await page.evaluate(html => { window.events = []; document.getElementById('preview').srcdoc = html; }, renderFailure.html);
  await frame.getByRole('alert').filter({ hasText: 'Preview render failed' }).waitFor();
  await page.waitForFunction(() => window.events.some(event => event.type === 'error'));
  assert.equal(await page.evaluate(() => window.events.some(event => event.type === 'ready')), false, 'a failed React render never claims ready');

  const unmapped = buildDesignPreview({ ...base, runtimeSource, files: [file('src/App.tsx', 'export default () => <button data-foundation-source="../../outside.tsx">Unknown target</button>;')] });
  await page.evaluate(html => { window.events = []; document.getElementById('preview').srcdoc = html; }, unmapped.html);
  await page.waitForFunction(() => window.events.some(event => event.type === 'ready'));
  await settings({ theme: 'light', inspect: true });
  await page.waitForFunction(() => window.events.some(event => event.type === 'settingsApplied'));
  await frame.getByRole('button', { name: 'Unknown target' }).click();
  await page.waitForFunction(() => window.events.some(event => event.type === 'unmapped'));
  assert.equal(await page.evaluate(() => window.events.some(event => event.type === 'selection')), false, 'unvalidated mapping cannot become source selection');
});
