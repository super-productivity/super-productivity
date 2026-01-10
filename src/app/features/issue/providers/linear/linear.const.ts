export const LINEAR_POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
export const LINEAR_INITIAL_POLL_DELAY = 8 * 1000;
export const LINEAR_API_BASE_URL = 'https://linear.app/';

// Re-export from cfg form
export {
  LINEAR_CONFIG_FORM_SECTION,
  LINEAR_CONFIG_FORM,
  DEFAULT_LINEAR_CFG,
} from './linear-cfg-form.const';

// Re-export issue content config
export { LINEAR_ISSUE_CONTENT_CONFIG } from './linear-issue-content.const';
