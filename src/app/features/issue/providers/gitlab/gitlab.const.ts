import { GitlabCfg } from './gitlab.model';
import { GITHUB_INITIAL_POLL_DELAY } from '../github/github.const';
export { GITLAB_ISSUE_CONTENT_CONFIG } from './gitlab-issue-content.const';
export {
  GITLAB_CONFIG_FORM_SECTION,
  GITLAB_CONFIG_FORM,
  GITLAB_PROJECT_REGEX,
} from './gitlab-cfg-form.const';

export const DEFAULT_GITLAB_CFG: GitlabCfg = {
  isEnabled: false,
  project: '',
  gitlabBaseUrl: null,
  token: null,
  filterUsername: null,
  scope: 'all',
  filter: null,
  isEnableTimeTracking: false,
  isImportGitLabLabels: false,
  isForceUpdate: false,
};

// NOTE: we need a high limit because git has low usage limits :(
export const GITLAB_POLL_INTERVAL = 10 * 60 * 1000;
export const GITLAB_INITIAL_POLL_DELAY = GITHUB_INITIAL_POLL_DELAY + 8000;
export const GITLAB_BASE_URL = 'https://gitlab.com/';

export const GITLAB_API_BASE_URL = `${GITLAB_BASE_URL}api/v4`;
