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

export const MARKDOWN_SHORTCUTS: MarkdownShortcut[] = [
  {
    name: 'bold',
    translationKey: 'BOLD',
    shortcutLabel: 'Ctrl/Cmd+B',
    key: 'b',
    shiftKey: false,
  },
  {
    name: 'italic',
    translationKey: 'ITALIC',
    shortcutLabel: 'Ctrl/Cmd+I',
    key: 'i',
    shiftKey: false,
  },
  {
    name: 'link',
    translationKey: 'INSERT_LINK',
    shortcutLabel: 'Ctrl/Cmd+K',
    key: 'k',
    shiftKey: false,
  },
  {
    name: 'strikethrough',
    translationKey: 'STRIKETHROUGH',
    shortcutLabel: 'Ctrl/Cmd+Shift+S',
    key: 's',
    shiftKey: true,
  },
  {
    name: 'bullet',
    translationKey: 'BULLET_LIST',
    shortcutLabel: 'Ctrl/Cmd+Shift+8',
    shiftKey: true,
    code: 'Digit8',
  },
  {
    name: 'numbered',
    translationKey: 'NUMBERED_LIST',
    shortcutLabel: 'Ctrl/Cmd+Shift+7',
    shiftKey: true,
    code: 'Digit7',
  },
  {
    name: 'quote',
    translationKey: 'QUOTE',
    shortcutLabel: 'Ctrl/Cmd+Shift+9',
    shiftKey: true,
    code: 'Digit9',
  },
  {
    name: 'code',
    translationKey: 'INLINE_CODE',
    shortcutLabel: 'Ctrl/Cmd+E',
    key: 'e',
    shiftKey: false,
  },
];
