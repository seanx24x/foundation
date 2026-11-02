# Foundation 0.14 — feature relationship verification

**Installed and running in the normal Orbit profile.** M2.07h–l are verified. The focused Relationships view connects a feature to source-backed renders, calls, types, imports, styles, consumers, test references and request sites. All 20 installed extension payload files match the tested candidate and built source; the ad-hoc deep/strict signature passes.

## Results

- 113 project tests and 308 desktop tests pass, without failures or skips. Both TypeScript checks and whitespace checks pass.
- Included: 24 analyzer tests, 18 relationship host tests and 20 renderer checks across eight suites. These cover alias and shadowing safety, reassigned functions/global fetch, ambiguous exports, bounded safe reads, manifest changes, dirty buffers, stale identities, focus races, location-only persistence and recovery. Renderer acceptance includes real saved Orbit data, both themes and widths from 390 to 1100 pixels.
- The packaged relationship workflow passes using actual embedded controls in a disposable normal profile. It checks source/definition coordinates, Explore/Back/Reset, sanitized request expressions, dirty-source refusal and recovery, missing-export evidence retirement, refreshed navigation and unchanged source/feature/draft state. It starts no AI or runtime.
- All 17 packaged native editor checks pass, including language services, terminal, preview compilation and guarded Apply/Undo. Opening surfaces leaves provider requests at zero and platform authentication dormant.
- The two-process native restart regression passes: processes 76568 and 76654 preserve native groups, exact tab order, dirty text, reversed source selection, unfinished Assistant question and explicit context choices. Group widths remain 315 and 471 pixels.

The native relationship and restart harnesses are normal installed test extensions in disposable project, user, extension and shared-storage directories. A loopback-only CDP connection operates actual controls; it does not inject application state or host messages. The first relationship harness attempt incorrectly expected an explicit New Feature command to preserve the active source group. That harness assumption was corrected, and passive analysis was separately verified after restoring source focus. The final production payload is unchanged by that correction.

## Installed native acceptance

The normal app was quit gracefully, refreshed and relaunched. Understand and the existing native groups restored. The normal Profile saving feature retains its three members. Exact links involving the original dirty SaveButton are disabled, while saved-source exploration remains available.

The native workflow followed ProfileForm's call at line 29 to `saveProfile` at `src/api/profile.ts:8:23`, explored that source and opened its `POST /api/orbit/profile` expression at line 9, column 26. The UI labels it as source evidence and keeps runtime results separate. Feature membership and the explicitly empty Assistant source/task choices stayed unchanged.

Foundation was then quit with the original unsaved SaveButton active and the relationship explorer on API source. Relaunch restored the active draft in group two, Foundation Understand in group one, the API exploration source and its Back trail. Back returned to the primary ProfileForm source. The app is left open on that primary relationship view and its call site, with the original draft retained and AI disconnected.

All eight saved Orbit files and the original 727-byte unsaved backup match their pre-work hashes after the final relaunch. No source was saved or discarded. Native captures are retained locally at the paths in the machine-readable report; none was published to Tailscale. Installed native acceptance used Foundation Dark; both-theme and narrow acceptance also ran against the actual renderer independently.

## Evidence and boundaries

- [Machine-readable verification](verification-v0.14.json)
- [Native relationship report](relationships-native-v0.14.json)
- [Native restart report](restart-native-v0.14.json)
- [Native editor report](editor-native-v0.14.json)
- [Relationship behavior and limits](../docs/feature-relationships.md)
- [Running checklist](../docs/product-checklist.md)

This increment proves focused JavaScript/TypeScript relationships within the safe local inventory. It does not claim a complete call graph, package/path-alias resolution, observed network outcomes from source expressions, test coverage from references, or automatic scenario replay. Live provider acceptance, physical latency under sustained load, populated native conversation-history replay, scalable history, notarized distribution and independent platform gates remain open. Broader parent capabilities and M2 as a whole remain in progress.
