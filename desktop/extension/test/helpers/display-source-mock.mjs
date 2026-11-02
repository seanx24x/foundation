// Legacy host fixtures retain their per-file read hooks; the production batch
// implementation is tested separately against actual filesystem guards.
export async function mockDisplaySources(projectId, paths, { isCurrent = () => true } = {}) {
  const files = [], unavailable = [];
  const check = () => { if (!isCurrent()) throw Object.assign(new Error('Source read cancelled'), { code: 'source-batch-cancelled' }); };
  for (const path of [...new Set(paths)]) {
    check();
    try { files.push(await this.getFile(projectId, path)); }
    catch (error) { unavailable.push({ path, code: error.code || 'source-unavailable', message: error.message }); }
    check();
  }
  check();
  return { files, unavailable, indexedAt: new Date().toISOString(), truncated: false };
}
