import { LimitedFormlyFieldConfig } from '../config/global-config.model';
import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from './boards.model';
import { nanoid } from 'nanoid';
import { T } from '../../t.const';
import { DEFAULT_PANEL_CFG } from './boards.const';

const getNewPanel = (): BoardPanelCfg => ({
  ...DEFAULT_PANEL_CFG,
  id: nanoid(),
});

// Date rules for the planned date and the deadline (TaskDateRule values).
const DATE_RULE_OPTIONS = [
  { value: 'overdue', label: T.F.BOARDS.FORM.DUE_STATE_OVERDUE },
  { value: 'todayOrOverdue', label: T.F.BOARDS.FORM.DUE_STATE_TODAY_OR_OVERDUE },
  { value: 'today', label: T.F.BOARDS.FORM.DUE_STATE_TODAY },
  { value: 'tomorrow', label: T.F.BOARDS.FORM.DUE_STATE_TOMORROW },
  { value: 'next7Days', label: T.F.BOARDS.FORM.DUE_STATE_NEXT_7_DAYS },
  { value: 'thisWeek', label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_THIS_WEEK },
  { value: 'nextWeek', label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_NEXT_WEEK },
  { value: 'thisMonth', label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_THIS_MONTH },
  { value: 'nextMonth', label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_NEXT_MONTH },
];

// Estimate / time spent: not set, or at least a duration (ms as a string).
const AMOUNT_RULE_OPTIONS = [
  { value: null, label: T.F.BOARDS.FORM.DUE_STATE_ANY },
  { value: 'none', label: T.F.BOARDS.FORM.RULE_NOT_SET },
  { value: '600000', label: T.F.TASK_VIEW.CUSTOMIZER.TIME_10MIN },
  { value: '1800000', label: T.F.TASK_VIEW.CUSTOMIZER.TIME_30MIN },
  { value: '3600000', label: T.F.TASK_VIEW.CUSTOMIZER.TIME_1HOUR },
  { value: '7200000', label: T.F.TASK_VIEW.CUSTOMIZER.TIME_2HOUR },
];

export const BOARDS_FORM: LimitedFormlyFieldConfig<BoardCfg>[] = [
  {
    key: 'title',
    type: 'input',
    templateOptions: {
      label: T.G.TITLE,
      type: 'text',
      required: true,
    },
  },
  {
    key: 'cols',
    type: 'input',
    templateOptions: {
      label: T.F.BOARDS.FORM.COLUMNS,
      required: true,
      type: 'number',
    },
  },

  // ---------- Panels ----------
  {
    key: 'panels',
    type: 'repeat',
    className: 'simple-counters',
    templateOptions: {
      addText: T.F.BOARDS.FORM.ADD_NEW_PANEL,
      getInitialValue: getNewPanel,
    },
    fieldArray: {
      fieldGroup: [
        {
          type: 'input',
          key: 'title',
          templateOptions: {
            label: T.G.TITLE,
            required: true,
          },
        },
        {
          key: 'isUntagged',
          type: 'checkbox',
          props: {
            label: T.F.BOARDS.FORM.IS_UNTAGGED,
          },
        },
        {
          type: 'tag-select',
          key: 'includedTagIds',
          // Untagged columns clear their tag lists on save (normalizeBoardForSave);
          // keep the required arrays in the model while hidden.
          resetOnHide: false,
          expressions: {
            hide: '!!model.isUntagged',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'props.excludedTagIds': 'model.excludedTagIds',
          },
          templateOptions: {
            label: T.F.BOARDS.FORM.TAGS_REQUIRED,
          },
        },
        {
          key: 'includedTagsMatch',
          type: 'radio',
          // Only meaningful with >=2 required tags.
          expressions: {
            hide: '!!model.isUntagged || model.includedTagIds?.length < 2',
          },
          // `defaultValue` lives at the field level — Formly's core extension
          // reads `field.defaultValue`, not `field.props.defaultValue`, when
          // populating the model. `resetOnHide` makes the default flow into
          // the model when the field transitions hidden→visible. Without
          // these, the field is shown with `undefined` and the `required`
          // validator locks the Save button (#7380).
          defaultValue: 'all',
          resetOnHide: true,
          props: {
            label: T.F.BOARDS.FORM.TAGS_MATCH_MODE,
            required: true,
            options: [
              { value: 'all', label: T.F.BOARDS.FORM.TAGS_MATCH_ALL },
              { value: 'any', label: T.F.BOARDS.FORM.TAGS_MATCH_ANY },
            ],
          },
        },
        {
          type: 'tag-select',
          key: 'excludedTagIds',
          resetOnHide: false,
          expressions: {
            hide: '!!model.isUntagged',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'props.excludedTagIds': 'model.includedTagIds',
          },
          templateOptions: {
            label: T.F.BOARDS.FORM.TAGS_EXCLUDED,
          },
        },
        {
          key: 'excludedTagsMatch',
          type: 'radio',
          expressions: {
            hide: '!!model.isUntagged || model.excludedTagIds?.length < 2',
          },
          defaultValue: 'any',
          resetOnHide: true,
          props: {
            label: T.F.BOARDS.FORM.TAGS_EXCLUDED_MATCH_MODE,
            required: true,
            options: [
              { value: 'any', label: T.F.BOARDS.FORM.TAGS_EXCLUDED_MATCH_ANY },
              { value: 'all', label: T.F.BOARDS.FORM.TAGS_EXCLUDED_MATCH_ALL },
            ],
          },
        },
        {
          key: 'taskDoneState',
          type: 'radio',
          props: {
            label: T.F.BOARDS.FORM.TASK_DONE_STATE,
            required: true,
            defaultValue: BoardPanelCfgTaskDoneState.All,
            options: [
              {
                value: BoardPanelCfgTaskDoneState.All,
                label: T.F.BOARDS.FORM.TASK_DONE_STATE_ALL,
              },
              {
                value: BoardPanelCfgTaskDoneState.Done,
                label: T.F.BOARDS.FORM.TASK_DONE_STATE_DONE,
              },
              {
                value: BoardPanelCfgTaskDoneState.UnDone,
                label: T.F.BOARDS.FORM.TASK_DONE_STATE_UNDONE,
              },
            ],
          },
        },
        {
          key: 'dueState',
          type: 'select',
          props: {
            label: T.F.BOARDS.FORM.DUE_STATE,
            defaultValue: null,
            options: [
              { value: null, label: T.F.BOARDS.FORM.DUE_STATE_ANY },
              ...DATE_RULE_OPTIONS,
            ],
          },
        },
        {
          key: 'scheduledState',
          type: 'radio',
          // A due date implies "scheduled"; BoardEditComponent sets it on save.
          // Keep the value while hidden: Formly's default `resetFieldOnHide`
          // would delete this required field from the model.
          expressions: {
            hide: '!!model.dueState',
          },
          resetOnHide: false,
          props: {
            label: T.F.BOARDS.FORM.SCHEDULED_STATE,
            required: true,
            defaultValue: BoardPanelCfgScheduledState.All,
            options: [
              {
                value: BoardPanelCfgScheduledState.All,
                label: T.F.BOARDS.FORM.SCHEDULED_STATE_ALL,
              },
              {
                value: BoardPanelCfgScheduledState.Scheduled,
                label: T.F.BOARDS.FORM.SCHEDULED_STATE_SCHEDULED,
              },
              {
                value: BoardPanelCfgScheduledState.NotScheduled,
                label: T.F.BOARDS.FORM.SCHEDULED_STATE_NOT_SCHEDULED,
              },
            ],
          },
        },
        {
          key: 'deadlineState',
          type: 'select',
          props: {
            label: T.F.BOARDS.FORM.DEADLINE,
            defaultValue: null,
            options: [
              { value: null, label: T.F.BOARDS.FORM.DUE_STATE_ANY },
              { value: 'none', label: T.F.TASK_VIEW.CUSTOMIZER.GROUP_DEADLINE_NONE },
              ...DATE_RULE_OPTIONS,
            ],
          },
        },
        {
          key: 'estimateRule',
          type: 'select',
          props: {
            label: T.F.BOARDS.FORM.ESTIMATE,
            defaultValue: null,
            options: AMOUNT_RULE_OPTIONS,
          },
        },
        {
          key: 'timeSpentRule',
          type: 'select',
          props: {
            label: T.F.BOARDS.FORM.TIME_SPENT,
            defaultValue: null,
            options: AMOUNT_RULE_OPTIONS,
          },
        },
        {
          key: 'priorityRule',
          type: 'select',
          props: {
            label: T.F.BOARDS.FORM.PRIORITY,
            defaultValue: null,
            options: [
              { value: null, label: T.F.BOARDS.FORM.DUE_STATE_ANY },
              { value: 'none', label: T.F.BOARDS.FORM.RULE_NOT_SET },
              { value: '1', label: T.F.TASK.CMP.PRIORITY_LOW },
              { value: '2', label: T.F.TASK.CMP.PRIORITY_MEDIUM },
              { value: '3', label: T.F.TASK.CMP.PRIORITY_HIGH },
            ],
          },
        },
        {
          // Not persisted as is: BoardEditComponent maps it to `sortBy` or
          // `sortKey` on save (withPanelSortKey) and back on load.
          key: 'sortKey',
          type: 'select',
          props: {
            label: T.F.BOARDS.FORM.SORT_BY,
            defaultValue: null,
            options: [
              { value: null, label: T.F.BOARDS.FORM.SORT_BY_MANUAL },
              { value: 'plannedDate', label: T.F.BOARDS.FORM.SORT_BY_DUE },
              { value: 'deadline', label: T.F.TASK_VIEW.CUSTOMIZER.SORT_DEADLINE },
              { value: 'created', label: T.F.BOARDS.FORM.SORT_BY_CREATED },
              { value: 'title', label: T.F.BOARDS.FORM.SORT_BY_TITLE },
              { value: 'estimate', label: T.F.BOARDS.FORM.SORT_BY_TIME_ESTIMATE },
              { value: 'timeSpent', label: T.F.BOARDS.FORM.TIME_SPENT },
              { value: 'priority', label: T.F.TASK_VIEW.CUSTOMIZER.SORT_PRIORITY },
              { value: 'tag', label: T.F.TASK_VIEW.CUSTOMIZER.GROUP_TAG },
            ],
          },
        },
        {
          key: 'sortDir',
          type: 'radio',
          expressions: {
            hide: '!model.sortKey',
          },
          defaultValue: 'asc',
          resetOnHide: true,
          props: {
            label: T.F.BOARDS.FORM.SORT_DIR,
            required: true,
            options: [
              { value: 'asc', label: T.F.BOARDS.FORM.SORT_DIR_ASC },
              { value: 'desc', label: T.F.BOARDS.FORM.SORT_DIR_DESC },
            ],
          },
        },
        {
          key: 'backlogState',
          type: 'radio',
          props: {
            label: T.F.BOARDS.FORM.BACKLOG_TASK_FILTER_TYPE,
            required: true,
            defaultValue: BoardPanelCfgTaskTypeFilter.All,
            options: [
              {
                value: BoardPanelCfgTaskTypeFilter.All,
                label: T.F.BOARDS.FORM.BACKLOG_TASK_FILTER_ALL,
              },
              {
                value: BoardPanelCfgTaskTypeFilter.NoBacklog,
                label: T.F.BOARDS.FORM.BACKLOG_TASK_FILTER_NO_BACKLOG,
              },
              {
                value: BoardPanelCfgTaskTypeFilter.OnlyBacklog,
                label: T.F.BOARDS.FORM.BACKLOG_TASK_FILTER_ONLY_BACKLOG,
              },
            ],
          },
        },
        {
          key: 'projectIds',
          type: 'project-select',
          props: {
            label: T.F.BOARDS.FORM.PROJECT,
            multiple: true,
            required: true,
            defaultValue: [''],
            defaultLabel: T.F.BOARDS.FORM.PROJECT_ALL,
          },
        },
        {
          key: 'isParentTasksOnly',
          type: 'checkbox',
          props: {
            label: T.F.BOARDS.FORM.ONLY_PARENT_TASKS,
            defaultValue: false,
          },
        },
      ],
    },
  },
];
