/**
 * Platform booleans the sync providers need to make routing decisions
 * (e.g. CapacitorHttp vs fetch, iOS-specific workarounds). The host
 * supplies a concrete object at provider construction time; the package
 * never reads `Capacitor.*` or `window.*` directly.
 *
 * Values are read-only because they are evaluated once at process start.
 */
export interface ProviderPlatformInfo {
  /**
   * True when running under Capacitor on a mobile device, OR when running
   * inside the Android WebView shim (which is not Capacitor but exposes a
   * similar bridge surface).
   */
  readonly isNativePlatform: boolean;
  /** True when the host is the Android WebView shim. */
  readonly isAndroidWebView: boolean;
  /** True when running on iOS via Capacitor. */
  readonly isIosNative: boolean;
}
