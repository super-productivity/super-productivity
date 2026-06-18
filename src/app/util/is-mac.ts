import { InjectionToken } from '@angular/core';

export const IS_MAC = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

/**
 * Injection token for IS_MAC to enable testing.
 * New DI-tested effects/services should prefer this token over the IS_MAC
 * constant to ensure testability and prevent logic drift.
 */
export const IS_MAC_TOKEN = new InjectionToken<boolean>('IS_MAC', {
  providedIn: 'root',
  factory: () => IS_MAC,
});
