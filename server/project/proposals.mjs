import { createHash, randomUUID } from "node:crypto";

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_RAW_BYTES = 64 * 1024;
const MAX_EDITS = 24;
const TOKEN_NAME = /^--[a-zA-Z_][a-zA-Z0-9_-]*$/;

export class ProposalError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    Object.assign(this, { name: "ProposalError", code, status });
  }
}

function fail(message, code = "invalid-proposal") {
  throw new ProposalError(code, message);
}
function text(value, limit) {
  return (
    typeof value === "string" &&
    !value.includes("\0") &&
    Buffer.byteLength(value, "utf8") <= limit &&
    Buffer.from(value, "utf8").toString("utf8") === value
  );
}
function validPath(value) {
  return (
    text(value, 1000) && value.length > 0 &&
    !value.startsWith("/") && !/[\\\r\n]/.test(value) &&
    value.split("/").every(part => part && part !== "." && part !== "..")
  );
}
function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
function checkedFile(files, path) {
  if (!Array.isArray(files)) fail("Select saved source before creating a proposal.");
  const matches = files.filter(file => file?.path === path);
  if (matches.length !== 1) fail("A proposal can only change one explicitly selected source file.", "proposal-outside-context");
  const file = matches[0];
  if (!validPath(path) || !text(file.source, MAX_SOURCE_BYTES) || !text(file.revision, 200) || !file.revision)
    fail("The selected source snapshot is not valid. Refresh the source context.");
  return file;
}
function proposal({ projectId, file, after, title, summary, verification, origin, context = [{ path: file.path, revision: file.revision }] }) {
  if (!text(projectId, 300) || !projectId) fail("Choose a local project before creating a proposal.");
  if (!text(after, MAX_SOURCE_BYTES)) fail("The proposed source exceeds the supported UTF-8 size limit.");
  if (after === file.source) fail("This proposal does not change the selected source.", "proposal-no-change");
  return {
    id: randomUUID(), projectId, title, summary, path: file.path,
    before: file.source, after, baseRevision: file.revision,
    status: "proposed", origin, verification, context,
  };
}

/** Validate untrusted model output against the exact saved sources disclosed to it. No writes. */
export function createChangeProposal({ raw, files, projectId, origin = "ai" } = {}) {
  if (!text(raw, MAX_RAW_BYTES)) fail("The model proposal is not valid UTF-8 JSON within 64 KiB.");
  let value;
  try { value = JSON.parse(raw); } catch { fail("The model did not return a complete JSON proposal. Try a narrower change."); }
  if (!isObject(value) || Object.keys(value).some(key => !["title", "summary", "edits", "verification"].includes(key)))
    fail("The model returned an unsupported proposal format.");
  if (!text(value.title, 160) || !value.title.trim() || !text(value.summary, 2000) || !value.summary.trim())
    fail("The proposal needs a short title and a description of its scope.");
  if (!Array.isArray(value.edits) || value.edits.length < 1 || value.edits.length > MAX_EDITS)
    fail("A proposal needs between one and 24 exact source edits.");
  if (!Array.isArray(value.verification) || value.verification.length > 12 || value.verification.some(item => !text(item, 500) || !item.trim()))
    fail("Verification must be a list of up to 12 suggested checks.");
  if (!["ai", "design"].includes(origin)) fail("The proposal origin is unsupported.");
  const path = value.edits[0]?.path;
  const file = checkedFile(files, path);
  const ranges = value.edits.map(edit => {
    if (!isObject(edit) || Object.keys(edit).some(key => !["path", "find", "replace"].includes(key)) || edit.path !== path)
      fail("Keep this proposal to one existing source file. Request separate proposals for other files.", "proposal-multiple-files");
    if (!text(edit.find, MAX_RAW_BYTES) || !edit.find || !text(edit.replace, MAX_RAW_BYTES))
      fail("Each edit needs a non-empty source anchor and valid replacement text.");
    if (edit.find === edit.replace) fail("An edit leaves its source unchanged.", "proposal-no-change");
    const start = file.source.indexOf(edit.find);
    if (start === -1) fail("A proposed source anchor was not found in the selected snapshot.", "proposal-anchor-missing");
    if (file.source.indexOf(edit.find, start + 1) !== -1)
      fail("A proposed source anchor matches more than once. Include more surrounding code.", "proposal-anchor-ambiguous");
    return { start, end: start + edit.find.length, replacement: edit.replace };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++)
    if (ranges[i].start < ranges[i - 1].end) fail("Proposed edits overlap. Request one combined edit for this region.", "proposal-overlap");
  let after = file.source;
  for (const range of ranges.toReversed())
    after = after.slice(0, range.start) + range.replacement + after.slice(range.end);
  return proposal({ projectId, file, after, title: value.title.trim(), summary: value.summary.trim(), verification: value.verification.map(item => item.trim()), origin, context: files.map(item => ({ path: item.path, revision: item.revision })) });
}

const CHANGE_SET_STATES = new Set(["proposed", "applying", "applied", "partially-applied", "undoing", "undone", "recovery-required", "discarded", "stale"]);
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const revision = value => text(value, 200) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const changePath = value => validPath(value) && !/^[A-Za-z]:|[\u0000-\u001f\u007f]/.test(value);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).every(key => keys.includes(key));
const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export const ALTERNATIVE_GROUP_LIMITS = Object.freeze({files:8,sourceBytes:64*1024});
/** Application source only; configuration and Foundation instrumentation are outside retained group edits. */
export function validAlternativeSourcePath(path) {
  if(!changePath(path))return false;
  const parts=path.split('/'),name=parts.at(-1);
  if(parts.some(part=>part.startsWith('.')||['node_modules','bower_components','vendor','dist','build','out','coverage','artifacts','test-results','playwright-report','Pods','Carthage','DerivedData','__pycache__'].includes(part)))return false;
  if(!/\.(?:ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|html|vue|svelte)$/.test(name))return false;
  if(/(?:^|[._-])(?:config|configuration|setup|bootstrap)(?:[._-]|$)/i.test(name)||/^(?:package|yarn\.lock|pnpm-lock|package-lock|bun\.lock)/i.test(name))return false;
  return !/^(?:foundation[-_.](?:vite|runtime|replay|instrument)|connected-vite-plugin|vite-plugin|replay-client|replay-mailbox|replay-protocol|runtime-client)(?:[._-]|$)/i.test(name);
}
export function validateAlternativeGroupBasis(value,files) {
  const keys=['version','kind','comparisonId','sourceGroupId','sourceGroupRevision','sourceGroupDigest','baselineDigest','files'];
  const full=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),digest=value=>createHash('sha256').update(value).digest('hex');
  const invalid=()=>fail('The retained alternative source basis is invalid.','invalid-alternative-basis');
  if(!exactKeys(value,keys)||Object.keys(value).length!==keys.length||value.version!==2||value.kind!=='change-set'||!uuid(value.comparisonId)||!uuid(value.sourceGroupId)||!Number.isSafeInteger(value.sourceGroupRevision)||value.sourceGroupRevision<0||!full(value.sourceGroupDigest)||!full(value.baselineDigest)||!Array.isArray(value.files)||value.files.length<2||value.files.length>8)invalid();
  let prior;for(const file of value.files){if(!exactKeys(file,['path','beforeHash','afterHash'])||Object.keys(file).length!==3||!validAlternativeSourcePath(file.path)||!full(file.beforeHash)||!full(file.afterHash)||file.beforeHash===file.afterHash||prior!==undefined&&prior.localeCompare(file.path)>=0)invalid();prior=file.path;}
  if(files!==undefined){
    if(!Array.isArray(files)||files.length!==value.files.length)invalid();
    const sorted=[...files].sort((a,b)=>a.path.localeCompare(b.path));let beforeBytes=0,afterBytes=0;
    for(const [index,file] of sorted.entries()){const expected=value.files[index];if(file.path!==expected.path||!text(file.before,ALTERNATIVE_GROUP_LIMITS.sourceBytes)||!text(file.after,ALTERNATIVE_GROUP_LIMITS.sourceBytes)||digest(file.before)!==expected.beforeHash||digest(file.after)!==expected.afterHash)invalid();beforeBytes+=Buffer.byteLength(file.before);afterBytes+=Buffer.byteLength(file.after);}
    if(beforeBytes>ALTERNATIVE_GROUP_LIMITS.sourceBytes||afterBytes>ALTERNATIVE_GROUP_LIMITS.sourceBytes)invalid();
  }
  return structuredClone(value);
}

/** Canonical source changes only. Transaction journals belong to their local host envelope. */
export function validateChangeSet(value, projectId) {
  const invalid = () => fail("The change set does not match its bounded source contract.", "invalid-change-set");
  if (!exactKeys(value, ["schemaVersion", "id", "projectId", "title", "summary", "status", "origin", "revision", "files", "context", "verification", "verificationStatus", "requestId", "createdAt", "updatedAt", "alternativeBasis"]) ||
    value.schemaVersion !== 1 || !uuid(value.id) || !revision(projectId) || value.projectId !== projectId ||
    !text(value.title, 160) || !value.title.trim() || !text(value.summary, 2000) || !value.summary.trim() ||
    !CHANGE_SET_STATES.has(value.status) || !["ai","alternative"].includes(value.origin) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
    value.verificationStatus !== "not-run" || !Array.isArray(value.verification) || value.verification.length > 12 || value.verification.some(item => !text(item, 500) || !item.trim()) ||
    !Array.isArray(value.context) || value.context.length < 2 || value.context.length > 8 ||
    !Array.isArray(value.files) || value.files.length < 2 || value.files.length > 8) invalid();
  const contextPaths = new Set();
  const context = value.context.map(item => {
    if (!exactKeys(item, ["path", "revision"]) || !changePath(item.path) || !revision(item.revision) || contextPaths.has(item.path)) invalid();
    contextPaths.add(item.path); return {path:item.path, revision:item.revision};
  });
  const paths = new Set(), ids = new Set(); let beforeBytes = 0, afterBytes = 0;
  const files = value.files.map(item => {
    if (!exactKeys(item, ["id", "path", "before", "after", "baseRevision", "appliedRevision"]) || !uuid(item.id) || ids.has(item.id) || item.id === value.id ||
      !changePath(item.path) || paths.has(item.path) || !text(item.before, MAX_SOURCE_BYTES) || !text(item.after, MAX_SOURCE_BYTES) || item.before === item.after ||
      !revision(item.baseRevision) || item.baseRevision !== createHash("sha256").update(item.before).digest("hex").slice(0,16) || !context.some(source => source.path === item.path && source.revision === item.baseRevision)) invalid();
    ids.add(item.id); paths.add(item.path); beforeBytes += Buffer.byteLength(item.before, "utf8"); afterBytes += Buffer.byteLength(item.after, "utf8");
    if (beforeBytes > MAX_SOURCE_BYTES || afterBytes > MAX_SOURCE_BYTES) invalid();
    const result = {id:item.id, path:item.path, before:item.before, after:item.after, baseRevision:item.baseRevision};
    if (item.appliedRevision !== undefined) { if (!revision(item.appliedRevision) || item.appliedRevision !== createHash("sha256").update(item.after).digest("hex").slice(0,16)) invalid(); result.appliedRevision = item.appliedRevision; }
    return result;
  });
  if (value.status === "applied" && files.some(file => !file.appliedRevision)) invalid();
  if (["partially-applied", "undoing", "undone"].includes(value.status) && !files.some(file => file.appliedRevision)) invalid();
  if (value.status === "partially-applied" && files.every(file => file.appliedRevision)) invalid();
  const result = {schemaVersion:1,id:value.id,projectId,title:value.title,summary:value.summary,status:value.status,origin:value.origin,revision:value.revision,
    files,context,verification:[...value.verification],verificationStatus:"not-run"};
  if(value.origin==='alternative') {
    if(value.requestId!==undefined||value.status==='partially-applied'||beforeBytes>ALTERNATIVE_GROUP_LIMITS.sourceBytes||afterBytes>ALTERNATIVE_GROUP_LIMITS.sourceBytes||context.some(ref=>!validAlternativeSourcePath(ref.path)))invalid();
    result.alternativeBasis=validateAlternativeGroupBasis(value.alternativeBasis,files);
  } else if(value.alternativeBasis!==undefined)invalid();
  if (value.requestId !== undefined) { if (!revision(value.requestId)) invalid(); result.requestId = value.requestId; }
  for (const key of ["createdAt", "updatedAt"]) if (value[key] !== undefined) { if (!date(value[key])) invalid(); result[key] = value[key]; }
  if (result.createdAt && result.updatedAt && result.updatedAt < result.createdAt) invalid();
  return result;
}

/** Explicitly opted-in Build dispatch. The legacy one-file parser stays unchanged. */
export function createBuildArtifact({raw, files, projectId} = {}) {
  if (!text(raw, MAX_RAW_BYTES)) fail("The model proposal is not valid UTF-8 JSON within 64 KiB.");
  let value;
  try { value = JSON.parse(raw); } catch { fail("The model did not return a complete JSON proposal. Try a narrower change."); }
  if (!exactKeys(value, ["title", "summary", "edits", "verification"]) || !Array.isArray(value.edits) || value.edits.length < 1 || value.edits.length > MAX_EDITS)
    fail("A Build response needs between one and 24 exact source edits.");
  const paths = new Set(value.edits.map(edit => edit?.path));
  if (paths.size === 1) return {type:"proposal", proposal:createChangeProposal({raw, files, projectId})};
  if (paths.size > 8 || !Array.isArray(files) || files.length < 2 || files.length > 8) fail("A change set can edit two to eight explicitly selected existing files.", "proposal-outside-context");
  const selected = new Set(); let sourceBytes = 0;
  for (const file of files) {
    checkedFile(files, file?.path);
    if (!changePath(file.path) || !revision(file.revision) || selected.has(file.path)) fail("The selected source snapshots are not valid.");
    selected.add(file.path); sourceBytes += Buffer.byteLength(file.source, "utf8");
  }
  if (sourceBytes > MAX_RAW_BYTES) fail("Selected source must total at most 64 KiB.");
  for (const path of paths) if (!selected.has(path)) fail("A change set can only edit explicitly selected source files.", "proposal-outside-context");
  // All anchors are checked against the original snapshots before an artifact is returned.
  const members = files.filter(file => paths.has(file.path)).map(file => {
    const member = createChangeProposal({raw:JSON.stringify({...value, edits:value.edits.filter(edit => edit?.path === file.path)}), files, projectId});
    return {id:member.id,path:member.path,before:member.before,after:member.after,baseRevision:member.baseRevision};
  });
  const changeSet = validateChangeSet({schemaVersion:1,id:randomUUID(),projectId,title:value.title.trim(),summary:value.summary.trim(),status:"proposed",origin:"ai",revision:0,
    files:members,context:files.map(({path,revision}) => ({path,revision})),verification:value.verification.map(item => item.trim()),verificationStatus:"not-run"},projectId);
  return {type:"changeSet",changeSet};
}

/** Strict local checkpoint identity. Source or provider output cannot add authority. */
export function groupRevisionDescriptor(value) {
  if (value === undefined) return undefined;
  const keys = ['version', 'conversationId', 'requestId', 'groupId', 'groupRevision', 'groupDigest'];
  if (!exactKeys(value, keys) || Object.keys(value).length !== keys.length || value.version !== 1 ||
    !revision(value.conversationId) || !revision(value.requestId) || !uuid(value.groupId) ||
    !Number.isSafeInteger(value.groupRevision) || value.groupRevision < 0 ||
    typeof value.groupDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.groupDigest))
    fail('Choose a saved staged group before refining it.', 'invalid-group-revision');
  return {version:1, conversationId:value.conversationId, requestId:value.requestId,
    groupId:value.groupId, groupRevision:value.groupRevision, groupDigest:value.groupDigest};
}

/** Immutable group content; execution and refinement use the same digest contract. */
export function changeGroupDigest(input) {
  const group = validateChangeSet(input, input?.projectId);
  return createHash('sha256').update(JSON.stringify({schemaVersion:group.schemaVersion,id:group.id,projectId:group.projectId,
    title:group.title,summary:group.summary,origin:group.origin,
    files:group.files.map(({id,path,before,after,baseRevision})=>({id,path,before,after,baseRevision})),
    context:group.context,verification:group.verification,verificationStatus:group.verificationStatus,requestId:group.requestId,...(group.alternativeBasis?{alternativeBasis:group.alternativeBasis}:{})})).digest('hex');
}

/** Derive the explicitly shared staged snapshot from canonical host-owned before/after files. */
export function stagedGroupSources({group:input, files, projectId} = {}) {
  const group = validateChangeSet(input, projectId);
  if(group.origin!=='ai')fail('Retained alternatives do not support AI refinement.','invalid-group-basis');
  if (group.status !== 'proposed' || group.files.some(file=>file.appliedRevision !== undefined) ||
    !Array.isArray(files) || files.length !== group.context.length)
    fail('Refinement requires the complete original source basis of a proposed group.', 'invalid-group-basis');
  let originalBytes = 0, stagedBytes = 0;
  const result = files.map((file,index)=>{
    const basis = group.context[index];
    checkedFile(files, file?.path);
    if (file.path !== basis.path || file.revision !== basis.revision ||
      createHash('sha256').update(file.source).digest('hex').slice(0,16) !== file.revision)
      fail('The original saved source no longer matches this group.', 'invalid-group-basis');
    const member = group.files.find(item=>item.path === file.path);
    if (member && (member.before !== file.source || member.baseRevision !== file.revision))
      fail('The staged group does not match its original source snapshots.', 'invalid-group-basis');
    const source = member?.after ?? file.source;
    originalBytes += Buffer.byteLength(file.source, 'utf8'); stagedBytes += Buffer.byteLength(source, 'utf8');
    if (originalBytes > MAX_RAW_BYTES || stagedBytes > MAX_RAW_BYTES)
      fail('The original and staged source contexts must each fit within 64 KiB.', 'group-context-too-large');
    return {id:`S${index+1}`,path:file.path,revision:createHash('sha256').update(source).digest('hex').slice(0,16),source,lines:source.split('\n').length};
  });
  return result;
}

/** Apply exact model anchors to staged inputs, then retain a diff against the original disk basis. No writes. */
export function createRefinedChangeSet({raw,files,group:input,projectId} = {}) {
  const group = validateChangeSet(input, projectId);
  if(group.origin!=='ai')fail('Retained alternatives do not support AI refinement.','invalid-group-basis');
  const staged = stagedGroupSources({group,files,projectId});
  const incremental = createBuildArtifact({raw,files:staged,projectId});
  const edits = incremental.type === 'proposal' ? [incremental.proposal] : incremental.changeSet.files;
  const metadata = incremental.type === 'proposal' ? incremental.proposal : incremental.changeSet;
  const members = files.flatMap((original,index)=>{
    const after = edits.find(file=>file.path === original.path)?.after ?? staged[index].source;
    return after === original.source ? [] : [{id:randomUUID(),path:original.path,before:original.source,after,baseRevision:original.revision}];
  });
  if (!members.length) fail('This refinement removes every staged change. The earlier checkpoint is preserved.', 'refinement-no-change');
  if (members.length < 2) fail('A refined group must retain at least two changed files. The earlier checkpoint is preserved.', 'refinement-too-small');
  if (members.every(member=>group.files.some(prior=>prior.path === member.path && prior.after === member.after)) && members.length === group.files.length)
    fail('This refinement leaves the staged group unchanged.', 'refinement-no-change');
  return validateChangeSet({schemaVersion:1,id:randomUUID(),projectId,title:metadata.title,summary:metadata.summary,
    status:'proposed',origin:'ai',revision:0,files:members,context:files.map(({path,revision})=>({path,revision})),
    verification:[...metadata.verification],verificationStatus:'not-run'},projectId);
}

// Mask comments without moving source offsets. A small scanner keeps strings,
// parentheses, and nested rules from being mistaken for declaration boundaries.
function cssDeclarations(file) {
  if (!file || typeof file.path !== "string" || !file.path.endsWith(".css") || !text(file.source, MAX_SOURCE_BYTES)) return [];
  const source = file.source;
  const masked = source.split("");
  let quote = "", comment = false, parens = 0, brackets = 0, start = 0;
  const stack = [], declarations = [], occurrences = new Map();
  const declaration = end => {
    if (!stack.some(header => !header.startsWith("@"))) return;
    const fragment = masked.slice(start, end).join("");
    const match = fragment.match(/^\s*(--[a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*([\s\S]*?)\s*$/);
    if (!match || !match[2]) return;
    const name = match[1];
    const nameStart = start + fragment.indexOf(name);
    const colon = start + fragment.indexOf(":");
    let valueStart = colon + 1;
    while (valueStart < end && /\s/.test(masked[valueStart])) valueStart++;
    let valueEnd = end;
    while (valueEnd > valueStart && /\s/.test(masked[valueEnd - 1])) valueEnd--;
    // Comments at either edge remain source text. Replacing an interior value
    // containing a comment would be ambiguous, so expose it as read-only text.
    const value = source.slice(valueStart, valueEnd);
    const occurrence = occurrences.get(name) || 0;
    occurrences.set(name, occurrence + 1);
    declarations.push({
      id: createHash("sha256").update(`${file.path}\0${file.revision}\0${name}\0${occurrence}`).digest("hex").slice(0, 20),
      path: file.path, revision: file.revision, name, value,
      line: source.slice(0, nameStart).split("\n").length,
      occurrence, scope: stack.join(" / "), valueStart, valueEnd,
    });
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (comment) {
      if (char !== "\n" && char !== "\r") masked[i] = " ";
      if (char === "*" && next === "/") { masked[i + 1] = " "; i++; comment = false; }
      continue;
    }
    if (quote) {
      if (char === "\\") { i++; continue; }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "*") { masked[i] = masked[i + 1] = " "; i++; comment = true; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(") { parens++; continue; }
    if (char === ")") { parens = Math.max(0, parens - 1); continue; }
    if (char === "[") { brackets++; continue; }
    if (char === "]") { brackets = Math.max(0, brackets - 1); continue; }
    if (parens || brackets) continue;
    if (char === "{") {
      stack.push(masked.slice(start, i).join("").trim());
      start = i + 1;
    } else if (char === ";") {
      declaration(i); start = i + 1;
    } else if (char === "}") {
      declaration(i); stack.pop(); start = i + 1;
    }
  }
  return declarations;
}

export function listDesignTokens(files = []) {
  if (!Array.isArray(files)) return [];
  return files.flatMap(file => cssDeclarations(file).map(({ valueStart, valueEnd, ...item }) => item));
}

/** Conservative editable subset: numbers, lengths, hex colors, named colors,
 * and numeric rgb/hsl colors. No functions that can fetch or reference data. */
export function validTokenValue(value) {
  if (!text(value, 120) || !value.trim() || value !== value.trim()) return false;
  if (/^(?:#[\da-fA-F]{3,4}|#[\da-fA-F]{6}|#[\da-fA-F]{8}|(?:-?\d+(?:\.\d+)?|-?\.\d+)(?:px|rem|em|%|vh|vw|ch|ex|s|ms|deg)?|(?:transparent|currentColor|inherit|initial|unset)|(?:black|white|red|green|blue|gray|grey|yellow|orange|purple|pink|teal|navy|rebeccapurple))$/.test(value)) return true;
  const color = value.match(/^(rgb|rgba|hsl|hsla)\(([^()]*)\)$/);
  if (!color) return false;
  const numeric = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/;
  let channels, alpha;
  if (color[2].includes(",")) {
    const parts = color[2].split(",").map(part => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return false;
    channels = parts.slice(0, 3);
    alpha = parts[3];
  } else {
    const parts = color[2].split("/");
    if (parts.length > 2) return false;
    channels = parts[0].trim().split(/\s+/);
    alpha = parts[1]?.trim();
  }
  if (channels.length !== 3 || channels.some(part => !numeric.test(part)) || (alpha !== undefined && !numeric.test(alpha))) return false;
  if (color[1].startsWith("hsl") && (!channels[1].endsWith("%") || !channels[2].endsWith("%") || channels[0].endsWith("%"))) return false;
  return true;
}

export function createTokenProposal({ file, name, occurrence, value, projectId } = {}) {
  checkedFile([file], file?.path);
  if (!TOKEN_NAME.test(name) || !Number.isSafeInteger(occurrence) || occurrence < 0)
    fail("Choose one explicit design-token declaration.", "token-ambiguous");
  if (!validTokenValue(value)) fail("Use a color, number, or length. URLs, references, and CSS rules are not accepted.", "invalid-token-value");
  const matches = cssDeclarations(file).filter(item => item.name === name && item.occurrence === occurrence);
  if (matches.length !== 1) fail("This token declaration is no longer available. Refresh the source.", "token-not-found");
  const token = matches[0];
  if (/\/\*|\*\//.test(token.value)) fail("This token contains comments. Edit it in the source editor to preserve its structure.", "token-complex-value");
  const after = file.source.slice(0, token.valueStart) + value + file.source.slice(token.valueEnd);
  return proposal({
    projectId, file, after, origin: "design", title: `Refine ${name}`,
    summary: `Change ${name} from ${token.value} to ${value} in ${token.scope}. All consumers of this declaration may be affected.`,
    verification: ["Inspect every consumer of this token.", "Check the relevant themes and viewport sizes."],
  });
}
