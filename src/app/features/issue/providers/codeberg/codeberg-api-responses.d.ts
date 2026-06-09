import { CodebergIssueStateOptions } from './codeberg-issue.model';

export type CodebergIssueState =
  | CodebergIssueStateOptions.open
  | CodebergIssueStateOptions.closed
  | CodebergIssueStateOptions.all;

export interface CodebergUser {
  avatar_url: string;
  id: number;
  username: string;
  login: string;
  full_name: string;
}
