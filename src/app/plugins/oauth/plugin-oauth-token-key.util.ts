// Internal host ↔ bundled Google OAuth plugins contract, not a third-party plugin API.
export const PLUGIN_OAUTH_TOKEN_KEY_CFG_KEY = '__spOAuthTokenKey';
export const GOOGLE_CALENDAR_PLUGIN_ID = 'google-calendar-provider';
export const GOOGLE_TASKS_PLUGIN_ID = 'google-tasks-provider';

export const SCOPED_OAUTH_PLUGIN_IDS: ReadonlySet<string> = new Set([
  GOOGLE_CALENDAR_PLUGIN_ID,
  GOOGLE_TASKS_PLUGIN_ID,
]);

export const shouldScopePluginOAuth = (pluginId: string): boolean =>
  SCOPED_OAUTH_PLUGIN_IDS.has(pluginId);

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
    : { ...pluginConfig };
