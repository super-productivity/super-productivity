import { ConfigFormSection, LocalBackupConfig } from '../global-config.model';
import { T } from '../../../t.const';

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
  ],
});
