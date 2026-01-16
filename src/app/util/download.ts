import { Directory, Encoding, Filesystem, WriteFileResult } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { IS_NATIVE_PLATFORM } from './is-native-platform';
import { Log } from '../core/log';
// Type definitions for window.ea are in ../core/window-ea.d.ts

const isRunningInSnap = (): boolean => {
  return !!window.ea?.isSnap?.();
};

export const download = async (
  filename: string,
  stringData: string,
): Promise<{ isSnap?: boolean; path?: string; wasCanceled?: boolean }> => {
  // Use Capacitor Filesystem + Share for native mobile platforms (Android and iOS)
  if (IS_NATIVE_PLATFORM) {
    try {
      const fileResult = await Filesystem.writeFile({
        path: filename,
        data: stringData,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
        recursive: true,
      });

      try {
        await Share.share({
          title: filename,
          files: [fileResult.uri],
        });
      } catch (shareError: any) {
        const isCanceled =
          shareError === 'Share canceled' ||
          shareError?.message === 'Share canceled' ||
          shareError?.name === 'AbortError';
        if (isCanceled) {
          return { wasCanceled: true };
        } else {
          throw shareError;
        }
      }
    } catch (e) {
      Log.error(e);
      await saveStringAsFile(filename, stringData);
    }
    return { wasCanceled: false };
  } else if (isRunningInSnap() && window.ea?.saveFileDialog) {
    // Use native dialog for snap to avoid AppArmor permission issues
    const result = await window.ea.saveFileDialog(filename, stringData);
    if (result.success && result.path) {
      Log.log('File saved to:', result.path);
      return { isSnap: true, path: result.path };
    }
    return { isSnap: true };
  } else {
    const blob = new Blob([stringData], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return {};
  }
};

/**
 * Saves a string content as a file in the app's Documents directory.
 * @param fileName The desired name for the file (e.g., 'my-data.txt', 'report.json').
 * @param content The string content to save.
 */
const saveStringAsFile = async (
  fileName: string,
  content: string,
): Promise<WriteFileResult> => {
  const r = await Filesystem.writeFile({
    path: fileName,
    data: content,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  Log.log(r);
  return r;
};

// interestingly this can't live in the logs.ts or it leads to weird "window" not found errors
export const downloadLogs = async (): Promise<void> => {
  await download('SP-logs.json', Log.exportLogHistory());
};
