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
      // false is required when paired with @capawesome/capacitor-android-edge-
      // to-edge-support; ignored on iOS where this key has no effect.
      resizeOnFullScreen: false,
    },
    StatusBar: {
      // iOS: overlay the status bar so content can sit beneath it.
      // No-op on Android 15+ (targetSdk 36).
      overlaysWebView: true,
    },
    SystemBars: {
      // Disable Capacitor's built-in inset handling so the edge-to-edge plugin
      // can own it. With targetSdk 36 (Android 16) edge-to-edge is mandatory,
      // and the two layers both applying insets fight each other — visible
      // as fixed-position elements scrolling with content when the IME is up.
      insetsHandling: 'disable',
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
      '@capawesome/capacitor-android-edge-to-edge-support',
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
