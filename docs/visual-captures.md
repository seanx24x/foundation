# Paired visual captures

Foundation can attach one actual PNG of the visible running web preview to each new manual observation. Two captured observations can be inspected in Understand → Runtime → Compare observations. Images are evidence to review; capturing one does not mark a visual, behavioral, compilation, or accessibility check as passed.

## Capture a state

1. Connect an instrumented local web target and open a saved screen in Refine.
2. Start its manual observation and exercise the visible running application. Turn Inspect off.
3. Choose the manual assessment and optional note, then select **Capture and finish observation**. Keep the complete preview visible and unobstructed while it captures.
4. Start another observation, exercise its state, and capture it. Choose the two saved records in Compare observations.

**Finish observation** remains available when no image is wanted. Existing finished observations cannot acquire a later screenshot. A failed capture leaves the active observation available to retry or finish without an image, unless its context has independently become invalid and interrupted the observation.

Each run has at most one immutable capture. If image persistence succeeds but finishing the observation fails, a retry uses that original capture rather than replacing its point in time. A source, feature, trust, project, or runtime change during the operation prevents completion. An already persisted image may remain attached to an interrupted historical run; its capture time and the run's final status remain separate.

## Scope and provenance

The native bridge crops the rendered preview before returning PNG bytes. It accepts a bound runtime identity, never a caller-provided rectangle, window, selector, or script. It requires the owned Foundation workspace webview in a focused, visible window, and validates its trusted frame hierarchy, visible geometry, loopback runtime origin, document identity, route, and fresh nonce. Inspect overlays, clipped previews, unsupported transforms, ambiguous frames, and changing capture conditions are refused. Validation follows the actual canvas rectangle through the editor host’s clipping boundaries. Fractional frame measurements are bounded, and the final crop rounds inward, with one additional device-independent pixel inset at each edge when frame coordinates are fractional. The saved PNG reports its actual pixel dimensions.

Before and after capture, the host checks the active project and feature, saved screen/scenario definitions, runtime session/view/document/route/page version, saved-source hashes, and excluded dirty paths. The native bridge separately checks document-local route sequence, viewport, scroll, scale, and media preferences around the compositor capture. Relevant source watcher changes invalidate in-flight work.

The record retains full saved-source hashes and the exact observation binding. **Source relationship: Unverified** means those hashes do not prove that the displayed runtime was compiled from those bytes. Drafts remain excluded from saved-source evidence. Application theme, application data, and animation state are unknown; recorded color-scheme and reduced-motion preferences do not establish application compliance.

Comparison shows each capture's timestamp, pixel dimensions, viewport, device scale, canvas scale, scroll, and media preferences. Differing conditions remain visible. It performs no automatic replay, alignment, pixel scoring, causal attribution, or approval.

## Local storage and recovery

Captures stay in Foundation's private local extension storage, scoped by project. They are not written into the repository, included in Assistant context, uploaded, exported, or added to the private web preview. PNG integrity, dimensions, decompression bounds, and recorded SHA-256 are validated before display. Only the selected pair is loaded on demand. The pane receives the exact verified bytes in separate messages and retains at most two temporary blob URLs; routine workspace state and persisted view state contain no image bytes or URLs.

Metadata and image assets use a separate versioned manifest. Existing observation records retain their original schema. Files are private, create-only PNGs; manifest updates are atomic and revision-checked. A failed manifest write may leave an unreferenced asset, which still counts toward the disk quota. Saved captures are never silently evicted.

Limits are 40 captures and 128 MiB per project, 16 MiB and 16 million pixels per stored image, with a maximum dimension of 8,192 pixels. The native bridge additionally limits each PNG to 8 MiB and preview dimensions to 4,096 CSS pixels. Capacity, missing/corrupt images, unsupported native builds, and disconnected previews have explicit recovery messages. Clearing and reselecting a pair requests fresh verified bytes; a previously loaded image never authorizes a later changed asset.

This increment covers the maintained instrumented web adapter only. Reproducible application state, full-page/hidden capture, automatic replay, native SwiftUI/Expo capture, and pixel comparison remain separate work. Laptop and physical display acceptance remain paused while equipment is obtained.

## Verification status

Foundation 0.32 is verified and installed. The 1,104-test desktop suite, desktop TypeScript, native bridge diagnostics, actual native captures at zoom −3 and normal zoom with Fit, all four adjacent-edge privacy markers, paired rendering in both themes and second-process restoration passed. The normal Orbit draft, saved source and workspace context were preserved. See [verification](../artifacts/verification-v0.32.md) and the [running checklist](product-checklist.md).
