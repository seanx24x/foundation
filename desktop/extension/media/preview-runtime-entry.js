import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as jsxDevRuntime from 'react/jsx-dev-runtime';
import { createRoot } from 'react-dom/client';

const packages = { react: React, 'react/jsx-runtime': jsxRuntime, 'react/jsx-dev-runtime': jsxDevRuntime };

function start(config, loadEntry) {
  const { session, revision } = config;
  const mappings = new Set(config.mappings);
  const send = (type, data = {}) => parent.postMessage({ channel: 'foundation-design', session, revision, type, ...data }, '*');
  let inspect = false;
  let selected = null;
  let scheduled = false;
  let failed = false;
  const outline = document.createElement('div');
  outline.setAttribute('aria-hidden', 'true');
  Object.assign(outline.style, { position: 'fixed', pointerEvents: 'none', border: '1.5px solid #6697ef', background: '#6697ef0d', boxSizing: 'border-box', zIndex: '2147483647', display: 'none' });
  document.body.append(outline);
  const experiments = document.createElement('style');
  experiments.nonce = config.nonce;
  document.head.append(experiments);
  const reportError = error => {
    failed = true;
    const message = String(error?.message || error || 'The sandbox could not render this component.').slice(0, 1000);
    send('error', { error: message });
    if (!document.getElementById('root')?.childNodes.length) {
      const alert = document.createElement('pre');
      alert.id = 'foundation-runtime-error';
      alert.textContent = message;
      alert.setAttribute('role', 'alert');
      document.getElementById('root')?.append(alert);
    }
  };
  window.addEventListener('error', event => reportError(event.error || event.message));
  window.addEventListener('unhandledrejection', event => reportError(event.reason));

  function selectionEvidence(intent = 'measure') {
    if (!selected?.isConnected) { selected = null; selectionResize.disconnect(); outline.style.display = 'none'; return; }
    const rect = selected.getBoundingClientRect();
    Object.assign(outline.style, { display: inspect ? 'block' : 'none', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const computed = getComputedStyle(selected);
    const properties = ['display', 'position', 'color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gap', 'borderRadius', 'borderColor', 'borderWidth', 'opacity'];
    send('selection', {
      intent,
      selection: {
        path: selected.getAttribute('data-foundation-source'),
        tag: selected.tagName.toLowerCase(),
        label: (selected.getAttribute('aria-label') || selected.textContent || selected.tagName).trim().replace(/\s+/g, ' ').slice(0, 100),
        rect: { x: Math.round(rect.x * 10) / 10, y: Math.round(rect.y * 10) / 10, width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 },
        styles: Object.fromEntries(properties.map(property => [property, computed[property]])),
      },
    });
  }
  function scheduleEvidence() {
    if (scheduled || !selected) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; selectionEvidence(); });
  }
  window.addEventListener('resize', scheduleEvidence);
  window.addEventListener('scroll', scheduleEvidence, true);
  new ResizeObserver(scheduleEvidence).observe(document.documentElement);
  const selectionResize = new ResizeObserver(scheduleEvidence);
  document.addEventListener('click', event => {
    // Navigation is never needed to inspect a component and cannot leave the sandbox.
    if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault();
    if (!inspect || !(event.target instanceof Element)) return;
    const element = event.target.closest('[data-foundation-source]');
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!element || !mappings.has(element.getAttribute('data-foundation-source'))) {
      selected = null;
      selectionResize.disconnect();
      outline.style.display = 'none';
      send('unmapped', { message: 'This element has no validated explicit source mapping.' });
      return;
    }
    selected = element;
    selectionResize.disconnect();
    selectionResize.observe(selected);
    selectionEvidence('select');
  }, true);
  document.addEventListener('submit', event => event.preventDefault(), true);

  const validToken = token => token && typeof token.name === 'string' && /^--[A-Za-z_][\w-]{0,100}$/.test(token.name) && typeof token.value === 'string' && token.value.length <= 160 && !/[;{}<>\\\n\r]/.test(token.value) && !/url\s*\(|\/\*|@import|expression\s*\(/i.test(token.value);
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || !data || data.channel !== 'foundation-design' || data.session !== session || data.type !== 'settings') return;
    document.documentElement.dataset.theme = data.theme === 'dark' ? 'dark' : 'light';
    inspect = data.inspect === true;
    if (typeof data.focusPath === 'string' && selected?.getAttribute('data-foundation-source') !== data.focusPath) { selected = null; selectionResize.disconnect(); outline.style.display = 'none'; }
    document.documentElement.dataset.foundationInspect = String(inspect);
    const rules = [];
    let skipped = 0;
    if (Array.isArray(data.tokens)) for (const token of data.tokens.slice(0, 80)) {
      const scope = token?.scope || ':root';
      if (!validToken(token) || typeof scope !== 'string' || scope.length > 300 || !/^[-:#.\[\]="'\w\s>+~(),*]+$/.test(scope) || !CSS.supports(`selector(${scope})`)) { skipped++; continue; }
      rules.push(`${scope}{${token.name}:${token.value};}`);
    }
    experiments.textContent = rules.join('\n');
    selectionEvidence();
    send('settingsApplied', { theme: document.documentElement.dataset.theme, inspect, experiments: rules.length, skipped });
  });
  class PreviewBoundary extends React.Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error) { reportError(error); }
    render() { return this.state.error ? React.createElement('pre', { id: 'foundation-runtime-error', role: 'alert' }, String(this.state.error.message).slice(0, 1000)) : this.props.children; }
  }
  function Ready({ component: Component }) {
    React.useEffect(() => { if (!failed) send('ready', { network: false, sourceMapping: 'explicit' }); }, []);
    return React.createElement(Component);
  }
  try {
    const module = loadEntry();
    const Component = module.default || module.App;
    if (typeof Component !== 'function' && typeof Component !== 'object') throw new Error('Choose a React entry with a default export or a named App export.');
    createRoot(document.getElementById('root'), { onUncaughtError: reportError }).render(React.createElement(PreviewBoundary, null, React.createElement(Ready, { component: Component })));
  } catch (error) { reportError(error); }
}

window.FoundationPreviewRuntime = Object.freeze({ packages, start });
