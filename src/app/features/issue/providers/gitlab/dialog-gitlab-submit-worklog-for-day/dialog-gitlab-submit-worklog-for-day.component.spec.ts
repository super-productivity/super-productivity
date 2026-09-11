import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { SnackService } from '../../../../../core/snack/snack.service';
import { DEFAULT_TASK, Task } from '../../../../tasks/task.model';
import { IssueProviderService } from '../../../issue-provider.service';
import { GitlabApiService } from '../gitlab-api/gitlab-api.service';
import { DEFAULT_GITLAB_CFG } from '../gitlab.const';
import { DialogGitlabSubmitWorklogForDayComponent } from './dialog-gitlab-submit-worklog-for-day.component';

const DAY_BEING_FINISHED = '2026-08-05';
const EARLIER_DAY = '2026-08-04';
// The daily summary can finish a past day, so "today" is AFTER the day being
// finished. Before the fix the dialog compared against today, which both
// flagged the finished day's own hours and ignored these.
const LATER_DAY = '2026-08-06';

describe('DialogGitlabSubmitWorklogForDayComponent', () => {
  let environmentInjector: EnvironmentInjector;
  let dialogData: {
    issueProviderId: string;
    tasksForIssueProvider: Task[];
    day: string;
  };

  const createTask = (partial: Partial<Task>): Task => ({
    ...DEFAULT_TASK,
    id: 'gitlab-task',
    title: 'Task',
    issueId: '42',
    issueProviderId: 'gitlab-provider',
    projectId: 'project-1',
    created: Date.now(),
    ...partial,
  });

  /** Builds the component without rendering its template. */
  const createComponent = (
    day: string,
    tasks: Task[],
  ): DialogGitlabSubmitWorklogForDayComponent => {
    dialogData = {
      issueProviderId: 'gitlab-provider',
      tasksForIssueProvider: tasks,
      day,
    };
    return runInInjectionContext(
      environmentInjector,
      () => new DialogGitlabSubmitWorklogForDayComponent(),
    );
  };

  beforeEach(() => {
    const gitlabApiService = jasmine.createSpyObj<GitlabApiService>('GitlabApiService', [
      'getTimeTrackingStats$',
    ]);
    gitlabApiService.getTimeTrackingStats$.and.returnValue(
      of({
        human_time_estimate: null,
        human_total_time_spent: null,
        time_estimate: null,
        total_time_spent: 0,
      }),
    );

    const issueProviderService = jasmine.createSpyObj<IssueProviderService>(
      'IssueProviderService',
      ['getCfgOnce$'],
    );
    issueProviderService.getCfgOnce$.and.returnValue(
      of({
        ...DEFAULT_GITLAB_CFG,
        id: 'gitlab-provider',
        issueProviderKey: 'GITLAB',
        isEnabled: true,
      }),
    );

    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        { provide: MAT_DIALOG_DATA, useFactory: () => dialogData },
        { provide: MatDialogRef, useValue: { close: () => undefined } },
        { provide: GitlabApiService, useValue: gitlabApiService },
        { provide: IssueProviderService, useValue: issueProviderService },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });

    environmentInjector = TestBed.inject(EnvironmentInjector);
  });

  describe('isPastTrackedData', () => {
    it('does not flag the hours booked on the day being finished', () => {
      const component = createComponent(DAY_BEING_FINISHED, [
        createTask({ timeSpentOnDay: { [DAY_BEING_FINISHED]: 60000 } }),
      ]);

      expect(component.tmpTasks$.getValue()[0].isPastTrackedData).toBe(false);
    });

    it('flags unsubmitted hours from an earlier day', () => {
      const component = createComponent(DAY_BEING_FINISHED, [
        createTask({
          timeSpentOnDay: { [EARLIER_DAY]: 30000, [DAY_BEING_FINISHED]: 60000 },
        }),
      ]);

      expect(component.tmpTasks$.getValue()[0].isPastTrackedData).toBe(true);
    });

    it('flags unsubmitted hours tracked after the day being finished', () => {
      const component = createComponent(DAY_BEING_FINISHED, [
        createTask({
          timeSpentOnDay: { [DAY_BEING_FINISHED]: 60000, [LATER_DAY]: 30000 },
        }),
      ]);

      expect(component.tmpTasks$.getValue()[0].isPastTrackedData).toBe(true);
    });

    it('does not flag another day whose hours were already submitted', () => {
      const component = createComponent(DAY_BEING_FINISHED, [
        createTask({
          timeSpentOnDay: { [EARLIER_DAY]: 30000, [DAY_BEING_FINISHED]: 60000 },
          issueTimeTracked: { [EARLIER_DAY]: 30000 },
        }),
      ]);

      expect(component.tmpTasks$.getValue()[0].isPastTrackedData).toBe(false);
    });
  });

  // Submission is deliberately NOT day-scoped: GitLab dates the entry
  // server-side, so the dialog offers everything not yet submitted and uses
  // isPastTrackedData to warn that the prefill spans more than one day.
  it('prefills the total unsubmitted time across every day', () => {
    const component = createComponent(DAY_BEING_FINISHED, [
      createTask({
        timeSpentOnDay: { [EARLIER_DAY]: 30000, [DAY_BEING_FINISHED]: 60000 },
        issueTimeTracked: { [EARLIER_DAY]: 10000 },
      }),
    ]);

    expect(component.tmpTasks$.getValue()[0].timeToSubmit).toBe(80000);
  });
});
