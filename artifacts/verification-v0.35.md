# Foundation 0.35 — named state suites

M3.03e is verified and installed. Refine saves named suites of explicitly chosen states and app-authored recipes, with shared width, app-theme and motion inputs. Save is separate from Run. Each execution freezes the definition, reserves every cell before application work and retains independent observation, replay and optional image evidence. Later edits preserve the original history.

## Verification

| Check | Result |
| --- | --- |
| Desktop TypeScript | Passed |
| Full desktop suite | 1,276 passed, 0 failed, 0 skipped |
| Focused stores | 52 passed: strict definitions, v1/v2 compatibility, bounded products, failure/retry, interruption and exact evidence links |
| Matrix/suite host | 38 passed: frozen recipes and definitions, drift, capacity, Stop, later-state recovery and legacy-key preservation |
| Suite renderer | 7 passed: explicit save/run, drafts, unavailable recipes, update/copy identity, immutable history, full recipe bindings, light/dark compact coverage and Stop |
| Existing matrix renderer | 9 passed, including stable capture geometry and exact preview acknowledgement |
| Packaged native workflow | Three suites and one single-recipe matrix passed |
| Native restart | Exact definitions, observations, replays, captures and selected comparison restored in a different process; runtime idle |
| Installation | 28 checked payloads match the tested candidate; deep/strict signature passed |
| Orbit preservation | Eight saved files and original 727-byte unsaved backup unchanged; layout, caret and Assistant context visibly checked |

[Full native report](state-suites-v0.35/native-report.json) · [Machine-readable verification](verification-v0.35.json) · [Installation](state-suites-v0.35/normal-install.json) · [Test log](state-suites-v0.35/desktop-tests.log).

## Native evidence

The final passing run used the signed isolated candidate `/private/tmp/foundation-035-candidate-enx0j4/Foundation.app` and disposable profile `/private/tmp/foundation-state-suite-smoke-ji6rQD`. The maintained React/Vite fixture was copied without changing its five app-authored callbacks. Cancellation and deliberate failure recipes were added only to that copy. The native renderer exercised visible Save, Update, Run, Stop and history controls; no host messages or application handlers were injected to perform suite actions. Selects and text fields used explicitly synthetic control-level operations; buttons/disclosures used trusted keyboard events. Physical hardware acceptance remains separate.

- **Profile states:** five explicit labels × two application themes = ten completed cells and ten actual PNGs. Idle/loading have no request invented for them; success, server-error and network-error states retain their actual independent HTTP outcomes. Every observation remains Not assessed.
- **Update:** the saved definition was renamed and revisioned. Its original execution remained exactly unchanged.
- **Stop:** the current callback was cancelled and the later state remained Not run. The test verifies a single trusted activation of the current Stop control and the exact execution's terminal state.
- **Failure:** the first callback failed; the later state remained Not run. Explicit Open screen established a fresh connected document before subsequent work.
- **Single-recipe regression:** the original matrix workflow completed one condition beside suite history.
- **Restart:** three definitions, four execution records, thirteen observations/replays, ten hash-verified PNGs and the success/error comparison restored exactly. Twelve suite cells used distinct runtime documents; the separate matrix added its own observation. Runtime remained idle, AI disconnected and provider requests zero.

The original PNGs are retained under [captures](state-suites-v0.35/captures). Coverage, stopped-state history and native comparison were visually inspected. [Dark coverage](state-suites-v0.35/write-five-state-coverage.png) · [Stopped suite](state-suites-v0.35/write-stopped-suite.png) · [Light comparison](state-suites-v0.35/write-comparison-light.png). Renderer checks also inspected compact light/dark history.

## Corrected findings and retained attempts

Implementation review corrected recipe comparisons that depended on property insertion order, a corrupt-null v2 fallback, Save as new acknowledgement that could select an existing identical definition, and a history join that checked only recipe ID/digest rather than all frozen metadata. Focused regressions cover each correction.

The first full test run had one harness failure: it toggled an already-open Last suite disclosure closed before trying to open its child. The corrected full run passes all 1,276 tests. The original [test log](state-suites-v0.35/desktop-tests-first.log) remains retained.

Earlier native attempts remain failures, not acceptance evidence:

| Attempt | Finding / correction |
| --- | --- |
| `gkMzFQ` | History helper could select the retained Last suite disclosure; scoped the query to saved-suite history. |
| `dFq17m` | A live publication replaced Stop between focus and keypress. The test incorrectly required the original DOM object; it now records the exact current selector match at event time and separately waits for cancellation. No dispatched action is retried. |
| `WYDl3D` | Aborted before native input to correct the event instrumentation. |
| `RiMJbu` | Helper returned no keys before lazy history mounted. It now waits for the requested disclosure before one activation. |

The final `ji6rQD` workflow and second-process restore passed. Reports and activation records from earlier attempts remain in the artifact folder. Four test-owned Vite processes left by held failures were identified by exact candidate/fixture arguments and stopped. No disposable candidate processes remain. The installed app and original Orbit session were never used as the test fixture.

## Storage and boundaries

Definitions are bounded to twenty in 512 KiB. State/condition products are bounded to twelve; the existing forty-record matrix, observation, replay and capture limits still apply. Saving or recovery never executes an app action. Version-two execution history lives under a new key; validated v1 history is available without overwriting its original key. Explicit corrupt v2 content is unavailable rather than hidden behind legacy fallback. Rollback 0.34 does not see v2-only runs, and older-build changes are not automatically merged into an existing v2 journal.

State labels are user intent. Completed callbacks are not an automated visual or behavioral pass. Saved-source-to-pixel correspondence remains Unverified, and capture theme/data/animation fields remain Unknown where instrumentation cannot establish them. Fresh documents do not reset persistent browser or external backend data. App theme/motion inputs are not OS preference emulation. No live provider, full environment snapshot, isolated alternative, SwiftUI/Expo suite, broad performance or human usability acceptance is claimed.

The installed 0.35 app preserves ProfileForm preview in editor group two at 59:1, the unsaved SaveButton tab, Understand/Relationships, Profile saving, Explorer, hidden bottom panel and far-right Assistant. Request context stays expanded with the task brief included and only SaveButton selected; Ask mode and the empty composer remain. Explorer focus was restored explicitly after launch. AI stays unconfigured. The 0.34 rollback bundle is retained locally.

The [running checklist](../docs/product-checklist.md) records M3.03e as verified and M3.04 change-impact preview as next. Parent capabilities remain in progress. Laptop and physical input/display measurement remain paused at the user's request; no endurance run was repeated.
