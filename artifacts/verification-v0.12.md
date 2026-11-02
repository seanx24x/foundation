# Foundation 0.12 — runtime screens and manual scenarios

This increment connects a feature’s source working set to named running screens and manual scenarios. It does not complete M2 or provide automated scenario replay. The [running checklist](../docs/product-checklist.md) retains every broader capability and release gate.

## Delivery state

Foundation **0.12.0 is installed and running** at `desktop/.build/Foundation.app` in the normal Orbit profile. All 20 extension payload files match canonical source and the tested candidate at `/private/tmp/foundation-012-candidate-36h44i3w/Foundation.app`. Ad-hoc deep/strict signature verification passes after installation and relaunch. The normal app was gracefully closed before refresh; no Documents prompt appeared. Nothing was published and no AI provider was contacted.

## Behavior

- Understand’s Runtime disclosure manages local screen and scenario definitions, with revision guards, retained drafts, archive/restore and storage recovery.
- A screen binds a name, recognized target and safe relative route. Selecting metadata does not start project code. Open screen explicitly starts or navigates the target, preserving its owned process while rotating the view identity.
- Requested route, observed route, document identity and navigation revision determine readiness. Leaving and returning between polls must still interrupt an observation.
- Scenarios contain manual steps and an expected result. Begin records saved-source hashes and exact runtime ownership. The person performs the steps and supplies an optional assessment and note.
- Observed request completions remain distinct from manual assessment, compilation, visual quality and causality. No backend behavior is inferred. Requests before the interval or from another session/view/document are excluded.
- Stop, disconnect, source unavailability/change, feature change, reload and navigation interrupt safely. History retains immutable definitions and source evidence; freshness is current, stale or unknown. Restart never silently resumes an old runtime.
- Definition drafts, source editor drafts, Assistant context and active canvas are retained across unrelated updates. Scenario history never sends a provider request.

## Verification boundaries

Project, host/store, rendered webview, packaged native behavior and actual native visual acceptance are recorded separately. Native test scenarios run in disposable cloned fixtures and isolated profiles. Their Chromium interactions and explicit fixture-supplied assessments do not by themselves establish native mouse/keyboard visual acceptance.

After installation and native interaction, all eight saved Orbit files and the original 727-byte unsaved SaveButton backup match the pre-work hashes. The unsaved tab is restored. No source save or discard occurred.

## Executed checks

| Check | Result |
| --- | --- |
| Project regression | 89 passed |
| Final packaged desktop suite | 246 passed, 0 failed, 0 skipped |
| Extension TypeScript | Passed |
| Packaged native editor / Assistant | 17 checks passed |
| Packaged connected runtime | 9 checks passed |
| Populated feature restart | 11 checks across two native processes passed |
| Runtime scenario native workflow | Five write-stage checks plus restart recovery passed across two processes |
| Native mouse / keyboard walkthrough | Open screen, begin, successful and failed saves, explicit assessment, note, finish and history inspection passed |
| Themes | Dark recording and history; transient Light history preview inspected, Dark restored |
| Installed payload / signature | 20 files match source and candidate; ad-hoc deep/strict verification passed |
| Orbit preservation | Eight saved files and 727-byte unsaved draft unchanged |

The native scenario harness additionally exercises a synchronous A-to-B-to-A route round trip, verifies interruption despite the final matching route/document, rejects private query values from history, changes/restores disposable source and proves immutable history after restart. No earlier request is silently included in a new observation. Separate host tests cover trust/project changes during persistence, storage retry/orphan recovery, source unavailability despite cached bytes, and delayed source reads after navigation.

## Visible native acceptance

The final candidate opened the disposable connected fixture with its saved Profile screen and Save success and failure scenario. Native UI actions opened `/profile`, began an observation and automatically disabled Inspect. Save showed **Changes saved** and produced a 200 observation. The HTTP failure case showed a retry message and restored **Save changes**, producing a 503 observation. The recording remained **Not assessed** until the explicit manual choice. Finish saved the note and both requests; history showed the expected assessment, immutable definitions and saved-source match.

The normal installed app was then reopened in Orbit. Its existing Profile saving feature, primary ProfileForm source and unsaved SaveButton tab returned, and the new Runtime empty state is visible. Orbit itself was not instrumented or given sample runtime definitions; the end-to-end running workflow used the disposable connected fixture.

A restart continuity gap was observed: the workspace webview initially reopened in the source editor group, leaving its old group empty, and unsent Assistant context selection reset. The editor split was restored manually using the native move-editor command. This is tracked as **M2.11**, and broad P02 / A01 acceptance remains open. The draft was never saved or discarded.

## Evidence

- [Installed build, asset hashes and preservation](verification-v0.12.json)
- [Native editor / Assistant](verification-v0.12-native.json)
- [Connected runtime](verification-v0.12-runtime.json)
- [Feature restart](verification-v0.12-features.json)
- [Scenario workflow and restart](verification-v0.12-scenarios.json)
- [Native recording — Dark](foundation-012-native-recording-dark.png)
- [Native history — Dark](foundation-012-native-history-dark.png)
- [Native history — transient Light preview](foundation-012-native-history-light-preview.png)
- [Installed Orbit workspace and preserved draft](foundation-012-installed-orbit.png)

## Remaining work

Richer project relationships, all four AI modes, isolated multi-file execution, intent-based review and inline assistance remain in M2. Automatic replay, paired captures and comparison remain in M3. Live commercial-provider acceptance, physical input-to-paint/sustained-load measurements, populated native conversation history visual replay and scalable runtime history storage remain explicit release gates. See the [runtime guide](../docs/runtime-scenarios.md) for current capacity and platform limits.
