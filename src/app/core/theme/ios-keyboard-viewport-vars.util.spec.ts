import { computeIosKeyboardViewportVars } from './ios-keyboard-viewport-vars.util';

const BASE = 800;
const KEYBOARD = 300;

const compute = (
  overrides: Partial<Parameters<typeof computeIosKeyboardViewportVars>[0]> = {},
): ReturnType<typeof computeIosKeyboardViewportVars> =>
  computeIosKeyboardViewportVars({
    keyboardHeight: KEYBOARD,
    baseHeight: BASE,
    visualViewportHeight: BASE,
    isKeyboardSettled: false,
    isKeyboardFrameUnreliable: false,
    ...overrides,
  });

describe('computeIosKeyboardViewportVars()', () => {
  it('reports the measured viewport and no offset while the keyboard is hidden', () => {
    expect(
      compute({ keyboardHeight: 0, visualViewportHeight: BASE, baseHeight: BASE }),
    ).toEqual({
      visualViewportHeightPx: BASE,
      keyboardOverlayOffsetPx: 0,
      correctedKeyboardHeightPx: null,
    });
  });

  // #9779: predicting the shrink here lifts the fixed add-task bar by a whole
  // keyboard height, and the measured resize a few frames later drops it back.
  it('does not act on the reported frame before the show animation settles', () => {
    expect(compute({ isKeyboardSettled: false })).toEqual({
      visualViewportHeightPx: BASE,
      keyboardOverlayOffsetPx: 0,
      correctedKeyboardHeightPx: null,
    });
  });

  it('follows the viewport once the web view has resized around the keyboard', () => {
    expect(
      compute({ visualViewportHeight: BASE - KEYBOARD, isKeyboardSettled: true }),
    ).toEqual({
      visualViewportHeightPx: BASE - KEYBOARD,
      keyboardOverlayOffsetPx: 0,
      correctedKeyboardHeightPx: null,
    });
  });

  it('follows the viewport even mid-animation, before it settles', () => {
    expect(
      compute({ visualViewportHeight: BASE - KEYBOARD, isKeyboardSettled: false }),
    ).toEqual({
      visualViewportHeightPx: BASE - KEYBOARD,
      keyboardOverlayOffsetPx: 0,
      correctedKeyboardHeightPx: null,
    });
  });

  it('offsets a settled keyboard that never resized the web view', () => {
    expect(compute({ isKeyboardSettled: true })).toEqual({
      visualViewportHeightPx: BASE - KEYBOARD,
      keyboardOverlayOffsetPx: KEYBOARD,
      correctedKeyboardHeightPx: null,
    });
  });

  it('treats a sub-epsilon viewport difference as noise, not a resize', () => {
    expect(
      compute({ visualViewportHeight: BASE - 0.5, isKeyboardSettled: true }),
    ).toEqual({
      visualViewportHeightPx: BASE - KEYBOARD,
      keyboardOverlayOffsetPx: KEYBOARD,
      correctedKeyboardHeightPx: null,
    });
  });

  it('has no viewport to follow when visualViewport is unsupported', () => {
    expect(compute({ visualViewportHeight: undefined, isKeyboardSettled: true })).toEqual(
      {
        visualViewportHeightPx: BASE - KEYBOARD,
        keyboardOverlayOffsetPx: KEYBOARD,
        correctedKeyboardHeightPx: null,
      },
    );
  });

  describe('bogus keyboard frames (#8778)', () => {
    it('corrects --keyboard-height to the measured obscured area', () => {
      expect(
        compute({
          keyboardHeight: BASE * 0.6, // already clamped by the caller
          visualViewportHeight: BASE - 320,
          isKeyboardFrameUnreliable: true,
          isKeyboardSettled: true,
        }).correctedKeyboardHeightPx,
      ).toBe(320);
    });

    it('keeps the clamp on the measured value', () => {
      expect(
        compute({
          keyboardHeight: BASE * 0.6,
          visualViewportHeight: 100,
          isKeyboardFrameUnreliable: true,
          isKeyboardSettled: true,
        }).correctedKeyboardHeightPx,
      ).toBe(BASE * 0.6);
    });

    // The obscured area moves on every frame of the shrink, and --keyboard-height
    // has to stay on :root for its non-overlay consumers — so correcting before
    // the resize settles is a root write per animation frame (#9779).
    it('holds the correction until the resize has settled', () => {
      expect(
        compute({
          keyboardHeight: BASE * 0.6,
          visualViewportHeight: BASE - 320,
          isKeyboardFrameUnreliable: true,
          isKeyboardSettled: false,
        }).correctedKeyboardHeightPx,
      ).toBeNull();
    });

    it('leaves a well-behaved frame alone', () => {
      expect(
        compute({
          visualViewportHeight: BASE - KEYBOARD,
          isKeyboardFrameUnreliable: false,
          isKeyboardSettled: true,
        }).correctedKeyboardHeightPx,
      ).toBeNull();
    });

    it('waits for a measurement before correcting anything', () => {
      expect(
        compute({
          isKeyboardFrameUnreliable: true,
          isKeyboardSettled: true,
        }).correctedKeyboardHeightPx,
      ).toBeNull();
    });
  });
});
