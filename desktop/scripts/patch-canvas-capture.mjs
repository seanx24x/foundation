import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const canvasCaptureFiles = {
  native: 'src/vs/platform/native/electron-main/nativeHostMainService.ts',
  contract: 'src/vs/platform/native/common/native.ts',
  contribution: 'src/vs/workbench/contrib/webview/electron-browser/webview.contribution.ts',
  common: 'src/vs/platform/native/common/foundationCanvasCapture.ts',
  implementation: 'src/vs/platform/native/electron-main/foundationCanvasCapture.ts',
  command: 'src/vs/workbench/contrib/webview/electron-browser/foundationCanvasCapture.ts',
};
function once(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Upstream canvas capture seam changed; re-audit the native bridge before building.');
  return source.replace(before, after);
}
export function patchCanvasCaptureNative(source) {
  if (source.includes('foundationCanvasCapture')) throw new Error('Upstream canvas capture seam changed; re-audit an already modified source.');
  source = once(source, "import * as fs from 'fs';", "import * as fs from 'fs';\nimport { captureFoundationCanvas } from './foundationCanvasCapture.js';\nimport { FoundationCaptureRequest, FoundationCaptureResult } from '../common/foundationCanvasCapture.js';");
  return once(source, '\t//#region Screenshots', `\t/** Foundation captures only the validated canvas in this IPC caller's window. */
\tasync captureFoundationCanvas(windowId: number | undefined, input: FoundationCaptureRequest): Promise<FoundationCaptureResult> {
\t\treturn captureFoundationCanvas(typeof windowId === 'number' ? this.windowsMainService.getWindowById(windowId)?.win : undefined, input);
\t}

\t//#region Screenshots`);
}
export function patchCanvasCaptureContract(source) {
  if (source.includes('foundationCanvasCapture')) throw new Error('Upstream canvas capture seam changed; re-audit an already modified source.');
  source = once(source, "import { VSBuffer } from '../../../base/common/buffer.js';", "import { VSBuffer } from '../../../base/common/buffer.js';\nimport { FoundationCaptureRequest, FoundationCaptureResult } from './foundationCanvasCapture.js';");
  return once(source, '\tgetScreenshot(rect?: IRectangle): Promise<VSBuffer | undefined>;', '\tgetScreenshot(rect?: IRectangle): Promise<VSBuffer | undefined>;\n\tcaptureFoundationCanvas(input: FoundationCaptureRequest): Promise<FoundationCaptureResult>;');
}
export function patchCanvasCaptureContribution(source) {
  if (source.includes('foundationCanvasCapture')) throw new Error('Upstream canvas capture seam changed; re-audit an already modified source.');
  return once(source, "import { ElectronWebviewService } from './webviewService.js';", "import { ElectronWebviewService } from './webviewService.js';\nimport './foundationCanvasCapture.js';");
}
/** Read and validate every pinned seam before writing any upstream overlay. */
export async function prepareCanvasCapturePatch(checkout) {
  const original = file => execFileSync('git', ['show', `HEAD:${file}`], { cwd: checkout, encoding: 'utf8' });
  const files = new Map([
    [canvasCaptureFiles.native, patchCanvasCaptureNative(original(canvasCaptureFiles.native))],
    [canvasCaptureFiles.contract, patchCanvasCaptureContract(original(canvasCaptureFiles.contract))],
    [canvasCaptureFiles.contribution, patchCanvasCaptureContribution(original(canvasCaptureFiles.contribution))],
  ]);
  for (const [key, name] of [['common', 'common'], ['implementation', 'native'], ['command', 'workbench']]) {
    files.set(canvasCaptureFiles[key], await readFile(new URL(`../patches/foundation-canvas-capture-${name}.ts`, import.meta.url), 'utf8'));
  }
  return files;
}
export async function patchCanvasCapture(checkout) {
  const files = await prepareCanvasCapturePatch(checkout);
  for (const [file, source] of files) await writeFile(path.join(checkout, file), source);
}
