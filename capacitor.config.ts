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
      // Default: resize body (Android)
      resize: 'body',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      // Status bar overlays webview (iOS)
      overlaysWebView: false,
    },
  },
  ios: {
    // Content inset for safe areas (notch, home indicator)
    contentInset: 'automatic',
    // Background color for safe areas (home indicator, notch)
    // Use dark color to match dark theme (most common on mobile)
    backgroundColor: '#131314',
    // Allow inline media playback
    allowsLinkPreview: true,
    // Scroll behavior
    scrollEnabled: true,
    // iOS-specific plugin overrides
    plugins: {
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
