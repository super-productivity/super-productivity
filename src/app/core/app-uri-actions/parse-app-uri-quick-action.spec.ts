import { QUICK_ACTION_HOSTS, parseAppUriQuickAction } from './parse-app-uri-quick-action';

const SCHEME = 'com.super-productivity.app://';

describe('parseAppUriQuickAction', () => {
  it('should recognize add-task as the quick-add-bar action', () => {
    expect(parseAppUriQuickAction(`${SCHEME}add-task`)).toEqual({ type: 'add-task' });
  });

  it('should recognize every navigation target', () => {
    expect(parseAppUriQuickAction(`${SCHEME}today`)).toEqual({
      type: 'navigate',
      target: 'today',
    });
    expect(parseAppUriQuickAction(`${SCHEME}inbox`)).toEqual({
      type: 'navigate',
      target: 'inbox',
    });
  });

  it('should cover every host listed in QUICK_ACTION_HOSTS', () => {
    // QUICK_ACTION_HOSTS is what the iOS contract test checks Info.plist
    // against, so a host listed there but not parsed here would let a shortcut
    // item ship that silently does nothing.
    QUICK_ACTION_HOSTS.forEach((host) => {
      expect(parseAppUriQuickAction(`${SCHEME}${host}`))
        .withContext(host)
        .not.toBeNull();
    });
  });

  it('should normalize the host case', () => {
    // Custom schemes are non-special per the WHATWG URL spec, so the host is
    // not auto-lowercased the way it would be for http/https.
    expect(parseAppUriQuickAction(`${SCHEME}TODAY`)).toEqual({
      type: 'navigate',
      target: 'today',
    });
    expect(parseAppUriQuickAction(`${SCHEME}Add-Task`)).toEqual({ type: 'add-task' });
  });

  it('should ignore query params rather than reject the action', () => {
    // Nothing passes parameters today, but a stray one (e.g. from a
    // user-built Shortcut) must not turn a valid action into a no-op.
    expect(parseAppUriQuickAction(`${SCHEME}today?foo=bar`)).toEqual({
      type: 'navigate',
      target: 'today',
    });
  });

  it('should not claim the task actions', () => {
    expect(parseAppUriQuickAction(`${SCHEME}create-task?title=hello`)).toBeNull();
    expect(parseAppUriQuickAction(`${SCHEME}complete-task?title=hello`)).toBeNull();
  });

  it('should not claim the OAuth callbacks', () => {
    expect(parseAppUriQuickAction(`${SCHEME}oauth-callback?code=ABC123`)).toBeNull();
    expect(
      parseAppUriQuickAction(`${SCHEME}plugin-oauth-callback?code=ABC123`),
    ).toBeNull();
  });

  it('should return null for unknown hosts', () => {
    expect(parseAppUriQuickAction(`${SCHEME}planner`)).toBeNull();
    expect(parseAppUriQuickAction(`${SCHEME}`)).toBeNull();
  });

  it('should return null instead of throwing on a malformed URL', () => {
    expect(parseAppUriQuickAction('not a url')).toBeNull();
    expect(parseAppUriQuickAction('')).toBeNull();
    expect(parseAppUriQuickAction('today')).toBeNull();
  });
});
