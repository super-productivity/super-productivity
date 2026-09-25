/**
 * Reproduction for #9728 — a recurring task duplicates all of its subtasks.
 *
 * Repeat-instance creation is idempotent for the PARENT (deterministic id via
 * getRepeatableTaskId + taskAdapter.addOne, which is a no-op on an existing id)
 * but NOT for its SUBTASKS: every run mints fresh nanoid ids, and addSubTask
 * only dedupes by task id. So any second execution of
 * _getActionsForTaskRepeatCfg for the same (cfg, day) leaves 1 parent with 2x
 * the subtasks.
 *
 * The two callers that can both reach the create path for the same day are
 * TaskDueEffects.createRepeatableTasksAndAddDueToday$ (day change) and
 * TaskRepeatCfgEffects.updateStartDateOnComplete$ (waitForCompletion), which
 * awaits a full task-archive load between the "does it exist?" check and the
 * dispatch.
 *
 * Actions are applied through the REAL meta-reducer chain + task reducer, so
 * this asserts observable state, not a mocked seam.
 */
import { TestBed } from '@angular/core/testing';
import { Action, ActionReducer } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { TaskRepeatCfgService } from './task-repeat-cfg.service';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from './task-repeat-cfg.model';
import { getRepeatableTaskId } from './get-repeatable-task-id.util';
import { TaskService } from '../tasks/task.service';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { DEFAULT_TASK, Task } from '../tasks/task.model';
import { DateService } from '../../core/date/date.service';
import { getDbDateStr } from '../../util/get-db-date-str';
import { RootState } from '../../root-store/root-state';
import { createCombinedTaskSharedMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/test-helpers';
import { createBaseState } from '../../root-store/meta/task-shared-meta-reducers/test-utils';
import { TASK_FEATURE_NAME, taskReducer } from '../tasks/store/task.reducer';
import { appStateFeatureKey } from '../../root-store/app-state/app-state.reducer';
import { toEntityKey } from '@sp/sync-core';
import { addSubTask } from '../tasks/store/task.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';

describe('Recurring task subtask duplication (#9728)', () => {
  let service: TaskRepeatCfgService;
  let reducer: ActionReducer<any, Action>;
  let baseState: RootState;
  let nextTaskNr: number;

  const CFG_ID = 'morning-routine-cfg';
  const DAY = new Date(2026, 7, 25, 8, 5, 0, 0);
  const dayStr = '2026-08-25';
  const parentId = getRepeatableTaskId(CFG_ID, dayStr);

  // 15 subtasks, as in the reported "morning routine".
  const cfg: TaskRepeatCfg = {
    ...DEFAULT_TASK_REPEAT_CFG,
    id: CFG_ID,
    title: 'Morning Routine',
    projectId: 'project1',
    repeatCycle: 'DAILY',
    repeatEvery: 1,
    startDate: '2026-08-01',
    lastTaskCreationDay: '2026-08-24',
    tagIds: [],
    shouldInheritSubtasks: true,
    waitForCompletion: true,
    skipOverdue: true,
    subTaskTemplates: Array.from({ length: 15 }, (_, i) => ({
      title: `Step ${i + 1}`,
      notes: '',
      timeEstimate: 0,
    })),
  };

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(DAY);
    nextTaskNr = 0;

    const taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'createNewTaskWithDefaults',
      'getTasksWithSubTasksByRepeatCfgId$',
      'getTasksByRepeatCfgId$',
      'getArchiveTasksForRepeatCfgId',
    ]);

    // Mirrors the real TaskService.createNewTaskWithDefaults (task.service.ts):
    // `id: id || nanoid()` — callers that pass no id get a fresh random one.
    taskServiceSpy.createNewTaskWithDefaults.and.callFake((args: any): Task => {
      nextTaskNr++;
      return {
        ...DEFAULT_TASK,
        ...args.additional,
        id: args.id || `rnd-${nextTaskNr}`,
        title: args.title,
        created: Date.now(),
      } as Task;
    });

    TestBed.configureTestingModule({
      providers: [
        TaskRepeatCfgService,
        provideMockStore({ initialState: { taskRepeatCfg: { ids: [], entities: {} } } }),
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: TaskService, useValue: taskServiceSpy },
        {
          provide: WorkContextService,
          useValue: jasmine.createSpyObj('WorkContextService', [], {
            activeWorkContextType: WorkContextType.PROJECT,
            activeWorkContextId: 'project1',
          }),
        },
        {
          provide: DateService,
          useValue: {
            todayStr: () => getDbDateStr(),
            isToday: (d: number | Date) => getDbDateStr(d) === getDbDateStr(),
            getStartOfNextDayDiffMs: () => 0,
          },
        },
      ],
    });

    service = TestBed.inject(TaskRepeatCfgService);
    spyOn(TestBed.inject(MockStore), 'dispatch');

    // Real meta-reducer chain on top of the real task reducer.
    reducer = createCombinedTaskSharedMetaReducer((state: any, action: Action) => ({
      ...state,
      [TASK_FEATURE_NAME]: taskReducer(state[TASK_FEATURE_NAME], action),
    }));
    baseState = {
      ...createBaseState(),
      [appStateFeatureKey]: {
        ...(createBaseState()[appStateFeatureKey] as any),
        todayStr: dayStr,
      },
    } as RootState;
  });

  afterEach(() => jasmine.clock().uninstall());

  const applyAll = (state: RootState, actions: readonly Action[]): RootState =>
    actions.reduce((acc, action) => reducer(acc, action), state);

  const subTaskIdsOf = (state: RootState, id: string): string[] =>
    (state[TASK_FEATURE_NAME].entities[id] as Task)?.subTaskIds ?? [];

  it('creates the parent once with 15 subtasks on a single run', async () => {
    const taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
    taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]) as any);
    taskService.getArchiveTasksForRepeatCfgId.and.resolveTo([]);

    const state = applyAll(
      baseState,
      await service._getActionsForTaskRepeatCfg(cfg, DAY.getTime()),
    );

    expect(state[TASK_FEATURE_NAME].entities[parentId]).toBeDefined();
    expect(subTaskIdsOf(state, parentId).length).toBe(15);
  });

  it('does NOT duplicate subtasks when two callers both create the same instance', async () => {
    const taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
    // Both callers read state BEFORE either has dispatched — the window that
    // updateStartDateOnComplete$ holds open across its task-archive load.
    taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]) as any);
    taskService.getArchiveTasksForRepeatCfgId.and.resolveTo([]);

    const [actionsA, actionsB] = await Promise.all([
      service._getActionsForTaskRepeatCfg(cfg, DAY.getTime()),
      service._getActionsForTaskRepeatCfg(cfg, DAY.getTime()),
    ]);

    const state = applyAll(applyAll(baseState, actionsA), actionsB);
    const subTaskIds = subTaskIdsOf(state, parentId);

    // The parent is deduped by its deterministic id...
    expect(
      Object.values(state[TASK_FEATURE_NAME].entities).filter(
        (t) => (t as Task).repeatCfgId === CFG_ID,
      ).length,
    ).toBe(1);

    // ...but the subtasks are not: this is #9728.
    expect(new Set(subTaskIds).size).toBe(subTaskIds.length);
    expect(subTaskIds.length).toBe(15);
  });

  /**
   * Cross-client path: two devices each create the same instance before syncing
   * (e.g. both open around the day rollover).
   *
   * Conflict detection is keyed by `ENTITY_TYPE:entityId` (sync-core
   * entity-key.util.ts), so the two parent Creates collide and are resolved to
   * one winner — which is exactly what getRepeatableTaskId was introduced for.
   * The subtask Creates carry 30 DISJOINT entity ids, so they never form a
   * conflict group and nothing in the sync layer can dedupe them.
   *
   * repeat-task-sync.integration.spec.ts asserts the parent half of this
   * ("because IDs match, there's no duplicate task") and stops there.
   */
  describe('cross-client creation (both devices create the same instance)', () => {
    it('gives the two clients ONE parent entity key but 30 disjoint subtask keys', async () => {
      const taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]) as any);
      taskService.getArchiveTasksForRepeatCfgId.and.resolveTo([]);

      // Device 1 (e.g. Windows) and device 2 (e.g. Mac), each unaware of the other.
      const deviceA = await service._getActionsForTaskRepeatCfg(cfg, DAY.getTime());
      const deviceB = await service._getActionsForTaskRepeatCfg(cfg, DAY.getTime());

      const entityIdsOf = (actions: readonly Action[], type: string): string[] =>
        actions.filter((a) => a.type === type).map((a) => ((a as any).task as Task).id);

      const parentKeys = new Set(
        [
          ...entityIdsOf(deviceA, TaskSharedActions.addTask.type),
          ...entityIdsOf(deviceB, TaskSharedActions.addTask.type),
        ].map((id) => toEntityKey('TASK', id)),
      );
      const subTaskKeys = new Set(
        [
          ...entityIdsOf(deviceA, addSubTask.type),
          ...entityIdsOf(deviceB, addSubTask.type),
        ].map((id) => toEntityKey('TASK', id)),
      );

      // One conflict group -> LWW picks a winner, no duplicate parent.
      expect(parentKeys.size).toBe(1);
      // 30 separate entities -> no conflict group exists, so all 30 apply.
      expect(subTaskKeys.size).toBe(15);
    });

    it('does NOT leave 30 subtasks after merging both devices op sets', async () => {
      const taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]) as any);
      taskService.getArchiveTasksForRepeatCfgId.and.resolveTo([]);

      const deviceA = await service._getActionsForTaskRepeatCfg(cfg, DAY.getTime());
      const deviceB = await service._getActionsForTaskRepeatCfg(cfg, DAY.getTime());

      // Merge order on the receiving client: own ops, then the remote ones.
      const state = applyAll(applyAll(baseState, deviceA), deviceB);

      expect(subTaskIdsOf(state, parentId).length).toBe(15);
    });
  });

  /**
   * Generalized invariant (#9728 follow-up).
   *
   * The property that actually matters is not "subtasks have ids" but: two
   * independent creation runs for the same (cfg, day) must produce byte-identical
   * task ids for EVERY task they create. That is what makes the second run a
   * no-op, whether it comes from a local re-entry or another device.
   *
   * This guards anything added to the instance later — a third nesting level,
   * a template-derived attachment, a note task — which would otherwise
   * reintroduce #9728 silently.
   */
  describe('instance-creation id determinism', () => {
    const taskIdsOf = (actions: readonly Action[]): string[] =>
      actions
        .filter((a) => 'task' in (a as any) && !!(a as any).task?.id)
        .map((a) => ((a as any).task as Task).id);

    it('produces identical task ids across two independent runs', async () => {
      const taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]) as any);
      taskService.getArchiveTasksForRepeatCfgId.and.resolveTo([]);

      const runA = await service._getActionsForTaskRepeatCfg(cfg, DAY.getTime());
      const runB = await service._getActionsForTaskRepeatCfg(cfg, DAY.getTime());

      expect(taskIdsOf(runA).length).toBeGreaterThan(0);
      expect(taskIdsOf(runB)).toEqual(taskIdsOf(runA));
    });

    it('derives every created task id from the repeat cfg and its due day', async () => {
      const taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]) as any);
      taskService.getArchiveTasksForRepeatCfgId.and.resolveTo([]);

      const ids = taskIdsOf(
        await service._getActionsForTaskRepeatCfg(cfg, DAY.getTime()),
      );

      expect(ids.length).toBe(16); // 1 parent + 15 subtasks
      ids.forEach((id) =>
        expect(id.startsWith(parentId))
          .withContext(`task id "${id}" is not derived from "${parentId}"`)
          .toBe(true),
      );
    });
  });
});
