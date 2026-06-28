import type { OAuthFlowConfig } from '@super-productivity/plugin-api';
import { applyPluginOAuthOverrides } from './plugin-oauth-config-overrides.util';
import { IssueLog } from '../../../core/log';

describe('applyPluginOAuthOverrides', () => {
  const baseConfig: OAuthFlowConfig = {
    authUrl: 'https://launchpad.37signals.com/authorization/new',
    tokenUrl: 'https://launchpad.37signals.com/authorization/token',
    clientId: 'default-client-id',
    clientSecret: 'default-client-secret',
    scopes: ['full'],
  };

  it('applies trimmed user-provided oauth overrides on electron', () => {
    expect(
      applyPluginOAuthOverrides(
        baseConfig,
        {
          oauthOverrides: {
            clientId: '  override-client-id  ',
            clientSecret: '  override-client-secret  ',
            redirectUri: '  http://127.0.0.1:8976/callback  ',
          },
        },
        true,
      ),
    ).toEqual({
      ...baseConfig,
      clientId: 'override-client-id',
      clientSecret: 'override-client-secret',
      redirectUri: 'http://127.0.0.1:8976/callback',
    });
  });

  it('ignores empty or non-string override values on electron', () => {
    expect(
      applyPluginOAuthOverrides(
        baseConfig,
        {
          oauthOverrides: {
            clientId: '   ',
            clientSecret: null,
            redirectUri: 42,
          },
        } as unknown as Record<string, unknown>,
        true,
      ),
    ).toEqual(baseConfig);
  });

  it('returns unchanged config and warns when custom oauth credentials provided on non-electron platform', () => {
    const warnSpy = spyOn(IssueLog, 'warn');
    const result = applyPluginOAuthOverrides(
      baseConfig,
      {
        oauthOverrides: {
          clientId: 'custom-id',
          clientSecret: 'custom-secret',
          redirectUri: 'http://127.0.0.1:8976/callback',
        },
      },
      false,
    );

    expect(result).toEqual(baseConfig);
    expect(warnSpy).toHaveBeenCalledWith(
      'Custom OAuth credentials (client id / secret / redirect URI) apply only to the desktop loopback flow and are ignored on this platform.',
    );
  });

  it('returns unchanged config without warning when no custom oauth credentials on non-electron platform', () => {
    const warnSpy = spyOn(IssueLog, 'warn');
    const result = applyPluginOAuthOverrides(
      baseConfig,
      {
        oauthOverrides: {
          clientId: '   ',
          clientSecret: null,
          redirectUri: undefined,
        },
      } as unknown as Record<string, unknown>,
      false,
    );

    expect(result).toEqual(baseConfig);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ignores flat top-level clientId/clientSecret/redirectUri keys and returns unchanged config on electron', () => {
    const result = applyPluginOAuthOverrides(
      baseConfig,
      {
        clientId: 'flat-client-id',
        clientSecret: 'flat-client-secret',
        redirectUri: 'http://127.0.0.1:8976/callback',
      },
      true,
    );

    expect(result).toEqual(baseConfig);
  });
});
