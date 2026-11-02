import {createHash} from 'node:crypto';
import { validateDesignImpactCheckpoint } from '../../../server/project/change-impact.mjs';

/** Host-owned review state. Model output never authorizes a filesystem write. */
export function createProposalSession({ getFile, save, isDirty = () => false, persist = async () => {}, validateImpact = async () => false, validateAlternative = async () => false }) {
  let proposal = null;
  let queue = Promise.resolve();
  let tokenOwner, tokenStatus, tokenValue;
  // A process-local, opaque identity avoids cloning source and impact evidence
  // for every filesystem await. Source/impact are replaced only by set/restore;
  // transitions mutate status. The token cannot expose or mutate that evidence.
  const ownershipToken = () => {
    if (!tokenValue || tokenOwner !== proposal || tokenStatus !== proposal?.status) {
      tokenOwner = proposal; tokenStatus = proposal?.status; tokenValue = Object.freeze({});
    }
    return tokenValue;
  };
  const serialize = (work) => {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  };
  const safeReference = item => item && typeof item === 'object' && !Array.isArray(item) &&
    Object.keys(item).every(key => ['path','revision'].includes(key)) && typeof item.path === 'string' && item.path.length > 0 && item.path.length <= 1000 &&
    !/^[\/\\]|^[A-Za-z]:|[\\\u0000-\u001f\u007f]/.test(item.path) && item.path.split('/').every(part => part && part !== '.' && part !== '..') &&
    typeof item.revision === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(item.revision);
  function validPlanBasis(item) {
    if (item.planBasis === undefined) return true;
    const basis = item.planBasis;
    if (!Array.isArray(basis) || basis.length < 1 || basis.length > 8 || !basis.every(safeReference) || new Set(basis.map(ref => ref.path)).size !== basis.length) return false;
    if (!basis.some(ref => ref.path === item.path && ref.revision === item.baseRevision)) return false;
    if (item.context !== undefined && (!Array.isArray(item.context) || item.context.length > 8 || !item.context.every(safeReference) || new Set(item.context.map(ref => ref.path)).size !== item.context.length)) return false;
    return (item.context || []).every(ref => basis.some(source => source.path === ref.path && source.revision === ref.revision));
  }
  function guardedContext(item) {
    const context = item.context || [{path:item.path,revision:item.baseRevision}];
    if (item.planBasis === undefined) return context;
    return [...new Map([...context,...item.planBasis].map(ref => [ref.path,{path:ref.path,revision:ref.revision}])).values()];
  }
  function validImpact(item) {
    if (item.designImpact === undefined) return true;
    try {
      const checkpoint = validateDesignImpactCheckpoint(item.designImpact, item.projectId);
      return item.origin === 'design' && checkpoint.result.target.kind === 'token'
        && checkpoint.result.target.path === item.path && checkpoint.result.target.revision === item.baseRevision;
    } catch { return false; }
  }
  function validAlternativeBasis(item) {
    if (item.alternativeBasis === undefined) return true;
    const basis=item.alternativeBasis, keys=['version','comparisonId','beforeHash','afterHash','baselineDigest'];
    const digest=value=>createHash('sha256').update(value).digest('hex');
    return item.origin==='design' && item.designImpact!==undefined && basis && typeof basis==='object' && !Array.isArray(basis)
      && Object.keys(basis).length===keys.length && keys.every(key=>Object.hasOwn(basis,key)) && basis.version===1
      && typeof basis.comparisonId==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(basis.comparisonId)
      && ['beforeHash','afterHash','baselineDigest'].every(key=>typeof basis[key]==='string' && /^[a-f0-9]{64}$/.test(basis[key]))
      && basis.beforeHash===digest(item.before) && basis.afterHash===digest(item.after) && basis.beforeHash!==basis.afterHash;
  }
  async function alternativeCurrent(item) {
    if (item.alternativeBasis === undefined) return true;
    try { return await validateAlternative(structuredClone(item.alternativeBasis), {phase:'apply',proposal:structuredClone(item)}) === true; }
    catch { return false; }
  }
  async function impactCurrent(item, phase) {
    if (item.designImpact === undefined) return true;
    try { return await validateImpact(structuredClone(item.designImpact), {phase}) === true; }
    catch { return false; }
  }
  async function staleImpact(item) {
    item.status = 'stale';
    item.reason = 'Saved source changed after the impact preview. Inspect change impact and prepare a new proposal.';
    await remember();
  }
  function valid(item) {
    return item && typeof item.id === 'string' && typeof item.projectId === 'string'
      && typeof item.path === 'string' && !item.path.startsWith('/') && !item.path.includes('\\')
      && item.path.split('/').every(part => part && part !== '.' && part !== '..')
      && typeof item.before === 'string' && typeof item.after === 'string'
      && Buffer.byteLength(item.before) <= 256 * 1024 && Buffer.byteLength(item.after) <= 256 * 1024
      && !item.before.includes('\0') && !item.after.includes('\0')
      && typeof item.baseRevision === 'string' && ['proposed', 'applied', 'undone', 'discarded', 'stale'].includes(item.status) && validPlanBasis(item) && validImpact(item) && validAlternativeBasis(item);
  }
  async function remember() { await persist(proposal ? structuredClone(proposal) : null); }
  function select(id, projectId) {
    if (!proposal || proposal.id !== id || proposal.projectId !== projectId)
      throw new Error('This proposal belongs to a different project or session. Generate a new proposal.');
    return proposal;
  }
  async function editable(item) {
    if (await isDirty(item.path)) throw new Error('Save or discard the native editor draft before changing this file.');
    return getFile(item.projectId, item.path);
  }
  return {
    current: () => proposal ? structuredClone(proposal) : null,
    ownershipToken,
    restore(item) { proposal = valid(item) ? structuredClone(item) : null; },
    assess() { return serialize(async () => {
      if (!proposal || !['proposed', 'applied'].includes(proposal.status)) return this.current();
      const item = proposal;
      try {
        const current = await getFile(item.projectId, item.path);
        if (item.status === 'applied') {
          item.conflict = current.source !== item.after || current.revision !== item.appliedRevision;
          item.reason = item.conflict ? 'This file changed after Apply. Undo is blocked to preserve those edits.' : undefined;
        } else {
          if (!await impactCurrent(item, 'assess')) { await staleImpact(item); return this.current(); }
          for (const context of guardedContext(item)) {
            const source = context.path === item.path ? current : await getFile(item.projectId, context.path);
            if (source.revision !== context.revision || item.planBasis !== undefined && await isDirty(context.path)) {
              item.status = 'stale'; item.reason = 'Selected source changed after this proposal was prepared. Generate a new proposal.';
              await remember(); break;
            }
          }
          if (item.status === 'proposed' && item.planBasis !== undefined) for (const context of guardedContext(item)) {
            if (await isDirty(context.path)) {
              item.status = 'stale'; item.reason = 'Selected source changed while this proposal was being checked. Generate a new proposal.';
              await remember(); break;
            }
          }
        }
      } catch {
        item.reason = 'A source file is unavailable. Restore it and refresh, or prepare a new proposal.';
        if (item.status === 'proposed') { item.status = 'stale'; await remember(); }
        else item.conflict = true;
      }
      return this.current();
    }); },
    set(item, { isCurrent = () => true } = {}) { return serialize(async () => {
      const cancelled = () => {
        const error = new Error('This proposal was cancelled before its checkpoint was ready.');
        error.name = 'AbortError';
        return error;
      };
      if (!isCurrent()) throw cancelled();
      if (!valid(item) || item.status !== 'proposed') throw new Error('The proposal is incomplete. Generate it again.');
      // A source-backed undo remains available until explicitly discarded.
      if (proposal?.status === 'applied') throw new Error('Undo or dismiss the applied proposal before replacing its checkpoint.');
      const next = structuredClone(item);
      // Keep the prior checkpoint usable until storage completes. Cancellation
      // can arrive while this operation is queued or while persistence awaits.
      await persist(structuredClone(next));
      if (!isCurrent()) {
        await remember();
        throw cancelled();
      }
      proposal = next;
      return this.current();
    }); },
    apply(id, projectId) { return serialize(async () => {
      const item = select(id, projectId);
      if (item.status !== 'proposed') throw new Error('Only a current, unapplied proposal can be applied.');
      const file = await editable(item);
      if (file.revision !== item.baseRevision || file.source !== item.before) {
        item.status = 'stale'; item.reason = 'The source changed after this proposal was prepared. Generate a new proposal.';
        await remember(); throw new Error(item.reason);
      }
      const context = guardedContext(item);
      for (const reference of context) {
        const current = await getFile(projectId, reference.path);
        if (current.revision !== reference.revision || await isDirty(reference.path)) {
          item.status = 'stale'; item.reason = 'Selected context changed after this proposal was prepared. Generate a new proposal.';
          await remember(); throw new Error(item.reason);
        }
      }
      // A supporting draft may appear while a later source read is pending.
      for (const reference of context) if (await isDirty(reference.path)) {
        item.status = 'stale'; item.reason = 'Selected context changed while preparing this edit. Generate a new proposal.';
        await remember(); throw new Error(item.reason);
      }
      if (!await impactCurrent(item, 'apply')) { await staleImpact(item); throw new Error(item.reason); }
      if (!await alternativeCurrent(item)) {
        item.status='stale'; item.reason='The retained alternative or its saved baseline changed. Inspect the saved candidate and prepare a new proposal.';
        await remember(); throw new Error(item.reason);
      }
      if (await isDirty(item.path)) throw new Error('The native editor changed while preparing this edit. Save or discard its draft first.');
      let saved;
      try {
        saved = await save({ projectId, path: item.path, source: item.after, baseRevision: item.baseRevision,
          expectedContext: context, ...(item.designImpact ? {designImpact: structuredClone(item.designImpact)} : {}),
          ...(item.alternativeBasis ? {alternativeBasis: structuredClone(item.alternativeBasis)} : {}) });
      } catch (error) {
        if (error?.code === 'context-conflict') {
          item.status = 'stale'; item.reason = 'Selected context changed while applying this proposal. Generate a new proposal.';
          await remember();
        }
        throw error;
      }
      item.status = 'applied'; item.appliedRevision = saved.revision; item.appliedAt = new Date().toISOString();
      await remember();
      return this.current();
    }); },
    undo(id, projectId) { return serialize(async () => {
      const item = select(id, projectId);
      if (item.status !== 'applied') throw new Error('This proposal has no applied change to undo.');
      const file = await editable(item);
      if (file.source !== item.after || file.revision !== item.appliedRevision)
        throw new Error('This file changed after Apply. Undo is blocked to preserve those edits; use the native diff to compare.');
      if (await isDirty(item.path)) throw new Error('The native editor changed while preparing Undo. Its draft is preserved.');
      await save({ projectId, path: item.path, source: item.before, baseRevision: file.revision });
      item.status = 'undone'; await remember();
      return this.current();
    }); },
    discard(id, projectId) { return serialize(async () => {
      const item = select(id, projectId);
      item.status = 'discarded'; await remember();
      return this.current();
    }); },
  };
}
