# Foundation 0.36 — change-impact preview

M3.04 is verified and installed within the saved-source scope described here. Refine now explicitly inspects mapped source files and exact shared-token declarations. It distinguishes direct source consumers, CSS name references, alternative declarations and related saved scenarios before preparing a token edit. Review retains an immutable impact checkpoint with its source revisions. Changed inventory blocks preparation or Apply; Undo protects only the exact applied target.

## Verification

| Check | Result |
| --- | --- |
| Project and desktop TypeScript | Passed |
| Project tests | 337 passed, 0 failed |
| Full desktop suite | 1,310 passed, 0 failed, 0 skipped |
| Focused impact analyzer/service | 14 tests: strict contracts, direct consumers, CSS scope/reference coordinates, bounds, cancellation, full-inventory freshness, safe write guards, source-map exclusion and BOM handling |
| Impact host | 21 tests: ownership, latest-wins publication, exact source navigation, incomplete basis, metadata, draft and write-boundary races |
| Proposal session | 27 tests, including immutable impact, malformed restoration, changed/new inventory, failing validation and target-only Undo |
| Renderer | Seven impact tests plus existing webview integration; light/dark and compact geometry, keyboard disclosures, empty/loading/error/incomplete/stale/dirty states and exact input/caret continuity |
| Packaged native workflow | Passed actual mapped canvas selection, token analysis, source navigation, frozen Review, Apply/Undo and changed-consumer guards |
| Second-process restoration | Same proposed impact checkpoint and unsaved fixture draft; runtime idle and zero provider requests |
| Installed package | 32 checked payloads match the signed tested candidate; deep/strict signature passed |
| Normal Orbit | Eight saved files and original 727-byte unsaved backup unchanged; native layout, caret and Assistant context visibly checked |

[Native report](change-impact-v0.36/native-report.json) · [Machine-readable verification](verification-v0.36.json) · [Installation](change-impact-v0.36/normal-install.json) · [Workflow](../docs/change-impact.md) · [Desktop tests](change-impact-v0.36/desktop-tests-final.log) · [Project tests](change-impact-v0.36/project-tests-final.log).

## Native acceptance

The passing run used `/private/tmp/foundation-036-candidate-ZMWfqa/Foundation.app` and the disposable profile at `/private/tmp/foundation-change-impact-smoke-zjdgT1`. Signature, executable hash, loaded extension path and all 25 extension payloads were bound to the run. The four-file React/CSS fixture explicitly declares `data-foundation-source` on its Save button, as required by the existing sandbox mapping contract. The fixture does not install React type declarations; its four editor diagnostics are separate from the verified sandbox compilation and interaction. No full fixture typecheck is claimed.

Actual native controls established source-file scope for the selected button and declaration scope for `--button-radius`. The token evidence showed a stylesheet import and a CSS name reference, alongside the saved “Recover after a failed save” scenario. The source link opened its exact native coordinate. A supporting unsaved SaveButton draft stayed untouched; the token input, raw value, selection and focus survived a host publication.

Review froze the result and scenario labels. Apply changed the selected declaration from 8px to 12px; Undo restored the exact original CSS. Added, removed and changed consumers made preflight stale; an added consumer also blocked a prepared proposal. A fresh 16px proposal restored in a different native process with identical impact evidence and original unsaved draft text. No runtime scenario was executed and no AI request was sent.

Buttons and disclosures used trusted CDP keyboard events on actual controls, with event-target evidence. Text entry used CDP insertText with explicitly programmatic focus/selection. Tests did not inject host messages or application handlers. Physical keyboard/display measurement and human usability acceptance remain separate.

Native [dark Review](change-impact-v0.36/write-impact-dark.png), [light Review](change-impact-v0.36/write-impact-light.png) and [restored Review](change-impact-v0.36/restore-restored-impact.png) were captured; dark/light layouts were visually inspected. Compact inspector screenshots and geometry checks are retained beside them.

## Corrections and retained attempts

Implementation review fixed supporting-draft overblocking, incomplete-inventory authorization, mutable project ownership during deferred writes and repeated historical-run work in analysis guards. CSS parsing explicitly disables previous source-map loading; ordinary saved-source readers remain the only project-file authority. PostCSS, NanoID, Picocolors and SourceMapJS licenses are bundled and byte-verified.

Two earlier native attempts remain failed diagnostic evidence:

- `yyTibr`: nested `about:srcdoc` target discovery and missing explicit fixture mapping. The rendered preview remained usable; corrected the test target inventory and disposable fixture instrumentation.
- `NuMOdZ`: the host had become stale, but the test read the renderer before its queued publication. Native inspection confirmed the disabled control and preserved experiment. The harness now waits for the renderer's exact status and proposal identity.

The final `zjdgT1` workflow and second-process restore passed. Scoped process cleanup completed; no candidate processes remain. These failed attempts are retained separately and are not counted as acceptance passes.

## Installation and boundaries

Installed 0.36 preserves the latest normal Orbit view: `profile.ts` preview at 9:1, the unsaved SaveButton tab, expanded Explorer, hidden bottom panel and far-right Assistant. Request context remains expanded, the task brief is included, only SaveButton is selected, Ask mode is active and the composer is empty. The Foundation workspace panel stays closed, as it was before replacement. Explorer focus was restored explicitly after launch. The 0.35 rollback bundle remains available locally.

Scope is direct saved-source analysis. CSS names do not resolve cascade or rendered impact; component mapping is source-file level, not precise instance isolation. Related scenarios are feature memberships, not exercised coverage. Incomplete inventories stay read-only. Runtime outcome, compilation and visual assessment remain separate. No live-provider, native-adapter, transitive-impact, full environment-snapshot or broad performance acceptance is claimed.

The [running checklist](../docs/product-checklist.md) marks M3.04 verified within this scope. Next is M3.05: connect explicitly chosen scenario verification to the applied visual change and its saved source revision. Parent capabilities remain in progress. Laptop and physical display acceptance remain paused at the user's request.
