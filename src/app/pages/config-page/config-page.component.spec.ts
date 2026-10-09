import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfigPageComponent } from './config-page.component';
import { SyncConfigService } from '../../imex/sync/sync-config.service';
import { SnackService } from '../../core/snack/snack.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { NEW_INSTALL_APP_FEATURES } from '../../features/config/new-install-app-features.const';
import {
  AppFeaturesConfig,
  ConfigFormSection,
} from '../../features/config/global-config.model';
import { ActivatedRoute } from '@angular/router';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { EMPTY, of } from 'rxjs';
import { signal } from '@angular/core';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { ShareService } from '../../core/share/share.service';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { LocalBackupService } from '../../imex/local-backup/local-backup.service';
import { IS_ANDROID_WEB_VIEW_TOKEN } from '../../util/is-android-web-view';
import { T } from '../../t.const';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ConfigSectionComponent } from '../../features/config/config-section/config-section.component';
import { CollapsibleComponent } from '../../ui/collapsible/collapsible.component';
import { WorkContextService } from '../../features/work-context/work-context.service';

describe('ConfigPageComponent', () => {
  let component: ConfigPageComponent;
  let fixture: ComponentFixture<ConfigPageComponent>;
  let mockSyncWrapperService: jasmine.SpyObj<SyncWrapperService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockLocalBackupService: jasmine.SpyObj<LocalBackupService>;

  const setup = async (
    isAndroidWebView: boolean = false,
    lastBackupTime: number | null = null,
    isRenderSections: boolean = false,
  ): Promise<void> => {
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
      'getLastBackupTime',
    ]);
    mockLocalBackupService.restoreLatestMobileBackupFromSettings.and.resolveTo();
    mockLocalBackupService.getLastBackupTime.and.returnValue(lastBackupTime);

    const mockTranslateService = jasmine.createSpyObj('TranslateService', ['instant']);
    // Mirror real ngx-translate: return the key (with params ignored) so the
    // "Last backup" line is a deterministic, non-empty string.
    mockTranslateService.instant.and.callFake((key: string) => key);
    mockTranslateService.onLangChange = EMPTY;

    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule],
      providers: [
        { provide: WorkContextService, useValue: { onWorkContextChange$: EMPTY } },
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
            appFeatures: signal(NEW_INSTALL_APP_FEATURES),
          }),
        },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: PluginBridgeService, useValue: { shortcuts: signal([]) } },
        { provide: SyncWrapperService, useValue: mockSyncWrapperService },
        { provide: ShareService, useValue: {} },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: LocalBackupService, useValue: mockLocalBackupService },
        {
          provide: TranslateService,
          useValue: mockTranslateService,
        },
      ],
    })
      .overrideComponent(ConfigPageComponent, {
        set: isRenderSections
          ? {
              imports: [ConfigSectionComponent],
              template: `
                @for (section of generalFormCfg; track section.key) {
                  <config-section
                    [isExpanded]="isSectionExpanded(section)"
                    (isExpandedChange)="onSectionExpandedChange(section, $event)"
                    [section]="section"
                  ></config-section>
                }
              `,
            }
          : { imports: [], template: '' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ConfigPageComponent);
    component = fixture.componentInstance;
  };

  beforeEach(async () => {
    await setup();
  });

  describe('saving App Features', () => {
    it('writes only the switches that changed', () => {
      const configService = TestBed.inject(
        GlobalConfigService,
      ) as jasmine.SpyObj<GlobalConfigService>;
      component.saveGlobalCfg({
        sectionKey: 'appFeatures',
        config: { ...NEW_INSTALL_APP_FEATURES, isBoardsEnabled: true },
      });
      expect(configService.updateSection).toHaveBeenCalledOnceWith('appFeatures', {
        isBoardsEnabled: true,
      } as Partial<AppFeaturesConfig>);
    });

    it('writes nothing when nothing changed', () => {
      const configService = TestBed.inject(
        GlobalConfigService,
      ) as jasmine.SpyObj<GlobalConfigService>;
      component.saveGlobalCfg({
        sectionKey: 'appFeatures',
        config: { ...NEW_INSTALL_APP_FEATURES },
      });
      expect(configService.updateSection).not.toHaveBeenCalled();
    });
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

  const findLastBackupLine = (): unknown => {
    const section = component.globalImexFormCfg.find((s) => s.key === 'localBackup');
    const items = (section?.items ?? []) as Array<{
      type?: string;
      templateOptions?: { text?: string };
    }>;
    return items.find(
      (i) =>
        i.type === 'tpl' &&
        i.templateOptions?.text === T.GCF.AUTO_BACKUPS.LAST_BACKUP_INFO,
    );
  };

  it('shows the "Last backup" line when a backup timestamp exists (#7901)', async () => {
    TestBed.resetTestingModule();
    await setup(true, 1_718_000_000_000);

    expect(mockLocalBackupService.getLastBackupTime).toHaveBeenCalled();
    expect(findLastBackupLine()).toBeTruthy();
  });

  it('omits the "Last backup" line when no backup has run yet', async () => {
    TestBed.resetTestingModule();
    await setup(true, null);

    expect(findLastBackupLine()).toBeUndefined();
  });

  describe('search result navigation', () => {
    const SECTION = {
      title: '',
      key: 'localization',
    } as ConfigFormSection<unknown>;
    const TARGET = {
      labelKey: T.GCF.LANG.LABEL,
      tabLabelKey: T.PS.TABS.GENERAL,
      tabIndex: 0,
      sectionKey: 'localization',
      scrollSelector: '.section-localization',
    };

    const getCollapsible = (): CollapsibleComponent =>
      fixture.debugElement.query(By.directive(CollapsibleComponent)).componentInstance;

    const collapseByHand = (): void => {
      fixture.nativeElement.querySelector('.collapsible-header').click();
      fixture.detectChanges();
    };

    beforeEach(async () => {
      TestBed.resetTestingModule();
      await setup(false, null, true);
      component.generalFormCfg = [SECTION] as typeof component.generalFormCfg;
      fixture.detectChanges();
    });

    it('expands the section of the selected result', () => {
      component.goToSearchResult(TARGET);

      expect(getCollapsible().isExpanded).toBe(true);
    });

    it('reopens a section collapsed by hand when its result is selected again (#9643)', () => {
      component.goToSearchResult(TARGET);
      collapseByHand();
      expect(getCollapsible().isExpanded).toBe(false);

      component.goToSearchResult(TARGET);

      expect(getCollapsible().isExpanded).toBe(true);
    });
  });
});
