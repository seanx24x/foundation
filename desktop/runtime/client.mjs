/** Serialized into the development page; never included in a production build. */
export function runtimeClient(settings, installReplay, makeReplayProtocol) {
  if (window.__foundationRuntimeInstalled) return;
  window.__foundationRuntimeInstalled = true;
  const originalFetch = window.fetch.bind(window);
  const candidate = new URL(location.href).searchParams.get('__foundation_view');
  const viewStorageKey = `__foundation_view:${settings.session}`;
  let rememberedView;try { rememberedView = sessionStorage.getItem(viewStorageKey); } catch {}
  const viewId = /^[a-f0-9]{32}$/.test(candidate || '') ? candidate : /^[a-f0-9]{32}$/.test(rememberedView || '') ? rememberedView : 'standalone';
  // A router may replace the URL query. Keep the nonsecret attachment identity
  // within this tab so a full reload still belongs to the same editor view.
  if (viewId !== 'standalone') try { sessionStorage.setItem(viewStorageKey, viewId); } catch {}
  const documentId = crypto.randomUUID().replace(/-/g, '');
  let documentReady = false;
  let inspect = false;
  let selected = null;
  let counter = 0;
  let scheduled = false;
  const ids = new WeakMap();
  const styleKeys = ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight', 'padding', 'gap', 'borderRadius', 'display', 'width', 'height'];
  let pageSequence = 0, publishedPath = null, replay;
  const post = event => originalFetch('/__foundation/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Foundation-Token': settings.token },
    // Ordinary observations belong to the live page. Reserve the browser's
    // bounded keepalive budget for its final document notification.
    body: JSON.stringify({ session: settings.session, viewId, documentId, pageSequence, ...event }), keepalive: event.type === 'pagehide',
  // Drain only our acknowledgment so completed event requests release their
  // transport resources. The application's fetch/XHR response stays untouched.
  }).then(response => response.arrayBuffer()).catch(() => {});
  const publishLocation = () => {
    const pagePath = location.pathname;
    if (pagePath !== publishedPath) { if(publishedPath!==null)replay?.invalidate(); publishedPath = pagePath; pageSequence++; }
    void post({ type: documentReady ? 'ready' : 'document', pagePath, pageSequence });
  };
  // A fixed native bridge reads this synchronous witness in the actual frame.
  // It reveals no token, query, headers, application data or source content.
  Object.defineProperty(window, '__foundationCaptureWitness', { configurable: false, writable: false, value: nonce => {
    if (typeof nonce !== 'string' || !/^[a-f0-9]{32}$/.test(nonce)) return null;
    return { nonce, session: settings.session, viewId, documentId, pageSequence, route: location.pathname,
      ready: documentReady && document.visibilityState === 'visible', inspect,
      viewportWidth: innerWidth, viewportHeight: innerHeight, devicePixelRatio,
      scrollX, scrollY, requestedTheme: ['light','dark'].includes(document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : 'unknown',
      observedColorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
  } });
  if(typeof installReplay==='function')replay=installReplay(settings,{fetch:originalFetch,identity:()=>({session:settings.session,viewId,documentId,pageSequence,route:location.pathname,ready:documentReady}),controls:theme=>{inspect=false;document.documentElement.dataset.theme=theme;place(selected);}},makeReplayProtocol);
  publishLocation();
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) { const result = original.apply(this, args); publishLocation(); return result; };
  }
  window.addEventListener('popstate', publishLocation);
  window.addEventListener('hashchange', publishLocation);
  const requestURL = input => {
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      if (!['http:', 'https:'].includes(url.protocol) || url.pathname.startsWith('/__foundation/')) return null;
      url.username = ''; url.password = ''; url.search = ''; url.hash = '';
      return url.href.slice(0, 1024);
    } catch { return null; }
  };
  window.fetch = async (input, init) => {
    const url = requestURL(input), began = performance.now();
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    try {
      const response = await originalFetch(input, init);
      if (url) void post({ type: 'request', method, url, status: response.status, durationMs: performance.now() - began,
        outcome: response.ok ? 'success' : 'http-error', timing: 'response-headers', observedAt: new Date().toISOString() });
      return response;
    } catch (error) {
      if (url) void post({ type: 'request', method, url, status: null, durationMs: performance.now() - began,
        outcome: error?.name === 'AbortError' ? 'aborted' : 'network-error', timing: 'response-headers', observedAt: new Date().toISOString() });
      throw error;
    }
  };
  const xhrOpen = XMLHttpRequest.prototype.open, xhrSend = XMLHttpRequest.prototype.send;
  const xhrMetadata = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const result = xhrOpen.call(this, method, url, ...rest);
    xhrMetadata.set(this, { method: String(method).toUpperCase(), url: requestURL(String(url)) });
    return result;
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const metadata = xhrMetadata.get(this), began = performance.now();
    let aborted = false;
    const onAbort = () => { aborted = true; };
    const onEnd = () => {
      this.removeEventListener('abort', onAbort);
      if (metadata?.url) void post({ type: 'request', ...metadata, status: this.status || null,
        durationMs: performance.now() - began, outcome: aborted ? 'aborted' : this.status === 0 ? 'network-error' : this.status < 400 ? 'success' : 'http-error',
        timing: 'response-complete', observedAt: new Date().toISOString() });
    };
    this.addEventListener('abort', onAbort, { once: true });
    this.addEventListener('loadend', onEnd, { once: true });
    try { return xhrSend.apply(this, args); }
    catch (error) { this.removeEventListener('abort', onAbort); this.removeEventListener('loadend', onEnd); throw error; }
  };
  const overlay = document.createElement('div');
  overlay.dataset.foundationOverlay = 'true';
  Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', border: '1px solid #527dff', background: 'rgba(82,125,255,.06)',
    zIndex: '2147483647', display: 'none', boxSizing: 'border-box', borderRadius: '2px' });
  const place = element => {
    if (!element?.isConnected) { overlay.style.display = 'none'; return; }
    const rect = element.getBoundingClientRect();
    Object.assign(overlay.style, { display: inspect ? 'block' : 'none', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };
  const observe = (element, explicit) => {
    if (!element?.isConnected) { selected = null; overlay.style.display = 'none'; void post({ type: 'selection', selection: null, explicit }); return; }
    const rect = element.getBoundingClientRect(), computed = getComputedStyle(element);
    if (!ids.has(element)) ids.set(element, `element-${++counter}`);
    void post({ type: 'selection', explicit, selection: {
      id: ids.get(element), mappingId: element.getAttribute('data-foundation-node'), tag: element.tagName.toLowerCase(),
      label: (element.getAttribute('aria-label') || element.textContent || element.tagName).trim().replace(/\s+/g, ' ').slice(0, 160),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      styles: Object.fromEntries(styleKeys.map(key => [key, computed[key]])),
    } });
    place(element);
  };
  const update = () => {
    if (scheduled || !selected) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; observe(selected, false); });
  };
  document.addEventListener('click', event => {
    if (!inspect || !(event.target instanceof Element)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    selected = event.target.closest('[data-foundation-node]') || event.target;
    observe(selected, true);
  }, true);
  document.addEventListener('pointermove', event => { if (inspect && !selected && event.target instanceof Element) place(event.target); }, true);
  window.addEventListener('message', event => {
    if (event.source === parent && event.data?.type === 'foundation-runtime-preview-witness' &&
      event.data.session === settings.session && event.data.viewId === viewId && /^[a-f0-9]{32}$/.test(event.data.nonce || '')) {
      const witness = window.__foundationCaptureWitness(event.data.nonce);
      event.source.postMessage({type:'foundation-runtime-preview-witness',nonce:witness.nonce,session:witness.session,viewId:witness.viewId,
        documentId:witness.documentId,pageVersion:witness.pageSequence,route:witness.route,ready:witness.ready,inspect:witness.inspect,
        viewportWidth:witness.viewportWidth,viewportHeight:witness.viewportHeight,requestedTheme:witness.requestedTheme},event.origin === 'null' ? '*' : event.origin);
      return;
    }
    if (event.source !== parent || !event.data || event.data.type !== 'foundation-runtime-control' || event.data.session !== settings.session) return;
    if (typeof event.data.inspect === 'boolean') inspect = event.data.inspect;
    if (['light', 'dark'].includes(event.data.theme)) document.documentElement.dataset.theme = event.data.theme;
    place(selected); update();
  });
  window.addEventListener('resize', update);
  window.addEventListener('scroll', update, true);
  const start = () => {
    document.body.append(overlay);
    new MutationObserver(records => {
      if (records.some(record => record.target !== overlay)) update();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    documentReady = true; publishLocation();
    const heartbeat = setInterval(publishLocation, 2500);
    window.addEventListener('pagehide', () => { clearInterval(heartbeat); void post({ type: 'pagehide' }); }, { once: true });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
}
