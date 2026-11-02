# Foundation product blueprint

The normative v1 principles and signature-workflow direction are defined in [Product principles](product-principles.md), with the [design system](design-system.md) governing appearance and interaction. The capability priorities below remain the product roadmap.

## Product intent

Foundation helps design engineers understand, build, and refine software by connecting the running product to its code, data, and behavior. AI operates in that shared context, proposes bounded work, and returns changes with evidence.

The primary audience is a design engineer working directly in a repository on a web or Apple-platform product. They can read code but often need to move between component behavior, interface detail, API boundaries, and implementation. The first customer is a solo practitioner; small product teams follow after the individual workflow is dependable.

The first desktop host is macOS. The initial integration targets are React/TypeScript web applications, SwiftUI projects using Xcode, and React Native/Expo applications using an iOS development build. Platform coverage is a capability matrix, not a claim of identical tooling on each target.

## The product promise

“Show me what this part of the product does, help me change it, and show me what happened.”

That promise organizes the interface into four activities:

| Activity | User question | Primary result |
| --- | --- | --- |
| Understand | What is this, and how does it work? | A focused explanation with source references and observed behavior. |
| Build | How should we implement the change? | An editable plan, bounded proposal, source changes, and diagnostics. |
| Refine | How should it look and respond? | Source-backed adjustments across states, sizes, themes, and motion. |
| Review | Is this the intended result? | A combined code, visual, and behavioral review with explicit verification outcomes. |

These are arrangements of a shared workspace. Switching activities must preserve the selected entity, target, scenario, and active task. A user should not need to explain the same context again to a second panel.

## Principles and their consequences

1. **The running product is an entry point.** Selecting a visible element should reveal source and behavior when mapping is available. Missing mapping remains visible and recoverable.
2. **Code is authoritative.** A visual experiment must be labeled as an experiment until a reviewed operation writes it to source. A changed preview alone is not a completed implementation.
3. **Explanations carry evidence.** Every explanation separates source facts, observed runtime events, AI interpretations, and unknowns. Source references open at the relevant location.
4. **Context persists.** Selection connects preview, source, inspector, request trace, agent task, and review. Changing focus should be deliberate and reversible.
5. **Scope precedes change.** Show the affected files, components, instances, and shared tokens before applying work. Broad scope is a product decision, not an incidental consequence of an inspector control.
6. **AI is inspectable and interruptible.** Show its task, supplied context, current operation, resulting changes, and verification. Cancellation has a visible outcome and does not discard unrelated work.
7. **Craft supports concentration.** Prefer stable geometry, clear typography, restrained emphasis, and responsive feedback. Do not trade readable code and dense information for ornamental surfaces.
8. **Honesty survives failure.** A failed check, stale observation, unsupported adapter, or missing server trace remains explicit. The UI offers the next useful action without inventing certainty.

## Product position

Foundation's primary differentiator is the continuity between a product element, its implementation, its observed behavior, and a reviewed change. Advanced editing and AI assistance are necessary infrastructure. The distinctive experience is answering product questions with evidence and then carrying that evidence through implementation.

Measure the product against today's actual tools during research, rather than relying on a permanent claim that a competitor lacks a feature. The differentiation is a coherent workflow and execution quality, not an unverified checklist comparison.

## Prioritized capability map

| Priority | Capability | Minimum useful outcome | Release gate |
| --- | --- | --- | --- |
| P0 | Project readiness | Discover a supported target and explain indexing, build, runtime, and mapping readiness independently. | Personal alpha |
| P0 | Connected selection | Select a fixture element and keep its source, explanation, and review in sync. | Feasibility |
| P0 | Evidence provenance | Distinguish source, observation, interpretation, unknown, and stale evidence. | Feasibility |
| P0 | Request inspection | Show a real instrumented request, outcome, duration, and visibility boundary. | Feasibility |
| P0 | Scoped proposal | Review the intent, source revision, affected files, and shared effects before application. | Feasibility |
| P0 | Recoverable editing | Apply and undo Foundation changes without overwriting unrelated work. | Feasibility |
| P0 | Separate verification | Report compilation, interaction, and visual results separately. | Feasibility |
| P0 | Professional editor | Preserve editing, navigation, search, terminals, diagnostics, Git, and keyboard workflows. | Personal alpha |
| P0 | AI provider integration | Configure a provider, inspect shared context and usage, cancel work, and recover from failures. | Personal alpha |
| P0 | Source-backed visual controls | Adjust supported properties with explicit instance, component, or token scope. | Personal alpha |
| P1 | Focused dependency exploration | Follow a selected feature through known components, handlers, data consumers, and tests. | Personal alpha |
| P1 | Reproducible scenarios | Save meaningful product states and rerun them after changes. | Personal alpha |
| P1 | Native adapters | Complete the Save workflow with explicit capabilities and limitations on SwiftUI and Expo. | Separate platform feasibility gates |
| P1 | Review history | Retain accepted decisions and verification tied to a revision. | Professional beta |
| P1 | Reliable distribution | Install, update, recover, and use documented compatible extensions. | Professional beta |
| P2 | Team review | Share bounded review artifacts with permissions and clear provenance. | Professional beta |
| P2 | Motion tooling | Inspect transitions, interruptions, timing, and reduced-motion variants. | After static refinement is dependable |
| P2 | Broader platforms | Add Android and deeper native macOS workflows after individual capability validation. | After initial native gates |

P0 is the smallest trustworthy core, not a promise that all P0 capabilities exist in the web prototype. The current prototype validates the connected workflow in one instrumented web fixture; the remaining rows are implementation requirements.

## Signature scenario

A designer selects a Save button. Foundation identifies the component and relevant source, shows that Save sends a request, and makes the runtime evidence inspectable. The designer asks for clearer loading and error behavior. Foundation proposes a bounded change, identifies whether it affects a shared component, and applies the accepted scope. The designer checks code and named visual states, reruns the scenario, then accepts or undoes the changes.

This scenario is intentionally small enough to expose the essential product risks: inaccurate mapping, unsupported claims, hidden shared scope, unreviewable AI output, weak verification, and unsafe undo.

## Success criteria

- A new participant can trace Save into its handler and an observed request without losing the original selection.
- Participants correctly distinguish what Foundation knows from source, what it observed, and what AI inferred.
- A participant can predict the scope of a visual edit before applying it.
- A participant can explain which checks passed and which outcomes remain unverified.
- Cancellation, reapplication, and undo preserve unrelated edits.
- Core editing remains usable while indexing, model calls, or runtime attachment are unavailable.

Research measures task completion, time to a correct explanation, critical errors, recovery, and confidence calibrated to actual evidence. It does not count speed alone as success.

## Boundaries and defaults

Keep local source and indexing local by default. Model providers receive the context needed for the chosen task, with visible sharing and usage. Publishing and deployment require explicit control. No credentials are bundled into the product.

The first release does not require a new text-editor engine, a complete graphical programming language, a Figma replacement, a universal tracing platform, or autonomous deployment. These exclusions protect the connected development workflow from becoming an unfinishable collection of unrelated tools.
