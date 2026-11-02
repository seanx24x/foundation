# Foundation 0.15 — AI workflows and interactive plans

**Installed and running in the normal Orbit profile.** M2.08a–f are verified within the bounded four-mode increment. Ask explains selected source; Plan produces an editable artifact; Build prepares one existing file; Review produces source-linked findings. The original AI plan, saved local revisions and selected-step handoff survive restart. All 20 installed payload files match the tested candidate and built source; the ad-hoc deep/strict signature passes.

## Results

- **149 project tests and 371 desktop tests pass**, without failures or skips. Both TypeScript checks and whitespace validation pass.
- Included: 92 provider/parser/proposal checks across OpenAI, Anthropic and compatible mock transports; 23 AI-mode host tests; 15 Assistant protocol tests; 41 conversation-store tests; 22 proposal-session tests; 20 artifact-model tests; and 11 focused AI renderer checks. These overlap the full-suite totals.
- The packaged four-mode workflow uses a local mock provider with empty credential profiles: exactly four requests, then none on restart. Actual native controls edit the plan, exclude a step, check source, navigate a reference, prepare one file without sending, explicitly send Build, and inspect Review. Two normal native processes restore the artifacts, revision history, saved-source hashes and unrelated unsaved draft.
- All 17 native editor checks pass, including source navigation, terminals, compilation and guarded Apply/Undo. Ordinary startup leaves provider requests at zero and platform authentication dormant.
- The separate two-process restart regression retains editor groups, exact tab order, reversed text selection, dirty text, Refine mode, unfinished Build prompt and explicit source/task choices.
- Renderer checks cover light/dark, keyboard control and 170–560px panels. Final geometry assertions keep the Excluded label unbroken and the title usable at 170/280/300/384px in both cards and dialogs.

The final review fixed a real persistence race: a streamed Build proposal now waits for its preceding text delta to save before validating the durable parent plan. Native harness fixes wait for disclosure visibility after rerenders and compare the optional false stopping flag canonically; they do not inject product state or relax artifact/source equality. Final packaging includes the native-inspection wording and narrow-label corrections. Editor and workspace restart checks use the same host/model implementation; the four-mode native workflow was rerun after the final text/CSS polish.

## Native acceptance and preservation

The populated fixture was reopened with its mock provider disconnected and test harness disabled. The native plan's current revision and immutable original AI plan were inspected; Check source restored fresh local evidence. Review was inspected in Foundation Dark and Light and explicitly reports that build, interaction and visual checks have not run. Dark was restored. Final plan wrapping was rechecked after packaging.

The normal app was quit gracefully, refreshed and relaunched. Its native workspace/groups, Profile saving feature and original unsaved SaveButton remain. Assistant exposes all four modes while disconnected; source and task inclusion remain explicitly empty. No provider credentials were configured and no request was sent from Orbit.

All eight saved Orbit files and the original 727-byte unsaved backup match their pre-work hashes. No source was saved or discarded. Captures remain local; nothing was published to Tailscale.

## Evidence and limits

- [Machine-readable verification](verification-v0.15.json)
- [Native AI workflow and populated restart](ai-modes-native-v0.15.json)
- [Native workspace restart](restart-native-v0.15.json)
- [Native editor checks](editor-native-v0.15.json)
- [Workflow contract](../docs/ai-workflows.md)
- [Running checklist](../docs/product-checklist.md)

Build retains explicit one-file Apply/Undo. A plan's full original source basis remains a local guard even when only one file is shared with Build. Changed or dirty contributing source blocks dispatch/publication/Apply; Undo remains target-only. Review analyzes selected saved source and does not establish runtime behavior, test coverage or a passing check. Mock-provider acceptance does not establish live model quality. Live OpenAI/Anthropic acceptance, multi-file isolation, inline assistance, physical latency under load, scalable history, populated task/runtime-history visual replay, distribution and native platform gates remain open. The broad parent capabilities and M2 as a whole remain in progress.
