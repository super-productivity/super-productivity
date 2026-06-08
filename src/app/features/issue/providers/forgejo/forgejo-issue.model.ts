import { ForgejoUser } from './forgejo-api-responses';

export enum ForgejoIssueStateOptions {
  open = 'open',
  closed = 'closed',
  all = 'all',
}

export type ForgejoLabel = Readonly<{
  id: number;
  name: string;
  color: string;
  description: string;
  url: string;
}>;

export type ForgejoRepositoryReduced = Readonly<{
  id: number;
  name: string;
  owner: string;
  full_name: string;
}>;

export type ForgejoIssue = Readonly<{
  id: number;
  url: string;
  html_url: string;
  number: number;
  user: ForgejoUser;
  original_author: string;
  original_author_id: number;
  title: string;
  body: string;
  ref: string;
  labels: ForgejoLabel[];
  milestone: unknown | null;
  assignee: ForgejoUser;
  assignees: ForgejoUser[];
  state: string;
  is_locked: boolean;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  due_date: string | null;
  repository: ForgejoRepositoryReduced;
}>;
