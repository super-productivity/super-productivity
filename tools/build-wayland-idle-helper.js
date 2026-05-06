const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CRATE_DIR = path.join(REPO_ROOT, 'electron', 'wayland-idle-helper');
const TARGET_DIR = path.join(REPO_ROOT, '.tmp', 'rust-target');
const OUTPUT_DIR = path.join(REPO_ROOT, 'electron', 'bin');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'wayland-idle-helper');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const hasCargo = () => {
  const result = spawnSync('cargo', ['--version'], {
    stdio: 'ignore',
  });
  return result.status === 0;
};

const buildHelper = () => {
  if (!hasCargo()) {
    console.warn(
      '[build-wayland-idle-helper] Rust toolchain not found -- skipping Wayland idle helper. Install via https://rustup.rs if you need it.',
    );
    return;
  }

  run('cargo', [
    'build',
    '--release',
    '--locked',
    '--manifest-path',
    path.join(CRATE_DIR, 'Cargo.toml'),
    '--target-dir',
    TARGET_DIR,
  ]);

  const builtBinaryPath = path.join(TARGET_DIR, 'release', 'wayland-idle-helper');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const binaryContents = fs.readFileSync(builtBinaryPath);
  const tempOutputPath = `${OUTPUT_PATH}.tmp`;
  fs.writeFileSync(tempOutputPath, binaryContents);
  fs.chmodSync(tempOutputPath, 0o755);
  fs.renameSync(tempOutputPath, OUTPUT_PATH);
};

if (process.platform === 'linux') {
  buildHelper();
}
