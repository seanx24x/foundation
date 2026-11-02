# Foundation 0.18 — request revisions

**Installed and running in the normal Orbit profile.** Stop and revise cancels the owned response and prepares its original instruction and exact saved-source selection. Revise request does the same for a saved terminal request. Both preserve a nonempty composer draft and require explicit Send. The new request retains local parent lineage, while the prior response and artifacts stay unchanged. All 20 installed extension payload files match the tested candidate and built source; the ad-hoc deep/strict signature passes.

## Results

- **177 project tests and 525 desktop tests pass**, without failures or skips. Both TypeScript targets and whitespace checks pass. Focused coverage includes 83 renderer/model checks, 59 conversation-store checks and 33 host/protocol checks; these overlap the full suite.
- Packaged native acceptance streams a partial Ask response, uses the actual Stop and revise control, and verifies that preparation makes no additional provider call. Explicit Send creates a distinct completed request with the identical ordered saved-source set and a local parent link. The original partial response remains unchanged.
- Exactly two loopback mock provider calls occur. Neither prior output nor local lineage is sent. A second native process restores parent/child history and the edited unsent revision with no extra provider request or resumed execution. All fixture source hashes and an unrelated unsaved draft remain unchanged.
- Host checks exercise exact active-request ownership, pre-start cancellation, delayed/failed storage, project/feature/chat/trust changes, source epochs, dirty/missing/changed source, stale replies and late retired-stream events. Source bytes and context order are revalidated after asynchronous work and immediately before dispatch.
- Schema 4 validates earlier terminal parents, immutable inputs, matching intent/context and invalid ancestry. Schemas 1–3 load without a migration write. Plan-derived requests retain their dedicated plan flow; staged/applied groups still block a new Build.
- All 17 packaged editor checks, native layout/context restart, grouped Build/Apply/restart/Undo and isolated Prepare/Run/restart/Stop regressions pass. Initial group checks exposed native harness focus races during mode/context activation; the unchanged candidate passed. The test now verifies mode and context after bounded real activation retries and before Send, and passed again. Both earlier failure logs are retained locally.

## Native acceptance and preservation

The populated revision fixture was reopened with AI disconnected and its test harness disabled. The prepared revision, preserved draft, source selection, prior response and parent navigation were inspected in Foundation Dark and Light. View original request focuses the exact earlier request in the same conversation. Renderer tests cover narrow panels, keyboard actions and delayed replies without draft loss.

The normal app was quit gracefully, refreshed and relaunched. Understand and ProfileForm retain their editor groups, SaveButton remains unsaved, and the Profile saving feature and right-hand Assistant are restored. Ask remains selected with no task brief or source included; AI is disconnected. All eight saved Orbit files and the original 727-byte unsaved backup match the pre-work hashes after installed native inspection. No Orbit source was saved or discarded. Nothing was published to Tailscale.

## Evidence and remaining scope

- [Machine-readable verification](verification-v0.18.json)
- [Native request revision and restart](request-revisions-native-v0.18.json)
- [Native editor](editor-native-v0.18.json), [layout/context restart](restart-native-v0.18.json), [grouped Apply/Undo](change-groups-native-v0.18.json), [isolated checks](execution-native-v0.18.json)
- [Native Dark](native-request-revision-dark-v0.18.png), [Light](native-request-revision-light-v0.18.png), [original request navigation](native-request-parent-v0.18.png), [installed Orbit](installed-orbit-v0.18.png)
- [Request revision contract](../docs/request-revisions.md), [running checklist](../docs/product-checklist.md)

M2.09h.1–3 are verified for this request-revision workflow. M2.09h.4–6 remain open: staged source-group revisions with preserved checkpoints, broader agent/tool steering and resumable decisions, and dependency-safe partial acceptance. This release does not resume a provider stream or arbitrary tool process. Live-provider acceptance, inline assistance, sustained-load measurements, scalable history, distribution and other platform gates remain open. No broad parent capability or M2 milestone is marked complete.
