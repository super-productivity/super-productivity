import { TestBed } from '@angular/core/testing';
import { Action, Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { DEFAULT_PROJECT } from '../../../../features/project/project.const';
import {
  addProject,
  completeProject,
} from '../../../../features/project/store/project.actions';
import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import {
  deletePluginUserData,
  upsertPluginUserData,
} from '../../../../plugins/store/plugin.actions';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { OperationCaptureService } from '../../../capture/operation-capture.service';
import { OperationLogEffects } from '../../../capture/operation-log.effects';
import { HydrationStateService } from '../../../apply/hydration-state.service';
import { LockService } from '../../../sync/lock.service';
import { LOCK_NAMES } from '../../../core/operation-log.const';
import { PersistentAction } from '../../../core/persistent-action.interface';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';
import { OperationLogSyncService } from '../../../sync/operation-log-sync.service';
import { SyncSessionValidationService } from '../../../sync/sync-session-validation.service';
import { getDbDateStr } from '../../../../util/get-db-date-str';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

/**
 * #10441 evidence (scratch): does removing the AGENTS.md rule 6 yield after a
 * bulk dispatch loop lose, reorder or un-persist ops, through the real store,
 * capture meta-reducer, OperationLogEffects, IndexedDB op log, restart
 * hydration and a SuperSync round trip to a second device?
 */
const INBOX = 'INBOX_PROJECT';
const P = 'pBulk';

const yieldMacrotask = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  ...DEFAULT_TASK,
  id,
  title: id,
  projectId: P,
  created: Date.now(),
  ...extra,
});

interface Slices {
  tasks: unknown;
  projects: unknown;
  plugin: unknown;
  todayTaskIds: unknown;
}

const slices = (root: Record<string, unknown>): Slices => {
  const tags = root['tag'] as { entities: Record<string, { taskIds: string[] }> };
  const tasks = root['tasks'] as { ids: string[]; entities: Record<string, Task> };
  return {
    tasks: tasks.ids
      .slice()
      .sort()
      .map((id) => {
        const t = tasks.entities[id];
        return [id, t.projectId, t.isDone, t.title, t.dueDay ?? null];
      }),
    projects: Object.values(
      (root['projects'] as { entities: Record<string, Record<string, unknown>> })
        .entities,
    )
      .map((p) => [p['id'], p['isArchived'] ?? null, p['taskIds']])
      .sort(),
    plugin: [...(root['pluginUserData'] as { id: string; data: string }[])]
      .map((d) => [d.id, d.data])
      .sort(),
    todayTaskIds: tags.entities['TODAY']?.taskIds ?? [],
  };
};

interface Outcome {
  pendingAfterLoop: number;
  pendingAfterYield: number;
  expected: string[];
  logged: string[];
  clockStrictlyIncreasing: boolean;
  beforeRestart: Slices;
  afterRestart: Slices;
  peer: Slices;
  serverOpCount: number;
}

describe('#10441 bulk dispatch yield evidence', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  const run = async (
    n: number,
    withYield: boolean,
    setup: (h: SyncFuzzHarness) => Promise<void>,
    loop: (dispatch: (a: Action) => void) => Promise<void>,
    followUp: (dispatch: (a: Action) => void) => Promise<void>,
    uploadImmediately = false,
  ): Promise<Outcome> => {
    const h = await SyncFuzzHarness.create();
    const a = await h.addDevice('A');
    const b = await h.addDevice('B');
    await h.as(a, () => setup(h));
    const ops = (device: FuzzDevice): Promise<string[]> =>
      h.as(device, async () =>
        (await TestBed.inject(OperationLogStoreService).getOpsAfterSeq(0)).map(
          (e) => `${e.op.actionType}|${e.op.entityId}`,
        ),
      );
    const before = (await ops(a)).length;
    const expected: string[] = [];
    let pendingAfterLoop = -1;
    let pendingAfterYield = -1;
    await h.as(a, async () => {
      const store = TestBed.inject(Store);
      const capture = TestBed.inject(OperationCaptureService);
      const dispatch = (action: Action): void => {
        const p = action as PersistentAction;
        if (p.meta?.isPersistent && !p.meta.isRemote) {
          expected.push(`${p.type}|${p.meta.entityId ?? p.meta.entityIds?.[0]}`);
        }
        store.dispatch(action);
      };
      await loop(dispatch);
      pendingAfterLoop = capture.getPendingCount();
      if (withYield) await yieldMacrotask();
      pendingAfterYield = capture.getPendingCount();
      await followUp(dispatch);
      if (uploadImmediately) {
        // A follow-up that needs the loop's ops on the server, with no wait
        // in between other than what the upload path itself does.
        await TestBed.inject(SyncSessionValidationService).withSession(() =>
          TestBed.inject(OperationLogSyncService).uploadPendingOps(a.client, {
            isNeverSynced: true,
          }),
        );
      }
    });
    const logged = (await ops(a)).slice(before);
    const clockStrictlyIncreasing = await h.as(a, async () => {
      const entries = await TestBed.inject(OperationLogStoreService).getOpsAfterSeq(0);
      const counters = entries.map((e) => e.op.vectorClock[a.clientId] ?? 0);
      return counters.every((c, i) => i === 0 || c === counters[i - 1] + 1);
    });
    const serverOpCount = uploadImmediately ? h.server.rows.length : -1;
    if (uploadImmediately) {
      expect(serverOpCount)
        .withContext('every op uploaded')
        .toBe(before + logged.length);
    }
    const beforeRestart = slices(await h.as(a, () => h.state()));
    await h.restart(a);
    const afterRestart = slices(await h.as(a, () => h.state()));
    expect(await h.sync(a))
      .withContext(JSON.stringify(h.events))
      .toBeTrue();
    expect(await h.sync(b))
      .withContext(JSON.stringify(h.events))
      .toBeTrue();
    const peer = slices(await h.as(b, () => h.state()));
    void n;
    return {
      pendingAfterLoop,
      pendingAfterYield,
      expected,
      logged,
      clockStrictlyIncreasing,
      beforeRestart,
      afterRestart,
      peer,
      serverOpCount,
    };
  };

  const assertSound = (o: Outcome, label: string): void => {
    expect(o.logged).withContext(`${label}: op log order`).toEqual(o.expected);
    expect(o.clockStrictlyIncreasing).withContext(`${label}: clock`).toBeTrue();
    expect(o.afterRestart).withContext(`${label}: restart`).toEqual(o.beforeRestart);
    expect(o.peer).withContext(`${label}: peer`).toEqual(o.beforeRestart);
    // Every loop op is captured (counted) synchronously at dispatch; the
    // yield lets at most a few writes finish, it does not drain them.
    expect(o.pendingAfterLoop)
      .withContext(`${label}: pending after loop`)
      .toBe(o.logged.length - 1);
    expect(o.pendingAfterYield)
      .withContext(`${label}: pending after yield`)
      .toBeGreaterThan(0);
  };

  // Negative control: the same checks must catch a state change that has no
  // op behind it. One loop action is marked remote, so the reducer applies it
  // but OperationLogEffects writes no op (the effect skips isRemote).
  it('control: a state change without an op fails restart and peer checks', async () => {
    const o = await run(
      3,
      false,
      async (h) => {
        for (let i = 0; i < 3; i++) {
          await h.dispatch(
            upsertPluginUserData({ pluginUserData: { id: `pl${i}`, data: `d${i}` } }),
          );
        }
      },
      async (dispatch) => {
        dispatch(deletePluginUserData({ pluginId: 'pl0' }));
        const lost = deletePluginUserData({ pluginId: 'pl1' });
        dispatch({ ...lost, meta: { ...lost.meta, isRemote: true } } as Action);
        dispatch(deletePluginUserData({ pluginId: 'pl2' }));
      },
      async () => undefined,
    );
    expect(o.logged).toEqual(o.expected);
    expect(o.afterRestart).not.toEqual(o.beforeRestart);
    expect(o.peer).not.toEqual(o.beforeRestart);
  }, 60000);

  for (const n of [50, 200, 500]) {
    for (const withYield of [true, false]) {
      const tag = `n=${n} yield=${withYield}`;

      // ProjectService.moveTasksToInbox (+ markTasksDone), then the dependent
      // follow-up ProjectService.complete → completeProject.
      it(`project completion: move ${n} to Inbox, reopen, then complete (${tag})`, async () => {
        const o = await run(
          n,
          withYield,
          async (h) => {
            await h.dispatch(
              addProject({
                project: { ...DEFAULT_PROJECT, id: P, title: P, taskIds: [] },
              }),
            );
            for (let i = 0; i < n; i++) {
              await h.dispatch(
                TaskSharedActions.addTask({
                  task: task(`t${i}`, i % 2 ? { isDone: true, doneOn: Date.now() } : {}),
                  workContextId: P,
                  workContextType: WorkContextType.PROJECT,
                  isAddToBacklog: false,
                  isAddToBottom: true,
                }),
              );
            }
          },
          async (dispatch) => {
            const root = (await firstValueFrom(TestBed.inject(Store))) as Record<
              string,
              unknown
            >;
            const entities = (root['tasks'] as { entities: Record<string, Task> })
              .entities;
            for (let i = 0; i < n; i++) {
              const t = entities[`t${i}`];
              dispatch(
                TaskSharedActions.moveToOtherProject({
                  task: { ...t, subTasks: [] },
                  targetProjectId: INBOX,
                }),
              );
              if (t.isDone) {
                dispatch(
                  TaskSharedActions.updateTask({
                    task: { id: t.id, changes: { isDone: false } },
                  }),
                );
              }
            }
          },
          async (dispatch) => {
            dispatch(completeProject({ id: P, doneOn: Date.now() }));
          },
        );
        assertSound(o, `project ${tag}`);
        expect(o.logged.length).toBe(n + n / 2 + 1);
      }, 300000);

      // PluginUserPersistenceService.clearAllPluginUserData: per-entry deletes.
      it(`plugin data: delete ${n} entries (${tag})`, async () => {
        const o = await run(
          n,
          withYield,
          async (h) => {
            for (let i = 0; i < n; i++) {
              await h.dispatch(
                upsertPluginUserData({ pluginUserData: { id: `pl${i}`, data: `d${i}` } }),
              );
            }
            await h.dispatch(
              upsertPluginUserData({ pluginUserData: { id: 'keep', data: 'k' } }),
            );
          },
          async (dispatch) => {
            for (let i = 0; i < n; i++)
              dispatch(deletePluginUserData({ pluginId: `pl${i}` }));
          },
          async (dispatch) => {
            // A dependent follow-up on the same array-pattern entity.
            dispatch(
              upsertPluginUserData({ pluginUserData: { id: 'pl0', data: 'again' } }),
            );
          },
        );
        assertSound(o, `plugin ${tag}`);
      }, 300000);

      // AddTasksForTomorrowService shape: N creations, then a selector read and
      // one planTasksForToday built from what the read sees; and the
      // TaskBulkActionService shape with an immediate upload as follow-up.
      it(`create ${n} then plan what the store shows, then upload at once (${tag})`, async () => {
        const day = getDbDateStr(Date.now());
        let seen = -1;
        const o = await run(
          n,
          withYield,
          async (h) => {
            await h.dispatch(
              addProject({
                project: { ...DEFAULT_PROJECT, id: P, title: P, taskIds: [] },
              }),
            );
          },
          async (dispatch) => {
            for (let i = 0; i < n; i++) {
              dispatch(
                TaskSharedActions.addTask({
                  task: task(`r${i}`),
                  workContextId: P,
                  workContextType: WorkContextType.PROJECT,
                  isAddToBacklog: false,
                  isAddToBottom: true,
                }),
              );
            }
          },
          async (dispatch) => {
            const root = (await firstValueFrom(TestBed.inject(Store))) as Record<
              string,
              unknown
            >;
            const ids = (root['tasks'] as { ids: string[] }).ids.filter((id) =>
              id.startsWith('r'),
            );
            seen = ids.length;
            dispatch(
              TaskSharedActions.planTasksForToday({
                taskIds: ids,
                today: day,
                startOfNextDayDiffMs: 0,
              }),
            );
          },
          true,
        );
        expect(seen).toBe(n);
        assertSound(o, `plan+upload ${tag}`);
        expect((o.beforeRestart.todayTaskIds as string[]).length).toBe(n);
      }, 300000);
    }
  }
  // Review additions (fresh-context review of #10441 evidence).
  const assertOrderAndDurable = (o: Outcome, label: string): void => {
    expect(o.logged).withContext(`${label}: op log order`).toEqual(o.expected);
    expect(o.clockStrictlyIncreasing).withContext(`${label}: clock`).toBeTrue();
    expect(o.afterRestart).withContext(`${label}: restart`).toEqual(o.beforeRestart);
    expect(o.peer).withContext(`${label}: peer`).toEqual(o.beforeRestart);
  };

  for (const n of [50, 200]) {
    for (const withYield of [true, false]) {
      const tag = `n=${n} yield=${withYield}`;

      // AddTasksForTomorrowService.addAllDueTomorrow: Promise.all over
      // createRepeatableTask, each of which awaits a store read and then
      // dispatches its own actions, so the creators' dispatches interleave at
      // microtask boundaries. Then the yield, then a read-and-plan follow-up.
      it(`concurrent creators interleave, then plan what the store shows (${tag})`, async () => {
        const day = getDbDateStr(Date.now());
        let seen = -1;
        const o = await run(
          n,
          withYield,
          async (h) => {
            await h.dispatch(
              addProject({
                project: { ...DEFAULT_PROJECT, id: P, title: P, taskIds: [] },
              }),
            );
          },
          async (dispatch) => {
            const store = TestBed.inject(Store);
            const create = async (i: number): Promise<void> => {
              // Uneven awaits so the creators finish out of start order.
              for (let k = 0; k < i % 3; k++) {
                await firstValueFrom(store);
              }
              dispatch(
                TaskSharedActions.addTask({
                  task: task(`c${i}`),
                  workContextId: P,
                  workContextType: WorkContextType.PROJECT,
                  isAddToBacklog: false,
                  isAddToBottom: true,
                }),
              );
              await firstValueFrom(store);
              dispatch(
                TaskSharedActions.updateTask({
                  task: { id: `c${i}`, changes: { title: `c${i}-renamed` } },
                }),
              );
            };
            await Promise.all(Array.from({ length: n }, (_, i) => create(i)));
          },
          async (dispatch) => {
            const root = (await firstValueFrom(TestBed.inject(Store))) as Record<
              string,
              unknown
            >;
            const tasks = root['tasks'] as {
              ids: string[];
              entities: Record<string, Task>;
            };
            const ids = tasks.ids.filter(
              (id) => id.startsWith('c') && tasks.entities[id].title.endsWith('-renamed'),
            );
            seen = ids.length;
            dispatch(
              TaskSharedActions.planTasksForToday({
                taskIds: ids,
                today: day,
                startOfNextDayDiffMs: 0,
              }),
            );
          },
          true,
        );
        expect(seen).toBe(n);
        assertOrderAndDurable(o, `concurrent ${tag}`);
        // The creators really interleaved: not every add is directly followed
        // by its own rename.
        const adjacent = o.logged.filter(
          (e, i) =>
            e.startsWith('[Task Shared] addTask|') &&
            o.logged[i + 1] === `[Task Shared] updateTask|${e.split('|')[1]}`,
        ).length;
        expect(adjacent).toBeLessThan(n);
        expect((o.beforeRestart.todayTaskIds as string[]).length).toBe(n);
      }, 300000);

      // A remote-apply window is open while the loop runs (every loop action is
      // deferred) and closes in the next macrotask, the way a sync that was
      // already applying would end. The yield decides whether the follow-up
      // lands inside the window (deferred too) or after it.
      for (const drainHoldsLock of [true, false]) {
        it(`loop inside a remote-apply window that ends next macrotask, drain ${drainHoldsLock ? 'under' : 'without'} the op-log lock (${tag})`, async () => {
          const o = await run(
            n,
            withYield,
            async (h) => {
              for (let i = 0; i < n; i++) {
                await h.dispatch(
                  upsertPluginUserData({
                    pluginUserData: { id: `pl${i}`, data: `d${i}` },
                  }),
                );
              }
            },
            async (dispatch) => {
              const release =
                TestBed.inject(HydrationStateService).acquireApplyingRemoteOpsHold();
              const effects = TestBed.inject(OperationLogEffects);
              const lock = TestBed.inject(LockService);
              setTimeout(() => {
                if (drainHoldsLock) {
                  // RemoteOpsProcessingService main path: window end and the
                  // drain both inside sp_op_log.
                  void lock.request(LOCK_NAMES.OPERATION_LOG, async () => {
                    release();
                    await effects.processDeferredActions({
                      callerHoldsOperationLogLock: true,
                    });
                  });
                } else {
                  // skipConflictDetection without callerHoldsOperationLogLock:
                  // the drain takes the lock per write.
                  release();
                  void effects.processDeferredActions();
                }
              }, 0);
              for (let i = 0; i < n; i++) {
                dispatch(deletePluginUserData({ pluginId: `pl${i}` }));
              }
            },
            async (dispatch) => {
              // Same entity as the loop's LAST op: an inversion would replay
              // the upsert before the delete.
              dispatch(
                upsertPluginUserData({
                  pluginUserData: { id: `pl${n - 1}`, data: 'again' },
                }),
              );
              // Let the scheduled window end happen before the step boundary
              // (after the follow-up, so it does not change the scenario).
              const hydration = TestBed.inject(HydrationStateService);
              while (hydration.isApplyingRemoteOps()) {
                await new Promise((r) => setTimeout(r, 5));
              }
            },
          );
          expect(o.beforeRestart.plugin).toEqual([[`pl${n - 1}`, 'again']]);
          if (drainHoldsLock || !withYield) {
            assertOrderAndDurable(o, `window drainLock=${drainHoldsLock} ${tag}`);
          } else {
            // Observed (review, 2026-10-06): with the yield, the follow-up
            // lands after the window ends but while an unlocked drain is
            // still writing the deferred loop ops, so its op is written
            // second and replays before the delete it followed. Without the
            // yield the follow-up is deferred too and stays in order. The
            // yield is not a guard here; the unlocked drain is the cause.
            expect(o.logged[1]).toBe(`[Plugin] Upsert User Data|pl${n - 1}`);
            expect(o.afterRestart.plugin).toEqual([]);
            expect(o.peer.plugin).toEqual([]);
          }
        }, 300000);
      }
    }
  }
});
