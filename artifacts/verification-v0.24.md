# Foundation 0.24 — selected changes

**Installed and running in the normal Orbit profile.** Choose changes derives local acceptance units from the exact original and proposed source. Linked files stay together. Apply selected writes the persisted selection; further batches require explicit selection. Undo accepted restores accepted files together and leaves skipped files alone. Restart restores the decision without writing source.

## Supported scope

The first implementation separates closed scalar JavaScript/TypeScript ES modules whose static relative dependencies are fully disclosed. It combines dependencies from both source versions and follows unchanged supporting modules. Unknown identifiers or effects, external/alias/dynamic dependencies, incomplete source, JSX and stylesheets keep the entire proposal together. Typical React and shared-style changes therefore remain whole-proposal changes. This is a source-dependency contract, not proof of behavioral correctness or intent.

## Verification

- **238 project tests and 811 desktop tests pass**, with zero failures or skips. Both TypeScript targets, JavaScript syntax and whitespace checks pass.
- Canonical plans partition every changed file. The host recomputes persisted plans from their private original basis; model and renderer declarations cannot authorize independence. Empty selection, wrong digests, stale revisions, malformed journals, forged splits, ownership changes and native drafts fail closed. Legacy formats retain whole-group invariants.
- Selection and applied receipts persist separately from immutable proposal context. Each Apply validates the complete expected mixture of original and previously accepted source. Undo and interruption recovery touch only their recorded targets. Two additional disposable audits each interrupt recovery twice across four restarts and preserve skipped drafts and prior acceptance.
- Eight packaged workflows pass on the final candidate: partial acceptance, whole groups, staged-group refinement, isolated execution, saved check plans, investigation continuation, 17 editor checks and workspace restart.
- The new workflow uses two native app processes, 15 trusted UI activations and exactly one explicit loopback Build request. It runs a real full-proposal Node check, accepts a linked two-file unit while leaving a third file pending, restarts, explicitly accepts the remaining unit, and undoes accepted files. Its unrelated saved edit and native unsaved draft remain intact. The full-proposal result becomes historical after scope changes and never certifies a subset.

## Native and visual acceptance

A separate populated fixture was reopened with its test harness disabled and AI disconnected. Actual native Dark and Light reviews were inspected: applied/pending units, quiet empty-selection guidance, disabled Apply selected, Undo accepted scope and historical check provenance. Renderer checks cover keyboard operation, malformed state and 170/280/384/560px widths. The automated reports explicitly leave manual visual acceptance separate.

The normal app was quit gracefully, refreshed and relaunched. All 20 extension payloads match tested source and candidate. The ad-hoc deep/strict signature passes; this is a local development build, not a notarized release. Eight saved Orbit files and the original 727-byte unsaved backup match their pre-work hashes after relaunch. Understand/source groups, ProfileForm line 34 column 57, Profile saving, the dirty SaveButton tab and far-right Assistant are restored. The original empty Ask context remains intact. AI remains disconnected; no preview was published.

## Evidence and remaining scope

- [Machine-readable verification](verification-v0.24.json), [two-process workflow](partial-acceptance-native-v0.24.json), [repeated recovery audit](repeated-recovery-audit-v0.24.json)
- [Native Dark](native-partial-acceptance-dark-v0.24.png), [native Light](native-partial-acceptance-light-v0.24.png), [installed Orbit](installed-orbit-v0.24.png)
- [Renderer Dark](partial-acceptance-dark-v0.24.png), [renderer Light](partial-acceptance-light-v0.24.png), [applied state](partial-acceptance-applied-v0.24.png)
- [Workflow contract](../docs/partial-acceptance.md), [running checklist](../docs/product-checklist.md)

M2.09h.6 and its acceptance gates are verified for this bounded module family. Loopback fixtures prove integration behavior, not live-model quality. Inline assistance is next. Subset-specific execution, wider dependency analysis, sustained-load performance, broader agent tools and the remaining milestones stay open.
