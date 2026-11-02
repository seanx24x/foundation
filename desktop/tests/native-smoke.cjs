const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { performance } = require('node:perf_hooks');

async function waitFor(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

exports.run = async function run() {
  const results = [];
  const measurements = [];
  const root = process.env.FOUNDATION_SMOKE_WORKSPACE;
  const report = process.env.FOUNDATION_SMOKE_REPORT;
  assert.ok(root && report, 'Run this module through desktop/scripts/smoke.mjs');
  const source = vscode.Uri.file(path.join(root, 'src', 'save.ts'));
  let extension;
  let document;
  let original;
  const check = async (name, action) => {
    const started = Date.now();
    try {
      await action();
      results.push({ name, status: 'passed', durationMs: Date.now() - started });
    } catch (error) {
      results.push({ name, status: 'failed', durationMs: Date.now() - started, error: error.stack || String(error) });
    }
  };

  await check(`${process.env.FOUNDATION_SMOKE_MODE === 'development' ? 'Development' : 'Built-in'} Foundation extension activates from the expected path in a trusted native workspace`, async () => {
    assert.equal(vscode.workspace.isTrusted, true);
    assert.equal(vscode.workspace.workspaceFolders[0].uri.fsPath, root);
    extension = vscode.extensions.getExtension('foundation.foundation-workspace');
    assert.ok(extension, 'Foundation extension is missing from the packaged app');
    assert.equal(await fs.realpath(extension.extensionPath), process.env.FOUNDATION_SMOKE_EXTENSION, 'The smoke must exercise the selected extension, not a different installed copy');
    await extension.activate();
    assert.equal(extension.isActive, true);
  });

  await check('Foundation activities and native editor commands are registered', async () => {
    const commands = new Set(await vscode.commands.getCommands(true));
    if (process.env.FOUNDATION_SMOKE_MODE === 'development') assert.ok(commands.has('foundation.showDiagnostics'));
    for (const command of ['understand', 'build', 'refine', 'review', 'askAI', 'toggleAssistant', 'collapseAssistant', 'refresh', 'openSource', 'reviewFile', 'openTerminal', 'openGit', 'openDebug', 'configureAI', 'startDesignPreview', 'proposeTokenChange', 'applyProposal', 'undoProposal']) {
      assert.ok(commands.has(`foundation.${command}`), `Missing command foundation.${command}`);
    }
  });

  await check('Native editor opens source and TypeScript provides symbols', async () => {
    document = await vscode.workspace.openTextDocument(source);
    original = document.getText();
    await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    assert.equal(document.languageId, 'typescript');
    const symbols = await waitFor(async () => {
      const found = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', source);
      return found?.some(symbol => symbol.name === 'saveSettings') ? found : undefined;
    }, 'TypeScript saveSettings symbol');
    assert.ok(symbols.length > 0);
  });

  await check('Native edit commands update the document and undo preserves the fixture', async () => {
    const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    const samples = [];
    for (let index = 0; index < 23; index++) {
      editor.selection = new vscode.Selection(0, 0, 0, 0);
      const started = performance.now();
      await vscode.commands.executeCommand('type', { text: 'x' });
      assert.ok(document.getText() === 'x' + original);
      if (index >= 3) samples.push(performance.now() - started);
      await vscode.commands.executeCommand('undo');
      assert.equal(document.getText(), original);
    }
    const sorted = [...samples].sort((a,b) => a-b);
    measurements.push({ name: 'native type command through observed document update', unit: 'ms', samples,
      median: sorted[Math.floor(sorted.length/2)], p95: sorted[Math.ceil(sorted.length*.95)-1],
      limitations: 'Extension-host command round trip with warm editor; excludes physical input dispatch and compositor paint. Isolated small fixture, no active AI or runtime load.' });
  });

  await check('Foundation source navigation uses the native editor location', async () => {
    await vscode.commands.executeCommand('foundation.refresh');
    await vscode.commands.executeCommand('foundation.openSource', 'src/save.ts', 5);
    assert.equal(vscode.window.activeTextEditor.document.uri.toString(), source.toString());
    assert.equal(vscode.window.activeTextEditor.selection.active.line, 4);
  });

  await check('Source edits save and Foundation opens a native session diff', async () => {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(source, new vscode.Position(0, 0), '// Saved by the isolated Foundation smoke test.\n');
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    assert.equal(await document.save(), true);
    assert.equal(await fs.readFile(source.fsPath, 'utf8'), document.getText());
    const diff = await waitFor(async () => {
      try { await vscode.commands.executeCommand('foundation.reviewFile', 'src/save.ts'); }
      catch { return undefined; }
      return vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => tab.input).find(input => input instanceof vscode.TabInputTextDiff && input.original.scheme === 'foundation-snapshot');
    }, 'Foundation session diff', 7000);
    const baseline = await vscode.workspace.openTextDocument(diff.original);
    assert.equal(baseline.getText(), original);
    assert.equal(diff.modified.toString(), source.toString());
  });

  await check('Understand, Refine, and Review retain the central Foundation workspace', async () => {
    for (const command of ['understand', 'refine', 'review']) {
      await vscode.commands.executeCommand(`foundation.${command}`);
    }
    await waitFor(() => vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.label === 'Foundation' && tab.input instanceof vscode.TabInputWebview), 'Foundation workspace tab');
    assert.equal(extension.exports.inspect().workspaceMode, 'Review');
  });

  await check('Assistant resolves in the native secondary sidebar without replacing the workspace', async () => {
    const contribution = extension.packageJSON.contributes;
    assert.ok(contribution.viewsContainers.secondarySidebar.some(container => container.id === 'foundation-assistant'));
    assert.ok(contribution.views['foundation-assistant'].some(view => view.id === 'foundation.assistant' && view.type === 'webview'));
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
    const active = vscode.window.tabGroups.activeTabGroup.activeTab;
    await vscode.commands.executeCommand('foundation.askAI');
    await waitFor(() => extension.exports.inspect().assistantSurface.visible, 'visible native Assistant');
    assert.equal(extension.exports.inspect().assistantSurface.resolved, true);
    assert.equal(extension.exports.inspect().workspaceMode, 'Review');
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab, active);
    assert.deepEqual(vscode.window.tabGroups.all.flatMap(group => group.tabs), tabs);
  });

  await check('Collapse and reopen preserve conversation identity and the native editor selection', async () => {
    await vscode.commands.executeCommand('foundation.newConversation');
    const conversationId = extension.exports.inspect().conversations.activeId;
    assert.ok(conversationId);
    await vscode.commands.executeCommand('foundation.build');
    const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    editor.selection = new vscode.Selection(5, 2, 5, 8);
    const selection = editor.selection;
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    await vscode.commands.executeCommand('foundation.collapseAssistant');
    await waitFor(() => !extension.exports.inspect().assistantSurface.visible, 'collapsed native Assistant');
    assert.equal(extension.exports.inspect().assistantSurface.resolved, true);
    await vscode.commands.executeCommand('foundation.toggleAssistant');
    await waitFor(() => extension.exports.inspect().assistantSurface.visible, 'reopened native Assistant');
    assert.equal(extension.exports.inspect().conversations.activeId, conversationId);
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab, tab);
    assert.equal(editor.document.uri.toString(), source.toString());
    assert.deepEqual(editor.selection, selection);
  });

  await check('Closing the central workspace leaves Assistant available', async () => {
    await vscode.commands.executeCommand('foundation.understand');
    const workspaceTab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.label === 'Foundation' && tab.input instanceof vscode.TabInputWebview);
    assert.ok(workspaceTab);
    const conversationId = extension.exports.inspect().conversations.activeId;
    assert.equal(await vscode.window.tabGroups.close(workspaceTab, true), true);
    assert.equal(extension.exports.inspect().assistantSurface.visible, true);
    assert.equal(extension.exports.inspect().conversations.activeId, conversationId);
    await vscode.commands.executeCommand('foundation.build');
    assert.equal(vscode.window.activeTextEditor.document.uri.toString(), source.toString());
  });

  await check('Both Foundation themes resolve in the running workbench', async () => {
    const contributed = extension.packageJSON.contributes.themes.map(theme => theme.label);
    assert.ok(contributed.includes('Foundation Light') && contributed.includes('Foundation Dark'));
    for (const [theme, kind] of [['Foundation Light', vscode.ColorThemeKind.Light], ['Foundation Dark', vscode.ColorThemeKind.Dark]]) {
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Global);
      await waitFor(() => vscode.window.activeColorTheme.kind === kind, `${theme} activation`, 5000);
    }
  });

  await check('Native Git extension discovers the isolated repository', async () => {
    const git = vscode.extensions.getExtension('vscode.git');
    assert.ok(git);
    const api = (await git.activate()).getAPI(1);
    await waitFor(() => api.repositories.find(repository => repository.rootUri.fsPath === root), 'native Git repository');
  });

  await check('Native terminal executes a shell process', async () => {
    const output = path.join(root, 'terminal-proof.txt');
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const terminal = vscode.window.createTerminal({ name: 'Foundation smoke', shellPath: '/bin/sh', shellArgs: ['-c', `printf foundation-terminal-ok > ${quote(output)}`] });
    try {
      terminal.show();
      const result = await waitFor(async () => {
        try { return await fs.readFile(output, 'utf8'); } catch { return undefined; }
      }, 'native terminal output');
      assert.equal(result, 'foundation-terminal-ok');
    } finally { terminal.dispose(); }
  });

  await check('Saved React source compiles into a bounded native design preview', async () => {
    await vscode.commands.executeCommand('foundation.startDesignPreview', 'src/App.tsx');
    const state = extension.exports.inspect();
    assert.equal(state.design.status, 'ready', state.design.error);
    assert.equal(state.design.compilation, 'passed');
    assert.equal(state.design.capabilities.network, false);
    assert.ok(state.design.files.some(file => file.path === 'src/App.tsx'));
    assert.ok(state.design.tokens.some(token => token.name === '--smoke-radius'));
  });

  await check('Design token proposal applies and safely undoes through the packaged host', async () => {
    const token = extension.exports.inspect().design.tokens.find(item => item.name === '--smoke-radius');
    const uri = vscode.Uri.file(path.join(root, token.path));
    const before = await fs.readFile(uri.fsPath, 'utf8');
    const impact = await vscode.commands.executeCommand('foundation.designImpact', {action:'analyze',target:{kind:'token',path:token.path,revision:token.revision,name:token.name,occurrence:token.occurrence}});
    assert.equal(impact.status, 'ready', impact.message);
    const proposal = await vscode.commands.executeCommand('foundation.proposeTokenChange', { ...token, value: '12px', impactId: impact.id });
    assert.equal(await fs.readFile(uri.fsPath, 'utf8'), before, 'Proposal creation must not change source');
    await vscode.commands.executeCommand('foundation.applyProposal', proposal.id);
    assert.equal(await fs.readFile(uri.fsPath, 'utf8'), before.replace('8px', '12px'));
    assert.equal(extension.exports.inspect().proposal.status, 'applied');
    assert.equal(extension.exports.inspect().design.stale, true);
    await assert.rejects(vscode.commands.executeCommand('foundation.applyProposal', proposal.id));
    await fs.writeFile(uri.fsPath, before.replace('8px', '12px') + '/* newer external edit */\n');
    await assert.rejects(vscode.commands.executeCommand('foundation.undoProposal', proposal.id));
    assert.match(await fs.readFile(uri.fsPath, 'utf8'), /newer external edit/);
    await fs.writeFile(uri.fsPath, before.replace('8px', '12px'));
    await vscode.commands.executeCommand('foundation.undoProposal', proposal.id);
    assert.equal(await fs.readFile(uri.fsPath, 'utf8'), before);
    assert.equal(extension.exports.inspect().proposal.status, 'undone');
  });

  await fs.writeFile(report, JSON.stringify({ appName: vscode.env.appName, hostVersion: vscode.version, workspace: root, extensionMode: process.env.FOUNDATION_SMOKE_MODE, extensionPath: extension?.extensionPath, tests: results, measurements }, null, 2));
  const failures = results.filter(result => result.status === 'failed');
  if (failures.length) throw new Error(`${failures.length} native smoke checks failed: ${failures.map(result => result.name).join('; ')}`);
};
