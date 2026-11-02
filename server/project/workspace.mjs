import {validateSourceInvestigation} from './source-investigation.mjs';
import {analyzeChangeImpact, validateChangeImpact as checkedChangeImpact} from './change-impact.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open as openFile, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, posix, resolve, sep } from 'node:path';
import ts from 'typescript';
import { analyzeRelationships, assertRelationshipsCurrent } from './relationships.mjs';

const MAX_FILE_BYTES = 256 * 1024;
const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 1500;
const MAX_ENTRIES = 12000;
const MAX_DEPTH = 16;
const MAX_MATCHES = 200;
const MAX_SOURCE_BATCH_FILES = 192;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const TEXT_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, '.json', '.css', '.scss', '.sass', '.less', '.html', '.htm', '.md', '.mdx', '.txt', '.yaml', '.yml', '.svg', '.swift', '.kt', '.java', '.xml', '.graphql', '.gql', '.toml', '.sql', '.py', '.rs', '.go', '.vue', '.svelte']);
const SKIP_DIRECTORIES = new Set(['node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'coverage', 'artifacts', 'test-results', 'playwright-report', 'Pods', 'Carthage', 'DerivedData', '__pycache__']);
const SENSITIVE_NAME = /^(?:credentials?|secrets?|passwords?|id_rsa|id_ed25519|access[-_]?token|auth[-_]?token|refresh[-_]?token)(?:[._-]|$)|^tokens?\.(?:json|ya?ml|txt|toml)$/i;
const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);
export const projectRevision = hash;

export class ProjectError extends Error {
  constructor(status, code, message, revision) {
    super(message);
    Object.assign(this, { status, code, ...(revision ? { revision } : {}) });
  }
}

function readableName(name, directory = false) {
  if (!name || name.startsWith('.') || SENSITIVE_NAME.test(name)) return false;
  return directory ? !SKIP_DIRECTORIES.has(name) : TEXT_EXTENSIONS.has(extname(name).toLowerCase());
}

function localPath(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || value.includes('\0') || value.includes('\\') || isAbsolute(value)) {
    throw new ProjectError(400, 'invalid-path', 'Choose a relative file path inside the open project.');
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new ProjectError(400, 'invalid-path', 'The file path cannot leave the open project.');
  if (parts.some((part, i) => !readableName(part, i < parts.length - 1))) throw new ProjectError(403, 'excluded-path', 'This file is outside the project’s supported source files. Hidden, generated, and credential files are excluded.');
  return parts.join('/');
}

function languageForPath(path) {
  const extension = extname(path).toLowerCase();
  return ({ '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.json': 'json', '.md': 'markdown', '.mdx': 'markdown', '.yml': 'yaml', '.yaml': 'yaml', '.htm': 'html', '.svg': 'xml', '.py': 'python', '.rs': 'rust', '.kt': 'kotlin' })[extension] ?? extension.slice(1);
}

// Ignore matching uses bounded dynamic programming rather than backtracking regexes.
// Negated rules never reinclude a path; unsupported ignore syntax excludes that subtree.
function globTokens(pattern) {
  const tokens = [];
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      while (pattern[i + 1] === '*') i++;
      if (pattern[i + 1] === '/') { tokens.push({ kind: 'directories' }); i++; }
      else tokens.push({ kind: 'any' });
    } else if (char === '*') tokens.push({ kind: 'segment' });
    else if (char === '?') tokens.push({ kind: 'character' });
    else if (char === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end < 0) return null;
      let members = pattern.slice(i + 1, end);
      const inverted = /^[!^]/.test(members);
      if (inverted) members = members.slice(1);
      if (!members || members.includes('[')) return null;
      const ranges = [];
      for (let j = 0; j < members.length; j++) {
        if (members[j + 1] === '-' && members[j + 2]) { ranges.push([members[j], members[j + 2]]); j += 2; }
        else ranges.push([members[j], members[j]]);
      }
      tokens.push({ kind: 'class', ranges, inverted });
      i = end;
    } else tokens.push({ kind: 'literal', value: char });
  }
  return tokens;
}

function globMatches(tokens, path) {
  let prior = new Uint8Array(path.length + 1);
  prior[0] = 1;
  for (const token of tokens) {
    const current = new Uint8Array(path.length + 1);
    let started = false;
    for (let i = 0; i <= path.length; i++) {
      const char = path[i - 1];
      if (token.kind === 'any' || token.kind === 'segment') current[i] = prior[i] || (i > 0 && (token.kind === 'any' || char !== '/') && current[i - 1]) ? 1 : 0;
      else if (token.kind === 'directories') {
        started ||= Boolean(prior[i]);
        current[i] = prior[i] || (i > 0 && char === '/' && started) ? 1 : 0;
      } else if (i > 0 && prior[i - 1]) {
        if (token.kind === 'literal') current[i] = char === token.value ? 1 : 0;
        else if (token.kind === 'character') current[i] = char !== '/' ? 1 : 0;
        else if (token.kind === 'class' && char !== '/') {
          const member = token.ranges.some(([from, to]) => char >= from && char <= to);
          current[i] = member !== token.inverted ? 1 : 0;
        }
      }
    }
    prior = current;
  }
  return prior.some((match, i) => match && (i === path.length || path[i] === '/'));
}

function ignoreRules(source, base) {
  const rules = [];
  for (const raw of source.split(/\r?\n/)) {
    if (!raw || raw.startsWith('#') || raw.startsWith('!')) continue;
    if (raw.length > 512 || rules.length >= 512) return null;
    // Only escaped literal spaces and leading #/! are supported. Fail closed for other syntax.
    const pattern = raw.replace(/\\ /g, '\u0001').replace(/^\\([#!])/, '$1').trim().replaceAll('\u0001', ' ');
    if (!pattern) continue;
    if (pattern.includes('\\')) return null;
    const anchored = pattern.startsWith('/');
    const clean = pattern.replace(/^\//, '').replace(/\/$/, '');
    const tokens = globTokens(`${anchored || clean.includes('/') ? '' : '**/'}${clean}`);
    if (!tokens) return null;
    rules.push({ base, tokens });
  }
  return rules;
}

function ignored(path, rules) {
  return rules.some(({ base, tokens }) => {
    if (base && !path.startsWith(`${base}/`)) return false;
    return globMatches(tokens, base ? path.slice(base.length + 1) : path);
  });
}

async function safeFile(project, path) {
  const relativePath = localPath(path);
  const parts = relativePath.split('/');
  let current = project.root;
  const rootInfo = await lstat(current).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new ProjectError(409, 'project-unavailable', 'The project folder is no longer available. Open the folder again.');
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const info = await lstat(current).catch(() => null);
    if (!info) throw new ProjectError(404, 'file-not-found', 'This source file no longer exists. Refresh the project.');
    if (info.isSymbolicLink()) throw new ProjectError(403, 'symlink-rejected', 'Symbolic links are not available in this local project adapter.');
    if (i < parts.length - 1 && !info.isDirectory()) throw new ProjectError(400, 'invalid-path', 'A source path segment is not a folder.');
    if (i === parts.length - 1) {
      if (!info.isFile()) throw new ProjectError(400, 'invalid-file', 'Choose a regular source file.');
      if (info.size > MAX_FILE_BYTES) throw new ProjectError(413, 'file-too-large', 'Source files are limited to 256 KiB in this workbench.');
      return { path: current, info };
    }
  }
}

async function readSource(project, path) {
  const file = await safeFile(project, path);
  const handle = await openFile(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new ProjectError(413, 'file-too-large', 'Source files are limited to 256 KiB in this workbench.');
    const buffer = await handle.readFile();
    if (buffer.length > MAX_FILE_BYTES) throw new ProjectError(413, 'file-too-large', 'Source files are limited to 256 KiB in this workbench.');
    if (buffer.includes(0)) throw new ProjectError(415, 'binary-file', 'Binary files are not available in the source editor.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { throw new ProjectError(415, 'unsupported-encoding', 'The source editor supports UTF-8 text files.'); }
  } finally { await handle.close(); }
}

async function scanProject(project, isCurrent) {
  assertRelationshipsCurrent(isCurrent);
  const files = [];
  let byteCount = 0;
  let entryCount = 0;
  let truncated = false;
  const allRules = [];
  async function walk(directory, path, inherited, depth) {
    assertRelationshipsCurrent(isCurrent);
    if (depth > MAX_DEPTH) { truncated = true; return; }
    let rules = inherited;
    const ignoreFile = join(directory, '.gitignore');
    const ignoreInfo = await lstat(ignoreFile).catch(() => null);
    if (ignoreInfo) {
      if (!ignoreInfo.isFile() || ignoreInfo.isSymbolicLink() || ignoreInfo.size > 32 * 1024) { truncated = true; return; }
      let contents;
      try { contents = await readFile(ignoreFile, 'utf8'); } catch { truncated = true; return; }
      if (Buffer.byteLength(contents, 'utf8') > 32 * 1024) { truncated = true; return; }
      const ownRules = ignoreRules(contents, path);
      if (!ownRules || allRules.length + ownRules.length > 2048) { truncated = true; return; }
      rules = [...inherited, ...ownRules];
      allRules.push(...ownRules);
    }
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { truncated = true; return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      assertRelationshipsCurrent(isCurrent);
      entryCount++;
      if (entryCount > MAX_ENTRIES || files.length >= MAX_FILES || byteCount >= MAX_INDEX_BYTES) { truncated = true; return; }
      if (entry.isSymbolicLink()) continue;
      const next = path ? `${path}/${entry.name}` : entry.name;
      if (ignored(next, rules)) continue;
      if (entry.isDirectory()) {
        if (readableName(entry.name, true)) await walk(join(directory, entry.name), next, rules, depth + 1);
      } else if (entry.isFile() && readableName(entry.name)) {
        const info = await lstat(join(directory, entry.name)).catch(() => null);
        if (!info || !info.isFile() || info.isSymbolicLink()) continue;
        if (info.size > MAX_FILE_BYTES || byteCount + info.size > MAX_INDEX_BYTES) { truncated = true; continue; }
        files.push({ path: next, size: info.size });
        byteCount += info.size;
      }
    }
  }
  const rootInfo = await lstat(project.root).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new ProjectError(409, 'project-unavailable', 'The project folder is no longer available. Open the folder again.');
  await walk(project.root, '', [], 0);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, truncated, rules: allRules, indexedAt: new Date().toISOString() };
}

function parseFile(path, source) {
  const kind = /\.tsx$/i.test(path) ? ts.ScriptKind.TSX : /\.jsx$/i.test(path) ? ts.ScriptKind.JSX : /\.(mjs|cjs|js)$/i.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
}

function sourceImports(sourceFile, paths) {
  const imports = [];
  function add(specifier, names, node) {
    if (typeof specifier !== 'string') return;
    let resolvedPath = null;
    if (specifier.startsWith('.')) {
      const base = posix.normalize(posix.join(posix.dirname(sourceFile.fileName), specifier));
      const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'].map((extension) => `${base}${extension}`), ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].map((extension) => `${base}/index${extension}`)];
      if (/\.[cm]?js$/.test(base)) candidates.push(base.replace(/\.[cm]?js$/, '.ts'), base.replace(/\.[cm]?js$/, '.tsx'));
      resolvedPath = candidates.find((candidate) => paths.has(candidate)) ?? null;
    }
    imports.push({ specifier, names, line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1, resolvedPath });
  }
  const literal = (node) => node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const names = [];
      if (node.importClause?.name) names.push(node.importClause.name.text);
      const binding = node.importClause?.namedBindings;
      if (binding && ts.isNamespaceImport(binding)) names.push(binding.name.text);
      if (binding && ts.isNamedImports(binding)) names.push(...binding.elements.map((item) => item.name.text));
      add(literal(node.moduleSpecifier), names, node);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(literal(node.moduleSpecifier), node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map((item) => item.name.text) : [], node);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      add(literal(node.arguments[0]), [], node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return imports.slice(0, 250);
}

function analyzeSource(path, source, paths, parsedFile) {
  const analysis = { symbols: [], imports: [], consumers: [], requests: [], unsupported: !SOURCE_EXTENSIONS.has(extname(path).toLowerCase()) };
  if (analysis.unsupported) return analysis;
  const file = parsedFile ?? parseFile(path, source);
  analysis.unsupported = file.parseDiagnostics.length > 0;
  const exportedNames = new Set();
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) exportedNames.add((element.propertyName ?? element.name).text);
    }
  }
  const modifierExport = (node) => Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword));
  function addSymbol(node, kind, exported = modifierExport(node)) {
    const name = node.name?.getText(file) ?? (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ? 'default' : null);
    if (!name || analysis.symbols.length >= 250) return;
    analysis.symbols.push({ name, kind, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, endLine: file.getLineAndCharacterOfPosition(node.getEnd()).line + 1, exported: exported || exportedNames.has(name) });
  }
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement)) addSymbol(statement, 'function');
    else if (ts.isClassDeclaration(statement)) addSymbol(statement, 'class');
    else if (ts.isInterfaceDeclaration(statement)) addSymbol(statement, 'interface');
    else if (ts.isTypeAliasDeclaration(statement)) addSymbol(statement, 'type');
    else if (ts.isEnumDeclaration(statement)) addSymbol(statement, 'enum');
    else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addSymbol(declaration, declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) ? 'function' : 'variable', modifierExport(statement));
      }
    }
  }
  analysis.imports = sourceImports(file, paths);
  function visit(node) {
    if (analysis.requests.length >= 100) return;
    if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === 'fetch') || (ts.isPropertyAccessExpression(node.expression) && ['window', 'globalThis'].includes(node.expression.expression.getText(file)) && node.expression.name.text === 'fetch'))) {
      const urlNode = node.arguments[0];
      const url = urlNode && ts.isStringLiteralLike(urlNode) ? urlNode.text : 'Dynamic URL';
      const options = node.arguments[1];
      let method = options ? 'Unknown' : 'GET';
      if (options && ts.isObjectLiteralExpression(options)) {
        method = 'GET';
        for (const property of options.properties) {
          if (ts.isSpreadAssignment(property) || (ts.isShorthandPropertyAssignment(property) && property.name.text === 'method') || (property.name && ts.isComputedPropertyName(property.name))) method = 'Unknown';
          else if ((ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) && property.name?.getText(file) === 'method') method = 'Unknown';
          else if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) && property.name.text === 'method') {
            method = ts.isStringLiteralLike(property.initializer) ? property.initializer.text.toUpperCase() : 'Unknown';
          }
        }
      }
      analysis.requests.push({ method, url, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return analysis;
}

/** Local source service. Reads and writes only explicitly opened project source files; never executes project code. */
export function createProjectService({ root }) {
  const defaultRoot = resolve(root, 'projects/orbit');
  let active = null;
  let initialization = null;
  let queue = Promise.resolve();
  const projects = new Map();
  const serialize = (work) => {
    const operation = queue.then(work);
    queue = operation.catch(() => undefined);
    return operation;
  };

  async function prepareProject(folder) {
    if (typeof folder !== 'string' || !folder.trim() || folder.includes('\0') || !isAbsolute(folder) || folder.length > 4096) throw new ProjectError(400, 'invalid-project', 'Enter an absolute path to a local project folder.');
    const resolved = resolve(folder);
    const info = await lstat(resolved).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink()) throw new ProjectError(404, 'project-not-found', 'Choose an existing local project folder. Symbolic-link folders are not supported.');
    const canonical = await realpath(resolved);
    if (canonical === sep) throw new ProjectError(400, 'invalid-project', 'Choose a project folder, rather than the filesystem root.');
    let project = projects.get(canonical);
    if (!project) {
      project = { id: `project-${hash(canonical)}`, root: canonical, checkpoints: new Map() };
      projects.set(canonical, project);
    }
    return project;
  }

  async function ensureActive() {
    if (active) return active;
    if (!initialization) initialization = prepareProject(defaultRoot).then((project) => { active = project; return project; }).finally(() => { initialization = null; });
    return initialization;
  }

  async function selected(projectId) {
    const project = await ensureActive();
    if (projectId !== project.id) throw new ProjectError(409, 'project-conflict', 'The open project has changed. Refresh the workspace before continuing.');
    return project;
  }

  async function inventory(project) {
    return scanProject(project);
  }

  async function snapshotFor(project) {
    const index = await inventory(project);
    let name = basename(project.root);
    const targets = [];
    if (index.files.some((file) => file.path === 'package.json')) {
      try {
        const manifest = JSON.parse(await readSource(project, 'package.json'));
        if (typeof manifest.name === 'string' && manifest.name.trim()) name = manifest.name.slice(0, 120);
        const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
        const framework = dependencies.expo ? 'Expo' : dependencies['react-native'] ? 'React Native' : dependencies.next ? 'Next.js' : dependencies.vite ? 'Vite' : dependencies.react ? 'React' : 'Node.js';
        for (const [script, command] of Object.entries(manifest.scripts ?? {})) {
          if (typeof command === 'string' && ['dev', 'start', 'build', 'test', 'check', 'lint', 'ios', 'android'].includes(script)) targets.push({ name: script, command: `npm run ${script}`, framework });
        }
      } catch { /* A malformed manifest remains editable; target discovery is optional. */ }
    }
    const canonicalDefault = await realpath(defaultRoot).catch(() => defaultRoot);
    return { id: project.id, name, root: project.root, files: index.files, indexedAt: index.indexedAt, truncated: index.truncated, targets, preview: project.root === canonicalDefault ? { url: '/project-preview.html', label: 'Orbit web preview' } : null };
  }

  async function getFileFor(project, path, index) {
    const relativePath = localPath(path);
    const currentIndex = index ?? await inventory(project);
    if (ignored(relativePath, currentIndex.rules)) throw new ProjectError(403, 'excluded-path', 'This file is excluded by the project’s ignore rules.');
    if (!currentIndex.files.some((file) => file.path === relativePath)) {
      await safeFile(project, relativePath); // Give an actionable missing/large/symlink error first.
      throw new ProjectError(403, 'file-not-indexed', 'This file is outside the supported project inventory. Refresh or open a smaller project.');
    }
    const source = await readSource(project, relativePath);
    const paths = new Set(currentIndex.files.map((file) => file.path));
    const analysis = analyzeSource(relativePath, source, paths);
    for (const entry of currentIndex.files) {
      if (entry.path === relativePath || !SOURCE_EXTENSIONS.has(extname(entry.path).toLowerCase())) continue;
      try {
        const consumerSource = await readSource(project, entry.path);
        const consumerFile = parseFile(entry.path, consumerSource);
        // A malformed file cannot provide a dependable resolved relationship.
        if (consumerFile.parseDiagnostics.length) continue;
        for (const imported of sourceImports(consumerFile, paths)) {
          if (imported.resolvedPath === relativePath) analysis.consumers.push({ path: entry.path, line: imported.line, specifier: imported.specifier });
        }
      } catch { /* Deleted/unsupported files cannot supply current source evidence. */ }
      if (analysis.consumers.length >= 250) break;
    }
    return { path: relativePath, source, revision: hash(source), language: languageForPath(relativePath), analysis };
  }

  function checkedContext(input) {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > 8) throw new ProjectError(400, 'invalid-context', 'A reviewed change supports up to eight saved context files.');
    const paths = new Set();
    return input.map(item => {
      if (!item || typeof item.revision !== 'string' || !item.revision || item.revision.length > 200 || item.revision.includes('\0'))
        throw new ProjectError(400, 'invalid-context', 'Each context file needs a saved revision.');
      const path = localPath(item.path);
      if (paths.has(path)) throw new ProjectError(400, 'invalid-context', 'Context file paths must be unique.');
      paths.add(path);
      return { path, revision: item.revision };
    });
  }

  async function assertContext(project, context) {
    if (!context.length) return;
    const index = await inventory(project);
    for (const item of context) {
      if (ignored(item.path, index.rules)) throw new ProjectError(403, 'excluded-path', 'A context file is now excluded by the project’s ignore rules.');
      // readSource rejects replaced files and directory symlinks, even when
      // inventory omits them. Do not follow a newly redirected context path.
      const revision = hash(await readSource(project, item.path));
      if (!index.files.some(file => file.path === item.path)) throw new ProjectError(403, 'file-not-indexed', 'A context file is outside the supported project inventory.');
      if (revision !== item.revision) throw new ProjectError(409, 'context-conflict', 'Selected context changed while applying this proposal. Generate a new proposal.');
    }
  }

  async function guardedWrite(project, path, expected, replacement, expectedContext = [], guard) {
    if (guard) await guard();
    const current = await readSource(project, path);
    if (current !== expected) throw new ProjectError(409, 'source-conflict', 'The file changed on disk. Your draft is preserved; compare it with the current source before saving.', hash(current));
    const target = await safeFile(project, path);
    const temporaryName = `.foundation-${randomUUID()}.tmp`;
    const temporary = join(dirname(target.path), temporaryName);
    let originalWriteTemporary;
    const assertTemporary = async () => {
      const info=await lstat(temporary);
      if (!info.isFile() || info.isSymbolicLink() || info.dev!==originalWriteTemporary.dev || info.ino!==originalWriteTemporary.ino || info.size>MAX_FILE_BYTES)
        throw new ProjectError(409,'save-temporary-changed','The pending source write changed. The original source was left untouched.');
      const held=await openFile(temporary,constants.O_RDONLY|constants.O_NOFOLLOW);
      try {
        const opened=await held.stat(), bytes=await held.readFile();
        if(opened.dev!==info.dev || opened.ino!==info.ino || bytes.length>MAX_FILE_BYTES || createHash('sha256').update(bytes).digest('hex')!==originalWriteTemporary.hash)
          throw new ProjectError(409,'save-temporary-changed','The pending source write changed. The original source was left untouched.');
      } finally { await held.close(); }
    };
    try {
      const created=await openFile(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,target.info.mode & 0o777);
      try {
        const info=await created.stat();
        originalWriteTemporary=Object.freeze({path:posix.join(posix.dirname(path),temporaryName),dev:info.dev,ino:info.ino,hash:createHash('sha256').update(replacement).digest('hex')});
        await writeFile(created, replacement, {encoding:'utf8'});
      } finally { await created.close(); }
      await assertTemporary();
      // Recheck immediately before atomic replacement. Writes from this service are serialized.
      await assertContext(project, expectedContext);
      if (guard) { await guard(Object.freeze({originalWriteTemporary})); await assertContext(project, expectedContext); }
      const latest = await readSource(project, path);
      if (latest !== expected) throw new ProjectError(409, 'source-conflict', 'The file changed on disk. Your draft is preserved; compare it with the current source before saving.', hash(latest));
      await assertTemporary();
      await rename(temporary, target.path);
    } finally {
      // A substituted foreign file is never removed by cleanup.
      const remaining=await lstat(temporary).catch(()=>null);
      if(remaining && originalWriteTemporary && remaining.dev===originalWriteTemporary.dev && remaining.ino===originalWriteTemporary.ino)
        await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async function snapshot() { return snapshotFor(await ensureActive()); }
  async function open(folder) {
    return serialize(async () => {
      await initialization;
      const project = await prepareProject(folder);
      const state = await snapshotFor(project);
      active = project;
      return state;
    });
  }
  async function getFile(projectId, path) { return getFileFor(await selected(projectId), path); }

  /** One refresh-owned source basis. Never retained or used by write/action validation. */
  async function getFiles(projectId, requestedPaths, options = {}) {
    if (!Array.isArray(requestedPaths) || requestedPaths.length > MAX_SOURCE_BATCH_FILES || requestedPaths.some(path => typeof path !== 'string')) {
      throw new ProjectError(400, 'invalid-source-batch', 'Choose up to 192 source paths for a workspace refresh.');
    }
    const project = await selected(projectId);
    const current = () => {
      if (active !== project || (options.isCurrent && !options.isCurrent())) {
        throw new ProjectError(409, 'source-batch-cancelled', 'This source refresh was superseded. Refresh the current workspace.');
      }
      return true;
    };
    current();
    const index = await scanProject(project, current), paths = new Set(index.files.map(file => file.path));
    current();
    const requested = [...new Set(requestedPaths)], files = new Map(), unavailable = new Map();
    let basisBytes = 0, truncated = index.truncated, budgetExhausted = false;
    const recordUnavailable = (path, error) => unavailable.set(path, {
      path,
      code: error instanceof ProjectError ? error.code : 'source-unavailable',
      message: error instanceof ProjectError ? error.message : 'This source is no longer readable. Refresh the project.',
    });
    const admitSource = source => {
      const size = Buffer.byteLength(source, 'utf8');
      if (basisBytes + size > MAX_INDEX_BYTES) { truncated = true; budgetExhausted = true; return false; }
      basisBytes += size; return true;
    };
    // Requested sources get the bounded read budget first. Their parsed imports
    // also supply consumers below, so a selected source is never parsed twice.
    for (const path of requested) {
      current();
      try {
        const relativePath = localPath(path);
        if (ignored(relativePath, index.rules)) throw new ProjectError(403, 'excluded-path', 'This file is excluded by the project’s ignore rules.');
        if (!paths.has(relativePath)) {
          await safeFile(project, relativePath);
          throw new ProjectError(403, 'file-not-indexed', 'This file is outside the supported project inventory. Refresh or open a smaller project.');
        }
        if (budgetExhausted) throw new ProjectError(413, 'source-batch-too-large', 'The saved-source refresh exceeds 8 MiB. Refresh or open a smaller project.');
        const source = await readSource(project, relativePath);
        current();
        if (!admitSource(source)) throw new ProjectError(413, 'source-batch-too-large', 'The saved-source refresh exceeds 8 MiB. Refresh or open a smaller project.');
        const parsed = SOURCE_EXTENSIONS.has(extname(relativePath).toLowerCase()) ? parseFile(relativePath, source) : undefined;
        const analysis = analyzeSource(relativePath, source, paths, parsed);
        files.set(relativePath, { path: relativePath, source, revision: hash(source), language: languageForPath(relativePath), analysis });
      } catch (error) { current(); recordUnavailable(path, error); }
    }
    // Build all requested consumer lists in inventory order from a single pass.
    // Only imports from valid, safely read source can provide relationship evidence.
    if (files.size) for (const entry of index.files) {
      current();
      if (!SOURCE_EXTENSIONS.has(extname(entry.path).toLowerCase()) || unavailable.has(entry.path)) continue;
      const requestedFile = files.get(entry.path);
      let imports;
      if (requestedFile) {
        if (requestedFile.analysis.unsupported) continue;
        imports = requestedFile.analysis.imports;
      } else {
        if (budgetExhausted) continue;
        let source;
        try { source = await readSource(project, entry.path); }
        catch { current(); continue; }
        current();
        if (!admitSource(source)) continue;
        const parsed = parseFile(entry.path, source);
        if (parsed.parseDiagnostics.length) continue;
        imports = sourceImports(parsed, paths);
      }
      // Match getFile's existing per-consumer-file cap, including multiple
      // imports of the same target within the final accepted consumer file.
      const accepting = new Set([...files.values()].filter(file => file.path !== entry.path && file.analysis.consumers.length < 250).map(file => file.path));
      for (const imported of imports) if (accepting.has(imported.resolvedPath)) {
        files.get(imported.resolvedPath).analysis.consumers.push({ path: entry.path, line: imported.line, specifier: imported.specifier });
      }
    }
    // A target read early in a longer scan must still exist with exactly the
    // same bytes at completion. These fresh reads do not reuse metadata/mtime.
    // Action-time validation remains a separate, uncached getFile/write path.
    for (const [path, file] of files) {
      current();
      try {
        const latest = await readSource(project, path);
        current();
        if (latest !== file.source) throw new ProjectError(409, 'source-changed', 'This source changed during the refresh. Refresh the workspace again.');
      } catch (error) { current(); files.delete(path); recordUnavailable(path, error); }
    }
    current();
    // A requested consumer invalidated by the final check cannot still supply
    // a relationship on another returned target. Unrequested consumers remain
    // evidence from this inventory/read basis; owner epochs cancel newer work.
    for (const file of files.values()) file.analysis.consumers = file.analysis.consumers.filter(consumer => !unavailable.has(consumer.path));
    if (truncated) for (const file of files.values()) file.analysis.consumersTruncated = true;
    return { files: requested.flatMap(path => files.has(path) ? [files.get(path)] : []),
      unavailable: requested.flatMap(path => unavailable.has(path) ? [unavailable.get(path)] : []), indexedAt: index.indexedAt, truncated };
  }

  async function relationshipInputs(projectId, path, options = {}) {
    assertRelationshipsCurrent(options.isCurrent);
    const project = await selected(projectId);
    const isCurrent = () => active === project && (!options.isCurrent || options.isCurrent());
    assertRelationshipsCurrent(isCurrent);
    const anchorPath = localPath(path), index = await scanProject(project, isCurrent);
    assertRelationshipsCurrent(isCurrent);
    if (ignored(anchorPath, index.rules)) throw new ProjectError(403, 'excluded-path', 'The selected source is excluded by project ignore rules.');
    if (!index.files.some(file => file.path === anchorPath)) throw new ProjectError(403, 'file-not-indexed', 'Choose an indexed source file for relationships.');
    const files = [], unavailable = [];
    let bytes = 0, inventoryTruncated = index.truncated;
    // Read each saved source at most once. getFile's per-file consumer scan is
    // deliberately not used to build this focused project-wide binding model.
    for (const entry of [...index.files].sort((a, b) => a.path === anchorPath ? -1 : b.path === anchorPath ? 1 : a.path.localeCompare(b.path))) {
      assertRelationshipsCurrent(isCurrent);
      let source;
      try { source = await readSource(project, entry.path); }
      catch (error) { if (entry.path === anchorPath) throw error; unavailable.push({ path: entry.path }); continue; }
      assertRelationshipsCurrent(isCurrent);
      const size = Buffer.byteLength(source, 'utf8');
      if (bytes + size > MAX_INDEX_BYTES) { inventoryTruncated = true; unavailable.push({ path: entry.path }); continue; }
      files.push({ path: entry.path, source, revision: hash(source) }); bytes += size;
    }
    return { projectId, anchorPath, files, indexedCount: index.files.length, inventoryTruncated, unavailable, isCurrent };
  }

  async function relationships(projectId, path, options = {}) {
    return analyzeRelationships(await relationshipInputs(projectId,path,options));
  }

  async function changeImpact(projectId, target, options = {}) {
    const inputs = await relationshipInputs(projectId,target?.path,options);
    return analyzeChangeImpact({...inputs,target});
  }

  async function validateChangeImpact(projectId, snapshot, options = {}) {
    assertRelationshipsCurrent(options.isCurrent);
    let value;
    try { value = checkedChangeImpact(snapshot,projectId); } catch { return false; }
    return validateRelationships(projectId,{schemaVersion:1,projectId,anchor:value.target,manifest:value.manifest},{...options,requireCompleteInventory:true});
  }

  async function validateRelationships(projectId, snapshot, options = {}) {
    assertRelationshipsCurrent(options.isCurrent);
    const project = await selected(projectId);
    const isCurrent = () => active === project && (!options.isCurrent || options.isCurrent());
    assertRelationshipsCurrent(isCurrent);
    if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.projectId !== projectId || !Array.isArray(snapshot.manifest) || snapshot.manifest.length > MAX_FILES) return false;
    const manifest = new Map();
    for (const item of snapshot.manifest) {
      if (!item || typeof item.path !== 'string' || !/^[a-f0-9]{16}$/.test(item.revision) || manifest.has(item.path)) return false;
      try { localPath(item.path); } catch { return false; }
      manifest.set(item.path, item.revision);
    }
    if (!snapshot.anchor || manifest.get(snapshot.anchor.path) !== snapshot.anchor.revision) return false;
    const index = await scanProject(project, isCurrent);
    assertRelationshipsCurrent(isCurrent);
    // Missing, newly included, newly ignored, or unreadable files can change
    // consumers and barrel bindings even if both displayed endpoints match.
    if (options.requireCompleteInventory && index.truncated || index.files.length !== manifest.size || index.files.some(file => !manifest.has(file.path))) return false;
    let bytes = 0;
    for (const entry of index.files) {
      assertRelationshipsCurrent(isCurrent);
      let source;
      try { source = await readSource(project, entry.path); } catch { return false; }
      assertRelationshipsCurrent(isCurrent);
      bytes += Buffer.byteLength(source, 'utf8');
      if (bytes > MAX_INDEX_BYTES || hash(source) !== manifest.get(entry.path)) return false;
    }
    assertRelationshipsCurrent(isCurrent);
    return true;
  }

  // Revalidate a durable analysis basis without running the relationship tool.
  // This grants no fresh result identity and is never a provider request.
  async function validateInvestigation(projectId, snapshot, options = {}) {
    assertRelationshipsCurrent(options.isCurrent);
    let value;
    try { value = validateSourceInvestigation(snapshot, projectId); } catch { return false; }
    const project = await selected(projectId);
    const isCurrent = () => active === project && (!options.isCurrent || options.isCurrent());
    assertRelationshipsCurrent(isCurrent);
    const index = await scanProject(project, isCurrent);
    assertRelationshipsCurrent(isCurrent);
    if (index.truncated || !index.files.some(file => file.path === value.anchor.path)) return false;
    const manifest = []; let bytes = 0;
    for (const entry of index.files) {
      assertRelationshipsCurrent(isCurrent);
      let source; try { source = await readSource(project, entry.path); } catch { return false; }
      assertRelationshipsCurrent(isCurrent);
      bytes += Buffer.byteLength(source, 'utf8'); if (bytes > MAX_INDEX_BYTES) return false;
      manifest.push({path:entry.path, revision:hash(source)});
    }
    manifest.sort((a,b) => a.path.localeCompare(b.path));
    assertRelationshipsCurrent(isCurrent);
    return manifest.some(item => item.path === value.anchor.path && item.revision === value.anchor.revision) &&
      createHash('sha256').update(JSON.stringify(manifest)).digest('hex') === value.basisDigest;
  }

  async function save({ projectId, path, source, baseRevision, expectedContext }, {guard} = {}) {
    return serialize(async () => {
      const project = await selected(projectId);
      if (guard !== undefined && typeof guard !== 'function') throw new ProjectError(400,'invalid-save-guard','A save guard must be an internal callback.');
      const checkGuard = async (context = Object.freeze({})) => {
        if (active !== project || guard && await guard(context) === false || active !== project) throw new ProjectError(409,'save-cancelled','The save lost its project or draft ownership.');
      };
      await checkGuard();
      const context = checkedContext(expectedContext);
      if (typeof source !== 'string' || source.includes('\0') || Buffer.from(source, 'utf8').toString('utf8') !== source) throw new ProjectError(400, 'invalid-source', 'Source must be UTF-8 text.');
      if (Buffer.byteLength(source, 'utf8') > MAX_FILE_BYTES) throw new ProjectError(413, 'file-too-large', 'Source files are limited to 256 KiB in this workbench.');
      const file = await getFileFor(project, path);
      if (typeof baseRevision !== 'string' || baseRevision !== file.revision) throw new ProjectError(409, 'source-conflict', 'The file changed on disk. Your draft is preserved; compare it with the current source before saving.', file.revision);
      await assertContext(project, context);
      if (source !== file.source) {
        await guardedWrite(project, file.path, file.source, source, context, checkGuard);
        const stored = project.checkpoints.get(file.path);
        // A newly reviewed external version becomes the baseline, preserving those edits on undo.
        const prior = stored?.after === file.source ? stored : null;
        project.checkpoints.set(file.path, { before: prior?.before ?? file.source, after: source, baseRevision: prior?.baseRevision ?? file.revision });
        if (source === (prior?.before ?? file.source)) project.checkpoints.delete(file.path);
      }
      return getFileFor(project, file.path);
    });
  }
  /** Journaled, serialized replacements. Each rename is atomic; the whole set is not. */
  async function applyBatch({projectId, files, expectedContext}, {guard, journal} = {}) {
    return serialize(async () => {
      const project = await selected(projectId), context = checkedContext(expectedContext);
      if (!Array.isArray(files) || files.length < 1 || files.length > 8 || typeof guard !== 'function' || typeof journal !== 'function')
        throw new ProjectError(400,'invalid-batch','A change set requires one to eight existing files and a durable guarded journal.');
      const paths = new Set(); let beforeBytes = 0, afterBytes = 0;
      const targets = files.map(item => {
        const path = localPath(item?.path);
        if (paths.has(path) || typeof item.before !== 'string' || typeof item.after !== 'string' || item.before === item.after ||
          [item.before,item.after].some(value => value.includes('\0') || Buffer.byteLength(value) > MAX_FILE_BYTES || Buffer.from(value,'utf8').toString('utf8') !== value) || item.baseRevision !== hash(item.before))
          throw new ProjectError(400,'invalid-batch','Each change-set file needs unique, valid original and proposed source.');
        paths.add(path); beforeBytes += Buffer.byteLength(item.before); afterBytes += Buffer.byteLength(item.after);
        if (!context.some(ref => ref.path === path && ref.revision === item.baseRevision))
          throw new ProjectError(400,'invalid-context','Every changed file must retain its expected source revision.');
        return {path,before:item.before,after:item.after,baseRevision:item.baseRevision,afterRevision:hash(item.after)};
      }).sort((a,b) => a.path.localeCompare(b.path));
      if (beforeBytes > 256*1024 || afterBytes > 256*1024) throw new ProjectError(413,'batch-too-large','A change set supports up to 256 KiB on each side.');
      const writtenPaths = [], temporary = new Map();
      const assertTemporary=async value=>{
        const info=await lstat(value.absolute);
        if(!info.isFile()||info.isSymbolicLink()||info.dev!==value.dev||info.ino!==value.ino||info.size>MAX_FILE_BYTES)throw new ProjectError(409,'batch-temporary-changed','A pending group write changed. Inspect the source and recovery state.');
        const handle=await openFile(value.absolute,constants.O_RDONLY|constants.O_NOFOLLOW);
        try{const held=await handle.stat(),bytes=await handle.readFile();if(held.dev!==value.dev||held.ino!==value.ino||bytes.length>MAX_FILE_BYTES||createHash('sha256').update(bytes).digest('hex')!==value.hash)throw new ProjectError(409,'batch-temporary-changed','A pending group write changed. Inspect the source and recovery state.');}finally{await handle.close();}
      };
      const check = async (phase='preflight',targetPath) => {
        const originalBatchWrite=Object.freeze({phase,...(targetPath?{targetPath}:{}),writtenPaths:Object.freeze([...writtenPaths]),temporaries:Object.freeze([...temporary.values()].map(({absolute,...value})=>Object.freeze({...value})))});
        for(const value of temporary.values())await assertTemporary(value);
        if (active !== project || await guard(Object.freeze({originalBatchWrite})) === false) throw new ProjectError(409,'batch-cancelled','The change-set operation lost its project or draft ownership.');
        if (active !== project) throw new ProjectError(409,'batch-cancelled','The open project changed.');
        for(const value of temporary.values())await assertTemporary(value);
      };
      const record = async (type,path) => { await journal({type,...(path ? {path} : {}),writtenPaths:[...writtenPaths]}); await check(); };
      const expected = () => context.map(ref => {
        const target = targets.find(item => item.path === ref.path);
        return {path:ref.path,revision:target && writtenPaths.includes(ref.path) ? target.afterRevision : ref.revision};
      });
      try {
        await check(); await assertContext(project,context);
        for (const item of targets) { if (await readSource(project,item.path) !== item.before) throw new ProjectError(409,'source-conflict','A change-set source changed before Apply.'); await check(); }
        await record('prepared');
        for (const item of targets) {
          const target = await safeFile(project,item.path), name=`.foundation-${randomUUID()}.tmp`, absolute=join(dirname(target.path),name);
          const handle = await openFile(absolute,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,target.info.mode & 0o777);
          try { const info=await handle.stat();temporary.set(item.path,{absolute,targetPath:item.path,path:posix.join(posix.dirname(item.path),name),dev:info.dev,ino:info.ino,hash:createHash('sha256').update(item.after).digest('hex')});await handle.writeFile(item.after,'utf8'); await handle.sync(); } finally { await handle.close(); }
          await check();
        }
        for (const item of targets) {
          await record('before-write',item.path);
          await assertContext(project,expected());
          if (await readSource(project,item.path) !== item.before) throw new ProjectError(409,'source-conflict','A change-set file changed while Apply was being prepared.');
          const target = await safeFile(project,item.path); await check('before-write',item.path);
          // Revalidate after the asynchronous native-draft guard, just before replacement.
          await assertContext(project,expected());
          if (await readSource(project,item.path) !== item.before) throw new ProjectError(409,'source-conflict','A change-set source changed immediately before replacement.');
          await assertTemporary(temporary.get(item.path));
          await rename(temporary.get(item.path).absolute,target.path); temporary.delete(item.path); writtenPaths.push(item.path);
          const directory = await openFile(dirname(target.path),constants.O_RDONLY);
          try { await directory.sync(); } finally { await directory.close(); }
          const stored = project.checkpoints.get(item.path), prior = stored?.after === item.before ? stored : null;
          project.checkpoints.set(item.path,{before:prior?.before ?? item.before,after:item.after,baseRevision:prior?.baseRevision ?? item.baseRevision});
          if (item.after === (prior?.before ?? item.before)) project.checkpoints.delete(item.path);
          await record('after-write',item.path);
        }
        await record('complete');await check('complete');
        // The durable journal/owner callback may yield after the last rename.
        // Check every saved basis again before acknowledging the completed set.
        await assertContext(project,expected());
        return {files:targets.map(item => ({path:item.path,revision:item.afterRevision})),writtenPaths:[...writtenPaths]};
      } catch (error) {
        // Exact on-disk reconciliation, rather than this progress list alone,
        // determines recovery after a crash or failed journal write.
        if (error && typeof error === 'object') error.writtenPaths = [...writtenPaths];
        throw error;
      } finally { await Promise.all([...temporary.values()].map(async value=>{const info=await lstat(value.absolute).catch(()=>null);if(info&&info.dev===value.dev&&info.ino===value.ino)await rm(value.absolute,{force:true}).catch(()=>{});})); }
    });
  }
  async function search(projectId, query) {
    const project = await selected(projectId);
    if (typeof query !== 'string' || query.length > 200) throw new ProjectError(400, 'invalid-query', 'Search for up to 200 characters of literal text.');
    if (!query.length) return { matches: [], truncated: false };
    const index = await inventory(project);
    const needle = query.toLowerCase();
    const matches = [];
    let truncated = index.truncated;
    for (const file of index.files) {
      let source;
      try { source = await readSource(project, file.path); } catch { continue; }
      const lines = source.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let offset = 0;
        while (offset <= line.length) {
          const column = line.toLowerCase().indexOf(needle, offset);
          if (column < 0) break;
          if (matches.length >= MAX_MATCHES) return { matches, truncated: true };
          matches.push({ path: file.path, line: i + 1, column: column + 1, text: line.slice(0, 2000) });
          offset = column + Math.max(needle.length, 1);
        }
      }
    }
    return { matches, truncated };
  }
  async function changes(projectId) {
    const project = await selected(projectId);
    const changes = [];
    for (const [path, checkpoint] of project.checkpoints) {
      let current = null;
      try { current = await readSource(project, path); } catch { /* Missing or unsafe source is a conflict, never an undo candidate. */ }
      changes.push({ path, ...checkpoint, revision: current === null ? '' : hash(current), conflict: current !== checkpoint.after });
    }
    changes.sort((a, b) => a.path.localeCompare(b.path));
    return { changes };
  }
  async function revert({ projectId, path, revision }) {
    return serialize(async () => {
      const project = await selected(projectId);
      const relativePath = localPath(path);
      const checkpoint = project.checkpoints.get(relativePath);
      if (!checkpoint) throw new ProjectError(409, 'nothing-to-revert', 'There is no saved Foundation change for this file in the current session.');
      const file = await getFileFor(project, relativePath);
      if (revision !== file.revision || file.source !== checkpoint.after) throw new ProjectError(409, 'source-conflict', 'The file changed after Foundation saved it. Revert is blocked so newer edits remain intact.', file.revision);
      await guardedWrite(project, relativePath, checkpoint.after, checkpoint.before);
      project.checkpoints.delete(relativePath);
      return getFileFor(project, relativePath);
    });
  }

  async function handle({ request, url, body, send }) {
    if (!url.pathname.startsWith('/api/project')) return false;
    const path = url.pathname;
    const projectId = url.searchParams.get('projectId');
    if (request.method === 'GET' && path === '/api/project') send(200, await snapshot());
    else if (request.method === 'POST' && path === '/api/project/open') send(200, await open(body?.root));
    else if (request.method === 'GET' && path === '/api/project/file') send(200, await getFile(projectId, url.searchParams.get('path')));
    else if (request.method === 'POST' && path === '/api/project/file') send(200, await save(body ?? {}));
    else if (request.method === 'GET' && path === '/api/project/search') send(200, await search(projectId, url.searchParams.get('q') ?? ''));
    else if (request.method === 'GET' && path === '/api/project/changes') send(200, await changes(projectId));
    else if (request.method === 'POST' && path === '/api/project/revert') send(200, await revert(body ?? {}));
    else throw new ProjectError(404, 'not-found', 'This project endpoint does not exist.');
    return true;
  }

  return { handle, snapshot, getFile, getFiles, relationships, validateRelationships, changeImpact, validateChangeImpact, validateInvestigation, open, save, applyBatch, search, changes, revert };
}
