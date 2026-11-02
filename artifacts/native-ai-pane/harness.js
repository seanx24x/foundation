(() => {
  "use strict";

  // This file is a fixture host, never part of the shipped extension. The iframe
  // loads unmodified production assets; all host state below stays in memory.
  const frame = document.getElementById("native-webview");
  const themeInput = document.getElementById("fixture-theme");
  const widthInput = document.getElementById("fixture-width");
  const dialog = document.getElementById("fixture-detail");
  const scenarios = {
    idle: { title: "Ready to explore", copy: "Choose a scenario or ask a question. Every response on this page is simulated locally.", prompt: "", intent: "ask" },
    explanation: { title: "Explanation · saved source", copy: "A deterministic answer cites the saved SaveButton snapshot. Source navigation opens a read-only fixture detail.", prompt: "How does SaveButton handle loading and success?", intent: "ask" },
    proposal: { title: "Proposal · one file", copy: "Review a one-file loading-label change. Applying and undoing affect this page’s memory only.", prompt: "Make the loading label more explicit, without changing behavior.", intent: "change" },
    stale: { title: "Stale · changed baseline", copy: "After the proposal completes, a simulated source revision changes. The original evidence stays visible and application is blocked.", prompt: "Make the loading label more explicit, without changing behavior.", intent: "change" },
    draft: { title: "Draft · dispatch blocked", copy: "A simulated unsaved SaveButton draft blocks sending selected context and applying the proposal. Your actual editor draft is never read or changed.", prompt: "Explain the save behavior using this source.", intent: "ask" },
    streaming: { title: "Streaming / Stop · cancellable", copy: "The sample streams slowly. Use Stop in the actual pane; this host acknowledges cancellation after 320 ms and retains the partial answer.", prompt: "Walk through the save interaction and its verification gaps.", intent: "ask" },
    failed: { title: "Failed · recoverable", copy: "The simulated provider fails after a partial answer. The selected context remains available for another request.", prompt: "Explain how saving works and what still needs verification.", intent: "ask" },
  };
  const timers = new Set();
  let fixture;
  let currentScenario = "idle";
  let virtualState;
  let request = null;
  let generation = 0;
  let pendingAutoSubmit = false;
  let dialogOpener = null;
  let requestNumber = 0;

  const copy = (value) => structuredClone(value);
  const later = (callback, delay) => {
    const currentGeneration = generation;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (currentGeneration === generation) callback();
    }, delay);
    timers.add(timer);
    return timer;
  };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };
  const send = (message) => frame.contentWindow?.postMessage(message, location.origin);
  const log = (message, detail) => {
    document.getElementById("fixture-last-action").textContent = message;
    if (detail) document.getElementById("fixture-message").textContent = JSON.stringify(detail, null, 2);
  };
  const setRequestLabel = (value) => { document.getElementById("fixture-request-id").textContent = value || "No active request"; };

  function baseState() {
    const [source, tokens] = copy(fixture.files);
    return {
      type: "state",
      project: copy(fixture.project),
      activeFile: source,
      openFiles: [source, tokens],
      dirtyPaths: [],
      trusted: true,
      provider: { configured: true, provider: "Fixture host · simulated", model: "Deterministic sample", transport: "local" },
      changes: [],
      selection: { startLine: 3, endLine: 3 },
      proposal: null,
    };
  }

  function sampleProposal() {
    const [source] = fixture.files;
    return {
      id: `fixture-save-label-${request?.id || "draft"}`,
      projectId: fixture.project.id,
      ...(request?.id ? { requestId: request.id } : {}),
      title: "Clarify the loading label",
      summary: "Replace ‘Saving…’ with ‘Saving your changes…’. The disabled state, success label, and event behavior remain unchanged.",
      path: source.path,
      baseRevision: source.revision,
      before: source.source,
      after: source.source.replace("Saving…", "Saving your changes…"),
      origin: "ai",
      status: "proposed",
      context: request ? copy(request.context) : [{ path: source.path, revision: source.revision }],
      verification: ["Compilation: not run in this browser fixture.", "Interaction: check that saving disables the button and preserves the success label.", "Visual: inspect the longer label at 390 px in light and dark themes."],
    };
  }

  function themeCSS(theme) {
    return `:root{color-scheme:${theme};${Object.entries(fixture.themes[theme]).map(([key, value]) => `--vscode-${key.replaceAll(".", "-")}:${value};`).join("")}}`;
  }

  function loadRenderer(scenario = "idle", autoSubmit = false) {
    clearTimers();
    generation += 1;
    request = null;
    currentScenario = scenario;
    pendingAutoSubmit = autoSubmit;
    virtualState = baseState();
    const chosen = scenarios[scenario];
    if (scenario === "draft") {
      virtualState.dirtyPaths = [fixture.files[0].path];
      virtualState.proposal = sampleProposal();
    }
    document.getElementById("fixture-scenario-label").textContent = chosen.title;
    document.getElementById("fixture-scenario-copy").textContent = chosen.copy;
    document.querySelectorAll("[data-scenario]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.scenario === scenario)));
    setRequestLabel();
    log("Loading the native renderer with isolated sample state…");
    // A real same-origin URL is required: srcdoc's location.origin is "null",
    // which cannot satisfy the production renderer's host-message boundary.
    // The bridge consumes this fixture-only configuration before loading it.
    frame.dataset.fixtureConfig = JSON.stringify({
      generation,
      view: { mode: "Assistant", intent: chosen.intent, question: chosen.prompt },
      themeCSS: themeCSS(themeInput.value),
    });
    frame.removeAttribute("srcdoc");
    frame.src = `./frame.html?generation=${generation}`;
  }

  function submitScenario() {
    // A scenario button is the explicit user action. Submit through the actual
    // renderer so context selection, request IDs, and disabled guards are real.
    const document = frame.contentDocument;
    const intentLabel = scenarios[currentScenario].intent === "change" ? "Propose change mode" : "Ask mode";
    document?.querySelector(`button[aria-label="${intentLabel}"]`)?.click();
    const composer = document?.querySelector('textarea[aria-label="Ask about your source"]');
    const form = composer?.closest("form");
    if (!composer || !form) {
      log("The renderer did not expose its composer. Check that the copied media assets match the extension.");
      return;
    }
    composer.value = scenarios[currentScenario].prompt;
    composer.dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true }));
    form.requestSubmit();
  }

  function emitAI(target, event) {
    if (request !== target) return;
    send({ type: "ai", requestId: target.id, event: { ...event, requestId: target.id } });
  }

  function answerChunks(target) {
    const sourceIndex = target.context.findIndex((item) => item.path === fixture.files[0].path);
    if (sourceIndex < 0) return ["This request contains saved context, but not the SaveButton snapshot used by this scripted example. The fixture cannot infer a different source explanation. Select SaveButton.tsx to inspect its sample response. No provider was contacted."];
    const cite = (line) => `[S${sourceIndex + 1}:${line}]`;
    if (target.intent === "change" || target.scenario === "proposal" || target.scenario === "stale") return [
      `The current loading label is ‘Saving…’. I can change that one string while keeping the existing saving and success behavior ${cite(13)}.\n\n`,
      "The proposal below is limited to SaveButton.tsx. Compilation, interaction, and visual verification have not run in this fixture.",
    ];
    return [
      `SaveButton receives a typed state: idle, saving, saved, or error ${cite(1)}.\n\n`,
      `While saving, busy is true. The button is disabled and exposes aria-busy to assistive technology ${cite(4)} ${cite(9)} ${cite(10)}.\n\n`,
      `The label changes to ‘Saving…’ during the operation, then ‘Changes saved’ on success ${cite(13)}. The icon switches to a check mark ${cite(14)}.\n\n`,
      "The error state currently falls back to ‘Save changes’. This source alone does not show a request, retry policy, or error announcement. Those relationships are unknown here.\n\n",
      "Compilation: not run. Interaction: not run. Visual comparison: not run. The next useful check is to exercise saving, success, and error in a connected runtime.",
    ];
  }

  function beginRequest(message) {
    clearTimers();
    const selected = Array.isArray(message.context) ? message.context : [];
    const id = message.requestId || `fixture-legacy-${++requestNumber}`;
    const target = { id, scenario: currentScenario, intent: message.intent, context: selected, cancelling: false };
    request = target;
    setRequestLabel(id);
    log("Ask captured. Waiting for the simulated host to confirm context dispatch…", message);
    if (selected.some((item) => virtualState.dirtyPaths.includes(item.path))) {
      emitAI(target, { type: "error", error: "Fixture guard: selected context contains an unsaved draft." });
      log("Dispatch blocked by the sample host: selected context has an unsaved draft.", message);
      return;
    }
    if (message.intent === "change" && !selected.some((item) => item.path === fixture.files[0].path)) {
      emitAI(target, { type: "error", error: "This scripted proposal needs the SaveButton.tsx saved snapshot. Select it in the context picker and try again." });
      log("Sample proposal blocked: SaveButton.tsx was not selected. No context was dispatched.", message);
      setRequestLabel(`${id} · blocked`);
      return;
    }
    later(() => {
      emitAI(target, { type: "start", model: "Deterministic sample", provider: "Fixture host", context: selected });
      log(`Simulated dispatch confirmed · ${selected.length} saved ${selected.length === 1 ? "file" : "files"} · no provider request.`, { type: "start", requestId: id, context: selected });
    }, 160);
    const chunks = answerChunks(target);
    const interval = target.scenario === "streaming" ? 1500 : target.intent === "change" ? 700 : 160;
    chunks.forEach((text, index) => {
      if (target.scenario === "failed" && index > 0) return;
      later(() => emitAI(target, { type: "delta", text }), 320 + index * interval);
    });
    if (target.scenario === "failed") {
      later(() => {
        emitAI(target, { type: "error", error: "Simulated provider interruption. No external request was made. The partial answer and selected source are preserved." });
        log("Simulated failure delivered. Context and partial output remain visible.", { type: "error", requestId: id, fixture: true });
        setRequestLabel(`${id} · failed`);
      }, 850);
      return;
    }
    const end = 500 + chunks.length * interval;
    if (target.intent === "change" || target.scenario === "proposal" || target.scenario === "stale") {
      later(() => {
        virtualState.proposal = sampleProposal();
        emitAI(target, { type: "proposal", proposal: copy(virtualState.proposal) });
      }, end - 80);
    }
    later(() => {
      emitAI(target, { type: "done", model: "Deterministic sample", usage: { total_tokens: 0 } });
      log("Sample response complete. Usage is zero; no model was contacted.", { type: "done", requestId: id, fixture: true, usage: { total_tokens: 0 } });
      setRequestLabel(`${id} · complete`);
      if (target.scenario === "stale") later(markStale, 300);
    }, end);
  }

  function markStale() {
    if (!virtualState.proposal) return;
    const current = copy(fixture.files[0]);
    current.revision = `fixture-new-${current.revision}`;
    current.source = current.source.replace("'Save changes'", "'Save settings'");
    virtualState.activeFile = current;
    virtualState.openFiles[0] = current;
    virtualState.proposal = { ...virtualState.proposal, status: "stale", reason: "Simulated source change: the proposal baseline no longer matches this saved snapshot. Generate a fresh proposal before applying." };
    send(copy(virtualState));
    log("A sample source revision changed. The original proposal and its evidence are now stale; no file was written.", { type: "state", activeRevision: current.revision, proposalStatus: "stale", fixture: true });
  }

  function cancelRequest(message) {
    log("Cancel captured. Waiting 320 ms for the simulated cancellation acknowledgement…", message);
    if (!request || (message.requestId && message.requestId !== request.id)) return;
    clearTimers();
    const target = request;
    target.cancelling = true;
    later(() => {
      emitAI(target, { type: "cancelled" });
      setRequestLabel(`${target.id} · cancelled`);
      log("Cancellation acknowledged. Partial output is preserved; no more chunks will be sent for this request.", { type: "cancelled", requestId: target.id, fixture: true });
      request = null;
    }, 320);
  }

  function openDetail(title, description, columns) {
    dialogOpener = document.activeElement;
    document.getElementById("fixture-detail-title").textContent = title;
    document.getElementById("fixture-detail-description").textContent = description;
    const body = document.getElementById("fixture-detail-body");
    body.className = `fixture-source-grid${columns.length === 1 ? " single" : ""}`;
    body.replaceChildren(...columns.map(([label, source]) => {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = label;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = source;
      pre.append(code);
      section.append(heading, pre);
      return section;
    }));
    dialog.showModal();
  }

  function proposalAction(message) {
    const proposal = virtualState.proposal;
    if (!proposal || proposal.id !== message.id) { log("The sample host has no matching proposal. Reset the sample and try again.", message); return; }
    if (message.type === "proposalDiff") {
      openDetail("Review the source change", "Fixture stand-in for a native editor diff. These are static saved source snapshots; this dialog cannot write files.", [["Before", proposal.before], ["After", proposal.after]]);
      log("Native diff action captured. Opened the read-only before/after fixture.", message);
      return;
    }
    if (message.type === "proposalDiscard") {
      virtualState.proposal = null;
      send(copy(virtualState));
      log("Proposal dismissed in fixture memory. Source is unchanged.", message);
      return;
    }
    const dirty = virtualState.dirtyPaths.includes(proposal.path) || (proposal.context || []).some((item) => virtualState.dirtyPaths.includes(item.path));
    if (dirty || (message.type === "proposalApply" && (proposal.status !== "proposed" || virtualState.activeFile.revision !== proposal.baseRevision))) {
      log("Sample host rejected the action: the proposal is stale or its context has a draft. No source was written.", message);
      return;
    }
    if (message.type === "proposalApply") {
      virtualState.activeFile = { ...virtualState.activeFile, source: proposal.after, revision: `fixture-applied-${proposal.baseRevision}` };
      virtualState.openFiles[0] = virtualState.activeFile;
      virtualState.proposal = { ...proposal, status: "applied", appliedRevision: virtualState.activeFile.revision };
      virtualState.changes = [{ path: proposal.path, baseRevision: proposal.baseRevision, revision: virtualState.activeFile.revision, conflict: false }];
      send(copy(virtualState));
      log("Apply simulated in memory only. The real Orbit source and editor draft are untouched.", message);
    } else if (message.type === "proposalUndo") {
      if (proposal.status !== "applied") { log("Undo is unavailable: this fixture proposal is not applied.", message); return; }
      virtualState.activeFile = copy(fixture.files[0]);
      virtualState.openFiles[0] = virtualState.activeFile;
      virtualState.proposal = { ...proposal, status: "undone" };
      virtualState.changes = [];
      send(copy(virtualState));
      log("Undo simulated in memory only. No filesystem action occurred.", message);
    }
  }

  function onMessage(message) {
    if (message.type === "ready") {
      send(copy(virtualState));
      send({ type: "mode", mode: "Assistant" });
      log(currentScenario === "draft" ? "Sample draft loaded. The real renderer should block Ask and Apply." : "Native renderer ready. No scenario runs until you choose one or submit a prompt.", { type: "ready", fixture: true });
      if (pendingAutoSubmit) {
        pendingAutoSubmit = false;
        later(submitScenario, 100);
      }
    } else if (message.type === "ask") beginRequest(message);
    else if (message.type === "cancel") cancelRequest(message);
    else if (["proposalApply", "proposalUndo", "proposalDiscard", "proposalDiff"].includes(message.type)) proposalAction(message);
    else if (message.type === "navigate" || message.type === "reviewFile") {
      const source = virtualState.openFiles.find((item) => item.path === message.path);
      log("Source navigation captured. Opened a read-only saved snapshot.", message);
      if (source) openDetail(message.path, `Saved sample snapshot · revision ${source.revision.slice(0, 12)}${message.line ? ` · requested line ${message.line}` : ""}. No editor command is executed.`, [["Source", source.source]]);
    } else {
      log(`Captured ${message.type || "unknown"}${message.id ? ` · ${message.id}` : ""}. This fixture does not execute native commands.`, message);
      if (message.type === "action" && message.id === "foundation.refresh") send(copy(virtualState));
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.channel !== "foundation-fixture-host") return;
    if (!event.data.message || typeof event.data.message.type !== "string" || !fixture) return;
    onMessage(event.data.message);
  });
  document.querySelectorAll("[data-scenario]").forEach((button) => {
    button.disabled = true;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => loadRenderer(button.dataset.scenario, button.dataset.scenario !== "draft"));
  });
  document.getElementById("fixture-reset").addEventListener("click", () => fixture && loadRenderer());
  themeInput.addEventListener("change", () => {
    document.documentElement.dataset.theme = themeInput.value;
    const style = frame.contentDocument?.getElementById("fixture-native-theme");
    if (style && fixture) style.textContent = themeCSS(themeInput.value);
  });
  widthInput.addEventListener("change", () => { frame.className = `width-${widthInput.value}`; });
  document.getElementById("fixture-detail-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { if (dialogOpener?.isConnected) dialogOpener.focus({ preventScroll: true }); });
  window.addEventListener("pagehide", clearTimers);

  // This is the only fetch: a static, checked-in bundled-sample JSON asset on
  // this page's origin. There is no provider transport or writable endpoint.
  fetch(new URL("./fixture.json", location.href), { cache: "no-store", credentials: "omit" })
    .then((response) => { if (!response.ok) throw new Error(`Fixture asset returned ${response.status}`); return response.json(); })
    .then((data) => {
      if (!data.project?.id || data.files?.length !== 2 || !data.themes?.light || !data.themes?.dark) throw new Error("Incomplete fixture asset");
      fixture = data;
      document.querySelectorAll("[data-scenario]").forEach((button) => { button.disabled = false; });
      loadRenderer();
    })
    .catch((error) => log(`Could not load the static sample. Serve this folder over HTTP with media assets present. ${error.message}`));
})();
