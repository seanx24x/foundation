/* Foundation AI artifact reference. All content and actions are local specimens. */
(() => {
  'use strict';
  const one = (selector, parent = document) => parent.querySelector(selector);
  const all = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const icon = name => `<i data-icon="${name}"></i>`;
  const families = [
    {id:'context', icon:'Layers', label:'Context', description:'What the model can see', title:'Context for this request', status:'Not sent', provenance:'From source', scope:'2 selected files', action:'Inspect context', prompt:'Use the Save button and its form as context.', answer:'The request has a bounded context. Available files and files actually sent are shown separately.', fields:['Available context and selected context','Exact source revision and exclusions','Provider-bound payload and size'], behavior:'Context selection does not send it. Show the actual payload at dispatch, including missing or excluded drafts.'},
    {id:'explanation', icon:'Link2', label:'Explanation', description:'A claim with its sources', title:'How saving works', status:'Answer ready', provenance:'AI interpretation', scope:'SaveButton', action:'Open supporting source', prompt:'What happens when I select Save?', answer:'The source example disables the button while saving and changes its label. Handler ownership and server behavior are outside this snapshot.', fields:['A concise claim, separate from evidence','Source citations with line ranges','Unknowns and source freshness'], behavior:'Keep interpretation distinct from observed behavior. Each cited claim opens the corresponding source snapshot.'},
    {id:'plan', icon:'CheckCheck', label:'Plan', description:'A reviewable approach', title:'Improve the Save behavior', status:'For review', provenance:'AI interpretation', scope:'1 component', action:'Review plan', prompt:'Plan the loading and error behavior before editing.', answer:'I would keep the input, prevent duplicate submissions, and add a clear recovery path. The plan is ready for review.', fields:['Goal, steps, and explicit scope','Assumptions, dependencies, and checks','Decision separate from execution'], behavior:'Accepting a plan approves the approach only. It does not authorize every future tool, apply code, or deploy.'},
    {id:'task', icon:'Terminal', label:'Task & tools', description:'What is happening now', title:'Prepare a scoped change', status:'Running example', provenance:'Observed', scope:'Isolated example run', action:'Stop example', prompt:'Prepare the change and show the work as it happens.', answer:'The task artifact keeps the current operation, completed steps, and any remaining work together.', fields:['Actual operation and bounded tool input','Queued, running, waiting, or stopped state','Partial output and cancellation outcome'], behavior:'Stop acknowledges immediately, then reports actual tool completion. Preserve partial output and unrelated user changes.'},
    {id:'changes', icon:'FileCode2', label:'Code changes', description:'A proposal before source', title:'Make saving resilient', status:'Proposed', provenance:'AI interpretation', scope:'1 file · 1 component', action:'Review changes', prompt:'Make saving feel immediate. Keep errors recoverable.', answer:'Here is a scoped proposal for SaveButton. Review the diff and its impact before anything becomes source.', fields:['Intent and affected files','Baseline revision and exact diff','Scope, review decision, and verification'], behavior:'Generated is not applied. A stale baseline blocks application. Applying, committing, and deploying are separate actions.'},
    {id:'preview', icon:'Scan', label:'Visual comparison', description:'Named states side by side', title:'SaveButton states', status:'Comparison ready', provenance:'AI interpretation', scope:'Default · Loading · Error', action:'Compare states', prompt:'Show how the Save button behaves in each state.', answer:'The comparison keeps the same component and viewport while changing one named state. These are rendered examples, not captured runtime evidence.', fields:['Before/after or named scenario','Theme, viewport, source revision','Capture type and unsupported coverage'], behavior:'A proposed rendering is not a verified screenshot. Name the scenario and keep preview appearance independent of the workspace theme.'},
    {id:'request', icon:'Network', label:'API evidence', description:'Where visibility ends', title:'Save profile request', status:'Captured example', provenance:'Observed', scope:'Browser request only', action:'Inspect request', prompt:'Show the request behind saving the profile.', answer:'The example request establishes the browser outcome. It does not establish what happened inside the server.', fields:['Request method, route, and session','Response, timing, and redaction state','Explicit boundary of instrumentation'], behavior:'Only instrumentation can produce observed requests. Redact sensitive fields and keep missing backend traces visibly unknown.'},
    {id:'verification', icon:'ShieldCheck', label:'Verification', description:'Evidence for each check', title:'Checks for this proposal', status:'Partial coverage', provenance:'Observed', scope:'3 separate checks', action:'View results', prompt:'How do we know this change works?', answer:'Compilation, interaction, and visual review have independent outcomes. A passing build cannot stand in for the other two.', fields:['Check type and named scenario','Actual outcome, log, and revision','Not-run and stale coverage'], behavior:'Show passed, failed, not run, and needs review separately. A suggested test is not a completed run.'},
    {id:'decision', icon:'CircleHelp', label:'Decision', description:'A bounded permission', title:'Run the project tests?', status:'Waiting for you', provenance:'AI interpretation', scope:'One command · Orbit', action:'Review request', prompt:'Check the change with the project test suite.', answer:'This example requests one named command in one project. The requested permission stays visible alongside the purpose and expected effects.', fields:['Exact requested action and target','Purpose, effects, and permission scope','Approve once, decline, and timeout'], behavior:'Approval applies to this request only. A chat response, accepted plan, or previous permission does not silently expand its scope.'},
    {id:'deliverable', icon:'PanelsTopLeft', label:'Deliverable', description:'Work worth keeping', title:'Save interaction specification', status:'Draft document', provenance:'AI interpretation', scope:'Project knowledge', action:'Open document', prompt:'Capture the agreed behavior as a reusable specification.', answer:'The deliverable preserves a structured outcome beyond the chat turn, linked to the component and the revision it describes.', fields:['Artifact type and durable identity','Title, revision, and source references','Open, revise, export, and supersession'], behavior:'Documents, tables, diagrams, and assets retain one identity when expanded. Exporting does not imply acceptance or publication.'}
  ];
  const stateByFamily = Object.fromEntries(families.map(family => [family.id, {view:'ready', collapsed:false, accepted:false, preview:'idle', format:'document', preserveComplete:false, declined:false}]));
  let selected = 'changes';
  let dialogTrigger = null;
  let dialogMode = 'detail';
  const host = one('#ai-artifact-host');
  const navigation = one('#ai-artifact-nav');
  const stateSelect = one('#ai-artifact-state');
  const dialog = one('#ai-artifact-dialog');
  if (!host || !navigation || !stateSelect || !dialog) return;
  const family = () => families.find(item => item.id === selected);
  const state = () => stateByFamily[selected];
  const identify = () => `orbit/save-feedback/${selected}@r42`;
  const isIncomplete = () => !state().preserveComplete && ['streaming','failed','cancelled'].includes(state().view);
  function statusLabel() {
    if (state().view === 'streaming') return 'Drafting example';
    if (state().view === 'failed') return 'Failed example';
    if (state().view === 'cancelled') return state().declined ? 'Declined · example' : 'Stopped example';
    if (state().accepted) return selected === 'decision' ? 'Approved · example' : 'Accepted · example';
    return family().status;
  }
  function statusIcon() {
    return state().view === 'failed' ? 'TriangleAlert' : state().view === 'cancelled' ? 'Minus' : state().accepted ? 'Check' : state().view === 'streaming' ? 'CircleDot' : 'CircleDot';
  }
  function stateBanner() {
    const messages = {
      streaming:['CircleDot','Incomplete example','Only the partial output below is available. No model is running.'],
      stale:['History','Source changed in this example','This artifact is tied to r42. The example workspace is now r43; review decisions are blocked.'],
      failed:['TriangleAlert','Example operation failed','The connection ended before completion. Partial output is preserved; nothing was applied.'],
      cancelled:['Minus','Example stopped','Partial output remains available. No source changed and no tool is still running.']
    };
    const message = state().declined ? ['Minus','Sample decision declined','The complete proposal stays available. No source changed and no command ran.'] : messages[state().view];
    return message ? `<div class="ai-artifact-banner" data-tone="${state().view}">${icon(message[0])}<div><strong>${message[1]}</strong><p>${message[2]}</p></div></div>` : '';
  }
  const files = () => `<div class="ai-file-list"><div class="ai-file-row">${icon('FileCode2')}<div><strong>SaveButton.tsx</strong><span>src/components · sample r42</span></div><span class="ai-small-label">Selected</span></div><div class="ai-file-row">${icon('FileCode2')}<div><strong>ProfileForm.tsx</strong><span>src/components · sample r42</span></div><span class="ai-small-label">Selected</span></div></div>`;
  const keyValues = entries => `<dl class="ai-key-values">${entries.map(([key,value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
  const diff = () => `<div class="ai-diff-heading"><span>${icon('FileCode2')}SaveButton.tsx</span><span class="ai-diff-count"><span class="success">+3</span><span class="error">−1</span></span></div><pre class="ai-diff" aria-label="Illustrative proposal: one removed line and three added lines"><code><span class="ai-diff-line removed">− &lt;button onClick={onSave}&gt;Save&lt;/button&gt;</span><span class="ai-diff-line added">+ &lt;button onClick={onSave} disabled={busy} aria-busy={busy}&gt;</span><span class="ai-diff-line added">+   {busy ? 'Saving…' : 'Save'}</span><span class="ai-diff-line added">+ &lt;/button&gt;</span></code></pre><p class="ai-body-note">Illustrative excerpt. Handler wiring and error recovery still require review in the full source.</p>`;
  const checks = () => `<div class="ai-check-list"><div class="ai-check-row"><span>${icon('Code2')}Compilation</span><span class="success">${icon('Check')}Passed · example</span></div><div class="ai-check-row"><span>${icon('MousePointer2')}Interaction</span><span>${icon('Minus')}Not run</span></div><div class="ai-check-row"><span>${icon('Scan')}Visual</span><span>${icon('Eye')}Needs review</span></div></div>`;
  const plan = () => `<ol class="ai-plan"><li class="ai-plan-step"><span class="ai-step-number">1</span><div><strong>Keep the input</strong><p>Preserve entered values through loading and failure.</p></div></li><li class="ai-plan-step"><span class="ai-step-number">2</span><div><strong>Make progress clear</strong><p>Prevent duplicate saves and announce the busy state.</p></div></li><li class="ai-plan-step"><span class="ai-step-number">3</span><div><strong>Verify recovery</strong><p>Check default, loading, and retry with the same data.</p></div></li></ol>`;
  function visualButton(variant) {
    const labels = {idle:'Save changes', saving:'Saving…', error:'Try again'};
    return `<span class="ai-example-button" data-visual-state="${variant}">${variant === 'saving' ? icon('CircleDot') : variant === 'error' ? icon('RotateCcw') : ''}${labels[variant]}</span>`;
  }
  function preview(expanded) {
    if (expanded) return `<div class="ai-state-comparison">${[['idle','Default'],['saving','Loading'],['error','Error']].map(([key,label]) => `<div class="ai-preview-surface" data-theme="light"><span class="ai-small-label">${label}</span>${visualButton(key)}<span class="ai-small-label">${key === 'saving' ? 'Disabled · aria-busy' : key === 'error' ? 'Input preserved' : 'Ready for input'}</span></div>`).join('')}</div><p class="ai-body-note">Rendered illustrations · Light appearance · adaptive reference pane. No runtime capture or visual test is attached.</p>`;
    return `<div class="ai-preview-tabs" role="group" aria-label="Illustrative preview state">${[['idle','Default'],['saving','Loading'],['error','Error']].map(([key,label]) => `<button type="button" class="control ${state().preview === key ? 'active' : ''}" data-ai-preview="${key}" aria-pressed="${state().preview === key}">${label}</button>`).join('')}</div><div class="ai-preview-surface" data-theme="light">${visualButton(state().preview)}</div><p class="ai-body-note">Rendered example, not a captured result.</p>`;
  }
  const request = expanded => `${keyValues([['Method','POST /profile'],['Browser outcome','200 · example response'],['Timing','148ms · example timing'],['Session','sample-session-07']])}${expanded ? `<pre class="ai-command"><code>${escape('Request body\n{ "name": "[redacted]", "role": "[redacted]" }\n\nResponse body\n{ "saved": true }')}</code></pre>` : ''}<div class="ai-boundary">${icon('CircleHelp')}<span>Backend execution is unknown.</span></div>`;
  function documentPreview(expanded) {
    const tabs = `<div class="ai-deliverable-tabs" role="group" aria-label="Deliverable format">${[['document','Doc'],['diagram','Diagram'],['table','Table']].map(([value,label]) => `<button type="button" class="control ${state().format === value ? 'active' : ''}" data-ai-format="${value}" aria-pressed="${state().format === value}">${label}</button>`).join('')}</div>`;
    const table = `<table><caption class="sr-only">Illustrative save behavior specification</caption><thead><tr><th>State</th><th>Action</th><th>Input</th></tr></thead><tbody><tr><td>Default</td><td>Save</td><td>Editable</td></tr><tr><td>Loading</td><td>Disabled</td><td>Preserved</td></tr><tr><td>Error</td><td>Try again</td><td>Preserved</td></tr></tbody></table>`;
    const document = `<div class="ai-document-preview"><div class="ai-document-title">Save interaction</div><p>Keep the current input until the outcome is known. Make the pending state clear and provide a recovery action.</p><h4>Acceptance criteria</h4><ul><li>Repeated activation cannot submit twice while saving.</li><li>A failure retains the user’s input.</li><li>Busy and error states are announced accessibly.</li>${expanded ? '<li>Reduced motion does not hide progress.</li>' : ''}</ul></div>`;
    const diagram = `<div class="ai-flow-diagram" role="img" aria-label="Illustrative state diagram: Ready proceeds to Saving, then either Saved or Error. Error allows retry with input preserved."><div class="ai-flow-node">Ready</div><span aria-hidden="true">↓</span><div class="ai-flow-node current">Saving</div><span aria-hidden="true">↓</span><div class="ai-flow-branches"><div class="ai-flow-node">Saved</div><div class="ai-flow-node">Error → Retry</div></div><p>Input stays intact on failure.</p></div>`;
    const contents = state().format === 'diagram' ? diagram : state().format === 'table' ? `<div class="ai-document-preview">${table}</div>` : document;
    return `${tabs}${contents}<p class="ai-body-note">One artifact, three example views. This is structured sample content, not executable generated HTML.</p>`;
  }

  function body(expanded = false) {
    if (isIncomplete()) {
      const partial = {
        context:'The SaveButton snapshot is selected. The remaining context and provider-bound payload are incomplete; nothing was sent.',
        explanation:'The selected button exposes a busy state. Its relationship to the form and server has not yet been fully explained.',
        plan:'The first proposed step is to preserve the current input. The remaining plan and checks are incomplete.',
        task:'The selected source snapshot is available. The handler inspection stopped before a proposal was prepared.',
        changes:'The SaveButton target is identified. No complete, applicable patch has been produced.',
        preview:'The default state is sketched. Loading, error, theme, and viewport coverage remain incomplete.',
        request:'Example request metadata is available. The response and backend trace are incomplete.',
        verification:'One example check has partial output. The remaining checks have no completed results.',
        decision:'The proposed command is identified. Its permission scope and impact review are incomplete; approval is unavailable.',
        deliverable:'The opening behavior note is drafted. The remaining specification and acceptance criteria are incomplete.'
      };
      return `<div class="ai-partial-output"><span class="ai-small-label">Preserved partial output</span><p>${partial[selected]}</p><div class="ai-inline-source">${icon('FileCode2')}SaveButton.tsx · sample r42</div><p class="ai-body-note">Incomplete example. No source edit or permission decision can be applied.</p></div>`;
    }
    switch (selected) {
      case 'context': return `${files()}${keyValues([['Available','8 project files · example'],['Selected','2 saved-source snapshots'],['Sent to provider','Nothing sent'],['Excluded','Unsaved draft and environment values']])}${expanded ? '<p class="ai-body-note">The production artifact must show the exact provider-bound payload separately from this selection. This specimen has no provider or project connection.</p>' : ''}`;
      case 'explanation': return `<p class="ai-explanation-claim">The button derives its busy state from <code>state</code>, disables activation, and displays “Saving…”.</p>${expanded ? `<div class="ai-inline-source">${icon('FileCode2')}SaveButton.tsx · lines 1–12</div>` : `<button class="ai-source-link" type="button" data-ai-action="detail">${icon('FileCode2')}SaveButton.tsx · lines 1–12${icon('ArrowUpRight')}</button>`}${expanded ? `<pre class="ai-command"><code>${escape("const busy = state === 'saving';\nreturn <button disabled={busy}>\n  {busy ? 'Saving…' : 'Save'}\n</button>;")}</code></pre>` : ''}<div class="ai-boundary">${icon('CircleHelp')}<span>This excerpt does not establish handler ownership or the server outcome.</span></div>`;
      case 'plan': return `${plan()}<div class="ai-boundary">${icon('ShieldCheck')}<span>No source edit is included in accepting this plan.</span></div>`;
      case 'task': return `<div class="ai-timeline"><div class="ai-timeline-row complete">${icon('Check')}<div><strong>Context selected</strong><span>2 source snapshots · sample r42</span></div></div><div class="ai-timeline-row current">${icon('CircleDot')}<div><strong>Inspect the save handler</strong><span>Current operation · example only</span></div></div><div class="ai-timeline-row">${icon('Minus')}<div><strong>Prepare a proposal</strong><span>Not started</span></div></div></div>${expanded ? '<p class="ai-body-note">A production run includes exact tool inputs, outputs, permission boundaries, and cancellation acknowledgements. This example does not execute tools.</p>' : ''}`;
      case 'changes': return `${diff()}${expanded ? `<h4 class="ai-detail-heading">Proposed scope</h4>${keyValues([['Target','src/components/SaveButton.tsx'],['Baseline','Sample revision r42'],['Consumers','All instances of SaveButton'],['Application','Blocked: no project attached']])}<h4 class="ai-detail-heading">Verification</h4>${checks()}` : ''}`;
      case 'preview': return preview(expanded);
      case 'request': return request(expanded);
      case 'verification': return `${checks()}${expanded ? `${keyValues([['Source','Sample revision r42'],['Scenario','SaveButton · desktop · light'],['Run identity','example-run-03'],['Coverage gap','Error recovery has not been exercised']])}<pre class="ai-command"><code>${escape('Illustrative compiler output\nCompilation completed without errors.\n\nNo actual compiler or test was run by this reference.')}</code></pre>` : '<p class="ai-body-note">Sample outcomes. No checks were run by this reference.</p>'}`;
      case 'decision': return `<pre class="ai-command"><code>npm test -- --run</code></pre>${keyValues([['Working directory','Orbit project root'],['Purpose','Check the proposed Save behavior'],['Permission','One execution only']])}<p class="ai-body-note">A real project script may execute code and create output files. Inspect the script before granting permission.</p>${expanded ? '<div class="ai-boundary">' + icon('ShieldCheck') + '<span>This reference can only record a sample decision. It cannot run a command.</span></div>' : ''}`;
      case 'deliverable': return documentPreview(expanded);
      default: return '';
    }
  }
  function primaryAction() {
    if (state().view === 'streaming') return ['stop','Stop example','secondary'];
    if (state().view === 'stale') return ['refresh','Refresh sample','secondary'];
    if (state().view === 'failed') return ['refresh','Retry sample','secondary'];
    if (state().view === 'cancelled') return ['refresh','Restart sample','secondary'];
    if (state().accepted) return ['detail','View decision','secondary'];
    return ['primary',family().action, selected === 'task' ? 'secondary' : 'primary'];
  }
  function meta(expanded = false) {
    return `<div class="ai-artifact-meta"><span>${icon(family().provenance === 'Observed' ? 'Eye' : family().provenance === 'From source' ? 'Code2' : 'Sparkles')}${family().provenance}</span><span class="ai-freshness ${state().view === 'stale' ? 'warning' : ''}">${icon(state().view === 'stale' ? 'History' : 'GitBranch')}${state().view === 'stale' ? 'Stale · r42' : 'Sample r42'}</span>${expanded ? `<code class="ai-artifact-id">${identify()}</code>` : ''}</div>`;
  }
  let awaitingFirstReveal = true;
  function threadPosition() {
    const element = one('.ai-chat-thread');
    if (!element) return null;
    return {
      element,
      top: element.scrollTop,
      following: element.scrollHeight - element.clientHeight - element.scrollTop <= 24
    };
  }
  function restoreThreadPosition(position, revealLatest = false) {
    if (!position) return;
    const {element, top, following} = position;
    if (revealLatest || following) element.scrollTop = element.scrollHeight;
    else element.scrollTop = top;
    if (revealLatest && element.clientHeight > 0) awaitingFirstReveal = false;
  }
  function renderCard({position = threadPosition(), revealLatest = false} = {}) {
    const item = family(), current = state(), action = primaryAction();
    host.innerHTML = `<article class="ai-artifact" data-family="${selected}" data-state="${current.view}" aria-labelledby="ai-current-artifact-title"><header class="ai-artifact-header"><button type="button" class="ai-artifact-toggle" data-ai-action="collapse" aria-expanded="${!current.collapsed}" aria-controls="ai-current-artifact-body" aria-label="${current.collapsed ? 'Expand' : 'Collapse'} ${item.label} artifact">${icon(item.icon)}<span class="ai-artifact-heading"><span class="ai-artifact-kind">${item.label}<span class="ai-specimen-label">Specimen</span></span><strong class="ai-artifact-title" id="ai-current-artifact-title">${item.title}</strong></span>${icon('ChevronDown')}</button><button type="button" class="icon-control ai-expand" data-ai-action="detail" aria-label="Expand ${item.label} into a larger view" title="Expand artifact">${icon('PanelsTopLeft')}</button></header><div class="ai-artifact-statusline"><span class="ai-status" data-state="${current.view}">${icon(statusIcon())}${statusLabel()}</span><span class="ai-artifact-scope">${item.scope}</span></div>${meta()}${stateBanner()}<div class="ai-artifact-body" id="ai-current-artifact-body" ${current.collapsed ? 'hidden' : ''}>${body()}</div><footer class="ai-artifact-footer"><button type="button" class="${action[2]}" data-ai-action="${action[0]}">${action[1]}${icon(action[0] === 'stop' ? 'Minus' : action[0] === 'refresh' ? 'RotateCcw' : 'ArrowRight')}</button><span class="ai-source-safety">${icon('ShieldCheck')}Source unchanged</span></footer></article>`;
    icons(host);
    restoreThreadPosition(position, revealLatest);
  }
  function renderGuidance() {
    const item = family();
    one('#ai-artifact-guidance').innerHTML = `<div class="ai-guidance-heading"><span class="ai-small-label">Component contract</span><h2>${item.label}</h2><p>${item.description}.</p></div><h3>Required anatomy</h3><ol class="ai-guidance-list">${item.fields.map(field => `<li>${field}</li>`).join('')}</ol><h3>Behavior</h3><p class="ai-guidance-note">${item.behavior}</p><h3>State model</h3><dl class="ai-key-values"><div><dt>Lifecycle</dt><dd>${statusLabel()}</dd></div><div><dt>Provenance</dt><dd>${item.provenance}</dd></div><div><dt>Freshness</dt><dd>${state().view === 'stale' ? 'Stale' : 'Example baseline'}</dd></div><div><dt>Source effect</dt><dd>None</dd></div></dl><div class="ai-guidance-note ai-guidance-footnote">Expand preserves the same artifact identity and revision. These examples do not connect to a model, run tools, or write source.</div>`;
    icons(one('#ai-artifact-guidance'));
  }
  function render(revealLatest = false) {
    const position = threadPosition();
    const item = family();
    one('#ai-sample-prompt').textContent = item.prompt;
    one('#ai-sample-answer').textContent = item.answer;
    if (one('#ai-family-name')) one('#ai-family-name').textContent = item.label;
    stateSelect.value = state().view;
    all('[data-ai-family]', navigation).forEach(button => {
      const active = button.dataset.aiFamily === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderCard({position, revealLatest}); renderGuidance();
  }
  function resetSample() {
    state().view = 'ready'; state().accepted = false; state().preserveComplete = false; state().declined = false;
    render();
    one('[data-ai-action]', host)?.focus({preventScroll:true});
    announce('Example reset to its initial state. No context was refreshed, no tool ran, and no source changed.');
  }
  function stopExample() {
    state().view = 'cancelled'; state().accepted = false; state().preserveComplete = false; state().declined = false;
    render();
    one('[data-ai-action="refresh"]', host)?.focus({preventScroll:true});
    announce('Example stopped. Partial output is preserved. No real tool or model was running.');
  }
  function dialogActions() {
    if (state().view === 'streaming') return `<button type="button" class="secondary" data-ai-action="stop-dialog">Stop example</button>`;
    if (state().view === 'stale') return `<button type="button" class="secondary" data-ai-action="refresh-dialog">Refresh sample</button><button type="button" class="primary" disabled>Decision blocked: stale source</button>`;
    if (isIncomplete()) return `<button type="button" class="secondary" data-ai-action="refresh-dialog">${state().view === 'failed' ? 'Retry sample' : 'Restart sample'}</button>`;
    if ((selected === 'plan' || selected === 'decision') && !state().accepted && state().view === 'ready') return `<button type="button" class="secondary" data-ai-action="decline">Decline sample</button><button type="button" class="primary" data-ai-action="accept">${selected === 'plan' ? 'Accept sample plan' : 'Approve sample once'}</button>`;
    if (selected === 'changes') return `<span class="ai-dialog-action-note">No project attached</span><button type="button" class="primary" disabled title="This reference cannot apply changes to source">Apply to source</button>`;
    return `<button type="button" class="secondary" data-ai-action="close">Done</button>`;
  }
  function openDetail(trigger, mode = 'detail') {
    dialogTrigger = trigger || document.activeElement;
    dialogMode = mode;
    dialog.innerHTML = `<div class="dialog-heading"><div><span class="dialog-kicker">${family().label} · illustrative artifact</span><h2 id="ai-artifact-dialog-title">${family().title}</h2></div><button type="button" class="icon-control" data-ai-action="close" aria-label="Close artifact">${icon('X')}</button></div><div class="ai-artifact-statusline"><span class="ai-status" data-state="${state().view}">${icon(statusIcon())}${statusLabel()}</span><span>${family().scope}</span></div>${meta(true)}<div class="ai-dialog-content">${stateBanner()}${state().accepted ? `<div class="ai-decision-result">${icon('Check')}<span>${selected === 'decision' ? 'Sample approval recorded. No command was executed.' : 'Sample plan accepted. No implementation was started.'}</span></div>` : ''}${body(true)}</div><div class="dialog-actions">${dialogActions()}</div>`;
    dialog.setAttribute('aria-labelledby', 'ai-artifact-dialog-title');
    icons(dialog);
    if (!dialog.open) dialog.showModal();
    one('[data-ai-action="close"]', dialog)?.focus();
  }
  function closeDetail() { dialog.close(); }
  function handleAction(action, trigger, inDialog) {
    if (action === 'close') { closeDetail(); return; }
    if (action === 'collapse') {
      state().collapsed = !state().collapsed; renderCard();
      one('.ai-artifact-toggle', host).focus({preventScroll:true}); return;
    }
    if (action === 'detail') { openDetail(trigger); return; }
    if (action === 'refresh' || action === 'refresh-dialog') {
      if (inDialog) closeDetail(); resetSample(); return;
    }
    if (action === 'stop' || action === 'stop-dialog') {
      if (inDialog) closeDetail(); stopExample(); return;
    }
    if (action === 'accept') {
      if (state().view !== 'ready' || !['plan','decision'].includes(selected)) return;
      state().accepted = true; render(); closeDetail();
      announce(selected === 'decision' ? 'Sample approval recorded. No command was executed.' : 'Sample plan accepted. No implementation was started.'); return;
    }
    if (action === 'decline') {
      state().view = 'cancelled'; state().accepted = false; state().preserveComplete = true; state().declined = true; render(); closeDetail();
      announce('Sample decision declined. No source changed and no command ran.'); return;
    }
    if (action === 'primary') {
      if (selected === 'task') stopExample();
      else openDetail(trigger, 'review');
    }
  }
  host.addEventListener('click', event => {
    const formatButton = event.target.closest('[data-ai-format]');
    if (formatButton) {
      state().format = formatButton.dataset.aiFormat; renderCard();
      one(`[data-ai-format="${state().format}"]`, host)?.focus({preventScroll:true});
      announce('Deliverable ' + state().format + ' view. Artifact identity unchanged.'); return;
    }
    const previewButton = event.target.closest('[data-ai-preview]');
    if (previewButton) {
      state().preview = previewButton.dataset.aiPreview;
      renderCard();
      one(`[data-ai-preview="${state().preview}"]`, host)?.focus({preventScroll:true});
      announce('Illustrative ' + state().preview + ' state. No runtime interaction occurred.');
      return;
    }
    const action = event.target.closest('[data-ai-action]');
    if (action) handleAction(action.dataset.aiAction, action, false);
  });
  dialog.addEventListener('click', event => {
    const formatButton = event.target.closest('[data-ai-format]');
    if (formatButton) {
      state().format = formatButton.dataset.aiFormat; renderCard();
      const originalTrigger = dialogTrigger; openDetail(originalTrigger, dialogMode);
      one(`[data-ai-format="${state().format}"]`, dialog)?.focus({preventScroll:true});
      announce('Deliverable ' + state().format + ' view. Artifact identity unchanged.'); return;
    }
    const action = event.target.closest('[data-ai-action]');
    if (action) handleAction(action.dataset.aiAction, action, true);
  });
  dialog.addEventListener('close', () => {
    const validTrigger = dialogTrigger?.isConnected && dialogTrigger.getClientRects().length ? dialogTrigger : one('.ai-artifact-footer button', host);
    validTrigger?.focus({preventScroll:true});
  });
  stateSelect.addEventListener('change', event => {
    state().view = event.target.value;
    state().accepted = false; state().preserveComplete = false; state().declined = false;
    render();
    announce(family().label + ', ' + event.target.options[event.target.selectedIndex].text + ' example. No model or project connected.');
  });
  navigation.innerHTML = families.map(item => `<button type="button" class="ai-family-button" data-ai-family="${item.id}" aria-pressed="false">${icon(item.icon)}<span><span class="ai-family-label">${item.label}</span><span class="ai-family-description">${item.description}</span></span></button>`).join('');
  icons(navigation);
  navigation.addEventListener('click', event => {
    const button = event.target.closest('[data-ai-family]');
    if (!button) return;
    selected = button.dataset.aiFamily;
    render(true);
    announce(family().label + ' artifact specimen selected.');
  });
  window.FoundationArtifactReference = Object.freeze({
    families: Object.freeze(families.map(item => Object.freeze({id:item.id, label:item.label, scope:item.scope}))),
    getSelection: () => Object.freeze({family:selected, state:state().view, artifactId:identify(), format:state().format})
  });
  // The Components page can initially be hidden. Reveal its first artifact once
  // it has a real viewport, without changing keyboard focus or later user scroll.
  const thread = one('.ai-chat-thread');
  if (thread) new ResizeObserver(() => {
    if (awaitingFirstReveal && thread.clientHeight > 0) {
      thread.scrollTop = thread.scrollHeight;
      awaitingFirstReveal = false;
    }
  }).observe(thread);
  render(true);
})();
