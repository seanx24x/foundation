/** Read secure storage only when a usable provider destination is configured. */
export async function resolveProviderKey({
  baseUrl,
  model,
  environmentKey,
  environmentOnly = false,
  readStoredKey,
}) {
  if (
    typeof baseUrl !== "string" ||
    !baseUrl.trim() ||
    typeof model !== "string" ||
    !model.trim() ||
    model.length > 200 ||
    /[\r\n]/.test(model)
  )
    return undefined;
  try {
    const url = new URL(baseUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;
  } catch {
    return undefined;
  }

  // A complete environment configuration is self-contained. Application-level
  // provider settings retain precedence for a key saved through the native UI.
  if (environmentOnly) return environmentKey;
  return (await readStoredKey()) || environmentKey;
}
