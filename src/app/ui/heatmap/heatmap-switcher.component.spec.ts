import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DateAdapter } from '@angular/material/core';
import { TranslateModule } from '@ngx-translate/core';
import { HeatmapSwitcherComponent } from './heatmap-switcher.component';
import { DayData, HeatmapData } from './heatmap.component';

const STORAGE_KEY = 'sp_heatmap_view_test';

const setup = (persistKey = 'test'): ComponentFixture<HeatmapSwitcherComponent> => {
  TestBed.configureTestingModule({
    imports: [HeatmapSwitcherComponent, TranslateModule.forRoot()],
    providers: [
      {
        provide: DateAdapter,
        useValue: {
          getFirstDayOfWeek: () => 0,
          getMonthNames: () => [
            'J',
            'F',
            'M',
            'A',
            'M',
            'J',
            'J',
            'A',
            'S',
            'O',
            'N',
            'D',
          ],
          getDayOfWeekNames: () => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(HeatmapSwitcherComponent);
  const data: HeatmapData = { weeks: [], monthLabels: [], months: [] };
  fixture.componentRef.setInput('data', data);
  fixture.componentRef.setInput('dayMap', new Map<string, DayData>());
  fixture.componentRef.setInput('rangeStart', new Date(2024, 0, 1));
  fixture.componentRef.setInput('rangeEnd', new Date(2024, 11, 31));
  fixture.componentRef.setInput('persistKey', persistKey);
  fixture.detectChanges();
  return fixture;
};

describe('HeatmapSwitcherComponent', () => {
  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it('defaults to the year view', () => {
    const c = setup().componentInstance;
    expect(c.view()).toBe('year');
  });

  it('restores a persisted view choice', () => {
    localStorage.setItem(STORAGE_KEY, 'month');
    const c = setup().componentInstance;
    expect(c.view()).toBe('month');
  });

  it('persists the view choice on change', () => {
    const c = setup().componentInstance;
    c.setView('month');
    expect(c.view()).toBe('month');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('month');
  });

  it('does not persist without a persistKey', () => {
    const c = setup('').componentInstance;
    c.setView('month');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
