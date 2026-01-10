import { T } from '../../../../t.const';
import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderGithub } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';
import { GithubCfg } from './github.model';

export const DEFAULT_GITHUB_CFG: GithubCfg = {
  isEnabled: false,
  repo: null,
  token: null,
  filterUsernameForIssueUpdates: null,
  backlogQuery: 'sort:updated state:open assignee:@me',
};

export const GITHUB_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderGithub>[] = [
  {
    key: 'repo',
    type: 'input',
    props: {
      label: T.F.GITHUB.FORM.REPO,
      required: true,
      type: 'text',
      pattern: /^.+\/.+?$/i,
    },
  },
  {
    key: 'token',
    type: 'input',
    props: {
      label: T.F.GITHUB.FORM.TOKEN,
      required: true,
      placeholder: 'ghp_... (classic token)',
      type: 'password',
    },
    validators: {
      token: {
        expression: (c: { value: string | undefined }) => c.value?.startsWith('ghp_'),
        message: T.F.GITHUB.FORM.INVALID_TOKEN_MESSAGE,
      },
    },
  },
  {
    type: 'link',
    props: {
      url: 'https://github.com/super-productivity/super-productivity/blob/master/docs/github-access-token-instructions.md',
      txt: T.F.ISSUE.HOW_TO_GET_A_TOKEN,
    },
  },
  {
    type: 'collapsible',
    // todo translate
    props: { label: 'Advanced Config' },
    fieldGroup: [
      ...ISSUE_PROVIDER_COMMON_FORM_FIELDS,
      {
        key: 'filterUsernameForIssueUpdates',
        type: 'input',
        expressions: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          // 'props.disabled': '!model.filterUsername',
          hide: '!model.isAutoPoll',
        },
        props: {
          label: T.F.GITHUB.FORM.FILTER_USER,
          // description: T.F.GITHUB.FORM.FILTER_USER_DESCRIPTION,
          // todo translate
          description:
            'To filter out comments and other changes by yourself when polling for issue updates',
        },
      },
      {
        key: 'backlogQuery',
        type: 'input',
        expressions: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          // 'props.disabled': '!model.filterUsername',
          hide: '!model.isAutoAddToBacklog || !model.defaultProjectId',
        },
        props: {
          // label: T.F.GITHUB.FORM.IS_ASSIGNEE_FILTER,
          // TODO translate
          label: 'Search query to use for importing to backlog',
          defaultValue: DEFAULT_GITHUB_CFG.backlogQuery,
        },
        resetOnHide: false,
      },
    ],
  },
];

export const GITHUB_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderGithub> = {
  title: 'GitHub',
  key: 'GITHUB',
  items: GITHUB_CONFIG_FORM,
  help: T.F.GITHUB.FORM_SECTION.HELP,
};
