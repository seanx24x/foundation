# Foundation functionality reference

Product and implementation inventory · Foundation 0.47.0 · 2 November 2026

**Foundation connects the running product to its code, data and behavior, with AI assistance that exposes its context and keeps changes reviewable.** This reference describes the complete intended product and the functionality currently implemented. It is a product map, not a claim that every intended capability is finished.

The [running product checklist](product-checklist.md) is authoritative for acceptance status, dependencies and remaining work. Workflow documents linked below explain individual contracts. Some were written for earlier releases; this reference uses the current checklist to distinguish features added later from still-open boundaries.

## Contents

1. [Product principles and status](#1-product-principles-and-status)
2. [Workspace and navigation](#2-workspace-and-navigation)
3. [Code writing and editing](#3-code-writing-and-editing)
4. [Project and feature understanding](#4-project-and-feature-understanding)
5. [AI collaboration](#5-ai-collaboration)
6. [Review, changes and execution](#6-review-changes-and-execution)
7. [Running product and API evidence](#7-running-product-and-api-evidence)
8. [Visual design and refinement](#8-visual-design-and-refinement)
9. [Scenarios, states and verification](#9-scenarios-states-and-verification)
10. [Alternatives, decisions and knowledge](#10-alternatives-decisions-and-knowledge)
11. [Platform support and native tooling](#11-platform-support-and-native-tooling)
12. [Data, safety and recovery](#12-data-safety-and-recovery)
13. [Commands and settings](#13-commands-and-settings)
14. [Engineering and validation](#14-engineering-and-validation)
15. [Remaining functionality and release gates](#15-remaining-functionality-and-release-gates)
16. [Capability traceability](#16-capability-traceability)

## 1. Product principles and status

Foundation is designed for design engineers working across implementation, interface design and product behavior. Its four connected activities are **Understand, Build, Refine and Review**. Moving between them should retain the selected feature, source, task and evidence.

The product principles are:

- **Code is authoritative.** Visual experiments and model suggestions become source changes only through an explicit review and application flow.
- **Context stays visible.** Show what is selected, what will be shared, its source revision and its limitations.
- **Evidence has a type.** Distinguish From source, Observed, AI interpretation and Unknown. Freshness is separate from provenance.
- **Protect the user's work.** Preserve drafts, focus, layout, unrelated edits and the ability to stop. Do not save or discard a draft to make another operation possible.
- **Make the next action clear.** Use direct labels, progressive disclosure and specific recovery actions. Dense professional functionality should remain navigable.
- **Keep core editing independent.** Source editing remains usable while AI is disconnected, indexing is busy or a runtime is unavailable.
- **Verify each claim separately.** Generation, compilation, execution, interaction, visual quality and accessibility are different outcomes.
- **Design for craft and continuity.** Light and dark themes, precise geometry, keyboard access and interruptible motion are product requirements, not decoration.

See [product principles](product-principles.md), [product direction](product.md) and [experience architecture](experience.md).

### Reading the status labels

| Label in this reference | Meaning |
| --- | --- |
| **Implemented · bounded acceptance** | The stated implementation has demonstrated acceptance within its documented fixture, host and scope. This does not certify arbitrary projects or complete a broad parent capability. |
| **Inherited** | Available through the source-built Code OSS platform. Foundation-specific compatibility, performance and release validation remain separate. |
| **In progress** | Useful slices exist, but the broader capability or its acceptance gate is incomplete. |
| **Planned** | Intended functionality that has not started or is not implemented in the described scope. |
| **Blocked / Paused** | Work needs an identified prerequisite, or the user has explicitly paused it. |

The current desktop is an **Apple Silicon macOS development build based on Code OSS**, with Foundation's extension, runtime adapter and host integration. It is not Microsoft's Visual Studio product. The repository also contains a browser workbench, fixtures, design references and engineering tools. The desktop is the primary implementation; the browser workbench is not feature-equivalent.

## 2. Workspace and navigation

**Status: implemented · bounded acceptance, with native editing inherited from Code OSS.**

| Surface | Functionality |
| --- | --- |
| Project navigator | Open local folders; retain native Explorer and file navigation; access Foundation source context and activity commands. Workspace trust controls access to project-sensitive operations. |
| Native editor | Source tabs, split groups, selections, native diffs, search, navigation, diagnostics, terminals, debugging and source control. |
| Understand | Inspect saved source, focused relationships, feature working sets, runtime observations, comparisons and project knowledge. |
| Build | Work in the native editor; prepare AI implementation through Assistant; inspect staged source changes and supported checks. |
| Refine | Use the saved-source design sandbox or an instrumented running web app; inspect elements, experiment with tokens, run scenarios and compare alternatives. |
| Review | Inspect exact source proposals, change groups, scope, checks, visual-change evidence, decisions and issues before source actions. |
| Assistant | Expandable and collapsible **far-right native sidebar**, independently resizable beside source or the running product. Holds request context, composer, modes, history and artifacts. |
| Project Setup | Explicit local project/tooling diagnostics, capability boundaries and recovery guidance. |
| Xcode Project | Explicit project/scheme/destination discovery, build, tests and Swift language connection. |
| Bottom panel and command palette | Native terminal, Problems, output/debug surfaces and searchable commands remain available. |

The workspace preserves native tab placement and editor groups rather than opening duplicate Foundation tabs after restart. A workspace explicitly closed by the user remains closed. Foundation restores identity-bound unsent Assistant text, mode, chosen source and task inclusion. It retains supported exploration locations, selections and local history without automatically restarting providers, runtimes, recipes, checks or Swift language services.

Collapsing Assistant preserves the conversation, prompt draft and active response. Background source updates are designed to retain current focus and supported disclosure state. Restoration acceptance includes native dirty buffers and normal hot-exit behavior; it is not a guarantee of recovery from every crash or power loss.

References: [native workspace](native-workspace.md), [Assistant sidebar](assistant-sidebar.md), [restart restoration](restart-restoration.md), [clarity pass](clarity-pass.md).

## 3. Code writing and editing

### Native editor fundamentals

**Inherited:** text editing, syntax support, native suggestion widgets, multi-file navigation, split editors, find/replace, project search, terminals, source control, debugging surfaces, settings and keyboard commands. Language/debugger capability depends on available, appropriately licensed extensions and toolchains. Inherited functionality is not blanket acceptance of every extension or language.

**Foundation additions:** connected source understanding, exact-source navigation, native proposal diffs, feature working sets, AI inline editing, current-file suggestions and target-aware Swift intelligence.

### Selected-range AI editing

**Implemented · bounded acceptance.** Select a range and run **Edit Selection with AI** (`⌥⌘E`). Enter an instruction, inspect the native read-only diff, then explicitly accept (`⌥⌘Enter`) or dismiss (`Escape`). Acceptance is one native edit with native Undo; Foundation does not call Save. Existing user auto-save settings continue to apply.

Only the selected text, language and instruction are shared. This workflow can include the selected unsaved text; it does not share the entire document, file path or conversation history. The initial limit is one selection up to 16 KiB in a supported file under 256 KiB. Full-document identity, version, source and owner checks reject stale suggestions. Multi-cursor transformation and durable inline history remain open.

### Code completions and nearby edits

**Implemented · bounded acceptance.** **Start Code Suggestions** presents a sharing disclosure and explicitly enables the session. Native ghost text supports Tab, Escape, word/line acceptance and Undo. A nearby replacement appears as **Next edit**; `⌥⌘N` opens a guarded diff before acceptance.

Context is restricted to the current file: up to twenty preceding lines and ten following lines, each side capped at 6 KiB, plus the language. It can include unsaved text. Paths, other files, history and runtime evidence are excluded. Requests have a ten-second timeout and a rolling twenty-per-minute limit. Pause cancels the session; restart leaves suggestions off. Insertions and nearby replacements are bounded and validated. Repository-wide completion context and cross-file next edits remain planned.

### Responsiveness

**In progress.** Foundation avoids redundant indexing on same-file caret movement, shares source analysis within a refresh, delivers changed retained-history records and constructs collapsed sections on demand. Generated-scale checks and a maintained-source two-hour workstation run have recorded acceptance. These are measured workloads, not a universal performance guarantee. Representative laptop and physical keyboard-to-display measurements are paused pending equipment.

References: [inline selection editing](inline-selection-editing.md), [code suggestions](code-suggestions.md), [editor responsiveness](editor-responsiveness.md), [populated history performance](populated-history-performance.md), [endurance protocol](real-project-endurance.md).

## 4. Project and feature understanding

### Local source inventory

**Implemented · bounded acceptance.** Foundation indexes supported saved source locally and exposes file/source context. Saved-source revision, missing source, unsaved draft and unavailable analysis are distinct. The standard inventory is bounded to 1,500 indexed files, 8 MiB total source and 256 KiB per file; truncation and unsupported inputs are visible.

### Feature workspaces

Create a named local feature with a task brief, explicitly selected files and optional primary file. Edit membership, select an existing feature, archive/restore and open its primary file. Source-backed imports and consumers can suggest membership; filename-based possible tests are separately labeled. Suggestions never silently change the feature.

A feature can include named runtime screens and scenarios. A screen binds a stable runtime target and safe relative route. A scenario records steps and expected outcome. Use the feature in Assistant to prepare its saved source and optionally its task brief; sending remains explicit. Metadata is revision-guarded and survives restart.

### Focused relationships

Understand groups supported component renders, function calls, type references, imports/re-exports, styles, consumers, test references and request sites. Open an evidence location, navigate to a resolved declaration or **Explore** related source. **Back** follows the exploration trail; **Reset** returns to the feature's primary source. Exploration does not change feature membership or Assistant context.

Relationships use saved JavaScript/TypeScript syntax and local symbol resolution. Direct consumers are distinguished from possible tests. A test reference is not coverage. Static `fetch` locations are not observed requests. Dynamic dispatch, package resolution, aliases, runtime ownership, ambiguous exports and uninstrumented server behavior may remain unresolved. This is a focused source explorer, not a complete system graph.

Evidence links recheck source revisions, inventory, native drafts, workspace trust and ownership before navigation. Changed evidence becomes stale; missing evidence becomes unknown. Unsupported or ambiguous targets do not acquire fabricated locations.

### Source investigations

Prepare a bounded relationship investigation in Assistant, inspect the local evidence and explicitly send a question. Related source bodies are not silently included. A completed investigation can continue through explicit model-proposed known source targets: review the proposal, run its local analysis, prepare the result and send again. A chain allows three model attempts and two local attempts, including failed or interrupted work. This is a bounded investigation workflow, not a general autonomous tool loop.

References: [feature workspaces](feature-workspaces.md), [relationships](feature-relationships.md), [runtime scenarios](runtime-scenarios.md), [source investigations](source-investigations.md), [investigation continuation](investigation-continuation.md).

## 5. AI collaboration

### Providers and explicit context

**Implemented · bounded protocol/native acceptance; live paid-provider acceptance blocked.** Foundation implements OpenAI Responses, Anthropic Messages and compatible Chat Completions transports. Users choose a provider, destination where applicable and model. Provider profiles are application-level; credentials are separately scoped in native credential storage. No provider is connected by default. Foundation does not install or start a local model.

Assistant discloses the prompt, selected saved source, optional task brief and supported explicitly selected evidence. Ordinary saved-source requests allow up to eight files totaling 64 KiB. Selected dirty files are blocked rather than silently sharing or saving their drafts. Inline editing and suggestions use the separate, disclosed unsaved-text contracts above.

Supported request context includes selected current runtime observations, a prepared source investigation, compatible plan/check/revision context, up to four current project decisions and one captured issue, subject to the workflow's own exclusions and freshness checks. Context types are not freely combined when their contracts conflict. Previous conversation turns and tool output are not automatically appended. Captures remain local; screenshot bytes are not sent through these workflows.

The app shows provider-reported usage when present and **Usage not reported** otherwise. It does not invent billing or cost estimates. Broader cost budgets, provider-quality evaluation and additional provider/agent integrations remain future work.

### Four modes

| Mode | Current result | Explicit stopping point |
| --- | --- | --- |
| Ask | Source-grounded answer with validated source references and disclosed evidence. | Explanation only. |
| Plan | Structured plan with up to sixteen steps, references, risks and suggested checks. | Saved plan; no automatic execution. |
| Build | Proposal for one existing selected file or a coordinated group of two to eight existing selected files. An explicit alternatives option can produce two candidates. | Staged or retained proposed source; review and Apply remain separate. |
| Review | Findings on selected saved source, severity, references, suggestions and limitations. | AI interpretation; not automatic Git diff review, test success or product verification. |

Plans retain immutable original output and saved local revisions. Users can edit wording, reorder steps and include/exclude existing steps. A supported step with references to one existing file can prepare Build. That handoff preserves its plan identity and source basis; multi-file plan-step execution and arbitrary step authoring remain outside the current slice.

### Conversation and request controls

Create conversations, browse history and archive/restore locally. Each request retains its original saved source, source revisions, explicitly included context, provider/model metadata, response and structured artifacts. Historical content remains available offline. A current prompt is distinct from what was shared earlier.

**Stop** retires the local request and aborts its stream; valid partial output remains. This cannot guarantee that the remote provider stops processing or billing. **Stop and revise** or **Revise request** prepares a new request linked to the previous one, preserving its original output. The user reviews and sends it explicitly. Restart marks unfinished work interrupted and never resends it.

### AI artifacts

Implemented artifact behavior covers context, explanations, active request state, plans, review findings, code changes/change groups, check recommendations/results, investigation continuations, alternatives and supported decision/issue handoffs. Objects retain identity, scope, provenance, freshness and supported actions across compact, expanded and historical views. A historical card cannot grant source-write authority after its host checkpoint is superseded.

The broader artifact design contract also describes documents, diagrams, tables, charts, images, executable interactive content and file bundles. **The reference catalog does not establish all of those as working AI output integrations.** General artifact generation/export, image understanding and automatic model memory remain planned.

References: [provider setup](ai-provider.md), [four workflows](ai-workflows.md), [durable conversations](durable-conversations.md), [request revisions](request-revisions.md), [native artifacts](native-ai-artifacts.md), [artifact design contract](ai-artifacts.md).

## 6. Review, changes and execution

### Source proposals and change groups

**Implemented · bounded acceptance.** Foundation validates exact source correspondence, permitted targets and complete responses before exposing applicable changes. Review opens native diffs with baseline, proposed source and known scope. Generation does not write project files.

Single-file **Apply to source** and multi-file **Apply all** recheck saved source, native drafts, trust, project identity and checkpoint ownership. **Undo Foundation change** or **Undo all** restores only the exact applicable targets while they still match Foundation's applied result. Later edits block unsafe automatic Undo; unrelated edits remain intact. Discard removes proposed work without writing source. Dismissing an applied checkpoint retains the source change and ends its guarded Undo path. None of these creates a Git commit or publishes.

Change groups retain original source, staged source, intent and an independent local transaction journal. Interrupted writes require explicit recovery; reopening or retrying storage never silently resumes source mutation.

### Refine and compare staged versions

**Refine group** prepares another Build request with explicit staged-source sharing. A completed revision becomes a new group against the same original saved-source basis. Earlier versions and their checks remain inspectable. Users can explicitly restore a compatible staged version. Failed or interrupted generation preserves the current group.

### Partial acceptance

**Choose changes** derives conservative dependency-connected acceptance units from original and proposed source. Users select pending units, **Apply selected**, then **Undo accepted**. The current support is a closed family of scalar JavaScript/TypeScript modules. Unknown dependencies, effects, JSX, stylesheets and unsupported constructs keep the whole proposal atomic. Typical React/style changes therefore remain whole-group operations. Full-proposal checks do not certify a selected subset.

### Isolated checks

**Prepare workspace** copies saved inputs and local dependencies into Foundation-owned storage and overlays the exact staged source. Preparation does not run project code. Choose a supported fixed check, then **Run check**:

| Check | Supported scope | Meaning of success |
| --- | --- | --- |
| Node tests | Up to 64 recognized local JavaScript test/spec files. | The fixed Node command exited successfully against that copied snapshot. |
| TypeScript | Root `tsconfig.json` and an available regular local TypeScript compiler. | The copied compiler completed `--noEmit` successfully. |

The macOS execution policy restricts network, child processes, IPC delegation and writes to original source. **Processes retain local read access; this is not a confidentiality sandbox for untrusted code.** Missing execution protection disables the workflow. Arbitrary shell commands, package installation, general package scripts and network-dependent checks are unsupported.

Each run retains command, source/checkpoint identity, bounded output and outcome. Runs time out after sixty seconds, with visible Stop and owned-process cleanup. A fresh copy is required for each attempt. Generated files stay in that copy. A passing command does not certify visual quality, accessibility or missing test coverage.

### Check plans and recommendations

Save an ordered plan of supported checks. **Run next**, **Retry**, **Skip** and **End** are separate decisions; execution pauses between steps. Restart restores the next decision without running it. AI can recommend a selection from available check names after explicit disclosure; users edit/save the recommendation and run each check themselves. Model reasons remain interpretation; command output remains local evidence.

References: [change groups](isolated-change-groups.md), [staged revisions](staged-group-revisions.md), [partial acceptance](partial-acceptance.md), [isolated checks](isolated-tool-checks.md), [check plans](check-plans.md), [AI check recommendations](ai-check-suggestions.md).

## 7. Running product and API evidence

**Implemented · bounded acceptance for instrumented local React/Vite applications.**

Users review and add Foundation's development plugin to their Vite configuration. Discovery does not rewrite the project. Start a recognized local development target or explicitly connect a running instrumented loopback server. Foundation uses the project's Vite and plugins. **Stop** terminates only a process Foundation owns; an external server is detached and remains running.

**Inspect** selects a rendered element without invoking its action. Supported intrinsic JSX/TSX mappings provide source path/revision, geometry and selected computed styles. A resolved selection follows into source; background measurements, requests and hot reload do not steal editor focus. **Interact** uses the app normally.

The request timeline observes `fetch` and XHR metadata: method, sanitized URL, status, duration, outcome, timestamp and session identity. Fetch timing ends at response headers; XHR timing ends at response completion. Query strings, fragments, URL credentials, headers and bodies are excluded. Paths can still contain project information.

A request near a click is **not automatically attributed** to that component. Static request sites, browser observations and backend traces are different evidence. Backend behavior remains unknown without instrumentation. Current support does not provide full API contract discovery, request/response body inspection, backend tracing, WebSocket capture or arbitrary remote target inspection.

Each attachment has its own view/document identity. Source edits make existing mapping evidence stale; deliberate reselection establishes fresh evidence. Missing, ambiguous, disconnected and outdated mappings are visible and cannot authorize unsupported direct edits. Production builds omit development instrumentation.

References: [connected web runtime](connected-web-runtime.md), [adapter setup](../desktop/runtime/README.md).

## 8. Visual design and refinement

### Saved-source sandbox

**Implemented · bounded acceptance.** The sandbox compiles saved React source into a network-disabled iframe. It supports default/named `App` entries, relative local JavaScript/TypeScript modules, plain CSS and JSON within a 64-file/512-KiB preview graph. It does not run project scripts, a server or arbitrary build plugins. Unsupported packages, assets and framework features explain their limits.

Previewing leaves unsaved drafts intact and labels them excluded. Explicit `data-foundation-source` annotations provide file-level selection mapping. Measured dimensions, colors, typography, padding and radius describe the selected rendered element, not an unconnected production app. Missing annotations stay unmapped.

### Canvas controls and token experiments

Choose desktop/tablet/phone widths (960/768/390 CSS pixels), preview theme and Fit or 100% presentation. Theme behavior depends on application styles. Fit changes presentation scale rather than the requested viewport width.

Choose a supported CSS token declaration and experiment with a conservative color, number or length value. Temporary overrides update only the sandbox. **Reset experiments** clears them. **Review token change** prepares a scope-aware source proposal; Apply remains explicit. Saved-source changes make previous preview evidence stale; rebuild to inspect the result.

### Scope and change impact

**Inspect change impact** identifies the exact token declaration, selector scope, known direct source consumers, CSS name references and same-name declarations. **Inspect source impact** examines a mapped source file. Linked feature/scenario membership suggests checks to consider.

These are source relationships. A `var()` reference does not prove which declaration wins the cascade, that a rendered instance is isolated, or that a scenario is affected at runtime. Unknown inheritance, overrides, CSS-in-JS and complex conditions remain visible. Review freezes the inspected source basis, and Apply rechecks the full inventory.

### Current and future design systems

The app currently has Foundation Light/Dark themes, existing semantic tokens, reference components and platform-specific controls. Those are implementation and migration records. The user has explicitly scheduled a **brand-new visual and motion system** for the final milestone; the existing palette, typography, geometry and motion are not inherited constraints for that new system.

Broader direct manipulation of layout, typography, assets, variants and responsive rules; robust design-file/reference import; a motion timeline; and arbitrary instance/component editing remain intended product functionality, not completed features.

References: [design tools](ai-design-tools.md), [change impact](change-impact.md), [current design specification](design-system.md), [current tokens](../design/foundation.tokens.json), [icon/font licensing](iconography-and-licensing.md).

## 9. Scenarios, states and verification

### Manual observations

Define a feature screen and scenario, open its safe relative route, then explicitly begin an observation. Foundation distinguishes requested route, observed route and page readiness. Each observation captures its interval, runtime session/view/document identity, source hashes and actual request completions. Users enter an assessment and optional notes; an interval with requests is not automatically a passed scenario.

Source/context changes, navigation, disconnection and Stop interrupt observations safely. Finished and interrupted history remains readable, with current/stale/unknown source status. **Compare observations** shows two exact saved records side by side with their independent assessments, conditions and requests.

### Native visual captures

**Capture and finish observation** saves one actual PNG of the visible owned preview with the observation. **Finish observation** remains available without a capture. A finished observation cannot acquire a later screenshot as though it were captured at the original time.

Capture validates frame ownership, visibility, geometry and runtime identity, then crops to the preview. Adjacent editor/Assistant content is excluded. Local images have integrity, size and dimension checks and load only when explicitly selected. Paired captures show recorded conditions and source/runtime identity. They are not automatically aligned, scored or approved. Source hashes do not independently prove which compiled bytes produced the pixels.

### App-authored replay

A connected application can register named fixture preparation and action callbacks. Users explicitly select a recipe and replay its declared steps. Foundation records callback progress, request evidence, Stop and outcomes. Completed callbacks do not prove correct behavior. Cancellation is cooperative; effects already performed can remain.

A fresh runtime document does not reset cookies, local storage, service workers or external data. Full environment snapshots and general browser-input recording are not implemented.

### Condition matrices and state suites

| Workflow | Current functionality |
| --- | --- |
| Condition matrix | Run one selected recipe across 1–12 chosen width, application-theme and motion combinations, optionally capturing each result. Each cell uses a fresh document with its own observation/replay/capture. |
| Named state suite | Save 1–5 distinct app-authored recipes labeled Idle, Loading, Success, Error or Offline, with shared conditions. The total state × condition product must fit twelve runs. Definitions and historical runs remain separate. |
| Coverage/history | Show completed, failed, interrupted and Not run cells and each cell's evidence. Editing a definition does not rewrite earlier results. |
| Stop/recovery | Stop or failure halts the sequence; later cells stay Not run. Restart and storage retry never resume callbacks. |

Conditions use 390/768/960-pixel widths, Light/Dark app themes and Follow system/Reduced app motion, with a 680-pixel height. Applications must implement their declared theme/motion inputs. A state named Offline does not change the operating system's network state. Requested conditions, measured media preferences and actual app compliance remain distinct.

### Visual-change verification

Review can link an applied token proposal to explicitly chosen before/after observations and exact saved captures/replays. It retains source hashes and historical links through Undo or proposal replacement. Compilation, process results, manual interaction assessment, visual assessment, accessibility and source-to-pixels correspondence remain separate. Foundation does not infer a visual pass from a screenshot or a successful build.

References: [runtime scenarios](runtime-scenarios.md), [observation comparison](observation-comparison.md), [captures](visual-captures.md), [replay](scenario-replay.md), [matrices](condition-matrices.md), [state suites](state-suites.md), [visual-change verification](visual-change-verification.md).

## 10. Alternatives, decisions and knowledge

### Isolated alternatives

**Implemented · bounded acceptance.** Compare saved source with a proposed CSS token using owned copies, the same selected scenario and requested conditions, and independent runtime observations/replays/captures. Name and retain compatible token alternatives. Scoped multi-file alternatives extend this to whole Build groups against an identical saved feature basis.

Preparation, Run, comparison, review and adoption are separate actions. Original source stays unchanged during experiments. Retained comparisons expose provenance and incompatible or missing evidence. There is no automatic winner. **Review this group** opens native diffs before explicit Apply; guarded Undo preserves unrelated work.

### Two AI-generated candidates

In Build, enable **Explore alternatives**, choose a saved scenario and two to eight existing application source files, then describe the design brief. One explicit request produces exactly two distinct named candidates against the same source baseline. Reasoning remains AI interpretation.

Generation never stages or applies a candidate automatically. Users review each, run the retained comparison workflow and select a result for adoption. Generated candidates exclude configuration, dependencies, instrumentation, file creation/deletion and arbitrary tools. Live commercial-model quality is still unverified.

### Project decisions

After applying a retained comparison alternative, explicitly record why it was chosen. A decision retains the rationale, adopted source/checkpoint and independent comparison evidence. Changed source, Undo and superseding work do not erase the original rationale. Compatible current decisions can be explicitly included in Assistant context. General freeform project memory is not implemented.

### Reproducible issues

Capture a finished web observation as a local issue with title, reported outcome, scenario steps, source hashes, sanitized requests and any original replay/capture metadata. Historical and incomplete evidence stays labeled. The issue remains readable if underlying evidence later becomes unavailable.

Select an issue explicitly for Assistant; the request retains its source/evidence freshness assessment. Screenshot metadata and hashes can be described, but PNG bytes remain local. Capturing an issue does not rerun it or publish to an external tracker.

### Project knowledge

Understand → Knowledge searches local decisions and issues by text, kind, feature and freshness. Follow shared source, feature or retained-evidence relationships; these are navigation links, not causal claims. **Use in Assistant** prepares selected knowledge while preserving the prompt, mode and source choices. Sending remains explicit. Queries, filters and selection restore without loading captures or contacting a provider.

References: [visual alternatives](visual-alternatives.md), [reviewed adoption](alternative-adoption.md), [multi-file alternatives](scoped-multi-file-alternatives.md), [AI alternatives](ai-alternatives.md), [decisions](project-decisions.md), [issues](reproducible-issues.md), [knowledge](project-knowledge.md).

## 11. Platform support and native tooling

| Platform/surface | Current support | Still separate or unavailable |
| --- | --- | --- |
| Apple Silicon macOS desktop | Source-built Code OSS host, Foundation extension, local signed development install and native workflow acceptance. | Production signing/notarization, clean-machine distribution, updater/rollback and broad compatibility acceptance. |
| React/TypeScript + Vite | Saved-source inspection, instrumented local runtime, mapped selection, sanitized request evidence, scenarios, captures and bounded visual alternatives. | General frameworks/remote targets, complete backend/API inspection and source-to-pixels proof. |
| SwiftUI / Xcode | Explicit project readiness, supported project/scheme/destination discovery, build/test and selected-target Swift language intelligence. | Foundation preview/Simulator interaction/capture, element mapping and network evidence: M5.03. |
| React Native / Expo | Bounded static project/dependency metadata and local tooling readiness. | Actual iOS development build, runtime inspection, requests and scenarios: M5.04–M5.06. |
| Android and native macOS app workflows | Intended progressive platform expansion. | Dedicated implementation and acceptance. |
| Browser workbench | Local project source editing, search/relationships/review and explicit source questions; instrumented demonstration workflow. | Desktop feature parity, native durable conversations, desktop runtime evidence resolver and native host integrations. |

### Project Setup

Open the page, choose a local folder and explicitly **Check setup**. It reads bounded project manifests and probes fixed local tools. It distinguishes declared dependencies, installed metadata and actual capability. Missing, malformed, inaccessible, dirty and stale inputs have explicit recovery. Opening the page never installs dependencies, runs project scripts, boots a Simulator or calls AI.

### Xcode Project

Explicitly discover a self-contained project/workspace, choose a shared scheme and iOS Simulator destination, then **Build** or **Run tests**. Generic destinations support compilation; tests need a specific eligible Simulator. Results retain saved-source identity, bounded output, exit outcome and local result location. Cancel stops the owned process group.

Builds execute trusted project code, including build scripts; this is not an execution sandbox. Signing and automatic package resolution are disabled in the current workflow. Unsaved project files block execution; Foundation does not save/discard them. The maintained SwiftUI fixture has an actual app build and seven XCTest tests verified in the 0.46 milestone. That does not establish arbitrary Xcode project compatibility.

### Swift editor intelligence

**Build and connect Swift** explicitly builds and reads actual Swift compiler invocations, then asks for target/architecture. Foundation validates source membership, SDK, toolchain and compiler context before starting the selected Xcode SourceKit-LSP locally.

Target members receive native completion, Tab/Undo, target-local definition navigation, hover and versioned diagnostics. Unsaved and cross-file changes update local language context without saving or contacting AI. Editing retires stale requests; configuration/membership changes disconnect incompatible context. **Disconnect Swift** stops the owned service and removes its private compilation database. Closing the Xcode tab keeps an established connection available; restarting the app starts disconnected.

Support is bounded to validated self-contained iOS Simulator targets. Swift packages, unsupported compiler plugins/settings and generated/external sources can return unavailable. Language success is not preview, runtime, mapping, networking or visual acceptance.

References: [platform readiness](platform-readiness.md), [Xcode projects](xcode-projects.md), [Swift language](swift-language.md), [maintained SwiftUI fixture](../fixtures/swiftui/README.md), [desktop architecture](desktop-host.md).

## 12. Data, safety and recovery

### Local ownership

Indexing, feature metadata, conversations, proposals, check records, observations, captures, decisions and issues remain local by default. Native histories and captures use project-scoped Foundation profile storage outside source repositories. Prompt/source content can be sensitive; local history is not promised to be automatically redacted or encrypted.

Provider credentials are separate from request history, webviews and ordinary settings. Opening history and preparing context do not send it. Git commits, uploads, issue publication, package installation and deployment are not implied by accepting an AI artifact.

### Operation guards

Operations retain project/feature/conversation identity, source hashes, revisions, native draft state and trusted ownership. Late callbacks cannot attach to a new owner. Missing or stale source blocks applicable source actions. Stop terminates only owned processes or retires owned requests. Failed or interrupted work remains distinguishable from completed work.

Recovery actions are scoped: retry persistence, refresh source, reconnect a runtime, rediscover native settings, prepare a fresh copy or reconcile a source conflict. None silently resumes an interrupted build, tool, recipe, provider request or write.

### Bounded history

| Store/workflow | Current documented bound |
| --- | --- |
| Conversations | 20 conversations/project, 40 requests/conversation, 8 MiB project envelope. Archive retains data rather than freeing capacity. |
| Runtime scenarios | 20 screens, 40 scenarios, 40 observations with up to 100 requests each, 8 MiB envelope. |
| Visual captures | 40 captures and 128 MiB/project; individual image limits also apply. |
| State suite definitions | 20 definitions in a 512 KiB manifest. |
| Matrix/suite runs | 40 retained records in a 2 MiB manifest, subject to observation/replay/capture capacity. |
| Decisions and issues | 32 decisions and 32 issues in their respective local journals; knowledge searches these existing records. |
| Isolated check results | Current result plus twelve previous records. |

These are independent limits, not one shared quota. Admission checks, preservation and explicit capacity errors are implemented; scalable retention, cleanup and export remain release work. No silent eviction is intended. Corrupt or unsupported storage is retained with a recovery state rather than overwritten to appear empty.

## 13. Commands and settings

Commands appear in the native palette. The groups below cover all commands contributed by the current Foundation extension; controls within individual surfaces are documented in the workflow sections.

| Group | Commands |
| --- | --- |
| Workspace | Understand Source; Open in Editor; Refine Interface; Review Changes; Open Folder; Refresh Source; Maximize or Restore Editor Group. |
| Platform | Project Setup; Xcode Project; Disconnect Swift. |
| Assistant | Open Assistant; Toggle Assistant; Hide Assistant; New Conversation; Set Up AI; Remove Saved AI Key. |
| Native tools | Toggle Terminal; Search Project; Open Run and Debug; Open Source Control; Manage Workspace Trust; Show Diagnostics. |
| Runtime/preview | Run Preview; Start Running Project; Connect Running Project; Stop Running Project; Show Running Project Setup. |
| Features/knowledge | New Feature; Select Feature; Use Feature in Assistant; Open Feature Primary File; Open Feature Screen; Observe Feature Scenario; Browse Project Knowledge. |
| Selection editing | Edit Selection with AI; Review Selection Edit; Accept Selection Edit; Dismiss Selection Edit; Cancel Selection Edit. |
| Suggestions | Start Code Suggestions; Pause Code Suggestions; Request Code Suggestion; Review Next Edit; Dismiss Next Edit. |

| Default macOS shortcut | Action |
| --- | --- |
| `⌥⌘1` | Understand Source. |
| `⌥⌘A` | Toggle far-right Assistant. |
| `⌥⌘E` | Edit current selection with AI in an eligible trusted source editor. |
| `⌥⌘Enter` | Accept a ready selection/nearby edit while its review editor has focus. |
| `Escape` | Dismiss eligible inline review; native suggestion dismissal follows native editor behavior. |
| `⌥⌘N` | Review a ready Next edit from source. |

Native Code OSS bindings and user overrides remain available. The non-macOS key declarations use Ctrl+Alt, but those declarations do not establish released Windows/Linux support.

| Setting | Purpose |
| --- | --- |
| `foundation.openOnStartup` | Open Foundation on the first workspace visit; later launches respect native restoration and explicit closure. |
| `foundation.ai.providerKind` | Select compatible, OpenAI or Anthropic provider. |
| `foundation.ai.profiles` | Application-level provider destination/model profiles; never API keys. |
| `foundation.ai.baseUrl` | Legacy compatible endpoint configuration. |
| `foundation.ai.model` | Application-level model configuration. |
| Foundation Dark / Foundation Light | Native themes and preferred dark/light theme defaults. |

The manifest is the precise source for commands, binding conditions and settings: [extension package](../desktop/extension/package.json).

## 14. Engineering and validation

Source licensing is separate from product capability: Foundation-original material now has [inspection-only source terms](../LICENSE.txt), with [third-party exceptions](../THIRD_PARTY_NOTICES.md). The [public source snapshot](publication.md) is authorized; the [commercial licensing review](commercial-licensing.md) still records open legal and distribution work. This does not grant general app-use rights or establish distribution clearance.

Foundation separates its distinctive systems from the editor host:

- **Project intelligence:** safe source readers, local indexing, relationships, evidence revisions and feature metadata.
- **Runtime adapters:** Vite development instrumentation, owned process lifecycle, source mapping, requests, scenarios and capture contracts.
- **AI runtime:** provider protocols, explicit context, validated artifacts, cancellation, local history and isolated source/check workflows.
- **Review and verification:** source checkpoints, transaction recovery, native diffs, independent check outcomes and historical evidence.
- **Platform adapters:** bounded setup/Xcode operations and selected-target Swift language services.
- **Presentation:** native extension surfaces, shared webview rendering, themes/tokens and browser feasibility references.

Code OSS is source-built from a pinned upstream revision with reproducible bootstrap/build scripts. Required extension licensing and upstream-update compatibility remain explicit maintenance work. Distribution is planned around Open VSX and appropriately licensed packages; a fork does not imply access to Microsoft's proprietary Marketplace packages.

The **recorded 0.47 verification** reports **1,862 desktop tests and 403 project tests passing**, plus TypeScript checks and signed native acceptance for the maintained Swift workflow. This document does not represent a new test run. Earlier increments retain their own bounded native/renderer/fixture evidence. Paid-model quality, physical input/display performance, broad project compatibility and production distribution are not established by those counts.

Useful repository commands are `npm run check`, `npm test`, `npm run build`, `npm run desktop:check`, `npm run desktop:test` and the feature-specific native smoke scripts listed in [package.json](../package.json). Native smoke checks use disposable fixtures/profiles; they are distinct from a user-facing install or actual commercial-provider evaluation.

References: [architecture](architecture.md), [desktop host](desktop-host.md), [validation approach](validation.md), [delivery plan](delivery-plan.md), [running checklist](product-checklist.md).

## 15. Remaining functionality and release gates

The completed increments above do not close the broader product. The current next implementation is **M5.03 SwiftUI preview and Simulator evidence**. The complete remaining ledger is retained in the running checklist.

| ID / area | Remaining work | Current status |
| --- | --- | --- |
| M0.03 | Complete representative editor/project baselines, including the unresolved hardware gates. | In progress. |
| M1.11 | Real OpenAI and Anthropic coding workflows with explicit credentials and bounded paid test budget. Local fixture success cannot satisfy this gate. | Blocked. |
| M2.09; M2.09h; M2.09h.5; M2.09h.5g | Broader steerable agent/tool execution and explicit decision checkpoints beyond the supported source investigations and fixed checks. | In progress. |
| M2.10; M2.10c; M2.10c.5; M2.10c.5e | Broader precision assistance and representative sustained-load performance; repository context, cross-file next edits and broader dependency-safe acceptance remain open. | In progress. |
| M2.10c.5e.4 | Run the representative maintained-source workload on eligible laptop hardware. | Paused by user pending equipment. |
| M2.10c.5e.5 | Measure physical keyboard-to-display latency with recorded input/display boundaries and uncertainty. | Paused by user pending equipment. |
| M3.03 | Broaden reproducible state support beyond current app-authored web recipes, including fuller data/environment control and platform coverage. | In progress. |
| M4.02 | Broaden alternatives across projects, platforms and candidate-generation workflows. Existing token and scoped-group comparison remain bounded. | In progress. |
| A03 storage gate | Retention, cleanup/export, capacity lifecycle and scalable durable history; abrupt-termination cleanup also needs broader acceptance. | Open release work. |
| M5.03 | SwiftUI preview/Simulator interaction, captures, validated mapping and supported network evidence. Do not assume an independently embeddable Xcode canvas. | Not started. |
| M5.04 | Expo/React Native setup, language tooling and an actual iOS development build with lifecycle/recovery evidence. | Not started. |
| M5.05 | Expo component/source inspection, requests and scenarios in that development build. | Not started. |
| M5.06 | Native evidence through Assistant, review, alternatives, issues and knowledge, independently validated per supported platform. | Not started. |
| M5.07 | Required extensions, licensing/distribution, host-patch compatibility and repeatable upstream updates. | Not started. |
| M5.08 | Cross-project/platform performance, full accessibility, dense workflows and resilience, including cancellation/disconnection/crash recovery. | Not started. |
| M5.09 | Production signing/notarization, clean-machine install, updates, state migrations and recoverable rollback. | Not started. |
| M5.10 | Onboarding and complete daily workflows tested with representative design engineers without facilitator guidance; close remaining release gates. | Not started. |
| M6.02 | Create and review a brand-new comprehensive visual and motion system in its own interactive reference. | Not started; final milestone, before M6.01. |
| M6.01 | Apply the reviewed new system to every app surface and verify the finished experience. | Not started; explicitly last. |

Other intended breadth remains within the parent capabilities: complete system/API/data exploration, instrumented backend traces, richer direct manipulation, assets/variants and motion authoring, richer AI artifact types, additional model/provider options, cross-project/team knowledge, Android and native macOS workflows. These are direction, not shipped claims or replacement acceptance for the named gates above.

### M6: create a new system, then apply it last

M6.02 creates the new system from first principles, using the current UI only as migration evidence:

- New visual identity and interaction principles; semantic light/dark color, typography, 4px layout grid/snapping, spacing, dimensions, radii, borders, elevation and density.
- Window/panel sizing, resizing and responsive behavior; native/platform mappings; icon and asset rules with license notices.
- A new reusable component/pattern library covering navigation, editors, inspectors, dialogs, feedback, AI chat/artifacts, runtime and review.
- A motion language with semantic tokens, durations, easing/spring rules, choreography, gesture tracking, interruption, reversal, cancellation and reduced-motion equivalents.
- A standalone interactive reference for both themes, supported densities/sizes, realistic populated workflows and runnable motion/state examples.
- Anatomy, variants, state/content rules, keyboard/accessibility behavior, performance budgets, coverage inventory and migration guidance.

After that system is reviewed, M6.01 applies it across setup, navigation, editing, all four activities, Assistant/artifacts, knowledge, terminals, diagnostics, settings and recovery. The pass includes content, layout, structure, full state coverage and complete user journeys. Acceptance requires rendered before/after evidence and user review alongside functional checks. This is **new-system creation followed by application**, not extension or refinement of the existing visual system.

## 16. Capability traceability

All twenty-four accepted parent capabilities remain **In progress** in the authoritative ledger. The sections above document the completed slices and remaining scope rather than treating a verified child as a completed parent.

| IDs | Accepted capabilities | Main reference sections |
| --- | --- | --- |
| E01–E05 | Feature-oriented workspace; understanding beside code; precise coding assistance; intent-grouped changes; editor fundamentals. | 2–4, 6, 11, 14–15. |
| A01–A06 | Visible editable AI context; Ask/Plan/Build/Review; durable artifacts; steerable isolated execution; evidence-backed completion; provider/model/usage/cost control. | 5–6, 9–10, 12, 15. |
| D01–D06 | Follow an interaction; compare reproducible states; preview impact; explore alternatives; capture reproducible problems; preserve accepted decisions. | 4, 7–11, 15. |
| P01–P07 | Quiet hierarchy; stable spatial behavior; precise direct manipulation; purposeful motion; complete component states; premium platform integration; progressive disclosure. | 1–3, 8–9, 11–15. |

Update this document when functionality or support boundaries change. Update the [running checklist](product-checklist.md) whenever acceptance status changes; keep implementation, fixture verification, installed-app acceptance and release readiness distinct.
