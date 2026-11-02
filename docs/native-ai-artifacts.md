# Native AI artifacts — Foundation 0.5

Foundation’s Code OSS extension now renders request context, source explanations, active tasks, code changes, and revision-specific verification as shared artifact components. The production renderer is exercised in the [isolated browser fixture](../artifacts/native-ai-pane/index.html). The fixture labels every host action as simulated and has no provider connection or filesystem write path.

## Working behavior

- Context identifies selected versus available saved files, their revisions, and unsaved drafts. Selecting context does not send it. Every request retains its original source snapshots; a started request is distinct from confirmed provider receipt.
- Every request has an immutable identity. Host events, cancellation, errors, and persisted AI proposals carry it. Late events and older cancellation requests cannot attach to a newer turn.
- Stop immediately shows Stopping. The host revokes ownership and aborts before acknowledging cancellation. A completion arriving during Stop ends the request and labels the retained response as potentially partial. This does not promise that an upstream provider stopped billing.
- Explanation cards preserve partial text and source links. Source changes and closed source files produce separate stale and unknown freshness labels. Model output remains text and interpretation, never executable markup.
- Change cards follow the host checkpoint through Proposed, Applied, Undone, Discarded, and Stale. Older proposal cards are read-only once another checkpoint supersedes them.
- Expanded review uses the same artifact identity. Apply and Undo keep the existing host-owned trust, revision, native-draft, single-file, and compare-and-swap guards. Opening a card never applies a proposal.
- Preview compilation is attributed to a proposal only when the preview includes its exact applied revision and is not stale. Compilation, interaction, and visual review remain independent. Suggested checks are explicitly unexecuted.
- Dialog updates preserve source/diff disclosures and keyboard focus. Stale warnings remain visible when a card is collapsed.

## Persistence and boundaries

The initial 0.5 implementation kept conversation artifacts in the webview session. Foundation 0.7 supersedes that boundary with [durable project-local conversations](durable-conversations.md), including interrupted-request recovery and historical verification. The latest proposal/checkpoint remains separately persisted as the authority for source edits. Foundation 0.5 does not add autonomous tools, multi-file edits, API capture, document generation, or a verification runner. The ten-family design contract defines those later integrations separately. Provider setup remains deliberate, and no commercial model has been contacted for this implementation.

## Validation

The extension TypeScript check and bundle succeed. Seventy focused tests pass, including 13 artifact-state cases and five host-protocol regressions. Browser inspection uses the actual production renderer under a clearly labelled fixture host, covering explanations, proposal Apply/Undo, stale and draft blocking, cancellation, failures, and light/dark narrow expanded views. The broader existing webview automation suite was updated for the protocol but was not run in this increment. Full screen-reader, forced-color, reduced-motion, zoom, cross-browser, and external-provider acceptance remain separate work.

## Installed desktop check

Foundation 0.5 was installed with a verified development signature and reopened on 28 October 2026. The Assistant pane rendered its native context artifact with AI disconnected. Orbit’s unsaved SaveButton draft restored as unsaved; all eight saved project files remained byte-identical. Packaged renderer and host hashes match the repository. See [verification record](../artifacts/native-ai-pane/verification.json).
