import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { createCodeSuggestionService } from "../../../server/project/code-suggestions.mjs";

type Service = ReturnType<typeof createCodeSuggestionService>;
type Owner = { key: string; path: string };
type Capture = {
  id: string; document: vscode.TextDocument; version: number; before: string;
  owner: Owner; position: vscode.Position; offset: number;
  prefix: string; suffix: string; contextStart: number; started: number;
};
type Pending = Capture & { abort: AbortController; sent: boolean };
type NextEdit = Capture & { range: vscode.Range; replacement: string; summary: string; model: string };
export type SuggestedEditPreview = {
  document: vscode.TextDocument; version: number; before: string; range: vscode.Range;
  replacement: string; summary: string; model: string;
};
const MAX_BUFFER_BYTES = 256 * 1024;
const MAX_CONTEXT_BYTES = 12 * 1024;
const MAX_CONTEXT_SIDE_BYTES = MAX_CONTEXT_BYTES / 2;
const REQUESTS_PER_MINUTE = 20;
const samePosition = (a: vscode.Position | undefined, b: vscode.Position | undefined) =>
  !!a && !!b && a.line === b.line && a.character === b.character;
const validText = (text: unknown): text is string => typeof text === "string" && !text.includes("\0") && !/[\uD800-\uDFFF]/u.test(text);
const normalizeEol = (text: string, document: vscode.TextDocument) => text.replace(/\r\n|\r|\n/g, document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");

/** Retain whole code points at each context boundary, including astral characters. */
function boundedSide(text: string, fromEnd: boolean) {
  const characters = Array.from(text);
  let bytes = 0;
  const result: string[] = [];
  if (fromEnd) characters.reverse();
  for (const character of characters) {
    const size = Buffer.byteLength(character);
    if (bytes + size > MAX_CONTEXT_SIDE_BYTES) break;
    bytes += size; result.push(character);
  }
  if (fromEnd) result.reverse();
  return result.join("");
}

/** Opt-in, session-local native completions. Only the native editor inserts ghost text. */
export class CodeSuggestionController implements vscode.Disposable {
  private sessionKey: string | undefined;
  private pending: Pending | undefined;
  private generation: Promise<unknown> | undefined;
  private nextEdit: NextEdit | undefined;
  private ghost: (Capture & { remaining: string }) | undefined;
  private lastChange: { document: vscode.TextDocument; version: number; position: vscode.Position } | undefined;
  private lastAutomatic: string | undefined;
  private issued = new Map<string, { accepted: boolean }>();
  private requests: number[] = [];
  private disposed = false;
  private starting = 0;
  private notice = "";
  private status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  private subscriptions: vscode.Disposable[] = [];
  private metrics = {
    requested: 0, cancelled: 0, published: 0, accepted: 0, edits: 0, none: 0, errors: 0,
    samples: [] as Array<{ kind: string; providerMs: number; totalMs: number }>,
  };

  constructor(private options: {
    getService: () => Service | undefined;
    owner: (document: vscode.TextDocument) => Owner | undefined;
    isBusy: () => boolean;
    reviewEdit: (input: SuggestedEditPreview) => Promise<boolean>;
  }) {
    this.status.name = "Foundation code suggestions";
    this.subscriptions.push(this.status,
      vscode.languages.registerInlineCompletionItemProvider({ scheme: "file" }, {
        provideInlineCompletionItems: (document, position, context, token) => this.provide(document, position, context, token),
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        const capture = this.pending ?? this.nextEdit ?? this.ghost;
        if (!event.contentChanges.length) {
          if (capture?.document === event.document && capture.version !== event.document.version) this.invalidate();
          return;
        }
        if (this.retainNativePrefix(event)) { this.lastChange = undefined; return; }
        if (this.pending?.document === event.document || this.nextEdit?.document === event.document || this.ghost?.document === event.document) this.invalidate();
        const changes = event.contentChanges;
        const editor = vscode.window.activeTextEditor;
        if (this.sessionKey && editor?.document === event.document && this.options.owner(event.document)?.key === this.sessionKey && changes.length === 1) {
          const change = changes[0];
          this.lastChange = { document: event.document, version: event.document.version,
            position: event.document.positionAt(change.rangeOffset + change.text.length) };
        } else if (this.lastChange?.document === event.document && changes.length) this.lastChange = undefined;
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        if (this.pending?.document === document || this.nextEdit?.document === document || this.ghost?.document === document) this.invalidate();
        if (this.lastChange?.document === document) this.lastChange = undefined;
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.invalidate(); this.lastChange = undefined; this.render();
      }),
      vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.textEditor !== vscode.window.activeTextEditor) return;
        const capture = this.pending ?? this.nextEdit ?? this.ghost;
        if (capture && (!this.eligible(event.textEditor.document, event.textEditor.selection.active) ||
            capture.document !== event.textEditor.document || !samePosition(capture.position, event.textEditor.selection.active))) this.invalidate();
      }),
    );
  }

  inspect() {
    const capture = this.pending ?? this.nextEdit ?? this.ghost;
    return {
      state: this.pending ? "generating" : this.nextEdit ? "next-edit" : this.sessionKey ? "enabled" : this.notice ? "paused" : "off",
      enabled: !!this.sessionKey,
      ...(capture ? { path: capture.owner.path, documentVersion: capture.version,
        contextBytes: Buffer.byteLength(capture.prefix + capture.suffix) } : {}),
      ...(this.notice ? { reason: this.notice } : {}),
      metrics: { ...this.metrics, samples: this.metrics.samples.map(sample => ({ ...sample })),
        timingScope: "Provider wait and request-to-return only; excludes native presentation and physical input-to-paint." },
    };
  }

  async start() {
    const editor = vscode.window.activeTextEditor;
    const owner = editor && this.options.owner(editor.document);
    if (this.disposed || !editor || !owner || !vscode.workspace.isTrusted || editor.document.uri.scheme !== "file") {
      void vscode.window.showInformationMessage("Open a supported source file in a trusted Foundation project first.");
      return false;
    }
    const service = this.options.getService(), provider = service?.status();
    if (!provider?.configured) {
      const action = await vscode.window.showInformationMessage("Set up AI before starting code suggestions.", "Set up AI");
      if (action === "Set up AI") void vscode.commands.executeCommand("foundation.configureAI");
      return false;
    }
    const generation = ++this.starting;
    const action = await vscode.window.showInformationMessage(
      "Start code suggestions for this session?",
      { modal: true, detail: `While you type, Foundation sends up to 12 KiB around the caret (20 lines before and 10 after), including unsaved text and its language, to ${provider.provider} · ${provider.model}. File paths, other files and Assistant history stay local. Suggestions can use paid API requests, limited to 20 per minute. Pause at any time; restart leaves suggestions off.` },
      "Start suggestions",
    );
    if (action !== "Start suggestions" || this.disposed || generation !== this.starting ||
        !vscode.workspace.isTrusted || this.options.getService() !== service ||
        vscode.window.activeTextEditor?.document !== editor.document || this.options.owner(editor.document)?.key !== owner.key) return false;
    this.invalidate();
    this.sessionKey = owner.key; this.notice = ""; this.lastChange = undefined; this.lastAutomatic = undefined;
    // Rate windows survive pause/resume; restarting a session cannot bypass the cap.
    this.render();
    return true;
  }

  stop(reason = "") {
    this.starting++;
    this.sessionKey = undefined; this.lastChange = undefined; this.lastAutomatic = undefined;
    this.notice = reason;
    this.invalidate(); this.render();
  }

  interrupt() {
    this.lastChange = undefined;
    this.invalidate();
  }

  async request() {
    if (!this.sessionKey) return false;
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.eligible(editor.document, editor.selection.active)) return false;
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    return true;
  }

  accepted(id: unknown) {
    if (typeof id !== "string") return;
    const issued = this.issued.get(id);
    if (!issued || issued.accepted) return;
    issued.accepted = true; this.metrics.accepted++;
    this.lastChange = undefined;
    // The native command runs AFTER insertion. This is telemetry, never an edit guard.
    this.invalidate();
  }

  async reviewNextEdit() {
    const next = this.nextEdit;
    if (!next || !this.current(next)) { this.invalidate(); return false; }
    this.nextEdit = undefined;
    this.lastChange = undefined; this.render();
    return this.options.reviewEdit({ document: next.document, version: next.version, before: next.before,
      range: next.range, replacement: next.replacement, summary: next.summary, model: next.model });
  }

  dismissNextEdit() { this.nextEdit = undefined; this.render(); }

  private eligible(document: vscode.TextDocument, position: vscode.Position) {
    const editor = vscode.window.activeTextEditor;
    return !this.disposed && !!this.sessionKey && vscode.workspace.isTrusted && !this.options.isBusy() &&
      !document.isClosed && document.uri.scheme === "file" && this.options.owner(document)?.key === this.sessionKey &&
      editor?.document === document && editor.selections.length === 1 && editor.selection.isEmpty &&
      samePosition(editor.selection.active, position) && Buffer.byteLength(document.getText()) <= MAX_BUFFER_BYTES;
  }

  private current(capture: Capture) {
    return this.eligible(capture.document, capture.position) && this.options.owner(capture.document)?.key === capture.owner.key &&
      capture.document.version === capture.version && capture.document.getText() === capture.before;
  }

  private capture(document: vscode.TextDocument, position: vscode.Position): Capture | undefined {
    if (!this.eligible(document, position)) return;
    const owner = this.options.owner(document);
    if (!owner) return;
    const before = document.getText(), offset = document.offsetAt(position);
    if (!validText(before) || !Number.isInteger(offset) || offset < 0 || offset > before.length) return;
    const prefix = boundedSide(before.slice(0, offset).split("\n").slice(-20).join("\n"), true);
    const suffix = boundedSide(before.slice(offset).split("\n").slice(0, 10).join("\n"), false);
    if (!validText(prefix) || !validText(suffix)) return;
    return { id: randomUUID(), document, version: document.version, before, owner, position, offset,
      prefix, suffix, contextStart: offset - prefix.length, started: performance.now() };
  }

  private retainNativePrefix(event: vscode.TextDocumentChangeEvent) {
    const ghost = this.ghost;
    if (!ghost || this.pending || this.nextEdit || event.document !== ghost.document || event.contentChanges.length !== 1 ||
      !this.sessionKey || !vscode.workspace.isTrusted || this.options.isBusy() ||
      vscode.window.activeTextEditor?.document !== ghost.document || this.options.owner(ghost.document)?.key !== ghost.owner.key ||
      ghost.document.version !== ghost.version + 1) return false;
    const change = event.contentChanges[0];
    if (change.rangeLength !== 0 || change.rangeOffset !== ghost.offset || !change.text || !ghost.remaining.startsWith(change.text)) return false;
    const source = ghost.before.slice(0, ghost.offset) + change.text + ghost.before.slice(ghost.offset);
    if (ghost.document.getText() !== source) return false;
    const offset = ghost.offset + change.text.length;
    this.ghost = { ...ghost, version: ghost.document.version, before: source, offset,
      position: ghost.document.positionAt(offset), remaining: ghost.remaining.slice(change.text.length) };
    return true;
  }

  private invalidate(hide = true) {
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      if (pending.sent) this.metrics.cancelled++;
      pending.abort.abort();
    }
    this.nextEdit = undefined;
    const hadGhost = !!this.ghost;
    this.ghost = undefined;
    if (hide && hadGhost) void vscode.commands.executeCommand("editor.action.inlineSuggest.hide");
    this.render();
  }

  private async quietPeriod(pending: Pending, milliseconds: number) {
    if (pending.abort.signal.aborted) return false;
    return new Promise<boolean>(resolve => {
      const finish = (value: boolean) => { clearTimeout(timer); pending.abort.signal.removeEventListener("abort", cancel); resolve(value); };
      const cancel = () => finish(false);
      const timer = setTimeout(() => finish(true), milliseconds);
      pending.abort.signal.addEventListener("abort", cancel, { once: true });
    });
  }

  private async previousGeneration(pending: Pending) {
    const previous = this.generation;
    if (!previous) return true;
    if (pending.abort.signal.aborted) return false;
    return new Promise<boolean>(resolve => {
      const finish = (value: boolean) => { pending.abort.signal.removeEventListener("abort", cancel); resolve(value); };
      const cancel = () => finish(false);
      pending.abort.signal.addEventListener("abort", cancel, { once: true });
      void previous.then(() => finish(true), () => finish(true));
    });
  }

  private async provide(document: vscode.TextDocument, position: vscode.Position, context: vscode.InlineCompletionContext, token: vscode.CancellationToken): Promise<vscode.InlineCompletionItem[]> {
    if (context.selectedCompletionInfo || token.isCancellationRequested || !this.eligible(document, position)) {
      this.invalidate(); return [];
    }
    const automatic = context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic;
    const key = `${document.uri.toString()}\0${document.version}`;
    if (automatic && (this.lastChange?.document !== document || this.lastChange.version !== document.version ||
      !samePosition(this.lastChange.position, position) || this.lastAutomatic === key)) return [];
    const capture = this.capture(document, position), service = this.options.getService();
    if (!capture || !service?.status().configured) { this.invalidate(); return []; }
    this.invalidate();
    const pending: Pending = { ...capture, abort: new AbortController(), sent: false };
    this.pending = pending;
    const listener = token.onCancellationRequested(() => {
      if (this.pending === pending) this.invalidate(); else pending.abort.abort();
    });
    this.render();
    let providerStart = 0;
    try {
      if (automatic && !await this.quietPeriod(pending, 250)) return [];
      if (!await this.previousGeneration(pending)) return [];
      if (this.pending !== pending || pending.abort.signal.aborted || !this.current(pending) || this.options.getService() !== service) return [];
      const now = performance.now();
      this.requests = this.requests.filter(time => now - time < 60000);
      if (this.requests.length >= REQUESTS_PER_MINUTE) {
        this.stop("Request limit reached. Wait a minute, then start suggestions again."); return [];
      }
      this.requests.push(now); this.metrics.requested++; pending.sent = true;
      if (automatic) this.lastAutomatic = key;
      providerStart = performance.now();
      const generation = service.generate({ prefix: pending.prefix, suffix: pending.suffix, languageId: document.languageId, signal: pending.abort.signal });
      this.generation = generation;
      const result = await generation.finally(() => { if (this.generation === generation) this.generation = undefined; });
      const end = performance.now();
      if (this.pending !== pending || pending.abort.signal.aborted || !this.current(pending)) return [];
      this.metrics.samples.push({ kind: result.kind, providerMs: Math.max(0, end - providerStart), totalMs: Math.max(0, end - pending.started) });
      if (this.metrics.samples.length > 100) this.metrics.samples.shift();
      this.notice = "";
      if (result.kind === "completion") {
        if (!validText(result.text) || !result.text.length || Buffer.byteLength(result.text) > 4096) throw new Error("invalid-completion");
        const text = normalizeEol(result.text, document);
        if (Buffer.byteLength(text) > 4096) throw new Error("oversized-completion");
        this.ghost = { ...pending, remaining: text }; this.metrics.published++;
        this.issued.set(pending.id, { accepted: false });
        while (this.issued.size > 100) this.issued.delete(this.issued.keys().next().value!);
        return [new vscode.InlineCompletionItem(text, new vscode.Range(position, position), {
          command: "foundation.codeSuggestionAccepted", title: "Record accepted suggestion", arguments: [pending.id],
        })];
      }
      if (result.kind === "edit") {
        const contextText = pending.prefix + pending.suffix;
        const start = contextText.indexOf(result.oldText), end = start + result.oldText.length;
        if (!validText(result.oldText) || !result.oldText.length || !validText(result.newText) || !validText(result.summary) ||
          !result.summary.trim() || result.summary.length > 300 || result.oldText === result.newText ||
          Buffer.byteLength(result.oldText) > 4096 || Buffer.byteLength(result.newText) > 4096 ||
          result.oldText.split(/\r\n|\r|\n/).length > 12 || result.newText.split(/\r\n|\r|\n/).length > 12 ||
          start < 0 || contextText.indexOf(result.oldText, start + 1) !== -1 || (start < pending.prefix.length && end > pending.prefix.length)) throw new Error("invalid-next-edit");
        const replacement = normalizeEol(result.newText, document);
        if (replacement === result.oldText || Buffer.byteLength(replacement) > 4096) throw new Error("invalid-normalized-edit");
        this.nextEdit = { ...pending, range: new vscode.Range(document.positionAt(pending.contextStart + start), document.positionAt(pending.contextStart + end)),
          replacement, summary: result.summary, model: result.model };
        this.metrics.edits++;
      } else if (result.kind === "none") this.metrics.none++;
      else throw new Error("invalid-kind");
      return [];
    } catch (error) {
      if (this.pending === pending && !pending.abort.signal.aborted && this.current(pending)) {
        this.metrics.errors++;
        this.notice = "Suggestion unavailable. Check AI setup or try again.";
      }
      return [];
    } finally {
      listener.dispose();
      if (this.pending === pending) this.pending = undefined;
      this.render();
    }
  }

  private render() {
    void vscode.commands.executeCommand("setContext", "foundation.codeSuggestionsEnabled", !!this.sessionKey);
    void vscode.commands.executeCommand("setContext", "foundation.nextEditReady", !!this.nextEdit && this.current(this.nextEdit));
    this.status.hide();
    const editor = vscode.window.activeTextEditor;
    const owner = editor && this.options.owner(editor.document);
    if (this.disposed || (!this.sessionKey && !this.notice) || !editor || !owner || (this.sessionKey && owner.key !== this.sessionKey)) return;
    if (this.nextEdit && this.current(this.nextEdit)) {
      this.status.text = "$(arrow-right) Next edit";
      this.status.tooltip = `${this.nextEdit.summary}\n${this.nextEdit.model} · AI suggestion · Not checked\nReview the native diff before accepting.`;
      this.status.command = "foundation.reviewNextEdit";
    } else {
      this.status.text = this.pending ? "$(loading~spin) Suggestions" : this.sessionKey ? "$(sparkle) Suggestions" : "$(debug-pause) Suggestions paused";
      const provider = this.options.getService()?.status();
      const last = this.metrics.samples.at(-1);
      const details = `${provider?.provider ?? "AI"} · ${provider?.model ?? "No model"}\nUp to 12 KiB around the caret · ${this.metrics.requested} request${this.metrics.requested === 1 ? "" : "s"} · 20/minute limit${last ? `\nLast provider wait ${Math.round(last.providerMs)} ms · request-to-return ${Math.round(last.totalMs)} ms (excludes paint)` : ""}`;
      this.status.tooltip = `${this.notice || "Automatic suggestions are on for this session. Click to pause."}\n${details}`;
      this.status.command = this.sessionKey ? "foundation.stopCodeSuggestions" : "foundation.startCodeSuggestions";
    }
    this.status.show();
  }

  dispose() {
    this.disposed = true; this.stop(); this.subscriptions.forEach(subscription => subscription.dispose()); this.issued.clear();
  }
}
