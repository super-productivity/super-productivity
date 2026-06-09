import { CodebergUser } from './codeberg-api-responses';

export enum CodebergIssueStateOptions {
  open = 'open',
  closed = 'closed',
  all = 'all',
}

export type CodebergLabel = Readonly<{
  id: number;
  name: string;
  color: string;
  description: string;
  url: string;
}>;

export type CodebergRepositoryReduced = Readonly<{
  id: number;
  name: string;
  owner: string;
  full_name: string;
}>;

export type CodebergIssue = Readonly<{
  id: number;
  url: string;
  html_url: string;
  number: number;
  user: CodebergUser;
  original_author: string;
  original_author_id: number;
  title: string;
  body: string;
  ref: string;
  labels: CodebergLabel[];
  milestone: unknown | null;
  assignee: CodebergUser;
  assignees: CodebergUser[];
  state: string;
  is_locked: boolean;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  due_date: string | null;
  repository: CodebergRepositoryReduced;
}>;
