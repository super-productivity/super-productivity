import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Observable, of, Subject } from 'rxjs';
import { PollToBacklogEffects } from './poll-to-backlog.effects';
import { IssueService } from '../issue.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { setActiveWorkContext } from '../../work-context/store/work-context.actions';
import { selectEnabledIssueProviders } from './issue-provider.selectors';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { SnackService } from '../../../core/snack/snack.service';
import { JIRA_TYPE } from '../issue.const';
import { IssueProvider } from '../issue.model';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';

describe('PollToBacklogEffects', () => {
  let effects: PollToBacklogEffects;
  let actions$: Observable<any>;
  let store: MockStore;
  let issueServiceSpy: jasmine.SpyObj<IssueService>;
  let workContextServiceSpy: jasmine.SpyObj<WorkContextService>;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;

  const createMockIssueProvider = (
    overrides: Partial<IssueProvider> = {},
  ): IssueProvider =>
    ({
      id: 'provider-1',
      issueProviderKey: JIRA_TYPE,
      isEnabled: true,
      isAutoPoll: true,
      isAutoAddToBacklog: true,
      isIntegratedAddTaskBar: false,
      defaultProjectId: 'project-1',
      pinnedSearch: null,
      ...overrides,
    }) as IssueProvider;

  beforeEach(() => {
    issueServiceSpy = jasmine.createSpyObj('IssueService', [
      'getPollInterval',
      'checkAndImportNewIssuesToBacklogForProject',
    ]);

    issueServiceSpy.getPollInterval.and.returnValue(300000); // 5 minutes
    issueServiceSpy.checkAndImportNewIssuesToBacklogForProject.and.returnValue(
      Promise.resolve(),
    );

    workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [], {
      isActiveWorkContextProject$: of(true),
      activeWorkContextId$: of('project-1'),
    });

    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);

    TestBed.configureTestingModule({
      providers: [
        PollToBacklogEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [{ selector: selectEnabledIssueProviders, value: [] }],
        }),
        { provide: IssueService, useValue: issueServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
        {
          provide: SyncTriggerService,
          useValue: { afterInitialSyncDoneAndDataLoadedInitially$: of(true) },
        },
        {
          provide: SnackService,
          useValue: snackServiceSpy,
        },
      ],
    });

    effects = TestBed.inject(PollToBacklogEffects);
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('pollNewIssuesToBacklog$', () => {
    it('should poll when active project matches provider defaultProjectId', fakeAsync(() => {
      const provider = createMockIssueProvider({
        id: 'jira-1',
        defaultProjectId: 'project-1',
        isAutoAddToBacklog: true,
      });

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollNewIssuesToBacklog$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      expect(
        issueServiceSpy.checkAndImportNewIssuesToBacklogForProject,
      ).toHaveBeenCalledWith(JIRA_TYPE, 'jira-1', false);
    }));

    it('should NOT poll providers with pollingMode always (handled by separate effect)', fakeAsync(() => {
      const provider = createMockIssueProvider({
        id: 'jira-1',
        defaultProjectId: 'project-1',
        isAutoAddToBacklog: true,
        pollingMode: 'always',
      });

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollNewIssuesToBacklog$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      expect(
        issueServiceSpy.checkAndImportNewIssuesToBacklogForProject,
      ).not.toHaveBeenCalled();
    }));

    it('should NOT poll when active project does not match provider', fakeAsync(() => {
      const provider = createMockIssueProvider({
        id: 'jira-1',
        defaultProjectId: 'project-2', // Different from active project
        isAutoAddToBacklog: true,
      });

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollNewIssuesToBacklog$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      expect(
        issueServiceSpy.checkAndImportNewIssuesToBacklogForProject,
      ).not.toHaveBeenCalled();
    }));
  });

  describe('pollNewIssuesToBacklogAlways$', () => {
    it('should start polling when Linear registers after initial sync', fakeAsync(() => {
      const pluginRegistry = TestBed.inject(PluginIssueProviderRegistryService);
      const provider = createMockIssueProvider({
        id: 'linear-1',
        issueProviderKey: 'LINEAR',
        pollingMode: 'always',
      });

      issueServiceSpy.getPollInterval.and.callFake((key) =>
        pluginRegistry.getPollIntervalMs(key),
      );
      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const subscription = effects.pollNewIssuesToBacklogAlways$.subscribe();

      tick(300000);
      expect(
        issueServiceSpy.checkAndImportNewIssuesToBacklogForProject,
      ).not.toHaveBeenCalled();

      pluginRegistry.register({
        pluginId: 'linear-issue-provider',
        issueProviderKey: 'LINEAR',
        name: 'Linear',
        humanReadableName: 'Linear',
        icon: 'linear',
        pollIntervalMs: 300000,
        issueStrings: { singular: 'Issue', plural: 'Issues' },
        definition: {
          configFields: [],
          getHeaders: () => ({}),
          searchIssues: () => Promise.resolve([]),
          getById: () => Promise.resolve({ id: '1', title: '', body: '', url: '' }),
          getIssueLink: () => '',
          issueDisplay: [],
        },
      });

      tick(10001);
      expect(
        issueServiceSpy.checkAndImportNewIssuesToBacklogForProject,
      ).toHaveBeenCalledWith('LINEAR', 'linear-1', true);

      tick(300000);
      expect(
        issueServiceSpy.checkAndImportNewIssuesToBacklogForProject,
      ).toHaveBeenCalledTimes(2);

      subscription.unsubscribe();
    }));

    it('should poll providers with pollingMode always after sync without context switch', fakeAsync(() => {
      const provider = createMockIssueProvider({
        id: 'jira-1',
        defaultProjectId: 'project-2',
        isAutoAddToBacklog: true,
        pollingMode: 'always',
      });

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      // No need to set up actions$ — effect triggers on afterInitialSyncDone$, not on actions
      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollNewIssuesToBacklogAlways$.subscribe();

      tick(10001);

      expect(
        issueServiceSpy.checkAndImportNewIssuesToBacklogForProject,
      ).toHaveBeenCalledWith(JIRA_TYPE, 'jira-1', true);
    }));

    it('should NOT poll always-mode providers without isAutoAddToBacklog', fakeAsync(() => {
      const provider = createMockIssueProvider({
        id: 'jira-1',
        defaultProjectId: 'project-2',
        isAutoAddToBacklog: false,
        pollingMode: 'always',
      });

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollNewIssuesToBacklogAlways$.subscribe();

      tick(10001);

      expect(
        issueServiceSpy.checkAndImportNewIssuesToBacklogForProject,
      ).not.toHaveBeenCalled();
    }));

    it('should NOT poll always-mode providers without defaultProjectId', fakeAsync(() => {
      const provider = createMockIssueProvider({
        id: 'jira-1',
        defaultProjectId: null,
        isAutoAddToBacklog: true,
        pollingMode: 'always',
      });

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollNewIssuesToBacklogAlways$.subscribe();

      tick(10001);

      expect(
        issueServiceSpy.checkAndImportNewIssuesToBacklogForProject,
      ).not.toHaveBeenCalled();
    }));

    it('should NOT poll non-always providers in the always effect', fakeAsync(() => {
      const provider = createMockIssueProvider({
        id: 'jira-1',
        defaultProjectId: 'project-2',
        isAutoAddToBacklog: true,
        pollingMode: 'whenProjectOpen',
      });

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollNewIssuesToBacklogAlways$.subscribe();

      tick(10001);

      expect(
        issueServiceSpy.checkAndImportNewIssuesToBacklogForProject,
      ).not.toHaveBeenCalled();
    }));

    it('should continue polling after a transient error', fakeAsync(() => {
      const provider = createMockIssueProvider({
        id: 'jira-1',
        defaultProjectId: 'project-2',
        isAutoAddToBacklog: true,
        pollingMode: 'always',
      });

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      let callCount = 0;
      issueServiceSpy.checkAndImportNewIssuesToBacklogForProject.and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve();
      });

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollNewIssuesToBacklogAlways$.subscribe();

      // First poll — should fail but not kill the stream
      tick(10001);
      expect(
        issueServiceSpy.checkAndImportNewIssuesToBacklogForProject,
      ).toHaveBeenCalledTimes(1);
      expect(snackServiceSpy.open).toHaveBeenCalledTimes(1);

      // Second poll — should succeed (timer continues)
      tick(300000);
      expect(
        issueServiceSpy.checkAndImportNewIssuesToBacklogForProject,
      ).toHaveBeenCalledTimes(2);
    }));
  });
});
