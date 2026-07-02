import {
  ERROR_SUPPRESSION_MS,
  FEEDBACK_SUPPRESSION_STARTS,
  RECURRING_INTERVAL_STARTS,
  RateDialogState,
  applyRateDialogResult,
  isProgressWin,
  loadRateDialogState,
  saveRateDialogState,
  shouldShowRateDialog,
} from './rate-dialog-state';
import { LS } from '../../core/persistence/storage-keys.const';

// No recent error — the common case for the existing tier/opt-out tests.
const NO_ERR = Number.POSITIVE_INFINITY;

// Factory so specs don't have to spell out every field of RateDialogState.
const state = (partial: Partial<RateDialogState> = {}): RateDialogState => ({
  lastShownAppStartDay: 0,
  permanentOptOut: false,
  feedbackGivenAppStartDay: 0,
  ...partial,
});

describe('rate-dialog-state', () => {
  describe('shouldShowRateDialog', () => {
    const fresh = state();

    it('does not show before day 32 on a fresh state', () => {
      expect(shouldShowRateDialog(fresh, 1, NO_ERR)).toBe(false);
      expect(shouldShowRateDialog(fresh, 31, NO_ERR)).toBe(false);
    });

    it('shows at day 32 on a fresh state', () => {
      expect(shouldShowRateDialog(fresh, 32, NO_ERR)).toBe(true);
    });

    it('shows again at day 96 after first tier dismissal', () => {
      const afterFirst = state({ lastShownAppStartDay: 32 });
      expect(shouldShowRateDialog(afterFirst, 33, NO_ERR)).toBe(false);
      expect(shouldShowRateDialog(afterFirst, 95, NO_ERR)).toBe(false);
      expect(shouldShowRateDialog(afterFirst, 96, NO_ERR)).toBe(true);
    });

    it('recurs on a slow cadence after the last fixed tier (not a lifetime cap)', () => {
      const afterSecond = state({ lastShownAppStartDay: 96 });
      const recurDay = 96 + RECURRING_INTERVAL_STARTS;
      expect(shouldShowRateDialog(afterSecond, 97, NO_ERR)).toBe(false);
      expect(shouldShowRateDialog(afterSecond, recurDay - 1, NO_ERR)).toBe(false);
      expect(shouldShowRateDialog(afterSecond, recurDay, NO_ERR)).toBe(true);
    });

    it('keeps recurring at the same interval on each subsequent prompt', () => {
      const afterRecur = state({ lastShownAppStartDay: 96 + RECURRING_INTERVAL_STARTS });
      const nextRecurDay = 96 + RECURRING_INTERVAL_STARTS + RECURRING_INTERVAL_STARTS;
      expect(shouldShowRateDialog(afterRecur, nextRecurDay - 1, NO_ERR)).toBe(false);
      expect(shouldShowRateDialog(afterRecur, nextRecurDay, NO_ERR)).toBe(true);
    });

    it('never shows when permanentOptOut is true', () => {
      const optedOut = state({ permanentOptOut: true });
      expect(shouldShowRateDialog(optedOut, 32, NO_ERR)).toBe(false);
      expect(shouldShowRateDialog(optedOut, 96, NO_ERR)).toBe(false);
    });

    it('does not show on the same start day it was last shown', () => {
      expect(shouldShowRateDialog(state({ lastShownAppStartDay: 32 }), 32, NO_ERR)).toBe(
        false,
      );
    });

    describe('recent-error suppression', () => {
      it('suppresses an otherwise-due prompt during the cooldown window', () => {
        expect(shouldShowRateDialog(fresh, 32, 0)).toBe(false);
        expect(shouldShowRateDialog(fresh, 32, ERROR_SUPPRESSION_MS - 1)).toBe(false);
      });

      it('shows once the cooldown window has elapsed', () => {
        expect(shouldShowRateDialog(fresh, 32, ERROR_SUPPRESSION_MS)).toBe(true);
        expect(shouldShowRateDialog(fresh, 32, ERROR_SUPPRESSION_MS + 1)).toBe(true);
      });

      it('only delays — a later tier still fires after the window passes', () => {
        const afterFirst = state({ lastShownAppStartDay: 32 });
        // Within window at day 96: held back.
        expect(shouldShowRateDialog(afterFirst, 96, 0)).toBe(false);
        // Window elapsed by a later start day: shows (tier check stays `>=`).
        expect(shouldShowRateDialog(afterFirst, 100, ERROR_SUPPRESSION_MS)).toBe(true);
      });

      it('permanent opt-out wins even with a recent error in the window', () => {
        // Pass a recent error (0 ms ago) so this actually exercises the
        // opt-out-vs-cooldown ordering rather than the no-error path.
        expect(shouldShowRateDialog(state({ permanentOptOut: true }), 32, 0)).toBe(false);
      });

      it('uses a window of at least 30 days', () => {
        expect(ERROR_SUPPRESSION_MS).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000);
      });
    });

    describe('post-feedback suppression', () => {
      it('holds the prompt for the whole cooldown after feedback, then resumes', () => {
        // Gave feedback at day 32 (tier 32 consumed). The next tier is 96, but
        // the feedback cooldown must hold it until feedbackGiven + window.
        const afterFeedback = state({
          lastShownAppStartDay: 32,
          feedbackGivenAppStartDay: 32,
        });
        const resumeDay = 32 + FEEDBACK_SUPPRESSION_STARTS;
        expect(shouldShowRateDialog(afterFeedback, 96, NO_ERR)).toBe(false);
        expect(shouldShowRateDialog(afterFeedback, resumeDay - 1, NO_ERR)).toBe(false);
        // Window elapsed AND a tier (96) is due → the one remaining ask fires.
        expect(shouldShowRateDialog(afterFeedback, resumeDay, NO_ERR)).toBe(true);
      });

      it('is a delay, not a permanent opt-out', () => {
        const afterFeedback = state({
          lastShownAppStartDay: 32,
          feedbackGivenAppStartDay: 32,
        });
        expect(afterFeedback.permanentOptOut).toBe(false);
        expect(shouldShowRateDialog(afterFeedback, 1000, NO_ERR)).toBe(true);
      });
    });
  });

  describe('applyRateDialogResult', () => {
    const seen32 = state({ lastShownAppStartDay: 32 });

    it('sets permanentOptOut on rate', () => {
      expect(applyRateDialogResult(seen32, 'rate', 33)).toEqual(
        state({ lastShownAppStartDay: 33, permanentOptOut: true }),
      );
    });

    it('sets permanentOptOut on never', () => {
      expect(applyRateDialogResult(seen32, 'never', 33)).toEqual(
        state({ lastShownAppStartDay: 33, permanentOptOut: true }),
      );
    });

    it('does NOT opt out on feedback — it records the feedback day for a cooldown', () => {
      expect(applyRateDialogResult(seen32, 'feedback', 33)).toEqual(
        state({
          lastShownAppStartDay: 33,
          permanentOptOut: false,
          feedbackGivenAppStartDay: 33,
        }),
      );
    });

    it('only updates lastShownAppStartDay on later (no permanent opt-out yet)', () => {
      expect(applyRateDialogResult(seen32, 'later', 33)).toEqual(
        state({ lastShownAppStartDay: 33 }),
      );
    });

    it('only updates lastShownAppStartDay on null (ESC / backdrop)', () => {
      expect(applyRateDialogResult(seen32, null, 33)).toEqual(
        state({ lastShownAppStartDay: 33 }),
      );
    });

    it('two later clicks walk both fixed tiers, then the prompt recurs slowly', () => {
      const afterFirstLater = applyRateDialogResult(state(), 'later', 32);
      expect(shouldShowRateDialog(afterFirstLater, 96, NO_ERR)).toBe(true);
      const afterSecondLater = applyRateDialogResult(afterFirstLater, 'later', 96);
      // No longer a permanent stop — recurs after the interval.
      expect(shouldShowRateDialog(afterSecondLater, 97, NO_ERR)).toBe(false);
      expect(
        shouldShowRateDialog(afterSecondLater, 96 + RECURRING_INTERVAL_STARTS, NO_ERR),
      ).toBe(true);
    });

    it('feedback then the final tiered prompt, then a rate opts out for good', () => {
      const afterFeedback = applyRateDialogResult(
        state({ lastShownAppStartDay: 32 }),
        'feedback',
        32,
      );
      // remaining tier (96) fires only once the cooldown has elapsed
      const day = 32 + FEEDBACK_SUPPRESSION_STARTS;
      expect(shouldShowRateDialog(afterFeedback, day, NO_ERR)).toBe(true);
      const afterRate = applyRateDialogResult(afterFeedback, 'rate', day);
      expect(shouldShowRateDialog(afterRate, day + 1000, NO_ERR)).toBe(false);
    });
  });

  describe('persistence', () => {
    let store: { [key: string]: string };

    beforeEach(() => {
      store = {};
      spyOn(localStorage, 'getItem').and.callFake((k: string) => store[k] ?? null);
      spyOn(localStorage, 'setItem').and.callFake((k: string, v: string) => {
        store[k] = v;
      });
    });

    it('returns default state when nothing is stored', () => {
      expect(loadRateDialogState()).toEqual(state());
    });

    it('round-trips a state object', () => {
      const s = state({
        lastShownAppStartDay: 96,
        permanentOptOut: true,
        feedbackGivenAppStartDay: 40,
      });
      saveRateDialogState(s);
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LS.RATE_DIALOG_STATE,
        JSON.stringify(s),
      );
      expect(loadRateDialogState()).toEqual(s);
    });

    it('falls back to defaults on malformed JSON', () => {
      store[LS.RATE_DIALOG_STATE] = '{not-json';
      expect(loadRateDialogState()).toEqual(state());
    });

    it('coerces missing or wrong-type fields to defaults', () => {
      store[LS.RATE_DIALOG_STATE] = JSON.stringify({ lastShownAppStartDay: 'oops' });
      expect(loadRateDialogState()).toEqual(state());
    });

    it('defaults feedbackGivenAppStartDay when absent in older stored state', () => {
      store[LS.RATE_DIALOG_STATE] = JSON.stringify({
        lastShownAppStartDay: 32,
        permanentOptOut: false,
      });
      expect(loadRateDialogState()).toEqual(state({ lastShownAppStartDay: 32 }));
    });
  });

  describe('isProgressWin', () => {
    it('fires on the absolute threshold regardless of list size', () => {
      expect(isProgressWin(8, 100)).toBe(true); // 8 done even if only 8% of a big list
      expect(isProgressWin(8, 8)).toBe(true);
    });

    it('fires at >=50% done once the min-done floor is met', () => {
      expect(isProgressWin(3, 6)).toBe(true); // 50%, 3 done
      expect(isProgressWin(5, 6)).toBe(true);
    });

    it('does not fire on the trivial "half of a tiny list" case', () => {
      expect(isProgressWin(1, 2)).toBe(false); // 50% but only 1 done
      expect(isProgressWin(2, 4)).toBe(false); // 50% but below the floor of 3
    });

    it('does not fire below 50% when under the absolute threshold', () => {
      expect(isProgressWin(3, 10)).toBe(false); // 30%
      expect(isProgressWin(7, 20)).toBe(false); // 35%, still < 8 done
    });

    it('handles the empty/zero case', () => {
      expect(isProgressWin(0, 0)).toBe(false);
      expect(isProgressWin(0, 5)).toBe(false);
      expect(isProgressWin(3, 0)).toBe(false); // no divide-by-zero win
    });
  });
});
