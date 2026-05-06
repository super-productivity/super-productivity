import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';
import { PluginIssueProviderAdapterService } from './plugin-issue-provider-adapter.service';
import { PluginIssueProviderRegistryService } from './plugin-issue-provider-registry.service';
import { PluginHttpService } from './plugin-http.service';
import {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
  RegisteredPluginIssueProvider,
} from './plugin-issue-provider.model';
import { IssueProviderPluginType } from '../../features/issue/issue.model';
import { Task } from '../../features/tasks/task.model';
import { TaskService } from '../../features/tasks/task.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';

describe('PluginIssueProviderAdapterService', () => {
  let service: PluginIssueProviderAdapterService;
  let registrySpy: jasmine.SpyObj<PluginIssueProviderRegistryService>;
  let pluginHttpSpy: jasmine.SpyObj<PluginHttpService>;
  let storeSpy: jasmine.SpyObj<Store>;
  let snackSpy: jasmine.SpyObj<SnackService>;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;

  const PLUGIN_KEY = 'plugin:test-plugin';
  const PROVIDER_ID = 'provider-123';

  const mockPluginConfig: Record<string, unknown> = { apiUrl: 'https://example.com' };

  const mockPluginCfg: IssueProviderPluginType = {
    id: PROVIDER_ID,
    isEnabled: true,
    issueProviderKey: PLUGIN_KEY,
    pluginId: 'test-plugin',
    pluginConfig: mockPluginConfig,
  } as IssueProviderPluginType;

  const mockHttpHelper: PluginHttp = {
    get: jasmine.createSpy('get'),
    post: jasmine.createSpy('post'),
    put: jasmine.createSpy('put'),
    patch: jasmine.createSpy('patch'),
    delete: jasmine.createSpy('delete'),
    request: jasmine.createSpy('request'),
  };

  const createMockDefinition = (
    overrides: Partial<IssueProviderPluginDefinition> = {},
  ): IssueProviderPluginDefinition => ({
    configFields: [],
    getHeaders: jasmine.createSpy('getHeaders').and.returnValue({}),
    searchIssues: jasmine
      .createSpy('searchIssues')
      .and.resolveTo([] as PluginSearchResult[]),
    getById: jasmine.createSpy('getById').and.resolveTo({
      id: '1',
      title: 'Test Issue',
    } as PluginIssue),
    getIssueLink: jasmine.createSpy('getIssueLink').and.returnValue('https://link'),
    issueDisplay: [],
    ...overrides,
  });

  const createMockProvider = (
    defOverrides: Partial<IssueProviderPluginDefinition> = {},
  ): RegisteredPluginIssueProvider => ({
    pluginId: 'test-plugin',
    registeredKey: PLUGIN_KEY,
    definition: createMockDefinition(defOverrides),
    name: 'Test Plugin',
    humanReadableName: 'Test Plugin',
    icon: 'bug_report',
    pollIntervalMs: 5000,
    issueStrings: { singular: 'Issue', plural: 'Issues' },
  });

  beforeEach(() => {
    registrySpy = jasmine.createSpyObj('PluginIssueProviderRegistryService', [
      'getProvider',
      'hasProvider',
      'getAvailableProviders',
    ]);
    pluginHttpSpy = jasmine.createSpyObj('PluginHttpService', ['createHttpHelper']);
    storeSpy = jasmine.createSpyObj('Store', ['select']);

    snackSpy = jasmine.createSpyObj('SnackService', ['open']);
    taskServiceSpy = jasmine.createSpyObj('TaskService', ['removeMultipleTasks']);
    pluginHttpSpy.createHttpHelper.and.returnValue(mockHttpHelper);
    storeSpy.select.and.returnValue(of(mockPluginCfg));
    registrySpy.hasProvider.and.returnValue(true);

    TestBed.configureTestingModule({
      providers: [
        PluginIssueProviderAdapterService,
        { provide: PluginIssueProviderRegistryService, useValue: registrySpy },
        { provide: PluginHttpService, useValue: pluginHttpSpy },
        { provide: Store, useValue: storeSpy },
        { provide: SnackService, useValue: snackSpy },
        { provide: TaskService, useValue: taskServiceSpy },
      ],
    });

    service = TestBed.inject(PluginIssueProviderAdapterService);
  });

  describe('isEnabled', () => {
    it('should always return true', () => {
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('pollInterval', () => {
    it('should be 0', () => {
      expect(service.pollInterval).toBe(0);
    });
  });

  describe('testConnection', () => {
    it('should delegate to plugin definition testConnection', async () => {
      const testConnectionSpy = jasmine.createSpy('testConnection').and.resolveTo(true);
      const provider = createMockProvider({ testConnection: testConnectionSpy });
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.testConnection(
        mockPluginCfg as unknown as Parameters<typeof service.testConnection>[0],
      );

      expect(result).toBe(true);
      expect(testConnectionSpy).toHaveBeenCalledWith(mockPluginConfig, mockHttpHelper);
    });

    it('should return true when plugin definition has no testConnection', async () => {
      const provider = createMockProvider();
      delete (provider.definition as Partial<IssueProviderPluginDefinition>)
        .testConnection;
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.testConnection(
        mockPluginCfg as unknown as Parameters<typeof service.testConnection>[0],
      );

      expect(result).toBe(true);
    });

    it('should return false when plugin is not registered', async () => {
      registrySpy.getProvider.and.returnValue(undefined);

      const result = await service.testConnection(
        mockPluginCfg as unknown as Parameters<typeof service.testConnection>[0],
      );

      expect(result).toBe(false);
    });

    it('should return false when testConnection rejects', async () => {
      const testConnectionSpy = jasmine
        .createSpy('testConnection')
        .and.rejectWith(new Error('Connection failed'));
      const provider = createMockProvider({ testConnection: testConnectionSpy });
      registrySpy.getProvider.and.returnValue(provider);
      spyOn(console, 'error');

      const result = await service.testConnection(
        mockPluginCfg as unknown as Parameters<typeof service.testConnection>[0],
      );

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('searchIssues', () => {
    it('should delegate to plugin definition and map results to SearchResultItem[]', async () => {
      const searchResults: PluginSearchResult[] = [
        { id: 'ISS-1', title: 'First Issue' },
        { id: 'ISS-2', title: 'Second Issue', status: 'open' },
      ];
      const provider = createMockProvider({
        searchIssues: jasmine.createSpy('searchIssues').and.resolveTo(searchResults),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.searchIssues('test query', PROVIDER_ID);

      expect(result.length).toBe(2);
      expect(result[0]).toEqual({
        title: 'First Issue',
        issueType: PLUGIN_KEY,
        issueData: searchResults[0],
      });
      expect(result[1]).toEqual({
        title: 'Second Issue',
        issueType: PLUGIN_KEY,
        issueData: searchResults[1],
      });
      expect(provider.definition.searchIssues).toHaveBeenCalledWith(
        'test query',
        mockPluginConfig,
        mockHttpHelper,
      );
    });

    it('should return empty array when provider is not registered', async () => {
      registrySpy.getProvider.and.returnValue(undefined);

      const result = await service.searchIssues('test query', PROVIDER_ID);

      expect(result).toEqual([]);
    });

    it('should return empty array when cfg is not found in store', async () => {
      storeSpy.select.and.returnValue(throwError(() => new Error('Not found')));

      const result = await service.searchIssues('test query', PROVIDER_ID);

      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('should delegate to plugin definition getById', async () => {
      const issue: PluginIssue = {
        id: 'ISS-42',
        title: 'Found Issue',
        lastUpdated: 1000,
      };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(issue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.getById('ISS-42', PROVIDER_ID);

      expect(result).toEqual(issue);
      expect(provider.definition.getById).toHaveBeenCalledWith(
        'ISS-42',
        mockPluginConfig,
        mockHttpHelper,
      );
    });

    it('should convert numeric id to string when calling getById', async () => {
      const issue: PluginIssue = { id: '123', title: 'Numeric Issue' };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(issue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      await service.getById(123, PROVIDER_ID);

      expect(provider.definition.getById).toHaveBeenCalledWith(
        '123',
        mockPluginConfig,
        mockHttpHelper,
      );
    });

    it('should return null when provider is not registered', async () => {
      registrySpy.getProvider.and.returnValue(undefined);

      const result = await service.getById('ISS-42', PROVIDER_ID);

      expect(result).toBeNull();
    });

    it('should return null when cfg is not found', async () => {
      storeSpy.select.and.returnValue(throwError(() => new Error('Not found')));

      const result = await service.getById('ISS-42', PROVIDER_ID);

      expect(result).toBeNull();
    });
  });

  describe('getAddTaskData', () => {
    it('should synthesize IssueTask from IssueDataReduced', () => {
      const issueData = { id: 'ISS-10', title: 'New Feature' } as PluginSearchResult;

      const result = service.getAddTaskData(issueData);

      expect(result.title).toBe('New Feature');
      expect(result.issueId).toBe('ISS-10');
      expect(result.issueWasUpdated).toBe(false);
      expect(result.issueAttachmentNr).toBe(0);
      expect(result.issuePoints).toBeUndefined();
      expect(result.issueTimeTracked).toBeUndefined();
    });

    it('should set issueLastUpdated to 0 when lastUpdated is missing so first poll applies field mappings', () => {
      const result = service.getAddTaskData({
        id: 'X-1',
        title: 'Test',
      } as PluginSearchResult);

      expect(result.issueLastUpdated).toBe(0);
    });

    it('should derive dueDay from start timestamp when start is a number', () => {
      // 2026-03-19 12:00:00 UTC
      const issueData = {
        id: 'ISS-10',
        title: 'Event',
        start: 1774008000000,
      } as any;

      const result = service.getAddTaskData(issueData);

      expect((result as any).dueDay).toBeDefined();
      expect(typeof (result as any).dueDay).toBe('string');
      // Should be a YYYY-MM-DD string
      expect((result as any).dueDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should not include dueDay when start is not a number', () => {
      const issueData = {
        id: 'ISS-10',
        title: 'Event',
        start: '2026-03-19',
      } as any;

      const result = service.getAddTaskData(issueData);

      expect((result as any).dueDay).toBeUndefined();
    });

    it('should not include dueDay when start is absent', () => {
      const issueData = { id: 'ISS-10', title: 'Event' } as any;

      const result = service.getAddTaskData(issueData);

      expect((result as any).dueDay).toBeUndefined();
    });

    it('should set dueWithTime when dueWithTime is a number (timed event)', () => {
      const ts = new Date('2026-03-19T14:00:00Z').getTime();
      const issueData = {
        id: 'ISS-10',
        title: 'Meeting',
        start: ts,
        dueWithTime: ts,
      } as any;

      const result = service.getAddTaskData(issueData);

      expect((result as any).dueWithTime).toBe(ts);
      expect((result as any).dueDay).toBeUndefined();
    });

    it('should set dueDay when start is present but dueWithTime is not (all-day event)', () => {
      const issueData = {
        id: 'ISS-10',
        title: 'All-day',
        start: new Date('2026-03-19').getTime(),
      } as any;

      const result = service.getAddTaskData(issueData);

      expect((result as any).dueDay).toBeDefined();
      expect((result as any).dueWithTime).toBeUndefined();
    });
  });

  describe('getFreshDataForIssueTask', () => {
    it('should return null when task has no issueProviderId', async () => {
      const task = { id: 'task-1', issueId: 'ISS-1' } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return null when task has no issueId', async () => {
      const task = { id: 'task-1', issueProviderId: PROVIDER_ID } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return fresh data with taskChanges when issue is updated', async () => {
      const freshIssue: PluginIssue = {
        id: 'ISS-5',
        title: 'Updated Issue',
        lastUpdated: 2000,
      };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const task = {
        id: 'task-1',
        issueId: 'ISS-5',
        issueProviderId: PROVIDER_ID,
        issueLastUpdated: 1000,
      } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).not.toBeNull();
      expect(result!.issue).toEqual(freshIssue);
      expect(result!.issueTitle).toBe('Updated Issue');
      expect(result!.taskChanges.issueWasUpdated).toBe(true);
      expect(result!.taskChanges.issueLastUpdated).toBe(2000);
      expect(result!.taskChanges.title).toBe('Updated Issue');
    });

    it('should return null when issue is not updated', async () => {
      const freshIssue: PluginIssue = {
        id: 'ISS-5',
        title: 'Same Issue',
        lastUpdated: 1000,
      };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const task = {
        id: 'task-1',
        issueId: 'ISS-5',
        issueProviderId: PROVIDER_ID,
        issueLastUpdated: 1000,
      } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return null when issue has no lastUpdated', async () => {
      const freshIssue: PluginIssue = {
        id: 'ISS-5',
        title: 'No Update Time',
      };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const task = {
        id: 'task-1',
        issueId: 'ISS-5',
        issueProviderId: PROVIDER_ID,
        issueLastUpdated: 1000,
      } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return null when getById returns null', async () => {
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(null),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const task = {
        id: 'task-1',
        issueId: 'ISS-5',
        issueProviderId: PROVIDER_ID,
      } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return null when provider is not registered', async () => {
      registrySpy.getProvider.and.returnValue(undefined);

      const task = {
        id: 'task-1',
        issueId: 'ISS-5',
        issueProviderId: PROVIDER_ID,
      } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    describe('pull-side field mapping', () => {
      const FIELD_MAPPINGS: PluginFieldMapping[] = [
        {
          taskField: 'dueWithTime',
          issueField: 'start_dateTime',
          defaultDirection: 'both',
          mutuallyExclusive: ['dueDay'],
          toIssueValue: (v: unknown) => v,
          toTaskValue: (v: unknown) => (v ? new Date(v as string).getTime() : undefined),
        },
        {
          taskField: 'dueDay',
          issueField: 'start_date',
          defaultDirection: 'both',
          mutuallyExclusive: ['dueWithTime'],
          toIssueValue: (v: unknown) => v,
          toTaskValue: (v: unknown) => v,
        },
        {
          taskField: 'title',
          issueField: 'summary',
          defaultDirection: 'both',
          toIssueValue: (v: unknown) => v,
          toTaskValue: (v: unknown) => v,
        },
      ];

      const createProviderWithMappings = (
        issue: PluginIssue,
        syncValues: Record<string, unknown>,
      ): RegisteredPluginIssueProvider =>
        createMockProvider({
          getById: jasmine.createSpy('getById').and.resolveTo(issue),
          fieldMappings: FIELD_MAPPINGS,
          extractSyncValues: jasmine
            .createSpy('extractSyncValues')
            .and.returnValue(syncValues),
        });

      it('should pull changed field when direction is both', async () => {
        const freshIssue: PluginIssue = {
          id: 'ISS-1',
          title: 'Meeting',
          lastUpdated: 2000,
        };
        const syncValues = {
          summary: 'Meeting',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          start_dateTime: '2026-03-20T10:00:00.000Z',
        };
        const provider = createProviderWithMappings(freshIssue, syncValues);
        registrySpy.getProvider.and.returnValue(provider);

        const cfgWithSync = {
          ...mockPluginCfg,
          pluginConfig: {
            ...mockPluginConfig,
            twoWaySync: { dueWithTime: 'both', title: 'both' },
          },
        } as IssueProviderPluginType;
        storeSpy.select.and.returnValue(of(cfgWithSync));

        const task = {
          id: 'task-1',
          issueId: 'ISS-1',
          issueProviderId: PROVIDER_ID,
          issueLastUpdated: 1000,
          issueLastSyncedValues: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            start_dateTime: '2026-03-19T10:00:00.000Z',
            summary: 'Meeting',
          },
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).not.toBeNull();
        expect(result!.taskChanges['dueWithTime' as keyof Task]).toBe(
          new Date('2026-03-20T10:00:00.000Z').getTime(),
        );
      });

      it('should pull changed field when direction is pullOnly', async () => {
        const freshIssue: PluginIssue = {
          id: 'ISS-1',
          title: 'Updated',
          lastUpdated: 2000,
        };
        const syncValues = { summary: 'Updated' };
        const provider = createProviderWithMappings(freshIssue, syncValues);
        registrySpy.getProvider.and.returnValue(provider);

        const cfgWithSync = {
          ...mockPluginCfg,
          pluginConfig: {
            ...mockPluginConfig,
            twoWaySync: { title: 'pullOnly' },
          },
        } as IssueProviderPluginType;
        storeSpy.select.and.returnValue(of(cfgWithSync));

        const task = {
          id: 'task-1',
          issueId: 'ISS-1',
          issueProviderId: PROVIDER_ID,
          issueLastUpdated: 1000,
          issueLastSyncedValues: { summary: 'Original' },
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).not.toBeNull();
        expect(result!.taskChanges['title' as keyof Task]).toBe('Updated');
      });

      it('should skip field when direction is pushOnly', async () => {
        const freshIssue: PluginIssue = {
          id: 'ISS-1',
          title: 'Unchanged',
          lastUpdated: 2000,
        };
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const syncValues = { start_dateTime: '2026-03-20T10:00:00.000Z' };
        const provider = createMockProvider({
          getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
          fieldMappings: FIELD_MAPPINGS,
          // First call (from _extractTaskFieldsFromIssue) returns empty,
          // second call (for _applyFieldMappingPull) returns actual values.
          extractSyncValues: jasmine
            .createSpy('extractSyncValues')
            .and.returnValues({}, syncValues),
        });
        registrySpy.getProvider.and.returnValue(provider);

        const cfgWithSync = {
          ...mockPluginCfg,
          pluginConfig: {
            ...mockPluginConfig,
            twoWaySync: { dueWithTime: 'pushOnly' },
          },
        } as IssueProviderPluginType;
        storeSpy.select.and.returnValue(of(cfgWithSync));

        const task = {
          id: 'task-1',
          issueId: 'ISS-1',
          issueProviderId: PROVIDER_ID,
          issueLastUpdated: 1000,
          issueLastSyncedValues: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            start_dateTime: '2026-03-19T10:00:00.000Z',
          },
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).not.toBeNull();
        expect(result!.taskChanges['dueWithTime' as keyof Task]).toBeUndefined();
      });

      it('should skip field when direction is off', async () => {
        const freshIssue: PluginIssue = {
          id: 'ISS-1',
          title: 'Unchanged',
          lastUpdated: 2000,
        };
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const syncValues = { start_dateTime: '2026-03-20T10:00:00.000Z' };
        const provider = createMockProvider({
          getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
          fieldMappings: FIELD_MAPPINGS,
          extractSyncValues: jasmine
            .createSpy('extractSyncValues')
            .and.returnValues({}, syncValues),
        });
        registrySpy.getProvider.and.returnValue(provider);

        const cfgWithSync = {
          ...mockPluginCfg,
          pluginConfig: {
            ...mockPluginConfig,
            twoWaySync: { dueWithTime: 'off' },
          },
        } as IssueProviderPluginType;
        storeSpy.select.and.returnValue(of(cfgWithSync));

        const task = {
          id: 'task-1',
          issueId: 'ISS-1',
          issueProviderId: PROVIDER_ID,
          issueLastUpdated: 1000,
          issueLastSyncedValues: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            start_dateTime: '2026-03-19T10:00:00.000Z',
          },
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).not.toBeNull();
        expect(result!.taskChanges['dueWithTime' as keyof Task]).toBeUndefined();
      });

      it('should skip pull when fresh value equals last synced value', async () => {
        const freshIssue: PluginIssue = {
          id: 'ISS-1',
          title: 'Unchanged',
          lastUpdated: 2000,
        };
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const syncValues = { start_dateTime: '2026-03-20T10:00:00.000Z' };
        const provider = createMockProvider({
          getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
          fieldMappings: FIELD_MAPPINGS,
          extractSyncValues: jasmine
            .createSpy('extractSyncValues')
            .and.returnValues({}, syncValues),
        });
        registrySpy.getProvider.and.returnValue(provider);

        const cfgWithSync = {
          ...mockPluginCfg,
          pluginConfig: {
            ...mockPluginConfig,
            twoWaySync: { dueWithTime: 'both' },
          },
        } as IssueProviderPluginType;
        storeSpy.select.and.returnValue(of(cfgWithSync));

        const task = {
          id: 'task-1',
          issueId: 'ISS-1',
          issueProviderId: PROVIDER_ID,
          issueLastUpdated: 1000,
          issueLastSyncedValues: {
            // Same value as fresh -> no change detected
            // eslint-disable-next-line @typescript-eslint/naming-convention
            start_dateTime: '2026-03-20T10:00:00.000Z',
          },
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).not.toBeNull();
        expect(result!.taskChanges['dueWithTime' as keyof Task]).toBeUndefined();
      });

      it('should pass issueNumber from the fresh issue into ctx for toTaskValue', async () => {
        const freshIssue: PluginIssue = {
          id: 'ISS-1',
          title: 'Updated',
          lastUpdated: 2000,
          // GitHub-style extended field surfaced via ctx.issueNumber
          ...({ number: 42 } as Record<string, unknown>),
        } as PluginIssue;
        const syncValues = { summary: 'Updated' };
        const provider = createMockProvider({
          getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
          fieldMappings: [
            {
              taskField: 'title',
              issueField: 'summary',
              defaultDirection: 'pullOnly',
              toIssueValue: (v: unknown) => v,
              toTaskValue: (v: unknown, ctx: { issueId: string; issueNumber?: number }) =>
                `#${ctx.issueNumber} ${v}`,
            },
          ],
          extractSyncValues: jasmine
            .createSpy('extractSyncValues')
            .and.returnValue(syncValues),
        });
        registrySpy.getProvider.and.returnValue(provider);

        const cfgWithSync = {
          ...mockPluginCfg,
          pluginConfig: {
            ...mockPluginConfig,
            twoWaySync: { title: 'pullOnly' },
          },
        } as IssueProviderPluginType;
        storeSpy.select.and.returnValue(of(cfgWithSync));

        const task = {
          id: 'task-1',
          issueId: 'ISS-1',
          issueProviderId: PROVIDER_ID,
          issueLastUpdated: 1000,
          issueLastSyncedValues: { summary: 'Original' },
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).not.toBeNull();
        expect(result!.taskChanges['title' as keyof Task]).toBe('#42 Updated');
      });

      it('should clear mutually exclusive fields when pulling dueWithTime', async () => {
        const freshIssue: PluginIssue = {
          id: 'ISS-1',
          title: 'Event',
          lastUpdated: 2000,
        };
        const syncValues = {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          start_dateTime: '2026-03-20T10:00:00.000Z',
          summary: 'Event',
        };
        const provider = createProviderWithMappings(freshIssue, syncValues);
        registrySpy.getProvider.and.returnValue(provider);

        const cfgWithSync = {
          ...mockPluginCfg,
          pluginConfig: {
            ...mockPluginConfig,
            twoWaySync: { dueWithTime: 'both' },
          },
        } as IssueProviderPluginType;
        storeSpy.select.and.returnValue(of(cfgWithSync));

        const task = {
          id: 'task-1',
          issueId: 'ISS-1',
          issueProviderId: PROVIDER_ID,
          issueLastUpdated: 1000,
          dueDay: '2026-03-19',
          issueLastSyncedValues: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            start_dateTime: '2026-03-19T10:00:00.000Z',
          },
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).not.toBeNull();
        // dueDay should be cleared because dueWithTime is mutually exclusive
        expect(result!.taskChanges['dueDay' as keyof Task]).toBeNull();
      });

      it('should include issueLastSyncedValues in taskChanges', async () => {
        const freshIssue: PluginIssue = {
          id: 'ISS-1',
          title: 'Event',
          lastUpdated: 2000,
        };
        const syncValues = {
          summary: 'Event',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          start_dateTime: '2026-03-20T10:00:00.000Z',
        };
        const provider = createProviderWithMappings(freshIssue, syncValues);
        registrySpy.getProvider.and.returnValue(provider);

        const task = {
          id: 'task-1',
          issueId: 'ISS-1',
          issueProviderId: PROVIDER_ID,
          issueLastUpdated: 1000,
        } as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).not.toBeNull();
        expect(result!.taskChanges.issueLastSyncedValues).toEqual(syncValues);
      });
    });

    describe('remote deletion handling', () => {
      it('should auto-delete local task when getById returns 404 and no time tracked', async () => {
        const provider = createMockProvider({
          getById: jasmine
            .createSpy('getById')
            .and.rejectWith(new HttpErrorResponse({ status: 404 })),
        });
        registrySpy.getProvider.and.returnValue(provider);
        spyOn(console, 'log');

        const task = {
          id: 'task-1',
          issueId: 'ISS-5',
          issueProviderId: PROVIDER_ID,
          timeSpent: 0,
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).toBeNull();
        expect(taskServiceSpy.removeMultipleTasks).toHaveBeenCalledWith(['task-1']);
        expect(snackSpy.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            type: 'CUSTOM',
            ico: 'delete_forever',
          }),
        );
      });

      it('should auto-delete local task when getById returns 410 and no time tracked', async () => {
        const provider = createMockProvider({
          getById: jasmine
            .createSpy('getById')
            .and.rejectWith(new HttpErrorResponse({ status: 410 })),
        });
        registrySpy.getProvider.and.returnValue(provider);
        spyOn(console, 'log');

        const task = {
          id: 'task-1',
          issueId: 'ISS-5',
          issueProviderId: PROVIDER_ID,
          timeSpent: 0,
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).toBeNull();
        expect(taskServiceSpy.removeMultipleTasks).toHaveBeenCalledWith(['task-1']);
        expect(snackSpy.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            type: 'CUSTOM',
            ico: 'delete_forever',
          }),
        );
      });

      it('should not auto-delete task with time tracking on 404 but offer action', async () => {
        const provider = createMockProvider({
          getById: jasmine
            .createSpy('getById')
            .and.rejectWith(new HttpErrorResponse({ status: 404 })),
        });
        registrySpy.getProvider.and.returnValue(provider);
        spyOn(console, 'log');

        const task = {
          id: 'task-1',
          issueId: 'ISS-5',
          issueProviderId: PROVIDER_ID,
          timeSpent: 3600000,
          title: 'Tracked Task',
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).toBeNull();
        expect(taskServiceSpy.removeMultipleTasks).not.toHaveBeenCalled();
        expect(snackSpy.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            type: 'WARNING',
            actionStr: T.G.DELETE,
          }),
        );
      });

      it('should not delete task on non-404 errors', async () => {
        const provider = createMockProvider({
          getById: jasmine
            .createSpy('getById')
            .and.rejectWith(new HttpErrorResponse({ status: 500 })),
        });
        registrySpy.getProvider.and.returnValue(provider);
        spyOn(console, 'error');

        const task = {
          id: 'task-1',
          issueId: 'ISS-5',
          issueProviderId: PROVIDER_ID,
        } as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).toBeNull();
        expect(taskServiceSpy.removeMultipleTasks).not.toHaveBeenCalled();
      });

      it('should auto-delete task when issue state matches deletedStates (no time tracked)', async () => {
        const provider = createMockProvider({
          getById: jasmine.createSpy('getById').and.resolveTo({
            id: 'ISS-5',
            title: 'Cancelled Event',
            state: 'cancelled',
            lastUpdated: 2000,
          } as PluginIssue),
          deletedStates: ['cancelled'],
        });
        registrySpy.getProvider.and.returnValue(provider);

        const task = {
          id: 'task-1',
          issueId: 'ISS-5',
          issueProviderId: PROVIDER_ID,
          timeSpent: 0,
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).toBeNull();
        expect(taskServiceSpy.removeMultipleTasks).toHaveBeenCalledWith(['task-1']);
        expect(snackSpy.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            type: 'CUSTOM',
            ico: 'delete_forever',
          }),
        );
      });

      it('should offer delete action when issue state matches deletedStates with time tracked', async () => {
        const provider = createMockProvider({
          getById: jasmine.createSpy('getById').and.resolveTo({
            id: 'ISS-5',
            title: 'Cancelled Event',
            state: 'cancelled',
            lastUpdated: 2000,
          } as PluginIssue),
          deletedStates: ['cancelled'],
        });
        registrySpy.getProvider.and.returnValue(provider);

        const task = {
          id: 'task-1',
          issueId: 'ISS-5',
          issueProviderId: PROVIDER_ID,
          timeSpent: 3600000,
          title: 'Tracked Task',
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).toBeNull();
        expect(taskServiceSpy.removeMultipleTasks).not.toHaveBeenCalled();
        expect(snackSpy.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            type: 'WARNING',
            actionStr: T.G.DELETE,
          }),
        );
      });

      it('should NOT treat state as deleted when deletedStates is not set on provider', async () => {
        const provider = createMockProvider({
          getById: jasmine.createSpy('getById').and.resolveTo({
            id: 'ISS-5',
            title: 'Cancelled Event',
            state: 'cancelled',
            lastUpdated: 2000,
          } as PluginIssue),
        });
        registrySpy.getProvider.and.returnValue(provider);

        const task = {
          id: 'task-1',
          issueId: 'ISS-5',
          issueProviderId: PROVIDER_ID,
          issueLastUpdated: 1000,
          timeSpent: 0,
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).not.toBeNull();
        expect(taskServiceSpy.removeMultipleTasks).not.toHaveBeenCalled();
      });

      it('should match deletedStates case-insensitively and auto-delete (no time tracked)', async () => {
        const provider = createMockProvider({
          getById: jasmine.createSpy('getById').and.resolveTo({
            id: 'ISS-5',
            title: 'Cancelled Event',
            state: 'CANCELLED',
            lastUpdated: 2000,
          } as PluginIssue),
          deletedStates: ['cancelled'],
        });
        registrySpy.getProvider.and.returnValue(provider);

        const task = {
          id: 'task-1',
          issueId: 'ISS-5',
          issueProviderId: PROVIDER_ID,
          timeSpent: 0,
        } as unknown as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).toBeNull();
        expect(taskServiceSpy.removeMultipleTasks).toHaveBeenCalledWith(['task-1']);
        expect(snackSpy.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            type: 'CUSTOM',
            ico: 'delete_forever',
          }),
        );
      });

      it('should not delete task on non-HttpErrorResponse errors', async () => {
        const provider = createMockProvider({
          getById: jasmine
            .createSpy('getById')
            .and.rejectWith(new Error('Network error')),
        });
        registrySpy.getProvider.and.returnValue(provider);
        spyOn(console, 'error');

        const task = {
          id: 'task-1',
          issueId: 'ISS-5',
          issueProviderId: PROVIDER_ID,
        } as Task;

        const result = await service.getFreshDataForIssueTask(task);

        expect(result).toBeNull();
        expect(taskServiceSpy.removeMultipleTasks).not.toHaveBeenCalled();
      });
    });
  });

  describe('getFreshDataForIssueTasks', () => {
    it('should aggregate results for multiple tasks', async () => {
      const freshIssue: PluginIssue = {
        id: 'ISS-1',
        title: 'Issue One',
        lastUpdated: 5000,
      };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const tasks = [
        { id: 'task-1', issueId: 'ISS-1', issueProviderId: PROVIDER_ID } as Task,
        { id: 'task-2', issueId: 'ISS-1', issueProviderId: PROVIDER_ID } as Task,
      ];

      const result = await service.getFreshDataForIssueTasks(tasks);

      expect(result.length).toBe(2);
      expect(result[0].task.id).toBe('task-1');
      expect(result[1].task.id).toBe('task-2');
    });

    it('should skip tasks that return null from getFreshDataForIssueTask', async () => {
      const freshIssue: PluginIssue = {
        id: 'ISS-1',
        title: 'Issue One',
        lastUpdated: 5000,
      };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const tasks = [
        { id: 'task-1', issueId: 'ISS-1', issueProviderId: PROVIDER_ID } as Task,
        { id: 'task-2' } as Task, // no issueProviderId - will return null
      ];

      const result = await service.getFreshDataForIssueTasks(tasks);

      expect(result.length).toBe(1);
      expect(result[0].task.id).toBe('task-1');
    });
  });

  describe('issueLink', () => {
    it('should delegate to getIssueLink on the definition', async () => {
      const provider = createMockProvider({
        getIssueLink: jasmine
          .createSpy('getIssueLink')
          .and.returnValue('https://tracker.example.com/ISS-7'),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.issueLink('ISS-7', PROVIDER_ID);

      expect(result).toBe('https://tracker.example.com/ISS-7');
      expect(provider.definition.getIssueLink).toHaveBeenCalledWith(
        'ISS-7',
        mockPluginConfig,
      );
    });

    it('should convert numeric issueId to string', async () => {
      const provider = createMockProvider({
        getIssueLink: jasmine
          .createSpy('getIssueLink')
          .and.returnValue('https://tracker.example.com/42'),
      });
      registrySpy.getProvider.and.returnValue(provider);

      await service.issueLink(42, PROVIDER_ID);

      expect(provider.definition.getIssueLink).toHaveBeenCalledWith(
        '42',
        mockPluginConfig,
      );
    });

    it('should return empty string when cfg is not found', async () => {
      storeSpy.select.and.returnValue(throwError(() => new Error('Not found')));

      const result = await service.issueLink('ISS-7', PROVIDER_ID);

      expect(result).toBe('');
    });

    it('should return empty string when provider is not registered', async () => {
      registrySpy.getProvider.and.returnValue(undefined);

      const result = await service.issueLink('ISS-7', PROVIDER_ID);

      expect(result).toBe('');
    });
  });

  describe('getNewIssuesToAddToBacklog', () => {
    it('should delegate to getNewIssuesForBacklog and filter existing ids', async () => {
      const backlogIssues: PluginSearchResult[] = [
        { id: 'ISS-1', title: 'New One' },
        { id: 'ISS-2', title: 'New Two' },
        { id: 'ISS-3', title: 'New Three' },
      ];
      const provider = createMockProvider({
        getNewIssuesForBacklog: jasmine
          .createSpy('getNewIssuesForBacklog')
          .and.resolveTo(backlogIssues),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.getNewIssuesToAddToBacklog!(PROVIDER_ID, ['ISS-2']);

      expect(result.length).toBe(2);
      expect(result.map((r) => (r as PluginSearchResult).id)).toEqual(['ISS-1', 'ISS-3']);
    });

    it('should return empty array when getNewIssuesForBacklog is not defined', async () => {
      const provider = createMockProvider();
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.getNewIssuesToAddToBacklog!(PROVIDER_ID, []);

      expect(result).toEqual([]);
    });

    it('should return empty array when provider is not registered', async () => {
      registrySpy.getProvider.and.returnValue(undefined);

      const result = await service.getNewIssuesToAddToBacklog!(PROVIDER_ID, []);

      expect(result).toEqual([]);
    });

    it('should return empty array when cfg is not found', async () => {
      storeSpy.select.and.returnValue(throwError(() => new Error('Not found')));

      const result = await service.getNewIssuesToAddToBacklog!(PROVIDER_ID, []);

      expect(result).toEqual([]);
    });
  });
});
