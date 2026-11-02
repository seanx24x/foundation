// Fixture-only bridge. The production renderer is copied without modification.
(() => {
  const host = window.parent;
  const origin = location.origin;
  let config = {};
  try { config = JSON.parse(window.frameElement?.getAttribute('data-fixture-config') || '{}'); } catch {}
  let view = config.view || { mode: 'Refine' };
  const theme = document.getElementById('fixture-native-theme');
  if (theme && typeof config.themeCSS === 'string') theme.textContent = config.themeCSS;
  window.acquireVsCodeApi = () => ({
    getState: () => view,
    setState: value => { view = value; },
    postMessage: message => host.postMessage({ channel: 'foundation-workspace-fixture', message }, origin),
  });
  // Code OSS substitutes these references during API bootstrap; preserve the
  // real host above while retaining the production same-origin validation.
  window.parent = window;
  window.top = window;
  window.frameElement = null;
})();
