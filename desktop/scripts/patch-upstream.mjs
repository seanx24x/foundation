import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareCanvasCapturePatch } from './patch-canvas-capture.mjs';

// Foundation owns AI through its built-in extension. Keep required core product
// metadata, but omit the unrelated Copilot extension and its packaging shims.
// Every replacement is anchored to the audited upstream revision and fails closed.
export function patchAccountInitialization(source) {
  const before = `\t\tawait this.whenDefaultAccountAuthenticationProviderAvailable();

\t\tthis.logService.debug('[DefaultAccount] Starting initialization');
\t\tawait this.doUpdateDefaultAccount();
\t\tthis.logService.debug('[DefaultAccount] Initialization complete');`;
  const after = `\t\t// Foundation activates platform authentication on demand. Keep the provider
\t\t// and all listeners below so explicit sign-in and session requests still work.
\t\tif (this.productService.applicationName !== 'foundation' || this.authenticationService.isAuthenticationProviderRegistered(this.getDefaultAccountAuthenticationProvider().id)) {
\t\t\tawait this.whenDefaultAccountAuthenticationProviderAvailable();

\t\t\tthis.logService.debug('[DefaultAccount] Starting initialization');
\t\t\tawait this.doUpdateDefaultAccount();
\t\t\tthis.logService.debug('[DefaultAccount] Initialization complete');
\t\t} else {
\t\t\tthis.logService.debug('[Foundation] Default account discovery deferred until provider activation');
\t\t}`;
  if (source.split(before).length !== 2) throw new Error('Upstream default account initialization changed: re-audit startup authentication');
  return source.replace(before, after);
}

export function patchSpeechAccountInitialization(source) {
  const before = `\t\tthis._updateConfiguredContextKey();
\t\tvoid this._refreshGitHubSession();
\t\tthis._register(this._authenticationService.onDidChangeSessions(e => {`;
  const after = `\t\tthis._updateConfiguredContextKey();
\t\t// Foundation keeps background dictation setup from activating authentication.
\t\t// Existing provider and session listeners refresh availability on demand.
\t\tif (this._productService.applicationName !== 'foundation' || this._authenticationService.isAuthenticationProviderRegistered('github')) {
\t\t\tvoid this._refreshGitHubSession();
\t\t} else {
\t\t\tthis._logService.debug('[Foundation] Speech account discovery deferred until provider activation');
\t\t}
\t\tthis._register(this._authenticationService.onDidChangeSessions(e => {`;
  if (source.split(before).length !== 2) throw new Error('Upstream speech account initialization changed: re-audit startup authentication');
  return source.replace(before, after);
}

export function patchNpmWorkspaceDetection(source) {
  const edits = [
    ["import findWorkspaceRoot = require('../node_modules/find-yarn-workspace-root');", "import { findWorkspaceRoot } from './foundationYarnWorkspaceRoot';"],
    ["if (typeof findWorkspaceRoot(pkgPath) === 'string') {", "if (typeof await findWorkspaceRoot(pkgPath) === 'string') {"],
  ];
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error('Upstream npm workspace detection changed: re-audit asynchronous package probing');
    source = source.replace(before, after);
  }
  return source;
}

export async function patchUpstream(checkout) {
  const file = 'build/gulpfile.vscode.ts';
  let source = execFileSync('git', ['show', `HEAD:${file}`], { cwd: checkout, encoding: 'utf8' });
  const edits = [
    ['\t\t\tcompileCopilotExtensionBuildTask,', "\t\t\t...(process.env['FOUNDATION_WITHOUT_COPILOT'] === '1' ? [] : [compileCopilotExtensionBuildTask]),"],
    ['\t\t\tprepareCopilotRipgrepShimTask(platform, arch, destinationFolderName)', "\t\t\t...(process.env['FOUNDATION_WITHOUT_COPILOT'] === '1' ? [] : [prepareCopilotRipgrepShimTask(platform, arch, destinationFolderName)])"],
  ];
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error(`Upstream task changed: re-audit ${before.trim()}`);
    source = source.replace(before, after);
  }
  const accountFile = 'src/vs/workbench/services/accounts/browser/defaultAccount.ts';
  const originalAccount = execFileSync('git', ['show', `HEAD:${accountFile}`], { cwd: checkout, encoding: 'utf8' });
  const accountSource = patchAccountInitialization(originalAccount);
  const speechFile = 'src/vs/workbench/contrib/chat/browser/speechToText/chatSpeechToTextService.ts';
  const originalSpeech = execFileSync('git', ['show', `HEAD:${speechFile}`], { cwd: checkout, encoding: 'utf8' });
  const speechSource = patchSpeechAccountInitialization(originalSpeech);
  const npmFile = 'extensions/npm/src/preferred-pm.ts';
  const originalNpm = execFileSync('git', ['show', `HEAD:${npmFile}`], { cwd: checkout, encoding: 'utf8' });
  const npmSource = patchNpmWorkspaceDetection(originalNpm);
  const npmHelper = await readFile(new URL('../patches/npm-yarn-workspace-root.ts', import.meta.url), 'utf8');
  const npmLicense = await readFile(new URL('../patches/npm-yarn-workspace-root.LICENSE', import.meta.url), 'utf8');
  const canvasCapture = await prepareCanvasCapturePatch(checkout);
  // Validate every pinned original before writing any generated overlay.
  for (const [captureFile, captureSource] of canvasCapture) await writeFile(path.join(checkout, captureFile), captureSource);
  await writeFile(path.join(checkout, file), source);
  await writeFile(path.join(checkout, accountFile), accountSource);
  await writeFile(path.join(checkout, speechFile), speechSource);
  await writeFile(path.join(checkout, npmFile), npmSource);
  await writeFile(path.join(checkout, 'extensions/npm/src/foundationYarnWorkspaceRoot.ts'), npmHelper);
  await writeFile(path.join(checkout, 'extensions/npm/FoundationThirdPartyNotices.txt'), `Foundation asynchronous adaptation of find-yarn-workspace-root 2.0.0.\nCopyright 2017 Square, Inc.\nAdapted from:\nhttps://github.com/yarnpkg/yarn/blob/ddf2f9ade211195372236c2f39a75b00fa18d4de/src/config.js#L612\nModified by Foundation to use asynchronous filesystem operations.\n\n${npmLicense}`);
}
