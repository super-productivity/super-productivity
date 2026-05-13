import type { ProviderPlatformInfo } from '@sp/sync-providers';
import { IS_IOS_NATIVE, IS_NATIVE_PLATFORM } from '../../../util/is-native-platform';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';

/**
 * Concrete app-side `ProviderPlatformInfo` — the package never reads
 * `Capacitor.*` or `window.SUPAndroid` directly. Module-load-time
 * constants, so reads from this object never differ across the
 * process lifetime.
 */
export const APP_PROVIDER_PLATFORM_INFO: ProviderPlatformInfo = {
  isNativePlatform: IS_NATIVE_PLATFORM,
  isAndroidWebView: IS_ANDROID_WEB_VIEW,
  isIosNative: IS_IOS_NATIVE,
};
