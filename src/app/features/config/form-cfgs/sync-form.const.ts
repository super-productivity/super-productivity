/* eslint-disable @typescript-eslint/naming-convention */
import { T } from '../../../t.const';
import { ConfigFormSection, SyncConfig } from '../global-config.model';
import { LegacySyncProvider } from '../../../imex/sync/legacy-sync-provider.model';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { IS_ELECTRON } from '../../../app.constants';
import { fileSyncDroid, fileSyncElectron } from '../../../op-log/model/model-config';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { IS_NATIVE_PLATFORM } from '../../../util/is-native-platform';
import { SUPER_SYNC_DEFAULT_BASE_URL } from '../../../op-log/sync-providers/super-sync/super-sync.model';
import {
  closeAllDialogs,
  openDisableEncryptionDialog,
  openDisableEncryptionDialogForFileBased,
  openEnableEncryptionDialog,
  openEnableEncryptionDialogForFileBased,
  openEncryptionPasswordChangeDialog,
  openEncryptionPasswordChangeDialogForFileBased,
} from '../../../imex/sync/encryption-password-dialog-opener.service';

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
              tag: 'p',
              text: options.infoText,
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
          field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.WebDAV,
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
          field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.WebDAV,
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
          field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.WebDAV,
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
          field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.WebDAV,
      },
    },
  ];
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
          { label: 'SuperSync (Beta)', value: LegacySyncProvider.SuperSync },
          { label: LegacySyncProvider.Dropbox, value: LegacySyncProvider.Dropbox },
          { label: 'WebDAV (experimental)', value: LegacySyncProvider.WebDAV },
          ...(IS_ELECTRON || IS_ANDROID_WEB_VIEW
            ? [
                {
                  label: 'LocalFile (experimental)',
                  value: LegacySyncProvider.LocalFile,
                },
              ]
            : []),
        ],
      },
    },
    {
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider !== LegacySyncProvider.LocalFile ||
        IS_ANDROID_WEB_VIEW,
      resetOnHide: false,
      key: 'localFileSync',
      fieldGroup: [
        {
          type: 'tpl',
          templateOptions: {
            tag: 'p',
            text: T.F.SYNC.FORM.LOCAL_FILE.INFO_TEXT,
          },
        },
        {
          type: 'btn',
          key: 'syncFolderPath',
          templateOptions: {
            text: T.F.SYNC.FORM.LOCAL_FILE.L_SYNC_FOLDER_PATH,
            onClick: () => {
              return fileSyncElectron.pickDirectory();
            },
          },
          expressions: {
            'props.required': (field: FormlyFieldConfig) =>
              field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.LocalFile,
          },
        },
      ],
    },
    {
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider !== LegacySyncProvider.LocalFile ||
        !IS_ANDROID_WEB_VIEW,
      resetOnHide: false,
      key: 'localFileSync',
      fieldGroup: [
        {
          type: 'tpl',
          templateOptions: {
            tag: 'p',
            text: T.F.SYNC.FORM.LOCAL_FILE.INFO_TEXT,
          },
        },
        {
          type: 'btn',
          key: 'safFolderUri',
          templateOptions: {
            text: T.F.SYNC.FORM.LOCAL_FILE.L_SYNC_FOLDER_PATH,
            onClick: () => {
              // NOTE: this actually sets the value in the model
              return fileSyncDroid.setupSaf();
            },
          },
          expressions: {
            'props.required': (field: FormlyFieldConfig) =>
              field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.LocalFile,
          },
        },
      ],
    },

    // WebDAV provider form fields
    {
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider !== LegacySyncProvider.WebDAV,
      resetOnHide: false,
      key: 'webDav',
      fieldGroup: createWebdavFormFields({
        infoText: T.F.SYNC.FORM.WEB_DAV.INFO,
        corsInfoText: T.F.SYNC.FORM.WEB_DAV.CORS_INFO,
        baseUrlDescription:
          '* https://your-next-cloud/nextcloud/remote.php/dav/files/yourUserName/',
      }),
    },

    // Dropbox provider authentication
    // Note: No key needed - Dropbox credentials stored privately via SyncCredentialStore
    {
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider !== LegacySyncProvider.Dropbox,
      resetOnHide: false,
      // Custom marker for identifying this field group in config-page.component.ts
      props: { dropboxAuth: true } as any,
      fieldGroup: [
        {
          type: 'tpl',
          templateOptions: {
            tag: 'p',
            text: T.F.SYNC.FORM.DROPBOX.INFO_TEXT,
          },
        },
        {
          type: 'tpl',
          key: 'authStatus',
          className: 'auth-status-indicator',
          templateOptions: {
            tag: 'p',
            // Text will be set dynamically in config-page.component.ts
            text: '',
          },
        },
        // Authentication button will be added programmatically in config-page.component.ts
      ],
    },

    {
      key: 'syncInterval',
      type: 'duration',
      // NOTE: we don't hide because model updates don't seem to work properly for this
      // hideExpression: ((model: DropboxSyncConfig) => !model.accessToken),
      // Hide for SuperSync (uses fixed interval) and when manual sync only is enabled
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider === LegacySyncProvider.SuperSync ||
        field?.parent?.model.isManualSyncOnly === true,
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
      // Only show for file-based providers (Dropbox, WebDAV, LocalFile)
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider === LegacySyncProvider.SuperSync ||
        field?.parent?.model.syncProvider === null,
      templateOptions: {
        label: T.F.SYNC.FORM.L_MANUAL_SYNC_ONLY,
      },
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
              const isSuperSync =
                field?.parent?.parent?.model?.syncProvider ===
                LegacySyncProvider.SuperSync;
              const result = isSuperSync
                ? await openEncryptionPasswordChangeDialog()
                : await openEncryptionPasswordChangeDialogForFileBased();
              return result?.success ? true : false;
            },
          },
        },
        {
          type: 'btn',
          className: 'e2e-disable-encryption-btn',
          templateOptions: {
            text: T.F.SYNC.FORM.BTN_DISABLE_ENCRYPTION,
            btnType: 'primary',
            btnStyle: 'stroked',
            onClick: async (field: FormlyFieldConfig) => {
              const isSuperSync =
                field?.parent?.parent?.model?.syncProvider ===
                LegacySyncProvider.SuperSync;
              const result = isSuperSync
                ? await openDisableEncryptionDialog()
                : await openDisableEncryptionDialogForFileBased();
              if (
                result?.success &&
                result?.encryptionRemoved &&
                field?.parent?.parent?.model
              ) {
                field.parent.parent.model.isEncryptionEnabled = false;
                // Also clear encryptKey if we're in file-based provider context
                if (!isSuperSync && field?.parent?.parent?.model) {
                  field.parent.parent.model.encryptKey = '';
                }
                // Close the parent settings dialog
                closeAllDialogs();
              }
              return result?.success ? true : false;
            },
          },
        },
      ],
    },

    // COMMON SETTINGS
    // Hide for SuperSync - uses fixed settings (no compression config, encryption handled separately)
    {
      type: 'collapsible',
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider === LegacySyncProvider.SuperSync,
      props: { label: T.G.ADVANCED_CFG },
      fieldGroup: [
        {
          key: 'isCompressionEnabled',
          type: 'checkbox',
          templateOptions: {
            label: T.F.SYNC.FORM.L_ENABLE_COMPRESSION,
          },
        },
        // Enable encryption button for file-based providers (shown when encryption is disabled)
        {
          hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
            field?.parent?.parent?.model.syncProvider === LegacySyncProvider.SuperSync ||
            m.isEncryptionEnabled,
          type: 'btn',
          className: 'e2e-file-based-enable-encryption-btn',
          templateOptions: {
            text: T.F.SYNC.FORM.FILE_BASED.BTN_ENABLE_ENCRYPTION,
            btnType: 'primary',
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
        {
          hideExpression: (m, v, field) =>
            field?.parent?.parent?.model.syncProvider !== LegacySyncProvider.SuperSync,
          type: 'btn',
          templateOptions: {
            text: T.F.SYNC.FORM.SUPER_SYNC.BTN_GET_TOKEN,
            tooltip: T.F.SYNC.FORM.SUPER_SYNC.LOGIN_INSTRUCTIONS,
            btnType: 'primary',
            centerBtn: true,
            onClick: (field: any) => {
              const baseUrl = field.model.baseUrl || SUPER_SYNC_DEFAULT_BASE_URL;
              window.open(baseUrl, '_blank');
            },
          },
        },
        {
          hideExpression: (m, v, field) =>
            field?.parent?.parent?.model.syncProvider !== LegacySyncProvider.SuperSync,
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
              field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.SuperSync,
          },
        },
        // Advanced settings for SuperSync
        {
          type: 'collapsible',
          hideExpression: (m, v, field) =>
            field?.parent?.parent?.model.syncProvider !== LegacySyncProvider.SuperSync,
          props: { label: T.G.ADVANCED_CFG },
          fieldGroup: [
            // Enable encryption button for SuperSync (shown when encryption is disabled)
            {
              // Note: Using (m, v, field) signature for btn type fields to ensure
              // hideExpression works correctly with the btn component.
              // Using ?? false to ensure button stays hidden if field is undefined.
              hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
                field?.model?.isEncryptionEnabled ?? false,
              type: 'btn',
              className: 'e2e-enable-encryption-btn',
              templateOptions: {
                text: T.F.SYNC.FORM.SUPER_SYNC.BTN_ENABLE_ENCRYPTION,
                btnType: 'primary',
                onClick: async (field: FormlyFieldConfig) => {
                  const result = await openEnableEncryptionDialog();
                  if (result?.success && field?.model) {
                    field.model.isEncryptionEnabled = true;
                  }
                  return result?.success ? true : false;
                },
              },
            },
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
