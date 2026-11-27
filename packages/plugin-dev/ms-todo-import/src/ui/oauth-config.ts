import { OAuthFlowConfig } from '@super-productivity/plugin-api';

/**
 * Public client ID of the Super Productivity Microsoft Entra app registration
 * (multi-tenant + personal accounts, public client, PKCE, no secret). Client
 * IDs are not secrets. Redirect URIs it must list: `http://127.0.0.1` under
 * "Mobile and desktop" (Electron loopback, any port) and
 * `<web origin>/assets/oauth-callback.html` under "Single-page application".
 */
export const MS_CLIENT_ID = 'e5c744c8-8f76-48fd-a834-84c37f8b379e';

const MS_LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';

// No `offline_access`: a one-time import needs no refresh token.
export const MS_OAUTH_CONFIG: OAuthFlowConfig = {
  authUrl: `${MS_LOGIN}/authorize`,
  tokenUrl: `${MS_LOGIN}/token`,
  clientId: MS_CLIENT_ID,
  // same public client on web; the redirect differs, not the registration
  webClientId: MS_CLIENT_ID,
  scopes: ['Tasks.Read'],
  extraAuthParams: { prompt: 'select_account' },
};
