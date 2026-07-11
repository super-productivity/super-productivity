import { InjectionToken } from '@angular/core';
import { IS_ANDROID_WEB_VIEW } from './util/is-android-web-view';
import { IS_IOS_NATIVE } from './util/is-native-platform';

export const IS_ELECTRON = navigator.userAgent.toLowerCase().indexOf(' electron/') > -1;

/**
 * Injection token for IS_ELECTRON to enable testing.
 * New DI-tested effects/services should prefer this token over the IS_ELECTRON
 * constant to ensure testability and prevent logic drift.
 */
export const IS_ELECTRON_TOKEN = new InjectionToken<boolean>('IS_ELECTRON', {
  providedIn: 'root',
  factory: () => IS_ELECTRON,
});
// effectively IS_BROWSER
export const IS_WEB_BROWSER = !IS_ELECTRON && !IS_ANDROID_WEB_VIEW;
// Only GNOME+Wayland force-disables the custom title bar (the Window-Controls-
// Overlay won't render there). Mirrors electron/common.const.ts so the renderer
// and main process agree. See global-theme.service.ts / main-window.ts.
// (window.ea.isGnomeDesktop() still exists on the bridge for plugin use.)
export const IS_GNOME_WAYLAND = IS_ELECTRON && window.ea.isGnomeWayland();
// True only inside the Electron build — preload exposes process.arch.
// Web builds can't reliably distinguish Apple Silicon from Intel and stay false.
export const IS_APPLE_SILICON = IS_ELECTRON && window.ea.isAppleSilicon();
interface DonationUiPlatformContext {
  isIosNative: boolean;
  isElectron: boolean;
  isMacOS: boolean;
}

export const isDonationUiRestricted = ({
  isIosNative,
  isElectron,
  isMacOS,
}: DonationUiPlatformContext): boolean => isIosNative || (isElectron && isMacOS);

// Apple's App Store guidelines forbid donation/contribution links that route
// around In-App Purchase (Guideline 3.1.1). Apply the restriction to every
// macOS Electron build so App Store, direct-download and local review behavior
// cannot diverge based on the unreliable process.mas signal.
export const IS_DONATION_UI_RESTRICTED = isDonationUiRestricted({
  isIosNative: IS_IOS_NATIVE,
  isElectron: IS_ELECTRON,
  isMacOS: IS_ELECTRON && window.ea.isMacOS(),
});

export const IS_DONATION_UI_RESTRICTED_TOKEN = new InjectionToken<boolean>(
  'IS_DONATION_UI_RESTRICTED',
  {
    providedIn: 'root',
    factory: () => IS_DONATION_UI_RESTRICTED,
  },
);

export const TRACKING_INTERVAL = 1000;

export const DRAG_DELAY_FOR_TOUCH = 500;

// Maximum wall-clock gap credited on iOS resume when the WebView was suspended
// in the background. Larger gaps are capped to this value so an overnight
// charge can't silently add 8 h to the active task.
export const MOBILE_BACKGROUND_IDLE_CAP_MS = 4 * 60 * 60 * 1000;

// Maximum wall-clock gap credited to generic tick$ consumers (running
// stopwatch counters, break tracking) when the Android tick interval — paused
// while backgrounded (#8243) — restarts on resume. Deliberately more generous
// than the iOS cap above (a stopwatch left running through a workday away
// from the app keeps counting): unlike iOS, the active task is unaffected by
// this cap either way, since it reconciles from the native foreground-service
// counter.
export const ANDROID_BACKGROUND_TICK_CAP_MS = 8 * 60 * 60 * 1000;

// TODO use
// const CORS_SKIP_EXTRA_HEADER_PROP = 'sp_cors_skip' as const;
// export const CORS_SKIP_EXTRA_HEADERS: { [name: string]: string } = IS_ANDROID_WEB_VIEW
//   ? ({
//       [CORS_SKIP_EXTRA_HEADER_PROP]: 'true',
//     } as const)
//   : {};
export const CORS_SKIP_EXTRA_HEADERS: { [name: string]: string } = IS_ANDROID_WEB_VIEW
  ? {}
  : {};

export enum BodyClass {
  isElectron = 'isElectron',
  isWeb = 'isWeb',
  isMac = 'isMac',
  isNoMac = 'isNoMac',
  isNoFirefox = 'isNoFirefox',
  isExtension = 'isExtension',
  isAdvancedFeatures = 'isAdvancedFeatures',
  isNoAdvancedFeatures = 'isNoAdvancedFeatures',
  isTouchOnly = 'isTouchOnly',
  isNoTouchOnly = 'isNoTouchOnly',

  isTouchPrimary = 'isTouchPrimary',
  isMousePrimary = 'isMousePrimary',
  isLightTheme = 'isLightTheme',
  isDarkTheme = 'isDarkTheme',
  isDisableBackgroundTint = 'isDisableBackgroundTint',
  isDisableAnimations = 'isDisableAnimations',
  isObsidianStyleHeader = 'isObsidianStyleHeader',
  isVerticalActionBar = 'isVerticalActionBar',
  isDataImportInProgress = 'isDataImportInProgress',
  hasBgImage = 'hasBgImage',
  hasMobileBottomNav = 'hasMobileBottomNav',

  isAndroidKeyboardShown = 'isAndroidKeyboardShown',
  isAndroidKeyboardHidden = 'isAndroidKeyboardHidden',
  isFullScreen = 'isFullScreen',
  isAddTaskBarOpen = 'isAddTaskBarOpen',
  isMaterialSymbolsLoaded = 'isMaterialSymbolsLoaded',

  // iOS-specific classes
  isIOS = 'isIOS',
  isIPad = 'isIPad',
  isNativeMobile = 'isNativeMobile',
  isKeyboardVisible = 'isKeyboardVisible',
}

export enum HelperClasses {
  isHideForAdvancedFeatures = 'isHideForAdvancedFeatures',
  isHideForNoAdvancedFeatures = 'isHideForNoAdvancedFeatures',
}

/* eslint-disable @typescript-eslint/naming-convention */
export enum THEME_COLOR_MAP {
  'light-blue' = '#03a9f4',
  'pink' = '#e91e63',
  'indigo' = '#3f51b5',
  'purple' = '#9c27b0',
  'deep-purple' = '#673ab7',
  'blue' = '#2196f3',
  'cyan' = '#00bcd4',
  'teal' = '#009688',
  'green' = '#4caf50',
  'light-green' = '#8bc34a',
  'lime' = '#cddc39',
  'yellow' = '#ffeb3b',
  'amber' = '#ffc107',
  'orange' = '#ff9800',
  'deep-orange' = '#ff5722',
  'brown' = '#795548',
  'grey' = '#9e9e9e',
  'blue-grey' = '#607d8b',
}

export const HANDLED_ERROR_PROP_STR = 'HANDLED_ERROR_PROP';

/**
 * Constants representing history state keys.
 * Used in the `window.history.pushState/replaceState` methods when opening an overlay
 * that can later be closed by pressing the "back" button in the browser or mobile app.
 *
 * ATTENTION: `window.history.state` can be `null`.
 * Always use optional chaining: `window.history.state?.[HISTORY_STATE.MOBILE_NAVIGATION]`
 */
export const HISTORY_STATE = {
  MOBILE_NAVIGATION: 'mobileSideNav',
  TASK_DETAIL_PANEL: 'taskDetailPanel',
  DIALOG_FULLSCREEN_MARKDOWN: 'dialogFullscreenMarkdown',
  NOTES: 'notes',
};
