export interface AzureDevOpsIssueReduced {
  id: string;
  summary: string;
  description?: string | null;
  status: string;
  priority?: number | null;
  created: string;
  updated: string;
  assignee?: string | null;
  url?: string;
  due?: string | null;
}

// Type alias for full issue - can be extended with additional fields if needed
export type AzureDevOpsIssue = AzureDevOpsIssueReduced;
