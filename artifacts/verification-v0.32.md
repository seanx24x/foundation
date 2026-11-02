# Foundation 0.32 — paired visual captures

**M3.02 is verified and installed.** A connected, instrumented web preview can save one actual PNG with a new manual observation. Compare observations displays the selected pair with capture conditions, manual assessments, observed requests and full source/runtime bindings. Images stay local and out of AI context. A capture does not establish a visual pass or prove which saved source produced the pixels.

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop regression suite | 1,104 passed; no failures or skips | [Log](visual-captures-v0.32/desktop-tests.log) |
| Desktop TypeScript | Passed | [Log](visual-captures-v0.32/desktop-typecheck.log) |
| Native bridge types | Six generated upstream files; zero diagnostics | [Log](visual-captures-v0.32/native-bridge-typecheck.log) |
| Capture contracts and recovery | PNG integrity/bounds, project quotas, immutable binding, storage reconciliation, cancellation, source/runtime races, late responses and verified-byte delivery covered in the full suite | [Suite](visual-captures-v0.32/desktop-tests.log) |
| Native geometry | 31 bridge cases and 11 real-browser clipping cases pass; actual Code OSS wrapper overhang and rectangular content-box clipping reproduced | [Clipping log](visual-captures-v0.32/native-clipping-tests.log) |
| Renderer | Six focused tests pass: exact pair binding, bounded blobs, stale/invalid replies, failure states, themes, narrow layout and keyboard access | [Log](visual-captures-v0.32/capture-renderer-tests.log) |
| Actual native pixels | Blue 1104×780 at zoom −3; green 1294×914 at normal zoom with Fit. Expected state pixels present; all four adjacent magenta edges and header excluded from both PNGs | [Native report](visual-captures-v0.32/native-capture-report.json) · [Blue](visual-captures-v0.32/capture-1.png) · [Green](visual-captures-v0.32/capture-2.png) |
| Comparison and restart | Both images decode in light/dark comparison; differing conditions are reported; exact records and image hashes restore in a separate process with runtime idle | [Light](visual-captures-v0.32/write-light.png) · [Dark](visual-captures-v0.32/write-dark.png) |
| Installation | 28 checked payloads equal the tested candidate; deep/strict signature passes; normal native relaunch verified | [Install](visual-captures-v0.32/normal-install.json) |
| Orbit preservation | Eight saved files and original 727-byte unsaved backup unchanged. ProfileForm preview, group 2, caret 19:8, source focus, panels, feature and Assistant context restored | [Baseline](visual-captures-v0.32/normal-before.json) |

The native fixture uses real React state changes and local HTTP requests inside Foundation's embedded preview. Button activation uses trusted native key events. Comparison/select controls use explicitly recorded synthetic select changes. A fixture-only header marker and an outline immediately outside the canvas establish the crop boundary; neither manufactures the captured product pixels. The marker is removed from comparison screenshots. Native capture images and the final light/dark comparison views were visually inspected. This is automated maintained-fixture acceptance, not representative-user usability acceptance or a physical keyboard/display measurement.

## Evidence boundaries

- The capture is a visible preview rectangle, not a full page or hidden state. Fractional coordinates round inward, with an additional one-device-independent-pixel inset when needed. Actual PNG dimensions are retained.
- Each image belongs to one exact observation and saved source/runtime binding. It remains immutable after a failed finish; recovery reconciles a committed manifest before considering another native capture.
- Selected images are loaded and hash-verified on demand, then delivered as the exact verified bytes outside routine state updates. At most two temporary blob URLs are retained. No mutable file URI or image bytes enter persisted view state or Assistant context.
- Source-to-pixel compilation remains **Unverified**. Application theme, data and animation state remain **Unknown**. Media preferences, viewport, scroll and scale do not prove equivalent application state. Displayed scale values are concise; the original numeric measurements remain stored.
- Initial native attempts failed on test color calibration, unsupported CDP window APIs, target selection, and actual bridge restrictions for Code OSS clipping. Their diagnostic evidence is retained in `visual-captures-v0.32/native-initial-failures/`; those attempts are not counted as successful pixel acceptance.
- Reproducible state configuration, automatic replay, pixel scoring, native platform adapters and broader project compatibility remain open. Laptop and physical input/display acceptance remain **paused at the user's request**. No endurance run was repeated.

The previous 0.31 bundle remains at `desktop/.build/Foundation-0.31-before-0.32.app`. The installed app uses the normal profile; all native capture fixtures used isolated profiles. No preview publication, deployment or source Apply was performed by this increment.

[Capture workflow](../docs/visual-captures.md) · [Running checklist](../docs/product-checklist.md) · [Candidate manifest](visual-captures-v0.32/candidate-build.json)
