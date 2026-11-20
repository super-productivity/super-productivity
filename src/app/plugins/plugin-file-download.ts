import type {
  PluginBinaryFileRequest,
  PluginBinaryFileResult,
} from '@super-productivity/plugin-api';
import { IS_ELECTRON } from '../app.constants';
import { assertPluginBinaryFileRequest } from '../../../electron/shared-with-frontend/plugin-binary-file';
import { pluginAssert } from './plugin-bridge-asserts';

export const downloadPluginTextFile = async (
  filename: string,
  data: string,
): Promise<void> => {
  pluginAssert.string(filename);
  pluginAssert.string(data);
  const { download } = await import('../util/download');
  await download(filename, data);
};

export const savePluginBinaryFile = async (
  request: PluginBinaryFileRequest,
): Promise<PluginBinaryFileResult> => {
  assertPluginBinaryFileRequest(request);
  if (IS_ELECTRON) {
    if (!window.ea?.saveBinaryFile) {
      throw new Error('Binary file saving is unavailable in this desktop build');
    }
    return window.ea.saveBinaryFile(request);
  }
  const url = URL.createObjectURL(
    new Blob([request.data], { type: 'application/octet-stream' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = request.filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return {
    kind: 'download-requested',
    openStatus: request.openAfterSave ? 'unavailable' : 'not-requested',
  };
};
