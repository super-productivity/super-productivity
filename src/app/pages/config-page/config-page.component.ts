import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  effect,
  inject,
  OnInit,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { TaskWidgetSettingsService } from '../../features/config/task-widget-settings.service';
import { TaskWidgetConfig } from '../../features/config/global-config.model';
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
  GlobalConfigFormSectionKey,
  GlobalConfigSectionKey,
  GlobalConfigState,
  GlobalSectionConfig,
} from '../../features/config/global-config.model';
import { firstValueFrom, from, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ProjectCfgFormKey } from '../../features/project/project.model';
import { T } from '../../t.const';
import { versions } from '../../../environments/versions';
import { IS_ELECTRON } from '../../app.constants';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { getAutomaticBackUpFormCfg } from '../../features/config/form-cfgs/automatic-backups-form.const';
import { getAppVersionStr } from '../../util/get-app-version-str';
import { ConfigSectionComponent } from '../../features/config/config-section/config-section.component';
import { ConfigSoundFormComponent } from '../../features/config/config-sound-form/config-sound-form.component';
import { TranslatePipe } from '@ngx-translate/core';
import { EXPERIMENTAL_APP_FEATURE_KEYS } from '../../features/config/form-cfgs/app-features-form.const';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncConfigService } from '../../imex/sync/sync-config.service';
import { PluginManagementComponent } from '../../plugins/ui/plugin-management/plugin-management.component';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { createPluginShortcutFormItems } from '../../features/config/form-cfgs/plugin-keyboard-shortcuts';
import { PluginShortcutCfg } from '../../plugins/plugin-api.model';
import { ThemeSelectorComponent } from '../../core/theme/theme-selector/theme-selector.component';
import { Log } from '../../core/log';
import { DialogLogsComponent } from '../../ui/dialog-logs/dialog-logs.component';
import { SnackService } from '../../core/snack/snack.service';
import { ShareService } from '../../core/share/share.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { UserProfileService } from '../../features/user-profile/user-profile.service';
import { MatDialog } from '@angular/material/dialog';
import { DialogDisableProfilesConfirmationComponent } from '../../features/user-profile/dialog-disable-profiles-confirmation/dialog-disable-profiles-confirmation.component';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { MatTab, MatTabGroup, MatTabLabel } from '@angular/material/tabs';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';

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
    PluginManagementComponent,
    MatTabGroup,
    MatTab,
    MatTabLabel,
    MatIcon,
    MatTooltip,
    MatButton,
  ],
})
export class ConfigPageComponent implements OnInit {
  private readonly _cd = inject(ChangeDetectorRef);
  private readonly _route = inject(ActivatedRoute);
  private readonly _providerManager = inject(SyncProviderManager);
  private readonly _syncWrapperService = inject(SyncWrapperService);
  private readonly _pluginBridgeService = inject(PluginBridgeService);
  private readonly _snackService = inject(SnackService);
  private readonly _shareService = inject(ShareService);
  private readonly _userProfileService = inject(UserProfileService);
  private readonly _matDialog = inject(MatDialog);

  readonly configService = inject(GlobalConfigService);
  readonly syncSettingsService = inject(SyncConfigService);
  readonly taskWidgetSettingsService = inject(TaskWidgetSettingsService);

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
  globalCfg?: GlobalConfigState;

  // `providerId === null` ⇒ empty state (sync disabled or no provider chosen).
  // switchMap drops stale signal writes if a new sync-config emission arrives
  // before the previous provider probe resolves — the underlying probe promise
  // still runs to completion in the background; only the result is ignored.
  // try/catch keeps the stream alive when isReady() rejects (otherwise the
  // observable error would kill the subscription and freeze the status).
  syncStatus = toSignal(
    this.syncSettingsService.syncSettingsForm$.pipe(
      switchMap((sync) => {
        const providerId = sync.isEnabled
          ? (sync.syncProvider as SyncProviderId | null)
          : null;
        const isEncrypted = !!sync.isEncryptionEnabled;
        if (!providerId) {
          return of({ providerId: null, needsAuth: false, isEncrypted });
        }
        return from(
          (async () => {
            const provider = await this._providerManager.getProviderById(providerId);
            const requiresAuth = !!provider?.getAuthHelper;
            try {
              const isAuthed = !!(await provider?.isReady());
              return { providerId, needsAuth: requiresAuth && !isAuthed, isEncrypted };
            } catch {
              // Don't claim a non-OAuth provider needs auth — only surface
              // the auth pill if the provider could plausibly require it.
              return { providerId, needsAuth: requiresAuth, isEncrypted };
            }
          })(),
        );
      }),
    ),
    { initialValue: { providerId: null, needsAuth: false, isEncrypted: false } },
  );

  appVersion: string = getAppVersionStr();
  versions?: typeof versions = versions;

  private readonly _destroyRef = inject(DestroyRef);

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
    this.configService.cfg$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((cfg) => {
        this.globalCfg = cfg;
      });

    // Check for tab query parameter and set selected tab
    this._route.queryParams
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((params) => {
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
      });
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

  async openSyncCfgDialog(): Promise<void> {
    const { DialogSyncCfgComponent } =
      await import('../../imex/sync/dialog-sync-cfg/dialog-sync-cfg.component');
    this._matDialog.open(DialogSyncCfgComponent);
  }
  triggerSync(): void {
    this._syncWrapperService.sync();
  }

  private async _buildSyncFormConfig(): Promise<typeof SYNC_FORM> {
    // Pre-load dropbox provider for use in the form config
    await this._providerManager.getProviderById(SyncProviderId.Dropbox);
    await this._providerManager.getProviderById(SyncProviderId.OneDrive);

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
        // We need to check auth status asynchronously, so we'll set initial state
        // and update it when the form is rendered
        let isAuthenticated = false;
        this._providerManager
          .getProviderById(SyncProviderId.Dropbox)
          .then(async (dropboxProvider) => {
            const ready = await dropboxProvider?.isReady();
            isAuthenticated = !!ready;
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
          })
          .catch((e) => console.error('Failed to check Dropbox auth status:', e));

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
                    const dropboxProvider = await this._providerManager.getProviderById(
                      SyncProviderId.Dropbox,
                    );
                    const isCurrentlyAuth = await dropboxProvider?.isReady();

                    const result =
                      await this._syncWrapperService.configuredAuthForSyncProviderIfNecessary(
                        SyncProviderId.Dropbox,
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
                  const dropboxProv = await this._providerManager.getProviderById(
                    SyncProviderId.Dropbox,
                  );
                  const isAuth = await dropboxProv?.isReady();
                  if (field?.templateOptions && isAuth) {
                    field.templateOptions.text = T.F.SYNC.FORM.DROPBOX.BTN_REAUTHENTICATE;
                  }
                },
              },
            },
          ],
        };
      }

      // Find the OneDrive fieldGroup and add the authentication button
      if ((item as any).props?.oneDriveAuth && item.fieldGroup) {
        this._providerManager
          .getProviderById(SyncProviderId.OneDrive)
          .then(async (oneDriveProvider) => {
            const ready = await oneDriveProvider?.isReady();
            const statusField = item.fieldGroup?.find(
              (f: any) => f.key === 'authStatus',
            ) as any;
            if (statusField?.templateOptions) {
              statusField.templateOptions.text = ready
                ? '✓ ' +
                  this._translateService.instant(T.F.SYNC.FORM.ONEDRIVE.STATUS_CONFIGURED)
                : '⚠ ' +
                  this._translateService.instant(
                    T.F.SYNC.FORM.ONEDRIVE.STATUS_NOT_CONFIGURED,
                  );
            }
          })
          .catch((e) => console.error('Failed to check OneDrive auth status:', e));

        return {
          ...item,
          fieldGroup: [
            ...item.fieldGroup,
            {
              type: 'btn',
              className: 'mt3 block e2e-onedrive-auth-btn',
              templateOptions: {
                text: T.F.SYNC.FORM.ONEDRIVE.BTN_AUTHENTICATE,
                btnType: 'primary',
                onClick: async (_field: unknown) => {
                  try {
                    const oneDriveProvider = await this._providerManager.getProviderById(
                      SyncProviderId.OneDrive,
                    );

                    // Persist OneDrive values directly from the current field model first.
                    // Depending on Formly field nesting, _field.parent.model can be either
                    // the oneDrive sub-model or the full sync model.
                    const parentModel = (_field as { parent?: { model?: any } })?.parent
                      ?.model;
                    const oneDriveFormModel =
                      parentModel?.clientId !== undefined ||
                      parentModel?.tenantId !== undefined ||
                      parentModel?.useCustomApp !== undefined ||
                      parentModel?.syncFolderPath !== undefined
                        ? parentModel
                        : parentModel?.oneDrive;

                    if (oneDriveProvider && oneDriveFormModel) {
                      const existingCfg =
                        (await oneDriveProvider.privateCfg.load()) || {};
                      const nonEmptyOneDriveValues = Object.entries(
                        oneDriveFormModel as Record<string, unknown>,
                      ).reduce(
                        (acc, [key, value]) => {
                          if (value !== undefined && value !== null && value !== '') {
                            acc[key] = value;
                          }
                          return acc;
                        },
                        {} as Record<string, unknown>,
                      );

                      if (Object.keys(nonEmptyOneDriveValues).length > 0) {
                        await this._providerManager.setProviderConfig(
                          SyncProviderId.OneDrive,
                          {
                            ...existingCfg,
                            ...nonEmptyOneDriveValues,
                          } as any,
                        );
                      }
                    }

                    const fullSyncModel = (
                      _field as { parent?: { parent?: { model?: SyncConfig } } }
                    )?.parent?.parent?.model;
                    if (fullSyncModel) {
                      // Persist current OneDrive form values (clientId/tenant/mode) before auth.
                      await this.syncSettingsService.updateSettingsFromForm(
                        fullSyncModel,
                        true,
                      );
                    }

                    const isCurrentlyAuth = await oneDriveProvider?.isReady();

                    const result =
                      await this._syncWrapperService.configuredAuthForSyncProviderIfNecessary(
                        SyncProviderId.OneDrive,
                        true,
                      );

                    if (result.wasConfigured) {
                      this._snackService.open({
                        type: 'SUCCESS',
                        msg: isCurrentlyAuth
                          ? T.F.SYNC.FORM.ONEDRIVE.REAUTH_SUCCESS
                          : T.F.SYNC.FORM.ONEDRIVE.AUTH_SUCCESS,
                      });

                      const statusField = item.fieldGroup?.find(
                        (f: any) => f.key === 'authStatus',
                      ) as any;
                      if (statusField?.templateOptions) {
                        statusField.templateOptions.text =
                          '✓ ' +
                          this._translateService.instant(
                            T.F.SYNC.FORM.ONEDRIVE.STATUS_CONFIGURED,
                          );
                      }

                      const btnField = _field as any;
                      if (btnField?.templateOptions) {
                        btnField.templateOptions.text =
                          T.F.SYNC.FORM.ONEDRIVE.BTN_REAUTHENTICATE;
                      }

                      if (fullSyncModel) {
                        await this.syncSettingsService.updateSettingsFromForm(
                          fullSyncModel,
                          true,
                        );
                      }
                    }
                  } catch (e) {
                    Log.err('OneDrive authentication failed:', e);
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
                onInit: async (field: any) => {
                  const oneDriveProvider = await this._providerManager.getProviderById(
                    SyncProviderId.OneDrive,
                  );
                  const isAuth = await oneDriveProvider?.isReady();
                  if (field?.templateOptions && isAuth) {
                    field.templateOptions.text =
                      T.F.SYNC.FORM.ONEDRIVE.BTN_REAUTHENTICATE;
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
            !m.isEnabled || m.syncProvider !== SyncProviderId.SuperSync,
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
    sectionKey: GlobalConfigFormSectionKey | ProjectCfgFormKey;
    config: Record<string, unknown>;
  }): Promise<void> {
    const config = $event.config;
    const formSectionKey = $event.sectionKey;

    if (!formSectionKey || !config) {
      throw new Error('Not enough data');
    }

    // taskWidget is per-instance (not synced) — handled by a dedicated service
    if (formSectionKey === 'taskWidget') {
      this.taskWidgetSettingsService.update(config as Partial<TaskWidgetConfig>);
      return;
    }

    // From here on we know it's a real GlobalConfigState section.
    const sectionKey = formSectionKey as GlobalConfigSectionKey;

    // Check if user is trying to enable an experimental feature
    const currentAppFeatures = this.globalCfg?.appFeatures;
    if (
      sectionKey === 'appFeatures' &&
      currentAppFeatures &&
      EXPERIMENTAL_APP_FEATURE_KEYS.some(
        (key) => config[key] === true && currentAppFeatures[key] === false,
      )
    ) {
      const confirmed = await this._showExperimentalWarningDialog();
      if (!confirmed) {
        return;
      }
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

  private async _showExperimentalWarningDialog(): Promise<boolean> {
    const dialogRef = this._matDialog.open(DialogConfirmComponent, {
      restoreFocus: true,
      data: {
        title: T.GCF.APP_FEATURES.EXPERIMENTAL_WARNING_TITLE,
        titleIcon: 'warning',
        message: T.GCF.APP_FEATURES.EXPERIMENTAL_WARNING_MSG,
        okTxt: T.G.CONFIRM,
        cancelTxt: T.G.CANCEL,
      },
    });
    return !!(await firstValueFrom(dialogRef.afterClosed()));
  }

  getGlobalCfgSection(
    sectionKey: GlobalConfigFormSectionKey | ProjectCfgFormKey,
  ): GlobalSectionConfig {
    if (sectionKey === 'taskWidget') {
      return this.taskWidgetSettingsService.settings() as GlobalSectionConfig;
    }
    return (this.globalCfg as unknown as Record<string, GlobalSectionConfig>)[sectionKey];
  }

  showLogs(): void {
    this._matDialog.open(DialogLogsComponent, {
      width: '600px',
      maxWidth: '95vw',
      data: { logs: Log.exportLogHistory() },
    });
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
}
