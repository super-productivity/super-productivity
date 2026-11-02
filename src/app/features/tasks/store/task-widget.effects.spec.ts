import { signal, WritableSignal } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { IPC } from '../../../../../electron/shared-with-frontend/ipc-events.const';
import { CustomThemeService } from '../../../core/theme/custom-theme.service';
import { GlobalThemeService } from '../../../core/theme/global-theme.service';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TaskWidgetSettingsService } from '../../config/task-widget-settings.service';
import { selectTimer } from '../../focus-mode/store/focus-mode.selectors';
import { selectProjectFeatureState } from '../../project/store/project.selectors';
import { WorkContextService } from '../../work-context/work-context.service';
import { DEFAULT_TASK, Task } from '../task.model';
import { TaskService } from '../task.service';
import { unsetCurrentTask } from './task.actions';
import { selectCurrentTask, selectLastCurrentTask } from './task.selectors';
import { TaskWidgetEffects } from './task-widget.effects';

const IDLE_TIMER = {
  isRunning: false,
  startedAt: null,
  elapsed: 0,
  duration: 0,
  purpose: null,
};

describe('TaskWidgetEffects', () => {
  let actions$: Subject<any>;
  let store: MockStore;
  let ipcListeners: Map<string, () => void>;
  let updateViewSpy: jasmine.Spy;
  let setDoneSpy: jasmine.Spy;
  let isEnabled: WritableSignal<boolean>;

  const task: Task = {
    ...DEFAULT_TASK,
    id: 'T1',
    title: 'Current task',
    projectId: 'P1',
  };
  const lastTask: Task = { ...task, id: 'T2', title: 'Paused task' };

  const projectState = {
    ids: ['P1'],
    entities: { P1: { id: 'P1', title: 'Website', theme: { primary: '#29a1aa' } } },
  };

  const setTasks = (current: Task | null, last: Task | null): void => {
    store.overrideSelector(selectCurrentTask, current);
    store.overrideSelector(selectLastCurrentTask, last);
    store.refreshState();
  };

  const requestView = (): void => {
    ipcListeners.get(IPC.REQUEST_CURRENT_TASK_FOR_TASK_WIDGET)?.();
    tick(600);
  };

  beforeEach(() => {
    actions$ = new Subject<any>();
    ipcListeners = new Map();
    updateViewSpy = jasmine.createSpy('updateTaskWidgetView');
    setDoneSpy = jasmine.createSpy('setDone');
    isEnabled = signal(true);
    (window as any).ea = {
      on: (channel: string, listener: () => void) => ipcListeners.set(channel, listener),
      updateTaskWidgetView: updateViewSpy,
    };

    TestBed.configureTestingModule({
      providers: [
        TaskWidgetEffects,
        provideMockStore({
          selectors: [
            { selector: selectCurrentTask, value: task },
            { selector: selectLastCurrentTask, value: null },
            { selector: selectTimer, value: IDLE_TIMER },
            { selector: selectProjectFeatureState, value: projectState },
          ],
        }),
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        { provide: TaskService, useValue: { setDone: setDoneSpy } },
        { provide: GlobalThemeService, useValue: { isDarkTheme: signal(true) } },
        { provide: CustomThemeService, useValue: { appliedThemeVersion: signal(0) } },
        { provide: WorkContextService, useValue: { currentTheme$: new Subject() } },
        {
          provide: TranslateService,
          useValue: { instant: (key: string) => key, onLangChange: new Subject() },
        },
        {
          provide: TaskWidgetSettingsService,
          useValue: { settings: () => ({ isEnabled: isEnabled() }) },
        },
      ],
    });

    store = TestBed.inject(MockStore);
  });

  const start = (): void => {
    TestBed.inject(TaskWidgetEffects).updateTaskWidgetView$.subscribe();
    tick(600);
  };

  it('answers the widget when it asks for its content', fakeAsync(() => {
    start();
    tick(600);
    updateViewSpy.calls.reset();

    requestView();

    expect(updateViewSpy).toHaveBeenCalledTimes(1);
    expect(updateViewSpy.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        title: 'Current task',
        projectTitle: 'Website',
        isPaused: false,
      }),
    );
  }));

  it('sends nothing while the widget is turned off', fakeAsync(() => {
    isEnabled.set(false);
    start();
    tick(600);

    requestView();
    actions$.next(unsetCurrentTask());
    tick(600);

    expect(updateViewSpy).not.toHaveBeenCalled();
  }));

  it('shows the last task as paused once tracking stops', fakeAsync(() => {
    start();
    tick(600);
    setTasks(null, lastTask);
    updateViewSpy.calls.reset();

    actions$.next(unsetCurrentTask());
    tick(600);

    expect(updateViewSpy.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ title: 'Paused task', isPaused: true }),
    );
  }));

  it('shows the empty state when the last task is already done', fakeAsync(() => {
    start();
    tick(600);
    setTasks(null, { ...lastTask, isDone: true });
    updateViewSpy.calls.reset();

    requestView();

    expect(updateViewSpy.calls.mostRecent().args[0].mode).toBe('idle');
  }));

  it('sends the theme the app is using right now', fakeAsync(() => {
    document.body.style.setProperty('--brand', 'rgb(1, 2, 3)');
    start();
    updateViewSpy.calls.reset();

    requestView();

    expect(updateViewSpy.calls.mostRecent().args[0].theme.primary).toBe('rgb(1, 2, 3)');
    document.body.style.removeProperty('--brand');
  }));

  it('marks the running task as done', fakeAsync(() => {
    start();

    ipcListeners.get(IPC.TASK_WIDGET_MARK_DONE)?.();

    expect(setDoneSpy).toHaveBeenCalledOnceWith('T1');
  }));

  it('marks the paused task as done, since that is the one on screen', fakeAsync(() => {
    start();
    setTasks(null, lastTask);

    ipcListeners.get(IPC.TASK_WIDGET_MARK_DONE)?.();

    expect(setDoneSpy).toHaveBeenCalledOnceWith('T2');
  }));

  it('does nothing for Done when no task is shown', fakeAsync(() => {
    start();
    setTasks(null, null);

    ipcListeners.get(IPC.TASK_WIDGET_MARK_DONE)?.();

    expect(setDoneSpy).not.toHaveBeenCalled();
  }));
});
