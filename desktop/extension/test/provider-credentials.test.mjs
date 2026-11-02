import test from "node:test";
import assert from "node:assert/strict";
import { resolveProviderKey } from "../src/provider-credentials.mjs";

test("disconnected and invalid provider settings never request Keychain access", async () => {
  let reads = 0;
  const readStoredKey = async () => {
    reads++;
    throw new Error("Unexpected Keychain request");
  };
  for (const config of [
    {},
    { baseUrl: "https://provider.example/v1" },
    { model: "test-model" },
    { baseUrl: "not-a-url", model: "test-model" },
    { baseUrl: "http://provider.example/v1", model: "test-model" },
    { baseUrl: "https://key@provider.example/v1", model: "test-model" },
    { baseUrl: "https://provider.example/v1?key=value", model: "test-model" },
    { baseUrl: "https://provider.example/v1", model: "   " },
  ])
    assert.equal(
      await resolveProviderKey({ ...config, readStoredKey }),
      undefined,
    );
  assert.equal(reads, 0);
});

test("complete environment configuration does not depend on secure storage", async () => {
  const key = await resolveProviderKey({
    baseUrl: "http://127.0.0.1:12345/v1",
    model: "local-model",
    environmentKey: "environment-key",
    environmentOnly: true,
    readStoredKey: async () => {
      throw new Error("Keychain must not be consulted");
    },
  });
  assert.equal(key, "environment-key");
});

test("keyless local environment provider never requests Keychain access", async () => {
  const key = await resolveProviderKey({
    baseUrl: "http://127.0.0.1:12345/v1",
    model: "local-model",
    environmentOnly: true,
    readStoredKey: async () => {
      throw new Error("Keyless local providers must not consult Keychain");
    },
  });
  assert.equal(key, undefined);
});

test("application-configured providers keep native stored-key precedence and environment fallback", async () => {
  const config = {
    baseUrl: "https://provider.example/v1",
    model: "test-model",
    environmentKey: "environment-key",
  };
  let reads = 0;
  assert.equal(
    await resolveProviderKey({
      ...config,
      readStoredKey: async () => {
        reads++;
        return "stored-key";
      },
    }),
    "stored-key",
  );
  assert.equal(
    await resolveProviderKey({
      ...config,
      readStoredKey: async () => {
        reads++;
        return undefined;
      },
    }),
    "environment-key",
  );
  assert.equal(reads, 2);
});
