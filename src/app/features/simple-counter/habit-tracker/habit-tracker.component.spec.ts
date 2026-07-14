import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeSv from '@angular/common/locales/sv';
import { HabitTrackerComponent } from './habit-tracker.component';
import { SimpleCounterService } from '../simple-counter.service';
import { DateService } from '../../../core/date/date.service';
import { MatDialog } from '@angular/material/dialog';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { SimpleCounter, SimpleCounterType } from '../simple-counter.model';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { EMPTY_SIMPLE_COUNTER } from '../simple-counter.const';

describe('HabitTrackerComponent', () => {
  let component: HabitTrackerComponent;
  let fixture: ComponentFixture<HabitTrackerComponent>;
  let simpleCounterService: jasmine.SpyObj<SimpleCounterService>;
  let matDialog: jasmine.SpyObj<MatDialog>;

  const mockCounter: SimpleCounter = {
    ...EMPTY_SIMPLE_COUNTER,
    id: 'c1',
    title: 'Test Counter',
    isEnabled: true,
    type: SimpleCounterType.ClickCounter,
    isTrackStreaks: true,
    streakMode: 'specific-days',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    streakWeekDays: { '1': true }, // Monday enabled
    countOnDay: {},
  };

  beforeEach(async () => {
    registerLocaleData(localeSv, 'sv');
    simpleCounterService = jasmine.createSpyObj('SimpleCounterService', [
      'setCounterForDate',
      'updateOrder',
      'updateSimpleCounter',
      'deleteSimpleCounter',
    ]);
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [HabitTrackerComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        { provide: SimpleCounterService, useValue: simpleCounterService },
        { provide: MatDialog, useValue: matDialog },
        { provide: DateService, useValue: { todayStr: () => '2026-05-18' } },
        {
          provide: DateTimeFormatService,
          useValue: {
            currentLocale: () => 'sv',
            isoTextLocale: () => 'en-US',
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HabitTrackerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('simpleCounters', [mockCounter]);
    fixture.detectChanges();
  });

  it('uses the UI language for weekday headers with ISO formatting enabled', () => {
    const element = fixture.nativeElement as HTMLElement;
    const dayNames = Array.from(
      element.querySelectorAll<HTMLElement>('.day-name'),
      (dayName) => dayName.textContent?.trim(),
    );

    expect(dayNames).toHaveSize(7);
    expect(dayNames).toEqual(
      jasmine.arrayWithExactContents(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']),
    );
  });

  it('should not open edit dialog on long-press if day is disabled', fakeAsync(() => {
    const disabledDate = '2026-05-19'; // Tuesday (disabled in mockCounter)
    const tuesdayDow = 2;

    component.onPressStart(mockCounter, disabledDate, tuesdayDow);
    tick(800);
    component.onPressEnd();

    expect(matDialog.open).not.toHaveBeenCalled();
  }));

  it('should open edit dialog on long-press if day is enabled', fakeAsync(() => {
    const enabledDate = '2026-05-18'; // Monday (enabled in mockCounter)
    const mondayDow = 1;

    component.onPressStart(mockCounter, enabledDate, mondayDow);
    tick(800);
    component.onPressEnd();

    expect(matDialog.open).toHaveBeenCalled();
  }));

  it('should prevent default and not open dialog on context menu if day is disabled', () => {
    const event = jasmine.createSpyObj('MouseEvent', ['preventDefault']);
    const disabledDate = '2026-05-19';
    const tuesdayDow = 2;

    component.onCellContextMenu(event, mockCounter, disabledDate, tuesdayDow);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(matDialog.open).not.toHaveBeenCalled();
  });
});
