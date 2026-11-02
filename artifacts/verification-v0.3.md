# Foundation 0.3 — native desktop verification

Verified on 27 October 2026 on Apple Silicon macOS 27.0.1.

## Built artifact

`desktop/.build/Foundation.app` is a standalone source-built Code OSS application with the Foundation product overlay and built-in `foundation.foundation-workspace` extension. The native host pin is Code OSS 1.143.1, commit `e646868227c3e3a9e3f24277c8c7220be42c0be7`; the build uses Node 24.18.0 and Electron 43.7.7. Foundation's own version is 0.3.0. The app is about 1.1 GB and carries an ad-hoc signature. `codesign --verify --deep --strict` passes.

The source build completed all editor, extension, native dependency, and packaging stages. Foundation applies a guarded two-anchor patch to omit the unrelated Copilot extension and its packaging shim. Core compatibility metadata remains. Product identity, separate storage paths, icon, Open VSX configuration, notices, and telemetry/update controls are included. Framework symlinks are preserved when copying the application.

## Automated evidence

- `npm run desktop:check`: passed against the pinned upstream VS Code extension API.
- `npm run desktop:test`: 17 tests passed, zero skipped or failed. Includes product identity, pinned provenance, upstream patch behavior and drift rejection, packaged resources, AI transport bounds/authentication, safe source paths, four credential-access regression checks, and the webview harness.
- The webview harness uses actual Orbit project-service snapshots and strict CSP. It checks all four activities at 1280, 700, and 360 px in both themes: 24 combinations without horizontal overflow. It also checks navigation, explicit revision context, dirty-file gating, cancellation, stale evidence, safe model text, keyboard focus, native diff actions, and recovery states.
- `npm run desktop:smoke`: 10 native checks passed in the packaged app, with exit code 0. An isolated temporary repository and user profile were used. The checks cover built-in activation, registered commands, real TypeScript symbols, native source navigation, native edit/save, exact before/current session diff, four Foundation surfaces, both themes, native Git repository discovery, and a terminal shell process. Opening the surfaces produced zero requests to an instrumented local provider.
- `git diff --check`: passed.

The native smoke report is retained as `artifacts/native-smoke-v0.3.json`. The HTML harness screenshots are generated under `desktop/tests/artifacts/`.

## Actual desktop presentation

Opened Foundation on the included Orbit project and inspected the actual macOS window using accessibility and a screenshot. The real `SaveButton.tsx` source editor, Foundation icon and theme, file explorer, keyboard command, and adjacent Foundation panel are present. The user approved trust for the bundled Orbit folder only, and the trust manager showed that exact folder. The user separately approved Foundation access to Documents. After renewing the Documents switch in System Settings, macOS reported Allowed (User Consent), the blocked filesystem operations cleared, and the normal LaunchServices launch indexed all 8 Orbit files. The Understand panel showed SaveButton, its exported source outline, and its ProfileForm consumer. No other projects were trusted and no user settings from Cursor or VS Code were migrated.

## Startup recovery

Disconnected AI previously requested SecretStorage during activation, causing an unnecessary Keychain authorization stall. Provider destination validation now precedes any credential read. Missing or invalid configuration never requests secure storage, and environment-only providers are self-contained, including keyless local providers. Application-configured providers retain native stored-key precedence. No Keychain access was approved or plaintext credential fallback introduced. The UI and local source intelligence were verified in the normal profile with AI disconnected.

Build and extension-refresh scripts now refuse to replace or re-sign a running Foundation app. Refresh instructions require quit, refresh, then relaunch. The final extension bundle was installed with Foundation stopped and passed strict deep signature verification. All 17 desktop tests and all 10 native smoke checks were rerun successfully after the startup changes. The isolated smoke profile proves packaged functionality; the separate normal-profile UI check proves Orbit opened with its actual macOS folder permission.

## Boundaries

This is a local desktop alpha. It is not Developer-ID signed, notarized, published, or configured for automatic releases. A commercial AI provider has not been connected or billed; the provider-backed streaming service was tested with local instrumentation and remains configurable in the app. Desktop AI currently answers source questions; isolated code-writing agents are a later increment.

The desktop Refine panel exposes source tokens and source navigation. General live runtime mapping, preview editing, API trace capture, SwiftUI/Simulator, and Expo adapters remain separate engineering work. The existing browser fixture still supplies its bounded instrumented workflow. Native debugging extensions are packaged, but a real breakpoint session and third-party extension compatibility have not been verified in this increment.

Upstream dependency installation reported 37 audit advisories (4 low, 18 moderate, 14 high, 1 critical); this untriaged development dependency report is not a runtime exposure assessment. Dependency/security triage belongs to the distribution gate; no speculative dependency upgrades were applied to the pinned host.

All implementation is in the dedicated Foundation project. The resource library, portfolio projects, and existing walkthrough fixture were not changed by the desktop increment.
