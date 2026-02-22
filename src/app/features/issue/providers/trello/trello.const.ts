// Necessary fields for trello configuration. Used for building the form, alongside with several essential properties.

import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';
import { IssueProviderTrello } from '../../issue.model';
import { TrelloCfg } from './trello.model';

export const DEFAULT_TRELLO_CFG: TrelloCfg = {
  isEnabled: false,
  apiKey: null,
  token: null,
  boardId: null,
  filterUsername: null,
};

export const TRELLO_POLL_INTERVAL = 5 * 60 * 1000;
export const TRELLO_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderTrello>[] = [
  // ...CROSS_ORIGIN_WARNING,
  // TODO: add instruction for https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/
  {
    key: 'apiKey',
    type: 'input',
    props: {
      label: 'Trello API key',
      description: 'Insert the Trello API key here',
      type: 'text',
      required: true,
    },
  },
  {
    key: 'token',
    type: 'input',
    props: {
      label: 'Trello API token',
      description: 'Insert the Trello API token here.',
      type: 'password',
      required: true,
    },
    validators: {
      token: {
        expression: (c: { value: string | undefined }) =>
          !c.value || c.value.length >= 32,
        message: 'Trello token is typically 32+ characters',
      },
    },
  },
  {
    key: 'filterUsername',
    type: 'input',
    props: {
      label: 'Filter by Trello Username',
      description: 'If provided, only imports cards assigned to this Trello username.',
      type: 'text',
    },
  },
  // search boards
  {
    type: 'collapsible',
    props: { label: 'Advanced Config' },
    fieldGroup: [...ISSUE_PROVIDER_COMMON_FORM_FIELDS],
  },
];

export const TRELLO_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderTrello> = {
  title: 'Trello',
  key: 'TRELLO',
  items: TRELLO_CONFIG_FORM,
  helpArr: [
    {
      h: 'Getting Started',
      p: 'To connect Super Productivity with Trello, you need to generate an API key and token from your Trello account. This allows Super Productivity to access your boards and cards.',
    },
    {
      h: 'How to Get API Key & Token',
      p: 'Visit https://trello.com/power-ups/admin and create a new app. Fills in necessary detail excluding icon. After creating the app, click on "Generate a new API key". This will allow you to view your API key. Token can be generated upon clicking Token hyperlink in the API key section and you can copy it after you have done reviewing your application. You will need both the key and token to configure the integration. See https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/ for more detail if you are unsure of what to do.',
      p2: 'The token grants Super Productivity permission to read your Trello data. You can revoke it at any time from the Trello security page.',
    },
    {
      h: 'Selecting Your Board',
      p: 'After entering your API key and token, click "Load Trello Boards" and you will be able to select the Trello board you want to work with. Only cards from the selected board will be accessible in Super Productivity.',
    },
    {
      h: 'Features',
      p: 'Once configured, you can search for Trello cards, add them as tasks, view card details including attachments, and keep your task data in sync with Trello.',
    },
  ],
};
