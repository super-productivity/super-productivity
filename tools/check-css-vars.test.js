'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join, dirname } = require('node:path');
const { tmpdir } = require('node:os');

const CHECKER = join(__dirname, 'check-css-vars.js');

/**
 * Run the checker against a throwaway tree. `files` maps src-relative paths to
 * contents, so a case reads as the smallest repo that reproduces it.
 */
const runOn = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'css-vars-'));
  try {
    for (const [relative, contents] of Object.entries(files)) {
      const full = join(root, 'src', relative);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    try {
      const stdout = execFileSync(process.execPath, [CHECKER, root], {
        encoding: 'utf8',
        timeout: 30_000,
        // Without an explicit stdio, execFileSync also echoes the child's stderr
        // to ours — so the expected-failure cases spam the report into the
        // terminal on a fully passing run.
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { ok: true, output: stdout };
    } catch (err) {
      return { ok: false, output: `${err.stdout || ''}${err.stderr || ''}` };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const TOKENS = 'styles/_css-variables.scss';
const GLOBAL_TOKENS = 'body {\n  --s: 8px;\n  --c-primary: #3f51b5;\n}\n';

test('passes when every reference resolves', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/a.component.scss': '.a { gap: var(--s); color: var(--c-primary); }',
  });
  assert.equal(ok, true, output);
});

test('fails on a name that is declared nowhere', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/a.component.scss': '.a { gap: var(--s1); }',
  });
  assert.equal(ok, false);
  assert.match(output, /unresolvable CSS custom property/);
  // Not annotated, and the annotation's explanation is not printed either.
  assert.doesNotMatch(output, /component-scoped/);
  assert.match(output, /--s1\n/);
  assert.match(output, /--s1/);
  assert.match(output, /app\/a\.component\.scss:1/);
});

test('a hardcoded fallback does not excuse an undefined name', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/a.component.scss': '.a { color: var(--warn-color, #f44336); }',
  });
  assert.equal(ok, false);
  assert.match(output, /--warn-color/);
});

test('finds references inside inline component styles and templates', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/a.component.ts':
      '@Component({ styles: [`.a:hover { background: var(--hover-color, rgba(0,0,0,.04)); }`] })\nexport class A {}\n',
    'app/a.component.html': `<div [ngStyle]="{ background: 'var(--primary-color, #3f51b5)' }"></div>`,
  });
  assert.equal(ok, false);
  assert.match(output, /--hover-color/);
  assert.match(output, /--primary-color/);
  assert.match(output, /app\/a\.component\.ts:1/);
  assert.match(output, /app\/a\.component\.html:1/);
});

test('accepts a property declared and used within the same inline styles block', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/a.component.ts':
      '@Component({ styles: [`:host { --icon-size: 20px; } .i { width: var(--icon-size); }`] })\nexport class A {}\n',
  });
  assert.equal(ok, true, output);
});

test('flags a global stylesheet reaching for a component-scoped declaration', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/schedule-event.component.scss': ':host { --standard-border-radius: 6px; }',
    'styles/components/formly-rows.scss':
      '.encryption-status-box { border-radius: var(--standard-border-radius); }',
  });
  assert.equal(ok, false);
  assert.match(output, /--standard-border-radius\s+\(component-scoped\)/);
  assert.match(output, /styles\/components\/formly-rows\.scss:1/);
});

test('a component may still use a property another component declares', () => {
  // Cross-component inheritance is legal CSS (parent host -> child), so the
  // permissive rule stays for component files; only global rules are strict.
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/parent.component.scss': ':host { --tree-gap: 4px; }',
    'app/child.component.scss': '.row { gap: var(--tree-gap); }',
  });
  assert.equal(ok, true, output);
});

test('a partial under src/app counts as component scope, not global', () => {
  // `_task-base.scss` & co. are @use'd into a component's own SCSS, so they land
  // inside that host. Their declarations must NOT satisfy a global rule...
  const leaks = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/features/tasks/task/_task-base.scss': ':host { --task-icon-size: 40px; }',
    'styles/components/table.scss': '.cell { width: var(--task-icon-size); }',
  });
  assert.equal(leaks.ok, false, leaks.output);
  assert.match(leaks.output, /--task-icon-size\s+\(component-scoped\)/);

  // ...and must not be held to the strict rule themselves.
  const consumes = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/features/tasks/task/task.component.scss': ':host { --done-toggle-size: 40px; }',
    'app/features/tasks/task/_task-controls.scss':
      '.toggle { width: var(--done-toggle-size); }',
  });
  assert.equal(consumes.ok, true, consumes.output);
});

test('theme css counts as a global declaration source', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'assets/themes/dark.css': ':root { --sidenav-bg: #222; }',
    'styles/components/nav.scss': '.nav { background: var(--sidenav-bg); }',
  });
  assert.equal(ok, true, output);
});

test('accepts real angular-material-css-vars palette names', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/a.component.scss': `.a {
      color: var(--palette-primary-500);
      background: var(--palette-accent-contrast-500);
      border-color: var(--palette-warn-A700);
      outline-color: var(--palette-primary-50);
      box-shadow: 0 0 0 1px rgba(var(--palette-accent-500-rgb), 0.2);
      fill: var(--palette-primary-contrast-900-no-rgb);
    }`,
  });
  assert.equal(ok, true, output);
});

test('rejects invented palette names', () => {
  const invented = [
    '--palette-green-500',
    '--palette-red-700',
    '--palette-primary-main',
    '--palette-accent',
    '--palette-warn',
    '--palette-text-secondary',
    '--palette-primary-250',
  ];
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/a.component.scss': invented.map((n) => `.x { color: var(${n}); }`).join('\n'),
  });
  assert.equal(ok, false, output);
  for (const name of invented) {
    assert.ok(output.includes(name), `${name} not rejected`);
  }
});

test('allows Material runtime token prefixes', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/a.component.scss':
      '.a { color: var(--mat-sys-primary); background: var(--mdc-dialog-container-color); }',
  });
  assert.equal(ok, true, output);
});

test('ignores references inside comments', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/a.component.scss':
      '// was: color: var(--old-token);\n/* also var(--other-old) */\n.a { color: var(--c-primary); }',
    'app/a.component.html': '<!-- var(--commented-out) -->\n<div></div>',
  });
  assert.equal(ok, true, output);
});

test('does not treat // inside an html url as a comment', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/a.component.html':
      '<a href="https://example.com" [style.color]="\'var(--nope)\'"></a>',
  });
  assert.equal(ok, false, output);
  assert.match(output, /--nope/);
});

test('an ordinary .ts string is not a declaration source', () => {
  // Only template literals can hold an inline styles: block. Without that
  // scoping, any string mentioning `--x:` silences a real phantom of that name.
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/help.ts': "export const HELP = 'usage: --hover-color: <css color>';",
    'app/a.component.scss': '.a { background: var(--hover-color); }',
  });
  assert.equal(ok, false, output);
  assert.match(output, /--hover-color/);
});

test('[style.--x] bindings count as declarations', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/tree.component.html': '<div [style.--tree-indent.px]="level * 8"></div>',
    'app/tree.component.scss': '.row { padding-left: var(--tree-indent); }',
  });
  assert.equal(ok, true, output);
});

test('a sass mixin library may rely on its caller declaring a property', () => {
  // src/styles/mixins/** is @use'd into component SCSS, so its body lands in a
  // component host — global by path, component-scoped in reality.
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'styles/mixins/_elev.scss': '@mixin elev { box-shadow: 0 0 0 1px var(--card-edge); }',
    'app/x.component.scss': ':host { --card-edge: #ccc; }',
  });
  assert.equal(ok, true, output);
});

test('a sass variable ending in --name is not a declaration', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/a.component.scss': '$grid--gap: 2px;\n.a { gap: var(--gap); }',
  });
  assert.equal(ok, false, output);
  assert.match(output, /--gap/);
});

test('skips spec files', () => {
  const { ok, output } = runOn({
    [TOKENS]: GLOBAL_TOKENS,
    'app/a.spec.ts': "it('x', () => expect('var(--fixture-only-token)').toBeTruthy());",
  });
  assert.equal(ok, true, output);
});
