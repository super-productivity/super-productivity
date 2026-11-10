import { CaldavCfg } from './caldav.model';
export { CALDAV_ISSUE_CONTENT_CONFIG } from './caldav-issue-content.const';
export { CALDAV_CONFIG_FORM_SECTION, CALDAV_CONFIG_FORM } from './caldav-cfg-form.const';

export const DEFAULT_CALDAV_CFG: CaldavCfg = {
  isEnabled: false,
  caldavUrl: null,
  resourceName: null,
  username: null,
  password: null,
  categoryFilter: null,
  // A todo list is the user's own: once they pick a default project they expect
  // its tasks there, not only in the issue panel (#8275). Does nothing until a
  // default project is set; applies to newly created providers only.
  isAutoAddToBacklog: true,
  twoWaySync: {
    isDone: 'pullOnly',
    title: 'pullOnly',
    notes: 'off',
    deleteOnServer: false,
    createOnServer: false,
  },
};

export const CALDAV_POLL_INTERVAL = 10 * 60 * 1000;
export const CALDAV_INITIAL_POLL_DELAY = 8 * 1000;
