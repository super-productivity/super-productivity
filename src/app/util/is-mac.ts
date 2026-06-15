import { InjectionToken } from '@angular/core';

export const IS_MAC = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

/**
 * Injection token for IS_MAC to enable testing.
 * Use this in effects/services that need to be unit tested.
 */
export const IS_MAC_TOKEN = new InjectionToken<boolean>('IS_MAC', {
  providedIn: 'root',
  factory: () => IS_MAC,
});
