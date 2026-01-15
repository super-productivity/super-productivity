import { WorkContextCommon, WorkContextThemeCfg } from './work-context.model';
import { WorklogExportSettings, WorklogGrouping } from '../worklog/worklog.model';
import { ConfigFormSection } from '../config/global-config.model';
import { T } from '../../t.const';
import { FormlyFieldConfig } from '@ngx-formly/core';

export const WORKLOG_EXPORT_DEFAULTS: WorklogExportSettings = {
  cols: ['DATE', 'START', 'END', 'TIME_CLOCK', 'TITLES_INCLUDING_SUB'],
  roundWorkTimeTo: null,
  roundStartTimeTo: null,
  roundEndTimeTo: null,
  separateTasksBy: ' | ',
  groupBy: WorklogGrouping.DATE,
};

export const DEFAULT_PROJECT_COLOR = '#29a1aa';
export const DEFAULT_TAG_COLOR = '#a05db1';
export const DEFAULT_TODAY_TAG_COLOR = '#6495ED';

export const WORK_CONTEXT_DEFAULT_THEME: WorkContextThemeCfg = {
  isAutoContrast: true,
  isDisableBackgroundTint: false,
  primary: DEFAULT_TAG_COLOR,
  huePrimary: '500',
  accent: '#ff4081',
  // accent: 'rgb(180,14,225)',
  hueAccent: '500',
  warn: '#e11826',
  hueWarn: '500',
  backgroundImageDark: null,
  backgroundImageLight: null,
};

export const WORK_CONTEXT_DEFAULT_COMMON: WorkContextCommon = {
  advancedCfg: {
    worklogExportSettings: WORKLOG_EXPORT_DEFAULTS,
  },
  theme: WORK_CONTEXT_DEFAULT_THEME,
  // breakTime: {},
  // breakNr: {},
  taskIds: [],
  icon: null,
  id: '',
  title: '',
};

export const HUES = [
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '200', label: '200' },
  { value: '300', label: '300' },
  { value: '400', label: '400' },
  { value: '500', label: '500' },
  { value: '600', label: '600' },
  { value: '700', label: '700' },
  { value: '800', label: '800' },
  { value: '900', label: '900' },
];

export const WORK_CONTEXT_THEME_CONFIG_FORM_CONFIG: ConfigFormSection<WorkContextThemeCfg> =
  {
    title: T.F.PROJECT.FORM_THEME.TITLE,
    key: 'basic',
    help: T.F.PROJECT.FORM_THEME.HELP,
    items: [
      {
        key: 'primary',
        type: 'color',
        templateOptions: {
          label: T.F.PROJECT.FORM_THEME.L_COLOR_PRIMARY,
        },
      },
      {
        key: 'accent',
        type: 'color',
        templateOptions: {
          label: T.F.PROJECT.FORM_THEME.L_COLOR_ACCENT,
        },
      },
      {
        key: 'warn',
        type: 'color',
        templateOptions: {
          label: T.F.PROJECT.FORM_THEME.L_COLOR_WARN,
        },
      },
      {
        key: 'isAutoContrast',
        type: 'checkbox',
        templateOptions: {
          label: T.F.PROJECT.FORM_THEME.L_IS_AUTO_CONTRAST,
        },
      },
      {
        key: 'huePrimary',
        type: 'select',
        hideExpression: 'model.isAutoContrast',
        templateOptions: {
          required: true,
          label: T.F.PROJECT.FORM_THEME.L_HUE_PRIMARY,
          options: HUES,
          valueProp: 'value',
          labelProp: 'label',
          placeholder: T.F.PROJECT.FORM_THEME.L_HUE_PRIMARY,
        },
      },
      {
        key: 'hueAccent',
        type: 'select',
        hideExpression: 'model.isAutoContrast',
        templateOptions: {
          required: true,
          label: T.F.PROJECT.FORM_THEME.L_HUE_ACCENT,
          options: HUES,
          valueProp: 'value',
          labelProp: 'label',
          placeholder: T.F.PROJECT.FORM_THEME.L_HUE_ACCENT,
        },
      },
      {
        key: 'hueWarn',
        type: 'select',
        hideExpression: 'model.isAutoContrast',
        templateOptions: {
          required: true,
          label: T.F.PROJECT.FORM_THEME.L_HUE_WARN,
          options: HUES,
          valueProp: 'value',
          labelProp: 'label',
          placeholder: T.F.PROJECT.FORM_THEME.L_HUE_WARN,
        },
      },
      {
        key: 'isDisableBackgroundTint',
        type: 'checkbox',
        expressions: {
          hide: (fCfg: FormlyFieldConfig) =>
            fCfg.model.backgroundImageDark || fCfg.model.backgroundImageLight,
        },
        templateOptions: {
          label: T.F.PROJECT.FORM_THEME.L_IS_DISABLE_BACKGROUND_TINT,
        },
      },
      {
        key: 'backgroundImageDark',
        type: 'image-input',
        templateOptions: {
          label: T.F.PROJECT.FORM_THEME.L_BACKGROUND_IMAGE_DARK,
          description: '* https://some/cool.jpg, file:///home/user/bg.png',
        },
      },
      {
        key: 'backgroundImageLight',
        type: 'image-input',
        templateOptions: {
          label: T.F.PROJECT.FORM_THEME.L_BACKGROUND_IMAGE_LIGHT,
          description: '* https://some/cool.jpg, file:///home/user/bg.png',
        },
      },
    ],
  };
