# Foundation design contract

`foundation.tokens.json` is the canonical v1.3 design source. The running desktop has not yet been migrated to these tokens.

- [Design specification](../docs/design-system.md)
- [AI artifact components](../docs/ai-artifacts.md)
- [Product principles](../docs/product-principles.md)
- [Icon and font licenses](../docs/iconography-and-licensing.md)
- [Interactive reference](../artifacts/design-system-v1/index.html)

Run `node scripts/validate-design-system.mjs --write` to validate and regenerate reference CSS plus the contrast report. Run without `--write` for a read-only check.

The schema is intentionally project-specific, not a claim of complete DTCG compatibility. Typography sizes, optical marks, native chrome, continuous coordinates, inspected product geometry, and user configuration are documented grid exceptions. The validator enforces owned token geometry and declared opaque color pairs; native/layout/accessibility verification follows during implementation.

Revision 1.2 introduces neutral graphite/silver shell surfaces and an independently themed product artboard. The standalone reference uses a compact 64px outer header; the target workspace toolbar is 48px with no separate workflow row. Panel widths and the 4px grid remain governed by the layout tokens; native window dragging and controls still need host validation.

Revision 1.3 adds the AI artifact component contract and interactive chat specimens. It inherits the 1.2 palette and workspace geometry.
