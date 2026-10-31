import { combineLatest, Observable } from 'rxjs';
import { distinctUntilChanged, map, skipWhile } from 'rxjs/operators';
import { MiscConfig } from '../../config/global-config.model';
import { skipDuringSyncWindow } from '../../../util/skip-during-sync-window.operator';
import { countDueTasks } from './count-due-tasks';
import { Task } from '../task.model';

type DueTask = Pick<Task, 'isDone' | 'dueDay' | 'dueWithTime'> & {
  parentId?: string | null;
};

/**
 * Shared due-task badge count stream for desktop and mobile.
 * Opt-in: skipWhile(0) so platforms that never enable the setting are never
 * touched. Must be subscribed from an injection context (skipDuringSyncWindow).
 */
export const createDueTaskBadgeCount$ = (
  tasks$: Observable<readonly DueTask[]>,
  today$: Observable<string | null | undefined>,
  dayOffset$: Observable<number | null | undefined>,
  misc$: Observable<Pick<MiscConfig, 'isShowDueTaskBadge'>>,
  // Re-evaluate when the sync window opens/closes even if tasks did not change.
  isInSyncWindow$: Observable<boolean>,
  initialSyncGateOpen$: Observable<boolean>,
): Observable<number> =>
  combineLatest([
    tasks$,
    today$,
    dayOffset$,
    misc$,
    isInSyncWindow$,
    initialSyncGateOpen$,
  ]).pipe(
    skipDuringSyncWindow(),
    map(([tasks, today, dayOffset, misc]) =>
      misc.isShowDueTaskBadge && today ? countDueTasks(tasks, today, dayOffset ?? 0) : 0,
    ),
    distinctUntilChanged(),
    skipWhile((count) => count === 0),
  );
