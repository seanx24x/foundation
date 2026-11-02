# Populated history and project scale

This increment tests how Foundation behaves when a project has more source files and retained evidence. Foundation 0.29 is installed and verified. The [0.29 evidence](../artifacts/verification-v0.29.md) records shared source analysis, retained history delivery, native activation continuity, matched healthy baseline/candidate scale runs, preservation and measurement limits. The [0.28 evidence](../artifacts/verification-v0.28.md) retains the earlier digest and runtime transport work. The [running checklist](product-checklist.md) separates this bounded fixture from broader production acceptance.

## Scope

The scale profile extends the native editor benchmark with a generated project near the current 1,500-file limit and below the 8 MiB inventory cap, populated conversation history and runtime observations, and several minutes of synthetic editing. Seeded history is explicitly labeled synthetic. It exercises storage, freshness and rendering; it is not evidence that historical interactions actually occurred.

Live load remains separate: local Assistant streaming, real saved-source refreshes, and requests captured through the instrumented Vite runtime. A provider stream must stop within its existing deadline; repeated stream windows are measured with their gaps recorded. No production provider or normal Orbit source is used.

The existing short `npm run desktop:performance` profile remains available. The scale profile uses `npm run desktop:performance -- --profile=scale`. `FOUNDATION_APP_PATH` selects the packaged baseline or candidate. Both runs require matching fixture, settings, hardware, viewport and harness identity.

## Freshness contract

Historical observations retain their original source and definition references. Reusing a saved-source digest must require the same project/root, path and exact source text. A declared revision token alone is insufficient. The cache must be bounded to currently loaded source and clear when ownership or trust is lost.

Definition changes, archived screens/scenarios, missing source, unloaded source and active-run observations remain live checks. Caching a digest must never turn unknown or stale evidence into current evidence. Historical observations stay historical even when their saved revisions match.

## Shared source analysis

A display refresh reads the union of selected/open files, active feature files, restored Assistant context, and design-preview inputs. The bounded batch supports up to 192 requested paths; the current combined surface limits require at most 172. It inventories once and parses each source once to assemble consumer relationships. Requested files receive a final exact-text read; changed or unavailable targets, and their consumer contributions, are excluded. The source basis remains bounded to 8 MiB.

The batch exists only for its refresh and carries project/root, generation, trust and source-epoch ownership. Feature membership and Assistant request/conversation/view ownership are checked again before publication. A fresh refresh reads saved source again even if a revision token or watcher epoch is unchanged. Feature and Assistant context retain independent 256 KiB limits. Missing selections remain explicit. No unsaved editor buffer enters the batch.

Display reuse grants no action authority. Provider requests, scenario recording, source investigation and guarded Apply/Undo retain their separate current-source checks. Consumer results are scan-time evidence; the filesystem is not locked into an atomic snapshot. Truncated consumer analysis is labeled in the interface.

## Retained history delivery

Each panel negotiates the local history protocol when it is ready. Its first delivery includes the retained records; subsequent deliveries identify their base and send changed or removed records alongside current headers. Conversation turns and runtime runs keep explicit identity and ordering. A new panel has its own cursor. Missing bases, reloads, project changes and failed delivery request a full recovery; omitted records never mean an empty history.

Read-only store presentations reuse frozen saved records. Action/inspection snapshots remain detached copies. Freshness, storage status, active runtime observations and current selection are recomputed or delivered independently of record reuse. This presentation optimization does not grant source access, provider permission, or verification credit. Capacity checks and durable persistence still inspect or copy complete stored history; these remain measurable costs.

## Retained plain Assistant responses

The Assistant page/layout/conversation/response region stays connected. Plain rows retain passive ancestors and answer-text children only on exact answer, source-citation identity/path/revision/lines and full saved-runtime evidence matches. Changed content updates the leaf and citation children; sibling controls, evidence and warnings are rebuilt. Project, conversation, feature and trust changes invalidate retained ownership. Selected context, freshness and action ownership remain current; no retained DOM grants action authority. Artifact-rich, tool, plan and expanded-dialog rows keep their existing update path. This bounded optimization does not claim that every Assistant artifact is retained or that all-history-expanded and multi-hour workloads have been accepted.

## Native activation continuity

Incoming state and ownership updates remain immediate. While a trusted key or pointer activation is in progress, primary Assistant controls keep their DOM target until the native action finishes, then commit the latest queued render. No click is synthesized or replayed. Send stays bound to the reviewed question, feature/source revisions, dirty state, provider and prepared context; Stop stays bound to the owning request while streaming. Changed ownership cancels the old action. Focus loss, pointer cancellation and release outside the target do not activate it.

The scope covers primary Send/Stop/Setup, source checkboxes and their labels, Request context, mode buttons, workspace activity buttons and tagged lazy workspace disclosures. Review, tool and expanded-dialog controls retain their existing behavior. Native disclosure state survives queued renders, including an immediately following disclosure action. This is an interaction contract; it does not add provider or source authority.

## Measurement boundaries

The benchmark reports native synthetic renderer estimates, actual overlapping work, state delivery counts, sampled serialized payload sizes, and process-specific memory readings. Serialized JSON size is an estimate, not IPC wire traffic. Measurements that serialize a payload add their own work and must identify that sampling policy.

Warmups, typing intervals and gaps are explicit. Memory samples are observations; neither a stable few-minute run nor a single before/after difference establishes absence of a leak. A generated corpus on the current workstation does not establish performance on representative production repositories or laptops.

A successful run preserves exact expected editor text, unrelated drafts, saved-source hashes and seeded history. It stops local provider streams and the owned runtime. Normal-profile installation separately verifies Orbit's original unsaved draft, layout, caret and explicit Assistant context.

Physical keyboard-to-display, multi-hour sessions, representative real projects and laptop acceptance remain open.

## Reproduce the history microbenchmark

Choose a preserved packaged baseline explicitly before running the current source comparison:

```sh
node desktop/scripts/history-performance.mjs \
  --baseline-app=/absolute/path/to/baseline/Foundation.app \
  --output=/absolute/path/to/history-performance-report.json
```

`--baseline-app` is required. The baseline must contain its extension source map. The optional output path must be absolute; without it the report is written to `desktop/.build/history-performance-report.json`. The runner labels both versions from their extension packages and records source/harness hashes, raw samples, fixture sizes and digest work. It does not assume that the currently installed or default build is the older baseline.

The fixture contains 40 synthetic runs with 4,000 observations, 32 saved sources totaling 256 KiB, and 100 conversation turns. Both host versions use the same validated current-store fixtures. Eight warmup rounds precede 80 measured rounds with rotating operation order. Full runtime snapshot timings include production store cloning; store-only and conversation snapshots are measured separately. Webview transfer, rendering, native input and provider activity are outside this microbenchmark.

The original 0.27-to-0.28 raw measurement report remains separate from later runner output. Rerunning the command produces a new measurement, not a replacement for the original evidence. Wall-clock differences are descriptive; exact hash counts and freshness regression tests establish the cache behavior.

## Sustained runtime transport

The larger fixture uncovered a live observation stall. The previous client sent every instrumentation event with `keepalive` and left acknowledgment bodies unread. In the isolated Chromium diagnostic, all 500 application requests returned HTTP 200, but only 194 request observations arrived before the event-body total reached 65,376 bytes.

Foundation 0.28 reserves `keepalive` for the pagehide notification and consumes its own instrumentation acknowledgments. It does not consume or alter application fetch/XHR responses. The regression crosses 128 KiB of accepted event bodies, then checks a later XHR observation and heartbeat, the existing 100-event retention cap, URL privacy and route/document ownership. Its pagehide check dispatches a synthetic event in a live page; it does not prove delivery during browser teardown.

Reproduce the four-variant diagnostic with an unchanged packaged baseline:

```sh
node desktop/scripts/runtime-transport-diagnostic.mjs \
  --repo=/absolute/path/to/foundation \
  --baseline-app=/absolute/path/to/baseline/Foundation.app \
  --output=/absolute/path/to/runtime-transport-report.json
```

The runner tests the original transport, acknowledgment consumption only, pagehide-only keepalive, and both changes. It accepts only the original transport pattern and records the selected package version and plugin hash. The checked-in original diagnostic remains separate from new runs.

The native load driver uses the existing embedded preview. Opening another page with the same view ID would compete for document ownership. Accepted instrumentation, current native observations and measured requests must agree on session/view/document, path and timing. Each loaded phase requires a confirmed accepted ping and a native observed ping within five seconds of its end. Passive network response statuses are classified at a fixed cutoff as accepted, rejected or unknown; unknown is never accepted. This proves bounded live overlap, not a gap-free capture of every request.
