import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { RecentlyDeletedService } from './recently-deleted.service';
import { RecentlyDeletedStoreService } from './recently-deleted-store.service';
import {
  RECENTLY_DELETED_RETENTION_MS,
  RecentlyDeletedEntry,
} from './recently-deleted.util';
import { createTask } from '../task.test-helper';
import { Task } from '../task.model';
import { Project } from '../../project/project.model';
import { selectProjectFeatureState } from '../../project/store/project.selectors';
import { INBOX_PROJECT } from '../../project/project.const';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { Operation, OpType } from '../../../op-log/core/operation.types';
import { ActionType } from '../../../op-log/core/action-types.enum';
import { SnackService } from '../../../core/snack/snack.service';
import { SnackParams } from '../../../core/snack/snack.model';
import { TaskService } from '../task.service';
import { of } from 'rxjs';

class FakeRecentlyDeletedStore {
  entries = new Map<string, RecentlyDeletedEntry>();
  isFailing = false;
  /** Makes puts slower than deletes, so unordered writes would interleave. */
  putDelayMs = 0;

  async getAll(): Promise<RecentlyDeletedEntry[]> {
    this._maybeFail();
    return [...this.entries.values()];
  }

  async applyChanges(puts: RecentlyDeletedEntry[], deleteIds: string[]): Promise<void> {
    this._maybeFail();
    if (this.putDelayMs && puts.length) {
      await new Promise((r) => setTimeout(r, this.putDelayMs));
    }
    puts.forEach((e) => this.entries.set(e.id, e));
    deleteIds.forEach((id) => this.entries.delete(id));
  }

  emptiedAt = 0;

  getEmptiedAt(): number {
    return this.emptiedAt;
  }

  async clear(emptiedAt: number): Promise<void> {
    this.emptiedAt = emptiedAt;
    this.entries.clear();
  }

  private _maybeFail(): void {
    if (this.isFailing) throw new Error('idb down');
  }
}

const NOW = 1_700_000_000_000;

const deleteAction = (
  id: string,
  title = id,
): ReturnType<typeof TaskSharedActions.deleteTask> =>
  TaskSharedActions.deleteTask({ task: { ...createTask({ id, title }), subTasks: [] } });

const remoteOp = (
  actionType: ActionType,
  payload: Record<string, unknown>,
  timestamp: number,
): Operation =>
  ({
    id: `op-${Math.random()}`,
    actionType,
    opType: OpType.Delete,
    entityType: 'TASK',
    entityId: 'x',
    payload,
    clientId: 'other',
    vectorClock: { other: 1 },
    timestamp,
    schemaVersion: 1,
  }) as Operation;

describe('RecentlyDeletedService', () => {
  let service: RecentlyDeletedService;
  let store: FakeRecentlyDeletedStore;
  let dispatch: jasmine.Spy;
  let taskEntities: Record<string, Task>;
  let projectState: { entities: Record<string, Partial<Project>> };
  let snack: jasmine.SpyObj<SnackService>;
  let taskService: jasmine.SpyObj<TaskService>;

  beforeEach(() => {
    store = new FakeRecentlyDeletedStore();
    dispatch = jasmine.createSpy('dispatch');
    taskEntities = {};
    projectState = { entities: { p1: { id: 'p1' } } };
    snack = jasmine.createSpyObj('SnackService', ['open']);
    taskService = jasmine.createSpyObj('TaskService', [
      'getByIdWithSubTaskData$',
      'remove',
    ]);
    TestBed.configureTestingModule({
      providers: [
        RecentlyDeletedService,
        { provide: RecentlyDeletedStoreService, useValue: store },
        { provide: SnackService, useValue: snack },
        { provide: TaskService, useValue: taskService },
        {
          provide: Store,
          useValue: {
            dispatch,
            selectSignal: (selector: unknown) => () =>
              selector === selectProjectFeatureState ? projectState : taskEntities,
          },
        },
      ],
    });
    service = TestBed.inject(RecentlyDeletedService);
  });

  it('records a delete and drops it again on a later restore', async () => {
    await service.recordAction(deleteAction('a'), NOW, NOW);
    expect([...store.entries.keys()]).toEqual(['a']);

    await service.recordAction(
      TaskSharedActions.restoreTask({ task: createTask({ id: 'a' }), subTasks: [] }),
      NOW,
      NOW,
    );
    expect(store.entries.size).toBe(0);
  });

  it('does not record a delete that is already past the retention', async () => {
    await service.recordAction(
      deleteAction('old'),
      NOW - RECENTLY_DELETED_RETENTION_MS - 1,
      NOW,
    );
    expect(store.entries.size).toBe(0);
  });

  it('returns entries newest first and purges expired ones', async () => {
    await service.recordAction(deleteAction('older'), NOW - 2000, NOW - 2000);
    await service.recordAction(deleteAction('newer'), NOW - 1000, NOW - 1000);
    await service.recordAction(deleteAction('newest'), NOW, NOW);

    const later = NOW + RECENTLY_DELETED_RETENTION_MS - 1500;
    const entries = await service.getEntries(later);

    expect(entries.map((e) => e.id)).toEqual(['newest', 'newer']);
    expect(store.entries.has('older')).toBeFalse();
  });

  it('restores through the existing restoreTask action and removes the entry', async () => {
    await service.recordAction(deleteAction('a', 'Task A'), NOW, NOW);
    const [entry] = await service.getEntries(NOW);

    await service.restore(entry);

    const action = dispatch.calls.mostRecent().args[0];
    expect(action.type).toBe(TaskSharedActions.restoreTask.type);
    expect(action.task.id).toBe('a');
    expect(action.restoreToToday).toBeUndefined();
    expect(store.entries.size).toBe(0);
  });

  it('restores a task whose project was archived into the Inbox', async () => {
    projectState = { entities: { p1: { id: 'p1', isArchived: true } } };
    await service.recordAction(
      TaskSharedActions.deleteTask({
        task: { ...createTask({ id: 'a', title: 'A', projectId: 'p1' }), subTasks: [] },
      }),
      NOW,
      NOW,
    );
    const [entry] = await service.getEntries(NOW);

    await service.restore(entry);

    expect(dispatch.calls.mostRecent().args[0].task.projectId).toBe(INBOX_PROJECT.id);
  });

  it('keeps writes in call order even when a put is slower than a delete', async () => {
    store.putDelayMs = 5;
    const restoreA = TaskSharedActions.restoreTask({
      task: createTask({ id: 'a' }),
      subTasks: [],
    });

    const deleting = service.recordAction(deleteAction('a'), NOW, NOW);
    await service.recordAction(restoreA, NOW, NOW);
    await deleting;

    expect(store.entries.size).toBe(0);
  });

  it('empty() clears the trash without dispatching anything', async () => {
    await service.recordAction(deleteAction('a'), NOW, NOW);
    await service.empty();
    expect(store.entries.size).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  // A USE_REMOTE replay re-applies deletes the user already emptied.
  it('does not record again deletes made before the last empty()', async () => {
    await service.recordAction(deleteAction('a'), NOW - 1000, NOW);
    await service.empty(NOW);

    await service.recordAction(deleteAction('a'), NOW - 1000, NOW + 5);
    await service.recordAction(deleteAction('b'), NOW + 1, NOW + 5);

    expect([...store.entries.keys()]).toEqual(['b']);
  });

  it('restore() offers an Undo that deletes the task again', async () => {
    await service.recordAction(deleteAction('a', 'Task A'), NOW, NOW);
    const [entry] = await service.getEntries(NOW);
    const restored = { ...createTask({ id: 'a' }), subTasks: [] };
    taskService.getByIdWithSubTaskData$.and.returnValue(of(restored));

    await service.restore(entry);
    (snack.open.calls.mostRecent().args[0] as SnackParams).actionFn!();

    expect(taskService.remove).toHaveBeenCalledOnceWith(restored);
  });

  it('drops expired entries on the first write, even if the trash is never opened', async () => {
    store.entries.set('old', {
      id: 'old',
      task: createTask({ id: 'old' }),
      subTasks: [],
      deletedAt: NOW - RECENTLY_DELETED_RETENTION_MS - 1,
    } as RecentlyDeletedEntry);

    await service.recordAction(deleteAction('a'), NOW, NOW);

    expect([...store.entries.keys()]).toEqual(['a']);
  });

  it('keeps a re-delete whose id still has an expired entry from an earlier session', async () => {
    store.entries.set('a', {
      id: 'a',
      task: createTask({ id: 'a' }),
      subTasks: [],
      deletedAt: NOW - RECENTLY_DELETED_RETENTION_MS - 1,
    } as RecentlyDeletedEntry);

    await service.recordAction(deleteAction('a'), NOW, NOW);

    expect(store.entries.get('a')?.deletedAt).toBe(NOW);
  });

  it('retries the first-write purge after a failed write', async () => {
    store.entries.set('old', {
      id: 'old',
      task: createTask({ id: 'old' }),
      subTasks: [],
      deletedAt: NOW - RECENTLY_DELETED_RETENTION_MS - 1,
    } as RecentlyDeletedEntry);
    const applyChanges = store.applyChanges.bind(store);
    let calls = 0;
    spyOn(store, 'applyChanges').and.callFake((puts, ids) =>
      calls++ === 0 ? Promise.reject(new Error('idb down')) : applyChanges(puts, ids),
    );

    await service.recordAction(deleteAction('a'), NOW, NOW);
    await service.recordAction(deleteAction('b'), NOW, NOW);

    expect(store.entries.has('old')).toBeFalse();
  });

  describe('remote ops', () => {
    // The callback is fire-and-forget; a later queued read waits for it.
    const applyRemote = async (ops: Operation[], after?: () => void): Promise<void> => {
      const onCommitted = service.beforeRemoteApply(ops);
      after?.();
      onCommitted(ops);
      await service.getEntries();
    };

    it('records deletes with the op timestamp and ignores unrelated ops', async () => {
      const ts = Date.now() - 1000;
      await applyRemote([
        remoteOp(
          ActionType.TASK_SHARED_DELETE,
          { task: { ...createTask({ id: 'r', title: 'Remote' }), subTasks: [] } },
          ts,
        ),
        remoteOp(
          ActionType.TASK_SHARED_UPDATE,
          { task: { id: 'r', changes: { title: 'x' } } },
          ts,
        ),
      ]);

      expect([...store.entries.keys()]).toEqual(['r']);
      expect(store.entries.get('r')?.deletedAt).toBe(ts);
    });

    it('clamps a sender timestamp from the future, so the entry still expires', async () => {
      const before = Date.now();
      await applyRemote([
        remoteOp(
          ActionType.TASK_SHARED_DELETE,
          { task: { ...createTask({ id: 'r', title: 'R' }), subTasks: [] } },
          before + RECENTLY_DELETED_RETENTION_MS,
        ),
      ]);

      expect(store.entries.get('r')!.deletedAt).toBeLessThanOrEqual(Date.now());
    });

    it('writes a whole batch in one storage call', async () => {
      const spy = spyOn(store, 'applyChanges').and.callThrough();
      const ops = ['r1', 'r2', 'r3'].map((id) =>
        remoteOp(
          ActionType.TASK_SHARED_DELETE,
          { task: { ...createTask({ id, title: id }), subTasks: [] } },
          Date.now() - 1000,
        ),
      );

      service.beforeRemoteApply(ops)(ops);
      await service.empty();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.calls.first().args[0].map((e) => e.id)).toEqual(['r1', 'r2', 'r3']);
    });

    it('snapshots a synced bulk delete from pre-apply state (the upload strips its tasks)', async () => {
      const parent = createTask({ id: 'p', title: 'Parent', subTaskIds: ['c'] });
      const child = createTask({ id: 'c', title: 'Child', parentId: 'p' });
      const other = createTask({ id: 'o', title: 'Untouched' });
      taskEntities = { p: parent, c: child, o: other };
      const ts = Date.now() - 1000;

      // What arrives after upload sanitization: ids only, no `tasks`.
      await applyRemote(
        [
          remoteOp(
            ActionType.TASK_SHARED_DELETE_MULTIPLE,
            { actionPayload: { taskIds: ['p'] }, entityChanges: [] },
            ts,
          ),
        ],
        // The ops apply: the tasks are gone from state afterwards.
        () => (taskEntities = { o: other }),
      );

      expect([...store.entries.keys()]).toEqual(['p']);
      expect(store.entries.get('p')?.subTasks.map((t) => t.id)).toEqual(['c']);
      expect(store.entries.get('p')?.deletedAt).toBe(ts);
    });

    it('also trashes subtasks only this device has (the reducer deletes them too)', async () => {
      const sentChild = createTask({ id: 'c1', title: 'Sent', parentId: 'p' });
      const localChild = createTask({ id: 'c2', title: 'Local only', parentId: 'p' });
      taskEntities = {
        p: createTask({ id: 'p', subTaskIds: ['c1', 'c2'] }),
        c1: sentChild,
        c2: localChild,
      };

      await applyRemote([
        remoteOp(
          ActionType.TASK_SHARED_DELETE,
          {
            task: {
              ...createTask({ id: 'p', title: 'Parent', subTaskIds: ['c1'] }),
              subTasks: [sentChild],
            },
          },
          Date.now() - 1000,
        ),
      ]);

      expect(store.entries.get('p')?.subTasks.map((t) => t.id)).toEqual(['c1', 'c2']);
    });

    it('one unreadable op does not lose the rest of the batch', async () => {
      taskEntities = new Proxy({} as Record<string, Task>, {
        get: (_t, key) => {
          if (key === 'bad') throw new Error('broken state');
          return undefined;
        },
      });
      const ts = Date.now() - 1000;

      await applyRemote([
        remoteOp(ActionType.TASK_SHARED_DELETE_MULTIPLE, { taskIds: ['bad'] }, ts),
        remoteOp(
          ActionType.TASK_SHARED_DELETE,
          { task: { ...createTask({ id: 'ok', title: 'OK' }), subTasks: [] } },
          ts,
        ),
      ]);

      expect([...store.entries.keys()]).toEqual(['ok']);
    });

    it('records nothing for ops whose reducers did not commit', async () => {
      const op = remoteOp(
        ActionType.TASK_SHARED_DELETE,
        { task: { ...createTask({ id: 'r', title: 'R' }), subTasks: [] } },
        Date.now() - 1000,
      );
      service.beforeRemoteApply([op])([]);
      await service.getEntries();
      expect(store.entries.size).toBe(0);
    });
  });

  it('never rejects or throws when storage fails, so the sync path stays unaffected', async () => {
    store.isFailing = true;
    await expectAsync(service.recordAction(deleteAction('a'), NOW, NOW)).toBeResolved();
    const op = remoteOp(
      ActionType.TASK_SHARED_DELETE,
      { task: { ...createTask({ id: 'r', title: 'R' }), subTasks: [] } },
      Date.now(),
    );
    expect(() => service.beforeRemoteApply([op])([op])).not.toThrow();
    await expectAsync(service.getEntries()).toBeResolved();
  });
});
