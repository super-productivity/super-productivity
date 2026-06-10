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
  shortcutLabel: string;
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

const MOD = IS_MAC ? '⌘' : 'Ctrl';

export const MARKDOWN_SHORTCUTS: MarkdownShortcut[] = [
  {
    name: 'bold',
    translationKey: 'BOLD',
    shortcutLabel: `${MOD}+B`,
    key: 'b',
    shiftKey: false,
  },
  {
    name: 'italic',
    translationKey: 'ITALIC',
    shortcutLabel: `${MOD}+I`,
    key: 'i',
    shiftKey: false,
  },
  {
    name: 'link',
    translationKey: 'INSERT_LINK',
    shortcutLabel: `${MOD}+K`,
    key: 'k',
    shiftKey: false,
  },
  {
    name: 'strikethrough',
    translationKey: 'STRIKETHROUGH',
    shortcutLabel: `${MOD}+Shift+S`,
    key: 's',
    shiftKey: true,
  },
  {
    name: 'bullet',
    translationKey: 'BULLET_LIST',
    shortcutLabel: `${MOD}+Shift+8`,
    shiftKey: true,
    code: 'Digit8',
  },
  {
    name: 'numbered',
    translationKey: 'NUMBERED_LIST',
    shortcutLabel: `${MOD}+Shift+7`,
    shiftKey: true,
    code: 'Digit7',
  },
  {
    name: 'quote',
    translationKey: 'QUOTE',
    shortcutLabel: `${MOD}+Shift+9`,
    shiftKey: true,
    code: 'Digit9',
  },
  {
    name: 'code',
    translationKey: 'INLINE_CODE',
    shortcutLabel: `${MOD}+E`,
    key: 'e',
    shiftKey: false,
  },
];
