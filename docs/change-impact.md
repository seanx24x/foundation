# Change impact

Foundation 0.36 adds an explicit source inspection step before a shared-token proposal. It reads saved project files locally; it does not call an AI provider, run a scenario, or change source.

## Workflow

1. Open Refine and build a saved-source preview. Select a CSS token and experiment with its value.
2. Choose **Inspect change impact**. The preview identifies the exact declaration and its scope, direct source consumers of its file, CSS references to that token name, and other declarations with the same name.
3. Expand **Scenarios to check** to see saved scenarios linked by feature membership. These are candidates for subsequent verification, not evidence that the change reaches those screens.
4. Choose **Review token change**. Review retains the inspected source revisions and scenario labels with the proposal. Subsequent selection or experiment changes cannot replace that checkpoint.
5. Compare the source diff, then Apply. The host rechecks the complete saved-source inventory and the edited file's native draft immediately before writing. A new, removed, ignored or changed file can invalidate the proposal.
6. Run the relevant scenarios separately to verify the implemented result. Undo restores only the exact applied target; unrelated saved edits and drafts are preserved.

Selecting a mapped element also exposes **Inspect source impact**. Its scope is the mapped source file. It does not establish a precise component declaration or offer an isolated rendered-instance edit.

## Evidence and limits

**From source** means a supported syntax relationship at a saved revision. Import, render, call, stylesheet, type and test references are distinguished. Only direct consumers are listed. A source test reference is not a coverage result.

A CSS `var()` reference establishes use of a name. It does not establish that the selected declaration wins the cascade. Inheritance, overrides, conditions, runtime styles, CSS-in-JS, preprocessors and escaped identifiers remain unknown. Other declarations with the same name stay visible.

Scenario and suite names come from saved feature, screen and scenario membership. They are historical labels after preparation. Inspection never starts their callbacks or supplies a visual/behavioral assessment.

Source readers retain the existing safety bounds: 1,500 indexed files, 8 MiB total source and 256 KiB per file. Results cap each evidence collection at 200 items, with up to 40 scenario rows. The inspector progressively discloses up to 80 entries per evidence kind. Empty lists and bounded results do not prove isolation. Files that cannot be read safely contribute no evidence. An incomplete inventory stays read-only: restore inaccessible files or open a smaller project and inspect again. Syntax/evidence limits remain explicit even when the complete inventory can be verified. Source changes require explicit reinspection.

Unsaved buffers are excluded. An unsaved edited target blocks preparing and applying its change. Supporting drafts are disclosed, relevant exact-source navigation is disabled, and unrelated drafts remain intact.

## Implementation

- `server/project/change-impact.mjs`: pure bounded source/CSS analysis and strict persisted checkpoint validation.
- `server/project/workspace.mjs`: safe saved-source inventory, full-manifest freshness checks and private save guards.
- `desktop/extension/src/extension.ts`: host-issued snapshot identity; trusted project, preview, selection and revision ownership; scenario membership; source navigation; fresh Apply guards.
- `desktop/extension/src/proposal-session.mjs`: frozen impact checkpoint, stale assessment, guarded Apply and target-only Undo.
- `desktop/extension/media/webview.js`: explicit inspection, stable experiment input and Review disclosure using existing Foundation design tokens.

The native workflow, restart and installed package are verified in [the 0.36 release evidence](../artifacts/verification-v0.36.md). Laptop and physical keyboard-to-display acceptance remain paused. Broader component editing, transitive impact, native adapters and full environment snapshots remain open.
