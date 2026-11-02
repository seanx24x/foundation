# Foundation design system — v1.3

**Status:** the design contract for the next implementation phase, with craft revision 1.3 dated 27 October 2026. This document supersedes the initial visual defaults; it does not claim the current 0.4 desktop already conforms. This revision refines the interactive reference. The running desktop app and unsaved project files are unchanged.

**Intent:** a precise creative instrument. The product being made occupies the strongest visual plane. Navigation stays quiet. Selection, causality, scope, and evidence supply the distinctive visual language.

The system comprises this specification, [product principles](product-principles.md), [icon and font policy](iconography-and-licensing.md), [canonical tokens](../design/foundation.tokens.json), and the [interactive reference](../artifacts/design-system-v1/index.html). “Must” is a requirement; exceptions need a recorded reason and owner. Do not introduce a second palette or independent component scale.

## 1. Direction and identity

Take Linear's stable action placement and restrained navigation, and Vercel's semantic color roles and complete typography recipes. Foundation uses its own palette and geometry. These references inform decisions; their visual assets and proprietary components are not being copied. [Linear's 2026 refresh](https://linear.app/now/behind-the-latest-design-refresh), [Geist colors](https://vercel.com/geist/colors), [Geist typography](https://vercel.com/geist/typography).

The memorable behavior is **one selected product element remaining connected to its implementation and evidence**. A restrained cobalt selection line, matching source emphasis, and an ordered path through component → action → request → result make that connection visible. This path only includes relationships that exist; uncertain links are explicitly marked.

The workbench uses flush panels, quiet neutral planes, generous enough hit areas, and dense readable content. Floating surfaces are reserved for temporary commands, inspection, and focused decisions. No decorative gradient chrome, glass over code, glowing AI borders, rainbow status dashboards, or repeated card containers around ordinary editor content. A stable, readable system under real work is the quality target.

## 2. Token architecture and ownership

`design/foundation.tokens.json` is the canonical, versioned, project-specific schema. It contains resolved semantic colors for two themes plus geometry, type, density, motion, and declared contrast pairs. It is not advertised as a complete DTCG interchange file. Generate consumer files from it; do not hand-edit generated CSS.

| Layer | Examples | Rule |
| --- | --- | --- |
| Foundations | 4px base, font families, size ladder | Small allowlist; no per-component inventions. |
| Semantic roles | `surface.editor`, `text.muted`, `accent.surface` | Components express purpose, not raw hex. |
| Component recipes | `control`, `navigatorRow`, `evidenceBadge` | Assemble semantic roles and dimensions. |
| Host adapters | Code OSS colors, webview aliases, editor syntax | Explicit mapping; gaps remain recorded. |

Foundation owns its workbench and added surfaces. Native OS chrome, user code, inspected application content, third-party extensions, and user-configured editor typography retain their own authority. Host theme and preview product theme are independent: a dark IDE can inspect a light product.

## 3. Light and dark color contract

Both themes are first-class. “System” follows the OS preference until a user chooses Light or Dark. Theme changes preserve selection, focus, scroll, experiments, and proposals. Existing custom editor themes remain supported; Foundation surfaces must fall back to registered host tokens when a custom theme is active.

The light theme uses white work surfaces and recessed silver navigation. The dark theme uses distinguishable neutral graphite planes without pure-black holes. Primary actions are neutral; cobalt identifies links, selection, and focus. Green means a successful result, never merely “AI is working.”

| Semantic token | Light | Dark |
| --- | --- | --- |
| `surface.workspace` | `#F5F5F7` | `#111112` |
| `surface.navigation` | `#EEEEF1` | `#171719` |
| `surface.panel` | `#FAFAFB` | `#1E1E21` |
| `surface.editor` | `#FFFFFF` | `#202023` |
| `surface.raised` | `#FFFFFF` | `#28282C` |
| `surface.hover` | `#E9E9ED` | `#303034` |
| `surface.pressed` | `#DCDCE2` | `#3B3B41` |
| `border.subtle` | `#DFDFE5` | `#36363C` |
| `border.control` | `#82828E` | `#8B8B96` |
| `text.primary` | `#202024` | `#F2F2F4` |
| `text.secondary` | `#55555F` | `#C2C2CB` |
| `text.muted` | `#595965` | `#ACACB8` |
| `text.disabled` | `#808A99` | `#7F7F88` |
| `accent.text` | `#2449B7` | `#AEC3FF` |
| `accent.surface` | `#E8EEFF` | `#27365E` |
| `accent.fill` | `#315BD6` | `#9AB7FF` |
| `accent.onFill` | `#FFFFFF` | `#111A30` |
| `focus.ring` | `#315BD6` | `#9AB7FF` |
| `action.fill` | `#242428` | `#F0F0F4` |
| `action.hover` | `#3A3A42` | `#DADAE1` |
| `action.onFill` | `#FFFFFF` | `#171719` |
| `status.success.text` | `#176340` | `#90DBAE` |
| `status.success.surface` | `#E5F5EC` | `#173C2A` |
| `status.warning.text` | `#805211` | `#EDC67A` |
| `status.warning.surface` | `#FFF1D5` | `#3D3018` |
| `status.error.text` | `#B0293D` | `#FFACB7` |
| `status.error.surface` | `#FDECEF` | `#44232D` |
| `status.info.text` | `#2449B7` | `#9AB7FF` |
| `status.info.surface` | `#EDF2FF` | `#233454` |
| `evidence.ai.text` | `#6D47B8` | `#C7AFF2` |
| `evidence.ai.surface` | `#F2ECFF` | `#342746` |
| `syntax.keyword` | `#7445A8` | `#CAA7EF` |
| `syntax.string` | `#216744` | `#9DD6B6` |
| `syntax.function` | `#2459B6` | `#A0C2FF` |
| `syntax.number` | `#9B4E18` | `#E7BC82` |
| `syntax.comment` | `#626D7E` | `#9DA7B8` |
| `diff.add.surface` | `#ECF8F0` | `#18372A` |
| `diff.remove.surface` | `#FDEEEF` | `#40252C` |
| `diff.change.surface` | `#EDF2FF` | `#233454` |

All values are opaque sRGB, so their pairings are predictable. Translucent colors are allowed only for scrims, shadows, and purpose-specific overlays whose composited contrast is separately checked. Do not lower an entire container's opacity to create secondary text.

### Approved combinations

- `text.primary`, `text.secondary`, and `text.muted` work on the seven ordinary surfaces, selection fill, and the three diff fills. All declared pairs meet 4.5:1 in the token calculation.
- Status text is paired with its own status surface; status icons inherit that text. AI interpretation uses the evidence pair. These meanings always include labels or shapes.
- Filled controls use `action.onFill` on `action.fill`/`action.hover`; selection actions use `accent.onFill` on `accent.fill`. Never use generic white text on arbitrary status fills.
- `border.subtle` separates already distinguishable regions. It is **not** sufficient as the only indication of a control. Required input boundaries use `border.control`.
- `text.disabled` is only for genuinely inactive controls accompanied by an accessible explanation. Never reuse it for timestamps, file paths, helper text, token origins, or empty-state instructions.
- Focus uses a 2px `focus.ring` stroke with a 2px surface-colored separation. Keep it visible inside clipped panels. Text selection and keyboard focus are separate states.

The validator checks **114 declared opaque pairs**, with 4.5:1 for normal text and 3:1 for essential control boundaries/focus. This is a token check, not certification of rendered components or the application. The thresholds follow [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

### Editor, terminal, diff, and evidence

Code and terminal use `surface.editor` and primary text. Syntax roles are separate from product status: purple keywords, green strings, blue functions, amber numeric literals, readable muted comments. User syntax themes and semantic highlighting remain configurable.

Diff rows combine a subtle add/remove/change fill with a plus/minus/change gutter symbol and textual change summaries. Never rely on red/green alone. ANSI terminal colors, diagnostic squiggles, selection alpha overlays, and semantic-token variants require a dedicated host mapping and rendered verification during migration; the base token audit does not cover the full ANSI palette.

Evidence has four exact labels: **From source**, **Observed**, **AI interpretation**, **Unknown**. Freshness is orthogonal: a source fact or observation can be stale. Show the revision/session and the reason for staleness on inspection. Success styling is attached to a passed check, never to an unverified explanation.

## 4. Typography

Use **Geist Sans** for the Foundation interface and **Geist Mono** for code, terminal output, paths when exact alignment matters, and numeric technical values. Both are licensed under SIL OFL 1.1; the reference bundles the verified font files and full notices. The production package must retain the notices too. [Pinned font source and obligations](iconography-and-licensing.md).

| Role | Size / line box | Weight | Use |
| --- | --- | --- | --- |
| Caption | 12 / 16 | 400 | Secondary metadata, help, timestamps. |
| Label | 12 / 16 | 500 | Field labels, evidence labels. |
| UI | 13 / 20 | 400 | Trees, menus, tabs, dense values. |
| UI strong | 13 / 20 | 500 | Active item, key value, button label. |
| Body | 14 / 20 | 400 | Explanations, plans, error recovery. |
| Section | 16 / 24 | 600 | Panel identity and section headings. |
| Title | 20 / 28 | 600 | Dialog or task title. |
| Display | 24 / 32 | 600 | Project setup and rare empty-state introductions. |
| Code | 13 / 20 | 400 | Initial editor and terminal default; user may override. |

Use only weights 400, 500, 600. No synthetic bold, normal-copy all caps, or tracking on small labels. Body tracking is 0; title/display tracking may be −0.02em. Use tabular figures for aligned timing, counts, and measurements. Limit explanatory prose to roughly 64–76 characters per line. Code never wraps merely to satisfy this prose rule.

12px is the floor for meaningful Foundation text at 100% UI zoom. Density does not shrink the type. Increased text size and zoom may increase line/control heights to avoid clipping. Essential labels wrap or reveal their full value; destructive actions and scope warnings are never ellipsized.

## 5. The 4px grid

All Foundation-owned **layout** starts on a 4px logical grid. Approved spacing: **0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96**. Use 4 for related micro-spacing, 8 for icon/label gaps, 12 for control horizontal inset, 16 for panel content, 24 between content sections, and 32 for major surface padding.

Padding, gaps, indent levels, resting panel widths, row heights, control boxes, icon boxes, line boxes, and radii must use tokens. Borders draw inside these dimensions (`box-sizing: border-box`) or overlay seams; they must not accumulate extra layout pixels. One adjoining surface owns a divider, so there are no doubled seams.

### Snapping and exceptions

Panel dragging follows the pointer continuously. A preview guide shows the grid landing position; on release, commit the nearest valid multiple of 4. Clamp to bounds, snap, then clamp again. Keyboard resizing uses 4px increments and Shift uses 16px. Escape restores the drag's starting size; pointer cancellation releases capture without committing an accidental size. Double-click and a named command restore the default.

The following exceptions are deliberate, not permission for arbitrary spacing:

1. **1px hairlines and icon strokes**, and a **2px focus ring/2px separation**, are optical marks.
2. **Font sizes, glyph metrics, tracking, and baseline optical correction** are typographic values. The line box stays on-grid. Forcing 13px text to 12 or 16 would reduce the available hierarchy.
3. **Native macOS frame, traffic lights, menus, and display rasterization** follow the platform. CSS pixels and native points are logical units, not physical screen pixels.
4. **User editor preferences, existing saved layouts, and third-party UI** are not silently normalized. New deliberate resize/reset operations adopt the grid.
5. **Fractional live measurements and external product geometry** remain exact. A measured button width of 127.5px must stay 127.5px; never falsify evidence or change user code to fit Foundation's chrome grid.
6. **Continuous drag/zoom coordinates and flexible center remainder** may be fractional or absorb 0–3px when an OS window has an arbitrary size. Fixed rails and committed panel sizes remain snapped.

The visual editor's *project* grid is separately configurable and visibly scoped. Foundation's workbench grid never authorizes a design change in the project.

## 6. Geometry, density, and materials

| Recipe | Standard | Compact | Coarse pointer |
| --- | --- | --- | --- |
| Selectable row / control hit box | 32px | 28px | 44px |
| Section header | 32px | 28px | 32px |
| Icon artwork | 16px; 20px for prominent tools | Same | Same |
| Related item gap | 8px | 4px | 8px |
| Tree indent | 16px | 16px | 16px |
| Default body/type roles | Unchanged | Unchanged | Unchanged; editable controls at least 16px where mobile browser behavior requires it |

Standard is the default. Compact is opt-in and intended for dense desktop workflows. Controls can use 40px on setup/dialog forms and 44px for touch-facing actions. A 16px icon is never a 16px click target. Targets exceed WCAG's 24px minimum in ordinary desktop controls; inline text links and native-owned controls have documented exceptions. [Target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

**Radius:** 0 for flush panes and dividers; 4 for row selections, keycaps, compact badges; 8 for buttons, inputs, menus; 12 for dialogs/command palette; 16 only for an isolated stage or reference attachment. Circular avatars use 50%. Status badges are not pill buttons. Nested radius is `max(0, outerRadius − inset)` using approved tokens; no 5/6/7/10/13px improvisation.

Ordinary panels have no shadow. Menus use an 8px vertical/24px blur shadow; dialogs use 16px/48px. Light shadow opacity is 12% and 18%; dark is 24% and 32%, always with an opaque surface and a visible border. These are depth cues, not required control contrast. No backdrop blur over code, traces, or inspector values. High-contrast/forced-colors mode replaces fills/shadows with explicit system boundaries.

## 7. Windows, panels, and responsive arrangements

All dimensions are logical. **Initial window: 1440 × 960**, clamped to the usable display area; round the initial available content dimensions down to 4px where possible. Restore the user's geometry thereafter. Recommended everyday minimum: 1280 × 800. Full-workspace design floor: 1024 × 640. Provide a usable 800 × 600 narrow fallback rather than refusing small screens or OS tiling. This is a design target, not a claim that the current upstream minimum is already changed.

| Region | Default | Minimum | Maximum / behavior |
| --- | --- | --- | --- |
| Window titlebar / workspace toolbar | 48 | Platform-owned | Contains activities and context commands. macOS traffic-light geometry stays native. |
| Separate workflow bar | 0 | 0 | Activities occupy the window toolbar; do not add a second permanent row. |
| Editor tabs / primary panel header | 40 | 40 | Align the center, navigator, and inspector headers. Labels retain full accessible names. |
| Internal section header | 32 | 28 in Compact where appropriate | Subordinate to the primary panel header. |
| Activity rail | 48 | 48 | Can collapse in narrow focus mode. |
| Navigator | 240 | 192 | 360. |
| Context inspector | 320 | 280 | 480. |
| AI task panel | 384 | 320 | 560; usually replaces inspector, not an extra permanent column. |
| Primary center | Flexible | 480 | Remaining width; inspectable single surface. |
| Each source/preview split | Equal initially | 384 | Split requires at least 768px center width. |
| Bottom terminal/evidence tray | 240 | 160 | min(480, 60% available main height), while preserving 320px main content. If impossible, use focused tray mode. |
| Statusbar | 24 | 24 | Readiness and task state; never a second toolbar. |
| Resize separator | 1px visible | 8px pointer zone | Keyboard resize command provides an equivalent accessible path. |
| Dialogs | 400 /560 /720 | Viewport minus32 | Small /standard /large, max height viewport minus64 with internal content scroll. |
| Command palette | 640 | Viewport minus32 | Max height viewport minus96. |
| Tooltip | Content sized | — | Max320, wrap rather than truncate. |

### Resolve from available space, not device names

The reference opens in **Canvas**. **Split** and **Code** are explicit view choices; a wide window does not automatically introduce another surface. Split requires at least 768px of actual center width. Below that threshold, keep Canvas visible, explain why Split is unavailable, and preserve the selected entity and local experiment. Desktop coarse-pointer arrangements increase chrome heights as needed to accommodate 44px targets; the default geometry above describes pointer-led desktop use.

At 1440px, 48rail +240navigator +320inspector leaves **832px center**: two416px panes are viable. At 1280px it leaves672px: use one primary surface, or explicitly move the inspector into a drawer for a source/preview split. At 1024px, 48rail +192navigator leaves784px when the inspector is in a drawer; both 384px panes fit. At 800px, use one primary surface and open the inspector as an intentional dismissible sheet. Keep the navigator only while the 480px center minimum fits; otherwise collapse navigator/rail into commands.

Calculate these rules from the **actual container**, including when Foundation still lives in a Code OSS editor group. Do not assume the webview spans the OS window. On shrink, move the least-recently-used auxiliary pane to a labeled drawer before violating center minima; preserve its state and provide a restore action. Do not auto-close the focused surface or hide an active destructive decision. A deliberate focus mode is preferable to crushing three panels.

Store layout per project/activity and respect monitor changes. Reset Layout changes geometry only. Source scroll, selected entity, preview state, terminal sessions, and task context remain intact. Viewport sizes inside a preview are product-test dimensions; “Fit” changes display scale, never the simulated viewport width.

## 8. Core component contracts

| Component | Anatomy and required states |
| --- | --- |
| Button | One action verb, optional16px icon, 8px gap,12px horizontal inset. Neutral primary/secondary/ghost/destructive recipes. Default, hover, pressed, focus, busy, disabled. Busy preserves width and offers Cancel when applicable. |
| Field | Persistent label, editable value, unit where applicable, origin/scope, validation/recovery. Typing remains mounted through async updates. Mixed, inherited, overridden, unsupported, invalid, and stale are distinct. |
| Navigation row |16px indent steps, disclosure independent of opening,32/28row. Full-row selection plus non-color marker, readable dirty/source-control status. Full path available on keyboard focus. |
| Tab | Stable title, dirty indicator, close target; never compress hit areas belowdensity. Overflow scroll/accessible list. No tab title rewriting for background AI chatter. |
| Evidence row | Provenance icon + exact label + concise claim. Open supporting source/session; freshness and confidence do not replace evidence. Unknown has a next action when available. |
| Preview selection | Thin cobalt boundary plus identity label anchored outside the element where possible. Hover dashed; locked selection solid. Color-independent labels; exact measurements and mapping candidates. |
| Token control | Label, selector/theme scope, saved value, experimental value, inherited/shared consumers. Reset only experiments. Review shows exact source edit before Apply. |
| Task item | Goal, actual current operation, context summary, changed files, elapsed time when useful, Cancel. Queued/running/waiting/blocked/cancelled/complete have visible text. Completion is distinct from verification. |
| Change review | Intent, revision, scope/consumers, native diff, before/after or named states, separate compile/interaction/visual results, Apply/Undo. Applying is distinct from commit/publish/deploy. |
| Empty/disconnected/failed | State the missing capability, last known revision if useful, and next action. Keep unrelated editing available. Do not replace the workspace with a global error page. |
| Menu/command palette | Searchable commands with scope and shortcuts; unavailable commands explain prerequisites. Stable ordering, Escape dismissal, focus restoration. |
| Toast/banner | Toast for completed low-risk events; persistent inline banner for stale/failed/blocked work. Never rely on a disappearing toast as the only record of failure. |

## 9. AI and visual-tool grammar

AI is a capability within all four activities, not a competing destination. The current Assistant tab is an implementation starting point; the target places task/context/review controls beside the selected work. No sparkle logo, accent wash, or permanent chat column is required to demonstrate AI.

Every change shows **intent → context → scope → proposal → verification → decision**. Available context and actual provider-bound context are separately inspectable. A model explanation is labeled as interpretation even when fluent. Cancellation stops new work and shows exactly what remains; it never silently discards user changes.

Visual edits begin as experiments. Instance/component/token/project scope must be shown before generating a source proposal. Unsupported source mappings offer candidates and prevent unjustified direct edits. Light/dark and viewport are named scenario dimensions; stale captures cannot be displayed as current verification.

The signature future experiences are Connected selection, State comparison, Scope preview, and Change review with evidence. Their detailed behavior and current capability boundaries live in [product principles](product-principles.md).

### AI artifact components

The chat pane uses a shared artifact family for context, source explanations, plans, task/tool runs, code changes, visual comparisons, API evidence, verification, decisions, and deliverables. Cards carry stable identity, explicit scope, revision, provenance, freshness, and one clear next action. Their full anatomy, states, format renderers, safety boundaries, and typed integration model are specified in [AI artifacts](ai-artifacts.md). The Components → AI artifacts catalog demonstrates these as local specimens; it does not connect a model or execute project actions.

## 10. Keyboard, accessibility, and motion

Preserve Code OSS editing shortcuts. Every Foundation action has a named command; new shortcuts require a conflict audit. Tab follows the visible arrangement, trees/tablists use established keyboard patterns, and asynchronous updates preserve caret, selection, focus, and IME composition. Escape closes the innermost transient surface first and returns focus to its trigger. Resize and drag actions have command/keyboard equivalents.

UI zoom to 200%, text scaling, forced colors, reduced motion, long labels, and screen readers are release requirements. Announce meaningful task state changes politely; do not read every token/log or cursor movement. Never use color as the only indication of selection, failure, scope, provenance, or diff direction. A design approval is not an accessibility certification.

Motion tokens: **0ms** for input/pressed feedback, **80ms** hover color, **120ms** disclosure, **160ms** panel transitions, **220ms** workspace rearrangement. Default easing `cubic-bezier(0.2, 0, 0, 1)`. Continuous gestures track 1:1; any settling begins at the current presentation value and is interruptible. No overshoot in panel geometry, button-scale bounce, typewriter answers, or animated gradients. Reduced motion removes spatial movement and retains instant state changes and plain progress text. A transition never delays an action or prevents cancellation.

### Proposed responsiveness budgets

Measure on a published reference Mac and representative project fixtures. Target local input feedback at p95 below 50ms, cached selection/context transitions below 100ms, and 60fps during panel manipulation. No input-blocking main-thread task should exceed 50ms during the core flow. Cancellation acknowledges immediately; long-running tools then report their actual stopping state. Cold startup, indexing and model latency receive separate budgets after measured baselines. These are future acceptance targets, not results from the current build.

## 11. Host implementation map

| Semantic source | Code OSS mapping examples / later work |
| --- | --- |
| `surface.editor`, `text.primary` | `editor.background`, `editor.foreground`, terminal background/foreground. |
| `surface.navigation` | `sideBar.background`, `activityBar.background`. |
| `surface.panel`, `surface.raised` | `panel.background`, `editorWidget.background`, `menu.background`, `quickInput.background`. |
| `text.secondary`, `text.disabled` | `descriptionForeground`, `disabledForeground`; preserve meaningful metadata mapping. |
| `accent.text`, `accent.surface`, `focus.ring` | `textLink.foreground`, list/selection roles, `focusBorder`; active/inactive states need explicit pairs. |
| Status roles | `errorForeground`, testing icons, diagnostics; distinct severity and state. |
| Syntax/diff roles | TextMate and semantic-token mappings, diff editor/SCM gutter. |
| Geometry, fonts, density | Cannot be set by a theme JSON alone; supported host settings first, narrow pinned-host changes only where needed. |

Current native upstream dimensions include 35px titlebar/tabs and 22px statusbar; current Foundation webview has 53px header, 47px activity bar, 29px icon targets, several tiny metadata roles, and inconsistent radii. Therefore a webview restyle alone is not “the desktop design system implemented.” The extension currently occupies an editor group; the integrated shell is a distinct engineering phase.

Bundled fonts in a webview require local packaged resources and a narrow `font-src` using the webview's resource origin. Do not add remote font/CDN requests. Preserve custom-theme fallbacks and user editor preferences.

## 12. Enforcement and migration gates

1. **Definition, now:** tokens, reference, product principles, licensed asset policy, contrast/geometry checks. No runtime app changes or re-signing.
2. **Foundation surfaces:** consume generated semantics, register icon names, replace ad-hoc spacing/small text, implement Standard/Compact and container-driven inspector. Keep sandbox/proposal/draft behavior unchanged.
3. **Native integration:** adapt titlebar, tabs, statusbar, trees, and panel ownership through reviewed host changes. Verify extensions and both themes; do not enable an upstream experimental UI merely to obtain convenient dimensions.
4. **Signature workflows:** extend connected source/runtime selection, scenario comparison, scope discovery, and review evidence. Each ships behind a supported capability, with explicit unsupported states.

Run `node scripts/validate-design-system.mjs` for token geometry, parity and declared contrast checks; `--write` regenerates the reference CSS and report. Later CI must additionally prohibit raw component colors/unapproved dimensions, validate icon registry and license inventory, and inspect actual rendered geometry in both webview and native host.

Required acceptance matrix: Light/Dark × Standard/Compact; 1440×960, 1280×800, 1024×768, 800×600; 200% UI zoom; long/localized names; normal, empty, loading, failed, disconnected, stale, dirty, ambiguous mapping; keyboard-only, reduced-motion and forced-colors paths. Include real code, long diffs, multiple tasks, slow indexing and unavailable AI—not only an empty screen.

Keep an exception registry containing token/component, reason, scope, owner, test and revisit condition. A one-off CSS override is not an accepted exception. Version changes and migration notes travel with the canonical tokens. Award-level craft is a product goal; the release bar is repeatable evidence that the system is coherent, fast, accessible and reliable under real work.

## 13. Craft revision 1.1 — retained baseline

This section records the 1.1 baseline. The composition and palette refinements in section 14 supersede its presentation defaults. The reference makes the product canvas the focal surface and gives the surrounding tools a clear supporting role. This is a refinement of the existing semantic system, not a replacement palette or a desktop implementation claim.

- **Quiet structure.** Recess navigation, soften nonessential seams, and use spacing to group inspector sections. Reserve stronger boundaries for fields, focus, and selected product geometry. Keep the selected file readable with a shape or position cue; avoid repeating cobalt fills across every surface that mentions the selection.
- **One connected identity.** Keep the selected component in a stable context strip. Canvas, Code, inspector, and review retain that identity across Understand, Build, Refine, and Review. Show provenance and capability limits where they affect a decision, with concise copy instead of repeated explanatory panels.
- **Deliberate framing.** The titlebar is 40px, workflow bar 44px, primary tabs/headers 40px, and statusbar 24px. Navigator and inspector remain 240px and 320px by default. The canvas may frame an isolated product artboard; ordinary editor and inspector panes remain flush. The reference's enclosing page is presentation scaffolding, not additional desktop chrome.
- **Precise controls.** Measure the complete control box, including borders. Standard and Compact controls must resolve to 32px and 28px, with unchanged typography. Use explicit single-line heights and overlay seams so padding and borders do not produce accidental 30px, 38px, or 26px boxes. Allow readable multiline content to grow on the grid. Preserve 44px coarse-pointer targets and visible keyboard focus.
- **Direct, reversible refinement.** The selected button exposes corner-radius presets in 4px steps and a numeric field. Changes update only the local preview and appear as a visible experiment. Instance, Component, and Token describe intended scope; they do not establish discovered consumers. Reset restores the specimen's saved appearance. Review compares saved and preview values, shows the chosen scope, and reports verification as not run. Source application remains unavailable in this reference.
- **Behavior earns the finish.** Commands are searchable and keyboard accessible; drawers and dialogs dismiss predictably and restore focus. Loading, error, and default examples remain distinguishable, with appropriate busy/disabled semantics. Press feedback is immediate, transitions remain interruptible, and reduced motion keeps the same state information without spatial movement. The reference has no connected model, runtime, or source-writing capability.

### Rationale and acceptance

Linear's 2026 refresh prioritizes the working content by quieting navigation, reducing redundant icons, and simplifying separators. Foundation applies that hierarchy to the selected product and its supporting tools. [Linear: A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh).

Vercel separates color roles for component backgrounds, interaction states, boundaries, and readable foregrounds; its typography recipes specify size, line-height, tracking, and weight together. Foundation retains its own semantic values while applying that discipline consistently. [Geist colors](https://vercel.com/geist/colors), [Geist typography](https://vercel.com/geist/typography).

Apple uses material and depth to distinguish functional layers from content and recommends restraint. Foundation reserves elevation for temporary controls and focused decisions; code, traces, and measured values stay opaque. [Apple Human Interface Guidelines: Materials](https://developer.apple.com/design/human-interface-guidelines/materials).

Accept this revision only after checking both themes and densities, Canvas/Split/Code transitions, the 768px Split threshold, local edit/reset/review continuity, and keyboard dismissal/focus. Token validation, rendered geometry, visual review, and interaction checks remain separate evidence. Passing the reference checks does not establish native Code OSS conformance, live source mapping, AI integration, or application verification.

## 14. Craft revision 1.2

The reference presents Foundation as a working instrument with the product occupying the clearest visual plane. The changes apply to the design contract and standalone reference; they do not establish native Code OSS conformance or modify the running desktop build.

- **One compact outer bar.** The reference uses a 64px presentation header for its identity, reference destinations, and display controls. Remove the separate workbench marketing introduction and redundant navigation row. This header belongs to the reference site, not to the native IDE's window geometry.
- **Neutral supporting surfaces.** Graphite and silver replace the earlier cool-tinted shell neutrals. Keep the established accent, evidence, status, and syntax roles. Distinguish planes through their surface values and purposeful seams; do not make secondary text faint to obtain a quieter appearance. The canonical table in section 3 records the exact values.
- **A separately themed product.** The Orbit sample artboard opens in Light even when Foundation uses Dark. Product appearance and shell appearance have separately named controls and independent state. Switching the shell theme must preserve the artboard theme, selection, experiment, and scenario. A real inspected product retains its own styles; these sample tokens do not authorize rewriting user content.
- **One workspace toolbar.** The reference combines window identity, Understand/Build/Refine/Review, commands, and inspector access in a single 48px titlebar/toolbar. The separate workflow-bar token becomes 0. This replaces the 1.1 titlebar-plus-workflow total of 84px and recovers 36px. Native dragging regions, macOS traffic-light placement, keyboard traversal, and narrow/coarse-pointer arrangements still require host validation.
- **More room for the canvas.** Merge the selected-component context and preview controls into one row, while keeping Canvas, Split, and Code readily available. Consolidate repeated identity and explanation. Navigator, inspector, source-pane minima, radius tokens, and the 4px geometry contract remain unchanged. Resolve the arrangement from actual available space.
- **A persistent review decision.** Keep Review and Reset reachable at the bottom of the inspector while longer properties scroll. Show local-change state and intended scope beside that decision. A change remains a preview experiment until a real source-writing workflow is implemented; review must retain exact saved/current values and verification outcomes.
- **A restrained product frame.** Give the Orbit sample enough location and screen context to read as a product, without layering another full IDE around it. Product chrome supports orientation. The selected element, source anchor, scope, and experiment state provide Foundation's recognizable visual connection.

### Revision acceptance

Check Dark shell / Light product, Light shell / Light product, and both shell themes with a Dark product. Verify that toggling one appearance does not toggle the other or reset the experiment. Inspect the recovered canvas height, persistent review actions, narrow drawer behavior, compact 28px controls, and keyboard focus. The token validator continues to require 4.5:1 for declared text pairs and 3:1 for essential boundaries/focus; no contrast threshold is relaxed for this revision. Report token checks, visual acceptance, and interaction results separately.

## 15. Component revision 1.3 — AI artifacts

The Components reference now separates Interface primitives from AI artifacts. A realistic 384px chat specimen shows one selected family, with a state selector and its component contract beside it. Expanded detail preserves the selected artifact and restores focus to its originating control. This is a target chat-pane design; it does not replace or extend the native 0.4 agent runtime.

Artifact shells use the existing semantic palette, 12px radius, 16px inset, 8px related gaps, 13/20 titles, 14/20 prose, and 12/16 metadata. Standard/Compact controls remain 32/28px. Cards retain readable partial content in streaming, stale, failed, and cancelled examples. State, provenance, freshness, and verification have separate fields and visible labels. No card becomes applicable just because generation is complete.

## 15. Native workspace migration — 0.6

The [connected native workspace](native-workspace.md) applies the canonical palette to host themes and introduces compact Foundation chrome, bundled Geist typography, host-owned selection continuity and an accessible resizable inspector. Upstream-owned dimensions and host typography remain outside this increment; full desktop conformance is still a separate gate.
