import { TestBed } from '@angular/core/testing';
import { ConfigPageComponent } from './config-page.component';
import { SyncConfigService } from '../../imex/sync/sync-config.service';
import { SnackService } from '../../core/snack/snack.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { ActivatedRoute } from '@angular/router';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { WebdavApi } from '../../op-log/sync-providers/file-based/webdav/webdav-api';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { ShareService } from '../../core/share/share.service';
import { UserProfileService } from '../../features/user-profile/user-profile.service';
import { MatDialog } from '@angular/material/dialog';
import { LegacySyncProvider } from '../../imex/sync/legacy-sync-provider.model';

describe('ConfigPageComponent', () => {
  let component: ConfigPageComponent;
  let mockSyncConfigService: jasmine.SpyObj<SyncConfigService>;

  beforeEach(async () => {
    mockSyncConfigService = jasmine.createSpyObj(
      'SyncConfigService',
      ['updateSettingsFromForm'],
      { syncSettingsForm$: of({}) },
    );
    mockSyncConfigService.updateSettingsFromForm.and.returnValue(Promise.resolve());

    await TestBed.configureTestingModule({
      providers: [
        { provide: SyncConfigService, useValue: mockSyncConfigService },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: SyncProviderManager,
          useValue: jasmine.createSpyObj('SyncProviderManager', ['getProviderById'], {
            currentProviderPrivateCfg$: of(null),
          }),
        },
        {
          provide: GlobalConfigService,
          useValue: jasmine.createSpyObj('GlobalConfigService', ['updateSection'], {
            cfg$: of({}),
            sync$: of({}),
          }),
        },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: PluginBridgeService, useValue: { shortcuts: signal([]) } },
        { provide: SyncWrapperService, useValue: {} },
        { provide: ShareService, useValue: {} },
        { provide: UserProfileService, useValue: {} },
        {
          provide: MatDialog,
          useValue: jasmine.createSpyObj('MatDialog', ['open']),
        },
      ],
    })
      .overrideComponent(ConfigPageComponent, {
        set: { imports: [], template: '' },
      })
      .compileComponents();

    component = TestBed.createComponent(ConfigPageComponent).componentInstance;
  });

  describe('WebDAV Test Connection button', () => {
    it('should save settings after successful connection test', async () => {
      // Arrange
      spyOn(WebdavApi.prototype, 'testConnection').and.returnValue(
        Promise.resolve({
          success: true,
          fullUrl: 'https://webdav.example.com/sp-test',
        }),
      );
      spyOn(WebdavApi.prototype, 'testConditionalHeaders').and.returnValue(
        Promise.resolve(true),
      );

      const webDavCfg = {
        baseUrl: 'https://webdav.example.com',
        userName: 'testuser',
        password: 'testpass',
        syncFolderPath: '/sp-test',
      };

      const fullSyncModel = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.WebDAV,
        syncInterval: 600000,
        webDav: webDavCfg,
      };

      const mockField = {
        parent: { parent: { model: fullSyncModel } },
      };

      // Find the WebDAV Test Connection button onClick handler
      const webDavItem = component.globalSyncConfigFormCfg.items!.find(
        (item: any) => item.key === 'webDav',
      );
      const testConnectionBtn = webDavItem!.fieldGroup!.find(
        (item: any) => item.type === 'btn',
      );
      const onClick = testConnectionBtn!.templateOptions!.onClick;

      // Act
      await onClick(mockField, {}, webDavCfg);

      // Assert
      expect(mockSyncConfigService.updateSettingsFromForm).toHaveBeenCalledWith(
        fullSyncModel,
        true,
      );
    });
  });
});
