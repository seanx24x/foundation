# Foundation 0.41 verification — Project Decisions

M4.03 is verified and Foundation 0.41.0 is installed and running. The accepted choice now retains its user-authored rationale, exact source hashes, adoption checkpoint and independent comparison evidence. The normal Orbit workspace is preserved.

## Delivered

- Explicit Record decision after an applied retained token or whole-group alternative. Recording changes only local metadata.
- Immutable rationale and evidence, with explicit same-feature supersession. Historical entries remain available.
- Decisions in Review, feature and source understanding, with source navigation and a guarded link to the exact retained comparison.
- Separate source, adoption, evidence and scope states. Changed source or definitions, Undo, missing checkpoints and supersession prevent sharing as current.
- Explicit Assistant selection, up to four decisions within 16 KiB, for ordinary Ask, Plan, Build and Review. The exact disclosed snapshot is retained in schema 9 conversation history; earlier schemas remain readable. Specialized handoffs keep their existing bounded context.
- A bounded append-only local journal: 32 decisions / 2 MiB, explicit storage recovery, no silent eviction, no automatic source/runtime/provider action during restore.

## Verification

**1,561 desktop tests and 359 project tests passed, with no failures or skips.** Desktop and project TypeScript checks passed. Tests cover strict contracts, malformed and foreign context, capacity, storage failure/readback/rollback, immutable restart history, supersession, stale source and definitions, dirty buffers, cancellation, exact checkpoint identity and 32 tampering variants, all three provider protocols, and the four ordinary AI modes. Renderer checks include keyboard use, narrow/wide layouts and both themes.

The final signed candidate ran the complete native workflow in a disposable maintained React/Vite fixture and isolated profile:

1. Two actual Build requests through Assistant controls produced distinct two-file candidates: Soft save and Pill save.
2. Four isolated runtime observations and four PNG captures retained exact source, scenario, recipe and requested conditions. Original source stayed unchanged until explicit Apply.
3. Native diffs opened for both changed files; explicit whole-group Apply retained exact provenance.
4. A separate Record decision saved “Choose the softer save shape” and its rationale. The native screenshots show the expanded decision in both themes, with title/rationale viewport geometry checked.
5. View retained comparison opened the exact historical evidence without changing source or starting a runtime, provider request or image request.
6. A third explicit Ask selected the decision. The local provider request and durable turn contained the exact same canonical snapshot; recording did not select it automatically.
7. An actual saved source edit produced Stale. Restoring exact bytes returned Current. Undo preserved the immutable decision and showed Not applied.
8. A second process restored rationale, evidence, the retained group, selected comparison and unrelated unsaved draft. The selected decision stayed visible but blocked Send until removed. No runtime, provider, source action or image load occurred automatically.

The provider was a credential-free deterministic loopback protocol fixture: two Build requests and one Ask. This does not claim remote model acceptance. Comparison observations and captures describe isolated copies before adoption; compilation, behavioral assessment, visual assessment and source-to-pixels mapping are reported independently.

## Installation and preservation

All **32 installed payloads** match the signed native-tested candidate. Deep strict signature verification passed. Source maps bind the relevant extension and runtime modules to the tested bundles; the local decision journal, applied checkpoint and capture bytes were checked independently of UI assertions.

Eight saved Orbit files and the **727-byte unsaved SaveButton.tsx draft** are unchanged. Direct native inspection confirmed SaveButton active and selected in Explorer at 18:1; profile.ts remains a preview tab. The workspace panel is closed, bottom panel hidden, far-right Assistant and Request context expanded. Include task brief and only SaveButton remain selected; Ask mode, empty composer, unconfigured provider, dark theme and editor focus are preserved.

Rollback: `desktop/.build/Foundation-0.40-before-0.41.app`.

## Evidence and boundaries

[Native report](project-decisions-v0.41/native-report.json) · [Decision journal](project-decisions-v0.41/native-decision-journal.json) · [Installed payloads and preservation](project-decisions-v0.41/normal-install.json) · [Desktop tests](project-decisions-v0.41/desktop-tests-release.log) · [Project tests](project-decisions-v0.41/project-tests.log) · [Collection](project-decisions-v0.41/collection.json).

[Dark decision view](project-decisions-v0.41/write-decisions-dark.png) · [Light decision view](project-decisions-v0.41/write-decisions-light.png).

The preliminary native run passed its workflow but used the earlier integrity implementation and comparison-focused screenshots; it is retained separately and excluded from final accepted-run evidence. Initial unit failures were fixed (test harness dependencies and conversation schema 9 rendering); their logs remain separate from the passing release suite.

This increment covers retained web alternatives. Missing adoption checkpoints remain visibly unavailable; historical rationale stays readable. General project knowledge, reproducible issue capture, broader platforms, live provider acceptance, laptop and physical input/display measurements remain open. Hardware acceptance stays paused at the user's request. M0/M1 and broader parent capability gates are not closed by this increment.
