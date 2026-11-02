# Foundation 0.13 — restart continuity verification

**Installed and running in the normal Orbit profile.** M2.11 is verified. Native layout, unfinished Assistant context and the existing source draft survived an actual quit and relaunch. All 20 installed extension payload files match the tested candidate and current built source; the ad-hoc deep/strict signature passes.

## Results

- 89 project tests and 289 desktop tests pass, with no failures or skipped tests. Both TypeScript checks pass.
- Included: 18 native-layout host regressions, 12 Assistant restoration host tests and 13 renderer restart checks. The broader renderer suites cover both themes, narrow layouts, keyboard use and recovery.
- All 17 packaged native editor checks pass, including source editing, language services, Git, terminal, preview compilation and guarded Apply/Undo. Opening surfaces made no request to the instrumented mock provider and left platform authentication providers dormant.
- A packaged two-process restart passes. Processes 36820 and 36892 restored exactly one Foundation Refine tab in group one, two source tabs in group two, the active dirty draft and its exact text, and a reversed multiline selection. Native group widths were identical at 315 and 471 pixels; the test allows a 0.5 percentage-point rounding tolerance.
- Actual native Assistant controls preserved the unsent Change question, one selected saved file, included task brief and open context disclosure. Restoration created no conversation and started no runtime or sandbox.

The restart runner uses the real packaged extension, a locally installed disposable test extension and isolated project, user, extension and shared-storage directories. A loopback-only CDP connection follows the pinned Code OSS automation approach to read and operate the actual embedded DOM. It does not inject webview state or fabricate host messages. Earlier extension-development runs were rejected as acceptance evidence because that mode lacks the normal durable backup path.

## Installed native acceptance

The normal app was quit gracefully, refreshed and relaunched. Orbit opened with Foundation in group one and its existing sources in group two. A temporary unsent Propose change request was entered through native UI, with only saved ProfileForm and API source selected and the task brief included. The app was quit with the original unsaved SaveButton active and Foundation set to Refine.

On relaunch, the same arrangement, Refine activity, active unsaved source, exact question, two selected files and task checkbox were visible. No source was saved or discarded. The temporary question and choices were then removed, returning to Understand, ProfileForm and the original explicitly empty Assistant context. AI remains disconnected.

All eight saved Orbit files and the original 727-byte unsaved backup match their pre-work hashes. The normal app remains open. Native captures are retained locally in `/private/tmp/foundation-013-native-before-restart.png`, `/private/tmp/foundation-013-native-after-restart.png` and `/private/tmp/foundation-013-installed-orbit.png`; they were not published to the private preview.

## Evidence and remaining gates

- [Machine-readable verification](verification-v0.13.json)
- [Two-process native report](restart-native-v0.13.json)
- [Native editor report](editor-native-v0.13.json)
- [Behavior and migration contract](../docs/restart-restoration.md)
- [Running checklist](../docs/product-checklist.md)

0.12 did not register its workspace serializer; its old workspace placement cannot be recovered retroactively. The first 0.13 launch uses group one when needed, and subsequent 0.13 sessions restore native placement. Runtime sessions and fresh observation selections deliberately do not reconnect automatically.

No live OpenAI/Anthropic acceptance, populated native conversation-history replay, sustained-load performance, scalable history, notarized distribution or new platform integration was claimed. Broad M0/M1 gates, remaining M2 work and all 24 parent capabilities stay open as recorded in the checklist.
