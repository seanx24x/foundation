/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BrowserWindow, WebFrameMain } from 'electron';
import { foundationCanvasGeometryScript, FoundationCanvasGeometry, FoundationCaptureIdentity, FoundationCaptureRequest, FoundationCaptureResult, FoundationCaptureWitness, validFoundationCaptureIdentity, validFoundationCaptureWitness } from '../common/foundationCanvasCapture.js';

const busy = new WeakSet<BrowserWindow>();
const fail = (stage = 'guard'): never => { throw new Error(`foundation-canvas-capture-unavailable:${stage}`); };
const alive = (frame: WebFrameMain): boolean => !frame.isDestroyed() && !frame.detached;
const frameKey = (frame: WebFrameMain): string => `${frame.processId}:${frame.routingId}:${frame.url}`;

async function bounded<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('foundation-canvas-capture-timeout')), 3000); })]);
	} finally { clearTimeout(timer); }
}
function geometry(value: unknown): FoundationCanvasGeometry {
	if (!value || typeof value !== 'object') { return fail(); }
	const item = value as FoundationCanvasGeometry;
	if (![item.rect, item.captureRect].every(rect => rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key as keyof typeof rect]))
		&& rect.x >= 0 && rect.y >= 0 && rect.width >= 1 && rect.height >= 1 && rect.width <= 8192 && rect.height <= 8192)
		|| typeof item.frameName !== 'string' || typeof item.url !== 'string' || item.url.length > 4096
		|| !Number.isInteger(item.viewportWidth) || !Number.isInteger(item.viewportHeight) || item.viewportWidth < 1 || item.viewportHeight < 1 || item.viewportWidth > 8192 || item.viewportHeight > 8192) { return fail(); }
	return item;
}
function runtimeURL(value: string, expected: FoundationCaptureIdentity): URL {
	let url: URL;
	try { url = new URL(value); } catch { return fail(); }
	if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password || url.hash || url.pathname !== expected.route) { return fail(); }
	return url;
}
async function witness(frame: WebFrameMain, expected: FoundationCaptureIdentity): Promise<FoundationCaptureWitness> {
	// The sole dynamic argument is a random nonce. Never evaluate caller code or DOM markup.
	const result = await bounded(frame.executeJavaScript(`(() => { const witness = globalThis.__foundationCaptureWitness; return typeof witness === 'function' ? witness(${JSON.stringify(expected.nonce)}) : null; })()`));
	if (!validFoundationCaptureWitness(result, expected)) { return fail(); }
	return result;
}

/** Captures only a validated visible canvas rectangle. Images never enter the runtime page. */
export async function captureFoundationCanvas(window: BrowserWindow | null | undefined, input: unknown): Promise<FoundationCaptureResult> {
	if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2) { return fail('request'); }
	const request = input as FoundationCaptureRequest;
	if (!validFoundationCaptureIdentity(request.identity) || typeof request.webviewId !== 'string' || !/^[a-f0-9-]{36}$/i.test(request.webviewId)) { return fail('request'); }
	if (!window || window.isDestroyed() || !window.isVisible() || window.isMinimized() || !window.isFocused() || busy.has(window)) { return fail('window'); }
	const contents = window.webContents;
	const identity = { ...request.identity };
	const webviewId = request.webviewId;
	const current = (): void => {
		if (window.isDestroyed() || !window.isVisible() || window.isMinimized() || !window.isFocused() || contents.isDestroyed()) { fail(); }
	};
	busy.add(window);
	let stage = 'ownership';
	try {
		current();
		const wrappers = contents.mainFrame.framesInSubtree.filter(frame => alive(frame) && frame.name === webviewId && frame.url.startsWith('vscode-webview://'));
		if (wrappers.length !== 1) { return fail(); }
		const wrapper = wrappers[0], main = contents.mainFrame;
		if (wrapper.parent !== main) { return fail(); }
		stage = 'geometry-inner';
		const inner = geometry(await bounded(wrapper.executeJavaScript(foundationCanvasGeometryScript('inner', webviewId))));
		stage = 'geometry-outer';
		const outer = geometry(await bounded(main.executeJavaScript(foundationCanvasGeometryScript('outer', webviewId, inner.rect))));
		if (outer.frameName !== webviewId || outer.url !== wrapper.url) { return fail(); }
		stage = 'runtime';
		const children = wrapper.frames.filter(alive);
		if (children.length !== 1) { return fail(); }
		const content = children[0];
		const origin = runtimeURL(inner.url, identity).origin;
		const frames = content.frames.filter(frame => {
			if (!alive(frame)) { return false; }
			try { return runtimeURL(frame.url, identity).origin === origin; } catch { return false; }
		});
		if (frames.length !== 1) { return fail(); }
		const runtime = frames[0];
		const keys = [main, wrapper, content, runtime].map(frameKey);
		stage = 'witness-before';
		const before = await witness(runtime, identity);
		stage = 'bounds';
		if (Math.abs(before.viewportWidth - inner.viewportWidth) > 1 || Math.abs(before.viewportHeight - inner.viewportHeight) > 1) { return fail(); }
		const scaleX = inner.rect.width / inner.viewportWidth, scaleY = inner.rect.height / inner.viewportHeight;
		if (scaleX <= 0 || scaleX > 2 || Math.abs(scaleX - scaleY) > 0.002 || inner.rect.x + inner.rect.width > outer.viewportWidth + 0.01 || inner.rect.y + inner.rect.height > outer.viewportHeight + 0.01) { return fail(); }
		// Parent CSS transforms are rejected by the fixed script. Integer client sizes
		// are rounded viewport measurements, not scale factors for child coordinates.
		if (Math.abs(outer.rect.width - outer.viewportWidth) > 1 || Math.abs(outer.rect.height - outer.viewportHeight) > 1
			|| outer.captureRect.x !== outer.rect.x + inner.rect.x || outer.captureRect.y !== outer.rect.y + inner.rect.y
			|| outer.captureRect.width !== inner.rect.width || outer.captureRect.height !== inner.rect.height || JSON.stringify(inner.captureRect) !== JSON.stringify(inner.rect)) { return fail(); }
		const zoom = contents.getZoomFactor();
		if (!Number.isFinite(zoom) || zoom < 0.5 || zoom > 3) { return fail(); }
		// Round inward; fractional frame coordinates receive one additional device-independent
		// pixel of guard on each edge, never an outward tolerance into adjacent UI.
		const canvas = outer.captureRect;
		const guard = [outer.rect.x, outer.rect.y, outer.rect.width, outer.rect.height, inner.rect.x, inner.rect.y, inner.rect.width, inner.rect.height].some(value => Math.abs(value - Math.round(value)) > 0.000001) ? 1 : 0;
		const x = Math.ceil(canvas.x * zoom) + guard, y = Math.ceil(canvas.y * zoom) + guard;
		const right = Math.floor((canvas.x + canvas.width) * zoom) - guard, bottom = Math.floor((canvas.y + canvas.height) * zoom) - guard;
		const rect = { x, y, width: right - x, height: bottom - y };
		if (rect.width < 1 || rect.height < 1 || rect.width > 8192 || rect.height > 8192 || rect.width * rect.height > 16000000) { return fail(); }
		current();
		stage = 'capture';
		const image = await bounded(contents.capturePage(rect, { stayHidden: true }));
		const capturedAt = new Date().toISOString();
		stage = 'identity-after';
		current();
		if (![main, wrapper, content, runtime].every(alive) || JSON.stringify(keys) !== JSON.stringify([main, wrapper, content, runtime].map(frameKey)) || contents.getZoomFactor() !== zoom) { return fail(); }
		stage = 'witness-after';
		const after = await witness(runtime, identity);
		stage = 'geometry-inner-after';
		const innerAfter = geometry(await bounded(wrapper.executeJavaScript(foundationCanvasGeometryScript('inner', webviewId))));
		stage = 'geometry-outer-after';
		const outerAfter = geometry(await bounded(main.executeJavaScript(foundationCanvasGeometryScript('outer', webviewId, innerAfter.rect))));
		current();
		if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(outer) !== JSON.stringify(outerAfter) || JSON.stringify(inner) !== JSON.stringify(innerAfter)
			|| ![main, wrapper, content, runtime].every(alive) || JSON.stringify(keys) !== JSON.stringify([main, wrapper, content, runtime].map(frameKey))) { return fail(); }
		stage = 'result';
		if (image.isEmpty()) { return fail(); }
		const png = image.toPNG();
		if (png.length < 33 || png.length > 8 * 1024 * 1024 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.subarray(12, 16).toString('ascii') !== 'IHDR') { return fail(); }
		const pixelWidth = png.readUInt32BE(16), pixelHeight = png.readUInt32BE(20);
		if (pixelWidth < 1 || pixelHeight < 1 || pixelWidth > 8192 || pixelHeight > 8192 || pixelWidth * pixelHeight > 16000000) { return fail(); }
		return {
			pngBase64: png.toString('base64'), capturedAt, identity,
			conditions: { pageSequence: before.pageSequence, viewportWidth: before.viewportWidth, viewportHeight: before.viewportHeight, devicePixelRatio: before.devicePixelRatio,
				scrollX: before.scrollX, scrollY: before.scrollY, requestedTheme: before.requestedTheme, observedColorScheme: before.observedColorScheme, reducedMotion: before.reducedMotion,
				canvasScale: scaleX, pixelWidth, pixelHeight }
		};
	} catch { return fail(stage); } finally { busy.delete(window); }
}
