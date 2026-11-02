/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { FoundationCaptureIdentity, validFoundationCaptureIdentity } from '../../../../platform/native/common/foundationCanvasCapture.js';
import { IWebviewService } from '../browser/webview.js';
import { localize } from '../../../../nls.js';

CommandsRegistry.registerCommand('_foundation.captureActiveCanvas', async (accessor, input: FoundationCaptureIdentity) => {
	const unavailable = (): never => { throw new Error(localize('foundationCanvasCaptureUnavailable', "Foundation could not capture this canvas. Keep the running preview visible, unobstructed, and unchanged, then try again.")); };
	if (!validFoundationCaptureIdentity(input)) { return unavailable(); }
	const service = accessor.get(IWebviewService), native = accessor.get(INativeHostService), log = accessor.get(ILogService);
	const candidates = [...service.webviews].filter(view => {
		const element = (view as typeof view & { element?: HTMLIFrameElement }).element;
		return view.extension?.id.value === 'foundation.foundation-workspace' && view.providedViewType === 'foundation.workspace'
			&& element?.isConnected && getWindow(element) === mainWindow && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
	});
	if (candidates.length !== 1) { return unavailable(); }
	const view = candidates[0], element = (view as typeof view & { element: HTMLIFrameElement }).element;
	const name = element.name, bounds = JSON.stringify(element.getBoundingClientRect().toJSON());
	try {
		const result = await native.captureFoundationCanvas({ identity: { ...input }, webviewId: name });
		if (![...service.webviews].includes(view) || !element.isConnected || element.name !== name || getWindow(element) !== mainWindow
			|| view.extension?.id.value !== 'foundation.foundation-workspace' || view.providedViewType !== 'foundation.workspace' || JSON.stringify(element.getBoundingClientRect().toJSON()) !== bounds) { return unavailable(); }
		return result;
	} catch (error) {
		// Log only a fixed native stage, never runtime URLs, source, identities or error text.
		const code = error instanceof Error ? /^foundation-canvas-capture-unavailable:(request|window|ownership|geometry-inner|geometry-outer|runtime|witness-before|bounds|capture|identity-after|witness-after|geometry-inner-after|geometry-outer-after|result)$/.exec(error.message)?.[1] : undefined;
		log.warn(`[Foundation canvas capture] ${code ?? 'unavailable'}`);
		return unavailable();
	}
});
