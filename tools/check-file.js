#!/usr/bin/env node
const { execFileSync } = require('child_process');
const path = require('path');

const runPackageManager = (name, args, options) => {
  if (process.platform === 'win32') {
    const cliName = name === 'npx' ? 'npx-cli.js' : 'npm-cli.js';
    const cliPath = path.join(
      path.dirname(process.execPath),
      'node_modules',
      'npm',
      'bin',
      cliName,
    );
    return execFileSync(process.execPath, [cliPath, ...args], options);
  }
  return execFileSync(name, args, options);
};

const file = process.argv[2];
if (!file) {
  console.error('❌ Please provide a file path');
  process.exit(1);
}

// Get absolute path
const absolutePath = path.resolve(file);

try {
  // Run prettier
  console.log(`🎨 Formatting ${path.basename(file)}...`);
  runPackageManager('npm', ['run', 'prettier:file', '--', absolutePath], {
    stdio: 'pipe',
    encoding: 'utf8',
  });

  // Run lint based on file type
  console.log(`🔍 Linting ${path.basename(file)}...`);

  if (file.endsWith('.scss')) {
    // Use stylelint for SCSS files
    runPackageManager('npx', ['stylelint', absolutePath], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } else {
    // Use ng lint for TypeScript/JavaScript files
    runPackageManager('npm', ['run', 'lint:file', '--', absolutePath], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
  }

  // If we get here, both commands succeeded
  console.log(`✅ ${path.basename(file)} - All checks passed!`);
} catch (error) {
  // If there's an error, show the full output
  console.error('\n❌ Errors found:\n');
  console.error(error.stdout || error.stderr || error.message);
  process.exit(1);
}
