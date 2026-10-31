import { T } from '../../t.const';
import { NAV_SECTION_ICON } from '../../core-ui/magic-side-nav/nav-section-icons.const';
import { OnboardingStep } from './onboarding-hint.service';
import { QuickTourStep } from './quick-tour.service';

/** Every step the hint chip shows: part 1 tips and the tour's chip steps. */
export type HintStep = OnboardingStep | Exclude<QuickTourStep, 'want-more'>;

export interface HintTargetCtx {
  swipeTargetTaskId: string | null;
  firstTaskId: string | null;
  tourTaskId: string | null;
}

export interface HintMessageCtx {
  isTouch: boolean;
  /** The phone layout: bottom nav, side nav behind ☰ */
  isPhone: boolean;
  isTimeTrackingEnabled: boolean;
}

/** A target, optionally with its own text (e.g. "expand the nav" vs "create one"). */
export interface HintCandidate {
  selector: string;
  message?: string;
  /**
   * Hover-only targets (the nav's +) count as shown while this ancestor is:
   * the pulse reveals them (nav-list-tree.component.scss).
   */
  visibleWith?: string;
}

export interface HintStepConfig {
  /** Candidate targets in order of preference; the first visible one is used. */
  candidates: (ctx: HintTargetCtx) => (string | HintCandidate)[];
  message: (ctx: HintMessageCtx) => string;
  /** Gesture icon shown before the message */
  icon?: string;
  /** Keyboard shortcut shown as "or press …" (never on touch) */
  shortcut?: 'addNewTask' | 'togglePlay';
  /** Pulse the target element to draw attention to it */
  isPulse: boolean;
  /**
   * Point near the start of a wide target (a task row) instead of its center,
   * where the title is.
   */
  isWide?: boolean;
  /**
   * Re-resolve the target while shown: the side nav expanding or the phone
   * drawer opening swaps the best target without a scroll or resize.
   */
  isPolled?: boolean;
  /**
   * End guidance (part 1) or skip the step (tour) when no target shows up.
   * Part 1's first steps wait instead, but an invisible later tip would keep
   * onboarding "in progress", which holds back the install prompt, sync
   * reminder and task snacks.
   */
  isEndedWhenMissing?: boolean;
  /** Footer buttons: the tour offer, or the tour's Next */
  actions?: 'offer' | 'next';
}

/** Icons rendered inline in tip text, so the words match an icon-only nav. */
const icon = (name: string): string =>
  `<span class="material-icons inline-icon" aria-hidden="true">${name}</span>`;

export const HINT_ICON_PARAMS: Record<string, string> = {
  todayIcon: icon('wb_sunny'),
  inboxIcon: icon('inbox'),
  playIcon: icon('play_arrow'),
  subtaskIcon: icon('playlist_add'),
  plannerIcon: icon(NAV_SECTION_ICON.PLANNER),
  expandIcon: icon('chevron_right'),
};

/** Same params without markup, for the screen reader announcement. */
export const HINT_ICON_PARAMS_EMPTY: Record<string, string> = Object.fromEntries(
  Object.keys(HINT_ICON_PARAMS).map((key) => [key, '']),
);

const NAV_GROUP_ROW = '.g-multi-btn-wrapper';

// The host is display: contents and has no box to point at.
const PAGE_TITLE = 'page-title .page-title';

const UNDONE_TASK_ROW_SELECTOR = 'task-list .task-list-inner > task:not(.isDone)';

const taskRow = (taskId: string | null): string =>
  taskId ? `task[data-task-id="${CSS.escape(taskId)}"]` : UNDONE_TASK_ROW_SELECTOR;

/** The task's own first line: its subtasks render inside the same element. */
const taskFirstLine = (taskId: string | null): string[] =>
  taskId
    ? [`${taskRow(taskId)} > swipe-block > .inner-wrapper > .first-line`, taskRow(taskId)]
    : [];

const firstTaskInboxChip = (firstTaskId: string | null): string[] =>
  firstTaskId ? [`${taskRow(firstTaskId)} tag-list tag`] : [];

export const HINT_STEP_CONFIGS = new Map<HintStep, HintStepConfig>([
  [
    'create-task',
    {
      // The header + on wide layouts, the bottom-nav + at phone width. Which one
      // exists follows the layout, not the input: a mouse in a narrow window, or a
      // touch device that switches to a mouse, only has the bottom-nav +.
      candidates: () => ['.tour-addBtn', '.add-task-button'],
      message: ({ isTouch }) =>
        isTouch ? T.ONBOARDING.HINTS.CREATE_TASK_TOUCH : T.ONBOARDING.HINTS.CREATE_TASK,
      shortcut: 'addNewTask',
      isPulse: true,
    },
  ],
  // Phones only. Anchored to the task row; task.component itself is untouched.
  [
    'task-swipe-left',
    {
      candidates: ({ swipeTargetTaskId }) => [taskRow(swipeTargetTaskId)],
      message: () => T.ONBOARDING.HINTS.TASK_SWIPE_LEFT_TOUCH,
      icon: 'swipe_left',
      isPulse: false,
    },
  ],
  [
    'today-and-inbox',
    {
      // The "Inbox" chip of the first task, which the tip explains (#8824).
      candidates: ({ firstTaskId }) => firstTaskInboxChip(firstTaskId),
      // On the phone layout the Inbox is behind the menu button.
      message: ({ isPhone }) =>
        isPhone
          ? T.ONBOARDING.HINTS.TODAY_AND_INBOX_PHONE
          : T.ONBOARDING.HINTS.TODAY_AND_INBOX,
      isEndedWhenMissing: true,
      isPulse: false,
      actions: 'offer',
    },
  ],
  [
    'quick-tour-offer',
    {
      // Shown on whatever page the user moved on to.
      candidates: () => [PAGE_TITLE],
      message: () => T.ONBOARDING.HINTS.MORE_FALLBACK,
      isEndedWhenMissing: true,
      isPulse: false,
      actions: 'offer',
    },
  ],
  [
    'quick-tour-declined',
    {
      candidates: ({ firstTaskId }) => [...firstTaskInboxChip(firstTaskId), PAGE_TITLE],
      message: () => T.ONBOARDING.HINTS.DECLINED,
      isEndedWhenMissing: true,
      isPulse: false,
    },
  ],
  // ▶ renders only on hover, so the tour points at the row (#hot path: the
  // task component is not touched for this).
  [
    'track-time',
    {
      candidates: ({ tourTaskId }) => taskFirstLine(tourTaskId),
      message: () => T.ONBOARDING.TOUR.TRACK_TIME,
      shortcut: 'togglePlay',
      isWide: true,
      isEndedWhenMissing: true,
      isPulse: false,
      actions: 'next',
    },
  ],
  [
    'add-subtask',
    {
      candidates: ({ tourTaskId }) => taskFirstLine(tourTaskId),
      message: () => T.ONBOARDING.TOUR.ADD_SUBTASK,
      isWide: true,
      isEndedWhenMissing: true,
      isPulse: false,
      actions: 'next',
    },
  ],
  [
    'task-menu',
    {
      candidates: ({ tourTaskId }) => taskFirstLine(tourTaskId),
      message: ({ isTimeTrackingEnabled }) =>
        isTimeTrackingEnabled
          ? T.ONBOARDING.TOUR.TASK_MENU_TOUCH
          : T.ONBOARDING.TOUR.TASK_MENU_TOUCH_NO_TRACKING,
      icon: 'swipe_left',
      isWide: true,
      isEndedWhenMissing: true,
      isPulse: false,
      actions: 'next',
    },
  ],
  [
    'organize',
    {
      // The + shows only with labels: a collapsed nav points at its expand
      // toggle, a phone at ☰, then at the + once the nav or drawer opens.
      candidates: () => [
        {
          selector: '.nav-sidenav.mobile [data-nav-btn="add-tag"]',
          message: T.ONBOARDING.TOUR.ORGANIZE,
          visibleWith: NAV_GROUP_ROW,
        },
        {
          selector: '[data-nav-btn="add-project"]',
          message: T.ONBOARDING.TOUR.ORGANIZE,
          visibleWith: NAV_GROUP_ROW,
        },
        {
          selector: 'magic-side-nav .mode-toggle[aria-expanded="false"]',
          message: T.ONBOARDING.TOUR.ORGANIZE_COLLAPSED,
        },
        { selector: '.tour-navMenuBtn', message: T.ONBOARDING.TOUR.ORGANIZE_PHONE },
      ],
      message: () => T.ONBOARDING.TOUR.ORGANIZE,
      isPolled: true,
      isEndedWhenMissing: true,
      isPulse: true,
      actions: 'next',
    },
  ],
  [
    'planner',
    {
      candidates: () => ['.tour-planner'],
      message: () => T.ONBOARDING.TOUR.PLANNER,
      isEndedWhenMissing: true,
      isPulse: true,
      actions: 'next',
    },
  ],
]);
