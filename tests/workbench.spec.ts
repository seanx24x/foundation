import { mkdir } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

type Snapshot = {
  source: string;
  revision: string;
  proposal: null | { before: string; after: string; status: string; baseRevision: string };
  verification: null | { revision: string; checks: Array<{ name: string; status: string }> };
  requests: Array<{ id: string; status: number; revision: string }>;
};

let initialSource: string;
let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
});
const ownedSources = new Set<string>();

async function snapshot(request: APIRequestContext): Promise<Snapshot> {
  const response = await request.get('/api/workspace');
  expect(response.ok(), 'The local fixture runtime must be available').toBeTruthy();
  return response.json();
}

async function openWorkbench(page: Page) {
  await page.goto('/?workspace=walkthrough');
  await expect(page.getByText('Local runtime connected', { exact: true })).toBeAttached();
  await expect(page.getByRole('heading', { name: 'Your profile', exact: true })).toBeVisible();
}

async function chooseMode(page: Page, name: 'Understand' | 'Build' | 'Refine' | 'Review') {
  await page.getByRole('navigation', { name: 'Workspace activity' }).getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('region', { name: `${name} workspace` })).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  initialSource = (await snapshot(request)).source;
  ownedSources.add(initialSource);
  await mkdir('artifacts', { recursive: true });
});

test.afterEach(async ({ request }) => {
  expect(pageErrors, 'Every workflow must remain free of unhandled browser exceptions').toEqual([]);
  // A failing test must not leave the fixture edited. Refuse to overwrite edits
  // that were not one of this suite's reviewed proposals.
  const current = await snapshot(request);
  if (current.source === initialSource) return;
  expect(ownedSources.has(current.source), 'Cleanup must preserve unrelated edits').toBeTruthy();
  const restore = await request.post('/api/source', {
    data: { source: initialSource, baseRevision: current.revision },
  });
  expect(restore.ok(), 'Restore the fixture using its current revision guard').toBeTruthy();
  expect((await snapshot(request)).source).toBe(initialSource);
});

test('selected component opens its real source in Monaco and retains context', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await openWorkbench(page);
  await chooseMode(page, 'Build');
  await expect(page.getByRole('textbox', { name: /Source editor: fixtures\/web\/src\/SaveButton.tsx/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save source', exact: true })).toBeDisabled();
  await expect(page.getByText('Shared context', { exact: true })).toBeVisible();
  await chooseMode(page, 'Understand');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test('unsaved source survives a blocked proposal and reconnect until explicitly discarded', async ({ page, request }) => {
  await openWorkbench(page);
  await chooseMode(page, 'Build');
  const editor = page.getByRole('textbox', { name: /Source editor: fixtures\/web\/src\/SaveButton.tsx/ });
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('// Draft retained across reconnect.');
  await expect(page.getByRole('button', { name: 'Save source', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Draft change', exact: true }).click();
  const draftWarning = page.getByRole('alert').filter({ hasText: 'Your draft has been preserved.' });
  await expect(draftWarning).toBeVisible();
  expect((await snapshot(request)).source).toBe(initialSource);
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(draftWarning).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Build workspace' })).toContainText('Draft retained across reconnect.');
  await expect(page.getByRole('button', { name: 'Save source', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save source', exact: true })).toBeDisabled();
  expect((await snapshot(request)).source).toBe(initialSource);
});

test('Save scenarios expose actual success and failure requests and the latest response', async ({ page, request }) => {
  await openWorkbench(page);
  const before = await snapshot(request);
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('success');
  const successRequest = page.waitForResponse((response) => response.url().endsWith('/api/profile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  expect((await successRequest).status()).toBe(200);
  const evidence = page.getByRole('region', { name: 'Evidence panel' });
  await expect(evidence.getByRole('button', { name: /POST.*\/api\/profile.*200/ }).first()).toBeVisible();

  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('error');
  const failedRequest = page.waitForResponse((response) => response.url().endsWith('/api/profile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  expect((await failedRequest).status()).toBe(503);
  const failedRow = evidence.getByRole('button', { name: /POST.*\/api\/profile.*503/ }).first();
  await expect(failedRow).toBeVisible();
  await failedRow.click();
  await expect(page.getByText(/"error": "Simulated service unavailable/)).toBeVisible();
  await expect(page.getByText('Observed locally. No external service or database trace is available.')).toBeVisible();
  const after = await snapshot(request);
  expect(after.requests.length).toBe(before.requests.length + 2);
  expect(after.source).toBe(initialSource);
});

test('reviewed behavior change writes real source, verifies honestly, and can be undone', async ({ page, request }) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'Draft change', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make saving feel dependable' })).toBeVisible();
  await expect(page.getByText(/Scripted fixture proposal — no AI model was called/)).toBeVisible();
  const proposed = await snapshot(request);
  expect(proposed.proposal).not.toBeNull();
  expect(proposed.source).toBe(initialSource);
  expect(proposed.proposal!.before).toBe(initialSource);
  expect(proposed.proposal!.after).not.toBe(initialSource);
  ownedSources.add(proposed.proposal!.after);
  await expect(page.getByRole('region', { name: 'Proposed source changes' })).toBeVisible();

  await page.getByRole('button', { name: 'Apply to source', exact: true }).click();
  await expect(page.getByText('Applied to source', { exact: true })).toBeVisible();
  const applied = await snapshot(request);
  expect(applied.source).toBe(proposed.proposal!.after);
  expect(applied.revision).not.toBe(proposed.revision);
  await page.getByRole('button', { name: 'Verify source', exact: true }).click();
  const evidence = page.getByRole('region', { name: 'Evidence panel' });
  await expect(evidence.getByText('Passed', { exact: true })).toBeVisible();
  await expect(evidence.getByText('Not run', { exact: true })).toHaveCount(2);
  const verified = await snapshot(request);
  expect(verified.verification?.revision).toBe(applied.revision);
  expect(verified.verification?.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'TypeScript', status: 'passed' }),
    expect.objectContaining({ name: 'Interaction', status: 'not-run' }),
    expect.objectContaining({ name: 'Visual', status: 'not-run' }),
  ]));
  await chooseMode(page, 'Understand');
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('success');
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await expect(page.getByText('All changes saved.', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('error');
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  await expect(page.getByText('We couldn’t save your changes. Try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  await chooseMode(page, 'Review');
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect(page.getByText('Ready for your review', { exact: true })).toBeVisible();
  expect((await snapshot(request)).source).toBe(initialSource);
});

test('visual experiment stays local until its exact source diff is applied and undone', async ({ page, request }) => {
  await openWorkbench(page);
  await chooseMode(page, 'Refine');
  await page.getByRole('spinbutton', { name: 'Corner radius', exact: true }).fill('14');
  await page.getByRole('spinbutton', { name: 'Inline padding', exact: true }).fill('24');
  await expect(page.getByText('Unsaved experiment', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCSS('border-radius', '14px');
  expect((await snapshot(request)).source).toBe(initialSource);
  await page.getByRole('button', { name: 'Review visual change', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Refine the Save button', exact: true })).toBeVisible();
  const proposed = await snapshot(request);
  expect(proposed.proposal!.before).toBe(initialSource);
  expect(proposed.proposal!.after).toContain('style={{ borderRadius: 14, paddingInline: 24 }}');
  expect(proposed.source).toBe(initialSource);
  ownedSources.add(proposed.proposal!.after);
  await expect(page.getByRole('region', { name: 'Proposed source changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply to source', exact: true }).click();
  await expect(page.getByText('Applied to source', { exact: true })).toBeVisible();
  expect((await snapshot(request)).source).toBe(proposed.proposal!.after);
  await chooseMode(page, 'Understand');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCSS('border-radius', '14px');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCSS('padding-left', '24px');
  await chooseMode(page, 'Review');
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect(page.getByText('Ready for your review', { exact: true })).toBeVisible();
  expect((await snapshot(request)).source).toBe(initialSource);
});

test('command menu works from the keyboard and changes theme', async ({ page }) => {
  await openWorkbench(page);
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Command menu' });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole('textbox', { name: 'Search commands' });
  await expect(search).toBeFocused();
  await search.fill('Switch to light theme');
  await search.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('ControlOrMeta+k');
  await dialog.getByRole('textbox', { name: 'Search commands' }).fill('Go to Refine');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Refine workspace' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('native target setup exposes planned capabilities without claiming a connection', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'Project setup', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Project setup' });
  await dialog.getByRole('button', { name: 'SwiftUI Blueprint specification' }).click();
  await expect(dialog.getByText('Not connected', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Instrumentation required', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'SwiftUI, connected to the whole picture.' })).toBeVisible();
  await expect(page.getByText(/This adapter is specified and is not connected/)).toBeVisible();
  await expect(page.getByText('Planned', { exact: true })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Draft change', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Return to the working web fixture' }).click();
  await page.getByRole('button', { name: 'Project setup', exact: true }).click();
  await dialog.getByRole('button', { name: 'React Native Blueprint specification' }).click();
  await expect(dialog.getByText('Not connected', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'React Native, with the same shared context.' })).toBeVisible();
});

for (const width of [390, 1024, 1440]) {
  for (const theme of ['dark', 'light'] as const) {
    test(`${theme} workspace fits ${width}px and captures its real layout`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((selectedTheme) => localStorage.setItem('foundation-theme', selectedTheme), theme);
      await openWorkbench(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('navigation', { name: 'Workspace activity' })).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
      expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
      await page.screenshot({ path: `artifacts/foundation-${theme}-${width}.png`, fullPage: true, animations: 'disabled' });
    });
  }
}
