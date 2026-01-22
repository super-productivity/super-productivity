import { hashCode } from './logseq-marker-hash.util';
import { LOGSEQ_MARKER_REGEX } from './logseq.const';
import { LogseqLog } from '../../../../core/log';

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
  const drawerMatch = content.match(/:SP:([\s\S]*?):END:/);
  if (!drawerMatch) {
    return result;
  }

  const drawerContent = drawerMatch[1];

  // Extract superprod-last-sync: value
  const lastSyncMatch = drawerContent.match(/superprod-last-sync:\s*(\d+)/);
  if (lastSyncMatch) {
    result.lastSync = parseInt(lastSyncMatch[1], 10);
  }

  // Extract superprod-content-hash: value
  const hashMatch = drawerContent.match(/superprod-content-hash:\s*(-?\d+)/);
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
      // Remove all drawer blocks (:SP:, :LOGBOOK:, etc.) including empty ones
      .replace(/:[A-Z_]+:[\s\S]*?:END:\n?/g, '')
      // Remove marker prefix (TODO, DOING, DONE, NOW, LATER, WAITING)
      .replace(LOGSEQ_MARKER_REGEX, '')
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
  // Remove any existing :SP: drawer
  const updatedContent = content.replace(/:SP:[\s\S]*?:END:\n?/g, '');

  // Build the new drawer content
  const drawerContent = `:SP:
superprod-last-sync: ${timestamp}
superprod-content-hash: ${contentHash}
:END:`;

  // Find the insertion point - after SCHEDULED line if present, otherwise after first line
  const lines = updatedContent.split('\n').filter((line) => line !== '');
  let insertIndex = 1; // Default: after first line

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Insert after SCHEDULED or DEADLINE lines
    if (line.match(/^(SCHEDULED|DEADLINE):\s*<[^>]+>/)) {
      insertIndex = i + 1;
    }
    // Stop before other drawer blocks or actual content
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
  LogseqLog.debug('Content without drawers:', contentWithoutDrawers);
  return hashCode(contentWithoutDrawers);
};
