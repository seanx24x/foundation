import { randomUUID } from 'node:crypto';

const MAX_FEATURES = 20;
const MAX_PATHS = 32;
const MAX_BYTES = 4 * 1024 * 1024;
const UNAVAILABLE = 'Saved features could not be read safely. They have been left unchanged.';
const STORAGE_FAILED = 'Features could not be saved locally. Retry saving before making another change.';
const copy = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const text = (value, limit) => typeof value === 'string' && value.length <= limit && !value.includes('\0');
const projectToken = value => text(value, 200) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const sourcePath = value => text(value, 1024) && value.length > 0 && value.trim() === value
  && !/[\\:\x00-\x1f\x7f]/.test(value)
  && value.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const exactKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const failure = (code, message) => Object.assign(new Error(message), { name: 'FeatureStoreError', code });
const invalid = () => failure('feature-invalid-input', 'Use a title of 1–80 characters, a brief of up to 2,000 characters, and up to 32 unique project paths. The entry must be one of those paths.');
function requireValue(condition) { if (!condition) throw invalid(); }
function pathsValue(value) {
  requireValue(Array.isArray(value) && value.length <= MAX_PATHS);
  requireValue(value.every(sourcePath) && new Set(value).size === value.length);
  return [...value];
}
function contentValue(input, previous, creating) {
  requireValue(object(input) && exactKeys(input, ['title', 'brief', 'paths', 'entryPath']));
  const title = own(input, 'title') ? input.title : previous?.title;
  requireValue(text(title, 2000));
  const trimmed = title.trim();
  requireValue(trimmed.length >= 1 && trimmed.length <= 80 && !/[\r\n\x00-\x1f\x7f]/.test(trimmed));
  const brief = own(input, 'brief') ? input.brief : previous?.brief ?? '';
  requireValue(text(brief, 2000));
  const paths = pathsValue(own(input, 'paths') ? input.paths : previous?.paths ?? []);
  let entryPath = own(input, 'entryPath') ? input.entryPath : previous?.entryPath;
  if (entryPath === null && !creating) entryPath = undefined;
  requireValue(entryPath === undefined || sourcePath(entryPath) && paths.includes(entryPath));
  return { title: trimmed, brief, paths, ...(entryPath === undefined ? {} : { entryPath }) };
}
function dataValue(value, projectId) {
  requireValue(object(value) && exactKeys(value, ['schemaVersion', 'projectId', 'revision', 'activeId', 'features'])
    && value.schemaVersion === 1 && value.projectId === projectId
    && Number.isSafeInteger(value.revision) && value.revision >= 0 && value.revision < Number.MAX_SAFE_INTEGER
    && Array.isArray(value.features) && value.features.length <= MAX_FEATURES);
  requireValue(Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_BYTES);
  const ids = new Set();
  const features = value.features.map(item => {
    requireValue(object(item) && exactKeys(item, ['id', 'title', 'brief', 'paths', 'entryPath', 'archived', 'createdAt', 'updatedAt'])
      && uuid(item.id) && !ids.has(item.id) && timestamp(item.createdAt) && timestamp(item.updatedAt)
      && typeof item.archived === 'boolean');
    const content = contentValue({ title: item.title, brief: item.brief, paths: item.paths,
      ...(own(item, 'entryPath') ? { entryPath: item.entryPath } : {}) }, undefined, true);
    requireValue(content.title === item.title);
    ids.add(item.id);
    return { id: item.id, ...content, archived: item.archived, createdAt: item.createdAt, updatedAt: item.updatedAt };
  });
  requireValue(value.activeId === null || features.some(item => item.id === value.activeId && !item.archived));
  return { schemaVersion: 1, projectId, revision: value.revision, activeId: value.activeId, features };
}

/** Durable feature metadata only. Never opens files, calls providers, or starts a runtime. */
export function createFeatureStore({ projectId, read, write, onChange = () => {} }) {
  if (!projectToken(projectId) || typeof read !== 'function' || typeof write !== 'function') {
    throw failure('feature-invalid-project', 'A stable local project identity and storage adapter are required.');
  }
  const empty = () => ({ schemaVersion: 1, projectId, revision: 0, activeId: null, features: [] });
  let data = empty();
  let storage = { status: 'saved' };
  let tail = Promise.resolve();
  let closing = false;
  let closed = false;
  let disposal;
  const snapshot = () => ({ ...copy(data), storage: { ...storage } });
  const notify = () => { try { onChange(); } catch { /* Observer failures cannot invalidate persistence. */ } };
  function load() {
    const previous = read();
    // Storage reads are synchronous (for example VS Code workspaceState.get).
    // A promise or an unknown schema is unavailable, never an empty new store.
    data = previous === undefined || previous === null ? empty() : dataValue(previous, projectId);
    storage = { status: 'saved' };
  }
  try { load(); } catch { storage = { status: 'unavailable', message: UNAVAILABLE }; }
  function enqueue(operation) {
    if (closing || closed) return Promise.reject(failure('feature-closed', 'This feature workspace has closed.'));
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  }
  function available(expectedRevision) {
    if (storage.status === 'unavailable') throw failure('feature-unavailable', UNAVAILABLE);
    if (storage.status === 'error') throw failure('feature-storage', STORAGE_FAILED);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== data.revision) {
      throw failure('feature-stale-revision', 'This feature workspace changed. Review its latest state before saving.');
    }
  }
  async function persist() {
    storage = { status: 'saving' }; notify();
    try { await write(copy(data)); }
    catch { storage = { status: 'error', message: STORAGE_FAILED }; notify(); throw failure('feature-storage', STORAGE_FAILED); }
    storage = { status: 'saved' }; notify();
    return snapshot();
  }
  async function mutate(expectedRevision, transform) {
    available(expectedRevision);
    const next = copy(data);
    if (!transform(next)) return snapshot();
    if (next.revision >= Number.MAX_SAFE_INTEGER - 1) throw failure('feature-capacity', 'The feature workspace reached its revision limit. Existing data has been preserved.');
    next.revision++;
    if (Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_BYTES) throw failure('feature-capacity', 'The feature workspace reached its storage limit. Existing data has been preserved.');
    data = next;
    return persist();
  }
  function feature(state, id) {
    const found = state.features.find(item => item.id === id);
    if (!found) throw failure('feature-unknown', 'This feature is not available in the current project.');
    return found;
  }
  const capture = (input, operation) => {
    // Capture before queuing so a caller cannot change an action while another
    // persistence operation is in flight.
    let value;
    try { value = copy(input); } catch { return Promise.reject(invalid()); }
    return enqueue(() => operation(value));
  };
  return {
    snapshot,
    create(input, expectedRevision) {
      return capture(input, value => mutate(expectedRevision, next => {
        if (next.features.length >= MAX_FEATURES) throw failure('feature-capacity', 'This project has reached its 20-feature limit. Archived features are preserved.');
        const content = contentValue(value, undefined, true);
        const now = new Date().toISOString();
        const item = { id: randomUUID(), ...content, archived: false, createdAt: now, updatedAt: now };
        next.features.push(item); next.activeId = item.id;
        return true;
      }));
    },
    update(id, patch, expectedRevision) {
      return capture(patch, value => mutate(expectedRevision, next => {
        const item = feature(next, id);
        const content = contentValue(value, item, false);
        if (item.title === content.title && item.brief === content.brief && JSON.stringify(item.paths) === JSON.stringify(content.paths) && item.entryPath === content.entryPath) return false;
        delete item.entryPath;
        Object.assign(item, content, { updatedAt: new Date().toISOString() });
        return true;
      }));
    },
    select(id, expectedRevision) {
      return enqueue(() => mutate(expectedRevision, next => {
        if (id !== null && feature(next, id).archived) throw failure('feature-archived', 'Restore this feature before selecting it.');
        if (next.activeId === id) return false;
        next.activeId = id;
        return true;
      }));
    },
    archive(id, archived, expectedRevision) {
      return enqueue(() => mutate(expectedRevision, next => {
        if (typeof archived !== 'boolean') throw invalid();
        const item = feature(next, id);
        if (item.archived === archived) return false;
        item.archived = archived; item.updatedAt = new Date().toISOString();
        if (archived && next.activeId === id) next.activeId = null;
        return true;
      }));
    },
    retry() {
      return enqueue(async () => {
        if (storage.status === 'unavailable') {
          try { load(); notify(); return snapshot(); }
          catch { storage = { status: 'unavailable', message: UNAVAILABLE }; notify(); throw failure('feature-unavailable', UNAVAILABLE); }
        }
        return storage.status === 'error' ? persist() : snapshot();
      });
    },
    dispose() {
      if (!disposal) { closing = true; disposal = tail.then(() => { closed = true; }); }
      return disposal;
    },
  };
}

/** Suggestions are evidence-labeled candidates, never automatic feature membership. */
export function suggestFeatureFiles({ anchorFile, inventory, existingPaths = [] } = {}) {
  if (!object(anchorFile) || !sourcePath(anchorFile.path) || !Array.isArray(inventory)) return [];
  const known = new Set(inventory.filter(item => object(item) && sourcePath(item.path)).map(item => item.path));
  if (!known.has(anchorFile.path)) return [];
  const excluded = new Set([anchorFile.path, ...(Array.isArray(existingPaths) ? existingPaths.filter(sourcePath) : [])]);
  const result = [];
  const add = (path, reason, provenance, line) => {
    if (result.length >= 24 || !known.has(path) || excluded.has(path)) return;
    excluded.add(path);
    result.push({ path, reason, provenance, ...(Number.isSafeInteger(line) && line >= 1 ? { line } : {}) });
  };
  const analysis = anchorFile.analysis;
  if (object(analysis) && analysis.unsupported !== true) {
    for (const item of Array.isArray(analysis.imports) ? analysis.imports : []) {
      // An import's line belongs to the anchor, not the imported file.
      if (object(item)) add(item.resolvedPath, 'import', 'source');
    }
    for (const item of Array.isArray(analysis.consumers) ? analysis.consumers : []) {
      if (object(item)) add(item.path, 'consumer', 'source', item.line);
    }
  }
  const basename = anchorFile.path.split('/').at(-1).replace(/\.[^.]+$/, '').replace(/\.(?:test|spec)$/, '');
  for (const candidate of known) {
    const stem = candidate.split('/').at(-1).replace(/\.[^.]+$/, '');
    if (stem === `${basename}.test` || stem === `${basename}.spec` || stem === basename && candidate.split('/').includes('__tests__')) {
      add(candidate, 'test-name', 'filename');
    }
  }
  return result;
}
