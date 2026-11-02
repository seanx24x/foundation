# Foundation 0.11 — feature workspaces and editable task context

Verified 28 October 2026 (29 October UTC). This delivers the first M2 slice: a durable feature file set and explicit task context. The [running checklist](../docs/product-checklist.md) retains all 24 capabilities and later milestones.

## Delivery state

Foundation **0.11.0 is installed and running** at `desktop/.build/Foundation.app` in the normal Orbit profile. After the Mac was unlocked, Foundation was gracefully quit, refreshed and relaunched without saving or discarding the user’s source draft. All 20 extension payload files match canonical source and the tested candidate at `/private/tmp/foundation-011-candidate-8062ofvs/Foundation.app`; all eight recorded hashes and four host assets match. Pinned Code OSS provenance, startup patches and deep/strict ad-hoc signature verification passed. No Documents prompt appeared.

After installation and native inspection, all eight saved Orbit files and the original 727-byte unsaved backup still match the baseline. Automated tests used isolated workspaces/profiles; native acceptance added only local feature metadata for the bundled Orbit sample. Nothing was published to the private preview or elsewhere.

## What changed

- Understand can create/select feature workspaces with a title, brief, chosen files and primary source. Metadata persists locally with revision guards and reversible archive/restore.
- Suggestions distinguish actual direct imports/consumers from possible tests matched by filename. Suggestions are added only by explicit choice. Missing or excluded members remain visible until removed.
- Feature files load without opening editor tabs. The primary file supports native navigation. The selected running preview remains independent and is retained across unrelated feature updates.
- Use in Assistant prepares available saved files without dispatching a request. Include task brief separately controls title/brief sharing. Source files and runtime observations remain independent selections.
- Unsaved feature drafts survive state updates and feature switches. Clean forms adopt newer saved metadata; conflicting drafts require explicit recovery. Source editor drafts remain protected.
- OpenAI, Anthropic and compatible requests can include a bounded task snapshot. History preserves the original title, brief and metadata revision; future edits cannot rewrite prior context. The current question takes precedence over the brief.
- Feature/file/trust ownership is checked during asynchronous preflight and immediately before dispatch. Storage errors block unsafe continuation and offer retry.

See the [feature guide](../docs/feature-workspaces.md) and [provider/context guide](../docs/ai-provider.md). This is a source working set, not a complete feature graph or named runtime scenario. Ask / Propose change remain the current AI intents; isolated multi-file execution and inline assistance remain later M2 work.

## Corrected runtime selection

The stronger native check exposed a 0.10 defect: the host compared a 16-character saved-source revision with a full runtime SHA-256. The old smoke started at SaveButton, so its navigation assertion did not demonstrate a selection transition. That earlier claim has been corrected in the [0.10 report](verification-v0.10.md).

The host now compares the full saved-source content hash while retaining the native revision format for freshness/history. The new native test begins at App.tsx and requires focus to move to SaveButton.tsx with runtime/session/view provenance **before** invoking native editor navigation. It passes on the final signed 0.11 candidate.

## Executed verification

| Check | Result |
| --- | --- |
| Project regression suite | 89 passed, 0 failed |
| Full desktop suite against final candidate | 200 passed, 0 failed, 0 skipped |
| Extension TypeScript | Passed |
| Packaged native editor/Assistant smoke | 17 checks passed |
| Packaged connected runtime | 9 checks passed, including actual source-focus transition |
| Populated feature restart | 11 checks across two native processes passed |
| Conversation restart | Empty conversation identity/sidebar restored across two processes |
| Package/source equality | All 20 installed extension files match source and candidate; eight recorded hashes and four host assets also match |
| Signature after native execution | Ad-hoc deep/strict verification passed |
| Normal-profile native acceptance | Feature creation, context preparation, source navigation, canvas inspection, Assistant collapse/restore, Review empty state, Dark and transient Light preview passed |
| Saved Orbit and unsaved backup | Unchanged after installation and native inspection |
| Whitespace | `git diff --check` passed |

The feature restart check saves and restores the exact title, brief, five file memberships, primary file, selected feature and metadata revision. It verifies native primary-file navigation, Assistant preparation without any provider request, unchanged source bytes, and preservation of an unrelated unsaved fixture draft during feature operations.

The runtime test waits for the actual native iframe heartbeat before external Chromium performs interactions against the installed host-owned Vite target. Source selection, 200/503 observations, guarded token Apply/Undo and owned-process Stop pass. The normal-profile mouse/keyboard visual acceptance below is separate from these connected-runtime fixture checks.

Renderer tests cover light/dark themes, 390/700/1100px workspace widths and 170/300/384/480px Assistant widths. They exercise empty projects, staged membership, suggestions, archive/restore, failed saves, clean updates versus conflicting drafts, task inclusion/exclusion in actual messages, immutable historical context, keyboard focus and retained runtime frames. Expanded dark, compact light and Assistant light captures were inspected.

## Normal-profile native acceptance

CUA native input and screenshots verified the installed app in its existing 5120 × 2688 captured window. A local **Profile saving** feature now contains ProfileForm (primary), SaveButton and the profile API. Explicit suggestions added the latter two from source relationships. **Use in Assistant** selected the two saved files, left the unsaved SaveButton unchecked, explicitly included the brief, and focused the composer. No provider was configured or contacted. The far-right Assistant collapsed/restored with Option-Command-A without losing its prepared context. Clicking the primary file opened ProfileForm at line 1 in the native editor.

Refine compiled Orbit’s saved-source sandbox. Clicking the Save button in Inspect mode exposed its mapped SaveButton source and measured properties, while retaining the visible unsaved-exclusion and network-off labels. Review showed no active Foundation changes with separate Not run checks. Foundation Dark and the feature/Assistant surfaces in a transient Foundation Light theme preview were visually inspected; Escape restored the existing Dark preference. The Light capture includes the theme picker overlay. Narrow sizing and detailed keyboard/recovery matrices remain renderer-fixture evidence.

The user’s unsaved source remained open and byte-identical. Foundation is left running with the feature selected and its primary source beside the workspace. The recorded source/draft hashes were checked again after these interactions. Populated native history replay and live commercial providers were not exercised.

- [Installed-app evidence and scope](verification-v0.11-installed.json)
- [Native feature workspace — Dark](foundation-011-native-feature-dark.png)
- [Native feature/Assistant — transient Light preview](foundation-011-native-feature-light-preview.png)
- [Native mapped saved-source canvas — Dark](foundation-011-native-refine-dark.png)

- [Machine-readable evidence and asset hashes](verification-v0.11.json)
- [Native editor/Assistant report](verification-v0.11-native.json)
- [Hardened runtime report](verification-v0.11-runtime.json)
- [Populated feature restart report](verification-v0.11-features.json)
- [Conversation restart report](verification-v0.11-history.json)
- [Compact feature workspace — light renderer fixture](../desktop/tests/artifacts/features-workspace-compact-light.png)
- [Expanded feature workspace — dark renderer fixture](../desktop/tests/artifacts/features-workspace-dark.png)
- [Task context — light Assistant renderer fixture](../desktop/tests/artifacts/features-assistant-light.png)

## Remaining gates

No real commercial model was contacted or billed. Live OpenAI/Anthropic acceptance requires user-entered credentials and a bounded test budget. Physical input-to-paint and sustained-load performance are still unmeasured. Populated conversation/task-history persistence is covered by store/protocol/renderer tests; the existing two-process native conversation check covers an empty conversation, not populated visual replay.

Next M2 work: named feature runtime scenarios and richer relationships, then distinct Plan/Build/Review behaviors, isolated multi-file work, intent-based review and inline coding assistance. All remain explicit in the checklist.
