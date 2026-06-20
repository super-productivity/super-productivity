import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PluginBridgeService } from './plugin-bridge.service';
import { SnackService } from '../core/snack/snack.service';
import { NotifyService } from '../core/notify/notify.service';
import { MatDialog } from '@angular/material/dialog';
import { provideMockStore } from '@ngrx/store/testing';
import { PluginHooksService } from './plugin-hooks';
import { TaskService } from '../features/tasks/task.service';
import { TaskFocusService } from '../features/tasks/task-focus.service';
import { WorkContextService } from '../features/work-context/work-context.service';
import { ProjectService } from '../features/project/project.service';
import { TagService } from '../features/tag/tag.service';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { PluginConfigService } from './plugin-config.service';
import { TaskArchiveService } from '../features/archive/task-archive.service';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { SyncWrapperService } from '../imex/sync/sync-wrapper.service';
import { GlobalThemeService } from '../core/theme/global-theme.service';
import { PluginIssueProviderRegistryService } from './issue-provider/plugin-issue-provider-registry.service';
import { IssueSyncAdapterRegistryService } from '../features/issue/two-way-sync/issue-sync-adapter-registry.service';
import { PluginHttpService } from './issue-provider/plugin-http.service';
import { DataInitService } from '../core/data-init/data-init.service';

describe('PluginBridgeService issue provider icon registration', () => {
  let service: PluginBridgeService;
  let themeService: jasmine.SpyObj<GlobalThemeService>;
  let registry: jasmine.SpyObj<PluginIssueProviderRegistryService>;

  const manifest = {
    id: 'basecamp-issue-provider',
    name: 'Basecamp',
    version: '1.0.0',
    manifestVersion: 1,
    minSupVersion: '13.0.0',
    type: 'issueProvider',
    permissions: [],
    hooks: [],
    issueProvider: {
      icon: 'basecamp',
      humanReadableName: 'Basecamp',
      issueStrings: { singular: 'To-do', plural: 'To-dos' },
      pollIntervalMs: 600000,
    },
  } as any;

  const definition = {
    getHeaders: async () => ({}),
    searchIssues: async () => [],
    getById: async () => ({
      id: '1',
      title: 'Todo',
      state: 'open',
      body: '',
      url: 'https://example.com',
      lastUpdated: Date.now(),
    }),
    getIssueLink: () => 'https://example.com',
    issueDisplay: [],
    configFields: [],
  } as any;

  beforeEach(() => {
    themeService = jasmine.createSpyObj<GlobalThemeService>('GlobalThemeService', [
      'hasPluginIcon',
    ]);
    registry = jasmine.createSpyObj<PluginIssueProviderRegistryService>(
      'PluginIssueProviderRegistryService',
      ['register', 'getRegisteredKey', 'getProvider', 'unregister'],
    );
    registry.getRegisteredKey.and.returnValue('plugin:basecamp-issue-provider');
    registry.getProvider.and.returnValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        provideMockStore(),
        { provide: SnackService, useValue: {} },
        { provide: NotifyService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        {
          provide: PluginHooksService,
          useValue: jasmine.createSpyObj('PluginHooksService', ['unregisterPluginHooks']),
        },
        { provide: TaskService, useValue: {} },
        { provide: TaskFocusService, useValue: {} },
        { provide: WorkContextService, useValue: { activeWorkContext$: of(null) } },
        { provide: ProjectService, useValue: {} },
        { provide: TagService, useValue: {} },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: PluginConfigService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: TranslateService, useValue: {} },
        { provide: SyncWrapperService, useValue: {} },
        { provide: GlobalThemeService, useValue: themeService },
        { provide: PluginIssueProviderRegistryService, useValue: registry },
        {
          provide: IssueSyncAdapterRegistryService,
          useValue: jasmine.createSpyObj('IssueSyncAdapterRegistryService', [
            'register',
            'unregister',
          ]),
        },
        { provide: PluginHttpService, useValue: {} },
        {
          provide: DataInitService,
          useValue: jasmine.createSpyObj('DataInitService', ['reInit']),
        },
      ],
    });

    service = TestBed.inject(PluginBridgeService);
  });

  it('prefers the manifest issueProvider icon over the generated plugin icon name', () => {
    themeService.hasPluginIcon.and.returnValue(true);

    service
      .createBoundMethods('basecamp-issue-provider', manifest)
      .registerIssueProvider(definition);

    expect(registry.register).toHaveBeenCalled();
    expect(registry.register.calls.mostRecent().args[0].icon).toBe('basecamp');
  });

  it('falls back to the generated plugin icon when the manifest does not declare one', () => {
    themeService.hasPluginIcon.and.returnValue(true);
    const manifestWithoutIcon = {
      ...manifest,
      issueProvider: { ...manifest.issueProvider, icon: undefined },
    } as any;

    service
      .createBoundMethods('basecamp-issue-provider', manifestWithoutIcon)
      .registerIssueProvider(definition);

    expect(registry.register.calls.mostRecent().args[0].icon).toBe(
      'plugin-basecamp-issue-provider-icon',
    );
  });
});
