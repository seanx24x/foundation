import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { chromium } from '@playwright/test';

// Compile the production patch template rather than a duplicate geometry helper.
const source = await readFile(new URL('../patches/foundation-canvas-capture-common.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
assert.equal(compiled.diagnostics?.length || 0, 0);
const exports = {};
vm.runInNewContext(compiled.outputText, { exports }, { filename: 'foundation-canvas-capture-common.js' });
const { foundationCanvasGeometryScript: script } = exports;
const webviewId = '12345678-1234-4234-8234-123456789abc';
const canvas = { x: 20, y: 100, width: 720, height: 360 };
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function outerFixture(t) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  t.after(() => page.close());
  await page.setContent(`<style>html,body{margin:0}.clip{position:absolute;left:100px;top:100px;width:800px;height:600px;overflow:hidden}iframe.webview{position:absolute;left:0;top:-4.32px;width:800px;height:604.32px;border:0}</style><div class="clip"><iframe class="webview" name="${webviewId}" srcdoc="<!doctype html><body>Trusted wrapper</body>"></iframe></div>`);
  await page.locator('iframe.webview').waitFor();
  return page;
}
async function innerFixture(t, delta = 0.75) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  t.after(() => page.close());
  await page.setContent(`<style>html,body{margin:0}#active-frame{position:absolute;left:0;top:0;width:calc(100% - ${delta}px);height:calc(100% - ${delta}px);border:0}</style><iframe id="active-frame"></iframe>`);
  const html = `<style>html,body{margin:0}.runtime-studio{margin:20px}.design-canvas{width:1000px;height:700px;overflow:hidden}.design-viewport{width:960px;height:680px;transform:scale(.75);transform-origin:top left}iframe[data-foundation-runtime-canvas]{width:960px;height:680px;border:0}</style><div class="runtime-studio"><div class="design-canvas"><div class="design-viewport"><iframe data-foundation-runtime-canvas srcdoc="<!doctype html><body>Runtime</body>"></iframe></div></div></div>`;
  await page.locator('#active-frame').evaluate((frame, html) => { frame.srcdoc = html; }, html);
  await page.frameLocator('#active-frame').locator('[data-foundation-runtime-canvas]').waitFor();
  await page.waitForFunction(() => document.querySelector('#active-frame').contentDocument.readyState === 'complete');
  return page;
}

// The Code OSS wrapper can extend above its clipping ancestor while the runtime
// canvas is fully inside. Only the trusted inner canvas becomes the crop region.
test('outer geometry permits the 4.32px clipped wrapper and maps only the visible canvas', async t => {
  const page = await outerFixture(t);
  const result = await page.evaluate(script('outer', webviewId, canvas));
  assert.ok(result.rect.y < 100, 'the fixture really clips the wrapper top');
  assert.deepEqual(result.captureRect, { x: result.rect.x + canvas.x, y: result.rect.y + canvas.y, width: canvas.width, height: canvas.height });
  assert.ok(result.captureRect.y >= 100);
  assert.ok(result.captureRect.y + result.captureRect.height <= 700);
  assert.ok(result.captureRect.width < result.rect.width);
  assert.ok(result.captureRect.height < result.rect.height);
  await assert.rejects(page.evaluate(script('outer', webviewId)), /canvas-unavailable/, 'a wrapper-only crop is never accepted');
});

test('outer geometry rejects actual canvas clipping at an ancestor or viewport', async t => {
  const page = await outerFixture(t);
  for (const bad of [{ ...canvas, y: 0 }, { ...canvas, y: 500 }, { ...canvas, x: 790 }, { ...canvas, x: -1 }, { ...canvas, width: 0 }]) {
    await assert.rejects(page.evaluate(script('outer', webviewId, bad)), /canvas-unavailable/);
  }
  await page.locator('.clip').evaluate(element => { element.style.left = '500px'; element.style.overflow = 'visible'; });
  await assert.rejects(page.evaluate(script('outer', webviewId, canvas)), /canvas-unavailable/, 'a canvas extending past the workbench viewport is rejected');
});

test('outer geometry allows unrelated chrome but rejects small canvas overlays including pointer-events none', async t => {
  const page = await outerFixture(t);
  await page.evaluate(() => {
    const chrome = document.createElement('div'); chrome.id = 'chrome'; chrome.style.cssText = 'position:fixed;left:100px;top:100px;width:800px;height:60px;background:magenta;z-index:100;pointer-events:none'; document.body.append(chrome);
  });
  await page.evaluate(script('outer', webviewId, canvas));
  await page.evaluate(() => {
    const overlay = document.createElement('div'); overlay.id = 'overlay'; overlay.style.cssText = 'position:fixed;left:320px;top:250px;width:8px;height:8px;background:red;z-index:100'; document.body.append(overlay);
  });
  await assert.rejects(page.evaluate(script('outer', webviewId, canvas)), /canvas-unavailable/);
  await page.locator('#overlay').evaluate(element => { element.style.pointerEvents = 'none'; });
  await assert.rejects(page.evaluate(script('outer', webviewId, canvas)), /canvas-unavailable/);
});

test('outer geometry rejects CSS scale or zoom instead of silently scaling inner coordinates', async t => {
  const page = await outerFixture(t);
  for (const selector of ['iframe.webview', '.clip']) {
    await page.locator(selector).evaluate(element => { element.style.transformOrigin = 'top left'; element.style.transform = 'scale(.9995)'; });
    await assert.rejects(page.evaluate(script('outer', webviewId, canvas)), /canvas-unavailable/);
    await page.locator(selector).evaluate(element => { element.style.transform = 'none'; element.style.zoom = '.9995'; });
    await assert.rejects(page.evaluate(script('outer', webviewId, canvas)), /canvas-unavailable/);
    await page.locator(selector).evaluate(element => { element.style.zoom = '1'; });
  }
});

test('inner geometry accepts fractional active-frame sizing without treating rounded viewport dimensions as scale', async t => {
  const page = await innerFixture(t);
  const size = await page.locator('#active-frame').evaluate(element => ({ width: element.getBoundingClientRect().width, viewport: innerWidth }));
  assert.ok(size.viewport - size.width > 0 && size.viewport - size.width <= 1);
  const result = await page.evaluate(script('inner', webviewId));
  assert.deepEqual(result.rect, { x: 20, y: 20, width: 720, height: 510 });
  assert.deepEqual(result.captureRect, result.rect);
  assert.equal(result.viewportWidth, 960);
  assert.equal(result.viewportHeight, 680);
});

test('inner geometry rejects larger active-frame mismatch and actual canvas clipping', async t => {
  const page = await innerFixture(t, 1.25);
  await assert.rejects(page.evaluate(script('inner', webviewId)), /canvas-unavailable/);
  await page.locator('#active-frame').evaluate(element => { element.style.width = '100%'; element.style.height = '100%'; });
  await page.evaluate(script('inner', webviewId));
  await page.frameLocator('#active-frame').locator('.design-canvas').evaluate(element => { element.style.height = '300px'; });
  await assert.rejects(page.evaluate(script('inner', webviewId)), /canvas-unavailable/);
});

test('inner geometry rejects active-frame scale and wrapper overlays even when the inner canvas remains unchanged', async t => {
  const page = await innerFixture(t, 0);
  await page.locator('#active-frame').evaluate(element => { element.style.transformOrigin = 'top left'; element.style.transform = 'scale(.9995)'; });
  await assert.rejects(page.evaluate(script('inner', webviewId)), /canvas-unavailable/);
  await page.locator('#active-frame').evaluate(element => { element.style.transform = 'none'; element.style.zoom = '.9995'; });
  await assert.rejects(page.evaluate(script('inner', webviewId)), /canvas-unavailable/);
  await page.locator('#active-frame').evaluate(element => { element.style.zoom = '1'; });
  await page.evaluate(() => { const overlay = document.createElement('div'); overlay.style.cssText = 'position:fixed;left:123px;top:145px;width:8px;height:8px;background:red;z-index:100;pointer-events:none'; document.body.append(overlay); });
  await assert.rejects(page.evaluate(script('inner', webviewId)), /canvas-unavailable/);
});


test('outer geometry accepts the rectangular zero-inset content-box used by Code OSS', async t => {
  const page = await outerFixture(t);
  await page.locator('.clip').evaluate(element => { element.style.clipPath = 'content-box'; });
  const style = await page.locator('.clip').evaluate(element => {
    const style = getComputedStyle(element);
    return { clip: style.clipPath, padding: style.padding, border: style.borderWidth, radius: style.borderRadius };
  });
  assert.deepEqual(style, { clip: 'content-box', padding: '0px', border: '0px', radius: '0px' });
  const result = await page.evaluate(script('outer', webviewId, canvas));
  assert.deepEqual(result.captureRect, { x: result.rect.x + canvas.x, y: result.rect.y + canvas.y, width: canvas.width, height: canvas.height });
  await assert.rejects(page.evaluate(script('outer', webviewId, { ...canvas, y: 0 })), /canvas-unavailable/, 'content-box support does not admit the clipped wrapper strip');
});

test('content-box accepts only the inset interior and rejects canvas pixels in padding or borders', async t => {
  const page = await outerFixture(t);
  await page.locator('.clip').evaluate(element => {
    element.style.cssText += ';box-sizing:border-box;clip-path:content-box;border:8px solid transparent;padding:20px 24px 28px 32px';
    // The iframe covers the border box so rejected regions are genuinely inside
    // its geometry; only the ancestor content-box excludes them.
    const frame = element.querySelector('iframe'); frame.style.cssText = 'left:-8px;top:-8px;width:800px;height:600px';
  });
  const bounds = await page.locator('.clip').evaluate(element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element), frame = element.querySelector('iframe').getBoundingClientRect();
    const left = box.x + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const top = box.y + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    const right = box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
    const bottom = box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
    return { x: left - frame.x, y: top - frame.y, width: right - left, height: bottom - top, frameWidth: frame.width, frameHeight: frame.height };
  });
  assert.deepEqual(bounds, { x: 40, y: 28, width: 728, height: 536, frameWidth: 800, frameHeight: 600 });
  const interior = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  const result = await page.evaluate(script('outer', webviewId, interior));
  assert.equal(result.captureRect.width, 728); assert.equal(result.captureRect.height, 536);
  for (const [edge, candidate] of [
    ['left padding', { ...interior, x: interior.x - 1 }],
    ['top padding', { ...interior, y: interior.y - 1 }],
    ['right padding', { ...interior, width: interior.width + 1 }],
    ['bottom padding', { ...interior, height: interior.height + 1 }],
    ['left border', { x: 2, y: 200, width: 2, height: 2 }],
    ['top border', { x: 200, y: 2, width: 2, height: 2 }],
    ['right border', { x: 796, y: 200, width: 2, height: 2 }],
    ['bottom border', { x: 200, y: 596, width: 2, height: 2 }],
  ]) await assert.rejects(page.evaluate(script('outer', webviewId, candidate)), /canvas-unavailable/, edge);
});

test('content-box rejects rounded corners and unsupported clip-path shapes even for an interior canvas', async t => {
  const page = await outerFixture(t);
  await page.locator('.clip').evaluate(element => { element.style.clipPath = 'content-box'; element.style.borderRadius = '1px'; });
  await assert.rejects(page.evaluate(script('outer', webviewId, canvas)), /canvas-unavailable/);
  await page.locator('.clip').evaluate(element => { element.style.borderRadius = '0'; });
  await page.evaluate(script('outer', webviewId, canvas));
  for (const clip of ['inset(0px)', 'polygon(0 0, 100% 0, 100% 100%, 0 100%)', 'border-box', 'padding-box']) {
    const actual = await page.locator('.clip').evaluate((element, clip) => { element.style.clipPath = clip; return getComputedStyle(element).clipPath; }, clip);
    assert.notEqual(actual, 'none', 'the browser accepted the unsupported clip fixture');
    await assert.rejects(page.evaluate(script('outer', webviewId, canvas)), /canvas-unavailable/, clip);
  }
});

test('content-box remains unsupported on the scaled inner canvas chain', async t => {
  const page = await innerFixture(t, 0);
  await page.evaluate(script('inner', webviewId));
  await page.frameLocator('#active-frame').locator('.design-canvas').evaluate(element => { element.style.clipPath = 'content-box'; });
  await assert.rejects(page.evaluate(script('inner', webviewId)), /canvas-unavailable/);
});
