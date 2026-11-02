# Isolated visual alternatives

M4.01 starts with a bounded comparison: **Saved source** and the current **Proposed change**. Both copies come from the same saved project baseline. Only the proposed copy receives the exact reviewed CSS token replacement. Unsaved editor drafts remain in the original workspace and are not copied.

Review presents one explicit related saved scenario, one app-authored recipe, and shared width, theme and motion requests. Prepare comparison only copies source. Run comparison starts the two instrumented Vite runtimes sequentially. Stop remains available. A failed or uncertain side prevents later sides from running. Captures are optional and off by default. Apply remains a separate source action.

Each comparison owns a separate logical project, immutable full-file manifests, runtime sessions, request observations, callback records and PNG captures. It never replaces the ordinary project's runtime or reuses its evidence stores. Compilation is Not recorded, manual assessment is Not assessed, and source-to-pixels correspondence is Unverified. Shared recipe metadata and requested conditions do not prove equal backend data, local storage, or animation timing.

The macOS execution policy permits writes only inside the owned copy, loopback networking only, and execution of Foundation's shipped Node runtime and the copied esbuild helper. No unrestricted fallback runs. Environment variables are rebuilt without inherited credentials. Reads and access to other localhost services remain possible; this is not a confidentiality boundary or isolated backend environment. Project configuration and recipes must be trusted development code.

Preparation rejects symlinks and special files and excludes repository metadata, credentials, environment files, output and dependency caches. Copies are bounded to 32,768 entries and 512 MiB total. Ordinary files are limited to 16 MiB; regular native dependency binaries have a narrow 32 MiB exception for Vite's bundled tooling. Existing copies are validated again before and after runtime work. Source changes invalidate the comparison.

Four comparisons are retained without automatic eviction. Restart preserves history, seals incomplete work as interrupted, and never restarts a server or replays callbacks. Captured images are read through the owning evidence store and validated against their saved digest before display. Lost storage, stale source, disconnected previews, callback failures and cancelled work remain distinct outcomes.

This first increment does not introduce arbitrary multi-file alternatives, provider-generated alternatives, automatic preference scoring, automatic Apply, native-platform alternatives, or publication. Those remain later capability increments.

## Acceptance

- [x] Prepare creates two matching full-hash copies with one exact token overlay and no source write.
- [x] Run invokes the same recipe under shared requested conditions in two independently owned runtimes.
- [x] Both request and capture evidence identify their own source copy and runtime document.
- [x] Stop, source changes and failed callbacks prevent later dispatch.
- [x] History and images restore in another native process without runtime execution.
- [x] Dark and Light native review remain legible and keyboard operable.
- [x] Normal-profile installation preserves Orbit's saved source, unsaved draft and layout.

Verified for the bounded M4.01 workflow in [Foundation 0.38 evidence](../artifacts/verification-v0.38.md). Broader alternatives and explicit adoption are M4.02. Requested app theme/motion and measured browser preferences remain separate; measured CSS viewport size allows at most one pixel of native scaling rounding.
