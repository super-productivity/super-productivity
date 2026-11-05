import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { WorklogExportComponent } from './worklog-export.component';
import { WorklogService } from '../worklog.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { WORKLOG_EXPORT_DEFAULTS } from '../../work-context/work-context.const';
import { ProjectService } from '../../project/project.service';
import { DEFAULT_PROJECT } from '../../project/project.const';
import { selectUnarchivedProjects } from '../../project/store/project.selectors';
import { TagService } from '../../tag/tag.service';
import { TimeTrackingService } from '../../time-tracking/time-tracking.service';
import { SnackService } from '../../../core/snack/snack.service';
import { DEFAULT_TASK, WorklogTask } from '../../tasks/task.model';
import { WorklogGrouping } from '../worklog.model';

describe('WorklogExportComponent', () => {
  for (const groupBy of Object.values(WorklogGrouping)) {
    it(`should export archived project titles and tracked time when grouped by ${groupBy}`, async () => {
      const project = {
        ...DEFAULT_PROJECT,
        id: 'completed-project',
        title: 'Completed project',
        isArchived: true,
      };
      const dateStr = '2026-10-01';
      const task: WorklogTask = {
        ...DEFAULT_TASK,
        id: 'tracked-task',
        title: 'Tracked task',
        projectId: project.id,
        timeSpentOnDay: { [dateStr]: 3600000 },
        dateStr: '',
      };
      TestBed.configureTestingModule({
        imports: [WorklogExportComponent],
        providers: [
          provideMockStore({
            initialState: {
              projects: { ids: [project.id], entities: { [project.id]: project } },
            },
          }),
          {
            provide: ProjectService,
            useFactory: (store: MockStore) => ({
              list$: store.select(selectUnarchivedProjects),
            }),
            deps: [MockStore],
          },
          {
            provide: WorklogService,
            useValue: { getTaskListForRange$: () => of([task]) },
          },
          {
            provide: WorkContextService,
            useValue: {
              advancedCfg$: of({
                worklogExportSettings: {
                  ...WORKLOG_EXPORT_DEFAULTS,
                  groupBy,
                  cols: ['PROJECTS', 'TITLES', 'TIME_MS'],
                },
              }),
              activeWorkContext$: of({
                id: 'TODAY',
                type: WorkContextType.TAG,
              }),
            },
          },
          { provide: TagService, useValue: { tags$: of([]) } },
          {
            provide: TimeTrackingService,
            useValue: {
              getLegacyWorkStartEndForWorkContext: async () => ({
                workStart: {},
                workEnd: {},
              }),
            },
          },
          { provide: SnackService, useValue: {} },
        ],
      });
      TestBed.overrideComponent(WorklogExportComponent, {
        set: { template: '', imports: [] },
      });
      const fixture = TestBed.createComponent(WorklogExportComponent);
      fixture.componentRef.setInput('rangeStart', new Date(2026, 9, 1));
      fixture.componentRef.setInput('rangeEnd', new Date(2026, 9, 31));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance.formattedRows).toEqual([
        ['Completed project', 'Tracked task', 3600000],
      ]);
      expect(fixture.componentInstance.txt).toContain('Completed project');
      expect(fixture.componentInstance.txt).toContain('Tracked task');
    });
  }
});
