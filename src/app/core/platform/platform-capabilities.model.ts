/**
 * Platform types supported by the application
 */
export type PlatformType = 'ios' | 'android' | 'web' | 'electron';

/**
 * Runtime capabilities that vary by platform.
 * Used to conditionally enable/disable features in the UI.
 */
export interface PlatformCapabilities {
  /**
   * Whether the platform supports background time tracking notifications.
   * Android only - uses foreground service.
   */
  readonly backgroundTracking: boolean;

  /**
   * Whether the platform supports background focus mode timer.
   * Android only - uses foreground service.
   */
  readonly backgroundFocusTimer: boolean;

  /**
   * Whether the platform supports local file sync (Storage Access Framework).
   * Android only for MVP.
   */
  readonly localFileSync: boolean;

  /**
   * Whether the platform supports home screen widgets.
   * Android only for MVP.
   */
  readonly homeWidget: boolean;

  /**
   * Whether the platform supports scheduled local notifications.
   * iOS and Android via Capacitor LocalNotifications plugin.
   */
  readonly scheduledNotifications: boolean;

  /**
   * Whether the platform supports WebDAV sync.
   * All platforms - uses CapacitorHttp on mobile, fetch on web.
   */
  readonly webdavSync: boolean;

  /**
   * Whether the platform supports sharing content to other apps.
   * iOS and Android via Capacitor Share plugin, Web via Web Share API.
   */
  readonly shareOut: boolean;

  /**
   * Whether the platform supports receiving shared content from other apps.
   * Android only for MVP. iOS requires Share Extension (post-MVP).
   */
  readonly shareIn: boolean;

  /**
   * Whether the platform supports native dark mode detection.
   * All platforms support this.
   */
  readonly darkMode: boolean;
}

/**
 * Default capabilities for web browser
 */
export const WEB_CAPABILITIES: PlatformCapabilities = {
  backgroundTracking: false,
  backgroundFocusTimer: false,
  localFileSync: false,
  homeWidget: false,
  scheduledNotifications: false, // Service worker notifications only
  webdavSync: true,
  shareOut: true, // Web Share API
  shareIn: false,
  darkMode: true,
};

/**
 * Capabilities for Electron desktop app
 */
export const ELECTRON_CAPABILITIES: PlatformCapabilities = {
  backgroundTracking: true, // Tray icon
  backgroundFocusTimer: true, // Always visible window
  localFileSync: true, // Native file system
  homeWidget: false,
  scheduledNotifications: true, // Native notifications
  webdavSync: true,
  shareOut: true,
  shareIn: false,
  darkMode: true,
};

/**
 * Capabilities for Android via Capacitor
 */
export const ANDROID_CAPABILITIES: PlatformCapabilities = {
  backgroundTracking: true, // Foreground service
  backgroundFocusTimer: true, // Foreground service
  localFileSync: true, // Storage Access Framework
  homeWidget: true, // AppWidgetProvider
  scheduledNotifications: true, // LocalNotifications plugin
  webdavSync: true, // CapacitorHttp
  shareOut: true, // Share plugin
  shareIn: true, // Intent filter
  darkMode: true,
};

/**
 * Capabilities for iOS via Capacitor (MVP)
 */
export const IOS_CAPABILITIES: PlatformCapabilities = {
  backgroundTracking: false, // Not supported in MVP
  backgroundFocusTimer: false, // Not supported in MVP
  localFileSync: false, // Not supported in MVP
  homeWidget: false, // Not supported in MVP
  scheduledNotifications: true, // LocalNotifications plugin
  webdavSync: true, // CapacitorHttp
  shareOut: true, // Share plugin
  shareIn: false, // Requires Share Extension (post-MVP)
  darkMode: true,
};
