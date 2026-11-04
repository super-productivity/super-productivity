import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { BeforeFinishDayAction } from '../../../before-finish-day/before-finish-day.model';
import { BeforeFinishDayService } from '../../../before-finish-day/before-finish-day.service';
import { DEFAULT_TASK, Task } from '../../../tasks/task.model';
import { selectAllTasksInActiveProjects } from '../../../tasks/store/task.selectors';
import { IssueProviderService } from '../../issue-provider.service';
import { GITLAB_TYPE } from '../../issue.const';
import { DEFAULT_GITLAB_CFG } from './gitlab.const';
import { GitlabIssueEffects } from './gitlab-issue.effects';

const DAY = '2026-08-06';
const PREVIOUS_DAY = '2026-08-05';

describe('GitlabIssueEffects', () => {
  let store: MockStore;
  let beforeFinishDayAction: BeforeFinishDayAction;
  let matDialog: jasmine.SpyObj<MatDialog>;

  const createTask = (id: string, partial: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    title: `Task ${id}`,
    projectId: 'project-1',
    created: Date.now(),
    ...partial,
  });

  beforeEach(() => {
    matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    matDialog.open.and.returnValue({
      afterClosed: () => of(undefined),
    } as ReturnType<MatDialog['open']>);

    const beforeFinishDayService = jasmine.createSpyObj<BeforeFinishDayService>(
      'BeforeFinishDayService',
      ['addAction'],
    );
    beforeFinishDayService.addAction.and.callFake((action) => {
      beforeFinishDayAction = action;
    });

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
        isEnableTimeTracking: true,
      }),
    );

    TestBed.configureTestingModule({
      providers: [
        GitlabIssueEffects,
        provideMockStore({
          selectors: [{ selector: selectAllTasksInActiveProjects, value: [] }],
        }),
        { provide: MatDialog, useValue: matDialog },
        { provide: BeforeFinishDayService, useValue: beforeFinishDayService },
        { provide: IssueProviderService, useValue: issueProviderService },
      ],
    });

    store = TestBed.inject(MockStore);
    TestBed.inject(GitlabIssueEffects);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  it('includes GitLab tasks outside the active context when finishing the day', async () => {
    const gitlabTask = createTask('gitlab-task', {
      issueType: GITLAB_TYPE,
      issueId: '42',
      issueProviderId: 'gitlab-provider',
      timeSpentOnDay: { [DAY]: 60000 },
    });
    store.overrideSelector(selectAllTasksInActiveProjects, [gitlabTask]);
    store.refreshState();

    await beforeFinishDayAction(DAY);

    expect(matDialog.open).toHaveBeenCalledWith(
      jasmine.any(Function),
      jasmine.objectContaining({
        data: jasmine.objectContaining({
          issueProviderId: 'gitlab-provider',
          tasksForIssueProvider: [gitlabTask],
        }),
      }),
    );
  });

  it('excludes GitLab tasks without time tracked on the day being finished', async () => {
    const oldGitlabTask = createTask('old-gitlab-task', {
      issueType: GITLAB_TYPE,
      issueId: '43',
      issueProviderId: 'gitlab-provider',
      timeSpentOnDay: { [PREVIOUS_DAY]: 60000 },
    });
    store.overrideSelector(selectAllTasksInActiveProjects, [oldGitlabTask]);
    store.refreshState();

    await beforeFinishDayAction(DAY);

    expect(matDialog.open).not.toHaveBeenCalled();
  });

  // The daily summary has a Finish Day button for past days too, so the worklog
  // must report the hours booked on the day being finished — not on today.
  it('reports the past day being finished, not today', async () => {
    const yesterdaysTask = createTask('yesterdays-gitlab-task', {
      issueType: GITLAB_TYPE,
      issueId: '44',
      issueProviderId: 'gitlab-provider',
      timeSpentOnDay: { [PREVIOUS_DAY]: 60000 },
    });
    store.overrideSelector(selectAllTasksInActiveProjects, [yesterdaysTask]);
    store.refreshState();

    await beforeFinishDayAction(PREVIOUS_DAY);

    expect(matDialog.open).toHaveBeenCalledWith(
      jasmine.any(Function),
      jasmine.objectContaining({
        data: jasmine.objectContaining({
          tasksForIssueProvider: [yesterdaysTask],
          // the dialog flags "past" tracked data relative to this
          day: PREVIOUS_DAY,
        }),
      }),
    );
  });
});
