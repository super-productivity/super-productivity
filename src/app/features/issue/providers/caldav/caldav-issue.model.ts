export enum CaldavIssueStatus {
  NEEDS_ACTION = 'NEEDS-ACTION',
  COMPLETED = 'COMPLETED',
  IN_PROCESS = 'IN-PROCESS',
  CANCELLED = 'CANCELLED',
}

export type CaldavIssueReduced = Readonly<{
  id: string;
  completed: boolean;
  item_url: string;
  summary: string;
  start?: number;
  labels: string[];
  etag_hash: number;
  related_to?: string;
}>;

export type CaldavIssue = CaldavIssueReduced &
  Readonly<{
    due?: number;
    note?: string;
    status?: CaldavIssueStatus;
    priority?: number;
    percent_complete?: number;
    location?: string;
    duration?: number;
  }>;
