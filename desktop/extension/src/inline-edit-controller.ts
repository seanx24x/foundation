import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { createInlineEditService } from "../../../server/project/inline-edit.mjs";

type Service = ReturnType<typeof createInlineEditService>;
type Owner = { key: string; path: string };
type Pending = {
  id: string; owner: Owner; document: vscode.TextDocument; version: number;
  before: string; selected: string; start: number; end: number; range: vscode.Range;
  column: vscode.ViewColumn | undefined; returnSelection?: vscode.Range; abort: AbortController;
  state: "input" | "generating" | "ready" | "applying";
  original: vscode.Uri; proposed: vscode.Uri;
  replacement?: string; summary?: string; model?: string;
};

/** Session-local selected-buffer editing. Never saves a document or sends its surroundings. */
export class InlineEditController implements vscode.Disposable {
  private pending: Pending | undefined;
  private input: vscode.InputBox | undefined;
  private snapshots = new Map<string, string>();
  private subscriptions: vscode.Disposable[] = [];
  private disposed = false;
  private primary = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
  private secondary = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  private dismissItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  constructor(private options: {
    getService: () => Service | undefined;
    owner: (document: vscode.TextDocument) => Owner | undefined;
  }) {
    this.primary.name = "Foundation selection edit";
    this.secondary.name = "Review selection edit";
    this.dismissItem.name = "Dismiss selection edit";
    this.subscriptions.push(this.primary, this.secondary, this.dismissItem,
      vscode.workspace.registerTextDocumentContentProvider("foundation-inline", {
        provideTextDocumentContent: uri => this.snapshots.get(uri.toString()) ?? "This selection edit has ended.",
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (this.pending?.document === event.document && this.pending.state !== "applying") this.invalidate();
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        if (this.pending?.document === document) this.invalidate();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.render()),
      vscode.window.tabGroups.onDidChangeTabs(event => {
        const pending = this.pending;
        if (pending?.state === "ready" && event.closed.some(tab => this.ownsTab(tab, pending))) void this.dismiss();
      }),
    );
  }

  inspect() {
    const pending = this.pending;
    return pending ? { state: pending.state, path: pending.owner.path, documentVersion: pending.version,
      selection: { start: pending.start, end: pending.end }, summary: pending.summary, model: pending.model } : { state: "idle" };
  }

  private current(pending: Pending) {
    return !this.disposed && this.pending === pending && !pending.abort.signal.aborted &&
      vscode.workspace.isTrusted && !pending.document.isClosed &&
      this.options.owner(pending.document)?.key === pending.owner.key &&
      pending.document.version === pending.version && pending.document.getText() === pending.before;
  }

  private ownsTab(tab: vscode.Tab, pending: Pending) {
    return tab.input instanceof vscode.TabInputTextDiff &&
      tab.input.original.toString() === pending.original.toString() &&
      tab.input.modified.toString() === pending.proposed.toString();
  }

  private render() {
    const pending = this.pending;
    const editor = vscode.window.activeTextEditor;
    const visible = pending && (editor?.document === pending.document ||
      editor?.document.uri.toString() === pending.original.toString() ||
      editor?.document.uri.toString() === pending.proposed.toString());
    const ready = !!pending && pending.state === "ready" && this.current(pending);
    void vscode.commands.executeCommand("setContext", "foundation.inlineEditReady", ready);
    void vscode.commands.executeCommand("setContext", "foundation.inlineEditActive", !!pending && pending.state !== "applying");
    this.primary.hide(); this.secondary.hide(); this.dismissItem.hide();
    if (!visible) return;
    if (pending.state === "generating") {
      this.primary.text = "$(loading~spin) Editing selection";
      this.primary.tooltip = "Cancel this selection edit. Other AI tasks are unaffected.";
      this.primary.command = "foundation.cancelInlineEdit";
      this.primary.show();
    } else if (ready) {
      this.primary.text = "$(check) Accept edit";
      this.primary.tooltip = "Replace only the selected text. Native Undo is available; your save settings apply.";
      this.primary.command = "foundation.acceptInlineEdit";
      this.secondary.text = "$(diff) Review edit";
      this.secondary.tooltip = `${pending.model ?? "AI"} · ${pending.summary ?? "Suggested selection edit"}\nAI suggestion · Not checked`;
      this.secondary.command = "foundation.reviewInlineEdit";
      this.dismissItem.text = "$(close) Dismiss";
      this.dismissItem.tooltip = "Discard this suggestion without changing the document.";
      this.dismissItem.command = "foundation.dismissInlineEdit";
      this.primary.show(); this.secondary.show(); this.dismissItem.show();
    }
  }

  private invalidate() {
    if (!this.pending) return;
    void this.dismiss();
    void vscode.window.showInformationMessage("Selection edit discarded because its document or workspace changed.");
  }

  private async instruction(pending: Pending, label: string): Promise<string | undefined> {
    const input = vscode.window.createInputBox();
    this.input = input;
    input.title = "Edit selection";
    input.placeholder = "Describe the change…";
    const lines = pending.selected.split(/\r\n|\r|\n/).length;
    input.prompt = `Send only this selection (${lines} ${lines === 1 ? "line" : "lines"}, ${Buffer.byteLength(pending.selected)} bytes), language and instruction to ${label}. Includes selected unsaved text. Enter to generate.`;
    input.ignoreFocusOut = true;
    return new Promise(resolve => {
      let settled = false;
      const finish = (value?: string) => {
        if (settled) return;
        settled = true;
        if (this.input === input) this.input = undefined;
        accept.dispose(); hide.dispose(); change.dispose();
        input.hide(); input.dispose(); resolve(value);
      };
      const validate = () => {
        const value = input.value.trim();
        input.validationMessage = !value ? "Describe the change to the selected code." : value.length > 2000 ? "Keep the instruction under 2,000 characters." : undefined;
        return value && value.length <= 2000 ? value : undefined;
      };
      const accept = input.onDidAccept(() => { const value = validate(); if (value) finish(value); });
      const hide = input.onDidHide(() => finish());
      const change = input.onDidChangeValue(() => { if (input.validationMessage) validate(); });
      input.show();
    });
  }

  async start() {
    if (this.disposed) return;
    if (this.pending) {
      void vscode.window.showInformationMessage("An inline edit is already open. Review or dismiss it before starting another.");
      if (this.pending.state === "ready") await this.review();
      return;
    }
    const editor = vscode.window.activeTextEditor;
    const owner = editor && this.options.owner(editor.document);
    if (!editor || !owner || !vscode.workspace.isTrusted || editor.document.uri.scheme !== "file" || editor.document.isClosed) {
      void vscode.window.showInformationMessage("Open a supported source file in a trusted Foundation project."); return;
    }
    if (editor.selections.length !== 1 || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage("Select one range of code to edit with AI."); return;
    }
    const service = this.options.getService(), status = service?.status();
    if (!service || !status?.configured) {
      if (await vscode.window.showInformationMessage("Set up AI before editing a selection.", "Set up AI") === "Set up AI")
        await vscode.commands.executeCommand("foundation.configureAI");
      return;
    }
    const before = editor.document.getText(), selected = editor.document.getText(editor.selection);
    if (Buffer.byteLength(before) > 256 * 1024 || !selected || Buffer.byteLength(selected) > 16 * 1024) {
      void vscode.window.showInformationMessage("Select up to 16 KiB of code in a source file under 256 KiB."); return;
    }
    const id = randomUUID();
    const pending: Pending = { id, owner, document: editor.document, version: editor.document.version,
      before, selected, start: editor.document.offsetAt(editor.selection.start), end: editor.document.offsetAt(editor.selection.end),
      range: new vscode.Range(editor.selection.start, editor.selection.end), column: editor.viewColumn,
      abort: new AbortController(), state: "input",
      original: vscode.Uri.from({ scheme: "foundation-inline", path: `/Before/${basename(owner.path)}`, query: id }),
      proposed: vscode.Uri.from({ scheme: "foundation-inline", path: `/Suggested/${basename(owner.path)}`, query: id }),
    };
    this.pending = pending; this.render();
    try {
      const prompt = await this.instruction(pending, `${status.provider} · ${status.model}`);
      if (prompt === undefined || !this.current(pending)) { if (this.pending === pending) await this.dismiss(); return; }
      pending.state = "generating"; this.render();
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
        title: "Editing selected code", cancellable: true }, async (_progress, token) => {
        const cancelled = token.onCancellationRequested(() => { if (this.pending === pending) void this.dismiss(); });
        try { return await service.generate({ selection: pending.selected, languageId: pending.document.languageId, prompt, signal: pending.abort.signal }); }
        finally { cancelled.dispose(); }
      });
      if (!this.current(pending)) { if (this.pending === pending) await this.dismiss(); return; }
      const replacement = result.replacement.replace(/\r\n|\r|\n/g, pending.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");
      if (replacement === pending.selected) throw new Error("The suggestion does not change the selection.");
      pending.replacement = replacement; pending.summary = result.summary; pending.model = result.model;
      this.snapshots.set(pending.original.toString(), pending.before);
      this.snapshots.set(pending.proposed.toString(), pending.before.slice(0, pending.start) + replacement + pending.before.slice(pending.end));
      pending.state = "ready"; this.render(); await this.review();
    } catch (error) {
      if (this.pending !== pending) return;
      await this.dismiss();
      const message = error instanceof Error && (error.name === "InlineEditError" || error.message === "The suggestion does not change the selection.")
        ? error.message : "The selection edit could not be completed. Your document is unchanged.";
      void vscode.window.showWarningMessage(message);
    }
  }

  /** Reuse the guarded native review for an already validated nearby edit.
   * This accepts a local snapshot, never model-provided paths or document handles. */
  async previewExternal(input: {
    document: vscode.TextDocument; version: number; before: string; range: vscode.Range;
    replacement: string; summary: string; model: string;
  }): Promise<boolean> {
    const { document, range, before } = input;
    const editor = vscode.window.activeTextEditor;
    const owner = this.options.owner(document);
    if (this.disposed || this.pending || !owner || !vscode.workspace.isTrusted ||
        document.uri.scheme !== "file" || document.isClosed || editor?.document !== document ||
        document.version !== input.version || document.getText() !== before ||
        Buffer.byteLength(before) > 256 * 1024 || range.isEmpty) return false;
    const start = document.offsetAt(range.start), end = document.offsetAt(range.end);
    const startPosition = document.positionAt(start), endPosition = document.positionAt(end);
    if (start >= end || startPosition.line !== range.start.line || startPosition.character !== range.start.character ||
        endPosition.line !== range.end.line || endPosition.character !== range.end.character ||
        typeof input.replacement !== "string" || /[\uD800-\uDFFF]/u.test(input.replacement) || input.replacement.includes("\0") ||
        Buffer.byteLength(input.replacement) > 4096 || typeof input.summary !== "string" || !input.summary.trim() ||
        input.summary.length > 300 || typeof input.model !== "string" || !input.model) return false;
    const selected = before.slice(start, end);
    const replacement = input.replacement.replace(/\r\n|\r|\n/g, document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");
    if (replacement === selected || Buffer.byteLength(selected) > 4096 || selected.split(/\r\n|\r|\n/).length > 12 ||
        replacement.split(/\r\n|\r|\n/).length > 12) return false;
    const id = randomUUID();
    const pending: Pending = { id, owner, document, version: input.version, before, selected, start, end,
      range, column: editor.viewColumn, returnSelection: new vscode.Range(editor.selection.start, editor.selection.end),
      abort: new AbortController(), state: "ready", replacement, summary: input.summary, model: input.model,
      original: vscode.Uri.from({ scheme: "foundation-inline", path: `/Before/${basename(owner.path)}`, query: id }),
      proposed: vscode.Uri.from({ scheme: "foundation-inline", path: `/Suggested/${basename(owner.path)}`, query: id }),
    };
    this.pending = pending;
    this.snapshots.set(pending.original.toString(), before);
    this.snapshots.set(pending.proposed.toString(), before.slice(0, start) + replacement + before.slice(end));
    this.render();
    try { await this.review(); return this.pending === pending && this.current(pending); }
    catch { if (this.pending === pending) await this.dismiss(); return false; }
  }

  async review() {
    const pending = this.pending;
    if (!pending || pending.state !== "ready") return;
    if (!this.current(pending)) { this.invalidate(); return; }
    await vscode.commands.executeCommand("vscode.diff", pending.original, pending.proposed,
      `${basename(pending.owner.path)} · Suggested edit`, { viewColumn: pending.column, preview: true, preserveFocus: false,
        selection: new vscode.Range(pending.document.positionAt(pending.start), pending.document.positionAt(pending.end)) });
    if (this.pending !== pending) { await this.closePreview(pending); return; }
    if (!this.current(pending)) this.invalidate();
    this.render();
  }

  async accept() {
    const pending = this.pending;
    if (!pending || pending.state !== "ready" || pending.replacement === undefined) return false;
    if (!this.current(pending)) { this.invalidate(); return false; }
    pending.state = "applying"; this.render();
    try {
      const editor = await vscode.window.showTextDocument(pending.document, { viewColumn: pending.column, preview: false, preserveFocus: false });
      if (!this.current(pending) || editor.document !== pending.document) return false;
      // TextEditor.edit additionally captures the native model version. No asynchronous
      // operation occurs between this final ownership check and the edit request.
      if (!this.current(pending)) return false;
      const applied = await editor.edit(builder => builder.replace(pending.range, pending.replacement!), { undoStopBefore: true, undoStopAfter: true });
      if (!applied) {
        void vscode.window.showWarningMessage("The document changed before this edit could be accepted. Select the current code and try again.");
        return false;
      }
      editor.selection = new vscode.Selection(pending.document.positionAt(pending.start), pending.document.positionAt(pending.start + pending.replacement.length));
      return true;
    } catch {
      void vscode.window.showWarningMessage("The selection edit could not be accepted. Review the current document before trying again.");
      return false;
    } finally { if (this.pending === pending) await this.dismiss(); }
  }

  async dismiss(revealSource = false) {
    const pending = this.pending;
    if (!pending) return;
    const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
    const returnToSource = revealSource && pending.state === "ready" && this.current(pending) &&
      (activeUri === pending.original.toString() || activeUri === pending.proposed.toString());
    this.pending = undefined;
    pending.abort.abort();
    this.input?.hide();
    this.render();
    // Reveal the owning source before closing the preview so native tab ordering
    // cannot select an unrelated document. Background cleanup never moves focus.
    if (returnToSource && !this.disposed && !this.pending && !pending.document.isClosed &&
        vscode.workspace.isTrusted && this.options.owner(pending.document)?.key === pending.owner.key &&
        pending.document.version === pending.version && pending.document.getText() === pending.before) {
      try { await vscode.window.showTextDocument(pending.document, { viewColumn: pending.column,
        preview: false, preserveFocus: false, selection: pending.returnSelection ?? pending.range }); }
      catch { /* The owning source may have closed while the native reveal was pending. */ }
    }
    await this.closePreview(pending);
  }

  private async closePreview(pending: Pending) {
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => this.ownsTab(tab, pending));
    try { if (tabs.length) await vscode.window.tabGroups.close(tabs, true); }
    catch { /* A concurrently closing native tab cannot reactivate a retired edit. */ }
    finally { this.snapshots.delete(pending.original.toString()); this.snapshots.delete(pending.proposed.toString()); }
  }

  dispose() {
    this.disposed = true;
    void this.dismiss();
    this.subscriptions.forEach(item => item.dispose());
    this.snapshots.clear();
  }
}
