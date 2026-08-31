export const PLUGIN_OAUTH_TOKEN_KEY_CFG_KEY = '__spOAuthTokenKey';
export const PLUGIN_OAUTH_LEGACY_FALLBACK_CFG_KEY = '__spOAuthLegacyFallback';
export const GOOGLE_CALENDAR_PLUGIN_ID = 'google-calendar-provider';

export const shouldScopePluginOAuth = (pluginId: string): boolean =>
  pluginId === GOOGLE_CALENDAR_PLUGIN_ID;

export const withPluginOAuthTokenKey = (
  pluginId: string,
  pluginConfig: Record<string, unknown>,
  issueProviderId: string,
): Record<string, unknown> =>
  shouldScopePluginOAuth(pluginId)
    ? {
        ...pluginConfig,
        [PLUGIN_OAUTH_TOKEN_KEY_CFG_KEY]: issueProviderId,
      }
    : pluginConfig;
