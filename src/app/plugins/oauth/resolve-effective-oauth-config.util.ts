import { OAuthFlowConfig } from '@super-productivity/plugin-api';

export interface OAuthPlatform {
  isElectron: boolean;
  isNative: boolean;
  isAndroid: boolean;
  isIos: boolean;
}

/**
 * Resolve the platform-specific OAuth config from a plugin's declared config.
 *
 * - clientId: the declared `clientId` is the desktop client (used by Electron); web,
 *   Android and iOS swap in their public/platform client id (webClientId /
 *   mobileClientId / iosClientId).
 * - clientSecret: dropped on every non-desktop platform (public clients only).
 * - redirectUri: a plugin-declared redirectUri is the desktop loopback override and is
 *   honored ONLY on Electron; it is stripped on every other path so prepareRedirectUri
 *   produces the platform default (web callback page / native app scheme). Otherwise a
 *   web/native-capable plugin that also sets a desktop redirectUri would throw at
 *   connect time when that loopback URI fails web/native validation.
 *
 * Throws if the web build has no webClientId (the plugin isn't web-capable).
 *
 * Pure + platform-parameterized so every branch is unit-testable; the module-level
 * IS_ELECTRON / IS_NATIVE_PLATFORM / IS_*_NATIVE consts cannot be mocked in karma.
 */
export const resolveEffectiveOAuthConfig = (
  config: OAuthFlowConfig,
  platform: OAuthPlatform,
): OAuthFlowConfig => {
  // Order matters: an Android WebView reports both isAndroid and isNative, so it must
  // land in the Android branch (correct) and never reach the web branch below.
  if (platform.isAndroid && config.mobileClientId) {
    return {
      ...config,
      clientId: config.mobileClientId,
      clientSecret: undefined,
      redirectUri: undefined,
    };
  }
  if (platform.isIos && config.iosClientId) {
    return {
      ...config,
      clientId: config.iosClientId,
      clientSecret: undefined,
      redirectUri: undefined,
    };
  }
  if (!platform.isElectron && !platform.isNative) {
    const webClientId = config.webClientId;
    if (!webClientId) {
      throw new Error(
        'OAuth: this plugin is not available in the web build. Connect from the desktop or mobile app instead.',
      );
    }
    return {
      ...config,
      clientId: webClientId,
      clientSecret: undefined,
      redirectUri: undefined,
    };
  }
  // Desktop (Electron) is the only flow that honors a plugin-declared clientSecret or
  // redirectUri. Any other fall-through — e.g. a native platform where the plugin ships
  // no matching mobile/iOS client id — is a public client on a non-desktop platform, so
  // strip both: the secret must not be sent, and the desktop loopback redirectUri would
  // be rejected by native/web validation. Keeps clientSecret + redirectUri desktop-only.
  if (!platform.isElectron) {
    return { ...config, clientSecret: undefined, redirectUri: undefined };
  }
  return config;
};
