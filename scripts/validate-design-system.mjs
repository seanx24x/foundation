import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(fs.readFileSync(path.join(root, 'design/foundation.tokens.json'), 'utf8'));
const errors = [];
const assert = (condition, message) => { if (!condition) errors.push(message); };
const isGrid = value => Number.isFinite(value) && value >= 0 && value % tokens.grid === 0;
function checkGeometry(value, name) {
  if (typeof value === 'number') assert(isGrid(value), `${name} must be a nonnegative 4px multiple`);
  else for (const [key, next] of Object.entries(value)) checkGeometry(next, `${name}.${key}`);
}
for (const name of ['space', 'radius', 'density', 'layout', 'icon']) checkGeometry(tokens[name], name);
for (const [name, shadow] of Object.entries(tokens.shadow)) {
  for (const key of ['x', 'y', 'blur', 'spread']) assert(isGrid(shadow[key]), `shadow.${name}.${key} must use the grid`);
  for (const key of ['lightOpacity', 'darkOpacity']) assert(shadow[key] >= 0 && shadow[key] <= 1, `shadow.${name}.${key} must be a valid opacity`);
}
assert(tokens.stroke.divider === 1 && tokens.stroke.focus === 2 && tokens.stroke.iconDense === 1.5, 'Optical stroke exceptions must stay explicit');
for (const [name, type] of Object.entries(tokens.typography)) {
  assert(isGrid(type.line), `typography.${name}.line must be a 4px multiple`);
  assert(type.size >= 12, `typography.${name} is below the metadata floor`);
  assert(type.line > type.size, `typography.${name} needs a readable line box`);
  assert(tokens.font.weights.includes(type.weight), `typography.${name} has an unapproved weight`);
}
for (const region of ['navigator', 'inspector', 'assistant', 'bottom']) {
  const value = tokens.layout[region];
  assert(value.min <= value.default && value.default <= value.max, `layout.${region} default exceeds its bounds`);
}
assert(JSON.stringify(Object.keys(tokens.color.light).sort()) === JSON.stringify(Object.keys(tokens.color.dark).sort()), 'Theme semantic keys must match');
function luminance(hex) {
  assert(/^#[0-9A-F]{6}$/i.test(hex), `Invalid opaque sRGB color ${hex}`);
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
const results = [];
for (const [theme, colors] of Object.entries(tokens.color)) {
  for (const pair of tokens.contrastPairs) {
    const first = luminance(colors[pair.foreground]);
    const second = luminance(colors[pair.background]);
    const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    assert(ratio >= pair.minimum, `${theme} ${pair.foreground} / ${pair.background}: ${ratio.toFixed(3)} < ${pair.minimum}`);
    results.push({ theme, ...pair, ratio: Number(ratio.toFixed(4)), passed: ratio >= pair.minimum });
  }
}
const report = {
  version: tokens.version,
  scope: 'Token geometry, theme parity, and declared opaque sRGB contrast pairs. This is not a complete app accessibility audit.',
  checkedPairs: results.length,
  passed: errors.length === 0,
  errors, results,
};
if (process.argv.includes('--write')) {
  const target = path.join(root, 'artifacts/design-system-v1');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  const property = name => `--f-${name.replaceAll('.', '-')}`;
  const lines = ['/* Generated from design/foundation.tokens.json; do not hand-edit. */', ':root {'];
  for (const value of tokens.space) lines.push(`  --f-space-${value}: ${value}px;`);
  for (const [name, value] of Object.entries(tokens.radius)) lines.push(`  --f-radius-${name}: ${value}px;`);
  for (const [name, type] of Object.entries(tokens.typography)) {
    lines.push(`  --f-type-${name}-size: ${type.size}px;`, `  --f-type-${name}-line: ${type.line}px;`, `  --f-type-${name}-weight: ${type.weight};`);
  }
  lines.push('}');
  for (const [theme, colors] of Object.entries(tokens.color)) {
    lines.push(`[data-theme="${theme}"] {`, `  color-scheme: ${theme};`);
    for (const [name, value] of Object.entries(colors)) lines.push(`  ${property(name)}: ${value};`);
    lines.push('}');
  }
  for (const [density, dimensions] of Object.entries(tokens.density)) {
    lines.push(`[data-density="${density}"] {`);
    for (const [name, value] of Object.entries(dimensions)) lines.push(`  --f-density-${name}: ${value}px;`);
    lines.push('}');
  }
  fs.writeFileSync(path.join(target, 'foundation.css'), lines.join('\n') + '\n');
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Foundation v${tokens.version}: geometry and theme parity pass; ${results.length} contrast pairs pass.`);
