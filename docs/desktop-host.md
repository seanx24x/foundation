# Foundation desktop host

Foundation's desktop host is a source build of Microsoft's MIT-licensed Code OSS repository with a small Foundation product overlay and a built-in Foundation Workspace extension. The existing browser workbench remains a separate feasibility surface. The desktop host supplies the native editor, language services, file explorer, terminals, debugging, source control, settings, command palette, and extension host.

## Current installed increment

Foundation 0.47 adds local Swift editor intelligence from actual selected Xcode compiler settings. Native completion, navigation, hover, dirty diagnostics and cross-file recovery, stop/reconnect and disconnected restart are verified. All 37 installed payloads match the signed tested candidate; normal Orbit source, unsaved draft, layout and Assistant context are preserved. This remains an ad-hoc signed local build. [Current checklist](product-checklist.md) · [Verification](../artifacts/verification-v0.47.md) · [Workflow](swift-language.md).

## Provenance and build boundary

The initial macOS Apple Silicon build is pinned to Code OSS tag `1.143.1`, commit `e646868227c3e3a9e3f24277c8c7220be42c0be7`. Its `.nvmrc` specifies Node `24.18.0`; its `.npmrc` targets Electron `43.7.7`. Keep these requirements paired with the upstream lockfile. Node used to compile native dependencies must match the upstream build's supported toolchain; a globally installed newer Node is not a substitute for this pin.

The host is built from the upstream source checkout. Electron itself and platform-specific runtime dependencies are upstream binary dependencies, as in Code OSS's normal build. The build does not extract the application from an installed Microsoft VS Code, Cursor, or VSCodium distribution.

The product overlay must give Foundation its own application name, URL protocol, bundle identifier, data directories, extension directories, icon, and update identity. Preserve upstream `LICENSE.txt`, `ThirdPartyNotices.txt`, and applicable dependency notices. A locally ad-hoc-signed application is a development milestone; Developer ID signing, notarization, installer packaging, update hosting, and release testing are separate work.

## Source build workflow

The Foundation wrapper scripts are the supported entry points:

```sh
npm run desktop:bootstrap
npm run desktop:check
npm run desktop:build
npm run desktop:test
npm run desktop:smoke
npm run desktop:launch
```

`desktop/upstream.json` records the immutable upstream and toolchain pin. `desktop/product.json` is the product overlay, applied by `desktop/scripts/brand.mjs`. `desktop/scripts/bootstrap.mjs`, `build.mjs`, and `launch.mjs` implement the corresponding commands. `desktop:check` type-checks the Foundation extension. The finished application is `desktop/.build/Foundation.app`.

For extension verification against saved source, quit Foundation normally, then run `npm run desktop:dev -- /absolute/project/folder` (Orbit is the default). This bundles the canonical `desktop/extension` outside the app and uses Code OSS’s development-extension override without changing the app bundle or signature. It does not override the normal profile or trust configuration. The launcher validates the pinned host and startup patches, refuses arbitrary extension paths/flags, and requires the app to be stopped so Launch Services cannot silently ignore the new arguments. This is development acceptance, not evidence that the bundled release extension contains those edits.

**Development windows do not restore ordinary unsaved drafts.** The pinned Code OSS host deliberately skips disk-backup registration for extension-development windows (`windowsMainService.ts`, `doOpenInBrowserWindow`); their working-copy backup service therefore uses memory-only storage. Unsaved edits made in that window can be lost when it closes. The launcher prints this limitation before opening. For verification with an existing draft, leave the saved source unchanged, quit the development window normally, and run `npm run desktop:launch -- /absolute/project/folder` to return to the ordinary window and its original draft backup. Never save or discard that original draft merely to switch verification modes, and do not copy private backup files into the development window. This workflow requires separate visible verification that the normal window restored the draft.

`desktop:bundle` only rebuilds the external extension. For a packaged extension update, quit Foundation before `desktop:refresh`. It compares all packaged extension assets and stable provenance; identical builds only verify the existing signature and preserve the timestamp. Changed builds are installed and signed as before. Both build and refresh refuse to replace a running application. `desktop:launch` continues to open the packaged extension.

The native host reports its Code OSS compatibility version, `1.143.1`. Foundation's independent product version from the root package manifest is recorded in `Contents/Resources/foundation-build.json` with the host pin, architecture, patch list, AI host, and signature type. These versions describe different parts of the same artifact.

The underlying Code OSS steps are useful when diagnosing a build:

1. Check out the pinned upstream tag and verify the full commit.
2. Activate the exact Node version from `.nvmrc` and install from the pinned package lock. The upstream install compiles native dependencies for the Electron version in `.npmrc`.
3. Apply Foundation's product overlay and application icon; build and include the Foundation Workspace extension.
4. From the upstream checkout, run `npm run gulp vscode-darwin-arm64`.
5. Locate the resulting application at the sibling `VSCode-darwin-arm64/Foundation.app` directory. The Foundation build script copies it to `desktop/.build/Foundation.app`, installs the built-in Foundation extension, records build provenance, and applies and verifies an ad-hoc signature. Validate packaged resources before launching it.

At this upstream revision, the non-minified desktop task compiles built-in extensions, compiles extension media, bundles the workbench directly with esbuild, packages native extensions and production dependencies, and assembles the Electron application. It does not require a preceding `npm run compile` or an obsolete `compile-build` task. The `vscode-darwin-arm64-ci` task expects already-produced `out-vscode` output and is not a cold-build command. `vscode-darwin-arm64-min` adds minification; local builds retain local source maps unless CI settings request CDN maps.

Foundation deliberately omits the separate built-in Copilot extension. `desktop/scripts/patch-upstream.mjs` guards its dedicated compilation and post-package SDK shim steps in `build/gulpfile.vscode.ts`; the wrapper sets `FOUNDATION_WITHOUT_COPILOT=1`. Generic extension packaging already excludes this extension. The patch starts from the pinned original file, requires each expected anchor exactly once, and stops if upstream changes. Core dependencies and required product metadata remain intact. This is an explicit product boundary, not suppression of a failing build: the first unpatched source build exposed an upstream local-package defect where the Copilot SDK was stripped before its shim step. The guarded build must complete successfully, and the artifact test requires the unwanted extension to be absent.

Foundation also defers the default account provider's eager GitHub discovery while that provider is unregistered. Code OSS otherwise activates GitHub authentication during startup even with its AI interface disabled. The guarded `on-demand-default-account` patch leaves explicit sign-in, extension authentication APIs, account/session listeners, cached policy handling, and credential encryption intact. It changes only initial account discovery for Foundation. The accompanying `on-demand-speech-account` patch defers the speech service's initial GitHub session probe under the same condition, retaining its session listeners, entitlement checks, and explicit token acquisition. A full `desktop:build` is required for this core patch; `desktop:refresh` refuses hosts missing either compiled marker so extension provenance cannot claim an unapplied patch.

Local ad-hoc signatures change when the application is rebuilt. macOS may therefore ask again for previously granted Documents access. Renew only the intended application permission in System Settings; do not grant Full Disk Access or weaken the code-signing requirement to avoid this development limitation. Stable Developer ID signing is part of the distribution milestone. Opening a local project without authenticated integrations and with Foundation AI disconnected should not require a GitHub sign-in or Keychain access; choosing a provider credential or a platform sign-in remains a separate action.

For workbench development, `npm run build-fast` produces the `out` development tree and `npm run electron` prepares the Electron runtime; `scripts/code.sh` launches it. This is a development checkout launch, not a self-contained distributable application. Development transpilation does not establish a successful type check. Use targeted validation for Foundation changes and upstream's required type checks for cross-cutting host patches.

Build scripts are revision-specific. The source of truth for this pin is [`build/gulpfile.vscode.ts`](https://github.com/microsoft/vscode/blob/1.143.1/build/gulpfile.vscode.ts), alongside the [upstream contribution guide](https://github.com/microsoft/vscode/wiki/How-to-Contribute). Re-audit their task graph on an upstream update instead of assuming old commands remain equivalent.

## Extension acquisition and compatibility

Foundation uses the Open VSX registry adapter for user-installed extensions. The product configuration follows the [Open VSX integration instructions](https://github.com/eclipse-openvsx/openvsx/wiki/Using-Open-VSX-in-VS-Code):

```json
{
  "extensionsGallery": {
    "serviceUrl": "https://open-vsx.org/vscode/gallery",
    "itemUrl": "https://open-vsx.org/vscode/item",
    "resourceUrlTemplate": "https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}",
    "extensionUrlTemplate": "https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest"
  }
}
```

The gallery setting also affects upstream's acquisition of its three externally packaged debug/profile extensions. Their pinned versions and SHA-256 hashes are tied to the original release assets. Foundation must obtain those assets from the pinned official GitHub releases, or explicitly pin matching local VSIX files, before gallery configuration can redirect their downloads. Do not resolve a checksum mismatch by discarding the hash or substituting an unreviewed latest release.

Open VSX availability does not prove that every extension works or can be redistributed. Extensions using proposed APIs, native binaries, Microsoft services, or product checks need individual validation. Preserve publisher package terms and describe unsupported capabilities directly. Microsoft's [Code OSS and Marketplace guidance](https://code.visualstudio.com/docs/supporting/faq) distinguishes the open source repository from the Microsoft-branded distribution.

Upstream `1.143.1` contains built-in Copilot source and expects `defaultChatAgent` metadata in core extension-management paths. Removing that object can break unrelated extension operations even when the extension is absent. Foundation keeps required compatibility metadata, omits the built-in Copilot extension, disables the upstream Copilot interface by default through `chat.disableAIFeatures`, and uses its independent provider configuration for Foundation AI. The desktop milestone does not promise access to any GitHub or Microsoft subscription service.

## Foundation integration

Foundation-specific behavior belongs in the built-in `foundation.foundation-workspace` extension where the stable extension API can support it. Native editors remain authoritative. Source context follows the active file and selection; navigation opens a native editor at the referenced location. Understand, Build, Refine, and Review commands are available through the command palette as well as the Foundation interface.

Foundation places Assistant in a native secondary-sidebar webview. The central workspace retains Understand, Refine and Review; Build returns to the native source editor. **⌘⌥A** toggles the Assistant, while **Open Assistant** opens or focuses it. Native divider resizing and workspace visibility persist through the host. See [Assistant sidebar](assistant-sidebar.md) for lifecycle and sizing boundaries.

The extension's local intelligence reuses Foundation's source-analysis services. The AI bridge uses explicitly configured provider settings and platform credential storage. Ask explains selected saved source; Propose change prepares a validated edit to one selected existing file. Both disclose context, support cancellation, and label model output as interpretation. The model cannot write files or run commands. Workspace trust gates repository analysis, preview compilation, and AI; ordinary Code OSS editing remains available in restricted mode.

Review uses native diffs for session saves and for AI/design proposals. The latest proposal and its guarded Apply/Undo checkpoint are persisted locally in Foundation's workspace storage, including before/after source and revision context; ordinary save tracking remains session-based. Apply checks source and selected context freshness, workspace trust, and native drafts. Undo refuses to overwrite a later edit. A diff does not establish successful compilation, interaction, or appearance.

Foundation 0.4 also provides a React design sandbox built from the last saved client source, with measured inspection of explicitly annotated elements, viewport/theme controls, and temporary CSS token experiments. Unsaved editor drafts remain intact and are labeled as excluded from the preview. Network access and project-script execution are disabled. The sandbox's transpilation and render acknowledgements remain separate from full project builds and verification of a running target. See [AI and design tools](ai-design-tools.md) for the Orbit workflow, supported modules, exact source-change scope, and recovery paths.

| Capability | Current desktop boundary |
| --- | --- |
| Native editing, file navigation, terminal, Git, debugging | Supplied by the source-built Code OSS host; exercise each in the packaged application. |
| Source understanding | Local source evidence and navigation through the Foundation extension; runtime behavior is not inferred as observed. |
| AI assistance | User-configured source questions and single-file proposals against disclosed saved context, with cancellation and explicit disconnected/error states; no model command or filesystem tools. |
| Review | Native diffs, session save tracking, and a locally persisted latest proposal/checkpoint with guarded Apply/Undo; acceptance is distinct from commit, publication, deployment, and verification. |
| Interface refinement | Saved-source React sandbox, measured explicit source annotations, viewport/theme controls, CSS token experiments, and scoped token proposals. General DOM editing and arbitrary running-app attachment are not implemented. |
| Running-target mapping, request capture, visual comparison | Instrumented local web targets support source mapping, sanitized request evidence, manual observations and explicit native canvas PNGs. Saved pairs restore with exact source/runtime bindings and verified local image bytes. Source-to-pixel compilation, automatic replay/scoring and general platform adapters remain unverified or future work. See [visual captures](visual-captures.md). |
| SwiftUI, Simulator, React Native, Expo | Future validated adapters. Native source editing alone does not establish preview or runtime instrumentation. |

## Defaults and local data

Core telemetry is disabled with product `enableTelemetry: false`. Application-scoped telemetry and update settings cannot be overridden by an extension contribution; Foundation uses the product controls instead. An absent upstream update URL disables Microsoft's automatic update service. Foundation defaults belong in the built-in extension's `configurationDefaults` contribution; the native product configuration has no general-purpose `configurationDefaults` field at this revision. User settings should remain editable and should not be overwritten on every launch.

Foundation uses application identity `design.foundation.ide`, local extension storage `.foundation-ide`, and separate shared/server data directories. The project service's per-project `.foundation` directory has a different purpose and is not the editor's global data directory. Foundation must not share or migrate VS Code, Cursor, or prototype credentials silently. The provider endpoint is an application-scoped setting; workspace files must not redirect a saved provider credential to a different host. Any future update service needs its own signing, provenance, rollback, and release channel design.

## Verification and maintenance

Record source revision, Foundation revision, Node and Electron versions, build command, platform, and output application identity with each artifact. Keep build success, packaged resource checks, extension activation, native interaction, and visual acceptance as separate results. Missing evidence stays unverified.

`desktop/tests/branding.test.mjs` checks product identity, isolated storage, the upstream/runtime pin, preserved compatibility metadata and notices, telemetry/update defaults, and Open VSX configuration. Its artifact check runs when the default built app exists; an explicit `FOUNDATION_APP_PATH` requires that artifact to exist and verifies its native executable, bundled workbench, language/Git extensions, and Foundation extension. A skipped artifact check is not a passed package check.

After packaging, run `npm run desktop:smoke`. It opens a separate Extension Development Host against the actual packaged application with a temporary repository, settings profile, and extension directory. It exercises Foundation activation and commands, native TypeScript symbols, source navigation, saving and session diffs, both themes, Git discovery, a real terminal process, saved-source preview compilation, and token proposal Apply/Undo with draft and duplicate-apply guards. A local recording provider verifies that browsing source and opening the Assistant do not trigger a request. Extension logs also verify that ordinary startup leaves platform authentication providers dormant. The test module is copied into the temporary harness, so loading the test itself does not require access to the project source folder. Use `npm run desktop:smoke -- --development` to exercise the canonical external extension instead. Both modes assert the actual loaded extension path. Development results are written separately to `desktop/.build/development-smoke-report.json`, leaving packaged acceptance intact. The script preserves its disposable fixture/log path and writes `desktop/.build/native-smoke-report.json`. It does not use the user's projects, application settings, or provider credentials. `FOUNDATION_APP_PATH` can select a different local build.

For the first application, inspect the real packaged window and exercise: opening a folder; editing and saving a file; symbol navigation; a working terminal; Source Control; the Foundation source inspector; a source link; a native diff; provider setup/cancellation; a light/dark theme switch; and restart recovery. Inspect runtime logs for activation failures. Open VSX search and a representative install should be checked separately from the presence of registry URLs in `product.json`.

On each upstream update:

1. Pin the new tag, commit, runtime versions, and dependency lockfiles; retain the last known working pin.
2. Review upstream release notes, build changes, extension API changes, and the Foundation patch set.
3. Reapply only documented product/configuration patches and build the Foundation extension against the new API.
4. Recheck bundled extension versions, hashes, notices, and required extension compatibility.
5. Build from a clean checkout, run branding/integration tests, and repeat the native workflows above.
6. Advance the application only after source, runtime, and visual evidence is recorded; signing and distribution follow their own gate.

Keep the fork small. A host patch should name the extension API limitation that required it, the invariant it changes, a targeted test, and its removal path if upstream later exposes the needed capability.

## Startup diagnostics

In a development build, run **Foundation: Show Startup Diagnostics** from the command palette. The local Foundation Output channel records fixed operation names, timestamps, IDs, durations and success/failure for project opening, saved-source reads and preview preparation/compilation. It does not record source, file paths, credentials, provider destinations or error details. Logging failures cannot alter operation results or error identity. A start without a finish identifies the last instrumented operation reached; it does not prove that operation caused an extension-host stall.

On October 28, the Documents-backed Orbit window recovered after the Mac was unlocked. The native preview and Save selection then passed across Understand and Refine on the final packaged 0.6 build. Earlier process samples showed a synchronous filesystem open blocked in the extension host; the exact file and caller remain unknown. Permission churn from changing ad-hoc signatures is a separate established risk. The development launch avoids changing that signature, without changing macOS permissions or disabling security controls. Stable release signing remains future distribution work.
