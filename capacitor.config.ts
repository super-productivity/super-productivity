import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.superproductivity.superproductivity',
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
      // Resize the web view when keyboard appears (iOS)
      resize: 'body',
      // Style keyboard accessory bar
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
  },
};

export default config;
