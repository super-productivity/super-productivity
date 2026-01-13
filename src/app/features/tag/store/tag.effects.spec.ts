import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { EMPTY, Observable, of } from 'rxjs';
import { TagEffects } from './tag.effects';
import { updateTag } from './tag.actions';
import { TODAY_TAG } from '../tag.const';
import {
  selectTodayTagRepair,
  selectTodayTaskIds,
} from '../../work-context/store/work-context.selectors';
import { selectAllTasksDueToday } from '../../planner/store/planner.selectors';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { SnackService } from '../../../core/snack/snack.service';
import { TagService } from '../tag.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { PlannerService } from '../../planner/planner.service';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { WorkContextType } from '../../work-context/work-context.model';
import { TaskWithDueDay } from '../../tasks/task.model';

/**
 * Tests for TagEffects, specifically the selector-based effects.
 *
 * The effect repairs TODAY_TAG.taskIds when it becomes inconsistent with
 * tasks' dueDay values, typically after sync conflict resolution.
 */
describe('TagEffects', () => {
  let effects: TagEffects;
  let actions$: Observable<any>;
  let store: MockStore;
  let hydrationStateServiceSpy: jasmine.SpyObj<HydrationStateService>;
  let syncTriggerServiceSpy: jasmine.SpyObj<SyncTriggerService>;

  beforeEach(() => {
    actions$ = EMPTY;

    hydrationStateServiceSpy = jasmine.createSpyObj('HydrationStateService', [
      'isApplyingRemoteOps',
      'isInSyncWindow',
    ]);
    // Default: not applying remote ops (so effect should fire)
    hydrationStateServiceSpy.isApplyingRemoteOps.and.returnValue(false);
    hydrationStateServiceSpy.isInSyncWindow.and.returnValue(false);

    syncTriggerServiceSpy = jasmine.createSpyObj('SyncTriggerService', [
      'isInitialSyncDoneSync',
    ]);
    // Default: initial sync is done (so effect should fire)
    syncTriggerServiceSpy.isInitialSyncDoneSync.and.returnValue(true);

    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    const tagServiceSpy = jasmine.createSpyObj('TagService', ['updateTag']);
    const workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [], {
      activeWorkContextId: 'test-id',
      activeWorkContextTypeAndId$: of({
        activeType: WorkContextType.TAG,
        activeId: 'test-id',
      }),
      mainListTasks$: of([]),
    });
    const routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    const translateServiceSpy = jasmine.createSpyObj('TranslateService', ['instant']);
    translateServiceSpy.instant.and.returnValue('Today');
    const plannerServiceSpy = jasmine.createSpyObj('PlannerService', [
      'getSnackExtraStr',
    ]);
    plannerServiceSpy.getSnackExtraStr.and.returnValue(Promise.resolve(''));

    TestBed.configureTestingModule({
      providers: [
        TagEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [
            {
              selector: selectTodayTagRepair,
              value: null, // Default: no repair needed
            },
            {
              selector: selectTodayTaskIds,
              value: [], // Default: empty today list
            },
            {
              selector: selectAllTasksDueToday,
              value: [], // Default: no tasks due today
            },
          ],
        }),
        { provide: HydrationStateService, useValue: hydrationStateServiceSpy },
        { provide: SyncTriggerService, useValue: syncTriggerServiceSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: TagService, useValue: tagServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
        { provide: Router, useValue: routerSpy },
        { provide: TranslateService, useValue: translateServiceSpy },
        { provide: PlannerService, useValue: plannerServiceSpy },
        { provide: LOCAL_ACTIONS, useValue: EMPTY },
      ],
    });

    effects = TestBed.inject(TagEffects);
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('repairTodayTagConsistency$', () => {
    it('should dispatch updateTag when repair is needed', (done) => {
      const repairedTaskIds = ['task1', 'task2'];
      store.overrideSelector(selectTodayTagRepair, {
        needsRepair: true,
        repairedTaskIds,
      });
      store.refreshState();

      effects.repairTodayTagConsistency$.subscribe((action) => {
        expect(action).toEqual(
          updateTag({
            tag: {
              id: TODAY_TAG.id,
              changes: { taskIds: repairedTaskIds },
            },
            isSkipSnack: true,
          }),
        );
        done();
      });
    });

    it('should not dispatch when no repair is needed (null)', (done) => {
      store.overrideSelector(selectTodayTagRepair, null);
      store.refreshState();

      let emitted = false;
      effects.repairTodayTagConsistency$.subscribe(() => {
        emitted = true;
      });

      // Give it time to potentially emit
      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should not dispatch when needsRepair is false', (done) => {
      store.overrideSelector(selectTodayTagRepair, {
        needsRepair: false,
        repairedTaskIds: [],
      } as any);
      store.refreshState();

      let emitted = false;
      effects.repairTodayTagConsistency$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should not dispatch during sync window (skipDuringSyncWindow)', (done) => {
      // Simulate being in sync window (either applying ops or in post-sync cooldown)
      hydrationStateServiceSpy.isInSyncWindow.and.returnValue(true);

      store.overrideSelector(selectTodayTagRepair, {
        needsRepair: true,
        repairedTaskIds: ['task1'],
      });
      store.refreshState();

      let emitted = false;
      effects.repairTodayTagConsistency$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should not dispatch when initial sync is not done', (done) => {
      // Simulate app startup before first sync
      syncTriggerServiceSpy.isInitialSyncDoneSync.and.returnValue(false);

      store.overrideSelector(selectTodayTagRepair, {
        needsRepair: true,
        repairedTaskIds: ['task1'],
      });
      store.refreshState();

      let emitted = false;
      effects.repairTodayTagConsistency$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should handle empty repairedTaskIds', (done) => {
      store.overrideSelector(selectTodayTagRepair, {
        needsRepair: true,
        repairedTaskIds: [],
      });
      store.refreshState();

      effects.repairTodayTagConsistency$.subscribe((action) => {
        expect(action).toEqual(
          updateTag({
            tag: {
              id: TODAY_TAG.id,
              changes: { taskIds: [] },
            },
            isSkipSnack: true,
          }),
        );
        done();
      });
    });
  });

  describe('preventParentAndSubTaskInTodayList$', () => {
    const createTask = (id: string, parentId?: string): TaskWithDueDay =>
      ({
        id,
        parentId: parentId || null,
        subTaskIds: [],
        tagIds: [],
        projectId: null,
        dueDay: '2024-01-15', // Required for TaskWithDueDay
      }) as unknown as TaskWithDueDay;

    it('should remove subtask when parent is also in today list', (done) => {
      const parent = createTask('parent-1');
      const child = createTask('child-1', 'parent-1');

      // Today list has both parent and child
      store.overrideSelector(selectTodayTaskIds, ['parent-1', 'child-1']);
      store.overrideSelector(selectAllTasksDueToday, [parent, child]);
      store.refreshState();

      effects.preventParentAndSubTaskInTodayList$.subscribe((action) => {
        expect(action).toEqual(
          updateTag({
            tag: {
              id: TODAY_TAG.id,
              changes: { taskIds: ['parent-1'] }, // Child removed
            },
            isSkipSnack: true,
          }),
        );
        done();
      });
    });

    it('should add task with dueDay=today that is not in list', (done) => {
      const existingTask = createTask('task-1');
      const newDueTask = createTask('task-2');

      // Today list only has task-1, but task-2 is also due today
      store.overrideSelector(selectTodayTaskIds, ['task-1']);
      store.overrideSelector(selectAllTasksDueToday, [existingTask, newDueTask]);
      store.refreshState();

      effects.preventParentAndSubTaskInTodayList$.subscribe((action) => {
        expect(action).toEqual(
          updateTag({
            tag: {
              id: TODAY_TAG.id,
              changes: { taskIds: ['task-1', 'task-2'] }, // task-2 added
            },
            isSkipSnack: true,
          }),
        );
        done();
      });
    });

    it('should not dispatch when no changes needed', (done) => {
      const task = createTask('task-1');

      // Today list has task-1, allTasksDueToday also has task-1 - no change needed
      store.overrideSelector(selectTodayTaskIds, ['task-1']);
      store.overrideSelector(selectAllTasksDueToday, [task]);
      store.refreshState();

      let emitted = false;
      effects.preventParentAndSubTaskInTodayList$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should not dispatch during sync window', (done) => {
      hydrationStateServiceSpy.isInSyncWindow.and.returnValue(true);

      const parent = createTask('parent-1');
      const child = createTask('child-1', 'parent-1');

      store.overrideSelector(selectTodayTaskIds, ['parent-1', 'child-1']);
      store.overrideSelector(selectAllTasksDueToday, [parent, child]);
      store.refreshState();

      let emitted = false;
      effects.preventParentAndSubTaskInTodayList$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should not dispatch when initial sync is not done', (done) => {
      syncTriggerServiceSpy.isInitialSyncDoneSync.and.returnValue(false);

      const parent = createTask('parent-1');
      const child = createTask('child-1', 'parent-1');

      store.overrideSelector(selectTodayTaskIds, ['parent-1', 'child-1']);
      store.overrideSelector(selectAllTasksDueToday, [parent, child]);
      store.refreshState();

      let emitted = false;
      effects.preventParentAndSubTaskInTodayList$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should not dispatch when todayTaskIds is empty', (done) => {
      // Empty today list should not trigger the effect
      store.overrideSelector(selectTodayTaskIds, []);
      store.overrideSelector(selectAllTasksDueToday, []);
      store.refreshState();

      let emitted = false;
      effects.preventParentAndSubTaskInTodayList$.subscribe(() => {
        emitted = true;
      });

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should handle both adding new tasks and removing subtasks', (done) => {
      const parent = createTask('parent-1');
      const child = createTask('child-1', 'parent-1');
      const newTask = createTask('new-task');

      // Today list has parent and child, but newTask is also due
      store.overrideSelector(selectTodayTaskIds, ['parent-1', 'child-1']);
      store.overrideSelector(selectAllTasksDueToday, [parent, child, newTask]);
      store.refreshState();

      effects.preventParentAndSubTaskInTodayList$.subscribe((action) => {
        expect(action).toEqual(
          updateTag({
            tag: {
              id: TODAY_TAG.id,
              changes: { taskIds: ['parent-1', 'new-task'] }, // child removed, new-task added
            },
            isSkipSnack: true,
          }),
        );
        done();
      });
    });
  });
});
