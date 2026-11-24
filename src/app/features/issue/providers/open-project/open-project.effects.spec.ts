import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of, Subject } from 'rxjs';
import { SnackService } from '../../../../core/snack/snack.service';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { T } from '../../../../t.const';
import { LOCAL_ACTIONS } from '../../../../util/local-actions.token';
import { setCurrentTask } from '../../../tasks/store/task.actions';
import { selectCurrentTaskParentOrCurrent } from '../../../tasks/store/task.selectors';
import { DEFAULT_TASK, Task } from '../../../tasks/task.model';
import { TaskService } from '../../../tasks/task.service';
import { IssueLocalState, IssueProviderOpenProject } from '../../issue.model';
import { IssueProviderService } from '../../issue-provider.service';
import { IssueService } from '../../issue.service';
import { OPEN_PROJECT_TYPE } from '../../issue.const';
import { OpenProjectOriginalStatus } from './open-project-api-responses';
import { OpenProjectApiService } from './open-project-api.service';
import { OpenProjectWorkPackage } from './open-project-issue.model';
import { DEFAULT_OPEN_PROJECT_CFG } from './open-project.const';
import { OpenProjectEffects } from './open-project.effects';

describe('OpenProjectEffects', () => {
  let actions$: Subject<Action>;
  let store: MockStore;
  let openProjectApiService: jasmine.SpyObj<OpenProjectApiService>;
  let issueProviderService: jasmine.SpyObj<IssueProviderService>;
  let issueService: jasmine.SpyObj<IssueService>;
  let snackService: jasmine.SpyObj<SnackService>;
  let taskService: jasmine.SpyObj<TaskService>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let openProjectCfg: IssueProviderOpenProject;
  let task: Task;

  const createStatus = (id: number, name: string): OpenProjectOriginalStatus => ({
    _type: 'Status',
    id,
    name,
    isClosed: name === 'Closed',
    color: '#000',
    isDefault: id === 1,
    isReadonly: false,
    position: id,
    _links: { self: { href: `/api/v3/statuses/${id}` } },
  });

  const createWorkPackage = (status: OpenProjectOriginalStatus): OpenProjectWorkPackage =>
    ({
      id: 42,
      subject: 'Fix transition',
      lockVersion: 3,
      percentageDone: 20,
      url: 'https://openproject.example.com/work_packages/42',
      _embedded: { status },
    }) as unknown as OpenProjectWorkPackage;

  beforeEach(() => {
    actions$ = new Subject<Action>();
    openProjectApiService = jasmine.createSpyObj<OpenProjectApiService>(
      'OpenProjectApiService',
      ['getById$', 'transitionIssue$'],
    );
    issueProviderService = jasmine.createSpyObj<IssueProviderService>(
      'IssueProviderService',
      ['getCfgOnce$'],
    );
    issueService = jasmine.createSpyObj<IssueService>('IssueService', [
      'refreshIssueTask',
    ]);
    snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    taskService = jasmine.createSpyObj<TaskService>('TaskService', ['getByIdOnce$']);
    matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);

    task = {
      ...DEFAULT_TASK,
      id: 'task-1',
      projectId: 'project-1',
      issueType: OPEN_PROJECT_TYPE,
      issueId: '42',
      issueProviderId: 'op-provider-1',
    };
    openProjectCfg = {
      ...DEFAULT_OPEN_PROJECT_CFG,
      id: 'op-provider-1',
      issueProviderKey: 'OPEN_PROJECT',
      isEnabled: true,
      host: 'https://openproject.example.com',
      projectId: 'proj',
      token: 'test-token',
      isTransitionIssuesEnabled: true,
      progressOnDone: 100,
    };

    taskService.getByIdOnce$.and.returnValue(of(task));
    issueProviderService.getCfgOnce$.and.callFake((() =>
      of(openProjectCfg)) as unknown as IssueProviderService['getCfgOnce$']);
    openProjectApiService.transitionIssue$.and.returnValue(of({}));
    issueService.refreshIssueTask.and.returnValue(Promise.resolve());
    matDialog.open.and.returnValue({
      afterClosed: () => of(undefined),
    } as ReturnType<MatDialog['open']>);

    TestBed.configureTestingModule({
      providers: [
        OpenProjectEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: OpenProjectApiService, useValue: openProjectApiService },
        { provide: IssueProviderService, useValue: issueProviderService },
        { provide: IssueService, useValue: issueService },
        { provide: SnackService, useValue: snackService },
        { provide: TaskService, useValue: taskService },
        { provide: MatDialog, useValue: matDialog },
        { provide: LOCAL_ACTIONS, useValue: actions$ },
      ],
    });
    store = TestBed.inject(MockStore);
    store.overrideSelector(selectCurrentTaskParentOrCurrent, task);
  });

  it('transitions on task start with configured progressOnDone and refreshes task', fakeAsync(() => {
    const targetStatus = createStatus(7, 'In progress');
    const wp = createWorkPackage(createStatus(1, 'New'));
    openProjectCfg = {
      ...openProjectCfg,
      progressOnDone: 80,
      transitionConfig: {
        ...openProjectCfg.transitionConfig!,
        [IssueLocalState.IN_PROGRESS]: targetStatus,
      },
    };
    openProjectApiService.getById$.and.returnValue(of(wp));

    const sub = TestBed.inject(OpenProjectEffects).checkForStartTransition$.subscribe();
    actions$.next(setCurrentTask({ id: 'task-1' }));
    tick();

    expect(openProjectApiService.getById$).toHaveBeenCalledWith(
      '42' as unknown as number,
      openProjectCfg,
    );
    expect(openProjectApiService.transitionIssue$).toHaveBeenCalledWith(
      { ...wp, percentageDone: 80 },
      targetStatus,
      openProjectCfg,
    );
    expect(snackService.open).toHaveBeenCalledWith({
      type: 'SUCCESS',
      msg: T.F.OPEN_PROJECT.S.TRANSITION_SUCCESS,
      translateParams: {
        issueKey: 'Fix transition',
        chosenTransition: 'In progress',
      },
    });
    expect(issueService.refreshIssueTask).toHaveBeenCalledWith(task, false, false);
    sub.unsubscribe();
  }));

  it('skips transition on done when work package is already in target status', fakeAsync(() => {
    const targetStatus = createStatus(12, 'Closed');
    const wp = createWorkPackage(targetStatus);
    openProjectCfg = {
      ...openProjectCfg,
      transitionConfig: {
        ...openProjectCfg.transitionConfig!,
        [IssueLocalState.DONE]: targetStatus,
      },
    };
    openProjectApiService.getById$.and.returnValue(of(wp));

    const sub = TestBed.inject(OpenProjectEffects).checkForDoneTransition$.subscribe();
    actions$.next(
      TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { isDone: true } },
      }),
    );
    tick();

    expect(openProjectApiService.getById$).toHaveBeenCalledWith(
      '42' as unknown as number,
      openProjectCfg,
    );
    expect(openProjectApiService.transitionIssue$).not.toHaveBeenCalled();
    expect(snackService.open).not.toHaveBeenCalled();
    expect(issueService.refreshIssueTask).not.toHaveBeenCalled();
    sub.unsubscribe();
  }));

  it('opens transition dialog when configured as ALWAYS_ASK', async () => {
    const wp = createWorkPackage(createStatus(1, 'New'));
    openProjectCfg = {
      ...openProjectCfg,
      transitionConfig: {
        ...openProjectCfg.transitionConfig!,
        [IssueLocalState.DONE]: 'ALWAYS_ASK',
      },
    };
    openProjectApiService.getById$.and.returnValue(of(wp));

    const dialogOpened = new Promise<void>((resolve) => {
      matDialog.open.and.callFake(() => {
        resolve();
        return { afterClosed: () => of(undefined) } as ReturnType<MatDialog['open']>;
      });
    });

    const sub = TestBed.inject(OpenProjectEffects).checkForDoneTransition$.subscribe();
    actions$.next(
      TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { isDone: true } },
      }),
    );

    await dialogOpened;
    expect(matDialog.open).toHaveBeenCalled();
    expect(openProjectApiService.getById$).toHaveBeenCalledWith(
      '42' as unknown as number,
      openProjectCfg,
    );
    expect(openProjectApiService.transitionIssue$).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('shows error snack and fetches issue after 2000ms for invalid transition fallback', fakeAsync(() => {
    const wp = createWorkPackage(createStatus(1, 'New'));
    openProjectCfg = {
      ...openProjectCfg,
      transitionConfig: undefined,
    };
    openProjectApiService.getById$.and.returnValue(of(wp));

    const sub = TestBed.inject(OpenProjectEffects).checkForDoneTransition$.subscribe();
    actions$.next(
      TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { isDone: true } },
      }),
    );

    expect(snackService.open).toHaveBeenCalledWith({
      msg: T.F.JIRA.S.NO_VALID_TRANSITION,
      type: 'ERROR',
    });
    expect(openProjectApiService.getById$).not.toHaveBeenCalled();
    tick(2000);
    expect(openProjectApiService.getById$).toHaveBeenCalledWith(
      '42' as unknown as number,
      openProjectCfg,
    );
    sub.unsubscribe();
  }));
});
