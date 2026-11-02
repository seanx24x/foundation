# Editor responsiveness

Foundation 0.27 separates native editor activity from saved-source analysis. Its acceptance work is tracked under M2.10c in the [running checklist](product-checklist.md). Foundation 0.27 was verified; the installed 0.28 increment adds [populated histories and a larger generated fixture](populated-history-performance.md). The native synthetic comparison and functional checks are recorded in [0.27 verification](../artifacts/verification-v0.27.md); physical input-to-display and long-session acceptance remain open.

## Interaction contract

A caret move updates the selected source location immediately in the host. Moving within an already loaded file must not rescan the project or invalidate an in-flight refresh of that same saved source. A changed file or project still invalidates obsolete work and loads the new source.

Column-only movement does not change the line-based Foundation context. Meaningful line/range changes can be coalesced for presentation, while the native caret and action guards remain immediate. The latest source location must survive restart.

The first unsaved edit immediately marks affected evidence as unavailable. Further typing in the same dirty file does not need to resend unchanged saved-source snapshots or rebuild both panels. Save, external source changes, explicit Refresh and project transitions retain their existing source-analysis paths. Direct Apply, navigation and provider actions must still validate their current source and ownership independently of any queued presentation.

## Native measurement

Run `npm run desktop:performance` against a packaged app. Use `FOUNDATION_APP_PATH` to select a candidate. The harness creates a disposable project and profile, drives the real native editor, uses a loopback provider and instrumented local runtime, and records raw samples alongside its environment and workload evidence. It does not use the normal Orbit profile or its unsaved buffer.

Keep the following measurements separate:

| Measurement | Meaning | Excludes or cannot establish |
| --- | --- | --- |
| Code OSS `inputlatency` | Synthetic keydown to the editor's post-render completion estimate, observed through the pinned host's Performance API measures | Physical keyboard dispatch, compositor presentation and display scanout |
| Keydown to editor DOM update | Renderer event handling through observed visible text mutation | Browser paint and physical input delay |
| Next animation frame after the DOM update | A frame-scheduling observation | Proof that the changed pixels were presented |
| Driver round trip | Test-driver dispatch and acknowledgement, including automation transport | A direct user-perceived latency measurement |
| Provider duration | Local fixture request lifetime | Production-provider latency or quality |

Idle and loaded phases must use the same fixture, viewport, theme, editor settings and sample policy. Preserve every raw sample, report invalid or missing observations, and exclude documented warmups from percentile calculations. Report actual provider streaming intervals, indexing activity and runtime observations during typing. Merely starting a workload before typing does not prove overlap.

Inline completion requests intentionally cancel when typing changes their captured source. Sustained AI measurement therefore uses an independent Assistant stream; completion cancellation remains a separate acceptance check.

## Budgets and limits

The design system targets p95 local input feedback below 50 ms. Synthetic renderer estimates can detect regressions against that target but cannot certify the physical input-to-display gate. Short generated workloads also do not establish long-session or large-monorepo performance. No competitor ranking is inferred.

A passing run requires exact expected editor text, preserved unrelated drafts, unchanged saved-source hashes, bounded request sharing and cleanup of the fixture's owned runtime/provider processes. Compilation, native functional acceptance, measured responsiveness and normal-profile restoration are recorded separately.
