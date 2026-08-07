import { OutlookTasksCfg } from './outlook-tasks.model';
export { OUTLOOK_TASKS_ISSUE_CONTENT_CONFIG } from './outlook-tasks-issue-content.const';
export {
  OUTLOOK_TASKS_CONFIG_FORM_SECTION,
  OUTLOOK_TASKS_CONFIG_FORM,
} from './outlook-tasks-cfg-form.const';

export const DEFAULT_OUTLOOK_TASKS_CFG: OutlookTasksCfg = {
  isEnabled: false,
  clientId: null,
  tenantId: 'common',
  accessToken: null,
  refreshToken: null,
  tokenExpiresAt: null,
  taskListId: null,
  twoWaySync: {
    isDone: 'pullOnly',
    title: 'pullOnly',
    notes: 'off',
  },
};

export const OUTLOOK_TASKS_POLL_INTERVAL = 10 * 60 * 1000;
