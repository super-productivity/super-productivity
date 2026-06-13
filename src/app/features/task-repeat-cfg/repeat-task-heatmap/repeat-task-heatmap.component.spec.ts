import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DateAdapter } from '@angular/material/core';
import { TranslateModule } from '@ngx-translate/core';
import { RepeatTaskHeatmapComponent } from './repeat-task-heatmap.component';
import { TaskService } from '../../tasks/task.service';
import { TaskArchiveService } from '../../archive/task-archive.service';
import { TaskRepeatCfgService } from '../task-repeat-cfg.service';
import { Task } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { setRRuleEngineEnabled } from '../../config/rrule-engine-flag';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Built from entries — date-string object-literal keys trip the
// naming-convention lint rule.
const task = (timeSpent: [string, number][]): Task =>
  ({
    id: 't1',
    repeatCfgId: 'CFG1',
    timeSpentOnDay: Object.fromEntries(timeSpent),
  }) as unknown as Task;

const setup = async (
  tasks: Task[],
  cfg: Partial<TaskRepeatCfg> = {},
): Promise<ComponentFixture<RepeatTaskHeatmapComponent>> => {
  TestBed.configureTestingModule({
    imports: [RepeatTaskHeatmapComponent, TranslateModule.forRoot()],
    providers: [
      { provide: TaskService, useValue: { allTasks$: of(tasks) } },
      {
        provide: TaskArchiveService,
        useValue: { load: () => Promise.resolve({ ids: [], entities: {} }) },
      },
      {
        provide: TaskRepeatCfgService,
        useValue: { getTaskRepeatCfgById$: () => of({ id: 'CFG1', ...cfg }) },
      },
      {
        provide: DateAdapter,
        useValue: {
          getFirstDayOfWeek: () => 0,
          getMonthNames: () => MONTHS,
          getDayOfWeekNames: () => WEEKDAYS,
        },
      },
    ],
  })
    .overrideComponent(RepeatTaskHeatmapComponent, {
      // Logic-only tests — skip rendering the switcher/heatmap children.
      set: { template: '<div></div>' },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(RepeatTaskHeatmapComponent);
  fixture.componentRef.setInput('repeatCfgId', 'CFG1');
  fixture.detectChanges();
  // _loadTasksForRepeatCfg resolves async — flush the microtask queue.
  await new Promise((r) => setTimeout(r));
  fixture.detectChanges();
  return fixture;
};

describe('RepeatTaskHeatmapComponent year selection', () => {
  beforeEach(() => setRRuleEngineEnabled(false));

  it('defaults to the newest year WITH data when the current year has none', async () => {
    // Regression: a cfg whose only history is in older years opened on an
    // empty current year with heatmapData() null — no heatmap, no year nav,
    // history unreachable.
    const fixture = await setup([task([['2024-03-05', 3_600_000]])]);
    const c = fixture.componentInstance;
    expect(c.availableYears()).toEqual([2024]);
    expect(c.selectedYear()).toBe(2024);
    expect(c.heatmapData()).not.toBeNull();
  });

  it('offers only years that render something (flag off → no empty current year)', async () => {
    const fixture = await setup([
      task([
        ['2023-01-05', 1_000],
        ['2024-03-05', 3_600_000],
      ]),
    ]);
    const c = fixture.componentInstance;
    expect(c.availableYears()).toEqual([2024, 2023]);
    expect(c.availableYears()).not.toContain(new Date().getFullYear());
  });

  it('falls back to the current year when there is no data at all', async () => {
    const fixture = await setup([]);
    const c = fixture.componentInstance;
    expect(c.selectedYear()).toBe(new Date().getFullYear());
  });

  it('includes the current year when the projection overlay can mark it (flag on + valid rrule)', async () => {
    setRRuleEngineEnabled(true);
    try {
      const fixture = await setup([task([['2024-03-05', 3_600_000]])], {
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        startDate: '2024-01-01',
      } as Partial<TaskRepeatCfg>);
      const c = fixture.componentInstance;
      expect(c.availableYears()).toEqual([new Date().getFullYear(), 2024]);
    } finally {
      setRRuleEngineEnabled(false);
    }
  });

  it('hides cells for days the task is not scheduled on (streak view, flag on)', async () => {
    setRRuleEngineEnabled(true);
    try {
      const fixture = await setup([task([['2024-03-04', 3_600_000]])], {
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        startDate: '2024-01-01',
      } as Partial<TaskRepeatCfg>);
      const c = fixture.componentInstance;
      // Defaults to the current (projection-capable) year; only Mondays —
      // scheduled days — survive in the map, so off-schedule days render as
      // transparent placeholders instead of grey "missed" cells.
      const dayMap = c.heatmapData()!.dayMap;
      expect(dayMap.size).toBeGreaterThan(50);
      for (const d of dayMap.values()) {
        expect(d.date.getDay()).withContext(d.dateStr).toBe(1);
      }
    } finally {
      setRRuleEngineEnabled(false);
    }
  });

  it('keeps off-schedule days that carry tracked time', async () => {
    setRRuleEngineEnabled(true);
    try {
      // 2024-03-05 is a Tuesday — real tracked time on a day the rule never
      // fires must stay visible (instance moved / done off-schedule).
      const fixture = await setup([task([['2024-03-05', 3_600_000]])], {
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        startDate: '2024-01-01',
      } as Partial<TaskRepeatCfg>);
      const c = fixture.componentInstance;
      c.prevYear(); // current year is the default — navigate to the data year
      expect(c.selectedYear()).toBe(2024);
      const dayMap = c.heatmapData()!.dayMap;
      expect(dayMap.has('2024-03-05')).toBe(true); // tracked Tuesday stays
      expect(dayMap.has('2024-03-12')).toBe(false); // bare Tuesday is hidden
      expect(dayMap.has('2024-03-11')).toBe(true); // scheduled Monday stays
    } finally {
      setRRuleEngineEnabled(false);
    }
  });

  it('hides off-schedule days for a legacy cfg WITHOUT the rrule engine (flag off)', async () => {
    // Regression (curator round 2): the streak hide used to be gated behind the
    // experimental engine, so legacy `repeatCycle` tasks — every normal user —
    // saw a full grey grid. The overlay now runs off the legacy engine itself.
    const fixture = await setup([task([['2024-03-04', 3_600_000]])], {
      repeatCycle: 'WEEKLY',
      repeatEvery: 1,
      monday: true,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
      startDate: '2024-01-01',
    } as Partial<TaskRepeatCfg>);
    const c = fixture.componentInstance;
    // Defaults to the current (projection-capable) year; only Mondays survive,
    // so off-schedule days render as transparent placeholders.
    const dayMap = c.heatmapData()!.dayMap;
    expect(dayMap.size).toBeGreaterThan(40);
    let projectedCount = 0;
    for (const d of dayMap.values()) {
      expect(d.date.getDay()).withContext(d.dateStr).toBe(1);
      if (d.isProjected) {
        projectedCount++;
      }
    }
    // Upcoming Mondays this year are projected (outlined) cells.
    expect(projectedCount).toBeGreaterThan(0);
  });

  it('adds the current year to the nav for a legacy recurring cfg (flag off)', async () => {
    // History only in 2024, but the legacy weekly schedule projects into the
    // current year — which must therefore be reachable.
    const fixture = await setup([task([['2024-03-04', 3_600_000]])], {
      repeatCycle: 'WEEKLY',
      repeatEvery: 1,
      monday: true,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
      startDate: '2024-01-01',
    } as Partial<TaskRepeatCfg>);
    const c = fixture.componentInstance;
    expect(c.availableYears()).toContain(new Date().getFullYear());
  });

  it('keeps a legacy off-schedule day that carries tracked time (flag off)', async () => {
    // 2024-03-05 is a Tuesday — the weekly-Monday rule never fires there, but
    // real tracked time must stay visible (instance moved / done off-schedule).
    const fixture = await setup([task([['2024-03-05', 3_600_000]])], {
      repeatCycle: 'WEEKLY',
      repeatEvery: 1,
      monday: true,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
      startDate: '2024-01-01',
    } as Partial<TaskRepeatCfg>);
    const c = fixture.componentInstance;
    c.prevYear(); // current year is the default — navigate to the data year
    expect(c.selectedYear()).toBe(2024);
    const dayMap = c.heatmapData()!.dayMap;
    expect(dayMap.has('2024-03-05')).toBe(true); // tracked Tuesday stays
    expect(dayMap.has('2024-03-12')).toBe(false); // bare Tuesday is hidden
    expect(dayMap.has('2024-03-04')).toBe(true); // scheduled Monday stays
  });

  it('keeps an empty navigated year rendered while other years exist (no stranding)', async () => {
    setRRuleEngineEnabled(true);
    try {
      // Projection puts the current year in the list, but a rule whose UNTIL
      // already passed projects nothing — the view must stay up (empty grid +
      // nav) instead of tearing down the way back.
      const fixture = await setup([task([['2024-03-05', 3_600_000]])], {
        rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20240601T000000Z',
        startDate: '2024-01-01',
      } as Partial<TaskRepeatCfg>);
      const c = fixture.componentInstance;
      expect(c.availableYears().length).toBeGreaterThan(1);
      c.nextYear(); // navigate to the (empty) current year
      expect(c.selectedYear()).toBe(new Date().getFullYear());
      expect(c.heatmapData()).not.toBeNull();
      c.prevYear(); // and back to the data
      expect(c.selectedYear()).toBe(2024);
    } finally {
      setRRuleEngineEnabled(false);
    }
  });
});
