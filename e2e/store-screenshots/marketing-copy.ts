/**
 * Single source of truth for the cover/hero slot caption shown on the lead
 * app-store screenshot. Keep it punchy — large type at the top of the
 * capture, with the actual app visible below as proof.
 *
 * If you want to A/B different copy, change here and re-run capture; all
 * spec classes (desktop / mobile / tablet) read these constants.
 */
export const MARKETING_HEADLINE = 'Plan it. Do it. Done.';
export const MARKETING_SUBLINE = 'Tasks, time, focus – all in one place.';

/**
 * Captions for the Google Play "E2" listing experiment (captioned 8-slot phone
 * set, `scenarios/mobile/play-e2.spec.ts`). One message per slot, ~40 chars max;
 * no ratings, awards, rankings or price claims (Play metadata policy).
 */
export const PLAY_E2_CAPTIONS = {
  today: 'Plan it. Do it. Done.',
  schedule: 'Timebox your week',
  pomodoro: 'Focus in Pomodoro blocks',
  timeTracking: 'Track time without a second app',
  integrations: 'Connect Jira, GitHub & more',
  boards: 'Kanban or Eisenhower, your call',
  planner: 'Drag tasks onto your day',
  privacy: 'No account needed. Sync is optional.',
} as const;
