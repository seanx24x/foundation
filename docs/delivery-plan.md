# Foundation delivery plan

## Current execution ledger

Use the [master product checklist](product-checklist.md) for current implementation status, acceptance evidence and next actions. Its M0–M5 sequence extends this original blueprint; historical milestone descriptions below are not current capability claims.

## Delivery model

Ship in evidence-gated increments. The blueprint and web prototype establish the product contract and one connected workflow. They do not stand in for the Code OSS fork, real model integration, or native adapters.

Each gate produces a runnable artifact, reproducible validation, a capability statement, and a short decision record. Unmet criteria stay visible in the backlog. Avoid assigning calendar estimates until the editor and native feasibility spikes establish their integration cost.

## Milestone 0: blueprint and web feasibility prototype

**Purpose:** make the experience concrete and expose its core technical and usability risks.

Deliver the six blueprint documents and a dedicated local prototype with an instrumented web fixture. The walkthrough must connect selection, source, a real request, a scripted bounded proposal, actual source editing, executable verification, and review/undo. Label the deterministic proposal and the adapter boundary plainly.

Acceptance requires running the local checks and build, manually inspecting the rendered workflow, exercising failure and recovery, and confirming that unrelated repository files are outside the change operation. Record which validation categories were completed; do not infer visual quality from a successful build.

## Increment 0.2: local project workbench

The [local workbench increment](workbench-increment.md) extends the web feasibility
prototype with real folders, multiple source files, source analysis, an instrumented
sample preview, guarded session changes, and a configurable streaming source assistant.
It implements useful parts of the project lifecycle and shared context work while
leaving the Code OSS host and native feasibility gates open. Provider answers are
read-only; autonomous implementation and durable review still require isolated change
infrastructure. See the verification record for what was exercised.

## Gate 1: feasibility across the chosen foundation

| Work package | Dependencies | Deliverable | Exit criterion |
| --- | --- | --- | --- |
| F1 — Code OSS host spike | Blueprint | Branded development build with Foundation activity surfaces and local service integration. | Open/edit/search/debug a representative project while selection and review surfaces function; restart and cancellation work. |
| F2 — Web adapter | Prototype contracts | Maintained React/TypeScript fixture with instrumented selection, source mapping, request capture, and supported source edits. | Signature Save flow passes in success, latency, failure, ambiguous mapping, and stale-source cases. |
| F3 — Change ownership | F2 | Bounded apply/undo service with source revision checks. | Undo preserves disjoint user edits and rejects overlapping conflicts without data loss. |
| F4 — SwiftUI adapter spike | F1; available Xcode toolchain | Maintained SwiftUI fixture, build/test integration, capture/Simulator evidence, documented mapping strategy. | Demonstrate each claimed capability live; unsupported mapping remains explicit and blocks direct edits. |
| F5 — Expo adapter spike | F1; supported iOS development build | Maintained React Native/Expo fixture with validated inspection and request capture. | Complete supported Save workflow and publish a version-specific capability matrix. |
| F6 — Extension and update audit | F1 | Required extension inventory, license/availability assessment, upstream patch inventory. | A viable daily coding extension set and a reproducible upstream update trial. |
| F7 — Moderated workflow study | F2–F3 | Session observations, completion/error measures, prioritized findings. | Participants correctly interpret evidence and scope; no unresolved data-loss or misleading-verification failure. |

Web, SwiftUI, and Expo have separate feasibility outcomes. A passing web spike does not unlock a native support claim. If a native capability fails, keep the adapter limited and revise the product promise before expanding it.

## Gate 2: personal alpha

**Purpose:** make Foundation dependable for one person's daily supported-project workflow.

Implement in this dependency order:

1. **Project lifecycle and host stability.** Open recent folders, discover targets, separate readiness states, manage service lifecycle, and preserve standard editor operations.
2. **Shared context and intelligence.** Connect entities, references, evidence freshness, source navigation, and focused dependency exploration.
3. **Real AI task execution.** Configure a provider, expose context/usage, produce bounded proposals, cancel operations, and recover from tool/provider failures.
4. **Change and verification infrastructure.** Isolate edits, detect stale proposals, retain independent checks, support reruns, and provide safe accept/undo.
5. **Visual refinement.** Implement a deliberately limited property set with explicit instance/component/token scope, named scenarios, themes, and sizes.
6. **Platform hardening.** Bring only the native capabilities that passed feasibility into the same workspace contracts.
7. **Usability and resilience.** Complete keyboard access, light/dark themes, reduced motion, layout persistence, onboarding, failure recovery, and performance budgets.

Alpha exit requires a representative daily coding session without dependence on the prototype fixture, a complete Save workflow on every advertised target, and validated preservation of unrelated edits. Provider or runtime outages must leave ordinary code editing usable.

## Gate 3: professional beta

**Purpose:** support reliable installation and sustained use by external practitioners.

| Area | Required work | Release evidence |
| --- | --- | --- |
| Distribution | Signed macOS packages, updater, rollback/recovery, documented requirements. | Clean-machine install, update, and recovery runs. |
| Compatibility | Representative project corpus, required extension matrix, supported framework/toolchain versions. | Reproducible regression results and explicit known limitations. |
| Performance | Large repositories, incremental indexing, cancellation, memory and CPU profiling. | Measured interaction latency and resource use on documented hardware. |
| Review history | Durable local decisions and evidence tied to source revisions. | History survives restart and correctly marks stale references. |
| Privacy and context | Provider configuration, visible sharing, credential storage, retention controls. | Tests for context boundaries and no secret leakage in captured evidence. |
| Team review | Bounded shareable artifacts, permissions, revision provenance, revocation. | Review recipient can identify scope and verification without access confusion. |
| Supportability | Structured diagnostics, opt-in reporting, migration and recovery paths. | A failure can be diagnosed without exposing project content unnecessarily. |

Android, deeper native macOS workflows, advanced motion tooling, and broader collaboration follow validated demand and capability. They are not prerequisites for a coherent first beta.

## Initial engineering backlog

| Order | Task | Acceptance evidence |
| --- | --- | --- |
| 1 | Reproduce the prototype from a clean install. | Commands succeed; complete walkthrough captured with actual outcomes. |
| 2 | Create the Code OSS host branch and isolate Foundation workbench integration. | Patch inventory and runnable host spike. |
| 3 | Extract shared selection/evidence/change contracts from prototype assumptions. | Host-service contract tests and one end-to-end connected selection. |
| 4 | Replace fixture-only mapping with a supported React instrumentation path. | Resolved, ambiguous, and unavailable mapping fixtures. |
| 5 | Harden source edits and ownership. | Concurrent/disjoint/overlap/undo acceptance cases. |
| 6 | Add provider-backed planning and execution behind the same proposal contract. | Context visibility, cancellation, stale-plan, and provider-failure cases. |
| 7 | Complete independent verification orchestration. | Check outputs tied to the current revision; stale results identified. |
| 8 | Complete Xcode and Expo spikes independently. | Live evidence and capability matrix for each. |
| 9 | Run the moderated study and resolve critical findings. | Research report with observed errors and retested fixes. |
| 10 | Expand to personal alpha project coverage. | Representative project acceptance suite and daily-use results. |

## Risks and decisions

| Risk | Early signal | Response |
| --- | --- | --- |
| Fork maintenance grows rapidly | Frequent deep upstream conflicts or editor regressions. | Reduce custom workbench patches and reevaluate extension boundaries before expanding features. |
| Source mapping is unreliable | Wrong edit target or unresolvable shared component identity. | Narrow supported syntax/framework cases; keep ambiguity visible and mutation disabled. |
| Native inspection is weaker than expected | Capture exists but interactive mapping cannot be established. | Ship honest capture/build/review capabilities; do not imitate a live inspector. |
| AI scope is difficult to predict | Unexpected shared changes or task drift. | Strengthen proposal scope, ownership checks, and change review before adding autonomy. |
| Evidence creates false confidence | Participants read a typecheck as proof of behavior or visual quality. | Change labels and grouping; repeat comprehension testing before release. |
| Feature breadth dilutes craft | Many panels without a complete reliable workflow. | Prioritize the signature workflow and daily coding over new feature categories. |

The implementation owner records a gate decision with passed criteria, failures, known limitations, and the next smallest useful increment. Advancement is based on demonstrated behavior, not the number of completed screens.
