# Laptop and physical input acceptance

This is the handoff for M2.10c.5e.4–5. Foundation 0.30 has passed maintained-source endurance on an M3 Ultra workstation. Neither laptop performance nor physical keyboard-to-display latency has been measured. Preparing this protocol or passing the preflight does not complete either gate.

## Read-only preflight

From a prepared Foundation checkout on the target Mac:

```sh
npm run --silent desktop:hardware-preflight -- --require-laptop
```

The command reads the operating system, architecture, CPU, memory, hardware model and current power source. It prints a bounded JSON report, changes no settings and starts no application or benchmark. It does not request serial numbers, usernames or credentials. Exit status 2 means the supported laptop prerequisite was not established; read the reported reason before continuing. An unavailable command remains unknown.

Internal-battery evidence on an Apple Silicon Mac establishes a candidate laptop, not performance acceptance. Record the exact model yourself when the model identifier is unfamiliar. The preflight cannot determine the keyboard, active display, display refresh rate, camera configuration or power continuity. These remain explicit manual fields. Do not treat a desktop with an external UPS as a laptop.

## Prepare the target

Use an Apple Silicon MacBook with a local Foundation checkout, the exact tested app bundle, installed project dependencies, Node, Git and Python with SQLite support. Record OS build, physical and execution architecture, Node/Electron versions and app build provenance before work. Extension payload hashes do not identify the entire editor host. Record the installed dependency lock identity and relevant resolved package versions; the copied node_modules tree is outside the existing source manifest. The runner currently requires macOS, `/private/tmp` and APFS clone-copy support; Windows, Linux and Intel packages are outside this handoff.

Transfer only an explicitly selected application and source/dependency bundle after the target is identified. Exclude credentials, user settings, normal profiles, editor backups and unsaved drafts. This document does not publish or transfer anything. Never use normal Orbit as the benchmark workspace. The existing driver creates its own source copy and disposable profile.

The driver currently asserts an exact **1440 × 900 CSS-pixel workbench viewport at DPR 2**, but does not resize its window. Establish that geometry before qualification without changing the accepted assertion. If a built-in display cannot accommodate it, record the external display or approved scaling used. That establishes laptop-host performance for that display setup, not built-in-display acceptance. Changing viewport requirements requires a separately reviewed profile and fresh baseline.

Keep source and harness bytes fixed from qualification through endurance. Record the package and harness hashes from each report and compare the source manifests. A different source snapshot is a different workload; the workstation's original 308-file count is historical evidence, not a required count for a later checkout. Do not copy a passing status from the workstation onto a laptop report.

Record these before each condition:

| Field | Required evidence |
| --- | --- |
| Machine | Model, CPU, RAM, OS build, architecture, Node and app version |
| Power | AC or battery, battery percentage, selected energy/power mode, charger attached or detached; available thermal/power-pressure observations, otherwise unknown |
| Display | Built-in or external, resolution/scaling, selected refresh behavior, brightness setting |
| Input | Built-in or external keyboard, wired/Bluetooth, exact model where available |
| Workspace | Window dimensions, editor settings/theme, source/package/harness manifest identities |
| Environment | Other substantial workloads, ambient conditions, remote-control/screen-recording activity |

Do not change user power, display, sleep or accessibility settings automatically. Keep the Mac awake, unlocked and attended; the driver rejects sleep or stalled sessions. It drives a test editor and may move foreground focus, so avoid unrelated typing during the run.

## Run a laptop condition

Use a fresh report name for every attempt. Set FOUNDATION_APP_PATH to the exact verified bundle; the driver otherwise defaults to desktop/.build/Foundation.app. The following are examples; replace the app-path placeholder with the actual verified laptop location before running:

```sh
FOUNDATION_APP_PATH='/absolute/path/to/verified/Foundation.app' FOUNDATION_ENDURANCE_REPORT_NAME=laptop-ac-qualification-01.json npm run desktop:endurance -- --minutes=10
FOUNDATION_APP_PATH='/absolute/path/to/verified/Foundation.app' FOUNDATION_ENDURANCE_REPORT_NAME=laptop-ac-endurance-01.json npm run desktop:endurance -- --minutes=120
```

Run the second command only after the first passes and its raw evidence has been reviewed. Predeclare repeated qualification runs to examine variability; a single pass establishes only that observed configuration. The exact acceptance contract remains in [real-project endurance](real-project-endurance.md): measured synthetic typing, local streaming, ongoing indexing/runtime, native activation, preservation, restart and owned-process cleanup. Never relax those assertions to obtain a pass.

Capture preflight JSON before and after each run, and retain a timestamped power-state log while it runs. Endpoint samples alone cannot establish continuous AC or battery operation. If the source changes, battery is exhausted, power conditions change unexpectedly, or the Mac sleeps, keep that attempt and its evidence; rerun with a new name when ready. Stop at the operator's chosen battery reserve instead of risking shutdown. A cancelled run is incomplete, not failed hardware or accepted endurance.

The driver prints its cancellation-file path. To cancel, write `{"cancelled":true}` to that exact run's file, or interrupt its own driver. It performs bounded cleanup of its own processes. Do not terminate another Foundation window or the user's normal runtime.

Report AC and battery separately. Proposed coverage is qualification plus endurance for each condition; revise the declared coverage before running if the intended device cannot sustain the full battery duration. A passing AC run never implies battery acceptance. Report sample counts, actual elapsed time, typing duty, per-cycle and aggregate renderer latency, runtime/index activity, resource trends and preservation independently. Use the [0.30 archive](../artifacts/endurance-v0.30/README.md) as an evidence-structure reference, not a portable auditor: existing audit scripts contain workstation paths and require explicit adaptation to the new run.

## Measure physical input to visible text

This is a separate attended experiment. The existing endurance driver owns synthetic typing and is unsuitable for simultaneous human key presses. A physical trial needs a separately prepared disposable editor and a reviewed background-load setup that does not inject keys. That setup and the hardware measurement still need implementation/validation; no camera-only substitute is silently treated as the completed gate.

Measure the real editor's text appearing on the display. Establish an independently observed input boundary, ideally an electrical input signal with a synchronized optical indicator or calibrated input/display measurement equipment. A visible finger or moving key does not establish the electrical actuation instant. If that is all the camera captures, label the result **key-motion-to-visible-text approximation** and leave exact keyboard-to-display acceptance open. Hardware tools that observe input and emitted display light illustrate this distinction; NVIDIA describes its [latency/display analyzer](https://developer.nvidia.com/nvidia-latency-display-analysis-tool) and [camera-based system-latency measurement](https://www.nvidia.com/en-gb/geforce/news/reflex-low-latency-platform/). These references do not establish Mac compatibility for those tools.

For an approved camera setup:

1. Record the input marker and the affected editor text together. Fix camera position and the text's screen location. Document rolling-shutter/exposure limitations, panel refresh behavior and lighting.
2. Verify actual capture timestamps or capture frame rate. Slow-motion playback rate is not the acquisition rate; do not invent intermediate frames. At a verified constant 240 frames/s, one frame interval is about 4.17 ms, by `1000 / 240`; this is time resolution, not guaranteed measurement accuracy.
3. Record a warmup separately. Predeclare at least 150 valid key presses per condition across multiple independent clips/runs and the exclusion rules. Keep every attempt, including ambiguous or dropped frames; report exclusions and their reasons. Do not discard slow valid samples.
4. Mark the last unchanged and first changed frame for both the input marker and visible editor text. Retain the source recording digest, trial ID and frame/timestamp annotations. Use the same scene and boundary definitions for idle and loaded runs.
5. Calculate a latency interval for each trial. If input occurs within `[I0, I1]` and visible output within `[O0, O1]`, the supported interval is `[max(0, O0 − I1), O1 − I0]`. The input and output bounds must include capture-timestamp, exposure/rolling-shutter and input-marker offset uncertainty; frame brackets alone do not bound those effects. If calibration uncertainty is unbounded, acceptance remains inconclusive. A negative upper bound or inconsistent ordering invalidates the annotation. Preserve intervals rather than reporting unjustified decimal precision.
6. Report per-condition counts, median, nearest-rank p95, maximum and uncertainty bounds. With finite samples, an empirical percentile is not a population guarantee. Declare the physical acceptance target before recording. The design-system p95 feedback target is 50 ms, but using it here requires the defined physical boundary and sufficient precision; if uncertainty spans the target, label the result inconclusive. Synthetic renderer p95 remains a separate metric.

Suggested annotation columns: `run_id`, `trial_id`, `condition`, `recording_sha256`, `input_boundary`, `input_unchanged_time_ms`, `input_changed_time_ms`, `output_unchanged_time_ms`, `output_changed_time_ms`, `valid`, `exclusion_reason`, `notes`.

## Completion and current state

| Gate | Prepared | Still required |
| --- | --- | --- |
| Laptop M2.10c.5e.4 | Read-only preflight and run handoff | Identified laptop, exact package/source setup, declared AC/battery conditions, power continuity evidence, actual runs, independent audit |
| Physical M2.10c.5e.5 | Boundary, annotation and uncertainty protocol | Hardware selection/calibration, manual-input workload setup, recorded trials, independent annotation review |

Keep both gates open until their observed evidence exists. Foundation 0.30 and the user's normal Orbit state remain unchanged by this preparation. See the [running checklist](product-checklist.md).
