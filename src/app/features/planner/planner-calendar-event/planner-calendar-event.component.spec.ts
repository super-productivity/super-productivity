import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { PlannerCalendarEventComponent } from './planner-calendar-event.component';
import { CalendarEventActionsService } from '../../calendar-integration/calendar-event-actions.service';
import { DateService } from '../../../core/date/date.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { ShortTimeHtmlPipe } from '../../../ui/pipes/short-time-html.pipe';
import { ShortTimePipe } from '../../../ui/pipes/short-time.pipe';
import { ScheduleFromCalendarEvent } from '../../schedule/schedule.model';

const EVENT: ScheduleFromCalendarEvent = {
  id: 'e1',
  calProviderId: 'cal-1',
  title: 'Standup',
  start: 1_700_000_000_000,
  duration: 60 * 60 * 1000,
  issueProviderKey: 'ICAL',
};

describe('PlannerCalendarEventComponent', () => {
  let fixture: ComponentFixture<PlannerCalendarEventComponent>;

  const createWith = (
    showStartTime?: boolean,
    event: ScheduleFromCalendarEvent = EVENT,
  ): void => {
    fixture = TestBed.createComponent(PlannerCalendarEventComponent);
    fixture.componentRef.setInput('calendarEvent', event);
    if (showStartTime !== undefined) {
      fixture.componentRef.setInput('showStartTime', showStartTime);
    }
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        PlannerCalendarEventComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        // Stubbed so the pipe chain resolves to a deterministic clock string.
        { provide: DateService, useValue: { isToday: () => true } },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: () => 'en-US', formatTime: () => '2:13 PM' },
        },
        {
          provide: CalendarEventActionsService,
          useValue: jasmine.createSpyObj('CalendarEventActionsService', {
            isPluginEvent: false,
            hasEventUrl: false,
          }),
        },
        ShortTimeHtmlPipe,
        ShortTimePipe,
      ],
    });
  });

  it('renders the clock start time when showStartTime is true', () => {
    createWith(true);
    const el: HTMLElement | null = fixture.nativeElement.querySelector('.start-time');
    expect(el).toBeTruthy();
    expect(el!.textContent).toContain('2:13');
  });

  it('does not render the start time by default', () => {
    createWith();
    expect(fixture.nativeElement.querySelector('.start-time')).toBeNull();
  });

  it('places the start time as the right-most item, after the duration', () => {
    createWith(true);
    const children = Array.from(
      (fixture.nativeElement.querySelector('.event-content') as HTMLElement).children,
    ) as HTMLElement[];
    const durationIdx = children.findIndex((c) =>
      c.classList.contains('planner-time-remaining-shared'),
    );
    const startTimeIdx = children.findIndex((c) => c.classList.contains('start-time'));
    expect(durationIdx).toBeGreaterThanOrEqual(0);
    expect(startTimeIdx).toBe(children.length - 1);
    expect(startTimeIdx).toBeGreaterThan(durationIdx);
  });

  it('exposes the calendar color as --cal-event-color on the host', () => {
    createWith(undefined, { ...EVENT, color: '#4caf50' });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--cal-event-color')).toBe('#4caf50');
  });

  it('does not set --cal-event-color when the event has no color', () => {
    createWith();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--cal-event-color')).toBe('');
  });

  it('draws the color dot only for a colored event with the default icon', () => {
    const hasDot = (): boolean => !!fixture.nativeElement.querySelector('.color-dot');
    createWith(undefined, { ...EVENT, color: '#4caf50' });
    expect(hasDot()).toBe(true);
    fixture.componentRef.setInput('calendarEvent', {
      ...EVENT,
      color: '#4caf50',
      icon: 'flag',
    });
    fixture.detectChanges();
    expect(hasDot()).toBe(false);
    fixture.componentRef.setInput('calendarEvent', EVENT);
    fixture.detectChanges();
    expect(hasDot()).toBe(false);
  });
});
