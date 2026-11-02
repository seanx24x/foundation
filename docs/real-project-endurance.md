# Real-project and workstation endurance acceptance

Foundation 0.30 is installed and verified. This increment adds acceptance tooling and removes unnecessary empty change-group busy publications; the accepted standard and generated-scale drivers and their reports remain unchanged. The running checklist splits real-source coverage, a ten-minute qualification, two-hour workstation endurance, laptop performance and physical keyboard-to-display measurement.

## Project and isolation

Use an allowlisted, byte-for-byte snapshot of Foundation's own maintained source in a disposable directory. Preserve a per-file manifest with exact hashes and sizes. Exclude credentials, local configuration, user profiles, generated builds, caches, Git internals and unrelated repositories. Copy only regular files and reject symlinks in the source snapshot. Any harness configuration or runtime adapter is a separately recorded overlay, never evidence that the original product contains that code.

The original repository and normal Orbit profile are not edited by the workload. Provider requests go only to a local fixture with no credentials. Foundation's copied frontend and its actual read-only `GET /api/workspace` endpoint provide runtime traffic. The harness starts the copied API and Vite through explicit sidecar configuration outside the snapshot, then connects Foundation to that external local target. It preserves the original package/config bytes. This does not verify automatic discovery of Foundation's combined development script. Record which actual source files are indexed, unavailable or excluded by current limits. Oversized files remain visible in the provenance report; a successful session must not be described as whole-repository analysis when coverage is partial.

## Workload

A cancellation probe and ten-minute qualification precede an uninterrupted two-hour session. A separate 160-key warmup is excluded from session typing totals. The owned runtime and source-refresh loop continue across measured and resting intervals. Each cycle includes 600 synthetic native keys at a minimum 50 ms cadence, with local AI streaming throughout typing. Cycles target a sixty-second interval; report actual durations and gaps, typing duty, completed refreshes and observed runtime activity. This simulates repeated editing bursts, not continuous typing or continuous model work.

Keep each model stream within the existing provider deadline. Rotate conversations explicitly before reaching capacity, preserve all previous records, and keep fixture output small enough to remain within existing history limits. Do not silently evict records or raise product capacity to make the test pass.

The typing window keeps the existing exact key-to-native-measure correlation and synthetic renderer latency threshold. Check current runtime ownership, accepted instrumentation and native observation freshness independently of successful application requests. Unknown acknowledgments remain unknown.

## Observer and preservation contract

Stream cycle and refresh evidence to files rather than retaining a growing session in memory. Bound renderer probes, state-message counters, runtime request lists, protocol tracking and retained raw cycle data. Record process-specific memory and CPU snapshots over time. Resource observations describe the measured session; they do not prove absence of every memory leak.

Keep all copied source bytes unchanged. Restore the target draft exactly after each cycle and preserve an unrelated unsaved draft. At completion, stop the owned provider/runtime/API processes, quit and restart the isolated app, and verify history, drafts, source hashes and disabled suggestions without making a new provider request. Failure or interruption must retain completed evidence and identify unverified gates; it must never become a success report.

## Hardware and remaining acceptance

The current workstation is Apple M3 Ultra with 32 logical cores and 512 GiB memory. Results on this machine are workstation evidence. Laptop hardware and power-state acceptance remain separate. The benchmark measures renderer events and frame callbacks; it does not measure physical keyboard delivery, compositor presentation or photons on the display. See the [laptop preflight and physical-measurement handoff](hardware-acceptance.md). The current runner also requires a 1440 × 900 CSS-pixel viewport at DPR 2; this geometry is asserted, not automatically configured.

## Reproduction and interruption

Use the installed 0.30 package or set `FOUNDATION_APP_PATH` to the exact package being verified. Give each run a distinct `FOUNDATION_ENDURANCE_REPORT_NAME` so failures and previous successes remain available.

```sh
FOUNDATION_ENDURANCE_REPORT_NAME=endurance-qualification-v0.30.json npm run desktop:endurance -- --minutes=10
FOUNDATION_ENDURANCE_REPORT_NAME=endurance-workstation-v0.30.json npm run desktop:endurance -- --minutes=120
```

Run the second command only after qualification passes. The runner prints its disposable directory and cancellation-file path. Cancellation stops the workload and produces an incomplete/cancelled result, followed by owned-process cleanup; it is not a successful endurance run. Never use the normal Orbit profile as a test profile.

Freeze manifest-listed source while a run is active. Store interim progress outside the repository, then update the checklist after source rehash and cleanup. Preserve raw per-cycle evidence, process-resource samples, runtime acknowledgments, refresh records and exact package/harness hashes alongside the summary.

## Status

The 0.29 maintained-source ten-minute qualification passed its independent audit. The first two-hour attempt failed after 74 cycles; a separate activation probe failed after 96 transactions and captured Ask becoming disabled during empty change-group assessment. The corrected 0.30 passes its activation diagnostic, ten-minute qualification and actual uninterrupted two-hour run with independent audits. Full-run results: 72,000 keys, 17.90 ms aggregate renderer p95, 14,970 refreshes, 53.64% typing duty and 7,200,612 ms continuous load. Exact source, drafts and history survive restart. Laptop and physical-display gates remain open. [0.30 verification](../artifacts/verification-v0.30.md) · [0.30 evidence](../artifacts/endurance-v0.30/README.md). [Retained evidence](../artifacts/endurance-v0.29/README.md) · [Running checklist](product-checklist.md).

`npm run desktop:endurance -- --activation-probe` runs a separate 120-transaction focus diagnostic. It performs no typing-latency or endurance-duration acceptance. Bounded per-gesture traces record focus, trusted key targets, current blocker text and the disposable fixture prompt; source revisions absent from the DOM remain unknown. Misdirected keys fail without replaying Send.
