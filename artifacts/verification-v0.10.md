# Foundation 0.10 — connected web foundation

Verified 28 October 2026 (29 October UTC). This is the first M0/M1 implementation increment in the [24-capability checklist](../docs/product-checklist.md). M2–M5 remain open.

## Delivery state

A signed 0.10 candidate is built at `/private/tmp/foundation-010-candidate-1r5n3du2/Foundation.app`. The normal installed app at `desktop/.build/Foundation.app` remains **0.9.0**. Desktop control reported the Mac locked before installation and again at the final check. An unlock request is pending; the running app was not forcibly closed or replaced.

All eight saved Orbit files and the original 727-byte unsaved draft backup match their pre-work hashes. The candidate was tested in separate disposable profiles and projects. No private preview, browser workbench, conversation, or draft was published.

## Implemented

- Refine can discover/start an instrumented Vite target, connect an existing loopback target, and stop only a process Foundation owns. Missing dependencies/instrumentation and disconnections have explicit recovery.
- The development-only plugin runs through the project's own Vite pipeline. JSX selections map to exact saved source positions with source maps, revision checks and separate runtime/view identity. Measurements cannot silently refresh stale mappings or steal editor focus.
- Fetch/XHR observations retain method, sanitized URL, status, outcome and measured timing. Bodies, headers, credentials, query strings and fragments are excluded. Requests remain unattributed; no backend behavior or interaction causality is invented.
- The far-right Assistant accepts up to 12 explicitly selected observations alongside selected saved source. History stores immutable evidence with the original turn; a current request resolves evidence again from the active native runtime.
- OpenAI Responses and Anthropic Messages adapters join the compatible Chat Completions adapter. Credentials are scoped to provider and destination. Setup does not dispatch requests, unknown/disconnected configurations avoid credential access, and streams support usage, cancellation and distinct failure recovery.
- Existing single-file proposals retain exact source anchors, review, draft checks and guarded Apply/Undo. The sandbox remains available separately from the running project.

See [runtime setup](../docs/connected-web-runtime.md), [provider setup](../docs/ai-provider.md), and [design tools](../docs/ai-design-tools.md).

## Executed checks

| Evidence | Result |
| --- | --- |
| Project regression suite | 79 passed; 0 failed |
| Full desktop suite against signed candidate | 166 passed; 0 failed; 0 skipped |
| TypeScript extension check | Passed |
| Packaged native smoke | 17 passed; no provider requests or platform authentication activation |
| Packaged connected runtime | 7 checks passed |
| Native history restart | Conversation identity and native sidebar restored in separate processes |
| Package equality | Seven key assets match source exactly; hashes in JSON |
| Signature | Ad-hoc deep/strict codesign verification passed |
| Orbit preservation | Eight saved files and unsaved backup unchanged |
| Whitespace | `git diff --check` passed |

The connected native smoke first waits for the actual native iframe heartbeat, before launching an external browser. Chromium then interacts with the installed host-owned Vite target; the native host receives mapped SaveButton source and real 200/503 observations. Native source navigation, token Apply/exact Undo, and owned-process Stop are verified. This is not a claim of native mouse/keyboard visual acceptance.

The eight runtime tests additionally cover delayed and failed requests, XHR, a second maintained fixture, external-server preservation, redirects, view isolation, HMR staleness, development-only instrumentation and exact source-map positions. Host tests cover async ownership, revoked trust, project boundaries and context routing. Renderer tests cover both themes, narrow layouts, keyboard paths, loading/disconnected/setup/stale states, frame retention, context selection, history and recovery.

- [Machine-readable verification and asset hashes](verification-v0.10.json)
- [Native checks and command timings](verification-v0.10-native.json)
- [Connected native report](verification-v0.10-runtime.json)
- [History restart report](verification-v0.10-history.json)
- [Dark connected renderer fixture](../desktop/tests/artifacts/connected-project-dark.png)
- [Light Assistant renderer fixture](../desktop/tests/artifacts/connected-assistant-light.png)

## Baseline and limits

The [repeatable source-service baseline](baseline-v0.10.md) records 250 warm-filesystem timings on saved Orbit and a generated 100-file project. The packaged native check records 20 single-character command-to-document samples: median **1.927 ms**, p95 **3.348 ms**. These measure an extension-host command round trip with a warm small editor, not physical input-to-paint latency or performance under AI/runtime load. They provide no market ranking or large-project guarantee.

Normal-profile installation and native visual acceptance remain pending the Mac unlock. The native history restart currently proves an empty conversation's identity/sidebar persistence; populated evidence and history are covered by store, protocol and renderer tests, not a populated native visual replay.

Live OpenAI and Anthropic quality/compatibility acceptance remains pending credentials entered by the user and a bounded test budget. All provider tests used local mock responses and fixture credentials. Images, screenshots, autonomous tools, multi-file execution, scenario comparison, backend traces, SwiftUI and Expo are outside this increment.

## Resume installation

After the Mac is unlocked, quit the normal app gracefully without saving or discarding the Orbit draft. Run `npm run desktop:refresh` and `npm run desktop:launch`, resolve any previously approved macOS Documents prompt, verify the restored draft, and inspect the installed workflow. Never replace/sign the normal bundle while it is running.

## Verification correction discovered during 0.11

The 0.10 native runtime check started with SaveButton already selected, so its later source-navigation assertion did not prove a focus transition. The host also compared the source service's 16-character revision with the runtime's full SHA-256, preventing an actual mapped selection from changing source focus. The 0.10 runtime-to-source focus claim is therefore withdrawn. Version 0.11 compares the full saved source hash and strengthens the native test to require App.tsx → SaveButton.tsx with runtime provenance before opening the editor. See the 0.11 verification for the corrected outcome. The 0.10 counts above remain a historical record of the tests as originally written.
