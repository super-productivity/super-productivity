import { Directory, Filesystem } from '@capacitor/filesystem';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';
import { ShareResult } from './share.model';

/**
 * Sanitize filename for safe file system usage.
 */
export const sanitizeFilename = (filename: string): string => {
  const trimmed = filename.trim() || 'shared-image.png';
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!sanitized.toLowerCase().endsWith('.png')) {
    return `${sanitized}.png`;
  }
  return sanitized;
};

/**
 * Extract base64 data from data URL.
 */
export const extractBase64 = (dataUrl: string): string | null => {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    return null;
  }

  return dataUrl.slice(commaIndex + 1);
};

/**
 * Download blob as file using browser download.
 */
export const downloadBlob = (blob: Blob, filename: string): boolean => {
  if (typeof document === 'undefined') {
    return false;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
    return true;
  } catch (error) {
    console.warn('Browser download failed:', error);
    return false;
  } finally {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }
};

/**
 * Clean up cached file from Capacitor filesystem.
 */
export const cleanupCacheFile = async (relativePath: string): Promise<void> => {
  if (!relativePath) {
    return;
  }

  try {
    await Filesystem.deleteFile({
      path: relativePath,
      directory: Directory.Cache,
    });
  } catch (cleanupError) {
    console.warn('Failed to cleanup shared file:', cleanupError);
  }
};

/**
 * Schedule cleanup of cached file after delay.
 */
export const scheduleCacheCleanup = (relativePath: string): void => {
  if (!relativePath) {
    return;
  }

  setTimeout(() => {
    void cleanupCacheFile(relativePath);
  }, 15_000);
};

/**
 * Check if download result can be opened.
 */
export const canOpenDownloadResult = (result: ShareResult): boolean => {
  if (!result) {
    return false;
  }

  if (typeof window !== 'undefined' && result.path && (window as any).ea?.openPath) {
    return true;
  }

  if (IS_NATIVE_PLATFORM) {
    return false;
  }

  if (typeof window !== 'undefined' && (result.uri || result.path)) {
    return true;
  }

  return false;
};

/**
 * Open download result (file or URI).
 */
export const openDownloadResult = async (result: ShareResult): Promise<void> => {
  if (!result) {
    return;
  }

  const { uri, path } = result;

  if (typeof window !== 'undefined' && path && (window as any).ea?.openPath) {
    try {
      (window as any).ea.openPath(path);
      return;
    } catch (error) {
      console.warn('Failed to open path via Electron bridge:', error);
    }
  }

  const candidate = uri ?? path;

  if (typeof window !== 'undefined' && candidate) {
    try {
      window.open(candidate, '_blank', 'noopener');
      return;
    } catch (error) {
      console.warn('Failed to open download in new window:', error);
    }
  }
};
