// Fixture-only native API bridge. Load before the unchanged production scripts.
(() => {
  const host = window.parent;
  const origin = window.location.origin;
  let config = {};
  try { config = JSON.parse(window.frameElement?.getAttribute("data-fixture-config") || "{}"); } catch { /* Direct visits stay idle. */ }
  let persisted = config.view || { mode: "Assistant" };
  const theme = document.getElementById("fixture-native-theme");
  if (theme && typeof config.themeCSS === "string") theme.textContent = config.themeCSS;
  window.acquireVsCodeApi = () => ({
    getState: () => persisted,
    setState: (value) => { persisted = value; },
    postMessage: (message) => host.postMessage({ channel: "foundation-fixture-host", message }, origin),
  });
  // Match the Code OSS API bootstrap while preserving the actual event source.
  window.parent = window;
  window.top = window;
  window.frameElement = null;
})();
