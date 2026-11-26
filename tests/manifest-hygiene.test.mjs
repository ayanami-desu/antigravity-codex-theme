/**
 * tests/manifest-hygiene.test.mjs — Core Manifest Integrity, i18n Dictionary & Repo Hygiene Tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyCoreIntegrity } from '../core/installer/manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function walkAllFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.DS_Store') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAllFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

test('core/manifest.json matches every file under core/ with zero drift', () => {
  const res = verifyCoreIntegrity(ROOT_DIR);
  assert.equal(res.ok, true, `Core manifest drift detected: ${JSON.stringify(res.modified)}`);
});

test('core/i18n.json is valid JSON with substantial localization coverage', () => {
  const dictPath = path.join(ROOT_DIR, 'core', 'i18n.json');
  const raw = fs.readFileSync(dictPath, 'utf8');
  const dict = JSON.parse(raw);
  const keys = Object.keys(dict);
  assert.ok(keys.length >= 800, `Expected >= 800 i18n entries, found ${keys.length}`);
  assert.equal(dict.Settings || dict['Settings'] ? typeof dict['Settings'] : 'string', 'string');
  for (const keepEn of ['Minimal', 'Low', 'Medium', 'High', 'Extra', 'Extra High', 'XHigh', 'Max', 'Orchestrator', 'Orchestrator (Carbon)', 'Orchestrator (Argon)']) {
    assert.equal(Object.prototype.hasOwnProperty.call(dict, keepEn), false, `Model/effort label "${keepEn}" should stay untranslated`);
  }
});

test('Assembled runtime JS and CSS parts pass syntax validation and define Codex presets', () => {
  const stylesDir = path.join(ROOT_DIR, 'core', 'styles');
  const runtimeDir = path.join(ROOT_DIR, 'core', 'runtime');
  const css = fs
    .readdirSync(stylesDir)
    .filter((f) => f.endsWith('.css'))
    .sort()
    .map((f) => fs.readFileSync(path.join(stylesDir, f), 'utf8'))
    .join('\n');
  const js = fs
    .readdirSync(runtimeDir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => fs.readFileSync(path.join(runtimeDir, f), 'utf8'))
    .join('\n');

  assert.ok(css.includes('#2B7FFF'));
  assert.ok(css.includes('#181818'));
  assert.ok(css.includes('#363636'));
  assert.ok(css.includes('.ag-dot-slow'));
  assert.ok(
    /\[data-testid="cascade-system-message-toolbar"\]\s*>\s*div:last-child[\s\S]*?justify-content:\s*flex-end/i.test(css),
    'Turn toolbar action buttons must stay right-aligned'
  );
  assert.ok(
    /\.ag-turn-metrics\s*\{[^}]*margin-right:\s*auto/i.test(css),
    'Per-turn metrics badge must push native copy/thumbs/time controls to the right edge'
  );

  // Enforce concentric composer tray & inner card corner geometry (outerRadius = innerRadius + outerPadding + outerBorder)
  for (const styleFile of ['00-base.css', '20-dark-codex.css']) {
    const styleSrc = fs.readFileSync(path.join(stylesDir, styleFile), 'utf8');
    const trayBlock = styleSrc.match(
      /:is\(#antigravity\\\.agentSidePanelInputBox[^)]+\)\s*\{([^}]+)\}/
    );
    const cardBlock = styleSrc.match(
      /\.surface-composer-card\.bg-card[\s\S]*?\{([^}]+)\}/
    );
    assert.ok(trayBlock, `${styleFile} must define composer outer tray block`);
    assert.ok(cardBlock, `${styleFile} must define composer inner card block`);
    const outerRadius = Number(trayBlock[1].match(/border-radius:\s*(\d+)px/)?.[1]);
    const outerPadding = Number(trayBlock[1].match(/padding:\s*(\d+)(?:px)?/)?.[1]);
    const outerBorder = Number(trayBlock[1].match(/border:\s*(\d+)(?:px)?/)?.[1]);
    const innerRadius = Number(cardBlock[1].match(/border-radius:\s*(\d+)px/)?.[1]);
    assert.equal(
      outerRadius,
      innerRadius + outerPadding + outerBorder,
      `${styleFile} composer tray corners must stay concentric (outer=${outerRadius}, inner=${innerRadius}, pad=${outerPadding}, border=${outerBorder})`
    );
  }
  assert.ok(js.includes('codex-pure-white'));
  assert.ok(js.includes('codex-dark'));
  assert.ok(js.includes('cascade-system-message-toolbar'));
  assert.ok(js.includes('#ag-codex-theme') || js.includes("'ag-codex-theme'"));

  execFileSync(process.execPath, ['--input-type=commonjs', '--check'], {
    input: 'const __AG_BOOT_PAYLOAD__ = {};\n' + js,
    stdio: ['pipe', 'pipe', 'pipe']
  });
});

test('Repository contains zero upstream branding, removed warm presets, or Drive/Notion links', () => {
  const forbiddenPatterns = [
    /chuanban/i,
    /anarcadia/i,
    /wax-?seal/i,
    /composerWaxSeal/,
    /vintage-deep/,
    /notion\.site/i,
    /drive\.google\.com/i,
    /zh-title-patch/i,
    /ag-custom-fonts/
  ];

  const allFiles = walkAllFiles(ROOT_DIR);
  const violations = [];
  for (const full of allFiles) {
    const rel = path.relative(ROOT_DIR, full).replace(/\\/g, '/');
    if (rel === 'tests/manifest-hygiene.test.mjs' || rel.startsWith('assets/')) continue;
    const text = fs.readFileSync(full, 'utf8');
    // Allow explicit upstream attribution only inside README.md while keeping code/configs/scripts clean
    const scopedForbidden =
      rel === 'README.md'
        ? forbiddenPatterns.filter((p) => String(p) !== '/chuanban/i' && String(p) !== '/anarcadia/i')
        : forbiddenPatterns;
    for (const pat of scopedForbidden) {
      if (pat.test(text)) {
        violations.push({ file: rel, pattern: String(pat) });
      }
    }
  }
  assert.deepEqual(violations, []);

  const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');
  assert.ok(readme.includes('https://github.com/nkjDSLcvanv/antigravity-codex-theme.git'));
  assert.ok(!readme.includes('<your-username>'));
  assert.ok(!readme.includes('状态灯'));
  assert.ok(!readme.includes('琥珀'));
});
