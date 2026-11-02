import * as vscode from "vscode";
import { CodeSuggestionController } from "./code-suggestion-controller";
import { SwiftLanguageController } from "./swift-language-controller";
import { XcodeProjectController } from "./xcode-project-controller";
import { PlatformSetupController } from "./platform-setup-controller";
import { createCodeSuggestionService } from "../../../server/project/code-suggestions.mjs";
import { InlineEditController } from "./inline-edit-controller";
import { createInlineEditService } from "../../../server/project/inline-edit.mjs";
import { resolveProviderKey } from "./provider-credentials.mjs";
import { createStartupDiagnostics } from "./startup-diagnostics.mjs";
import { createConversationStore } from "./conversation-store.mjs";
import { createFeatureStore, suggestFeatureFiles, type FeatureSnapshot } from "./feature-store.mjs";
import { createRuntimeWorkspaceStore, safeScreenRoute } from "./runtime-workspace-store.mjs";
import { createRuntimeCaptureStore, inspectCapturePng } from "./runtime-capture-store.mjs";
import { createCaptureFileStorage } from "./runtime-capture-files.mjs";
import { createRuntimeReplayStore, type ReplayRequested, type ReplayRecipe } from "./runtime-replay-store.mjs";
import { createReproducibleIssuesStore } from "./reproducible-issues-store.mjs";
import { assessReproducibleIssue, normalizeReproducibleIssueContext, reproducibleIssueDigest, reproducibleIssueEvidenceDigest, type ReproducibleIssue } from "../../../server/project/reproducible-issues.mjs";
import { createProjectDecisionsStore } from "./project-decisions-store.mjs";
import { assessProjectDecision, normalizeProjectDecisionContext, projectDecisionDigest, projectDecisionEvidenceDigest, type ProjectDecision } from "../../../server/project/project-decisions.mjs";
import { normalizeAlternativeGeneration, validateAlternativeGenerationFiles, normalizeAIAlternatives, aiAlternativesDigest } from "../../../server/project/ai-alternatives.mjs";
import { createVisualAlternativesSession, type AlternativePreview } from "./visual-alternatives-session.mjs";
import { createVisualVerificationStore, prepareVisualVerificationLink, visualVerificationView, visualVerificationDigest } from "./visual-verification-store.mjs";
import { createRuntimeMatrixStore, MATRIX_REASONS, type MatrixBasis, type MatrixCell, type MatrixReason } from "./runtime-matrix-store.mjs";
import { createRuntimeStateSuiteStore, type StateSuiteState } from "./runtime-state-suite-store.mjs";
import type { CaptureRuntimeIdentity } from "./runtime-capture-store.mjs";
import { randomBytes, randomUUID } from "node:crypto";
import { join, basename } from "node:path";
import { readFile } from "node:fs/promises";
import { buildDesignPreview } from "./design-preview.mjs";
import { createConnectedRuntime, type RuntimeSnapshot } from "./connected-runtime.mjs";
import { createHash } from "node:crypto";
// @ts-ignore Host-independent proposal validation is JavaScript.
import { createTokenProposal, listDesignTokens, validateChangeSet, validAlternativeSourcePath, validateAlternativeGroupBasis, groupRevisionDescriptor, stagedGroupSources } from "../../../server/project/proposals.mjs";
// @ts-ignore Review state has runtime validation and guarded persistence.
import { createProposalSession } from "./proposal-session.mjs";
// @ts-ignore Saved change impact is validated by the shared source service.
import { validateChangeImpact } from "../../../server/project/change-impact.mjs";
// @ts-ignore Durable isolated change groups validate their own runtime contract.
import { createChangeSetSession } from "./change-set-session.mjs";
// @ts-ignore Isolated tool checks validate their own runtime contract.
import { createExecutionSession, changeGroupDigest } from "./execution-session.mjs";
import { createCheckPlanSession } from "./check-plan-session.mjs";
// Existing host-independent services are bundled into the extension.
// @ts-ignore The service is JavaScript with runtime validation.
import { createProjectService } from "../../../server/project/workspace.mjs";
// @ts-ignore The service is JavaScript with runtime validation.
import { createAssistantService, normalizeRuntimeEvidence, normalizeTaskContext } from "../../../server/project/assistant.mjs";
// @ts-ignore Strict host-independent check-suggestion validation.
import { normalizeCheckContext, validateCheckSuggestion, checkSuggestionDigest } from "../../../server/project/assistant-artifacts.mjs";
// @ts-ignore Canonical local source-investigation snapshots have strict runtime validation.
import { createSourceInvestigation, validateSourceInvestigation, sourceInvestigationDescriptor, normalizeSourceInvestigationDescriptor } from "../../../server/project/source-investigation.mjs";
import { deriveInvestigationContext, deriveInvestigationChain, investigationContextDescriptor, normalizeInvestigationContextDescriptor, validateInvestigationDecision } from "../../../server/project/investigation-continuation.mjs";
import { createAssistantBridge } from "./assistant-bridge.mjs";
import {
  relativeSourcePath,
  validSourcePath,
  validLine,
  escapeHtml,
} from "./safety.mjs";
import type { ProjectFile, ProjectSnapshot } from "../../../src/project/types";

type Mode = "Understand" | "Build" | "Refine" | "Review" | "Assistant";
type Surface = "workspace" | "assistant";
type KnowledgeOffer = {prepareId:string;projectId:string;root:string;featureId:string|null;conversationId:string|null;epoch:number;
  kind:"decision"|"issue";id:string;digest:string;source:vscode.Webview;target?:vscode.Webview;delivering?:boolean;delivered?:boolean;context?:unknown};
// Display-only, scoped to one refresh. Never used to authorize writes or AI requests.
type DisplaySources = { projectId: string; root: string; epoch: number; paths: Set<string>;
  files: Map<string, ProjectFile>; unavailable: Map<string, { code: string; message: string }>; current: () => boolean };
type AssistantIntent = "ask" | "plan" | "build" | "review";
type AssistantPreparation = { projectId: string; contextPath: string; intent: AssistantIntent; prompt?: string };
const assistantIntent = (value: unknown): AssistantIntent | undefined => value === undefined ? "ask" : value === "change" ? "build" : ["ask", "plan", "build", "review"].includes(value as string) ? value as AssistantIntent : undefined;
type SavedChange = {
  path: string;
  root: string;
  before: string;
  after: string;
  baseRevision: string;
  revision: string;
};
type WorkspaceFocus = {
  path: string;
  line?: number;
  endLine?: number;
  label?: string;
  origin: "source" | "preview" | "runtime";
  revision?: string;
  session?: string;
  viewId?: string;
  stale?: boolean;
};
type Bridge = { url: string; token: string; close: () => Promise<void> };
type Node = {
  label: string;
  description?: string;
  tooltip?: string;
  path?: string;
  line?: number;
  command?: string;
  icon?: string;
  children?: Node[];
};
const KEY_NAME = "foundation.ai.providerKey";
const ACTIONS = new Set([
  "foundation.build",
  "foundation.focusWorkspace",
  "foundation.openProject",
  "foundation.manageTrust",
  "foundation.review",
  "foundation.refine",
  "foundation.understand",
  "foundation.askAI",
  "foundation.toggleAssistant",
  "foundation.collapseAssistant",
  "foundation.configureAI",
  "foundation.openTerminal",
  "foundation.openSearch",
  "foundation.openDebug",
  "foundation.openGit",
  "foundation.refresh",
  "foundation.startDesignPreview",
  "foundation.newFeature",
  "foundation.selectFeature",
  "foundation.prepareFeatureContext",
  "foundation.knowledge",
  "foundation.openFeatureEntry",
  "foundation.openFeatureScreen",
  "foundation.observeFeatureScenario",
]);

class ContextTree implements vscode.TreeDataProvider<Node> {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  nodes: Node[] = [];
  refresh() {
    this.changed.fire();
  }
  getChildren(element?: Node) {
    return element?.children ?? this.nodes;
  }
  getTreeItem(element: Node) {
    const item = new vscode.TreeItem(
      element.label,
      element.children?.length
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = new vscode.ThemeIcon(element.icon || "symbol-file");
    if (element.command)
      item.command = { command: element.command, title: element.label };
    else if (element.path)
      item.command = {
        command: "foundation.openSource",
        title: "Open source",
        arguments: [element.path, element.line],
      };
    return item;
  }
  dispose() {
    this.changed.dispose();
  }
}

class FoundationHost implements vscode.Disposable {
  private service: any;
  private swiftLanguage: SwiftLanguageController | undefined;
  private xcodeProject: XcodeProjectController | undefined;
  private platformSetup: PlatformSetupController | undefined;
  private assistant: any;
  private codeSuggestions: CodeSuggestionController | undefined;
  private codeSuggestionService: ReturnType<typeof createCodeSuggestionService> | undefined;
  private inlineEdit: InlineEditController | undefined;
  private inlineEditService: ReturnType<typeof createInlineEditService> | undefined;
  private bridge: Bridge | undefined;
  private configurationGeneration = 0;
  private configuringProvider = false;
  private runtime: ReturnType<typeof createConnectedRuntime> | undefined;
  private runtimeRoot: string | undefined;
  private runtimeGeneration = 0;
  private runtimeSelectionKey = "";
  private runtimeFrameOrigin = "";
  private alternativeFrameOrigin = "";
  private panel: vscode.WebviewPanel | undefined;
  private workspaceRevealGeneration = 0;
  private workspaceRevealTask: Promise<void> | undefined;
  private pendingWorkspaceMode: { mode: Exclude<Mode, "Assistant">; tab: vscode.Tab } | undefined;
  private assistantContextFiles: ProjectFile[] = [];
  private artifactSourceFiles: ProjectFile[] = [];
  private artifactSourceUnavailable: string[] = [];
  private artifactSourceOwner: {projectId: string; root: string; conversationId: string; paths: string[]; epoch: number} | undefined;
  private planActionGeneration = 0;
  private assistantRestoreGeneration = 0;
  private assistantContextRestore: { requestId: string; projectId: string; featureId: string | null; conversationId: string | null; paths: string[] } | undefined;
  private assistantContextEpoch = -1;
  private assistantView: vscode.WebviewView | undefined;
  private historyDeliveries = new WeakMap<vscode.Webview, { channels: Map<string, any> }>();
  private assistantOpen = false;
  private assistantReady = false;
  private assistantFocusRequested = false;
  private assistantVisibilityTask: Promise<void> | undefined;
  private assistantVisibilityGeneration = 0;
  private assistantRevealWaiters = new Set<() => void>();
  private assistantPreparation: AssistantPreparation | undefined;
  private knowledgeOffer: KnowledgeOffer | undefined;
  private knowledgeReveal: {projectId:string;root:string}|undefined;
  private workspaceReady = false;
  private tree = new ContextTree();
  private status: vscode.StatusBarItem;
  private diagnosticOutput: vscode.OutputChannel;
  private diagnostics: ReturnType<typeof createStartupDiagnostics>;
  private project: ProjectSnapshot | null = null;
  private activeFile: ProjectFile | null = null;
  private openFiles: ProjectFile[] = [];
  private lastDocument: vscode.Uri | undefined;
  private focus: WorkspaceFocus | null = null;
  private focusGeneration = 0;
  private focusPersistence: Promise<void> | undefined;
  private error: string | undefined;
  private aiAlternativeReview: object | undefined;
  private aiAlternativeError: string | undefined;
  private aiAlternativeProjection: {key:string;value:any} | undefined;
  private aiAlternativeDisplayDigests: WeakMap<object,string> | undefined;
  private mode: Exclude<Mode, "Assistant"> = "Understand";
  private generation = 0;
  private askGeneration = 0;
  private asking: { requestId: string; abort: AbortController; terminal: boolean; projectId: string; conversationId: string | null; store: ReturnType<typeof createConversationStore>; durable: boolean; groupRevision?: any; groupGuard?: () => boolean; checkContext?: any; checkGuard?: () => boolean; sourceInvestigation?: any; investigationGuard?: () => boolean; investigationContinuation?: any; continuationGuard?: () => boolean; alternativeGeneration?: any; alternativeGuard?: () => boolean; progressTimer?: ReturnType<typeof setTimeout> } | undefined;
  private contextTimer: ReturnType<typeof setTimeout> | undefined;
  private editorStateTimer: ReturnType<typeof setTimeout> | undefined;
  private editorStateOwner: { id: string; root: string } | undefined;
  private sentDirtyPathsKey: string | undefined;
  private savedChanges = new Map<string, SavedChange>();
  private pendingSaves = new Map<string, ProjectFile>();
  private snapshots = new Map<string, string>();
  private disposed = false;
  private nonce = randomBytes(16).toString("base64");
  private design: any = { status: "idle", compilation: "not-run", observed: false, tokens: [] };
  private designGeneration = 0;
  private designImpactOwner: any;
  private designImpactView: any;
  private designImpactGeneration = 0;
  private designImpactNavigation = 0;
  private designImpactValidationCache: {key: string; valid: boolean} | undefined;
  private sentDesignSession: string | undefined;
  private proposalSessions = new Map<string, any>();
  private changeSetSessions = new Map<string, any>();
  private executionSessions = new Map<string, any>();
  private checkPlanSessions = new Map<string, any>();
  private changeSetActionGeneration = 0;
  private requestRevisionGeneration = 0;
  private groupRevisionGeneration = 0;
  private checkSuggestionGeneration = 0;
  private changeSetOperationGuards = new Map<string, () => void>();
  private conversationStores = new Map<string, ReturnType<typeof createConversationStore>>();
  private featureStores = new Map<string, ReturnType<typeof createFeatureStore>>();
  private runtimeWorkspaceStores = new Map<string, ReturnType<typeof createRuntimeWorkspaceStore>>();
  private runtimeMatrixStores = new Map<string, ReturnType<typeof createRuntimeMatrixStore>>();
  private runtimeStateSuiteStores = new Map<string, ReturnType<typeof createRuntimeStateSuiteStore>>();
  private runtimeStateSuiteBusy: string | undefined;
  private runtimeStateSuiteError: string | undefined;
  private runtimeMatrixError: string | undefined;
  private runtimeMatrixRecovery: {projectId:string;done?:Promise<void>} | undefined;
  private runtimeMatrixTask: { projectId: string; id?: string; executionId?: string; cellId?: string; runId?: string; pendingBeginRevision?: number;
    controller: AbortController; reason?: string; done?: Promise<void>;
    preview?: {matrixId:string;executionId:string;cellId:string;requested:ReplayRequested;phase:"prepare"|"capture";nonce:string;identity:CaptureRuntimeIdentity};
    previewWait?: {resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
  } | undefined;
  private nativeCaptureAvailable = false;
  private runtimeReplayStores = new Map<string, ReturnType<typeof createRuntimeReplayStore>>();
  private runtimeReplayError: string | undefined;
  private runtimeReplayTask: { projectId: string; runId: string; executionId: string; id?: string;
    controller: AbortController; reason?: string; done?: Promise<void> } | undefined;
  private runtimeCaptureStores = new Map<string, { files: ReturnType<typeof createCaptureFileStorage>; store: ReturnType<typeof createRuntimeCaptureStore>; images: Set<string> }>();
  private runtimeSourceHashCache: { projectId: string; root: string; entries: Map<string, { source: string; digest: string }> } | undefined;
  private visualAlternativesSessions = new Map<string, ReturnType<typeof createVisualAlternativesSession>>();
  private visualAlternativesOperation: {key:string;action:string;id?:string;cancelled?:boolean} | undefined;
  private visualAlternativesError: {key:string;message:string} | undefined;
  private visualAlternativesPreviewWait: {key:string;panel:vscode.WebviewPanel;input:AlternativePreview;timer:ReturnType<typeof setTimeout>;resolve:()=>void;reject:(error:Error)=>void} | undefined;
  private reproducibleIssueStores = new Map<string, ReturnType<typeof createReproducibleIssuesStore>>();
  private reproducibleIssueProjection: {key:string;sources:unknown;value:any} | undefined;
  private reproducibleIssueBusy: string | undefined;
  private reproducibleIssueError: {key:string;message:string} | undefined;
  private reproducibleIssueSources: {projectId:string;root:string;epoch:number;hashes:Map<string,string>} | undefined;
  private projectDecisionStores = new Map<string, ReturnType<typeof createProjectDecisionsStore>>();
  private projectDecisionBusy: string | undefined;
  private projectDecisionError: {key:string;message:string} | undefined;
  private projectDecisionSources: {projectId:string;root:string;epoch:number;hashes:Map<string,string>} | undefined;
  private visualVerificationStores = new Map<string, ReturnType<typeof createVisualVerificationStore>>();
  private visualVerificationBusy: {projectId:string;root:string;action:string} | undefined;
  private visualVerificationError: {projectId:string;root:string;message:string} | undefined;
  private visualVerificationSources: {projectId:string;root:string;epoch:number;files:Map<string,ProjectFile>} | undefined;
  private visualVerificationSourceDigests = new WeakMap<ProjectFile,{source:string;revision:string}>();
  private visualVerificationProjectionCache: {key:string;view:any} | undefined;
  private proposalMutationCount = 0;
  private proposalMutationGeneration = 0;
  private runtimeWorkspaceBusy: string | undefined;
  private runtimeWorkspaceError: string | undefined;
  private scenarioCapture: { projectId: string; store: ReturnType<typeof createRuntimeWorkspaceStore>; run: any; seen: Set<string>; observations: any[]; truncated: boolean; ending?: Promise<void> } | undefined;
  private featureFiles: ProjectFile[] = [];
  private featureUnavailable: { path: string; reason: string; kind: "source-unavailable" | "context-limit" }[] = [];
  private featureSourceEpoch = 0;
  private relationshipSnapshot: any = null;
  private relationshipOwner: {projectId: string; root: string; featureId: string; featureRevision: number; anchorPath: string; epoch: number} | undefined;
  private relationshipTrail: string[] = [];
  private relationshipStatus: "idle" | "loading" | "ready" | "stale" | "error" = "idle";
  private relationshipSnapshotId: string | null = null;
  private relationshipMessage = "";
  private relationshipEpoch = 0;
  private continuationGeneration = 0;
  private continuationPrepareId: string | undefined;
  private continuationBinding: { context: any; projectId: string; root: string; featureId: string; featureRevision: number; conversationId: string; epoch: number } | undefined;
  private continuationBusy: {projectId: string; conversationId: string; requestId: string; decisionId: string; attemptId: string; stopped: boolean} | undefined;
  private investigationGeneration = 0;
  private investigationOffer: any;
  private investigationPrepareId: string | undefined;
  private investigationBinding: { result: any; graph: any; projectId: string; root: string; featureId: string;
    featureRevision: number; conversationId: string | null; epoch: number } | undefined;
  private relationshipGeneration = 0;
  private relationshipNavigationGeneration = 0;
  private relationshipTask: Promise<void> | undefined;
  private relationshipLoadKey = "";

  private featureLoadGeneration = 0;
  private featureCacheKey = "";
  private featureLoadKey = "";
  private featureLoadTask: Promise<void> | undefined;
  private featurePreparation: { projectId: string; featureId: string; revision: number; paths: string[] } | undefined;
  private conversationStateTimer: ReturnType<typeof setTimeout> | undefined;
  private conversationHistoryWarnings = new Set<string>();

  constructor(private context: vscode.ExtensionContext) {
    this.diagnosticOutput = vscode.window.createOutputChannel("Foundation");
    this.diagnostics = createStartupDiagnostics(line => this.diagnosticOutput.appendLine(line));
    context.subscriptions.push(this.diagnosticOutput);
    this.service = createProjectService({ root: context.extensionPath });
    this.status = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      25,
    );
    this.status.text = "$(layers) Foundation";
    this.status.command = "foundation.understand";
    this.status.tooltip = "Open the workspace for the selected source file";
    this.status.show();
    context.subscriptions.push(
      this.status,
      this.tree,
      vscode.window.registerTreeDataProvider("foundation.context", this.tree),
    );
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(
        "foundation-snapshot",
        {
          provideTextDocumentContent: (uri) =>
            this.snapshots.get(uri.toString()) ??
            "This session snapshot is no longer available.",
        },
      ),
    );
    this.inlineEdit = new InlineEditController({
      getService: () => this.inlineEditService,
      owner: document => this.editorOwner(document),
    });
    this.codeSuggestions = new CodeSuggestionController({
      getService: () => this.codeSuggestionService,
      owner: document => this.editorOwner(document),
      isBusy: () => this.inlineEdit?.inspect().state !== "idle",
      reviewEdit: input => this.inlineEdit?.previewExternal(input) ?? Promise.resolve(false),
    });
    context.subscriptions.push(this.inlineEdit, this.codeSuggestions);
    this.swiftLanguage = new SwiftLanguageController();
    context.subscriptions.push(this.swiftLanguage);
    this.xcodeProject = new XcodeProjectController({ extensionUri: context.extensionUri, swift: this.swiftLanguage });
    context.subscriptions.push(this.xcodeProject);
    this.platformSetup = new PlatformSetupController({ extensionUri: context.extensionUri });
    context.subscriptions.push(this.platformSetup);
    this.registerCommands();
    // Registration must precede asynchronous activation. Code OSS owns tab,
    // group and focus restoration, and revives hidden tabs only when needed.
    context.subscriptions.push(vscode.window.registerWebviewPanelSerializer("foundation.workspace", {
      deserializeWebviewPanel: async (panel, state) => { this.adoptWorkspacePanel(panel, state); },
    }));
    this.registerAssistantView();
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document.uri.scheme === "file") this.followEditor(editor);
      }),
    );
    context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor &&
          event.textEditor.document.uri.scheme === "file")
          this.followEditor(event.textEditor);
      }),
    );
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => this.editorDocumentChanged(event.document)),
    );
    context.subscriptions.push(
      vscode.workspace.onWillSaveTextDocument((event) => {
        if (
          !this.project ||
          !vscode.workspace.isTrusted ||
          event.document.uri.scheme !== "file"
        )
          return;
        const project = this.project;
        const path = relativeSourcePath(
          project.root,
          event.document.uri.fsPath,
        );
        if (!path) return;
        event.waitUntil(
          (async () => {
            try {
              const before = await this.service.getFile(project.id, path);
              this.pendingSaves.set(`${project.root}\0${path}`, before);
            } catch {
              /* Unsupported or ignored source is not indexed. */
            }
            return [];
          })(),
        );
      }),
    );
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.relevantSource(document.uri);
        void this.recordSave(document).catch(() => this.queueRefresh());
      }),
    );
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.stopExecutions();
        this.codeSuggestions?.stop();
        void this.inlineEdit?.dismiss();
        this.cancelQuestion();
        this.queueRefresh();
      }),
    );
    context.subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.queueRefresh()),
    );
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("foundation.ai") && !this.configuringProvider)
          void this.configureService().then(() => this.sendState());
      }),
    );
    const watcher = vscode.workspace.createFileSystemWatcher(
      "**/*",
    );
    context.subscriptions.push(
      watcher,
      watcher.onDidChange((uri) => {
        if (this.relevantSource(uri))
          this.queueRefresh();
      }),
      watcher.onDidDelete((uri) => {
        if (this.relevantSource(uri))
          this.queueRefresh();
      }),
    );
    if (watcher.onDidCreate) context.subscriptions.push(watcher.onDidCreate(uri => {
      if (this.relevantSource(uri)) this.queueRefresh();
    }));
  }

  async start() {
    this.nativeCaptureAvailable = (await vscode.commands.getCommands(false)).includes("_foundation.captureActiveCanvas");
    await this.configureService();
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.scheme === "file") this.followEditor(editor, false);
    await this.refresh();
    const preference = vscode.workspace
      .getConfiguration("foundation")
      .inspect<boolean>("openOnStartup");
    if (!this.disposed && (preference?.globalValue ?? true) && !this.panel && !this.restoredWorkspaceTab() &&
      this.context.workspaceState.get("foundation.workspaceOpened") !== true) {
      this.createWorkspacePanel("Understand", vscode.ViewColumn.One, true);
    }
  }

  private registerCommands() {
    const register = (id: string, callback: (...args: any[]) => unknown) =>
      this.context.subscriptions.push(
        vscode.commands.registerCommand(id, callback),
      );
    register("foundation.xcodeProject", () => this.xcodeProject?.open());
    register("foundation.stopSwiftLanguage", () => this.swiftLanguage?.stop());
    register("foundation.projectSetup", () => this.platformSetup?.open());
    register("foundation.understand", () => this.show("Understand"));
    register("foundation.knowledge", () => this.showKnowledge());
    register("foundation.refine", () => this.show("Refine"));
    register("foundation.review", () => {
      this.show("Review");
      void this.refresh();
    });
    register("foundation.askAI", () => this.show("Assistant"));
    register("foundation.editSelection", () => { this.codeSuggestions?.interrupt(); return this.inlineEdit?.start(); });
    register("foundation.startCodeSuggestions", () => this.codeSuggestions?.start());
    register("foundation.stopCodeSuggestions", () => this.codeSuggestions?.stop());
    register("foundation.requestCodeSuggestion", () => this.codeSuggestions?.request());
    register("foundation.reviewNextEdit", () => this.codeSuggestions?.reviewNextEdit());
    register("foundation.dismissNextEdit", () => this.codeSuggestions?.dismissNextEdit());
    register("foundation.codeSuggestionAccepted", (id: string) => this.codeSuggestions?.accepted(id));
    register("foundation.reviewInlineEdit", () => this.inlineEdit?.review());
    register("foundation.acceptInlineEdit", () => this.inlineEdit?.accept());
    register("foundation.dismissInlineEdit", () => this.inlineEdit?.dismiss(true));
    register("foundation.cancelInlineEdit", () => this.inlineEdit?.dismiss(true));
    register("foundation.toggleAssistant", () => this.assistantOpen
      ? this.collapseAssistant() : this.showAssistant());
    register("foundation.collapseAssistant", () => this.collapseAssistant());
    register("foundation.newConversation", async () => {
      await this.conversationAction({ action: "new", projectId: this.project?.id });
      await this.showAssistant();
    });
    register("foundation.focusWorkspace", () => vscode.commands.executeCommand("workbench.action.toggleMaximizeEditorGroup"));
    register("foundation.build", async () => {
      if (this.lastDocument)
        await vscode.window.showTextDocument(this.lastDocument, {
          viewColumn: this.sourceColumn(),
          preserveFocus: false,
        });
      else await vscode.commands.executeCommand("workbench.action.quickOpen");
    });
    register("foundation.openProject", async () => {
      const folders = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: "Open a project folder",
        openLabel: "Open Folder",
      });
      if (folders?.[0])
        await vscode.commands.executeCommand("vscode.openFolder", folders[0], {
          forceNewWindow: false,
        });
    });
    register("foundation.manageTrust", () =>
      vscode.commands.executeCommand("workbench.trust.manage"),
    );
    register("foundation.configureAI", () => this.configureProvider());
    register("foundation.clearAIKey", async () => {
      await this.context.secrets.delete(this.providerSettings().keyName);
      await this.configureService();
      this.sendState();
      void vscode.window.showInformationMessage(
        "Saved AI key removed.",
      );
    });
    register("foundation.refresh", () => { this.featureSourceEpoch = (this.featureSourceEpoch || 0) + 1; this.featureCacheKey = ""; this.invalidateRelationships(); this.invalidateDesignImpact(); return this.refresh(); });
    register("foundation.newFeature", async (input?: any) => {
      const project = this.project;
      if (!project || !vscode.workspace.isTrusted) throw new Error("Open and trust a project before creating a feature.");
      const snapshot = this.features().snapshot();
      const title = input?.title ?? await vscode.window.showInputBox({ title: "New feature", prompt: "Name the feature you are working on.", ignoreFocusOut: true,
        validateInput: value => value.trim() && value.trim().length <= 80 ? undefined : "Enter a name up to 80 characters." });
      if (title === undefined) return;
      const paths = input?.paths ?? (this.activeFile ? [this.activeFile.path] : []);
      const result = await this.featureAction({ action: "create", projectId: project.id, expectedRevision: snapshot.revision,
        input: { title, brief: input?.brief || "", paths, entryPath: input?.entryPath ?? paths[0] } });
      if (this.project?.id === project.id) this.show("Understand");
      return result;
    });
    register("foundation.selectFeature", async (id?: string | null) => {
      if (!this.project || !vscode.workspace.isTrusted) throw new Error("Open a trusted project first.");
      const projectId = this.project.id, snapshot = this.features().snapshot();
      if (id === undefined) {
        const choice = await vscode.window.showQuickPick([{ label: "All source", id: null as string | null },
          ...snapshot.features.filter(feature => !feature.archived).map(feature => ({ label: feature.title, description: `${feature.paths.length} files`, id: feature.id }))],
          { title: "Select feature", placeHolder: "Choose a saved working set" });
        if (!choice) return; id = choice.id;
      }
      return this.featureAction({ action: "select", projectId, expectedRevision: snapshot.revision, id });
    });
    register("foundation.prepareFeatureContext", () => {
      const snapshot = this.featureSnapshot();
      return this.featureAction({ action: "prepare", projectId: this.project?.id, expectedRevision: snapshot?.revision, id: snapshot?.activeId });
    });
    register("foundation.openFeatureEntry", async () => {
      const snapshot = this.featureSnapshot();
      const active = snapshot?.features.find(feature => feature.id === snapshot.activeId && !feature.archived);
      if (!active?.entryPath) throw new Error("Choose a primary file in the feature workspace.");
      await this.navigate(active.entryPath, 1);
    });
    register("foundation.openFeatureScreen", async () => {
      const state = this.runtimeWorkspaceSnapshot(), featureId = this.featureSnapshot()?.activeId;
      const screens = state?.screens.filter(screen => !screen.archived && screen.featureId === featureId) || [];
      if (!screens.length) throw new Error("Add a runtime screen to the selected feature in Understand.");
      const choice = await vscode.window.showQuickPick(screens.map(screen => ({ label: screen.title, description: screen.route, id: screen.id })),
        { title: "Open feature screen", placeHolder: "Choose a named screen" });
      if (choice) return this.runtimeWorkspaceAction({ action: "openScreen", projectId: state!.projectId, expectedRevision: state!.revision, screenId: choice.id });
    });
    register("foundation.observeFeatureScenario", async () => {
      const state = this.runtimeWorkspaceSnapshot(), featureId = this.featureSnapshot()?.activeId;
      const screens = state?.screens.filter(screen => !screen.archived && screen.featureId === featureId) || [];
      const scenarios = state?.scenarios.filter(scenario => !scenario.archived && screens.some(screen => screen.id === scenario.screenId)) || [];
      if (!scenarios.length) throw new Error("Add a manual scenario to a runtime screen in Understand.");
      const choice = await vscode.window.showQuickPick(scenarios.map(scenario => ({ label: scenario.title,
        description: screens.find(screen => screen.id === scenario.screenId)?.title, id: scenario.id })),
        { title: "Observe feature scenario", placeHolder: "Open its screen first, then begin a manual observation" });
      if (choice) {
        const scenario = scenarios.find(item => item.id === choice.id)!;
        const selected = await this.runtimeWorkspaceAction({ action: "select", projectId: state!.projectId, expectedRevision: state!.revision,
          screenId: scenario.screenId, scenarioId: scenario.id });
        return this.runtimeWorkspaceAction({ action: "beginRun", projectId: state!.projectId, expectedRevision: selected!.revision, scenarioId: choice.id });
      }
    });
    register("foundation.runtimeWorkspace", (message: any) => this.runtimeWorkspaceAction(message));
    register("foundation.visualAlternatives", (message: any) => this.visualAlternativesAction(message));
    register("foundation.visualVerification", (message: any) => this.visualVerificationAction(message));
    register("foundation.runtimeReplay", (message: any) => this.runtimeReplayAction(message));
    register("foundation.runtimeMatrix", (message: any) => this.runtimeMatrixAction(message));
    register("foundation.runtimeStateSuite", (message: any) => this.runtimeStateSuiteAction(message));
    register("foundation.startRunningProject", async (targetId?: string) => {
      if (targetId) { this.show("Refine"); return this.runtimeAction({ action: "start", targetId }); }
      const runtime = await this.ensureRuntime();
      const targets = await runtime.discover();
      const selected = await vscode.window.showQuickPick(targets.map((target: any) => ({
        label: target.label, description: target.commandLabel, detail: target.reason, targetId: target.id,
      })), { title: "Start running project", placeHolder: "Choose an instrumented Vite target" });
      if (selected) { this.show("Refine"); await this.runtimeAction({ action: "start", targetId: selected.targetId }); }
    });
    register("foundation.connectRunningProject", async (targetUrl?: string) => {
      const url = targetUrl || await vscode.window.showInputBox({ title: "Connect running project", prompt: "Local Vite URL with Foundation instrumentation enabled.", placeHolder: "http://127.0.0.1:5173", ignoreFocusOut: true });
      if (url) { this.show("Refine"); return this.runtimeAction({ action: "connect", url }); }
    });
    register("foundation.stopRunningProject", () => this.runtimeAction({ action: "stop" }));
    register("foundation.runtimeSetup", async () => {
      const plugin = join(this.context.extensionPath, "dist", "connected-vite-plugin.mjs");
      const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: `# Connect a running Vite project

Enable this development-only plugin in your Vite configuration, then restart the dev server. Review the configuration change before saving. Foundation does not change your project automatically.

\`\`\`js
import { foundationRuntime } from ${JSON.stringify(plugin)};

export default {
  plugins: [foundationRuntime()],
};
\`\`\`

Keep your existing plugins and configuration. Start the project from Refine, or connect its local URL. Only the open trusted project can connect. The saved-source sandbox remains available without instrumentation.

This adapter records source mappings and sanitized request metadata. It does not collect response bodies, credentials, or backend internals.
` });
      await vscode.window.showTextDocument(doc, { preview: true });
    });
    register("foundation.showDiagnostics", () => this.diagnosticOutput.show());
    register("foundation.startDesignPreview", (entry?: string) => this.startDesignPreview(entry));
    register("foundation.designImpact", (message: any) => this.designImpactAction(message));
    register("foundation.proposeTokenChange", (input: any) => this.proposeTokenChange(input));
    register("foundation.applyProposal", (id: string) => this.changeProposal("apply", id));
    register("foundation.undoProposal", (id: string) => this.changeProposal("undo", id));
    register("foundation.openSource", (path: string, line?: number) =>
      this.navigate(path, line),
    );
    register("foundation.reviewFile", (path: string) => this.reviewFile(path));
    register("foundation.openTerminal", () =>
      vscode.commands.executeCommand(
        "workbench.action.terminal.toggleTerminal",
      ),
    );
    register("foundation.openSearch", () =>
      vscode.commands.executeCommand("workbench.view.search"),
    );
    register("foundation.openDebug", () =>
      vscode.commands.executeCommand("workbench.view.debug"),
    );
    register("foundation.openGit", () =>
      vscode.commands.executeCommand("workbench.view.scm"),
    );
  }

  private editorOwner(document: vscode.TextDocument) {
    if (this.disposed || !vscode.workspace.isTrusted || !this.project || document.uri.scheme !== "file") return undefined;
    const path = relativeSourcePath(this.project.root, document.uri.fsPath);
    if (!path || !this.project.files.some(file => file.path === path)) return undefined;
    return { key: `${this.project.id}\0${this.project.root}\0${this.configurationGeneration}`, path };
  }

  private providerSettings() {
    const settings = vscode.workspace.getConfiguration("foundation.ai");
    const selected = settings.inspect<string>("providerKind")?.globalValue;
    const providerKind = selected || process.env.FOUNDATION_AI_PROVIDER_KIND || "compatible";
    const profiles = settings.inspect<Record<string, { baseUrl?: string; model?: string }>>("profiles")?.globalValue || {};
    const profile = selected ? profiles[providerKind] : undefined;
    const legacyBase = !selected && providerKind === "compatible" ? settings.inspect<string>("baseUrl")?.globalValue : undefined;
    const legacyModel = !selected && providerKind === "compatible" ? settings.inspect<string>("model")?.globalValue : undefined;
    const environmentOnly = !selected && !legacyBase && !legacyModel;
    const baseUrl = profile?.baseUrl || legacyBase || (environmentOnly ? process.env.FOUNDATION_AI_BASE_URL : undefined) ||
      (providerKind === "openai" ? "https://api.openai.com/v1" : providerKind === "anthropic" ? "https://api.anthropic.com/v1" : undefined);
    const model = profile?.model || legacyModel || (environmentOnly ? process.env.FOUNDATION_AI_MODEL : undefined);
    const keyName = !selected && !environmentOnly ? KEY_NAME : `${KEY_NAME}.${providerKind}.${createHash("sha256").update(baseUrl || "").digest("hex").slice(0, 16)}`;
    return { settings, providerKind, baseUrl, model, keyName, environmentOnly };
  }

  private async configureService() {
    const configurationGeneration = ++this.configurationGeneration;
    this.codeSuggestions?.stop();
    this.codeSuggestionService = undefined;
    void this.inlineEdit?.dismiss();
    this.inlineEditService = undefined;
    this.cancelQuestion();
    const closing = this.bridge;
    this.bridge = undefined;
    await closing?.close();
    const selected = this.providerSettings();
    const apiKey = ["openai", "anthropic", "compatible"].includes(selected.providerKind) ? await resolveProviderKey({
      baseUrl: selected.baseUrl, model: selected.model,
      environmentKey: selected.environmentOnly ? process.env.FOUNDATION_AI_API_KEY : undefined,
      environmentOnly: selected.environmentOnly,
      readStoredKey: () => this.context.secrets.get(selected.keyName),
    }) : undefined;
    if (configurationGeneration !== this.configurationGeneration || this.disposed) return;
    this.codeSuggestionService = createCodeSuggestionService({
      config: { providerKind: selected.providerKind, baseUrl: selected.baseUrl, model: selected.model, apiKey },
    });
    this.inlineEditService = createInlineEditService({
      config: { providerKind: selected.providerKind, baseUrl: selected.baseUrl, model: selected.model, apiKey },
    });
    this.assistant = createAssistantService({
      projectService: this.service,
      config: { providerKind: selected.providerKind, baseUrl: selected.baseUrl, model: selected.model, apiKey },
      resolveAlternativeGeneration: (projectId:string,input:any) => this.resolveProviderAlternativeGeneration(projectId,input),
      resolveIssueContext: (projectId:string,input:any) => this.resolveIssueContext(input,projectId),
      resolveDecisionContext: (projectId:string,input:any) => this.resolveDecisionContext(input,projectId),
      resolveRuntimeEvidence: (input: any) => this.resolveRuntimeEvidence(input),
      resolveGroupRevision: (input: any) => this.resolveProviderGroupRevision(input),
      resolveCheckContext: (input: any) => this.resolveProviderCheckContext(input),
      resolveSourceInvestigation: (input: any) => this.resolveProviderSourceInvestigation(input),
      resolveInvestigationContinuation: (input: any) => this.resolveProviderInvestigationContinuation(input),
    });
  }

  private async configureProvider() {
    const current = this.providerSettings();
    const choice = await vscode.window.showQuickPick([
      { label: "OpenAI", description: "Responses API", providerKind: "openai" },
      { label: "Anthropic", description: "Messages API", providerKind: "anthropic" },
      { label: "OpenAI-compatible", description: "Custom or local Chat Completions endpoint", providerKind: "compatible" },
    ], { title: "Set up AI · Choose provider", placeHolder: "Use your own API key. Nothing is sent during setup." });
    if (!choice) return;
    const settings = current.settings;
    const profiles = settings.inspect<Record<string, { baseUrl?: string; model?: string }>>("profiles")?.globalValue || {};
    const prior = profiles[choice.providerKind] || (current.providerKind === choice.providerKind ? current : {});
    let baseUrl = choice.providerKind === "openai" ? "https://api.openai.com/v1" : choice.providerKind === "anthropic" ? "https://api.anthropic.com/v1" : prior.baseUrl || "";
    if (choice.providerKind === "compatible") {
      const input = await vscode.window.showInputBox({ title: "Set up AI · Provider URL", prompt: "Chat Completions API base URL.", placeHolder: "http://localhost:11434/v1", value: baseUrl, ignoreFocusOut: true,
        validateInput: (value) => {
          try { const url = new URL(value); if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error(); }
          catch { return "Use HTTPS, or HTTP on localhost, without embedded credentials or query parameters."; }
          return undefined;
        } });
      if (input === undefined) return;
      baseUrl = input;
    }
    const model = await vscode.window.showInputBox({ title: `Set up ${choice.label} · Model`, prompt: "Model ID from your provider. Choose a model that supports text generation.", value: prior.model || "", ignoreFocusOut: true,
      validateInput: (value) => value.trim() && value.length <= 200 && !/[\r\n]/.test(value) ? undefined : "Enter a model identifier." });
    if (model === undefined) return;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname);
    const apiKey = await vscode.window.showInputBox({ title: `Set up ${choice.label} · API key`, prompt: local ? "Optional for a local provider. Leave blank to remove this destination’s saved key." : "Stored in your computer’s credential store for this provider. API usage is billed separately.", password: true, ignoreFocusOut: true,
      validateInput: (value) => !local && !value.trim() ? "Enter your provider’s API key." : /[\r\n]/.test(value) ? "The key must be one line." : undefined });
    if (apiKey === undefined) return;
    const keyName = `${KEY_NAME}.${choice.providerKind}.${createHash("sha256").update(baseUrl).digest("hex").slice(0, 16)}`;
    this.configuringProvider = true;
    try {
      if (apiKey.trim()) await this.context.secrets.store(keyName, apiKey.trim());
      else await this.context.secrets.delete(keyName);
      await settings.update("profiles", { ...profiles, [choice.providerKind]: { baseUrl, model: model.trim() } }, vscode.ConfigurationTarget.Global);
      await settings.update("providerKind", choice.providerKind, vscode.ConfigurationTarget.Global);
    } finally { this.configuringProvider = false; }
    await this.configureService(); this.sendState();
    void vscode.window.showInformationMessage("AI settings saved. The provider will be checked when you send a message.");
  }

  // Native editor focus is independent of retained webview focus. Caret movement
  // updates ownership immediately, but does not invalidate or re-index saved code.
  private followEditor(editor: vscode.TextEditor, refresh = true) {
    if (this.disposed) return;
    this.focusGeneration++;
    const sourceChanged = this.lastDocument?.toString() !== editor.document.uri.toString();
    if (sourceChanged) this.generation++;
    this.lastDocument = editor.document.uri;
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    const path = folder && relativeSourcePath(folder.uri.fsPath, editor.document.uri.fsPath);
    const sameSnapshot = this.project?.root === folder?.uri.fsPath && this.activeFile?.path === path;
    const previous = this.focus;
    this.focus = path ? {
      path, line: editor.selection.start.line + 1, endLine: editor.selection.end.line + 1,
      label: basename(path), origin: "source",
      revision: sameSnapshot ? this.activeFile?.revision : undefined,
    } : null;
    if (sameSnapshot) {
      if (sourceChanged || previous?.origin !== "source" || previous.path !== path) {
        this.persistFocus();
        this.sendState();
      } else if (previous.line !== this.focus!.line || previous.endLine !== this.focus!.endLine ||
          previous.revision !== this.focus!.revision) this.queueEditorState();
    }
    if (refresh && (sourceChanged || !sameSnapshot)) this.queueRefresh();
  }

  private queueEditorState() {
    if (this.disposed || this.editorStateTimer || !this.project) return;
    // A bounded presentation cadence does not delay source ownership or action
    // guards. Continuous caret movement still publishes the latest location.
    const owner = this.editorStateOwner = { id: this.project.id, root: this.project.root };
    this.editorStateTimer = setTimeout(() => {
      this.editorStateTimer = undefined;
      this.editorStateOwner = undefined;
      if (this.disposed || this.project?.id !== owner.id || this.project?.root !== owner.root) return;
      this.persistFocus();
      this.sendState();
    }, 100);
  }

  private flushEditorFocus() {
    if (!this.editorStateTimer) return;
    clearTimeout(this.editorStateTimer);
    this.editorStateTimer = undefined;
    const owner = this.editorStateOwner;
    this.editorStateOwner = undefined;
    if (owner && this.project?.id === owner.id && this.project.root === owner.root) this.persistFocus();
  }

  private editorDocumentChanged(document: vscode.TextDocument) {
    if (this.disposed || !this.project || document.uri.scheme !== "file" ||
        !relativeSourcePath(this.project.root, document.uri.fsPath)) return;
    // Saved evidence only changes when dirty membership changes. Draft bytes
    // never enter this payload; typing within an already dirty file adds nothing.
    // Read live dirty state in action guards as before, including during a burst.
    const dirtyKey = JSON.stringify(this.dirtyPaths());
    if (dirtyKey !== this.sentDirtyPathsKey) this.sendState();
  }

  private persistFocus() {
    if (!this.project || !this.focus || this.activeFile?.path !== this.focus.path) return;
    // Only source location survives a restart. A previous runtime session and
    // measurements are never restored as if they were fresh observations.
    try {
      const write = Promise.resolve(this.context.workspaceState.update(`foundation.focus.${this.project.id}`, {
        version: 1, path: this.focus.path, line: this.focus.line, endLine: this.focus.endLine,
        revision: this.activeFile.revision,
      })).catch(() => {});
      // Shutdown waits for pending location writes, including a final coalesced
      // caret. A storage failure must never prevent cleanup or preserve a timer.
      this.focusPersistence = Promise.all([this.focusPersistence, write]).then(() => {});
    } catch { /* Source editing stays available when location storage fails. */ }
  }

  private restoredFocus(project: ProjectSnapshot): WorkspaceFocus | null {
    const saved = this.context.workspaceState.get<any>(`foundation.focus.${project.id}`);
    if (!saved || saved.version !== 1 || !validSourcePath(saved.path) ||
      !project.files.some(file => file.path === saved.path)) return null;
    return { path: saved.path, line: validLine(saved.line), endLine: validLine(saved.endLine),
      revision: typeof saved.revision === "string" ? saved.revision : undefined,
      label: basename(saved.path), origin: "source" };
  }

  private workspaceLayout() {
    const saved = this.project
      ? this.context.workspaceState.get<any>(`foundation.layout.${this.project.id}`)
      : undefined;
    const width = saved?.version === 1 && typeof saved.inspectorWidth === "number" && Number.isFinite(saved.inspectorWidth)
      ? saved.inspectorWidth : 320;
    return { inspectorWidth: Math.min(480, Math.max(280, Math.round(width / 4) * 4)) };
  }

  private async saveWorkspaceLayout(message: any) {
    const project = this.project;
    if (!vscode.workspace.isTrusted || !project || message.projectId !== project.id ||
      typeof message.width !== "number" || !Number.isFinite(message.width)) return;
    const inspectorWidth = Math.min(480, Math.max(280, Math.round(message.width / 4) * 4));
    await this.context.workspaceState.update(`foundation.layout.${project.id}`, {
      version: 1, inspectorWidth,
    });
    // Storage belongs to the captured project. A delayed completion never
    // applies the old geometry to a different current workspace.
    if (this.project?.id === project.id) this.sendState();
  }

  private sourceColumn(): vscode.ViewColumn {
    const panelColumn = this.panel?.viewColumn;
    if (!panelColumn) return vscode.ViewColumn.Active;
    // Reuse an existing neighboring source group. If Foundation is the sole
    // group, create one beside it instead of replacing its visible workspace.
    return vscode.window.visibleTextEditors.find(editor => editor.viewColumn && editor.viewColumn !== panelColumn)?.viewColumn ||
      vscode.window.tabGroups.all.find(group => group.viewColumn !== panelColumn)?.viewColumn ||
      (panelColumn + 1 as vscode.ViewColumn);
  }

  private queueRefresh() {
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.contextTimer = setTimeout(() => {
      this.contextTimer = undefined;
      void this.refresh();
    }, 250);
  }

  private relevantSource(uri: vscode.Uri) {
    const relationshipsChanged = this.relationshipSourceChanged(uri);
    const impactChanged = this.designImpactSourceChanged(uri);
    if (uri.toString() === this.lastDocument?.toString()) { this.interruptRuntimeReplay("source-changed"); this.featureSourceEpoch = (this.featureSourceEpoch || 0) + 1; this.featureCacheKey = ""; return true; }
    if (!this.project) return false;
    const path = relativeSourcePath(this.project.root, uri.fsPath);
    const feature = this.featureSnapshot();
    if (feature?.features.some(item => item.id === feature.activeId && item.paths.includes(path || "")) ||
      this.assistantContextRestore?.paths.includes(path || "") || this.artifactSourceOwner?.paths.includes(path || "")) {
      this.interruptRuntimeReplay("source-changed"); this.featureSourceEpoch = (this.featureSourceEpoch || 0) + 1;
      this.featureCacheKey = "";
      return true;
    }
    const verificationSourceChanged = path && this.visualVerificationSources?.projectId === this.project.id &&
      this.visualVerificationSources.root === this.project.root && this.visualVerificationSources.files.has(path);
    const decisionSourceChanged=path && this.projectDecisionSources?.projectId===this.project.id && this.projectDecisionSources.hashes.has(path);
    const issueSourceChanged=path && this.reproducibleIssueSources?.projectId===this.project.id && this.reproducibleIssueSources.hashes.has(path);
    const relevant = issueSourceChanged || decisionSourceChanged || relationshipsChanged || impactChanged || verificationSourceChanged || (path && basename(path) === ".gitignore") || this.runtime?.snapshot().files?.some((file: any) => file.path === path) ||
      this.design.files?.some((file: any) => file.path === path) ||
      this.proposals().current()?.context?.some((file: any) => file.path === path) ||
      this.changeSetSnapshot()?.current?.context?.some((file: any) => file.path === path);
    if (relevant) { this.interruptRuntimeReplay("source-changed"); this.featureSourceEpoch = (this.featureSourceEpoch || 0) + 1; this.featureCacheKey = ""; }
    return Boolean(relevant);
  }

  async refresh() {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.error = undefined;
    if (!vscode.workspace.isTrusted) {
      this.codeSuggestions?.stop();
      void this.inlineEdit?.dismiss();
      this.cancelQuestion();
      await this.stopExecutions();
      await this.resetRuntime();
      this.clearFeatureView();
      this.clearAssistantContext();
      this.clearRelationships();
      this.invalidateDesignImpact(true);
      this.project = null;
      this.activeFile = null;
      this.openFiles = [];
      this.focus = null;
      this.focusGeneration++;
      this.updateTree();
      this.sendState();
      return;
    }
    const folder =
      (this.lastDocument &&
        vscode.workspace.getWorkspaceFolder(this.lastDocument)) ||
      vscode.workspace.workspaceFolders?.find(
        (item) => item.uri.scheme === "file",
      );
    if (!folder || folder.uri.scheme !== "file") {
      this.codeSuggestions?.stop();
      void this.inlineEdit?.dismiss();
      await this.stopExecutions();
      await this.resetRuntime();
      this.clearFeatureView();
      this.clearAssistantContext();
      this.clearRelationships();
      this.invalidateDesignImpact(true);
      this.project = null;
      this.activeFile = null;
      this.openFiles = [];
      this.focus = null;
      this.focusGeneration++;
      this.updateTree();
      this.sendState();
      return;
    }
    this.status.text = "$(sync~spin) Foundation";
    try {
      const changingProject = this.project?.root !== folder.uri.fsPath;
      if (changingProject) {
        this.codeSuggestions?.stop();
        void this.inlineEdit?.dismiss();
        await this.stopExecutions();
        this.cancelQuestion();
        await this.resetRuntime();
        this.clearFeatureView();
        this.clearAssistantContext();
        this.clearRelationships();
        this.invalidateDesignImpact(true);
        this.focusGeneration++;
        this.designGeneration++;
        this.design = { status: "idle", compilation: "not-run", observed: false, tokens: [] };
        this.sentDesignSession = undefined;
        this.project = null;
        this.activeFile = null;
        this.openFiles = [];
        this.sendState();
      }
      const project: ProjectSnapshot = changingProject
        ? await this.diagnostics.runAsync("project-open", () => this.service.open(folder.uri.fsPath))
        : await this.diagnostics.runAsync("project-snapshot", () => this.service.snapshot());
      if (generation !== this.generation || this.disposed) return;
      this.project = project;
      if (
        !this.lastDocument ||
        !relativeSourcePath(project.root, this.lastDocument.fsPath)
      ) {
        const restored = this.restoredFocus(project);
        const first = restored ||
          project.files.find(
            (file) => file.path === "src/components/SaveButton.tsx",
          ) ||
          project.files.find((file) => /\.(tsx?|jsx?)$/.test(file.path)) ||
          project.files[0];
        this.lastDocument = first
          ? vscode.Uri.file(join(project.root, first.path))
          : undefined;
        this.focus = restored;
      }
      const selectedPath =
        this.lastDocument &&
        relativeSourcePath(project.root, this.lastDocument.fsPath);
      const openPaths = [
        selectedPath,
        ...vscode.workspace.textDocuments
          .filter(document => !document.isClosed && document.uri.scheme === "file")
          .map(document => relativeSourcePath(project.root, document.uri.fsPath)),
      ].filter((path, index, paths) => path && paths.indexOf(path) === index).slice(0, 8) as string[];
      const epoch = this.featureSourceEpoch || 0;
      const current = () => generation === this.generation && !this.disposed && vscode.workspace.isTrusted &&
        this.project?.id === project.id && this.project?.root === project.root && (this.featureSourceEpoch || 0) === epoch;
      const feature = this.featureSnapshot();
      const activeFeature = feature?.features.find(item => item.id === feature.activeId && !item.archived);
      const contextOwner = this.assistantContextRestore;
      const contextPaths = contextOwner && this.assistantContextOwnerMatches(contextOwner) ? contextOwner.paths.filter(path => project.files.some(file => file.path === path)) : [];
      const design = this.design;
      const sources = await this.readDisplaySources(project, [
        ...openPaths, ...(activeFeature?.paths || []), ...contextPaths,
        ...(design.files || []).map((file: { path: string }) => file.path),
      ], current);
      if (!current()) return;
      const selected = selectedPath ? sources.files.get(selectedPath) || null : null;
      if (selectedPath && !selected) this.error = sources.unavailable.get(selectedPath)?.message || "This source cannot be indexed.";
      const openFiles = openPaths.flatMap(path => sources.files.has(path) ? [sources.files.get(path)!] : []);
      if (generation !== this.generation || this.disposed) return;
      this.activeFile = selected;
      this.openFiles = openFiles;
      if (selected) {
        if (this.focus?.path !== selected.path) this.focus = {
          path: selected.path, line: 1, endLine: 1, label: basename(selected.path), origin: "source",
        };
        if (this.focus!.origin === "source") {
          const editor = vscode.window.activeTextEditor;
          const liveCaret = editor?.document.uri.toString() === this.lastDocument?.toString();
          // Saved line positions only survive if they still identify the same
          // revision. A live editor caret remains authoritative for its draft.
          const sameRevision = !this.focus!.revision || this.focus!.revision === selected.revision;
          const maxLine = selected.source.split("\n").length;
          this.focus = { ...this.focus!, revision: selected.revision,
            line: liveCaret ? editor!.selection.start.line + 1 : sameRevision ? Math.min(maxLine, validLine(this.focus!.line)) : 1,
            endLine: liveCaret ? editor!.selection.end.line + 1 : sameRevision ? Math.min(maxLine, validLine(this.focus!.endLine)) : 1 };
        }
        this.persistFocus();
      } else this.focus = null;
      if (this.design === design && design.files?.some((item: { path: string; revision: string }) => sources.files.get(item.path)?.revision !== item.revision))
        this.design.stale = true;
      if (!current()) return;
      await this.loadFeatureFiles(sources);
      void this.loadRelationships();
      await this.refreshAssistantContext(sources);
      await this.reconcileScenarioRun();
      if (generation !== this.generation || this.disposed) return;
      await this.proposals().assess();
      await this.loadChangeSets();
      await this.loadExecutions();
      if (this.project && vscode.workspace.isTrusted && (this.context?.storageUri || this.context?.globalStorageUri)) await this.alternativesSession().load();
      await this.refreshProjectDecisions();
      await this.refreshReproducibleIssues();
      if (generation !== this.generation || this.disposed) return;
      this.updateTree();
      this.sendState();
    } catch (error) {
      if ((error as { code?: string })?.code === "source-batch-cancelled") return;
      if (generation === this.generation) {
        this.error =
          error instanceof Error
            ? error.message
            : "Foundation could not read this workspace.";
        this.activeFile = null;
        this.openFiles = [];
        this.sendState();
      }
    } finally {
      if (generation === this.generation)
        this.status.text = "$(layers) Foundation";
    }
  }

  private async readDisplaySources(project: ProjectSnapshot, paths: string[], current: () => boolean, previous?: DisplaySources): Promise<DisplaySources> {
    const requested = [...new Set(paths)];
    if (previous && previous.projectId === project.id && previous.root === project.root &&
      previous.epoch === (this.featureSourceEpoch || 0) && previous.current() && current() &&
      requested.every(path => previous.paths.has(path))) return previous;
    const epoch = this.featureSourceEpoch || 0;
    const stillCurrent = () => current() && (this.featureSourceEpoch || 0) === epoch;
    const result = await this.service.getFiles(project.id, requested, { isCurrent: stillCurrent });
    if (stillCurrent()) {
      const previous = this.visualVerificationSources;
      const files = previous?.projectId === project.id && previous.root === project.root && previous.epoch === epoch ? new Map(previous.files) : new Map<string,ProjectFile>();
      for (const path of requested) files.delete(path);
      for (const file of result.files as ProjectFile[]) files.set(file.path, file);
      // Display relevance uses only recently loaded saved buffers; it never scans the project.
      while (files.size > 40) files.delete(files.keys().next().value!);
      this.visualVerificationSources = {projectId:project.id,root:project.root,epoch,files};
    }
    return { projectId: project.id, root: project.root, epoch, paths: new Set(requested), current: stillCurrent,
      files: new Map(result.files.map((file: ProjectFile) => [file.path, file])),
      unavailable: new Map(result.unavailable.map((item: { path: string; code: string; message: string }) => [item.path, item])) };
  }

  private assistantContextOwnerMatches(owner: NonNullable<FoundationHost["assistantContextRestore"]>) {
    return !this.disposed && vscode.workspace.isTrusted && this.project?.id === owner.projectId &&
      (this.featureSnapshot()?.activeId ?? null) === owner.featureId &&
      (this.conversationPresentation().snapshot.activeId ?? null) === owner.conversationId;
  }

  private currentAssistantContextFiles() {
    const owner = this.assistantContextRestore;
    return owner && this.assistantContextOwnerMatches(owner) && this.assistantContextEpoch === (this.featureSourceEpoch || 0)
      ? this.assistantContextFiles || [] : [];
  }

  private clearAssistantContext() {
    this.assistantRestoreGeneration = (this.assistantRestoreGeneration || 0) + 1;
    this.assistantContextRestore = undefined;
    this.assistantContextFiles = [];
    this.assistantContextEpoch = -1;
  }

  private async refreshAssistantContext(sources?: DisplaySources) {
    const owner = this.assistantContextRestore;
    if (owner && this.assistantContextOwnerMatches(owner) && (sources || this.assistantContextEpoch !== (this.featureSourceEpoch || 0)))
      await this.restoreAssistantContext(owner, sources);
  }

  private async restoreAssistantContext(message: any, sources?: DisplaySources) {
    if (typeof message.requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(message.requestId) ||
      typeof message.projectId !== "string" || !["string", "object"].includes(typeof message.featureId) ||
      !(message.featureId === null || typeof message.featureId === "string" && message.featureId.length <= 128) ||
      !(message.conversationId === null || typeof message.conversationId === "string" && message.conversationId.length <= 128) ||
      !Array.isArray(message.paths) || message.paths.length > 32 || new Set(message.paths).size !== message.paths.length ||
      message.paths.some((path: unknown) => !validSourcePath(path) || (path as string).length > 1024)) return;
    const owner = { requestId: message.requestId, projectId: message.projectId, featureId: message.featureId,
      conversationId: message.conversationId, paths: [...message.paths] as string[] };
    const view = this.assistantView;
    if (!view || !this.assistantContextOwnerMatches(owner)) return;
    const project = this.project!;
    const epoch = this.featureSourceEpoch || 0;
    const generation = this.assistantRestoreGeneration = (this.assistantRestoreGeneration || 0) + 1;
    this.assistantContextRestore = owner;
    this.assistantContextFiles = [];
    this.assistantContextEpoch = -1;
    const current = () => generation === this.assistantRestoreGeneration && this.assistantView === view &&
      this.project?.root === project.root && (this.featureSourceEpoch || 0) === epoch && this.assistantContextOwnerMatches(owner);
    let loaded: DisplaySources;
    try { loaded = await this.readDisplaySources(project, owner.paths.filter(path => project.files.some(file => file.path === path)), current, sources); }
    catch (error) { if (!current() || (error as { code?: string })?.code === "source-batch-cancelled") return; throw error; }
    if (!current()) return;
    const files: ProjectFile[] = [], unavailable: { path: string; reason: string }[] = [];
    let bytes = 0;
    for (const path of owner.paths) {
      if (!current()) return;
      if (!project.files.some(file => file.path === path)) {
        unavailable.push({ path, reason: "No longer indexed. Remove this file or restore it to the project." });
        continue;
      }
      try {
        // Read saved source only. Restoring a context choice never opens an
        // editor, reads its unsaved buffer, connects a runtime or calls AI.
        const file = loaded.files.get(path);
        if (!file) throw new Error("Saved source unavailable");
        if (!current()) return;
        const size = Buffer.byteLength(file.source, "utf8");
        if (bytes + size > 256 * 1024) {
          unavailable.push({ path, reason: "Context exceeds 256 KiB. Remove a file to continue." });
          continue;
        }
        files.push(file); bytes += size;
      } catch {
        if (!current()) return;
        unavailable.push({ path, reason: "Saved source is unavailable. Refresh or remove this file." });
      }
    }
    if (!current()) return;
    this.assistantContextFiles = files;
    this.assistantContextEpoch = epoch;
    this.sendState();
    void view.webview.postMessage({ type: "assistantRestoreContextResult", requestId: owner.requestId,
      projectId: owner.projectId, featureId: owner.featureId, conversationId: owner.conversationId, unavailable });
  }

  private dirtyPaths() {
    if (!this.project) return [];
    return vscode.workspace.textDocuments
      .filter((document) => document.isDirty && document.uri.scheme === "file")
      .map((document) =>
        relativeSourcePath(this.project!.root, document.uri.fsPath),
      )
      .filter(Boolean) as string[];
  }

  private sendState() {
    if(this.knowledgeOffer && !this.knowledgeOfferCurrent(this.knowledgeOffer))this.finishKnowledgeOffer("Project or conversation changed. Choose the knowledge record again.");
    this.flushEditorFocus();
    if (this.disposed || !this.panel && !this.assistantView) return;
    const dirtyPaths = this.dirtyPaths();
    this.sentDirtyPathsKey = JSON.stringify(dirtyPaths);
    const project = this.project;
    const changes = [...this.savedChanges.values()]
      .filter((change) => change.root === project?.root)
      .map((change) => ({
        path: change.path,
        baseRevision: change.baseRevision,
        revision: change.revision,
        conflict: this.openFiles.some(
          (file) =>
            file.path === change.path && file.revision !== change.revision,
        ),
      }));
    const focus = this.focus && this.activeFile?.path === this.focus.path ? {
      ...this.focus,
      stale: this.focus.origin === "runtime" ? (this.runtime?.snapshot().status !== "connected" || this.focus.session !== this.runtime?.snapshot().session || this.focus.viewId !== this.runtime?.snapshot().viewId || this.focus.revision !== this.activeFile.revision || Boolean(this.runtime?.snapshot().selection?.stale)) : this.focus.origin === "preview" && (Boolean(this.design.stale) ||
        this.focus.session !== this.design.session || this.focus.revision !== this.activeFile.revision),
    } : null;
    const design = {
      ...this.design,
      entries: project?.files.filter(file => /\.[jt]sx$/.test(file.path)).map(file => file.path) || [],
      stale: Boolean(this.design.stale),
      drafts: this.design.files?.filter((file: any) => dirtyPaths.includes(file.path)).map((file: any) => file.path) || [],
      html: undefined,
    };
    const conversationPresentation = project && vscode.workspace.isTrusted ? this.conversationPresentation() : null;
    const state = {
      type: "state",
      assistantSurface: this.assistantSurface(),
      workspaceMode: this.mode,
      project,
      activeFile: this.activeFile,
      focus,
      workspaceLayout: this.workspaceLayout(),
      openFiles: this.openFiles,
      dirtyPaths,
      trusted: vscode.workspace.isTrusted,
      provider: this.assistant?.status() || {
        configured: false,
        reason: "Provider not configured.",
      },
      changes,
      runtime: this.runtimeSnapshot(),
      design,
      proposal: project ? this.proposals().current() : null,
      inlineEdit: this.inlineEdit?.inspect() ?? { state: "idle" },
      codeSuggestions: this.codeSuggestions?.inspect() ?? { enabled: false, state: "off" },
      projectDecisions: this.projectDecisionsSnapshot(),
      reproducibleIssues: this.reproducibleIssuesSnapshot(),
      aiAlternatives: this.aiAlternativesSnapshot(),
      changeSetSession: this.changeSetSnapshot(),
      executionSession: this.executionSnapshot(),
      conversations: conversationPresentation?.snapshot ?? null,
      features: this.featureSnapshot(),
      runtimeWorkspace: this.runtimeWorkspaceSnapshot(true),
      designImpact: this.designImpactState(),
      featureFiles: vscode.workspace.isTrusted ? this.featureFiles || [] : [],
      featureUnavailable: vscode.workspace.isTrusted ? this.featureUnavailable || [] : [],
      featureLoading: Boolean(this.featureLoadTask),
      assistantContextFiles: this.currentAssistantContextFiles(),
      artifactSourceFiles: this.currentArtifactSourceFiles(),
      artifactSourceUnavailable: this.currentArtifactSourceOwner() ? this.artifactSourceUnavailable : [],
      featureCandidates: this.featureCandidates(),
      featureRelationships: this.relationshipState(),
      sourceInvestigation: this.sourceInvestigationState(),
      investigationContinuation: this.investigationContinuationState(),
      error: this.error,
      selection: focus?.line ? { startLine: focus.line, endLine: focus.endLine || focus.line } : null,
    };
    if (this.panel) {
      const html = this.sentDesignSession === this.design.session ? undefined : this.design.html;
      if (this.design.html) this.sentDesignSession = this.design.session;
      this.postHistoryMessage(this.panel.webview, { ...state, runtimeCaptures: this.runtimeCapturesSnapshot(this.panel.webview), runtimeReplays: this.runtimeReplaySnapshot(), runtimeMatrices: this.runtimeMatrixSnapshot(), runtimeStateSuites: this.runtimeStateSuiteSnapshot(), visualVerification: this.visualVerificationSnapshot(), visualAlternatives: this.visualAlternativesSnapshot(), design: { ...design, html } }, conversationPresentation);
    }
    // Runtime preview documents only belong to the central workspace. The
    // sidebar receives their evidence/selection, never another running frame.
    if (this.assistantView) this.postHistoryMessage(this.assistantView.webview, { ...state, runtime: { ...state.runtime, url: undefined } }, conversationPresentation);
  }

  private updateTree() {
    if (!vscode.workspace.isTrusted) {
      this.tree.nodes = [
        {
          label: "Review workspace trust",
          description: "Source analysis and AI are paused",
          icon: "shield",
          command: "foundation.manageTrust",
        },
      ];
      this.tree.refresh();
      return;
    }
    const file = this.activeFile;
    this.tree.nodes = [
      {
        label: this.project?.name || "Open a folder",
        description: this.project
          ? `${this.project.files.length} ${this.project.files.length === 1 ? "file" : "files"} indexed`
          : "Choose your project",
        command: "foundation.openProject",
        icon: "folder-opened",
      },
    ];
    this.tree.nodes.push({ label: "Project Setup", description: "Tooling and platform checks", icon: "tools", command: "foundation.projectSetup" });
    this.tree.nodes.push({ label: "Xcode Project", description: "Choose, build and test", icon: "beaker", command: "foundation.xcodeProject" });
    const featureState = this.featureSnapshot();
    const activeFeature = featureState?.features.find(feature => feature.id === featureState.activeId && !feature.archived);
    if (activeFeature) this.tree.nodes.push({ label: activeFeature.title, description: "Feature", icon: "layers",
      children: activeFeature.paths.map(path => ({ label: basename(path), description: path, path, icon: "symbol-file" })) });
    if (file)
      this.tree.nodes.push(
        {
          label: basename(file.path),
          description: this.dirtyPaths().includes(file.path)
            ? "Unsaved changes"
            : "Saved source",
          tooltip: this.dirtyPaths().includes(file.path)
            ? `${file.path} · Analysis uses the last saved version. Save to refresh.`
            : file.path,
          path: file.path,
          icon: "file-code",
        },
        ...(file.analysis.unsupported ? [{
          label: "Source analysis unavailable",
          description: "JavaScript and TypeScript only",
          tooltip: "Relationships are available for JavaScript and TypeScript. You can still edit this file normally.",
          icon: "info",
        }] : [
        {
          label: "Outline",
          description: file.analysis.symbols.length ? `${file.analysis.symbols.length} ${file.analysis.symbols.length === 1 ? "symbol" : "symbols"}` : "No symbols",
          icon: "symbol-class",
          children: file.analysis.symbols.map((symbol) => ({
            label: symbol.name,
            description: symbol.kind,
            path: file.path,
            line: symbol.line,
            icon:
              symbol.kind === "function" ? "symbol-method" : "symbol-property",
          })),
        },
        {
          label: "Imports",
          description: file.analysis.imports.length ? `${file.analysis.imports.length} ${file.analysis.imports.length === 1 ? "import" : "imports"}` : "No imports",
          icon: "references",
          children: file.analysis.imports.map((item) => ({
            label: item.specifier,
            description: item.resolvedPath
              ? "Project file"
              : "Not resolved here",
            path: item.resolvedPath || file.path,
            line: item.resolvedPath ? 1 : item.line,
            icon: "file-code",
          })),
        },
        {
          label: "Used by",
          description: file.analysis.consumers.length ? `${file.analysis.consumers.length} ${file.analysis.consumers.length === 1 ? "file" : "files"}` : "No indexed references",
          icon: "call-incoming",
          children: file.analysis.consumers.map((item) => ({
            label: basename(item.path),
            description: item.path,
            path: item.path,
            line: item.line,
            icon: "file-code",
          })),
        },
        ]),
      );
    else if (this.project) this.tree.nodes.push({ label: "Select a source file", description: "Context follows your editor", icon: "file-code" });
    this.tree.refresh();
  }

  private assistantSurface() {
    return { resolved: Boolean(this.assistantView), visible: Boolean(this.assistantView?.visible), open: Boolean(this.assistantOpen) };
  }

  private registerAssistantView() {
    this.context.subscriptions.push(vscode.window.registerWebviewViewProvider(
      "foundation.assistant",
      { resolveWebviewView: view => this.resolveAssistantView(view) },
      { webviewOptions: { retainContextWhenHidden: true } },
    ));
  }

  private resolveAssistantView(view: vscode.WebviewView) {
    if(this.knowledgeOffer?.target && this.knowledgeOffer.target!==view.webview)this.finishKnowledgeOffer("Assistant reloaded. Choose Use in Assistant again.");
    this.assistantView = view;
    this.assistantReady = false;
    if (!this.assistantVisibilityTask) this.assistantOpen = view.visible;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    this.bindWebview(view.webview, "assistant");
    view.webview.html = this.webviewHtml(view.webview, "assistant");
    view.onDidChangeVisibility(() => {
      if (this.assistantView !== view || this.disposed) return;
      if (!this.assistantVisibilityTask) this.assistantOpen = view.visible;
      this.settleAssistantReveal();
      // Collapse only changes presentation. Requests and durable history remain
      // owned by this host; always rehydrate because hidden delivery can lag.
      this.sendState();
      if (view.visible) this.flushAssistantPreparation();
    }, null, this.context.subscriptions);
    view.onDidDispose(() => {
      if (this.assistantView !== view) return;
      this.finishKnowledgeOffer("Assistant closed. Choose Use in Assistant again.");
      this.assistantView = undefined;
      this.clearAssistantContext();
      this.assistantReady = false;
      this.assistantOpen = false;
      this.assistantFocusRequested = false;
      this.assistantPreparation = undefined;
      this.featurePreparation = undefined;
      this.assistantVisibilityGeneration++;
      this.settleAssistantReveal(true);
      // Explicit Remove View is different from collapsing the secondary bar.
      // Retain the partial answer if its owner removes the assistant entirely.
      this.cancelQuestion();
      this.sendState();
    }, null, this.context.subscriptions);
    this.settleAssistantReveal();
    this.sendState();
  }

  private settleAssistantReveal(removed = false) {
    if (!removed && !this.disposed && !this.assistantView?.visible) return;
    for (const resolve of this.assistantRevealWaiters || []) resolve();
    this.assistantRevealWaiters?.clear();
  }

  private async showAssistant(preserveFocus = false) {
    await this.setAssistantVisible(true, preserveFocus);
  }

  private async collapseAssistant() {
    await this.setAssistantVisible(false);
  }

  private async setAssistantVisible(open: boolean, preserveFocus = false) {
    if (this.disposed) return;
    this.assistantOpen = open;
    this.assistantFocusRequested = open && !preserveFocus;
    if (!open) { this.finishKnowledgeOffer("Assistant closed. Choose Use in Assistant again."); this.assistantPreparation = undefined; this.featurePreparation = undefined; this.investigationOffer = undefined; }
    const generation = this.assistantVisibilityGeneration = (this.assistantVisibilityGeneration || 0) + 1;
    const previous = this.assistantVisibilityTask;
    // A close requested during cold view resolution must run after that reveal.
    // Coalesce queued intents while leaving the native editor layout untouched.
    const task = (previous || Promise.resolve()).catch(() => {}).then(async () => {
      if (this.disposed || generation !== this.assistantVisibilityGeneration) return;
      if (open) {
        // Code OSS's generated focus command returns before openView finishes.
        // Wait for the actual view event before processing a queued collapse.
        let revealed: (() => void) | undefined;
        const visible = this.assistantView?.visible ? Promise.resolve() : new Promise<void>(resolve => {
          revealed = resolve;
          (this.assistantRevealWaiters ||= new Set()).add(resolve);
        });
        try {
          await vscode.commands.executeCommand("foundation.assistant.focus", { preserveFocus });
          await visible;
        } finally {
          if (revealed) this.assistantRevealWaiters.delete(revealed);
        }
      }
      else if (this.assistantView?.visible)
        await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    });
    this.assistantVisibilityTask = task;
    this.sendState();
    try { await task; }
    finally {
      if (this.assistantVisibilityTask === task) {
        this.assistantVisibilityTask = undefined;
        this.assistantOpen = Boolean(this.assistantView?.visible);
        this.sendState();
        this.flushAssistantPreparation();
      }
    }
  }

  private async prepareAssistant(message: any) {
    if (!vscode.workspace.isTrusted || !this.project || message.projectId !== this.project.id ||
      !validSourcePath(message.contextPath) || !this.openFiles.some(file => file.path === message.contextPath) ||
      !assistantIntent(message.intent) ||
      (message.prompt !== undefined && (typeof message.prompt !== "string" || message.prompt.length > 6000)))
      throw new Error("Source context changed. Select the current source before preparing the Assistant.");
    this.featurePreparation = undefined;
    this.assistantPreparation = {
      projectId: this.project.id, contextPath: message.contextPath, intent: assistantIntent(message.intent)!,
      ...(message.prompt !== undefined ? { prompt: message.prompt } : {}),
    };
    await this.showAssistant();
  }

  private flushAssistantPreparation() {
    if (!this.assistantView || !this.assistantReady || !this.assistantView.visible || !this.assistantOpen) return;
    void this.flushKnowledgePreparation();
    const preparation = this.assistantPreparation;
    this.assistantPreparation = undefined;
    const featurePreparation = this.featurePreparation;
    this.featurePreparation = undefined;
    const featureState = this.featureSnapshot();
    if (featurePreparation && featurePreparation.projectId === this.project?.id && featureState?.activeId === featurePreparation.featureId && featureState.revision === featurePreparation.revision && vscode.workspace.isTrusted)
      void this.assistantView.webview.postMessage({ type: "prepareFeatureContext", ...featurePreparation });
    if (preparation && preparation.projectId === this.project?.id && vscode.workspace.isTrusted)
      void this.assistantView.webview.postMessage({ type: "prepareAssistant", ...preparation });
    const investigationOffer = this.investigationOffer;
    this.investigationOffer = undefined;
    if (investigationOffer && investigationOffer.projectId === this.project?.id &&
      investigationOffer.featureId === featureState?.activeId && investigationOffer.featureRevision === featureState?.revision &&
      investigationOffer.conversationId === (this.conversations().snapshot().activeId ?? null) &&
      investigationOffer.snapshotId === this.relationshipSnapshotId && vscode.workspace.isTrusted)
      void this.assistantView.webview.postMessage({type:"prepareSourceInvestigation", ...investigationOffer});
    if (this.assistantFocusRequested) {
      this.assistantFocusRequested = false;
      void this.assistantView.webview.postMessage({ type: "focusAssistant" });
    }
  }

  private webviewHtml(webview: vscode.Webview, surface: Surface) {
    const nonce = this.nonce;
    const frameOrigin = surface === "workspace" ? [this.runtimeFrameOrigin,this.alternativeFrameOrigin].filter(Boolean).join(" ") : "";
    const resource = (file: string) => escapeHtml(webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", file),
    ));
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; frame-src 'self' ${escapeHtml(frameOrigin)}; connect-src 'none'; form-action 'none'; base-uri 'none';"><link rel="stylesheet" href="${resource("webview.css")}"><title>Foundation${surface === "assistant" ? " Assistant" : ""}</title></head><body data-foundation-surface="${surface}"${surface === "workspace" ? ' data-foundation-assistant="external"' : ""}><div id="foundation-root"></div><script nonce="${nonce}" src="${resource("artifact-model.js")}"></script><script nonce="${nonce}" src="${resource("workspace-model.js")}"></script><script nonce="${nonce}" src="${resource("history-model.js")}"></script><script nonce="${nonce}" src="${resource("project-knowledge.js")}"></script><script nonce="${nonce}" src="${resource("webview.js")}"></script></body></html>`;
  }

  private bindWebview(webview: vscode.Webview, surface: Surface) {
    const isCurrent = () => !this.disposed && (surface === "assistant"
      ? this.assistantView?.webview === webview : this.panel?.webview === webview);
    webview.onDidReceiveMessage(message => {
      if (!isCurrent()) return;
      void this.message(message, surface).catch(error => {
        if (!isCurrent()) return;
        const detail = error instanceof Error ? error.message : "This action could not complete.";
        if (surface === "assistant" && message?.type === "ask" && typeof message.requestId === "string")
          this.postAI(message.requestId, { type: "error", error: detail });
        else {
          if (message?.type === "conversation") this.sendState();
          this.postError(detail, surface);
        }
      });
    }, null, this.context.subscriptions);
  }

  private restoredWorkspaceTab() {
    for (const group of vscode.window.tabGroups?.all || []) {
      for (const tab of group.tabs || []) {
        const type = (tab.input as vscode.TabInputWebview | undefined)?.viewType;
        if (type === "foundation.workspace" || type === "mainThreadWebview-foundation.workspace") return { group, tab };
      }
    }
    return undefined;
  }

  private adoptWorkspacePanel(panel: vscode.WebviewPanel, restoredState?: any) {
    if (this.disposed) { panel.dispose(); return; }
    this.panel = panel;
    this.workspaceReady = false;
    const restoredMode = ["Understand", "Refine", "Review"].includes(restoredState?.mode) ? restoredState.mode : "Understand";
    this.mode = this.pendingWorkspaceMode?.mode ?? restoredMode;
    this.pendingWorkspaceMode = undefined;
    panel.webview.options = { enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")] };
    this.bindWebview(panel.webview, "workspace");
    this.sentDesignSession = undefined;
    panel.webview.html = this.webviewHtml(panel.webview, "workspace");
    panel.onDidDispose(() => {
      if (this.panel !== panel) return;
      this.interruptRuntimeReplay("preview-changed");
      this.interruptAlternatives();
      if(this.knowledgeOffer?.source===panel.webview)this.finishKnowledgeOffer("Knowledge closed. Choose the record again.");
      this.panel = undefined;
      this.workspaceReady = false;
      this.knowledgeReveal = undefined;
      this.sentDesignSession = undefined;
      this.sendState();
    }, null, this.context.subscriptions);
    panel.onDidChangeViewState?.(() => {
      if (this.panel === panel && !panel.visible) { this.interruptRuntimeReplay("preview-changed"); this.interruptAlternatives(); }
    }, null, this.context.subscriptions);
    // This marks a first visit, not a closed/open preference. Native tab state
    // distinguishes an explicit Close from shutdown without guessing its cause.
    void Promise.resolve(this.context.workspaceState.update("foundation.workspaceOpened", true)).catch(() => {
      this.diagnosticOutput?.appendLine("[Foundation] Workspace first-visit state could not be saved.");
    });
    this.sendState();
  }

  private createWorkspacePanel(mode: Exclude<Mode, "Assistant">, viewColumn: vscode.ViewColumn, preserveFocus: boolean) {
    this.pendingWorkspaceMode = undefined;
    const panel = vscode.window.createWebviewPanel("foundation.workspace", "Foundation", { viewColumn, preserveFocus },
      { enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")] });
    this.adoptWorkspacePanel(panel, { mode });
    return panel;
  }

  private async revealRestoredWorkspace(target: { group: vscode.TabGroup; tab: vscode.Tab }, mode: Exclude<Mode, "Assistant">) {
    const generation = this.workspaceRevealGeneration = (this.workspaceRevealGeneration || 0) + 1;
    this.pendingWorkspaceMode = { mode, tab: target.tab };
    const previous = this.workspaceRevealTask;
    const task = (previous || Promise.resolve()).catch(() => {}).then(async () => {
      const current = () => !this.disposed && this.workspaceRevealGeneration === generation &&
        vscode.window.tabGroups.all.some(group => group.tabs.includes(target.tab));
      if (!current()) return;
      const group = vscode.window.tabGroups.all.find(group => group.tabs.includes(target.tab))!;
      const names = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth"];
      const command = names[group.viewColumn - 1] ? `workbench.action.focus${names[group.viewColumn - 1]}EditorGroup` :
        group === vscode.window.tabGroups.all.at(-1) ? "workbench.action.focusLastEditorGroup" : undefined;
      if (!command) throw new Error("Select the existing Foundation tab to restore this workspace.");
      await vscode.commands.executeCommand(command);
      if (!current()) return;
      const owner = vscode.window.tabGroups.all.find(item => item.tabs.includes(target.tab));
      if (owner !== vscode.window.tabGroups.activeTabGroup) return;
      const index = owner.tabs.indexOf(target.tab);
      // This command begins revival but does not await it. The serializer takes
      // the latest explicit mode when the existing panel eventually resolves.
      await vscode.commands.executeCommand("workbench.action.openEditorAtIndex", index);
    });
    this.workspaceRevealTask = task;
    try { await task; }
    finally {
      if (this.workspaceRevealTask === task) this.workspaceRevealTask = undefined;
      if (this.workspaceRevealGeneration === generation && !vscode.window.tabGroups.all.some(group => group.tabs.includes(target.tab))) this.pendingWorkspaceMode = undefined;
    }
  }

  show(mode: Mode = "Understand", preserveFocus = false) {
    if (this.disposed) return;
    if (mode === "Assistant") return this.showAssistant(preserveFocus);
    if (mode !== "Refine") this.interruptRuntimeReplay("preview-changed");
    this.mode = mode;
    if (!this.panel) {
      const restored = this.restoredWorkspaceTab();
      if (restored) return this.revealRestoredWorkspace(restored, mode);
      this.createWorkspacePanel(mode, vscode.ViewColumn.Active, preserveFocus);
    } else {
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Active, preserveFocus);
      this.sendState();
    }
    void this.panel?.webview.postMessage({ type: "mode", mode });
  }

  private async message(message: any, surface: Surface = "workspace") {
    if (!message || typeof message !== "object") return;
    if (surface !== "assistant" && ["ask", "cancel", "conversation"].includes(message.type))
      throw new Error("Use the Assistant sidebar to manage conversations or send a question.");
    if (message.type === "historyResync") {
      const webview = surface === "assistant" ? this.assistantView?.webview : this.panel?.webview;
      const delivery = webview && this.historyDeliveries?.get(webview);
      if (delivery) { for (const channel of delivery.channels.values()) channel.reset = true; this.sendState(); }
    } else if (message.type === "ready") {
      const receivingView = surface === "assistant" ? this.assistantView?.webview : this.panel?.webview;
      if (receivingView && message.historyProtocol === 1) {
        this.historyDeliveries ||= new WeakMap();
        const delivery = this.historyDeliveries.get(receivingView);
        if (delivery) for (const channel of delivery.channels.values()) channel.reset = true;
        else this.historyDeliveries.set(receivingView, { channels: new Map() });
      }
      if (surface === "workspace") { this.sentDesignSession = undefined; this.workspaceReady = true; }
      else { if(this.knowledgeOffer?.delivered)this.finishKnowledgeOffer("Assistant reloaded. Choose Use in Assistant again."); this.assistantReady = true; }
      this.sendState();
      const webview = surface === "assistant" ? this.assistantView?.webview : this.panel?.webview;
      void webview?.postMessage({ type: "mode", mode: surface === "assistant" ? "Assistant" : this.mode });
      this.flushAssistantPreparation();
      this.flushKnowledgeReveal();
      const alternativeWait=this.visualAlternativesPreviewWait;
      if(surface==="workspace" && alternativeWait && !this.disposed && vscode.workspace.isTrusted && this.panel===alternativeWait.panel && this.panel.visible && this.mode==="Review" && this.alternativeKey()===alternativeWait.key)
        void this.panel.webview.postMessage({type:"visualAlternativesPreview",projectId:this.project!.id,...alternativeWait.input});
    } else if (message.type === "workspaceMode" && surface === "workspace" && ["Understand", "Refine", "Review"].includes(message.mode)) {
      if (message.mode !== "Refine") this.interruptRuntimeReplay("preview-changed");
      this.mode = message.mode;
      if(message.mode!=="Understand")this.knowledgeReveal=undefined;
    } else if (message.type === "assistantRestoreContext" && surface === "assistant") {
      await this.restoreAssistantContext(message);
    } else if (message.type === "navigate")
      await this.navigate(message.path, message.line);
    else if (message.type === "refresh") { this.featureSourceEpoch = (this.featureSourceEpoch || 0) + 1; this.featureCacheKey = ""; this.invalidateRelationships(); this.invalidateDesignImpact(); await this.refresh(); }
    else if (message.type === "workspaceLayout" && surface === "workspace") await this.saveWorkspaceLayout(message);
    else if (message.type === "action" && ACTIONS.has(message.id)) {
      if (message.id === "foundation.askAI" && message.contextPath !== undefined)
        await this.prepareAssistant(message);
      else await vscode.commands.executeCommand(message.id);
    }
    else if (message.type === "reviewFile") await this.reviewFile(message.path);
    else if (message.type === "feature") await this.featureAction(message);
    else if (message.type === "featureRelationships" && surface === "workspace") await this.relationshipAction(message);
    else if (message.type === "runtimeWorkspace" && surface === "workspace") await this.runtimeWorkspaceAction(message);
    else if (message.type === "visualAlternativesPreviewReady" && surface === "workspace") this.alternativePreviewReady(message);
    else if (message.type === "visualAlternatives" && surface === "workspace") await this.visualAlternativesAction(message);
    else if (message.type === "reproducibleIssue") await this.reproducibleIssueAction(message);
    else if (message.type === "aiAlternativeAction") await this.aiAlternativeAction(message,surface);
    else if (message.type === "projectDecision") await this.projectDecisionAction(message);
    else if (message.type === "knowledgeContext") await this.prepareKnowledgeContext(message,surface);
    else if (message.type === "knowledgeContextApplied" && surface === "assistant") this.knowledgeContextApplied(message);
    else if (message.type === "visualVerification" && surface === "workspace") await this.visualVerificationAction(message);
    else if (message.type === "runtimeCaptureImage" && surface === "workspace") await this.readRuntimeCaptureImage(message);
    else if (message.type === "runtimeReplay" && surface === "workspace") await this.runtimeReplayAction(message);
    else if (message.type === "runtimeMatrix" && surface === "workspace") await this.runtimeMatrixAction(message);
    else if (message.type === "runtimeStateSuite" && surface === "workspace") await this.runtimeStateSuiteAction(message);
    else if (message.type === "conversation") await this.conversationAction(message);
    else if (message.type === "planAction" && surface === "assistant") await this.planAction(message);
    else if (message.type === "changeSetAction") await this.changeSetAction(message, surface);
    else if (message.type === "executionAction") await this.executionAction(message, surface);
    else if (message.type === "checkPlanAction") await this.checkPlanAction(message, surface);
    else if (message.type === "investigationContinuationAction" && surface === "assistant") await this.investigationContinuationAction(message);
    else if (message.type === "sourceInvestigationAction" && surface === "assistant") await this.sourceInvestigationAction(message);
    else if (message.type === "checkSuggestionAction") await this.checkSuggestionAction(message, surface);
    else if (message.type === "requestRevisionAction") await this.requestRevisionAction(message, surface);
    else if (message.type === "groupRevisionAction") await this.groupRevisionAction(message, surface);
    else if (message.type === "ask") await this.ask(message);
    else if (message.type === "cancel" && typeof message.requestId === "string") this.cancelQuestion(message.requestId);
    else if (message.type === "runtime" && surface === "workspace") await this.runtimeAction(message);
    else if (message.type === "designStart") await this.startDesignPreview(message.entry);
    else if (message.type === "designObserved" && surface === "workspace") await this.designObserved(message);
    else if (message.type === "designImpact" && surface === "workspace") await this.designImpactAction(message);
    else if (message.type === "designPropose") await this.proposeTokenChange(message);
    else if (message.type === "proposalDiff") await this.proposalDiff(message.id);
    else if (message.type === "proposalApply") await this.changeProposal("apply", message.id);
    else if (message.type === "proposalUndo") await this.changeProposal("undo", message.id);
    else if (message.type === "proposalDiscard") await this.changeProposal("discard", message.id);
  }

  private features(project = this.project) {
    if (!project) throw new Error("Open a project before using features.");
    this.featureStores ||= new Map();
    let store = this.featureStores.get(project.id);
    if (!store) {
      const key = `foundation.features.${project.id}`;
      store = createFeatureStore({ projectId: project.id,
        read: () => this.context.workspaceState.get(key),
        write: value => this.context.workspaceState.update(key, value),
        onChange: () => this.queueConversationState(project.id),
      });
      this.featureStores.set(project.id, store);
    }
    return store;
  }

  private featureSnapshot(): FeatureSnapshot | null {
    return this.project && vscode.workspace.isTrusted ? this.features().snapshot() : null;
  }

  private clearFeatureView() {
    this.runtimeSourceHashCache = undefined;
    this.featureLoadGeneration = (this.featureLoadGeneration || 0) + 1;
    this.featureFiles = []; this.featureUnavailable = []; this.featureCacheKey = "";
    this.featureLoadKey = ""; this.featureLoadTask = undefined; this.featurePreparation = undefined;
  }

  private async loadFeatureFiles(sources?: DisplaySources) {
    const project = this.project, snapshot = this.featureSnapshot();
    const active = snapshot?.features.find(feature => feature.id === snapshot.activeId && !feature.archived);
    if (!project || !active || !snapshot || snapshot.storage.status === "unavailable") { this.clearFeatureView(); return; }
    const epoch = this.featureSourceEpoch || 0;
    const key = `${project.id}:${snapshot.revision}:${epoch}`;
    if (!sources && key === this.featureCacheKey) return;
    if (!sources && key === this.featureLoadKey && this.featureLoadTask) return this.featureLoadTask;
    const generation = this.featureLoadGeneration = (this.featureLoadGeneration || 0) + 1;
    this.featureLoadKey = key; this.featureFiles = []; this.featureUnavailable = [];
    const current = () => !this.disposed && vscode.workspace.isTrusted && generation === this.featureLoadGeneration && this.project?.id === project.id && this.project?.root === project.root && (this.featureSourceEpoch || 0) === epoch && this.features(project).snapshot().revision === snapshot.revision;
    const task = (async () => {
      let loaded: DisplaySources;
      try { loaded = await this.readDisplaySources(project, active.paths, current, sources); }
      catch (error) { if (!current() || (error as { code?: string })?.code === "source-batch-cancelled") return; throw error; }
      if (!current()) return;
      const files: ProjectFile[] = [], unavailable: {path: string; reason: string; kind: "source-unavailable" | "context-limit"}[] = [];
      let bytes = 0;
      for (const path of active.paths) {
        if (!current()) return;
        try {
          const file = loaded.files.get(path);
          if (!file) throw new Error("Saved source unavailable");
          if (!current()) return;
          const size = Buffer.byteLength(file.source, "utf8");
          if (bytes + size > 256 * 1024) { unavailable.push({path, kind: "context-limit", reason: "Open this file separately; the feature's loaded context has reached its size limit."}); continue; }
          bytes += size; files.push(file);
        } catch { unavailable.push({path, kind: "source-unavailable", reason: "This saved file is missing, excluded, or unavailable. Its membership is preserved."}); }
      }
      if (!current()) return;
      this.featureFiles = files; this.featureUnavailable = unavailable; this.featureCacheKey = key;
    })();
    this.featureLoadTask = task;
    try { await task; } finally {
      if (generation === this.featureLoadGeneration) { this.featureLoadTask = undefined; this.featureLoadKey = ""; this.sendState(); }
    }
  }

  private featureCandidates() {
    const snapshot = this.featureSnapshot(), active = snapshot?.features.find(feature => feature.id === snapshot.activeId && !feature.archived);
    if (!this.project || !active) return [];
    const anchor = (this.featureFiles || []).find(file => file.path === active.entryPath) || (this.featureFiles || [])[0];
    return anchor ? suggestFeatureFiles({ anchorFile: anchor, inventory: this.project.files, existingPaths: active.paths }) : [];
  }

  private relationshipOwnerCurrent(owner: NonNullable<FoundationHost["relationshipOwner"]>, checkEpoch = true) {
    const feature = this.featureSnapshot();
    return !this.disposed && vscode.workspace.isTrusted && this.project?.id === owner.projectId && this.project.root === owner.root &&
      feature?.activeId === owner.featureId && feature.revision === owner.featureRevision &&
      feature.storage.status !== "unavailable" && (!checkEpoch || (this.relationshipEpoch || 0) === owner.epoch);
  }

  private relationshipState() {
    const owner = this.relationshipOwner;
    if (!owner || !this.relationshipOwnerCurrent(owner, false)) return null;
    const current = this.relationshipOwnerCurrent(owner);
    const paths = new Set<string>((this.relationshipSnapshot?.manifest || []).map((item: any) => item.path));
    paths.add(owner.anchorPath);
    return { projectId: owner.projectId, featureId: owner.featureId, featureRevision: owner.featureRevision,
      anchorPath: owner.anchorPath, trail: [...(this.relationshipTrail || [])],
      status: current ? this.relationshipStatus : "stale", snapshotId: current && this.relationshipStatus === "ready" ? this.relationshipSnapshotId : null,
      snapshot: this.relationshipSnapshot, message: this.relationshipMessage,
      dirtyPaths: this.dirtyPaths().filter(path => paths.has(path)) };
  }

  private clearRelationships() {
    this.continuationGeneration = (this.continuationGeneration || 0) + 1;
    this.continuationBinding = undefined;
    if (this.continuationBusy) this.continuationBusy.stopped = true;
    this.relationshipGeneration = (this.relationshipGeneration || 0) + 1;
    this.investigationGeneration = (this.investigationGeneration || 0) + 1;
    this.investigationBinding = undefined; this.investigationOffer = undefined; this.investigationPrepareId = undefined;
    this.relationshipOwner = undefined; this.relationshipSnapshot = null; this.relationshipSnapshotId = null;
    this.relationshipTrail = []; this.relationshipStatus = "idle"; this.relationshipMessage = "";
    this.relationshipTask = undefined; this.relationshipLoadKey = "";
  }

  private invalidateRelationships() {
    this.relationshipEpoch = (this.relationshipEpoch || 0) + 1;
    this.relationshipGeneration = (this.relationshipGeneration || 0) + 1;
    this.relationshipTask = undefined; this.relationshipLoadKey = ""; this.relationshipSnapshotId = null;
    if (this.relationshipOwner) { this.relationshipStatus = "stale"; this.relationshipMessage = "Saved source changed. Refresh relationships before opening evidence."; this.sendState(); }
  }

  private relationshipSourceChanged(uri: vscode.Uri) {
    if (!this.project || uri.scheme !== "file" || !this.featureSnapshot()?.activeId) return false;
    const path = relativeSourcePath(this.project.root, uri.fsPath);
    if (!path || path.split("/").slice(0, -1).some(part => part.startsWith(".") ||
      ["node_modules", "bower_components", "vendor", "dist", "build", "out", "coverage", "artifacts", "test-results", "playwright-report", "Pods", "Carthage", "DerivedData", "__pycache__"].includes(part))) return false;
    // Newly created consumers and ignore-rule changes also invalidate a focused
    // graph, even when their paths were absent from its previous manifest.
    if (basename(path).startsWith(".") && basename(path) !== ".gitignore") return false;
    if (!this.project.files.some(file => file.path === path) && !/\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|sass|less|html|htm|md|mdx|txt|yaml|yml|svg|swift|kt|java|xml|graphql|gql|toml|sql|py|rs|go|vue|svelte)$/i.test(path) && basename(path) !== ".gitignore") return false;
    this.invalidateRelationships(); return true;
  }

  private readRelationshipLocation(project: ProjectSnapshot, featureId: string) {
    const saved = this.context.workspaceState.get<any>(`foundation.relationshipLocation.${project.id}`);
    if (!saved || saved.version !== 1 || saved.featureId !== featureId || !validSourcePath(saved.anchorPath) ||
      !Array.isArray(saved.trail) || saved.trail.length < 1 || saved.trail.length > 12 || saved.trail.at(-1) !== saved.anchorPath ||
      saved.trail.some((path: unknown) => !validSourcePath(path) || !project.files.some(file => file.path === path))) return null;
    return {anchorPath: saved.anchorPath as string, trail: [...saved.trail] as string[]};
  }

  private persistRelationshipLocation(owner: NonNullable<FoundationHost["relationshipOwner"]>, trail: string[]) {
    if (!owner.anchorPath || !this.relationshipOwnerCurrent(owner)) return;
    // Persist only the location. Source evidence is rebuilt for every process;
    // an old graph or runtime interpretation can never be revived as current.
    void Promise.resolve().then(() => {
      if (!this.relationshipOwnerCurrent(owner) || this.relationshipOwner !== owner) return;
      return this.context.workspaceState.update(`foundation.relationshipLocation.${owner.projectId}`,
        {version: 1, featureId: owner.featureId, anchorPath: owner.anchorPath, trail: trail.slice(-12)});
    }).catch(() => {
      if (!this.relationshipOwnerCurrent(owner) || this.relationshipOwner !== owner) return;
      this.relationshipMessage = "This exploration location could not be saved for restart.";
      this.sendState();
    });
  }

  private async loadRelationships(options: {path?: string; navigation?: "focus" | "back" | "reset"; force?: boolean} = {}) {
    const project = this.project, snapshot = this.featureSnapshot();
    const feature = snapshot?.features.find(item => item.id === snapshot.activeId && !item.archived);
    if (!project || !snapshot || !feature || snapshot.storage.status === "unavailable" || !vscode.workspace.isTrusted || this.disposed) { this.clearRelationships(); return; }
    const previous = this.relationshipOwner;
    const sameFeature = previous?.projectId === project.id && previous.root === project.root && previous.featureId === feature.id;
    const primary = feature.entryPath || feature.paths[0] || "";
    const restored = sameFeature ? null : this.readRelationshipLocation(project, feature.id);
    let trail = sameFeature ? [...(this.relationshipTrail || [])] : restored?.trail || [];
    let anchorPath = sameFeature && previous.anchorPath ? previous.anchorPath : restored?.anchorPath || primary;
    if (options.navigation === "reset" || !feature.paths.length) { anchorPath = primary; trail = anchorPath ? [anchorPath] : []; }
    else if (options.navigation === "back" && trail.length > 1) { trail.pop(); anchorPath = trail.at(-1)!; }
    else if (options.path) { anchorPath = options.path; if (trail.at(-1) !== anchorPath) trail.push(anchorPath); }
    if (!trail.length && anchorPath) trail = [anchorPath];
    const owner = { projectId: project.id, root: project.root, featureId: feature.id, featureRevision: snapshot.revision, anchorPath, epoch: this.relationshipEpoch || 0 };
    const key = JSON.stringify(owner);
    if (!options.force && key === this.relationshipLoadKey) {
      if (this.relationshipTask) return this.relationshipTask;
      if (["ready", "error", "idle"].includes(this.relationshipStatus)) return;
    }
    const generation = this.relationshipGeneration = (this.relationshipGeneration || 0) + 1;
    const keep = sameFeature && previous.anchorPath === anchorPath;
    this.relationshipOwner = owner; this.relationshipTrail = trail.slice(-12); this.relationshipLoadKey = key;
    if (!keep) this.relationshipSnapshot = null;
    this.relationshipSnapshotId = null; this.relationshipMessage = "";
    if (options.navigation) this.persistRelationshipLocation(owner, this.relationshipTrail);
    if (!anchorPath) { this.relationshipStatus = "idle"; this.relationshipMessage = "Add a source file to explore this feature."; this.sendState(); return; }
    this.relationshipStatus = "loading"; this.sendState();
    const current = () => generation === this.relationshipGeneration && this.relationshipOwnerCurrent(owner);
    const task = (async () => {
      try {
        const result = await this.service.relationships(project.id, anchorPath, { isCurrent: current });
        if (!current()) return;
        if (result?.projectId !== project.id || result?.anchor?.path !== anchorPath) throw new Error("Invalid relationship ownership");
        this.relationshipSnapshot = result; this.relationshipSnapshotId = randomBytes(12).toString("hex");
        this.relationshipStatus = "ready";
      } catch {
        if (!current()) return;
        this.relationshipStatus = "error"; this.relationshipSnapshot = null;
        this.relationshipMessage = "Could not read relationships for this file. Refresh or choose another source.";
      } finally {
        if (current()) { this.relationshipTask = undefined; this.sendState(); }
      }
    })();
    this.relationshipTask = task;
    await task;
  }

  private investigationOwnerCurrent(binding: NonNullable<FoundationHost["investigationBinding"]>, checkEpoch = true) {
    const feature = this.featureSnapshot(), history = this.conversationPresentation().snapshot;
    return this.investigationBinding === binding && !this.disposed && vscode.workspace.isTrusted &&
      this.project?.id === binding.projectId && this.project.root === binding.root &&
      feature?.activeId === binding.featureId && feature.revision === binding.featureRevision && feature.storage.status !== "unavailable" &&
      (history.activeId ?? null) === binding.conversationId && !history.conversations.find(chat => chat.id === history.activeId)?.archived &&
      (!checkEpoch || binding.epoch === (this.relationshipEpoch || 0));
  }

  private investigationDirtyPaths(binding: NonNullable<FoundationHost["investigationBinding"]>) {
    const result = binding.result;
    const paths = new Set<string>([result.anchor.path, ...result.edges.flatMap((edge: any) => [edge.from.path, edge.to.path]),
      ...result.requests.map((request: any) => request.source.path)]);
    return this.dirtyPaths().filter(path => paths.has(path));
  }

  private sourceInvestigationState() {
    const binding = this.investigationBinding;
    if (!binding || !this.investigationOwnerCurrent(binding, false)) return null;
    const dirtyPaths = this.investigationDirtyPaths(binding), current = this.investigationOwnerCurrent(binding);
    return {id:binding.result.id, digest:binding.result.digest, status:!current ? "stale" : dirtyPaths.length ? "blocked" : "ready",
      message:!current ? "Saved source changed. Refresh the investigation before sharing it." : dirtyPaths.length
        ? "Shared evidence has unsaved edits. Resolve those drafts before sharing saved source." : "Saved source; unsaved edits are excluded.", dirtyPaths};
  }

  private resolveSourceInvestigation(input: any) {
    if (input === undefined) return undefined;
    const descriptor = normalizeSourceInvestigationDescriptor(input);
    if (!descriptor) return undefined;
    const binding = this.investigationBinding;
    if (!binding || !this.investigationOwnerCurrent(binding) || descriptor.id !== binding.result.id || descriptor.digest !== binding.result.digest)
      throw new Error("Refresh the source investigation before sharing it. Its original result remains available for inspection.");
    validateSourceInvestigation(binding.result, binding.projectId);
    if (this.investigationDirtyPaths(binding).length) throw new Error("Shared source evidence has unsaved edits. Resolve the affected drafts before sending.");
    return binding;
  }

  private async readSourceInvestigation(binding: NonNullable<FoundationHost["investigationBinding"]>, current: () => boolean) {
    const check = () => {
      if (!current() || !this.investigationOwnerCurrent(binding)) throw new Error("This source investigation no longer owns the selected project, feature or conversation.");
      if (this.investigationDirtyPaths(binding).length) throw new Error("Shared source evidence has unsaved edits. Resolve those drafts before sending.");
    };
    check();
    if (!await this.service.validateRelationships(binding.projectId, binding.graph, {isCurrent:current})) {
      if (this.investigationBinding === binding) { binding.epoch = -1; this.sendState(); }
      throw new Error("The investigation's saved source changed or could not be fully verified. Refresh it before sharing.");
    }
    check();
    const file: ProjectFile = await this.service.getFile(binding.projectId, binding.result.anchor.path);
    check();
    if (file.revision !== binding.result.anchor.revision) throw new Error("The investigation source changed. Refresh it before sharing.");
    return file;
  }

  private async resolveProviderSourceInvestigation(input: any) {
    const active = this.asking;
    if (!active || input.projectId !== this.project?.id || !active.sourceInvestigation || active.abort.signal.aborted)
      throw new Error("This investigation request is no longer active.");
    const {projectId:_projectId, ...descriptor} = input;
    if (JSON.stringify(normalizeSourceInvestigationDescriptor(descriptor)) !== JSON.stringify(active.sourceInvestigation))
      throw new Error("The investigation result changed before sharing.");
    const binding = this.resolveSourceInvestigation(descriptor)!;
    const current = () => this.asking === active && !active.abort.signal.aborted && active.investigationGuard?.() !== false;
    await this.readSourceInvestigation(binding, current);
    return binding.result;
  }

  private continuationOwnerCurrent(binding: NonNullable<FoundationHost["continuationBinding"]>, activeRequestId?: string) {
    const feature = this.featureSnapshot(), history = this.conversationPresentation().snapshot;
    const chat = history.conversations.find(item => item.id === binding.conversationId);
    if (this.continuationBinding !== binding || this.disposed || !vscode.workspace.isTrusted ||
      this.project?.id !== binding.projectId || this.project.root !== binding.root || feature?.activeId !== binding.featureId ||
      feature.revision !== binding.featureRevision || feature.storage.status === "unavailable" ||
      history.activeId !== binding.conversationId || !chat || chat.archived || binding.epoch !== (this.relationshipEpoch || 0)) return false;
    try {
      const chain = deriveInvestigationChain(chat, binding.context.rootRequestId);
      return !chain.ended && [binding.context.parentRequestId, activeRequestId].includes(chain.latestRequestId);
    } catch { return false; }
  }

  private continuationDirtyPaths(result: any) {
    const paths = new Set<string>([result.anchor.path, ...result.edges.flatMap((edge: any) => [edge.from.path,edge.to.path]),
      ...result.requests.map((item: any) => item.source.path)]);
    return this.dirtyPaths().filter(path => paths.has(path));
  }

  private investigationContinuationState() {
    const binding = this.continuationBinding, busy = this.continuationBusy;
    const sameOwner = binding && this.project?.id === binding.projectId && this.featureSnapshot()?.activeId === binding.featureId &&
      this.conversationPresentation().snapshot.activeId === binding.conversationId;
    const dirty = sameOwner ? this.continuationDirtyPaths(binding.context.result) : [];
    const current = sameOwner && this.continuationOwnerCurrent(binding);
    return {prepared:sameOwner ? investigationContextDescriptor(binding.context) : null,
      status:!sameOwner ? null : !current ? "stale" : dirty.length ? "blocked" : "ready",
      message:!sameOwner ? "" : !current ? "This checkpoint changed. Prepare its latest decision before sharing." : dirty.length
        ? "Evidence has unsaved edits. Resolve those drafts before sharing saved source." : "Prepared locally. Nothing is shared until Send.",
      busy:busy && busy.projectId === this.project?.id ? {conversationId:busy.conversationId,requestId:busy.requestId,decisionId:busy.decisionId,attemptId:busy.attemptId} : null};
  }

  private resolveInvestigationContinuation(input: any) {
    if (input === undefined) return undefined;
    const descriptor = normalizeInvestigationContextDescriptor(input), binding = this.continuationBinding;
    if (!descriptor || !binding || !this.continuationOwnerCurrent(binding) ||
      JSON.stringify(descriptor) !== JSON.stringify(investigationContextDescriptor(binding.context)))
      throw new Error("Prepare the latest investigation checkpoint before sharing it.");
    if (this.continuationDirtyPaths(binding.context.result).length) throw new Error("Resolve unsaved evidence before sharing saved source.");
    return binding;
  }

  private async readInvestigationContinuation(binding: NonNullable<FoundationHost["continuationBinding"]>, current: () => boolean, activeRequestId?: string) {
    const check = () => {
      if (!current() || !this.continuationOwnerCurrent(binding,activeRequestId)) throw new Error("The investigation checkpoint no longer owns this project, feature or conversation.");
      if (this.continuationDirtyPaths(binding.context.result).length) throw new Error("Evidence has unsaved edits. Resolve those drafts before sharing saved source.");
    };
    check();
    if (!await this.service.validateInvestigation(binding.projectId,binding.context.result,{isCurrent:current}))
      throw new Error("Saved source changed or could not be verified. End this chain and prepare a new source investigation.");
    check();
    const file: ProjectFile = await this.service.getFile(binding.projectId,binding.context.result.anchor.path);
    check();
    if (file.revision !== binding.context.result.anchor.revision) throw new Error("The investigation source changed. Prepare a new source investigation.");
    return file;
  }

  private async resolveProviderInvestigationContinuation(input: any) {
    const active = this.asking, binding = this.continuationBinding;
    const {projectId,...descriptor} = input;
    if (!active || !binding || projectId !== this.project?.id || !active.investigationContinuation || active.abort.signal.aborted ||
      JSON.stringify(normalizeInvestigationContextDescriptor(descriptor)) !== JSON.stringify(active.investigationContinuation) ||
      JSON.stringify(investigationContextDescriptor(binding.context)) !== JSON.stringify(active.investigationContinuation))
      throw new Error("This investigation continuation is no longer active.");
    const current = () => this.asking === active && !active.abort.signal.aborted && active.continuationGuard?.() !== false;
    await this.readInvestigationContinuation(binding,current,active.requestId);
    return binding.context;
  }

  private async investigationContinuationAction(message: any) {
    const project = this.project, feature = this.featureSnapshot(), view = this.assistantView;
    if (!project || !view || !feature?.activeId || !vscode.workspace.isTrusted || this.disposed) return;
    const store = this.conversations(project), history = store.snapshot();
    if (message.projectId !== project.id || message.featureId !== feature.activeId || message.featureRevision !== feature.revision ||
      message.conversationId !== history.activeId) throw new Error("The investigation's project, feature or conversation changed.");
    const chat = history.conversations.find(item => item.id === history.activeId);
    if (!chat || chat.archived) throw new Error("Open the investigation's saved conversation.");
    const reply = (extra: any) => { if (this.assistantView === view && this.project?.id === project.id && store.snapshot().activeId === chat.id)
      void view.webview.postMessage({type:"investigationContinuationResult",projectId:project.id,featureId:feature.activeId,
        featureRevision:feature.revision,conversationId:chat.id,requestId:message.requestId,prepareId:message.prepareId,action:message.action,...extra}); };
    if (message.action === "stop") {
      const busy = this.continuationBusy;
      if (busy && busy.projectId === project.id && busy.conversationId === chat.id && busy.requestId === message.requestId && busy.attemptId === message.attemptId) {
        busy.stopped = true; this.sendState();
      }
      return;
    }
    if (this.asking || this.continuationBusy) throw new Error("Stop or finish the current investigation step first.");
    if (message.action === "remove") {
      const descriptor = normalizeInvestigationContextDescriptor(message.investigationContinuation);
      if (descriptor ? this.continuationBinding && JSON.stringify(descriptor) === JSON.stringify(investigationContextDescriptor(this.continuationBinding.context)) : this.continuationPrepareId && message.prepareId === this.continuationPrepareId) {
        this.continuationBinding = undefined; this.continuationPrepareId = undefined; this.continuationGeneration = (this.continuationGeneration || 0) + 1; this.sendState();
      }
      return;
    }
    try {
      if (message.action === "end") {
        await store.endInvestigationChain({conversationId:chat.id,rootRequestId:message.rootRequestId,expectedLatestRequestId:message.requestId});
        this.continuationBinding = undefined; this.continuationPrepareId = undefined; this.continuationGeneration = (this.continuationGeneration || 0) + 1;
        this.sendState(); reply({ok:true}); return;
      }
      const turn = chat.turns.find(item => item.requestId === message.requestId);
      if (!turn) throw new Error("The investigation checkpoint is no longer available.");
      const epoch = this.relationshipEpoch || 0;
      const ownerCurrent = () => !this.disposed && vscode.workspace.isTrusted && this.project?.id === project.id && this.project.root === project.root &&
        this.assistantView === view && this.featureSnapshot()?.activeId === feature.activeId && this.featureSnapshot()?.revision === feature.revision &&
        epoch === (this.relationshipEpoch || 0) && store.snapshot().activeId === chat.id && !store.snapshot().conversations.find(item => item.id === chat.id)?.archived;
      if (message.action === "prepare" || message.action === "refresh") {
        if (typeof message.prepareId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(message.prepareId)) throw new Error("Prepare a new investigation request.");
        const generation = this.continuationGeneration = (this.continuationGeneration || 0) + 1;
        this.continuationPrepareId = message.prepareId;
        const context = deriveInvestigationContext(chat,turn.requestId);
        if (context.result.featureId !== feature.activeId || context.result.featureRevision !== feature.revision)
          throw new Error("The feature changed. Start a new source investigation.");
        const binding = {context,projectId:project.id,root:project.root,featureId:feature.activeId,featureRevision:feature.revision,conversationId:chat.id,epoch};
        this.continuationBinding = binding;
        const current = () => ownerCurrent() && !this.asking && generation === this.continuationGeneration;
        const file = await this.readInvestigationContinuation(binding,current);
        if (!current()) return;
        this.assistantContextRestore = {requestId:message.prepareId,projectId:project.id,featureId:feature.activeId,conversationId:chat.id,paths:[file.path]};
        this.assistantContextFiles = [file]; this.assistantContextEpoch = this.featureSourceEpoch || 0;
        this.sendState();
        void view.webview.postMessage({type:"investigationContinuationPrepared",projectId:project.id,featureId:feature.activeId,
          featureRevision:feature.revision,conversationId:chat.id,requestId:turn.requestId,prepareId:message.prepareId,
          investigationContext:context,context:[{path:file.path,revision:file.revision}],prompt:"Continue investigating this question using the disclosed source evidence. Choose one supported next step, or finish."});
        return;
      }
      if (message.action !== "run" || !turn.investigationContext || !turn.investigationDecision || turn.investigationDecision.id !== message.decisionId)
        throw new Error("Choose a saved investigation decision.");
      const decision = validateInvestigationDecision(turn.investigationDecision,turn.investigationContext,project.id);
      if (decision.decision.kind !== "investigate") throw new Error("This investigation is finished.");
      if (turn.investigationContext.result.featureId !== feature.activeId || turn.investigationContext.result.featureRevision !== feature.revision)
        throw new Error("The feature changed. Start a new source investigation.");
      const busy = {projectId:project.id,conversationId:chat.id,requestId:turn.requestId,decisionId:decision.id,attemptId:randomBytes(16).toString("hex"),stopped:false};
      this.continuationBusy = busy;
      this.continuationBinding = undefined; this.continuationPrepareId = undefined; this.continuationGeneration = (this.continuationGeneration || 0) + 1;
      this.sendState();
      let reserved = false;
      const current = () => this.continuationBusy === busy && !busy.stopped && ownerCurrent() && !this.asking;
      try {
        await store.startInvestigationAttempt({conversationId:chat.id,requestId:turn.requestId,decisionId:decision.id,attemptId:busy.attemptId});
        reserved = true;
        if (!current()) throw new Error("The local investigation stopped before analysis.");
        if (this.continuationDirtyPaths(turn.investigationContext.result).length) throw new Error("Evidence has unsaved edits. Resolve those drafts before running this investigation.");
        if (!await this.service.validateInvestigation(project.id,turn.investigationContext.result,{isCurrent:current}))
          throw new Error("Saved source changed. End this chain and prepare a new source investigation.");
        if (!current()) throw new Error("The local investigation stopped.");
        if (this.continuationDirtyPaths(turn.investigationContext.result).length) throw new Error("Evidence acquired unsaved edits before analysis. Resolve those drafts before retrying.");
        const graph = await this.service.relationships(project.id,decision.decision.target.path,{isCurrent:current});
        if (!current()) throw new Error("The local investigation stopped.");
        const result = createSourceInvestigation({projectId:project.id,featureId:feature.activeId,featureRevision:feature.revision,graph});
        if (result.basisDigest !== turn.investigationContext.result.basisDigest || this.continuationDirtyPaths(result).length ||
          !await this.service.validateInvestigation(project.id,result,{isCurrent:current}))
          throw new Error("Saved evidence changed during analysis. No result was shared.");
        if (!current()) throw new Error("The local investigation stopped.");
        if (this.continuationDirtyPaths(result).length) throw new Error("Evidence acquired unsaved edits during analysis. No result was shared.");
        await store.finishInvestigationAttempt({conversationId:chat.id,requestId:turn.requestId,attemptId:busy.attemptId,status:"complete",result});
      } catch (error) {
        if (reserved) {
          try { await store.finishInvestigationAttempt({conversationId:chat.id,requestId:turn.requestId,attemptId:busy.attemptId,
            status:busy.stopped || !ownerCurrent() ? "stopped" : "failed",reason:error instanceof Error ? error.message : "Local investigation failed."}); } catch { /* Storage state remains authoritative; retry never reruns analysis. */ }
        }
        throw error;
      } finally { if (this.continuationBusy === busy) this.continuationBusy = undefined; this.sendState(); }
      reply({ok:true});
    } catch (error) { reply({error:error instanceof Error ? error.message : "The investigation could not continue."}); this.sendState(); }
  }

  private async sourceInvestigationAction(message: any) {
    const view = this.assistantView, project = this.project, feature = this.featureSnapshot();
    if (!view || !project || !feature?.activeId) return;
    if (message.projectId !== project.id || message.featureId !== feature.activeId || message.featureRevision !== feature.revision ||
      (message.conversationId ?? null) !== (this.conversations().snapshot().activeId ?? null) || !vscode.workspace.isTrusted || this.disposed)
      throw new Error("The investigation's project, feature or conversation changed.");
    if (this.asking) throw new Error("Finish the current response before changing its source investigation.");
    if (this.continuationBusy) throw new Error("Stop or finish the current local investigation first.");
    if (message.action === "remove") {
      const descriptor = normalizeSourceInvestigationDescriptor(message.sourceInvestigation);
      if (descriptor ? !this.investigationBinding || descriptor.id !== this.investigationBinding.result.id || descriptor.digest !== this.investigationBinding.result.digest
        : !this.investigationPrepareId || message.prepareId !== this.investigationPrepareId) return;
      this.investigationGeneration = (this.investigationGeneration || 0) + 1;
      this.investigationBinding = undefined; this.investigationPrepareId = undefined; this.sendState(); return;
    }
    const generation = this.investigationGeneration = (this.investigationGeneration || 0) + 1;
    if (!["prepare", "refresh"].includes(message.action) || !validSourcePath(message.anchorPath) ||
      !project.files.some(file => file.path === message.anchorPath) || typeof message.prepareId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(message.prepareId)) throw new Error("Choose an indexed source investigation to prepare.");
    this.investigationPrepareId = message.prepareId;
    const epoch = this.relationshipEpoch || 0, conversationId = message.conversationId ?? null;
    const canReply = () => generation === this.investigationGeneration && this.assistantView === view && !this.disposed &&
      vscode.workspace.isTrusted && this.project?.id === project.id && this.project.root === project.root &&
      (this.conversations().snapshot().activeId ?? null) === conversationId && this.featureSnapshot()?.activeId === feature.activeId;
    const current = () => canReply() && !this.asking && this.featureSnapshot()?.revision === feature.revision && epoch === (this.relationshipEpoch || 0);
    const reply = (extra: any) => { if (canReply()) void view.webview.postMessage({type:"sourceInvestigationResult", prepareId:message.prepareId,
      projectId:project.id,featureId:feature.activeId,featureRevision:feature.revision,conversationId,...extra}); };
    try {
      let graph;
      if (message.action === "prepare") {
        const state = this.relationshipState();
        if (!state || state.status !== "ready" || state.snapshotId !== message.snapshotId || state.anchorPath !== message.anchorPath)
          throw new Error("Refresh relationships before preparing their evidence.");
        graph = this.relationshipSnapshot;
      } else graph = await this.service.relationships(project.id, message.anchorPath, {isCurrent:current});
      if (!current()) throw new Error("The source or feature changed during investigation. Refresh to try again.");
      const result = createSourceInvestigation({projectId:project.id,featureId:feature.activeId,featureRevision:feature.revision,graph});
      const binding = {result,graph,projectId:project.id,root:project.root,featureId:feature.activeId,
        featureRevision:feature.revision,conversationId,epoch};
      this.investigationBinding = binding;
      const file = await this.readSourceInvestigation(binding, current);
      if (!current()) return;
      const owner = {requestId:message.prepareId,projectId:project.id,featureId:feature.activeId,conversationId,paths:[file.path]};
      this.assistantRestoreGeneration = (this.assistantRestoreGeneration || 0) + 1;
      this.assistantContextRestore = owner; this.assistantContextFiles = [file]; this.assistantContextEpoch = this.featureSourceEpoch || 0;
      this.sendState();
      void view.webview.postMessage({type:"sourceInvestigationPrepared",prepareId:message.prepareId,projectId:project.id,
        featureId:feature.activeId,featureRevision:feature.revision,conversationId,sourceInvestigation:result,
        context:[{path:file.path,revision:file.revision}],prompt:"Explain these source relationships, the behavior they support, and what remains unknown."});
    } catch (error) {
      if (generation === this.investigationGeneration) { this.investigationBinding = undefined; this.sendState(); }
      reply({error:error instanceof Error ? error.message : "Source investigation could not finish. Refresh to try again."});
    }
  }

  private async relationshipAction(message: any) {
    const project = this.project, feature = this.featureSnapshot();
    if (!project || !feature?.activeId || !vscode.workspace.isTrusted || this.disposed || message.projectId !== project.id ||
      message.featureId !== feature.activeId || message.featureRevision !== feature.revision)
      throw new Error("The feature changed. Review its relationships before continuing.");
    if (message.action === "focus") {
      if (!validSourcePath(message.path) || !project.files.some(file => file.path === message.path)) throw new Error("Choose indexed source in this project.");
      await this.loadRelationships({path: message.path, navigation: "focus"}); return;
    }
    if (["back", "reset", "refresh"].includes(message.action)) {
      await this.loadRelationships(message.action === "refresh" ? {force: true} : {navigation: message.action}); return;
    }
    const state = this.relationshipState(), owner = this.relationshipOwner, graph = this.relationshipSnapshot;
    if (message.action === "investigate") {
      if (!state || state.status !== "ready" || !owner || !graph || !state.snapshotId || message.snapshotId !== state.snapshotId)
        throw new Error("Refresh relationships before preparing a source investigation.");
      if (this.asking) throw new Error("Finish the current response before preparing another investigation.");
      this.investigationOffer = {projectId:project.id, featureId:feature.activeId, featureRevision:feature.revision,
        conversationId:this.conversations().snapshot().activeId ?? null, anchorPath:owner.anchorPath, snapshotId:state.snapshotId};
      this.assistantPreparation = undefined; this.featurePreparation = undefined;
      await this.showAssistant(); this.flushAssistantPreparation(); return;
    }
    if (message.action !== "navigate" || !state || state.status !== "ready" || !owner || !graph || !state.snapshotId || message.snapshotId !== state.snapshotId ||
      !["source", "definition"].includes(message.target)) throw new Error("Refresh relationships before opening this source evidence.");
    const edge = graph.edges.find((item: any) => item.id === message.evidenceId);
    const request = graph.requests.find((item: any) => item.id === message.evidenceId);
    const target = edge ? message.target === "definition" ? edge.to : edge.from : message.target === "source" ? request?.source : null;
    if (!target) throw new Error("Choose source evidence from the current relationships.");
    const references: any[] = [graph.anchor, ...(edge ? [edge.from, edge.to] : [request.source])];
    const generation = this.relationshipGeneration, id = state.snapshotId;
    const navigation = this.relationshipNavigationGeneration = (this.relationshipNavigationGeneration || 0) + 1;
    const focus = this.focusGeneration || 0;
    const graphCurrent = () => this.relationshipGeneration === generation && this.relationshipSnapshotId === id && this.relationshipOwnerCurrent(owner);
    const current = () => graphCurrent() && this.relationshipNavigationGeneration === navigation && (this.focusGeneration || 0) === focus;
    const check = () => {
      if (!current()) throw new Error("The relationships changed. Refresh before opening evidence.");
      if (references.some(ref => this.dirtyPaths().includes(ref.path))) throw new Error("This evidence uses saved source. Save or discard the affected draft before opening its exact location.");
    };
    const stale = () => {
      if (current()) { this.invalidateRelationships(); this.queueRefresh(); }
      return new Error("Source evidence changed. Refresh relationships before opening it.");
    };
    check();
    if (!await this.service.validateRelationships(project.id, graph, {isCurrent: current})) throw stale();
    check();
    for (const ref of [...new Map(references.map(ref => [ref.path, ref])).values()]) {
      const file: ProjectFile = await this.service.getFile(project.id, ref.path);
      check(); if (file.revision !== ref.revision) throw stale();
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(project.root, target.path)));
    check();
    if (document.isDirty) throw new Error("This evidence uses saved source. Save or discard the affected draft before opening its exact location.");
    if (createHash("sha256").update(document.getText()).digest("hex").slice(0, 16) !== target.revision) throw stale();
    const line = validLine(target.line) - 1, column = Math.max(0, (target.column || 1) - 1);
    if (line >= document.lineCount) throw stale();
    const range = new vscode.Range(line, column, line, column);
    check();
    const editor = await vscode.window.showTextDocument(document, {viewColumn: this.sourceColumn(), preserveFocus: false, selection: range});
    if (!graphCurrent() || this.relationshipNavigationGeneration !== navigation || vscode.window.activeTextEditor && vscode.window.activeTextEditor !== editor) return;
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    this.lastDocument = document.uri; this.queueRefresh();
  }

  private async featureAction(message: any) {
    if (this.runtimeMatrixTask && !["prepare", "retry"].includes(message.action)) throw new Error("Stop the condition matrix before changing its feature.");
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted || message.projectId !== project.id) throw new Error("Choose a feature in the current trusted project.");
    if (this.asking && message.action !== "retry") throw new Error("Stop the current response before changing its feature context.");
    const store = this.features(project), snapshot = store.snapshot();
    if (message.action !== "retry" && message.expectedRevision !== snapshot.revision) throw new Error("The feature changed. Review its saved version before trying again.");
    if (message.input?.paths !== undefined) {
      const existing = message.action === "update" ? snapshot.features.find(feature => feature.id === message.id)?.paths || [] : [];
      if (!Array.isArray(message.input.paths) || message.input.paths.some((path: unknown) => !validSourcePath(path) || !project.files.some(file => file.path === path) && !existing.includes(path as string)))
        throw new Error("Choose files from this project's indexed source.");
    }
    if (this.scenarioCapture && !["prepare", "retry"].includes(message.action))
      await this.endScenarioRun("interrupted", "not-assessed", "", "The feature workspace changed during this observation.");
    this.featurePreparation = undefined;
    if (message.action === "prepare") {
      if (snapshot.storage.status !== "saved" || message.id !== snapshot.activeId) throw new Error("Save and select this feature before preparing Assistant context.");
      await this.loadFeatureFiles();
      if (this.project?.id !== project.id || !vscode.workspace.isTrusted || store.snapshot().revision !== snapshot.revision) throw new Error("The feature changed while its files were loading.");
      const paths = (this.featureFiles || []).filter(file => !this.dirtyPaths().includes(file.path)).slice(0, 8).map(file => file.path);
      if (!paths.length) throw new Error("Choose at least one available saved file without an unsaved draft.");
      this.assistantPreparation = undefined;
      this.featurePreparation = { projectId: project.id, featureId: snapshot.activeId!, revision: snapshot.revision, paths };
      this.sendState(); await this.showAssistant(); this.flushAssistantPreparation(); return store.snapshot();
    }
    let result: FeatureSnapshot;
    if (message.action === "create") result = await store.create(message.input, message.expectedRevision);
    else if (message.action === "update" && typeof message.id === "string") result = await store.update(message.id, message.input, message.expectedRevision);
    else if (message.action === "select" && (message.id === null || typeof message.id === "string")) result = await store.select(message.id, message.expectedRevision);
    else if (message.action === "archive" && typeof message.id === "string" && typeof message.archived === "boolean") result = await store.archive(message.id, message.archived, message.expectedRevision);
    else if (message.action === "retry") result = await store.retry();
    else throw new Error("Choose an available feature action.");
    if (this.project?.id === project.id && !this.disposed && vscode.workspace.isTrusted) { await this.loadFeatureFiles(); void this.loadRelationships(); this.updateTree(); this.sendState(); }
    return result;
  }

  private runtimeStateSuiteStore(project = this.project) {
    if (!project) throw new Error("Open a project before saving a state suite.");
    this.runtimeStateSuiteStores ||= new Map();
    let store = this.runtimeStateSuiteStores.get(project.id);
    if (!store) {
      const key = `foundation.runtime-state-suites.${project.id}`;
      store = createRuntimeStateSuiteStore({projectId:project.id, read:()=>this.context.workspaceState.get(key),
        write:value=>this.context.workspaceState.update(key,value), onChange:()=>this.queueConversationState(project.id)});
      this.runtimeStateSuiteStores.set(project.id,store);
    }
    return store;
  }

  private runtimeStateSuiteSnapshot() {
    if (!this.project || !vscode.workspace.isTrusted) return null;
    return {...this.runtimeStateSuiteStore().snapshot(),busy:this.runtimeStateSuiteBusy===this.project.id,error:this.runtimeStateSuiteError};
  }

  private runtimeConditionInputs(cells: unknown): ReplayRequested[] {
    if (!Array.isArray(cells) || cells.length<1 || cells.length>12 || cells.some(value =>
      !value || typeof value!=="object" || Object.keys(value).length!==4 || !["light","dark"].includes(value.theme) ||
      !["system","reduce"].includes(value.motion) || ![390,768,960].includes(value.viewportWidthCss) || value.viewportHeightCss!==680))
      throw new Error("Choose one to twelve supported condition combinations.");
    const requested=cells.map(value=>({theme:value.theme,motion:value.motion,viewportWidthCss:value.viewportWidthCss,viewportHeightCss:680})) as ReplayRequested[];
    if (new Set(requested.map(value=>JSON.stringify(value))).size!==requested.length ||
      new Set(requested.map(value=>value.theme)).size*new Set(requested.map(value=>value.motion)).size*new Set(requested.map(value=>value.viewportWidthCss)).size!==requested.length)
      throw new Error("Choose a complete matrix of unique sizes, application themes, and motion inputs.");
    return requested;
  }

  private async runtimeStateSuiteAction(message: any) {
    const project=this.project;let ownsBusy=false;
    try {
      if (!project || !vscode.workspace.isTrusted || message.projectId!==project.id)
        throw new Error("Choose a state suite in the current trusted project.");
      if (this.runtimeStateSuiteBusy || this.runtimeMatrixTask || this.runtimeMatrixRecovery)
        throw new Error("Finish the active suite or matrix action before changing saved state suites.");
      const store=this.runtimeStateSuiteStore(project), saved=store.snapshot();
      if (message.action!=="save" && message.action!=="retry") throw new Error("Choose a state suite action.");
      if (message.action==="save") {
        const definitions=this.runtimeWorkspaceStore(project).snapshot(), features=this.featureSnapshot();
        const feature=features?.features.find(item=>item.id===features.activeId&&!item.archived);
        const screen=definitions.screens.find(item=>item.id===message.screenId&&!item.archived&&item.featureId===feature?.id);
        const scenario=definitions.scenarios.find(item=>item.id===message.scenarioId&&!item.archived&&item.screenId===screen?.id);
        const live=this.runtimeSnapshot(),catalog=live.replayCatalog;
        if (saved.storage.status!=="saved" || saved.revision!==message.expectedRevision ||
          definitions.storage.status!=="saved" || definitions.revision!==message.workspaceRevision || features?.storage.status!=="saved" ||
          features.revision!==message.featureRevision || feature?.id!==message.featureId || !feature?.paths.length || !screen || !scenario ||
          definitions.activeScreenId!==screen.id || definitions.activeScenarioId!==scenario.id)
          throw new Error("Review the current saved feature, screen, scenario, and state suites before saving.");
        const previous=message.id===undefined?undefined:saved.suites.find(item=>item.id===message.id);
        if (message.id!==undefined && (!previous || previous.revision!==message.suiteRevision || previous.featureId!==feature.id ||
          previous.screenId!==screen.id || previous.scenarioId!==scenario.id))
          throw new Error("This saved state suite changed. Review it before updating.");
        if (!this.matrixRuntimeIdentity(live) || live.target?.id!==screen.targetId || live.pagePath!==screen.route || !live.capabilities.scenarioReplay ||
          !catalog || catalog.digest!==message.catalogDigest || catalog.registrationId!==message.registrationId)
          throw new Error("Open this screen and review its current app recipes before saving a state suite.");
        if (!Array.isArray(message.states) || !message.states.length || message.states.length>5 ||
          message.states.some((item:any)=>!item || typeof item!=="object" || Object.keys(item).length!==2 || !["idle","loading","success","error","offline"].includes(item.state) || typeof item.recipeId!=="string") ||
          new Set(message.states.map((item:any)=>item.state)).size!==message.states.length)
          throw new Error("Assign an app recipe to each explicitly selected state.");
        const requested=this.runtimeConditionInputs(message.requested);
        if (requested.length*message.states.length>12 || typeof message.captureEach!=="boolean")
          throw new Error("Choose at most twelve state and condition combinations.");
        const states=message.states.map((item:{state:StateSuiteState;recipeId:string})=>{
          const recipe=catalog.recipes.find(recipe=>recipe.id===item.recipeId&&recipe.route===screen.route);
          if (!recipe) throw new Error("A selected state recipe is unavailable on this screen. Review the app recipes.");
          return {state:item.state,recipe:{...recipe,catalogDigest:catalog.digest}};
        });
        this.runtimeStateSuiteBusy=project.id;ownsBusy=true;this.runtimeStateSuiteError=undefined;this.sendState();
        return await store.save({...(previous?{id:previous.id}:{}),title:message.title,featureId:feature.id,screenId:screen.id,scenarioId:scenario.id,
          states,requested,captureEach:message.captureEach},message.expectedRevision);
      }
      this.runtimeStateSuiteBusy=project.id;ownsBusy=true;this.runtimeStateSuiteError=undefined;this.sendState();
      return await store.retry();
    } catch (error) {
      if (project && this.project?.id===project.id) this.runtimeStateSuiteError=error instanceof Error?error.message:"The state suite could not be saved.";
      throw error;
    } finally {
      if (ownsBusy && this.runtimeStateSuiteBusy===project?.id) this.runtimeStateSuiteBusy=undefined;
      this.sendState();
    }
  }

  private runtimeMatrixStore(project = this.project) {
    if (!project) throw new Error("Open a project before running a condition matrix.");
    this.runtimeMatrixStores ||= new Map();
    let store = this.runtimeMatrixStores.get(project.id);
    if (!store) {
      const key = `foundation.runtime-matrices.v2.${project.id}`, legacyKey = `foundation.runtime-matrices.${project.id}`;
      store = createRuntimeMatrixStore({ projectId: project.id, read: () => { const value=this.context.workspaceState.get(key); return value===undefined?this.context.workspaceState.get(legacyKey):value===null?false:value; },
        write: value => this.context.workspaceState.update(key, value), onChange: () => this.queueConversationState(project.id) });
      this.runtimeMatrixStores.set(project.id, store);
    }
    return store;
  }

  private runtimeMatrixSnapshot() {
    if (!this.project || !vscode.workspace.isTrusted) return null;
    const task = this.runtimeMatrixTask;
    return { ...this.runtimeMatrixStore().snapshot(), busy: task?.projectId === this.project.id || this.runtimeMatrixRecovery?.projectId === this.project.id,
      error: this.runtimeMatrixError, preview: task?.projectId === this.project.id ? task.preview : undefined };
  }

  private interruptRuntimeMatrix(reason = "context-changed") {
    const task = this.runtimeMatrixTask;
    if (!task) return;
    task.reason ||= reason;
    task.controller.abort();
    task.previewWait?.reject(new Error("The matrix stopped before the preview was ready."));
    const replay = this.runtimeReplayTask;
    if (replay && replay.runId === task.runId) {
      replay.reason ||= reason;
      replay.controller.abort();
    }
  }

  private matrixOwnerCurrent(task: NonNullable<FoundationHost["runtimeMatrixTask"]>) {
    return this.runtimeMatrixTask === task && !task.controller.signal.aborted && !this.disposed &&
      vscode.workspace.isTrusted && this.project?.id === task.projectId;
  }

  private matrixRuntimeIdentity(live = this.runtimeSnapshot()) {
    if (live.status !== "connected" || !live.pageConnected || !live.target?.id || !live.session || !live.viewId || !live.documentId ||
      !live.pagePath || !Number.isSafeInteger(live.pageVersion) || live.pageVersion! < 1) return undefined;
    return { targetId: live.target.id, session: live.session, viewId: live.viewId, documentId: live.documentId,
      route: live.pagePath, pageVersion: live.pageVersion! };
  }

  private async requestMatrixPreview(task: NonNullable<FoundationHost["runtimeMatrixTask"]>, cell: MatrixCell,
    phase: "prepare" | "capture", identity: CaptureRuntimeIdentity) {
    if (!this.matrixOwnerCurrent(task) || !task.id || !task.executionId || task.cellId !== cell.id)
      throw new Error("The matrix no longer owns this preview.");
    const preview = { matrixId: task.id, executionId: task.executionId, cellId: cell.id, requested: cell.requested,
      phase, nonce: randomBytes(16).toString("hex"), identity };
    task.preview = preview;
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { task.reason ||= "preview-changed"; reject(new Error("The visible preview did not confirm this condition. Reopen Refine and start a new matrix.")); }, 10000);
      task.previewWait = { resolve, reject, timer };
    });
    this.sendState();
    void this.panel?.webview.postMessage({ type: "runtimeMatrixPreview", projectId: task.projectId, ...preview });
    try { await ready; }
    finally {
      if (task.previewWait) clearTimeout(task.previewWait.timer);
      task.previewWait = undefined;
    }
  }

  private matrixRecipeBinding(recipe: ReplayRecipe) {
    return {id:recipe.id,title:recipe.title,route:recipe.route,fixture:{id:recipe.fixture.id,label:recipe.fixture.label},
      registrationId:recipe.registrationId,catalogDigest:recipe.catalogDigest,steps:recipe.steps.map(step=>({id:step.id,title:step.title}))};
  }

  private matrixChildBinding(run: any) {
    return { startedAt: run.startedAt, definitionRevision: run.definitionRevision, runtime: run.runtime,
      sources: run.sources, dirtyPaths: run.dirtyPaths };
  }

  private async recoverMatrixEvidence(project: ProjectSnapshot, store: ReturnType<typeof createRuntimeMatrixStore>) {
    const workspace = this.runtimeWorkspaceStore(project), replays = this.runtimeReplayStore(project), recovery = this.runtimeMatrixRecovery;
    const own = () => { if (this.disposed || !vscode.workspace.isTrusted || this.project?.id !== project.id || this.runtimeMatrixTask || this.runtimeMatrixRecovery !== recovery)
      throw new Error("The project changed while its matrix evidence was being recovered."); };
    own();
    if (workspace.snapshot().storage.status === "error") { await workspace.retry(); own(); }
    for (const matrix of store.snapshot().matrices) for (const cell of matrix.cells) {
      const run = workspace.snapshot().runs.find(item => item.id === cell.runId);
      if (run?.status === "recording" && this.scenarioCapture?.run.id !== run.id) {
        await workspace.finishRun(run.id, {status:"interrupted", assessment:"not-assessed", note:"", observations:[], truncated:false,
          interruption:"The matrix stopped before its observation could finish. No application action was repeated."}); own();
      }
    }
    if (replays.snapshot().storage.status === "error") { await replays.retry(); own(); }
    for (const matrix of store.snapshot().matrices) for (const cell of matrix.cells) {
      const replay = replays.snapshot().replays.find(item => item.executionId === cell.replayExecutionId);
      if (replay?.status === "running") { await replays.finish(replay.id, {status:"interrupted",reason:"storage-failed"}); own(); }
    }
    await store.retry(); own();
    const captureEntry = store.snapshot().matrices.some(item => item.captureEach) ? this.runtimeCaptureStorage(project) : undefined;
    const captures = captureEntry ? captureEntry.store.reconcile().captures : [];
    for (const matrix of store.snapshot().matrices) for (const cell of matrix.cells) {
      if (matrix.status === "running" || cell.status === "not-run" || cell.status === "running") continue;
      const basis = matrix.basis, recipe = basis.suite?.states.find(item=>item.state===cell.state)?.recipe ?? basis.recipe, run = workspace.snapshot().runs.find(item => item.id === cell.runId);
      if (!run || JSON.stringify(run.feature) !== JSON.stringify(basis.feature) || JSON.stringify(run.screen) !== JSON.stringify(basis.screen) ||
        JSON.stringify(run.scenario) !== JSON.stringify(basis.scenario) || JSON.stringify(run.sources) !== JSON.stringify(basis.sources) ||
        JSON.stringify(run.dirtyPaths) !== JSON.stringify(basis.dirtyPaths)) continue;
      const binding = JSON.stringify(this.matrixChildBinding(run));
      const exact = (item: any) => item.runId === run.id && item.featureId === basis.feature.id && item.screenId === basis.screen.id &&
        item.scenarioId === basis.scenario.id && JSON.stringify(item.binding) === binding;
      const replay = replays.snapshot().replays.find(item => item.executionId === cell.replayExecutionId && exact(item) &&
        JSON.stringify(item.requested) === JSON.stringify(cell.requested) && item.recipe.catalogDigest === recipe.catalogDigest &&
        JSON.stringify(this.matrixRecipeBinding({ ...item.recipe, registrationId: recipe.registrationId })) === JSON.stringify(this.matrixRecipeBinding(recipe)));
      const image = matrix.captureEach && replay ? captures.find(item => exact(item) &&
        Math.abs(item.conditions.viewportWidthCss-cell.requested.viewportWidthCss)<=1 && Math.abs(item.conditions.viewportHeightCss-cell.requested.viewportHeightCss)<=1) : undefined;
      if (image) { await captureEntry!.store.readCapture(image.id); own(); }
      await store.recoverEvidence(matrix.id, cell.id, {runId:run.id, ...(replay ? {replayId:replay.id} : {}), ...(image ? {captureId:image.id} : {})}); own();
    }
  }

  private async runtimeMatrixAction(message: any) {
    const project = this.project;
    try {
      if (!project || !vscode.workspace.isTrusted || message.projectId !== project.id)
        throw new Error("Choose a condition matrix in the current trusted project.");
      if (message.action === "previewReady") {
        const task = this.runtimeMatrixTask, preview = task?.preview;
        if (!task || !preview || !task.previewWait || !this.matrixOwnerCurrent(task) || message.id !== task.id ||
          message.executionId !== task.executionId || message.cellId !== task.cellId || message.nonce !== preview.nonce ||
          JSON.stringify(message.requested) !== JSON.stringify(preview.requested) || JSON.stringify(message.identity) !== JSON.stringify(preview.identity) ||
          JSON.stringify(this.matrixRuntimeIdentity()) !== JSON.stringify(preview.identity) || !this.panel?.visible || this.mode !== "Refine") return;
        task.previewWait.resolve(); return;
      }
      const store = this.runtimeMatrixStore(project);
      if (message.action === "cancel") {
        const task = this.runtimeMatrixTask;
        // begin() publishes its write-ahead record before persistence settles.
        // Stop may bind only that exact pending revision owned by this task.
        if (task && task.projectId === project.id && !task.id && task.pendingBeginRevision !== undefined) {
          const pending = store.snapshot();
          const record = pending.revision === task.pendingBeginRevision ? pending.matrices.find(item => item.status === "running") : undefined;
          if (record && record.id === message.id && record.executionId === message.executionId) { task.id = record.id; task.executionId = record.executionId; }
        }
        if (!task || !task.id || !task.executionId || task.projectId !== project.id || task.id !== message.id || task.executionId !== message.executionId)
          throw new Error("Choose the active matrix to stop.");
        this.interruptRuntimeMatrix("cancelled"); this.sendState(); return;
      }
      if (this.runtimeMatrixTask || this.runtimeMatrixRecovery || this.runtimeStateSuiteBusy) throw new Error("Wait for the active matrix action or suite save to finish before starting another action.");
      if (message.action === "retry") {
        if (this.scenarioCapture || this.runtimeReplayTask || this.runtimeWorkspaceBusy)
          throw new Error("Finish the active observation or replay before recovering matrix storage.");
        const recovery: NonNullable<FoundationHost["runtimeMatrixRecovery"]> = {projectId:project.id};
        this.runtimeMatrixRecovery = recovery; this.sendState();
        recovery.done = this.recoverMatrixEvidence(project, store);
        try { await recovery.done; this.runtimeMatrixError = undefined; return store.snapshot(); }
        finally { if (this.runtimeMatrixRecovery === recovery) this.runtimeMatrixRecovery = undefined; this.sendState(); }
      }
      if (message.action !== "start") throw new Error("Choose a condition matrix action.");
      const workspace = this.runtimeWorkspaceStore(project), definitions = workspace.snapshot(), features = this.featureSnapshot();
      const feature = features?.features.find(item => item.id === features.activeId && !item.archived);
      const screen = definitions.screens.find(item => item.id === message.screenId && !item.archived && item.featureId === feature?.id);
      const scenario = definitions.scenarios.find(item => item.id === message.scenarioId && !item.archived && item.screenId === screen?.id);
      const runtime = this.runtime, panel = this.panel, initial = this.runtimeSnapshot(), catalog = initial.replayCatalog;
      const suiteStore=message.suiteId===undefined?undefined:this.runtimeStateSuiteStore(project), suiteState=suiteStore?.snapshot();
      const suite=suiteState?.suites.find(item=>item.id===message.suiteId);
      if (message.suiteId!==undefined && (!suite || suiteState?.storage.status!=="saved" || suiteState.revision!==message.suiteStoreRevision ||
        suite.revision!==message.suiteRevision || suite.featureId!==feature?.id || suite.screenId!==screen?.id || suite.scenarioId!==scenario?.id))
        throw new Error("Review this saved state suite and its current feature, screen, and scenario before running it.");
      const recipe = catalog?.recipes.find(item => item.id === (suite?suite.states[0].recipe.id:message.recipeId) && item.route === screen?.route);
      const recipes=suite?suite.states.map(item=>item.recipe):recipe?[{...recipe,catalogDigest:catalog?.digest}]:[];
      const recipeMetadata=(value:any)=>value?JSON.stringify({id:value.id,title:value.title,route:value.route,
        fixture:{id:value.fixture.id,label:value.fixture.label},steps:value.steps.map((step:any)=>({id:step.id,title:step.title}))}):undefined;
      const recipesMatch=(currentCatalog:NonNullable<RuntimeSnapshot["replayCatalog"]>)=>recipes.every(frozen=>
        frozen.catalogDigest===currentCatalog.digest && recipeMetadata(currentCatalog.recipes.find(item=>item.id===frozen.id))===recipeMetadata(frozen));
      const current = store.snapshot(), replayStore = this.runtimeReplayStore(project), replaySnapshot = replayStore.snapshot();
      if (current.storage.status !== "saved" || current.revision !== message.expectedRevision || current.matrices.some(item => item.status === "running") ||
        definitions.storage.status !== "saved" || definitions.revision !== message.workspaceRevision || features?.storage.status !== "saved" ||
        features.revision !== message.featureRevision || feature?.id !== message.featureId || !feature?.paths.length || !screen || !scenario ||
        definitions.activeScreenId !== screen.id || definitions.activeScenarioId !== scenario.id)
        throw new Error("Review the current saved feature, screen, scenario, and matrix history before starting.");
      if (this.scenarioCapture || this.runtimeWorkspaceBusy || this.runtimeReplayTask || definitions.runs.some(item => item.status === "recording") ||
        replaySnapshot.storage.status !== "saved" || replaySnapshot.replays.some(item => item.status === "running"))
        throw new Error("Finish the current observation or replay and save its history before starting a matrix.");
      if (!runtime || !panel?.visible || this.mode !== "Refine" || !this.matrixRuntimeIdentity(initial) || initial.target?.id !== screen.targetId ||
        initial.pagePath !== screen.route || !initial.capabilities.scenarioReplay || initial.replayBlocked || !recipe ||
        !catalog || catalog.digest !== message.catalogDigest || catalog.registrationId !== message.registrationId || !recipesMatch(catalog))
        throw new Error("Open this screen in Refine and review its current app recipe before starting a matrix.");
      const requested=this.runtimeConditionInputs(suite?suite.requested:message.requested), captureEach=suite?suite.captureEach:message.captureEach;
      const cells=suite?suite.states.flatMap(item=>requested.map(condition=>({state:item.state,requested:condition}))):requested;
      if (cells.length>12 || typeof captureEach!=="boolean") throw new Error("Choose at most twelve state and condition combinations.");
      const task: NonNullable<FoundationHost["runtimeMatrixTask"]> = { projectId:project.id, controller:new AbortController() };
      this.runtimeMatrixTask = task; this.runtimeMatrixError = undefined; this.sendState();
      const epoch = this.featureSourceEpoch, sources: {path:string;revision:string}[] = [];
      let expectedWorkspaceRevision = definitions.revision;
      let expectedIdentity: CaptureRuntimeIdentity | undefined = this.matrixRuntimeIdentity(initial);
      const fail = (reason: string, text: string): never => { task.reason ||= reason; throw new Error(text); };
      const guard = async () => {
        const owns = () => this.matrixOwnerCurrent(task) && this.runtime === runtime && this.panel === panel && panel.visible && this.mode === "Refine";
        const check = () => {
          if (!owns()) fail(task.reason || "context-changed", "The matrix stopped because its project or visible preview changed. Earlier effects may remain.");
          if (this.featureSourceEpoch !== epoch) fail("source-changed", "Saved source changed during the matrix. Start a new matrix after reviewing it.");
          if (suite && (suiteStore!.snapshot().storage.status!=="saved" || suiteStore!.snapshot().revision!==suiteState!.revision ||
            JSON.stringify(suiteStore!.snapshot().suites.find(item=>item.id===suite.id))!==JSON.stringify(suite)))
            fail("context-changed", "The saved state suite changed. Review it before starting a new run.");
          const state = this.featureSnapshot(), definitionsNow = workspace.snapshot();
          if (state?.revision !== features.revision || state.activeId !== feature.id || state.storage.status !== "saved" ||
            definitionsNow.storage.status !== "saved" || definitionsNow.revision !== expectedWorkspaceRevision ||
            definitionsNow.activeScreenId !== screen.id || definitionsNow.activeScenarioId !== scenario.id ||
            JSON.stringify(definitionsNow.screens.find(item => item.id === screen.id)) !== JSON.stringify(screen) ||
            JSON.stringify(definitionsNow.scenarios.find(item => item.id === scenario.id)) !== JSON.stringify(scenario))
            fail("context-changed", "The feature, screen, scenario, or observation history changed during the matrix.");
          const live = runtime.snapshot();
          if (live.session !== initial.session || live.target?.id !== initial.target?.id || expectedIdentity && this.validateScenarioRuntime(expectedIdentity))
            fail("runtime-changed", "The matrix runtime changed. Open the screen and start a new matrix.");
        };
        check();
        for (const source of sources) {
          let file: ProjectFile;
          try { file = await this.service.getFile(project.id, source.path); } catch { return fail("source-changed", "A saved source file is no longer available."); }
          check();
          if (createHash("sha256").update(file.source).digest("hex") !== source.revision) fail("source-changed", "Saved source changed during the matrix.");
        }
        if (JSON.stringify(this.dirtyPaths().filter(path => feature.paths.includes(path)).sort()) !== JSON.stringify(dirtyPaths))
          fail("source-changed", "The matrix's unsaved source context changed.");
        check();
      };
      const dirtyPaths = this.dirtyPaths().filter(path => feature.paths.includes(path)).sort();
      task.done = (async () => {
        try {
          await guard();
          for (const path of feature.paths) {
            const file: ProjectFile = await this.service.getFile(project.id, path);
            sources.push({path,revision:createHash("sha256").update(file.source).digest("hex")}); await guard();
          }
          const basis: MatrixBasis = {feature:{id:feature.id,title:feature.title,revision:features.revision,paths:[...feature.paths]}, screen, scenario,
            definitionRevision:definitions.revision, sources, dirtyPaths, recipe:suite?{...suite.states[0].recipe,registrationId:catalog!.registrationId}:{...recipe,registrationId:catalog!.registrationId,catalogDigest:catalog!.digest},
            ...(suite?{suite:{id:suite.id,title:suite.title,revision:suite.revision,states:suite.states.map(item=>({state:item.state,recipe:{...item.recipe,registrationId:catalog!.registrationId}}))}}:{})};
          const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
          const count = cells.length;
          // Conservative admission budgets reserve the bounded evidence each cell
          // may produce. Final stores still enforce their authoritative quotas.
          if (current.matrices.length >= 40 || definitions.runs.length + count > 40 || replaySnapshot.replays.length + count > 40 ||
            bytes(current) + bytes(basis) + count * 4096 > 2 * 1024 * 1024 ||
            bytes(definitions) + count * (bytes(basis) + 256 * 1024) > 8 * 1024 * 1024 ||
            bytes(replaySnapshot) + count * (bytes(basis) + 16 * 1024) > 2 * 1024 * 1024)
            fail("capacity", "This matrix exceeds the remaining local evidence capacity. Choose fewer conditions; saved history is never evicted.");
          if (captureEach) {
            if (!this.nativeCaptureAvailable) fail("capture-failed", "This Foundation build cannot capture the running canvas.");
            const entry = this.runtimeCaptureStorage(project), captureState = entry.store.reconcile();
            if (captureState.storage.status !== "saved") fail("storage-failed", "Save or recover the image history before capturing a matrix.");
            if (captureState.captures.length + count > 40 || bytes(captureState) + count * (bytes(basis) + 4096) > 1024 * 1024 ||
              entry.files.availableBytes() < count * 8 * 1024 * 1024 + 2 * 1024 * 1024)
              fail("capacity", "There is not enough local image capacity for every condition at the 8 MiB capture limit. Choose fewer conditions or turn off Capture each result; no history will be deleted.");
          }
          await guard();
          task.pendingBeginRevision = current.revision + 1;
          let matrix;
          try { matrix = await store.begin({basis,cells,captureEach}, message.expectedRevision); }
          finally { task.pendingBeginRevision = undefined; }
          task.id = matrix.id; task.executionId = matrix.executionId; await guard();
          for (const cell of matrix.cells) {
            const cellRecipe=matrix.basis.suite?.states.find(item=>item.state===cell.state)?.recipe ?? matrix.basis.recipe;
            task.cellId = cell.id; task.runId = cell.runId;
            await store.beginCell(matrix.id,cell.id); await guard();
            await this.requestMatrixPreview(task,cell,"prepare",expectedIdentity!); await guard();
            const previousDocument = expectedIdentity!.documentId, previousView = expectedIdentity!.viewId;
            expectedIdentity = undefined;
            const navigated = await runtime.navigate(screen.route); await guard();
            const expectedView = navigated.viewId;
            if (!expectedView || expectedView === previousView)
              fail("runtime-changed", "The matrix could not open a fresh runtime view.");
            const deadline = Date.now() + 10000;
            let fresh: RuntimeSnapshot | undefined;
            while (Date.now() < deadline) {
              await guard();
              const live = await runtime.readCurrent(); await guard();
              if (live.viewId !== expectedView) fail("runtime-changed", "Another runtime view replaced the matrix document.");
              const identity = this.matrixRuntimeIdentity(live);
              if (identity && identity.documentId !== previousDocument && identity.route === screen.route && live.replayCatalog) {fresh=live;expectedIdentity=identity;break;}
              await new Promise(resolve => setTimeout(resolve,100));
            }
            if (!fresh || !expectedIdentity) fail("timeout", "The fresh matrix document did not connect in time.");
            const freshCatalog = fresh!.replayCatalog!;
            if (!fresh!.capabilities.scenarioReplay || fresh!.replayBlocked || freshCatalog.digest !== catalog!.digest || !recipesMatch(freshCatalog))
              fail("recipe-changed", "The app recipe changed in the fresh document. Review it before starting another matrix.");
            await this.requestMatrixPreview(task,cell,"prepare",expectedIdentity!); await guard();
            await this.runtimeWorkspaceAction({action:"beginRun",projectId:project.id,scenarioId:scenario.id,expectedRevision:workspace.snapshot().revision},task);
            expectedWorkspaceRevision = workspace.snapshot().revision;
            const run = workspace.snapshot().runs.find(item => item.id === cell.runId);
            if (!run || this.scenarioCapture?.run.id !== cell.runId || run.status !== "recording" || JSON.stringify(run.sources) !== JSON.stringify(sources) ||
              JSON.stringify(run.dirtyPaths) !== JSON.stringify(dirtyPaths)) fail("observation-failed", "The matrix observation did not start with its reserved source and document.");
            await store.linkEvidence(matrix.id,cell.id,{runId:run!.id}); await guard();
            await this.runtimeReplayAction({action:"start",projectId:project.id,runId:run!.id,expectedRevision:replayStore.snapshot().revision,
              recipeId:cellRecipe.id,catalogDigest:freshCatalog.digest,registrationId:freshCatalog.registrationId,requested:cell.requested},task);
            const replay = replayStore.snapshot().replays.find(item => item.executionId === cell.replayExecutionId);
            if (replay && replayStore.snapshot().storage.status === "saved") await store.linkEvidence(matrix.id,cell.id,{replayId:replay.id});
            if (!replay || replayStore.snapshot().storage.status !== "saved") fail("storage-failed", "The replay evidence could not be saved. Retry storage; no application action will repeat.");
            if (replay!.status !== "completed") fail(replay!.reason || "step-failed", "A condition did not finish. The remaining conditions were not run.");
            await guard();
            if (matrix.captureEach) {
              await this.requestMatrixPreview(task,cell,"capture",expectedIdentity!); await guard();
              const capture = this.scenarioCapture;
              if (!capture || capture.run.id !== cell.runId) fail("observation-failed", "The matrix observation changed before capture.");
              let image;
              try { image = await this.captureScenarioImage(capture!,task); } catch { return fail(task.reason || "capture-failed", "The canvas could not be captured safely. The remaining conditions were not run."); }
              await guard();
              if (Math.abs(image.conditions.viewportWidthCss - cell.requested.viewportWidthCss) > 1 || Math.abs(image.conditions.viewportHeightCss - cell.requested.viewportHeightCss) > 1)
                fail("preview-changed", "The captured viewport did not match this condition.");
              await store.linkEvidence(matrix.id,cell.id,{captureId:image.id}); await guard();
            }
            const observed = await runtime.readCurrent(); await guard();
            await this.reconcileScenarioRun(observed); await guard();
            await this.runtimeWorkspaceAction({action:"finishRun",projectId:project.id,id:run!.id,expectedRevision:workspace.snapshot().revision,assessment:"not-assessed",note:""},task);
            expectedWorkspaceRevision = workspace.snapshot().revision;
            if (workspace.snapshot().runs.find(item => item.id === cell.runId)?.status !== "completed")
              fail("observation-failed", "The matrix observation could not finish.");
            await guard(); await store.finishCell(matrix.id,cell.id,{status:"completed"}); await guard();
          }
          await store.finishMatrix(matrix.id,{status:"completed"});
        } catch (error) {
          task.reason ||= [store.snapshot().storage.status,workspace.snapshot().storage.status,replayStore.snapshot().storage.status].includes("error") ? "storage-failed" : "transport-failed";
          this.interruptRuntimeMatrix(task.reason);
          if (this.runtimeReplayTask?.runId === task.runId) await this.stopRuntimeReplay(task.reason);
          if (this.scenarioCapture?.run.id === task.runId) await this.endScenarioRun(task.reason === "cancelled" ? "cancelled" : "interrupted", "not-assessed", "", "The condition matrix stopped. Earlier application effects may remain.").catch(() => {});
          const status = task.reason === "cancelled" ? "cancelled" : ["step-failed","capture-failed","observation-failed","capacity"].includes(task.reason) ? "failed" : "interrupted";
          const reason = (MATRIX_REASONS as readonly string[]).includes(task.reason) ? task.reason as MatrixReason : "transport-failed";
          const matrix = store.snapshot().matrices.find(item => item.id === task.id);
          if (matrix?.status === "running" && store.snapshot().storage.status === "saved") {
            const cell = matrix.cells.find(item => item.id === task.cellId);
            if (cell?.status === "running") await store.finishCell(matrix.id,cell.id,{status,reason}).catch(() => {});
            if (store.snapshot().storage.status === "saved") await store.finishMatrix(matrix.id,{status,reason}).catch(() => {});
          }
          if (this.project?.id === project.id) this.runtimeMatrixError = error instanceof Error ? error.message : "The condition matrix stopped. No condition will restart automatically.";
        } finally {
          if (task.previewWait) { clearTimeout(task.previewWait.timer); task.previewWait = undefined; }
          task.preview = undefined;
          if (this.runtimeMatrixTask === task) this.runtimeMatrixTask = undefined;
          this.sendState();
        }
      })();
      await task.done;
      return store.snapshot();
    } catch (error) {
      if (project && this.project?.id === project.id) this.runtimeMatrixError = error instanceof Error ? error.message : "The matrix action could not finish.";
      this.sendState(); throw error;
    }
  }

  private alternativeKey(project = this.project) { return project ? `${project.id}\0${project.root}` : ""; }

  private alternativesBusy() {
    return Boolean(this.aiAlternativeReview || this.visualAlternativesOperation || [...(this.visualAlternativesSessions?.values() || [])].some(session => session.snapshot().busy));
  }

  private alternativesSession(project = this.project) {
    if (!project || !vscode.workspace.isTrusted || this.disposed) throw new Error("Open a trusted project before comparing alternatives.");
    this.visualAlternativesSessions ||= new Map();
    const key=this.alternativeKey(project);
    let session=this.visualAlternativesSessions.get(key);
    if (session) return session;
    const storage=this.context.globalStorageUri || this.context.storageUri;
    if (!storage?.fsPath) throw new Error("Local comparison storage is unavailable.");
    const isCurrent=()=>!this.disposed && vscode.workspace.isTrusted && this.alternativeKey()===key;
    session=createVisualAlternativesSession({projectId:project.id,root:project.root,
      storageRoot:join(storage.fsPath,"visual-alternatives",createHash("sha256").update(key).digest("hex")),
      isCurrent,onChange:()=>{if(isCurrent())this.queueConversationState(project.id);},
      preview:input=>this.requestAlternativePreview(project,input),
      capture:input=>this.captureAlternative(project,input)});
    this.visualAlternativesSessions.set(key,session);
    return session;
  }

  private visualAlternativesProposal() {
    const project=this.project, proposal=project && this.proposals().current();
    if (!project || !proposal) return null;
    const runtime=this.runtime?.snapshot(), workspace=this.runtimeWorkspaceStore(project).snapshot(), features=this.features(project).snapshot();
    const impact=proposal.designImpact;
    const eligible=proposal.origin==="design" && proposal.status==="proposed" && impact?.version===1;
    const reason=!eligible ? "Prepare a token change to compare it with saved source." : this.dirtyPaths().includes(proposal.path)
      ? "The token file has an unsaved draft. Compare after resolving that draft." : features.storage.status!=="saved" || workspace.storage.status!=="saved"
      ? "Restore saved feature and scenario definitions first." : runtime?.status!=="connected" || !runtime.replayCatalog || runtime.replayBlocked
      ? "Connect the instrumented app to discover its scenario recipes." : this.visualVerificationWorkBusy() || this.alternativesBusy()
      ? "Finish the current source or runtime action first." : null;
    const scenarios=(eligible ? impact.relatedScenarios || [] : []).map((related:any)=>{
      const feature=features.features.find(item=>item.id===related.featureId && !item.archived), screen=workspace.screens.find(item=>item.id===related.screenId && item.featureId===feature?.id && !item.archived),
        scenario=workspace.scenarios.find(item=>item.id===related.scenarioId && item.screenId===screen?.id && !item.archived);
      const recipes=screen && runtime?.target?.id===screen.targetId ? (runtime.replayCatalog?.recipes || []).filter(item=>item.route===screen.route).map(item=>({...item,catalogDigest:runtime.replayCatalog!.digest})) : [];
      return {featureId:related.featureId,screenId:related.screenId,scenarioId:related.scenarioId,title:scenario?.title || related.scenarioTitle,
        screenTitle:screen?.title || related.screenTitle,recipes,canChoose:Boolean(feature && screen && scenario && recipes.length),
        reason:!feature || !screen || !scenario ? "This saved scenario is unavailable." : !recipes.length ? "No recipe is registered for this screen." : null};
    });
    return {id:proposal.id,proposalBasis:visualVerificationDigest(proposal),title:proposal.title,path:proposal.path,
      canPrepare:!reason && scenarios.some((item:any)=>item.canChoose),reason:reason || (!scenarios.some((item:any)=>item.canChoose) ? "Connect a related screen with an app-authored recipe." : null),scenarios};
  }

  private aiAlternativeOwner(group:any,project=this.project) {
    if(!project || !group || group.origin!=="ai")return undefined;
    const history=this.conversationPresentation(this.conversations(project)).snapshot;
    for(const owner of history.conversations){const turn=owner.turns.find(item=>item.requestId===group.requestId);
      const candidate=turn?.alternatives?.candidates.find(item=>item.changeSet.id===group.id);
      if(turn && candidate)return {history,owner,turn,candidate};}
    return undefined;
  }

  private resolveAlternativeGeneration(input:any,expectedProjectId?:string) {
    if(input===undefined)return undefined;
    const generation=normalizeAlternativeGeneration(input);if(!generation)return undefined;
    const project=this.project;
    if(!project || this.disposed || !vscode.workspace.isTrusted || expectedProjectId!==undefined && expectedProjectId!==project.id)
      throw new Error("Open the trusted project before generating alternatives.");
    if(this.featureSnapshot()?.activeId!==generation.scope.feature.id || !this.alternativeScopeCurrent({scope:generation.scope},project))
      throw new Error("The selected feature, screen or scenario changed. Choose its saved scope again.");
    return generation;
  }

  private resolveProviderAlternativeGeneration(projectId:string,input:any) {
    const active=this.asking;
    if(!active || active.projectId!==projectId || !active.alternativeGeneration || active.abort.signal.aborted || active.terminal || active.alternativeGuard?.()===false ||
      visualVerificationDigest(active.alternativeGeneration)!==visualVerificationDigest(input))throw new Error("This request no longer owns its alternatives scope.");
    return this.resolveAlternativeGeneration(input,projectId);
  }

  private async readAIAlternativeSources(generation:any,context:any[],isCurrent:()=>boolean) {
    const project=this.project;
    if(!project || !isCurrent())throw new Error("This alternatives request no longer owns the project.");
    const guard=()=>{if(!isCurrent() || this.project?.id!==project.id || this.project.root!==project.root ||
      this.dirtyPaths().some(path=>context.some(source=>source.path===path)))throw new Error("The selected source or an unsaved draft changed. Its contents are preserved.");
      this.resolveAlternativeGeneration(generation,project.id);};
    guard();const files=[];
    for(const selected of context){guard();const file:ProjectFile=await this.service.getFile(project.id,selected.path);guard();
      if(file.revision!==selected.revision || selected.source!==undefined && file.source!==selected.source || selected.hash!==undefined && createHash("sha256").update(file.source).digest("hex")!==selected.hash)
        throw new Error("The alternatives source changed. Generate from its current saved version.");
      files.push(file);}
    validateAlternativeGenerationFiles(generation,files);guard();return files;
  }

  private aiAlternativesPresentationDigest(artifact:object) {
    // Saved presentation artifacts are immutable and keep their identity across
    // streamed updates. This display-only cache never authorizes a request or review.
    this.aiAlternativeDisplayDigests ||= new WeakMap();
    let digest=this.aiAlternativeDisplayDigests.get(artifact);
    if(!digest){digest=aiAlternativesDigest(artifact);this.aiAlternativeDisplayDigests.set(artifact,digest);}
    return digest;
  }

  private aiAlternativesSnapshot() {
    const project=this.project;if(!project || !vscode.workspace.isTrusted)return null;
    const presentation=this.conversations(project).presentation(),history=presentation.snapshot,features=this.features(project).snapshot(),workspace=this.runtimeWorkspaceStore(project).presentation().snapshot;
    const feature=features.features.find(item=>item.id===features.activeId && !item.archived),checkpoint=this.changeSetSnapshot(),dirty=this.dirtyPaths();
    const busy=Boolean(this.alternativeWorkBusy(project) || this.alternativesBusy());
    const key=JSON.stringify([this.alternativeKey(project),presentation.epoch,history.revision,history.storage.status,features.revision,features.activeId,features.storage.status,workspace.revision,workspace.storage.status,
      busy,dirty,checkpoint?.storage.status,checkpoint?.current?.id,checkpoint?.current?.revision,checkpoint?.current?.status,checkpoint?.versions?.length,this.aiAlternativeError,this.proposals().current()?.id,this.proposals().current()?.status]);
    if(this.aiAlternativeProjection?.key===key)return this.aiAlternativeProjection.value;
    const reason=features.storage.status!=="saved" || workspace.storage.status!=="saved" || history.storage.status!=="saved" ? "Restore the saved feature, scenarios and conversation first." : !feature ? "Select a feature with a saved screen and scenario." : busy ? "Finish the current source or runtime action first." : null;
    const choices=workspace.scenarios.filter(scenario=>!scenario.archived).flatMap(scenario=>{const screen=workspace.screens.find(item=>item.id===scenario.screenId && item.featureId===feature?.id && !item.archived);if(!screen)return [];
      const generation={version:1,count:2,scope:{feature:{id:feature!.id,title:feature!.title,revision:features.revision,paths:feature!.paths},screen,scenario,definitionRevision:workspace.revision}};
      return [{scenarioId:scenario.id,title:scenario.title,screenTitle:screen.title,generation,canChoose:!reason,reason}];});
    let checkpointReason:string|undefined;try{this.requireNoActiveChangeSet();}catch(error){checkpointReason=error instanceof Error?error.message:"Resolve the current checkpoint.";}
    if(this.proposals().current() && !["discarded","undone"].includes(this.proposals().current().status))checkpointReason="Discard or undo the current single-file proposal first.";
    const reviewChoices=history.conversations.filter(chat=>chat.id===history.activeId && !chat.archived).flatMap(chat=>chat.turns.flatMap(turn=>{
      if(!turn.alternatives)return [];
      const digest=this.aiAlternativesPresentationDigest(turn.alternatives);
      return turn.alternatives.candidates.map(candidate=>{const why=reason || checkpointReason || (turn.state!=="complete" || turn.completedWhileStopping ? "Wait for a normally completed response." :
        !this.alternativeScopeCurrent({scope:turn.alternatives!.generation.scope},project) || turn.alternatives!.generation.scope.feature.id!==feature?.id ? "The saved alternatives scope changed." :
        dirty.some(path=>turn.context.some(source=>source.path===path)) ? "A contributing source has an unsaved draft." :
        checkpoint?.versions?.some((item:any)=>item.group.id===candidate.changeSet.id) ? "This candidate already has a review checkpoint. Open its retained diff or comparison." : null);
        return {conversationId:chat.id,requestId:turn.requestId,artifactId:turn.alternatives!.id,candidateId:candidate.id,digest,canReview:!why,reason:why};});}));
    const value={projectId:project.id,choices,canGenerate:!reason && choices.length>0,reason:reason || (!choices.length?"Add a saved screen and scenario to this feature.":null),busy,error:this.aiAlternativeError,reviewChoices};
    this.aiAlternativeProjection={key,value};return value;
  }

  private async aiAlternativeAction(message:any,surface:Surface) {
    const view=surface==="assistant"?this.assistantView:this.panel;
    try { await this.reviewAIAlternative(message,surface);
      await view?.webview.postMessage({type:"aiAlternativeResult",projectId:message.projectId,artifactId:message.artifactId,candidateId:message.candidateId});
    } catch(error) { await view?.webview.postMessage({type:"aiAlternativeResult",projectId:message.projectId,artifactId:message.artifactId,candidateId:message.candidateId,error:error instanceof Error?error.message:"This candidate could not be reviewed."});throw error; }
  }

  private async reviewAIAlternative(message:any,surface:Surface) {
    const project=this.project;
    if(!project || this.disposed || !vscode.workspace.isTrusted || message.projectId!==project.id || message.action!=="review")throw new Error("Choose a generated alternative in the current trusted project.");
    if(this.alternativeWorkBusy(project) || this.alternativesBusy())throw new Error("Finish the current source or runtime action first.");
    const store=this.conversations(project),history=store.presentation().snapshot;
    const owner=history.conversations.find(chat=>chat.id===message.conversationId && chat.id===history.activeId && !chat.archived),turn=owner?.turns.find(item=>item.requestId===message.requestId);
    if(history.storage.status!=="saved" || !turn?.alternatives || turn.state!=="complete" || turn.completedWhileStopping || turn.alternatives.id!==message.artifactId || aiAlternativesDigest(turn.alternatives)!==message.digest)
      throw new Error("Choose a normally completed alternative in its saved, active conversation.");
    const artifact=normalizeAIAlternatives(turn.alternatives,project.id,turn.context),candidate=artifact.candidates.find(item=>item.id===message.candidateId);
    if(!candidate)throw new Error("Choose a candidate from this saved response.");
    const operation={},epoch=this.featureSourceEpoch || 0,key=this.alternativeKey(project),view=surface==="assistant"?this.assistantView:this.panel;
    this.aiAlternativeReview=operation;this.aiAlternativeError=undefined;
    const guard=()=>{
      if(this.aiAlternativeReview!==operation || this.disposed || !vscode.workspace.isTrusted || this.alternativeKey()!==key || (this.featureSourceEpoch || 0)!==epoch || this.asking ||
        view!==(surface==="assistant"?this.assistantView:this.panel) || this.dirtyPaths().some(path=>turn.context.some(source=>source.path===path)))throw new Error("The review context changed. No project source was changed.");
      const latest=store.presentation().snapshot,chat=latest.conversations.find(item=>item.id===owner!.id);
      if(latest.storage.status!=="saved" || latest.revision!==history.revision || latest.activeId!==owner!.id || !chat || chat.archived)throw new Error("The saved alternatives conversation changed.");
      this.resolveAlternativeGeneration(artifact.generation,project.id);
      const single=this.proposals().current();if(single && !["discarded","undone"].includes(single.status))throw new Error("Discard or undo the current single-file proposal first.");
    };
    try{
      this.sendState();guard();await this.loadChangeSets();guard();this.requireNoActiveChangeSet();
      const session=this.changeSets(),token=session.ownershipToken();
      if(session.snapshot().versions.some((item:any)=>item.group.id===candidate.changeSet.id))throw new Error("This candidate already has a retained review checkpoint.");
      await this.readAIAlternativeSources(artifact.generation,turn.context,()=>{try{guard();return session.ownershipToken()===token;}catch{return false;}});guard();
      const group=validateChangeSet({...candidate.changeSet,requestId:turn.requestId},project.id);
      const stageCurrent=()=>{try{guard();const current=session.snapshot().current;return session.ownershipToken()===token || current?.id===group.id && changeGroupDigest(current)===changeGroupDigest(group);}catch{return false;}};
      const saved=await session.stage(group,{isCurrent:stageCurrent});guard();
      if(saved.storage.status!=="saved" || saved.current?.id!==group.id)throw new Error("The candidate checkpoint could not be saved. Source is unchanged.");
      await this.show("Review");guard();
      const file=saved.current.files[0],before=vscode.Uri.from({scheme:"foundation-snapshot",path:`/before/${basename(file.path)}`,query:randomBytes(8).toString("hex")}),after=vscode.Uri.from({scheme:"foundation-snapshot",path:`/staged/${basename(file.path)}`,query:randomBytes(8).toString("hex")});
      this.snapshots.set(before.toString(),file.before);this.snapshots.set(after.toString(),file.after);
      await vscode.commands.executeCommand("vscode.diff",before,after,`${file.path} · before ↔ staged`,{preview:true,viewColumn:this.sourceColumn()});
    }catch(error){if(this.alternativeKey()===key)this.aiAlternativeError=error instanceof Error?error.message:"This candidate could not be reviewed.";throw error;}
    finally{if(this.aiAlternativeReview===operation)this.aiAlternativeReview=undefined;this.sendState();}
  }

  private alternativeGroupOwner(group:any, project:ProjectSnapshot) {
    const generated=this.aiAlternativeOwner(group,project);
    if(generated){
      if(generated.history.storage.status!=="saved" || generated.owner.archived || generated.turn.state!=="complete" || generated.turn.completedWhileStopping ||
        changeGroupDigest(generated.candidate.changeSet)!==changeGroupDigest(group) || !this.alternativeScopeCurrent({scope:generated.turn.alternatives!.generation.scope},project))
        throw new Error("Restore the completed alternatives and their saved scope before comparing this candidate.");
      return {ownerId:generated.owner.id,turn:generated.turn,historyRevision:generated.history.revision};
    }
    const history=this.conversations(project).presentation().snapshot;
    const owner=history.conversations.find(chat=>chat.turns.some(turn=>turn.requestId===group.requestId && turn.changeSet?.id===group.id));
    const turn=owner?.turns.find(turn=>turn.requestId===group.requestId);
    if(group.origin!=="ai" || history.storage.status!=="saved" || !owner || owner.archived || turn?.state!=="complete" || turn.completedWhileStopping ||
      !turn.changeSet || changeGroupDigest(turn.changeSet)!==changeGroupDigest(group))
      throw new Error("Restore the completed Build group in its saved conversation before preparing a comparison.");
    return {ownerId:owner.id,turn,historyRevision:history.revision};
  }

  private visualAlternativesGroupProposal() {
    const project=this.project, checkpoint=this.changeSetSnapshot(), group=checkpoint?.current;
    if(!project || !group || group.origin!=="ai")return null;
    const features=this.features(project).snapshot(), workspace=this.runtimeWorkspaceStore(project).snapshot(), runtime=this.runtime?.snapshot();
    const feature=features.features.find(item=>item.id===features.activeId && !item.archived), proposal=this.proposals().current();
    let ownerReason:string|null=null;try{this.alternativeGroupOwner(group,project);}catch(error){ownerReason=error instanceof Error?error.message:"Restore the saved Build group.";}
    const scoped=feature && [...group.files,...group.context].every((item:any)=>feature.paths.includes(item.path) && validAlternativeSourcePath(item.path));
    const bytes=(key:"before"|"after")=>group.files.reduce((total:number,file:any)=>total+Buffer.byteLength(file[key]),0);
    const reason=group.status!=="proposed" ? "Prepare a fresh unapplied Build group to compare it." : !this.wholeChangeSetScope(checkpoint)
      ? "Use whole proposal before preparing this comparison." : group.files.length<2 || group.files.length>8 || bytes("before")>65536 || bytes("after")>65536
      ? "Compare two to eight existing application files, up to 64 KiB on each side." : !scoped
      ? "Include every changed and context file in one active feature. Configuration and runtime instrumentation are excluded." : ownerReason
      ? ownerReason : proposal && !["discarded","undone"].includes(proposal.status) ? "Discard the current single-file proposal before comparing this group." : this.dirtyPaths().some(path=>group.context.some((item:any)=>item.path===path))
      ? "A contributing source has an unsaved draft. Resolve it before comparing this group." : checkpoint?.storage.status!=="saved" || features.storage.status!=="saved" || workspace.storage.status!=="saved"
      ? "Restore saved changes, feature and scenario definitions first." : runtime?.status!=="connected" || !runtime.replayCatalog || runtime.replayBlocked
      ? "Connect the instrumented app to discover its scenario recipes." : this.visualVerificationWorkBusy() || this.alternativesBusy()
      ? "Finish the current source or runtime action first." : null;
    const generatedScope=this.aiAlternativeOwner(group,project)?.turn.alternatives?.generation.scope;
    const scenarios=workspace.scenarios.filter(scenario=>!scenario.archived && (!generatedScope || scenario.id===generatedScope.scenario.id && scenario.screenId===generatedScope.screen.id)).flatMap(scenario=>{
      const screen=workspace.screens.find(item=>item.id===scenario.screenId && item.featureId===feature?.id && !item.archived);if(!screen)return [];
      const recipes=runtime?.target?.id===screen.targetId ? (runtime.replayCatalog?.recipes || []).filter(item=>item.route===screen.route).map(item=>({...item,catalogDigest:runtime.replayCatalog!.digest})) : [];
      return [{featureId:feature!.id,screenId:screen.id,scenarioId:scenario.id,title:scenario.title,screenTitle:screen.title,recipes,canChoose:recipes.length>0,reason:recipes.length?null:"No recipe is registered for this screen."}];
    });
    return {id:group.id,proposalBasis:changeGroupDigest(group),title:group.title,paths:group.files.map((file:any)=>file.path),
      canPrepare:!reason && scenarios.some(item=>item.canChoose),reason:reason || (!scenarios.some(item=>item.canChoose)?"Connect a related screen with an app-authored recipe.":null),scenarios};
  }

  private async validateAlternativeForGroup(basis:any, options:any, project:ProjectSnapshot) {
    const key=this.alternativeKey(project), group=options.group, digest=changeGroupDigest(group);
    validateAlternativeGroupBasis(basis,group.files);
    const groupSession=this.changeSetSessions.get(project.id)!, token=groupSession.ownershipToken(), current=groupSession.snapshot().current;
    if(!current || current.id!==group.id || changeGroupDigest(current)!==digest)throw new Error("The retained group changed.");
    const session=this.alternativesSession(project), record=session.snapshot().records.find(item=>item.id===basis.comparisonId);
    const assertScope=()=>{if(!record || !this.alternativeScopeCurrent(record,project))throw new Error("The saved comparison scope changed. Prepare a new alternative.");};
    assertScope();
    const guard=()=>{
      if(this.disposed || !vscode.workspace.isTrusted || this.alternativeKey()!==key || groupSession.ownershipToken()!==token ||
        this.dirtyPaths().some(path=>group.context.some((item:any)=>item.path===path)))throw new Error("The retained group or a contributing source changed. Its checkpoint is preserved.");
      this.changeSetOperationGuards?.get(project.id)?.();
      const features=this.features(project).snapshot(), workspace=this.runtimeWorkspaceStore(project).presentation().snapshot;
      if(features.storage.status!=="saved" || features.revision!==record!.scope.feature.revision || workspace.storage.status!=="saved" || workspace.revision!==record!.scope.definitionRevision)
        throw new Error("The saved comparison scope changed. Prepare a new alternative.");
    };
    guard();
    if(options.phase==="progress") {await session.validateGroupProgress(basis,{guard,originalBatchWrite:options.originalBatchWrite});guard();assertScope();return true;}
    const candidate=await session.validateGroupCandidate(basis,{guard});guard();assertScope();
    const files=(value:any)=>value.map(({path,before,after,baseRevision}:any)=>({path,before,after,baseRevision})).sort((a:any,b:any)=>a.path.localeCompare(b.path));
    if(visualVerificationDigest(files(group.files))!==visualVerificationDigest(files(candidate.sourceGroup.files)) ||
      visualVerificationDigest(group.context)!==visualVerificationDigest(candidate.sourceGroup.context) ||
      visualVerificationDigest(group.verification)!==visualVerificationDigest(candidate.sourceGroup.verification))
      throw new Error("The local group no longer matches the retained alternative.");
    guard();return true;
  }

  private alternativeScopeCurrent(record:any, project:ProjectSnapshot) {
    const features=this.features(project).snapshot(), workspace=this.runtimeWorkspaceStore(project).snapshot();
    const feature=features.features.find(item=>item.id===record.scope.feature.id && !item.archived);
    return features.storage.status==="saved" && workspace.storage.status==="saved" && Boolean(feature) &&
      record.scope.feature.revision===features.revision && record.scope.definitionRevision===workspace.revision &&
      visualVerificationDigest({id:feature!.id,title:feature!.title,revision:features.revision,paths:feature!.paths})===visualVerificationDigest(record.scope.feature) &&
      visualVerificationDigest(workspace.screens.find(item=>item.id===record.scope.screen.id) ?? null)===visualVerificationDigest(record.scope.screen) &&
      visualVerificationDigest(workspace.scenarios.find(item=>item.id===record.scope.scenario.id) ?? null)===visualVerificationDigest(record.scope.scenario);
  }

  private alternativeReviewChoices(snapshot:any, project:ProjectSnapshot) {
    const proposal=this.proposals().current(), dirty=this.dirtyPaths();
    const beforeHash=typeof proposal?.before==="string" ? createHash("sha256").update(proposal.before).digest("hex") : null;
    const afterHash=typeof proposal?.after==="string" ? createHash("sha256").update(proposal.after).digest("hex") : null;
    const busy=snapshot.busy || Boolean(this.visualAlternativesOperation) || this.visualVerificationWorkBusy() || Boolean(this.visualVerificationBusy);
    let checkpointReason:string|null=null;
    try{this.requireNoActiveChangeSet();}catch(error){checkpointReason=error instanceof Error?error.message:"Resolve the current change checkpoint first.";}
    return snapshot.records.map((record:any)=>{
      const groupRecord=record.source?.kind==="change-set";
      const matches=!groupRecord && proposal?.origin==="design" && proposal.path===record.path && beforeHash===record.beforeHash && afterHash===record.afterHash;
      const reason=!record.candidate ? "This older comparison has no retained proposal metadata. Prepare a named alternative to review it." :
        snapshot.storage.status!=="saved" ? "Restore comparison storage before reviewing a change." :
        record.status!=="completed" ? "Finish both sides of the comparison before reviewing this result." :
        busy ? "Finish the current source or runtime action first." :
        checkpointReason ? checkpointReason :
        (groupRecord ? record.source.files.some((file:any)=>dirty.includes(file.path)) : dirty.includes(record.path)) ? "This target has an unsaved draft. Resolve it before reviewing the alternative." :
        proposal?.status==="applied" ? "Undo or dismiss the applied change before reviewing another alternative." :
        proposal?.status==="proposed" && !matches ? "Discard the current proposal before reviewing another alternative." :
        !this.alternativeScopeCurrent(record,project) ? "The saved feature or scenario changed. Prepare a new comparison." : null;
      return {id:record.id,canReview:!reason,reason};
    });
  }

  private visualAlternativesSnapshot() {
    const project=this.project;
    if (!project || !vscode.workspace.isTrusted) return null;
    const snapshot=this.visualAlternativesSessions?.get(this.alternativeKey())?.snapshot();
    if (!snapshot) return null;
    return {...snapshot,proposal:this.visualAlternativesProposal(),groupProposal:this.visualAlternativesGroupProposal(),captureAvailable:this.nativeCaptureAvailable,
      reviewChoices:this.alternativeReviewChoices(snapshot,project),
      operation:this.visualAlternativesOperation?.key===this.alternativeKey() ? {action:this.visualAlternativesOperation.action,id:this.visualAlternativesOperation.id} : null,
      busy:snapshot.busy || Boolean(this.visualAlternativesOperation),
      ...(this.visualAlternativesError?.key===this.alternativeKey() ? {error:this.visualAlternativesError.message} : {})};
  }

  private interruptAlternatives() {
    this.aiAlternativeReview=undefined;
    if(this.visualAlternativesOperation)this.visualAlternativesOperation.cancelled=true;
    const wait=this.visualAlternativesPreviewWait;
    if(wait){this.visualAlternativesPreviewWait=undefined;clearTimeout(wait.timer);wait.reject(new Error("The visible comparison changed."));}
    for(const session of this.visualAlternativesSessions?.values() || []) if(session.snapshot().busy) void session.stop().catch(()=>{});
  }

  private async validateAlternativeForProposal(proposal:any, project:ProjectSnapshot, originalWriteTemporary?:any) {
    const basis=proposal.alternativeBasis;
    if(!basis)return true;
    const key=this.alternativeKey(project), epoch=this.featureSourceEpoch || 0, generation=this.proposalMutationGeneration || 0;
    const session=this.proposals(), token=session.ownershipToken?.(), current=session.current();
    const fingerprint=visualVerificationDigest(current);
    const guard=()=>{
      if(this.disposed || !vscode.workspace.isTrusted || this.alternativeKey()!==key || (this.featureSourceEpoch || 0)!==epoch ||
        (this.proposalMutationGeneration || 0)!==generation || this.dirtyPaths().includes(proposal.path) ||
        (token ? session.ownershipToken()!==token : visualVerificationDigest(session.current())!==fingerprint))
        throw new Error("The workspace or proposal changed while validating the alternative. Your source is preserved.");
    };
    guard();
    const candidate=await this.alternativesSession(project).validateCandidate(basis,{guard,originalWriteTemporary});guard();
    if(candidate.path!==proposal.path || candidate.before!==proposal.before || candidate.after!==proposal.after ||
      candidate.beforeHash.slice(0,16)!==proposal.baseRevision ||
      visualVerificationDigest(candidate.designImpact)!==visualVerificationDigest(proposal.designImpact))
      throw new Error("The retained alternative no longer matches this reviewed proposal.");
    const record=this.alternativesSession(project).snapshot().records.find(item=>item.id===basis.comparisonId);
    if(!record || !this.alternativeScopeCurrent(record,project))throw new Error("The saved comparison scope changed. Prepare a new alternative.");
    guard();return true;
  }

  private async requestAlternativePreview(project: ProjectSnapshot,input: AlternativePreview) {
    const panel=this.panel, key=this.alternativeKey(project);
    if(this.disposed || !vscode.workspace.isTrusted || this.alternativeKey()!==key || !panel?.visible || this.mode!=="Review") throw new Error("Keep the comparison visible while it runs.");
    if(this.visualAlternativesPreviewWait) throw new Error("Another comparison preview is still being prepared.");
    const url=new URL(input.runtime.url || "");
    if(url.protocol!=="http:" || !url.port || !["127.0.0.1","localhost","[::1]"].includes(url.hostname) || url.username || url.password || !input.runtime.owned || !input.runtime.session)
      throw new Error("The owned comparison runtime is unavailable.");
    const originChanged=this.alternativeFrameOrigin!==url.origin;
    this.alternativeFrameOrigin=url.origin;
    await new Promise<void>((resolve,reject)=>{
      const finish=(error?:Error)=>{if(this.visualAlternativesPreviewWait?.input===input)this.visualAlternativesPreviewWait=undefined;clearTimeout(timer);error?reject(error):resolve();};
      const timer=setTimeout(()=>finish(new Error("The comparison preview did not become ready. No later alternative was started.")),15000);
      this.visualAlternativesPreviewWait={key,panel,input,timer,resolve:()=>finish(),reject:error=>finish(error)};
      if(originChanged){
        // Grant only this host-owned runtime origin at an explicit side transition.
        // The ready handshake restores state before resending the exact preview nonce.
        this.sentDesignSession=undefined;
        panel.webview.html=this.webviewHtml(panel.webview,"workspace");
        return;
      }
      void Promise.resolve(panel.webview.postMessage({type:"visualAlternativesPreview",projectId:project.id,...input})).then(sent=>{if(!sent)finish(new Error("The comparison preview is unavailable."));},()=>finish(new Error("The comparison preview is unavailable.")));
    });
  }

  private alternativePreviewReady(message:any) {
    const wait=this.visualAlternativesPreviewWait, input=wait?.input;
    if(!wait || !input || !this.project || this.disposed || !vscode.workspace.isTrusted || this.alternativeKey()!==wait.key || this.panel!==wait.panel || !wait.panel.visible || this.mode!=="Review" ||
      message.projectId!==this.project.id || message.comparisonId!==input.comparisonId || message.variantId!==input.variantId || message.nonce!==input.nonce || message.phase!==input.phase ||
      message.session!==input.runtime.session || message.viewId!==input.runtime.viewId || !/^[a-f0-9]{32}$/.test(message.documentId || "") ||
      !Number.isSafeInteger(message.pageVersion) || message.pageVersion<1 || typeof message.route!=="string" ||
      visualVerificationDigest(message.requested ?? null)!==visualVerificationDigest(input.requested) ||
      (input.phase!=="connect" && (message.documentId!==input.runtime.documentId || message.pageVersion!==input.runtime.pageVersion || message.route!==input.runtime.pagePath))) return;
    wait.resolve();
  }

  private async captureAlternative(project:ProjectSnapshot,input:{identity:Omit<CaptureRuntimeIdentity,"targetId">;guard:()=>Promise<void>}) {
    const key=this.alternativeKey(project), panel=this.panel;
    const guard=async()=>{await input.guard();if(!this.nativeCaptureAvailable || !panel?.visible || this.panel!==panel || this.mode!=="Review" || this.alternativeKey()!==key || !vscode.workspace.isTrusted || this.disposed)throw new Error("The comparison changed during capture.");};
    await guard();
    const identity={...input.identity,nonce:randomBytes(16).toString("hex")};
    const result:any=await vscode.commands.executeCommand("_foundation.captureActiveCanvas",identity);await guard();
    if(!result?.identity || Object.keys(result.identity).length!==Object.keys(identity).length || Object.entries(identity).some(([key,value])=>result.identity[key]!==value) ||
      typeof result.pngBase64!=="string" || result.pngBase64.length>24*1024*1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.pngBase64) || typeof result.capturedAt!=="string") throw new Error("The comparison capture could not be verified.");
    const png=Buffer.from(result.pngBase64,"base64"), image=inspectCapturePng(png), conditions=result.conditions;
    if(png.toString("base64")!==result.pngBase64 || !conditions || !["light","dark"].includes(conditions.observedColorScheme) || typeof conditions.reducedMotion!=="boolean" ||
      image.widthPx!==conditions.pixelWidth || image.heightPx!==conditions.pixelHeight) throw new Error("The comparison image or conditions could not be verified.");
    await guard();return {png,conditions,capturedAt:result.capturedAt};
  }

  private async visualAlternativesAction(message:any) {
    const project=this.project, key=this.alternativeKey();
    if(!project || !vscode.workspace.isTrusted || this.disposed || message.projectId!==project.id) throw new Error("Choose a comparison in the current trusted project.");
    const session=this.alternativesSession(project);
    if(message.action==="stop") {
      const active=session.snapshot();
      const reviewing=this.visualAlternativesOperation?.key===key && this.visualAlternativesOperation.action==="review" && this.visualAlternativesOperation.id===message.id;
      if(!reviewing && (!active.busy || !active.records.some(record=>record.id===message.id && ["preparing","running"].includes(record.status))))throw new Error("Choose the active comparison or review to stop.");
      this.interruptAlternatives();await session.stop();return;
    }
    if(message.action==="image") {
      const panel=this.panel;
      try {const result=await session.readCapture(message.id,message.captureId);
        if(this.disposed || !vscode.workspace.isTrusted || this.alternativeKey()!==key || this.panel!==panel)return;
        await panel?.webview.postMessage({type:"visualAlternativesImage",projectId:project.id,id:message.id,captureId:message.captureId,imageSha256:createHash("sha256").update(result.png).digest("hex"),pngBase64:result.png.toString("base64")});
      } catch {if(this.alternativeKey()===key && this.panel===panel)await panel?.webview.postMessage({type:"visualAlternativesImage",projectId:project.id,id:message.id,captureId:message.captureId,error:"This saved capture could not be verified."});}
      return;
    }
    if(message.action==="compare") {
      const panel=this.panel;
      const reply={type:"visualAlternativesComparison",projectId:project.id,leftId:message.leftId,rightId:message.rightId,expectedRevision:message.expectedRevision};
      try {
        if(!panel?.visible || this.mode!=="Review")throw new Error("Open Review to compare saved results.");
        const guard=()=>{if(this.disposed || !vscode.workspace.isTrusted || this.alternativeKey()!==key || this.panel!==panel || !panel.visible || this.mode!=="Review")throw new Error("The comparison workspace changed.");};
        const comparison=await session.compareCandidates(message.leftId,message.rightId,message.expectedRevision,{guard});guard();
        await panel.webview.postMessage({...reply,comparison});return comparison;
      } catch(error) {
        if(this.alternativeKey()===key && this.panel===panel)await panel?.webview.postMessage({...reply,error:error instanceof Error?error.message:"The saved results could not be compared."});throw error;
      }
    }
    const groupRecord=session.snapshot().records.find(item=>item.id===message.id)?.source?.kind==="change-set";
    if(message.action==="prepare" && message.sourceKind==="change-set" || ["run","review"].includes(message.action) && groupRecord)
      return this.visualAlternativesGroupAction(message,project);
    let operation:NonNullable<FoundationHost["visualAlternativesOperation"]>|undefined;
    try {
      if(!["prepare","run","retry","review"].includes(message.action))throw new Error("Choose a comparison action.");
      if(this.alternativesBusy() || this.visualVerificationWorkBusy() || this.visualVerificationBusy)throw new Error("Finish the current source or runtime action first.");
      const initial=session.snapshot();
      if(message.expectedRevision!==initial.revision)throw new Error("Comparison history changed. Review it before continuing.");
      if(!this.panel?.visible || this.mode!=="Review")throw new Error("Open Review before preparing or running a comparison.");
      const proposalSession=this.proposals(), proposal=proposalSession.current(), proposalToken=proposalSession.ownershipToken?.(), basis=visualVerificationDigest(proposal ?? null), view=this.visualAlternativesProposal();
      const sourceEpoch=this.featureSourceEpoch || 0, generation=this.proposalMutationGeneration || 0, panel=this.panel;
      const features=this.features(project).snapshot(), workspace=this.runtimeWorkspaceStore(project).snapshot();
      const reviewChoice=message.action==="review" ? this.alternativeReviewChoices(initial,project).find((choice:any)=>choice.id===message.id) : null;
      operation={key,action:message.action,...message.action==="review"?{id:message.id}:{}};this.visualAlternativesOperation=operation;this.visualAlternativesError=undefined;
      const guard=()=>{
        if(message.action==="review")this.requireNoActiveChangeSet();
        if(this.visualAlternativesOperation!==operation || operation?.cancelled || this.disposed || !vscode.workspace.isTrusted || this.alternativeKey()!==key || this.panel!==panel || !panel.visible || this.mode!=="Review" ||
          this.visualVerificationWorkBusy() || (this.featureSourceEpoch || 0)!==sourceEpoch || (this.proposalMutationGeneration || 0)!==generation ||
          (proposal && this.dirtyPaths().includes(proposal.path)) ||
          (proposalToken !== undefined ? proposalSession.ownershipToken()!==proposalToken : visualVerificationDigest(this.proposals().current() ?? null)!==basis) ||
          this.features(project).snapshot().revision!==features.revision || this.runtimeWorkspaceStore(project).presentation().snapshot.revision!==workspace.revision)
          throw new Error("The saved project, proposal, or comparison context changed. No later alternative will start.");
      };
      this.sendState();guard();
      if(message.action==="retry")return await session.retry();
      if(message.action==="review") {
        await this.loadChangeSets();guard();
        const record=initial.records.find(item=>item.id===message.id);
        if(!record?.candidate || record.candidate?.metadataDigest!==message.metadataDigest || !reviewChoice?.canReview)
          throw new Error(reviewChoice?.reason || "Choose a current retained alternative.");
        const candidate=await session.readCandidate(record.id,initial.revision,{guard});guard();
        if(this.dirtyPaths().includes(candidate.path))throw new Error("The target has an unsaved draft. It has been preserved.");
        if(!await this.validateDesignImpactForProposal(candidate.designImpact,"apply",project))throw new Error("Saved change impact is stale. Prepare a new alternative.");guard();
        const source=await this.service.getFile(project.id,candidate.path);guard();
        if(source.source!==candidate.before || source.revision!==candidate.beforeHash.slice(0,16))throw new Error("The saved source changed. Prepare a new alternative.");
        const tokenCandidate=listDesignTokens([{...source,source:candidate.after,revision:candidate.afterHash.slice(0,16)}]).find((item:any)=>item.name===candidate.token.name && item.occurrence===candidate.token.occurrence);
        if(!tokenCandidate)throw new Error("The retained token change is unavailable.");
        const staged=createTokenProposal({file:source,name:tokenCandidate.name,occurrence:tokenCandidate.occurrence,value:tokenCandidate.value,projectId:project.id});
        if(staged.after!==candidate.after)throw new Error("The retained candidate differs from the reviewed token change.");
        staged.title=candidate.name;staged.designImpact=structuredClone(candidate.designImpact);staged.alternativeBasis=structuredClone(candidate.alternativeBasis);
        const saved=await proposalSession.set(staged,{isCurrent:()=>{try{guard();return !this.dirtyPaths().includes(candidate.path);}catch{return false;}}});
        // set() intentionally changes the proposal ownership token. Validate the
        // remaining context without comparing it to the superseded token.
        this.requireNoActiveChangeSet();
        if(this.visualAlternativesOperation!==operation || operation.cancelled || this.disposed || !vscode.workspace.isTrusted ||
          this.alternativeKey()!==key || this.panel!==panel || !panel.visible || this.mode!=="Review" ||
          (this.featureSourceEpoch || 0)!==sourceEpoch || (this.proposalMutationGeneration || 0)!==generation ||
          this.dirtyPaths().includes(candidate.path) || this.features(project).snapshot().revision!==features.revision ||
          this.runtimeWorkspaceStore(project).presentation().snapshot.revision!==workspace.revision ||
          visualVerificationDigest(proposalSession.current() ?? null)!==visualVerificationDigest(saved))throw new Error("The review workspace changed.");
        this.sendState();
        await panel.webview.postMessage({type:"visualAlternativesReview",projectId:project.id,id:record.id,metadataDigest:record.candidate.metadataDigest,proposalId:saved.id,proposalBasis:visualVerificationDigest(saved)});
        await this.proposalDiff(saved.id);
        return saved;
      }
      if(!proposal || proposal.origin!=="design" || proposal.status!=="proposed" || !proposal.designImpact)throw new Error("Prepare a current token proposal first.");
      if(message.action==="prepare") {
        if(!view?.canPrepare || message.proposalId!==proposal.id || message.proposalBasis!==basis)throw new Error(view?.reason || "The selected proposal changed.");
        const choice=view.scenarios.find((item:any)=>item.scenarioId===message.scenarioId && item.canChoose), recipe=choice?.recipes.find((item:any)=>item.id===message.recipeId);
        if(!choice || !recipe)throw new Error("Choose a related saved scenario and its registered recipe.");
        if(message.captureEach===true && !this.nativeCaptureAvailable)throw new Error("Native capture is unavailable in this host.");
        if(!await this.validateDesignImpactForProposal(proposal.designImpact,"apply",project))throw new Error("Saved change impact is stale. Inspect the token again.");guard();
        const source=await this.service.getFile(project.id,proposal.path);guard();
        if(source.source!==proposal.before || source.revision!==proposal.baseRevision)throw new Error("The saved token source changed. Prepare a new proposal.");
        const feature=features.features.find(item=>item.id===choice.featureId)!, screen=workspace.screens.find(item=>item.id===choice.screenId)!, scenario=workspace.scenarios.find(item=>item.id===choice.scenarioId)!;
        return await session.prepare({proposal,scope:{feature:{id:feature.id,title:feature.title,revision:features.revision,paths:feature.paths},screen,scenario,definitionRevision:workspace.revision},
          recipe,requested:message.requested,captureEach:message.captureEach===true,candidateName:message.candidateName},{guard});
      }
      const record=initial.records.find(item=>item.id===message.id);
      if(!record || ! ("path" in record) || record.proposalId!==proposal.id || record.beforeHash!==createHash("sha256").update(proposal.before).digest("hex") || record.afterHash!==createHash("sha256").update(proposal.after).digest("hex"))throw new Error("The prepared comparison belongs to a different proposal.");
      const frozenFeature=features.features.find(item=>item.id===record.scope.feature.id && !item.archived);
      if(!frozenFeature || record.scope.feature.revision!==features.revision || record.scope.definitionRevision!==workspace.revision ||
        visualVerificationDigest({id:frozenFeature.id,title:frozenFeature.title,revision:features.revision,paths:frozenFeature.paths})!==visualVerificationDigest(record.scope.feature) ||
        visualVerificationDigest(workspace.screens.find(item=>item.id===record.scope.screen.id) ?? null)!==visualVerificationDigest(record.scope.screen) ||
        visualVerificationDigest(workspace.scenarios.find(item=>item.id===record.scope.scenario.id) ?? null)!==visualVerificationDigest(record.scope.scenario))throw new Error("The prepared scenario or feature changed. Prepare a new comparison.");
      if(!await this.validateDesignImpactForProposal(proposal.designImpact,"apply",project))throw new Error("Saved change impact changed before the comparison.");guard();
      return await session.run(record.id,initial.revision,{guard});
    } catch(error) {
      if(this.alternativeKey()===key){
        this.visualAlternativesError={key,message:error instanceof Error?error.message:"The comparison could not finish."};
        if(message.action==="review")await this.panel?.webview.postMessage({type:"visualAlternativesReview",projectId:project.id,id:message.id,metadataDigest:message.metadataDigest,error:this.visualAlternativesError.message});
      }
      throw error;
    } finally {
      if(operation && this.visualAlternativesOperation===operation)this.visualAlternativesOperation=undefined;
      if(this.alternativeFrameOrigin && !session.snapshot().busy){this.alternativeFrameOrigin="";if(this.panel){this.sentDesignSession=undefined;this.panel.webview.html=this.webviewHtml(this.panel.webview,"workspace");}}
      this.sendState();
    }
  }

  private alternativeWorkBusy(project:ProjectSnapshot, excludeGroup=false) {
    // Inventory guards run for every path component and read. Never build a
    // review/execution presentation here merely to discover its busy flag.
    const groups=this.changeSetSessions?.get(project.id), execution=this.executionSessions?.get(project.id);
    return Boolean(this.reproducibleIssueBusy || this.projectDecisionBusy || this.proposalMutationCount || this.asking || this.runtimeWorkspaceBusy || this.runtimeStateSuiteBusy ||
      this.runtimeMatrixTask || this.runtimeMatrixRecovery || this.runtimeReplayTask || this.scenarioCapture || this.visualVerificationBusy ||
      !excludeGroup && (groups?.isBusy ? groups.isBusy() : this.changeSetSnapshot()?.busy) ||
      (execution?.isBusy ? execution.isBusy() : this.executionSnapshot()?.busy));
  }

  private async visualAlternativesGroupAction(message:any, project:ProjectSnapshot) {
    const key=this.alternativeKey(project), session=this.alternativesSession(project), panel=this.panel;
    let operation:NonNullable<FoundationHost["visualAlternativesOperation"]>|undefined;
    try {
      if(!panel?.visible || this.mode!=="Review")throw new Error("Open Review to compare this group.");
      if(this.alternativesBusy() || this.visualVerificationWorkBusy() || this.visualVerificationBusy)throw new Error("Finish the current source or runtime action first.");
      await this.loadChangeSets();
      const initial=session.snapshot(), groupSession=this.changeSets(), checkpoint=groupSession.snapshot(), group=checkpoint.current;
      const reviewing=message.action==="review", view=this.visualAlternativesGroupProposal();
      if(message.expectedRevision!==initial.revision)throw new Error("Comparison history changed. Review it before continuing.");
      const record=initial.records.find(item=>item.id===message.id), reviewChoice=reviewing?this.alternativeReviewChoices(initial,project).find((item:any)=>item.id===message.id):null;
      if(reviewing){this.requireNoActiveChangeSet();if(!record || record.source?.kind!=="change-set" || record.candidate?.metadataDigest!==message.metadataDigest || !reviewChoice?.canReview)throw new Error(reviewChoice?.reason || "Choose a current retained group.");}
      else if(!group || !view?.canPrepare || message.action==="prepare" && (message.proposalId!==group.id || message.proposalBasis!==view.proposalBasis))throw new Error(view?.reason || "Choose the completed Build group.");
      const owner=!reviewing && group?this.alternativeGroupOwner(group,project):null;
      const groupToken=groupSession.ownershipToken(), proposalSession=this.proposals(), proposalToken=proposalSession.ownershipToken?.(), proposalDigest=visualVerificationDigest(proposalSession.current()??null);
      const epoch=this.featureSourceEpoch || 0, generation=this.proposalMutationGeneration || 0, features=this.features(project).snapshot(), workspace=this.runtimeWorkspaceStore(project).snapshot();
      const affected=reviewing && record?.source?.kind==="change-set" ? record.source.files.map(file=>file.path) : group!.context.map((item:any)=>item.path);
      operation={key,action:message.action,...reviewing?{id:message.id}:{}};this.visualAlternativesOperation=operation;this.visualAlternativesError=undefined;
      const guard=(afterStage=false)=>{
        if(this.visualAlternativesOperation!==operation || operation?.cancelled || this.disposed || !vscode.workspace.isTrusted || this.alternativeKey()!==key || this.panel!==panel || !panel.visible || this.mode!=="Review" ||
          this.alternativeWorkBusy(project,afterStage) || (this.featureSourceEpoch || 0)!==epoch || (this.proposalMutationGeneration || 0)!==generation ||
          !afterStage && groupSession.ownershipToken()!==groupToken || (proposalToken!==undefined?proposalSession.ownershipToken()!==proposalToken:visualVerificationDigest(proposalSession.current()??null)!==proposalDigest) ||
          this.dirtyPaths().some(path=>affected.includes(path)) || this.features(project).snapshot().revision!==features.revision || this.runtimeWorkspaceStore(project).presentation().snapshot.revision!==workspace.revision)
          throw new Error("The saved project, group or comparison context changed. Its source is preserved.");
        if(!reviewing && group){const history=this.conversations(project).presentation().snapshot;if(history.storage.status!=="saved" || history.revision!==owner?.historyRevision)throw new Error("The saved Build conversation changed.");}
        // Initial checkpoint availability is pinned by groupToken. A new
        // mutation changes that token or the cheap busy flag above.
      };
      this.sendState();guard();
      if(reviewing && record?.source?.kind==="change-set") {
        const candidate=await session.readGroupCandidate(record.id,initial.revision,{guard});guard();
        if(!this.alternativeScopeCurrent(record,project))throw new Error("The saved comparison scope changed. Prepare a new alternative.");
        const original=candidate.sourceGroup;
        affected.push(...original.context.map(item=>item.path));guard();
        const staged=validateChangeSet({schemaVersion:1,id:randomUUID(),projectId:project.id,title:candidate.name,summary:original.summary,status:"proposed",origin:"alternative",revision:0,
          files:original.files.map(({path,before,after,baseRevision}:any)=>({id:randomUUID(),path,before,after,baseRevision})),context:original.context,verification:original.verification,verificationStatus:"not-run",alternativeBasis:candidate.alternativeBasis},project.id);
        // stage() owns a busy lock while its isCurrent callback runs. Only that
        // expected busy state is exempt; the empty checkpoint token stays pinned.
        const stageGuard=()=>{try{guard(true);const current=groupSession.snapshot().current;return groupSession.ownershipToken()===groupToken || Boolean(current?.id===staged.id && changeGroupDigest(current)===changeGroupDigest(staged));}catch{return false;}};
        const saved=await groupSession.stage(staged,{isCurrent:stageGuard});guard(true);
        const current=groupSession.snapshot().current;
        if(!saved.current || saved.current.id!==staged.id || changeGroupDigest(saved.current)!==changeGroupDigest(staged) || current?.id!==staged.id || changeGroupDigest(current)!==changeGroupDigest(staged))throw new Error("The reviewed group was not retained. Review its checkpoint before continuing.");
        this.sendState();
        await panel.webview.postMessage({type:"visualAlternativesReview",projectId:project.id,id:record.id,metadataDigest:record.candidate!.metadataDigest,changeSetId:saved.current.id,changeSetBasis:changeGroupDigest(saved.current)});
        guard(true);
        const reviewed=groupSession.snapshot().current;
        if(reviewed?.id!==staged.id || changeGroupDigest(reviewed)!==changeGroupDigest(staged))throw new Error("The reviewed checkpoint changed before opening its source diff.");
        const file=saved.current.files[0];
        const before=vscode.Uri.from({scheme:"foundation-snapshot",path:`/before/${basename(file.path)}`,query:randomBytes(8).toString("hex")});
        const after=vscode.Uri.from({scheme:"foundation-snapshot",path:`/staged/${basename(file.path)}`,query:randomBytes(8).toString("hex")});
        this.snapshots.set(before.toString(),file.before);this.snapshots.set(after.toString(),file.after);
        await vscode.commands.executeCommand("vscode.diff",before,after,`${file.path} · before ↔ staged`,{preview:true,viewColumn:this.sourceColumn()});return saved.current;
      }
      if(message.action==="prepare") {
        const choice=view!.scenarios.find((item:any)=>item.scenarioId===message.scenarioId && item.canChoose), recipe=choice?.recipes.find((item:any)=>item.id===message.recipeId);
        if(!choice || !recipe)throw new Error("Choose a related saved scenario and its registered recipe.");
        if(message.captureEach===true && !this.nativeCaptureAvailable)throw new Error("Native capture is unavailable in this host.");
        const feature=features.features.find(item=>item.id===choice.featureId)!, screen=workspace.screens.find(item=>item.id===choice.screenId)!, scenario=workspace.scenarios.find(item=>item.id===choice.scenarioId)!;
        const scope={feature:{id:feature.id,title:feature.title,revision:features.revision,paths:feature.paths},screen,scenario,definitionRevision:workspace.revision};
        const generatedScope=owner?.turn.alternatives?.generation.scope;
        if(generatedScope && visualVerificationDigest(scope)!==visualVerificationDigest(generatedScope))throw new Error("Compare this generated candidate in its original saved scenario.");
        return await session.prepareChangeSet({changeSet:group!,scope,recipe,requested:message.requested,captureEach:message.captureEach===true,candidateName:message.candidateName},{guard});
      }
      if(!record || record.source?.kind!=="change-set" || !group || record.source.groupId!==group.id || record.source.groupRevision!==group.revision || record.source.groupDigest!==changeGroupDigest(group) || !this.alternativeScopeCurrent(record,project))
        throw new Error("The prepared comparison belongs to a different group or saved scope.");
      return await session.run(record.id,initial.revision,{guard});
    } catch(error) {
      if(this.alternativeKey()===key){this.visualAlternativesError={key,message:error instanceof Error?error.message:"The group comparison could not finish."};
        if(message.action==="review")await panel?.webview.postMessage({type:"visualAlternativesReview",projectId:project.id,id:message.id,metadataDigest:message.metadataDigest,error:this.visualAlternativesError.message});}
      throw error;
    } finally {
      if(operation && this.visualAlternativesOperation===operation)this.visualAlternativesOperation=undefined;
      if(this.alternativeFrameOrigin && !session.snapshot().busy){this.alternativeFrameOrigin="";if(this.panel){this.sentDesignSession=undefined;this.panel.webview.html=this.webviewHtml(this.panel.webview,"workspace");}}
      this.sendState();
    }
  }

  private reproducibleIssuesStore(project = this.project) {
    if(!project)throw new Error("Open a project before reviewing issues.");
    this.reproducibleIssueStores ||= new Map();
    let store=this.reproducibleIssueStores.get(project.id);
    if(!store){const key=`foundation.reproducible-issues.${project.id}`;
      store=createReproducibleIssuesStore({projectId:project.id,read:()=>this.context.workspaceState.get(key),
        write:value=>this.context.workspaceState.update(key,value),onChange:()=>this.queueConversationState(project.id)});
      this.reproducibleIssueStores.set(project.id,store);}
    return store;
  }

  private issueEvidence(project = this.project) {
    if(!project)throw new Error("Open a project before reviewing issue evidence.");
    const workspace=this.runtimeWorkspaceStore(project).presentation().snapshot;
    const replay=this.runtimeReplayStore(project).snapshot();
    let capture:ReturnType<ReturnType<typeof createRuntimeCaptureStore>["snapshot"]>|null=null;
    try{capture=this.runtimeCaptureStorage(project).store.snapshot();}catch{/* Metadata availability remains separate. */}
    return {workspace,replay,capture};
  }

  private issueSourceHash(path:string):string|null {
    const cache=this.reproducibleIssueSources;
    return cache && cache.projectId===this.project?.id && cache.root===this.project?.root && cache.epoch===(this.featureSourceEpoch || 0) ? cache.hashes.get(path) ?? null : null;
  }

  private async refreshReproducibleIssues(prioritizeIssueId?:string) {
    const project=this.project;if(!project || !vscode.workspace.isTrusted)return;
    const key=this.alternativeKey(project),epoch=this.featureSourceEpoch || 0,featureId=this.featureSnapshot()?.activeId;
    const history=this.reproducibleIssuesStore(project).presentation().snapshot,workspace=this.runtimeWorkspaceStore(project).presentation().snapshot;
    const paths=[...new Set([...history.issues.filter(issue=>issue.id===prioritizeIssueId && issue.run.feature.id===featureId).flatMap(issue=>issue.contextFiles.map(file=>file.path)),
      ...history.issues.filter(issue=>issue.run.feature.id===featureId).flatMap(issue=>issue.contextFiles.map(file=>file.path)),
      ...workspace.runs.filter(run=>run.feature.id===featureId && run.status!=="recording").flatMap(run=>run.sources.map(file=>file.path))])].slice(0,192);
    const current=()=>!this.disposed && vscode.workspace.isTrusted && this.alternativeKey()===key && (this.featureSourceEpoch || 0)===epoch && this.featureSnapshot()?.activeId===featureId;
    const hashes=new Map<string,string>();
    if(paths.length){const result=await this.service.getFiles(project.id,paths,{isCurrent:current});if(!current())return;
      for(const file of result.files as ProjectFile[])hashes.set(file.path,createHash("sha256").update(file.source).digest("hex"));}
    if(current())this.reproducibleIssueSources={projectId:project.id,root:project.root,epoch,hashes};
  }

  private issueAssessment(issue:ReproducibleIssue,evidence:ReturnType<FoundationHost["issueEvidence"]>,files?:{path:string;hash:string|null}[]) {
    const run=evidence.workspace.storage.status==="saved" ? evidence.workspace.runs.find(item=>item.id===issue.run.id) : undefined;
    const replay=issue.replay && evidence.replay.storage.status==="saved" ? evidence.replay.replays.find(item=>item.id===issue.replay!.replay.id) : undefined;
    const capture=issue.capture && evidence.capture?.storage.status==="saved" ? evidence.capture.captures.find(item=>item.id===issue.capture!.capture.id) : undefined;
    return assessReproducibleIssue(issue,{files:files ?? issue.contextFiles.map(file=>({path:file.path,hash:this.issueSourceHash(file.path)})),
      dirtyPaths:this.dirtyPaths().filter(path=>issue.contextFiles.some(file=>file.path===path)),
      runDigest:run?reproducibleIssueEvidenceDigest(run):null,replayDigest:replay?reproducibleIssueEvidenceDigest(replay):null,captureDigest:capture?reproducibleIssueEvidenceDigest(capture):null});
  }

  private reproducibleIssuesSnapshot() {
    const project=this.project;if(!project || !vscode.workspace.isTrusted)return null;
    const presentation=this.reproducibleIssuesStore(project).presentation(),saved=presentation.snapshot,featureId=this.featureSnapshot()?.activeId;
    const workspace=this.runtimeWorkspaceStore(project).presentation().snapshot,replayState=this.runtimeReplayStore(project).state();
    let captureState: {revision:number;storageStatus:string}|undefined;try{captureState=this.runtimeCaptureStorage(project).store.state();}catch{}
    const dirty=this.dirtyPaths();
    // Retained runs are bounded but substantial. Reuse projections while their
    // store epochs, evidence revisions and source/dirty relationships are stable.
    const projectionKey=JSON.stringify([this.alternativeKey(project),presentation.epoch,featureId,workspace.revision,workspace.storage.status,
      replayState.revision,replayState.storageStatus,captureState?.revision,captureState?.storageStatus,
      this.featureSourceEpoch || 0,dirty,Boolean(this.reproducibleIssueBusy || this.alternativeWorkBusy(project) || this.alternativesBusy()),this.reproducibleIssueError]);
    if(this.reproducibleIssueProjection?.key===projectionKey && this.reproducibleIssueProjection.sources===this.reproducibleIssueSources)return this.reproducibleIssueProjection.value;
    const evidence=this.issueEvidence(project);
    const records=saved.issues.map(record=>({record,digest:reproducibleIssueDigest(record),status:this.issueAssessment(record,evidence),
      canShare:saved.storage.status==="saved" && record.run.feature.id===featureId,reason:saved.storage.status!=="saved"?"Restore local issue storage before sharing.":record.run.feature.id!==featureId?"Select this issue’s feature before sharing it.":undefined}));
    const candidates=evidence.workspace.runs.filter(run=>run.feature.id===featureId && run.status!=="recording").map(run=>{
      const reason=saved.storage.status!=="saved"?"Restore local issue storage before capturing.":
        evidence.workspace.storage.status!=="saved" || evidence.replay.storage.status!=="saved" || evidence.capture?.storage.status!=="saved"?"Restore runtime evidence storage before capturing.":
        !run.scenario.steps.length || !run.scenario.expectedOutcome.trim()?"This observation needs saved reproduction steps and an expected outcome.":
        dirty.some(path=>run.sources.some(file=>file.path===path))?"Resolve unsaved contributing files before capturing an issue.":
        this.reproducibleIssueBusy || this.alternativeWorkBusy(project) || this.alternativesBusy()?"Finish the current source or runtime action first.":undefined;
      return {id:run.id,digest:reproducibleIssueEvidenceDigest(run),title:run.scenario.title,canRecord:!reason,reason};
    });
    const value={schemaVersion:1,projectId:project.id,revision:saved.revision,storage:saved.storage,records,candidates,
      busy:Boolean(this.reproducibleIssueBusy),error:this.reproducibleIssueError?.key===this.alternativeKey()?this.reproducibleIssueError.message:undefined};
    this.reproducibleIssueProjection={key:projectionKey,sources:this.reproducibleIssueSources,value};return value;
  }

  private async reproducibleIssueAction(message:any) {
    const project=this.project,key=this.alternativeKey();
    try{
      if(!project || this.disposed || !vscode.workspace.isTrusted || message.projectId!==project.id)throw new Error("Choose an issue in the current trusted project.");
      const store=this.reproducibleIssuesStore(project),history=store.presentation().snapshot;
      if(message.revision!==history.revision)throw new Error("Issue history changed. Review its latest state.");
      if(message.action==="navigate" || message.action==="viewEvidence"){
        const issue=history.issues.find(item=>item.id===message.issueId);if(!issue)throw new Error("Choose a saved issue in this project.");
        if(message.action==="navigate"){
          if(!issue.contextFiles.some(file=>file.path===message.path))throw new Error("Choose a source linked to this issue.");
          await this.navigate(message.path,1);return;
        }
        if(issue.run.feature.id!==this.featureSnapshot()?.activeId)throw new Error("Select this issue’s feature before viewing its original observation.");
        const status=this.issueAssessment(issue,this.issueEvidence(project));
        if(status.run!=="available" || issue.capture && status.capture!=="available" || issue.replay && status.replay!=="available")throw new Error("The original observation or attached evidence is unavailable or changed. Its frozen issue record is preserved.");
        await this.show("Understand");
        if(this.disposed || !vscode.workspace.isTrusted || this.alternativeKey()!==key || issue.run.feature.id!==this.featureSnapshot()?.activeId)throw new Error("The trusted project or selected feature changed.");
        const latest=this.issueAssessment(issue,this.issueEvidence(project));
        if(latest.run!=="available" || issue.capture && latest.capture!=="available" || issue.replay && latest.replay!=="available" || latest.capture!==status.capture || latest.replay!==status.replay)throw new Error("The original evidence changed while opening it. The issue record is preserved.");
        await this.panel?.webview.postMessage({type:"revealIssueEvidence",projectId:project.id,issueId:issue.id,runId:issue.run.id,
          ...(issue.capture && status.capture==="available"?{captureId:issue.capture.capture.id}:{})});return;
      }
      if(this.reproducibleIssueBusy || this.alternativeWorkBusy(project) || this.alternativesBusy())throw new Error("Finish the current source or runtime action first.");
      if(message.action==="refreshContext"){
        const issue=history.issues.find(item=>item.id===message.issueId);
        if(history.storage.status!=="saved" || !issue || reproducibleIssueDigest(issue)!==message.digest || issue.run.feature.id!==this.featureSnapshot()?.activeId)throw new Error("Select an issue from the current feature to check its context.");
        this.reproducibleIssueBusy=key;this.reproducibleIssueError=undefined;this.sendState();
        await this.refreshReproducibleIssues(issue.id);return;
      }
      if(message.action==="retry"){await store.retry();await this.refreshReproducibleIssues();this.reproducibleIssueError=undefined;return;}
      if(message.action!=="record")throw new Error("Choose an issue capture action.");
      const candidate=this.reproducibleIssuesSnapshot()?.candidates.find((item:any)=>item.id===message.runId);
      if(!candidate?.canRecord || candidate.digest!==message.runDigest)throw new Error(candidate?.reason || "Review the finished observation before capturing an issue.");
      const evidence=this.issueEvidence(project),run=evidence.workspace.runs.find(item=>item.id===message.runId)!;
      if(run.status==="recording" || !run.endedAt)throw new Error("Finish this observation before capturing an issue.");
      const terminalRun={...run,status:run.status,endedAt:run.endedAt};
      const epoch=this.featureSourceEpoch || 0,featureId=this.featureSnapshot()?.activeId;
      const current=()=>!this.disposed && vscode.workspace.isTrusted && this.alternativeKey()===key && (this.featureSourceEpoch || 0)===epoch &&
        this.featureSnapshot()?.activeId===featureId && !this.dirtyPaths().some(path=>run.sources.some(file=>file.path===path)) &&
        this.runtimeWorkspaceStore(project).presentation().snapshot.revision===evidence.workspace.revision &&
        this.runtimeWorkspaceStore(project).presentation().snapshot.storage.status==="saved" &&
        this.runtimeReplayStore(project).state().revision===evidence.replay.revision && this.runtimeReplayStore(project).state().storageStatus==="saved" &&
        this.runtimeCaptureStorage(project).store.state().revision===evidence.capture!.revision && this.runtimeCaptureStorage(project).store.state().storageStatus==="saved";
      this.reproducibleIssueBusy=key;this.reproducibleIssueError=undefined;this.sendState();
      const sources=await this.service.getFiles(project.id,run.sources.map(file=>file.path),{isCurrent:current});
      const contextFiles=(sources.files as ProjectFile[]).map(file=>({path:file.path,hash:createHash("sha256").update(file.source).digest("hex")}));
      if(!current() || run.sources.some(file=>!contextFiles.some(item=>item.path===file.path)))throw new Error("Contributing source changed or is unavailable. The issue has not been captured.");
      const replay=evidence.replay.replays.find(item=>item.runId===run.id),capture=evidence.capture?.captures.find(item=>item.runId===run.id);
      if(replay && (replay.status==="running" || !replay.endedAt))throw new Error("Finish this replay before capturing its issue evidence.");
      const terminalReplay=replay && replay.status!=="running" && replay.endedAt?{...replay,status:replay.status,endedAt:replay.endedAt}:null;
      await store.create({projectId:project.id,title:message.title,actualOutcome:message.actualOutcome,reproduction:{steps:run.scenario.steps,expectedOutcome:run.scenario.expectedOutcome,origin:"scenario"},
        run:terminalRun,runDigest:candidate.digest,contextFiles,replay:terminalReplay?{replay:terminalReplay,digest:reproducibleIssueEvidenceDigest(terminalReplay)}:null,capture:capture?{capture,digest:reproducibleIssueEvidenceDigest(capture)}:null,
        sourceRelationship:"unverified",compilation:"not-recorded"},history.revision,{isCurrent:current});
      await this.refreshReproducibleIssues();
    }catch(error){this.reproducibleIssueError={key,message:error instanceof Error?error.message:"The issue could not be captured."};throw error;}
    finally{if(this.reproducibleIssueBusy===key)this.reproducibleIssueBusy=undefined;this.sendState();}
  }

  private async resolveIssueContext(input:any,expectedProjectId?:string) {
    if(input===undefined)return undefined;
    const project=this.project,key=this.alternativeKey(),epoch=this.featureSourceEpoch || 0;
    if(!project || !vscode.workspace.isTrusted || expectedProjectId!==undefined && expectedProjectId!==project.id)throw new Error("Choose an issue from this trusted project.");
    const supplied=Array.isArray(input)?undefined:normalizeReproducibleIssueContext(input,{projectId:project.id});
    const selected=Array.isArray(input)?input:supplied?.issues.map(item=>({id:item.issue.id,digest:item.digest,assessment:item.assessment}));
    if(!Array.isArray(selected) || selected.length!==1 || selected.some(item=>!item || !item.assessment || Object.keys(item).some(key=>!["id","digest","assessment"].includes(key))))throw new Error("Explicitly select one captured issue.");
    const store=this.reproducibleIssuesStore(project),history=store.presentation().snapshot,featureId=this.featureSnapshot()?.activeId;
    const current=()=>!this.disposed && vscode.workspace.isTrusted && this.alternativeKey()===key && (this.featureSourceEpoch || 0)===epoch &&
      this.featureSnapshot()?.activeId===featureId && store.presentation().snapshot.revision===history.revision && store.presentation().snapshot.storage.status==="saved";
    if(!current())throw new Error("Restore issue storage before sharing.");
    const descriptor=selected[0],issue=history.issues.find(item=>item.id===descriptor.id);
    if(!issue || reproducibleIssueDigest(issue)!==descriptor.digest || issue.run.feature.id!==featureId)throw new Error("The selected issue changed. Review its context.");
    // A historical failure can be useful after source changes. Re-read canonical
    // saved files, freeze their relationship to that history, and never imply rerun.
    const sources=await this.service.getFiles(project.id,issue.contextFiles.map(file=>file.path),{isCurrent:current});
    const hashes=new Map((sources.files as ProjectFile[]).map(file=>[file.path,createHash("sha256").update(file.source).digest("hex")]));
    if(!current())throw new Error("Issue context changed before sharing.");
    const assessment=this.issueAssessment(issue,this.issueEvidence(project),issue.contextFiles.map(file=>({path:file.path,hash:hashes.get(file.path) ?? null})));
    if(reproducibleIssueEvidenceDigest(descriptor.assessment)!==reproducibleIssueEvidenceDigest(assessment))throw new Error("Issue source freshness or evidence availability changed. Refresh and review its context before sending.");
    const result=normalizeReproducibleIssueContext({version:1,projectId:project.id,issues:[{issue,digest:descriptor.digest,assessment}]},{projectId:project.id});
    if(supplied && reproducibleIssueEvidenceDigest(supplied)!==reproducibleIssueEvidenceDigest(result))throw new Error("The disclosed issue evidence or source freshness changed. Review its context before sending.");
    return result;
  }

  private projectDecisionStore(project = this.project) {
    if (!project) throw new Error("Open a project before reviewing decisions.");
    this.projectDecisionStores ||= new Map();
    let store=this.projectDecisionStores.get(project.id);
    if (!store) {
      const key=`foundation.project-decisions.${project.id}`;
      store=createProjectDecisionsStore({projectId:project.id,read:()=>this.context.workspaceState.get(key),
        write:value=>this.context.workspaceState.update(key,value),onChange:()=>this.queueConversationState(project.id)});
      this.projectDecisionStores.set(project.id,store);
    }
    return store;
  }

  private decisionAdoption(record:any, inputs?:{proposal:any;group:any}) {
    const proposal=inputs?inputs.proposal:this.proposals().current();
    if (!record.source && proposal?.status==="applied" && proposal.alternativeBasis?.comparisonId===record.id &&
      proposal.alternativeBasis.baselineDigest===record.baselineDigest && proposal.path===record.path &&
      createHash("sha256").update(proposal.before).digest("hex")===record.beforeHash &&
      createHash("sha256").update(proposal.after).digest("hex")===record.afterHash && proposal.appliedAt)
      return {kind:"token" as const,id:proposal.id,appliedAt:proposal.appliedAt};
    const group=inputs?inputs.group:this.changeSetSnapshot();
    if (record.source && group?.current?.status==="applied" && group.current.origin==="alternative" && !group.acceptance &&
      group.current.alternativeBasis?.comparisonId===record.id && group.current.alternativeBasis.baselineDigest===record.baselineDigest &&
      group.current.alternativeBasis.sourceGroupId===record.source.groupId && group.current.alternativeBasis.sourceGroupRevision===record.source.groupRevision &&
      group.current.alternativeBasis.sourceGroupDigest===record.source.groupDigest &&
      projectDecisionEvidenceDigest(group.current.alternativeBasis.files)===projectDecisionEvidenceDigest(record.source.files) &&
      group.current.files.length===record.source.files.length && group.current.files.every((file:any)=>{
        const frozen=record.source.files.find((item:any)=>item.path===file.path);
        return frozen && createHash("sha256").update(file.before).digest("hex")===frozen.beforeHash && createHash("sha256").update(file.after).digest("hex")===frozen.afterHash;
      })) {
      const checkpoint=[...group.checkpoints].reverse().find((item:any)=>item.kind==="applied");
      if(checkpoint)return {kind:"change-set" as const,id:group.current.id,revision:group.current.revision,checkpointId:checkpoint.id,appliedAt:checkpoint.createdAt};
    }
    return undefined;
  }

  private decisionCandidate() {
    if(!this.project || !vscode.workspace.isTrusted)return undefined;
    const alternatives=this.visualAlternativesSessions?.get(this.alternativeKey())?.snapshot();
    if(alternatives?.storage.status!=="saved")return undefined;
    for(const record of alternatives.records) {
      if(record.status!=="completed" || !record.candidate)continue;
      const adoption=this.decisionAdoption(record);if(!adoption)continue;
      const files=record.source ? record.source.files : [{path:record.path,beforeHash:record.beforeHash,afterHash:record.afterHash}];
      const digest=projectDecisionEvidenceDigest({record,adoption});
      const reason=!this.alternativeScopeCurrent(record,this.project) ? "The saved feature or scenario changed. Prepare a new comparison." :
        this.dirtyPaths().some(path=>record.scope.feature.paths.includes(path)) ? "Resolve unsaved feature files before recording this decision." :
        files.some((file:any)=>this.decisionSourceHash(file.path)!==file.afterHash) ? "Refresh the applied source before recording this decision." : undefined;
      return {id:adoption.id,digest,title:record.candidate.name,files,feature:record.scope.feature,evidence:record.variants.map(item=>item.outcome),canRecord:!reason,reason,record,adoption};
    }
    return undefined;
  }

  private decisionSourceHash(path:string):string|null {
    const cache=this.projectDecisionSources;
    return cache && this.project?.id===cache.projectId && this.project?.root===cache.root && cache.epoch===(this.featureSourceEpoch || 0) ? cache.hashes.get(path) ?? null : null;
  }

  private async refreshProjectDecisions() {
    const project=this.project;if(!project || !vscode.workspace.isTrusted)return;
    const epoch=this.featureSourceEpoch || 0,key=this.alternativeKey(project),store=this.projectDecisionStore(project),snapshot=store.snapshot();
    const current=()=>!this.disposed && vscode.workspace.isTrusted && this.alternativeKey()===key && (this.featureSourceEpoch || 0)===epoch;
    const alternatives=this.visualAlternativesSessions?.get(key)?.snapshot(),active=this.featureSnapshot()?.activeId;
    // Only active feature decisions need fresh source projections. Explicit sharing
    // performs a separate canonical read; this cache never authorizes a request.
    const paths=[...new Set(snapshot.decisions.filter(item=>item.feature.id===active || item.contextFiles.some(file=>file.path===this.activeFile?.path)).flatMap(item=>item.contextFiles.map(file=>file.path)).concat(
      alternatives?.records.filter(item=>this.decisionAdoption(item)).flatMap(item=>item.scope.feature.paths) || []))].slice(0,192);
    const hashes=new Map<string,string>();
    if(paths.length){const result=await this.service.getFiles(project.id,paths,{isCurrent:current});if(!current())return;
      for(const file of result.files as ProjectFile[])hashes.set(file.path,createHash("sha256").update(file.source).digest("hex"));}
    if(current())this.projectDecisionSources={projectId:project.id,root:project.root,epoch,hashes};
  }

  private decisionAdoptionStatus(decision:ProjectDecision, inputs?:{proposal:any;group:any}):"applied"|"undone"|"missing" {
    const choice=decision.choice,hashMatches=(source:any,expected:string)=>typeof source==="string" && createHash("sha256").update(source).digest("hex")===expected;
    if(decision.adoption.kind==="token") {
      const proposal=inputs?inputs.proposal:this.proposals().current(),file=choice.files[0],basis=proposal?.alternativeBasis;
      return choice.kind==="token" && proposal?.id===decision.adoption.id && proposal.projectId===decision.projectId && proposal.origin==="design" &&
        proposal.appliedAt===decision.adoption.appliedAt && proposal.path===file.path && proposal.baseRevision===file.beforeHash.slice(0,16) &&
        proposal.appliedRevision===file.afterHash.slice(0,16) && hashMatches(proposal.before,file.beforeHash) && hashMatches(proposal.after,file.afterHash) &&
        basis?.version===1 && basis.comparisonId===choice.comparisonId && basis.baselineDigest===choice.baselineDigest &&
        basis.beforeHash===file.beforeHash && basis.afterHash===file.afterHash && ["applied","undone"].includes(proposal.status) ? proposal.status : "missing";
    }
    const adoption=decision.adoption,snapshot=inputs?inputs.group:this.changeSetSnapshot();
    if(choice.kind!=="change-set" || snapshot?.storage?.status!=="saved")return "missing";
    const version=snapshot.versions?.find((item:any)=>item.group.id===adoption.id);
    const group=version?.group ?? (snapshot.current?.id===adoption.id?snapshot.current:null),basis=group?.alternativeBasis;
    const checkpoints=version?.checkpoints ?? snapshot.checkpoints;
    // Undo advances the group revision but retains the exact original adoption,
    // full source basis and applied checkpoint. A matching ID alone is insufficient.
    return group?.id===adoption.id && group.projectId===decision.projectId && group.origin==="alternative" &&
      Number.isSafeInteger(group.revision) && group.revision>=adoption.revision && ["applied","undone"].includes(group.status) &&
      basis?.version===2 && basis.kind==="change-set" && basis.comparisonId===choice.comparisonId && basis.baselineDigest===choice.baselineDigest &&
      basis.sourceGroupId===choice.sourceId && basis.sourceGroupRevision===choice.sourceRevision && basis.sourceGroupDigest===choice.sourceDigest &&
      Array.isArray(basis.files) && projectDecisionEvidenceDigest(basis.files)===projectDecisionEvidenceDigest(choice.files) &&
      Array.isArray(group.files) && group.files.length===choice.files.length && new Set(group.files.map((file:any)=>file.path)).size===group.files.length &&
      group.files.every((file:any)=>{const expected=choice.files.find(item=>item.path===file.path);return expected &&
        file.baseRevision===expected.beforeHash.slice(0,16) && file.appliedRevision===expected.afterHash.slice(0,16) &&
        hashMatches(file.before,expected.beforeHash) && hashMatches(file.after,expected.afterHash);}) &&
      checkpoints?.some((item:any)=>item.id===adoption.checkpointId && item.kind==="applied" && item.createdAt===adoption.appliedAt) ? group.status : "missing";
  }

  private decisionScopeCurrent(record:any, project:ProjectSnapshot, inputs?:{features:any;workspace:any}) {
    const features=inputs?inputs.features:this.features(project).snapshot(),workspace=inputs?inputs.workspace:this.runtimeWorkspaceStore(project).presentation().snapshot;
    const feature=features.features.find((item:any)=>item.id===record.scope.feature.id && !item.archived);
    return features.storage.status==="saved" && workspace.storage.status==="saved" && Boolean(feature) &&
      projectDecisionEvidenceDigest({id:feature!.id,title:feature!.title,paths:feature!.paths})===projectDecisionEvidenceDigest({id:record.scope.feature.id,title:record.scope.feature.title,paths:record.scope.feature.paths}) &&
      projectDecisionEvidenceDigest(workspace.screens.find((item:any)=>item.id===record.scope.screen.id) ?? null)===projectDecisionEvidenceDigest(record.scope.screen) &&
      projectDecisionEvidenceDigest(workspace.scenarios.find((item:any)=>item.id===record.scope.scenario.id) ?? null)===projectDecisionEvidenceDigest(record.scope.scenario);
  }

  private projectDecisionsSnapshot() {
    const project=this.project;if(!project || !vscode.workspace.isTrusted)return null;
    const saved=this.projectDecisionStore(project).presentation().snapshot,alternatives=this.visualAlternativesSessions?.get(this.alternativeKey())?.snapshot();
    const inputs=saved.decisions.length?{features:this.features(project).snapshot(),workspace:this.runtimeWorkspaceStore(project).presentation().snapshot,proposal:this.proposals().current(),group:this.changeSetSnapshot()}:undefined;
    const records=saved.decisions.map(record=>{
      const comparison=alternatives?.storage.status==="saved" ? alternatives.records.find(item=>item.id===record.choice.comparisonId) : undefined;
      const status=assessProjectDecision(record,{files:record.contextFiles.map(file=>({path:file.path,hash:this.decisionSourceHash(file.path)})),dirtyPaths:this.dirtyPaths().filter(path=>record.contextFiles.some(file=>file.path===path)),
        adoptionStatus:this.decisionAdoptionStatus(record,inputs),comparisonDigest:comparison?projectDecisionEvidenceDigest(comparison):null,
        supersededBy:saved.decisions.find(item=>item.supersedes===record.id)?.id});
      const scopeCurrent=this.decisionScopeCurrent({scope:record.choice.scope},project,inputs);
      const reason=status.supersededBy ? "A later decision supersedes this rationale." : status.adoption==="undone" ? "This change is no longer applied." :
        status.adoption==="missing" ? "The recorded adoption checkpoint is unavailable." : !scopeCurrent ? "The saved feature, screen or scenario changed." : status.source==="stale" ? "Contributing source has changed or has an unsaved draft." :
        status.source==="missing" ? "Refresh this feature to check its saved source." : status.evidence!=="available" ? "The retained comparison evidence is unavailable or changed." :
        saved.storage.status!=="saved" ? "Restore decision storage before sharing." : record.feature.id!==this.featureSnapshot()?.activeId ? "Select this decision’s feature before sharing it." : undefined;
      return {record,digest:projectDecisionDigest(record),status:{...status,scope:scopeCurrent?"current":"stale"},reason,canShare:!reason};
    });
    const candidate=this.decisionCandidate();
    return {schemaVersion:1,projectId:project.id,revision:saved.revision,storage:saved.storage,records,
      busy:Boolean(this.projectDecisionBusy),error:this.projectDecisionError?.key===this.alternativeKey()?this.projectDecisionError.message:undefined,
      ...(candidate?{candidate:{id:candidate.id,digest:candidate.digest,title:candidate.title,files:candidate.files,feature:candidate.feature,evidence:candidate.evidence,
        canRecord:candidate.canRecord && !this.projectDecisionBusy && !this.alternativeWorkBusy(project) && !this.alternativesBusy(),reason:candidate.reason}}:{})};
  }

  private async projectDecisionAction(message:any) {
    const project=this.project,key=this.alternativeKey();
    try {
      if(!project || this.disposed || !vscode.workspace.isTrusted || message.projectId!==project.id)throw new Error("Choose a decision in the current trusted project.");
      const store=this.projectDecisionStore(project),saved=store.snapshot();
      if(message.revision!==saved.revision)throw new Error("Decision history changed. Review its latest state.");
      if(message.action==="navigate") {
        const decision=saved.decisions.find(item=>item.id===message.decisionId);
        if(!decision?.contextFiles.some(file=>file.path===message.path))throw new Error("Choose a source linked to this decision.");
        await this.navigate(message.path,1);return;
      }
      if(message.action==="viewComparison") {
        const decision=saved.decisions.find(item=>item.id===message.decisionId);
        if(!decision)throw new Error("Choose a saved decision in this project.");
        const session=this.alternativesSession(project),history=session.snapshot();
        const evidence=await session.readDecisionEvidence(decision.choice.comparisonId,history.revision);
        if(this.disposed || !vscode.workspace.isTrusted || this.alternativeKey()!==key || store.presentation().snapshot.revision!==saved.revision ||
          projectDecisionEvidenceDigest(evidence)!==decision.choice.comparisonDigest)throw new Error("This retained comparison is unavailable or changed. The decision is preserved.");
        await this.show("Review");
        await this.panel?.webview.postMessage({type:"revealAlternativeRecord",projectId:project.id,decisionId:decision.id,comparisonId:decision.choice.comparisonId});return;
      }
      if(this.projectDecisionBusy || this.alternativeWorkBusy(project) || this.alternativesBusy())throw new Error("Finish the current source or runtime action first.");
      if(message.action==="retry"){await store.retry();await this.refreshProjectDecisions();return;}
      if(message.action!=="record")throw new Error("Choose a project decision action.");
      const candidate=this.decisionCandidate();
      if(!candidate?.canRecord || candidate.id!==message.candidateId || candidate.digest!==message.candidateDigest)throw new Error(candidate?.reason || "Review the currently applied alternative before recording a decision.");
      const epoch=this.featureSourceEpoch || 0,history=this.alternativesSession(project).snapshot();
      const current=()=>!this.disposed && vscode.workspace.isTrusted && this.alternativeKey()===key &&
        (this.featureSourceEpoch || 0)===epoch && !this.dirtyPaths().some(path=>candidate.feature.paths.includes(path)) &&
        this.decisionCandidate()?.digest===candidate.digest && this.alternativeScopeCurrent(candidate.record,project);
      this.projectDecisionBusy=key;this.projectDecisionError=undefined;this.sendState();
      const record=await this.alternativesSession(project).readDecisionEvidence(candidate.record.id,history.revision);
      if(!current() || projectDecisionEvidenceDigest(record)!==projectDecisionEvidenceDigest(candidate.record))throw new Error("The applied alternative changed while recording its decision.");
      const variant=record.variants.find(item=>item.id==="alternative")!,run=variant.outcome.observation!;
      const contextFiles=run.sources.map(file=>({path:file.path,hash:file.revision}));
      for(const file of candidate.files){const source=contextFiles.find(item=>item.path===file.path);if(!source || source.hash!==file.afterHash)throw new Error("The comparison source does not match the adopted change.");}
      for(const source of contextFiles){const file:ProjectFile=await this.service.getFile(project.id,source.path);if(!current() || createHash("sha256").update(file.source).digest("hex")!==source.hash)throw new Error("Contributing source changed. The decision has not been recorded.");}
      const choice:any={kind:record.source?"change-set":"token",comparisonId:record.id,candidateName:record.candidate!.name,comparisonDigest:projectDecisionEvidenceDigest(record),baselineDigest:record.baselineDigest,
        sourceId:record.source ? record.source.groupId : record.proposalId,...(record.source?{sourceRevision:record.source.groupRevision,sourceDigest:record.source.groupDigest}:{}),
        files:candidate.files,scope:record.scope,recipe:{id:record.recipe.id,title:record.recipe.title,route:record.recipe.route,fixture:record.recipe.fixture,catalogDigest:record.recipe.catalogDigest},requested:record.requested,
        evidence:record.variants.map(item=>{const observation=item.outcome.observation!,replay=item.outcome.replay,capture=item.outcome.capture;return {variant:item.id,
          run:{id:observation.id,digest:projectDecisionEvidenceDigest(observation),status:observation.status,assessment:observation.assessment,observationCount:observation.observations.length,
            requestCount:observation.observations.filter(event=>event.kind==="request").length,unattributedRequestCount:observation.observations.filter(event=>event.correlation==="unattributed").length,truncated:observation.truncated},
          replay:replay?{id:replay.id,digest:projectDecisionEvidenceDigest(replay),status:replay.status}:null,capture:capture?{id:capture.id,digest:projectDecisionEvidenceDigest(capture)}:null};}),
        compilation:"not-recorded",assessment:"not-assessed",sourceRelationship:"unverified"};
      await store.create({projectId:project.id,title:message.title,rationale:message.rationale,feature:record.scope.feature,choice,adoption:candidate.adoption,contextFiles,
        ...(message.supersedesId?{supersedes:message.supersedesId}:{})},saved.revision,{isCurrent:current});
      await this.refreshProjectDecisions();
    } catch(error) {this.projectDecisionError={key,message:error instanceof Error?error.message:"The decision could not be saved."};throw error;}
    finally {if(this.projectDecisionBusy===key)this.projectDecisionBusy=undefined;this.sendState();}
  }

  private async resolveDecisionContext(input:any, expectedProjectId?:string) {
    if(input===undefined)return undefined;
    const project=this.project,key=this.alternativeKey(),epoch=this.featureSourceEpoch || 0;
    if(!project || !vscode.workspace.isTrusted || expectedProjectId!==undefined && expectedProjectId!==project.id)throw new Error("Choose decisions from this trusted project.");
    const supplied=Array.isArray(input)?undefined:normalizeProjectDecisionContext(input,{projectId:project.id});
    const selected=Array.isArray(input)?input:supplied?.decisions.map(item=>({id:item.decision.id,digest:item.digest}));
    if(!Array.isArray(selected) || !selected.length || selected.length>4 || new Set(selected.map(item=>item?.id)).size!==selected.length || selected.some(item=>!item || Object.keys(item).some(key=>!["id","digest"].includes(key))))throw new Error("Explicitly select up to four current project decisions.");
    const store=this.projectDecisionStore(project),history=store.snapshot(),featureId=this.featureSnapshot()?.activeId;
    const current=()=>!this.disposed && vscode.workspace.isTrusted && this.alternativeKey()===key && (this.featureSourceEpoch || 0)===epoch &&
      this.featureSnapshot()?.activeId===featureId && store.presentation().snapshot.revision===history.revision && store.presentation().snapshot.storage.status==="saved";
    if(!current())throw new Error("Restore decision storage before sharing.");
    const decisions=[];
    for(const descriptor of selected) {
      const decision=history.decisions.find(item=>item.id===descriptor.id);
      if(!decision || projectDecisionDigest(decision)!==descriptor.digest || decision.feature.id!==featureId || history.decisions.some(item=>item.supersedes===decision.id) || this.decisionAdoptionStatus(decision)!=="applied")throw new Error("This decision is stale, superseded or no longer applied. Review its context.");
      const alternatives=this.alternativesSession(project),snapshot=alternatives.snapshot();
      const evidence=await alternatives.readDecisionEvidence(decision.choice.comparisonId,snapshot.revision);
      if(!current() || !this.decisionScopeCurrent(evidence,project) || projectDecisionEvidenceDigest(evidence)!==decision.choice.comparisonDigest)throw new Error("The retained decision evidence changed.");
      for(const source of decision.contextFiles) {
        const file:ProjectFile=await this.service.getFile(project.id,source.path);
        if(!current() || this.dirtyPaths().includes(source.path) || createHash("sha256").update(file.source).digest("hex")!==source.hash)throw new Error("A decision source changed or has an unsaved draft. Remove that decision before sending.");
      }
      if(!current() || this.decisionAdoptionStatus(decision)!=="applied")throw new Error("The decision checkpoint changed before sharing.");
      decisions.push({decision,digest:descriptor.digest});
    }
    const result=normalizeProjectDecisionContext({version:1,projectId:project.id,decisions},{projectId:project.id});
    if(supplied && projectDecisionEvidenceDigest(supplied)!==projectDecisionEvidenceDigest(result))throw new Error("The disclosed decision context changed.");
    return result;
  }

  private async showKnowledge() {
    const project=this.project;if(!project || !vscode.workspace.isTrusted || this.disposed)return;
    this.knowledgeReveal={projectId:project.id,root:project.root};
    await this.show("Understand");this.flushKnowledgeReveal();
  }

  private flushKnowledgeReveal() {
    const reveal=this.knowledgeReveal;
    if(!reveal || !this.workspaceReady || !this.panel)return;
    this.knowledgeReveal=undefined;
    if(!this.disposed && vscode.workspace.isTrusted && this.mode==="Understand" && this.project?.id===reveal.projectId && this.project.root===reveal.root)
      void this.panel.webview.postMessage({type:"revealKnowledge",projectId:reveal.projectId});
  }

  private knowledgeOfferCurrent(offer:KnowledgeOffer) {
    return this.knowledgeOffer===offer && !this.disposed && vscode.workspace.isTrusted && !this.asking &&
      this.project?.id===offer.projectId && this.project.root===offer.root && (this.featureSourceEpoch || 0)===offer.epoch &&
      (this.featureSnapshot()?.activeId ?? null)===offer.featureId && (this.conversationPresentation().snapshot.activeId ?? null)===offer.conversationId &&
      (this.panel?.webview===offer.source || this.assistantView?.webview===offer.source);
  }

  private finishKnowledgeOffer(error?:string) {
    const offer=this.knowledgeOffer;if(!offer)return;this.knowledgeOffer=undefined;
    if(this.panel?.webview===offer.source || this.assistantView?.webview===offer.source)
      void offer.source.postMessage({type:"knowledgeContextResult",projectId:offer.projectId,kind:offer.kind,id:offer.id,digest:offer.digest,...(error?{error}:{})});
  }

  private async resolveKnowledgeOffer(offer:KnowledgeOffer) {
    if(!this.knowledgeOfferCurrent(offer))throw new Error("Project or conversation changed. Choose the knowledge record again.");
    if(offer.kind==="decision")return this.resolveDecisionContext([{id:offer.id,digest:offer.digest}],offer.projectId);
    // Refresh only the chosen issue's bounded saved-source basis. Historical
    // evidence remains usable, with its exact current assessment disclosed.
    await this.refreshReproducibleIssues(offer.id);
    if(!this.knowledgeOfferCurrent(offer))throw new Error("Issue context changed. Choose the record again.");
    const item=this.reproducibleIssuesSnapshot()?.records.find((item:any)=>item.record.id===offer.id&&item.digest===offer.digest);
    if(!item?.canShare)throw new Error(item?.reason || "Choose an available issue from the active feature.");
    return this.resolveIssueContext([{id:offer.id,digest:offer.digest,assessment:item.status}],offer.projectId);
  }

  private async prepareKnowledgeContext(message:any,surface:Surface) {
    const source=surface==="assistant"?this.assistantView?.webview:this.panel?.webview,project=this.project;
    const fail=(error:string)=>void source?.postMessage({type:"knowledgeContextResult",projectId:message.projectId,kind:message.kind,id:message.id,digest:message.digest,error});
    if(message.action!=="prepare" || !source || !project || this.disposed || !vscode.workspace.isTrusted || message.projectId!==project.id ||
      !["decision","issue"].includes(message.kind) || typeof message.id!=="string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(message.id) ||
      typeof message.digest!=="string" || !/^[a-f0-9]{64}$/.test(message.digest)){fail("Choose a saved knowledge record from this trusted project.");return;}
    if(this.knowledgeOffer && !this.knowledgeOfferCurrent(this.knowledgeOffer))this.finishKnowledgeOffer("Project or conversation changed. Choose the knowledge record again.");
    if(this.knowledgeOffer || this.asking){fail("Finish the current Assistant action before adding knowledge.");return;}
    const offer:KnowledgeOffer={prepareId:randomUUID(),projectId:project.id,root:project.root,featureId:this.featureSnapshot()?.activeId ?? null,
      conversationId:this.conversationPresentation().snapshot.activeId ?? null,epoch:this.featureSourceEpoch || 0,kind:message.kind,id:message.id,digest:message.digest,source};
    this.knowledgeOffer=offer;
    try {
      offer.context=await this.resolveKnowledgeOffer(offer);
      if(!this.knowledgeOfferCurrent(offer))throw new Error("Project or conversation changed. Choose the knowledge record again.");
      await this.showAssistant();
      if(!this.knowledgeOfferCurrent(offer))throw new Error("Project or conversation changed. Choose the knowledge record again.");
      await this.flushKnowledgePreparation();
    }catch(error){if(this.knowledgeOffer===offer)this.finishKnowledgeOffer(error instanceof Error?error.message:"Knowledge could not be added.");}
  }

  private async flushKnowledgePreparation() {
    const offer=this.knowledgeOffer,view=this.assistantView;
    if(offer && !this.knowledgeOfferCurrent(offer)){this.finishKnowledgeOffer("Project or conversation changed. Choose the knowledge record again.");return;}
    if(!offer || !offer.context || offer.delivering || offer.delivered || !view || !this.assistantReady || !view.visible || !this.assistantOpen)return;
    offer.delivering=true;
    try {
      if(!this.knowledgeOfferCurrent(offer))throw new Error("Project or conversation changed. Choose the knowledge record again.");
      const current=offer.kind==="decision"?await this.resolveDecisionContext(offer.context,offer.projectId):await this.resolveIssueContext(offer.context,offer.projectId);
      if(!current || !this.knowledgeOfferCurrent(offer) || this.assistantView!==view || !view.visible)throw new Error("Assistant context changed. Choose the knowledge record again.");
      offer.target=view.webview;offer.delivered=true;this.sendState();
      const sent=await view.webview.postMessage({type:"knowledgeContextPrepared",prepareId:offer.prepareId,projectId:offer.projectId,featureId:offer.featureId,
        conversationId:offer.conversationId,kind:offer.kind,id:offer.id,digest:offer.digest});
      if(!sent && this.knowledgeOffer===offer)this.finishKnowledgeOffer("Assistant is unavailable. Choose Use in Assistant again.");
    }catch(error){if(this.knowledgeOffer===offer)this.finishKnowledgeOffer(error instanceof Error?error.message:"Knowledge could not be added.");}
    finally{offer.delivering=false;}
  }

  private knowledgeContextApplied(message:any) {
    const offer=this.knowledgeOffer;
    if(!offer || !offer.delivered || offer.target!==this.assistantView?.webview || message.prepareId!==offer.prepareId ||
      ["projectId","featureId","conversationId","kind","id","digest"].some(key=>message[key]!==offer[key as keyof KnowledgeOffer]))return;
    this.finishKnowledgeOffer(!this.knowledgeOfferCurrent(offer)?"Context changed. Review the selected knowledge before sending.":typeof message.error==="string"?message.error.slice(0,400):undefined);
  }

  private visualVerificationStore(project = this.project) {
    if (!project) throw new Error("Open a project before linking visual verification.");
    this.visualVerificationStores ||= new Map();
    let store = this.visualVerificationStores.get(project.id);
    if (!store) {
      const key = `foundation.visual-verification.${project.id}`;
      store = createVisualVerificationStore({projectId:project.id, read:()=>this.context.workspaceState.get(key),
        write:value=>this.context.workspaceState.update(key,value), onChange:()=>this.queueConversationState(project.id)});
      this.visualVerificationStores.set(project.id,store);
    }
    return store;
  }

  private visualVerificationInputs(project = this.project) {
    if (!project) throw new Error("Open a project before reviewing visual verification.");
    let captures;
    try { captures=this.runtimeCaptureStorage(project).store.snapshot(); }
    catch { captures={schemaVersion:1 as const,projectId:project.id,revision:0,captures:[],storage:{status:"unavailable" as const}}; }
    const workspace=this.runtimeWorkspaceStore(project).presentation();
    return {projectId:project.id, proposal:this.proposals().current(), workspace:workspace.snapshot, workspaceEpoch:workspace.epoch,
      captures, replays:this.runtimeReplayStore(project).snapshot()};
  }

  private visualVerificationSnapshot() {
    const project=this.project;
    if (!project || !vscode.workspace.isTrusted) return null;
    const inputs=this.visualVerificationInputs(project), verification=this.visualVerificationStore(project).snapshot();
    const cached=this.visualVerificationSources;
    const currentSources=cached?.projectId===project.id && cached.root===project.root && cached.epoch===(this.featureSourceEpoch || 0)
      ? [...new Set([inputs.proposal?.path,...verification.entries.map(entry=>entry.basis.path)].filter(Boolean) as string[])].flatMap(path=>{
        const file=cached.files.get(path);
        if (!file) return [];
        this.visualVerificationSourceDigests ||= new WeakMap();
        let digest=this.visualVerificationSourceDigests.get(file);
        if (!digest || digest.source!==file.source) { digest={source:file.source,revision:createHash("sha256").update(file.source).digest("hex")}; this.visualVerificationSourceDigests.set(file,digest); }
        return [{path,revision:digest.revision}];
      }) : undefined;
    const dirtyPaths=this.dirtyPaths();
    // These stores publish immutable committed records. Revisions and presentation
    // epochs invalidate this single display cache; linking still validates fresh inputs.
    const key=visualVerificationDigest({projectId:project.id,root:project.root,proposal:inputs.proposal,
      workspace:[inputs.workspaceEpoch ?? null,inputs.workspace.revision,inputs.workspace.storage],
      captures:[inputs.captures.revision,inputs.captures.storage],replays:[inputs.replays.revision,inputs.replays.storage],
      verification:[verification.revision,verification.storage],sources:currentSources ?? null,dirtyPaths});
    if (this.visualVerificationProjectionCache?.key!==key)
      this.visualVerificationProjectionCache={key,view:visualVerificationView({...inputs,verification,currentSources,dirtyPaths})};
    const view=structuredClone(this.visualVerificationProjectionCache.view);
    // A valid historical pair remains reviewable while a new source action is busy.
    if (view.proposal?.canLink && (this.visualVerificationWorkBusy() || this.alternativesBusy())) {
      view.proposal.canLink=false; view.proposal.reason="Finish the current source or runtime action before linking observations.";
    }
    return {...view,busy:this.visualVerificationBusy?.projectId===project.id && this.visualVerificationBusy.root===project.root ? this.visualVerificationBusy.action : null,
      error:this.visualVerificationError?.projectId===project.id && this.visualVerificationError.root===project.root ? this.visualVerificationError.message : null};
  }

  private visualVerificationWorkBusy() {
    return Boolean(this.reproducibleIssueBusy || this.projectDecisionBusy || this.proposalMutationCount || this.asking || this.runtimeWorkspaceBusy || this.runtimeStateSuiteBusy ||
      this.runtimeMatrixTask || this.runtimeMatrixRecovery || this.runtimeReplayTask || this.scenarioCapture ||
      this.changeSetSnapshot()?.busy || this.executionSnapshot()?.busy);
  }

  private async visualVerificationAction(message: any) {
    const selected=this.project, project=selected && {id:selected.id,root:selected.root};
    let operation: NonNullable<FoundationHost["visualVerificationBusy"]> | undefined;
    try {
      if (!selected || !project || !vscode.workspace.isTrusted || this.disposed || message.projectId!==project.id)
        throw new Error("Choose visual verification in the current trusted project.");
      if (!["link","viewScenario","compare","retry"].includes(message.action)) throw new Error("Choose a visual verification action.");
      if (this.visualVerificationBusy || this.visualVerificationWorkBusy() || this.alternativesBusy()) throw new Error("Finish the current source or runtime action first.");
      const store=this.visualVerificationStore(selected), saved=store.snapshot();
      if (message.expectedRevision!==saved.revision) throw new Error("Visual verification changed. Review its saved version before trying again.");
      if (message.action!=="retry" && saved.storage.status!=="saved") throw new Error("Restore visual verification storage before continuing.");
      const inputs=this.visualVerificationInputs(selected), proposalFingerprint=visualVerificationDigest(inputs.proposal ?? null);
      const definitions=inputs.workspace, featureStore=this.features(selected), features=featureStore.snapshot();
      let featureRevision=features.revision, workspaceRevision=definitions.revision;
      const sourceEpoch=this.featureSourceEpoch || 0, proposalGeneration=this.proposalMutationGeneration || 0, panel=this.panel;
      const view=visualVerificationView({...inputs,verification:saved});
      if (["link","viewScenario"].includes(message.action) && (!view.proposal || message.proposalBasis!==view.proposal.proposalBasis))
        throw new Error("The source proposal changed. Review it before choosing verification.");
      operation={projectId:project.id,root:project.root,action:message.action};
      this.visualVerificationBusy=operation; this.visualVerificationError=undefined; this.sendState();
      const ownerCurrent=()=>!this.disposed && vscode.workspace.isTrusted && this.project?.id===project.id && this.project?.root===project.root &&
        this.visualVerificationBusy===operation && !this.visualVerificationWorkBusy() && !this.alternativesBusy() && (!panel || this.panel===panel);
      const current=()=>ownerCurrent() && store.snapshot().revision===saved.revision &&
        (message.action==="link" || store.snapshot().storage.status==="saved") && (this.featureSourceEpoch || 0)===sourceEpoch &&
        (this.proposalMutationGeneration || 0)===proposalGeneration && visualVerificationDigest(this.proposals().current() ?? null)===proposalFingerprint &&
        featureStore.snapshot().revision===featureRevision && featureStore.snapshot().storage.status==="saved" &&
        this.runtimeWorkspaceStore(selected).presentation().snapshot.revision===workspaceRevision &&
        this.runtimeWorkspaceStore(selected).presentation().snapshot.storage.status==="saved" &&
        this.runtimeReplayStore(selected).snapshot().revision===inputs.replays.revision &&
        this.runtimeReplayStore(selected).snapshot().storage.status===inputs.replays.storage.status &&
        this.runtimeCapturesSnapshot()?.revision===inputs.captures?.revision && this.runtimeCapturesSnapshot()?.storage.status===inputs.captures?.storage.status;
      const check=()=>{if(!current()) throw new Error("The project, proposal, or saved evidence changed. Review verification before continuing.");};
      if (message.action==="retry") {
        // Retry only repairs this local journal; it cannot run or restore a runtime.
        const result=await store.retry();
        if (!ownerCurrent()) throw new Error("The trusted project changed while local storage was loading.");
        return result;
      }
      check();
      if (message.action==="link") {
        if (!view.proposal.canLink) throw new Error(view.proposal.reason || "Apply the current visual source proposal before linking observations.");
        // Reconcile committed capture metadata before freezing its optional reference.
        if (inputs.captures?.storage.status==="saved") {
          const reconciled=this.runtimeCaptureStorage(selected).store.reconcile();
          if (reconciled.revision!==inputs.captures.revision) throw new Error("Saved captures changed. Review the observations before linking them.");
        }
        check();
        const prepared=prepareVisualVerificationLink({...inputs,scenarioId:message.scenarioId,beforeId:message.beforeId,afterId:message.afterId});
        const target=await this.service.getFile(project.id,prepared.basis.path);
        check();
        if (this.dirtyPaths().includes(prepared.basis.path) || createHash("sha256").update(target.source).digest("hex")!==prepared.basis.afterHash || target.revision!==prepared.basis.appliedRevision)
          throw new Error("The applied saved source changed or has an unsaved draft. Review it before linking observations.");
        const isCurrent=()=>current() && !this.dirtyPaths().includes(prepared.basis.path);
        return await store.link(prepared,saved.revision,{isCurrent});
      }
      let scope: {featureId:string;screenId:string;scenarioId:string}, record: any;
      if (message.action==="viewScenario") {
        const selectedScope=view.proposal.scenarios.find((item:any)=>item.scenarioId===message.scenarioId && item.screenId===message.screenId && item.featureId===message.featureId && item.canView);
        if (!selectedScope) throw new Error("Choose an available scenario from this proposal.");
        scope=selectedScope;
        if (!definitions.screens.some((item:any)=>item.id===scope.screenId && item.featureId===scope.featureId && !item.archived) ||
          !definitions.scenarios.some((item:any)=>item.id===scope.scenarioId && item.screenId===scope.screenId && !item.archived))
          throw new Error("The saved scenario is unavailable. Review its definitions first.");
      } else {
        record=view.records.find((item:any)=>item.id===message.id);
        if (!record?.canCompare) throw new Error(record?.reason || "This saved verification pair is unavailable.");
        scope=record;
      }
      const feature=features.features.find(item=>item.id===scope.featureId && !item.archived);
      if (!feature || features.storage.status!=="saved") throw new Error("The saved feature is unavailable. Restore it before opening verification.");
      if (features.activeId!==feature.id) {
        const result=await featureStore.select(feature.id,featureRevision);
        featureRevision=result.revision; check();
        this.featurePreparation=undefined; this.clearFeatureView();
      }
      if (message.action==="viewScenario") {
        const result=await this.runtimeWorkspaceStore(selected).select(scope.screenId,scope.scenarioId,workspaceRevision);
        workspaceRevision=result.revision; check();
      }
      // Metadata-only navigation deliberately does not open a screen, start an observation,
      // select a recipe, capture an image, or change any source. Lost ownership suppresses
      // navigation; we do not roll back a selection over newer user choices.
      await this.loadFeatureFiles(); check();
      this.updateTree(); this.show(message.action==="viewScenario" ? "Refine" : "Understand"); this.sendState(); check();
      await this.panel?.webview.postMessage(message.action==="viewScenario"
        ? {type:"visualVerificationScenario",projectId:project.id,featureId:scope.featureId,screenId:scope.screenId,scenarioId:scope.scenarioId}
        : {type:"visualVerificationComparison",projectId:project.id,featureId:scope.featureId,id:record.id,beforeId:record.beforeId,afterId:record.afterId});
      return {projectId:project.id,...scope};
    } catch (error) {
      if (project && this.project?.id===project.id && this.project.root===project.root)
        this.visualVerificationError={root:project.root,projectId:project.id,message:error instanceof Error?error.message:"Visual verification could not be updated."};
      throw error;
    } finally {
      if (operation && this.visualVerificationBusy===operation) this.visualVerificationBusy=undefined;
      this.sendState();
    }
  }

  private runtimeReplayStore(project = this.project) {
    if (!project) throw new Error("Open a project before replaying a scenario.");
    this.runtimeReplayStores ||= new Map();
    let store = this.runtimeReplayStores.get(project.id);
    if (!store) {
      const key = `foundation.runtime-replays.${project.id}`;
      store = createRuntimeReplayStore({ projectId: project.id,
        read: () => this.context.workspaceState.get(key),
        write: value => this.context.workspaceState.update(key, value),
        onChange: () => this.queueConversationState(project.id),
      });
      this.runtimeReplayStores.set(project.id, store);
    }
    return store;
  }

  private runtimeReplaySnapshot() {
    if (!this.project || !vscode.workspace.isTrusted) return null;
    return { ...this.runtimeReplayStore().snapshot(), busy: this.runtimeReplayTask?.projectId === this.project.id,
      error: this.runtimeReplayError };
  }

  private interruptRuntimeReplay(reason = "context-changed") {
    this.interruptRuntimeMatrix(reason);
    const task = this.runtimeReplayTask;
    if (task) { task.reason ||= reason; task.controller.abort(); }
  }

  private async stopRuntimeReplay(reason = "cancelled") {
    const task = this.runtimeReplayTask;
    if (!task) return;
    task.reason ||= reason;
    task.controller.abort();
    this.sendState();
    await task.done?.catch(() => {});
  }

  private async runtimeReplayAction(message: any, matrixOwner?: NonNullable<FoundationHost["runtimeMatrixTask"]>) {
    if (this.alternativesBusy()) throw new Error("Stop the comparison before starting another source or runtime action.");
    if (this.runtimeMatrixRecovery || this.runtimeMatrixTask && (!matrixOwner || !this.matrixOwnerCurrent(matrixOwner))) throw new Error("Stop the condition matrix before changing its replay.");
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted || message.projectId !== project.id)
      throw new Error("Choose an observation in the current trusted project.");
    if (message.action === "cancel") {
      const task = this.runtimeReplayTask;
      const saved = this.runtimeReplayStore(project).snapshot().replays.find(item => item.id === message.id);
      if (!task || task.projectId !== project.id || task.executionId !== message.executionId || saved?.executionId !== task.executionId)
        throw new Error("Choose the active replay to stop.");
      task.reason = "cancelled"; task.controller.abort(); this.sendState(); return;
    }
    if (this.runtimeReplayTask) throw new Error("Wait for the active replay to stop before continuing.");
    const store = this.runtimeReplayStore(project);
    if (message.action === "retry") {
      await store.retry();
      for (const item of store.snapshot().replays.filter(item => item.status === "running"))
        await store.finish(item.id, { status: "interrupted", reason: "storage-failed" });
      this.runtimeReplayError = undefined; this.sendState(); return;
    }
    if (message.action !== "start") throw new Error("Choose a replay action.");
    const capture = this.scenarioCapture, runtime = this.runtime, panel = this.panel;
    if (!capture || capture.run.id !== message.runId || capture.projectId !== project.id || capture.ending || this.runtimeWorkspaceBusy ||
      this.scenarioOwnershipReason(capture.run, project.id) || !runtime || !panel?.visible || this.mode !== "Refine")
      throw new Error("Begin an observation in the visible running preview before replaying a recipe.");
    const snapshot = store.snapshot();
    if (snapshot.storage.status !== "saved" || snapshot.revision !== message.expectedRevision)
      throw new Error("Review the latest saved replay history before starting.");
    if (snapshot.replays.some(item => item.runId === capture.run.id))
      throw new Error("This observation already has a replay. Finish it and begin a new observation to run again.");
    const requested = message.requested;
    if (!requested || Object.keys(requested).some(key => !["theme", "motion", "viewportWidthCss", "viewportHeightCss"].includes(key)) ||
      !["light", "dark"].includes(requested.theme) || !["system", "reduce"].includes(requested.motion) ||
      ![390, 768, 960].includes(requested.viewportWidthCss) || requested.viewportHeightCss !== 680)
      throw new Error("Choose the current preview size, application theme, and motion preference.");
    const run = capture.run, sourceEpoch = this.featureSourceEpoch;
    const task: NonNullable<FoundationHost["runtimeReplayTask"]> = { projectId: project.id, runId: run.id,
      executionId: matrixOwner ? this.runtimeMatrixStore().snapshot().matrices.find(item => item.id === matrixOwner.id)!.cells.find(item => item.id === matrixOwner.cellId)!.replayExecutionId : randomBytes(16).toString("hex"), controller: new AbortController() };
    const fail = (reason: string, text: string) => { task.reason ||= reason; throw new Error(text); };
    const guard = async () => {
      if (matrixOwner && !this.matrixOwnerCurrent(matrixOwner)) fail(matrixOwner.reason || "context-changed", "The condition matrix stopped before the next replay action.");
      if (task.controller.signal.aborted) fail(task.reason || "cancelled", "Replay stopped. Earlier effects may remain.");
      if (this.disposed || !vscode.workspace.isTrusted || this.project?.id !== project.id || this.runtime !== runtime ||
        this.scenarioCapture !== capture || capture.ending || this.scenarioOwnershipReason(run, project.id) ||
        this.panel !== panel || !panel.visible || this.mode !== "Refine") fail("context-changed", "The observation or visible preview changed during replay.");
      if (this.featureSourceEpoch !== sourceEpoch) fail("source-changed", "Saved source changed during replay. Start a new observation.");
      for (const source of run.sources) {
        let file: ProjectFile;
        try { file = await this.service.getFile(project.id, source.path); }
        catch { return fail("source-changed", "Saved source is no longer available for replay."); }
        if (createHash("sha256").update(file.source).digest("hex") !== source.revision)
          fail("source-changed", "Saved source changed during replay. Start a new observation.");
      }
      const dirty = this.dirtyPaths().filter(path => run.feature.paths.includes(path)).sort();
      if (JSON.stringify(dirty) !== JSON.stringify([...run.dirtyPaths].sort())) fail("source-changed", "Unsaved source context changed during replay.");
      if (task.controller.signal.aborted || this.disposed || this.project?.id !== project.id || this.runtime !== runtime ||
        this.scenarioCapture !== capture || capture.ending || this.featureSourceEpoch !== sourceEpoch || this.scenarioOwnershipReason(run, project.id))
        fail(task.reason || "context-changed", "The replay context changed before the next step.");
    };
    this.runtimeReplayTask = task; this.runtimeReplayError = undefined; this.sendState();
    task.done = (async () => {
      try {
        await guard();
        const live = await runtime.readCurrent(); await guard();
        const catalog = live.replayCatalog;
        const recipe = catalog?.recipes.find(item => item.id === message.recipeId && item.route === run.screen.route);
        if (!live.capabilities.scenarioReplay || live.replayBlocked || !recipe || catalog?.digest !== message.catalogDigest || catalog?.registrationId !== message.registrationId)
          fail("recipe-changed", "The app recipe is unavailable or changed. Review the current recipe before starting.");
        if (live.session !== run.runtime.session || live.viewId !== run.runtime.viewId || live.documentId !== run.runtime.documentId ||
          live.pagePath !== run.runtime.route || live.pageVersion !== run.runtime.pageVersion || !live.pageConnected)
          fail("runtime-changed", "The running document changed. Open the screen and begin a new observation.");
        const saved = await store.begin({ context: { projectId: project.id, runId: run.id, featureId: run.feature.id,
          screenId: run.screen.id, scenarioId: run.scenario.id, startedAt: run.startedAt, definitionRevision: run.definitionRevision,
          runtime: run.runtime, sources: run.sources, dirtyPaths: run.dirtyPaths }, executionId: task.executionId,
          recipe: { ...recipe!, registrationId: catalog!.registrationId, catalogDigest: catalog!.digest }, requested }, snapshot.revision);
        task.id = saved.id; await guard(); this.sendState();
        const result = await runtime.replay({ executionId: task.executionId, recipeId: recipe!.id, catalogDigest: catalog!.digest,
          registrationId: catalog!.registrationId, identity: { session: run.runtime.session, viewId: run.runtime.viewId,
            documentId: run.runtime.documentId, route: run.runtime.route, pageVersion: run.runtime.pageVersion }, requested }, {
          signal: task.controller.signal,
          onProgress: async update => {
            await guard();
            await store.update(saved.id, update);
            await guard(); this.sendState();
          },
        });
        if (result.status === "completed") await guard();
        const reasons = ["cancelled", "timeout", "runtime-changed", "recipe-changed", "step-failed", "storage-failed", "host-restarted", "host-disposed", "source-changed", "context-changed", "transport-failed", "preview-changed"];
        const aliases: Record<string, string> = { "callback-failed": "step-failed", "unit-timeout": "timeout", "lease-expired": "timeout",
          "registration-changed": "recipe-changed", "progress-unavailable": "storage-failed", "transport-unavailable": "transport-failed",
          "document-hidden": "preview-changed", "conditions-changed": "preview-changed", "replay-unavailable": "runtime-changed" };
        const reason = task.reason || (result.reason ? aliases[result.reason] || result.reason : undefined);
        await store.finish(saved.id, { status: task.controller.signal.aborted ? task.reason === "cancelled" ? "cancelled" : "interrupted" : result.status,
          ...(reason ? { reason: reasons.includes(reason) ? reason : "transport-failed" } : {}) } as any);
      } catch (error) {
        task.controller.abort();
        const record = store.snapshot().replays.find(item => item.executionId === task.executionId);
        if (record?.status === "running" && store.snapshot().storage.status === "saved") {
          await store.finish(record.id, { status: task.reason === "cancelled" ? "cancelled" : "interrupted",
            reason: (task.reason || "transport-failed") as any }).catch(() => {});
        }
        if (this.project?.id === project.id) this.runtimeReplayError = store.snapshot().storage.status === "error"
          ? "Replay stopped because its evidence could not be saved. Retry saving; no step will run again."
          : error instanceof Error ? error.message : "Replay stopped. Its effects have not been reversed.";
      } finally {
        if (this.runtimeReplayTask === task) this.runtimeReplayTask = undefined;
        this.sendState();
      }
    })();
    await task.done;
    return store.snapshot();
  }

  private runtimeCaptureStorage(project = this.project) {
    if (!project || !this.context.globalStorageUri?.fsPath) throw new Error("Local capture storage is unavailable.");
    this.runtimeCaptureStores ||= new Map();
    let entry = this.runtimeCaptureStores.get(project.id);
    if (!entry) {
      const files = createCaptureFileStorage({ root: this.context.globalStorageUri.fsPath, projectId: project.id });
      const store = createRuntimeCaptureStore({ projectId: project.id, ...files });
      entry = { files, store, images: new Set() };
      this.runtimeCaptureStores.set(project.id, entry);
    }
    return entry;
  }

  private runtimeCapturesSnapshot(_webview?: vscode.Webview): any {
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted) return null;
    try {
      const entry = this.runtimeCaptureStorage(project), snapshot = entry.store.snapshot();
      return { ...snapshot, available: this.nativeCaptureAvailable === true && snapshot.storage.status !== "unavailable",
        captures: snapshot.captures.map(capture => ({ ...capture, imageStatus: entry.images.has(capture.id) ? "loading" : "not-loaded" })) };
    } catch { return { schemaVersion: 1, projectId: project.id, revision: 0, available: false, captures: [], storage: { status: "unavailable", message: "Local capture storage could not be opened safely." } }; }
  }

  private async readRuntimeCaptureImage(message: any) {
    const project = this.project, panel = this.panel;
    if (!project || !panel || !vscode.workspace.isTrusted || message.projectId !== project.id || typeof message.id !== "string") return;
    const entry = this.runtimeCaptureStorage(project), capture = entry.store.snapshot().captures.find(item => item.id === message.id);
    if (!capture || entry.images.has(capture.id)) return;
    if (entry.images.size >= 2) {
      await panel.webview.postMessage({ type: "runtimeCaptureImage", projectId: project.id, id: capture.id, error: "Images are still loading. Select this observation again to retry." });
      return;
    }
    const current = () => !this.disposed && vscode.workspace.isTrusted && this.project?.id === project.id && this.panel === panel;
    entry.images.add(capture.id);
    try {
      const verified = await entry.store.readCapture(capture.id);
      // Deliver these exact verified bytes once, outside ordinary state updates.
      // A filesystem URI could load different bytes after the integrity check.
      if (current()) await panel.webview.postMessage({ type: "runtimeCaptureImage", projectId: project.id, id: capture.id,
        imageSha256: verified.capture.image.sha256, pngBase64: verified.png.toString("base64") });
    } catch {
      if (current()) await panel.webview.postMessage({ type: "runtimeCaptureImage", projectId: project.id, id: capture.id,
        error: "The saved image is missing or could not be verified." });
    } finally { entry.images.delete(capture.id); }
  }

  private async captureScenarioImage(capture: NonNullable<FoundationHost["scenarioCapture"]>, matrixOwner?: NonNullable<FoundationHost["runtimeMatrixTask"]>) {
    const project = this.project, runtime = this.runtime, panel = this.panel;
    if (!project || !runtime || !panel || !panel.visible || this.mode !== "Refine" || !this.nativeCaptureAvailable)
      throw new Error("Open the running preview in this Foundation build before capturing it.");
    const entry = this.runtimeCaptureStorage(project), run = capture.run, sourceEpoch = this.featureSourceEpoch;
    const expected = run.runtime;
    const current = () => !this.disposed && this.project?.id === project.id && this.runtime === runtime && this.panel === panel && panel.visible &&
      this.mode === "Refine" && this.featureSourceEpoch === sourceEpoch && this.scenarioCapture === capture && !capture.ending && !this.scenarioOwnershipReason(run, project.id) && (!matrixOwner || this.matrixOwnerCurrent(matrixOwner));
    const guard = () => { if (!current()) throw new Error("The observation or preview changed during capture. No new result was accepted."); };
    const validateSources = async () => {
      guard();
      for (const source of run.sources) {
        const file: ProjectFile = await this.service.getFile(project.id, source.path); guard();
        if (createHash("sha256").update(file.source).digest("hex") !== source.revision) throw new Error("Saved source changed during capture. Start a new observation.");
      }
      const dirty = this.dirtyPaths().filter(path => run.feature.paths.includes(path)).sort();
      if (JSON.stringify(dirty) !== JSON.stringify([...run.dirtyPaths].sort())) throw new Error("Unsaved source context changed during capture. Start a new observation.");
    };
    const validateRuntime = async () => {
      guard(); const fresh = await runtime.readCurrent(); guard();
      if (fresh.status !== "connected" || !fresh.pageConnected || fresh.session !== expected.session || fresh.viewId !== expected.viewId || fresh.documentId !== expected.documentId ||
        fresh.pagePath !== expected.route || fresh.pageVersion !== expected.pageVersion || fresh.target?.id !== expected.targetId)
        throw new Error("The running document changed during capture. Open the screen and start a new observation.");
    };
    await validateSources(); await validateRuntime();
    // Recovery never recaptures an already persisted point in time.
    const existing = entry.store.reconcile().captures.find(item => item.runId === run.id);
    if (existing) {
      await entry.store.readCapture(existing.id);
      await validateRuntime(); await validateSources(); guard();
      return existing;
    }
    const nonce = randomBytes(16).toString("hex"), identity = { session: expected.session, viewId: expected.viewId, documentId: expected.documentId, pageVersion: expected.pageVersion, route: expected.route, nonce };
    const result: any = await vscode.commands.executeCommand("_foundation.captureActiveCanvas", identity); guard();
    if (!result || !result.identity || Object.keys(result.identity).length !== Object.keys(identity).length || Object.entries(identity).some(([key, value]) => result.identity[key] !== value) || typeof result.pngBase64 !== "string" || result.pngBase64.length > 24 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(result.pngBase64) || typeof result.capturedAt !== "string") throw new Error("The native capture result could not be verified.");
    const png = Buffer.from(result.pngBase64, "base64");
    if (png.toString("base64") !== result.pngBase64) throw new Error("The native capture image could not be verified.");
    const conditions = result.conditions;
    if (!conditions || !["light", "dark"].includes(conditions.observedColorScheme) || typeof conditions.reducedMotion !== "boolean") throw new Error("The preview conditions could not be verified.");
    const image = inspectCapturePng(png);
    if (image.widthPx !== conditions.pixelWidth || image.heightPx !== conditions.pixelHeight) throw new Error("The captured pixel dimensions could not be verified.");
    await validateRuntime(); await validateSources(); guard();
    const saved = await entry.store.saveCapture({ context: { projectId: project.id, runId: run.id, featureId: run.feature.id, screenId: run.screen.id, scenarioId: run.scenario.id,
      startedAt: run.startedAt, definitionRevision: run.definitionRevision, runtime: { ...expected }, sources: run.sources, dirtyPaths: run.dirtyPaths },
      conditions: { viewportWidthCss: conditions.viewportWidth, viewportHeightCss: conditions.viewportHeight, deviceScaleFactor: conditions.devicePixelRatio,
        scrollXCss: conditions.scrollX, scrollYCss: conditions.scrollY, canvasScale: conditions.canvasScale,
        colorSchemePreference: conditions.observedColorScheme, reducedMotionPreference: conditions.reducedMotion ? "reduce" : "no-preference", appTheme: "unknown", dataState: "unknown", animationState: "unknown" }, png, capturedAt: result.capturedAt });
    // The immutable point-in-time image may survive an interruption, but a
    // late source/runtime change must not complete the manual observation.
    await validateRuntime(); await validateSources(); guard();
    return saved;
  }

  private runtimeWorkspaceStore(project = this.project) {
    if (!project) throw new Error("Open a project before managing runtime screens.");
    this.runtimeWorkspaceStores ||= new Map();
    let store = this.runtimeWorkspaceStores.get(project.id);
    if (!store) {
      const key = `foundation.runtime-workspaces.${project.id}`;
      store = createRuntimeWorkspaceStore({ projectId: project.id,
        read: () => this.context.workspaceState.get(key),
        write: value => this.context.workspaceState.update(key, value),
        onChange: () => this.queueConversationState(project.id),
      });
      this.runtimeWorkspaceStores.set(project.id, store);
    }
    return store;
  }

  private runtimeWorkspaceSnapshot(presentation = false) {
    if (!this.project || !vscode.workspace.isTrusted) {
      this.runtimeSourceHashCache = undefined;
      return null;
    }
    const store = this.runtimeWorkspaceStore();
    const snapshot = presentation && store.presentation ? store.presentation().snapshot : store.snapshot();
    const features = this.featureSnapshot();
    // Historical runs often share the same saved sources. Cache only their full
    // digest, never freshness or history: definitions, availability, storage and
    // live capture state are still assessed on every publication. Exact text is
    // required even if a stale or abbreviated revision token has not changed.
    const files = new Map<string, ProjectFile>();
    for (const file of [...(this.featureFiles || []), ...(this.openFiles || [])])
      if (!files.has(file.path)) files.set(file.path, file);
    const previous = this.runtimeSourceHashCache;
    const reusable = previous?.projectId === this.project.id && previous.root === this.project.root ? previous.entries : undefined;
    const entries = new Map<string, { source: string; digest: string }>();
    this.runtimeSourceHashCache = { projectId: this.project.id, root: this.project.root, entries };
    const digest = (path: string) => {
      const file = files.get(path);
      if (!file) return undefined;
      const cached = entries.get(path) || reusable?.get(path);
      const current = cached?.source === file.source ? cached : {
        source: file.source, digest: createHash("sha256").update(file.source).digest("hex"),
      };
      // Only the loaded sources needed by this snapshot remain retained. Removed
      // paths and former project content cannot accumulate across refreshes.
      entries.set(path, current);
      return current.digest;
    };
    const runFreshness = snapshot.runs.map((run: any) => {
      const feature = features?.features.find(item => item.id === run.feature.id && !item.archived);
      const screen = snapshot.screens.find(item => item.id === run.screen.id && !item.archived);
      const scenario = snapshot.scenarios.find(item => item.id === run.scenario.id && !item.archived);
      let status = "current", reason = "Saved source and definitions match. This remains a historical observation.";
      if (!feature || !screen || !scenario || JSON.stringify(screen) !== JSON.stringify(run.screen) || JSON.stringify(scenario) !== JSON.stringify(run.scenario) ||
        feature.title !== run.feature.title || JSON.stringify(feature.paths) !== JSON.stringify(run.feature.paths)) {
        status = "stale"; reason = "The feature, screen, or scenario definition changed after this observation.";
      } else if (run.sources.some((source: any) => (this.featureUnavailable || []).some(item => item.path === source.path && item.kind === "source-unavailable"))) {
        status = "unknown"; reason = "Recorded source is missing, excluded, or unavailable. Its current revision cannot be verified.";
      } else if (run.sources.some((source: any) => {
        const current = digest(source.path);
        return current !== undefined && current !== source.revision;
      })) { status = "stale"; reason = "Saved source changed after this observation."; }
      else if (run.sources.some((source: any) => !files.has(source.path))) {
        status = "unknown"; reason = "Some recorded source is not loaded. Its current revision has not been verified.";
      }
      return { id: run.id, status, reason };
    });
    const activeRun = snapshot.runs.find((run: any) => run.status === "recording") || null;
    const capture = this.scenarioCapture;
    return { ...snapshot, runFreshness, activeRun: activeRun && capture?.run.id === activeRun.id
      ? { ...activeRun, observations: capture.observations, truncated: capture.truncated } : activeRun,
      busy: this.runtimeWorkspaceBusy, error: this.runtimeWorkspaceError };
  }

  private scenarioOwnershipReason(run: any, projectId: string) {
    if (this.disposed || !vscode.workspace.isTrusted || this.project?.id !== projectId)
      return "The trusted project changed during this observation.";
    const featureState = this.featureSnapshot();
    const feature = featureState?.features.find(item => item.id === run.feature.id && !item.archived);
    if (!feature || featureState?.activeId !== feature.id || featureState.revision !== run.feature.revision)
      return "The feature workspace changed during this observation.";
    const definitions = this.runtimeWorkspaceStore().snapshot();
    const screen = definitions.screens.find(item => item.id === run.screen.id && !item.archived);
    const scenario = definitions.scenarios.find(item => item.id === run.scenario.id && !item.archived);
    if (!screen || !scenario || JSON.stringify(screen) !== JSON.stringify(run.screen) || JSON.stringify(scenario) !== JSON.stringify(run.scenario))
      return "The screen or scenario changed during this observation.";
    return this.validateScenarioRuntime(run.runtime);
  }

  private validateScenarioRuntime(expected: any) {
    const runtime = this.runtimeSnapshot();
    if (runtime.status !== "connected" || !runtime.pageConnected)
      return "The runtime page disconnected. Open the screen and start a new observation.";
    if (runtime.target?.id !== expected.targetId || runtime.session !== expected.session || runtime.viewId !== expected.viewId)
      return "The runtime connection changed. Start a new observation in its current view.";
    if (!runtime.documentId || runtime.documentId !== expected.documentId)
      return "The runtime document reloaded. Start a new observation.";
    if (!runtime.pagePath || runtime.pagePath !== expected.route || runtime.pageVersion !== expected.pageVersion)
      return "The runtime navigated during this observation. Open the saved screen and start a new observation.";
    return undefined;
  }

  private async reconcileScenarioRun(observed?: RuntimeSnapshot) {
    const capture = this.scenarioCapture;
    if (!capture || capture.ending || capture.store.snapshot().storage.status !== "saved") return;
    const reason = this.scenarioOwnershipReason(capture.run, capture.projectId);
    if (reason) { await this.endScenarioRun("interrupted", "not-assessed", "", reason); return; }
    if (capture.run.sources.some((source: any) => (this.featureUnavailable || []).some(item => item.path === source.path && item.kind === "source-unavailable"))) {
      await this.endScenarioRun("interrupted", "not-assessed", "", "Recorded source is no longer available."); return;
    }
    const runtime = observed || this.runtimeSnapshot();
    if (observed && (runtime.status !== "connected" || !runtime.pageConnected || runtime.target?.id !== capture.run.runtime.targetId ||
      runtime.session !== capture.run.runtime.session || runtime.viewId !== capture.run.runtime.viewId || runtime.documentId !== capture.run.runtime.documentId ||
      runtime.pagePath !== capture.run.runtime.route || runtime.pageVersion !== capture.run.runtime.pageVersion)) {
      await this.endScenarioRun("interrupted", "not-assessed", "", "The authenticated request snapshot belongs to a changed runtime document."); return;
    }
    // Only the exact owning view can contribute. Previously seen request IDs
    // exclude the pre-run timeline; polling never attributes a request to a step.
    const unseen = runtime.observations.filter(item => !capture.seen.has(item.id));
    if (unseen.length >= 100) capture.truncated = true; // A full server buffer may have lost earlier completions.
    for (const observation of runtime.observations) {
      if (capture.seen.has(observation.id)) continue;
      capture.seen.add(observation.id);
      const observedAt = observation.observedAt ? Date.parse(observation.observedAt) : NaN;
      if (observation.session !== capture.run.runtime.session || observation.documentId !== capture.run.runtime.documentId ||
        !observation.id.startsWith(`${capture.run.runtime.session}:${capture.run.runtime.viewId}:`) ||
        !Number.isFinite(observedAt) || observedAt < Date.parse(capture.run.startedAt) || observedAt > Date.now()) continue;
      if (capture.observations.length >= 100) { capture.truncated = true; continue; }
      capture.observations.push({ ...observation });
    }
    if (capture.seen.size > 500) capture.seen = new Set(runtime.observations.map(item => item.id));
    const files = [...(this.featureFiles || []), ...(this.openFiles || [])];
    if (capture.run.sources.some((source: any) => {
      const file = files.find(item => item.path === source.path);
      return file && createHash("sha256").update(file.source).digest("hex") !== source.revision;
    })) await this.endScenarioRun("interrupted", "not-assessed", "", "Saved source changed during this observation.");
  }

  private async endScenarioRun(status: "completed" | "cancelled" | "interrupted", assessment: "not-assessed" | "matched" | "not-matched" = "not-assessed", note = "", interruption?: string) {
    const capture = this.scenarioCapture;
    if (!capture) return;
    if (status !== "completed" && this.runtimeMatrixTask?.runId === capture.run.id) this.interruptRuntimeMatrix(status === "cancelled" ? "cancelled" : "context-changed");
    if (this.runtimeReplayTask?.runId === capture.run.id) await this.stopRuntimeReplay(status === "cancelled" ? "cancelled" : "context-changed");
    if (capture.ending) return capture.ending;
    capture.ending = (async () => {
      try {
        await capture.store.finishRun(capture.run.id, { status, assessment, note,
          ...(interruption ? { interruption } : {}), observations: capture.observations, truncated: capture.truncated });
      } catch (error) {
        this.runtimeWorkspaceError = error instanceof Error ? error.message : "The observation could not be saved. Retry its local storage.";
        throw error;
      } finally {
        if (this.scenarioCapture === capture) {
          // Failed validation leaves the run open; preserve its capture for a
          // corrected finish. A failed disk write already holds the final record
          // in the store and is recovered by Retry without duplicating the run.
          if (capture.store.snapshot().runs.some((run: any) => run.id === capture.run.id && run.status === "recording")) capture.ending = undefined;
          else this.scenarioCapture = undefined;
        }
        this.sendState();
      }
    })();
    return capture.ending;
  }

  private async runtimeWorkspaceAction(message: any, matrixOwner?: NonNullable<FoundationHost["runtimeMatrixTask"]>) {
    if (this.alternativesBusy()) throw new Error("Stop the comparison before starting another source or runtime action.");
    if (this.runtimeMatrixRecovery || this.runtimeMatrixTask && (!matrixOwner || !this.matrixOwnerCurrent(matrixOwner))) throw new Error("Stop the condition matrix before changing its observation workspace.");
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted || message.projectId !== project.id)
      throw new Error("Choose a runtime screen in the current trusted project.");
    if (this.runtimeWorkspaceBusy) throw new Error("Wait for the current screen action to finish.");
    if (this.runtimeReplayTask && message.action !== "cancelRun") throw new Error("Stop the active replay before finishing or changing this observation.");
    if (["finishRun", "captureAndFinishRun"].includes(message.action) && this.runtimeReplayStores?.get(project.id)?.snapshot().replays.some(item => item.runId === message.id && item.status === "running"))
      throw new Error("Retry saving the interrupted replay before finishing this observation.");
    const store = this.runtimeWorkspaceStore(project), snapshot = store.snapshot();
    if (message.action !== "retry" && message.expectedRevision !== snapshot.revision)
      throw new Error("The runtime workspace changed. Review its latest saved version before trying again.");
    const featureState = this.featureSnapshot();
    const feature = featureState?.features.find(item => item.id === featureState.activeId && !item.archived);
    if (!feature && message.action !== "retry") throw new Error("Select a saved feature before managing its runtime screens.");
    const getScreen = (id: unknown) => {
      const screen = snapshot.screens.find(item => item.id === id && item.featureId === feature?.id);
      if (!screen) throw new Error("Choose a screen belonging to the selected feature.");
      return screen;
    };
    const getScenario = (id: unknown) => {
      const scenario = snapshot.scenarios.find(item => item.id === id);
      if (!scenario) throw new Error("Choose an available scenario.");
      getScreen(scenario.screenId); return scenario;
    };
    const stillCurrent = () => !this.disposed && vscode.workspace.isTrusted && this.project?.id === project.id &&
      this.featureSnapshot()?.revision === featureState?.revision && this.featureSnapshot()?.activeId === feature?.id && (!matrixOwner || this.matrixOwnerCurrent(matrixOwner));
    if (this.scenarioCapture && !["finishRun", "captureAndFinishRun", "cancelRun", "retry"].includes(message.action))
      throw new Error("Finish or cancel the current observation before changing its screen or scenario.");
    if (snapshot.storage.status !== "saved" && message.action !== "retry")
      throw new Error("Save or retry the local runtime workspace before continuing.");
    this.runtimeWorkspaceBusy = message.action;
    this.runtimeWorkspaceError = undefined;
    this.sendState();
    try {
      if (message.action === "retry") {
        await store.retry();
        const orphan = store.snapshot().runs.find((run: any) => run.status === "recording" && run.id !== this.scenarioCapture?.run.id);
        if (orphan) await store.finishRun(orphan.id, { status: "interrupted", assessment: "not-assessed", note: "",
          interruption: "The initial observation could not be saved. Start a new observation.", observations: [], truncated: false });
        await this.reconcileScenarioRun();
        return store.snapshot();
      }
      if (message.action === "createScreen" || message.action === "updateScreen") {
        const previous = message.action === "updateScreen" ? getScreen(message.id) : undefined;
        const targetId = message.input?.targetId ?? previous?.targetId;
        if (message.input?.featureId !== undefined && message.input.featureId !== feature!.id)
          throw new Error("A screen cannot move to another feature.");
        if (!previous || targetId !== previous.targetId) {
          const runtime = await this.ensureRuntime();
          const targets = await runtime.discover();
          if (!stillCurrent()) throw new Error("The feature changed while targets were being discovered.");
          if (!targets.some(target => target.id === targetId) && !(targetId === "external" && runtime.snapshot().target?.id === "external"))
            throw new Error("Choose a discovered target or the explicitly connected server.");
        }
        if (message.action === "createScreen") await store.createScreen({ ...message.input, featureId: feature!.id }, snapshot.revision);
        else await store.updateScreen(previous!.id, message.input, snapshot.revision);
      } else if (message.action === "archiveScreen") {
        await store.archiveScreen(getScreen(message.id).id, message.archived, snapshot.revision);
      } else if (message.action === "createScenario") {
        const screen = getScreen(message.input?.screenId);
        if (screen.archived) throw new Error("Restore this screen before adding a scenario.");
        await store.createScenario(message.input, snapshot.revision);
      } else if (message.action === "updateScenario") {
        const scenario = getScenario(message.id);
        if (message.input?.screenId !== undefined && message.input.screenId !== scenario.screenId)
          throw new Error("A scenario cannot move to another screen.");
        await store.updateScenario(scenario.id, message.input, snapshot.revision);
      } else if (message.action === "archiveScenario") {
        await store.archiveScenario(getScenario(message.id).id, message.archived, snapshot.revision);
      } else if (message.action === "select") {
        if (message.screenId !== null) getScreen(message.screenId);
        if (message.scenarioId !== null && getScenario(message.scenarioId).screenId !== message.screenId)
          throw new Error("Choose a scenario belonging to this screen.");
        await store.select(message.screenId, message.scenarioId, snapshot.revision);
      } else if (message.action === "openScreen") {
        const screen = getScreen(message.screenId);
        if (screen.archived) throw new Error("Restore this screen before opening it.");
        const route = safeScreenRoute(screen.route);
        const runtime = await this.ensureRuntime();
        if (!stillCurrent() || store.snapshot().revision !== snapshot.revision) throw new Error("The screen changed before it could open.");
        let state = runtime.snapshot();
        if (state.status !== "connected" || state.target?.id !== screen.targetId) {
          if (screen.targetId === "external") throw new Error("Connect this project's instrumented server, then open the screen.");
          // Explicit Open screen is the only definition action that may start a
          // development target. Metadata selection alone never runs project code.
          state = await runtime.start(screen.targetId);
        }
        if (!stillCurrent() || this.runtime !== runtime || store.snapshot().revision !== snapshot.revision || state.status !== "connected")
          throw new Error("The screen or runtime changed before navigation. Open the screen again.");
        await runtime.navigate(route);
        if (!stillCurrent() || this.runtime !== runtime || store.snapshot().revision !== snapshot.revision) return;
        await store.select(screen.id, snapshot.activeScreenId === screen.id ? snapshot.activeScenarioId : null, snapshot.revision);
        this.show("Refine");
        await this.runtimeChanged(this.runtimeGeneration);
        void this.panel?.webview.postMessage({ type: "runtimeScreenOpened", screenId: screen.id });
      } else if (message.action === "beginRun") {
        const scenario = getScenario(message.scenarioId), screen = getScreen(scenario.screenId);
        if (snapshot.activeScreenId !== screen.id || snapshot.activeScenarioId !== scenario.id)
          throw new Error("Select this screen and scenario before beginning its observation.");
        if (screen.archived || scenario.archived) throw new Error("Restore this screen and scenario before observing it.");
        const runtime = this.runtimeSnapshot();
        if (runtime.target?.id !== screen.targetId || runtime.status !== "connected" || !runtime.pageConnected ||
          runtime.pagePath !== screen.route || !runtime.documentId || !runtime.session || !runtime.viewId ||
          !Number.isSafeInteger(runtime.pageVersion) || runtime.pageVersion! < 1)
          throw new Error("Open the screen and wait for its observed route and document to connect before starting an observation.");
        if (!feature!.paths.length) throw new Error("Add saved source files to this feature before observing it.");
        const identity = { targetId: screen.targetId, session: runtime.session, viewId: runtime.viewId, documentId: runtime.documentId, route: screen.route, pageVersion: runtime.pageVersion! };
        const sources: { path: string; revision: string }[] = [];
        for (const path of feature!.paths) {
          const file: ProjectFile = await this.service.getFile(project.id, path);
          if (!stillCurrent() || store.snapshot().revision !== snapshot.revision || this.validateScenarioRuntime(identity))
            throw new Error("The feature, screen, or runtime changed while source was being captured.");
          sources.push({ path, revision: createHash("sha256").update(file.source).digest("hex") });
        }
        for (const source of sources) {
          if (!stillCurrent() || store.snapshot().revision !== snapshot.revision || this.validateScenarioRuntime(identity))
            throw new Error("The feature, screen, or runtime changed during source validation.");
          const file: ProjectFile = await this.service.getFile(project.id, source.path);
          if (createHash("sha256").update(file.source).digest("hex") !== source.revision)
            throw new Error("Saved source changed while starting the observation. Try again.");
        }
        if (!stillCurrent() || store.snapshot().revision !== snapshot.revision || this.validateScenarioRuntime(identity))
          throw new Error("The feature, screen, or runtime changed before the observation started.");
        const before = this.runtimeSnapshot();
        const next = await store.beginRun({ feature: { id: feature!.id, title: feature!.title, revision: featureState!.revision, paths: [...feature!.paths] },
          screen, scenario, definitionRevision: snapshot.revision, runtime: identity, sources,
          dirtyPaths: this.dirtyPaths().filter(path => feature!.paths.includes(path)).sort() }, snapshot.revision, matrixOwner ? {id:matrixOwner.runId!} : undefined);
        const run = next.runs.find((item: any) => item.status === "recording");
        if (!run) throw new Error("The observation could not start. Review local storage and try again.");
        this.scenarioCapture = { projectId: project.id, store, run, seen: new Set(before.observations.map(item => item.id)), observations: [], truncated: false };
        await this.reconcileScenarioRun();
        if (this.scenarioCapture?.run.id !== run.id) return store.snapshot();
        // Persistence is an await boundary too: source can change while the
        // initial record is written, before a watcher refresh reaches the cache.
        for (const source of sources) {
          await this.reconcileScenarioRun();
          if (this.scenarioCapture?.run.id !== run.id) break;
          let current: ProjectFile | undefined;
          try { current = await this.service.getFile(project.id, source.path); } catch { /* Record interruption below. */ }
          if (!current || createHash("sha256").update(current.source).digest("hex") !== source.revision) {
            await this.endScenarioRun("interrupted", "not-assessed", "", "Saved source changed while the observation was starting.");
            break;
          }
          if (this.scenarioCapture?.run.id !== run.id) break;
        }
        await this.reconcileScenarioRun();
        if (matrixOwner && !this.matrixOwnerCurrent(matrixOwner)) {
          if (this.scenarioCapture?.run.id === run.id) await this.endScenarioRun("interrupted", "not-assessed", "", "The matrix stopped while this observation was being saved.");
          return store.snapshot();
        }
        if (this.scenarioCapture?.run.id === run.id) {
          // Starting an observation must not create a second document in an
          // externally observed view after its canvas was deliberately closed.
          if (this.panel) this.show("Refine");
          void this.panel?.webview.postMessage({ type: "scenarioStarted", runId: run.id });
        }
      } else if (message.action === "finishRun" || message.action === "captureAndFinishRun" || message.action === "cancelRun") {
        const capture = this.scenarioCapture;
        if (!capture || capture.run.id !== message.id || capture.projectId !== project.id || capture.run.feature.id !== feature!.id)
          throw new Error("Choose the current manual observation.");
        if (message.action === "cancelRun") { await this.endScenarioRun("cancelled"); return store.snapshot(); }
        if (!["not-assessed", "matched", "not-matched"].includes(message.assessment) || typeof message.note !== "string" || message.note.length > 2000)
          throw new Error("Choose an assessment and use a note of up to 2,000 characters.");
        await this.reconcileScenarioRun();
        if (this.scenarioCapture !== capture) return store.snapshot();
        for (const source of capture.run.sources) {
          await this.reconcileScenarioRun();
          if (this.scenarioCapture !== capture) return store.snapshot();
          let file: ProjectFile;
          try { file = await this.service.getFile(project.id, source.path); }
          catch { await this.endScenarioRun("interrupted", "not-assessed", "", "Recorded source is no longer available."); return store.snapshot(); }
          if (this.scenarioCapture !== capture) return store.snapshot();
          if (createHash("sha256").update(file.source).digest("hex") !== source.revision) {
            await this.endScenarioRun("interrupted", "not-assessed", "", "Saved source changed during this observation."); return store.snapshot();
          }
        }
        await this.reconcileScenarioRun();
        if (this.scenarioCapture === capture && message.action === "captureAndFinishRun") await this.captureScenarioImage(capture);
        if (matrixOwner && !this.matrixOwnerCurrent(matrixOwner)) throw new Error("The condition matrix stopped before this observation could finish.");
        if (this.scenarioCapture === capture) await this.endScenarioRun("completed", message.assessment, message.note);
      } else throw new Error("Choose an available runtime workspace action.");
      return store.snapshot();
    } catch (error) {
      if (this.project?.id === project.id) this.runtimeWorkspaceError = error instanceof Error ? error.message : "The runtime workspace action failed.";
      throw error;
    } finally {
      this.runtimeWorkspaceBusy = undefined;
      this.sendState();
    }
  }

  private resolveTaskContext(input: any) {
    if (input === undefined) return undefined;
    const snapshot = this.featureSnapshot();
    if (!snapshot || snapshot.storage.status !== "saved" || input?.revision !== snapshot.revision || input?.featureId !== snapshot.activeId)
      throw new Error("The task brief changed. Review the saved feature before sending.");
    const feature = snapshot.features.find(item => item.id === input.featureId && !item.archived);
    if (!feature) throw new Error("Choose a current saved feature.");
    return normalizeTaskContext({ version: 1, featureId: feature.id, title: feature.title, brief: feature.brief, revision: snapshot.revision });
  }

  private conversations(project = this.project) {
    if (!project) throw new Error("Open a project before viewing conversations.");
    // The map belongs to the native host, never the webview. Each project has
    // its own durable envelope; opening a saved chat cannot dispatch a request.
    this.conversationStores ||= new Map();
    let store = this.conversationStores.get(project.id);
    if (!store) {
      const key = `foundation.conversations.${project.id}`;
      store = createConversationStore({
        projectId: project.id,
        read: () => this.context.workspaceState.get(key),
        write: (value: any) => this.context.workspaceState.update(key, value),
        onChange: () => this.queueConversationState(project.id),
      });
      this.conversationStores.set(project.id, store);
    }
    return store;
  }

  private queueConversationState(projectId: string) {
    if (this.disposed || this.project?.id !== projectId || this.conversationStateTimer) return;
    // Stream deltas already have their own bounded snapshot cadence. Persistence
    // notifications are coalesced too, so one token does not serialize all history.
    this.conversationStateTimer = setTimeout(() => {
      this.conversationStateTimer = undefined;
      if (!this.disposed && this.project?.id === projectId) this.sendState();
    }, 100);
  }

  private currentArtifactSourceOwner() {
    const owner = this.artifactSourceOwner;
    return owner && !this.disposed && vscode.workspace.isTrusted && this.project?.id === owner.projectId && this.project.root === owner.root &&
      this.conversationPresentation().snapshot.activeId === owner.conversationId && owner.epoch === (this.featureSourceEpoch || 0) ? owner : undefined;
  }

  private currentArtifactSourceFiles() {
    return this.currentArtifactSourceOwner() ? this.artifactSourceFiles || [] : [];
  }

  private resolveArtifactOwner(message: any) {
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted || this.disposed || message.projectId !== project.id)
      throw new Error("Choose an artifact in the current trusted project.");
    const store = this.conversations(project), snapshot = store.snapshot();
    const conversation = snapshot.conversations.find(item => item.id === message.conversationId && item.id === snapshot.activeId);
    const turn = conversation?.turns.find(item => item.requestId === message.requestId);
    if (!turn || typeof message.artifactId !== "string") throw new Error("Choose an artifact from the active conversation.");
    const artifact = turn.plan?.id === message.artifactId ? turn.plan : turn.review?.id === message.artifactId ? turn.review : undefined;
    if (!conversation || !turn || !artifact || turn.state !== "complete" || snapshot.storage.status !== "saved")
      throw new Error("Choose a completed, saved artifact in the active conversation.");
    const revision = turn.plan ? turn.planRevisions?.at(-1) : undefined;
    return {project, store, conversation, turn, artifact, revision};
  }

  private artifactOwnerCurrent(owner: ReturnType<FoundationHost["resolveArtifactOwner"]>, expectedRevision?: number) {
    if (this.disposed || !vscode.workspace.isTrusted || this.project?.id !== owner.project.id || this.project.root !== owner.project.root) return false;
    const snapshot = owner.store.snapshot(), conversation = snapshot.conversations.find(item => item.id === snapshot.activeId && item.id === owner.conversation.id);
    const turn = conversation?.turns.find(item => item.requestId === owner.turn.requestId);
    return snapshot.storage.status === "saved" && conversation?.archived === owner.conversation.archived && turn?.state === "complete" &&
      (turn.plan?.id === owner.artifact.id || turn.review?.id === owner.artifact.id) &&
      (expectedRevision === undefined || turn.planRevisions?.at(-1)?.revision === expectedRevision);
  }

  private async readArtifactSources(owner: ReturnType<FoundationHost["resolveArtifactOwner"]>, isCurrent: () => boolean, requireFresh = false) {
    const files: ProjectFile[] = [], unavailable: string[] = [];
    let bytes = 0;
    for (const source of owner.turn.context) {
      if (!isCurrent()) throw new Error("This artifact action was superseded. Try again in the current conversation.");
      let file: ProjectFile | undefined;
      try { file = await this.service.getFile(owner.project.id, source.path); } catch { unavailable.push(source.path); }
      if (!isCurrent()) throw new Error("This artifact action was superseded. Try again in the current conversation.");
      if (file) {
        bytes += Buffer.byteLength(file.source, "utf8");
        if (bytes > 65536) throw new Error("The artifact source now exceeds 64 KiB. Create a new plan with a smaller context.");
        files.push(file);
      }
      if (requireFresh && (!file || file.revision !== source.revision || this.dirtyPaths().includes(source.path)))
        throw new Error("This artifact uses earlier saved source. Resolve affected drafts and create a fresh plan or review before continuing.");
    }
    if (!isCurrent()) throw new Error("This artifact action was superseded. Try again in the current conversation.");
    if (requireFresh && this.dirtyPaths().some(path => owner.turn.context.some(source => source.path === path)))
      throw new Error("An artifact source became unsaved during validation. Resolve the affected draft before continuing.");
    return {files, unavailable};
  }

  private resolvePlanContext(input: any) {
    if (input === undefined) return undefined;
    if (!input || input.version !== 1 || !Number.isSafeInteger(input.revision) || input.revision < 0)
      throw new Error("Choose a saved plan step before preparing Build.");
    const owner = this.resolveArtifactOwner({...input, projectId: this.project?.id});
    if (!owner.turn.plan || !owner.revision || owner.conversation.archived || owner.turn.completedWhileStopping || owner.revision.revision !== input.revision)
      throw new Error("The selected plan changed. Prepare Build again from its saved revision.");
    const step = owner.revision.steps.find((item: any) => item.id === input.stepId && item.included);
    const original = owner.turn.plan.steps.find((item: any) => item.id === input.stepId);
    const paths = new Set(original?.references.map((item: any) => item.path));
    if (!step || !original || paths.size !== 1)
      throw new Error("Build currently prepares one existing file. Choose an included step with evidence in one file.");
    return {owner, path: [...paths][0] as string, snapshot: {version: 1 as const, conversationId: owner.conversation.id, requestId: owner.turn.requestId,
      artifactId: owner.artifact.id, revision: owner.revision.revision, stepId: step.id,
      title: owner.revision.title, summary: owner.revision.summary,
      step: {title: step.title, detail: step.detail, references: original.references.map((item: any) => ({...item}))},
      verification: [...owner.revision.verification]}};
  }

  private async planAction(message: any) {
    const view = this.assistantView, project = this.project;
    if (!view || !project) return;
    const generation = this.planActionGeneration = (this.planActionGeneration || 0) + 1;
    let passed = false, error: string | undefined;
    try {
      if (this.projectDecisionBusy) throw new Error("Finish saving the project decision before sending.");
    if (this.asking) throw new Error("Stop the current response before changing its plan context.");
      const owner = this.resolveArtifactOwner(message);
      if (!['revise', 'checkSources', 'prepareBuild', 'navigate'].includes(message.action)) throw new Error("Choose an available artifact action.");
      const epoch = this.featureSourceEpoch || 0, focus = this.focusGeneration || 0;
      const expectedRevision = owner.turn.plan ? message.expectedRevision : undefined;
      if (owner.turn.plan && expectedRevision !== owner.revision?.revision) throw new Error("The plan changed. Reload its saved revision before continuing.");
      const current = () => generation === this.planActionGeneration && this.assistantView === view && !this.asking &&
        epoch === (this.featureSourceEpoch || 0) && (message.action !== "navigate" || focus === (this.focusGeneration || 0)) && this.artifactOwnerCurrent(owner, expectedRevision);
      if (message.action === 'revise') {
        if (!owner.turn.plan || owner.conversation.archived) throw new Error("Restore this conversation before editing its plan.");
        await owner.store.revisePlan({conversationId: owner.conversation.id, requestId: owner.turn.requestId, expectedRevision, input: message.input});
      } else {
        if (message.action === 'prepareBuild' && (owner.conversation.archived || !owner.turn.plan)) throw new Error("Choose a plan in an active conversation.");
        const binding = message.action === 'prepareBuild' ? this.resolvePlanContext({version: 1, conversationId: owner.conversation.id,
          requestId: owner.turn.requestId, artifactId: owner.artifact.id, revision: expectedRevision, stepId: message.stepId}) : undefined;
        // Register every contributing path before asynchronous reads so saved
        // edits in closed source files also invalidate this action.
        this.artifactSourceFiles = []; this.artifactSourceUnavailable = [];
        this.artifactSourceOwner = {projectId: project.id, root: project.root, conversationId: owner.conversation.id, paths: owner.turn.context.map(item => item.path), epoch};
        const result = await this.readArtifactSources(owner, current, message.action !== 'checkSources');
        if (!current()) return;
        this.artifactSourceFiles = result.files; this.artifactSourceUnavailable = result.unavailable;
        this.artifactSourceOwner = {projectId: project.id, root: project.root, conversationId: owner.conversation.id,
          paths: owner.turn.context.map(item => item.path), epoch};
        if (binding) {
          const file = result.files.find(item => item.path === binding.path)!;
          if (typeof message.prepareId !== 'string' || message.prepareId.length > 128) throw new Error("Prepare this step again from its plan.");
          void view.webview.postMessage({type: 'preparePlanBuild', prepareId: message.prepareId, projectId: project.id,
            conversationId: owner.conversation.id, planContext: {version: 1, conversationId: owner.conversation.id, requestId: owner.turn.requestId,
              artifactId: owner.artifact.id, revision: expectedRevision, stepId: message.stepId}, file});
        } else if (message.action === 'navigate') {
          const item = owner.turn.plan ? owner.turn.plan.steps.find((item: any) => item.id === message.stepId) : owner.turn.review?.findings.find((item: any) => item.id === message.findingId);
          const ref = Number.isSafeInteger(message.referenceIndex) && message.referenceIndex >= 0 ? item?.references[message.referenceIndex] : undefined;
          const file = ref && result.files.find(item => item.path === ref.path);
          if (!ref || !file) throw new Error("Choose a reference from this artifact.");
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(project.root, ref.path)));
          if (!current() || focus !== (this.focusGeneration || 0)) return;
          if (document.isDirty || this.dirtyPaths().some(path => owner.turn.context.some(source => source.path === path)) ||
            createHash("sha256").update(document.getText()).digest("hex").slice(0, 16) !== ref.revision)
            throw new Error("Source changed before its evidence could be opened. Check the current source again.");
          const line = ref.line - 1;
          if (line < 0 || line >= document.lineCount) throw new Error("This source reference is unavailable.");
          const range = new vscode.Range(line, 0, line, 0);
          await vscode.window.showTextDocument(document, {viewColumn: this.sourceColumn(), preserveFocus: false, selection: range});
        }
      }
      passed = true;
    } catch (caught) { error = caught instanceof Error ? caught.message : "This artifact action could not complete."; }
    finally {
      if (generation === this.planActionGeneration && this.assistantView === view && this.project?.id === project.id && vscode.workspace.isTrusted && !this.disposed &&
        this.conversations().snapshot().activeId === message.conversationId) {
        this.sendState();
        void view.webview.postMessage({type: 'planActionResult', action: message.action, projectId: project.id, conversationId: message.conversationId,
          requestId: message.requestId, artifactId: message.artifactId, ...(message.prepareId ? {prepareId: message.prepareId} : {}), passed, ...(error ? {error} : {})});
      }
    }
  }

  private async conversationAction(message: any) {
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted || message.projectId !== project.id)
      throw new Error("Choose a conversation in the current trusted project.");
    if (this.asking && message.action !== "retry")
      throw new Error("Stop the current response before switching conversations.");
    const store = this.conversations(project);
    if (message.action === "new") await store.newConversation();
    else if (message.action === "retry") await store.retry();
    else if (typeof message.id === "string" && message.action === "select") await store.select(message.id);
    else if (typeof message.id === "string" && message.action === "archive") await store.archive(message.id);
    else if (typeof message.id === "string" && message.action === "restore") await store.archive(message.id, false);
    else throw new Error("Choose an available conversation action.");
    if (this.project?.id === project.id) this.sendState();
  }

  private async recordConversationVerification() {
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted) return;
    const proposal = this.proposals().current();
    const design = this.design;
    if (!proposal || proposal.status !== "applied" || design.stale ||
      !design.session || !design.revision || !["passed", "failed"].includes(design.compilation) ||
      !design.files?.some((file: any) => file.path === proposal.path && file.revision === proposal.appliedRevision)) return;
    // This records historical compilation/render evidence only. It can never
    // restore a live session or turn unexecuted interaction/visual checks green.
    try {
      const recorded = await this.conversations(project).recordVerification(proposal.id, {
        revision: proposal.appliedRevision,
        previewRevision: design.revision, runtimeSession: design.session,
        recordedAt: new Date().toISOString(), compilation: design.compilation,
        interaction: "not-run", visual: "not-run", observed: design.observed === true,
      });
      if (recorded) this.conversationHistoryWarnings?.delete(`${project.id}:verification`);
    } catch (error) { this.warnConversationHistory(project.id, "verification", error); }
  }

  private warnConversationHistory(projectId: string, kind: "checkpoint" | "verification", error: unknown) {
    if (this.disposed || this.project?.id !== projectId) return;
    this.conversationHistoryWarnings ||= new Set();
    const warningKey = `${projectId}:${kind}`;
    if (this.conversationHistoryWarnings.has(warningKey)) return;
    this.conversationHistoryWarnings.add(warningKey);
    // Capacity failures leave the previous snapshot saved, so storage.status
    // alone cannot communicate that this new history entry was not recorded.
    // Keep adapter/provider error details out of the notification.
    const full = typeof error === "object" && error !== null && "code" in error && error.code === "history-capacity";
    const message = `${full ? "Conversation history is full." : "Conversation history could not be updated."} ${kind === "checkpoint"
      ? "The review checkpoint was saved, but its latest state could not be recorded in conversation history."
      : "The preview result is still available, but this verification result could not be recorded in conversation history."} Existing history is preserved.`;
    // A native warning survives source refresh and is also visible when the
    // conversation pane is closed. It does not change the operation's outcome.
    void vscode.window.showWarningMessage(message);
  }

  private proposals() {
    // Capture identity independently of subsequent project snapshot updates.
    const project = this.project ? {...this.project} : null;
    if (!project) throw new Error("Open a project before reviewing changes.");
    let session = this.proposalSessions.get(project.id);
    if (!session) {
      const key = `foundation.proposal.${project.id}`;
      const checkProject = () => {
        if (this.disposed || !vscode.workspace.isTrusted || this.project?.id !== project.id || this.project?.root !== project.root)
          throw new Error("The trusted workspace changed. Reopen this project's proposal before applying it.");
      };
      session = createProposalSession({
        getFile: (id: string, path: string) => { checkProject(); return this.service.getFile(id, path); },
        save: (change: any) => {
          checkProject();
          const affected = new Set([change.path, ...(change.expectedContext || []).map((item: any) => item.path)]);
          if (this.dirtyPaths().some(path => affected.has(path))) throw new Error("A source used by this proposal has unsaved changes. Save or discard the affected draft before applying.");
          const guard = async (writeContext:any = {}) => {
            checkProject();
            if(change.alternativeBasis){
              const current=this.proposals().current();
              if(!current || current.path!==change.path || current.after!==change.source || current.baseRevision!==change.baseRevision ||
                visualVerificationDigest(current.alternativeBasis)!==visualVerificationDigest(change.alternativeBasis))throw new Error("The reviewed alternative changed before Apply.");
              // Apply already checked the full retained baseline. Recheck it at
              // the final atomic-write boundary, including only the writer's
              // pinned temporary file; earlier guards retain cheap ownership.
              if(writeContext.originalWriteTemporary)await this.validateAlternativeForProposal(current,project,writeContext.originalWriteTemporary);
              checkProject();
            }
            if (this.dirtyPaths().some(path => affected.has(path))) throw new Error("A source used by this proposal has unsaved changes. Its draft is preserved.");
            if (change.designImpact && !await this.validateDesignImpactForProposal(change.designImpact, "apply", project))
              throw Object.assign(new Error("Saved change impact changed. Inspect it again before applying."), {code: "context-conflict"});
            checkProject();
            if (this.dirtyPaths().some(path => affected.has(path))) throw new Error("A source used by this proposal changed while preparing Apply. Its draft is preserved.");
          };
          return change.designImpact ? this.service.save(change, {guard}) : this.service.save(change);
        },
        validateImpact: (checkpoint: any, options: {phase: "assess" | "apply"}) => this.validateDesignImpactForProposal(checkpoint, options.phase, project),
        validateAlternative: (_basis:any, options:{phase:"apply";proposal:any}) => this.validateAlternativeForProposal(options.proposal,project),
        isDirty: (path: string) => vscode.workspace.textDocuments.some(document =>
          document.isDirty && document.uri.scheme === "file" && document.uri.fsPath === join(project.root, path)),
        persist: async (proposal: any) => {
          await this.context.workspaceState.update(key, proposal);
          // The checkpoint is still the only write authority. History failure
          // must not pretend an already-applied source change failed or vanished.
          try {
            const recorded = await this.conversations(project).updateProposal(proposal);
            if (recorded) this.conversationHistoryWarnings?.delete(`${project.id}:checkpoint`);
          } catch (error) { this.warnConversationHistory(project.id, "checkpoint", error); }
        },
      });
      session.restore(this.context.workspaceState.get(key));
      this.proposalSessions.set(project.id, session);
    }
    return session;
  }

  private changeSetSnapshot() {
    if (!this.project || !vscode.workspace.isTrusted) return null;
    const snapshot=this.changeSetSessions?.get(this.project.id)?.snapshot();
    if(!snapshot)return null;
    const group=snapshot.current;if(group?.origin!=="alternative")return snapshot;
    const alternatives=this.visualAlternativesSessions?.get(this.alternativeKey())?.snapshot(), basis=group.alternativeBasis;
    const record=alternatives?.records.find(item=>item.id===basis?.comparisonId);
    const retained=alternatives?.storage.status==="saved" && record?.status==="completed" && record.source?.kind==="change-set" && basis &&
      record.source.groupId===basis.sourceGroupId && record.source.groupRevision===basis.sourceGroupRevision && record.source.groupDigest===basis.sourceGroupDigest &&
      record.baselineDigest===basis.baselineDigest && visualVerificationDigest(record.source.files)===visualVerificationDigest(basis.files);
    const reason=!retained || !record || !this.alternativeScopeCurrent(record,this.project) ? "The retained comparison or saved scope is unavailable. Prepare a new alternative to apply." : snapshot.assessment.reason;
    return {...snapshot,alternativeAuthority:{groupId:group.id,canApply:!reason && snapshot.assessment.canApply,canUndo:snapshot.assessment.canUndo,reason}};
  }

  private wholeChangeSetScope(checkpoint = this.changeSetSnapshot()) {
    const acceptance = checkpoint?.acceptance;
    if (!acceptance) return true;
    return Array.isArray(acceptance.appliedUnitIds) && acceptance.appliedUnitIds.length === 0 &&
      Array.isArray(acceptance.selectedUnitIds) && Array.isArray(acceptance.plan?.units) && acceptance.plan.units.length > 0 &&
      acceptance.selectedUnitIds.length === acceptance.plan.units.length &&
      acceptance.plan.units.every((unit: any) => acceptance.selectedUnitIds.includes(unit.id));
  }

  private requireNoActiveChangeSet() {
    if (this.executionSnapshot()?.busy) throw new Error("Stop the current isolated check before changing source.");
    const snapshot = this.changeSetSnapshot();
    if (snapshot?.storage?.status === "error" || snapshot?.storage?.status === "unavailable")
      throw new Error("Restore the local change checkpoint before preparing or applying another change.");
    if (snapshot?.busy || snapshot?.current && !["discarded", "undone"].includes(snapshot.current.status))
      throw new Error("Review, undo or dismiss the current change group before preparing another change.");
  }

  private changeSets() {
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted) throw new Error("Open a trusted project before reviewing isolated changes.");
    this.changeSetSessions ||= new Map();
    let session = this.changeSetSessions.get(project.id);
    if (session) return session;
    const storage = this.context.storageUri || this.context.globalStorageUri;
    if (!storage?.fsPath) throw new Error("Local change storage is unavailable. Reopen the workspace and try again.");
    const isCurrent = () => !this.disposed && vscode.workspace.isTrusted && this.project?.id === project.id && this.project.root === project.root;
    const guard = () => { if (!isCurrent()) throw new Error("The trusted workspace changed. Reopen its saved change group before continuing."); this.changeSetOperationGuards?.get(project.id)?.(); };
    session = createChangeSetSession({
      storageRoot: join(storage.fsPath, "changes", createHash("sha256").update(project.id + "\0" + project.root).digest("hex")),
      projectId: project.id,
      getFile: (id: string, path: string) => { guard(); return this.service.getFile(id, path); },
      isDirty: (path: string) => vscode.workspace.textDocuments.some(document => document.isDirty &&
        document.uri.scheme === "file" && document.uri.fsPath === join(project.root, path)),
      isCurrent: () => { guard(); return true; },
      applyBatch: (input: any, options: any) => {
        guard();
        if (this.proposals().current()?.status === "applied") throw new Error("Undo or dismiss the existing applied proposal first.");
        return this.service.applyBatch(input, {...options, guard: async (writeContext:any) => {
          guard();
          const affected = new Set([...input.files.map((file: any) => file.path), ...(input.expectedContext || []).map((file: any) => file.path)]);
          if (this.dirtyPaths().some(path => affected.has(path))) throw new Error("A contributing source has unsaved changes. Its draft is preserved.");
          await options.guard?.(writeContext);
          guard();
          if (this.dirtyPaths().some(path => affected.has(path))) throw new Error("A contributing source became unsaved while preparing this change.");
        }});
      },
      onChange: () => { if (isCurrent()) this.sendState(); },
      validateAlternative:(basis:any,options:any)=>this.validateAlternativeForGroup(basis,options,project),
      onCheckpoint: async (group: any) => {
        if(group?.origin!=="ai" || this.aiAlternativeOwner(group,project))return;
        try { await this.conversations(project).updateChangeSet(group); }
        catch (error) { this.warnConversationHistory(project.id, "checkpoint", error); }
      },
    });
    this.changeSetSessions.set(project.id, session);
    return session;
  }

  private async loadChangeSets() {
    if (!this.project || !vscode.workspace.isTrusted || !this.context.storageUri && !this.context.globalStorageUri) return;
    const session = this.changeSets();
    await session.load();
    return session.assess();
  }

  private async changeSetAction(message: any, surface: Surface) {
    if (this.alternativesBusy()) throw new Error("Stop the comparison before starting another source or runtime action.");
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted || message.projectId !== project.id || this.disposed)
      throw new Error("Choose a change group in the current trusted workspace.");
    if (!["diff", "apply", "undo", "recover", "discard", "refresh", "retry", "activateVersion", "prepareAcceptance", "selectUnits", "clearAcceptance"].includes(message.action))
      throw new Error("Choose an available change-group action.");
    if (this.asking) throw new Error("Stop the current response before changing its review checkpoint.");
    if (this.executionSnapshot()?.busy && !["diff", "refresh"].includes(message.action)) throw new Error("Stop the isolated check before changing its source checkpoint.");
    const generation = ++this.changeSetActionGeneration, focus = this.focusGeneration;
    const view = surface === "assistant" ? this.assistantView?.webview : this.panel?.webview;
    const current = () => !this.disposed && vscode.workspace.isTrusted && this.project?.id === project.id && this.project.root === project.root &&
      generation === this.changeSetActionGeneration && !this.asking && view === (surface === "assistant" ? this.assistantView?.webview : this.panel?.webview);
    const session = this.changeSets();
    await session.load();
    if (!current()) return;
    if (message.action === "retry") { await session.retry(); if (current()) this.sendState(); return; }
    const snapshot = session.snapshot();
    const group = ["diff", "activateVersion"].includes(message.action)
      ? snapshot.current?.id === message.changeSetId ? snapshot.current : snapshot.versions?.find((version: any) => version.group.id === message.changeSetId)?.group
      : snapshot.current;
    if (!group || message.changeSetId !== group.id || !Number.isSafeInteger(message.expectedRevision) || message.expectedRevision !== group.revision)
      throw new Error("This change checkpoint changed. Refresh the group before continuing.");
    if (snapshot.busy) throw new Error("Wait for this checkpoint operation to finish.");
    const localAlternative=group.origin==="alternative";
    if(localAlternative && ["activateVersion","prepareAcceptance","selectUnits","clearAcceptance"].includes(message.action))throw new Error("Retained alternatives use the whole reviewed group.");
    if (message.action === "selectUnits" || message.action === "apply" && snapshot.acceptance) {
      if (!snapshot.acceptance || message.planDigest !== snapshot.acceptance.plan.digest)
        throw new Error("The change selection changed. Review its current scope before continuing.");
    }
    if (message.action === "activateVersion" && snapshot.acceptance)
      throw new Error("Use the whole proposal before choosing another version.");
    if (message.action === "activateVersion" && (!snapshot.current || snapshot.current.id === group.id ||
      snapshot.current.id !== message.expectedCurrentId || snapshot.current.revision !== message.expectedCurrentRevision))
      throw new Error("The active version changed. Review it before choosing an earlier version.");
    const history = this.conversations(project).snapshot();
    const owner = history.conversations.find(chat => chat.turns.some(turn => turn.requestId === group.requestId && turn.changeSet?.id === group.id));
    const turn = owner?.turns.find(turn => turn.requestId === group.requestId);
    if (!localAlternative && ["apply", "undo", "activateVersion", "prepareAcceptance", "selectUnits", "clearAcceptance"].includes(message.action) && (history.storage.status !== "saved" || !owner || owner.archived || turn?.state !== "complete" || turn.completedWhileStopping ||
      surface === "assistant" && owner.id !== history.activeId))
      throw new Error("Open the completed change group in its saved, active conversation before applying or undoing it.");
    if (!localAlternative && ["apply", "undo", "activateVersion", "prepareAcceptance", "selectUnits", "clearAcceptance"].includes(message.action)) {
      const content = (value: any) => JSON.stringify({id: value?.id, projectId: value?.projectId, title: value?.title, summary: value?.summary,
        files: value?.files?.map(({id, path, before, after, baseRevision}: any) => ({id, path, before, after, baseRevision})),
        context: value?.context, verification: value?.verification, verificationStatus: value?.verificationStatus, requestId: value?.requestId});
      if (content(group) !== content(turn?.changeSet)) throw new Error("The local checkpoint does not match its saved request. Review the retained history before continuing.");
    }
    if (this.aiAlternativeOwner(group,project) && !["diff","discard","refresh","retry"].includes(message.action)) throw new Error("Compare this candidate, then review its retained result before applying source.");
    if (message.action === "activateVersion") {
      const activeTurn = owner?.turns.find(item => item.requestId === snapshot.current?.requestId);
      if (owner?.id !== history.activeId || !activeTurn?.changeSet || activeTurn.state !== "complete" || activeTurn.completedWhileStopping ||
        changeGroupDigest(activeTurn.changeSet) !== changeGroupDigest(snapshot.current))
        throw new Error("Open the current and earlier versions in their saved conversation before switching.");
    }
    try {
      if (message.action === "diff") {
        const file = group.files.find((item: any) => item.id === message.fileId);
        if (!file) throw new Error("Choose a file in this change group.");
        if (!current() || focus !== this.focusGeneration) return;
        const before = vscode.Uri.from({scheme: "foundation-snapshot", path: `/before/${basename(file.path)}`, query: randomBytes(8).toString("hex")});
        const after = vscode.Uri.from({scheme: "foundation-snapshot", path: `/staged/${basename(file.path)}`, query: randomBytes(8).toString("hex")});
        this.snapshots.set(before.toString(), file.before); this.snapshots.set(after.toString(), file.after);
        await vscode.commands.executeCommand("vscode.diff", before, after, `${file.path} · before ↔ staged`, {preview: true, viewColumn: this.sourceColumn()});
      } else if (message.action === "refresh") await session.assess();
      else {
        this.changeSetOperationGuards ||= new Map();
        const operationGuard = () => {
          if (!current()) throw new Error("This checkpoint operation was interrupted. Review its recovery state before continuing.");
          const execution=this.executionSessions?.get(project.id);
          if (execution?.isBusy ? execution.isBusy() : this.executionSnapshot()?.busy) throw new Error("The isolated check started. Stop it before changing source.");
          if (!localAlternative && ["apply", "undo", "activateVersion", "prepareAcceptance", "selectUnits", "clearAcceptance"].includes(message.action)) {
            const latest = this.conversations(project).snapshot();
            const chat = latest.conversations.find(item => item.id === owner?.id);
            const savedTurn = chat?.turns.find(item => item.requestId === group.requestId);
            if (latest.storage.status !== "saved" || !chat || chat.archived || savedTurn?.state !== "complete" || savedTurn.completedWhileStopping ||
              !savedTurn.changeSet || changeGroupDigest(savedTurn.changeSet) !== changeGroupDigest(group) ||
              surface === "assistant" && latest.activeId !== chat.id)
              throw new Error("The change group's conversation changed. Its checkpoint is preserved.");
          }
        };
        this.changeSetOperationGuards.set(project.id, operationGuard);
        try {
          if (message.action === "activateVersion") await session.activateVersion(group.id, {
            expectedCurrentId: message.expectedCurrentId, expectedCurrentRevision: message.expectedCurrentRevision,
            isCurrent: () => { operationGuard(); return true; },
          });
          else if (message.action === "prepareAcceptance") await session.prepareAcceptance(group.id, group.revision);
          else if (message.action === "selectUnits") await session.selectUnits(group.id, group.revision, {planDigest: message.planDigest, unitIds: message.unitIds});
          else if (message.action === "clearAcceptance") await session.clearAcceptance(group.id, group.revision);
          else await session[message.action as "apply" | "undo" | "recover" | "discard"](group.id, group.revision);
        }
        finally { if (this.changeSetOperationGuards.get(project.id) === operationGuard) this.changeSetOperationGuards.delete(project.id); }
        if (current() && ["apply", "undo", "recover"].includes(message.action)) {
          if (this.design.files?.some((file: any) => group.files.some((target: any) => target.path === file.path))) this.design.stale = true;
          await this.refresh();
        }
      }
    } finally { if (current()) this.sendState(); }
  }

  private executionSnapshot() {
    if (!this.project || !vscode.workspace.isTrusted) return null;
    const snapshot = this.executionSessions?.get(this.project.id)?.snapshot();
    if (!snapshot) return null;
    const checkpoint = this.changeSetSnapshot(), group = checkpoint?.current;
    const history = this.conversationPresentation().snapshot;
    const owner = history.conversations.find(chat => chat.turns.some(turn => turn.changeSet?.id === group?.id && turn.requestId === group?.requestId));
    const turn = owner?.turns.find(turn => turn.requestId === group?.requestId);
    const eligible = Boolean(this.wholeChangeSetScope(checkpoint) && group?.status === "proposed" && checkpoint.storage?.status === "saved" && !checkpoint.busy && checkpoint.assessment?.canApply &&
      history.storage.status === "saved" && owner && !owner.archived && turn?.state === "complete" && !turn.completedWhileStopping &&
      turn.changeSet && changeGroupDigest(group) === changeGroupDigest(turn.changeSet) &&
      !this.dirtyPaths().some(path => group.context.some((ref: any) => ref.path === path)));
    const matches = snapshot.current && group && snapshot.current.groupId === group.id && snapshot.current.groupRevision === group.revision &&
      snapshot.current.groupDigest === changeGroupDigest(group);
    const planSnapshot = this.checkPlanSessions?.get(this.project.id)?.snapshot();
    const plan = planSnapshot?.current;
    const activePlan = Boolean(plan && !["completed", "ended"].includes(plan.status));
    const planMatches = Boolean(plan && group && plan.groupId === group.id && plan.groupRevision === group.revision && plan.groupDigest === changeGroupDigest(group));
    const decisionOwner = Boolean(planMatches && history.storage.status === "saved" && owner && !owner.archived && turn?.state === "complete" && !turn.completedWhileStopping);
    const planSession = planSnapshot ? {...planSnapshot, assessment: {...planSnapshot.assessment,
      canCreate: Boolean(planSnapshot.assessment.canCreate && eligible && matches && snapshot.current?.status === "ready" && !this.asking),
      canRunNext: Boolean(planSnapshot.assessment.canRunNext && eligible && planMatches && !this.asking),
      canRetryStep: Boolean(planSnapshot.assessment.canRetryStep && eligible && planMatches && !this.asking),
      canSkipStep: Boolean(planSnapshot.assessment.canSkipStep && decisionOwner),
      ...(!planMatches && activePlan ? {reason: "This check plan belongs to an earlier group. End it before preparing another plan."} :
        !eligible && activePlan && !planSnapshot.busy ? {reason: "Review the current group and saved source before running another check."} :
        activePlan && plan.status === "paused" && !planSnapshot.busy && !snapshot.busy && planSnapshot.storage.status === "saved" &&
        !planSnapshot.assessment.reason && !snapshot.assessment.canPrepare && snapshot.assessment.reason ? {reason: snapshot.assessment.reason} : {}),
    }} : null;
    return {...snapshot, planSession, busy: snapshot.busy || Boolean(planSnapshot?.busy), assessment: {...snapshot.assessment,
      canPrepare: Boolean(snapshot.assessment.canPrepare && eligible && !this.asking && !activePlan && planSnapshot?.storage.status === "saved" && !planSnapshot.busy),
      canRun: Boolean(snapshot.assessment.canRun && eligible && matches && !this.asking && !activePlan && planSnapshot?.storage.status === "saved" && !planSnapshot.busy),
      ...(!eligible && !snapshot.busy ? {reason: "Use a completed, current staged group with saved source to prepare a check."} :
        activePlan ? {reason: "Continue the saved check plan, or end it before preparing a separate check."} : {}),
    }};
  }

  private executions() {
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted || this.disposed) throw new Error("Open a trusted project before preparing an isolated check.");
    this.executionSessions ||= new Map();
    let session = this.executionSessions.get(project.id);
    if (session) return session;
    const storage = this.context.storageUri || this.context.globalStorageUri;
    if (!storage?.fsPath) throw new Error("Local execution storage is unavailable. Reopen this workspace.");
    const isCurrent = () => !this.disposed && vscode.workspace.isTrusted && this.project?.id === project.id && this.project.root === project.root;
    session = createExecutionSession({storageRoot: join(storage.fsPath, "execution", createHash("sha256").update(project.id + "\0" + project.root).digest("hex")),
      projectId: project.id, root: project.root, isCurrent, onChange: () => { if (isCurrent()) this.sendState(); }});
    this.executionSessions.set(project.id, session);
    return session;
  }

  private async loadExecutions() {
    if (!this.project || !vscode.workspace.isTrusted || !this.context.storageUri && !this.context.globalStorageUri || !this.changeSetSnapshot()?.current) return;
    const project = this.project;
    await this.executions().load();
    if (this.disposed || !vscode.workspace.isTrusted || this.project?.id !== project.id || this.project.root !== project.root) return;
    await this.checkPlans().load();
  }

  private checkPlans() {
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted || this.disposed) throw new Error("Open a trusted project before reviewing check plans.");
    this.checkPlanSessions ||= new Map();
    const existing = this.checkPlanSessions.get(project.id);
    if (existing) return existing;
    const storage = this.context.storageUri || this.context.globalStorageUri;
    if (!storage?.fsPath) throw new Error("Local check-plan storage is unavailable. Reopen this workspace.");
    const isCurrent = () => !this.disposed && vscode.workspace.isTrusted && this.project?.id === project.id && this.project.root === project.root;
    const session = createCheckPlanSession({storageRoot: join(storage.fsPath, "check-plans", createHash("sha256").update(project.id + "\0" + project.root).digest("hex")),
      projectId: project.id, execution: this.executions(), isCurrent, onChange: () => { if (isCurrent()) this.sendState(); }});
    this.checkPlanSessions.set(project.id, session);
    return session;
  }

  private async stopExecutions() {
    await Promise.allSettled([...(this.checkPlanSessions?.values() || [])].filter(session => session.snapshot().busy).map(session => session.stop()));
    await Promise.allSettled([...(this.executionSessions?.values() || [])].filter(session => session.snapshot().busy).map(session => session.stop()));
  }

  private async checkPlanAction(message: any, surface: Surface) {
    if (this.alternativesBusy()) throw new Error("Stop the comparison before starting another source or runtime action.");
    const project = this.project;
    if (!project || this.disposed || !vscode.workspace.isTrusted || message.projectId !== project.id)
      throw new Error("Choose a check plan in the current trusted project.");
    if (!["create", "runNext", "retryStep", "skipStep", "stop", "end", "retryStorage"].includes(message.action))
      throw new Error("Choose an available check-plan decision.");
    const projectCurrent = () => !this.disposed && vscode.workspace.isTrusted && this.project?.id === project.id && this.project.root === project.root;
    const session = this.checkPlans();
    await session.load();
    if (!projectCurrent()) return;
    const initial = session.snapshot(), plan = initial.current;
    if (message.action === "retryStorage") {
      if (initial.busy) throw new Error("Stop the check before retrying local storage.");
      await session.retryStorage(); if (projectCurrent()) this.sendState(); return;
    }
    if (message.action !== "create" && (!plan || message.planId !== plan.id || message.changeSetId !== plan.groupId ||
      message.expectedGroupRevision !== plan.groupRevision || !Number.isSafeInteger(message.expectedRevision) ||
      (message.action === "stop" ? message.expectedRevision < 0 || message.expectedRevision > plan.revision : message.expectedRevision !== plan.revision)))
      throw new Error("This check plan changed. Use its current decision controls.");
    // Negative decisions remain available when source, conversation or group eligibility changes.
    if (message.action === "stop") {
      if (!initial.busy || typeof message.attemptId !== "string" || message.attemptId !== plan.activeAttemptId)
        throw new Error("This attempt changed. Use Stop on the running check.");
      await session.stop(plan.id, message.expectedRevision, message.attemptId); return;
    }
    if (message.action === "end") {
      await session.end(plan.id, plan.revision, {guard: async () => { if (!projectCurrent()) throw new Error("The check plan's project changed."); }});
      if (projectCurrent()) this.sendState(); return;
    }
    if (initial.busy || this.executions().snapshot().busy) throw new Error("Wait for the current check before choosing another decision.");
    if (this.asking && message.action !== "skipStep") throw new Error("Finish the current response before preparing or running a check plan.");
    const checkpoint = this.changeSetSnapshot(), group = checkpoint?.current;
    if (!this.wholeChangeSetScope(checkpoint)) throw new Error("Checks use the whole proposal. Select every unit before preparing a check; earlier results remain historical.");
    if (!group || group.status !== "proposed" || checkpoint.storage?.status !== "saved" || checkpoint.busy || message.changeSetId !== group.id ||
      !Number.isSafeInteger(message.expectedGroupRevision) || message.expectedGroupRevision !== group.revision)
      throw new Error("Choose the current staged group before continuing this check plan.");
    const digest = changeGroupDigest(group);
    if (plan && message.action !== "create" && (plan.groupId !== group.id || plan.groupRevision !== group.revision || plan.groupDigest !== digest))
      throw new Error("The group version changed. Its earlier check plan is preserved.");
    const history = this.conversations(project).snapshot();
    const owner = history.conversations.find(chat => chat.turns.some(turn => turn.requestId === group.requestId && turn.changeSet?.id === group.id));
    const turn = owner?.turns.find(turn => turn.requestId === group.requestId);
    if (history.storage.status !== "saved" || !owner || owner.archived || turn?.state !== "complete" || turn.completedWhileStopping ||
      !turn.changeSet || changeGroupDigest(turn.changeSet) !== digest || surface === "assistant" && owner.id !== history.activeId)
      throw new Error("Open the completed group in its saved conversation before choosing a check-plan decision.");
    const view = surface === "assistant" ? this.assistantView?.webview : this.panel?.webview;
    const sourceEpoch = this.featureSourceEpoch;
    let dispatched = false;
    const assertOwnership = () => {
      if (!projectCurrent() || !view || view !== (surface === "assistant" ? this.assistantView?.webview : this.panel?.webview))
        throw new Error("The check plan's workspace was closed or changed.");
      const current = this.changeSetSnapshot(), latest = this.conversations(project).snapshot();
      const chat = latest.conversations.find(item => item.id === owner.id), savedTurn = chat?.turns.find(item => item.requestId === group.requestId);
      if (!this.wholeChangeSetScope(current) || current?.storage?.status !== "saved" || !dispatched && current.busy || current?.current?.id !== group.id || current.current.revision !== group.revision || current.current.status !== "proposed" ||
        changeGroupDigest(current.current) !== digest || (dispatched ? ["error", "unavailable"].includes(latest.storage.status) : latest.storage.status !== "saved") || !chat || chat.archived ||
        savedTurn?.state !== "complete" || savedTurn.completedWhileStopping || !savedTurn.changeSet || changeGroupDigest(savedTurn.changeSet) !== digest ||
        !dispatched && surface === "assistant" && latest.activeId !== owner.id)
        throw new Error("The group or its saved conversation changed. Its check plan is preserved.");
    };
    const beforeRun = () => {
      assertOwnership();
      if (sourceEpoch !== this.featureSourceEpoch || this.dirtyPaths().some(path => group.context.some((ref: any) => ref.path === path)))
        throw new Error("Source changed before this check could start.");
      dispatched = true;
    };
    const decisionGuard = async () => { assertOwnership(); };
    const guard = async () => {
      assertOwnership();
      if (!dispatched && sourceEpoch !== this.featureSourceEpoch) throw new Error("Saved source changed while this check was being prepared. Review it before continuing.");
      for (const reference of group.context) {
        if (this.dirtyPaths().includes(reference.path)) throw new Error("A contributing source has an unsaved draft. Its draft is preserved.");
        const source = await this.service.getFile(project.id, reference.path);
        assertOwnership();
        const target = group.files.find((file: any) => file.path === reference.path);
        if (source.revision !== reference.revision || target && source.source !== target.before)
          throw new Error("The group's original source changed. Prepare a new group before running checks.");
      }
      assertOwnership();
      if (!dispatched && sourceEpoch !== this.featureSourceEpoch || this.dirtyPaths().some(path => group.context.some((ref: any) => ref.path === path)))
        throw new Error("Source changed during preparation. No check may start from this decision.");
    };
    try {
      if (message.action === "skipStep") {
        await decisionGuard();
        await session.skipStep(plan.id, plan.revision, message.stepId, {guard: decisionGuard});
      } else {
        await guard();
        if (message.action === "create") {
          const record = this.executions().snapshot().current;
          if (!record || record.id !== message.executionId || record.revision !== message.expectedExecutionRevision || record.status !== "ready" ||
            record.groupId !== group.id || record.groupRevision !== group.revision || record.groupDigest !== digest)
            throw new Error("Prepare the current group's isolated workspace before saving a check plan.");
          await session.create({executionId: record.id, expectedExecutionRevision: record.revision, taskIds: message.taskIds}, {guard});
        } else if (message.action === "runNext") await session.runNext(plan.id, plan.revision, {group, guard, beforeRun});
        else await session.retryStep(plan.id, plan.revision, message.stepId, {group, guard, beforeRun});
      }
    } finally { if (projectCurrent()) this.sendState(); }
  }

  private async executionAction(message: any, surface: Surface) {
    if (this.alternativesBusy()) throw new Error("Stop the comparison before starting another source or runtime action.");
    const project = this.project;
    if (!project || this.disposed || !vscode.workspace.isTrusted || message.projectId !== project.id)
      throw new Error("Choose an isolated check in the current trusted project.");
    if (!["prepare", "run", "stop", "retry"].includes(message.action)) throw new Error("Choose an available isolated-check action.");
    const session = this.executions();
    await session.load();
    const projectCurrent = () => !this.disposed && vscode.workspace.isTrusted && this.project?.id === project.id && this.project.root === project.root;
    if (!projectCurrent()) return;
    const initial = session.snapshot();
    // Stop must remain available after a conversation is archived or a source becomes stale.
    if (message.action === "stop") {
      if (!initial.busy || !initial.current || message.executionId !== initial.current.id ||
        message.changeSetId !== initial.current.groupId || !Number.isSafeInteger(message.expectedRevision) || message.expectedRevision < 0 || message.expectedRevision > initial.current.revision)
        throw new Error("This check changed. Use its current Stop control.");
      await session.stop(initial.current.id, initial.current.revision); return;
    }
    if (initial.busy) throw new Error("Stop the current check before preparing another.");
    if (message.action === "retry") { await session.retry(); if (projectCurrent()) this.sendState(); return; }
    await this.checkPlans().load();
    if (!projectCurrent()) return;
    const assertNoPlan = () => {
      const planState = this.checkPlanSessions?.get(project.id)?.snapshot();
      if (!planState || planState.storage.status !== "saved") throw new Error("Load and save check-plan history before preparing a separate check.");
      if (planState.busy || planState.current && !["completed", "ended"].includes(planState.current.status))
        throw new Error("Continue or end the saved check plan before preparing a separate check.");
    };
    assertNoPlan();
    if (this.asking) throw new Error("Finish the current response before preparing or running a check.");
    const checkpoint = this.changeSetSnapshot(), group = checkpoint?.current;
    if (!this.wholeChangeSetScope(checkpoint)) throw new Error("Checks use the whole proposal. Select every unit before preparing a check; earlier results remain historical.");
    if (!group || group.status !== "proposed" || checkpoint.storage?.status !== "saved" || checkpoint.busy || message.changeSetId !== group.id ||
      !Number.isSafeInteger(message.expectedGroupRevision) || message.expectedGroupRevision !== group.revision)
      throw new Error("Choose the current staged change group before checking it.");
    const history = this.conversations(project).snapshot();
    const owner = history.conversations.find(chat => chat.turns.some(turn => turn.requestId === group.requestId && turn.changeSet?.id === group.id));
    const turn = owner?.turns.find(turn => turn.requestId === group.requestId);
    if (history.storage.status !== "saved" || !owner || owner.archived || turn?.state !== "complete" || turn.completedWhileStopping ||
      !turn.changeSet || changeGroupDigest(turn.changeSet) !== changeGroupDigest(group) ||
      surface === "assistant" && owner.id !== history.activeId)
      throw new Error("Open the completed group in its saved conversation before checking it.");
    const digest = changeGroupDigest(group), view = surface === "assistant" ? this.assistantView?.webview : this.panel?.webview;
    const assertOwnership = () => {
      if (!projectCurrent() || view !== (surface === "assistant" ? this.assistantView?.webview : this.panel?.webview))
        throw new Error("The check's workspace was closed or changed.");
      assertNoPlan();
      const current = this.changeSetSnapshot(), latest = this.conversations(project).snapshot();
      const chat = latest.conversations.find(item => item.id === owner.id), savedTurn = chat?.turns.find(item => item.requestId === group.requestId);
      if (!this.wholeChangeSetScope(current) || current?.storage?.status !== "saved" || current?.current?.id !== group.id || current.current.revision !== group.revision || current.current.status !== "proposed" ||
        changeGroupDigest(current.current) !== digest || ["error", "unavailable"].includes(latest.storage.status) || !chat || chat.archived ||
        savedTurn?.state !== "complete" || savedTurn.completedWhileStopping || !savedTurn.changeSet || changeGroupDigest(savedTurn.changeSet) !== digest)
        throw new Error("The staged group or its saved conversation changed. Prepare a fresh check.");
    };
    const guard = async () => {
      assertOwnership();
      for (const reference of group.context) {
        if (this.dirtyPaths().includes(reference.path)) throw new Error("A contributing source has an unsaved draft. Its draft is preserved.");
        const source = await this.service.getFile(project.id, reference.path);
        assertOwnership();
        const target = group.files.find((file: any) => file.path === reference.path);
        if (source.revision !== reference.revision || target && source.source !== target.before)
          throw new Error("The group's original source changed. Prepare a new group before checking it.");
      }
      assertOwnership();
      if (this.dirtyPaths().some(path => group.context.some((ref: any) => ref.path === path)))
        throw new Error("The workspace changed while the check was being prepared.");
    };
    await guard();
    if (message.action === "prepare") await session.prepare(group, {guard});
    else {
      const snapshot = session.snapshot(), record = snapshot.current;
      if (!record || record.id !== message.executionId || !Number.isSafeInteger(message.expectedRevision) || record.revision !== message.expectedRevision ||
        record.groupId !== group.id || record.groupRevision !== group.revision || record.groupDigest !== digest ||
        !record.tasks.some((task: any) => task.id === message.taskId)) throw new Error("Choose a supported command in the current prepared workspace.");
      await session.run(record.id, record.revision, message.taskId, {guard});
    }
    if (projectCurrent()) this.sendState();
  }

  private runtimeSnapshot(): RuntimeSnapshot {
    return this.runtime?.snapshot() || { status: "idle", root: this.project?.root || "", targets: [], owned: false, capabilities: { sourceMapping: "unavailable", requests: false, screenshots: false }, selection: null, selectionVersion: 0, observations: [], files: [] };
  }

  private async resetRuntime() {
    this.interruptRuntimeMatrix("runtime-changed");
    await this.endScenarioRun("interrupted", "not-assessed", "", "The runtime stopped or the project changed.").catch(() => {});
    this.runtimeGeneration = (this.runtimeGeneration || 0) + 1;
    const previous = this.runtime;
    this.runtime = undefined; this.runtimeRoot = undefined; this.runtimeSelectionKey = "";
    const changed = Boolean(this.runtimeFrameOrigin);
    this.runtimeFrameOrigin = "";
    await previous?.dispose();
    if (changed && this.panel && !this.disposed) {
      this.sentDesignSession = undefined;
      this.panel.webview.html = this.webviewHtml(this.panel.webview, "workspace");
    }
  }

  private async ensureRuntime() {
    if (!vscode.workspace.isTrusted || !this.project) throw new Error("Open and trust a local project before connecting a runtime.");
    if (this.runtime && this.runtimeRoot === this.project.root) return this.runtime;
    await this.resetRuntime();
    const generation = this.runtimeGeneration;
    this.runtimeRoot = this.project.root;
    this.runtime = createConnectedRuntime({ root: this.project.root, onChange: () => {
      void this.runtimeChanged(generation).catch(() => { if (generation === this.runtimeGeneration) this.sendState(); });
    } });
    return this.runtime;
  }

  private async runtimeAction(message: any) {
    if (this.alternativesBusy()) throw new Error("Stop the comparison before starting another source or runtime action.");
    if (this.runtimeMatrixTask && !["discover","stop"].includes(message.action)) throw new Error("Stop the condition matrix before changing its runtime.");
    if (message.action === "stop") this.interruptRuntimeMatrix("runtime-changed");
    if (!vscode.workspace.isTrusted || !this.project) throw new Error("Open and trust a local project before connecting a runtime.");
    if (!["discover", "start", "connect", "stop", "setup"].includes(message.action)) throw new Error("Choose a running-project action.");
    if (message.action === "setup") return vscode.commands.executeCommand("foundation.runtimeSetup");
    const runtime = await this.ensureRuntime();
    if (message.action === "discover") await runtime.discover();
    else if (message.action === "start") {
      if (typeof message.targetId !== "string" || message.targetId.length > 2048) throw new Error("Choose a supported Vite target.");
      await runtime.start(message.targetId);
    } else if (message.action === "connect") {
      if (typeof message.url !== "string" || message.url.length > 2048) throw new Error("Enter the local URL of an instrumented Vite project.");
      await runtime.connect(message.url);
    } else await runtime.stop();
    await this.runtimeChanged(this.runtimeGeneration);
    return this.runtimeSnapshot();
  }

  private async runtimeChanged(generation: number) {
    if (this.disposed || generation !== this.runtimeGeneration || !this.project || !vscode.workspace.isTrusted || this.runtimeRoot !== this.project.root) return;
    const runtime = this.runtime;
    const project = this.project;
    const startingFocusGeneration = this.focusGeneration;
    const snapshot = this.runtimeSnapshot();
    const selection = snapshot.selection;
    const selectionIdentity = JSON.stringify(selection);
    const runtimeIdentity = { session: snapshot.session, viewId: snapshot.viewId, documentId: snapshot.documentId, pagePath: snapshot.pagePath, pageVersion: snapshot.pageVersion, selectionVersion: snapshot.selectionVersion };
    const ownsSelection = () => {
      const current = this.runtimeSnapshot();
      return (Object.keys(runtimeIdentity) as (keyof typeof runtimeIdentity)[]).every(key => current[key] === runtimeIdentity[key]) && JSON.stringify(current.selection) === selectionIdentity;
    };
    const selectionKey = snapshot.session && snapshot.selectionVersion ? `${snapshot.session}:${snapshot.viewId || "legacy"}:${snapshot.selectionVersion}` : "";
    const newSelection = Boolean(selectionKey && selectionKey !== this.runtimeSelectionKey);
    // Reserve this event before reconciliation yields. A native focus change
    // retires the event instead of letting the next poll apply it again.
    if (newSelection) this.runtimeSelectionKey = selectionKey;
    await this.reconcileScenarioRun();
    if (this.disposed || !vscode.workspace.isTrusted || this.runtime !== runtime || generation !== this.runtimeGeneration ||
      startingFocusGeneration !== this.focusGeneration || this.project?.id !== project.id || !ownsSelection()) return;
    let frameOrigin = "";
    if (snapshot.url) {
      const url = new URL(snapshot.url);
      if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password) frameOrigin = url.origin;
    }
    if (frameOrigin !== this.runtimeFrameOrigin) {
      this.runtimeFrameOrigin = frameOrigin;
      if (this.panel) {
        // A new target origin changes CSP only at explicit target transitions.
        // Normal polling, AI updates and HMR preserve the existing frame.
        this.sentDesignSession = undefined;
        this.panel.webview.html = this.webviewHtml(this.panel.webview, "workspace");
      }
    }
    if (newSelection) {
      if (snapshot.status === "connected" && selection?.mapping === "resolved" && !selection.stale && validSourcePath(selection.path)) {
        this.generation++; // Explicit runtime selection supersedes a pending source refresh.
        const focusGeneration = ++this.focusGeneration;
        const file: ProjectFile = await this.service.getFile(project.id, selection.path);
        if (this.disposed || !vscode.workspace.isTrusted || this.runtime !== runtime || generation !== this.runtimeGeneration || focusGeneration !== this.focusGeneration || this.project?.id !== project.id ||
          this.runtimeSnapshot().status !== "connected" || !ownsSelection()) return;
        if (createHash("sha256").update(file.source).digest("hex") === selection.revision) {
          this.lastDocument = vscode.Uri.file(join(project.root, file.path));
          this.activeFile = file;
          this.openFiles = [file, ...this.openFiles.filter(item => item.path !== file.path)].slice(0, 8);
          this.focus = { path: file.path, line: validLine(selection.line), label: selection.label, origin: "runtime", revision: file.revision, session: snapshot.session, ...(snapshot.viewId ? { viewId: snapshot.viewId } : {}) };
          this.persistFocus(); this.updateTree();
        }
      }
    }
    this.sendState();
  }

  private resolveRuntimeEvidence(input: any) {
    const snapshot = this.runtimeSnapshot();
    if (!vscode.workspace.isTrusted || !this.project || this.runtimeRoot !== this.project.root || input?.projectId !== this.project.id || snapshot.status !== "connected" ||
      input?.session !== snapshot.session || !Array.isArray(input.observationIds) || input.observationIds.length < 1 || input.observationIds.length > 12 ||
      new Set(input.observationIds).size !== input.observationIds.length) throw new Error("The runtime context changed. Reconnect and select the requests to share.");
    return input.observationIds.map((id: unknown) => {
      if (typeof id !== "string") throw new Error("Select a recorded request from the current runtime.");
      const record = snapshot.observations.find((item: any) => item.id === id && item.session === snapshot.session);
      if (!record) throw new Error("A selected request is no longer available. Review the runtime context before sending.");
      return { ...record };
    });
  }

  private designImpactMetadata() {
    // Ownership guards run during each bounded source read. Use the committed
    // definition view without recomputing historical runtime freshness per file.
    const store = this.runtimeWorkspaceStore(), workspace = store.presentation ? store.presentation().snapshot : store.snapshot();
    const features = this.featureSnapshot(), suites = this.runtimeStateSuiteSnapshot();
    return JSON.stringify({featureRevision: features?.revision, featureId: features?.activeId, featureStorage: features?.storage?.status,
      workspaceRevision: workspace?.revision, workspaceStorage: workspace?.storage?.status, suiteRevision: suites?.revision, suiteStorage: suites?.storage?.status});
  }

  private designImpactPreview(target: any) {
    if (!target || !validSourcePath(target.path) || !/^[a-f0-9]{16}$/.test(target.revision || "")) return null;
    if (target.kind === "token") {
      if (this.design?.status !== "ready" || this.design.stale || !this.design.session || !this.design.tokens?.some((token: any) =>
        token.path === target.path && token.revision === target.revision && token.name === target.name && token.occurrence === target.occurrence)) return null;
      return JSON.stringify({kind: "preview-token", session: this.design.session});
    }
    if (target.kind !== "component") return null;
    const runtime = this.runtime?.snapshot(), selection = runtime?.selection;
    if (runtime?.status === "connected" && selection?.mapping === "resolved" && !selection.stale && selection.path === target.path &&
      selection.revision?.slice(0, 16) === target.revision) return JSON.stringify({kind: "runtime", session: runtime.session, viewId: runtime.viewId,
        documentId: runtime.documentId, pagePath: runtime.pagePath, pageVersion: runtime.pageVersion, selectionVersion: runtime.selectionVersion,
        path: selection.path, revision: selection.revision});
    if (this.design?.status === "ready" && !this.design.stale && this.design.session && this.design.selection?.path === target.path &&
      this.design.files?.some((file: any) => file.path === target.path && file.revision === target.revision))
      return JSON.stringify({kind: "preview-component", session: this.design.session, path: target.path, label: this.design.selection.label, tag: this.design.selection.tag});
    return null;
  }

  private designImpactOwnerCurrent(owner: any, checkFocus = true) {
    return Boolean(owner && !this.disposed && vscode.workspace.isTrusted && this.project?.id === owner.projectId && this.project?.root === owner.root &&
      (this.featureSourceEpoch || 0) === owner.epoch && (!checkFocus || (this.focusGeneration || 0) === owner.focus) &&
      this.designImpactMetadata() === owner.metadata && this.designImpactPreview(owner.target) === owner.preview && !this.dirtyPaths().includes(owner.target.path));
  }

  private designImpactState() {
    const owner = this.designImpactOwner;
    if (!owner || !this.project || !vscode.workspace.isTrusted || this.disposed || owner.projectId !== this.project.id || owner.root !== this.project.root) return null;
    const current = this.designImpactOwnerCurrent(owner), state = this.designImpactView || {};
    const status = current ? state.status : "stale";
    const paths = new Set((state.result?.manifest || []).map((file: any) => file.path));
    return {...state, target: owner.target, status, id: status === "ready" ? state.id : null,
      message: current ? state.message : "Source, selection or scenario definitions changed. Inspect change impact again.",
      dirtyPaths: this.dirtyPaths().filter(path => paths.has(path)), relatedScenarios: state.relatedScenarios || []};
  }

  private invalidateDesignImpact(clear = false) {
    this.designImpactGeneration = (this.designImpactGeneration || 0) + 1;
    this.designImpactValidationCache = undefined;
    if (clear) { this.designImpactOwner = undefined; this.designImpactView = undefined; return; }
    if (this.designImpactView) this.designImpactView = {...this.designImpactView, status: "stale", id: null,
      message: "Saved source changed. Inspect change impact again."};
  }

  private designImpactSourceChanged(uri: vscode.Uri) {
    if (!this.project || uri.scheme !== "file") return false;
    const path = relativeSourcePath(this.project.root, uri.fsPath);
    if (!path || path.split("/").slice(0, -1).some(part => part.startsWith(".") ||
      ["node_modules", "bower_components", "vendor", "dist", "build", "out", "coverage", "artifacts", "test-results", "playwright-report", "Pods", "Carthage", "DerivedData", "__pycache__"].includes(part))) return false;
    if (basename(path).startsWith(".") && basename(path) !== ".gitignore") return false;
    if (!this.project.files.some(file => file.path === path) && !/\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|sass|less|html|htm|md|mdx|txt|yaml|yml|svg|swift|kt|java|xml|graphql|gql|toml|sql|py|rs|go|vue|svelte)$/i.test(path) && basename(path) !== ".gitignore") return false;
    this.invalidateDesignImpact(); return true;
  }

  private relatedDesignScenarios(result: any) {
    const features = this.featureSnapshot(), workspace = this.runtimeWorkspaceSnapshot(), suites = this.runtimeStateSuiteSnapshot();
    if (features?.storage.status !== "saved" || workspace?.storage.status !== "saved") return [];
    // These are saved feature memberships, never a claim of affected runtime
    // instances, executed scenarios, or verification coverage.
    const paths = new Set([result.target.path, ...result.consumers.map((edge: any) => edge.from.path),
      ...result.tokenReferences.map((reference: any) => reference.source.path)]);
    const rows: any[] = [];
    for (const feature of features.features.filter(item => !item.archived)) {
      const related = feature.paths.filter(path => paths.has(path)); if (!related.length) continue;
      for (const screen of (workspace.screens || []).filter((item: any) => !item.archived && item.featureId === feature.id))
        for (const scenario of (workspace.scenarios || []).filter((item: any) => !item.archived && item.screenId === screen.id)) {
          rows.push({featureId: feature.id, featureTitle: feature.title, screenId: screen.id, screenTitle: screen.title,
            scenarioId: scenario.id, scenarioTitle: scenario.title, paths: related.slice(0, 32),
            suiteNames: suites?.storage?.status === "saved" ? [...new Set((suites.suites || []).filter((suite: any) => suite.featureId === feature.id && suite.screenId === screen.id && suite.scenarioId === scenario.id).map((suite: any) => suite.title))].slice(0, 20) : []});
          if (rows.length === 40) return rows;
        }
    }
    return rows;
  }

  private async designImpactAction(message: any) {
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted || this.disposed) throw new Error("Inspect change impact in a trusted project.");
    if (message.action === "navigate") return this.navigateDesignImpact(message);
    if (message.action !== "analyze") throw new Error("Choose a change impact action.");
    const input = message.target, target = input && {kind: input.kind, path: input.path, revision: input.revision,
      ...(input.kind === "token" ? {name: input.name, occurrence: input.occurrence} : {})};
    const preview = this.designImpactPreview(target);
    if (!preview) throw new Error("Select current mapped source or a saved preview token before inspecting change impact.");
    if (this.dirtyPaths().includes(target.path)) throw new Error("This source has an unsaved draft. Save or discard that draft before inspecting its saved change impact.");
    const generation = this.designImpactGeneration = (this.designImpactGeneration || 0) + 1;
    const owner = {projectId: project.id, root: project.root, target, preview, epoch: this.featureSourceEpoch || 0,
      focus: this.focusGeneration || 0, metadata: this.designImpactMetadata()};
    this.designImpactOwner = owner; this.designImpactView = {status: "loading", id: null, result: null, relatedScenarios: [], message: ""}; this.sendState();
    const current = () => this.designImpactGeneration === generation && this.designImpactOwner === owner && this.designImpactOwnerCurrent(owner) && !this.dirtyPaths().includes(target.path);
    try {
      const result = validateChangeImpact(await this.service.changeImpact(project.id, target, {isCurrent: current}));
      if (!current()) return this.designImpactState();
      if (result.projectId !== project.id || result.target.kind !== target.kind || result.target.path !== target.path || result.target.revision !== target.revision || target.kind === "token" && result.target.kind === "token" && (result.target.name !== target.name || result.target.occurrence !== target.occurrence)) throw new Error("Invalid impact ownership");
      const complete = await this.service.validateChangeImpact(project.id, result, {isCurrent: current});
      if (!current()) return this.designImpactState();
      this.designImpactView = {status: complete ? "ready" : "incomplete", id: complete ? randomBytes(12).toString("hex") : null, result,
        relatedScenarios: this.relatedDesignScenarios(result), message: complete ? "" :
          "The saved-source basis is incomplete or changed. Narrow the project or restore unavailable files, then inspect change impact again."};
    } catch {
      if (current()) this.designImpactView = {status: "error", id: null, result: null, relatedScenarios: [],
        message: "Saved change impact could not be inspected. Check the selected source and try again."};
    }
    if (this.designImpactOwner === owner) this.sendState();
    return this.designImpactState();
  }

  private async navigateDesignImpact(message: any) {
    const project = this.project!, state = this.designImpactState(), owner = this.designImpactOwner;
    if (!state || state.status !== "ready" || !state.id || message.id !== state.id) throw new Error("Inspect current change impact before opening evidence.");
    const result = state.result, edge = result.consumers.find((item: any) => item.id === message.evidenceId);
    const source = [...result.tokenReferences, ...result.declarations].find((item: any) => item.id === message.evidenceId)?.source;
    const target = edge ? message.target === "source" ? edge.from : message.target === "definition" ? edge.to : null :
      message.target === "source" ? message.evidenceId === "scope" ? result.scope.source : source : null;
    if (!target) throw new Error("Choose source evidence from the current change impact.");
    const references = [result.scope.source, ...(edge ? [edge.from, edge.to] : [target])];
    const generation = this.designImpactGeneration, id = state.id;
    const navigation = this.designImpactNavigation = (this.designImpactNavigation || 0) + 1;
    const current = () => this.designImpactGeneration === generation && this.designImpactView?.id === id && this.designImpactNavigation === navigation && this.designImpactOwnerCurrent(owner);
    const check = () => {
      if (!current()) throw new Error("Change impact changed. Inspect it again before opening evidence.");
      if (references.some(ref => this.dirtyPaths().includes(ref.path))) throw new Error("This evidence uses saved source. Save or discard the affected draft before opening its exact location.");
    };
    const stale = () => { if (current()) { this.invalidateDesignImpact(); this.queueRefresh(); } return new Error("Source evidence changed. Inspect change impact again."); };
    check();
    if (!await this.service.validateChangeImpact(project.id, result, {isCurrent: current})) throw stale();
    check();
    for (const ref of [...new Map(references.map(ref => [ref.path, ref])).values()] as any[]) {
      const file = await this.service.getFile(project.id, ref.path); check(); if (file.revision !== ref.revision) throw stale();
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(project.root, target.path)));
    check();
    if (document.isDirty) throw new Error("This evidence uses saved source. Save or discard the affected draft before opening its exact location.");
    if (createHash("sha256").update(document.getText()).digest("hex").slice(0, 16) !== target.revision) throw stale();
    const line = validLine(target.line) - 1, column = Math.max(0, (target.column || 1) - 1);
    if (line >= document.lineCount || column > document.getText().split(/\r?\n/)[line].length) throw stale();
    const range = new vscode.Range(line, column, line, column); check();
    const editor = await vscode.window.showTextDocument(document, {viewColumn: this.sourceColumn(), preserveFocus: false, selection: range});
    if (this.designImpactGeneration !== generation || this.designImpactView?.id !== id || this.designImpactNavigation !== navigation ||
      !this.designImpactOwnerCurrent(owner, false) || vscode.window.activeTextEditor && vscode.window.activeTextEditor !== editor) return;
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter); this.lastDocument = document.uri; this.queueRefresh();
  }

  private async validateDesignImpactForProposal(checkpoint: any, phase: "assess" | "apply", project: ProjectSnapshot) {
    const epoch = this.featureSourceEpoch || 0, current = () => !this.disposed && vscode.workspace.isTrusted && this.project?.id === project.id &&
      this.project?.root === project.root && (this.featureSourceEpoch || 0) === epoch && !this.dirtyPaths().includes(checkpoint.result.target.path);
    if (!current()) return false;
    const key = `${project.id}\0${project.root}\0${epoch}\0${checkpoint.result.basisDigest}`;
    if (phase === "assess" && this.designImpactValidationCache?.key === key) return this.designImpactValidationCache.valid;
    const valid = await this.service.validateChangeImpact(project.id, checkpoint.result, {isCurrent: current});
    if (!current()) return false;
    this.designImpactValidationCache = {key, valid}; return valid;
  }

  private async startDesignPreview(input?: unknown) {
    if (!vscode.workspace.isTrusted || !this.project) throw new Error("Open and trust a local project before starting its preview.");
    this.show("Refine");
    const project = this.project;
    const entry = typeof input === "string" && input ? input :
      project.files.find(file => file.path === "src/App.tsx")?.path ||
      project.files.find(file => /(?:^|\/)App\.[jt]sx$/.test(file.path))?.path;
    if (!entry || !validSourcePath(entry)) throw new Error("Choose a React component with a default export.");
    const generation = ++this.designGeneration;
    this.design = { status: "building", entry, compilation: "not-run", observed: false, tokens: [] };
    this.sentDesignSession = undefined;
    this.sendState();
    try {
      const files: ProjectFile[] = [];
      const pending = [entry];
      const seen = new Set<string>();
      let bytes = 0;
      while (pending.length) {
        const path = pending.shift()!;
        if (seen.has(path)) continue;
        seen.add(path);
        if (seen.size > 64) throw new Error("This preview supports up to 64 source files. Choose a smaller component.");
        const file: ProjectFile = await this.diagnostics.runAsync("preview-source-read", () => this.service.getFile(project.id, path));
        bytes += Buffer.byteLength(file.source);
        if (bytes > 512 * 1024) throw new Error("This preview exceeds the 512 KiB source limit. Choose a smaller component.");
        files.push(file);
        for (const imported of file.analysis.imports) if (imported.resolvedPath) pending.push(imported.resolvedPath);
      }
      for (const file of files) {
        const latest = await this.diagnostics.runAsync("preview-source-read", () => this.service.getFile(project.id, file.path));
        if (latest.revision !== file.revision)
          throw new Error("Source changed while preparing the preview. Rebuild it to use the latest files.");
      }
      const runtimeSource = await this.diagnostics.runAsync("preview-runtime-read", () => readFile(join(this.context.extensionPath, "media/preview-runtime.js"), "utf8"));
      const session = randomBytes(16).toString("hex");
      const compiled = this.diagnostics.runSync("preview-compilation", () => buildDesignPreview({ files, entry, nonce: this.nonce, runtimeSource, session }));
      if (generation !== this.designGeneration || this.project?.id !== project.id || this.disposed) return;
      this.design = {
        ...compiled, session, status: "ready", compilation: "passed", observed: false, stale: false,
        tokens: listDesignTokens(files), selection: null,
      };
      await this.recordConversationVerification();
      this.sendState();
      return { session, entry, revision: compiled.revision };
    } catch (error) {
      if (generation !== this.designGeneration) return;
      this.design = { status: "error", entry, compilation: "failed", observed: false, tokens: [], error: error instanceof Error ? error.message : "The preview could not compile." };
      this.sendState();
    }
  }

  private async designObserved(message: any) {
    if (!this.project || !vscode.workspace.isTrusted || message.session !== this.design.session) return;
    if (message.event === "ready") this.design.observed = true;
    else if (message.event === "error") {
      this.design.observed = false;
      this.design.error = typeof message.error === "string" ? message.error.slice(0, 600) : "The preview could not render. Correct the source and reload.";
    } else if (message.event === "selection") {
      const selection = message.selection;
      if (selection === null) {
        if (message.intent === "select") this.focusGeneration++;
        this.design.selection = null; this.sendState(); return;
      }
      if (!selection || !validSourcePath(selection.path) || !this.design.mappings?.includes(selection.path)) return;
      const rect = selection.rect;
      if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(value => Number.isFinite(value) && Math.abs(value) < 100000)) return;
      const styles: Record<string, string> = {};
      for (const [key, value] of Object.entries(selection.styles || {}).slice(0, 32))
        if (typeof value === "string" && key.length < 64) styles[key] = value.slice(0, 200);
      this.design.selection = { path: selection.path, tag: String(selection.tag || "element").slice(0, 30), label: String(selection.label || "Selected element").slice(0, 160), rect, styles };
      // Resize/settings observations update measurements only. An explicit
      // product selection is the sole runtime event allowed to move focus.
      if (message.intent === "select") {
        const project = this.project;
        const session = this.design.session;
        const label = this.design.selection.label;
        const focusGeneration = ++this.focusGeneration;
        this.generation++;
        const file: ProjectFile = await this.diagnostics.runAsync("selected-source-read", () => this.service.getFile(project.id, selection.path));
        if (this.disposed || !vscode.workspace.isTrusted || this.project?.id !== project.id ||
          this.design.session !== session || this.focusGeneration !== focusGeneration) return;
        const snapshot = this.design.files?.find((item: any) => item.path === file.path);
        this.lastDocument = vscode.Uri.file(join(project.root, file.path));
        this.activeFile = file;
        this.openFiles = [file, ...this.openFiles.filter(item => item.path !== file.path)].slice(0, 8);
        this.focus = { path: file.path, label, origin: "preview",
          revision: snapshot?.revision, session };
        this.persistFocus();
        this.updateTree();
      }
    } else return;
    if (message.event === "ready" || message.event === "error") await this.recordConversationVerification();
    this.sendState();
  }

  private async proposeTokenChange(input: any) {
    const project = this.project, state = this.designImpactState(), owner = this.designImpactOwner;
    if (!vscode.workspace.isTrusted || !project || this.disposed) throw new Error("Open a trusted project before proposing a source edit.");
    if (!input || !validSourcePath(input.path) || !state || state.status !== "ready" || !state.id || input.impactId !== state.id ||
      state.result.target.kind !== "token" || state.result.target.path !== input.path || state.result.target.revision !== input.revision ||
      state.result.target.name !== input.name || state.result.target.occurrence !== input.occurrence)
      throw new Error("Inspect this token's current change impact before reviewing a source edit.");
    const generation = this.designImpactGeneration, id = state.id;
    const current = () => this.designImpactGeneration === generation && this.designImpactView?.id === id && this.designImpactOwnerCurrent(owner);
    const check = () => {
      if (!current()) throw new Error("The selected source or change impact changed. Inspect it again before reviewing a source edit.");
      if (this.dirtyPaths().includes(input.path)) throw new Error("This file has an unsaved native editor draft. Save or discard it before proposing a source edit.");
    };
    check(); await this.loadChangeSets(); check(); this.requireNoActiveChangeSet();
    if (!await this.service.validateChangeImpact(project.id, state.result, {isCurrent: current})) {
      if (current()) this.invalidateDesignImpact();
      throw new Error("Saved source changed. Inspect change impact again before reviewing a source edit.");
    }
    check();
    const file = await this.service.getFile(project.id, input.path); check();
    if (file.revision !== input.revision) { this.invalidateDesignImpact(); throw new Error("This token changed on disk. Reload the preview before proposing a source edit."); }
    const proposal = createTokenProposal({ file, name: input.name, occurrence: input.occurrence, value: input.value, projectId: project.id });
    proposal.designImpact = {version: 1, result: structuredClone(state.result), relatedScenarios: structuredClone(state.relatedScenarios)};
    const session = this.proposals();
    await session.set(proposal, {isCurrent: () => current() && !this.dirtyPaths().includes(input.path)});
    check(); this.show("Review"); this.sendState(); return proposal;
  }

  private async changeProposal(action: "apply" | "undo" | "discard", id: unknown) {
    if (!vscode.workspace.isTrusted || !this.project || typeof id !== "string") throw new Error("Choose a proposal in the trusted project.");
    if (this.alternativesBusy()) throw new Error("Stop the comparison before changing source proposals.");
    const project = this.project;
    this.proposalMutationCount = (this.proposalMutationCount || 0) + 1;
    this.proposalMutationGeneration = (this.proposalMutationGeneration || 0) + 1;
    try {
      if (action !== "discard") { await this.loadChangeSets(); this.requireNoActiveChangeSet(); }
      const proposal = await this.proposals()[action](id, project.id);
      if (action !== "discard") {
        if (this.design.files?.some((file: any) => file.path === proposal.path)) this.design.stale = true;
        const current = await this.service.getFile(project.id, proposal.path);
        const key = `${project.root}\0${proposal.path}`;
        if (action === "apply") this.savedChanges.set(key, { path: proposal.path, root: project.root, before: proposal.before, after: proposal.after, baseRevision: proposal.baseRevision, revision: current.revision });
        else this.savedChanges.delete(key);
        await this.refresh();
      }
      this.sendState();
      return proposal;
    } finally { this.proposalMutationCount--; this.sendState(); }
  }

  private async proposalDiff(id: unknown) {
    if (!this.project || !vscode.workspace.isTrusted) throw new Error("Open a trusted project first.");
    const proposal = this.proposals().current();
    if (!proposal || id !== proposal.id) throw new Error("Choose the current proposal.");
    const before = vscode.Uri.from({ scheme: "foundation-snapshot", path: `/before/${basename(proposal.path)}`, query: randomBytes(8).toString("hex") });
    const after = vscode.Uri.from({ scheme: "foundation-snapshot", path: `/proposed/${basename(proposal.path)}`, query: randomBytes(8).toString("hex") });
    this.snapshots.set(before.toString(), proposal.before);
    this.snapshots.set(after.toString(), proposal.after);
    await vscode.commands.executeCommand("vscode.diff", before, after, `${basename(proposal.path)} · before ↔ proposed`, { preview: true, viewColumn: vscode.ViewColumn.One });
  }

  inspect() {
    return {
      swiftLanguage: this.swiftLanguage?.inspect(), xcodeProject: this.xcodeProject?.inspect(), platformSetup: this.platformSetup?.inspect(), project: this.project, activeFile: this.activeFile, focus: this.focus, design: this.design, designImpact: this.designImpactState(), runtime: this.runtimeSnapshot(), proposal: this.project ? this.proposals().current() : null,
      inlineEdit: this.inlineEdit?.inspect() ?? { state: "idle" },
      codeSuggestions: this.codeSuggestions?.inspect() ?? { enabled: false, state: "off" },
      projectDecisions: this.projectDecisionsSnapshot(),
      reproducibleIssues: this.reproducibleIssuesSnapshot(),
      changeSetSession: this.changeSetSnapshot(),
      executionSession: this.executionSnapshot(),
      conversations: this.project && vscode.workspace.isTrusted ? this.conversations().snapshot() : null,
      aiAlternatives: this.aiAlternativesSnapshot(), features: this.featureSnapshot(), runtimeWorkspace: this.runtimeWorkspaceSnapshot(), runtimeCaptures: this.runtimeCapturesSnapshot(), runtimeReplays: this.runtimeReplaySnapshot(), runtimeMatrices: this.runtimeMatrixSnapshot(), runtimeStateSuites: this.runtimeStateSuiteSnapshot(), visualVerification: this.visualVerificationSnapshot(), visualAlternatives: this.visualAlternativesSnapshot(), featureFiles: this.featureFiles || [], featureUnavailable: this.featureUnavailable || [],
      featureRelationships: this.relationshipState(),
      sourceInvestigation: this.sourceInvestigationState(),
      investigationContinuation: this.investigationContinuationState(),
      assistantSurface: this.assistantSurface(), workspaceMode: this.mode };
  }

  private async navigate(path: unknown, line?: unknown) {
    if (!vscode.workspace.isTrusted || !this.project || !validSourcePath(path))
      throw new Error(
        "Choose a supported source file in the trusted workspace.",
      );
    const file = await this.service.getFile(this.project.id, path);
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(join(this.project.root, file.path)),
    );
    const target = Math.min(document.lineCount, validLine(line)) - 1;
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: this.sourceColumn(),
      preserveFocus: false,
      selection: new vscode.Range(target, 0, target, 0),
    });
    editor.revealRange(
      new vscode.Range(target, 0, target, 0),
      vscode.TextEditorRevealType.InCenter,
    );
    this.lastDocument = document.uri;
    this.queueRefresh();
  }

  private async recordSave(document: vscode.TextDocument) {
    if (
      !this.project ||
      !vscode.workspace.isTrusted ||
      document.uri.scheme !== "file"
    )
      return;
    const project = this.project,
      path = relativeSourcePath(project.root, document.uri.fsPath);
    if (!path) return;
    const key = `${project.root}\0${path}`,
      before = this.pendingSaves.get(key);
    this.pendingSaves.delete(key);
    if (!before) {
      this.queueRefresh();
      return;
    }
    const after: ProjectFile = await this.service.getFile(project.id, path);
    const prior = this.savedChanges.get(key);
    const baseline =
      prior?.after === before.source
        ? { source: prior.before, revision: prior.baseRevision }
        : before;
    if (after.source === baseline.source) this.savedChanges.delete(key);
    else
      this.savedChanges.set(key, {
        path,
        root: project.root,
        before: baseline.source,
        after: after.source,
        baseRevision: baseline.revision,
        revision: after.revision,
      });
    await this.refresh();
  }

  private async reviewFile(path: unknown) {
    if (!this.project || !validSourcePath(path))
      throw new Error("Choose a changed source file.");
    const change = this.savedChanges.get(`${this.project.root}\0${path}`);
    if (!change)
      throw new Error(
        "No changes to this file were captured in this session. Use Source Control for Git changes.",
      );
    const current: ProjectFile = await this.service.getFile(
      this.project.id,
      path,
    );
    const uri = vscode.Uri.from({
      scheme: "foundation-snapshot",
      path: `/${basename(change.path)}`,
      query: randomBytes(8).toString("hex"),
    });
    this.snapshots.set(uri.toString(), change.before);
    await vscode.commands.executeCommand(
      "vscode.diff",
      uri,
      vscode.Uri.file(join(this.project.root, change.path)),
      `${basename(change.path)} · session before ↔ current${current.revision !== change.revision ? " (changed externally)" : ""}`,
      { preview: true, viewColumn: vscode.ViewColumn.One },
    );
  }

  private resolveGroupRevision(input: any) {
    if (input === undefined) return undefined;
    const descriptor = groupRevisionDescriptor(input);
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted || this.disposed) throw new Error("Open the original trusted project before refining a group.");
    const session = this.changeSets(), checkpoint = session.snapshot(), group = checkpoint.current;
    if (this.aiAlternativeOwner(group,project)) throw new Error("Compare this candidate before adopting or refining it.");
    const store = this.conversations(project), history = store.snapshot();
    const conversation = history.conversations.find(chat => chat.id === descriptor.conversationId && chat.id === history.activeId);
    const turn = conversation?.turns.find(item => item.requestId === descriptor.requestId);
    if (checkpoint.busy || checkpoint.storage.status !== "saved" || history.storage.status !== "saved")
      throw new Error("Save the current change group and conversation before preparing a revision.");
    if (!group || group.status !== "proposed" || group.id !== descriptor.groupId || group.revision !== descriptor.groupRevision ||
      changeGroupDigest(group) !== descriptor.groupDigest || !conversation || conversation.archived || turn?.state !== "complete" ||
      turn.completedWhileStopping || turn.intent !== "build" || !turn.changeSet || turn.changeSet.id !== group.id ||
      turn.requestId !== group.requestId || changeGroupDigest(turn.changeSet) !== descriptor.groupDigest)
      throw new Error("Choose the current staged group in its completed, active conversation.");
    if (this.executionSnapshot()?.busy) throw new Error("Stop the isolated check before refining its source group.");
    if (this.proposals().current()?.status === "applied") throw new Error("Undo or dismiss the applied proposal before refining a group.");
    return {project, session, store, conversation, turn, group, snapshot: descriptor};
  }

  private groupRevisionOwnerCurrent(binding: NonNullable<ReturnType<FoundationHost["resolveGroupRevision"]>>) {
    if (this.disposed || !vscode.workspace.isTrusted || this.project?.id !== binding.project.id || this.project.root !== binding.project.root) return false;
    const history = binding.store.snapshot(), checkpoint = binding.session.snapshot();
    const conversation = history.conversations.find(chat => chat.id === binding.conversation.id && chat.id === history.activeId);
    const turn = conversation?.turns.find(item => item.requestId === binding.turn.requestId), group = checkpoint.current;
    return history.storage.status === "saved" && checkpoint.storage.status === "saved" && !checkpoint.busy && Boolean(conversation && !conversation.archived &&
      turn?.state === "complete" && !turn.completedWhileStopping && turn.changeSet && changeGroupDigest(turn.changeSet) === binding.snapshot.groupDigest &&
      group?.status === "proposed" && group.id === binding.group.id && group.revision === binding.group.revision && changeGroupDigest(group) === binding.snapshot.groupDigest);
  }

  private async readGroupRevisionSources(binding: NonNullable<ReturnType<FoundationHost["resolveGroupRevision"]>>, current: () => boolean) {
    const files: ProjectFile[] = []; let bytes = 0;
    const check = () => {
      if (!current()) throw new Error("This group revision changed. Prepare it again from the current group.");
      if (this.dirtyPaths().some(path => binding.turn.context.some(source => source.path === path)))
        throw new Error("A contributing source has an unsaved draft. Preserve or resolve it before refining this group.");
    };
    for (const source of binding.turn.context) {
      check();
      const file: ProjectFile = await this.service.getFile(binding.project.id, source.path);
      check();
      if (file.path !== source.path || file.revision !== source.revision || file.source !== source.source)
        throw new Error("The group's original source changed. Its previous snapshots are preserved; prepare a new group from current source.");
      bytes += Buffer.byteLength(file.source, "utf8");
      if (bytes > 65536) throw new Error("The group's source basis exceeds the 64 KiB context limit.");
      files.push(file);
    }
    check();
    // The overlay is only provider input. Saved source and freshness stay based on disk.
    stagedGroupSources({group: binding.group, files, projectId: binding.project.id});
    return files;
  }

  private async resolveProviderGroupRevision(input: any) {
    const active = this.asking, project = this.project;
    if (!active || !project || input.projectId !== project.id || !active.groupRevision || active.abort.signal.aborted)
      throw new Error("The staged source request is no longer active.");
    const {projectId: _projectId, ...descriptor} = input;
    if (JSON.stringify(groupRevisionDescriptor(descriptor)) !== JSON.stringify(active.groupRevision))
      throw new Error("The provider request does not own this staged source selection.");
    await active.store.flush();
    const binding = this.resolveGroupRevision(descriptor)!;
    const current = () => this.asking === active && !active.abort.signal.aborted && active.groupGuard?.() !== false && this.groupRevisionOwnerCurrent(binding);
    await this.readGroupRevisionSources(binding, current);
    if (!current()) throw new Error("The staged group is no longer current.");
    return binding.group;
  }

  private async groupRevisionAction(message: any, surface: Surface) {
    const view = this.assistantView, project = this.project;
    if (surface !== "assistant" || !view || !project) return;
    const generation = this.groupRevisionGeneration = (this.groupRevisionGeneration || 0) + 1;
    const featureId = this.featureSnapshot()?.activeId ?? null;
    const canReply = () => generation === this.groupRevisionGeneration && this.assistantView === view && !this.disposed &&
      vscode.workspace.isTrusted && this.project?.id === project.id && this.project.root === project.root &&
      (this.featureSnapshot()?.activeId ?? null) === featureId && this.conversations(project).snapshot().activeId === message.conversationId;
    try {
      if (message.action !== "prepare" || message.projectId !== project.id || message.featureId !== featureId ||
        typeof message.prepareId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(message.prepareId))
        throw new Error("Choose a staged group in this trusted workspace.");
      if (this.asking) throw new Error("Stop the current response before refining a group.");
      await this.loadChangeSets();
      if (!canReply() || this.asking) return;
      const checkpoint = this.changeSetSnapshot(), group = checkpoint?.current;
      if (checkpoint?.acceptance) throw new Error("Use the whole proposal before refining this group.");
      if (!group || group.id !== message.groupId || group.revision !== message.expectedGroupRevision)
        throw new Error("The staged group changed. Open its current version before refining it.");
      const binding = this.resolveGroupRevision({version: 1, conversationId: message.conversationId, requestId: message.requestId,
        groupId: group.id, groupRevision: group.revision, groupDigest: changeGroupDigest(group)})!;
      const epoch = this.featureSourceEpoch || 0;
      const owner = {requestId: message.prepareId, projectId: project.id, featureId, conversationId: binding.conversation.id,
        paths: binding.turn.context.map(source => source.path)};
      this.assistantRestoreGeneration = (this.assistantRestoreGeneration || 0) + 1;
      this.assistantContextRestore = owner; this.assistantContextFiles = []; this.assistantContextEpoch = -1;
      const current = () => canReply() && !this.asking && this.assistantContextRestore === owner && epoch === (this.featureSourceEpoch || 0) && this.groupRevisionOwnerCurrent(binding);
      const files = await this.readGroupRevisionSources(binding, current);
      if (!current()) return;
      this.assistantContextFiles = files; this.assistantContextEpoch = epoch;
      const sharedFiles = stagedGroupSources({group: binding.group, files, projectId: project.id}).map((file: any) => ({
        path: file.path, revision: file.revision, source: file.source, lines: file.source.split("\n").length,
        origin: binding.group.files.some((target: any) => target.path === file.path) ? "staged" : "saved"}));
      this.sendState();
      void view.webview.postMessage({type: "groupRevisionPrepared", projectId: project.id, featureId,
        conversationId: binding.conversation.id, requestId: binding.turn.requestId, groupId: group.id,
        expectedGroupRevision: group.revision, prepareId: message.prepareId, groupRevision: binding.snapshot,
        files: files.map(({path, revision}) => ({path, revision})), sharedFiles});
    } catch (caught) {
      if (canReply()) { this.sendState(); void view.webview.postMessage({type: "groupRevisionResult", projectId: project.id, featureId,
        conversationId: message.conversationId, requestId: message.requestId, groupId: message.groupId,
        expectedGroupRevision: message.expectedGroupRevision, prepareId: message.prepareId,
        error: caught instanceof Error ? caught.message : "This group could not be prepared. Its snapshots are preserved."}); }
    }
  }

  private checkCatalog(record: any) {
    const labels: Record<string,string> = {"node:test":"Node tests", "typescript:check":"TypeScript check"};
    if (!record || !Array.isArray(record.tasks) || !record.tasks.length || record.tasks.length > 2 ||
      record.tasks.some((task: any) => !labels[task.id]) || new Set(record.tasks.map((task: any) => task.id)).size !== record.tasks.length)
      throw new Error("Prepare a workspace with supported checks before asking for a suggestion.");
    return record.tasks.map((task: any) => ({id:task.id, label:labels[task.id]}));
  }

  private resolveCheckContext(input: any) {
    if (input === undefined) return undefined;
    const snapshot = normalizeCheckContext(input);
    if (!this.wholeChangeSetScope()) throw new Error("Check suggestions use the whole proposal. Select every unit before preparing a suggestion.");
    const binding = this.resolveGroupRevision({version:1, conversationId:snapshot.conversationId, requestId:snapshot.requestId,
      groupId:snapshot.groupId, groupRevision:snapshot.groupRevision, groupDigest:snapshot.groupDigest})!;
    const execution = this.executions().snapshot(), record = execution.current;
    if (execution.busy || execution.storage.status !== "saved" || !record || record.status !== "ready" ||
      record.groupId !== snapshot.groupId || record.groupRevision !== snapshot.groupRevision || record.groupDigest !== snapshot.groupDigest ||
      record.snapshotRevision !== snapshot.snapshotRevision || JSON.stringify(this.checkCatalog(record)) !== JSON.stringify(snapshot.tasks))
      throw new Error("Prepare the same staged workspace again to confirm this suggestion's source and supported checks.");
    const plans = this.checkPlanSessions?.get(binding.project.id)?.snapshot();
    if (!plans || plans.storage.status !== "saved" || plans.busy || plans.current && !["completed","ended"].includes(plans.current.status))
      throw new Error("Finish or end the saved check plan before preparing another suggestion.");
    return {...binding, checkContext:snapshot, executionId:record.id, executionRevision:record.revision};
  }

  private checkContextCurrent(binding: NonNullable<ReturnType<FoundationHost["resolveCheckContext"]>>, recommendation?: any) {
    if (!this.wholeChangeSetScope() || !this.groupRevisionOwnerCurrent(binding)) return false;
    const execution = this.executions().snapshot(), record = execution.current, plans = this.checkPlanSessions?.get(binding.project.id)?.snapshot();
    try { return Boolean(record && !execution.busy && execution.storage.status === "saved" && record.status === "ready" &&
      record.id === binding.executionId && record.revision === binding.executionRevision && record.groupId === binding.group.id &&
      record.groupRevision === binding.group.revision && record.groupDigest === binding.checkContext.groupDigest &&
      record.snapshotRevision === binding.checkContext.snapshotRevision && JSON.stringify(this.checkCatalog(record)) === JSON.stringify(binding.checkContext.tasks) &&
      (plans?.storage.status === "saved" || recommendation && plans?.busy && plans.storage.status === "saving") && (recommendation || !plans?.busy) &&
      (!plans?.current || ["completed","ended"].includes(plans.current.status) || recommendation && JSON.stringify(plans.current.recommendation) === JSON.stringify(recommendation))); }
    catch { return false; }
  }

  private async resolveProviderCheckContext(input: any) {
    const active = this.asking, project = this.project;
    if (!active || !project || input.projectId !== project.id || !active.checkContext || active.abort.signal.aborted)
      throw new Error("The check suggestion request is no longer active.");
    const {projectId: _projectId, ...descriptor} = input;
    if (JSON.stringify(normalizeCheckContext(descriptor)) !== JSON.stringify(active.checkContext))
      throw new Error("The request does not own these staged sources or supported checks.");
    await active.store.flush();
    const binding = this.resolveCheckContext(descriptor)!;
    const current = () => this.asking === active && !active.abort.signal.aborted && active.checkGuard?.() !== false && this.checkContextCurrent(binding);
    await this.readGroupRevisionSources(binding, current);
    if (!current()) throw new Error("The check suggestion context changed.");
    return {context:binding.checkContext, group:binding.group};
  }

  private async checkSuggestionAction(message: any, surface: Surface) {
    const view = this.assistantView, project = this.project;
    if (surface !== "assistant" || !view || !project) return;
    const generation = this.checkSuggestionGeneration = (this.checkSuggestionGeneration || 0) + 1;
    const featureId = this.featureSnapshot()?.activeId ?? null, epoch = this.featureSourceEpoch || 0;
    const canReply = () => generation === this.checkSuggestionGeneration && this.assistantView === view && !this.disposed &&
      vscode.workspace.isTrusted && this.project?.id === project.id && this.project.root === project.root &&
      this.conversations(project).snapshot().activeId === message.conversationId;
    const current = () => canReply() && !this.asking && epoch === (this.featureSourceEpoch || 0) &&
      (this.featureSnapshot()?.activeId ?? null) === featureId;
    const reply = (extra: any) => { if (canReply()) { this.sendState(); void view.webview.postMessage({type:"checkSuggestionResult",action:message.action,
      projectId:project.id,featureId,conversationId:message.conversationId,requestId:message.requestId,artifactId:message.artifactId,
      prepareId:message.prepareId,...extra}); } };
    try {
      if (message.projectId !== project.id || !vscode.workspace.isTrusted || this.disposed || !["prepare","save","dismiss","open"].includes(message.action))
        throw new Error("Choose a check suggestion in this trusted workspace.");
      const store = this.conversations(project), history = store.snapshot();
      const conversation = history.conversations.find(chat => chat.id === message.conversationId && chat.id === history.activeId && !chat.archived);
      const turn = conversation?.turns.find(item => item.requestId === message.requestId);
      if (history.storage.status !== "saved" || !conversation || !turn || turn.state !== "complete" || turn.completedWhileStopping)
        throw new Error("Open the completed result in its saved conversation.");
      if (this.asking) throw new Error("Finish the current response before choosing a check suggestion.");
      await this.loadChangeSets();
      await this.executions().load();
      const plans = this.checkPlans(); await plans.load();
      if (!current()) return;
      if (message.action === "prepare") {
        if (message.featureId !== featureId || typeof message.prepareId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(message.prepareId))
          throw new Error("Prepare this suggestion again from its current group.");
        const group = this.changeSetSnapshot()?.current, record = this.executions().snapshot().current;
        if (!group || group.id !== message.changeSetId || group.revision !== message.expectedGroupRevision ||
          !record || record.id !== message.executionId || record.revision !== message.expectedExecutionRevision)
          throw new Error("The group or prepared copy changed. Review the current workspace before asking.");
        const binding = this.resolveCheckContext({version:1,conversationId:conversation.id,requestId:turn.requestId,
          groupId:group.id,groupRevision:group.revision,groupDigest:changeGroupDigest(group),snapshotRevision:record.snapshotRevision,tasks:this.checkCatalog(record)})!;
        const owner = {requestId:message.prepareId,projectId:project.id,featureId,conversationId:conversation.id,paths:turn.context.map(source => source.path)};
        this.assistantRestoreGeneration = (this.assistantRestoreGeneration || 0) + 1;
        this.assistantContextRestore = owner; this.assistantContextFiles = []; this.assistantContextEpoch = -1;
        const prepared = () => current() && this.assistantContextRestore === owner && this.checkContextCurrent(binding);
        const files = await this.readGroupRevisionSources(binding, prepared);
        if (!prepared()) return;
        this.assistantContextFiles = files; this.assistantContextEpoch = epoch;
        const sharedFiles = stagedGroupSources({group,files,projectId:project.id}).map((file: any) => ({path:file.path,revision:file.revision,source:file.source,
          lines:file.source.split("\n").length,origin:group.files.some((target: any) => target.path === file.path) ? "staged" : "saved"}));
        this.sendState();
        void view.webview.postMessage({type:"checkSuggestionPrepared",prepareId:message.prepareId,projectId:project.id,featureId,
          conversationId:conversation.id,requestId:turn.requestId,checkContext:binding.checkContext,
          prompt:"Recommend the supported checks that are useful for this staged change. Explain each choice and any verification gaps.",
          context:turn.context,sharedFiles});
        return;
      }
      if (!turn.checkContext || !turn.checkSuggestion || turn.checkSuggestion.id !== message.artifactId)
        throw new Error("Choose the saved check suggestion before deciding.");
      const artifact = validateCheckSuggestion(turn.checkSuggestion, turn.checkContext, project.id);
      const recommendation = {conversationId:conversation.id,requestId:turn.requestId,artifactId:artifact.id,artifactDigest:checkSuggestionDigest(artifact)};
      const linked = [plans.snapshot().current,...plans.snapshot().history].find(plan => plan?.recommendation &&
        JSON.stringify(plan.recommendation) === JSON.stringify(recommendation));
      if (message.action === "open" || message.action === "save" && linked) {
        if (!linked) throw new Error("This suggestion has no saved check plan.");
        if (message.action === "save" && (plans.snapshot().storage.status !== "saved" ||
          JSON.stringify(message.taskIds) !== JSON.stringify(linked.steps.map((step: any) => step.task.id))))
          throw new Error("This suggestion already created a plan. Inspect its saved selection or retry plan storage; it cannot create another plan.");
        reply({passed:true,planId:linked.id,changeSetId:linked.groupId}); return;
      }
      if (message.action === "dismiss") {
        if (linked) throw new Error("This suggestion already has a saved plan. Use its End plan decision instead.");
        await store.dismissCheckSuggestion({conversationId:conversation.id,requestId:turn.requestId,artifactId:artifact.id});
        reply({passed:true}); return;
      }
      if (turn.checkDismissed) throw new Error("This suggestion was dismissed. Prepare a new suggestion from the current group.");
      const binding = this.resolveCheckContext(turn.checkContext)!;
      if (message.changeSetId !== binding.group.id || message.expectedGroupRevision !== binding.group.revision ||
        message.executionId !== binding.executionId || message.expectedExecutionRevision !== binding.executionRevision)
        throw new Error("The prepared workspace changed. Review the current copy before saving this plan.");
      const guard = async () => {
        if (!current() || !this.checkContextCurrent(binding, recommendation)) throw new Error("The suggestion's project, group or prepared source changed.");
        const saved = store.snapshot(), owner = saved.conversations.find(chat => chat.id === conversation.id && chat.id === saved.activeId && !chat.archived);
        const latest = owner?.turns.find(item => item.requestId === turn.requestId);
        if (saved.storage.status !== "saved" || latest?.state !== "complete" || latest.completedWhileStopping || latest.checkDismissed ||
          !latest.checkSuggestion || checkSuggestionDigest(latest.checkSuggestion) !== recommendation.artifactDigest)
          throw new Error("Save the current, completed suggestion before creating its check plan.");
        await this.readGroupRevisionSources(binding, () => current() && this.checkContextCurrent(binding, recommendation));
        if (!current()) throw new Error("This saved-plan decision was superseded.");
      };
      await guard();
      const result = await plans.create({executionId:binding.executionId,expectedExecutionRevision:binding.executionRevision,taskIds:message.taskIds,recommendation},{guard});
      const saved = [result.current,...result.history].find(plan => plan?.recommendation && JSON.stringify(plan.recommendation) === JSON.stringify(recommendation));
      if (!saved || result.storage.status !== "saved") throw new Error("The plan's saved outcome needs attention. Retry plan storage before another decision.");
      reply({passed:true,planId:saved.id,changeSetId:saved.groupId});
    } catch (caught) { reply({passed:false,error:caught instanceof Error ? caught.message : "This check suggestion could not be updated."}); }
  }

  private resolveRequestRevision(input: any) {
    if (input === undefined) return undefined;
    const token = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
    if (!input || typeof input !== "object" || Array.isArray(input) || input.version !== 1 ||
      Object.keys(input).some(key => !["version", "conversationId", "requestId"].includes(key)) ||
      !token(input.conversationId) || !token(input.requestId))
      throw new Error("Choose a saved request before revising it.");
    const project = this.project;
    if (!project || !vscode.workspace.isTrusted || this.disposed) throw new Error("Open the original trusted project before revising a request.");
    const store = this.conversations(project), history = store.snapshot();
    const conversation = history.conversations.find(chat => chat.id === input.conversationId && chat.id === history.activeId);
    const turn = conversation?.turns.find(item => item.requestId === input.requestId);
    if (history.storage.status !== "saved") throw new Error("Save conversation history before revising a request. Retry local storage if needed.");
    if (!conversation || conversation.archived || !turn || !["complete", "stopped", "failed", "interrupted"].includes(turn.state))
      throw new Error("Choose a finished, saved request in the active conversation.");
    if (turn.investigationContext) throw new Error("Continue from the latest investigation checkpoint to preserve its budget and evidence.");
    if (turn.sourceInvestigation) throw new Error("Refresh a source investigation to ask about its current saved evidence.");
    if (turn.checkContext) throw new Error("This request suggested checks for staged source. Prepare a new suggestion from its current group.");
    if (turn.alternativeGeneration) throw new Error("Prepare a new alternatives brief with its current saved scope.");
    if (turn.groupRevision) throw new Error("This request refined staged source. Use Refine group on the current group to preserve that source context.");
    if (turn.planContext) throw new Error("This request came from a plan step. Prepare that step again from its saved plan.");
    return { project, store, conversation, turn,
      snapshot: { version: 1 as const, conversationId: conversation.id, requestId: turn.requestId } };
  }

  private requestRevisionOwnerCurrent(binding: NonNullable<ReturnType<FoundationHost["resolveRequestRevision"]>>) {
    if (this.disposed || !vscode.workspace.isTrusted || this.project?.id !== binding.project.id || this.project.root !== binding.project.root) return false;
    const history = binding.store.snapshot();
    const conversation = history.conversations.find(chat => chat.id === binding.conversation.id && chat.id === history.activeId);
    const turn = conversation?.turns.find(item => item.requestId === binding.turn.requestId);
    return history.storage.status === "saved" && Boolean(conversation && !conversation.archived && turn && !turn.planContext &&
      ["complete", "stopped", "failed", "interrupted"].includes(turn.state) &&
      JSON.stringify([turn.question, turn.intent, turn.context]) === JSON.stringify([binding.turn.question, binding.turn.intent, binding.turn.context]));
  }

  private async readRequestRevisionSources(binding: NonNullable<ReturnType<FoundationHost["resolveRequestRevision"]>>, current: () => boolean) {
    const files: ProjectFile[] = [];
    let bytes = 0;
    const check = () => {
      if (!current()) throw new Error("This request preparation changed. Reopen the saved request to try again.");
      if (this.dirtyPaths().some(path => binding.turn.context.some(source => source.path === path)))
        throw new Error("A selected source has an unsaved draft. Preserve or resolve that draft before revising this request.");
    };
    for (const source of binding.turn.context) {
      check();
      let file: ProjectFile;
      try { file = await this.service.getFile(binding.project.id, source.path); }
      catch { throw new Error("Saved source is unavailable. Restore the file or start a new request with current source."); }
      check();
      if (file.path !== source.path || file.revision !== source.revision || file.source !== source.source)
        throw new Error("Saved source changed since this request. Start a new request with current source instead.");
      bytes += Buffer.byteLength(file.source, "utf8");
      if (bytes > 65536) throw new Error("The saved request exceeds the 64 KiB source limit. Start a smaller request.");
      files.push(file);
    }
    check();
    return files;
  }

  private async requestRevisionAction(message: any, surface: Surface) {
    const view = this.assistantView, project = this.project;
    if (surface !== "assistant" || !view || !project) return;
    const generation = this.requestRevisionGeneration = (this.requestRevisionGeneration || 0) + 1;
    const featureId = this.featureSnapshot()?.activeId ?? null;
    const canReply = () => generation === this.requestRevisionGeneration && this.assistantView === view && !this.disposed &&
      vscode.workspace.isTrusted && this.project?.id === project.id && this.project.root === project.root &&
      (this.featureSnapshot()?.activeId ?? null) === featureId && this.conversations(project).snapshot().activeId === message.conversationId;
    try {
      if (message.projectId !== project.id || message.featureId !== featureId || !vscode.workspace.isTrusted || this.disposed ||
        typeof message.prepareId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(message.prepareId) ||
        !["prepare", "stopAndPrepare"].includes(message.action)) throw new Error("Choose a request in this trusted workspace.");
      const store = this.conversations(project), history = store.snapshot();
      const conversation = history.conversations.find(chat => chat.id === message.conversationId && chat.id === history.activeId && !chat.archived);
      if (!conversation) throw new Error("Choose a request in the active conversation.");
      if (message.action === "stopAndPrepare") {
        const active = this.asking;
        if (!active || active.requestId !== message.requestId || active.projectId !== project.id || active.store !== store ||
          active.conversationId !== conversation.id) throw new Error("That response is no longer running. Choose Revise request from its saved result.");
        // Retire this exact stream before waiting for storage. Late provider
        // events cannot create a proposal or affect a later request.
        this.cancelQuestion(active.requestId);
        await store.flush();
      } else if (this.asking) throw new Error("Stop the current response before preparing a saved request.");
      if (!canReply() || this.asking) return;
      const binding = this.resolveRequestRevision({version: 1, conversationId: message.conversationId, requestId: message.requestId})!;
      const epoch = this.featureSourceEpoch || 0;
      const owner = {requestId: message.prepareId, projectId: project.id, featureId, conversationId: conversation.id,
        paths: binding.turn.context.map(source => source.path)};
      this.assistantRestoreGeneration = (this.assistantRestoreGeneration || 0) + 1;
      this.assistantContextRestore = owner; this.assistantContextFiles = []; this.assistantContextEpoch = -1;
      const current = () => canReply() && !this.asking && this.assistantContextRestore === owner &&
        epoch === (this.featureSourceEpoch || 0) && this.requestRevisionOwnerCurrent(binding);
      const files = await this.readRequestRevisionSources(binding, current);
      if (!current()) return;
      this.assistantContextFiles = files; this.assistantContextEpoch = epoch;
      this.sendState();
      void view.webview.postMessage({type: "requestRevisionPrepared", projectId: project.id, featureId,
        conversationId: conversation.id, requestId: binding.turn.requestId, prepareId: message.prepareId,
        requestRevision: binding.snapshot, prompt: binding.turn.question, intent: binding.turn.intent,
        files: files.map(({path, revision}) => ({path, revision}))});
    } catch (caught) {
      if (canReply()) {
        this.sendState();
        void view.webview.postMessage({type: "requestRevisionResult", projectId: project.id, featureId,
          conversationId: message.conversationId, requestId: message.requestId, prepareId: message.prepareId,
          error: caught instanceof Error ? caught.message : "This saved request could not be prepared."});
      }
    }
  }

  private async ask(message: any) {
    const requestId = message.requestId;
    const intent = assistantIntent(message.intent);
    if (typeof requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId))
      throw new Error("This question could not be started. Reopen Assistant and try again.");
    if (this.asking?.requestId === requestId) return;
    if (!vscode.workspace.isTrusted || !this.project)
      throw new Error("Open and trust a local project before sharing source.");
    if (this.asking) throw new Error("Stop the current response before sending another message.");
    if (this.continuationBusy) throw new Error("Stop or finish the local investigation before sending another request.");
    if (this.changeSetSnapshot()?.busy) throw new Error("Wait for the current checkpoint operation to finish before sending another request.");
    if (intent === "build" && this.executionSnapshot()?.busy) throw new Error("Stop the isolated check before starting another Build.");
    if (message.projectId !== undefined && message.projectId !== this.project.id)
      throw new Error("The project changed. Review the selected files before sending again.");
    if (intent === "build" && this.proposals().current()?.status === "applied")
      throw new Error("Undo or dismiss the applied proposal before preparing another change.");
    if (!this.assistant?.status().configured)
      throw new Error("Set up AI before sending a message.");
    if (typeof message.prompt !== "string" || !message.prompt.trim() || message.prompt.length > 6000 ||
      !Array.isArray(message.context) || message.context.length < 1 || message.context.length > 8 ||
      !intent)
      throw new Error("Enter a question and select up to eight saved source files.");
    const continuationBinding = this.resolveInvestigationContinuation(message.investigationContinuation);
    if (continuationBinding && (intent !== "plan" || ["sourceInvestigation","planContext","requestRevision","groupRevision","checkContext","taskContext","runtimeContext"].some(key => message[key] !== undefined) ||
      message.context.length !== 1 || message.context[0]?.path !== continuationBinding.context.result.anchor.path || message.context[0]?.revision !== continuationBinding.context.result.anchor.revision))
      throw new Error("An investigation checkpoint shares only its disclosed evidence and anchor source in Plan mode.");
    const investigationBinding = this.resolveSourceInvestigation(message.sourceInvestigation);
    if (investigationBinding && (intent !== "ask" || ["planContext","requestRevision","groupRevision","checkContext","taskContext","runtimeContext"].some(key => message[key] !== undefined) ||
      message.context.length !== 1 || message.context[0]?.path !== investigationBinding.result.anchor.path || message.context[0]?.revision !== investigationBinding.result.anchor.revision))
      throw new Error("A source investigation shares only its anchor source and disclosed findings in Ask mode.");
    const checkBinding = this.resolveCheckContext(message.checkContext);
    if (checkBinding && (intent !== "plan" || message.planContext !== undefined || message.requestRevision !== undefined ||
      message.groupRevision !== undefined || message.taskContext !== undefined || message.runtimeContext !== undefined ||
      message.context.length !== checkBinding.turn.context.length || message.context.some((source: any,index: number) =>
        source?.path !== checkBinding.turn.context[index].path || source?.revision !== checkBinding.turn.context[index].revision)))
      throw new Error("A check suggestion shares only its complete staged source basis and supported check names in Plan mode.");
    const alternativeGeneration=this.resolveAlternativeGeneration(message.alternativeGeneration);
    if(alternativeGeneration && (intent!=="build" || ["planContext","requestRevision","groupRevision","checkContext","sourceInvestigation","investigationContinuation","taskContext","runtimeContext","decisionContext","issueContext"].some(key=>message[key]!==undefined)))
      throw new Error("Generate alternatives uses Build with one saved scope, selected source and your design brief.");
    const groupBinding = this.resolveGroupRevision(message.groupRevision);
    if (groupBinding && this.changeSetSnapshot()?.acceptance) throw new Error("Use the whole proposal before refining this group.");
    if (groupBinding && (intent !== "build" || message.planContext !== undefined || message.requestRevision !== undefined ||
      message.context.length !== groupBinding.turn.context.length || message.context.some((source: any, index: number) =>
        source?.path !== groupBinding.turn.context[index].path || source?.revision !== groupBinding.turn.context[index].revision)))
      throw new Error("A group revision uses Build and its complete original source basis. Remove the revision context to start a different request.");
    const revisionBinding = this.resolveRequestRevision(message.requestRevision);
    if (revisionBinding && (message.planContext !== undefined || intent !== revisionBinding.turn.intent ||
      message.context.length !== revisionBinding.turn.context.length || message.context.some((source: any, index: number) =>
        source?.path !== revisionBinding.turn.context[index].path || source?.revision !== revisionBinding.turn.context[index].revision)))
      throw new Error("This revision must use its original mode and saved source selection. Remove the revision context to start a different request.");
    const dirty = this.dirtyPaths();
    const seen = new Set<string>();
    for (const item of message.context) {
      if (!item || seen.has(item.path) || ![...this.openFiles, ...(this.featureFiles || []), ...this.currentAssistantContextFiles(), ...this.currentArtifactSourceFiles()].some(file => file.path === item.path && file.revision === item.revision))
        throw new Error("Source context changed. Refresh and select the saved files again.");
      seen.add(item.path);
      if (dirty.includes(item.path))
        throw new Error("Save changes to the selected file before sharing it with AI.");
    }
    const project = this.project;
    const projectId = project.id;
    if (message.planContext !== undefined && intent !== "build") throw new Error("A plan step can only accompany Build.");
    const planBinding = this.resolvePlanContext(message.planContext);
    if (planBinding && (message.context.length !== 1 || message.context[0].path !== planBinding.path))
      throw new Error("This Build step requires its one referenced source file. Prepare the step again to review its context.");
    if(message.decisionContext!==undefined && ["planContext","requestRevision","groupRevision","checkContext","sourceInvestigation","investigationContinuation"].some(key=>message[key]!==undefined))
      throw new Error("Decisions can only accompany an ordinary Ask, Plan, Build or Review request.");
    if(message.issueContext!==undefined && ["planContext","requestRevision","groupRevision","checkContext","sourceInvestigation","investigationContinuation"].some(key=>message[key]!==undefined))
      throw new Error("Captured issues can only accompany an ordinary Ask, Plan, Build or Review request.");
    let issueContext:Awaited<ReturnType<FoundationHost["resolveIssueContext"]>>;
    let decisionContext:Awaited<ReturnType<FoundationHost["resolveDecisionContext"]>>;
    const taskContext = this.resolveTaskContext(message.taskContext);
    const runtimeEvidence = message.runtimeContext === undefined ? [] : normalizeRuntimeEvidence(this.resolveRuntimeEvidence({ projectId, ...message.runtimeContext }), message.runtimeContext);
    const store = this.conversations(project);
    const history = this.conversationPresentation(store).snapshot;
    const activeId = history.activeId;
    if (history.conversations.some(chat => chat.turns.some(turn => turn.requestId === requestId)))
      throw new Error("This request was already sent. Start a new message.");
    if ((message.conversationId ?? null) !== activeId)
      throw new Error("The conversation changed. Review your message before sending again.");
    const generation = ++this.askGeneration;
    const abort = new AbortController();
    const request: NonNullable<FoundationHost["asking"]> = { requestId, abort, terminal: false, projectId, conversationId: activeId, store, durable: false };
    let firstDeltaSent = false;
    const clearProgress = () => {
      if (request.progressTimer) clearTimeout(request.progressTimer);
      request.progressTimer = undefined;
    };
    // Reserve ownership before the first disk/persistence await so double clicks
    // and stale frames cannot start overlapping requests.
    this.asking = request;
    if(alternativeGeneration)request.alternativeGeneration=alternativeGeneration;
    this.groupRevisionGeneration = (this.groupRevisionGeneration || 0) + 1;
    if (groupBinding) request.groupRevision = groupBinding.snapshot;
    this.checkSuggestionGeneration = (this.checkSuggestionGeneration || 0) + 1;
    if (checkBinding) request.checkContext = checkBinding.checkContext;
    if (investigationBinding) request.sourceInvestigation = sourceInvestigationDescriptor(investigationBinding.result);
    if (continuationBinding) request.investigationContinuation = investigationContextDescriptor(continuationBinding.context);
    this.requestRevisionGeneration = (this.requestRevisionGeneration || 0) + 1;
    const revisionSourceEpoch = this.featureSourceEpoch || 0;
    const groupFeatureId = groupBinding || checkBinding ? this.featureSnapshot()?.activeId ?? null : null;
    if (groupBinding || checkBinding) {
      this.assistantContextRestore = {requestId, projectId, featureId: groupFeatureId,
        conversationId: activeId, paths: (groupBinding || checkBinding)!.turn.context.map(source => source.path)};
      this.assistantContextEpoch = -1; this.assistantContextFiles = [];
    }
    if (revisionBinding) {
      this.assistantContextRestore = {requestId, projectId, featureId: this.featureSnapshot()?.activeId ?? null,
        conversationId: activeId, paths: revisionBinding.turn.context.map(source => source.path)};
      this.assistantContextEpoch = -1; this.assistantContextFiles = [];
    }
    const planSourceEpoch = this.featureSourceEpoch || 0;
    if (planBinding) {
      this.artifactSourceFiles = []; this.artifactSourceUnavailable = [];
      this.artifactSourceOwner = {projectId, root: project.root, conversationId: planBinding.owner.conversation.id,
        paths: planBinding.owner.turn.context.map(source => source.path), epoch: planSourceEpoch};
    }
    const isCurrent = () => !abort.signal.aborted && generation === this.askGeneration &&
      this.project?.id === projectId && this.project.root === project.root && vscode.workspace.isTrusted && !this.disposed;
    const groupScopeCurrent = () => isCurrent() && (!groupBinding ||
      (this.featureSnapshot()?.activeId ?? null) === groupFeatureId && revisionSourceEpoch === (this.featureSourceEpoch || 0) &&
      this.conversationPresentation(store).snapshot.activeId === activeId && !this.conversationPresentation(store).snapshot.conversations.find(chat => chat.id === activeId)?.archived &&
      !this.executionSnapshot()?.busy && !this.dirtyPaths().some(path => groupBinding.turn.context.some(source => source.path === path)));
    if (groupBinding) request.groupGuard = groupScopeCurrent;
    const checkView = this.assistantView;
    const checkScopeCurrent = () => isCurrent() && (!checkBinding || this.assistantView === checkView &&
      (this.featureSnapshot()?.activeId ?? null) === groupFeatureId && revisionSourceEpoch === (this.featureSourceEpoch || 0) &&
      this.conversationPresentation(store).snapshot.activeId === activeId && !this.conversationPresentation(store).snapshot.conversations.find(chat => chat.id === activeId)?.archived &&
      !this.dirtyPaths().some(path => checkBinding.turn.context.some(source => source.path === path)));
    if (checkBinding) request.checkGuard = checkScopeCurrent;
    const investigationView = this.assistantView;
    const investigationScopeCurrent = () => isCurrent() && (!investigationBinding || this.assistantView === investigationView &&
      this.investigationOwnerCurrent(investigationBinding) && (this.conversationPresentation(store).snapshot.activeId ?? null) === request.conversationId);
    if (investigationBinding) request.investigationGuard = investigationScopeCurrent;
    const continuationView = this.assistantView;
    const continuationScopeCurrent = () => isCurrent() && (!continuationBinding || this.assistantView === continuationView &&
      this.continuationOwnerCurrent(continuationBinding,requestId));
    if (continuationBinding) request.continuationGuard = continuationScopeCurrent;
    const alternativeSourceEpoch=this.featureSourceEpoch || 0;
    const alternativeScopeCurrent=()=>isCurrent() && (!alternativeGeneration || (this.featureSourceEpoch || 0)===alternativeSourceEpoch &&
      this.featureSnapshot()?.activeId===alternativeGeneration.scope.feature.id && this.conversationPresentation(store).snapshot.activeId===request.conversationId &&
      !this.conversationPresentation(store).snapshot.conversations.find(chat=>chat.id===request.conversationId)?.archived && !this.dirtyPaths().some(path=>message.context.some((source:any)=>source.path===path)));
    if(alternativeGeneration)request.alternativeGuard=alternativeScopeCurrent;
    let pendingAlternatives:any;
    let pendingInvestigationDecision: any;
    let pendingCheckSuggestion: any;
    let pendingRefinement: any;
    const emit = async (incoming: any) => {
      if (!isCurrent() || request.terminal) return;
      let event = incoming;
      const eventIntent = ({proposal: "build", changeSet: "build", alternatives:"build", plan: "plan", review: "review", checkSuggestion:"plan", investigationDecision:"plan"} as Record<string, string>)[event.type];
      if (eventIntent && eventIntent !== intent) event = {type: "error", error: "The provider returned an artifact for a different mode. No source change was prepared."};
      if (checkBinding && ["proposal","changeSet","plan","review"].includes(event.type))
        throw new Error("The provider returned an unsupported artifact for this check suggestion.");
      if (continuationBinding && ["proposal","changeSet","plan","review","checkSuggestion"].includes(event.type))
        throw new Error("This checkpoint returned an unsupported artifact.");
      if(alternativeGeneration && ["proposal","changeSet","plan","review","checkSuggestion","investigationDecision"].includes(event.type))throw new Error("This request must return two scoped alternatives without staging source.");
      if(event.type==="alternatives"){
        if(!alternativeGeneration || pendingAlternatives || !alternativeScopeCurrent())throw new Error("This response does not own a unique alternatives artifact.");
        await store.flush();if(!alternativeScopeCurrent())return;
        const turn=this.conversationPresentation(store).snapshot.conversations.flatMap(chat=>chat.turns).find(item=>item.requestId===requestId);
        if(!turn)throw new Error("The alternatives request is unavailable.");
        const artifact=normalizeAIAlternatives(event.alternatives,projectId,turn.context);
        if(visualVerificationDigest(artifact.generation)!==visualVerificationDigest(alternativeGeneration))throw new Error("The alternatives scope differs from its request.");
        pendingAlternatives=artifact;return;
      }
      if (event.type === "investigationDecision") {
        if (!continuationBinding || pendingInvestigationDecision || !continuationScopeCurrent()) throw new Error("This response does not own a unique investigation decision.");
        pendingInvestigationDecision = validateInvestigationDecision(event.investigationDecision,continuationBinding.context,projectId);
        return;
      }
      if (event.type === "checkSuggestion") {
        if (!checkBinding || pendingCheckSuggestion) throw new Error("This response does not own a unique check suggestion.");
        if (!checkScopeCurrent()) throw new Error("The suggestion's source context changed while it was generated.");
        pendingCheckSuggestion = validateCheckSuggestion(event.checkSuggestion,checkBinding.checkContext,projectId);
        return;
      }
      if (event.type === "changeSet") {
        if (planBinding) throw new Error("This plan handoff supports one file. Start a separate Build request to prepare a coordinated change group.");
        await store.flush();
        if (!isCurrent()) return;
        if (this.proposals().current()?.status === "applied") throw new Error("Undo or dismiss the applied proposal before staging a change group.");
        const turn = this.conversationPresentation(store).snapshot.conversations.flatMap(chat => chat.turns).find(item => item.requestId === requestId);
        if (!turn || turn.proposal || turn.changeSet || turn.plan || turn.review)
          throw new Error("This request already produced an artifact. No additional change group was staged.");
        const group = validateChangeSet(event.changeSet, projectId);
        if (!group || group.projectId !== projectId || group.status !== "proposed" || group.revision !== 0 ||
          !Array.isArray(group.context) || group.context.length !== turn.context.length ||
          !turn.context.every((source, index) => group.context[index]?.path === source.path && group.context[index]?.revision === source.revision) ||
          !Array.isArray(group.files) || !group.files.every((file: any) => turn.context.some(source =>
            source.path === file.path && source.source === file.before && source.revision === file.baseRevision)))
          throw new Error("The change group does not match this request's selected source. No project source was changed.");
        if (groupBinding) {
          if (pendingRefinement) throw new Error("This revision returned more than one group. The earlier version remains active.");
          if (!groupScopeCurrent() || !this.groupRevisionOwnerCurrent(groupBinding)) throw new Error("The group revision no longer owns its source context.");
          pendingRefinement = {...group, requestId};
          return; // A complete artifact alone cannot replace the parent before normal completion.
        }
        const session = this.changeSets();
        await session.load();
        if (!isCurrent()) return;
        this.requireNoActiveChangeSet();
        const staged = await session.stage({...group, requestId}, {isCurrent});
        if (!isCurrent()) return;
        if (!staged.current || staged.current.id !== event.changeSet.id || staged.storage.status !== "saved")
          throw new Error("The isolated change group could not be saved. No project source was changed.");
        event = {type: "changeSet", changeSet: staged.current};
      }
      if (event.type === "proposal") {
        if (groupBinding) throw new Error("A group refinement must retain a coordinated group. Its previous version is unchanged.");
        this.requireNoActiveChangeSet();
        const proposalCurrent = () => isCurrent() && (!planBinding || planSourceEpoch === (this.featureSourceEpoch || 0) &&
          this.artifactOwnerCurrent(planBinding.owner, planBinding.snapshot.revision) &&
          !this.dirtyPaths().some(path => planBinding.owner.turn.context.some(source => source.path === path)));
        if (planBinding) {
          // The last streamed delta may still be saving. Finish that write
          // before checking the durable parent plan, then recheck ownership.
          await store.flush();
          if (!isCurrent()) return;
          this.resolvePlanContext(message.planContext);
          await this.readArtifactSources(planBinding.owner, proposalCurrent, true);
        }
        event = { ...event, proposal: { ...event.proposal, requestId,
          ...(planBinding ? {planBasis: planBinding.owner.turn.context.map(source => ({path: source.path, revision: source.revision}))} : {}) } };
        await this.proposals().set(event.proposal, { isCurrent: proposalCurrent });
        if (!proposalCurrent()) return;
      }
      if (!isCurrent()) return;
      if(alternativeGeneration && event.type==="done"){
        if(!pendingAlternatives)throw new Error("The response did not produce two complete alternatives.");
        await store.flush();
        const turn=this.conversationPresentation(store).snapshot.conversations.flatMap(chat=>chat.turns).find(item=>item.requestId===requestId);
        if(!turn)throw new Error("The alternatives request is unavailable.");
        await this.readAIAlternativeSources(alternativeGeneration,turn.context,alternativeScopeCurrent);
        if(!alternativeScopeCurrent())throw new Error("The alternatives context changed before completion.");
        const saved=store.event(requestId,{type:"alternatives",alternatives:pendingAlternatives});
        if(!saved?.alternatives || saved.state==="failed")throw new Error("The alternatives could not be retained.");
      }
      if (investigationBinding && event.type === "done") {
        await store.flush();
        await this.readSourceInvestigation(investigationBinding, investigationScopeCurrent);
      }
      if (continuationBinding && event.type === "done") {
        if (!pendingInvestigationDecision) throw new Error("The response did not produce a complete investigation checkpoint.");
        await store.flush();
        await this.readInvestigationContinuation(continuationBinding,continuationScopeCurrent,requestId);
        if (!continuationScopeCurrent()) throw new Error("The investigation context changed before completion.");
        const saved = store.event(requestId,{type:"investigationDecision",investigationDecision:pendingInvestigationDecision});
        if (!saved?.investigationDecision || saved.state === "failed") throw new Error("The investigation decision could not be saved.");
      }
      if (checkBinding && event.type === "done") {
        if (!pendingCheckSuggestion) throw new Error("The response did not produce a complete supported-check suggestion.");
        await store.flush();
        await this.readGroupRevisionSources(checkBinding, () => checkScopeCurrent() && this.checkContextCurrent(checkBinding));
        if (!checkScopeCurrent()) return;
        const saved = store.event(requestId,{type:"checkSuggestion",checkSuggestion:pendingCheckSuggestion});
        if (!saved?.checkSuggestion || saved.state === "failed") throw new Error("The check suggestion could not be saved. No plan was created.");
      }
      if (groupBinding && event.type === "done") {
        if (!pendingRefinement) throw new Error("The revision did not produce a complete group. The earlier version remains active.");
        await store.flush();
        await this.readGroupRevisionSources(groupBinding, () => groupScopeCurrent() && this.groupRevisionOwnerCurrent(groupBinding));
        const saved = store.event(requestId, {type: "changeSet", changeSet: pendingRefinement});
        if (!saved?.changeSet || saved.state === "failed") throw new Error("The revision could not be saved in its conversation. The earlier version remains active.");
        const completed = store.event(requestId, event);
        if (completed?.state !== "complete" || completed.completedWhileStopping) throw new Error("The revision stopped before completion. The earlier version remains active.");
        await store.flush();
        if (!groupScopeCurrent()) return;
        await this.readGroupRevisionSources(groupBinding, () => groupScopeCurrent() && this.groupRevisionOwnerCurrent(groupBinding));
        try {
          await groupBinding.session.refine(pendingRefinement, {parentId: groupBinding.group.id,
            expectedParentRevision: groupBinding.group.revision, parentDigest: groupBinding.snapshot.groupDigest, isCurrent: groupScopeCurrent});
        } catch {
          const committed = groupBinding.session.snapshot().current?.id === pendingRefinement.id;
          throw new Error(committed ? "The new version was selected, but its local durability could not be confirmed. Retry change storage before using it."
            : "The revision is saved for inspection but could not become current. The earlier group remains active; inspect or retry local change storage.");
        }
        if (!groupScopeCurrent()) return;
        this.sendState();
      }
      const archivedTurn = store.event(requestId, event);
      if (archivedTurn?.state === "failed" && event.type !== "error") {
        event = { type: "error", error: archivedTurn.error || "The response exceeded local history capacity. The retained partial response is preserved." };
        abort.abort();
      }
      if (event.type !== "delta") clearProgress();
      if (event.type === "done" || event.type === "error") {
        request.terminal = true;
        if (this.asking === request) this.asking = undefined;
        try { await store.flush(); } catch { /* The storage error is visible in the authoritative snapshot. */ }
      }
      // A terminal disk write may finish after another project or request owns
      // the pane. Its history remains saved, but its UI event must stay retired.
      if (generation !== this.askGeneration || this.project?.id !== projectId ||
        !vscode.workspace.isTrusted || this.disposed) return;
      if (event.type !== "delta" || !firstDeltaSent) {
        if (event.type === "delta") firstDeltaSent = true;
        this.postAI(requestId, event, request);
      } else if (!request.progressTimer) {
        request.progressTimer = setTimeout(() => {
          request.progressTimer = undefined;
          if (isCurrent() && !request.terminal)
            this.postAI(requestId, { type: "progress" }, request);
        }, 100);
      }
      if (["proposal", "changeSet", "alternatives", "plan", "review", "checkSuggestion"].includes(event.type) || (alternativeGeneration || checkBinding || continuationBinding) && event.type === "done") this.sendState();
      if (event.type === "changeSet") void this.loadExecutions().then(() => this.sendState()).catch(() => {
        this.error = "Isolated-check storage could not be loaded. Reopen the group to retry."; this.sendState();
      });
    };
    let bridge: Bridge | undefined;
    let savingStart = false;
    try {
      if (intent === "build") {
        await this.loadChangeSets();
        if (!isCurrent()) return;
        if (groupBinding) {
          if (!groupScopeCurrent() || !this.groupRevisionOwnerCurrent(groupBinding)) throw new Error("The group changed before this revision could start.");
        } else this.requireNoActiveChangeSet();
      }
      const context = [];
      for (const [index, selected] of message.context.entries()) {
        const file: ProjectFile = await this.service.getFile(projectId, selected.path);
        if (!isCurrent()) return;
        if (this.dirtyPaths().includes(file.path))
          throw new Error("Save changes to the selected file before sharing it with AI.");
        if (file.revision !== selected.revision)
          throw new Error("The selected source changed. Refresh the selected files and try again.");
        context.push({ id: `S${index + 1}`, path: file.path, revision: file.revision,
          source: file.source, lines: file.source.split("\n").length });
      }
      if (message.taskContext !== undefined) this.resolveTaskContext(message.taskContext);
      if (planBinding) {
        this.resolvePlanContext(message.planContext);
        const checked = await this.readArtifactSources(planBinding.owner, () => isCurrent() &&
          planSourceEpoch === (this.featureSourceEpoch || 0) && this.artifactOwnerCurrent(planBinding.owner, planBinding.snapshot.revision), true);
        this.artifactSourceFiles = checked.files;
      }
      if (revisionBinding) {
        this.assistantContextFiles = await this.readRequestRevisionSources(revisionBinding, () => isCurrent() &&
          revisionSourceEpoch === (this.featureSourceEpoch || 0) && this.requestRevisionOwnerCurrent(revisionBinding));
        this.assistantContextEpoch = revisionSourceEpoch;
      }
      if (groupBinding) {
        this.assistantContextFiles = await this.readGroupRevisionSources(groupBinding, () => groupScopeCurrent() && this.groupRevisionOwnerCurrent(groupBinding));
        this.assistantContextEpoch = revisionSourceEpoch;
      }
      if (checkBinding) {
        this.assistantContextFiles = await this.readGroupRevisionSources(checkBinding, () => checkScopeCurrent() && this.checkContextCurrent(checkBinding));
        this.assistantContextEpoch = revisionSourceEpoch;
      }
      if (investigationBinding) await this.readSourceInvestigation(investigationBinding, investigationScopeCurrent);
      if (continuationBinding) await this.readInvestigationContinuation(continuationBinding,continuationScopeCurrent);
      if(message.issueContext!==undefined)issueContext=await this.resolveIssueContext(message.issueContext);
      if(message.decisionContext!==undefined)decisionContext=await this.resolveDecisionContext(message.decisionContext);
      if(!isCurrent())return;
      if(alternativeGeneration)await this.readAIAlternativeSources(alternativeGeneration,context,alternativeScopeCurrent);
      savingStart = true;
      await store.startTurn({ requestId, prompt: message.prompt.trim(), intent, ...(alternativeGeneration?{alternativeGeneration}:{}), ...(decisionContext?{decisionContext}:{}), ...(issueContext?{issueContext}:{}),
        ...(continuationBinding ? {investigationContext:continuationBinding.context} : {}),
        ...(checkBinding ? {checkContext:checkBinding.checkContext} : {}),
        ...(investigationBinding ? {sourceInvestigation:investigationBinding.result} : {}),
        ...(revisionBinding ? {requestRevision: revisionBinding.snapshot} : {}),
        ...(groupBinding ? {groupRevision: groupBinding.snapshot} : {}),
        ...(planBinding ? {planContext: planBinding.snapshot} : {}), context, model: this.assistant.status().model, providerKind: this.assistant.status().providerKind, ...(alternativeGeneration || checkBinding || investigationBinding || continuationBinding ? {} : {runtimeEvidence,taskContext}), conversationId: activeId });
      savingStart = false;
      request.durable = true;
      request.conversationId = this.conversationPresentation(store).snapshot.activeId;
      if (investigationBinding && activeId === null && this.investigationBinding === investigationBinding && isCurrent() &&
        this.conversationPresentation(store).snapshot.conversations.find(chat => chat.id === request.conversationId)?.turns.some(turn => turn.requestId === requestId))
        investigationBinding.conversationId = request.conversationId;
      if (!isCurrent()) {
        store.event(requestId, { type: "cancelled" });
        try { await store.flush(); } catch {}
        this.sendState();
        return;
      }
      if (message.taskContext !== undefined) this.resolveTaskContext(message.taskContext);
      const privateBridge: Bridge = await createAssistantBridge(this.assistant);
      bridge = privateBridge;
      if (!isCurrent()) return;
      this.bridge = privateBridge;
      if (message.taskContext !== undefined) this.resolveTaskContext(message.taskContext);
      if (planBinding) {
        this.resolvePlanContext(message.planContext);
        const checked = await this.readArtifactSources(planBinding.owner, () => isCurrent() &&
          planSourceEpoch === (this.featureSourceEpoch || 0) && this.artifactOwnerCurrent(planBinding.owner, planBinding.snapshot.revision), true);
        this.artifactSourceFiles = checked.files;
      }
      if (planBinding && this.dirtyPaths().some(path => planBinding.owner.turn.context.some(source => source.path === path)))
        throw new Error("An artifact source became unsaved before Build. Resolve the affected draft before sending.");
      if (revisionBinding) {
        // Persistence and bridge setup are asynchronous. Recheck the complete
        // saved source basis and native drafts immediately before dispatch.
        this.assistantContextFiles = await this.readRequestRevisionSources(revisionBinding, () => isCurrent() &&
          revisionSourceEpoch === (this.featureSourceEpoch || 0) && this.requestRevisionOwnerCurrent(revisionBinding));
        this.assistantContextEpoch = revisionSourceEpoch;
      }
      if (groupBinding) {
        this.assistantContextFiles = await this.readGroupRevisionSources(groupBinding, () => groupScopeCurrent() && this.groupRevisionOwnerCurrent(groupBinding));
        this.assistantContextEpoch = revisionSourceEpoch;
      }
      if (checkBinding) {
        this.assistantContextFiles = await this.readGroupRevisionSources(checkBinding, () => checkScopeCurrent() && this.checkContextCurrent(checkBinding));
        this.assistantContextEpoch = revisionSourceEpoch;
      }
      if (investigationBinding) await this.readSourceInvestigation(investigationBinding, investigationScopeCurrent);
      if (continuationBinding) await this.readInvestigationContinuation(continuationBinding,continuationScopeCurrent,requestId);
      if(alternativeGeneration)await this.readAIAlternativeSources(alternativeGeneration,context,alternativeScopeCurrent);
      if(decisionContext)await this.resolveDecisionContext(decisionContext);
      if(issueContext)await this.resolveIssueContext(issueContext);
      if(!isCurrent())return;
      const response = await fetch(`${privateBridge.url}/api/assistant/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${privateBridge.token}` },
        body: JSON.stringify({ projectId, prompt: message.prompt.trim(), context: message.context, intent, ...(alternativeGeneration?{alternativeGeneration}:{}), ...(decisionContext?{decisionContext}:{}), ...(issueContext?{issueContext}:{}), ...(continuationBinding ? {investigationContinuation:investigationContextDescriptor(continuationBinding.context)} : {}), ...(investigationBinding ? {sourceInvestigation:sourceInvestigationDescriptor(investigationBinding.result)} : {}), ...(checkBinding ? {checkContext:checkBinding.checkContext} : {}), ...(groupBinding ? {groupRevision: groupBinding.snapshot} : {}), ...(intent === "build" && !planBinding ? {changeSets: true} : {}), ...(planBinding ? {planContext: planBinding.snapshot} : {}), ...(message.runtimeContext ? { runtimeContext: message.runtimeContext } : {}), ...(taskContext ? { taskContext } : {}) }),
        signal: abort.signal,
      });
      if (!response.ok) {
        const result: any = await response.json();
        throw new Error(result.error || "The assistant could not start.");
      }
      if (!response.body) throw new Error("The provider returned no response. Try sending your message again.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        let newline;
        while ((newline = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (line.trim()) await emit(JSON.parse(line));
        }
      }
      if (isCurrent() && !request.terminal)
        await emit({ type: "error", error: "The assistant connection ended before completing. The partial answer is preserved." });
    } catch (error) {
      if (!abort.signal.aborted) {
        const event = { type: "error", error: savingStart
          ? "The conversation could not be saved. No request was sent. Retry local storage before asking again."
          : error instanceof Error ? error.message : "The assistant connection failed." };
        // A failed initial write must not leave an orphan running turn. A store
        // may retain that unsaved turn locally so Retry can recover its evidence.
        store.event(requestId, event);
        request.durable = this.conversationPresentation(store).snapshot.conversations.some(chat => chat.turns.some(turn => turn.requestId === requestId));
        if (request.durable) request.conversationId = this.conversationPresentation(store).snapshot.conversations.find(chat => chat.turns.some(turn => turn.requestId === requestId))!.id;
        clearProgress();
        request.terminal = true;
        if (this.asking === request) this.asking = undefined;
        try { await store.flush(); } catch {}
        if (generation === this.askGeneration && this.project?.id === projectId &&
          vscode.workspace.isTrusted && !this.disposed) this.postAI(requestId, event, request);
      }
    } finally {
      clearProgress();
      await bridge?.close();
      if (this.bridge === bridge) this.bridge = undefined;
      if (this.asking === request) this.asking = undefined;
    }
  }

  private conversationPresentation(store = this.conversations()) {
    return store.presentation ? store.presentation() : { snapshot: store.snapshot(), epoch: 0, versions: undefined };
  }

  // Each renderer owns its own delivery cursor. Retained records are sent once,
  // while current headers, storage status, freshness and live observations are
  // always published. A missing base is recoverable through a full resync.
  private postHistoryMessage(webview: vscode.Webview, message: any, conversation?: ReturnType<FoundationHost["conversationPresentation"]> | null) {
    const delivery = this.historyDeliveries?.get(webview);
    if (!delivery || !["conversations", "runtimeWorkspace"].some(key => Object.prototype.hasOwnProperty.call(message, key))) { void webview.postMessage(message); return; }
    const history: any = { version: 1 }, output = { ...message, history };
    for (const key of ["conversations", "runtimeWorkspace"]) {
      if (!Object.prototype.hasOwnProperty.call(message, key)) continue;
      const snapshot = message[key]; delete output[key];
      let prior = delivery.channels.get(key);
      if (!prior) { prior = { generation: 0, sequence: 0, records: new Map(), reset: true }; delivery.channels.set(key, prior); }
      if (!snapshot) {
        prior.generation++; prior.sequence++; prior.owner = undefined; prior.records.clear(); prior.reset = true;
        history[key] = { generation: prior.generation, sequence: prior.sequence, base: null, value: null }; continue;
      }
      const epoch = key === "conversations" ? conversation?.epoch ?? 0 : this.runtimeWorkspaceStore().presentation?.().epoch ?? 0;
      const owner = `${snapshot.projectId}\0${epoch}`;
      const full = prior.reset || prior.owner !== owner;
      if (full) { prior.generation++; prior.records.clear(); }
      const base = full ? null : prior.sequence;
      prior.sequence++; prior.owner = owner; prior.reset = false;
      const header: any = { ...snapshot }, records = new Map<string, any>(), changed: any[] = [];
      if (key === "conversations") {
        header.conversations = snapshot.conversations.map((chat: any) => {
          const { turns, ...metadata } = chat;
          for (const turn of turns) records.set(turn.requestId, turn);
          return { ...metadata, turnIds: turns.map((turn: any) => turn.requestId) };
        });
      } else { delete header.runs; header.runIds = snapshot.runs.map((run: any) => run.id); for (const run of snapshot.runs) records.set(run.id, run); }
      const versions = new Map<string, number>();
      for (const [id, record] of records) {
        const version = key === "conversations" ? conversation?.versions?.[id] ?? snapshot.revision : snapshot.revision;
        versions.set(id, version);
        if (prior.records.get(id) !== version) changed.push(record);
      }
      const removed = [...prior.records.keys()].filter(id => !records.has(id));
      prior.records = versions;
      history[key] = { generation: prior.generation, sequence: prior.sequence, base, header, records: changed, removed };
    }
    let pending: Thenable<boolean>;
    try { pending = webview.postMessage(output); }
    catch { for (const channel of delivery.channels.values()) channel.reset = true; return; }
    void Promise.resolve(pending).then(sent => {
      if (sent === false) for (const channel of delivery.channels.values()) channel.reset = true;
    }, () => { for (const channel of delivery.channels.values()) channel.reset = true; });
  }

  private postAI(requestId: string, event: any, owner?: { conversationId: string | null; store: ReturnType<typeof createConversationStore>; durable: boolean }) {
    if (!this.assistantView) return;
    const presentation = owner?.durable ? this.conversationPresentation(owner.store) : undefined;
    this.postHistoryMessage(this.assistantView.webview, { type: "ai", requestId, event,
      ...(owner?.durable ? { conversationId: owner.conversationId, conversations: presentation!.snapshot } : {}),
    }, presentation);
  }

  private cancelQuestion(requestId?: string) {
    const previous = this.asking;
    if (requestId !== undefined && previous?.requestId !== requestId) return;
    this.askGeneration++;
    this.asking = undefined;
    previous?.abort.abort();
    if (previous?.progressTimer) clearTimeout(previous.progressTimer);
    if (previous) previous.progressTimer = undefined;
    if (previous && !previous.terminal) {
      previous.store.event(previous.requestId, { type: "cancelled" });
      void previous.store.flush().catch(() => {});
      this.postAI(previous.requestId, { type: "cancelled" }, previous);
    }
  }
  private postError(message: string, surface?: Surface) {
    if (!surface || surface === "workspace") void this.panel?.webview.postMessage({ type: "error", message });
    if (!surface || surface === "assistant") void this.assistantView?.webview.postMessage({ type: "error", message });
    this.status.tooltip = message;
  }
  async dispose() {
    this.interruptAlternatives();
    this.runtimeSourceHashCache = undefined;
    this.flushEditorFocus();
    this.finishKnowledgeOffer("Foundation closed before knowledge was added.");
    this.knowledgeReveal=undefined;
    this.disposed = true;
    this.swiftLanguage?.dispose();
    this.xcodeProject?.dispose();
    this.platformSetup?.dispose();
    this.codeSuggestions?.dispose();
    this.inlineEdit?.dispose();
    this.workspaceRevealGeneration++;
    this.assistantRestoreGeneration++;
    this.clearRelationships();
    this.invalidateDesignImpact(true);
    this.pendingWorkspaceMode = undefined;
    this.settleAssistantReveal();
    this.cancelQuestion();
    if (this.contextTimer) clearTimeout(this.contextTimer);
    if (this.conversationStateTimer) clearTimeout(this.conversationStateTimer);
    this.conversationStateTimer = undefined;
    this.panel?.dispose();
    this.assistantView = undefined;
    this.assistantReady = false;
    this.assistantPreparation = undefined;
    await this.bridge?.close();
    this.bridge = undefined;
    await this.resetRuntime();
    await this.runtimeMatrixTask?.done?.catch(() => {});
    await this.runtimeMatrixRecovery?.done?.catch(() => {});
    await Promise.allSettled([...(this.runtimeMatrixStores?.values() || [])].map(store => store.dispose()));
    await Promise.allSettled([...(this.runtimeStateSuiteStores?.values() || [])].map(store => store.dispose()));
    await Promise.allSettled([...(this.checkPlanSessions?.values() || [])].map(session => session.dispose()));
    await Promise.allSettled([...(this.executionSessions?.values() || [])].map(session => session.dispose()));
    await Promise.allSettled([...(this.changeSetSessions?.values() || [])].map(session => session.dispose?.()));
    await Promise.allSettled([...this.conversationStores.values()].map(store => store.dispose()));
    await Promise.allSettled([...(this.featureStores?.values() || [])].map(store => store.dispose()));
    await Promise.allSettled([...(this.runtimeWorkspaceStores?.values() || [])].map(store => store.dispose()));
    await Promise.allSettled([...(this.runtimeReplayStores?.values() || [])].map(store => store.dispose()));
    await Promise.allSettled([...(this.visualAlternativesSessions?.values() || [])].map(session => session.dispose()));
    await Promise.allSettled([...(this.reproducibleIssueStores?.values() || [])].map(store => store.dispose()));
    await Promise.allSettled([...(this.projectDecisionStores?.values() || [])].map(store => store.dispose()));
    await Promise.allSettled([...(this.visualVerificationStores?.values() || [])].map(store => store.dispose()));
    this.snapshots.clear();
    await this.focusPersistence;
  }
}

let host: FoundationHost | undefined;
export async function activate(context: vscode.ExtensionContext) {
  host = new FoundationHost(context);
  context.subscriptions.push(host);
  await host.start();
  return { inspect: () => host?.inspect() };
}
export async function deactivate() {
  await host?.dispose();
  host = undefined;
}
