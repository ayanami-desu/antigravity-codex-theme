/**
 * tests/fonts-config.test.mjs — Custom Fonts Sanitization & Runtime Injection Tests (Issue #9)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  normalizeFontsConfig,
  readSfntFontMeta,
  sanitizeConfigPatch,
  scanUserInstalledFonts
} from '../core/daemon/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT_DIR, 'core', 'runtime');

function bootHeadWithFonts(fonts, enabled = true) {
  const code = ['00-head.js', '90-tail.js']
    .map((f) => fs.readFileSync(path.join(RUNTIME_DIR, f), 'utf8'))
    .join('\n');

  const headChildren = [];
  const head = {
    appendChild(el) {
      el.parentNode = head;
      const idx = headChildren.indexOf(el);
      if (idx !== -1) headChildren.splice(idx, 1);
      headChildren.push(el);
      return el;
    },
    insertBefore(el, ref) {
      el.parentNode = head;
      const oldIdx = headChildren.indexOf(el);
      if (oldIdx !== -1) headChildren.splice(oldIdx, 1);
      const refIdx = headChildren.indexOf(ref);
      if (refIdx === -1) headChildren.push(el);
      else headChildren.splice(refIdx, 0, el);
      return el;
    }
  };
  const docAttrs = new Map();
  const fakeDoc = {
    head,
    body: {
      classList: { contains: () => false },
      style: { removeProperty() {} },
      querySelectorAll: () => []
    },
    hidden: false,
    documentElement: {
      style: { removeProperty() {} },
      setAttribute: (k, v) => docAttrs.set(k, v),
      getAttribute: (k) => docAttrs.get(k) ?? null,
      removeAttribute: (k) => docAttrs.delete(k)
    },
    getElementById: (id) => headChildren.find((e) => e.id === id) || null,
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        id: '',
        textContent: '',
        style: {},
        parentNode: null,
        setAttribute() {},
        getAttribute: () => null,
        removeAttribute() {},
        remove() {
          const i = headChildren.indexOf(el);
          if (i !== -1) headChildren.splice(i, 1);
          el.parentNode = null;
        }
      };
      return el;
    },
    getElementsByTagName: (t) => (t === 'head' ? [head] : []),
    querySelector: () => null,
    querySelectorAll: () => [],
    createTreeWalker: () => ({ nextNode: () => false }),
    addEventListener() {},
    removeEventListener() {}
  };

  const sandbox = {
    __AG_BOOT_PAYLOAD__: {
      version: '1.3.5-test',
      platform: 'darwin',
      enabled,
      preset: 'codex-pure-white',
      cssText: 'body { color: #000; }',
      customCss: '',
      themeVars: {},
      fonts,
      i18nDict: {},
      modules: { theme: true, i18n: false, metrics: false, quota: false, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      selectors: {},
      userConfig: { fonts },
      customJs: ''
    },
    location: { pathname: '/', href: 'http://127.0.0.1/', search: '' },
    navigator: { platform: 'MacIntel', onLine: true },
    history: { pushState() {}, replaceState() {} },
    document: fakeDoc,
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    MutationObserver: class { observe() {} disconnect() {} },
    addEventListener() {},
    removeEventListener() {},
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame: () => 1
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`const __AG_BOOT_PAYLOAD__ = globalThis.__AG_BOOT_PAYLOAD__;\n${code}`, sandbox);
  return { sandbox, doc: fakeDoc, headChildren };
}

test('normalizeFontsConfig and sanitizeConfigPatch validate modes, preserve untouched slots, and block CSS injection', () => {
  const def = normalizeFontsConfig(null);
  assert.deepEqual(def, { mode: 'global', global: '', ui: '', chat: '', code: '' });

  const baseCfg = { fonts: { mode: 'global', global: 'PingFang SC', ui: '', chat: '', code: '' } };
  const p1 = sanitizeConfigPatch(baseCfg, {
    fonts: {
      mode: 'split',
      ui: 'Inter, PingFang SC',
      chat: 'LXGW WenKai',
      code: 'JetBrains Mono'
    }
  });
  assert.equal(p1.fonts.mode, 'split');
  assert.equal(p1.fonts.global, 'PingFang SC', 'untouched global slot must be preserved');
  assert.equal(p1.fonts.ui, 'Inter, PingFang SC');
  assert.equal(p1.fonts.chat, 'LXGW WenKai');
  assert.equal(p1.fonts.code, 'JetBrains Mono');

  const p2 = sanitizeConfigPatch(p1, {
    fonts: {
      mode: 'invalid-mode',
      ui: 'Arial; body { background: url(https://evil.example/x); }',
      chat: '@import url(evil.css)',
      code: 'Fira Code\n}/* injected */'
    }
  });
  assert.equal(p2.fonts.mode, 'split', 'invalid font mode must be ignored');
  assert.equal(p2.fonts.ui, '', 'url() injection payload must be rejected');
  assert.equal(p2.fonts.chat, '', '@import injection payload must be rejected');
  assert.equal(p2.fonts.code, 'Fira Code', 'CSS delimiters and comment injections must be stripped');
});

test('applyUserFonts mounts #ag-user-fonts in global mode for UI+Chat while leaving Code monospace intact', () => {
  const { doc } = bootHeadWithFonts({ mode: 'global', global: 'LXGW WenKai', ui: '', chat: '', code: 'JetBrains Mono' });
  const style = doc.getElementById('ag-user-fonts');
  assert.ok(style, '#ag-user-fonts should be mounted when global font is set');
  assert.ok(style.textContent.includes('"LXGW WenKai"'), 'Multi-word font name should be safely quoted');
  assert.ok(style.textContent.includes('--font-sans:'), 'Global mode should override --font-sans');
  assert.ok(style.textContent.includes('--ag-chat-font:'), 'Global mode should override --ag-chat-font');
  assert.ok(!style.textContent.includes('--font-mono:'), 'Global mode must not override code monospace font');
  assert.ok(!style.textContent.includes('JetBrains Mono'), 'Split-only code font must stay inactive in global mode');
});

test('applyUserFonts isolates UI, Chat, and Code in split mode and removes #ag-user-fonts when cleared', () => {
  // Split mode with UI-only keeps Chat explicitly isolated on default sans stack
  const env1 = bootHeadWithFonts({ mode: 'split', global: 'Ignored Global', ui: 'HarmonyOS Sans SC', chat: '', code: '' });
  const s1 = env1.doc.getElementById('ag-user-fonts');
  assert.ok(s1);
  assert.ok(s1.textContent.includes('--font-sans: "HarmonyOS Sans SC"'));
  assert.ok(s1.textContent.includes("--ag-chat-font: 'Inter'"), 'UI-only split mode must keep Chat on default sans');
  assert.ok(!s1.textContent.includes('Ignored Global'));

  // Split mode with all 3 zones distinct
  env1.sandbox.__ag_apply_user_fonts({ mode: 'split', ui: 'Inter', chat: 'LXGW WenKai', code: 'Maple Mono NF CN' });
  const s2 = env1.doc.getElementById('ag-user-fonts');
  assert.ok(s2.textContent.includes('--font-sans: Inter,'));
  assert.ok(s2.textContent.includes('--ag-chat-font: "LXGW WenKai"'));
  assert.ok(s2.textContent.includes('--font-mono: "Maple Mono NF CN"'));
  assert.ok(s2.textContent.includes('--editor-font-family: "Maple Mono NF CN"'));
  assert.ok(s2.textContent.includes('--vscode-editor-font-family: "Maple Mono NF CN"'));
  assert.ok(s2.textContent.includes('.code-line'), 'Code font must also apply to Code Review diff lines');
  assert.ok(s2.textContent.includes('.code-block'), 'Code font must apply to native .code-block elements');
  assert.ok(s2.textContent.includes('code-gutter-diff'), 'Code font must apply to Code Review line number gutter');
  assert.ok(s2.textContent.includes('.context-scope-mention button'), 'Inline file links inside chat replies must follow Chat font');
  assert.ok(s2.textContent.includes('[role="dialog"] :is(input, textarea)'), 'Dialog inputs/textareas must follow UI font');

  const baseCss = fs.readFileSync(path.join(ROOT_DIR, 'core', 'styles', '00-base.css'), 'utf8');
  assert.ok(!/,\s*\[data-side\]\s*\{/.test(baseCss), '00-base.css must not apply sans font to bare [data-side] (which matches Code Review .code-line[data-side="modified"])');

  // Clearing all fields removes #ag-user-fonts cleanly
  env1.sandbox.__ag_apply_user_fonts({ mode: 'split', ui: '', chat: '', code: '' });
  assert.equal(env1.doc.getElementById('ag-user-fonts'), null, 'Clearing all fonts must remove #ag-user-fonts');
});

test('Disabling plugin removes #ag-user-fonts cleanly', () => {
  const { doc } = bootHeadWithFonts({ mode: 'global', global: 'LXGW WenKai' }, false);
  assert.equal(doc.getElementById('ag-user-fonts'), null);
});

function buildMinimalSfnt(familyName, isMono = false) {
  const strBuf = Buffer.alloc(familyName.length * 2);
  for (let i = 0; i < familyName.length; i++) {
    strBuf.writeUInt16BE(familyName.charCodeAt(i), i * 2);
  }
  const nameTable = Buffer.alloc(6 + 12 + strBuf.length);
  nameTable.writeUInt16BE(0, 0);
  nameTable.writeUInt16BE(1, 2);
  nameTable.writeUInt16BE(18, 4);
  nameTable.writeUInt16BE(3, 6);
  nameTable.writeUInt16BE(1, 8);
  nameTable.writeUInt16BE(0x0409, 10);
  nameTable.writeUInt16BE(16, 12);
  nameTable.writeUInt16BE(strBuf.length, 14);
  nameTable.writeUInt16BE(0, 16);
  strBuf.copy(nameTable, 18);

  const postTable = Buffer.alloc(16);
  postTable.writeUInt32BE(isMono ? 1 : 0, 12);

  const headerLen = 12 + 2 * 16;
  const nameOff = headerLen;
  const postOff = nameOff + nameTable.length;
  const out = Buffer.alloc(postOff + postTable.length);
  out.writeUInt32BE(0x00010000, 0);
  out.writeUInt16BE(2, 4);
  out.write('name', 12, 'ascii');
  out.writeUInt32BE(nameOff, 20);
  out.writeUInt32BE(nameTable.length, 24);
  out.write('post', 28, 'ascii');
  out.writeUInt32BE(postOff, 36);
  out.writeUInt32BE(postTable.length, 40);
  nameTable.copy(out, nameOff);
  postTable.copy(out, postOff);
  return out;
}

test('readSfntFontMeta and scanUserInstalledFonts classify sans and mono fonts cleanly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-fonts-test-'));
  try {
    const sansPath = path.join(tmpDir, 'LXGWWenKai.ttf');
    const monoPath = path.join(tmpDir, 'MapleMono.ttf');
    const hiddenPath = path.join(tmpDir, 'Hidden.ttf');
    fs.writeFileSync(sansPath, buildMinimalSfnt('LXGW WenKai', false));
    fs.writeFileSync(monoPath, buildMinimalSfnt('Maple Mono', true));
    fs.writeFileSync(hiddenPath, buildMinimalSfnt('.HiddenSysFont', false));

    assert.deepEqual(readSfntFontMeta(sansPath), [{ family: 'LXGW WenKai', isMono: false }]);
    assert.deepEqual(readSfntFontMeta(monoPath), [{ family: 'Maple Mono', isMono: true }]);
    assert.deepEqual(readSfntFontMeta(hiddenPath), []);

    const scanned = scanUserInstalledFonts({ dirs: [tmpDir], force: true });
    assert.deepEqual(scanned, { sans: ['LXGW WenKai'], mono: ['Maple Mono'] });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
