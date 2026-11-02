# Source investigations — Foundation 0.22

An investigation connects the saved-source Relationships view to a question in Assistant. It is a bounded, local analysis result. Its findings are labeled From source; the model's explanation remains AI interpretation. Neither establishes runtime order, backend behavior, passing tests or coverage.

## Investigate, inspect, then send

Choose **Ask about relationships** in Understand. Foundation prepares the focused analysis in Ask mode and retains an existing typed question. Preparation reads saved source locally and makes no provider request. The Source investigation card exposes the relationship evidence, request sites, omissions and limits before sharing.

**Send** shares the edited question, the complete selected anchor file and the exact disclosed investigation result. Related file contents, filename-only test candidates, the complete inventory, environment, tool output and unrelated conversation history are excluded. Paths and labels within the disclosed relationships are shared. The anchor file's contents are shared as shown, including any literals in that file; sanitized request summaries do not redact the separately selected source.

The provider receives a read-only data envelope with stable evidence labels. Content from source files and relationship labels is data, never authority to invoke tools or change permissions. Existing OpenAI, Anthropic and compatible text adapters remain in use. This handoff has no model-native tool calls and cannot edit source or run a project command.

## Revisions and recovery

Every result records its project, feature, anchor revision, source-basis digest and immutable result digest. The complete safely read inventory stays local. Foundation checks its saved revisions before preparing, dispatching and completing the question. Changed, newly included, deleted, ignored or unreadable contributing sources require a fresh investigation.

Unsaved edits are excluded. An unsaved anchor or displayed relationship endpoint blocks sharing until its draft is resolved. Unrelated drafts stay untouched. A project, feature, conversation or request change retires pending work; stopping a response keeps any partial answer without marking it complete.

The unsent result can be inspected after restart, but **Refresh investigation** is required before sending. Refresh is an explicit local analysis, not a provider call. It creates a new result; the original shared result in conversation history remains immutable and historical. **Remove investigation** keeps the question and returns to ordinary source selection.

## Bounds

The first tool uses the existing JavaScript/TypeScript saved-source relationship analyzer. Its shared envelope contains at most 24 relationships, eight request sites and twelve analysis boundaries, within 32 KiB. Missing findings and analysis limits are disclosed. Full-inventory verification can prevent sharing an incomplete or unreadable analysis even when the local Relationships view can display partial findings.

The underlying inventory remains limited to 1,500 files and 8 MiB, with syntax-depth and node limits. Package resolution, configured aliases, dynamic dispatch, uninstrumented server activity, SwiftUI ownership and React Native runtime behavior are not inferred. The tool does not execute package scripts, compiler plugins or configuration files.

Model-selected investigation, automatic continuation, multi-step tool budgets and dependency-safe partial acceptance remain separate checklist work. See the [running checklist](product-checklist.md) for the current acceptance state.

`npm run desktop:source-investigation-smoke` exercises the packaged workflow in a disposable project and profile with a loopback model fixture. It checks two explicit sends across two app processes; it does not establish live-provider quality or native visual acceptance.

[0.22 verification](../artifacts/verification-v0.22.md) separates automated and packaged checks, native visual acceptance and installed-app preservation from live-model answer quality.
