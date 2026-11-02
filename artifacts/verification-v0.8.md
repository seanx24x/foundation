# Foundation 0.8 — native Assistant sidebar verification

## Delivered

Assistant now occupies a dedicated native secondary sidebar at the far right under Foundation's default layout. **⌘⌥A**, the workspace Assistant button and Collapse Assistant control toggle it independently of source and the canvas. Native divider resizing remains available. The compact layout includes local history, collapsible source/provider details, artifact inspection and a composer anchored below the conversation.

Collapsing retains composer state and requests. Host snapshots restore authoritative conversation state when the view becomes visible. Central workspace disposal leaves AI available; explicitly removing the Assistant view cancels safely with saved partial history. Stale view callbacks and rapid open/close during delayed native resolution cannot redirect traffic or reopen a dismissed view. Background updates do not reclaim keyboard focus from another surface.

The final native visual check also exposed an obsolete 1050px breakpoint that split the design inspector itself into two columns. That rule has been removed, leaving the current layout controller responsible for desktop and compact arrangements. Selected properties remain readable beside both source and AI.

## Executed checks

- TypeScript, bundle, signature verification and whitespace checks pass.
- All **133 desktop tests** pass, including nine sidebar host regressions, existing source/proposal guards, packaged identity checks, durable conversations and the production renderer.
- All **24 provider/proposal tests** pass.
- All **16 packaged native checks** pass: secondary-sidebar registration, central-tab and editor-selection continuity, collapse/reopen, central workspace disposal, editing, language services, Git, terminal, preview compilation and guarded Apply/Undo. The local recording provider receives zero requests and startup authentication providers remain dormant.
- A separate two-process packaged check restores the same conversation identity in the sidebar after graceful quit and relaunch, using isolated native workspace storage. It does not use extension-test mode's temporary database.
- Renderer checks cover both themes at **170, 240, 300, 320, 384 and 480px**, a short panel, dialogs, storage failure, disclosure focus, stream updates and draft preservation. An actual iframe plus outer editor input verifies that inactive webviews do not steal keyboard focus. The Refine correction covers observed selections at **900, 1000 and 1100px**, plus compact behavior at **700px**.

## Installed app acceptance

Foundation 0.8 is installed and running in the normal Orbit profile. The source and installed extension, renderer and manifest bytes match. The native dark-theme window was visually inspected with the product canvas, source editor and far-right Assistant simultaneously visible. The keyboard toggle, in-pane collapse, workspace reopen, History and Escape worked. The connected saved-source preview retained its selected Save button across collapse/reopen, and the final inspector layout is readable in the narrow central split. [Native capture](verification-v0.8-native.png).

The existing conversation appeared in History and the sidebar restored on the final normal relaunch. Source-sharing details explicitly mark the unsaved SaveButton and prevent silently sharing its buffer. All eight saved Orbit files and the existing **727-byte unsaved draft** still match their preservation hashes. No source Apply, project task, provider configuration or AI request was performed in Orbit. The current renderer session has no unresponsive-host events.

## Limits

AI remains disconnected in the real workspace. Stream/cancellation tests use controlled fixtures; this release does not establish commercial-model quality. The two-process test verifies graceful conversation identity restoration, not process-crash or power-loss durability. The native sidebar's width and placement follow Code OSS; exact 384px sizing, 320–640px limits and 4px native-sash snapping require a separate host change. Internal Foundation geometry retains its grid.

The existing private browser reference was not republished and retains its earlier layout. No user conversation history or unsaved source was published. See [Assistant sidebar](../docs/assistant-sidebar.md) for interaction and integration details, and [machine-readable results](verification-v0.8.json) for provenance.
