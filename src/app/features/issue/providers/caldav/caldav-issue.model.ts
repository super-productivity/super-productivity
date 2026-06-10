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
  /** True when DTSTART is a VALUE=DATE (all-day) property, not a DATE-TIME. */
  isAllDay?: boolean;
  labels: string[];
  etag_hash: number;
  related_to?: string;
}>;

export type CaldavIssue = CaldavIssueReduced &
  Readonly<{
    due?: number;
    /** True when DUE is a VALUE=DATE (all-day) property, not a DATE-TIME. */
    isDueAllDay?: boolean;
    note?: string;
    status?: CaldavIssueStatus;
    priority?: number;
    percent_complete?: number;
    location?: string;
    duration?: number;
  }>;
