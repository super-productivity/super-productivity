#!/usr/bin/env node
// NOTE: the tools are invoked via their JS entry points with process.execPath
// instead of the npm/npx wrappers: on Windows those wrappers are .cmd shims,
// which Node refuses to spawn without a shell (EINVAL/ENOENT since the
// CVE-2024-27980 fix), and going through a shell instead would make the file
// path subject to shell expansion. execFileSync + node keeps argv literal on
// every platform.
const { execFileSync } = require('child_process');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('❌ Please provide a file path');
  process.exit(1);
}

// Get absolute path
const absolutePath = path.resolve(file);

const repoRoot = path.join(__dirname, '..');
// require.resolve('<pkg>/package.json') instead of deep paths: stylelint's
// "exports" map blocks resolving bin files directly.
const binOf = (pkg, rel) =>
  path.join(path.dirname(require.resolve(`${pkg}/package.json`)), rel);
const run = (jsEntry, args) =>
  execFileSync(process.execPath, [jsEntry, ...args], {
    stdio: 'pipe',
    encoding: 'utf8',
    // ng lint needs to find angular.json regardless of the caller's directory
    cwd: repoRoot,
  });

try {
  // Run prettier
  console.log(`🎨 Formatting ${path.basename(file)}...`);
  run(binOf('prettier', 'bin/prettier.cjs'), ['--write', absolutePath]);

  // Run lint based on file type
  console.log(`🔍 Linting ${path.basename(file)}...`);

  if (file.endsWith('.scss')) {
    // Use stylelint for SCSS files
    run(binOf('stylelint', 'bin/stylelint.mjs'), [absolutePath]);
  } else {
    // Use ng lint for TypeScript/JavaScript files
    run(binOf('@angular/cli', 'bin/ng.js'), [
      'lint',
      '--lint-file-patterns',
      absolutePath,
    ]);
  }

  // If we get here, both commands succeeded
  console.log(`✅ ${path.basename(file)} - All checks passed!`);
} catch (error) {
  // If there's an error, show the full output
  console.error('\n❌ Errors found:\n');
  console.error(error.stdout || error.stderr || error.message);
  process.exit(1);
}
