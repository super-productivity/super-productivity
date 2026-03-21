import { ContextualHint } from './contextual-hint.model';
import { TourId } from '../shepherd/shepherd-steps.const';
import { T } from '../../t.const';

export const HINT_IDS = {
  SYNC_SETUP: 'sync-setup',
  KEYBOARD_SHORTCUTS: 'keyboard-shortcuts',
} as const;

export const CONTEXTUAL_HINTS: ContextualHint[] = [
  {
    id: HINT_IDS.SYNC_SETUP,
    icon: 'cloud_upload',
    titleKey: T.CONTEXTUAL_HINT.SYNC_TITLE,
    messageKey: T.CONTEXTUAL_HINT.SYNC_MESSAGE,
    maxImpressions: 2,
    actionLabelKey: T.CONTEXTUAL_HINT.SYNC_ACTION,
    actionRoute: '/config?tab=3',
  },
  {
    id: HINT_IDS.KEYBOARD_SHORTCUTS,
    icon: 'keyboard',
    titleKey: T.CONTEXTUAL_HINT.KEYBOARD_TITLE,
    messageKey: T.CONTEXTUAL_HINT.KEYBOARD_MESSAGE,
    maxImpressions: 1,
    actionLabelKey: T.CONTEXTUAL_HINT.KEYBOARD_ACTION,
    actionTourId: TourId.KeyboardNav,
  },
];
