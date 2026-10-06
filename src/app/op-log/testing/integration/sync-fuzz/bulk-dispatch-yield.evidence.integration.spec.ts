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
      expect(serverOpCount).withContext('every op uploaded').toBe(before + logged.length);
    }
    const beforeRestart = slices(await h.as(a, () => h.state()));
    await h.restart(a);
    const afterRestart = slices(await h.as(a, () => h.state()));
    expect(await h.sync(a)).withContext(JSON.stringify(h.events)).toBeTrue();
    expect(await h.sync(b)).withContext(JSON.stringify(h.events)).toBeTrue();
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
    expect(o.pendingAfterLoop).withContext(`${label}: pending after loop`).toBe(
      o.logged.length - 1,
    );
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
            for (let i = 0; i < n; i++) dispatch(deletePluginUserData({ pluginId: `pl${i}` }));
          },
          async (dispatch) => {
            // A dependent follow-up on the same array-pattern entity.
            dispatch(upsertPluginUserData({ pluginUserData: { id: 'pl0', data: 'again' } }));
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
});
