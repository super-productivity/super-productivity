import { Share } from '@capacitor/share';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';

export type ShareSupport = 'native' | 'web' | 'none';

/**
 * Detect available share support on current platform.
 */
export const detectShareSupport = async (): Promise<ShareSupport> => {
  if (isCapacitorShareAvailable()) {
    return 'native';
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    return 'web';
  }

  return 'none';
};

/**
 * Check if native/system share is available on current platform.
 */
export const isSystemShareAvailable = async (): Promise<boolean> => {
  if (isCapacitorShareAvailable()) {
    return true;
  }

  if (typeof navigator !== 'undefined' && 'share' in navigator) {
    return true;
  }

  return false;
};

/**
 * Check if Capacitor Share plugin is available.
 */
export const isCapacitorShareAvailable = (): boolean => {
  const sharePlugin = getCapacitorSharePlugin();
  return !!sharePlugin;
};

/**
 * Get Capacitor Share plugin if available.
 */
export const getCapacitorSharePlugin = (): typeof Share | null => {
  if (IS_NATIVE_PLATFORM) {
    return Share;
  }

  return null;
};
