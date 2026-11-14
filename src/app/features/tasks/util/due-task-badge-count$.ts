import { combineLatest, Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { skipDuringSyncWindow } from '../../../util/skip-during-sync-window.operator';
import { countDueTasks } from './count-due-tasks';
import { Task } from '../task.model';

type DueTask = Pick<Task, 'isDone' | 'dueDay' | 'dueWithTime'> & {
  parentId?: string | null;
};

/**
 * Shared due-task badge count stream for desktop and mobile.
 * Emits every distinct count, including a leading 0. Platforms whose badge is
 * cleared on quit (desktop) skip that leading 0 themselves; the iOS badge
 * persists across launches, so it must see the 0 to clear a stale number.
 * Must be subscribed from an injection context (skipDuringSyncWindow).
 */
export const createDueTaskBadgeCount$ = (
  tasks$: Observable<readonly DueTask[]>,
  today$: Observable<string | null | undefined>,
  dayOffset$: Observable<number | null | undefined>,
  isEnabled$: Observable<boolean>,
  // Re-evaluate when the sync window opens/closes even if tasks did not change.
  isInSyncWindow$: Observable<boolean>,
  initialSyncGateOpen$: Observable<boolean>,
): Observable<number> =>
  combineLatest([
    tasks$,
    today$,
    dayOffset$,
    isEnabled$,
    isInSyncWindow$,
    initialSyncGateOpen$,
  ]).pipe(
    skipDuringSyncWindow(),
    map(([tasks, today, dayOffset, isEnabled]) =>
      isEnabled && today ? countDueTasks(tasks, today, dayOffset ?? 0) : 0,
    ),
    distinctUntilChanged(),
  );
