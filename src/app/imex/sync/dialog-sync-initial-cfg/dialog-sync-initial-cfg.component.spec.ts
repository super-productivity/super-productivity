import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { FormlyModule } from '@ngx-formly/core';
import { of } from 'rxjs';
import { DialogSyncInitialCfgComponent } from './dialog-sync-initial-cfg.component';
import { SyncConfigService } from '../sync-config.service';
import { SyncWrapperService } from '../sync-wrapper.service';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { SyncConfig } from '../../../features/config/global-config.model';

describe('DialogSyncInitialCfgComponent', () => {
  let component: DialogSyncInitialCfgComponent;
  let fixture: ComponentFixture<DialogSyncInitialCfgComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogSyncInitialCfgComponent>>;
  let mockSyncConfigService: jasmine.SpyObj<SyncConfigService>;
  let mockSyncWrapperService: jasmine.SpyObj<SyncWrapperService>;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;

  const baseSyncConfig: SyncConfig = {
    isEnabled: false,
    syncProvider: null,
    syncInterval: 300000,
    encryptKey: '',
    isEncryptionEnabled: false,
    localFileSync: {} as any,
    webDav: {} as any,
    nextcloud: {} as any,
    superSync: {} as any,
  } as SyncConfig;

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    mockSyncConfigService = jasmine.createSpyObj('SyncConfigService', [
      'updateSettingsFromForm',
    ]);
    (mockSyncConfigService as any).syncSettingsForm$ = of(baseSyncConfig);
    mockSyncConfigService.updateSettingsFromForm.and.resolveTo();

    mockSyncWrapperService = jasmine.createSpyObj('SyncWrapperService', [
      'configuredAuthForSyncProviderIfNecessary',
      'sync',
    ]);
    mockSyncWrapperService.sync.and.resolveTo();

    mockProviderManager = jasmine.createSpyObj('SyncProviderManager', [
      'getProviderById',
    ]);

    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      sync$: of(baseSyncConfig),
    });

    TestBed.configureTestingModule({
      imports: [
        DialogSyncInitialCfgComponent,
        TranslateModule.forRoot(),
        FormlyModule.forRoot(),
      ],
      providers: [
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: SyncConfigService, useValue: mockSyncConfigService },
        { provide: SyncWrapperService, useValue: mockSyncWrapperService },
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
      ],
    });
    // Replace the Formly-based template with a minimal placeholder so we can
    // test the save() business logic without registering every Formly field type.
    TestBed.overrideComponent(DialogSyncInitialCfgComponent, {
      set: { template: '' },
    });
    await TestBed.compileComponents();

    fixture = TestBed.createComponent(DialogSyncInitialCfgComponent);
    component = fixture.componentInstance;
  });

  describe('save() — auth cancelled (reproduces issue #7131)', () => {
    it('should NOT close dialog when Dropbox auth is cancelled and provider is not ready', async () => {
      const providerNeedingAuth = {
        id: SyncProviderId.Dropbox,
        getAuthHelper: () => Promise.resolve({} as any),
        isReady: jasmine.createSpy('isReady').and.resolveTo(false),
      };
      mockProviderManager.getProviderById.and.resolveTo(providerNeedingAuth as any);
      mockSyncWrapperService.configuredAuthForSyncProviderIfNecessary.and.resolveTo({
        wasConfigured: false,
      });

      (component as any)._tmpUpdatedCfg = {
        ...(component as any)._tmpUpdatedCfg,
        syncProvider: SyncProviderId.Dropbox,
        isEnabled: true,
      };

      await component.save();

      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('should NOT save config when Dropbox auth is cancelled and provider is not ready', async () => {
      const providerNeedingAuth = {
        id: SyncProviderId.Dropbox,
        getAuthHelper: () => Promise.resolve({} as any),
        isReady: jasmine.createSpy('isReady').and.resolveTo(false),
      };
      mockProviderManager.getProviderById.and.resolveTo(providerNeedingAuth as any);
      mockSyncWrapperService.configuredAuthForSyncProviderIfNecessary.and.resolveTo({
        wasConfigured: false,
      });

      (component as any)._tmpUpdatedCfg = {
        ...(component as any)._tmpUpdatedCfg,
        syncProvider: SyncProviderId.Dropbox,
        isEnabled: true,
      };

      await component.save();

      expect(mockSyncConfigService.updateSettingsFromForm).not.toHaveBeenCalled();
    });

    it('should NOT trigger sync when auth is cancelled', async () => {
      const providerNeedingAuth = {
        id: SyncProviderId.Dropbox,
        getAuthHelper: () => Promise.resolve({} as any),
        isReady: jasmine.createSpy('isReady').and.resolveTo(false),
      };
      mockProviderManager.getProviderById.and.resolveTo(providerNeedingAuth as any);
      mockSyncWrapperService.configuredAuthForSyncProviderIfNecessary.and.resolveTo({
        wasConfigured: false,
      });

      (component as any)._tmpUpdatedCfg = {
        ...(component as any)._tmpUpdatedCfg,
        syncProvider: SyncProviderId.Dropbox,
        isEnabled: true,
      };

      await component.save();

      expect(mockSyncWrapperService.sync).not.toHaveBeenCalled();
    });
  });

  describe('save() — auth succeeds', () => {
    it('should close dialog and save config when Dropbox auth succeeds', async () => {
      const configuredProvider = {
        id: SyncProviderId.Dropbox,
        getAuthHelper: () => Promise.resolve({} as any),
        isReady: jasmine.createSpy('isReady').and.resolveTo(true),
      };
      mockProviderManager.getProviderById.and.resolveTo(configuredProvider as any);
      mockSyncWrapperService.configuredAuthForSyncProviderIfNecessary.and.resolveTo({
        wasConfigured: true,
      });

      (component as any)._tmpUpdatedCfg = {
        ...(component as any)._tmpUpdatedCfg,
        syncProvider: SyncProviderId.Dropbox,
        isEnabled: true,
      };

      await component.save();

      expect(mockSyncConfigService.updateSettingsFromForm).toHaveBeenCalled();
      expect(mockDialogRef.close).toHaveBeenCalled();
    });
  });

  describe('save() — provider without auth requirement', () => {
    it('should close dialog and save config for WebDAV (no getAuthHelper)', async () => {
      const webdavProvider = {
        id: SyncProviderId.WebDAV,
        // no getAuthHelper
        isReady: jasmine.createSpy('isReady').and.resolveTo(true),
      };
      mockProviderManager.getProviderById.and.resolveTo(webdavProvider as any);
      mockSyncWrapperService.configuredAuthForSyncProviderIfNecessary.and.resolveTo({
        wasConfigured: false,
      });

      (component as any)._tmpUpdatedCfg = {
        ...(component as any)._tmpUpdatedCfg,
        syncProvider: SyncProviderId.WebDAV,
        isEnabled: true,
      };

      await component.save();

      expect(mockSyncConfigService.updateSettingsFromForm).toHaveBeenCalled();
      expect(mockDialogRef.close).toHaveBeenCalled();
    });
  });

  describe('save() — already configured provider', () => {
    it('should close dialog when Dropbox is already configured (wasConfigured=false, isReady=true)', async () => {
      const alreadyConfigured = {
        id: SyncProviderId.Dropbox,
        getAuthHelper: () => Promise.resolve({} as any),
        isReady: jasmine.createSpy('isReady').and.resolveTo(true),
      };
      mockProviderManager.getProviderById.and.resolveTo(alreadyConfigured as any);
      mockSyncWrapperService.configuredAuthForSyncProviderIfNecessary.and.resolveTo({
        wasConfigured: false,
      });

      (component as any)._tmpUpdatedCfg = {
        ...(component as any)._tmpUpdatedCfg,
        syncProvider: SyncProviderId.Dropbox,
        isEnabled: true,
      };

      await component.save();

      expect(mockSyncConfigService.updateSettingsFromForm).toHaveBeenCalled();
      expect(mockDialogRef.close).toHaveBeenCalled();
    });
  });
});
