# Foundation 0.23 — investigation checkpoints

**Installed and running in the normal Orbit profile.** A completed source-investigation answer can now lead to an explicit, bounded sequence: Continue investigation, inspect the context, Ask next step, Run investigation, inspect the local result, then Share result. The model can select one advertised source target or finish. Nothing resumes automatically after restart.

## Verification

- **232 project tests and 771 desktop tests pass**, with zero failures or skips. Both TypeScript targets, JavaScript syntax and whitespace checks pass.
- A chain has three model attempts and two local-analysis attempts, excluding the seed Ask. Reservations are saved before dispatch. Failed, stopped, interrupted and uncertain-storage attempts retain their consumed slots. Duplicate actions, wrong owners, stale decisions, forged targets, source changes and late results cannot bypass these limits. Retrying storage starts no work.
- OpenAI, Anthropic and compatible text protocols pass against local fixtures. The provider receives the exact disclosed original question, one preceding complete explanation, saved-source result, bounded target catalog and budget, alongside the selected anchor source. The whole conversation, partial output, full inventory, environment and unsaved drafts are excluded. Related source becomes a selected anchor only after the explicit local investigation and sharing sequence. Provider-native tools remain disabled.
- The new packaged workflow passes in three distinct app processes with exactly four explicit loopback provider calls: one seed Ask and three decisions. Two separately requested local investigations advance from the button to the API and transport source. Unshared results and typed questions restore without provider or tool work. The third decision has no remaining target and finishes. Fixture source and its unrelated draft are unchanged.
- Ten existing packaged workflows pass: source investigation, Relationships, restart, 17 editor checks, request revision, staged-group refinement, check recommendations, saved check plans, isolated execution and grouped Apply/Undo. These verify compatibility with conversation schema8; legacy envelopes remain readable without rewriting on load.

## Native and visual acceptance

The populated continuation fixture was reopened with its harness disabled and AI disconnected. Checkpoints, local result evidence and Finish were inspected natively in Foundation Dark and Light. Renderer checks also cover short 500/700px panes, keyboard controls, ownership changes, stale and interrupted decisions, and narrow widths. The continuation composer uses **Ask next step** and **Saved source · Plan**, preserving its inner padding at 296px and 170px.

Review found an affected-draft race during local source validation; both pre-analysis and final-result boundaries now recheck drafts. Native testing then exposed a first-request crash: an optimistic investigated Ask in an empty conversation dereferenced a missing busy record before posting to the host. Three preliminary fixtures made no provider calls. Trusted input diagnostics and a failing renderer reproduction established the cause; the explicit null guard and a new first-Ask regression fix it. The final complete desktop suite passes. The continuation and staged-group refinement workflows were rerun after removing a redundant normal-Finish warning; the other nine workflows passed before that presentation-only refinement. A staged-group Undo fixture also timed out before this final rerun. Its older two-session Space driver did not record activation, so that timeout alone establishes no product cause. The updated test driver verifies and records a single trusted Enter/click; no production Undo logic changed.

The normal app was quit gracefully, refreshed and relaunched. All 20 extension payloads match the tested candidate and built source; its ad-hoc deep/strict signature passes. Eight saved Orbit files and the original 727-byte unsaved backup match the baseline. The dirty SaveButton tab, Understand/source split, Profile saving feature, source caret and far-right Assistant remain restored. No Orbit source was saved or discarded. AI remains disconnected and no preview was published.

## Evidence and remaining scope

- [Machine-readable verification](verification-v0.23.json), [three-process workflow](investigation-continuation-native-v0.23.json)
- [Native Dark](native-investigation-continuation-dark-v0.23.png), [native Light](native-investigation-continuation-light-v0.23.png), [installed Orbit](installed-orbit-v0.23.png)
- [Renderer Dark](investigation-checkpoint-dark-v0.23.png), [renderer Light](investigation-checkpoint-light-v0.23.png)
- [Workflow contract](../docs/investigation-continuation.md), [running checklist](../docs/product-checklist.md)

M2.09h.5g.3 and its acceptance gates are verified for this explicit saved-source continuation workflow. Loopback fixtures prove integration behavior, not live-model answer quality. Broader agent tools, dependency-safe partial acceptance, inline assistance, sustained-load performance and the remaining product milestones stay open.
