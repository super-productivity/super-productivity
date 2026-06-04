import { ComponentFixture, TestBed, fakeAsync, flush } from '@angular/core/testing';
import { DateAdapter } from '@angular/material/core';
import { BehaviorSubject, of } from 'rxjs';

import { SnackService } from '../../../core/snack/snack.service';
import { ShareService } from '../../../core/share/share.service';
import { Task } from '../../tasks/task.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { Worklog, WorklogDataForDay } from '../../worklog/worklog.model';
import { WorklogService } from '../../worklog/worklog.service';
import { ActivityHeatmapComponent } from './activity-heatmap.component';

describe('ActivityHeatmapComponent', () => {
  let fixture: ComponentFixture<ActivityHeatmapComponent>;
  let worklog$: BehaviorSubject<Worklog>;

  const dayStr = '2026-06-03';
  const year = 2026;
  const month = 6;
  const dayOfMonth = 3;
  const workedMs = 60 * 60 * 1000;

  const createTask = (id: string, overrides: Partial<Task> = {}): Task => ({
    attachments: [],
    created: new Date(dayStr).getTime(),
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

  const createWorklogWithParentAndSubtask = (): Worklog => {
    const parentTask = createTask('parent', {
      subTaskIds: ['subtask'],
      timeSpent: workedMs,
      timeSpentOnDay: { [dayStr]: workedMs },
    });
    const subTask = createTask('subtask', {
      parentId: parentTask.id,
      timeSpent: workedMs,
      timeSpentOnDay: { [dayStr]: workedMs },
    });

    return {
      [year]: {
        daysWorked: 1,
        monthWorked: 1,
        timeSpent: workedMs,
        ent: {
          [month]: {
            daysWorked: 1,
            ent: {
              [dayOfMonth]: {
                dateStr: dayStr,
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
      imports: [ActivityHeatmapComponent],
      providers: [
        { provide: DateAdapter, useValue: { getFirstDayOfWeek: () => 0 } },
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
});
