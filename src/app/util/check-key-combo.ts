import {
  KeyboardLayoutService,
  KeyboardLayout,
  NavigatorWithKeyboard,
  NavigatorKeyboard,
} from '../core/keyboard-layout/keyboard-layout.service';

// Re-export types for backwards compatibility
export type { KeyboardLayout, NavigatorWithKeyboard, NavigatorKeyboard };

// Just an alias for better readability
export const KEYS = {
  PLUS: {
    code: 'Equal',
    raw: '+',
  },
  MINUS: {
    code: 'Minus',
    raw: '-',
  },
} as const;

/**
 * Module-level reference to the keyboard layout service.
 * Initialized lazily when first accessed.
 */
let _keyboardLayoutService: KeyboardLayoutService | null = null;

/**
 * Sets the keyboard layout service instance.
 * Called from app initialization to connect the service to these utility functions.
 */
export const setKeyboardLayoutService = (service: KeyboardLayoutService): void => {
  _keyboardLayoutService = service;
};

/**
 * @deprecated Use KeyboardLayoutService.layout instead.
 * Provided for backwards compatibility with tests.
 */
export const userKbLayout: KeyboardLayout = new Map();

/**
 * @deprecated Use KeyboardLayoutService.saveUserLayout() instead.
 * Provided for backwards compatibility.
 */
export const saveUserKbLayout = async (): Promise<void> => {
  if (_keyboardLayoutService) {
    await _keyboardLayoutService.saveUserLayout();
  } else {
    // Fallback for when service is not available (e.g., tests without DI)
    if (!('keyboard' in navigator)) return;
    const keyboard = (navigator as NavigatorWithKeyboard).keyboard;
    if (!keyboard) return;
    const kbLayout = await keyboard.getLayoutMap();
    userKbLayout.clear();
    kbLayout.forEach((value, key) => userKbLayout.set(key, value));
  }
};

/**
 * Prepares key code (`event.code` from the keyboard event) so that it can be recognized in `checkKeyCombo()` func.
 *
 * Tries to use user keyboard layout if possible.
 *
 * Removes special prefixes and mapping certain key codes to their corresponding characters.
 *
 * @param code - The key code string to normalize (e.g., "KeyA", "Digit1", "Minus", "Equal").
 * @returns The normalized string representation of the key code (e.g., "A", "1", "-", "+").
 *
 * @example
 * // letters
 * prepareKeyCode("KeyA"); // Returns "A"
 * prepareKeyCode("A"); // Returns "A"
 *
 * // digits
 * prepareKeyCode("Digit1"); // Returns "1"
 * prepareKeyCode("1"); // Returns "1"
 *
 * // minus
 * prepareKeyCode("Minus"); // Returns "-"
 * prepareKeyCode("-"); // Returns "-"
 *
 * // plus
 * prepareKeyCode("Equal"); // Returns "+"
 * prepareKeyCode("+"); // Returns "+"
 */
export const prepareKeyCode = (code: KeyboardEvent['code']): string => {
  const rules: { codeMapping: Record<string, string>; replaces: Record<string, string> } =
    {
      codeMapping: {
        [KEYS.MINUS.code]: KEYS.MINUS.raw,
        [KEYS.PLUS.code]: KEYS.PLUS.raw,
      },
      replaces: {
        Key: '',
        Digit: '',
      },
    };

  // Try to use user keyboard layout mapping - https://developer.mozilla.org/en-US/docs/Web/API/KeyboardLayoutMap
  // Use service layout if available, fall back to deprecated userKbLayout for backwards compat
  const layout = _keyboardLayoutService?.layout ?? userKbLayout;
  if (!rules.codeMapping[code] && layout.size) {
    const foundKey = layout.get(code);
    if (foundKey) code = foundKey.toUpperCase();
  }

  // ! Replace prefixes (that's just the format of `e.code`)
  // - "Key" prefix
  // - "Digit" prefix
  for (const [prefix, replacer] of Object.entries(rules.replaces)) {
    if (code.startsWith(prefix)) code = code.replace(prefix, replacer);
  }

  return rules.codeMapping[code] || code;
};

/**
 * Checks if a specific key combination is pressed during a keyboard event
 *
 * @param ev - The keyboard event to check
 * @param comboToTest - The key combination to test (e.g., "Ctrl+A", "Shift++")
 * @returns `true` if the specified key combination is pressed. Otherwise - `false`
 *
 * @example
 * // Suppose Ctrl and A are pressed
 * checkKeyCombo(event, "Ctrl+A"); // Returns true
 *
 * // Suppose only the "+" key is pressed without modifiers
 * checkKeyCombo(event, "+"); // Returns true
 *
 * // Suppose Shift and A are pressed
 * checkKeyCombo(event, "Ctrl+A"); // Returns false
 */
export const checkKeyCombo = (
  ev: KeyboardEvent,
  comboToTest: string | null | undefined,
): boolean => {
  // NOTE: comboToTest can sometimes be undefined
  if (!comboToTest) return false;

  // Convert to lowercase for better compatibility
  comboToTest = comboToTest.toLowerCase();
  const pressedKey = prepareKeyCode(ev.code).toLowerCase();

  // Status of all modifiers that should be checked
  const modifiersStatus: Record<string, boolean> = {
    ctrl: ev.ctrlKey,
    alt: ev.altKey,
    meta: ev.metaKey,
    shift: ev.shiftKey,
  };

  // Corner case: only "+" key (without any modifiers)
  if (
    comboToTest === KEYS.PLUS.raw &&
    pressedKey === KEYS.PLUS.raw &&
    Object.values(modifiersStatus).every((x) => !x) // No modifiers should be pressed
  ) {
    return true;
  }

  // Corner case: combo includes "+" key (e.g. "Ctrl++")
  const isComboIncludesPlusKey = comboToTest.includes(KEYS.PLUS.raw + KEYS.PLUS.raw);

  // Prepared combo object with separated modifiers list and one key
  const splittedCombo = {
    _splitted: comboToTest.split(KEYS.PLUS.raw).filter((x) => !!x), // Filter to remove empty strings (when combo includes "++", e.g. "Ctrl++")
    get modifiers() {
      return isComboIncludesPlusKey ? this._splitted : this._splitted.slice(0, -1);
    },
    get key() {
      return isComboIncludesPlusKey ? KEYS.PLUS.raw : this._splitted.at(-1);
    },
  };

  const isAllModifiersValid = Object.keys(modifiersStatus).every((modKey) => {
    const isRequiredModifier = splittedCombo.modifiers.includes(modKey);
    return isRequiredModifier
      ? !!modifiersStatus[modKey] // Required modifiers should be pressed
      : !modifiersStatus[modKey]; // Not required modifiers should not be pressed
  });

  const isCorrectKeyPressed = isComboIncludesPlusKey
    ? pressedKey === KEYS.PLUS.raw
    : pressedKey === splittedCombo.key;

  return isAllModifiersValid && isCorrectKeyPressed;
};
