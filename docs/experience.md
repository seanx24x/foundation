# Foundation experience specification

This is the target product behavior. The included web prototype demonstrates a subset using an instrumented fixture and a scripted proposal.

## Workspace anatomy

The top bar contains the project, active target, readiness indicator, four activity switches, and command access. A project navigator sits on the left; the central work area contains source, preview, or their split arrangement; a contextual inspector sits on the right. A collapsible lower area hosts terminal output, problems, requests, and verification.

The workspace stores one shared context: project, target, selected entity, active scenario, and active task. Every surface reads that context. A selection includes its mapping state: resolved, ambiguous, or unavailable. Editor cursor movement does not silently select a different running element unless the user explicitly follows that location.

| Activity | Default center | Default inspector | Lower panel |
| --- | --- | --- | --- |
| Understand | Running preview and related source | Identity, explanation, evidence, dependencies | Requests and diagnostics |
| Build | Source with optional compact preview | Plan, task activity, changed files | Terminal and problems |
| Refine | Preview with device and state controls | Layout, type, color, state, motion, and edit scope | Comparisons and diagnostics |
| Review | Source diff and before/after preview | Scope, verification, decisions, accept/undo | Check output and request comparison |

Panel sizes are user-adjustable and persistent per activity. Collapsing a panel never resets its selection or task. A “Reset layout” command restores defaults. Resizing must not initiate an editor drag or make text selection impossible.

## Flow 1: open and prepare a project

1. Open a folder or choose a recent project. Show its path before attaching tools.
2. Detect manifests, languages, available targets, and existing scripts. Present discovered candidates with their evidence; ask for a target only if multiple plausible targets remain.
3. Resolve readiness independently: **Index**, **Build**, **Runtime**, and **Mapping**. A ready runtime can coexist with incomplete indexing; editing remains available.
4. Present the discovered run command before its first execution. Use existing project configuration instead of inventing an installation or deployment workflow.
5. Connect the preview and expose adapter capabilities. Preserve source access when a runtime cannot start.
6. Offer the signature walkthrough on the included fixture; do not make it a mandatory gate for opening an existing repository.

Recovery: unavailable toolchain links to the exact missing prerequisite; failed startup opens useful output; an occupied port presents the actual conflict; a disconnected target offers reconnect; uncertain target detection permits an explicit target configuration.

## Flow 2: understand a visible element

1. Enter selection mode through a visible control or command.
2. Hover to reveal a geometry outline and concise identity label. Select to lock context; Escape exits selection mode without clearing the last selection.
3. Show identity, source location, mapping confidence, relevant props/state, known handler, dependencies, and related tests. Empty categories say why they are empty.
4. Open any source reference without losing the selected element. Follow dependencies in a focused list or graph rooted at that element.
5. Ask a question using the selected element and explicitly chosen supporting context.
6. Show the answer as linked claims, each with evidence provenance. “Unknown” is an actionable result when the code or instrumentation cannot establish an answer.

If a visible element maps to multiple sources, show candidates with location and mapping evidence. Require a candidate selection before source-backed editing. If it maps to none, preserve inspection of measured runtime properties but disable source mutation and explain how to add or repair mapping.

## Flow 3: follow behavior and APIs

1. Keep the selected element visible while performing its action.
2. Record the actual instrumented request with method, URL, start time, duration, outcome, and runtime session. Expose safe request/response details on demand.
3. Link the request to a source call site only when instrumentation or analysis supports that relationship. Temporal proximity alone is not proof of causation.
4. Open a contract when one exists. Distinguish an explicit schema from a shape inferred from a sample response.
5. Show the tracing boundary: for example, “Observed in the browser; server execution unavailable.” An HTTP response does not prove the internal server path.
6. Rerun the named scenario and compare outcomes while keeping the earlier observation available as historical evidence.

Failed requests remain inspectable. An empty request list says “No requests recorded in this session,” with a trigger or reconnect action; it must not imply the component never uses a network.

## Flow 4: build with AI

1. Describe the desired outcome in the current selection context.
2. Show the context being supplied: selected source, references, current runtime observations, and explicitly included project material.
3. Produce a plan or proposal with intent, affected files, shared impact, assumptions, and verification steps. The prototype labels its proposal as scripted.
4. Let the user revise the task or scope before application. A new source revision invalidates a proposal whose assumptions depended on the previous revision.
5. Apply changes in an isolated change set, show progress, and keep code editing available.
6. Present the resulting diff and preview changes. Model output is not itself evidence that implementation succeeded.
7. Run named verification, then hand off to Review.

Cancellation stops new operations and reports whether any edits or processes remain. Completed edits stay visible for review or undo. A provider failure preserves the task and context so the user can retry or change provider without reconstructing the request.

## Flow 5: refine an interface

1. Select an element and a named scenario, size, and theme.
2. Inspect supported properties and their source or measured value. Label runtime measurements separately from editable source values.
3. Choose a property and see its edit scope before application: local instance, component definition, or shared token. Show affected consumers where known.
4. Preview a value continuously during direct manipulation. Mark transient values as an experiment until the source operation completes.
5. Commit a source edit through a mapping-aware operation. Unsupported syntax opens the relevant source instead of silently rewriting it heuristically.
6. Confirm the resulting runtime value and compare required states. Detect when the running app still reflects an older build.
7. Inspect motion only when the adapter supplies supported timing or state information. Use capture/comparison when direct inspection is unavailable.

Controls must show mixed values, inherited values, unsupported properties, and token references explicitly. A shared-token edit is never the implicit fallback for a local adjustment.

## Flow 6: review, accept, and undo

1. Review the change-set intent, source diff, shared effects, and before/after states together.
2. Show independent verification categories: compilation, interaction, visual, and accessibility. Each has a status, timestamp, relevant revision, and output or evidence.
3. Allow rerunning stale or failed checks. A passing compilation check never marks the other categories as passed.
4. Accept records the review decision and current evidence. Acceptance is not a Git commit, publish, or deployment unless the user separately chooses that action.
5. Undo restores only edits owned by that change set. If later edits overlap, show a conflict and a reviewable recovery operation rather than overwriting them.
6. Retain accepted knowledge against its revision. Reopening an old decision must show if the relevant code has changed.

## Annotated screen specifications

| Screen | Normal content and key controls | State and recovery requirements |
| --- | --- | --- |
| Welcome / project chooser | Recent projects, open folder, fixture walkthrough; clear project path. | **Empty:** useful first action. **Loading:** describe discovery. **Failed:** unreadable path or missing folder with choose-another action. |
| Target setup | Detected targets and four independent readiness indicators; command preview and output. | **Loading:** individual progress. **Ambiguous:** explicit target candidates. **Failed:** actual output and prerequisite. **Recovery:** retry only the failed stage. |
| Understand workspace | Selected preview outline, identity, source, focused dependencies, provenance badges. | **Empty:** explain selection. **Loading:** retain prior identity while updating. **Ambiguous:** source candidates. **Disconnected:** preserve source facts; mark runtime evidence historical. |
| Request detail | Method, path, response status, timing, request/response details, session and call-site evidence. | **Empty:** no events in session. **Failed:** request failure details remain visible. **Disconnected:** stopped recording notice. **Recovery:** reconnect then trigger again; retain prior event. |
| AI task / proposal | Goal, visible context, scope, plan, changed files, progress, cancel. | **Empty:** contextual starting prompt. **Loading:** current operation, no fabricated percentage. **Failed:** retryable provider/tool error. **Stale:** replan action. **Recovery:** reuse retained context. |
| Refine inspector | Property groups, origin, token link, scope, scenarios, size/theme controls. | **Unavailable mapping:** read-only measures with source repair action. **Mixed:** explicit mixed values. **Disconnected:** suspend source-to-preview confirmation. **Failed edit:** retain intended value as experiment, expose source error. |
| Review workspace | Diff, visual comparison, verification cards, accept, undo. | **Empty:** no changes. **Loading:** each check independently. **Failed:** evidence and rerun. **Stale:** exact revision mismatch. **Undo conflict:** changed regions and manual recovery. |
| History / knowledge | Decisions, changes, attached evidence, revision links. | **Empty:** explain when records appear. **Stale:** visible age/revision with refresh. **Missing source:** preserve record and identify unavailable reference. |

## Interaction rules

- Selection is visible in every activity, with a one-step return to its preview or source.
- Empty states contain one primary next action; error states contain the cause and a concrete recovery action.
- Loading is local to the work in progress. A pending model call does not replace the workspace with a skeleton.
- Destructive or irreversible operations are distinguished from reversible local edits. Dialogs are reserved for meaningful loss or external effects.
- Unsaved user edits remain visible throughout task changes, switching activities, cancellation, and undo.
- Unsupported capability controls explain the missing condition. Do not present clickable controls that only pretend to perform the operation.
- Keyboard commands have visible discoverability through the command palette. Inspectors return focus to their triggering control when dismissed.
