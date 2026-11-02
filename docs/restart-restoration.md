# Restart continuity — Foundation 0.13

Foundation resumes its native workspace and an unfinished Assistant request. This increment closes M2.11; it does not resume AI execution or reconnect a runtime automatically.

## Native layout

Code OSS remains the owner of native groups, tabs, focus, source selections, unsaved buffers and sidebar geometry. Foundation registers its workspace serializer synchronously during activation and adopts the restored panel in place. It restores Understand, Refine or Review from that panel's bounded state without revealing another editor.

Some hidden tabs revive lazily. Startup checks the native tab inventory before creating anything, including tabs that have not called the serializer yet. An explicit activity command reveals that existing tab and applies the requested activity. Concurrent commands, closing the tab and shutdown invalidate obsolete work.

On the first visit, the default workspace opens in group one with focus preservation requested at creation. Subsequent visits use native tab state. A workspace explicitly closed by the user stays closed until a Foundation command opens it. `foundation.openOnStartup` controls first-visit creation; it does not suppress restoration of an existing tab.

**Migration:** 0.12 did not register a serializer, so it cannot supply a recoverable old workspace tab after quitting. The first 0.13 launch uses group one when no restorable tab exists. Exact placement and activity continuity apply to subsequent 0.13 sessions.

## Unsent Assistant context

The Assistant saves its question, Ask/Propose change intent, context disclosure and explicit context descriptor in the native webview state. The descriptor binds project, active feature and conversation identities to a bounded list of relative source paths and the task-brief checkbox. An explicit empty selection is distinct from a first-use default. Source bodies, provider credentials and runtime observations are not copied into that descriptor.

Cold restoration waits for authoritative project, feature and conversation identity. A mismatch cannot import another task's selections or question. New user input supersedes pending hydration. Selected source is re-read from the saved project inventory without opening native files, inspecting unsaved buffers or starting AI. Each await checks project, view, feature, conversation and source revision ownership.

Missing, excluded or unreadable source stays checked and visibly unavailable. Sending is blocked until the file is available or the user removes it. Dirty files retain their choice and continue to require saving before sharing. Restored source reads have a 256 KiB aggregate budget and at most 32 choices; actual requests retain the existing eight-file limit. Retry loads only the explicit choices. Source changes invalidate and refresh the cache, while Ask still rechecks saved revisions before any provider request.

Runtime evidence selections reset across sessions. Named screen/scenario definitions and historical observations retain their separate durable store; opening Foundation does not turn those records into current evidence.

## Verification

`npm run desktop:restart-smoke` uses an isolated native profile and a generated disposable project. One process uses the actual Assistant controls to select saved source, include a feature brief and type an unsent Change request. It quits with a dirty source editor active in group two and Foundation Refine in group one. A distinct process checks native tab order, active group, unsaved text, feature and actual restored Assistant DOM before issuing any show/refresh/preparation command.

The harness runs as a normal installed extension in disposable extension, user and shared-storage directories; extension-development mode is intentionally excluded because its backup lifecycle differs. It uses a loopback-only debugging endpoint in its disposable profile. It has no configured provider, starts no runtime and verifies saved file hashes. Automated native checks are separate from visible installed-app acceptance. See [0.13 verification](../artifacts/verification-v0.13.md) for the final results and limitations.
