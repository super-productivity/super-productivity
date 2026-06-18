import { KeyboardLayout } from '../../core/keyboard-layout/keyboard-layout.service';
import { GLOBAL_KEY_CFG_KEYS, KeyboardConfig } from '@sp/keyboard-config';

const QWERTY_CODE_MAP: Record<string, string> = {
  Minus: '-',
  Equal: '+',
  Semicolon: ';',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Quote: "'",
};

/**
 * Maps a single shortcut character to its physical US-QWERTY representation.
 * On macOS, Electron's globalShortcut API registers shortcuts by physical keyboard position
 * (US-QWERTY), regardless of the user's localized keyboard layout.
 * We resolve this by finding the layout key code that produces the user's localized keyName,
 * and mapping that key code back to its physical US-QWERTY character.
 *
 * Note: If multiple key codes map to the same character, the first matching code in the layout
 * map's iteration order will be selected.
 *
 * @see https://github.com/johannesjo/super-productivity/issues/8378
 */
export const mapShortcutToQwerty = (
  shortcut: string | null | undefined,
  layout: KeyboardLayout,
): string | null | undefined => {
  if (!shortcut || !layout || !layout.size) return shortcut;

  let keyName = '';
  let modifiersPart = '';

  if (shortcut.endsWith('++')) {
    keyName = '+';
    modifiersPart = shortcut.slice(0, -1);
  } else if (shortcut === '+') {
    keyName = '+';
    modifiersPart = '';
  } else {
    const parts = shortcut.split('+');
    keyName = parts[parts.length - 1];
    modifiersPart = parts.slice(0, -1).join('+') + (parts.length > 1 ? '+' : '');
  }

  if (!keyName) return shortcut;

  let foundCode: string | null = null;
  for (const [code, val] of layout.entries()) {
    if (val.toUpperCase() === keyName.toUpperCase()) {
      foundCode = code;
      break;
    }
  }

  if (!foundCode) {
    return shortcut;
  }

  let qwertyKey = foundCode;
  if (qwertyKey.startsWith('Key')) {
    qwertyKey = qwertyKey.substring(3);
  } else if (qwertyKey.startsWith('Digit')) {
    qwertyKey = qwertyKey.substring(5);
  } else if (QWERTY_CODE_MAP[qwertyKey]) {
    qwertyKey = QWERTY_CODE_MAP[qwertyKey];
  }

  return modifiersPart + qwertyKey;
};

/**
 * Maps macOS-specific global shortcuts in KeyboardConfig to their US-QWERTY layout equivalents.
 * Only translates properties defined in GLOBAL_KEY_CFG_KEYS (system-wide global shortcuts).
 * On macOS, Electron's globalShortcut API registers shortcuts by physical keyboard position.
 *
 * @see https://github.com/johannesjo/super-productivity/issues/8378
 */
export const mapKeyboardConfigToQwerty = (
  keyboardCfg: KeyboardConfig,
  layout: KeyboardLayout,
): KeyboardConfig => {
  const mappedCfg: Record<string, string | null | undefined> = { ...keyboardCfg };

  for (const key of GLOBAL_KEY_CFG_KEYS) {
    const originalVal = mappedCfg[key];
    if (originalVal) {
      mappedCfg[key] = mapShortcutToQwerty(originalVal, layout);
    }
  }

  return mappedCfg as KeyboardConfig;
};
