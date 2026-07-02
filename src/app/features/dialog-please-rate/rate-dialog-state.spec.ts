import {
  ERROR_SUPPRESSION_MS,
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

describe('rate-dialog-state', () => {
  describe('shouldShowRateDialog', () => {
    const fresh: RateDialogState = { lastShownAppStartDay: 0, permanentOptOut: false };

    it('does not show before day 32 on a fresh state', () => {
      expect(shouldShowRateDialog(fresh, 1, NO_ERR)).toBe(false);
      expect(shouldShowRateDialog(fresh, 31, NO_ERR)).toBe(false);
    });

    it('shows at day 32 on a fresh state', () => {
      expect(shouldShowRateDialog(fresh, 32, NO_ERR)).toBe(true);
    });

    it('shows again at day 96 after first tier dismissal', () => {
      const afterFirst: RateDialogState = {
        lastShownAppStartDay: 32,
        permanentOptOut: false,
      };
      expect(shouldShowRateDialog(afterFirst, 33, NO_ERR)).toBe(false);
      expect(shouldShowRateDialog(afterFirst, 95, NO_ERR)).toBe(false);
      expect(shouldShowRateDialog(afterFirst, 96, NO_ERR)).toBe(true);
    });

    it('does not show again after the second tier (96)', () => {
      const afterSecond: RateDialogState = {
        lastShownAppStartDay: 96,
        permanentOptOut: false,
      };
      expect(shouldShowRateDialog(afterSecond, 97, NO_ERR)).toBe(false);
      expect(shouldShowRateDialog(afterSecond, 1000, NO_ERR)).toBe(false);
    });

    it('never shows when permanentOptOut is true', () => {
      const optedOut: RateDialogState = {
        lastShownAppStartDay: 0,
        permanentOptOut: true,
      };
      expect(shouldShowRateDialog(optedOut, 32, NO_ERR)).toBe(false);
      expect(shouldShowRateDialog(optedOut, 96, NO_ERR)).toBe(false);
    });

    it('does not show on the same start day it was last shown', () => {
      const sameDay: RateDialogState = {
        lastShownAppStartDay: 32,
        permanentOptOut: false,
      };
      expect(shouldShowRateDialog(sameDay, 32, NO_ERR)).toBe(false);
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
        const afterFirst: RateDialogState = {
          lastShownAppStartDay: 32,
          permanentOptOut: false,
        };
        // Within window at day 96: held back.
        expect(shouldShowRateDialog(afterFirst, 96, 0)).toBe(false);
        // Window elapsed by a later start day: shows (tier check stays `>=`).
        expect(shouldShowRateDialog(afterFirst, 100, ERROR_SUPPRESSION_MS)).toBe(true);
      });

      it('permanent opt-out wins even with a recent error in the window', () => {
        const optedOut: RateDialogState = {
          lastShownAppStartDay: 0,
          permanentOptOut: true,
        };
        // Pass a recent error (0 ms ago) so this actually exercises the
        // opt-out-vs-cooldown ordering rather than the no-error path.
        expect(shouldShowRateDialog(optedOut, 32, 0)).toBe(false);
      });

      it('uses a window of at least 30 days', () => {
        expect(ERROR_SUPPRESSION_MS).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000);
      });
    });
  });

  describe('applyRateDialogResult', () => {
    const seen32: RateDialogState = { lastShownAppStartDay: 32, permanentOptOut: false };

    it('sets permanentOptOut on rate', () => {
      const next = applyRateDialogResult(seen32, 'rate', 33);
      expect(next).toEqual({ lastShownAppStartDay: 33, permanentOptOut: true });
    });

    it('sets permanentOptOut on feedback', () => {
      const next = applyRateDialogResult(seen32, 'feedback', 33);
      expect(next).toEqual({ lastShownAppStartDay: 33, permanentOptOut: true });
    });

    it('sets permanentOptOut on never', () => {
      const next = applyRateDialogResult(seen32, 'never', 33);
      expect(next).toEqual({ lastShownAppStartDay: 33, permanentOptOut: true });
    });

    it('only updates lastShownAppStartDay on later (no permanent opt-out yet)', () => {
      const next = applyRateDialogResult(seen32, 'later', 33);
      expect(next).toEqual({ lastShownAppStartDay: 33, permanentOptOut: false });
    });

    it('only updates lastShownAppStartDay on null (ESC / backdrop)', () => {
      const next = applyRateDialogResult(seen32, null, 33);
      expect(next).toEqual({ lastShownAppStartDay: 33, permanentOptOut: false });
    });

    it('two later clicks across tiers result in no further prompts (implicit permanent stop)', () => {
      const fresh: RateDialogState = { lastShownAppStartDay: 0, permanentOptOut: false };
      const afterFirstLater = applyRateDialogResult(fresh, 'later', 32);
      expect(shouldShowRateDialog(afterFirstLater, 96, NO_ERR)).toBe(true);
      const afterSecondLater = applyRateDialogResult(afterFirstLater, 'later', 96);
      expect(shouldShowRateDialog(afterSecondLater, 1000, NO_ERR)).toBe(false);
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
      expect(loadRateDialogState()).toEqual({
        lastShownAppStartDay: 0,
        permanentOptOut: false,
      });
    });

    it('round-trips a state object', () => {
      saveRateDialogState({ lastShownAppStartDay: 96, permanentOptOut: true });
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LS.RATE_DIALOG_STATE,
        JSON.stringify({ lastShownAppStartDay: 96, permanentOptOut: true }),
      );
      expect(loadRateDialogState()).toEqual({
        lastShownAppStartDay: 96,
        permanentOptOut: true,
      });
    });

    it('falls back to defaults on malformed JSON', () => {
      store[LS.RATE_DIALOG_STATE] = '{not-json';
      expect(loadRateDialogState()).toEqual({
        lastShownAppStartDay: 0,
        permanentOptOut: false,
      });
    });

    it('coerces missing or wrong-type fields to defaults', () => {
      store[LS.RATE_DIALOG_STATE] = JSON.stringify({ lastShownAppStartDay: 'oops' });
      expect(loadRateDialogState()).toEqual({
        lastShownAppStartDay: 0,
        permanentOptOut: false,
      });
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
