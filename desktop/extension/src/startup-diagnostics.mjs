const PHASES = new Set([
  'project-open', 'project-snapshot', 'selected-source-read',
  'preview-source-read', 'preview-runtime-read', 'preview-compilation',
]);

/** Local timing only. Never accepts source, paths, provider details or errors. */
export function createStartupDiagnostics(appendLine, {
  timestamp = () => new Date().toISOString(),
  clock = () => performance.now(),
} = {}) {
  let sequence = 0;
  const elapsed = () => {
    try { const value = clock(); return Number.isFinite(value) ? value : null; }
    catch { return null; }
  };
  function begin(input) {
    const id = ++sequence;
    // Even an accidental nonconstant phase cannot enter the diagnostic output.
    const phase = PHASES.has(input) ? input : 'operation';
    const started = elapsed();
    const emit = (event, details = {}) => {
      try { appendLine(JSON.stringify({ timestamp: timestamp(), id, phase, event, ...details })); }
      catch { /* Diagnostics must not change the operation's result or error. */ }
    };
    emit('started');
    return outcome => {
      const finished = elapsed();
      const durationMs = started === null || finished === null ? null : Math.max(0, Math.round(finished - started));
      emit('finished', { durationMs, outcome });
    };
  }
  return {
    runSync(phase, work) {
      const finish = begin(phase);
      try { const value = work(); finish('succeeded'); return value; }
      catch (error) { finish('failed'); throw error; }
    },
    async runAsync(phase, work) {
      const finish = begin(phase);
      try { const value = await work(); finish('succeeded'); return value; }
      catch (error) { finish('failed'); throw error; }
    },
  };
}
