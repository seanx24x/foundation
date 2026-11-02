# Foundation product principles

Version 1.1 · Product contract · 28 October 2026

This document defines the intended Foundation experience. It does not claim that every requirement exists in the current desktop app. The design system supplies the visual and interaction rules that make these principles consistent across the product.

## Product thesis

**Foundation connects what people see, what software does, and the code that makes it happen.** It is a professional environment for understanding, building, and refining a living product, with AI participating in the same workspace.

The primary audience is the design engineer: someone who moves between interface craft, implementation, behavior, and systems. The first customer is an individual building a real product; team workflows follow once that individual experience is dependable.

The product promise is simple: **Show me what this does, help me change it, and show me what happened.**

Foundation has four activities: **Understand, Build, Refine, and Review**. They are arrangements of one workspace, preserving the selected entity, scenario, revision, and task. AI is available throughout them in the native Assistant sidebar. Its visibility is independent of the current activity; opening or collapsing it preserves source selection, the canvas, conversation history and drafts.

## Principles

These are decision rules. A feature is incomplete when it violates them, even if its happy path looks finished.

| Principle | Required behavior | Reject |
| --- | --- | --- |
| **1. Start from the product.** | A visible element can become the workspace's selected entity. Reveal supported source mappings and observations while keeping code navigation available. | Requiring a person to know a filename before asking about what they see. |
| **2. Preserve the thread of work.** | Activity changes retain selection, scenario, revision, and task. Offer Back and a clear current location. Opening related source does not silently replace the selected product entity. | Repeating context in every panel or letting agent navigation unexpectedly move the user's focus. |
| **3. Show what is known.** | Claims disclose whether they come from source, observation, AI interpretation, or remain unknown. Evidence retains its revision or runtime session and becomes visibly stale. | Treating plausible explanation, temporal proximity, or an HTTP response as proof of unseen behavior. |
| **4. Expose scope before change.** | Controls identify instance, component, or shared-token scope and known consumers before application. Ambiguous mapping requires resolution before source mutation. | Quietly changing a global token to satisfy a local request. |
| **5. Make experiments cheap and recovery dependable.** | Preview experiments are immediate and distinct from source. Applied work has a bounded diff and recoverable checkpoint; Undo preserves unrelated and subsequent edits. | A preview silently saving source, or a broad reset overwriting human work. |
| **6. Make AI a visible collaborator.** | Show the goal, supplied context, current operation, proposed changes, cancellation outcome, and verification. Manual controls and AI use the same selection and review model. | A disconnected chat universe, hidden scope expansion, or verbose activity that disguises progress. |
| **7. Earn every visual emphasis.** | Code and product content dominate. Navigation stays stable and quieter. Accent identifies selection and action; semantic colors communicate status. | Every section as a raised card, every AI action glowing, or several competing primary actions. |
| **8. Keep manipulation direct.** | Pointer movement gives immediate feedback; keyboard controls offer equivalent precision. Interruption preserves the current value, focus, and partially entered text. | Animation blocking input, surprise snapping during text entry, or live telemetry replacing a draft. |
| **9. Finish with evidence.** | Report build, interaction, visual, and accessibility outcomes separately, against the relevant revision and scenario. Preserve unrun, failed, and stale states. | One green “Done” that conceals what was never checked. |
| **10. Keep the tool under the user's control.** | Standard editing works without AI. Context sharing, usage, and external effects are visible. Respect theme, zoom, reduced motion, keyboard access, and unsaved drafts. | Connectivity blocking ordinary work, hidden publication, or replacing a user's draft. |

## Content and hierarchy

Every surface should make its purpose, current state and next useful action clear. Concision serves understanding; a shorter interface that hides a blocking condition is worse.

- **Give information one home.** The selection bar identifies the current source; content explains its relationships or exposes controls. Do not repeat a filename, revision, status and introductory sentence in every section.
- **Name the action and its scope.** Use “Open in editor,” “Set up AI” and “Reset inspector.” Avoid broad labels that promise more than the action changes.
- **Lead with the task.** Empty states offer the next useful action. Active tasks show their result or progress. Discarded and undone proposals belong in previous work, with their outcome explicit.
- **Keep common actions visible.** Put advanced settings, source snapshots, request metadata and explanatory mechanics one level deeper. Keep those disclosures keyboard accessible and preserve their state during updates.
- **Expose conditions when they matter.** Disconnected AI, unavailable source, unsaved drafts, stale evidence, edit conflicts and storage failure must explain why an action is unavailable and how to recover. Never hide a blocking condition inside an optional disclosure.
- **Show evidence without a lecture.** Label source, observation and AI interpretation accurately. Keep scope, freshness and separate verification outcomes accessible. Put repeated implementation explanations in contextual help instead of the main workflow.
- **Let structure carry meaning.** Use alignment, proximity, spacing and typography before adding another heading, card or label. Navigation, supporting tools and content must have distinct roles.
- **Preserve familiar native controls.** Editing, search, Source Control, terminals, debugging and settings retain their established behavior. Foundation adds focused understanding, design and AI surfaces without duplicating the host's control rows.

The [clarity pass](clarity-pass.md) records the surface inventory, decisions and acceptance checks for applying these rules.

## Signature experiences

These are Foundation's proposed interaction designs. Their distinction should be established through usability and execution, not assertions that no other tool offers related features.

### Connected selection

Select Save in the running product. A persistent selection bar identifies the element and active scenario. Preview, source, state, handler, observed request, and proposal remain connected while the user changes activities. Every relationship can disclose its supporting evidence. A focused relationship view expands from the current question; a whole-repository graph is never the default.

When mapping is unknown, retain measured geometry and offer source candidates. Do not infer a direct editing target. When the runtime disconnects, retain source context and label previous observations as historical.

**0.4 foundation:** Annotated source paths, measured geometry and styles, source navigation, and contextual AI preparation. **Required next:** Durable entity identity across rerenders and activities; instrumented links to requests, state, tests, and server activity where supported.

### Scope preview

A visual adjustment begins with an explicit scope. Choosing a shared token highlights known consumers and offers relevant states for comparison. “12 known consumers” links to the current reference inventory and its coverage; it does not pretend to be an exhaustive count when analysis is incomplete. The user can compare a local change with a shared decision before proceeding.

Experiments remain visible as experiments. Converting one into source creates a proposal with the exact declaration, revision, affected files, and known impact. The source remains authoritative throughout.

**0.4 foundation:** CSS token experiments and bounded single-file proposals with shared-scope explanation. **Required next:** Consumer inventory and highlighting, instance/component alternatives, and verified multi-file changes.

### Scenario comparison

A compact scenario rail holds reproducible states such as Idle, Saving, Success, and Error across selected sizes and themes. Each state records its setup, observed result, and capture revision. Reduced motion is an explicit condition when behavior depends on motion.

Baseline and proposal use the same scenario inputs. A visual difference links to changed source and measurements. Static reference images remain useful comparison material, but they are never presented as executable evidence. Missing instrumentation shows exactly which outcomes remain unavailable.

**0.4 foundation:** Theme and viewport controls, local preview, and explicit network-off boundaries. **Required next:** Scenario setup and replay, paired captures, request traces, and accessibility and motion verification.

### Evidence-based review

Review combines intent, source diff, visible result, affected scope, and independent verification outcomes. It answers five questions: What changed? Where else does it apply? What was exercised? What remains unknown? What will Undo restore?

A check carries its revision, scenario, timestamp, and supporting output. Accept records a review decision; it is separate from committing, publishing, or deploying. If later human edits overlap an undo operation, show a reviewable recovery path instead of overwriting them.

**0.4 foundation:** Native before/proposed diffs, guarded Apply and Undo, stale checks, local checkpoint recovery, and unsaved-draft protection. **Required next:** A durable review record connecting scenario captures with build, behavior, visual, and accessibility evidence.

## The craft bar

Foundation should merit recognition through coherent behavior and sustained usefulness. Awards are an ambition, not a promised outcome. Refined appearance is necessary; it does not compensate for weak mapping, broken focus, inaccurate evidence, or unsafe recovery.

Before declaring a core workflow ready, evaluate it with representative design engineers without facilitator guidance. Use the Save workflow, a dense repository, and a failure fixture. Record:

| Measure | Acceptance direction |
| --- | --- |
| Understanding | Users correctly identify the component, supported behavior, and limits of available evidence. |
| Continuity | Users complete the workflow without rebuilding or repeatedly explaining their context. |
| Scope prediction | Users can state whether a proposed edit affects an instance, component, or shared decision before applying it. |
| Verification literacy | Users distinguish passed, failed, unrun, and stale checks without explanation from a facilitator. |
| Recovery | Cancellation and Undo preserve unrelated edits and all unsaved human drafts. |
| Interaction quality | No lost focus, dropped keystrokes, blocked input during motion, or unexpected geometry shifts in core tasks. |
| Access | Core workflows work by keyboard in both themes, with enlarged UI and reduced motion. |

Establish measured baselines before setting numerical completion-time goals. Use task completion and critical errors as primary outcomes; speed matters only when understanding and control remain intact.

Stress the system under slow indexing, disconnected AI and runtimes, failed builds, ambiguous mapping, stale proposals, long names, dense data, and overlapping human edits. Quality work belongs in every increment, with visible ownership and regression coverage.

## Reference discipline and positioning

Linear's redesign work provides a model for aligned recurring anatomy, deliberate density, and testing changes against real workflows. Its March 2026 refresh emphasizes quieter navigation, stable action locations, and in-app token experimentation. Foundation should adopt that discipline while keeping its own geometry, palette, and product model. [Linear 2024 redesign](https://linear.app/now/how-we-redesigned-the-linear-ui), [Linear 2026 refresh](https://linear.app/now/behind-the-latest-design-refresh)

Vercel's Geist system illustrates semantic color roles, deliberate border ownership, and complete typography recipes that combine size, line height, tracking, and weight. Foundation's tokens should carry similarly explicit meaning. Public reference documentation does not grant permission to redistribute proprietary components or brand assets. [Geist colors](https://vercel.com/geist/colors), [Geist typography](https://vercel.com/geist/typography)

The competitive baseline is already strong. Cursor documents spatial annotation, CSS inspection, browser tooling, and agent edits. Claude Code documents planning, worktrees, and checkpoints. Codex documents independent worktrees, source review, and browser feedback. Foundation's opportunity is the quality of the connected entity, scope, scenario, and review experience—not a claim that these tools lack agents, visual capabilities, or recovery. [Cursor Design Mode](https://prod.cursor.com/docs/agent/design-mode), [Cursor browser](https://prod.cursor.com/docs/agent/tools/browser), [Cursor release notes](https://prod.cursor.com/docs/release-notes), [Claude Code workflows](https://code.claude.com/docs/en/common-workflows), [Claude Code checkpointing](https://code.claude.com/docs/en/checkpointing), [Codex worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees), [Code review](https://learn.chatgpt.com/docs/code-review), [Browser feedback](https://learn.chatgpt.com/docs/browser)

Reference claims were checked on 27 October 2026. Recheck changing product capabilities before using them in public positioning.
