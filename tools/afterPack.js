// Post-pack checks and platform-specific packaging adjustments.
//
// macOS: verifies the actual icon copied into every packaged .app.
//
// Linux: renames the main Electron binary to `superproductivity-bin` and installs
// a shell wrapper at the original name. The wrapper's only job is forcing
// --ozone-platform=x11 when running in our Snap sandbox on a Wayland session;
// non-Snap launches (AppImage, .deb, .rpm) and X11 sessions pass straight
// through.
//
// The rename used to leak into the window identity: through Electron 41 a
// native-Wayland session took its `app_id` from this binary's basename, which is
// what #9450 reported. Electron 42+ derives both the Wayland `app_id` and the X11
// WM_CLASS from the XDG app id instead, which electron/start-app.ts pins
// explicitly, so the rename is now invisible to the shell. See
// tools/verify-linux-wm-class.test.js.
//
// Context: field reports on issue #7270 (v18.2.4/v18.2.5) show that
// app.commandLine.appendSwitch('ozone-platform','x11') from inside the
// main process is not equivalent to passing the flag on argv — Chromium's
// Ozone init in the browser process dlopens libEGL/libgbm on the core22
// Mesa path before the switch is honored, which segfaults under Mesa ABI
// drift. Injecting the flag via argv before Electron starts bypasses this.
//
// See docs/research/snap-wayland-gpu-fix-research.md.

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
const MAC_ICON_SOURCE = join(__dirname, '..', 'build', 'icon.icns');

const isTruthyEnv = (value) => value === '1' || value?.toLowerCase() === 'true';

const verifyPackagedMacIcon = async (context) => {
  const appName = context.packager.appInfo.productFilename;
  const iconPath = join(
    context.appOutDir,
    `${appName}.app`,
    'Contents',
    'Resources',
    'icon.icns',
  );
  const [sourceIcon, packagedIcon] = await Promise.all([
    fs.readFile(MAC_ICON_SOURCE),
    fs.readFile(iconPath),
  ]);
  if (!sourceIcon.equals(packagedIcon)) {
    throw new Error(
      `[afterPack] Packaged macOS icon ${iconPath} does not match ${MAC_ICON_SOURCE}`,
    );
  }

  console.log(`[afterPack] Verified packaged macOS icon matches its source`);
};

async function afterPack(context) {
  if (
    context.electronPlatformName === 'darwin' ||
    context.electronPlatformName === 'mas'
  ) {
    await verifyPackagedMacIcon(context);
    return;
  }
  if (context.electronPlatformName !== 'linux') return;

  const { appOutDir } = context;
  const binPath = join(appOutDir, BIN_NAME);
  const renamedPath = join(appOutDir, RENAMED);
  const helperDestPath = join(appOutDir, WAYLAND_IDLE_HELPER_DEST);

  const installWaylandIdleHelper = async () => {
    if (isTruthyEnv(process.env.SP_SKIP_WAYLAND_IDLE_HELPER_BUILD)) {
      console.warn(
        '[afterPack] Skipping Wayland idle helper copy because SP_SKIP_WAYLAND_IDLE_HELPER_BUILD is set',
      );
      return;
    }

    const helperStat = await fs.stat(WAYLAND_IDLE_HELPER_SRC).catch(() => null);
    if (!helperStat) {
      throw new Error(
        `[afterPack] ${WAYLAND_IDLE_HELPER_SRC} not found. Linux packages must include the Wayland idle helper; install Rust/Cargo before packaging or set SP_SKIP_WAYLAND_IDLE_HELPER_BUILD=1 to intentionally omit ext-idle-notify support.`,
      );
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
// Exposed for tools/verify-linux-wm-class.test.js. electron-builder resolves the
// hook via the default function export, so extra properties on it are inert.
module.exports.BIN_NAME = BIN_NAME;
module.exports.RENAMED = RENAMED;
