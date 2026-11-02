# Foundation 0.9 — native clarity pass

Verified 28 October 2026. The local app is installed and open in Orbit. This pass refines content, layout and structure; it does not claim new runtime adapters or provider capability.

## What changed

- Understand presents compact source relationships, declarations and request references. Repeated identity and tutorial copy are reduced. Unsupported analysis is explicit.
- Refine gives the canvas and selected properties priority. Entry/build controls are direct; Fit guidance is available on demand. Token availability, shared scope, experiments and unsaved source remain truthful.
- Review leads with current decisions and collapses discarded/undone work under Previous proposal. Compilation, interaction and visual outcomes remain separate.
- Assistant stays independent of central navigation. Native Hide/Maximize and content New/History each have one owner. AI setup and source/storage blockers stay visible beside the composer; supporting context and receipt details use disclosures.
- Expanded artifacts use one clear heading and retain source, freshness and edit authority. Collapsed verification history survives updates; queued dialog-close events no longer steal subsequent keyboard focus.
- Source context, palette labels, setup steps and errors describe their actual scope and recovery. Product principles now define these content and hierarchy rules.

See the [full surface audit](../docs/clarity-pass.md) and [product principles](../docs/product-principles.md).

## Executed checks

| Evidence | Result |
| --- | --- |
| TypeScript extension check | Passed |
| Full desktop regression suite | 134 passed, 0 failed, 0 skipped |
| Focused renderer/presentation subset | 18 passed, included in full suite |
| Installed native smoke | 16 checks passed in isolated workspace; zero provider requests/authentication activations |
| Native history restart | Separate write/restore processes; conversation and sidebar restored |
| Package equality and signature | Six installed assets match source; ad-hoc signature verified |
| Saved Orbit and unsaved draft | All eight saved files unchanged; original 727-byte draft unchanged |
| Normal-profile startup logs | No unresponsive events in session 20261028T154829 |
| Whitespace | git diff --check passed |

Production-renderer browser tests cover both themes, Assistant widths 170/240/300/320/384/480px, short height, narrow central layouts, setup/dirty/storage blockers, streaming/partial answers, stale artifacts, history, expanded dialogs and keyboard focus. Captures are in desktop/tests/artifacts/clarity-*.png. These scripted fixtures are separate from real-provider acceptance.

## Installed visual and interaction acceptance

Actual normal-profile dark-theme checks inspected Understand, Review, Refine, the Source context tree and the disconnected Assistant beside native source. Review keeps the previous discarded proposal collapsed. Cmd+Option+A hides and restores Assistant without changing Review or source. The setup action opens step 1 of 3 and was cancelled with Escape before any input.

The saved Orbit preview compiled and connected. Inspecting Save changes showed mapped SaveButton source and measured properties, while retaining the unsaved-draft warning. The app remains open with Refine, source and Assistant visible.

- [Understand screenshot](verification-v0.9-understand.png)
- [Review screenshot](verification-v0.9-review.png)
- [Refine and Assistant screenshot](verification-v0.9-native.png)
- [Machine-readable evidence](verification-v0.9.json)

## Limits and follow-ups

The normal profile remains in its existing dark theme; both themes are covered by renderer fixtures and isolated native theme resolution. No commercial provider was connected, and no Apply/Undo was performed against Orbit. Provider and guarded-write tests use isolated fixtures.

Inherited Code OSS editing, search, debugging, terminal, Git and settings retain their familiar controls. The Commonly Used settings list still promotes an upstream chat limit despite upstream chat being disabled; removing that promotion needs a separate maintained host patch. Storage-capacity management also remains separate; Archive does not reclaim space.

The browser workbench and private reference were not republished. No conversation history or unsaved source was published.
