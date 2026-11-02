# Foundation repository guide

Foundation's public inspection snapshot is [seanx24x/foundation](https://github.com/seanx24x/foundation). Its earlier development history is retained separately and privately; see the [publication record](publication.md). Start with [functionality](functionality.md) for product coverage and the [running checklist](product-checklist.md) for acceptance status.

## Source layout

| Path | Contents |
| --- | --- |
| `desktop/extension/src/` | Native Foundation controllers, AI workflows, persistence, source intelligence and platform integration. |
| `desktop/extension/media/` | Native workspace, Assistant, inspectors, review and Xcode webview surfaces. |
| `desktop/extension/themes/` | Current native light and dark themes. |
| `desktop/runtime/` | Development instrumentation for connected web applications. |
| `desktop/scripts/`, `desktop/patches/` | Reproducible Code OSS bootstrap/build, branding, scoped upstream patches and native acceptance harnesses. |
| `desktop/upstream.json`, `desktop/product.json` | Pinned editor/toolchain and Foundation product configuration. |
| `src/`, `server/` | Browser workbench, local source services, provider adapters and shared workflow logic. |
| `projects/orbit/` | Saved bundled React/TypeScript sample source. |
| `fixtures/` | Maintained web, connected-runtime, replay and SwiftUI acceptance projects. |
| `tests/`, `desktop/tests/`, `desktop/extension/test/` | Project, renderer, integration and native-host regression suites. |
| `design/` | Current semantic tokens and design data. |
| `artifacts/design-system-v1/` | Existing interactive design and AI-artifact reference with bundled assets/notices. |
| `artifacts/native-ai-pane/`, `artifacts/native-workspace/` | Standalone reference harnesses with saved bundled sample data. |
| `docs/` | Product blueprint, workflow contracts, functionality reference and running checklist. |
| `artifacts/*.md` | Historical verification summaries; underlying local run files are excluded. |

The editor is rebuilt from the pinned Code OSS source. The upstream checkout is not vendored into this repository; bootstrap verifies its recorded commit. Changes to the host live in Foundation's scripts and patches. The current native build targets Apple Silicon macOS. See [desktop host](desktop-host.md) for platform and extension boundaries.

## Clone and run

Use a current Node.js version compatible with the locked dependencies (the desktop build pins its own Node toolchain). Desktop builds require macOS on Apple Silicon, Xcode tooling, and network access to obtain upstream dependencies.

```sh
git clone https://github.com/seanx24x/foundation.git
cd foundation
npm ci
```

For the browser workbench:

```sh
npm run dev
```

This starts the UI on `http://127.0.0.1:4173` and its local API on port 4174. This is a development service for local use. Arbitrary projects support source workflows; the browser sample's runtime capabilities do not imply general desktop/native adapter support.

For the desktop host:

```sh
npm run desktop:bootstrap
npm run desktop:build
npm run desktop:launch
```

Bootstrap downloads the pinned Node runtime, Code OSS checkout and dependencies. Build creates `desktop/.build/Foundation.app` and the generated extension/runtime bundles. Quit an existing Foundation instance before replacing its app bundle. Do not save or discard unrelated drafts to build. The resulting application is ad-hoc signed for local development; notarized distribution and updates remain open work.

For a current local bootstrap, `npm run desktop:bundle` regenerates the extension and preview runtime. Do not commit those generated bundles. Native smoke harnesses require a built app and their documented local tools. Read the relevant workflow guide before running a harness; some explicitly build projects or use Simulator.

## Checks

```sh
npm run check
npm test
npm run build
npm run desktop:check
npm run desktop:test
node scripts/validate-design-system.mjs
```

The desktop TypeScript check uses the bootstrapped Code OSS declarations, so complete desktop bootstrap first. Renderer tests use Playwright Chromium; install it with `npx playwright install chromium` if needed. For browser end-to-end checks, keep `npm run dev` running and run `npm run test:e2e`.

Unit tests, compilation, renderer tests, packaged native acceptance, live-provider acceptance and physical hardware measurements are separate outcomes. Existing verification summaries describe prior runs and their limits, not checks performed by cloning this repository.

## Local files excluded from Git

`.gitignore` excludes dependency caches, downloaded upstream/toolchain trees, generated apps and bundles, project `.foundation/` state, environment files, credentials, screenshots, raw runtime/profile snapshots, logs, benchmark archives, test output and Xcode user/build data. This keeps the repository reproducible and prevents local sessions from becoming source history.

The three standalone references and their bundled license notices are retained, along with readable historical verification summaries. Relative links in those summaries may point to raw evidence retained only on the development machine. A clone contains the test harnesses needed to produce fresh evidence; it does not contain the original machine's complete acceptance archive. No local evidence files are deleted by this repository setup.

Orbit's eight saved source files are the bundled fixture. Native editor backups and unsaved drafts remain outside the repository. No provider keys or AI conversation storage are needed to build the app; configure providers explicitly in Foundation when desired.

## Development and dependencies

Use focused `codex/` branches for subsequent work and update the [product checklist](product-checklist.md) and [functionality reference](functionality.md) when capabilities change. Preserve source and unsaved user state, and keep historical evidence separate from current verification.

Keep dependency lockfiles and the upstream pin in Git. Retain bundled third-party notices; see [iconography and licensing](iconography-and-licensing.md) and [desktop host](desktop-host.md). Foundation-original material now uses the [Source Inspection License](../LICENSE.txt); third-party and separately licensed portions retain their terms. Build/run instructions are for rights holders and separately authorized developers. See the [commercial licensing review](commercial-licensing.md) for remaining legal and application-distribution work. The development history remains private, and public updates use the separate snapshot workflow in [publication](publication.md).
