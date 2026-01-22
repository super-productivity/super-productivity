import { LogseqBlock, LogseqBlockReduced } from './logseq-issue.model';
import { SearchResultItem } from '../../issue.model';
import { extractFirstLine } from './logseq-content.util';
import { extractScheduledDate, extractScheduledDateTime } from './logseq-scheduled.util';

export const mapBlockToIssueReduced = (block: any): LogseqBlockReduced => {
  const content = block.content || '';
  return {
    id: block.uuid, // Use UUID as id so tasks store UUID as issueId
    uuid: block.uuid,
    content: content, // Store full content for hash calculation
    marker: block.marker || null,
    properties: block.properties || {},
    scheduledDate: extractScheduledDate(content),
    scheduledDateTime: extractScheduledDateTime(content),
  };
};

export const mapBlockToSearchResult = (
  block: LogseqBlock,
): SearchResultItem<'LOGSEQ'> => {
  return {
    title: extractFirstLine(block.content),
    titleHighlighted: extractFirstLine(block.content),
    issueType: 'LOGSEQ',
    issueData: mapBlockToIssueReduced(block),
  };
};
