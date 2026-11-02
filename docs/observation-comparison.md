# Compare saved observations

Compare two saved manual scenario observations in a feature's **Runtime** workspace. The comparison places recorded behavior evidence and source revisions together. Foundation 0.32 adds optional [local visual captures](visual-captures.md) created explicitly while each observation is active; choosing historical records never captures a new image, replays a scenario, or grades a visual change.

## Use the comparison

1. Select a feature in Understand, then expand Runtime and Compare observations.
2. Choose a Baseline and a Comparison from saved observations for that feature. Each choice is explicit; Foundation does not silently replace a missing selection.
3. Review the recorded manual assessments and notes, scenario instructions, observed requests and source revisions. Swap reverses the selected sides; Clear removes the local selection.

Both records must belong to the same feature and saved screen. Different scenarios, routes, targets or source membership can be displayed, with their differing recorded conditions called out. Cancelled or interrupted runs retain their status and incomplete-evidence warnings. They are historical records, not equivalent successful reruns.

The comparison is read-only. Choosing records does not start a runtime, contact a provider, navigate source or apply changes. Only the selected record IDs are retained in project-and-feature-scoped local view state. Source evidence, notes and recorded definitions stay immutable. Reopening the comparison after restart performs no runtime or AI work.

## Read the evidence

Manual assessment is the recorder's judgment, independently of HTTP status. A successful request does not establish that the scenario matched, that code compiled, or that the interface passed visual/accessibility checks. Zero captured requests does not prove that no network activity occurred.

Source rows compare full recorded revisions and identify added, removed, changed or matching paths. Per-side freshness describes the relationship to currently available saved source. A historical snapshot can be stale or unknown and still remain useful for review. Unsaved paths that were excluded when recording remain visible.

Requests retain their original sanitized URLs, method, outcome, status, duration and timing boundary. Response-header timing and response-completion timing are different observations. Foundation does not pair individual calls causally or derive a performance improvement from two manual recordings. Incomplete buffers are labeled.

Recorded scenario steps and expected outcomes are shown independently on each side. Matching definitions and source hashes do not establish matching application state. Observations without an attached capture have no recorded viewport or media preferences. Optional capture conditions describe their own capture time; application theme, data and animation state remain unknown, and visual equivalence is not inferred.

## Limits and recovery

A record still being saved is labeled pending; a storage error identifies the retained local state. A reversed clock interval keeps its recorded timestamps with an explicit warning.

An active recording cannot be selected. Same-record, cross-screen, foreign, malformed or missing selections cannot produce a comparison; choose valid records or clear the selection. Project and feature changes cannot reuse another context's pair. The existing 40-observation storage limit remains unchanged and records are never silently removed.

This increment advances saved observation review within M3. Paired pixel captures have their own M3.02 verification gate. Reproducible visual-state configuration, automatic replay, comparison of isolated alternatives and physical response measurements remain separate gates in the [running checklist](product-checklist.md). See [manual scenarios](runtime-scenarios.md) for creating the underlying observations.

## Verify the packaged workflow

Run `desktop:scenario-smoke` with `FOUNDATION_APP_PATH` set to a stopped isolated candidate, then run `desktop:observation-comparison-smoke` with the same candidate. The second check consumes the first check's real completed and interrupted observations in a copied disposable profile. It verifies immutable history and source, explicit selection, Swap/Clear and exact selection restoration in a second process. It never starts the runtime or contacts AI. Synthetic renderer select changes and trusted native disclosure/button activations are reported separately; neither measures physical input latency.
