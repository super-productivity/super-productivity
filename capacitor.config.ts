import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.super-productivity.app',
  appName: 'Super Productivity',
  webDir: 'dist/browser',
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    LocalNotifications: {
      // Android-specific: small icon for notification
      smallIcon: 'ic_stat_sp',
    },
    Keyboard: {
      // iOS-only: Android excludes @capacitor/keyboard via includePlugins below
      // and uses JavaScriptInterface for keyboard visibility instead.
      // 'native' resizes the WKWebView so 100vh fits above the keyboard.
      resize: 'native',
      // iOS-only; ignored on Android (plugin excluded). Kept false so the
      // WKWebView is not force-resized in fullscreen.
      resizeOnFullScreen: false,
    },
    StatusBar: {
      // iOS: overlay the status bar so content can sit beneath it.
      // No-op on Android 15+ (targetSdk 36).
      overlaysWebView: true,
    },
    SystemBars: {
      // Let Capacitor's built-in SystemBars own edge-to-edge inset handling on
      // Android (replaces the @capawesome edge-to-edge plugin). 'css' enables
      // SystemBars' Android inset handling: it *injects* --safe-area-inset-* CSS
      // vars on API >= 35, and passes native env(safe-area-inset-*) through on
      // WebView >= 140. The WebView <140 / API <35 tail gets neither and falls
      // back to env() (plus the native keyboard shim in CapacitorMainActivity).
      // See docs/plans/2026-06-22-android-systembars-migration-corrected.md.
      insetsHandling: 'css',
      // Initial bar icon style before the theme service boots; runtime updates
      // go through StatusBar.setStyle / NavigationBar (global-theme.service.ts).
      style: 'DARK',
    },
  },
  android: {
    // Android keyboard visibility is handled by JavaScriptInterface. Keeping
    // @capacitor/keyboard Android-side registers an unused insets callback
    // that can crash in Keyboard$1.onEnd on some devices.
    includePlugins: [
      '@capacitor/browser',
      '@capacitor/status-bar',
      'capacitor-plugin-safe-area',
      '@capacitor/app',
      '@capacitor/filesystem',
      '@capacitor/local-notifications',
      '@capacitor/share',
      '@capawesome/capacitor-android-dark-mode-support',
      '@capawesome/capacitor-background-task',
    ],
  },
  ios: {
    // Content inset for safe areas (notch, home indicator)
    contentInset: 'never',
    // Background color for safe areas (home indicator, notch)
    // Use dark color to match dark theme (most common on mobile)
    backgroundColor: '#131314',
    // Allow inline media playback
    allowsLinkPreview: true,
    // Scroll behavior
    scrollEnabled: true,
  },
};

export default config;
