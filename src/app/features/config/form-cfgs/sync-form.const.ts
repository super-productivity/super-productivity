/* eslint-disable max-len */
import { T } from '../../../t.const';
import { ConfigFormSection, SyncConfig } from '../global-config.model';
import { LegacySyncProvider } from '../../../imex/sync/legacy-sync-provider.model';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { IS_ELECTRON } from '../../../app.constants';
import { fileSyncDroid, fileSyncElectron } from '../../../pfapi/pfapi-config';

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
          { label: LegacySyncProvider.Dropbox, value: LegacySyncProvider.Dropbox },
          { label: LegacySyncProvider.WebDAV, value: LegacySyncProvider.WebDAV },
          ...(IS_ELECTRON || IS_ANDROID_WEB_VIEW
            ? [
                {
                  label: LegacySyncProvider.LocalFile,
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
      key: 'localFileSync',
      fieldGroup: [
        {
          type: 'btn',
          key: 'syncFolderPath',
          templateOptions: {
            text: T.F.SYNC.FORM.LOCAL_FILE.L_SYNC_FOLDER_PATH,
            required: true,
            onClick: () => {
              return fileSyncElectron.pickDirectory();
            },
          },
        },
      ],
    },
    {
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider !== LegacySyncProvider.LocalFile ||
        !IS_ANDROID_WEB_VIEW,
      key: 'localFileSync',
      fieldGroup: [
        {
          type: 'btn',
          key: 'safFolderUri',
          templateOptions: {
            text: T.F.SYNC.FORM.LOCAL_FILE.L_SYNC_FOLDER_PATH,
            required: true,
            onClick: () => {
              // NOTE: this actually sets the value in the model
              return fileSyncDroid.setupSaf();
            },
          },
        },
      ],
    },

    {
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider !== LegacySyncProvider.WebDAV,
      key: 'webDav',
      fieldGroup: [
        {
          type: 'tpl',
          templateOptions: {
            tag: 'p',
            text: T.F.SYNC.FORM.WEB_DAV.INFO,
          },
        },
        ...(!IS_ELECTRON && !IS_ANDROID_WEB_VIEW
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
          key: 'baseUrl',
          type: 'input',
          className: 'e2e-baseUrl',
          templateOptions: {
            required: true,
            label: T.F.SYNC.FORM.WEB_DAV.L_BASE_URL,
            description:
              '* https://your-next-cloud/nextcloud/remote.php/dav/files/yourUserName/',
          },
        },
        {
          key: 'userName',
          type: 'input',
          className: 'e2e-userName',
          templateOptions: {
            required: true,
            label: T.F.SYNC.FORM.WEB_DAV.L_USER_NAME,
          },
        },
        {
          key: 'password',
          type: 'input',
          className: 'e2e-password',
          templateOptions: {
            type: 'password',
            required: true,
            label: T.F.SYNC.FORM.WEB_DAV.L_PASSWORD,
          },
        },
        {
          key: 'syncFolderPath',
          type: 'input',
          className: 'e2e-syncFolderPath',
          templateOptions: {
            required: true,
            label: T.F.SYNC.FORM.WEB_DAV.L_SYNC_FOLDER_PATH,
            description: T.F.SYNC.FORM.WEB_DAV.D_SYNC_FOLDER_PATH,
          },
        },
      ],
    },

    {
      key: 'syncInterval',
      type: 'duration',
      // NOTE: we don't hide because model updates don't seem to work properly for this
      // hideExpression: ((model: DropboxSyncConfig) => !model.accessToken),
      templateOptions: {
        required: true,
        isAllowSeconds: true,
        label: T.F.SYNC.FORM.L_SYNC_INTERVAL,
        description: T.G.DURATION_DESCRIPTION,
      },
    },

    // COMMON SETTINGS
    {
      type: 'collapsible',
      props: { label: T.G.ADVANCED_CFG },
      fieldGroup: [
        {
          key: 'isCompressionEnabled',
          type: 'checkbox',
          templateOptions: {
            label: T.F.SYNC.FORM.L_ENABLE_COMPRESSION,
          },
        },
        {
          key: 'isEncryptionEnabled',
          type: 'checkbox',
          templateOptions: {
            label: T.F.SYNC.FORM.L_ENABLE_ENCRYPTION,
          },
        },
        {
          hideExpression: (model: any) => !model.isEncryptionEnabled,
          type: 'tpl',
          className: `tpl`,
          templateOptions: {
            tag: 'div',
            text: T.F.SYNC.FORM.L_ENCRYPTION_NOTES,
          },
        },
        {
          hideExpression: (model: any) => !model.isEncryptionEnabled,
          key: 'encryptKey',
          type: 'input',
          templateOptions: {
            required: true,
            type: 'password',
            label: T.F.SYNC.FORM.L_ENCRYPTION_PASSWORD,
          },
        },
      ],
    },
  ],
};
