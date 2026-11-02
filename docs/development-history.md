# Foundation development history

Historical development record retained from before the public source snapshot on 2 November 2026. Version-specific status, installation and private-repository references describe their original time. See the [current introduction](../README.md), [functionality reference](functionality.md) and [running checklist](product-checklist.md) for current scope. Raw reports referenced here remain local and are not included in the public repository.

**An AI-centered development environment that connects the running product to its code, data, and behavior.**

Foundation is designed for design engineers who need to understand software, build it, refine its interface, and review the result without losing context. Its four workspace activities are **Understand, Build, Refine, and Review**.

This repository contains the product and engineering blueprint and a working local project workbench. Foundation can open source folders, edit multiple files, search, explore source relationships, review saved changes, and ask a configured AI provider about explicit source context. The included Orbit project has a live, instrumented preview.

The desktop host is a source-built Code OSS application for Apple Silicon macOS, with a built-in Foundation extension. Native editing, search, terminals, Git, debugging, settings, and extensions come from the editor platform. Foundation adds connected source context, a sandboxed React design canvas, measured element inspection, design-token experiments, reviewable AI source proposals, guarded Apply and Undo, and its own light and dark themes. The browser workbench remains available for the instrumented runtime walkthrough.

Start with the [complete functionality reference](functionality.md) for every current product area, its limits, and the remaining roadmap. The [master product checklist](product-checklist.md) tracks acceptance and evidence; the [repository guide](repository.md) explains the source layout, setup, and local-only files.

This is Foundation's private source repository. It contains the host integration, application source, maintained fixtures, tests, design references, and documentation. The pinned Code OSS source and generated application are downloaded and built locally.

## Source license and commercial direction

Foundation-original material uses the [Foundation Source Inspection License 1.0](../LICENSE.txt): source inspection is permitted; broader code reuse, running and redistribution require separate rights. This is **source-available, not open source**. [Third-party and separately licensed components](../THIRD_PARTY_NOTICES.md) retain their own terms.

The repository remains private while the [commercial licensing review](commercial-licensing.md) is completed. Its historical MIT metadata, exact native dependencies and public snapshot need review before publication. Build/run instructions below are for rights holders and separately authorized developers; the inspection license itself does not grant those permissions.

## Swift editor intelligence — 0.47

Build and connect a selected Xcode target for local Swift completion, definition navigation, hover and diagnostics. Native Tab/Undo, unsaved and cross-file recovery, stop/reconnect and disconnected restart are verified; Orbit’s draft and context are preserved. [Workflow](swift-language.md) · [Verification](../artifacts/verification-v0.47.md). The installed app is 0.47.

## Xcode Project — 0.46

Choose an Xcode project, shared scheme and iOS Simulator destination, then explicitly Build or Run tests. Results include saved-source identity, bounded output, cancellation and recovery. [Workflow](xcode-projects.md) · [SwiftUI fixture](../fixtures/swiftui/README.md). [Native and installation verification](../artifacts/verification-v0.46.md) passed for the 0.46 milestone.

## Project Setup — 0.45

Project Setup adds explicit local tooling and project checks, capability boundaries, cancellation and recovery guidance. Native build/runtime support remains a separate milestone. [Workflow](platform-readiness.md). [Native and installation verification](../artifacts/verification-v0.45.md) passed for the 0.45 milestone.

## Project knowledge — 0.44

Understand → Knowledge brings local decisions and captured issues into one searchable view, with explicit source/evidence relationships and guarded Assistant context preparation. [Workflow](project-knowledge.md). [Native and installation verification](../artifacts/verification-v0.44.md) passed for the 0.44 milestone.

## Design system v1

The current implementation uses the [strict design system](design-system.md), [product principles](product-principles.md), and [icon/font license policy](iconography-and-licensing.md). Explore the [local interactive reference](../artifacts/design-system-v1/index.html) for Light/Dark, density, layout, and component states. Canonical tokens live in `design/foundation.tokens.json`; validate them with `node scripts/validate-design-system.mjs`. The native host now uses the canonical light/dark palette and connected workspace controls; full design-system conformance remains incremental. See [native workspace integration](native-workspace.md) and [reference verification](../artifacts/design-system-v1/verification.md). **M6 will create and review a brand-new visual and motion system before applying it across the app, as the final milestone.** The existing reference is migration context, not the new system’s design baseline.

## Run the desktop app

```sh
npm run desktop:launch
```

This opens `desktop/.build/Foundation.app` with the included Orbit project. On first launch, workspace trust remains your choice; source intelligence is paused in Restricted Mode. Use **File → Open Folder** to work on another repository. **⌘⌥1** opens Foundation source understanding; **⌘⌥A** opens the assistant. The command palette exposes every Foundation activity. AI is disconnected until you run **Foundation: Set Up AI**; credentials use the native credential store.

To reproduce the application from source on Apple Silicon with Xcode tools installed:

```sh
git clone https://github.com/seanx24x/foundation.git
cd foundation
npm ci
npm run desktop:bootstrap
npm run desktop:build
npm run desktop:test
npm run desktop:launch
```

The bootstrap downloads the pinned Node runtime and Code OSS release. The build creates an ad-hoc signed local application; it is not a notarized distribution. See [desktop architecture and maintenance](desktop-host.md) for the upstream pin, licensing, extension compatibility, verification, and platform boundaries.

## AI and design tools in the desktop

The native canvas offers a saved-source sandbox and an instrumented running Vite project. See [connected web runtime](connected-web-runtime.md) for setup, supported targets, request capture, and recovery. The sandbox uses saved source; unsaved drafts stay intact and are labeled as excluded. Open **Refine**, choose `src/App.tsx`, and select **Start preview**. Inspect the rendered app, switch viewport/theme, and experiment with a CSS token. **Review token change** prepares a source proposal; use **Open native diff** before **Apply to source**. Undo preserves unrelated files and refuses to overwrite later edits. Rebuild the preview to observe the saved result.

The **Assistant** lives in the far-right native sidebar, beside source or the canvas. Press **⌘⌥A** to collapse or reopen it; drag its divider to resize. Conversation history, composer drafts and active responses survive collapse. In **Assistant**, choose **Ask**, **Plan**, **Build** or **Review**, select the saved source to share, and send the request to your configured provider. Direct Build can stage coordinated changes to 2–8 selected existing files; one-file proposals remain supported. All require a separate Apply action. Conversations, their original saved-source context, response artifacts and historical verification now persist locally per project. Use New conversation, History and reversible Archive/Restore; interrupted responses retain their saved partial text. Single-file proposals and multi-file groups each require their matching host-owned checkpoint for Apply/Undo. Opening history sends nothing. Each request shares its prompt and the explicitly disclosed source and context for that workflow. Unrelated conversation history and prior tool output remain local. See [durable conversations](durable-conversations.md).

The sandbox supports React with relative local imports and plain CSS. It has no network access, server process, or project-build plugins. Source mapping requires explicit `data-foundation-source` attributes; unsupported dependencies and unmapped elements remain visible. See [AI and design tools](ai-design-tools.md) for exact capabilities and recovery paths.

## AI alternatives — 0.43

In Assistant → Build, enable **Explore alternatives**, choose a saved scenario, select two to eight application files and describe the design brief. Foundation retains two distinct candidates against the same saved source. Explicitly review each candidate, run the retained comparison, then choose which result to review and apply. Generation never stages or edits source automatically. See the [workflow](ai-alternatives.md) and [verified native and installation evidence](../artifacts/verification-v0.43.md).

## Reproducible Issues — 0.42

Capture a finished web observation as one local issue with its original steps, source hashes, requests and optional replay/capture metadata. Share an issue with Assistant explicitly, including its current or historical evidence status. See the [workflow](reproducible-issues.md) and [verified evidence](../artifacts/verification-v0.42.md).

## Project Decisions — 0.41

After applying a retained comparison alternative, explicitly record why you chose it. Decisions retain source hashes, the adoption checkpoint and independent comparison evidence. Review them from their feature, source or Review; select current decisions explicitly when sharing context with Assistant. Undo preserves the original rationale. See the [workflow](project-decisions.md) and [verified native and installation evidence](../artifacts/verification-v0.41.md).

## Scoped multi-file alternatives — 0.40

Compare named whole Build groups in isolated copies of the same saved feature. Review each retained result in native file diffs, then explicitly Apply all or Undo all. Provenance, recovery and unrelated drafts stay intact. See the [workflow](scoped-multi-file-alternatives.md) and [verification](../artifacts/verification-v0.40.md).

## Named alternatives and reviewed adoption — 0.39

Name and retain CSS-token alternatives, compare two compatible results, and choose one for a native Review diff. Review preserves saved source; explicit Apply and exact-target Undo use the existing source workflow. Historical evidence stays separate from current-checkout validation. See the [workflow](alternative-adoption.md) and [verified native evidence](../artifacts/verification-v0.39.md).

## Isolated visual alternatives — 0.38

Compare saved source with one current proposed CSS token before applying it. Prepare owns two source copies; explicit Run uses the same selected scenario and requested conditions with independent requests, replays and optional captures. Original source and drafts stay intact. Adoption remains a separate source action. See the [workflow](visual-alternatives.md) and [verified native evidence](../artifacts/verification-v0.38.md).

## Visual-change verification — 0.37

Review links an applied token change to explicitly chosen before/after scenario observations and their exact saved captures. Compare opens the paired evidence; Undo and replacement retain history. Compilation, manual assessment and source-to-pixels provenance remain separate. See the [workflow](visual-change-verification.md) and [verified desktop evidence](../artifacts/verification-v0.37.md).

## Named state suites — 0.35

In **Refine → State suite**, save a named set of Idle, Loading, Success, Error and Offline recipes with shared width, app-theme and motion choices. Explicit Run executes at most twelve state/condition combinations. Per-state coverage links actual callback, request and optional image evidence; editing a definition preserves earlier results. Stop and restart never resume unfinished app actions.

Foundation 0.35 is installed: 1,276 desktop tests, TypeScript, three native suites, the single-recipe regression, thirteen observations/replays, ten PNGs and exact second-process restoration pass. Orbit's saved files, original unsaved draft and current layout/context remain preserved. [Verification](../artifacts/verification-v0.35.md) · [Suite guide](state-suites.md) · [Running checklist](product-checklist.md).

## Condition matrices — 0.34

In **Refine → Condition matrix**, select an app-authored recipe and up to twelve width, application-theme and motion combinations. Each condition gets a fresh document and its own callback/request evidence. Optional local captures connect directly to observation comparison. Stop remains visible; failures leave later conditions Not run. Restart and storage recovery never replay app actions.

Foundation 0.34 was verified: 1,231 desktop tests, TypeScript, four packaged matrices, twelve fresh documents, two actual PNGs and exact second-process restoration pass. Orbit's saved source, unsaved draft and current workspace context are preserved. Hardware acceptance remains paused. [Verification](../artifacts/verification-v0.34.md) · [Matrix guide](condition-matrices.md) · [Running checklist](product-checklist.md).

## Reproducible states and replay — 0.33

In a connected React/Vite preview, begin an observation and explicitly choose **Replay recipe** to reset a named app-authored fixture and execute its declared steps. Progress, Stop and historical evidence stay beside the preview. Capture the result and compare it with another observation; replay completion and manual assessment remain separate.

Foundation 0.33 was verified: 1,166 desktop tests, TypeScript and seven packaged native cases pass. Real local requests, two PNG captures and all replay records survive restart without automatic execution. Orbit's saved source, unsaved draft, caret, layout and Assistant context are preserved. Condition matrices follow in 0.34 above; hardware acceptance remains paused. [Verification](../artifacts/verification-v0.33.md) · [Replay guide](scenario-replay.md) · [Running checklist](product-checklist.md).

## Paired visual captures — 0.32

In a connected web preview, use **Capture and finish observation** to save the visible canvas with its manual scenario. **Understand → Runtime → Compare observations** shows two local PNGs with source/runtime identity, capture conditions and separate manual assessments. Captures stay out of AI context; missing, corrupt, stale and unavailable evidence stays explicit.

Foundation 0.32 was verified and installed: 1,104 desktop tests, TypeScript, real native capture at two zoom/fit settings, perimeter privacy checks and second-process restoration pass. Orbit's eight saved files, original unsaved draft, caret, layout and Assistant context are preserved. Hardware acceptance remains paused. Explicit reproducible states and replay follow in 0.33 above. [Verification](../artifacts/verification-v0.32.md) · [Capture guide](visual-captures.md) · [Running checklist](product-checklist.md).

## Saved observation comparison — 0.31

In **Understand → Runtime → Compare observations**, choose two saved scenario records and inspect their manual assessments, requests, recorded conditions and source revisions together. Selection is read-only, scoped to the project and feature, and restores after restart. Interrupted, stale, unavailable and incomplete evidence remains explicit; no replay or visual-verification verdict is inferred.

Foundation 0.31 was verified and installed: 996 desktop tests, desktop TypeScript and both packaged scenario/comparison workflows pass. The tested bundle, Orbit saved source, unsaved draft and workspace restoration are verified. Laptop and physical input/display acceptance are paused at the user's request while equipment is obtained. Paired visual capture follows in 0.32 above. [Verification](../artifacts/verification-v0.31.md) · [Comparison guide](observation-comparison.md).

## Maintained-source endurance and Send continuity — 0.30

Foundation no longer temporarily disables Ask when background refresh assesses an empty, healthy change group. Ownership checks and real operation locks remain intact.

Foundation 0.30 was verified: 962 desktop tests, desktop TypeScript, two packaged workflows, a 120-transaction activation diagnostic, ten-minute qualification and an actual two-hour native session pass. The maintained-source workload records 72,000 measured keys, 17.90 ms aggregate synthetic renderer p95 and 14,970 refreshes. Exact drafts and history survive restart; normal Orbit source, unsaved draft and latest workspace state remain intact. Laptop and physical keyboard-to-display measurement remain open. [Verification](../artifacts/verification-v0.30.md) · [Protocol](real-project-endurance.md).

## Source refresh and Assistant continuity — 0.29

Foundation shares source analysis within each refresh, sends changed retained history records to each panel, builds collapsed history or feature-editor contents only when opened, and retains unchanged plain Assistant response DOM while refreshing current evidence and controls. Source freshness and ownership checks remain immediate. Assistant Send/Stop, source context, mode controls, workspace activity buttons and lazy workspace disclosures preserve native activation through background refreshes.

Foundation 0.29 was verified: 323 project tests, 952 desktop tests, both TypeScript checks and nine packaged workflows pass. Both 0.28 and 0.29 complete the matched 4,200-key generated-scale/restart gate. Whole refresh median is 36.09 s → 627.5 ms in this generated fixture comparison; faster refreshes complete more cycles. Orbit source, unsaved draft and layout remain intact. These historical results precede the maintained-source/workstation acceptance in 0.30 above. [Verification](../artifacts/verification-v0.29.md) · [Contract](populated-history-performance.md).

## Populated history and project scale — 0.28

Foundation fixes sustained runtime observations by reserving keepalive for pagehide and consuming instrumentation acknowledgments. It also reuses source digests across historical observations while checking freshness on every update. The bounded host benchmark reduces full runtime snapshot median from 10.42 to 5.55 ms; history copying remains a separate cost.

Foundation 0.28 was verified: 895 desktop tests, a final 11-case focused rerun, TypeScript and five packaged workflows pass. The generated fixture adds more than 1,400 files, 100 synthetic conversation turns and 4,000 synthetic history records. The unchanged 0.27 baseline fails sustained runtime liveness; 0.28 completes all 4,200 measured keys and restart. Drafts and histories survive restart. These historical results precede the maintained-source/workstation acceptance in 0.30 above. [Verification](../artifacts/verification-v0.28.md) · [Contract and commands](populated-history-performance.md).

## Editor responsiveness — 0.27

Moving within the current source file no longer schedules redundant indexing. Repeated typing keeps unchanged saved-source snapshots out of the workspace and Assistant update path; the first dirty transition still blocks affected evidence immediately. The latest caret is preserved when quitting.

Foundation 0.27 was verified: 882 desktop tests, desktop TypeScript and four native workflows pass. A paired native benchmark records synthetic typing under AI streaming, indexing and runtime load; physical keyboard-to-display and long-session acceptance remain open. [Verification and measured results](../artifacts/verification-v0.27.md) · [Contract](editor-responsiveness.md).

## Code suggestions — 0.26

Run **Foundation: Start Code Suggestions** to enable native ghost completions for this session after reviewing the sharing disclosure. Tab accepts, Escape dismisses, and native word/line acceptance and Undo remain available. Nearby changes appear as **Next edit**; **⌥⌘N** opens a guarded diff before explicit acceptance. Pause stops automatic requests. [Contract and limits](code-suggestions.md).

Foundation 0.26 was verified: 305 project tests, 873 desktop tests and four packaged native workflows pass. Both themes and Orbit restoration were inspected; the original unsaved draft remains intact. Provider checks and latency measurements use local fixtures. Normal Orbit AI stays disconnected and suggestions off. [Verification](../artifacts/verification-v0.26.md).

## Inline selection editing — 0.25

Select code and press **⌥⌘E**, describe the change, then review the native diff. **⌥⌘Enter** accepts; **Escape** dismisses and returns to the original source. Native Undo restores the prior draft. Only the selected text, language and instruction are shared. Source changes and cancellation invalidate pending suggestions. [Contract and limits](inline-selection-editing.md).

Foundation 0.25 was verified: 268 project tests, 840 desktop tests and five packaged native workflows pass. Native Dark/Light review and Orbit restoration preserve the unsaved draft. Provider checks used local fixtures; normal Orbit AI remains disconnected. Completion and nearby-edit assistance follow in 0.26. [Verification](../artifacts/verification-v0.25.md).

## Selected changes — 0.24

Choose changes derives conservative acceptance units from the original and proposed saved source. Linked files stay together; unknown dependencies keep the whole proposal atomic. Review exact scope, Apply selected, then Undo accepted without overwriting skipped changes. [Contract and limits](partial-acceptance.md).

Foundation 0.24 was verified: 238 project tests, 811 desktop tests and eight packaged workflows pass. Native Dark/Light review and Orbit restoration preserve the unsaved draft. Splitting is limited to closed scalar TS/JS modules; unsupported dependencies, React and CSS remain whole-proposal changes. [Verification](../artifacts/verification-v0.24.md).

## Investigation checkpoints — 0.23

Continue a completed source-investigation answer through explicit, inspectable steps. AI can propose one known source target or finish; Run analyzes it locally, Share result prepares the next request, and Send shares the disclosed context. Each chain has three model attempts and two local attempts, including failed or interrupted work. Restart resumes no work automatically.

See [the continuation contract](investigation-continuation.md) and [the running acceptance checklist](product-checklist.md). [0.23 verification](../artifacts/verification-v0.23.md) records 232 project tests, 771 desktop tests, eleven packaged workflows, native Dark/Light acceptance and installation with the Orbit draft preserved.

## Source investigations — 0.22

Choose Ask about relationships to prepare a bounded local investigation in Assistant. Inspect the selected file, source relationships, request sites and analysis limits, then explicitly Send your question. The exact shared result stays in conversation history; restored unsent investigations require a local refresh before sharing. Saved-source revisions and affected drafts are checked throughout. Related file contents remain outside this handoff.

See [source investigations](source-investigations.md) for sharing, recovery and analysis boundaries. [0.22 verification](../artifacts/verification-v0.22.md) records automated, packaged, native visual and installation checks; the [running checklist](product-checklist.md) tracks remaining work.

## AI-recommended check plans — 0.21

Prepare a staged workspace, review the source and supported check names to share, then ask AI for a recommendation. Edit the suggested selection, save it as a check plan, and run each check explicitly. Reasons remain AI interpretation; command results remain local evidence. [AI check suggestions](ai-check-suggestions.md) · [0.21 verification](../artifacts/verification-v0.21.md) · [Running checklist](product-checklist.md).

## Saved check plans — 0.20

Save an ordered plan of supported isolated checks, then explicitly run one step at a time. Inspect each result before running the next check, retrying, skipping or ending the plan. Restart returns to the saved decision without rerunning a check. Each attempt uses a fresh copy of the exact recorded source snapshot. [Check plans](check-plans.md) · [0.20 verification](../artifacts/verification-v0.20.md) · [Running checklist](product-checklist.md).

## Refine staged changes — 0.19

Refine group prepares a Build request with explicit staged-source sharing. A completed revision becomes a new change group against the same original source, retaining earlier versions and their checks. Inspect previous versions or explicitly restore a compatible staged version; no source changes until Apply all. Interrupted or failed provider responses retain the current group. [Staged group revisions](staged-group-revisions.md) · [0.19 verification](../artifacts/verification-v0.19.md) · [Running checklist](product-checklist.md).

## Revise an AI request — 0.18

Use **Stop and revise** during a saved response, or **Revise request** from its history, to prepare the original instruction and saved source selection. Edit the instruction and explicitly Send a new request. Earlier output remains intact; the new request retains its parent link. Preparation and restart never contact the provider, and previous answers or tool output are not automatically shared.

The host checks every selected saved file and native draft before preparing and sending. A typed draft is preserved. Task and runtime context must be chosen again; plan-derived Build requests return to their plan's preparation flow. Existing staged source groups still require their own review/Apply/Undo decisions. See [request revisions](request-revisions.md) and the [running checklist](product-checklist.md).

## Isolated tool checks — 0.17

Before applying a staged group, **Prepare workspace**, choose an available Node test or TypeScript check, and **Run check**. Foundation checks the proposed code in a separate saved-source copy with visible output and Stop. Network access and writes outside the copy are blocked; local files remain readable. Results survive restart, and execution never resumes automatically. Apply remains a separate action.

See [isolated tool checks](isolated-tool-checks.md) for supported projects, process boundaries and limits. Live agent steering and broader tool execution remain subsequent checklist items.

## Isolated change groups — 0.16

Direct Build can stage a coordinated group of two to eight selected existing files. Review every staged diff, then Apply all or Undo all with revision and native-draft protection. External local checkpoints record progress and support explicit recovery after interrupted writes. Generation and restart do not change project source.

See [isolated change groups](isolated-change-groups.md) and the [running checklist](product-checklist.md). This increment stages source snapshots. Supported fixed tool checks arrive in 0.17; broader agent execution and source-group steering remain separate child tasks.

## Four AI workflows — 0.15

The Assistant separates explanations, plans, source proposals and source reviews. Plans retain their original AI output and explicit local revisions; edit text, reorder steps and choose included scope. Prepare one supported step for Build, review its source/context, then send separately. Review findings link to validated source and keep unexecuted verification explicit. Existing Apply/Undo protections remain in place.

See [AI workflows](ai-workflows.md), [0.15 verification](../artifacts/verification-v0.15.md) and the [running checklist](product-checklist.md). The plan-step handoff still prepares one existing file; direct Build gains coordinated groups in 0.16.

## Feature relationships — 0.14

Understand now follows the active feature into rendered components, function calls, types, styles, imports, consumers, test references and request sites. Open an exact evidence or definition location, or Explore a connected file without changing feature membership or Assistant context. Saved revisions, affected drafts and newer focus changes guard navigation. The source trail resumes after restart while evidence is rebuilt.

The 0.14 relationship increment is retained in subsequent builds. See [feature relationships](feature-relationships.md), [0.14 verification](../artifacts/verification-v0.14.md) and the [running checklist](product-checklist.md). Request expressions remain separate from runtime observations; filename test suggestions remain separate from proven source references. Use `npm run desktop:relationships-smoke` for the packaged native workflow.

## Restart continuity — 0.13

Foundation restores its workspace tab in the original native group and resumes Understand, Refine or Review without taking focus from source. The Assistant retains an unsent question, intent, explicit source choices and task-brief inclusion within the same project, feature and conversation. Missing source remains visible and blocks sending until resolved. No provider request or runtime starts during restoration.

The 0.13 restart increment is retained in subsequent builds. See [restart verification](../artifacts/verification-v0.13.md), [restart restoration](restart-restoration.md) and the [running checklist](product-checklist.md) for evidence and migration behavior. Run `npm run desktop:restart-smoke` for the isolated two-process native regression.

## Runtime screens and manual scenarios — 0.12

Connect a feature to named runtime screens and define scenarios with manual steps and expected outcomes. Opening a screen explicitly navigates its target; observing a scenario records its session, document, saved-source revisions and request evidence. Your assessment stays separate from that evidence. Disconnects, navigation and source changes interrupt safely, while history retains its original definitions and marks stale or unknown source.

See [runtime scenarios](runtime-scenarios.md) and the [increment checklist](product-checklist.md). See [0.12 verification](../artifacts/verification-v0.12.md) for packaged tests, native walkthrough and preserved Orbit draft. Automatic scenario replay and comparison remain later work.

## Feature workspaces and task context — 0.11

Create a feature in **Understand** to keep its brief, chosen files and primary source together. Foundation suggests direct imports and consumers separately from possible tests identified by filename. Membership is explicit, saved locally, and can be archived and restored.

**Use in Assistant** prepares available saved files without sending a request. **Include task brief** controls whether its title and brief accompany your question; source and runtime observations remain separate choices. Requests preserve the original task context for later review. See [feature workspaces](feature-workspaces.md), the [running checklist](product-checklist.md), and [0.11 verification](../artifacts/verification-v0.11.md). The 0.11 feature slice was checked in the normal Orbit profile and is included in installed 0.12. Native feature creation, source navigation, saved-file context preparation, dirty-file exclusion and Assistant collapse/restore were verified. The saved-source canvas and empty Review state were inspected in Foundation Dark, with a transient Foundation Light preview; the original dark theme was restored and the unsaved Orbit file reopened.

## Connected web foundation — 0.10

Refine can start an instrumented local Vite target or connect one already running. Select an element to follow its saved JSX location, inspect measured properties, and examine sanitized fetch/XHR observations. Requests are an observed timeline; they do not imply an uninstrumented backend trace. The running project uses its own build pipeline and live network. The saved-source sandbox remains available separately.

Assistant supports OpenAI Responses, Anthropic Messages, and compatible Chat Completions endpoints, with separate native credentials. Runtime observations are opt-in context and remain attached to the original conversation turn. Single-file proposals retain guarded Apply/Undo; autonomous multi-file tools, screenshots, and reproducible scenario comparison remain later milestones.

Track every accepted capability in the [running product checklist](product-checklist.md). Direct-provider protocol fixtures are verified separately from live commercial-provider acceptance; see [0.10 verification](../artifacts/verification-v0.10.md) for what has actually run. The connected runtime is included in installed 0.12. Its strengthened packaged check proves an App-to-SaveButton source-focus transition; live OpenAI/Anthropic acceptance and physical latency/load measurements remain open.

## Clarity pass

Foundation 0.9 simplifies the native workspace around the current task. Understand shows direct source relationships; Refine prioritizes the canvas and selected properties; Review leads with current changes and collapses previous proposals. Assistant stays independent of those activities, with visible setup or source blockers beside the composer. Supporting evidence and request details remain available through disclosures. See the [surface audit and acceptance checklist](clarity-pass.md).

## Run the browser workbench

Requirements: a current Node.js LTS release and npm. Run these commands from the repository root:

```sh
npm install
npm run dev
```

Open [Foundation at localhost:4173](http://localhost:4173). The development command runs the interface on port 4173 and its local API on port 4174. Keep both processes running while exploring the workspace.

```sh
npm run check
npm test
npm run build
```

With `npm run dev` still running, use `npm run test:e2e` for the browser workflow suite. If Chromium is not installed for Playwright, run `npx playwright install chromium` once.

`check` validates the TypeScript project, `test` exercises automated behavior, and `build` produces a production frontend build. A successful build does not establish native adapter support, extension compatibility, or visual acceptance.

## Try the browser project workbench

1. Open the preview to explore the included multi-file Orbit project.
2. Use **Understand** to follow imports, consumers, symbols, and source-level API calls.
3. Use **Build** to edit files in independent tabs. **Cmd/Ctrl+P** finds files, **Cmd/Ctrl+Shift+F** searches the project, and **Cmd/Ctrl+S** saves the active draft.
4. Use **Refine** to inspect the sample's live desktop/mobile preview and open a visible component's source. Saved source and shared styles update that preview.
5. Use **Review** to compare saved edits and safely revert Foundation's changes.
6. Open **Assistant** to select source context and ask a configured model. See [AI provider setup](ai-provider.md).

In the browser workbench, **Open folder** connects another local source folder. Its files support the same editing, search, analysis, and review workflow. Live preview and element mapping are available only for the included sample. Project scripts are discovered but never run automatically.

Drafts stay in their tabs until saved or discarded. Saves and reverts check the exact source revision and refuse to overwrite unexpected disk changes. The browser workbench’s change journal is session-only; saved files persist. Refresh discovers external edits. See [workbench details and limits](workbench-increment.md).

## Connected walkthrough

The **Connected walkthrough** button opens the original signature-flow prototype:
select the Save button, inspect its real local request, review a scripted behavior or
visual proposal, apply it to source, run TypeScript verification, and undo it safely.
The proposal is deterministic; it is not generated by the assistant. Its managed fixture
is `fixtures/web/src/SaveButton.tsx`, separate from `projects/orbit`.

## Blueprint

| Document | What it decides |
| --- | --- |
| [Complete functionality](functionality.md) | All current product surfaces, workflows, limits, commands, and remaining milestones. |
| [Repository guide](repository.md) | Source layout, clone/build/check commands, and local evidence boundaries. |
| [Product](product.md) | Audience, principles, positioning, prioritized capabilities. |
| [Experience](experience.md) | Information architecture, flows, recovery behavior. |
| [Design system](design-system.md) | Typography, surfaces, interaction, accessibility, motion. |
| [Architecture](architecture.md) | Code OSS, subsystem boundaries, adapter and evidence contracts. |
| [Delivery plan](delivery-plan.md) | Feasibility gates, dependency order, release criteria. |
| [Validation](validation.md) | Acceptance scenarios, research script, required evidence. |
| [Desktop host](desktop-host.md) | Code OSS build, native integration, maintenance, and current boundaries. |
| [Clarity pass](clarity-pass.md) | Surface inventory, content hierarchy, decisions and acceptance. |
| [Assistant sidebar](assistant-sidebar.md) | Native right-side AI, keyboard access, sizing and state continuity. |
| [Durable conversations](durable-conversations.md) | Local history, recovery, source snapshots, and historical verification. |
| [AI workflows](ai-workflows.md) | Ask, Plan, Build, Review, editable plans and explicit one-file step handoffs. |
| [Local workbench increment](workbench-increment.md) | Implemented workflows, source ownership, current limits. |

## Implementation boundary

| Available in the current bounded implementation | Remaining scope |
| --- | --- |
| Source-built Code OSS host with native editing, search, Git, terminals and debugging surfaces | Production signing/notarization, updater, extension compatibility and broader acceptance |
| Named feature workspaces, focused JS/TS relationships, revision-aware source context | General language/project graph coverage and deeper dependency analysis |
| Saved-source React sandbox and instrumented React/Vite runtime with selection and request observations | Broader frameworks, native runtime mapping and instrumented backend tracing |
| Ask/Plan/Build/Review, editable plans, durable conversations, isolated change groups and supported local checks | Live OpenAI/Anthropic acceptance, broader steering and general tool orchestration |
| Inline selection edits, session-enabled code suggestions, guarded Apply/Undo and conservative partial acceptance | General dependency-aware partial acceptance and hardware performance gates |
| Scenarios, app-authored replay, state suites, condition matrices, paired captures and scoped alternatives | General automatic reproduction, visual assessment and source-to-pixels verification |
| Local decisions, captured issues and searchable project knowledge | Broader knowledge workflows, retention and team review |
| Project readiness, selected Xcode builds/tests and connected Swift editor intelligence | SwiftUI preview/Simulator workflows, React Native/Expo and Android integration |
| Current light/dark themes and interactive design references | M6: create the new visual/motion system first, then apply it app-wide last |

The [functionality reference](functionality.md) defines each capability's exact boundary. Historical release sections above describe their original increment; later workflows can supersede those limits.

No commercial AI provider is connected by default. Standard editing works without AI.
The resource library and portfolio projects are not dependencies or implementation targets.

## Verification

The runtime and Chromium suites cover the original walkthrough and the new project
workbench. TypeScript and the production build validate both the workspace and sample.
See the [feature workspace and installed 0.11 record](../artifacts/verification-v0.11.md), [connected runtime record](../artifacts/verification-v0.10.md), [clarity verification record](../artifacts/verification-v0.9.md), [sidebar verification record](../artifacts/verification-v0.8.md), [conversation verification record](../artifacts/verification-v0.7.md), [native workspace record](native-workspace.md), [AI/design verification record](../artifacts/verification-v0.4.md), [desktop host record](../artifacts/verification-v0.3.md) and [browser workbench record](../artifacts/verification-v0.2.md) for results and limits,
and the [original milestone record](../artifacts/verification.md) for the first prototype.
