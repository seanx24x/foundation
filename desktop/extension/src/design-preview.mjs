import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import { validSourcePath, escapeHtml } from './safety.mjs';

const MAX_FILES = 100;
const MAX_BYTES = 512 * 1024;
const PACKAGES = new Set(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime']);
const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'];
const safeScript = value => value.replace(/<\/script/gi, '<\\/script');
const safeStyle = value => value.replace(/<\/style/gi, '<\\/style');

function diagnosticText(diagnostic, filename) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  const line = diagnostic.file && diagnostic.start !== undefined
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
    : 1;
  return `${filename}:${line} — ${message}`;
}

/** Compile saved client source only. No project code executes in this process. */
export function buildDesignPreview({ files, entry = 'src/App.tsx', nonce, runtimeSource, session }) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES)
    throw new Error('The design sandbox supports between 1 and 100 saved source files.');
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9+/_=-]{6,128}$/.test(nonce))
    throw new Error('The preview needs a valid content-security nonce.');
  if (typeof session !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(session))
    throw new Error('The preview needs a valid session identifier.');
  if (typeof runtimeSource !== 'string' || !runtimeSource.trim() || Buffer.byteLength(runtimeSource) > 2 * 1024 * 1024)
    throw new Error('The bundled React preview runtime is unavailable. Rebuild the Foundation extension.');

  const inventory = new Map();
  let bytes = 0;
  for (const file of files) {
    if (!file || !validSourcePath(file.path) || typeof file.source !== 'string' || file.source.includes('\0') || typeof file.revision !== 'string' || file.revision.length > 128)
      throw new Error('Preview input must contain saved UTF-8 source files with revisions.');
    if (inventory.has(file.path)) throw new Error(`Duplicate preview source: ${file.path}.`);
    bytes += Buffer.byteLength(file.source);
    if (bytes > MAX_BYTES) throw new Error('The design sandbox source limit is 512 KiB. Choose a smaller client entry.');
    inventory.set(file.path, file);
  }
  if (!validSourcePath(entry) || !inventory.has(entry))
    throw new Error(`Choose a saved React entry component, such as src/App.tsx. ${entry} is unavailable.`);

  function resolve(specifier, importer) {
    if (PACKAGES.has(specifier)) return specifier;
    if (!specifier.startsWith('.'))
      throw new Error(`${importer} imports ${specifier}. This sandbox currently supports React and local source only; use the project's running target for other packages.`);
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
    if (!validSourcePath(base)) throw new Error(`${importer} imports a path outside this project.`);
    const options = [base, ...SOURCE_EXTENSIONS.map(ext => `${base}${ext}`), ...SOURCE_EXTENSIONS.map(ext => `${base}/index${ext}`)];
    const found = options.find(candidate => inventory.has(candidate));
    if (!found) throw new Error(`${importer}: cannot resolve ${specifier} from the supplied saved source.`);
    return found;
  }

  const modules = new Map();
  const dependencies = new Map();
  const css = [];
  const consumed = [];
  const visiting = new Set();
  function visit(filename) {
    if (modules.has(filename) || visiting.has(filename)) return;
    const file = inventory.get(filename);
    if (!file) throw new Error(`Preview source is missing: ${filename}.`);
    visiting.add(filename);
    consumed.push({ path: file.path, revision: file.revision });
    const extension = path.posix.extname(filename).toLowerCase();
    if (extension === '.css') {
      if (filename.endsWith('.module.css') || /@import\b/i.test(file.source))
        throw new Error(`${filename}: CSS modules and CSS @import need the project's build pipeline. Plain imported CSS is supported.`);
      css.push(file.source);
      modules.set(filename, 'module.exports = {};');
      dependencies.set(filename, {});
      visiting.delete(filename);
      return;
    }
    if (extension === '.json') {
      let value;
      try { value = JSON.parse(file.source); } catch { throw new Error(`${filename}: invalid JSON.`); }
      modules.set(filename, `module.exports = ${JSON.stringify(value)};`);
      dependencies.set(filename, {});
      visiting.delete(filename);
      return;
    }
    if (!SOURCE_EXTENSIONS.includes(extension))
      throw new Error(`${filename}: this asset type is not supported by the React sandbox.`);
    const source = ts.createSourceFile(filename, file.source, ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length) throw new Error(diagnosticText(source.parseDiagnostics[0], filename));
    const imports = new Set();
    function scan(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        if (!(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) && !node.isTypeOnly)
          imports.add(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        throw new Error(`${filename}: dynamic imports need the project's build pipeline.`);
      } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0]))
          throw new Error(`${filename}: dynamic require is unavailable in the design sandbox.`);
        imports.add(node.arguments[0].text);
      } else if (ts.isImportEqualsDeclaration(node)) {
        if (!ts.isExternalModuleReference(node.moduleReference) || !node.moduleReference.expression || !ts.isStringLiteral(node.moduleReference.expression))
          throw new Error(`${filename}: this import form is unavailable in the design sandbox.`);
        imports.add(node.moduleReference.expression.text);
      } else if (ts.isMetaProperty(node)) {
        throw new Error(`${filename}: import.meta needs the project's build pipeline.`);
      }
      ts.forEachChild(node, scan);
    }
    scan(source);
    const mapping = Object.create(null);
    for (const specifier of imports) {
      const resolved = resolve(specifier, filename);
      mapping[specifier] = resolved;
      if (!PACKAGES.has(resolved)) visit(resolved);
    }
    const output = ts.transpileModule(file.source, {
      fileName: filename,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, isolatedModules: true, sourceMap: false },
    });
    const failed = output.diagnostics?.find(item => item.category === ts.DiagnosticCategory.Error);
    if (failed) throw new Error(diagnosticText(failed, filename));
    mapping['react/jsx-runtime'] = 'react/jsx-runtime';
    dependencies.set(filename, mapping);
    modules.set(filename, output.outputText);
    visiting.delete(filename);
  }
  visit(entry);
  const revision = createHash('sha256').update(JSON.stringify(consumed)).digest('hex').slice(0, 16);
  const mappings = consumed.filter(file => SOURCE_EXTENSIONS.includes(path.posix.extname(file.path))).map(file => file.path);
  const config = { session, entry, revision, mappings, nonce };
  const registry = [...modules].map(([filename, code]) => `${JSON.stringify(filename)}: function(module, exports, require) {\n${code}\n}`).join(',\n');
  const application = `(() => {
    'use strict';
    const runtime = window.FoundationPreviewRuntime;
    const modules = {${registry}};
    const dependencies = ${JSON.stringify(Object.fromEntries(dependencies))};
    const cache = Object.create(null);
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    function load(id) {
      if (own(runtime.packages, id)) return runtime.packages[id];
      if (own(cache, id)) return cache[id].exports;
      if (!own(modules, id)) throw new Error('Unsupported preview dependency: ' + id);
      const module = { exports: {} };
      cache[id] = module;
      modules[id](module, module.exports, specifier => {
        const target = dependencies[id];
        if (!own(target, specifier)) throw new Error('Undeclared preview dependency: ' + specifier);
        return load(target[specifier]);
      });
      return module.exports;
    }
    runtime.start(${JSON.stringify(config)}, () => load(${JSON.stringify(entry)}));
  })();`;
  const html = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${escapeHtml(nonce)}'; style-src 'nonce-${escapeHtml(nonce)}'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';"><title>Foundation sandbox preview</title><style nonce="${escapeHtml(nonce)}">html,body{margin:0;min-height:100%;}body{font-family:system-ui,sans-serif;}#foundation-runtime-error{padding:24px;white-space:pre-wrap;color:#b44747;} ${safeStyle(css.join('\n'))}</style></head><body><div id="root"></div><script nonce="${escapeHtml(nonce)}">${safeScript(runtimeSource)}</script><script nonce="${escapeHtml(nonce)}">${safeScript(application)}</script></body></html>`;
  return { html, revision, entry, mappings, files: consumed, capabilities: { network: false, sourceMapping: 'explicit' } };
}
