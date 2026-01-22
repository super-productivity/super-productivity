/**
 * Re-export all Logseq utility functions for backward compatibility.
 * The actual implementations are now split into separate files:
 * - logseq-sp-drawer.util.ts: SP drawer functions
 * - logseq-content.util.ts: Content extraction functions
 * - logseq-scheduled.util.ts: Scheduling functions
 * - logseq-block-map.util.ts: Block mapping functions
 */

// SP Drawer utilities
export {
  SpDrawerData,
  extractSpDrawerData,
  getContentWithoutSpDrawer,
  updateSpDrawerInContent,
  calculateContentHash,
} from './logseq-sp-drawer.util';

// Content extraction utilities
export {
  removeLogseqFormatting,
  extractBlockText,
  extractFirstLine,
  extractRestOfContent,
  extractPropertiesFromContent,
} from './logseq-content.util';

// Scheduling utilities
export {
  extractScheduledDate,
  extractScheduledDateTime,
  formatLogseqDate,
  updateScheduledInContent,
} from './logseq-scheduled.util';

// Block mapping utilities
export { mapBlockToIssueReduced, mapBlockToSearchResult } from './logseq-block-map.util';
