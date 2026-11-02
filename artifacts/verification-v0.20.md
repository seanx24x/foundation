# Foundation 0.20 — saved check plans

**Installed and running in the normal Orbit profile.** Save an ordered plan of available Node and TypeScript checks, then run one step at a time. Retry creates a fresh isolated copy; Skip and End preserve the decision without claiming a pass. Restart restores the next decision and previous attempts without running a project check or contacting a provider. All 20 installed extension payload files match the tested candidate and built source; the ad-hoc deep/strict signature passes.

## Results

- **197 project tests and 636 desktop tests pass**, without failures or skips. Both TypeScript targets and whitespace checks pass. Focused backend, host and capacity renderer/model suites pass 52, 40 and 52 checks respectively; these overlap the full suites.
- Packaged acceptance uses three native processes and one loopback Build request. Saving the plan runs no checks. The first Node check pauses before TypeScript; restart preserves that decision. Skip retains an unrun step without certifying it. A separate plan runs actual Node and TypeScript commands, each from its own explicit decision and fresh copy.
- A slow Node command is stopped through the native control. A third process restores the cancelled attempt without running it. Explicit Retry creates a distinct attempt and execution, passes, and retains the earlier cancelled result. End on a new pending plan runs nothing. Fixture sources and its unrelated native draft remain unchanged.
- The native Stop walkthrough exposed an overlapping journal save: the command stopped but the plan could retain an unresolved running attempt. Stop now awaits the executor's final save before recording its outcome. Deterministic delayed-save tests and the final packaged workflow pass.
- Exact group revision/digest, full copied-source identity, active-attempt identity, ownership, native drafts, storage failures, atomic commit boundaries and stale/duplicate decisions are covered. The renderer explains storage recovery and history capacity; skipped or historical checks never become a passing verdict.
- All seven packaged workflows pass: saved plans, staged group revisions, request revisions, isolated checks, layout/context restart, grouped Apply/Undo and 17 native editor checks.
- An initial full suite passed 630 of 631 with a runtime lease timeout. Diagnostics exposed a shared Vite cache across concurrent fixtures. Each fixture now owns its cache; 12 runtime tests, four concurrent diagnostics and the final default-concurrency full suite pass. The initial timeout was not reproduced; the cache hazard is not presented as its proven cause. Production runtime and the existing timeout budget are unchanged.

## Native acceptance and preservation

The populated plan fixture was reopened with its test harness disabled and AI disconnected. The ordered plan, retained attempts and historical results were inspected in Foundation Dark and Light. One additional two-step plan was saved in the disposable fixture for theme inspection, with both checks left unrun; it is separate from the automated report. Renderer checks cover keyboard access, narrow widths, paused/running/stopped/completed states and separate execution/plan storage recovery.

The normal app was quit gracefully, refreshed and relaunched. Understand and ProfileForm retain their native editor groups and the source selection at line 34, column 17. SaveButton remains unsaved. Profile saving retains three files. The right-hand Assistant collapses and restores; Ask remains selected with zero source files, no task brief included and an empty composer. AI is disconnected. All eight saved Orbit files and the original 727-byte unsaved backup match the pre-work hashes after installed native inspection. No Orbit source was saved or discarded; nothing was published to Tailscale.

## Evidence and remaining scope

- [Machine-readable verification](verification-v0.20.json)
- [Native saved plans](check-plans-native-v0.20.json), [staged group revisions](group-revisions-native-v0.20.json), [request revisions](request-revisions-native-v0.20.json)
- [Native editor](editor-native-v0.20.json), [layout/context restart](restart-native-v0.20.json), [grouped Apply/Undo](change-groups-native-v0.20.json), [isolated checks](execution-native-v0.20.json)
- [Native Dark](native-check-plan-dark-v0.20.png), [Light](native-check-plan-light-v0.20.png), [history](native-check-plan-history-v0.20.png), [installed Orbit](installed-orbit-v0.20.png)
- [Check-plan contract](../docs/check-plans.md), [running checklist](../docs/product-checklist.md)

M2.09h.5a–f are verified for fixed supported checks: one or two ordered checks, eight retained plans, a 1 MiB journal, thirteen attempts per plan and the existing thirteen execution records shared with preparation and standalone checks. Evidence is never silently evicted. Broader agent/tool execution and model-selected decisions remain M2.09h.5g; dependency-safe partial source acceptance remains h.6. Live-provider quality, scalable history, inline assistance, sustained-load measurements, distribution and other platform gates remain open. No broad parent capability or entire M2 milestone is marked complete.
