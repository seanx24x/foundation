# Foundation validation and acceptance

## What counts as evidence

Keep four validation categories independent:

| Category | Proves | Does not prove |
| --- | --- | --- |
| Compilation / static checks | The checked source satisfies the configured compiler or analysis rules. | Correct runtime behavior, visual quality, or native support. |
| Interaction | The named scenario produced its asserted behavior in the recorded environment. | All possible states, platforms, or visual fidelity. |
| Visual | The inspected captures or rendered states meet explicit visual criteria. | Source semantics or unobserved backend behavior. |
| Accessibility | The named keyboard, semantics, contrast, zoom, and assistive-technology checks passed. | Complete accessibility across every possible extension or project. |

Every result records the revision or runtime session, environment, check, status, and relevant output. An unperformed check is unverified, not passed. Automated screenshot capture alone is not visual acceptance.

## Prototype acceptance sequence

1. Install and run the dedicated project using the README commands.
2. Run `npm run check`, `npm test`, and `npm run build`; retain actual output and failures.
3. Open the running interface and complete the Save walkthrough through a real local request, proposal, source change, verification, and undo.
4. Verify that the scripted proposal is labeled, native adapters are described as planned, and no UI claims an unconnected model or general project inspection is working.
5. Inspect the rendered interface in both themes, at target desktop widths, and with keyboard navigation and reduced motion.
6. Check source changes and confirm the application did not edit unrelated resource-library or portfolio files.

Only mark capabilities implemented when their actual behavior has been exercised. Requirements in the blueprint are not implementation evidence.

## Functional acceptance scenarios

| ID | Scenario | Expected outcome |
| --- | --- | --- |
| SEL-01 | Select Save, switch activities, open its source. | The same entity remains selected; source and inspector refer to the same mapping. |
| SEL-02 | Element has two plausible source mappings. | Both candidates and evidence are visible; source-backed mutation is blocked until resolved. |
| SEL-03 | Element has no source mapping. | Runtime inspection can remain readable; unavailable source actions explain the limitation. |
| EVD-01 | Ask what Save does. | Claims identify source, observation, interpretation, or unknown; references open relevant evidence. |
| EVD-02 | Change relevant source after recording an observation. | Old evidence is marked stale or historical and does not describe the new build as current. |
| API-01 | Trigger a successful Save. | A real request, actual response, timing, and runtime session are inspectable. |
| API-02 | Trigger delayed and failed Save outcomes. | Pending and error states appear; failed requests remain available for inspection and retry. |
| API-03 | Server tracing is not connected. | Foundation explicitly stops its explanation at the observed boundary. |
| AI-01 | Generate a proposal for loading/error behavior. | Intent, base revision, affected files, scope, and planned checks are visible. |
| AI-02 | Change source after proposal creation. | Stale proposal cannot silently overwrite new source; refresh/replan is offered. |
| AI-03 | Cancel during work. | New operations stop; completed edits and remaining processes have an explicit status. |
| AI-04 | Provider or tool fails. | Context is retained, useful failure output is shown, and retry does not duplicate applied work. |
| EDT-01 | Apply a supported visual or scripted source change. | Source changes are reviewable and the preview reflects the new build; transient experiments remain distinct. |
| EDT-02 | Edit a shared token or component. | Affected scope is shown before application; no hidden promotion from local to shared scope occurs. |
| EDT-03 | Undo after a disjoint user edit. | Foundation's edits are reverted and the user's disjoint edit remains. |
| EDT-04 | Undo after an overlapping user edit. | Conflict is exposed; no unrelated or overlapping user content is silently overwritten. |
| VER-01 | Typecheck passes but interaction has not run. | Compilation passes; interaction and visual verification remain unverified. |
| VER-02 | A check fails, is cancelled, or becomes stale. | Each state is distinct, output is inspectable, and rerun uses the current revision. |
| REV-01 | Accept a reviewed change. | Decision and evidence are retained; no implicit commit, publication, or deployment occurs. |
| SYS-01 | Disconnect runtime or model provider. | Editing/source access remains usable; disconnected capabilities are explicit. |
| SYS-02 | Restart with pending work or accepted history. | Recoverable state is restored; old runtime observations do not become current by default. |

For the prototype, run the cases its implemented capabilities support and mark the rest as pending product acceptance. Do not weaken a requirement merely to make a limited fixture pass.

## Visual and accessibility inspection

Inspect dark and light themes at 1440 × 900, 1280 × 800, and 1024 × 768. At 768 px, verify that primary content remains usable and secondary panels collapse deliberately. Exercise long names, deep paths, many requests, large errors, empty results, and failed checks.

Check panel alignment, spacing rhythm, readable contrast, active selection, provenance labels, source wrapping/scrolling, divider hit targets, and status hierarchy. Ensure the preview's selected outline does not obstruct its own controls. Compare before/after states at the same size, theme, scenario, and zoom.

Complete the signature workflow using only the keyboard. Confirm visible focus, sensible tab order, editor shortcut preservation, dismissible overlays, focus return, and accessible names. Check 200% zoom, reduced motion, and screen-reader access to selection, evidence, task state, and verification results. Test useful announcements rather than relying only on an automated accessibility score.

## Platform feasibility tests

| Platform | Maintained fixture | Required evidence |
| --- | --- | --- |
| Web | React/TypeScript form with shared Save component, latency/error states, and an actual local endpoint. | Mapping, request capture, scoped edit, preview update, checks, and safe undo. |
| SwiftUI | Xcode project with Save state, explicit networking, and a supported iOS Simulator target. | Actual build/test output, capture or Simulator evidence, documented mapping support or limitation. |
| Expo | React Native/Expo iOS development build with shared Save component and explicit networking. | Runtime connection, validated component inspection, request evidence, scoped source change, and platform checks. |

Record host, toolchain, framework, adapter, and fixture versions for each run. A mock native screen or web rendering of a native concept does not pass the native gate.

## Moderated research script

Recruit five representative design engineers for the first formative study, including people with differing depth in code and visual tooling. This is a qualitative risk-finding sample, not a statistically representative benchmark. Use a fresh project session per participant and do not teach the signature workflow first.

Introduction: “We are evaluating the tool, not your skill. Please explain what you expect and what you believe the tool knows. Some capabilities may be unavailable.”

| Task | Neutral prompt | Observe |
| --- | --- | --- |
| Orient | “Open this project and find whether the product is ready to run.” | Whether separate readiness states are understood. |
| Understand | “Find the Save control and explain what happens when it is used.” | Selection continuity, source navigation, evidence interpretation. |
| Investigate | “Save appears slow. Find out what you can establish about that.” | Actual request inspection and recognition of visibility limits. |
| Improve | “Make the loading and failure behavior clearer.” | Proposal comprehension, scope prediction, and source authority. |
| Review | “Decide whether this change is ready to keep.” | Distinction between compile, interaction, and visual results. |
| Recover | “You want to undo Foundation's change, but keep this separate edit.” | Safe recovery understanding and trust. |
| Handle uncertainty | “This selected control has two possible source locations.” | Response to ambiguity without unsupported mutation. |

After each task ask the participant to explain what they believe happened and what remains uncertain. Do not ask leading questions such as “Did you notice the provenance badge?” Record where they inferred more than the evidence supported.

Capture completion with/without assistance, time to a correct explanation, misinterpretations, critical errors, recoveries, and confidence on a simple five-point scale. Obtain consent for recordings and avoid unrelated private repository material.

Formative acceptance target: at least four of five participants complete the core trace-and-review workflow without facilitator instruction; every participant recognizes that a passing typecheck alone does not prove the visual or behavioral result; no participant is led into a data-loss action by misleading scope or undo behavior. Any critical failure triggers a design correction and targeted retest before advancing.

## Release evidence record

For each gate, retain a short record containing:

- Artifact and revision, test environment, and supported capability matrix.
- Commands and actual results, including failures and unavailable checks.
- Screens or recordings for the inspected states, with reviewer findings.
- Research observations and unresolved usability risks.
- Known limitations, recovery instructions, and gate decision.

Keep observed outcomes separate from planned work. “Build passed,” “workflow passed,” “visually reviewed,” and “distributed to users” are different claims and require different evidence.
