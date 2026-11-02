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
      // Android (replaces the @capawesome edge-to-edge plugin). With 'css', from
      // Capacitor 8.5.2 on, it either passes the native insets through to the
      // WebView (WebView >= 140 with viewport-fit=cover) and mirrors them into
      // --safe-area-inset-*, or else pads the window's DecorView for the system
      // bars and keyboard itself (any API level) and writes 0px into the vars.
      // See docs/android-edge-to-edge-keyboard.md ("Capacitor 8.5.2+").
      insetsHandling: 'css',
      // src/index.html always declares viewport-fit=cover. Telling SystemBars up
      // front keeps WebView >= 140 in the passthrough branch from the first
      // inset pass, instead of padding the DecorView until the page commits and
      // then jumping (it reads the meta tag back only at onPageCommitVisible).
      // Must change together with that meta tag.
      initialViewportFitValueHint: 'cover',
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
