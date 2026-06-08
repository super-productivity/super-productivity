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

const detectChannel = (): DistChannel => {
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

export const getAppVersionStr = (): string => {
  const base =
    (IS_ANDROID_WEB_VIEW && androidInterface?.getVersion?.()) || environment.version;
  return `${base}${distChannelSuffix(detectChannel())}`;
};
