const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildReverseGraph,
  classifyChanges,
  createResolver,
  findAffectedSpecs,
  findGlobalEntry,
  isSetupImport,
  listImports,
  parseArgs,
  parseIncludeGlobs,
} = require('./test-affected.js');

const sources = {
  'src/test.ts': `import { reset } from './app/util/setup';`,
  'src/app/util/setup.ts': `export const reset = () => {};`,
  'src/polyfills.ts': `import './app/util/patch';`,
  'src/app/util/patch.ts': `export {};`,
  'src/app/util/a.ts': `export const a = 1;`,
  'src/app/util/b.ts': `import { a } from './a';\nexport const b = a;`,
  'src/app/util/b.spec.ts': `import { b } from './b';`,
  'src/app/util/api.d.ts': `export interface Api {}`,
  'src/app/util/ambient.d.ts': `declare const x: number;`,
  'src/app/feat/c.component.ts': `import { b } from 'src/app/util/b';
import type { Api } from '../util/api';
@Component({ templateUrl: './c.component.html', styleUrls: ['../shared/s.scss'] })`,
  'src/app/feat/c.component.html': '',
  'src/app/feat/c.component.spec.ts': `import { C } from './c.component';`,
  'src/app/shared/s.scss': '',
  'src/app/feat/lazy.spec.ts': `const m = () => import('@sp/sync-core');`,
  'src/app/other.spec.ts': `export {};`,
  'packages/sync-core/src/index.ts': `export * from './x';`,
  'packages/sync-core/src/x.ts': `export const x = 1;`,
};
const fileSet = new Set(Object.keys(sources));
const rev = buildReverseGraph({
  files: [...fileSet],
  readFile: (f) => sources[f],
  resolve: createResolver(fileSet, {
    '@sp/sync-core': ['packages/sync-core/src/index.ts'],
  }),
  preProcess: listImports,
});

test('selects specs importing a changed file transitively', () => {
  assert.deepEqual(findAffectedSpecs(['src/app/util/a.ts'], rev), [
    'src/app/feat/c.component.spec.ts',
    'src/app/util/b.spec.ts',
  ]);
});

test('follows path aliases and dynamic imports into packages', () => {
  assert.deepEqual(findAffectedSpecs(['packages/sync-core/src/x.ts'], rev), [
    'src/app/feat/lazy.spec.ts',
  ]);
});

test('follows imported .d.ts files', () => {
  assert.deepEqual(findAffectedSpecs(['src/app/util/api.d.ts'], rev), [
    'src/app/feat/c.component.spec.ts',
  ]);
});

test('follows templateUrl and styleUrls, also to non-sibling files', () => {
  for (const file of ['src/app/feat/c.component.html', 'src/app/shared/s.scss']) {
    assert.deepEqual(findAffectedSpecs([file], rev), [
      'src/app/feat/c.component.spec.ts',
    ]);
  }
});

test('a changed spec selects itself only', () => {
  assert.deepEqual(findAffectedSpecs(['src/app/other.spec.ts'], rev), [
    'src/app/other.spec.ts',
  ]);
});

test('global setup modules and ambient .d.ts files force a full run', () => {
  assert.equal(findGlobalEntry(['src/app/util/setup.ts'], rev), 'src/app/util/setup.ts');
  assert.equal(findGlobalEntry(['src/app/util/patch.ts'], rev), 'src/app/util/patch.ts');
  assert.equal(
    findGlobalEntry(['src/app/util/ambient.d.ts'], rev),
    'src/app/util/ambient.d.ts',
  );
  assert.equal(
    findGlobalEntry(['src/app/util/a.ts', 'src/app/util/api.d.ts'], rev),
    null,
  );
});

test('selects specs still importing a deleted file', () => {
  const files = { 'src/app/d.spec.ts': `import { gone } from './gone';` };
  const deleted = ['src/app/gone.ts'];
  const staleRev = buildReverseGraph({
    files: Object.keys(files),
    readFile: (f) => files[f],
    resolve: createResolver(new Set([...Object.keys(files), ...deleted]), {}),
    preProcess: listImports,
  });
  assert.deepEqual(findAffectedSpecs(deleted, staleRev), ['src/app/d.spec.ts']);
  assert.equal(isSetupImport('src/app/gone.ts', staleRev), false);
});

test('ignores deleted sources, docs and theme css', () => {
  const result = classifyChanges(
    ['src/app/gone.ts', 'src/app/gone.html', 'docs/x.md', 'src/assets/themes/x.css'],
    fileSet,
  );
  assert.deepEqual(result, { runAll: null, entries: [] });
});

test('falls back to a full run for test setup and runtime assets', () => {
  for (const file of [
    'src/test.ts',
    'src/karma.conf.js',
    'angular.json',
    'package.json',
    'tsconfig.base.json',
    'src/tsconfig.spec.json',
    'src/assets/icons/x.svg',
  ]) {
    assert.equal(classifyChanges([file], fileSet).runAll, file);
  }
});

test('reads the LA include globs from the npm script', () => {
  assert.deepEqual(
    parseIncludeGlobs(
      "ng test --include='**/*.tz.spec.ts' --include='src/a/**/*.spec.ts'",
    ),
    ['**/*.tz.spec.ts', 'src/a/**/*.spec.ts'],
  );
});

test('non-TS resources nothing imports force a full run, translations do not', () => {
  for (const file of ['src/styles.scss', 'src/assets/config.json', 'src/index.html']) {
    assert.equal(findGlobalEntry([file], rev), file);
  }
  assert.equal(
    findGlobalEntry(['src/assets/i18n/de.json', 'src/app/feat/c.component.html'], rev),
    null,
  );
});

test('parses --base in both forms and rejects unknown arguments', () => {
  assert.deepEqual(parseArgs(['--base', 'dev', '--list']), { base: 'dev', list: true });
  assert.deepEqual(parseArgs(['--base=dev']), { base: 'dev', list: false });
  for (const argv of [['--base'], ['--base='], ['--base', '--list'], ['--lst']]) {
    assert.throws(() => parseArgs(argv));
  }
});
