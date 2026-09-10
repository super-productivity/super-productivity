import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { TranslateModule } from '@ngx-translate/core';
import { ScheduleEventComponent } from './schedule-event.component';
import { SVEType } from '../schedule.const';
import { ScheduleEvent } from '../schedule.model';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../../tasks/task.service';
import { CalendarEventActionsService } from '../../calendar-integration/calendar-event-actions.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { selectTaskByIdWithSubTaskData } from '../../tasks/store/task.selectors';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { isTouchActive } from '../../../util/input-intent';

const makeCalendarScheduleEvent = (isReferenceCalendar: boolean): ScheduleEvent => ({
  id: 'cal-1',
  type: SVEType.CalendarEvent,
  style: '',
  startHours: 10,
  timeLeftInHours: 1,
  data: {
    id: 'cal-1',
    title: 'Test Event',
    start: Date.now(),
    duration: 3600000,
    issueProviderKey: 'ICAL',
    icon: 'event',
    isReferenceCalendar,
  } as any,
});

const makeTaskScheduleEvent = (overlap?: ScheduleEvent['overlap']): ScheduleEvent => ({
  id: 'task-1',
  type: SVEType.Task,
  style: 'grid-column: 2;  grid-row: 121 / span 12',
  startHours: 10,
  timeLeftInHours: 1,
  overlap,
  data: { id: 'task-1', title: 'Task', timeEstimate: 3600000 } as any,
});

describe('ScheduleEventComponent – isReferenceCalendar', () => {
  let fixture: ComponentFixture<ScheduleEventComponent>;
  let component: ScheduleEventComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScheduleEventComponent, DragDropModule, TranslateModule.forRoot()],
      providers: [
        provideMockStore(),
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
        {
          provide: TaskService,
          useValue: {
            setSelectedId: jasmine.createSpy('setSelectedId'),
            remove: jasmine.createSpy('remove'),
          },
        },
        {
          provide: CalendarEventActionsService,
          useValue: {
            hasEventUrl: jasmine.createSpy('hasEventUrl').and.returnValue(false),
            isPluginEvent: jasmine.createSpy('isPluginEvent').and.returnValue(false),
            canMoveEvent: jasmine.createSpy('canMoveEvent').and.returnValue(false),
            createAsTask: jasmine.createSpy('createAsTask'),
            hideForever: jasmine.createSpy('hideForever'),
          },
        },
        {
          provide: DateTimeFormatService,
          // is24HourFormat is a signal (a function); the component must call it.
          useValue: { is24HourFormat: () => true },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ScheduleEventComponent);
    component = fixture.componentInstance;
  });

  describe('isReferenceCalendar signal', () => {
    it('should return true for a CalendarEvent whose data has isReferenceCalendar: true', () => {
      fixture.componentRef.setInput('event', makeCalendarScheduleEvent(true));
      fixture.detectChanges();

      expect(component.isReferenceCalendar()).toBe(true);
    });

    it('should return false for a CalendarEvent whose data has isReferenceCalendar: false', () => {
      fixture.componentRef.setInput('event', makeCalendarScheduleEvent(false));
      fixture.detectChanges();

      expect(component.isReferenceCalendar()).toBe(false);
    });

    it('should return false for a non-CalendarEvent type', () => {
      fixture.componentRef.setInput('event', makeTaskScheduleEvent());
      fixture.detectChanges();

      expect(component.isReferenceCalendar()).toBe(false);
    });
  });

  describe('canRescheduleCalendarEvent signal', () => {
    it('should return false when the calendar provider cannot update events', () => {
      fixture.componentRef.setInput('event', makeCalendarScheduleEvent(false));
      fixture.detectChanges();

      expect(component.canRescheduleCalendarEvent()).toBe(false);
    });

    it('should return true when the calendar provider can update events', () => {
      const calActions = TestBed.inject(
        CalendarEventActionsService,
      ) as jasmine.SpyObj<CalendarEventActionsService>;
      calActions.canMoveEvent.and.returnValue(true);
      fixture.componentRef.setInput('event', makeCalendarScheduleEvent(false));
      fixture.detectChanges();

      expect(component.canRescheduleCalendarEvent()).toBe(true);
    });
  });

  describe('clickHandler – reference calendar with empty menu', () => {
    it('should not throw when clicking a reference calendar event with no menu items', async () => {
      fixture.componentRef.setInput('event', makeCalendarScheduleEvent(true));
      fixture.detectChanges();

      await expectAsync(
        component.clickHandler(new MouseEvent('click')),
      ).not.toBeRejected();
    });

    it('should not open menu for a reference calendar event when no items are rendered', async () => {
      fixture.componentRef.setInput('event', makeCalendarScheduleEvent(true));
      fixture.detectChanges();

      const trigger = component.calMenuTrigger();
      if (trigger) {
        spyOn(trigger, 'openMenu');
      }

      await component.clickHandler(new MouseEvent('click'));

      if (trigger) {
        expect(trigger.openMenu).not.toHaveBeenCalled();
      } else {
        // calMenuTrigger is undefined when MatMenuTrigger is not resolved – openMenu was never called
        expect(trigger).toBeUndefined();
      }
    });
  });

  describe('clickHandler – repeat projections', () => {
    it('opens every repeat projection variant for its planned calendar day', async () => {
      const repeatCfg = { id: 'repeat_cfg_with_underscores' } as TaskRepeatCfg;
      const plannedForDay = '2026-07-30';
      const sourceOccurrenceDate = '2026-07-29';
      const projectionTypes = [
        SVEType.RepeatProjection,
        SVEType.RepeatProjectionSplit,
        SVEType.ScheduledRepeatProjection,
        SVEType.RepeatProjectionSplitContinued,
        SVEType.RepeatProjectionSplitContinuedLast,
      ];
      const matDialog = TestBed.inject(MatDialog) as jasmine.SpyObj<MatDialog>;

      for (const type of projectionTypes) {
        const isContinuedProjection =
          type === SVEType.RepeatProjectionSplitContinued ||
          type === SVEType.RepeatProjectionSplitContinuedLast;
        fixture.componentRef.setInput('event', {
          id: 'repeat_cfg_with_underscores_not-a-date',
          type,
          style: '',
          startHours: 10,
          timeLeftInHours: 1,
          plannedForDay,
          sourceOccurrenceDate: isContinuedProjection ? sourceOccurrenceDate : undefined,
          data: repeatCfg,
        } as ScheduleEvent);
        fixture.detectChanges();

        await component.clickHandler(new MouseEvent('click'));

        expect(matDialog.open).toHaveBeenCalledWith(
          jasmine.anything(),
          jasmine.objectContaining({
            data: jasmine.objectContaining({
              repeatCfg,
              targetDate: isContinuedProjection ? sourceOccurrenceDate : plannedForDay,
            }),
          }),
        );
        matDialog.open.calls.reset();
      }
    });

    // The spec above calls clickHandler() directly, so it cannot see the host
    // '(click)' binding disappearing. This one goes through a real DOM event.
    it('opens the dialog via the host click binding, not just the method', () => {
      const repeatCfg = { id: 'repeat_cfg_with_underscores' } as TaskRepeatCfg;
      const matDialog = TestBed.inject(MatDialog) as jasmine.SpyObj<MatDialog>;
      fixture.componentRef.setInput('event', {
        id: 'repeat_cfg_with_underscores_not-a-date',
        type: SVEType.RepeatProjectionSplitContinuedLast,
        style: '',
        startHours: 10,
        timeLeftInHours: 1,
        plannedForDay: '2026-07-30',
        sourceOccurrenceDate: '2026-07-29',
        data: repeatCfg,
      } as ScheduleEvent);
      fixture.detectChanges();
      matDialog.open.calls.reset();

      (fixture.nativeElement as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );

      expect(matDialog.open).toHaveBeenCalledWith(
        jasmine.anything(),
        jasmine.objectContaining({
          data: jasmine.objectContaining({ repeatCfg, targetDate: '2026-07-29' }),
        }),
      );
    });
  });

  describe('resize handle', () => {
    it('should hide resizing when resize is disabled', () => {
      fixture.componentRef.setInput('event', makeTaskScheduleEvent());
      fixture.detectChanges();

      expect(component.isResizable()).toBe(true);

      fixture.componentRef.setInput('isResizeDisabled', true);
      fixture.detectChanges();

      expect(component.isResizable()).toBe(false);
    });

    it('should hide resizing for drag previews', () => {
      fixture.componentRef.setInput('event', makeTaskScheduleEvent());
      fixture.componentRef.setInput('isDragPreview', true);
      fixture.detectChanges();

      expect(component.isResizable()).toBe(false);
    });

    // The handle is a 12px band on the bottom edge of every event, unreachable on
    // purpose with a finger but easy to hit by accident, so it is mouse-only (#9675).
    describe('mouse-only resizing', () => {
      const getHandle = (): HTMLElement => {
        fixture.componentRef.setInput('event', makeTaskScheduleEvent());
        fixture.detectChanges();
        const handle = fixture.nativeElement.querySelector('.resize-handle');
        expect(handle).withContext('resize handle must be rendered').toBeTruthy();
        return handle as HTMLElement;
      };

      const mouseDownOnHandle = (clientY: number): void =>
        void getHandle().dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientY }),
        );

      afterEach(() => {
        // release any gesture a failing expectation left armed
        document.dispatchEvent(new MouseEvent('mouseup'));
      });

      it('should render the handle while mouse is the active input', () => {
        // the test env reports mouseOnly, so this pins the non-touch branch only
        expect(isTouchActive()).toBe(false);
        getHandle();
        expect(component.isResizable()).toBe(true);
      });

      it('should follow the mouse while resizing', () => {
        const handle = getHandle();
        const heightAtStart = fixture.nativeElement.offsetHeight;
        handle.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientY: 100 }),
        );

        expect(component.cssClass()).toContain('is-resizing');

        document.dispatchEvent(new MouseEvent('mousemove', { clientY: 160 }));

        // no .grid-container ancestor in the fixture, so the unsnapped fallback applies
        expect(component._resizeHeight()).toBe(`${heightAtStart + 60}px`);

        document.dispatchEvent(new MouseEvent('mouseup'));
        expect(component.cssClass()).not.toContain('is-resizing');
      });

      it('should drop document listeners once the gesture ends', () => {
        mouseDownOnHandle(100);
        document.dispatchEvent(new MouseEvent('mouseup'));

        component._resizeHeight.set('');
        document.dispatchEvent(new MouseEvent('mousemove', { clientY: 300 }));

        expect(component._resizeHeight()).toBe('');
      });
    });
  });

  describe('split-continued segments stay interactive (#9363)', () => {
    const setEvent = (type: SVEType): void => {
      fixture.componentRef.setInput('event', { ...makeTaskScheduleEvent(), type });
      fixture.detectChanges();
    };

    it('should resolve the task for the continued segments of a split task', () => {
      setEvent(SVEType.SplitTaskContinued);
      expect(component.task()?.id).toBe('task-1');

      setEvent(SVEType.SplitTaskContinuedLast);
      expect(component.task()?.id).toBe('task-1');
    });

    it('should select the task when a continued segment is clicked', async () => {
      const taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
      setEvent(SVEType.SplitTaskContinued);

      await component.clickHandler(new MouseEvent('click'));

      expect(taskService.setSelectedId).toHaveBeenCalledOnceWith('task-1');
    });

    it('should keep continued segments undraggable', () => {
      // elementId() is gated on isDraggableSE(), so an empty id also means no
      // duplicate DOM ids across the segments of one task
      setEvent(SVEType.Task);
      expect(component.elementId()).toBe('t-task-1');

      setEvent(SVEType.SplitTaskContinued);
      expect(component.elementId()).toBe('');

      setEvent(SVEType.SplitTaskContinuedLast);
      expect(component.elementId()).toBe('');
    });

    it('should open the task context menu on right-click of a continued segment', () => {
      setEvent(SVEType.SplitTaskContinuedLast);

      const menu = component.taskContextMenu();
      expect(menu).toBeTruthy();
      const openSpy = spyOn(menu!, 'open');

      component.onContextMenu(new MouseEvent('contextmenu'));

      expect(openSpy).toHaveBeenCalled();
    });

    it('should not offer resizing on any continued segment', () => {
      // the head already carries the handle, and SplitTaskContinuedLast is not
      // reliably the final segment of a multi-day scheduled task
      setEvent(SVEType.Task);
      expect(fixture.nativeElement.querySelector('.resize-handle')).toBeTruthy();

      setEvent(SVEType.SplitTaskContinued);
      expect(component.isResizable()).toBe(false);
      expect(fixture.nativeElement.querySelector('.resize-handle')).toBeNull();

      setEvent(SVEType.SplitTaskContinuedLast);
      expect(component.isResizable()).toBe(false);
      expect(fixture.nativeElement.querySelector('.resize-handle')).toBeNull();
    });
  });

  it('should delete scheduled tasks through TaskService cleanup', fakeAsync(() => {
    const task = {
      id: 'task-1',
      title: 'Task',
      timeEstimate: 3600000,
      subTaskIds: [],
      subTasks: [],
    } as any;
    const store = TestBed.inject(MockStore);
    const taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
    store.overrideSelector(selectTaskByIdWithSubTaskData, task);
    fixture.componentRef.setInput('event', makeTaskScheduleEvent());
    fixture.detectChanges();

    component.deleteTask();
    tick(51);

    expect(taskService.remove).toHaveBeenCalledOnceWith(task);
  }));

  // #9946: the selector returns undefined for a task that is gone from the
  // store; removing an id-less stub used to wipe every top-level task.
  it('should not delete anything when the task is gone from the store', fakeAsync(() => {
    const store = TestBed.inject(MockStore);
    const taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
    store.overrideSelector(selectTaskByIdWithSubTaskData, undefined);
    fixture.componentRef.setInput('event', makeTaskScheduleEvent());
    fixture.detectChanges();

    component.deleteTask();
    tick(51);

    expect(taskService.remove).not.toHaveBeenCalled();
  }));

  describe('style', () => {
    it('should render overlapping events in equal-width lanes', () => {
      fixture.componentRef.setInput(
        'event',
        makeTaskScheduleEvent({ count: 2, offset: 1 }),
      );
      fixture.detectChanges();

      expect(component.style()).toBe(
        'margin-left: calc(50% + var(--margin-left)); ' +
          'width: calc(50% - var(--margin-left) - var(--margin-right)); ' +
          'overflow: hidden !important; ' +
          'grid-column: 2;  grid-row: 121 / span 12',
      );
    });

    it('should not lane events in month view', () => {
      fixture.componentRef.setInput(
        'event',
        makeTaskScheduleEvent({ count: 2, offset: 1 }),
      );
      fixture.componentRef.setInput('isMonthView', true);
      fixture.detectChanges();

      expect(component.style()).toBe('grid-column: 2;  grid-row: 121 / span 12');
    });
  });

  describe('scheduledClockStr 12/24-hour folding (#8565)', () => {
    // is24HourFormat is a signal; calling it (vs. negating the function ref,
    // which is always truthy) is what makes 12h locales fold 14:00 → 2:00.
    const setupWith24h = async (is24Hour: boolean): Promise<ScheduleEventComponent> => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [ScheduleEventComponent, DragDropModule, TranslateModule.forRoot()],
        providers: [
          provideMockStore(),
          { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
          {
            provide: TaskService,
            useValue: {
              setSelectedId: jasmine.createSpy('setSelectedId'),
              remove: jasmine.createSpy('remove'),
            },
          },
          {
            provide: CalendarEventActionsService,
            useValue: {
              hasEventUrl: jasmine.createSpy('hasEventUrl').and.returnValue(false),
              isPluginEvent: jasmine.createSpy('isPluginEvent').and.returnValue(false),
              canMoveEvent: jasmine.createSpy('canMoveEvent').and.returnValue(false),
              createAsTask: jasmine.createSpy('createAsTask'),
              hideForever: jasmine.createSpy('hideForever'),
            },
          },
          {
            provide: DateTimeFormatService,
            useValue: { is24HourFormat: () => is24Hour },
          },
        ],
        schemas: [NO_ERRORS_SCHEMA],
      }).compileComponents();

      const f = TestBed.createComponent(ScheduleEventComponent);
      const event = { ...makeTaskScheduleEvent(), startHours: 14 };
      f.componentRef.setInput('event', event);
      f.detectChanges();
      return f.componentInstance;
    };

    it('keeps 24-hour time for a 24h locale', async () => {
      const c = await setupWith24h(true);
      expect(c.scheduledClockStr()).toBe('14:00');
    });

    it('folds to 12-hour time for a 12h locale', async () => {
      const c = await setupWith24h(false);
      expect(c.scheduledClockStr()).toBe('2:00');
    });
  });
});

// Mirrors schedule-week.component.ts, which sets '[class.is-not-dragging]' on an
// ancestor -- without it the :host-context() guard never matches and every
// cursor below would read 'auto', making the assertions meaningless.
@Component({
  imports: [ScheduleEventComponent],
  template: `<div class="is-not-dragging">
    <schedule-event [event]="event"></schedule-event>
  </div>`,
})
class AffordanceHostComponent {
  event!: ScheduleEvent;
}

describe('ScheduleEventComponent – clickable affordance', () => {
  const CLICKABLE_REPEAT_TYPES = [
    SVEType.RepeatProjection,
    SVEType.RepeatProjectionSplit,
    SVEType.ScheduledRepeatProjection,
    SVEType.RepeatProjectionSplitContinued,
    SVEType.RepeatProjectionSplitContinuedLast,
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AffordanceHostComponent, DragDropModule, TranslateModule.forRoot()],
      providers: [
        provideMockStore(),
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
        {
          provide: TaskService,
          useValue: { setSelectedId: jasmine.createSpy('setSelectedId') },
        },
        {
          provide: CalendarEventActionsService,
          useValue: {
            hasEventUrl: () => false,
            isPluginEvent: () => false,
            canMoveEvent: () => false,
          },
        },
        { provide: DateTimeFormatService, useValue: { is24HourFormat: () => true } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  const cursorFor = (type: SVEType): string => {
    const fixture = TestBed.createComponent(AffordanceHostComponent);
    fixture.componentInstance.event = {
      id: 'repeat_cfg_1_2026-07-30_0',
      type,
      style: '',
      startHours: 10,
      timeLeftInHours: 1,
      plannedForDay: '2026-07-30',
      data: { id: 'repeat_cfg_1', title: 'Repeat' },
    } as ScheduleEvent;
    fixture.detectChanges();
    const host = fixture.nativeElement.querySelector('schedule-event') as HTMLElement;
    return getComputedStyle(host).cursor;
  };

  // Every type clickHandler() opens the repeat dialog for must look clickable.
  // The first three already did; the continued pair became clickable in #9314
  // and read 'auto' until the selector list was extended -- so those three
  // double as the positive control proving this assertion can fail.
  it('shows a pointer cursor for every repeat projection the dialog opens for', () => {
    const cursors = CLICKABLE_REPEAT_TYPES.map((type) => [type, cursorFor(type)]);

    expect(cursors).toEqual(CLICKABLE_REPEAT_TYPES.map((type) => [type, 'pointer']));
  });

  // LunchBreak is the one type clickHandler() genuinely ignores -- note that
  // SplitTaskContinued would be a wrong control here, since #9372 made it
  // select its task. Asserted positively: `not.toBe('pointer')` would pass just
  // as happily on '' -- a detached element, or styles that never applied.
  it('leaves the inert lunch break alone', () => {
    expect(cursorFor(SVEType.LunchBreak)).toBe('auto');
  });
});
