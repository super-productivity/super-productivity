import { OAuthFlowConfig } from '@super-productivity/plugin-api';
import { IssueLog } from '../../../core/log';

/**
 * Apply a plugin's user-supplied OAuth overrides (clientId / clientSecret / redirectUri)
 * from its synced pluginConfig.oauthOverrides onto the plugin's declared oauthConfig.
 *
 * WARNING: a clientSecret read here comes from the synced IssueProvider.pluginConfig
 * (op-log + backups; may be unencrypted on some sync backends) — like existing provider
 * passwords (Jira/CalDAV/Nextcloud), and unlike OAuth tokens which are kept local-only.
 * Plugins that expose a clientSecret field should warn users in the field help text and use
 * only credentials documented as non-confidential (installed/native-app style).
 *
 * NOTE: Custom OAuth credentials (clientId / clientSecret / redirectUri) apply only to the
 * desktop loopback flow and are ignored on web and native platforms.
 */
export const applyPluginOAuthOverrides = (
  oauthConfig: OAuthFlowConfig,
  pluginConfig: Record<string, unknown> | undefined,
  isElectron: boolean,
): OAuthFlowConfig => {
  const overrides = (pluginConfig?.['oauthOverrides'] ?? {}) as Record<string, unknown>;
  const clientId =
    typeof overrides['clientId'] === 'string' ? overrides['clientId'].trim() : '';
  const clientSecret =
    typeof overrides['clientSecret'] === 'string' ? overrides['clientSecret'].trim() : '';
  const redirectUri =
    typeof overrides['redirectUri'] === 'string' ? overrides['redirectUri'].trim() : '';

  // Gate custom OAuth credentials to Electron (desktop loopback flow only)
  if (!isElectron) {
    if (clientId || clientSecret || redirectUri) {
      IssueLog.warn(
        'Custom OAuth credentials (client id / secret / redirect URI) apply only to the desktop loopback flow and are ignored on this platform.',
      );
    }
    return oauthConfig;
  }

  return {
    ...oauthConfig,
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(redirectUri ? { redirectUri } : {}),
  };
};
