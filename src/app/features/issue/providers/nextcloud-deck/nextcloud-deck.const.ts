import { NextcloudDeckCfg } from './nextcloud-deck.model';

export const DEFAULT_NEXTCLOUD_DECK_CFG: NextcloudDeckCfg = {
  isEnabled: false,
  nextcloudBaseUrl: null,
  username: null,
  password: null,
  selectedBoardId: null,
  selectedBoardTitle: null,
  importStackIds: null,
  doneStackId: null,
  isTransitionIssuesEnabled: false,
  filterByAssignee: true,
  titleTemplate: null,
  pollIntervalMinutes: 10,
};

export const NEXTCLOUD_DECK_POLL_INTERVAL = 10 * 60 * 1000;
export const NEXTCLOUD_DECK_INITIAL_POLL_DELAY = 8 * 1000;

export { NEXTCLOUD_DECK_ISSUE_CONTENT_CONFIG } from './nextcloud-deck-issue-content.const';
export {
  NEXTCLOUD_DECK_CONFIG_FORM_SECTION,
  NEXTCLOUD_DECK_CONFIG_FORM,
} from './nextcloud-deck-cfg-form.const';
