import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

/** An extension-host-only transport. The renderer never receives its address or bearer. */
export async function createAssistantBridge(assistant) {
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(`Bearer ${token}`);
  const server = createServer(async (request, response) => {
    const send = (status, value) => {
      if (response.headersSent || response.destroyed) return;
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(JSON.stringify(value));
    };
    try {
      const actual = Buffer.from(String(request.headers.authorization || ""));
      if (
        request.headers.origin ||
        !["127.0.0.1", "::ffff:127.0.0.1"].includes(
          request.socket.remoteAddress || "",
        ) ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        request.resume();
        send(403, {
          error: "This transport is private to the Foundation extension host.",
        });
        return;
      }
      if (request.method !== "POST" || request.url !== "/api/assistant/ask") {
        request.resume();
        send(404, { error: "Unknown extension endpoint." });
        return;
      }
      if (
        !/^application\/json(?:\s*;|$)/i.test(
          String(request.headers["content-type"] || ""),
        )
      ) {
        request.resume();
        send(415, { error: "JSON is required." });
        return;
      }
      let bytes = 0;
      const parts = [];
      for await (const part of request) {
        bytes += part.length;
        if (bytes > 128 * 1024) {
          send(413, { error: "The question is too large." });
          return;
        }
        parts.push(part);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(parts).toString("utf8"));
      } catch {
        send(400, { error: "Invalid question." });
        return;
      }
      await assistant.handle({
        request,
        response,
        url: new URL(request.url, "http://127.0.0.1"),
        body,
        send,
      });
    } catch (error) {
      // Never forward arbitrary provider or OS error strings, which can contain secrets.
      const known =
        Number.isInteger(error?.status) && typeof error?.code === "string";
      send(known ? error.status : 500, {
        error: known
          ? error.message
          : "The assistant transport could not complete this request.",
        code: known ? error.code : "bridge-error",
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    token,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
