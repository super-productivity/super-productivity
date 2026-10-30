import { Log } from '../log';

const isNotificationApiAvailable = (): boolean => typeof Notification !== 'undefined';

/**
 * Whether the browser already allows notifications. Never prompts, so it is
 * safe outside a user gesture (e.g. when a timer fires).
 */
export const isBrowserNotificationGranted = (): boolean =>
  isNotificationApiAvailable() && Notification.permission === 'granted';

/**
 * Asks for notification permission. Call only from a user gesture — browsers
 * ignore or auto-deny prompts without one. Resolves `false` when the API is
 * missing, the user declines, or the request throws.
 */
export const requestBrowserNotificationPermission = async (): Promise<boolean> => {
  if (!isNotificationApiAvailable()) {
    return false;
  }
  if (Notification.permission === 'granted') {
    return true;
  }
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch (e) {
    Log.err('Requesting notification permission failed', e);
    return false;
  }
};
