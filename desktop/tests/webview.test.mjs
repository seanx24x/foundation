import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { buildDesignPreview } from "../extension/src/design-preview.mjs";
import { listDesignTokens } from "../../server/project/proposals.mjs";
import { createProjectService } from "../../server/project/workspace.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const service = createProjectService({ root });
const project = await service.open(join(root, "projects/orbit"));
const file = await service.getFile(project.id, "src/components/SaveButton.tsx");
const styles = await service.getFile(project.id, "src/styles/tokens.css");
const initial = {
  type: "state",
  project,
  activeFile: file,
  openFiles: [file, styles],
  dirtyPaths: [],
  trusted: true,
  provider: { configured: false, reason: "No model provider configured." },
  changes: [],
  selection: { startLine: 3, endLine: 3 },
};
const artifacts = join(root, "desktop/tests/artifacts");
const impactFor = (token) => {
  const target={kind:'token',path:token.path,revision:token.revision,name:token.name,occurrence:token.occurrence};
  return {status:'ready',id:'verified-impact',target,result:{schemaVersion:1,projectId:project.id,target,scope:{kind:'css-declaration',label:token.scope,source:{path:token.path,revision:token.revision,line:token.line,column:1}},manifest:[{path:token.path,revision:token.revision}],basisDigest:'a'.repeat(64),analyzedAt:'2026-10-31T00:00:00.000Z',consumers:[],tokenReferences:[],declarations:[],limits:[],counts:{indexed:1,analyzed:1},truncated:false},relatedScenarios:[],dirtyPaths:[]};
};

test("native webview uses real source snapshots across themes, widths, and interaction states", async (t) => {
  const errors = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/theme.css") {
        const theme = JSON.parse(
          await readFile(
            join(
              root,
              `desktop/extension/themes/foundation-${url.searchParams.get("theme") === "light" ? "light" : "dark"}.json`,
            ),
            "utf8",
          ),
        );
        response.setHeader("Content-Type", "text/css");
        response.end(
          `:root { ${Object.entries(theme.colors)
            .map(
              ([key, value]) =>
                `--vscode-${key.replaceAll(".", "-")}:${value};`,
            )
            .join("")} }`,
        );
      } else if (url.pathname.startsWith('/fonts/') && /^\/fonts\/[a-z-]+\.woff2$/.test(url.pathname)) {
        response.setHeader('Content-Type', 'font/woff2'); response.end(await readFile(join(root, 'desktop/extension/media', url.pathname.slice(1))));
      } else if (
        url.pathname === "/artifact-model.js" ||
        url.pathname === "/workspace-model.js" ||
        url.pathname === "/webview.js" ||
        url.pathname === "/webview.css"
      ) {
        response.setHeader(
          "Content-Type",
          url.pathname.endsWith(".js") ? "application/javascript" : "text/css",
        );
        response.end(
          await readFile(
            join(root, "desktop/extension/media", url.pathname.slice(1)),
          ),
        );
      } else if (url.pathname === "/trusted-parent") {
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self'; style-src 'nonce-parent';"><style nonce="parent">body{margin:0}iframe{display:block;width:100vw;height:100vh;border:0}</style><title>Native parent message harness</title></head><body><iframe id="trusted-webview" title="Foundation content" src="/"></iframe></body></html>`);
      } else if (url.pathname === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'nonce-harness'; script-src 'nonce-harness'; frame-src 'self'; form-action 'none'; img-src 'self' data:; font-src 'self'; connect-src 'none'"><link rel="stylesheet" href="/theme.css?theme=${url.searchParams.get("theme") === "light" ? "light" : "dark"}"><link rel="stylesheet" href="/webview.css"><title>Foundation webview verification</title></head><body><div id="foundation-root"></div><script nonce="harness" src="/workspace-model.js"></script><script nonce="harness" src="/artifact-model.js"></script><script nonce="harness" src="/webview.js"></script></body></html>`,
        );
      } else {
        response.writeHead(404).end();
      }
    } catch (error) {
      response.writeHead(500).end(error.message);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.outbound = [];
    let persisted;
    window.acquireVsCodeApi = () => ({
      getState: () => persisted,
      setState: (value) => {
        persisted = value;
        window.savedView = value;
      },
      postMessage: (message) => window.outbound.push(message),
    });
    if (window.location.pathname === "/") {
      // Match getVsCodeApiScript in the pinned Code OSS pre/index.html bootstrap.
      // The genuine MessageEvent.source is still the outer frame after this.
      window.parent = window;
      window.top = window;
      window.frameElement = null;
    }
  });
  const dispatch = (data) => page.evaluate((message) => new Promise((resolve) => {
    const received = (event) => {
      if (event.source !== window || event.data?.type !== message.type) return;
      window.removeEventListener("message", received);
      resolve();
    };
    window.addEventListener("message", received);
    window.postMessage(message, window.location.origin);
  }), data);
  // Production AI messages are correlated to one request. Explicit requestId
  // overrides remain available to verify that late messages are rejected.
  const send = async (data) => {
    if (data.type === "ai" && data.requestId === undefined) {
      const requestId = await page.evaluate(() => window.outbound.filter(message => message.type === "ask").at(-1)?.requestId);
      assert.equal(typeof requestId, "string", "AI fixture requires a real outbound request");
      data = { ...data, requestId };
    }
    return dispatch(data);
  };
  const hostState = async (overrides = {}) => {
    await send({ ...initial, ...overrides });
    await page.locator(".workspace-footer").waitFor();
  };
  const mode = async (name) => {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("main", { name: `${name} workspace` }).waitFor();
  };
  const noOverflow = async (label) => {
    const overflow = await page.evaluate(() => {
      const main = document.querySelector("main");
      return {
        document: document.documentElement.scrollWidth > innerWidth,
        content: main.scrollWidth > main.clientWidth + 1,
      };
    });
    assert.deepEqual(overflow, { document: false, content: false }, label);
  };
  await mkdir(artifacts, { recursive: true });
  for (const theme of ["dark", "light"]) {
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?theme=${theme}`,
    );
    assert.equal(
      await page
        .getByRole("heading", { name: "Connecting to the editor" })
        .count(),
      1,
    );
    await hostState();
    for (const width of [1280, 700, 360]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of ["Understand", "Refine", "Review", "Assistant"]) {
        await mode(name);
        await noOverflow(`${theme} ${width}px ${name}`);
      }
    }
    await mode("Understand");
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(
      await page
        .getByRole("heading", { name: "SaveButton", exact: true })
        .count(),
      1,
    );
    await page
      .getByRole("button", { name: "function SaveButton exported 3" })
      .click();
    assert.deepEqual((await page.evaluate(() => window.outbound)).at(-1), {
      type: "navigate",
      path: file.path,
      line: 3,
    });
    await page.screenshot({ path: join(artifacts, `understand-${theme}.png`) });
  }

  await mode("Refine");
  await hostState({ activeFile: styles, selection: null });
  assert.equal(await page.getByText("Network off", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "Start preview", exact: true }).click();
  assert.deepEqual((await page.evaluate(() => window.outbound)).at(-1), { type: "designStart", entry: "src/App.tsx" });
  const tokens = [{ id: "background", path: styles.path, revision: styles.revision, name: "--orbit-bg", value: "#f8faf9", line: 2, occurrence: 0, scope: ":root" }];
  const design = { status: "ready", entry: "src/App.tsx", entries: ["src/App.tsx"], session: "test-design", revision: "test-revision", compilation: "passed", tokens,
    html: `<html><body><button id="save">Save changes</button><script nonce="harness">window.marker=1;parent.postMessage({channel:'foundation-design',session:'test-design',type:'ready'},'*');document.querySelector('button').onclick=()=>{parent.postMessage({type:'state',trusted:false},'*');parent.postMessage({channel:'foundation-design',session:'test-design',type:'selection',intent:'select',selection:{path:'src/components/SaveButton.tsx',tag:'button',label:'Save changes',rect:{width:120,height:36},styles:{color:'rgb(255, 255, 255)',fontSize:'14px'}}},'*')};<\/script></body></html>` };
  await hostState({ design, activeFile: styles, selection: null });
  const preview = page.frameLocator('iframe[title="Live design preview"]');
  await preview.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("120 px", { exact: true }).waitFor();
  assert.equal(await page.getByText("120 px", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Trust this folder", { exact: true }).count(), 0, "sandbox source cannot forge host state");
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts allow-forms');
  await page.locator('.design-token').first().click();
  const tokenInput = page.getByRole('textbox', { name: 'Experiment value for --orbit-bg' });
  await tokenInput.fill('calc(10px + 2px)');
  assert.equal(await page.getByRole('button', { name: 'Review token change' }).isDisabled(), true);
  await tokenInput.fill('#ffffff');
  assert.equal(await page.getByText('Experiment only. Source is unchanged.', { exact: true }).count(), 1);
  await hostState({ design, activeFile: styles, designImpact: impactFor(tokens[0]) });
  await page.getByRole('button', { name: 'Review token change' }).click();
  assert.deepEqual((await page.evaluate(() => window.outbound)).at(-1), { type: 'designPropose', impactId: 'verified-impact', path: styles.path, revision: styles.revision, name: '--orbit-bg', occurrence: 0, value: '#ffffff' });
  const { html, ...designWithoutHTML } = design;
  await hostState({ design: designWithoutHTML, activeFile: styles });
  assert.equal(await preview.locator('body').evaluate(() => window.marker), 1, 'same-session source updates retain the running frame');
  assert.equal((await page.evaluate(() => window.outbound.filter(message => message.type === 'designObserved' && message.event === 'selection').at(-1))).intent, 'select', 'explicit canvas selection is distinct from a measurement update');
  assert.equal(await page.evaluate(() => window.outbound.filter(message => message.type === 'ask').length), 0, 'selection and local experiments never dispatch AI');

  const separator = page.getByRole('separator', { name: 'Resize inspector' });
  await expect(separator).toHaveAttribute('aria-orientation', 'vertical');
  await expect(separator).toHaveAttribute('aria-controls', 'design-inspector');
  await expect(separator).toHaveAttribute('aria-valuenow', '320');
  await separator.focus();
  await separator.press('Home');
  await expect(separator).toHaveAttribute('aria-valuenow', '280');
  await separator.press('Shift+ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', '312');
  await separator.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', '316');
  await hostState({ design: designWithoutHTML, activeFile: styles });
  await expect(separator).toBeFocused();
  await separator.press('End');
  await expect(separator).toHaveAttribute('aria-valuenow', '480');
  await separator.dblclick();
  await expect(separator).toHaveAttribute('aria-valuenow', '320');
  // Locator clicks scroll a tall separator's center into view. Drag from the
  // actual visible intersection, not an offscreen offset from its full bounds.
  const gripPoint = await separator.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const viewport = document.querySelector('.workspace-content').getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: (Math.max(bounds.top, viewport.top, 0) + Math.min(bounds.bottom, viewport.bottom, innerHeight)) / 2 };
  });
  assert.equal(await page.evaluate(point => Boolean(document.elementFromPoint(point.x, point.y)?.closest('.resize-separator')), gripPoint), true, 'drag begins on the visible separator');
  await page.mouse.move(gripPoint.x, gripPoint.y);
  await page.mouse.down();
  await page.mouse.move(gripPoint.x - 43, gripPoint.y, { steps: 4 });
  await page.mouse.up();
  await expect(separator).toHaveAttribute('aria-valuenow', '364');
  assert.equal(await page.evaluate(id => window.savedView.layouts[id].inspectorWidth, project.id), 364, 'committed width persists on the 4px grid');

  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.locator('.studio-layout')).toHaveClass(/is-compact/);
  const inspectorToggle = page.getByRole('button', { name: 'Inspector', exact: true });
  await expect(inspectorToggle).toBeVisible();
  await expect(separator).toBeHidden();
  await inspectorToggle.click();
  await expect(page.locator('#design-inspector')).toBeVisible();
  await expect(page.locator('.design-stage')).toBeHidden();
  const backToCanvas = page.getByRole('button', { name: 'Back to canvas', exact: true });
  await expect(backToCanvas).toBeFocused();
  await backToCanvas.click();
  await expect(page.locator('#design-inspector')).toBeHidden();
  await expect(page.locator('.design-stage')).toBeVisible();
  await expect(inspectorToggle).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(separator).toHaveAttribute('aria-valuenow', '364');
  assert.equal(await preview.locator('body').evaluate(() => window.marker), 1, 'resizing and compact focus keep the same runtime');
  await separator.dblclick();
  for (const width of [1280, 700, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(`connected design ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('main').evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: join(artifacts, "refine-light.png") });
  await page.getByRole('button', { name: 'Reset experiments' }).click();
  assert.equal(await page.getByText('1 experiment in this canvas.', { exact: false }).count(), 0);

  const previewFiles = await Promise.all(project.files.map((entry) => service.getFile(project.id, entry.path)));
  const built = buildDesignPreview({ files: previewFiles, entry: 'src/App.tsx', nonce: 'harness', session: 'real-design-preview', runtimeSource: await readFile(join(root, 'desktop/extension/media/preview-runtime.js'), 'utf8') });
  const connectedDesign = { ...built, status: 'ready', session: 'real-design-preview', entries: ['src/App.tsx'], compilation: 'passed', tokens: listDesignTokens(previewFiles) };
  await hostState({ design: connectedDesign });
  const live = page.frameLocator('iframe[title="Live design preview"]');
  await live.locator('.save-button').click();
  await expect(page.locator('.element-label')).toContainText('Save changes');
  const radius = page.locator('.design-token').filter({ hasText: '--orbit-radius' }).first();
  await radius.click();
  await page.getByRole('textbox', { name: 'Experiment value for --orbit-radius' }).fill('24px');
  await expect(live.locator('form')).toHaveCSS('border-radius', '24px');
  await page.getByRole('button', { name: 'Reset experiments' }).click();
  await expect(live.locator('form')).toHaveCSS('border-radius', '8px');
  const greenToken = page.locator('.design-token').filter({ hasText: '--orbit-green' }).filter({ hasNotText: '--orbit-green-soft' }).first();
  await greenToken.click();
  const greenInput = page.getByRole('textbox', { name: 'Experiment value for --orbit-green', exact: true });
  await greenInput.focus();
  await greenInput.press('ControlOrMeta+A');
  await hostState({ design: { ...connectedDesign, html: undefined } });
  assert.deepEqual(await greenInput.evaluate((input) => [input.selectionStart, input.selectionEnd]), [0, 7], 'host update preserves Select All');
  let typed = '';
  for (const character of '#285e47') {
    await page.keyboard.type(character);
    typed += character;
    const before = await page.evaluate(() => window.outbound.filter((message) => message.type === 'designObserved' && message.event === 'selection').length);
    await live.locator('body').evaluate(() => window.dispatchEvent(new Event('resize')));
    await expect.poll(() => page.evaluate(() => window.outbound.filter((message) => message.type === 'designObserved' && message.event === 'selection').length)).toBeGreaterThan(before);
    await hostState({ design: { ...connectedDesign, html: undefined } });
    await expect(greenInput).toHaveValue(typed);
    assert.equal(await greenInput.evaluate((input) => document.activeElement === input), true, 'typing retains focus across runtime and host updates');
    assert.deepEqual(await greenInput.evaluate((input) => [input.selectionStart, input.selectionEnd]), [typed.length, typed.length], 'typing retains its caret');
  }
  await expect(live.locator('.save-button')).toHaveCSS('background-color', 'rgb(40, 94, 71)');
  await hostState({ design: { ...connectedDesign, html: undefined }, designImpact: impactFor(connectedDesign.tokens.find(token => token.name === '--orbit-green')) });
  await page.getByRole('button', { name: 'Review token change' }).click();
  assert.equal((await page.evaluate(() => window.outbound)).at(-1).value, '#285e47');
  await greenInput.focus();
  await greenInput.press('ControlOrMeta+A');
  await page.keyboard.type('#');
  await hostState({ design: { ...connectedDesign, html: undefined } });
  await expect(greenInput).toHaveValue('#');
  assert.equal(await page.getByRole('button', { name: 'Review token change' }).isDisabled(), true);
  await expect(live.locator('.save-button')).toHaveCSS('background-color', 'rgb(40, 94, 71)');
  await page.getByRole('button', { name: 'Reset experiments' }).click();
  await expect(greenInput).toHaveValue('#34674e');
  await expect(live.locator('.save-button')).toHaveCSS('background-color', 'rgb(52, 103, 78)');
  await expect(page.locator('.computed-properties dt').filter({ hasText: /^Fill$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('rgb(52, 103, 78)');
  await live.getByRole('textbox', { name: 'Full name', exact: true }).fill('Unsubmitted canvas draft');
  await live.locator('body').evaluate(() => { window.retainedWorkspaceMarker = 'same-running-frame'; });
  const requestsBeforeActivities = await page.evaluate(() => window.outbound.filter(message => message.type === 'ask').length);
  for (const next of ['Understand', 'Assistant', 'Review']) {
    await mode(next);
    await expect(page.locator('.workspace-design-slot')).toBeHidden();
    await live.locator('body').evaluate(() => parent.postMessage({ channel: 'foundation-design', session: 'real-design-preview', type: 'selection', intent: 'select', selection: { path: 'src/App.tsx', tag: 'div', label: 'HIDDEN_SELECTION', rect: { x: 0, y: 0, width: 0, height: 0 }, styles: {} } }, '*'));
    await mode('Refine');
    await expect(live.getByRole('textbox', { name: 'Full name', exact: true })).toHaveValue('Unsubmitted canvas draft');
    assert.equal(await live.locator('body').evaluate(() => window.retainedWorkspaceMarker), 'same-running-frame', 'switching activities preserves the browsing context');
    await expect(page.locator('.element-label')).toContainText('Save changes');
  }
  assert.equal(await page.evaluate(() => window.outbound.filter(message => message.type === 'ask').length), requestsBeforeActivities, 'activity changes do not share context or start provider requests');
  await live.locator('body').evaluate(() => parent.postMessage({ channel: 'foundation-design', session: 'test-design', type: 'selection', intent: 'select', selection: { path: 'src/App.tsx', tag: 'div', label: 'OLD_SESSION_SELECTION', rect: { x: 0, y: 0, width: 0, height: 0 }, styles: {} } }, '*'));
  await expect(page.locator('.element-label')).toContainText('Save changes');
  await live.locator('.save-button').click();
  await expect(page.locator('.computed-properties dt').filter({ hasText: /^Fill$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('rgb(52, 103, 78)');
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Preview color theme' }).selectOption(theme);
    await expect(live.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [1280, 700, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(`real design ${theme} ${width}px`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('main').evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: join(artifacts, `design-studio-${theme}.png`) });
  }

  await mode("Assistant");
  await hostState();
  const question = page.getByRole("textbox", { name: "Ask about your source" });
  await question.fill("How does saving work?");
  assert.equal(
    await page.getByRole("button", { name: "Set up AI", exact: true }).isEnabled(),
    true,
  );
  await hostState({
    provider: {
      configured: true,
      provider: "Harness provider",
      model: "Test model",
      transport: "local",
    },
  });
  assert.equal(await question.inputValue(), "How does saving work?");
  assert.equal(
    await question.evaluate((el) => document.activeElement === el),
    true,
  );
  const secondContext = page.getByRole("checkbox").nth(1);
  await secondContext.focus();
  await page.keyboard.press("Space");
  assert.equal(await secondContext.isChecked(), true);
  assert.equal(
    await secondContext.evaluate((el) => document.activeElement === el),
    true,
  );
  await page.keyboard.press("Space");
  assert.equal(await secondContext.isChecked(), false);
  await hostState({
    provider: {
      configured: true,
      provider: "Harness provider",
      model: "Test model",
      transport: "local",
    },
    dirtyPaths: [file.path],
  });
  assert.equal(
    await page.getByRole("button", { name: "Ask", exact: true }).isDisabled(),
    true,
  );
  await hostState({
    provider: {
      configured: true,
      provider: "Harness provider",
      model: "Test model",
      transport: "local",
    },
  });
  await question.focus();
  await page.keyboard.press("Control+Enter");
  const ask = (await page.evaluate(() => window.outbound)).at(-1);
  assert.match(ask.requestId, /^request-[\da-f-]+$/i);
  assert.deepEqual(ask, {
    type: "ask",
    requestId: ask.requestId,
    prompt: "How does saving work?",
    intent: "ask",
    context: [{ path: file.path, revision: file.revision }],
  });
  await send({ type: "ai", event: { type: "start", model: "Test model" } });
  await send({ type: "ai", requestId: "request-obsolete", event: { type: "delta", text: "WRONG_REQUEST" } });
  await send({
    type: "ai",
    event: {
      type: "delta",
      text: "Uses the saving state [S1:4]. <img src=x onerror=alert(1)> [S1:999]",
    },
  });
  assert.equal((await page.locator(".answer-text").innerText()).includes("WRONG_REQUEST"), false);
  assert.equal(await page.locator(".answer-text img").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "SaveButton.tsx:4", exact: true })
      .count(),
    1,
  );
  assert.equal(await page.locator(".citation").count(), 1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  assert.deepEqual((await page.evaluate(() => window.outbound)).at(-1), {
    type: "cancel", requestId: ask.requestId,
  });
  await expect(page.locator('.artifact-status').filter({ hasText: /^Stopping…$/ })).toHaveCount(1);
  assert.equal(await page.locator('#ask-submit').isDisabled(), true, "composer waits for host cancellation acknowledgement");
  await send({
    type: "ai",
    event: { type: "delta", text: "SHOULD_NOT_APPEAR" },
  });
  assert.ok(
    (await page.locator(".answer-text").innerText()).includes(
      "Uses the saving state",
    ),
  );
  assert.ok(
    !(await page.locator(".answer-text").innerText()).includes(
      "SHOULD_NOT_APPEAR",
    ),
  );
  await send({ type: "ai", requestId: "request-obsolete", event: { type: "done" } });
  await expect(page.locator('.artifact-status').filter({ hasText: /^Stopping…$/ })).toHaveCount(1);
  await send({ type: "ai", event: { type: "cancelled" } });
  assert.equal(
    await page.getByText("Cancelled · partial preserved", { exact: true }).count(),
    1,
  );
  await send({ type: "ai", event: { type: "delta", text: "AFTER_CANCELLATION" } });
  assert.equal((await page.locator(".answer-text").innerText()).includes("AFTER_CANCELLATION"), false);
  await hostState({
    activeFile: { ...file, revision: "changedrevision" },
    openFiles: [{ ...file, revision: "changedrevision" }, styles],
  });
  assert.equal(
    await page
      .getByText("Saved source changed. This response describes its original snapshots", { exact: false })
      .count(),
    1,
  );
  await page.setViewportSize({ width: 360, height: 900 });
  await noOverflow("assistant partial answer narrow");
  await page.screenshot({
    path: join(artifacts, "assistant-light-narrow.png"),
  });
  await mode("Review");
  await hostState({
    changes: [
      {
        path: file.path,
        baseRevision: file.revision,
        revision: "changed",
        conflict: true,
      },
    ],
  });
  await page.locator(".change-row").filter({ hasText: file.path }).click();
  assert.deepEqual((await page.evaluate(() => window.outbound)).at(-1), {
    type: "reviewFile",
    path: file.path,
  });
  const proposal = { id: 'proposal-test', projectId: project.id, title: 'Refine the save control', summary: 'A contained adjustment to the selected source.', path: file.path, baseRevision: file.revision, before: file.source, after: file.source.replace("Saving…", "Saving your changes…"), origin: 'ai', status: 'proposed', context: [{ path: styles.path, revision: styles.revision }], verification: ['Check the loading label at phone width.'] };
  await hostState({ proposal });
  await page.getByRole('button', { name: 'Open native diff' }).click();
  assert.deepEqual((await page.evaluate(() => window.outbound)).at(-1), { type: 'proposalDiff', id: proposal.id });
  await hostState({ proposal, dirtyPaths: [file.path] });
  assert.equal(await page.getByRole('button', { name: 'Apply to source' }).isDisabled(), true);
  await hostState({ proposal, dirtyPaths: [styles.path] });
  assert.equal(await page.getByRole('button', { name: 'Apply to source' }).isDisabled(), true);
  await hostState({ proposal });
  await page.getByRole('button', { name: 'Apply to source' }).click();
  assert.deepEqual((await page.evaluate(() => window.outbound)).at(-1), { type: 'proposalApply', id: proposal.id });
  const appliedFile = { ...file, source: proposal.after, revision: 'applied-test' };
  await hostState({ proposal: { ...proposal, status: 'applied', appliedRevision: appliedFile.revision }, activeFile: appliedFile, openFiles: [appliedFile, styles] });
  await page.getByRole('button', { name: 'Undo Foundation change' }).click();
  assert.deepEqual((await page.evaluate(() => window.outbound)).at(-1), { type: 'proposalUndo', id: proposal.id });
  await mode('Assistant');
  await hostState({ provider: { configured: true, provider: 'Harness', model: 'Test', transport: 'local' } });
  await page.getByRole('button', { name: 'Build mode', exact: true }).click();
  await question.fill('Improve the loading label.');
  await page.getByRole('button', { name: 'Propose change', exact: true }).click();
  const changeRequest = (await page.evaluate(() => window.outbound)).at(-1);
  assert.equal(changeRequest.intent, 'build');
  assert.notEqual(changeRequest.requestId, ask.requestId);
  await send({ type: 'ai', requestId: ask.requestId, event: { type: 'cancelled' } });
  assert.equal(await question.isDisabled(), true, 'late cancellation cannot stop a newer request');
  await send({ type: 'ai', event: { type: 'start', model: 'Test' } });
  await send({ type: 'ai', event: { type: 'proposal', proposal } });
  await send({ type: 'ai', event: { type: 'done', usage: { total_tokens: 100 } } });
  assert.equal(await page.getByText('Refine the save control', { exact: true }).count(), 1);
  await noOverflow('change proposal narrow');
  const inlineChange = page.locator('.assistant-conversation [data-artifact-id="proposal/proposal-test"]');
  await inlineChange.getByRole('button', { name: 'Review change', exact: true }).click();
  const artifactDialog = page.getByRole('dialog', { name: 'Artifact details' });
  await expect(artifactDialog).toBeVisible();
  await expect(artifactDialog.locator('.artifact-identity').filter({ hasText: /^proposal\/proposal-test$/ })).toHaveCount(1);
  await noOverflow('expanded proposal narrow');
  assert.equal(await artifactDialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1 && element.getBoundingClientRect().width <= innerWidth), true);
  await hostState({ proposal: { ...proposal, status: 'stale' } });
  assert.equal(await artifactDialog.getByRole('button', { name: 'Apply to source', exact: true }).count(), 0, 'stale host state removes Apply while the artifact is expanded');
  await expect(artifactDialog.getByText('Stale', { exact: true }).first()).toBeVisible();
  await artifactDialog.getByRole('button', { name: 'Close', exact: true }).press('Escape');
  await expect(artifactDialog).not.toBeVisible();
  await expect(inlineChange.getByRole('button', { name: 'Review change', exact: true })).toBeFocused();
  await inlineChange.getByRole('button', { name: 'Collapse Code changes', exact: true }).click();
  await expect(inlineChange.getByText('Source changed. Create a new proposal.', { exact: true })).toBeVisible();
  await send({
    type: "error",
    message: "Source refresh failed. Try Refresh source.",
  });
  assert.equal(await page.getByRole("alert").count(), 1);
  await page.getByRole("button", { name: "Dismiss error" }).click();
  assert.equal(await page.getByRole("alert").count(), 0);
  await hostState({ trusted: false });
  assert.equal(
    await page
      .getByRole("heading", { name: "Trust this folder" })
      .count(),
    1,
  );
  await hostState({ project: null, activeFile: null });
  assert.equal(
    await page
      .getByRole("heading", { name: "Open a project" })
      .count(),
    1,
  );
  // Code OSS delivers extension messages through the parent frame, not a synthetic
  // event whose source is null. Exercise that real postMessage boundary directly.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`http://127.0.0.1:${server.address().port}/trusted-parent`);
  const nativeContent = page.frameLocator('#trusted-webview');
  await expect(nativeContent.getByRole('heading', { name: 'Connecting to the editor' })).toBeVisible();
  assert.equal(await nativeContent.locator('body').evaluate(() => window.parent === window), true,
    'native API bootstrap replaces the parent reference before Foundation loads');
  const parentSend = (message) => page.evaluate((data) => {
    document.getElementById('trusted-webview').contentWindow.postMessage(data, window.location.origin);
  }, message);
  await parentSend(initial);
  await expect(nativeContent.getByRole('heading', { name: 'SaveButton', exact: true })).toBeVisible();
  await parentSend({ type: 'mode', mode: 'Refine' });
  await expect(nativeContent.getByRole('region', { name: 'Design canvas' })).toBeVisible();
  await parentSend({ ...initial, design });
  const nestedPreview = nativeContent.frameLocator('iframe[title="Live design preview"]');
  await nestedPreview.getByRole('button', { name: 'Save changes' }).click();
  await expect(nativeContent.getByText('120 px', { exact: true })).toBeVisible();
  assert.equal(await nativeContent.getByRole('heading', { name: 'Trust this folder' }).count(), 0,
    'nested sandbox cannot impersonate the trusted native parent');
  await expect(nativeContent.getByText('8 files indexed', { exact: true })).toBeVisible();
  // An unrelated opaque iframe also must not become a trusted host sender.
  await nativeContent.locator('body').evaluate((body) => new Promise((resolve) => {
    const rogue = document.createElement('iframe');
    rogue.setAttribute('sandbox', 'allow-scripts');
    const received = (event) => {
      if (event.source !== rogue.contentWindow || event.data?.type !== 'state') return;
      window.removeEventListener('message', received);
      rogue.remove();
      resolve();
    };
    window.addEventListener('message', received);
    rogue.srcdoc = `<script nonce="harness">parent.postMessage({type:'state',trusted:false,project:null},'*')<\/script>`;
    body.append(rogue);
  }));
  assert.equal(await nativeContent.getByRole('heading', { name: 'Trust this folder' }).count(), 0,
    'unrelated opaque iframe cannot supply host state');
  await expect(nativeContent.getByText('8 files indexed', { exact: true })).toBeVisible();
  assert.deepEqual(errors, [], "No JavaScript errors or CSP violations");
});
