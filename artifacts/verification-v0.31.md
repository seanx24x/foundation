# Foundation 0.31 — saved observation comparison

**M3.01 is verified and installed.** Understand → Runtime → Compare observations presents two explicitly selected saved manual observations from the same feature and screen. Baseline and Comparison retain their own manual assessment, notes, request evidence, conditions and full source revisions. The exact pair survives restart; missing records never fall back silently.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop regression suite | 996 passed, 0 failed | [Log](observation-comparison-v0.31/desktop-tests.log) |
| Desktop TypeScript | Passed | [Log](observation-comparison-v0.31/desktop-typecheck.log) |
| Model | 19 tests: canonical data, immutability, identity, malformed/missing records, source scope, freshness, incomplete runs, clock rollback and pending saving | Included in full suite |
| Renderer | Six tests: controls, scoped persistence, focus, unchanged live iframe, no mutation messages and both-theme geometry at 296/390/700/1100 px | Included in full suite |
| Packaged scenarios | Real native host-owned Vite interaction records success and HTTP error; manual assessment supplied explicitly; interruption and restart preserved | [Report](observation-comparison-v0.31/native-scenario-report.json) |
| Packaged comparison | Uses those real historical records in a copied disposable profile; Swap/Clear and exact pair restore in a second process; source, histories, definitions and conversations unchanged | [Report](observation-comparison-v0.31/native-comparison-report.json) |
| Installed app | 21 payloads equal candidate; deep/strict signature passes; normal native relaunch and new empty-state controls inspected | [Install](observation-comparison-v0.31/normal-install.json) |
| Orbit preservation | Eight saved files and original 727-byte unsaved backup unchanged; ProfileForm preview/caret 18:1, layout and Assistant context restored | [Baseline](observation-comparison-v0.31/normal-before.json) |

Native dark/light captures and renderer overview/narrow captures were visually inspected. The native test uses synthetic renderer select changes and trusted disclosure/button activations, reported separately. It does not measure physical keyboard latency or establish representative-user usability acceptance. The normal profile was used only for installation/restoration and the empty-state check.

## Evidence boundaries

- Comparisons are read-only: no runtime start, AI request, source navigation/edit, history mutation or replay.
- Requests retain their original response-header or response-completion timing boundary and unconfirmed causal relationship. No timing deltas or inferred verification score.
- Cancelled/interrupted records, capture limits, excluded drafts, changed conditions and stale/unknown freshness stay explicit. Pending storage and reversed clock intervals retain their uncertainty.
- Viewport, theme, application data and motion settings were not recorded. This increment does not capture product pixels or prove visual equivalence.
- M3.02 paired visual capture and M3.03 reproducible state/replay remain open. Laptop and physical input/display acceptance are **paused at the user's request** while equipment is obtained. Previous endurance evidence remains unchanged; no endurance test was repeated here.

[Comparison guide](../docs/observation-comparison.md) · [Running checklist](../docs/product-checklist.md) · [Candidate manifest](observation-comparison-v0.31/candidate-build.json)
