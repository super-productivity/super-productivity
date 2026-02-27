import { IS_ANDROID_WEB_VIEW } from './util/is-android-web-view';

export const IS_ELECTRON = navigator.userAgent.toLowerCase().indexOf(' electron/') > -1;
// effectively IS_BROWSER
export const IS_WEB_BROWSER = !IS_ELECTRON && !IS_ANDROID_WEB_VIEW;

export const TRACKING_INTERVAL = 1000;

export const DRAG_DELAY_FOR_TOUCH = 500;

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
  isDataImportInProgress = 'isDataImportInProgress',
  hasBgImage = 'hasBgImage',
  hasMobileBottomNav = 'hasMobileBottomNav',

  isAndroidKeyboardShown = 'isAndroidKeyboardShown',
  isAndroidKeyboardHidden = 'isAndroidKeyboardHidden',
  isAddTaskBarOpen = 'isAddTaskBarOpen',

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
