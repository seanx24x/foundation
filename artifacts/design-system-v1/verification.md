# Foundation reference 1.3 verification

Checked 2026-10-27. Scope: standalone interactive design reference. The native Code OSS application, project files, and unsaved drafts were not changed.

## AI artifact checks — revision 1.3

- All ten artifact families render in the 384px assistant pane at a 1440px viewport, with explicit sample content and no network or project-write path. Initial family navigation reveals its action.
- Code-change expansion preserves its revision and blocks application. Stale warnings remain visible when collapsed; expanded stale proposals disable decisions.
- Task cancellation preserves labelled partial output and offers restart. Failed state offers retry. These actions reset local specimens only.
- Plan acceptance records a local decision without starting implementation. Closing and accepting expanded artifacts restores focus to the corresponding inline control.
- Deliverable Doc, Diagram, and Table views keep the same artifact identity. The expanded table retains a caption and headers.
- Visual comparison supports Default, Loading, and Error. Rendered samples retain light appearance independently of the workspace; normal and retry labels use the on-fill token.
- Graphite and silver surfaces inspected at 1440×1120. At 390×844 the page and expanded comparison have no horizontal overflow; the three preview states stack.
- Workbench, Interface components, and AI artifact routes verified; command search opens the AI gallery.
- Explanation copy is limited to its displayed source excerpt; handler ownership and server outcome remain unknown.

## Existing workbench checks — revision 1.2

- Canonical token geometry, theme parity, and 114 declared opaque contrast pairs pass. Minimum measured text ratio: 4.9512:1; essential-boundary minimum: 3.1346:1. These pair checks are not a complete accessibility audit.
- JavaScript syntax passes. Asset registry hashes match the reference files; font binaries and icon nodes retain their existing source and license notices.
- Visual inspection at 1440×960 in graphite and silver workspace themes. Product appearance can remain independent of the workspace theme.
- At 1440px: 1392px frame, 48px rail, 240px navigator, 784px center, 320px inspector. Split view yields two 392px panes. Unified window toolbar measures 48px.
- Default artboard is 480×500px including its labels; product window is 480×436px. The selected control and review action fit in the standard viewport.
- Radius and scope experiments survive workspace/product appearance changes. The inspector fill swatch follows the product appearance. Preview summary reports the actual 8→12px experiment and selected scope.
- Review remains separate from source application; Apply to source is disabled in this reference. Comparison samples inherit the inspected product appearance.
- At 1024px: requested Split falls back to Canvas, inspector opens as a drawer, Escape closes it and restores focus to the trigger.
- At 390×844: no horizontal document overflow. Toolbar adapts to two rows; icon-only controls retain accessible labels. Removed a narrow footer-label overlap discovered during visual inspection.
- Focus mode enters and exits with Escape, restores its trigger, and preserves the selected context.

## Remaining acceptance

Real touch-device coverage, forced colors, reduced transparency, reduced-motion preferences, browser 200% zoom, full screen-reader navigation, and cross-browser behavior still need dedicated checks. CSS fallbacks are present but are not claimed as fully validated. Native titlebar dragging and traffic-light positioning need host integration testing. AI, runtime evidence, source writes, and verification execution remain outside this illustrative reference.
