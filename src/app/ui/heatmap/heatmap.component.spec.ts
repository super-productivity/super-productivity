import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DateAdapter } from '@angular/material/core';
import { By } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';

import { HeatmapComponent, HeatmapData } from './heatmap.component';

@Component({
  standalone: true,
  imports: [HeatmapComponent],
  template: `<heatmap [data]="data" />`,
})
class TestHostComponent {
  data: HeatmapData = {
    monthLabels: ['Jan'],
    weeks: [
      {
        days: [
          {
            date: new Date(2026, 0, 1),
            dateStr: '2026-01-01',
            taskCount: 0,
            timeSpent: 0,
            level: 0,
          },
          {
            date: new Date(2026, 0, 2),
            dateStr: '2026-01-02',
            taskCount: 1,
            timeSpent: 60000,
            level: 1,
          },
          null,
        ],
      },
    ],
  };
}

// Stand-ins for the locale-aware names `CustomDateAdapter` returns, distinct from
// the English defaults so a hardcoded fallback would fail the assertions.
const LOCALIZED_DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const TRANSLATIONS = {
  HEATMAP: {
    DAY_TOOLTIP: {
      ONE: '{{date}}: {{taskCount}} Aufgabe, {{timeSpent}}',
      OTHER: '{{date}}: {{taskCount}} Aufgaben, {{timeSpent}}',
    },
    LEGEND_LESS: 'Weniger',
    LEGEND_MORE: 'Mehr',
  },
};

describe('HeatmapComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let firstDayOfWeek: number;

  beforeEach(async () => {
    document.body.classList.add('isDarkTheme');
    document.body.style.setProperty('--c-light-05', 'rgba(255, 255, 255, 0.05)');
    document.body.style.setProperty('--ink-on-channel', '255, 255, 255');
    document.body.style.setProperty('--c-primary', 'rgb(90, 150, 255)');
    firstDayOfWeek = 0;

    await TestBed.configureTestingModule({
      imports: [TestHostComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: DateAdapter,
          useValue: {
            getFirstDayOfWeek: () => firstDayOfWeek,
            getDayOfWeekNames: () => LOCALIZED_DAY_NAMES,
            localeChanges: new Subject<void>(),
          },
        },
      ],
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', TRANSLATIONS);
    translateService.use('de');

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.body.classList.remove('isDarkTheme');
    document.body.style.removeProperty('--c-light-05');
    document.body.style.removeProperty('--ink-on-channel');
    document.body.style.removeProperty('--c-primary');
    fixture.destroy();
  });

  it('keeps dark-theme empty heatmap days transparent', () => {
    const emptyDay = fixture.nativeElement.querySelector('.day.empty') as HTMLElement;

    expect(getComputedStyle(emptyDay).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(emptyDay).boxShadow).toBe('none');
  });

  it('keeps dark-theme inactive heatmap days borderless', () => {
    const inactiveDay = fixture.nativeElement.querySelector(
      '.day.level-0',
    ) as HTMLElement;

    const computed = getComputedStyle(inactiveDay);
    expect(computed.backgroundColor).toBe('rgba(255, 255, 255, 0.16)');
    expect(computed.boxShadow).not.toContain('rgba(255, 255, 255');
  });

  it('keeps the dark-theme legend borderless', () => {
    const inactiveLegendItem = fixture.nativeElement.querySelector(
      '.legend-item.level-0',
    ) as HTMLElement;

    expect(getComputedStyle(inactiveLegendItem).boxShadow).not.toContain(
      'rgba(255, 255, 255',
    );
  });

  it('takes weekday abbreviations from the locale-aware date adapter', () => {
    const renderedLabels = Array.from(
      fixture.nativeElement.querySelectorAll('.day-label') as NodeListOf<HTMLElement>,
    ).map((el) => el.textContent?.trim());

    expect(renderedLabels).toEqual(LOCALIZED_DAY_NAMES);
  });

  it('rotates the localized weekday abbreviations by the first day of week', () => {
    firstDayOfWeek = 1;
    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    expect(
      fixture.debugElement
        .query(By.directive(HeatmapComponent))
        .componentInstance.dayLabels(),
    ).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
  });

  it('translates the legend labels', () => {
    const legendText = (
      fixture.nativeElement.querySelector('.heatmap-legend') as HTMLElement
    ).textContent;

    expect(legendText).toContain('Weniger');
    expect(legendText).toContain('Mehr');
  });

  it('translates day tooltips and picks the plural form by task count', () => {
    const days = Array.from(
      fixture.nativeElement.querySelectorAll('.day') as NodeListOf<HTMLElement>,
    );

    expect(days[0].title).toBe('2026-01-01: 0 Aufgaben, -');
    expect(days[1].title).toBe('2026-01-02: 1 Aufgabe, 1m');
    // Days outside the range render without a tooltip.
    expect(days[2].title).toBe('');
  });
});
