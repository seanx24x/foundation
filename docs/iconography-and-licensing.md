# Foundation iconography and licensing

Design system v1 · verified 27 October 2026

## Decision

**Lucide is Foundation’s product icon family. Geist Sans and Geist Mono are its typefaces.** Codicons remain in inherited Code OSS surfaces until an intentional, complete host icon-theme migration is validated. Foundation-specific concepts receive a small original glyph family that follows the same optical rules.

Use generic file and device symbols with visible technology names by default. Brand logos are optional, individually reviewed assets. Do not install another general-purpose icon library to fill occasional gaps.

The selected licenses permit commercial distribution subject to their terms. “Free to use” means no purchase is required; notices, attribution, modifications, and trademarks still need the treatment below.

## Repository decisions

| Repository | Verified license | Decision and required treatment |
| --- | --- | --- |
| [Lucide](https://github.com/lucide-icons/lucide) | ISC, with MIT notices for Feather-derived portions | **Primary. Pin `lucide-react@0.576.0`**, already installed in Foundation. Retain the complete combined copyright and permission notice. The exact installed package and [tagged license](https://github.com/lucide-icons/lucide/blob/0.576.0/LICENSE) were checked. |
| [Phosphor](https://github.com/phosphor-icons/core) | [MIT](https://github.com/phosphor-icons/core/blob/main/LICENSE) | Approved research alternative if a future system-wide direction requires several icon weights. Retain copyright and license if adopted. Do not mix it into the Lucide UI. |
| [Tabler Icons](https://github.com/tabler/tabler-icons) | [MIT](https://github.com/tabler/tabler-icons/blob/main/LICENSE) | Broad alternative, not a second default family. Retain copyright and license if adopted. |
| [VS Code Codicons](https://github.com/microsoft/vscode-codicons) | **Artwork/content: [CC BY 4.0](https://github.com/microsoft/vscode-codicons/blob/main/LICENSE). Code: [MIT](https://github.com/microsoft/vscode-codicons/blob/main/LICENSE-CODE).** | Keep existing editor, debugger, symbol, and extension semantics. Attribute Microsoft and contributors, provide source/license links, retain supplied notices, and indicate modifications. The repository’s [legal notices](https://github.com/microsoft/vscode-codicons#legal-notices) distinguish artwork from code and exclude trademark rights. Do not describe all Codicons assets as MIT. |
| [Simple Icons](https://github.com/simple-icons/simple-icons) | Repository [CC0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md), with individual-icon exceptions | Optional integration identities only. Its [disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md) explicitly says project CC0 does not mean every icon is CC0. Check each selected icon’s license, source, and official brand guidelines. Missing metadata is not clearance. |
| [Devicon](https://github.com/devicons/devicon) | Repository [MIT](https://github.com/devicons/devicon/blob/master/LICENSE), plus represented brands’ terms | Optional technology identity source. The [README](https://github.com/devicons/devicon#about-the-project) requires respecting brand policies and disclaims endorsement. Use a generic file glyph and language label until the individual mark is reviewed. |
| [Geist](https://github.com/vercel/geist-font) | SIL Open Font License 1.1 | **Use unmodified Sans and Mono `v1.8.2`.** Preserve both supplied [OFL.txt](https://github.com/vercel/geist-font/blob/v1.8.2/OFL.txt) and [LICENSE.txt](https://github.com/vercel/geist-font/blob/v1.8.2/LICENSE.txt) records. Fonts can be bundled with commercial software, cannot be sold alone, and remain under OFL. The application does not have to adopt OFL. Respect any declared Reserved Font Names for modified fonts. |

Alternative repositories above were reviewed on their linked default branches and have not been selected for installation. Any adoption requires an exact version, artifact check, and license review. Codicons should be inventoried from the version actually bundled with Foundation’s pinned Code OSS host; this document does not silently replace that version.

## Coverage and semantic mapping

All Lucide export names below were checked against Foundation’s installed `0.576.0` package. The library covers the functional categories; original glyphs cover Foundation-specific meaning.

| Area | Starting glyphs | Semantic boundary |
| --- | --- | --- |
| Workspace and navigation | `Search`, `Command`, `FolderOpen`, `Files`, `PanelLeft`, `PanelRight`, `PanelBottom`, `Columns2`, `LayoutGrid`, `Settings`, `SlidersHorizontal` | Workspace, target, and source navigation retain distinct labels. |
| Code and files | `Code`, `Braces`, `Brackets`, `FileCode2`, `FileJson`, `FunctionSquare`, `Variable`, `Binary`, `Hash`, `Type`, `FileText` | Native completion and detailed symbol kinds retain Codicons. Show file extensions in text. |
| Git and review | `GitBranch`, `GitCommitHorizontal`, `GitMerge`, `GitPullRequest`, `GitCompare`, `FileDiff`, `Check`, `Undo2`, `Redo2`, `History` | Accepting a proposal is not a Git merge. Check means a named check passed, not general safety. |
| Runtime and debugging | `Bug`, `Play`, `Pause`, `Square`, `StepForward`, `SkipForward`, `CircleDot`, `Gauge`, `Timer`, `Terminal`, `ScrollText` | Preserve inherited step-in/out/over and conditional/log breakpoint symbols until a full replacement is tested. |
| AI collaboration | `MessageSquare`, `Workflow`, `ListChecks`, `Bot`, `Layers`, `Pause`, `CircleStop`, `RefreshCw`, `ShieldCheck`, `CircleHelp` | Conversation, execution, plan, cancellation, and permissions are different concepts. Sparkles must never mean verified. |
| Visual refinement | `MousePointer2`, `Crosshair`, `ScanEye`, `Move`, `Ruler`, `Palette`, `Pipette`, `Type`, `AlignLeft`, `AlignCenter`, `AlignRight`, `StretchHorizontal`, `Image`, `ZoomIn`, `ZoomOut` | Constraints, box model, scope, and motion curves may need original glyphs; do not force an unrelated stock symbol. |
| API, data, dependencies | `Webhook`, `Plug`, `Cable`, `Server`, `Database`, `Table2`, `Route`, `Braces`, `ArrowRightLeft`, `Network`, `Activity`, `KeyRound`, `Lock` | Source relationships and observed requests differ through words and line styles, not color alone. |
| States and accessibility | `Info`, `CircleCheck`, `CircleAlert`, `TriangleAlert`, `LoaderCircle`, `CircleHelp`, `Eye`, `EyeOff`, `Keyboard`, `Accessibility`, `Sun`, `Moon`, `Contrast`, `WifiOff` | Unknown, stale, failed, busy, and disconnected each require an explicit state label. |
| Platforms and technology | `Monitor`, `Smartphone`, `Tablet`, `FileCode2` | Pair with React, SwiftUI, Expo, language, or target names. Generic device symbols do not imply endorsement. |

Foundation components reference semantic IDs such as `action.inspect`, `action.undo`, `evidence.observed`, and `scope.shared`. A central registry maps them to glyphs. Components must not import arbitrary library icons directly; changing a metaphor happens once and is reviewed across its uses.

## Original Foundation glyphs

Create a compact owned family for:

- **Connected selection:** a selected object connected to its source and evidence.
- **Scope:** instance, component, and shared token as three related, distinguishable symbols.
- **Evidence:** from source, observed, AI interpretation, and unknown. Always pair with words.
- **Checkpoint:** a recoverable local change set, distinct from Git commit and autosave.
- **Scenario:** a named reproducible state or interaction, distinct from its test result.

These are product vocabulary, not decorative brand flourishes. Validate recognition at 16 px before creating additional sizes. The Foundation app mark must be original; do not construct it from another company’s logo.

## Rendering contract

Use **16 px** glyph boxes for dense controls, **20 px** for principal toolbars, and **24 px** for larger explanatory surfaces. Boxes, gaps, alignment, and hit targets follow the 4 px layout grid. SVG path coordinates, stroke edges, and documented optical corrections may be fractional; forcing artwork onto a 4 px coordinate lattice would damage legibility.

Use a 24-unit source viewBox, round caps/joins, and an absolute 1.5px optical stroke at 16px and 20px; use 2px at 24px. Use Lucide’s `absoluteStrokeWidth` or an equivalent central renderer so resizing does not create per-icon inconsistencies. These optical strokes are explicit grid exceptions. Native editor symbols retain tested host metrics during migration. Never tune individual icons ad hoc to compensate for a weak family choice. Use `currentColor`, explicit dimensions, and local SVG/component assets. Bundle only required glyphs; no runtime CDN requests or arbitrary external SVG loading.

Decorative icons are hidden from accessibility APIs. Icon-only controls need an accessible name, keyboard focus, and an explicit tooltip. The default pointer control is 32 px; compact targets must meet the system’s minimum target rules, and touch targets are at least 44 px. Status is never conveyed only through hue, shape, or animation.

Check both themes, selected/disabled/focused states, 100–200% zoom, and increased contrast. Optical consistency should be assessed in actual toolbars and trees, not only a large icon contact sheet.

## Pinned font assets

[Geist v1.8.2](https://github.com/vercel/geist-font/releases/tag/v1.8.2) resolves to commit **`1d6dfdb6e58c0ddd841c1e24e59aef01ec3916e4`**. The official repository tree was checked for these normal variable files:

```text
fonts/Geist/webfonts/Geist[wght].woff2
fonts/GeistMono/webfonts/GeistMono[wght].woff2
LICENSE.txt
OFL.txt
```

Bundle the original font binaries locally with the supplied notice files. Retain system fallback fonts for unsupported scripts and glyphs. Font preference and editor text size remain user-configurable. No forced ligatures, no synthesized font weights, and no network font dependency.

## Packaging and attribution

Maintain a versioned asset registry containing semantic ID, repository URL, exact version/commit, source path, SHA-256, license identifier, notice-file paths, modification status, and intended use. Brand assets also record an official guidelines URL and review date. This makes updates reviewable without interpreting licenses anew for every component.

Ship applicable full license texts in app resources and expose them through **About → Third-party notices**. The following is a **draft notice template**, not proof that Foundation’s complete distribution notices have already been assembled:

```text
Foundation third-party design assets

Lucide 0.576.0 — Lucide Contributors; Feather portions by Cole Bemis.
https://github.com/lucide-icons/lucide
ISC and MIT notices: licenses/lucide-LICENSE.txt
Modifications: [describe changes, or “Unmodified” after verification].

Codicons [bundled version] — Microsoft and contributors.
https://github.com/microsoft/vscode-codicons
Artwork: Creative Commons Attribution 4.0 International.
https://creativecommons.org/licenses/by/4.0/
Code: MIT. Full notices: [verified packaged paths].
Modifications: [describe changes, or “Unmodified” after verification].

Geist Sans and Geist Mono 1.8.2 — retain both upstream copyright records.
https://github.com/vercel/geist-font
SIL Open Font License 1.1.
Full notices: licenses/geist-LICENSE.txt and licenses/geist-OFL.txt.
Modifications: Unmodified font binaries [verify against recorded hashes].
```

Preserve all supplied attribution and copyright information; the short About entry supplements the full texts. Application terms must not impose additional restrictions on CC-licensed Codicons artwork. Brand marks never become Foundation’s branding or imply a partnership.

Before distribution, the packaging check must reject used assets missing registry entries, changed hashes without review, or missing required notices. The reference specimen’s included notices cover its bundled assets only; they do not certify every dependency in the complete desktop application.
