/* Foundation workspace geometry and historical comparisons. No project or provider side effects. */
(function (scope) {
  'use strict';
  function snapWidth(value, min = 280, max = 480) {
    const number = typeof value === 'number' && Number.isFinite(value) ? value : 320;
    return Math.max(min, Math.min(max, Math.round(number / 4) * 4));
  }
  function resolveLayout(containerWidth, desiredWidth = 320) {
    const available = Number.isFinite(containerWidth) ? Math.max(0, containerWidth) : 0;
    const desired = snapWidth(desiredWidth);
    const compact = available < 760;
    const max = Math.max(280, Math.min(480, Math.floor((available - 480) / 4) * 4));
    return { width: snapWidth(desired, 280, max), max, compact, desired };
  }
  function keyboardWidth(current, key, shift, max = 480) {
    const step = shift ? 32 : 4;
    if (key === 'ArrowLeft') return snapWidth(current + step, 280, max);
    if (key === 'ArrowRight') return snapWidth(current - step, 280, max);
    if (key === 'Home') return 280;
    if (key === 'End') return max;
    return null;
  }
  function normalizeLayouts(input) {
    const result = Object.create(null);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
    for (const [key, value] of Object.entries(input).slice(-32)) {
      if (!key || key.length > 300 || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      result[key] = { inspectorWidth: snapWidth(value.inspectorWidth) };
    }
    return result;
  }
  const recordObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const recordText = (value, limit) => typeof value === 'string' && value.length <= limit && !value.includes('\0');
  const recordId = value => recordText(value, 200) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
  const recordRevision = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
  const recordTitle = value => recordText(value, 80) && value.length > 0 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
  const recordPath = value => recordText(value, 1024) && value.length > 0 && value.trim() === value && !/[\\:\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
  const recordTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const recordHex = (value, length) => typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value);
  const recordKeys = (value, allowed) => recordObject(value) && Object.keys(value).every(key => allowed.includes(key));
  const recordPaths = value => Array.isArray(value) && value.length <= 32 && Array.from(value).every(recordPath) && new Set(value).size === value.length;
  const recordRoute = value => recordText(value, 512) && /^\/[A-Za-z0-9/._~!$&'()*+,;=@-]*$/.test(value) && !value.includes('//') && !value.split('/').some(part => part === '.' || part === '..') && !/^\/__foundation(?:\/|$)/.test(value);
  const finishedRun = run => ['completed', 'cancelled', 'interrupted'].includes(run.status);

  function validObservationRun(run) {
    if (!recordKeys(run, ['id','feature','screen','scenario','definitionRevision','runtime','sources','dirtyPaths','startedAt','endedAt','status','assessment','note','interruption','observations','truncated']) || !recordId(run.id) ||
        !['recording','completed','cancelled','interrupted'].includes(run.status) || !recordTime(run.startedAt) ||
        !['not-assessed','matched','not-matched'].includes(run.assessment) || !recordText(run.note, 2000) || typeof run.truncated !== 'boolean' ||
        (run.interruption !== undefined && (!recordText(run.interruption, 500) || !run.interruption.trim()))) return false;
    if (run.status === 'recording' ? run.endedAt !== undefined || run.assessment !== 'not-assessed' : !recordTime(run.endedAt)) return false;
    if (run.status !== 'completed' && run.assessment !== 'not-assessed') return false;
    const {feature, screen, scenario, runtime} = run;
    if (!recordKeys(feature, ['id','title','revision','paths']) || !recordId(feature.id) || !recordTitle(feature.title) || !recordRevision(feature.revision) || !recordPaths(feature.paths) || !feature.paths.length) return false;
    if (!recordKeys(screen, ['id','featureId','title','targetId','route','archived','createdAt','updatedAt']) || !recordId(screen.id) || screen.featureId !== feature.id || !recordTitle(screen.title) ||
        !recordId(screen.targetId) || !recordRoute(screen.route) || screen.archived !== false || !recordTime(screen.createdAt) || !recordTime(screen.updatedAt)) return false;
    if (!recordKeys(scenario, ['id','screenId','title','steps','expectedOutcome','archived','createdAt','updatedAt']) || !recordId(scenario.id) || scenario.screenId !== screen.id || !recordTitle(scenario.title) ||
        !Array.isArray(scenario.steps) || scenario.steps.length < 1 || scenario.steps.length > 12 || !Array.from(scenario.steps).every(step => recordText(step, 500) && step.trim()) ||
        !recordText(scenario.expectedOutcome, 2000) || !scenario.expectedOutcome.trim() || scenario.archived !== false || !recordTime(scenario.createdAt) || !recordTime(scenario.updatedAt) || !recordRevision(run.definitionRevision)) return false;
    if (!recordKeys(runtime, ['targetId','session','viewId','documentId','route','pageVersion']) || runtime.targetId !== screen.targetId || runtime.route !== screen.route ||
        !recordHex(runtime.session, 32) || !recordHex(runtime.viewId, 32) || !recordHex(runtime.documentId, 32) || !recordRevision(runtime.pageVersion) || runtime.pageVersion < 1) return false;
    if (!Array.isArray(run.sources) || run.sources.length < 1 || run.sources.length > 32 || run.sources.length !== feature.paths.length || !Array.from(run.sources).every(source => recordKeys(source, ['path','revision']) &&
        feature.paths.includes(source.path) && recordHex(source.revision, 64)) || new Set(run.sources.map(source => source.path)).size !== run.sources.length ||
        !recordPaths(run.dirtyPaths) || !run.dirtyPaths.every(path => feature.paths.includes(path))) return false;
    if (!Array.isArray(run.observations) || run.observations.length > 100 || new Set(run.observations.map(request => request?.id)).size !== run.observations.length) return false;
    return Array.from(run.observations).every(request => {
      if (!recordKeys(request, ['id','session','documentId','kind','method','url','status','durationMs','outcome','observedAt','timing','correlation']) || !recordText(request.id, 140) ||
          !request.id.startsWith(`${runtime.session}:${runtime.viewId}:`) || request.session !== runtime.session || request.documentId !== runtime.documentId || request.kind !== 'request' ||
          typeof request.method !== 'string' || !/^[A-Z]{1,16}$/.test(request.method) || !recordText(request.url, 1024) ||
          !(request.status === null || Number.isInteger(request.status) && request.status >= 100 && request.status <= 599) || !Number.isFinite(request.durationMs) || request.durationMs < 0 || request.durationMs > 3600000 ||
          !['success','http-error','network-error','aborted'].includes(request.outcome) || !recordTime(request.observedAt) || Date.parse(request.observedAt) < Date.parse(run.startedAt) ||
          (run.endedAt && Date.parse(request.observedAt) > Date.parse(run.endedAt)) || !['response-headers','response-complete'].includes(request.timing) || request.correlation !== 'unattributed') return false;
      try { const url = new URL(request.url); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; }
      catch { return false; }
    });
  }

  function observationInput(snapshot, options) {
    if (!recordObject(options) || !recordId(options.projectId) || !recordId(options.featureId) || !recordObject(snapshot) || snapshot.projectId !== options.projectId ||
        snapshot.schemaVersion !== 1 || !recordRevision(snapshot.revision) || !Array.isArray(snapshot.runs) || snapshot.runs.length > 40 ||
        !Array.from(snapshot.runs).every(validObservationRun) || new Set(snapshot.runs.map(run => run.id)).size !== snapshot.runs.length || snapshot.runs.filter(run => run.status === 'recording').length > 1) return null;
    if (snapshot.runFreshness !== undefined && (!Array.isArray(snapshot.runFreshness) || snapshot.runFreshness.length > 40 || new Set(snapshot.runFreshness.map(item => item?.id)).size !== snapshot.runFreshness.length ||
        !Array.from(snapshot.runFreshness).every(item => recordKeys(item, ['id','status','reason']) && snapshot.runs.some(run => run.id === item.id) && ['current','stale','unknown'].includes(item.status) &&
          (item.reason === undefined || recordText(item.reason, 2000))))) return null;
    if (snapshot.storage !== undefined && (!recordObject(snapshot.storage) || !['saved','saving','error'].includes(snapshot.storage.status))) return null;
    return snapshot.runs.filter(run => finishedRun(run) && run.feature.id === options.featureId).slice().sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt) || a.id.localeCompare(b.id));
  }

  /** Finished historical records only. Returned run references are read-only inputs, never mutated. */
  function observationChoices(snapshot, options) {
    try { return observationInput(snapshot, options) || []; } catch { return []; }
  }

  function observationFreshness(snapshot, run) {
    const fresh = snapshot.runFreshness?.find(item => item.id === run.id);
    return fresh ? {status:fresh.status, reason:fresh.reason || (fresh.status === 'current' ? 'Saved source and definitions match; this remains historical evidence.' : fresh.status === 'stale' ? 'Saved source or definitions changed after this observation.' : 'Current source freshness has not been established.')}
      : {status:'unknown', reason:'Current source freshness has not been established.'};
  }

  /** Read-only historical comparison. No replay, causal inference, scoring, or performance deltas. */
  function compareObservations(snapshot, options) {
    const unavailable = reason => ({status:'unavailable', reason});
    try {
      const choices = observationInput(snapshot, options);
      if (!choices) return unavailable('Saved observations are unavailable for this project and feature, or their records could not be validated.');
      const {beforeId, afterId} = options;
      const missing = value => value === undefined || value === null || value === '';
      if ((!missing(beforeId) && !recordId(beforeId)) || (!missing(afterId) && !recordId(afterId))) return unavailable('Choose two saved observations from this feature.');
      if (missing(beforeId) && missing(afterId)) return {status:'empty', reason:choices.length ? 'Choose two saved observations to compare.' : 'No finished observations are available for this feature.'};
      const left = missing(beforeId) ? null : choices.find(run => run.id === beforeId), right = missing(afterId) ? null : choices.find(run => run.id === afterId);
      if ((!missing(beforeId) && !left) || (!missing(afterId) && !right)) return unavailable('A selected observation is missing, still recording, or belongs to another feature.');
      if (left && right && left.id === right.id) return unavailable('Choose two different observations.');
      const before = left ? {run:left, freshness:observationFreshness(snapshot, left)} : undefined;
      const after = right ? {run:right, freshness:observationFreshness(snapshot, right)} : undefined;
      if (!left || !right) return {status:'incomplete', reason:'Choose the other saved observation.', ...(before ? {before} : {}), ...(after ? {after} : {})};
      if (left.screen.id !== right.screen.id) return unavailable('Choose observations recorded for the same screen.');
      const condition = (label, a, b) => ({label, before:a, after:b, changed:a !== b});
      const membership = run => run.feature.paths.slice().sort().join('\n');
      const scenario = run => `${run.scenario.title} · ${run.scenario.id}`;
      const conditions = [
        condition('Screen', left.screen.title, right.screen.title),
        condition('Scenario', scenario(left), scenario(right)),
        condition('Steps', left.scenario.steps.map((step, index) => `${index + 1}. ${step}`).join('\n'), right.scenario.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')),
        condition('Expected result', left.scenario.expectedOutcome, right.scenario.expectedOutcome),
        condition('Runtime target', left.runtime.targetId, right.runtime.targetId),
        condition('Route', left.runtime.route, right.runtime.route),
        condition('Feature', left.feature.title, right.feature.title),
        condition('Feature files', membership(left), membership(right)),
      ];
      const leftSources = new Map(left.sources.map(source => [source.path, source.revision])), rightSources = new Map(right.sources.map(source => [source.path, source.revision]));
      const sources = [...new Set([...leftSources.keys(), ...rightSources.keys()])].sort().map(path => {
        const beforeRevision = leftSources.get(path) || null, afterRevision = rightSources.get(path) || null;
        return {path, beforeRevision, afterRevision, status:beforeRevision === null ? 'added' : afterRevision === null ? 'removed' : beforeRevision === afterRevision ? 'same' : 'changed'};
      });
      const warnings = [
        'Viewport, theme, application data, and motion settings were not recorded; these conditions are unknown.',
        'Matching saved conditions do not establish equivalent behavior. Manual assessments and recorded requests remain separate evidence; causality is unconfirmed.',
      ];
      for (const [label, entry] of [['Baseline', before], ['Comparison', after]]) {
        if (entry.run.status !== 'completed') warnings.push(`${label} observation was ${entry.run.status}; its captured evidence may be incomplete.`);
        if (entry.run.truncated) warnings.push(`${label} observation reached the request capture limit; its evidence is incomplete.`);
        if (Date.parse(entry.run.endedAt) < Date.parse(entry.run.startedAt)) warnings.push(`${label} observation has a recorded finish timestamp before its start timestamp; interval timing cannot be interpreted.`);
        if (entry.run.dirtyPaths.length) warnings.push(`${label} excludes ${entry.run.dirtyPaths.length} unsaved ${entry.run.dirtyPaths.length === 1 ? 'draft' : 'drafts'} from its saved-source evidence.`);
        if (entry.freshness.status === 'stale') warnings.push(`${label} evidence is stale relative to current saved source or definitions.`);
        if (entry.freshness.status === 'unknown') warnings.push(`${label} evidence freshness is unknown.`);
      }
      const changed = label => conditions.find(row => row.label === label).changed;
      if (changed('Scenario') || changed('Steps') || changed('Expected result')) warnings.push('The recorded scenario differs between observations; they are not presented as an equivalent rerun.');
      if (changed('Runtime target')) warnings.push('The recorded runtime target differs between observations.');
      if (changed('Route')) warnings.push('The recorded route differs between observations.');
      if (changed('Feature') || changed('Feature files')) warnings.push('The recorded feature scope differs between observations.');
      if (sources.some(source => source.status !== 'same')) warnings.push('Recorded saved-source revisions or membership differ; this comparison does not establish their effect on behavior.');
      if (snapshot.storage?.status === 'saving') warnings.push('Observation storage is still saving; these records may not yet be persisted.');
      if (snapshot.storage?.status === 'error') warnings.push('Observation storage reports an error; these records show the retained local state.');
      return {status:'ready', reason:'Saved observations are shown side by side. No scenario was replayed and no verification verdict is inferred.', before, after, sources, conditions, warnings};
    } catch { return unavailable('The saved observation comparison could not be validated.'); }
  }

  const api = Object.freeze({ snapWidth, resolveLayout, keyboardWidth, normalizeLayouts, observationChoices, compareObservations });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.FoundationWorkspace = api;
})(typeof window === 'undefined' ? globalThis : window);
