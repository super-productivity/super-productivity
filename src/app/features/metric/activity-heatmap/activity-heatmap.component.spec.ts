import { TestBed } from '@angular/core/testing';
import { DateAdapter } from '@angular/material/core';
import { NEVER, of } from 'rxjs';
import { ActivityHeatmapComponent } from './activity-heatmap.component';
import { WorklogService } from '../../worklog/worklog.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { TaskService } from '../../tasks/task.service';
import { TaskArchiveService } from '../../archive/task-archive.service';
import { SnackService } from '../../../core/snack/snack.service';
import { ShareService } from '../../../core/share/share.service';
import { createTask } from '../../tasks/task.test-helper';
import { Task } from '../../tasks/task.model';

interface ActivityHeatmapTestApi {
  _buildHeatmapDataForGivenYear: (
    tasks: Task[],
    year: number,
  ) => { dayMap: Map<string, { timeSpent: number; taskCount: number }> };
}

describe('ActivityHeatmapComponent', () => {
  const DAY = '2026-06-03';

  const setup = (): ActivityHeatmapComponent => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: WorklogService,
          useValue: { worklog$: NEVER },
        },
        {
          provide: WorkContextService,
          useValue: {
            activeWorkContext$: NEVER,
            activeWorkContextTitle$: of('Today'),
          },
        },
        {
          provide: TaskService,
          useValue: { allTasks$: of([]) },
        },
        {
          provide: TaskArchiveService,
          useValue: { load: () => Promise.resolve(null) },
        },
        {
          provide: SnackService,
          useValue: { open: jasmine.createSpy('open') },
        },
        {
          provide: ShareService,
          useValue: {
            shareCanvasImage: jasmine.createSpy('shareCanvasImage'),
            canOpenDownloadResult: jasmine
              .createSpy('canOpenDownloadResult')
              .and.returnValue(false),
          },
        },
        {
          provide: DateAdapter,
          useValue: { getFirstDayOfWeek: () => 1 },
        },
      ],
    });

    return TestBed.runInInjectionContext(() => new ActivityHeatmapComponent());
  };

  it('does not double-count parent task time when subTaskIds are incomplete', () => {
    const component = setup();
    const result = (
      component as unknown as ActivityHeatmapTestApi
    )._buildHeatmapDataForGivenYear(
      [
        createTask({
          id: 'parent',
          subTaskIds: [],
          timeSpentOnDay: { [DAY]: 60 * 60 * 1000 },
        }),
        createTask({
          id: 'sub-1',
          parentId: 'parent',
          timeSpentOnDay: { [DAY]: 60 * 60 * 1000 },
        }),
      ],
      2026,
    );
    const dayData = result.dayMap.get(DAY);

    expect(dayData).toBeDefined();
    expect(dayData!.timeSpent).toBe(60 * 60 * 1000);
    expect(dayData!.taskCount).toBe(1);
  });
});
