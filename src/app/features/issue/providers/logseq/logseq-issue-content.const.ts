import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { LogseqBlock } from './logseq-issue.model';
import {
  extractFirstLine,
  extractRestOfContent,
  extractPropertiesFromContent,
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
      label: 'Details',
      value: (block: LogseqBlock) => {
        const details = extractRestOfContent(block.content);

        // Fallback for testing
        return details || '*(No additional content)*';
      },
      type: IssueFieldType.MARKDOWN,
    },
    {
      label: 'Properties',
      value: (block: LogseqBlock) => {
        // Combine API properties and content properties
        const apiProps = block.properties || {};
        const contentProps = extractPropertiesFromContent(block.content);

        // Merge without duplicates - API properties take precedence for inline properties
        const allProps: Record<string, any> = { ...contentProps, ...apiProps };

        if (Object.keys(allProps).length === 0) {
          return '';
        }

        const contentLines: string[] = [];

        // Separate inline properties from property blocks
        const inlineProps: Record<string, any> = {};
        const blockProps: Record<string, any> = {};

        Object.entries(allProps).forEach(([key, value]) => {
          if (typeof value === 'string' && value.includes('\n')) {
            blockProps[key] = value;
          } else {
            inlineProps[key] = value;
          }
        });

        // Show inline properties first
        Object.entries(inlineProps).forEach(([key, value]) => {
          contentLines.push(`**${key}:** ${value}`);
        });

        // Show property blocks (like LOGBOOK) as collapsible sections
        Object.entries(blockProps).forEach(([key, value]) => {
          contentLines.push(
            `\n<details>\n<summary><strong>${key}</strong></summary>\n\n\`\`\`\n${value}\n\`\`\`\n\n</details>`,
          );
        });

        return contentLines.join('  \n');
      },
      type: IssueFieldType.MARKDOWN,
    },
  ],
  getIssueUrl: (block) => `logseq://graph/logseq?block-id=${block.uuid}`,
};
