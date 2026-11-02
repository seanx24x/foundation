# Foundation React/Vite runtime adapter

This is a development-only integration for a trusted local React/Vite project. It runs the project's actual Vite pipeline and observes its browser requests; it does not reuse Foundation's network-disabled saved-source sandbox.

## Explicit setup

A project must deliberately add the plugin to its Vite configuration. Foundation must present that configuration change for review before writing it. Merely discovering or connecting a target never modifies project files.

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { foundationRuntime } from '/absolute/path/to/Foundation.app/Contents/Resources/app/extensions/foundation-workspace/dist/connected-vite-plugin.mjs';

export default defineConfig({
  plugins: [foundationRuntime(), react()],
  server: { host: '127.0.0.1' },
});
```

The app-bundled path is local to the developer's installation. Do not commit another person's absolute application path as a project requirement. For the maintained fixtures in this repository, the configuration imports `../../desktop/runtime/vite-plugin.mjs`. A distributable package is a later packaging task.

Start the project's server and connect its explicit loopback URL, or use Foundation's Start action when the recognized `dev` script is `vite` with supported host/port/open flags. Foundation starts the Vite executable without a shell and supplies a loopback host and free strict port. It only terminates processes it started. Stop on an externally started target detaches without terminating that target.

## Runtime contract

`createConnectedRuntime({ root, onChange, nodePath? })` supplies `discover`, `start`, `connect`, `stop`, `snapshot`, and `dispose`. The editor host enforces workspace trust before calling these operations.

Snapshots distinguish target status from `pageConnected`. Connected means the instrumented development server is reachable; page readiness expires if the browser stops sending heartbeats. A runtime restart creates a new session. Every editor attachment also receives a separate `viewId`; its selection and requests cannot be replaced by ordinary browser tabs or other attachments. `targetUrl` is the clean connect address, while `url` adds a nonsecret view identifier for the embedded page. Reconnect starts a fresh view even when the server session is unchanged. Source identities carry SHA-256 revisions. `selectionVersion` advances only after an explicit selection, so measurements, hot reload, reconnect, or request updates must not move the native editor's focus.

The central renderer embeds `snapshot.url` in a frame restricted to that exact loopback origin, using `allow-scripts allow-same-origin allow-forms`, and sends optional controls:

```js
frame.contentWindow.postMessage({
  type: 'foundation-runtime-control', session: snapshot.session,
  inspect: true, theme: 'light',
}, new URL(snapshot.url).origin);
```

The client records observations through its own Vite server. The host polls authenticated snapshots; arbitrary frame messages are not host commands. The session token never appears in the renderer snapshot, AI context, or public iframe URL.

## Evidence and limits

- Intrinsic JSX/TSX elements receive development-only identifiers through the TypeScript parser. High-resolution insertion source maps preserve original source positions for downstream debugger mappings. React rerenders preserve source identity; source changes invalidate older mappings until an unambiguous new selection is made. Uninstrumented DOM remains unmapped. Repeated instances can share a source location.
- Only sources under the canonical project root are accepted. Symlink escapes and attachment to another project are refused.
- Browser fetch and XHR observations include sanitized method, URL, status, duration, outcome, and time. Query strings, fragments, embedded credentials, headers, and bodies are excluded. URLs may still contain project data in their path; users must review selected observations before sharing them with AI.
- Fetch duration ends at response headers; XHR duration ends when its response completes. These are named timing boundaries, not full backend tracing.
- Every request is marked `correlation: unattributed`. Temporal proximity is not proof that a selected component caused a request. Backend internals and arbitrary handler/state attribution are not provided by this adapter.
- Snapshots retain the last 100 requests, validate at most 512 source references, and reject responses larger than 256 KiB. This is a bounded initial adapter, not a complete request archive.
- Production builds do not include the plugin, browser instrumentation, or runtime token. No remote target, screenshot capture, websocket request tracing, browser extension, or general framework support is implied.

## Maintained fixtures

`fixtures/connected-web` starts from saved Orbit source in its own directory and adds real local success, latency, HTTP-failure, and network-failure scenarios. Its API discards the submitted data; it creates no account and saves no profile. `fixtures/connected-secondary` is an independent minimal React app with a Ping interaction.

`desktop/extension/test/connected-runtime.test.mjs` copies fixtures into temporary directories and verifies real Vite/Chromium behavior, authentication/session/view isolation, source-map fidelity, exact mappings, request metadata, HMR freshness, cancellation, ownership, redirects, and production exclusion. It never modifies `projects/orbit` or the user's editor drafts.

## App-authored replay

The development plugin exposes `virtual:foundation/scenarios` for explicit fixture preparation and ordered callbacks. See the [scenario replay guide](../../docs/scenario-replay.md) and [maintained fixture](../../fixtures/replay-web/README.md). Replay runs only from an explicit action during an active observation; it is separate from manual assessment and native image capture.
