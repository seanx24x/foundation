/* Foundation workspace geometry. No project or provider side effects. */
(function (scope) {
  'use strict';
  function snapWidth(value, min = 280, max = 480) {
    const number = typeof value === 'number' && Number.isFinite(value) ? value : 320;
    return Math.max(min, Math.min(max, Math.round(number / 4) * 4));
  }
  function resolveLayout(containerWidth, desiredWidth = 320) {
    const available = Number.isFinite(containerWidth) ? Math.max(0, containerWidth) : 0;
    const desired = snapWidth(desiredWidth);
    const compact = available < 760;
    const max = Math.max(280, Math.min(480, Math.floor((available - 480) / 4) * 4));
    return { width: snapWidth(desired, 280, max), max, compact, desired };
  }
  function keyboardWidth(current, key, shift, max = 480) {
    const step = shift ? 32 : 4;
    if (key === 'ArrowLeft') return snapWidth(current + step, 280, max);
    if (key === 'ArrowRight') return snapWidth(current - step, 280, max);
    if (key === 'Home') return 280;
    if (key === 'End') return max;
    return null;
  }
  function normalizeLayouts(input) {
    const result = Object.create(null);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
    for (const [key, value] of Object.entries(input).slice(-32)) {
      if (!key || key.length > 300 || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      result[key] = { inspectorWidth: snapWidth(value.inspectorWidth) };
    }
    return result;
  }
  const api = Object.freeze({ snapWidth, resolveLayout, keyboardWidth, normalizeLayouts });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.FoundationWorkspace = api;
})(typeof window === 'undefined' ? globalThis : window);
