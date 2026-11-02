import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createAssistantService } from "../server/project/assistant.mjs";

const files = new Map([
  [
    "src/SaveButton.tsx",
    {
      path: "src/SaveButton.tsx",
      revision: "button-r1",
      source:
        "export function SaveButton() {\n  return <button>Save</button>;\n}\n",
    },
  ],
  [
    "src/profile.ts",
    {
      path: "src/profile.ts",
      revision: "profile-r1",
      source: 'export const saveProfile = () => fetch("/api/profile");\n',
    },
  ],
  [
    "src/unselected.ts",
    {
      path: "src/unselected.ts",
      revision: "secret-r1",
      source: "NEVER_INCLUDE_UNSELECTED_SOURCE",
    },
  ],
]);
const projectService = {
  async getFile(id, path) {
    if (id !== "orbit" || !files.has(path))
      throw Object.assign(new Error("Project source is not available."), {
        status: 409,
        code: "project-mismatch",
      });
    return files.get(path);
  },
};
const question = {
  projectId: "orbit",
  prompt: "Explain the save behavior.",
  context: [{ path: "src/SaveButton.tsx", revision: "button-r1" }],
};

async function listen(t, server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function harness(t, providerHandler, options = {}) {
  const provider = createServer(
    providerHandler ?? ((_request, response) => response.end()),
  );
  const providerUrl = await listen(t, provider);
  const service = createAssistantService({
    projectService,
    config: { baseUrl: `${providerUrl}/v1`, model: "test-model", ...options },
  });
  const server = createServer(async (request, response) => {
    const send = (status, value) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    try {
      const parts = [];
      for await (const chunk of request) parts.push(chunk);
      const body = parts.length
        ? JSON.parse(Buffer.concat(parts).toString())
        : undefined;
      const handled = await service.handle({
        request,
        response,
        body,
        url: new URL(request.url, "http://localhost"),
        send,
      });
      if (!handled) send(404, {});
    } catch (error) {
      if (!response.headersSent)
        send(error.status ?? 500, { error: error.message, code: error.code });
      else response.end();
    }
  });
  const url = await listen(t, server);
  const ask = (body = question, options = {}) =>
    fetch(`${url}/api/assistant/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...options,
    });
  return { url, ask, service, provider, server };
}
async function readBody(request) {
  const parts = [];
  for await (const part of request) parts.push(part);
  return JSON.parse(Buffer.concat(parts));
}
const events = async (response) =>
  (await response.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const delta = (text, finish_reason = null) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason }] })}\n\n`;

// The provider here is a local protocol fixture, not a live model or a quality evaluation.
test("provider status is explicit when missing and never exposes credentials", () => {
  const missing = createAssistantService({
    projectService,
    config: {},
  }).status();
  assert.equal(missing.configured, false);
  assert.equal(missing.limits.contextFiles, 8);
  const remote = createAssistantService({
    projectService,
    config: {
      baseUrl: "https://provider.example/v1",
      model: "chosen-model",
      apiKey: "SECRET_PROVIDER_KEY",
    },
  }).status();
  assert.equal(remote.configured, true);
  assert.equal(remote.transport, "remote");
  assert.equal(remote.provider, "provider.example");
  assert.doesNotMatch(JSON.stringify(remote), /SECRET_PROVIDER_KEY|apiKey/);
});

test("provider configuration rejects remote plaintext, embedded credentials, and remote missing keys", () => {
  for (const baseUrl of [
    "http://provider.example/v1",
    "https://user:password@provider.example/v1",
    "https://provider.example/v1?key=secret",
    "file:///tmp/provider",
  ]) {
    assert.equal(
      createAssistantService({
        projectService,
        config: { baseUrl, model: "m", apiKey: "k" },
      }).status().configured,
      false,
    );
  }
  assert.equal(
    createAssistantService({
      projectService,
      config: { baseUrl: "https://provider.example/v1", model: "m" },
    }).status().configured,
    false,
  );
});

test("selected revisions alone reach the provider, fragmented SSE streams citations and usage", async (t) => {
  let payload;
  let requestPath;
  const { ask } = await harness(t, async (request, response) => {
    payload = await readBody(request);
    requestPath = request.url;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const stream =
      delta("Saves the profile. [S1:2] ") +
      delta("✓", "stop") +
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 14, completion_tokens: 7, total_tokens: 21 } })}\n\ndata: [DONE]\n\n`;
    const bytes = Buffer.from(stream);
    for (let i = 0; i < bytes.length; i += 7)
      response.write(bytes.subarray(i, i + 7));
    response.end();
  });
  const response = await ask();
  const result = await events(response);
  assert.equal(response.status, 200);
  assert.equal(requestPath, "/v1/chat/completions");
  assert.equal(payload.model, "test-model");
  assert.equal(payload.stream, true);
  assert.equal(payload.messages.length, 2);
  assert.equal(payload.messages[1].role, "user");
  const input = JSON.parse(payload.messages[1].content);
  assert.equal(input.question, question.prompt);
  assert.equal(input.sources.length, 1);
  assert.match(input.sources[0].content, /1: export function SaveButton/);
  assert.doesNotMatch(
    JSON.stringify(payload),
    /NEVER_INCLUDE_UNSELECTED_SOURCE|saveProfile/,
  );
  assert.deepEqual(result[0].context, [
    { id: "S1", path: "src/SaveButton.tsx", revision: "button-r1", lines: 4 },
  ]);
  assert.equal(
    result
      .filter((event) => event.type === "delta")
      .map((event) => event.text)
      .join(""),
    "Saves the profile. [S1:2] ✓",
  );
  assert.deepEqual(result.at(-1).usage, {
    prompt_tokens: 14,
    completion_tokens: 7,
    total_tokens: 21,
  });
  assert.equal(result.at(-1).type, "done");
});

test("stale, duplicate, missing, and excessive context reject before any provider request", async (t) => {
  let calls = 0;
  const { ask } = await harness(t, (_request, response) => {
    calls++;
    response.end();
  });
  const stale = await ask({
    ...question,
    context: [{ path: "src/SaveButton.tsx", revision: "old" }],
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "stale-context");
  for (const context of [
    [],
    [question.context[0], question.context[0]],
    Array(9).fill(question.context[0]),
  ]) {
    const response = await ask({ ...question, context });
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  const long = await ask({ ...question, prompt: "x".repeat(6001) });
  assert.equal(long.status, 400);
  await long.arrayBuffer();
  assert.equal(calls, 0);
});

test("provider failures do not echo credential-bearing response content", async (t) => {
  const { ask } = await harness(
    t,
    async (request, response) => {
      await readBody(request);
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Rejected SECRET_PROVIDER_KEY" }));
    },
    { apiKey: "SECRET_PROVIDER_KEY" },
  );
  const result = await events(await ask());
  assert.equal(result.at(-1).type, "error");
  assert.match(result.at(-1).error, /credentials/);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_PROVIDER_KEY/);
});

test("truncated and malformed streams retain a partial answer without reporting completion", async (t) => {
  for (const end of ["", "data: NOT_JSON\n\n"]) {
    const { ask } = await harness(t, async (request, response) => {
      await readBody(request);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(delta("Partial answer") + end);
    });
    const result = await events(await ask());
    assert.equal(result[1].text, "Partial answer");
    assert.equal(result.at(-1).type, "error");
    assert.equal(
      result.some((event) => event.type === "done"),
      false,
    );
  }
});

test("timeout aborts a stalled provider with a recoverable error", async (t) => {
  let closed = false;
  const { ask } = await harness(
    t,
    async (request, response) => {
      await readBody(request);
      response.on("close", () => {
        closed = true;
      });
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(delta("Partial"));
    },
    { timeoutMs: 80 },
  );
  const result = await events(await ask());
  assert.equal(result.at(-1).code, "provider-timeout");
  for (let i = 0; i < 20 && !closed; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(closed, true);
});

test("stopping the browser request cancels the upstream provider stream", async (t) => {
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  const { ask } = await harness(t, async (request, response) => {
    await readBody(request);
    response.on("close", resolveClosed);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(delta("Streaming"));
  });
  const controller = new AbortController();
  const response = await ask(question, { signal: controller.signal });
  const reader = response.body.getReader();
  let first = "";
  while (!first.includes("Streaming")) {
    first += new TextDecoder().decode((await reader.read()).value);
  }
  controller.abort();
  await Promise.race([
    closed,
    new Promise((_resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Upstream was not canceled")),
        1500,
      );
      timer.unref();
    }),
  ]);
});

test("oversized output is stopped and redirect responses never forward provider credentials", async (t) => {
  const { ask } = await harness(t, async (request, response) => {
    await readBody(request);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(delta("x".repeat(65537)) + "data: [DONE]\n\n");
  });
  const result = await events(await ask());
  assert.equal(result.at(-1).code, "answer-too-large");
  const redirect = await harness(
    t,
    async (request, response) => {
      await readBody(request);
      response.writeHead(302, { Location: "http://127.0.0.1:9/stolen" });
      response.end();
    },
    { apiKey: "SECRET_PROVIDER_KEY" },
  );
  const redirected = await events(await redirect.ask());
  assert.equal(redirected.at(-1).code, "provider-unavailable");
  assert.doesNotMatch(JSON.stringify(redirected), /SECRET_PROVIDER_KEY/);
});

test("concurrent source preparation cannot exceed two active provider requests", async (t) => {
  let calls = 0;
  const { ask } = await harness(t, async (request, response) => {
    await readBody(request);
    calls += 1;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(delta("Working"));
  });
  const controllers = Array.from({ length: 6 }, () => new AbortController());
  const responses = await Promise.all(
    controllers.map((controller) =>
      ask(question, { signal: controller.signal }),
    ),
  );
  assert.equal(
    responses.filter((response) => response.status === 200).length,
    2,
  );
  assert.equal(
    responses.filter((response) => response.status === 429).length,
    4,
  );
  for (const response of responses.filter((item) => item.status === 429)) {
    assert.equal((await response.json()).code, "assistant-busy");
  }
  controllers.forEach((controller) => controller.abort());
  assert.ok(calls <= 2);
});

test("combined context byte limit rejects before contacting the provider", async (t) => {
  let calls = 0;
  files.set("src/large.ts", {
    path: "src/large.ts",
    revision: "large-r1",
    source: "x".repeat(65537),
  });
  t.after(() => files.delete("src/large.ts"));
  const { ask } = await harness(t, (_request, response) => {
    calls++;
    response.end();
  });
  const response = await ask({
    ...question,
    context: [{ path: "src/large.ts", revision: "large-r1" }],
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "context-too-large");
  assert.equal(calls, 0);
});

const changeOutput = JSON.stringify({
  title: "Clarify the save action",
  summary: "Change the label in the selected button only.",
  edits: [{ path: "src/SaveButton.tsx", find: ">Save</button>", replace: ">Save changes</button>" }],
  verification: ["Inspect the button at mobile and desktop widths."],
});

test("change intent returns a validated proposal only after a complete structured response", async t => {
  let payload;
  const { ask } = await harness(t, async (request, response) => {
    payload = await readBody(request);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(delta(changeOutput.slice(0, 20)) + delta(changeOutput.slice(20), "stop") + "data: [DONE]\n\n");
  });
  const result = await events(await ask({ ...question, intent: "change" }));
  const proposal = result.find(item => item.type === "proposal")?.proposal;
  assert.ok(proposal);
  assert.equal(proposal.baseRevision, "button-r1");
  assert.equal(proposal.path, "src/SaveButton.tsx");
  assert.match(proposal.after, /Save changes/);
  assert.deepEqual(proposal.context, question.context);
  assert.equal(result.at(-2).type, "proposal");
  assert.equal(result.at(-1).type, "done");
  assert.match(payload.messages[0].content, /ONE existing file/);
  assert.doesNotMatch(JSON.stringify(payload), /NEVER_INCLUDE_UNSELECTED_SOURCE/);
  assert.doesNotMatch(files.get("src/SaveButton.tsx").source, /Save changes/);
});

test("invalid intent rejects before contacting a provider", async t => {
  let calls = 0;
  const { ask } = await harness(t, (_request, response) => { calls++; response.end(); });
  const response = await ask({ ...question, intent: "execute" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid-intent");
  assert.equal(calls, 0);
});

test("malformed, truncated, refused, and out-of-scope change responses cannot produce proposals", async t => {
  for (const [content, finish, ending] of [
    [changeOutput, "stop", ""],
    [changeOutput, "length", "data: [DONE]\n\n"],
    [changeOutput, "content_filter", "data: [DONE]\n\n"],
    ["not JSON", "stop", "data: [DONE]\n\n"],
    [changeOutput.replaceAll("src/SaveButton.tsx", "src/unselected.ts"), "stop", "data: [DONE]\n\n"],
  ]) {
    const { ask } = await harness(t, async (request, response) => {
      await readBody(request);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(delta(content, finish) + ending);
    });
    const result = await events(await ask({ ...question, intent: "change" }));
    assert.equal(result.some(item => item.type === "proposal"), false);
    assert.equal(result.at(-1).type, "error");
  }
});

test("a source revision changed during generation invalidates a completed proposal", async t => {
  const original = files.get("src/SaveButton.tsx");
  t.after(() => files.set(original.path, original));
  const { ask } = await harness(t, async (request, response) => {
    await readBody(request);
    files.set(original.path, { ...original, revision: "changed-after-request", source: `${original.source}// user edit\n` });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(delta(changeOutput, "stop") + "data: [DONE]\n\n");
  });
  const result = await events(await ask({ ...question, intent: "change" }));
  assert.equal(result.some(item => item.type === "proposal"), false);
  assert.equal(result.at(-1).code, "stale-context");
});

test("cancelling a structured response before completion never emits an applicable proposal", async t => {
  const { EventEmitter } = await import("node:events");
  let closed;
  const providerClosed = new Promise(resolve => { closed = resolve; });
  const provider = createServer(async (request, response) => {
    await readBody(request);
    response.on("close", closed);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    // A complete JSON value is insufficient: the transport must also finish.
    response.write(delta(changeOutput));
  });
  const url = await listen(t, provider);
  const service = createAssistantService({ projectService, config: { baseUrl: url, model: "test-model" } });
  const request = { method: "POST", aborted: false };
  const response = new EventEmitter();
  const result = [];
  Object.assign(response, {
    destroyed: false, writableEnded: false, writeHead() {},
    write(line) {
      const event = JSON.parse(line);
      result.push(event);
      if (event.type === "delta") {
        request.aborted = true;
        response.destroyed = true;
        response.emit("close");
      }
    },
    end() { this.writableEnded = true; },
  });
  await service.handle({ request, response, url: "/api/assistant/ask", body: { ...question, intent: "change" } });
  await providerClosed;
  assert.equal(result.some(event => event.type === "proposal"), false);
  assert.equal(result.some(event => event.type === "done"), false);
  assert.equal(result.some(event => event.type === "delta"), true);
});
