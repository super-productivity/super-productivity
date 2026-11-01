import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { TaskSummaryTablesComponent } from './task-summary-tables.component';
import { WorkContextService } from '../../work-context/work-context.service';
import { TaskService } from '../task.service';
import { WorklogService } from '../../worklog/worklog.service';
import { ProjectService } from '../../project/project.service';
import { DateService } from 'src/app/core/date/date.service';
import { DEFAULT_TASK, Task } from '../task.model';

describe('TaskSummaryTablesComponent', () => {
  let component: TaskSummaryTablesComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        { provide: WorkContextService, useValue: { activeWorkContextId$: of(null) } },
        { provide: TaskService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: WorklogService, useValue: {} },
        { provide: ProjectService, useValue: { list$: of([]) } },
        { provide: DateService, useValue: { todayStr: () => '2026-10-23' } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new TaskSummaryTablesComponent());
  });

  it('should start with all projects expanded', () => {
    expect(component.collapsedProjectIds()).toEqual([]);
  });

  it('should collapse and re-expand a project', () => {
    component.toggleProjectExpanded('p1');
    expect(component.collapsedProjectIds()).toEqual(['p1']);

    component.toggleProjectExpanded('p1');
    expect(component.collapsedProjectIds()).toEqual([]);
  });

  it('should track the "without project" group by its null id', () => {
    component.toggleProjectExpanded('p1');
    component.toggleProjectExpanded(null);
    expect(component.collapsedProjectIds()).toEqual(['p1', null]);

    component.toggleProjectExpanded('p1');
    expect(component.collapsedProjectIds()).toEqual([null]);
  });

  it('counts yesterday relative to the summary day, not the calendar day', () => {
    // 02:00 on Oct 24 with a start-of-day offset: the logical today (dayStr) is
    // still Oct 23 while the calendar yesterday is also Oct 23 — deriving
    // yesterday from the calendar date would double-count today's time.
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 9, 24, 2, 0, 0));
    try {
      const fixture = TestBed.createComponent(TaskSummaryTablesComponent);
      const cmp = fixture.componentInstance;
      fixture.componentRef.setInput('isShowYesterday', true);
      fixture.componentRef.setInput('flatTasks', [
        {
          ...DEFAULT_TASK,
          id: 't1',
          projectId: '',
          timeSpentOnDay: { ['2026-10-23']: 60000, ['2026-10-22']: 30000 },
        } as Task,
      ]);

      const withoutProject = cmp.projects().find((p) => p.id === null)!;
      expect(withoutProject.timeSpentToday).toBe(60000);
      expect(withoutProject.timeSpentYesterday).toBe(30000);
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
