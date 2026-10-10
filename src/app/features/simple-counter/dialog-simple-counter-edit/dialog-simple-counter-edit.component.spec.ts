import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { DateService } from '../../../core/date/date.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { DialogSimpleCounterEditComponent } from './dialog-simple-counter-edit.component';
import { SimpleCounterCopy, SimpleCounterType } from '../simple-counter.model';
import { SimpleCounterService } from '../simple-counter.service';

const LOGICAL_TODAY = '2026-01-06';
const WEDNESDAY = 3;

describe('DialogSimpleCounterEditComponent', () => {
  let dateService: DateService;
  let environmentInjector: EnvironmentInjector;

  const simpleCounter: SimpleCounterCopy = {
    id: 'habit',
    title: 'Habit',
    isEnabled: true,
    icon: null,
    type: SimpleCounterType.ClickCounter,
    isTrackStreaks: true,
    streakMinValue: 1,
    streakMode: 'specific-days',
    streakWeekDays: { [WEDNESDAY]: true },
    countOnDay: { [LOGICAL_TODAY]: 1 },
    isOn: false,
  };

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 0, 7, 20));

    TestBed.configureTestingModule({
      providers: [
        DateService,
        { provide: MAT_DIALOG_DATA, useValue: { simpleCounter } },
        { provide: MatDialogRef, useValue: { close: () => undefined } },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        {
          provide: SimpleCounterService,
          useValue: jasmine.createSpyObj('SimpleCounterService', [
            'setCounterForDate',
            'updateSimpleCounter',
          ]),
        },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: () => 'en-US' },
        },
      ],
    });

    dateService = TestBed.inject(DateService);
    dateService.setStartOfNextDayDiff('23:00');
    environmentInjector = TestBed.inject(EnvironmentInjector);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('ends the habit chart at logical today before the configured day rollover', () => {
    const component = runInInjectionContext(
      environmentInjector,
      () => new DialogSimpleCounterEditComponent(),
    );

    const chartData = component.chartData();
    const labels = chartData.labels ?? [];
    const lastIndex = labels.length - 1;

    component.onChartClick({ active: [{ index: lastIndex }] });

    expect(component.todayStr).toBe(LOGICAL_TODAY);
    expect(component.selectedDateStr()).toBe(LOGICAL_TODAY);
    expect(chartData.datasets[0].data[lastIndex]).toBe(1);
    expect(labels[lastIndex]).not.toContain('❌');
  });
});
