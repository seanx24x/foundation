(() => {
  'use strict';
  const frame = document.getElementById('native-webview');
  const themeInput = document.getElementById('fixture-theme');
  const fileInput = document.getElementById('fixture-file');
  const staleButton = document.getElementById('fixture-stale');
  const sourceDialog = document.getElementById('fixture-source');
  const status = document.getElementById('fixture-status');
  let fixture, state, generation = 0, previewGeneration = 0, variant = 'saved', dismissStatus;
  const clone = value => structuredClone(value);
  const files = () => fixture.variants[variant];
  const send = message => frame.contentWindow?.postMessage(message, location.origin);
  const announce = text => {
    clearTimeout(dismissStatus); status.textContent = text; status.hidden = false;
    dismissStatus = setTimeout(() => { status.hidden = true; }, 7000);
  };
  const themeCSS = () => `:root{color-scheme:${themeInput.value};${Object.entries(fixture.themes[themeInput.value])
    .map(([key, value]) => `--vscode-${key.replaceAll('.', '-')}:${value};`).join('')}}`;
  function publish() {
    state.focus = state.focus && state.activeFile?.path === state.focus.path ? {
      ...state.focus, stale: state.focus.origin === 'preview' && (Boolean(state.design.stale)
        || state.focus.session !== state.design.session || state.focus.revision !== state.activeFile.revision),
    } : null;
    state.selection = state.focus?.line ? { startLine: state.focus.line, endLine: state.focus.endLine || state.focus.line } : null;
    fileInput.value = state.activeFile?.path || '';
    const message = clone(state);
    // Production keeps the last HTML for the same session. Avoid copying the
    // bundled runtime on every resize/style observation as the native host does.
    if (state.sentSession === state.design?.session) delete message.design.html;
    else state.sentSession = state.design?.session;
    delete message.sentSession;
    send(message);
  }
  function selectSource(path, line = 1, detail = false) {
    const file = files().find(item => item.path === path);
    if (!file) return announce('This source is outside the saved fixture inventory.');
    state.activeFile = clone(file);
    state.openFiles = [clone(file), ...state.openFiles.filter(item => item.path !== path)].slice(0, 8);
    const safeLine = Math.max(1, Math.min(file.source.split('\n').length, Number.isInteger(line) ? line : 1));
    const symbol = file.analysis.symbols.find(item => item.line <= safeLine && item.endLine >= safeLine)
      || file.analysis.symbols.find(item => item.exported) || file.analysis.symbols[0];
    state.focus = { path, label: symbol?.name || path.split('/').at(-1), line: safeLine,
      endLine: safeLine, origin: 'source', revision: file.revision };
    publish();
    if (detail) {
      document.getElementById('source-title').textContent = `${path} · ${file.revision.slice(0, 7)}`;
      document.getElementById('source-code').textContent = file.source.split('\n')
        .map((text, i) => `${String(i + 1).padStart(3)}  ${text}`).join('\n');
      sourceDialog.showModal();
      document.getElementById('source-close').focus();
    } else announce('Selected saved fixture source. No native editor or file was changed.');
  }
  function loadPreview(entry, notify = true) {
    const prepared = fixture.previews[variant][entry];
    if (!prepared) return announce('This entry is not included in the precompiled fixture.');
    state.design = clone(prepared);
    if (state.design.html) {
      const original = state.design.session;
      state.design.session = `${original}-r${++previewGeneration}`;
      state.design.html = state.design.html.replaceAll(original, state.design.session);
    }
    publish();
    if (notify) announce('Loaded the precompiled saved fixture. Rendering and measurements run locally; source is unchanged.');
  }
  function reset() {
    generation += 1; variant = 'saved'; status.hidden = true;
    staleButton.disabled = false; staleButton.setAttribute('aria-pressed', 'false');
    const source = fixture.variants.saved.find(file => file.path === 'src/components/SaveButton.tsx');
    state = { type: 'state', project: clone(fixture.project), activeFile: clone(source),
      openFiles: clone(fixture.variants.saved), dirtyPaths: [], changes: [], trusted: true,
      provider: { configured: false, reason: 'Browser fixture. No provider is connected.' },
      focus: { path: source.path, label: 'SaveButton', line: 3, endLine: 3, origin: 'source', revision: source.revision },
      proposal: null, design: clone(fixture.previews.saved['src/App.tsx']), error: '' };
    fileInput.replaceChildren();
    for (const file of fixture.variants.saved) {
      const option = document.createElement('option'); option.value = file.path;
      option.textContent = file.path.split('/').at(-1); fileInput.append(option);
    }
    fileInput.value = source.path;
    frame.dataset.fixtureConfig = JSON.stringify({ view: { mode: 'Refine', designWidth: '960', designTheme: 'light' }, themeCSS: themeCSS() });
    frame.src = `./frame.html?generation=${generation}`;
  }
  function observed(message) {
    if (message.session !== state.design.session) return;
    if (message.event === 'ready') state.design.observed = true;
    else if (message.event === 'error') {
      state.design.observed = false; state.design.error = String(message.error || 'Preview rendering failed.').slice(0, 600);
    } else if (message.event === 'selection') {
      const candidate = message.selection;
      if (candidate === null) state.design.selection = null;
      else {
        if (!candidate || !state.design.mappings?.includes(candidate.path)) return;
        const rect = candidate.rect;
        if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]) && Math.abs(rect[key]) < 100000)) return;
        state.design.selection = clone(candidate);
        // Measurement refreshes never move source/AI focus. Only an explicit
        // product selection may synchronize the selected saved fixture source.
        if (message.intent === 'select') {
          const file = files().find(item => item.path === candidate.path);
          if (!file) return;
          const snapshot = state.design.files.find(item => item.path === candidate.path);
          state.activeFile = clone(file);
          state.openFiles = [clone(file), ...state.openFiles.filter(item => item.path !== file.path)].slice(0, 8);
          state.focus = { path: file.path, label: String(candidate.label || candidate.tag).slice(0, 160),
            origin: 'preview', revision: snapshot?.revision, session: message.session };
        }
      }
    } else return;
    publish();
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow
      || event.data?.channel !== 'foundation-workspace-fixture' || !fixture || !state) return;
    const message = event.data.message;
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'ready') publish();
    else if (message.type === 'designStart') loadPreview(message.entry);
    else if (message.type === 'designObserved') observed(message);
    else if (message.type === 'navigate') selectSource(message.path, message.line, true);
    else if (message.type === 'action') {
      if (message.id === 'foundation.build') selectSource(state.activeFile.path, state.focus?.line || 1, true);
      else if (message.id === 'foundation.refresh') { state.error = ''; publish(); announce('Saved fixture context refreshed.'); }
      else if (message.id === 'foundation.refine') send({ type: 'mode', mode: 'Refine' });
      else if (message.id === 'foundation.understand') send({ type: 'mode', mode: 'Understand' });
      else if (message.id === 'foundation.review') send({ type: 'mode', mode: 'Review' });
      else if (message.id === 'foundation.askAI') send({ type: 'mode', mode: 'Assistant' });
      else announce('This action belongs to the native desktop app. The fixture cannot open projects, terminals, credentials, or providers.');
    } else if (message.type === 'ask') {
      send({ type: 'ai', requestId: message.requestId, event: { type: 'error', requestId: message.requestId,
        error: 'No provider is connected to this fixture. Context has not been sent.' } });
    } else if (message.type === 'cancel') {
      send({ type: 'ai', requestId: message.requestId, event: { type: 'cancelled', requestId: message.requestId } });
    } else if (['designPropose', 'applyProposal', 'undoProposal', 'discardProposal', 'reviewFile'].includes(message.type)) {
      announce('Source proposals and Apply/Undo are unavailable in this fixture. Canvas experiments stay local and never write source.');
      send({ type: 'status', message: 'Fixture only · source proposals and writes unavailable' });
    } else announce('This native host action is unavailable in the browser fixture.');
  });
  themeInput.addEventListener('change', () => {
    document.documentElement.dataset.theme = themeInput.value;
    const style = frame.contentDocument?.getElementById('fixture-native-theme');
    if (style) style.textContent = themeCSS();
  });
  fileInput.addEventListener('change', () => selectSource(fileInput.value));
  document.getElementById('fixture-reset').addEventListener('click', reset);
  document.getElementById('source-close').addEventListener('click', () => sourceDialog.close());
  sourceDialog.addEventListener('click', event => { if (event.target === sourceDialog) sourceDialog.close(); });
  staleButton.addEventListener('click', () => {
    variant = 'changed'; staleButton.disabled = true; staleButton.setAttribute('aria-pressed', 'true');
    state.activeFile = clone(files().find(file => file.path === state.activeFile.path));
    state.openFiles = state.openFiles.map(file => clone(files().find(item => item.path === file.path)));
    state.design.stale = true;
    if (state.focus?.origin === 'source') state.focus.revision = state.activeFile.revision;
    publish(); announce('Fixture-only saved revision changed. The running preview is now stale. Rebuild preview to load the new snapshot.');
  });
  fetch('./fixture.json', { cache: 'no-store' }).then(response => {
    if (!response.ok) throw new Error(`Fixture unavailable (${response.status})`);
    return response.json();
  }).then(value => { fixture = value; reset(); }).catch(error => announce(error.message));
})();
