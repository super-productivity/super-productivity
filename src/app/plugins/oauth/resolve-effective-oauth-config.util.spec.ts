import type { OAuthFlowConfig } from '@super-productivity/plugin-api';
import {
  resolveEffectiveOAuthConfig,
  OAuthPlatform,
} from './resolve-effective-oauth-config.util';

describe('resolveEffectiveOAuthConfig', () => {
  const baseConfig: OAuthFlowConfig = {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: 'desktop-client-id',
    clientSecret: 'desktop-client-secret',
    scopes: ['calendar.readonly'],
    redirectUri: 'http://127.0.0.1:8976/callback',
    webClientId: 'web-client-id',
    mobileClientId: 'android-client-id',
    iosClientId: 'ios-client-id',
  };

  const platform = (overrides: Partial<OAuthPlatform> = {}): OAuthPlatform => ({
    isElectron: false,
    isNative: false,
    isAndroid: false,
    isIos: false,
    ...overrides,
  });

  it('on desktop (Electron) keeps the desktop client, secret, and the loopback redirectUri', () => {
    const result = resolveEffectiveOAuthConfig(
      baseConfig,
      platform({ isElectron: true }),
    );
    expect(result.clientId).toBe('desktop-client-id');
    expect(result.clientSecret).toBe('desktop-client-secret');
    expect(result.redirectUri).toBe('http://127.0.0.1:8976/callback');
  });

  it('on Android swaps in the mobile client id and strips the secret + redirectUri', () => {
    const result = resolveEffectiveOAuthConfig(
      baseConfig,
      platform({ isNative: true, isAndroid: true }),
    );
    expect(result.clientId).toBe('android-client-id');
    expect(result.clientSecret).toBeUndefined();
    expect(result.redirectUri).toBeUndefined();
  });

  it('on iOS swaps in the iOS client id and strips the secret + redirectUri', () => {
    const result = resolveEffectiveOAuthConfig(
      baseConfig,
      platform({ isNative: true, isIos: true }),
    );
    expect(result.clientId).toBe('ios-client-id');
    expect(result.clientSecret).toBeUndefined();
    expect(result.redirectUri).toBeUndefined();
  });

  it('on web swaps in the web client id and strips the secret + redirectUri', () => {
    const result = resolveEffectiveOAuthConfig(baseConfig, platform());
    expect(result.clientId).toBe('web-client-id');
    expect(result.clientSecret).toBeUndefined();
    expect(result.redirectUri).toBeUndefined();
  });

  it('on web throws when the plugin has no web client id', () => {
    const noWebClient = { ...baseConfig, webClientId: undefined };
    expect(() => resolveEffectiveOAuthConfig(noWebClient, platform())).toThrowError(
      /not available in the web build/,
    );
  });

  it('treats an Android WebView (isAndroid + isNative) as native, not web — no throw without a webClientId', () => {
    // The web branch throws on a missing webClientId, but it is gated by !isNative, so a
    // native build must never be treated as web. An Android WebView reports both isAndroid
    // and isNative and must resolve via the Android branch rather than the web throw.
    const noWeb = { ...baseConfig, webClientId: undefined };
    const result = resolveEffectiveOAuthConfig(
      noWeb,
      platform({ isNative: true, isAndroid: true }),
    );
    expect(result.clientId).toBe('android-client-id');
    expect(result.clientSecret).toBeUndefined();
  });

  // The headline of the redirectUri fix: a desktop loopback redirectUri must never leak
  // into the native flow even when the plugin ships no matching platform client id (the
  // fall-through case) — otherwise validateOAuthRedirectUri rejects it and connect throws.
  it('strips the redirectUri on a native platform with no matching client id (Android, no mobileClientId)', () => {
    const noMobile = { ...baseConfig, mobileClientId: undefined };
    const result = resolveEffectiveOAuthConfig(
      noMobile,
      platform({ isNative: true, isAndroid: true }),
    );
    expect(result.redirectUri).toBeUndefined();
    // Public client on a non-desktop platform: the desktop clientSecret is dropped too.
    // No matching platform client id to swap in, so the declared clientId is unchanged.
    expect(result.clientSecret).toBeUndefined();
    expect(result.clientId).toBe('desktop-client-id');
  });

  it('strips the redirectUri on a native platform with no matching client id (iOS, no iosClientId)', () => {
    const noIos = { ...baseConfig, iosClientId: undefined };
    const result = resolveEffectiveOAuthConfig(
      noIos,
      platform({ isNative: true, isIos: true }),
    );
    expect(result.redirectUri).toBeUndefined();
    expect(result.clientSecret).toBeUndefined();
    expect(result.clientId).toBe('desktop-client-id');
  });

  it('does not mutate the input config', () => {
    const snapshot = JSON.parse(JSON.stringify(baseConfig));
    resolveEffectiveOAuthConfig(baseConfig, platform());
    expect(baseConfig).toEqual(snapshot);
  });
});
