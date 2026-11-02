# AI-generated alternatives

Foundation 0.43 adds one explicit Build request for two named alternatives. Both use the same selected saved source and the same feature, web screen and scenario. M4.05 is verified and installed. See the [native and installation evidence](../artifacts/verification-v0.43.md).

## Workflow

1. Select a saved feature and two to eight application source files. Choose Build, enable **Explore alternatives**, select its saved scenario, and write the design brief.
2. Inspect exactly what will be shared, then choose **Generate alternatives**. The provider receives the brief, selected source and frozen scenario definitions. No screenshot, runtime observation, earlier answer, issue, decision or task brief is silently included.
3. Read both named proposals, their reasoning, files and suggested checks. Neither candidate is staged or applied automatically. The response must finish normally and be retained locally before Review becomes available.
4. Choose **Review candidate** to open its native source diff and stage its complete two-to-eight-file group. Each generated candidate receives one review checkpoint; its original artifact stays immutable. Open the retained diff to revisit it.
5. Prepare and run that candidate using the existing **Compare before applying** workflow. Explicitly discard the current proposed group before reviewing the second candidate. The two results are comparable only if their original baseline, frozen scope, recipe and requested conditions agree.
6. Compare the retained results, choose **Review this group**, inspect its diffs, then explicitly **Apply all** or discard. **Undo all** preserves unrelated source changes. An adopted alternative can be recorded as a project decision through the existing decision workflow.

## Scope and authority

Each generation has exactly two distinct names and different resulting source. Each candidate changes two to eight existing application files; selected source and each candidate side are bounded to 64 KiB. Configuration, manifests, generated files, dependencies and runtime instrumentation remain excluded. New files, deletion, arbitrary tools, automatic ranking and automatic application are outside this increment.

Candidate generation and review do not start a runtime or write project source. Generated review checkpoints support native diffs, discard, and retained comparison. Direct Apply, partial acceptance, refinement, version selection and isolated checks are unavailable until the retained comparison is reviewed through the established adoption path. Existing adopted-group limitations remain in force.

The original request, complete source snapshots, source hashes, full saved scenario definitions and both candidates are retained in conversation schema 11. Schemas 1–10 remain readable. Stage/Discard never rewrites the immutable candidate. Failed, cancelled, interrupted or malformed responses do not create an actionable candidate set. Duplicate or mixed artifacts are rejected.

Source, native drafts, project trust, active feature, scope definitions, conversation ownership and local durability are checked around asynchronous operations. A changed source or scope blocks later review without deleting the historical artifact. Restoring history or an unsent alternatives brief sends no request, stages no candidate, reads no image and starts no runtime.

Reasoning is labeled **AI interpretation**. Compilation remains **Not recorded**, visual assessment **Not assessed**, and source-to-pixels correspondence **Unverified** unless independently established. Deterministic local protocol fixtures verify integration, not remote model quality. Laptop and physical keyboard-to-display acceptance remain paused.
