import {createHash} from 'node:crypto';
import postcss from 'postcss';
import {analyzeRelationships, assertRelationshipsCurrent} from './relationships.mjs';
import {listDesignTokens} from './proposals.mjs';

const MAX_ITEMS = 200, MAX_FILES = 1500, MAX_BYTES = 8 * 1024 * 1024;
const EDGE_KINDS = new Set(['import','re-export','stylesheet','call','render','type-reference','test-reference']);
const LIMIT_KINDS = new Set(['unsupported','limit','unavailable','parse-error','unresolved']);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value,key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const text = (value, max = 2048) => typeof value === 'string' && bytes(value) <= max && !/[\u0000-\u001f\u007f]/.test(value) && Buffer.from(value,'utf8').toString('utf8') === value;
const pathValue = value => text(value,1000) && !!value && !/^[\/\\]/.test(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..');
const revision = value => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value);
const integer = (value,max = 1000000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const tokenName = value => typeof value === 'string' && /^--[a-zA-Z_][a-zA-Z0-9_-]*$/.test(value) && value.length <= 256;
const normalize = (value,max = 2048) => { const data = Buffer.from(String(value).replace(/\s+/g,' ').trim(),'utf8'); return data.length <= max ? data.toString('utf8') : data.subarray(0,max).toString('utf8').replace(/\uFFFD$/,''); };
const identity = (prefix,value) => `${prefix}-${hash(value).slice(0,16)}`;
export class ChangeImpactError extends Error { constructor(message = 'The saved change impact is invalid. Refresh its source analysis.',code = 'invalid-change-impact') { super(message); this.name = 'ChangeImpactError'; this.status = 400; this.code = code; } }
const check = condition => { if (!condition) throw new ChangeImpactError(); };
function targetValue(value) {
  check(exact(value,['kind','path','revision'],value?.kind === 'token' ? ['name','occurrence'] : []) && ['component','token'].includes(value.kind) && pathValue(value.path) && revision(value.revision));
  if (value.kind === 'token') check(tokenName(value.name) && integer(value.occurrence) && value.path.endsWith('.css'));
  return {...value};
}
function reference(value,manifest) {
  check(exact(value,['path','revision','line','column'],['endLine','endColumn','label']) && pathValue(value.path) && revision(value.revision) && manifest.get(value.path) === value.revision && integer(value.line) && value.line > 0 && integer(value.column) && value.column > 0);
  check((value.endLine === undefined) === (value.endColumn === undefined));
  if (value.endLine !== undefined) check(integer(value.endLine) && integer(value.endColumn) && value.endColumn > 0 && (value.endLine > value.line || value.endLine === value.line && value.endColumn >= value.column));
  if (value.label !== undefined) check(text(value.label,720));
  return {...value};
}
function uniqueIds(items) { check(new Set(items.map(item => item.id)).size === items.length); }
function point(file,start,end) {
  const a = file.source.slice(0,start).split('\n'), b = file.source.slice(0,end).split('\n');
  return {path:file.path,revision:file.revision,line:a.length,column:a.at(-1).length + 1,endLine:b.length,endColumn:b.at(-1).length + 1};
}

/** Strict persisted checkpoint validation; no source or runtime execution. */
export function validateChangeImpact(value,projectId = value?.projectId) {
  check(exact(value,['schemaVersion','projectId','target','scope','manifest','basisDigest','analyzedAt','consumers','tokenReferences','declarations','limits','truncated','counts']) && value.schemaVersion === 1 && text(value.projectId,200) && !!value.projectId && value.projectId === projectId && bytes(value) <= 4 * 1024 * 1024);
  const target = targetValue(value.target);
  check(Array.isArray(value.manifest) && value.manifest.length > 0 && value.manifest.length <= MAX_FILES);
  const manifest = new Map();
  for (const item of value.manifest) { check(exact(item,['path','revision']) && pathValue(item.path) && revision(item.revision) && !manifest.has(item.path)); manifest.set(item.path,item.revision); }
  check(manifest.get(target.path) === target.revision && JSON.stringify(value.manifest) === JSON.stringify([...value.manifest].sort((a,b) => a.path.localeCompare(b.path))) && value.basisDigest === hash(value.manifest));
  check(typeof value.analyzedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.analyzedAt) && Number.isFinite(Date.parse(value.analyzedAt)) && typeof value.truncated === 'boolean');
  check(exact(value.scope,['kind','label','source']) && value.scope.kind === (target.kind === 'token' ? 'css-declaration' : 'source-file') && text(value.scope.label,4096));
  reference(value.scope.source,manifest); check(value.scope.source.path === target.path && value.scope.source.revision === target.revision);
  for (const key of ['consumers','tokenReferences','declarations']) check(Array.isArray(value[key]) && value[key].length <= MAX_ITEMS);
  for (const item of value.consumers) {
    check(exact(item,['id','kind','from','to','provenance'],['detail']) && EDGE_KINDS.has(item.kind) && item.provenance === 'source' && (item.detail === undefined || text(item.detail)));
    reference(item.from,manifest); reference(item.to,manifest); check(item.to.path === target.path && item.from.path !== target.path);
    const {id,...body} = item; check(id === identity('relationship',body));
  }
  for (const item of value.tokenReferences) {
    check(exact(item,['id','name','scope','property','source','provenance']) && target.kind === 'token' && item.name === target.name && text(item.scope,4096) && text(item.property,256) && item.provenance === 'source');
    reference(item.source,manifest); check(item.source.endLine !== undefined && item.source.path.endsWith('.css'));
    const {id,...body} = item; check(id === identity('token-reference',body));
  }
  for (const item of value.declarations) {
    check(exact(item,['id','name','occurrence','scope','value','selected','source']) && target.kind === 'token' && item.name === target.name && integer(item.occurrence) && text(item.scope,4096) && text(item.value,2048) && typeof item.selected === 'boolean');
    reference(item.source,manifest); check(item.source.endLine !== undefined && item.source.path.endsWith('.css') && item.selected === (item.source.path === target.path && item.occurrence === target.occurrence));
    const {id,...body} = item; check(id === identity('token-declaration',body));
  }
  for (const key of ['consumers','tokenReferences','declarations']) uniqueIds(value[key]);
  if (target.kind === 'token') { const selected = value.declarations.filter(item => item.selected); check(selected.length === 1 && JSON.stringify(selected[0].source) === JSON.stringify(value.scope.source) && selected[0].scope === value.scope.label); }
  else check(value.tokenReferences.length === 0 && value.declarations.length === 0 && value.scope.source.line === 1 && value.scope.source.column === 1);
  check(Array.isArray(value.limits) && value.limits.length <= 100);
  for (const item of value.limits) check(exact(item,['kind','detail'],['path']) && LIMIT_KINDS.has(item.kind) && text(item.detail) && !!item.detail && (item.path === undefined || pathValue(item.path)));
  check(exact(value.counts,['indexed','analyzed','consumers','tokenReferences','declarations']) && integer(value.counts.indexed,MAX_FILES) && value.counts.indexed >= manifest.size && integer(value.counts.analyzed,MAX_FILES) && value.counts.analyzed <= value.counts.indexed);
  for (const key of ['consumers','tokenReferences','declarations']) check(value.counts[key] === value[key].length);
  return structuredClone(value);
}

export function validateDesignImpactCheckpoint(value,projectId) {
  check(exact(value,['version','result','relatedScenarios']) && value.version === 1 && Array.isArray(value.relatedScenarios) && value.relatedScenarios.length <= 40);
  const result = validateChangeImpact(value.result,projectId), manifest = new Set(result.manifest.map(item => item.path));
  const seen = new Set();
  for (const row of value.relatedScenarios) {
    check(exact(row,['featureId','featureTitle','screenId','screenTitle','scenarioId','scenarioTitle','paths','suiteNames']));
    for (const key of ['featureId','screenId','scenarioId']) check(text(row[key],200) && !!row[key]);
    for (const key of ['featureTitle','screenTitle','scenarioTitle']) check(text(row[key],512) && !!row[key]);
    check(Array.isArray(row.paths) && row.paths.length > 0 && row.paths.length <= 32 && new Set(row.paths).size === row.paths.length && row.paths.every(path => pathValue(path) && manifest.has(path)));
    check(Array.isArray(row.suiteNames) && row.suiteNames.length <= 20 && new Set(row.suiteNames).size === row.suiteNames.length && row.suiteNames.every(name => text(name,512) && !!name));
    const id = JSON.stringify([row.featureId,row.screenId,row.scenarioId]); check(!seen.has(id)); seen.add(id);
  }
  return {version:1,result,relatedScenarios:structuredClone(value.relatedScenarios)};
}

// CSS name references are syntax evidence, never a resolution of the cascade.
// Strings/comments/escaped function names are deliberately not treated as var().
function varReferences(source,start,end,name) {
  const refs = []; let quote = '', comment = false;
  for (let i = start; i < end; i++) {
    const char = source[i], next = source[i + 1];
    if (comment) { if (char === '*' && next === '/') { comment = false; i++; } continue; }
    if (quote) { if (char === '\\') i++; else if (char === quote) quote = ''; continue; }
    if (char === '/' && next === '*') { comment = true; i++; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '\\') { i++; continue; }
    if (source.slice(i,i + 4) !== 'var(' || i > start && /[\w\u0080-\uffff-]/.test(source[i - 1])) continue;
    let j = i + 4;
    while (j < end) {
      if (/\s/.test(source[j])) { j++; continue; }
      if (source.slice(j,j + 2) === '/*') { const close = source.indexOf('*/',j + 2); if (close < 0 || close >= end) break; j = close + 2; continue; }
      break;
    }
    if (source.slice(j,j + name.length) !== name) continue;
    let after = j + name.length;
    while (after < end) {
      if (/\s/.test(source[after])) { after++; continue; }
      if (source.slice(after,after + 2) === '/*') { const close = source.indexOf('*/',after + 2); if (close < 0 || close >= end) break; after = close + 2; continue; }
      break;
    }
    if ([',',')'].includes(source[after])) refs.push({start:j,end:j + name.length});
  }
  return refs;
}
function cssScope(node) { const parts = []; for (let p = node.parent; p && p.type !== 'root'; p = p.parent) parts.unshift(p.type === 'atrule' ? `@${p.name}${p.params ? ` ${p.params}` : ''}` : p.selector || ''); return normalize(parts.join(' / '),4096); }

/** Read-only analysis over the same bounded, safe saved-source inventory as relationships. */
export async function analyzeChangeImpact({projectId,target:input,files,indexedCount = files.length,inventoryTruncated = false,unavailable = [],isCurrent}) {
  assertRelationshipsCurrent(isCurrent);
  const target = targetValue(input);
  check(Array.isArray(files) && files.length > 0 && files.length <= MAX_FILES && files.reduce((sum,file) => sum + bytes(file.source),0) <= MAX_BYTES);
  const file = files.find(item => item.path === target.path);
  if (!file || file.revision !== target.revision) throw new ChangeImpactError('The selected source changed. Refresh the impact preview.','impact-stale');
  const graph = await analyzeRelationships({projectId,anchorPath:target.path,files,indexedCount,inventoryTruncated,unavailable,isCurrent});
  const result = {schemaVersion:1,projectId,target,scope:{kind:'source-file',label:'Mapped source file; individual rendered instances are not resolved.',source:{path:target.path,revision:target.revision,line:1,column:1}},manifest:graph.manifest,basisDigest:hash(graph.manifest),analyzedAt:graph.analyzedAt,consumers:[],tokenReferences:[],declarations:[],limits:graph.boundaries.map(({kind,detail,path}) => ({kind,detail,...(path ? {path} : {})})).slice(0,95),truncated:graph.truncated,counts:{indexed:graph.counts.indexed,analyzed:graph.counts.analyzed,consumers:0,tokenReferences:0,declarations:0}};
  result.limits.push({kind:'unsupported',detail:'Only direct, proven source references are listed. Transitive consumers, live instances, behavior, and test coverage are not established. Unsaved edits are excluded.'});
  const normalizedRef = ref => ({...ref,...(ref.label !== undefined ? {label:normalize(ref.label,180)} : {})});
  result.consumers = graph.edges.filter(edge => edge.to.path === target.path && edge.from.path !== target.path).map(({id:_id,...edge}) => { const body = {...edge,from:normalizedRef(edge.from),to:normalizedRef(edge.to)}; return {id:identity('relationship',body),...body}; });
  if (target.kind === 'token') {
    result.limits.push({kind:'unsupported',detail:'CSS var() references prove use of this name only. Cascade, inheritance, overrides, conditions, and the selected declaration’s actual consumers are unknown. CSS-in-JS, preprocessors, escapes, and runtime style writes are not analyzed.'});
    let selected = null;
    for (const [index,item] of [...files].sort((a,b) => a.path === target.path ? -1 : b.path === target.path ? 1 : a.path.localeCompare(b.path)).entries()) {
      if (!item.path.endsWith('.css')) continue;
      assertRelationshipsCurrent(isCurrent);
      let root;
      try { root = postcss.parse(item.source,{from:item.path,map:false}); }
      catch { result.truncated = true; if (result.limits.length < 99) result.limits.push({kind:'parse-error',path:item.path,detail:'Invalid CSS is withheld from token evidence.'}); continue; }
      // PostCSS removes a leading BOM before assigning offsets. Keep all
      // navigable ranges in the original saved UTF-16 source coordinates.
      const offset = root.source.input.hasBOM ? 1 : 0;
      const tokens = listDesignTokens([item]).filter(token => token.name === target.name), nodes = [], pending = [{node:root,depth:0}]; let count = 0, limited = false;
      while (pending.length) { const {node,depth} = pending.pop(); if (++count > 50000 || depth > 128) { limited = true; break; } if (node.type === 'decl') nodes.push(node); if (node.nodes) for (const child of [...node.nodes].reverse()) pending.push({node:child,depth:depth + 1}); }
      if (limited) { result.truncated = true; if (result.limits.length < 99) result.limits.push({kind:'limit',path:item.path,detail:'CSS exceeds the syntax node or nesting limit; its token evidence is withheld.'}); continue; }
      result.counts.analyzed++;
      const inRule = node => { for (let p = node.parent; p; p = p.parent) if (p.type === 'rule') return true; return false; };
      const matching = nodes.filter(node => node.prop === target.name && inRule(node));
      for (const token of tokens) {
        const node = matching[token.occurrence];
        if (!node || node.source.start.line !== token.line) continue;
        const isSelected = item.path === target.path && token.occurrence === target.occurrence;
        if (bytes(token.scope) > 4096 || bytes(token.value) > 2048) result.truncated = true;
        const body = {name:target.name,occurrence:token.occurrence,scope:normalize(token.scope,4096),value:normalize(token.value,2048),selected:isSelected,source:point(item,node.source.start.offset + offset,node.source.start.offset + offset + target.name.length)};
        const declaration = {id:identity('token-declaration',body),...body};
        if (isSelected) selected = declaration;
        if (result.declarations.length < MAX_ITEMS) result.declarations.push(declaration); else result.truncated = true;
      }
      for (const node of nodes) {
        if (!/^(?:--[a-zA-Z_][\w-]*|[-a-zA-Z][\w-]*)$/.test(node.prop) || bytes(node.prop) > 256) { result.truncated = true; continue; }
        const start = node.source.start.offset + offset, end = node.source.end.offset + offset + 1;
        const colon = item.source.indexOf(':',start); if (colon < 0 || colon >= end) continue;
        for (const span of varReferences(item.source,colon + 1,end,target.name)) {
          const body = {name:target.name,scope:cssScope(node),property:node.prop,source:point(item,span.start,span.end),provenance:'source'};
          if (result.tokenReferences.length < MAX_ITEMS) result.tokenReferences.push({id:identity('token-reference',body),...body}); else result.truncated = true;
        }
      }
      if (index % 32 === 0) { await new Promise(resolve => setImmediate(resolve)); assertRelationshipsCurrent(isCurrent); }
    }
    if (!selected) throw new ChangeImpactError('The exact CSS declaration could not be verified. Refresh or inspect its source.','impact-token-unavailable');
    if (!result.declarations.some(item => item.selected)) { result.declarations.pop(); result.declarations.push(selected); result.truncated = true; }
    result.scope = {kind:'css-declaration',label:selected.scope,source:selected.source};
  }
  if (result.truncated) result.limits.push({kind:'limit',detail:'This bounded result may omit consumers or token references. An empty list is not proof of no impact.'});
  for (const key of ['consumers','tokenReferences','declarations']) result.counts[key] = result[key].length;
  assertRelationshipsCurrent(isCurrent);
  return validateChangeImpact(result,projectId);
}
