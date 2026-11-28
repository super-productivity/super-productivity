export interface PluginOAuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string; // OIDC ID token; shares expiresAt with the access token
  expiresAt: number; // unix ms
  tokenUrl: string; // needed for refresh
  clientId: string; // needed for refresh
  clientSecret?: string; // optional non-confidential installed-app secret for refresh
}
