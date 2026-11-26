/**
 * tests/settings-ui.test.mjs — Settings UI Model Grouping & Config Patch Sanitization Tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  deriveEffortFromModelId,
  parseAgyModelsOutput
} from '../core/daemon/prompt-suggest.mjs';
import { sanitizeConfigPatch } from '../core/daemon/paths.mjs';
import {
  ALLOWED_EXTERNAL_LINKS,
  openAllowlistedExternalLink
} from '../core/daemon/cdp-bridge.mjs';
import {
  compareSemver,
  isSafeManifestRelPath,
  checkForUpdates,
  applyPluginUpdate
} from '../core/daemon/updater.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const SAMPLE_AGY_MODELS_RAW = [
  '\x1b[?25l⠋ Loading models...\r⠙ Loading models...\r\x1b[2K\x1b[?25h',
  'gemini-4-neon-low              Gemini 4 Neon (Low)',
  'gemini-4-neon-medium           Gemini 4 Neon (Medium)',
  'gemini-4-neon-high             Gemini 4 Neon (High)',
  'gemini-4-neon-xhigh            Gemini 4 Neon (XHigh)',
  'gemini-pro-orchestrator-neon   Orchestrator (Neon)',
  'gemini-3.8-flash-high          Gemini 3.8 Flash (High)',
  'gemini-3.8-flash-low           Gemini 3.8 Flash (Low)',
  'gemini-3.8-flash-medium        Gemini 3.8 Flash (Medium)',
  'gpt-oss-120b-medium            GPT-OSS 120B (Medium)',
  'claude-sonnet-5-5-medium       Claude Sonnet 5.5 (Medium)',
  'claude-sonnet-5-5-low          Claude Sonnet 5.5 (Low)'
].join('\n');

test('parseAgyModelsOutput strips ANSI/spinner frames, groups by base model, sorts efforts, and pins Gemini 3.8 Flash', () => {
  const families = parseAgyModelsOutput(SAMPLE_AGY_MODELS_RAW);
  assert.equal(families.length, 4, 'Orchestrator should be filtered out, leaving 4 model families');

  // Gemini 3.8 Flash pinned first as recommended with sorted efforts
  assert.equal(families[0].name, 'Gemini 3.8 Flash');
  assert.equal(families[0].recommended, true);
  assert.equal(families[0].defaultEffort, 'Low');
  assert.deepEqual(
    families[0].efforts.map((e) => [e.label, e.id]),
    [
      ['Low', 'gemini-3.8-flash-low'],
      ['Medium', 'gemini-3.8-flash-medium'],
      ['High', 'gemini-3.8-flash-high']
    ]
  );

  // XHigh maps cleanly to Extra High
  const neon = families.find((f) => f.name === 'Gemini 4 Neon');
  assert.ok(neon);
  assert.deepEqual(
    neon.efforts.map((e) => e.label),
    ['Low', 'Medium', 'High', 'Extra High']
  );

  // Single-tier model collapses to singleId
  const oss = families.find((f) => f.key === 'gpt-oss-120b');
  assert.ok(oss);
  assert.equal(oss.singleId, 'gpt-oss-120b-medium');
  assert.equal(oss.name, 'GPT-OSS 120B (Medium)');
  assert.deepEqual(oss.efforts, []);

  assert.deepEqual(parseAgyModelsOutput(''), []);
});

test('deriveEffortFromModelId maps model ID suffixes to valid agy --effort flags', () => {
  assert.equal(deriveEffortFromModelId('gemini-3.8-flash-low'), 'low');
  assert.equal(deriveEffortFromModelId('gemini-4-neon-medium'), 'medium');
  assert.equal(deriveEffortFromModelId('claude-opus-5-5-high'), 'high');
  assert.equal(deriveEffortFromModelId('gemini-4-neon-xhigh'), 'xhigh');
  assert.equal(deriveEffortFromModelId('custom-model-max'), 'max');
  assert.equal(deriveEffortFromModelId('unknown-model'), 'low');
});

test('sanitizeConfigPatch validates whitelisted fields and preserves untouched config keys', () => {
  const baseCfg = {
    enabled: true,
    preset: 'codex-pure-white',
    telemetryLayout: 'compact',
    telemetryCacheMode: 'session',
    promptSuggestionModel: 'gemini-3.8-flash-low',
    sshHosts: ['existing-node'],
    themeVars: { '--ag-chat-font-size': '14px' },
    modules: {
      theme: true,
      i18n: true,
      metrics: true,
      promptSuggestions: false,
      sshRemote: false
    }
  };

  const next = sanitizeConfigPatch(baseCfg, {
    telemetryLayout: 'detailed',
    telemetryCacheMode: 'invalid-mode',
    promptSuggestionModel: 'gemini-4-neon-xhigh',
    sshHosts: ['node032', '  node032  ', '-oProxyCommand=evil', 'bad host', 'gpu@10.0.0.1'],
    modules: {
      promptSuggestions: true,
      sshRemote: true,
      theme: 0,
      injectedUnknownModule: true
    }
  });

  assert.equal(next.preset, 'codex-pure-white');
  assert.deepEqual(next.themeVars, { '--ag-chat-font-size': '14px' });
  assert.equal(next.telemetryLayout, 'detailed');
  assert.equal(next.telemetryCacheMode, 'session', 'invalid cache mode should be ignored');
  assert.equal(next.promptSuggestionModel, 'gemini-4-neon-xhigh');
  assert.deepEqual(next.sshHosts, ['node032', 'gpu@10.0.0.1']);
  assert.equal(next.modules.promptSuggestions, true);
  assert.equal(next.modules.sshRemote, true);
  assert.equal(next.modules.theme, true, 'non-boolean module values should be ignored');
  assert.equal(next.modules.injectedUnknownModule, undefined);

  // Reject unsafe model IDs
  const rejected = sanitizeConfigPatch(next, {
    promptSuggestionModel: '--evil; rm -rf /'
  });
  assert.equal(rejected.promptSuggestionModel, 'gemini-4-neon-xhigh');
});

test('openAllowlistedExternalLink only opens hardcoded github and feedback URLs', () => {
  const calls = [];
  const fakeExec = (cmd, args) => calls.push({ cmd, args });

  const gh = openAllowlistedExternalLink('github', { execFileFn: fakeExec, platform: 'darwin' });
  assert.equal(gh.ok, true);
  assert.equal(gh.url, ALLOWED_EXTERNAL_LINKS.github);
  assert.deepEqual(calls[0], { cmd: 'open', args: [ALLOWED_EXTERNAL_LINKS.github] });

  const fb = openAllowlistedExternalLink('feedback', { execFileFn: fakeExec, platform: 'win32' });
  assert.equal(fb.ok, true);
  assert.equal(fb.url, ALLOWED_EXTERNAL_LINKS.feedback);
  assert.deepEqual(calls[1], {
    cmd: 'rundll32.exe',
    args: ['url.dll,FileProtocolHandler', ALLOWED_EXTERNAL_LINKS.feedback]
  });

  for (const bad of ['https://evil.example', 'toString', '__proto__', '']) {
    const res = openAllowlistedExternalLink(bad, { execFileFn: fakeExec, platform: 'darwin' });
    assert.equal(res.ok, false);
  }
  assert.equal(calls.length, 2, 'non-allowlisted keys must never invoke OS launcher');
});

test('60-i18n-engine translates dynamic quota-exhausted banners while preserving model names', () => {
  const i18nDict = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'core', 'i18n.json'), 'utf8'));
  const code = ['00-head.js', '60-i18n-engine.js', '90-tail.js']
    .map((f) => fs.readFileSync(path.join(ROOT_DIR, 'core', 'runtime', f), 'utf8'))
    .join('\n');

  const textNodes = [
    "Your plan's baseline quota will refresh on 11/23/2026, 3:00:00 PM. To continue using this model now, enable AI Credit overages.",
    "You need at least 50 AI Credits to send messages. To continue using Gemini 4 Neon now, purchase more AI Credits. Your plan's baseline quota will refresh on 23.11.2026, 15:00:00.",
    'Your quota for Gemini 4 Neon will reset on 11/23/2026, 3:00:00 PM. Switch to another available model to continue.',
    'Your quota for this model has been reached. Switch to another available model to continue.',
    'Too many requests, please try again in a bit!',
    'See plans'
  ].map((s) => ({
    nodeType: 3,
    nodeValue: s,
    parentElement: {
      tagName: 'SPAN',
      closest: () => null,
      getAttribute: () => null,
      hasAttribute: () => false,
      querySelectorAll: () => []
    }
  }));

  let walkIdx = -1;
  const headChildren = [];
  const headEl = { appendChild(el) { el.parentNode = headEl; headChildren.push(el); } };
  const fakeDoc = {
    head: headEl,
    body: {
      nodeType: 1,
      tagName: 'BODY',
      classList: { contains: () => false },
      style: { removeProperty() {} },
      closest: () => null,
      matches: () => false,
      hasAttribute: () => false,
      getAttribute: () => null,
      querySelectorAll: () => []
    },
    hidden: false,
    documentElement: { style: { removeProperty() {} }, setAttribute() {}, getAttribute: () => null, removeAttribute() {} },
    getElementById: (id) => headChildren.find((e) => e.id === id) || null,
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      id: '',
      textContent: '',
      style: {},
      setAttribute() {},
      removeAttribute() {},
      remove() {}
    }),
    getElementsByTagName: (t) => (t === 'head' ? [headEl] : []),
    querySelector: () => null,
    querySelectorAll: () => [],
    createTreeWalker: () => ({
      currentNode: null,
      nextNode() {
        walkIdx += 1;
        if (walkIdx >= textNodes.length) return false;
        this.currentNode = textNodes[walkIdx];
        return true;
      }
    }),
    addEventListener() {},
    removeEventListener() {}
  };

  const sandbox = {
    location: { pathname: '/', href: 'http://127.0.0.1/', search: '' },
    navigator: { platform: 'MacIntel', onLine: true },
    history: { pushState() {}, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame: () => 1,
    document: fakeDoc,
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    MutationObserver: class { observe() {} disconnect() {} },
    __AG_BOOT_PAYLOAD__: {
      version: '1.2.1-test',
      platform: 'darwin',
      enabled: true,
      cssText: '',
      customCss: '',
      themeVars: {},
      i18nDict,
      modules: { theme: false, i18n: true, metrics: false, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      selectors: {},
      userConfig: { modules: { i18n: true } },
      customJs: ''
    }
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`const __AG_BOOT_PAYLOAD__ = globalThis.__AG_BOOT_PAYLOAD__;\n${code}`, sandbox);

  assert.equal(
    textNodes[0].nodeValue,
    '当前方案的基础配额将于 11/23/2026, 3:00:00 PM 刷新。如需立即继续使用该模型，请开启 AI 点数超额抵扣。'
  );
  assert.equal(
    textNodes[1].nodeValue,
    '发送消息需要至少 50 AI 点数。如需立即继续使用 Gemini 4 Neon，请购买更多 AI 点数。当前方案的基础配额将于 23.11.2026, 15:00:00 刷新。'
  );
  assert.equal(
    textNodes[2].nodeValue,
    'Gemini 4 Neon 的配额将于 11/23/2026, 3:00:00 PM 重置。请切换至其他可用模型继续。'
  );
  assert.equal(
    textNodes[3].nodeValue,
    '该模型的配额已用尽。请切换至其他可用模型继续。'
  );
  assert.equal(textNodes[4].nodeValue, '请求过于频繁，请稍后再试！');
  assert.equal(textNodes[5].nodeValue, '查看套餐');
});

test('60-i18n-engine handles Antigravity 2.35.1 sentence-case labels, Thinking for Ns, Your plan, and running-state aria labels', () => {
  const i18nDict = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'core', 'i18n.json'), 'utf8'));
  const code = ['00-head.js', '60-i18n-engine.js', '90-tail.js']
    .map((f) => fs.readFileSync(path.join(ROOT_DIR, 'core', 'runtime', f), 'utf8'))
    .join('\n');

  const mkEl = (attrs = {}) => {
    const map = new Map(Object.entries(attrs));
    return {
      nodeType: 1,
      tagName: 'BUTTON',
      closest: () => null,
      matches: () => false,
      getAttribute: (k) => (map.has(k) ? map.get(k) : null),
      setAttribute: (k, v) => map.set(k, String(v)),
      removeAttribute: (k) => map.delete(k),
      hasAttribute: (k) => map.has(k),
      querySelectorAll: () => []
    };
  };

  const textNodes = [
    'Prevent sleep',
    'Keep in menu bar',
    'Enable notifications for agent',
    'Enable AI credit overages',
    'Open links in',
    'Delete all Remote Agents data',
    'This computer',
    'Thinking for 3s',
    'Your plan: Google AI Ultra',
    'Input Box',
    'Choose which key sends a message in the chat composer.',
    'Quote',
    'Low',
    'Extra High'
  ].map((s) => ({
    nodeType: 3,
    nodeValue: s,
    parentElement: mkEl()
  }));

  const attrEls = [
    mkEl({ 'aria-label': 'Model, current: Gemini 4 Neon Extra High, Model cannot be changed while the agent is running' }),
    mkEl({ 'aria-label': 'Permission mode: Turbo (Permissions cannot be changed while the agent is running)' }),
    mkEl({ placeholder: 'Search shortcuts...' }),
    mkEl({ 'aria-label': 'Where the agent runs, current: This computer' })
  ];
  const allWalkNodes = [...attrEls, ...textNodes];

  let walkIdx = -1;
  const headChildren = [];
  const headEl = { appendChild(el) { el.parentNode = headEl; headChildren.push(el); } };
  const fakeDoc = {
    head: headEl,
    body: {
      nodeType: 1,
      tagName: 'BODY',
      classList: { contains: () => false },
      style: { removeProperty() {} },
      closest: () => null,
      matches: () => false,
      hasAttribute: () => false,
      getAttribute: () => null,
      querySelectorAll: () => []
    },
    hidden: false,
    documentElement: { style: { removeProperty() {} }, setAttribute() {}, getAttribute: () => null, removeAttribute() {} },
    getElementById: (id) => headChildren.find((e) => e.id === id) || null,
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      id: '',
      textContent: '',
      style: {},
      setAttribute() {},
      removeAttribute() {},
      remove() {}
    }),
    getElementsByTagName: (t) => (t === 'head' ? [headEl] : []),
    querySelector: () => null,
    querySelectorAll: () => [],
    createTreeWalker: (_root, _what, filter) => ({
      currentNode: null,
      nextNode() {
        while (walkIdx + 1 < allWalkNodes.length) {
          walkIdx += 1;
          const n = allWalkNodes[walkIdx];
          const verdict = filter && filter.acceptNode ? filter.acceptNode(n) : 1;
          if (verdict === 1) {
            this.currentNode = n;
            return true;
          }
        }
        return false;
      }
    }),
    addEventListener() {},
    removeEventListener() {}
  };

  const sandbox = {
    location: { pathname: '/', href: 'http://127.0.0.1/', search: '' },
    navigator: { platform: 'MacIntel', onLine: true },
    history: { pushState() {}, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame: () => 1,
    document: fakeDoc,
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    MutationObserver: class { observe() {} disconnect() {} },
    __AG_BOOT_PAYLOAD__: {
      version: '1.3.5-test',
      platform: 'darwin',
      enabled: true,
      cssText: '',
      customCss: '',
      themeVars: {},
      i18nDict,
      modules: { theme: false, i18n: true, metrics: false, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      selectors: {},
      userConfig: { modules: { i18n: true } },
      customJs: ''
    }
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`const __AG_BOOT_PAYLOAD__ = globalThis.__AG_BOOT_PAYLOAD__;\n${code}`, sandbox);

  assert.equal(textNodes[0].nodeValue, '防止电脑休眠');
  assert.equal(textNodes[1].nodeValue, '保持在系统菜单栏');
  assert.equal(textNodes[2].nodeValue, '启用智能体系统通知');
  assert.equal(textNodes[3].nodeValue, '启用 AI 点数超额抵扣');
  assert.equal(textNodes[4].nodeValue, '默认打开链接方式');
  assert.equal(textNodes[5].nodeValue, '删除所有远程智能体数据');
  assert.equal(textNodes[6].nodeValue, '本机');
  assert.equal(textNodes[7].nodeValue, '正在思考 3s');
  assert.equal(textNodes[8].nodeValue, '当前套餐：Google AI Ultra');
  assert.equal(textNodes[9].nodeValue, '输入框');
  assert.equal(textNodes[10].nodeValue, '选择在聊天输入框中发送消息的快捷键。');
  assert.equal(textNodes[11].nodeValue, '引用');
  assert.equal(textNodes[12].nodeValue, 'Low');
  assert.equal(textNodes[13].nodeValue, 'Extra High');

  assert.equal(
    attrEls[0].getAttribute('aria-label'),
    '模型，当前：Gemini 4 Neon Extra High（智能体运行期间无法切换模型）'
  );
  assert.equal(
    attrEls[1].getAttribute('aria-label'),
    '权限模式：全自动放行 (Turbo)（智能体运行期间无法更改权限）'
  );
  assert.equal(attrEls[2].getAttribute('placeholder'), '搜索快捷键...');
  assert.equal(attrEls[3].getAttribute('aria-label'), '智能体运行位置，当前：本机');

  // Verify Electron native right-click context menu (ogb/showContextMenu) translation & safe scoping
  const desc = vm.runInContext('Object.getOwnPropertyDescriptor(Array.prototype, "map")', sandbox);
  assert.equal(desc.enumerable, false, 'Array.prototype.map must stay non-enumerable');

  const nativeMenuResult = vm.runInContext(
    `(() => {
      function ogb(items, mapObj, prefix = 'cmi') {
        return items.map((d, idx) => {
          const id = d.id || prefix + '-' + idx;
          if (d.onClick) mapObj.set(id, d.onClick);
          const out = {
            id,
            label: d.label,
            type: d.type && d.type !== 'item' && d.type !== 'label' ? d.type : 'normal',
            checked: d.checked,
            disabled: d.type === 'label' ? true : d.disabled,
            accelerator: d.accelerator
          };
          if (d.items && d.items.length > 0) out.submenu = ogb(d.items, mapObj, id + '-sub');
          return out;
        });
      }
      const handlers = new Map();
      return ogb([
        { id: 'rename', label: 'Rename', onClick: () => {} },
        { id: 'pin', label: 'Pin', accelerator: 'Alt+Shift+P', onClick: () => {} },
        { id: 'mark-read', label: 'Mark Unread', onClick: () => {} },
        { type: 'separator' },
        {
          id: 'copy',
          type: 'submenu',
          label: 'Copy',
          items: [
            { id: 'copy-0', label: 'Conversation Name', onClick: () => {} },
            { id: 'copy-1', label: 'Workspace Name', onClick: () => {} }
          ]
        },
        {
          id: 'split',
          type: 'submenu',
          label: 'Split',
          items: [
            { id: 'split-0', label: 'Split Right', onClick: () => {} },
            { id: 'split-1', label: 'Split Down', onClick: () => {} }
          ]
        },
        {
          id: 'move-to-project',
          type: 'submenu',
          label: 'Move to Project',
          items: [
            { id: 'project-user123', label: 'Code', type: 'checkbox', checked: true, onClick: () => {} },
            { id: 'project-new', label: 'New Project...', onClick: () => {} },
            { id: 'project-remove', label: 'Remove from Project', onClick: () => {} }
          ]
        },
        { type: 'separator' },
        { id: 'archive', label: 'Archive', accelerator: 'Alt+Ctrl+A', onClick: () => {} },
        { id: 'delete', label: 'Delete', onClick: () => {} },
        { id: 'open-def', label: 'Side Panel (Default)', onClick: () => {} }
      ], handlers);
    })()`,
    sandbox
  );

  assert.equal(nativeMenuResult[0].label, '重命名');
  assert.equal(nativeMenuResult[1].label, '置顶');
  assert.equal(nativeMenuResult[1].accelerator, 'Alt+Shift+P');
  assert.equal(nativeMenuResult[2].label, '标为未读');
  assert.equal(nativeMenuResult[4].label, '复制');
  assert.equal(nativeMenuResult[4].submenu[0].label, '对话名称');
  assert.equal(nativeMenuResult[4].submenu[1].label, '工作区名称');
  assert.equal(nativeMenuResult[5].label, '分屏');
  assert.equal(nativeMenuResult[5].submenu[0].label, '向右分屏');
  assert.equal(nativeMenuResult[5].submenu[1].label, '向下分屏');
  assert.equal(nativeMenuResult[6].label, '移至项目');
  assert.equal(nativeMenuResult[6].submenu[0].label, 'Code', 'User project names must never be translated');
  assert.equal(nativeMenuResult[6].submenu[1].label, '新建项目...');
  assert.equal(nativeMenuResult[6].submenu[2].label, '从项目移除');
  assert.equal(nativeMenuResult[8].label, '归档');
  assert.equal(nativeMenuResult[9].label, '删除');
  assert.equal(nativeMenuResult[10].label, '右侧边栏（默认）');
});

test('updater validates semver/paths, verifies SHA-256, backs up core/, and preserves user/', async () => {
  assert.equal(compareSemver('1.2.2', '1.2.1'), 1);
  assert.equal(compareSemver('v1.2.1', '1.2.1'), 0);
  assert.equal(compareSemver('1.2.0', '1.2.1'), -1);
  assert.equal(isSafeManifestRelPath('daemon/updater.mjs'), true);
  assert.equal(isSafeManifestRelPath('../evil.mjs'), false);
  assert.equal(isSafeManifestRelPath('/etc/passwd'), false);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-updater-test-'));
  try {
    const coreDir = path.join(tmpDir, 'core');
    const userDir = path.join(tmpDir, 'user');
    fs.mkdirSync(path.join(coreDir, 'daemon'), { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });

    const oldContent = Buffer.from('// old daemon v1.2.1\n', 'utf8');
    const oldHash = crypto.createHash('sha256').update(oldContent).digest('hex');
    fs.writeFileSync(path.join(coreDir, 'daemon.mjs'), oldContent);
    fs.writeFileSync(
      path.join(coreDir, 'manifest.json'),
      JSON.stringify({ version: '1.2.1', files: { 'daemon.mjs': { sha256: oldHash, bytes: oldContent.length } } })
    );
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'antigravity-codex-theme', version: '1.2.1' }));
    fs.writeFileSync(path.join(userDir, 'config.json'), JSON.stringify({ preset: 'codex-dark', customFlag: 42 }));

    const newContent = Buffer.from('// new daemon v1.2.2\n', 'utf8');
    const newHash = crypto.createHash('sha256').update(newContent).digest('hex');
    const remoteManifest = {
      name: 'antigravity-codex-theme',
      version: '1.2.2',
      files: { 'daemon.mjs': { sha256: newHash, bytes: newContent.length } }
    };

    const chk = await checkForUpdates({
      targetDir: tmpDir,
      fetchJson: async (url) => {
        if (url.includes('manifest.json')) return remoteManifest;
        return { tag_name: 'v1.2.2', html_url: 'https://github.com/nkjDSLcvanv/antigravity-codex-theme/releases/tag/v1.2.2' };
      }
    });
    assert.equal(chk.ok, true);
    assert.equal(chk.status, 'update_available');
    assert.equal(chk.updateAvailable, true);
    assert.equal(chk.latestVersion, '1.2.2');

    // Tampered SHA-256 must abort without touching existing core/
    const badApply = await applyPluginUpdate({
      targetDir: tmpDir,
      ref: 'v1.2.2',
      scheduleRestart: false,
      fetchJson: async () => remoteManifest,
      fetchBuffer: async () => Buffer.from('// tampered bytes\n', 'utf8')
    });
    assert.equal(badApply.ok, false);
    assert.match(badApply.error, /SHA-256 mismatch/);
    assert.equal(fs.readFileSync(path.join(coreDir, 'daemon.mjs'), 'utf8'), '// old daemon v1.2.1\n');

    // Valid SHA-256 updates core/, creates core.prev + backups/, and preserves user/config.json
    const goodApply = await applyPluginUpdate({
      targetDir: tmpDir,
      ref: 'v1.2.2',
      scheduleRestart: false,
      fetchJson: async () => remoteManifest,
      fetchBuffer: async (url) => {
        if (url.endsWith('core/daemon.mjs')) return newContent;
        if (url.endsWith('package.json')) return Buffer.from(JSON.stringify({ name: 'antigravity-codex-theme', version: '1.2.2' }));
        throw new Error('optional doc omitted');
      }
    });
    assert.equal(goodApply.ok, true);
    assert.equal(goodApply.version, '1.2.2');
    assert.equal(fs.readFileSync(path.join(coreDir, 'daemon.mjs'), 'utf8'), '// new daemon v1.2.2\n');
    assert.equal(fs.readFileSync(path.join(tmpDir, 'core.prev', 'daemon.mjs'), 'utf8'), '// old daemon v1.2.1\n');
    assert.equal(JSON.parse(fs.readFileSync(path.join(userDir, 'config.json'), 'utf8')).customFlag, 42);

    // Stale raw.githubusercontent.com CDN cache serving an older manifest version must not offer main_diff downgrade
    const staleCdnChk = await checkForUpdates({
      targetDir: tmpDir,
      fetchJson: async (url) => {
        if (url.includes('manifest.json')) {
          return {
            name: 'antigravity-codex-theme',
            version: '1.2.1',
            files: { 'daemon.mjs': { sha256: oldHash, bytes: oldContent.length } }
          };
        }
        return { tag_name: 'v1.2.2', html_url: 'https://github.com/nkjDSLcvanv/antigravity-codex-theme/releases/tag/v1.2.2' };
      }
    });
    assert.equal(staleCdnChk.ok, true);
    assert.equal(staleCdnChk.status, 'up_to_date');
    assert.equal(staleCdnChk.canSyncMain, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
