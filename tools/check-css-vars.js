#!/usr/bin/env node
/**
 * Guards against "phantom" CSS custom properties: `var(--x)` references in
 * component/global SCSS whose `--x:` is never declared anywhere.
 *
 * Why this matters: an undefined custom property makes the whole declaration
 * invalid at computed-value time, so the property silently falls back to
 * inherit/unset (`gap: var(--s1)` collapses to 0). With a hardcoded fallback
 * (`var(--warn-color, #f44336)`) it renders, but is permanently theme-blind.
 * Both fail silently — no build error, no lint error, no runtime warning.
 *
 * Definitions are collected from `src/**\/*.scss` and `src/assets/themes/*.css`.
 * Names that only exist at runtime (Material tokens, palette injection, style
 * bindings from TS/HTML) can't be found that way and live in ALLOWLIST below.
 *
 * Usage: node tools/check-css-vars.js
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const THEMES_DIR = path.join(SRC_DIR, 'assets', 'themes');

/**
 * Custom properties that are set at runtime rather than declared in CSS.
 * Add here ONLY with a verified source — never to silence a real typo.
 */
const ALLOWLIST = new Set([
  // --- Angular Material runtime theme/system tokens -------------------------
  // Prefix-matched below; listed here for documentation only.

  // --- Set from TypeScript ---------------------------------------------------
  // src/app/core/theme/global-theme.service.ts
  '--safe-area-inset-top',
  '--safe-area-inset-bottom',
  '--safe-area-inset-left',
  '--safe-area-inset-right',
  // src/app/ui/material-icons-loader.service.ts
  '--android-webview-icon-scale',

  // --- Angular host / style bindings ----------------------------------------
  // src/app/features/schedule/schedule-event/schedule-event.component.ts
  '--title-line-clamp',
  '--project-color',
  // src/app/features/boards/board/board.component.ts
  '--cols',
  // src/app/ui/progress-circle/progress-circle.component.ts
  '--progress-circle-color',
  // src/app/ui/tree-dnd/tree.component.html
  '--tree-indent',

  // --- Optional theme-override hooks ----------------------------------------
  // Consumed with a fallback in _css-variables.scss. Sibling hooks
  // (--hover-bg-opacity, --focus-bg-opacity, --pressed-bg-opacity,
  // --disabled-opacity) are declared by themes; this one is not, on purpose.
  '--selected-bg-opacity',
]);

/**
 * Prefixes owned by Angular Material / MDC. Those tokens are emitted by the
 * Material theme at runtime and cannot be enumerated statically.
 */
const ALLOWED_PREFIXES = ['--mat-', '--mdc-'];

/**
 * Palette tokens injected at runtime by angular-material-css-vars. Unlike
 * `--mat-*`/`--mdc-*` this set IS statically enumerable (see the library's
 * src/lib/_variables.scss): hue × step × optional `contrast-` × optional
 * `-rgb`. Enumerating it (instead of allowing the whole `--palette-` prefix)
 * lets the check catch invented names like `--palette-green-500` or
 * `--palette-primary-main` — the second-largest phantom class fixed when this
 * tool was introduced.
 */
const PALETTE_TOKENS = (() => {
  const hues = ['primary', 'accent', 'warn'];
  const steps = [
    '50',
    '100',
    '200',
    '300',
    '400',
    '500',
    '600',
    '700',
    '800',
    '900',
    'A100',
    'A200',
    'A400',
    'A700',
  ];
  const names = new Set();
  for (const hue of hues) {
    for (const step of steps) {
      for (const contrast of ['', 'contrast-']) {
        for (const suffix of ['', '-rgb']) {
          names.add(`--palette-${hue}-${contrast}${step}${suffix}`);
        }
      }
    }
  }
  return names;
})();

const walk = (dir, ext, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, ext, out);
    } else if (entry.name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
};

/** Blank out comments so commented-out code is not treated as usage. */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

const scssFiles = walk(SRC_DIR, '.scss');
const themeFiles = fs.existsSync(THEMES_DIR) ? walk(THEMES_DIR, '.css') : [];

const defined = new Set();
for (const file of [...scssFiles, ...themeFiles]) {
  const text = stripComments(fs.readFileSync(file, 'utf8'));
  for (const match of text.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) {
    defined.add(match[1]);
  }
}

const isKnown = (name) =>
  defined.has(name) ||
  ALLOWLIST.has(name) ||
  PALETTE_TOKENS.has(name) ||
  ALLOWED_PREFIXES.some((prefix) => name.startsWith(prefix));

const offenders = [];
for (const file of scssFiles) {
  const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, idx) => {
    for (const match of line.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      if (!isKnown(match[1])) {
        offenders.push({
          location: `${path.relative(REPO_ROOT, file)}:${idx + 1}`,
          name: match[1],
        });
      }
    }
  });
}

if (offenders.length) {
  console.error(
    `\n❌ ${offenders.length} reference(s) to undefined CSS custom properties:\n`,
  );
  const byName = new Map();
  for (const { location, name } of offenders) {
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(location);
  }
  for (const [name, locations] of [...byName].sort()) {
    console.error(`  ${name}`);
    for (const location of locations) {
      console.error(`    ${location}`);
    }
  }
  console.error(
    '\nAn undefined custom property invalidates the whole declaration at' +
      '\ncomputed-value time — the property silently falls back to inherit/unset.' +
      '\nMap it to a real token from src/styles/_css-variables.scss, or — if it is' +
      '\nset at runtime — add it to ALLOWLIST in tools/check-css-vars.js with a' +
      '\ncomment naming the file that sets it.\n',
  );
  process.exit(1);
}

console.log(`✅ No undefined CSS custom properties (${scssFiles.length} SCSS files)`);
