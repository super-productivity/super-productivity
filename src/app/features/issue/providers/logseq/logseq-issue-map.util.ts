import { LogseqBlock, LogseqBlockReduced } from './logseq-issue.model';
import { SearchResultItem } from '../../issue.model';

export const extractBlockText = (content: string): string => {
  return content
    .replace(/^(TODO|DONE|DOING|WAITING|LATER|NOW)\s+/i, '') // Remove marker
    .replace(/\n.*::.*/g, '') // Remove properties
    .trim();
};

export const extractFirstLine = (content: string): string => {
  const withoutMarker = content.replace(/^(TODO|DONE|DOING|WAITING|LATER|NOW)\s+/i, '');
  const firstLine = withoutMarker.split('\n')[0];
  return firstLine.trim();
};

export const extractRestOfContent = (content: string): string => {
  const withoutMarker = content.replace(/^(TODO|DONE|DOING|WAITING|LATER|NOW)\s+/i, '');
  const lines = withoutMarker.split('\n');

  if (lines.length <= 1) {
    return '';
  }

  const contentLines: string[] = [];
  let inPropertyBlock = false;
  let justLeftPropertyBlock = false;

  // Process all lines after the first one
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if ending property block FIRST (before checking for new block start)
    if (line === ':END:') {
      inPropertyBlock = false;
      justLeftPropertyBlock = true;
      continue;
    }

    // Check if starting a property block (e.g., :LOGBOOK:, :PROPERTIES:)
    if (line.match(/^:[A-Z_]+:$/)) {
      inPropertyBlock = true;
      justLeftPropertyBlock = false;
      continue;
    }

    // Skip lines inside property blocks
    if (inPropertyBlock) {
      continue;
    }

    // Skip inline property lines (key:: value)
    if (line.match(/^\S+::\s*.*/)) {
      continue;
    }

    // This is actual content
    // Add separator after property block if we just left one
    if (justLeftPropertyBlock && contentLines.length > 0) {
      contentLines.push('');
      justLeftPropertyBlock = false;
    }

    // Add content line (including empty lines for spacing)
    contentLines.push(line);
  }

  return contentLines.join('\n');
};

export const extractPropertiesFromContent = (content: string): Record<string, string> => {
  const withoutMarker = content.replace(/^(TODO|DONE|DOING|WAITING|LATER|NOW)\s+/i, '');
  const lines = withoutMarker.split('\n');
  const properties: Record<string, string> = {};
  let inPropertyBlock = false;
  let currentBlockName = '';
  let blockContent: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if ending property block FIRST (before checking for new block start)
    if (line === ':END:') {
      if (inPropertyBlock && currentBlockName) {
        properties[currentBlockName] = blockContent.join('\n');
      }
      inPropertyBlock = false;
      currentBlockName = '';
      blockContent = [];
      continue;
    }

    // Check if starting a property block
    const blockStartMatch = line.match(/^:([A-Z_]+):$/);
    if (blockStartMatch) {
      inPropertyBlock = true;
      currentBlockName = blockStartMatch[1];
      blockContent = [];
      continue;
    }

    // Collect lines in property blocks
    if (inPropertyBlock) {
      blockContent.push(line);
      continue;
    }

    // Extract inline properties (key:: value)
    const propMatch = line.match(/^(\S+)::\s*(.*)$/);
    if (propMatch) {
      properties[propMatch[1]] = propMatch[2];
    }
  }

  return properties;
};

export const mapBlockToIssueReduced = (block: any): LogseqBlockReduced => {
  return {
    id: block.uuid, // Use UUID as id so tasks store UUID as issueId
    uuid: block.uuid,
    content: extractFirstLine(block.content || ''),
    marker: block.marker || null,
    updatedAt: block.updatedAt || block['updated-at'] || Date.now(),
    properties: block.properties || {},
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
