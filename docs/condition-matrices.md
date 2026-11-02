# Condition matrices

A condition matrix runs one explicitly selected app-authored recipe across selected preview widths, application themes and motion inputs. It is a bounded sequence of independent observations. Each cell starts with a fresh preview document, resets its named fixture, and retains its own replay and request evidence.

## Workflow

1. Open an instrumented React/Vite screen in Refine and select its scenario. Finish any active manual observation first.
2. Open **Condition matrix → Choose conditions**. Choose a recipe, then select widths (390, 768 or 960), application themes (Light/Dark), and motion inputs (Follow system/Reduced).
3. Review the expanded list of combinations. The matrix contains 1–12 cells. Selection alone does not run project code.
4. Optionally enable **Capture each result** to save an actual local PNG after each completed replay. It starts unchecked.
5. Choose **Run matrix**. Foundation opens a fresh document for each cell, applies the temporary preview conditions, records preparation and callbacks, and finishes that observation as **Not assessed**.
6. Use **Stop matrix** at any point. A failure or uncertain interruption also stops the sequence. Earlier records remain available and later cells stay **Not run**.
7. Expand a saved cell to inspect its linked evidence. Use it as the baseline or comparison in the existing observation comparison view.

The live canvas stays visible while the sequence runs. At narrow widths, progress and Stop remain above the preview. Matrix conditions are temporary; your saved preview preferences and inspector arrangement return afterward. Editing source, switching context, hiding the preview or stopping its runtime interrupts the matrix instead of silently changing what later cells run against.

## What a cell records

Each matrix freezes its feature, screen/scenario definitions, source hashes, dirty-source membership and selected recipe metadata before opening a new document. Every cell reserves its observation and replay execution identity before work starts. The acquired observation, replay and optional capture links are distinct from those reservations.

- **Replay:** whether the declared callbacks completed, failed, stopped or were interrupted. A completed callback is not an assertion that the behavior is correct.
- **Requests:** actual sanitized request observations in that cell's interval. They remain unattributed to individual steps.
- **Capture:** an actual native PNG when explicitly requested and successfully saved. Capture failure is not converted into a successful cell.
- **Manual assessment:** remains Not assessed. A matrix does not automatically approve visual, behavioral, compilation or accessibility outcomes.
- **Conditions:** requested app inputs and actual recorded viewport/media preferences remain separate. Recipe callbacks must implement the application theme and motion input. Foundation does not emulate operating-system preferences or prove reduced-motion compliance.

The fixture's recipe catalog must retain the same metadata digest across document reloads; each document has its own registration identity. Matching metadata is not proof of deterministic application state or compiled source equivalence. Source-to-pixel correspondence remains Unverified. Capture fields for application theme, data and animation remain Unknown rather than adopting the recipe's claims.

## Interruption and recovery

The matrix stops at the first failed or uncertain cell. It does not skip failures to keep dispatching. Stop cancels the current callback cooperatively and prevents later work; effects already performed may remain. An uncooperative callback is not forcibly terminated. A fresh document separates consecutive cells, but it does not reset cookies, local storage, service workers or external backend data. The app-authored preparation callback remains responsible for its declared fixture.

After Stop, a failed callback or an uncertain timeout, the runtime may require a reload. Choose **Open screen**, wait for the fresh document to connect, then choose the recipe again. Earlier evidence remains unchanged.

Evidence writes precede application work. Restart turns unfinished work into interrupted history and never reconnects, resumes or repeats a recipe. **Retry matrix storage** reconciles the exact reserved child IDs and saves interrupted evidence; it never invokes callbacks or captures another image. Recovered links do not upgrade a failed or interrupted lifecycle into success.

Before starting, Foundation checks room for the selected cells in observation, replay and optional capture history. Capture capacity includes existing files, including orphaned assets, and reserves a conservative maximum image budget. Authoritative writes still enforce the limits. Existing evidence is never silently evicted.

The current limits are 12 cells per matrix, 40 retained matrices and a 2 MiB matrix manifest. The existing project limits of 40 observations, 40 replays and 40 captures also apply. Recipes retain the existing 10-second preparation/action bounds and maximum 12 declared actions. The runtime remains connected after a completed matrix; it is not automatically restarted when saved history is opened.

## Scope and verification

This is the React/Vite adapter workflow. Browser input recording, automatic visual scoring, complete environment/data snapshots, isolated-alternative comparison, and SwiftUI/Expo matrices remain separate work. Replay and capture evidence remain local and outside AI context.

Foundation 0.34 was verified: 1,231 desktop tests and TypeScript pass. Four packaged matrices cover twelve fresh documents, optional PNGs, Stop and callback failure; all evidence and selected comparison restore in a second process. Orbit source, unsaved draft and workspace context remain preserved. Hardware acceptance remains paused at the user's request. [Verification](../artifacts/verification-v0.34.md).

[Single-recipe replay](scenario-replay.md) · [Visual capture](visual-captures.md) · [Running checklist](product-checklist.md)

Foundation 0.35 adds [named state suites](state-suites.md) using the same guarded runner. Its version-two journal reads legacy history without overwriting the original key; single-recipe matrices remain supported.
