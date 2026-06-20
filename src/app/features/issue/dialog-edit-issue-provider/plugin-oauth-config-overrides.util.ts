import { OAuthFlowConfig } from '@super-productivity/plugin-api';

export const applyPluginOAuthOverrides = (
  oauthConfig: OAuthFlowConfig,
  pluginConfig: Record<string, unknown> | undefined,
): OAuthFlowConfig => {
  const clientId =
    typeof pluginConfig?.['clientId'] === 'string' ? pluginConfig['clientId'].trim() : '';
  const clientSecret =
    typeof pluginConfig?.['clientSecret'] === 'string'
      ? pluginConfig['clientSecret'].trim()
      : '';
  const redirectUri =
    typeof pluginConfig?.['redirectUri'] === 'string'
      ? pluginConfig['redirectUri'].trim()
      : '';

  return {
    ...oauthConfig,
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(redirectUri ? { redirectUri } : {}),
  };
};
