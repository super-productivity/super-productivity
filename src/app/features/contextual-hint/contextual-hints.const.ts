import { ContextualHint } from './contextual-hint.model';

export const HINT_IDS = {
  SYNC_SETUP: 'sync-setup',
  KEYBOARD_SHORTCUTS: 'keyboard-shortcuts',
  SHORT_SYNTAX: 'short-syntax',
  PLANNER: 'planner',
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
  {
    id: HINT_IDS.SHORT_SYNTAX,
    icon: 'bolt',
    title: 'Create tasks faster',
    message:
      'Use short syntax when adding tasks: +project, #tag, or !1/!2/!3 for priority.',
    maxImpressions: 1,
  },
  {
    id: HINT_IDS.PLANNER,
    icon: 'calendar_month',
    title: 'Plan your week',
    message: 'Drag and drop tasks to specific days in the Planner view.',
    maxImpressions: 1,
    actionLabel: 'Open Planner',
    actionRoute: '/planner',
  },
];
