# App-authored scenario replay

Foundation can run a development app's explicitly registered recipes inside an active observation. A recipe names a local fixture, prepares or resets its state, then runs a bounded ordered list of app-authored actions. Existing manual scenario instructions remain human instructions. Foundation does not translate those instructions into selectors or generated scripts.

## Workflow

1. Open an instrumented feature screen in Refine and begin its observation.
2. Set the preview width and application theme. In the inspector, choose an **App-authored recipe** and its application motion preference.
3. Review the named fixture and steps, then choose **Replay recipe**. Selecting or restoring a recipe never executes it.
4. Watch preparation and step progress. **Stop replay** prevents later dispatch and requests cancellation of the current callback. Work already performed is not undone, and callback cancellation is cooperative.
5. When execution ends, inspect the running app and give your own assessment. **Capture and finish observation** records the actual preview using the existing native capture workflow. **Finish observation** remains available without an image.

There is one replay attempt per observation. Finish that observation and begin another to replay again; earlier results are immutable. An uncertain interruption can leave application effects unknown. Reopen the screen to create a fresh document before another execution when Foundation asks you to do so.

## Development registration

The instrumented Vite target exposes a development-only virtual module:

```js
if (import.meta.env.DEV) {
  const { registerFoundationScenarios } = await import('virtual:foundation/scenarios');
  const unregister = registerFoundationScenarios({
    version: 1,
    recipes: [{
      id: 'profile-success',
      title: 'Successful save',
      route: '/settings/profile',
      fixture: { id: 'alex-profile-v1', label: 'Alex Morgan · local fixture' },
      prepare: async ({ signal, conditions }) => {
        // Reset your development fixture and await its ready state.
        // Use signal for cancellable work. Implement requested app conditions.
      },
      steps: [{
        id: 'save',
        title: 'Save the local profile',
        run: async ({ signal, conditions }) => {
          // Call the same application action used by your interface.
          // Await its completion; return values are not recorded.
        },
      }],
    }],
  });
  // Call unregister when your integration unmounts or is replaced.
}
```

Keep fixture reset and actions confined to your development data. These are project-authored callbacks running with the page's normal permissions. Foundation does not sandbox their effects or roll them back. Use cancellation signals, bound asynchronous work, and await the state you intend to inspect. A callback that ignores cancellation may continue changing the application after Stop; Foundation will not dispatch later steps or call that document safe to replay automatically.

The catalog contains bounded recipe metadata only: IDs, titles, routes, fixture labels and step names. The adapter does not automatically collect callback functions or return values, raw exceptions, input values, or request bodies. Authored metadata is retained verbatim; keep sensitive values out of recipe titles, IDs and fixture labels. Registration identity changes on replacement; its digest identifies the serialized metadata, not proof of application determinism or compiled source equivalence.

## Conditions and evidence

`conditions` contains `theme` (`light` or `dark`), `motion` (`system` or `reduce`), `viewportWidthCss` (390, 768 or 960) and `viewportHeightCss` (680). Width and height describe the requested preview viewport, independent of Fit. Actual dimensions are recorded separately; fractional native zoom permits at most one CSS pixel of rounding. Application theme and motion are explicit inputs for the recipe to implement. They do not emulate browser or operating-system media preferences, guarantee reduced-motion compliance, or prove a particular data state.

The record separately retains viewport dimensions, device scale, color-scheme media preference and reduced-motion media preference from the last successfully acknowledged completed unit, including preparation. These are not a per-step series or measurements from an unconfirmed final callback. It also keeps the exact project, feature, manual scenario, observation, runtime session/view/document/route, source hashes, dirty-source exclusions, recipe registration and catalog digest. Source relationship remains **Unverified**. Capture metadata continues to report unknown application theme/data/animation rather than borrowing a recipe's claims.

A completed step means the registered callback returned successfully and its acknowledgment was accepted for this execution. It is not a test assertion, behavioral approval, compilation pass, visual approval or accessibility result. Real request evidence remains an unattributed observation interval; appearing during replay does not prove which action caused a request. Recipe results are shown alongside the user's independent assessment in history and paired comparison.

## Persistence, cancellation and recovery

Foundation saves the replay reservation before invoking project code, saves each running step before dispatch, and saves its acknowledged completion before dispatching the next step. Transport retries reuse command identity; they never authorize a second callback invocation. A failed evidence write prevents later dispatch. **Retry replay storage** saves the same pending evidence and seals interrupted work; it never resumes or repeats an application action.

Only the exact instrumented local runtime can receive commands. Changes to the project, feature, saved source, observation, route, document, recipe registration or visible preview invalidate work. Closing the preview, stopping its runtime, cancelling the observation or leaving Refine interrupts the replay. A disconnected, timed-out or uncertain execution must not be presented as successfully stopped or rolled back.

Replay metadata is stored on this device separately from source files, captures and AI conversation context. Restart converts an unfinished replay to historical interrupted evidence and does not reconnect, resume or run any recipe. Limits are 40 retained records, 12 recipes per catalog and 12 actions per recipe, plus mandatory preparation, with a 2 MiB project history limit. Preparation and each action have a 10-second execution bound; a timeout stops further dispatch and does not forcibly terminate arbitrary application code. Existing evidence is never silently evicted.

The maintained [replay fixture](../fixtures/replay-web/README.md) covers idle, held loading, success, HTTP error and network failure. Idle and loading are explicit authored states; the three request recipes exercise a real local endpoint. They do not imply backend observability beyond that fixture.

## Scope

This increment covers one explicit recipe at a time in the maintained React/Vite adapter. Batch condition matrices, scripted browser input recording, automatic pixel scoring, full environment/data snapshotting, SwiftUI and Expo replay, and physical hardware acceptance remain separate checklist items. See the [running checklist](product-checklist.md).

Foundation 0.33 was verified: 1,166 desktop tests, TypeScript, seven packaged replay cases, two actual PNG captures and exact second-process restoration pass. Orbit source, its unsaved draft and workspace context are preserved. This verifies M3.03a–c. Foundation 0.34 adds [condition matrices](condition-matrices.md); broader adapters and environment snapshots remain open. [Verification](../artifacts/verification-v0.33.md).
