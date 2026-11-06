import type { PluginManifest } from '@super-productivity/plugin-api';
import { MAX_PLUGIN_MANIFEST_SIZE } from '../plugin.const';

/**
 * Reads only `manifest.json` from a plugin ZIP, so the install confirmation can show what
 * the plugin declares before anything is installed. Resolves `null` when the ZIP or the
 * manifest can't be read: the confirmation then shows the generic text, and
 * `PluginService.loadPluginFromZip` reports the actual error after it.
 */
export const readZipManifest = async (file: Blob): Promise<PluginManifest | null> => {
  let zipData: Uint8Array;
  let unzip: typeof import('fflate').unzip;
  try {
    ({ unzip } = await import('fflate'));
    zipData = new Uint8Array(await file.arrayBuffer());
  } catch {
    // Unreadable file or chunk: loadPluginFromZip hits the same failure and reports it.
    return null;
  }
  const files = await new Promise<Record<string, Uint8Array> | null>((resolve) => {
    unzip(zipData, { filter: (f) => f.name === 'manifest.json' }, (err, result) =>
      resolve(err ? null : result),
    );
  });
  const bytes = files?.['manifest.json'];
  if (!bytes || bytes.length > MAX_PLUGIN_MANIFEST_SIZE) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as PluginManifest)
      : null;
  } catch {
    // Invalid JSON: loadPluginFromZip rejects the same file with a translated error.
    return null;
  }
};
