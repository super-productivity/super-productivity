import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { LogseqBlock } from './logseq-issue.model';
import {
  extractFirstLine,
  extractRestOfContent,
  extractScheduledDate,
  extractScheduledDateTime,
} from './logseq-issue-map.util';

export const LOGSEQ_ISSUE_CONTENT_CONFIG: IssueContentConfig<LogseqBlock> = {
  issueType: 'LOGSEQ' as const,
  fields: [
    {
      label: 'Block',
      type: IssueFieldType.LINK,
      value: (block: LogseqBlock) => extractFirstLine(block.content),
      getLink: (block: LogseqBlock) => `logseq://graph/logseq?block-id=${block.uuid}`,
    },
    {
      label: 'Page',
      type: IssueFieldType.LINK,
      value: (block: LogseqBlock) => {
        return block.pageName || `Page ${block.page.id}`;
      },
      getLink: (block: LogseqBlock) => {
        if (block.pageName) {
          return `logseq://graph/logseq?page=${encodeURIComponent(block.pageName)}`;
        }
        return `logseq://graph/logseq?page=${block.page.id}`;
      },
    },
    {
      label: 'Status',
      value: (block: LogseqBlock) => block.marker || 'TODO',
      type: IssueFieldType.TEXT,
    },
    {
      label: 'Scheduled',
      value: (block: LogseqBlock) => {
        const scheduledDateTime = extractScheduledDateTime(block.content);
        if (scheduledDateTime) {
          // Format with date and time
          const date = new Date(scheduledDateTime);
          return date.toLocaleString('de-DE', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
        }

        const scheduledDate = extractScheduledDate(block.content);
        if (scheduledDate) {
          // Format date only
          const date = new Date(scheduledDate);
          return date.toLocaleDateString('de-DE', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          });
        }

        return '';
      },
      type: IssueFieldType.TEXT,
    },
    {
      label: 'Details',
      value: (block: LogseqBlock) => {
        const details = extractRestOfContent(block.content);

        // Fallback for testing
        return details || '*(No additional content)*';
      },
      type: IssueFieldType.MARKDOWN,
    },
  ],
  getIssueUrl: (block) => `logseq://graph/logseq?block-id=${block.uuid}`,
};
