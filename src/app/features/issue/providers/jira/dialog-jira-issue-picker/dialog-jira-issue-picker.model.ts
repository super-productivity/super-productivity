export interface DialogJiraIssuePickerData {
  /** Pre-selects a provider; shows selector dropdown if omitted and multiple providers configured. */
  issueProviderId?: string;
}

export interface JiraIssuePickerResult {
  issueId: string;
  issueProviderId: string;
  issueKey: string;
  issueSummary: string;
}
