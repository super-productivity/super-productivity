/**
 * The id of the task row the user actually has focused, read from the DOM (#8851).
 *
 * `TaskFocusService.focusedTaskId` is tracked via focusin/focusout and drifts in
 * both directions — a `focusout` can clear it without a matching `focusin`, and a
 * view change can leave it pointing at a row that no longer holds focus — so
 * anything acting on "the focused task" must not trust it.
 *
 * @param hostSelector the row host to walk up to. `[data-task-id]` also matches
 *   `<planner-task>`, which carries a task id without a live `<task>` component.
 */
export const getDomFocusedTaskId = (hostSelector = 'task'): string | null =>
  (document.activeElement?.closest(hostSelector) as HTMLElement | null)?.getAttribute(
    'data-task-id',
  ) ?? null;
