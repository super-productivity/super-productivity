import { ForgejoIssueStateOptions } from './forgejo-issue.model';

export type ForgejoIssueState =
  | ForgejoIssueStateOptions.open
  | ForgejoIssueStateOptions.closed
  | ForgejoIssueStateOptions.all;

export interface ForgejoUser {
  avatar_url: string;
  id: number;
  username: string;
  login: string;
  full_name: string;
}
