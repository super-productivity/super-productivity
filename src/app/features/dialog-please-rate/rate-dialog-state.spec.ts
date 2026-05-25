import {
  RateDialogState,
  applyRateDialogResult,
  loadRateDialogState,
  saveRateDialogState,
  shouldShowRateDialog,
} from './rate-dialog-state';
import { LS } from '../../core/persistence/storage-keys.const';

describe('rate-dialog-state', () => {
  describe('shouldShowRateDialog', () => {
    const fresh: RateDialogState = { lastShownAppStartDay: 0, permanentOptOut: false };

    it('does not show before day 32 on a fresh state', () => {
      expect(shouldShowRateDialog(fresh, 1)).toBe(false);
      expect(shouldShowRateDialog(fresh, 31)).toBe(false);
    });

    it('shows at day 32 on a fresh state', () => {
      expect(shouldShowRateDialog(fresh, 32)).toBe(true);
    });

    it('shows again at day 96 after first tier dismissal', () => {
      const afterFirst: RateDialogState = {
        lastShownAppStartDay: 32,
        permanentOptOut: false,
      };
      expect(shouldShowRateDialog(afterFirst, 33)).toBe(false);
      expect(shouldShowRateDialog(afterFirst, 95)).toBe(false);
      expect(shouldShowRateDialog(afterFirst, 96)).toBe(true);
    });

    it('does not show again after the second tier (96)', () => {
      const afterSecond: RateDialogState = {
        lastShownAppStartDay: 96,
        permanentOptOut: false,
      };
      expect(shouldShowRateDialog(afterSecond, 97)).toBe(false);
      expect(shouldShowRateDialog(afterSecond, 1000)).toBe(false);
    });

    it('never shows when permanentOptOut is true', () => {
      const optedOut: RateDialogState = {
        lastShownAppStartDay: 0,
        permanentOptOut: true,
      };
      expect(shouldShowRateDialog(optedOut, 32)).toBe(false);
      expect(shouldShowRateDialog(optedOut, 96)).toBe(false);
    });

    it('does not show on the same start day it was last shown', () => {
      const sameDay: RateDialogState = {
        lastShownAppStartDay: 32,
        permanentOptOut: false,
      };
      expect(shouldShowRateDialog(sameDay, 32)).toBe(false);
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
      expect(shouldShowRateDialog(afterFirstLater, 96)).toBe(true);
      const afterSecondLater = applyRateDialogResult(afterFirstLater, 'later', 96);
      expect(shouldShowRateDialog(afterSecondLater, 1000)).toBe(false);
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
});
