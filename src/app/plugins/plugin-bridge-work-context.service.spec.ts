import { TestBed } from '@angular/core/testing';
import { Injector, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { BehaviorSubject, of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { PluginBridgeService } from './plugin-bridge.service';
import { TaskService } from '../features/tasks/task.service';
import { ProjectService } from '../features/project/project.service';
import { TagService } from '../features/tag/tag.service';
import { WorkContextService } from '../features/work-context/work-context.service';
import { SnackService } from '../core/snack/snack.service';
import { NotifyService } from '../core/notify/notify.service';
import { PluginHooksService } from './plugin-hooks';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { PluginConfigService } from './plugin-config.service';
import { TaskArchiveService } from '../features/archive/task-archive.service';
import { SyncWrapperService } from '../imex/sync/sync-wrapper.service';
import { GlobalThemeService } from '../core/theme/global-theme.service';
import { PluginIssueProviderRegistryService } from './issue-provider/plugin-issue-provider-registry.service';
import { IssueSyncAdapterRegistryService } from '../features/issue/two-way-sync/issue-sync-adapter-registry.service';
import { PluginHttpService } from './issue-provider/plugin-http.service';
import { DataInitService } from '../core/data-init/data-init.service';
import { GlobalConfigService } from '../features/config/global-config.service';
import {
  WorkContext,
  WorkContextType,
} from '../features/work-context/work-context.model';
import { DEFAULT_GLOBAL_CONFIG } from '../features/config/default-global-config.const';
import { PluginManifest, PluginHooks } from './plugin-api.model';

// Covers the work-context plugin extension points introduced in commit
// e3ce1fcdd9: registerWorkContextHeaderButton (validation, filtering, cleanup)
// and the showInWorkContext / closeWorkContextView embed slot.
describe('PluginBridgeService.workContext — header buttons + embed slot', () => {
  const PLUGIN_A = 'plugin-a';
  const PLUGIN_B = 'plugin-b';

  const manifest = (id: string): PluginManifest => ({
    id,
    name: id,
    version: '1.0.0',
    manifestVersion: 1,
    minSupVersion: '1.0.0',
    description: 'spec',
    permissions: [],
    hooks: [PluginHooks.TASK_COMPLETE],
  });

  const projectCtx: WorkContext = {
    type: WorkContextType.PROJECT,
    id: 'project-1',
    title: 'Project',
    taskIds: [],
    backlogTaskIds: [],
    noteIds: [],
    theme: {} as WorkContext['theme'],
    advancedCfg: {} as WorkContext['advancedCfg'],
    routerLink: '/project/project-1',
    isEnableBacklog: true,
    icon: null,
  };
  const todayCtx: WorkContext = {
    ...projectCtx,
    type: WorkContextType.TAG,
    id: 'TODAY',
    routerLink: '/tag/TODAY',
  };
  const tagCtx: WorkContext = {
    ...projectCtx,
    type: WorkContextType.TAG,
    id: 'tag-1',
    routerLink: '/tag/tag-1',
  };

  const setup = (
    initialCtx: WorkContext | null = projectCtx,
  ): {
    service: PluginBridgeService;
    activeCtx$: BehaviorSubject<WorkContext | null>;
  } => {
    const activeCtx$ = new BehaviorSubject<WorkContext | null>(initialCtx);
    const workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [], {
      activeWorkContext$: activeCtx$.asObservable(),
    });

    const cfgSignal = signal({ ...DEFAULT_GLOBAL_CONFIG });
    const globalConfigSpy = {
      cfg: cfgSignal,
    } as unknown as GlobalConfigService;

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        {
          provide: Store,
          useValue: jasmine.createSpyObj('Store', ['select', 'dispatch']),
        },
        {
          provide: TaskService,
          useValue: jasmine.createSpyObj(
            'TaskService',
            ['createNewTaskWithDefaults', 'add'],
            { allTasks$: of([]) },
          ),
        },
        { provide: ProjectService, useValue: { list$: of([]) } },
        { provide: TagService, useValue: { tags$: of([]) } },
        { provide: WorkContextService, useValue: workContextServiceSpy },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: NotifyService,
          useValue: jasmine.createSpyObj('NotifyService', ['notify']),
        },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        {
          provide: PluginHooksService,
          useValue: jasmine.createSpyObj('PluginHooksService', [
            'registerHook',
            'unregisterPluginHooks',
          ]),
        },
        {
          provide: PluginUserPersistenceService,
          useValue: jasmine.createSpyObj('PluginUserPersistenceService', ['get', 'set']),
        },
        {
          provide: PluginConfigService,
          useValue: jasmine.createSpyObj('PluginConfigService', ['get', 'set']),
        },
        {
          provide: TaskArchiveService,
          useValue: jasmine.createSpyObj('TaskArchiveService', ['getAll']),
        },
        {
          provide: TranslateService,
          useValue: { instant: (key: string) => key },
        },
        {
          provide: SyncWrapperService,
          useValue: jasmine.createSpyObj('SyncWrapperService', ['sync']),
        },
        Injector,
        { provide: GlobalThemeService, useValue: {} },
        {
          provide: PluginIssueProviderRegistryService,
          useValue: jasmine.createSpyObj('PluginIssueProviderRegistryService', [
            'getRegisteredKey',
            'unregister',
          ]),
        },
        { provide: IssueSyncAdapterRegistryService, useValue: {} },
        { provide: PluginHttpService, useValue: {} },
        { provide: DataInitService, useValue: { reInit: () => Promise.resolve() } },
        { provide: GlobalConfigService, useValue: globalConfigSpy },
      ],
    });

    return { service: TestBed.inject(PluginBridgeService), activeCtx$ };
  };

  describe('registerWorkContextHeaderButton — validation', () => {
    it('throws when label is missing', () => {
      const { service } = setup();
      const api = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      expect(() =>
        api.registerWorkContextHeaderButton({
          onClick: () => {},
          showFor: ['PROJECT'],
        } as unknown as Parameters<typeof api.registerWorkContextHeaderButton>[0]),
      ).toThrowError(/requires label/);
    });

    it('throws when onClick is missing', () => {
      const { service } = setup();
      const api = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      expect(() =>
        api.registerWorkContextHeaderButton({
          label: 'X',
          showFor: ['PROJECT'],
        } as unknown as Parameters<typeof api.registerWorkContextHeaderButton>[0]),
      ).toThrowError(/requires onClick/);
    });

    it('throws when showFor is empty', () => {
      const { service } = setup();
      const api = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      expect(() =>
        api.registerWorkContextHeaderButton({
          label: 'X',
          onClick: () => {},
          showFor: [],
        }),
      ).toThrowError(/non-empty showFor/);
    });

    it('replaces an existing (pluginId, label) entry on re-registration', () => {
      // Iframe reloads produce a new onClick pointing at a new Window. The
      // bridge must swap the entry so clicks reach the live iframe.
      const { service } = setup();
      const api = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      const first = jasmine.createSpy('first');
      const second = jasmine.createSpy('second');
      api.registerWorkContextHeaderButton({
        label: 'Dup',
        onClick: first,
        showFor: ['PROJECT'],
      });
      api.registerWorkContextHeaderButton({
        label: 'Dup',
        onClick: second,
        showFor: ['PROJECT'],
      });
      const btns = service.workContextHeaderButtons();
      expect(btns.length).toBe(1);
      expect(btns[0].onClick).toBe(second);
    });

    it('rejects showFor entries outside PROJECT|TAG|TODAY', () => {
      const { service } = setup();
      const api = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      expect(() =>
        api.registerWorkContextHeaderButton({
          label: 'Bad',
          onClick: () => {},
          showFor: ['PROJECT', 'FOOBAR' as unknown as 'PROJECT'],
        }),
      ).toThrowError(/showFor contains invalid value/);
    });
  });

  describe('workContextHeaderButtons — context filtering', () => {
    it('shows a PROJECT-scoped button in a project context', () => {
      const { service } = setup(projectCtx);
      const api = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      api.registerWorkContextHeaderButton({
        label: 'Doc',
        onClick: () => {},
        showFor: ['PROJECT'],
      });
      expect(service.workContextHeaderButtons().map((b) => b.label)).toEqual(['Doc']);
    });

    it('hides a TAG-only button when the context is a project', () => {
      const { service } = setup(projectCtx);
      const api = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      api.registerWorkContextHeaderButton({
        label: 'TagOnly',
        onClick: () => {},
        showFor: ['TAG'],
      });
      expect(service.workContextHeaderButtons()).toEqual([]);
    });

    it('treats TODAY as a distinct bucket — TAG entries do not match', () => {
      const { service, activeCtx$ } = setup(projectCtx);
      const api = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      api.registerWorkContextHeaderButton({
        label: 'TodayOnly',
        onClick: () => {},
        showFor: ['TODAY'],
      });
      api.registerWorkContextHeaderButton({
        label: 'TagOnly',
        onClick: () => {},
        showFor: ['TAG'],
      });

      activeCtx$.next(todayCtx);
      TestBed.flushEffects();
      expect(service.workContextHeaderButtons().map((b) => b.label)).toEqual([
        'TodayOnly',
      ]);

      activeCtx$.next(tagCtx);
      TestBed.flushEffects();
      expect(service.workContextHeaderButtons().map((b) => b.label)).toEqual(['TagOnly']);
    });

    it('returns [] when no active work context is set', () => {
      const { service } = setup(null);
      const api = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      api.registerWorkContextHeaderButton({
        label: 'Anywhere',
        onClick: () => {},
        showFor: ['PROJECT', 'TAG', 'TODAY'],
      });
      expect(service.workContextHeaderButtons()).toEqual([]);
    });
  });

  describe('work-view embed slot', () => {
    it('showInWorkContext sets the embedded pluginId signal', () => {
      const { service } = setup();
      const api = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      expect(service.workContextEmbedPluginId()).toBeNull();
      api.showInWorkContext();
      expect(service.workContextEmbedPluginId()).toBe(PLUGIN_A);
    });

    it('closeWorkContextView clears the slot when called by the owner', () => {
      const { service } = setup();
      const apiA = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      apiA.showInWorkContext();
      apiA.closeWorkContextView();
      expect(service.workContextEmbedPluginId()).toBeNull();
    });

    it('closeWorkContextView is a no-op when called by a different plugin', () => {
      const { service } = setup();
      const apiA = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      const apiB = service.createBoundMethods(PLUGIN_B, manifest(PLUGIN_B));
      apiA.showInWorkContext();
      apiB.closeWorkContextView();
      expect(service.workContextEmbedPluginId()).toBe(PLUGIN_A);
    });
  });

  describe('unregisterPluginHooks cleanup', () => {
    it('removes header buttons + clears embed slot owned by the unloaded plugin', () => {
      const { service } = setup();
      const apiA = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      const apiB = service.createBoundMethods(PLUGIN_B, manifest(PLUGIN_B));
      apiA.registerWorkContextHeaderButton({
        label: 'A1',
        onClick: () => {},
        showFor: ['PROJECT'],
      });
      apiB.registerWorkContextHeaderButton({
        label: 'B1',
        onClick: () => {},
        showFor: ['PROJECT'],
      });
      apiA.showInWorkContext();
      expect(service.workContextEmbedPluginId()).toBe(PLUGIN_A);
      expect(service.workContextHeaderButtons().length).toBe(2);

      service.unregisterPluginHooks(PLUGIN_A);

      expect(service.workContextEmbedPluginId()).toBeNull();
      const remaining = service.workContextHeaderButtons();
      expect(remaining.length).toBe(1);
      expect(remaining[0].pluginId).toBe(PLUGIN_B);
    });

    it('keeps the embed slot when a non-owning plugin unloads', () => {
      const { service } = setup();
      const apiA = service.createBoundMethods(PLUGIN_A, manifest(PLUGIN_A));
      const apiB = service.createBoundMethods(PLUGIN_B, manifest(PLUGIN_B));
      apiA.showInWorkContext();
      void apiB;
      service.unregisterPluginHooks(PLUGIN_B);
      expect(service.workContextEmbedPluginId()).toBe(PLUGIN_A);
    });
  });

  describe('getActiveWorkContext', () => {
    it('returns a defensive copy of taskIds, not the live store array', async () => {
      // The ActiveWorkContext type promises taskIds is a safe snapshot. A
      // plugin mutating it must not corrupt NgRx state.
      const liveTaskIds = ['task-1', 'task-2'];
      const { service } = setup({ ...projectCtx, taskIds: liveTaskIds });

      const result = await service.getActiveWorkContext();

      expect(result).not.toBeNull();
      expect(result!.taskIds).toEqual(liveTaskIds);
      expect(result!.taskIds).not.toBe(liveTaskIds);
      result!.taskIds.push('task-3');
      expect(liveTaskIds).toEqual(['task-1', 'task-2']);
    });

    it("reports type 'TODAY' for the Today context", async () => {
      // The Today tag is a TAG internally but is surfaced to plugins as its
      // own type, matching registerWorkContextHeaderButton's showFor values.
      const { service } = setup(todayCtx);

      const result = await service.getActiveWorkContext();

      expect(result?.id).toBe('TODAY');
      expect(result?.type).toBe('TODAY');
    });

    it("reports type 'PROJECT' for a project context", async () => {
      const { service } = setup(projectCtx);

      const result = await service.getActiveWorkContext();

      expect(result?.type).toBe('PROJECT');
    });
  });
});
