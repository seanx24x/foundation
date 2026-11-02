# Foundation 0.28 verification

Foundation 0.28 is installed and running. It fixes sustained runtime observation delivery and reuses digests of identical loaded source without caching freshness decisions. [Detailed report](verification-v0.28.json).

## Sustained runtime delivery

The real Chromium transport diagnostic sent 500 application requests. All returned HTTP 200, but the old instrumentation accepted only 194 request observations before stopping at 65,376 event-body bytes. Draining instrumentation acknowledgments or reserving keepalive for pagehide each restored all 500 observations; 0.28 applies both. Ordinary application responses remain untouched. [Diagnostic](runtime-transport-diagnostic-v0.28.json).

The unchanged 0.27 packaged baseline also fails the native runtime-liveness guard: its last accepted/native observation is 8.69 seconds old at the end of the index/runtime phase (five-second bound). Its partial phases are retained as failed evidence, not a successful simultaneous-load comparison. The 0.28 candidate completes the full profile and restart using identical fixture, settings and harness. Later candidate-only timings do not establish a comparative speedup.

## Measured source-history work

A separate host microbenchmark uses 40 runs, 4,000 synthetic observations and 32 sources totaling 256 KiB. Across 80 rotated-order samples, full runtime snapshot median changed from 10.42 to 5.55 ms; p95 changed from 11.33 to 6.48 ms. First-snapshot source hashes fell from 1,280 to 32; the next 80 unchanged snapshots required zero source hashes instead of 102,400. Store cloning still takes 5.24 ms median. These are host measurements, excluding webview transfer and rendering. [Raw microbenchmark](history-snapshot-benchmark-v0.28.json).

Exact source text, project/root ownership and loaded-source membership control reuse. Source/definition changes, missing or unloaded files, archived definitions and active observations are re-evaluated every update. The cache is pruned and cleared at ownership/trust boundaries. Eight new regression cases cover these distinctions.

## Native scale fixture

The matched pair contains 1,421 indexed files (3,927,043 bytes, untruncated), including 1,400 generated corpus files and eight 192 KiB files. Ten conversations retain 100 synthetic turns (3,713,620 serialized bytes); 40 synthetic runtime runs retain 4,000 records (1,833,187 bytes). All 32 feature sources fit the 256 KiB loaded-context cap. The Vite configuration differs by 13 bytes solely because the selected packaged plugin paths have different lengths; its normalized content is identical. Seeded historical requests were generated offline; their explicit labels do not claim real interactions.

The candidate records 160 warmup keys and 4,200 measured keys; the baseline stops at its runtime-liveness failure. Seven measured windows provide at least 210 seconds of cumulative typing. Four combined windows explicitly restart the local provider within its 60-second request deadline while indexing and runtime load continue; gaps are excluded and reported. Every key has exactly one correlated Code OSS render measure. Source hashes, exact draft text, history and restart are checked.

The following is a **synthetic renderer keydown-to-post-render task estimate**, not physical input-to-display latency. Instrumentation counts are confirmed event acknowledgments, including heartbeat messages. The pair uses the same generated fixture, synthetic history, harness, settings, hardware and 1440 × 900 renderer.

| Candidate phase | Keys | Renderer p95 | Confirmed instrumentation events | Unknown status |
| --- | --- | --- | --- | --- |
| idle | 600 | 20.1 ms | 0 | 0 |
| ai-stream | 600 | 18.0 ms | 0 | 0 |
| index-runtime | 600 | 18.9 ms | 241 | 0 |
| combined-1 | 600 | 21.2 ms | 273 | 0 |
| combined-2 | 600 | 23.2 ms | 273 | 0 |
| combined-3 | 600 | 20.8 ms | 271 | 0 |
| combined-4 | 600 | 23.5 ms | 274 | 0 |

The failed baseline prevents a full-load timing comparison. Idle and AI phases are retained for inspection; no general editing speedup is claimed. Raw reports include live provider overlap, completed untruncated refreshes, instrumented runtime requests, per-key samples and phase-boundary memory readings. Payload sizes are sampled once before/after phases outside timed typing; they estimate UTF-8 JSON size, not IPC wire traffic. Settled candidate refresh commands took 30.55 seconds median and 119.38 seconds at most; a refresh cycle may span typing windows. This is the entire refresh cycle, including repeated source reads and analysis after the initial inventory timestamp; it is not one file-inventory scan. Its long duration remains a performance finding. Memory readings separate extension-host RSS from the workbench renderer's V8 heap and do not cover all app processes or establish absence of leaks.

[Raw baseline](editor-scale-baseline-v0.27.json) · [Raw candidate](editor-scale-v0.28.json) · [Comparison and resources](editor-scale-comparison-v0.28.json) · [Pair integrity](editor-scale-pair-integrity-v0.28.json) · [Contract and commands](../docs/populated-history-performance.md).

## Verification and installation

895 desktop tests pass with no failures or skips; desktop TypeScript passes. The final focused history/fixture rerun passes all 11 cases, including the added disposable-profile guard. One restart UI selection attempt timed out while the full test suite ran; it passed on its isolated rerun in 5.17 seconds. The failed-attempt log is retained. Five packaged workflows pass: editor fundamentals, restart, code suggestions, connected runtime, and scenario capture/freshness/restore. The fixed candidate also passed the standard 800-key benchmark and runtime-ownership assertions before the final scale readiness/index-completion refinements; its original harness hashes are retained. The scale fixture additionally confirms all 40 seeded histories and both disposable drafts survive restart without contacting the provider.

All 20 installed extension payloads match source and the tested candidate, and deep/strict ad-hoc signature verification passes. Normal Orbit reopens with all eight saved files and the original 727-byte unsaved backup unchanged. The latest caret (29:13), two editor groups, Profile saving and expanded far-right Assistant are restored. AI remains disconnected and suggestions are off. [Installed workspace](installed-orbit-v0.28.png).

Confirmed instrumentation rejection fails the check. Missing passive diagnostic statuses remain unknown; runtime ownership and recent native observations must also pass. No gap-free observation claim is made from sampled native history. The pagehide regression dispatches a synthetic event; actual browser teardown delivery remains outside that test.

## Open gates

M2.10c.5 remains in progress. Representative real projects and laptops, multi-hour sessions, physical keyboard-to-display and compositor presentation remain open. Repeated project/source analysis during whole refresh cycles, history cloning and full-state delivery remain costs to address separately. No preview was published and no competitor comparison was made.
