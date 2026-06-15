import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { PluginBridgeService } from '../../plugin-bridge.service';
import { PluginCacheService } from '../../plugin-cache.service';
import { PluginConfigService } from '../../plugin-config.service';
import { PluginMetaPersistenceService } from '../../plugin-meta-persistence.service';
import { PluginManifest } from '../../plugin-api.model';
import { PluginService } from '../../plugin.service';
import { PluginManagementComponent } from './plugin-management.component';

type PluginManifestWithAuthor = PluginManifest & { author?: string };

describe('PluginManagementComponent', () => {
  let component: PluginManagementComponent;

  beforeEach(() => {
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
});
