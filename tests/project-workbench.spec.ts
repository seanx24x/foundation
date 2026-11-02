import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { ProjectFile, ProjectSnapshot } from "../src/project/types";

const buttonPath = "src/components/SaveButton.tsx";
const apiPath = "src/api/profile.ts";
let project: ProjectSnapshot;
const baselines = new Map<string, ProjectFile>();
const owned = new Map<string, Set<string>>();
let errors: string[];
const read = async (
  request: APIRequestContext,
  path: string,
): Promise<ProjectFile> => {
  const result = await request.get(
    `/api/project/file?${new URLSearchParams({ projectId: project.id, path })}`,
  );
  expect(result.ok()).toBeTruthy();
  return result.json();
};
async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("project-workbench")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "SaveButton", exact: true }),
  ).toBeVisible();
}
async function mode(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Project activity" })
    .getByRole("button", { name: new RegExp(`^${name}(?: [0-9]+)?$`) })
    .click();
  await expect(
    page.getByRole("main", { name: `${name} project workspace` }),
  ).toBeVisible();
}
async function edit(page: Page, path: string, source: string) {
  const editor = page.getByRole("textbox", {
    name: `Source editor: ${project.id}/${path}`,
    exact: true,
  });
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(source);
  await expect(page.getByRole("button", { name: /Save file/ })).toBeEnabled();
}
test.beforeAll(async ({ request }) => {
  project = await (await request.get("/api/project")).json();
  expect(project.preview).not.toBeNull();
  for (const path of [buttonPath, apiPath]) {
    const file = await read(request, path);
    baselines.set(path, file);
    owned.set(path, new Set([file.source]));
  }
  await mkdir("artifacts", { recursive: true });
});
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ request }) => {
  for (const [path, baseline] of baselines) {
    const current = await read(request, path);
    if (current.source === baseline.source) continue;
    expect(
      owned.get(path)!.has(current.source),
      "Preserve any unrelated source edits",
    ).toBeTruthy();
    const result = await request.post("/api/project/file", {
      data: {
        projectId: project.id,
        path,
        source: baseline.source,
        baseRevision: current.revision,
      },
    });
    expect(result.ok()).toBeTruthy();
  }
  expect(errors, "No unhandled browser exceptions").toEqual([]);
});

test("project relationships, search, quick open and source lines follow real files", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("main")
    .getByRole("button", {
      name: "ProfileForm.tsx src/components",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("tab", { name: "ProfileForm.tsx", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+Shift+f");
  await page
    .getByRole("textbox", { name: "Search project files" })
    .fill("fetch(");
  await page
    .getByRole("button")
    .filter({ hasText: "profile.ts" })
    .filter({ hasText: "fetch(" })
    .click();
  await expect(
    page.getByRole("tab", { name: "profile.ts", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("POST /api/orbit/profile", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+p");
  const picker = page.getByRole("dialog");
  await picker.getByRole("textbox", { name: "Find a file" }).fill("tokens.css");
  await picker.getByRole("textbox", { name: "Find a file" }).press("Enter");
  await expect(
    page.getByRole("tab", { name: "tokens.css", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: /Design tokens/ }),
  ).toBeVisible();
});

test("independent editor drafts survive file tabs and the connected walkthrough", async ({
  page,
  request,
}) => {
  await open(page);
  await mode(page, "Build");
  const first = baselines.get(buttonPath)!.source + "\n// retained draft A\n";
  await edit(page, buttonPath, first);
  await page
    .getByRole("button", { name: `Open ${apiPath}`, exact: true })
    .click();
  await edit(
    page,
    apiPath,
    baselines.get(apiPath)!.source + "\n// retained draft B\n",
  );
  await page.getByRole("button", { name: "Walkthrough", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your profile", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Project workspace", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "profile.ts, unsaved", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "SaveButton.tsx, unsaved", exact: true })
    .click();
  await expect(page.getByRole("main")).toContainText("retained draft A");
  expect((await read(request, buttonPath)).source).toBe(
    baselines.get(buttonPath)!.source,
  );
  await page
    .getByRole("button", { name: `Close ${buttonPath}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Save this file to keep your edits.");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "SaveButton.tsx, unsaved", exact: true }),
  ).toBeVisible();
});

test("saved edit updates the live preview, review diff and guarded restore", async ({
  page,
  request,
}) => {
  await open(page);
  await mode(page, "Build");
  const modified = baselines
    .get(buttonPath)!
    .source.replace("'Save changes'", "'Save profile'");
  owned.get(buttonPath)!.add(modified);
  const editor = page.getByRole("textbox", {
    name: `Source editor: ${project.id}/${buttonPath}`,
    exact: true,
  });
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+f");
  await page
    .getByRole("textbox", { name: "Find", exact: true })
    .fill("Save changes");
  await page.keyboard.press("Escape");
  await page.keyboard.insertText("Save profile");
  await expect(page.getByRole("button", { name: /Save file/ })).toBeEnabled();
  const savedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/project/file") &&
      response.request().method() === "POST",
  );
  await page.keyboard.press("ControlOrMeta+s");
  const saved = await (await savedResponse).json();
  owned.get(buttonPath)!.add(saved.source);
  await expect(
    page.getByRole("button", { name: "Save file", exact: false }),
  ).toBeDisabled();
  expect((await read(request, buttonPath)).source).toBe(modified);
  await mode(page, "Refine");
  const preview = page.frameLocator('iframe[title="Orbit live application"]');
  await expect(
    preview.getByRole("button", { name: "Save profile", exact: true }),
  ).toBeVisible();
  await mode(page, "Review");
  await expect(
    page.getByRole("region", { name: "Proposed source changes" }),
  ).toContainText("Save profile");
  await page
    .getByRole("button", { name: "Restore session version", exact: true })
    .click();
  expect((await read(request, buttonPath)).source).toBe(
    baselines.get(buttonPath)!.source,
  );
  await expect(
    page.getByRole("heading", { name: "A clear starting point.", exact: true }),
  ).toBeVisible();
});

test("concurrent edit blocks save and preserves draft until a reviewed choice", async ({
  page,
  request,
}) => {
  await open(page);
  await mode(page, "Build");
  const draft = baselines.get(buttonPath)!.source + "\n// My local draft\n";
  await edit(page, buttonPath, draft);
  const current = await read(request, buttonPath);
  const external =
    baselines.get(buttonPath)!.source + "\n// Other window change\n";
  owned.get(buttonPath)!.add(external);
  expect(
    (
      await request.post("/api/project/file", {
        data: {
          projectId: project.id,
          path: buttonPath,
          source: external,
          baseRevision: current.revision,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.keyboard.press("ControlOrMeta+s");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("My local draft");
  await expect(dialog).toContainText("Other window change");
  expect((await read(request, buttonPath)).source).toBe(external);
  await dialog
    .getByRole("button", { name: "Keep editing draft", exact: true })
    .click();
  await expect(page.getByRole("main")).toContainText("My local draft");
  await page
    .getByRole("button", { name: "Compare versions", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Discard draft · use disk", exact: true })
    .click();
  await expect(page.getByRole("main")).toContainText("Other window change");
  await expect(page.getByRole("button", { name: /Save file/ })).toBeDisabled();
});

test("sample preview executes success and failure and maps inspection to source", async ({
  page,
}) => {
  await open(page);
  await mode(page, "Refine");
  const preview = page.frameLocator('iframe[title="Orbit live application"]');
  await preview
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(preview.getByRole("status")).toContainText(
    "Your profile is up to date.",
  );
  await preview
    .getByRole("checkbox", { name: "Simulate a failed request" })
    .check();
  await preview
    .getByRole("button", { name: "Changes saved", exact: true })
    .click();
  await expect(preview.getByRole("status")).toContainText(
    "Your changes couldn’t be saved.",
  );
  await page
    .getByRole("button", { name: "Mobile preview", exact: true })
    .click();
  await expect(page.locator(".project-preview-canvas")).toHaveClass(/mobile/);
  await page
    .getByRole("button", { name: "Inspect preview elements", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    page.getByRole("main", { name: "Build project workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "SaveButton.tsx", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("open folder connects an independent local project and reports unavailable runtime mapping", async ({
  page,
  request,
}) => {
  const folder = await mkdtemp(join(tmpdir(), "foundation-ui-project-"));
  await writeFile(
    join(folder, "package.json"),
    JSON.stringify({ name: "Draftbook", scripts: { dev: "vite" } }),
  );
  await writeFile(
    join(folder, "index.ts"),
    'export const greeting = "Hello Foundation";\n',
  );
  try {
    await open(page);
    await page
      .getByRole("button", { name: "Open local folder", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "Local folder path", exact: true })
      .fill(folder);
    await dialog
      .getByRole("button", { name: "Open folder", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "index.ts", exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open index.ts", exact: true }),
    ).toBeVisible();
    await mode(page, "Build");
    await expect(page.getByRole("main")).toContainText("Hello Foundation");
    await mode(page, "Refine");
    await expect(page.getByText("Source only", { exact: true })).toBeVisible();
    await expect(
      page.locator('iframe[title="Orbit live application"]'),
    ).toHaveCount(0);
  } finally {
    await page.close();
    expect(
      (
        await request.post("/api/project/open", {
          data: { root: project.root },
        })
      ).ok(),
    ).toBeTruthy();
    await rm(folder, { recursive: true, force: true });
  }
});

for (const theme of ["dark", "light"] as const) {
  for (const width of [390, 1024, 1440]) {
    test(`project ${theme} layout at ${width}px stays usable`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.addInitScript(
        (value) => localStorage.setItem("foundation-theme", value),
        theme,
      );
      await open(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBeTruthy();
      if (width === 390) {
        await page
          .getByRole("button", { name: "Toggle project navigator" })
          .click();
        await expect(
          page.getByRole("navigation", { name: "File explorer" }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: `Open ${apiPath}`, exact: true })
          .click();
        await expect(
          page.getByRole("tab", { name: "profile.ts", exact: true }),
        ).toBeVisible();
      }
      await mode(page, "Refine");
      const preview = page.frameLocator(
        'iframe[title="Orbit live application"]',
      );
      await expect(
        preview.getByRole("heading", { name: "Your profile", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: `artifacts/project-${theme}-${width}.png`,
        fullPage: true,
      });
    });
  }
}
