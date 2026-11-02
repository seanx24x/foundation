# Feature screens and manual scenarios

A feature’s primary file anchors its source relationships. A **screen** identifies a place in its running web app: a name, a recognized development target, and a route such as `/settings/profile`. These are separate connections; naming a screen does not prove that a component owns it.

## Define a screen

In Understand, select a feature and expand **Runtime**. Discover the project’s targets, then add a screen with a title, target and route. You can also bind the server you explicitly connected. Definitions are saved on this device, separately from the source repository and AI conversation history.

Routes are canonical root-relative pathnames. Query strings, fragments, credentials, encoded paths and the adapter’s own endpoints are excluded in this increment. Full URLs, ephemeral ports and runtime tokens are never saved in a screen definition. An externally managed target must be explicitly connected again before opening its screen.

Selecting a screen changes only the working selection. **Open screen** explicitly starts its recognized target if needed and navigates the canvas. It preserves an already owned development process and creates a new view identity, separating its request timeline from the previous screen.

Requested route, observed page route and server connectivity are different states. Foundation waits for a fresh page heartbeat with the expected route and document identity. An older adapter, missing instrumentation, a redirected route or a disconnected page cannot start an observation. The existing runtime setup and reconnect controls provide recovery.

## Define and observe a scenario

Add a named scenario under a screen. Write an ordered list of manual steps and an expected outcome. These are instructions for the person using the app; Foundation does not execute them automatically.

1. Open the scenario’s screen and wait for the observed route to match.
2. Choose **Begin observation**. Foundation captures the feature’s saved-source revisions and the exact runtime session, view, document and navigation revision. Unsaved source is excluded and its paths remain identified.
3. Perform the steps in the app. Inspect mode is turned off so the app receives the interaction.
4. Choose **Finish observation** and record whether the result matched the expectation, did not match, or was not assessed. Add an optional note. Cancel preserves a cancelled record.

An observation stores sanitized request completions captured during its interval. Method, URL without query or fragment, status, timing and network outcome are runtime evidence. A request appearing during a scenario is not proof that a particular step or component caused it. A 200 response does not determine the user’s assessment, compilation, visual quality or accessibility.

The evidence record retains immutable screen/scenario definitions, feature identity, saved-source hashes, session/view/document identities, timestamps and the user’s assessment. A bounded request buffer reports when it may be incomplete. Reopening history never starts the app or contacts an AI provider.

## Interruption and freshness

A runtime stop, disconnect, document reload, route change, feature change or relevant saved-source change interrupts an active observation. A monotonic navigation revision detects leaving and returning to the same route between host polls. Its already captured evidence remains a historical record. Restarting Foundation cannot resume a recording as though its old runtime were still current.

Historical observations are labeled stale when loaded saved source or definitions differ. If some recorded source has not been loaded, freshness is unknown. Matching source does not make an old runtime session live. The running checklist tracks broader scenario replay and comparison separately.

Definitions support archive and restore. Storage uses revision guards and serialized writes; stale editors must review the latest saved version. A failed write retains the pending state and offers Retry. Invalid saved data stays untouched. There is no silent removal of old runs when local capacity is reached. The current local alpha limits are 20 screens, 40 scenario definitions, 40 observations, 100 requests per observation, and 8 MiB per project. Archived definitions count toward these limits. At capacity, existing screens and evidence remain available, but new observations are blocked. Scalable history storage and explicit retention controls remain a release gate.

## Current boundaries

Manual observation supports the trusted local React/Vite adapter. [Paired visual captures](visual-captures.md) provide separately reviewed images; [app-authored recipe replay](scenario-replay.md) is the next increment. Free-text scenario steps remain manual instructions. Backend tracing, cross-screen scenarios and a complete project relationship graph remain outside this workflow. Scenarios do not silently add context to Assistant. Provider requests still require the existing explicit source/runtime selections.

Use **Foundation: Open Feature Screen** and **Foundation: Observe Feature Scenario** from the native command palette. Standard editing, the saved-source sandbox and the Assistant remain available independently.
