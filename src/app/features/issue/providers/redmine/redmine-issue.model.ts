export enum RedmineIssueStatusOptions {
  all = '*',
  open = 'open',
  closed = 'closed',
}

export type RedmineProject = Readonly<{
  id: number;
  name: string;
}>;

export type RedmineTracker = Readonly<{
  id: number;
  name: string;
}>;

export type RedmineStatus = Readonly<{
  id: number;
  name: string;
}>;

export type RedminePriority = Readonly<{
  id: number;
  name: string;
}>;

export type RedmineAuthor = Readonly<{
  id: number;
  name: string;
}>;

export type RedmineCategory = Readonly<{
  id: number;
  name: string;
}>;

export type RedmineCustomField = Readonly<{
  id: number;
  name: string;
  value: string;
}>;

export type RedmineIssue = Readonly<{
  id: number;
  project: RedmineProject;
  tracker: RedmineTracker;
  status: RedmineStatus;
  priority: RedminePriority;
  author: RedmineAuthor;
  category: RedmineCategory;
  subject: string;
  title: string;
  description: string;
  done_ratio: number;
  custom_fields: RedmineCustomField[];
  created_on: string;
  updated_on: string;
  url: string | null;
}>;

export type RedmineActivity = Readonly<{
  id: number;
  name: string;
  is_default: boolean;
}>;

export type RedmineActivityResult = Readonly<{
  time_entry_activities: RedmineActivity[];
}>;

export type RedmineSearchResultItem = Readonly<{
  id: number;
  title: string;
  url: string;
}>;

export type RedmineSearchResult = Readonly<{
  results: RedmineSearchResultItem[];
  total_count: number;
  offset: number;
  limit: number;
}>;

export type RedmineIssueResult = Readonly<{
  issues: RedmineIssue[];
  limit: number;
  offset: number;
  total_count: number;
}>;
