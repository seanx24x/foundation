# Foundation 0.27 verification

Foundation 0.27 is installed and running. It removes redundant saved-source indexing and full panel snapshots from same-file caret and dirty typing events. [Detailed report](verification-v0.27.json).

## Behavior

Native caret ownership updates immediately. Column-only movement in the same loaded file does not rescan source, persist the same line or resend workspace state. Meaningful line/range presentation is coalesced to a bounded 100 ms window. The first dirty transition remains immediate; exact-source actions retain live validation. Source switches, saves, external source changes and explicit Refresh still run their analysis paths. Shutdown awaits the final queued focus write.

## Measured comparison

One sequential before/after pair used identical settings, source fixture, hardware and a visible 1440 × 900 native renderer (2× display scale). The machine was an Apple M3 Ultra with 32 logical cores and 512 GiB memory; this does not establish laptop performance. Each build recorded 160 warmup keys separately and 640 measured keys across four phases. Every key had one correlated upstream render measure; none was missing or excluded. The fixture contains 400 generated source files alongside the connected sample. AI used actual local Assistant streaming, indexing used real refreshes, and runtime load used instrumented local POST requests. Raw reports retain intervals and overlap evidence.

The timing below is Code OSS's **synthetic keydown-to-post-render task estimate**, not physical keyboard-to-display latency. State counts are full state deliveries to each visible panel during the phase.

| Phase | 0.26 renderer p95 | 0.27 renderer p95 | Workspace states | Assistant states |
| --- | --- | --- | --- | --- |
| idle | 18.8 ms | 19.2 ms | 320 → 0 | 320 → 0 |
| ai-stream | 18.8 ms | 19.0 ms | 400 → 82 | 400 → 82 |
| index-runtime | 19.2 ms | 18.3 ms | 341 → 72 | 341 → 72 |
| combined | 19.0 ms | 18.4 ms | 419 → 151 | 419 → 151 |

The prior renderer was already responsive in this fixture. The reliable change is less redundant background work; small timing differences from a single pair do not establish a general speedup. Continuous typing already deferred the old 250 ms indexing debounce, so no per-keystroke rescan claim is made. Explicit overlapping refresh load was measured separately.

[Raw baseline](editor-performance-baseline-v0.26.json) · [Raw candidate](editor-performance-v0.27.json) · [Comparison](editor-performance-comparison-v0.27.json) · [Pair integrity](editor-performance-pair-integrity-v0.27.json) · [Measurement contract](../docs/editor-responsiveness.md).

## Verification and installation

882 desktop tests pass with no failures or skips, including nine new focus/draft responsiveness regressions. Desktop TypeScript passes. Four packaged workflows pass: editor fundamentals, restart, completions/nearby edits, and connected runtime/source navigation. The performance fixture checks full expected text, unchanged saved-source hashes, preserved target/unrelated drafts, stopped provider streams and owned runtime cleanup.

All 20 installed extension payloads match the source and tested candidate, and deep/strict ad-hoc signature verification passes. Normal Orbit reopened with all eight saved files and the original 727-byte unsaved backup unchanged. The latest caret (29:13), two editor groups, Profile saving, and expanded far-right Assistant were restored. AI remains disconnected and suggestions are off. [Installed workspace](installed-orbit-v0.27.png).

## Open gates

M2.10c remains in progress. Physical keyboard-to-display, compositor presentation, long sessions, larger projects and populated-history load remain open. Full history snapshots and runtime-history freshness still have potential costs. Provider latency and quality were tested only with local fixtures. No preview was published and no competitor comparison was made.
