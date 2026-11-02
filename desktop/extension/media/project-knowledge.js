/* Local discovery over host-owned records. Search and relationships never authorize actions. */
(() => {
  "use strict";
  const kinds = ["all", "decision", "issue"], statuses = ["all", "current", "historical", "unavailable"];
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const identity = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
  const text = (value, max, multiline = false) => typeof value === "string" && value.length <= max && value.trim().length > 0 && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value);
  const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const path = value => text(value, 1000) && !/^[\/\\]/.test(value) && !value.includes("\\") && !value.split("/").some(part => !part || part === "." || part === "..");
  const keyValid = value => typeof value === "string" && /^(decision|issue):/.test(value) && identity(value.slice(value.indexOf(":") + 1));
  const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const newest = (a, b) => compareText(b.createdAt, a.createdAt) || compareText(a.key, b.key);
  const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const unique = values => [...new Set(values)].sort(compareText);
  const safeQuery = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 256) : "";
  const fold = value => value.normalize("NFKC").toLowerCase();
  function decisionStatus(status) {
    if (!object(status) || !["current", "stale", "missing"].includes(status.source) || !["applied", "undone", "missing"].includes(status.adoption) || !["available", "changed", "missing"].includes(status.evidence) || !["current", "stale"].includes(status.scope) || status.supersededBy !== undefined && !identity(status.supersededBy)) return null;
    return status.supersededBy ? "Superseded" : status.adoption === "undone" ? "Not applied" : status.source === "missing" || status.adoption === "missing" || status.evidence === "missing" ? "Unavailable" : status.source === "stale" || status.scope === "stale" || status.evidence === "changed" ? "Stale" : "Current";
  }
  function issueStatus(status) {
    if (!object(status) || !["current", "stale", "missing"].includes(status.source) || !["current", "stale", "missing"].includes(status.captureSource) || !["available", "changed", "missing"].includes(status.run) || !["available", "changed", "missing", "not-attached"].includes(status.replay) || !["available", "changed", "missing", "not-attached"].includes(status.capture)) return null;
    return status.source === "missing" || status.captureSource === "missing" || [status.run, status.replay, status.capture].includes("missing") ? "Evidence unavailable" : status.source === "stale" || status.captureSource === "stale" || [status.run, status.replay, status.capture].includes("changed") ? "Historical" : "Current source";
  }
  function evidenceReference(kind, value) {
    return object(value) && identity(value.id) && hash(value.digest) ? {kind, id:value.id, digest:value.digest} : null;
  }
  function evidenceFor(record, kind) {
    const result = [];
    if (kind === "decision") {
      for (const retained of Array.isArray(record.choice?.evidence) ? record.choice.evidence.slice(0, 2) : []) {
        if (!object(retained)) continue;
        for (const type of ["run", "replay", "capture"]) { const ref = evidenceReference(type, retained[type]); if (ref) result.push(ref); }
      }
    } else {
      const run = evidenceReference("run", {id:record.run?.id, digest:record.runDigest}); if (run) result.push(run);
      for (const type of ["replay", "capture"]) { const ref = evidenceReference(type, {id:record[type]?.[type]?.id, digest:record[type]?.digest}); if (ref) result.push(ref); }
    }
    const seen = new Set();
    return result.filter(ref => { const key = JSON.stringify([ref.kind, ref.id, ref.digest]); if (seen.has(key)) return false; seen.add(key); return true; }).sort((a,b) => compareText(a.kind,b.kind) || compareText(a.id,b.id) || compareText(a.digest,b.digest));
  }
  function itemFrom(entry, kind, projectId, storage) {
    if (!object(entry) || !object(entry.record) || !hash(entry.digest)) return null;
    const record = entry.record, feature = kind === "decision" ? record.feature : record.run?.feature, scope = kind === "decision" ? record.choice?.scope : record.run;
    const summary = kind === "decision" ? record.rationale : record.actualOutcome;
    if (record.projectId !== projectId || !identity(record.id) || !text(record.title,120) || !text(summary,2000,true) || !timestamp(record.createdAt) || !object(feature) || !identity(feature.id) || !text(feature.title,120) || !object(scope) || !text(scope.screen?.title,120) || !text(scope.scenario?.title,120)) return null;
    const sourceFiles = record.contextFiles;
    if (!Array.isArray(sourceFiles) || !sourceFiles.length || sourceFiles.length > 192 || sourceFiles.some(file => !object(file) || !path(file.path) || !hash(file.hash))) return null;
    const status = kind === "decision" ? decisionStatus(entry.status) : issueStatus(entry.status); if (!status) return null;
    const statusGroup = ["Current", "Current source"].includes(status) ? "current" : ["Unavailable", "Evidence unavailable"].includes(status) ? "unavailable" : "historical";
    const reason = storage !== "saved" ? "Restore local history storage before sharing." : text(entry.reason,2000,true) ? entry.reason : "";
    return {key:kind + ":" + record.id, kind, id:record.id, projectId, digest:entry.digest, title:record.title, summary, createdAt:record.createdAt,
      feature:{id:feature.id,title:feature.title}, paths:unique(sourceFiles.map(file => file.path)), screenTitle:scope.screen.title, scenarioTitle:scope.scenario.title, status, statusGroup,
      canShare:storage === "saved" && entry.canShare === true && (kind === "issue" || status === "Current") && !reason, reason, evidence:evidenceFor(record,kind)};
  }
  function project(input = {}) {
    if (!object(input)) return [];
    const {projectId, decisions, issues} = input;
    if (!identity(projectId)) return [];
    const items = [];
    for (const [kind, view] of [["decision",decisions],["issue",issues]]) {
      if (!object(view) || view.schemaVersion !== 1 || view.projectId !== projectId || !Number.isSafeInteger(view.revision) || view.revision < 0 || !["saved","saving","error","unavailable"].includes(view.storage?.status) || !Array.isArray(view.records) || view.records.length > 32) continue;
      const projected = view.records.map(entry => itemFrom(entry,kind,projectId,view.storage.status)).filter(Boolean), counts = new Map();
      for (const item of projected) counts.set(item.key,(counts.get(item.key) || 0) + 1);
      // An ambiguous identity cannot safely navigate or select its original record.
      items.push(...projected.filter(item => counts.get(item.key) === 1));
    }
    return items.sort(newest);
  }
  function usableItems(items) {
    return Array.isArray(items) && items.length <= 64 ? items.filter(item => object(item) && keyValid(item.key) && identity(item.projectId) && ["decision","issue"].includes(item.kind) && item.key === item.kind + ":" + item.id && text(item.title,120) && text(item.summary,2000,true) && timestamp(item.createdAt) && identity(item.feature?.id) && text(item.feature?.title,120) && Array.isArray(item.paths) && item.paths.length <= 192 && item.paths.every(path) && text(item.screenTitle,120) && text(item.scenarioTitle,120) && statuses.slice(1).includes(item.statusGroup)) : [];
  }
  function search(items, filters = {}) {
    if (!object(filters)) filters = {};
    const query = fold(safeQuery(filters.query)).trim().split(/\s+/u).filter(Boolean), kind = kinds.includes(filters.kind) ? filters.kind : "all", status = statuses.includes(filters.status) ? filters.status : "all", featureId = identity(filters.featureId) ? filters.featureId : "all";
    return usableItems(items).filter(item => {
      if ((kind !== "all" && item.kind !== kind) || (status !== "all" && item.statusGroup !== status) || (featureId !== "all" && item.feature.id !== featureId)) return false;
      const haystack = fold([item.title,item.summary,item.feature.title,item.screenTitle,item.scenarioTitle,...item.paths].join("\n"));
      return query.every(token => haystack.includes(token));
    }).sort(newest);
  }
  function related(items, key) {
    const values = usableItems(items), selected = values.find(item => item.key === key); if (!selected) return [];
    const refs = item => Array.isArray(item.evidence) ? item.evidence.filter(ref => ["run","replay","capture"].includes(ref?.kind) && identity(ref.id) && hash(ref.digest)) : [];
    return values.filter(item => item.key !== key && item.projectId === selected.projectId).sort(newest).flatMap(item => {
      const sharedPaths = unique(item.paths.filter(path => selected.paths.includes(path))), sameFeature = item.feature.id === selected.feature.id;
      const evidence = refs(item).filter(ref => refs(selected).some(other => other.kind === ref.kind && other.id === ref.id && other.digest === ref.digest)).map(ref => ({kind:ref.kind,id:ref.id,digest:ref.digest}));
      if (!sharedPaths.length && !sameFeature && !evidence.length) return [];
      const labels = [...(sharedPaths.length ? [sharedPaths.length === 1 ? "Shared source file" : "Shared source files"] : []), ...(sameFeature ? ["Same feature"] : []), ...(evidence.length ? ["Same retained evidence"] : [])];
      return [{key:item.key, sameFeature, sharedPaths, evidence, reason:labels.join(" · ")}];
    });
  }
  function normalize(value, projectId) {
    if (!identity(projectId)) return null;
    const defaults = {projectId,query:"",kind:"all",featureId:"all",status:"all",selectedKey:null};
    if (!object(value) || value.projectId !== projectId) return defaults;
    return {projectId, query:safeQuery(value.query), kind:kinds.includes(value.kind) ? value.kind : "all", featureId:identity(value.featureId) ? value.featureId : "all", status:statuses.includes(value.status) ? value.status : "all", selectedKey:keyValid(value.selectedKey) ? value.selectedKey : null};
  }
  const api = Object.freeze({project,search,related,normalize,normalizeViewState:normalize});
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.FoundationKnowledge = api;
})();
