import { JiraWorklogExportDefaultTime } from '../jira/jira.model';
import { BaseIssueProviderCfg } from '../../issue.model';
import { OpenProjectOriginalStatus } from './open-project-api-responses';

export type OpenProjectTransitionOption =
  | 'ALWAYS_ASK'
  | 'DO_NOT'
  | OpenProjectOriginalStatus;

export interface OpenProjectTransitionConfig {
  // NOTE: keys mirror IssueLocalState type
  // todo remove this with a proper migration since currently not used
  OPEN?: OpenProjectTransitionOption;
  IN_PROGRESS: OpenProjectTransitionOption;
  DONE: OpenProjectTransitionOption;
}
export interface OpenProjectCfg extends BaseIssueProviderCfg {
  isShowTimeTrackingDialog: boolean;
  isShowTimeTrackingDialogForEachSubTask: boolean;
  /** @deprecated backwards compatibility: optional for persisted data created before this field existed */
  timeTrackingDialogDefaultTime?: JiraWorklogExportDefaultTime;
  filterUsername: string | null;
  host: string | null;
  projectId: string | null;
  token: string | null;
  /** @deprecated backwards compatibility: optional for persisted data created before this field existed */
  scope?: string | null;
  isTransitionIssuesEnabled: boolean;
  isSetProgressOnTaskDone: boolean;
  progressOnDone?: number;
  transitionConfig?: OpenProjectTransitionConfig;
  availableTransitions?:
    | OpenProjectOriginalStatus[]
    | { id: string; name: string; [key: string]: unknown }[];
  /** @deprecated backwards compatibility: optional for persisted data created before this field existed */
  metadata?: { string: any };
}
