# Feature relationships — Foundation 0.14

The Relationships section in Understand follows saved source from the active feature. Begin with its primary file, choose another feature file, or use **Explore** beside a connection to follow related indexed source. **Back** follows your exploration trail; **Reset** returns to the primary file, or the first member when no primary is set. Exploration leaves feature membership and Assistant context unchanged.

## Read and follow evidence

The focused view groups component renders, calls, type references, imports and re-exports, styles, consumers, test references and request sites. A row opens the supporting source location. Its definition control opens the resolved declaration or module; Explore changes the relationship source without opening an editor. Controls expose their destination through accessible names and work with the keyboard.

Connections are labeled **From source**. TypeScript's syntax and symbol resolution operate over safely indexed local files. Relative imports and explicit re-exports are resolved within that inventory. Calls resolve named declarations and direct local function values; shadowing, reassignment and ambiguous exports withhold unjustified targets. A test reference means a recognized test file references this source through an import or supported local binding. It does not establish coverage or a passing result. Filename-only **Possible tests** remain separate and can be explored without being treated as proven references.

Request sites describe direct, unshadowed `fetch` expressions. Literal methods and URLs are shown when available; dynamic values remain unknown. Credentials, query strings and fragments are removed. These are code locations, not observed network activity, causal traces or evidence of backend behavior. Runtime observations remain in the separate connected-runtime workflow.

## Freshness and recovery

Each result includes the source revision of every safely read indexed text file, and every edge retains its source and target locations. Saved edits, new or deleted consumers and ignore-rule changes invalidate the result. Refresh rebuilds the focused view. Unsupported code, unresolved targets, parser failures and bounded-analysis limits are disclosed rather than filled in by inference.

Before exact navigation, the host rechecks the complete saved-source inventory and revisions, the affected native buffers, workspace trust, project, feature revision, current graph and user focus. A newer navigation or focus change supersedes pending work. Affected unsaved files disable exact evidence links; you can still Explore their saved source. Unrelated drafts remain usable and untouched.

The view retains a bounded source trail across restart for the same project and feature. Only source paths and feature identity are stored. Evidence is rebuilt in the new process, with a new snapshot identifier. Invalid, missing or foreign trail metadata falls back to the primary source. Storage failures keep the current exploration usable and disclose that its location could not be saved.

## Boundaries

This is a focused JavaScript/TypeScript source explorer, not a complete call graph. It does not execute project scripts, compiler plugins, configuration files or package code. Package dependencies, path aliases, dynamic dispatch, framework-specific runtime ownership, reflective calls and uninstrumented server behavior remain unresolved. SwiftUI and React Native capability gates remain separate.

Analysis uses the existing project inventory limits (1,500 files and 8 MiB), with at most 200 edges, 100 requests, 24 filename candidates and 100 boundary entries. Sources beyond 50,000 syntax nodes or nesting depth 128 are withheld. Results expose truncation. Indexing and analysis are local; no provider or runtime starts through exploration.

## Verification

- `npm test` includes source-analysis truth, safe reads, cancellation, ignored/symlink boundaries and full-manifest invalidation.
- `npm run desktop:test` includes ownership, dirty buffers, source and focus races, location-only restart metadata, keyboard controls, both themes and narrow layouts.
- `npm run desktop:relationships-smoke` exercises actual controls in a packaged app using a disposable normal extension/profile and project. It verifies exact locations, exploration, dirty/stale recovery and preservation of an unrelated draft and original fixture source.
- `npm run desktop:restart-smoke` independently checks the native two-process layout and unsent Assistant regression.

Installed-app acceptance and these automated checks are recorded separately in [0.14 verification](../artifacts/verification-v0.14.md). The [running checklist](product-checklist.md) retains broader performance, AI, runtime and platform gates.
