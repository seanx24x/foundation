# AI-recommended check plans — Foundation 0.21

Foundation can ask the configured model to recommend which supported checks are useful for a staged change. The recommendation is advisory: its reasons are AI interpretation, and its checks have not run. Saving a recommendation creates a normal check plan; running any check remains a separate decision.

## Flow and sharing

Prepare the isolated workspace, then choose Suggest checks from the staged group. Review the prepared Plan request and edit its instruction. Preparation does not contact the provider. Send shares the complete original source basis with the staged edits overlaid, plus the available fixed check names and IDs. The disclosure shows the actual staged source.

The provider receives no command strings, discovered test filenames, full project manifest, environment, previous tool output or unrelated conversation history. Task and runtime context are excluded from this specialized request. Existing OpenAI, Anthropic and compatible text protocols remain in use; provider-native function calls remain disabled.

A normally completed response may recommend up to two distinct advertised checks, in order, with reasons and limitations. It may recommend none when the available checks are not useful. Unknown task IDs, extra command fields and incomplete responses cannot authorize a plan. Foundation assigns the artifact identity and binds it to the exact staged group, source snapshot, catalog and conversation.

## Decisions and recovery

Review the rationale, edit the selected checks or their order, then Save check plan. The plan stores the immutable recommendation's identity and digest, alongside the accepted ordered selection. Its journal is the adoption commit point. A repeated Save cannot create another plan or replace the accepted selection. Dismiss preserves the suggestion as history; it does not skip any running check.

Local drafts and saved recommendations restore without provider calls or project checks. After restart, explicitly prepare a fresh workspace. The group, full copied-source digest and advertised check catalog must still match before Send or Save. Source drafts, ownership changes, an active plan and uncertain storage expose a clear blocker instead of silently retargeting the decision.

Saved plans retain Run next, Retry, Skip, Stop and End. Their actual command results remain separate from AI rationale and from interaction or visual verification. Tool output is not automatically shared back with the model.

## Delivery boundary

This is M2.09h.5g.1, the first model-selected check decision. Source-investigation tools, explicit result sharing, model/tool continuation, arbitrary shell commands and dependency-safe partial acceptance remain distinct work. Validation and installation are tracked in the [running checklist](product-checklist.md).

[0.21 verification](../artifacts/verification-v0.21.md) separates automated checks, three-process packaged acceptance, native visual review and installed-payload preservation from live-provider quality.
