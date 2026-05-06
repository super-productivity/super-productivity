// Post-pack hook for Linux builds.
//
// Renames the main Electron binary to `superproductivity-bin` and installs
// a shell wrapper at the original name. The wrapper forces
// --ozone-platform=x11 when running in our Snap sandbox on a Wayland
// session; non-Snap launches (AppImage, .deb, .rpm) and X11 sessions hit
// a no-op passthrough, so behavior for those targets is unchanged.
//
// Context: field reports on issue #7270 (v18.2.4/v18.2.5) show that
// app.commandLine.appendSwitch('ozone-platform','x11') from inside the
// main process is not equivalent to passing the flag on argv — Chromium's
// Ozone init in the browser process dlopens libEGL/libgbm on the core22
// Mesa path before the switch is honored, which segfaults under Mesa ABI
// drift. Injecting the flag via argv before Electron starts bypasses this.
//
// See docs/research/snap-wayland-gpu-fix-research.md §18.

const { promises: fs } = require('fs');
const { join } = require('path');

const BIN_NAME = 'superproductivity'; // must match linux.executableName
const RENAMED = 'superproductivity-bin';
const WRAPPER_SRC = join(__dirname, '..', 'build', 'linux', 'snap-wrapper.sh');
const WAYLAND_IDLE_HELPER_SRC = join(
  __dirname,
  '..',
  'electron',
  'bin',
  'wayland-idle-helper',
);
const WAYLAND_IDLE_HELPER_DEST = 'wayland-idle-helper';

async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;

  const { appOutDir } = context;
  const binPath = join(appOutDir, BIN_NAME);
  const renamedPath = join(appOutDir, RENAMED);
  const helperDestPath = join(appOutDir, WAYLAND_IDLE_HELPER_DEST);

  const installWaylandIdleHelper = async () => {
    const helperStat = await fs.stat(WAYLAND_IDLE_HELPER_SRC).catch(() => null);
    if (!helperStat) {
      console.warn(
        `[afterPack] ${WAYLAND_IDLE_HELPER_SRC} not found; skipping Wayland idle helper copy`,
      );
      return;
    }

    await fs.copyFile(WAYLAND_IDLE_HELPER_SRC, helperDestPath);
    await fs.chmod(helperDestPath, 0o755);
  };

  // Read wrapper content BEFORE touching appOutDir. If the source file is
  // missing or unreadable we fail fast with the Electron binary still in
  // place — no broken intermediate state.
  const wrapperContent = await fs.readFile(WRAPPER_SRC, 'utf8');

  const [binStat, renamedStat] = await Promise.all([
    fs.stat(binPath).catch(() => null),
    fs.stat(renamedPath).catch(() => null),
  ]);

  if (!binStat && !renamedStat) {
    console.warn(`[afterPack] ${binPath} not found; skipping wrapper install`);
    return;
  }

  // Idempotency: "already installed" requires both files + a shell shebang at
  // binPath. A shebang-less binPath co-existing with renamedPath means a
  // prior run crashed mid-way; fall through to re-write the wrapper.
  if (binStat && renamedStat) {
    const head = await fs.readFile(binPath, 'utf8').catch(() => '');
    if (head.startsWith('#!')) {
      await installWaylandIdleHelper();
      console.log(`[afterPack] wrapper already installed`);
      return;
    }
    throw new Error(
      `[afterPack] unexpected state at ${appOutDir}: both ${BIN_NAME} and ` +
        `${RENAMED} exist but ${BIN_NAME} is not a shell script. Refusing ` +
        `to overwrite; investigate manually.`,
    );
  }

  // Fresh install path: binStat exists, renamedStat doesn't → rename first.
  // Partial-recovery path: only renamedStat exists → skip rename, just
  // re-write the wrapper on top of the missing slot.
  if (!renamedStat) {
    await fs.rename(binPath, renamedPath);
  }

  try {
    await fs.writeFile(binPath, wrapperContent, { mode: 0o755 });
  } catch (err) {
    // Best-effort rollback so the build doesn't ship a pkg with no launcher.
    if (!renamedStat) {
      await fs.rename(renamedPath, binPath).catch(() => {});
    }
    throw err;
  }

  await fs.chmod(renamedPath, 0o755);
  await installWaylandIdleHelper();

  console.log(
    `[afterPack] Installed argv wrapper: ${BIN_NAME} -> ${RENAMED} + shell wrapper`,
  );
}

module.exports = afterPack;
