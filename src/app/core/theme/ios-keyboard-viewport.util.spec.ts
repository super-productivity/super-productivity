import { resolveIosKeyboardViewport } from './ios-keyboard-viewport.util';

describe('resolveIosKeyboardViewport', () => {
  it('uses the sanitized plugin height until VisualViewport exposes the keyboard', () => {
    const result = resolveIosKeyboardViewport({
      baseHeight: 812,
      keyboardHeight: 300,
      isKeyboardVisible: true,
      visualViewportHeight: 812,
    });

    expect(result.viewportHeight).toBe(512);
    expect(result.keyboardOffset).toBe(300);
  });

  it('prefers measured geometry over a plausible but incorrect plugin height', () => {
    const result = resolveIosKeyboardViewport({
      baseHeight: 812,
      keyboardHeight: 75,
      isKeyboardVisible: true,
      visualViewportHeight: 415,
    });

    expect(result.viewportHeight).toBe(415);
    expect(result.keyboardOffset).toBe(397);
  });

  it('uses the visible viewport bottom when the viewport is shifted', () => {
    const result = resolveIosKeyboardViewport({
      baseHeight: 812,
      keyboardHeight: 300,
      isKeyboardVisible: true,
      visualViewportHeight: 482,
      visualViewportOffsetTop: 30,
    });

    expect(result.viewportHeight).toBe(512);
    expect(result.keyboardOffset).toBe(300);
  });

  it('does not apply the plugin-frame ceiling to measured viewport geometry', () => {
    const result = resolveIosKeyboardViewport({
      baseHeight: 375,
      keyboardHeight: 225,
      isKeyboardVisible: true,
      visualViewportHeight: 120,
    });

    expect(result.viewportHeight).toBe(120);
    expect(result.keyboardOffset).toBe(255);
  });

  it('uses measured geometry even when the plugin reports zero', () => {
    const result = resolveIosKeyboardViewport({
      baseHeight: 812,
      keyboardHeight: 0,
      isKeyboardVisible: true,
      visualViewportHeight: 512,
    });

    expect(result.viewportHeight).toBe(512);
    expect(result.keyboardOffset).toBe(300);
  });

  it('uses the current visual viewport when the keyboard is hidden', () => {
    const result = resolveIosKeyboardViewport({
      baseHeight: 812,
      keyboardHeight: 0,
      isKeyboardVisible: false,
      visualViewportHeight: 780,
    });

    expect(result.viewportHeight).toBe(780);
    expect(result.keyboardOffset).toBe(0);
  });
});
