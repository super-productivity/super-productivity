const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const {
  buildReverseGraph,
  classifyChanges,
  createResolver,
  findAffectedSpecs,
  parseIncludeGlobs,
} = require('./test-affected.js');

const sources = {
  'src/app/util/a.ts': `export const a = 1;`,
  'src/app/util/b.ts': `import { a } from './a';\nexport const b = a;`,
  'src/app/util/b.spec.ts': `import { b } from './b';`,
  'src/app/feat/c.component.ts': `import { b } from 'src/app/util/b';`,
  'src/app/feat/c.component.spec.ts': `import { C } from './c.component';`,
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
  preProcess: (src) => ts.preProcessFile(src, true, true).importedFiles,
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

test('a changed spec selects itself only', () => {
  assert.deepEqual(findAffectedSpecs(['src/app/other.spec.ts'], rev), [
    'src/app/other.spec.ts',
  ]);
});

test('maps templates and styles to their component', () => {
  const result = classifyChanges(
    ['src/app/feat/c.component.html', 'src/app/feat/c.component.scss', 'docs/x.md'],
    fileSet,
  );
  assert.deepEqual(result, {
    runAll: null,
    entries: ['src/app/feat/c.component.ts', 'src/app/feat/c.component.ts'],
  });
});

test('ignores deleted sources and global styles/themes', () => {
  const result = classifyChanges(
    ['src/app/gone.ts', 'src/styles/x.scss', 'src/assets/themes/x.css'],
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
    'src/app/feat/orphan.html',
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
