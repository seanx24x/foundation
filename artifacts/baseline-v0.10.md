# Foundation 0.10.0 — source-service baseline

Measured 2026-10-29T01:41:46.806Z. Foundation 0.10.0; Node v25.8.0; TypeScript 5.9.3.

Apple M3 Ultra; 32 logical CPUs; 512 GiB RAM; darwin 27.0.0 (arm64).

Each operation has 25 sequential measured samples after 3 warmups. Timings are milliseconds. Median and nearest-rank p95 come from raw samples retained in the adjacent JSON.

| Project | Operation | Samples | Median (ms) | p95 (ms) |
| --- | --- | ---: | ---: | ---: |
| Bundled Orbit · saved files | Open and index | 25 | 0.634 | 0.791 |
| Bundled Orbit · saved files | Snapshot / rescan | 25 | 0.540 | 0.644 |
| Bundled Orbit · saved files | Read source and analyze | 25 | 1.606 | 2.196 |
| Bundled Orbit · saved files | Literal search · matches | 25 | 1.283 | 1.604 |
| Bundled Orbit · saved files | Literal search · no match | 25 | 1.222 | 1.420 |
| Generated 100-file project | Open and index | 25 | 1.531 | 1.737 |
| Generated 100-file project | Snapshot / rescan | 25 | 1.437 | 1.543 |
| Generated 100-file project | Read source and analyze | 25 | 20.048 | 23.235 |
| Generated 100-file project | Literal search · matches | 25 | 13.156 | 14.028 |
| Generated 100-file project | Literal search · no match | 25 | 13.078 | 13.994 |

## Inputs and preservation

- **Bundled Orbit · saved files:** 8 files (4 JavaScript/TypeScript source files), 12,243 bytes. The bundled Orbit directory on disk. Read-only; unsaved editor buffers are excluded.
  Selected source: `src/components/SaveButton.tsx` (523 bytes); matching query `SaveButton` returned 6 results. Inventory SHA-256: `69677efe1a8816e3d2fb125beb386d9e24f63b6cab90e55420165d8580a8e73f`.
- **Generated 100-file project:** 100 files (99 JavaScript/TypeScript source files), 96,466 bytes. Deterministic owned temporary fixture: 97 TSX controls, App.tsx, saveProfile.ts, and package.json. Controls contain state, imports, an event handler, and an API call. No dependencies are installed and no code is executed.
  Selected source: `src/components/Control000.tsx` (987 bytes); matching query `control-` returned 97 results. Inventory SHA-256: `a719cc34184b41eb9cd988f774dfe13f1026c5029289db2843961b3d3e9acfe8`.

Both inventories were untruncated and their saved-file fingerprints matched before and after the run. The temporary fixture was removed. Orbit was only read; unsaved editor buffers were neither read nor changed.

## What each timing includes

- **Open and index:** Construct a fresh service, open the folder, scan its supported inventory, and discover package targets. The OS filesystem cache remains warm.
- **Snapshot / rescan:** Call snapshot() on the active service. The current implementation rescans the supported inventory and package targets each time.
- **Read source and analyze:** Call getFile() for the selected source. Includes inventory, source read, AST analysis, and source-consumer discovery across the project.
- **Literal search · matches:** Call search() with a known matching literal; the complete inventory is searched and the result remains below the 200-match cap.
- **Literal search · no match:** Call search() with an absent literal, requiring a complete scan of all supported file contents.

## Limits

- Warm filesystem and module caches: this is not cold launch, first install, or uncached disk performance.
- Measures the Node project service only. Does not measure keystroke/input-to-paint latency, native editor startup, extension-host transport, renderer updates, canvas frames, AI latency, or memory peaks.
- The generated fixture is larger than Orbit but remains a small synthetic project. It does not establish large-monorepo performance or performance at service inventory limits.
- Single-machine sequential samples with normal background activity. No forced garbage collection, thermal/power control, or confidence intervals. p95 from 25 samples is an initial reference, not a service-level guarantee.
- There is no comparison with Cursor, Visual Studio Code, Claude Code, Codex, or another product. These numbers do not establish a market performance ranking.
- Snapshots and getFile currently rescan project inventory; getFile also reparses source consumers. These baseline numbers include that work, not a future incremental index.

## Repeat

```sh
npm run desktop:benchmark
# Preserve this baseline and collect more samples separately:
npm run desktop:benchmark -- --samples 100 --warmup 5 --output artifacts/baseline-comparison
```

Use the same runtime, sample counts, machine conditions, fixture digests, and implementation hashes when comparing runs. A change to the bundled source produces a different input and should be reported alongside any timing change.

Native input-to-paint, startup, and renderer acceptance remain separate, unmeasured work. No industry comparison or performance target is claimed by this baseline.
