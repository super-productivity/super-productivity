import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { DateService } from 'src/app/core/date/date.service';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { MetricService } from '../metric.service';
import { DialogFocusSessionEditComponent } from './dialog-focus-session-edit.component';

describe('DialogFocusSessionEditComponent', () => {
  const createComponent = (day: string): DialogFocusSessionEditComponent => {
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { day, focusSessions: [25 * 60000] } },
        { provide: MatDialogRef, useValue: {} },
        { provide: MetricService, useValue: {} },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
        { provide: DateService, useValue: { todayStr: () => '2026-01-07' } },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: () => 'en-US', textLocale: () => 'en-US' },
        },
      ],
    });
    return TestBed.runInInjectionContext(() => new DialogFocusSessionEditComponent());
  };

  afterEach(() => TestBed.resetTestingModule());

  // Date-only keys must be read as local days; parsing them as UTC midnight
  // ends the chart a day early in timezones west of UTC, dropping the selected day.
  it('should end the chart on the selected day and plot its sessions', () => {
    const component = createComponent('2026-01-05');

    const { labels, datasets } = component.chartData();

    expect(labels?.length).toBe(28);
    expect(labels?.[27]).toBe(
      new Date(2026, 0, 5).toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
      }),
    );
    expect(datasets[0].data[27]).toBe(25);
  });

  it('should format the selected date as its local day', () => {
    const component = createComponent('2026-01-05');

    expect(component.formatSelectedDate()).toBe(
      new Date(2026, 0, 5).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    );
  });
});
