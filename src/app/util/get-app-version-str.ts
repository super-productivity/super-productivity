import { IS_ANDROID_WEB_VIEW, IS_F_DROID_APP } from './is-android-web-view';
import { IS_IOS } from './is-ios';
import { IS_ELECTRON } from '../app.constants';
import { androidInterface } from '../features/android/android-interface';
import { environment } from '../../environments/environment';

/**
 * Every distribution target the app ships to. Mobile/web are detected in the
 * frontend; desktop ones come from the Electron `getDistChannel()` bridge.
 */
export type DistChannel =
  | 'win-nsis'
  | 'win-portable'
  | 'win-store'
  | 'mac-dmg'
  | 'mac-store'
  | 'linux-appimage'
  | 'linux-snap'
  | 'linux-flatpak'
  | 'linux-native'
  | 'android-play'
  | 'android-fdroid'
  | 'ios'
  | 'web';

/**
 * Channel marker appended to the (display-only) version string so bug reports
 * and the config footer reveal which build a user runs, e.g. `18.6.0AI` for
 * the Linux AppImage. Display-only: no caller does a semver compare on this.
 */
export const distChannelSuffix = (channel: DistChannel | null | undefined): string => {
  switch (channel) {
    case 'win-nsis':
      return 'W';
    case 'win-portable':
      return 'P';
    case 'win-store':
      return 'MS';
    case 'mac-dmg':
      return 'D';
    case 'mac-store':
      return 'MAS';
    case 'linux-appimage':
      return 'AI';
    case 'linux-snap':
      return 'SN';
    case 'linux-flatpak':
      return 'FP';
    case 'linux-native':
      return 'L';
    case 'android-play':
      return 'A';
    case 'android-fdroid':
      return 'AF';
    case 'ios':
      return 'I';
    case 'web':
      return 'WB';
    default:
      return '';
  }
};

/**
 * Resolves the running build's distribution channel. Exported because recovery
 * advice has to differ per channel too (see `idb-open-error-message.ts`), not
 * just the version suffix — telling a Microsoft Store or Flatpak user to
 * download from the website points them at a build that cannot see their data.
 */
export const detectChannel = (): DistChannel => {
  if (IS_IOS) {
    return 'ios';
  }
  if (IS_ANDROID_WEB_VIEW) {
    return IS_F_DROID_APP ? 'android-fdroid' : 'android-play';
  }
  if (IS_ELECTRON && typeof window !== 'undefined') {
    return window.ea?.getDistChannel?.() ?? 'web';
  }
  return 'web';
};

const rawAppVersion = (): string =>
  (IS_ANDROID_WEB_VIEW && androidInterface?.getVersion?.()) || environment.version;

/**
 * Leading `MAJOR.MINOR.PATCH` of a build version string, or `undefined` when
 * there is none. The Android bridge appends a launch-mode marker
 * (`18.22.0_L1`), which must not leak into anything compared as a version.
 */
export const extractSemver = (raw: string): string | undefined =>
  /^\d+\.\d+\.\d+/.exec(raw)?.[0];

/**
 * The bare semver of the running build, for machine-to-machine reporting
 * (SuperSync sends it so the server can gate automatic checkpoints, #9962).
 * Never carries the display channel suffix.
 */
export const getAppSemver = (): string | undefined => extractSemver(rawAppVersion());

export const getAppVersionStr = (): string =>
  `${rawAppVersion()}${distChannelSuffix(detectChannel())}`;
