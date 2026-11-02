/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface FoundationCaptureIdentity {
	session: string; viewId: string; documentId: string; pageVersion: number; route: string; nonce: string;
}
export interface FoundationCaptureRequest { identity: FoundationCaptureIdentity; webviewId: string; }
export interface FoundationCaptureWitness {
	nonce: string; session: string; viewId: string; documentId: string; pageSequence: number; route: string;
	ready: boolean; inspect: boolean; viewportWidth: number; viewportHeight: number; devicePixelRatio: number;
	scrollX: number; scrollY: number; requestedTheme: 'light' | 'dark'; observedColorScheme: 'light' | 'dark'; reducedMotion: boolean;
}
export interface FoundationCaptureResult {
	pngBase64: string; capturedAt: string; identity: FoundationCaptureIdentity;
	conditions: Omit<FoundationCaptureWitness, 'nonce' | 'session' | 'viewId' | 'documentId' | 'route' | 'ready' | 'inspect'> & { canvasScale: number; pixelWidth: number; pixelHeight: number };
}
export interface FoundationCanvasRect { x: number; y: number; width: number; height: number; }
export interface FoundationCanvasGeometry { rect: FoundationCanvasRect; captureRect: FoundationCanvasRect; frameName: string; url: string; viewportWidth: number; viewportHeight: number; }

/** The public command accepts only a bound runtime identity, never capture coordinates. */
export function validFoundationCaptureIdentity(value: unknown): value is FoundationCaptureIdentity {
	if (!value || typeof value !== 'object' || Array.isArray(value)) { return false; }
	const item = value as Record<string, unknown>;
	return Object.keys(item).length === 6 && ['session', 'viewId', 'documentId'].every(key => typeof item[key] === 'string' && /^[a-f0-9]{32}$/.test(item[key] as string))
		&& typeof item.nonce === 'string' && /^[a-f0-9]{32}$/.test(item.nonce)
		&& Number.isSafeInteger(item.pageVersion) && (item.pageVersion as number) >= 1
		&& typeof item.route === 'string' && item.route.length <= 512 && /^\/[A-Za-z0-9/._~!$&'()*+,;=@-]*$/.test(item.route)
		&& !item.route.includes('//') && !item.route.split('/').some(part => part === '.' || part === '..') && !/^\/__foundation(?:\/|$)/.test(item.route);
}

/** A fresh page-owned witness binds the pixels to the current document, not an old heartbeat. */
export function validFoundationCaptureWitness(value: unknown, expected: FoundationCaptureIdentity): value is FoundationCaptureWitness {
	if (!value || typeof value !== 'object' || Array.isArray(value)) { return false; }
	const item = value as Record<string, unknown>;
	const keys = ['nonce', 'session', 'viewId', 'documentId', 'pageSequence', 'route', 'ready', 'inspect', 'viewportWidth', 'viewportHeight', 'devicePixelRatio', 'scrollX', 'scrollY', 'requestedTheme', 'observedColorScheme', 'reducedMotion'];
	return Object.keys(item).length === keys.length && keys.every(key => Object.hasOwn(item, key))
		&& ['nonce', 'session', 'viewId', 'documentId', 'route'].every(key => item[key] === expected[key as keyof FoundationCaptureIdentity])
		&& Number.isSafeInteger(item.pageSequence) && (item.pageSequence as number) >= 1 && item.ready === true && item.inspect === false
		&& ['viewportWidth', 'viewportHeight'].every(key => Number.isSafeInteger(item[key]) && (item[key] as number) >= 1 && (item[key] as number) <= 4096)
		&& typeof item.devicePixelRatio === 'number' && Number.isFinite(item.devicePixelRatio) && item.devicePixelRatio >= 0.5 && item.devicePixelRatio <= 4
		&& ['scrollX', 'scrollY'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]) && Math.abs(item[key] as number) <= 1000000)
		&& ['light', 'dark'].includes(item.requestedTheme as string) && ['light', 'dark'].includes(item.observedColorScheme as string) && typeof item.reducedMotion === 'boolean';
}

/** Runs only in the trusted workbench or its owned webview wrapper; no caller selector or script. */
function inspectFoundationCanvas(mode: 'outer' | 'inner', webviewId: string, canvasRect?: FoundationCanvasRect): FoundationCanvasGeometry {
	const fail = (): never => { throw new Error('canvas-unavailable'); };
	const validRect = (rect: FoundationCanvasRect): boolean => !!rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key as keyof FoundationCanvasRect])) && rect.x >= 0 && rect.y >= 0 && rect.width >= 1 && rect.height >= 1 && rect.width <= 8192 && rect.height <= 8192;
	const inside = (a: FoundationCanvasRect, b: FoundationCanvasRect): boolean => a.x >= b.x - 0.01 && a.y >= b.y - 0.01 && a.x + a.width <= b.x + b.width + 0.01 && a.y + a.height <= b.y + b.height + 0.01;
	const visible = (owner: Document, target: HTMLIFrameElement, rect: FoundationCanvasRect, allowScale: boolean): void => {
		const view = owner.defaultView;
		if (!view || !validRect(rect) || !inside(rect, { x: 0, y: 0, width: view.innerWidth, height: view.innerHeight }) || !inside(rect, target.getBoundingClientRect())) { return fail(); }
		for (let element: Element | null = target; element; element = element.parentElement) {
			const style = view.getComputedStyle(element);
			if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) !== 1 || style.filter !== 'none' || style.mixBlendMode !== 'normal' || Number(style.zoom) !== 1) { return fail(); }
			if (style.clipPath !== 'none') {
				// Code OSS uses a rectangular content-box clip around its owned webview.
				// Unknown shapes and rounded clips remain unsupported; never skip clipping.
				if (allowScale || style.clipPath !== 'content-box' || [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].some(value => value !== '0px')) { return fail(); }
				const lengths = [style.borderLeftWidth, style.paddingLeft, style.borderTopWidth, style.paddingTop, style.borderRightWidth, style.paddingRight, style.borderBottomWidth, style.paddingBottom];
				if (lengths.some(value => !/^\d+(?:\.\d+)?px$/.test(value))) { return fail(); }
				const [leftBorder, leftPadding, topBorder, topPadding, rightBorder, rightPadding, bottomBorder, bottomPadding] = lengths.map(value => parseFloat(value));
				const box = element.getBoundingClientRect(), left = leftBorder + leftPadding, top = topBorder + topPadding;
				if (!inside(rect, { x: box.x + left, y: box.y + top, width: box.width - left - rightBorder - rightPadding, height: box.height - top - bottomBorder - bottomPadding })) { return fail(); }
			}
			if (style.transform !== 'none') {
				const matrix = new DOMMatrixReadOnly(style.transform);
				if (!matrix.is2D || matrix.b !== 0 || matrix.c !== 0 || matrix.a <= 0 || Math.abs(matrix.a - matrix.d) > 0.000001 || !allowScale && Math.abs(matrix.a - 1) > 0.000001) { return fail(); }
			}
			if (element !== target && (/(hidden|clip|scroll|auto)/.test(style.overflowX) || /(hidden|clip|scroll|auto)/.test(style.overflowY))) {
				const box = element.getBoundingClientRect();
				if (!inside(rect, { x: box.x, y: box.y, width: box.width, height: box.height })) { return fail(); }
			}
		}
		const targetStyle = view.getComputedStyle(target);
		if (parseFloat(targetStyle.borderLeftWidth) || parseFloat(targetStyle.borderTopWidth) || parseFloat(targetStyle.borderRightWidth) || parseFloat(targetStyle.borderBottomWidth)) { return fail(); }
		const overlap = (box: DOMRect): FoundationCanvasRect | undefined => {
			const x = Math.max(rect.x, box.x), y = Math.max(rect.y, box.y), right = Math.min(rect.x + rect.width, box.right), bottom = Math.min(rect.y + rect.height, box.bottom);
			return right > x + 0.01 && bottom > y + 0.01 ? { x, y, width: right - x, height: bottom - y } : undefined;
		};
		const topIsTarget = (box: FoundationCanvasRect): boolean => {
			const insetX = Math.min(0.5, box.width / 4), insetY = Math.min(0.5, box.height / 4);
			return [[box.x + insetX, box.y + insetY], [box.x + box.width - insetX, box.y + insetY], [box.x + insetX, box.y + box.height - insetY], [box.x + box.width - insetX, box.y + box.height - insetY], [box.x + box.width / 2, box.y + box.height / 2]].every(([x, y]) => owner.elementFromPoint(x, y) === target);
		};
		if (!topIsTarget(rect)) { return fail(); }
		const elements = owner.querySelectorAll('*');
		if (elements.length > 30000) { return fail(); }
		for (const element of elements) {
			if (element === target || element.contains(target) || target.contains(element)) { continue; }
			const style = view.getComputedStyle(element);
			if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) { continue; }
			const intersection = overlap(element.getBoundingClientRect());
			if (!intersection) { continue; }
			// Check each overlapping element's intersection, not only canvas corners.
			if (!topIsTarget(intersection)) { return fail(); }
			// Hit testing omits pointer-events:none overlays. Conservatively reject painted floating overlays.
			const floating = ['fixed', 'absolute'].includes(style.position) && style.zIndex !== 'auto' && Number(style.zIndex) >= 0;
			const knownOverlay = element.matches('.monaco-hover,.notification-toast,.context-view,.quick-input-widget,.monaco-dialog-box,[role="dialog"],[role="tooltip"],[popover]:popover-open');
			if (knownOverlay || style.pointerEvents === 'none' && floating && (element.textContent?.trim() || style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none' || style.boxShadow !== 'none')) { return fail(); }
		}
	};
	let owner = document;
	let active: HTMLIFrameElement | null = null;
	let offsetX = 0, offsetY = 0;
	if (mode === 'inner') {
		active = document.getElementById('active-frame') as HTMLIFrameElement | null;
		if (!active?.contentDocument || active.contentDocument.readyState !== 'complete') { return fail(); }
		const box = active.getBoundingClientRect();
		// Chromium rounds viewport integers independently at fractional window zoom.
		// This tolerance applies only to the wrapper's viewport dimensions, never clipping.
		if (box.x !== 0 || box.y !== 0 || Math.abs(box.width - innerWidth) > 1 || Math.abs(box.height - innerHeight) > 1) { return fail(); }
		owner = active.contentDocument; offsetX = box.x; offsetY = box.y;
	}
	const candidates = mode === 'outer'
		? [...owner.querySelectorAll<HTMLIFrameElement>('iframe.webview')].filter(frame => frame.name === webviewId)
		: [...owner.querySelectorAll<HTMLIFrameElement>('.runtime-studio .design-canvas .design-viewport > iframe[data-foundation-runtime-canvas]')];
	if (candidates.length !== 1) { return fail(); }
	const target = candidates[0];
	if (!target.isConnected || target.inert || target.clientWidth < 1 || target.clientHeight < 1) { return fail(); }
	const bounds = target.getBoundingClientRect();
	const rect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
	if (!validRect(rect)) { return fail(); }
	if (mode === 'outer' && (!canvasRect || !validRect(canvasRect))) { return fail(); }
	// Only native-derived inner geometry enters this internal script. The public
	// command never accepts a rectangle. A clipped wrapper is safe when this canvas is visible.
	const captureRect = mode === 'outer'
		? { x: rect.x + canvasRect!.x, y: rect.y + canvasRect!.y, width: canvasRect!.width, height: canvasRect!.height }
		: rect;
	visible(owner, target, captureRect, mode === 'inner');
	const translated = { x: captureRect.x + offsetX, y: captureRect.y + offsetY, width: captureRect.width, height: captureRect.height };
	if (active) { visible(document, active, translated, false); }
	return { rect: { x: rect.x + offsetX, y: rect.y + offsetY, width: rect.width, height: rect.height }, captureRect: translated, frameName: target.name, url: target.src, viewportWidth: target.clientWidth, viewportHeight: target.clientHeight };
}

/** Serializes fixed audited code; dynamic values are JSON data, never executable fragments. */
export function foundationCanvasGeometryScript(mode: 'outer' | 'inner', webviewId: string, canvasRect?: FoundationCanvasRect): string {
	return `(${inspectFoundationCanvas.toString()})(${JSON.stringify(mode)},${JSON.stringify(webviewId)},${JSON.stringify(canvasRect)})`;
}
