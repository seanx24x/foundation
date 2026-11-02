import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import ts from 'typescript';

const CODE = /\.(?:tsx?|jsx?|mjs|cjs)$/i;
const STYLE = /\.(?:css|scss|sass|less)$/i;
const TEST = /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i;
const LIMITS = { edges: 200, requests: 100, candidates: 24, boundaries: 100 };
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const literal = node => node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
const point = (file, node) => { const at = file.getLineAndCharacterOfPosition(node.getStart(file)); return { line: at.line + 1, column: at.character + 1 }; };
const bounded = value => String(value).slice(0, 180);

export function assertRelationshipsCurrent(isCurrent) {
  if (isCurrent && !isCurrent()) {
    const error = new Error('Source relationships were superseded. Refresh the current selection.');
    error.code = 'relationships-cancelled'; throw error;
  }
}

/** Resolve only a unique, relative source path already read through the project adapter. */
function moduleResolution(from, specifier, files) {
  if (!specifier.startsWith('.')) return { path: null, reason: 'Package and configured alias resolution is outside this source view.' };
  if (/[\\\u0000-\u001f\u007f?#]/.test(specifier)) return { path: null, reason: 'This module specifier needs project-specific resolution.' };
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (base === '..' || base.startsWith('../') || base.startsWith('/')) return { path: null, reason: 'This relative module leaves the indexed project.' };
  const candidates = new Set([base]);
  if (!posix.extname(base)) {
    for (const extension of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']) candidates.add(base + extension);
    for (const extension of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) candidates.add(`${base}/index${extension}`);
  } else if (/\.[cm]?js$/i.test(base)) {
    candidates.add(base.replace(/\.[cm]?js$/i, '.ts'));
    candidates.add(base.replace(/\.[cm]?js$/i, '.tsx'));
  }
  const found = [...candidates].filter(path => files.has(path));
  return found.length === 1 ? { path: found[0] } : { path: null, reason: found.length > 1
    ? 'Multiple indexed files match this module; project resolution is ambiguous here.'
    : 'No unique, safely readable indexed file matches this module.' };
}

function sanitizedURL(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  value = value.trim();
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
      const url = new URL(value.startsWith('//') ? `http:${value}` : value);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      url.username = ''; url.password = ''; url.search = ''; url.hash = '';
      return (value.startsWith('//') ? url.href.replace(/^http:/, '') : url.href).slice(0, 1024);
    }
    return value.split(/[?#]/, 1)[0].slice(0, 1024);
  } catch { return null; }
}

function requestMethod(node, literalInput) {
  if (!node.arguments[1]) return literalInput ? 'GET' : null;
  const options = node.arguments[1]; if (!ts.isObjectLiteralExpression(options)) return null;
  let method = literalInput ? 'GET' : null;
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property) || property.name && ts.isComputedPropertyName(property.name)) { method = null; continue; }
    const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) ? property.name.text : undefined;
    if (name !== 'method') continue;
    const value = ts.isPropertyAssignment(property) ? literal(property.initializer) : null;
    method = value && /^[A-Za-z]{1,16}$/.test(value) ? value.toUpperCase() : null;
  }
  return method;
}

function namedFunction(node) {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) return node.name?.text || (node.modifiers?.some(item => item.kind === ts.SyntaxKind.DefaultKeyword) ? 'default' : undefined);
  if (ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  return undefined;
}
function ownerFunction(node) {
  for (let current = node.parent; current; current = current.parent) if (ts.isFunctionLike(current)) return namedFunction(current);
  return undefined;
}

/** Pure bounded analysis: inputs are saved files supplied by the safe project reader. */
export async function analyzeRelationships({ projectId, anchorPath, files, indexedCount = files.length, inventoryTruncated = false, unavailable = [], isCurrent }) {
  assertRelationshipsCurrent(isCurrent);
  const byPath = new Map(files.map(file => [file.path, file]));
  const anchor = byPath.get(anchorPath);
  if (!anchor) throw new Error('The selected source is unavailable for relationship analysis.');
  const result = { schemaVersion: 1, projectId, anchor: { path: anchorPath, line: 1, column: 1, revision: anchor.revision },
    analyzedAt: new Date().toISOString(), manifest: files.map(({ path, revision }) => ({ path, revision })).sort((a, b) => a.path.localeCompare(b.path)),
    edges: [], requests: [], candidates: [], boundaries: [], truncated: Boolean(inventoryTruncated), counts: { indexed: indexedCount, analyzed: 0 } };
  const seen = { edges: new Set(), requests: new Set(), boundaries: new Set() };
  const push = (key, value) => {
    const identity = value.id || JSON.stringify(value);
    if (seen[key]?.has(identity)) return;
    seen[key]?.add(identity);
    if (result[key].length >= LIMITS[key]) { result.truncated = true; return; }
    result[key].push(value);
  };
  const boundary = (kind, detail, path, line) => push('boundaries', { kind, ...(path ? { path } : {}), ...(line ? { line } : {}), detail });
  boundary('unsupported', 'Static source relationships do not establish runtime order, backend behavior, test execution, or coverage. Dynamic dispatch, configured aliases, packages, and CommonJS bindings are not resolved.');
  if (inventoryTruncated) boundary('limit', 'The project inventory reached its existing file, byte, depth, or scan limits. More relationships may exist outside this view.');
  for (const item of unavailable) boundary('unavailable', 'This indexed source could not be read safely. It contributes no relationships.', item.path);
  const sourceFiles = new Map(), imports = new Map(), reexports = new Map(), conflictingExports = new Set();
  const ref = (path, node, label) => {
    const source = sourceFiles.get(path), file = byPath.get(path);
    return { path, ...(source && node ? point(source, node) : { line: 1, column: 1 }), revision: file.revision, ...(label ? { label: bounded(label) } : {}) };
  };
  const addEdge = (kind, from, to, detail) => {
    if (from.path !== anchorPath && to.path !== anchorPath) return;
    const item = { kind, from, to, provenance: 'source', ...(detail ? { detail } : {}) };
    push('edges', { id: `relationship-${digest(JSON.stringify(item))}`, ...item });
  };
  const addUse = (kind, from, to, detail) => {
    addEdge(kind, from, to, detail);
    if (TEST.test(from.path) && from.path !== to.path) addEdge('test-reference', from, to, 'A test file references this source. Execution and coverage are not established.');
  };
  for (const [index, file] of files.entries()) {
    if (!CODE.test(file.path)) continue;
    const kind = /\.tsx$/i.test(file.path) ? ts.ScriptKind.TSX : /\.jsx$/i.test(file.path) ? ts.ScriptKind.JSX : /\.(?:js|mjs|cjs)$/i.test(file.path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    let parsed;
    try { parsed = ts.createSourceFile(`/${file.path}`, file.source, ts.ScriptTarget.Latest, true, kind); }
    catch { boundary('parse-error', 'This source exceeds the parser limits; its relationships are withheld.', file.path); continue; }
    let nodes = 0, limited = false;
    const pending = [{ node: parsed, depth: 0 }];
    while (pending.length) {
      const { node, depth } = pending.pop();
      if (++nodes > 50000 || depth > 128) { limited = true; break; }
      ts.forEachChild(node, child => { pending.push({ node: child, depth: depth + 1 }); });
    }
    if (limited) { result.truncated = true; boundary('limit', 'This source exceeds the syntax node or nesting limit; its relationships are withheld.', file.path); continue; }
    if (parsed.parseDiagnostics.length) { boundary('parse-error', 'This file has syntax errors; its relationships are withheld.', file.path); continue; }
    sourceFiles.set(file.path, parsed); result.counts.analyzed++;
    if (index % 32 === 0) { await new Promise(resolve => setImmediate(resolve)); assertRelationshipsCurrent(isCurrent); }
  }
  if (!CODE.test(anchorPath)) boundary('unsupported', 'This file can have incoming imports, but its own language is not analyzed by the TypeScript/JavaScript adapter.', anchorPath);
  for (const [path, file] of sourceFiles) {
    const entries = [], exports = [], exportedNames = new Map();
    const declareExport = (name, node) => { const prior = exportedNames.get(name) || []; prior.push(node); exportedNames.set(name, prior); };
    for (const statement of file.statements) {
      if (ts.isExportDeclaration(statement) && statement.exportClause) {
        if (ts.isNamedExports(statement.exportClause)) for (const element of statement.exportClause.elements) declareExport(element.name.text, element);
        else if (ts.isNamespaceExport(statement.exportClause)) declareExport(statement.exportClause.name.text, statement.exportClause);
      } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) declareExport('default', statement);
      else if (statement.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword || item.kind === ts.SyntaxKind.DefaultKeyword)) {
        if (statement.modifiers.some(item => item.kind === ts.SyntaxKind.DefaultKeyword)) declareExport('default', statement);
        else if (statement.name && ts.isIdentifier(statement.name)) declareExport(statement.name.text, statement);
        else if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) declareExport(declaration.name.text, declaration);
      }
    }
    for (const declarations of exportedNames.values()) if (declarations.length > 1 && !(declarations.every(ts.isFunctionDeclaration) && declarations.filter(node => node.body).length <= 1)) conflictingExports.add(path);
    for (const statement of file.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) && statement.moduleSpecifier)) continue;
      const specifier = literal(statement.moduleSpecifier); if (specifier === null) continue;
      const resolution = moduleResolution(path, specifier, byPath);
      const kind = ts.isExportDeclaration(statement) ? 're-export' : resolution.path && STYLE.test(resolution.path) ? 'stylesheet' : 'import';
      entries.push({ node: statement, specifier, ...resolution });
      if (ts.isExportDeclaration(statement)) exports.push({ node: statement, ...resolution, star: !statement.exportClause });
      if (resolution.path) addUse(kind, ref(path, statement, specifier), ref(resolution.path), statement.isTypeOnly || statement.importClause?.isTypeOnly ? 'Type-only source dependency.' : undefined);
      else if (path === anchorPath) boundary('unresolved', resolution.reason, path, point(file, statement).line);
    }
    imports.set(path, entries); reexports.set(path, exports);
  }
  assertRelationshipsCurrent(isCurrent);
  await new Promise(resolve => setImmediate(resolve));
  assertRelationshipsCurrent(isCurrent);
  const canonical = value => value.startsWith('/') ? value.slice(1) : value;
  const extension = path => /\.tsx$/i.test(path) ? ts.Extension.Tsx : /\.jsx$/i.test(path) ? ts.Extension.Jsx : /\.mjs$/i.test(path) ? ts.Extension.Mjs : /\.cjs$/i.test(path) ? ts.Extension.Cjs : /\.js$/i.test(path) ? ts.Extension.Js : ts.Extension.Ts;
  const host = {
    getSourceFile: name => sourceFiles.get(canonical(name)), getDefaultLibFileName: () => '', writeFile() {},
    getCurrentDirectory: () => '/', getDirectories: () => [], getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    fileExists: name => sourceFiles.has(canonical(name)), readFile: name => byPath.get(canonical(name))?.source,
    directoryExists: () => true, realpath: name => name,
    resolveModuleNames: (names, from) => names.map(name => {
      const { path } = moduleResolution(canonical(from), name, byPath);
      return path && sourceFiles.has(path) ? { resolvedFileName: `/${path}`, extension: extension(path), isExternalLibraryImport: false } : undefined;
    }),
  };
  const program = ts.createProgram({ rootNames: [...sourceFiles.keys()].map(path => `/${path}`), options: { noLib: true, noEmit: true, allowJs: true, checkJs: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, skipLibCheck: true }, host });
  const checker = program.getTypeChecker();
  assertRelationshipsCurrent(isCurrent);
  // Without project resolution/semantic configuration, multiple wildcard export
  // paths remain a boundary instead of silently picking TypeScript's first match.
  const uncertainExports = (path, visited = new Set()) => {
    if (visited.has(path)) return false; visited.add(path);
    const entries = reexports.get(path) || [];
    return conflictingExports.has(path) || entries.filter(item => item.star).length > 1 || entries.some(item => item.path && uncertainExports(item.path, visited));
  };
  const aliasModule = symbol => {
    for (const declaration of symbol?.declarations || []) for (let node = declaration; node; node = node.parent) {
      if (ts.isImportDeclaration(node)) return imports.get(canonical(node.getSourceFile().fileName))?.find(item => item.node === node)?.path;
      if (ts.isSourceFile(node)) break;
    }
    return undefined;
  };
  const resolveSymbol = node => {
    let symbol = checker.getSymbolAtLocation(node);
    if (!symbol) return null;
    const imported = aliasModule(symbol);
    if (imported && uncertainExports(imported)) return null;
    if (symbol.flags & ts.SymbolFlags.Alias) { try { symbol = checker.getAliasedSymbol(symbol); } catch { return null; } }
    return symbol;
  };
  const hasLocalDeclaration = node => Boolean(checker.getSymbolAtLocation(node)?.declarations?.length);
  const isGlobalObject = node => ts.isIdentifier(node) && ['window', 'globalThis'].includes(node.text) && !hasLocalDeclaration(node);
  let globalFetchWritten = false;
  const markGlobalFetchWrite = (node, symbol = checker.getSymbolAtLocation(node)) => {
    if (ts.isIdentifier(node) && ['fetch', 'window', 'globalThis'].includes(node.text) && !symbol?.declarations?.length) globalFetchWritten = true;
    else if (ts.isPropertyAccessExpression(node) && node.name.text === 'fetch' && isGlobalObject(node.expression) ||
      ts.isElementAccessExpression(node) && literal(node.argumentExpression) === 'fetch' && isGlobalObject(node.expression)) globalFetchWritten = true;
  };
  const writes = new Set();
  const markWriteSymbol = symbol => {
    if (symbol?.flags & ts.SymbolFlags.Alias) { try { symbol = checker.getAliasedSymbol(symbol); } catch { return; } }
    if (symbol) writes.add(symbol);
  };
  const assignmentTarget = node => {
    if (!node) return;
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) { markGlobalFetchWrite(node); markWriteSymbol(checker.getSymbolAtLocation(node)); }
    else if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node) || ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) assignmentTarget(node.expression);
    else if (ts.isArrayLiteralExpression(node)) for (const element of node.elements) assignmentTarget(element);
    else if (ts.isObjectLiteralExpression(node)) for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) assignmentTarget(property.initializer);
      else if (ts.isShorthandPropertyAssignment(property)) {
        const symbol = checker.getShorthandAssignmentValueSymbol(property);
        markGlobalFetchWrite(property.name, symbol || null); markWriteSymbol(symbol);
      }
      else if (ts.isSpreadAssignment(property)) assignmentTarget(property.expression);
    }
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) assignmentTarget(node.left);
  };
  for (const file of sourceFiles.values()) {
    const visit = node => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) assignmentTarget(node.left);
      else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) assignmentTarget(node.operand);
      else if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) assignmentTarget(node.initializer);
      else if (ts.isDeleteExpression(node)) assignmentTarget(node.expression);
      ts.forEachChild(node, visit);
    }; visit(file);
  }
  const declarationFor = (symbol, kind, visited = new Set()) => {
    if (!symbol || visited.has(symbol) || writes.has(symbol)) return null; visited.add(symbol);
    const declarations = (symbol.declarations || []).filter(node => sourceFiles.has(canonical(node.getSourceFile().fileName)));
    if (kind === 'type-reference') {
      const supported = declarations.filter(node => ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node));
      return supported.length === 1 ? supported[0] : null;
    }
    const implemented = declarations.filter(node => ts.isFunctionDeclaration(node) && node.body || kind === 'render' && ts.isClassDeclaration(node));
    if (implemented.length === 1) return implemented[0];
    if (declarations.length !== 1 || !ts.isVariableDeclaration(declarations[0])) return null;
    const declaration = declarations[0];
    if (!(declaration.parent.flags & ts.NodeFlags.Const) || !ts.isIdentifier(declaration.name)) return null;
    const value = declaration.initializer;
    if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) return declaration;
    if (value && ts.isIdentifier(value)) return declarationFor(resolveSymbol(value), kind, visited);
    return null;
  };
  const namespaceMember = node => {
    if (!ts.isPropertyAccessExpression(node) && !ts.isQualifiedName(node)) return false;
    const left = ts.isPropertyAccessExpression(node) ? node.expression : node.left;
    if (!ts.isIdentifier(left)) return false;
    const symbol = checker.getSymbolAtLocation(left);
    return symbol?.declarations?.some(declaration => ts.isNamespaceImport(declaration) && !uncertainExports(aliasModule(symbol))) || false;
  };
  const isGlobalFetch = node => {
    if (ts.isIdentifier(node)) return node.text === 'fetch' && !hasLocalDeclaration(node);
    return ts.isPropertyAccessExpression(node) && node.name.text === 'fetch' && isGlobalObject(node.expression);
  };
  const testReferences = new Set();
  for (const [index, [path, file]] of [...sourceFiles].entries()) {
    const use = (kind, expression, node) => {
      if (!ts.isIdentifier(expression) && !namespaceMember(expression)) {
        if (path === anchorPath) boundary('unsupported', 'Computed, object-member, or dynamically supplied bindings are not resolved.', path, point(file, node).line);
        return;
      }
      const target = declarationFor(resolveSymbol(expression), kind);
      if (!target) {
        if (path === anchorPath) boundary('unresolved', 'This binding has no unambiguous supported local definition in the indexed source.', path, point(file, node).line);
        return;
      }
      const targetPath = canonical(target.getSourceFile().fileName);
      const name = target.name && ts.isIdentifier(target.name) ? target.name.text : 'default';
      addUse(kind, ref(path, expression, expression.getText(file)), ref(targetPath, target.name || target, name));
      if (targetPath === anchorPath && TEST.test(path)) testReferences.add(path);
    };
    const visit = node => {
      if (TEST.test(path) && ts.isIdentifier(node)) {
        const symbol = resolveSymbol(node), target = declarationFor(symbol, 'render') || declarationFor(symbol, 'type-reference');
        if (target) {
          const targetPath = canonical(target.getSourceFile().fileName);
          if (targetPath !== path && (targetPath === anchorPath || path === anchorPath)) {
            const name = target.name && ts.isIdentifier(target.name) ? target.name.text : 'default';
            addEdge('test-reference', ref(path, node, node.text), ref(targetPath, target.name || target, name), 'A test file references this source. Execution and coverage are not established.');
            if (targetPath === anchorPath) testReferences.add(path);
          }
        }
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName;
        if (!ts.isIdentifier(name) || /^[A-Z]/.test(name.text)) use('render', name, node);
      } else if (ts.isCallExpression(node)) {
        if (isGlobalFetch(node.expression)) {
          if (path === anchorPath && globalFetchWritten) {
            boundary('unresolved', 'Indexed source visibly replaces a global fetch binding. These calls are not identified as network requests.', path, point(file, node).line);
          } else if (path === anchorPath) {
            const value = literal(node.arguments[0]), source = ref(path, node, ownerFunction(node));
            const request = { source, method: requestMethod(node, value !== null), url: sanitizedURL(value), urlKind: value === null ? 'dynamic' : 'literal', provenance: 'source' };
            push('requests', { id: `request-${digest(JSON.stringify(request))}`, ...request });
            if (value === null) boundary('unresolved', 'This fetch input is dynamic. Its actual URL and any Request-owned method require runtime observation.', path, source.line);
            else if (request.url === null) boundary('unsupported', 'This literal fetch URL is not a supported HTTP or relative URL.', path, source.line);
          }
        } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require' && !checker.getSymbolAtLocation(node.expression)) {
          if (path === anchorPath) boundary('unsupported', 'Dynamic import and CommonJS loading are outside this static relationship view.', path, point(file, node).line);
        } else use('call', node.expression, node);
      } else if (ts.isTypeReferenceNode(node)) use('type-reference', node.typeName, node);
      ts.forEachChild(node, visit);
    }; visit(file);
    if (index % 16 === 0) { await new Promise(resolve => setImmediate(resolve)); assertRelationshipsCurrent(isCurrent); }
  }
  for (const edge of result.edges) if (edge.kind === 'test-reference' && edge.to.path === anchorPath) testReferences.add(edge.from.path);
  const stem = posix.basename(anchorPath).replace(/\.[^.]+$/, '').replace(/\.(?:test|spec)$/, '').toLowerCase();
  for (const path of [...byPath.keys()].sort()) {
    if (path === anchorPath || !TEST.test(path) || testReferences.has(path)) continue;
    const testStem = posix.basename(path).replace(/\.[^.]+$/, '').replace(/\.(?:test|spec)$/, '').toLowerCase();
    if (testStem === stem && stem) push('candidates', { path, reason: 'test-name', provenance: 'filename' });
  }
  if (result.truncated && !result.boundaries.some(item => item.kind === 'limit')) {
    if (result.boundaries.length >= LIMITS.boundaries) result.boundaries.pop();
    boundary('limit', 'This focused view reached a result limit. Choose another source file to inspect additional relationships.');
  }
  assertRelationshipsCurrent(isCurrent);
  return result;
}
