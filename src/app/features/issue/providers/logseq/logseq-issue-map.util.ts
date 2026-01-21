import { LogseqBlock, LogseqBlockReduced } from './logseq-issue.model';
import { SearchResultItem } from '../../issue.model';
import { hashCode } from './logseq-marker-hash.util';

// SP Drawer data interface
export interface SpDrawerData {
  lastSync: number | null;
  contentHash: number | null;
}

/**
 * Extract data from :SP: drawer in block content
 * Returns lastSync timestamp and contentHash if present
 */
export const extractSpDrawerData = (content: string): SpDrawerData => {
  const result: SpDrawerData = { lastSync: null, contentHash: null };

  // Match the :SP: drawer block
  const drawerMatch = content.match(/:SP:\s*\n([\s\S]*?)\n:END:/);
  if (!drawerMatch) {
    return result;
  }

  const drawerContent = drawerMatch[1];

  // Extract superprod-last-sync
  const lastSyncMatch = drawerContent.match(/superprod-last-sync::\s*(\d+)/);
  if (lastSyncMatch) {
    result.lastSync = parseInt(lastSyncMatch[1], 10);
  }

  // Extract superprod-content-hash
  const hashMatch = drawerContent.match(/superprod-content-hash::\s*(-?\d+)/);
  if (hashMatch) {
    result.contentHash = parseInt(hashMatch[1], 10);
  }

  return result;
};

/**
 * Get content without drawers and marker (for hash calculation)
 * Removes :SP:, :LOGBOOK:, and other drawer blocks, plus the marker prefix
 * This ensures the hash only includes the actual task content text
 */
export const getContentWithoutSpDrawer = (content: string): string => {
  return (
    content
      // Remove all drawer blocks (:SP:, :LOGBOOK:, :PROPERTIES:, etc.)
      .replace(/:[A-Z_]+:\s*\n[\s\S]*?\n:END:\n?/g, '')
      // Remove marker prefix (TODO, DOING, DONE, NOW, LATER, WAITING)
      .replace(/^(TODO|DONE|DOING|LATER|WAITING|NOW)\s+/i, '')
      .trim()
  );
};

/**
 * Update or add :SP: drawer in block content
 * Places the drawer after SCHEDULED line (if present) or after first line
 */
export const updateSpDrawerInContent = (
  content: string,
  timestamp: number,
  contentHash: number,
): string => {
  // First, remove any existing :SP: drawer
  const updatedContent = content.replace(/:SP:\s*\n[\s\S]*?\n:END:\n?/g, '');

  // Build the new drawer content
  const drawerContent = `:SP:
superprod-last-sync:: ${timestamp}
superprod-content-hash:: ${contentHash}
:END:`;

  // Find the insertion point - after SCHEDULED line if present, otherwise after first line
  const lines = updatedContent.split('\n');
  let insertIndex = 1; // Default: after first line

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Insert after SCHEDULED or DEADLINE lines
    if (line.match(/^(SCHEDULED|DEADLINE):\s*<[^>]+>/)) {
      insertIndex = i + 1;
    }
    // Stop before property blocks or actual content
    if (i > 0 && (line.match(/^:[A-Z_]+:$/) || (!line.match(/^\S+::/) && line !== ''))) {
      break;
    }
  }

  // Insert the drawer
  lines.splice(insertIndex, 0, drawerContent);

  return lines.join('\n');
};

/**
 * Calculate hash for block content (excluding all drawers)
 */
export const calculateContentHash = (content: string): number => {
  const contentWithoutDrawers = getContentWithoutSpDrawer(content);
  console.log('[LOGSEQ HASH] Content without drawers:', contentWithoutDrawers);
  return hashCode(contentWithoutDrawers);
};

/**
 * Remove Logseq-specific formatting (page links and tags)
 * [[Page Link]] -> Page Link
 * #tag -> tag
 */
export const removeLogseqFormatting = (text: string): string => {
  return text
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // Remove page link brackets [[...]]
    .replace(/#(\w+)/g, '$1'); // Remove tag hashes #...
};

export const extractBlockText = (content: string): string => {
  return removeLogseqFormatting(
    content
      .replace(/^(TODO|DONE|DOING|WAITING|LATER|NOW)\s+/i, '') // Remove marker
      .replace(/\n.*::.*/g, ''), // Remove properties
  ).trim();
};

export const extractFirstLine = (content: string): string => {
  const withoutMarker = content.replace(/^(TODO|DONE|DOING|WAITING|LATER|NOW)\s+/i, '');
  const firstLine = withoutMarker.split('\n')[0];
  return removeLogseqFormatting(firstLine).trim();
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

    // Skip SCHEDULED and DEADLINE lines
    if (line.match(/^(SCHEDULED|DEADLINE):\s*<[^>]+>/)) {
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

  return removeLogseqFormatting(contentLines.join('\n'));
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

/**
 * Extract SCHEDULED date from Logseq block content
 * Format: SCHEDULED: <2026-01-17 Sat> or SCHEDULED: <2026-01-17 Sat 14:30>
 * Returns: "2026-01-17" or null
 */
export const extractScheduledDate = (content: string): string | null => {
  const scheduledMatch = content.match(
    /SCHEDULED:\s*<(\d{4}-\d{2}-\d{2})\s+\w+(?:\s+\d{2}:\d{2})?>/,
  );
  return scheduledMatch ? scheduledMatch[1] : null;
};

/**
 * Extract SCHEDULED date AND time from Logseq block content
 * Format: SCHEDULED: <2026-01-17 Sat 14:30>
 * Returns: timestamp (ms) or null if no time is specified
 */
export const extractScheduledDateTime = (content: string): number | null => {
  const scheduledMatch = content.match(
    /SCHEDULED:\s*<(\d{4}-\d{2}-\d{2})\s+\w+\s+(\d{2}):(\d{2})>/,
  );
  if (!scheduledMatch) {
    return null;
  }

  const dateStr = scheduledMatch[1]; // "2026-01-17"
  const hours = parseInt(scheduledMatch[2], 10); // "14"
  const minutes = parseInt(scheduledMatch[3], 10); // "30"

  // Parse as local time explicitly (not UTC)
  // Split the date string and use Date constructor to ensure local timezone
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);

  return date.getTime();
};

/**
 * Format date for Logseq SCHEDULED syntax
 * Input: "2026-01-17" (YYYY-MM-DD) OR timestamp (ms)
 * Output: "<2026-01-17 Fri>" or "<2026-01-17 Fri 14:30>"
 */
export const formatLogseqDate = (dateInput: string | number): string => {
  let date: Date;
  let dateStr: string;
  let includeTime = false;

  if (typeof dateInput === 'number') {
    // Timestamp provided - include time
    date = new Date(dateInput);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dateStr = `${year}-${month}-${day}`;
    includeTime = true;
  } else {
    // Date string provided - no time
    date = new Date(dateInput);
    dateStr = dateInput;
    includeTime = false;
  }

  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);

  if (includeTime) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `<${dateStr} ${dayName} ${hours}:${minutes}>`;
  } else {
    return `<${dateStr} ${dayName}>`;
  }
};

/**
 * Add or update SCHEDULED in block content
 * Returns updated content string
 */
export const updateScheduledInContent = (
  content: string,
  dateInput: string | number | null,
): string => {
  // Remove existing SCHEDULED line
  let updatedContent = content.replace(/\nSCHEDULED:\s*<[^>]+>/g, '');

  // Add new SCHEDULED if date provided
  if (dateInput) {
    const logseqDate = formatLogseqDate(dateInput);
    // Add after first line (after marker + title)
    const lines = updatedContent.split('\n');
    lines.splice(1, 0, `SCHEDULED: ${logseqDate}`);
    updatedContent = lines.join('\n');
  }

  return updatedContent;
};

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
