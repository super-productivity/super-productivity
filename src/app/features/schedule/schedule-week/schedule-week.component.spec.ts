import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideMockStore } from '@ngrx/store/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ScheduleWeekComponent } from './schedule-week.component';
import { ScheduleEventComponent } from '../schedule-event/schedule-event.component';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { ScheduleEvent } from '../schedule.model';
import { SVEType } from '../schedule.const';

describe('ScheduleWeekComponent', () => {
  let fixture: ComponentFixture<ScheduleWeekComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, ScheduleWeekComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore(),
        {
          provide: DateTimeFormatService,
          useValue: {
            is24HourFormat: signal(true),
            currentLocale: signal('en-US'),
          },
        },
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: signal(DEFAULT_GLOBAL_CONFIG),
          },
        },
      ],
    })
      .overrideComponent(ScheduleWeekComponent, {
        remove: { imports: [ScheduleEventComponent] },
        add: { imports: [ScheduleEventStubComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ScheduleWeekComponent);
  });

  it('should dedupe visible and hidden beyond-budget tasks in the day badge', () => {
    fixture.componentRef.setInput('daysToShow', ['2026-05-11']);
    fixture.componentRef.setInput('events', [
      createTaskEvent('task-1', '2026-05-11', true),
    ]);
    fixture.componentRef.setInput('beyondBudget', [
      [
        createTaskEvent('task-1', '2026-05-11', true),
        createTaskEvent('task-2', '2026-05-11', true),
      ],
    ]);

    expect(fixture.componentInstance.beyondBudgetStats()[0].count).toBe(2);
  });

  it('should render the hidden beyond-budget task count in the day badge', () => {
    fixture.componentRef.setInput('daysToShow', ['2026-05-11']);
    fixture.componentRef.setInput('events', []);
    fixture.componentRef.setInput('beyondBudget', [
      [
        createTaskEvent('task-1', '2026-05-11', true),
        createTaskEvent('task-2', '2026-05-11', true),
      ],
    ]);

    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.over-budget-count')?.textContent.trim(),
    ).toBe('2');
  });
});

@Component({
  selector: 'schedule-event',
  standalone: true,
  template: '',
})
class ScheduleEventStubComponent {
  @Input() event?: ScheduleEvent;
  @Input() isDragPreview?: boolean;
  @Input() cdkDragData?: ScheduleEvent;
  @Input() cdkDragDisabled?: boolean;
  @Input() cdkDragStartDelay?: number;
  @Output() cdkDragMoved = new EventEmitter<unknown>();
  @Output() cdkDragStarted = new EventEmitter<unknown>();
  @Output() cdkDragReleased = new EventEmitter<unknown>();
}

const createTaskEvent = (
  id: string,
  plannedForDay: string,
  isBeyondBudget: boolean,
): ScheduleEvent => ({
  id,
  type: SVEType.TaskPlannedForDay,
  style: '',
  startHours: 10,
  timeLeftInHours: 1,
  data: {
    id,
  } as ScheduleEvent['data'],
  plannedForDay,
  isBeyondBudget,
});
