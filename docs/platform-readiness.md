# Project Setup — platform readiness

M5.01 introduces an explicit, local readiness check before native platform integration. Readiness checks were verified in Foundation 0.45; current installation status is in the [running checklist](product-checklist.md). [Native and installation verification](../artifacts/verification-v0.45.md).

Open **Foundation: Project Setup** from the command palette or the Foundation navigator. Choose a local workspace folder, then choose **Check setup**. Multiple roots require an explicit folder choice. Opening the page does not run diagnostics. **Cancel** stops owned checks; **Recheck** collects fresh evidence after you address a reported problem.

The screen separates project markers, available tools and Foundation capabilities. Xcode availability does not certify a project build or SwiftUI source mapping. Expo dependency metadata does not certify a working development build. A report describes the selected folder and the inputs checked at that time.

## Boundaries

- Read bounded project manifests and package metadata as data. Never evaluate JavaScript/TypeScript app configuration, package scripts or project build files.
- Use fixed local tool probes with bounded output and time, without a shell, installation, build, Simulator boot, provider request or remote submission.
- Distinguish declared dependency versions from installed metadata. Missing, malformed, inaccessible and unsupported inputs have explicit recovery guidance.
- Invalidate results after relevant project-input changes, unsaved setup-file edits, workspace/trust changes or panel replacement. Recheck is explicit; an old result never becomes current solely because the page reopens.
- Keep editor drafts and Assistant context outside the diagnostic. Project Setup does not choose an AI provider or share project content.

## Platform gates

| Evidence | This increment | Later acceptance |
| --- | --- | --- |
| Project markers | Bounded local discovery and reported limitations | Complete target/scheme/build configuration discovery |
| Apple tools | Selected developer tools, Xcode version, available Simulator device metadata | SwiftUI build/tests, actual preview/Simulator interaction and capture |
| Expo/React Native | Declared/installed package metadata and static configuration presence | Actual iOS development build, runtime connection and supported inspection |
| Source mapping and requests | Native adapters remain unavailable; web workflow has its own verification | Native instrumented mapping/network evidence bound to source and runtime identity |
| Compilation and visual results | Not run by setup diagnostics | Independent build, interaction and visual verification |

The setup-check fixture contains diagnostic metadata only; it is not a runnable SwiftUI or Expo sample. Maintained runnable native fixtures are separate M5.02–M5.05 deliverables.

## Tooling references

Apple distinguishes command-line tools that require the selected full Xcode installation, including `xcodebuild` and `simctl`: [Xcode command-line tool reference](https://developer.apple.com/documentation/xcode/xcode-command-line-tool-reference).

Expo configuration may be static JSON or executable JavaScript/TypeScript: [App configuration](https://docs.expo.dev/workflow/configuration/). This diagnostic reads static inputs only. Native development builds have separate setup requirements: [Set up a development environment](https://docs.expo.dev/get-started/set-up-your-environment/?buildEnv=local&mode=development-build).
