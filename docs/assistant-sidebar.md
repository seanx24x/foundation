# Assistant sidebar

Foundation gives AI a persistent home in the native secondary sidebar. With Foundation's default left project navigator, Assistant is the far-right surface. Source editing and the product canvas retain their current activity, selection and tab when Assistant opens.

## Interaction

- **⌘⌥A** toggles Assistant on macOS; **Ctrl+Alt+A** is the cross-platform binding.
- The workspace **Assistant** button sits separately from Understand, Refine and Review. It toggles the sidebar and reflects its visible state.
- **Ask about source** opens or focuses Assistant, prepares the selected saved context, and sends no request.
- The native **Hide Secondary Side Bar** control closes Assistant. New and History belong to the conversation header; no duplicate collapse or New controls are added. **Foundation: Hide Assistant** remains available in the command palette.
- Drag the native divider to resize. Reopening restores the last width.
- Conversation content scrolls independently of the composer. Context and provider details sit in a disclosure above it. Setup, unsaved-source and storage blockers remain visible beside the composer when the disclosure is closed.

## State and ownership

The native host owns conversations and requests. Collapsing changes presentation only: it does not stop a response, clear a composer, archive history, discard an artifact, or replace the central workspace. When shown, the view receives a fresh host snapshot so events missed while hidden cannot leave it stuck. Only an explicit Stop, an ownership change that already requires cancellation, application shutdown, or removal of the actual Assistant view cancels a response; saved partial text remains recoverable.

Closing the central Foundation tab leaves Assistant available. The workspace cannot submit an AI request or change a conversation through its former full-page route. Request messages belong to the Assistant; preview observation messages belong to the central workspace. Source context transfer validates the current trusted project and supported saved file before preparing a request. Preview HTML stays in the central workspace and is not copied into the sidebar.

The dedicated sidebar reuses Foundation's existing durable conversation, artifact, disclosure and proposal contracts. Opening it or browsing history never contacts a provider. A prepared request still requires Send. Proposal Apply and Undo retain their existing revision, workspace-trust and unsaved-document guards.

## Native layout boundary

The pinned Code OSS host supports `viewsContainers.secondarySidebar` directly. Foundation contributes container `foundation-assistant` with webview `foundation.assistant`, enables `retainContextWhenHidden`, and uses native show/focus/close commands. The host persists sidebar width in the profile and visibility in the workspace. No user database is edited and no extra host patch is required.

Foundation defaults the primary sidebar to the left; the native secondary sidebar is on the opposite side. A user who relocates the primary sidebar also changes this relationship. Foundation does not continually overwrite that preference.

The design reference's 384px rail remains a preferred working width. The pinned native host initially chooses approximately 300px and allows a 170px minimum, with no public API for an exact width, 320–640px bounds, or 4px sash snapping. Internal Foundation spacing follows the design grid; the native sash follows Code OSS sizing. Changing those host limits is a separate, maintained host change. Native Maximize is an optional full-workspace mode and hides the editor; ordinary collapse/reopen does not invoke it.

## Verification

Host regressions cover separate surface registration, request routing, stream continuity while hidden, authoritative state rehydration and central-workspace disposal. Browser checks use the actual renderer in both themes and narrow/sidebar widths. Native checks exercise the packaged view, tab/selection continuity, collapse/reopen, conversation restoration and zero unexpected provider requests. See the [0.8 verification record](../artifacts/verification-v0.8.md) for executed checks and acceptance limits.

Legacy browser references keep their existing full-page Assistant until deliberately migrated. They are not evidence of the native sidebar's installation state, and no user conversation data is published by this change.

## Restart continuity in 0.13

The sidebar now saves explicit unsent source selections and task-brief inclusion with its question and intent, bound to the same project, feature and conversation. It restores saved source without opening editors. Unavailable choices remain visible and block sending; explicit empty choices stay empty. Runtime evidence is never revived as current. See [restart restoration](restart-restoration.md) for ownership, migration and native verification.
