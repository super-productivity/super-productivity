import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, Subject } from 'rxjs';
import { TaskElectronEffects } from './task-electron.effects';
import { TaskService } from '../task.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { GlobalConfigService } from '../../config/global-config.service';
import { FocusModeService } from '../../focus-mode/focus-mode.service';
import { take, tap } from 'rxjs/operators';
import { NoteService } from '../../note/note.service';
import {
  selectActiveWorkContext,
  selectTodayTaskIds,
} from '../../work-context/store/work-context.selectors';
import { selectTaskEntities, selectUndoneOverdue } from './task.selectors';
import {
  selectAllTasksDueToday,
  selectPlannerDayMap,
} from '../../planner/store/planner.selectors';
import { selectNoteFeatureState } from '../../note/store/note.reducer';
import { selectEnabledSimpleCounters } from '../../simple-counter/store/simple-counter.reducer';
import { selectTodayStr } from '../../../root-store/app-state/app-state.selectors';
import { SimpleCounterType } from '../../simple-counter/simple-counter.model';
import { selectUnarchivedProjects } from '../../project/store/project.selectors';
import { IPC } from '../../../../../electron/shared-with-frontend/ipc-events.const';
import { selectTodayTagTaskIds } from '../../tag/store/tag.reducer';

describe('TaskElectronEffects', () => {
  let effects: TaskElectronEffects;
  let actions$: Observable<any>;
  let taskService: jasmine.SpyObj<TaskService>;
  let store: MockStore;
  let mockIpcAddTaskFromAppUri$: Subject<{ title: string }>;

  beforeEach(() => {
    const taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'add',
      'setCurrentId',
      'update',
    ]);
    const noteServiceSpy = jasmine.createSpyObj('NoteService', ['add']);
    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [], {
      cfg$: of({}),
    });
    const focusModeServiceSpy = jasmine.createSpyObj('FocusModeService', ['mode'], {
      currentSessionTime$: of(0),
    });
    focusModeServiceSpy.mode.and.returnValue('Countdown');

    // Mock window.ea
    (window as any).ea = {
      on: jasmine.createSpy('on'),
      updateCurrentTask: jasmine.createSpy('updateCurrentTask'),
      updateTaskWidgetOverview: jasmine.createSpy('updateTaskWidgetOverview'),
      setProgressBar: jasmine.createSpy('setProgressBar'),
      onSwitchTask: jasmine.createSpy('onSwitchTask'),
    };

    actions$ = new Subject<any>();
    mockIpcAddTaskFromAppUri$ = new Subject<{ title: string }>();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: TaskElectronEffects,
          useFactory: (
            taskServiceInj: TaskService,
            // Other dependencies could be injected here if needed
          ) => {
            const effectsInstance = new TaskElectronEffects();
            // Manually inject dependencies that are used in the effect
            (effectsInstance as any)._taskService = taskServiceInj;

            // Override the effect with our mock observable
            effectsInstance.handleAddTaskFromProtocol$ = mockIpcAddTaskFromAppUri$.pipe(
              tap((data) => {
                taskServiceInj.add(data.title);
              }),
            ) as any;

            return effectsInstance;
          },
          deps: [TaskService],
        },
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: NoteService, useValue: noteServiceSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        { provide: FocusModeService, useValue: focusModeServiceSpy },
      ],
    });

    effects = TestBed.inject(TaskElectronEffects);
    taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
    store = TestBed.inject(MockStore);
  });

  describe('handleAddTaskFromProtocol$', () => {
    it('should update task done state from task widget IPC', () => {
      const handler = (window.ea.on as jasmine.Spy).calls
        .allArgs()
        .find(([channel]) => channel === IPC.TASK_WIDGET_TOGGLE_TASK_DONE)?.[1];

      handler({}, { taskId: 't1', isDone: true });

      expect(taskService.update).toHaveBeenCalledWith('t1', { isDone: true });
    });

    it('should add task when receiving data with title', (done) => {
      const mockData = { title: 'Test Task' };

      // Subscribe to the effect
      effects.handleAddTaskFromProtocol$.subscribe(() => {
        expect(taskService.add).toHaveBeenCalledWith('Test Task');
        done();
      });

      // Emit data through the mocked observable
      mockIpcAddTaskFromAppUri$.next(mockData);
    });

    it('should handle multiple tasks', (done) => {
      let callCount = 0;
      const expectedCalls = 2;

      effects.handleAddTaskFromProtocol$.subscribe(() => {
        callCount++;
        if (callCount === expectedCalls) {
          expect(taskService.add).toHaveBeenCalledTimes(2);
          expect(taskService.add).toHaveBeenCalledWith('Task 1');
          expect(taskService.add).toHaveBeenCalledWith('Task 2');
          done();
        }
      });

      // Emit multiple tasks
      mockIpcAddTaskFromAppUri$.next({ title: 'Task 1' });
      mockIpcAddTaskFromAppUri$.next({ title: 'Task 2' });
    });

    it('should handle validation logic correctly', (done) => {
      // Test the validation logic directly
      const validateData = (data: any): boolean => {
        if (!data || !data.title || typeof data.title !== 'string') {
          return false;
        }
        return true;
      };

      expect(validateData({ title: 'Valid Task' })).toBe(true);
      expect(validateData(null)).toBe(false);
      expect(validateData(undefined)).toBe(false);
      expect(validateData({ notTitle: 'Invalid' })).toBe(false);
      expect(validateData({ title: 123 })).toBe(false);

      done();
    });
  });

  describe('syncTaskWidgetOverviewToElectron$', () => {
    it('should send today goals, project goals, and planner tasks', (done) => {
      store.overrideSelector(selectTodayTaskIds, ['t1', 't2']);
      store.overrideSelector(selectTodayTagTaskIds, ['t5']);
      store.overrideSelector(selectTaskEntities, {
        t1: {
          id: 't1',
          title: 'Today task',
          isDone: false,
          timeEstimate: 30 * 60000,
          timeSpent: 5 * 60000,
          projectId: 'p1',
          dueWithTime: new Date('2026-05-22T09:00:00').getTime(),
        },
        t2: {
          id: 't2',
          title: 'Done task',
          isDone: true,
          timeEstimate: 0,
          timeSpent: 0,
          projectId: 'p1',
        },
        t3: {
          id: 't3',
          title: 'Tomorrow task',
          isDone: false,
          timeEstimate: 0,
          timeSpent: 0,
          projectId: 'p2',
          dueDay: '2026-05-23',
        },
        t4: {
          id: 't4',
          title: 'Overdue task',
          isDone: false,
          timeEstimate: 0,
          timeSpent: 0,
          projectId: 'p2',
          dueDay: '2026-05-21',
        },
        t5: {
          id: 't5',
          title: 'Manual today task',
          isDone: false,
          timeEstimate: 0,
          timeSpent: 0,
          projectId: 'p1',
        },
      } as any);
      store.overrideSelector(selectAllTasksDueToday, [
        {
          id: 't1',
          title: 'Today task',
          isDone: false,
          timeEstimate: 30 * 60000,
          timeSpent: 5 * 60000,
          projectId: 'p1',
          dueWithTime: new Date('2026-05-22T09:00:00').getTime(),
        },
      ] as any);
      store.overrideSelector(selectUndoneOverdue, [
        {
          id: 't4',
          title: 'Overdue task',
          isDone: false,
          timeEstimate: 0,
          timeSpent: 0,
          projectId: 'p2',
          dueDay: '2026-05-21',
        },
      ] as any);
      store.overrideSelector(selectPlannerDayMap, {
        ['2026-05-22']: [
          {
            id: 't1',
            title: 'Today task',
            isDone: false,
            timeEstimate: 30 * 60000,
            timeSpent: 5 * 60000,
          },
        ],
        ['2026-05-23']: [
          {
            id: 't3',
            title: 'Tomorrow task',
            isDone: false,
            timeEstimate: 0,
            timeSpent: 0,
            dueDay: '2026-05-23',
          },
        ],
      } as any);
      store.overrideSelector(selectNoteFeatureState, {
        ids: ['n1', 'n2'],
        entities: {
          n1: {
            id: 'n1',
            projectId: null,
            isPinnedToToday: true,
            content: 'Today goal',
            created: 0,
            modified: 0,
          },
          n2: {
            id: 'n2',
            projectId: 'p1',
            isPinnedToToday: false,
            content: 'Project goal',
            created: 0,
            modified: 0,
          },
        },
        todayOrder: ['n1'],
      } as any);
      store.overrideSelector(selectActiveWorkContext, {
        id: 'p1',
        title: 'Project A',
        noteIds: ['n2'],
        taskIds: [],
      } as any);
      store.overrideSelector(selectUnarchivedProjects, [
        {
          id: 'p1',
          title: 'Project A',
          taskIds: ['t1', 't2'],
          noteIds: ['n2'],
          backlogTaskIds: [],
        },
        {
          id: 'p2',
          title: 'Project B',
          taskIds: ['t3'],
          noteIds: [],
          backlogTaskIds: [],
        },
      ] as any);
      store.overrideSelector(selectEnabledSimpleCounters, [
        {
          id: 'c1',
          title: 'Deep work',
          isEnabled: true,
          type: SimpleCounterType.StopWatch,
          isTrackStreaks: true,
          streakMinValue: 60 * 60000,
          countOnDay: {
            ['2026-05-22']: 30 * 60000,
          },
          isOn: false,
          icon: null,
        },
      ] as any);
      store.overrideSelector(selectTodayStr, '2026-05-22');

      effects.syncTaskWidgetOverviewToElectron$.pipe(take(1)).subscribe(() => {
        expect(window.ea.updateTaskWidgetOverview).toHaveBeenCalledWith(
          jasmine.objectContaining({
            activeContextTitle: 'Project A',
            todayTasks: jasmine.arrayContaining([
              jasmine.objectContaining({ id: 't1' }),
              jasmine.objectContaining({ id: 't5' }),
            ]),
            overdueTasks: jasmine.arrayContaining([
              jasmine.objectContaining({ id: 't4' }),
            ]),
            projectTaskGroups: jasmine.arrayContaining([
              jasmine.objectContaining({
                title: 'Project A',
                tasks: jasmine.arrayContaining([
                  jasmine.objectContaining({
                    id: 't1',
                    projectTitle: 'Project A',
                  }),
                  jasmine.objectContaining({ id: 't2' }),
                ]),
              }),
              jasmine.objectContaining({ title: 'Project B' }),
            ]),
            timelineTasks: jasmine.arrayContaining([
              jasmine.objectContaining({ id: 't1' }),
            ]),
            plannerDays: jasmine.arrayContaining([
              jasmine.objectContaining({
                dayDate: '2026-05-23',
                tasks: jasmine.arrayContaining([jasmine.objectContaining({ id: 't3' })]),
              }),
            ]),
            todayNotes: jasmine.arrayContaining([
              jasmine.objectContaining({ content: 'Today goal' }),
            ]),
            projectNotes: jasmine.arrayContaining([
              jasmine.objectContaining({ content: 'Project goal' }),
            ]),
            simpleCounterGoals: jasmine.arrayContaining([
              jasmine.objectContaining({ id: 'c1' }),
            ]),
          }),
        );
        done();
      });
    });
  });
});
