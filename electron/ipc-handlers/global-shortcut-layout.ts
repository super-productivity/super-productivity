import type { KeyboardLayoutSnapshot } from '../../src/app/core/keyboard-layout/keyboard-layout.service';

const KEY_CODE_PREFIX = 'Key';
const PLUS_KEY = '+';

const isLetterKey = (key: string): boolean => /^[A-Z]$/i.test(key);

const parseAccelerator = (
  accelerator: string,
): { modifiers: string[]; key: string } | null => {
  const normalized = accelerator.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.endsWith(PLUS_KEY + PLUS_KEY)) {
    return {
      modifiers: normalized.slice(0, -1).split(PLUS_KEY).filter(Boolean),
      key: PLUS_KEY,
    };
  }

  const parts = normalized.split(PLUS_KEY).filter(Boolean);
  const key = parts.at(-1);

  return key
    ? {
        modifiers: parts.slice(0, -1),
        key,
      }
    : null;
};

const findQwertyKeyForLayoutKey = (
  key: string,
  keyboardLayout: KeyboardLayoutSnapshot,
): string | null => {
  const lowerCaseKey = key.toLowerCase();
  const match = keyboardLayout.find(
    ([code, value]) =>
      code.startsWith(KEY_CODE_PREFIX) &&
      code.length === 4 &&
      value.toLowerCase() === lowerCaseKey,
  );

  return match ? match[0].slice(KEY_CODE_PREFIX.length).toUpperCase() : null;
};

export const normalizeGlobalShortcutForKeyboardLayout = (
  accelerator: string,
  keyboardLayout: KeyboardLayoutSnapshot | undefined,
  isMac = process.platform === 'darwin',
): string => {
  if (!isMac || !keyboardLayout?.length) {
    return accelerator;
  }

  const parsedAccelerator = parseAccelerator(accelerator);

  if (!parsedAccelerator || !isLetterKey(parsedAccelerator.key)) {
    return accelerator;
  }

  const qwertyKey = findQwertyKeyForLayoutKey(parsedAccelerator.key, keyboardLayout);

  if (!qwertyKey) {
    return accelerator;
  }

  return [...parsedAccelerator.modifiers, qwertyKey].join(PLUS_KEY);
};
