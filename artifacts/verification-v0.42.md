# Foundation 0.42 verification — Reproducible Issues

M4.04 is verified and Foundation 0.42.0 is installed and running. A reported problem now retains its reproduction steps, expected result, original observation, source hashes, requests and optional replay/screenshot metadata as one immutable local issue. The normal Orbit workspace is preserved.

## Delivered

- Explicit Capture issue from a finished web scenario observation. Title and actual outcome are user-authored; scenario instructions and existing evidence are frozen by the host.
- Issues in Review, feature and source understanding, with source navigation and guarded access to the original observation. PNG bytes are loaded and verified only when explicitly viewed.
- Original-source freshness, capture-time source freshness and original run/replay/capture-metadata availability are separate. Historical and missing evidence remain readable without being presented as current execution or a verified diagnosis.
- Explicit single-issue Assistant context for ordinary Ask, Plan, Build and Review, with canonical revalidation before dispatch. The disclosed assessment is pinned; a changed relationship rejects Send. Conversation schema 10 preserves the immutable sent snapshot and reads earlier histories without rewriting them.
- A 32-record, 4 MiB append-only local journal; 60 KiB per issue and 64 KiB issue-context limit. Readback, owner/revision guards, rollback and Retry preserve prior records. Capacity does not silently evict evidence.
- Bounded cached presentation, constant-time source-scan guards, and an explicit refresh for any selected historical issue. Standard editing does not copy full runtime histories per scanned source file.

## Verification

**1,609 desktop tests and 383 project tests passed, with zero failures or skips.** Desktop and project TypeScript checks passed; JavaScript syntax checks and `git diff --check` were clean. Coverage includes malformed/foreign records, evidence binding, stale and missing source, exact context disclosure, source/feature/trust races, storage failure/readback/rollback/retry, capacity, restart, all ordinary AI modes, provider protocols, narrow layouts, keyboard use and both themes.

The final signed candidate ran the complete workflow in a disposable maintained React/Vite fixture and isolated profile:

1. An explicit app-authored error recipe produced a real HTTP 503 response and visible error state.
2. Capture and finish observation saved actual PNG bytes and the user's Not matched assessment. Compilation and automatic behavioral/visual verdicts were not asserted.
3. Capture issue saved a user report with the exact run, frozen scenario, full original and capture-time source hashes, replay metadata and capture metadata. Recording sent no provider request.
4. Review displayed the issue in dark and light themes; screenshot geometry confirmed the issue title and reported outcome were visible. View original observation navigated without starting runtime/provider work. Explicit View capture displayed bytes matching the saved PNG hash and dimensions.
5. One explicit Ask selected the issue and two saved source files. The disclosed issue/assessment, deterministic local provider request and durable turn matched exactly. Screenshot bytes were excluded.
6. A deliberate saved CSS comment changed the issue to Historical. The original issue and sent context remained immutable, and historical context stayed explicitly selectable.
7. A second process restored the issue, original evidence, historical selection, exact unsent composer and unrelated unsaved draft. The runtime stayed idle; provider request count stayed one; no image bytes loaded automatically.

The provider was a credential-free deterministic loopback fixture. Remote model behavior and answer quality remain unverified. Requests are unattributed observations; runtime-to-source correspondence remains unverified. Capture metadata availability is separate from validating stored pixels.

## Installation and preservation

All **32 installed application payloads** match the signed, native-tested candidate. Deep strict signature verification passed. Source maps bind the relevant extension/runtime modules to the tested bundles, and the issue journal, conversation snapshot, original runtime metadata and PNG were checked independently.

Eight saved Orbit files and the **727-byte unsaved SaveButton.tsx draft** are unchanged. Direct native inspection after relaunch confirmed SaveButton active and selected in Explorer at 18:1, profile.ts as a preview tab, the workspace panel closed, bottom panel hidden, and the far-right Assistant and Request context expanded. Include task brief and only SaveButton remain selected; Ask mode, empty composer, unconfigured provider, dark theme and editor focus are preserved.

Rollback: `desktop/.build/Foundation-0.41-before-0.42.app`.

## Evidence and boundaries

[Native report](reproducible-issues-v0.42/native-report.json) · [Issue journal](reproducible-issues-v0.42/native-issue-journal.json) · [Installed payloads and preservation](reproducible-issues-v0.42/normal-install.json) · [Desktop tests](reproducible-issues-v0.42/desktop-tests-release.log) · [Project tests](reproducible-issues-v0.42/project-tests.log) · [Collection](reproducible-issues-v0.42/collection.json).

[Dark issue view](reproducible-issues-v0.42/write-issue-dark.png) · [Light issue view](reproducible-issues-v0.42/write-issue-light.png) · [Restored historical issue](reproducible-issues-v0.42/restore-restored-issue.png).

The first native attempt passed its write workflow but failed a restoration assertion that inspected page text instead of the composer's input value. Native inspection confirmed the draft was present. The assertion was corrected to read and match the exact textarea value; the complete second attempt passed. The earlier attempt and preliminary regression logs are retained separately and excluded from accepted-run evidence.

Automatic reproduction, backend/environment snapshots, external issue publishing, image transmission to models, SwiftUI/Expo issue capture and broader project knowledge remain open. Hardware acceptance remains paused at the user's request. D05's broader scope and M0/M1 release gates remain open.
