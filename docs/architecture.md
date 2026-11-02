# Foundation architecture and integration contracts

## Status and architecture decision

**ADR 001 — Use Code OSS as the desktop host.** The approved product baseline is a maintained fork with Foundation's workbench integrations implemented through narrow extension points and a separately testable local service. The React/Vite/Node prototype proves interaction and evidence boundaries; it is not the desktop fork.

The decision preserves an established editor, language tooling, navigation, debugging, terminals, Git integration, and accessibility while concentrating Foundation's investment on connected inspection, product understanding, visual refinement, and review. A new editor engine is outside the first release. Eclipse Theia remains a reconsideration option only if the feasibility spike identifies a specific blocking integration or maintenance cost.

Fork policy: keep Foundation-specific services outside upstream editor internals when possible; document every unavoidable workbench patch; record the upstream revision; run a representative compatibility suite on each update. Do not treat a large permanent patch set as free infrastructure.

Extension distribution uses Open VSX and individually compatible, licensed packages. Do not assume access to Microsoft's Marketplace or proprietary extensions. Audit the required extension set and each redistribution term before promising compatibility. Microsoft's published distinction between Code OSS and its distributed product informs this boundary: [VS Code FAQ](https://code.visualstudio.com/docs/supporting/faq).

## System boundaries

```text
Foundation workbench in Code OSS
    shared selection / activities / inspectors / review
                         |
                typed host-service boundary
                         |
    +--------------------+---------------------+
    |                    |                     |
Project intelligence  Agent runtime      Review / verification
    |                    |                     |
    +-------------- Runtime adapters ----------+
                         |
           web / SwiftUI-Xcode / Expo
```

| Subsystem | Owns | Must not pretend to own |
| --- | --- | --- |
| Editor host | Files, buffers, language services, commands, panels, terminal/debug integration, workspace identity. | Runtime truth that its adapters cannot observe. |
| Project intelligence | Symbol/reference indexing, source relationships, contracts, consumers, related tests, evidence freshness. | Inferred behavior presented as a proven runtime event. |
| Runtime adapters | Target attachment, capabilities, element mapping, measurements, events, supported operations. | Universal support for every framework or source syntax. |
| Agent runtime | Task context, planning, tool execution, provider selection, cancellation, usage, bounded change proposals. | Declaring success solely from a model's response. |
| Review and verification | Change ownership, snapshots, diffs, scenario runs, independent results, accept/undo, decision history. | Overwriting unrelated user edits or conflating checks. |

The prototype's local API binds to local development use and operates on its dedicated fixture. General repository access, arbitrary command execution, remote collaboration, and provider credentials require later production controls; a fixture API must not be exposed as a production service.

## Data flow: select, understand, change, verify

1. A runtime adapter reports an element and mapping candidates with its session identity.
2. The workbench sets shared selection; project intelligence resolves source references for the current source revision.
3. Evidence is assembled from source analysis and observed events. A model may explain it, but its interpretation remains a separate evidence type.
4. A task captures the selected context and base revision. The agent proposes edits with explicit scope and assumptions.
5. The review service validates that the proposal still applies, records ownership, and applies an isolated change set.
6. The runtime adapter observes the new build/session state. Verification runs against the changed revision.
7. Review presents the diff and independent results. Accept stores a decision; undo uses change ownership and conflict checks.

A source edit invalidates affected source-derived explanations and pending proposals. Runtime observations retain their original session and are marked historical or stale when used to describe a newer build. A change in the preview is not evidence that its source mapping remains correct.

## Minimum integration contracts

These are target internal contracts, not a claim that the prototype exports a stable public API. Keep the initial implementation small and version the host-service protocol when the desktop integration begins.

| Contract | Required information | Important invariant |
| --- | --- | --- |
| `ProjectContext` | Project identity, workspace root, selected target, source revision. | Paths resolve inside the selected workspace; adapters cannot silently change the root. |
| `SourceReference` | Project, relative file, optional symbol, source range, source revision. | A location is meaningful only against its recorded revision. |
| `ProjectEntity` | Stable identity, kind, display name, source references, known relationships. | A relationship carries its evidence and can be unknown. |
| `RuntimeSession` | Adapter, target, session identity, connection state, associated build/revision when known. | Do not invent a source revision when runtime association is unavailable. |
| `SelectionMapping` | Element identity, runtime session, resolved/ambiguous/unavailable state, candidates and evidence. | Direct source editing requires a resolved supported mapping. |
| `Evidence` | Provenance, claim, supporting references or event, revision/session, capture time, freshness. | AI interpretation cannot be relabeled as observed evidence. |
| `AdapterCapabilities` | Supported operations, unavailable reasons, platform/toolchain requirements. | The UI enables only operations the active adapter can perform. |
| `ChangeSet` | Intent, base revision, owned edits, affected entities/files, scope, status, verification references. | Apply/undo checks for overlapping later edits before writing. |
| `VerificationRun` | Category, scenario/command, revision/session, status, start/end, inspectable output. | Passing one category does not imply another passed. |

Use discriminated evidence so impossible combinations are difficult to represent:

```ts
type Provenance = 'source' | 'observed' | 'ai-interpretation' | 'unknown';
type Freshness = 'current' | 'stale' | 'historical';
type VerificationStatus =
  | 'pending' | 'running' | 'passed' | 'failed'
  | 'cancelled' | 'skipped' | 'unavailable' | 'stale';

type EvidenceOrigin =
  | { kind: 'source'; references: SourceReference[] }
  | { kind: 'observed'; sessionId: string; eventId: string }
  | { kind: 'ai-interpretation'; taskId: string; supportingEvidenceIds: string[] }
  | { kind: 'unknown'; reason: string };
```

The actual transport may be local IPC or a loopback service; choose it during the Code OSS feasibility spike based on lifecycle, cancellation, and packaging needs. Keep product state independent of transport so the prototype does not lock the desktop architecture into browser-only assumptions.

## Runtime adapter capability matrix

| Capability | Web: React/TypeScript | SwiftUI with Xcode | React Native / Expo |
| --- | --- | --- | --- |
| Source understanding | TypeScript/language-service references and project analysis. | Swift language intelligence and project configuration. | TypeScript/JavaScript analysis plus native boundaries. |
| Runtime presentation | Browser preview with development instrumentation. | Xcode preview captures and iOS Simulator verification. | iOS development build; supported debugger/runtime integration. |
| Element-to-source mapping | Instrumented component/element identifiers; ambiguity explicitly represented. | Requires validated instrumentation; a screenshot alone is insufficient. | Framework/runtime integration must be validated in the supported build. |
| Layout inspection | Measured DOM geometry and computed styles with source origin where supported. | Supported measurements/captures only; do not assume DOM-like inspection. | Supported layout/runtime inspection; capability varies by tooling. |
| Request evidence | Instrumented requests; server traces only when separately connected. | Explicit supported networking instrumentation. | Supported network capture with documented limitations. |
| Visual edits | Supported AST/source transforms with preview confirmation. | Bounded Swift source transforms after mapping validation. | Bounded component/style edits after mapping validation. |
| Verification | Typecheck/build, browser interaction, visual comparison. | Xcode build/test and Simulator/preview evidence. | Build/test and iOS runtime evidence. |
| Initial milestone status | Included fixture vertical slice. | Local tooling verified in 0.45; explicit iOS fixture build/tests in 0.46; native Swift editor intelligence from target compiler settings in 0.47. Native runtime integration remains open. | Local manifest/tooling readiness checks verified in 0.45; development-build/runtime feasibility remains open. |

Apple documents Xcode integration capabilities, including preview capture, but this is not proof of an independently embeddable live SwiftUI canvas: [Apple Xcode tooling](https://www.apple.com/ca/newsroom/2026/02/xcode-26-point-3-unlocks-the-power-of-agentic-coding/). React Native tooling has its own capability limits and native debugging requirements: [React Native DevTools](https://reactnative.dev/docs/react-native-devtools). Revalidate exact tooling versions during each adapter spike.

## Source edits and recovery

Use language-aware transforms for supported properties and constrained patches for reviewed agent edits. A visual inspector must not perform broad regular-expression rewrites across arbitrary source. If a transform cannot preserve semantics or identify scope, expose the source and explain the limitation.

A change set records the base content and its resulting owned edits. Before apply or undo, compare affected regions with current content. Disjoint user changes can be preserved; overlapping changes require a reviewable conflict. A recovery action never resets the whole repository as a shortcut.

Tasks have explicit lifecycle states and cancellation. A cancelled task may have applied edits; those remain a visible change set with a clear outcome. Checks also retain partial output and cancellation status. Retry is idempotent where possible and does not duplicate a completed edit or falsely reuse an old result.

## Local data, provider context, and permissions

Store project indexes, scenario definitions, change records, and review history locally by default. Keep transient runtime captures separate from durable project knowledge. Indexing must be incremental and interruptible; editing cannot depend on a complete index.

Provider context is assembled from the selected task and visible inclusions. Show what is shared, and avoid sending credentials or unrelated files. Treat repository text and captured external content as data, not instructions that can authorize tool actions. A provider's output cannot expand filesystem or deployment scope.

Use operating-system credential storage for configured provider secrets in the desktop product. External effects such as publication, deployment, or messages require explicit user control. The prototype does not need provider credentials because its proposal is scripted.

## Feasibility decisions to validate before alpha

- Embed the shared workspace surfaces in Code OSS without replacing ordinary editor behavior.
- Confirm lifecycle, restart, cancellation, and packaging for the local services.
- Measure source-mapping reliability and shared-component scope in maintained fixtures.
- Validate Xcode and Expo capabilities on actual supported toolchain versions.
- Audit a minimum useful extension set against licensing and Open VSX availability.
- Investigate Foundry inspection and change-ledger components as reuse candidates; adopt only after verifying current behavior, interfaces, and licensing.

These are planned experiments with pass/fail outputs, not hidden assumptions of the architecture.
