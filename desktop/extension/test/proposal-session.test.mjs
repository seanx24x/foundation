import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createProposalSession } from '../src/proposal-session.mjs';
import { createProjectService } from '../../../server/project/workspace.mjs';
import { createChangeProposal, createTokenProposal } from '../../../server/project/proposals.mjs';

const BUTTON_PATH = 'src/Button.tsx';
const CONSUMER_PATH = 'src/App.tsx';
const BUTTON = 'export function Button() { return <button>Save</button>; }\n';
const APP = "import { Button } from './Button';\nexport default function App() { return <Button />; }\n";

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/foundation-proposal-session-');
  const projectRoot = join(root, 'projects/orbit');
  await mkdir(join(projectRoot, 'src'), { recursive: true });
  await writeFile(join(projectRoot, BUTTON_PATH), BUTTON);
  await writeFile(join(projectRoot, CONSUMER_PATH), APP);
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = createProjectService({ root });
  const project = await service.snapshot();
  const files = await Promise.all([BUTTON_PATH, CONSUMER_PATH].map(path => service.getFile(project.id, path)));
  const proposal = createChangeProposal({
    projectId: project.id, files,
    raw: JSON.stringify({ title: 'Clarify save', summary: 'Change the selected button label.', edits: [{ path: BUTTON_PATH, find: '>Save</button>', replace: '>Save changes</button>' }], verification: ['Inspect the button.'] }),
  });
  const dirty = new Set();
  const persisted = [];
  const bindings = {
    getFile: (id, path) => service.getFile(id, path),
    save: args => service.save(args),
    isDirty: path => dirty.has(path),
    persist: async item => { persisted.push(structuredClone(item)); },
  };
  const session = createProposalSession(bindings);
  await session.set(proposal);
  return { root, projectRoot, service, project, proposal, dirty, persisted, bindings, session };
}

const apply = f => f.session.apply(f.proposal.id, f.project.id);
const undo = f => f.session.undo(f.proposal.id, f.project.id);
const source = (f, path = BUTTON_PATH) => readFile(join(f.projectRoot, path), 'utf8');

test('proposal applies one actual source file, and undo preserves unrelated saved edits', async t => {
  const f = await fixture(t);
  assert.equal(await source(f), BUTTON);
  const applied = await apply(f);
  assert.equal(applied.status, 'applied');
  assert.equal(await source(f), f.proposal.after);
  assert.equal(applied.appliedRevision, (await f.service.getFile(f.project.id, BUTTON_PATH)).revision);
  const unrelated = `${APP}// User work after apply.\n`;
  await writeFile(join(f.projectRoot, CONSUMER_PATH), unrelated);
  assert.equal((await undo(f)).status, 'undone');
  assert.equal(await source(f), BUTTON);
  assert.equal(await source(f, CONSUMER_PATH), unrelated);
  assert.deepEqual(f.persisted.map(item => item.status), ['proposed', 'applied', 'undone']);
});

test('changed target source becomes stale without overwriting the user revision', async t => {
  const f = await fixture(t);
  const current = `${BUTTON}// New user revision.\n`;
  await writeFile(join(f.projectRoot, BUTTON_PATH), current);
  await assert.rejects(apply(f), /source changed/);
  assert.equal(f.session.current().status, 'stale');
  assert.equal(await source(f), current);
});

test('changed selected dependency invalidates a target proposal', async t => {
  const f = await fixture(t);
  await writeFile(join(f.projectRoot, CONSUMER_PATH), `${APP}// Context changed.\n`);
  await assert.rejects(apply(f), /context changed/);
  assert.equal(f.session.current().status, 'stale');
  assert.equal(await source(f), BUTTON);
});

test('native target and selected-context drafts block apply', async t => {
  const f = await fixture(t);
  f.dirty.add(BUTTON_PATH);
  await assert.rejects(apply(f), /native editor draft/);
  assert.equal(f.session.current().status, 'proposed');
  f.dirty.delete(BUTTON_PATH);
  f.dirty.add(CONSUMER_PATH);
  await assert.rejects(apply(f), /context changed/);
  assert.equal(f.session.current().status, 'stale');
  assert.equal(await source(f), BUTTON);
});

test('a native draft appearing during preparation is checked again before save', async t => {
  const f = await fixture(t);
  let targetChecks = 0, saves = 0;
  f.session = createProposalSession({
    ...f.bindings,
    isDirty: path => path === BUTTON_PATH && ++targetChecks >= 2,
    save: args => { saves++; return f.bindings.save(args); },
  });
  await f.session.set(f.proposal);
  await assert.rejects(apply(f), /context changed|native editor changed/);
  assert.equal(saves, 0);
  assert.equal(await source(f), BUTTON);
});

test('duplicate concurrent apply is serialized and writes at most once', async t => {
  const f = await fixture(t);
  let saves = 0;
  f.session = createProposalSession({ ...f.bindings, save: args => { saves++; return f.bindings.save(args); } });
  await f.session.set(f.proposal);
  const results = await Promise.allSettled([apply(f), apply(f)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter(item => item.status === 'rejected').length, 1);
  assert.equal(saves, 1);
  assert.equal(f.session.current().status, 'applied');
  assert.equal(await source(f), f.proposal.after);
});

test('persisted applied checkpoint restores after restart and keeps exact undo', async t => {
  const f = await fixture(t);
  await apply(f);
  const checkpoint = structuredClone(f.persisted.at(-1));
  const service = createProjectService({ root: f.root });
  await service.snapshot();
  const restarted = createProposalSession({ getFile: (id, path) => service.getFile(id, path), save: args => service.save(args) });
  restarted.restore(checkpoint);
  checkpoint.before = 'Caller mutated its copy.';
  const view = restarted.current();
  view.after = 'Caller mutated its view.';
  assert.equal(restarted.current().before, BUTTON);
  assert.equal(restarted.current().after, f.proposal.after);
  assert.equal((await restarted.undo(f.proposal.id, f.project.id)).status, 'undone');
  assert.equal(await source(f), BUTTON);
});

test('undo refuses newer source edits and unsaved target drafts', async t => {
  const f = await fixture(t);
  await apply(f);
  f.dirty.add(BUTTON_PATH);
  await assert.rejects(undo(f), /native editor draft/);
  f.dirty.clear();
  const current = `${f.proposal.after}// Preserve this newer edit.\n`;
  await writeFile(join(f.projectRoot, BUTTON_PATH), current);
  await assert.rejects(undo(f), /changed after Apply/);
  assert.equal(await source(f), current);
  assert.equal(f.session.current().status, 'applied');
});

test('discard only dismisses a proposal and never changes source', async t => {
  const f = await fixture(t);
  await f.session.discard(f.proposal.id, f.project.id);
  assert.equal(f.session.current().status, 'discarded');
  assert.equal(await source(f), BUTTON);
  await assert.rejects(apply(f), /unapplied proposal/);
  await f.session.set(f.proposal);
  await apply(f);
  await assert.rejects(f.session.set(f.proposal), /checkpoint/);
  await f.session.discard(f.proposal.id, f.project.id);
  assert.equal(await source(f), f.proposal.after);
});

test('service compare-and-swap catches a disk write after session validation', async t => {
  const f = await fixture(t);
  const external = `${BUTTON}// Arrived immediately before save.\n`;
  f.session = createProposalSession({ ...f.bindings, save: async args => {
    await writeFile(join(f.projectRoot, BUTTON_PATH), external);
    return f.bindings.save(args);
  } });
  await f.session.set(f.proposal);
  await assert.rejects(apply(f), { code: 'source-conflict' });
  assert.equal(await source(f), external);
  assert.notEqual(f.session.current().status, 'applied');
});

test('project identity and replaced symlinks cannot redirect a proposal write', async t => {
  const f = await fixture(t);
  await assert.rejects(f.session.apply(f.proposal.id, 'different-project'), /different project/);
  const external = join(f.root, 'outside.tsx');
  await writeFile(external, BUTTON);
  await rm(join(f.projectRoot, BUTTON_PATH));
  await symlink(external, join(f.projectRoot, BUTTON_PATH));
  await assert.rejects(apply(f), { code: 'symlink-rejected' });
  assert.equal(await readFile(external, 'utf8'), BUTTON);
});

test('restored invalid traversal checkpoints are discarded before use', () => {
  const session = createProposalSession({ getFile: () => { throw new Error('Must not read'); }, save: () => { throw new Error('Must not write'); } });
  session.restore({ id: 'p', projectId: 'x', path: '../outside.ts', before: '', after: 'x', baseRevision: 'r', status: 'proposed' });
  assert.equal(session.current(), null);
});

test('refresh exposes stale proposal context and clears an applied conflict only when exact source returns', async t => {
  const f = await fixture(t);
  await writeFile(join(f.projectRoot, CONSUMER_PATH), APP + '// dependency changed\n');
  assert.equal((await f.session.assess()).status, 'stale');
  const g = await fixture(t);
  await apply(g);
  await writeFile(join(g.projectRoot, BUTTON_PATH), g.proposal.after + '// user edit\n');
  assert.equal((await g.session.assess()).conflict, true);
  await writeFile(join(g.projectRoot, BUTTON_PATH), g.proposal.after);
  assert.equal((await g.session.assess()).conflict, false);
  assert.equal((await undo(g)).status, 'undone');
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('cancellation while set waits in the session queue preserves the prior checkpoint', async t => {
  const f = await fixture(t);
  const entered = deferred(), release = deferred();
  f.session = createProposalSession({ ...f.bindings, getFile: async (...args) => {
    entered.resolve(); await release.promise;
    return f.bindings.getFile(...args);
  } });
  await f.session.set(f.proposal);
  const assessment = f.session.assess();
  await entered.promise;
  let current = true;
  const replacement = { ...f.proposal, id: 'cancelled-replacement' };
  const pending = f.session.set(replacement, { isCurrent: () => current });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  current = false;
  release.resolve();
  await Promise.all([assessment, rejected]);
  assert.equal(f.session.current().id, f.proposal.id);
  assert.equal(f.persisted.some(item => item?.id === replacement.id), false);
  assert.equal(await source(f), BUTTON);
});

test('cancellation during checkpoint persistence never publishes it and restores prior storage', async t => {
  const f = await fixture(t);
  const entered = deferred(), release = deferred();
  const replacement = { ...f.proposal, id: 'cancelled-during-persistence' };
  f.session = createProposalSession({ ...f.bindings, persist: async item => {
    if (item?.id === replacement.id) { entered.resolve(); await release.promise; }
    await f.bindings.persist(item);
  } });
  await f.session.set(f.proposal);
  let current = true;
  const pending = f.session.set(replacement, { isCurrent: () => current });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise;
  assert.equal(f.session.current().id, f.proposal.id);
  current = false;
  release.resolve();
  await rejected;
  assert.equal(f.session.current().id, f.proposal.id);
  assert.equal(f.persisted.at(-1).id, f.proposal.id);
  assert.equal(await source(f), BUTTON);
});

test('dependency changes after session checks are rejected by the serialized service save', async t => {
  const f = await fixture(t);
  const changed = `${APP}// New dependency revision during Apply.\n`;
  f.session = createProposalSession({ ...f.bindings, save: async args => {
    await writeFile(join(f.projectRoot, CONSUMER_PATH), changed);
    return f.bindings.save(args);
  } });
  await f.session.set(f.proposal);
  await assert.rejects(apply(f), { code: 'context-conflict' });
  assert.equal(f.session.current().status, 'stale');
  assert.equal(await source(f), BUTTON);
  assert.equal(await source(f, CONSUMER_PATH), changed);
});

async function planFixture(t) {
  const f=await fixture(t);f.proposal={...f.proposal,planBasis:structuredClone(f.proposal.context),context:f.proposal.context.filter(item=>item.path===BUTTON_PATH)};
  await f.session.set(f.proposal);return f;
}

test('a plan-linked proposal assesses and blocks changes in its original unshared source basis',async t=>{
  const f=await planFixture(t);assert.equal(f.proposal.context.some(item=>item.path===CONSUMER_PATH),false);
  await writeFile(join(f.projectRoot,CONSUMER_PATH),APP+'// Original plan basis changed\n');
  assert.equal((await f.session.assess()).status,'stale');await assert.rejects(apply(f),/unapplied proposal/);assert.equal(await source(f),BUTTON);
  const g=await planFixture(t);await writeFile(join(g.projectRoot,CONSUMER_PATH),APP+'// Changed without assessment\n');
  await assert.rejects(apply(g),/context changed/);assert.equal(g.session.current().status,'stale');assert.equal(await source(g),BUTTON);
});

test('native drafts in original unshared plan source block assessment and Apply',async t=>{
  const f=await planFixture(t);f.dirty.add(CONSUMER_PATH);assert.equal((await f.session.assess()).status,'stale');
  const g=await planFixture(t);g.dirty.add(CONSUMER_PATH);await assert.rejects(apply(g),/context changed/);assert.equal(await source(g),BUTTON);
});

test('the final service compare-and-swap includes original unshared plan basis without duplicate paths',async t=>{
  const f=await planFixture(t);let checked;
  f.session=createProposalSession({...f.bindings,save:async args=>{checked=args.expectedContext;await writeFile(join(f.projectRoot,CONSUMER_PATH),APP+'// Changed at save boundary\n');return f.bindings.save(args);}});
  await f.session.set(f.proposal);await assert.rejects(apply(f),{code:'context-conflict'});
  assert.equal(checked.length,2);assert.equal(new Set(checked.map(item=>item.path)).size,2);assert.deepEqual(new Set(checked.map(item=>item.path)),new Set([BUTTON_PATH,CONSUMER_PATH]));
  assert.equal(f.session.current().status,'stale');assert.equal(await source(f),BUTTON);
});

test('plan basis survives checkpoint restore while Undo still protects only the exact applied target',async t=>{
  const f=await planFixture(t),restored=createProposalSession(f.bindings);restored.restore(f.session.current());f.session=restored;
  assert.deepEqual(restored.current().planBasis,f.proposal.planBasis);await apply(f);
  const changed=APP+'// Unrelated user change after Apply\n';await writeFile(join(f.projectRoot,CONSUMER_PATH),changed);f.dirty.add(CONSUMER_PATH);
  const afterRestart=createProposalSession(f.bindings);afterRestart.restore(f.session.current());f.session=afterRestart;
  assert.equal((await f.session.assess()).conflict,false);assert.equal((await undo(f)).status,'undone');assert.equal(await source(f),BUTTON);assert.equal(await source(f,CONSUMER_PATH),changed);
});

test('malformed, conflicting or incomplete plan basis cannot restore or replace a checkpoint',async t=>{
  const f=await planFixture(t),baseline=structuredClone(f.proposal),writes=f.persisted.length;
  const variants=[value=>value.planBasis=null,value=>value.planBasis=[],value=>value.planBasis.push({...value.planBasis[0]}),value=>value.planBasis[0].path='../outside.ts',
    value=>value.planBasis[0].revision='',value=>value.planBasis[0].status='passed',value=>value.planBasis=value.planBasis.filter(item=>item.path!==BUTTON_PATH),
    value=>value.planBasis.find(item=>item.path===BUTTON_PATH).revision='conflicting',value=>value.context.push({path:'src/Unbound.ts',revision:'unbound'}),
    value=>value.planBasis=Array.from({length:9},(_,i)=>({path:`src/file${i}.ts`,revision:'r1'}))];
  for(const mutate of variants){const malformed=structuredClone(baseline);mutate(malformed);const rejected=createProposalSession(f.bindings);rejected.restore(malformed);assert.equal(rejected.current(),null);
    await assert.rejects(f.session.set(malformed),/incomplete/);assert.deepEqual(f.session.current(),baseline);}
  assert.equal(f.persisted.length,writes);assert.equal(await source(f),BUTTON);
});

test('an original basis draft appearing during a later source read retires assessment and blocks Apply before save',async t=>{
  for(const action of ['assess','apply']) {
    const f=await planFixture(t),laterPath='src/later.ts';await writeFile(join(f.projectRoot,laterPath),'export const later=true;\n');
    const later=await f.service.getFile(f.project.id,laterPath);f.proposal.planBasis.push({path:laterPath,revision:later.revision});let saves=0;
    f.session=createProposalSession({...f.bindings,getFile:async(id,path)=>{const file=await f.bindings.getFile(id,path);if(path===laterPath)f.dirty.add(CONSUMER_PATH);return file;},save:args=>{saves++;return f.bindings.save(args);}});
    await f.session.set(f.proposal);
    if(action==='assess')assert.equal((await f.session.assess()).status,'stale');else await assert.rejects(apply(f),/context changed/);
    assert.equal(saves,0);assert.equal(await source(f),BUTTON);
  }
});


async function impactFixture(t, overrides = {}) {
  const f = await fixture(t), cssPath = 'src/styles.css';
  const css = ':root { --radius: 8px; }\nbutton { border-radius: var(--radius); }\n';
  await writeFile(join(f.projectRoot, cssPath), css);
  const file = await f.service.getFile(f.project.id, cssPath);
  const result = await f.service.changeImpact(f.project.id, {kind:'token',path:cssPath,revision:file.revision,name:'--radius',occurrence:0});
  const proposal = createTokenProposal({projectId:f.project.id,file,name:'--radius',occurrence:0,value:'12px'});
  proposal.designImpact = {version:1,result,relatedScenarios:[]};
  const calls = [], saves = [];
  const bindings = {...f.bindings,
    validateImpact: async (checkpoint, options) => { calls.push(options.phase); return f.service.validateChangeImpact(f.project.id, checkpoint.result); },
    save: async args => { saves.push(structuredClone(args)); return f.service.save(args, {guard: async () => {
      if (args.designImpact && !await f.service.validateChangeImpact(f.project.id,args.designImpact.result))
        throw Object.assign(new Error('Impact changed at the write boundary'), {code:'context-conflict'});
    }}); },
    ...overrides,
  };
  const session = createProposalSession(bindings);
  await session.set(proposal);
  return {...f,proposal,session,bindings,calls,saves,cssPath,css};
}

test('visual proposal freezes its validated checkpoint and forwards it only on Apply', async t => {
  const f = await impactFixture(t), frozen = structuredClone(f.proposal.designImpact);
  f.proposal.designImpact.result.scope.label = 'mutated caller';
  const view = f.session.current(); view.designImpact.result.manifest.length = 0;
  assert.deepEqual(f.session.current().designImpact, frozen);
  assert.equal((await f.session.assess()).status, 'proposed');
  assert.equal((await apply(f)).status, 'applied');
  assert.deepEqual(f.calls, ['assess','apply']);
  assert.deepEqual(f.saves[0].designImpact, frozen);
  await writeFile(join(f.projectRoot, CONSUMER_PATH), `${APP}// User edit after Apply.\n`);
  assert.equal((await f.session.assess()).conflict, false);
  assert.equal((await undo(f)).status, 'undone');
  assert.equal(Object.hasOwn(f.saves[1], 'designImpact'), false);
  assert.deepEqual(f.calls, ['assess','apply']);
  assert.equal(await source(f,f.cssPath), f.css);
  assert.equal(await source(f,CONSUMER_PATH), `${APP}// User edit after Apply.\n`);
});

test('new or changed inventory makes impact stale before Apply without overwriting source', async t => {
  for (const mutation of ['new','changed']) {
    const f = await impactFixture(t);
    await writeFile(join(f.projectRoot,mutation === 'new' ? 'src/NewConsumer.tsx' : CONSUMER_PATH), 'export const change = true;\n');
    await assert.rejects(apply(f), /impact preview/);
    assert.equal(f.session.current().status, 'stale');
    assert.equal(f.saves.length, 0);
    assert.equal(await source(f,f.cssPath), f.css);
  }
});

test('unavailable impact validator fails closed during assessment and Apply', async t => {
  const f = await impactFixture(t, {validateImpact: async () => { throw new Error('unavailable'); }});
  assert.equal((await f.session.assess()).status, 'stale');
  const g = await impactFixture(t, {validateImpact: undefined});
  await assert.rejects(apply(g), /impact preview/);
  assert.equal(g.saves.length, 0);
});

test('impact checkpoint rejects foreign, forged, mismatched and non-design restoration', async t => {
  const f = await impactFixture(t);
  for (const alter of [
    item => { item.designImpact.result.projectId = 'foreign'; },
    item => { item.designImpact.result.basisDigest = 'forged'; },
    item => { item.designImpact.extra = true; },
    item => { item.path = CONSUMER_PATH; },
    item => { item.baseRevision = 'different'; },
    item => { item.origin = 'ai'; },
    item => { item.designImpact.relatedScenarios = [{featureId:'unknown'}]; },
  ]) {
    const malformed = structuredClone(f.proposal); alter(malformed);
    const restored = createProposalSession(f.bindings); restored.restore(malformed);
    assert.equal(restored.current(), null);
    await assert.rejects(restored.set(malformed), /incomplete/);
  }
  const restored = createProposalSession(f.bindings); restored.restore(f.proposal);
  assert.deepEqual(restored.current().designImpact, f.proposal.designImpact);
});

test('last-moment consumer changes are refused by the private write guard', async t => {
  const f = await impactFixture(t);
  const session = createProposalSession({...f.bindings,save: async args => {
    await writeFile(join(f.projectRoot,CONSUMER_PATH), `${APP}// Race during Apply.\n`);
    return f.bindings.save(args);
  }});
  await session.set(f.proposal);
  await assert.rejects(session.apply(f.proposal.id,f.project.id), /write boundary/);
  assert.equal(session.current().status, 'stale');
  assert.equal(await source(f,f.cssPath), f.css);
});

test('opaque ownership token is stable for reads and retires on replacement or status transition', async t => {
  const f=await fixture(t), original=f.session.ownershipToken();
  assert.ok(Object.isFrozen(original));assert.deepEqual(Object.keys(original),[]);
  const detached=f.session.current();detached.after='foreign';
  assert.equal(f.session.ownershipToken(),original);await f.session.assess();assert.equal(f.session.ownershipToken(),original);
  await apply(f);const applied=f.session.ownershipToken();assert.notEqual(applied,original);
  await undo(f);assert.notEqual(f.session.ownershipToken(),applied);
  const undone=f.session.ownershipToken();f.session.restore(f.session.current());assert.notEqual(f.session.ownershipToken(),undone);
  f.session.restore(null);const empty=f.session.ownershipToken();assert.equal(f.session.current(),null);assert.equal(f.session.ownershipToken(),empty);
});


const alternativeBasis=item=>({version:1,comparisonId:randomUUID(),beforeHash:createHash('sha256').update(item.before).digest('hex'),afterHash:createHash('sha256').update(item.after).digest('hex'),baselineDigest:'a'.repeat(64)});
async function alternativeFixture(t,overrides={}){
 const f=await impactFixture(t);f.proposal.alternativeBasis=alternativeBasis(f.proposal);const alternativeCalls=[];
 const session=createProposalSession({...f.bindings,validateAlternative:async(basis,context)=>{alternativeCalls.push({basis,context});return true;},...overrides});await session.set(f.proposal);return {...f,session,alternativeCalls};
}

test('retained candidate basis is immutable and verified only on explicit Apply, never background assess or Undo',async t=>{
 const f=await alternativeFixture(t),frozen=structuredClone(f.proposal.alternativeBasis);f.proposal.alternativeBasis.beforeHash='0'.repeat(64);const view=f.session.current();view.alternativeBasis.baselineDigest='0'.repeat(64);
 assert.deepEqual(f.session.current().alternativeBasis,frozen);assert.equal((await f.session.assess()).status,'proposed');assert.equal(f.alternativeCalls.length,0);
 assert.equal((await apply(f)).status,'applied');assert.equal(f.alternativeCalls.length,1);assert.deepEqual(f.alternativeCalls[0].basis,frozen);assert.equal(f.alternativeCalls[0].context.phase,'apply');assert.deepEqual(f.saves[0].alternativeBasis,frozen);
 await writeFile(join(f.projectRoot,CONSUMER_PATH),APP+'// unrelated saved work');assert.equal((await undo(f)).status,'undone');assert.equal(f.alternativeCalls.length,1);assert.equal(Object.hasOwn(f.saves[1],'alternativeBasis'),false);assert.equal(await source(f,f.cssPath),f.css);
});

test('retained candidate provenance rejects forged hashes, unknown fields and non-design restoration',async t=>{
 const f=await alternativeFixture(t);
 for(const change of [item=>item.alternativeBasis.version=2,item=>item.alternativeBasis.comparisonId='../outside',item=>item.alternativeBasis.beforeHash='0'.repeat(64),item=>item.alternativeBasis.afterHash='0'.repeat(64),item=>item.alternativeBasis.baselineDigest='short',item=>item.alternativeBasis.extra=true,item=>delete item.designImpact,item=>item.origin='ai',item=>item.after+='/* changed */']){
  const candidate=structuredClone(f.proposal);change(candidate);const session=createProposalSession(f.bindings);session.restore(candidate);assert.equal(session.current(),null);await assert.rejects(session.set(candidate),/incomplete/);
 }
 const session=createProposalSession(f.bindings);session.restore(f.proposal);assert.deepEqual(session.current().alternativeBasis,f.proposal.alternativeBasis);
});

test('retained baseline validation fails closed without touching source',async t=>{
 for(const validateAlternative of [undefined,async()=>false,async()=>{throw new Error('missing copy');}]){
  const f=await alternativeFixture(t,{validateAlternative});assert.equal((await f.session.assess()).status,'proposed');await assert.rejects(apply(f),/retained alternative/);assert.equal(f.session.current().status,'stale');assert.equal(f.saves.length,0);assert.equal(await source(f,f.cssPath),f.css);
 }
});

test('a native draft appearing during retained-source validation blocks Apply',async t=>{
 const f=await impactFixture(t);f.proposal.alternativeBasis=alternativeBasis(f.proposal);const session=createProposalSession({...f.bindings,validateAlternative:async()=>{f.dirty.add(f.cssPath);return true;}});await session.set(f.proposal);await assert.rejects(session.apply(f.proposal.id,f.project.id),/native editor changed/);assert.equal(f.saves.length,0);assert.equal(await source(f,f.cssPath),f.css);
});
