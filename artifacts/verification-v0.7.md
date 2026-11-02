# Foundation 0.7 — durable conversation verification

## Implemented

- Local, project-scoped conversations with New, History and reversible Archive/Restore.
- Original source snapshots and revisions, partial response recovery, and explicit storage failures.
- Saved proposal artifacts and revision-bound historical verification; the active checkpoint remains the only source-edit authority.
- Keyboard navigation and persistent disclosure/focus state in both themes.
- Fixed, deduplicated warnings when capacity prevents new artifact history without changing the actual source or preview outcome.

## Verified in source and the development extension

TypeScript checking and bundling pass. The full desktop suite passes all 123 tests, including packaged identity, startup patch, license and renderer checks. The separate provider/proposal suite passes 24 tests. Browser tests exercise the production renderer at 1280, 700 and 360px in both themes, disk-backed reload, interruption, archive/restore, stale/unknown source, historical verification, and keyboard focus across updates. Whitespace checks pass.

The final external extension passes all 13 native smoke checks in a disposable project/profile, including editing, language services, Git, terminal, preview compilation and guarded Apply/Undo. There were no provider requests or startup platform-authentication activations. A separate two-process test restores the same conversation identity through graceful native quit and relaunch using the actual workspace database. It deliberately avoids `--extensionTestsPath`, which makes Code OSS storage temporary.

Store and browser tests verify persisted response, proposal and verification content. The native restart test verifies conversation identity, not model quality, every artifact through a real provider, process-crash fsync or power-loss durability. Synthetic responses stay in test fixtures.

## Packaged app and startup recovery

Foundation 0.7 has been fully rebuilt from the pinned Code OSS source, installed and signature-verified. All 13 packaged native checks pass with bundled extensions enabled; the packaged two-process conversation restart check also passes.

A normal Orbit launch exposed a shared extension-host stall in synchronous filesystem open. The same profile remained responsive with only the bundled npm extension temporarily disabled, including New, History, Archive and Restore. Its Yarn workspace probe synchronously read ancestor manifests immediately after a rejected async lockfile stat, matching the sampled call sequence. The maintained upstream patch now awaits those filesystem operations while preserving the original workspace and matcher behavior. Six regressions, npm typechecking, packaged marker validation, and Apache/Yarn attribution checks pass. The full app was rebuilt with npm enabled; no permanent extension-disable setting was introduced.

The final normal app launch was visually verified with every bundled extension enabled. The saved conversation restored after relaunch; History, Archive, the archived read-only state and Restore responded immediately in the native Assistant. The npm task picker discovered Orbit’s build, dev and install tasks; none was executed. There are no unresponsive-host events in the current renderer log. The native dark-theme Assistant was inspected with the saved-history controls visible; browser tests independently cover both themes. [Native capture](verification-v0.7-native.png).

The eight saved Orbit files and the existing 727-byte unsaved SaveButton draft matched their prior hashes again after the final rebuild and native UI checks. The user requested that the draft remain unsaved. AI stays disconnected in the real user workspace; history is not automatically added to future prompts. The existing private workspace reference still reflects its earlier version; no user conversation history has been published.

See [implementation contract](../docs/durable-conversations.md) and [machine-readable evidence](verification-v0.7.json).
