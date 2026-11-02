# Inline selection editing — Foundation 0.25

Select one range in a supported native source file, then choose **Foundation: Edit Selection with AI** from the command palette or editor context menu. **⌥⌘E** opens the same flow. Describe the change in the native input; Enter explicitly sends it. A cancellable request produces a read-only native diff. Review it, then choose **Accept edit** or **Dismiss**. While the suggested editor has focus, **⌥⌘Enter** accepts and **Escape** dismisses.

## Context and scope

The prompt identifies the configured provider/model and the size of the selection. Only the selected text, its language and the instruction are sent. Selected unsaved text is included. Surrounding buffer content, file paths, unrelated files, feature context and Assistant history are excluded. The local diff shows the full before/after buffer for review; those surrounding bytes are not added to the provider request.

The first slice accepts one nonempty selection up to 16 KiB in a supported trusted-project file under 256 KiB. Instructions fit 2,000 characters. The provider must finish normally with a validated replacement and short explanation; incomplete, refused, tool-bearing or malformed responses cannot be accepted. Empty replacement permits deletion. Replacement line endings follow the captured document.

## Native editing and recovery

Accept replaces exactly the captured range through the native editor in one undo group. It does not call Save or write through the project source service. The user's existing auto-save settings still apply. Native Undo restores the prior buffer, including earlier unsaved edits. Other documents remain untouched.

The full document identity, native version, captured text, trusted project and provider configuration are checked again before accepting. A source edit invalidates the suggestion even if native Undo later returns the same text. A closed document, changed workspace or provider configuration discards it. Cancellation retires the request and suppresses late results. Duplicate Accept cannot apply twice. Editing remains available while AI runs.

Prompts and suggestions are session-local. Closing the diff dismisses its suggestion. Restart does not restore or resend an inline request, and it never applies one. Native hot exit continues to own accepted unsaved document recovery. The Assistant's saved proposal and conversation workflows remain separate.

## Evidence and remaining work

A suggested edit has not been compiled, executed or visually verified. The native review identifies it as a suggestion; an accepted edit is not a passing check. This increment provides explicit selected-range transformations. Foundation 0.26 adds native insertion completions and nearby edit suggestions through the separate [code suggestions](code-suggestions.md) workflow. Multi-cursor transforms, durable inline provenance and sustained-load performance remain later checklist work.

Foundation 0.25 was verified: 268 project tests, 840 desktop tests and five packaged native workflows pass. The actual prompt, diff, shortcuts, acceptance, dismissal and native Undo were checked; native Dark/Light were inspected. Orbit source, its unsaved draft and workspace context are preserved. Provider checks used local fixtures; normal Orbit AI remains disconnected. See [verification](../artifacts/verification-v0.25.md) and the [running checklist](product-checklist.md).
