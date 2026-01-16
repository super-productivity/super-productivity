import { Capacitor } from '@capacitor/core';
import { IS_ANDROID_WEB_VIEW } from './is-android-web-view';

/**
 * Whether running in a native Capacitor context (iOS or Android).
 * This can be used in constants that are evaluated at module load time.
 */
export const IS_NATIVE_PLATFORM = Capacitor.isNativePlatform() || IS_ANDROID_WEB_VIEW;

/**
 * Whether running on iOS native (Capacitor).
 */
export const IS_IOS_NATIVE = Capacitor.getPlatform() === 'ios';

/**
 * Whether running on Android native (Capacitor or WebView).
 */
export const IS_ANDROID_NATIVE =
  Capacitor.getPlatform() === 'android' || IS_ANDROID_WEB_VIEW;
