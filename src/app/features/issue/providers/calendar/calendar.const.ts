import { ConfigFormSection } from '../../../config/global-config.model';
import { T } from '../../../../t.const';
import { IssueProviderCalendar } from '../../issue.model';
import { CalendarProviderCfg } from './calendar.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';
import { IS_ELECTRON } from '../../../../app.constants';
import { IssueLog } from '../../../../core/log';
import {
  CALENDAR_REGEX_FILTER_MAX_LENGTH,
  isSafeCalendarFilterRegex,
} from '../../../calendar-integration/calendar-event-regex-filter';

const isValidCalendarFilterRegex = (value: string | undefined | null): boolean => {
  if (!value) return true;
  if (value.length > CALENDAR_REGEX_FILTER_MAX_LENGTH) return false;
  try {
    new RegExp(value);
    return isSafeCalendarFilterRegex(value);
  } catch {
    return false;
  }
};

// 5 minutes for local file:// URLs (faster polling for local calendars)
export const LOCAL_FILE_CHECK_INTERVAL = 5 * 60 * 1000;

// Poll interval for checking calendar task updates (10 minutes)
export const CALENDAR_POLL_INTERVAL = 10 * 60 * 1000;

export const getEffectiveCheckInterval = (calProvider: IssueProviderCalendar): number => {
  if (calProvider.icalUrl?.startsWith('file://')) {
    return LOCAL_FILE_CHECK_INTERVAL;
  }
  return calProvider.checkUpdatesEvery;
};

export const DEFAULT_CALENDAR_CFG: CalendarProviderCfg = {
  isEnabled: false,
  icalUrl: '',
  isAutoImportForCurrentDay: false,
  isReferenceCalendar: false,
  checkUpdatesEvery: 2 * 60 * 60000,
  showBannerBeforeThreshold: 2 * 60 * 60000,
  isDisabledForWebApp: false,
  filterIncludeRegex: null,
  filterExcludeRegex: null,
};

export const CALENDAR_FORM_CFG_NEW: ConfigFormSection<IssueProviderCalendar> = {
  title: 'CALENDAR',
  help: T.GCF.CALENDARS.HELP,
  key: 'ICAL',
  items: [
    ...(!IS_ELECTRON
      ? [
          {
            type: 'tpl',
            className: 'tpl',
            templateOptions: {
              tag: 'p',
              text: T.GCF.CALENDARS.BROWSER_WARNING,
            },
          },
        ]
      : []),
    {
      type: 'input',
      key: 'icalUrl',
      templateOptions: {
        required: true,
        type: 'url',
        label: T.GCF.CALENDARS.CAL_PATH,
      },
    },
    {
      type: 'duration',
      key: 'checkUpdatesEvery',
      hooks: {
        onInit: (field) => {
          IssueLog.log(field?.formControl?.value);
          if (!field?.formControl?.value) {
            field?.formControl?.setValue(2 * 60 * 60000);
          }
        },
      },
      templateOptions: {
        label: T.GCF.CALENDARS.CHECK_UPDATES,
        description: T.G.DURATION_DESCRIPTION,
      },
    },
    {
      type: 'duration',
      key: 'showBannerBeforeThreshold',
      templateOptions: {
        required: false,
        isAllowSeconds: true,
        label: T.GCF.CALENDARS.SHOW_BANNER_THRESHOLD,
        description: T.G.DURATION_DESCRIPTION,
      },
    },
    {
      type: 'checkbox',
      key: 'isAutoImportForCurrentDay',
      templateOptions: {
        label: T.GCF.CALENDARS.AUTO_IMPORT_FOR_CURRENT_DAY,
      },
    },
    {
      type: 'checkbox',
      key: 'isReferenceCalendar',
      templateOptions: {
        label: T.GCF.CALENDARS.REFERENCE_CALENDAR,
      },
    },
    {
      type: 'input',
      key: 'color',
      templateOptions: {
        type: 'color',
        label: T.GCF.CALENDARS.CAL_COLOR,
      },
    },
    {
      type: 'checkbox',
      key: 'isDisabledForWebApp',
      templateOptions: {
        label: T.GCF.CALENDARS.DISABLE_FOR_WEB_APP,
      },
    },
    {
      type: 'input',
      key: 'filterIncludeRegex',
      templateOptions: {
        label: T.GCF.CALENDARS.FILTER_INCLUDE_REGEX,
        description: T.GCF.CALENDARS.FILTER_INCLUDE_REGEX_DESCRIPTION,
      },
      validators: {
        validRegex: {
          expression: (c: { value: string | undefined | null }) =>
            isValidCalendarFilterRegex(c.value),
          message: T.GCF.CALENDARS.INVALID_REGEX,
        },
      },
    },
    {
      type: 'input',
      key: 'filterExcludeRegex',
      templateOptions: {
        label: T.GCF.CALENDARS.FILTER_EXCLUDE_REGEX,
        description: T.GCF.CALENDARS.FILTER_EXCLUDE_REGEX_DESCRIPTION,
      },
      validators: {
        validRegex: {
          expression: (c: { value: string | undefined | null }) =>
            isValidCalendarFilterRegex(c.value),
          message: T.GCF.CALENDARS.INVALID_REGEX,
        },
      },
    },
    ...ISSUE_PROVIDER_COMMON_FORM_FIELDS,
  ],
};
