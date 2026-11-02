# Foundation 0.40 verification

Verified and installed on 1 November 2026. M4.02b delivers scoped multi-file alternatives with explicit whole-group adoption.

## What passed

- 1,516 desktop tests, 342 project tests, both TypeScript checks and whitespace validation. The final desktop suite used four concurrent test processes.
- Two genuine Assistant Build requests to a deterministic credential-free loopback provider create separate two-file groups. Provider input is checked against exact numbered saved source. This does not establish live-model performance or quality.
- Soft save and Pill save run against the same complete baseline, frozen feature/screen/scenario, recipe and requested conditions. Four independent observations/replays and four PNGs retain exact source and runtime identities.
- Retained comparison is read-only. Explicit Review creates a new local alternative group with no fabricated request or conversation, opens native source diffs for both files, and preserves original files until Apply all.
- Explicit Apply all and Undo all pass; the original files return to their exact hashes and an unrelated draft remains unsaved. Unit/integration tests cover drift between renames, cancellation, unavailable provenance and recovery preserving unrelated changes.
- A second process restores the local group, selected pair, names, evidence and draft without automatic runtime, provider, source or image actions. Explicit image reload verifies captured bytes. Native light, dark and split layouts were inspected.
- All 32 installed payloads match the signed native-tested candidate. Eight saved Orbit files and the 727-byte SaveButton draft are unchanged. SaveButton remains active at 18:1 and selected in Explorer; profile.ts stays a preview tab. The workspace panel stays closed, the bottom panel hidden, the far-right Assistant and request context expanded, only SaveButton selected, task brief enabled, Ask active, composer empty and AI unconfigured.

## Performance and earlier failures

The first provider-fixture attempt rejected numbered source; the fixture was corrected without changing production behavior. The next attempt exceeded the unchanged 120-second preparation deadline and eventually completed in 160.2 seconds. Per-file guards were rebuilding full review/execution projections. Cheap busy getters and ownership/revision guards reduced first preparation in the final native run to 26.1 seconds with every manifest check retained. New regressions forbid snapshot rebuilding in repeated guards.

Earlier failures remain preserved: the initial desktop suite targeted the old installed version; a subsequent default-concurrency run exposed a timing-sensitive output-scroll assertion, which passed in isolation and in the final complete bounded-concurrency suite. [Prior attempts](scoped-multi-file-alternatives-v0.40/prior-attempts/README.md).

## Boundaries

Scope is two to eight existing application-source files, 64 KiB aggregate on each side, with changed and context paths inside one active feature. No partial acceptance, local-group refinement, version activation or local-group execution checks. Writes are serialized and atomic per file, with durable recovery; they are not an atomic group transaction.

Requested app conditions and measured browser conditions are independent. Compilation remains Not recorded, manual visual assessment Not assessed and source-to-pixels correspondence Unverified. Native inputs are automated CDP events; laptop and physical input/display acceptance remain paused.

[Native report](scoped-multi-file-alternatives-v0.40/native-report.json) · [Payload/source bindings](scoped-multi-file-alternatives-v0.40/collection.json) · [Installation](scoped-multi-file-alternatives-v0.40/normal-install.json) · [Workflow](../docs/scoped-multi-file-alternatives.md).
