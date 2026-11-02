# Connected native workspace — Foundation 0.6

Foundation 0.6 brings the approved palette into the Code OSS host and connects the product canvas to one host-owned source selection. It is the first native workspace integration milestone, not complete design-system conformance or the full signature workflow.

## Delivered

- Both host themes derive from canonical v1.3 tokens: 315 native color roles, 25 semantic selectors and 15 TextMate groups. Editor, navigator, tabs, terminal, diagnostics, menus, widgets and diff surfaces share the palette. The generator checks registrations against the pinned host.
- The Foundation surface uses one 48px activity toolbar and a 40px selection row. Geist and Geist Mono are bundled locally with license notices. Controls use 32px targets and 4/8/12px radius roles; factual product measurements retain their real values.
- A validated explicit canvas selection loads its saved source analysis without moving keyboard focus, editing source or dispatching an AI request. The breadcrumb follows Understand, Refine, Review and Assistant. Native editor selection can take focus back.
- Runtime measurement packets are distinct from deliberate selection packets. Resizing cannot take focus back from a newer native source selection. Obsolete sessions, unknown mappings and delayed reads cannot replace newer selection.
- The preview iframe remains attached while activities change, preserving local form input, selection and token experiments. Hidden measurements cannot replace visible evidence. A new runtime session, project or trust boundary disposes the prior canvas.
- Inspector width is stored per project, clamped to 280–480px and snapped to 4px. The 320px default preserves at least 480px center width where possible. Arrow keys adjust by 4px; Shift by 32px; Home/End select bounds; double-click resets. Pointer cancellation restores prior geometry.
- Below 760px of actual studio width, Inspector becomes a deliberate focused surface with Back to canvas and Escape. The frame stays mounted. Widening restores the preferred inspector width.
- Source navigation opens beside Foundation and reuses an existing source group. Workspace tools provides Maximize / restore editor group and Reset inspector. The latter resets only inspector geometry; it does not change native editor groups or sidebar sizing.
- Only validated source location persists across app restarts. Runtime measurements and sessions are not restored as fresh evidence. Durable AI conversations are delivered in the separate [Foundation 0.7 increment](durable-conversations.md).

## Verification

The focused suite passes 92 tests, including eight host-selection/layout cases, six layout cases and eight native-theme cases. The full renderer browser regression passes in both themes at 1280, 700 and 360px, real Orbit source compilation, retained form state across activities, inspector drag/keyboard use, narrow navigation, context guards, AI cancellation and proposal/review state. TypeScript checking, bundling and whitespace checks pass.

The renderer suite also caught an older accessibility defect: typing could enable the AI button while leaving aria-disabled true. Both states now update together.

Installed-package and visible native acceptance are recorded in `artifacts/native-workspace/verification.json`. A packaged file match or browser pass alone does not establish native runtime acceptance.

## Boundaries and next work

Code OSS titlebar, editor-tab/statusbar dimensions, navigator geometry and host system typography retain upstream behavior or user settings. This release does not claim the entire desktop has snapped to the design-system grid. Foundation remains an editor surface within the host.

AI remains deliberately disconnected in the installed development workspace. Existing single-file proposals and guarded Apply/Undo are retained, but no commercial-provider acceptance was performed. Multi-file tools, verification runners, live API capture, native SwiftUI/Expo adapters and named state comparison remain future gates. Foundation 0.7 adds durable conversations and records existing preview evidence; it does not add those verifiers.

The browser reference uses the production renderer, compiled saved Orbit snapshots and an isolated fixture host. It never accesses native editor drafts or writes source. Its source-changed/rebuild scenario loads a precompiled fixture variant; compilation, browser rendering, interaction and visual acceptance remain distinct.

The packaged app also passes 13 native checks in a disposable workspace and separate profile, including source editing, language services, both themes, Git, terminal, preview compilation and guarded token Apply/Undo. No provider requests or platform authentication activation occurred. The Documents-backed Orbit window subsequently recovered and its real canvas selection remained connected through Understand and Refine. The final layout-storage refresh was also packaged and passed the same 13 native checks.

Final Orbit-window selection acceptance completed after the Mac was unlocked: the real preview connected, Save mapped to `SaveButton.tsx`, and its selection survived Understand → Refine while the editor draft remained unsaved. The startup stall itself is not claimed fixed: process samples showed a blocked synchronous filesystem open, and the exact file/caller remain unknown. A separate development workflow now preserves the existing app signature; local startup phase diagnostics make subsequent incidents easier to investigate. See `docs/desktop-host.md` for the distinction between external development-extension acceptance and bundled release acceptance.
