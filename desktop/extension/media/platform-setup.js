(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const viewId = crypto.randomUUID();
  let state = { phase: 'idle', ownerKey: '', project: null, trusted: false, busy: false };
  const root = document.getElementById('platform-setup-root');
  root.innerHTML = '<header class="setup-header"><div><p class="setup-eyebrow">Foundation</p><h1>Project Setup</h1><p class="setup-project"></p></div><button type="button" data-action="choose">Choose folder</button></header><section class="setup-overview" aria-labelledby="setup-summary"><div><h2 id="setup-summary">Check your development setup</h2><p class="setup-intro">Inspect saved project configuration and local tools. Checks do not install dependencies, run your app, or contact AI.</p></div><div class="setup-actions"><button class="setup-primary" type="button" data-action="check">Check setup</button><button type="button" data-action="cancel" hidden>Cancel</button></div></section><p class="setup-state" role="status" aria-live="polite"></p><div class="setup-results"></div><footer>Tool availability is separate from build, runtime, and source-mapping verification.</footer>';
  const project = root.querySelector('.setup-project'), choose = root.querySelector('[data-action="choose"]'), check = root.querySelector('[data-action="check"]'), cancel = root.querySelector('[data-action="cancel"]'), notice = root.querySelector('.setup-state'), results = root.querySelector('.setup-results');
  const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); if (className) node.className = className; return node; };
  const labels = { available: 'Available', missing: 'Missing', unavailable: 'Unavailable', unknown: 'Not determined', failed: 'Check failed', unverified: 'Not verified' };
  const kinds = { web: 'Web', swift: 'Swift', swiftui: 'SwiftUI', xcode: 'Xcode', expo: 'Expo', 'react-native': 'React Native' };
  function section(title, rows, render) {
    const section = element('section', undefined, 'setup-section');
    const heading = element('h2', title); section.append(heading);
    const list = element('ul', undefined, 'setup-list');
    for (const row of rows ?? []) { const li = element('li', undefined, 'setup-row'); render(row, li); list.append(li); }
    section.append(list); results.append(section);
  }
  function render() {
    root.dataset.phase = state.phase;
    root.dataset.owner = state.ownerKey;
    project.textContent = state.project?.name || 'No local folder selected';
    project.title = state.project?.root || '';
    choose.hidden = !state.canChoose;
    choose.disabled = state.busy;
    check.textContent = state.phase === 'checking' ? 'Checking…' : state.report || ['stale','failed','cancelled'].includes(state.phase) ? 'Recheck setup' : 'Check setup';
    check.disabled = !state.project || !state.trusted || state.busy || state.dirty;
    cancel.hidden = !state.busy;
    cancel.disabled = state.phase !== 'checking';
    const messages = { idle: state.project ? 'Ready when you are.' : 'Open a local project folder to check its setup.', checking: 'Checking saved configuration and local tools…', complete: 'Setup check complete. Review the results below.', cancelled: 'Setup check cancelled.', stale: 'These results are out of date. Check setup again.', unavailable: 'Setup checks are unavailable.', failed: 'Setup could not be checked.' };
    notice.textContent = !state.trusted ? 'Trust this workspace before checking local project files and tools.' : state.reason || messages[state.phase] || messages.idle;
    notice.dataset.status = state.phase;
    results.replaceChildren();
    const report = state.trusted && state.report;
    if (!report) return;
    const detected = element('section', undefined, 'setup-detected');
    detected.append(element('h2', 'Project'));
    detected.append(element('p', report.project?.kinds?.length ? report.project.kinds.map(kind => kinds[kind] || kind).join(' · ') : 'Project type not determined'));
    if (report.checkedAt) { const date = new Date(report.checkedAt); detected.append(element('p', 'Checked ' + (Number.isFinite(+date) ? date.toLocaleString() : report.checkedAt), 'setup-muted')); }
    for (const limitation of report.project?.limitations ?? []) detected.append(element('p', limitation, 'setup-muted'));
    if (report.project?.markers?.length) {
      const details = element('details'), summary = element('summary', 'Detected project files'), list = element('ul', undefined, 'setup-markers');
      for (const marker of report.project.markers) list.append(element('li', marker.path));
      details.append(summary, list); detected.append(details);
    }
    results.append(detected);
    section('Local tools and configuration', report.checks, (row, li) => {
      li.dataset.check = row.id;
      const title = element('div', undefined, 'setup-row-title'); title.append(element('h3', row.label), element('span', labels[row.status] || 'Not determined', 'setup-badge setup-' + row.status)); li.append(title);
      li.append(element('p', row.detail));
      if (row.version) li.append(element('p', row.version, 'setup-version'));
      if (row.recovery) { const help = element('p', undefined, 'setup-recovery'); help.append(element('strong', 'Next step: '), document.createTextNode(row.recovery)); li.append(help); }
    });
    section('Foundation capabilities', report.capabilities, (row, li) => {
      li.dataset.capability = row.id;
      const title = element('div', undefined, 'setup-row-title'); title.append(element('h3', row.label), element('span', labels[row.status] || 'Not verified', 'setup-badge setup-' + row.status)); li.append(title, element('p', row.detail));
    });
  }
  let activation;
  const beginActivation = event => {
    if (event.type === 'keydown' && ![' ', 'Enter'].includes(event.key)) return;
    const button = event.target.closest('button[data-action]');
    if (button && !button.disabled) activation = { action: button.dataset.action, ownerKey: state.ownerKey };
  };
  root.addEventListener('pointerdown', beginActivation);
  root.addEventListener('keydown', beginActivation);
  root.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled || !state.ownerKey) return;
    const action = button.dataset.action;
    const expected = activation; activation = undefined;
    if (expected && (expected.ownerKey !== state.ownerKey || expected.action !== action)) return;
    if (!['check','cancel','choose'].includes(action)) return;
    vscode.postMessage({ type: 'platformSetup', action, viewId, ownerKey: state.ownerKey });
  });
  addEventListener('message', event => {
    const message = event.data;
    if (message?.type !== 'platformSetupState' || message.viewId !== viewId || !message.state || typeof message.state.ownerKey !== 'string') return;
    state = message.state; render();
  });
  render();
  vscode.postMessage({ type: 'ready', viewId });
})();
