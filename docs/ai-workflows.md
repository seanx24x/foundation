# Four AI workflows — Foundation 0.16

Foundation's right-hand Assistant has four explicit intents. Changing intent preserves your prompt and source choices; it sends nothing. Each request uses only the chosen saved files, explicitly included task/runtime context and, for a plan handoff, the selected saved plan step. Previous messages are not automatically appended.

| Intent | Result | Stopping point |
| --- | --- | --- |
| Ask | A source-grounded explanation with citations. | An answer; no edits or tools. |
| Plan | A structured sequence with source references, risks and suggested verification. | A saved, editable plan; no execution. |
| Build | A proposal for one existing file, or a coordinated group of 2–8 selected existing files. | Staged source changes; Apply remains separate. |
| Review | Findings about the selected saved source, with severity, references, suggestions and limitations. | AI interpretation; no test result or source mutation. |

Review currently analyzes selected saved source. It is not an automatic Git diff review or proof that a running product works. No findings means no findings in the supplied context, not a passing verification result. Direct Build supports bounded staged multi-file groups; runnable isolated execution and live steering remain M2.09g–h. See [isolated change groups](isolated-change-groups.md).

## Plans you can revise

Plan output is validated before becoming an artifact. Its original provider content and exact request source snapshots remain immutable. Edit text, reorder steps, include or exclude existing steps, and explicitly save a new local revision. Inclusion records planned scope, not completion. The artifact retains the original and saved revisions for inspection.

Each plan has up to 16 steps. A step's source references remain tied to its original evidence; editing its wording does not invent new evidence or source access. Add/remove-step authoring is outside this increment. Plans retain revision zero plus up to 16 local revisions. Reaching the limit preserves the earlier revisions and asks for a new plan. Concurrent saves compare the expected plan revision; conflicts preserve the unsaved draft for review. Failed persistence remains visible and can be retried.

Plans and findings use model-generated text as interpretation. Reference IDs and line ranges must resolve within the exact selected source. Foundation generates artifact and step identities locally. Model output cannot provide trusted execution status, source revisions, tool results or passing checks. Partial, refused, truncated, cancelled or malformed structured responses remain incomplete output and cannot initiate work. An artifact completed while Stop was pending stays readable but cannot be edited or prepared for Build.

## Prepare a step for Build

An included step can prepare Build when all its references belong to one existing file. Steps with no proven file or more than one file explain why they are unavailable for this bounded workflow. Preparation selects that one saved file and attaches the exact plan revision and step to the composer. It preserves a typed prompt. Review the removable plan context and selected source before sending; preparation itself makes no provider request.

The host resolves the plan descriptor from local history rather than trusting renderer-supplied text. Before dispatch and before publishing the proposal, it rechecks the active conversation, artifact identity, saved revision, included step and the entire original plan's source basis. Missing, changed or dirty contributing source blocks the handoff. Only the selected file's body is shared with Build; the original plan basis remains a local revision guard through proposal Apply. The Build request preserves its exact selected step independently of later plan edits.

The plan-step handoff remains one file in this increment. Direct Build supports coordinated multi-file groups. Both require explicit Apply and retain source-revision protection. An unrelated draft is untouched. Undo remains tied to the exact applied target revision and refuses later target edits. Suggested verification does not run automatically.

## Freshness, navigation and restart

**Check source** reads saved local files to assess an artifact's original source baseline. It sends nothing to AI and does not alter that baseline, feature membership, source selection or source files. Changed source is stale; missing source is unknown; affected native drafts remain separate. Source references recheck their evidence before opening a native editor, and newer focus or ownership changes retire pending navigation.

The Assistant retains its four-mode intent and unsent request through the existing identity-bound restoration flow. Plan preparation persists only bounded identity metadata. Durable conversation storage contains original artifacts, local plan revisions and immutable request context. Restart restores history for inspection without resuming AI or tools. Unsaved plan editing drafts are scoped to their project, conversation, artifact and base revision; a changed saved revision creates a conflict rather than overwriting either version.

Conversation schema 5 validates and reads schemas 1–4, translating the old Change intent to Build and retaining validated request and staged-group lineage. Viewing terminal legacy history does not rewrite its backing data; a subsequent state mutation, including interruption recovery, saves schema 5. Older builds cannot read schema 5 and leave that history unavailable instead of stripping its lineage or change-group fields. Unsupported or corrupt data stays untouched with a recovery state.

## Validation and remaining work

Provider protocol fixtures exercise OpenAI Responses, Anthropic Messages and compatible Chat Completions. These mock checks establish parsing, transport and ownership behavior; they do not establish model quality or live-provider acceptance. The packaged workflow uses an explicitly local mock provider and disposable source/profile storage. The original four-mode acceptance is recorded in [0.15 verification](../artifacts/verification-v0.15.md). The 0.16 change-group increment separately verifies staged source, group-wide Apply/Undo, recovery and populated checkpoint restoration; its installed-app results are recorded in [0.16 verification](../artifacts/verification-v0.16.md).

The [running checklist](product-checklist.md) retains live-provider acceptance, multi-file execution, inline assistance, physical latency under load, runtime comparison and independent platform gates.

## Two alternatives from one brief

[AI alternatives](ai-alternatives.md) extends Build with an explicit two-candidate request using one saved feature, web screen and scenario. Each candidate uses the same original source rather than building on the other. Its reasoning, scope and complete source snapshots remain in immutable conversation history. A normally completed response does not become a source checkpoint until **Review candidate** is chosen. Comparison, retained adoption and Apply/Undo stay separate actions.
