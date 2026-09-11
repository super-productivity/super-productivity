import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { TaskElectronEffects } from './task-electron.effects';
import { TimeTrackingActions } from '../../time-tracking/store/time-tracking.actions';
import {
  selectIsOsProgressBarOwnedBySession,
  selectIsOverlayShown,
} from '../../focus-mode/store/focus-mode.selectors';
import { selectCurrentTask, selectTaskEntities } from './task.selectors';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import { GlobalConfigService } from '../../config/global-config.service';
import { FocusModeService } from '../../focus-mode/focus-mode.service';
import { TaskService } from '../task.service';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { DEFAULT_TASK, Task } from '../task.model';

/**
 * The OS progress bar (taskbar/dock) must only ever have one writer: a timed
 * focus session publishes its own progress, and this effect has to stand down
 * for exactly as long as that is true. Gating on the focus overlay being
 * *shown* instead left both writers active whenever the overlay was hidden, so
 * the bar cycled between the two values every second (#9944).
 */
describe('TaskElectronEffects', () => {
  let effects: TaskElectronEffects;
  let actions$: Subject<any>;
  let store: MockStore;
  let setProgressBarSpy: jasmine.Spy;

  const task: Task = {
    ...DEFAULT_TASK,
    id: 'T1',
    title: 'Task',
    projectId: 'project-1',
    timeSpent: 30 * 60000,
    timeEstimate: 60 * 60000,
  };

  const addTimeSpent = (): ReturnType<typeof TimeTrackingActions.addTimeSpent> =>
    TimeTrackingActions.addTimeSpent({
      task,
      date: '2026-01-05',
      duration: 1000,
      isFromTrackingReminder: false,
    });

  beforeEach(() => {
    actions$ = new Subject<any>();
    setProgressBarSpy = jasmine.createSpy('setProgressBar');
    (window as any).ea = {
      on: () => {},
      onSwitchTask: () => {},
      updateCurrentTask: () => {},
      updateTodayTasks: () => {},
      setProgressBar: setProgressBarSpy,
    };

    TestBed.configureTestingModule({
      providers: [
        TaskElectronEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [
            { selector: selectCurrentTask, value: task },
            { selector: selectTaskEntities, value: { T1: task } },
            { selector: selectTodayTaskIds, value: [] },
            { selector: selectIsOverlayShown, value: false },
            { selector: selectIsOsProgressBarOwnedBySession, value: false },
          ],
        }),
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        { provide: GlobalConfigService, useValue: {} },
        { provide: TaskService, useValue: { setCurrentId: () => {} } },
        {
          provide: FocusModeService,
          useValue: {
            currentSessionTime$: new BehaviorSubject(0),
            mode: () => 'Flowtime',
          },
        },
      ],
    });

    effects = TestBed.inject(TaskElectronEffects);
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    store.resetSelectors();
    delete (window as any).ea;
  });

  describe('setTaskBarProgress$', () => {
    it('should publish task progress while no focus session owns the bar', () => {
      const sub = effects.setTaskBarProgress$.subscribe();
      actions$.next(addTimeSpent());
      sub.unsubscribe();

      expect(setProgressBarSpy).toHaveBeenCalledWith({
        progress: 0.5,
        progressBarMode: 'normal',
      });
    });

    it('should stand down while a timed focus session owns the bar', () => {
      store.overrideSelector(selectIsOsProgressBarOwnedBySession, true);
      store.refreshState();

      const sub = effects.setTaskBarProgress$.subscribe();
      actions$.next(addTimeSpent());
      sub.unsubscribe();

      expect(setProgressBarSpy).not.toHaveBeenCalled();
    });

    // An open-ended (Flowtime) session owns nothing, so the task progress has to
    // keep flowing even though the focus overlay may be hidden or shown.
    it('should keep publishing during an open-ended focus session', () => {
      store.overrideSelector(selectIsOverlayShown, true);
      store.overrideSelector(selectIsOsProgressBarOwnedBySession, false);
      store.refreshState();

      const sub = effects.setTaskBarProgress$.subscribe();
      actions$.next(addTimeSpent());
      sub.unsubscribe();

      expect(setProgressBarSpy).toHaveBeenCalledWith({
        progress: 0.5,
        progressBarMode: 'normal',
      });
    });
  });
});
