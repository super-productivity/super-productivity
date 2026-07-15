import { T } from '../../../../t.const';
import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderGitlab } from '../../issue.model';
import {
  CROSS_ORIGIN_WARNING,
  ISSUE_PROVIDER_COMMON_FORM_FIELDS,
} from '../../common-issue-form-stuff.const';
// A GitLab project reference is EITHER a numeric project ID OR a namespace-qualified
// path (`group/project`, subgroups, or the `%2F`-encoded form) — the REST API has no
// way to resolve a project by a bare slug, so a single-segment name like `test_config`
// always 404s at poll time (#8665). Require a path separator (`/` or `%2F`) for the
// non-numeric branch so that mistake gets inline feedback instead. Still permissive
// about the segment chars (e.g. consecutive hyphens, which GitLab paths allow) to
// avoid false-rejecting valid paths; the separator lookahead keeps the char class a
// single unnested quantifier (no catastrophic backtracking).
//
// This pattern's `.source` is handed to Formly's `pattern` option, which both feeds
// Angular's `Validators.pattern` AND is written verbatim to the native `<input pattern>`
// attribute. Chromium compiles that attribute with the RegExp `v` flag, under which `/`
// and `-` are reserved inside a character class and MUST be escaped — hence `[\w.%\/\-]`.
// It must also stay flag-independent (the attribute cannot carry an `i` flag, and a
// stringified `/…/i` RegExp is not a valid attribute value), so the only case-sensitive
// literal, the encoded separator, is written explicitly as `%2[Ff]`. Getting this wrong
// makes Chromium log "Invalid regular expression" on every change-detection cycle (#9034).
export const GITLAB_PROJECT_REGEX = /^(?:[1-9][0-9]*|(?=.*(?:\/|%2[Ff]))[\w.%\/\-]+)$/;

export const GITLAB_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderGitlab>[] = [
  ...CROSS_ORIGIN_WARNING,
  {
    key: 'project',
    type: 'input',
    templateOptions: {
      required: true,
      label: T.F.GITLAB.FORM.PROJECT,
      type: 'text',
      // Pass the source string (not the RegExp object): Formly writes this straight to the
      // native `<input pattern>` attribute, and a stringified `/…/` RegExp is not a valid
      // attribute value. See GITLAB_PROJECT_REGEX for the `v`-flag constraints (#9034).
      pattern: GITLAB_PROJECT_REGEX.source,
      description: T.F.GITLAB.FORM.PROJECT_HINT,
    },
  },
  {
    key: 'token',
    type: 'input',
    templateOptions: {
      label: T.F.GITLAB.FORM.TOKEN,
      type: 'password',
    },
    validation: {
      show: true,
    },
    expressionProperties: {
      // !! is used to get the associated boolean value of a non boolean value
      // It's not a fancy trick using model.project alone gets the required case right but won't remove it
      // if the project field is empty so this is needed for the wanted behavior
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'templateOptions.required': '!!model.project',
    },
  },
  {
    type: 'link',
    templateOptions: {
      url: 'https://github.com/super-productivity/super-productivity/blob/master/docs/gitlab-access-token-instructions.md',
      txt: T.F.ISSUE.HOW_TO_GET_A_TOKEN,
    },
  },
  // TODO remove completely including translations
  // {
  //   key: 'source',
  //   type: 'select',
  //   defaultValue: 'project',
  //   templateOptions: {
  //     required: true,
  //     label: T.F.GITLAB.FORM.SOURCE,
  //     options: [
  //       { value: 'project', label: T.F.GITLAB.FORM.SOURCE_PROJECT },
  //       { value: 'group', label: T.F.GITLAB.FORM.SOURCE_GROUP },
  //       { value: 'global', label: T.F.GITLAB.FORM.SOURCE_GLOBAL },
  //     ],
  //   },
  // },
  {
    type: 'collapsible',
    // todo translate
    props: { label: 'Advanced Config' },
    fieldGroup: [
      {
        key: 'scope',
        type: 'select',
        defaultValue: 'created-by-me',
        templateOptions: {
          required: true,
          label: T.F.GITLAB.FORM.SCOPE,
          options: [
            { value: 'all', label: T.F.GITLAB.FORM.SCOPE_ALL },
            { value: 'created-by-me', label: T.F.GITLAB.FORM.SCOPE_CREATED },
            { value: 'assigned-to-me', label: T.F.GITLAB.FORM.SCOPE_ASSIGNED },
          ],
        },
      },
      {
        key: 'gitlabBaseUrl',
        type: 'input',
        templateOptions: {
          label: T.F.GITLAB.FORM.GITLAB_BASE_URL,
          type: 'url',
          pattern:
            /^(http(s)?:\/\/)?(localhost|[\w.\-]+(?:\.[\w\.\-]+)+)(:\d+)?(\/[^\s]*)?$/i,
        },
      },
      ...ISSUE_PROVIDER_COMMON_FORM_FIELDS,
      {
        key: 'filterUsername',
        type: 'input',
        templateOptions: {
          label: T.F.GITLAB.FORM.FILTER_USER,
          description:
            'To filter out comments and other changes by yourself when polling for issue updates',
        },
      },
      {
        key: 'filter',
        type: 'input',
        templateOptions: {
          type: 'text',
          label: T.F.GITLAB.FORM.FILTER,
          description: T.F.GITLAB.FORM.FILTER_DESCRIPTION,
        },
      },
      {
        key: 'isEnableTimeTracking',
        type: 'checkbox',
        templateOptions: {
          label: T.F.GITLAB.FORM.SUBMIT_TIMELOGS,
          description: T.F.GITLAB.FORM.SUBMIT_TIMELOGS_DESCRIPTION,
        },
      },
    ],
  },
];

export const GITLAB_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderGitlab> = {
  title: 'GitLab',
  key: 'GITLAB',
  items: GITLAB_CONFIG_FORM,
  help: T.F.GITLAB.FORM_SECTION.HELP,
};
