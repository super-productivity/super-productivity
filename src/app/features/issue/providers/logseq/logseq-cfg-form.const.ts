import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderLogseq } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';
import { T } from '../../../../t.const';

export const LOGSEQ_SEARCH_WILDCARD = '<all>'; // Shows all tasks

export const LOGSEQ_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderLogseq>[] = [
  {
    key: 'apiUrl',
    type: 'input',
    props: {
      label: T.F.LOGSEQ.FORM.API_URL,
      type: 'url',
      placeholder: 'http://localhost:12315/api',
      required: true,
    },
  },
  {
    key: 'authToken',
    type: 'input',
    props: {
      label: T.F.LOGSEQ.FORM.AUTH_TOKEN,
      type: 'password',
      required: true,
    },
  },
  {
    type: 'collapsible',
    props: { label: T.F.LOGSEQ.FORM.ADVANCED_CONFIG },
    fieldGroup: [
      ...ISSUE_PROVIDER_COMMON_FORM_FIELDS,
      {
        key: 'queryFilter',
        type: 'textarea',
        props: {
          label: T.F.LOGSEQ.FORM.QUERY_FILTER,
          placeholder: T.F.LOGSEQ.FORM.QUERY_FILTER_PLACEHOLDER,
          rows: 3,
          description: T.F.LOGSEQ.FORM.QUERY_FILTER_DESCRIPTION,
        },
      },
      {
        key: 'isIncludeMarkerInUpdateDetection',
        type: 'checkbox',
        defaultValue: false,
        props: {
          label: T.F.LOGSEQ.FORM.INCLUDE_MARKER_IN_UPDATE,
          description: T.F.LOGSEQ.FORM.INCLUDE_MARKER_IN_UPDATE_DESCRIPTION,
        },
      },
      {
        key: 'taskWorkflow',
        type: 'select',
        defaultValue: 'TODO_DOING',
        props: {
          label: T.F.LOGSEQ.FORM.TASK_WORKFLOW,
          description: T.F.LOGSEQ.FORM.TASK_WORKFLOW_DESCRIPTION,
          options: [
            { label: T.F.LOGSEQ.FORM.WORKFLOW_TODO_DOING, value: 'TODO_DOING' },
            { label: T.F.LOGSEQ.FORM.WORKFLOW_NOW_LATER, value: 'NOW_LATER' },
          ],
        },
      },
      {
        key: 'linkFormat',
        type: 'select',
        defaultValue: 'logseq-url',
        props: {
          label: T.F.LOGSEQ.FORM.LINK_FORMAT,
          options: [
            { label: T.F.LOGSEQ.FORM.LINK_FORMAT_LOGSEQ_URL, value: 'logseq-url' },
            { label: T.F.LOGSEQ.FORM.LINK_FORMAT_HTTP_URL, value: 'http-url' },
          ],
        },
      },
    ],
  },
];

export const LOGSEQ_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderLogseq> = {
  title: 'Logseq',
  key: 'LOGSEQ',
  items: LOGSEQ_CONFIG_FORM,
  help: T.F.LOGSEQ.FORM_SECTION.HELP,
};
