# Foundation 0.33 — explicit scenario replay

**M3.03a–c is verified and installed.** A connected React/Vite app can register named fixtures and bounded replay steps. During a manual observation, choose a recipe and explicitly run it. Foundation records preparation and each callback, offers Stop, and keeps replay evidence with observation history and paired visual captures. Callback completion does not change the manual assessment or establish a visual, behavioral or accessibility pass.

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop regression suite | 1,166 passed; zero failures, skips or cancellations | [Log](scenario-replay-v0.33/desktop-tests.log) |
| Desktop TypeScript | Passed | [Log](scenario-replay-v0.33/desktop-typecheck.log) |
| Native bridge types | Six generated upstream files; zero diagnostics | [Log](scenario-replay-v0.33/native-bridge-typecheck.log) |
| Runtime replay | 13 focused tests pass, including real timeout, repeat, cancellation, HMR invalidation, origin/identity checks and no arbitrary script execution | [Log](scenario-replay-v0.33/runtime-replay-tests.log) |
| Persistence and ownership | 25 store and 15 host cases pass: write-ahead transitions, reconciliation, failed-write retry without rerun, exact source/runtime identity and restart interruption | [Full suite](scenario-replay-v0.33/desktop-tests.log) · [Host](scenario-replay-v0.33/host-tests.log) |
| Renderer | Eight focused tests pass: light/dark, narrow, keyboard, empty, progress, Stop, recovery, historical evidence and no automatic replay | [Log](scenario-replay-v0.33/replay-renderer-tests.log) |
| Native capture error handling | 32 bridge tests pass; asynchronous capture failures retain their diagnostic without using an expired service accessor | [Log](scenario-replay-v0.33/capture-bridge-tests.log) |
| Maintained fixture | TypeScript and production build pass; development registration is absent from production JavaScript | [TypeScript](scenario-replay-v0.33/fixture-typecheck.log) · [Fixture](../fixtures/replay-web/README.md) |
| Packaged replay workflow | Seven cases pass: local success, HTTP 503, reset to idle, held loading, actual network failure, repeat after editing the fixture and explicit Stop | [Native report](scenario-replay-v0.33/native-replay-report.json) |
| Actual native captures | Light success at 1104×780 and dark/narrow error at 444×780; captures belong to their exact observations | [Success](scenario-replay-v0.33/capture-1.png) · [Error](scenario-replay-v0.33/capture-2.png) |
| Comparison and restart | Seven replay records, seven Not assessed observations and both image hashes restore exactly in another process. Runtime stays idle; zero provider requests | [Light](scenario-replay-v0.33/write-comparison-light.png) · [Dark](scenario-replay-v0.33/write-comparison-dark.png) · [Restored](scenario-replay-v0.33/restore-restored-comparison.png) |
| Installation | 28 checked payloads equal the signed candidate; deep/strict signature passes; normal-profile relaunch inspected | [Install](scenario-replay-v0.33/normal-install.json) · [Candidate](scenario-replay-v0.33/candidate-build.json) |
| Orbit preservation | Eight saved files and original 727-byte draft unchanged. ProfileForm preview in group 2, caret 19:8, source focus, layout, feature and Assistant context restored | [Baseline](scenario-replay-v0.33/normal-before.json) |

The native workflow uses the maintained nine-file React fixture and a disposable copy with one additional cooperative cancellation recipe. Button activation uses trusted renderer key events; select changes are explicitly recorded as synthetic. The native candidate was foregrounded through desktop control before each process. All 21 extension payloads and both fixture manifests were unchanged after acceptance. The normal Orbit project was excluded from fixture execution. Screenshots of the light/dark comparison, Stop state and installed normal workspace were inspected. This is automated maintained-fixture acceptance, not representative-user usability acceptance or physical input/display measurement.

## What the evidence establishes

- Recipes are authored by the application and registered only in its development build. Their names, fixture IDs, route and steps are immutable evidence for each replay. A catalog digest describes metadata; it is not proof of compiled source correspondence.
- Preparation resets the fixture, then declared callbacks run sequentially. Each dispatch waits for durable progress acknowledgment. The host accepts only the current project, observation, source membership, registration and runtime identity. Retries do not silently run a callback twice.
- One replay attempt belongs to one observation. Stop is cooperative, prevents further dispatch and discards late success. Earlier effects may remain. Timeout, lost execution certainty and stale registration require an explicit screen reload before replaying again.
- Requested application theme/motion inputs and actual viewport/media preferences remain separate. Actual dimensions allow one CSS pixel of native rounding. Recorded conditions describe the last completed callback. The fixture accepts app motion inputs but has no animation; this is not reduced-motion animation acceptance or operating-system preference emulation.
- Request observations contain real local success/503/network-failure evidence but remain unattributed interval observations. Idle and held loading are explicit authored fixture states. No backend behavior beyond the fixture is inferred.
- PNG captures are actual native pixels. Their relationship to saved source remains Unverified; application theme/data/animation capture fields remain Unknown. Recipe execution supplies adjacent evidence, not an automatic visual verdict. Replays and captures remain local and outside AI context.
- Restart restores historical records and interrupts unfinished work. It never automatically reconnects or executes a recipe. Storage retry reconciles metadata without dispatching app actions.

## Retained failures and remaining work

The initial full suite had one branding failure because it compared the new root version to the still-installed 0.32 app; the final suite targets the actual 0.33 candidate and passes. The assertion was retained. [Initial log](scenario-replay-v0.33/desktop-tests-initial.log).

Earlier native attempts failed at capture. One exposed the expired logging accessor, which was fixed in the native host and covered by a regression test. Another correctly refused a background window; a diagnostic retry also refused changed outer geometry. The capture guards remain intact. The fresh foregrounded seven-case workflow passes, and earlier reports remain explicitly recorded as failures in [the failure index](scenario-replay-v0.33/native-initial-failures/README.md).

**M3.03 remains in progress.** The next slice is an explicit, bounded matrix of recipe × size/theme/motion conditions. Full environment/data snapshotting, automatic visual scoring, isolated alternatives and SwiftUI/Expo replay remain open. Real paid-provider acceptance is separate. Laptop and physical keyboard/display acceptance remain **paused at the user's request**; no endurance run was repeated.

The previous app is recoverable at `desktop/.build/Foundation-0.32-before-0.33.app`. This increment did not publish a preview, deploy a site or apply changes to Orbit source.

[Replay workflow](../docs/scenario-replay.md) · [Running checklist](../docs/product-checklist.md) · [Machine-readable verification](verification-v0.33.json)
