export interface PluginOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
  tokenUrl: string; // needed for refresh
  clientId: string; // needed for refresh
  clientSecret?: string; // needed for refresh (Google requires it)
}
