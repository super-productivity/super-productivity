// Distinct from the CalDAV Events plugin's time blocks (`sp-<taskId>@…`):
// both can write to one Nextcloud calendar, where the same UID or resource
// name would let a time block overwrite or delete the task's VTODO.
const PREFIX = 'sp-todo-';
const SUFFIX = '@super-productivity';

/** UID of a VTODO Super Productivity created for a task. */
export const taskIdToCaldavUid = (taskId: string): string =>
  `${PREFIX}${taskId}${SUFFIX}`;

/** The task id a VTODO was created for, or null if SP didn't create it. */
export const caldavUidToTaskId = (uid: string): string | null =>
  uid.length > PREFIX.length + SUFFIX.length &&
  uid.startsWith(PREFIX) &&
  uid.endsWith(SUFFIX)
    ? uid.slice(PREFIX.length, -SUFFIX.length)
    : null;
