import { ConfigFormSection, TrashConfig } from '../global-config.model';
import { T } from '../../../t.const';

export const TRASH_SETTINGS_FORM_CFG: ConfigFormSection<TrashConfig> = {
  title: T.GCF.TRASH.TITLE,
  key: 'trash',
  help: T.GCF.TRASH.HELP,
  items: [
    {
      key: 'retentionDays',
      type: 'input',
      templateOptions: {
        label: T.GCF.TRASH.RETENTION_DAYS,
        type: 'number',
        min: 1,
        max: 365,
      },
    },
  ],
};
