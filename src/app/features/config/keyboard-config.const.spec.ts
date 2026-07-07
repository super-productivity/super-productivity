import {
  EMPTY_KEYBOARD_CONFIG,
  KeyboardConfig,
  keyboardConfigOrEmpty,
} from '@sp/keyboard-config';

describe('keyboardConfigOrEmpty', () => {
  it('returns EMPTY_KEYBOARD_CONFIG for undefined', () => {
    expect(keyboardConfigOrEmpty(undefined)).toBe(EMPTY_KEYBOARD_CONFIG);
  });

  it('returns a referentially-stable empty config across calls', () => {
    expect(keyboardConfigOrEmpty(undefined)).toBe(keyboardConfigOrEmpty(undefined));
  });

  it('returns the same reference for a provided config', () => {
    const someKb: KeyboardConfig = { addNewTask: 'n' };
    expect(keyboardConfigOrEmpty(someKb)).toBe(someKb);
  });

  it('EMPTY_KEYBOARD_CONFIG is frozen', () => {
    expect(Object.isFrozen(EMPTY_KEYBOARD_CONFIG)).toBe(true);
  });
});
