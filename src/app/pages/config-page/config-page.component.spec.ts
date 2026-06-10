import { TestBed } from '@angular/core/testing';
import { ConfigPageComponent } from './config-page.component';
import { SyncConfigService } from '../../imex/sync/sync-config.service';
import { SnackService } from '../../core/snack/snack.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { ActivatedRoute } from '@angular/router';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { ShareService } from '../../core/share/share.service';
import { UserProfileService } from '../../features/user-profile/user-profile.service';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { LocalBackupService } from '../../imex/local-backup/local-backup.service';
import { IS_ANDROID_WEB_VIEW_TOKEN } from '../../util/is-android-web-view';
import { T } from '../../t.const';

describe('ConfigPageComponent', () => {
  let component: ConfigPageComponent;
  let mockSyncWrapperService: jasmine.SpyObj<SyncWrapperService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockLocalBackupService: jasmine.SpyObj<LocalBackupService>;

  const setup = async (isAndroidWebView: boolean = false): Promise<void> => {
    const mockSyncConfigService = jasmine.createSpyObj(
      'SyncConfigService',
      ['updateSettingsFromForm'],
      { syncSettingsForm$: of({}) },
    );
    mockSyncConfigService.updateSettingsFromForm.and.returnValue(Promise.resolve());

    mockSyncWrapperService = jasmine.createSpyObj('SyncWrapperService', ['sync']);
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockProviderManager = jasmine.createSpyObj(
      'SyncProviderManager',
      ['getProviderById'],
      {
        currentProviderPrivateCfg$: of(null),
      },
    );
    mockProviderManager.getProviderById.and.returnValue(Promise.resolve(undefined));
    mockLocalBackupService = jasmine.createSpyObj('LocalBackupService', [
      'restoreLatestMobileBackupFromSettings',
    ]);
    mockLocalBackupService.restoreLatestMobileBackupFromSettings.and.resolveTo();

    await TestBed.configureTestingModule({
      providers: [
        { provide: SyncConfigService, useValue: mockSyncConfigService },
        { provide: IS_ANDROID_WEB_VIEW_TOKEN, useValue: isAndroidWebView },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        { provide: SyncProviderManager, useValue: mockProviderManager },
        {
          provide: GlobalConfigService,
          useValue: jasmine.createSpyObj('GlobalConfigService', ['updateSection'], {
            cfg$: of({}),
            sync$: of({}),
          }),
        },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: PluginBridgeService, useValue: { shortcuts: signal([]) } },
        { provide: SyncWrapperService, useValue: mockSyncWrapperService },
        { provide: ShareService, useValue: {} },
        { provide: UserProfileService, useValue: {} },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: LocalBackupService, useValue: mockLocalBackupService },
        {
          provide: TranslateService,
          useValue: jasmine.createSpyObj('TranslateService', ['instant']),
        },
      ],
    })
      .overrideComponent(ConfigPageComponent, {
        set: { imports: [], template: '' },
      })
      .compileComponents();

    component = TestBed.createComponent(ConfigPageComponent).componentInstance;
  };

  beforeEach(async () => {
    await setup();
  });

  it('should expose an empty syncStatus by default', () => {
    expect(component.syncStatus().providerId).toBeNull();
    expect(component.syncStatus().needsAuth).toBe(false);
  });

  it('triggerSync() should call SyncWrapperService.sync()', () => {
    component.triggerSync();
    expect(mockSyncWrapperService.sync).toHaveBeenCalled();
  });

  it('openSyncCfgDialog() should open DialogSyncCfgComponent', async () => {
    await component.openSyncCfgDialog();
    expect(mockMatDialog.open).toHaveBeenCalled();
  });

  it('should expose Android automatic backup restore action', async () => {
    TestBed.resetTestingModule();
    await setup(true);

    const automaticBackupsSection = component.globalImexFormCfg.find(
      (section) => section.key === 'localBackup',
    );
    const action = automaticBackupsSection?.actions?.[0];

    expect(action?.label).toBe(T.GCF.AUTO_BACKUPS.RESTORE_LATEST);

    await action?.onClick();

    expect(
      mockLocalBackupService.restoreLatestMobileBackupFromSettings,
    ).toHaveBeenCalled();
  });
});
