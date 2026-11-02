import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { chromium } from '@playwright/test';
import { patchCanvasCaptureNative, patchCanvasCaptureContract, patchCanvasCaptureContribution } from '../scripts/patch-canvas-capture.mjs';

const source = {};
for (const name of ['common', 'native', 'workbench']) source[name] = await readFile(new URL(`../patches/foundation-canvas-capture-${name}.ts`, import.meta.url), 'utf8');
function moduleValue(name, dependencies = {}) {
  const output = ts.transpileModule(source[name], { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  assert.equal(output.diagnostics?.length || 0, 0);
  const exports = {};
  vm.runInNewContext(output.outputText, { exports, Buffer, URL, setTimeout, clearTimeout, require: key => {
    if (Object.hasOwn(dependencies, key)) return dependencies[key];
    throw new Error(`Unexpected import ${key}`);
  } }, { filename: `${name}.js` });
  return exports;
}
const common = moduleValue('common');
const native = moduleValue('native', { '../common/foundationCanvasCapture.js': common });
const identity = { session: '1'.repeat(32), viewId: '2'.repeat(32), documentId: '3'.repeat(32), pageVersion: 7, route: '/profile', nonce: '4'.repeat(32) };
const webviewId = '12345678-1234-4234-8234-123456789abc';
const copy = value => JSON.parse(JSON.stringify(value));
const baseWitness = () => ({ nonce: identity.nonce, session: identity.session, viewId: identity.viewId, documentId: identity.documentId, pageSequence: 2, route: identity.route,
  ready: true, inspect: false, viewportWidth: 960, viewportHeight: 680, devicePixelRatio: 2, scrollX: 0, scrollY: 0, requestedTheme: 'light', observedColorScheme: 'dark', reducedMotion: false });
function fixture() {
  const outer = { rect: { x: 200.25, y: 80.25, width: 700, height: 600 }, frameName: webviewId, url: 'vscode-webview://trusted/index.html', viewportWidth: 700, viewportHeight: 600 };
  const inner = { rect: { x: 20.5, y: 100.5, width: 480, height: 340 }, frameName: '', url: 'http://127.0.0.1:4173/profile?__foundation_view=' + identity.viewId, viewportWidth: 960, viewportHeight: 680 };
  inner.captureRect = { ...inner.rect };
  const state = { witness: baseWitness(), outer, inner, captures: [], hidden: false, focused: true, zoom: 1, afterCapture: undefined, afterWitness: undefined, evaluations: [] };
  let witnessCount = 0;
  const frame = (url, routingId) => ({ url, routingId, processId: 1, detached: false, isDestroyed: () => false, frames: [] });
  const main = frame('file:///workbench.html', 1), wrapper = frame(outer.url, 2), content = frame('vscode-webview://trusted/fake.html', 3), runtime = frame(inner.url, 4);
  wrapper.name = webviewId; wrapper.parent = main; content.parent = wrapper; runtime.parent = content;
  main.frames = [wrapper]; wrapper.frames = [content]; content.frames = [runtime]; main.framesInSubtree = [main, wrapper, content, runtime];
  main.executeJavaScript = async script => { state.evaluations.push(script); return copy({ ...state.outer, captureRect: { x: state.outer.rect.x + state.inner.rect.x, y: state.outer.rect.y + state.inner.rect.y, width: state.inner.rect.width, height: state.inner.rect.height } }); };
  wrapper.executeJavaScript = async script => { state.evaluations.push(script); return copy(state.inner); };
  runtime.executeJavaScript = async script => { state.evaluations.push(script); if (++witnessCount === 2) state.afterWitness?.(); return copy(state.witness); };
  const png = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.write('IHDR', 12, 'ascii'); png.writeUInt32BE(958, 16); png.writeUInt32BE(678, 20);
  const image = { isEmpty: () => false, toPNG: () => png };
  const contents = { mainFrame: main, isDestroyed: () => false, getZoomFactor: () => state.zoom, capturePage: async (rect, options) => {
    state.captures.push({ ...rect, options }); state.afterCapture?.(); return image;
  } };
  const window = { webContents: contents, isDestroyed: () => false, isVisible: () => !state.hidden, isMinimized: () => false, isFocused: () => state.focused };
  return { state, window, main, wrapper, content, runtime, image, png, capture: input => native.captureFoundationCanvas(window, input || { identity, webviewId }) };
}

test('public identity rejects rectangle/window/selector/script and malformed ownership values', () => {
  assert.equal(common.validFoundationCaptureIdentity(identity), true);
  for (const bad of [null, [], { ...identity, rect: {} }, { ...identity, windowId: 1 }, { ...identity, selector: 'body' }, { ...identity, script: 'process.exit()' },
    { ...identity, nonce: 'bad' }, { ...identity, documentId: 'bad' }, { ...identity, pageVersion: 0 }, { ...identity, route: '/profile?secret=x' }, { ...identity, route: '/__foundation/snapshot' }, { ...identity, route: '/../private' }]) {
    assert.equal(common.validFoundationCaptureIdentity(bad), false);
  }
});

test('runtime witness requires exact fresh document and bounded observed conditions', () => {
  assert.equal(common.validFoundationCaptureWitness(baseWitness(), identity), true);
  for (const patch of [{ inspect: true }, { ready: false }, { pageSequence: 0 }, { viewportWidth: 0 }, { viewportHeight: 4097 }, { devicePixelRatio: Infinity },
    { scrollX: 1e9 }, { requestedTheme: 'auto' }, { observedColorScheme: 'unknown' }, { documentId: '5'.repeat(32) }, { nonce: '5'.repeat(32) }, { extra: true }]) {
    assert.equal(common.validFoundationCaptureWitness({ ...baseWitness(), ...patch }, identity), false);
  }
});

test('native bridge captures an inward crop of actual compositor pixels and returns PNG provenance', async () => {
  const f = fixture(), result = await f.capture();
  assert.deepEqual(copy(f.state.captures), [{ x: 222, y: 182, width: 477, height: 337, options: { stayHidden: true } }]);
  assert.deepEqual(copy(result.identity), identity);
  assert.equal(result.pngBase64, f.png.toString('base64'));
  assert.equal(result.conditions.canvasScale, 0.5);
  assert.equal(result.conditions.pixelWidth, 958);
  assert.equal(result.conditions.pixelHeight, 678);
  assert.equal(result.conditions.requestedTheme, 'light');
  assert.equal(result.conditions.observedColorScheme, 'dark', 'request is not falsely treated as app-observed theme');
  assert.ok(!f.state.evaluations.some(script => script.includes('capturePage') || script.includes('toDataURL')));
});

test('capture crop respects workbench zoom without returning whole-window images', async () => {
  const f = fixture(); f.state.zoom = 1.5; await f.capture();
  assert.deepEqual(copy(f.state.captures[0]), { x: 333, y: 273, width: 717, height: 507, options: { stayHidden: true } });
});

test('fractional frame viewport rounding is bounded and does not become a scale correction', async () => {
  const f = fixture(); f.state.witness.viewportWidth++; f.state.witness.viewportHeight++;
  const result = await f.capture();
  assert.equal(result.conditions.viewportWidth, 961);
  assert.equal(result.conditions.viewportHeight, 681);
  assert.equal(result.conditions.canvasScale, 0.5);
  const invalid = fixture(); invalid.state.witness.viewportWidth += 2;
  await assert.rejects(invalid.capture(), /capture-unavailable/);
  assert.equal(invalid.state.captures.length, 0);
});

test('native derives outer canvas scope from trusted inner geometry, including the post-capture check', async () => {
  const f = fixture(); await f.capture();
  const scripts = f.state.evaluations.filter(script => script.includes('})("outer"'));
  assert.equal(scripts.length, 2);
  assert.ok(scripts.every(script => script.endsWith(`,${JSON.stringify(f.state.inner.rect)})`)));
});

for (const [name, change] of [
  ['hidden window', f => { f.state.hidden = true; }], ['unfocused window', f => { f.state.focused = false; }],
  ['foreign wrapper', f => { f.wrapper.url = 'https://example.test/'; }], ['nested spoof wrapper', f => { f.wrapper.parent = f.content; }],
  ['duplicate wrapper', f => { f.main.framesInSubtree.push(f.wrapper); }], ['ambiguous content frame', f => { f.wrapper.frames.push(f.runtime); }],
  ['ambiguous runtime frame', f => { f.content.frames.push(f.runtime); }], ['foreign runtime URL', f => { f.runtime.url = 'https://example.test/profile'; }],
  ['wrong route', f => { f.runtime.url = 'http://127.0.0.1:4173/private'; }], ['inspect overlay', f => { f.state.witness.inspect = true; }],
  ['viewport mismatch', f => { f.state.witness.viewportWidth = 390; }], ['clipped canvas', f => { f.state.inner.rect.x = 500; }],
]) test(`native bridge rejects ${name} before any pixel capture`, async () => {
  const f = fixture(); change(f); await assert.rejects(f.capture(), /capture-unavailable/); assert.equal(f.state.captures.length, 0);
});

for (const [name, change] of [
  ['document navigation', f => { f.state.witness.documentId = '5'.repeat(32); }], ['route ABA', f => { f.state.witness.pageSequence++; }],
  ['scroll change', f => { f.state.witness.scrollY++; }], ['geometry move', f => { f.state.outer.rect.x++; }], ['canvas resize', f => { f.state.inner.rect.width--; }],
  ['frame replacement', f => { f.runtime.routingId++; }], ['zoom change', f => { f.state.zoom = 1.1; }], ['window hides', f => { f.state.hidden = true; }],
]) test(`capture discards pixels after ${name}`, async () => {
  const f = fixture(); f.state.afterCapture = () => change(f); await assert.rejects(f.capture(), /capture-unavailable/); assert.equal(f.state.captures.length, 1);
});

test('native bridge rejects empty, oversized or malformed compositor output', async () => {
  for (const alter of [f => { f.image.isEmpty = () => true; }, f => { f.image.toPNG = () => Buffer.alloc(9 * 1024 * 1024); }, f => { f.png.writeUInt32BE(9000, 16); }, f => { f.png[0] = 0; }]) {
    const f = fixture(); alter(f); await assert.rejects(f.capture(), /capture-unavailable/);
  }
});

test('same-window concurrent captures are rejected and failure releases the reservation', async () => {
  const f = fixture(); let release;
  f.window.webContents.capturePage = async () => { await new Promise(resolve => { release = resolve; }); return f.image; };
  const first = f.capture();
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  await assert.rejects(f.capture(), /capture-unavailable/); release(); await first;
  f.window.webContents.capturePage = async () => f.image; await f.capture();
});

test('patch seams are exact, fail closed on upstream drift, and add no broad screenshot command', () => {
  const nativeSource = "import * as fs from 'fs';\n\t//#region Screenshots";
  const contractSource = "import { VSBuffer } from '../../../base/common/buffer.js';\n\tgetScreenshot(rect?: IRectangle): Promise<VSBuffer | undefined>;";
  const contribution = "import { ElectronWebviewService } from './webviewService.js';";
  assert.match(patchCanvasCaptureNative(nativeSource), /getWindowById\(windowId\)/);
  assert.match(patchCanvasCaptureContract(contractSource), /captureFoundationCanvas/);
  assert.match(patchCanvasCaptureContribution(contribution), /foundationCanvasCapture/);
  for (const [patch, original] of [[patchCanvasCaptureNative, nativeSource], [patchCanvasCaptureContract, contractSource], [patchCanvasCaptureContribution, contribution]]) {
    assert.throws(() => patch('changed upstream'), /re-audit/);
    assert.throws(() => patch(original + original), /re-audit/);
    assert.throws(() => patch(patch(original)), /re-audit/);
  }
});

test('workbench command binds only the owned concrete view and rejects a replaced view after capture', async () => {
  let handler, calls = 0, mutate = () => {}; const diagnostics = [];
  const window = {}, element = { isConnected: true, name: webviewId, getBoundingClientRect: () => ({ width: 600, height: 500, toJSON: () => ({ x: 0, y: 0, width: 600, height: 500 }) }) };
  const view = { extension: { id: { value: 'foundation.foundation-workspace' } }, providedViewType: 'foundation.workspace', element };
  const service = { webviews: [view] }, nativeService = { captureFoundationCanvas: async input => { calls++; assert.deepEqual(copy(input), { identity, webviewId }); mutate(); return { pngBase64: 'encoded' }; } };
  moduleValue('workbench', {
    '../../../../base/browser/dom.js': { getWindow: () => window }, '../../../../base/browser/window.js': { mainWindow: window },
    '../../../../platform/commands/common/commands.js': { CommandsRegistry: { registerCommand: (id, value) => { assert.equal(id, '_foundation.captureActiveCanvas'); handler = value; } } },
    '../../../../platform/log/common/log.js': { ILogService: 'log' },
    '../../../../platform/native/common/native.js': { INativeHostService: 'native' }, '../../../../platform/native/common/foundationCanvasCapture.js': common,
    '../browser/webview.js': { IWebviewService: 'webviews' }, '../../../../nls.js': { localize: (_key, message) => message },
  });
  const accessor = { get: key => key === 'native' ? nativeService : key === 'log' ? { warn: text => diagnostics.push(text) } : service };
  await handler(accessor, identity); assert.equal(calls, 1);
  view.extension.id.value = 'foreign.extension'; await assert.rejects(handler(accessor, identity), /could not capture/); assert.equal(calls, 1);
  view.extension.id.value = 'foundation.foundation-workspace'; mutate = () => { service.webviews = []; };
  await assert.rejects(handler(accessor, identity), /could not capture/); assert.equal(calls, 2);
  service.webviews = [view];
  const realmError = await handler.constructor('return new Error("foundation-canvas-capture-unavailable:geometry-outer")')();
  nativeService.captureFoundationCanvas = async () => { throw realmError; };
  await assert.rejects(handler(accessor, identity), /could not capture/);
  realmError.message = 'PRIVATE_RUNTIME_SECRET arbitrary thrown data';
  await assert.rejects(handler(accessor, identity), /could not capture/);
  assert.deepEqual(diagnostics, ['[Foundation canvas capture] unavailable', '[Foundation canvas capture] geometry-outer', '[Foundation canvas capture] unavailable']);
});

test('workbench capture failure retains services before the accessor expires at the await boundary', async () => {
  let handler, accessorLive = true, failure; const diagnostics = [];
  const window = {}, element = { isConnected: true, name: webviewId, getBoundingClientRect: () => ({ width: 600, height: 500, toJSON: () => ({ x: 0, y: 0, width: 600, height: 500 }) }) };
  const view = { extension: { id: { value: 'foundation.foundation-workspace' } }, providedViewType: 'foundation.workspace', element };
  const services = {
    webviews: { webviews: [view] }, log: { warn: text => diagnostics.push(text) },
    native: { captureFoundationCanvas: async () => { await Promise.resolve(); accessorLive = false; throw failure; } },
  };
  moduleValue('workbench', {
    '../../../../base/browser/dom.js': { getWindow: () => window }, '../../../../base/browser/window.js': { mainWindow: window },
    '../../../../platform/commands/common/commands.js': { CommandsRegistry: { registerCommand: (_id, value) => { handler = value; } } },
    '../../../../platform/log/common/log.js': { ILogService: 'log' }, '../../../../platform/native/common/native.js': { INativeHostService: 'native' },
    '../../../../platform/native/common/foundationCanvasCapture.js': common, '../browser/webview.js': { IWebviewService: 'webviews' },
    '../../../../nls.js': { localize: (_key, message) => message },
  });
  const accessor = { get: key => { assert.equal(accessorLive, true, 'a command accessor cannot be used after await'); return services[key]; } };
  for (const message of ['foundation-canvas-capture-unavailable:geometry-inner', 'PRIVATE_RUNTIME_SECRET arbitrary callback text']) {
    accessorLive = true;
    failure = await handler.constructor('message', 'return new Error(message)')(message);
    await assert.rejects(handler(accessor, identity), error => {
      assert.equal(error.message, 'Foundation could not capture this canvas. Keep the running preview visible, unobstructed, and unchanged, then try again.');
      return true;
    });
  }
  assert.deepEqual(diagnostics, ['[Foundation canvas capture] geometry-inner', '[Foundation canvas capture] unavailable']);
});

test('trusted geometry script rejects small overlay, transparent-pointer overlay, clipping and spoof canvas', async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const html = `<style>html,body{margin:0}iframe{border:0}.runtime-studio{margin:20px}.design-canvas{width:1000px;height:700px;overflow:hidden}.design-viewport{width:960px;height:680px;transform:scale(.75);transform-origin:top left}iframe[data-foundation-runtime-canvas]{width:960px;height:680px}</style><div class="runtime-studio"><div class="design-canvas"><div class="design-viewport"><iframe data-foundation-runtime-canvas src="http://127.0.0.1:4173/profile"></iframe></div></div></div>`;
  await page.setContent('<style>html,body{margin:0}#active-frame{position:absolute;inset:0;width:100%;height:100%;border:0}</style><iframe id="active-frame"></iframe>');
  await page.locator('#active-frame').evaluate((frame, html) => { frame.srcdoc = html; }, html);
  await page.frameLocator('#active-frame').locator('[data-foundation-runtime-canvas]').waitFor();
  const script = common.foundationCanvasGeometryScript('inner', webviewId);
  const result = await page.evaluate(script);
  assert.deepEqual(result.rect, { x: 20, y: 20, width: 720, height: 510 });
  const frame = page.frames().find(item => item.parentFrame() === page.mainFrame());
  await frame.evaluate(() => { const overlay = document.createElement('div'); overlay.id = 'overlay'; overlay.style.cssText = 'position:fixed;left:123px;top:145px;width:8px;height:8px;background:red;z-index:100'; document.body.append(overlay); });
  await assert.rejects(page.evaluate(script), /canvas-unavailable/);
  await frame.locator('#overlay').evaluate(element => { element.style.pointerEvents = 'none'; });
  await assert.rejects(page.evaluate(script), /canvas-unavailable/);
  await frame.locator('#overlay').evaluate(element => element.remove());
  await frame.locator('.design-canvas').evaluate(element => { element.style.height = '300px'; });
  await assert.rejects(page.evaluate(script), /canvas-unavailable/);
  await frame.locator('.design-canvas').evaluate(element => { element.style.height = '700px'; });
  await frame.locator('[data-foundation-runtime-canvas]').evaluate(element => element.after(element.cloneNode()));
  await assert.rejects(page.evaluate(script), /canvas-unavailable/);
});
