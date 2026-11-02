# Selected changes — Foundation 0.24

A proposal remains one immutable record of what AI suggested. In its expanded review, **Choose changes** asks Foundation to derive acceptance units from the exact original source disclosed to that request and its proposed source. This is a local action; it neither sends a model request nor writes project source. The changed-file picker continues to choose a diff, separately from acceptance scope.

## What can be separated

The first implementation supports a deliberately closed family of scalar JavaScript and TypeScript ES modules. It resolves static relative imports and re-exports inside the complete disclosed source set. Dependencies from both original and proposed source are joined; unchanged supporting modules can connect changed files. Each connected unit is indivisible and every changed file belongs to exactly one unit.

An unknown identifier, effectful or unsupported construct, package import, alias, dynamic dependency, incomplete source, ambiguous resolution, JSX, or stylesheet keeps the entire proposal together. Typical React and shared-style changes therefore continue to use whole-proposal Apply. No model-authored label, unchecked graph edge, or passing command establishes independence. These units express the supported source dependency contract; they do not certify behavior or the intent of a change.

## Selection and source changes

The local checkpoint stores the plan, selected pending units and accepted units. All pending units start selected. Changing checkboxes saves scope without writing source; an empty selection disables Apply. Each scope change advances the lifecycle revision, so older controls and prepared checks cannot authorize a different selection. Restart restores scope without applying anything.

**Apply selected** writes exactly the saved selected units, with the original proposal and the remaining staged changes retained. Further batches require explicit selection. Before every Apply, the entire disclosed source basis must match its expected mixed state: accepted files at their proposed source, pending and supporting files at their original source. Contributing native drafts block Apply. The review distinguishes Applied/Pending receipts from current disk freshness.

**Undo accepted** restores all accepted files together. It does not write skipped files, and later edits or drafts in skipped files do not prevent Undo. Later edits or drafts in accepted targets block Undo. Foundation never labels an unknown target safe merely because another file matches.

Before any Apply, **Use whole proposal** removes the selection plan and returns to ordinary review. Refining or choosing another proposal version requires that whole-proposal state. After acceptance, Undo or dismiss the current group before starting another change.

## Interruption and provenance

A journal records the exact operation targets and the previously accepted set before any source write. An interruption requires explicit recovery. Recovery restores only the interrupted operation’s targets to their pre-operation state and preserves earlier accepted units. Restart, Retry storage and source refresh never resume writes automatically. Unknown target contents and affected drafts block recovery.

The source artifact, original request and source context remain immutable. Scope belongs to the local checkpoint, not to a fabricated model reply. Legacy checkpoint formats remain readable. Analysis, selection, Apply, Undo and recovery retain existing trust, conversation ownership, storage, stale-source and cancellation guards.

## Verification scope

Existing isolated checks run the full proposed overlay. They remain available only when all units are selected and none are accepted. Narrowing the selection advances the revision and leaves previous results historical. Selected subsets do not inherit full-proposal verification. Compilation/process outcomes, interaction and visual verification stay separate; Apply is not a passing test.

## Acceptance status

Foundation 0.24 is installed and verified for the bounded module family above. 238 project tests, 811 desktop tests and eight packaged workflows pass. Native partial Apply, restart and Undo preserve unrelated source and drafts; interruption recovery, keyboard controls, both themes and narrow review are covered. All 20 installed payloads match the tested candidate, and the normal Orbit source, unsaved draft and layout remain intact. See [verification](../artifacts/verification-v0.24.md) and the running [product checklist](product-checklist.md). Live-provider quality, subset-specific execution and broader dependency support remain separate work.
