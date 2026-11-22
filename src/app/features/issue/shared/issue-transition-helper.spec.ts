import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Action } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of, Subject } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { T } from '../../../t.const';
import { _resetDevErrorState } from '../../../util/dev-error';
import { setCurrentTask } from '../../tasks/store/task.actions';
import { selectCurrentTaskParentOrCurrent } from '../../tasks/store/task.selectors';
import { DEFAULT_TASK, Task } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { IssueLocalState } from '../issue.model';
import { IssueService } from '../issue.service';
import { JIRA_TYPE } from '../issue.const';
import {
  createDoneIssueTransitionStream$,
  createStartIssueTransitionStream$,
  executeIssueTransition$,
  IssueTransitionAdapter,
  IssueTransitionOption,
  NamedTransition,
} from './issue-transition-helper';

interface MockCfg {
  isEnabled: boolean;
  isTransitionIssuesEnabled: boolean;
  transitionConfig: Partial<
    Record<IssueLocalState, IssueTransitionOption<MockTransition>>
  >;
}

interface MockIssue {
  id: string;
  key: string;
  statusName: string;
}

interface MockTransition extends NamedTransition {
  id: string;
  name: string;
}

describe('issue-transition-helper', () => {
  let actions$: Subject<Action>;
  let store: MockStore;
  let taskService: jasmine.SpyObj<TaskService>;
  let snackService: jasmine.SpyObj<SnackService>;
  let issueService: jasmine.SpyObj<IssueService>;
  let getCfgOnce$: jasmine.Spy;
  let fetchIssue$: jasmine.Spy;
  let transitionIssue$: jasmine.Spy;
  let openTransitionDialog$: jasmine.Spy;
  let cfg: MockCfg;
  let task: Task;

  const targetTransition: MockTransition = { id: 'tr-1', name: 'In Progress' };

  const createAdapter = (): IssueTransitionAdapter<
    MockCfg,
    MockIssue,
    MockTransition
  > => ({
    issueType: JIRA_TYPE,
    providerLabel: 'Jira',
    actions$,
    store$: store,
    taskService,
    snackService,
    issueService,
    getCfgOnce$,
    isTransitionEnabled: (c) => c.isEnabled && c.isTransitionIssuesEnabled,
    getChosenTransition: (c, localState) => c.transitionConfig[localState],
    fetchIssue$,
    isAlreadyInTargetStatus: (issue, transition) => issue.statusName === transition.name,
    transitionIssue$,
    openTransitionDialog$,
    transitionSuccessMsg: T.F.JIRA.S.TRANSITION_SUCCESS,
    getIssueKey: (issue) => issue.key,
  });

  beforeEach(() => {
    actions$ = new Subject<Action>();
    taskService = jasmine.createSpyObj<TaskService>('TaskService', ['getByIdOnce$']);
    snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    issueService = jasmine.createSpyObj<IssueService>('IssueService', [
      'refreshIssueTask',
    ]);
    getCfgOnce$ = jasmine.createSpy('getCfgOnce$');
    fetchIssue$ = jasmine.createSpy('fetchIssue$');
    transitionIssue$ = jasmine.createSpy('transitionIssue$').and.returnValue(of({}));
    openTransitionDialog$ = jasmine
      .createSpy('openTransitionDialog$')
      .and.returnValue(of(undefined));
    issueService.refreshIssueTask.and.returnValue(Promise.resolve());

    task = {
      ...DEFAULT_TASK,
      id: 'task-1',
      projectId: 'project-1',
      issueType: JIRA_TYPE,
      issueId: 'issue-1',
      issueProviderId: 'provider-1',
    };
    cfg = {
      isEnabled: true,
      isTransitionIssuesEnabled: true,
      transitionConfig: {
        [IssueLocalState.IN_PROGRESS]: targetTransition,
        [IssueLocalState.DONE]: targetTransition,
      },
    };

    getCfgOnce$.and.callFake(() => of(cfg));
    taskService.getByIdOnce$.and.returnValue(of(task));
    fetchIssue$.and.returnValue(
      of<MockIssue>({ id: 'issue-1', key: 'SP-1', statusName: 'Open' }),
    );

    TestBed.configureTestingModule({
      providers: [provideMockStore()],
    });
    store = TestBed.inject(MockStore);
    store.overrideSelector(selectCurrentTaskParentOrCurrent, task);
  });

  afterEach(() => {
    if (jasmine.isSpy(window.confirm)) {
      (window.confirm as jasmine.Spy).and.returnValue(true);
    }
  });

  describe('createStartIssueTransitionStream$', () => {
    it('transitions issue to IN_PROGRESS when current task matches provider', fakeAsync(() => {
      const sub = createStartIssueTransitionStream$(createAdapter()).subscribe();

      actions$.next(setCurrentTask({ id: 'task-1' }));
      tick();

      expect(getCfgOnce$).toHaveBeenCalledWith('provider-1');
      expect(fetchIssue$).toHaveBeenCalledWith('issue-1', cfg);
      expect(transitionIssue$).toHaveBeenCalledWith(
        { id: 'issue-1', key: 'SP-1', statusName: 'Open' },
        targetTransition,
        cfg,
      );
      expect(snackService.open).toHaveBeenCalledWith({
        type: 'SUCCESS',
        msg: T.F.JIRA.S.TRANSITION_SUCCESS,
        translateParams: {
          issueKey: 'SP-1',
          chosenTransition: 'In Progress',
        },
      });
      expect(issueService.refreshIssueTask).toHaveBeenCalledWith(task, false, false);
      sub.unsubscribe();
    }));

    it('ignores null task id, other issue types, and disabled transitions', fakeAsync(() => {
      const sub = createStartIssueTransitionStream$(createAdapter()).subscribe();

      actions$.next(setCurrentTask({ id: null }));
      tick();
      expect(getCfgOnce$).not.toHaveBeenCalled();

      store.overrideSelector(selectCurrentTaskParentOrCurrent, {
        ...task,
        issueType: 'CALDAV',
      });
      store.refreshState();
      actions$.next(setCurrentTask({ id: 'task-1' }));
      tick();
      expect(getCfgOnce$).not.toHaveBeenCalled();

      store.overrideSelector(selectCurrentTaskParentOrCurrent, task);
      store.refreshState();
      cfg = { ...cfg, isTransitionIssuesEnabled: false };
      actions$.next(setCurrentTask({ id: 'task-1' }));
      tick();
      expect(fetchIssue$).not.toHaveBeenCalled();
      sub.unsubscribe();
    }));

    it('reports devError and skips without crashing when issueProviderId is missing', fakeAsync(() => {
      _resetDevErrorState();
      (window.confirm as jasmine.Spy).and.returnValue(false);
      store.overrideSelector(selectCurrentTaskParentOrCurrent, {
        ...task,
        issueProviderId: undefined,
      });
      store.refreshState();

      const sub = createStartIssueTransitionStream$(createAdapter()).subscribe();
      actions$.next(setCurrentTask({ id: 'task-1' }));
      tick();

      expect(window.alert).toHaveBeenCalled();
      expect(getCfgOnce$).not.toHaveBeenCalled();

      store.overrideSelector(selectCurrentTaskParentOrCurrent, task);
      store.refreshState();
      actions$.next(setCurrentTask({ id: 'task-1' }));
      tick();
      expect(transitionIssue$).toHaveBeenCalledTimes(1);
      sub.unsubscribe();
    }));
  });

  describe('createDoneIssueTransitionStream$', () => {
    it('transitions on isDone update and skips wont-do tasks and missing ids', fakeAsync(() => {
      const sub = createDoneIssueTransitionStream$(createAdapter()).subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: false } },
        }),
      );
      tick();
      expect(taskService.getByIdOnce$).not.toHaveBeenCalled();

      taskService.getByIdOnce$.and.returnValue(
        of({ ...task, isDone: true, doneOn: 123, wontDoOn: 123 }),
      );
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );
      tick();
      expect(getCfgOnce$).not.toHaveBeenCalled();

      taskService.getByIdOnce$.and.returnValue(of(task));
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );
      tick();
      expect(transitionIssue$).toHaveBeenCalledTimes(1);
      sub.unsubscribe();
    }));
  });

  describe('executeIssueTransition$', () => {
    it('skips when transition is DO_NOT', fakeAsync(() => {
      cfg = { ...cfg, transitionConfig: { [IssueLocalState.DONE]: 'DO_NOT' } };

      executeIssueTransition$(
        createAdapter(),
        IssueLocalState.DONE,
        cfg,
        task,
      ).subscribe();
      tick();

      expect(fetchIssue$).not.toHaveBeenCalled();
      expect(transitionIssue$).not.toHaveBeenCalled();
    }));

    it('opens transition dialog immediately when transition is ALWAYS_ASK', fakeAsync(() => {
      cfg = { ...cfg, transitionConfig: { [IssueLocalState.DONE]: 'ALWAYS_ASK' } };

      executeIssueTransition$(
        createAdapter(),
        IssueLocalState.DONE,
        cfg,
        task,
      ).subscribe();
      tick();

      expect(fetchIssue$).toHaveBeenCalledWith('issue-1', cfg);
      expect(openTransitionDialog$).toHaveBeenCalledWith(
        { id: 'issue-1', key: 'SP-1', statusName: 'Open' },
        IssueLocalState.DONE,
        task,
      );
      expect(transitionIssue$).not.toHaveBeenCalled();
    }));

    it('shows error snack and opens fallback dialog after 2000ms when transition is invalid', fakeAsync(() => {
      cfg = { ...cfg, transitionConfig: { [IssueLocalState.DONE]: undefined } };

      const sub = executeIssueTransition$(
        createAdapter(),
        IssueLocalState.DONE,
        cfg,
        task,
      ).subscribe();

      expect(snackService.open).toHaveBeenCalledWith({
        msg: T.F.JIRA.S.NO_VALID_TRANSITION,
        type: 'ERROR',
      });
      tick(1999);
      expect(fetchIssue$).not.toHaveBeenCalled();
      tick(1);
      expect(fetchIssue$).toHaveBeenCalledWith('issue-1', cfg);
      expect(openTransitionDialog$).toHaveBeenCalledWith(
        { id: 'issue-1', key: 'SP-1', statusName: 'Open' },
        IssueLocalState.DONE,
        task,
      );
      sub.unsubscribe();
    }));

    it('acts as a no-op when issue is already in target status', fakeAsync(() => {
      fetchIssue$.and.returnValue(
        of<MockIssue>({ id: 'issue-1', key: 'SP-1', statusName: 'In Progress' }),
      );

      executeIssueTransition$(
        createAdapter(),
        IssueLocalState.DONE,
        cfg,
        task,
      ).subscribe();
      tick();

      expect(transitionIssue$).not.toHaveBeenCalled();
      expect(snackService.open).not.toHaveBeenCalled();
      expect(issueService.refreshIssueTask).not.toHaveBeenCalled();
    }));

    it('throws when task.issueId is missing', () => {
      expect(() =>
        executeIssueTransition$(createAdapter(), IssueLocalState.DONE, cfg, {
          ...task,
          issueId: undefined,
        }),
      ).toThrowError('No issueId for task');
    });
  });
});
