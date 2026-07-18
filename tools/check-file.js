#!/usr/bin/env node
// NOTE: execSync with a quoted command string instead of execFileSync('npm', ...):
// on Windows npm/npx are .cmd shims, which Node refuses to spawn without a shell
// (EINVAL/ENOENT since the CVE-2024-27980 fix), so execFileSync breaks there.
const { execSync } = require('child_process');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('❌ Please provide a file path');
  process.exit(1);
}

// Get absolute path
const absolutePath = path.resolve(file);

const run = (command) =>
  execSync(command, {
    stdio: 'pipe',
    encoding: 'utf8',
  });

try {
  // Run prettier
  console.log(`🎨 Formatting ${path.basename(file)}...`);
  run(`npm run prettier:file -- "${absolutePath}"`);

  // Run lint based on file type
  console.log(`🔍 Linting ${path.basename(file)}...`);

  if (file.endsWith('.scss')) {
    // Use stylelint for SCSS files
    run(`npx stylelint "${absolutePath}"`);
  } else {
    // Use ng lint for TypeScript/JavaScript files
    run(`npm run lint:file -- "${absolutePath}"`);
  }

  // If we get here, both commands succeeded
  console.log(`✅ ${path.basename(file)} - All checks passed!`);
} catch (error) {
  // If there's an error, show the full output
  console.error('\n❌ Errors found:\n');
  console.error(error.stdout || error.stderr || error.message);
  process.exit(1);
}
