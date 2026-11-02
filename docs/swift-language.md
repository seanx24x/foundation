# Swift editor intelligence

Foundation 0.47 connects the native editor to the selected Xcode toolchain’s SourceKit-LSP. This is M5.02b: completion, definition navigation, hover and diagnostics for one explicitly selected target. Native and installation acceptance passed. [Verification](../artifacts/verification-v0.47.md).

## Connect and edit

1. Open a trusted folder containing a supported Xcode project, then open **Foundation: Xcode Project**.
2. Choose **Discover project**, a shared scheme and an iOS Simulator destination. A generic Simulator destination is sufficient for editor preparation; it does not launch a Simulator.
3. Save project files, then choose **Build and connect Swift**. This explicitly builds the scheme and reads the actual Swift compiler invocations. Builds execute trusted project code, including any project build scripts.
4. Choose the target and architecture in **Choose Swift target**. Foundation validates its source membership, SDK, toolchain and compiler settings before starting the local language service.
5. Edit the target’s Swift files. Completion uses the native suggestion menu; Tab accepts and native Undo reverses the edit. **Go to Definition** follows supported target-local source locations. Hover and Problems use the same selected compiler context. Unsaved Swift edits are synchronized locally without saving the file or sending it to an AI provider.
6. Choose **Disconnect Swift**, or run **Foundation: Disconnect Swift**. A connection in preparation has **Cancel connection**. Foundation stops its owned process, clears its diagnostics and removes the private compilation database.

Closing the Xcode Project tab leaves an established language connection available for editing. Restarting Foundation always starts disconnected. Reconnecting requires a new explicit build and target selection; no hidden discovery, build, language server or provider request runs on startup.

## Source and result ownership

The selected Xcode build supplies compiler arguments, SDK, module, target triple, architecture and target source paths. Foundation expands only the owned Swift file list into a private `compile_commands.json`; it does not guess flags, rewrite project settings, add configuration inside the repository or select a target based on a file name.

The configuration records the project, scheme, destination, successful build, saved-source revision, settings fingerprint and toolchain identity. Project settings or source membership changes retire the connection. Ordinary edits to an existing Swift file remain connected. Build/test evidence still becomes historical when source changes; disconnect, save and rediscover before another explicit Xcode build.

Every request is bound to a language session, source URI, document version and target-context generation. Editing, opening or closing a target member cancels pending document requests and refreshes diagnostics across all open target files. Saved dependency changes do the same. Late completion and diagnostics cannot replace the current context. Diagnostic pushes are discarded because a document version alone cannot establish dependency freshness; explicit diagnostic pulls establish both document and target context. Old diagnostics clear on edit, and a failed refresh reports unavailable rather than a clean result. Native editor cancellation retires the corresponding protocol request.

Only target members receive language requests. Definition results are bounded to that same set. Completion provides bounded insertions/snippets and validated replacement ranges; arbitrary commands and additional edits are not applied. Hover Markdown is untrusted and cannot run commands. Other projects, unrelated drafts and non-Swift editing remain independent.

## Supported boundary and recovery

The maintained [SwiftUI fixture](../fixtures/swiftui/README.md) is the acceptance target. Current support is deliberately bounded to self-contained iOS Simulator targets using an Xcode toolchain and compiler invocations that Foundation can validate. Swift packages, explicitly loaded compiler plugins, generated or external Swift sources outside the selected folder, and unsupported external settings return an unavailable result. Broader project compatibility remains open.

Initial connection needs a successful build. If source or project settings change during preparation, Foundation cancels and asks for rediscovery. Failed builds retain bounded diagnostic output in **Swift build context**. A crashed or stopped language server clears its session and diagnostics and requires explicit reconnection. A source file that exceeds supported limits cannot silently fall back to guessed settings.

Preparation uses the existing [bounded Xcode operations](xcode-projects.md). Language requests have finite deadlines and pending-request limits. Documents are limited to 8 MiB, protocol messages to 16 MiB, and output backpressure is bounded. The selected language process receives a private home/config workspace. Its compilation database is removed on normal disconnect; retained build evidence and cleanup after abrupt host termination belong to the later storage lifecycle work.

A successful editor connection does not prove SwiftUI preview, app launch, visual behavior, element mapping, network observation or AI activity. Those remain separate acceptance gates. Physical keyboard-to-display latency also remains separate from automated native input tests.

## Implementation

- `desktop/extension/src/xcode-language-settings.mjs`: actual compiler settings, fingerprints, private compilation database and provenance.
- `desktop/extension/src/swift-language-client.mjs`: bounded LSP transport, owned process lifetime, versioned document synchronization and cancellation.
- `desktop/extension/src/swift-language-controller.ts`: native editor providers, diagnostic collection, document lifecycle and explicit connection.
- `desktop/extension/src/xcode-project-controller.ts`: selected project context and connection controls.
- `npm run desktop:swift-language-smoke`: isolated signed-app acceptance against a copied fixture. It never uses the normal Orbit profile.

SourceKit documents its supported build-system integration and configuration: [SourceKit-LSP](https://github.com/swiftlang/sourcekit-lsp/blob/main/README.md), [configuration](https://github.com/swiftlang/sourcekit-lsp/blob/main/Documentation/Configuration%20File.md). The production client is verified against the installed Xcode toolchain; protocol availability alone is not native editor acceptance.
