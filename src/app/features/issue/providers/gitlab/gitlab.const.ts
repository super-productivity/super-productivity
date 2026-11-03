import { GitlabCfg } from './gitlab.model';
export { GITLAB_ISSUE_CONTENT_CONFIG } from './gitlab-issue-content.const';
export {
  GITLAB_CONFIG_FORM_SECTION,
  GITLAB_CONFIG_FORM,
  GITLAB_PROJECT_REGEX,
} from './gitlab-cfg-form.const';

export const DEFAULT_GITLAB_CFG: GitlabCfg = {
  isEnabled: false,
  project: null,
  issueSource: 'project',
  group: null,
  gitlabBaseUrl: null,
  token: null,
  filterUsername: null,
  scope: 'all',
  filter: null,
  isEnableTimeTracking: false,
};

// NOTE: we need a high limit because git has low usage limits :(
export const GITLAB_POLL_INTERVAL = 10 * 60 * 1000;
export const GITLAB_INITIAL_POLL_DELAY = 16000;
// Pages of 100 issues fetched per auto-import poll for group and all-projects sources
export const GITLAB_MAX_AUTO_IMPORT_PAGES = 5;
export const GITLAB_PAGE_SIZE = 100;
// Saving auto-import is blocked when more open issues than this match the settings
export const GITLAB_MAX_AUTO_IMPORT_ISSUES =
  GITLAB_MAX_AUTO_IMPORT_PAGES * GITLAB_PAGE_SIZE;
export const GITLAB_BASE_URL = 'https://gitlab.com/';

export const GITLAB_API_BASE_URL = `${GITLAB_BASE_URL}api/v4`;
