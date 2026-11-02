# Saved check plans — Foundation 0.20

A check plan keeps the next execution decision with a staged change group. Prepare the isolated workspace, choose an ordered set of supported checks and save the plan. Saving runs nothing. Run next check executes exactly one listed command in a fresh copy; Foundation stops at the next decision even when that command passes.

## Decisions

Each plan contains one or two distinct supported checks: Node tests and TypeScript check, when available in the prepared workspace. Their command descriptors come from the existing fixed recipes. The renderer cannot provide a command, executable, environment or working directory.

Run next check performs the next unattempted step. A failed, cancelled or interrupted attempt stays visible until Retry check or Skip check is chosen. Retry creates a new attempt and a fresh source copy. Skip records an explicit decision, never a passing result. End plan preserves its results and closes its remaining decisions without running anything. A completed plan with skipped checks is not reported as fully passed.

Stop targets the exact active attempt and terminates its owned process. Delayed controls from an earlier attempt cannot affect a later one. Each action checks the plan revision and next step; duplicate controls cannot silently execute two commands. Source Apply and Undo remain separate decisions.

## Source and result identity

The plan retains the group identity, lifecycle revision, immutable group digest and complete copied-source digest from preparation. Every attempt prepares a fresh copy and must match that full snapshot before executing. Changed supporting tests, configuration or copied dependencies block continuation, even when the group's edited files are unchanged. An earlier group version does not regain execution authority when restored.

The existing process boundary remains unchanged: network and writes outside the owned copy are blocked, while local file reads remain available. No shell, installation, arbitrary package scripts or automatically selected tools are added. Results describe the exact command and source snapshot. Compilation, interaction and visual outcomes remain separate. Command output remains local and is not automatically shared with AI.

## Restart and recovery

Plans persist each attempt's intent and its linked execution record before commands run. A restart reconciles the saved result or marks an unfinished attempt interrupted. It restores the next decision without running a project check or contacting a provider. A completed command can be recovered from its matching durable execution record, but cannot trigger the following step.

Storage errors block further execution and remain visible until Retry storage succeeds. Retry storage saves or reloads records; it never retries a command. Earlier failed, stopped and skipped decisions remain inspectable. Storage retains at most eight plans within 1 MiB, with at most thirteen attempts per plan and the existing thirteen-record execution-history limit. Preparation records also consume execution-history capacity. No earlier evidence is silently evicted. New plans require the current one to be completed or explicitly ended.

## Delivery boundary

This is the supported-check-plan portion of M2.09h.5. Broader agent/tool execution, model-selected tool decisions, arbitrary tool-process continuation and dependency-safe partial source acceptance remain separate gates. The [running checklist](product-checklist.md) records automated, native, visual and installed verification separately.

[0.20 verification](../artifacts/verification-v0.20.md) records automated tests, packaged checks across three processes, both native themes and the exact installed payload. Provider quality remains outside the loopback fixture evidence.
