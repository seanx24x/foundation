import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { relative, isAbsolute } from "node:path";
import { inspectPlatformReadiness, isPlatformReadinessInput } from "./platform-readiness.mjs";

type Report = Awaited<ReturnType<typeof inspectPlatformReadiness>>;
type Phase = "idle" | "checking" | "cancelled" | "stale" | "complete" | "unavailable" | "failed";
type Folder = { name: string; root: string; uri: vscode.Uri };
type Run = { key: string; abort: AbortController; folder: Folder };

/** Explicit, read-only setup checks. Independent of indexing, AI, and runtime ownership. */
export class PlatformSetupController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private folder: Folder | undefined;
  private ownerKey = randomUUID();
  private viewId: string | undefined;
  private phase: Phase = "idle";
  private reason: string | undefined;
  private report: Report | undefined;
  private active: Run | undefined;
  private watchers: vscode.Disposable[] = [];
  private subscriptions: vscode.Disposable[] = [];
  private panelSubscriptions: vscode.Disposable[] = [];
  private disposed = false;
  private choosing = false;

  constructor(private options: {
    extensionUri: vscode.Uri;
    inspect?: typeof inspectPlatformReadiness;
  }) {
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.workspaceChanged()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.invalidate("Workspace trust changed. Check setup again.")),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (this.isInput(event.document.uri)) this.invalidate("Project setup files changed. Save your changes, then check setup again.");
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        if (this.isInput(document.uri)) this.invalidate("Project setup files changed. Check setup again.");
      }),
    );
  }

  private folders(): Folder[] {
    return (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === "file")
      .map(folder => ({ name: folder.name, root: folder.uri.fsPath, uri: folder.uri }));
  }

  private contains(uri: vscode.Uri): boolean {
    if (!this.folder || uri.scheme !== "file") return false;
    const path = relative(this.folder.root, uri.fsPath);
    return path === "" || (!path.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) && path !== ".." && !isAbsolute(path));
  }

  private isInput(uri: vscode.Uri): boolean {
    return this.contains(uri) && isPlatformReadinessInput(relative(this.folder!.root, uri.fsPath).replaceAll("\\", "/"));
  }

  private dirtyInputs(): boolean {
    return vscode.workspace.textDocuments.some(document => document.isDirty && this.isInput(document.uri));
  }

  private owns(run: Run): boolean {
    return !this.disposed && this.active === run && !run.abort.signal.aborted && !!this.panel &&
      run.key === this.ownerKey && this.folder?.root === run.folder.root && vscode.workspace.isTrusted &&
      this.folders().some(folder => folder.root === run.folder.root) && !this.dirtyInputs();
  }

  inspect() {
    return {
      phase: this.phase, ownerKey: this.ownerKey, busy: !!this.active,
      project: this.folder ? { name: this.folder.name, root: this.folder.root } : null,
      trusted: vscode.workspace.isTrusted, report: vscode.workspace.isTrusted ? this.report : undefined,
      reason: !vscode.workspace.isTrusted ? "Trust this workspace before checking local project files and tools." : this.reason,
      dirty: this.dirtyInputs(), canChoose: this.folders().length > 1,
    };
  }

  private publish() {
    if (this.panel && this.viewId) void this.panel.webview.postMessage({ type: "platformSetupState", viewId: this.viewId, state: this.inspect() });
  }

  private invalidate(reason: string) {
    this.active?.abort.abort();
    this.ownerKey = randomUUID();
    this.phase = this.report || this.active ? "stale" : "idle";
    this.reason = reason;
    this.publish();
  }

  private workspaceChanged() {
    if (this.folder && !this.folders().some(folder => folder.root === this.folder!.root)) {
      this.select(undefined);
      this.reason = "The selected folder is no longer open. Choose a project folder.";
    } else this.invalidate("Workspace folders changed. Check setup again.");
    this.publish();
  }

  private select(folder: Folder | undefined) {
    this.active?.abort.abort();
    this.ownerKey = randomUUID();
    for (const watcher of this.watchers.splice(0)) watcher.dispose();
    this.folder = folder; this.report = undefined; this.reason = undefined; this.phase = "idle";
    if (folder) {
      // Match the probe's bounded metadata scan. Never recursively watch arbitrary source or dependencies.
      const names = ["package.json", "app.json", "app.config.{js,ts,mjs,cjs}", "*.swift", "*.xcodeproj", "*.xcworkspace", "*.xcodeproj/project.pbxproj", "*.xcworkspace/contents.xcworkspacedata"];
      const patterns = Array.from({ length: 5 }, (_, depth) => "*/".repeat(depth) + "{" + names.join(",") + "}");
      patterns.push(...Array.from({ length: 5 }, (_, depth) => "*/".repeat(depth) + "node_modules/{expo,react-native,vite}/package.json"));
      for (const pattern of patterns) {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder.uri, pattern));
        this.watchers.push(watcher,
          watcher.onDidChange(uri => { if (this.isInput(uri)) this.invalidate("Project setup files changed. Check setup again."); }),
          watcher.onDidCreate(uri => { if (this.isInput(uri)) this.invalidate("Project setup files changed. Check setup again."); }),
          watcher.onDidDelete(uri => { if (this.isInput(uri)) this.invalidate("Project setup files changed. Check setup again."); }),
        );
      }
    }
    this.publish();
  }

  private async choose() {
    if (this.choosing || this.disposed) return;
    const folders = this.folders();
    if (folders.length <= 1) { this.select(folders[0]); return; }
    this.choosing = true;
    try {
      const choice = await vscode.window.showQuickPick(folders.map(folder => ({ label: folder.name, description: folder.root, folder })),
        { title: "Project Setup", placeHolder: "Choose a folder to check", ignoreFocusOut: true });
      if (!this.disposed && choice && this.folders().some(folder => folder.root === choice.folder.root)) this.select(choice.folder);
    } finally { this.choosing = false; }
  }

  async open() {
    if (this.disposed) return;
    if (!this.folder) await this.choose();
    if (this.disposed) return;
    if (!this.panel) {
      const media = vscode.Uri.joinPath(this.options.extensionUri, "media");
      const panel = vscode.window.createWebviewPanel("foundation.projectSetup", "Project Setup", vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] });
      this.panel = panel; this.viewId = undefined;
      const nonce = randomUUID();
      const css = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "platform-setup.css"));
      const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "platform-setup.js"));
      panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"><title>Project Setup</title></head><body><main id="platform-setup-root"></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
      this.panelSubscriptions.push(panel.onDidDispose(() => {
        if (this.panel !== panel) return;
        this.active?.abort.abort(); this.ownerKey = randomUUID(); this.panel = undefined; this.viewId = undefined;
        this.folder = undefined; this.report = undefined; this.phase = "idle"; this.reason = undefined;
        for (const watcher of this.watchers.splice(0)) watcher.dispose();
        for (const subscription of this.panelSubscriptions.splice(0)) subscription.dispose();
      }), panel.webview.onDidReceiveMessage(message => { if (this.panel === panel) void this.message(message); }));
    } else this.panel.reveal(undefined, false);
    this.publish();
  }

  private async message(message: unknown) {
    if (this.disposed || !this.panel || !message || typeof message !== "object") return;
    const data = message as Record<string, unknown>;
    if (data.type === "ready" && typeof data.viewId === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(data.viewId)) {
      if (this.viewId && this.viewId !== data.viewId) {
        this.invalidate("Project Setup reloaded. Check setup again.");
        this.report = undefined;
      }
      this.viewId = data.viewId; this.publish(); return;
    }
    if (data.type !== "platformSetup" || data.viewId !== this.viewId || data.ownerKey !== this.ownerKey) return;
    if (data.action === "choose") { await this.choose(); return; }
    if (data.action === "cancel") {
      if (this.active) { this.active.abort.abort(); this.phase = "cancelled"; this.reason = "Setup check cancelled. Run it again when you’re ready."; this.publish(); }
      return;
    }
    if (data.action !== "check" || this.active) return;
    const folder = this.folder;
    if (!folder || !this.folders().some(item => item.root === folder.root)) { this.reason = "Open a local project folder, then choose it here."; this.publish(); return; }
    if (!vscode.workspace.isTrusted) { this.phase = "unavailable"; this.publish(); return; }
    if (this.dirtyInputs()) { this.phase = "stale"; this.reason = "Save or revert unsaved project setup files before checking. Foundation will not change your drafts."; this.publish(); return; }
    const run: Run = { key: this.ownerKey, folder, abort: new AbortController() };
    this.active = run; this.phase = "checking"; this.reason = undefined; this.report = undefined; this.publish();
    try {
      const report = await (this.options.inspect ?? inspectPlatformReadiness)({ root: folder.root, trusted: true, signal: run.abort.signal });
      if (!this.owns(run)) return;
      if (report.root !== folder.root) throw new Error("The setup report belongs to another folder.");
      this.report = report;
      this.phase = report.status;
      this.reason = report.reason;
    } catch (error) {
      if (!this.owns(run)) return;
      this.phase = "failed";
      this.reason = "Setup could not be checked. Recheck after confirming that the project folder is available.";
    } finally {
      if (this.active === run) {
        if (this.phase === "checking" && !this.owns(run)) {
          this.phase = "stale"; this.reason = "The project changed during this check. Check setup again.";
        }
        this.active = undefined; this.publish();
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.active?.abort.abort(); this.ownerKey = randomUUID();
    for (const disposable of this.watchers.splice(0)) disposable.dispose();
    for (const disposable of this.subscriptions.splice(0)) disposable.dispose();
    for (const disposable of this.panelSubscriptions.splice(0)) disposable.dispose();
    this.panel?.dispose(); this.panel = undefined;
  }
}
