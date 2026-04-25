import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { SYNC_FORM } from '../../../features/config/form-cfgs/sync-form.const';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { SyncConfig } from '../../../features/config/global-config.model';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { SyncConfigService } from '../sync-config.service';
import { SyncWrapperService } from '../sync-wrapper.service';
import { Subscription } from 'rxjs';
import { first, skip } from 'rxjs/operators';
import { toSyncProviderId } from '../../../op-log/sync-exports';
import { SyncLog } from '../../../core/log';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';

import { GlobalConfigService } from '../../../features/config/global-config.service';
import { isOnline } from '../../../util/is-online';
import { SnackService } from '../../../core/snack/snack.service';
import { DialogRestorePointComponent } from '../dialog-restore-point/dialog-restore-point.component';
import { WebdavApi } from '../../../op-log/sync-providers/file-based/webdav/webdav-api';
import { WebdavPrivateCfg } from '../../../op-log/sync-providers/file-based/webdav/webdav.model';

@Component({
  selector: 'dialog-sync-cfg',
  templateUrl: './dialog-sync-cfg.component.html',
  styleUrls: ['./dialog-sync-cfg.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
    ReactiveFormsModule,
    FormlyModule,
  ],
})
export class DialogSyncCfgComponent implements AfterViewInit {
  syncConfigService = inject(SyncConfigService);
  syncWrapperService = inject(SyncWrapperService);
  private _providerManager = inject(SyncProviderManager);
  private _globalConfigService = inject(GlobalConfigService);
  private _matDialog = inject(MatDialog);
  private _snackService = inject(SnackService);

  T = T;
  isWasEnabled = signal(false);
  fields = signal(this._getFields(false));
  form = new FormGroup({});

  private _canReauthSig = signal(false);

  canReauth = this._canReauthSig.asReadonly();

  private _getFields(includeEnabledToggle: boolean): FormlyFieldConfig[] {
    return SYNC_FORM.items!.filter(
      (f) => includeEnabledToggle || f.key !== 'isEnabled',
    ).map((item) => this._injectProviderHelpers(item));
  }

  /**
   * Adds helpers into the formly field tree:
   * - WebDAV Test Connection button inside the WebDAV section.
   * - Force Overwrite + Restore action buttons inside the top-level "Advanced"
   *   collapsible (edit mode only — first-time setup keeps the SuperSync hide
   *   so the collapsible doesn't appear empty for SuperSync new users).
   */
  private _injectProviderHelpers(item: FormlyFieldConfig): FormlyFieldConfig {
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
                await this._testWebDavConnection(model as WebdavPrivateCfg);
              },
            },
          },
        ],
      };
    }
    if (
      item.type === 'collapsible' &&
      item.props?.label === T.F.SYNC.D_INITIAL_CFG.ADVANCED &&
      this.isWasEnabled()
    ) {
      return {
        ...item,
        // Edit mode: SuperSync also gets this collapsible (for the action buttons).
        hideExpression: undefined,
        fieldGroup: [...(item.fieldGroup ?? []), ...this._advancedActionFields()],
      };
    }
    return item;
  }

  private _advancedActionFields(): FormlyFieldConfig[] {
    return [
      {
        type: 'btn',
        className: 'mt2 block',
        templateOptions: {
          text: T.F.SYNC.S.BTN_FORCE_OVERWRITE,
          btnType: 'warn',
          required: false,
          onClick: () => this.forceOverwrite(),
        },
      },
      {
        type: 'btn',
        className: 'mt2 block',
        hideExpression: (m, v, field) =>
          field?.parent?.parent?.model?.syncProvider !== SyncProviderId.SuperSync,
        templateOptions: {
          text: T.F.SYNC.BTN_RESTORE_FROM_HISTORY,
          btnType: 'stroked',
          required: false,
          onClick: () => this.restoreFromHistory(),
        },
      },
    ];
  }

  private async _testWebDavConnection(webDavCfg: WebdavPrivateCfg): Promise<void> {
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
      const api = new WebdavApi(async () => webDavCfg);
      const result = await api.testConnection(webDavCfg);
      if (result.success) {
        this._snackService.open({
          type: 'SUCCESS',
          msg: T.F.SYNC.FORM.WEB_DAV.S_TEST_SUCCESS,
          translateParams: { url: result.fullUrl },
        });
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
  }
  // Note: _isInitialSetup flag is checked by sync-form.const.ts hideExpressions
  // to hide the encryption button/warning (encryption is handled by _promptSuperSyncEncryptionIfNeeded after sync)
  _tmpUpdatedCfg: SyncConfig & { _isInitialSetup?: boolean } = {
    isEnabled: true,
    syncProvider: SyncProviderId.SuperSync,
    syncInterval: 300000,
    encryptKey: '',
    isEncryptionEnabled: false,
    localFileSync: {},
    webDav: {},
    nextcloud: {},
    superSync: {},
    _isInitialSetup: true,
  };

  private _matDialogRef = inject<MatDialogRef<DialogSyncCfgComponent>>(MatDialogRef);

  private _subs = new Subscription();

  constructor() {
    this._subs.add(
      this.syncConfigService.syncSettingsForm$.pipe(first()).subscribe((v) => {
        if (v.isEnabled) {
          this.isWasEnabled.set(true);
          this.fields.set(this._getFields(true));
        }
        this.updateTmpCfg({
          ...v,
          isEnabled: true,
        });
        this._updateReauthability(toSyncProviderId(v.syncProvider));
      }),
    );
  }

  ngAfterViewInit(): void {
    // Setup provider change listener after the form is initialized by Formly
    // Using setTimeout to ensure the form control exists
    setTimeout(() => {
      const syncProviderControl = this.form.get('syncProvider');
      if (!syncProviderControl) {
        SyncLog.warn('syncProvider form control not found');
        return;
      }

      // Listen for provider changes and reload provider-specific configuration
      this._subs.add(
        syncProviderControl.valueChanges
          .pipe(skip(1))
          .subscribe(async (newProvider: SyncProviderId | null) => {
            if (!newProvider) {
              return;
            }

            // Get the current configuration for this provider
            const providerId = toSyncProviderId(newProvider);
            if (!providerId) {
              return;
            }
            this._updateReauthability(providerId);

            // Load the provider's stored configuration
            const provider = await this._providerManager.getProviderById(providerId);
            if (!provider) {
              // Provider not yet configured, keep current form state
              return;
            }

            const privateCfg = await provider.privateCfg.load();
            const globalCfg = await this._globalConfigService.sync$
              .pipe(first())
              .toPromise();

            // Create provider-specific config based on provider type
            let providerSpecificUpdate: Partial<SyncConfig> = {};

            if (newProvider === SyncProviderId.SuperSync && privateCfg) {
              providerSpecificUpdate = {
                superSync: privateCfg as any,
                encryptKey: privateCfg.encryptKey || '',
                // SuperSync stores isEncryptionEnabled in privateCfg, not globalCfg
                isEncryptionEnabled: (privateCfg as any).isEncryptionEnabled || false,
              };
            } else if (newProvider === SyncProviderId.WebDAV && privateCfg) {
              providerSpecificUpdate = {
                webDav: privateCfg as any,
                encryptKey: privateCfg.encryptKey || '',
              };
            } else if (newProvider === SyncProviderId.LocalFile && privateCfg) {
              providerSpecificUpdate = {
                localFileSync: privateCfg as any,
                encryptKey: privateCfg.encryptKey || '',
              };
            } else if (newProvider === SyncProviderId.Nextcloud && privateCfg) {
              providerSpecificUpdate = {
                nextcloud: privateCfg as any,
                encryptKey: privateCfg.encryptKey || '',
              };
            } else if (newProvider === SyncProviderId.Dropbox && privateCfg) {
              providerSpecificUpdate = {
                encryptKey: privateCfg.encryptKey || '',
              };
            }

            // Update the model, preserving non-provider-specific fields
            this._tmpUpdatedCfg = {
              ...this._tmpUpdatedCfg,
              ...providerSpecificUpdate,
              syncProvider: newProvider,
              // Preserve global settings
              isEnabled: this._tmpUpdatedCfg.isEnabled,
              syncInterval: globalCfg?.syncInterval || this._tmpUpdatedCfg.syncInterval,
              isManualSyncOnly:
                globalCfg?.isManualSyncOnly || this._tmpUpdatedCfg.isManualSyncOnly,
              isCompressionEnabled:
                globalCfg?.isCompressionEnabled ||
                this._tmpUpdatedCfg.isCompressionEnabled,
            };

            // For non-SuperSync providers, update encryption from global config
            if (newProvider !== SyncProviderId.SuperSync) {
              this._tmpUpdatedCfg = {
                ...this._tmpUpdatedCfg,
                isEncryptionEnabled: globalCfg?.isEncryptionEnabled || false,
              };
            }
          }),
      );
    }, 0);
  }

  close(): void {
    this._matDialogRef.close();
  }

  async save(): Promise<void> {
    // Check if form is valid
    if (!this.form.valid) {
      // Mark all fields as touched to show validation errors
      this.form.markAllAsTouched();
      SyncLog.err('Sync form validation failed', this.form.errors);
      return;
    }

    // Explicitly sync form values to _tmpUpdatedCfg in case modelChange didn't fire
    // This is especially important on Android WebView where change detection can be unreliable
    this._tmpUpdatedCfg = {
      ...this._tmpUpdatedCfg,
      ...this.form.value,
    };

    // Strip _isInitialSetup before saving — it's only for form hideExpressions
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _isInitialSetup, ...cfgWithoutFlag } = this._tmpUpdatedCfg;
    const configToSave = {
      ...cfgWithoutFlag,
      isEnabled: this._tmpUpdatedCfg.isEnabled || !this.isWasEnabled(),
    };

    const providerId = toSyncProviderId(this._tmpUpdatedCfg.syncProvider);
    if (providerId && this._tmpUpdatedCfg.isEnabled) {
      await this.syncWrapperService.configuredAuthForSyncProviderIfNecessary(providerId);

      // If the provider requires auth (e.g. Dropbox) and is still not ready,
      // the auth dialog was cancelled or failed. Keep the dialog open so the
      // user can retry, and do not persist isEnabled:true with missing credentials
      // (which would trigger the "Sync credentials are missing" snack loop — issue #7131).
      const provider = await this._providerManager.getProviderById(providerId);
      if (provider?.getAuthHelper && !(await provider.isReady())) {
        return;
      }
    }

    await this.syncConfigService.updateSettingsFromForm(configToSave as SyncConfig, true);
    this._matDialogRef.close();

    if (isOnline()) {
      this.syncWrapperService.sync();
    }
  }

  updateTmpCfg(cfg: SyncConfig): void {
    // Use Object.assign to preserve the object reference for Formly
    // This ensures Formly detects changes to the model
    Object.assign(this._tmpUpdatedCfg, cfg);
  }

  async reauth(): Promise<void> {
    const providerId = toSyncProviderId(this._tmpUpdatedCfg.syncProvider);
    if (!providerId) {
      return;
    }
    try {
      const result =
        await this.syncWrapperService.configuredAuthForSyncProviderIfNecessary(
          providerId,
          true,
        );
      if (result.wasConfigured) {
        this._snackService.open({
          type: 'SUCCESS',
          msg: T.F.SYNC.FORM.DROPBOX.REAUTH_SUCCESS,
        });
        await this._updateReauthability(providerId);
      }
    } catch (e) {
      SyncLog.err('Re-auth failed', e);
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.S.INCOMPLETE_CFG,
        translateParams: {
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }

  forceOverwrite(): void {
    // Confirmation is handled inside SyncWrapperService.forceUpload (native confirm)
    this.syncWrapperService.forceUpload();
  }

  restoreFromHistory(): void {
    this._matDialog.open(DialogRestorePointComponent, {
      width: '500px',
      maxWidth: '90vw',
    });
  }

  private async _updateReauthability(providerId: SyncProviderId | null): Promise<void> {
    if (!providerId) {
      this._canReauthSig.set(false);
      return;
    }
    const provider = await this._providerManager.getProviderById(providerId);
    if (!provider?.getAuthHelper) {
      this._canReauthSig.set(false);
      return;
    }
    this._canReauthSig.set(await provider.isReady());
  }
}
