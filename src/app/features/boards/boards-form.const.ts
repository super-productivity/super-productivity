import { LimitedFormlyFieldConfig } from '../config/global-config.model';
import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgDeadlineState,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from './boards.model';
import { nanoid } from 'nanoid';
import { T } from '../../t.const';
import { DEFAULT_PANEL_CFG, TIMEFRAME_OPTIONS } from './boards.const';

const getNewPanel = (): BoardPanelCfg => ({
  ...DEFAULT_PANEL_CFG,
  id: nanoid(),
});

interface TimeframeFieldFactoryOptions {
  prefix: 'scheduled' | 'deadline';
  stateKey: keyof BoardPanelCfg;
  stateActiveVal: number;
  stateLabel: string;
  stateOptions: { value: number; label: string }[];
  timeframeLabel: string;
}

const buildTimeframeFields = (
  options: TimeframeFieldFactoryOptions,
): LimitedFormlyFieldConfig<BoardPanelCfg>[] => {
  const { prefix, stateKey, stateActiveVal, stateLabel, stateOptions, timeframeLabel } =
    options;
  return [
    {
      key: stateKey,
      type: 'radio',
      props: {
        label: stateLabel,
        required: true,
        defaultValue: stateOptions[0].value,
        options: stateOptions,
      },
    },
    {
      key: `${prefix}Timeframe` as keyof BoardPanelCfg,
      type: 'select',
      expressions: {
        hide: `model.${stateKey} !== ${stateActiveVal}`,
      },
      defaultValue: 'ALL',
      props: {
        label: timeframeLabel,
        options: TIMEFRAME_OPTIONS,
      },
    },
    {
      key: `${prefix}DaysVal` as keyof BoardPanelCfg,
      type: 'input',
      expressions: {
        hide: `model.${stateKey} !== ${stateActiveVal} ||
          (model.${prefix}Timeframe !== 'NEXT_DAYS' &&
            model.${prefix}Timeframe !== 'AT_LEAST_DAYS_FUTURE')`,
      },
      defaultValue: 7,
      props: {
        label: T.F.BOARDS.FORM.TIMEFRAME_DAYS_VAL,
        type: 'number',
        min: 1,
        required: true,
      },
    },
    {
      key: `${prefix}CustomStart` as keyof BoardPanelCfg,
      type: 'date',
      expressions: {
        hide: `model.${stateKey} !== ${stateActiveVal} || model.${prefix}Timeframe !== 'CUSTOM_RANGE'`,
      },
      props: {
        label: T.F.BOARDS.FORM.TIMEFRAME_CUSTOM_START,
        maxDateKey: `${prefix}CustomEnd`,
      },
    },
    {
      key: `${prefix}CustomEnd` as keyof BoardPanelCfg,
      type: 'date',
      expressions: {
        hide: `model.${stateKey} !== ${stateActiveVal} || model.${prefix}Timeframe !== 'CUSTOM_RANGE'`,
      },
      props: {
        label: T.F.BOARDS.FORM.TIMEFRAME_CUSTOM_END,
        minDateKey: `${prefix}CustomStart`,
      },
    },
  ];
};

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
          type: 'tag-select',
          key: 'includedTagIds',
          expressions: {
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
            hide: 'model.includedTagIds?.length < 2',
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
          expressions: {
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
            hide: 'model.excludedTagIds?.length < 2',
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
        ...buildTimeframeFields({
          prefix: 'scheduled',
          stateKey: 'scheduledState',
          stateActiveVal: BoardPanelCfgScheduledState.Scheduled,
          stateLabel: T.F.BOARDS.FORM.SCHEDULED_STATE,
          stateOptions: [
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
          timeframeLabel: T.F.BOARDS.FORM.SCHEDULED_TIMEFRAME,
        }),
        ...buildTimeframeFields({
          prefix: 'deadline',
          stateKey: 'deadlineState',
          stateActiveVal: BoardPanelCfgDeadlineState.HasDeadline,
          stateLabel: T.F.BOARDS.FORM.DEADLINE_STATE,
          stateOptions: [
            {
              value: BoardPanelCfgDeadlineState.All,
              label: T.F.BOARDS.FORM.DEADLINE_STATE_ALL,
            },
            {
              value: BoardPanelCfgDeadlineState.HasDeadline,
              label: T.F.BOARDS.FORM.DEADLINE_STATE_HAS_DEADLINE,
            },
            {
              value: BoardPanelCfgDeadlineState.NoDeadline,
              label: T.F.BOARDS.FORM.DEADLINE_STATE_NO_DEADLINE,
            },
          ],
          timeframeLabel: T.F.BOARDS.FORM.DEADLINE_TIMEFRAME,
        }),
        {
          key: 'sortBy',
          type: 'select',
          props: {
            label: T.F.BOARDS.FORM.SORT_BY,
            defaultValue: null,
            options: [
              { value: null, label: T.F.BOARDS.FORM.SORT_BY_MANUAL },
              { value: 'dueDate', label: T.F.BOARDS.FORM.SORT_BY_DUE },
              { value: 'created', label: T.F.BOARDS.FORM.SORT_BY_CREATED },
              { value: 'title', label: T.F.BOARDS.FORM.SORT_BY_TITLE },
              { value: 'timeEstimate', label: T.F.BOARDS.FORM.SORT_BY_TIME_ESTIMATE },
            ],
          },
        },
        {
          key: 'sortDir',
          type: 'radio',
          expressions: {
            hide: '!model.sortBy',
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
