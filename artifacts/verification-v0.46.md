# Foundation 0.46 — Xcode Project

M5.02a is verified and installed. M5.02 remains in progress until Swift editor intelligence is verified separately in M5.02b. [Workflow](../docs/xcode-projects.md) · [Native report](xcode-project-v0.46/native-report.json) · [Installation](xcode-project-v0.46/normal-install.json).

## Verified workflow

**Foundation: Xcode Project** opens without evaluating or executing a project. Explicit discovery and native QuickPicks select the maintained SwiftUI fixture, shared FoundationOrbit scheme and an owned iOS Simulator. Build and Run tests are separate controls with independent source-bound outcomes and result bundles. The packaged candidate compiled the iOS app and executed **7 XCTest tests with zero failures** on the selected Simulator.

Native acceptance verified dirty-file blocking, saved-source invalidation, changed and restored fingerprints, an actual owned xcodebuild process stopped through Cancel, and successful explicit retry. Both themes were rendered and inspected. The second native process preserved an unrelated unsaved draft and started no discovery, build or tests; explicit rediscovery restored the original fingerprint. No AI provider or connected web runtime ran.

SourceKit-LSP was located by the selected toolchain. A separate fixture probe initialized the protocol, returned five document symbols and shut down. This is feasibility evidence; Foundation's Swift completion, navigation, diagnostics and target build-settings integration remain unverified. Native app interaction, preview capture, mapping and request inspection also remain open.

## Validation and preservation

- **1,786/1,786 desktop tests** and **403/403 project tests** pass without skipped or cancelled tests. Both TypeScript targets, JavaScript syntax and `git diff --check` pass. Seven iOS XCTest results are recorded separately from those JavaScript suites.
- Core tests cover bounded regular-file snapshots, catalog provenance, exact supported commands, scheme/destination selection, generic build-only destinations, unsupported dependencies, cancellation, detached-process cleanup, time/output limits and source changes.
- Controller and renderer tests cover explicit native pickers, trust, root/view ownership, dirty drafts, stale evidence, cancellation during selection, separate build/test results, keyboard ownership, bounded diagnostic text, both themes and narrow layouts. Audit fixes keep historical labels after Cancel and close cancelled native pickers.
- All **37 installed payloads** match the signed native-tested candidate, including 30 extension and 7 host payloads. Source-map bindings and collected maintained-source hashes match. The nine-file SwiftUI fixture is unchanged by the final native run.
- The normal 0.46 relaunch preserves all eight saved Orbit files and the original 727-byte unsaved draft. The current native layout, editor/preview selection, caret and Assistant context match the fresh pre-install baseline in the installation record.
- Earlier diagnostics remain separate: the initial renderer test did not wait for updated owner identity, an initial TypeScript narrowing check needed a correction, and the fixture's first Simulator inventory timed out before an explicit retry succeeded. Earlier failures are not treated as passing runs.

## Remaining work

Next is M5.02b: real Swift editor completion, navigation and diagnostics using the selected Xcode target settings. Broader project/dependency support, native runtime/preview integration, release acceptance and storage remain open. Live paid-provider acceptance remains blocked; laptop/physical-display testing remains paused. M6 still creates a brand-new visual and motion system before applying it across Foundation last.
