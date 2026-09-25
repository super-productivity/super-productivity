import { IS_ELECTRON } from '../../app.constants';
import { isExternalUrlSchemeAllowed } from '../../../../electron/shared-with-frontend/is-external-url-allowed';

export const OPEN_EXTERNAL_URL_PERMISSION = 'openExternalUrl';

/**
 * Host side of `PluginAPI.openExternalUrl`. Three fail-closed checks, enforced
 * here and never in plugin code:
 *   1. Capability: the manifest must declare `"openExternalUrl"` in
 *      `permissions`, which the plugin card lists for the user to review.
 *   2. Scheme: the shared external-link allowlist (GHSA-hr87-735w-hfq3). On
 *      desktop the main process re-checks it at the OPEN_EXTERNAL sink.
 *   3. No `file:`: a note link is opened by a user's click, a plugin call has no
 *      click behind it, so plugins may not open local files or folders.
 * Like `deleteProject`, the permission is install-time disclosure, not
 * containment: plugin.js runs in the renderer and can reach `window.ea`.
 */
export const openExternalUrlForPlugin = async (
  url: unknown,
  permissions: readonly string[] | undefined,
  isElectron: boolean = IS_ELECTRON,
): Promise<void> => {
  if (!(permissions ?? []).includes(OPEN_EXTERNAL_URL_PERMISSION)) {
    throw new Error(
      '[PluginBridge] PluginAPI.openExternalUrl is blocked: this plugin does not declare the "openExternalUrl" permission. Add "openExternalUrl" to the manifest "permissions".',
    );
  }
  const trimmed = typeof url === 'string' ? url.trim() : '';
  // isExternalUrlSchemeAllowed only passes URLs that parse, so `new URL` is safe.
  if (!isExternalUrlSchemeAllowed(trimmed) || new URL(trimmed).protocol === 'file:') {
    throw new Error(
      '[PluginBridge] PluginAPI.openExternalUrl refused the URL: its scheme is not allowed for plugins.',
    );
  }
  if (isElectron) {
    window.ea.openExternalUrl(trimmed);
  } else {
    window.open(trimmed, '_blank', 'noopener,noreferrer');
  }
};
