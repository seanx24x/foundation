# Isolated change groups — Foundation 0.19

Direct Build can propose one coordinated group affecting two to eight explicitly selected existing source files. The title and summary describe its intent; every file retains exact before/after source and its original revision. Foundation stores these staged snapshots and a recovery journal in its own local workspace storage, outside the project. Generating or reopening a group does not change project source.

The source-change contract stages snapshots. Foundation 0.17 adds separate, explicitly invoked [isolated tool checks](isolated-tool-checks.md) against copied staged source. It does not create a Git worktree, install dependencies or resume agent execution. One-file proposals and the one-file plan-step handoff retain their existing behavior. The browser reference retains its one-file protocol; the native host explicitly enables multi-file groups.

## Review and apply

The Assistant card opens a shared review surface. Choose a file to inspect its staged before/after diff or open a native read-only diff. File selection changes review focus, not acceptance scope. Apply all affects the entire group. Foundation 0.24 adds a separate [Choose changes workflow](partial-acceptance.md): conservative host-derived dependency units, persisted scope, selected Apply and Undo accepted. Unknown or unsupported source remains one unit.

Before and during Apply, Foundation checks the group's full disclosed source basis and native editor drafts. Missing, stale or unsaved contributing source blocks the operation. One current change group owns source operations. Foundation 0.19 can explicitly [refine its staged source or restore a retained proposed version](staged-group-revisions.md); an unrelated Build still requires dismissing or undoing the current group. Historical and archived artifacts remain readable and cannot authorize new source changes.

Undo all requires every changed target to match the applied snapshot exactly and have no unsaved draft. Changes to unrelated supporting files do not prevent target-only Undo. Later changes to a target are preserved and block Undo.

## Interrupted writes and recovery

A filesystem does not provide a single atomic commit across these files. Foundation journals the intended operation before the first write and records each completed write. It rechecks the mixed source basis as it progresses. A failure stops further writes; the UI reports recovery required if changes may be partial.

Reopening never resumes source writes. It reads the actual files and classifies them against the checkpoint. Restore checkpoint is explicit and available only when every relevant target still matches a known before/after snapshot and no target has an unsaved draft. It restores the operation's pre-state: before for an interrupted Apply, after for an interrupted Undo. Unknown edits or unavailable files block recovery rather than being overwritten.

Stage, Apply, Undo and recovery checkpoints are local evidence of source operations. Suggested verification remains unexecuted; separate isolated command results report only their recorded process outcome. Interaction and visual checks remain Not run. A source mutation is not a passing test or proof of runtime behavior.

## Remaining work

The running checklist retains tool execution in isolated runnable checkouts, live steering, restart/resume decisions, broader partial acceptance beyond closed scalar modules, new files/renames/deletions, general verification orchestration and live-provider acceptance. This bounded increment accepts at most 24 exact source edits across eight existing files and rejects the entire model response if any member fails validation.
