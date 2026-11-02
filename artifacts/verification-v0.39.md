# Foundation 0.39 — named alternatives and reviewed adoption

M4.02a is verified and installed locally. Two named, retained CSS-token candidates can be compared using their exact saved evidence. Review stages one candidate and opens its native diff without changing the checkout. Apply is a separate explicit action; Undo restores only the exact applied target. Parent M4.02 remains in progress.

## Verification

| Check | Result |
| --- | --- |
| Project / desktop regressions | 340 / 1,469 passed; zero failed, cancelled or skipped |
| Project and desktop TypeScript | Passed |
| Native alternatives | Two named candidates, four completed isolated runtimes, four app-authored replays, HTTP 200 request evidence and four verified PNGs |
| Comparison | Exact proposed-side images; matching baseline, frozen scope, recipe and requested conditions |
| Review | Conflicting proposal blocked; explicit discard enables source-preserving Review and exact native diff |
| Adoption | Explicit Apply writes the selected CSS candidate; explicit Undo restores its source; unrelated saved files and draft stay intact |
| Restart | A second native process restores names, selected pair, checkpoint and draft with runtime idle; images load only on explicit request |
| Visual acceptance | Native Dark/Light comparison and split layouts inspected; normal Orbit layout and context checked |
| Installation | All 32 payloads match the signed native-tested candidate; deep/strict signature passes |
| Orbit | Eight saved files and original 727-byte draft unchanged; active SaveButton caret 18:1, profile.ts preview and Assistant context preserved |

[Native report](alternative-adoption-v0.39/native-report.json) · [Installation](alternative-adoption-v0.39/normal-install.json) · [Machine-readable verification](verification-v0.39.json) · [Workflow](../docs/alternative-adoption.md) · [Desktop tests](alternative-adoption-v0.39/desktop-tests-final.log).

## Evidence and boundaries

The final native run used `/private/tmp/foundation-039-candidate-ty69Gv/Foundation.app` and disposable profile `/private/tmp/foundation-alternative-adoption-smoke-ixp7vu`. It verifies Soft corners and Pill corners against one full saved baseline. Each candidate changes one CSS token declaration. Their independently bound runtime observations, callbacks, source revisions and captures remain historical evidence. The final original fixture hashes equal the starting hashes after explicit Apply and Undo. No original runtime evidence is substituted for an isolated side.

Requested viewport, app theme and motion are recorded separately from observed browser conditions. Native scaling may round the measured viewport by at most one CSS pixel. Capture browser preferences match the replay's measured preferences; they need not match app-requested theme/motion. Comparison is available when frozen source baseline, scenario, recipe and requested conditions agree; observed differences remain visible. Shared requested conditions do not establish identical backend data, browser storage or animation timing.

Compilation is Not recorded, visual assessment is Not assessed and source-to-pixels provenance is Unverified. AI stays disconnected. Automated trusted CDP input is native acceptance, not representative-user or physical keyboard/display acceptance.

Retained source recovery validates original saved inputs, both complete copy manifests, ownership metadata and exact bounded UTF-8 before/after bytes. Private candidate metadata identifies its token and impact checkpoint; ordinary comparison snapshots do not disclose source bodies. Apply revalidates provenance and current source at the serialized write boundary. Only the exact newly created atomic-write file may be omitted from that baseline scan, with pinned path, device, inode and content hash. Substituted temporary files are rejected and preserved. Undo does not require the old whole-project baseline and preserves unrelated work.

Four comparison records are retained without eviction. Each copy keeps the existing 32,768-entry and 512 MiB bounds; ordinary files allow 16 MiB and regular node_modules `.node` binaries allow 32 MiB. The existing macOS execution boundary permits only owned-copy writes, loopback networking and the shipped Node/copied esbuild executables. Local file reads and other loopback services remain reachable; this is not a confidentiality or backend-isolation boundary. Legacy records remain readable and comparable but cannot stage source without retained candidate metadata. Restore and retry do not dispatch new callbacks, retake images or apply edits automatically.

## Previous attempts

Earlier incomplete or failed runs remain excluded from passing acceptance. Their paths and diagnostic evidence are preserved in [previous attempts](alternative-adoption-v0.39/previous-attempts.json). Historical 0.38 acceptance is unchanged.

## Next

Continue M4.02 with scoped multi-file alternatives, defining candidate scope, provenance, comparison and recovery before implementation. Automatic winners, provider-generated alternatives, backend snapshots and native adapters remain open. Laptop and physical input/display measurement stay paused at the user's request. Broader parent capability and M0/M1 release gates remain open.
