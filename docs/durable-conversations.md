# Durable conversations — Foundation 0.19

Foundation keeps AI conversations and their artifacts in local, project-scoped Code OSS workspace storage. Closing the Assistant or restarting the app no longer removes completed responses. The native host owns the records and request lifecycle; a webview can request navigation but cannot manufacture a saved response or grant source-edit authority.

## Experience

The Assistant has New conversation, History, and reversible Archive/Restore. Each conversation retains its title, timestamps, selected request context, responses, proposals and verification history. A request can also retain its feature task snapshot and explicitly selected runtime observations. An archived conversation is read-only until restored. A separate current operation checkpoint can still offer explicit recovery or dismissal; archiving does not hide an interrupted source operation. Switching and archiving are disabled while a request is preparing or running.

Every request retains the exact saved source snapshots and revisions supplied to the provider. Freshness is evaluated against current available saved source: changed revisions are stale, missing files are unknown, and unsaved editor drafts remain separate. Citations navigate to current source; the original snapshots stay available inside the artifact.

History is available offline. Merely opening it, switching conversations, restoring an archive, or preparing a retry sends nothing. Each provider request shares the current prompt, selected saved files, and any included task context or selected runtime observations without automatically appending previous messages. Multi-turn model context selection is a later increment.

## Plans and review findings

[Four AI workflows](ai-workflows.md) add immutable Plan and Review artifacts and explicit local plan revisions. Saved Build requests can bind one exact plan revision and included step. Review findings remain interpretation, and plan inclusion never implies execution. Schema 4 reads validated schema 1–3 history in memory; the next explicit mutation saves the new envelope. Older builds leave unsupported history unavailable rather than silently losing artifact data.

## Recovery and persistence

Before contacting a provider, Foundation reads and validates the actual selected files and saves the request intent with its original context. Included task metadata and runtime observations are validated before they enter the record. A failed initial history write prevents dispatch. Streaming output is saved periodically; terminal states flush their record. A write failure remains visible and offers Retry saving. The most recent unsaved stream fragment may be lost in a process crash; Foundation does not promise token-level crash durability.

On an unexpected restart, stored Running or Stopping requests become Interrupted. Their partial text is retained; the request never resumes automatically. Collapsing the native Assistant preserves the active request and partial response. Explicit Stop, actual view disposal, project changes, and app shutdown revoke local request ownership; retained partial text is saved. Cancellation describes Foundation's request ownership, not a guarantee about remote provider execution or billing.

Records are schema-validated and project-bound. Unsupported/corrupt envelopes remain untouched; Retry loading re-reads them. Writes are serialized so an older save cannot overwrite newer conversation state. Duplicate request identities and late terminal events cannot attach to a newer turn.

Task snapshots use `{ version: 1, featureId, title, brief, revision }`. They contain only a bounded feature identity, title of up to 80 characters, brief of up to 2,000 characters, and a nonnegative revision. Empty briefs are valid. The host resolves the selected feature and revision before dispatch. A later feature edit, caller mutation, or provider event cannot replace the task originally saved with a request. The task is supplementary user guidance; the current prompt takes precedence and all source/tool limits remain unchanged.

Older conversation records without task context remain valid without a migration write. Unknown task versions and malformed persisted snapshots leave the backing store untouched and history unavailable, rather than discarding context silently. A brief does not automatically select source, runtime evidence, or earlier conversation turns.

The initial limits are 20 conversations per project, 40 requests per conversation and 8 MiB for the project envelope, with bounded source snapshots and responses. Capacity errors preserve existing records and explicitly mark a response partial rather than silently evicting history. Archiving retains its data and does not reclaim capacity. Retention controls and export are later work.

## Artifacts and evidence

Single-file Apply/Undo uses its host-owned proposal checkpoint. Multi-file Apply/Undo uses the independent host-owned change-group journal. Saved artifact copies preserve their identity and source diff; superseded or archived cards cannot authorize edits. Both paths retain trust, native-draft and revision guards.

Selected runtime records use a separate versioned evidence snapshot. Saved method, sanitized URL, status, duration, outcome, session, and timestamp remain historical observations; they do not establish current connectivity or a causal link to the selected feature. Bodies and headers are excluded. Start and completion events cannot replace that original selection. A feature brief is not itself an observation or proof of successful verification.

Verification history records an applied source revision, preview revision, runtime session, timestamp and observed compilation/render outcome. Recording requires an exact applied source match. Historical results stay labelled as historical after reload and do not restore a live runtime connection. Interaction and visual acceptance remain independently Not run unless a future verifier actually performs them. Suggested checks remain unexecuted suggestions.

## Privacy and validation boundary

Storage stays in the local Foundation profile's workspace storage, outside the repository. Provider configuration, credentials, provider transport URLs, arbitrary error objects, and tool payload fields are excluded from stored metadata. Prompts, answers, source snapshots, and user-owned task briefs may contain private content. Task instructions remain text and do not execute. This is not automatic secret redaction or encrypted-history functionality. The browser workbench's session-local responses do not use this native durable store.

Validation combines store tests, native-host protocol tests, production-renderer browser tests in both themes at 1280/700/360 px, and a two-process native storage test (`npm run desktop:history-smoke`, with `-- --development` for the external extension). The restart test uses normal extension activation and graceful quit: Code OSS deliberately disables persistent storage under `--extensionTestsPath`. It verifies native conversation identity persistence across two processes; response, proposal and verification round trips are covered by the store and production-renderer suites. This does not establish power-loss durability. Synthetic local responses are clearly test data; no commercial provider connection is needed. Development-extension and packaged-app results are recorded separately. The existing unsaved Orbit draft is not used as AI context or a test fixture.

## Multi-file change history

Schema 3 retains validated multi-file Build artifacts while reading older schema 1 and 2 data without writing on view. A group's original source, generated changes and request context are immutable. Host checkpoint updates advance its revision; conversation history is descriptive and never replaces the independent local transaction journal as write authority. Unknown fields/versions and conflicting group updates leave history unavailable rather than deleting content.

Group Apply/Undo remains separate from provider generation. An interrupted operation restores no source automatically; see [isolated change groups](isolated-change-groups.md). Current checkpoint records live in the group's external storage envelope. Historical conversation cards retain their staged source and final recorded status, not an invented complete checkpoint trail.

## Request revision lineage

[Request revisions](request-revisions.md) retain an optional local parent descriptor in schema 4. Only an earlier terminal request in the same conversation, with the same intent and exact ordered source snapshots, may be a parent. Preparing a revision never contacts AI; explicit Send creates a new identity. Prior output and tool results are not automatically shared. Typed drafts and earlier request evidence remain intact.

[Staged group revisions](staged-group-revisions.md) add schema 5 parent-group lineage. The original saved source basis remains immutable, while the source actually shared with the provider is reconstructed from that parent’s staged snapshots. New group identities retain separate checks; earlier versions remain inspectable.
