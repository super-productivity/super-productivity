import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal, WritableSignal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { PlannerTaskComponent } from './planner-task.component';
import { TaskService } from '../../tasks/task.service';
import { DEFAULT_TASK, TaskCopy, TaskReminderOptionId } from '../../tasks/task.model';
import { DoneToggleComponent } from '../../../ui/done-toggle/done-toggle.component';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { RenderLinksPipe } from '../../../ui/pipes/render-links.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { GlobalConfigService } from '../../config/global-config.service';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { DateService } from '../../../core/date/date.service';
import { DateAdapter } from '@angular/material/core';
import { TaskMultiSelectService } from '../../tasks/task-multi-select.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { PlannerActions } from '../store/planner.actions';
import {
  moveTaskDownInTodayList,
  moveTaskToBottomInTodayList,
  moveTaskToTopInTodayList,
  moveTaskUpInTodayList,
} from '../../work-context/store/work-context-meta.actions';
import { WorkContextType } from '../../work-context/work-context.model';
import { TODAY_TAG } from '../../tag/tag.const';

const makeTask = (overrides: Partial<TaskCopy> = {}): TaskCopy =>
  ({
    ...DEFAULT_TASK,
    projectId: 'p1',
    id: 't1',
    parentId: null,
    ...overrides,
  }) as TaskCopy;

describe('PlannerTaskComponent', () => {
  let currentTaskId: WritableSignal<string | null>;
  let taskServiceMock: { toggleDoneWithAnimation: jasmine.Spy };
  let storeMock: jasmine.SpyObj<Store>;
  let matDialogMock: jasmine.SpyObj<MatDialog>;
  let config: typeof DEFAULT_GLOBAL_CONFIG;
  let logicalToday: Date;
  let firstDayOfWeek: number;
  let multiSelectMock: {
    selectedIds: WritableSignal<Set<string>>;
    isActive: WritableSignal<boolean>;
    toggle: jasmine.Spy;
    selectRange: jasmine.Spy;
    clear: jasmine.Spy;
    has: jasmine.Spy;
    requestMenuOpen: jasmine.Spy;
    removeWhenUnrendered: jasmine.Spy;
    findLiveRowEl: jasmine.Spy;
  };

  const create = (
    task: TaskCopy,
    focusable = false,
    day?: string,
  ): {
    fixture: ComponentFixture<PlannerTaskComponent>;
    component: PlannerTaskComponent;
  } => {
    const fixture = TestBed.createComponent(PlannerTaskComponent);
    fixture.componentRef.setInput('task', task);
    fixture.componentRef.setInput('focusable', focusable);
    fixture.componentRef.setInput('day', day);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  };

  beforeEach(() => {
    currentTaskId = signal<string | null>(null);
    taskServiceMock = {
      ...jasmine.createSpyObj('TaskService', [
        'setSelectedId',
        'setCurrentId',
        'scheduleForTodayById',
        'scheduleTask',
        'remove',
        'toggleDoneWithAnimation',
        'update',
      ]),
      currentTaskId,
      getByIdLive$: () => of(null),
      getByIdWithSubTaskData$: () => of(null),
    };
    config = DEFAULT_GLOBAL_CONFIG;
    logicalToday = new Date(2026, 8, 12);
    firstDayOfWeek = 1;
    storeMock = jasmine.createSpyObj('Store', ['dispatch']);
    matDialogMock = jasmine.createSpyObj('MatDialog', ['open']);
    multiSelectMock = {
      selectedIds: signal(new Set<string>()),
      isActive: signal(false),
      toggle: jasmine.createSpy('toggle'),
      selectRange: jasmine.createSpy('selectRange'),
      clear: jasmine.createSpy('clear'),
      has: jasmine.createSpy('has').and.returnValue(false),
      requestMenuOpen: jasmine.createSpy('requestMenuOpen'),
      removeWhenUnrendered: jasmine.createSpy('removeWhenUnrendered'),
      findLiveRowEl: jasmine.createSpy('findLiveRowEl').and.returnValue(null),
    };

    TestBed.configureTestingModule({
      imports: [PlannerTaskComponent, TranslateModule.forRoot()],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: TaskService, useValue: taskServiceMock },
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: () => config,
            appFeatures: () => ({ isTimeTrackingEnabled: true }),
          },
        },
        { provide: MatDialog, useValue: matDialogMock },
        { provide: Store, useValue: storeMock },
        {
          provide: DateService,
          useValue: {
            getLogicalTodayDate: () => new Date(logicalToday),
            todayStr: () => '2026-09-12',
          },
        },
        {
          provide: DateAdapter,
          useValue: {
            getFirstDayOfWeek: () => firstDayOfWeek,
            getDayOfWeek: (date: Date) => date.getDay(),
          },
        },
        { provide: TaskMultiSelectService, useValue: multiSelectMock },
      ],
    });

    // Isolate the component from its heavyweight child components (tag-list etc.)
    // so the spec exercises PlannerTaskComponent's OWN template bindings without
    // needing the full Store/service graph. Child elements become unknown tags
    // (ignored via NO_ERRORS_SCHEMA); the pipes used in the template are kept.
    TestBed.overrideComponent(PlannerTaskComponent, {
      set: {
        // `done-toggle` stays REAL: the planner's modifier-click behaviour is a
        // property of how this template configures that shared component, so
        // stubbing it would test nothing (see the spec at the bottom).
        imports: [DoneToggleComponent, MsToStringPipe, RenderLinksPipe, TranslatePipe],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
  });

  describe('Planner keyboard shortcuts', () => {
    const shortcutEvent = (key: string): CustomEvent<{ keyboardEvent: KeyboardEvent }> =>
      new CustomEvent('planner-task-shortcut', {
        cancelable: true,
        detail: {
          keyboardEvent: new KeyboardEvent('keydown', {
            key,
            code: key.startsWith('F') ? key : `Key${key}`,
          }),
        },
      });

    const moveDayEvent = (
      component: PlannerTaskComponent,
      key: 'ArrowLeft' | 'ArrowRight',
      target?: HTMLElement,
    ): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', {
        key,
        code: key,
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      const host = (
        component as unknown as { _elementRef: { nativeElement: HTMLElement } }
      )._elementRef.nativeElement;
      Object.defineProperty(event, 'target', { value: target ?? host });
      return event;
    };

    for (const [key, expectedDay] of [
      ['ArrowLeft', '2025-12-31'],
      ['ArrowRight', '2026-01-02'],
    ] as const) {
      it(`moves an all-day Planner card one day with ${key}`, () => {
        const task = makeTask();
        const { component } = create(task, true, '2026-01-01');
        const event = moveDayEvent(component, key);

        component.onKeydown(event);

        expect(storeMock.dispatch).toHaveBeenCalledWith(
          PlannerActions.planTaskForDay({ task, day: expectedDay, isShowSnack: true }),
        );
        expect(event.defaultPrevented).toBeTrue();
      });
    }

    it('uses an overdue timed task date and preserves its local time and reminder', () => {
      const dueWithTime = new Date(2025, 11, 31, 23, 15).getTime();
      const thirtyMinutes = 30 * 60 * 1000;
      const task = makeTask({
        dueWithTime,
        reminderId: 'reminder',
        remindAt: dueWithTime - thirtyMinutes,
      });
      const { component } = create(task, true, '');

      component.onKeydown(moveDayEvent(component, 'ArrowRight'));

      expect(taskServiceMock['scheduleTask']).toHaveBeenCalledWith(
        task,
        new Date(2026, 0, 1, 23, 15).getTime(),
        'm30',
        false,
      );
    });

    for (const [key, expectedDate] of [
      ['ArrowLeft', new Date(2026, 8, 13, 1, 0).getTime()],
      ['ArrowRight', new Date(2026, 8, 15, 1, 0).getTime()],
    ] as const) {
      it(`moves a timed task from its scheduled date with ${key} when its displayed logical day differs`, () => {
        const dueWithTime = new Date(2026, 8, 14, 1, 0).getTime();
        const task = makeTask({ dueWithTime, remindAt: undefined });
        const { component } = create(task, true, '2026-09-13');

        component.onKeydown(moveDayEvent(component, key));

        expect(taskServiceMock['scheduleTask']).toHaveBeenCalledWith(
          task,
          expectedDate,
          TaskReminderOptionId.DoNotRemind,
          false,
        );
      });
    }

    it('leaves the move-day shortcut untouched in an input and for opt-out cards', () => {
      const optedIn = create(makeTask(), true, '2026-01-01').component;
      const input = document.createElement('input');
      const inputEvent = moveDayEvent(optedIn, 'ArrowRight', input);
      optedIn.onKeydown(inputEvent);

      const optedOut = create(makeTask(), false, '2026-01-01').component;
      const optOutEvent = moveDayEvent(optedOut, 'ArrowRight');
      optedOut.onKeydown(optOutEvent);

      expect(storeMock.dispatch).not.toHaveBeenCalled();
      expect(inputEvent.defaultPrevented).toBeFalse();
      expect(optOutEvent.defaultPrevented).toBeFalse();
    });

    it('lets a configured shortcut override the move-day combination', () => {
      config = {
        ...DEFAULT_GLOBAL_CONFIG,
        keyboard: {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          taskToggleDone: 'Ctrl+Shift+ArrowRight',
        },
      };
      const { component } = create(makeTask(), true, '2026-01-01');
      const event = moveDayEvent(component, 'ArrowRight');

      component.onKeydown(event);

      expect(storeMock.dispatch).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBeFalse();
    });

    it('plans an all-day task for tomorrow with the existing Planner action', () => {
      config = {
        ...DEFAULT_GLOBAL_CONFIG,
        keyboard: { ...DEFAULT_GLOBAL_CONFIG.keyboard, taskScheduleTomorrow: 'M' },
      };
      const { component } = create(makeTask());

      component.onTaskShortcut(shortcutEvent('m'));

      expect(storeMock.dispatch).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({
          task: makeTask(),
          day: '2026-09-13',
          isShowSnack: true,
        }),
      );
    });

    it('uses the locale first weekday when planning for next week', () => {
      logicalToday = new Date(2026, 8, 13); // Sunday
      firstDayOfWeek = 1; // Monday
      config = {
        ...DEFAULT_GLOBAL_CONFIG,
        keyboard: { ...DEFAULT_GLOBAL_CONFIG.keyboard, taskScheduleNextWeek: 'W' },
      };
      const task = makeTask();
      const { component } = create(task);

      component.onTaskShortcut(shortcutEvent('w'));

      expect(storeMock.dispatch).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({
          task,
          day: '2026-09-14',
          isShowSnack: true,
        }),
      );
    });

    it('plans next month for the first day across a year boundary', () => {
      logicalToday = new Date(2026, 11, 31);
      config = {
        ...DEFAULT_GLOBAL_CONFIG,
        keyboard: { ...DEFAULT_GLOBAL_CONFIG.keyboard, taskScheduleNextMonth: 'M' },
      };
      const task = makeTask();
      const { component } = create(task);

      component.onTaskShortcut(shortcutEvent('m'));

      expect(storeMock.dispatch).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({
          task,
          day: '2027-01-01',
          isShowSnack: true,
        }),
      );
    });

    it('preserves a timed task time and reminder offset when moving it', () => {
      const dueWithTime = new Date(2026, 8, 12, 14, 45).getTime();
      const thirtyMinutes = 30 * 60 * 1000;
      const task = makeTask({
        dueWithTime,
        reminderId: 'reminder',
        remindAt: dueWithTime - thirtyMinutes,
      });
      config = {
        ...DEFAULT_GLOBAL_CONFIG,
        keyboard: { ...DEFAULT_GLOBAL_CONFIG.keyboard, taskScheduleTomorrow: 'M' },
      };
      const { component } = create(task);

      component.onTaskShortcut(shortcutEvent('m'));

      expect(taskServiceMock['scheduleTask']).toHaveBeenCalledWith(
        task,
        new Date(2026, 8, 13, 14, 45).getTime(),
        'm30',
        false,
      );
    });

    it('preserves a modern timed task reminder without a legacy reminder id', () => {
      const dueWithTime = new Date(2026, 8, 12, 14, 45).getTime();
      const thirtyMinutes = 30 * 60 * 1000;
      const task = makeTask({
        dueWithTime,
        reminderId: null,
        remindAt: dueWithTime - thirtyMinutes,
      });
      config = {
        ...DEFAULT_GLOBAL_CONFIG,
        keyboard: { ...DEFAULT_GLOBAL_CONFIG.keyboard, taskScheduleTomorrow: 'M' },
      };
      const { component } = create(task);

      component.onTaskShortcut(shortcutEvent('m'));

      expect(taskServiceMock['scheduleTask']).toHaveBeenCalledWith(
        task,
        new Date(2026, 8, 13, 14, 45).getTime(),
        TaskReminderOptionId.m30,
        false,
      );
    });

    it('keeps reminders disabled when moving a modern timed task', () => {
      const dueWithTime = new Date(2026, 8, 12, 14, 45).getTime();
      const task = makeTask({ dueWithTime, reminderId: null, remindAt: undefined });
      config = {
        ...DEFAULT_GLOBAL_CONFIG,
        keyboard: { ...DEFAULT_GLOBAL_CONFIG.keyboard, taskScheduleTomorrow: 'M' },
      };
      const { component } = create(task);

      component.onTaskShortcut(shortcutEvent('m'));

      expect(taskServiceMock['scheduleTask']).toHaveBeenCalledWith(
        task,
        new Date(2026, 8, 13, 14, 45).getTime(),
        TaskReminderOptionId.DoNotRemind,
        false,
      );
    });

    it('moves focus after delayed completion removes the focused card', fakeAsync(() => {
      config = {
        ...DEFAULT_GLOBAL_CONFIG,
        keyboard: { ...DEFAULT_GLOBAL_CONFIG.keyboard, taskToggleDone: 'D' },
      };
      const scope = document.createElement('planner-day-overdue');
      scope.setAttribute('data-planner-selection-scope', '2026-09-12');
      document.body.appendChild(scope);
      const { fixture, component } = create(makeTask(), true);
      const host = fixture.nativeElement as HTMLElement;
      const next = document.createElement('planner-task');
      next.setAttribute('data-task-id', 'next');
      next.setAttribute('data-task-selectable', 'true');
      scope.append(host, next);
      multiSelectMock.findLiveRowEl.and.callFake((id: string) =>
        id === 'next' ? next : null,
      );
      spyOn(next, 'focus');
      host.focus();
      taskServiceMock.toggleDoneWithAnimation.and.callFake(() =>
        window.setTimeout(() => {
          component.ngOnDestroy();
          host.remove();
        }, 200),
      );

      component.onTaskShortcut(shortcutEvent('d'));
      tick(200);
      tick();

      expect(next.focus).toHaveBeenCalled();
      scope.remove();
    }));

    it('does not steal focus after delayed completion when the user moved it', fakeAsync(() => {
      config = {
        ...DEFAULT_GLOBAL_CONFIG,
        keyboard: { ...DEFAULT_GLOBAL_CONFIG.keyboard, taskToggleDone: 'D' },
      };
      const scope = document.createElement('planner-day-overdue');
      scope.setAttribute('data-planner-selection-scope', '2026-09-12');
      document.body.appendChild(scope);
      const { fixture, component } = create(makeTask(), true);
      const host = fixture.nativeElement as HTMLElement;
      const next = document.createElement('planner-task');
      next.setAttribute('data-task-id', 'next');
      next.setAttribute('data-task-selectable', 'true');
      const userTarget = document.createElement('button');
      scope.append(host, next, userTarget);
      multiSelectMock.findLiveRowEl.and.returnValue(next);
      spyOn(next, 'focus');
      host.focus();
      taskServiceMock.toggleDoneWithAnimation.and.callFake(() =>
        window.setTimeout(() => {
          component.ngOnDestroy();
          host.remove();
        }, 200),
      );

      component.onTaskShortcut(shortcutEvent('d'));
      userTarget.focus();
      tick(200);
      tick();

      expect(next.focus).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(userTarget);
      scope.remove();
    }));

    it('uses the move fallback when an overdue completion is still pending', fakeAsync(() => {
      config = {
        ...DEFAULT_GLOBAL_CONFIG,
        keyboard: { ...DEFAULT_GLOBAL_CONFIG.keyboard, taskToggleDone: 'D' },
      };
      const scope = document.createElement('planner-day-overdue');
      scope.setAttribute('data-planner-selection-scope', 'overdue');
      document.body.appendChild(scope);
      const task = makeTask({ dueWithTime: new Date(2026, 8, 11, 14, 45).getTime() });
      const { fixture, component } = create(task, true, '2026-09-11');
      const host = fixture.nativeElement as HTMLElement;
      const next = document.createElement('planner-task');
      next.setAttribute('data-task-id', 'next');
      next.setAttribute('data-task-selectable', 'true');
      const moved = document.createElement('planner-task');
      scope.append(host, next, moved);
      multiSelectMock.findLiveRowEl.and.callFake((id: string) =>
        id === task.id ? moved : id === 'next' ? next : null,
      );
      spyOn(next, 'focus');
      spyOn(moved, 'focus');
      host.focus();
      taskServiceMock['scheduleTask'].and.callFake(() => {
        component.ngOnDestroy();
        host.remove();
      });

      component.onTaskShortcut(shortcutEvent('d'));
      component.onKeydown(moveDayEvent(component, 'ArrowRight'));
      tick();

      expect(moved.focus).toHaveBeenCalled();
      expect(next.focus).not.toHaveBeenCalled();
      scope.remove();
    }));

    it('restores focus when a moved task stays overdue until completion', fakeAsync(() => {
      config = {
        ...DEFAULT_GLOBAL_CONFIG,
        keyboard: { ...DEFAULT_GLOBAL_CONFIG.keyboard, taskToggleDone: 'D' },
      };
      const scope = document.createElement('planner-day-overdue');
      scope.setAttribute('data-planner-selection-scope', 'overdue');
      document.body.appendChild(scope);
      const task = makeTask({ dueWithTime: new Date(2026, 8, 9, 14, 45).getTime() });
      const { fixture, component } = create(task, true, '2026-09-09');
      const host = fixture.nativeElement as HTMLElement;
      const next = document.createElement('planner-task');
      next.setAttribute('data-task-id', 'next');
      next.setAttribute('data-task-selectable', 'true');
      scope.append(host, next);
      multiSelectMock.findLiveRowEl.and.callFake((id: string) =>
        id === 'next' ? next : null,
      );
      spyOn(next, 'focus');
      host.focus();
      taskServiceMock.toggleDoneWithAnimation.and.callFake(() =>
        window.setTimeout(() => {
          component.ngOnDestroy();
          host.remove();
        }, 200),
      );

      component.onTaskShortcut(shortcutEvent('d'));
      component.onKeydown(moveDayEvent(component, 'ArrowRight'));
      tick(200);
      tick();

      expect(next.focus).toHaveBeenCalled();
      scope.remove();
    }));

    it('does not consume time tracking when the feature is disabled', () => {
      TestBed.overrideProvider(GlobalConfigService, {
        useValue: {
          cfg: () => ({
            ...DEFAULT_GLOBAL_CONFIG,
            keyboard: { ...DEFAULT_GLOBAL_CONFIG.keyboard, togglePlay: 'Y' },
          }),
          appFeatures: () => ({ isTimeTrackingEnabled: false }),
        },
      });
      const { component } = create(makeTask());
      const event = shortcutEvent('y');

      component.onTaskShortcut(event);

      expect(event.defaultPrevented).toBeFalse();
    });

    it('routes the native context-menu key to the Planner card menu', () => {
      const { component } = create(makeTask());
      spyOn(component, 'openContextMenu');
      const event = new CustomEvent<{ keyboardEvent: KeyboardEvent }>(
        'planner-task-shortcut',
        {
          cancelable: true,
          detail: {
            keyboardEvent: new KeyboardEvent('keydown', {
              key: 'ContextMenu',
              code: 'ContextMenu',
            }),
          },
        },
      );

      component.onTaskShortcut(event);

      expect(event.defaultPrevented).toBeTrue();
    });

    it('focuses the local add button when a schedule dialog moves the last card', fakeAsync(() => {
      config = {
        ...DEFAULT_GLOBAL_CONFIG,
        keyboard: { ...DEFAULT_GLOBAL_CONFIG.keyboard, taskSchedule: 'S' },
      };
      const closed = new Subject<void>();
      matDialogMock.open.and.returnValue({ afterClosed: () => closed } as never);
      const scope = document.createElement('planner-day');
      scope.setAttribute('data-planner-selection-scope', '2026-09-12');
      const add = document.createElement('button');
      const addTask = document.createElement('add-task-inline');
      addTask.appendChild(add);
      scope.appendChild(addTask);
      document.body.appendChild(scope);
      const { fixture, component } = create(makeTask(), true);
      scope.appendChild(fixture.nativeElement);
      spyOn(add, 'focus');

      component.onTaskShortcut(shortcutEvent('s'));
      fixture.nativeElement.remove();
      closed.next();
      tick();

      expect(add.focus).toHaveBeenCalled();
      scope.remove();
    }));

    for (const [name, expectedAction] of [
      ['up', moveTaskUpInTodayList],
      ['down', moveTaskDownInTodayList],
      ['top', moveTaskToTopInTodayList],
      ['bottom', moveTaskToBottomInTodayList],
    ] as const) {
      it(`uses Today ordering semantics for an all-day move ${name}`, () => {
        const scope = document.createElement('planner-day');
        scope.setAttribute('data-planner-selection-scope', '2026-09-12');
        const normal = document.createElement('div');
        normal.className = 'normal-tasks';
        scope.appendChild(normal);
        document.body.appendChild(scope);
        const first = document.createElement('planner-task');
        first.setAttribute('data-task-id', 'first');
        first.setAttribute('data-task-selectable', 'true');
        normal.appendChild(first);
        const { component } = create(makeTask(), true, '2026-09-12');
        const middle = document.createElement('planner-task');
        middle.setAttribute('data-task-id', 't1');
        middle.setAttribute('data-task-selectable', 'true');
        normal.appendChild(middle);
        (
          component as unknown as { _elementRef: { nativeElement: HTMLElement } }
        )._elementRef.nativeElement = middle;
        const last = document.createElement('planner-task');
        last.setAttribute('data-task-id', 'last');
        last.setAttribute('data-task-selectable', 'true');
        normal.appendChild(last);
        (
          component as unknown as {
            _reorderAllDay: (direction: 'up' | 'down' | 'top' | 'bottom') => void;
          }
        )._reorderAllDay(name);

        expect(storeMock.dispatch).toHaveBeenCalledWith(
          expectedAction({
            taskId: 't1',
            workContextType: WorkContextType.TAG,
            workContextId: TODAY_TAG.id,
            doneTaskIds: ['first', 't1', 'last'],
          }),
        );
        scope.remove();
      });
    }
  });

  it('intercepts a modifier click before an embedded control activates', () => {
    const { fixture } = create(makeTask(), true);
    const embedded = fixture.nativeElement.querySelector('done-toggle') as HTMLElement;
    embedded.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
    );

    expect(multiSelectMock.toggle).toHaveBeenCalledWith('t1');
    expect(taskServiceMock.toggleDoneWithAnimation).not.toHaveBeenCalled();
  });

  it('preserves Shift selection inside an embedded input', () => {
    const { fixture } = create(makeTask(), true);
    const input = document.createElement('input');
    fixture.nativeElement.appendChild(input);
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
    });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBeFalse();
  });

  it('focuses an opted-in Planner card on a plain click', () => {
    const { component } = create(makeTask(), true);
    const host = (component as unknown as { _elementRef: { nativeElement: HTMLElement } })
      ._elementRef.nativeElement;
    spyOn(host, 'focus');
    const title = host.querySelector('.title') as HTMLElement;

    title.click();

    expect(host.focus).toHaveBeenCalled();
    expect(taskServiceMock['setSelectedId']).not.toHaveBeenCalled();
  });

  it('opens details for an opted-in Planner card on double click', () => {
    const { fixture } = create(makeTask(), true);
    const title = fixture.nativeElement.querySelector('.title') as HTMLElement;

    title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(taskServiceMock['setSelectedId']).toHaveBeenCalledOnceWith('t1');
  });

  it('does not open details for a modifier double click', () => {
    const { fixture } = create(makeTask(), true);
    const title = fixture.nativeElement.querySelector('.title') as HTMLElement;

    title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, ctrlKey: true }));

    expect(taskServiceMock['setSelectedId']).not.toHaveBeenCalled();
  });

  it('keeps single-click detail opening for non-Planner consumers', () => {
    const { fixture } = create(makeTask());
    const title = fixture.nativeElement.querySelector('.title') as HTMLElement;

    title.click();

    expect(taskServiceMock['setSelectedId']).toHaveBeenCalledOnceWith('t1');
  });

  it('does not move focus to the card when an embedded input is clicked', () => {
    const { component } = create(makeTask(), true);
    const host = (component as unknown as { _elementRef: { nativeElement: HTMLElement } })
      ._elementRef.nativeElement;
    const input = document.createElement('input');
    host.appendChild(input);
    spyOn(host, 'focus');

    input.click();

    expect(host.focus).not.toHaveBeenCalled();
  });

  it('renders the template without throwing', () => {
    expect(() => create(makeTask({ title: 'plain title' }))).not.toThrow();
  });

  describe('titleHasLinks', () => {
    it('is false for a plain title', () => {
      const { component } = create(makeTask({ title: 'plain title' }));
      expect(component.titleHasLinks()).toBe(false);
    });

    it('is true for a title containing a URL', () => {
      const { component } = create(makeTask({ title: 'see https://example.com' }));
      expect(component.titleHasLinks()).toBe(true);
    });
  });

  describe('timeEstimate', () => {
    it('returns the raw estimate when the task has subTaskIds', () => {
      const { component } = create(
        makeTask({ timeEstimate: 5000, timeSpent: 2000, subTaskIds: ['s1'] }),
      );
      expect(component.timeEstimate()).toBe(5000);
    });
  });

  describe('isCurrent', () => {
    it('is true when the current task id equals the task id and reflects on the host', () => {
      currentTaskId.set('t1');
      const { fixture, component } = create(makeTask({ id: 't1' }));
      expect(component.isCurrent()).toBe(true);
      expect(fixture.debugElement.nativeElement.classList.contains('isCurrent')).toBe(
        true,
      );
    });

    it('flips to false when the current task id changes', () => {
      currentTaskId.set('t1');
      const { fixture, component } = create(makeTask({ id: 't1' }));
      expect(component.isCurrent()).toBe(true);

      currentTaskId.set('other');
      fixture.detectChanges();
      expect(component.isCurrent()).toBe(false);
      expect(fixture.debugElement.nativeElement.classList.contains('isCurrent')).toBe(
        false,
      );
    });
  });

  describe('isDone host class', () => {
    it('carries the isDone class when the task is done', () => {
      const { fixture } = create(makeTask({ isDone: true }));
      expect(fixture.debugElement.nativeElement.classList.contains('isDone')).toBe(true);
    });

    it('omits the isDone class when the task is not done', () => {
      const { fixture } = create(makeTask({ isDone: false }));
      expect(fixture.debugElement.nativeElement.classList.contains('isDone')).toBe(false);
    });
  });

  describe('done toggle (#9929 fallout)', () => {
    /**
     * The Planner has no multi-select, so its `done-toggle` must NOT opt into
     * the multi-select bail — a Ctrl/Cmd/Shift click here has to keep marking
     * the task done. Adding `[isMultiSelectAware]="true"` to this template (as
     * `task.component.html` correctly does) would swallow the toggle AND let
     * the click bubble to the planner row, which opens the detail panel.
     */
    const clickToggle = (task: TaskCopy, init: MouseEventInit): void => {
      const { fixture } = create(task);
      const toggle = fixture.nativeElement.querySelector('done-toggle') as HTMLElement;
      toggle.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
      );
    };

    it('marks the task done on a plain click', () => {
      clickToggle(makeTask({ isDone: false }), {});
      expect(taskServiceMock.toggleDoneWithAnimation).toHaveBeenCalled();
    });

    for (const [name, init] of [
      ['ctrl', { ctrlKey: true }],
      ['meta', { metaKey: true }],
      ['shift', { shiftKey: true }],
    ] as const) {
      it(`still marks the task done on a ${name}+click`, () => {
        clickToggle(makeTask({ isDone: false }), init);
        expect(taskServiceMock.toggleDoneWithAnimation).toHaveBeenCalled();
      });
    }
  });
});
