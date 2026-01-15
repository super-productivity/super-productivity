import { InjectionToken } from '@angular/core';

export const IS_ANDROID_WEB_VIEW = !!(window as any).SUPAndroid;
export const IS_F_DROID_APP = !!(window as any).SUPFDroid;

/**
 * Injection token for IS_ANDROID_WEB_VIEW to enable testing.
 * Use this in effects/services that need to be unit tested.
 */
export const IS_ANDROID_WEB_VIEW_TOKEN = new InjectionToken<boolean>(
  'IS_ANDROID_WEB_VIEW',
  {
    providedIn: 'root',
    factory: () => IS_ANDROID_WEB_VIEW,
  },
);
