# Foundation 0.16 — staged multi-file change groups

**Installed and running in the normal Orbit profile.** M2.09a–f are verified within the bounded change-group increment. Direct Build supports coordinated changes to two to eight explicitly selected existing files, with immutable staged snapshots, shared review, Apply all, Undo all and explicit interrupted-write recovery. All 20 installed extension payload files match the candidate and built source; the ad-hoc deep/strict signature passes.

## Results

- **177 project tests and 428 desktop tests pass**, without failures or skips. Both TypeScript targets and whitespace checks pass.
- The packaged workflow uses exactly one loopback mock request and empty credential profiles. Actual native controls send three selected sources, stage changes to two, open the exact API before/staged diff and Apply all. A second normal process restores the exact applied checkpoint and conversation, then actual Undo all restores both originals without another provider call.
- All 17 native editor checks pass. Ordinary startup leaves provider requests at zero and platform authentication dormant.
- The separate two-process workspace restart regression preserves editor placement, tab order, reversed selection, dirty source, activity, unfinished prompt and explicit source/task choices.
- Session and batch tests cover stale supporting source, dirty targets, source changes between writes and after the final journal callback, failed persistence before/after replacement, partial Apply and Undo, missing/unsafe files, cancellation, concurrent operations and explicit recovery after restart.
- Production-renderer checks cover both themes, keyboard controls and narrow panels. Current orphaned checkpoints remain reachable for recovery/discard; historical cards do not grant source-edit authority. A missing supporting basis cannot appear fresh.

Final review fixed cancellation during staging and saved-source changes after the last write. Native inspection also found a stale one-file composer placeholder; it now says “Describe the change…”. The focused 11-test AI renderer suite and packaged two-process group workflow were rerun after that final wording-only correction. The installed composer was inspected directly. Core host/service code is unchanged from the full-suite and native editor/layout checks.

## Native acceptance and preservation

The populated disposable fixture was reopened with its mock provider removed and harness disabled. The API member, immutable before/after source, three checkpoint records and shared central Review surface were inspected. Foundation Dark and Light were checked, and Dark restored. Generated-source compilation, interaction and visual verification remain explicitly Not run; observing this review interface does not verify the proposed application change.

The normal app was quit gracefully, refreshed and relaunched. Understand remains in editor group 1, ProfileForm in group 2 at line 29 column 13, and SaveButton remains an unsaved tab. The Profile saving feature, right-hand Assistant and empty explicit context are restored. Ask is selected; no task brief or source is included, and AI remains disconnected. No provider credentials or paid requests were used.

All eight saved Orbit files and the original 727-byte unsaved backup match the pre-work hashes after installed native interaction. No Orbit source was saved or discarded. Screenshots and reports remain local; nothing was published to Tailscale.

## Evidence and remaining scope

- [Machine-readable verification](verification-v0.16.json)
- [Native grouped changes and populated restart](change-groups-native-v0.16.json)
- [Native editor checks](editor-native-v0.16.json)
- [Native layout and context restart](restart-native-v0.16.json)
- [Native Dark review](native-group-dark-v0.16.png), [Light review](native-group-light-v0.16.png), [installed Orbit](installed-orbit-v0.16.png)
- [Change-group contract](../docs/isolated-change-groups.md)
- [Running checklist](../docs/product-checklist.md)

This increment stores isolated source snapshots outside the project. It does not provide a runnable worktree or command-executing agent. M2.09g–h retain runnable isolation, steering/resume and dependency-safe partial acceptance. New files, renames/deletions, general verification orchestration, real-provider acceptance, inline assistance, sustained-load measurements, scalable history, distribution and platform gates remain open. Cross-file writes are journaled and recoverable, not globally atomic. No broad parent capability or M2 milestone is marked complete.
