import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  effect,
  inject,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { GlobalConfigService } from '../../features/config/global-config.service';
import {
  GLOBAL_GENERAL_FORM_CONFIG,
  GLOBAL_IMEX_FORM_CONFIG,
  GLOBAL_PLUGINS_FORM_CONFIG,
  GLOBAL_PRODUCTIVITY_FORM_CONFIG,
  GLOBAL_TIME_TRACKING_FORM_CONFIG,
  GLOBAL_TASKS_FORM_CONFIG,
} from '../../features/config/global-config-form-config.const';
import {
  ConfigFormConfig,
  GlobalConfigSectionKey,
  GlobalConfigState,
  GlobalSectionConfig,
  SyncConfig,
} from '../../features/config/global-config.model';
import { combineLatest, firstValueFrom, Observable, Subscription } from 'rxjs';
import { ProjectCfgFormKey } from '../../features/project/project.model';
import { T } from '../../t.const';
import { versions } from '../../../environments/versions';
import { IS_ELECTRON } from '../../app.constants';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { getAutomaticBackUpFormCfg } from '../../features/config/form-cfgs/automatic-backups-form.const';
import { getAppVersionStr } from '../../util/get-app-version-str';
import { ConfigSectionComponent } from '../../features/config/config-section/config-section.component';
import { ConfigSoundFormComponent } from '../../features/config/config-sound-form/config-sound-form.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { SYNC_FORM } from '../../features/config/form-cfgs/sync-form.const';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { map } from 'rxjs/operators';
import { SyncConfigService } from '../../imex/sync/sync-config.service';
import { WebdavApi } from '../../op-log/sync-providers/file-based/webdav/webdav-api';
import { WebdavPrivateCfg } from '../../op-log/sync-providers/file-based/webdav/webdav.model';
import { AsyncPipe } from '@angular/common';
import { PluginManagementComponent } from '../../plugins/ui/plugin-management/plugin-management.component';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { createPluginShortcutFormItems } from '../../features/config/form-cfgs/plugin-keyboard-shortcuts';
import { PluginShortcutCfg } from '../../plugins/plugin-api.model';
import { ThemeSelectorComponent } from '../../core/theme/theme-selector/theme-selector.component';
import { Log } from '../../core/log';
import { downloadLogs } from '../../util/download';
import { SnackService } from '../../core/snack/snack.service';
import { ShareService } from '../../core/share/share.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { UserProfileService } from '../../features/user-profile/user-profile.service';
import { MatDialog } from '@angular/material/dialog';
import { DialogDisableProfilesConfirmationComponent } from '../../features/user-profile/dialog-disable-profiles-confirmation/dialog-disable-profiles-confirmation.component';
import { DialogRestorePointComponent } from '../../imex/sync/dialog-restore-point/dialog-restore-point.component';
import { LegacySyncProvider } from '../../imex/sync/legacy-sync-provider.model';
import { toSyncProviderId } from '../../op-log/sync-exports';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { LS } from '../../core/persistence/storage-keys.const';
import { MatTab, MatTabGroup, MatTabLabel } from '@angular/material/tabs';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

@Component({
  selector: 'config-page',
  templateUrl: './config-page.component.html',
  styleUrls: ['./config-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ThemeSelectorComponent,
    ConfigSectionComponent,
    ConfigSoundFormComponent,
    TranslatePipe,
    AsyncPipe,
    PluginManagementComponent,
    MatTabGroup,
    MatTab,
    MatTabLabel,
    MatIcon,
    MatTooltip,
  ],
})
export class ConfigPageComponent implements OnInit, OnDestroy {
  private readonly _cd = inject(ChangeDetectorRef);
  private readonly _route = inject(ActivatedRoute);
  private readonly _providerManager = inject(SyncProviderManager);
  private readonly _syncWrapperService = inject(SyncWrapperService);
  private readonly _pluginBridgeService = inject(PluginBridgeService);
  private readonly _snackService = inject(SnackService);
  private readonly _shareService = inject(ShareService);
  private readonly _userProfileService = inject(UserProfileService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _translateService = inject(TranslateService);

  readonly configService = inject(GlobalConfigService);
  readonly syncSettingsService = inject(SyncConfigService);

  T: typeof T = T;

  selectedTabIndex = 0;
  expandedSection: string | null = null;

  // @todo - find better names for tabs configs forms
  // Tab-specific form configurations
  generalFormCfg: ConfigFormConfig;
  globalTasksFormCfg: ConfigFormConfig;
  timeTrackingFormCfg: ConfigFormConfig;
  pluginsShortcutsFormCfg: ConfigFormConfig;
  globalImexFormCfg: ConfigFormConfig;
  globalProductivityConfigFormCfg: ConfigFormConfig;
  globalSyncConfigFormCfg = this._buildSyncFormConfig();

  globalCfg?: GlobalConfigState;

  appVersion: string = getAppVersionStr();
  versions?: typeof versions = versions;

  // TODO needs to contain all sync providers....
  // TODO maybe handling this in an effect would be better????
  syncFormCfg$: Observable<Record<string, unknown>> = combineLatest([
    this._providerManager.currentProviderPrivateCfg$,
    this.configService.sync$,
  ]).pipe(
    map(([currentProviderCfg, syncCfg]) => {
      if (!currentProviderCfg) {
        return syncCfg as unknown as Record<string, unknown>;
      }
      return {
        ...(syncCfg as unknown as Record<string, unknown>),
        [currentProviderCfg.providerId]: currentProviderCfg.privateCfg,
      };
    }),
  );

  private _subs: Subscription = new Subscription();

  constructor() {
    // Initialize tab-specific form configurations
    this.generalFormCfg = GLOBAL_GENERAL_FORM_CONFIG.slice();
    this.timeTrackingFormCfg = GLOBAL_TIME_TRACKING_FORM_CONFIG.slice();
    this.pluginsShortcutsFormCfg = GLOBAL_PLUGINS_FORM_CONFIG.slice();
    this.globalImexFormCfg = GLOBAL_IMEX_FORM_CONFIG.slice();
    this.globalProductivityConfigFormCfg = GLOBAL_PRODUCTIVITY_FORM_CONFIG.slice();
    this.globalTasksFormCfg = GLOBAL_TASKS_FORM_CONFIG.slice();

    // NOTE: needs special handling cause of the async stuff
    if (IS_ANDROID_WEB_VIEW) {
      this.globalImexFormCfg = [...this.globalImexFormCfg, getAutomaticBackUpFormCfg()];
    } else if (IS_ELECTRON) {
      window.ea.getBackupPath().then((backupPath) => {
        this.globalImexFormCfg = [
          ...this.globalImexFormCfg,
          getAutomaticBackUpFormCfg(backupPath),
        ];
        this._cd.detectChanges();
      });
    }

    // Use effect to react to plugin shortcuts changes for live updates
    effect(() => {
      const shortcuts = this._pluginBridgeService.shortcuts();
      Log.log('Plugin shortcuts changed:', { shortcuts });
      this._updateKeyboardFormWithPluginShortcuts(shortcuts);
    });
  }

  ngOnInit(): void {
    this._subs.add(
      this.configService.cfg$.subscribe((cfg) => {
        this.globalCfg = cfg;
        // this._cd.detectChanges();
      }),
    );

    // Check for tab query parameter and set selected tab
    this._subs.add(
      this._route.queryParams.subscribe((params) => {
        if (params['tab'] !== undefined) {
          const tabIndex = parseInt(params['tab'], 10);
          if (!isNaN(tabIndex) && tabIndex >= 0 && tabIndex < 5) {
            this.selectedTabIndex = tabIndex;
            this._cd.detectChanges();
          }
        }
        if (params['section'] !== undefined) {
          this.expandedSection = params['section'];
          this._cd.detectChanges();
        }
      }),
    );
  }

  private _updateKeyboardFormWithPluginShortcuts(shortcuts: PluginShortcutCfg[]): void {
    // @todo - make separate core shortcuts and plugins shortcuts settings
    // Find keyboard form section in general tab configuration
    const keyboardFormIndex = this.generalFormCfg.findIndex(
      (section) => section.key === 'keyboard',
    );

    if (keyboardFormIndex === -1) {
      Log.err('Keyboard form section not found');
      return;
    }

    const keyboardSection = this.generalFormCfg[keyboardFormIndex];

    // Remove existing plugin shortcuts and header from the form
    const filteredItems = (keyboardSection.items || []).filter((item) => {
      // Remove plugin shortcut items
      if (item.key?.toString().startsWith('plugin_')) {
        return false;
      }
      // Remove plugin shortcuts header
      if (
        item.type === 'tpl' &&
        item.templateOptions?.text ===
          (T.GCF.KEYBOARD.PLUGIN_SHORTCUTS || 'Plugin Shortcuts')
      ) {
        return false;
      }
      return true;
    });

    // Add current plugin shortcuts to the form
    let newItems = [...filteredItems];
    if (shortcuts.length > 0) {
      const pluginShortcutItems = createPluginShortcutFormItems(shortcuts);
      newItems = [...filteredItems, ...pluginShortcutItems];
      Log.log(`Updated keyboard form with ${shortcuts.length} plugin shortcuts`);
    } else {
      Log.log('No plugin shortcuts to add to keyboard form');
    }

    // Create a new keyboard section object to trigger change detection
    const newKeyboardSection = {
      ...keyboardSection,
      items: newItems,
    };

    // Create a new config array to ensure Angular detects the change
    this.generalFormCfg = [
      ...this.generalFormCfg.slice(0, keyboardFormIndex),
      newKeyboardSection,
      ...this.generalFormCfg.slice(keyboardFormIndex + 1),
    ];

    // Trigger change detection
    this._cd.detectChanges();
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  private _buildSyncFormConfig(): typeof SYNC_FORM {
    // Deep clone the SYNC_FORM items to avoid mutating the original
    const items = SYNC_FORM.items!.map((item) => {
      // Find the WebDAV fieldGroup and add the Test Connection button
      if (item.key === 'webDav' && item.fieldGroup) {
        return {
          ...item,
          fieldGroup: [
            ...item.fieldGroup,
            {
              type: 'btn',
              className: 'mt3 block',
              templateOptions: {
                text: T.F.SYNC.FORM.WEB_DAV.L_TEST_CONNECTION,
                required: false,
                onClick: async (_field: unknown, _form: unknown, model: unknown) => {
                  const webDavCfg = model as WebdavPrivateCfg;
                  if (
                    !webDavCfg?.baseUrl ||
                    !webDavCfg?.userName ||
                    !webDavCfg?.password ||
                    !webDavCfg?.syncFolderPath
                  ) {
                    this._snackService.open({
                      type: 'ERROR',
                      msg: T.F.SYNC.FORM.WEB_DAV.S_FILL_ALL_FIELDS,
                    });
                    return;
                  }

                  try {
                    // Create a temporary WebdavApi instance for testing
                    const api = new WebdavApi(async () => webDavCfg);
                    const result = await api.testConnection(webDavCfg);

                    if (result.success) {
                      this._snackService.open({
                        type: 'SUCCESS',
                        msg: T.F.SYNC.FORM.WEB_DAV.S_TEST_SUCCESS,
                        translateParams: { url: result.fullUrl },
                      });

                      // Save settings after successful connection test.
                      // Formly hierarchy: _field (button) -> parent (group wrapper) -> parent (root form) -> model
                      const fullSyncModel = (
                        _field as { parent?: { parent?: { model?: SyncConfig } } }
                      )?.parent?.parent?.model;
                      if (fullSyncModel) {
                        await this.syncSettingsService.updateSettingsFromForm(
                          fullSyncModel,
                          true,
                        );
                      }

                      // Test conditional header support
                      const testPath = `${webDavCfg.syncFolderPath || '/'}/.sp-header-test-${Date.now()}`;
                      try {
                        const supportsHeaders =
                          await api.testConditionalHeaders(testPath);

                        if (
                          !supportsHeaders &&
                          !localStorage.getItem(
                            LS.WEBDAV_CONDITIONAL_HEADER_WARNING_DISMISSED,
                          )
                        ) {
                          const dialogRef = this._matDialog.open(DialogConfirmComponent, {
                            data: {
                              title:
                                T.F.SYNC.FORM.WEB_DAV.CONDITIONAL_HEADER_WARNING_TITLE,
                              message:
                                T.F.SYNC.FORM.WEB_DAV.CONDITIONAL_HEADER_WARNING_MSG,
                              okTxt: T.G.OK,
                              hideCancelButton: true,
                              showDontShowAgain: true,
                            },
                          });
                          const res = await firstValueFrom(dialogRef.afterClosed());
                          if (res?.dontShowAgain) {
                            localStorage.setItem(
                              LS.WEBDAV_CONDITIONAL_HEADER_WARNING_DISMISSED,
                              'true',
                            );
                          }
                        }
                      } catch (headerTestError) {
                        // Ignore header test errors - connection test was successful
                        Log.warn(
                          'WebDAV conditional header test failed:',
                          headerTestError,
                        );
                      }
                    } else {
                      this._snackService.open({
                        type: 'ERROR',
                        msg: T.F.SYNC.FORM.WEB_DAV.S_TEST_FAIL,
                        translateParams: {
                          error: result.error || 'Unknown error',
                          url: result.fullUrl,
                        },
                      });
                    }
                  } catch (e) {
                    this._snackService.open({
                      type: 'ERROR',
                      msg: T.F.SYNC.FORM.WEB_DAV.S_TEST_FAIL,
                      translateParams: {
                        error: e instanceof Error ? e.message : 'Unexpected error',
                        url: (webDavCfg.baseUrl as string) || 'N/A',
                      },
                    });
                  }
                },
              },
            },
          ],
        };
      }

      // Find the Dropbox fieldGroup and add the authentication button
      if ((item as any).props?.dropboxAuth && item.fieldGroup) {
        // Check if Dropbox is already authenticated
        const dropboxProvider = this._providerManager.getProviderById(
          toSyncProviderId(LegacySyncProvider.Dropbox)!,
        );

        // We need to check auth status asynchronously, so we'll set initial state
        // and update it when the form is rendered
        let isAuthenticated = false;
        dropboxProvider?.isReady().then((ready) => {
          isAuthenticated = ready;
          // Update the status field text after checking
          const statusField = item.fieldGroup?.find(
            (f: any) => f.key === 'authStatus',
          ) as any;
          if (statusField?.templateOptions) {
            statusField.templateOptions.text = isAuthenticated
              ? '✓ ' +
                this._translateService.instant(T.F.SYNC.FORM.DROPBOX.STATUS_CONFIGURED)
              : '⚠ ' +
                this._translateService.instant(
                  T.F.SYNC.FORM.DROPBOX.STATUS_NOT_CONFIGURED,
                );
          }
        });

        return {
          ...item,
          fieldGroup: [
            ...item.fieldGroup,
            {
              type: 'btn',
              className: 'mt3 block e2e-dropbox-auth-btn',
              templateOptions: {
                // Button text will be determined by checking if already authenticated
                text: T.F.SYNC.FORM.DROPBOX.BTN_AUTHENTICATE,
                btnType: 'primary',
                onClick: async (_field: unknown, _form: unknown, model: unknown) => {
                  try {
                    // Check current auth status before opening dialog
                    const isCurrentlyAuth = await dropboxProvider?.isReady();

                    const result =
                      await this._syncWrapperService.configuredAuthForSyncProviderIfNecessary(
                        toSyncProviderId(LegacySyncProvider.Dropbox)!,
                        true, // force re-authentication even if already configured
                      );

                    if (result.wasConfigured) {
                      this._snackService.open({
                        type: 'SUCCESS',
                        msg: isCurrentlyAuth
                          ? T.F.SYNC.FORM.DROPBOX.REAUTH_SUCCESS
                          : T.F.SYNC.FORM.DROPBOX.AUTH_SUCCESS,
                      });

                      // Update the status field to show configured
                      const statusField = item.fieldGroup?.find(
                        (f: any) => f.key === 'authStatus',
                      ) as any;
                      if (statusField?.templateOptions) {
                        statusField.templateOptions.text =
                          '✓ ' +
                          this._translateService.instant(
                            T.F.SYNC.FORM.DROPBOX.STATUS_CONFIGURED,
                          );
                      }

                      // Update button text to "Re-authenticate"
                      const btnField = _field as any;
                      if (btnField?.templateOptions) {
                        btnField.templateOptions.text =
                          T.F.SYNC.FORM.DROPBOX.BTN_REAUTHENTICATE;
                      }

                      // Save the updated credentials to persist them
                      const fullSyncModel = (
                        _field as { parent?: { parent?: { model?: SyncConfig } } }
                      )?.parent?.parent?.model;
                      if (fullSyncModel) {
                        await this.syncSettingsService.updateSettingsFromForm(
                          fullSyncModel!,
                          true,
                        );
                      }
                    }
                  } catch (e) {
                    // Log error for debugging (storage failures, auth errors, etc.)
                    Log.err('Dropbox authentication failed:', e);
                    // Show user-friendly error with actual error message for context
                    this._snackService.open({
                      type: 'ERROR',
                      msg: T.F.SYNC.S.INCOMPLETE_CFG,
                      translateParams: {
                        error: e instanceof Error ? e.message : String(e),
                      },
                    });
                  }
                },
              },
              hooks: {
                // Update button text based on auth status when form initializes
                onInit: async (field: any) => {
                  const isAuth = await dropboxProvider?.isReady();
                  if (field?.templateOptions && isAuth) {
                    field.templateOptions.text = T.F.SYNC.FORM.DROPBOX.BTN_REAUTHENTICATE;
                  }
                },
              },
            },
          ],
        };
      }

      return item;
    });

    return {
      ...SYNC_FORM,
      items: [
        ...items,
        {
          hideExpression: (m: Record<string, unknown>, _v: unknown, field: unknown) =>
            !m.isEnabled || !(field as { form?: { valid?: boolean } })?.form?.valid,
          type: 'btn',
          className: 'mt3 block',
          templateOptions: {
            text: T.F.SYNC.BTN_SYNC_NOW,
            required: false,
            onClick: () => {
              this._syncWrapperService.sync();
            },
          },
        },
        {
          hideExpression: (m: Record<string, unknown>, _v: unknown, field: unknown) =>
            !m.isEnabled || !(field as { form?: { valid?: boolean } })?.form?.valid,
          type: 'btn',
          className: 'mt2 block',
          templateOptions: {
            text: T.F.SYNC.S.BTN_FORCE_OVERWRITE,
            btnType: 'warn',
            required: false,
            onClick: () => {
              this._syncWrapperService.forceUpload();
            },
          },
        },
        {
          hideExpression: (m: Record<string, unknown>) =>
            !m.isEnabled || m.syncProvider !== LegacySyncProvider.SuperSync,
          type: 'btn',
          className: 'mt2 block',
          templateOptions: {
            text: T.F.SYNC.BTN_RESTORE_FROM_HISTORY,
            btnType: 'stroked',
            required: false,
            onClick: () => {
              this._openRestoreDialog();
            },
          },
        },
      ],
    } as typeof SYNC_FORM;
  }

  async saveGlobalCfg($event: {
    sectionKey: GlobalConfigSectionKey | ProjectCfgFormKey;
    config: Record<string, unknown>;
  }): Promise<void> {
    const config = $event.config;
    const sectionKey = $event.sectionKey as GlobalConfigSectionKey;

    if (!sectionKey || !config) {
      throw new Error('Not enough data');
    }

    // Check if user is trying to disable user profiles when multiple profiles exist
    if (
      sectionKey === 'appFeatures' &&
      config.isEnableUserProfiles === false &&
      this._userProfileService.hasMultipleProfiles()
    ) {
      const appFeatures = this.globalCfg?.appFeatures;
      // Only show dialog if we're actually changing from true to false
      if (appFeatures?.isEnableUserProfiles === true) {
        const confirmed = await this._showDisableProfilesDialog();
        if (!confirmed) {
          // User cancelled, don't save the change
          return;
        }
      }
    }

    this.configService.updateSection(sectionKey, config);
  }

  private async _showDisableProfilesDialog(): Promise<boolean> {
    const activeProfile = this._userProfileService.activeProfile();
    const allProfiles = this._userProfileService.profiles();
    const otherProfiles = allProfiles.filter((p) => p.id !== activeProfile?.id);

    if (!activeProfile) {
      return true; // No active profile, allow disable
    }

    const dialogRef = this._matDialog.open(DialogDisableProfilesConfirmationComponent, {
      data: {
        activeProfile,
        otherProfiles,
      },
      width: '600px',
      maxWidth: '90vw',
      disableClose: true,
    });

    return new Promise((resolve) => {
      dialogRef.afterClosed().subscribe((result) => {
        resolve(!!result);
      });
    });
  }

  getGlobalCfgSection(
    sectionKey: GlobalConfigSectionKey | ProjectCfgFormKey,
  ): GlobalSectionConfig {
    return (this.globalCfg as unknown as Record<string, GlobalSectionConfig>)[sectionKey];
  }

  async downloadLogs(): Promise<void> {
    try {
      await downloadLogs();
      this._snackService.open('Logs downloaded to android documents folder');
    } catch (error) {
      this._snackService.open('Failed to download logs');
    }
  }

  async copyVersionToClipboard(text: string): Promise<void> {
    const result = await this._shareService.copyToClipboard(text, 'Version');
    if (!result.success) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.PS.FAILED_TO_COPY_TO_CLIPBOARD,
      });
    }
  }

  private _openRestoreDialog(): void {
    this._matDialog.open(DialogRestorePointComponent, {
      width: '500px',
      maxWidth: '90vw',
    });
  }
}
