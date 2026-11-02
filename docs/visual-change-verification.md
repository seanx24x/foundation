# Visual-change verification

Foundation 0.37 connects a reviewed visual token change to observations you explicitly choose. The link preserves which saved source, scenario, interaction record and optional capture were used. It does not execute a scenario or turn attached evidence into a passing verdict.

## Workflow

1. In a connected running project, choose a saved screen and scenario. Begin an observation, perform the interaction, then finish it or use **Capture and finish** to retain its actual rendered state.
2. In the saved-source sandbox, inspect a shared token’s source impact, experiment, review the proposed source change and apply it.
3. Return to the running project and record the chosen scenario against the changed source. Capture the result if a visual comparison is useful.
4. In **Review → Verification**, explicitly choose the scenario, before observation and after observation. **Link evidence** saves that exact pair.
5. Expand the saved verification row and choose **Compare observations** to open the existing paired observation and capture viewer. **View scenario** changes the selected context without starting the project or executing an interaction.

The changed file must belong to the recorded feature source set. Its complete saved SHA-256 must match the proposal’s before or after text respectively. An unsaved target at recording time is ineligible. A new link requires the current proposal to be applied and its target still saved at the exact applied revision. The interface does not silently select the newest run.

## Outcomes stay separate

- **Source association** identifies exact saved target contents. Current relevance can become changed, dirty or unavailable.
- **Observation outcome** retains completed, cancelled or interrupted status. Completion means recording ended; it does not mean expected behavior passed.
- **Manual assessment** retains the user’s recorded matched, not-matched or not-assessed outcome.
- **Replay outcome**, when present, describes the exact recorded callback execution.
- **Capture availability** refers to the exact saved capture. The comparison viewer checks the PNG bytes before display.
- **Compilation: Not recorded** makes the boundary explicit for this attachment. A sandbox preview or successful request does not certify the project’s build.
- **Source-to-runtime relationship: Unverified** remains visible. A matching saved file hash alone cannot prove which source produced the captured pixels.

Recorded definitions, supporting sources and capture conditions may differ. Those differences remain visible in the canonical comparison. Data, application theme and animation state remain unknown where the runtime did not measure them. There is no automatic visual score.

## Durable history and recovery

Links retain the proposal basis, frozen feature/screen/scenario identity, exact observation IDs and canonical digests, plus optional capture and replay references. Capture and replay references require the complete observation context, including source set, dirty paths, runtime identity, definition revision and start time.

Undoing a change or replacing the current proposal keeps earlier links. Missing or replaced records remain unavailable; another observation, capture or replay never substitutes for the saved reference. Existing history can be inspected while a different proposal is active.

The version-one project journal stores up to 40 linked pairs, up to eight per proposal and up to 1 MiB. It rejects duplicates and capacity overflow without silently deleting history. Storage failures preserve the previous committed journal and expose retry. New links are guarded by the displayed journal revision, proposal basis, trusted project ownership and committed evidence versions.

All actions are local. Linking and navigating evidence do not contact an AI provider, publish anything, alter source, open a running screen, start a replay or take a capture. Apply and target-only Undo retain their existing source guards.

## Validation boundary

Implementation and acceptance are tracked separately in [the running checklist](product-checklist.md). Native workflow evidence, source checks, screenshots, installation binding and remaining limitations belong in the release verification artifact. Physical keyboard-to-display and laptop acceptance remain paused at the user’s request.
