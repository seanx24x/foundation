# Investigation checkpoints

Foundation 0.23 adds an explicit continuation path to a completed source-investigation answer. Each chain is limited to three model attempts and two local source-analysis attempts. The initial Ask is outside those limits. Preparation, source analysis and sharing are separate user actions.

## Workflow

1. Open a completed source-investigation answer and choose **Continue investigation**.
2. Review the original question, preceding explanation, saved relationship result, selected anchor source, available target files and attempt limits. Edit the prompt, then explicitly Send in Plan mode.
3. The model either finishes or proposes one advertised source target with a rationale. A proposal does not run anything.
4. Choose **Run investigation** to analyze that saved target locally. Inspect the result before sharing it.
5. Choose **Share result** to prepare the next model request, then explicitly Send. Repeat within the remaining budget or End the chain.

The model chooses a host-advertised target ID. It cannot supply a shell command, arbitrary path or source edit. Target files come only from disclosed source relationships; successful targets are not revisited. The last model slot can only finish. Static source relationships do not establish runtime or backend behavior.

## Context and evidence

The provider receives the visible prompt, one saved anchor file and the exact disclosed continuation envelope: original question, last complete answer or decision, bounded source investigation, available targets and attempt budget. It receives no whole conversation, complete project inventory, environment, unsaved draft, unsupported command or unshared local result. The local result is sent only by the next explicit Send.

Source and model explanations are untrusted data. Provider-native tool calls remain disabled. A complete structured decision is validated against its advertised targets; malformed, refused, truncated, cancelled or incomplete output grants no runnable action. Partial answers remain inspectable but are not forwarded as a preceding explanation.

The complete saved inventory is reread locally and checked against the result's digest before sharing, before local analysis and before accepting a model decision. Changes, additions, removals, ignore-rule changes, unreadable sources and incomplete inventories prevent continuation. Affected unsaved drafts block sharing. An unrelated draft remains outside the request. A stale chain can be ended; a new source investigation must establish a new basis.

## Durability and cancellation

Conversation schema8 owns the immutable request context, structured decisions, local attempt records and the chain's End marker. Model and local attempts are reserved durably before dispatch. Failed, stopped and interrupted attempts consume their slots. Retries are explicit and use the remaining budget; no sibling continuation can reset a chain's count.

Restart restores saved checkpoints without contacting a provider or rerunning source analysis. Unfinished work becomes interrupted. An unsent prepared request requires explicit preparation and current-source validation after reload. A successful local result remains local until explicitly shared. Retrying conversation storage never dispatches work.

Stop addresses the exact active request or local attempt. Late results cannot replace a newer decision or a removed preparation. End preserves prior evidence. Project, feature, conversation, view and source ownership are checked across asynchronous work. Source code, unrelated drafts and the editor's layout remain outside the chain's mutation scope.

## Verification

Implementation and acceptance are tracked in [the product checklist](product-checklist.md), M2.09h.5g.3. Packaged native, visual and installed-app acceptance are recorded separately from unit and renderer tests in the versioned verification artifact. Live provider quality, autonomous loops, arbitrary shell tools and broader platform support are outside this increment.
