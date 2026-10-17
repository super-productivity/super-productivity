/**
 * Single source of truth for "is this the All Tasks route?" (#8134).
 *
 * The `/all-tasks` route already declares `data: { page: 'all-tasks' }`, but
 * two consumers (the page title and the work-context effect that switches to
 * the Today context) each matched the URL on their own. Keep one predicate here
 * so a future route rename only touches one place.
 *
 * Matches the URL pathname only; query/hash are ignored so `/all-tasks#x` works.
 */
export const isAllTasksUrl = (url: string): boolean =>
  /\/all-tasks\/?$/.test(url.split(/[?#]/, 1)[0]);
