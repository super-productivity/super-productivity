import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { WorklogExportComponent } from './worklog-export.component';
import { WorklogService } from '../worklog.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { TagService } from '../../tag/tag.service';
import { TimeTrackingService } from '../../time-tracking/time-tracking.service';
import { SnackService } from '../../../core/snack/snack.service';
import { selectAllProjects } from '../../project/store/project.selectors';
import { DEFAULT_PROJECT } from '../../project/project.const';
import { Project } from '../../project/project.model';
import { DEFAULT_TASK, WorklogTask } from '../../tasks/task.model';
import { WorklogGrouping } from '../worklog.model';

describe('WorklogExportComponent', () => {
  const day = '2026-09-15';
  // #11351: "Complete project" archives the project; its tasks move to the
  // task archive but still show up in the Today history range.
  const archivedProject: Project = {
    ...DEFAULT_PROJECT,
    id: 'archived-project',
    title: 'Client Work',
    isArchived: true,
  };
  const archivedTask: WorklogTask = {
    ...DEFAULT_TASK,
    id: 'archived-task',
    title: 'Write report',
    projectId: archivedProject.id,
    isDone: true,
    timeSpentOnDay: { [day]: 3600000 },
    timeSpent: 3600000,
    dateStr: day,
  };

  it('should export tasks of archived projects (#11351)', async () => {
    TestBed.configureTestingModule({
      imports: [WorklogExportComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        provideMockStore({
          selectors: [{ selector: selectAllProjects, value: [archivedProject] }],
        }),
        {
          provide: WorklogService,
          useValue: { getTaskListForRange$: () => of([archivedTask]) },
        },
        {
          provide: WorkContextService,
          useValue: {
            advancedCfg$: of({
              worklogExportSettings: {
                cols: ['DATE', 'PROJECTS', 'TITLES_INCLUDING_SUB'],
                roundWorkTimeTo: null,
                roundStartTimeTo: null,
                roundEndTimeTo: null,
                separateTasksBy: ' | ',
                groupBy: WorklogGrouping.DATE,
              },
            }),
            activeWorkContext$: of({ id: 'TODAY' }),
            updateWorklogExportSettingsForCurrentContext: () => undefined,
          },
        },
        { provide: TagService, useValue: { tags$: of([]) } },
        {
          provide: TimeTrackingService,
          useValue: {
            getLegacyWorkStartEndForWorkContext: () =>
              Promise.resolve({ workStart: {}, workEnd: {} }),
          },
        },
        { provide: SnackService, useValue: { open: () => undefined } },
      ],
    });

    const fixture = TestBed.createComponent(WorklogExportComponent);
    fixture.componentRef.setInput('rangeStart', new Date(2026, 8, 1));
    fixture.componentRef.setInput('rangeEnd', new Date(2026, 9, 31));
    fixture.componentInstance.ngOnInit();

    // work start/end comes from a promise
    await new Promise((resolve) => setTimeout(resolve));

    expect(fixture.componentInstance.txt).toBe(
      'Date;Projects;Titles\n2026-09-15;Client Work;Write report',
    );
  });
});
