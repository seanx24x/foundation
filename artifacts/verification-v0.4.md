# Foundation 0.4.0 verification

Date: 2026-10-27. Host: macOS Apple Silicon.

## Built artifact

- Source-built Code OSS 1.143.1 at `e646868227c3e3a9e3f24277c8c7220be42c0be7`.
- Pinned Node 24.18.0 and Electron 43.7.7.
- App: `desktop/.build/Foundation.app`, bundle identity `design.foundation.ide`; final build timestamp `2026-10-27T23:04:19.744Z`.
- Full `npm run desktop:build` completed. Ad-hoc signing and `codesign --verify --deep --strict` passed.
- Built provenance records Foundation 0.4.0 plus `optional-copilot-integration`, `on-demand-default-account`, and `on-demand-speech-account`. The packaged workbench must contain both startup patch markers; refresh rejects a host without them.

## Delivered scope

- Ask / Propose change with disclosed saved-source context, cancellation, bounded structured edits, and no model filesystem or command execution.
- Saved-source React canvas, explicit element-to-file mapping, measured geometry/computed styles, themes, viewport sizes, Fit, and scoped CSS token experiments.
- Reviewable AI and token proposals with immutable native diffs, serialized Apply, guarded Undo, stale evidence, native draft protection, and local checkpoint recovery.
- Preview explicitly excludes unsaved native drafts and does not save or discard them. No source changes result from simply previewing, inspecting, or experimenting.
- Foundation startup defers eager GitHub account discovery from the default account and speech services until provider activation. Explicit sign-in, authentication APIs, account listeners, policy handling, encryption, and workspace trust remain intact.

## Automated verification

- `npm test`: 57 service tests passed after the final context-save safeguards.
- `npm run desktop:test`: 39 passed, zero skipped, against the rebuilt artifact with both startup patches. Includes account deferral and artifact provenance assertions, guarded proposal persistence/Apply/Undo, sandbox and webview tests.
- The browser webview harness exercises a real parent-frame host message after reproducing Code OSS's parent/top/frameElement rewrite, nested-frame spoof rejection, actual saved Orbit modules, responsive canvas sizes/themes, selection, and interaction/error behavior.
- A sequential-keystroke regression types `#285e47` while interleaving real preview measurements and host refreshes. Raw text, Select All, caret, focus, exact proposal value, canvas color, and Reset all pass. Incomplete input retains the last valid preview value; remounted canvases clear prior element measurements.
- `npm run desktop:check`: passed after the startup patch.
- `npm run check` and `npm run build`: passed for the product implementation. The browser build retains a known large Monaco chunk warning.
- Seven added async regressions prove queued cancellation, cancellation during checkpoint persistence, late dependency changes, and symlink replacement are rejected while retaining prior source/checkpoints.
- `git diff --check`: passed.
- Native packaged-app smoke: 13 checks passed with exit code 0 and no timeout, in `/private/tmp/foundation-smoke-HPG0PS`. Covers native activation, commands, symbols, source navigation, save/diff, four activities, themes, Git, terminal, React preview compilation, token Apply/Undo, zero AI requests, and zero platform authentication activations. See `native-smoke-v0.4.json`.

## Native visual acceptance

The normal desktop app was exercised through native accessibility and visual inspection after the user resolved the Documents permission queue. Orbit indexed all 8 files while preserving exactly one unsaved SaveButton draft. No Keychain access was authorized.

- The saved-source React preview connected with network access off. SaveButton mapped to its source and measured **127.5 × 39 px**, with baseline fill `rgb(52, 103, 78)`.
- Entering `#285e47` as a complete token value changed the canvas and measured fill to `rgb(40, 94, 71)`. Review showed the exact declaration edit and shared scope; the native before/proposed diff opened. The proposal was discarded without applying it. Reset restored the original canvas value, and source remained unchanged.
- Dark theme and the 390 px phone viewport worked. “Ask AI to refine this” transferred mapped saved-source context, excluded the dirty buffer, and kept the provider disconnected.

Final native verification passed in the refreshed application (`2026-10-27T23:04:19.744Z`). Typing `#285e47` one character per action retained every partial value and input focus while measurements updated; the completed color measured `rgb(40, 94, 71)`. Reset immediately restored both `#34674e` and measured fill `rgb(52, 103, 78)`, and disabled Review because the value again matched saved source. The user renewed the already-approved Documents permission for the new development signature; no broader access was requested. Foundation is left open on the connected Orbit canvas with 8 files indexed and exactly one unsaved SaveButton draft. Its disk hash and the original CSS token values remain unchanged.

## Remaining boundaries

A real AI provider has not been configured or contacted; deterministic local protocol fixtures establish integration behavior, not commercial-model quality. The design sandbox has network access disabled and does not establish real backend request success. Preview transpilation is distinct from a complete project build, interaction verification, and visual acceptance. General running-app attachment, multi-file agents, automatic visual comparison, native platform adapters, signed distribution, and automatic updates remain future milestones. See `docs/ai-design-tools.md` for exact supported inputs and recovery behavior.
