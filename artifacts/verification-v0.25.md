# Foundation 0.25 verification

Foundation 0.25.0 is installed and running. M2.10a is verified for explicit selected-range editing in the native editor. Automatic completion and next-edit suggestions remain next. [Machine-readable report](verification-v0.25.json).

## Delivered behavior

Select code and press **⌥⌘E**. The native prompt discloses the configured provider/model, selected size and inclusion of selected unsaved text. Enter explicitly sends only the selection, language and instruction. Review the read-only native diff; **⌥⌘Enter** accepts the exact range as one native undo group and **Escape** dismisses. Dismiss returns to the original source and selection. The controller never calls Save; existing auto-save settings still apply.

Cancellation suppresses late responses. Document identity, native version, full captured text, project ownership and provider configuration guard acceptance. Source edits invalidate the suggestion, including an edit followed by Undo. Duplicate Accept cannot apply twice. Inline prompts and proposals are session-local and never resume automatically. A suggestion is explicitly **Not checked**.

## Automated and packaged checks

| Check | Result |
| --- | --- |
| Project tests | 268 passed; no failures or skips |
| Desktop tests | 840 passed; no failures or skips; final suite concurrency 4 |
| Project and desktop TypeScript | Both passed |
| Packaged native workflows | Inline editing, editor fundamentals, restart, partial acceptance and group revision passed |
| Final inline workflow | 13 native command/prompt/shortcut interactions; 4 local provider requests |
| Source preservation | Fixture disk unchanged; target and unrelated native drafts preserved |

The final inline workflow exercised the published shortcuts, prompt cancellation without a request, exact selected-text sharing, native diff, Accept, one-step Undo, Escape and source focus restoration, delayed-response cancellation and stale-proposal rejection. Provider protocol tests cover all three configured protocols, validation, limits and cancellation. All model responses came from local fixtures; this does not establish production-provider quality or latency.

An earlier default-concurrency desktop run failed an existing execution-output scroll assertion and its parent test. Its cause was not confirmed. The unchanged focused renderer suite passed, followed by the final full 840-test suite with four workers. No renderer code or assertion was weakened to obtain that result.

## Native appearance and installation

The native diff, actions and evidence tooltip were inspected in Foundation Dark and Light. The native prompt was opened manually and cancelled without sending. Manual review identified a focus issue on Dismiss; the final fix passed the packaged Escape/source-focus check. [Dark](native-inline-edit-dark-v0.25.png) · [Light](native-inline-edit-light-v0.25.png) · [Prompt](native-inline-edit-prompt-v0.25.png).

All 20 installed extension payloads match source and the tested candidate. The deep/strict ad-hoc signature check passes. After normal-profile quit, installation and relaunch, all eight saved Orbit files and the original 727-byte unsaved draft match their previous hashes. Understand, two editor groups, ProfileForm at line 34/column 57, Profile saving with three members, and the expanded far-right Assistant are restored. Assistant still has zero selected source files, an unchecked task brief, Ask mode, an empty composer and no configured AI. [Installed workspace](installed-orbit-v0.25.png) · [Installation evidence](installed-verification-v0.25.json).

## Boundaries and next work

The first slice supports one nonempty selection up to 16 KiB in a supported trusted-project file up to 256 KiB. Empty-caret insertion, multiple selections, automatic completion, next edits and durable inline provenance remain open. Accept is not a test result. Physical input-to-paint and sustained-load performance remain unmeasured. Broader agent tools, dependency analysis and M3–M5 are unchanged. No preview was published.
