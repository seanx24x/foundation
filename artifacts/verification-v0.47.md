# Foundation 0.47 — Swift editor intelligence

M5.02b is verified and installed. The bounded M5.02 Xcode/Swift fixture gate is complete; broader compatibility and native runtime remain separate. [Workflow](../docs/swift-language.md) · [Native report](swift-language-v0.47/native-report.json) · [Installation](swift-language-v0.47/normal-install.json).

## Native evidence

An explicit generic iOS Simulator build supplies actual compiler settings for the selected FoundationOrbit arm64 target. The signed packaged app starts its own Xcode SourceKit-LSP process using a validated private compilation database. No Simulator or sample app is launched.

The native editor verifies real member completion in both themes, Tab acceptance and one-step Undo, F12 navigation from ProfileView to ProfileStore, and rendered NavigationStack documentation. Trusted editor input creates an unsaved type error visible in Problems; correcting the buffer clears it. An unsaved dependency rename also produces errors in the unchanged-version consumer, and restoring the dependency clears them. SourceKit requires protocol-only reopening of consumers to refresh its semantic cache; Foundation preserves their exact text, versions, native buffers and caret.

Rapid edits finish with current-version diagnostics. The API-driven completion race observed pending work and cancellation; stale results were withheld. Keyboard events are automated native input, not physical keyboard-to-display measurements. Hover invokes the public editor command and inspects its rendered result; the request race uses the public provider API and is labeled separately.

Disconnect clears diagnostics and waits for the owned process to exit. Explicit reconnect starts a new build and language session. A second native process restores the unrelated unsaved draft with Swift disconnected; opening source and explicit project discovery perform no automatic build or language connection. The copied nine-file fixture and maintained fixture remain byte-identical. No AI provider or connected web runtime runs.

## Validation and installation

- **1,862/1,862 desktop tests** and **403/403 project tests** pass without failures, skips or cancellations. Both TypeScript targets and JavaScript syntax checks pass.
- Tests cover actual compiler-argument parsing, macOS path aliases, target/architecture selection, toolchain and database provenance, source/configuration changes, bounded transport, session/version/target-context ownership, cancellation, malformed responses, dependency refresh, failed refresh reporting, cleanup, native provider conversion, and connection control focus/recovery.
- Both themes, native completion and Problems, Xcode connection and restored disconnected surfaces were inspected. Renderer tests also cover narrow layouts, stable keyboard controls and escaped output.
- All **37 installed payloads** match the signed native-tested candidate. Source-map bindings and retained source manifests match. The normal relaunch preserves eight saved Orbit files, the original **727-byte unsaved draft**, SaveButton at 18:1, its single editor tab, layout and Assistant context against the fresh baseline.
- Earlier failed attempts remain separate in [earlier-attempts.json](swift-language-v0.47/earlier-attempts.json). Initial native settings rejected an equivalent temporary-folder alias; later harness corrections addressed picker-row readiness, dirty-flag cleanup of an exact test-owned buffer, and EditContext input-event observation, and bundled Swift snippet attribution in the aggregate completion API. The initial regression packaging check targeted the unchanged installed 0.46 app instead of the 0.47 candidate; the corrected candidate-bound suite passed. Earlier protocol probes that exposed dependency caching are diagnostic evidence, not passing acceptance.

## Boundaries and next work

Support is verified for the maintained self-contained iOS SwiftUI target, not arbitrary Xcode projects. External/generated sources, explicit compiler plugins and unsupported dependencies remain unavailable. Builds execute trusted project code; separate output directories do not sandbox build scripts. Native preview, app interaction, runtime mapping and network inspection remain **M5.03**. XCTest execution remains the separately verified 0.46 milestone; this increment makes no new test-execution claim.

Production signing/notarization, broader platform compatibility, storage lifecycle and release gates remain open. Live paid-provider acceptance remains blocked; hardware testing stays paused. **M6 remains last: create and review a brand-new visual and motion system, then apply it across Foundation.**
