import { T } from '../../../t.const';
import { ConfigFormSection, TeamConfig } from '../global-config.model';

export const TEAM_FORM_CFG: ConfigFormSection<TeamConfig> = {
  title: T.GCF.TEAM.TITLE,
  key: 'team',
  help: T.GCF.TEAM.HELP,
  items: [
    {
      key: 'isEnabled',
      type: 'checkbox',
      templateOptions: {
        label: T.F.TEAM.SETTINGS.IS_ENABLED,
      },
    },
    {
      key: 'serverUrl',
      type: 'input',
      hideExpression: (model: TeamConfig) => !model.isEnabled,
      templateOptions: {
        label: T.F.TEAM.SETTINGS.SERVER_URL,
        type: 'url',
        required: true,
      },
    },
    {
      key: 'apiToken',
      type: 'input',
      hideExpression: (model: TeamConfig) => !model.isEnabled,
      templateOptions: {
        label: T.F.TEAM.SETTINGS.API_TOKEN,
        type: 'password',
        required: true,
      },
    },
    {
      key: 'syncIntervalMs',
      type: 'input',
      hideExpression: (model: TeamConfig) => !model.isEnabled,
      templateOptions: {
        label: T.F.TEAM.SETTINGS.SYNC_INTERVAL,
        type: 'number',
        min: 10000,
        max: 600000,
      },
    },
    {
      key: 'isAutoSyncEnabled',
      type: 'checkbox',
      hideExpression: (model: TeamConfig) => !model.isEnabled,
      templateOptions: {
        label: T.F.TEAM.SETTINGS.IS_AUTO_SYNC,
      },
    },
  ],
};
