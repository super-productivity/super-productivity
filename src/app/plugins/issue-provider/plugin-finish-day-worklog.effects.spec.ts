import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import type { PluginTimeTracking } from '@super-productivity/plugin-api';
import { createTask } from '../../features/tasks/task.test-helper';
import { selectAllTasksInActiveProjects } from '../../features/tasks/store/task.selectors';
import { selectIssueProviderState } from '../../features/issue/store/issue-provider.selectors';
import { BeforeFinishDayService } from '../../features/before-finish-day/before-finish-day.service';
import { SubmitWorklogForDayDialogData } from '../../features/issue/shared/dialog-submit-worklog-for-day/submit-worklog-for-day-dialog.model';
import { SnackService } from '../../core/snack/snack.service';
import {
  groupTasksWithTimeOnDay,
  PluginFinishDayWorklogEffects,
} from './plugin-finish-day-worklog.effects';
import { PluginIssueProviderRegistryService } from './plugin-issue-provider-registry.service';
import { PluginHttpService } from './plugin-http.service';

const DAY = '2026-08-05';

const task = (
  id: string,
  issueProviderId: string,
  ms: number,
): ReturnType<typeof createTask> =>
  createTask({
    id,
    issueId: `issue-${id}`,
    issueProviderId,
    timeSpentOnDay: { [DAY]: ms },
  });

describe('groupTasksWithTimeOnDay', () => {
  it('groups linked tasks with time on the day by provider', () => {
    const grouped = groupTasksWithTimeOnDay(
      [
        task('a', 'ip1', 1000),
        task('b', 'ip2', 1000),
        task('c', 'ip1', 1000),
        task('noTime', 'ip1', 0),
        createTask({ id: 'unlinked', timeSpentOnDay: { [DAY]: 1000 } }),
      ],
      DAY,
    );

    expect([...grouped.keys()]).toEqual(['ip1', 'ip2']);
    expect(grouped.get('ip1')!.map((t) => t.id)).toEqual(['a', 'c']);
  });
});

describe('PluginFinishDayWorklogEffects', () => {
  let store: MockStore;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let timeTracking: jasmine.SpyObj<Required<PluginTimeTracking>>;
  let addAction: jasmine.Spy;

  const provider = (id: string, pluginConfig: Record<string, unknown>): unknown => ({
    id,
    isEnabled: true,
    issueProviderKey: 'plugin:gitlab',
    pluginId: 'gitlab-issue-provider',
    pluginConfig,
  });

  const setState = (providers: unknown[]): void => {
    store.overrideSelector(selectIssueProviderState, {
      ids: providers.map((p) => (p as { id: string }).id),
      entities: Object.fromEntries(providers.map((p) => [(p as { id: string }).id, p])),
    } as never);
    store.overrideSelector(selectAllTasksInActiveProjects, [
      task('a', 'ip1', 3600000),
      task('b', 'ip2', 3600000),
    ]);
    store.refreshState();
  };

  const openedData = (): SubmitWorklogForDayDialogData[] =>
    matDialog.open.calls
      .allArgs()
      .map(([, cfg]) => cfg?.data as SubmitWorklogForDayDialogData);

  beforeEach(() => {
    matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    matDialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
    timeTracking = jasmine.createSpyObj('timeTracking', [
      'logTime',
      'getTimeLogged',
      'getActivities',
    ]);
    timeTracking.logTime.and.resolveTo();
    const registry = jasmine.createSpyObj<PluginIssueProviderRegistryService>(
      'Registry',
      ['getProvider', 'getHumanReadableName'],
    );
    registry.getProvider.and.returnValue({
      pluginId: 'gitlab-issue-provider',
      icon: 'gitlab',
      allowPrivateNetwork: false,
      definition: { getHeaders: () => ({}), timeTracking },
    } as never);
    registry.getHumanReadableName.and.returnValue('GitLab');
    const pluginHttp = jasmine.createSpyObj<PluginHttpService>('PluginHttp', [
      'createHttpHelper',
    ]);
    pluginHttp.createHttpHelper.and.returnValue({} as never);
    addAction = jasmine.createSpy('addAction');

    TestBed.configureTestingModule({
      providers: [
        PluginFinishDayWorklogEffects,
        provideMockStore(),
        { provide: MatDialog, useValue: matDialog },
        { provide: BeforeFinishDayService, useValue: { addAction } },
        { provide: PluginIssueProviderRegistryService, useValue: registry },
        { provide: PluginHttpService, useValue: pluginHttp },
        { provide: SnackService, useValue: jasmine.createSpyObj('Snack', ['open']) },
      ],
    });
    store = TestBed.inject(MockStore);
  });

  afterEach(() => store.resetSelectors());

  it('registers a before-finish-day action', () => {
    TestBed.inject(PluginFinishDayWorklogEffects);

    expect(addAction).toHaveBeenCalledTimes(1);
  });

  it('opens the dialog only for providers that opted in', async () => {
    setState([
      provider('ip1', { isSubmitWorklogOnFinishDay: true }),
      provider('ip2', { isSubmitWorklogOnFinishDay: false }),
    ]);
    await TestBed.inject(PluginFinishDayWorklogEffects).submitWorklogForDay(DAY);

    expect(openedData().map((d) => d.tasks.map((t) => t.id))).toEqual([['a']]);
    expect(openedData()[0].providerName).toBe('GitLab');
  });

  it('opens nothing for a provider without timeTracking', async () => {
    TestBed.inject(PluginIssueProviderRegistryService).getProvider = () =>
      ({
        pluginId: 'gitlab-issue-provider',
        definition: { getHeaders: () => ({}) },
      }) as never;
    setState([provider('ip1', { isSubmitWorklogOnFinishDay: true })]);
    await TestBed.inject(PluginFinishDayWorklogEffects).submitWorklogForDay(DAY);

    expect(matDialog.open).not.toHaveBeenCalled();
  });

  it('passes the plugin config to getTimeLogged', async () => {
    timeTracking.getTimeLogged.and.resolveTo(1000);
    setState([provider('ip1', { isSubmitWorklogOnFinishDay: true })]);
    await TestBed.inject(PluginFinishDayWorklogEffects).submitWorklogForDay(DAY);

    expect(await openedData()[0].getTimeLogged!('issue-a')).toBe(1000);
    expect(timeTracking.getTimeLogged).toHaveBeenCalledWith(
      'issue-a',
      jasmine.objectContaining({ isSubmitWorklogOnFinishDay: true }),
      jasmine.anything(),
    );
  });

  // navigating away must not silently skip the submit while the day finishes
  it('opens a dialog that only the user can close', async () => {
    setState([provider('ip1', { isSubmitWorklogOnFinishDay: true })]);
    await TestBed.inject(PluginFinishDayWorklogEffects).submitWorklogForDay(DAY);

    expect(matDialog.open.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({ disableClose: true, closeOnNavigation: false }),
    );
  });

  it('opens nothing for a disabled provider', async () => {
    setState([
      {
        ...(provider('ip1', { isSubmitWorklogOnFinishDay: true }) as object),
        isEnabled: false,
      },
    ]);
    await TestBed.inject(PluginFinishDayWorklogEffects).submitWorklogForDay(DAY);

    expect(matDialog.open).not.toHaveBeenCalled();
  });

  it('logs the time dated to the local start of the finished day', async () => {
    setState([provider('ip1', { isSubmitWorklogOnFinishDay: true })]);
    await TestBed.inject(PluginFinishDayWorklogEffects).submitWorklogForDay(DAY);
    await openedData()[0].logTime('issue-a', 900000);

    expect(timeTracking.logTime).toHaveBeenCalledWith(
      'issue-a',
      { started: new Date(2026, 7, 5).getTime(), timeSpentMs: 900000, comment: '' },
      jasmine.objectContaining({ isSubmitWorklogOnFinishDay: true }),
      jasmine.anything(),
    );
  });

  it('reports a failed submit and rejects so the dialog keeps the row', async () => {
    timeTracking.logTime.and.rejectWith(new Error('offline'));
    setState([provider('ip1', { isSubmitWorklogOnFinishDay: true })]);
    await TestBed.inject(PluginFinishDayWorklogEffects).submitWorklogForDay(DAY);

    await expectAsync(openedData()[0].logTime('issue-a', 900000)).toBeRejected();
    expect(TestBed.inject(SnackService).open).toHaveBeenCalled();
  });
});
