import {
  GOOGLE_CALENDAR_PLUGIN_ID,
  GOOGLE_TASKS_PLUGIN_ID,
  PLUGIN_OAUTH_TOKEN_KEY_CFG_KEY,
  shouldScopePluginOAuth,
  withPluginOAuthTokenKey,
} from './plugin-oauth-token-key.util';

describe('plugin-oauth-token-key.util', () => {
  it('scopes OAuth only for the bundled Google OAuth plugins', () => {
    expect(shouldScopePluginOAuth(GOOGLE_CALENDAR_PLUGIN_ID)).toBeTrue();
    expect(shouldScopePluginOAuth(GOOGLE_TASKS_PLUGIN_ID)).toBeTrue();
    expect(shouldScopePluginOAuth('uploaded-oauth-plugin')).toBeFalse();
  });

  it('adds the transient token key only for scoped Google OAuth plugins', () => {
    expect(
      withPluginOAuthTokenKey(
        GOOGLE_CALENDAR_PLUGIN_ID,
        { readCalendarIds: [] },
        'provider-a',
      ),
    ).toEqual({
      readCalendarIds: [],
      [PLUGIN_OAUTH_TOKEN_KEY_CFG_KEY]: 'provider-a',
    });

    expect(
      withPluginOAuthTokenKey(
        GOOGLE_TASKS_PLUGIN_ID,
        { taskListId: '@default' },
        'provider-b',
      ),
    ).toEqual({
      taskListId: '@default',
      [PLUGIN_OAUTH_TOKEN_KEY_CFG_KEY]: 'provider-b',
    });

    expect(
      withPluginOAuthTokenKey('uploaded-oauth-plugin', { value: 1 }, 'provider-a'),
    ).toEqual({ value: 1 });
  });

  it('isolates non-scoped plugin config writes from the stored provider', () => {
    const stored = { calendarId: 'original' };
    const config = withPluginOAuthTokenKey('caldav-provider', stored, 'provider-a');
    config['calendarId'] = 'changed-by-plugin';
    expect(stored.calendarId).toBe('original');
  });
});
