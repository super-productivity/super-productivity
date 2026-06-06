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

const isTruthyEnv = (value) => value === '1' || value?.toLowerCase() === 'true';

const isExplicitlySkipped = () =>
  isTruthyEnv(process.env.SP_SKIP_WAYLAND_IDLE_HELPER_BUILD);

const isBuildRequired = () =>
  isTruthyEnv(process.env.CI) ||
  isTruthyEnv(process.env.SP_REQUIRE_WAYLAND_IDLE_HELPER_BUILD);

const removeBuiltHelper = () => {
  fs.rmSync(OUTPUT_PATH, { force: true });
  fs.rmSync(`${OUTPUT_PATH}.tmp`, { force: true });
};

const buildHelper = () => {
  if (isExplicitlySkipped()) {
    removeBuiltHelper();
    console.warn(
      '[build-wayland-idle-helper] Skipping Wayland idle helper because SP_SKIP_WAYLAND_IDLE_HELPER_BUILD is set.',
    );
    return;
  }

  if (!hasCargo()) {
    const message =
      '[build-wayland-idle-helper] Rust/Cargo is required to build the Wayland idle helper.';

    if (isBuildRequired()) {
      console.error(
        `${message} Install rustup/cargo, or set SP_SKIP_WAYLAND_IDLE_HELPER_BUILD=1 for builds that intentionally omit ext-idle-notify support.`,
      );
      process.exit(1);
    }

    console.warn(
      `${message} Skipping for this local build. Set SP_REQUIRE_WAYLAND_IDLE_HELPER_BUILD=1 to enforce helper builds outside CI.`,
    );
    removeBuiltHelper();
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
