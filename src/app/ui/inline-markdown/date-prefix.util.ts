/**
 * Date detection/formatting for "dated bullet" continuation (#8602).
 *
 * A dated bullet looks like `- 18.06.: Phone call`. When the user presses Enter
 * on such a line, `handleEnterKey` continues it with TODAY's date in the same
 * format the line already uses. This module owns format detection and
 * today-generation so the two can never disagree, and so `markdown-toolbar.util.ts`
 * (already large) does not grow a second concern.
 *
 * Kept deliberately small: an explicit allow-list of formats, falling back to
 * plain bullet continuation for anything not listed rather than guessing.
 */

/**
 * The date layouts we mirror. Field order, separators, and zero-padding are
 * fixed per layout, so the layout name fully describes how to regenerate it.
 */
export type DatePrefixFormat = 'dotted' | 'dottedYear' | 'iso';

export interface DatePrefixMatch {
  /** Detected layout, used to regenerate the prefix with today's date. */
  format: DatePrefixFormat;
  /** Length of the matched `<date>: ` prefix (including the trailing ": "). */
  length: number;
}

// Each pattern is anchored at the start of the content after the "- " bullet and
// requires the date to be immediately followed by ": " (colon + space). Capture
// groups expose the fields we range-check.
//   iso         2026-06-18:   yyyy-MM-dd
//   dottedYear  18.06.2026:   dd.MM.yyyy
//   dotted      18.06.:       dd.MM.
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2}): /;
const DOTTED_YEAR_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4}): /;
const DOTTED_RE = /^(\d{1,2})\.(\d{1,2})\.: /;

const isValidDayMonth = (day: number, month: number): boolean =>
  day >= 1 && day <= 31 && month >= 1 && month <= 12;

/**
 * If `content` (the text after the "- " bullet) starts with a supported dated
 * prefix `<date>: `, returns its layout and matched length. Returns null for
 * anything unsupported — slashed dates (ambiguous field order), textual months,
 * 2-digit years, out-of-range day/month, or a missing colon — so the caller
 * falls back to plain bullet continuation rather than guessing.
 */
export const parseDatePrefix = (content: string): DatePrefixMatch | null => {
  const iso = content.match(ISO_RE);
  if (iso) {
    return isValidDayMonth(+iso[3], +iso[2])
      ? { format: 'iso', length: iso[0].length }
      : null;
  }
  const dottedYear = content.match(DOTTED_YEAR_RE);
  if (dottedYear) {
    return isValidDayMonth(+dottedYear[1], +dottedYear[2])
      ? { format: 'dottedYear', length: dottedYear[0].length }
      : null;
  }
  const dotted = content.match(DOTTED_RE);
  if (dotted) {
    return isValidDayMonth(+dotted[1], +dotted[2])
      ? { format: 'dotted', length: dotted[0].length }
      : null;
  }
  return null;
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Builds the `<today>: ` prefix in the given layout. Day/month are zero-padded
 * to 2 digits and the year to 4; the source's own padding is intentionally not
 * preserved (an unpadded `8.6.` still yields a padded `08.06.`), since a source
 * like `26.11.` carries no padding signal and pad-to-2 is the defined default.
 */
export const formatTodayPrefix = (format: DatePrefixFormat, today: Date): string => {
  const day = pad2(today.getDate());
  const month = pad2(today.getMonth() + 1);
  const year = String(today.getFullYear());
  switch (format) {
    case 'iso':
      return `${year}-${month}-${day}: `;
    case 'dottedYear':
      return `${day}.${month}.${year}: `;
    case 'dotted':
      return `${day}.${month}.: `;
  }
};
