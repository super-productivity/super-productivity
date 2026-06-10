import { IS_MAC } from 'src/app/util/is-mac';

export type ShortcutNames =
  | 'bold'
  | 'italic'
  | 'link'
  | 'strikethrough'
  | 'bullet'
  | 'numbered'
  | 'code'
  | 'quote';

type BaseShortcut = {
  name: ShortcutNames;
  translationKey: string;
  shiftKey: boolean;
};

type ShortcutWithKey = BaseShortcut & {
  key: string;
  code?: never;
};

type ShortcutWithCode = BaseShortcut & {
  code: string;
  key?: never;
};

export type MarkdownShortcut = ShortcutWithKey | ShortcutWithCode;

export type ShortcutLabel = Record<ShortcutNames, { keys: string[]; tooltip: string }>;
export const MOD = IS_MAC ? 'Cmd' : 'Ctrl';

export const MARKDOWN_SHORTCUTS: MarkdownShortcut[] = [
  {
    name: 'bold',
    translationKey: 'BOLD',
    key: 'b',
    shiftKey: false,
  },
  {
    name: 'italic',
    translationKey: 'ITALIC',
    key: 'i',
    shiftKey: false,
  },
  {
    name: 'link',
    translationKey: 'INSERT_LINK',
    key: 'k',
    shiftKey: false,
  },
  {
    name: 'strikethrough',
    translationKey: 'STRIKETHROUGH',
    key: 's',
    shiftKey: true,
  },
  {
    name: 'bullet',
    translationKey: 'BULLET_LIST',
    shiftKey: true,
    code: 'Digit8',
  },
  {
    name: 'numbered',
    translationKey: 'NUMBERED_LIST',
    shiftKey: true,
    code: 'Digit7',
  },
  {
    name: 'quote',
    translationKey: 'QUOTE',
    shiftKey: true,
    code: 'Digit9',
  },
  {
    name: 'code',
    translationKey: 'INLINE_CODE',
    key: 'e',
    shiftKey: false,
  },
];

const isShortcutWithKey = (shortcut: MarkdownShortcut): shortcut is ShortcutWithKey => {
  return shortcut.key !== undefined;
};

const formatKeyDisplay = (shortcut: MarkdownShortcut): string => {
  if (isShortcutWithKey(shortcut)) {
    return shortcut.key.toUpperCase();
  }
  return shortcut.code.replace('Digit', '');
};

export const shortcutLabels = MARKDOWN_SHORTCUTS.reduce((acc, s) => {
  const keys = [MOD, ...(s.shiftKey ? ['Shift'] : []), formatKeyDisplay(s)];
  acc[s.name] = {
    keys,
    tooltip: ` (${keys.join('+')})`,
  };
  return acc;
}, {} as ShortcutLabel);
