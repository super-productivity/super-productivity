import { IS_ELECTRON } from '../app.constants';

/**
 * Gets the default path for clipboard images storage.
 * This is used both by the ClipboardImageService and ClipboardImagesCfgComponent
 * to ensure consistent default path logic.
 */
export const getDefaultClipboardImagesPath = async (): Promise<string> => {
  if (!IS_ELECTRON) {
    throw new Error('Default clipboard images path is only available in Electron');
  }

  const userDataPath = await window.ea.getUserDataPath();
  const isWindows = !window.ea.isLinux() && !window.ea.isMacOS();
  const separator = isWindows ? '\\' : '/';
  return `${userDataPath}${separator}clipboard-images`;
};
