# Connect Foundation AI — 0.11

Foundation supports OpenAI's Responses API, Anthropic's Messages API, and OpenAI-compatible Chat Completions endpoints. You choose the provider, model, and saved context for each request. Answers stream into Assistant with reported token usage, retained source snapshots, and Stop. The desktop also offers **Propose change**, which prepares a single-file edit for review.

No provider is connected by default. Opening Assistant, selecting context, browsing history, and saving provider settings send no source. Sending begins only when you select **Ask** or **Propose change**. AI has no command or filesystem tools; source changes require **Apply to source** in the native review flow.

## Configure the desktop

Run **Foundation: Set Up AI** from the command palette, or use the Assistant's provider setup control.

1. Choose **OpenAI**, **Anthropic**, or **OpenAI-compatible**.
2. For a compatible provider, enter its API base URL. The native OpenAI and Anthropic choices use their official destinations.
3. Enter the provider's actual text-generation model identifier.
4. Enter your API key. A key is optional for a local compatible endpoint.

| Provider choice | API base URL | Request endpoint |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `/v1/responses` |
| Anthropic | `https://api.anthropic.com/v1` | `/v1/messages` |
| OpenAI-compatible | Your server's base URL, commonly ending in `/v1` | Base URL plus `/chat/completions` |

The wizard saves only after every input step completes. Cancelling a step leaves the existing settings and credentials unchanged. Setup does not make a validation request. **Configured** means the settings are structurally valid; the first explicit question tests connectivity, account access, and model compatibility. API usage is billed under your provider account.

Provider model and destination profiles are application-level settings in `foundation.ai.profiles`; `foundation.ai.providerKind` selects the active profile. Setting up Anthropic preserves the OpenAI and compatible profiles. Credentials stay in native secure storage under a key scoped to both provider kind and destination. Changing a destination cannot reuse a different destination's saved key. Workspace settings cannot redirect these application credentials, and keys never enter the webview or profile settings.

**Foundation: Remove Saved AI Key** removes the active destination's saved key. Other provider keys remain intact. For a local compatible provider, leaving the key blank in setup also removes that destination's saved key. Environment credentials must be removed from the process environment separately.

Disconnected or invalid configurations do not read secure storage. Complete environment-only configurations also avoid secure storage. Existing legacy desktop `baseUrl`/`model` settings and their saved key remain compatible when no new provider profile is selected and the effective provider is compatible. Native providers never fall back to that legacy key. Foundation does not install or start a local model.

## Configure the browser workbench server

The browser workbench uses the same provider protocols, configured through the Node server's environment. For example:

```sh
export FOUNDATION_AI_PROVIDER_KIND='openai'
export FOUNDATION_AI_BASE_URL='https://api.openai.com/v1'
export FOUNDATION_AI_MODEL='your-openai-model-id'
export FOUNDATION_AI_API_KEY='your-api-key'
npm run dev
```

For Anthropic, use `FOUNDATION_AI_PROVIDER_KIND='anthropic'`, `FOUNDATION_AI_BASE_URL='https://api.anthropic.com/v1'`, and your Anthropic model and key. For another provider, use `compatible` and its Chat Completions base URL. Omitting `FOUNDATION_AI_PROVIDER_KIND` preserves compatible mode.

A local compatible endpoint can run without a key:

```sh
export FOUNDATION_AI_PROVIDER_KIND='compatible'
export FOUNDATION_AI_BASE_URL='http://localhost:11434/v1'
export FOUNDATION_AI_MODEL='your-installed-model'
unset FOUNDATION_AI_API_KEY
npm run dev
```

This example assumes you have already installed and started the local provider and model. Foundation does not do that for you. HTTP is permitted only for `localhost`, `127.0.0.1`, or `[::1]`. Remote providers require HTTPS and a key. URLs containing credentials, queries, or fragments are rejected, and redirects are not followed.

Restart the server after changing its environment, then choose **Refresh provider status** in the browser Assistant. The browser receives readiness, provider hostname/kind, model, capabilities, and limits; the API key stays in the server process. Native application profiles take precedence over environment configuration when selected. Environment-only desktop configuration uses these same variable names.

The browser workbench provides source questions and session-local responses. It does not have the desktop's durable conversation store or connected-runtime evidence resolver. Supplying runtime observations directly to its assistant endpoint is not a supported way to attach evidence.

## Choose what to share

Open Assistant in the expandable right sidebar. Select saved files in **Shared context**, then expand **Inspect exactly what will be shared** to read their source and revisions. In the browser workbench, the equivalent disclosure is **Inspect saved context**. Enter a question and select **Ask**, or press Command/Ctrl+Enter.

Each request sends the current prompt, selected saved source, Foundation's instructions, and any included feature task context or explicitly selected desktop runtime observations. Previous conversation turns are never appended automatically. Unsaved editor drafts are excluded; the native host blocks sharing a selected file with an unsaved draft. Context allows up to eight files totaling 64 KiB, and prompts allow 6,000 characters.

Saved revisions are checked before dispatch. Changed files stop the request before contacting the provider. Refresh them, inspect the new snapshots, and send again. Valid source citations such as `[S1:12]` navigate to current source; the original snapshot remains available with the response. A citation is a reference to supplied evidence, not proof that the model's explanation is correct.

### Feature task context

A desktop feature can carry a title and an editable task brief. When that feature context accompanies a request, the host resolves the selected feature ID and revision against the active project's feature store. It shares a snapshot of the title, brief, feature identity, and revision. The title allows 80 characters and the brief allows 2,000; a brief can be empty. Changing the feature later does not change a previous request's snapshot.

The brief is user-owned task guidance, not runtime evidence or permission to execute tools. The current prompt takes precedence if it conflicts with the brief. Ask and Propose change receive the same context through OpenAI, Anthropic, and compatible protocols. A task cannot automatically add files, runtime observations, or previous messages to the request. Those remain separate selected context; the single-file proposal and source-revision guards still apply.

Malformed or unsupported task metadata is rejected before source reads or provider dispatch. A saved response retains the versioned task snapshot that accompanied its request; a streamed start or completion cannot replace it. Legacy requests without task context remain valid. The browser workbench has no desktop feature store or feature-selection interface.

### Include desktop runtime observations

Connect an instrumented running web project and exercise an interaction as described in [Connected web runtime](connected-web-runtime.md). In Assistant's **Runtime observations**, check the request records you want to share. Selecting an element or recording a request never adds it to AI context automatically. **Clear runtime context** removes the selection without removing the recorded requests.

At most twelve observations from the current connected session can accompany a request. The native host resolves their IDs against that session and active trusted project; the renderer cannot supply arbitrary evidence bodies. Missing records, disconnected sessions, and project changes block sharing until the context is reviewed.

Each shared observation contains an `R1`-style evidence ID, original observation/session identity, method, sanitized URL, HTTP status when available, duration, outcome, and capture timestamp. URL credentials, query strings, and fragments are removed. Request/response bodies, headers, screenshots, and inferred backend traces are not sent through this attachment path. The record remains **Observed** and **unattributed**: temporal proximity does not establish that the selected element caused the request. AI is instructed to distinguish this historical evidence from its own actions and cannot claim to have exercised or verified the app.

## Stop, history, and recovery

**Stop** revokes the native request's ownership and aborts the upstream stream. The retained partial answer stays available. This does not guarantee that the remote provider stopped processing or billing. Collapsing the sidebar preserves its conversation; a restarted app marks an unfinished saved request interrupted and never resumes it automatically.

Native conversations are saved in local, project-scoped workspace storage. The host persists the request intent, original saved source, and any included task context before dispatch; a failed initial write prevents sending. Completed, failed, and stopped responses retain those snapshots, provider kind/model metadata, reported usage, and associated artifacts. Streaming saves are periodic, so a process crash can lose the latest unsaved fragment.

Explicitly selected runtime evidence is saved with that turn as a validated versioned snapshot. **Saved observations** describes what was selected for the request; reloading history does not reconnect a runtime or establish current behavior. Start and completion events cannot replace the original source or evidence selection. Unsupported evidence versions or malformed stored records leave the backing data untouched and history unavailable until it can be recovered. See [Durable conversations](durable-conversations.md) for conversation limits, archive, and recovery behavior.

The browser workbench's answers and snapshots remain in the current browser session. Native history and review checkpoints are durable; preview experiments are temporary. History does not store provider credentials, but prompts, source, and responses may contain private content. Foundation does not automatically redact that content or promise encrypted history. Your provider controls processing and retention after it receives the selected context.

## Propose a source change

In the desktop, choose **Propose change**, inspect the selected context, and describe one focused edit. The completed answer must contain a structured proposal for one existing selected file. Foundation validates exact, unique, non-overlapping anchors and rechecks all selected source revisions after generation. Cancelled, incomplete, malformed, out-of-scope, and stale responses cannot become applicable proposals.

Use **Open native diff**, then **Apply to source** when the proposal is appropriate. Apply rechecks project identity, trust, saved revisions, and unsaved drafts. **Undo Foundation change** restores the captured baseline only while the target still matches Foundation's applied source; a later user edit blocks automatic undo. The current workspace checkpoint supplies Apply/Undo authority. Historical proposal cards cannot override a newer checkpoint.

The model cannot create/delete files, run commands or tests, install packages, or publish. Verification suggestions stay unrun. Text-only capabilities are explicit: image input and tool execution are unavailable in this increment. A provider tool request is rejected and never executed. See [AI and design tools](ai-design-tools.md) for the preview-to-source workflow.

## Protocol boundaries and validation

| Protocol | Streaming completion | Usage |
| --- | --- | --- |
| OpenAI Responses | `response.completed` with completed status; failed/incomplete responses remain partial | Input/output/total tokens, when reported |
| Anthropic Messages | `message_stop` following `end_turn` or `stop_sequence`; truncated responses remain partial | Input/output counts, including reported cache input counts |
| Compatible Chat Completions | SSE JSON text deltas followed by `[DONE]`; a change proposal also requires `stop` | `stream_options.include_usage`, when supported |

The OpenAI adapter sends `store: false`. Neither adapter supplies tools or prior provider conversation IDs. A selected model must support the corresponding text-streaming protocol; structural configuration does not establish compatibility. Primary references: [OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events), [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), and [Chat Completions streaming](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events). [Ollama's compatibility documentation](https://docs.ollama.com/api/openai-compatibility) describes its compatible endpoint.

Requests time out after 60 seconds. The assistant service permits two active requests, bounds provider streams to 1 MiB and answer text to 64 KiB, and preserves partial output after failure. Usage is provider-reported; missing usage is shown as **Usage not reported**, never estimated. Raw provider error bodies are not forwarded. Compilation, interaction, visual acceptance, and AI interpretation remain separate outcomes.

Isolated tests cover both native protocols and compatibility behavior with local HTTP fixtures: payloads, fragmented streams, usage, cancellation, malformed/partial replies, terminal events, redirects, tools, task-context boundaries, evidence boundaries, source drift, and guarded proposals. Native host VM tests cover profile/key isolation, setup cancellation, no network during configuration, runtime selection ownership, and trusted-project evidence resolution. Store tests verify immutable task/evidence snapshots across restart, legacy records without task context, and preservation of unsupported records. Relevant suites are `tests/assistant*.test.mjs`, `tests/proposals.test.mjs`, and the extension's `provider-host`, `runtime-host`, and `conversation-store` tests.

These checks do not establish live commercial-model connectivity, output quality, or paid-provider acceptance. Implementation tests used fixture credentials and local responses; no external provider was connected or charged for these checks. Browser and native visual acceptance are recorded separately from protocol results.
