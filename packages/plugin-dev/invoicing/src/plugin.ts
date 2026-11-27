// Invoicing plugin: the UI lives in index.html. plugin.js only relays CSV
// downloads, because the sandboxed iframe cannot download files itself.
import type { PluginAPI } from '@super-productivity/plugin-api';

declare const plugin: PluginAPI;

interface DownloadMessage {
  type: 'download';
  filename: string;
  data: string;
}

const isDownload = (message: unknown): message is DownloadMessage => {
  const m = message as Partial<DownloadMessage> | null;
  return (
    m?.type === 'download' && typeof m.filename === 'string' && typeof m.data === 'string'
  );
};

plugin.onMessage?.(async (message: unknown) => {
  if (!isDownload(message)) return { error: 'Unknown message type' };
  await plugin.downloadFile(message.filename, message.data);
  return { ok: true };
});
