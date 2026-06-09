export type ShortcutNames =
  | 'bold'
  | 'italic'
  | 'link'
  | 'strikethrough'
  | 'bullet'
  | 'numbered'
  | 'code'
  | 'quote';

interface MarkdownShortcut {
  name: ShortcutNames;
  translationKey: string;
  shortcutLabel: string;
  shiftKey: boolean;
  key: string;
  code?: string;
}

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
    key: '9',
    shiftKey: true,
    code: 'Digit8',
  },
  {
    name: 'numbered',
    translationKey: 'NUMBERED_LIST',
    shortcutLabel: 'Ctrl/Cmd+Shift+7',
    key: '8',
    shiftKey: true,
    code: 'Digit7',
  },
  {
    name: 'quote',
    translationKey: 'QUOTE',
    shortcutLabel: 'Ctrl/Cmd+Shift+9',
    key: '10',
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
