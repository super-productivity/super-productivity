import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import {
  SYNC_FORM,
  SyncCollapsibleProps,
} from '../../../features/config/form-cfgs/sync-form.const';
import { AbstractControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { SyncConfig } from '../../../features/config/global-config.model';
import {
  OAUTH_SYNC_PROVIDERS,
  SyncProviderId,
} from '../../../op-log/sync-providers/provider.const';
import { SyncConfigService } from '../sync-config.service';
import { SyncWrapperService } from '../sync-wrapper.service';
import { firstValueFrom } from 'rxjs';
import { first } from 'rxjs/operators';
import { toSyncProviderId } from '../../../op-log/sync-exports';
import { isFileBasedProviderId } from '../../../op-log/sync/operation-sync.util';
import { SyncLog } from '../../../core/log';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';

import { GlobalConfigService } from '../../../features/config/global-config.service';
import { isOnline } from '../../../util/is-online';
import { SnackService } from '../../../core/snack/snack.service';
import { DialogRestorePointComponent } from '../dialog-restore-point/dialog-restore-point.component';
import {
  NextcloudProvider,
  type NextcloudPrivateCfg,
  type WebdavPrivateCfg,
} from '@sp/sync-providers/webdav';
import { testWebdavConnection } from '../../../op-log/sync-providers/file-based/webdav/test-webdav-connection';
import { discoverNextcloudUserId } from '../../../op-log/sync-providers/file-based/webdav/discover-nextcloud-user-id';
import type { OneDrivePrivateCfg } from '../../../op-log/sync-providers/file-based/onedrive/onedrive.model';
import type { LocalFileSyncPrivateCfg } from '@sp/sync-providers/local-file';
import type { SuperSyncPrivateCfg } from '@sp/sync-providers/super-sync';

// `testWebdavConnection` reports a 404 (auth ok, wrong DAV path) via this
// HTTP status; the package-side `WebDavHttpStatus` enum is not exported to
// the app, so the discriminator value is named locally instead of inlined.
const HTTP_NOT_FOUND = 404;

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

  private _destroyRef = inject(DestroyRef);

  T = T;
  isWasEnabled = signal(false);
  // Single source of truth — buttons appear/disappear automatically when
  // edit mode flips, no manual fields.set() required.
  fields = computed<FormlyFieldConfig[]>(() => {
    const includeEnabledToggle = this.isWasEnabled();
    return SYNC_FORM.items!.filter(
      (f) => includeEnabledToggle || f.key !== 'isEnabled',
    ).map((item) => this._injectProviderHelpers(item));
  });
  form = new FormGroup({});

  /**
   * Adds helpers into the formly field tree:
   * - Test Connection button inside WebDAV/Nextcloud sections.
   * - Re-authenticate, Force Overwrite (and Restore for SuperSync) inside the
   *   active "Advanced" collapsible (edit mode only — first-time setup gets no
   *   action buttons since there is no saved config to act on).
   *
   * Each provider has exactly one Advanced collapsible:
   * - non-SuperSync: top-level (compression, interval, manual-only) + actions
   * - SuperSync: nested inside the SuperSync provider section (server URL) + actions
   */
  private _injectProviderHelpers(item: FormlyFieldConfig): FormlyFieldConfig {
    if (item.key === 'webDav' && item.fieldGroup) {
      return {
        ...item,
        fieldGroup: [...item.fieldGroup, this._webDavTestConnectionBtn()],
      };
    }
    if (item.key === 'nextcloud' && item.fieldGroup) {
      return {
        ...item,
        fieldGroup: [
          ...item.fieldGroup,
          this._nextcloudDetectUserIdBtn(),
          this._nextcloudTestConnectionBtn(),
        ],
      };
    }
    if (
      item.type === 'collapsible' &&
      (item.props as SyncCollapsibleProps | undefined)?.syncRole === 'advanced' &&
      this.isWasEnabled()
    ) {
      return {
        ...item,
        fieldGroup: [
          ...(item.fieldGroup ?? []),
          this._reauthBtn(),
          this._forceOverwriteBtn(),
        ],
      };
    }
    if (item.key === 'superSync' && item.fieldGroup && this.isWasEnabled()) {
      return {
        ...item,
        fieldGroup: item.fieldGroup.map((child) =>
          child.type === 'collapsible' &&
          (child.props as SyncCollapsibleProps | undefined)?.syncRole === 'advanced'
            ? {
                ...child,
                fieldGroup: [
                  ...(child.fieldGroup ?? []),
                  this._forceOverwriteBtn(),
                  this._restoreBtn(),
                ],
              }
            : child,
        ),
      };
    }
    return item;
  }

  /**
   * Single helper for every action button rendered inside the form. All
   * buttons in the dialog use the stroked style; the caller may add a
   * warn `btnType`, a custom className, or a `hideExpression` for
   * conditional visibility.
   */
  private _actionBtn(opts: {
    text: string;
    onClick: (model: unknown) => void | Promise<void>;
    className?: string;
    btnType?: 'warn';
    hideExpression?: FormlyFieldConfig['hideExpression'];
  }): FormlyFieldConfig {
    return {
      type: 'btn',
      className: opts.className ?? 'mt2 block',
      hideExpression: opts.hideExpression,
      templateOptions: {
        text: opts.text,
        btnStyle: 'stroked',
        btnType: opts.btnType,
        required: false,
        onClick: (_field: unknown, _form: unknown, model: unknown) => opts.onClick(model),
      },
    };
  }

  private _webDavTestConnectionBtn(): FormlyFieldConfig {
    return this._actionBtn({
      text: T.F.SYNC.FORM.WEB_DAV.L_TEST_CONNECTION,
      className: 'mt3 block',
      onClick: (model) => this._testWebDavConnection(model as WebdavPrivateCfg),
    });
  }

  private _nextcloudTestConnectionBtn(): FormlyFieldConfig {
    return this._actionBtn({
      text: T.F.SYNC.FORM.WEB_DAV.L_TEST_CONNECTION,
      className: 'mt3 block',
      onClick: (model) => this._testNextcloudConnection(model as NextcloudPrivateCfg),
    });
  }

  private _nextcloudDetectUserIdBtn(): FormlyFieldConfig {
    return this._actionBtn({
      text: T.F.SYNC.FORM.NEXTCLOUD.L_DETECT_USER_ID,
      className: 'mt3 block',
      onClick: (model) => this._detectNextcloudUserId(model as NextcloudPrivateCfg),
    });
  }

  private _forceOverwriteBtn(): FormlyFieldConfig {
    return this._actionBtn({
      text: T.F.SYNC.S.BTN_FORCE_OVERWRITE,
      btnType: 'warn',
      onClick: () => this.forceOverwrite(),
    });
  }

  private _restoreBtn(): FormlyFieldConfig {
    return this._actionBtn({
      text: T.F.SYNC.BTN_RESTORE_FROM_HISTORY,
      onClick: () => this.restoreFromHistory(),
    });
  }

  // Re-auth is OAuth-only. Gating via OAUTH_SYNC_PROVIDERS keeps this UI
  // in lockstep with the provider-side definition without an async probe.
  private _reauthBtn(): FormlyFieldConfig {
    return this._actionBtn({
      text: T.F.SYNC.FORM.BTN_REAUTHENTICATE,
      onClick: () => this.reauth(),
      hideExpression: (m, v, field) => {
        const id = field?.parent?.parent?.model?.syncProvider as
          | SyncProviderId
          | undefined;
        return !id || !OAUTH_SYNC_PROVIDERS.has(id);
      },
    });
  }

  private async _testNextcloudConnection(cfg: NextcloudPrivateCfg): Promise<void> {
    if (
      !cfg?.serverUrl?.trim() ||
      !cfg?.userName?.trim() ||
      !cfg?.password ||
      !cfg?.syncFolderPath?.trim()
    ) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.FORM.WEB_DAV.S_FILL_ALL_FIELDS,
      });
      return;
    }
    await this._testWebDavConnection(
      {
        ...cfg,
        baseUrl: NextcloudProvider.buildBaseUrl(cfg),
        userName: NextcloudProvider.getAuthUserName(cfg),
      } as WebdavPrivateCfg,
      // A 404 on the Nextcloud base root means auth succeeded but the DAV
      // path /remote.php/dav/files/<userName>/ doesn't exist — i.e. the
      // "Username" field holds an email/display name instead of the
      // account's user ID. Surface that instead of the cryptic bare-host
      // message users misread as a stripped URL (issue #7617).
      T.F.SYNC.FORM.NEXTCLOUD.S_TEST_FAIL_USER_NOT_FOUND,
    );
  }

  /**
   * Ask the Nextcloud server for the account's canonical user ID and write it
   * into the "Username" field, so users don't have to hunt for it by hand
   * (issue #7617). Authenticates with the login name / email (or whatever is
   * in "Username") + app password; a 401 cleanly reports bad credentials.
   */
  private async _detectNextcloudUserId(cfg: NextcloudPrivateCfg): Promise<void> {
    const login = cfg?.loginName?.trim() || cfg?.userName?.trim();
    if (!cfg?.serverUrl?.trim() || !login || !cfg?.password) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.FORM.NEXTCLOUD.S_DETECT_USER_ID_NEED_LOGIN,
      });
      return;
    }
    this._applyDetectedUserIdResult(await discoverNextcloudUserId(cfg));
  }

  /**
   * Apply a `discoverNextcloudUserId` result: on success fill the "Username"
   * field with the detected user ID and confirm; otherwise surface the
   * readable failure. Split from the network call so it is unit-testable
   * without a live server (mirrors `_reportWebdavTestResult`).
   */
  private _applyDetectedUserIdResult(result: {
    success: boolean;
    userId?: string;
    error?: string;
  }): void {
    if (result.success && result.userId) {
      // formly builds the form dynamically, so the controls are untyped here.
      const userNameCtrl = this.form.get('nextcloud.userName') as AbstractControl | null;
      const loginNameCtrl = this.form.get(
        'nextcloud.loginName',
      ) as AbstractControl | null;
      // Preserve the credential that just authenticated: if "Login name" is
      // empty and the user typed their login (e.g. email) into "Username",
      // keep it as the login name before overwriting Username with the user
      // ID — otherwise the next sync would auth as the ID, which some servers
      // reject (turning a wrong-path 404 into an auth 401). See issue #7617.
      const priorUserName = ((userNameCtrl?.value as string) ?? '').trim();
      if (
        !((loginNameCtrl?.value as string) ?? '').trim() &&
        priorUserName &&
        priorUserName !== result.userId
      ) {
        loginNameCtrl?.setValue(priorUserName);
      }
      userNameCtrl?.setValue(result.userId);
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.SYNC.FORM.NEXTCLOUD.S_DETECT_USER_ID_SUCCESS,
        translateParams: { userId: result.userId },
      });
    } else {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.FORM.NEXTCLOUD.S_DETECT_USER_ID_FAIL,
        translateParams: { error: result.error || 'Unknown error' },
      });
    }
  }

  private async _testWebDavConnection(
    webDavCfg: WebdavPrivateCfg,
    notFoundMsg?: string,
  ): Promise<void> {
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
      const result = await testWebdavConnection(webDavCfg);
      this._reportWebdavTestResult(result, notFoundMsg);
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

  /**
   * Open the success/failure snack for a connection-test result. When
   * `notFoundMsg` is given (Nextcloud) and the failure is a 404, show that
   * provider-specific hint instead of the generic message — a base-root 404
   * means auth worked but the DAV user-id path is wrong (issue #7617).
   */
  private _reportWebdavTestResult(
    result: { success: boolean; error?: string; fullUrl: string; errorCode?: number },
    notFoundMsg?: string,
  ): void {
    if (result.success) {
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.SYNC.FORM.WEB_DAV.S_TEST_SUCCESS,
        translateParams: { url: result.fullUrl },
      });
    } else if (notFoundMsg && result.errorCode === HTTP_NOT_FOUND) {
      this._snackService.open({
        type: 'ERROR',
        msg: notFoundMsg,
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
  private _initialProviderId: SyncProviderId | null = null;
  private _providerConfigLoad: Promise<void> = Promise.resolve();
  private _providerConfigLoadId = 0;
  private _selectedProviderWasConfigured = false;

  constructor() {
    this.syncConfigService.syncSettingsForm$
      .pipe(first(), takeUntilDestroyed(this._destroyRef))
      .subscribe((v) => {
        this._initialProviderId = toSyncProviderId(v.syncProvider);
        this._selectedProviderWasConfigured = v.isEnabled;
        if (v.isEnabled) {
          this.isWasEnabled.set(true);
        }
        // First-time setup ⇔ sync was previously disabled. Encryption-warning
        // hideExpressions in sync-form.const.ts read this flag to suppress
        // the post-save SuperSync encryption prompt during initial setup.
        this.updateTmpCfg({
          ...v,
          isEnabled: true,
          _isInitialSetup: !v.isEnabled,
        });
      });
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
      syncProviderControl.valueChanges
        .pipe(takeUntilDestroyed(this._destroyRef))
        .subscribe((newProvider: SyncProviderId | null) => {
          if (!newProvider) {
            return;
          }

          // Get the current configuration for this provider
          const providerId = toSyncProviderId(newProvider);
          if (!providerId) {
            return;
          }

          this._providerConfigLoad = this._loadProviderConfig(providerId);
        });
    }, 0);
  }

  private async _loadProviderConfig(providerId: SyncProviderId): Promise<void> {
    const loadId = ++this._providerConfigLoadId;
    this._selectedProviderWasConfigured = false;

    // Clear provider-owned encryption synchronously. Save waits for this load,
    // but the immediate reset also prevents the previous provider's key from
    // remaining in the Formly model while the new private config is loading.
    Object.assign(this._tmpUpdatedCfg, {
      syncProvider: providerId,
      encryptKey: '',
      isEncryptionEnabled: false,
    });

    const provider = await this._providerManager.getProviderById(providerId);
    const privateCfg = provider ? await provider.privateCfg.load() : null;
    const globalCfg = await firstValueFrom(this._globalConfigService.sync$);

    // A later provider selection owns the form now. Never let an older async
    // load restore stale credentials or encryption state.
    if (loadId !== this._providerConfigLoadId) {
      return;
    }

    this._selectedProviderWasConfigured = privateCfg !== null;
    const encryptionCfg = privateCfg as {
      encryptKey?: string;
      isEncryptionEnabled?: boolean;
    } | null;
    const encryptKey = encryptionCfg?.encryptKey ?? '';
    let providerSpecificUpdate: Partial<SyncConfig> = {
      encryptKey,
      isEncryptionEnabled:
        providerId === SyncProviderId.SuperSync
          ? (encryptionCfg?.isEncryptionEnabled ?? false)
          : (encryptionCfg?.isEncryptionEnabled ?? !!encryptKey),
    };

    if (providerId === SyncProviderId.SuperSync && privateCfg) {
      providerSpecificUpdate = {
        ...providerSpecificUpdate,
        superSync: privateCfg as SuperSyncPrivateCfg,
      };
    } else if (providerId === SyncProviderId.WebDAV && privateCfg) {
      providerSpecificUpdate = {
        ...providerSpecificUpdate,
        webDav: privateCfg as WebdavPrivateCfg,
      };
    } else if (providerId === SyncProviderId.LocalFile && privateCfg) {
      providerSpecificUpdate = {
        ...providerSpecificUpdate,
        localFileSync: privateCfg as LocalFileSyncPrivateCfg,
      };
    } else if (providerId === SyncProviderId.Nextcloud && privateCfg) {
      providerSpecificUpdate = {
        ...providerSpecificUpdate,
        nextcloud: privateCfg as NextcloudPrivateCfg,
      };
    } else if (providerId === SyncProviderId.OneDrive && privateCfg) {
      providerSpecificUpdate = {
        ...providerSpecificUpdate,
        oneDrive: privateCfg as OneDrivePrivateCfg,
      };
    }

    Object.assign(this._tmpUpdatedCfg, providerSpecificUpdate, {
      syncProvider: providerId,
      // Preserve global settings (?? not || so explicit `false` is honoured)
      isEnabled: this._tmpUpdatedCfg.isEnabled,
      syncInterval: globalCfg.syncInterval ?? this._tmpUpdatedCfg.syncInterval,
      isManualSyncOnly:
        globalCfg.isManualSyncOnly ?? this._tmpUpdatedCfg.isManualSyncOnly,
      isCompressionEnabled:
        globalCfg.isCompressionEnabled ?? this._tmpUpdatedCfg.isCompressionEnabled,
    });
  }

  private async _waitForCurrentProviderConfig(): Promise<void> {
    let pendingLoad: Promise<void>;
    do {
      pendingLoad = this._providerConfigLoad;
      await pendingLoad;
    } while (pendingLoad !== this._providerConfigLoad);
  }

  close(): void {
    this._matDialogRef.close();
  }

  private async _persistOneDriveFormCfgBeforeAuth(
    providerId: SyncProviderId,
  ): Promise<void> {
    if (providerId !== SyncProviderId.OneDrive) {
      return;
    }
    const oneDriveProvider = await this._providerManager.getProviderById(providerId);
    if (oneDriveProvider) {
      const existingCfg = (await oneDriveProvider.privateCfg.load()) as
        | OneDrivePrivateCfg
        | null
        | undefined;
      const formOneDriveCfg = this._tmpUpdatedCfg.oneDrive || {};

      // If useCustomApp / clientId / tenantId changed, existing tokens are
      // bound to the old identity — clear them to force a fresh OAuth flow.
      let identityChanged = !existingCfg;
      if (existingCfg && !identityChanged) {
        const formClientId = formOneDriveCfg.clientId ?? existingCfg.clientId;
        const formTenantId = formOneDriveCfg.tenantId ?? existingCfg.tenantId;
        const formUseCustomApp = formOneDriveCfg.useCustomApp ?? existingCfg.useCustomApp;

        identityChanged =
          formUseCustomApp !== existingCfg.useCustomApp ||
          formClientId !== existingCfg.clientId ||
          formTenantId !== existingCfg.tenantId;
      }

      // Build the merged cfg explicitly so TS structurally validates the
      // result against OneDrivePrivateCfg, and so form-side `null` values
      // get coerced to `undefined` (the storage type doesn't accept null).
      // NOTE: any new field added to OneDrivePrivateCfg must be added here
      // — the explicit literal will not silently pick it up via spread.
      const clientId = formOneDriveCfg.clientId ?? existingCfg?.clientId;
      const tenantId = formOneDriveCfg.tenantId ?? existingCfg?.tenantId;
      if (!clientId || !tenantId) {
        // Form validators normally prevent this; surface a snack instead of
        // a silent no-op save if we ever reach it.
        SyncLog.err('OneDrive cfg save: missing required clientId/tenantId');
        this._snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.INCOMPLETE_CFG,
        });
        return;
      }
      const mergedCfg: OneDrivePrivateCfg = {
        encryptKey: existingCfg?.encryptKey,
        useCustomApp: formOneDriveCfg.useCustomApp ?? existingCfg?.useCustomApp,
        clientId,
        tenantId,
        syncFolderPath: formOneDriveCfg.syncFolderPath ?? existingCfg?.syncFolderPath,
        accessToken: identityChanged ? '' : existingCfg?.accessToken,
        refreshToken: identityChanged ? '' : existingCfg?.refreshToken,
        tokenExpiresAt: identityChanged ? 0 : existingCfg?.tokenExpiresAt,
      };
      await oneDriveProvider.privateCfg.setComplete(mergedCfg);
    }
  }

  async save(): Promise<void> {
    // Check if form is valid
    if (!this.form.valid) {
      // Mark all fields as touched to show validation errors
      this.form.markAllAsTouched();
      SyncLog.err('Sync form validation failed', this.form.errors);
      return;
    }

    await this._waitForCurrentProviderConfig();

    // Explicitly sync form values to _tmpUpdatedCfg in case modelChange didn't fire
    // This is especially important on Android WebView where change detection can be unreliable
    this._tmpUpdatedCfg = {
      ...this._tmpUpdatedCfg,
      ...this.form.value,
    };

    // Strip _isInitialSetup before saving — it's only for form hideExpressions
    // and the fresh-setup encryption-prompt decision below.
    const { _isInitialSetup, ...cfgWithoutFlag } = this._tmpUpdatedCfg;
    const configToSave = {
      ...cfgWithoutFlag,
      isEnabled: this._tmpUpdatedCfg.isEnabled || !this.isWasEnabled(),
    };

    const providerId = toSyncProviderId(this._tmpUpdatedCfg.syncProvider);
    // Switching providers is a first setup only when the target has no stored
    // private config. Returning providers must keep their existing encryption
    // contract instead of being offered a new, incompatible key.
    const isProviderSetup =
      _isInitialSetup ||
      (providerId !== this._initialProviderId && !this._selectedProviderWasConfigured);
    let selectedProvider: Awaited<ReturnType<SyncProviderManager['getProviderById']>> =
      undefined;
    if (providerId && this._tmpUpdatedCfg.isEnabled) {
      if (providerId === SyncProviderId.OneDrive) {
        await this._persistOneDriveFormCfgBeforeAuth(providerId);
      }

      await this.syncWrapperService.configuredAuthForSyncProviderIfNecessary(providerId);

      // If the provider requires auth (e.g. Dropbox) and is still not ready,
      // the auth dialog was cancelled or failed. Keep the dialog open so the
      // user can retry, and do not persist isEnabled:true with missing credentials
      // (which would trigger the "Sync credentials are missing" snack loop — issue #7131).
      selectedProvider = await this._providerManager.getProviderById(providerId);
      if (selectedProvider?.getAuthHelper && !(await selectedProvider.isReady())) {
        return;
      }
    }

    // The Formly value can briefly retain the previous provider's root-level
    // encryption fields during a provider switch. The selected provider's
    // private config is the authority, so re-derive both fields at the save
    // boundary before any setup prompt or persistence occurs.
    if (providerId) {
      selectedProvider ??= await this._providerManager.getProviderById(providerId);
      const privateCfg = selectedProvider?.privateCfg
        ? await selectedProvider.privateCfg.load()
        : null;
      const encryptionCfg = privateCfg as {
        encryptKey?: string;
        isEncryptionEnabled?: boolean;
      } | null;
      const encryptKey = encryptionCfg?.encryptKey ?? '';
      configToSave.encryptKey = encryptKey;
      configToSave.isEncryptionEnabled =
        providerId === SyncProviderId.SuperSync
          ? (encryptionCfg?.isEncryptionEnabled ?? false)
          : (encryptionCfg?.isEncryptionEnabled ?? !!encryptKey);
    }

    // File-based providers support OPTIONAL E2EE but (unlike SuperSync) have no
    // mandatory-encryption upload guard. So instead of prompting AFTER the first
    // sync (which would already have shipped plaintext, and would race the auto
    // "just enabled" sync), offer to set the encryption password here and persist
    // it as part of THIS config save. The key lands in the provider's privateCfg
    // and `isEncryptionEnabled` in the global config atomically with `isEnabled`,
    // so the normal first sync encrypts from the very first op — no separate
    // snapshot-overwrite, no plaintext-upload window. Skipping keeps today's
    // unencrypted behavior. No network needed, so this also covers offline setup.
    if (
      isProviderSetup &&
      providerId &&
      isFileBasedProviderId(providerId) &&
      !configToSave.isEncryptionEnabled
    ) {
      const encryptKey = await this._collectFileBasedSetupEncryptionKey();
      if (encryptKey) {
        configToSave.encryptKey = encryptKey;
        configToSave.isEncryptionEnabled = true;
      }
    }

    await this.syncConfigService.updateSettingsFromForm(configToSave as SyncConfig, true);
    this._matDialogRef.close();

    // Enabling SuperSync from a previously-disabled state: arm the one-time setup
    // encryption modal for the setup sync. Done OUTSIDE the isOnline() guard because
    // an offline save still needs the flag armed for whenever the setup sync finally
    // runs (else the prompt is silently skipped and the account syncs unencrypted).
    // Established/returning accounts are nudged by the calm migration banner instead.
    if (isProviderSetup && providerId === SyncProviderId.SuperSync) {
      this.syncWrapperService.markPromptEncryptionAfterSetupSync();
    }

    if (isOnline()) {
      this.syncWrapperService.sync(true);
    }
  }

  /**
   * Open the encryption dialog in collect-only mode to gather an optional
   * setup password for a file-based provider. Returns the password, or `null`
   * if the user skipped. Performs no side effect — the caller persists the key
   * as part of the sync config so the normal first sync encrypts from op #1.
   */
  private async _collectFileBasedSetupEncryptionKey(): Promise<string | null> {
    const { DialogEnableEncryptionComponent } =
      await import('../dialog-enable-encryption/dialog-enable-encryption.component');
    const dialogRef = this._matDialog.open(DialogEnableEncryptionComponent, {
      width: '450px',
      disableClose: true,
      data: {
        providerType: 'file-based',
        initialSetup: true,
        collectPasswordOnly: true,
      },
    });
    const result = await firstValueFrom(dialogRef.afterClosed());
    return result?.success && result.password ? result.password : null;
  }

  updateTmpCfg(cfg: SyncConfig & { _isInitialSetup?: boolean }): void {
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
      if (providerId === SyncProviderId.OneDrive) {
        await this._persistOneDriveFormCfgBeforeAuth(providerId);
      }

      const result =
        await this.syncWrapperService.configuredAuthForSyncProviderIfNecessary(
          providerId,
          true,
        );
      if (result.wasConfigured) {
        this._snackService.open({
          type: 'SUCCESS',
          msg: T.F.SYNC.FORM.REAUTH_SUCCESS,
        });
      }
    } catch (e) {
      // Log history is exportable, so log only a redacted discriminator —
      // never raw `Error.message` (which can carry tokens / URLs / stacks).
      // The user-facing snack just shows the static "credentials missing"
      // copy; INCOMPLETE_CFG has no error placeholder, so no leak path.
      SyncLog.err('Re-auth failed', { name: _redactErrorName(e) });
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.S.INCOMPLETE_CFG,
      });
    }
  }

  /** Confirmation handled inside `SyncWrapperService.forceUpload` (native
   *  confirm, shared with snackbar action callers). */
  forceOverwrite(): void {
    this.syncWrapperService.forceUpload();
  }

  restoreFromHistory(): void {
    this._matDialog.open(DialogRestorePointComponent, {
      width: '500px',
      maxWidth: '90vw',
    });
  }
}

/**
 * Coarse, redacted discriminator for an unknown thrown value — safe for
 * exportable log history. Returns the Error subclass name for instances
 * (e.g. "TypeError") and a single bucket for everything else.
 */
const _redactErrorName = (e: unknown): string =>
  e instanceof Error ? e.name : 'UnknownError';
