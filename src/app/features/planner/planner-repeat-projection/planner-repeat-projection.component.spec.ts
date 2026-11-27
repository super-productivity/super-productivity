import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { PlannerRepeatProjectionComponent } from './planner-repeat-projection.component';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../../task-repeat-cfg/task-repeat-cfg.model';
import { TagListComponent } from '../../tag/tag-list/tag-list.component';
import { T } from '../../../t.const';
import { DateService } from '../../../core/date/date.service';

describe('PlannerRepeatProjectionComponent', () => {
  let fixture: ComponentFixture<PlannerRepeatProjectionComponent>;

  const getTitle = (
    repeatCfg: Partial<TaskRepeatCfg>,
    dayDate = '2026-07-16',
  ): string => {
    fixture.componentRef.setInput('dayDate', dayDate);
    fixture.componentRef.setInput('repeatCfg', {
      ...DEFAULT_TASK_REPEAT_CFG,
      id: 'rc1',
      title: 'Water plants',
      ...repeatCfg,
    });
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('div').title;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlannerRepeatProjectionComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
        { provide: DateService, useValue: { todayStr: () => '2026-07-15' } },
      ],
    })
      // The chip list needs the whole store; the hover text does not.
      .overrideComponent(PlannerRepeatProjectionComponent, {
        remove: { imports: [TagListComponent] },
        add: { schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(PlannerRepeatProjectionComponent);
  });

  // No translations are loaded, so instant() returns the key.
  it('says on hover that a preview cannot be moved and how to move one day', () => {
    expect(getTitle({})).toBe(
      `${T.F.PLANNER.EDIT_REPEATED_TASK}  ${T.F.TASK_REPEAT.PREVIEW_HINT}`,
    );
  });

  it('leaves the hint out for a series repeating from its completion date', () => {
    expect(getTitle({ repeatFromCompletionDate: true })).toBe(
      T.F.PLANNER.EDIT_REPEATED_TASK,
    );
  });

  it('leaves the hint out for today, which cannot become a separate task', () => {
    expect(getTitle({}, '2026-07-15')).toBe(T.F.PLANNER.EDIT_REPEATED_TASK);
  });
});
