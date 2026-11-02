# Foundation 0.30 verification

Foundation 0.30.0 is installed and running. A background refresh previously published a temporary busy state while assessing an empty change group. That disabled Ask and could move keyboard focus into the composer before Send received Space. Empty, loaded, saved and error-free sessions now skip the unnecessary work while still checking ownership. Real change-group assessment, error recovery and mutation locks keep their existing behavior.

## Functional verification

- 962 desktop tests pass, including five new change-group regressions and five maintained-source fixture tests. Desktop TypeScript passes.
- Packaged native change-group and AI-modes workflows pass, including restart. The first suite run compared the still-running 0.29 normal bundle with 0.30 source and failed only that version assertion; the complete suite then passed against the actual 0.30 candidate.
- A separate 120-transaction native activation diagnostic and restart pass. All 250 traced activations use their intended trusted Space and native click, with zero misrouting or empty-group busy blockers. No synthetic click replay or weakened host guard is used.
- Ten-minute qualification and actual uninterrupted two-hour workstation acceptance both pass independent audits of raw evidence.

## Maintained-source workstation result

The exact run snapshot contains 308 saved Foundation source files (4,851,279 bytes), of which 287 files / 4,142,072 bytes are indexed. Two oversized files exceed the existing 256 KiB limit; 18 declaration files use an unsupported extension; hidden metadata is unindexed. This is one maintained application with explicitly partial indexing, not whole-repository or broad compatibility acceptance.

| Measurement | Ten-minute qualification | Two-hour session |
| --- | ---: | ---: |
| Actual continuous load | 600,447 ms | 7,200,612 ms |
| Measured keys | 6,000 | 72,000 |
| Separate warmup keys | 160 | 160 |
| Aggregate synthetic renderer p95 | 18.80 ms | 17.90 ms |
| Worst cycle p95 | 19.20 ms | 19.20 ms |
| Completed refreshes | 1,275 | 14,970 |

The full session runs 120 cycles of 600 synthetic keys at a minimum 50 ms cadence. Typing occupies 53.64% of the continuous session. Source refresh and the connected runtime remain active between bursts; AI streams through measured typing windows. Whole refresh median is 404.31 ms, p95 492.06 ms and maximum 819.32 ms. During typing windows, 27,585 actual application requests succeed and 27,534 runtime instrumentation records are accepted, with zero unknown acknowledgments. Those independent counters measure different events and need not match.

Every full-run activation trace reaches its intended control: 250 trusted Space events / 250 native clicks, including 120 Send and 120 Stop transactions. The 16,270 recorded events fit the bounded 512-event buffers (maximum 121 per trace), with zero drops, prompt misrouting or empty-group busy blockers. All 121 phase observer buffers stay within bounds. One New-conversation trace reports document focus false at keydown, then true, while the exact active control and trusted click remain correct; document focus was diagnostic, not an acceptance gate.

The final 14 conversations contain 220 turns and 4,825,333 bytes. All 100 canonical seeded turns, 40 synthetic saved runs / 4,000 synthetic observations, 16 feature sources and exact full persisted-content hash survive restart. Both unsaved test drafts are restored, runtime is idle, suggestions are off and restart makes no provider request. All source, 21 package payloads, three harness files and two sidecars pass rehash. Owned app/runtime/API processes and ports are stopped after the run.

## Resource observations and boundaries

Hardware: Apple M3 Ultra, 32 logical cores, 512 GiB RAM. Across 240 samples per scope, workbench heap peaks at 180.01 MiB, workspace at 44.35 MiB and Assistant at 54.96 MiB. Extension-host RSS rises from 592.05 to 753.02 MiB, peaking at 846.53 MiB. Samples include retained undo/history growth and garbage-collection timing; webview counters can share a process. No predefined memory ceiling was used and these results do not establish absence of leaks.

The model is a local deterministic fixture with no credentials or external provider requests. Runtime traffic uses the copied Foundation frontend and its actual read-only local API, connected through recorded harness-owned sidecars. Automatic discovery of the original combined development script is not established. Synthetic renderer measurements exclude physical keyboard delivery, OS input queues, compositor presentation and display hardware. Laptop performance, physical measurement, external model quality and broader repository compatibility remain open.

## Retained failure and normal installation

The first 0.29 two-hour attempt failed after 74 cycles with no 75th provider request. A short diagnostic then failed after 96 successful transactions and captured Ask becoming disabled during empty change-group assessment. Both failed reports and raw evidence remain preserved. The successful 0.30 runs are separate complete reruns, not continuations or reclassified failures. [0.29 evidence](endurance-v0.29/README.md).

Normal Foundation was quit through native UI before bundle replacement. The exact tested candidate was copied into the normal application path, all 21 extension payloads matched, and deep/strict signature verification passed. The previous 0.29 bundle is retained locally for recovery. No normal profile was used for the benchmark.

Native accessibility and visual inspection after relaunch confirm ProfileForm.tsx as the selected preview in editor group 2 with caret 18:1, the Understand workspace and Profile saving relationships, Explorer expanded, bottom panel hidden and Assistant expanded on the far right. Request context remains expanded with SaveButton selected and task brief included; AI remains unconfigured and the composer empty. These are the latest pre-install choices, not older acceptance defaults. All eight saved Orbit files and the original 727-byte unsaved SaveButton backup retain their exact hashes. The existing parent-repository notification was left untouched. [Installation and preservation](endurance-v0.30/normal-install.json).

## Evidence and checklist

- [Raw runs, archives, independent audits and hashes](endurance-v0.30/README.md)
- [Machine-readable verification](verification-v0.30.json)
- [Protocol and reproduction](../docs/real-project-endurance.md)
- [Running checklist](../docs/product-checklist.md)

M2.10c.5e.1–3b are verified for this workstation increment. Laptop and physical-display gates remain open; M2.10, M2.10c and M2.10c.5e remain in progress. No public preview, external provider, deployment or source publication was performed.
