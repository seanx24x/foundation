# Named state suites

A state suite saves an explicit set of app-authored recipes for one feature, screen and scenario. Each recipe has a user-chosen label: Idle, Loading, Success, Error or Offline. These labels describe what the user intends to inspect; they are not inferred application state or verification results.

## Save, run and review

In Refine, open the screen and wait for its connected recipe catalog. Choose **New suite**, name it, and pair each state with a recipe. Choose shared widths, app themes, app motion inputs and optional captures. The editor shows the number of states, conditions and total runs. Save the definition, then explicitly choose **Run suite**.

A suite contains one to five distinct states and distinct recipes, on the same route. Shared conditions use 390, 768 or 960 CSS-pixel widths; Light or Dark app theme; and Follow system or Reduced app motion. The height is 680 CSS pixels. The complete state × condition product must fit within twelve runs. The same condition set runs for every state, in the saved state order.

Saving never runs the app. **Edit suite** and **Update suite** change its reusable definition; **Save as new** makes another definition. A run freezes the suite's name, revision, ordered state/recipe pairs, feature, screen, scenario and source hashes. Later edits cannot rewrite that history. Unsaved editor changes must be saved before running. Missing or changed recipes remain visible and require an explicit revision; Foundation does not substitute another recipe.

Each executed cell gets a fresh runtime document, its own observation and replay, and an optional PNG. The suite shares the established [matrix runner](condition-matrices.md), including its persistent Stop control and stable preview fitting. On completion, the prior preview settings return.

In Understand, expand **Runtime → State suites** to review per-state condition coverage and each cell's evidence. Use individual observations as a baseline and comparison. Callback completion, actual requests, image availability and manual assessment remain separate; no suite receives an automatic visual or behavioral pass.

## Evidence and recovery

The saved recipe definition retains its metadata and catalog digest, but not a disposable document registration. Run binds it to the current registration and validates every selected recipe after each fresh document. A changed catalog stops work. Matching metadata does not prove deterministic behavior or correspondence between saved source and rendered pixels.

Source-to-pixel correspondence remains Unverified. Every observation begins Not assessed. Captures retain independently measured geometry and unknown fields where the adapter cannot establish a condition. A state named Offline does not assert that the operating system is offline. App theme and motion settings require cooperative app callbacks; they do not change operating-system preferences.

Stop, callback failure, source/context changes and uncertain evidence stop the suite at the current cell. Later cells stay **Not run**. Existing callback effects may remain. After cancellation or failure, **Open screen** explicitly establishes a fresh document before another run. A fresh document does not reset cookies, storage, service workers or remote data.

Restart never resumes work. Active history becomes interrupted, with untouched future reservations. Retry saves pending definitions or reconciles exact evidence links; it never reruns callbacks, creates replacement observations or captures another image. Failure reasons remain part of the original record after recovery. Corrupt, conflicting or full storage is preserved without silent deletion.

## Storage and compatibility

Definitions are local to the project: at most twenty definitions in a 512 KiB manifest. Execution history shares the matrix limit of forty records and 2 MiB. Observation, replay and capture limits also apply. Admission checks reserve capacity for the entire suite before application work begins.

Foundation 0.35 uses a version-two matrix storage key. Existing version-one history is strictly validated and available without rewriting the old key; its first subsequent mutation is saved to the new key. A corrupt new journal is not hidden by falling back to old history. The 0.34 app can still read its original history on rollback, but does not see runs created by 0.35. Once version-two history exists, later work made in an older build is not automatically merged.

This increment covers the connected React/Vite workflow. Full data/environment snapshots, automatic scoring, isolated alternatives and native platform adapters remain open. Laptop and physical keyboard-to-display acceptance remains paused at the user's request.

Foundation 0.35 is verified and installed: 1,276 desktop tests, TypeScript, three native suites, the single-recipe workflow, thirteen observations/replays, ten actual PNGs and exact second-process restoration pass. Orbit source, draft and context remain preserved. [Verification](../artifacts/verification-v0.35.md) · [Running checklist](product-checklist.md).
