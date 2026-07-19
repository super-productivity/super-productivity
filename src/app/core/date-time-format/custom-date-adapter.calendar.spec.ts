import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
  DateAdapter,
  MAT_DATE_FORMATS,
  MAT_DATE_LOCALE,
  MAT_NATIVE_DATE_FORMATS,
} from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { CustomDateAdapter } from './custom-date-adapter';
import { DateTimeFormatService } from './date-time-format.service';
import { GlobalConfigService } from '../../features/config/global-config.service';

/**
 * Integration coverage for the #8987 follow-up: the Material `<mat-calendar>`
 * (used by the schedule-task dialog, deadline dialog, etc.) must render its
 * weekday header in the UI language when the ISO 8601 option is active, and
 * update live when the language changes — while the adapter locale itself stays
 * `sv` (the ISO sentinel).
 */
@Component({
  standalone: true,
  imports: [MatDatepickerModule],
  template: `<mat-calendar [startAt]="startAt"></mat-calendar>`,
})
class CalendarHostComponent {
  startAt = new Date(2026, 6, 14);
}

describe('CustomDateAdapter × mat-calendar weekday header', () => {
  let fixture: ComponentFixture<CalendarHostComponent>;
  let adapter: DateAdapter<Date>;
  let isoTextLocale: string | null;

  const longWeekdayNames = (): string[] => {
    const host = fixture.nativeElement as HTMLElement;
    return Array.from(
      host.querySelectorAll<HTMLElement>(
        '.mat-calendar-table-header th .cdk-visually-hidden',
      ),
      (el) => el.textContent?.trim() ?? '',
    );
  };

  beforeEach(() => {
    isoTextLocale = 'en';

    const dateTimeFormatServiceMock: Partial<DateTimeFormatService> = {
      isoTextLocale: (() => isoTextLocale) as DateTimeFormatService['isoTextLocale'],
      dateFormat: (() => ({
        raw: 'yyyy-MM-dd',
        humanReadable: 'YYYY-MM-DD',
      })) as DateTimeFormatService['dateFormat'],
      formatDate: (date: Date) => date.toISOString().slice(0, 10),
    };

    TestBed.configureTestingModule({
      imports: [CalendarHostComponent, NoopAnimationsModule],
      providers: [
        { provide: DateAdapter, useClass: CustomDateAdapter },
        { provide: MAT_DATE_LOCALE, useValue: 'sv' },
        { provide: MAT_DATE_FORMATS, useValue: MAT_NATIVE_DATE_FORMATS },
        { provide: DateTimeFormatService, useValue: dateTimeFormatServiceMock },
        {
          provide: GlobalConfigService,
          useValue: { localization: () => ({ firstDayOfWeek: 1 }) },
        },
      ],
    });

    adapter = TestBed.inject(DateAdapter);
    // Mirror the running app: the ISO 8601 option keeps `sv` as the adapter locale.
    adapter.setLocale('sv');

    fixture = TestBed.createComponent(CalendarHostComponent);
    fixture.detectChanges();
  });

  it('renders the weekday header in the UI language, not Swedish', () => {
    const names = longWeekdayNames();
    expect(names).toContain('Monday');
    expect(names).not.toContain('måndag');
    // Adapter locale is untouched, so numeric/date formatting stays ISO.
    expect((adapter as unknown as { locale: string }).locale).toBe('sv');
  });

  it('updates the header live when the UI language changes', () => {
    expect(longWeekdayNames()).toContain('Monday');

    // Simulate a language switch: the service effect re-applies the adapter
    // locale, whose localeChanges event makes the calendar re-read the names.
    isoTextLocale = 'de';
    adapter.setLocale('sv');
    fixture.detectChanges();

    const names = longWeekdayNames();
    expect(names).toContain('Montag');
    expect(names).not.toContain('Monday');
  });

  it('falls back to the adapter locale for non-ISO options (null text locale)', () => {
    isoTextLocale = null;
    adapter.setLocale('sv');
    fixture.detectChanges();

    expect(longWeekdayNames()).toContain('måndag');
  });
});
