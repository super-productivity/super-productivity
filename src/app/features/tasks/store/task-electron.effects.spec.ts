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
import { SchedulingSnapshot, selectTaskSchedulingSnapshot } from './task.selectors';
import {
  selectTodayStr,
  selectStartOfNextDayDiffMs,
} from '../../../root-store/app-state/app-state.selectors';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { MiscConfig } from '../../config/global-config.model';
import { IS_ELECTRON_TOKEN } from '../../../app.constants';

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
  let misc$: BehaviorSubject<Partial<MiscConfig>>;
  let inSyncWindow$: BehaviorSubject<boolean>;
  let initialSyncGateOpen$: BehaviorSubject<boolean>;

  const task: Task = {
    ...DEFAULT_TASK,
    id: 'T1',
    title: 'Task',
    projectId: 'project-1',
    timeSpent: 30 * 60000,
    timeEstimate: 60 * 60000,
  };

  const schedulingTask = (changes: Partial<Task> = {}): SchedulingSnapshot =>
    selectTaskSchedulingSnapshot.projector([{ ...task, ...changes }])[0];

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
    misc$ = new BehaviorSubject<Partial<MiscConfig>>({ isShowDueTaskBadge: true });
    inSyncWindow$ = new BehaviorSubject(false);
    initialSyncGateOpen$ = new BehaviorSubject(true);
    (window as any).ea = {
      on: () => {},
      onSwitchTask: () => {},
      updateCurrentTask: () => {},
      updateTodayTasks: () => {},
      setProgressBar: setProgressBarSpy,
      setDueTaskBadge: jasmine.createSpy('setDueTaskBadge'),
      isMacOS: () => false,
      isLinux: () => false,
    };

    TestBed.configureTestingModule({
      providers: [
        TaskElectronEffects,
        { provide: IS_ELECTRON_TOKEN, useValue: true },
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [
            { selector: selectCurrentTask, value: task },
            { selector: selectTaskEntities, value: { T1: task } },
            { selector: selectTodayTaskIds, value: [] },
            {
              selector: selectTaskSchedulingSnapshot,
              value: [schedulingTask({ dueDay: '2026-10-03' })],
            },
            { selector: selectTodayStr, value: '2026-10-03' },
            { selector: selectStartOfNextDayDiffMs, value: 0 },
            { selector: selectIsOverlayShown, value: false },
            { selector: selectIsOsProgressBarOwnedBySession, value: false },
          ],
        }),
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        { provide: GlobalConfigService, useValue: { misc$ } },
        {
          provide: HydrationStateService,
          useValue: {
            isInSyncWindow$: inSyncWindow$,
            isInSyncWindow: () => inSyncWindow$.value,
          },
        },
        {
          provide: SyncTriggerService,
          useValue: {
            initialSyncGateOpen$,
            isInitialSyncDoneSync: () => initialSyncGateOpen$.value,
          },
        },
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

  describe('syncDueTaskBadge$', () => {
    it('updates on completion and clears the badge when disabled', () => {
      const counts: number[] = [];
      const sub = effects.syncDueTaskBadge$.subscribe((count) => counts.push(count));
      expect(counts).toEqual([1]);
      expect(window.ea.setDueTaskBadge).toHaveBeenCalledWith(
        1,
        jasmine.stringMatching(/^data:image\/png;base64,/),
      );
      store.overrideSelector(selectTaskSchedulingSnapshot, [
        schedulingTask({ dueDay: '2026-10-03', isDone: true }),
      ]);
      store.refreshState();
      expect(counts).toEqual([1, 0]);
      expect(window.ea.setDueTaskBadge).toHaveBeenCalledWith(0, undefined);
      store.overrideSelector(selectTaskSchedulingSnapshot, [
        schedulingTask({ dueDay: '2026-10-02' }),
      ]);
      store.refreshState();
      misc$.next({ isShowDueTaskBadge: false });
      expect(counts).toEqual([1, 0, 1, 0]);
      sub.unsubscribe();
    });

    it('publishes the latest count after a sync window without another task change', () => {
      inSyncWindow$.next(true);
      initialSyncGateOpen$.next(false);
      const counts: number[] = [];
      const sub = effects.syncDueTaskBadge$.subscribe((count) => counts.push(count));
      expect(counts).toEqual([]);
      store.overrideSelector(selectTaskSchedulingSnapshot, [
        schedulingTask({ dueDay: '2026-10-03' }),
        schedulingTask({ id: 'T2', dueDay: '2026-10-02' }),
      ]);
      store.refreshState();
      initialSyncGateOpen$.next(true);
      expect(counts).toEqual([]);
      inSyncWindow$.next(false);
      expect(counts).toEqual([2]);
      sub.unsubscribe();
    });
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
