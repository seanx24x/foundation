import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantBridge } from "../src/assistant-bridge.mjs";
import {
  relativeSourcePath,
  validSourcePath,
  validLine,
  escapeHtml,
} from "../src/safety.mjs";

test("native source paths remain bounded to the selected project", () => {
  assert.equal(
    relativeSourcePath("/workspace", "/workspace/src/Button.tsx"),
    "src/Button.tsx",
  );
  assert.equal(
    relativeSourcePath("/workspace", "/workspace-two/file.ts"),
    null,
  );
  assert.equal(
    relativeSourcePath("/workspace", "/workspace/../secrets.txt"),
    null,
  );
  for (const path of [
    "../outside.ts",
    "/root/file.ts",
    "src/../../outside",
    "src\\secret.ts",
    "a\0b",
    "a//b",
    "./file.ts",
  ])
    assert.equal(validSourcePath(path), false, path);
  assert.equal(validSourcePath("src/components/Button.tsx"), true);
  assert.equal(validLine(-1), 1);
  assert.equal(validLine(5), 5);
  assert.equal(validLine(2.5), 1);
  assert.equal(escapeHtml("<script>\"&'"), "&lt;script&gt;&quot;&amp;&#39;");
});

test("private assistant transport rejects absent/wrong bearer and every browser Origin", async (t) => {
  let calls = 0;
  const bridge = await createAssistantBridge({
    handle: async ({ send }) => {
      calls++;
      send(200, { ok: true });
    },
  });
  t.after(() => bridge.close());
  const post = (headers = {}, body = "{}") =>
    fetch(bridge.url + "/api/assistant/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });
  assert.equal((await post()).status, 403);
  assert.equal((await post({ Authorization: "Bearer wrong" })).status, 403);
  assert.equal(
    (
      await post({
        Authorization: `Bearer ${bridge.token}`,
        Origin: "http://127.0.0.1:4173",
      })
    ).status,
    403,
  );
  assert.equal(
    (await post({ Authorization: `Bearer ${bridge.token}` })).status,
    200,
  );
  assert.equal(calls, 1);
});

test("bridge has only the source question route and validates JSON/body bounds", async (t) => {
  let received;
  const bridge = await createAssistantBridge({
    handle: async ({ body, send }) => {
      received = body;
      send(200, { ok: true });
    },
  });
  t.after(() => bridge.close());
  const headers = {
    Authorization: `Bearer ${bridge.token}`,
    "Content-Type": "application/json",
  };
  assert.equal(
    (await fetch(bridge.url + "/api/project", { headers })).status,
    404,
  );
  assert.equal(
    (
      await fetch(bridge.url + "/api/assistant/ask", {
        method: "POST",
        headers,
        body: "invalid",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(bridge.url + "/api/assistant/ask", {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: "a".repeat(128 * 1024) }),
      })
    ).status,
    413,
  );
  const question = {
    projectId: "local",
    prompt: "What does this source do?",
    context: [{ path: "src/Button.tsx", revision: "abc" }],
  };
  assert.equal(
    (
      await fetch(bridge.url + "/api/assistant/ask", {
        method: "POST",
        headers,
        body: JSON.stringify(question),
      })
    ).status,
    200,
  );
  assert.deepEqual(received, question);
});

test("bridge streams adapter output and hides unexpected credential-bearing errors", async (t) => {
  const bridge = await createAssistantBridge({
    handle: async ({ response }) => {
      response.writeHead(200, { "Content-Type": "application/x-ndjson" });
      response.write('{"type":"delta","text":"source"}\n');
      response.end('{"type":"done"}\n');
    },
  });
  t.after(() => bridge.close());
  const headers = {
    Authorization: `Bearer ${bridge.token}`,
    "Content-Type": "application/json",
  };
  const response = await fetch(bridge.url + "/api/assistant/ask", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.match(await response.text(), /"type":"delta"/);
  const failing = await createAssistantBridge({
    handle: async () => {
      throw new Error("secret-api-key should not be returned");
    },
  });
  t.after(() => failing.close());
  const failure = await fetch(failing.url + "/api/assistant/ask", {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${failing.token}` },
    body: "{}",
  });
  assert.equal(failure.status, 500);
  assert.doesNotMatch(await failure.text(), /secret-api-key/);
});


test("bridge accepts bounded combined reference metadata and rejects one byte over 128 KiB", async t => {
  let calls = 0, received;
  const bridge = await createAssistantBridge({handle: async ({body,send}) => {calls++;received=body;send(200,{ok:true});}});
  t.after(() => bridge.close());
  const headers = {Authorization:`Bearer ${bridge.token}`,"Content-Type":"application/json"};
  const post = body => fetch(bridge.url+"/api/assistant/ask",{method:"POST",headers,body});
  // This tests the transport envelope, not the service's stricter field schemas.
  const value = {projectId:"fixture",issueContext:"i".repeat(64*1024),decisionContext:"d".repeat(16*1024),prompt:"q".repeat(6000),padding:""};
  value.padding = "x".repeat(128*1024 - Buffer.byteLength(JSON.stringify(value)));
  const exact = JSON.stringify(value);assert.equal(Buffer.byteLength(exact),128*1024);
  let response = await post(exact);assert.equal(response.status,200);await response.arrayBuffer();assert.deepEqual(received,value);
  response=await post(exact+" ");assert.equal(response.status,413);await response.arrayBuffer();assert.equal(calls,1);
});
