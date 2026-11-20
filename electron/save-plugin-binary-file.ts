import { dialog, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import type { BrowserWindow } from 'electron';
import type { PluginBinaryFileResult } from '../packages/plugin-api/src/types';
import { assertPluginBinaryFileRequest } from './shared-with-frontend/plugin-binary-file';
import {
  hasExecutableFileExtension,
  isPathSafeToOpen,
} from './shared-with-frontend/is-external-url-allowed';

let saving = false;

export const savePluginBinaryFile = async (
  window: BrowserWindow,
  request: unknown,
): Promise<PluginBinaryFileResult> => {
  assertPluginBinaryFileRequest(request);
  if (saving) {
    throw new Error('A binary file save dialog is already pending');
  }
  // Копируем до ожидания пользователя. Только эта операция владеет байтами.
  const bytes = Buffer.from(new Uint8Array(request.data));
  saving = true;
  try {
    const result = await dialog.showSaveDialog(window, { defaultPath: request.filename });
    if (result.canceled || !result.filePath) {
      return { kind: 'canceled' };
    }
    const filePath = result.filePath;
    if (!isPathSafeToOpen(filePath)) {
      throw new Error('Unsupported save location');
    }
    try {
      await writeFile(filePath, bytes);
    } catch {
      throw new Error('Could not save binary file');
    }
    if (!request.openAfterSave) {
      return { kind: 'saved', path: filePath, openStatus: 'not-requested' };
    }
    // Пользователь может изменить расширение в диалоге. Проверяем этот путь
    // независимо от политики загрузки конкретного плагина.
    if (hasExecutableFileExtension(filePath)) {
      return { kind: 'saved', path: filePath, openStatus: 'blocked' };
    }
    try {
      const error = await shell.openPath(filePath);
      return {
        kind: 'saved',
        path: filePath,
        openStatus: error ? 'failed' : 'requested',
      };
    } catch {
      return { kind: 'saved', path: filePath, openStatus: 'failed' };
    }
  } finally {
    saving = false;
  }
};
