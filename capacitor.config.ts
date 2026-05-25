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
      // Used by iOS native keyboard handling. Android uses JavaScriptInterface
      // for keyboard visibility and excludes the native Keyboard plugin below.
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
  android: {
    adjustMarginsForEdgeToEdge: 'auto',
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
    // iOS-specific plugin overrides
    plugins: {
      StatusBar: {
        overlaysWebView: true,
      },
      Keyboard: {
        // Resize the native WebView when keyboard appears
        // This shrinks the viewport so 100vh/100% automatically fits above keyboard
        resize: 'native',
        resizeOnFullScreen: true,
      },
    },
  },
};

export default config;
