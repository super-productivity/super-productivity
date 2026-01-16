import { ConfigFormSection, GlobalConfigSectionKey, NtfyConfig } from '../global-config.model';

export const NTFY_FORM_CFG: ConfigFormSection<NtfyConfig> = {
  title: 'Ntfy Notifications',
  key: 'ntfy' as GlobalConfigSectionKey,
  items: [
    {
      key: 'isEnabled',
      type: 'checkbox',
      templateOptions: {
        label: 'Enable ntfy notifications',
      },
    },
    {
      key: 'baseUrl',
      type: 'input',
      hideExpression: '!model.isEnabled',
      templateOptions: {
        label: 'Ntfy Server URL',
        description: 'Default is https://ntfy.sh',
      },
    },
    {
      key: 'topic',
      type: 'input',
      hideExpression: '!model.isEnabled',
      templateOptions: {
        label: 'Topic',
        required: true,
        description: 'The topic to publish to (e.g. my_super_secret_topic)',
      },
    },
    {
      key: 'priority',
      type: 'input',
      hideExpression: '!model.isEnabled',
      templateOptions: {
        label: 'Priority (1-5)',
        type: 'number',
        min: 1,
        max: 5,
      },
    },
  ],
};
