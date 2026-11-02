# Foundation 0.26 verification

Foundation 0.26.0 is installed and running. M2.10b is verified for bounded, session-enabled native completions and nearby edit suggestions. [Detailed report](verification-v0.26.json).

## Delivered behavior

**Start Code Suggestions** discloses the configured provider/model, up to 12 KiB of current-file context, inclusion of unsaved text and the rolling request limit. Starting enables only the current session. Opening source, cancelling the disclosure and restarting send nothing. Pause cancels pending work. There is no persistent automatic-sharing preference.

After an eligible source edit, validated insertion text uses native ghost text. Tab accepts, Escape dismisses and native word/line acceptance retains the remaining suggestion. Native Undo preserves the pre-completion draft. The editor owns prefix matching after publication; acceptance telemetry runs after insertion and is not a pre-acceptance guard.

Nearby edits appear as **Next edit**. Review opens an exact read-only native diff; acceptance replaces the captured range only after document/version/text/project checks. Dismiss returns to the initiating caret. Source changes, cancelled requests, owner/configuration changes and late responses cannot revive stale edits. The extension never calls Save; existing auto-save settings apply.

## Verification

| Check | Result |
| --- | --- |
| Project tests | 305 passed; no failures or skips |
| Desktop tests | 873 passed; no failures or skips, concurrency 4 |
| TypeScript | Project and desktop passed |
| Packaged native workflows | Code suggestions, selection editing, editor fundamentals and restart passed |
| Provider protocols | Compatible, OpenAI and Anthropic wire formats tested with local fixtures |
| Native appearance | Ghost text and nearby edit review captured in Dark/Light; manual native inspection completed |

The initial desktop run checked the still-installed 0.25 artifact. The final full run explicitly targeted the 0.26 candidate and passed. No packaging assertion was weakened.

Manual review then corrected singular/plural request-count copy. The 26 controller tests, desktop typecheck and complete packaged code-suggestions workflow passed again before installation. No behavior changed in that final text polish.

The new packaged workflow exercises explicit disclosure, disabled typing, automatic ghost text, Tab/Undo, Escape, partial word/line acceptance, cancellation, nearby-edit review/acceptance/Undo and stale rejection. It checks exact bounded payload fields and excludes source outside the shared window, other files and Assistant history. Target and unrelated unsaved fixture drafts remain intact; disk hashes remain unchanged.

Provider wait and controller request-to-return samples remain separate from loopback request-arrival-to-renderer-observed-ghost samples in the detailed report. Renderer polling adds measurement granularity. None measures physical input dispatch or compositor paint, and no result establishes production-provider latency or sustained-load performance.

## Installed state

All 20 extension payloads match source and the tested candidate; deep/strict ad-hoc signature verification passes. Normal Orbit was quit and relaunched without saving or discarding its draft. All eight saved files and the original 727-byte backup retain their hashes. Understand, two editor groups, ProfileForm line 29/column 13, Profile saving, far-right Assistant, empty Ask composer and explicit context choices remain restored. AI is disconnected and code suggestions are off. [Installed workspace](installed-orbit-v0.26.png) · [Installation evidence](installed-verification-v0.26.json).

## Remaining scope

This version uses one active source buffer and a small context window. Cross-file next edits, repository context, proposed native next-edit rendering and durable inline history remain open. Suggested and accepted code is not automatically compiled or verified. Live providers, physical input-to-paint, sustained AI/runtime load, broader agent tools, dependency analysis and M3–M5 remain open. No preview was published.
