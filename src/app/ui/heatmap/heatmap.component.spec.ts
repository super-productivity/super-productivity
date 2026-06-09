import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DateAdapter } from '@angular/material/core';

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

describe('HeatmapComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(async () => {
    document.body.classList.add('isDarkTheme');
    document.body.style.setProperty('--c-light-05', 'rgba(255, 255, 255, 0.05)');
    document.body.style.setProperty('--ink-on-channel', '255, 255, 255');
    document.body.style.setProperty('--c-primary', 'rgb(90, 150, 255)');

    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [{ provide: DateAdapter, useValue: { getFirstDayOfWeek: () => 0 } }],
    }).compileComponents();

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
});
