import { LS } from '../../core/persistence/storage-keys.const';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { IS_IOS } from '../../util/is-ios';
import { IS_ELECTRON } from '../../app.constants';
import { getAppVersionStr } from '../../util/get-app-version-str';

// Device-local only. localStorage keys are implicitly excluded from sync exports.
// Length of TRIGGER_TIERS is the prompt cap: at most one prompt per tier, ever.
// Adding a third entry breaks the "don't be annoying" two-prompts-max guarantee.
const TRIGGER_TIERS = [32, 96] as const;

// After a real (unhandled) error we hold the rating prompt for this long, so we
// never ask for a review right after the user hit a crash. Because the tier
// check below stays `>=`, the prompt simply re-fires on the first app start
// after the window elapses — this is a delay, not a cancellation. The signal is
// device-local and stores only a timestamp (never error content). Written by
// GlobalErrorHandler; deliberately NOT fed by error snackbars, which are often
// third-party noise rather than a genuine app failure.
export const ERROR_SUPPRESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const MAINTAINER_EMAIL = 'contact@super-productivity.com';
const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.superproductivity.superproductivity';
const APP_STORE_URL = 'https://apps.apple.com/app/id1482572463';
const HOW_TO_RATE_URL =
  'https://github.com/super-productivity/super-productivity/blob/master/docs/how-to-rate.md';
export const DISCUSSIONS_URL =
  'https://github.com/super-productivity/super-productivity/discussions/new';
export const CONTRIBUTING_URL =
  'https://github.com/super-productivity/super-productivity/blob/master/CONTRIBUTING.md';

export interface RateDialogState {
  lastShownAppStartDay: number;
  permanentOptOut: boolean;
}

export type RateDialogResult = 'rate' | 'feedback' | 'later' | 'never';

const DEFAULT_STATE: RateDialogState = {
  lastShownAppStartDay: 0,
  permanentOptOut: false,
};

export const loadRateDialogState = (): RateDialogState => {
  try {
    const raw = localStorage.getItem(LS.RATE_DIALOG_STATE);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<RateDialogState>;
    return {
      lastShownAppStartDay:
        typeof parsed.lastShownAppStartDay === 'number' ? parsed.lastShownAppStartDay : 0,
      permanentOptOut: parsed.permanentOptOut === true,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
};

export const saveRateDialogState = (state: RateDialogState): void => {
  localStorage.setItem(LS.RATE_DIALOG_STATE, JSON.stringify(state));
};

export const shouldShowRateDialog = (
  state: RateDialogState,
  currentAppStarts: number,
  msSinceLastCriticalError: number,
): boolean => {
  if (state.permanentOptOut) return false;
  // Recent crash or data damage → delay (not cancel). Caller passes Infinity
  // when none; see getMsSinceLastCriticalError in util/critical-error-signal.
  if (msSinceLastCriticalError < ERROR_SUPPRESSION_MS) return false;
  if (currentAppStarts <= state.lastShownAppStartDay) return false;
  const nextTier = TRIGGER_TIERS.find((t) => t > state.lastShownAppStartDay);
  return nextTier !== undefined && currentAppStarts >= nextTier;
};

export const applyRateDialogResult = (
  state: RateDialogState,
  result: RateDialogResult | null,
  currentAppStarts: number,
): RateDialogState => {
  // null = ESC / backdrop close. Treat as silent dismiss for cadence purposes —
  // do not pester again until the next tier — but never trigger permanent opt-out.
  if (result === 'rate' || result === 'feedback' || result === 'never') {
    return { lastShownAppStartDay: currentAppStarts, permanentOptOut: true };
  }
  return { ...state, lastShownAppStartDay: currentAppStarts };
};

export interface PrimaryCta {
  labelKey: string;
  url: string;
}

export const getPrimaryCta = (): PrimaryCta => {
  if (IS_ANDROID_WEB_VIEW) {
    return { labelKey: 'F.D_RATE.BTN_RATE_PLAY_STORE', url: PLAY_STORE_URL };
  }
  if (IS_IOS) {
    return { labelKey: 'F.D_RATE.BTN_RATE_APP_STORE', url: APP_STORE_URL };
  }
  return { labelKey: 'F.D_RATE.A_HOW', url: HOW_TO_RATE_URL };
};

const getPlatformLabel = (): string => {
  if (IS_IOS) return 'iOS';
  if (IS_ANDROID_WEB_VIEW) return 'Android';
  if (IS_ELECTRON) {
    const ua = navigator.userAgent;
    if (/Mac|Macintosh/.test(ua)) return 'Electron · macOS';
    if (/Windows/.test(ua)) return 'Electron · Windows';
    if (/Linux/.test(ua)) return 'Electron · Linux';
    return 'Electron';
  }
  return 'Web';
};

export const buildFeedbackMailto = (): string => {
  const subject = 'Super Productivity feedback';
  const body = `What I'd like to share:\n\n\n---\nApp version: ${getAppVersionStr()}\nPlatform: ${getPlatformLabel()}`;
  return `mailto:${MAINTAINER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};
