# Staged group revisions — Foundation 0.19

Refine group prepares a new Build request from the current proposed version. It does not call AI or change project source. The composer preserves existing typed text and shows exactly which staged and saved supporting files will be shared. Optional task and runtime context must be selected again. Propose revision is the explicit send action.

## Source and request identity

The original saved source remains the local baseline. The provider receives the selected group's staged after snapshots, plus unchanged supporting source from that baseline. It receives no earlier answer, hidden files, tool results or prior verification. The original source set remains complete and ordered; a contributing native draft, stale file, missing source or changed ownership blocks the request.

Edits are validated against the staged snapshot, then composed into a new group against the original saved before snapshots. Unedited staged changes are carried forward. The new group gets a new identity, request and suggested checks. The new group inherits no check result. Earlier checks stay attached to their original group and revision. This increment retains the existing two-to-eight changed-file bound; a refinement that leaves fewer than two changed files fails explicitly and preserves the earlier group.

A provider artifact alone does not replace the active version. The response must finish normally and its composed artifact and completed turn must be durably saved before atomic checkpoint promotion. Interrupted, cancelled, malformed or failed responses preserve the active group. If the completed child is saved but checkpoint promotion fails, it remains available for inspection without becoming source-write authority.

## Versions and source operations

The local checkpoint retains up to eight full versions per refinement chain, including the current one, and up to 64 retained groups across independent chains, with their own operation records. Earlier versions can be inspected and opened as native read-only diffs. Choosing a compatible earlier version changes the active proposal only; it writes no project source. Both current and chosen versions must still be proposed and match the original source, with no contributing unsaved drafts or active check. Applied and recovery states require their own Undo or recovery flow first.

Apply all and Undo all retain the existing complete-group guards and recovery journal. Version selection is not partial acceptance. The separate [0.24 acceptance scope](partial-acceptance.md) must be cleared with Use whole proposal before refining or selecting a version; accepted source must be undone or dismissed first. A lifecycle counter advances when a version becomes current again, preventing stale controls or earlier ready checks from silently becoming current. Check output stays attached to its recorded group, source digest and revision.

## Persistence and recovery

Conversation schema 5 records the exact parent group identity and original source basis. Actual staged sharing is reconstructed from immutable parent snapshots. Earlier conversation schemas remain readable; state changes and interruption recovery save the current format. Generic request revision cannot silently reinterpret a staged-source request as ordinary saved source.

Checkpoint schema 2 retains the version chain and active selection. The existing schema 1 checkpoint is migrated in memory without an unnecessary write. Atomic checkpoint rename is the selection commit point. Validation and cancellation checks precede that rename; failures before it preserve the prior envelope. If directory sync fails after the rename, the committed version remains visibly current with a storage error and source actions blocked; Retry confirms that selection. Retry never silently promotes an uncommitted candidate. Restart restores evidence and unsent drafts without sending a request, applying source or running a command.

Capacity is explicit: eight versions per chain, 64 retained groups and the existing 4 MiB storage limit. No older snapshot is silently evicted. Broader agent/tool steering, general checkpoint continuation, arbitrary file operations remain separate checklist items. Partial acceptance is specified separately in the 0.24 contract.

## Verification

[0.19 verification](../artifacts/verification-v0.19.md) records 197 project and 578 desktop checks, packaged refine/compare/restore/restart/Apply/Undo, both native themes and exact installed-payload verification. Implementation, protocol fixtures, native controls and installation remain separately recorded in the [running checklist](product-checklist.md). Live-provider quality cannot be established by loopback fixtures.
