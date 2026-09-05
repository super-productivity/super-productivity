/**
 * Extracts the human-readable calendar name from an iCal feed.
 *
 * X-WR-CALNAME is a de-facto standard property (Google, Outlook, Nextcloud,
 * Apple all emit it) carrying the calendar's display name. It is matched with
 * a small regex on the raw feed text instead of a full ICAL.parse so callers
 * can use it before (and independently of) event parsing.
 */
export const getCalNameFromIcal = (icalData: string): string | undefined => {
  if (!icalData) {
    return undefined;
  }
  // Unfold folded content lines per RFC 5545 §3.1 (line break followed by
  // a single space or tab continues the previous line).
  const unfolded = icalData.replace(/\r?\n[ \t]/g, '');
  // Allow property parameters between the name and the value separator,
  // e.g. `X-WR-CALNAME;VALUE=TEXT:My Calendar`.
  const match = unfolded.match(/^X-WR-CALNAME(?:;[^:\r\n]*)?:(.*)$/im);
  if (!match) {
    return undefined;
  }
  const value = match[1]
    // Unescape TEXT values per RFC 5545 §3.3.11; escaped newlines become a
    // plain space since the name is rendered as a single-line label.
    .replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c))
    .trim();
  return value || undefined;
};
