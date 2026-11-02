# Reproducible issues

Foundation 0.42 connects a reported problem to one finished web scenario observation. M4.04 is verified and the build is installed. [Verification](../artifacts/verification-v0.42.md).

## Capture a problem

In Understand → Runtime → Observation history, choose **Capture issue** on a completed, cancelled or interrupted observation. Give the problem a short title and describe what happened. The record freezes the scenario’s named steps and expected outcome, the original run and its sanitized request completions, original source hashes, current saved-source hashes at capture, and any exact replay or screenshot metadata already attached to that observation.

A user report is not an automated diagnosis. A request observed during the interval is not proof that a step or component caused it. Compilation is not recorded; runtime-to-source correspondence remains unverified. Cancelled, interrupted, truncated and unassessed evidence stays labeled. A historical observation may be captured after its source changes; both source bases remain distinct. Current unsaved contributing files must be resolved before recording, and are never read into the issue.

## Review and share

Review → Issues keeps the report readable alongside its steps, source links and evidence. Source freshness, capture-time source freshness and availability of original run/replay/capture metadata are assessed independently. The immutable report remains readable when original evidence is no longer available. Viewing original evidence navigates to its observation; screenshot bytes are verified and loaded only on explicit request.

Assistant includes an issue only when selected in Request context. One issue can accompany an ordinary Ask, Plan, Build or Review request. Selecting an issue checks its exact source context; **Refresh issue context** checks a restored selection again. The exact issue and its current freshness assessment are disclosed and retained with the turn. Historical or missing source is explicitly labeled; a changed source relationship during dispatch rejects the request. Screenshots are represented by metadata and hashes, never PNG bytes. Current selected source is shared separately. No record starts a runtime, reruns a recipe, edits source, publishes an issue or sends a provider request automatically.

## Storage and recovery

Issues use a separate append-only local journal, scoped by project. Writes are revision-guarded and read back before acceptance; ownership changes during persistence roll back the attempted append. Retry only repairs journal persistence. Invalid storage stays untouched. The journal holds 32 issues and at most 4 MiB; each issue is bounded to 60 KiB and selected Assistant issue context to 64 KiB. Records are never silently evicted.

This increment covers maintained instrumented web observations. Automatic reproduction, backend traces, external issue trackers, screenshot transmission to models and native SwiftUI/Expo issue capture remain future work. Hardware acceptance remains paused at the user’s request.

## Verification

1,609 desktop tests and 383 project tests passed, along with both TypeScript checks. A signed native build captured one actual HTTP 503 response and PNG from the maintained error recipe, saved and reviewed the issue in both themes, viewed the exact original image, and sent one explicit issue-context Ask to a credential-free loopback provider fixture. Saved source changes produced Historical while the original issue and sent context stayed immutable. A second process restored the issue, selection, unsent composer and unrelated draft without runtime, provider or image activity. Normal-profile installation preserved Orbit’s saved source, unsaved draft and workspace layout.
