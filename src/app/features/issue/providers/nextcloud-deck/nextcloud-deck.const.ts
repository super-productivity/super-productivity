import { NextcloudDeckCfg } from './nextcloud-deck.model';

export const DEFAULT_NEXTCLOUD_DECK_CFG: NextcloudDeckCfg = {
  isEnabled: false,
  nextcloudBaseUrl: null,
  username: null,
  password: null,
  selectedBoardId: null,
  importStackIds: null,
  doneStackId: null,
  isTransitionIssuesEnabled: false,
  filterByAssignee: true,
};

export const NEXTCLOUD_DECK_POLL_INTERVAL = 10 * 60 * 1000;
export const NEXTCLOUD_DECK_INITIAL_POLL_DELAY = 8 * 1000;
