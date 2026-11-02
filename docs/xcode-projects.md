# Xcode projects — explicit build and test

Foundation 0.46 adds an Xcode Project editor tab. This is the M5.02a build/test slice, verified in 0.46. Native editor language intelligence is now verified separately in [0.47](swift-language.md). [Native and installation verification](../artifacts/verification-v0.46.md).

## Workflow

1. Open the folder containing a self-contained Xcode project or workspace.
2. Run **Foundation: Xcode Project** from the command palette or navigator. Opening the view starts no discovery, tool process, build or test.
3. Choose **Discover project**. Select the project, shared scheme and iOS Simulator destination using native pickers. Discovery asks Xcode to evaluate settings; it does not start a build or test.
4. Choose **Build** to compile, or **Run tests** to execute the scheme’s test action. Their results remain separate. A generic Simulator destination supports compilation only; tests require a specific eligible Simulator.
5. Inspect the operation’s output, exit code, source fingerprint and local result location. Fix reported problems and retry explicitly. **Cancel** stops the owned Xcode process group and waits for cleanup before another operation.

Builds execute trusted project code, including project build scripts. A separate output directory protects against output collisions; this is not a sandbox for project scripts. Tests may start the explicitly selected Simulator. Foundation does not install runtimes, select a physical device, enable signing or resolve Swift packages in this increment.

## Evidence and recovery

- Discovery and execution are bound to the selected local root, project, scheme, destination and saved-source fingerprint. A catalog cannot be replayed from serialized state or used after its target fields change.
- Unsaved project files block execution. Saved or unsaved input changes invalidate prior results and cancel in-flight work. Foundation does not save or discard drafts. Drafts outside the selected project remain independent.
- Build success, test success, language tooling, preview, application interaction, source mapping and runtime requests are distinct claims. SourceKit-LSP availability alone does not establish completion, navigation or diagnostics in Foundation’s editor.
- Results show passed, failed, cancelled, timed out, output limit, unavailable or changed-source outcomes. Earlier results become historical when source changes. A failure never becomes a pass because a later tool check succeeds.
- Changing the destination clears the displayed results. Rediscovery requires an explicit choice of project, scheme and destination. Reloading, closing or restarting does not automatically resume project evaluation or execution.
- Workspace trust, removed folders, panel replacement and view ownership retire queued work. Cancelled native picker choices start no subsequent operation.

## Initial supported boundary

The maintained [SwiftUI fixture](../fixtures/swiftui/README.md) has an iOS app and seven deterministic XCTest tests for profile save state, errors, retry and cancellation. It uses no external dependencies or build scripts.

Discovery bounds saved input to 4,096 entries, 16 directory levels, 8 MiB per file and 64 MiB total. Linked or special files, unresolved external/grouped workspace references, cross-project references and Swift package dependencies produce an actionable unsupported result. Internal Xcode workspaces, user-specific settings, caches and build output are excluded. External SDKs, compiler state and external file references are outside the source fingerprint. Broader dependency and project compatibility remains open.

Xcode receives fixed arguments without a shell, signing disabled and automatic package resolution/update disabled. Project discovery has bounded deadlines; builds are limited to three minutes and tests to four minutes, with two MiB of captured output per operation. The interface displays the last 32,768 characters of output. Derived data and `.xcresult` paths are unique local temporary directories. Retained history and storage lifecycle belong to later work.

## References

Apple documents schemes and run destinations independently: [Build and run your app](https://help.apple.com/xcode/mac/current/en.lproj/devdc0193470.html). Command-line test results can be preserved in result bundles: [View and share test results](https://help.apple.com/xcode/mac/current/en.lproj/devc38fc7392.html). Swift’s language server and editor integration have separate setup requirements: [SourceKit-LSP](https://github.com/swiftlang/sourcekit-lsp/blob/main/README.md).
