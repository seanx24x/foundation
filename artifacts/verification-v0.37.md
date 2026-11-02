# Foundation 0.37 — visual-change verification

M3.05 is verified within the bounded workflow below and installed locally. Review can link an applied visual token proposal to an explicitly chosen saved scenario and exact before/after observations, then open their paired captures. Undo and replacement preserve the historical link. Navigation and linking do not execute an interaction or contact an AI provider.

## Verification

| Check | Result |
| --- | --- |
| Project and desktop TypeScript | Passed |
| Project regressions | 337 passed |
| Full desktop suite | 1,361 passed, zero failed or skipped |
| New journal/model tests | 25 passed: strict schemas, full hashes, identity binding, missing/altered evidence, capacity, recovery and independent outcomes |
| New host tests | 17 passed: applied target, ownership/source/storage races, passive navigation, Undo/replacement, cache invalidation and safe retry |
| New renderer tests | 9 passed: explicit selection, focus/drafts, acknowledgments, recovery, native navigation ordering, themes and narrow layouts |
| Packaged native workflow | Two actual Save requests, two native PNGs, 8px → 16px shared form radius Apply, explicit link and exact paired comparison |
| Undo and second-process restoration | Original saved CSS restored; retained evidence and unrelated unsaved fixture draft restored; runtime idle |
| Installation | All 32 checked payloads match the signed native-tested candidate; deep/strict signature passed |
| Normal Orbit | Eight saved files and original 727-byte draft unchanged; current layout, caret and Assistant context checked after relaunch |

[Native report](visual-verification-v0.37/native-report.json) · [Installation](visual-verification-v0.37/normal-install.json) · [Machine-readable evidence](verification-v0.37.json) · [Workflow](../docs/visual-change-verification.md) · [Desktop regression log](visual-verification-v0.37/desktop-tests-final.log).

## Actual desktop acceptance

The final run used the signed candidate `/private/tmp/foundation-037-candidate-lkOZLE/Foundation.app` and disposable profile `/private/tmp/foundation-visual-verification-smoke-VX3kU9`. It loaded the actual packaged extension and the maintained connected-web fixture. Only the fixture's runtime-plugin path and copied dependencies changed for setup. Its six selected source files include the changed stylesheet.

The native running app saved a profile successfully at the original 8px form radius. Foundation recorded the actual HTTP 200 request and cropped its visible preview into a PNG. The saved-source sandbox then prepared and applied the reviewed `--orbit-radius` change to 16px. A second explicit observation recorded another real Save and capture. Computed form radius, complete target hashes, PNG byte lengths and SHA-256 values were checked independently.

Review linked the user-selected scenario and exact pair. Explicit choices survived a host refresh. View scenario changed context without adding observations or captures; Link evidence and Compare observations retained the existing runtime session and two records. The comparison loaded both exact verified PNGs. Source association, manual assessment, callback outcome, capture availability and compilation remained separate. Compilation was Not recorded, manual assessment Not assessed and source-to-pixels Unverified.

Undo restored the exact saved token source. A replacement proposal retained the earlier link. A second native process restored that history and both PNGs with the runtime idle, no provider requests, the same proposed replacement and exact unrelated dirty draft bytes. All saved fixture source returned to its original hashes.

Native buttons and disclosures use trusted CDP keyboard events on actual controls; selects use recorded control-level selectOption equivalents. This is automated desktop acceptance, not physical keyboard/display or human usability acceptance. Native dark/light review, paired capture and restart screenshots are retained beside the report. Renderer light/dark and 320px evidence was also inspected.

## Corrections and performance

Review caught and fixed presentation-only capture fields rejecting valid evidence, late retry ownership, misleading definition-change warnings from a global history revision, and comparison navigation leaving lazy disclosures collapsed. Model comparisons use exact frozen source and scope; full bindings prevent accidental capture/replay joins. Failed optional storage preserves readable observations while withholding unavailable attachments.

A single cached projection prevents repeated validation of unchanged populated history. The focused synthetic 4.94 MiB/40-run check recorded a 33.91ms cold projection and 0.125ms mean across 50 repeated publications, with one model rebuild. This is a bounded regression measurement, not renewed workstation/laptop acceptance.

Earlier attempts remain distinct: `UToH5h` failed on the harness's abbreviated capture-button label; `jv0ahK` exposed the real comparison disclosure bug. `ft762d` passed the complete workflow and restart on the prior candidate; a final type-narrowing source edit prompted a fresh rebuild and the final run above. Failed attempts are retained in temporary diagnostic folders and excluded from passing acceptance. The initial full-suite run had 15 outdated VM dependency mocks; the final suite passes after wiring the real new module into those harnesses.

## Installation and remaining boundaries

Installed Foundation 0.37 preserves the normal `profile.ts` preview at 9:1, unsaved SaveButton tab, closed Foundation workspace panel, Explorer, hidden bottom panel and far-right Assistant. Request context stays expanded; the task brief and only SaveButton source are selected; Ask is active and the composer remains empty. The 0.36 rollback bundle is retained locally.

The journal is bounded to 40 immutable pairs, eight per proposal and 1 MiB, with no silent eviction. Matching saved hashes do not prove which source produced runtime pixels. Missing evidence is not replaced. No full project compilation, automatic visual pass, backend provenance, live provider, native-platform adapter or full environment-snapshot acceptance is claimed. Laptop and physical input/display work remains paused.

The [running checklist](../docs/product-checklist.md) marks M3.05 verified within this scope; broader M2/M3 capabilities remain open. Next is the first bounded M4 alternative-comparison design and isolation contract.
