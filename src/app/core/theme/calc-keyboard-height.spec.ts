import { calcKeyboardHeight } from './calc-keyboard-height';

describe('calcKeyboardHeight', () => {
  describe('visualViewport reports the IME (modern WebView, e.g. Android 14)', () => {
    it('returns the obscured area', () => {
      expect(
        calcKeyboardHeight({
          innerHeight: 800,
          visualViewportHeight: 500,
          nativeKeyboardHeight: 0,
          baseInnerHeight: 800,
        }),
      ).toBe(300);
    });
  });

  describe('visualViewport does NOT shrink for the IME (e.g. Android 10)', () => {
    it('falls back to the native height when the viewport did not shrink', () => {
      expect(
        calcKeyboardHeight({
          innerHeight: 800,
          visualViewportHeight: 800, // no shrink → obscured 0
          nativeKeyboardHeight: 300,
          baseInnerHeight: 800,
        }),
      ).toBe(300);
    });

    it('returns 0 while the keyboard is closed', () => {
      expect(
        calcKeyboardHeight({
          innerHeight: 800,
          visualViewportHeight: 800,
          nativeKeyboardHeight: 0,
          baseInnerHeight: 800,
        }),
      ).toBe(0);
    });
  });

  describe('layout viewport shrinks for the IME (adjustResize)', () => {
    it('cancels the native height against the shrink to avoid a double offset', () => {
      // innerHeight already shrank by 300 → bar is already above the IME → 0
      expect(
        calcKeyboardHeight({
          innerHeight: 500,
          visualViewportHeight: 500,
          nativeKeyboardHeight: 300,
          baseInnerHeight: 800,
        }),
      ).toBe(0);
    });

    it('reports only the residual when the shrink is partial', () => {
      expect(
        calcKeyboardHeight({
          innerHeight: 700, // shrank 100 of a 300px keyboard
          visualViewportHeight: 700,
          nativeKeyboardHeight: 300,
          baseInnerHeight: 800,
        }),
      ).toBe(200);
    });
  });

  describe('rotation while the keyboard is closed (regression guard)', () => {
    it('does not report a phantom keyboard from a stale portrait baseline once the baseline is refreshed', () => {
      // Portrait baseline 800, rotated to landscape innerHeight 400, keyboard
      // closed. With a fresh baseline (= current innerHeight) there is no
      // phantom layoutShrink, so the height stays 0.
      expect(
        calcKeyboardHeight({
          innerHeight: 400,
          visualViewportHeight: 400,
          nativeKeyboardHeight: 0,
          baseInnerHeight: 400,
        }),
      ).toBe(0);
    });

    it('reports the keyboard correctly in landscape after the baseline is refreshed', () => {
      expect(
        calcKeyboardHeight({
          innerHeight: 400,
          visualViewportHeight: 400, // no viewport shrink for IME
          nativeKeyboardHeight: 250,
          baseInnerHeight: 400, // refreshed on the close→landscape transition
        }),
      ).toBe(250);
    });

    it('a STALE portrait baseline would have hidden the keyboard (demonstrates the bug the refresh fixes)', () => {
      // baseInnerHeight still 800 (portrait) but we are in landscape (400) with
      // the keyboard open → layoutShrink 400 wipes out the 250px keyboard.
      expect(
        calcKeyboardHeight({
          innerHeight: 400,
          visualViewportHeight: 400,
          nativeKeyboardHeight: 250,
          baseInnerHeight: 800,
        }),
      ).toBe(0);
    });
  });

  describe('visualViewport API absent', () => {
    it('relies solely on the native height', () => {
      expect(
        calcKeyboardHeight({
          innerHeight: 800,
          visualViewportHeight: null,
          nativeKeyboardHeight: 300,
          baseInnerHeight: 800,
        }),
      ).toBe(300);
    });
  });
});
