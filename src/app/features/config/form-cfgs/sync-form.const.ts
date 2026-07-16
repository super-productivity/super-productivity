/* eslint-disable @typescript-eslint/naming-convention */
import { T } from '../../../t.const';
import { ConfigFormSection, SyncConfig } from '../global-config.model';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { IS_ELECTRON } from '../../../app.constants';
import {
  loadSyncProviders,
  LocalFileSyncPicker,
} from '../../../op-log/sync-providers/sync-providers.factory';
import { FormlyFieldConfig, FormlyFieldProps } from '@ngx-formly/core';

/**
 * Stable structural marker on the "Advanced" collapsibles so the dialog
 * component can route action-button injection without depending on the
 * (globally shared) translation key in `props.label`.
 */
export interface SyncCollapsibleProps extends FormlyFieldProps {
  syncRole?: 'advanced';
}
import { IS_NATIVE_PLATFORM } from '../../../util/is-native-platform';
import { SUPER_SYNC_DEFAULT_BASE_URL } from '@sp/sync-providers/super-sync';
import {
  closeAllDialogs,
  openDisableEncryptionDialogForFileBased,
  openEnableEncryptionDialog,
  openEnableEncryptionDialogForFileBased,
  openEncryptionPasswordChangeDialog,
  openEncryptionPasswordChangeDialogForFileBased,
} from '../../../imex/sync/encryption-password-dialog-opener.service';
import {
  HAS_OFFICIAL_ONEDRIVE_CLIENT_ID,
  IS_ONEDRIVE_SUPPORTED,
} from '../../../imex/sync/onedrive-auth-mode.const';

/**
 * Creates form fields for WebDAV-based sync providers.
 * Reusable for both standard WebDAV and SuperSync.
 *
 * @param options - Configuration options for the form fields
 * @returns Array of Formly field configurations
 */
const createWebdavFormFields = (options: {
  infoText?: string;
  corsInfoText: string;
  baseUrlDescription: string;
}): FormlyFieldConfig[] => {
  return [
    ...(options.infoText
      ? [
          {
            type: 'tpl',
            templateOptions: {
              tag: 'div',
              text: options.infoText,
              class: 'sync-warning',
            },
          },
        ]
      : []),
    // Hide CORS info for Electron and native mobile apps (iOS/Android) since they handle CORS natively
    ...(!IS_ELECTRON && !IS_NATIVE_PLATFORM
      ? [
          {
            type: 'tpl',
            templateOptions: {
              tag: 'p',
              text: options.corsInfoText,
            },
          },
        ]
      : []),
    {
      key: 'baseUrl',
      type: 'input',
      className: 'e2e-baseUrl',
      templateOptions: {
        label: T.F.SYNC.FORM.WEB_DAV.L_BASE_URL,
        description: options.baseUrlDescription,
      },
      expressions: {
        'props.required': (field: FormlyFieldConfig) =>
          isSyncProvider(field, 2, SyncProviderId.WebDAV),
      },
    },
    {
      key: 'userName',
      type: 'input',
      className: 'e2e-userName',
      templateOptions: {
        label: T.F.SYNC.FORM.WEB_DAV.L_USER_NAME,
      },
      expressions: {
        'props.required': (field: FormlyFieldConfig) =>
          isSyncProvider(field, 2, SyncProviderId.WebDAV),
      },
    },
    {
      key: 'password',
      type: 'input',
      className: 'e2e-password',
      templateOptions: {
        type: 'password',
        label: T.F.SYNC.FORM.WEB_DAV.L_PASSWORD,
      },
      expressions: {
        'props.required': (field: FormlyFieldConfig) =>
          isSyncProvider(field, 2, SyncProviderId.WebDAV),
      },
    },
    {
      key: 'syncFolderPath',
      type: 'input',
      className: 'e2e-syncFolderPath',
      templateOptions: {
        label: T.F.SYNC.FORM.WEB_DAV.L_SYNC_FOLDER_PATH,
      },
      expressions: {
        'props.required': (field: FormlyFieldConfig) =>
          isSyncProvider(field, 2, SyncProviderId.WebDAV),
      },
    },
  ];
};

/**
 * Reads the sync form's root `syncProvider`, given a field some number of
 * `.parent` hops below the root. Centralized because Formly's parent-depth
 * is otherwise easy to get wrong when copy-pasting a predicate to a field at
 * a different nesting level: `depth: 1` for a field placed directly in
 * `SYNC_FORM.items` (typically a provider's `fieldGroup` wrapper), `depth: 2`
 * for a field nested one level inside such a fieldGroup.
 */
const rootSyncProvider = (
  field: FormlyFieldConfig | undefined,
  depth: 1 | 2,
): SyncProviderId | null | undefined => {
  const root = depth === 1 ? field?.parent : field?.parent?.parent;
  return root?.model?.syncProvider;
};

const isSyncProvider = (
  field: FormlyFieldConfig | undefined,
  depth: 1 | 2,
  providerId: SyncProviderId | null,
): boolean => rootSyncProvider(field, depth) === providerId;

const isNotSyncProvider = (
  field: FormlyFieldConfig | undefined,
  depth: 1 | 2,
  providerId: SyncProviderId | null,
): boolean => rootSyncProvider(field, depth) !== providerId;

const isOneDriveClientIdRequired = (field: FormlyFieldConfig): boolean => {
  if (!isSyncProvider(field, 2, SyncProviderId.OneDrive)) {
    return false;
  }

  // If no official app client ID is available, users must provide their own.
  // If an official app client ID is available, clientId is only required when
  // users explicitly switch to custom app mode.
  return !HAS_OFFICIAL_ONEDRIVE_CLIENT_ID || !!field?.parent?.model?.useCustomApp;
};

export const SYNC_FORM: ConfigFormSection<SyncConfig> = {
  title: T.F.SYNC.FORM.TITLE,
  key: 'sync',
  items: [
    {
      key: 'isEnabled',
      className: 'tour-isSyncEnabledToggle',
      type: 'checkbox',
      templateOptions: {
        label: T.F.SYNC.FORM.L_ENABLE_SYNCING,
      },
    },

    {
      key: 'syncProvider',
      type: 'select',
      templateOptions: {
        label: T.F.SYNC.FORM.L_SYNC_PROVIDER,
        required: true,
        options: [
          { label: 'SuperSync (Beta)', value: SyncProviderId.SuperSync },
          { label: SyncProviderId.Dropbox, value: SyncProviderId.Dropbox },
          { label: 'Nextcloud', value: SyncProviderId.Nextcloud },
          ...(IS_ONEDRIVE_SUPPORTED
            ? [
                {
                  label: 'Microsoft 365 / OneDrive (experimental)',
                  value: SyncProviderId.OneDrive,
                },
              ]
            : []),
          {
            label: 'WebDAV (not recommended / no support)',
            value: SyncProviderId.WebDAV,
          },
          ...(IS_ELECTRON || IS_ANDROID_WEB_VIEW
            ? [
                {
                  label: 'LocalFile (experimental &  deprecated)',
                  value: SyncProviderId.LocalFile,
                },
              ]
            : []),
        ],
      },
    },
    {
      hideExpression: (m, v, field) =>
        isNotSyncProvider(field, 1, SyncProviderId.LocalFile) || IS_ANDROID_WEB_VIEW,
      resetOnHide: false,
      key: 'localFileSync',
      fieldGroup: [
        {
          type: 'tpl',
          templateOptions: {
            tag: 'div',
            text: T.F.SYNC.FORM.LOCAL_FILE.INFO_TEXT,
            class: 'sync-warning',
          },
        },
        {
          // No `key` on purpose: post-#8228 the sync folder path is owned
          // main-side. The picker's return value is for display only and
          // must not write back into the renderer credential store.
          // Prepare-only (#9075): main holds the pick as a pending candidate;
          // DialogSyncCfgComponent.save() commits it (and fires the
          // target-change invalidation there); closing without save discards.
          type: 'btn',
          templateOptions: {
            text: T.F.SYNC.FORM.LOCAL_FILE.L_SYNC_FOLDER_PATH,
            btnStyle: 'stroked',
            onClick: async () => {
              const providers = await loadSyncProviders();
              const localProvider = providers.find(
                (p) => p.id === SyncProviderId.LocalFile,
              );
              return (localProvider as LocalFileSyncPicker | undefined)?.pickDirectory();
            },
          },
        },
      ],
    },
    {
      hideExpression: (m, v, field) =>
        isNotSyncProvider(field, 1, SyncProviderId.LocalFile) || !IS_ANDROID_WEB_VIEW,
      resetOnHide: false,
      key: 'localFileSync',
      fieldGroup: [
        {
          type: 'tpl',
          templateOptions: {
            tag: 'div',
            text: T.F.SYNC.FORM.LOCAL_FILE.INFO_TEXT,
            class: 'sync-warning',
          },
        },
        {
          type: 'btn',
          key: 'safFolderUri',
          templateOptions: {
            text: T.F.SYNC.FORM.LOCAL_FILE.L_SYNC_FOLDER_PATH,
            btnStyle: 'stroked',
            onClick: async () => {
              // NOTE: this actually sets the value in the model — and ONLY
              // the model (#9075). The URI is persisted by settings Save via
              // setProviderConfig, whose config diff detects the target move
              // (safFolderUri is identity-affecting), so Cancel abandons the
              // pick. setupSaf throws on cancel, so a value = success.
              const providers = await loadSyncProviders();
              const localProvider = providers.find(
                (p) => p.id === SyncProviderId.LocalFile,
              );
              return (localProvider as LocalFileSyncPicker | undefined)?.setupSaf();
            },
          },
          expressions: {
            'props.required': (field: FormlyFieldConfig) =>
              isSyncProvider(field, 2, SyncProviderId.LocalFile),
          },
        },
      ],
    },

    // Nextcloud provider form fields
    {
      hideExpression: (m, v, field) =>
        isNotSyncProvider(field, 1, SyncProviderId.Nextcloud),
      resetOnHide: false,
      key: 'nextcloud',
      fieldGroup: [
        // CORS info (web only)
        ...(!IS_ELECTRON && !IS_NATIVE_PLATFORM
          ? [
              {
                type: 'tpl',
                templateOptions: {
                  tag: 'p',
                  text: T.F.SYNC.FORM.WEB_DAV.CORS_INFO,
                },
              },
            ]
          : []),
        {
          key: 'serverUrl',
          type: 'input',
          templateOptions: {
            label: T.F.SYNC.FORM.NEXTCLOUD.L_SERVER_URL,
            description: T.F.SYNC.FORM.NEXTCLOUD.SERVER_URL_DESCRIPTION,
          },
          expressions: {
            'props.required': (field: FormlyFieldConfig) =>
              isSyncProvider(field, 2, SyncProviderId.Nextcloud),
          },
        },
        {
          key: 'userName',
          type: 'input',
          templateOptions: {
            label: T.F.SYNC.FORM.NEXTCLOUD.L_FILE_USER_NAME,
            description: T.F.SYNC.FORM.NEXTCLOUD.FILE_USER_NAME_DESCRIPTION,
          },
          expressions: {
            'props.required': (field: FormlyFieldConfig) =>
              isSyncProvider(field, 2, SyncProviderId.Nextcloud),
          },
        },
        {
          key: 'loginName',
          type: 'input',
          templateOptions: {
            label: T.F.SYNC.FORM.NEXTCLOUD.L_LOGIN_NAME,
            description: T.F.SYNC.FORM.NEXTCLOUD.LOGIN_NAME_DESCRIPTION,
          },
        },
        {
          key: 'password',
          type: 'input',
          templateOptions: {
            type: 'password',
            label: T.F.SYNC.FORM.NEXTCLOUD.L_APP_PASSWORD,
            description: T.F.SYNC.FORM.NEXTCLOUD.APP_PASSWORD_DESCRIPTION,
          },
          expressions: {
            'props.required': (field: FormlyFieldConfig) =>
              isSyncProvider(field, 2, SyncProviderId.Nextcloud),
          },
        },
        {
          key: 'syncFolderPath',
          type: 'input',
          templateOptions: {
            label: T.F.SYNC.FORM.WEB_DAV.L_SYNC_FOLDER_PATH,
          },
          expressions: {
            'props.required': (field: FormlyFieldConfig) =>
              isSyncProvider(field, 2, SyncProviderId.Nextcloud),
          },
        },
      ],
    },

    // WebDAV provider form fields
    {
      hideExpression: (m, v, field) => isNotSyncProvider(field, 1, SyncProviderId.WebDAV),
      resetOnHide: false,
      key: 'webDav',
      fieldGroup: createWebdavFormFields({
        infoText: T.F.SYNC.FORM.WEB_DAV.INFO,
        corsInfoText: T.F.SYNC.FORM.WEB_DAV.CORS_INFO,
        baseUrlDescription:
          '* e.g. https://your-server/remote.php/dav/files/yourUserName/',
      }),
    },

    // Dropbox provider authentication
    // Note: No key needed - Dropbox credentials stored privately via SyncCredentialStore
    {
      hideExpression: (m, v, field) =>
        isNotSyncProvider(field, 1, SyncProviderId.Dropbox),
      resetOnHide: false,
      fieldGroup: [
        {
          type: 'tpl',
          templateOptions: {
            tag: 'p',
            text: T.F.SYNC.FORM.DROPBOX.INFO_TEXT,
          },
        },
      ],
    },
    // OneDrive provider form fields
    {
      hideExpression: (m, v, field) =>
        isNotSyncProvider(field, 1, SyncProviderId.OneDrive),
      resetOnHide: false,
      key: 'oneDrive',
      fieldGroup: [
        {
          type: 'tpl',
          templateOptions: {
            tag: 'div',
            text: T.F.SYNC.FORM.ONEDRIVE.PLATFORM_INFO,
            class: 'info-panel',
          },
        },
        ...(HAS_OFFICIAL_ONEDRIVE_CLIENT_ID
          ? [
              {
                type: 'tpl',
                hideExpression: (m: any) => !!m?.useCustomApp,
                templateOptions: {
                  tag: 'p',
                  text: T.F.SYNC.FORM.ONEDRIVE.OFFICIAL_MODE_INFO,
                },
              },
              {
                key: 'useCustomApp',
                type: 'checkbox',
                defaultValue: false,
                templateOptions: {
                  label: T.F.SYNC.FORM.ONEDRIVE.L_USE_CUSTOM_APP,
                  description: T.F.SYNC.FORM.ONEDRIVE.USE_CUSTOM_APP_DESCRIPTION,
                },
              },
            ]
          : []),
        {
          key: 'clientId',
          type: 'input',
          hideExpression: (m: any) => HAS_OFFICIAL_ONEDRIVE_CLIENT_ID && !m?.useCustomApp,
          templateOptions: {
            label: T.F.SYNC.FORM.ONEDRIVE.L_CLIENT_ID,
            description: T.F.SYNC.FORM.ONEDRIVE.CLIENT_ID_DESCRIPTION,
          },
          expressions: {
            'props.required': (field: FormlyFieldConfig) =>
              isOneDriveClientIdRequired(field),
          },
        },
        {
          key: 'tenantId',
          type: 'input',
          templateOptions: {
            label: T.F.SYNC.FORM.ONEDRIVE.L_TENANT_ID,
            description: T.F.SYNC.FORM.ONEDRIVE.TENANT_ID_DESCRIPTION,
          },
        },
        {
          key: 'syncFolderPath',
          type: 'input',
          templateOptions: {
            label: T.F.SYNC.FORM.ONEDRIVE.L_SYNC_FOLDER_PATH,
            description: T.F.SYNC.FORM.ONEDRIVE.SYNC_FOLDER_PATH_DESCRIPTION,
          },
        },
      ],
    },

    // OneDrive provider authentication panel
    {
      hideExpression: (m, v, field) =>
        isNotSyncProvider(field, 1, SyncProviderId.OneDrive),
      resetOnHide: false,
      props: {},
      fieldGroup: [
        {
          type: 'tpl',
          templateOptions: {
            tag: 'p',
            text: T.F.SYNC.FORM.ONEDRIVE.INFO_TEXT,
          },
        },
      ],
    },

    // Encryption status box - shown when encryption is enabled (for any provider)
    {
      hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
        !(field?.parent?.model?.isEncryptionEnabled ?? false),
      className: 'encryption-status-box',
      fieldGroup: [
        {
          type: 'tpl',
          className: 'tpl',
          templateOptions: {
            tag: 'div',
            class: 'password-set-info',
            text: T.F.SYNC.FORM.PASSWORD_SET_INFO,
          },
        },
        {
          type: 'btn',
          className: 'e2e-change-password-btn',
          templateOptions: {
            text: T.F.SYNC.FORM.BTN_CHANGE_PASSWORD,
            btnType: 'primary',
            btnStyle: 'stroked',
            onClick: async (field: FormlyFieldConfig) => {
              const isSuperSync = isSyncProvider(field, 2, SyncProviderId.SuperSync);
              await (isSuperSync
                ? openEncryptionPasswordChangeDialog()
                : openEncryptionPasswordChangeDialogForFileBased());
            },
          },
        },
        // Hide disable encryption for SuperSync — encryption is mandatory
        {
          hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
            isSyncProvider(field, 2, SyncProviderId.SuperSync),
          type: 'btn',
          className: 'e2e-disable-encryption-btn',
          templateOptions: {
            text: T.F.SYNC.FORM.BTN_DISABLE_ENCRYPTION,
            btnType: 'primary',
            btnStyle: 'stroked',
            onClick: async (field: FormlyFieldConfig) => {
              const result = await openDisableEncryptionDialogForFileBased();
              if (
                result?.success &&
                result?.encryptionRemoved &&
                field?.parent?.parent?.model
              ) {
                field.parent.parent.model.isEncryptionEnabled = false;
                if (field?.parent?.parent?.model) {
                  field.parent.parent.model.encryptKey = '';
                }
                closeAllDialogs();
              }
            },
          },
        },
      ],
    },

    // COMMON SETTINGS
    // Hide for SuperSync during first-time setup (uses fixed settings; no buttons to host).
    // The dialog component drops this hide in edit mode and appends action buttons.
    {
      type: 'collapsible',
      hideExpression: (m, v, field) => isSyncProvider(field, 1, SyncProviderId.SuperSync),
      // syncRole is a stable structural marker the dialog routes on, so a
      // future global rename of T.G.ADVANCED_CFG cannot silently break it.
      props: { label: T.G.ADVANCED_CFG, syncRole: 'advanced' } as SyncCollapsibleProps,
      fieldGroup: [
        {
          key: 'syncInterval',
          type: 'duration',
          // Hide when manual sync only is enabled (parent.parent reaches the form root)
          hideExpression: (m, v, field) =>
            field?.parent?.parent?.model?.isManualSyncOnly === true,
          resetOnHide: true,
          templateOptions: {
            required: true,
            isAllowSeconds: true,
            label: T.F.SYNC.FORM.L_SYNC_INTERVAL,
            description: T.G.DURATION_DESCRIPTION,
          },
        },
        {
          key: 'isManualSyncOnly',
          type: 'checkbox',
          // Only show for file-based providers (Dropbox, WebDAV, LocalFile, Nextcloud)
          hideExpression: (m, v, field) => isSyncProvider(field, 2, null),
          templateOptions: {
            label: T.F.SYNC.FORM.L_MANUAL_SYNC_ONLY,
          },
        },
        {
          key: 'isCompressionEnabled',
          type: 'checkbox',
          templateOptions: {
            label: T.F.SYNC.FORM.L_ENABLE_COMPRESSION,
          },
        },
        {
          // SPAP-11: opt-in split-file ("Surgical") sync. Only relevant for
          // file-based providers (Dropbox, WebDAV, LocalFile, Nextcloud, OneDrive).
          key: 'isUseSplitSyncFiles',
          type: 'checkbox',
          hideExpression: (m, v, field) =>
            isSyncProvider(field, 2, null) ||
            isSyncProvider(field, 2, SyncProviderId.SuperSync),
          templateOptions: {
            label: T.F.SYNC.FORM.L_USE_SPLIT_SYNC_FILES,
          },
        },
        // Enable encryption button for file-based providers (shown when encryption is disabled)
        {
          hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
            isSyncProvider(field, 2, SyncProviderId.SuperSync) || m.isEncryptionEnabled,
          type: 'btn',
          className: 'e2e-file-based-enable-encryption-btn',
          templateOptions: {
            text: T.F.SYNC.FORM.FILE_BASED.BTN_ENABLE_ENCRYPTION,
            btnType: 'primary',
            btnStyle: 'stroked',
            onClick: async (field: FormlyFieldConfig) => {
              const result = await openEnableEncryptionDialogForFileBased();
              if (result?.success && field?.model) {
                field.model.isEncryptionEnabled = true;
              }
              return result?.success ? true : false;
            },
          },
        },
      ],
    },

    // SuperSync provider form fields
    // NOTE: We use hideExpression on individual fields instead of the fieldGroup
    // because Formly doesn't include values from hidden fieldGroups in the model output
    {
      key: 'superSync',
      fieldGroup: [
        // Encryption info line — shown the moment SuperSync is selected so the
        // mandatory client-side encryption step is visible before a token is
        // entered. Hidden once encryption is set up (the encryption-status-box
        // above already shows "Encryption password is set" in that case).
        {
          hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
            isNotSyncProvider(field, 2, SyncProviderId.SuperSync) ||
            (field?.parent?.parent?.model?.isEncryptionEnabled ?? false),
          type: 'tpl',
          templateOptions: {
            tag: 'div',
            text: T.F.SYNC.FORM.SUPER_SYNC.E2E_ENCRYPTION_INFO,
            class: 'info-panel info-panel--encryption',
          },
        },
        {
          hideExpression: (m, v, field) =>
            isNotSyncProvider(field, 2, SyncProviderId.SuperSync),
          type: 'btn',
          templateOptions: {
            text: T.F.SYNC.FORM.SUPER_SYNC.BTN_GET_TOKEN,
            tooltip: T.F.SYNC.FORM.SUPER_SYNC.LOGIN_INSTRUCTIONS,
            btnType: 'primary',
            btnStyle: 'stroked',
            centerBtn: true,
            onClick: (field: any) => {
              const baseUrl = field.model.baseUrl || SUPER_SYNC_DEFAULT_BASE_URL;
              window.open(baseUrl, '_blank');
            },
          },
        },
        {
          hideExpression: (m, v, field) =>
            isNotSyncProvider(field, 2, SyncProviderId.SuperSync),
          key: 'accessToken',
          type: 'textarea',
          className: 'e2e-accessToken',
          templateOptions: {
            label: T.F.SYNC.FORM.SUPER_SYNC.L_ACCESS_TOKEN,
            description: T.F.SYNC.FORM.SUPER_SYNC.ACCESS_TOKEN_DESCRIPTION,
            rows: 3,
          },
          expressions: {
            'props.required': (field: FormlyFieldConfig) =>
              isSyncProvider(field, 2, SyncProviderId.SuperSync),
          },
        },
        // Encryption encouragement warning (shown when encryption is NOT enabled)
        // Hidden during initial setup (encryption dialog opens automatically after save).
        // Reads root `isEncryptionEnabled` so it stays in lockstep with the
        // encryption-status-box / BTN_CHANGE_PASSWORD above (sync.service derives
        // the root flag from SuperSync's privateCfg.isEncryptionEnabled).
        {
          hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
            isNotSyncProvider(field, 2, SyncProviderId.SuperSync) ||
            (field?.parent?.parent?.model?.isEncryptionEnabled ?? false) ||
            field?.parent?.parent?.model?._isInitialSetup === true,
          type: 'tpl',
          templateOptions: {
            tag: 'p',
            class: 'encryption-warning',
            text: T.F.SYNC.FORM.SUPER_SYNC.ENCRYPTION_ENCOURAGED,
          },
        },
        // Enable encryption button for SuperSync (shown when encryption is disabled)
        // Hidden during initial setup (encryption dialog opens automatically after save)
        {
          hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
            isNotSyncProvider(field, 2, SyncProviderId.SuperSync) ||
            (field?.parent?.parent?.model?.isEncryptionEnabled ?? false) ||
            field?.parent?.parent?.model?._isInitialSetup === true,
          type: 'btn',
          className: 'e2e-enable-encryption-btn',
          templateOptions: {
            text: T.F.SYNC.FORM.SUPER_SYNC.BTN_ENABLE_ENCRYPTION,
            btnType: 'primary',
            btnStyle: 'stroked',
            onClick: async (field: FormlyFieldConfig) => {
              const result = await openEnableEncryptionDialog();
              if (result?.success) {
                // Two writes are needed (asymmetric with the Disable flow,
                // which only needs the root write):
                //   - Sub-model: `sync-config.service._deriveEncryptionState
                //     ForSuperSync` reads `superSync.isEncryptionEnabled`
                //     first in its fallback chain (privateCfg comes second).
                //     Writing it here ensures the next form-save derives
                //     `true` even if `privateCfg` propagation lags.
                //   - Root: sibling hideExpressions (info-panel,
                //     ENCRYPTION_ENCOURAGED, this button) read the root
                //     flag, so it must flip in the current Formly tick to
                //     hide them immediately.
                if (field?.model) {
                  field.model.isEncryptionEnabled = true;
                }
                if (field?.parent?.parent?.model) {
                  field.parent.parent.model.isEncryptionEnabled = true;
                }
              }
              return result?.success ? true : false;
            },
          },
        },
        // Advanced settings for SuperSync
        {
          type: 'collapsible',
          hideExpression: (m, v, field) =>
            isNotSyncProvider(field, 2, SyncProviderId.SuperSync),
          props: {
            label: T.G.ADVANCED_CFG,
            syncRole: 'advanced',
          } as SyncCollapsibleProps,
          fieldGroup: [
            // Server URL
            {
              key: 'baseUrl',
              type: 'input',
              className: 'e2e-baseUrl',
              templateOptions: {
                label: T.F.SYNC.FORM.SUPER_SYNC.L_SERVER_URL,
                description: T.F.SYNC.FORM.SUPER_SYNC.SERVER_URL_DESCRIPTION,
                placeholder: SUPER_SYNC_DEFAULT_BASE_URL,
              },
            },
          ],
        },
      ],
    },
  ],
};
