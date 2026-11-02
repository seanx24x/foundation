(() => {
  'use strict';
  const vscode = acquireVsCodeApi(), viewId = crypto.randomUUID();
  const root = document.getElementById('xcode-project-root');
  let state = { phase: 'idle', ownerKey: '', trusted: false, project: null, results: {} };
  root.innerHTML = `<header class="setup-header"><div><p class="setup-eyebrow">Foundation</p><h1>Xcode Project</h1><p class="setup-project"></p></div><button type="button" data-action="choose">Choose folder</button></header>
    <section class="setup-overview" aria-labelledby="xcode-summary"><div><h2 id="xcode-summary">Build and test your iOS app</h2><p class="setup-intro">Choose a project, scheme, and Simulator destination. Discovery asks Xcode to evaluate project settings. Build and tests run only when you request them.</p></div><div class="setup-actions"><button type="button" data-action="discover">Discover project</button><button type="button" data-action="cancel" hidden>Cancel</button></div></section>
    <p class="setup-state" role="status" aria-live="polite"></p>
    <section class="xcode-selection" hidden aria-label="Selected build target"><dl></dl><button type="button" data-action="destination">Change destination</button></section>
    <section class="xcode-swift" aria-labelledby="swift-heading"><div class="setup-row-title"><h2 id="swift-heading">Swift editor</h2><span class="setup-badge swift-status"></span></div><p class="swift-description" role="status" aria-live="polite"></p><div class="setup-actions"><button type="button" data-action="swiftConnect">Build and connect Swift</button><button type="button" data-action="swiftStop" hidden>Disconnect Swift</button></div><div class="swift-evidence"></div></section>
    <section class="xcode-operations" aria-label="Build and test actions"><div class="setup-actions"><button class="setup-primary" type="button" data-action="build">Build</button><button type="button" data-action="test">Run tests</button></div><p class="setup-muted xcode-execution">Xcode builds execute project code. Outputs use a separate local folder; project build scripts retain their normal access.</p><p class="setup-muted xcode-test-help"></p></section>
    <div class="xcode-results"></div><section class="xcode-tooling"></section><footer>Compilation and tests have separate outcomes. App launch, visual verification, and runtime source mapping require their own checks.</footer>`;
  const $ = selector => root.querySelector(selector);
  const button = action => $(`[data-action="${action}"]`);
  const node = (tag, text, className) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = String(text); if (className) item.className = className; return item; };
  const statusLabels = { passed: 'Passed', failed: 'Failed', cancelled: 'Cancelled', timeout: 'Timed out', 'output-limit': 'Output limit reached', unavailable: 'Unavailable', stale: 'Source changed' };
  const messages = { idle: 'Discover a project to choose what to build.', discovering: 'Discovering project settings. Choose each target in the command picker.', ready: 'Ready to build or run tests.', running: 'Xcode is running. You can keep editing other files.', cancelled: 'Operation cancelled.', stale: 'Source or configuration changed. Discover the project again.', failed: 'The request could not be completed.', unavailable: 'Xcode operations are unavailable for this project.' };
  function resultCard(action) {
    const result = state.results?.[action], card = node('section', undefined, 'xcode-result');
    card.dataset.result = action;
    const title = node('div', undefined, 'setup-row-title');
    const busy = state.busy && state.action === action;
    const label = busy ? 'Running…' : result ? statusLabels[result.status] || 'Not verified' : 'Not run';
    title.append(node('h2', action === 'build' ? 'Build' : 'Tests'), node('span', label, 'setup-badge ' + (result?.status === 'passed' ? 'setup-available' : result ? 'setup-failed' : '')));
    card.append(title);
    if (!result) {
      card.append(node('p', action === 'build' ? 'Compile the selected scheme for its destination.' : 'Execute the selected scheme’s test action.', 'setup-muted'));
      return card;
    }
    card.append(node('p', result.reason || (result.status === 'passed' ? 'Xcode completed this operation successfully.' : 'Xcode did not complete this operation successfully.')));
    if (result.recovery) card.append(node('p', result.recovery, 'setup-recovery'));
    const historical = state.evidenceStale || state.phase === 'stale' || !result.sourceCurrent;
    card.append(node('p', historical ? 'Historical result — source has changed.' : 'Recorded against saved source.', 'setup-muted'));
    const evidence = node('details'); evidence.append(node('summary', 'Output and source evidence'));
    const list = node('dl', undefined, 'xcode-evidence');
    for (const [label, value] of [['Scheme', result.scheme], ['Destination', result.destination?.label], ['Finished', result.finishedAt], ['Source', result.inputFingerprint], ['Exit code', result.exitCode ?? 'None'], ['Results folder', result.artifacts?.directory]]) {
      if (value === undefined) continue; list.append(node('dt', label), node('dd', value));
    }
    evidence.append(list);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (output) { evidence.append(node('p', 'Final output (up to 32,768 characters)', 'setup-muted')); const pre = node('pre', output.slice(-32768)); pre.tabIndex = 0; pre.setAttribute('aria-label', (action === 'build' ? 'Build' : 'Test') + ' output'); evidence.append(pre); }
    card.append(evidence); return card;
  }
  let lastSwiftEvidence;
  function render() {
    const focusedAction = document.hasFocus() ? document.activeElement?.closest?.('button[data-action]')?.dataset.action : undefined;
    root.dataset.phase = state.phase; root.dataset.owner = state.ownerKey;
    $('.setup-project').textContent = state.project?.name || 'No local folder selected';
    $('.setup-project').title = state.project?.root || '';
    const swift = state.swiftLanguage || { phase: 'disconnected' }, swiftConnected = swift.phase === 'connected', swiftBusy = !!swift.busy;
    button('choose').hidden = !state.canChoose; button('choose').disabled = !!state.busy || swiftBusy || swiftConnected;
    button('discover').disabled = !state.project || !state.trusted || state.dirty || state.busy || swiftBusy || swiftConnected;
    button('discover').textContent = state.catalog || ['stale','failed','cancelled'].includes(state.phase) ? 'Rediscover project' : 'Discover project';
    button('cancel').hidden = !state.busy || !state.action; button('cancel').disabled = state.phase === 'cancelled';
    const catalog = state.trusted && state.catalog, destination = catalog?.destinations?.find(item => item.id === state.destinationId);
    const canRun = state.phase === 'ready' && !!destination && !state.busy && !swiftBusy && !state.dirty && state.trusted;
    button('build').disabled = !canRun; button('test').disabled = !canRun || !destination.testEligible;
    button('destination').disabled = !canRun || swiftConnected;
    button('swiftConnect').disabled = !canRun || swiftConnected;
    button('swiftConnect').hidden = swiftConnected || swiftBusy;
    button('swiftStop').hidden = !swiftConnected && !swiftBusy;
    button('swiftStop').disabled = swift.phase === 'stopping';
    button('swiftStop').textContent = swiftConnected ? 'Disconnect Swift' : swift.phase === 'stopping' ? 'Stopping…' : 'Cancel connection';
    $('.swift-status').textContent = ({ disconnected: 'Disconnected', preparing: 'Building context…', choosing: 'Choose target', connecting: 'Connecting…', connected: 'Connected', stopping: 'Stopping…', stale: 'Reconnect required', failed: 'Unavailable' })[swift.phase] || 'Disconnected';
    $('.swift-status').className = 'setup-badge swift-status' + (swiftConnected ? ' setup-available' : '');
    $('.xcode-swift').dataset.phase = swift.phase;
    $('.swift-description').textContent = swift.documents?.find(item => item.diagnosticState === 'unavailable')?.diagnosticReason || swift.reason || (swiftConnected ? `${swift.target.name} · ${swift.target.architecture}. Local completion, go to definition, hover, and diagnostics follow your unsaved Swift edits. Disconnect before changing build context.` : 'Build the selected scheme, then choose a Swift target for local completion, navigation, and diagnostics. Your files stay on this Mac.');
    const evidenceKey = JSON.stringify([state.trusted, swift.build?.id, swift.build?.status, swift.target, swift.settingsFingerprint]);
    if (evidenceKey !== lastSwiftEvidence) {
    lastSwiftEvidence = evidenceKey;
    const swiftEvidence = $('.swift-evidence'); swiftEvidence.replaceChildren();
    if (state.trusted && swift.build) {
      const details = node('details'); details.append(node('summary', 'Swift build context'));
      details.append(node('p', `Build: ${statusLabels[swift.build.status] || 'Not verified'}. ${swift.target ? `${swift.target.name} · ${swift.target.architecture}.` : ''}`, 'setup-muted'));
      if (swift.build.reason) details.append(node('p', swift.build.reason));
      if (swift.settingsFingerprint) details.append(node('p', `Settings: ${swift.settingsFingerprint}`, 'setup-muted'));
      const output = [swift.build.stdout, swift.build.stderr].filter(Boolean).join('\n');
      if (output) { const pre = node('pre', output.slice(-32768)); pre.tabIndex = 0; pre.setAttribute('aria-label', 'Swift context build output'); details.append(pre); }
      swiftEvidence.append(details);
    }
    }
    $('.setup-state').textContent = !state.trusted ? 'Trust this workspace before evaluating or building an Xcode project.' : state.reason || (state.dirty ? 'Save or revert project changes before continuing. Your drafts stay untouched.' : messages[state.phase]) || messages.idle;
    $('.setup-state').dataset.status = state.phase;
    if (swiftConnected && state.phase === 'stale') $('.setup-state').textContent = 'Build evidence is historical. Swift editing stays connected. Disconnect Swift, save changes, then rediscover before another build.';
    $('.xcode-selection').hidden = !catalog;
    const selection = $('.xcode-selection dl'); selection.replaceChildren();
    if (catalog) for (const [label, value] of [['Project', catalog.projectPath], ['Scheme', catalog.selectedScheme], ['Destination', destination?.label || 'Choose a destination']]) selection.append(node('dt', label), node('dd', value || 'Not selected'));
    $('.xcode-test-help').textContent = destination && !destination.testEligible ? 'This generic destination can compile the app. Choose an available Simulator to run tests.' : '';
    const results = $('.xcode-results'); results.replaceChildren();
    if (state.trusted) results.append(resultCard('build'), resultCard('test'));
    const tooling = $('.xcode-tooling'); tooling.replaceChildren();
    if (catalog) {
      if (!swiftConnected && !swiftBusy && catalog.languageTooling?.status !== 'available') tooling.append(node('p', catalog.languageTooling?.detail || 'Language tooling has not been checked.', 'setup-muted'));
      if (catalog.status !== 'complete' && catalog.diagnostic) {
        const details = node('details'); details.append(node('summary', 'Discovery output'));
        const pre = node('pre', [catalog.diagnostic.stdout, catalog.diagnostic.stderr].filter(Boolean).join('\n').slice(-32768));
        pre.tabIndex = 0; pre.setAttribute('aria-label', 'Discovery output'); details.append(pre); tooling.append(details);
      }
      if (catalog.limitations?.length) { const details = node('details'); details.append(node('summary', 'Discovery boundaries')); const list = node('ul'); for (const limitation of catalog.limitations) list.append(node('li', limitation)); details.append(list); tooling.append(details); }
    }
    if (focusedAction === 'swiftConnect' && button('swiftConnect').hidden && !button('swiftStop').disabled) button('swiftStop').focus();
    if (focusedAction === 'swiftStop' && button('swiftStop').hidden) { const next = !button('swiftConnect').disabled ? button('swiftConnect') : !button('discover').disabled ? button('discover') : null; next?.focus(); }
  }
  let activation;
  const begin = event => {
    if (event.type === 'keydown' && ![' ', 'Enter'].includes(event.key)) return;
    const target = event.target.closest('button[data-action]');
    if (target && !target.disabled) activation = { action: target.dataset.action, ownerKey: state.ownerKey };
  };
  root.addEventListener('pointerdown', begin); root.addEventListener('keydown', begin);
  root.addEventListener('click', event => {
    const target = event.target.closest('button[data-action]');
    if (!target || target.disabled || !state.ownerKey) return;
    const expected = activation; activation = undefined;
    if (expected && (expected.ownerKey !== state.ownerKey || expected.action !== target.dataset.action)) return;
    vscode.postMessage({ type: 'xcodeProject', action: target.dataset.action, viewId, ownerKey: state.ownerKey });
  });
  addEventListener('message', event => {
    const message = event.data;
    if (message?.type !== 'xcodeProjectState' || message.viewId !== viewId || typeof message.state?.ownerKey !== 'string') return;
    state = message.state; render();
  });
  render(); vscode.postMessage({ type: 'ready', viewId });
})();
