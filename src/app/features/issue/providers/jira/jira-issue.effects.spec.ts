import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { of, Subject } from 'rxjs';
import { SnackService } from '../../../../core/snack/snack.service';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { LOCAL_ACTIONS } from '../../../../util/local-actions.token';
import { IssueLocalState, IssueProviderJira } from '../../issue.model';
import { IssueProviderService } from '../../issue-provider.service';
import { IssueService } from '../../issue.service';
import { JIRA_TYPE } from '../../issue.const';
import { JiraOriginalStatus, JiraOriginalTransition } from './jira-api-responses';
import { JiraApiService } from './jira-api.service';
import { DEFAULT_JIRA_CFG } from './jira.const';
import { JiraIssueEffects } from './jira-issue.effects';
import { JiraIssueReduced } from './jira-issue.model';
import { DEFAULT_TASK, Task } from '../../../tasks/task.model';
import { TaskService } from '../../../tasks/task.service';

describe('JiraIssueEffects', () => {
  let actions$: Subject<Action>;
  let jiraApiService: jasmine.SpyObj<JiraApiService>;
  let issueProviderService: jasmine.SpyObj<IssueProviderService>;
  let issueService: jasmine.SpyObj<IssueService>;
  let snackService: jasmine.SpyObj<SnackService>;
  let taskService: jasmine.SpyObj<TaskService>;
  let jiraCfg: IssueProviderJira;
  let task: Task;

  const createStatus = (id: string, name: string): JiraOriginalStatus => ({
    self: `https://jira.example.com/status/${id}`,
    id,
    name,
    description: '',
    iconUrl: '',
    statusCategory: {
      self: `https://jira.example.com/statuscategory/${id}`,
      id,
      key: name.toLowerCase().replace(/\s+/g, '-'),
      colorName: 'blue-gray',
      name,
    },
  });

  const createTransition = (
    id: string,
    name: string,
    targetStatus: JiraOriginalStatus,
  ): JiraOriginalTransition => ({
    id,
    name,
    to: {
      ...targetStatus,
      statusCategory: {
        ...targetStatus.statusCategory,
        id: Number(targetStatus.id),
      },
    },
    hasScreen: false,
    isGlobal: false,
    isInitial: false,
    isConditional: false,
    fields: {},
  });

  const createIssue = (status: JiraOriginalStatus): JiraIssueReduced => ({
    key: 'SP-1',
    id: 'issue-1',
    summary: 'Jira issue',
    components: [],
    timeestimate: 0,
    timespent: 0,
    description: null,
    updated: '2026-06-08T00:00:00.000+0000',
    status,
    attachments: [],
    assignee: null,
    comments: [],
  });

  const emitDoneUpdate = (): void => {
    actions$.next(
      TaskSharedActions.updateTask({
        task: { id: task.id, changes: { isDone: true } },
      }),
    );
  };

  const setupTransition = (
    transition: JiraOriginalTransition,
    issue: JiraIssueReduced,
  ): void => {
    jiraCfg = {
      ...jiraCfg,
      transitionConfig: {
        ...jiraCfg.transitionConfig,
        [IssueLocalState.DONE]: transition,
      },
    };

    issueProviderService.getCfgOnce$.and.returnValue(of(jiraCfg));
    jiraApiService.getReducedIssueById$.and.returnValue(of(issue));
    jiraApiService.transitionIssue$.and.returnValue(of({}));
    issueService.refreshIssueTask.and.returnValue(Promise.resolve());
  };

  beforeEach(() => {
    actions$ = new Subject<Action>();
    jiraApiService = jasmine.createSpyObj<JiraApiService>('JiraApiService', [
      'getCurrentUser$',
      'getReducedIssueById$',
      'transitionIssue$',
      'updateAssignee$',
    ]);
    issueProviderService = jasmine.createSpyObj<IssueProviderService>(
      'IssueProviderService',
      ['getCfgOnce$'],
    );
    issueService = jasmine.createSpyObj<IssueService>('IssueService', [
      'refreshIssueTask',
    ]);
    snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    taskService = jasmine.createSpyObj<TaskService>('TaskService', ['getByIdOnce$']);

    task = {
      ...DEFAULT_TASK,
      id: 'task-1',
      projectId: 'project-1',
      issueType: JIRA_TYPE,
      issueId: 'issue-1',
      issueProviderId: 'jira-provider-1',
    };
    jiraCfg = {
      ...DEFAULT_JIRA_CFG,
      id: 'jira-provider-1',
      issueProviderKey: 'JIRA',
      isEnabled: true,
      isTransitionIssuesEnabled: true,
    };

    taskService.getByIdOnce$.and.returnValue(of(task));

    TestBed.configureTestingModule({
      providers: [
        JiraIssueEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: JiraApiService, useValue: jiraApiService },
        { provide: IssueProviderService, useValue: issueProviderService },
        { provide: IssueService, useValue: issueService },
        { provide: SnackService, useValue: snackService },
        { provide: TaskService, useValue: taskService },
        {
          provide: MatDialog,
          useValue: jasmine.createSpyObj<MatDialog>('MatDialog', ['open']),
        },
        { provide: LOCAL_ACTIONS, useValue: actions$ },
      ],
    });
  });

  it('does not transition when the issue is already in the transition target status', fakeAsync(() => {
    const targetStatus = createStatus('3', 'Work in Progress');
    const transition = createTransition('11', 'Start progress', targetStatus);
    setupTransition(transition, createIssue(targetStatus));

    TestBed.inject(JiraIssueEffects).checkForDoneTransition$.subscribe();
    emitDoneUpdate();
    tick();

    expect(jiraApiService.getReducedIssueById$).toHaveBeenCalledWith('issue-1', jiraCfg);
    expect(jiraApiService.transitionIssue$).not.toHaveBeenCalled();
    expect(issueService.refreshIssueTask).not.toHaveBeenCalled();
    expect(snackService.open).not.toHaveBeenCalled();
  }));

  it('matches the target status by id when the status name differs', fakeAsync(() => {
    const targetStatus = createStatus('3', 'Done');
    const localizedStatus = createStatus('3', 'Erledigt');
    const transition = createTransition('21', 'Resolve Issue', targetStatus);
    setupTransition(transition, createIssue(localizedStatus));

    TestBed.inject(JiraIssueEffects).checkForDoneTransition$.subscribe();
    emitDoneUpdate();
    tick();

    expect(jiraApiService.transitionIssue$).not.toHaveBeenCalled();
    expect(issueService.refreshIssueTask).not.toHaveBeenCalled();
    expect(snackService.open).not.toHaveBeenCalled();
  }));

  it('transitions and refreshes the task when the issue is not in the target status', fakeAsync(() => {
    const targetStatus = createStatus('3', 'Done');
    const transition = createTransition('21', 'Resolve Issue', targetStatus);
    setupTransition(transition, createIssue(createStatus('1', 'To Do')));

    TestBed.inject(JiraIssueEffects).checkForDoneTransition$.subscribe();
    emitDoneUpdate();
    tick();

    expect(jiraApiService.transitionIssue$).toHaveBeenCalledWith(
      'issue-1',
      '21',
      jiraCfg,
    );
    expect(snackService.open).toHaveBeenCalled();
    expect(issueService.refreshIssueTask).toHaveBeenCalledWith(task, false, false);
  }));
});
