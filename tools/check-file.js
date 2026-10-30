#!/usr/bin/env node
// NOTE: the tools are invoked via their JS entry points with process.execPath
// instead of the npm/npx wrappers: on Windows those wrappers are .cmd shims,
// which Node refuses to spawn without a shell (EINVAL/ENOENT since the
// CVE-2024-27980 fix), and going through a shell instead would make the file
// path subject to shell expansion. execFileSync + node keeps argv literal on
// every platform.
const { execFileSync } = require('child_process');
const path = require('path');
const { ESLint } = require('eslint');

// Dedupe by resolved path so `./a.ts a.ts` is checked once.
const files = [
  ...new Map(process.argv.slice(2).map((f) => [path.resolve(f), f])).values(),
];
if (!files.length) {
  console.error('❌ Please provide at least one file path');
  process.exit(1);
}

const repoRoot = path.join(__dirname, '..');
// require.resolve('<pkg>/package.json') instead of deep paths: stylelint's
// "exports" map blocks resolving bin files directly.
const binOf = (pkg, rel) =>
  path.join(path.dirname(require.resolve(`${pkg}/package.json`)), rel);
const run = (jsEntry, args) =>
  execFileSync(process.execPath, [jsEntry, ...args], {
    stdio: 'pipe',
    encoding: 'utf8',
    cwd: repoRoot,
  });

const assertLintedByRootEslint = async (eslint, absolutePath, file) => {
  if (!(await eslint.isPathIgnored(absolutePath))) return;
  const guidance = path.relative(repoRoot, absolutePath).startsWith(`packages${path.sep}`)
    ? 'Use the package-specific validation documented in packages/README.md.'
    : "Use the file's owning linter or generator; checkFile did not validate it.";
  throw new Error(
    `${file} is not linted by root ESLint (ignored or unconfigured). ${guidance}`,
  );
};

// ESLint runs in-process rather than through `ng lint`: same flat config,
// but it skips ~2s of Angular CLI startup per call, and all files share one run.
const lintTs = async (eslint, absolutePaths) => {
  const results = await eslint.lintFiles(absolutePaths);
  if (!results.some((r) => r.errorCount > 0)) return;
  const formatter = await eslint.loadFormatter('stylish');
  throw Object.assign(new Error('ESLint errors'), {
    stdout: await formatter.format(results),
  });
};

const main = async () => {
  const absolutePaths = files.map((file) => path.resolve(file));
  const scss = absolutePaths.filter((p) => p.endsWith('.scss'));
  const other = absolutePaths.filter((p) => !p.endsWith('.scss'));
  const label = files.map((file) => path.basename(file)).join(', ');
  try {
    const eslint = new ESLint({ cwd: repoRoot });
    for (const [i, absolutePath] of absolutePaths.entries()) {
      if (!absolutePath.endsWith('.scss')) {
        await assertLintedByRootEslint(eslint, absolutePath, files[i]);
      }
    }

    console.log(`🎨 Formatting ${label}...`);
    run(binOf('prettier', 'bin/prettier.cjs'), ['--write', ...absolutePaths]);

    console.log(`🔍 Linting ${label}...`);
    if (scss.length) {
      run(binOf('stylelint', 'bin/stylelint.mjs'), scss);
    }
    if (other.length) {
      await lintTs(eslint, other);
    }

    console.log(`✅ ${label} - All checks passed!`);
  } catch (error) {
    console.error('\n❌ Errors found:\n');
    // prettier logs good files to stdout and the failing one to stderr; show both
    console.error(
      [error.stdout, error.stderr].filter(Boolean).join('\n') || error.message,
    );
    process.exit(1);
  }
};

main();
