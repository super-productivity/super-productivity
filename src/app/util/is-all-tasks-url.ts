/**
 * Single source of truth for "is this the All Tasks route?" (rev. п.8).
 *
 * The `/all-tasks` route already declares `data: { page: 'all-tasks' }`, but
 * three consumers (page title, the work-context effect that switches to the
 * Today context, and — before this PR moved it off NavigationEnd — the main
 * header) each matched the URL on their own. Keep one predicate here so a
 * future route rename only touches one place.
 *
 * Matches the URL pathname only; query/hash are ignored so `/all-tasks#x` works.
 */
export const isAllTasksUrl = (url: string): boolean =>
  /\/all-tasks\/?$/.test(url.split(/[?#]/, 1)[0]);
