import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { FormlyModule } from '@ngx-formly/core';
import { of } from 'rxjs';
import { DialogSyncCfgComponent } from './dialog-sync-cfg.component';
import { SyncConfigService } from '../sync-config.service';
import { SyncWrapperService } from '../sync-wrapper.service';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { SyncConfig } from '../../../features/config/global-config.model';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';

describe('DialogSyncCfgComponent', () => {
  let component: DialogSyncCfgComponent;
  let fixture: ComponentFixture<DialogSyncCfgComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogSyncCfgComponent>>;
  let mockSyncConfigService: jasmine.SpyObj<SyncConfigService>;
  let mockSyncWrapperService: jasmine.SpyObj<SyncWrapperService>;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;

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

    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);

    TestBed.configureTestingModule({
      imports: [
        DialogSyncCfgComponent,
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
        { provide: SnackService, useValue: mockSnackService },
        { provide: MatDialog, useValue: mockMatDialog },
      ],
    });
    // Replace the Formly-based template with a minimal placeholder so we can
    // test the save() business logic without registering every Formly field type.
    TestBed.overrideComponent(DialogSyncCfgComponent, {
      set: { template: '' },
    });
    await TestBed.compileComponents();

    fixture = TestBed.createComponent(DialogSyncCfgComponent);
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

  describe('Nextcloud connection test', () => {
    it('uses loginName for auth while preserving file username in the DAV URL', async () => {
      const testWebDavConnection = jasmine
        .createSpy('_testWebDavConnection')
        .and.resolveTo();
      (component as any)._testWebDavConnection = testWebDavConnection;

      await (component as any)._testNextcloudConnection({
        serverUrl: 'https://cloud.example.com',
        loginName: 'alice@example.com',
        userName: 'alice',
        password: 'app-password',
        syncFolderPath: 'super-productivity',
      });

      expect(testWebDavConnection).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({
          baseUrl: 'https://cloud.example.com/remote.php/dav/files/alice/',
          userName: 'alice@example.com',
          password: 'app-password',
          syncFolderPath: 'super-productivity',
        }),
        // The Nextcloud-specific 404 hint message — surfaced only when the
        // base-root probe 404s (auth ok, wrong DAV user id). See issue #7617.
        T.F.SYNC.FORM.NEXTCLOUD.S_TEST_FAIL_USER_NOT_FOUND,
      );
    });

    it('shows the Nextcloud user-not-found hint on a 404, generic failure otherwise', async () => {
      const webDavCfg = {
        baseUrl: 'https://cloud.example.com/remote.php/dav/files/alice/',
        userName: 'alice',
        password: 'app-password',
        syncFolderPath: 'super-productivity',
      } as any;

      // 404: auth succeeded but the DAV path /files/<userName>/ is wrong.
      mockSnackService.open.calls.reset();
      await (component as any)._reportWebdavTestResult(
        { success: false, errorCode: 404, fullUrl: webDavCfg.baseUrl, error: 'x' },
        T.F.SYNC.FORM.NEXTCLOUD.S_TEST_FAIL_USER_NOT_FOUND,
      );
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          msg: T.F.SYNC.FORM.NEXTCLOUD.S_TEST_FAIL_USER_NOT_FOUND,
        }),
      );

      // non-404 falls back to the generic message even with a hint provided.
      mockSnackService.open.calls.reset();
      await (component as any)._reportWebdavTestResult(
        { success: false, errorCode: 401, fullUrl: webDavCfg.baseUrl, error: 'auth' },
        T.F.SYNC.FORM.NEXTCLOUD.S_TEST_FAIL_USER_NOT_FOUND,
      );
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ msg: T.F.SYNC.FORM.WEB_DAV.S_TEST_FAIL }),
      );
    });
  });

  describe('Nextcloud detect user ID (#7617)', () => {
    it('asks for the login/password before calling the server', async () => {
      await (component as any)._detectNextcloudUserId({
        serverUrl: '',
        loginName: '',
        userName: '',
        password: '',
      });
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          msg: T.F.SYNC.FORM.NEXTCLOUD.S_DETECT_USER_ID_NEED_LOGIN,
        }),
      );
    });

    const buildNextcloudForm = (userName: string, loginName: string): void => {
      component.form = new FormGroup({
        nextcloud: new FormGroup({
          userName: new FormControl(userName),
          loginName: new FormControl(loginName),
        }),
      }) as any;
    };
    const valueOf = (key: string): unknown =>
      (component.form.get(`nextcloud.${key}`) as FormControl | null)?.value;

    it('fills the Username field with the detected user ID and confirms', () => {
      buildNextcloudForm('janedoe', 'jane@example.com');

      (component as any)._applyDetectedUserIdResult({ success: true, userId: 'janedoe' });

      expect(valueOf('userName')).toBe('janedoe');
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'SUCCESS',
          msg: T.F.SYNC.FORM.NEXTCLOUD.S_DETECT_USER_ID_SUCCESS,
          translateParams: { userId: 'janedoe' },
        }),
      );
    });

    it('preserves the typed login: moves it to Login name when Login name was empty', () => {
      // User put their email in "Username" (which authenticated) and left
      // "Login name" empty — keep the email as login so auth still works.
      buildNextcloudForm('jane@example.com', '');

      (component as any)._applyDetectedUserIdResult({ success: true, userId: 'janedoe' });

      expect(valueOf('userName')).toBe('janedoe');
      expect(valueOf('loginName')).toBe('jane@example.com');
    });

    it('does not overwrite an existing Login name', () => {
      buildNextcloudForm('', 'jane@example.com');

      (component as any)._applyDetectedUserIdResult({ success: true, userId: 'janedoe' });

      expect(valueOf('userName')).toBe('janedoe');
      expect(valueOf('loginName')).toBe('jane@example.com');
    });

    it('leaves Login name empty when Username already equals the detected ID', () => {
      buildNextcloudForm('janedoe', '');

      (component as any)._applyDetectedUserIdResult({ success: true, userId: 'janedoe' });

      expect(valueOf('userName')).toBe('janedoe');
      expect(valueOf('loginName')).toBe('');
    });

    it('surfaces the failure message (e.g. a 401) without touching the form', () => {
      component.form = new FormGroup({
        nextcloud: new FormGroup({ userName: new FormControl('keep-me') }),
      }) as any;

      (component as any)._applyDetectedUserIdResult({
        success: false,
        error: 'Authentication failed (HTTP 401).',
      });

      expect(
        (component.form.get('nextcloud.userName') as FormControl | null)?.value,
      ).toBe('keep-me');
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.SYNC.FORM.NEXTCLOUD.S_DETECT_USER_ID_FAIL,
          translateParams: { error: 'Authentication failed (HTTP 401).' },
        }),
      );
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
