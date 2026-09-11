import { TestBed } from '@angular/core/testing';
import { Action } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of, Subject } from 'rxjs';
import { TaskElectronEffects } from './task-electron.effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { GlobalConfigService } from '../../config/global-config.service';
import { FocusModeService } from '../../focus-mode/focus-mode.service';
import { TaskService } from '../task.service';
import { DEFAULT_TASK } from '../task.model';
import { selectCurrentTask } from './task.selectors';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import {
  selectTimer,
  selectIsOverlayShown,
} from '../../focus-mode/store/focus-mode.selectors';
import { FocusModeMode, TimerState } from '../../focus-mode/focus-mode.model';
import { TimeTrackingActions } from '../../time-tracking/store/time-tracking.actions';
import { setCurrentTask } from './task.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';

describe('TaskElectronEffects desktop timer ownership', () => {
  let actions$: Subject<Action>;
  let store: MockStore;
  let effects: TaskElectronEffects;
  let originalEa: typeof window.ea;
  let setProgressBar: jasmine.Spy;
  let updateCurrentTask: jasmine.Spy;
  const task = {
    ...DEFAULT_TASK,
    id: 'task',
    projectId: 'project',
    title: 'Task',
    timeSpent: 60000,
    timeEstimate: 600000,
  };
  const timer: TimerState = {
    purpose: null,
    isRunning: false,
    elapsed: 0,
    duration: 600000,
    startedAt: null,
  };

  beforeEach(() => {
    actions$ = new Subject<Action>();
    originalEa = window.ea;
    setProgressBar = jasmine.createSpy('setProgressBar');
    updateCurrentTask = jasmine.createSpy('updateCurrentTask');
    window.ea = {
      ...originalEa,
      on: jasmine.createSpy('on'),
      onSwitchTask: jasmine.createSpy('onSwitchTask'),
      setProgressBar,
      updateCurrentTask,
    };
    TestBed.configureTestingModule({
      providers: [
        TaskElectronEffects,
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        { provide: GlobalConfigService, useValue: {} },
        { provide: TaskService, useValue: {} },
        {
          provide: FocusModeService,
          useValue: {
            currentSessionTime$: of(300000),
            mode: () => FocusModeMode.Countdown,
          },
        },
        provideMockStore({
          selectors: [
            { selector: selectTimer, value: timer },
            { selector: selectIsOverlayShown, value: false },
            { selector: selectCurrentTask, value: task },
            { selector: selectTodayTaskIds, value: [] },
          ],
        }),
      ],
    });
    store = TestBed.inject(MockStore);
    effects = TestBed.inject(TaskElectronEffects);
  });

  afterEach(() => {
    actions$.complete();
    store.resetSelectors();
    window.ea = originalEa;
  });

  for (const purpose of ['work', 'break'] as const) {
    for (const isRunning of [true, false]) {
      it(`keeps ${purpose} progress and tray time when overlay is hidden (running=${isRunning})`, () => {
        store.overrideSelector(selectTimer, { ...timer, purpose, isRunning });
        store.refreshState();
        const progressSub = effects.setTaskBarProgress$.subscribe();
        const traySub = effects.taskChangeElectron$.subscribe();
        actions$.next(
          TimeTrackingActions.addTimeSpent({
            task,
            date: '2026-09-08',
            duration: 1000,
            isFromTrackingReminder: false,
          }),
        );
        expect(setProgressBar).not.toHaveBeenCalled();
        expect(updateCurrentTask).toHaveBeenCalledWith(
          task,
          false,
          0,
          true,
          300000,
          FocusModeMode.Countdown,
        );
        progressSub.unsubscribe();
        traySub.unsubscribe();
      });
    }
  }

  it('shows ordinary task progress when the overlay is open without a session', () => {
    store.overrideSelector(selectIsOverlayShown, true);
    store.refreshState();
    const sub = effects.setTaskBarProgress$.subscribe();
    actions$.next(
      TimeTrackingActions.addTimeSpent({
        task,
        date: '2026-09-08',
        duration: 1000,
        isFromTrackingReminder: false,
      }),
    );
    expect(setProgressBar).toHaveBeenCalledWith({
      progress: 0.1,
      progressBarMode: 'normal',
    });
    sub.unsubscribe();
  });

  it('does not clear focus progress on task changes', () => {
    store.overrideSelector(selectTimer, { ...timer, purpose: 'break', isRunning: true });
    store.refreshState();
    const subs = [
      effects.setTaskBarNoProgress$.subscribe(),
      effects.clearTaskBarOnTaskDone$.subscribe(),
    ];
    actions$.next(setCurrentTask({ id: null }));
    actions$.next(
      TaskSharedActions.updateTask({ task: { id: task.id, changes: { isDone: true } } }),
    );
    expect(setProgressBar).not.toHaveBeenCalled();
    subs.forEach((sub) => sub.unsubscribe());
  });
});
