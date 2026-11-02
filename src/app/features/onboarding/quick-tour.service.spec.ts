import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Event, NavigationEnd, Router } from '@angular/router';
import { Action } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { LS } from '../../core/persistence/storage-keys.const';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { GlobalConfigService } from '../config/global-config.service';
import { addProject } from '../project/store/project.actions';
import { Project } from '../project/project.model';
import { addTag } from '../tag/store/tag.actions';
import { Tag } from '../tag/tag.model';
import { addSubTask, setCurrentTask } from '../tasks/store/task.actions';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { Task } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { TaskFocusService } from '../tasks/task-focus.service';
import { selectUndoneTodayTaskIds } from '../work-context/store/work-context.selectors';
import {
  getQuickTourSteps,
  QUICK_TOUR_ACK_MS,
  QuickTourService,
  QuickTourStep,
} from './quick-tour.service';

const makeTask = (id: string, partial: Partial<Task> = {}): Task =>
  ({ id, title: id, isDone: false, subTaskIds: [], ...partial }) as Task;

const DESKTOP_STEPS: QuickTourStep[] = [
  'track-time',
  'add-subtask',
  'organize',
  'planner',
  'want-more',
];

describe('getQuickTourSteps', () => {
  const ctx = {
    isTouch: false,
    isTimeTrackingEnabled: true,
    isPlannerEnabled: true,
    hasTask: true,
    isTaskMenuLearned: false,
  };

  it('has five steps on desktop, task steps first', () => {
    expect(getQuickTourSteps(ctx)).toEqual(DESKTOP_STEPS);
  });

  it('merges the task steps into the swipe menu on touch', () => {
    expect(getQuickTourSteps({ ...ctx, isTouch: true })).toEqual([
      'task-menu',
      'organize',
      'planner',
      'want-more',
    ]);
  });

  it('drops the swipe menu step on touch once part 1 taught it', () => {
    expect(getQuickTourSteps({ ...ctx, isTouch: true, isTaskMenuLearned: true })).toEqual(
      ['organize', 'planner', 'want-more'],
    );
  });

  it('keeps the desktop task steps when the swipe menu was learned', () => {
    expect(getQuickTourSteps({ ...ctx, isTaskMenuLearned: true })).toEqual(DESKTOP_STEPS);
  });

  it('skips time tracking and Planner when they are switched off', () => {
    expect(
      getQuickTourSteps({
        ...ctx,
        isTimeTrackingEnabled: false,
        isPlannerEnabled: false,
      }),
    ).toEqual(['add-subtask', 'organize', 'want-more']);
  });

  it('skips the task steps without a task', () => {
    expect(getQuickTourSteps({ ...ctx, hasTask: false })).toEqual([
      'organize',
      'planner',
      'want-more',
    ]);
  });
});

describe('QuickTourService', () => {
  let store: MockStore;
  let localActions$: Subject<Action>;
  let routerEvents$: Subject<Event>;
  let router: {
    events: Subject<Event>;
    url: string;
    navigateByUrl: jasmine.Spy;
    navigate: jasmine.Spy;
  };
  let isShowAddTaskBar: WritableSignal<boolean>;
  let isTaskContextMenuOpen: WritableSignal<boolean>;
  let currentTaskId: WritableSignal<string | null>;
  let appFeatures: WritableSignal<{
    isTimeTrackingEnabled: boolean;
    isPlannerEnabled: boolean;
  }>;
  let savedState: string | null;

  const setTasks = (tasks: Task[], todayIds = tasks.map((t) => t.id)): void => {
    store.overrideSelector(
      selectTaskEntities,
      Object.fromEntries(tasks.map((t) => [t.id, t])),
    );
    store.overrideSelector(selectUndoneTodayTaskIds, todayIds);
    store.refreshState();
  };

  const createService = (): QuickTourService => TestBed.inject(QuickTourService);

  const ackAndAdvance = (): void => jasmine.clock().tick(QUICK_TOUR_ACK_MS);

  beforeEach(() => {
    savedState = localStorage.getItem(LS.QUICK_TOUR_STATE);
    localStorage.removeItem(LS.QUICK_TOUR_STATE);
    jasmine.clock().install();

    localActions$ = new Subject<Action>();
    routerEvents$ = new Subject<Event>();
    router = {
      events: routerEvents$,
      url: '/tag/TODAY/tasks',
      navigateByUrl: jasmine.createSpy('navigateByUrl').and.resolveTo(true),
      navigate: jasmine.createSpy('navigate').and.resolveTo(true),
    };
    isShowAddTaskBar = signal(false);
    isTaskContextMenuOpen = signal(false);
    currentTaskId = signal(null);
    appFeatures = signal({ isTimeTrackingEnabled: true, isPlannerEnabled: true });

    TestBed.configureTestingModule({
      providers: [
        QuickTourService,
        provideMockStore(),
        { provide: LOCAL_ACTIONS, useValue: localActions$ },
        { provide: Router, useValue: router },
        { provide: LayoutService, useValue: { isShowAddTaskBar } },
        { provide: TaskService, useValue: { currentTaskId } },
        { provide: TaskFocusService, useValue: { isTaskContextMenuOpen } },
        { provide: GlobalConfigService, useValue: { appFeatures } },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: new BehaviorSubject(true) },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    setTasks([makeTask('task-1')]);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    store.resetSelectors();
    if (savedState === null) {
      localStorage.removeItem(LS.QUICK_TOUR_STATE);
    } else {
      localStorage.setItem(LS.QUICK_TOUR_STATE, savedState);
    }
  });

  it('runs the desktop steps when each is done, with a ✓ beat in between', () => {
    const service = createService();
    service.start('task-1');
    expect(service.currentStep()).toBe('track-time');
    expect(service.stepNr()).toBe(1);
    expect(service.stepCount()).toBe(5);

    localActions$.next(setCurrentTask({ id: 'task-1' }));
    expect(service.isAcknowledging()).toBeTrue();
    expect(service.currentStep()).toBe('track-time');
    ackAndAdvance();
    expect(service.currentStep()).toBe('add-subtask');

    localActions$.next(addSubTask({ task: makeTask('sub'), parentId: 'task-1' }));
    ackAndAdvance();
    expect(service.currentStep()).toBe('organize');

    localActions$.next(addTag({ tag: { id: 'tag' } as Tag }));
    ackAndAdvance();
    expect(service.currentStep()).toBe('planner');

    routerEvents$.next(new NavigationEnd(1, '/planner', '/planner'));
    ackAndAdvance();
    expect(service.currentStep()).toBe('want-more');
    expect(service.stepNr()).toBe(5);
  });

  it('counts a new project for the organize step', () => {
    setTasks([]);
    const service = createService();
    service.start(null);
    expect(service.currentStep()).toBe('organize');
    localActions$.next(addProject({ project: { id: 'p' } as Project }));
    ackAndAdvance();
    expect(service.currentStep()).toBe('planner');
  });

  it('ignores actions that belong to another step', () => {
    const service = createService();
    service.start('task-1');
    localActions$.next(addTag({ tag: { id: 'tag' } as Tag }));
    localActions$.next(setCurrentTask({ id: null }));
    ackAndAdvance();
    expect(service.currentStep()).toBe('track-time');
    expect(service.isAcknowledging()).toBeFalse();
  });

  it('Next always moves on, and past the last step ends the tour', () => {
    const service = createService();
    service.start('task-1');
    for (const step of DESKTOP_STEPS) {
      expect(service.currentStep()).toBe(step);
      service.next();
    }
    expect(service.isActive()).toBeFalse();
    expect(localStorage.getItem(LS.QUICK_TOUR_STATE)).toBeNull();
  });

  it('ends on ✕ and forgets the saved step', () => {
    const service = createService();
    service.start('task-1');
    expect(localStorage.getItem(LS.QUICK_TOUR_STATE)).not.toBeNull();
    service.end();
    expect(service.currentStep()).toBeNull();
    expect(localStorage.getItem(LS.QUICK_TOUR_STATE)).toBeNull();
  });

  it('skips a step whose anchor is missing, but only that step', () => {
    const service = createService();
    service.start('task-1');
    service.skipStep('planner');
    expect(service.currentStep()).toBe('track-time');
    service.skipStep('track-time');
    expect(service.currentStep()).toBe('add-subtask');
  });

  it('notes the running timer on the step after tracking started, while it runs', () => {
    const service = createService();
    service.start('task-1');
    localActions$.next(setCurrentTask({ id: 'task-1' }));
    currentTaskId.set('task-1');
    ackAndAdvance();
    expect(service.isTimerNoteShown()).toBeTrue();

    currentTaskId.set(null);
    expect(service.isTimerNoteShown()).toBeFalse();
    service.next();
    currentTaskId.set('task-1');
    expect(service.isTimerNoteShown()).toBeFalse();
  });

  it('skips time tracking and Planner when switched off', () => {
    appFeatures.set({ isTimeTrackingEnabled: false, isPlannerEnabled: false });
    const service = createService();
    service.start('task-1');
    expect(service.currentStep()).toBe('add-subtask');
    expect(service.stepCount()).toBe(3);
  });

  it('hides while the composer or, on task steps, the task menu is open', () => {
    const service = createService();
    service.start('task-1');
    isTaskContextMenuOpen.set(true);
    expect(service.currentStep()).toBeNull();
    isTaskContextMenuOpen.set(false);
    isShowAddTaskBar.set(true);
    expect(service.currentStep()).toBeNull();
    isShowAddTaskBar.set(false);
    service.next();
    service.next();
    isTaskContextMenuOpen.set(true);
    expect(service.currentStep()).toBe('organize');
  });

  describe('from Help', () => {
    it('uses the first undone top-level task in Today and goes to Today', () => {
      setTasks([makeTask('sub', { parentId: 'task-2' }), makeTask('task-2')]);
      router.url = '/config';
      const service = createService();
      service.start();
      expect(service.tourTaskId()).toBe('task-2');
      expect(service.currentStep()).toBe('track-time');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/tag/TODAY/tasks');
    });

    it('starts at the organize step with no undone task in Today', () => {
      setTasks([makeTask('done', { isDone: true })], []);
      const service = createService();
      service.start();
      expect(service.currentStep()).toBe('organize');
      expect(service.stepCount()).toBe(3);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('restarts from step 1', () => {
      const service = createService();
      service.start('task-1');
      service.next();
      service.next();
      service.start();
      expect(service.currentStep()).toBe('track-time');
    });
  });

  describe('after a reload', () => {
    it('resumes the saved step on the same task', () => {
      localStorage.setItem(
        LS.QUICK_TOUR_STATE,
        JSON.stringify({ step: 'organize', taskId: 'task-1' }),
      );
      const service = createService();
      expect(service.currentStep()).toBe('organize');
      expect(service.stepNr()).toBe(3);
      expect(service.tourTaskId()).toBe('task-1');
    });

    it('saves whether the swipe menu was learned', () => {
      const service = createService();
      service.start('task-1', true);
      expect(JSON.parse(localStorage.getItem(LS.QUICK_TOUR_STATE) ?? '')).toEqual({
        step: 'track-time',
        taskId: 'task-1',
        isTaskMenuLearned: true,
      });
    });

    it('ends when the saved step no longer applies', () => {
      appFeatures.set({ isTimeTrackingEnabled: true, isPlannerEnabled: false });
      localStorage.setItem(
        LS.QUICK_TOUR_STATE,
        JSON.stringify({ step: 'planner', taskId: null }),
      );
      const service = createService();
      expect(service.isActive()).toBeFalse();
      expect(localStorage.getItem(LS.QUICK_TOUR_STATE)).toBeNull();
    });

    it('drops unreadable saved state', () => {
      localStorage.setItem(LS.QUICK_TOUR_STATE, '{nope');
      const service = createService();
      expect(service.isActive()).toBeFalse();
      expect(localStorage.getItem(LS.QUICK_TOUR_STATE)).toBeNull();
    });
  });

  it('Open settings ends the tour and opens Settings › App features', () => {
    const service = createService();
    service.start('task-1');
    service.openSettings();
    expect(service.isActive()).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/config'], {
      queryParams: { section: 'appFeatures' },
    });
  });
});
