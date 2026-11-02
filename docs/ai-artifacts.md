# AI artifacts for Foundation

**Implementation update:** Foundation 0.5 now connects the core artifact cards to native assistant state. See [native AI artifacts](native-ai-artifacts.md) for supported behavior, persistence, and validation.

**Status:** proposed component and interaction contract, 27 October 2026. This extends the Foundation design system for artifacts embedded in the AI chat pane. The interactive catalog illustrates these contracts; it does not connect a provider, execute tools, run verification, or modify project source.

Foundation 0.4 already supports disclosed saved-source context, source questions, validated single-file proposals, cancellation, native diffs, guarded Apply/Undo, and local token experiments. Durable artifact history, general tool execution, multi-file agents, runtime API evidence, scenario comparison, and automated verification are target capabilities. The artifact design must not imply that those targets already exist. See [current implementation boundaries](ai-design-tools.md).

## 1. What an artifact is

An artifact is a persistent, inspectable work object attached to a conversation: a plan, proposal, capture, result, or decision. Chat explains intent and connects these objects. The artifact owns its structured content, source context, state, and supported actions.

Ordinary answers remain readable prose. Introduce an artifact when the result has an identity worth revisiting, substantial structured content, a reviewable action, or evidence that must retain its revision. Do not put every sentence in a card.

Every artifact retains one stable ID across its inline summary, expanded chat form, workspace view, and history entry. Expanding never creates another proposal. Updates produce explicit artifact versions; references to an older version remain inspectable.

## 2. Shared anatomy

| Part | Contract |
| --- | --- |
| Identity | Semantic icon, specific title, artifact type. Prefer “Improve Save loading behavior” to “AI result.” |
| State | Plain-language lifecycle label. A changed state never silently rewrites the title. |
| Summary | One useful sentence, followed by the smallest structured body that supports the decision. |
| Scope | Affected entity, project/file boundary, and instance/component/token scope where relevant. Counts disclose incomplete coverage. |
| Provenance | Claims use **From source**, **Observed**, **AI interpretation**, or **Unknown**, with supporting references. Mixed claims retain their individual provenance. |
| Freshness | Current, Stale, or Unknown, independently of provenance and completion. Stale identifies what changed. |
| Revision | Saved-source revision or runtime session; proposal/capture version when applicable. Details may collapse, but cannot disappear from the object. |
| Action row | One primary next action, secondary disclosure, and cancellation/recovery when applicable. Use specific verbs. |
| Expansion | “Open in workspace” preserves artifact, selection, scenario, and return location. Close returns focus and scroll to the originating card. |

The collapsed card must answer: **What is this? What state is it in? What does it affect? What can I do next?** Paths, revision details, logs, and long explanations may expand. Scope warnings, stale status, failed checks, and permission consequences must remain visible.

## 3. Artifact families

| Family | Minimum content | Main interaction and important states |
| --- | --- | --- |
| **Context** | Selected entity; exact files/snapshots or attachments; saved/draft distinction; provider destination; included/excluded state; truncation or size limits. | Inspect the shared context before Send. Available context and actually sent context are distinct. Excluded drafts remain editable. A prior message is not silently included in a later request. |
| **Source explanation** | Answer/claim; supporting source locations; revision; provenance for each material claim; visibility boundary. | Open supporting source at the recorded revision. Ambiguous mapping shows candidates; backend Unknown stays explicit. A fluent answer without evidence remains AI interpretation. |
| **Plan** | Goal; ordered steps; dependencies; proposed file/scope boundary; assumptions; completion criteria; any operations requiring approval. | Edit or approve the plan. Approval authorizes only its stated scope; it does not approve deployment or new access. Steps can be pending, active, blocked, skipped, or complete without implying verification. |
| **Task / tool run** | Actual operation; tool and target; input summary; elapsed time when useful; bounded output; cancellation support; resulting artifacts. | Stop the operation or inspect output. Distinguish queued, running, waiting for user, blocked, stopping, cancelled, failed, and complete. An empty spinner is not a task report. A terminal command is displayed as literal code, with working directory and relevant effects. |
| **Code change** | Intent; baseline revision; exact changed files/diff; scope and known consumers; origin; proposal validation; suggested and actual checks separately. | Review changes. Apply is offered only after complete validated output and a fresh baseline. Partial, malformed, cancelled, ambiguous, or stale edits cannot be applied. Accepting a plan is not accepting a diff. |
| **Visual comparison** | Baseline and proposal captures; source revisions; scenario/state; theme; viewport dimensions; capture times; experimental/source status. | Compare the same scenario, then open the connected source or preview. A screenshot is reference evidence, not proof that an interaction passed. Missing captures say Not captured; different inputs cannot masquerade as a controlled comparison. |
| **API evidence** | Method/route; actual runtime session; request/response correlation; status, timing, and inspected payload boundaries; redactions. | Inspect captured request/response. Source contracts and observed traffic are distinct. Browser evidence stops at the browser unless a linked server trace exists. Never fabricate a response to fill an empty card. |
| **Verification** | Separate compilation, interaction, visual, and accessibility outcomes; command/scenario; target revision/session; timestamp; supporting output/capture. | Open evidence or rerun the named check when supported. Each check is Not run, Queued, Running, Passed, Failed, Cancelled, or Unavailable. A check can be Passed and Stale simultaneously. Suggestions are not executed checks. |
| **Decision / permission** | Exact question; proposed action; target/destination; data or access involved; scope and duration; consequences; alternatives; request version. | Make an explicit choice. “Allow once,” “Edit scope,” and “Cancel” are preferable to an ambiguous “Continue.” No choice is pre-submitted. Approval applies only to the displayed operation/version; material changes require a new decision. |
| **Deliverable / knowledge** | Specific result title; type (document, diagram, table, file, or accepted decision); artifact version; project/source context; author/origin; local/export status. | Open, compare versions, or export using a named format/destination. Downloading, adding to a project, committing, and publishing remain separate actions. An accepted explanation retains its evidence and known limitations. |

A task may link to several artifacts. Use a compact relationship row rather than nesting cards inside cards: “Plan → 1 proposed file → 3 checks.” Those counts must come from actual objects. Repeated calls can group into one expandable run list while preserving every operation and failure.

### Content renderers

Family describes the work; format describes its content. A deliverable can open several views of the same underlying result without inventing another proposal. Renderer choice is explicit and schema-driven.

| Format | Inline representation | Expanded representation |
| --- | --- | --- |
| Document | Title and a short structured excerpt. | Selectable headings, prose, lists, citations, and version history. |
| Code | File identity and bounded snippet/diff. | Language-aware source or diff; exact baseline and proposed revision. |
| Diagram | Focused relationship or sequence with a text summary. | Navigable nodes and edges linked to source/evidence; equivalent ordered text. |
| Table | Header and useful rows; identify omitted rows. | Accessible table, full column names, units, sorting, and named export format. |
| Chart | Named measure, units, time range, and source. | Chart plus its accessible data table; no unlabeled synthetic data. |
| Image / capture | Thumbnail, alt text, origin, and capture/reference label. | Original-resolution inspection with source revision, scenario, and comparison metadata. |
| Interactive UI | Representative preview and explicit experimental status. | Isolated preview with defined capabilities, source correspondence, and reset. Generated code is never executed directly in chat or the privileged host. |
| File / asset bundle | File names, type, size, version, and local/export state. | Inspect contents; independently choose Save, Add to project, or Export. |

The component reference demonstrates document, diagram, and table views of a Save behavior note, plus code changes and visual states in their own families. Chart rendering, generated image output, and executable interactive artifacts are future integration targets.

## 4. State and streaming rules

Lifecycle, freshness, provenance, application, and verification are separate dimensions. Do not reduce them to a single colored badge.

- **Queued:** show the operation awaiting execution and its dependencies. Cancel removes only the queued operation.
- **Streaming / running:** mount a stable artifact shell early, keep content in place, and reveal completed fields incrementally. Streaming text is provisional. Do not publish an applicable source proposal until the output completes and validates.
- **Waiting for user:** display the exact pending decision and keep unrelated editing available. A waiting state is not a failure.
- **Blocked:** identify the prerequisite and its recovery action, such as reconnecting a runtime or resolving a mapping. Keep completed evidence visible.
- **Stopping:** acknowledge Stop immediately, stop scheduling new work, and report which active operation is still ending. Do not relabel an operation Cancelled before cancellation is acknowledged.
- **Cancelled:** retain valid partial output as incomplete; list any completed effects and preserved checkpoints. Do not erase the user's draft or discard unrelated edits.
- **Failed:** name the failed operation, retained output, and a scoped Retry. Retry creates a new attempt/version; it does not replay unrelated operations.
- **Complete:** the artifact is structurally complete. This does not mean its proposal is applied, its result correct, or its checks passed.
- **Superseded:** preserve the old object and link to the replacement. Historical decisions cannot authorize a new artifact version.

Status changes use a polite announcement and immediate visual feedback. Do not reveal invented “thinking” or private reasoning traces. Show concise public operation summaries and evidence-backed results. No typewriter animation, decorative progress percentage, or indefinite shimmer after work has stopped.

Streaming follows the bottom only while the reader is already there. If the reader scrolls up, retain position and offer “New activity.” Growing output must not move focused controls, replace a textarea node, interrupt IME input, or reset a partially edited plan.

## 5. Review, apply, undo, and external effects

The action sequence is explicit: **Propose → Review → Apply to source → Verify**. “Accept plan” and “Record review decision” have their own meaning. Commit, publish, deploy, upload, dependency installation, and expanded access are separate named operations; they are never implied by a generic artifact acceptance.

Before Apply, compare the proposal baseline with current saved source and inspect native dirty buffers. If either guard fails, keep the proposal readable, explain the conflict, and offer a fresh proposal or manual reconciliation. Never save or discard a user's draft to make Apply possible. Preserving an unsaved draft also means previewing saved source cannot claim to include that draft.

Undo restores only Foundation's recorded change while its expected applied revision still matches. If newer edits overlap, show the comparison and a recovery path; do not overwrite those edits. Cancelling a task cannot act as a broad workspace reset. Checkpoint retention and deletion have explicit labels.

## 6. Chat, workspace, and unavailable capabilities

The chat pane defaults to **384px**, with a **320–560px** adjustable range. It normally replaces the inspector; it does not add another permanent column. Artifact width fills the pane minus its 16px content insets. At small widths, action rows wrap; primary labels and consequences remain intact.

Use three presentations of the same object:

1. **Inline summary:** title, state, short result, scope, next action.
2. **Expanded in chat:** bounded detail appropriate to the pane, with explicit disclosure controls. Long code, traces, or tables open a workspace surface.
3. **Workspace:** full diff, comparison, diagram, table, or document with its context and actions. The conversation retains a linked summary and return anchor.

An offline provider leaves saved artifacts, local source navigation, manual design controls, and standard editing usable. Preserve the unsent composer draft and show “AI disconnected” with Connect/Retry only where needed. A disconnected runtime retains historical observations with a session/freshness label. Missing capabilities show Unavailable with the precise prerequisite; do not render an enabled action that will silently do nothing.

The reference catalog is explicitly illustrative. Local demonstrations may expand cards, switch scenarios, or show example states, but cannot represent a tool run, permission grant, source application, or test result as having happened.

## 7. Visual and accessibility recipe

Artifacts inherit Foundation's graphite/silver themes, Geist type, semantic colors, and 4px grid. No separate AI palette or glowing container. Use `surface.editor` for the artifact body, one `border.subtle` boundary, 12px corner radius, 16px inset, 8px related gaps, and 12px between independent artifact groups. The title is 13/20 at weight 500; prose 14/20; metadata 12/16. Controls are 32px Standard, 28px Compact, and at least 44px for coarse input. Density never shrinks type. On unusually narrow widths, preserve wrapping before reducing insets below 12px.

Keep body content opaque. Elevation belongs to transient menus and dialogs, not every artifact. Scope and selected source use cobalt. Success styling means an actual successful result; an AI answer uses neutral presentation with the appropriate provenance label. Failed, stale, and cancelled each have text/icon cues in addition to color.

Use native buttons, details/disclosures, lists, tables, and dialogs where appropriate. Each card is a labelled article; status has an accessible text equivalent. The card container itself is not one giant button with nested buttons. Expansion exposes `aria-expanded`/`aria-controls`; Escape closes the innermost transient view and restores focus. Do not assign `role=log` to a region that re-announces its entire history on every update. Keyboard navigation must work without hover-only actions, and output must remain selectable/copyable.

Reduced motion removes spatial animation while retaining state changes. Forced colors uses explicit system boundaries. A larger UI or long translated label increases component height rather than clipping warnings or action names.

## 8. Proposed integration contract

This is a target TypeScript model, not an implemented production API. Content is a discriminated union with family-specific validation; arbitrary model HTML is never an executable artifact renderer.

```ts
type ArtifactKind =
  | 'context' | 'explanation' | 'plan' | 'task' | 'change'
  | 'visual' | 'api' | 'verification' | 'decision' | 'deliverable';
type Lifecycle = 'queued' | 'streaming' | 'running' | 'waiting'
  | 'blocked' | 'stopping' | 'cancelled' | 'failed'
  | 'complete' | 'superseded';
type Provenance = 'source' | 'observed' | 'ai' | 'unknown';
type Freshness = { state: 'current' | 'stale' | 'unknown'; reason?: string };
type Basis =
  | { kind: 'source'; projectId: string; revision: string; paths: string[];
      draftPolicy: 'saved-only' | 'explicit-snapshots' }
  | { kind: 'runtime'; sessionId: string; captureId?: string;
      sourceRevision?: string };
type EvidenceRef = { id: string; provenance: Provenance; basis?: Basis;
  locator?: string; freshness: Freshness; unavailableReason?: string };
type Artifact<K extends ArtifactKind, C> = {
  id: string; version: number; kind: K; title: string;
  conversationId: string; taskId?: string; createdAt: string; updatedAt: string;
  lifecycle: Lifecycle; basis: Basis[]; evidence: EvidenceRef[];
  freshness: Freshness; supersedes?: { id: string; version: number };
  content: C; // Concrete payload schema selected by kind; never raw executable HTML.
  actions: Array<{ id: string; label: string; enabled: boolean; reason?: string;
    effect: 'inspect' | 'local-preview' | 'source-write' | 'external-effect' }>;
};
```

The host computes action eligibility from actual capability, current revisions, trust, buffer state, and any applicable approval; model output cannot grant itself authority. Mutation requests include the artifact ID/version, expected baseline, idempotency key, and concrete operation. Results record resulting revision/checkpoint or a structured failure. Verification payloads retain per-check outcomes and evidence; decision payloads bind a choice to the exact requested action/version. Context payloads distinguish selected, sent, omitted, and truncated items.

## 9. Acceptance criteria

Before migrating the catalog into the native chat pane:

- Open an artifact in the workspace and return without losing selection, chat scroll, edits, or focus.
- Change source after a proposal/capture: mark the correct artifacts stale and block stale Apply while leaving historical evidence readable.
- Cancel while streaming and while a tool is stopping: preserve valid partial output, report completed effects, and leave human drafts untouched.
- Demonstrate that Complete, Applied, Passed, and Current are independently represented.
- Review a shared-token change with incomplete consumer coverage; disclose what is known and unknown before a decision.
- Disconnect AI and runtime separately; keep local editing and saved artifact inspection usable.
- Verify no draft or attachment is transmitted merely because it appears in available context.
- Test Light/Dark × Standard/Compact at pane widths 320, 384, and 560px, large UI/text, long names, keyboard-only use, and reduced motion.
- Test failed, stale, cancelled, partial, empty, unavailable, and permission-waiting examples as carefully as the successful examples.
- Confirm source application, Undo, commit, and deployment are separate operations with honest outcomes and recovery paths.

## Generated alternatives

The Assistant alternatives artifact presents the set intention once, then two numbered candidate sections. Each names the approach, explains its tradeoff and lists the affected files. **Review candidate** is the single primary action; an existing checkpoint changes that action to **Inspect reviewed candidate**. Quiet separators preserve hierarchy in narrow panes. Generation scope and saved source use disclosures, with the exact shared snapshot available for inspection.

Keep AI interpretation, source identity and verification separate. No candidate is a winner by default, and a finished provider response is not an applied or verified change. A selected scenario that changes during keyboard activation retires the pending Send. Background publications preserve an in-progress checkbox activation when its ownership is unchanged.
