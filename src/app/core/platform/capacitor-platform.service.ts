import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  ANDROID_CAPABILITIES,
  ELECTRON_CAPABILITIES,
  IOS_CAPABILITIES,
  PlatformCapabilities,
  PlatformType,
  WEB_CAPABILITIES,
} from './platform-capabilities.model';

/**
 * Service for detecting platform and exposing platform-specific capabilities.
 *
 * This service provides a unified interface for platform detection and feature
 * availability, replacing scattered IS_ANDROID_WEB_VIEW checks throughout the codebase.
 *
 * Usage:
 * ```typescript
 * if (this.platformService.capabilities.scheduledNotifications) {
 *   // Schedule notification using Capacitor plugin
 * }
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class CapacitorPlatformService {
  /**
   * The current platform type
   */
  readonly platform: PlatformType;

  /**
   * Whether running in a native Capacitor context (iOS or Android)
   */
  readonly isNative: boolean;

  /**
   * Whether running in a mobile context (iOS or Android, native or PWA)
   */
  readonly isMobile: boolean;

  /**
   * Platform capabilities for conditional feature enabling
   */
  readonly capabilities: PlatformCapabilities;

  constructor() {
    this.platform = this._detectPlatform();
    // Include legacy Android WebView in isNative check
    this.isNative = Capacitor.isNativePlatform() || this._isAndroidWebView();
    this.isMobile = this.platform === 'ios' || this.platform === 'android';
    this.capabilities = this._getCapabilities();
  }

  /**
   * Check if a specific capability is available
   */
  hasCapability(capability: keyof PlatformCapabilities): boolean {
    return this.capabilities[capability];
  }

  /**
   * Check if running on iOS
   */
  isIOS(): boolean {
    return this.platform === 'ios';
  }

  /**
   * Check if running on Android
   */
  isAndroid(): boolean {
    return this.platform === 'android';
  }

  /**
   * Check if running in Electron
   */
  isElectron(): boolean {
    return this.platform === 'electron';
  }

  /**
   * Check if running in web browser (not Electron, not native mobile)
   */
  isWeb(): boolean {
    return this.platform === 'web';
  }

  /**
   * Check if running on iPad (native or browser)
   */
  isIPad(): boolean {
    if (this.platform !== 'ios') {
      return false;
    }
    // Check for iPad identifier in user agent
    const userAgent = navigator.userAgent;
    if (/iPad/.test(userAgent)) {
      return true;
    }
    // iPad on iOS 13+ reports as Mac with touch support
    if (userAgent.includes('Mac') && 'ontouchend' in document) {
      return true;
    }
    return false;
  }

  /**
   * Detect the current platform
   */
  private _detectPlatform(): PlatformType {
    // Check for Electron first (it also has navigator)
    if (this._isElectron()) {
      return 'electron';
    }

    // Check for native Capacitor platforms
    if (Capacitor.isNativePlatform()) {
      const platform = Capacitor.getPlatform();
      if (platform === 'ios') {
        return 'ios';
      }
      if (platform === 'android') {
        return 'android';
      }
    }

    // Check for Android WebView (legacy check for existing Android implementation)
    if (this._isAndroidWebView()) {
      return 'android';
    }

    // Check for iOS in browser context (iPad, iPhone)
    if (this._isIOSBrowser()) {
      // Running in iOS browser, not native - treat as web
      return 'web';
    }

    return 'web';
  }

  /**
   * Get capabilities for the current platform
   */
  private _getCapabilities(): PlatformCapabilities {
    switch (this.platform) {
      case 'ios':
        return IOS_CAPABILITIES;
      case 'android':
        return ANDROID_CAPABILITIES;
      case 'electron':
        return ELECTRON_CAPABILITIES;
      default:
        return WEB_CAPABILITIES;
    }
  }

  /**
   * Check if running in Electron
   */
  private _isElectron(): boolean {
    return navigator.userAgent.toLowerCase().indexOf(' electron/') > -1;
  }

  /**
   * Check if running in Android WebView (legacy detection)
   */
  private _isAndroidWebView(): boolean {
    return !!(window as any).SUPAndroid;
  }

  /**
   * Check if running in iOS browser (not native)
   */
  private _isIOSBrowser(): boolean {
    // Check user agent for iOS devices
    const userAgent = navigator.userAgent;
    const isIOSUserAgent =
      /iPad|iPhone|iPod/.test(userAgent) ||
      // iPad on iOS 13+ reports as Mac with touch support
      (userAgent.includes('Mac') && 'ontouchend' in document);

    return isIOSUserAgent;
  }
}
