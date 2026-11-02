# Request revisions — Foundation 0.18

A saved request can become the starting point for a new one. **Stop and revise** retires the exact active response and flushes its terminal history before preparing its instruction and saved source selection. **Revise request** prepares a terminal request directly. Neither action calls a provider. Edit the instruction, inspect its context, and explicitly Send.

The previous request, partial text and artifacts remain unchanged. A new request receives a new identity and a local parent link. This revises an instruction; it does not resume a provider stream, apply source, or automatically include previous output. Stopping Foundation's stream cannot guarantee that a remote provider stopped processing or billing.

## Context and draft ownership

Preparation resolves the parent from the native host's active, unarchived conversation. It reads the complete original saved source set, requires exact source/revision matches, and rejects missing or dirty contributing files. It never reads editor draft contents. An unrelated unsaved draft is untouched.

A nonempty composer prompt is preserved; an empty composer receives the parent's instruction. The removable revision card shows that this is a new request. Prior task, runtime and plan context is not silently reused. Choose task and runtime context again; a request originally prepared from a plan step returns to that plan's own preparation flow. Changing mode or source selection detaches the revision link so the new scope is explicit.

Preparation replies are bound to the project, feature, conversation, parent, action identity and current draft/context generation. A late reply cannot overwrite a new user selection or draft. Source, native drafts, parent ownership and storage are rechecked after asynchronous work and immediately before dispatch. A changed saved baseline requires a new request with current source.

Provider input contains the edited prompt and the explicitly selected current source/task/runtime context. Parent lineage stays local. Prior answers, partial structured output, generated source and tool output are not automatically transmitted. Build still refuses an active staged/applied group; revising a request does not bypass group review or source-write safeguards.

## Durable lineage and restart

Conversation schema 4 adds `{version: 1, conversationId, requestId}` as optional `requestRevision` metadata. The parent must be an earlier terminal request in the same conversation, with the same intent and exact ordered source snapshots. Self, forward, cyclic, foreign, malformed and plan-derived bindings are rejected. A response completed while Stop was being processed can supply its original instruction/source, but its partial artifact does not gain edit authority.

Schemas 1–3 load in memory without a migration write. A subsequent state mutation saves schema 4; reopening an unfinished request also records its interruption. Unsupported or malformed history remains untouched. Earlier inputs remain immutable, and capacity/storage failures preserve existing evidence.

Unsent revision metadata restores only in its matching project, feature and conversation. It is checked against local history and current source before Send. Restart never resumes AI or tool execution. Closing before a request finishes retains its saved partial output as Interrupted.

## Acceptance and remaining work

Store, host and production-renderer tests cover lineage, migration, cancellation, source/draft changes, identity races, storage failure, keyboard controls and both themes. [Packaged acceptance](../artifacts/verification-v0.18.md) verifies a streamed response, Stop and revise, no provider request during preparation, a distinct explicit Send, preserved parent history, and restart with an unsent revision draft. Both native themes and the installed normal profile were inspected; the running checklist retains the broader open gates.

This is the request-revision part of M2.09h. Refining staged groups, revisiting source checkpoints, broader agent/tool steering and dependency-safe partial acceptance remain separate gates. File selection in group review still chooses a diff; Apply all remains the supported acceptance scope.
