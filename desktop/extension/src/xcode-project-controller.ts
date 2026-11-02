import * as vscode from "vscode";
import type { SwiftLanguageController } from "./swift-language-controller";
import { randomUUID } from "node:crypto";
import { relative, isAbsolute } from "node:path";
import { discoverXcodeProjects, inspectXcodeProject, runXcodeOperation, isXcodeSourceInput,
  type XcodeCatalog, type XcodeOperation, type XcodeDestination } from "./xcode-project.mjs";

type Phase = "idle" | "discovering" | "ready" | "running" | "cancelled" | "stale" | "failed" | "unavailable";
type Folder = { name: string; root: string; uri: vscode.Uri };
type Run = { key: string; abort: AbortController; folder: Folder; action: "discover" | "build" | "test" };

/** Explicit Xcode operations. Opening the view never evaluates or builds a project. */
export class XcodeProjectController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private folder: Folder | undefined;
  private ownerKey = randomUUID();
  private viewId: string | undefined;
  private phase: Phase = "idle";
  private reason: string | undefined;
  private catalog: XcodeCatalog | undefined;
  private destinationId: string | undefined;
  private evidenceStale = false;
  private pickers = new Set<vscode.CancellationTokenSource>();
  private results: { build?: XcodeOperation; test?: XcodeOperation } = {};
  private active: Run | undefined;
  private choosing = false;
  private disposed = false;
  private watchers: vscode.Disposable[] = [];
  private subscriptions: vscode.Disposable[] = [];
  private panelSubscriptions: vscode.Disposable[] = [];

  constructor(private options: {
    extensionUri: vscode.Uri;
    swift?: Pick<SwiftLanguageController, "connect" | "stop" | "inspect" | "onDidChangeState">;
    discover?: typeof discoverXcodeProjects;
    inspectProject?: typeof inspectXcodeProject;
    operate?: typeof runXcodeOperation;
  }) {
    if (options.swift) this.subscriptions.push(options.swift.onDidChangeState(() => this.publish()));
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        if (this.folder && !this.folders().some(folder => folder.root === this.folder!.root)) this.select(undefined);
        this.invalidate("Workspace folders changed. Discover the project again.");
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.invalidate("Workspace trust changed. Discover the project again.")),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (this.isInput(event.document.uri)) this.invalidate("Project files changed. Save your changes, then discover the project again.");
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        if (this.isInput(document.uri)) this.invalidate("Project files changed. Discover the project again.");
      }),
    );
  }

  private folders(): Folder[] {
    return (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === "file")
      .map(folder => ({ name: folder.name, root: folder.uri.fsPath, uri: folder.uri }));
  }

  private isInput(uri: vscode.Uri): boolean {
    if (!this.folder || uri.scheme !== "file") return false;
    const path = relative(this.folder.root, uri.fsPath).replaceAll("\\", "/");
    return path !== ".." && !path.startsWith("../") && !isAbsolute(path) && isXcodeSourceInput(path);
  }

  private dirtyInputs() { return vscode.workspace.textDocuments.some(doc => doc.isDirty && this.isInput(doc.uri)); }

  private owns(run: Run, allowCancelled = false): boolean {
    return !this.disposed && this.active === run && (allowCancelled || !run.abort.signal.aborted) && !!this.panel &&
      this.ownerKey === run.key && this.folder?.root === run.folder.root && vscode.workspace.isTrusted &&
      this.folders().some(folder => folder.root === run.folder.root) && !this.dirtyInputs();
  }

  inspect() {
    return {
      swiftLanguage: this.options.swift?.inspect(),
      phase: this.phase, ownerKey: this.ownerKey, busy: !!this.active || this.choosing, action: this.active?.action,
      project: this.folder ? { name: this.folder.name, root: this.folder.root } : null,
      trusted: vscode.workspace.isTrusted, dirty: this.dirtyInputs(), canChoose: this.folders().length > 1,
      catalog: vscode.workspace.isTrusted ? this.catalog : undefined,
      destinationId: this.destinationId, evidenceStale: this.evidenceStale, results: vscode.workspace.isTrusted ? this.results : {},
      reason: !vscode.workspace.isTrusted ? "Trust this workspace before evaluating or building an Xcode project." : this.reason,
    };
  }

  private publish() {
    if (this.panel && this.viewId) void this.panel.webview.postMessage({ type: "xcodeProjectState", viewId: this.viewId, state: this.inspect() });
  }

  private invalidate(reason: string) {
    this.evidenceStale = true;
    for (const picker of this.pickers) picker.cancel();
    this.active?.abort.abort(); this.ownerKey = randomUUID();
    this.phase = this.catalog || this.active ? "stale" : "idle";
    this.reason = reason; this.publish();
  }

  private select(folder: Folder | undefined) {
    this.evidenceStale = false;
    for (const picker of this.pickers) picker.cancel();
    this.active?.abort.abort(); this.ownerKey = randomUUID();
    for (const item of this.watchers.splice(0)) item.dispose();
    this.folder = folder; this.catalog = undefined; this.destinationId = undefined; this.results = {};
    this.phase = "idle"; this.reason = undefined;
    if (folder) {
      // Finite-depth watches mirror bounded discovery; ignored build output never owns source state.
      for (let depth = 0; depth <= 16; depth++) {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder.uri, "*/".repeat(depth) + "*"));
        const changed = (uri: vscode.Uri) => { if (this.isInput(uri)) this.invalidate("Saved project files changed. Discover the project again."); };
        this.watchers.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
      }
    }
    this.publish();
  }

  private async pick<T extends vscode.QuickPickItem>(items: T[], title: string, signal?: AbortSignal): Promise<T | undefined> {
    if (this.disposed || signal?.aborted) return;
    const cancellation = new vscode.CancellationTokenSource();
    const abort = () => cancellation.cancel();
    this.pickers.add(cancellation); signal?.addEventListener("abort", abort, { once: true });
    try {
      return await vscode.window.showQuickPick(items, { title, ignoreFocusOut: true }, cancellation.token);
    } finally {
      signal?.removeEventListener("abort", abort); this.pickers.delete(cancellation); cancellation.dispose();
    }
  }

  private async chooseFolder() {
    if (this.choosing || this.active || this.disposed) return;
    const folders = this.folders();
    if (folders.length <= 1) { this.select(folders[0]); return; }
    const owner = this.ownerKey, panel = this.panel;
    this.choosing = true; this.publish();
    try {
      const selected = await this.pick(folders.map(folder => ({ label: folder.name, description: folder.root, folder })), "Choose project folder");
      if (!this.disposed && this.ownerKey === owner && this.panel === panel && selected && this.folders().some(folder => folder.root === selected.folder.root)) this.select(selected.folder);
    } finally { this.choosing = false; this.publish(); }
  }

  async open() {
    if (this.disposed) return;
    if (!this.folder) await this.chooseFolder();
    if (this.disposed) return;
    if (this.panel) { this.panel.reveal(undefined, false); return; }
    const media = vscode.Uri.joinPath(this.options.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("foundation.xcodeProject", "Xcode Project", vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] });
    this.panel = panel; this.viewId = undefined;
    const nonce = randomUUID();
    const asset = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, file));
    panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${asset("platform-setup.css")}"><link rel="stylesheet" href="${asset("xcode-project.css")}"><title>Xcode Project</title></head><body><main id="xcode-project-root"></main><script nonce="${nonce}" src="${asset("xcode-project.js")}"></script></body></html>`;
    this.panelSubscriptions.push(panel.onDidDispose(() => {
      if (this.panel !== panel) return;
      this.select(undefined); this.panel = undefined; this.viewId = undefined;
      for (const item of this.panelSubscriptions.splice(0)) item.dispose();
    }), panel.webview.onDidReceiveMessage(message => { if (this.panel === panel) void this.message(message); }));
    this.publish();
  }

  private async pickDestination(catalog: XcodeCatalog, signal?: AbortSignal): Promise<XcodeDestination | undefined> {
    const selected = await this.pick(catalog.destinations.map(destination => ({
      label: destination.label, description: destination.testEligible ? "Build and tests" : "Build only", destination,
    })), "Choose Simulator destination", signal);
    return selected?.destination;
  }

  private async discover(run: Run) {
    const base = { root: run.folder.root, trusted: true, signal: run.abort.signal };
    const found = await (this.options.discover ?? discoverXcodeProjects)(base);
    if (!this.owns(run)) return;
    if (found.root !== run.folder.root) throw new Error("Foreign discovery");
    if (found.status !== "complete" || !found.projects.length) {
      this.phase = found.status === "complete" ? "unavailable" : found.status;
      this.reason = found.reason || "No supported Xcode project was found. Open its containing folder, then discover again."; return;
    }
    const project = await this.pick(found.projects.map(project => ({ label: project.name, description: project.path, project })), "Choose Xcode project", run.abort.signal);
    if (!this.owns(run)) return;
    if (!project) { this.phase = "idle"; this.reason = "Project selection cancelled."; return; }
    const inspect = this.options.inspectProject ?? inspectXcodeProject;
    const list = await inspect({ ...base, projectPath: project.project.path });
    if (!this.owns(run)) return;
    if (list.root !== run.folder.root || list.projectPath !== project.project.path) throw new Error("Foreign catalog");
    if (list.status !== "complete" || !list.schemes.length) {
      this.catalog = list; this.phase = list.status === "complete" ? "unavailable" : list.status; this.reason = list.reason || "No shared schemes were found. Share a scheme in Xcode and discover again."; return;
    }
    const scheme = await this.pick(list.schemes.map(scheme => ({ label: scheme, scheme })), "Choose scheme", run.abort.signal);
    if (!this.owns(run)) return;
    if (!scheme) { this.phase = "idle"; this.reason = "Scheme selection cancelled."; return; }
    const catalog = await inspect({ ...base, projectPath: project.project.path, scheme: scheme.scheme });
    if (!this.owns(run)) return;
    if (catalog.root !== run.folder.root || catalog.projectPath !== project.project.path || catalog.selectedScheme !== scheme.scheme) throw new Error("Foreign catalog");
    if (catalog.status !== "complete" || !catalog.destinations.length) {
      this.catalog = catalog; this.phase = catalog.status === "complete" ? "unavailable" : catalog.status; this.reason = catalog.reason || "No supported Simulator destination is available. Check the project’s deployment target and installed Xcode runtimes."; return;
    }
    const destination = await this.pickDestination(catalog, run.abort.signal);
    if (!this.owns(run)) return;
    if (!destination) { this.phase = "idle"; this.reason = "Destination selection cancelled."; return; }
    this.catalog = catalog; this.destinationId = destination.id; this.evidenceStale = false; this.results = {}; this.phase = "ready"; this.reason = undefined;
  }

  private async message(message: unknown) {
    if (this.disposed || !this.panel || !message || typeof message !== "object") return;
    const data = message as Record<string, unknown>;
    if (data.type === "ready" && typeof data.viewId === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(data.viewId)) {
      if (this.viewId && this.viewId !== data.viewId) {
        this.invalidate("Xcode Project reloaded. Discover the project again."); this.catalog = undefined; this.results = {};
      }
      this.viewId = data.viewId; this.publish(); return;
    }
    if (data.type !== "xcodeProject" || data.viewId !== this.viewId || data.ownerKey !== this.ownerKey) return;
    if (data.action === "cancel") {
      if (this.active) { this.active.abort.abort(); this.phase = "cancelled"; this.reason = "Cancelling the owned Xcode process…"; this.publish(); }
      return;
    }
    if (data.action === "swiftStop") { await this.options.swift?.stop(); return; }
    const swift = this.options.swift?.inspect();
    if (this.active || this.choosing || swift?.busy) return;
    if (swift?.phase === "connected" && ["choose", "discover", "destination", "swiftConnect"].includes(String(data.action))) return;
    if (data.action === "choose") { await this.chooseFolder(); return; }
    if (!["discover", "destination", "build", "test", "swiftConnect"].includes(String(data.action))) return;
    const folder = this.folder;
    if (!folder || !this.folders().some(item => item.root === folder.root)) { this.reason = "Open a local project folder first."; this.publish(); return; }
    if (!vscode.workspace.isTrusted) { this.phase = "unavailable"; this.publish(); return; }
    if (this.dirtyInputs()) { this.evidenceStale = true; this.phase = "stale"; this.reason = "Save or revert project changes before continuing. Foundation will not save your drafts."; this.publish(); return; }
    if (data.action === "swiftConnect") {
      const catalog = this.catalog;
      if (this.phase === "ready" && catalog?.destinations.some(item => item.id === this.destinationId)) {
        await this.options.swift?.connect({ root: folder.root, catalog, destinationId: this.destinationId! });
      }
      return;
    }
    if (data.action === "destination") {
      if (!this.catalog || this.phase !== "ready") return;
      const owner = this.ownerKey, catalog = this.catalog; this.choosing = true; this.publish();
      try {
        const destination = await this.pickDestination(catalog);
        if (!this.disposed && this.panel && owner === this.ownerKey && destination) {
          this.destinationId = destination.id; this.ownerKey = randomUUID(); this.results = {}; this.reason = undefined;
        }
      } finally { this.choosing = false; this.publish(); }
      return;
    }
    const action = data.action as Run["action"];
    const catalog = this.catalog, destination = catalog?.destinations.find(item => item.id === this.destinationId);
    if (action !== "discover" && (!catalog || this.phase !== "ready" || !destination || (action === "test" && !destination.testEligible))) return;
    this.ownerKey = randomUUID();
    const run: Run = { key: this.ownerKey, folder, abort: new AbortController(), action };
    this.active = run; this.phase = action === "discover" ? "discovering" : "running"; this.reason = undefined;
    if (action === "discover") { this.catalog = undefined; this.destinationId = undefined; this.results = {}; }
    this.publish();
    try {
      if (action === "discover") await this.discover(run);
      else {
        const result = await (this.options.operate ?? runXcodeOperation)({ root: folder.root, trusted: true, catalog: catalog!, destinationId: destination!.id, action, signal: run.abort.signal });
        if (!this.owns(run, true)) return;
        if (result.root !== folder.root || result.projectPath !== catalog!.projectPath || result.scheme !== catalog!.selectedScheme || result.action !== action || result.destination?.id !== destination!.id) throw new Error("Foreign operation result");
        // A user-cancelled operation may retain its cancellation evidence, never a late success.
        if (run.abort.signal.aborted && result.status !== "cancelled") return;
        this.results[action] = result;
        if (!result.sourceCurrent) this.evidenceStale = true;
        this.phase = result.sourceCurrent ? "ready" : "stale";
        this.reason = result.status === "passed" ? undefined : result.recovery || result.reason || "The operation did not pass. Review its output before retrying.";
      }
    } catch {
      if (this.owns(run)) { this.phase = "failed"; this.reason = "Xcode could not complete this request. Discover the project again and review the selected tools and target."; }
    } finally {
      if (this.active === run) {
        if (this.phase === "discovering" || this.phase === "running") {
          this.phase = "stale"; this.reason = "The project changed during this operation. Discover it again.";
        } else if ((this.phase as Phase) === "cancelled") this.reason = "Operation cancelled. Discover again when you’re ready.";
        this.active = undefined; this.publish();
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const picker of this.pickers) picker.cancel();
    this.active?.abort.abort(); this.ownerKey = randomUUID();
    for (const item of [...this.watchers.splice(0), ...this.subscriptions.splice(0), ...this.panelSubscriptions.splice(0)]) item.dispose();
    this.panel?.dispose(); this.panel = undefined;
  }
}
