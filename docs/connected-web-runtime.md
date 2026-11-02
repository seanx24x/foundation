# Connect a running web app

Foundation's **Running app** view connects the product you are using to saved source and observed browser requests. **Saved preview** remains the separate, network-disabled source sandbox. Choose the surface that matches the work.

## Start and connect

1. Open and trust a local React/Vite project.
2. Add Foundation's development plugin to the existing Vite configuration. **Set up runtime** opens the exact import for this installation; review and save that configuration yourself. Discovery never rewrites the project.
3. In Refine, choose **Running app**. Start a recognized Vite `dev` target, or connect an already running instrumented server using an explicit HTTP loopback URL and port.
4. A connected server and a loaded page are separate states. If the page stops reporting, reload the view. If the server stops, reconnect or restart it.

Foundation uses the project's installed Vite and existing plugins. Start uses a free loopback port. Stop terminates only the development process Foundation started; an externally started server is merely detached. Editing and the saved preview remain available without a connected runtime.

See the [adapter setup and contract](../desktop/runtime/README.md) for configuration, transport, and packaging details.

## Inspect and interact

Use **Inspect** to select a rendered element without triggering its action. Instrumented intrinsic JSX/TSX elements reveal their source path, revision, geometry, and selected computed styles. A resolved selection follows into the source workspace. Measurements, requests, and hot reload do not move your source focus.

Switch to **Interact** to use the app normally. The request timeline reports the actual browser method, sanitized URL, status, duration, and outcome. Fetch timing ends at response headers; XHR timing ends at response completion. A nearby request is not automatically attributed to the selected component. The adapter does not claim backend behavior it cannot observe.

Each attachment has its own view identity. An ordinary browser tab and a second Foundation attachment do not overwrite this view's selection or request history. Reconnecting clears the view's observations even when the development server session is unchanged.

## Evidence and source changes

Source references retain a SHA-256 revision. Editing a mapped file makes old evidence stale; only a deliberate reselection can establish fresh source evidence. Unmapped or ambiguous selections do not authorize a direct source edit. Development transforms include source maps to preserve original breakpoint positions.

Request metadata excludes query strings, fragments, URL credentials, headers, and bodies. URL paths can still contain project information. Only explicitly selected request records are included when you ask AI to use runtime context. Records from an old connection or another project cannot be selected as current evidence.

Visual token proposals remain reviewable saved-source edits. Apply checks the current revision and unsaved-file state. Undo restores Foundation's change only while it remains safe to do so. A successful compile, observed interaction, and visual acceptance are separate results.

## Current boundary

This first adapter supports trusted local React/Vite development. It retains at most 100 request observations, validates up to 512 source references, and bounds each runtime response to 256 KiB. Production builds contain no instrumentation or session token. General frameworks, remote targets, screenshots, backend tracing, WebSocket requests, and precise arbitrary handler/state attribution are outside this increment.

The maintained `fixtures/connected-web` fixture provides real local success, delay, HTTP failure, and network failure scenarios. Its API discards submitted data. `fixtures/connected-secondary` verifies the adapter independently with a Ping interaction. These isolated fixtures do not change the bundled Orbit project or its unsaved drafts.

## Verification

- `node --test desktop/extension/test/connected-runtime.test.mjs` exercises real Vite/Chromium connections, source mapping, HMR freshness, request sanitation, per-view isolation, process ownership, cancellation, redirects, source maps, and production exclusion.
- `node desktop/scripts/connected-runtime-smoke.mjs` checks the packaged native extension, actual Electron-owned Vite process, installed plugin, native iframe readiness, an explicit App-to-SaveButton source-focus transition, native navigation, request evidence, and guarded token Apply/Undo in a disposable fixture. Real interactions use external Chromium; native visual acceptance is reported separately.
- Set `FOUNDATION_APP_PATH` to test a separate app candidate. `--keep-open` retains the disposable native window and its owned target for visual inspection. The default run stops its target and quits only its isolated profile. `--development` explicitly tests the source extension instead of the packaged extension.
