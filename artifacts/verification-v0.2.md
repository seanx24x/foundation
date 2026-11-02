# Foundation 0.2 verification

Verified 2026-10-27 in the isolated Foundation staging checkout, then transferred to
the canonical `foundation/` checkout. The existing walkthrough's saved source
in the user's running project was preserved during transfer.

## Automated results

- **40/40 Node runtime tests passed:** 15 project service, 11 assistant protocol,
  and 14 original-runtime/integration cases.
- **29/29 Chromium workflows passed:** 12 project workbench, 4 assistant UI,
  and 13 original connected walkthrough cases.
- **TypeScript and production build passed**, including both the main workspace
  and the Orbit preview entry. The known Monaco editor chunk-size warning remains;
  the editor and its workers are locally bundled and loaded on demand.
- `git diff --check` passed.

Project workflows cover real relationships and line navigation, literal search, quick
open, independent file drafts, retained drafts across workspace switching, saved source
updates in the actual preview, source diff and restore, concurrent-save conflicts,
success/error requests, element-to-source inspection, opening a separate temporary
project folder, and dark/light layouts at 390, 1024, and 1440 pixels. No unhandled
browser exceptions were reported. Browser tests restored their owned source edits.

The suite was run with the walkthrough fixture in its recognized baseline state in a
separate staging copy. Do not reset a user's working source to obtain that baseline.
Use an isolated copy when running mutation-based workflow tests after custom edits.

## Visual review

Reviewed the actual in-app browser layout and saved light/dark desktop and narrow
captures. Refine shows the same sample files that the source editor saves. The preview
has its own app scrolling surface; workspace panels resize with pointer or keyboard.
Mobile layouts expose the navigator on demand and stack the contextual inspector.

Captures: `project-dark-1440.png`, `project-light-1440.png`, and corresponding 1024/390
variants. The previous walkthrough captures remain available as `foundation-*.png`.

## AI evidence

The real server provider adapter was exercised against local HTTP protocol fixtures,
including fragmented SSE, selected-file boundaries, stale revisions, cancellation,
timeouts, provider errors, output limits, redirects, and concurrent request limits.
Configured-provider browser tests use explicit fixtures to verify context selection,
valid citation navigation, usage, stopped partial answers, and stale-answer snapshots.
No external model was connected or charged; provider/model quality is unverified.

## Current limits

- Code OSS desktop packaging, native adapters, debugger/terminal, and extensions are
  still future integration work.
- Live preview and component mapping apply only to the included Orbit sample.
- Source analysis is syntax-based and does not establish runtime/backend behavior.
- Folder inventory is bounded; aliases and dynamic relationships can be unresolved.
- External edits require refresh. Source saves persist; review checkpoints and chat
  history remain in memory. General Git review and durable recovery are not implemented.
- The assistant answers from selected saved source. It cannot apply changes or run tools.
- No representative-user usability study or large-repository performance study was run.
