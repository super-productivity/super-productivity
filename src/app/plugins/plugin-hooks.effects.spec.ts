import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { EMPTY, Observable, of, ReplaySubject } from 'rxjs';
import { PluginHooksEffects } from './plugin-hooks.effects';
import { WorkContextService } from '../features/work-context/work-context.service';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { PluginService } from './plugin.service';
import { TaskSharedActions } from '../root-store/meta/task-shared.actions';
import { PlannerActions } from '../features/planner/store/planner.actions';
import { TaskWithSubTasks } from '../features/tasks/task.model';
import { PluginHooks } from './plugin-api.model';
import { PluginI18nService } from './plugin-i18n.service';
import {
  selectCurrentTask,
  selectTaskById,
} from '../features/tasks/store/task.selectors';
import { selectPluginUserDataFeatureState } from './store/plugin-user-data.reducer';
import { SyncTriggerService } from '../imex/sync/sync-trigger.service';
import { HydrationStateService } from '../op-log/apply/hydration-state.service';
import { PluginUserData } from './plugin-persistence.model';
import { updateGlobalConfigSection } from '../features/config/store/global-config.actions';
import { selectLocalizationConfig } from '../features/config/store/global-config.reducer';
import { LanguageCode } from '../core/locale.constants';

describe('PluginHooksEffects', () => {
  let effects: PluginHooksEffects;
  let actions$: Observable<any>;
  let pluginServiceMock: jasmine.SpyObj<PluginService>;
  let pluginI18nServiceMock: jasmine.SpyObj<PluginI18nService>;
  let store: MockStore;
  let gateSubject: ReplaySubject<boolean>;

  const createMockTask = (overrides: Partial<TaskWithSubTasks> = {}): TaskWithSubTasks =>
    ({
      id: 'task-123',
      title: 'Test Task',
      projectId: null,
      tagIds: [],
      subTaskIds: [],
      subTasks: [],
      parentId: null,
      timeSpentOnDay: {},
      timeSpent: 0,
      timeEstimate: 0,
      isDone: false,
      notes: '',
      doneOn: undefined,
      dueWithTime: undefined,
      dueDay: undefined,
      reminderId: null,
      repeatCfgId: null,
      issueId: null,
      issueType: null,
      issueProviderId: null,
      issueWasUpdated: false,
      issueLastUpdated: null,
      issueTimeTracked: null,
      attachments: [],
      created: Date.now(),
      _showSubTasksMode: 2,
      ...overrides,
    }) as TaskWithSubTasks;

  let mockTask: TaskWithSubTasks;

  beforeEach(() => {
    mockTask = createMockTask();
    pluginServiceMock = jasmine.createSpyObj('PluginService', [
      'dispatchHook',
      'dispatchHookToPlugin',
    ]);
    pluginI18nServiceMock = jasmine.createSpyObj('PluginI18nService', [
      'setCurrentLanguage',
    ]);

    // MUST be a ReplaySubject(1) / Subject — NOT BehaviorSubject(true) or
    // of(true). The boot-suppression spec depends on the gate being un-emitted
    // at boot `loadAllData` time; a BehaviorSubject(true) would emit on
    // subscribe and make that spec pass for the wrong reason.
    gateSubject = new ReplaySubject<boolean>(1);

    TestBed.configureTestingModule({
      providers: [
        PluginHooksEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: {
            globalConfig: {
              localization: {
                lng: 'en',
                dateTimeLocale: undefined,
                firstDayOfWeek: undefined,
              },
            },
          },
        }),
        { provide: PluginService, useValue: pluginServiceMock },
        { provide: PluginI18nService, useValue: pluginI18nServiceMock },
        // workContextChange$ reads activeWorkContext$ at construction; an
        // empty stream keeps that effect inert for the other effects' tests.
        { provide: WorkContextService, useValue: { activeWorkContext$: EMPTY } },
        {
          provide: SyncTriggerService,
          useValue: {
            afterInitialSyncDoneAndDataLoadedInitially$: gateSubject.asObservable(),
          },
        },
        // Provided with isInSyncWindow=true so a future regression that adds
        // `skipDuringSyncWindow`/`waitForSyncWindow` to the effect would
        // silently drop/defer emissions and fail the firePersistedDataChanged$
        // specs. See plan §"Boot gate" — the hook must fire during the sync
        // window because remote-sync deliveries are exactly the motivating
        // case.
        {
          provide: HydrationStateService,
          useValue: {
            isInSyncWindow: () => true,
            isInSyncWindow$: of(true),
            isApplyingRemoteOps: () => true,
          },
        },
      ],
    });

    effects = TestBed.inject(PluginHooksEffects);
    store = TestBed.inject(MockStore);

    // Override selector to return our mock task
    store.overrideSelector(selectTaskById, mockTask);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('taskUpdate$', () => {
    it('should dispatch TASK_UPDATE hook on updateTask action', (done) => {
      const changes = { title: 'Updated Title' };
      actions$ = of(
        TaskSharedActions.updateTask({
          task: { id: mockTask.id, changes },
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes,
          }),
        );
        done();
      });
    });

    it('should dispatch TASK_UPDATE hook on scheduleTaskWithTime action', (done) => {
      const dueWithTime = Date.now() + 3600000;
      actions$ = of(
        TaskSharedActions.scheduleTaskWithTime({
          task: mockTask,
          dueWithTime,
          isMoveToBacklog: false,
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes: { dueWithTime, dueDay: undefined },
          }),
        );
        done();
      });
    });

    it('should dispatch TASK_UPDATE hook on reScheduleTaskWithTime action', (done) => {
      const dueWithTime = Date.now() + 7200000;
      actions$ = of(
        TaskSharedActions.reScheduleTaskWithTime({
          task: mockTask,
          dueWithTime,
          isMoveToBacklog: false,
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes: { dueWithTime, dueDay: undefined },
          }),
        );
        done();
      });
    });

    it('should dispatch TASK_UPDATE hook on unscheduleTask action', (done) => {
      actions$ = of(
        TaskSharedActions.unscheduleTask({
          id: mockTask.id,
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes: { dueWithTime: undefined, reminderId: undefined },
          }),
        );
        done();
      });
    });

    it('should dispatch TASK_UPDATE hook on moveToOtherProject action', (done) => {
      const targetProjectId = 'project-456';
      actions$ = of(
        TaskSharedActions.moveToOtherProject({
          task: mockTask,
          targetProjectId,
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes: { projectId: targetProjectId },
          }),
        );
        done();
      });
    });

    it('should dispatch TASK_UPDATE hook on planTaskForDay action', (done) => {
      const day = '2024-01-15';
      actions$ = of(
        PlannerActions.planTaskForDay({
          task: mockTask,
          day,
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes: { dueDay: day, dueWithTime: undefined },
          }),
        );
        done();
      });
    });

    it('should dispatch TASK_UPDATE hook on transferTask action', (done) => {
      const newDay = '2024-01-16';
      actions$ = of(
        PlannerActions.transferTask({
          task: mockTask,
          prevDay: '2024-01-15',
          newDay,
          targetIndex: 0,
          today: '2024-01-14',
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes: { dueDay: newDay },
          }),
        );
        done();
      });
    });
  });

  describe('onCurrentTaskChange$', () => {
    it('should dispatch CURRENT_TASK_CHANGE with { current, previous: null } when a task becomes active from idle', (done) => {
      store.overrideSelector(selectCurrentTask, null);
      actions$ = of();

      const sub = effects.onCurrentTaskChange$.subscribe();
      store.overrideSelector(selectCurrentTask, mockTask);
      store.refreshState();

      // give microtasks a tick to flush
      setTimeout(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.CURRENT_TASK_CHANGE,
          { current: mockTask, previous: null },
        );
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('should dispatch CURRENT_TASK_CHANGE with { current: null, previous } when the active task is stopped', (done) => {
      store.overrideSelector(selectCurrentTask, mockTask);
      actions$ = of();

      const sub = effects.onCurrentTaskChange$.subscribe();
      store.overrideSelector(selectCurrentTask, null);
      store.refreshState();

      setTimeout(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.CURRENT_TASK_CHANGE,
          { current: null, previous: mockTask },
        );
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('should emit both previous and current when switching between tasks', (done) => {
      const otherTask = createMockTask({ id: 'task-other', title: 'Other Task' });
      store.overrideSelector(selectCurrentTask, mockTask);
      actions$ = of();

      const sub = effects.onCurrentTaskChange$.subscribe();
      store.overrideSelector(selectCurrentTask, otherTask);
      store.refreshState();

      setTimeout(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.CURRENT_TASK_CHANGE,
          { current: otherTask, previous: mockTask },
        );
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('should not re-emit when the same task is updated in place', (done) => {
      store.overrideSelector(selectCurrentTask, null);
      actions$ = of();

      const sub = effects.onCurrentTaskChange$.subscribe();
      store.overrideSelector(selectCurrentTask, mockTask);
      store.refreshState();
      // Same id, different object reference (e.g. title change while running).
      store.overrideSelector(selectCurrentTask, { ...mockTask, title: 'Renamed' });
      store.refreshState();

      setTimeout(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledTimes(1);
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.CURRENT_TASK_CHANGE,
          { current: mockTask, previous: null },
        );
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('should carry the latest snapshot of the running task into the stop event', (done) => {
      // Simulates: start task → plugin mutates task (addTag) → stop. The stop
      // payload's `previous` must reflect the post-mutation task state so a
      // taskStopped handler can read the freshly-added field.
      store.overrideSelector(selectCurrentTask, mockTask);
      actions$ = of();

      const sub = effects.onCurrentTaskChange$.subscribe();

      const mutatedTask = createMockTask({ ...mockTask, tagIds: ['in-progress'] });
      store.overrideSelector(selectCurrentTask, mutatedTask);
      store.refreshState();
      store.overrideSelector(selectCurrentTask, null);
      store.refreshState();

      setTimeout(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.CURRENT_TASK_CHANGE,
          { current: null, previous: mutatedTask },
        );
        sub.unsubscribe();
        done();
      }, 0);
    });
  });

  describe('languageChange$', () => {
    it('updates plugin i18n and dispatches a language hook payload compatible with documented and typed plugins', (done) => {
      store.overrideSelector(selectLocalizationConfig, {
        lng: LanguageCode.de,
        dateTimeLocale: undefined,
        firstDayOfWeek: undefined,
      });
      actions$ = of(
        updateGlobalConfigSection({
          sectionKey: 'localization',
          sectionCfg: {},
        }),
      );

      effects.languageChange$.subscribe(() => {
        expect(pluginI18nServiceMock.setCurrentLanguage).toHaveBeenCalledOnceWith(
          LanguageCode.de,
        );
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.LANGUAGE_CHANGE,
          {
            code: LanguageCode.de,
            newLanguage: LanguageCode.de,
          },
        );
        done();
      });
    });
  });

  describe('firePersistedDataChanged$', () => {
    const entry = (id: string, data: string): PluginUserData => ({ id, data });

    const setPluginData = (data: PluginUserData[]): void => {
      store.overrideSelector(selectPluginUserDataFeatureState, data);
      store.refreshState();
    };

    it('does not fire while the gate has not emitted (boot suppression)', (done) => {
      actions$ = of();
      store.overrideSelector(selectPluginUserDataFeatureState, [entry('a', 'gz:1')]);

      const sub = effects.firePersistedDataChanged$.subscribe();
      // Drive a "loadAllData" boot dispatch by swapping the selector before the
      // gate fires. Effect must NOT emit because the gate is still un-emitted.
      setPluginData([entry('a', 'gz:2')]);

      setTimeout(() => {
        expect(pluginServiceMock.dispatchHookToPlugin).not.toHaveBeenCalled();

        // Now open the gate. The current state becomes the pairwise baseline;
        // still no fire because pairwise needs a second emission.
        gateSubject.next(true);

        setTimeout(() => {
          expect(pluginServiceMock.dispatchHookToPlugin).not.toHaveBeenCalled();
          sub.unsubscribe();
          done();
        }, 0);
      }, 0);
    });

    it('fires once per changed pluginId on local writes after the gate opens', (done) => {
      actions$ = of();
      store.overrideSelector(selectPluginUserDataFeatureState, [entry('a', 'gz:1')]);

      const sub = effects.firePersistedDataChanged$.subscribe();
      gateSubject.next(true);

      // Baseline established; a second emission with changed data fires.
      setPluginData([entry('a', 'gz:2')]);

      setTimeout(() => {
        expect(pluginServiceMock.dispatchHookToPlugin).toHaveBeenCalledTimes(1);
        expect(pluginServiceMock.dispatchHookToPlugin).toHaveBeenCalledWith(
          'a',
          PluginHooks.PERSISTED_DATA_CHANGED,
        );
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('fires the diff after a post-boot wholesale load (SYNC_IMPORT / BACKUP_IMPORT / recovery)', (done) => {
      // Same code path as #post-boot loadAllData — selector emits a new array,
      // differ reports only the entries whose data actually changed.
      actions$ = of();
      store.overrideSelector(selectPluginUserDataFeatureState, [
        entry('keep', 'gz:s'),
        entry('change', 'gz:old'),
        entry('removed', 'gz:gone'),
      ]);

      const sub = effects.firePersistedDataChanged$.subscribe();
      gateSubject.next(true);

      setPluginData([
        entry('keep', 'gz:s'), // unchanged → no fire
        entry('change', 'gz:new'), // updated → fire
        entry('added', 'gz:fresh'), // added → fire
        // 'removed' missing → fire
      ]);

      setTimeout(() => {
        const dispatched = pluginServiceMock.dispatchHookToPlugin.calls
          .allArgs()
          .map(([pluginId]) => pluginId)
          .sort();
        expect(dispatched).toEqual(['added', 'change', 'removed']);
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('isolates handlers per plugin — a change in A does not fire B', (done) => {
      actions$ = of();
      store.overrideSelector(selectPluginUserDataFeatureState, [
        entry('a', 'gz:1'),
        entry('b', 'gz:1'),
      ]);

      const sub = effects.firePersistedDataChanged$.subscribe();
      gateSubject.next(true);

      setPluginData([entry('a', 'gz:2'), entry('b', 'gz:1')]);

      setTimeout(() => {
        expect(pluginServiceMock.dispatchHookToPlugin).toHaveBeenCalledTimes(1);
        expect(pluginServiceMock.dispatchHookToPlugin).toHaveBeenCalledWith(
          'a',
          PluginHooks.PERSISTED_DATA_CHANGED,
        );
        expect(pluginServiceMock.dispatchHookToPlugin).not.toHaveBeenCalledWith(
          'b',
          jasmine.anything(),
        );
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('fires on delete', (done) => {
      actions$ = of();
      store.overrideSelector(selectPluginUserDataFeatureState, [
        entry('a', 'gz:1'),
        entry('b', 'gz:1'),
      ]);

      const sub = effects.firePersistedDataChanged$.subscribe();
      gateSubject.next(true);

      setPluginData([entry('a', 'gz:1')]);

      setTimeout(() => {
        expect(pluginServiceMock.dispatchHookToPlugin).toHaveBeenCalledTimes(1);
        expect(pluginServiceMock.dispatchHookToPlugin).toHaveBeenCalledWith(
          'b',
          PluginHooks.PERSISTED_DATA_CHANGED,
        );
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('collapses keyed entityIds to the owner pluginId and fires once', (done) => {
      // Stage A keyed storage: a plugin with multiple `pluginId:key` entries
      // changing in one emission must fire its handler (registered under the
      // bare pluginId) exactly once.
      actions$ = of();
      store.overrideSelector(selectPluginUserDataFeatureState, [
        entry('foo:doc-1', 'gz:1'),
        entry('foo:doc-2', 'gz:1'),
      ]);

      const sub = effects.firePersistedDataChanged$.subscribe();
      gateSubject.next(true);

      setPluginData([
        entry('foo:doc-1', 'gz:2'), // updated
        entry('foo:doc-2', 'gz:2'), // updated
        entry('foo:doc-3', 'gz:new'), // added
      ]);

      setTimeout(() => {
        expect(pluginServiceMock.dispatchHookToPlugin).toHaveBeenCalledTimes(1);
        expect(pluginServiceMock.dispatchHookToPlugin).toHaveBeenCalledWith(
          'foo',
          PluginHooks.PERSISTED_DATA_CHANGED,
        );
        sub.unsubscribe();
        done();
      }, 0);
    });
  });
});
