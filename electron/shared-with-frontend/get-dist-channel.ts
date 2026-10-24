/**
 * Distribution channels detectable from the Electron process.
 * Mobile (android/ios) and plain web are determined in the frontend instead.
 */
export type ElectronDistChannel =
  | 'win-nsis'
  | 'win-portable'
  | 'win-store'
  | 'mac-dmg'
  | 'mac-store'
  | 'linux-appimage'
  | 'linux-snap'
  | 'linux-flatpak'
  | 'linux-native';

// Channels with a working device-local startup mechanism (#5572): Electron's login
// item on macOS and Windows, an XDG autostart entry on Linux. Left out until verified:
// - linux-snap: confinement hides ~/.config/autostart; snapd only starts an entry in
//   $SNAP_USER_DATA/.config/autostart that the snap declares (snap `autoStart`).
// - linux-flatpak: Flathub grants home:ro and a sandbox-private XDG_CONFIG_HOME;
//   it needs the Background portal.
// - win-store: needs a StartupTask manifest extension and a WinRT bridge to toggle it.
// - mac-store: login item registration is unverified.
// - win-portable: runs from a temporary copy.
export const LOGIN_ITEM_CHANNELS: readonly ElectronDistChannel[] = [
  'mac-dmg',
  'win-nsis',
  'linux-appimage',
  'linux-native',
];

/**
 * Detects which distribution channel the running Electron app belongs to.
 * Returns `null` on unknown platforms.
 *
 * Shared between the Electron main process (tray GUID selection) and the
 * preload bridge (channel suffix appended to the diagnostic version string).
 * Safe to call from preload: only reads `process` / `process.env`.
 *
 * Note: deb vs rpm cannot be told apart at runtime (electron-builder sets no
 * env var for native packages), so both report `linux-native`.
 */
export const getDistChannel = (): ElectronDistChannel | null => {
  const p = process as NodeJS.Process & { windowsStore?: boolean; mas?: boolean };
  switch (process.platform) {
    case 'win32':
      if (process.env.PORTABLE_EXECUTABLE_DIR) {
        return 'win-portable';
      }
      return p.windowsStore ? 'win-store' : 'win-nsis';
    case 'darwin':
      return p.mas ? 'mac-store' : 'mac-dmg';
    case 'linux':
      if (process.env.APPIMAGE) {
        return 'linux-appimage';
      }
      if (process.env.SNAP) {
        return 'linux-snap';
      }
      if (process.env.FLATPAK_ID) {
        return 'linux-flatpak';
      }
      return 'linux-native';
    default:
      return null;
  }
};
