import { inject, Injectable, Injector } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { first } from 'rxjs/operators';
import { TaskLog } from '../../../core/log';
import { Operation } from '../../../op-log/core/operation.types';
import {
  ACTION_TYPE_ALIASES,
  convertOpToAction,
} from '../../../op-log/apply/operation-converter.util';
import { RemoteApplyListener } from '../../../op-log/apply/remote-apply-listener.token';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { Task } from '../task.model';
import { TaskService } from '../task.service';
import { selectTaskEntities } from '../store/task.selectors';
import { selectProjectFeatureState } from '../../project/store/project.selectors';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';
import { truncate } from '../../../util/truncate';
import { RecentlyDeletedStoreService } from './recently-deleted-store.service';
import {
  getRecentlyDeletedChanges,
  getRestoreTaskPayload,
  isRecentlyDeletedEntryExpired,
  RECENTLY_DELETED_RECORDED_ACTION_TYPES,
  RecentlyDeletedEntry,
} from './recently-deleted.util';

type TaskEntities = Readonly<Record<string, Task | undefined>>;

/**
 * Device-local trash for deleted tasks ("Recently deleted").
 *
 * Fed by the delete ops this client sees — local ones via
 * `RecentlyDeletedEffects`, remote ones via `OperationApplierService` (as its
 * `REMOTE_APPLY_LISTENER`) — and
 * restored through the existing `restoreTask` action, so nothing new goes on
 * the sync wire. Best effort: a failure here is logged, never thrown, because
 * the remote path runs inside sync.
 * See docs/plans/2026-10-18-recently-deleted-tasks.md.
 */
@Injectable({
  providedIn: 'root',
})
export class RecentlyDeletedService implements RemoteApplyListener {
  private readonly _store = inject(RecentlyDeletedStoreService);
  private readonly _ngrxStore = inject(Store);
  private readonly _injector = inject(Injector);
  private readonly _taskEntities = this._ngrxStore.selectSignal(selectTaskEntities);
  private readonly _projectState = this._ngrxStore.selectSignal(
    selectProjectFeatureState,
  );
  // Serializes writes so a delete and its restore are applied in order.
  private _queue: Promise<void> = Promise.resolve();
  // Expired entries are also dropped on the first write of a session, so they
  // go even if the trash is never opened.
  private _isPurgedThisSession = false;

  recordAction(
    action: Action,
    deletedAt: number,
    now: number = Date.now(),
  ): Promise<void> {
    return this._enqueue(() => this._write([{ action, deletedAt }], now));
  }

  /**
   * Reads what the trash needs from state while the remote ops have not applied
   * yet, then records the ops whose reducers committed. Never throws: it runs
   * on the sync path, and recording is fire-and-forget.
   */
  beforeRemoteApply(
    ops: readonly Operation[],
  ): (reducerCommittedOps: readonly Operation[]) => void {
    const actionsByOpId = new Map<string, Action>();
    let lookup: TaskLookup | undefined;
    for (const op of ops) {
      if (!RECENTLY_DELETED_RECORDED_ACTION_TYPES.has(getCanonicalActionType(op))) {
        continue;
      }
      try {
        const action = convertOpToAction(op);
        lookup ??= createTaskLookup(this._taskEntities());
        actionsByOpId.set(op.id, withLocalSnapshots(action, lookup));
      } catch (e) {
        TaskLog.err('[RecentlyDeleted] Could not read remote op', { opId: op.id }, e);
      }
    }
    return (committedOps) => {
      if (!actionsByOpId.size) return;
      const now = Date.now();
      const recorded = committedOps.flatMap((op) => {
        const action = actionsByOpId.get(op.id);
        // A sender clock ahead of ours must not keep an entry past retention.
        return action ? [{ action, deletedAt: Math.min(op.timestamp, now) }] : [];
      });
      void this._enqueue(() => this._write(recorded, now));
    };
  }

  /** Non-expired entries, newest first. Drops expired ones as a side effect. */
  async getEntries(now: number = Date.now()): Promise<RecentlyDeletedEntry[]> {
    let entries: RecentlyDeletedEntry[] = [];
    await this._enqueue(async () => {
      const all = await this._store.getAll();
      await this._store.applyChanges(
        [],
        all.filter((entry) => isRecentlyDeletedEntryExpired(entry, now)).map((e) => e.id),
      );
      this._isPurgedThisSession = true;
      entries = all
        .filter((entry) => !isRecentlyDeletedEntryExpired(entry, now))
        .sort((a, b) => b.deletedAt - a.deletedAt);
    });
    return entries;
  }

  /**
   * Restores through the existing `restoreTask` action and confirms with an
   * Undo that deletes it again (back into the trash), so restoring the wrong
   * one of two same-titled tasks is as easy to take back as a delete.
   */
  async restore(entry: RecentlyDeletedEntry): Promise<void> {
    const projects = this._projectState().entities;
    this._ngrxStore.dispatch(
      TaskSharedActions.restoreTask(
        getRestoreTaskPayload(entry, (id) => isActiveProject(projects[id], id)),
      ),
    );
    await this._enqueue(() => this._store.applyChanges([], [entry.id]));
    this._injector.get(SnackService).open({
      type: 'SUCCESS',
      msg: T.F.TASK.D_RECENTLY_DELETED.RESTORED,
      translateParams: { title: truncate(entry.task.title) },
      actionStr: T.G.UNDO,
      actionFn: () => this._deleteAgain(entry.id),
    });
  }

  async empty(now: number = Date.now()): Promise<void> {
    await this._enqueue(() => this._store.clear(now));
  }

  private _deleteAgain(id: string): void {
    // Resolved on use: this service is also reached from the op-log apply path.
    const taskService = this._injector.get(TaskService);
    taskService
      .getByIdWithSubTaskData$(id)
      .pipe(first())
      .subscribe((task) => {
        if (task) taskService.remove(task);
      });
  }

  private async _write(
    recorded: readonly { action: Action; deletedAt: number }[],
    now: number,
  ): Promise<void> {
    const changes = getRecentlyDeletedChanges(recorded, now);
    const { deleteIds } = changes;
    // A USE_REMOTE replay re-applies old deletes: keep emptied ones out.
    const emptiedAt = this._store.getEmptiedAt();
    const puts = changes.puts.filter((entry) => entry.deletedAt > emptiedAt);
    const isPurging =
      !this._isPurgedThisSession && (puts.length > 0 || deleteIds.length > 0);
    if (isPurging) {
      const all = await this._store.getAll();
      // Deletes run after puts, so a re-deleted task must not be purged here.
      const putIds = new Set(puts.map((entry) => entry.id));
      all.forEach((entry) => {
        if (isRecentlyDeletedEntryExpired(entry, now) && !putIds.has(entry.id)) {
          deleteIds.push(entry.id);
        }
      });
    }
    await this._store.applyChanges(puts, deleteIds);
    // Only once it is written: a failed write purges again next time.
    if (isPurging) this._isPurgedThisSession = true;
  }

  private _enqueue(fn: () => Promise<void>): Promise<void> {
    const next = this._queue.then(fn).catch((e) => {
      TaskLog.err('[RecentlyDeleted] Trash storage failed', e);
    });
    this._queue = next;
    return next;
  }
}

interface TaskLookup {
  get(id: unknown): Task | undefined;
  childrenOf(parentId: string): Task[];
}

const getCanonicalActionType = (op: Operation): string =>
  ACTION_TYPE_ALIASES[op.actionType] ?? op.actionType;

// Op-supplied ids index into a plain object: check the hit is really that task.
const isActiveProject = (
  project: { id: string; isArchived?: boolean } | undefined,
  id: string,
): boolean => project?.id === id && !project.isArchived;

const createTaskLookup = (entities: TaskEntities): TaskLookup => {
  let childrenByParentId: Map<string, Task[]> | undefined;
  const get = (id: unknown): Task | undefined => {
    const task = typeof id === 'string' ? entities[id] : undefined;
    return task?.id === id ? task : undefined;
  };
  return {
    get,
    // Built on first use. The delete reducer also removes subtasks found only
    // by their parentId (deleteTaskHelper), so they must be trashed too.
    childrenOf: (parentId) => {
      if (!childrenByParentId) {
        childrenByParentId = new Map();
        for (const task of Object.values(entities)) {
          if (!task?.parentId) continue;
          const siblings = childrenByParentId.get(task.parentId);
          if (siblings) siblings.push(task);
          else childrenByParentId.set(task.parentId, [task]);
        }
      }
      return childrenByParentId.get(parentId) ?? [];
    },
  };
};

/**
 * Completes a remote delete from this device's pre-apply state:
 * - `deleteTasks` arrives without `tasks` (the upload strips them), so the
 *   deleted tasks and their subtasks are read from state;
 * - `deleteTask` carries the sender's subtasks; subtasks only this device has
 *   are deleted with it, so they are added.
 * The snapshot is taken once per batch, before any of its ops apply.
 */
const withLocalSnapshots = (action: Action, lookup: TaskLookup): Action => {
  if (action.type === TaskSharedActions.deleteTasks.type) {
    const { taskIds, tasks } = action as { taskIds?: unknown; tasks?: unknown };
    if (Array.isArray(tasks) || !Array.isArray(taskIds)) return action;
    const snapshots = new Map<string, Task>();
    for (const id of taskIds) {
      const task = lookup.get(id);
      if (!task) continue;
      snapshots.set(task.id, task);
      for (const subTask of lookup.childrenOf(task.id)) {
        snapshots.set(subTask.id, subTask);
      }
    }
    return { ...action, tasks: [...snapshots.values()] } as Action;
  }

  if (action.type === TaskSharedActions.deleteTask.type) {
    const { task } = action as { task?: { id?: unknown; subTasks?: unknown } };
    if (!task || typeof task.id !== 'string') return action;
    const sent = Array.isArray(task.subTasks) ? (task.subTasks as Task[]) : [];
    const sentIds = new Set(sent.map((t) => t?.id));
    const localOnly = lookup.childrenOf(task.id).filter((t) => !sentIds.has(t.id));
    if (!localOnly.length) return action;
    return { ...action, task: { ...task, subTasks: [...sent, ...localOnly] } } as Action;
  }

  return action;
};
