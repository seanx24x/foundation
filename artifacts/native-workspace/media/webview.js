(() => {
  "use strict";
  const vscode = acquireVsCodeApi();
  const persisted = vscode.getState() || {};
  const workspace = window.FoundationWorkspace;
  const modes = ["Understand", "Refine", "Review", "Assistant"];
  const state = {
    mode: modes.includes(persisted.mode) ? persisted.mode : "Understand",
    project: null,
    focus: null,
    layouts: workspace.normalizeLayouts(persisted.layouts),
    inspectorOpen: false,
    activeFile: null,
    openFiles: [],
    dirtyPaths: [],
    changes: [],
    selection: null,
    trusted: false,
    provider: null,
    error: "",
    status: "",
    connected: false,
    context: [],
    contextInitialized: false,
    question: persisted.question || "",
    turns: [],
    running: false,
    sourceExpanded: false,
    lastProject: null,
    intent: persisted.intent === "change" ? "change" : "ask",
    design: null,
    proposal: null,
    designEntry: "",
    designWidth: persisted.designWidth || "960",
    designTheme: persisted.designTheme || "light",
    designInspect: true,
    designFit: true,
    pendingDesignContext: null,
    designSelection: undefined,
    unmappedMessage: "",
    tokenDrafts: {},
    tokenInputs: {},
    selectedToken: null,
    tokenFilter: "",
    skippedExperiments: 0,
  };
  const root =
    document.getElementById("foundation-root") ||
    document.getElementById("app") ||
    document.body;
  let composer = null;
  let responseRegion = null;
  let turnCounter = 0;
  let designFrame = null;
  let renderedDesignSession = null;
  let renderedDesignProject = null;
  let designSettingsSignature = "";
  let designResizeObserver = null;
  let renderedTokenEditorKey = "";
  let refreshTokenEditor = null;
  let chromeSlot, mainSurface, designSlot, otherSlot, footerSlot;
  let layoutObserver = null;
  let inspectorDrag = null;
  const scrollPositions = new Map();
  const hydratedLayouts = new Set();
  const iconPaths = {
    source: "M5 3h9l5 5v13H5z M14 3v6h5 M9 13l-2 2 2 2 M15 13l2 2-2 2",
    graph:
      "M12 4v5 M5 18v-5h14v5 M12 13v5 M9 1h6v6H9z M2 18h6v5H2z M9 18h6v5H9z M16 18h6v5h-6z",
    arrow: "M5 12h14 M14 7l5 5-5 5",
    external: "M8 5H4v15h15v-4 M12 4h8v8 M20 4L9 15",
    check: "M5 12l4 4L19 6",
    review: "M8 3H4v18h16V3h-4 M8 2h8v4H8z M8 11l2 2 5-5 M8 17h8",
    inspect: "M5 3l14 10-7 1-3 7z",
    spark: "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
    folder: "M3 5h6l2 3h10v12H3z",
    refresh: "M20 10a8 8 0 1 0-1 7 M20 3v7h-7",
    terminal: "M4 6l5 6-5 6 M12 18h8",
    search: "M15 15l6 6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    debug: "M8 6h8v14H8z M10 2h4 M4 9h4 M16 9h4 M4 15h4 M16 15h4",
    branch:
      "M6 7v10 M18 7a6 6 0 0 1-6 6H6 M6 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4 M18 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4 M6 17a2 2 0 1 1 0 4 2 2 0 0 1 0-4",
    close: "M6 6l12 12 M18 6L6 18",
    shield: "M12 2l8 3v7c0 5-8 10-8 10S4 17 4 12V5z M8 11l3 3 5-6",
    chevron: "M9 5l7 7-7 7",
    stop: "M6 6h12v12H6z",
    send: "M12 20V4 M5 11l7-7 7 7",
    color:
      "M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h5c4 0 3-10-6-10z M7 8h.1 M11 6h.1 M16 8h.1 M6 13h.1",
    code: "M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18",
  };
  function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }
  function icon(name, size = 16) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", iconPaths[name] || iconPaths.source);
    svg.append(path);
    return svg;
  }
  function button(label, handler, className = "button", glyph) {
    const b = el("button", className);
    b.type = "button";
    if (glyph) b.append(icon(glyph));
    b.append(el("span", "", label));
    b.addEventListener("click", handler);
    return b;
  }
  function action(id) {
    vscode.postMessage({ type: "action", id });
  }
  function navigate(path, line = 1) {
    vscode.postMessage({ type: "navigate", path, line });
  }
  function basename(path) {
    return path?.split("/").pop() || "Source";
  }
  function pathParent(path) {
    return path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "Project root";
  }
  function byteLength(value) {
    return new TextEncoder().encode(value).length;
  }
  function formatBytes(value) {
    return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB`;
  }
  function saveView() {
    vscode.setState({ mode: state.mode, question: state.question, intent: state.intent,
      designWidth: state.designWidth, designTheme: state.designTheme, layouts: state.layouts });
  }
  function setMode(mode) {
    if (!modes.includes(mode)) return;
    if (mainSurface) scrollPositions.set(state.mode, mainSurface.scrollTop);
    state.mode = mode;
    saveView();
    render();
    if (mode === "Assistant") composer?.focus();
  }
  function badge(label = "From source", kind = "source") {
    const b = el("span", `badge ${kind}`, label);
    b.prepend(el("i"));
    return b;
  }
  function sectionHeading(title, count) {
    const h = el("div", "section-heading");
    h.append(el("h2", "", title));
    if (count !== undefined) h.append(el("span", "count", count));
    return h;
  }
  function note(text, kind = "") {
    const n = el("div", `note ${kind}`);
    n.append(
      icon(kind === "error" ? "shield" : "source", 14),
      el("span", "", text),
    );
    return n;
  }
  function fileLink(path, line, title, detail) {
    const b = el("button", "file-link");
    b.type = "button";
    b.title = `${path}:${line || 1}`;
    b.addEventListener("click", () => navigate(path, line));
    const copy = el("span", "file-link-copy");
    copy.append(el("strong", "", title || basename(path)));
    if (detail) copy.append(el("small", "", detail));
    b.append(icon("source", 16), copy, icon("external", 13));
    return b;
  }
  function activeDirty() {
    return Boolean(
      state.activeFile && state.dirtyPaths.includes(state.activeFile.path),
    );
  }
  function sourceFiles() {
    const unique = new Map();
    for (const file of [...(state.openFiles || []), state.activeFile].filter(
      Boolean,
    ))
      if (typeof file.path === "string") unique.set(file.path, file);
    return [...unique.values()];
  }
  function selectedFiles() {
    const files = sourceFiles();
    return state.context.flatMap((path) => {
      const file = files.find((item) => item.path === path);
      return file ? [file] : [];
    });
  }
  function choosePrimary(file) {
    const stem = basename(file.path).replace(/\.[^.]+$/, "");
    const selectedLine = state.selection?.startLine;
    return (
      file.analysis?.symbols.find(
        (symbol) =>
          selectedLine >= symbol.line && selectedLine <= symbol.endLine,
      ) ||
      file.analysis?.symbols.find((symbol) => symbol.name === stem) ||
      file.analysis?.symbols.find(
        (symbol) =>
          symbol.exported && ["function", "class"].includes(symbol.kind),
      )
    );
  }
  function header() {
    const head = el("header", "workspace-header");
    const project = button("", () => action("foundation.openProject"), "workspace-project");
    project.setAttribute("aria-label", `Open project folder · ${state.project?.name || "Foundation"}`);
    project.title = state.project?.name || "Foundation";
    project.append(el("span", "foundation-mark", "F"), el("strong", "project-name", state.project?.name || "Foundation"));
    const tabs = el("nav", "activity-tabs");
    tabs.setAttribute("aria-label", "Foundation activity");
    for (const [name, glyph] of [["Understand", "graph"], ["Refine", "inspect"], ["Review", "review"], ["Assistant", "spark"]]) {
      const b = button(name, () => setMode(name), state.mode === name ? "activity selected" : "activity", glyph);
      b.setAttribute("aria-pressed", String(state.mode === name));
      b.setAttribute("aria-label", name); b.title = name; b.dataset.mode = name;
      tabs.append(b);
    }
    const tools = el("div", "header-tools");
    const build = button("", () => state.activeFile && navigate(state.activeFile.path, state.focus?.line || 1), "icon-button", "code");
    build.setAttribute("aria-label", "Open editor"); build.title = "Open selected source beside canvas"; build.disabled = !state.activeFile;
    const menu = el("details", "workspace-menu");
    const trigger = el("summary", "icon-button"); trigger.setAttribute("aria-label", "Workspace tools"); trigger.title = "Workspace tools"; trigger.append(icon("folder"));
    const options = el("div", "workspace-menu-items");
    for (const [label, glyph, id] of [["Focus / restore workspace", "inspect", "foundation.focusWorkspace"], ["Open folder", "folder", "foundation.openProject"], ["Search source", "search", "foundation.openSearch"], ["Open terminal", "terminal", "foundation.openTerminal"], ["Refresh source", "refresh", "foundation.refresh"]]) {
      options.append(button(label, () => { menu.open = false; action(id); }, "workspace-menu-item", glyph));
    }
    options.append(button("Reset layout", () => { menu.open = false; saveInspectorWidth(320); state.inspectorOpen = false; applyStudioLayout(); }, "workspace-menu-item", "refresh"));
    menu.addEventListener("keydown", event => { if(event.key === "Escape") { menu.open = false; trigger.focus(); } });
    menu.append(trigger, options); tools.append(build, menu); head.append(project, tabs, tools);
    const focus = el("div", "workspace-focus"); focus.setAttribute("aria-label", "Workspace selection");
    const selected = state.focus;
    if (state.activeFile) {
      const link = button("", () => navigate(state.activeFile.path, selected?.line || 1), "selection-source");
      link.title = state.activeFile.path;
      link.append(icon(selected?.origin === "preview" ? "inspect" : "source"), el("strong", "", selected?.label || choosePrimary(state.activeFile)?.name || basename(state.activeFile.path)), el("span", "selection-path", state.activeFile.path));
      focus.append(link, el("code", "selection-revision", state.activeFile.revision.slice(0,7)));
      if (activeDirty()) focus.append(el("span", "selection-state", "Unsaved draft"));
      else if (selected?.stale) focus.append(el("span", "selection-state warning", "Preview stale"));
      else focus.append(el("span", "selection-state", selected?.origin === "preview" ? "From canvas" : "Saved source"));
    } else focus.append(el("span", "quiet", "Select source or an element in the canvas"));
    return [head, focus];
  }
  function emptyState() {
    const wrap = el("div", "empty-state");
    const glyph = el("div", "empty-glyph");
    glyph.append(icon(state.trusted ? "source" : "shield", 30));
    wrap.append(glyph);
    if (!state.connected) {
      wrap.append(
        el("h1", "", "Connecting to the editor"),
        el(
          "p",
          "",
          "Foundation is connecting the native workspace to its local source services.",
        ),
      );
      return wrap;
    }
    if (!state.trusted) {
      wrap.append(
        el("h1", "", "Start with a trusted workspace"),
        el(
          "p",
          "",
          "Foundation’s source services become available after you trust this folder in the editor. Standard editing remains available.",
        ),
      );
      wrap.append(
        button(
          "Manage workspace trust",
          () => action("foundation.manageTrust"),
          "button primary",
          "shield",
        ),
      );
      return wrap;
    }
    if (!state.project) {
      wrap.append(
        el("h1", "", "Software, with the whole picture."),
        el(
          "p",
          "",
          "Open a project folder to connect its files, relationships, and design decisions. Your editor, terminal, and Git tools are already here.",
        ),
      );
      wrap.append(
        button(
          "Open a project",
          () => action("foundation.openProject"),
          "button primary",
          "folder",
        ),
      );
      return wrap;
    }
    wrap.append(
      el("h1", "", "Bring a file into focus"),
      el(
        "p",
        "",
        "Select a source file in the editor. Foundation follows that selection and reveals the relationships around it.",
      ),
    );
    wrap.append(
      button(
        "Find a file",
        () => action("foundation.build"),
        "button primary",
        "source",
      ),
    );
    const files = state.project.files?.slice(0, 6) || [];
    if (files.length) {
      const list = el("div", "empty-files");
      list.append(el("span", "quiet", "Or start with a project file"));
      for (const file of files)
        list.append(
          fileLink(file.path, 1, basename(file.path), pathParent(file.path)),
        );
      wrap.append(list);
    }
    return wrap;
  }
  function sourceHeading(file, title, subtitle) {
    const h = el("div", "source-heading");
    const copy = el("div");
    const label = el("div", "eyebrow");
    label.append(icon("source", 14), el("span", "", "Selected source"));
    copy.append(
      label,
      el("h1", "", title),
      el("p", "source-path", subtitle || file.path),
    );
    const right = el("div", "source-heading-meta");
    right.append(badge(), el("code", "revision", file.revision.slice(0, 7)));
    if (state.selection?.startLine)
      right.append(
        el(
          "span",
          "revision",
          state.selection.startLine === state.selection.endLine
            ? `Line ${state.selection.startLine}`
            : `Lines ${state.selection.startLine}–${state.selection.endLine}`,
        ),
      );
    h.append(copy, right);
    return h;
  }
  function understand() {
    const file = state.activeFile;
    const analysis = file.analysis || {
      symbols: [],
      imports: [],
      consumers: [],
      requests: [],
      unsupported: true,
    };
    const primary = choosePrimary(file);
    const wrap = el("div", "understand-page");
    wrap.append(sourceHeading(file, primary?.name || basename(file.path)));
    if (activeDirty())
      wrap.append(
        note(
          "The editor has unsaved changes. Relationships below describe the saved revision. Save the document to refresh this context.",
        ),
      );
    if (analysis.unsupported)
      wrap.append(
        note(
          "Detailed relationships are available for supported JavaScript and TypeScript source. Other files remain fully editable in the native editor.",
        ),
      );
    const relationHead = sectionHeading("A focused view of the system");
    relationHead.append(el("span", "quiet", "Direct relationships"));
    wrap.append(relationHead);
    const graph = el("div", "relationship-graph");
    const left = el("section", "relationship-column");
    left.append(sectionHeading("Depends on", analysis.imports.length));
    if (!analysis.imports.length)
      left.append(el("p", "empty-copy", "No static imports found."));
    for (const item of analysis.imports.slice(0, 30))
      left.append(
        fileLink(
          item.resolvedPath || file.path,
          item.resolvedPath ? 1 : item.line,
          item.resolvedPath ? basename(item.resolvedPath) : item.specifier,
          item.resolvedPath ? "Local source" : "Package or unresolved",
        ),
      );
    const center = el("div", "relationship-center");
    const node = button(
      "",
      () => navigate(file.path, primary?.line || 1),
      "selected-entity",
    );
    node.append(
      icon("graph", 28),
      el("strong", "", primary?.name || basename(file.path)),
      el("span", "", primary?.kind || file.language),
      el("small", "", "Open in editor ↗"),
    );
    center.append(
      el("span", "connection-line"),
      node,
      el("span", "connection-line"),
    );
    const right = el("section", "relationship-column");
    right.append(sectionHeading("Used by", analysis.consumers.length));
    if (!analysis.consumers.length)
      right.append(
        el(
          "p",
          "empty-copy",
          "No direct consumers found in the current index.",
        ),
      );
    for (const item of analysis.consumers.slice(0, 30))
      right.append(
        fileLink(
          item.path,
          item.line,
          basename(item.path),
          pathParent(item.path),
        ),
      );
    graph.append(left, center, right);
    wrap.append(graph);
    const lower = el("div", "understand-lower");
    const symbols = el("section", "surface");
    symbols.append(sectionHeading("Source outline", analysis.symbols.length));
    if (!analysis.symbols.length)
      symbols.append(
        el("p", "empty-copy", "No top-level declarations in this source."),
      );
    for (const symbol of analysis.symbols.slice(0, 30)) {
      const b = button(
        "",
        () => navigate(file.path, symbol.line),
        "symbol-row",
      );
      b.append(
        el("span", "symbol-kind", symbol.kind),
        el("strong", "", symbol.name),
        el("small", "", symbol.exported ? "exported" : ""),
        el("code", "", symbol.line),
      );
      symbols.append(b);
    }
    const behavior = el("section", "surface behavior");
    behavior.append(
      sectionHeading("Behavior references", analysis.requests.length),
    );
    if (analysis.requests.length)
      for (const request of analysis.requests) {
        const b = button(
          "",
          () => navigate(file.path, request.line),
          "request-row",
        );
        b.append(
          el("span", "method", request.method),
          el("code", "", request.url),
          icon("external", 13),
        );
        behavior.append(b);
      }
    else
      behavior.append(
        el(
          "p",
          "empty-copy",
          "No fetch declarations were found in this file. Follow an import or consumer to explore further.",
        ),
      );
    behavior.append(
      el(
        "p",
        "boundary-copy",
        "Source describes possible behavior. Actual requests, server activity, and test outcomes require separate observation.",
      ),
    );
    behavior.append(
      button(
        "Ask about this source",
        () => {
          state.context = [file.path];
          state.contextInitialized = true;
          setMode("Assistant");
        },
        "text-button",
        "spark",
      ),
    );
    lower.append(symbols, behavior);
    wrap.append(lower);
    const excerpt = el("details", "source-details");
    excerpt.append(el("summary", "", "Inspect the saved source"));
    const code = el("pre", "source-code");
    code.textContent = file.source;
    excerpt.append(code);
    wrap.append(excerpt);
    return wrap;
  }
  function designEntries() {
    const entries = state.design?.entries || state.project?.files || [];
    return entries.map((entry) => typeof entry === "string" ? entry : entry.path)
      .filter((path) => /\.(tsx|jsx)$/.test(path));
  }
  function chosenEntry() {
    const entries = designEntries();
    return (entries.includes(state.designEntry) && state.designEntry) ||
      state.design?.entry || entries.find((path) => /(?:^|\/)App\.(tsx|jsx)$/.test(path)) || entries[0] || "";
  }
  function sendDesignSettings(force = false) {
    if (!designFrame?.contentWindow || !state.design?.session) return;
    const tokens = (state.design.tokens || []).flatMap((token) =>
      Object.hasOwn(state.tokenDrafts, token.id)
        ? [{ name: token.name, value: state.tokenDrafts[token.id], scope: token.scope }]
        : []);
    const settings = { channel: "foundation-design", session: state.design.session,
      type: "settings", theme: state.designTheme, inspect: state.designInspect && state.mode === "Refine", focusPath: state.focus?.origin === "source" ? state.focus.path : undefined, tokens };
    const signature = JSON.stringify(settings);
    if (!force && signature === designSettingsSignature) return;
    designSettingsSignature = signature;
    designFrame.contentWindow.postMessage(settings, "*");
  }
  function fitDesignCanvas() {
    const canvas = root.querySelector(".design-canvas");
    const viewport = root.querySelector(".design-viewport");
    if (!canvas || !viewport || !designFrame) return;
    const width = Number(state.designWidth);
    const css = getComputedStyle(canvas);
    const available = canvas.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    const scale = state.designFit ? Math.min(1, Math.max(0.1, available / width)) : 1;
    viewport.style.width = `${width * scale}px`;
    viewport.style.height = `${680 * scale}px`;
    designFrame.style.transform = `scale(${scale})`;
    const ruler = root.querySelector(".canvas-ruler-size");
    if (ruler) ruler.textContent = `${width} px${scale < 1 ? ` · ${Math.round(scale * 100)}% view` : ""}`;
  }
  function beginDesign() {
    const entry = chosenEntry();
    if (!entry || state.design?.status === "building") return;
    state.designSelection = null;
    state.tokenDrafts = {};
    state.tokenInputs = {};
    vscode.postMessage({ type: "designStart", entry });
  }
  function designStatus() {
    const wrap = el("div", "design-status-region");
    if (state.error) wrap.append(note(state.error, "error"));
    if (state.design?.error) wrap.append(note(state.design.error, "error"));
    if (state.skippedExperiments) wrap.append(note(`${state.skippedExperiments} token ${state.skippedExperiments === 1 ? "experiment could" : "experiments could"} not be previewed in this selector scope. The source proposal remains available for review.`, "warning"));
    if (state.design?.stale) wrap.append(note("Source changed after this preview was built. Rebuild to inspect the current saved revision.", "warning"));
    if (state.dirtyPaths.length) wrap.append(el("p", "design-guidance", "The canvas uses saved source. Unsaved editor drafts are preserved and are not included in this preview."));
    const experiments = Object.keys(state.tokenDrafts).length;
    const pendingInputs = Object.entries(state.tokenInputs).some(([id, value]) =>
      value !== (state.design?.tokens || []).find((token) => token.id === id)?.value);
    if (experiments || pendingInputs) {
      const banner = el("div", "experiment-banner");
      banner.append(icon("color", 15), el("span", "", experiments
          ? `${experiments} ${experiments === 1 ? "experiment" : "experiments"} in this canvas. Source is unchanged.`
          : "Unfinished token value. The canvas keeps the last valid value."),
        button("Reset experiments", () => { state.tokenDrafts = {}; state.tokenInputs = {}; sendDesignSettings(); render(); }, "text-button"));
      wrap.append(banner);
    }
    return wrap;
  }
  function measuredValue(styles, name) {
    if (name === "padding" && styles?.paddingTop) {
      const { paddingTop: top, paddingRight: right, paddingBottom: bottom, paddingLeft: left } = styles;
      return top === bottom && right === left ? top === right ? top : `${top} ${right}` : `${top} ${right} ${bottom} ${left}`;
    }
    return styles?.[name] ?? styles?.[name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] ?? "—";
  }
  function selectionInspector() {
    const section = el("section", "inspector-section");
    section.append(sectionHeading("Selected element"));
    const selection = state.designSelection === undefined ? state.design?.selection : state.designSelection;
    if (!selection) {
      section.append(el("p", "empty-copy", state.design?.status === "ready"
        ? state.unmappedMessage || "Turn on Inspect, then select an element in the canvas. Measured properties appear here."
        : "Start the preview to inspect an element’s source, geometry, and computed style."));
      return section;
    }
    const identity = el("div", "element-identity");
    identity.append(el("code", "", selection.tag || "element"), badge("Observed", "source"));
    section.append(identity, el("p", "element-label", String(selection.label || "Selected element").slice(0, 120)));
    if (selection.path) section.append(fileLink(selection.path, 1, basename(selection.path), "Explicit source mapping"));
    else section.append(el("p", "quiet", "No explicit source mapping for this element."));
    const rect = selection.rect || {};
    const dimensions = el("div", "element-dimensions");
    for (const [label, value] of [["Width", rect.width], ["Height", rect.height]]) {
      const cell = el("div");
      cell.append(el("span", "", label), el("strong", "", Number.isFinite(value) ? `${Math.round(value * 10) / 10} px` : "—"));
      dimensions.append(cell);
    }
    section.append(dimensions);
    const properties = el("dl", "computed-properties");
    for (const [name, label] of [["color", "Text"], ["background-color", "Fill"], ["font-size", "Type size"],
      ["font-weight", "Weight"], ["line-height", "Line height"], ["padding", "Padding"], ["gap", "Gap"], ["border-radius", "Radius"]]) {
      properties.append(el("dt", "", label), el("dd", "", measuredValue(selection.styles, name)));
    }
    section.append(properties);
    if (selection.path) section.append(button("Ask AI to refine this", () => {
      state.pendingDesignContext = selection.path;
      if (sourceFiles().some((file) => file.path === selection.path)) state.context = [selection.path];
      state.intent = "change";
      state.question = `Refine ${selection.label || selection.tag || "this element"} in ${selection.path}. Improve its visual hierarchy and interaction states while preserving its behavior.`;
      saveView();
      setMode("Assistant");
      if (!sourceFiles().some((file) => file.path === selection.path)) navigate(selection.path, 1);
    }, "button inspector-ai", "spark"));
    return section;
  }
  // Keep this browser-safe subset aligned with server/project/proposals.mjs.
  function validDesignTokenValue(value) {
    if ((typeof value !== "string" || value.length > 120 || value.includes("\0")) || !value.trim() || value !== value.trim()) return false;
    if (/^(?:#[\da-fA-F]{3,4}|#[\da-fA-F]{6}|#[\da-fA-F]{8}|(?:-?\d+(?:\.\d+)?|-?\.\d+)(?:px|rem|em|%|vh|vw|ch|ex|s|ms|deg)?|(?:transparent|currentColor|inherit|initial|unset)|(?:black|white|red|green|blue|gray|grey|yellow|orange|purple|pink|teal|navy|rebeccapurple))$/.test(value)) return true;
    const color = value.match(/^(rgb|rgba|hsl|hsla)\(([^()]*)\)$/);
    if (!color) return false;
    const numeric = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/;
    let channels, alpha;
    if (color[2].includes(",")) {
      const parts = color[2].split(",").map(part => part.trim());
      if (parts.length !== 3 && parts.length !== 4) return false;
      channels = parts.slice(0, 3);
      alpha = parts[3];
    } else {
      const parts = color[2].split("/");
      if (parts.length > 2) return false;
      channels = parts[0].trim().split(/\s+/);
      alpha = parts[1]?.trim();
    }
    if (channels.length !== 3 || channels.some(part => !numeric.test(part)) || (alpha !== undefined && !numeric.test(alpha))) return false;
    if (color[1].startsWith("hsl") && (!channels[1].endsWith("%") || !channels[2].endsWith("%") || channels[0].endsWith("%"))) return false;
    return true;
  }
  function tokenEditorKey() {
    return JSON.stringify([state.selectedToken, (state.design?.tokens || []).map((token) => [token.id, token.revision, token.value])]);
  }
  function tokenInspector() {
    renderedTokenEditorKey = tokenEditorKey();
    refreshTokenEditor = null;
    const section = el("section", "inspector-section design-token-region");
    const tokens = state.design?.tokens || [];
    section.append(sectionHeading("Design tokens", tokens.length));
    section.append(el("p", "inspector-copy", "Experiment in the canvas, then review the exact source change. Shared values affect every matching consumer."));
    if (!tokens.length) {
      section.append(el("p", "empty-copy", "CSS custom properties from the preview’s stylesheets will appear here."));
      return section;
    }
    const filter = el("input", "token-search");
    filter.type = "search";
    filter.placeholder = "Find a token…";
    filter.setAttribute("aria-label", "Find a design token");
    filter.value = state.tokenFilter;
    filter.dataset.designFocus = "filter";
    filter.addEventListener("input", () => {
      state.tokenFilter = filter.value;
      for (const row of section.querySelectorAll(".design-token")) row.hidden = !row.dataset.search.includes(filter.value.toLowerCase());
    });
    section.append(filter);
    const list = el("div", "design-token-list");
    for (const token of tokens.slice(0, 160)) {
      const row = button("", () => { state.selectedToken = token.id; render(); }, state.selectedToken === token.id ? "design-token selected" : "design-token");
      row.dataset.designFocus = `token-${token.id}`;
      row.dataset.search = `${token.name} ${token.scope} ${token.path}`.toLowerCase();
      row.hidden = !row.dataset.search.includes(state.tokenFilter.toLowerCase());
      const value = state.tokenDrafts[token.id] ?? token.value;
      const swatch = el("span", "token-swatch");
      if (/^#[\da-f]{3,8}$/i.test(value)) swatch.style.backgroundColor = value;
      else swatch.append(icon("code", 13));
      const copy = el("span", "token-label");
      copy.append(el("strong", "", token.name), el("small", "", token.scope || "Declared scope"));
      row.append(swatch, copy, el("code", "token-current", value));
      row.setAttribute("aria-pressed", String(state.selectedToken === token.id));
      list.append(row);
    }
    section.append(list);
    const selected = tokens.find((token) => token.id === state.selectedToken);
    if (selected) {
      const editor = el("div", "token-editor");
      editor.append(el("strong", "", selected.name), el("code", "token-scope", selected.scope || "Declared scope"));
      const label = el("label", "token-value-label", "Experiment value");
      const input = el("input", "token-value-input");
      input.type = "text";
      input.maxLength = 120;
      // Keep incomplete typing separate from the last valid canvas experiment.
      // Runtime measurements and host refreshes must never replace the raw draft.
      input.value = state.tokenInputs[selected.id] ?? state.tokenDrafts[selected.id] ?? selected.value;
      input.dataset.designFocus = "value";
      input.setAttribute("aria-label", `Experiment value for ${selected.name}`);
      const feedback = el("p", "token-value-feedback");
      const propose = button("Review token change", () => vscode.postMessage({ type: "designPropose", path: selected.path,
        revision: selected.revision, name: selected.name, occurrence: selected.occurrence, value: input.value.trim() }), "button primary");
      const validValue = validDesignTokenValue;
      const update = () => {
        state.tokenInputs[selected.id] = input.value;
        const value = input.value.trim();
        const valid = validValue(value);
        const changed = value !== selected.value;
        propose.disabled = !valid || !changed || state.dirtyPaths.includes(selected.path) || Boolean(state.design?.stale);
        input.setAttribute("aria-invalid", String(!valid));
        feedback.textContent = !valid ? "Use a color, number, or length. References, rules, and URLs cannot be previewed." : changed ? "Experiment only. Source is unchanged." : "Matches the saved source.";
        if (valid) {
          if (changed) state.tokenDrafts[selected.id] = value;
          else delete state.tokenDrafts[selected.id];
          const row = root.querySelector(`[data-design-focus="${CSS.escape(`token-${selected.id}`)}"]`);
          const current = row?.querySelector(".token-current");
          if (current) current.textContent = value;
          const swatch = row?.querySelector(".token-swatch");
          if (swatch && CSS.supports("color", value)) swatch.style.backgroundColor = value;
          sendDesignSettings();
        }
        const status = root.querySelector(".design-status-region");
        status?.replaceWith(designStatus());
      };
      refreshTokenEditor = update;
      input.addEventListener("input", update);
      label.append(input);
      editor.append(label, feedback, propose, fileLink(selected.path, selected.line, basename(selected.path), `Line ${selected.line}`));
      section.append(editor);
      update();
    }
    return section;
  }
  function designInspector() {
    const aside = el("aside", "design-inspector");
    aside.setAttribute("aria-label", "Design inspector");
    aside.id = "design-inspector";
    aside.addEventListener("keydown", event => { if(event.key === "Escape" && root.querySelector(".studio-layout")?.classList.contains("is-compact")) { event.preventDefault(); state.inspectorOpen = false; root.querySelector(".inspector-toggle")?.focus(); applyStudioLayout(); } });
    const top = el("div", "inspector-title");
    top.append(el("strong", "", "Inspector"), button("Back to canvas", () => { state.inspectorOpen = false; root.querySelector(".inspector-toggle")?.focus(); applyStudioLayout(); }, "text-button inspector-back", "arrow"));
    aside.append(top, selectionInspector(), tokenInspector());
    return aside;
  }
  function updateDesignView() {
    const focus = rememberFocus();
    const inspector = root.querySelector(".design-inspector");
    const top = inspector?.scrollTop || 0;
    // Measurement events can arrive after every valid keystroke. Keep the live
    // token editor mounted, including its selection and composition state.
    if (focus.design === "value" && renderedTokenEditorKey === tokenEditorKey()) {
      inspector?.querySelector(".inspector-section")?.replaceWith(selectionInspector());
      refreshTokenEditor?.();
    } else inspector?.replaceWith(designInspector());
    const next = root.querySelector(".design-inspector");
    if (next) next.scrollTop = top;
    root.querySelector(".design-status-region")?.replaceWith(designStatus());
    const start = root.querySelector(".design-start");
    if (start) {
      start.disabled = !chosenEntry() || state.design?.status === "building";
      start.textContent = state.design?.status === "building" ? "Building preview…" : state.design?.html ? "Rebuild preview" : "Start preview";
    }
    const status = root.querySelector(".preview-status-label");
    if (status) status.textContent = state.design?.status === "building" ? "Building saved source" : state.design?.observed ? "Preview connected" : state.design?.status === "ready" ? "Waiting for canvas" : "Sandbox preview";
    const source = root.querySelector(".footer-source");
    if (source && state.activeFile) source.textContent = `${basename(state.activeFile.path)} · ${state.activeFile.revision.slice(0, 7)}`;
    applyStudioLayout();
    sendDesignSettings();
    restoreFocus(focus);
  }
  function refine() {
    const wrap = el("div", "refine-page design-studio");
    renderedDesignSession = state.design?.session || null;
    renderedDesignProject = state.project?.id;

    const entrybar = el("div", "design-entrybar");
    const entryLabel = el("label", "design-entry-label", "React entry");
    const select = el("select", "design-entry");
    select.setAttribute("aria-label", "Preview entry component");
    for (const path of designEntries()) {
      const option = el("option", "", path);
      option.value = path;
      option.selected = path === chosenEntry();
      select.append(option);
    }
    if (!select.options.length) select.append(el("option", "", "No React component found"));
    select.disabled = state.design?.status === "building";
    select.addEventListener("change", () => { state.designEntry = select.value; });
    entryLabel.append(select);
    const start = button(state.design?.status === "building" ? "Building preview…" : state.design?.html ? "Rebuild preview" : "Start preview", beginDesign, "button primary design-start", "refresh");
    start.disabled = !chosenEntry() || state.design?.status === "building";
    const inspectorToggle = button("Inspector", () => { state.inspectorOpen = !state.inspectorOpen; applyStudioLayout(); if(state.inspectorOpen) root.querySelector(".inspector-back")?.focus(); }, "button inspector-toggle", "inspect");
    inspectorToggle.setAttribute("aria-controls", "design-inspector");
    inspectorToggle.setAttribute("aria-expanded", String(state.inspectorOpen));
    entrybar.append(entryLabel, start, inspectorToggle);
    wrap.append(entrybar, designStatus());
    const studio = el("div", "studio-layout");
    const stage = el("section", "design-stage");
    stage.setAttribute("aria-label", "Design canvas");
    const toolbar = el("div", "canvas-toolbar");
    const size = el("select", "canvas-size");
    size.setAttribute("aria-label", "Preview viewport width");
    for (const [value, label] of [["960", "Desktop · 960"], ["768", "Tablet · 768"], ["390", "Phone · 390"]]) {
      const option = el("option", "", label); option.value = value; option.selected = value === state.designWidth; size.append(option);
    }
    size.addEventListener("change", () => {
      state.designWidth = size.value; saveView();
      const viewport = root.querySelector(".design-viewport");
      if (viewport) viewport.style.width = `${Number(state.designWidth)}px`;
      if (designFrame) designFrame.width = state.designWidth;
      fitDesignCanvas();
    });
    const theme = el("select", "canvas-theme"); theme.setAttribute("aria-label", "Preview color theme");
    for (const value of ["light", "dark"]) { const option = el("option", "", value === "light" ? "Light" : "Dark"); option.value = value; option.selected = value === state.designTheme; theme.append(option); }
    theme.addEventListener("change", () => { state.designTheme = theme.value; saveView(); sendDesignSettings(); });
    const inspect = button("Inspect", () => {
      state.designInspect = !state.designInspect; inspect.setAttribute("aria-pressed", String(state.designInspect)); sendDesignSettings();
    }, "button small inspect-toggle", "inspect");
    inspect.setAttribute("aria-pressed", String(state.designInspect));
    const fit = button("Fit", () => { state.designFit = !state.designFit; fit.setAttribute("aria-pressed", String(state.designFit)); fitDesignCanvas(); }, "button small canvas-fit");
    fit.setAttribute("aria-pressed", String(state.designFit));
    fit.setAttribute("aria-label", "Fit preview to canvas");
    toolbar.append(size, theme, fit, inspect);
    stage.append(toolbar);
    const canvas = el("div", "design-canvas");
    if (state.design?.html) {
      // A newly mounted frame has no selected element yet. Measurements from the
      // prior frame must not appear current after switching activities.
      state.designSelection = null;
      state.unmappedMessage = "";
      const viewport = el("div", "design-viewport"); viewport.style.width = `${Number(state.designWidth)}px`;
      designFrame = el("iframe"); designFrame.title = "Live design preview";
      designFrame.setAttribute("sandbox", "allow-scripts allow-forms"); designFrame.setAttribute("referrerpolicy", "no-referrer");
      designFrame.width = state.designWidth; designFrame.height = "680";
      designFrame.addEventListener("load", () => { sendDesignSettings(true); fitDesignCanvas(); });
      designFrame.srcdoc = state.design.html;
      viewport.append(designFrame); canvas.append(viewport);
    } else {
      designFrame = null;
      const empty = el("div", "canvas-empty");
      empty.append(icon("inspect", 34), el("h2", "", state.design?.status === "building" ? "Building the canvas" : "Your interface belongs here"),
        el("p", "", "Choose a React entry and start a preview from saved source. Inspect an element, try a token, then review the change."),
        el("span", "canvas-boundary", "React + local modules + CSS. Unsupported dependencies stay visible."));
      canvas.append(empty);
    }
    stage.append(canvas);
    const ruler = el("div", "canvas-ruler");
    ruler.append(el("span", "preview-status-label", state.design?.observed ? "Preview connected" : "Sandbox preview"),
      el("span", "canvas-ruler-size", `${state.designWidth} px`), el("span", "", "Network off"));
    stage.append(ruler, el("p", "canvas-caption", "Viewport size stays fixed. Fit scales the view; turn it off to inspect at 100%."));
    studio.append(stage, resizeSeparator(), designInspector()); wrap.append(studio);
    designResizeObserver?.disconnect();
    designResizeObserver = new ResizeObserver(() => { if (state.mode === "Refine") fitDesignCanvas(); });
    designResizeObserver.observe(canvas);
    return wrap;
  }
  function desiredInspectorWidth() { return state.layouts[state.project?.id || "local"]?.inspectorWidth || 320; }
  function applyStudioLayout() {
    const studio = root.querySelector(".studio-layout"); if (!studio || state.mode !== "Refine") return;
    const model = workspace.resolveLayout(studio.clientWidth, inspectorDrag?.width ?? desiredInspectorWidth());
    const inside = studio.querySelector(".design-inspector")?.contains(document.activeElement);
    if (model.compact && inside) state.inspectorOpen = true;
    studio.classList.toggle("is-compact", model.compact);
    studio.style.setProperty("--inspector-width", `${model.width}px`);
    const inspector = studio.querySelector(".design-inspector"), stage = studio.querySelector(".design-stage"), separator = studio.querySelector(".resize-separator");
    const showing = !model.compact || state.inspectorOpen;
    inspector.hidden = !showing;
    stage.hidden = model.compact && state.inspectorOpen;
    separator.hidden = model.compact;
    separator.setAttribute("aria-valuenow", String(model.width)); separator.setAttribute("aria-valuemax", String(model.max));
    separator.setAttribute("aria-valuetext", `${model.width} pixels`);
    const toggle = root.querySelector(".inspector-toggle"); if (toggle) { toggle.hidden = !model.compact; toggle.setAttribute("aria-expanded", String(state.inspectorOpen)); }
    if (!stage.hidden) fitDesignCanvas();
  }
  function saveInspectorWidth(width) {
    state.layouts[state.project?.id || "local"] = {inspectorWidth: workspace.snapWidth(width)};
    state.layouts = workspace.normalizeLayouts(state.layouts); saveView();
    if (state.project) vscode.postMessage({ type:"workspaceLayout", projectId:state.project.id, width:workspace.snapWidth(width) });
  }
  function resizeSeparator() {
    const grip = el("div", "resize-separator"); grip.tabIndex = 0; grip.dataset.workspaceFocus = "inspector-resize";
    grip.setAttribute("role", "separator"); grip.setAttribute("aria-label", "Resize inspector");
    grip.setAttribute("aria-orientation", "vertical"); grip.setAttribute("aria-controls", "design-inspector"); grip.setAttribute("aria-valuemin", "280");
    grip.title = "Drag to resize · Arrow keys adjust 4 px · Shift adjusts 32 px · Double-click to reset";
    grip.addEventListener("keydown", event => {
      if (event.key === "Escape" && inspectorDrag) { inspectorDrag = null; applyStudioLayout(); return; }
      const next = workspace.keyboardWidth(Number(grip.getAttribute("aria-valuenow")), event.key, event.shiftKey, Number(grip.getAttribute("aria-valuemax")));
      if(next === null) return; event.preventDefault(); saveInspectorWidth(next); applyStudioLayout();
    });
    grip.addEventListener("dblclick", () => { saveInspectorWidth(320); applyStudioLayout(); });
    grip.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault(); grip.focus(); grip.setPointerCapture(event.pointerId);
      inspectorDrag = {x:event.clientX, start:Number(grip.getAttribute("aria-valuenow")), width:Number(grip.getAttribute("aria-valuenow"))};
    });
    grip.addEventListener("pointermove", event => {
      if(!inspectorDrag) return;
      inspectorDrag.width = workspace.snapWidth(inspectorDrag.start + inspectorDrag.x - event.clientX, 280, Number(grip.getAttribute("aria-valuemax")));
      applyStudioLayout();
    });
    grip.addEventListener("pointerup", event => { if(inspectorDrag) saveInspectorWidth(inspectorDrag.width); inspectorDrag = null; if(grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId); applyStudioLayout(); });
    grip.addEventListener("pointercancel", () => { inspectorDrag = null; applyStudioLayout(); });
    grip.addEventListener("lostpointercapture", () => { inspectorDrag = null; applyStudioLayout(); });
    return grip;
  }
  function proposalReview(proposal, compact = false) {
    const section = el("section", compact ? "proposal-card compact" : "proposal-card");
    const heading = el("div", "proposal-heading");
    const copy = el("div");
    copy.append(el("span", "proposal-origin", proposal.origin === "design" ? "Design token change" : "AI change proposal"), el("h2", "", proposal.title || "Proposed source change"));
    heading.append(copy, badge(proposal.status === "proposed" ? "Ready to review" : proposal.status || "Proposed", proposal.status === "stale" ? "unknown" : "source"));
    section.append(heading, el("p", "proposal-summary", proposal.summary || "Review the proposed change before it touches source."));
    section.append(el("div", "proposal-scope", `1 file · ${proposal.path} · baseline ${String(proposal.baseRevision || "").slice(0, 7)}`));
    const artifactView = artifacts.proposalState(proposal, sourceFiles(), state.dirtyPaths, state.running, state.proposal?.id || null);
    const dirty = state.dirtyPaths.includes(proposal.path);
    const dirtyContext = proposal.status === "proposed" && (proposal.context || []).some((file) => state.dirtyPaths.includes(file.path));
    const current = sourceFiles().find((file) => file.path === proposal.path);
    const stale = proposal.status === "stale" || (proposal.status === "proposed" && current && current.revision !== proposal.baseRevision);
    if (dirty || dirtyContext || stale || proposal.reason) section.append(note(proposal.reason || (dirtyContext ? "A context file has an unsaved draft. It remains untouched; resolve it in the native editor before applying." : dirty ? "This file has an unsaved draft. It remains untouched; resolve it in the native editor before applying or undoing." : "Source changed after this proposal. Generate a fresh proposal before applying."), "warning"));
    const actions = el("div", "proposal-actions");
    const command = (type) => vscode.postMessage({ type, id: proposal.id });
    actions.append(button("Open native diff", () => command("proposalDiff"), "button", "review"));
    if (proposal.status === "proposed") {
      const apply = button("Apply to source", () => command("proposalApply"), "button primary", "check");
      apply.disabled = !artifactView.canApply;
      actions.append(apply, button("Discard", () => command("proposalDiscard"), "text-button"));
    } else if (proposal.status === "applied") {
      const undo = button("Undo Foundation change", () => command("proposalUndo"), "button");
      undo.disabled = !artifactView.canUndo;
      actions.append(undo, button("Inspect result", () => { closeArtifact(); state.designEntry = state.design?.entry || chosenEntry(); setMode("Refine"); beginDesign(); }, "button", "inspect"),
        button("Dismiss checkpoint", () => command("proposalDiscard"), "text-button"));
      section.append(el("p", "checkpoint-note", "Dismissing this checkpoint leaves the applied source unchanged."));
    } else if (proposal.status === "stale") actions.append(button("Discard", () => command("proposalDiscard"), "text-button"));
    for (const control of actions.querySelectorAll("button")) control.dataset.artifactFocus = `proposal/${proposal.id}:${control.textContent}`;
    section.append(actions);
    if (!compact) {
      const details = el("details", "proposal-diff");
      const diffKey = `proposal/${proposal.id}:diff`;
      details.open = disclosureState.get(diffKey) === true;
      details.addEventListener("toggle", () => disclosureState.set(diffKey, details.open));
      const summary = el("summary", "", "Compare proposed source");
      summary.dataset.artifactFocus = diffKey;
      details.append(summary);
      const split = el("div", "proposal-diff-columns");
      for (const [label, source] of [["Before", proposal.before], ["After", proposal.after]]) {
        const column = el("div"); column.append(el("h3", "", label), el("pre", "", source || "")); split.append(column);
      }
      details.append(split); section.append(details);
      if (proposal.verification?.length) {
        const checks = el("div", "proposal-checklist"); checks.append(el("h3", "", "Suggested verification"));
        const list = el("ul");
        for (const item of proposal.verification.slice(0, 12)) list.append(el("li", "", item));
        checks.append(list, el("p", "quiet", "Suggestions have not been run.")); section.append(checks);
      }
    }
    return section;
  }
  function review() {
    const wrap = el("div", "review-page");
    const heading = el("div", "page-heading");
    heading.append(
      el("div", "eyebrow", "Source and evidence"),
      el("h1", "", "Review the work"),
      el(
        "p",
        "",
        "Use the native editor’s diff and source control alongside the evidence for your changes.",
      ),
    );
    wrap.append(heading);
    if (state.proposal) wrap.append(proposalReview(state.proposal));
    const entry = el("section", "review-entry");
    const copy = el("div");
    copy.append(
      el("h2", "", "Working tree"),
      el(
        "p",
        "",
        "Git is the source of truth for committed and uncommitted changes. Open Source Control to review individual files, stage changes, and inspect history.",
      ),
    );
    entry.append(
      icon("branch", 25),
      copy,
      button(
        "Open Source Control",
        () => action("foundation.openGit"),
        "button primary",
        "branch",
      ),
    );
    wrap.append(entry);
    if (state.changes.length) {
      const list = el("section", "surface");
      list.append(sectionHeading("Source checkpoints", state.changes.length));
      for (const change of state.changes) {
        const b = button(
          "",
          () => vscode.postMessage({ type: "reviewFile", path: change.path }),
          "change-row",
        );
        b.append(
          icon("source", 16),
          el("span", "", change.path),
          badge(
            change.conflict ? "Changed on disk" : "Saved change",
            change.conflict ? "unknown" : "source",
          ),
          icon("external", 13),
        );
        list.append(b);
      }
      wrap.append(list);
    } else if (!state.proposal) {
      const clean = el("div", "review-empty");
      clean.append(
        icon("review", 28),
        el("h2", "", "Start with the diff"),
        el(
          "p",
          "",
          "There are no Foundation source checkpoints in this session. Native Git review remains available for your project’s changes.",
        ),
      );
      wrap.append(clean);
    }
    const checks = el("section", "surface verification");
    checks.append(sectionHeading("Verification is separate"));
    for (const [name, detail] of [
      ["Preview compilation", "Transpiles the supported preview modules. Run the full project build separately."],
      ["Interaction", "Exercise the relevant behavior in a running target."],
      ["Visual review", "Inspect the intended states, themes, and sizes."],
    ]) {
      const row = el("div", "verification-row");
      const copy = el("div");
      copy.append(el("strong", "", name), el("p", "", detail));
      const compilation = name === "Preview compilation" && (state.proposal ? artifacts.verification(state.proposal, state.design).compilation : !state.design?.stale && state.design?.compilation);
      row.append(el("span", "verification-dot"), copy,
        badge(compilation === "passed" ? "Preview compiled" : compilation === "failed" ? "Preview failed" : "Not run", compilation === "passed" ? "source" : "unknown"));
      checks.append(row);
    }
    if (state.design?.observed && !state.design?.stale) checks.append(el("p", "boundary-copy", "The sandbox preview connected to this source revision. A render does not establish successful interaction or visual acceptance."));
    wrap.append(checks);
    const actions = el("div", "page-actions");
    actions.append(
      button(
        "Open terminal",
        () => action("foundation.openTerminal"),
        "button",
        "terminal",
      ),
      button(
        "Run and Debug",
        () => action("foundation.openDebug"),
        "button",
        "debug",
      ),
    );
    wrap.append(actions);
    return wrap;
  }
  function contextPicker() {
    const files = sourceFiles();
    const picked = selectedFiles();
    const total = picked.reduce((n, file) => n + byteLength(file.source), 0);
    const section = el("section", "shared-context");
    const heading = sectionHeading(
      "Shared context",
      `${picked.length} ${picked.length === 1 ? "file" : "files"}`,
    );
    heading.append(el("span", "quiet", formatBytes(total)));
    section.append(heading);
    if (!files.length)
      section.append(
        el(
          "p",
          "empty-copy",
          "Open a source file in the editor to add context.",
        ),
      );
    for (const file of files) {
      const dirty = state.dirtyPaths.includes(file.path);
      const label = el("label", "context-choice");
      const input = el("input");
      input.type = "checkbox";
      input.dataset.contextPath = file.path;
      input.checked = state.context.includes(file.path);
      input.disabled = state.running;
      input.addEventListener("change", () => {
        state.context = input.checked
          ? [...state.context.filter((path) => path !== file.path), file.path]
          : state.context.filter((path) => path !== file.path);
        renderAssistant();
      });
      const copy = el("span");
      copy.append(
        el("strong", "", basename(file.path)),
        el("small", "", file.path),
      );
      label.append(
        input,
        icon("source", 14),
        copy,
        el(
          "span",
          dirty ? "dirty-note" : "context-revision",
          dirty ? "Unsaved" : file.revision.slice(0, 7),
        ),
      );
      section.append(label);
    }
    const inspect = el("details", "context-inspect");
    inspect.open = state.sourceExpanded;
    inspect.addEventListener("toggle", () => {
      state.sourceExpanded = inspect.open;
    });
    inspect.append(el("summary", "", "Inspect exactly what will be shared"));
    for (const file of picked) {
      const chunk = el("div", "context-source");
      chunk.append(
        el(
          "div",
          "context-source-path",
          `${file.path} · ${file.revision.slice(0, 7)}`,
        ),
      );
      const pre = el("pre");
      pre.textContent = file.source;
      chunk.append(pre);
      inspect.append(chunk);
    }
    section.append(inspect);
    const warning = picked.some((file) => state.dirtyPaths.includes(file.path))
      ? "Save the selected files before asking. Unsaved editor buffers are never silently shared."
      : picked.length > 8
        ? "Select up to eight files."
        : total > 65536
          ? "Selected source exceeds 64 KiB. Remove a file from context."
          : "Only these saved files and your question are shared. Previous questions are not added automatically.";
    section.append(
      el(
        "p",
        picked.some((file) => state.dirtyPaths.includes(file.path)) ||
          picked.length > 8 ||
          total > 65536
          ? "context-guidance warning"
          : "context-guidance",
        warning,
      ),
    );
    return section;
  }
  function answerText(turn) {
    const text = el("div", "answer-text");
    const pattern = /\[(S\d+):(\d+)\]/g;
    let offset = 0;
    for (const match of turn.answer.matchAll(pattern)) {
      text.append(
        document.createTextNode(turn.answer.slice(offset, match.index)),
      );
      const source = turn.context.find((item) => item.id === match[1]);
      const line = Number(match[2]);
      if (source && line >= 1 && line <= source.lines) {
        const citation = button(
          `${basename(source.path)}:${line}`,
          () => navigate(source.path, line),
          "citation",
        );
        citation.dataset.artifactFocus = `request/${turn.requestId}:citation:${match.index}`;
        citation.title = `${source.path}:${line} · answer source ${source.revision.slice(0, 7)}; opens current source`;
        text.append(citation);
      } else text.append(document.createTextNode(match[0]));
      offset = match.index + match[0].length;
    }
    text.append(document.createTextNode(turn.answer.slice(offset)));
    return text;
  }
  const artifacts = window.FoundationArtifacts;
  const artifactCollapsed = new Map();
  const disclosureState = new Map();
  let artifactDialog = null;
  let expandedArtifact = null;
  let artifactReturnFocus = null;
  function artifactButton(label, handler, key, primary = false, glyph) {
    const control = button(label, handler, primary ? "button primary" : "button", glyph);
    control.dataset.artifactFocus = key;
    return control;
  }
  function artifactCard({id, kind, title, status, scope, provenance, freshness, body, actions = [], warnings = [], expanded = false, open}) {
    const card = el("section", "ai-work-artifact");
    card.dataset.artifactId = id;
    card.dataset.artifactKind = kind;
    card.setAttribute("aria-label", `${kind}: ${title}`);
    const heading = el("header", "artifact-heading");
    const copy = el("div", "artifact-heading-copy");
    copy.append(el("span", "artifact-kind", kind), el("h2", "", title));
    if (expanded) heading.append(copy);
    else {
      const toggle = artifactButton("", () => {
        artifactCollapsed.set(id, !artifactCollapsed.get(id));
        renderAssistant();
      }, `${id}:toggle`);
      toggle.className = "artifact-toggle";
      toggle.append(icon(kind === "Code changes" ? "review" : kind === "Verification" ? "shield" : "source"), copy, icon("chevron", 12));
      toggle.setAttribute("aria-label", `${artifactCollapsed.get(id) ? "Expand" : "Collapse"} ${kind}`);
      toggle.setAttribute("aria-expanded", String(!artifactCollapsed.get(id)));
      heading.append(toggle);
      if (open) {
        const expand = artifactButton("", open, `${id}:open`, false, "external");
        expand.className = "icon-button artifact-expand";
        expand.setAttribute("aria-label", `Open ${kind} details`);
        heading.append(expand);
      }
    }
    const meta = el("div", "artifact-metadata");
    meta.append(el("span", "artifact-status", status), el("span", "artifact-scope", scope));
    const evidence = el("div", "artifact-evidence");
    evidence.append(el("span", "", provenance));
    if (freshness) evidence.append(el("span", freshness === "Stale" ? "warning" : "", freshness));
    card.append(heading, meta, evidence);
    for (const warning of warnings.filter(Boolean)) card.append(note(warning, "warning"));
    const content = el("div", "artifact-content");
    content.hidden = !expanded && artifactCollapsed.get(id) === true;
    content.append(body);
    card.append(content);
    if (actions.length) { const footer = el("footer", "artifact-actions"); footer.append(...actions); card.append(footer); }
    if (expanded) card.append(el("code", "artifact-identity", id));
    return card;
  }
  function sourceSnapshots(context, id, open = false) {
    const details = el("details", "answer-sources");
    details.open = open || disclosureState.get(id) === true;
    details.addEventListener("toggle", () => disclosureState.set(id, details.open));
    const summary = el("summary", "", `Original source context · ${context.length} ${context.length === 1 ? "file" : "files"}`);
    summary.dataset.artifactFocus = id;
    details.append(summary);
    for (const source of context) {
      const block = el("div", "context-source");
      block.append(el("div", "context-source-path", `${source.id || "Source"} · ${source.path} · ${source.revision.slice(0, 7)}`), el("pre", "", source.source || ""));
      details.append(block);
    }
    return details;
  }
  function currentProposal(id) {
    return state.proposal?.id === id ? state.proposal : state.turns.find(turn => turn.proposal?.id === id)?.proposal;
  }
  function verificationArtifact(proposal, expanded = false) {
    const status = artifacts.verification(proposal, state.design);
    const body = el("div", "artifact-checks");
    for (const [label, outcome] of [["Preview compilation", status.compilation], ["Interaction", status.interaction], ["Visual review", status.visual]]) {
      const row = el("div", "artifact-check");
      row.append(el("span", "", label), el("strong", outcome === "passed" ? "success" : outcome === "failed" ? "warning" : "", outcome === "passed" ? "Passed" : outcome === "failed" ? "Failed" : "Not run"));
      body.append(row);
    }
    body.append(el("p", "artifact-boundary", status.detail));
    if (status.connected) body.append(el("p", "artifact-boundary", "This preview rendered. Interaction and visual acceptance remain unverified."));
    if (expanded && proposal.verification?.length) {
      body.append(el("h3", "", "Suggested checks"));
      const list = el("ul");
      for (const check of proposal.verification.slice(0, 12)) list.append(el("li", "", check));
      body.append(list, el("p", "artifact-boundary", "These suggestions have not been executed."));
    }
    const id = `proposal/${proposal.id}/verification`;
    return artifactCard({id, kind:"Verification", title:"Evidence for this revision", status:status.compilation === "not-run" ? "Not run" : "Partial coverage", scope:"3 independent checks", provenance:status.revision ? "Observed" : "No attached run", freshness:status.revision ? status.revision.slice(0, 7) : "", body, expanded,
      open:() => openArtifact({kind:"verification", proposalId:proposal.id}), actions:expanded ? [] : [artifactButton("Inspect evidence", () => openArtifact({kind:"verification", proposalId:proposal.id}), `${id}:review`)]});
  }
  function changeArtifact(proposal, expanded = false) {
    const view = artifacts.proposalState(proposal, sourceFiles(), state.dirtyPaths, state.running, state.proposal?.id || null);
    const id = `proposal/${proposal.id}`;
    const body = el("div");
    body.append(el("p", "", proposal.summary || "Review the source change and its scope."));
    const file = el("div", "artifact-file");
    file.append(icon("source"), el("code", "", proposal.path), el("span", "", "1 file")); body.append(file);
    const actions = [];
    if (expanded) {
      body.append(proposalReview(proposal, false));
      if (view.superseded) body.querySelector(".proposal-actions")?.remove();
      body.append(verificationArtifact(proposal, true));
    } else actions.push(artifactButton(view.superseded ? "Inspect previous proposal" : "Review change", () => openArtifact({kind:"changes", proposalId:proposal.id}), `${id}:review`, true, "arrow"));
    return artifactCard({id, kind:"Code changes", title:proposal.title || "Proposed source change", status:view.status, scope:"1 existing file", provenance:proposal.origin === "ai" ? "AI interpretation" : "From source · design edit", freshness:view.stale ? "Stale" : `Baseline ${proposal.baseRevision.slice(0, 7)}`, body, expanded, actions, warnings:[view.reason], open:() => openArtifact({kind:"changes", proposalId:proposal.id})});
  }
  function responseArtifact(turn, expanded = false) {
    const id = `request/${turn.requestId}/response`;
    const evidence = artifacts.freshness(turn.context, sourceFiles(), state.dirtyPaths);
    const partial = ["stopped", "failed"].includes(turn.state);
    const status = turn.state === "running" ? (turn.started ? "Responding" : "Preparing request") : turn.state === "stopping" ? "Stopping…" : turn.state === "stopped" ? "Cancelled · partial preserved" : turn.state === "failed" ? "Failed · partial preserved" : turn.completedWhileStopping ? "Finished during stop · partial retained" : "Complete";
    const body = el("div");
    body.append(turn.answer && turn.intent !== "change" ? answerText(turn) : el("p", "thinking", turn.intent === "change" ? partial ? "No applicable proposal was completed." : "Preparing one scoped source proposal…" : partial ? "No answer text was returned." : "Reading the selected source…"));
    if (turn.error) body.append(note(turn.error, "error"));
    if (turn.completedWhileStopping) body.append(el("p", "artifact-boundary", "The request finished while Stop was being processed. The displayed text may be partial."));
    if (turn.state === "stopped") body.append(el("p", "artifact-boundary", "Foundation stopped receiving this request. The provider may already have processed some input."));
    const usage = el("div", "answer-meta");
    if (turn.model) usage.append(el("span", "", turn.model));
    usage.append(el("span", "", turn.usage?.total_tokens !== undefined ? `${turn.usage.total_tokens.toLocaleString()} tokens` : "Usage not reported"));
    body.append(usage, sourceSnapshots(turn.context, `${id}:sources`, expanded));
    const actions = [];
    if (turn.state === "running") actions.push(artifactButton("Stop response", stop, `${id}:stop`, false, "stop"));
    else if (turn.state === "stopping") { const control = artifactButton("Stopping…", () => {}, `${id}:stop`); control.setAttribute("aria-disabled", "true"); actions.push(control); }
    else if (partial) actions.push(artifactButton("Prepare another request", () => {
      closeArtifact(); state.question = turn.question; state.intent = turn.intent;
      state.context = turn.context.filter(item => sourceFiles().some(file => file.path === item.path)).map(item => item.path);
      saveView(); renderAssistant(); composer?.focus();
    }, `${id}:retry`));
    const warnings = [evidence.status === "stale" ? "Saved source changed. This response describes its original snapshots; citations open current source." : evidence.status === "unknown" ? "Some source is no longer open. Its freshness is unknown until refreshed." : "", evidence.drafts.length ? "Editor drafts are not included in these saved snapshots." : ""];
    return artifactCard({id, kind:turn.intent === "change" ? "Task" : "Explanation", title:turn.intent === "change" ? "Prepare a source change" : "Source explanation", status, scope:`${turn.context.length} source ${turn.context.length === 1 ? "snapshot" : "snapshots"}`, provenance:"AI interpretation", freshness:evidence.status === "current" ? "Matches open saved source" : evidence.status === "stale" ? "Stale" : "Freshness unknown", body, actions, warnings, expanded, open:() => openArtifact({kind:"response", turnId:turn.id})});
  }
  function closeArtifact() { if (artifactDialog?.open) artifactDialog.close(); }
  function openArtifact(reference) {
    expandedArtifact = reference;
    artifactReturnFocus = document.activeElement?.dataset.artifactFocus;
    if (!artifactDialog) {
      artifactDialog = el("dialog", "native-artifact-dialog");
      artifactDialog.setAttribute("aria-label", "Artifact details");
      document.body.append(artifactDialog);
      artifactDialog.addEventListener("close", () => {
        expandedArtifact = null;
        root.querySelector(`[data-artifact-focus="${CSS.escape(artifactReturnFocus || "")}"]`)?.focus({preventScroll:true});
      });
    }
    updateArtifactDialog();
    if (!artifactDialog.open) artifactDialog.showModal();
    artifactDialog.querySelector(".artifact-close")?.focus();
  }
  function updateArtifactDialog() {
    if (!artifactDialog || !expandedArtifact) return;
    const focus = document.activeElement?.dataset.artifactFocus;
    const top = artifactDialog.scrollTop;
    let card;
    if (expandedArtifact.kind === "response") {
      const turn = state.turns.find(item => item.id === expandedArtifact.turnId);
      if (turn?.proposal) {
        expandedArtifact = {kind:"changes", proposalId:turn.proposal.id};
        artifactReturnFocus = `proposal/${turn.proposal.id}:review`;
        card = changeArtifact(currentProposal(turn.proposal.id) || turn.proposal, true);
      } else if (turn) card = responseArtifact(turn, true);
    } else {
      const proposal = currentProposal(expandedArtifact.proposalId);
      if (proposal) card = expandedArtifact.kind === "verification" ? verificationArtifact(proposal, true) : changeArtifact(proposal, true);
    }
    if (!card) { closeArtifact(); return; }
    const toolbar = el("div", "artifact-dialog-toolbar");
    toolbar.append(el("span", "", "Foundation / Artifact"));
    const close = artifactButton("Close", closeArtifact, "artifact-close", false, "close"); close.classList.add("artifact-close");
    toolbar.append(close); artifactDialog.replaceChildren(toolbar, card); artifactDialog.scrollTop = top;
    if (focus) {
      const candidate = artifactDialog.querySelector(`[data-artifact-focus="${CSS.escape(focus)}"]`);
      (candidate && !candidate.disabled ? candidate : artifactDialog.querySelector(".artifact-close"))?.focus({preventScroll:true});
    }
  }

  function turnView(turn) {
    const section = el("article", "assistant-turn");
    section.dataset.turnId = turn.requestId;
    section.append(el("span", "question-author", "You"), el("p", "question-text", turn.question));
    const head = el("div", "answer-heading");
    head.append(icon("source", 16), el("strong", "", "Foundation"));
    section.append(head);
    const request = el("div", "request-context-line");
    request.append(icon("shield", 12), el("span", "", `${turn.context.length} saved ${turn.context.length === 1 ? "snapshot" : "snapshots"} · ${turn.started ? "Request started" : "Dispatch not confirmed"}`));
    section.append(request);
    if (turn.proposal) {
      const proposal = currentProposal(turn.proposal.id) || turn.proposal;
      section.append(changeArtifact(proposal), verificationArtifact(proposal));
    } else section.append(responseArtifact(turn));
    return section;
  }
  function canAsk() {
    const files = selectedFiles();
    return (
      state.trusted &&
      state.provider?.configured &&
      !state.running &&
      state.question.trim().length > 0 &&
      state.question.length <= 6000 &&
      files.length > 0 &&
      files.length <= 8 &&
      files.reduce((n, file) => n + byteLength(file.source), 0) <= 65536 &&
      !files.some((file) => state.dirtyPaths.includes(file.path))
    );
  }
  function ask() {
    if (!canAsk()) return;
    const files = selectedFiles();
    const context = files.map((file, index) => ({
      id: `S${index + 1}`,
      path: file.path,
      revision: file.revision,
      source: file.source,
      lines: file.source.split("\n").length,
    }));
    const question = state.question.trim();
    state.turns.push({
      id: ++turnCounter,
      requestId: `request-${crypto.randomUUID()}`,
      started: false,
      question,
      intent: state.intent,
      answer: "",
      state: "running",
      context,
      model: state.provider.model,
    });
    state.running = true;
    state.question = "";
    saveView();
    renderAssistant();
    vscode.postMessage({
      type: "ask",
      requestId: state.turns.at(-1).requestId,
      prompt: question,
      intent: state.intent,
      context: context.map(({ path, revision }) => ({ path, revision })),
    });
  }
  function stop() {
    const turn = state.turns.at(-1);
    if (turn?.state !== "running") return;
    turn.state = "stopping";
    vscode.postMessage({ type: "cancel", requestId: turn.requestId });
    renderAssistant();
  }
  function assistant() {
    const wrap = el("div", "assistant-page");
    const heading = el("div", "page-heading");
    heading.append(
      el("div", "eyebrow", "A visible collaborator"),
      el("h1", "", "Build with context"),
      el(
        "p",
        "",
        "Understand the code, then develop a change you can inspect before applying.",
      ),
    );
    wrap.append(heading);
    const provider = el(
      "section",
      state.provider?.configured ? "provider connected" : "provider",
    );
    const copy = el("div");
    copy.append(
      el(
        "strong",
        "",
        state.provider?.configured
          ? state.provider.model
          : "Connect a model provider",
      ),
      el(
        "p",
        "",
        state.provider?.configured
          ? `${state.provider.provider} · ${state.provider.transport === "local" ? "Local provider" : "Remote provider"} · connection checked when you ask`
          : state.provider?.reason ||
              "Choose a compatible provider to ask questions about your source. Editing works independently.",
      ),
    );
    provider.append(
      icon("spark", 20),
      copy,
      button(
        state.provider?.configured ? "Settings" : "Configure",
        () => action("foundation.configureAI"),
        "button small",
      ),
    );
    const side = el("aside", "assistant-context-rail");
    side.setAttribute("aria-label", "Request context and provider");
    side.append(provider);
    const intentions = el("div", "assistant-intents"); intentions.setAttribute("aria-label", "Assistant task");
    for (const [intent, label, detail] of [["ask", "Ask", "Explain the selected source"], ["change", "Propose change", "Prepare one reviewable file edit"]]) {
      const choice = button("", () => { state.intent = intent; saveView(); renderAssistant(); }, state.intent === intent ? "intent-choice selected" : "intent-choice");
      choice.setAttribute("aria-pressed", String(state.intent === intent)); choice.setAttribute("aria-label", `${label} mode`); choice.dataset.designFocus = `intent-${intent}`; choice.disabled = state.running;
      choice.append(icon(intent === "ask" ? "source" : "spark", 18), el("strong", "", label), el("span", "", detail)); intentions.append(choice);
    }
    const layout = el("div", "assistant-layout");
    const conversation = el("section", "assistant-conversation");
    conversation.setAttribute("aria-label", "Conversation");
    conversation.append(intentions);
    if (state.proposal && state.proposal.origin === "ai" && !state.turns.some(turn => turn.proposal?.id === state.proposal.id)) {
      conversation.append(el("p", "restored-checkpoint", "Saved proposal checkpoint"), changeArtifact(state.proposal));
    }
    side.append(artifactCard({id:"context/next-request", kind:"Context", title:"Next request", status:"Not sent", scope:`${selectedFiles().length} selected / ${sourceFiles().length} available`, provenance:"From saved source", body:contextPicker()}));
    side.append(el("p", "artifact-boundary", "Conversation artifacts last for this panel session. The latest proposal checkpoint is saved locally."));
    responseRegion = el("div", "assistant-responses");
    responseRegion.setAttribute("aria-label", "Assistant conversation");
    responseRegion.setAttribute("role", "log");
    responseRegion.setAttribute("aria-live", "off");
    if (state.turns.length)
      for (const turn of state.turns) responseRegion.append(turnView(turn));
    else {
      const prompts = el("div", "suggested-questions");
      prompts.append(el("p", "quiet", "A few useful starting points"));
      for (const question of (state.intent === "change" ? [
        "Improve the loading and error states without changing the happy path.",
        "Refine the spacing and hierarchy while preserving the design tokens.",
        "Improve keyboard focus and reduced-motion behavior.",
      ] : ["What does this component do?", "Where does this interaction lead?", "What could fail, and how would we verify it?"]))
        prompts.append(
          button(
            question,
            () => {
              state.question = question;
              saveView();
              if (composer) {
                composer.value = question;
                composer.focus();
              }
              updateAskButton();
            },
            "suggestion",
            "arrow",
          ),
        );
      responseRegion.append(prompts);
    }
    conversation.append(responseRegion);
    const form = el("form", "composer");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      ask();
    });
    composer = el("textarea");
    composer.setAttribute("aria-label", "Ask about your source");
    composer.placeholder = state.intent === "change" ? "Describe the change you want to review…" : "Ask about this source…";
    composer.rows = 3;
    composer.maxLength = 6000;
    composer.value = state.question;
    composer.disabled = state.running;
    composer.addEventListener("input", () => {
      state.question = composer.value;
      saveView();
      updateAskButton();
    });
    composer.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        ask();
      }
    });
    form.append(composer);
    const footer = el("div", "composer-footer");
    footer.append(
      el(
        "span",
        "",
        state.running
          ? "You can stop at any time."
          : state.intent === "change" ? "One file per proposal. Source changes only when you apply." : "Source questions only · no code is changed",
      ),
    );
    const submit = button(
      state.running ? "Stop" : state.intent === "change" ? "Propose change" : "Ask",
      state.running ? stop : ask,
      state.running ? "button stop" : "button primary ask-submit",
      state.running ? "stop" : "send",
    );
    submit.id = "ask-submit";
    submit.disabled = state.running ? false : !canAsk();
    submit.dataset.artifactFocus = "assistant-submit";
    submit.setAttribute("aria-disabled", String(submit.disabled || state.turns.at(-1)?.state === "stopping"));
    if (state.turns.at(-1)?.state === "stopping" && state.running) submit.textContent = "Stopping…";
    footer.append(submit);
    form.append(footer);
    conversation.append(form);
    layout.append(conversation, side);
    wrap.append(layout);
    const sr = el("span", "sr-only");
    sr.setAttribute("role", "status");
    sr.textContent = state.running
      ? state.turns.at(-1)?.state === "stopping" ? "Stopping the request." : "Foundation is answering your question."
      : state.turns.at(-1)?.state === "stopped"
        ? "Answer stopped."
        : state.turns.at(-1)?.state === "complete"
          ? "Answer complete."
          : "";
    wrap.append(sr);
    return wrap;
  }
  function updateAskButton() {
    const b = document.getElementById("ask-submit");
    if (b && !state.running) { b.disabled = !canAsk(); b.setAttribute("aria-disabled", String(b.disabled)); }
  }
  function rememberFocus() {
    return {
      workspace: document.activeElement?.dataset.workspaceFocus,
      artifact: document.activeElement?.dataset.artifactFocus,
      composer: document.activeElement === composer,
      start: composer?.selectionStart,
      end: composer?.selectionEnd,
      context: document.activeElement?.dataset.contextPath,
      mode: document.activeElement?.dataset.mode,
      design: document.activeElement?.dataset.designFocus,
      designCursor: document.activeElement?.selectionStart,
      designCursorEnd: document.activeElement?.selectionEnd,
      designCursorDirection: document.activeElement?.selectionDirection,
    };
  }
  function restoreFocus(previous) {
    if (previous.workspace) {
      root.querySelector(`[data-workspace-focus="${CSS.escape(previous.workspace)}"]`)?.focus({preventScroll:true});
    } else if (previous.artifact) {
      const scope = artifactDialog?.open ? artifactDialog : root;
      const candidate = scope.querySelector(`[data-artifact-focus="${CSS.escape(previous.artifact)}"]`);
      (candidate && !candidate.disabled ? candidate : artifactDialog?.open ? artifactDialog.querySelector(".artifact-close") : root.querySelector(".composer textarea:not(:disabled)"))?.focus({preventScroll:true});
    } else if (previous.composer && !state.running && composer?.isConnected) {
      composer.focus({ preventScroll: true });
      if (previous.start !== undefined)
        composer.setSelectionRange(previous.start, previous.end);
    } else if (previous.context)
      root
        .querySelector(`[data-context-path="${CSS.escape(previous.context)}"]`)
        ?.focus({ preventScroll: true });
    else if (previous.design) {
      const input = root.querySelector(`[data-design-focus="${CSS.escape(previous.design)}"]`);
      input?.focus({ preventScroll: true });
      if (input && previous.designCursor !== undefined && typeof input.setSelectionRange === "function")
        input.setSelectionRange(previous.designCursor, previous.designCursorEnd ?? previous.designCursor, previous.designCursorDirection || "none");
    } else if (previous.mode)
      root
        .querySelector(`[data-mode="${previous.mode}"]`)
        ?.focus({ preventScroll: true });
  }
  function renderAssistant() {
    if (state.mode !== "Assistant") return;
    const main = document.getElementById("foundation-content");
    if (!main) return;
    const focus = rememberFocus();
    const top = main.scrollTop;
    const follow = main.scrollHeight - main.scrollTop - main.clientHeight <= 24;
    otherSlot.replaceChildren(assistant());
    main.scrollTop = follow ? main.scrollHeight : top;
    updateArtifactDialog();
    restoreFocus(focus);
  }
  function render() {
    const previousFocus = rememberFocus();
    if (!mainSurface) {
      chromeSlot = el("div", "workspace-chrome");
      mainSurface = el("main", "workspace-content"); mainSurface.id = "foundation-content";
      designSlot = el("div", "workspace-design-slot");
      otherSlot = el("div", "workspace-page-current");
      footerSlot = el("footer", "workspace-footer");
      mainSurface.append(designSlot, otherSlot); root.replaceChildren(chromeSlot, mainSurface, footerSlot);
      layoutObserver = new ResizeObserver(applyStudioLayout); layoutObserver.observe(mainSurface);
    }
    const previousMode = mainSurface.dataset.mode;
    const top = mainSurface.scrollTop;
    chromeSlot.replaceChildren(...header());
    if(state.error && state.mode !== "Refine") {
      const alert = note(state.error,"error"); alert.classList.add("error-banner"); alert.setAttribute("role","alert");
      const dismiss = button("", () => { state.error = ""; render(); }, "icon-button", "close"); dismiss.setAttribute("aria-label", "Dismiss error"); alert.append(dismiss); chromeSlot.append(alert);
    }
    mainSurface.dataset.mode = state.mode;
    mainSurface.setAttribute("aria-label", `${state.mode} workspace`);
    const available = state.project && state.trusted && (state.activeFile || ["Review","Assistant"].includes(state.mode));
    const samePreview = state.trusted && state.project?.id === renderedDesignProject && (state.design?.session || null) === renderedDesignSession && Boolean(state.design?.html) === Boolean(designFrame);
    if (!samePreview && designSlot.childNodes.length) {
      designResizeObserver?.disconnect(); designSlot.replaceChildren(); designFrame = null; designSettingsSignature = "";
    }
    designSlot.hidden = state.mode !== "Refine" || !available;
    designSlot.inert = designSlot.hidden;
    otherSlot.hidden = !designSlot.hidden;
    if (!designSlot.hidden) {
      if (!designSlot.childNodes.length) designSlot.append(refine());
      else updateDesignView();
    } else otherSlot.replaceChildren(!available ? emptyState() : state.mode === "Assistant" ? assistant() : state.mode === "Review" ? review() : understand());
    const status = el("span"); status.append(el("i","status-dot"), document.createTextNode(state.project ? `${state.project.files.length}${state.project.truncated ? "+" : ""} files indexed` : "Native workspace"));
    footerSlot.replaceChildren(status, el("span","footer-source",state.activeFile ? `${basename(state.activeFile.path)} · ${state.activeFile.revision.slice(0,7)}` : "Select source to begin"), el("span","footer-note",state.status || "Local workspace"));
    mainSurface.scrollTop = previousMode === state.mode ? top : scrollPositions.get(state.mode) || 0;
    applyStudioLayout(); sendDesignSettings(); updateArtifactDialog(); restoreFocus(previousFocus);
  }
  window.addEventListener("message", (event) => {
    const message = event.data;
    // Project source runs inside an opaque sandbox. Its messages are never host commands.
    if (designFrame?.contentWindow && event.source === designFrame.contentWindow) {
      if (!message || message.channel !== "foundation-design" || message.session !== state.design?.session) return;
      if (message.type === "ready") {
        state.design.observed = true;
        sendDesignSettings(true);
        vscode.postMessage({ type: "designObserved", session: message.session, event: "ready" });
        updateDesignView();
      } else if (message.type === "selection" && state.mode === "Refine" && message.selection && typeof message.selection === "object") {
        const candidate = message.selection;
        const known = !candidate.path || state.project?.files.some((file) => file.path === candidate.path);
        if (!known) return;
        state.designSelection = candidate;
        state.unmappedMessage = "";
        vscode.postMessage({ type: "designObserved", session: message.session, event: "selection", intent: message.intent === "select" ? "select" : "measure", selection: candidate });
        updateDesignView();
      } else if (message.type === "unmapped" && state.mode === "Refine") {
        state.designSelection = null;
        state.unmappedMessage = "This element has no validated explicit source mapping. Select an instrumented component or open its source in the editor.";
        vscode.postMessage({ type: "designObserved", session: message.session, event: "selection", selection: null });
        updateDesignView();
      } else if (message.type === "settingsApplied") {
        const skipped = Number.isInteger(message.skipped) && message.skipped > 0 ? Math.min(message.skipped, 160) : 0;
        if (skipped !== state.skippedExperiments) {
          state.skippedExperiments = skipped;
          root.querySelector(".design-status-region")?.replaceWith(designStatus());
        }
      } else if (message.type === "error") {
        const error = String(message.error || "The preview could not render.").slice(0, 1000);
        state.design.error = error;
        vscode.postMessage({ type: "designObserved", session: message.session, event: "error", error });
        updateDesignView();
      }
      return;
    }
    // Code OSS forwards extension messages from its same-origin outer frame,
    // but its API bootstrap replaces window.parent with window. Check the real
    // message origin instead of that rewritten reference. Opaque project frames
    // are handled above and can never enter this host-message path.
    if (!event.origin || event.origin === "null" || event.origin !== window.location.origin) return;
    if (!message || typeof message.type !== "string") return;
    if (message.type === "state") {
      const priorProject = state.project?.id;
      const nextDesign = message.design || null;
      if (nextDesign?.session && nextDesign.session === state.design?.session && nextDesign.html === undefined) nextDesign.html = state.design.html;
      if (nextDesign?.session !== state.design?.session) { state.designSelection = undefined; state.unmappedMessage = ""; state.skippedExperiments = 0; }
      Object.assign(state, {
        project: message.project || null,
        activeFile: message.activeFile || null,
        openFiles: Array.isArray(message.openFiles) ? message.openFiles : [],
        dirtyPaths: Array.isArray(message.dirtyPaths) ? message.dirtyPaths : [],
        changes: Array.isArray(message.changes) ? message.changes : [],
        selection: message.selection || null,
        focus: message.focus || null,
        trusted: message.trusted === true,
        provider: message.provider || null,
        connected: true,
        error: message.error || "",
        design: nextDesign,
        proposal: message.proposal || null,
      });
      if (state.project && message.workspaceLayout && !hydratedLayouts.has(state.project.id)) {
        state.layouts[state.project.id] = {inspectorWidth:workspace.snapWidth(message.workspaceLayout.inspectorWidth)}; hydratedLayouts.add(state.project.id);
      }
      if (state.focus?.origin === "source" && state.designSelection?.path !== state.focus.path) state.designSelection = null;
      if (state.proposal?.requestId) {
        const owner = state.turns.find(turn => turn.requestId === state.proposal.requestId);
        if (owner) owner.proposal = state.proposal;
      }
      if (priorProject !== state.project?.id) {
        state.context = [];
        state.contextInitialized = false;
        closeArtifact();
        state.turns = [];
        artifactCollapsed.clear();
        disclosureState.clear();
        state.running = false;
        state.designSelection = null;
        state.tokenDrafts = {};
        state.tokenInputs = {};
        state.selectedToken = null;
        state.designEntry = "";
      }
      if (state.pendingDesignContext && sourceFiles().some((file) => file.path === state.pendingDesignContext)) {
        state.context = [state.pendingDesignContext];
        state.contextInitialized = true;
        state.pendingDesignContext = null;
      }
      if (!state.contextInitialized && state.activeFile) {
        state.context = [state.activeFile.path];
        state.contextInitialized = true;
      }
      state.context = state.context.filter((path) =>
        sourceFiles().some((file) => file.path === path),
      );
      render();
      return;
    }
    if (message.type === "mode") {
      if (message.mode === "Build") action("foundation.build");
      else setMode(message.mode);
      return;
    }
    if (message.type === "error") {
      state.error =
        typeof message.message === "string"
          ? message.message
          : "The operation could not be completed.";
      render();
      return;
    }
    if (message.type === "status") {
      state.status = typeof message.message === "string" ? message.message : "";
      const footer = root.querySelector(".footer-note");
      if (footer) footer.textContent = state.status;
      return;
    }
    if (message.type === "ai") {
      const data = message.event;
      const turn = state.turns.at(-1);
      if (!data || !artifacts.acceptsEvent(turn, message)) return;
      if (data.type === "start") { turn.model = data.model || turn.model; turn.started = true; }
      if (data.type === "cancelled") { turn.state = "stopped"; state.running = false; }
      if (data.type === "delta" && typeof data.text === "string")
        turn.answer += data.text;
      if (data.type === "proposal" && data.proposal) {
        state.proposal = data.proposal;
        turn.proposal = data.proposal;
      }
      if (data.type === "done") {
        turn.completedWhileStopping = turn.state === "stopping";
        turn.state = "complete";
        turn.usage = data.usage;
        turn.model = data.model || turn.model;
        state.running = false;
      }
      if (data.type === "error") {
        turn.state = "failed";
        turn.error =
          data.error || "The provider could not complete this answer.";
        state.running = false;
      }
      renderAssistant();
      return;
    }
  });
  render();
  vscode.postMessage({ type: "ready" });
})();
