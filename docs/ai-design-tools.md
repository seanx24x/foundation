# AI and design tools in Foundation 0.10

Foundation connects native AI artifacts, durable conversations, an isolated design sandbox, and an instrumented running web project. See [native AI artifacts](native-ai-artifacts.md), [durable conversations](durable-conversations.md), and [connected web runtime](connected-web-runtime.md) for those distinct surfaces.

The design sandbox provides a saved-source React preview, measured element inspection, CSS token experiments, and reviewable source proposals. The connected runtime uses a supported project's own development server and records actual request metadata. The native editor remains authoritative. AI and manual design controls prepare changes for the same review flow; opening a preview or answer never writes source.

## Try the sandbox workflow with Orbit

1. Open the bundled `projects/orbit` folder in the Foundation desktop app. Source analysis and preview compilation require workspace trust. Preview can start while native editor drafts are open: it uses the last saved source and labels those drafts as not included. Save a draft only when you want it included in the next preview.
2. Choose **Refine → Saved-source sandbox**, keep `src/App.tsx` as the **React entry**, and select **Start preview**. Foundation compiles the supported saved modules and waits for the canvas to report that it rendered.
3. With **Inspect** enabled, select the Save button. The inspector shows its annotated source path, measured dimensions, and computed properties such as color, type size, padding, and corner radius. Use the source link to open the native editor.
4. Try **Desktop · 960**, **Tablet · 768**, and **Phone · 390**, then switch between **Light** and **Dark**. **Fit** scales the presentation to the available panel; the selected viewport width remains fixed. Turn Fit off for 100% inspection. Theme switching sets the preview's `data-theme` attribute; the project must supply styles for that theme.
5. In **Design tokens**, choose a declaration such as `--orbit-radius` or `--orbit-space`, then change its **Experiment value**. The canvas updates and labels the experiment. Source has not changed. **Reset experiments** removes these temporary overrides.
6. Select **Review token change**. Review the affected file, declaration scope, and before/after source in **Review**. **Open native diff** opens the exact source comparison in the editor.
7. Select **Apply to source** when the change is appropriate. The old preview becomes stale. Choose **Inspect result** to rebuild it from the new saved source; check relevant themes, sizes, and interactions yourself.
8. Use **Undo Foundation change** to restore that proposal's exact source baseline, provided the file has not changed again. Other files remain untouched. If the result should remain, **Dismiss checkpoint** keeps the source change and ends this proposal's guarded undo checkpoint, allowing the next proposal.

The token workflow works without an AI provider. For AI, configure OpenAI, Anthropic, or a compatible provider, then use **Ask AI to refine this** on a mapped element, or open the right-hand **Assistant** sidebar directly. Check **Shared context**, inspect the saved snapshots, select **Propose change**, and describe the desired edit. The selection shortcut opens the mapped source and prepares a prompt; it does not send a request by itself.

## Ask and Propose change

**Ask** answers a question about selected source and any explicitly included runtime observations. **Propose change** requests a structured edit to one existing file from that context. Both use the selected provider's native protocol—OpenAI Responses, Anthropic Messages, or compatible Chat Completions—disclose saved source revisions, support cancellation, and leave source unchanged while the model responds.

A change response must finish normally and produce valid structured output. Foundation checks that every exact source anchor occurs once, edits do not overlap, all edits target one selected file, and the resulting source is within supported limits. A malformed, truncated, cancelled, out-of-context, or stale response produces no applicable proposal. This validates the edit's scope and source correspondence, not its correctness or successful compilation.

Up to eight selected files totaling 64 KiB may provide context, optionally accompanied by up to twelve checked request observations from the desktop's current connected runtime. The host validates the session and active trusted project before sharing those records. Bodies, headers, screenshots, and inferred backend traces are excluded. Observations remain unattributed to a specific interaction. The proposal can contain up to 24 exact edits in one existing file. It cannot create or delete files, execute commands, inspect unselected source, install dependencies, run tests, or deploy. Previous conversation turns are not automatically sent. Model citations and explanations remain interpretation tied to the supplied evidence.

A real provider is still a user configuration step. Implementation tests use local protocol fixtures and deterministic responses; they do not establish commercial-model quality or indicate that an external model has been connected or charged. See [AI provider setup](ai-provider.md).

## Source changes and recovery

Review shows the proposal's origin, target file, baseline revision, summary, and suggested checks. A proposal is not an applied change, and an applied change is not a verified result.

Apply rechecks the trusted project, selected context revisions, and native editor drafts. The project service compares saved source with the expected baseline before replacing the file. Concurrent Apply requests are serialized. If context or source has changed, Foundation blocks the old proposal instead of guessing how to merge it.

The latest proposal/checkpoint for each project is stored locally in Foundation's workspace storage. It contains its before/after source and revision context so it can be restored after a restart. Native conversations also persist their answers, original saved source, and explicitly selected runtime evidence; historical evidence does not restore a live connection. Live canvas experiments remain temporary, and the browser workbench's chat remains session-local. Git remains the source of truth for commits and general working-tree review.

Undo is guarded: it succeeds only while the target matches the source Foundation applied and has no native editor draft. If a newer edit exists, use the native diff and editor to reconcile it. Discarding a proposed change does not write source. Dismissing an applied checkpoint retains the applied file; it removes the proposal's undo path and does not create a commit.

## Sandbox preview and inspection boundary

The design canvas compiles the last saved client source into an iframe sandbox with network access disabled. Unsaved native editor drafts stay intact and are explicitly excluded from that preview; previewing never saves or discards them. Project code runs in the browser sandbox, not in the extension host or a shell. Starting it does not run the project's `dev`, `build`, or other scripts.

Supported entries export a React component as `default` or named `App`. The current host supports a dependency graph of up to 64 local files and 512 KiB of source, using React, relative JavaScript/TypeScript modules, plain imported CSS, and JSON. Other packages, framework build features, dynamic imports, `import.meta`, CSS modules, CSS `@import`, and unsupported asset imports require the project's own build pipeline and produce an explicit limitation. Remote images, fonts, API requests, and form navigation are unavailable in this sandbox.

Orbit's save request therefore cannot prove successful server behavior in this sandbox. Turn Inspect off to exercise available client interactions. For real network behavior, use a supported instrumented target in [Connected web runtime](connected-web-runtime.md); that surface runs the project's development server and exposes captured request metadata. The sandbox does not fabricate API responses or backend evidence, and its token experiments do not automatically affect the connected target.

Source links rely on explicit annotations such as:

```tsx
<button data-foundation-source="src/components/SaveButton.tsx">
  Save changes
</button>
```

The annotation must name a source file included in the preview. Selecting a descendant uses its closest annotated ancestor. Geometry and styles describe that annotated element. An unannotated or unresolved element remains unmapped; Foundation does not infer a precise DOM-to-source location from appearance. These links identify a file, not a compiler-proven JSX expression or arbitrary element edit target.

Token declarations retain their CSS selector scope and occurrence, including separate theme declarations. Experiments override supported selectors only in the canvas; unsupported nested or complex scopes report that they could not be previewed. The source proposal still requires review. Changing a shared declaration may affect every consumer. The current value editor accepts a conservative set of colors, numbers, and lengths; complex expressions remain editable in the native source editor.

## Evidence remains separate

- **Preview compilation** means the supported preview modules transpiled. It is not a full project build or a TypeScript type check.
- **Preview connected** means the sandbox acknowledged rendering its source snapshot. It is not proof of successful interaction or visual acceptance.
- **Measured properties** come from that rendered sandbox element. They are not measurements of a separately running production app.
- **Connected request observations** come from the instrumented development runtime. They report method, sanitized URL, status, duration, outcome, session, and time. They do not establish interaction causality, backend traces, response bodies, or successful verification.
- **Saved observations** in Assistant are immutable historical context from that request. Reopening a conversation neither reconnects the app nor shares that context again.
- **Suggested verification** comes from the proposal and has not been executed. Interaction and visual review remain separate checks.

Changes to saved source on disk mark older preview evidence stale. An unsaved editor buffer alone does not invalidate that saved snapshot; it is labeled as not included. Save and rebuild to inspect the draft, or rebuild after other saved-source changes before relying on the next measurement. Connected web targets require supported Vite instrumentation and validated source mappings; arbitrary uninstrumented app attachment is not supported. Automatic screenshot comparison, a states/motion timeline, SwiftUI/Simulator and Expo adapters, multi-file autonomous agents, and automated end-to-end verification remain future work.

## Verification sources

`tests/proposals.test.mjs` exercises exact source anchors and theme-scoped token edits. `tests/assistant.test.mjs` and `tests/assistant-providers.test.mjs` exercise compatible/native streaming, context limits, malformed responses, stale revisions, cancellation, and explicit runtime evidence. `desktop/extension/test/proposal-session.test.mjs` uses temporary real projects to test apply, undo, restart recovery, concurrent requests, native-draft guards, symlink rejection, and preservation of newer or unrelated edits. Provider-host, runtime-host, and conversation-store tests cover credential isolation, source selection ownership, and persisted context. Preview, connected-runtime, renderer, and native smoke results are recorded separately; protocol tests do not establish live paid-provider or visual acceptance.
