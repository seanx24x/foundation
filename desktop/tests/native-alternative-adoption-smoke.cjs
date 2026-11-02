const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const hash = value => createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, label, timeout = 45000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await pause(100); }
  throw Error(`Timed out: ${label}`);
};
let inspect;

async function run() {
  const stage = process.env.FOUNDATION_VERIFICATION_STAGE;
  const workspace = process.env.FOUNDATION_VERIFICATION_WORKSPACE;
  const reportPath = process.env.FOUNDATION_VERIFICATION_REPORT;
  assert.ok(['write', 'restore'].includes(stage));
  const extension = vscode.extensions.getExtension('foundation.foundation-workspace');
  assert.ok(extension);
  assert.equal(await fs.realpath(extension.extensionPath), process.env.FOUNDATION_VERIFICATION_EXTENSION);
  await extension.activate();
  await vscode.commands.executeCommand('foundation.refresh');
  inspect = () => extension.exports.inspect();
  assert.ok(process.versions.electron);
  assert.ok((await fs.realpath(process.execPath)).startsWith(process.env.FOUNDATION_VERIFICATION_APP + '/Contents/'));
  assert.equal(inspect().project.root, workspace);
  assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('baseUrl'), '');
  assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('model'), '');
  assert.deepEqual(vscode.workspace.getConfiguration('foundation.ai').get('profiles'), {});
  assert.ok(Object.keys(process.env).every(key => !/^FOUNDATION_AI_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(key)));
  let index = 0;
  const ui = async command => {
    const id = ++index, ipc = process.env.FOUNDATION_VERIFICATION_IPC;
    await fs.writeFile(path.join(ipc, `command-${id}.json`), JSON.stringify(command));
    const result = await wait(async () => {
      try { return JSON.parse(await fs.readFile(path.join(ipc, `result-${id}.json`), 'utf8')); } catch {}
    }, `native ${command.type}`, id === 1 && process.env.FOUNDATION_VERIFICATION_FOCUS_GATE === '1' ? 210000 : 60000);
    assert.equal(result.passed, true, result.error);
    return result.renderer;
  };
  const paths = ['src/App.tsx', 'src/TokenPreview.tsx', 'src/style.css'];
  const sourcePaths = [...paths, 'src/UnrelatedDraft.ts'];
  const cssPath = path.join(workspace, 'src/style.css');
  const draftPath = path.join(workspace, 'src/UnrelatedDraft.ts');
  const originalCSS = await fs.readFile(cssPath, 'utf8');
  const originalDraft = await fs.readFile(draftPath, 'utf8');
  const sourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async file => [file, hash(await fs.readFile(path.join(workspace, file)))])));
  const initialHashes = await sourceHashes();
  const proposal = () => inspect().proposal;
  const state = () => inspect().runtimeWorkspace;
  const alternatives = () => inspect().visualAlternatives;
  const action = (name, fields = {}) => vscode.commands.executeCommand('foundation.runtimeWorkspace', {
    action: name, projectId: inspect().project.id, expectedRevision: state().revision, ...fields,
  });
  const pairScope = '[aria-label="Selected alternative comparison"]';
  const sideScope = name => `${pairScope} [aria-label=${JSON.stringify(name + ' evidence')}]`;
  const assertNoOriginalEvidence = () => {
    assert.equal(state().runs.length, 0);
    assert.equal(inspect().runtimeCaptures.captures.length, 0);
    assert.equal(inspect().conversations.conversations.length, 0);
  };
  const assertComparison = (renderer, left, right, loaded) => {
    assert.equal(renderer.firstResult, left.id);
    assert.equal(renderer.secondResult, right.id);
    assert.equal(renderer.comparison?.leftId, left.id);
    assert.equal(renderer.comparison?.rightId, right.id);
    assert.match(renderer.comparison.text, /Soft corners and Pill corners/);
    assert.equal(renderer.canvas, false);
    assert.equal(renderer.images.length, 2);
    for (const [offset, record] of [left, right].entries()) {
      const image = renderer.images[offset];
      assert.equal(image.label, record.candidate.name + ' pixel capture');
      if (loaded) {
        const capture = record.variants.find(value => value.id === 'alternative').outcome.capture;
        assert.equal(image.status, 'ready');
        assert.equal(image.sha256, capture.image.sha256, 'Displayed pixels are the exact proposed-side capture');
        assert.equal(image.width, capture.image.widthPx);
        assert.equal(image.height, capture.image.heightPx);
      } else {
        assert.equal(image.status, 'not-loaded', 'Restart must not automatically request image bytes');
        assert.equal(image.width, 0);
        assert.equal(image.sha256, null);
      }
    }
  };

  if (stage === 'restore') {
    const previous = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.notEqual(process.pid, previous.writeProcessId);
    assert.equal(inspect().runtime.status, 'idle');
    assert.equal(alternatives().busy, false);
    assert.equal(alternatives().operation, null);
    assert.equal(alternatives().records.length, 2);
    for (const record of previous.records) assert.deepEqual(alternatives().records.find(value => value.id === record.id), record);
    assert.deepEqual(await sourceHashes(), previous.sourceHashes);
    const draft = await vscode.workspace.openTextDocument(vscode.Uri.file(draftPath));
    await wait(() => draft.isDirty, 'restored unrelated draft');
    assert.equal(draft.getText(), previous.draftText);
    assert.equal(await fs.readFile(draftPath, 'utf8'), originalDraft);
    const proposalBefore = structuredClone(proposal());
    await vscode.commands.executeCommand('foundation.review');
    const [left, right] = previous.records;
    const restoredBeforeImages = await ui({ type: 'comparison', leftId: left.id, rightId: right.id });
    assertComparison(restoredBeforeImages, left, right, false);
    assert.match(restoredBeforeImages.text, /Soft corners · Finished/);
    assert.match(restoredBeforeImages.text, /Pill corners · Finished/);
    assert.deepEqual(proposal(), proposalBefore, 'Restoring comparison does not stage or apply a proposal');
    assertNoOriginalEvidence();
    await ui({ type: 'namedButton', label: 'Show captures', scope: pairScope });
    const renderer = await ui({ type: 'alternativeImages' });
    assertComparison(renderer, left, right, true);
    await ui({ type: 'screenshot', name: 'restored-alternatives' });
    assert.equal(inspect().runtime.status, 'idle');
    assert.equal(alternatives().busy, false);
    for (const record of previous.records) assert.deepEqual(alternatives().records.find(value => value.id === record.id), record);
    assert.deepEqual(await sourceHashes(), previous.sourceHashes);
    assert.equal(draft.getText(), previous.draftText);
    assertNoOriginalEvidence();
    await fs.writeFile(reportPath, JSON.stringify({ ...previous, restoreProcessId: process.pid, restoredInSecondProcess: true,
      restoredDraftPreserved: true, restoredBeforeImages, restoredRenderer: renderer, restoreRuntimeStatus: 'idle',
      restoreNoAutomaticActions: true }));
    return;
  }

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const feature = await vscode.commands.executeCommand('foundation.newFeature', {
    title: 'Profile saving', brief: 'Compare named corner alternatives under the same saved scenario, then review one source change.',
    paths, entryPath: 'src/TokenPreview.tsx',
  });
  await action('createScreen', { input: { title: 'Profile', targetId: 'vite:dev', route: '/' } });
  const screen = state().screens.find(value => value.featureId === feature.activeId);
  assert.ok(screen);
  await action('createScenario', { input: { screenId: screen.id, title: 'Save profile successfully',
    steps: ['Save the profile.'], expectedOutcome: 'The service acknowledges the save and the profile reports success.' } });
  const scenario = state().scenarios.at(-1);
  await action('select', { screenId: screen.id, scenarioId: scenario.id });
  await action('openScreen', { screenId: screen.id });
  await vscode.commands.executeCommand('foundation.refine');
  await ui({ type: 'prepareCanvas' });
  await wait(() => inspect().runtime.pageConnected && inspect().runtime.replayCatalog?.recipes.some(value => value.id === 'profile-success'), 'original authenticated recipe catalog');
  const originalSession = inspect().runtime.session;
  const draft = await vscode.workspace.openTextDocument(vscode.Uri.file(draftPath));
  const draftEdit = new vscode.WorkspaceEdit();
  draftEdit.insert(draft.uri, new vscode.Position(0, 0), '// Unrelated unsaved adoption verification draft.\n');
  assert.equal(await vscode.workspace.applyEdit(draftEdit), true);
  const draftText = draft.getText();
  const assertPreserved = async () => {
    assert.equal(draft.isDirty, true);
    assert.equal(draft.getText(), draftText);
    assert.equal(await fs.readFile(draftPath, 'utf8'), originalDraft);
  };
  const prepareProposal = async value => {
    await vscode.commands.executeCommand('foundation.startDesignPreview', 'src/TokenPreview.tsx');
    await vscode.commands.executeCommand('foundation.refine');
    await wait(() => inspect().design.status === 'ready' && !inspect().design.stale, 'saved source preview');
    await ui({ type: 'select', label: 'Preview source', value: 'sandbox' });
    const token = inspect().design.tokens.find(value => value.name === '--orbit-radius' && value.occurrence === 0);
    assert.ok(token);
    await ui({ type: 'selectToken', id: token.id });
    await ui({ type: 'analyze', kind: 'token' });
    await wait(() => inspect().designImpact?.status === 'ready', 'exact token preflight');
    await ui({ type: 'editToken', name: token.name, value });
    await ui({ type: 'propose' });
    return wait(() => proposal()?.status === 'proposed' && proposal(), 'reviewable token change');
  };
  const prepareAndRun = async (name, value) => {
    const proposed = await prepareProposal(value);
    assert.equal(proposed.before, originalCSS);
    assert.equal(proposed.after, originalCSS.replace('--orbit-radius:8px', '--orbit-radius:' + value));
    const previousIds = alternatives().records.map(record => record.id);
    await ui({ type: 'alternatives' });
    await ui({ type: 'fill', label: 'Alternative name', value: name });
    await ui({ type: 'select', label: 'Comparison scenario', value: scenario.id });
    await ui({ type: 'select', label: 'Comparison recipe', value: 'profile-success' });
    await ui({ type: 'select', label: 'Comparison width', value: '768' });
    await ui({ type: 'select', label: 'Comparison theme', value: 'dark' });
    await ui({ type: 'select', label: 'Comparison motion', value: 'reduce' });
    await ui({ type: 'alternativeCapture' });
    await ui({ type: 'namedButton', label: 'Prepare comparison' });
    let record = await wait(() => alternatives().records.find(record => !previousIds.includes(record.id) && record.status === 'ready'), 'named saved copies', 120000);
    assert.equal(record.candidate.name, name);
    assert.deepEqual(record.candidate.token, { name: '--orbit-radius', occurrence: 0 });
    assert.match(record.candidate.metadataDigest, /^[a-f0-9]{64}$/);
    assert.equal(record.captureEach, true);
    assert.equal(record.beforeHash, hash(originalCSS));
    assert.equal(record.afterHash, hash(proposed.after));
    assert.ok(record.variants.every(value => value.status === 'not-run' && !value.runId));
    assert.equal(alternatives().reviewChoices.find(value => value.id === record.id).canReview, false, 'Prepared-only candidate cannot be reviewed');
    assert.equal(inspect().runtime.session, originalSession);
    assert.deepEqual(await sourceHashes(), initialHashes);
    assertNoOriginalEvidence();
    await ui({ type: 'alternatives', details: name + ' · Ready to run' });
    await ui({ type: 'namedButton', label: 'Run comparison', scope: `[data-alternative-record="${record.id}"]` });
    await wait(() => {
      const current = alternatives().records.find(value => value.id === record.id);
      if (current && ['failed', 'cancelled', 'interrupted'].includes(current.status)) throw Error('Comparison ended ' + JSON.stringify(current));
      return current?.status === 'completed' && !alternatives().busy;
    }, 'both actual isolated runtime sides for ' + name, 360000);
    record = alternatives().records.find(value => value.id === record.id);
    assert.equal(record.variants.length, 2);
    for (const side of record.variants) {
      assert.equal(side.status, 'completed');
      assert.equal(side.outcome.replay.status, 'completed');
      assert.equal(side.outcome.observation.status, 'completed');
      assert.equal(side.outcome.observation.assessment, 'not-assessed');
      assert.equal(side.outcome.compilation, 'not-recorded');
      assert.equal(side.outcome.sourceRelationship, 'unverified');
      assert.ok(side.outcome.observation.observations.some(value => value.status === 200 && value.url.endsWith('/api/fixture/success')));
      assert.match(side.outcome.capture.image.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Math.abs(side.outcome.capture.conditions.viewportWidthCss - 768) <= 1);
    }
    assert.notEqual(record.variants[0].outcome.capture.image.sha256, record.variants[1].outcome.capture.image.sha256);
    assert.equal(proposal().id, proposed.id);
    assert.equal(inspect().runtime.session, originalSession);
    assert.deepEqual(await sourceHashes(), initialHashes);
    await assertPreserved();
    assertNoOriginalEvidence();
    return { record, proposed };
  };

  const first = await prepareAndRun('Soft corners', '12px');
  await ui({ type: 'proposalAction', id: first.proposed.id, label: 'Discard' });
  await wait(() => proposal()?.status !== 'proposed', 'explicit first proposal discard');
  const second = await prepareAndRun('Pill corners', '40px');
  const left = first.record, right = second.record;
  assert.equal(left.baselineDigest, right.baselineDigest, 'Both candidates freeze the exact same full saved baseline');
  assert.deepEqual(left.scope, right.scope);
  assert.deepEqual(left.recipe, right.recipe);
  assert.deepEqual(left.requested, right.requested);
  const sessions = [left, right].flatMap(record => record.variants.map(side => side.outcome.observation.runtime.session));
  assert.equal(new Set(sessions).size, 4, 'Each side runs in its own isolated runtime');
  const descriptor = alternatives().comparisonPairs.find(pair => pair.leftId === left.id && pair.rightId === right.id);
  assert.equal(descriptor.compatible, true);
  await ui({ type: 'select', label: 'First result', value: left.id });
  await ui({ type: 'select', label: 'Second result', value: right.id });
  await ui({ type: 'namedButton', label: 'Compare results', scope: '[aria-label="Compare retained results"]' });
  await ui({ type: 'comparison', leftId: left.id, rightId: right.id });
  await ui({ type: 'namedButton', label: 'Show captures', scope: pairScope });
  const comparedRenderer = await ui({ type: 'alternativeImages' });
  assertComparison(comparedRenderer, left, right, true);
  assert.notEqual(left.afterHash, right.afterHash, 'The two retained source candidates are distinct');
  // A larger radius can render identically once a short control reaches a pill.
  // Equality is observed evidence, never a reason to replace or invent a capture.
  const identicalCandidatePixels = comparedRenderer.images[0].sha256 === comparedRenderer.images[1].sha256;
  const blocked = alternatives().reviewChoices.find(value => value.id === left.id);
  assert.equal(blocked.canReview, false);
  assert.match(blocked.reason, /Discard the current proposal/);
  const blockedControl = comparedRenderer.reviews.find(value => value.label === 'Soft corners evidence');
  assert.equal(blockedControl.disabled, true);
  assert.match(blockedControl.text, /Discard the current proposal/);
  assert.equal(proposal().id, second.proposed.id);
  const blockedReview = { id: left.id, reason: blocked.reason, renderer: blockedControl };
  for (const theme of ['Foundation Dark', 'Foundation Light']) {
    await vscode.workspace.getConfiguration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Global);
    await ui({ type: 'screenshot', name: theme === 'Foundation Dark' ? 'alternatives-dark' : 'alternatives-light', theme });
  }
  await ui({ type: 'proposalAction', id: second.proposed.id, label: 'Discard' });
  await wait(() => alternatives().reviewChoices.find(value => value.id === left.id)?.canReview, 'retained first candidate available after explicit discard');
  assert.deepEqual(await sourceHashes(), initialHashes);
  const existingDiffs = new Set(vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => tab.input)
    .filter(input => input instanceof vscode.TabInputTextDiff).map(input => input.modified.toString()));
  await ui({ type: 'namedButton', label: 'Review this change', scope: sideScope('Soft corners') });
  const reviewed = await wait(() => proposal()?.status === 'proposed' && proposal()?.title === 'Soft corners' && proposal(), 'retained candidate staged for explicit review');
  assert.equal(reviewed.before, first.proposed.before);
  assert.equal(reviewed.after, first.proposed.after);
  assert.equal(reviewed.alternativeBasis.comparisonId, left.id);
  const diff = await wait(() => vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => tab.input)
    .find(input => input instanceof vscode.TabInputTextDiff && input.original.scheme === 'foundation-snapshot' && input.modified.scheme === 'foundation-snapshot' && !existingDiffs.has(input.modified.toString())), 'new native retained candidate diff');
  assert.equal((await vscode.workspace.openTextDocument(diff.original)).getText(), reviewed.before);
  assert.equal((await vscode.workspace.openTextDocument(diff.modified)).getText(), reviewed.after);
  assert.deepEqual(await sourceHashes(), initialHashes, 'Review opens a diff and does not write saved source');
  await assertPreserved();
  const review = { proposalId: reviewed.id, comparisonId: left.id, beforeHash: hash(reviewed.before), afterHash: hash(reviewed.after), nativeDiff: true, sourcePreserved: true };
  await vscode.commands.executeCommand('foundation.review');
  await ui({ type: 'proposalAction', id: reviewed.id, label: 'Apply to source' });
  await wait(() => proposal()?.status === 'applied', 'explicit retained candidate Apply');
  assert.equal(await fs.readFile(cssPath, 'utf8'), first.proposed.after);
  await assertPreserved();
  const appliedHashes = await sourceHashes();
  for (const file of sourcePaths.filter(file => file !== 'src/style.css')) assert.equal(appliedHashes[file], initialHashes[file]);
  await ui({ type: 'proposalAction', id: reviewed.id, label: 'Undo Foundation change' });
  await wait(() => proposal()?.status === 'undone', 'explicit target-only Undo');
  assert.deepEqual(await sourceHashes(), initialHashes);
  await assertPreserved();
  assertNoOriginalEvidence();
  const adoption = { explicitApply: true, explicitUndo: true, appliedHash: appliedHashes['src/style.css'], undoneHash: hash(await fs.readFile(cssPath)), unrelatedDraftPreserved: true };
  const editor = await vscode.window.showTextDocument(draft, { viewColumn: vscode.ViewColumn.Two, preview: false });
  editor.selection = new vscode.Selection(0, 3, 1, 9);
  await vscode.commands.executeCommand('foundation.review');
  const finalRenderer = await ui({ type: 'comparison', leftId: left.id, rightId: right.id });
  assertComparison(finalRenderer, left, right, true);
  await fs.writeFile(reportPath, JSON.stringify({ writeProcessId: process.pid, projectId: inspect().project.id,
    featureId: feature.activeId, screenId: screen.id, scenarioId: scenario.id, sourceHashes: initialHashes,
    records: [left, right], comparison: { leftId: left.id, rightId: right.id, descriptor, renderer: comparedRenderer, identicalCandidatePixels },
    blockedReview, review, adoption, draftText, renderer: finalRenderer, providerRequests: 0, ai: 'disconnected',
    checks: ['Two named alternatives retain exact source metadata', 'Four isolated runtime executions under identical frozen conditions',
      'Explicit comparison renders the two proposed-side capture hashes', 'Conflicting current proposal disables Review',
      'Explicit discard enables retained candidate review and a no-write native diff', 'Explicit Apply and Undo preserve unrelated draft and restore saved source',
      'Native paired Dark and Light screenshots', 'Second-process names, selected pair, read-only history and draft restoration required'],
    hardwareAcceptance: 'Paused; no physical input/display acceptance' }));
}

exports.activate = () => {
  const workspace = process.env.FOUNDATION_VERIFICATION_WORKSPACE;
  const outcome = process.env.FOUNDATION_VERIFICATION_OUTCOME;
  assert.equal(vscode.workspace.workspaceFolders?.length, 1);
  assert.equal(vscode.workspace.workspaceFolders[0].uri.fsPath, workspace);
  assert.match(workspace, /^\/private\/tmp\/foundation-alternative-adoption-smoke-[A-Za-z0-9]+\/workspace$/);
  assert.equal(path.dirname(outcome), path.dirname(workspace));
  setImmediate(async () => {
    let result;
    try { await run(); result = { passed: true, stage: process.env.FOUNDATION_VERIFICATION_STAGE }; }
    catch (error) {
      result = { passed: false, error: error.stack || String(error), stage: process.env.FOUNDATION_VERIFICATION_STAGE };
      if (inspect) await fs.writeFile(outcome.replace('.json', '-state.json'), JSON.stringify(inspect(), null, 2));
    }
    await fs.writeFile(outcome, JSON.stringify(result, null, 2));
    if (result.passed || process.env.FOUNDATION_VERIFICATION_KEEP_FAILURE !== '1') await vscode.commands.executeCommand('workbench.action.quit');
  });
};
