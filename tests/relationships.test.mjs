import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createProjectService, projectRevision } from '../server/project/workspace.mjs';
import { analyzeRelationships } from '../server/project/relationships.mjs';

const analyze = (sources, anchorPath, options = {}) => analyzeRelationships({ projectId: 'fixture', anchorPath,
  files: Object.entries(sources).map(([path, source]) => ({ path, source, revision: projectRevision(source) })), ...options });
const edges = (result, kind) => result.edges.filter(edge => edge.kind === kind);
async function fixture(t, sources) {
  const root = await mkdtemp('/private/tmp/foundation-relationships-');
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, source] of Object.entries(sources)) { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), source); }
  const service = createProjectService({ root }), project = await service.open(root);
  return { root, service, project, id: project.id, write: async (path, source) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), source); } };
}

const BASIC = {
  'src/Button.tsx': "export interface ButtonProps { label: string }\nexport function Button(props: ButtonProps) { return <button>{props.label}</button>; }\n",
  'src/api.ts': "export const save = () => fetch('/api/profile?private=excluded', {method:'POST'});\n",
  'src/index.ts': "export { Button as Primary, type ButtonProps as Props } from './Button';\n",
  'src/App.tsx': "import { Primary as Action, type Props } from './index';\nimport { save as submit } from './api';\nimport './styles.css';\nexport function App(props: Props) { submit(); return <Action label={props.label}/>; }\n",
  'src/styles.css': ':root { color: red; }\n',
};

test('focused source relationships follow aliases and re-exports with exact source evidence', async () => {
  const result = await analyze(BASIC, 'src/Button.tsx');
  const render = edges(result, 'render'); assert.equal(render.length, 1);
  assert.deepEqual(render[0].from, { path: 'src/App.tsx', line: 4, column: 55, revision: projectRevision(BASIC['src/App.tsx']), label: 'Action' });
  assert.equal(render[0].to.path, 'src/Button.tsx'); assert.equal(render[0].to.line, 2); assert.equal(render[0].to.label, 'Button');
  assert.ok(edges(result, 're-export').some(edge => edge.from.path === 'src/index.ts'));
  assert.ok(edges(result, 'type-reference').some(edge => edge.from.path === 'src/App.tsx' && edge.to.label === 'ButtonProps'));
  assert.ok(result.edges.every(edge => edge.from.path === result.anchor.path || edge.to.path === result.anchor.path));
  assert.ok(result.edges.every(edge => edge.provenance === 'source' && edge.from.line >= 1 && edge.to.line >= 1));
  assert.deepEqual(result.manifest.map(item => item.path), Object.keys(BASIC).sort((a, b) => a.localeCompare(b)));
  assert.equal(result.requests.length, 0); assert.equal(result.truncated, false);
  assert.doesNotMatch(JSON.stringify(result), /private=excluded|return <button>|color: red/);
});

test('choosing a new anchor exposes only its imports, stylesheet links and static calls', async () => {
  const app = await analyze(BASIC, 'src/App.tsx');
  assert.equal(edges(app, 'stylesheet')[0].to.path, 'src/styles.css');
  assert.equal(edges(app, 'call')[0].from.label, 'submit'); assert.equal(edges(app, 'call')[0].to.label, 'save');
  const css = await analyze(BASIC, 'src/styles.css');
  assert.equal(edges(css, 'stylesheet')[0].from.path, 'src/App.tsx');
  assert.ok(css.boundaries.some(item => item.path === 'src/styles.css' && item.kind === 'unsupported'));
  assert.equal(css.requests.length, 0);
});

test('lexical shadowing does not turn parameters or unrelated local bindings into imported component/call edges', async () => {
  const result = await analyze({ ...BASIC, 'src/Shadow.tsx': "import {Button} from './Button';\nimport {save} from './api';\nexport function Shadow(Button:any, save:any) { save(); return <Button/>; }\n" }, 'src/Button.tsx');
  assert.ok(edges(result, 'import').some(edge => edge.from.path === 'src/Shadow.tsx'));
  assert.equal(edges(result, 'render').some(edge => edge.from.path === 'src/Shadow.tsx'), false);
  const api = await analyze({ 'api.ts': 'export const save=()=>1;', 'use.ts': "import {save} from './api'; export function local(save:()=>number) { save(); }" }, 'api.ts');
  assert.equal(edges(api, 'call').length, 0);
});

test('namespace imports, immutable local aliases and one-path wildcard exports retain proved targets', async () => {
  const result = await analyze({
    'Button.tsx': 'export function Button(){return <button/>;} export const save=()=>1;',
    'barrel.ts': "export * from './Button';",
    'App.tsx': "import * as UI from './barrel'; import {save as original} from './barrel'; const alias=original; export function App(){alias();UI.save();return <UI.Button/>;}",
  }, 'Button.tsx');
  assert.equal(edges(result, 'render').length, 1); assert.equal(edges(result, 'call').length, 2);
  assert.ok(edges(result, 'call').every(edge => edge.to.label === 'save'));
});

test('mutable function bindings, reassigned declarations, object methods and anonymous callbacks are not invented as static targets', async () => {
  const result = await analyze({ 'App.ts': 'let mutable=()=>1; mutable(); function changed(){return 1;} changed=()=>2; changed(); const object={run(){}};object.run(); [1].map(value=>value); const stable=()=>1;stable();' }, 'App.ts');
  assert.deepEqual(edges(result, 'call').map(edge => edge.to.label), ['stable']);
  assert.ok(result.boundaries.some(item => item.kind === 'unsupported' && /object-member/.test(item.detail)));
});

test('ambiguous files, multiple wildcard barrels, package aliases and malformed modules are explicit boundaries', async () => {
  const result = await analyze({
    'Focus.tsx': "import {choose} from './choice'; import {Button} from './barrel'; import thing from '@app/thing'; export function Focus(){ choose(); return <Button/>; }",
    'choice.ts': 'export const choose=()=>1;', 'choice.tsx': 'export const choose=()=>2;',
    'Button.tsx': 'export function Button(){return <button/>;}', 'Other.tsx': 'export function Button(){return <a/>;}',
    'barrel.ts': "export * from './Button'; export * from './Other';", 'broken.ts': 'export function broken( {',
  }, 'Focus.tsx');
  assert.equal(edges(result, 'call').length + edges(result, 'render').length, 0);
  assert.ok(result.boundaries.some(item => /Multiple indexed files/.test(item.detail)));
  assert.ok(result.boundaries.some(item => /Package and configured alias/.test(item.detail)));
  assert.ok(result.boundaries.some(item => item.kind === 'parse-error' && item.path === 'broken.ts'));
});

test('actual test imports and symbol uses stay separate from filename-only suggestions', async () => {
  const result = await analyze({
    'Button.tsx': 'export function Button(){return <button/>;}',
    'actual.test.tsx': "import {Button as Candidate} from './Button'; export function testRender(){return <Candidate/>;}",
    'Button.test.tsx': 'export const unrelated=1;', 'tests/Button.tsx': 'export const anotherCandidate=1;',
    'Other.test.tsx': 'export const unrelated=2;',
  }, 'Button.tsx');
  assert.ok(edges(result, 'test-reference').some(edge => edge.from.path === 'actual.test.tsx'));
  assert.deepEqual(result.candidates.map(item => item.path), ['Button.test.tsx', 'tests/Button.tsx']);
  assert.ok(result.candidates.every(item => item.provenance === 'filename' && item.reason === 'test-name'));
  assert.ok(edges(result, 'test-reference').every(item => /Execution and coverage are not established/.test(item.detail)));
});

test('fetch sites retain owning function, static method and sanitized literals without runtime claims', async () => {
  const result = await analyze({ 'api.ts': `export async function save(url:string, options:any) {
    await fetch('https://user:secret@example.test/api?token=private#fragment', {method:'post'});
    await fetch(\`/literal?private=removed\`);
    await fetch(url);
    await fetch(url,{method:'PUT'});
    await fetch('/after-spread',{...options,method:'PATCH'});
    await fetch('/before-spread',{method:'POST',...options});
    await window.fetch('/window');
    await globalThis.fetch('/global');
  }` }, 'api.ts');
  assert.equal(result.requests.length, 8);
  assert.deepEqual(result.requests.map(item => item.method), ['POST', 'GET', null, 'PUT', 'PATCH', null, 'GET', 'GET']);
  assert.equal(result.requests[0].url, 'https://example.test/api'); assert.equal(result.requests[1].url, '/literal');
  assert.equal(result.requests[2].url, null); assert.equal(result.requests[2].urlKind, 'dynamic');
  assert.ok(result.requests.every(item => item.source.label === 'save' && item.provenance === 'source'));
  assert.doesNotMatch(JSON.stringify(result), /secret|token=private|private=removed|fragment|headers|body/);
});

test('shadowed fetch/window and imported fetch are ordinary local bindings, not browser request evidence', async () => {
  const result = await analyze({
    'api.ts': "import {fetch as importedFetch} from './other'; export function run(fetch:any,window:any){fetch('/one');window.fetch('/two');importedFetch('/three');} function outer(){ const globalThis={fetch:()=>1};globalThis.fetch('/four');}",
    'other.ts': 'export const fetch=(path:string)=>path;',
  }, 'api.ts');
  assert.equal(result.requests.length, 0);
  assert.ok(edges(result, 'call').some(edge => edge.to.path === 'other.ts' && edge.to.label === 'fetch'));
});

test('dynamic imports and require calls do not fabricate static source loading relationships', async () => {
  const result = await analyze({ 'App.ts': "export async function app(){await import('./Other');require('./Other');}", 'Other.ts': 'export const other=1;' }, 'App.ts');
  assert.equal(result.edges.length, 0); assert.ok(result.boundaries.some(item => /CommonJS loading/.test(item.detail)));
});

test('edge IDs and revisions remain deterministic for unchanged source and change with evidence bytes', async () => {
  const a = await analyze(BASIC, 'src/Button.tsx'), b = await analyze(BASIC, 'src/Button.tsx');
  assert.deepEqual(a.edges, b.edges);
  const changed = await analyze({ ...BASIC, 'src/App.tsx': `// A changed revision\n${BASIC['src/App.tsx']}` }, 'src/Button.tsx');
  assert.notEqual(edges(a, 'render')[0].id, edges(changed, 'render')[0].id);
  assert.equal(edges(changed, 'render')[0].from.line, 5);
});

test('focused result caps report truncation instead of quietly claiming complete coverage', async () => {
  const sources = { 'Button.ts': `export function Button(){}\n${Array.from({ length: 230 }, () => 'Button();').join('\n')}\n${Array.from({ length: 130 }, (_, i) => `fetch('/api/${i}');`).join('\n')}` };
  for (let i = 0; i < 30; i++) sources[`tests/${i}/Button.ts`] = 'export const candidate=1;';
  const result = await analyze(sources, 'Button.ts');
  assert.equal(result.edges.length, 200); assert.equal(result.requests.length, 100); assert.equal(result.candidates.length, 24);
  assert.equal(result.truncated, true); assert.ok(result.boundaries.some(item => item.kind === 'limit'));
});

test('safe service reads each inventory source once and validation avoids per-file consumer scans', async t => {
  const h = await fixture(t, BASIC), original = fs.open, opened = [];
  fs.open = async (...args) => { opened.push(args[0]); return original(...args); }; syncBuiltinESMExports();
  try {
    const result = await h.service.relationships(h.id, 'src/Button.tsx');
    assert.equal(opened.length, Object.keys(BASIC).length);
    assert.equal(new Set(opened).size, opened.length);
    opened.length = 0;
    assert.equal(await h.service.validateRelationships(h.id, result), true);
    assert.equal(opened.length, Object.keys(BASIC).length);
  } finally { fs.open = original; syncBuiltinESMExports(); }
});

test('relationship loading never reads ignored, hidden, sensitive or symlink source and never executes project configuration', async t => {
  const h = await fixture(t, { ...BASIC, '.gitignore': 'ignored/\n', 'ignored/private.ts': 'PRIVATE_IGNORED_BYTES', '.env': 'PRIVATE_ENV_BYTES', 'secrets.json': 'PRIVATE_SECRET_BYTES',
    'vite.config.ts': "throw new Error('PROJECT_CONFIG_EXECUTION_SENTINEL');", 'tsconfig.json': '{"extends":"./ignored/private.ts"}' });
  await symlink(join(h.root, 'ignored/private.ts'), join(h.root, 'src/linked.ts'));
  const result = await h.service.relationships(h.id, 'src/Button.tsx');
  assert.ok(result.manifest.every(item => !/private|linked|\.env|secrets/.test(item.path)));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|PROJECT_CONFIG_EXECUTION_SENTINEL/);
  for (const path of ['../outside.ts', '.env', 'secrets.json', 'ignored/private.ts', 'src/linked.ts']) await assert.rejects(h.service.relationships(h.id, path));
});

test('full-manifest validation detects intermediate barrel edits, new consumers, deletions and ignore changes', async t => {
  const h = await fixture(t, BASIC);
  let result = await h.service.relationships(h.id, 'src/Button.tsx');
  await h.write('src/index.ts', "export { Button as Different } from './Button';\n");
  assert.equal(await h.service.validateRelationships(h.id, result), false);
  result = await h.service.relationships(h.id, 'src/Button.tsx');
  await h.write('src/New.tsx', "import {Button} from './Button';export const New=()=> <Button label='new'/>;");
  assert.equal(await h.service.validateRelationships(h.id, result), false);
  result = await h.service.relationships(h.id, 'src/Button.tsx');
  await rm(join(h.root, 'src/New.tsx'));
  assert.equal(await h.service.validateRelationships(h.id, result), false);
  result = await h.service.relationships(h.id, 'src/Button.tsx');
  await h.write('.gitignore', 'src/App.tsx\n');
  assert.equal(await h.service.validateRelationships(h.id, result), false);
});

test('validation refuses forged or foreign manifests and newly redirected symlinks', async t => {
  const h = await fixture(t, BASIC), result = await h.service.relationships(h.id, 'src/Button.tsx');
  for (const patch of [{ projectId: 'other' }, { schemaVersion: 2 }, { manifest: [...result.manifest, result.manifest[0]] }, { manifest: [{ path: '../outside', revision: 'a'.repeat(16) }] }])
    assert.equal(await h.service.validateRelationships(h.id, { ...result, ...patch }), false);
  await rm(join(h.root, 'src/api.ts')); await symlink(join(h.root, 'src/App.tsx'), join(h.root, 'src/api.ts'));
  assert.equal(await h.service.validateRelationships(h.id, result), false);
});

test('cancellation fences safe disk reads, in-memory analysis and validation', async t => {
  const h = await fixture(t, BASIC);
  await assert.rejects(h.service.relationships(h.id, 'src/Button.tsx', { isCurrent: () => false }), { code: 'relationships-cancelled' });
  let checks = 0;
  await assert.rejects(h.service.relationships(h.id, 'src/Button.tsx', { isCurrent: () => ++checks < 9 }), { code: 'relationships-cancelled' });
  checks = 0;
  await assert.rejects(analyze(BASIC, 'src/Button.tsx', { isCurrent: () => ++checks < 3 }), { code: 'relationships-cancelled' });
  const result = await h.service.relationships(h.id, 'src/Button.tsx');
  await assert.rejects(h.service.validateRelationships(h.id, result, { isCurrent: () => false }), { code: 'relationships-cancelled' });
});

test('non-UTF8 indexed files produce an unavailable boundary and cannot pass complete-manifest validation', async t => {
  const h = await fixture(t, BASIC); await writeFile(join(h.root, 'src/unreadable.ts'), Buffer.from([0xff]));
  const result = await h.service.relationships(h.id, 'src/Button.tsx');
  assert.ok(result.boundaries.some(item => item.kind === 'unavailable' && item.path === 'src/unreadable.ts'));
  assert.equal(result.manifest.some(item => item.path === 'src/unreadable.ts'), false);
  assert.equal(await h.service.validateRelationships(h.id, result), false);
});


test('destructuring and iteration assignments retire overwritten function bindings', async () => {
  const result = await analyze({ 'App.ts': `export function a(){} function b(){} function c(){} function d(){} function e(){}
    const other=()=>1; [a]=[other]; ({b}=source); ({value:c}=source); for(d of values){}; for(e in object){};
    a();b();c();d();e();other();` }, 'App.ts');
  assert.deepEqual(edges(result, 'call').map(edge => edge.to.label), ['other']);
});

test('conflicting explicit exports cannot fabricate a resolved callee while one explicit wildcard override remains provable', async () => {
  const base = { 'one.ts': 'export function save(){return 1;}', 'two.ts': 'export function save(){return 2;}',
    'barrel.ts': "export {save} from './one'; export {save} from './two';", 'App.ts': "import {save} from './barrel'; export function run(){save();}" };
  const ambiguous = await analyze(base, 'App.ts'); assert.equal(edges(ambiguous, 'call').length, 0);
  assert.ok(ambiguous.boundaries.some(item => item.kind === 'unresolved'));
  const explicit = await analyze({ ...base, 'barrel.ts': "export {save} from './one'; export * from './two';" }, 'App.ts');
  assert.equal(edges(explicit, 'call').length, 1); assert.equal(edges(explicit, 'call')[0].to.path, 'one.ts');
});

test('tests passing an imported component as a value retain its source reference through a barrel', async () => {
  const result = await analyze({ 'Button.tsx': 'export function Button(){return <button/>;}', 'index.ts': "export {Button} from './Button';",
    'Button.test.tsx': "import {Button as Subject} from './index'; verifyComponent(Subject);" }, 'Button.tsx');
  assert.ok(edges(result, 'test-reference').some(edge => edge.from.path === 'Button.test.tsx' && edge.from.label === 'Subject'));
  assert.equal(result.candidates.length, 0);
});

test('extreme syntax nesting is bounded and excluded from semantic evidence', async () => {
  const result = await analyze({ 'deep.ts': `export const value=${'('.repeat(180)}1${')'.repeat(180)};` }, 'deep.ts');
  assert.equal(result.counts.analyzed, 0); assert.equal(result.edges.length, 0); assert.equal(result.truncated, true);
  assert.ok(result.boundaries.some(item => item.kind === 'limit' && item.path === 'deep.ts'));
});

test('visible global fetch writes withhold request claims across indexed modules and assignment forms', async () => {
  for (const replacement of [
    'fetch=custom;', 'globalThis.fetch=custom;', "window['fetch']=custom;", '[fetch]=[custom];',
    '({fetch}=custom);', 'for(fetch of choices){}', 'delete globalThis.fetch;', 'window=custom;',
  ]) {
    const result = await analyze({ 'replace.ts': `export {}; ${replacement}`, 'api.ts': "export function save(){fetch('/api');window.fetch('/api');globalThis.fetch('/api');}" }, 'api.ts');
    assert.equal(result.requests.length, 0, replacement);
    assert.ok(result.boundaries.some(item => item.kind === 'unresolved' && /replaces a global fetch binding/.test(item.detail)), replacement);
  }
});

test('writes to lexically shadowed fetch or window bindings do not retire unrelated global requests', async () => {
  const result = await analyze({ 'api.ts': `export function local(fetch:any, window:any, globalThis:any) {
    fetch=custom; ({fetch}=custom); window.fetch=custom; globalThis['fetch']=custom;
  }
  export function save(){fetch('/api');window.fetch('/api');globalThis.fetch('/api');}` }, 'api.ts');
  assert.equal(result.requests.length, 3);
});
