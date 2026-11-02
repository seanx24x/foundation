# Foundation Orbit — SwiftUI fixture

A maintained iOS app for Foundation's Xcode integration. Open `FoundationOrbit.xcodeproj` and select the shared **FoundationOrbit** scheme. The app uses SwiftUI and requires iOS 18 or later. It has no third-party packages, network service, developer-team requirement or signing configuration.

## What it proves

- A real SwiftUI app compiles for iOS Simulator.
- The shared scheme exposes an app target and the hostless `FoundationOrbitTests` XCTest target.
- Seven model tests cover loading, successful completion, error and retry, duplicate-save suppression, cancellation, stale completion, empty-name validation and the submitted name snapshot. The test target compiles the exact same `ProfileStore.swift` file as the app.
- Simulator app interaction, visual capture, runtime/source mapping and request evidence require separate acceptance. A successful build or model test is not that evidence.

The profile screen provides idle, saving, success and error states. **Simulate unavailable service** selects a reproducible local error; turning it off permits retry. **Cancel** returns to idle and retires the old attempt. Saving uses a short local delay. It never sends profile data or creates an API observation.

## Reproduce a build

Run from this directory with a full Xcode installation selected. Use a fresh output directory so earlier results cannot be mistaken for this run:

```sh
fixture_output=$(mktemp -d /private/tmp/foundation-swiftui-check.XXXXXX)
xcodebuild -project FoundationOrbit.xcodeproj -scheme FoundationOrbit \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$fixture_output/DerivedData" \
  -resultBundlePath "$fixture_output/build.xcresult" \
  -disableAutomaticPackageResolution -onlyUsePackageVersionsFromResolvedFile \
  -skipPackageUpdates CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= build
```

## Reproduce the tests

An installed, available iOS Simulator runtime is required. List available devices with `xcrun simctl list devices available`; select an intended test device explicitly. Prefer a dedicated disposable Simulator, since Xcode may boot the selected device. Replace `SIMULATOR_UDID` with its identifier, and retain the output directory from the build step:

```sh
xcodebuild -project FoundationOrbit.xcodeproj -scheme FoundationOrbit \
  -configuration Debug -destination 'platform=iOS Simulator,id=SIMULATOR_UDID' \
  -destination-timeout 30 -parallel-testing-enabled NO \
  -derivedDataPath "$fixture_output/DerivedData" \
  -resultBundlePath "$fixture_output/test.xcresult" \
  -disableAutomaticPackageResolution -onlyUsePackageVersionsFromResolvedFile \
  -skipPackageUpdates CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= test
```

If the destination is unavailable, choose an installed runtime/device and rerun explicitly. Do not treat missing runtime support, a timeout, cancellation or a failed tool as a passing test. Tests have no physical-device or backend requirement.

## Source and tooling boundaries

The project, shared scheme and internal workspace are checked in. Build output belongs outside the fixture. No generated project, external dependency resolution, run-script build phase, scheme pre/post-action, package plugin or signing identity is required.

Xcode's SourceKit-LSP can be discovered using `xcrun --find sourcekit-lsp`. Its ability to initialize and return symbols is separate from Foundation editor integration, accurate target build settings, completion, navigation and diagnostics; those capabilities require their own verification.
