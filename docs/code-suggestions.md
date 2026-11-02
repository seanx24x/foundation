# Code suggestions — Foundation 0.26

Foundation offers native ghost-text completions and nearby edit suggestions using the configured AI provider. Run **Foundation: Start Code Suggestions** from the command palette. Its disclosure names the destination and model, explains the source context and API-request limit, and requires **Start suggestions**. Opening source, cancelling the disclosure or restarting the app sends nothing. **Pause Code Suggestions** stops the session immediately.

## Context and request boundaries

While enabled, ordinary source edits can request a suggestion after a quiet period. Moving the caret alone does not send another request. **Request Code Suggestion** explicitly requests at the current caret within the enabled session. Standard suggestion-widget selections, multiple carets, nonempty selections, unsupported or untrusted files, files over 256 KiB and an active selection-edit workflow do not request suggestions.

Each request contains only `prefix`, `suffix` and `languageId`: up to 20 lines before and 10 lines after the caret, with each side capped at 6 KiB. This can include unsaved text. Paths, other files, Assistant history and runtime evidence stay local. Context is sliced at complete Unicode code points. Source comments and strings are treated as data. No tools are available to the provider. Each request times out within 10 seconds; 20 requests per minute pauses the session with an explanation. Pausing and immediately restarting does not reset that rolling limit.

## Native completion

Validated insertion text appears through the stable Code OSS inline-completion API. **Tab** accepts and **Escape** dismisses. Native word/line acceptance and Undo remain editor operations. The extension checks document identity/version, full buffer, caret, project and configuration before publishing; the native editor then owns visible completion prefix matching and acceptance. Its post-insertion command records acceptance only—it is not a pre-insertion guard.

Completion is insert-only at the current caret, bounded to 4 KiB. There are no snippets, commands or arbitrary file edits in model output. A new request supersedes the previous request, and cancellation suppresses late results. Neither model output nor native acceptance is proof that the code compiles or behaves correctly.

## Nearby edit

AI can instead suggest one nearby replacement, anchored to one exact unique source match wholly before or after the caret in the shared window. Both original and replacement fit 4 KiB and 12 lines. An unavailable, repeated or crossing anchor is rejected. The **Next edit** status action and **⌥⌘N** open a read-only native diff; they never automatically move source or apply changes. **⌥⌘Enter** accepts the reviewed edit; **Escape** dismisses and returns to the initiating caret.

Nearby edits reuse the exact-document/version/text/project guards of [selection editing](inline-selection-editing.md). Accept is one native edit with an Undo boundary; the extension does not call Save. Existing auto-save settings still apply. Earlier unsaved drafts and unrelated documents remain intact. A source edit, owner/configuration change, close or cancellation invalidates pending edits. Edit followed by Undo cannot revive a stale proposal.

## Evidence and limits

The controller records bounded, session-local request counts and provider/request-to-return timings. The stable provider API has no shown callback; returned suggestions are counted as published, never assumed visible. Packaged acceptance separately measures request-to-observed ghost text. Neither timing includes physical key dispatch or compositor paint, and local fixtures do not establish production-provider latency or quality.

This increment stays within the active source file and session. Broader repository context, cross-file next edits, proposed native next-edit rendering, durable inline history and sustained-load performance remain open. Foundation 0.26 is installed and verified: 305 project tests, 873 desktop tests and four packaged workflows pass. Native Dark/Light and normal Orbit restoration were inspected. [Verification](../artifacts/verification-v0.26.md). See the [running checklist](product-checklist.md).
