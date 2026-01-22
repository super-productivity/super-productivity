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
