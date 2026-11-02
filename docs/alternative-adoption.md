# Named alternatives and reviewed adoption

M4.02a extends the first isolated comparison to a small library of named, retained CSS-token alternatives. Each result is still one exact token change against a saved project baseline. Scoped completed Build groups are now supported by [M4.02b](scoped-multi-file-alternatives.md); explicit two-candidate generation is defined in [M4.05](ai-alternatives.md); arbitrary autonomous generation remains later work.

## Flow

1. Prepare a token proposal and name its alternative. The name, token identity, source hashes and private impact metadata are frozen with its two source copies.
2. Explicitly Run its chosen scenario. Repeat with another proposal while saved project source stays unchanged.
3. Choose First result and Second result, then Compare results. Foundation resolves those exact retained IDs. It does not run a server or select a winner.
4. Compare captures and independent request, callback, compilation and visual outcomes. Shared requested conditions and actual measured browser conditions are shown separately.
5. Choose Review this change. Foundation verifies the original baseline, both copies, source hashes, saved scope and impact. It stages the exact token proposal and opens its native diff. A different current proposal must be explicitly discarded first; an applied checkpoint remains protected.
6. Use the existing Apply to source action. Its final serialized write guard rechecks retained provenance and source freshness. Undo checks the exact applied target and preserves unrelated changes.

## Comparison contract

Two distinct records may be compared when both completed their proposed-side observation and recipe, and their full baseline manifest, frozen feature/screen/scenario scope, recipe/fixture/catalog and requested width/theme/motion match. The changed token or CSS file may differ. Missing PNGs remain visible without discarding behavioral evidence. Measured viewport, browser color/motion preferences and capture availability remain separate observations.

Historical compatibility does not imply the current checkout is unchanged. Historical evidence remains readable after source changes; Review checks current saved inputs and refuses stale or dirty targets. Compilation remains Not recorded, visual assessment Not assessed and source-to-pixels correspondence Unverified.

## Storage and recovery

The existing four-record capacity remains explicit. Names and narrow token metadata live in the bounded journal. Private impact metadata has its own digest-bound companion record; source bodies are read only for Review or Apply from the owned copies. Full source bodies are never copied into ordinary comparison snapshots.

Version-one records without candidate metadata retain their evidence and compatible historical comparison. They cannot stage an adoption proposal. No migration invents a source basis.

Selections and names survive webview reload. Restoring a comparison does not load images, start servers, invoke recipes or apply source. Review preparation can be cancelled. Storage failure preserves the current checkpoint and never repeats source application automatically.

Apply's temporary write exception is limited to the exact regular file just created by Foundation's serialized writer. Its path, device, inode and content hash are checked; no filename pattern broadly bypasses manifest verification and no renderer supplies an exclusion.

## Acceptance

- [x] Two named token alternatives retain exact independent outcomes and source identity.
- [x] Compatible historical results compare without runtime or provider requests.
- [x] Incompatible baseline, scope, recipe or requested conditions have specific reasons.
- [x] Review stages exact private source and native diff without writing the project.
- [x] Drafts, changed source, current proposals, applied checkpoints and cancelled ownership block adoption safely.
- [x] Explicit Apply and Undo pass native verification with unrelated drafts preserved.
- [x] Names, selected comparison, captures and checkpoint restore in a second process.
- [x] Native light/dark/split layouts and the normal Orbit installation are verified.

Verified for the bounded single-token M4.02a workflow in [Foundation 0.39 evidence](../artifacts/verification-v0.39.md). M4.02 remains in progress; scoped multi-file alternatives are verified separately in 0.40. Requested app conditions and measured browser conditions remain separate. Laptop and physical input/display gates stay paused.
