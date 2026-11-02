# Foundation native AI pane fixture

This page runs the actual desktop extension renderer (`media/webview.js`, `media/webview.css`, and `media/artifact-model.js`) against a deterministic browser host. It is a development and visual-review fixture, not the Foundation desktop application.

## Boundaries

- No provider is contacted. “Deterministic sample” is a simulated provider label. Token usage is zero.
- No source, editor buffer, credentials, trust setting, or desktop profile is read or written by the browser page.
- `fixture.json` contains saved snapshots of the bundled Orbit `src/components/SaveButton.tsx` and `src/styles/tokens.css`, plus their source analysis, file inventory, and Foundation theme colors. Absolute local project paths are replaced with a sample label.
- Scenario selection and all source/proposal transitions remain in memory. Reloading or Reset sample discards them.
- The iframe blocks network connections with `connect-src 'none'`. The outer host reads one static JSON asset from its own origin; remaining HTTP requests are renderer scripts and styles. There is no API server, filesystem bridge, or model transport.
- Native actions, including Configure, terminals, design builds, or source navigation, are captured and shown in the host log. Source/diff actions open read-only snapshot details. Apply and Undo simulate state changes in memory only.

## Serve locally

Keep the three production renderer assets under `media/` next to this README. Serve the folder with an ordinary static HTTP server; opening `index.html` as a `file:` URL is unsupported because the renderer validates same-origin host messages.

The complete fixture consists of `index.html`, `harness.js`, `harness.css`, `frame.html`, `bridge.js`, `fixture.json`, and `README.md`, plus those three production assets. Download links in the sidebar expose the exact renderer assets used by the page.

For example, from this directory:

```sh
python3 -m http.server 4187 --bind 127.0.0.1
```

Open `http://127.0.0.1:4187/`. Use the Theme and Viewport controls to inspect light/dark, 384 px pane width, and expanded layouts. Changing theme and width preserves the current sample conversation. Selecting a scenario resets only fixture state.

## Scenarios

| Scenario | What it exercises |
| --- | --- |
| Explanation | Actual Ask dispatch, source context, correlated start/deltas/done, citations, read-only source navigation. |
| Proposal | Actual change intent and proposal rendering; review, simulated Apply, and simulated Undo. |
| Stale | A newer saved revision arrives after completion; the earlier proposal retains its evidence and blocks application. |
| Draft | The selected source has a simulated unsaved draft, blocking dispatch and proposal application. No real editor draft is accessed. |
| Streaming / Stop | Slow correlated deltas; Stop sends cancellation; the host acknowledges after 320 ms and retains partial output. |
| Failed | A partial answer is followed by a correlated error; source context remains available. |

The initial view is idle. Each scenario requires a button click. Scenario buttons seed and submit through the real renderer form rather than forging an internal conversation state. A manually submitted prompt also receives deterministic sample text; this fixture does not interpret arbitrary prompts.

## Host protocol

`acquireVsCodeApi()` is shimmed by `bridge.js` inside the same-origin `frame.html` document. A real document URL preserves the production renderer's origin checks; `srcdoc` is deliberately avoided. Initial view and theme configuration are read from a data attribute on the parent iframe before the bridge aliases `frameElement`. Scenario submission also selects the actual Ask or Propose change mode control before submitting the real form. `getState`/`setState` persist only to that iframe's memory; `postMessage` routes into this fixture. The host validates both message origin and iframe source. It emits `state` and `mode` events and mirrors each renderer-created `requestId` onto every AI envelope and event. `start` confirms simulated context dispatch. Cancellation clears pending timers before sending the acknowledgement.

The latest outbound action is visible below the pane, including its request ID and message details. This is intentionally separate from the production renderer so fixture labels and scenario controls cannot become product UI.

## Verification strategy

Use this page for visual and keyboard inspection of the production UI. Keep automated renderer assertions in `desktop/tests/webview.test.mjs`, which already loads real webview assets with a mock native API. Assert lifecycle ordering, context freshness, stale-request isolation, cancel acknowledgement, preserved partial output, draft guards, proposal review gates, focus/scroll behavior, theme contrast, and narrow-width overflow there.

Test real source safety separately with `desktop/extension/test/proposal-session.test.mjs` and provider transport behavior with `desktop/extension/test/bridge.test.mjs`. Their temporary workspaces and mock transports can verify apply/undo, revisions, cancellation, and credential redaction without using live provider credentials.

This browser fixture cannot prove native editor integration or filesystem mutation correctness. `desktop/scripts/smoke.mjs` covers the packaged host using a separate temporary workspace, user-data directory, extensions directory, and loopback sentinel provider. It must remain separate from visual fixture review and from the user's active Orbit session.
