import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { DateService } from '../../../../core/date/date.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { getDbDateStr } from '../../../../util/get-db-date-str';
import { TaskService } from '../../../tasks/task.service';
import { createTask } from '../../../tasks/task.test-helper';
import { JiraWorklogExportDefaultTime } from '../../providers/jira/jira.model';
import { DialogTrackTimeComponent } from './dialog-track-time.component';
import { TrackTimeDialogData } from './track-time-dialog.model';

describe('DialogTrackTimeComponent', () => {
  const TODAY = '2026-01-15';
  const YESTERDAY = '2026-01-14';
  const TIME_SPENT_TODAY = 30 * 60 * 1000;
  const TIME_SPENT_YESTERDAY = 45 * 60 * 1000;

  let component: DialogTrackTimeComponent;
  let fixture: ComponentFixture<DialogTrackTimeComponent>;
  let dateService: jasmine.SpyObj<DateService>;

  const createDialogData = (): TrackTimeDialogData => ({
    task: createTask({
      id: 'task-1',
      title: 'Task 1',
      issueProviderId: 'jira',
      timeSpent: TIME_SPENT_TODAY + TIME_SPENT_YESTERDAY,
      timeSpentOnDay: {
        [TODAY]: TIME_SPENT_TODAY,
        [YESTERDAY]: TIME_SPENT_YESTERDAY,
      },
      created: new Date(2026, 0, 10, 9, 0).getTime(),
    }),
    issueIcon: 'jira',
    issueLabel: 'SP-1',
    timeLogged: 0,
    configTimeKey: 'worklogDialogDefaultTime',
    onSubmit: () => of(undefined),
    successMsg: 'success',
    successTranslateParams: {},
    t: {
      title: 'title',
      submitFor: 'submitFor',
      submit: 'submit',
      timeSpent: 'timeSpent',
      timeSpentTooltip: 'timeSpentTooltip',
      started: 'started',
      invalidDate: 'invalidDate',
      comment: 'comment',
    },
  });

  beforeEach(async () => {
    dateService = jasmine.createSpyObj<DateService>('DateService', [
      'getLogicalTodayDate',
      'todayStr',
    ]);
    dateService.getLogicalTodayDate.and.returnValue(new Date(2026, 0, 15, 10, 0));
    dateService.todayStr.and.callFake((date?: Date | number) =>
      getDbDateStr(date ?? new Date(2026, 0, 15, 10, 0)),
    );

    await TestBed.configureTestingModule({
      imports: [
        DialogTrackTimeComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useFactory: createDialogData,
        },
        {
          provide: MatDialogRef,
          useValue: jasmine.createSpyObj<MatDialogRef<DialogTrackTimeComponent>>(
            'MatDialogRef',
            ['close'],
          ),
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj<SnackService>('SnackService', ['open']),
        },
        {
          provide: Store,
          useValue: jasmine.createSpyObj<Store>('Store', ['dispatch']),
        },
        {
          provide: TaskService,
          useValue: jasmine.createSpyObj<TaskService>('TaskService', ['getByIdOnce$']),
        },
        {
          provide: DateService,
          useValue: dateService,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogTrackTimeComponent);
    component = fixture.componentInstance;
  });

  it('should calculate the time spent yesterday for default-time options', () => {
    expect(
      component.getTimeToLogForMode(JiraWorklogExportDefaultTime.TimeYesterday),
    ).toBe(TIME_SPENT_YESTERDAY);
  });

  it('should fill the time spent field when selecting time spent yesterday', () => {
    component.fill(JiraWorklogExportDefaultTime.TimeYesterday);

    expect(component.timeSpent).toBe(TIME_SPENT_YESTERDAY);
    expect(component.selectedDefaultTimeMode).toBe(
      JiraWorklogExportDefaultTime.TimeYesterday,
    );
  });
});
