# Foundation 0.45 — Project Setup

M5.01 is verified and installed. [Workflow](../docs/platform-readiness.md) · [Native report](platform-setup-v0.45/native-report.json) · [Installation](platform-setup-v0.45/normal-install.json).

## Verified workflow

**Foundation: Project Setup** opens a native editor tab without probing. Explicit Check setup inspects bounded saved metadata and fixed local Apple tools. The isolated native fixture initially reports missing Expo/React Native metadata. Unsaved setup edits block checks; saved changes invalidate old results. Data-only fixture repairs followed by explicit Recheck produce a new input fingerprint. These fixture files demonstrate discovery and recovery; they are not installed dependencies or a runnable native app.

Actual native keyboard activations verified Check, Recheck and Cancel. Light and dark screens were inspected. A second native process opened without automatically checking tools and preserved its unrelated editor draft; explicit recheck restored the same input fingerprint. Executable app configuration was not evaluated; no project runtime or AI provider was started.

Tool checks remain individual results. The recorded Xcode status is **available**; the Simulator inventory status is **failed** (The tool did not respond within 10 seconds.). A failed tooling check remains failed. Native SwiftUI and Expo runtime adapters remain unavailable; compilation, tests and connected web preview are not verified by setup inspection.

## Validation and preservation

- **1,739/1,739 desktop tests** and **403/403 project tests** pass without skipped or cancelled tests. Both TypeScript targets, JavaScript syntax and `git diff --check` pass.
- Tests cover trust, root/view ownership, cancellation and owned-process cleanup, changed and dirty inputs, multi-root selection, malformed configuration, linked/special files, bounded scanning/output and explicit retry. Renderer checks cover both themes at 360/1100px and keyboard ownership.
- All **35 payloads** match the native-tested signed candidate, including 28 extension and 7 host payloads. Source-map bindings match maintained source; collected source/test hashes remain unchanged.
- The normal 0.45 relaunch preserved all eight saved Orbit files and its original 727-byte unsaved SaveButton draft. SaveButton remains at 18:1 with profile.ts as a preview tab; Explorer, expanded far-right Assistant, Request context, included task brief, Ask mode and empty composer are retained. The fresh baseline selected SaveButton and ProfileForm, and both selections remain.
- Preliminary diagnostics are retained separately: existing isolated host test doubles/navigation expectations needed updating for the new controller; invalid app configuration received an explicit recovery fix; the first native harness stopped at a focus precondition before dispatch and was corrected before the final complete native run.

## Remaining work

M5.02 next proves a maintained SwiftUI project with explicit Xcode build/test evidence. Expo development-build/runtime work, native mapping and requests, distribution and broader release gates remain open. Live paid-provider acceptance is still blocked; laptop/physical-display testing remains paused. M6 still creates a brand-new visual and motion system before applying it across the app last.
