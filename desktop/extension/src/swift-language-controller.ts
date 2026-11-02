import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isXcodeSourceInput, type XcodeCatalog } from "./xcode-project.mjs";
import { prepareXcodeLanguageSettings, createXcodeCompilationDatabase, disposeXcodeCompilationDatabase,
  readXcodeLanguageConfigurationFingerprint, validateXcodeLanguageConfiguration,
  type XcodeLanguageConfiguration } from "./xcode-language-settings.mjs";
import { createSwiftLanguageClient } from "./swift-language-client.mjs";

type Client = ReturnType<typeof createSwiftLanguageClient>;
type Phase = "disconnected" | "preparing" | "choosing" | "connecting" | "connected" | "stopping" | "stale" | "failed";
type Context = { root: string; catalog: XcodeCatalog; destinationId: string };
type Entry = { document: vscode.TextDocument; version: number; timer?: ReturnType<typeof setTimeout>; diagnosticVersion?: number; diagnosticCount: number; diagnosticState: "unverified" | "checking" | "current" | "unavailable"; diagnosticReason?: string };
type Session = { epoch: number; key: string; context: Context; configuration: XcodeLanguageConfiguration; client: Client; documents: Map<string, Entry>; watchers: vscode.Disposable[] };
const canonical = (path: string) => { try { return realpathSync.native(path); } catch { return resolve(path); } };
const object = (value: unknown): Record<string, any> | undefined => value && typeof value === "object" ? value as Record<string, any> : undefined;
const position = (value: any) => value && Number.isSafeInteger(value.line) && value.line >= 0 && Number.isSafeInteger(value.character) && value.character >= 0 ? new vscode.Position(value.line, value.character) : undefined;
const range = (value: any) => { const start = position(value?.start), end = position(value?.end); return start && end && !end.isBefore(start) ? new vscode.Range(start, end) : undefined; };

/** Local Swift language services for one explicitly prepared Xcode target. Never starts on open/restart. */
export class SwiftLanguageController implements vscode.Disposable {
  private phase: Phase = "disconnected";
  private reason: string | undefined;
  private key = randomUUID();
  private session: Session | undefined;
  private preparation: { key: string; abort: AbortController; context: Context; watchers: vscode.Disposable[] } | undefined;
  private preparationTask: Promise<void> | undefined;
  private cleanupTask: Promise<void> | undefined;
  private lastBuild: unknown;
  private disposed = false;
  private subscriptions: vscode.Disposable[] = [];
  private diagnostics = vscode.languages.createDiagnosticCollection("Foundation Swift");
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this.changed.event;
  private status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 18);
  private counts = { completions: 0, definitions: 0, hovers: 0, diagnosticUpdates: 0, discardedResults: 0 };

  constructor(private options: {
    prepare?: typeof prepareXcodeLanguageSettings;
    createConfiguration?: typeof createXcodeCompilationDatabase;
    disposeConfiguration?: typeof disposeXcodeCompilationDatabase;
    validateConfiguration?: typeof validateXcodeLanguageConfiguration;
    readConfigurationFingerprint?: typeof readXcodeLanguageConfigurationFingerprint;
    createClient?: typeof createSwiftLanguageClient;
  } = {}) {
    this.status.name = "Foundation Swift"; this.status.command = "foundation.xcodeProject";
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => { if (this.session || this.preparation) void this.stop("Workspace folders changed. Reconnect Swift for the selected project.", "stale"); }),
      vscode.workspace.onDidOpenTextDocument(document => this.syncDocument(document)),
      vscode.workspace.onDidChangeTextDocument(event => this.documentChanged(event.document)),
      vscode.workspace.onDidCloseTextDocument(document => this.closeDocument(document)),
      vscode.workspace.onDidSaveTextDocument(document => { const session = this.session; if (session && this.member(session, document)) this.queueDiagnostics(session, document); }),
      vscode.languages.registerCompletionItemProvider({ language: "swift", scheme: "file" }, {
        provideCompletionItems: (document, location, token) => this.completion(document, location, token),
      }, "."),
      vscode.languages.registerDefinitionProvider({ language: "swift", scheme: "file" }, {
        provideDefinition: (document, location, token) => this.definition(document, location, token),
      }),
      vscode.languages.registerHoverProvider({ language: "swift", scheme: "file" }, {
        provideHover: (document, location, token) => this.hover(document, location, token),
      }),
    );
  }

  inspect() {
    const session = this.session;
    return { phase: this.phase, reason: this.reason, generation: this.key, busy: !!this.preparation || !!this.cleanupTask,
      root: session?.context.root || this.preparation?.context.root,
      target: session ? { id: session.configuration.target.id, name: session.configuration.target.name, architecture: session.configuration.target.architecture, moduleName: session.configuration.target.moduleName } : undefined,
      settingsFingerprint: session?.configuration.settingsFingerprint,
      configurationFingerprint: session?.configuration.configurationFingerprint,
      contextVersion: session?.epoch, build: this.lastBuild, client: session?.client.snapshot(), counters: { ...this.counts },
      documents: session ? [...session.documents].map(([uri, entry]) => ({ uri, version: entry.version, dirty: entry.document.isDirty, diagnosticVersion: entry.diagnosticVersion, diagnosticCount: entry.diagnosticCount, diagnosticState: entry.diagnosticState, diagnosticReason: entry.diagnosticReason })) : [],
    };
  }

  private publish() {
    if (this.disposed) return;
    const target = this.session?.configuration.target;
    this.status.text = this.phase === "connected" ? `$(symbol-method) Swift: ${target?.name}` : ["preparing", "connecting", "choosing", "stopping"].includes(this.phase) ? "$(loading~spin) Swift" : "$(symbol-method) Swift disconnected";
    this.status.tooltip = this.reason || (target ? `${target.name} · ${target.architecture}. Local completion, navigation and diagnostics.` : "Choose an Xcode project and build context to connect Swift.");
    if (this.phase === "disconnected" && !this.reason) this.status.hide(); else this.status.show();
    this.changed.fire();
  }

  private openRoot(root: string) {
    return vscode.workspace.isTrusted && (vscode.workspace.workspaceFolders ?? []).some(folder => folder.uri.scheme === "file" && canonical(folder.uri.fsPath) === canonical(root));
  }

  private within(root: string, uri: vscode.Uri) {
    if (uri.scheme !== "file") return false;
    const path = relative(root, uri.fsPath).replaceAll("\\", "/");
    return isXcodeSourceInput(path);
  }

  private dirty(root: string) { return vscode.workspace.textDocuments.some(doc => doc.isDirty && this.within(root, doc.uri)); }

  async connect(context: Context) {
    if (this.disposed || this.preparation || this.cleanupTask || this.session) return;
    if (!this.openRoot(context.root) || this.dirty(context.root)) {
      this.phase = "stale"; this.reason = "Open and trust this project, then save its files before building the Swift context. Your drafts will not be saved automatically."; this.publish(); return;
    }
    this.key = randomUUID();
    const pending = { key: this.key, context, abort: new AbortController(), watchers: [] as vscode.Disposable[] };
    this.preparation = pending; this.lastBuild = undefined; this.phase = "preparing"; this.reason = "Building the selected scheme to obtain its actual Swift compiler settings…";
    pending.watchers = this.watch(context.root, pending.key); this.publish();
    const task = this.prepareConnection(pending);
    this.preparationTask = task;
    try { await task; } finally { if (this.preparationTask === task) this.preparationTask = undefined; }
  }

  private async prepareConnection(pending: NonNullable<SwiftLanguageController["preparation"]>) {
    let configuration: XcodeLanguageConfiguration | undefined, client: Client | undefined;
    const owns = () => !this.disposed && this.preparation === pending && this.key === pending.key && !pending.abort.signal.aborted && this.openRoot(pending.context.root) && !this.dirty(pending.context.root);
    try {
      const prepared = await (this.options.prepare ?? prepareXcodeLanguageSettings)({ ...pending.context, trusted: true, signal: pending.abort.signal });
      if (!owns()) return;
      this.lastBuild = prepared.build;
      if (prepared.status !== "ready" || !prepared.targets.length) { this.phase = prepared.status === "stale" ? "stale" : "failed"; this.reason = prepared.reason || "Swift compiler settings are unavailable for this project."; return; }
      this.phase = "choosing"; this.reason = "Choose the target whose source you want to edit."; this.publish();
      const cancellation = new vscode.CancellationTokenSource();
      const abort = () => cancellation.cancel(); pending.abort.signal.addEventListener("abort", abort, { once: true });
      let selected;
      try {
        selected = await vscode.window.showQuickPick(prepared.targets.map(target => ({ label: `${target.name} · ${target.architecture}`, description: target.moduleName, target })),
          { title: "Choose Swift target", ignoreFocusOut: true }, cancellation.token);
      } finally { pending.abort.signal.removeEventListener("abort", abort); cancellation.dispose(); }
      if (!owns()) return;
      if (!selected) { this.phase = "disconnected"; this.reason = "Swift target selection cancelled."; return; }
      const created = await (this.options.createConfiguration ?? createXcodeCompilationDatabase)({ preparation: prepared, targetId: selected.target.id, signal: pending.abort.signal });
      configuration = created.configuration;
      if (!owns()) return;
      if (created.status !== "ready" || !configuration) { this.phase = "failed"; this.reason = created.reason || "The Swift build context could not be prepared."; return; }
      const validation = await (this.options.validateConfiguration ?? validateXcodeLanguageConfiguration)(configuration, { signal: pending.abort.signal });
      if (!owns()) return;
      if (validation.status !== "ready") { this.phase = "stale"; this.reason = validation.reason || "Swift build settings changed. Discover and reconnect the project."; return; }
      this.phase = "connecting"; this.reason = "Connecting the selected Xcode toolchain’s Swift language service…"; this.publish();
      const key = pending.key;
      client = (this.options.createClient ?? createSwiftLanguageClient)({
        onDiagnostics: event => this.receiveDiagnostics(key, event),
        onExit: () => { if (this.session?.key === key && this.phase === "connected") void this.stop("The Swift language service stopped. Discover and reconnect to restore editor intelligence.", "failed"); },
        onDiagnosticRefresh: () => { const session = this.session; if (session?.key === key) for (const entry of session.documents.values()) this.queueDiagnostics(session, entry.document); },
      });
      await client.connect({ workspaceRoot: configuration.workspaceRoot, projectRoot: configuration.root,
        compilationDatabasePath: configuration.compilationDatabasePath, sourcePaths: configuration.sourcePaths,
        executable: configuration.target.sourcekitPath, signal: pending.abort.signal });
      if (!owns()) return;
      this.session = { epoch: 0, key, context: pending.context, configuration, client, documents: new Map(), watchers: pending.watchers.splice(0) };
      client = undefined; configuration = undefined;
      this.phase = "connected"; this.reason = undefined;
      for (const document of vscode.workspace.textDocuments) this.syncDocument(document);
    } catch {
      if (owns()) { this.phase = "failed"; this.reason = "Swift could not connect to this build context. Review the build result, then discover and reconnect the project."; }
    } finally {
      if (client) await client.stop().catch(() => {});
      if (configuration) await (this.options.disposeConfiguration ?? disposeXcodeCompilationDatabase)(configuration).catch(() => {});
      for (const watcher of pending.watchers.splice(0)) watcher.dispose();
      if (this.preparation === pending) {
        this.preparation = undefined;
        if (pending.abort.signal.aborted && ["preparing", "choosing", "connecting"].includes(this.phase)) { this.phase = "stale"; this.reason = "Swift preparation was interrupted. Discover and reconnect when ready."; }
      }
      this.publish();
    }
  }

  private watch(root: string, key: string) {
    const watchers: vscode.Disposable[] = [];
    for (let depth = 0; depth <= 16; depth++) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), "*/".repeat(depth) + "*"));
      const changed = (uri: vscode.Uri, kind: string) => {
        if (this.key !== key || !this.within(root, uri)) return;
        if (this.preparation?.key === key) { void this.stop("Project files changed while preparing Swift. Discover and reconnect.", "stale"); return; }
        const session = this.session;
        if (!session || session.key !== key) return;
        if (kind === "change" && uri.fsPath.endsWith(".swift")) {
          if (session.configuration.sourcePaths.some(path => canonical(path) === canonical(uri.fsPath))) {
            try { session.client.invalidateContext(uri.toString()); this.refreshTargetDiagnostics(session); } catch { void this.stop("Swift source context could not be refreshed. Reconnect the target.", "failed"); }
          }
        }
        void this.checkConfiguration(session);
      };
      watchers.push(watcher, watcher.onDidChange(uri => changed(uri, "change")), watcher.onDidCreate(uri => changed(uri, "create")), watcher.onDidDelete(uri => changed(uri, "delete")));
    }
    return watchers;
  }

  private async checkConfiguration(session: Session) {
    const fingerprint = await (this.options.readConfigurationFingerprint ?? readXcodeLanguageConfigurationFingerprint)(session.context.root).catch(() => null);
    if (this.session !== session) return;
    if (!fingerprint || fingerprint !== session.configuration.configurationFingerprint) await this.stop("Project settings or source membership changed. Discover and reconnect Swift.", "stale");
  }

  private member(session: Session, document: vscode.TextDocument) {
    return document.uri.scheme === "file" && document.languageId === "swift" && session.configuration.sourcePaths.some(path => canonical(path) === canonical(document.uri.fsPath));
  }

  private syncDocument(document: vscode.TextDocument) {
    const session = this.session;
    if (!session || this.phase !== "connected" || !this.openRoot(session.context.root) || !this.member(session, document)) return;
    const uri = document.uri.toString(), entry = session.documents.get(uri);
    try {
      let changed = false;
      if (!entry) { changed = true; session.client.openDocument({ uri, text: document.getText(), version: document.version }); session.documents.set(uri, { document, version: document.version, diagnosticCount: 0, diagnosticState: "unverified" }); }
      else if (entry.version !== document.version) {
        changed = true;
        session.client.changeDocument({ uri, text: document.getText(), version: document.version });
        entry.version = document.version; entry.document = document; entry.diagnosticVersion = undefined; entry.diagnosticCount = 0; entry.diagnosticState = "unverified"; entry.diagnosticReason = undefined;
        this.diagnostics.delete(document.uri);
      }
      if (changed) this.refreshTargetDiagnostics(session, uri);
    } catch { void this.stop("Swift could not synchronize this document. Reconnect the selected target.", "failed"); }
  }

  private documentChanged(document: vscode.TextDocument) {
    if (this.preparation && this.within(this.preparation.context.root, document.uri)) {
      void this.stop("Project files changed while preparing Swift. Save your changes, then reconnect.", "stale"); return;
    }
    const session = this.session;
    if (!session) return;
    if (!this.openRoot(session.context.root)) { void this.stop("The trusted project is no longer available.", "stale"); return; }
    if (this.within(session.context.root, document.uri) && !document.uri.fsPath.endsWith(".swift")) {
      void this.stop("Project configuration was edited. Save it, discover the project and reconnect Swift.", "stale"); return;
    }
    this.syncDocument(document);
  }

  private closeDocument(document: vscode.TextDocument) {
    const session = this.session, uri = document.uri.toString(), entry = session?.documents.get(uri);
    if (!session || !entry) return;
    clearTimeout(entry.timer);
    try { session.client.closeDocument(uri); } catch { void this.stop("Swift could not close this document. Reconnect the target.", "failed"); return; }
    session.documents.delete(uri); this.diagnostics.delete(document.uri); this.refreshTargetDiagnostics(session); this.publish();
  }

  private refreshTargetDiagnostics(session: Session, changedUri?: string) {
    session.epoch++;
    // SourceKit caches a consumer's semantic state across dependency changes.
    // Reopen its protocol document with the exact current buffer/version to refresh
    // that state without editing, saving, or moving the native editor.
    try {
      for (const [uri, entry] of session.documents) {
        if (uri === changedUri) continue;
        session.client.closeDocument(uri);
        session.client.openDocument({ uri, text: entry.document.getText(), version: entry.document.version });
      }
    } catch { void this.stop("Swift could not refresh dependent source. Reconnect the selected target.", "failed"); return; }
    for (const entry of session.documents.values()) {
      clearTimeout(entry.timer); entry.diagnosticVersion = undefined; entry.diagnosticCount = 0;
      entry.diagnosticState = "unverified"; entry.diagnosticReason = undefined; this.diagnostics.delete(entry.document.uri);
      this.queueDiagnostics(session, entry.document);
    }
  }

  private queueDiagnostics(session: Session, document: vscode.TextDocument) {
    const entry = session.documents.get(document.uri.toString());
    if (!entry || this.session !== session) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (this.session !== session || entry.version !== document.version || this.phase !== "connected") return;
      const version = entry.version, epoch = session.epoch;
      entry.diagnosticState = "checking"; entry.diagnosticReason = undefined;
      void session.client.request("textDocument/diagnostic", { textDocument: { uri: document.uri.toString() } }, { timeoutMs: 15000 }).catch(() => {
        if (this.session !== session || session.epoch !== epoch || entry.version !== version || document.version !== version) return;
        entry.diagnosticState = "unavailable"; entry.diagnosticReason = "Swift diagnostics could not be refreshed. Edit again or reconnect the selected target."; this.publish();
      });
    }, 180);
  }

  private receiveDiagnostics(key: string, event: { uri: string; version: number; diagnostics: unknown[]; sessionId: string; contextVersion: number }) {
    const session = this.session;
    if (!session || session.key !== key || this.phase !== "connected" || !this.openRoot(session.context.root)) return;
    let documentPath: string;
    try { documentPath = canonical(fileURLToPath(event.uri)); } catch { return; }
    const entry = [...session.documents.values()].find(item => canonical(item.document.uri.fsPath) === documentPath);
    if (!entry || entry.version !== event.version || entry.document.version !== event.version || event.sessionId !== session.client.snapshot().sessionId || event.contextVersion !== session.client.snapshot().contextVersion) { this.counts.discardedResults++; return; }
    const diagnostics: vscode.Diagnostic[] = [];
    for (const value of event.diagnostics.slice(0, 300)) {
      const item = object(value), location = range(item?.range);
      if (!item || !location || typeof item.message !== "string" || !entry.document.validateRange(location).isEqual(location)) continue;
      const diagnostic = new vscode.Diagnostic(location, item.message.slice(0, 8192), [vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning, vscode.DiagnosticSeverity.Information, vscode.DiagnosticSeverity.Hint][Math.max(0, Math.min(3, (item.severity || 1) - 1))]);
      diagnostic.source = "Foundation Swift"; if (typeof item.code === "string" || typeof item.code === "number") diagnostic.code = item.code;
      diagnostics.push(diagnostic);
    }
    entry.diagnosticVersion = event.version; entry.diagnosticCount = diagnostics.length; entry.diagnosticState = "current"; entry.diagnosticReason = undefined;
    this.diagnostics.set(entry.document.uri, diagnostics); this.counts.diagnosticUpdates++; this.publish();
  }

  private async request(document: vscode.TextDocument, location: vscode.Position, token: vscode.CancellationToken, method: Parameters<Client["request"]>[0]) {
    const session = this.session;
    if (!session || this.phase !== "connected" || !this.openRoot(session.context.root) || !this.member(session, document) || token.isCancellationRequested) return;
    this.syncDocument(document); const version = document.version, epoch = session.epoch;
    const abort = new AbortController(), cancelled = token.onCancellationRequested(() => abort.abort());
    try {
      const result = await session.client.request(method, { textDocument: { uri: document.uri.toString() }, position: { line: location.line, character: location.character } }, { signal: abort.signal, timeoutMs: 12000 });
      if (this.session !== session || session.key !== this.key || session.epoch !== epoch || document.version !== version || token.isCancellationRequested || !this.openRoot(session.context.root)) { this.counts.discardedResults++; return; }
      return result;
    } catch { return; } finally { cancelled.dispose(); }
  }

  private async completion(document: vscode.TextDocument, location: vscode.Position, token: vscode.CancellationToken) {
    const value = await this.request(document, location, token, "textDocument/completion");
    if (!value) return;
    const result = object(value), values: any[] = Array.isArray(value) ? value : Array.isArray(result?.items) ? result.items : [];
    const items: vscode.CompletionItem[] = [];
    for (const source of values.slice(0, 500)) {
      if (!source || typeof source.label !== "string") continue;
      const item = new vscode.CompletionItem(source.label.slice(0, 1024), Number.isInteger(source.kind) && source.kind >= 1 && source.kind <= 25 ? source.kind - 1 : vscode.CompletionItemKind.Text);
      const edit = object(source.textEdit), editRange = range(edit?.range || edit?.replace);
      if (edit && (!editRange || typeof edit.newText !== "string" || editRange.start.line !== editRange.end.line || location.isBefore(editRange.start) || editRange.end.isBefore(location))) continue;
      const text = typeof edit?.newText === "string" ? edit.newText : typeof source.insertText === "string" ? source.insertText : source.label;
      if (text.length > 65536 || editRange && !document.validateRange(editRange).isEqual(editRange)) continue;
      item.insertText = source.insertTextFormat === 2 ? new vscode.SnippetString(text) : text;
      if (editRange) item.range = editRange;
      for (const key of ["detail", "sortText", "filterText"] as const) if (typeof source[key] === "string") item[key] = source[key].slice(0, 4096);
      if (typeof source.documentation === "string") item.documentation = source.documentation.slice(0, 16384);
      else if (typeof source.documentation?.value === "string") item.documentation = source.documentation.value.slice(0, 16384);
      items.push(item);
    }
    this.counts.completions++; this.publish(); return new vscode.CompletionList(items, Boolean(result?.isIncomplete));
  }

  private async definition(document: vscode.TextDocument, location: vscode.Position, token: vscode.CancellationToken) {
    const session = this.session, value = await this.request(document, location, token, "textDocument/definition");
    if (!session || this.session !== session || !value) return;
    const values = Array.isArray(value) ? value : [value], found: vscode.Location[] = [];
    for (const item of values.slice(0, 64)) {
      const result = object(item); if (!result) continue;
      let path: string; try { const uri = new URL(result.uri || result.targetUri); if (uri.protocol !== "file:" || uri.host || uri.search || uri.hash) continue; path = canonical(fileURLToPath(uri)); } catch { continue; }
      if (!session.configuration.sourcePaths.some(source => canonical(source) === path)) continue;
      const selection = range(result.targetSelectionRange || result.range); if (!selection) continue;
      found.push(new vscode.Location(vscode.Uri.file(path), selection));
    }
    this.counts.definitions++; this.publish(); return found;
  }

  private async hover(document: vscode.TextDocument, location: vscode.Position, token: vscode.CancellationToken) {
    const value = object(await this.request(document, location, token, "textDocument/hover"));
    if (!value?.contents) return;
    const values = Array.isArray(value.contents) ? value.contents : [value.contents];
    const content = new vscode.MarkdownString(); content.isTrusted = false; content.supportHtml = false;
    for (const value of values.slice(0, 12)) {
      const text = typeof value === "string" ? value : typeof value?.value === "string" ? value.value : "";
      if (typeof value?.language === "string") content.appendCodeblock(text.slice(0, 16384), value.language.slice(0, 32)); else if (value?.kind === "markdown") content.appendMarkdown(text.slice(0, 16384)); else content.appendText(text.slice(0, 16384));
    }
    const locationRange = range(value.range);
    this.counts.hovers++; this.publish(); return new vscode.Hover(content, locationRange && document.validateRange(locationRange).isEqual(locationRange) ? locationRange : undefined);
  }

  async stop(reason = "Swift disconnected. Discover the project to reconnect.", phase: Phase = "disconnected") {
    if (this.cleanupTask) return this.cleanupTask;
    this.key = randomUUID(); this.phase = "stopping"; this.reason = reason;
    this.preparation?.abort.abort();
    const session = this.session; this.session = undefined; this.diagnostics.clear();
    if (session) { for (const entry of session.documents.values()) clearTimeout(entry.timer); for (const watcher of session.watchers) watcher.dispose(); }
    const preparation = this.preparationTask;
    const cleanup = (async () => {
      if (session) {
        await session.client.stop().catch(() => {});
        await (this.options.disposeConfiguration ?? disposeXcodeCompilationDatabase)(session.configuration).catch(() => {});
      }
      if (preparation) await preparation.catch(() => {});
    })();
    this.cleanupTask = cleanup; this.publish();
    try { await cleanup; } finally { if (this.cleanupTask === cleanup) { this.cleanupTask = undefined; this.phase = phase; this.reason = reason; this.publish(); } }
  }

  dispose() {
    if (this.disposed) return;
    void this.stop(); this.disposed = true;
    for (const item of this.subscriptions.splice(0)) item.dispose();
    this.diagnostics.dispose(); this.status.dispose(); this.changed.dispose();
  }
}
