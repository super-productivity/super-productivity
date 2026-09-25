#!/usr/bin/env node
/**
 * Guards against "phantom" CSS custom properties: `var(--x)` references whose
 * `--x:` is never declared anywhere it can reach.
 *
 * Why this matters: an undefined custom property makes the whole declaration
 * invalid at computed-value time, so the property silently falls back to
 * inherit/unset (`gap: var(--s1)` collapses to 0). With a hardcoded fallback
 * (`var(--warn-color, #f44336)`) it renders, but is permanently theme-blind.
 * Both fail silently — no build error, no lint error, no runtime warning.
 *
 * A reference is unresolvable either because the name is declared nowhere, or
 * because it is declared only under `src/app/**` while the reference sits in a
 * global stylesheet — custom properties inherit only downwards, so a global rule
 * cannot see a property scoped to some component's `:host`. The latter is how
 * `--standard-border-radius` (declared only in schedule-event, consumed by the
 * global formly-rows.scss) stayed broken, and is flagged `(component-scoped)`.
 * That second check is a heuristic: a global rule CAN match inside a component
 * subtree and resolve that component's properties. ALLOWLIST is the escape
 * hatch if that ever happens legitimately.
 *
 * Sources scanned, for both declarations and references:
 *   src/**\/*.scss, src/assets/themes/*.css, src/**\/*.ts, src/**\/*.html
 * `.ts`/`.html` are in because Angular components carry inline `styles:` blocks
 * and `[ngStyle]`/`[style.--x]` bindings, which are just as invisible to
 * stylelint as SCSS is — and were where the last four phantoms hid.
 *
 * Names that only exist at runtime and are not written as `[style.--x]`
 * (Material tokens, palette injection, `setProperty` from TS) cannot be found
 * that way, and live in ALLOWLIST / ALLOWED_PREFIXES / PALETTE_TOKEN below.
 *
 * Usage: node tools/check-css-vars.js [rootDir]
 * `rootDir` defaults to the repo root; the tests pass fixture trees instead.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const SRC_DIR = path.join(REPO_ROOT, 'src');
const THEMES_DIR = path.join(SRC_DIR, 'assets', 'themes');
const STYLES_DIR = path.join(SRC_DIR, 'styles');
const ROOT_STYLESHEET = path.join(SRC_DIR, 'styles.scss');
// Carries a real document-level <style> block.
const INDEX_HTML = path.join(SRC_DIR, 'index.html');

const toPosix = (p) => p.split(path.sep).join('/');

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

  // Angular `[style.--x]` host/style bindings are picked up by STYLE_BINDING
  // below, so they need no entry here.

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
 * Palette tokens injected at runtime by angular-material-css-vars: hue × step ×
 * optional `contrast-` × optional `-rgb`/`-no-rgb` (see the library's
 * src/lib/_variables.scss). Matching the real shape rather than allowing the
 * whole `--palette-` prefix is what catches invented names like
 * `--palette-green-500` or `--palette-primary-main` — the second-largest
 * phantom class fixed when this tool was introduced.
 */
const PALETTE_TOKEN =
  /^--palette-(primary|accent|warn)-(contrast-)?(50|[1-9]00|A[1247]00)(-rgb|-no-rgb)?$/;

/**
 * `--x:` preceded by start-of-line or a non-identifier character. The leading
 * guard matters: without it a Sass variable like `$grid--gap: 2px` registers a
 * declaration of `--gap`, which would then silently satisfy a real phantom
 * `var(--gap)` elsewhere. It also keeps the scan linear on long identifier runs.
 */
const DECLARATION = /(?:^|[^A-Za-z0-9_-])(--[A-Za-z0-9_-]+)\s*:/g;
const REFERENCE = /var\(\s*(--[A-Za-z0-9_-]+)/g;

/**
 * Angular style binding, e.g. `[style.--tree-indent.px]`. It sets the property
 * at runtime, so the `--x:` form never appears — matching it here is what keeps
 * those names out of a hand-maintained allowlist. The character class stops
 * before the `.px` unit suffix on its own.
 */
const STYLE_BINDING = /\[style\.(--[A-Za-z0-9_-]+)/g;

/**
 * In `.ts`, only template literals can hold CSS (an inline `styles:` block).
 * Harvesting declarations from the whole file would let any ordinary string
 * containing `--x:` — a help text, a log separator — register as a declaration
 * and silence a real phantom of that name everywhere.
 */
const TEMPLATE_LITERAL = /`(?:[^`\\]|\\.)*`/g;

/**
 * `isDirectory()`/`isFile()` are false for symlinks, so links are skipped rather
 * than followed. That is deliberate: it bounds the walk to the real tree (no
 * escape through a link out of src/, no cycle) and keeps a dangling link from
 * crashing the read below.
 */
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
};

/**
 * Blank out comments so commented-out code is not treated as a declaration or a
 * reference. Replaces with spaces rather than deleting so line numbers survive.
 *
 * Block and line forms must be ONE alternation, not two passes: leftmost-match
 * then makes `//* {` (tree.component.scss) match as a line comment. Stripping
 * `/* … *␘/` first instead lets that `/*` open a phantom block that swallows
 * every line up to the next real `*␘/` — ~50 lines of live CSS there, silently
 * exempting them from the check.
 *
 * HTML gets its own stripper: `//` is not a comment there, and blanking it
 * would eat everything after a `https://` on the same line.
 */
const blank = (m) => m.replace(/[^\n]/g, ' ');
const stripComments = (text, isHtml) =>
  isHtml
    ? text.replace(/<!--[\s\S]*?-->/g, blank)
    : text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, blank);

const isHtmlFile = (file) => file.endsWith('.html');

/**
 * Sass libraries that emit nothing on their own. They are `@use`d into ~86
 * component stylesheets, so their mixin bodies land inside a component's host —
 * component scope, despite living under `src/styles/`. A mixin whose contract is
 * "the caller declares --x" is legal, and must not be reported.
 */
const SASS_LIBRARY_DIRS = ['mixins', 'extends', 'functions', 'utilities'].map(
  (dir) => path.join(STYLES_DIR, dir) + path.sep,
);

/**
 * Whether a file's rules apply at document level, where only globally declared
 * properties can be reached. Everything under `src/app/**` is component-scoped,
 * including the loose partials there — they are `@use`d into a component's own
 * SCSS and land inside its host (`_task-base.scss`,
 * `task-context-menu-touch-fix.scss`).
 */
const isGlobalStyleFile = (file) =>
  !SASS_LIBRARY_DIRS.some((dir) => file.startsWith(dir)) &&
  (file === ROOT_STYLESHEET ||
    file === INDEX_HTML ||
    file.startsWith(STYLES_DIR + path.sep) ||
    file.startsWith(THEMES_DIR + path.sep));

if (!fs.existsSync(SRC_DIR)) {
  console.error(`No src/ directory under ${REPO_ROOT}`);
  process.exit(2);
}

const allFiles = walk(SRC_DIR);
const sourceFiles = allFiles.filter(
  (f) =>
    f.endsWith('.scss') ||
    f.endsWith('.html') ||
    (f.endsWith('.ts') && !f.endsWith('.spec.ts')) ||
    (f.endsWith('.css') && f.startsWith(THEMES_DIR + path.sep)),
);

const read = (file) => stripComments(fs.readFileSync(file, 'utf8'), isHtmlFile(file));

/** Where in a file's text a CSS declaration may legitimately appear. */
const declarationScopes = (file, text) =>
  file.endsWith('.ts') ? text.match(TEMPLATE_LITERAL) || [] : [text];

const globalDefs = new Set();
const anyDefs = new Set();
for (const file of sourceFiles) {
  const text = read(file);
  const add = (name) => {
    anyDefs.add(name);
    if (isGlobalStyleFile(file)) globalDefs.add(name);
  };
  for (const scope of declarationScopes(file, text)) {
    for (const match of scope.matchAll(DECLARATION)) add(match[1]);
  }
  // Runtime style bindings are component-scoped wherever they appear.
  for (const match of text.matchAll(STYLE_BINDING)) anyDefs.add(match[1]);
}

const isRuntimeName = (name) =>
  ALLOWLIST.has(name) ||
  PALETTE_TOKEN.test(name) ||
  ALLOWED_PREFIXES.some((prefix) => name.startsWith(prefix));

const offenders = [];
let anyComponentScoped = false;
for (const file of sourceFiles) {
  const visible = isGlobalStyleFile(file) ? globalDefs : anyDefs;
  read(file)
    .split('\n')
    .forEach((line, idx) => {
      for (const match of line.matchAll(REFERENCE)) {
        const name = match[1];
        if (visible.has(name) || isRuntimeName(name)) continue;
        // Declared somewhere, just not anywhere this rule can see it.
        const componentScoped = anyDefs.has(name);
        anyComponentScoped ||= componentScoped;
        offenders.push({
          // Reported paths stay posix-style so the output (and the specs that
          // match it) reads the same on Windows as it does on macOS and Linux.
          location: `${toPosix(path.relative(REPO_ROOT, file))}:${idx + 1}`,
          name: componentScoped ? `${name}   (component-scoped)` : name,
        });
      }
    });
}

if (offenders.length) {
  console.error(
    `\n❌ ${offenders.length} unresolvable CSS custom property reference(s):\n`,
  );
  const byName = new Map();
  for (const { location, name } of offenders) {
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(location);
  }
  for (const [name, locations] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    console.error(`  ${name}`);
    for (const location of locations) {
      console.error(`    ${location}`);
    }
  }
  console.error(
    '\nAn unresolvable custom property invalidates the whole declaration at' +
      '\ncomputed-value time — the property silently falls back to inherit/unset.' +
      '\nMap it to a real token from src/styles/_css-variables.scss, or — if it is' +
      '\nset at runtime — add it to ALLOWLIST in tools/check-css-vars.js with a' +
      '\ncomment naming the file that sets it, never to silence a real typo.' +
      (anyComponentScoped
        ? '\n' +
          '\n(component-scoped) means the name IS declared, but only under src/app/**,' +
          '\nwhile the reference is in a global stylesheet — custom properties inherit' +
          '\nonly downwards. Promote the declaration to src/styles/, or, if that global' +
          '\nrule only ever matches inside the component that declares it, allowlist it.'
        : '') +
      '\n',
  );
  process.exit(1);
}

console.log(`✅ No unresolvable CSS custom properties (${sourceFiles.length} files)`);
