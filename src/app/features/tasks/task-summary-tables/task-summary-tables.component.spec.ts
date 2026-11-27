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
import { getDbDateStr } from '../../../util/get-db-date-str';

describe('TaskSummaryTablesComponent', () => {
  let component: TaskSummaryTablesComponent;
  let matDialog: jasmine.SpyObj<MatDialog>;

  beforeEach(() => {
    matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    TestBed.configureTestingModule({
      providers: [
        { provide: WorkContextService, useValue: { activeWorkContextId$: of(null) } },
        { provide: TaskService, useValue: {} },
        { provide: MatDialog, useValue: matDialog },
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

  describe('showExportModal', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    const exportedDays = (): string[] => {
      const { rangeStart, rangeEnd } = matDialog.open.calls.mostRecent().args[1]!
        .data as { rangeStart: number; rangeEnd: number };
      return [getDbDateStr(rangeStart), getDbDateStr(rangeEnd)];
    };

    it('should export the summary day after midnight, before the next day starts', () => {
      // with a later start of the next day, the summary still shows Oct 23
      jasmine.clock().mockDate(new Date(2026, 9, 24, 1, 0, 0));
      component.showExportModal('p1');
      expect(exportedDays()).toEqual(['2026-10-23', '2026-10-23']);
    });

    it('should export the summary day during the day', () => {
      jasmine.clock().mockDate(new Date(2026, 9, 23, 12, 0, 0));
      component.showExportModal('p1');
      expect(exportedDays()).toEqual(['2026-10-23', '2026-10-23']);
    });
  });
});
