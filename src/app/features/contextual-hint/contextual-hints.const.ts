import { ContextualHint } from './contextual-hint.model';

export const HINT_IDS = {
  SYNC_SETUP: 'sync-setup',
  KEYBOARD_SHORTCUTS: 'keyboard-shortcuts',
} as const;

export const CONTEXTUAL_HINTS: ContextualHint[] = [
  {
    id: HINT_IDS.SYNC_SETUP,
    icon: 'cloud_upload',
    title: 'Keep your data safe',
    message: 'Set up sync to back up your tasks and access them across devices.',
    maxImpressions: 2,
    actionLabel: 'Set up sync',
    actionRoute: '/config',
  },
  {
    id: HINT_IDS.KEYBOARD_SHORTCUTS,
    icon: 'keyboard',
    title: 'Speed up your workflow',
    message: 'Use keyboard shortcuts to manage tasks faster.',
    maxImpressions: 1,
    actionLabel: 'Learn shortcuts',
    actionTourId: 'KeyboardNav',
  },
];
