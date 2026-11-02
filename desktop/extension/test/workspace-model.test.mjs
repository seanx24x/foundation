import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Load the same dependency-free browser model shipped in the native webview.
const modelURL = process.env.FOUNDATION_WORKSPACE_MODEL
  ? new URL(`file://${process.env.FOUNDATION_WORKSPACE_MODEL}`)
  : new URL('../media/workspace-model.js', import.meta.url);
const context = vm.createContext({ module: { exports: {} } });
vm.runInContext(await readFile(modelURL, 'utf8'), context);
const model = context.module.exports;
const plain = value => JSON.parse(JSON.stringify(value));

test('restored inspector widths are finite, bounded, and snapped to the chrome grid', () => {
  assert.equal(model.snapWidth(321), 320);
  assert.equal(model.snapWidth(327), 328);
  assert.equal(model.snapWidth(0), 280);
  assert.equal(model.snapWidth(9999), 480);
  for (const value of [undefined, null, NaN, Infinity, -Infinity, 'untrusted', {}, []]) {
    const width = model.snapWidth(value);
    assert.equal(Number.isFinite(width), true);
    assert.equal(width % 4, 0);
    assert.ok(width >= 280 && width <= 480);
  }
});

test('the actual available container preserves 480px center space before showing an inline inspector', () => {
  const wide = model.resolveLayout(1440, 480);
  assert.equal(wide.compact, false);
  assert.equal(wide.width, 480);
  assert.equal(wide.desired, 480);
  for (const width of [760, 761, 799, 800, 801, 959, 960, 1024]) {
    const result = model.resolveLayout(width, 480);
    assert.equal(result.compact, false, `${width}px has enough space for the minimum inspector`);
    assert.equal(result.width % 4, 0);
    assert.equal(result.max % 4, 0);
    assert.ok(width - result.width >= 480, `${width}px must retain the center minimum`);
    assert.ok(result.width >= 280 && result.width <= result.max);
    assert.equal(result.desired, 480, 'container pressure does not erase the preferred width');
  }
});

test('a narrow layout uses a drawer and widening restores the preferred width', () => {
  for (const width of [0, 360, 480, 700, 759]) {
    const result = model.resolveLayout(width, 448);
    assert.equal(result.compact, true);
    assert.equal(result.desired, 448);
  }
  assert.equal(model.resolveLayout(1280, model.resolveLayout(700, 448).desired).width, 448);
});

test('right inspector resize keys support fine, coarse, minimum, and available maximum movement', () => {
  assert.equal(model.keyboardWidth(320, 'ArrowLeft', false), 324);
  assert.equal(model.keyboardWidth(320, 'ArrowRight', false), 316);
  assert.equal(model.keyboardWidth(320, 'ArrowLeft', true), 352);
  assert.equal(model.keyboardWidth(320, 'ArrowRight', true), 288);
  assert.equal(model.keyboardWidth(320, 'Home', false), 280);
  assert.equal(model.keyboardWidth(320, 'End', false, 400), 400);
  assert.equal(model.keyboardWidth(400, 'ArrowLeft', true, 400), 400);
  assert.equal(model.keyboardWidth(280, 'ArrowRight', true), 280);
  assert.equal(model.keyboardWidth(320, 'Tab', false), null);
  assert.equal(model.keyboardWidth(320, 'Escape', false), null);
});

test('persisted layouts sanitize geometry and do not include unrelated task or source state', () => {
  const output = model.normalizeLayouts({
    'orbit:Refine': { inspectorWidth: 399, source: 'private draft', tokens: { color: 'red' } },
    'orbit:Assistant': { inspectorWidth: 2000 },
  });
  assert.deepEqual(plain(output), {
    'orbit:Refine': { inspectorWidth: 400 },
    'orbit:Assistant': { inspectorWidth: 480 },
  });
  for (const value of [null, undefined, false, 1, 'state']) {
    assert.deepEqual(plain(model.normalizeLayouts(value)), {});
  }
});

test('layout persistence bounds project keys and history', () => {
  const input = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`project-${index}:Refine`, { inspectorWidth: 320 }]));
  input['x'.repeat(301)] = { inspectorWidth: 320 };
  const result = model.normalizeLayouts(input);
  assert.ok(Object.keys(result).length <= 32);
  assert.equal(Object.hasOwn(result, 'x'.repeat(301)), false);
  for (const value of Object.values(result)) assert.equal(value.inspectorWidth, 320);
});
