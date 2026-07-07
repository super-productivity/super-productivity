import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { PluginBridgeService } from '../../plugin-bridge.service';
import { PluginCacheService } from '../../plugin-cache.service';
import { PluginConfigService } from '../../plugin-config.service';
import { PluginMetaPersistenceService } from '../../plugin-meta-persistence.service';
import { PluginManifest, PluginHooks } from '../../plugin-api.model';
import { PluginService } from '../../plugin.service';
import { PluginManagementComponent } from './plugin-management.component';

type PluginManifestWithAuthor = PluginManifest & { author?: string };

describe('PluginManagementComponent', () => {
  let component: PluginManagementComponent;
  let routerNavigateSpy: jasmine.Spy;
  let layoutToggleSpy: jasmine.Spy;
  let isShowIssuePanel: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    routerNavigateSpy = jasmine
      .createSpy('navigate')
      .and.returnValue(Promise.resolve(true));
    layoutToggleSpy = jasmine.createSpy('toggleAddTaskPanel');
    isShowIssuePanel = signal(false);
    TestBed.configureTestingModule({
      imports: [PluginManagementComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: PluginService,
          useValue: {
            pluginStates: signal(new Map()),
          },
        },
        {
          provide: PluginMetaPersistenceService,
          useValue: {},
        },
        {
          provide: PluginCacheService,
          useValue: {},
        },
        {
          provide: PluginConfigService,
          useValue: {},
        },
        {
          provide: GlobalConfigService,
          useValue: { localization: signal({ lng: 'en' }) },
        },
        {
          provide: MatDialog,
          useValue: {},
        },
        {
          provide: Router,
          useValue: { navigate: routerNavigateSpy },
        },
        {
          provide: LayoutService,
          useValue: { isShowIssuePanel, toggleAddTaskPanel: layoutToggleSpy },
        },
        {
          provide: Store,
          useValue: { selectSignal: () => signal([]) },
        },
        {
          provide: PluginBridgeService,
          useValue: {},
        },
      ],
    });

    component = TestBed.createComponent(PluginManagementComponent).componentInstance;
  });

  it('returns trimmed plugin author from the manifest', () => {
    const manifest: PluginManifestWithAuthor = {
      id: 'test-plugin',
      name: 'Test Plugin',
      manifestVersion: 1,
      version: '1.0.0',
      minSupVersion: '1.0.0',
      hooks: [],
      permissions: [],
      author: '  Super Productivity  ',
    };

    expect(
      component.getPluginAuthor({
        manifest,
        loaded: false,
        isEnabled: false,
      }),
    ).toBe('Super Productivity');
  });

  it('hides missing or blank plugin authors', () => {
    const manifest: PluginManifestWithAuthor = {
      id: 'test-plugin',
      name: 'Test Plugin',
      manifestVersion: 1,
      version: '1.0.0',
      minSupVersion: '1.0.0',
      hooks: [],
      permissions: [],
    };
    const blankAuthorManifest: PluginManifestWithAuthor = {
      ...manifest,
      author: '   ',
    };

    expect(
      component.getPluginAuthor({
        manifest,
        loaded: false,
        isEnabled: false,
      }),
    ).toBeNull();

    expect(
      component.getPluginAuthor({
        manifest: blankAuthorManifest,
        loaded: false,
        isEnabled: false,
      }),
    ).toBeNull();
  });

  const baseManifest: PluginManifest = {
    id: 'github-issue-provider',
    name: 'GitHub Issues',
    manifestVersion: 1,
    version: '1.0.0',
    minSupVersion: '1.0.0',
    hooks: [],
    permissions: [],
  };

  it('detects issue-provider plugins', () => {
    expect(
      component.isIssueProviderPlugin({
        manifest: { ...baseManifest, type: 'issueProvider' },
        loaded: true,
        isEnabled: true,
      }),
    ).toBe(true);

    expect(
      component.isIssueProviderPlugin({
        manifest: { ...baseManifest, type: 'standard' },
        loaded: true,
        isEnabled: true,
      }),
    ).toBe(false);
  });

  it('surfaces allowedHosts (with count) only when the "http" capability is declared', () => {
    const plugin = {
      manifest: {
        ...baseManifest,
        permissions: ['http'],
        allowedHosts: ['api.example.com', 'auth.example.com'],
        hooks: [PluginHooks.TASK_COMPLETE],
      },
      loaded: true,
      isEnabled: true,
    };

    expect(component.getNetworkReachHosts(plugin)).toEqual([
      'api.example.com',
      'auth.example.com',
    ]);
    // instant() echoes the key here (no translations loaded); the allowedHosts part
    // appears with its count, between permissions and hooks.
    expect(component.getPermissionsHooksTitle(plugin)).toBe(
      'PLUGINS.PERMISSIONS (1) / PLUGINS.ALLOWED_HOSTS (2) / PLUGINS.HOOKS (1)',
    );
  });

  it('hides allowedHosts when the plugin lacks the "http" capability (bridge would reject request)', () => {
    const plugin = {
      manifest: {
        ...baseManifest,
        permissions: ['nodeExecution'],
        allowedHosts: ['api.example.com', 'auth.example.com'],
        hooks: [PluginHooks.TASK_COMPLETE],
      },
      loaded: true,
      isEnabled: true,
    };

    expect(component.getNetworkReachHosts(plugin)).toEqual([]);
    // No "ALLOWED_HOSTS" segment — network reach is not advertised without "http".
    expect(component.getPermissionsHooksTitle(plugin)).toBe(
      'PLUGINS.PERMISSIONS (1) / PLUGINS.HOOKS (1)',
    );
  });

  it('omits allowedHosts from the title when none are declared', () => {
    const title = component.getPermissionsHooksTitle({
      manifest: { ...baseManifest, hooks: [PluginHooks.TASK_COMPLETE] },
      loaded: true,
      isEnabled: true,
    });

    expect(title).toBe('PLUGINS.HOOKS (1)');
  });

  it('navigates to the work view and opens the issue panel', async () => {
    await component.goToIssuePanel();

    expect(routerNavigateSpy).toHaveBeenCalledWith(['/active/tasks']);
    expect(layoutToggleSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-toggle the panel when it is already open', async () => {
    isShowIssuePanel.set(true);

    await component.goToIssuePanel();

    expect(routerNavigateSpy).toHaveBeenCalledWith(['/active/tasks']);
    expect(layoutToggleSpy).not.toHaveBeenCalled();
  });
});
