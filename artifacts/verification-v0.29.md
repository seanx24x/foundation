# Foundation 0.29 verification

Foundation 0.29.0 is installed and running. Source analysis is shared within each refresh; panels retain unchanged history records and receive versioned changes. Native Assistant controls and lazy workspace disclosures preserve activation through background refreshes without replaying clicks. Collapsed saved evidence and feature editors build their contents only when opened. Unchanged plain Assistant responses retain their DOM while current evidence and controls refresh. Orbit's eight saved files and original 727-byte unsaved draft remain intact.

## Checks

- 323 project tests and 952 desktop tests pass, with both TypeScript checks.
- Nine packaged workflows pass: editor, restart, feature, relationships, conversation, AI modes, connected runtime, scenario and partial acceptance.
- All 21 installed extension payloads match source and the tested candidate. The ad-hoc signature passes deep/strict verification.
- Normal Orbit relaunch preserves the source split, active file/caret, Profile saving feature, far-right Assistant, explicit empty source context and unsaved SaveButton draft. AI remains disconnected and suggestions off.

## Matched native scale comparison

Both preserved 0.28 and final 0.29 packages pass the matched final scale harness: 1,421 indexed files, 32 feature sources, 100 synthetic turns, 4,000 synthetic historical observations, 160 warmup keys and 4,200 measured synthetic keys. Actual local AI streaming, source refresh and instrumented runtime work overlap with editing. Histories, source and drafts survive restart; restart makes no provider request.

| Measurement | 0.28 | 0.29 |
| --- | ---: | ---: |
| Whole refresh arithmetic median | 36.09 s | 627.5 ms |
| Whole refresh maximum | 106.04 s | 1.136 s |
| Completed refresh cycles | 5 | 262 |
| Sampled state JSON median | 5,878,649 bytes | 479,704 bytes |
| Sampled AI JSON median | 3,775,124 bytes | 6,684 bytes |

This comparison uses one successful baseline run and one final candidate run on the same workstation, with intervening diagnostics. It does not estimate repeated-pair variance. The continuous refresh-loop policy is unchanged, so faster refreshes complete more cycles. Timing differences describe this fixture; they do not establish a universal speedup. Samples serialize the latest raw message outside typing and estimate JSON size, not total Electron IPC traffic. Renderer estimates do not measure physical keyboard-to-display latency. Raw phase timings, memory snapshots and runtime liveness remain in the [comparison](editor-scale-comparison-v0.29.json).

The separate host delivery specimen records first state 8,444,024 bytes, unchanged state 278,840 bytes and changed-turn AI message 3,925 bytes. Its generated context differs from the native fixture. These are JSON sizes, not native latency or wire-byte measurements. Full-history capacity validation and persistence remain separate costs.

## Interaction regression and retained failures

Five earlier candidate runs failed and remain recorded. Attempts 1 and 3 timed out evaluating the workspace after 600 AI-phase keys; attempt 2 stalled starting the next AI request after combined phase 2. [The earlier payload manifests](candidate-before-activation-fix-payloads-v0.29.json) and [activation-fix manifest](candidate-activation-fix-payloads-v0.29.json) distinguish those builds from the final renderer fix.

A separate real-browser regression proved that a background render could replace Send/Stop between native keydown and keyup or pointerdown and pointerup, losing activation. The fix defers DOM replacement for the current gesture while state and ownership checks remain immediate. Native activation occurs once; it is never synthesized. Changed source, provider, trust, project or request invalidates an old Send/Stop. Pointer cancellation and focus loss remain cancellation paths. Tests include context checkbox labels, disclosure continuity and adjacent actions.

Protection is scoped to the primary Assistant composer, source checkboxes/labels, Request context, mode buttons, workspace activity buttons and tagged lazy workspace disclosures. Other review, tool and expanded-dialog controls retain their existing behavior. The final full scale run passes without changing the frozen typing, liveness, timing or preservation assertions. A separate CPU diagnostic localized the repeated workspace evaluation stall to eager construction of collapsed runtime history. scenarioRunHistory accounted for 68.2% of sampled workspace time; repeated date formatting took 45.8% self time. The workspace reached 9.85 million retained DOM nodes and 1.92 GB observed embedder heap. These instrumented counters include retained/detached nodes and are not a count of visible rows. [Diagnostic evidence](renderer-diagnostic-v0.29.json).

Closed Runtime, saved-run, observation and feature-edit disclosures now defer their contents until opened. Keyboard disclosure, open-state persistence, freshness and draft handling are covered separately. The separate structural browser specimen, in both themes, reduces initial element creation from 53,930 to 275 and connected elements from 54,260 to 405. After twelve further state publications, connected elements remain 405, with zero hidden request rows, file options or date-formatting calls. These connected-element counts are distinct from native retained/detached-node counters. [Structural specimen](lazy-workspace-structure-v0.29.json). Expanding every saved observation at once remains outside this bounded acceptance.

A fourth attempt passed the formerly stalled AI phase, index/runtime and combined interval 1, then failed while waiting for an unchecked source control. Among all 35 observed fixture paths, only `package.json` produces the recorded error column with the exact driver expression. That disappearance is strongly inferred, not directly captured; a repeat retained all 32 feature sources and passed the transition. The optional source catalog includes background-loaded documents and may change. The driver now operates only on required or already checked rows and asserts that the final checked set is exactly `src/App.tsx`. Both builds were rerun under this same final driver. Phase counts, cadence, timing, overlap, liveness, source/draft preservation and restart checks are unchanged. [Control diagnostic](missing-context-diagnostic-v0.29.json).

A fifth attempt, using the final source-preparation harness, passed AI, index/runtime and combined intervals 1 and 2, then timed out after all 600 keys in combined interval 3. A full diagnostic reproduced the timeout in the Assistant target, evaluating the latest received payload sizes after typing. Earlier in that same workload, the Assistant spent 92.6% of sampled time in message-driven rendering, with 0.36% idle time; workspace was 80.1% idle. Position ticks concentrated on scroll restoration after pane replacement, which forced layout. Assistant counters reached 348,089 retained DOM nodes and 422 MB observed embedder heap. This distinguishes the later Assistant bottleneck from the earlier workspace history problem. [Assistant diagnostic](assistant-renderer-diagnostic-v0.29.json).

The CPU profiles stop on the first six-second delay after combined interval 2; the final ten-second timeout occurs later after combined interval 3. Function attribution therefore describes the earlier sustained overload, rather than a stack sample at the final timeout. Profiling, resource requests and watchdog sampling add observer cost. Neither these timings nor retained/detached-node counters establish a permanent memory leak or replace the final matched benchmark. The tested pre-fix package is preserved locally as `/private/tmp/foundation-029-before-assistant-render-payloads.tar.gz` (6,590,072 bytes; SHA-256 `efba3923e512fb8cc2c0569632ecaad6cbd2f00a7d2577390a8b9d7f7d241f6c`); its 21 payload hashes and archive identity are recorded in the diagnostic JSON.

The bounded response-retention contract keeps the Assistant page, layout, conversation and response region connected. Plain rows retain their passive ancestor chain and answer-text children only when the answer, source-citation identity/path/revision/lines, and full saved-runtime evidence match exactly. Changed content updates the answer leaf and its citation children; surrounding controls, warnings and evidence are freshly built. Project, conversation, feature or trust changes invalidate retained ownership. Artifact-bearing rows and expanded dialogs keep their existing update path. This does not claim that every Assistant artifact is retained, and retained DOM never grants action authority.

The [retained Assistant structural specimen](retained-assistant-structure-v0.29.json) covers ten completed plain answers containing 340,280 UTF-8 bytes plus one active response, in both themes at 384 × 900. Across twelve progress publications and twelve storage/runtime-state publications, tracked historical nodes remain connected with zero detachments or character-data changes; selected text and reading scroll are preserved while revision controls are replaced. Additional assertions cover changed answer/citation/runtime evidence, current stale/dirty/missing warnings, failure and archive controls, follow-bottom behavior, and ownership/trust invalidation. All 56 focused checks pass. This is browser structure and interaction evidence, not native timing or general responsiveness acceptance.

The final comparison uses the unchanged final typing harness after this fix; its pass, restart, native workflows, installed payload verification and normal acceptance are required before this report is generated.

The restart and partial-acceptance tests now bring their own real isolated windows to the foreground before key dispatch. A separate held-Space test also reproduced lost workspace activity navigation during a state update; those three activity controls now retain their target through the native gesture. Trusted key/click assertions remain; no source action occurred in the earlier focus failures.

## Evidence and remaining gates

- [Machine-readable verification](verification-v0.29.json)
- [Healthy 0.28 baseline](editor-scale-baseline-v0.28-for-v0.29-final.json), [final 0.29 run](editor-scale-final-v0.29.json), [comparison and all payload hashes](editor-scale-comparison-v0.29.json)
- [Earlier attempt 1](editor-scale-attempt1-v0.29.json), [earlier attempt 2](editor-scale-attempt2-v0.29.json), [earlier attempt 3](editor-scale-attempt3-v0.29.json), [earlier attempt 4](editor-scale-attempt4-v0.29.json), [earlier attempt 5](editor-scale-attempt5-v0.29.json)
- [History delivery specimen](history-delivery-v0.29.json), [retained Assistant structure](retained-assistant-structure-v0.29.json), [packaged workflows](native-workflows-v0.29.json)
- [Installed payloads/signature/preservation](installed-verification-v0.29.json), [normal native acceptance](native-normal-acceptance-v0.29.json)
- [Contract and reproduction commands](../docs/populated-history-performance.md), [running checklist](../docs/product-checklist.md)

M2.10c.5g–k are verified for this bounded increment. M2.10, M2.10c and M2.10c.5 remain in progress. Representative real-project/laptop, multi-hour and physical display acceptance (5e) remains not started. No external provider, public preview, deployment or source publication was performed.
