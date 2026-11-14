import type { PluginBinaryFileRequest } from '../../packages/plugin-api/src/types';

export const MAX_PLUGIN_BINARY_FILE_BYTES = 10 * 1024 * 1024;

/** Общая проверка на границах plugin bridge и IPC основного процесса. */
export const assertPluginBinaryFileRequest: (
  value: unknown,
) => asserts value is PluginBinaryFileRequest = (value) => {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid binary file request');
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.filename !== 'string' ||
    !request.filename ||
    request.filename.length > 180 ||
    request.filename === '.' ||
    request.filename === '..' ||
    /[. ]$/.test(request.filename) ||
    /[\\/<>:"|?*\u0000-\u001f\u007f]/.test(request.filename) ||
    Object.keys(request).some(
      (key) => !['filename', 'data', 'openAfterSave'].includes(key),
    ) ||
    !(request.data instanceof ArrayBuffer) ||
    request.data.byteLength > MAX_PLUGIN_BINARY_FILE_BYTES ||
    (request.openAfterSave !== undefined && typeof request.openAfterSave !== 'boolean')
  ) {
    throw new Error('Invalid binary file request');
  }
};
