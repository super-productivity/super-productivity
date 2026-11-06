import { Action } from '@ngrx/store';
import { Task, TaskWithSubTasks } from '../task.model';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { PLAINSPACE_TYPE } from '../../issue/issue.const';
import { INBOX_PROJECT } from '../../project/project.const';
import { isBlankTask } from '../util/is-blank-task';

/** Fixed on purpose: no setting (see docs/plans/2026-10-18-recently-deleted-tasks.md). */
export const RECENTLY_DELETED_RETENTION_DAYS = 30;
export const RECENTLY_DELETED_RETENTION_MS =
  RECENTLY_DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * One deleted task family, kept device-locally. Never synced: it is fed by the
 * delete ops every client already receives.
 */
export interface RecentlyDeletedEntry {
  /** Id of the deleted root task; also the store key. */
  id: string;
  deletedAt: number;
  /** Snapshot of the deleted root task, without `subTasks`. */
  task: Task;
  subTasks: Task[];
}

export const RECENTLY_DELETED_RECORDED_ACTION_TYPES: ReadonlySet<string> = new Set([
  TaskSharedActions.deleteTask.type,
  TaskSharedActions.deleteTasks.type,
  TaskSharedActions.restoreTask.type,
  TaskSharedActions.restoreDeletedTask.type,
]);

const isTaskLike = (value: unknown): value is Task =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as { id?: unknown }).id === 'string' &&
  (value as { id: string }).id !== '';

const stripSubTasks = (task: Task | TaskWithSubTasks): Task => {
  if (!Object.prototype.hasOwnProperty.call(task, 'subTasks')) {
    return task;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { subTasks, ...rest } = task as TaskWithSubTasks;
  return rest;
};

// Plainspace deletes remove the task for the whole Space and always confirm;
// blank tasks get no undo snack either — neither goes to the trash.
export const isRecentlyDeletedTrashable = (task: Task, subTasks: Task[] = []): boolean =>
  task.issueType !== PLAINSPACE_TYPE && !isBlankTask({ ...task, subTasks });

const createEntry = (
  task: Task,
  subTasks: Task[],
  deletedAt: number,
): RecentlyDeletedEntry[] => {
  const root = stripSubTasks(task);
  const cleanSubTasks = subTasks.filter(isTaskLike).map(stripSubTasks);
  return isRecentlyDeletedTrashable(root, cleanSubTasks)
    ? [{ id: root.id, deletedAt, task: root, subTasks: cleanSubTasks }]
    : [];
};

/**
 * Builds trash entries from a `deleteTask` / `deleteTasks` action payload.
 * Works on local and remote (possibly released-client) payloads, so every
 * field is checked rather than trusted.
 */
export const getRecentlyDeletedEntriesFromAction = (
  action: Action,
  deletedAt: number,
): RecentlyDeletedEntry[] => {
  if (action.type === TaskSharedActions.deleteTask.type) {
    const { task } = action as ReturnType<typeof TaskSharedActions.deleteTask>;
    if (!isTaskLike(task)) return [];
    const subTasks = Array.isArray(task.subTasks) ? task.subTasks : [];
    return createEntry(task, subTasks, deletedAt);
  }

  if (action.type === TaskSharedActions.deleteTasks.type) {
    const { taskIds, tasks } = action as ReturnType<typeof TaskSharedActions.deleteTasks>;
    // The upload strips `tasks` from the op (operation-log-upload.service.ts);
    // for remote ops RecentlyDeletedService refills them from pre-apply state.
    if (!Array.isArray(taskIds) || !Array.isArray(tasks)) return [];
    const snapshots = tasks.filter(isTaskLike);
    const byId = new Map(snapshots.map((t) => [t.id, t]));
    const childrenByParentId = new Map<string, Task[]>();
    for (const t of snapshots) {
      if (t.parentId) {
        const siblings = childrenByParentId.get(t.parentId);
        if (siblings) {
          siblings.push(t);
        } else {
          childrenByParentId.set(t.parentId, [t]);
        }
      }
    }
    const deletedIds = new Set(taskIds);
    return taskIds.flatMap((id) => {
      const task = byId.get(id);
      // A subtask deleted together with its parent belongs to the parent's entry.
      if (!task || (task.parentId && deletedIds.has(task.parentId))) return [];
      return createEntry(task, childrenByParentId.get(id) ?? [], deletedAt);
    });
  }

  return [];
};

/** Root ids a restore action brings back, whose trash entries are obsolete. */
export const getRestoredTaskIdsFromAction = (action: Action): string[] => {
  if (
    action.type === TaskSharedActions.restoreTask.type ||
    action.type === TaskSharedActions.restoreDeletedTask.type
  ) {
    const { task } = action as { task?: unknown };
    return isTaskLike(task) ? [task.id] : [];
  }
  return [];
};

export const isRecentlyDeletedEntryExpired = (
  entry: Pick<RecentlyDeletedEntry, 'deletedAt'>,
  now: number,
): boolean => now - entry.deletedAt > RECENTLY_DELETED_RETENTION_MS;

/**
 * Folds recorded actions, in order, into one set of store writes: a restore
 * cancels an earlier delete of the same family in the batch.
 */
export const getRecentlyDeletedChanges = (
  recorded: readonly { action: Action; deletedAt: number }[],
  now: number,
): { puts: RecentlyDeletedEntry[]; deleteIds: string[] } => {
  const changes = new Map<string, RecentlyDeletedEntry | null>();
  for (const { action, deletedAt } of recorded) {
    for (const entry of getRecentlyDeletedEntriesFromAction(action, deletedAt)) {
      if (!isRecentlyDeletedEntryExpired(entry, now)) changes.set(entry.id, entry);
    }
    for (const id of getRestoredTaskIdsFromAction(action)) {
      changes.set(id, null);
    }
  }
  const puts: RecentlyDeletedEntry[] = [];
  const deleteIds: string[] = [];
  changes.forEach((entry, id) => (entry ? puts.push(entry) : deleteIds.push(id)));
  return { puts, deleteIds };
};

/**
 * Payload for the existing, released `restoreTask` action. A deleted subtask
 * comes back as a top-level task in its project: its old parent's subtask
 * order cannot be restored without overwriting later changes. A task whose
 * project is gone or archived comes back in the Inbox, where it is visible
 * (the reducer keeps archived projects as valid owners).
 */
export const getRestoreTaskPayload = (
  entry: RecentlyDeletedEntry,
  isProjectActive: (projectId: string) => boolean = () => true,
): { task: Task; subTasks: Task[] } => ({
  task: {
    ...entry.task,
    parentId: undefined,
    projectId:
      entry.task.projectId && isProjectActive(entry.task.projectId)
        ? entry.task.projectId
        : INBOX_PROJECT.id,
  },
  subTasks: entry.subTasks,
});
