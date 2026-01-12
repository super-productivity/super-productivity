import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderLogseq } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';

export const LOGSEQ_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderLogseq>[] = [
  {
    key: 'apiUrl',
    type: 'input',
    props: {
      label: 'API URL',
      type: 'url',
      placeholder: 'http://localhost:12315/api',
      required: true,
    },
  },
  {
    key: 'authToken',
    type: 'input',
    props: {
      label: 'API Token',
      type: 'password',
      required: true,
    },
  },
  {
    type: 'collapsible',
    props: { label: 'Advanced Config' },
    fieldGroup: [
      ...ISSUE_PROVIDER_COMMON_FORM_FIELDS,
      {
        key: 'queryFilter',
        type: 'textarea',
        props: {
          label: 'Datascript Query Filter',
          placeholder:
            '[:find (pull ?block [*]) :where [?block :block/marker ?marker] [(contains? #{"TODO" "LATER" "NOW" "DOING"} ?marker)]]',
          rows: 3,
          description:
            'Custom Datascript query to filter which blocks to import. Default queries for TODO and DOING blocks.',
        },
      },
      {
        key: 'isUpdateBlockOnTaskDone',
        type: 'checkbox',
        defaultValue: true,
        props: {
          label: 'Update Logseq block to DONE when task is completed',
        },
      },
      {
        key: 'taskWorkflow',
        type: 'select',
        defaultValue: 'TODO_DOING',
        props: {
          label: 'Task Workflow Pattern',
          description:
            'Choose the task marker workflow used in your Logseq graph. TODO/DOING uses TODO (stopped) → DOING (active) → DONE. NOW/LATER uses LATER (stopped) → NOW (active) → DONE.',
          options: [
            { label: 'TODO → DOING → DONE', value: 'TODO_DOING' },
            { label: 'LATER → NOW → DONE', value: 'NOW_LATER' },
          ],
        },
      },
      {
        key: 'linkFormat',
        type: 'select',
        defaultValue: 'logseq-url',
        props: {
          label: 'Link Format',
          options: [
            { label: 'Logseq URL (logseq://graph/...)', value: 'logseq-url' },
            { label: 'HTTP URL (localhost:12315)', value: 'http-url' },
          ],
        },
      },
      {
        key: 'superProdReferenceMode',
        type: 'select',
        defaultValue: 'property',
        props: {
          label: 'Store SuperProductivity reference in Logseq as',
          description: 'How to add a reference to the SuperProductivity task in Logseq',
          options: [
            { label: 'Block property', value: 'property' },
            { label: 'Child block', value: 'child-block' },
            { label: 'Do not store', value: 'none' },
          ],
        },
      },
      {
        key: 'superProdReferenceProperty',
        type: 'input',
        defaultValue: 'superProductivity',
        expressions: {
          hide: 'model.superProdReferenceMode !== "property"',
        },
        props: {
          label: 'Property name for SuperProductivity reference',
          placeholder: 'superProductivity',
        },
      },
    ],
  },
];

export const LOGSEQ_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderLogseq> = {
  title: 'Logseq',
  key: 'LOGSEQ',
  items: LOGSEQ_CONFIG_FORM,
  help: `
    <h3>Setup Instructions</h3>
    <ol>
      <li>Enable HTTP API in Logseq: <strong>Settings → Features → HTTP API Server</strong></li>
      <li>Generate an API token: <strong>Settings → HTTP API Server → Authorization tokens</strong></li>
      <li>Paste the token above</li>
    </ol>
    <p>Learn more at <a href="https://docs.logseq.com/#/page/http%20api" target="_blank">Logseq HTTP API documentation</a></p>

    <h3>Using the Issue Panel</h3>
    <p>To show all available Logseq tasks in the Issue Panel:</p>
    <ol>
      <li>Enter <strong>*</strong> in the search field</li>
      <li>Click the <strong>pin button</strong> (📌) to save this search</li>
      <li>Next time you open the Issue Panel, all tasks will be shown automatically</li>
    </ol>
    <p>You can use the search field to filter tasks by content at any time.</p>
  `,
};
