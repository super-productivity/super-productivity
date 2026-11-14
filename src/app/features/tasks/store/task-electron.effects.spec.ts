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
import {
  selectCurrentTask,
  selectCurrentTaskId,
  selectTaskEntities,
} from './task.selectors';
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
import { IPC } from '../../../../../electron/shared-with-frontend/ipc-events.const';

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
  let eaHandlers: Map<string, (...args: unknown[]) => void>;
  let taskServiceMock: {
    setCurrentId: jasmine.Spy;
    currentTaskId: jasmine.Spy;
    toggleStartTask: jasmine.Spy;
    setDone: jasmine.Spy;
    add: jasmine.Spy;
    scheduleForTodayById: jasmine.Spy;
  };

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
    eaHandlers = new Map();
    taskServiceMock = {
      setCurrentId: jasmine.createSpy('setCurrentId'),
      currentTaskId: jasmine.createSpy('currentTaskId').and.returnValue(task.id),
      toggleStartTask: jasmine.createSpy('toggleStartTask'),
      setDone: jasmine.createSpy('setDone'),
      add: jasmine.createSpy('add').and.returnValue('T2'),
      scheduleForTodayById: jasmine.createSpy('scheduleForTodayById'),
    };
    (window as any).ea = {
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        eaHandlers.set(channel, listener);
      },
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
            { selector: selectCurrentTaskId, value: task.id },
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
        { provide: TaskService, useValue: taskServiceMock },
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

  describe('menu bar panel actions', () => {
    it('starts a task that is not current', () => {
      taskServiceMock.currentTaskId.and.returnValue('other');

      eaHandlers.get(IPC.MENU_BAR_PANEL_TOGGLE_TASK)?.('T1');

      expect(taskServiceMock.setCurrentId).toHaveBeenCalledWith('T1');
      expect(taskServiceMock.toggleStartTask).not.toHaveBeenCalled();
    });

    it('toggles the current task off when it is clicked again', () => {
      eaHandlers.get(IPC.MENU_BAR_PANEL_TOGGLE_TASK)?.('T1');

      expect(taskServiceMock.toggleStartTask).toHaveBeenCalled();
      expect(taskServiceMock.setCurrentId).not.toHaveBeenCalled();
    });

    it('completes the requested task', () => {
      eaHandlers.get(IPC.MENU_BAR_PANEL_COMPLETE_TASK)?.('T2');

      expect(taskServiceMock.setDone).toHaveBeenCalledWith('T2');
    });

    it('adds a trimmed task and schedules it for today', () => {
      eaHandlers.get(IPC.MENU_BAR_PANEL_ADD_TASK)?.('  Write the report  ');

      expect(taskServiceMock.add).toHaveBeenCalledWith(
        'Write the report',
        false,
        {},
        false,
        true,
      );
      expect(taskServiceMock.scheduleForTodayById).toHaveBeenCalledWith('T2');
    });

    it('ignores empty titles and malformed payloads', () => {
      eaHandlers.get(IPC.MENU_BAR_PANEL_ADD_TASK)?.('   ');
      eaHandlers.get(IPC.MENU_BAR_PANEL_ADD_TASK)?.({ title: 'x' });
      eaHandlers.get(IPC.MENU_BAR_PANEL_TOGGLE_TASK)?.('');

      expect(taskServiceMock.add).not.toHaveBeenCalled();
      expect(taskServiceMock.setCurrentId).not.toHaveBeenCalled();
    });
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

    it('sends nothing to the main process while the badge was never enabled', () => {
      misc$.next({ isShowDueTaskBadge: false });
      const counts: number[] = [];
      const sub = effects.syncDueTaskBadge$.subscribe((count) => counts.push(count));
      store.overrideSelector(selectTaskSchedulingSnapshot, []);
      store.refreshState();
      expect(counts).toEqual([]);
      expect(window.ea.setDueTaskBadge).not.toHaveBeenCalled();
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

  describe('syncTodayTasksToElectron$', () => {
    it('should resend the Today list when a title changes, not when only time does', () => {
      const updateTodayTasksSpy = jasmine.createSpy('updateTodayTasks');
      (window as any).ea.updateTodayTasks = updateTodayTasksSpy;
      store.overrideSelector(selectTodayTaskIds, ['T1']);
      store.refreshState();

      const sub = effects.syncTodayTasksToElectron$.subscribe();
      expect(updateTodayTasksSpy).toHaveBeenCalledTimes(1);

      store.overrideSelector(selectTaskEntities, {
        T1: { ...task, timeSpent: task.timeSpent + 60000 },
      });
      store.refreshState();
      expect(updateTodayTasksSpy).toHaveBeenCalledTimes(1);

      store.overrideSelector(selectTaskEntities, { T1: { ...task, title: 'Renamed' } });
      store.refreshState();
      sub.unsubscribe();

      expect(updateTodayTasksSpy).toHaveBeenCalledTimes(2);
      expect(updateTodayTasksSpy.calls.mostRecent().args[0]).toEqual([
        jasmine.objectContaining({ id: 'T1', title: 'Renamed' }),
      ]);
    });

    it('should drop a task from the list once it is done', () => {
      const updateTodayTasksSpy = jasmine.createSpy('updateTodayTasks');
      (window as any).ea.updateTodayTasks = updateTodayTasksSpy;
      store.overrideSelector(selectTodayTaskIds, ['T1']);
      store.refreshState();

      const sub = effects.syncTodayTasksToElectron$.subscribe();
      store.overrideSelector(selectTaskEntities, { T1: { ...task, isDone: true } });
      store.refreshState();
      sub.unsubscribe();

      expect(updateTodayTasksSpy.calls.mostRecent().args[0]).toEqual([]);
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

    it('should ignore time added to a task that is not being tracked', () => {
      store.overrideSelector(selectCurrentTaskId, 'OTHER');
      store.refreshState();

      const sub = effects.setTaskBarProgress$.subscribe();
      actions$.next(addTimeSpent());
      sub.unsubscribe();

      expect(setProgressBarSpy).not.toHaveBeenCalled();
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
