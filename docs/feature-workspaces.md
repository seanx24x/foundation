# Feature workspaces

A feature workspace keeps a named task brief and a chosen set of source files together. It is stored locally for the current project and survives a normal Foundation restart. Creating it does not create a branch, modify source or start an AI request. Named runtime screens and scenarios can be connected separately.

## Create and refine a working set

In Understand, choose **New feature**, enter a title and optional brief, add project files, and choose an optional **Primary file**. Save the feature when the set is ready. You can also use the **Foundation: New Feature** command to start with the current source file.

The primary file anchors suggestions and can be opened directly through **Foundation: Open Feature Primary File**. It is a source entry point for your work, not a claim that Foundation has identified the feature's runtime boundary.

The [Relationships explorer](feature-relationships.md) follows renders, calls, types, styles, consumers, test references and request sites from saved source. Exploring or opening evidence does not add files to the feature.

**Related source** suggestions come from resolved imports and known direct consumers. **Possible tests** are filename matches; they do not establish coverage or a passing test result. Adding a suggestion changes the feature draft. Save to make that membership durable.

Edits remain drafts until saved. If a saved version changes while you are editing, Foundation preserves the draft and asks you to reload the saved feature before continuing. Source files themselves are unaffected by feature metadata changes.

## Use the feature with Assistant

Choose **Use in Assistant** to open the right-hand Assistant and prepare available saved files for its context selection. Review that selection before sending. Preparation skips unsaved source drafts and does not send a request.

The **Include task brief** control separately determines whether the saved feature title and brief accompany a request. Source files and runtime observations remain distinct context choices. Save or discard an unsaved feature draft before sending its task context. Once sent, the request retains its original task brief and feature revision for historical review.

Selecting a feature never starts a provider or runtime. You can continue coding while AI is disconnected.

## Switch, archive, and recover

Select another feature, or choose **No feature selected** to return to the broader source view. Archiving the active feature clears the selection and preserves its records. Restore it from **Manage features** before selecting it again.

A project can keep up to 20 features, including archived features. Each feature supports a title of 1–80 characters, a brief up to 2,000 characters, and up to 32 unique project files. Feature loading is bounded to 256 KiB of saved source; Assistant context preparation considers at most eight available saved files and still uses the Assistant's request limits.

Missing, excluded, or unavailable files stay listed as feature members until you explicitly remove them. A failed save shows a retry state and blocks additional metadata changes. Retry saves the retained pending revision without duplicating the feature. Unreadable or unsupported storage is left untouched.

## Verification and scope

`node --test desktop/extension/test/feature-store.test.mjs` checks durable storage validation, restart, stale edits, serialized writes, retry, archive, capacity, missing-file preservation, and evidence-labeled suggestions.

`node desktop/scripts/feature-smoke.mjs` creates a populated feature in an isolated native profile, verifies source loading, primary-file navigation, Assistant preparation, and preservation of an unrelated unsaved draft, then gracefully quits and restores the same feature in a second native process. Set `FOUNDATION_APP_PATH` to verify a separate packaged candidate, or use `--development` for the source extension. This is automated native behavior verification; it does not claim visual acceptance or crash/power-loss durability.

Feature metadata remains a durable task brief and file working set. The 0.12 [runtime screen and manual scenario increment](runtime-scenarios.md) connects a separate runtime workspace to it. Automatic replay, complete feature graphs, multi-file change sets, and review bundles remain separate work.
