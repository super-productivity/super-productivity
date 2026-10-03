import { ComponentFixture, TestBed, fakeAsync, flush } from '@angular/core/testing';
import { DateAdapter } from '@angular/material/core';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, Subject, of } from 'rxjs';

import { SnackService } from '../../../core/snack/snack.service';
import { ShareService } from '../../../core/share/share.service';
import { Task } from '../../tasks/task.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { Worklog, WorklogDataForDay } from '../../worklog/worklog.model';
import { WorklogService } from '../../worklog/worklog.service';
import { ActivityHeatmapComponent } from './activity-heatmap.component';

// Stand-ins for the locale-aware names `CustomDateAdapter` returns, distinct from
// the English defaults so a hardcoded fallback would fail the assertions.
const LOCALIZED_MONTH_NAMES = [
  'Jän',
  'Feb',
  'Mär',
  'Apr',
  'Mai',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dez',
];
const LOCALIZED_DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

describe('ActivityHeatmapComponent', () => {
  let fixture: ComponentFixture<ActivityHeatmapComponent>;
  let worklog$: BehaviorSubject<Worklog>;

  const dayStr = '2026-06-03';
  const year = 2026;
  const workedMs = 60 * 60 * 1000;

  const createTask = (
    id: string,
    overrides: Partial<Task> = {},
    taskDateStr = dayStr,
  ): Task => ({
    attachments: [],
    created: new Date(taskDateStr).getTime(),
    id,
    isDone: false,
    projectId: 'project',
    subTaskIds: [],
    tagIds: [],
    timeEstimate: 0,
    timeSpent: 0,
    timeSpentOnDay: {},
    title: id,
    ...overrides,
  });

  const createWorklogEntry = (
    task: Task,
    overrides: Partial<WorklogDataForDay> = {},
  ): WorklogDataForDay => ({
    isNoRestore: false,
    task,
    timeSpent: workedMs,
    ...overrides,
  });

  const createWorklogWithParentAndSubtask = (worklogDayStr = dayStr): Worklog => {
    const [worklogYear, worklogMonth, worklogDayOfMonth] = worklogDayStr
      .split('-')
      .map(Number);
    const parentTask = createTask(
      'parent',
      {
        subTaskIds: ['subtask'],
        timeSpent: workedMs,
        timeSpentOnDay: { [worklogDayStr]: workedMs },
      },
      worklogDayStr,
    );
    const subTask = createTask(
      'subtask',
      {
        parentId: parentTask.id,
        timeSpent: workedMs,
        timeSpentOnDay: { [worklogDayStr]: workedMs },
      },
      worklogDayStr,
    );

    return {
      [worklogYear]: {
        daysWorked: 1,
        monthWorked: 1,
        timeSpent: workedMs,
        ent: {
          [worklogMonth]: {
            daysWorked: 1,
            ent: {
              [worklogDayOfMonth]: {
                dateStr: worklogDayStr,
                dayStr: 'Wed 3.',
                logEntries: [
                  createWorklogEntry(parentTask),
                  createWorklogEntry(subTask, { parentId: parentTask.id }),
                ],
                timeSpent: workedMs,
                workEnd: 0,
                workStart: 0,
              },
            },
            timeSpent: workedMs,
            weeks: [],
          },
        },
      },
    };
  };

  beforeEach(() => {
    worklog$ = new BehaviorSubject<Worklog>({});

    const worklogServiceSpy = jasmine.createSpyObj<WorklogService>('WorklogService', [], {
      worklog$: worklog$.asObservable(),
    });
    const workContextServiceSpy = jasmine.createSpyObj<WorkContextService>(
      'WorkContextService',
      [],
      {
        activeWorkContextTitle$: of('Today'),
      },
    );
    const snackServiceSpy = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    const shareServiceSpy = jasmine.createSpyObj<ShareService>('ShareService', [
      'canOpenDownloadResult',
      'openDownloadResult',
      'shareCanvasImage',
    ]);

    TestBed.configureTestingModule({
      imports: [ActivityHeatmapComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: DateAdapter,
          useValue: {
            getFirstDayOfWeek: () => 0,
            getMonthNames: () => LOCALIZED_MONTH_NAMES,
            getDayOfWeekNames: () => LOCALIZED_DAY_NAMES,
            localeChanges: new Subject<void>(),
          },
        },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: ShareService, useValue: shareServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
        { provide: WorklogService, useValue: worklogServiceSpy },
      ],
    }).overrideComponent(ActivityHeatmapComponent, {
      set: {
        imports: [],
        template: '',
      },
    });

    fixture = TestBed.createComponent(ActivityHeatmapComponent);
  });

  it('uses worklog day totals for Today heatmap time', fakeAsync(() => {
    fixture.detectChanges();

    worklog$.next(createWorklogWithParentAndSubtask());
    flush();
    fixture.detectChanges();

    const dayData = fixture.componentInstance
      .heatmapData()
      ?.weeks.flatMap((week) => week.days)
      .find((day) => day?.dateStr === dayStr);

    expect(dayData?.timeSpent).toBe(workedMs);
    expect(dayData?.taskCount).toBe(2);
    expect(fixture.componentInstance.availableYears()).toEqual([year]);
  }));

  it('takes month and weekday abbreviations from the locale-aware date adapter', fakeAsync(() => {
    fixture.detectChanges();

    worklog$.next(createWorklogWithParentAndSubtask());
    flush();
    fixture.detectChanges();

    // A full year always starts in January and spans every month.
    expect(fixture.componentInstance.heatmapData()?.monthLabels).toEqual(
      LOCALIZED_MONTH_NAMES,
    );
    expect(fixture.componentInstance.dayLabels()).toEqual(LOCALIZED_DAY_NAMES);
  }));

  it('uses recalculated selected year for the first worklog emission', fakeAsync(() => {
    const previousYear = year - 1;
    const previousYearDayStr = `${previousYear}-06-03`;

    fixture.detectChanges();

    worklog$.next(createWorklogWithParentAndSubtask(previousYearDayStr));

    const dayData = fixture.componentInstance
      .heatmapData()
      ?.weeks.flatMap((week) => week.days)
      .find((day) => day?.dateStr === previousYearDayStr);

    expect(fixture.componentInstance.selectedYear()).toBe(previousYear);
    expect(dayData?.timeSpent).toBe(workedMs);
    expect(fixture.componentInstance.availableYears()).toEqual([previousYear]);

    flush();
  }));
});
