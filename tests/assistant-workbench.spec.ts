import { expect, test, type Page } from "@playwright/test";

const configured = {
  configured: true,
  provider: "protocol-fixture.local",
  model: "browser-fixture-model",
  transport: "local",
  limits: { contextFiles: 8, contextBytes: 65536, promptChars: 6000 },
};
let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(() => {
  expect(
    errors,
    "Assistant workflows must have no unhandled browser errors",
  ).toEqual([]);
});

async function openAssistant(page: Page) {
  await page.goto("/?workspace=project");
  await expect(
    page.getByRole("tab", { name: "SaveButton.tsx", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("complementary", { name: "Project context" })
    .getByRole("button", { name: "Assistant", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Source assistant" });
  await expect(panel).toBeVisible();
  return panel;
}
async function configuredMock(page: Page) {
  await page.route("**/api/assistant/config", (route) =>
    route.fulfill({ json: configured }),
  );
}
const completedStream = (answer: string) =>
  [
    { type: "start", model: "browser-fixture-model" },
    { type: "delta", text: answer },
    {
      type: "done",
      model: "browser-fixture-model",
      usage: { prompt_tokens: 20, completion_tokens: 9, total_tokens: 29 },
      finishReason: "stop",
    },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n") + "\n";

// These UI tests use explicit protocol mocks when a provider is configured.
// tests/assistant.test.mjs independently exercises the real service against local HTTP fixtures.
test("actual disconnected assistant exposes inspectable saved context and sends no questions", async ({
  page,
}) => {
  let asks = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/assistant/ask") asks++;
  });
  const panel = await openAssistant(page);
  await expect(
    panel.getByText("No model connected", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("checkbox", {
      name: "src/components/SaveButton.tsx",
      exact: true,
    }),
  ).toBeChecked();
  await panel.getByText("Inspect saved context", { exact: false }).click();
  await expect(panel.locator(".assistant-context-file pre")).toContainText(
    "export function SaveButton",
  );
  await expect(
    panel.getByRole("textbox", { name: "Ask about selected source" }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "Ask assistant", exact: true }),
  ).toBeDisabled();
  await panel
    .getByText("Connect a provider", { exact: false })
    .filter({ has: page.locator("svg") })
    .click();
  await expect(
    panel.getByText("FOUNDATION_AI_BASE_URL", { exact: false }),
  ).toBeVisible();
  expect(asks).toBe(0);
});

test("mock answer uses only checked context and valid citations navigate into real source", async ({
  page,
}) => {
  await configuredMock(page);
  let payload:
    | { prompt: string; context: { path: string; revision: string }[] }
    | undefined;
  await page.route("**/api/assistant/ask", (route) => {
    payload = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: completedStream(
        "The profile function declares a request [S1:9]. Unavailable reference [S99:9].",
      ),
    });
  });
  const panel = await openAssistant(page);
  await page
    .getByRole("button", { name: "Open src/api/profile.ts", exact: true })
    .click();
  await expect(
    panel.getByRole("checkbox", { name: "src/api/profile.ts", exact: true }),
  ).not.toBeChecked();
  await panel
    .getByRole("checkbox", { name: "src/api/profile.ts", exact: true })
    .check();
  await panel
    .getByRole("checkbox", {
      name: "src/components/SaveButton.tsx",
      exact: true,
    })
    .uncheck();
  await page.getByRole("tab", { name: "SaveButton.tsx", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "Ask about selected source" })
    .fill("Where is the save request declared?");
  await panel
    .getByRole("button", { name: "Ask assistant", exact: true })
    .click();
  await expect(panel.getByText("29 tokens", { exact: true })).toBeVisible();
  expect(payload?.context.map((item) => item.path)).toEqual([
    "src/api/profile.ts",
  ]);
  expect(payload?.context[0].revision).toBeTruthy();
  expect(payload?.prompt).toBe("Where is the save request declared?");
  await expect(
    panel.getByText("AI interpretation", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "S99:9", exact: true }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "profile.ts:9", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "profile.ts", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("textbox", {
      name: /Source editor: .*src\/api\/profile\.ts/,
    }),
  ).toBeVisible();
});

test("a browser-only streaming fixture supports Stop and preserves partial text across inspector tabs", async ({
  page,
}) => {
  await configuredMock(page);
  // route.fulfill buffers its body; a narrowly scoped browser fetch fixture provides a controllable stream for abort testing.
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    const fixture = { aborted: false };
    (
      window as Window & { assistantStreamFixture?: typeof fixture }
    ).assistantStreamFixture = fixture;
    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.endsWith("/api/assistant/ask")) return nativeFetch(input, init);
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "start",
                  model: "browser-fixture-model",
                }) + "\n",
              ),
            );
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "delta",
                  text: "Partial source explanation retained.",
                }) + "\n",
              ),
            );
            init?.signal?.addEventListener(
              "abort",
              () => {
                fixture.aborted = true;
                controller.error(new DOMException("Stopped", "AbortError"));
              },
              { once: true },
            );
          },
        }),
        { headers: { "Content-Type": "application/x-ndjson" } },
      );
    };
  });
  const panel = await openAssistant(page);
  await panel
    .getByRole("textbox", { name: "Ask about selected source" })
    .fill("Explain this source.");
  await panel
    .getByRole("button", { name: "Ask assistant", exact: true })
    .click();
  await expect(
    panel.getByText("Partial source explanation retained.", { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Stop answer", exact: true }).click();
  await expect(
    panel.getByText("Stopped. The partial answer is kept.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { assistantStreamFixture?: { aborted: boolean } })
          .assistantStreamFixture?.aborted,
    ),
  ).toBe(true);
  const inspector = page.getByRole("complementary", {
    name: "Project context",
  });
  await inspector.getByRole("button", { name: "Context", exact: true }).click();
  await inspector
    .getByRole("button", { name: "Assistant", exact: true })
    .click();
  await expect(
    panel.getByText("Partial source explanation retained.", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("textbox", { name: "Ask about selected source" }),
  ).toBeEnabled();
});

test("mocked saved-source refresh marks the earlier answer stale while retaining its original snapshot", async ({
  page,
}) => {
  await configuredMock(page);
  await page.route("**/api/assistant/ask", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: completedStream("SaveButton uses its state prop [S1:3]."),
    }),
  );
  const panel = await openAssistant(page);
  await panel
    .getByRole("textbox", { name: "Ask about selected source" })
    .fill("Explain the button.");
  await panel
    .getByRole("button", { name: "Ask assistant", exact: true })
    .click();
  await expect(panel.getByText("29 tokens", { exact: true })).toBeVisible();
  await page.route("**/api/project/file?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("path") !== "src/components/SaveButton.tsx")
      return route.continue();
    const response = await route.fetch();
    const file = await response.json();
    return route.fulfill({
      json: {
        ...file,
        revision: "browser-fixture-new-revision",
        source: `${file.source}\n// Mock saved revision changed.\n`,
      },
    });
  });
  await page
    .getByRole("button", { name: "Refresh selected source", exact: true })
    .click();
  await expect(
    panel.getByText(/Source has changed since this answer/),
  ).toBeVisible();
  const snapshots = panel.locator(".assistant-answer-sources");
  await snapshots.locator(":scope > summary").click();
  await snapshots.locator(":scope > details > summary").click();
  await expect(snapshots.locator("pre")).toContainText(
    "export function SaveButton",
  );
  await expect(snapshots.locator("pre")).not.toContainText(
    "Mock saved revision changed.",
  );
});
