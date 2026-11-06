import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom, of, ReplaySubject } from 'rxjs';
import { Action } from '@ngrx/store';
import type { PluginTimeTracking } from '@super-productivity/plugin-api';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { TaskService } from '../../features/tasks/task.service';
import { createTask } from '../../features/tasks/task.test-helper';
import { Task } from '../../features/tasks/task.model';
import { selectIssueProviderState } from '../../features/issue/store/issue-provider.selectors';
import { IssueProviderActions } from '../../features/issue/store/issue-provider.actions';
import { JiraWorklogExportDefaultTime } from '../../features/issue/providers/jira/jira.model';
import { TrackTimeDialogData } from '../../features/issue/shared/dialog-track-time/track-time-dialog.model';
import { SnackService } from '../../core/snack/snack.service';
import {
  getTimeTrackingDialogTask,
  PluginTimeTrackingEffects,
} from './plugin-time-tracking.effects';
import { PluginIssueProviderRegistryService } from './plugin-issue-provider-registry.service';
import { PluginHttpService } from './plugin-http.service';

describe('getTimeTrackingDialogTask', () => {
  const main = createTask({ id: 'main', subTaskIds: ['sub'] });
  const sub = createTask({ id: 'sub', parentId: 'main' });
  const noSubs = createTask({ id: 'solo' });

  it('returns nothing when the dialog is disabled', () => {
    expect(getTimeTrackingDialogTask(noSubs, undefined, {})).toBeUndefined();
  });

  it('opens for a done main task without per-subtask mode', () => {
    const cfg = { isShowTimeTrackingDialog: true };
    expect(getTimeTrackingDialogTask(main, undefined, cfg)).toBe(main);
    expect(getTimeTrackingDialogTask(main, sub, cfg)).toBeUndefined();
  });

  it('opens per subtask and skips parents that have subtasks', () => {
    const cfg = {
      isShowTimeTrackingDialog: true,
      isShowTimeTrackingDialogForEachSubTask: true,
    };
    expect(getTimeTrackingDialogTask(main, sub, cfg)).toBe(sub);
    expect(getTimeTrackingDialogTask(main, undefined, cfg)).toBeUndefined();
    expect(getTimeTrackingDialogTask(noSubs, undefined, cfg)).toBe(noSubs);
  });
});

describe('PluginTimeTrackingEffects', () => {
  let actions$: ReplaySubject<Action>;
  let store: MockStore;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let timeTracking: jasmine.SpyObj<Required<PluginTimeTracking>>;
  let getById: jasmine.Spy;
  let taskService: jasmine.SpyObj<TaskService>;
  const task: Task = createTask({
    id: 't1',
    issueId: '42',
    issueType: 'REDMINE',
    issueProviderId: 'ip1',
  });
  const pluginConfig = {
    host: 'h',
    isShowTimeTrackingDialog: true,
    timeTrackingDialogDefaultTime: JiraWorklogExportDefaultTime.TimeToday,
  };

  const setProviders = (entities: Record<string, unknown>): void => {
    store.overrideSelector(selectIssueProviderState, {
      ids: Object.keys(entities),
      entities,
    } as never);
    store.refreshState();
  };

  const markDone = async (): Promise<TrackTimeDialogData> => {
    actions$.next(
      TaskSharedActions.updateTask({ task: { id: 't1', changes: { isDone: true } } }),
    );
    // the dialog component is lazy-loaded, so wait for open() a few ticks
    for (let i = 0; i < 50 && !matDialog.open.calls.count(); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    return matDialog.open.calls.mostRecent()?.args[1]?.data as TrackTimeDialogData;
  };

  beforeEach(() => {
    actions$ = new ReplaySubject<Action>(1);
    matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    timeTracking = jasmine.createSpyObj('timeTracking', [
      'logTime',
      'getTimeLogged',
      'getActivities',
    ]);
    timeTracking.logTime.and.resolveTo();
    timeTracking.getTimeLogged.and.resolveTo(1000);
    timeTracking.getActivities.and.resolveTo([{ id: 9, name: 'Dev' }]);
    getById = jasmine.createSpy('getById').and.resolveTo({
      id: '42',
      title: '#42 Issue',
      url: 'https://h/issues/42',
    });
    const registry = jasmine.createSpyObj<PluginIssueProviderRegistryService>(
      'Registry',
      ['getProvider', 'getHumanReadableName'],
    );
    registry.getProvider.and.returnValue({
      pluginId: 'redmine-issue-provider',
      icon: 'redmine',
      allowPrivateNetwork: true,
      definition: { getById, getHeaders: () => ({}), timeTracking },
    } as never);
    registry.getHumanReadableName.and.returnValue('Redmine');
    const pluginHttp = jasmine.createSpyObj<PluginHttpService>('PluginHttp', [
      'createHttpHelper',
    ]);
    pluginHttp.createHttpHelper.and.returnValue({} as never);
    taskService = jasmine.createSpyObj<TaskService>('TaskService', ['getByIdOnce$']);
    taskService.getByIdOnce$.and.returnValue(of(task));

    TestBed.configureTestingModule({
      providers: [
        PluginTimeTrackingEffects,
        provideMockStore(),
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        { provide: MatDialog, useValue: matDialog },
        { provide: TaskService, useValue: taskService },
        { provide: PluginIssueProviderRegistryService, useValue: registry },
        { provide: PluginHttpService, useValue: pluginHttp },
        { provide: SnackService, useValue: jasmine.createSpyObj('Snack', ['open']) },
        {
          provide: TranslateService,
          useValue: { instant: (key: string) => key },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
    TestBed.inject(PluginTimeTrackingEffects).openTrackTimeDialog$.subscribe();
  });

  afterEach(() => store.resetSelectors());

  it('opens the dialog with the issue and the configured default time', async () => {
    setProviders({
      ip1: { id: 'ip1', issueProviderKey: 'REDMINE', pluginId: 'p', pluginConfig },
    });
    const data = await markDone();

    expect(getById).toHaveBeenCalledWith('42', pluginConfig, jasmine.anything());
    expect(data.issueLabel).toBe('#42 Issue');
    expect(data.issueIcon).toBe('redmine');
    expect(data.defaultTime).toBe(JiraWorklogExportDefaultTime.TimeToday);
    expect(await firstValueFrom(data.timeLoggedUpdate$!)).toBe(1000);
  });

  it('passes no issue icon for a Material ligature provider icon (#10550)', async () => {
    const registry = TestBed.inject(
      PluginIssueProviderRegistryService,
    ) as jasmine.SpyObj<PluginIssueProviderRegistryService>;
    registry.getProvider.and.returnValue({
      pluginId: 'third-party',
      icon: 'confirmation_number',
      definition: { getById, getHeaders: () => ({}), timeTracking },
    } as never);
    setProviders({
      ip1: { id: 'ip1', issueProviderKey: 'REDMINE', pluginId: 'p', pluginConfig },
    });
    const data = await markDone();

    expect(data.issueIcon).toBeUndefined();
  });

  it('falls back to no activities when loading them fails', async () => {
    timeTracking.getActivities.and.rejectWith(new Error('boom'));
    setProviders({
      ip1: { id: 'ip1', issueProviderKey: 'REDMINE', pluginId: 'p', pluginConfig },
    });
    const data = await markDone();

    expect(await firstValueFrom(data.activities$!)).toEqual([]);
  });

  it('logs the submitted time through the plugin', async () => {
    setProviders({
      ip1: { id: 'ip1', issueProviderKey: 'REDMINE', pluginId: 'p', pluginConfig },
    });
    const data = await markDone();
    const started = '2026-01-15T10:00';
    await firstValueFrom(
      data.onSubmit({ timeSpent: 60000, started, comment: 'c', activityId: 9 }),
      { defaultValue: undefined },
    );

    expect(timeTracking.logTime).toHaveBeenCalledWith(
      '42',
      {
        started: new Date(started).getTime(),
        timeSpentMs: 60000,
        comment: 'c',
        activityId: 9,
      },
      pluginConfig,
      jasmine.anything(),
    );
  });

  it('saves the default time inside pluginConfig', async () => {
    setProviders({
      ip1: { id: 'ip1', issueProviderKey: 'REDMINE', pluginId: 'p', pluginConfig },
    });
    const data = await markDone();
    data.saveDefaultTime!(JiraWorklogExportDefaultTime.AllTime);
    await new Promise((r) => setTimeout(r, 0));

    expect(store.dispatch).toHaveBeenCalledWith(
      IssueProviderActions.updateIssueProvider({
        issueProvider: {
          id: 'ip1',
          changes: {
            pluginConfig: {
              ...pluginConfig,
              timeTrackingDialogDefaultTime: JiraWorklogExportDefaultTime.AllTime,
            },
          },
        },
      }),
    );
  });

  it('opens the dialog for a done subtask in per-subtask mode', async () => {
    const sub = createTask({ id: 't1', parentId: 'main' });
    const main = createTask({
      id: 'main',
      subTaskIds: ['t1'],
      issueId: '42',
      issueProviderId: 'ip1',
    });
    taskService.getByIdOnce$.and.callFake((id: string) => of(id === 'main' ? main : sub));
    setProviders({
      ip1: {
        id: 'ip1',
        issueProviderKey: 'REDMINE',
        pluginId: 'p',
        pluginConfig: { ...pluginConfig, isShowTimeTrackingDialogForEachSubTask: true },
      },
    });
    const data = await markDone();

    expect(matDialog.open).toHaveBeenCalled();
    expect(getById).toHaveBeenCalledWith('42', jasmine.anything(), jasmine.anything());
    expect(data.task.id).toBe('t1');
  });

  it('does nothing for providers that are not plugins', async () => {
    setProviders({ ip1: { id: 'ip1', issueProviderKey: 'JIRA' } });
    await markDone();

    expect(matDialog.open).not.toHaveBeenCalled();
  });

  it('does nothing when the dialog is disabled', async () => {
    setProviders({
      ip1: {
        id: 'ip1',
        issueProviderKey: 'REDMINE',
        pluginId: 'p',
        pluginConfig: { host: 'h' },
      },
    });
    await markDone();

    expect(getById).not.toHaveBeenCalled();
    expect(matDialog.open).not.toHaveBeenCalled();
  });
});
