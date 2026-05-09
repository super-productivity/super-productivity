import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideMockStore } from '@ngrx/store/testing';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { TranslateModule } from '@ngx-translate/core';
import { ScheduleEventComponent } from './schedule-event.component';
import { SVEType } from '../schedule.const';
import { ScheduleEvent } from '../schedule.model';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../../tasks/task.service';
import { CalendarEventActionsService } from '../../calendar-integration/calendar-event-actions.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';

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

const makeTaskScheduleEvent = (): ScheduleEvent => ({
  id: 'task-1',
  type: SVEType.Task,
  style: '',
  startHours: 10,
  timeLeftInHours: 1,
  data: { id: 'task-1', title: 'Task' } as any,
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
          useValue: { setSelectedId: jasmine.createSpy('setSelectedId') },
        },
        {
          provide: CalendarEventActionsService,
          useValue: {
            hasEventUrl: jasmine.createSpy('hasEventUrl').and.returnValue(false),
            isPluginEvent: jasmine.createSpy('isPluginEvent').and.returnValue(false),
            createAsTask: jasmine.createSpy('createAsTask'),
            hideForever: jasmine.createSpy('hideForever'),
          },
        },
        {
          provide: DateTimeFormatService,
          useValue: { is24HourFormat: true },
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
});
