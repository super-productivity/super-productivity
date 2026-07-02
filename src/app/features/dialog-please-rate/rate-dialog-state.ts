import { LS } from '../../core/persistence/storage-keys.const';
import { IS_ANDROID_WEB_VIEW, IS_F_DROID_APP } from '../../util/is-android-web-view';
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

// After the user chooses "give feedback" we hold off asking to rate for a good
// while — giving feedback means "I have something to say", not "never ask me" —
// but we can't detect when that feedback is actually resolved, so we approximate
// with a long cooldown. Measured in app-start days (same unit as TRIGGER_TIERS);
// the counter increments at most once per calendar day, so this is also a
// wall-clock floor of ~this many days. A feedbacker still gets their one
// remaining tiered prompt afterwards (the ≤2-lifetime cap still holds).
export const FEEDBACK_SUPPRESSION_STARTS = 90;

export const MAINTAINER_EMAIL = 'contact@super-productivity.com';
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
  // App-start day the user last chose "give feedback" (0 = never). Drives the
  // post-feedback cooldown; separate from lastShownAppStartDay so it survives
  // the later tiered prompt bookkeeping.
  feedbackGivenAppStartDay: number;
}

export type RateDialogResult = 'rate' | 'feedback' | 'later' | 'never';

const DEFAULT_STATE: RateDialogState = {
  lastShownAppStartDay: 0,
  permanentOptOut: false,
  feedbackGivenAppStartDay: 0,
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
      feedbackGivenAppStartDay:
        typeof parsed.feedbackGivenAppStartDay === 'number'
          ? parsed.feedbackGivenAppStartDay
          : 0,
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
  // Gave feedback recently → hold off (see FEEDBACK_SUPPRESSION_STARTS). Also a
  // delay, not a cancel: once the window elapses the tier check resumes.
  if (
    state.feedbackGivenAppStartDay > 0 &&
    currentAppStarts < state.feedbackGivenAppStartDay + FEEDBACK_SUPPRESSION_STARTS
  ) {
    return false;
  }
  if (currentAppStarts <= state.lastShownAppStartDay) return false;
  const nextTier = TRIGGER_TIERS.find((t) => t > state.lastShownAppStartDay);
  return nextTier !== undefined && currentAppStarts >= nextTier;
};

export const applyRateDialogResult = (
  state: RateDialogState,
  result: RateDialogResult | null,
  currentAppStarts: number,
): RateDialogState => {
  // Rated or explicitly dismissed forever → never ask again.
  if (result === 'rate' || result === 'never') {
    return { ...state, lastShownAppStartDay: currentAppStarts, permanentOptOut: true };
  }
  // Gave feedback → NOT a permanent opt-out. Advance the tier (this prompt is
  // spent) and start the long feedback cooldown so we don't ask again until it
  // elapses — a feedbacker is engaged and may still rate later.
  if (result === 'feedback') {
    return {
      ...state,
      lastShownAppStartDay: currentAppStarts,
      feedbackGivenAppStartDay: currentAppStarts,
    };
  }
  // 'later' or null (ESC / backdrop / silent dismiss): advance the tier only —
  // do not pester again until the next tier — but never permanently opt out.
  return { ...state, lastShownAppStartDay: currentAppStarts };
};

// "Productive win" thresholds for timing the rating prompt after a positive
// moment rather than on cold launch. A win is: cleared at least half of today's
// tasks (with a floor so finishing 1 of 2 doesn't count) OR got a solid number
// done regardless of list size (so heavy planners who never cross 50% still
// hit a win).
export const RATE_PROGRESS_MIN_DONE = 3;
export const RATE_PROGRESS_ABSOLUTE_DONE = 8;

export const isProgressWin = (doneToday: number, totalToday: number): boolean => {
  if (doneToday >= RATE_PROGRESS_ABSOLUTE_DONE) {
    return true;
  }
  return (
    doneToday >= RATE_PROGRESS_MIN_DONE && totalToday > 0 && doneToday / totalToday >= 0.5
  );
};

export interface PrimaryCta {
  labelKey: string;
  url: string;
}

export const getPrimaryCta = (): PrimaryCta => {
  if (IS_ANDROID_WEB_VIEW) {
    // F-Droid has no store ratings, so point those users at the neutral
    // "how to rate / support" doc instead of the Play listing. The play flavor
    // normally uses the native review card and never reaches this dialog; the
    // Play URL here is only a fallback if the native flow is unavailable.
    if (IS_F_DROID_APP) {
      return { labelKey: 'F.D_RATE.A_HOW', url: HOW_TO_RATE_URL };
    }
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
