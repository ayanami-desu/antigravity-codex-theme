/**
 * tests/telemetry-toolbar-layout.test.mjs — Status bar toolbar discovery, dropdown stability & hysteresis tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

class FakeClassList {
  constructor(el) {
    this.el = el;
  }
  _list() {
    return String(this.el.className || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }
  contains(cls) {
    return this._list().includes(cls);
  }
  add(...names) {
    const set = new Set(this._list());
    for (const n of names) if (n) set.add(n);
    this.el.className = Array.from(set).join(' ');
  }
  remove(...names) {
    const removeSet = new Set(names);
    this.el.className = this._list()
      .filter((c) => !removeSet.has(c))
      .join(' ');
  }
}

class FakeElement {
  constructor(tag, opts = {}) {
    this.nodeType = 1;
    this.tagName = String(tag || 'DIV').toUpperCase();
    this.id = opts.id || '';
    this.className = opts.className || '';
    this.attrs = new Map(Object.entries(opts.attrs || {}));
    if (this.id) this.attrs.set('id', this.id);
    this.children = [];
    this.parentElement = null;
    this.parentNode = null;
    this.style = { display: '' };
    this._computedStyle = Object.assign(
      { display: 'block', flexDirection: 'row' },
      opts.computedStyle || {}
    );
    this._width = typeof opts.width === 'number' ? opts.width : 0;
    this._height = typeof opts.height === 'number' ? opts.height : 28;
    this._scrollWidth = typeof opts.scrollWidth === 'number' ? opts.scrollWidth : 0;
    this._innerHTML = '';
    this.textContent = opts.textContent || '';
    this._listeners = new Map();
    this.classList = new FakeClassList(this);
  }

  get isConnected() {
    let cur = this;
    while (cur) {
      if (cur._isRoot) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get lastElementChild() {
    return this.children[this.children.length - 1] || null;
  }

  get nextSibling() {
    return this.nextElementSibling;
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    return idx >= 0 && idx + 1 < this.parentElement.children.length
      ? this.parentElement.children[idx + 1]
      : null;
  }

  get scrollWidth() {
    return this._scrollWidth;
  }

  set scrollWidth(v) {
    this._scrollWidth = v;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._innerHTML = String(html || '');
    if (this.id === 'ag-live-metrics-pill' || this.classList.contains('ag-live-metrics-pill')) {
      const hasSpan = this.children.some((c) => c.classList.contains('ag-live-metrics-text'));
      if (!hasSpan && this._innerHTML.includes('ag-live-metrics-text')) {
        const span = new FakeElement('SPAN', {
          id: this.id === 'ag-live-metrics-pill' ? 'ag-live-metrics-text' : '',
          className: 'ag-live-metrics-text',
          scrollWidth: 190
        });
        this.appendChild(span);
      }
    }
  }

  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, refNode) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    child.parentNode = this;
    if (!refNode) {
      this.children.push(child);
      return child;
    }
    const idx = this.children.indexOf(refNode);
    if (idx === -1) {
      this.children.push(child);
    } else {
      this.children.splice(idx, 0, child);
    }
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    child.parentElement = null;
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentElement) this.parentElement.removeChild(this);
  }

  prepend(child) {
    return this.insertBefore(child, this.children[0] || null);
  }

  contains(target) {
    let cur = target;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  setAttribute(k, v) {
    const val = String(v);
    this.attrs.set(k, val);
    if (k === 'id') this.id = val;
    if (k === 'class') this.className = val;
  }

  getAttribute(k) {
    if (k === 'id') return this.id || null;
    if (k === 'class') return this.className || null;
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }

  hasAttribute(k) {
    return this.getAttribute(k) !== null;
  }

  removeAttribute(k) {
    this.attrs.delete(k);
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners.get(type);
    if (!list) return;
    const idx = list.indexOf(fn);
    if (idx !== -1) list.splice(idx, 1);
  }
  dispatchEvent(evt) {
    const list = this._listeners.get(evt.type) || [];
    for (const fn of list.slice()) fn(evt);
  }

  getBoundingClientRect() {
    return {
      width: this._width,
      height: this._height,
      top: 600,
      bottom: 600 + this._height,
      left: 0,
      right: this._width
    };
  }

  matches(selector) {
    const parts = String(selector || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sel of parts) {
      if (sel.startsWith('.')) {
        if (this.classList.contains(sel.slice(1))) return true;
      } else if (sel.startsWith('#')) {
        if (this.id === sel.slice(1).replace(/\\/g, '')) return true;
      } else if (sel.startsWith('[') && sel.endsWith(']')) {
        const inner = sel.slice(1, -1);
        const eq = inner.indexOf('=');
        if (eq === -1) {
          if (this.hasAttribute(inner)) return true;
        } else {
          const attrName = inner.slice(0, eq).trim();
          const attrVal = inner.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
          if (this.getAttribute(attrName) === attrVal) return true;
        }
      }
    }
    return false;
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const out = [];
    const visit = (node) => {
      for (const ch of node.children) {
        if (ch.matches(selector)) out.push(ch);
        visit(ch);
      }
    };
    visit(this);
    return out;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function buildComposerDom({ withExplicitFooter = true, boxWidth = 768, footerWidth = 754, modelWidth = 174, rightWidth = 256 } = {}) {
  const body = new FakeElement('BODY');
  body._isRoot = true;

  const cid = '58b8db37-d172-4d42-b1dd-19915dba962e';
  const convView = new FakeElement('DIV', {
    attrs: { 'data-testid': 'conversation-view', 'data-cascade-id': cid }
  });
  body.appendChild(convView);

  const inputBox = new FakeElement('DIV', {
    id: 'antigravity.agentSidePanelInputBox',
    className: 'surface-composer relative flex flex-col',
    computedStyle: { display: 'flex', flexDirection: 'column' },
    width: boxWidth
  });
  convView.appendChild(inputBox);

  const card = new FakeElement('DIV', {
    className: 'surface-composer-card relative flex flex-col',
    computedStyle: { display: 'flex', flexDirection: 'column' },
    width: boxWidth - 4
  });
  inputBox.appendChild(card);

  const editorRow = new FakeElement('DIV', {
    className: 'relative w-full',
    computedStyle: { display: 'block' },
    width: footerWidth
  });
  card.appendChild(editorRow);

  const footer = new FakeElement('DIV', {
    className: withExplicitFooter
      ? 'agy-composer-footer flex w-full items-center justify-between gap-1 p-0.5'
      : 'flex w-full items-center justify-between gap-1 p-0.5',
    attrs: withExplicitFooter ? { 'data-agent-composer-root': '' } : {},
    computedStyle: { display: 'flex', flexDirection: 'row' },
    width: footerWidth
  });
  card.appendChild(footer);

  const leftGroup = new FakeElement('DIV', {
    className: 'flex min-w-0 flex-1 items-center gap-0',
    computedStyle: { display: 'flex', flexDirection: 'row' },
    width: footerWidth - rightWidth - 8
  });
  footer.appendChild(leftGroup);

  const plusBtn = new FakeElement('BUTTON', { width: 28 });
  const hiddenInput = new FakeElement('INPUT', { className: 'hidden', width: 0 });
  leftGroup.appendChild(plusBtn);
  leftGroup.appendChild(hiddenInput);

  // Antigravity 2.34.0's 4 nested wrappers around [data-testid="model-selector-trigger"]
  const depth4 = new FakeElement('DIV', {
    className: 'flex items-center gap-0 min-w-0',
    computedStyle: { display: 'flex', flexDirection: 'row' },
    width: modelWidth
  });
  const depth3 = new FakeElement('DIV', {
    className: 'flex items-center gap-1 min-w-0',
    computedStyle: { display: 'flex', flexDirection: 'row' },
    width: modelWidth
  });
  const depth2 = new FakeElement('DIV', {
    className: 'min-w-0 no-focus-agent-input',
    computedStyle: { display: 'block', flexDirection: 'row' },
    width: modelWidth
  });
  const depth1 = new FakeElement('DIV', {
    className: 'min-w-0',
    computedStyle: { display: 'block', flexDirection: 'row' },
    width: modelWidth
  });
  const modelTrigger = new FakeElement('BUTTON', {
    attrs: { 'data-testid': 'model-selector-trigger' },
    computedStyle: { display: 'flex', flexDirection: 'row' },
    width: modelWidth,
    textContent: 'Gemini 4 Neon Extra High'
  });

  leftGroup.appendChild(depth4);
  depth4.appendChild(depth3);
  depth3.appendChild(depth2);
  depth2.appendChild(depth1);
  depth1.appendChild(modelTrigger);

  const rightGroup = new FakeElement('DIV', {
    className: 'shrink-0 flex items-center gap-0.5',
    computedStyle: { display: 'flex', flexDirection: 'row' },
    width: rightWidth
  });
  footer.appendChild(rightGroup);

  return { body, cid, inputBox, card, footer, leftGroup, rightGroup, depth4, depth3, depth2, depth1, modelTrigger };
}

function mountTelemetryBundle(dom, bootOverrides = {}) {
  const runtimeDir = path.join(ROOT_DIR, 'core', 'runtime');
  const parts = ['00-head.js', '30-antigravity-probe.js', '40-status-machine.js', '50-telemetry-ui.js', '90-tail.js'];
  const head = new FakeElement('HEAD');
  head._isRoot = true;

  const fakeDocument = {
    head,
    body: dom.body,
    hidden: false,
    documentElement: new FakeElement('HTML'),
    getElementById(id) {
      if (head.id === id) return head;
      const inHead = head.querySelector('#' + id);
      if (inHead) return inHead;
      return dom.body.querySelector('#' + id);
    },
    createElement(tag) {
      return new FakeElement(tag);
    },
    querySelector(sel) {
      return dom.body.querySelector(sel);
    },
    querySelectorAll(sel) {
      return dom.body.querySelectorAll(sel);
    },
    addEventListener() {},
    removeEventListener() {}
  };

  let roCallback = null;
  const roInstances = [];
  let rafQueue = [];
  const requestedMetricsSigs = [];
  const bootPayload = Object.assign(
    {
      version: 'test',
      modules: { theme: false, i18n: false, metrics: true, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      themeMode: 'auto',
      i18nLocale: 'zh-CN',
      telemetryLayout: 'compact',
      css: '',
      i18n: { exact: {}, prefix: [], substring: [] }
    },
    bootOverrides
  );

  const fakeWindow = {
    document: fakeDocument,
    location: { pathname: '/c/' + dom.cid },
    navigator: { onLine: true },
    innerWidth: 1280,
    innerHeight: 800,
    history: { pushState() {}, replaceState() {} },
    getComputedStyle: (el) => (el && el._computedStyle) || { display: 'block', flexDirection: 'row' },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (fn) => {
      rafQueue.push(fn);
      return rafQueue.length;
    },
    cancelAnimationFrame: () => {},
    ResizeObserver: class {
      constructor(cb) {
        roCallback = cb;
        this.cb = cb;
        this.observed = [];
        this.disconnected = false;
        roInstances.push(this);
      }
      observe(el) {
        this.observed.push(el);
      }
      disconnect() {
        this.disconnected = true;
      }
    },
    __agRequestMetrics: (sig) => {
      requestedMetricsSigs.push(sig);
    },
    __ag_boot: bootPayload
  };
  fakeWindow.top = fakeWindow;

  const sandbox = {
    __AG_BOOT_PAYLOAD__: bootPayload,
    window: fakeWindow,
    document: fakeDocument,
    location: fakeWindow.location,
    navigator: fakeWindow.navigator,
    history: fakeWindow.history,
    getComputedStyle: fakeWindow.getComputedStyle,
    requestAnimationFrame: fakeWindow.requestAnimationFrame,
    cancelAnimationFrame: fakeWindow.cancelAnimationFrame,
    ResizeObserver: fakeWindow.ResizeObserver,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    console
  };

  const code = parts.map((p) => fs.readFileSync(path.join(runtimeDir, p), 'utf8')).join('\n');
  vm.runInNewContext(code, sandbox);

  const flushRaf = () => {
    const q = rafQueue.slice();
    rafQueue = [];
    for (const fn of q) fn();
  };

  return {
    win: fakeWindow,
    doc: fakeDocument,
    roInstances,
    requestedMetricsSigs,
    triggerResize: () => {
      if (roCallback) roCallback();
      flushRaf();
    }
  };
}

test('Opening model selector dropdown or tooltip never hijacks toolbar row or moves pill into inner wrappers', () => {
  const dom = buildComposerDom({ withExplicitFooter: true });
  const env = mountTelemetryBundle(dom, { telemetryLayout: 'compact' });

  env.win.__ag_on_route_change();
  const pill = env.doc.getElementById('ag-live-metrics-pill');
  assert.ok(pill, 'pill should be mounted');
  assert.equal(pill.parentElement, dom.leftGroup);
  assert.equal(pill.getAttribute('data-ag-row-mode'), 'middle');
  assert.equal(dom.footer.getAttribute('data-ag-row-mode'), 'middle');

  // Simulate Base-UI opening the model selector menu / tooltip: siblings mount inside depth1 & depth3
  const focusGuard = new FakeElement('SPAN', { attrs: { 'data-base-ui-focus-guard': '' }, width: 0 });
  const agentBadge = new FakeElement('DIV', { className: 'agent-badge', width: 20 });
  dom.depth1.appendChild(focusGuard);
  dom.depth3.appendChild(agentBadge);

  for (let i = 0; i < 6; i++) {
    env.win.__ag_on_route_change();
    env.triggerResize();
  }

  assert.equal(pill.parentElement, dom.leftGroup, 'pill must stay inside canonical leftGroup');
  assert.equal(pill.getAttribute('data-ag-row-mode'), 'middle');
  assert.equal(dom.footer.getAttribute('data-ag-row-mode'), 'middle');
  for (const wrapper of [dom.depth1, dom.depth2, dom.depth3, dom.depth4]) {
    assert.equal(wrapper.getAttribute('data-ag-row-mode'), null, 'inner wrapper must never get data-ag-row-mode');
  }
});

test('Bundle initialization heals stale data-ag-row-mode attributes left on inner model-selector wrappers', () => {
  const dom = buildComposerDom({ withExplicitFooter: true });
  // Simulate pre-existing corruption from v1.3.0
  for (const wrapper of [dom.depth1, dom.depth2, dom.depth3, dom.depth4]) {
    wrapper.setAttribute('data-ag-row-mode', 'bottom');
  }

  const env = mountTelemetryBundle(dom, { telemetryLayout: 'compact' });
  env.win.__ag_on_route_change();

  for (const wrapper of [dom.depth1, dom.depth2, dom.depth3, dom.depth4]) {
    assert.equal(wrapper.getAttribute('data-ag-row-mode'), null, 'stale inner data-ag-row-mode must be stripped');
  }
  const pill = env.doc.getElementById('ag-live-metrics-pill');
  assert.equal(pill.parentElement, dom.leftGroup);
  assert.equal(dom.footer.getAttribute('data-ag-row-mode'), 'middle');
});

test('Structural fallback skips inner flex-row wrappers even if canonical footer class/attr are renamed', () => {
  const dom = buildComposerDom({ withExplicitFooter: false });
  const focusGuard = new FakeElement('SPAN', { attrs: { 'data-base-ui-focus-guard': '' }, width: 0 });
  const agentBadge = new FakeElement('DIV', { width: 24 });
  dom.depth1.appendChild(focusGuard);
  dom.depth3.appendChild(agentBadge);

  const env = mountTelemetryBundle(dom, { telemetryLayout: 'compact' });
  env.win.__ag_on_route_change();

  const pill = env.doc.getElementById('ag-live-metrics-pill');
  assert.ok(pill);
  assert.equal(pill.parentElement, dom.leftGroup);
  assert.equal(dom.footer.getAttribute('data-ag-row-mode'), 'middle');
  for (const wrapper of [dom.depth1, dom.depth2, dom.depth3, dom.depth4]) {
    assert.equal(wrapper.getAttribute('data-ag-row-mode'), null);
  }
});

test('Both detailed and compact modes adapt dynamically between inline middle and bottom row with hysteresis', () => {
  const dom = buildComposerDom({ withExplicitFooter: true, boxWidth: 960, footerWidth: 946, modelWidth: 174, rightWidth: 256 });
  const env = mountTelemetryBundle(dom, { telemetryLayout: 'detailed' });

  env.win.__ag_on_route_change();
  const pill = env.doc.getElementById('ag-live-metrics-pill');
  const textEl = pill.querySelector('.ag-live-metrics-text');
  textEl.scrollWidth = 316; // neededWidth = 336, enter-middle = 360

  env.win.__ag_render_metrics({
    cid: dom.cid,
    hasData: true,
    inlineHtml: '<span class="ag-ctx-pending-dot ag-dot-idle"></span><span>115 tok/s · TTFT 6.2s · Ctx 66k/512k (13%) · Out 5.6k</span>',
    tooltipHtml: '<div>ok</div>'
  });

  // Wide composer: freeWidth = 946 - 202 - 256 - 16 = 472 >= 360 -> stays inline in middle
  assert.equal(pill.getAttribute('data-ag-row-mode'), 'middle');
  assert.equal(dom.footer.getAttribute('data-ag-row-mode'), 'middle');
  assert.equal(pill.parentElement, dom.leftGroup, 'detailed mode should stay inline when composer has enough width');

  // Narrower composer: freeWidth = 754 - 202 - 256 - 16 = 280 < 336 -> dynamically wraps to bottom row
  dom.inputBox._width = 768;
  dom.footer._width = 754;
  env.triggerResize();
  assert.equal(pill.getAttribute('data-ag-row-mode'), 'bottom');
  assert.equal(dom.footer.getAttribute('data-ag-row-mode'), 'bottom');
  assert.equal(pill.parentElement, dom.card, 'detailed mode must wrap to vertical card below footer when narrow');
  assert.equal(dom.footer.nextElementSibling, pill);

  // Hysteresis band for detailed mode (freeWidth = 348: >= 336 stay-middle, < 360 enter-middle) -> holds bottom
  dom.inputBox._width = 836;
  dom.footer._width = 822;
  env.triggerResize();
  assert.equal(pill.getAttribute('data-ag-row-mode'), 'bottom', 'detailed mode must hold bottom inside hysteresis band');

  // Widen past threshold (freeWidth = 376 >= 360) -> returns inline to middle
  dom.inputBox._width = 864;
  dom.footer._width = 850;
  env.triggerResize();
  assert.equal(pill.getAttribute('data-ag-row-mode'), 'middle');
  assert.equal(pill.parentElement, dom.leftGroup);

  // Compact mode adapts smoothly between middle and bottom with 24px hysteresis
  const compactDom = buildComposerDom({ withExplicitFooter: true, boxWidth: 768, footerWidth: 754, modelWidth: 174, rightWidth: 256 });
  const compactEnv = mountTelemetryBundle(compactDom, { telemetryLayout: 'compact' });
  compactEnv.win.__ag_on_route_change();
  const compactPill = compactEnv.doc.getElementById('ag-live-metrics-pill');
  const compactText = compactPill.querySelector('.ag-live-metrics-text');
  compactText.scrollWidth = 200; // neededWidth = 220

  // Wide composer: freeWidth = 754 - 202 - 256 - 16 = 280 >= 244 -> middle
  compactEnv.triggerResize();
  assert.equal(compactPill.getAttribute('data-ag-row-mode'), 'middle');
  assert.equal(compactPill.parentElement, compactDom.leftGroup);

  // Narrow sidebar: freeWidth = 650 - 202 - 256 - 16 = 176 < 220 -> bottom
  compactDom.inputBox._width = 664;
  compactDom.footer._width = 650;
  compactEnv.triggerResize();
  assert.equal(compactPill.getAttribute('data-ag-row-mode'), 'bottom');
  assert.equal(compactPill.parentElement, compactDom.card);

  // Slightly widen inside hysteresis band (freeWidth = 232: >= 220 stay-middle, < 244 enter-middle) -> holds bottom
  compactDom.inputBox._width = 720;
  compactDom.footer._width = 706;
  compactEnv.triggerResize();
  assert.equal(compactPill.getAttribute('data-ag-row-mode'), 'bottom', 'hysteresis must hold bottom mode until headroom >= needed+24');

  // Widen past threshold (freeWidth = 260 >= 244) -> returns to middle
  compactDom.inputBox._width = 748;
  compactDom.footer._width = 734;
  compactEnv.triggerResize();
  assert.equal(compactPill.getAttribute('data-ag-row-mode'), 'middle');
  assert.equal(compactPill.parentElement, compactDom.leftGroup);

  // Slightly narrow inside hysteresis band (freeWidth = 232 >= 220) -> holds middle
  compactDom.inputBox._width = 720;
  compactDom.footer._width = 706;
  compactEnv.triggerResize();
  assert.equal(compactPill.getAttribute('data-ag-row-mode'), 'middle', 'hysteresis must hold middle mode without flip-flopping');
});

function createConversationPane({
  cid,
  boxWidth = 520,
  footerWidth = 506,
  modelWidth = 174,
  rightWidth = 220,
  modelLabel = 'Gemini 4 Argon High'
} = {}) {
  const convAttrs = { 'data-testid': 'conversation-view' };
  if (cid) convAttrs['data-cascade-id'] = cid;
  const convView = new FakeElement('DIV', { attrs: convAttrs });

  const inputBox = new FakeElement('DIV', {
    id: 'antigravity.agentSidePanelInputBox',
    className: 'surface-composer relative flex flex-col',
    computedStyle: { display: 'flex', flexDirection: 'column' },
    width: boxWidth
  });
  convView.appendChild(inputBox);

  const card = new FakeElement('DIV', {
    className: 'surface-composer-card relative flex flex-col',
    computedStyle: { display: 'flex', flexDirection: 'column' },
    width: boxWidth - 4
  });
  inputBox.appendChild(card);

  const footer = new FakeElement('DIV', {
    className: 'agy-composer-footer flex w-full items-center justify-between gap-1 p-0.5',
    attrs: { 'data-agent-composer-root': '' },
    computedStyle: { display: 'flex', flexDirection: 'row' },
    width: footerWidth
  });
  card.appendChild(footer);

  const leftGroup = new FakeElement('DIV', {
    className: 'flex min-w-0 flex-1 items-center gap-0',
    computedStyle: { display: 'flex', flexDirection: 'row' },
    width: footerWidth - rightWidth - 8
  });
  footer.appendChild(leftGroup);

  const modelTrigger = new FakeElement('BUTTON', {
    attrs: { 'data-testid': 'model-selector-trigger' },
    computedStyle: { display: 'flex', flexDirection: 'row' },
    width: modelWidth,
    textContent: modelLabel
  });
  leftGroup.appendChild(modelTrigger);

  const rightGroup = new FakeElement('DIV', {
    className: 'shrink-0 flex items-center gap-0.5',
    computedStyle: { display: 'flex', flexDirection: 'row' },
    width: rightWidth
  });
  footer.appendChild(rightGroup);

  return { convView, inputBox, card, footer, leftGroup, rightGroup, modelTrigger };
}

test('Split-screen conversations mount independent telemetry pills, watch both cascade IDs, and reconcile cleanly on reorder or close', () => {
  const body = new FakeElement('BODY');
  body._isRoot = true;
  const cidA = '11111111-1111-4111-8111-111111111111';
  const cidB = '22222222-2222-4222-8222-222222222222';

  const paneA = createConversationPane({ cid: cidA, modelLabel: 'Gemini 4 Neon High' });
  const paneB = createConversationPane({ cid: cidB, modelLabel: 'Gemini 4 Argon High' });
  body.appendChild(paneA.convView);
  body.appendChild(paneB.convView);

  const env = mountTelemetryBundle({ body, cid: cidA }, { telemetryLayout: 'detailed' });
  env.win.__ag_on_route_change();

  // Both split conversations are discovered and requested from the daemon
  assert.deepEqual(Array.from(env.win.__ag_get_watched_cascade_ids()), [cidA, cidB]);
  assert.equal(env.requestedMetricsSigs[env.requestedMetricsSigs.length - 1], `${cidA},${cidB}`);

  // Both panes mount their own telemetry pill inside their own composer box
  const pillA = paneA.inputBox.querySelector('.ag-live-metrics-pill');
  const pillB = paneB.inputBox.querySelector('.ag-live-metrics-pill');
  assert.ok(pillA, 'left split pane should mount a telemetry pill');
  assert.ok(pillB, 'right split pane should mount a telemetry pill');
  assert.equal(pillA.id, 'ag-live-metrics-pill');
  assert.equal(pillB.id, 'ag-live-metrics-pill-1');
  assert.equal(pillA.getAttribute('data-ag-pane'), 'main');
  assert.equal(pillB.getAttribute('data-ag-pane'), 'main-1');
  assert.equal(pillA.parentElement, paneA.card);
  assert.equal(pillB.parentElement, paneB.card);

  // Pushing metrics for each conversation updates only its matching split pane
  const htmlA = '<span class="ag-ctx-pending-dot ag-dot-idle"></span><span>133 tok/s · Ctx 305k/512k (60%)</span>';
  const htmlB = '<span class="ag-ctx-pending-dot ag-dot-idle"></span><span>88 tok/s · Ctx 416k/512k (81%)</span>';
  env.win.__ag_render_metrics({
    cid: cidA,
    hasData: true,
    inlineHtml: htmlA,
    tooltipHtml: '<div class="ag-tt-wrap">Pane A stats</div>'
  });
  env.win.__ag_render_metrics({
    cid: cidB,
    hasData: true,
    inlineHtml: htmlB,
    tooltipHtml: '<div class="ag-tt-wrap">Pane B stats</div>'
  });

  assert.equal(pillA.querySelector('.ag-live-metrics-text').getAttribute('data-ag-raw-html'), htmlA);
  assert.equal(pillB.querySelector('.ag-live-metrics-text').getAttribute('data-ag-raw-html'), htmlB);
  assert.equal(pillA.style.display, 'inline-flex');
  assert.equal(pillB.style.display, 'inline-flex');

  // Clicking right split pane pill opens tooltip with Pane B data and owner key main-1
  pillB.dispatchEvent({ type: 'click', stopPropagation() {} });
  const tt = env.doc.getElementById('ag-live-metrics-tooltip');
  assert.ok(tt);
  assert.equal(tt.getAttribute('data-visible'), '1');
  assert.equal(tt.getAttribute('data-ag-owner-pane'), 'main-1');
  assert.ok(tt.innerHTML.includes('Pane B stats'));

  // Reordering split panes reconciles IDs without stealing pills or creating duplicate IDs
  body.appendChild(paneA.convView); // DOM order is now [paneB, paneA]
  env.win.__ag_on_route_change();
  assert.equal(paneB.inputBox.querySelector('.ag-live-metrics-pill'), pillB);
  assert.equal(paneA.inputBox.querySelector('.ag-live-metrics-pill'), pillA);
  assert.equal(pillB.id, 'ag-live-metrics-pill');
  assert.equal(pillB.getAttribute('data-ag-pane'), 'main');
  assert.equal(pillB.querySelector('.ag-live-metrics-text').id, 'ag-live-metrics-text');
  assert.equal(pillA.id, 'ag-live-metrics-pill-1');
  assert.equal(pillA.getAttribute('data-ag-pane'), 'main-1');
  assert.equal(pillA.querySelector('.ag-live-metrics-text').id, '');

  // Closing one split pane removes stale pane state, disconnects its ResizeObserver, and keeps remaining pane active
  paneA.convView.remove();
  env.win.__ag_on_route_change();
  assert.deepEqual(Array.from(env.win.__ag_get_watched_cascade_ids()), [cidB]);
  assert.equal(body.querySelectorAll('.ag-live-metrics-pill').length, 1);
  assert.equal(env.doc.getElementById('ag-live-metrics-pill'), pillB);
  assert.equal(pillB.querySelector('.ag-live-metrics-text').getAttribute('data-ag-raw-html'), htmlB);
  assert.equal(env.win.__ag_pane_states['main-1'], undefined);
  assert.ok(env.roInstances.some((ro) => ro.disconnected), 'closing split pane must disconnect stale ResizeObserver');

  // Opening a brand-new draft split pane (no data-cascade-id yet) does not inherit Pane B metrics
  const draftPane = createConversationPane({ cid: '' });
  body.appendChild(draftPane.convView);
  env.win.__ag_on_route_change();
  const draftPill = draftPane.inputBox.querySelector('.ag-live-metrics-pill');
  assert.ok(draftPill, 'draft split pane should still mount its own status pill');
  assert.equal(draftPill.id, 'ag-live-metrics-pill-1');
  assert.ok(draftPill.querySelector('.ag-live-metrics-text').innerHTML.includes('就绪'));
  assert.equal(pillB.querySelector('.ag-live-metrics-text').getAttribute('data-ag-raw-html'), htmlB);
});
