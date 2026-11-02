# Foundation third-party and separate-license notices

Foundation's [Source Inspection License](LICENSE.txt) applies only to eligible Foundation-original material. It does not restrict the separate rights granted for the components below, including source portions carrying their own license declarations. A dependency declaration is not a license for Foundation as a whole.

This index covers the checked-in assets, root production npm lock entries and pinned Code OSS notice archive reviewed on 2 November 2026. It is **not a complete desktop/Electron SBOM or commercial-release clearance**. [Commercial licensing review](docs/commercial-licensing.md) records outstanding issues. Full notices are retained, not replaced by this table.

## Code OSS and host adaptations

- **Code OSS 1.143.1**, Microsoft Corporation, commit `e646868227c3e3a9e3f24277c8c7220be42c0be7`: [complete MIT license](licenses/code-oss/LICENSE.txt) and [pinned third-party notices](licenses/code-oss/ThirdPartyNotices.txt). The upstream source and generated application are downloaded/built locally and excluded from this source repository. [Upstream](https://github.com/microsoft/vscode).
- `desktop/patches/foundation-canvas-capture-common.ts`, `foundation-canvas-capture-native.ts` and `foundation-canvas-capture-workbench.ts` carry Microsoft copyright and MIT declarations. They remain under those declared terms; the scoped MIT text above applies to them. Their current provenance/header accuracy needs confirmation before publication. A generic new root license does not override their file-level terms.
- `desktop/patches/npm-yarn-workspace-root.ts` is an asynchronous adaptation of `find-yarn-workspace-root` 2.0.0 / Yarn material. Preserve its Square attribution, modification/provenance record and [Apache-2.0 license](desktop/patches/npm-yarn-workspace-root.LICENSE). The build writes a corresponding FoundationThirdPartyNotices file in the npm extension.
- Full native distributions also include Electron/Chromium, built-in extensions and their dependencies/assets. Their exact notices and source obligations must be reviewed separately. Source repository availability does not establish binary-distribution compliance.

## Production npm dependency notices

These are the fifteen non-development entries resolved by the root lockfile, including transitive entries. Not every entry necessarily contributes executable code to each output. [Inventory and hashes](licenses/inventory.json) record the exact notices copied from the matching installed package versions. Each package's complete notice controls over its abbreviated metadata.

| Package | Version | Declared terms / full-notice detail | Preserved notices |
| --- | --- | --- | --- |
| `@monaco-editor/loader` | 1.7.0 | MIT | [LICENSE](licenses/npm/monaco-editor--loader/LICENSE) |
| `@monaco-editor/react` | 4.7.0 | MIT | [LICENSE](licenses/npm/monaco-editor--react/LICENSE) |
| `@types/trusted-types` | 2.0.7 | MIT | [LICENSE](licenses/npm/types--trusted-types/LICENSE) |
| `dompurify` | 3.4.15 | (MPL-2.0 OR Apache-2.0) | [LICENSE](licenses/npm/dompurify/LICENSE), [LICENSE-MPL](licenses/npm/dompurify/LICENSE-MPL) |
| `lucide-react` | 0.576.0 | ISC + MIT notices for Feather portions | [LICENSE](licenses/npm/lucide-react/LICENSE) |
| `marked` | 14.0.0 | MIT | [LICENSE.md](licenses/npm/marked/LICENSE.md) |
| `monaco-editor` | 0.57.0 | MIT | [LICENSE](licenses/npm/monaco-editor/LICENSE), [ThirdPartyNotices.txt](licenses/npm/monaco-editor/ThirdPartyNotices.txt) |
| `nanoid` | 3.3.20 | MIT | [LICENSE](licenses/npm/nanoid/LICENSE) |
| `picocolors` | 1.1.1 | ISC | [LICENSE](licenses/npm/picocolors/LICENSE) |
| `postcss` | 8.5.32 | MIT | [LICENSE](licenses/npm/postcss/LICENSE) |
| `react` | 19.2.4 | MIT | [LICENSE](licenses/npm/react/LICENSE) |
| `react-dom` | 19.2.4 | MIT | [LICENSE](licenses/npm/react-dom/LICENSE) |
| `scheduler` | 0.27.0 | MIT | [LICENSE](licenses/npm/scheduler/LICENSE) |
| `source-map-js` | 1.2.2 | BSD-3-Clause | [LICENSE](licenses/npm/source-map-js/LICENSE) |
| `state-local` | 1.0.7 | MIT | [LICENSE](licenses/npm/state-local/LICENSE) |

DOMPurify supplies an **OR** choice between MPL-2.0 and Apache-2.0. Both supplied texts are retained; this index does not convert the choice into an AND requirement. Monaco's additional ThirdPartyNotices file is preserved with its MIT license.

## Fonts, icons and reference runtime

| Material | Terms and retained notices |
| --- | --- |
| Geist Sans and Mono 1.8.2 | OFL-1.1. [Upstream](https://github.com/vercel/geist-font/tree/v1.8.2). The unmodified fonts and both supplied notice records are retained in `desktop/extension/media/fonts/`, `artifacts/design-system-v1/assets/` and `artifacts/native-workspace/media/fonts/`. See [asset registry](artifacts/design-system-v1/asset-registry.json). |
| Selected Lucide 0.576.0 specimen icon nodes | Complete [ISC and Feather MIT notice](artifacts/design-system-v1/assets/lucide-LICENSE.txt); the scope is the selected icon material, not all original specimen logic. |
| Compiled reference React runtime | [React MIT notice](artifacts/native-workspace/media/React-LICENSE.txt) and [ReactDOM MIT notice](artifacts/native-workspace/media/ReactDOM-LICENSE.txt). Installed React, ReactDOM and Scheduler notices are byte-identical at the reviewed versions. |
| TypeScript bundled by the desktop extension | TypeScript 5.9.3, Apache-2.0; `bundle-extension.mjs` copies the complete installed license to `dist/TypeScript-LICENSE.txt`. Compiler source is not checked into this source repository. |
| Native Code OSS icons/assets | Include Codicons CC BY 4.0 and Git-logo CC BY 3.0 notices in the upstream archive. These terms and trademark boundaries remain separate from Foundation's source policy. |

Research alternatives in [iconography and licensing](docs/iconography-and-licensing.md) are not all installed assets. Do not claim an alternative library is bundled merely because that document discusses it.

## Build tools and future distributions

The root lockfile also contains development-only packages, including Lightning CSS 1.33.0/platform packages declared MPL-2.0. A distribution containing a toolchain or developer bundle needs a matching inventory; a production-only npm list is insufficient. The Code OSS and Electron graphs are also separate from this root npm inventory.

Preserve copyrights, license texts, NOTICE content, modification records and any applicable source-availability obligations for the exact redistributed artifact. Do not remove a notice just because Foundation uses a different license. Do not remove or relabel a previously valid grant to someone else.
