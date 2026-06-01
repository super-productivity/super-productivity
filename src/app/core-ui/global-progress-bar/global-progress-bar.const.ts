import { T } from '../../t.const';
/* eslint-disable @typescript-eslint/naming-convention */

// Only labels reachable from a current countUp() caller:
//   issue.service -> 'POLL', jira-api.service -> Jira URLs (match '/issue/').
// Anything else falls back to T.GPB.UNKNOWN in GlobalProgressBarService.
export const PROGRESS_BAR_LABEL_MAP: { [key: string]: string } = {
  POLL: T.F.ISSUE.S.POLLING_CHANGES,
  '/issue/': T.GPB.JIRA_LOAD_ISSUE,
};
