import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
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
