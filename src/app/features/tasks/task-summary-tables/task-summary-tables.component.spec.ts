import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { TaskSummaryTablesComponent } from './task-summary-tables.component';
import { WorkContextService } from '../../work-context/work-context.service';
import { TaskService } from '../task.service';
import { WorklogService } from '../../worklog/worklog.service';
import { ProjectService } from '../../project/project.service';
import { DateService } from 'src/app/core/date/date.service';

describe('TaskSummaryTablesComponent', () => {
  let component: TaskSummaryTablesComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: WorkContextService, useValue: { activeWorkContextId$: of(null) } },
        { provide: TaskService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: WorklogService, useValue: {} },
        { provide: ProjectService, useValue: { list$: of([]) } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
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
});
