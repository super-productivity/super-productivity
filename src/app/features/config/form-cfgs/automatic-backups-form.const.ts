import { ConfigFormSection, LocalBackupConfig } from '../global-config.model';
import { T } from '../../../t.const';
import {
  DEFAULT_MAX_BACKUP_FILES,
  MIN_BACKUP_FILES,
} from '../../../../../electron/shared-with-frontend/backup-file-cleanup.util';

export const getAutomaticBackUpFormCfg = (
  backupPath?: string,
): ConfigFormSection<LocalBackupConfig> => ({
  title: T.GCF.AUTO_BACKUPS.TITLE,
  key: 'localBackup',
  help: T.GCF.AUTO_BACKUPS.HELP,
  items: [
    ...(backupPath
      ? [
          {
            type: 'tpl',
            className: `tpl`,
            templateOptions: {
              tag: 'p',
              text: T.GCF.AUTO_BACKUPS.LOCATION_INFO,
            },
          },
          {
            type: 'tpl',
            className: `tpl`,
            templateOptions: {
              tag: 'p',
              text: `<a href="file://${backupPath}" target="_blank">${backupPath}</a>`,
            },
          },
        ]
      : []),
    {
      key: 'isEnabled',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.AUTO_BACKUPS.LABEL_IS_ENABLED,
      },
    },
    ...(backupPath
      ? [
          {
            key: 'maxBackupFiles' as const,
            type: 'input',
            hideExpression: (m: LocalBackupConfig) => !m.isEnabled,
            templateOptions: {
              type: 'number',
              label: T.GCF.AUTO_BACKUPS.MAX_BACKUP_FILES,
              description: T.GCF.AUTO_BACKUPS.MAX_BACKUP_FILES_DESCRIPTION,
              min: MIN_BACKUP_FILES,
              max: DEFAULT_MAX_BACKUP_FILES,
              required: true,
            },
          },
        ]
      : []),
  ],
});
