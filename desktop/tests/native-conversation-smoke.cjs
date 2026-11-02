const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const stage = process.env.FOUNDATION_HISTORY_STAGE;
  const report = process.env.FOUNDATION_HISTORY_REPORT;
  const expected = process.env.FOUNDATION_HISTORY_EXTENSION;
  assert.ok(stage === 'write' || stage === 'restore');
  const configuration = vscode.workspace.getConfiguration('foundation.ai');
  assert.equal(configuration.get('baseUrl'), '');
  assert.equal(configuration.get('model'), '');
  for (const key of ['FOUNDATION_AI_BASE_URL', 'FOUNDATION_AI_MODEL', 'FOUNDATION_AI_API_KEY']) {
    assert.equal(process.env[key], undefined, 'The history check never configures an AI provider');
  }
  const extension = vscode.extensions.getExtension('foundation.foundation-workspace');
  assert.ok(extension);
  assert.equal(await fs.realpath(extension.extensionPath), expected);
  await extension.activate();
  await vscode.commands.executeCommand('foundation.refresh');
  const initial = extension.exports.inspect().conversations;
  assert.ok(initial, 'Host exposes current project conversation state');
  await vscode.commands.executeCommand('foundation.askAI');
  const deadline = Date.now() + 15000;
  while (!extension.exports.inspect().assistantSurface.visible && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(extension.exports.inspect().assistantSurface.visible, true, 'Restored history belongs to the native sidebar');
  if (stage === 'write') {
    assert.equal(initial.conversations.length, 0);
    await vscode.commands.executeCommand('foundation.newConversation');
    const state = extension.exports.inspect().conversations;
    assert.ok(state.activeId);
    assert.equal(state.conversations.length, 1);
    assert.equal(state.storage.status, 'saved');
    assert.equal(state.conversations[0].turns.length, 0);
    await fs.writeFile(report, JSON.stringify({
      activeId: state.activeId,
      storage: state.storage.status,
      extensionPath: extension.extensionPath,
      writeProcessId: process.pid, sidebarVisible: true,
    }));
  } else {
    const before = JSON.parse(await fs.readFile(report, 'utf8'));
    assert.notEqual(process.pid, before.writeProcessId, 'A separate native extension host restores the saved conversation');
    assert.equal(initial.activeId, before.activeId);
    assert.equal(initial.conversations.length, 1);
    assert.equal(initial.conversations[0].turns.length, 0);
    assert.equal(initial.storage.status, 'saved');
    await fs.writeFile(report, JSON.stringify({
      ...before, restoredInSecondProcess: true, sidebarRestored: true, storage: initial.storage.status, restoreProcessId: process.pid,
    }));
  }
}

// This runs as a normal disposable development extension, not extension tests:
// --extensionTestsPath intentionally disables persistent Code OSS storage.
exports.activate = () => {
  const stage = process.env.FOUNDATION_HISTORY_STAGE;
  const outcome = process.env.FOUNDATION_HISTORY_OUTCOME;
  const workspace = process.env.FOUNDATION_HISTORY_WORKSPACE;
  const folders = vscode.workspace.workspaceFolders || [];
  assert.equal(folders.length, 1);
  assert.equal(folders[0].uri.fsPath, workspace, 'Quit is confined to the isolated history fixture');
  assert.ok(workspace.startsWith('/private/tmp/foundation-history-smoke-'));
  assert.equal(path.dirname(outcome), path.dirname(workspace));
  // Let activation finish before awaiting commands or quitting the window.
  setImmediate(async () => {
    let result;
    try {
      await run();
      result = { stage, passed: true };
    } catch (error) {
      result = { stage, passed: false, error: error?.stack || String(error) };
    }
    try {
      await fs.writeFile(outcome, JSON.stringify(result, null, 2));
    } finally {
      // Normal shutdown flushes native SQLite storage. This verifies graceful
      // restart, not process-crash or power-loss durability.
      await vscode.commands.executeCommand('workbench.action.quit');
    }
  });
};
