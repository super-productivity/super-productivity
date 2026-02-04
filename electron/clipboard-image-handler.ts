import { ipcMain, clipboard } from 'electron';
import { promises as fsPromises } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { createValidatedHandler } from './ipc-handler-wrapper';
import { EXTENSION_MIME_TYPES } from './shared-with-frontend/mime-type-mapping.const';

interface ClipboardImageMeta {
  id: string;
  mimeType: string;
  createdAt: number;
  size: number;
}

const SUPPORTED_IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
];

/**
 * Ensures the clipboard-images directory exists.
 */
const ensureDir = (dirPath: string): void => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

/**
 * Gets the MIME type from file extension.
 */
const getMimeFromExt = (ext: string): string => {
  const extLower = ext.toLowerCase();
  return (
    EXTENSION_MIME_TYPES[extLower as keyof typeof EXTENSION_MIME_TYPES] || 'image/png'
  );
};

/**
 * Finds the image file by ID (checking various extensions).
 * @electron-only This function is only available in the Electron main process.
 */
const findImageFile = (basePath: string, imageId: string): string | null => {
  for (const ext of SUPPORTED_IMAGE_EXTENSIONS) {
    const filePath = path.join(basePath, `${imageId}${ext}`);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
};

export const initClipboardImageHandlers = (): void => {
  // Save clipboard image
  ipcMain.handle(
    IPC.CLIPBOARD_IMAGE_SAVE,
    createValidatedHandler(
      async ({
        basePath,
        fileName,
        base64Data,
      }: {
        basePath: string;
        fileName: string;
        base64Data: string;
        mimeType: string;
      }) => {
        ensureDir(basePath);

        const filePath = path.join(basePath, fileName);
        const buffer = Buffer.from(base64Data, 'base64');

        await fsPromises.writeFile(filePath, new Uint8Array(buffer));

        return filePath;
      },
      { validatePath: true },
    ),
  );

  // Load clipboard image
  ipcMain.handle(
    IPC.CLIPBOARD_IMAGE_LOAD,
    createValidatedHandler(
      async ({ basePath, imageId }: { basePath: string; imageId: string }) => {
        const filePath = findImageFile(basePath, imageId);
        if (!filePath) {
          return null;
        }

        const buffer = await fsPromises.readFile(filePath);
        const ext = path.extname(filePath);
        const mimeType = getMimeFromExt(ext);

        return {
          base64: buffer.toString('base64'),
          mimeType,
        };
      },
      { validatePath: true, errorValue: null },
    ),
  );

  // Delete clipboard image
  ipcMain.handle(
    IPC.CLIPBOARD_IMAGE_DELETE,
    createValidatedHandler(
      async ({ basePath, imageId }: { basePath: string; imageId: string }) => {
        const filePath = findImageFile(basePath, imageId);
        if (!filePath) {
          return false;
        }

        await fsPromises.unlink(filePath);
        return true;
      },
      { validatePath: true, errorValue: false },
    ),
  );

  // List clipboard images
  ipcMain.handle(
    IPC.CLIPBOARD_IMAGE_LIST,
    createValidatedHandler(
      async ({ basePath }: { basePath: string }) => {
        if (!fs.existsSync(basePath)) {
          return [];
        }

        const files = await fsPromises.readdir(basePath);
        const imageExtensions = new Set(SUPPORTED_IMAGE_EXTENSIONS);

        const images: ClipboardImageMeta[] = [];

        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          if (!imageExtensions.has(ext)) {
            continue;
          }

          const filePath = path.join(basePath, file);
          const stats = await fsPromises.stat(filePath);
          const id = path.basename(file, ext);

          images.push({
            id,
            mimeType: getMimeFromExt(ext),
            createdAt: stats.birthtimeMs,
            size: stats.size,
          });
        }

        return images;
      },
      { validatePath: true, errorValue: [] },
    ),
  );

  // Get clipboard image file path
  ipcMain.handle(
    IPC.CLIPBOARD_IMAGE_GET_PATH,
    createValidatedHandler(
      async ({ basePath, imageId }: { basePath: string; imageId: string }) => {
        return findImageFile(basePath, imageId);
      },
      { validatePath: true, errorValue: null },
    ),
  );

  // Copy image file from clipboard to clipboard-images directory
  ipcMain.handle(
    IPC.CLIPBOARD_COPY_IMAGE_FILE,
    createValidatedHandler(
      async ({ basePath, filePath }: { basePath: string; filePath: string }) => {
        ensureDir(basePath);

        // Generate unique ID
        const id = Date.now().toString(36) + Math.random().toString(36).substring(2);
        const ext = path.extname(filePath).toLowerCase();
        const destFileName = `${id}${ext}`;
        const destPath = path.join(basePath, destFileName);

        // Copy the file
        await fsPromises.copyFile(filePath, destPath);

        // Get file stats
        const stats = await fsPromises.stat(destPath);
        const mimeType = getMimeFromExt(ext);

        return {
          id,
          mimeType,
          size: stats.size,
          createdAt: Date.now(),
        };
      },
      { validatePath: true, errorValue: null },
    ),
  );

  // Read image directly from clipboard
  ipcMain.handle(
    IPC.CLIPBOARD_READ_IMAGE,
    createValidatedHandler(
      async ({ basePath }: { basePath: string }) => {
        const image = clipboard.readImage();

        if (image.isEmpty()) {
          return null;
        }

        ensureDir(basePath);

        // Generate unique ID
        const id = Date.now().toString(36) + Math.random().toString(36).substring(2);
        const fileName = `${id}.png`;
        const filePath = path.join(basePath, fileName);

        // Save as PNG
        const pngBuffer = image.toPNG();
        await fsPromises.writeFile(filePath, new Uint8Array(pngBuffer));

        const stats = await fsPromises.stat(filePath);

        return {
          id,
          mimeType: 'image/png',
          size: stats.size,
          createdAt: Date.now(),
        };
      },
      { validatePath: true, errorValue: null },
    ),
  );

  ipcMain.handle(
    IPC.CLIPBOARD_GET_FILE_PATHS,
    createValidatedHandler(
      async () => {
        const filePaths: string[] = [];

        // Note: Electron's clipboard API on Windows doesn't reliably read file paths
        // when files are copied. clipboard.readImage() is used as fallback.

        // Try reading plain text (sometimes contains file paths)
        const plainText = clipboard.readText();
        if (plainText && plainText.startsWith('file://')) {
          const lines = plainText.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('file://')) {
              let filePath = trimmed.substring(7);
              if (process.platform === 'win32' && filePath.startsWith('/')) {
                filePath = filePath.substring(1);
              }
              filePath = decodeURIComponent(filePath);
              if (process.platform === 'win32') {
                filePath = filePath.replace(/\//g, '\\');
              }
              filePaths.push(filePath);
            }
          }
        }

        // Filter to only existing image files
        const imageFiles = filePaths.filter((filePath) => {
          if (!fs.existsSync(filePath)) return false;
          const ext = path.extname(filePath).toLowerCase();
          return SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
        });

        return imageFiles;
      },
      { errorValue: [] },
    ),
  );
};
