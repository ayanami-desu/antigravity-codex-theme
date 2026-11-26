/**
 * tests/quota-ui.test.mjs — Sidebar Quota Parsing, Pool Matching, Formatting, Config & Mount Tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { sanitizeConfigPatch } from '../core/daemon/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT_DIR, 'core', 'runtime');

const SAMPLE_QUOTA_RESPONSE = {
  response: {
    groups: [
      {
        displayName: 'Gemini Models',
        description:
          'Models within this group: Gemini 4 Neon, Gemini 4 Carbon, Gemini 4 Argon, Gemini 4 Hydrogen, Orchestrator (Neon), Gemini 3.8 Flash',
        buckets: [
          {
            bucketId: 'gemini-weekly',
            window: 'weekly',
            remaining: { case: 'remainingFraction', value: 0.8827 },
            resetTime: { seconds: '1796089143', nanos: 0 },
            disabled: false
          },
          {
            bucketId: 'gemini-5h',
            window: '5h',
            remaining: { case: 'remainingFraction', value: 1 },
            resetTime: { seconds: '1795631635' }
          }
        ]
      },
      {
        displayName: 'Claude and GPT models',
        description: 'Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B',
        buckets: [
          {
            bucketId: '3p-weekly',
            window: 'weekly',
            remaining: { case: 'remainingFraction', value: 0.51 },
            resetTime: { seconds: '1796014353', nanos: 0 },
            disabled: false
          },
          {
            bucketId: '3p-5h',
            window: '5h',
            remaining: { case: 'remainingFraction', value: 0.9 },
            resetTime: { seconds: '1795631013', nanos: 0 },
            disabled: false
          }
        ]
      }
    ]
  }
};

function loadQuotaHelpers() {
  const probeSrc = fs.readFileSync(path.join(RUNTIME_DIR, '30-antigravity-probe.js'), 'utf8');
  const quotaSrc = fs.readFileSync(path.join(RUNTIME_DIR, '55-quota-ui.js'), 'utf8');
  const sandbox = { console, Date, Math, Number, String, Array, Object, Boolean };
  vm.createContext(sandbox);
  vm.runInContext(
    `${probeSrc}\n${quotaSrc}\nglobalThis.__exports = {
      parseQuotaResetMs,
      parseQuotaSummary,
      formatShortPoolLabel,
      formatPoolTitle,
      matchActiveQuotaGroupIndex,
      classifyQuotaLevel,
      computeQuotaSegments,
      computeQuotaDotLevels,
      normalizeQuotaStyle,
      normalizeQuotaOtherStyle,
      formatQuotaCountdownLabel,
      formatQuotaModelShort,
      formatQuotaCountdown,
      formatQuotaResetDetail,
      hasExpiredQuotaBucket
    };`,
    sandbox
  );
  return sandbox.__exports;
}

class FakeElement {
  constructor(tag, attrs = {}) {
    this.nodeType = 1;
    this.tagName = String(tag || 'DIV').toUpperCase();
    this.id = attrs.id || '';
    this.className = attrs.className || '';
    this.attrs = new Map(Object.entries(attrs));
    this.children = [];
    this.parentElement = null;
    this.parentNode = null;
    this.style = {};
    this.innerHTML = '';
    this.textContent = attrs.textContent || '';
    this.innerText = attrs.textContent || '';
    this._listeners = new Map();
    this.classList = {
      add: (c) => {
        const s = new Set(String(this.className || '').split(/\s+/).filter(Boolean));
        s.add(c);
        this.className = Array.from(s).join(' ');
      },
      remove: (c) => {
        this.className = String(this.className || '')
          .split(/\s+/)
          .filter((x) => x && x !== c)
          .join(' ');
      },
      contains: (c) =>
        String(this.className || '')
          .split(/\s+/)
          .includes(c)
    };
  }
  get isConnected() {
    let cur = this;
    while (cur) {
      if (cur._isRoot) return true;
      cur = cur.parentElement;
    }
    return false;
  }
  get nextElementSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    return idx >= 0 && idx + 1 < this.parentElement.children.length ? this.parentElement.children[idx + 1] : null;
  }
  appendChild(ch) {
    if (ch.parentElement) ch.parentElement.removeChild(ch);
    ch.parentElement = this;
    ch.parentNode = this;
    this.children.push(ch);
    return ch;
  }
  insertBefore(ch, ref) {
    if (ch.parentElement) ch.parentElement.removeChild(ch);
    ch.parentElement = this;
    ch.parentNode = this;
    const idx = ref ? this.children.indexOf(ref) : -1;
    if (idx === -1) this.children.push(ch);
    else this.children.splice(idx, 0, ch);
    return ch;
  }
  removeChild(ch) {
    const idx = this.children.indexOf(ch);
    if (idx !== -1) this.children.splice(idx, 1);
    ch.parentElement = null;
    ch.parentNode = null;
    return ch;
  }
  remove() {
    if (this.parentElement) this.parentElement.removeChild(this);
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
    const arr = this._listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i !== -1) arr.splice(i, 1);
  }
  dispatch(type) {
    for (const fn of this._listeners.get(type) || []) fn();
  }
  getBoundingClientRect() {
    return { width: 240, height: 74, left: 8, top: 760, right: 248, bottom: 834 };
  }
  matches(sel) {
    if (sel === 'body *') return true;
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    const m = sel.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
    if (m) {
      return m[2] === undefined ? this.hasAttribute(m[1]) : this.getAttribute(m[1]) === m[2];
    }
    return false;
  }
  querySelectorAll(sel) {
    const out = [];
    const visit = (node) => {
      for (const ch of node.children) {
        if (ch.matches(sel)) out.push(ch);
        visit(ch);
      }
    };
    visit(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}

test('parseQuotaSummary parses string/BigInt resetTime.seconds, skips disabled/non-fraction buckets, and supports >2 pools', () => {
  const h = loadQuotaHelpers();
  const groups = h.parseQuotaSummary(SAMPLE_QUOTA_RESPONSE);
  assert.equal(groups.length, 2);

  assert.equal(groups[0].displayName, 'Gemini Models');
  assert.equal(groups[0].shortLabel, 'Gemini');
  assert.equal(groups[0].weekly.pct, 88);
  assert.equal(groups[0].weekly.resetMs, 1796089143000);
  assert.equal(groups[0].fiveHour.pct, 100);
  assert.equal(groups[0].fiveHour.resetMs, 1795631635000);
  assert.ok(groups[0].models.includes('Gemini 3.8 Flash'));

  assert.equal(groups[1].displayName, 'Claude and GPT models');
  assert.equal(groups[1].shortLabel, 'Claude·GPT');
  assert.equal(groups[1].fiveHour.pct, 90);
  assert.equal(groups[1].weekly.pct, 51);

  // Edge cases: BigInt seconds, disabled bucket, unknown remaining case, and 3rd pool
  const extended = h.parseQuotaSummary({
    response: {
      groups: [
        ...SAMPLE_QUOTA_RESPONSE.response.groups,
        {
          displayName: 'Experimental Models',
          description: 'Models within this group: Exp Alpha 1.0',
          buckets: [
            {
              bucketId: 'custom-5h-id',
              window: '5h',
              remaining: { case: 'remainingFraction', value: 0.42 },
              resetTime: { seconds: 1795639999n, nanos: 500000000 },
              disabled: false
            },
            {
              bucketId: 'custom-weekly-disabled',
              window: 'weekly',
              remaining: { case: 'remainingFraction', value: 0.5 },
              disabled: true
            },
            {
              bucketId: 'custom-weekly-unknown',
              window: 'weekly',
              remaining: { case: 'unknownQuota', value: 99 },
              disabled: false
            }
          ]
        }
      ]
    }
  });
  assert.equal(extended.length, 3, 'Should support more than 2 pools dynamically');
  assert.equal(extended[2].shortLabel, 'Experimental');
  assert.equal(extended[2].fiveHour.pct, 42);
  assert.equal(extended[2].fiveHour.resetMs, 1795639999500);
  assert.equal(extended[2].weekly, null, 'Disabled and non-remainingFraction buckets must be omitted');
});

test('matchActiveQuotaGroupIndex matches Claude Opus, Gemini 3.8 Flash, effort-suffixed labels, and unknown fallbacks', () => {
  const h = loadQuotaHelpers();
  const groups = h.parseQuotaSummary(SAMPLE_QUOTA_RESPONSE);

  assert.equal(h.matchActiveQuotaGroupIndex(groups, 'Claude Opus'), 1);
  assert.equal(h.matchActiveQuotaGroupIndex(groups, 'Claude Opus 5.5 (High)'), 1);
  assert.equal(h.matchActiveQuotaGroupIndex(groups, 'GPT-OSS 120B (Medium)'), 1);
  assert.equal(h.matchActiveQuotaGroupIndex(groups, 'Gemini 3.8 Flash'), 0);
  assert.equal(h.matchActiveQuotaGroupIndex(groups, 'Gemini 4 Neon Extra High'), 0);
  assert.equal(h.matchActiveQuotaGroupIndex(groups, 'Orchestrator (Neon)'), 0);

  // Fallbacks for unknown models
  assert.equal(h.matchActiveQuotaGroupIndex(groups, 'Gemini 9 Ultra'), 0);
  assert.equal(h.matchActiveQuotaGroupIndex(groups, 'Orchestrator Future'), 0);
  assert.equal(h.matchActiveQuotaGroupIndex(groups, 'Unknown ThirdParty X'), 1);
});

test('formatQuotaCountdown and formatQuotaResetDetail format 4:43, 0:09, 4d, and em-dash accurately', () => {
  const h = loadQuotaHelpers();
  const baseNow = new Date(2026, 10, 26, 8, 0, 0).getTime(); // Thu Nov 26 2026 08:00 local

  assert.equal(h.formatQuotaCountdown(baseNow + (4 * 60 + 43) * 60000, 0.9, baseNow), '4:43');
  assert.equal(h.formatQuotaCountdown(baseNow + 9 * 60000, 0.06, baseNow), '0:09');
  assert.equal(h.formatQuotaCountdown(baseNow + 4 * 24 * 3600000 + 3600000, 0.51, baseNow), '4d');
  assert.equal(h.formatQuotaCountdown(baseNow + 5 * 3600000, 1, baseNow), '—');
  assert.equal(h.formatQuotaCountdown(null, 0.5, baseNow), '—');

  assert.equal(h.formatQuotaResetDetail(baseNow + (4 * 60 + 43) * 60000, 0.9, true, baseNow), '4 小时 43 分后');
  assert.equal(h.formatQuotaResetDetail(baseNow + (4 * 60 + 43) * 60000, 0.9, false, baseNow), 'in 4h 43m');
  assert.equal(h.formatQuotaResetDetail(baseNow + 5 * 3600000, 1, true, baseNow), '—');

  // Next Monday 08:00 (4 days after Thursday 08:00)
  const monReset = baseNow + 4 * 24 * 3600000;
  assert.equal(h.formatQuotaResetDetail(monReset, 0.51, true, baseNow), '周一 08:00');
  assert.equal(h.formatQuotaResetDetail(monReset, 0.51, false, baseNow), 'Mon 08:00');
});

test('classifyQuotaLevel, computeQuotaSegments, computeQuotaDotLevels, and normalizeQuotaStyle work accurately', () => {
  const h = loadQuotaHelpers();

  assert.equal(h.classifyQuotaLevel(31), 'ok');
  assert.equal(h.classifyQuotaLevel(30), 'low');
  assert.equal(h.classifyQuotaLevel(11), 'low');
  assert.equal(h.classifyQuotaLevel(10), 'crit');
  assert.equal(h.classifyQuotaLevel(0), 'crit');

  assert.deepEqual(Array.from(h.computeQuotaSegments(51)), [100, 100, 55, 0, 0]);
  assert.deepEqual(Array.from(h.computeQuotaSegments(100)), [100, 100, 100, 100, 100]);
  assert.deepEqual(Array.from(h.computeQuotaSegments(0)), [0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(h.computeQuotaSegments(10)), [50, 0, 0, 0, 0]);

  assert.deepEqual(Array.from(h.computeQuotaDotLevels(55, 10)), [
    'full', 'full', 'full', 'full', 'full', 'part', 'empty', 'empty', 'empty', 'empty'
  ]);
  assert.equal(h.normalizeQuotaStyle('rings'), 'rings');
  assert.equal(h.normalizeQuotaStyle('gauge'), 'gauge');
  assert.equal(h.normalizeQuotaStyle('dots'), 'dots');
  assert.equal(h.normalizeQuotaStyle('compact'), 'compact');
  assert.equal(h.normalizeQuotaStyle('invalid'), 'segments');
  assert.equal(h.normalizeQuotaOtherStyle('hidden'), 'hidden');
  assert.equal(h.normalizeQuotaOtherStyle('rows'), 'rows');
  assert.equal(h.normalizeQuotaOtherStyle('bogus'), 'lines');
  assert.equal(h.formatQuotaModelShort('Claude Opus 5.5 (High)'), 'Opus 5.5');
  assert.equal(h.formatQuotaModelShort('Gemini 3.8 Flash (Low)'), '3.8 Flash');
  assert.equal(
    h.formatQuotaModelShort('Select model, current: Gemini 4 Neon Extra High. Applies to /btw and messages sent after this turn'),
    '4 Neon',
    'Must strip Antigravity 2.35.2 /btw hint and thinking effort suffix'
  );
  assert.equal(
    h.formatQuotaModelShort('Gemini 4 Neon Extra High, Model cannot be changed while the agent is running'),
    '4 Neon'
  );
  const baseNow = new Date(2026, 10, 26, 8, 0, 0).getTime(); // Thu Nov 26 2026 08:00 local
  assert.equal(h.formatQuotaCountdownLabel({ resetMs: baseNow + 283 * 60000, remainingFraction: 0.9 }, true, baseNow), '4:43 后重置');
  assert.equal(h.formatQuotaCountdownLabel({ resetMs: baseNow + 4 * 86400000, remainingFraction: 0.5 }, true, baseNow), '周一 08:00 重置');
  assert.equal(h.formatQuotaCountdownLabel({ resetMs: baseNow + 4 * 86400000, remainingFraction: 0.5 }, true, baseNow, true), '周一 08:00');
  assert.equal(h.formatQuotaCountdownLabel({ resetMs: baseNow + 3600000, remainingFraction: 1 }, true, baseNow), '满额');
  assert.equal(h.formatQuotaCountdownLabel({ resetMs: baseNow + 283 * 60000, remainingFraction: 0.9 }, false, baseNow), 'resets 4:43');
  assert.equal(h.formatQuotaCountdownLabel({ resetMs: baseNow + 4 * 86400000, remainingFraction: 0.5 }, false, baseNow, true), 'Mon 08:00');

  // hasExpiredQuotaBucket ignores 100% full buckets with stale resetMs, flags <100% buckets past resetMs
  assert.equal(
    h.hasExpiredQuotaBucket(
      [
        {
          fiveHour: { remainingFraction: 1, resetMs: baseNow - 60000 },
          weekly: { remainingFraction: 0.88, resetMs: baseNow + 3600000 }
        }
      ],
      baseNow
    ),
    false,
    'Full (100%) bucket with past resetMs must NOT be treated as expired'
  );
  assert.equal(
    h.hasExpiredQuotaBucket(
      [
        {
          fiveHour: { remainingFraction: 0.71, resetMs: baseNow - 1000 },
          weekly: { remainingFraction: 0.8, resetMs: baseNow + 3600000 }
        }
      ],
      baseNow
    ),
    true,
    'Non-full bucket whose resetMs has passed must be flagged as expired'
  );
});

test('sanitizeConfigPatch toggles modules.quota, validates quotaStyle, and ignores unknown fields', () => {
  const baseCfg = {
    quotaStyle: 'segments',
    modules: { theme: true, i18n: true, metrics: true, quota: true }
  };

  const p1 = sanitizeConfigPatch(baseCfg, {
    quotaStyle: 'rings',
    modules: { quota: false }
  });
  assert.equal(p1.quotaStyle, 'rings');
  assert.equal(p1.modules.quota, false);

  const p2 = sanitizeConfigPatch(p1, {
    quotaStyle: 'rainbow',
    modules: { quota: true, unknownMod: true }
  });
  assert.equal(p2.quotaStyle, 'rings', 'invalid quotaStyle must be ignored');
  assert.equal(p2.modules.quota, true);
  assert.equal(p2.modules.unknownMod, undefined);

  const p3 = sanitizeConfigPatch(p2, { quotaOtherStyle: 'hidden', modules: { quotaSidebar: false } });
  assert.equal(p3.quotaOtherStyle, 'hidden');
  assert.equal(p3.modules.quotaSidebar, false);
  const p4 = sanitizeConfigPatch(p3, { quotaOtherStyle: 'neon' });
  assert.equal(p4.quotaOtherStyle, 'hidden', 'invalid quotaOtherStyle must be ignored');
});

test('Assembled quota runtime mounts before settings-button, paints cache + refreshes live, switches pool on model change, and cleans up timers/tap', async () => {
  const parts = ['00-head.js', '30-antigravity-probe.js', '55-quota-ui.js', '90-tail.js'];
  const code = parts.map((p) => fs.readFileSync(path.join(RUNTIME_DIR, p), 'utf8')).join('\n');

  const body = new FakeElement('BODY');
  body._isRoot = true;
  const head = new FakeElement('HEAD');
  head._isRoot = true;

  const sidebarBottom = new FakeElement('DIV', { className: 'flex flex-col gap-px pt-2 px-2' });
  const settingsBtn = new FakeElement('BUTTON', { 'data-testid': 'settings-button', textContent: 'Settings' });
  sidebarBottom.appendChild(settingsBtn);
  body.appendChild(sidebarBottom);

  const modelTrigger = new FakeElement('BUTTON', {
    'data-testid': 'model-selector-trigger',
    'aria-label': 'Model: Claude Opus 5.5 (High)',
    textContent: 'Claude Opus 5.5 (High)'
  });
  body.appendChild(modelTrigger);
  const metricsTt = new FakeElement('DIV', { id: 'ag-live-metrics-tooltip' });
  body.appendChild(metricsTt);

  const fetchCalls = [];
  const origRetrieve = async function (forceRefresh) {
    fetchCalls.push(forceRefresh);
    return SAMPLE_QUOTA_RESPONSE;
  };
  const fakeService = {
    retrieveUserQuotaSummary: origRetrieve
  };
  sidebarBottom.__reactFiber$test = {
    memoizedProps: { value: { core: { cloudCodeService: fakeService } } },
    return: null
  };

  const intervals = new Map();
  let nextTimerId = 1;
  let observerCb = null;

  const fakeDoc = {
    head,
    body,
    hidden: false,
    documentElement: new FakeElement('HTML'),
    getElementById: (id) => head.querySelector('#' + id) || body.querySelector('#' + id),
    createElement: (tag) => new FakeElement(tag),
    getElementsByTagName: (t) => (t === 'head' ? [head] : []),
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener() {},
    removeEventListener() {}
  };

  const sandbox = {
    __AG_BOOT_PAYLOAD__: {
      version: '1.4.0-test',
      platform: 'darwin',
      enabled: true,
      cssText: '',
      customCss: '',
      themeVars: {},
      i18nDict: {},
      modules: { theme: false, i18n: true, metrics: true, quota: true, quotaSidebar: true, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      selectors: {},
      userConfig: { modules: { i18n: true, quota: true } },
      customJs: ''
    },
    location: { pathname: '/', href: 'http://127.0.0.1/', search: '' },
    navigator: { platform: 'MacIntel', onLine: true },
    history: { pushState() {}, replaceState() {} },
    innerWidth: 1280,
    innerHeight: 900,
    document: fakeDoc,
    addEventListener() {},
    removeEventListener() {},
    setInterval(fn, ms) {
      const id = nextTimerId++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    setTimeout(fn) {
      fn();
      return nextTimerId++;
    },
    clearTimeout() {},
    requestAnimationFrame: () => 1,
    MutationObserver: class {
      constructor(cb) {
        observerCb = cb;
      }
      observe() {}
      disconnect() {}
    },
    console
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(`const __AG_BOOT_PAYLOAD__ = globalThis.__AG_BOOT_PAYLOAD__;\n${code}`, sandbox);
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(fetchCalls, [false, true], 'Must paint from cache (false) then immediately pull live quota (true)');
  assert.notEqual(fakeService.retrieveUserQuotaSummary, origRetrieve, 'Passive service tap should be installed while mounted');
  const quotaEl = fakeDoc.getElementById('ag-quota');
  assert.ok(quotaEl, '#ag-quota should mount');
  assert.equal(quotaEl.parentElement, sidebarBottom);
  assert.equal(quotaEl.nextElementSibling, settingsBtn, '#ag-quota must sit right before settings-button');
  assert.ok(quotaEl.innerHTML.includes('Gemini'), 'Secondary pool mini row should show Gemini when Claude is active');
  assert.ok(quotaEl.innerHTML.includes('>5h<') && quotaEl.innerHTML.includes('>7d<'), 'Windows must be labelled 5h / 7d');
  assert.ok(quotaEl.innerHTML.includes('当前') && quotaEl.innerHTML.includes('Opus 5.5'), 'Active pool header shows badge and model');
  assert.ok(quotaEl.innerHTML.includes('90<small>%</small>'), 'Active pool shows exact percentage');
  assert.equal(quotaEl.getAttribute('data-ostyle'), 'lines');
  const foot = metricsTt.querySelector('.ag-quota-tt');
  assert.ok(foot && foot.innerHTML.includes('Claude·GPT') && foot.innerHTML.includes('>7d<'), 'Telemetry panel footer shows active pool quota');

  // Switch model to Gemini -> re-renders secondary mini row to Claude·GPT without refetching
  modelTrigger.setAttribute('aria-label', 'Model: Gemini 3.8 Flash (Low)');
  modelTrigger.textContent = 'Gemini 3.8 Flash (Low)';
  modelTrigger.innerText = 'Gemini 3.8 Flash (Low)';
  if (observerCb) observerCb();
  assert.equal(fetchCalls.length, 2, 'Model change must NOT refetch quota API');
  assert.ok(quotaEl.innerHTML.includes('Claude·GPT'), 'Secondary pool mini row should switch to Claude·GPT');

  // Hovering #ag-quota must NOT open any popover panel
  quotaEl.dispatch('mouseenter');
  assert.equal(fakeDoc.getElementById('ag-quota-popover'), null, 'Sidebar quota block must not open a hover popover');

  // Instant graphic style switching via __ag_set_quota_style without re-fetching API
  sandbox.__ag_set_quota_style('bar');
  assert.equal(quotaEl.getAttribute('data-style'), 'bar');
  assert.ok(quotaEl.innerHTML.includes('ag-quota-cbar-main'));

  sandbox.__ag_set_quota_style('rings');
  assert.equal(quotaEl.getAttribute('data-style'), 'rings');
  assert.ok(quotaEl.innerHTML.includes('ag-quota-ring-svg'));

  sandbox.__ag_set_quota_style('gauge');
  assert.equal(quotaEl.getAttribute('data-style'), 'gauge');
  assert.ok(quotaEl.innerHTML.includes('ag-quota-gauge-svg'));

  sandbox.__ag_set_quota_style('dots');
  assert.equal(quotaEl.getAttribute('data-style'), 'dots');
  assert.ok(quotaEl.innerHTML.includes('ag-quota-dots'));

  sandbox.__ag_set_quota_style('compact');
  assert.equal(quotaEl.getAttribute('data-style'), 'compact');
  assert.ok(quotaEl.innerHTML.includes('ag-quota-vticks'));

  sandbox.__ag_set_quota_other_style('hidden');
  assert.ok(!quotaEl.innerHTML.includes('Claude·GPT'), 'Hidden other-pool style must not render the idle pool');
  assert.ok(!quotaEl.innerHTML.includes('ag-quota-sep'));
  sandbox.__ag_set_quota_other_style('text');
  assert.ok(quotaEl.innerHTML.includes('ag-quota-o-time') && quotaEl.innerHTML.includes('Claude·GPT'), 'Text other-pool style must include concrete reset times');
  sandbox.__ag_set_quota_other_style('segments');
  assert.ok(quotaEl.innerHTML.includes('ag-quota-mseg') && quotaEl.innerHTML.includes('ag-quota-o-time'), 'Segments other-pool style must include concrete reset times');
  sandbox.__ag_set_quota_other_style('rings');
  assert.ok(quotaEl.innerHTML.includes('ag-quota-o-rcol') && quotaEl.innerHTML.includes('ag-quota-o-time'), 'Rings other-pool style must include concrete reset times');
  sandbox.__ag_set_quota_other_style('lines');
  assert.ok(quotaEl.innerHTML.includes('ag-quota-o-grid') && quotaEl.innerHTML.includes('ag-quota-o-time'), 'Lines other-pool style must include concrete reset times');
  sandbox.__ag_set_quota_other_style('rows');
  assert.ok(quotaEl.innerHTML.includes('ag-quota-orow'));

  assert.equal(fetchCalls.length, 2, 'Switching display graphic styles must never trigger extra quota fetches');

  // Cleanup removes DOM nodes, restores service tap, and clears all intervals
  assert.ok(intervals.size >= 2, 'Fetch and countdown timers should be active while mounted');
  for (const fn of sandbox.__ag_cleanup_fns) fn();
  assert.equal(intervals.size, 0, 'Cleanup must clear all intervals with zero leaks');
  assert.equal(fakeService.retrieveUserQuotaSummary, origRetrieve, 'Cleanup must restore original retrieveUserQuotaSummary');
  assert.equal(fakeDoc.getElementById('ag-quota'), null);
  assert.equal(fakeDoc.getElementById('ag-quota-popover'), null);
});

test('Quota freshness: startup live refresh, passive native tap, window.focus wake, expired reset tick, and click-to-refresh', async () => {
  const parts = ['00-head.js', '30-antigravity-probe.js', '55-quota-ui.js', '90-tail.js'];
  const code = parts.map((p) => fs.readFileSync(path.join(RUNTIME_DIR, p), 'utf8')).join('\n');

  let fakeNow = new Date(2026, 10, 26, 15, 0, 0).getTime();
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length === 0 ? [fakeNow] : args));
    }
    static now() {
      return fakeNow;
    }
  }

  function makeQuotaResponse(fiveHourFrac, weeklyFrac, fiveHourResetMs, weeklyResetMs) {
    return {
      response: {
        groups: [
          {
            displayName: 'Gemini Models',
            description: 'Models within this group: Gemini 4 Neon',
            buckets: [
              {
                bucketId: 'gemini-5h',
                window: '5h',
                remaining: { case: 'remainingFraction', value: fiveHourFrac },
                resetTime: { seconds: String(Math.floor(fiveHourResetMs / 1000)), nanos: 0 },
                disabled: false
              },
              {
                bucketId: 'gemini-weekly',
                window: 'weekly',
                remaining: { case: 'remainingFraction', value: weeklyFrac },
                resetTime: { seconds: String(Math.floor(weeklyResetMs / 1000)), nanos: 0 },
                disabled: false
              }
            ]
          }
        ]
      }
    };
  }

  const body = new FakeElement('BODY');
  body._isRoot = true;
  const head = new FakeElement('HEAD');
  head._isRoot = true;
  const sidebarBottom = new FakeElement('DIV');
  const settingsBtn = new FakeElement('BUTTON', { 'data-testid': 'settings-button' });
  sidebarBottom.appendChild(settingsBtn);
  body.appendChild(sidebarBottom);
  const modelTrigger = new FakeElement('BUTTON', {
    'data-testid': 'model-selector-trigger',
    'aria-label': 'Model: Gemini 4 Neon Extra High',
    textContent: 'Gemini 4 Neon Extra High'
  });
  body.appendChild(modelTrigger);
  const metricsTt = new FakeElement('DIV', { id: 'ag-live-metrics-tooltip' });
  body.appendChild(metricsTt);

  let nextCacheRes = makeQuotaResponse(0.71, 0.8, fakeNow - 60000, fakeNow + 86400000);
  let nextLiveRes = makeQuotaResponse(0.98, 1.0, fakeNow + 4 * 3600000, fakeNow + 6 * 86400000);
  const fetchCalls = [];
  const origRetrieve = async function (forceRefresh) {
    fetchCalls.push(Boolean(forceRefresh));
    return forceRefresh ? nextLiveRes : nextCacheRes;
  };
  const fakeService = { retrieveUserQuotaSummary: origRetrieve };
  sidebarBottom.__reactFiber$test = {
    memoizedProps: { value: { core: { cloudCodeService: fakeService } } },
    return: null
  };

  const intervals = new Map();
  let nextTimerId = 1;
  const docListeners = new Map();
  const winListeners = new Map();
  const addL = (map, t, fn) => {
    if (!map.has(t)) map.set(t, []);
    map.get(t).push(fn);
  };
  const remL = (map, t, fn) => {
    const arr = map.get(t);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i !== -1) arr.splice(i, 1);
  };
  const fire = (map, t) => {
    for (const fn of [...(map.get(t) || [])]) fn();
  };

  const fakeDoc = {
    head,
    body,
    hidden: false,
    documentElement: new FakeElement('HTML'),
    getElementById: (id) => head.querySelector('#' + id) || body.querySelector('#' + id),
    createElement: (tag) => new FakeElement(tag),
    getElementsByTagName: (t) => (t === 'head' ? [head] : []),
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener: (t, fn) => addL(docListeners, t, fn),
    removeEventListener: (t, fn) => remL(docListeners, t, fn)
  };

  const sandbox = {
    Date: FakeDate,
    __AG_BOOT_PAYLOAD__: {
      version: '1.4.0-test',
      platform: 'darwin',
      enabled: true,
      cssText: '',
      customCss: '',
      themeVars: {},
      i18nDict: {},
      modules: { theme: false, i18n: true, metrics: true, quota: true, quotaSidebar: true, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      selectors: {},
      userConfig: { modules: { i18n: true, quota: true } },
      customJs: ''
    },
    location: { pathname: '/', href: 'http://127.0.0.1/', search: '' },
    navigator: { platform: 'MacIntel', onLine: true },
    history: { pushState() {}, replaceState() {} },
    innerWidth: 1280,
    innerHeight: 900,
    document: fakeDoc,
    addEventListener: (t, fn) => addL(winListeners, t, fn),
    removeEventListener: (t, fn) => remL(winListeners, t, fn),
    setInterval(fn, ms) {
      const id = nextTimerId++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    setTimeout(fn) {
      fn();
      return nextTimerId++;
    },
    clearTimeout() {},
    requestAnimationFrame: () => 1,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    console
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(`const __AG_BOOT_PAYLOAD__ = globalThis.__AG_BOOT_PAYLOAD__;\n${code}`, sandbox);
  await new Promise((r) => setImmediate(r));

  const quotaEl = fakeDoc.getElementById('ag-quota');
  assert.deepEqual(fetchCalls, [false, true], 'Startup paints stale cache then pulls live quota immediately');
  assert.ok(quotaEl.innerHTML.includes('98<small>%</small>'), 'DOM should immediately show fresh 98% instead of stale 71%');

  // Passive tap: native "查看用量" calls fakeService.retrieveUserQuotaSummary(true) -> sidebar & footer sync immediately
  nextLiveRes = makeQuotaResponse(0.84, 0.96, fakeNow + 3 * 3600000, fakeNow + 6 * 86400000);
  await fakeService.retrieveUserQuotaSummary(true);
  await new Promise((r) => setImmediate(r));
  assert.equal(fetchCalls.length, 3, 'Passive tap must not trigger any duplicate fetch');
  assert.ok(quotaEl.innerHTML.includes('84<small>%</small>'), 'Sidebar must sync immediately from native quota call');
  assert.ok(metricsTt.querySelector('.ag-quota-tt').innerHTML.includes('84%'), 'Telemetry footer must sync immediately too');

  // Rapid window.focus inside 30s cooldown must NOT trigger extra forceRefresh
  fakeNow += 5000;
  fire(winListeners, 'focus');
  await new Promise((r) => setImmediate(r));
  assert.equal(fetchCalls.length, 3, 'Window focus inside cooldown must not spam forceRefresh');

  // Window focus after 30s cooldown triggers live forceRefresh
  fakeNow += 31000;
  nextLiveRes = makeQuotaResponse(0.79, 0.95, fakeNow + 10000, fakeNow + 6 * 86400000);
  fire(winListeners, 'focus');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(fetchCalls.slice(-1), [true], 'Window focus after cooldown must trigger forceRefresh: true');
  assert.ok(quotaEl.innerHTML.includes('79<small>%</small>'));

  // Countdown passes resetMs -> 30s tickTimer detects expired bucket and forces live refresh
  fakeNow += 35000;
  nextLiveRes = makeQuotaResponse(1.0, 0.95, fakeNow + 5 * 3600000, fakeNow + 6 * 86400000);
  const tickEntry = Array.from(intervals.values()).find((x) => x.ms === 30000);
  assert.ok(tickEntry, '30s tick timer should exist');
  tickEntry.fn();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(fetchCalls.slice(-1), [true], 'Expired non-full bucket must trigger forceRefresh on tick');
  assert.ok(quotaEl.innerHTML.includes('100<small>%</small>'), 'Expired bucket must refresh to newly reset 100%');

  // Click-to-refresh on #ag-quota: debounced inside 5s, works immediately after 5s
  const countBeforeClick = fetchCalls.length;
  fakeNow += 2000;
  quotaEl.dispatch('click');
  await new Promise((r) => setImmediate(r));
  assert.equal(fetchCalls.length, countBeforeClick, 'Manual click inside 5s debounce must not spam');

  fakeNow += 4000;
  nextLiveRes = makeQuotaResponse(0.92, 0.94, fakeNow + 4 * 3600000, fakeNow + 6 * 86400000);
  quotaEl.dispatch('click');
  await new Promise((r) => setImmediate(r));
  assert.equal(fetchCalls.length, countBeforeClick + 1);
  assert.deepEqual(fetchCalls.slice(-1), [true], 'Manual click on #ag-quota must trigger forceRefresh: true');
  assert.ok(quotaEl.innerHTML.includes('92<small>%</small>'));

  // Cleanup removes focus/visibility listeners and restores original service method
  for (const fn of sandbox.__ag_cleanup_fns) fn();
  assert.equal(fakeService.retrieveUserQuotaSummary, origRetrieve, 'Cleanup must restore tapped cloudCodeService method');
  assert.equal((winListeners.get('focus') || []).length, 0, 'Cleanup must remove window focus listener');
  assert.equal((docListeners.get('visibilitychange') || []).length, 0, 'Cleanup must remove visibilitychange listener');
  assert.equal(intervals.size, 0);
});

test('Quota runtime silently degrades when both modules.quota and modules.quotaSidebar are false with zero timers', async () => {
  const parts = ['00-head.js', '30-antigravity-probe.js', '55-quota-ui.js', '90-tail.js'];
  const code = parts.map((p) => fs.readFileSync(path.join(RUNTIME_DIR, p), 'utf8')).join('\n');

  const body = new FakeElement('BODY');
  body._isRoot = true;
  const head = new FakeElement('HEAD');
  head._isRoot = true;
  const stale = new FakeElement('DIV', { id: 'ag-quota' });
  const staleTt = new FakeElement('DIV', { className: 'ag-quota-tt' });
  body.appendChild(stale);
  body.appendChild(staleTt);

  let intervalCount = 0;
  const fakeDoc = {
    head,
    body,
    hidden: false,
    documentElement: new FakeElement('HTML'),
    getElementById: (id) => head.querySelector('#' + id) || body.querySelector('#' + id),
    createElement: (tag) => new FakeElement(tag),
    getElementsByTagName: (t) => (t === 'head' ? [head] : []),
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener() {},
    removeEventListener() {}
  };

  const sandbox = {
    __AG_BOOT_PAYLOAD__: {
      version: '1.4.1-test',
      platform: 'darwin',
      enabled: true,
      cssText: '',
      customCss: '',
      themeVars: {},
      i18nDict: {},
      modules: { theme: false, i18n: false, metrics: false, quota: false, quotaSidebar: false, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      selectors: {},
      userConfig: { modules: { quota: false, quotaSidebar: false } },
      customJs: ''
    },
    location: { pathname: '/', href: 'http://127.0.0.1/', search: '' },
    navigator: { platform: 'MacIntel', onLine: true },
    history: { pushState() {}, replaceState() {} },
    document: fakeDoc,
    addEventListener() {},
    removeEventListener() {},
    setInterval() {
      intervalCount++;
      return intervalCount;
    },
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame: () => 1,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    console
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`const __AG_BOOT_PAYLOAD__ = globalThis.__AG_BOOT_PAYLOAD__;\n${code}`, sandbox);

  assert.equal(fakeDoc.getElementById('ag-quota'), null, 'Disabling both toggles must remove stale #ag-quota node');
  assert.equal(body.querySelector('.ag-quota-tt'), null, 'Disabling both toggles must remove stale .ag-quota-tt node');
  assert.equal(intervalCount, 0, 'Disabling both toggles must not start any timers');
});

test('quota=false with quotaSidebar=true independently mounts sidebar quota and omits panel footer', async () => {
  const parts = ['00-head.js', '30-antigravity-probe.js', '55-quota-ui.js', '90-tail.js'];
  const code = parts.map((p) => fs.readFileSync(path.join(RUNTIME_DIR, p), 'utf8')).join('\n');
  const body = new FakeElement('BODY');
  body._isRoot = true;
  const head = new FakeElement('HEAD');
  head._isRoot = true;
  const sidebarBottom = new FakeElement('DIV');
  const settingsBtn = new FakeElement('BUTTON', { 'data-testid': 'settings-button' });
  sidebarBottom.appendChild(settingsBtn);
  body.appendChild(sidebarBottom);
  const tt = new FakeElement('DIV', { id: 'ag-live-metrics-tooltip' });
  const staleFoot = new FakeElement('DIV', { className: 'ag-quota-tt' });
  tt.appendChild(staleFoot);
  body.appendChild(tt);
  const fakeService = { async retrieveUserQuotaSummary() { return SAMPLE_QUOTA_RESPONSE; } };
  sidebarBottom.__reactFiber$test = { memoizedProps: { value: { core: { cloudCodeService: fakeService } } }, return: null };
  const fakeDoc = {
    head, body, hidden: false, documentElement: new FakeElement('HTML'),
    getElementById: (id) => head.querySelector('#' + id) || body.querySelector('#' + id),
    createElement: (tag) => new FakeElement(tag),
    getElementsByTagName: (t) => (t === 'head' ? [head] : []),
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener() {}, removeEventListener() {}
  };
  const sandbox = {
    __AG_BOOT_PAYLOAD__: {
      version: '1.4.1-test', platform: 'darwin', enabled: true, cssText: '', customCss: '', themeVars: {}, i18nDict: {},
      modules: { theme: false, i18n: true, metrics: true, quota: false, quotaSidebar: true, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      selectors: {}, userConfig: { modules: { quota: false, quotaSidebar: true } }, customJs: ''
    },
    location: { pathname: '/', href: 'http://127.0.0.1/', search: '' },
    navigator: { platform: 'MacIntel', onLine: true },
    history: { pushState() {}, replaceState() {} },
    innerWidth: 1280, innerHeight: 900, document: fakeDoc,
    addEventListener() {}, removeEventListener() {},
    setInterval: () => 1, clearInterval() {}, setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {},
    requestAnimationFrame: () => 1,
    MutationObserver: class { observe() {} disconnect() {} },
    console
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`const __AG_BOOT_PAYLOAD__ = globalThis.__AG_BOOT_PAYLOAD__;\n${code}`, sandbox);
  await new Promise((r) => setImmediate(r));
  const quotaEl = fakeDoc.getElementById('ag-quota');
  assert.ok(quotaEl && quotaEl.innerHTML.includes('Gemini'), 'Sidebar block must still mount independently when quota=false and quotaSidebar=true');
  assert.equal(tt.querySelector('.ag-quota-tt'), null, 'Panel footer must be removed and omitted when quota=false');
  for (const fn of sandbox.__ag_cleanup_fns) fn();
});

test('quotaSidebar=false keeps the telemetry panel footer but never mounts the sidebar block', async () => {
  const parts = ['00-head.js', '30-antigravity-probe.js', '55-quota-ui.js', '90-tail.js'];
  const code = parts.map((p) => fs.readFileSync(path.join(RUNTIME_DIR, p), 'utf8')).join('\n');
  const body = new FakeElement('BODY');
  body._isRoot = true;
  const head = new FakeElement('HEAD');
  head._isRoot = true;
  const sidebarBottom = new FakeElement('DIV');
  const settingsBtn = new FakeElement('BUTTON', { 'data-testid': 'settings-button' });
  sidebarBottom.appendChild(settingsBtn);
  body.appendChild(sidebarBottom);
  const tt = new FakeElement('DIV', { id: 'ag-live-metrics-tooltip' });
  body.appendChild(tt);
  const fakeService = { async retrieveUserQuotaSummary() { return SAMPLE_QUOTA_RESPONSE; } };
  sidebarBottom.__reactFiber$test = { memoizedProps: { value: { core: { cloudCodeService: fakeService } } }, return: null };
  const fakeDoc = {
    head, body, hidden: false, documentElement: new FakeElement('HTML'),
    getElementById: (id) => head.querySelector('#' + id) || body.querySelector('#' + id),
    createElement: (tag) => new FakeElement(tag),
    getElementsByTagName: (t) => (t === 'head' ? [head] : []),
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener() {}, removeEventListener() {}
  };
  const sandbox = {
    __AG_BOOT_PAYLOAD__: {
      version: '1.4.0-test', platform: 'darwin', enabled: true, cssText: '', customCss: '', themeVars: {}, i18nDict: {},
      modules: { theme: false, i18n: false, metrics: true, quota: true, quotaSidebar: false, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      selectors: {}, userConfig: { modules: { quota: true, quotaSidebar: false } }, customJs: ''
    },
    location: { pathname: '/', href: 'http://127.0.0.1/', search: '' },
    navigator: { platform: 'MacIntel', onLine: true },
    history: { pushState() {}, replaceState() {} },
    innerWidth: 1280, innerHeight: 900, document: fakeDoc,
    addEventListener() {}, removeEventListener() {},
    setInterval: () => 1, clearInterval() {}, setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {},
    requestAnimationFrame: () => 1,
    MutationObserver: class { observe() {} disconnect() {} },
    console
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`const __AG_BOOT_PAYLOAD__ = globalThis.__AG_BOOT_PAYLOAD__;\n${code}`, sandbox);
  await new Promise((r) => setImmediate(r));
  assert.equal(fakeDoc.getElementById('ag-quota'), null, 'Sidebar block must not mount when quotaSidebar is off');
  const foot = tt.querySelector('.ag-quota-tt');
  assert.ok(foot && foot.innerHTML.includes('Active') && foot.innerHTML.includes('>5h<'), 'Panel footer still renders');
});

test('gauge style renders enlarged 56x30 SVG arc and high-specificity percentage CSS to avoid 100% overlap (Issue #13)', async () => {
  const parts = ['00-head.js', '30-antigravity-probe.js', '55-quota-ui.js', '90-tail.js'];
  const code = parts.map((p) => fs.readFileSync(path.join(RUNTIME_DIR, p), 'utf8')).join('\n');
  const css = fs.readFileSync(path.join(ROOT_DIR, 'core', 'styles', '35-quota.css'), 'utf8');

  const body = new FakeElement('BODY');
  body._isRoot = true;
  const head = new FakeElement('HEAD');
  head._isRoot = true;
  const sidebarBottom = new FakeElement('DIV');
  sidebarBottom.appendChild(new FakeElement('BUTTON', { 'data-testid': 'settings-button' }));
  body.appendChild(sidebarBottom);

  const fakeService = { async retrieveUserQuotaSummary() { return SAMPLE_QUOTA_RESPONSE; } };
  sidebarBottom.__reactFiber$test = { memoizedProps: { value: { core: { cloudCodeService: fakeService } } }, return: null };

  const fakeDoc = {
    head, body, hidden: false, documentElement: new FakeElement('HTML'),
    getElementById: (id) => head.querySelector('#' + id) || body.querySelector('#' + id),
    createElement: (tag) => new FakeElement(tag),
    getElementsByTagName: (t) => (t === 'head' ? [head] : []),
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener() {}, removeEventListener() {}
  };
  const sandbox = {
    __AG_BOOT_PAYLOAD__: {
      version: '1.4.1-test', platform: 'darwin', enabled: true, cssText: '', customCss: '', themeVars: {}, i18nDict: {},
      quotaStyle: 'gauge',
      modules: { theme: false, i18n: false, metrics: false, quota: false, quotaSidebar: true, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      selectors: {}, userConfig: { quotaStyle: 'gauge', modules: { quota: false, quotaSidebar: true } }, customJs: ''
    },
    location: { pathname: '/', href: 'http://127.0.0.1/', search: '' },
    navigator: { platform: 'MacIntel', onLine: true },
    history: { pushState() {}, replaceState() {} },
    innerWidth: 1280, innerHeight: 900, document: fakeDoc,
    addEventListener() {}, removeEventListener() {},
    setInterval: () => 1, clearInterval() {}, setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {},
    requestAnimationFrame: () => 1,
    MutationObserver: class { observe() {} disconnect() {} },
    console
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`const __AG_BOOT_PAYLOAD__ = globalThis.__AG_BOOT_PAYLOAD__;\n${code}`, sandbox);
  await new Promise((r) => setImmediate(r));

  const quotaEl = fakeDoc.getElementById('ag-quota');
  assert.ok(quotaEl, 'Sidebar quota element should mount in gauge style');
  assert.ok(
    quotaEl.innerHTML.includes('width="56" height="30" viewBox="0 0 56 30"'),
    'Gauge SVG must use enlarged 56x30 geometry'
  );
  assert.ok(
    quotaEl.innerHTML.includes('d="M4 27 A24 24 0 0 1 52 27"'),
    'Gauge SVG arc path must span r=24 semicircle'
  );
  assert.ok(
    quotaEl.innerHTML.includes('<b class="ag-quota-gauge-pct">100%</b>'),
    'Gauge tile should render 100% inside b.ag-quota-gauge-pct'
  );
  assert.match(
    css,
    /#ag-quota \.ag-quota-tile b\.ag-quota-gauge-pct\s*\{[^}]*font-size:\s*10\.5px;/,
    '35-quota.css must override #ag-quota .ag-quota-tile b specificity for gauge percentage text'
  );
  assert.match(
    css,
    /#ag-quota \.ag-quota-gauge-dial\s*\{[^}]*width:\s*56px;[^}]*height:\s*30px;/,
    '35-quota.css must match 56x30 gauge dial container dimensions'
  );
  for (const fn of sandbox.__ag_cleanup_fns) fn();
});
