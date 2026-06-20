import type { OAuthFlowConfig } from '@super-productivity/plugin-api';
import { applyPluginOAuthOverrides } from './plugin-oauth-config-overrides.util';

describe('applyPluginOAuthOverrides', () => {
  const baseConfig: OAuthFlowConfig = {
    authUrl: 'https://launchpad.37signals.com/authorization/new',
    tokenUrl: 'https://launchpad.37signals.com/authorization/token',
    clientId: 'default-client-id',
    clientSecret: 'default-client-secret',
    scopes: ['full'],
  };

  it('applies trimmed user-provided oauth overrides', () => {
    expect(
      applyPluginOAuthOverrides(baseConfig, {
        clientId: '  override-client-id  ',
        clientSecret: '  override-client-secret  ',
        redirectUri: '  http://127.0.0.1:8976/callback  ',
      }),
    ).toEqual({
      ...baseConfig,
      clientId: 'override-client-id',
      clientSecret: 'override-client-secret',
      redirectUri: 'http://127.0.0.1:8976/callback',
    });
  });

  it('ignores empty or non-string override values', () => {
    expect(
      applyPluginOAuthOverrides(baseConfig, {
        clientId: '   ',
        clientSecret: null,
        redirectUri: 42,
      } as unknown as Record<string, unknown>),
    ).toEqual(baseConfig);
  });
});
